import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// GET /api/customers
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { include_inactive } = req.query;
    let sql = 'SELECT * FROM customers';
    const params: any[] = [];

    if (include_inactive !== 'true') {
      sql += ' WHERE is_active = 1';
    }
    sql += ' ORDER BY name ASC';

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/customers/:id
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    return res.json(result.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/customers (Admin / Super Admin only)
router.post('/', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code, name, contact_person, phone, email, address, gst_number } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: 'Customer code and name are required' });
    }

    const cleanCode = code.trim().toUpperCase();
    const existing = await query('SELECT id FROM customers WHERE code = ?', [cleanCode]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: `Customer code ${cleanCode} already exists` });
    }

    const id = uuidv4();
    await query(
      `INSERT INTO customers (id, code, name, contact_person, phone, email, address, gst_number, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, cleanCode, name.trim(), contact_person || null, phone || null, email || null, address || null, gst_number || null]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CUSTOMER_CREATED',
      recordRef: `customers/${id}`,
      changedValues: { code: cleanCode, name },
    });

    return res.status(201).json({ id, code: cleanCode, name: name.trim(), is_active: 1 });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/customers/:id (Admin / Super Admin only)
router.put('/:id', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, contact_person, phone, email, address, gst_number } = req.body;
    const { id } = req.params;

    if (!name) {
      return res.status(400).json({ error: 'Customer name is required' });
    }

    await query(
      `UPDATE customers SET 
         name = ?, contact_person = ?, phone = ?, email = ?, address = ?, gst_number = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [name.trim(), contact_person || null, phone || null, email || null, address || null, gst_number || null, id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CUSTOMER_UPDATED',
      recordRef: `customers/${id}`,
      changedValues: { name },
    });

    return res.json({ success: true, id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/customers/:id/status (Admin / Super Admin only - safe deactivation)
router.patch('/:id/status', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { is_active } = req.body;
    const { id } = req.params;

    await query('UPDATE customers SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [is_active ? 1 : 0, id]);

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: is_active ? 'CUSTOMER_ACTIVATED' : 'CUSTOMER_DEACTIVATED',
      recordRef: `customers/${id}`,
      reason: `Customer active status changed to ${is_active}`,
    });

    return res.json({ success: true, is_active });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
