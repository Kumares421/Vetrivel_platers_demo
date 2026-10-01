import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// GET /api/chemicals
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        c.id, c.code, c.name, c.base_unit, c.min_stock_level, c.is_active, c.description, c.created_at,
        COALESCE(SUM(l.remaining_qty), 0) as total_on_hand,
        COALESCE(SUM(CASE WHEN l.status = 'AVAILABLE' AND (l.expiry_date IS NULL OR l.expiry_date >= CURRENT_DATE) THEN l.remaining_qty ELSE 0 END), 0) as total_available
      FROM chemicals c
      LEFT JOIN receipt_lots l ON c.id = l.chemical_id AND l.remaining_qty > 0
      GROUP BY c.id, c.code, c.name, c.base_unit, c.min_stock_level, c.is_active, c.description, c.created_at
      ORDER BY c.code ASC
    `;
    const result = await query(sql);
    
    // Parse numeric and boolean fields for reliable JSON serialization
    const chemicals = result.rows.map(row => ({
      ...row,
      is_active: Boolean(row.is_active),
      min_stock_level: parseFloat(row.min_stock_level || '0'),
      total_on_hand: parseFloat(row.total_on_hand || '0'),
      total_available: parseFloat(row.total_available || '0'),
      // Low stock only when eligible available stock is STRICTLY LESS THAN minimum.
      // Equal to minimum is NOT below minimum.
      is_low_stock: parseFloat(row.min_stock_level || '0') > 0 && parseFloat(row.total_available || '0') < parseFloat(row.min_stock_level || '0')
    }));

    return res.json(chemicals);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/chemicals/:id
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM chemicals WHERE id = ?', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chemical not found' });
    }
    const chem = result.rows[0];
    chem.is_active = Boolean(chem.is_active);
    chem.min_stock_level = parseFloat(chem.min_stock_level || '0');
    return res.json(chem);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/chemicals (Admin / Storekeeper)
router.post('/', authenticateToken, requireRole(['ADMIN', 'STOREKEEPER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code, name, base_unit, min_stock_level, description, is_active } = req.body;
    
    if (!code || !name || !base_unit) {
      return res.status(400).json({ error: 'Chemical code, name, and base unit are required' });
    }

    if (!['kg', 'L', 'nos'].includes(base_unit)) {
      return res.status(400).json({ error: 'Base unit must be one of: kg, L, nos' });
    }

    // Check duplicate code
    const existing = await query('SELECT id FROM chemicals WHERE UPPER(code) = UPPER(?)', [code.trim()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: `Chemical code "${code.trim().toUpperCase()}" already exists. Codes must be unique.` });
    }

    const id = uuidv4();
    const minParsed = parseFloat(min_stock_level);
    const minLevel = Number.isFinite(minParsed) && minParsed >= 0 ? minParsed : 0;
    const activeBool = is_active !== undefined ? Boolean(is_active) : true;
    const desc = description != null && String(description).trim() !== '' ? String(description).trim() : null;

    await query(
      `INSERT INTO chemicals (id, code, name, base_unit, min_stock_level, is_active, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, code.trim().toUpperCase(), name.trim(), base_unit, minLevel, activeBool, desc]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CHEMICAL_CREATED',
      recordRef: `chemicals/${id}`,
      changedValues: { code: code.trim().toUpperCase(), name: name.trim(), base_unit, min_stock_level: minLevel, is_active: activeBool },
    });

    return res.status(201).json({ id, code: code.trim().toUpperCase(), name: name.trim(), base_unit, min_stock_level: minLevel, is_active: activeBool, description: desc });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/chemicals/:id (Admin / Storekeeper)
router.put('/:id', authenticateToken, requireRole(['ADMIN', 'STOREKEEPER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { code, name, base_unit, min_stock_level, description, is_active } = req.body;

    const existingRes = await query('SELECT * FROM chemicals WHERE id = ?', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Chemical not found' });
    }

    const existing = existingRes.rows[0];

    // Prevent changing the unit after stock movements exist for this chemical!
    if (base_unit && base_unit !== existing.base_unit) {
      const movementCheck = await query('SELECT COUNT(*) as count FROM stock_movements WHERE chemical_id = ?', [id]);
      const movementCount = parseInt(movementCheck.rows[0]?.count || '0', 10);
      if (movementCount > 0) {
        return res.status(400).json({ 
          error: `Cannot change unit from "${existing.base_unit}" to "${base_unit}". Stock movements already exist for this chemical.` 
        });
      }
    }

    // Duplicate code check if code changed
    if (code && code.trim().toUpperCase() !== existing.code) {
      const codeCheck = await query('SELECT id FROM chemicals WHERE UPPER(code) = UPPER(?) AND id != ?', [code.trim(), id]);
      if (codeCheck.rows.length > 0) {
        return res.status(400).json({ error: `Chemical code "${code.trim().toUpperCase()}" is already assigned to another chemical.` });
      }
    }

    const newCode = code ? code.trim().toUpperCase() : existing.code;
    const newName = name ? name.trim() : existing.name;
    const newUnit = base_unit || existing.base_unit;
    const minParsed = min_stock_level != null ? parseFloat(min_stock_level) : parseFloat(existing.min_stock_level);
    const newMinLevel = Number.isFinite(minParsed) && minParsed >= 0 ? minParsed : 0;
    const newActive = is_active !== undefined ? Boolean(is_active) : Boolean(existing.is_active);
    const newDesc = description !== undefined ? (description != null && String(description).trim() !== '' ? String(description).trim() : null) : existing.description;

    await query(
      `UPDATE chemicals 
       SET code = ?, name = ?, base_unit = ?, min_stock_level = ?, is_active = ?, description = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newCode, newName, newUnit, newMinLevel, newActive, newDesc, id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CHEMICAL_UPDATED',
      recordRef: `chemicals/${id}`,
      changedValues: { code: newCode, name: newName, base_unit: newUnit, min_stock_level: newMinLevel, is_active: newActive },
    });

    return res.json({ id, code: newCode, name: newName, base_unit: newUnit, min_stock_level: newMinLevel, is_active: newActive, description: newDesc });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chemicals/:id (Admin only)
router.delete('/:id', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const chemRes = await query('SELECT * FROM chemicals WHERE id = ?', [id]);
    if (chemRes.rows.length === 0) {
      return res.status(404).json({ error: 'Chemical not found' });
    }
    const chem = chemRes.rows[0];

    // Check total stock on hand & remaining in receipt lots
    const lotStockRes = await query(
      `SELECT COUNT(*) as lot_count, COALESCE(SUM(remaining_qty), 0) as total_remaining FROM receipt_lots WHERE chemical_id = ?`,
      [id]
    );
    const lotCount = parseInt(lotStockRes.rows[0]?.lot_count || '0', 10);
    const totalRemaining = parseFloat(lotStockRes.rows[0]?.total_remaining || '0');

    // Check linked records across all tables
    const movementsRes = await query(`SELECT COUNT(*) as count FROM stock_movements WHERE chemical_id = ?`, [id]);
    const movementsCount = parseInt(movementsRes.rows[0]?.count || '0', 10);

    const issuesRes = await query(`SELECT COUNT(*) as count FROM chemical_issues WHERE chemical_id = ?`, [id]);
    const issuesCount = parseInt(issuesRes.rows[0]?.count || '0', 10);

    const openingRes = await query(`SELECT COUNT(*) as count FROM opening_stock_entries WHERE chemical_id = ?`, [id]);
    const openingCount = parseInt(openingRes.rows[0]?.count || '0', 10);

    const adjustmentsRes = await query(`SELECT COUNT(*) as count FROM stock_adjustments WHERE chemical_id = ?`, [id]);
    const adjustmentsCount = parseInt(adjustmentsRes.rows[0]?.count || '0', 10);

    const totalLinkedRecords = lotCount + movementsCount + issuesCount + openingCount + adjustmentsCount;

    if (totalRemaining > 0 || totalLinkedRecords > 0) {
      const details: string[] = [];
      if (totalRemaining > 0) details.push(`current stock balance of ${totalRemaining} ${chem.base_unit}`);
      if (totalLinkedRecords > 0) details.push(`${totalLinkedRecords} linked transaction record(s) (receipt lots, stock movements, tank issues, or adjustments)`);

      return res.status(400).json({
        error: `Cannot delete chemical "${chem.code} - ${chem.name}". It has ${details.join(' and ')}. Permanent deletion is blocked to preserve audit compliance. You may set this chemical to Inactive instead to prevent future receipts or issues.`,
        canDeactivate: true,
        chemicalId: id,
        code: chem.code,
        name: chem.name,
        totalRemaining,
        totalLinkedRecords
      });
    }

    // Completely unreferenced and zero stock - permanent delete
    await query('DELETE FROM chemicals WHERE id = ?', [id]);

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CHEMICAL_DELETED',
      recordRef: `chemicals/${id}`,
      changedValues: { code: chem.code, name: chem.name },
    });

    return res.json({ message: `Chemical "${chem.code} - ${chem.name}" was permanently deleted successfully.` });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
