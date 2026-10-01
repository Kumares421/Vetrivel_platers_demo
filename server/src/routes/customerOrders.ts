import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Function to generate order number format: CO-YYYYMMDD-XXXX
async function generateOrderNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `CO-${dateStr}-`;

  const result = await query(
    `SELECT order_number FROM customer_orders WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].order_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// GET /api/customer-orders (List orders with customer name, items count, inward progress)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, customer_id } = req.query;
    let sql = `
      SELECT 
        co.*, c.name as customer_name, c.code as customer_code,
        u.name as created_by_name,
        (SELECT COUNT(*) FROM customer_order_items WHERE customer_order_id = co.id) as items_count,
        (SELECT COALESCE(SUM(accepted_qty), 0) FROM customer_parts_inward WHERE customer_order_id = co.id AND status = 'RECEIVED') as total_inward_accepted_qty,
        (SELECT COALESCE(SUM(rejected_qty), 0) FROM customer_parts_inward WHERE customer_order_id = co.id AND status = 'RECEIVED') as total_inward_rejected_qty
      FROM customer_orders co
      JOIN customers c ON co.customer_id = c.id
      JOIN users u ON co.created_by_user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND co.status = ?';
      params.push(status);
    }
    if (customer_id) {
      sql += ' AND co.customer_id = ?';
      params.push(customer_id);
    }

    sql += ' ORDER BY co.created_at DESC';

    const result = await query(sql, params);
    const rows = result.rows.map(r => {
      const totalQty = parseFloat(r.total_quantity || '0');
      const accepted = parseFloat(r.total_inward_accepted_qty || '0');
      const rejected = parseFloat(r.total_inward_rejected_qty || '0');
      const pending = Math.max(0, Math.round((totalQty - accepted - rejected) * 10000) / 10000);
      return {
        ...r,
        total_quantity: totalQty,
        total_amount: parseFloat(r.total_amount || '0'),
        total_inward_accepted_qty: accepted,
        total_inward_rejected_qty: rejected,
        total_pending_qty: pending
      };
    });

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/customer-orders/:id (Detailed order with items & inward history)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orderRes = await query(
      `SELECT 
         co.*, c.name as customer_name, c.code as customer_code, c.phone, c.email as customer_email,
         u.name as created_by_name, cu.name as confirmed_by_name
       FROM customer_orders co
       JOIN customers c ON co.customer_id = c.id
       JOIN users u ON co.created_by_user_id = u.id
       LEFT JOIN users cu ON co.confirmed_by_user_id = cu.id
       WHERE co.id = ?`,
      [req.params.id]
    );

    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer order not found' });
    }

    const order = orderRes.rows[0];

    // Fetch items with part details and inward progress
    const itemsRes = await query(
      `SELECT 
         coi.*, p.part_number, p.part_name, p.base_unit,
         COALESCE((
           SELECT SUM(accepted_qty) 
           FROM customer_parts_inward 
           WHERE customer_order_item_id = coi.id AND status = 'RECEIVED'
         ), 0) as accepted_qty,
         COALESCE((
           SELECT SUM(rejected_qty) 
           FROM customer_parts_inward 
           WHERE customer_order_item_id = coi.id AND status = 'RECEIVED'
         ), 0) as rejected_qty
       FROM customer_order_items coi
       JOIN parts p ON coi.part_id = p.id
       WHERE coi.customer_order_id = ?
       ORDER BY coi.created_at ASC`,
      [req.params.id]
    );

    const items = itemsRes.rows.map(item => {
      const qty = parseFloat(item.quantity);
      const rate = parseFloat(item.rate);
      const accepted = parseFloat(item.accepted_qty || '0');
      const rejected = parseFloat(item.rejected_qty || '0');
      const pending = Math.max(0, Math.round((qty - accepted - rejected) * 10000) / 10000);
      return {
        ...item,
        quantity: qty,
        rate,
        line_amount: parseFloat(item.line_amount),
        accepted_qty: accepted,
        rejected_qty: rejected,
        pending_qty: pending
      };
    });

    order.items = items;
    order.total_quantity = parseFloat(order.total_quantity);
    order.total_amount = parseFloat(order.total_amount);

    return res.json(order);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/customer-orders (Create new customer order with items)
router.post('/', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const {
      customer_id, customer_po_number, order_date, expected_delivery_date,
      notes, items, idempotency_key, auto_confirm
    } = req.body;

    const idempotencyKeyHeader = req.headers['x-idempotency-key'] as string | undefined;
    const finalIdempotencyKey = idempotency_key || idempotencyKeyHeader || null;

    if (!customer_id || !order_date || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Customer, order date, and at least one order item are required' });
    }

    // Verify customer exists and is active
    const custRes = await query('SELECT id, is_active FROM customers WHERE id = ?', [customer_id]);
    if (custRes.rows.length === 0 || !custRes.rows[0].is_active) {
      return res.status(400).json({ error: 'Selected customer does not exist or is inactive' });
    }

    // Idempotency check to prevent duplicate submission
    if (finalIdempotencyKey) {
      const idempRes = await query('SELECT id, order_number FROM customer_orders WHERE idempotency_key = ?', [finalIdempotencyKey]);
      if (idempRes.rows.length > 0) {
        const existing = idempRes.rows[0];
        return res.json({
          id: existing.id,
          order_number: existing.order_number,
          message: 'Duplicate submission prevented by idempotency key. Original order returned.'
        });
      }
    }

    // Validate items mathematically
    let totalQty = 0;
    let totalAmount = 0;
    const validatedItems: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.part_id || it.quantity == null || it.rate == null) {
        return res.status(400).json({ error: `Item #${i + 1}: Part, quantity, and rate are required` });
      }

      const qty = parseFloat(it.quantity);
      const rate = parseFloat(it.rate);

      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: `Item #${i + 1}: Quantity must be positive` });
      }
      if (isNaN(rate) || rate < 0) {
        return res.status(400).json({ error: `Item #${i + 1}: Rate must be non-negative` });
      }

      // Verify part exists and belongs to customer or is active
      const partRes = await query('SELECT id, process_type, is_active FROM parts WHERE id = ?', [it.part_id]);
      if (partRes.rows.length === 0 || !partRes.rows[0].is_active) {
        return res.status(400).json({ error: `Item #${i + 1}: Selected part is invalid or inactive` });
      }

      const lineAmount = Math.round(qty * rate * 100) / 100;
      totalQty += qty;
      totalAmount += lineAmount;

      validatedItems.push({
        id: uuidv4(),
        part_id: it.part_id,
        quantity: qty,
        rate,
        process_type: it.process_type || partRes.rows[0].process_type || 'Zinc Plating',
        line_amount: lineAmount,
        notes: it.notes || null
      });
    }

    totalAmount = Math.round(totalAmount * 100) / 100;
    totalQty = Math.round(totalQty * 10000) / 10000;

    const orderId = uuidv4();
    const orderNumber = await generateOrderNumber();
    const status = auto_confirm ? 'CONFIRMED' : 'DRAFT';

    await dbClient.beginTransaction();

    await dbClient.query(
      `INSERT INTO customer_orders (
         id, order_number, customer_id, customer_po_number, order_date, expected_delivery_date,
         status, total_quantity, total_amount, notes, created_by_user_id,
         confirmed_at, confirmed_by_user_id, idempotency_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId, orderNumber, customer_id, customer_po_number || null, order_date,
        expected_delivery_date || null, status, totalQty, totalAmount, notes || null,
        req.user?.id, auto_confirm ? new Date().toISOString() : null, auto_confirm ? req.user?.id : null,
        finalIdempotencyKey
      ]
    );

    for (const vItem of validatedItems) {
      await dbClient.query(
        `INSERT INTO customer_order_items (
           id, customer_order_id, part_id, quantity, rate, process_type, line_amount, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [vItem.id, orderId, vItem.part_id, vItem.quantity, vItem.rate, vItem.process_type, vItem.line_amount, vItem.notes]
      );
    }

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CUSTOMER_ORDER_CREATED',
      recordRef: `customer_orders/${orderId}`,
      changedValues: { order_number: orderNumber, customer_id, total_quantity: totalQty, total_amount: totalAmount, status },
    });

    return res.status(201).json({
      id: orderId,
      order_number: orderNumber,
      status,
      total_quantity: totalQty,
      total_amount: totalAmount,
      items_count: validatedItems.length
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/customer-orders/:id/confirm (Confirm order)
router.post('/:id/confirm', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const orderRes = await query('SELECT id, status, order_number FROM customer_orders WHERE id = ?', [id]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderRes.rows[0];
    if (order.status !== 'DRAFT') {
      return res.status(400).json({ error: `Cannot confirm order in ${order.status} status` });
    }

    await query(
      `UPDATE customer_orders SET 
         status = 'CONFIRMED', confirmed_at = datetime('now'), confirmed_by_user_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [req.user?.id, id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CUSTOMER_ORDER_CONFIRMED',
      recordRef: `customer_orders/${id}`,
      reason: `Order ${order.order_number} confirmed`,
    });

    return res.json({ success: true, status: 'CONFIRMED' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/customer-orders/:id/cancel (Cancel order with reason & check for received parts)
router.post('/:id/cancel', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { cancellation_reason } = req.body;

    if (!cancellation_reason || !cancellation_reason.trim()) {
      return res.status(400).json({ error: 'Cancellation reason is required' });
    }

    const orderRes = await query('SELECT id, status, order_number FROM customer_orders WHERE id = ?', [id]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderRes.rows[0];
    if (order.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Order is already cancelled' });
    }

    // Check if any parts have been received for this order
    const inwCheck = await query(
      `SELECT COUNT(*) as count FROM customer_parts_inward WHERE customer_order_id = ? AND status = 'RECEIVED'`,
      [id]
    );
    if (parseInt(inwCheck.rows[0]?.count || '0', 10) > 0) {
      return res.status(400).json({
        error: 'Cannot cancel order: Customer parts have already been received. Reverse or cancel the inward receipts first.'
      });
    }

    await query(
      `UPDATE customer_orders SET 
         status = 'CANCELLED', cancelled_at = datetime('now'), cancelled_by_user_id = ?, cancellation_reason = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [req.user?.id, cancellation_reason.trim(), id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CUSTOMER_ORDER_CANCELLED',
      recordRef: `customer_orders/${id}`,
      reason: cancellation_reason.trim(),
    });

    return res.json({ success: true, status: 'CANCELLED' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/customer-orders/:id (Update order details like PO number, expected delivery date, notes)
router.patch('/:id', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { customer_po_number, expected_delivery_date, notes } = req.body;

    const orderRes = await query('SELECT id, status, order_number FROM customer_orders WHERE id = ?', [id]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer order not found' });
    }

    const order = orderRes.rows[0];
    if (order.status === 'CANCELLED' || order.status === 'COMPLETED') {
      return res.status(400).json({ error: `Cannot modify customer order in ${order.status} status` });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (customer_po_number !== undefined) {
      updates.push('customer_po_number = ?');
      params.push(customer_po_number ? customer_po_number.trim() : null);
    }
    if (expected_delivery_date !== undefined) {
      updates.push('expected_delivery_date = ?');
      params.push(expected_delivery_date || null);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes ? notes.trim() : null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No update fields provided' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(id);

    await query(`UPDATE customer_orders SET ${updates.join(', ')} WHERE id = ?`, params);

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CUSTOMER_ORDER_UPDATED',
      recordRef: `customer_orders/${id}`,
      changedValues: { customer_po_number, expected_delivery_date, notes }
    });

    return res.json({ success: true, message: 'Order updated successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
