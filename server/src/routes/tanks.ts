import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// GET /api/tanks (List all production tanks)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, code, display_name, 
        COALESCE(capacity_liters, 0) as capacity_liters,
        COALESCE(status, 'ACTIVE') as status,
        location, is_active, created_at, updated_at
      FROM tanks 
      ORDER BY code ASC
    `);
    const rows = result.rows.map(r => ({
      ...r,
      capacity_liters: parseFloat(r.capacity_liters || '0')
    }));
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/tanks/:id/issue-history (Tank issue consumption history)
router.get('/:id/issue-history', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT 
         ci.id, ci.issue_number, ci.issue_date, ci.required_qty, ci.job_reference,
         ci.total_allocated_value, ci.remarks,
         c.code as chemical_code, c.name as chemical_name, c.base_unit,
         u.name as issued_by_name
       FROM chemical_issues ci
       JOIN chemicals c ON ci.chemical_id = c.id
       JOIN users u ON ci.issued_by_user_id = u.id
       WHERE ci.tank_id = ? AND ci.status = 'POSTED'
       ORDER BY ci.issue_date DESC`,
      [id]
    );

    const rows = result.rows.map(r => ({
      ...r,
      required_qty: parseFloat(r.required_qty),
      total_allocated_value: parseFloat(r.total_allocated_value || '0')
    }));

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/tanks (Admin / Super Admin only)
router.post('/', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code, display_name, capacity_liters, location, status: tankStatus, is_active } = req.body;
    if (!code || !display_name) {
      return res.status(400).json({ error: 'Tank code and display name are required' });
    }

    const cleanCode = code.trim().toUpperCase();
    const existing = await query('SELECT id FROM tanks WHERE UPPER(code) = UPPER(?)', [cleanCode]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: `Tank code "${cleanCode}" already exists` });
    }

    const id = uuidv4();
    const active = is_active !== undefined ? Boolean(is_active) : true;
    const capacity = capacity_liters != null ? parseFloat(capacity_liters) : 0;
    const statusVal = tankStatus ? tankStatus.trim().toUpperCase() : 'ACTIVE';

    await query(
      `INSERT INTO tanks (id, code, display_name, capacity_liters, status, location, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, cleanCode, display_name.trim(), capacity, statusVal, location ? location.trim() : null, active ? 1 : 0]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'TANK_CREATED',
      recordRef: `tanks/${id}`,
      changedValues: { code: cleanCode, display_name: display_name.trim(), capacity_liters: capacity },
    });

    return res.status(201).json({ id, code: cleanCode, display_name: display_name.trim(), capacity_liters: capacity, status: statusVal, is_active: active });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/tanks/:id (Admin / Super Admin only)
router.put('/:id', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { code, display_name, capacity_liters, location, status: tankStatus, is_active } = req.body;

    const existing = await query('SELECT * FROM tanks WHERE id = ?', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Tank not found' });
    }

    const t = existing.rows[0];

    if (code && code.trim().toUpperCase() !== t.code) {
      const codeCheck = await query('SELECT id FROM tanks WHERE UPPER(code) = UPPER(?) AND id != ?', [code.trim(), id]);
      if (codeCheck.rows.length > 0) {
        return res.status(400).json({ error: `Tank code "${code.trim().toUpperCase()}" already exists` });
      }
    }

    const newCode = code ? code.trim().toUpperCase() : t.code;
    const newName = display_name ? display_name.trim() : t.display_name;
    const newCapacity = capacity_liters != null ? parseFloat(capacity_liters) : (parseFloat(t.capacity_liters) || 0);
    const newLocation = location !== undefined ? (location ? location.trim() : null) : t.location;
    const newStatus = tankStatus ? tankStatus.trim().toUpperCase() : (t.status || 'ACTIVE');
    const newActive = is_active !== undefined ? (is_active ? 1 : 0) : t.is_active;

    await query(
      `UPDATE tanks 
       SET code = ?, display_name = ?, capacity_liters = ?, status = ?, location = ?, is_active = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [newCode, newName, newCapacity, newStatus, newLocation, newActive, id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'TANK_UPDATED',
      recordRef: `tanks/${id}`,
      changedValues: { code: newCode, display_name: newName, capacity_liters: newCapacity },
    });

    return res.json({ id, code: newCode, display_name: newName, capacity_liters: newCapacity, status: newStatus, is_active: newActive });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
