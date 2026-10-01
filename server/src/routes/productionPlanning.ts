import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Helper: Determine delivery urgency and days until delivery
function calculateDeliveryUrgency(expectedDeliveryDateStr?: string | null): {
  days_until_delivery: number | null;
  delivery_urgency: 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON' | 'UPCOMING';
} {
  if (!expectedDeliveryDateStr) {
    return { days_until_delivery: null, delivery_urgency: 'UPCOMING' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deliveryDate = new Date(expectedDeliveryDateStr);
  deliveryDate.setHours(0, 0, 0, 0);

  const diffTime = deliveryDate.getTime() - today.getTime();
  const days = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (days < 0) {
    return { days_until_delivery: days, delivery_urgency: 'OVERDUE' };
  } else if (days === 0) {
    return { days_until_delivery: 0, delivery_urgency: 'DUE_TODAY' };
  } else if (days >= 1 && days <= 3) {
    return { days_until_delivery: days, delivery_urgency: 'DUE_SOON' };
  } else {
    return { days_until_delivery: days, delivery_urgency: 'UPCOMING' };
  }
}

// Helper: Determine planning/workboard status and blocking reason
function derivePlanningStatus(params: {
  jobCardStatus: string;
  inwardId?: string | null;
  inwardStatus?: string | null;
  inwardAcceptedQty: number;
  allocatedQty: number;
  platingProcess?: string | null;
  remainingQty: number;
  activeInProgressCount: number;
  hasPlan: boolean;
  plannedDate?: string | null;
}): { planning_status: 'READY' | 'PLANNED' | 'IN_QUEUE' | 'IN_PRODUCTION' | 'COMPLETED' | 'BLOCKED'; blocking_reason: string | null } {
  // 1. Blocked scenarios
  if (params.jobCardStatus === 'CANCELLED') {
    return { planning_status: 'BLOCKED', blocking_reason: 'Job Card is cancelled' };
  }
  if (!params.inwardId || params.inwardStatus === 'CANCELLED') {
    return { planning_status: 'BLOCKED', blocking_reason: 'Source parts inward receipt missing or cancelled' };
  }
  if (params.inwardAcceptedQty <= 0) {
    return { planning_status: 'BLOCKED', blocking_reason: 'Source parts inward has zero accepted quantity' };
  }
  if (params.allocatedQty <= 0) {
    return { planning_status: 'BLOCKED', blocking_reason: 'Job Card allocated quantity must be greater than zero' };
  }
  if (!params.platingProcess || params.platingProcess.trim() === '') {
    return { planning_status: 'BLOCKED', blocking_reason: 'Missing plating process specification' };
  }

  // 2. Completed scenario
  if (params.remainingQty <= 0 || params.jobCardStatus === 'COMPLETED') {
    return { planning_status: 'COMPLETED', blocking_reason: null };
  }

  // 3. In Production scenario
  if (params.activeInProgressCount > 0 || params.jobCardStatus === 'IN_PROGRESS') {
    return { planning_status: 'IN_PRODUCTION', blocking_reason: null };
  }

  // 4. Planned or In-Queue scenarios
  if (params.hasPlan) {
    if (params.plannedDate) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (params.plannedDate <= todayStr) {
        return { planning_status: 'IN_QUEUE', blocking_reason: null };
      }
      return { planning_status: 'PLANNED', blocking_reason: null };
    }
    return { planning_status: 'PLANNED', blocking_reason: null };
  }

  // 5. Ready for planning/production
  return { planning_status: 'READY', blocking_reason: null };
}

// 1. GET /api/production-planning/queue
router.get(
  '/queue',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        status,
        priority,
        planned_date,
        delivery_date,
        customer_id,
        tank_id,
        process,
        search,
        sort_by,
        sort_dir
      } = req.query;

      const sql = `
        SELECT 
          jc.id as job_card_id,
          jc.job_card_number,
          jc.allocated_qty,
          jc.plating_process,
          jc.target_thickness_microns,
          jc.priority as default_priority,
          jc.status as job_card_status,
          jc.notes as job_card_notes,
          jc.tank_id,
          t.code as tank_code,
          t.display_name as tank_name,
          cpi.id as inward_id,
          cpi.inward_number,
          cpi.challan_number,
          cpi.received_date as inward_received_date,
          cpi.accepted_qty as inward_accepted_qty,
          cpi.rejected_qty as inward_rejected_qty,
          cpi.status as inward_status,
          co.id as customer_order_id,
          co.order_number,
          co.customer_po_number,
          co.order_date,
          co.expected_delivery_date,
          co.status as order_status,
          c.id as customer_id,
          c.name as customer_name,
          c.code as customer_code,
          p.id as part_id,
          p.part_number,
          p.part_name,
          p.base_unit,
          pp.id as plan_id,
          pp.priority as plan_priority,
          pp.planned_date,
          pp.planned_start_time,
          pp.planning_notes,
          pp.created_at as planned_at,
          u.name as planned_by_name,
          COALESCE((
            SELECT SUM(processed_qty)
            FROM production_executions
            WHERE job_card_id = jc.id AND status = 'COMPLETED'
          ), 0) as completed_production_qty,
          COALESCE((
            SELECT COUNT(*)
            FROM production_executions
            WHERE job_card_id = jc.id AND status = 'IN_PROGRESS'
          ), 0) as in_progress_runs_count
        FROM job_cards jc
        LEFT JOIN production_plans pp ON pp.job_card_id = jc.id
        LEFT JOIN users u ON pp.created_by_user_id = u.id
        JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
        JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
        JOIN customer_orders co ON coi.customer_order_id = co.id
        JOIN customers c ON co.customer_id = c.id
        JOIN parts p ON coi.part_id = p.id
        LEFT JOIN tanks t ON jc.tank_id = t.id
        ORDER BY jc.created_at ASC
      `;

      const result = await query(sql);

      let items = result.rows.map(r => {
        const allocated = parseFloat(r.allocated_qty || '0');
        const completed = parseFloat(r.completed_production_qty || '0');
        const remaining = Math.max(0, Math.round((allocated - completed) * 10000) / 10000);

        const deliveryUrgencyInfo = calculateDeliveryUrgency(r.expected_delivery_date);
        const effectivePriority = r.plan_priority || r.default_priority || 'NORMAL';

        const statusInfo = derivePlanningStatus({
          jobCardStatus: r.job_card_status,
          inwardId: r.inward_id,
          inwardStatus: r.inward_status,
          inwardAcceptedQty: parseFloat(r.inward_accepted_qty || '0'),
          allocatedQty: allocated,
          platingProcess: r.plating_process,
          remainingQty: remaining,
          activeInProgressCount: parseInt(r.in_progress_runs_count || '0', 10),
          hasPlan: Boolean(r.plan_id),
          plannedDate: r.planned_date
        });

        return {
          job_card_id: r.job_card_id,
          job_card_number: r.job_card_number,
          job_card_status: r.job_card_status,
          allocated_qty: allocated,
          completed_production_qty: completed,
          remaining_production_qty: remaining,
          plating_process: r.plating_process,
          target_thickness_microns: r.target_thickness_microns != null ? parseFloat(r.target_thickness_microns) : null,
          tank_id: r.tank_id || null,
          tank_code: r.tank_code || null,
          tank_name: r.tank_name || (r.tank_code ? r.tank_code : 'UNASSIGNED'),
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          customer_code: r.customer_code,
          order_id: r.customer_order_id,
          order_number: r.order_number,
          customer_po_number: r.customer_po_number || null,
          order_date: r.order_date,
          expected_delivery_date: r.expected_delivery_date || null,
          days_until_delivery: deliveryUrgencyInfo.days_until_delivery,
          delivery_urgency: deliveryUrgencyInfo.delivery_urgency,
          part_id: r.part_id,
          part_number: r.part_number,
          part_name: r.part_name,
          base_unit: r.base_unit || 'pcs',
          inward_id: r.inward_id,
          inward_number: r.inward_number,
          challan_number: r.challan_number || null,
          inward_accepted_qty: parseFloat(r.inward_accepted_qty || '0'),
          inward_rejected_qty: parseFloat(r.inward_rejected_qty || '0'),
          priority: effectivePriority,
          is_planned: Boolean(r.plan_id),
          plan_id: r.plan_id || null,
          planned_date: r.planned_date || null,
          planned_start_time: r.planned_start_time || null,
          planning_notes: r.planning_notes || null,
          planned_by_user_name: r.planned_by_name || null,
          planned_at: r.planned_at || null,
          planning_status: statusInfo.planning_status,
          blocking_reason: statusInfo.blocking_reason
        };
      });

      // Filter by status
      if (status && typeof status === 'string') {
        items = items.filter(it => it.planning_status === status);
      }

      // Filter by priority
      if (priority && typeof priority === 'string') {
        items = items.filter(it => it.priority === priority);
      }

      // Filter by planned date
      if (planned_date && typeof planned_date === 'string') {
        items = items.filter(it => it.planned_date === planned_date);
      }

      // Filter by delivery date
      if (delivery_date && typeof delivery_date === 'string') {
        items = items.filter(it => it.expected_delivery_date === delivery_date);
      }

      // Filter by customer
      if (customer_id && typeof customer_id === 'string') {
        items = items.filter(it => it.customer_id === customer_id);
      }

      // Filter by tank
      if (tank_id && typeof tank_id === 'string') {
        items = items.filter(it => it.tank_id === tank_id);
      }

      // Filter by process
      if (process && typeof process === 'string') {
        items = items.filter(it => it.plating_process && it.plating_process.toLowerCase().includes(process.toLowerCase()));
      }

      // Search query (Job card, order, customer, part, inward)
      if (search && typeof search === 'string') {
        const q = search.trim().toLowerCase();
        items = items.filter(it =>
          it.job_card_number.toLowerCase().includes(q) ||
          it.order_number.toLowerCase().includes(q) ||
          (it.customer_po_number && it.customer_po_number.toLowerCase().includes(q)) ||
          it.customer_name.toLowerCase().includes(q) ||
          it.part_number.toLowerCase().includes(q) ||
          (it.challan_number && it.challan_number.toLowerCase().includes(q)) ||
          (it.inward_number && it.inward_number.toLowerCase().includes(q))
        );
      }

      // Sorting
      const priorityOrder: Record<string, number> = {
        URGENT: 1,
        HIGH: 2,
        NORMAL: 3,
        LOW: 4
      };

      items.sort((a, b) => {
        if (sort_by === 'planned_date') {
          const dateA = a.planned_date || '9999-99-99';
          const dateB = b.planned_date || '9999-99-99';
          return sort_dir === 'desc' ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
        }

        if (sort_by === 'delivery_date') {
          const dateA = a.expected_delivery_date || '9999-99-99';
          const dateB = b.expected_delivery_date || '9999-99-99';
          return sort_dir === 'desc' ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
        }

        if (sort_by === 'remaining_qty') {
          return sort_dir === 'desc'
            ? b.remaining_production_qty - a.remaining_production_qty
            : a.remaining_production_qty - b.remaining_production_qty;
        }

        if (sort_by === 'job_card_number') {
          return sort_dir === 'desc'
            ? b.job_card_number.localeCompare(a.job_card_number)
            : a.job_card_number.localeCompare(b.job_card_number);
        }

        // Default sorting:
        // 1. Priority (URGENT > HIGH > NORMAL > LOW)
        const pDiff = (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
        if (pDiff !== 0) return pDiff;

        // 2. Delivery urgency / expected delivery date ASC
        const delA = a.expected_delivery_date || '9999-99-99';
        const delB = b.expected_delivery_date || '9999-99-99';
        const delDiff = delA.localeCompare(delB);
        if (delDiff !== 0) return delDiff;

        // 3. Job Card number ASC
        return a.job_card_number.localeCompare(b.job_card_number);
      });

      return res.json(items);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 2. GET /api/production-planning/summary
router.get(
  '/summary',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const sql = `
        SELECT 
          jc.id as job_card_id,
          jc.allocated_qty,
          jc.plating_process,
          jc.priority as default_priority,
          jc.status as job_card_status,
          cpi.id as inward_id,
          cpi.status as inward_status,
          cpi.accepted_qty as inward_accepted_qty,
          co.expected_delivery_date,
          pp.id as plan_id,
          pp.priority as plan_priority,
          pp.planned_date,
          COALESCE((
            SELECT SUM(processed_qty)
            FROM production_executions
            WHERE job_card_id = jc.id AND status = 'COMPLETED'
          ), 0) as completed_production_qty,
          COALESCE((
            SELECT COUNT(*)
            FROM production_executions
            WHERE job_card_id = jc.id AND status = 'IN_PROGRESS'
          ), 0) as in_progress_runs_count
        FROM job_cards jc
        LEFT JOIN production_plans pp ON pp.job_card_id = jc.id
        JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
        JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
        JOIN customer_orders co ON coi.customer_order_id = co.id
      `;

      const result = await query(sql);
      const todayStr = new Date().toISOString().slice(0, 10);

      let totalReady = 0;
      let totalPlanned = 0;
      let totalInQueue = 0;
      let totalInProduction = 0;
      let totalCompleted = 0;
      let totalBlocked = 0;
      let urgentJobs = 0;
      let overdueJobs = 0;
      let todayPlannedJobs = 0;
      let totalPendingQty = 0;

      for (const r of result.rows) {
        const allocated = parseFloat(r.allocated_qty || '0');
        const completed = parseFloat(r.completed_production_qty || '0');
        const remaining = Math.max(0, Math.round((allocated - completed) * 10000) / 10000);

        const deliveryInfo = calculateDeliveryUrgency(r.expected_delivery_date);
        const effectivePriority = r.plan_priority || r.default_priority || 'NORMAL';

        const statusInfo = derivePlanningStatus({
          jobCardStatus: r.job_card_status,
          inwardId: r.inward_id,
          inwardStatus: r.inward_status,
          inwardAcceptedQty: parseFloat(r.inward_accepted_qty || '0'),
          allocatedQty: allocated,
          platingProcess: r.plating_process,
          remainingQty: remaining,
          activeInProgressCount: parseInt(r.in_progress_runs_count || '0', 10),
          hasPlan: Boolean(r.plan_id),
          plannedDate: r.planned_date
        });

        switch (statusInfo.planning_status) {
          case 'READY':
            totalReady++;
            break;
          case 'PLANNED':
            totalPlanned++;
            break;
          case 'IN_QUEUE':
            totalInQueue++;
            break;
          case 'IN_PRODUCTION':
            totalInProduction++;
            break;
          case 'COMPLETED':
            totalCompleted++;
            break;
          case 'BLOCKED':
            totalBlocked++;
            break;
        }

        // Only count pending jobs towards urgency and pending quantity
        if (statusInfo.planning_status !== 'COMPLETED' && statusInfo.planning_status !== 'BLOCKED') {
          totalPendingQty += remaining;
          if (effectivePriority === 'URGENT') {
            urgentJobs++;
          }
          if (deliveryInfo.delivery_urgency === 'OVERDUE') {
            overdueJobs++;
          }
          if (r.planned_date === todayStr) {
            todayPlannedJobs++;
          }
        }
      }

      return res.json({
        total_ready: totalReady,
        total_planned: totalPlanned,
        total_in_queue: totalInQueue,
        total_in_production: totalInProduction,
        total_completed: totalCompleted,
        total_blocked: totalBlocked,
        urgent_jobs: urgentJobs,
        overdue_jobs: overdueJobs,
        today_planned_jobs: todayPlannedJobs,
        total_pending_qty: Math.round(totalPendingQty * 10000) / 10000
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 3. GET /api/production-planning/:jobCardId
router.get(
  '/:jobCardId',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { jobCardId } = req.params;

      const sql = `
        SELECT 
          jc.*,
          t.code as tank_code,
          t.display_name as tank_name,
          cpi.inward_number,
          cpi.challan_number,
          cpi.received_date as inward_received_date,
          cpi.accepted_qty as inward_accepted_qty,
          cpi.rejected_qty as inward_rejected_qty,
          cpi.status as inward_status,
          co.id as customer_order_id,
          co.order_number,
          co.customer_po_number,
          co.order_date,
          co.expected_delivery_date,
          c.id as customer_id,
          c.name as customer_name,
          c.code as customer_code,
          c.gst_number as customer_gstin,
          p.id as part_id,
          p.part_number,
          p.part_name,
          p.base_unit,
          pp.id as plan_id,
          pp.priority as plan_priority,
          pp.planned_date,
          pp.planned_start_time,
          pp.planning_notes,
          pp.created_at as planned_at,
          u.name as planned_by_name,
          COALESCE((
            SELECT SUM(processed_qty)
            FROM production_executions
            WHERE job_card_id = jc.id AND status = 'COMPLETED'
          ), 0) as completed_production_qty,
          COALESCE((
            SELECT COUNT(*)
            FROM production_executions
            WHERE job_card_id = jc.id AND status = 'IN_PROGRESS'
          ), 0) as in_progress_runs_count
        FROM job_cards jc
        LEFT JOIN production_plans pp ON pp.job_card_id = jc.id
        LEFT JOIN users u ON pp.created_by_user_id = u.id
        JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
        JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
        JOIN customer_orders co ON coi.customer_order_id = co.id
        JOIN customers c ON co.customer_id = c.id
        JOIN parts p ON coi.part_id = p.id
        LEFT JOIN tanks t ON jc.tank_id = t.id
        WHERE jc.id = ?
      `;

      const result = await query(sql, [jobCardId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Job Card not found' });
      }

      const r = result.rows[0];
      const allocated = parseFloat(r.allocated_qty || '0');
      const completed = parseFloat(r.completed_production_qty || '0');
      const remaining = Math.max(0, Math.round((allocated - completed) * 10000) / 10000);

      const deliveryUrgencyInfo = calculateDeliveryUrgency(r.expected_delivery_date);
      const effectivePriority = r.plan_priority || r.priority || 'NORMAL';

      const statusInfo = derivePlanningStatus({
        jobCardStatus: r.status,
        inwardId: r.customer_parts_inward_id,
        inwardStatus: r.inward_status,
        inwardAcceptedQty: parseFloat(r.inward_accepted_qty || '0'),
        allocatedQty: allocated,
        platingProcess: r.plating_process,
        remainingQty: remaining,
        activeInProgressCount: parseInt(r.in_progress_runs_count || '0', 10),
        hasPlan: Boolean(r.plan_id),
        plannedDate: r.planned_date
      });

      // Get existing production executions for this job card
      const prodRes = await query(
        `SELECT pe.*, u.name as operator_name, t.code as tank_code, t.display_name as tank_name
         FROM production_executions pe
         LEFT JOIN users u ON pe.operator_user_id = u.id
         LEFT JOIN tanks t ON pe.tank_id = t.id
         WHERE pe.job_card_id = ?
         ORDER BY pe.production_date DESC, pe.created_at DESC`,
        [jobCardId]
      );

      return res.json({
        job_card: {
          id: r.id,
          job_card_number: r.job_card_number,
          status: r.status,
          allocated_qty: allocated,
          plating_process: r.plating_process,
          target_thickness_microns: r.target_thickness_microns != null ? parseFloat(r.target_thickness_microns) : null,
          tank_id: r.tank_id,
          tank_code: r.tank_code,
          tank_name: r.tank_name || (r.tank_code ? r.tank_code : 'UNASSIGNED'),
          notes: r.notes
        },
        order: {
          id: r.customer_order_id,
          order_number: r.order_number,
          customer_po_number: r.customer_po_number,
          order_date: r.order_date,
          expected_delivery_date: r.expected_delivery_date,
          days_until_delivery: deliveryUrgencyInfo.days_until_delivery,
          delivery_urgency: deliveryUrgencyInfo.delivery_urgency
        },
        customer: {
          id: r.customer_id,
          name: r.customer_name,
          code: r.customer_code,
          gstin: r.customer_gstin
        },
        part: {
          id: r.part_id,
          part_number: r.part_number,
          part_name: r.part_name,
          base_unit: r.base_unit || 'pcs'
        },
        inward: {
          id: r.customer_parts_inward_id,
          inward_number: r.inward_number,
          challan_number: r.challan_number,
          received_date: r.inward_received_date,
          accepted_qty: parseFloat(r.inward_accepted_qty || '0'),
          rejected_qty: parseFloat(r.inward_rejected_qty || '0'),
          status: r.inward_status
        },
        planning: {
          is_planned: Boolean(r.plan_id),
          plan_id: r.plan_id || null,
          priority: effectivePriority,
          planned_date: r.planned_date || null,
          planned_start_time: r.planned_start_time || null,
          planning_notes: r.planning_notes || null,
          planned_by_user_name: r.planned_by_name || null,
          planned_at: r.planned_at || null,
          planning_status: statusInfo.planning_status,
          blocking_reason: statusInfo.blocking_reason
        },
        production_metrics: {
          allocated_qty: allocated,
          completed_production_qty: completed,
          remaining_production_qty: remaining,
          executions_count: prodRes.rows.length
        },
        production_executions: prodRes.rows.map(p => ({
          ...p,
          planned_qty: parseFloat(p.planned_qty),
          processed_qty: parseFloat(p.processed_qty),
          rejected_qty: parseFloat(p.rejected_qty)
        }))
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 4. POST /api/production-planning/:jobCardId/plan
router.get
router.post(
  '/:jobCardId/plan',
  authenticateToken,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { jobCardId } = req.params;
      const { priority, planned_date, planned_start_time, planning_notes, tank_id } = req.body;

      // 1. Verify Job Card exists
      const jcRes = await query(`SELECT * FROM job_cards WHERE id = ?`, [jobCardId]);
      if (jcRes.rows.length === 0) {
        return res.status(404).json({ error: 'Job Card not found' });
      }
      const jc = jcRes.rows[0];

      if (jc.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Cannot plan a cancelled Job Card' });
      }

      // 2. Validate priority
      const validPriorities = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
      const effectivePriority = priority ? priority.toUpperCase() : 'NORMAL';
      if (!validPriorities.includes(effectivePriority)) {
        return res.status(400).json({ error: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` });
      }

      // 3. Optional tank reference update on Job Card if explicitly provided
      if (tank_id) {
        const tankRes = await query(`SELECT id FROM tanks WHERE id = ? AND is_active = 1`, [tank_id]);
        if (tankRes.rows.length === 0) {
          return res.status(400).json({ error: 'Selected plating tank not found or inactive' });
        }
        await query(`UPDATE job_cards SET tank_id = ? WHERE id = ?`, [tank_id, jobCardId]);
      }

      // 4. Upsert into production_plans
      const existingPlan = await query(`SELECT id FROM production_plans WHERE job_card_id = ?`, [jobCardId]);
      const now = new Date().toISOString();

      let planId: string;
      if (existingPlan.rows.length > 0) {
        planId = existingPlan.rows[0].id;
        await query(
          `UPDATE production_plans 
           SET priority = ?, planned_date = ?, planned_start_time = ?, planning_notes = ?, 
               created_by_user_id = ?, updated_at = ?
           WHERE id = ?`,
          [
            effectivePriority,
            planned_date || null,
            planned_start_time || null,
            planning_notes || null,
            req.user!.id,
            now,
            planId
          ]
        );
      } else {
        planId = uuidv4();
        await query(
          `INSERT INTO production_plans (
             id, job_card_id, priority, planned_date, planned_start_time,
             planning_notes, created_by_user_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            planId,
            jobCardId,
            effectivePriority,
            planned_date || null,
            planned_start_time || null,
            planning_notes || null,
            req.user!.id,
            now,
            now
          ]
        );
      }

      // 5. Log audit event
      await logAuditEvent({
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: 'PRODUCTION_PLAN_UPDATED',
        recordRef: jc.job_card_number,
        changedValues: {
          job_card_id: jobCardId,
          priority: effectivePriority,
          planned_date: planned_date || null,
          planned_start_time: planned_start_time || null,
          planning_notes: planning_notes || null,
          tank_id: tank_id || jc.tank_id
        },
        reason: 'Workboard production planning update'
      });

      const updatedPlanRes = await query(`SELECT * FROM production_plans WHERE id = ?`, [planId]);
      return res.json({
        success: true,
        message: 'Production planning saved successfully',
        plan: updatedPlanRes.rows[0]
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 5. POST /api/production-planning/:jobCardId/unplan
router.post(
  '/:jobCardId/unplan',
  authenticateToken,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { jobCardId } = req.params;

      const jcRes = await query(`SELECT job_card_number FROM job_cards WHERE id = ?`, [jobCardId]);
      if (jcRes.rows.length === 0) {
        return res.status(404).json({ error: 'Job Card not found' });
      }

      await query(`DELETE FROM production_plans WHERE job_card_id = ?`, [jobCardId]);

      await logAuditEvent({
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: 'PRODUCTION_PLAN_REMOVED',
        recordRef: jcRes.rows[0].job_card_number,
        changedValues: { job_card_id: jobCardId },
        reason: 'Production planning metadata removed'
      });

      return res.json({
        success: true,
        message: 'Job Card planning metadata removed successfully'
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
