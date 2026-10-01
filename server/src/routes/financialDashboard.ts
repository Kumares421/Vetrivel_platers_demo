import { Router, Response } from 'express';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Helper: Calculate days old between invoice date and as_of_date
function calculateDaysOld(invoiceDateStr: string, asOfDateStr: string): number {
  const invDate = new Date(invoiceDateStr);
  const asOfDate = new Date(asOfDateStr);
  const diffTime = asOfDate.getTime() - invDate.getTime();
  return Math.max(0, Math.floor(diffTime / (1000 * 3600 * 24)));
}

// Helper: Map days old to standard ERP Ageing Bucket
function getAgeingBucket(daysOld: number): 'CURRENT' | '1_30' | '31_60' | '61_90' | '90_PLUS' {
  if (daysOld === 0) return 'CURRENT';
  if (daysOld <= 30) return '1_30';
  if (daysOld <= 60) return '31_60';
  if (daysOld <= 90) return '61_90';
  return '90_PLUS';
}

// Helper: Get Current and Previous month keys (YYYY-MM)
function getMonthKeys(asOfDateStr?: string) {
  const ref = asOfDateStr ? new Date(asOfDateStr) : new Date();
  const curY = ref.getFullYear();
  const curM = ref.getMonth(); // 0-indexed
  const curKey = `${curY}-${String(curM + 1).padStart(2, '0')}`;

  const prevDate = new Date(curY, curM - 1, 1);
  const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  return { curKey, prevKey };
}

// 1. GET /api/financial-dashboard/summary (Executive KPI Cards)
router.get(
  '/summary',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);
      const { from_date, to_date } = req.query;
      const { curKey, prevKey } = getMonthKeys(asOfDate);

      // --- A. REVENUE & RECEIVABLES & GST (from invoices) ---
      let invSql = `
        SELECT 
          inv.id as invoice_id,
          inv.invoice_number,
          inv.invoice_date,
          inv.customer_id,
          inv.subtotal,
          inv.cgst_amount,
          inv.sgst_amount,
          inv.igst_amount,
          inv.tax_amount,
          inv.total_amount,
          COALESCE((
            SELECT SUM(pa.allocated_amount)
            FROM payment_allocations pa
            JOIN payments p ON pa.payment_id = p.id
            WHERE pa.invoice_id = inv.id 
              AND p.status != 'CANCELLED'
              AND p.payment_date <= ?
          ), 0) as paid_amount
        FROM invoices inv
        WHERE inv.status = 'ISSUED' AND inv.invoice_date <= ?
      `;
      const invParams: any[] = [asOfDate, asOfDate];

      if (from_date) {
        invSql += ` AND inv.invoice_date >= ?`;
        invParams.push(from_date);
      }
      if (to_date) {
        invSql += ` AND inv.invoice_date <= ?`;
        invParams.push(to_date);
      }

      const invResult = await query(invSql, invParams);

      let totalInvoicedValue = 0;
      let totalTaxableValue = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;
      let totalGst = 0;

      let curMonthRevenue = 0;
      let prevMonthRevenue = 0;

      let totalOutstanding = 0;
      let currentOutstanding = 0;
      let overdueOutstanding = 0;
      let outstandingInvoiceCount = 0;

      const buckets = {
        current: 0,
        days_1_30: 0,
        days_31_60: 0,
        days_61_90: 0,
        days_90_plus: 0
      };

      for (const row of invResult.rows) {
        const invTotal = parseFloat(row.total_amount || '0');
        const subtotal = parseFloat(row.subtotal || '0');
        const cgst = parseFloat(row.cgst_amount || '0');
        const sgst = parseFloat(row.sgst_amount || '0');
        const igst = parseFloat(row.igst_amount || '0');
        const gst = parseFloat(row.tax_amount || '0');
        const paid = parseFloat(row.paid_amount || '0');
        const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);

        totalInvoicedValue += invTotal;
        totalTaxableValue += subtotal;
        totalCgst += cgst;
        totalSgst += sgst;
        totalIgst += igst;
        totalGst += gst;

        if (row.invoice_date && row.invoice_date.startsWith(curKey)) {
          curMonthRevenue += invTotal;
        }
        if (row.invoice_date && row.invoice_date.startsWith(prevKey)) {
          prevMonthRevenue += invTotal;
        }

        if (outstanding > 0) {
          totalOutstanding += outstanding;
          outstandingInvoiceCount++;

          const daysOld = calculateDaysOld(row.invoice_date, asOfDate);
          const bucket = getAgeingBucket(daysOld);

          if (daysOld === 0) {
            currentOutstanding += outstanding;
            buckets.current += outstanding;
          } else {
            overdueOutstanding += outstanding;
            if (bucket === '1_30') buckets.days_1_30 += outstanding;
            else if (bucket === '31_60') buckets.days_31_60 += outstanding;
            else if (bucket === '61_90') buckets.days_61_90 += outstanding;
            else if (bucket === '90_PLUS') buckets.days_90_plus += outstanding;
          }
        }
      }

      // If date range filter was passed, query current and prev month revenue separately if not covered
      if (from_date || to_date) {
        const mRevSql = `
          SELECT 
            strftime('%Y-%m', invoice_date) as m_key,
            COALESCE(SUM(total_amount), 0) as m_total
          FROM invoices
          WHERE status = 'ISSUED' AND (strftime('%Y-%m', invoice_date) = ? OR strftime('%Y-%m', invoice_date) = ?)
          GROUP BY m_key
        `;
        const mRevRes = await query(mRevSql, [curKey, prevKey]);
        for (const mr of mRevRes.rows) {
          if (mr.m_key === curKey) curMonthRevenue = parseFloat(mr.m_total || '0');
          if (mr.m_key === prevKey) prevMonthRevenue = parseFloat(mr.m_total || '0');
        }
      }

      const invoiceCount = invResult.rows.length;
      const averageInvoiceValue = invoiceCount > 0 ? totalInvoicedValue / invoiceCount : 0;

      let revenueGrowthPct = 0;
      if (prevMonthRevenue > 0) {
        revenueGrowthPct = ((curMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100;
      } else if (curMonthRevenue > 0) {
        revenueGrowthPct = 100;
      }

      // --- B. COLLECTIONS & PAYMENTS ---
      let paySql = `
        SELECT 
          p.id,
          p.amount,
          p.payment_date,
          p.status,
          COALESCE((
            SELECT SUM(pa.allocated_amount)
            FROM payment_allocations pa
            JOIN invoices inv ON pa.invoice_id = inv.id
            WHERE pa.payment_id = p.id AND inv.status != 'CANCELLED'
          ), 0) as allocated_amount
        FROM payments p
        WHERE 1=1
      `;
      const payParams: any[] = [];

      if (from_date) {
        paySql += ` AND p.payment_date >= ?`;
        payParams.push(from_date);
      }
      if (to_date) {
        paySql += ` AND p.payment_date <= ?`;
        payParams.push(to_date);
      } else {
        paySql += ` AND p.payment_date <= ?`;
        payParams.push(asOfDate);
      }

      const payResult = await query(paySql, payParams);

      let totalPaymentsReceived = 0;
      let totalAllocatedAmount = 0;
      let curMonthCollections = 0;
      let prevMonthCollections = 0;
      let cancelledPaymentCount = 0;

      for (const p of payResult.rows) {
        if (p.status === 'CANCELLED') {
          cancelledPaymentCount++;
          continue;
        }

        const amt = parseFloat(p.amount || '0');
        const alloc = parseFloat(p.allocated_amount || '0');

        totalPaymentsReceived += amt;
        totalAllocatedAmount += alloc;

        if (p.payment_date && p.payment_date.startsWith(curKey)) {
          curMonthCollections += amt;
        }
        if (p.payment_date && p.payment_date.startsWith(prevKey)) {
          prevMonthCollections += amt;
        }
      }

      const unallocatedPaymentAmount = Math.max(0, totalPaymentsReceived - totalAllocatedAmount);
      const collectionRatePct = totalInvoicedValue > 0 ? (totalPaymentsReceived / totalInvoicedValue) * 100 : 0;

      // --- C. OPERATIONAL PIPELINE COUNTS ---
      let opParams: any[] = [];
      let opDateClause = '';
      if (from_date && to_date) {
        opDateClause = `WHERE created_at >= ? AND created_at <= ?`;
        opParams = [from_date, to_date];
      }

      const prodRes = await query(`SELECT COUNT(*) as c FROM production_executions WHERE status != 'CANCELLED'`, []);
      const qcPassRes = await query(`SELECT COUNT(*) as c FROM qc_inspections WHERE status = 'PASS'`, []);
      const qcFailRes = await query(`SELECT COUNT(*) as c FROM qc_inspections WHERE status = 'FAIL'`, []);
      const dispRes = await query(`SELECT COUNT(*) as c FROM dispatches WHERE status = 'DISPATCHED'`, []);

      return res.json({
        as_of_date: asOfDate,
        revenue: {
          total_invoiced_value: Math.round(totalInvoicedValue * 100) / 100,
          current_month_revenue: Math.round(curMonthRevenue * 100) / 100,
          previous_month_revenue: Math.round(prevMonthRevenue * 100) / 100,
          revenue_growth_pct: Math.round(revenueGrowthPct * 100) / 100,
          invoice_count: invoiceCount,
          average_invoice_value: Math.round(averageInvoiceValue * 100) / 100
        },
        receivables: {
          total_outstanding: Math.round(totalOutstanding * 100) / 100,
          current_outstanding: Math.round(currentOutstanding * 100) / 100,
          overdue_outstanding: Math.round(overdueOutstanding * 100) / 100,
          outstanding_invoice_count: outstandingInvoiceCount,
          buckets: {
            current: Math.round(buckets.current * 100) / 100,
            days_1_30: Math.round(buckets.days_1_30 * 100) / 100,
            days_31_60: Math.round(buckets.days_31_60 * 100) / 100,
            days_61_90: Math.round(buckets.days_61_90 * 100) / 100,
            days_90_plus: Math.round(buckets.days_90_plus * 100) / 100
          }
        },
        collections: {
          total_payments_received: Math.round(totalPaymentsReceived * 100) / 100,
          current_month_collections: Math.round(curMonthCollections * 100) / 100,
          previous_month_collections: Math.round(prevMonthCollections * 100) / 100,
          collection_rate_pct: Math.round(collectionRatePct * 100) / 100,
          unallocated_payment_amount: Math.round(unallocatedPaymentAmount * 100) / 100,
          cancelled_payment_count: cancelledPaymentCount
        },
        gst: {
          taxable_value: Math.round(totalTaxableValue * 100) / 100,
          cgst_amount: Math.round(totalCgst * 100) / 100,
          sgst_amount: Math.round(totalSgst * 100) / 100,
          igst_amount: Math.round(totalIgst * 100) / 100,
          total_gst: Math.round(totalGst * 100) / 100
        },
        operational: {
          production_count: parseInt(prodRes.rows[0]?.c || '0', 10),
          qc_passed_count: parseInt(qcPassRes.rows[0]?.c || '0', 10),
          qc_failed_count: parseInt(qcFailRes.rows[0]?.c || '0', 10),
          dispatch_count: parseInt(dispRes.rows[0]?.c || '0', 10),
          invoiced_count: invoiceCount,
          payment_received_count: payResult.rows.filter(p => p.status !== 'CANCELLED').length
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 2. GET /api/financial-dashboard/revenue (Detailed Revenue Report)
router.get(
  '/revenue',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from_date, to_date, customer_id, search } = req.query;

      let sql = `
        SELECT 
          inv.id as invoice_id,
          inv.invoice_number,
          inv.invoice_date,
          inv.subtotal as taxable_value,
          inv.cgst_amount,
          inv.sgst_amount,
          inv.igst_amount,
          inv.tax_amount as total_gst,
          inv.total_amount as invoice_total,
          inv.place_of_supply,
          c.id as customer_id,
          c.name as customer_name,
          c.code as customer_code,
          c.gst_number as customer_gstin
        FROM invoices inv
        JOIN customers c ON inv.customer_id = c.id
        WHERE inv.status = 'ISSUED'
      `;
      const params: any[] = [];

      if (from_date) {
        sql += ` AND inv.invoice_date >= ?`;
        params.push(from_date);
      }
      if (to_date) {
        sql += ` AND inv.invoice_date <= ?`;
        params.push(to_date);
      }
      if (customer_id) {
        sql += ` AND inv.customer_id = ?`;
        params.push(customer_id);
      }
      if (search) {
        sql += ` AND (inv.invoice_number LIKE ? OR c.name LIKE ? OR c.code LIKE ? OR c.gst_number LIKE ?)`;
        const pat = `%${search}%`;
        params.push(pat, pat, pat, pat);
      }

      sql += ` ORDER BY inv.invoice_date DESC, inv.invoice_number DESC`;

      const result = await query(sql, params);

      let grandTaxable = 0;
      let grandCgst = 0;
      let grandSgst = 0;
      let grandIgst = 0;
      let grandGst = 0;
      let grandTotal = 0;

      const customerMap = new Map<string, any>();
      const monthlyMap = new Map<string, any>();

      const invoiceList = result.rows.map(row => {
        const taxable = parseFloat(row.taxable_value || '0');
        const cgst = parseFloat(row.cgst_amount || '0');
        const sgst = parseFloat(row.sgst_amount || '0');
        const igst = parseFloat(row.igst_amount || '0');
        const gst = parseFloat(row.total_gst || '0');
        const total = parseFloat(row.invoice_total || '0');

        grandTaxable += taxable;
        grandCgst += cgst;
        grandSgst += sgst;
        grandIgst += igst;
        grandGst += gst;
        grandTotal += total;

        // Customer Aggregation
        const cKey = row.customer_id;
        if (!customerMap.has(cKey)) {
          customerMap.set(cKey, {
            customer_id: cKey,
            customer_code: row.customer_code,
            customer_name: row.customer_name,
            customer_gstin: row.customer_gstin || 'UNREGISTERED',
            invoice_count: 0,
            taxable_value: 0,
            total_gst: 0,
            total_revenue: 0
          });
        }
        const cData = customerMap.get(cKey);
        cData.invoice_count++;
        cData.taxable_value += taxable;
        cData.total_gst += gst;
        cData.total_revenue += total;

        // Monthly Aggregation
        const mKey = (row.invoice_date || '').slice(0, 7);
        if (mKey) {
          if (!monthlyMap.has(mKey)) {
            monthlyMap.set(mKey, {
              month: mKey,
              invoice_count: 0,
              taxable_value: 0,
              total_gst: 0,
              total_revenue: 0
            });
          }
          const mData = monthlyMap.get(mKey);
          mData.invoice_count++;
          mData.taxable_value += taxable;
          mData.total_gst += gst;
          mData.total_revenue += total;
        }

        return {
          invoice_id: row.invoice_id,
          invoice_number: row.invoice_number,
          invoice_date: row.invoice_date,
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          customer_code: row.customer_code,
          customer_gstin: row.customer_gstin || 'UNREGISTERED',
          place_of_supply: row.place_of_supply || 'Tamil Nadu',
          taxable_value: Math.round(taxable * 100) / 100,
          cgst_amount: Math.round(cgst * 100) / 100,
          sgst_amount: Math.round(sgst * 100) / 100,
          igst_amount: Math.round(igst * 100) / 100,
          total_gst: Math.round(gst * 100) / 100,
          invoice_total: Math.round(total * 100) / 100
        };
      });

      const customerSummary = Array.from(customerMap.values()).map(c => ({
        ...c,
        taxable_value: Math.round(c.taxable_value * 100) / 100,
        total_gst: Math.round(c.total_gst * 100) / 100,
        total_revenue: Math.round(c.total_revenue * 100) / 100
      })).sort((a, b) => b.total_revenue - a.total_revenue);

      const monthlySummary = Array.from(monthlyMap.values()).map(m => ({
        ...m,
        taxable_value: Math.round(m.taxable_value * 100) / 100,
        total_gst: Math.round(m.total_gst * 100) / 100,
        total_revenue: Math.round(m.total_revenue * 100) / 100
      })).sort((a, b) => b.month.localeCompare(a.month));

      return res.json({
        summary: {
          invoice_count: invoiceList.length,
          taxable_value: Math.round(grandTaxable * 100) / 100,
          cgst_amount: Math.round(grandCgst * 100) / 100,
          sgst_amount: Math.round(grandSgst * 100) / 100,
          igst_amount: Math.round(grandIgst * 100) / 100,
          total_gst: Math.round(grandGst * 100) / 100,
          total_revenue: Math.round(grandTotal * 100) / 100,
          average_invoice_value: invoiceList.length > 0 ? Math.round((grandTotal / invoiceList.length) * 100) / 100 : 0
        },
        monthly_revenue: monthlySummary,
        customer_revenue: customerSummary,
        invoices: invoiceList
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 3. GET /api/financial-dashboard/receivables (Detailed Receivables & Ageing)
router.get(
  '/receivables',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);
      const { from_date, to_date, customer_id, search } = req.query;

      let sql = `
        SELECT 
          inv.id as invoice_id,
          inv.invoice_number,
          inv.invoice_date,
          inv.total_amount as invoice_total,
          c.id as customer_id,
          c.name as customer_name,
          c.code as customer_code,
          c.gst_number as customer_gstin,
          COALESCE((
            SELECT SUM(pa.allocated_amount)
            FROM payment_allocations pa
            JOIN payments p ON pa.payment_id = p.id
            WHERE pa.invoice_id = inv.id 
              AND p.status != 'CANCELLED'
              AND p.payment_date <= ?
          ), 0) as paid_amount
        FROM invoices inv
        JOIN customers c ON inv.customer_id = c.id
        WHERE inv.status = 'ISSUED' AND inv.invoice_date <= ?
      `;
      const params: any[] = [asOfDate, asOfDate];

      if (from_date) {
        sql += ` AND inv.invoice_date >= ?`;
        params.push(from_date);
      }
      if (to_date) {
        sql += ` AND inv.invoice_date <= ?`;
        params.push(to_date);
      }
      if (customer_id) {
        sql += ` AND inv.customer_id = ?`;
        params.push(customer_id);
      }
      if (search) {
        sql += ` AND (inv.invoice_number LIKE ? OR c.name LIKE ? OR c.code LIKE ?)`;
        const pat = `%${search}%`;
        params.push(pat, pat, pat);
      }

      sql += ` ORDER BY inv.invoice_date ASC, inv.invoice_number ASC`;

      const result = await query(sql, params);

      let grandInvoiced = 0;
      let grandPaid = 0;
      let grandOutstanding = 0;
      let grandCurrent = 0;
      let grandOverdue = 0;

      const buckets = {
        current: 0,
        days_1_30: 0,
        days_31_60: 0,
        days_61_90: 0,
        days_90_plus: 0
      };

      const outstandingInvoices: any[] = [];

      for (const row of result.rows) {
        const invTotal = parseFloat(row.invoice_total || '0');
        const paid = parseFloat(row.paid_amount || '0');
        const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);

        grandInvoiced += invTotal;
        grandPaid += paid;

        if (outstanding > 0) {
          grandOutstanding += outstanding;
          const daysOld = calculateDaysOld(row.invoice_date, asOfDate);
          const bucket = getAgeingBucket(daysOld);

          if (daysOld === 0) {
            grandCurrent += outstanding;
            buckets.current += outstanding;
          } else {
            grandOverdue += outstanding;
            if (bucket === '1_30') buckets.days_1_30 += outstanding;
            else if (bucket === '31_60') buckets.days_31_60 += outstanding;
            else if (bucket === '61_90') buckets.days_61_90 += outstanding;
            else if (bucket === '90_PLUS') buckets.days_90_plus += outstanding;
          }

          outstandingInvoices.push({
            invoice_id: row.invoice_id,
            invoice_number: row.invoice_number,
            invoice_date: row.invoice_date,
            customer_id: row.customer_id,
            customer_name: row.customer_name,
            customer_code: row.customer_code,
            customer_gstin: row.customer_gstin || 'UNREGISTERED',
            total_amount: Math.round(invTotal * 100) / 100,
            paid_amount: Math.round(paid * 100) / 100,
            outstanding_amount: outstanding,
            days_old: daysOld,
            ageing_bucket: bucket,
            is_overdue: daysOld > 0
          });
        }
      }

      return res.json({
        as_of_date: asOfDate,
        summary: {
          total_invoiced: Math.round(grandInvoiced * 100) / 100,
          total_paid: Math.round(grandPaid * 100) / 100,
          total_outstanding: Math.round(grandOutstanding * 100) / 100,
          current_outstanding: Math.round(grandCurrent * 100) / 100,
          overdue_outstanding: Math.round(grandOverdue * 100) / 100,
          outstanding_invoice_count: outstandingInvoices.length,
          buckets: {
            current: Math.round(buckets.current * 100) / 100,
            days_1_30: Math.round(buckets.days_1_30 * 100) / 100,
            days_31_60: Math.round(buckets.days_31_60 * 100) / 100,
            days_61_90: Math.round(buckets.days_61_90 * 100) / 100,
            days_90_plus: Math.round(buckets.days_90_plus * 100) / 100
          }
        },
        invoices: outstandingInvoices
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 4. GET /api/financial-dashboard/payments (Payment and Collection Analysis)
router.get(
  '/payments',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from_date, to_date, customer_id, search, payment_mode } = req.query;

      let sql = `
        SELECT 
          p.id as payment_id,
          p.payment_number,
          p.payment_date,
          p.amount,
          p.payment_mode,
          p.reference_number,
          p.bank_name,
          p.status,
          p.remarks,
          c.id as customer_id,
          c.name as customer_name,
          c.code as customer_code,
          COALESCE((
            SELECT SUM(pa.allocated_amount)
            FROM payment_allocations pa
            JOIN invoices inv ON pa.invoice_id = inv.id
            WHERE pa.payment_id = p.id AND inv.status != 'CANCELLED'
          ), 0) as allocated_amount
        FROM payments p
        JOIN customers c ON p.customer_id = c.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (from_date) {
        sql += ` AND p.payment_date >= ?`;
        params.push(from_date);
      }
      if (to_date) {
        sql += ` AND p.payment_date <= ?`;
        params.push(to_date);
      }
      if (customer_id) {
        sql += ` AND p.customer_id = ?`;
        params.push(customer_id);
      }
      if (payment_mode) {
        sql += ` AND p.payment_mode = ?`;
        params.push(payment_mode);
      }
      if (search) {
        sql += ` AND (p.payment_number LIKE ? OR p.reference_number LIKE ? OR c.name LIKE ? OR c.code LIKE ?)`;
        const pat = `%${search}%`;
        params.push(pat, pat, pat, pat);
      }

      sql += ` ORDER BY p.payment_date DESC, p.payment_number DESC`;

      const result = await query(sql, params);

      let totalCollected = 0;
      let totalAllocated = 0;
      let cancelledCount = 0;

      const paymentsList = result.rows.map(row => {
        const amt = parseFloat(row.amount || '0');
        const alloc = parseFloat(row.allocated_amount || '0');
        const unalloc = Math.max(0, Math.round((amt - alloc) * 100) / 100);

        if (row.status !== 'CANCELLED') {
          totalCollected += amt;
          totalAllocated += alloc;
        } else {
          cancelledCount++;
        }

        return {
          payment_id: row.payment_id,
          payment_number: row.payment_number,
          payment_date: row.payment_date,
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          customer_code: row.customer_code,
          amount: Math.round(amt * 100) / 100,
          payment_mode: row.payment_mode,
          reference_number: row.reference_number || '-',
          bank_name: row.bank_name || '-',
          status: row.status,
          allocated_amount: Math.round(alloc * 100) / 100,
          unallocated_amount: unalloc,
          remarks: row.remarks || ''
        };
      });

      const unallocatedTotal = Math.max(0, Math.round((totalCollected - totalAllocated) * 100) / 100);

      return res.json({
        summary: {
          total_payments_received: Math.round(totalCollected * 100) / 100,
          total_allocated_amount: Math.round(totalAllocated * 100) / 100,
          unallocated_payment_amount: unallocatedTotal,
          payment_count: paymentsList.filter(p => p.status !== 'CANCELLED').length,
          cancelled_payment_count: cancelledCount
        },
        payments: paymentsList
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 5. GET /api/financial-dashboard/tax (GST & Tax Consolidated Summary)
router.get(
  '/tax',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from_date, to_date } = req.query;

      let sql = `
        SELECT subtotal, cgst_amount, sgst_amount, igst_amount, tax_amount, total_amount
        FROM invoices
        WHERE status = 'ISSUED'
      `;
      const params: any[] = [];

      if (from_date) {
        sql += ` AND invoice_date >= ?`;
        params.push(from_date);
      }
      if (to_date) {
        sql += ` AND invoice_date <= ?`;
        params.push(to_date);
      }

      const result = await query(sql, params);

      let grandTaxable = 0;
      let grandCgst = 0;
      let grandSgst = 0;
      let grandIgst = 0;
      let grandGst = 0;
      let grandTotal = 0;

      const intra = { count: 0, taxable: 0, cgst: 0, sgst: 0, total_gst: 0, total_val: 0 };
      const inter = { count: 0, taxable: 0, igst: 0, total_gst: 0, total_val: 0 };

      for (const row of result.rows) {
        const sub = parseFloat(row.subtotal || '0');
        const cgst = parseFloat(row.cgst_amount || '0');
        const sgst = parseFloat(row.sgst_amount || '0');
        const igst = parseFloat(row.igst_amount || '0');
        const gst = parseFloat(row.tax_amount || '0');
        const tot = parseFloat(row.total_amount || '0');

        grandTaxable += sub;
        grandCgst += cgst;
        grandSgst += sgst;
        grandIgst += igst;
        grandGst += gst;
        grandTotal += tot;

        if (igst > 0) {
          inter.count++;
          inter.taxable += sub;
          inter.igst += igst;
          inter.total_gst += gst;
          inter.total_val += tot;
        } else {
          intra.count++;
          intra.taxable += sub;
          intra.cgst += cgst;
          intra.sgst += sgst;
          intra.total_gst += gst;
          intra.total_val += tot;
        }
      }

      return res.json({
        overall: {
          taxable_value: Math.round(grandTaxable * 100) / 100,
          cgst_amount: Math.round(grandCgst * 100) / 100,
          sgst_amount: Math.round(grandSgst * 100) / 100,
          igst_amount: Math.round(grandIgst * 100) / 100,
          total_gst: Math.round(grandGst * 100) / 100,
          grand_total: Math.round(grandTotal * 100) / 100
        },
        by_gst_type: {
          intra_state: {
            invoice_count: intra.count,
            taxable_value: Math.round(intra.taxable * 100) / 100,
            cgst_amount: Math.round(intra.cgst * 100) / 100,
            sgst_amount: Math.round(intra.sgst * 100) / 100,
            igst_amount: 0,
            total_gst: Math.round(intra.total_gst * 100) / 100,
            invoice_value: Math.round(intra.total_val * 100) / 100
          },
          inter_state: {
            invoice_count: inter.count,
            taxable_value: Math.round(inter.taxable * 100) / 100,
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: Math.round(inter.igst * 100) / 100,
            total_gst: Math.round(inter.total_gst * 100) / 100,
            invoice_value: Math.round(inter.total_val * 100) / 100
          }
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 6. GET /api/financial-dashboard/customer-performance (Customer Financial Scorecard)
router.get(
  '/customer-performance',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);
      const { from_date, to_date, search, min_outstanding, sort_by, sort_order } = req.query;

      let sql = `
        SELECT 
          c.id as customer_id,
          c.code as customer_code,
          c.name as customer_name,
          c.gst_number as customer_gstin,
          COUNT(inv.id) as invoice_count,
          COALESCE(SUM(inv.total_amount), 0) as invoiced_value,
          COALESCE((
            SELECT SUM(pa.allocated_amount)
            FROM payment_allocations pa
            JOIN payments p ON pa.payment_id = p.id
            JOIN invoices inv2 ON pa.invoice_id = inv2.id
            WHERE inv2.customer_id = c.id 
              AND p.status != 'CANCELLED'
              AND inv2.status = 'ISSUED'
              AND p.payment_date <= ?
              ${from_date ? `AND inv2.invoice_date >= '${from_date}'` : ''}
              ${to_date ? `AND inv2.invoice_date <= '${to_date}'` : ''}
          ), 0) as paid_value
        FROM customers c
        LEFT JOIN invoices inv ON inv.customer_id = c.id AND inv.status = 'ISSUED' AND inv.invoice_date <= ?
      `;
      const params: any[] = [asOfDate, asOfDate];

      if (from_date) {
        sql += ` AND inv.invoice_date >= ?`;
        params.push(from_date);
      }
      if (to_date) {
        sql += ` AND inv.invoice_date <= ?`;
        params.push(to_date);
      }
      if (search) {
        sql += ` AND (c.name LIKE ? OR c.code LIKE ? OR c.gst_number LIKE ?)`;
        const pat = `%${search}%`;
        params.push(pat, pat, pat);
      }

      sql += ` GROUP BY c.id`;

      const result = await query(sql, params);

      // Fetch overdue amount per customer
      const overdueSql = `
        SELECT 
          inv.customer_id,
          inv.id as invoice_id,
          inv.invoice_date,
          inv.total_amount,
          COALESCE((
            SELECT SUM(pa.allocated_amount)
            FROM payment_allocations pa
            JOIN payments p ON pa.payment_id = p.id
            WHERE pa.invoice_id = inv.id 
              AND p.status != 'CANCELLED'
              AND p.payment_date <= ?
          ), 0) as paid_amount
        FROM invoices inv
        WHERE inv.status = 'ISSUED' AND inv.invoice_date <= ?
      `;
      const overdueRes = await query(overdueSql, [asOfDate, asOfDate]);

      const customerOverdueMap = new Map<string, number>();
      for (const row of overdueRes.rows) {
        const invTot = parseFloat(row.total_amount || '0');
        const paidAmt = parseFloat(row.paid_amount || '0');
        const openAmt = Math.max(0, invTot - paidAmt);
        if (openAmt > 0) {
          const days = calculateDaysOld(row.invoice_date, asOfDate);
          if (days > 0) {
            const cur = customerOverdueMap.get(row.customer_id) || 0;
            customerOverdueMap.set(row.customer_id, cur + openAmt);
          }
        }
      }

      let customers = result.rows.map(row => {
        const invoiced = parseFloat(row.invoiced_value || '0');
        const paid = parseFloat(row.paid_value || '0');
        const outstanding = Math.max(0, Math.round((invoiced - paid) * 100) / 100);
        const overdue = Math.round((customerOverdueMap.get(row.customer_id) || 0) * 100) / 100;
        const collectionPct = invoiced > 0 ? Math.min(100, Math.round((paid / invoiced) * 10000) / 100) : 0;

        return {
          customer_id: row.customer_id,
          customer_code: row.customer_code,
          customer_name: row.customer_name,
          customer_gstin: row.customer_gstin || 'UNREGISTERED',
          invoice_count: parseInt(row.invoice_count || '0', 10),
          invoiced_value: Math.round(invoiced * 100) / 100,
          paid_value: Math.round(paid * 100) / 100,
          outstanding_value: outstanding,
          overdue_value: overdue,
          collection_percentage: collectionPct
        };
      });

      // Filter by min_outstanding if specified
      if (min_outstanding) {
        const minVal = parseFloat(min_outstanding as string);
        if (!isNaN(minVal)) {
          customers = customers.filter(c => c.outstanding_value >= minVal);
        }
      }

      // Sort
      const sortBy = (sort_by as string) || 'invoiced_value';
      const order = (sort_order as string)?.toUpperCase() === 'ASC' ? 1 : -1;

      customers.sort((a: any, b: any) => {
        if (typeof a[sortBy] === 'string') {
          return order * a[sortBy].localeCompare(b[sortBy]);
        }
        return order * ((a[sortBy] || 0) - (b[sortBy] || 0));
      });

      return res.json(customers);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 7. GET /api/financial-dashboard/monthly (Monthly MIS Aggregates)
router.get(
  '/monthly',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from_date, to_date, year } = req.query;

      // Invoiced amount & count by month
      let invSql = `
        SELECT 
          strftime('%Y-%m', invoice_date) as month_key,
          COUNT(id) as invoice_count,
          COALESCE(SUM(total_amount), 0) as invoiced_amount,
          COALESCE(SUM(tax_amount), 0) as gst_amount
        FROM invoices
        WHERE status = 'ISSUED'
      `;
      const invParams: any[] = [];

      if (from_date) { invSql += ` AND invoice_date >= ?`; invParams.push(from_date); }
      if (to_date) { invSql += ` AND invoice_date <= ?`; invParams.push(to_date); }
      if (year) { invSql += ` AND strftime('%Y', invoice_date) = ?`; invParams.push(year.toString()); }

      invSql += ` GROUP BY month_key ORDER BY month_key DESC`;

      const invRes = await query(invSql, invParams);

      // Payments received by month
      let paySql = `
        SELECT 
          strftime('%Y-%m', payment_date) as month_key,
          COUNT(id) as payment_count,
          COALESCE(SUM(amount), 0) as payment_received
        FROM payments
        WHERE status != 'CANCELLED'
      `;
      const payParams: any[] = [];

      if (from_date) { paySql += ` AND payment_date >= ?`; payParams.push(from_date); }
      if (to_date) { paySql += ` AND payment_date <= ?`; payParams.push(to_date); }
      if (year) { paySql += ` AND strftime('%Y', payment_date) = ?`; payParams.push(year.toString()); }

      paySql += ` GROUP BY month_key ORDER BY month_key DESC`;

      const payRes = await query(paySql, payParams);

      // Combine maps
      const monthMap = new Map<string, any>();

      for (const r of invRes.rows) {
        if (!r.month_key) continue;
        monthMap.set(r.month_key, {
          month: r.month_key,
          invoiced_amount: Math.round(parseFloat(r.invoiced_amount || '0') * 100) / 100,
          payment_received: 0,
          gst_amount: Math.round(parseFloat(r.gst_amount || '0') * 100) / 100,
          outstanding_created: 0,
          invoice_count: parseInt(r.invoice_count || '0', 10),
          payment_count: 0
        });
      }

      for (const p of payRes.rows) {
        if (!p.month_key) continue;
        if (!monthMap.has(p.month_key)) {
          monthMap.set(p.month_key, {
            month: p.month_key,
            invoiced_amount: 0,
            payment_received: 0,
            gst_amount: 0,
            outstanding_created: 0,
            invoice_count: 0,
            payment_count: 0
          });
        }
        const m = monthMap.get(p.month_key);
        m.payment_received = Math.round(parseFloat(p.payment_received || '0') * 100) / 100;
        m.payment_count = parseInt(p.payment_count || '0', 10);
      }

      const report = Array.from(monthMap.values()).map(m => {
        m.outstanding_created = Math.round((m.invoiced_amount - m.payment_received) * 100) / 100;
        return m;
      }).sort((a, b) => b.month.localeCompare(a.month));

      return res.json(report);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 8. GET /api/financial-dashboard/operational-summary (Operational Pipeline Consolidation)
router.get(
  '/operational-summary',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from_date, to_date } = req.query;

      // 1. Production Executions
      let prodSql = `SELECT COUNT(*) as count, COALESCE(SUM(planned_qty), 0) as planned, COALESCE(SUM(processed_qty), 0) as processed FROM production_executions WHERE status != 'CANCELLED'`;
      const prodParams: any[] = [];
      if (from_date) { prodSql += ` AND production_date >= ?`; prodParams.push(from_date); }
      if (to_date) { prodSql += ` AND production_date <= ?`; prodParams.push(to_date); }
      const prodRes = await query(prodSql, prodParams);

      // 2. QC Inspections
      let qcSql = `
        SELECT 
          COUNT(*) as total_inspections,
          COALESCE(SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END), 0) as passed,
          COALESCE(SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END), 0) as failed,
          COALESCE(SUM(inspected_qty), 0) as inspected_qty,
          COALESCE(SUM(accepted_qty), 0) as accepted_qty,
          COALESCE(SUM(rejected_qty), 0) as rejected_qty
        FROM qc_inspections
        WHERE 1=1
      `;
      const qcParams: any[] = [];
      if (from_date) { qcSql += ` AND inspection_date >= ?`; qcParams.push(from_date); }
      if (to_date) { qcSql += ` AND inspection_date <= ?`; qcParams.push(to_date); }
      const qcRes = await query(qcSql, qcParams);

      // 3. Dispatches
      let dispSql = `SELECT COUNT(*) as count, COALESCE(SUM(dispatched_qty), 0) as qty FROM dispatches WHERE status = 'DISPATCHED'`;
      const dispParams: any[] = [];
      if (from_date) { dispSql += ` AND dispatch_date >= ?`; dispParams.push(from_date); }
      if (to_date) { dispSql += ` AND dispatch_date <= ?`; dispParams.push(to_date); }
      const dispRes = await query(dispSql, dispParams);

      // 4. Invoices
      let invSql = `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount, COALESCE(SUM(subtotal), 0) as taxable FROM invoices WHERE status = 'ISSUED'`;
      const invParams: any[] = [];
      if (from_date) { invSql += ` AND invoice_date >= ?`; invParams.push(from_date); }
      if (to_date) { invSql += ` AND invoice_date <= ?`; invParams.push(to_date); }
      const invRes = await query(invSql, invParams);

      // 5. Payments
      let paySql = `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount FROM payments WHERE status != 'CANCELLED'`;
      const payParams: any[] = [];
      if (from_date) { paySql += ` AND payment_date >= ?`; payParams.push(from_date); }
      if (to_date) { paySql += ` AND payment_date <= ?`; payParams.push(to_date); }
      const payRes = await query(paySql, payParams);

      const qcTotal = parseInt(qcRes.rows[0]?.total_inspections || '0', 10);
      const qcPass = parseInt(qcRes.rows[0]?.passed || '0', 10);
      const qcPassRate = qcTotal > 0 ? Math.round((qcPass / qcTotal) * 10000) / 100 : 0;

      return res.json({
        production: {
          executions_count: parseInt(prodRes.rows[0]?.count || '0', 10),
          planned_qty: parseFloat(prodRes.rows[0]?.planned || '0'),
          processed_qty: parseFloat(prodRes.rows[0]?.processed || '0')
        },
        quality_control: {
          inspections_count: qcTotal,
          passed_count: qcPass,
          failed_count: parseInt(qcRes.rows[0]?.failed || '0', 10),
          pass_rate_pct: qcPassRate,
          inspected_qty: parseFloat(qcRes.rows[0]?.inspected_qty || '0'),
          accepted_qty: parseFloat(qcRes.rows[0]?.accepted_qty || '0'),
          rejected_qty: parseFloat(qcRes.rows[0]?.rejected_qty || '0')
        },
        dispatch: {
          dispatch_count: parseInt(dispRes.rows[0]?.count || '0', 10),
          dispatched_qty: parseFloat(dispRes.rows[0]?.qty || '0')
        },
        billing: {
          invoiced_count: parseInt(invRes.rows[0]?.count || '0', 10),
          taxable_value: Math.round(parseFloat(invRes.rows[0]?.taxable || '0') * 100) / 100,
          invoiced_amount: Math.round(parseFloat(invRes.rows[0]?.amount || '0') * 100) / 100
        },
        collections: {
          payment_count: parseInt(payRes.rows[0]?.count || '0', 10),
          collected_amount: Math.round(parseFloat(payRes.rows[0]?.amount || '0') * 100) / 100
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
