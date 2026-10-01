import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Function to generate job card number format: JC-YYYYMMDD-XXXX
async function generateJobCardNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `JC-${dateStr}-`;

  const result = await query(
    `SELECT job_card_number FROM job_cards WHERE job_card_number LIKE ? ORDER BY job_card_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].job_card_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// GET /api/job-cards (List all job cards)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, tank_id } = req.query;
    let sql = `
      SELECT 
        jc.*, cpi.inward_number, cpi.challan_number,
        co.order_number, co.customer_po_number,
        c.name as customer_name, c.code as customer_code,
        p.part_number, p.part_name, p.base_unit,
        t.code as tank_code, t.display_name as tank_name,
        u.name as released_by_name
      FROM job_cards jc
      JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      JOIN users u ON jc.released_by_user_id = u.id
      LEFT JOIN tanks t ON jc.tank_id = t.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND jc.status = ?';
      params.push(status);
    }
    if (tank_id) {
      sql += ' AND jc.tank_id = ?';
      params.push(tank_id);
    }

    sql += ' ORDER BY jc.created_at DESC';

    const result = await query(sql, params);
    const rows = result.rows.map(r => ({
      ...r,
      allocated_qty: parseFloat(r.allocated_qty),
      target_thickness_microns: r.target_thickness_microns != null ? parseFloat(r.target_thickness_microns) : null
    }));

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/job-cards/available-inwards (Inward receipts with available unallocated quantity)
router.get('/available-inwards', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        cpi.id as customer_parts_inward_id, cpi.inward_number, cpi.challan_number, cpi.received_date,
        cpi.accepted_qty, cpi.rejected_qty,
        coi.id as customer_order_item_id, coi.process_type,
        co.order_number, co.customer_po_number,
        c.name as customer_name, c.code as customer_code,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        COALESCE((
          SELECT SUM(allocated_qty) 
          FROM job_cards 
          WHERE customer_parts_inward_id = cpi.id AND status != 'CANCELLED'
        ), 0) as total_allocated_qty
      FROM customer_parts_inward cpi
      JOIN customer_order_items coi ON cpi.customer_order_item_id = coi.id
      JOIN customer_orders co ON cpi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      WHERE cpi.status = 'RECEIVED'
      ORDER BY cpi.received_date ASC, cpi.inward_number ASC
    `;

    const result = await query(sql);
    const availableInwards = result.rows
      .map(r => {
        const accepted = parseFloat(r.accepted_qty);
        const allocated = parseFloat(r.total_allocated_qty);
        const available = Math.max(0, Math.round((accepted - allocated) * 10000) / 10000);
        return {
          ...r,
          accepted_qty: accepted,
          rejected_qty: parseFloat(r.rejected_qty),
          total_allocated_qty: allocated,
          available_to_allocate: available
        };
      })
      .filter(inw => inw.available_to_allocate > 0);

    return res.json(availableInwards);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/job-cards/:id (Detailed job card with upstream inward and downstream production)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT 
        jc.*,
        cpi.inward_number, cpi.challan_number, cpi.challan_date, cpi.received_date, cpi.accepted_qty as inward_accepted_qty,
        co.id as customer_order_id, co.order_number, co.customer_po_number, co.order_date,
        c.id as customer_id, c.name as customer_name, c.code as customer_code,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        t.code as tank_code, t.display_name as tank_name,
        u.name as released_by_name
      FROM job_cards jc
      JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      JOIN users u ON jc.released_by_user_id = u.id
      LEFT JOIN tanks t ON jc.tank_id = t.id
      WHERE jc.id = ?
    `;

    const result = await query(sql, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job Card not found' });
    }

    const job = result.rows[0];
    job.allocated_qty = parseFloat(job.allocated_qty);
    job.target_thickness_microns = job.target_thickness_microns != null ? parseFloat(job.target_thickness_microns) : null;

    // Fetch downstream production executions
    const prodRes = await query(
      `SELECT pe.*, u.name as operator_name 
       FROM production_executions pe 
       JOIN users u ON pe.operator_user_id = u.id 
       WHERE pe.job_card_id = ? 
       ORDER BY pe.created_at ASC`,
      [id]
    );
    job.production_executions = prodRes.rows.map(p => ({
      ...p,
      planned_qty: parseFloat(p.planned_qty),
      processed_qty: parseFloat(p.processed_qty),
      rejected_qty: parseFloat(p.rejected_qty)
    }));

    return res.json(job);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/job-cards (Create & Release Job Card with quantity allocation)
router.post('/', authenticateToken, requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const {
      customer_parts_inward_id, allocated_qty, tank_id,
      plating_process, target_thickness_microns, priority, notes, idempotency_key
    } = req.body;

    const idempotencyKeyHeader = req.headers['x-idempotency-key'] as string | undefined;
    const finalIdempotencyKey = idempotency_key || idempotencyKeyHeader || null;

    if (!customer_parts_inward_id || allocated_qty == null) {
      return res.status(400).json({ error: 'Parts inward selection and allocated quantity are required' });
    }

    const allocQty = parseFloat(allocated_qty);
    if (isNaN(allocQty) || allocQty <= 0) {
      return res.status(400).json({ error: 'Allocated quantity must be greater than zero' });
    }

    // Idempotency check
    if (finalIdempotencyKey) {
      const idempRes = await query(
        'SELECT id, job_card_number, allocated_qty FROM job_cards WHERE idempotency_key = ?',
        [finalIdempotencyKey]
      );
      if (idempRes.rows.length > 0) {
        const existing = idempRes.rows[0];
        return res.json({
          id: existing.id,
          job_card_number: existing.job_card_number,
          allocated_qty: parseFloat(existing.allocated_qty),
          message: 'Duplicate job card submission blocked by idempotency key. Original job card returned.'
        });
      }
    }

    await dbClient.beginTransaction();

    // Verify inward record existence and eligible accepted stock
    const inwRes = await dbClient.query(
      `SELECT 
         cpi.id, cpi.customer_order_item_id, cpi.accepted_qty, cpi.status,
         coi.process_type as item_process_type
       FROM customer_parts_inward cpi
       JOIN customer_order_items coi ON cpi.customer_order_item_id = coi.id
       WHERE cpi.id = ?`,
      [customer_parts_inward_id]
    );

    if (inwRes.rows.length === 0) {
      throw new Error('Customer parts inward record not found');
    }

    const inward = inwRes.rows[0];
    if (inward.status !== 'RECEIVED') {
      throw new Error(`Cannot allocate from inward in status ${inward.status}`);
    }

    const acceptedQty = parseFloat(inward.accepted_qty);

    // Calculate sum of already allocated quantity from active non-cancelled job cards
    const allocSumRes = await dbClient.query(
      `SELECT COALESCE(SUM(allocated_qty), 0) as total_allocated 
       FROM job_cards 
       WHERE customer_parts_inward_id = ? AND status != 'CANCELLED'`,
      [customer_parts_inward_id]
    );

    const prevAllocated = parseFloat(allocSumRes.rows[0]?.total_allocated || '0');
    const availableQty = Math.round((acceptedQty - prevAllocated) * 10000) / 10000;

    // Strict Rule: Job quantity cannot exceed available inward quantity
    if (allocQty > availableQty) {
      throw new Error(
        `Excess allocation rejected: Requested quantity (${allocQty}) exceeds available inward balance (${availableQty}). Accepted inward: ${acceptedQty}, already allocated: ${prevAllocated}.`
      );
    }

    const jobCardId = uuidv4();
    const jobCardNumber = await generateJobCardNumber();
    const processToUse = plating_process || inward.item_process_type || 'Plating';

    await dbClient.query(
      `INSERT INTO job_cards (
         id, job_card_number, customer_parts_inward_id, customer_order_item_id, allocated_qty,
         tank_id, plating_process, target_thickness_microns, priority, status,
         released_by_user_id, released_at, idempotency_key, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RELEASED', ?, datetime('now'), ?, ?)`,
      [
        jobCardId, jobCardNumber, customer_parts_inward_id, inward.customer_order_item_id, allocQty,
        tank_id || null, processToUse, target_thickness_microns || null, priority || 'NORMAL',
        req.user?.id, finalIdempotencyKey, notes || null
      ]
    );

    await dbClient.commit();

    const remainingAvailableAfter = Math.max(0, Math.round((availableQty - allocQty) * 10000) / 10000);

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'JOB_CARD_RELEASED',
      recordRef: `job_cards/${jobCardId}`,
      changedValues: {
        job_card_number: jobCardNumber,
        allocated_qty: allocQty,
        remaining_available_inward: remainingAvailableAfter
      },
    });

    return res.status(201).json({
      id: jobCardId,
      job_card_number: jobCardNumber,
      allocated_qty: allocQty,
      remaining_available_inward: remainingAvailableAfter,
      status: 'RELEASED'
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/job-cards/:id/cancel (Cancel job card - restores available inward quantity)
router.post('/:id/cancel', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { cancellation_reason } = req.body;

    if (!cancellation_reason || !cancellation_reason.trim()) {
      return res.status(400).json({ error: 'Cancellation reason is required' });
    }

    const jobRes = await query('SELECT * FROM job_cards WHERE id = ?', [id]);
    if (jobRes.rows.length === 0) {
      return res.status(404).json({ error: 'Job Card not found' });
    }

    const job = jobRes.rows[0];
    if (job.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Job Card is already cancelled' });
    }

    await query(
      `UPDATE job_cards SET 
         status = 'CANCELLED', cancelled_at = datetime('now'), cancelled_by_user_id = ?, cancellation_reason = ?
       WHERE id = ?`,
      [req.user?.id, cancellation_reason.trim(), id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'JOB_CARD_CANCELLED',
      recordRef: `job_cards/${id}`,
      reason: cancellation_reason.trim(),
    });

    return res.json({ success: true, status: 'CANCELLED' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
