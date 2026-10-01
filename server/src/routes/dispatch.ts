import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Function to generate concurrency-safe Dispatch Number format: DSP-YYYYMMDD-XXXX
async function generateDispatchNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `DSP-${dateStr}-`;

  const result = await query(
    `SELECT dispatch_number FROM dispatches WHERE dispatch_number LIKE ? ORDER BY dispatch_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].dispatch_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// 1. GET /api/dispatch/pending (Dispatchable Queue: QC PASS accepted items with remaining dispatch balance)
router.get('/pending', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        qc.id as qc_inspection_id,
        qc.qc_number,
        qc.inspection_date as qc_date,
        qc.inspected_qty as qc_inspected_qty,
        qc.accepted_qty as qc_accepted_qty,
        qc.rejected_qty as qc_rejected_qty,
        qc.status as qc_status,
        pe.id as production_execution_id,
        pe.production_number,
        pe.production_date,
        pe.processed_qty as production_processed_qty,
        pe.status as production_status,
        jc.id as job_card_id,
        jc.job_card_number,
        jc.plating_process,
        t.code as tank_code,
        t.display_name as tank_name,
        p.id as part_id,
        p.part_number,
        p.part_name,
        p.base_unit,
        c.id as customer_id,
        c.name as customer_name,
        c.code as customer_code,
        COALESCE((
          SELECT SUM(dispatched_qty)
          FROM dispatches
          WHERE qc_inspection_id = qc.id AND status != 'CANCELLED'
        ), 0) as already_dispatched_qty
      FROM qc_inspections qc
      JOIN production_executions pe ON qc.production_execution_id = pe.id
      JOIN job_cards jc ON qc.job_card_id = jc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      JOIN tanks t ON pe.tank_id = t.id
      WHERE pe.status = 'COMPLETED'
        AND qc.status = 'PASS'
        AND qc.accepted_qty > 0
      ORDER BY qc.created_at DESC
    `;

    const result = await query(sql);

    // Calculate live remaining dispatchable quantity and filter for available > 0
    const queue = result.rows
      .map(row => {
        const accepted = parseFloat(row.qc_accepted_qty || '0');
        const alreadyDispatched = parseFloat(row.already_dispatched_qty || '0');
        const remaining = Math.max(0, accepted - alreadyDispatched);
        return {
          ...row,
          qc_accepted_qty: accepted,
          already_dispatched_qty: alreadyDispatched,
          remaining_dispatchable_qty: remaining
        };
      })
      .filter(row => row.remaining_dispatchable_qty > 0);

    return res.json(queue);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/dispatch (Dispatch Register)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, customer_id, job_card_id, production_execution_id, qc_inspection_id, from_date, to_date } = req.query;

    let sql = `
      SELECT 
        d.*,
        c.name as customer_name, c.code as customer_code,
        jc.job_card_number, jc.plating_process,
        pe.production_number, pe.production_date,
        qc.qc_number, qc.accepted_qty as qc_accepted_qty,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        t.code as tank_code, t.display_name as tank_name,
        u.name as dispatched_by_name, u.email as dispatched_by_email,
        canc_u.name as cancelled_by_name
      FROM dispatches d
      JOIN customers c ON d.customer_id = c.id
      JOIN job_cards jc ON d.job_card_id = jc.id
      JOIN production_executions pe ON d.production_execution_id = pe.id
      JOIN qc_inspections qc ON d.qc_inspection_id = qc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN parts p ON coi.part_id = p.id
      JOIN tanks t ON pe.tank_id = t.id
      JOIN users u ON d.dispatched_by_user_id = u.id
      LEFT JOIN users canc_u ON d.cancelled_by_user_id = canc_u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND d.status = ?';
      params.push(status);
    }
    if (customer_id) {
      sql += ' AND d.customer_id = ?';
      params.push(customer_id);
    }
    if (job_card_id) {
      sql += ' AND d.job_card_id = ?';
      params.push(job_card_id);
    }
    if (production_execution_id) {
      sql += ' AND d.production_execution_id = ?';
      params.push(production_execution_id);
    }
    if (qc_inspection_id) {
      sql += ' AND d.qc_inspection_id = ?';
      params.push(qc_inspection_id);
    }
    if (from_date) {
      sql += ' AND d.dispatch_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      sql += ' AND d.dispatch_date <= ?';
      params.push(to_date);
    }

    sql += ' ORDER BY d.created_at DESC';

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/dispatch/:id (Dispatch Detail with Reconciliation)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT 
        d.*,
        c.name as customer_name, c.code as customer_code, c.address as customer_address,
        jc.job_card_number, jc.plating_process, jc.target_thickness_microns,
        pe.production_number, pe.production_date, pe.processed_qty as production_processed_qty,
        qc.qc_number, qc.inspection_date as qc_date, qc.accepted_qty as qc_accepted_qty,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        t.code as tank_code, t.display_name as tank_name,
        u.name as dispatched_by_name, u.email as dispatched_by_email,
        canc_u.name as cancelled_by_name
      FROM dispatches d
      JOIN customers c ON d.customer_id = c.id
      JOIN job_cards jc ON d.job_card_id = jc.id
      JOIN production_executions pe ON d.production_execution_id = pe.id
      JOIN qc_inspections qc ON d.qc_inspection_id = qc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN parts p ON coi.part_id = p.id
      JOIN tanks t ON pe.tank_id = t.id
      JOIN users u ON d.dispatched_by_user_id = u.id
      LEFT JOIN users canc_u ON d.cancelled_by_user_id = canc_u.id
      WHERE d.id = ?
    `;

    const result = await query(sql, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dispatch record not found' });
    }

    const dispatch = result.rows[0];

    // Reconcile quantities
    const totalDispatchedRes = await query(
      `SELECT COALESCE(SUM(dispatched_qty), 0) as total_dispatched
       FROM dispatches
       WHERE qc_inspection_id = ? AND status != 'CANCELLED'`,
      [dispatch.qc_inspection_id]
    );

    const qcAccepted = parseFloat(dispatch.qc_accepted_qty || '0');
    const totalDispatched = parseFloat(totalDispatchedRes.rows[0]?.total_dispatched || '0');
    const currentQty = parseFloat(dispatch.dispatched_qty || '0');
    const remaining = Math.max(0, qcAccepted - totalDispatched);

    return res.json({
      ...dispatch,
      qc_accepted_qty: qcAccepted,
      total_dispatched_qty: totalDispatched,
      current_dispatch_qty: currentQty,
      remaining_dispatchable_qty: remaining
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. POST /api/dispatch (Create Dispatch)
router.post(
  '/',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        job_card_id,
        production_execution_id,
        qc_inspection_id,
        dispatched_qty,
        dispatch_date,
        vehicle_number,
        transporter_name,
        delivery_address,
        challan_number,
        remarks
      } = req.body;

      const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key;

      // Idempotency check
      if (idempotencyKey) {
        const existing = await query('SELECT * FROM dispatches WHERE idempotency_key = ?', [idempotencyKey]);
        if (existing.rows.length > 0) {
          return res.status(200).json(existing.rows[0]);
        }
      }

      // Quantity validation
      const numQty = parseFloat(dispatched_qty);
      if (isNaN(numQty) || numQty <= 0) {
        return res.status(400).json({ error: 'Dispatched quantity must be a positive number greater than 0.' });
      }

      if (!job_card_id || !production_execution_id || !qc_inspection_id) {
        return res.status(400).json({ error: 'Job Card, Production Execution, and QC Inspection IDs are required.' });
      }

      // Fetch QC Inspection
      const qcRes = await query('SELECT * FROM qc_inspections WHERE id = ?', [qc_inspection_id]);
      if (qcRes.rows.length === 0) {
        return res.status(404).json({ error: 'QC Inspection record not found.' });
      }
      const qc = qcRes.rows[0];

      // Fetch Production Execution
      const prodRes = await query('SELECT * FROM production_executions WHERE id = ?', [production_execution_id]);
      if (prodRes.rows.length === 0) {
        return res.status(404).json({ error: 'Production execution record not found.' });
      }
      const prod = prodRes.rows[0];

      // Fetch Job Card and Customer
      const jcRes = await query(
        `SELECT jc.*, co.customer_id
         FROM job_cards jc
         JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
         JOIN customer_orders co ON coi.customer_order_id = co.id
         WHERE jc.id = ?`,
        [job_card_id]
      );
      if (jcRes.rows.length === 0) {
        return res.status(404).json({ error: 'Job Card record not found.' });
      }
      const jc = jcRes.rows[0];

      // Rule A: Production execution must be COMPLETED
      if (prod.status !== 'COMPLETED') {
        return res.status(400).json({
          error: `Production execution must be COMPLETED to dispatch. Current status is ${prod.status}.`
        });
      }

      // Rule B: QC inspection must be PASS
      if (qc.status !== 'PASS') {
        return res.status(400).json({
          error: `Only QC-approved parts (status PASS) can be dispatched. Inspection ${qc.qc_number} has status ${qc.status}.`
        });
      }

      // Rule C: QC must belong to requested production execution
      if (qc.production_execution_id !== production_execution_id) {
        return res.status(400).json({
          error: 'QC Inspection does not belong to the specified production execution.'
        });
      }

      // Rule D: QC must belong to requested Job Card
      if (qc.job_card_id !== job_card_id) {
        return res.status(400).json({
          error: 'QC Inspection does not belong to the specified Job Card.'
        });
      }

      // Rule E: Customer linkage
      const customerId = jc.customer_id;
      if (!customerId) {
        return res.status(400).json({ error: 'Unable to resolve linked customer for this dispatch.' });
      }

      // Rule F: Check available dispatchable quantity
      const existingDispRes = await query(
        `SELECT COALESCE(SUM(dispatched_qty), 0) as already_dispatched
         FROM dispatches
         WHERE qc_inspection_id = ? AND status != 'CANCELLED'`,
        [qc_inspection_id]
      );

      const qcAccepted = parseFloat(qc.accepted_qty || '0');
      const alreadyDispatched = parseFloat(existingDispRes.rows[0]?.already_dispatched || '0');
      const available = Math.max(0, qcAccepted - alreadyDispatched);

      if (numQty > available) {
        return res.status(400).json({
          error: `Requested dispatch quantity (${numQty}) exceeds available dispatchable quantity (${available} pcs). QC Accepted: ${qcAccepted}, Already Dispatched: ${alreadyDispatched}.`
        });
      }

      // Generate dispatch number
      const dispatchId = uuidv4();
      const dispatchNumber = await generateDispatchNumber();
      const dispDate = dispatch_date || new Date().toISOString().slice(0, 10);

      await query(
        `INSERT INTO dispatches (
          id, dispatch_number, job_card_id, production_execution_id, qc_inspection_id,
          customer_id, dispatch_date, dispatched_qty, vehicle_number, transporter_name,
          delivery_address, challan_number, remarks, status, dispatched_by_user_id,
          idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISPATCHED', ?, ?, datetime('now'), datetime('now'))`,
        [
          dispatchId,
          dispatchNumber,
          job_card_id,
          production_execution_id,
          qc_inspection_id,
          customerId,
          dispDate,
          numQty,
          vehicle_number || null,
          transporter_name || null,
          delivery_address || null,
          challan_number || null,
          remarks || null,
          req.user!.id,
          idempotencyKey || null
        ]
      );

      // Audit Log
      await logAuditEvent({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: 'DISPATCH_CREATED',
        recordRef: dispatchId,
        changedValues: {
          dispatch_number: dispatchNumber,
          customer_id: customerId,
          job_card_id,
          production_number: prod.production_number,
          qc_number: qc.qc_number,
          dispatched_qty: numQty
        },
        reason: `Dispatch created for Job Card ${jc.job_card_number} and QC ${qc.qc_number}`
      });

      const inserted = await query('SELECT * FROM dispatches WHERE id = ?', [dispatchId]);
      return res.status(201).json(inserted.rows[0]);
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed: dispatches.idempotency_key')) {
        const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key;
        const existing = await query('SELECT * FROM dispatches WHERE idempotency_key = ?', [idempotencyKey]);
        if (existing.rows.length > 0) {
          return res.status(200).json(existing.rows[0]);
        }
      }
      return res.status(500).json({ error: err.message });
    }
  }
);

// 5. POST /api/dispatch/:id/cancel (Non-destructive Cancellation: Admin/SuperAdmin only)
router.post(
  '/:id/cancel',
  authenticateToken,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { cancellation_reason } = req.body;

      if (!cancellation_reason || !cancellation_reason.trim()) {
        return res.status(400).json({ error: 'Cancellation reason is mandatory for dispatch reversal.' });
      }

      const dispRes = await query('SELECT * FROM dispatches WHERE id = ?', [id]);
      if (dispRes.rows.length === 0) {
        return res.status(404).json({ error: 'Dispatch record not found.' });
      }

      const dispatch = dispRes.rows[0];

      if (dispatch.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Dispatch record is already cancelled.' });
      }

      await query(
        `UPDATE dispatches
         SET status = 'CANCELLED',
             cancelled_at = datetime('now'),
             cancelled_by_user_id = ?,
             cancellation_reason = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
        [req.user!.id, cancellation_reason.trim(), id]
      );

      // Audit Log
      await logAuditEvent({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: 'DISPATCH_CANCELLED',
        recordRef: id,
        changedValues: {
          dispatch_number: dispatch.dispatch_number,
          status: 'CANCELLED',
          restored_qty: dispatch.dispatched_qty
        },
        reason: cancellation_reason.trim()
      });

      const updated = await query('SELECT * FROM dispatches WHERE id = ?', [id]);
      return res.json(updated.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
