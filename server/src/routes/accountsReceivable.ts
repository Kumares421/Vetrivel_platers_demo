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

// 1. GET /api/accounts-receivable/summary (AR Dashboard Metrics)
router.get(
  '/summary',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);

      const sql = `
        SELECT 
          inv.id as invoice_id,
          inv.invoice_number,
          inv.invoice_date,
          inv.customer_id,
          inv.total_amount as invoice_total,
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

      const result = await query(sql, [asOfDate, asOfDate]);

      let totalInvoiced = 0;
      let totalPaid = 0;
      let totalOutstanding = 0;
      let currentAmount = 0;
      let overdueAmount = 0;

      const buckets = {
        current: 0,
        days_1_30: 0,
        days_31_60: 0,
        days_61_90: 0,
        days_90_plus: 0
      };

      const customerSetWithOutstanding = new Set<string>();
      let pendingInvoiceCount = 0;

      for (const row of result.rows) {
        const invTotal = parseFloat(row.invoice_total || '0');
        const paid = parseFloat(row.paid_amount || '0');
        const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);

        totalInvoiced += invTotal;
        totalPaid += paid;

        if (outstanding > 0) {
          totalOutstanding += outstanding;
          pendingInvoiceCount++;
          customerSetWithOutstanding.add(row.customer_id);

          const daysOld = calculateDaysOld(row.invoice_date, asOfDate);
          const bucket = getAgeingBucket(daysOld);

          if (daysOld === 0) {
            currentAmount += outstanding;
            buckets.current += outstanding;
          } else {
            overdueAmount += outstanding;
            if (bucket === '1_30') buckets.days_1_30 += outstanding;
            else if (bucket === '31_60') buckets.days_31_60 += outstanding;
            else if (bucket === '61_90') buckets.days_61_90 += outstanding;
            else if (bucket === '90_PLUS') buckets.days_90_plus += outstanding;
          }
        }
      }

      return res.json({
        as_of_date: asOfDate,
        total_invoiced_amount: Math.round(totalInvoiced * 100) / 100,
        total_paid_amount: Math.round(totalPaid * 100) / 100,
        total_outstanding_amount: Math.round(totalOutstanding * 100) / 100,
        current_amount: Math.round(currentAmount * 100) / 100,
        overdue_amount: Math.round(overdueAmount * 100) / 100,
        buckets: {
          current: Math.round(buckets.current * 100) / 100,
          days_1_30: Math.round(buckets.days_1_30 * 100) / 100,
          days_31_60: Math.round(buckets.days_31_60 * 100) / 100,
          days_61_90: Math.round(buckets.days_61_90 * 100) / 100,
          days_90_plus: Math.round(buckets.days_90_plus * 100) / 100
        },
        customer_count_with_outstanding: customerSetWithOutstanding.size,
        total_pending_invoices_count: pendingInvoiceCount
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 2. GET /api/accounts-receivable/customers (Customer-wise Outstanding Summary)
router.get(
  '/customers',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);
      const { search, customer_id, min_outstanding } = req.query;

      let custSql = `SELECT * FROM customers WHERE is_active = 1`;
      const custParams: any[] = [];

      if (customer_id) {
        custSql += ` AND id = ?`;
        custParams.push(customer_id);
      }
      if (search) {
        custSql += ` AND (name LIKE ? OR code LIKE ? OR gst_number LIKE ?)`;
        const pattern = `%${search}%`;
        custParams.push(pattern, pattern, pattern);
      }

      custSql += ` ORDER BY name ASC`;

      const custRes = await query(custSql, custParams);
      const customers = custRes.rows;

      const results: any[] = [];

      for (const cust of customers) {
        const invSql = `
          SELECT 
            inv.id as invoice_id,
            inv.invoice_number,
            inv.invoice_date,
            inv.total_amount as invoice_total,
            COALESCE((
              SELECT SUM(pa.allocated_amount)
              FROM payment_allocations pa
              JOIN payments p ON pa.payment_id = p.id
              WHERE pa.invoice_id = inv.id 
                AND p.status != 'CANCELLED'
                AND p.payment_date <= ?
            ), 0) as paid_amount
          FROM invoices inv
          WHERE inv.customer_id = ? AND inv.status = 'ISSUED' AND inv.invoice_date <= ?
        `;

        const invRes = await query(invSql, [asOfDate, cust.id, asOfDate]);

        let custInvoiced = 0;
        let custPaid = 0;
        let custOutstanding = 0;
        let custOverdue = 0;
        let pendingInvoicesCount = 0;

        const custBuckets = {
          current: 0,
          days_1_30: 0,
          days_31_60: 0,
          days_61_90: 0,
          days_90_plus: 0
        };

        for (const row of invRes.rows) {
          const invTotal = parseFloat(row.invoice_total || '0');
          const paid = parseFloat(row.paid_amount || '0');
          const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);

          custInvoiced += invTotal;
          custPaid += paid;

          if (outstanding > 0) {
            custOutstanding += outstanding;
            pendingInvoicesCount++;

            const daysOld = calculateDaysOld(row.invoice_date, asOfDate);
            const bucket = getAgeingBucket(daysOld);

            if (daysOld === 0) {
              custBuckets.current += outstanding;
            } else {
              custOverdue += outstanding;
              if (bucket === '1_30') custBuckets.days_1_30 += outstanding;
              else if (bucket === '31_60') custBuckets.days_31_60 += outstanding;
              else if (bucket === '61_90') custBuckets.days_61_90 += outstanding;
              else if (bucket === '90_PLUS') custBuckets.days_90_plus += outstanding;
            }
          }
        }

        const roundedOutstanding = Math.round(custOutstanding * 100) / 100;

        if (min_outstanding && parseFloat(min_outstanding as string) > 0) {
          if (roundedOutstanding < parseFloat(min_outstanding as string)) {
            continue;
          }
        }

        results.push({
          customer_id: cust.id,
          customer_code: cust.code,
          customer_name: cust.name,
          address: cust.address,
          gst_number: cust.gst_number,
          invoice_count: invRes.rows.length,
          total_invoiced_amount: Math.round(custInvoiced * 100) / 100,
          total_paid_amount: Math.round(custPaid * 100) / 100,
          total_outstanding_amount: roundedOutstanding,
          overdue_amount: Math.round(custOverdue * 100) / 100,
          pending_invoices_count: pendingInvoicesCount,
          buckets: {
            current: Math.round(custBuckets.current * 100) / 100,
            days_1_30: Math.round(custBuckets.days_1_30 * 100) / 100,
            days_31_60: Math.round(custBuckets.days_31_60 * 100) / 100,
            days_61_90: Math.round(custBuckets.days_61_90 * 100) / 100,
            days_90_plus: Math.round(custBuckets.days_90_plus * 100) / 100
          }
        });
      }

      return res.json(results);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 3. GET /api/accounts-receivable/reports/customers (Explicit Report Endpoint)
router.get(
  '/reports/customers',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    // Forward to customers handler
    req.url = '/customers';
    return (router as any).handle(req, res);
  }
);

// 4. GET /api/accounts-receivable/reports/invoices (Invoice Outstanding Report)
router.get(
  '/reports/invoices',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);
      const { customer_id, search, bucket } = req.query;

      let sql = `
        SELECT 
          inv.id as invoice_id,
          inv.invoice_number,
          inv.invoice_date,
          inv.total_amount as invoice_total,
          inv.subtotal,
          inv.tax_amount,
          inv.status as invoice_status,
          c.id as customer_id,
          c.name as customer_name,
          c.code as customer_code,
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

      if (customer_id) {
        sql += ` AND inv.customer_id = ?`;
        params.push(customer_id);
      }
      if (search) {
        sql += ` AND (inv.invoice_number LIKE ? OR c.name LIKE ? OR c.code LIKE ?)`;
        const pattern = `%${search}%`;
        params.push(pattern, pattern, pattern);
      }

      sql += ` ORDER BY inv.invoice_date DESC`;

      const result = await query(sql, params);

      const invoices: any[] = [];

      for (const row of result.rows) {
        const invTotal = parseFloat(row.invoice_total || '0');
        const paid = parseFloat(row.paid_amount || '0');
        const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);

        if (outstanding > 0) {
          const daysOld = calculateDaysOld(row.invoice_date, asOfDate);
          const ageingBucket = getAgeingBucket(daysOld);

          if (bucket && ageingBucket !== bucket) {
            continue;
          }

          invoices.push({
            invoice_id: row.invoice_id,
            invoice_number: row.invoice_number,
            invoice_date: row.invoice_date,
            customer_id: row.customer_id,
            customer_name: row.customer_name,
            customer_code: row.customer_code,
            invoice_total: invTotal,
            paid_amount: paid,
            outstanding_amount: outstanding,
            days_old: daysOld,
            ageing_bucket: ageingBucket
          });
        }
      }

      return res.json(invoices);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 5. GET /api/accounts-receivable/reports/ageing (Customer Ageing Report Matrix)
router.get(
  '/reports/ageing',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);
      const { customer_id, search } = req.query;

      let custSql = `SELECT * FROM customers WHERE is_active = 1`;
      const custParams: any[] = [];

      if (customer_id) {
        custSql += ` AND id = ?`;
        custParams.push(customer_id);
      }
      if (search) {
        custSql += ` AND (name LIKE ? OR code LIKE ?)`;
        const pattern = `%${search}%`;
        custParams.push(pattern, pattern);
      }

      custSql += ` ORDER BY name ASC`;

      const custRes = await query(custSql, custParams);
      const customers = custRes.rows;

      const report: any[] = [];

      for (const cust of customers) {
        const invSql = `
          SELECT 
            inv.id as invoice_id,
            inv.invoice_number,
            inv.invoice_date,
            inv.total_amount as invoice_total,
            COALESCE((
              SELECT SUM(pa.allocated_amount)
              FROM payment_allocations pa
              JOIN payments p ON pa.payment_id = p.id
              WHERE pa.invoice_id = inv.id 
                AND p.status != 'CANCELLED'
                AND p.payment_date <= ?
            ), 0) as paid_amount
          FROM invoices inv
          WHERE inv.customer_id = ? AND inv.status = 'ISSUED' AND inv.invoice_date <= ?
        `;

        const invRes = await query(invSql, [asOfDate, cust.id, asOfDate]);

        let custOutstanding = 0;
        const buckets = {
          current: 0,
          days_1_30: 0,
          days_31_60: 0,
          days_61_90: 0,
          days_90_plus: 0
        };

        for (const row of invRes.rows) {
          const invTotal = parseFloat(row.invoice_total || '0');
          const paid = parseFloat(row.paid_amount || '0');
          const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);

          if (outstanding > 0) {
            custOutstanding += outstanding;
            const daysOld = calculateDaysOld(row.invoice_date, asOfDate);
            const bucket = getAgeingBucket(daysOld);

            if (daysOld === 0) buckets.current += outstanding;
            else if (bucket === '1_30') buckets.days_1_30 += outstanding;
            else if (bucket === '31_60') buckets.days_31_60 += outstanding;
            else if (bucket === '61_90') buckets.days_61_90 += outstanding;
            else if (bucket === '90_PLUS') buckets.days_90_plus += outstanding;
          }
        }

        const totalOut = Math.round(custOutstanding * 100) / 100;

        report.push({
          customer_id: cust.id,
          customer_code: cust.code,
          customer_name: cust.name,
          current: Math.round(buckets.current * 100) / 100,
          days_1_30: Math.round(buckets.days_1_30 * 100) / 100,
          days_31_60: Math.round(buckets.days_31_60 * 100) / 100,
          days_61_90: Math.round(buckets.days_61_90 * 100) / 100,
          days_90_plus: Math.round(buckets.days_90_plus * 100) / 100,
          total_outstanding: totalOut
        });
      }

      return res.json(report);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 6. GET /api/accounts-receivable/reports/overdue (Overdue Invoice Report)
router.get(
  '/reports/overdue',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);
      const { customer_id, search } = req.query;

      let sql = `
        SELECT 
          inv.id as invoice_id,
          inv.invoice_number,
          inv.invoice_date,
          inv.total_amount as invoice_total,
          c.id as customer_id,
          c.name as customer_name,
          c.code as customer_code,
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

      if (customer_id) {
        sql += ` AND inv.customer_id = ?`;
        params.push(customer_id);
      }
      if (search) {
        sql += ` AND (inv.invoice_number LIKE ? OR c.name LIKE ? OR c.code LIKE ?)`;
        const pattern = `%${search}%`;
        params.push(pattern, pattern, pattern);
      }

      sql += ` ORDER BY inv.invoice_date ASC`;

      const result = await query(sql, params);

      const overdueInvoices: any[] = [];

      for (const row of result.rows) {
        const invTotal = parseFloat(row.invoice_total || '0');
        const paid = parseFloat(row.paid_amount || '0');
        const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);
        const daysOld = calculateDaysOld(row.invoice_date, asOfDate);

        // Overdue condition: Outstanding > 0 AND Age > 0 (daysOld >= 1)
        if (outstanding > 0 && daysOld > 0) {
          const ageingBucket = getAgeingBucket(daysOld);
          overdueInvoices.push({
            invoice_id: row.invoice_id,
            invoice_number: row.invoice_number,
            invoice_date: row.invoice_date,
            customer_id: row.customer_id,
            customer_name: row.customer_name,
            customer_code: row.customer_code,
            invoice_total: invTotal,
            paid_amount: paid,
            outstanding_amount: outstanding,
            days_overdue: daysOld,
            ageing_bucket: ageingBucket
          });
        }
      }

      return res.json(overdueInvoices);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 7. GET /api/accounts-receivable/reports/payments (Payment History Report)
router.get(
  '/reports/payments',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from_date, to_date, customer_id, payment_mode, status, search } = req.query;

      let sql = `
        SELECT 
          p.id as payment_id,
          p.payment_number,
          p.payment_date,
          p.payment_mode,
          p.reference_number,
          p.bank_name,
          p.amount,
          p.status,
          c.id as customer_id,
          c.name as customer_name,
          c.code as customer_code,
          COALESCE((
            SELECT SUM(pa.allocated_amount)
            FROM payment_allocations pa
            WHERE pa.payment_id = p.id
          ), 0) as total_allocated_amount
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
      if (status) {
        sql += ` AND p.status = ?`;
        params.push(status);
      }
      if (search) {
        sql += ` AND (p.payment_number LIKE ? OR p.reference_number LIKE ? OR c.name LIKE ? OR c.code LIKE ?)`;
        const pattern = `%${search}%`;
        params.push(pattern, pattern, pattern, pattern);
      }

      sql += ` ORDER BY p.payment_date DESC, p.created_at DESC`;

      const result = await query(sql, params);

      const payments = result.rows.map(row => {
        const amt = parseFloat(row.amount || '0');
        const allocated = parseFloat(row.total_allocated_amount || '0');
        const unallocated = Math.max(0, Math.round((amt - allocated) * 100) / 100);

        return {
          payment_id: row.payment_id,
          payment_number: row.payment_number,
          payment_date: row.payment_date,
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          customer_code: row.customer_code,
          payment_mode: row.payment_mode,
          reference_number: row.reference_number,
          bank_name: row.bank_name,
          amount: amt,
          allocated_amount: allocated,
          unallocated_amount: unallocated,
          status: row.status
        };
      });

      return res.json(payments);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 8. GET /api/accounts-receivable/customer/:customerId (Customer Specific AR Overview)
router.get(
  '/customer/:customerId',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { customerId } = req.params;
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);

      const custRes = await query('SELECT * FROM customers WHERE id = ?', [customerId]);
      if (custRes.rows.length === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      const customer = custRes.rows[0];

      const invSql = `
        SELECT 
          inv.id as invoice_id,
          inv.invoice_number,
          inv.invoice_date,
          inv.total_amount as invoice_total,
          inv.subtotal,
          inv.tax_amount,
          inv.status as invoice_status,
          COALESCE((
            SELECT SUM(pa.allocated_amount)
            FROM payment_allocations pa
            JOIN payments p ON pa.payment_id = p.id
            WHERE pa.invoice_id = inv.id 
              AND p.status != 'CANCELLED'
              AND p.payment_date <= ?
          ), 0) as paid_amount
        FROM invoices inv
        WHERE inv.customer_id = ? AND inv.status = 'ISSUED' AND inv.invoice_date <= ?
        ORDER BY inv.invoice_date ASC
      `;

      const invRes = await query(invSql, [asOfDate, customerId, asOfDate]);

      let totalInvoiced = 0;
      let totalPaid = 0;
      let totalOutstanding = 0;
      let totalOverdue = 0;

      const buckets = {
        current: 0,
        days_1_30: 0,
        days_31_60: 0,
        days_61_90: 0,
        days_90_plus: 0
      };

      const outstandingInvoices: any[] = [];

      for (const row of invRes.rows) {
        const invTotal = parseFloat(row.invoice_total || '0');
        const paid = parseFloat(row.paid_amount || '0');
        const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);

        totalInvoiced += invTotal;
        totalPaid += paid;

        if (outstanding > 0) {
          totalOutstanding += outstanding;
          const daysOld = calculateDaysOld(row.invoice_date, asOfDate);
          const bucket = getAgeingBucket(daysOld);

          if (daysOld === 0) {
            buckets.current += outstanding;
          } else {
            totalOverdue += outstanding;
            if (bucket === '1_30') buckets.days_1_30 += outstanding;
            else if (bucket === '31_60') buckets.days_31_60 += outstanding;
            else if (bucket === '61_90') buckets.days_61_90 += outstanding;
            else if (bucket === '90_PLUS') buckets.days_90_plus += outstanding;
          }

          outstandingInvoices.push({
            ...row,
            invoice_total: invTotal,
            paid_amount: paid,
            outstanding_amount: outstanding,
            days_old: daysOld,
            ageing_bucket: bucket,
            settlement_status: paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID'
          });
        }
      }

      const paySql = `
        SELECT p.*, u.name as received_by_name
        FROM payments p
        JOIN users u ON p.received_by_user_id = u.id
        WHERE p.customer_id = ? AND p.status = 'RECEIVED' AND p.payment_date <= ?
        ORDER BY p.payment_date DESC
      `;
      const payRes = await query(paySql, [customerId, asOfDate]);

      return res.json({
        customer,
        as_of_date: asOfDate,
        summary: {
          total_invoiced_amount: Math.round(totalInvoiced * 100) / 100,
          total_paid_amount: Math.round(totalPaid * 100) / 100,
          total_outstanding_amount: Math.round(totalOutstanding * 100) / 100,
          overdue_amount: Math.round(totalOverdue * 100) / 100,
          buckets: {
            current: Math.round(buckets.current * 100) / 100,
            days_1_30: Math.round(buckets.days_1_30 * 100) / 100,
            days_31_60: Math.round(buckets.days_31_60 * 100) / 100,
            days_61_90: Math.round(buckets.days_61_90 * 100) / 100,
            days_90_plus: Math.round(buckets.days_90_plus * 100) / 100
          }
        },
        outstanding_invoices: outstandingInvoices,
        recent_payments: payRes.rows
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 9. GET /api/accounts-receivable/customer/:customerId/statement (Print-Friendly Customer Statement)
router.get(
  '/customer/:customerId/statement',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { customerId } = req.params;
      const { from_date, to_date, as_of_date } = req.query;

      const asOf = (as_of_date as string) || (to_date as string) || new Date().toISOString().slice(0, 10);
      const fromDate = from_date as string | undefined;

      const custRes = await query('SELECT * FROM customers WHERE id = ?', [customerId]);
      if (custRes.rows.length === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      const customer = custRes.rows[0];

      // Fetch all valid non-cancelled invoices up to asOf
      const invSql = `
        SELECT 
          id, invoice_number as document_number, invoice_date as tx_date,
          total_amount as amount, created_at, 'INVOICE' as doc_type
        FROM invoices
        WHERE customer_id = ? AND status = 'ISSUED' AND invoice_date <= ?
      `;
      const invRes = await query(invSql, [customerId, asOf]);

      // Fetch all valid non-cancelled payments up to asOf
      const paySql = `
        SELECT 
          id, payment_number as document_number, payment_date as tx_date,
          amount, payment_mode, reference_number, created_at, 'PAYMENT' as doc_type
        FROM payments
        WHERE customer_id = ? AND status = 'RECEIVED' AND payment_date <= ?
      `;
      const payRes = await query(paySql, [customerId, asOf]);

      // Combine and sort chronologically
      const allEvents: any[] = [];

      for (const inv of invRes.rows) {
        allEvents.push({
          id: inv.id,
          date: inv.tx_date,
          created_at: inv.created_at,
          document_type: 'INVOICE',
          document_number: inv.document_number,
          description: `Invoice #${inv.document_number}`,
          debit: parseFloat(inv.amount || '0'),
          credit: 0
        });
      }

      for (const pay of payRes.rows) {
        const refStr = pay.reference_number ? ` Ref: ${pay.reference_number}` : '';
        allEvents.push({
          id: pay.id,
          date: pay.tx_date,
          created_at: pay.created_at,
          document_type: 'PAYMENT',
          document_number: pay.document_number,
          description: `Payment (${pay.payment_mode})${refStr}`,
          debit: 0,
          credit: parseFloat(pay.amount || '0')
        });
      }

      // Sort by Date ASC, then INVOICE before PAYMENT on same date, then created_at ASC
      allEvents.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.document_type !== b.document_type) {
          return a.document_type === 'INVOICE' ? -1 : 1;
        }
        return (a.created_at || '').localeCompare(b.created_at || '');
      });

      let runningBalance = 0;
      let openingBalance = 0;
      const periodEntries: any[] = [];
      let totalDebits = 0;
      let totalCredits = 0;

      for (const entry of allEvents) {
        if (fromDate && entry.date < fromDate) {
          openingBalance += entry.debit - entry.credit;
        } else {
          if (periodEntries.length === 0 && fromDate) {
            runningBalance = openingBalance;
          }
          runningBalance += entry.debit - entry.credit;
          totalDebits += entry.debit;
          totalCredits += entry.credit;

          periodEntries.push({
            ...entry,
            debit: Math.round(entry.debit * 100) / 100,
            credit: Math.round(entry.credit * 100) / 100,
            running_balance: Math.round(runningBalance * 100) / 100
          });
        }
      }

      if (!fromDate) {
        openingBalance = 0;
      }

      const closingBalance = Math.round((openingBalance + totalDebits - totalCredits) * 100) / 100;

      return res.json({
        customer,
        statement_period: {
          from_date: fromDate || null,
          to_date: asOf,
          as_of_date: asOf
        },
        opening_balance: Math.round(openingBalance * 100) / 100,
        closing_balance: closingBalance,
        total_debits: Math.round(totalDebits * 100) / 100,
        total_credits: Math.round(totalCredits * 100) / 100,
        entries: periodEntries
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 10. GET /api/accounts-receivable/customer/:customerId/statement/export (CSV Statement Export)
router.get(
  '/customer/:customerId/statement/export',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { customerId } = req.params;
      const { from_date, to_date, as_of_date } = req.query;

      const asOf = (as_of_date as string) || (to_date as string) || new Date().toISOString().slice(0, 10);
      const fromDate = from_date as string | undefined;

      const custRes = await query('SELECT * FROM customers WHERE id = ?', [customerId]);
      if (custRes.rows.length === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      const customer = custRes.rows[0];

      // Query invoices & payments
      const invSql = `SELECT id, invoice_number as document_number, invoice_date as tx_date, total_amount as amount, created_at FROM invoices WHERE customer_id = ? AND status = 'ISSUED' AND invoice_date <= ?`;
      const invRes = await query(invSql, [customerId, asOf]);

      const paySql = `SELECT id, payment_number as document_number, payment_date as tx_date, amount, payment_mode, reference_number, created_at FROM payments WHERE customer_id = ? AND status = 'RECEIVED' AND payment_date <= ?`;
      const payRes = await query(paySql, [customerId, asOf]);

      const allEvents: any[] = [];
      for (const inv of invRes.rows) {
        allEvents.push({ date: inv.tx_date, doc_type: 'INVOICE', num: inv.document_number, desc: `Invoice #${inv.document_number}`, debit: parseFloat(inv.amount || '0'), credit: 0, created_at: inv.created_at });
      }
      for (const pay of payRes.rows) {
        const refStr = pay.reference_number ? ` Ref: ${pay.reference_number}` : '';
        allEvents.push({ date: pay.tx_date, doc_type: 'PAYMENT', num: pay.document_number, desc: `Payment (${pay.payment_mode})${refStr}`, debit: 0, credit: parseFloat(pay.amount || '0'), created_at: pay.created_at });
      }

      allEvents.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.doc_type !== b.doc_type) return a.doc_type === 'INVOICE' ? -1 : 1;
        return (a.created_at || '').localeCompare(b.created_at || '');
      });

      let runningBalance = 0;
      let openingBalance = 0;
      const csvRows: string[] = [];
      csvRows.push(`"Date","Document Type","Document Number","Description","Debit (INR)","Credit (INR)","Running Balance (INR)"`);

      for (const entry of allEvents) {
        if (fromDate && entry.date < fromDate) {
          openingBalance += entry.debit - entry.credit;
        } else {
          if (csvRows.length === 1 && fromDate) {
            runningBalance = openingBalance;
            csvRows.push(`"${fromDate}","OPENING_BALANCE","-","Opening Balance","0.00","0.00","${openingBalance.toFixed(2)}"`);
          }
          runningBalance += entry.debit - entry.credit;
          csvRows.push(`"${entry.date}","${entry.doc_type}","${entry.num}","${entry.desc.replace(/"/g, '""')}","${entry.debit.toFixed(2)}","${entry.credit.toFixed(2)}","${runningBalance.toFixed(2)}"`);
        }
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="statement_${customer.code}_${asOf}.csv"`);
      return res.status(200).send(csvRows.join('\n'));
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 11. GET /api/accounts-receivable/ageing (Legacy matrix endpoint compatibility)
router.get(
  '/ageing',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);
      const { customer_id } = req.query;

      let sql = `
        SELECT 
          inv.id as invoice_id,
          inv.invoice_number,
          inv.invoice_date,
          inv.total_amount as invoice_total,
          inv.status as invoice_status,
          c.id as customer_id,
          c.name as customer_name,
          c.code as customer_code,
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

      if (customer_id) {
        sql += ` AND inv.customer_id = ?`;
        params.push(customer_id);
      }

      sql += ` ORDER BY c.name ASC, inv.invoice_date ASC`;

      const result = await query(sql, params);

      const items: any[] = [];
      const totals = {
        total_invoiced: 0,
        total_paid: 0,
        total_outstanding: 0,
        current: 0,
        days_1_30: 0,
        days_31_60: 0,
        days_61_90: 0,
        days_90_plus: 0
      };

      for (const row of result.rows) {
        const invTotal = parseFloat(row.invoice_total || '0');
        const paid = parseFloat(row.paid_amount || '0');
        const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);

        if (outstanding > 0) {
          const daysOld = calculateDaysOld(row.invoice_date, asOfDate);
          const bucket = getAgeingBucket(daysOld);

          totals.total_invoiced += invTotal;
          totals.total_paid += paid;
          totals.total_outstanding += outstanding;

          if (daysOld === 0) totals.current += outstanding;
          else if (bucket === '1_30') totals.days_1_30 += outstanding;
          else if (bucket === '31_60') totals.days_31_60 += outstanding;
          else if (bucket === '61_90') totals.days_61_90 += outstanding;
          else if (bucket === '90_PLUS') totals.days_90_plus += outstanding;

          items.push({
            ...row,
            invoice_total: invTotal,
            paid_amount: paid,
            outstanding_amount: outstanding,
            days_old: daysOld,
            ageing_bucket: bucket
          });
        }
      }

      return res.json({
        as_of_date: asOfDate,
        summary_totals: {
          total_invoiced: Math.round(totals.total_invoiced * 100) / 100,
          total_paid: Math.round(totals.total_paid * 100) / 100,
          total_outstanding: Math.round(totals.total_outstanding * 100) / 100,
          current: Math.round(totals.current * 100) / 100,
          days_1_30: Math.round(totals.days_1_30 * 100) / 100,
          days_31_60: Math.round(totals.days_31_60 * 100) / 100,
          days_61_90: Math.round(totals.days_61_90 * 100) / 100,
          days_90_plus: Math.round(totals.days_90_plus * 100) / 100
        },
        items
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 12. GET /api/accounts-receivable/invoice/:invoiceId (Specific Invoice AR Details)
router.get(
  '/invoice/:invoiceId',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { invoiceId } = req.params;
      const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);

      const invSql = `
        SELECT 
          inv.*,
          c.name as customer_name, c.code as customer_code, c.address as customer_address, c.gst_number as customer_gstin,
          u.name as created_by_name
        FROM invoices inv
        JOIN customers c ON inv.customer_id = c.id
        JOIN users u ON inv.created_by_user_id = u.id
        WHERE inv.id = ?
      `;

      const invRes = await query(invSql, [invoiceId]);
      if (invRes.rows.length === 0) {
        return res.status(404).json({ error: 'Invoice record not found' });
      }
      const invoice = invRes.rows[0];

      if (invoice.status === 'CANCELLED') {
        return res.json({
          invoice,
          as_of_date: asOfDate,
          is_cancelled: true,
          paid_amount: 0,
          outstanding_amount: 0,
          days_old: 0,
          ageing_bucket: 'CURRENT',
          settlement_status: 'CANCELLED',
          allocations: []
        });
      }

      const allocSql = `
        SELECT 
          pa.id as allocation_id,
          pa.allocated_amount,
          pa.created_at as allocated_at,
          p.id as payment_id,
          p.payment_number,
          p.payment_date,
          p.payment_mode,
          p.reference_number
        FROM payment_allocations pa
        JOIN payments p ON pa.payment_id = p.id
        WHERE pa.invoice_id = ? AND p.status != 'CANCELLED' AND p.payment_date <= ?
        ORDER BY p.payment_date ASC
      `;
      const allocRes = await query(allocSql, [invoiceId, asOfDate]);

      const invTotal = parseFloat(invoice.total_amount || '0');
      let totalPaid = 0;
      const allocations = allocRes.rows.map(r => {
        const amt = parseFloat(r.allocated_amount || '0');
        totalPaid += amt;
        return {
          ...r,
          allocated_amount: amt
        };
      });

      const outstanding = Math.max(0, Math.round((invTotal - totalPaid) * 100) / 100);
      const daysOld = calculateDaysOld(invoice.invoice_date, asOfDate);
      const bucket = getAgeingBucket(daysOld);
      const settlementStatus = outstanding === 0 ? 'PAID' : (totalPaid > 0 ? 'PARTIALLY_PAID' : 'UNPAID');

      return res.json({
        invoice: {
          ...invoice,
          subtotal: parseFloat(invoice.subtotal || '0'),
          tax_amount: parseFloat(invoice.tax_amount || '0'),
          total_amount: invTotal
        },
        as_of_date: asOfDate,
        is_cancelled: false,
        paid_amount: Math.round(totalPaid * 100) / 100,
        outstanding_amount: outstanding,
        days_old: daysOld,
        ageing_bucket: bucket,
        settlement_status: settlementStatus,
        allocations
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
