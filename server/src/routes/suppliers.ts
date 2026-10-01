import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// GET /api/suppliers
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM suppliers ORDER BY name ASC');
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers
router.post('/', authenticateToken, requireRole(['ADMIN', 'STOREKEEPER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, contact_details, address, is_active } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Supplier name is required' });
    }

    const id = uuidv4();
    const active = is_active !== undefined ? Boolean(is_active) : true;

    await query(
      `INSERT INTO suppliers (id, name, contact_details, address, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [id, name.trim(), contact_details || null, address || null, active]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'SUPPLIER_CREATED',
      recordRef: `suppliers/${id}`,
      changedValues: { name: name.trim() },
    });

    return res.status(201).json({ id, name: name.trim(), contact_details, address, is_active: active });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/suppliers/:id
router.put('/:id', authenticateToken, requireRole(['ADMIN', 'STOREKEEPER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, contact_details, address, is_active } = req.body;

    const existing = await query('SELECT * FROM suppliers WHERE id = ?', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const s = existing.rows[0];
    const newName = name ? name.trim() : s.name;
    const newContact = contact_details !== undefined ? contact_details : s.contact_details;
    const newAddress = address !== undefined ? address : s.address;
    const newActive = is_active !== undefined ? Boolean(is_active) : Boolean(s.is_active);

    await query(
      `UPDATE suppliers 
       SET name = ?, contact_details = ?, address = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newName, newContact, newAddress, newActive, id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'SUPPLIER_UPDATED',
      recordRef: `suppliers/${id}`,
      changedValues: { name: newName, is_active: newActive },
    });

    return res.json({ id, name: newName, contact_details: newContact, address: newAddress, is_active: newActive });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
