import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Function to generate Chemical PO number format: CPO-YYYYMMDD-XXXX
async function generateCPONumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `CPO-${dateStr}-`;

  const result = await query(
    `SELECT po_number FROM chemical_purchase_orders WHERE po_number LIKE ? ORDER BY po_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].po_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// GET /api/chemical-pos (List all chemical purchase orders)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, supplier_id } = req.query;
    let sql = `
      SELECT 
        cpo.*, s.name as supplier_name,
        u.name as created_by_name, au.name as approved_by_name,
        (SELECT COUNT(*) FROM chemical_po_items WHERE chemical_po_id = cpo.id) as items_count,
        (SELECT COALESCE(SUM(ordered_qty), 0) FROM chemical_po_items WHERE chemical_po_id = cpo.id) as total_ordered_qty,
        (SELECT COALESCE(SUM(received_qty), 0) FROM chemical_po_items WHERE chemical_po_id = cpo.id) as total_received_qty
      FROM chemical_purchase_orders cpo
      JOIN suppliers s ON cpo.supplier_id = s.id
      JOIN users u ON cpo.created_by_user_id = u.id
      LEFT JOIN users au ON cpo.approved_by_user_id = au.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND cpo.status = ?';
      params.push(status);
    }
    if (supplier_id) {
      sql += ' AND cpo.supplier_id = ?';
      params.push(supplier_id);
    }

    sql += ' ORDER BY cpo.created_at DESC';

    const result = await query(sql, params);
    const rows = result.rows.map(r => {
      const ordered = parseFloat(r.total_ordered_qty || '0');
      const received = parseFloat(r.total_received_qty || '0');
      const pending = Math.max(0, Math.round((ordered - received) * 10000) / 10000);
      return {
        ...r,
        total_amount: parseFloat(r.total_amount || '0'),
        total_ordered_qty: ordered,
        total_received_qty: received,
        total_pending_qty: pending
      };
    });

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/chemical-pos/:id (Detailed PO with items & receipt progress)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const poRes = await query(
      `SELECT 
         cpo.*, s.name as supplier_name, s.contact_details as supplier_contact, s.address as supplier_address,
         u.name as created_by_name, au.name as approved_by_name
       FROM chemical_purchase_orders cpo
       JOIN suppliers s ON cpo.supplier_id = s.id
       JOIN users u ON cpo.created_by_user_id = u.id
       LEFT JOIN users au ON cpo.approved_by_user_id = au.id
       WHERE cpo.id = ?`,
      [req.params.id]
    );

    if (poRes.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase Order not found' });
    }

    const po = poRes.rows[0];

    const itemsRes = await query(
      `SELECT 
         cpoi.*, c.code as chemical_code, c.name as chemical_name, c.base_unit
       FROM chemical_po_items cpoi
       JOIN chemicals c ON cpoi.chemical_id = c.id
       WHERE cpoi.chemical_po_id = ?
       ORDER BY c.code ASC`,
      [req.params.id]
    );

    po.items = itemsRes.rows.map(item => {
      const ordered = parseFloat(item.ordered_qty);
      const received = parseFloat(item.received_qty || '0');
      const pending = Math.max(0, Math.round((ordered - received) * 10000) / 10000);
      return {
        ...item,
        ordered_qty: ordered,
        received_qty: received,
        pending_qty: pending,
        rate_per_unit: parseFloat(item.rate_per_unit),
        line_amount: parseFloat(item.line_amount)
      };
    });

    po.total_amount = parseFloat(po.total_amount);

    return res.json(po);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/chemical-pos (Create Chemical PO - MUST NOT increase stock!)
router.post('/', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const {
      supplier_id, po_date, expected_delivery_date, notes, items,
      idempotency_key, auto_approve
    } = req.body;

    const idempotencyKeyHeader = req.headers['x-idempotency-key'] as string | undefined;
    const finalIdempotencyKey = idempotency_key || idempotencyKeyHeader || null;

    if (!supplier_id || !po_date || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Supplier, PO date, and at least one item are required' });
    }

    // Verify supplier exists
    const suppCheck = await query('SELECT id, is_active FROM suppliers WHERE id = ?', [supplier_id]);
    if (suppCheck.rows.length === 0 || !suppCheck.rows[0].is_active) {
      return res.status(400).json({ error: 'Selected supplier does not exist or is inactive' });
    }

    // Idempotency check
    if (finalIdempotencyKey) {
      const idempRes = await query('SELECT id, po_number FROM chemical_purchase_orders WHERE idempotency_key = ?', [finalIdempotencyKey]);
      if (idempRes.rows.length > 0) {
        const existing = idempRes.rows[0];
        return res.json({
          id: existing.id,
          po_number: existing.po_number,
          message: 'Duplicate PO submission prevented by idempotency key. Original PO returned.'
        });
      }
    }

    let totalAmount = 0;
    const validatedItems: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.chemical_id || it.ordered_qty == null || it.rate_per_unit == null) {
        return res.status(400).json({ error: `Item #${i + 1}: Chemical, quantity, and rate are required` });
      }

      const qty = parseFloat(it.ordered_qty);
      const rate = parseFloat(it.rate_per_unit);

      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: `Item #${i + 1}: Ordered quantity must be greater than zero` });
      }
      if (isNaN(rate) || rate < 0) {
        return res.status(400).json({ error: `Item #${i + 1}: Rate must be non-negative` });
      }

      const chemCheck = await query('SELECT id, is_active FROM chemicals WHERE id = ?', [it.chemical_id]);
      if (chemCheck.rows.length === 0 || !chemCheck.rows[0].is_active) {
        return res.status(400).json({ error: `Item #${i + 1}: Selected chemical is invalid or inactive` });
      }

      const lineAmount = Math.round(qty * rate * 100) / 100;
      totalAmount += lineAmount;

      validatedItems.push({
        id: uuidv4(),
        chemical_id: it.chemical_id,
        ordered_qty: qty,
        rate_per_unit: rate,
        line_amount: lineAmount
      });
    }

    totalAmount = Math.round(totalAmount * 100) / 100;

    const poId = uuidv4();
    const poNumber = await generateCPONumber();
    const status = auto_approve ? 'APPROVED' : 'DRAFT';

    await dbClient.beginTransaction();

    await dbClient.query(
      `INSERT INTO chemical_purchase_orders (
         id, po_number, supplier_id, po_date, expected_delivery_date, status,
         total_amount, notes, created_by_user_id, approved_by_user_id, approved_at, idempotency_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        poId, poNumber, supplier_id, po_date, expected_delivery_date || null, status,
        totalAmount, notes || null, req.user?.id, auto_approve ? req.user?.id : null,
        auto_approve ? new Date().toISOString() : null, finalIdempotencyKey
      ]
    );

    for (const vItem of validatedItems) {
      await dbClient.query(
        `INSERT INTO chemical_po_items (
           id, chemical_po_id, chemical_id, ordered_qty, received_qty, rate_per_unit, line_amount
         ) VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [vItem.id, poId, vItem.chemical_id, vItem.ordered_qty, vItem.rate_per_unit, vItem.line_amount]
      );
    }

    await dbClient.commit();

    // IMPORTANT: Stock remains unchanged! No lots created, no stock movements created.
    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CHEMICAL_PO_CREATED',
      recordRef: `chemical_purchase_orders/${poId}`,
      changedValues: { po_number: poNumber, supplier_id, total_amount: totalAmount, status },
    });

    return res.status(201).json({
      id: poId,
      po_number: poNumber,
      status,
      total_amount: totalAmount,
      items_count: validatedItems.length
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/chemical-pos/:id/approve (Approve PO)
router.post('/:id/approve', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const poRes = await query('SELECT id, status, po_number FROM chemical_purchase_orders WHERE id = ?', [id]);
    if (poRes.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase Order not found' });
    }

    const po = poRes.rows[0];
    if (po.status !== 'DRAFT') {
      return res.status(400).json({ error: `Cannot approve PO in status ${po.status}` });
    }

    await query(
      `UPDATE chemical_purchase_orders SET 
         status = 'APPROVED', approved_by_user_id = ?, approved_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
      [req.user?.id, id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CHEMICAL_PO_APPROVED',
      recordRef: `chemical_purchase_orders/${id}`,
      reason: `PO ${po.po_number} approved`,
    });

    return res.json({ success: true, status: 'APPROVED' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/chemical-pos/:id/cancel (Cancel PO)
router.post('/:id/cancel', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { cancellation_reason } = req.body;

    if (!cancellation_reason || !cancellation_reason.trim()) {
      return res.status(400).json({ error: 'Cancellation reason is required' });
    }

    const poRes = await query('SELECT id, status, po_number FROM chemical_purchase_orders WHERE id = ?', [id]);
    if (poRes.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase Order not found' });
    }

    const po = poRes.rows[0];
    if (po.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Purchase Order is already cancelled' });
    }

    // Check if any receipts have occurred
    const receiptCheck = await query(
      `SELECT COALESCE(SUM(received_qty), 0) as total_received FROM chemical_po_items WHERE chemical_po_id = ?`,
      [id]
    );
    if (parseFloat(receiptCheck.rows[0]?.total_received || '0') > 0) {
      return res.status(400).json({
        error: 'Cannot cancel Purchase Order: Chemicals have already been received against this PO. Reverse the chemical receipts first.'
      });
    }

    await query(
      `UPDATE chemical_purchase_orders SET 
         status = 'CANCELLED', cancelled_by_user_id = ?, cancelled_at = datetime('now'), cancellation_reason = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [req.user?.id, cancellation_reason.trim(), id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CHEMICAL_PO_CANCELLED',
      recordRef: `chemical_purchase_orders/${id}`,
      reason: cancellation_reason.trim(),
    });

    return res.json({ success: true, status: 'CANCELLED' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
