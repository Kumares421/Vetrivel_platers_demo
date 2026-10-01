import { Router, Response } from 'express';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Helper: Determine overall lifecycle stage of an order
function determineLifecycleStage(
  orderStatus: string,
  inwardCount: number,
  jobCount: number,
  prodCount: number,
  qcCount: number,
  dispCount: number,
  invCount: number,
  payCount: number,
  invTotal: number,
  paidTotal: number
): string {
  if (orderStatus === 'CANCELLED') return 'CANCELLED';
  if (invCount > 0 && paidTotal >= invTotal && invTotal > 0) return 'SETTLED';
  if (invCount > 0) return 'INVOICED';
  if (dispCount > 0) return 'DISPATCHED';
  if (qcCount > 0) return 'QC_INSPECTED';
  if (prodCount > 0) return 'IN_PRODUCTION';
  if (jobCount > 0) return 'JOB_CARD_RELEASED';
  if (inwardCount > 0) return 'PARTS_RECEIVED';
  if (orderStatus === 'CONFIRMED') return 'ORDER_CONFIRMED';
  return 'DRAFT';
}

// 1. GET /api/traceability/order/:id (Full End-to-End Traceability from Order)
router.get(
  '/order/:id',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      // 1. Customer Order Header
      const orderSql = `
        SELECT 
          co.*,
          c.id as customer_id, c.name as customer_name, c.code as customer_code, c.gst_number as customer_gstin,
          c.address as customer_address, c.phone as customer_phone, c.email as customer_email,
          u.name as created_by_name, cu.name as confirmed_by_name
        FROM customer_orders co
        JOIN customers c ON co.customer_id = c.id
        JOIN users u ON co.created_by_user_id = u.id
        LEFT JOIN users cu ON co.confirmed_by_user_id = cu.id
        WHERE co.id = ?
      `;
      const orderRes = await query(orderSql, [id]);
      if (orderRes.rows.length === 0) {
        return res.status(404).json({ error: 'Customer order not found' });
      }
      const order = orderRes.rows[0];

      // 2. Order Lines
      const itemsSql = `
        SELECT 
          coi.*,
          p.part_number, p.part_name, p.base_unit
        FROM customer_order_items coi
        JOIN parts p ON coi.part_id = p.id
        WHERE coi.customer_order_id = ?
        ORDER BY coi.created_at ASC
      `;
      const itemsRes = await query(itemsSql, [id]);
      const orderItems = itemsRes.rows.map(it => ({
        ...it,
        quantity: parseFloat(it.quantity),
        rate: parseFloat(it.rate),
        line_amount: parseFloat(it.line_amount)
      }));

      // 3. Parts Inward Receipts
      const inwardSql = `
        SELECT 
          cpi.*,
          p.part_number, p.part_name, p.base_unit,
          u.name as received_by_name
        FROM customer_parts_inward cpi
        JOIN customer_order_items coi ON cpi.customer_order_item_id = coi.id
        JOIN parts p ON coi.part_id = p.id
        JOIN users u ON cpi.received_by_user_id = u.id
        WHERE cpi.customer_order_id = ?
        ORDER BY cpi.received_date ASC, cpi.created_at ASC
      `;
      const inwardRes = await query(inwardSql, [id]);
      const inwards = inwardRes.rows.map(inw => ({
        ...inw,
        accepted_qty: parseFloat(inw.accepted_qty),
        rejected_qty: parseFloat(inw.rejected_qty)
      }));

      // 4. Job Cards
      const jobCardsSql = `
        SELECT 
          jc.*,
          cpi.inward_number, cpi.challan_number,
          p.part_number, p.part_name, p.base_unit,
          t.code as tank_code, t.display_name as tank_name,
          u.name as released_by_name
        FROM job_cards jc
        JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
        JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
        JOIN parts p ON coi.part_id = p.id
        JOIN users u ON jc.released_by_user_id = u.id
        LEFT JOIN tanks t ON jc.tank_id = t.id
        WHERE cpi.customer_order_id = ?
        ORDER BY jc.created_at ASC
      `;
      const jobCardsRes = await query(jobCardsSql, [id]);
      const jobCards = jobCardsRes.rows.map(jc => ({
        ...jc,
        allocated_qty: parseFloat(jc.allocated_qty),
        target_thickness_microns: jc.target_thickness_microns != null ? parseFloat(jc.target_thickness_microns) : null
      }));

      // 5. Production Executions
      const prodSql = `
        SELECT 
          pe.*,
          jc.job_card_number,
          t.code as tank_code, t.display_name as tank_name,
          u.name as operator_name
        FROM production_executions pe
        JOIN job_cards jc ON pe.job_card_id = jc.id
        JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
        JOIN users u ON pe.operator_user_id = u.id
        LEFT JOIN tanks t ON pe.tank_id = t.id
        WHERE cpi.customer_order_id = ?
        ORDER BY pe.production_date ASC, pe.created_at ASC
      `;
      const prodRes = await query(prodSql, [id]);
      const productionExecutions = prodRes.rows.map(pe => ({
        ...pe,
        planned_qty: parseFloat(pe.planned_qty),
        processed_qty: parseFloat(pe.processed_qty),
        rejected_qty: parseFloat(pe.rejected_qty)
      }));

      // 6. QC Inspections
      const qcSql = `
        SELECT 
          qc.*,
          pe.production_number,
          jc.job_card_number,
          u.name as inspector_name
        FROM qc_inspections qc
        JOIN production_executions pe ON qc.production_execution_id = pe.id
        JOIN job_cards jc ON qc.job_card_id = jc.id
        JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
        JOIN users u ON qc.inspector_user_id = u.id
        WHERE cpi.customer_order_id = ?
        ORDER BY qc.inspection_date ASC, qc.created_at ASC
      `;
      const qcRes = await query(qcSql, [id]);
      const qcInspections = qcRes.rows.map(qc => ({
        ...qc,
        inspected_qty: parseFloat(qc.inspected_qty),
        accepted_qty: parseFloat(qc.accepted_qty),
        rejected_qty: parseFloat(qc.rejected_qty)
      }));

      // 7. Dispatches
      const dispSql = `
        SELECT 
          d.*,
          jc.job_card_number,
          pe.production_number,
          qc.qc_number,
          u.name as dispatched_by_name
        FROM dispatches d
        JOIN job_cards jc ON d.job_card_id = jc.id
        JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
        JOIN production_executions pe ON d.production_execution_id = pe.id
        JOIN qc_inspections qc ON d.qc_inspection_id = qc.id
        JOIN users u ON d.dispatched_by_user_id = u.id
        WHERE cpi.customer_order_id = ?
        ORDER BY d.dispatch_date ASC, d.created_at ASC
      `;
      const dispRes = await query(dispSql, [id]);
      const dispatches = dispRes.rows.map(d => ({
        ...d,
        dispatched_qty: parseFloat(d.dispatched_qty)
      }));

      // 8. Invoices & Lines
      const invSql = `
        SELECT DISTINCT
          inv.*,
          u.name as created_by_name
        FROM invoices inv
        JOIN invoice_lines il ON il.invoice_id = inv.id
        JOIN job_cards jc ON il.job_card_id = jc.id
        JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
        JOIN users u ON inv.created_by_user_id = u.id
        WHERE cpi.customer_order_id = ?
        ORDER BY inv.invoice_date ASC, inv.created_at ASC
      `;
      const invRes = await query(invSql, [id]);
      const invoices = invRes.rows.map(inv => ({
        ...inv,
        subtotal: parseFloat(inv.subtotal),
        cgst_amount: parseFloat(inv.cgst_amount),
        sgst_amount: parseFloat(inv.sgst_amount),
        igst_amount: parseFloat(inv.igst_amount),
        tax_amount: parseFloat(inv.tax_amount),
        total_amount: parseFloat(inv.total_amount)
      }));

      // 9. Payments & Allocations against these Invoices
      let payments: any[] = [];
      if (invoices.length > 0) {
        const invIds = invoices.map(i => i.id);
        const placeholders = invIds.map(() => '?').join(',');
        const paySql = `
          SELECT 
            p.*,
            pa.allocated_amount,
            pa.id as allocation_id,
            inv.invoice_number,
            u.name as received_by_name
          FROM payments p
          JOIN payment_allocations pa ON pa.payment_id = p.id
          JOIN invoices inv ON pa.invoice_id = inv.id
          JOIN users u ON p.received_by_user_id = u.id
          WHERE pa.invoice_id IN (${placeholders}) AND p.status != 'CANCELLED'
          ORDER BY p.payment_date ASC, p.created_at ASC
        `;
        const payRes = await query(paySql, invIds);
        payments = payRes.rows.map(p => ({
          ...p,
          amount: parseFloat(p.amount),
          allocated_amount: parseFloat(p.allocated_amount)
        }));
      }

      // Summary Metrics Calculations
      const totalOrderedQty = parseFloat(order.total_quantity);
      const totalInwardAccepted = inwards.filter(i => i.status === 'RECEIVED').reduce((acc, i) => acc + i.accepted_qty, 0);
      const totalInwardRejected = inwards.filter(i => i.status === 'RECEIVED').reduce((acc, i) => acc + i.rejected_qty, 0);
      const totalJobAllocated = jobCards.filter(j => j.status !== 'CANCELLED').reduce((acc, j) => acc + j.allocated_qty, 0);
      const totalProdProcessed = productionExecutions.filter(p => p.status !== 'CANCELLED').reduce((acc, p) => acc + p.processed_qty, 0);
      const totalQcAccepted = qcInspections.filter(q => q.status === 'PASS').reduce((acc, q) => acc + q.accepted_qty, 0);
      const totalDispatched = dispatches.filter(d => d.status === 'DISPATCHED').reduce((acc, d) => acc + d.dispatched_qty, 0);
      const totalInvoicedVal = invoices.filter(i => i.status === 'ISSUED').reduce((acc, i) => acc + i.total_amount, 0);
      const totalPaidVal = payments.reduce((acc, p) => acc + p.allocated_amount, 0);

      const lifecycleStage = determineLifecycleStage(
        order.status,
        inwards.length,
        jobCards.length,
        productionExecutions.length,
        qcInspections.length,
        dispatches.length,
        invoices.length,
        payments.length,
        totalInvoicedVal,
        totalPaidVal
      );

      return res.json({
        order: {
          ...order,
          total_quantity: totalOrderedQty,
          total_amount: parseFloat(order.total_amount)
        },
        order_items: orderItems,
        inwards,
        job_cards: jobCards,
        production_executions: productionExecutions,
        qc_inspections: qcInspections,
        dispatches,
        invoices,
        payments,
        summary: {
          ordered_qty: totalOrderedQty,
          inward_accepted_qty: totalInwardAccepted,
          inward_rejected_qty: totalInwardRejected,
          remaining_to_inward: Math.max(0, Math.round((totalOrderedQty - totalInwardAccepted - totalInwardRejected) * 10000) / 10000),
          job_allocated_qty: totalJobAllocated,
          remaining_to_allocate: Math.max(0, Math.round((totalInwardAccepted - totalJobAllocated) * 10000) / 10000),
          production_processed_qty: totalProdProcessed,
          qc_accepted_qty: totalQcAccepted,
          dispatched_qty: totalDispatched,
          remaining_to_dispatch: Math.max(0, Math.round((totalQcAccepted - totalDispatched) * 10000) / 10000),
          invoiced_amount: Math.round(totalInvoicedVal * 100) / 100,
          paid_amount: Math.round(totalPaidVal * 100) / 100,
          outstanding_amount: Math.max(0, Math.round((totalInvoicedVal - totalPaidVal) * 100) / 100),
          lifecycle_stage: lifecycleStage
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 2. GET /api/traceability/job-card/:id (Job Card Upstream & Downstream Lineage)
router.get(
  '/job-card/:id',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const jobSql = `
        SELECT 
          jc.*,
          cpi.inward_number, cpi.challan_number, cpi.challan_date, cpi.received_date, cpi.accepted_qty as inward_accepted_qty,
          co.id as customer_order_id, co.order_number, co.customer_po_number, co.order_date, co.status as order_status,
          c.id as customer_id, c.name as customer_name, c.code as customer_code, c.gst_number as customer_gstin,
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

      const jobRes = await query(jobSql, [id]);
      if (jobRes.rows.length === 0) {
        return res.status(404).json({ error: 'Job Card not found' });
      }
      const job = jobRes.rows[0];

      // Downstream: Production
      const prodRes = await query(
        `SELECT pe.*, u.name as operator_name 
         FROM production_executions pe 
         JOIN users u ON pe.operator_user_id = u.id 
         WHERE pe.job_card_id = ? 
         ORDER BY pe.created_at ASC`,
        [id]
      );

      // Downstream: QC
      const qcRes = await query(
        `SELECT qc.*, pe.production_number, u.name as inspector_name 
         FROM qc_inspections qc 
         JOIN production_executions pe ON qc.production_execution_id = pe.id 
         JOIN users u ON qc.inspector_user_id = u.id 
         WHERE qc.job_card_id = ? 
         ORDER BY qc.created_at ASC`,
        [id]
      );

      // Downstream: Dispatches
      const dispRes = await query(
        `SELECT d.*, pe.production_number, qc.qc_number, u.name as dispatched_by_name 
         FROM dispatches d 
         JOIN production_executions pe ON d.production_execution_id = pe.id 
         JOIN qc_inspections qc ON d.qc_inspection_id = qc.id 
         JOIN users u ON d.dispatched_by_user_id = u.id 
         WHERE d.job_card_id = ? 
         ORDER BY d.created_at ASC`,
        [id]
      );

      // Downstream: Invoices
      const invRes = await query(
        `SELECT DISTINCT inv.*, il.quantity as invoiced_job_qty, il.line_total as invoiced_job_val 
         FROM invoices inv 
         JOIN invoice_lines il ON il.invoice_id = inv.id 
         WHERE il.job_card_id = ? 
         ORDER BY inv.invoice_date ASC`,
        [id]
      );

      return res.json({
        job_card: {
          ...job,
          allocated_qty: parseFloat(job.allocated_qty)
        },
        upstream: {
          customer_id: job.customer_id,
          customer_name: job.customer_name,
          customer_code: job.customer_code,
          customer_gstin: job.customer_gstin,
          customer_order_id: job.customer_order_id,
          order_number: job.order_number,
          customer_po_number: job.customer_po_number,
          order_date: job.order_date,
          order_status: job.order_status,
          customer_parts_inward_id: job.customer_parts_inward_id,
          inward_number: job.inward_number,
          challan_number: job.challan_number,
          received_date: job.received_date,
          part_number: job.part_number,
          part_name: job.part_name,
          base_unit: job.base_unit
        },
        downstream: {
          production_executions: prodRes.rows.map(p => ({
            ...p,
            planned_qty: parseFloat(p.planned_qty),
            processed_qty: parseFloat(p.processed_qty),
            rejected_qty: parseFloat(p.rejected_qty)
          })),
          qc_inspections: qcRes.rows.map(q => ({
            ...q,
            inspected_qty: parseFloat(q.inspected_qty),
            accepted_qty: parseFloat(q.accepted_qty),
            rejected_qty: parseFloat(q.rejected_qty)
          })),
          dispatches: dispRes.rows.map(d => ({
            ...d,
            dispatched_qty: parseFloat(d.dispatched_qty)
          })),
          invoices: invRes.rows.map(i => ({
            ...i,
            total_amount: parseFloat(i.total_amount)
          }))
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 3. GET /api/traceability/search (Quick Traceability Search by Document / Identifier)
router.get(
  '/search',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const q = ((req.query.q as string) || '').trim();
      if (!q) {
        return res.json({ orders: [], job_cards: [] });
      }

      const pat = `%${q}%`;

      // Search Orders
      const orderSql = `
        SELECT 
          co.id, co.order_number, co.customer_po_number, co.order_date, co.status,
          co.total_quantity, co.total_amount,
          c.name as customer_name, c.code as customer_code
        FROM customer_orders co
        JOIN customers c ON co.customer_id = c.id
        WHERE co.order_number LIKE ? OR co.customer_po_number LIKE ? OR c.name LIKE ? OR c.code LIKE ?
        ORDER BY co.order_date DESC
        LIMIT 10
      `;
      const orderRes = await query(orderSql, [pat, pat, pat, pat]);

      // Search Job Cards
      const jobSql = `
        SELECT 
          jc.id, jc.job_card_number, jc.plating_process, jc.allocated_qty, jc.status,
          co.order_number, c.name as customer_name, p.part_number, p.part_name
        FROM job_cards jc
        JOIN customer_parts_inward cpi ON jc.customer_parts_inward_id = cpi.id
        JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
        JOIN customer_orders co ON coi.customer_order_id = co.id
        JOIN parts p ON coi.part_id = p.id
        JOIN customers c ON co.customer_id = c.id
        WHERE jc.job_card_number LIKE ? OR cpi.inward_number LIKE ? OR cpi.challan_number LIKE ? OR p.part_number LIKE ?
        ORDER BY jc.created_at DESC
        LIMIT 10
      `;
      const jobRes = await query(jobSql, [pat, pat, pat, pat]);

      return res.json({
        orders: orderRes.rows.map(o => ({
          ...o,
          total_quantity: parseFloat(o.total_quantity),
          total_amount: parseFloat(o.total_amount)
        })),
        job_cards: jobRes.rows.map(j => ({
          ...j,
          allocated_qty: parseFloat(j.allocated_qty)
        }))
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
