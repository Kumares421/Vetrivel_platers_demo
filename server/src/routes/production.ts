import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { calculateFIFOAllocation } from '../services/fifoEngine';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Function to generate production number format: PRD-YYYYMMDD-XXXX
async function generateProductionNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `PRD-${dateStr}-`;

  const result = await query(
    `SELECT production_number FROM production_executions WHERE production_number LIKE ? ORDER BY production_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].production_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// Function to generate issue number format: ISS-YYYYMMDD-XXXX
async function generateIssueNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ISS-${dateStr}-`;

  const result = await query(
    `SELECT issue_number FROM chemical_issues WHERE issue_number LIKE ? ORDER BY issue_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].issue_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// GET /api/production (List all production executions with full joins)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, tank_id, job_card_id, from_date, to_date } = req.query;
    let sql = `
      SELECT 
        pe.*,
        jc.job_card_number, jc.allocated_qty as job_card_allocated_qty,
        jc.plating_process, jc.priority, jc.target_thickness_microns,
        t.code as tank_code, t.display_name as tank_name, t.capacity_liters as tank_capacity_liters,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        c.id as customer_id, c.name as customer_name, c.code as customer_code,
        co.order_number, co.customer_po_number,
        u.name as operator_name, u.email as operator_email,
        canc_u.name as cancelled_by_name,
        (
          SELECT COUNT(*) 
          FROM chemical_issues 
          WHERE production_execution_id = pe.id AND status = 'POSTED'
        ) as linked_chemical_issues_count
      FROM production_executions pe
      JOIN job_cards jc ON pe.job_card_id = jc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      JOIN tanks t ON pe.tank_id = t.id
      JOIN users u ON pe.operator_user_id = u.id
      LEFT JOIN users canc_u ON pe.cancelled_by_user_id = canc_u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND pe.status = ?';
      params.push(status);
    }
    if (tank_id) {
      sql += ' AND pe.tank_id = ?';
      params.push(tank_id);
    }
    if (job_card_id) {
      sql += ' AND pe.job_card_id = ?';
      params.push(job_card_id);
    }
    if (from_date) {
      sql += ' AND pe.production_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      sql += ' AND pe.production_date <= ?';
      params.push(to_date);
    }

    sql += ' ORDER BY pe.created_at DESC';

    const result = await query(sql, params);
    const rows = result.rows.map(r => ({
      ...r,
      planned_qty: parseFloat(r.planned_qty),
      processed_qty: parseFloat(r.processed_qty || '0'),
      rejected_qty: parseFloat(r.rejected_qty || '0'),
      remaining_qty: Math.max(0, parseFloat(r.planned_qty) - parseFloat(r.processed_qty || '0') - parseFloat(r.rejected_qty || '0')),
      job_card_allocated_qty: parseFloat(r.job_card_allocated_qty),
      tank_capacity_liters: parseFloat(r.tank_capacity_liters || '0'),
      linked_chemical_issues_count: parseInt(r.linked_chemical_issues_count || '0', 10)
    }));

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/production/eligible-jobs (Job cards ready/in-progress with remaining unproduced quantity)
router.get('/eligible-jobs', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        jc.id as job_card_id, jc.job_card_number, jc.allocated_qty, jc.plating_process,
        jc.priority, jc.status as job_card_status, jc.tank_id as default_tank_id,
        jc.target_thickness_microns,
        cpi.inward_number, cpi.challan_number,
        co.order_number, co.customer_po_number,
        c.name as customer_name, c.code as customer_code,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        t.code as default_tank_code, t.display_name as default_tank_name,
        COALESCE((
          SELECT SUM(planned_qty)
          FROM production_executions
          WHERE job_card_id = jc.id AND status != 'CANCELLED'
        ), 0) as total_planned_qty,
        COALESCE((
          SELECT SUM(processed_qty)
          FROM production_executions
          WHERE job_card_id = jc.id AND status = 'COMPLETED'
        ), 0) as total_completed_qty
      FROM job_cards jc
      JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      LEFT JOIN tanks t ON jc.tank_id = t.id
      WHERE jc.status IN ('RELEASED', 'IN_PROGRESS')
      ORDER BY jc.created_at ASC
    `;

    const result = await query(sql);
    const eligible = result.rows
      .map(r => {
        const allocated = parseFloat(r.allocated_qty);
        const planned = parseFloat(r.total_planned_qty);
        const completed = parseFloat(r.total_completed_qty);
        const remainingToProduce = Math.max(0, Math.round((allocated - planned) * 10000) / 10000);
        return {
          ...r,
          allocated_qty: allocated,
          total_planned_qty: planned,
          total_completed_qty: completed,
          remaining_to_produce: remainingToProduce
        };
      })
      .filter(job => job.remaining_to_produce > 0);

    return res.json(eligible);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/production/tanks (Active tanks for assignment)
router.get('/tanks', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT id, code, display_name, capacity_liters, status, location
      FROM tanks
      WHERE is_active = 1 AND status = 'ACTIVE'
      ORDER BY code ASC
    `);
    const tanks = result.rows.map(t => ({
      ...t,
      capacity_liters: parseFloat(t.capacity_liters || '0')
    }));
    return res.json(tanks);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/production/:id (Details with linked chemical issues & FIFO allocations)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        pe.*,
        jc.job_card_number, jc.allocated_qty as job_card_allocated_qty,
        jc.plating_process, jc.priority, jc.target_thickness_microns,
        t.code as tank_code, t.display_name as tank_name, t.capacity_liters as tank_capacity_liters,
        p.id as part_id, p.part_number, p.part_name, p.base_unit,
        c.id as customer_id, c.name as customer_name, c.code as customer_code,
        co.order_number, co.customer_po_number,
        u.name as operator_name, u.email as operator_email,
        canc_u.name as cancelled_by_name
      FROM production_executions pe
      JOIN job_cards jc ON pe.job_card_id = jc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      JOIN tanks t ON pe.tank_id = t.id
      JOIN users u ON pe.operator_user_id = u.id
      LEFT JOIN users canc_u ON pe.cancelled_by_user_id = canc_u.id
      WHERE pe.id = ?
    `;

    const result = await query(sql, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Production execution record not found' });
    }

    const pe = result.rows[0];
    pe.planned_qty = parseFloat(pe.planned_qty);
    pe.processed_qty = parseFloat(pe.processed_qty || '0');
    pe.rejected_qty = parseFloat(pe.rejected_qty || '0');
    pe.remaining_qty = Math.max(0, pe.planned_qty - pe.processed_qty - pe.rejected_qty);
    pe.job_card_allocated_qty = parseFloat(pe.job_card_allocated_qty);
    pe.tank_capacity_liters = parseFloat(pe.tank_capacity_liters || '0');

    // Fetch linked chemical issues
    const issuesRes = await query(`
      SELECT 
        ci.*, c.code as chemical_code, c.name as chemical_name, c.base_unit as chemical_unit,
        u.name as issued_by_name
      FROM chemical_issues ci
      JOIN chemicals c ON ci.chemical_id = c.id
      JOIN users u ON ci.issued_by_user_id = u.id
      WHERE ci.production_execution_id = ? OR (ci.job_card_id = ? AND ci.tank_id = ?)
      ORDER BY ci.issue_date DESC
    `, [pe.id, pe.job_card_id, pe.tank_id]);

    pe.linked_chemical_issues = issuesRes.rows.map(ci => ({
      ...ci,
      required_qty: parseFloat(ci.required_qty),
      total_allocated_value: parseFloat(ci.total_allocated_value || '0')
    }));

    return res.json(pe);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/production/job-card/:jobCardId (Summary and executions for a specific job card)
router.get('/job-card/:jobCardId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { jobCardId } = req.params;

    const jcRes = await query(`
      SELECT jc.*, p.part_number, p.part_name, c.name as customer_name
      FROM job_cards jc
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN customers c ON co.customer_id = c.id
      WHERE jc.id = ?
    `, [jobCardId]);

    if (jcRes.rows.length === 0) {
      return res.status(404).json({ error: 'Job Card not found' });
    }

    const jobCard = jcRes.rows[0];
    const allocated = parseFloat(jobCard.allocated_qty);

    const peRes = await query(`
      SELECT pe.*, t.code as tank_code, t.display_name as tank_name, u.name as operator_name
      FROM production_executions pe
      JOIN tanks t ON pe.tank_id = t.id
      JOIN users u ON pe.operator_user_id = u.id
      WHERE pe.job_card_id = ?
      ORDER BY pe.created_at ASC
    `, [jobCardId]);

    let totalPlanned = 0;
    let totalProcessed = 0;
    let totalRejected = 0;

    const executions = peRes.rows.map(pe => {
      const plan = parseFloat(pe.planned_qty);
      const proc = parseFloat(pe.processed_qty || '0');
      const rej = parseFloat(pe.rejected_qty || '0');
      if (pe.status !== 'CANCELLED') {
        totalPlanned += plan;
        totalProcessed += proc;
        totalRejected += rej;
      }
      return {
        ...pe,
        planned_qty: plan,
        processed_qty: proc,
        rejected_qty: rej,
        remaining_qty: Math.max(0, plan - proc - rej)
      };
    });

    const remainingJobQty = Math.max(0, Math.round((allocated - totalPlanned) * 10000) / 10000);

    return res.json({
      job_card: {
        id: jobCard.id,
        job_card_number: jobCard.job_card_number,
        allocated_qty: allocated,
        customer_name: jobCard.customer_name,
        part_number: jobCard.part_number,
        part_name: jobCard.part_name,
        status: jobCard.status
      },
      reconciliation: {
        allocated_qty: allocated,
        total_planned_qty: totalPlanned,
        total_processed_qty: totalProcessed,
        total_rejected_qty: totalRejected,
        remaining_available_qty: remainingJobQty
      },
      executions
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/production (Create / Start Production Execution)
router.post('/', authenticateToken, requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const {
      job_card_id, tank_id, planned_qty, start_immediately, notes, idempotency_key
    } = req.body;

    const idempotencyKeyHeader = req.headers['x-idempotency-key'] as string | undefined;
    const finalIdempotencyKey = idempotency_key || idempotencyKeyHeader || null;

    if (!job_card_id || !tank_id || planned_qty == null) {
      return res.status(400).json({ error: 'Job Card, Production Tank, and planned quantity are required' });
    }

    const planQty = parseFloat(planned_qty);
    if (isNaN(planQty) || planQty <= 0) {
      return res.status(400).json({ error: 'Planned production quantity must be greater than zero' });
    }

    // Idempotency check
    if (finalIdempotencyKey) {
      const idempRes = await query(
        'SELECT id, production_number, planned_qty, status FROM production_executions WHERE idempotency_key = ?',
        [finalIdempotencyKey]
      );
      if (idempRes.rows.length > 0) {
        const existing = idempRes.rows[0];
        return res.json({
          id: existing.id,
          production_number: existing.production_number,
          planned_qty: parseFloat(existing.planned_qty),
          status: existing.status,
          message: 'Duplicate production submission blocked by idempotency key. Original record returned.'
        });
      }
    }

    await dbClient.beginTransaction();

    // 1. Validate Job Card exists and is not cancelled or already completed
    const jcRes = await dbClient.query(
      `SELECT id, job_card_number, allocated_qty, status 
       FROM job_cards 
       WHERE id = ?`,
      [job_card_id]
    );

    if (jcRes.rows.length === 0) {
      throw new Error('Selected Job Card not found');
    }

    const jobCard = jcRes.rows[0];
    if (jobCard.status === 'CANCELLED') {
      throw new Error(`Cannot start production: Job Card ${jobCard.job_card_number} is cancelled`);
    }
    if (jobCard.status === 'COMPLETED') {
      throw new Error(`Cannot start production: Job Card ${jobCard.job_card_number} is already fully completed`);
    }

    const allocatedQty = parseFloat(jobCard.allocated_qty);
    if (allocatedQty <= 0) {
      throw new Error('Job Card does not have a positive allocated quantity');
    }

    // 2. Validate Production Tank exists and is ACTIVE
    const tankRes = await dbClient.query(
      `SELECT id, code, display_name, status, is_active 
       FROM tanks 
       WHERE id = ?`,
      [tank_id]
    );

    if (tankRes.rows.length === 0 || !tankRes.rows[0].is_active) {
      throw new Error('Selected Production Tank does not exist or is inactive in master records');
    }

    const tank = tankRes.rows[0];
    if (tank.status !== 'ACTIVE') {
      throw new Error(`Selected Tank ${tank.code} is currently in '${tank.status}' status (must be ACTIVE for production)`);
    }

    // 3. Reconcile remaining Job Card quantity
    const sumPlanRes = await dbClient.query(
      `SELECT COALESCE(SUM(planned_qty), 0) as total_planned
       FROM production_executions
       WHERE job_card_id = ? AND status != 'CANCELLED'`,
      [job_card_id]
    );

    const alreadyPlanned = parseFloat(sumPlanRes.rows[0]?.total_planned || '0');
    const remainingJobQty = Math.round((allocatedQty - alreadyPlanned) * 10000) / 10000;

    if (planQty > remainingJobQty) {
      throw new Error(
        `Excess quantity rejected: Planned quantity (${planQty}) exceeds remaining Job Card balance (${remainingJobQty}). Job Card allocated: ${allocatedQty}, already planned/produced: ${alreadyPlanned}.`
      );
    }

    const peId = uuidv4();
    const productionNumber = await generateProductionNumber();
    const initialStatus = start_immediately ? 'IN_PROGRESS' : 'PLANNED';
    const startedAt = start_immediately ? new Date().toISOString() : null;
    const todayDate = new Date().toISOString().slice(0, 10);

    await dbClient.query(
      `INSERT INTO production_executions (
         id, production_number, job_card_id, tank_id, production_date,
         started_at, planned_qty, processed_qty, rejected_qty, status,
         operator_user_id, notes, idempotency_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        peId, productionNumber, job_card_id, tank_id, todayDate,
        startedAt, planQty, initialStatus,
        req.user?.id, notes || null, finalIdempotencyKey
      ]
    );

    // Update Job Card status to IN_PROGRESS if it was RELEASED
    if (jobCard.status === 'RELEASED') {
      await dbClient.query(
        `UPDATE job_cards SET status = 'IN_PROGRESS' WHERE id = ?`,
        [job_card_id]
      );
    }

    await dbClient.commit();

    const remainingAvailableAfter = Math.max(0, Math.round((remainingJobQty - planQty) * 10000) / 10000);

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: initialStatus === 'IN_PROGRESS' ? 'PRODUCTION_STARTED' : 'PRODUCTION_CREATED',
      recordRef: `production_executions/${peId}`,
      changedValues: {
        production_number: productionNumber,
        job_card_id,
        tank_id,
        planned_qty: planQty,
        remaining_job_qty: remainingAvailableAfter,
        status: initialStatus
      }
    });

    return res.status(201).json({
      id: peId,
      production_number: productionNumber,
      job_card_id,
      tank_id,
      planned_qty: planQty,
      remaining_job_qty: remainingAvailableAfter,
      status: initialStatus,
      started_at: startedAt
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// POST /api/production/:id/start (Transition from PLANNED to IN_PROGRESS)
router.post('/:id/start', authenticateToken, requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const peRes = await query('SELECT * FROM production_executions WHERE id = ?', [id]);
    if (peRes.rows.length === 0) {
      return res.status(404).json({ error: 'Production execution record not found' });
    }

    const pe = peRes.rows[0];
    if (pe.status !== 'PLANNED') {
      return res.status(400).json({ error: `Cannot start production in status '${pe.status}' (must be PLANNED)` });
    }

    const now = new Date().toISOString();
    await query(
      `UPDATE production_executions SET 
         status = 'IN_PROGRESS', started_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [now, id]
    );

    await query(
      `UPDATE job_cards SET status = 'IN_PROGRESS' WHERE id = ? AND status = 'RELEASED'`,
      [pe.job_card_id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PRODUCTION_STARTED',
      recordRef: `production_executions/${id}`,
      changedValues: { production_number: pe.production_number, started_at: now }
    });

    return res.json({ success: true, status: 'IN_PROGRESS', started_at: now });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/production/:id/record (Record intermediate progress: processed_qty, rejected_qty)
router.post('/:id/record', authenticateToken, requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { processed_qty, rejected_qty, notes } = req.body;

    const peRes = await query('SELECT * FROM production_executions WHERE id = ?', [id]);
    if (peRes.rows.length === 0) {
      return res.status(404).json({ error: 'Production execution record not found' });
    }

    const pe = peRes.rows[0];
    if (pe.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: `Cannot record production progress in status '${pe.status}' (must be IN_PROGRESS)` });
    }

    const planned = parseFloat(pe.planned_qty);
    const proc = processed_qty != null ? parseFloat(processed_qty) : parseFloat(pe.processed_qty || '0');
    const rej = rejected_qty != null ? parseFloat(rejected_qty) : parseFloat(pe.rejected_qty || '0');

    if (isNaN(proc) || proc < 0) {
      return res.status(400).json({ error: 'Processed quantity must be non-negative' });
    }
    if (isNaN(rej) || rej < 0) {
      return res.status(400).json({ error: 'Rejected quantity must be non-negative' });
    }
    if (proc + rej > planned) {
      return res.status(400).json({
        error: `Total produced + rejected (${proc + rej}) exceeds planned execution quantity (${planned})`
      });
    }

    await query(
      `UPDATE production_executions SET 
         processed_qty = ?, rejected_qty = ?, notes = COALESCE(?, notes), updated_at = datetime('now')
       WHERE id = ?`,
      [proc, rej, notes || null, id]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PRODUCTION_PROGRESS_RECORDED',
      recordRef: `production_executions/${id}`,
      changedValues: { processed_qty: proc, rejected_qty: rej }
    });

    return res.json({
      success: true,
      processed_qty: proc,
      rejected_qty: rej,
      remaining_qty: Math.max(0, planned - proc - rej)
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/production/:id/complete (Finalize production execution & check job card completion)
router.post('/:id/complete', authenticateToken, requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const { id } = req.params;
    const { processed_qty, rejected_qty, notes } = req.body;

    const peRes = await query('SELECT * FROM production_executions WHERE id = ?', [id]);
    if (peRes.rows.length === 0) {
      return res.status(404).json({ error: 'Production execution record not found' });
    }

    const pe = peRes.rows[0];
    if (pe.status !== 'IN_PROGRESS' && pe.status !== 'PLANNED') {
      return res.status(400).json({ error: `Cannot complete production in status '${pe.status}'` });
    }

    const planned = parseFloat(pe.planned_qty);
    // If not supplied, default processed to planned - rejected
    const rej = rejected_qty != null ? parseFloat(rejected_qty) : parseFloat(pe.rejected_qty || '0');
    const proc = processed_qty != null ? parseFloat(processed_qty) : (parseFloat(pe.processed_qty || '0') || (planned - rej));

    if (isNaN(proc) || proc < 0) {
      return res.status(400).json({ error: 'Processed quantity must be non-negative' });
    }
    if (isNaN(rej) || rej < 0) {
      return res.status(400).json({ error: 'Rejected quantity must be non-negative' });
    }
    if (proc + rej > planned) {
      return res.status(400).json({
        error: `Total processed + rejected (${proc + rej}) cannot exceed planned quantity (${planned})`
      });
    }

    const now = new Date().toISOString();
    const startedAt = pe.started_at || now;

    await dbClient.beginTransaction();

    await dbClient.query(
      `UPDATE production_executions SET 
         status = 'COMPLETED', started_at = ?, completed_at = ?,
         processed_qty = ?, rejected_qty = ?, notes = COALESCE(?, notes), updated_at = datetime('now')
       WHERE id = ?`,
      [startedAt, now, proc, rej, notes || null, id]
    );

    // Check if Job Card is fully completed
    const jcRes = await dbClient.query(
      `SELECT id, allocated_qty FROM job_cards WHERE id = ?`,
      [pe.job_card_id]
    );
    const jcAllocated = parseFloat(jcRes.rows[0]?.allocated_qty || '0');

    const totalCompRes = await dbClient.query(
      `SELECT COALESCE(SUM(processed_qty + rejected_qty), 0) as total_finished
       FROM production_executions
       WHERE job_card_id = ? AND status = 'COMPLETED'`,
      [pe.job_card_id]
    );
    const totalFinished = parseFloat(totalCompRes.rows[0]?.total_finished || '0');

    let jobCardCompleted = false;
    if (totalFinished >= jcAllocated) {
      await dbClient.query(
        `UPDATE job_cards SET status = 'COMPLETED' WHERE id = ?`,
        [pe.job_card_id]
      );
      jobCardCompleted = true;
    }

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PRODUCTION_COMPLETED',
      recordRef: `production_executions/${id}`,
      changedValues: {
        production_number: pe.production_number,
        processed_qty: proc,
        rejected_qty: rej,
        job_card_completed: jobCardCompleted
      }
    });

    return res.json({
      success: true,
      status: 'COMPLETED',
      completed_at: now,
      processed_qty: proc,
      rejected_qty: rej,
      job_card_completed: jobCardCompleted
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// POST /api/production/:id/cancel (Cancel production execution)
router.post('/:id/cancel', authenticateToken, requireRole(['ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const { id } = req.params;
    const { cancellation_reason } = req.body;

    if (!cancellation_reason || !cancellation_reason.trim()) {
      return res.status(400).json({ error: 'Cancellation reason is required' });
    }

    const peRes = await query('SELECT * FROM production_executions WHERE id = ?', [id]);
    if (peRes.rows.length === 0) {
      return res.status(404).json({ error: 'Production execution record not found' });
    }

    const pe = peRes.rows[0];
    if (pe.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Production execution is already cancelled' });
    }

    await dbClient.beginTransaction();

    await dbClient.query(
      `UPDATE production_executions SET 
         status = 'CANCELLED', cancelled_at = datetime('now'),
         cancelled_by_user_id = ?, cancellation_reason = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [req.user?.id, cancellation_reason.trim(), id]
    );

    // If all remaining executions for this Job Card are CANCELLED or none exist, revert Job Card to RELEASED
    const activeExecs = await dbClient.query(
      `SELECT COUNT(*) as active_count 
       FROM production_executions 
       WHERE job_card_id = ? AND status != 'CANCELLED'`,
      [pe.job_card_id]
    );

    if (parseInt(activeExecs.rows[0]?.active_count || '0', 10) === 0) {
      await dbClient.query(
        `UPDATE job_cards SET status = 'RELEASED' WHERE id = ? AND status != 'CANCELLED'`,
        [pe.job_card_id]
      );
    }

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PRODUCTION_CANCELLED',
      recordRef: `production_executions/${id}`,
      reason: cancellation_reason.trim(),
      changedValues: { production_number: pe.production_number }
    });

    return res.json({ success: true, status: 'CANCELLED' });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// POST /api/production/:id/issue-chemical (Seamlessly calls existing FIFO chemical issue engine)
router.post('/:id/issue-chemical', authenticateToken, requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const { id } = req.params;
    const { chemical_id, required_qty, shift, remarks, idempotency_key, override_reason, allow_override } = req.body;

    const peRes = await query(`
      SELECT pe.*, jc.job_card_number, t.code as tank_code, t.display_name as tank_name
      FROM production_executions pe
      JOIN job_cards jc ON pe.job_card_id = jc.id
      JOIN tanks t ON pe.tank_id = t.id
      WHERE pe.id = ?
    `, [id]);

    if (peRes.rows.length === 0) {
      return res.status(404).json({ error: 'Production execution record not found' });
    }

    const pe = peRes.rows[0];
    if (pe.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Cannot issue chemicals to a cancelled production execution' });
    }

    if (!chemical_id || required_qty == null) {
      return res.status(400).json({ error: 'Chemical selection and required quantity are required' });
    }

    const reqQty = parseFloat(required_qty);
    if (isNaN(reqQty) || reqQty <= 0) {
      return res.status(400).json({ error: 'Required chemical quantity must be greater than zero' });
    }

    const idempotencyKeyHeader = req.headers['x-idempotency-key'] as string | undefined;
    const finalIdempotencyKey = idempotency_key || idempotencyKeyHeader || null;

    // Idempotency check
    if (finalIdempotencyKey) {
      const idempRes = await query(`SELECT id, issue_number, total_allocated_value FROM chemical_issues WHERE idempotency_key = ?`, [finalIdempotencyKey]);
      if (idempRes.rows.length > 0) {
        const existing = idempRes.rows[0];
        return res.json({
          id: existing.id,
          issue_number: existing.issue_number,
          total_allocated_value: parseFloat(existing.total_allocated_value || '0'),
          message: 'Duplicate chemical issue blocked by idempotency key. Original issue returned.'
        });
      }
    }

    await dbClient.beginTransaction();

    // Re-verify stock & calculate allocation under transaction via EXISTING FIFO engine
    const fifoResult = await calculateFIFOAllocation(chemical_id, reqQty, Boolean(allow_override), dbClient);

    if (!fifoResult.isFullyAllocated) {
      throw new Error(
        `Insufficient stock to fulfill production request. Required: ${reqQty}, Available eligible stock: ${fifoResult.totalAllocatedQty}. Shortage: ${fifoResult.shortageQty}`
      );
    }

    const issueId = uuidv4();
    const issueNumber = await generateIssueNumber();
    const issueTimestamp = new Date().toISOString();

    let combinedRemarks = remarks ? remarks.trim() : '';
    const prodRefNote = `[Production: ${pe.production_number} | Job Card: ${pe.job_card_number}]`;
    combinedRemarks = combinedRemarks ? `${prodRefNote} ${combinedRemarks}` : prodRefNote;
    if (shift) {
      combinedRemarks = `[Shift: ${shift}] ${combinedRemarks}`;
    }

    // Lock and update receipt lots in consistent FIFO order
    for (const alloc of fifoResult.allocations) {
      const lotLockRes = await dbClient.query(`SELECT remaining_qty FROM receipt_lots WHERE id = ? FOR UPDATE`, [alloc.lotId]);
      if (lotLockRes.rows.length === 0) {
        throw new Error(`Receipt lot ${alloc.lotNumber} no longer exists`);
      }

      const currentLotRemaining = parseFloat(lotLockRes.rows[0].remaining_qty);
      if (currentLotRemaining < alloc.allocatedQty) {
        throw new Error(
          `Stock balance changed concurrently for lot ${alloc.lotNumber}. Please re-preview the allocation.`
        );
      }

      const newLotRemaining = Math.round((currentLotRemaining - alloc.allocatedQty) * 10000) / 10000;
      const newLotStatus = newLotRemaining === 0 ? 'EXHAUSTED' : 'AVAILABLE';

      await dbClient.query(
        `UPDATE receipt_lots SET remaining_qty = ?, status = ? WHERE id = ?`,
        [newLotRemaining, newLotStatus, alloc.lotId]
      );
    }

    // Save chemical issue header linked to production_execution_id and job_card_id
    await dbClient.query(
      `INSERT INTO chemical_issues (
        id, issue_number, issue_date, chemical_id, required_qty, tank_id,
        job_reference, job_card_id, production_execution_id, issued_by_user_id, remarks, total_allocated_value, status,
        idempotency_key, override_reason, created_at, posted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        issueId, issueNumber, issueTimestamp, chemical_id, reqQty, pe.tank_id,
        pe.job_card_number, pe.job_card_id, pe.id, req.user?.id, combinedRemarks, fifoResult.totalAllocatedValue,
        finalIdempotencyKey, override_reason || null
      ]
    );

    // Save allocations and stock movements
    for (const alloc of fifoResult.allocations) {
      const allocId = uuidv4();
      await dbClient.query(
        `INSERT INTO fifo_allocations (
          id, chemical_issue_id, receipt_lot_id, allocated_qty, rate_per_unit, allocation_value
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [allocId, issueId, alloc.lotId, alloc.allocatedQty, alloc.ratePerUnit, alloc.allocationValue]
      );

      const movementId = uuidv4();
      await dbClient.query(
        `INSERT INTO stock_movements (
          id, movement_type, chemical_id, receipt_lot_id, reference_type, reference_id,
          quantity_change, balance_after, movement_date, created_by_user_id, reason
        ) VALUES (?, 'ISSUE', ?, ?, 'CHEMICAL_ISSUE', ?, ?, ?, ?, ?, ?)`,
        [
          movementId, chemical_id, alloc.lotId, issueId, -alloc.allocatedQty,
          alloc.remainingAfter, issueTimestamp, req.user?.id,
          `Issued to Tank ${pe.tank_code} for Production ${pe.production_number} (Job ${pe.job_card_number})`
        ]
      );
    }

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PRODUCTION_CHEMICAL_ISSUED',
      recordRef: `chemical_issues/${issueId}`,
      changedValues: {
        issue_number: issueNumber,
        production_number: pe.production_number,
        chemical_id,
        tank_id: pe.tank_id,
        required_qty: reqQty,
        allocated_lots: fifoResult.allocations.map(a => `${a.lotNumber}: ${a.allocatedQty}`)
      }
    });

    return res.status(201).json({
      id: issueId,
      issue_number: issueNumber,
      production_id: pe.id,
      production_number: pe.production_number,
      total_allocated_qty: fifoResult.totalAllocatedQty,
      total_allocated_value: fifoResult.totalAllocatedValue,
      allocations: fifoResult.allocations,
      message: 'Production chemical requirement issued via FIFO and stock movements committed atomically'
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

export default router;
