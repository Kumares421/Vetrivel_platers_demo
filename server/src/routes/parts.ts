import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// GET /api/parts (List all parts or filter by customer)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customer_id, include_inactive } = req.query;
    let sql = `
      SELECT p.*, c.name as customer_name, c.code as customer_code
      FROM parts p
      JOIN customers c ON p.customer_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (customer_id) {
      sql += ' AND p.customer_id = ?';
      params.push(customer_id);
    }
    if (include_inactive !== 'true') {
      sql += ' AND p.is_active = 1';
    }
    sql += ' ORDER BY c.name ASC, p.part_number ASC';

    const result = await query(sql, params);
    const rows = result.rows.map(r => ({
      ...r,
      rate_per_piece: parseFloat(r.rate_per_piece),
      surface_area_sqdm: parseFloat(r.surface_area_sqdm || '0')
    }));

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/parts/:id
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT p.*, c.name as customer_name, c.code as customer_code
      FROM parts p
      JOIN customers c ON p.customer_id = c.id
      WHERE p.id = ?
    `;
    const result = await query(sql, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }
    const r = result.rows[0];
    return res.json({
      ...r,
      rate_per_piece: parseFloat(r.rate_per_piece),
      surface_area_sqdm: parseFloat(r.surface_area_sqdm || '0')
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/parts (Admin / Super Admin only)
router.post('/', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customer_id, part_number, part_name, process_type, surface_area_sqdm, rate_per_piece, base_unit } = req.body;

    if (!customer_id || !part_number || !part_name || !process_type || rate_per_piece == null) {
      return res.status(400).json({ error: 'Customer, part number, part name, process type, and rate are required' });
    }

    const rate = parseFloat(rate_per_piece);
    if (isNaN(rate) || rate < 0) {
      return res.status(400).json({ error: 'Rate per piece must be non-negative' });
    }

    // Verify customer exists
    const custRes = await query('SELECT id FROM customers WHERE id = ?', [customer_id]);
    if (custRes.rows.length === 0) {
      return res.status(400).json({ error: 'Selected customer does not exist' });
    }

    const cleanPartNo = part_number.trim().toUpperCase();
    const existing = await query('SELECT id FROM parts WHERE customer_id = ? AND part_number = ?', [customer_id, cleanPartNo]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: `Part number ${cleanPartNo} already exists for this customer` });
    }

    const id = uuidv4();
    await query(
      `INSERT INTO parts (id, customer_id, part_number, part_name, process_type, surface_area_sqdm, rate_per_piece, base_unit, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, customer_id, cleanPartNo, part_name.trim(), process_type.trim(), surface_area_sqdm || 0, rate, base_unit || 'nos']
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PART_CREATED',
      recordRef: `parts/${id}`,
      changedValues: { customer_id, part_number: cleanPartNo, rate_per_piece: rate },
    });

    return res.status(201).json({ id, customer_id, part_number: cleanPartNo, part_name, rate_per_piece: rate, is_active: 1 });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/parts/:id (Admin / Super Admin only)
router.put('/:id', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { part_name, process_type, surface_area_sqdm, rate_per_piece, base_unit } = req.body;
    const { id } = req.params;

    if (!part_name || rate_per_piece == null) {
      return res.status(400).json({ error: 'Part name and rate are required' });
    }

    const rate = parseFloat(rate_per_piece);
    if (isNaN(rate) || rate < 0) {
      return res.status(400).json({ error: 'Rate must be non-negative' });
    }

    await query(
      `UPDATE parts SET 
         part_name = ?, process_type = ?, surface_area_sqdm = ?, rate_per_piece = ?, base_unit = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [part_name.trim(), process_type ? process_type.trim() : 'Zinc Plating', surface_area_sqdm || 0, rate, base_unit || 'nos', id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PART_UPDATED',
      recordRef: `parts/${id}`,
      changedValues: { part_name, rate_per_piece: rate },
    });

    return res.json({ success: true, id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/parts/:id/status (Admin / Super Admin only)
router.patch('/:id/status', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { is_active } = req.body;
    const { id } = req.params;

    await query('UPDATE parts SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [is_active ? 1 : 0, id]);

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: is_active ? 'PART_ACTIVATED' : 'PART_DEACTIVATED',
      recordRef: `parts/${id}`,
      reason: `Part active status set to ${is_active}`,
    });

    return res.json({ success: true, is_active });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
