import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Function to generate inward number format: INW-YYYYMMDD-XXXX
async function generateInwardNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `INW-${dateStr}-`;

  const result = await query(
    `SELECT inward_number FROM customer_parts_inward WHERE inward_number LIKE ? ORDER BY inward_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].inward_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// GET /api/customer-parts-inward (List all customer parts inward receipts)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customer_order_id, status } = req.query;
    let sql = `
      SELECT 
        cpi.*, co.order_number, co.customer_po_number,
        c.name as customer_name, c.code as customer_code,
        p.part_number, p.part_name, p.base_unit,
        u.name as received_by_name,
        COALESCE((
          SELECT SUM(allocated_qty) 
          FROM job_cards 
          WHERE customer_parts_inward_id = cpi.id AND status != 'CANCELLED'
        ), 0) as allocated_to_jobs_qty
      FROM customer_parts_inward cpi
      JOIN customer_orders co ON cpi.customer_order_id = co.id
      JOIN customer_order_items coi ON cpi.customer_order_item_id = coi.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      JOIN users u ON cpi.received_by_user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (customer_order_id) {
      sql += ' AND cpi.customer_order_id = ?';
      params.push(customer_order_id);
    }
    if (status) {
      sql += ' AND cpi.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY cpi.created_at DESC';

    const result = await query(sql, params);
    const rows = result.rows.map(r => {
      const accepted = parseFloat(r.accepted_qty);
      const allocated = parseFloat(r.allocated_to_jobs_qty || '0');
      const availableToAllocate = Math.max(0, Math.round((accepted - allocated) * 10000) / 10000);
      return {
        ...r,
        accepted_qty: accepted,
        rejected_qty: parseFloat(r.rejected_qty),
        allocated_to_jobs_qty: allocated,
        available_for_job_allocation: availableToAllocate
      };
    });

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/customer-parts-inward/pending-items (Confirmed order items awaiting inward)
router.get('/pending-items', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        coi.id as customer_order_item_id, coi.customer_order_id, coi.quantity as ordered_qty,
        coi.rate, coi.process_type,
        co.order_number, co.order_date, co.customer_po_number,
        c.id as customer_id, c.name as customer_name, c.code as customer_code,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        COALESCE((
          SELECT SUM(accepted_qty) 
          FROM customer_parts_inward 
          WHERE customer_order_item_id = coi.id AND status = 'RECEIVED'
        ), 0) as total_accepted_qty,
        COALESCE((
          SELECT SUM(rejected_qty) 
          FROM customer_parts_inward 
          WHERE customer_order_item_id = coi.id AND status = 'RECEIVED'
        ), 0) as total_rejected_qty
      FROM customer_order_items coi
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      WHERE co.status IN ('CONFIRMED', 'IN_PRODUCTION')
      ORDER BY co.order_date ASC, co.order_number ASC
    `;

    const result = await query(sql);
    const pendingItems = result.rows
      .map(r => {
        const ordered = parseFloat(r.ordered_qty);
        const accepted = parseFloat(r.total_accepted_qty);
        const rejected = parseFloat(r.total_rejected_qty);
        const pending = Math.max(0, Math.round((ordered - accepted - rejected) * 10000) / 10000);
        return {
          ...r,
          ordered_qty: ordered,
          total_accepted_qty: accepted,
          total_rejected_qty: rejected,
          pending_qty: pending
        };
      })
      .filter(item => item.pending_qty > 0);

    return res.json(pendingItems);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/customer-parts-inward/:id (Get detailed inward receipt with linked jobs)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT 
        cpi.*, co.order_number, co.customer_po_number, co.order_date,
        c.id as customer_id, c.name as customer_name, c.code as customer_code,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        coi.quantity as ordered_qty, coi.process_type,
        u.name as received_by_name,
        COALESCE((
          SELECT SUM(allocated_qty) 
          FROM job_cards 
          WHERE customer_parts_inward_id = cpi.id AND status != 'CANCELLED'
        ), 0) as allocated_to_jobs_qty
      FROM customer_parts_inward cpi
      JOIN customer_orders co ON cpi.customer_order_id = co.id
      JOIN customer_order_items coi ON cpi.customer_order_item_id = coi.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      JOIN users u ON cpi.received_by_user_id = u.id
      WHERE cpi.id = ?
    `;

    const result = await query(sql, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Parts inward receipt not found' });
    }

    const inward = result.rows[0];
    const accepted = parseFloat(inward.accepted_qty);
    const allocated = parseFloat(inward.allocated_to_jobs_qty || '0');
    inward.accepted_qty = accepted;
    inward.rejected_qty = parseFloat(inward.rejected_qty);
    inward.allocated_to_jobs_qty = allocated;
    inward.available_for_job_allocation = Math.max(0, Math.round((accepted - allocated) * 10000) / 10000);

    // Also fetch linked job cards
    const jobsRes = await query(
      `SELECT jc.*, u.name as released_by_name 
       FROM job_cards jc 
       JOIN users u ON jc.released_by_user_id = u.id 
       WHERE jc.customer_parts_inward_id = ? 
       ORDER BY jc.created_at ASC`,
      [id]
    );
    inward.job_cards = jobsRes.rows.map(j => ({
      ...j,
      allocated_qty: parseFloat(j.allocated_qty)
    }));

    return res.json(inward);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/customer-parts-inward (Record customer parts inward against order item)
router.post('/', authenticateToken, requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const {
      customer_order_item_id, challan_number, challan_date, received_date,
      accepted_qty, rejected_qty, rejection_reason, notes, idempotency_key
    } = req.body;

    const idempotencyKeyHeader = req.headers['x-idempotency-key'] as string | undefined;
    const finalIdempotencyKey = idempotency_key || idempotencyKeyHeader || null;

    if (!customer_order_item_id || !challan_number || !challan_date || !received_date) {
      return res.status(400).json({ error: 'Order item, challan number, challan date, and received date are required' });
    }

    const accepted = parseFloat(accepted_qty ?? '0');
    const rejected = parseFloat(rejected_qty ?? '0');

    if (isNaN(accepted) || isNaN(rejected) || accepted < 0 || rejected < 0) {
      return res.status(400).json({ error: 'Accepted and rejected quantities must be non-negative numbers' });
    }

    if (accepted === 0 && rejected === 0) {
      return res.status(400).json({ error: 'At least one of accepted quantity or rejected quantity must be greater than zero' });
    }

    if (rejected > 0 && (!rejection_reason || !rejection_reason.trim())) {
      return res.status(400).json({ error: 'Rejection reason is required when rejected quantity is greater than zero' });
    }

    // Idempotency check to prevent duplicate submission on double click or retry
    if (finalIdempotencyKey) {
      const idempRes = await query(
        'SELECT id, inward_number, accepted_qty, rejected_qty FROM customer_parts_inward WHERE idempotency_key = ?',
        [finalIdempotencyKey]
      );
      if (idempRes.rows.length > 0) {
        const existing = idempRes.rows[0];
        return res.json({
          id: existing.id,
          inward_number: existing.inward_number,
          accepted_qty: parseFloat(existing.accepted_qty),
          rejected_qty: parseFloat(existing.rejected_qty),
          message: 'Duplicate inward submission blocked by idempotency key. Original record returned.'
        });
      }
    }

    await dbClient.beginTransaction();

    // Verify order item and order status
    const itemRes = await dbClient.query(
      `SELECT 
         coi.id, coi.customer_order_id, coi.quantity as ordered_qty,
         co.status as order_status, co.order_number
       FROM customer_order_items coi
       JOIN customer_orders co ON coi.customer_order_id = co.id
       WHERE coi.id = ?`,
      [customer_order_item_id]
    );

    if (itemRes.rows.length === 0) {
      throw new Error('Customer order item not found');
    }

    const item = itemRes.rows[0];
    if (!['CONFIRMED', 'IN_PRODUCTION'].includes(item.order_status)) {
      throw new Error(`Cannot receive parts against order ${item.order_number} in status ${item.order_status}. Order must be CONFIRMED.`);
    }

    const orderedQty = parseFloat(item.ordered_qty);

    // Calculate current accepted and rejected from non-cancelled inwards
    const inwSummaryRes = await dbClient.query(
      `SELECT 
         COALESCE(SUM(accepted_qty), 0) as prev_accepted,
         COALESCE(SUM(rejected_qty), 0) as prev_rejected
       FROM customer_parts_inward 
       WHERE customer_order_item_id = ? AND status = 'RECEIVED'`,
      [customer_order_item_id]
    );

    const prevAccepted = parseFloat(inwSummaryRes.rows[0]?.prev_accepted || '0');
    const prevRejected = parseFloat(inwSummaryRes.rows[0]?.prev_rejected || '0');
    const pendingQty = Math.round((orderedQty - prevAccepted - prevRejected) * 10000) / 10000;

    const totalThisInward = Math.round((accepted + rejected) * 10000) / 10000;

    // Strict Rule: Never allow Accepted + Rejected > Ordered or greater than pending
    if (totalThisInward > pendingQty) {
      throw new Error(
        `Excess inward quantity rejected: Total inward (${totalThisInward}) exceeds pending quantity (${pendingQty}) for ordered quantity (${orderedQty}). Previously received: ${prevAccepted} accepted, ${prevRejected} rejected.`
      );
    }

    const inwardId = uuidv4();
    const inwardNumber = await generateInwardNumber();

    await dbClient.query(
      `INSERT INTO customer_parts_inward (
         id, inward_number, customer_order_id, customer_order_item_id, challan_number,
         challan_date, received_date, accepted_qty, rejected_qty, rejection_reason,
         notes, received_by_user_id, status, idempotency_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?)`,
      [
        inwardId, inwardNumber, item.customer_order_id, customer_order_item_id, challan_number.trim(),
        challan_date, received_date, accepted, rejected, rejection_reason ? rejection_reason.trim() : null,
        notes || null, req.user?.id, finalIdempotencyKey
      ]
    );

    // Update order status to IN_PRODUCTION
    await dbClient.query(
      `UPDATE customer_orders SET status = 'IN_PRODUCTION', updated_at = datetime('now') WHERE id = ?`,
      [item.customer_order_id]
    );

    await dbClient.commit();

    const remainingPendingAfter = Math.max(0, Math.round((pendingQty - totalThisInward) * 10000) / 10000);

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PARTS_INWARD_RECEIVED',
      recordRef: `customer_parts_inward/${inwardId}`,
      changedValues: {
        inward_number: inwardNumber,
        customer_order_item_id,
        accepted_qty: accepted,
        rejected_qty: rejected,
        remaining_pending: remainingPendingAfter
      },
    });

    return res.status(201).json({
      id: inwardId,
      inward_number: inwardNumber,
      accepted_qty: accepted,
      rejected_qty: rejected,
      remaining_pending_qty: remainingPendingAfter,
      status: 'RECEIVED'
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/customer-parts-inward/:id/cancel (Cancel inward receipt - requires reason and checks active job cards)
router.post('/:id/cancel', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { cancellation_reason } = req.body;

    if (!cancellation_reason || !cancellation_reason.trim()) {
      return res.status(400).json({ error: 'Cancellation reason is required' });
    }

    const inwRes = await query('SELECT * FROM customer_parts_inward WHERE id = ?', [id]);
    if (inwRes.rows.length === 0) {
      return res.status(404).json({ error: 'Inward receipt not found' });
    }

    const inward = inwRes.rows[0];
    if (inward.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Inward receipt is already cancelled' });
    }

    // Check if any accepted quantity has been allocated to active job cards
    const jobCheck = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(allocated_qty), 0) as allocated 
       FROM job_cards 
       WHERE customer_parts_inward_id = ? AND status != 'CANCELLED'`,
      [id]
    );

    const activeAllocated = parseFloat(jobCheck.rows[0]?.allocated || '0');
    if (activeAllocated > 0) {
      return res.status(400).json({
        error: `Cannot cancel inward receipt: ${activeAllocated} units have already been allocated to active Job Cards. Cancel those Job Cards first.`
      });
    }

    await query(
      `UPDATE customer_parts_inward SET 
         status = 'CANCELLED', cancelled_at = datetime('now'), cancelled_by_user_id = ?, cancellation_reason = ?
       WHERE id = ?`,
      [req.user?.id, cancellation_reason.trim(), id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PARTS_INWARD_CANCELLED',
      recordRef: `customer_parts_inward/${id}`,
      reason: cancellation_reason.trim(),
    });

    return res.json({ success: true, status: 'CANCELLED' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
