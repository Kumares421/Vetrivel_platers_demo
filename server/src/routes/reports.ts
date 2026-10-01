import { Router, Response } from 'express';
import { query } from '../db';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Helper for IST date range boundaries (start of From-Date inclusive to start of day after To-Date exclusive)
function getISTDateBoundaries(fromDateQuery?: any, toDateQuery?: any) {
  const fromDateStr = (fromDateQuery as string) || '1970-01-01';
  const toDateStr = (toDateQuery as string) || new Date().toISOString().slice(0, 10);

  // IST 00:00:00 start of From Date
  const fromDateISTStart = `${fromDateStr}T00:00:00+05:30`;
  const fromDateUTCStart = new Date(fromDateISTStart).toISOString();

  // IST 00:00:00 start of day AFTER To Date (exclusive)
  const toDateNextObj = new Date(`${toDateStr}T00:00:00+05:30`);
  toDateNextObj.setDate(toDateNextObj.getDate() + 1);
  const toDateUTCNextStart = toDateNextObj.toISOString();

  return {
    fromDateStr,
    toDateStr,
    fromDateUTCStart,
    toDateUTCNextStart
  };
}

const handleLedgerReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const fromQuery = req.query.from_date || req.query.start_date;
    const toQuery = req.query.to_date || req.query.end_date;
    const chemicalIdQuery = req.query.chemical_id;

    const { fromDateStr, toDateStr, fromDateUTCStart, toDateUTCNextStart } = getISTDateBoundaries(fromQuery, toQuery);

    let chemicalFilter = '';
    const params: any[] = [];
    if (chemicalIdQuery) {
      chemicalFilter = ' WHERE id = ?';
      params.push(chemicalIdQuery);
    }

    const chemsRes = await query(`SELECT id, code, name, base_unit, min_stock_level FROM chemicals ${chemicalFilter} ORDER BY code ASC`, params);
    const chemicals = chemsRes.rows;

    const ledgerEntries = [];

    for (const chem of chemicals) {
      // 1. Opening Balance: net stock movements strictly BEFORE start of From-Date
      const opRes = await query(
        `SELECT COALESCE(SUM(quantity_change), 0) as op_balance
         FROM stock_movements
         WHERE chemical_id = ? AND (movement_date < ? OR (movement_date < ? AND movement_date NOT LIKE '%Z'))`,
        [chem.id, fromDateUTCStart, `${fromDateStr}T00:00:00`]
      );
      const openingBalance = parseFloat(opRes.rows[0]?.op_balance || '0');

      // 2. Period Movements breakdown (from start of From-Date to start of day after To-Date)
      const movRes = await query(
        `SELECT 
           COALESCE(SUM(CASE WHEN movement_type IN ('RECEIPT', 'OPENING_STOCK') THEN quantity_change ELSE 0 END), 0) as total_receipts,
           COALESCE(SUM(CASE WHEN movement_type = 'ISSUE' THEN ABS(quantity_change) ELSE 0 END), 0) as total_issues,
           COALESCE(SUM(CASE WHEN movement_type IN ('ADJUSTMENT', 'QUARANTINE', 'UNBLOCK', 'COUNT_CORRECTION', 'DAMAGE_WRITE_OFF') THEN quantity_change ELSE 0 END), 0) as total_adjustments,
           COALESCE(SUM(CASE WHEN movement_type IN ('REVERSAL_RECEIPT', 'REVERSAL_ISSUE') THEN quantity_change ELSE 0 END), 0) as total_reversals
         FROM stock_movements
         WHERE chemical_id = ? AND (
           (movement_date >= ? AND movement_date < ?) OR
           (movement_date >= ? AND movement_date <= ?)
         )`,
        [chem.id, fromDateUTCStart, toDateUTCNextStart, `${fromDateStr}T00:00:00`, `${toDateStr}T23:59:59.999`]
      );

      const m = movRes.rows[0];
      const receipts = parseFloat(m?.total_receipts || '0');
      const issues = parseFloat(m?.total_issues || '0');
      const adjustments = parseFloat(m?.total_adjustments || '0');
      const reversals = parseFloat(m?.total_reversals || '0');
      const netAdjustments = Math.round((adjustments + reversals) * 10000) / 10000;

      const closingBalance = Math.round((openingBalance + receipts - issues + netAdjustments) * 10000) / 10000;

      ledgerEntries.push({
        chemical_id: chem.id,
        chemical_code: chem.code,
        chemical_name: chem.name,
        base_unit: chem.base_unit,
        // Property aliases for full frontend compatibility
        opening_balance: openingBalance,
        opening_stock: openingBalance,
        total_receipts: receipts,
        total_received: receipts,
        inward_receipts: receipts,
        total_issues: issues,
        total_issued: issues,
        issues: issues,
        net_adjustments: netAdjustments,
        total_adjustments: netAdjustments,
        adjustments: netAdjustments,
        closing_balance: closingBalance,
        closing_stock: closingBalance
      });
    }

    return res.json({
      report_title: 'Chemical Stock Ledger Report',
      company_name: 'Vetrivel Platers',
      powered_by: 'Powered by Qelanto Technologies',
      period: { from: fromDateStr, to: toDateStr },
      generated_at: new Date().toISOString(),
      generated_by: req.user?.name,
      entries: ledgerEntries
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// 1. GET /api/reports/ledger & GET /api/reports/historical-stock-ledger
router.get('/ledger', authenticateToken, handleLedgerReport);
router.get('/historical-stock-ledger', authenticateToken, handleLedgerReport);

// 2. GET /api/reports/inward (Purchase / Inward Register)
router.get('/inward', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from_date, to_date, supplier_id, chemical_id } = req.query;

    let sql = `
      SELECT 
        l.id as lot_id, l.lot_number, l.supplier_batch_number, l.initial_qty, l.remaining_qty,
        l.rate_per_unit, l.line_amount, l.expiry_date, l.actual_received_at, l.status,
        c.code as chemical_code, c.name as chemical_name, c.base_unit,
        s.name as supplier_name, pr.bill_number, pr.bill_date, pr.receipt_number
      FROM receipt_lots l
      JOIN chemicals c ON l.chemical_id = c.id
      LEFT JOIN purchase_receipts pr ON l.purchase_receipt_id = pr.id
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      WHERE pr.status = 'POSTED' OR l.is_opening_stock = true
    `;
    const params: any[] = [];

    if (from_date) {
      sql += ` AND l.actual_received_at >= ?`;
      params.push(`${from_date}T00:00:00.000Z`);
    }
    if (to_date) {
      sql += ` AND l.actual_received_at <= ?`;
      params.push(`${to_date}T23:59:59.999Z`);
    }
    if (supplier_id) {
      sql += ` AND pr.supplier_id = ?`;
      params.push(supplier_id);
    }
    if (chemical_id) {
      sql += ` AND l.chemical_id = ?`;
      params.push(chemical_id);
    }

    sql += ` ORDER BY l.actual_received_at DESC`;

    const result = await query(sql, params);
    const rows = result.rows.map(r => ({
      ...r,
      initial_qty: parseFloat(r.initial_qty),
      remaining_qty: parseFloat(r.remaining_qty),
      rate_per_unit: r.rate_per_unit != null ? parseFloat(r.rate_per_unit) : null,
      line_amount: r.line_amount != null ? parseFloat(r.line_amount) : null
    }));

    return res.json({
      report_title: 'Purchase / Inward Chemical Register',
      company_name: 'Vetrivel Platers',
      period: { from: from_date || 'All', to: to_date || 'All' },
      generated_at: new Date().toISOString(),
      generated_by: req.user?.name,
      rows
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/reports/issues (Chemical Issue Register & Tank-wise)
router.get('/issues', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from_date, to_date, tank_id, chemical_id } = req.query;

    let sql = `
      SELECT 
        ci.id as issue_id, ci.issue_number, ci.issue_date, ci.required_qty, ci.job_reference,
        ci.total_allocated_value, ci.remarks, ci.status,
        c.code as chemical_code, c.name as chemical_name, c.base_unit,
        t.code as tank_code, t.display_name as tank_name, u.name as issued_by_name
      FROM chemical_issues ci
      JOIN chemicals c ON ci.chemical_id = c.id
      JOIN tanks t ON ci.tank_id = t.id
      JOIN users u ON ci.issued_by_user_id = u.id
      WHERE ci.status = 'POSTED'
    `;
    const params: any[] = [];

    if (from_date) {
      sql += ` AND ci.issue_date >= ?`;
      params.push(`${from_date}T00:00:00.000Z`);
    }
    if (to_date) {
      sql += ` AND ci.issue_date <= ?`;
      params.push(`${to_date}T23:59:59.999Z`);
    }
    if (tank_id) {
      sql += ` AND ci.tank_id = ?`;
      params.push(tank_id);
    }
    if (chemical_id) {
      sql += ` AND ci.chemical_id = ?`;
      params.push(chemical_id);
    }

    sql += ` ORDER BY ci.issue_date DESC`;

    const result = await query(sql, params);

    const rows = result.rows.map(r => ({
      ...r,
      required_qty: parseFloat(r.required_qty),
      total_allocated_value: parseFloat(r.total_allocated_value || '0')
    }));

    return res.json({
      report_title: 'Chemical Issue Register',
      company_name: 'Vetrivel Platers',
      period: { from: from_date || 'All', to: to_date || 'All' },
      generated_at: new Date().toISOString(),
      generated_by: req.user?.name,
      rows
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/reports/fifo-allocations (FIFO Exception & Allocation Breakdown)
router.get('/fifo-allocations', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        fa.id, fa.allocated_qty, fa.rate_per_unit, fa.allocation_value,
        ci.issue_number, ci.issue_date, ci.override_reason,
        c.code as chemical_code, c.name as chemical_name, c.base_unit,
        t.display_name as tank_name,
        l.lot_number, l.supplier_batch_number, l.actual_received_at as lot_received_at,
        COALESCE(pr.bill_number, 'OPENING-STOCK') as bill_number
      FROM fifo_allocations fa
      JOIN chemical_issues ci ON fa.chemical_issue_id = ci.id
      JOIN chemicals c ON ci.chemical_id = c.id
      JOIN tanks t ON ci.tank_id = t.id
      JOIN receipt_lots l ON fa.receipt_lot_id = l.id
      LEFT JOIN purchase_receipts pr ON l.purchase_receipt_id = pr.id
      ORDER BY ci.issue_date DESC, fa.created_at ASC
    `;
    const result = await query(sql);

    const rows = result.rows.map(r => ({
      ...r,
      allocated_qty: parseFloat(r.allocated_qty),
      rate_per_unit: r.rate_per_unit != null ? parseFloat(r.rate_per_unit) : null,
      allocation_value: r.allocation_value != null ? parseFloat(r.allocation_value) : null
    }));

    return res.json({
      report_title: 'FIFO Allocation & Audit Trace Register',
      company_name: 'Vetrivel Platers',
      generated_at: new Date().toISOString(),
      generated_by: req.user?.name,
      rows
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Helper for IST calendar YYYY-MM-DD date calculation
function getISTCalendarDate(offsetDays: number = 0, baseDate: Date = new Date()): string {
  const istStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(baseDate);
  const [year, month, day] = istStr.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

// 5. GET /api/reports/low-stock-expiry
router.get('/low-stock-expiry', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const todayIST = getISTCalendarDate(0);
    const day30IST = getISTCalendarDate(30);

    // 1. Low stock chemicals: calculate current available issuable stock for all active chemicals with min_stock_level > 0
    // Below minimum: total_available < min_stock_level (strictly less than)
    const lowStockSql = `
      SELECT 
        c.id, c.code, c.name, c.base_unit, c.min_stock_level,
        COALESCE(
          (SELECT SUM(l.remaining_qty)
           FROM receipt_lots l
           WHERE l.chemical_id = c.id
             AND l.remaining_qty > 0
             AND l.status = 'AVAILABLE'
             AND (l.expiry_date IS NULL OR l.expiry_date = '' OR SUBSTR(l.expiry_date, 1, 10) >= ?)
          ), 0
        ) as total_available
      FROM chemicals c
      WHERE (c.is_active = 1 OR c.is_active = true) AND c.min_stock_level > 0
      ORDER BY c.code ASC
    `;

    const lowStockRes = await query(lowStockSql, [todayIST]);

    const lowStockItems = lowStockRes.rows
      .map(r => {
        const minStock = parseFloat(r.min_stock_level || '0');
        const totalAvail = parseFloat(r.total_available || '0');
        return {
          ...r,
          min_stock_level: minStock,
          total_available: totalAvail,
          shortfall: Math.max(0, Math.round((minStock - totalAvail) * 10000) / 10000)
        };
      })
      .filter(r => r.total_available < r.min_stock_level);

    // 2. Expiring & Expired Lots: remaining_qty > 0, expiry_date <= day30IST, excluding EXHAUSTED & CANCELLED lots
    // Includes QUARANTINED lots with their status preserved.
    const expiringSql = `
      SELECT 
        l.id, l.lot_number, l.supplier_batch_number, l.remaining_qty, l.expiry_date, l.status,
        c.code as chemical_code, c.name as chemical_name, c.base_unit
      FROM receipt_lots l
      JOIN chemicals c ON l.chemical_id = c.id
      WHERE l.remaining_qty > 0 
        AND l.status NOT IN ('EXHAUSTED', 'CANCELLED')
        AND l.expiry_date IS NOT NULL 
        AND l.expiry_date != ''
        AND SUBSTR(l.expiry_date, 1, 10) <= ?
      ORDER BY l.expiry_date ASC, l.lot_number ASC
    `;

    const expiringRes = await query(expiringSql, [day30IST]);

    const expiringLots = expiringRes.rows.map(r => {
      const expDateStr = r.expiry_date ? r.expiry_date.slice(0, 10) : '';
      const isExpired = expDateStr < todayIST;
      return {
        ...r,
        remaining_qty: parseFloat(r.remaining_qty || '0'),
        expiry_date: expDateStr,
        is_expired: isExpired,
        expiry_status: isExpired ? 'EXPIRED' : 'EXPIRING_SOON'
      };
    });

    return res.json({
      report_title: 'Low Stock & Expiry Alert Report',
      company_name: 'Vetrivel Platers',
      generated_at: new Date().toISOString(),
      generated_by: req.user?.name,
      as_of_date_ist: todayIST,
      low_stock_chemicals: lowStockItems,
      low_stock_items: lowStockItems, // dual alias for complete compatibility
      expiring_lots: expiringLots
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 6. GET /api/reports/dashboard-stats (Authoritative Real ERP Metrics)
router.get('/dashboard-stats', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const todayIST = getISTCalendarDate(0);

    // 1. Active Customer Orders count
    const ordersRes = await query(
      `SELECT COUNT(*) as count FROM customer_orders WHERE status IN ('CONFIRMED', 'IN_PRODUCTION')`
    );
    const activeOrdersCount = parseInt(ordersRes.rows[0]?.count || '0', 10);

    // 2. Parts Awaiting Job Allocation count (inwards with unallocated accepted quantity)
    const awaitingInwardsRes = await query(`
      SELECT COUNT(*) as count FROM customer_parts_inward cpi
      WHERE cpi.status = 'RECEIVED'
        AND (cpi.accepted_qty - (
          SELECT COALESCE(SUM(allocated_qty), 0) 
          FROM job_cards 
          WHERE customer_parts_inward_id = cpi.id AND status != 'CANCELLED'
        )) > 0
    `);
    const awaitingJobAllocCount = parseInt(awaitingInwardsRes.rows[0]?.count || '0', 10);

    // 3. Jobs Ready for Production count
    const jobsRes = await query(
      `SELECT COUNT(*) as count FROM job_cards WHERE status = 'RELEASED'`
    );
    const jobsReadyCount = parseInt(jobsRes.rows[0]?.count || '0', 10);

    // 4. Today's Chemical Receipts count and total qty grouped by unit
    const todayReceiptsRes = await query(
      `SELECT 
         COUNT(DISTINCT pr.id) as receipts_count,
         c.base_unit,
         COALESCE(SUM(l.initial_qty), 0) as total_qty
       FROM purchase_receipts pr
       JOIN receipt_lots l ON pr.id = l.purchase_receipt_id
       JOIN chemicals c ON l.chemical_id = c.id
       WHERE pr.status = 'POSTED' AND SUBSTR(pr.actual_received_at, 1, 10) = ?
       GROUP BY c.base_unit`,
      [todayIST]
    );

    const receiptsByUnit: Record<string, number> = {};
    let todayReceiptsCount = 0;
    for (const r of todayReceiptsRes.rows) {
      receiptsByUnit[r.base_unit] = parseFloat(r.total_qty || '0');
      todayReceiptsCount = Math.max(todayReceiptsCount, parseInt(r.receipts_count || '0', 10));
    }

    // 5. Today's Chemical Issues count and total qty grouped by unit
    const todayIssuesRes = await query(
      `SELECT 
         COUNT(ci.id) as issues_count,
         c.base_unit,
         COALESCE(SUM(ci.required_qty), 0) as total_qty
       FROM chemical_issues ci
       JOIN chemicals c ON ci.chemical_id = c.id
       WHERE ci.status = 'POSTED' AND SUBSTR(ci.issue_date, 1, 10) = ?
       GROUP BY c.base_unit`,
      [todayIST]
    );

    const issuesByUnit: Record<string, number> = {};
    let todayIssuesCount = 0;
    for (const r of todayIssuesRes.rows) {
      issuesByUnit[r.base_unit] = parseFloat(r.total_qty || '0');
      todayIssuesCount = Math.max(todayIssuesCount, parseInt(r.issues_count || '0', 10));
    }

    // 6. Recent Chemical Receipts (last 5)
    const recentChemReceiptsRes = await query(`
      SELECT 
        pr.id, pr.receipt_number, pr.bill_number, pr.bill_date, pr.actual_received_at,
        s.name as supplier_name,
        (SELECT COUNT(*) FROM receipt_lots WHERE purchase_receipt_id = pr.id) as line_count
      FROM purchase_receipts pr
      JOIN suppliers s ON pr.supplier_id = s.id
      WHERE pr.status = 'POSTED'
      ORDER BY pr.actual_received_at DESC
      LIMIT 5
    `);

    // 8. Production Execution Metrics
    let prodInProgressCount = 0;
    let prodCompletedCount = 0;
    let qtyInProduction = 0;
    let totalActiveJobCardsCount = 0;

    try {
      const activeJobsRes = await query(`SELECT COUNT(*) as count FROM job_cards WHERE status IN ('RELEASED', 'IN_PROGRESS')`);
      totalActiveJobCardsCount = parseInt(activeJobsRes.rows[0]?.count || '0', 10);

      const prodRes = await query(`
        SELECT 
          status, 
          COUNT(*) as count, 
          COALESCE(SUM(planned_qty - processed_qty - rejected_qty), 0) as remaining_qty
        FROM production_executions 
        WHERE status IN ('IN_PROGRESS', 'COMPLETED')
        GROUP BY status
      `);
      for (const row of prodRes.rows) {
        if (row.status === 'IN_PROGRESS') {
          prodInProgressCount = parseInt(row.count, 10);
          qtyInProduction = Math.max(0, parseFloat(row.remaining_qty || '0'));
        } else if (row.status === 'COMPLETED') {
          prodCompletedCount = parseInt(row.count, 10);
        }
      }
    } catch (e) {
      // Table may be empty or pending migration
    }

    // 7. Quality Control (QC) live metrics
    let qcPendingCount = 0;
    let qcPassedCount = 0;
    let qcFailedCount = 0;
    let quantityAwaitingQc = 0;

    try {
      // Completed productions awaiting QC inspection
      const pendingQcRes = await query(`
        SELECT 
          pe.processed_qty,
          COALESCE((
            SELECT SUM(inspected_qty) 
            FROM qc_inspections 
            WHERE production_execution_id = pe.id
          ), 0) as inspected_qty
        FROM production_executions pe
        WHERE pe.status = 'COMPLETED'
      `);

      for (const row of pendingQcRes.rows) {
        const proc = parseFloat(row.processed_qty || '0');
        const insp = parseFloat(row.inspected_qty || '0');
        const uninspected = Math.max(0, proc - insp);
        if (uninspected > 0) {
          qcPendingCount++;
          quantityAwaitingQc += uninspected;
        }
      }

      // Count of PASS and FAIL inspections
      const qcStatsRes = await query(`
        SELECT status, COUNT(*) as count
        FROM qc_inspections
        WHERE status IN ('PASS', 'FAIL')
        GROUP BY status
      `);

      for (const row of qcStatsRes.rows) {
        if (row.status === 'PASS') {
          qcPassedCount = parseInt(row.count, 10);
        } else if (row.status === 'FAIL') {
          qcFailedCount = parseInt(row.count, 10);
        }
      }
    } catch (e) {
      // Table may be pending migration
    }

    // 8. Dispatch live metrics
    let dispatchPendingCount = 0;
    let dispatchCompletedCount = 0;
    let quantityReadyForDispatch = 0;
    let quantityDispatched = 0;

    try {
      // Pending dispatch: QC PASS with un-dispatched accepted balance
      const pendingDispRes = await query(`
        SELECT 
          qc.accepted_qty,
          COALESCE((
            SELECT SUM(dispatched_qty)
            FROM dispatches
            WHERE qc_inspection_id = qc.id AND status != 'CANCELLED'
          ), 0) as already_dispatched
        FROM qc_inspections qc
        JOIN production_executions pe ON qc.production_execution_id = pe.id
        WHERE pe.status = 'COMPLETED'
          AND qc.status = 'PASS'
          AND qc.accepted_qty > 0
      `);

      for (const row of pendingDispRes.rows) {
        const acc = parseFloat(row.accepted_qty || '0');
        const disp = parseFloat(row.already_dispatched || '0');
        const rem = Math.max(0, acc - disp);
        if (rem > 0) {
          dispatchPendingCount++;
          quantityReadyForDispatch += rem;
        }
      }

      // Dispatched counts & totals
      const dispTotalRes = await query(`
        SELECT 
          COUNT(*) as completed_count,
          COALESCE(SUM(dispatched_qty), 0) as total_qty
        FROM dispatches
        WHERE status = 'DISPATCHED'
      `);
      if (dispTotalRes.rows.length > 0) {
        dispatchCompletedCount = parseInt(dispTotalRes.rows[0].completed_count || '0', 10);
        quantityDispatched = parseFloat(dispTotalRes.rows[0].total_qty || '0');
      }
    } catch (e) {
      // Table may be pending migration
    }

    // 9. Invoice live metrics
    let invoicePendingCount = 0;
    let invoiceIssuedCount = 0;
    let invoiceCancelledCount = 0;
    let invoiceableQuantity = 0;
    let totalInvoicedValue = 0;
    let currentMonthInvoiceValue = 0;

    try {
      // Pending dispatches with remaining invoiceable balance
      const pendingInvRes = await query(`
        SELECT 
          d.dispatched_qty,
          COALESCE((
            SELECT SUM(il.quantity)
            FROM invoice_lines il
            JOIN invoices inv ON il.invoice_id = inv.id
            WHERE il.dispatch_id = d.id AND inv.status != 'CANCELLED'
          ), 0) as already_invoiced
        FROM dispatches d
        JOIN qc_inspections qc ON d.qc_inspection_id = qc.id
        JOIN production_executions pe ON d.production_execution_id = pe.id
        WHERE d.status = 'DISPATCHED'
          AND pe.status = 'COMPLETED'
          AND qc.status = 'PASS'
          AND d.dispatched_qty > 0
      `);

      for (const row of pendingInvRes.rows) {
        const disp = parseFloat(row.dispatched_qty || '0');
        const inv = parseFloat(row.already_invoiced || '0');
        const rem = Math.max(0, disp - inv);
        if (rem > 0) {
          invoicePendingCount++;
          invoiceableQuantity += rem;
        }
      }

      // Invoice status counts & monetary sums
      const currentMonthPrefix = todayIST.slice(0, 7); // 'YYYY-MM'
      const invStatsRes = await query(`
        SELECT 
          status,
          COUNT(*) as count,
          COALESCE(SUM(total_amount), 0) as total_val,
          COALESCE(SUM(CASE WHEN SUBSTR(invoice_date, 1, 7) = ? THEN total_amount ELSE 0 END), 0) as current_month_val
        FROM invoices
        GROUP BY status
      `, [currentMonthPrefix]);

      for (const row of invStatsRes.rows) {
        if (row.status === 'ISSUED') {
          invoiceIssuedCount = parseInt(row.count, 10);
          totalInvoicedValue = parseFloat(row.total_val || '0');
          currentMonthInvoiceValue = parseFloat(row.current_month_val || '0');
        } else if (row.status === 'CANCELLED') {
          invoiceCancelledCount = parseInt(row.count, 10);
        }
      }
    } catch (e) {
      // Table may be pending migration
    }

    // 10. Payment live metrics
    let paymentPendingInvoiceCount = 0;
    let totalOutstandingAmount = 0;
    let paymentsReceivedToday = 0;
    let paymentsReceivedCurrentMonth = 0;
    let totalPaymentsReceived = 0;
    let cancelledPaymentCount = 0;

    try {
      const currentMonthPrefix = todayIST.slice(0, 7); // 'YYYY-MM'

      // Outstanding balances across all ISSUED invoices
      const outstandingRes = await query(`
        SELECT 
          inv.total_amount,
          COALESCE((
            SELECT SUM(pa.allocated_amount)
            FROM payment_allocations pa
            JOIN payments p ON pa.payment_id = p.id
            WHERE pa.invoice_id = inv.id AND p.status != 'CANCELLED'
          ), 0) as paid_amount
        FROM invoices inv
        WHERE inv.status = 'ISSUED' AND inv.total_amount > 0
      `);

      for (const row of outstandingRes.rows) {
        const tot = parseFloat(row.total_amount || '0');
        const pd = parseFloat(row.paid_amount || '0');
        const rem = Math.max(0, Math.round((tot - pd) * 100) / 100);
        if (rem > 0) {
          paymentPendingInvoiceCount++;
          totalOutstandingAmount += rem;
        }
      }

      // Payments aggregates
      const payStatsRes = await query(`
        SELECT 
          status,
          COUNT(*) as count,
          COALESCE(SUM(amount), 0) as total_val,
          COALESCE(SUM(CASE WHEN SUBSTR(payment_date, 1, 10) = ? THEN amount ELSE 0 END), 0) as today_val,
          COALESCE(SUM(CASE WHEN SUBSTR(payment_date, 1, 7) = ? THEN amount ELSE 0 END), 0) as month_val
        FROM payments
        GROUP BY status
      `, [todayIST, currentMonthPrefix]);

      for (const row of payStatsRes.rows) {
        if (row.status === 'RECEIVED') {
          totalPaymentsReceived = parseFloat(row.total_val || '0');
          paymentsReceivedToday = parseFloat(row.today_val || '0');
          paymentsReceivedCurrentMonth = parseFloat(row.month_val || '0');
        } else if (row.status === 'CANCELLED') {
          cancelledPaymentCount = parseInt(row.count, 10);
        }
      }
    } catch (e) {
      // Table may be pending migration
    }

    // 11. Recent Customer Parts Inwards (last 5)
    const recentInwardsRes = await query(`
      SELECT 
        cpi.id, cpi.inward_number, cpi.challan_number, cpi.received_date, cpi.accepted_qty, cpi.rejected_qty,
        c.name as customer_name, p.part_number, p.part_name, p.base_unit
      FROM customer_parts_inward cpi
      JOIN customer_orders co ON cpi.customer_order_id = co.id
      JOIN customer_order_items coi ON cpi.customer_order_item_id = coi.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON co.customer_id = c.id
      WHERE cpi.status = 'RECEIVED'
      ORDER BY cpi.created_at DESC
      LIMIT 5
    `);

    return res.json({
      active_customer_orders_count: activeOrdersCount,
      parts_awaiting_job_allocation_count: awaitingJobAllocCount,
      jobs_ready_for_production_count: jobsReadyCount,
      total_active_job_cards_count: totalActiveJobCardsCount,
      production_in_progress_count: prodInProgressCount,
      production_completed_count: prodCompletedCount,
      quantity_in_production: qtyInProduction,
      qc_pending_count: qcPendingCount,
      qc_passed_count: qcPassedCount,
      qc_failed_count: qcFailedCount,
      quantity_awaiting_qc: quantityAwaitingQc,
      dispatch_pending_count: dispatchPendingCount,
      dispatch_completed_count: dispatchCompletedCount,
      quantity_ready_for_dispatch: quantityReadyForDispatch,
      quantity_dispatched: quantityDispatched,
      invoice_pending_count: invoicePendingCount,
      invoice_issued_count: invoiceIssuedCount,
      invoice_cancelled_count: invoiceCancelledCount,
      invoiceable_quantity: invoiceableQuantity,
      total_invoiced_value: totalInvoicedValue,
      current_month_invoice_value: currentMonthInvoiceValue,
      payment_pending_invoice_count: paymentPendingInvoiceCount,
      total_outstanding_amount: Math.round(totalOutstandingAmount * 100) / 100,
      payments_received_today: paymentsReceivedToday,
      payments_received_current_month: paymentsReceivedCurrentMonth,
      total_payments_received: totalPaymentsReceived,
      cancelled_payment_count: cancelledPaymentCount,
      today_chemical_receipts_count: todayReceiptsCount,
      today_chemical_receipts_by_unit: receiptsByUnit,
      today_chemical_issues_count: todayIssuesCount,
      today_chemical_issues_by_unit: issuesByUnit,
      recent_chemical_receipts: recentChemReceiptsRes.rows,
      recent_customer_inwards: recentInwardsRes.rows
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

