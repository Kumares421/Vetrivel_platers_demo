import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Default company state for GST calculation
const COMPANY_STATE = (process.env.COMPANY_STATE || 'Tamil Nadu').trim().toLowerCase();

// Function to generate concurrency-safe Invoice Number format: INV-YYYYMMDD-XXXX
async function generateInvoiceNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `INV-${dateStr}-`;

  const result = await query(
    `SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].invoice_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// 1. GET /api/invoices/pending (Pending Invoiceable Dispatches Queue)
router.get('/pending', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        d.id as dispatch_id,
        d.dispatch_number,
        d.dispatch_date,
        d.dispatched_qty,
        d.vehicle_number,
        d.transporter_name,
        d.challan_number,
        d.status as dispatch_status,
        qc.id as qc_inspection_id,
        qc.qc_number,
        qc.accepted_qty as qc_accepted_qty,
        qc.status as qc_status,
        pe.id as production_execution_id,
        pe.production_number,
        pe.processed_qty as production_processed_qty,
        pe.status as production_status,
        jc.id as job_card_id,
        jc.job_card_number,
        jc.plating_process,
        coi.rate as item_rate,
        coi.process_type,
        p.id as part_id,
        p.part_number,
        p.part_name,
        p.base_unit,
        p.rate_per_piece as part_rate,
        c.id as customer_id,
        c.name as customer_name,
        c.code as customer_code,
        c.address as customer_address,
        c.gst_number as customer_gstin,
        COALESCE((
          SELECT SUM(il.quantity)
          FROM invoice_lines il
          JOIN invoices inv ON il.invoice_id = inv.id
          WHERE il.dispatch_id = d.id AND inv.status != 'CANCELLED'
        ), 0) as already_invoiced_qty
      FROM dispatches d
      JOIN qc_inspections qc ON d.qc_inspection_id = qc.id
      JOIN production_executions pe ON d.production_execution_id = pe.id
      JOIN job_cards jc ON d.job_card_id = jc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN customer_orders co ON coi.customer_order_id = co.id
      JOIN parts p ON coi.part_id = p.id
      JOIN customers c ON d.customer_id = c.id
      WHERE d.status = 'DISPATCHED'
        AND pe.status = 'COMPLETED'
        AND qc.status = 'PASS'
        AND d.dispatched_qty > 0
      ORDER BY d.created_at DESC
    `;

    const result = await query(sql);

    const queue = result.rows
      .map(row => {
        const dispatched = parseFloat(row.dispatched_qty || '0');
        const alreadyInvoiced = parseFloat(row.already_invoiced_qty || '0');
        const remaining = Math.max(0, dispatched - alreadyInvoiced);
        const suggestedUnitPrice = row.item_rate != null ? parseFloat(row.item_rate) : parseFloat(row.part_rate || '0');

        return {
          ...row,
          dispatched_qty: dispatched,
          already_invoiced_qty: alreadyInvoiced,
          remaining_invoiceable_qty: remaining,
          suggested_unit_price: suggestedUnitPrice
        };
      })
      .filter(row => row.remaining_invoiceable_qty > 0);

    return res.json(queue);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/invoices (Invoice Register)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, customer_id, from_date, to_date, search } = req.query;

    let sql = `
      SELECT 
        inv.*,
        c.name as customer_name, c.code as customer_code,
        u.name as created_by_name, u.email as created_by_email,
        canc_u.name as cancelled_by_name,
        (SELECT COUNT(*) FROM invoice_lines WHERE invoice_id = inv.id) as line_count,
        (SELECT SUM(quantity) FROM invoice_lines WHERE invoice_id = inv.id) as total_quantity
      FROM invoices inv
      JOIN customers c ON inv.customer_id = c.id
      JOIN users u ON inv.created_by_user_id = u.id
      LEFT JOIN users canc_u ON inv.cancelled_by_user_id = canc_u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND inv.status = ?';
      params.push(status);
    }
    if (customer_id) {
      sql += ' AND inv.customer_id = ?';
      params.push(customer_id);
    }
    if (from_date) {
      sql += ' AND inv.invoice_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      sql += ' AND inv.invoice_date <= ?';
      params.push(to_date);
    }
    if (search) {
      sql += ' AND (inv.invoice_number LIKE ? OR c.name LIKE ? OR c.code LIKE ? OR inv.gstin LIKE ?)';
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    sql += ' ORDER BY inv.created_at DESC';

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/invoices/:id (Invoice Detail)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const invSql = `
      SELECT 
        inv.*,
        c.name as customer_name, c.code as customer_code, c.address as customer_master_address, c.phone as customer_phone, c.email as customer_email,
        u.name as created_by_name, u.email as created_by_email,
        canc_u.name as cancelled_by_name
      FROM invoices inv
      JOIN customers c ON inv.customer_id = c.id
      JOIN users u ON inv.created_by_user_id = u.id
      LEFT JOIN users canc_u ON inv.cancelled_by_user_id = canc_u.id
      WHERE inv.id = ?
    `;

    const invRes = await query(invSql, [id]);
    if (invRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice record not found' });
    }

    const invoice = invRes.rows[0];

    // Fetch Invoice Lines
    const linesSql = `
      SELECT 
        il.*,
        d.dispatch_number, d.dispatch_date, d.dispatched_qty, d.challan_number, d.vehicle_number, d.status as dispatch_status,
        jc.job_card_number, jc.plating_process,
        pe.production_number,
        qc.qc_number, qc.accepted_qty as qc_accepted_qty,
        p.part_number, p.part_name, p.base_unit,
        COALESCE((
          SELECT SUM(il_sub.quantity)
          FROM invoice_lines il_sub
          JOIN invoices inv_sub ON il_sub.invoice_id = inv_sub.id
          WHERE il_sub.dispatch_id = d.id AND inv_sub.status != 'CANCELLED'
        ), 0) as total_invoiced_for_dispatch
      FROM invoice_lines il
      JOIN dispatches d ON il.dispatch_id = d.id
      JOIN job_cards jc ON il.job_card_id = jc.id
      JOIN production_executions pe ON il.production_execution_id = pe.id
      JOIN qc_inspections qc ON il.qc_inspection_id = qc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN parts p ON coi.part_id = p.id
      WHERE il.invoice_id = ?
      ORDER BY il.created_at ASC
    `;

    const linesRes = await query(linesSql, [id]);

    return res.json({
      ...invoice,
      lines: linesRes.rows
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/invoices/:id/print (Printable Invoice Document Data)
router.get('/:id/print', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const invSql = `
      SELECT 
        inv.*,
        c.name as customer_name, c.code as customer_code, c.address as customer_master_address, c.phone as customer_phone, c.email as customer_email,
        u.name as created_by_name
      FROM invoices inv
      JOIN customers c ON inv.customer_id = c.id
      JOIN users u ON inv.created_by_user_id = u.id
      WHERE inv.id = ?
    `;

    const invRes = await query(invSql, [id]);
    if (invRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice record not found' });
    }

    const invoice = invRes.rows[0];

    const linesSql = `
      SELECT 
        il.*,
        d.dispatch_number, d.dispatch_date, d.challan_number,
        jc.job_card_number, jc.plating_process,
        p.part_number, p.part_name, p.base_unit
      FROM invoice_lines il
      JOIN dispatches d ON il.dispatch_id = d.id
      JOIN job_cards jc ON il.job_card_id = jc.id
      JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
      JOIN parts p ON coi.part_id = p.id
      WHERE il.invoice_id = ?
      ORDER BY il.created_at ASC
    `;

    const linesRes = await query(linesSql, [id]);

    return res.json({
      company: {
        name: 'Vetrivel Platers',
        subtitle: 'Electroplating & Surface Finishing Specialists',
        address: 'Plot No. 42, Industrial Estate, SIDCO, Hosur, Tamil Nadu - 635126',
        gstin: '33AAAAA0000A1Z5',
        phone: '+91 98765 43210',
        email: 'billing@vetrivel.com'
      },
      invoice,
      lines: linesRes.rows
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. POST /api/invoices (Create Invoice)
router.post(
  '/',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        customer_id,
        invoice_date,
        place_of_supply,
        billing_address,
        shipping_address,
        gstin,
        discount_amount,
        round_off,
        is_interstate,
        lines
      } = req.body;

      const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key;

      // Idempotency Check
      if (idempotencyKey) {
        const existing = await query('SELECT * FROM invoices WHERE idempotency_key = ?', [idempotencyKey]);
        if (existing.rows.length > 0) {
          const existingInv = existing.rows[0];
          const linesRes = await query('SELECT * FROM invoice_lines WHERE invoice_id = ?', [existingInv.id]);
          return res.status(200).json({ ...existingInv, lines: linesRes.rows });
        }
      }

      // Basic validations
      if (!customer_id) {
        return res.status(400).json({ error: 'Customer selection is required.' });
      }

      const custRes = await query('SELECT * FROM customers WHERE id = ?', [customer_id]);
      if (custRes.rows.length === 0) {
        return res.status(404).json({ error: 'Customer record not found.' });
      }
      const customer = custRes.rows[0];

      if (!lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ error: 'Invoice must contain at least one dispatch line item.' });
      }

      const numDiscount = Math.max(0, parseFloat(discount_amount || 0));
      const numRoundOff = parseFloat(round_off || 0);

      // Determine Inter-state vs Intra-state
      const customerState = (place_of_supply || customer.address || '').toString().trim().toLowerCase();
      let isInterstate = false;

      if (typeof is_interstate === 'boolean') {
        isInterstate = is_interstate;
      } else if (customerState) {
        isInterstate = !customerState.includes(COMPANY_STATE);
      }

      let subtotal = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;

      const preparedLines: any[] = [];

      // Validate each line item & calculate line taxes
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const { dispatch_id, quantity, unit_price, gst_rate, description } = line;

        if (!dispatch_id) {
          return res.status(400).json({ error: `Line ${i + 1}: Dispatch selection is required.` });
        }

        const numQty = parseFloat(quantity);
        if (isNaN(numQty) || numQty <= 0) {
          return res.status(400).json({ error: `Line ${i + 1}: Invoice quantity must be greater than 0.` });
        }

        const numUnitPrice = parseFloat(unit_price);
        if (isNaN(numUnitPrice) || numUnitPrice < 0) {
          return res.status(400).json({ error: `Line ${i + 1}: Unit price cannot be negative.` });
        }

        const numGstRate = parseFloat(gst_rate || 0);
        if (isNaN(numGstRate) || numGstRate < 0) {
          return res.status(400).json({ error: `Line ${i + 1}: GST rate cannot be negative.` });
        }

        // Fetch Dispatch with QC & Production joins
        const dispRes = await query(
          `SELECT 
             d.*,
             qc.status as qc_status,
             pe.status as production_status,
             jc.job_card_number,
             p.part_name, p.part_number
           FROM dispatches d
           JOIN qc_inspections qc ON d.qc_inspection_id = qc.id
           JOIN production_executions pe ON d.production_execution_id = pe.id
           JOIN job_cards jc ON d.job_card_id = jc.id
           JOIN customer_order_items coi ON jc.customer_order_item_id = coi.id
           JOIN parts p ON coi.part_id = p.id
           WHERE d.id = ?`,
          [dispatch_id]
        );

        if (dispRes.rows.length === 0) {
          return res.status(404).json({ error: `Line ${i + 1}: Dispatch record not found.` });
        }
        const disp = dispRes.rows[0];

        // Rule A: Cross-customer invoicing check
        if (disp.customer_id !== customer_id) {
          return res.status(400).json({
            error: `Line ${i + 1}: Dispatch ${disp.dispatch_number} belongs to a different customer and cannot be combined into this invoice.`
          });
        }

        // Rule B: Dispatch status check
        if (disp.status !== 'DISPATCHED') {
          return res.status(400).json({
            error: `Line ${i + 1}: Dispatch ${disp.dispatch_number} status is ${disp.status}. Only DISPATCHED items can be invoiced.`
          });
        }

        // Rule C: QC PASS check
        if (disp.qc_status !== 'PASS') {
          return res.status(400).json({
            error: `Line ${i + 1}: Linked QC Inspection has status ${disp.qc_status}. Only PASS inspections are eligible for invoicing.`
          });
        }

        // Rule D: Production COMPLETED check
        if (disp.production_status !== 'COMPLETED') {
          return res.status(400).json({
            error: `Line ${i + 1}: Linked Production Execution has status ${disp.production_status}. Only COMPLETED runs can be invoiced.`
          });
        }

        // Rule E: Calculate live invoiceable balance for dispatch
        const invLinesRes = await query(
          `SELECT COALESCE(SUM(il.quantity), 0) as already_invoiced
           FROM invoice_lines il
           JOIN invoices inv ON il.invoice_id = inv.id
           WHERE il.dispatch_id = ? AND inv.status != 'CANCELLED'`,
          [dispatch_id]
        );

        const dispatchedQty = parseFloat(disp.dispatched_qty || '0');
        const alreadyInvoicedQty = parseFloat(invLinesRes.rows[0]?.already_invoiced || '0');
        const remainingInvoiceable = Math.max(0, dispatchedQty - alreadyInvoicedQty);

        if (numQty > remainingInvoiceable) {
          return res.status(400).json({
            error: `Line ${i + 1}: Requested billing quantity (${numQty}) exceeds remaining invoiceable quantity (${remainingInvoiceable}) for Dispatch ${disp.dispatch_number}. Dispatched: ${dispatchedQty}, Already Invoiced: ${alreadyInvoicedQty}.`
          });
        }

        // Line Tax & Total Math
        const taxableValue = Math.round(numQty * numUnitPrice * 100) / 100;
        const lineGstTotal = Math.round(taxableValue * (numGstRate / 100) * 100) / 100;

        let lineCgst = 0;
        let lineSgst = 0;
        let lineIgst = 0;

        if (isInterstate) {
          lineCgst = 0;
          lineSgst = 0;
          lineIgst = lineGstTotal;
        } else {
          lineCgst = Math.round((lineGstTotal / 2) * 100) / 100;
          lineSgst = Math.round((lineGstTotal - lineCgst) * 100) / 100;
          lineIgst = 0;
        }

        const lineTotal = Math.round((taxableValue + lineCgst + lineSgst + lineIgst) * 100) / 100;

        subtotal += taxableValue;
        totalCgst += lineCgst;
        totalSgst += lineSgst;
        totalIgst += lineIgst;

        preparedLines.push({
          dispatch_id,
          job_card_id: disp.job_card_id,
          production_execution_id: disp.production_execution_id,
          qc_inspection_id: disp.qc_inspection_id,
          description: description || `Plating Service - ${disp.part_name} (${disp.part_number}) - Dispatch ${disp.dispatch_number}`,
          quantity: numQty,
          unit_price: numUnitPrice,
          taxable_value: taxableValue,
          gst_rate: numGstRate,
          cgst_amount: lineCgst,
          sgst_amount: lineSgst,
          igst_amount: lineIgst,
          line_total: lineTotal
        });
      }

      subtotal = Math.round(subtotal * 100) / 100;
      totalCgst = Math.round(totalCgst * 100) / 100;
      totalSgst = Math.round(totalSgst * 100) / 100;
      totalIgst = Math.round(totalIgst * 100) / 100;
      const totalTax = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100;

      const grandTotal = Math.round((subtotal + totalTax - numDiscount + numRoundOff) * 100) / 100;
      if (grandTotal < 0) {
        return res.status(400).json({ error: 'Grand total cannot be negative.' });
      }

      // Generate invoice number
      const invoiceId = uuidv4();
      const invoiceNumber = await generateInvoiceNumber();
      const invDate = invoice_date || new Date().toISOString().slice(0, 10);

      // Insert Invoice Header
      await query(
        `INSERT INTO invoices (
          id, invoice_number, customer_id, invoice_date, subtotal,
          cgst_amount, sgst_amount, igst_amount, tax_amount, discount_amount,
          round_off, total_amount, place_of_supply, billing_address, shipping_address,
          gstin, status, created_by_user_id, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?, datetime('now'), datetime('now'))`,
        [
          invoiceId,
          invoiceNumber,
          customer_id,
          invDate,
          subtotal,
          totalCgst,
          totalSgst,
          totalIgst,
          totalTax,
          numDiscount,
          numRoundOff,
          grandTotal,
          place_of_supply || customer.address || null,
          billing_address || customer.address || null,
          shipping_address || customer.address || null,
          gstin || customer.gst_number || null,
          req.user!.id,
          idempotencyKey || null
        ]
      );

      // Insert Invoice Lines
      for (const pl of preparedLines) {
        const lineId = uuidv4();
        await query(
          `INSERT INTO invoice_lines (
            id, invoice_id, dispatch_id, job_card_id, production_execution_id,
            qc_inspection_id, description, quantity, unit_price, taxable_value,
            gst_rate, cgst_amount, sgst_amount, igst_amount, line_total, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            lineId,
            invoiceId,
            pl.dispatch_id,
            pl.job_card_id,
            pl.production_execution_id,
            pl.qc_inspection_id,
            pl.description,
            pl.quantity,
            pl.unit_price,
            pl.taxable_value,
            pl.gst_rate,
            pl.cgst_amount,
            pl.sgst_amount,
            pl.igst_amount,
            pl.line_total
          ]
        );
      }

      // Audit Log
      await logAuditEvent({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: 'INVOICE_CREATED',
        recordRef: invoiceId,
        changedValues: {
          invoice_number: invoiceNumber,
          customer_id,
          subtotal,
          tax_amount: totalTax,
          grand_total: grandTotal,
          line_count: preparedLines.length
        },
        reason: `Invoice ${invoiceNumber} created for Customer ${customer.name}`
      });

      const createdRes = await query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
      const createdLinesRes = await query('SELECT * FROM invoice_lines WHERE invoice_id = ?', [invoiceId]);

      return res.status(201).json({
        ...createdRes.rows[0],
        lines: createdLinesRes.rows
      });
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed: invoices.idempotency_key')) {
        const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key;
        const existing = await query('SELECT * FROM invoices WHERE idempotency_key = ?', [idempotencyKey]);
        if (existing.rows.length > 0) {
          const existingInv = existing.rows[0];
          const linesRes = await query('SELECT * FROM invoice_lines WHERE invoice_id = ?', [existingInv.id]);
          return res.status(200).json({ ...existingInv, lines: linesRes.rows });
        }
      }
      return res.status(500).json({ error: err.message });
    }
  }
);

// 6. POST /api/invoices/:id/cancel (Non-destructive Cancellation: ADMIN / SUPER_ADMIN only)
router.post(
  '/:id/cancel',
  authenticateToken,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { cancellation_reason } = req.body;

      if (!cancellation_reason || !cancellation_reason.trim()) {
        return res.status(400).json({ error: 'Cancellation reason is mandatory for invoice cancellation.' });
      }

      const invRes = await query('SELECT * FROM invoices WHERE id = ?', [id]);
      if (invRes.rows.length === 0) {
        return res.status(404).json({ error: 'Invoice record not found.' });
      }

      const invoice = invRes.rows[0];

      if (invoice.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Invoice record is already cancelled.' });
      }

      await query(
        `UPDATE invoices
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
        action: 'INVOICE_CANCELLED',
        recordRef: id,
        changedValues: {
          invoice_number: invoice.invoice_number,
          status: 'CANCELLED',
          restored_amount: invoice.total_amount
        },
        reason: cancellation_reason.trim()
      });

      const updatedRes = await query('SELECT * FROM invoices WHERE id = ?', [id]);
      const linesRes = await query('SELECT * FROM invoice_lines WHERE invoice_id = ?', [id]);

      return res.json({
        ...updatedRes.rows[0],
        lines: linesRes.rows
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
