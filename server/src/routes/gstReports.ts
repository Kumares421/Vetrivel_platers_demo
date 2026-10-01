import { Router, Response } from 'express';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Helper: Determine GST Type (INTRA_STATE or INTER_STATE) based on invoice tax breakdown
function getGstType(cgstAmt: number, sgstAmt: number, igstAmt: number): 'INTRA_STATE' | 'INTER_STATE' {
  if (igstAmt > 0) return 'INTER_STATE';
  return 'INTRA_STATE';
}

// 1. GET /api/gst-reports/summary (GST Dashboard Cards & Monthly Overview)
router.get(
  '/summary',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from_date, to_date } = req.query;

      let sql = `
        SELECT 
          id, invoice_number, invoice_date, subtotal, cgst_amount, sgst_amount, igst_amount, tax_amount, total_amount
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

      let totalInvoiceCount = 0;
      let taxableInvoiceCount = 0;
      let totalTaxableValue = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;
      let totalGst = 0;
      let totalInvoiceValue = 0;

      const currentMonthStr = new Date().toISOString().slice(0, 7); // YYYY-MM
      let currentMonthTaxable = 0;
      let currentMonthGst = 0;
      let currentMonthInvoiceVal = 0;

      for (const row of result.rows) {
        totalInvoiceCount++;
        const subtotal = parseFloat(row.subtotal || '0');
        const cgst = parseFloat(row.cgst_amount || '0');
        const sgst = parseFloat(row.sgst_amount || '0');
        const igst = parseFloat(row.igst_amount || '0');
        const tax = parseFloat(row.tax_amount || '0');
        const total = parseFloat(row.total_amount || '0');

        if (subtotal > 0) taxableInvoiceCount++;

        totalTaxableValue += subtotal;
        totalCgst += cgst;
        totalSgst += sgst;
        totalIgst += igst;
        totalGst += tax;
        totalInvoiceValue += total;

        if (row.invoice_date && row.invoice_date.startsWith(currentMonthStr)) {
          currentMonthTaxable += subtotal;
          currentMonthGst += tax;
          currentMonthInvoiceVal += total;
        }
      }

      return res.json({
        total_invoice_count: totalInvoiceCount,
        taxable_invoice_count: taxableInvoiceCount,
        total_taxable_value: Math.round(totalTaxableValue * 100) / 100,
        total_cgst: Math.round(totalCgst * 100) / 100,
        total_sgst: Math.round(totalSgst * 100) / 100,
        total_igst: Math.round(totalIgst * 100) / 100,
        total_gst: Math.round(totalGst * 100) / 100,
        total_invoice_value: Math.round(totalInvoiceValue * 100) / 100,
        current_month_taxable_value: Math.round(currentMonthTaxable * 100) / 100,
        current_month_gst: Math.round(currentMonthGst * 100) / 100,
        current_month_invoice_value: Math.round(currentMonthInvoiceVal * 100) / 100
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 2. GET /api/gst-reports/invoices (Invoice-wise GST Register)
router.get(
  '/invoices',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from_date, to_date, customer_id, invoice_number, gst_type, search } = req.query;

      let sql = `
        SELECT 
          inv.id as invoice_id,
          inv.invoice_number,
          inv.invoice_date,
          inv.subtotal,
          inv.cgst_amount,
          inv.sgst_amount,
          inv.igst_amount,
          inv.tax_amount,
          inv.total_amount,
          inv.status,
          c.id as customer_id,
          c.name as customer_name,
          c.code as customer_code,
          c.gst_number as customer_gstin,
          c.address as customer_address
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
      if (invoice_number) {
        sql += ` AND inv.invoice_number LIKE ?`;
        params.push(`%${invoice_number}%`);
      }
      if (search) {
        sql += ` AND (inv.invoice_number LIKE ? OR c.name LIKE ? OR c.code LIKE ? OR c.gst_number LIKE ?)`;
        const pattern = `%${search}%`;
        params.push(pattern, pattern, pattern, pattern);
      }

      sql += ` ORDER BY inv.invoice_date DESC, inv.invoice_number DESC`;

      const result = await query(sql, params);

      const invoices: any[] = [];

      for (const row of result.rows) {
        const cgst = parseFloat(row.cgst_amount || '0');
        const sgst = parseFloat(row.sgst_amount || '0');
        const igst = parseFloat(row.igst_amount || '0');
        const derivedGstType = getGstType(cgst, sgst, igst);

        if (gst_type && derivedGstType !== gst_type) {
          continue;
        }

        const subtotal = parseFloat(row.subtotal || '0');
        const tax = parseFloat(row.tax_amount || '0');
        const total = parseFloat(row.total_amount || '0');

        // Extract place of supply from customer address or default to State
        const pos = derivedGstType === 'INTRA_STATE' ? 'Tamil Nadu (Intra-State)' : 'Inter-State';

        invoices.push({
          invoice_id: row.invoice_id,
          invoice_number: row.invoice_number,
          invoice_date: row.invoice_date,
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          customer_code: row.customer_code,
          customer_gstin: row.customer_gstin || 'UNREGISTERED',
          place_of_supply: pos,
          gst_type: derivedGstType,
          taxable_value: subtotal,
          cgst_amount: cgst,
          sgst_amount: sgst,
          igst_amount: igst,
          total_gst: tax,
          invoice_total: total,
          status: row.status
        });
      }

      return res.json(invoices);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 3. GET /api/gst-reports/customers (Customer-wise GST Report)
router.get(
  '/customers',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from_date, to_date, search } = req.query;

      let sql = `
        SELECT 
          c.id as customer_id,
          c.code as customer_code,
          c.name as customer_name,
          c.gst_number as customer_gstin,
          COUNT(inv.id) as invoice_count,
          COALESCE(SUM(inv.subtotal), 0) as total_taxable_value,
          COALESCE(SUM(inv.cgst_amount), 0) as total_cgst,
          COALESCE(SUM(inv.sgst_amount), 0) as total_sgst,
          COALESCE(SUM(inv.igst_amount), 0) as total_igst,
          COALESCE(SUM(inv.tax_amount), 0) as total_gst,
          COALESCE(SUM(inv.total_amount), 0) as total_invoice_value
        FROM customers c
        JOIN invoices inv ON inv.customer_id = c.id
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
      if (search) {
        sql += ` AND (c.name LIKE ? OR c.code LIKE ? OR c.gst_number LIKE ?)`;
        const pattern = `%${search}%`;
        params.push(pattern, pattern, pattern);
      }

      sql += ` GROUP BY c.id ORDER BY c.name ASC`;

      const result = await query(sql, params);

      const report = result.rows.map(row => ({
        customer_id: row.customer_id,
        customer_code: row.customer_code,
        customer_name: row.customer_name,
        customer_gstin: row.customer_gstin || 'UNREGISTERED',
        invoice_count: parseInt(row.invoice_count || '0', 10),
        taxable_value: Math.round(parseFloat(row.total_taxable_value || '0') * 100) / 100,
        cgst_amount: Math.round(parseFloat(row.total_cgst || '0') * 100) / 100,
        sgst_amount: Math.round(parseFloat(row.total_sgst || '0') * 100) / 100,
        igst_amount: Math.round(parseFloat(row.total_igst || '0') * 100) / 100,
        total_gst: Math.round(parseFloat(row.total_gst || '0') * 100) / 100,
        invoice_value: Math.round(parseFloat(row.total_invoice_value || '0') * 100) / 100
      }));

      return res.json(report);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 4. GET /api/gst-reports/tax-summary (GST Tax Summary Breakdown)
router.get(
  '/tax-summary',
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

      const intraState = { count: 0, taxable: 0, cgst: 0, sgst: 0, total_gst: 0, total_val: 0 };
      const interState = { count: 0, taxable: 0, igst: 0, total_gst: 0, total_val: 0 };

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
          interState.count++;
          interState.taxable += sub;
          interState.igst += igst;
          interState.total_gst += gst;
          interState.total_val += tot;
        } else {
          intraState.count++;
          intraState.taxable += sub;
          intraState.cgst += cgst;
          intraState.sgst += sgst;
          intraState.total_gst += gst;
          intraState.total_val += tot;
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
            invoice_count: intraState.count,
            taxable_value: Math.round(intraState.taxable * 100) / 100,
            cgst_amount: Math.round(intraState.cgst * 100) / 100,
            sgst_amount: Math.round(intraState.sgst * 100) / 100,
            igst_amount: 0,
            total_gst: Math.round(intraState.total_gst * 100) / 100,
            invoice_value: Math.round(intraState.total_val * 100) / 100
          },
          inter_state: {
            invoice_count: interState.count,
            taxable_value: Math.round(interState.taxable * 100) / 100,
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: Math.round(interState.igst * 100) / 100,
            total_gst: Math.round(interState.total_gst * 100) / 100,
            invoice_value: Math.round(interState.total_val * 100) / 100
          }
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 5. GET /api/gst-reports/monthly (Monthly GST Breakdown)
router.get(
  '/monthly',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { year } = req.query;

      let sql = `
        SELECT 
          strftime('%Y-%m', invoice_date) as month_key,
          COUNT(id) as invoice_count,
          COALESCE(SUM(subtotal), 0) as taxable_value,
          COALESCE(SUM(cgst_amount), 0) as cgst_amount,
          COALESCE(SUM(sgst_amount), 0) as sgst_amount,
          COALESCE(SUM(igst_amount), 0) as igst_amount,
          COALESCE(SUM(tax_amount), 0) as total_gst,
          COALESCE(SUM(total_amount), 0) as invoice_value
        FROM invoices
        WHERE status = 'ISSUED'
      `;
      const params: any[] = [];

      if (year) {
        sql += ` AND strftime('%Y', invoice_date) = ?`;
        params.push(year.toString());
      }

      sql += ` GROUP BY month_key ORDER BY month_key DESC`;

      const result = await query(sql, params);

      const report = result.rows.map(row => ({
        month: row.month_key,
        invoice_count: parseInt(row.invoice_count || '0', 10),
        taxable_value: Math.round(parseFloat(row.taxable_value || '0') * 100) / 100,
        cgst_amount: Math.round(parseFloat(row.cgst_amount || '0') * 100) / 100,
        sgst_amount: Math.round(parseFloat(row.sgst_amount || '0') * 100) / 100,
        igst_amount: Math.round(parseFloat(row.igst_amount || '0') * 100) / 100,
        total_gst: Math.round(parseFloat(row.total_gst || '0') * 100) / 100,
        invoice_value: Math.round(parseFloat(row.invoice_value || '0') * 100) / 100
      }));

      return res.json(report);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 6. GET /api/gst-reports/rates (GST Rate Summary)
router.get(
  '/rates',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { from_date, to_date } = req.query;

      let sql = `
        SELECT 
          il.gst_rate,
          COUNT(il.id) as line_count,
          COALESCE(SUM(il.taxable_value), 0) as taxable_value,
          COALESCE(SUM(il.cgst_amount), 0) as cgst_amount,
          COALESCE(SUM(il.sgst_amount), 0) as sgst_amount,
          COALESCE(SUM(il.igst_amount), 0) as igst_amount,
          COALESCE(SUM(il.cgst_amount + il.sgst_amount + il.igst_amount), 0) as total_gst
        FROM invoice_lines il
        JOIN invoices inv ON il.invoice_id = inv.id
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

      sql += ` GROUP BY il.gst_rate ORDER BY il.gst_rate ASC`;

      const result = await query(sql, params);

      const report = result.rows.map(row => ({
        gst_rate: parseFloat(row.gst_rate || '18'),
        line_count: parseInt(row.line_count || '0', 10),
        taxable_value: Math.round(parseFloat(row.taxable_value || '0') * 100) / 100,
        cgst_amount: Math.round(parseFloat(row.cgst_amount || '0') * 100) / 100,
        sgst_amount: Math.round(parseFloat(row.sgst_amount || '0') * 100) / 100,
        igst_amount: Math.round(parseFloat(row.igst_amount || '0') * 100) / 100,
        total_gst: Math.round(parseFloat(row.total_gst || '0') * 100) / 100
      }));

      return res.json(report);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// 7. GET /api/gst-reports/export (CSV Export Endpoint)
router.get(
  '/export',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { report_type, from_date, to_date } = req.query;
      const type = (report_type as string) || 'invoices';

      let sql = `
        SELECT 
          inv.invoice_number, inv.invoice_date, c.code as customer_code, c.name as customer_name,
          c.gst_number as customer_gstin, inv.subtotal, inv.cgst_amount, inv.sgst_amount, inv.igst_amount,
          inv.tax_amount, inv.total_amount
        FROM invoices inv
        JOIN customers c ON inv.customer_id = c.id
        WHERE inv.status = 'ISSUED'
      `;
      const params: any[] = [];

      if (from_date) { sql += ` AND inv.invoice_date >= ?`; params.push(from_date); }
      if (to_date) { sql += ` AND inv.invoice_date <= ?`; params.push(to_date); }

      sql += ` ORDER BY inv.invoice_date DESC`;

      const result = await query(sql, params);

      const csvRows: string[] = [];
      csvRows.push(`"Invoice #","Invoice Date","Customer Code","Customer Name","Customer GSTIN","Taxable Value (INR)","CGST (INR)","SGST (INR)","IGST (INR)","Total GST (INR)","Invoice Total (INR)"`);

      for (const r of result.rows) {
        csvRows.push(
          `"${r.invoice_number}","${r.invoice_date}","${r.customer_code}","${r.customer_name.replace(/"/g, '""')}","${r.customer_gstin || 'UNREGISTERED'}","${parseFloat(r.subtotal || '0').toFixed(2)}","${parseFloat(r.cgst_amount || '0').toFixed(2)}","${parseFloat(r.sgst_amount || '0').toFixed(2)}","${parseFloat(r.igst_amount || '0').toFixed(2)}","${parseFloat(r.tax_amount || '0').toFixed(2)}","${parseFloat(r.total_amount || '0').toFixed(2)}"`
        );
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="gst_register_${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send(csvRows.join('\n'));
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
