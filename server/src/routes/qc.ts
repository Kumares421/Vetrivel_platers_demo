import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Function to generate QC number format: QC-YYYYMMDD-XXXX
async function generateQcNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `QC-${dateStr}-`;

  const result = await query(
    `SELECT qc_number FROM qc_inspections WHERE qc_number LIKE ? ORDER BY qc_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].qc_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// 1. GET /api/qc (List all QC inspections with full joins)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, production_execution_id, job_card_id, visual_defect, from_date, to_date } = req.query;
    let sql = `
      SELECT 
        qc.*,
        pe.production_number, pe.production_date, pe.processed_qty as production_processed_qty,
        pe.rejected_qty as production_rejected_qty, pe.status as production_status,
        jc.job_card_number, jc.allocated_qty as job_card_allocated_qty,
        jc.plating_process, jc.priority, jc.target_thickness_microns,
        t.code as tank_code, t.display_name as tank_name,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        c.id as customer_id, c.name as customer_name, c.code as customer_code,
        co.order_number, co.customer_po_number,
        u.name as inspector_name, u.email as inspector_email
      FROM qc_inspections qc
      JOIN production_executions pe ON qc.production_execution_id = pe.id
      JOIN job_cards jc ON qc.job_card_id = jc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      JOIN tanks t ON pe.tank_id = t.id
      JOIN users u ON qc.inspector_user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND qc.status = ?';
      params.push(status);
    }
    if (production_execution_id) {
      sql += ' AND qc.production_execution_id = ?';
      params.push(production_execution_id);
    }
    if (job_card_id) {
      sql += ' AND qc.job_card_id = ?';
      params.push(job_card_id);
    }
    if (visual_defect) {
      sql += ' AND qc.visual_defect = ?';
      params.push(visual_defect);
    }
    if (from_date) {
      sql += ' AND qc.inspection_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      sql += ' AND qc.inspection_date <= ?';
      params.push(to_date);
    }

    sql += ' ORDER BY qc.created_at DESC';

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/qc/pending (Pending QC Queue: Completed Production Executions awaiting inspection)
router.get('/pending', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        pe.id as production_execution_id,
        pe.production_number,
        pe.production_date,
        pe.started_at,
        pe.completed_at,
        pe.planned_qty,
        pe.processed_qty,
        pe.rejected_qty as production_rejected_qty,
        pe.status as production_status,
        pe.notes as production_notes,
        jc.id as job_card_id,
        jc.job_card_number,
        jc.plating_process,
        jc.target_thickness_microns,
        jc.priority,
        p.id as part_id,
        p.part_number,
        p.part_name,
        p.base_unit,
        c.id as customer_id,
        c.name as customer_name,
        c.code as customer_code,
        t.id as tank_id,
        t.code as tank_code,
        t.display_name as tank_name,
        COALESCE((
          SELECT SUM(inspected_qty)
          FROM qc_inspections
          WHERE production_execution_id = pe.id
        ), 0) as total_inspected_qty
      FROM production_executions pe
      JOIN job_cards jc ON pe.job_card_id = jc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      JOIN tanks t ON pe.tank_id = t.id
      WHERE pe.status = 'COMPLETED'
      ORDER BY pe.completed_at DESC, pe.created_at DESC
    `;

    const result = await query(sql);
    
    // Filter to only those with remaining uninspected quantity
    const pendingList = result.rows
      .map(row => {
        const processedQty = parseFloat(row.processed_qty || '0');
        const inspectedQty = parseFloat(row.total_inspected_qty || '0');
        const uninspectedQty = Math.max(0, processedQty - inspectedQty);
        return {
          ...row,
          processed_qty: processedQty,
          total_inspected_qty: inspectedQty,
          uninspected_qty: uninspectedQty
        };
      })
      .filter(item => item.uninspected_qty > 0);

    return res.json(pendingList);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/qc/:id (Get single QC inspection details)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT 
        qc.*,
        pe.production_number, pe.production_date, pe.processed_qty as production_processed_qty,
        pe.rejected_qty as production_rejected_qty, pe.status as production_status,
        jc.job_card_number, jc.allocated_qty as job_card_allocated_qty,
        jc.plating_process, jc.priority, jc.target_thickness_microns,
        t.code as tank_code, t.display_name as tank_name,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        c.id as customer_id, c.name as customer_name, c.code as customer_code,
        co.order_number, co.customer_po_number,
        u.name as inspector_name, u.email as inspector_email
      FROM qc_inspections qc
      JOIN production_executions pe ON qc.production_execution_id = pe.id
      JOIN job_cards jc ON qc.job_card_id = jc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      JOIN tanks t ON pe.tank_id = t.id
      JOIN users u ON qc.inspector_user_id = u.id
      WHERE qc.id = ?`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'QC Inspection record not found' });
    }

    return res.json(result.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/qc/production/:productionExecutionId (Get all QC inspections for a production execution)
router.get('/production/:productionExecutionId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { productionExecutionId } = req.params;
    const result = await query(
      `SELECT qc.*, u.name as inspector_name
       FROM qc_inspections qc
       JOIN users u ON qc.inspector_user_id = u.id
       WHERE qc.production_execution_id = ?
       ORDER BY qc.created_at DESC`,
      [productionExecutionId]
    );

    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. POST /api/qc (Create and Record QC Inspection)
router.post(
  '/',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        production_execution_id,
        inspected_qty,
        accepted_qty,
        rejected_qty,
        status: requestedStatus,
        coating_thickness,
        min_thickness,
        max_thickness,
        thickness_unit,
        visual_defect,
        defect_details,
        remarks,
        inspection_date
      } = req.body;

      const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key;

      // Idempotency check
      if (idempotencyKey) {
        const existing = await query('SELECT * FROM qc_inspections WHERE idempotency_key = ?', [idempotencyKey]);
        if (existing.rows.length > 0) {
          return res.status(200).json(existing.rows[0]);
        }
      }

      // 1. Validate required fields
      if (!production_execution_id) {
        return res.status(400).json({ error: 'Production execution ID is required.' });
      }

      const numInspected = parseFloat(inspected_qty);
      const numAccepted = parseFloat(accepted_qty ?? '0');
      const numRejected = parseFloat(rejected_qty ?? '0');

      if (isNaN(numInspected) || numInspected <= 0) {
        return res.status(400).json({ error: 'Inspected quantity must be a positive number greater than 0.' });
      }

      if (isNaN(numAccepted) || numAccepted < 0) {
        return res.status(400).json({ error: 'Accepted quantity cannot be negative.' });
      }

      if (isNaN(numRejected) || numRejected < 0) {
        return res.status(400).json({ error: 'Rejected quantity cannot be negative.' });
      }

      // 2. Strict quantity reconciliation rule: accepted_qty + rejected_qty === inspected_qty
      if (Math.abs((numAccepted + numRejected) - numInspected) > 0.0001) {
        return res.status(400).json({
          error: `Quantity mismatch: Accepted (${numAccepted}) + Rejected (${numRejected}) must equal Inspected quantity (${numInspected}).`
        });
      }

      // 3. Validate Production Execution state
      const prodRes = await query(
        `SELECT id, production_number, job_card_id, processed_qty, status
         FROM production_executions
         WHERE id = ?`,
        [production_execution_id]
      );

      if (prodRes.rows.length === 0) {
        return res.status(404).json({ error: 'Production execution not found.' });
      }

      const production = prodRes.rows[0];

      // Production MUST be COMPLETED
      if (production.status !== 'COMPLETED') {
        return res.status(400).json({
          error: `Production execution must have status COMPLETED to undergo QC inspection. Current status is ${production.status}.`
        });
      }

      const processedQty = parseFloat(production.processed_qty || '0');

      // 4. Validate inspected_qty against production processed_qty
      const existingInspections = await query(
        `SELECT COALESCE(SUM(inspected_qty), 0) as already_inspected
         FROM qc_inspections
         WHERE production_execution_id = ?`,
        [production_execution_id]
      );

      const alreadyInspected = parseFloat(existingInspections.rows[0]?.already_inspected || '0');
      const remainingToInspect = Math.max(0, processedQty - alreadyInspected);

      if (numInspected > remainingToInspect) {
        return res.status(400).json({
          error: `Inspected quantity (${numInspected} pcs) exceeds remaining uninspected quantity (${remainingToInspect} pcs). Total processed: ${processedQty} pcs, already inspected: ${alreadyInspected} pcs.`
        });
      }

      // 5. Determine and validate Status
      let finalStatus: 'PENDING' | 'INSPECTED' | 'PASS' | 'FAIL' = 'PASS';
      if (requestedStatus && ['PENDING', 'INSPECTED', 'PASS', 'FAIL'].includes(requestedStatus)) {
        finalStatus = requestedStatus;
      } else {
        finalStatus = numRejected > 0 ? 'FAIL' : 'PASS';
      }

      // Validation for PASS: rejected_qty must be 0
      if (finalStatus === 'PASS' && numRejected > 0) {
        return res.status(400).json({
          error: `Inspection with rejected items (${numRejected} pcs) cannot have status PASS. Status must be FAIL.`
        });
      }

      // Validation for FAIL: must have visual defect or defect details
      if (finalStatus === 'FAIL') {
        if (!visual_defect && !defect_details && !remarks) {
          return res.status(400).json({
            error: 'Defect details or rejection reason is required when QC status is FAIL.'
          });
        }
      }

      const validDefects = ['NO_DEFECT', 'SCRATCH', 'PIT', 'DISCOLORATION', 'ROUGH_SURFACE', 'PEELING', 'OTHER'];
      const defectType = validDefects.includes(visual_defect) ? visual_defect : (numRejected > 0 ? 'OTHER' : 'NO_DEFECT');

      // 6. Generate QC number and insert
      const qcId = uuidv4();
      const qcNumber = await generateQcNumber();
      const inspectDate = inspection_date || new Date().toISOString().slice(0, 10);
      const isCompleted = finalStatus === 'PASS' || finalStatus === 'FAIL';
      const completedAt = isCompleted ? new Date().toISOString() : null;

      await query(
        `INSERT INTO qc_inspections (
          id, qc_number, production_execution_id, job_card_id, inspector_user_id,
          inspection_date, inspected_qty, accepted_qty, rejected_qty,
          coating_thickness, min_thickness, max_thickness, thickness_unit,
          visual_defect, defect_details, remarks, status,
          idempotency_key, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
        [
          qcId,
          qcNumber,
          production_execution_id,
          production.job_card_id,
          req.user!.id,
          inspectDate,
          numInspected,
          numAccepted,
          numRejected,
          coating_thickness ? parseFloat(coating_thickness) : null,
          min_thickness ? parseFloat(min_thickness) : null,
          max_thickness ? parseFloat(max_thickness) : null,
          thickness_unit || 'microns',
          defectType,
          defect_details || null,
          remarks || null,
          finalStatus,
          idempotencyKey || null,
          completedAt
        ]
      );

      // Audit Log
      await logAuditEvent({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: `QC_INSPECTION_${finalStatus}`,
        recordRef: qcId,
        changedValues: {
          qc_number: qcNumber,
          production_number: production.production_number,
          inspected_qty: numInspected,
          accepted_qty: numAccepted,
          rejected_qty: numRejected,
          status: finalStatus,
          visual_defect: defectType
        },
        reason: `QC inspection recorded for production execution ${production.production_number}`
      });

      const inserted = await query('SELECT * FROM qc_inspections WHERE id = ?', [qcId]);
      return res.status(201).json(inserted.rows[0]);
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed: qc_inspections.idempotency_key')) {
        const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key;
        const existing = await query('SELECT * FROM qc_inspections WHERE idempotency_key = ?', [idempotencyKey]);
        if (existing.rows.length > 0) {
          return res.status(200).json(existing.rows[0]);
        }
      }
      return res.status(500).json({ error: err.message });
    }
  }
);

// 6. POST /api/qc/:id/pass (Finalize inspection as PASS)
router.post(
  '/:id/pass',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const qcRes = await query('SELECT * FROM qc_inspections WHERE id = ?', [id]);

      if (qcRes.rows.length === 0) {
        return res.status(404).json({ error: 'QC Inspection not found.' });
      }

      const qc = qcRes.rows[0];

      // Controlled state machine: cannot move backwards or change finalized result
      if (qc.status === 'PASS') {
        return res.status(400).json({ error: 'QC Inspection is already passed and finalized.' });
      }
      if (qc.status === 'FAIL') {
        return res.status(400).json({ error: 'Cannot transition a failed QC inspection to PASS. State transitions cannot move backwards.' });
      }

      const numRejected = parseFloat(qc.rejected_qty || '0');
      if (numRejected > 0) {
        return res.status(400).json({
          error: `Cannot pass inspection with rejected items (${numRejected} pcs). Rejected items must be zero for status PASS.`
        });
      }

      await query(
        `UPDATE qc_inspections
         SET status = 'PASS',
             completed_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
        [id]
      );

      await logAuditEvent({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: 'QC_FINALIZE_PASS',
        recordRef: id,
        changedValues: { status: 'PASS', qc_number: qc.qc_number },
        reason: 'Inspection finalized as PASS'
      });

      const updated = await query('SELECT * FROM qc_inspections WHERE id = ?', [id]);
      return res.json(updated.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 7. POST /api/qc/:id/fail (Finalize inspection as FAIL)
router.post(
  '/:id/fail',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { defect_details, remarks } = req.body;

      const qcRes = await query('SELECT * FROM qc_inspections WHERE id = ?', [id]);

      if (qcRes.rows.length === 0) {
        return res.status(404).json({ error: 'QC Inspection not found.' });
      }

      const qc = qcRes.rows[0];

      // Controlled state machine: cannot move backwards or change finalized result
      if (qc.status === 'FAIL') {
        return res.status(400).json({ error: 'QC Inspection is already failed and finalized.' });
      }
      if (qc.status === 'PASS') {
        return res.status(400).json({ error: 'Cannot transition an already passed QC inspection to FAIL. State transitions cannot move backwards.' });
      }

      await query(
        `UPDATE qc_inspections
         SET status = 'FAIL',
             defect_details = COALESCE(?, defect_details),
             remarks = COALESCE(?, remarks),
             completed_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
        [defect_details || null, remarks || null, id]
      );

      await logAuditEvent({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: 'QC_FINALIZE_FAIL',
        recordRef: id,
        changedValues: { status: 'FAIL', qc_number: qc.qc_number, defect_details },
        reason: 'Inspection finalized as FAIL'
      });

      const updated = await query('SELECT * FROM qc_inspections WHERE id = ?', [id]);
      return res.json(updated.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
