import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

const ALLOWED_MODES = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'];

// Function to generate concurrency-safe Payment Number format: PAY-YYYYMMDD-XXXX
async function generatePaymentNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `PAY-${dateStr}-`;

  const result = await query(
    `SELECT payment_number FROM payments WHERE payment_number LIKE ? ORDER BY payment_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].payment_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// 1. GET /api/payments/pending (Outstanding Invoices Queue for Payment Allocation)
router.get('/pending', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customer_id } = req.query;

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
        c.gst_number as customer_gstin,
        COALESCE((
          SELECT SUM(pa.allocated_amount)
          FROM payment_allocations pa
          JOIN payments p ON pa.payment_id = p.id
          WHERE pa.invoice_id = inv.id AND p.status != 'CANCELLED'
        ), 0) as paid_amount
      FROM invoices inv
      JOIN customers c ON inv.customer_id = c.id
      WHERE inv.status = 'ISSUED' AND inv.total_amount > 0
    `;
    const params: any[] = [];

    if (customer_id) {
      sql += ' AND inv.customer_id = ?';
      params.push(customer_id);
    }

    sql += ' ORDER BY inv.created_at DESC';

    const result = await query(sql, params);

    const pendingInvoices = result.rows
      .map(row => {
        const total = parseFloat(row.invoice_total || '0');
        const paid = parseFloat(row.paid_amount || '0');
        const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);
        const settlementStatus = outstanding === 0 ? 'PAID' : (paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID');

        return {
          ...row,
          invoice_total: total,
          paid_amount: paid,
          outstanding_amount: outstanding,
          settlement_status: settlementStatus
        };
      })
      .filter(row => row.outstanding_amount > 0);

    return res.json(pendingInvoices);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/payments (Payment Register)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customer_id, status, payment_mode, from_date, to_date, payment_number, reference_number, search } = req.query;

    let sql = `
      SELECT 
        p.*,
        c.name as customer_name, c.code as customer_code,
        u.name as received_by_name, u.email as received_by_email,
        canc_u.name as cancelled_by_name,
        COALESCE((
          SELECT SUM(allocated_amount)
          FROM payment_allocations
          WHERE payment_id = p.id
        ), 0) as total_allocated_amount,
        (SELECT COUNT(*) FROM payment_allocations WHERE payment_id = p.id) as allocation_count
      FROM payments p
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.received_by_user_id = u.id
      LEFT JOIN users canc_u ON p.cancelled_by_user_id = canc_u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND p.status = ?';
      params.push(status);
    }
    if (customer_id) {
      sql += ' AND p.customer_id = ?';
      params.push(customer_id);
    }
    if (payment_mode) {
      sql += ' AND p.payment_mode = ?';
      params.push(payment_mode);
    }
    if (from_date) {
      sql += ' AND p.payment_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      sql += ' AND p.payment_date <= ?';
      params.push(to_date);
    }
    if (payment_number) {
      sql += ' AND p.payment_number LIKE ?';
      params.push(`%${payment_number}%`);
    }
    if (reference_number) {
      sql += ' AND p.reference_number LIKE ?';
      params.push(`%${reference_number}%`);
    }
    if (search) {
      sql += ' AND (p.payment_number LIKE ? OR p.reference_number LIKE ? OR c.name LIKE ? OR c.code LIKE ?)';
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    sql += ' ORDER BY p.created_at DESC';

    const result = await query(sql, params);

    const payments = result.rows.map(row => {
      const amt = parseFloat(row.amount || '0');
      const alloc = parseFloat(row.total_allocated_amount || '0');
      const unallocated = Math.max(0, Math.round((amt - alloc) * 100) / 100);
      return {
        ...row,
        amount: amt,
        total_allocated_amount: alloc,
        unallocated_amount: unallocated
      };
    });

    return res.json(payments);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/payments/customer/:customerId/outstanding (Customer Outstanding Summary & Invoice Breakdown)
router.get('/customer/:customerId/outstanding', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customerId } = req.params;

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
        inv.status as invoice_status,
        COALESCE((
          SELECT SUM(pa.allocated_amount)
          FROM payment_allocations pa
          JOIN payments p ON pa.payment_id = p.id
          WHERE pa.invoice_id = inv.id AND p.status != 'CANCELLED'
        ), 0) as paid_amount
      FROM invoices inv
      WHERE inv.customer_id = ? AND inv.status = 'ISSUED'
      ORDER BY inv.invoice_date ASC
    `;

    const invRes = await query(invSql, [customerId]);

    let totalInvoiced = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;

    const invoices = invRes.rows.map(row => {
      const invTotal = parseFloat(row.invoice_total || '0');
      const paid = parseFloat(row.paid_amount || '0');
      const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);
      const settlementStatus = outstanding === 0 ? 'PAID' : (paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID');

      totalInvoiced += invTotal;
      totalPaid += paid;
      totalOutstanding += outstanding;

      return {
        ...row,
        invoice_total: invTotal,
        paid_amount: paid,
        outstanding_amount: outstanding,
        settlement_status: settlementStatus
      };
    });

    return res.json({
      customer,
      summary: {
        total_invoiced_amount: Math.round(totalInvoiced * 100) / 100,
        total_paid_amount: Math.round(totalPaid * 100) / 100,
        total_outstanding_amount: Math.round(totalOutstanding * 100) / 100,
        active_unpaid_invoices_count: invoices.filter(i => i.outstanding_amount > 0).length
      },
      invoices
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/payments/:id (Payment Details with Allocations)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const paySql = `
      SELECT 
        p.*,
        c.name as customer_name, c.code as customer_code, c.address as customer_address, c.gst_number as customer_gstin,
        u.name as received_by_name, u.email as received_by_email,
        canc_u.name as cancelled_by_name
      FROM payments p
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.received_by_user_id = u.id
      LEFT JOIN users canc_u ON p.cancelled_by_user_id = canc_u.id
      WHERE p.id = ?
    `;

    const payRes = await query(paySql, [id]);
    if (payRes.rows.length === 0) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    const payment = payRes.rows[0];

    const allocSql = `
      SELECT 
        pa.id as allocation_id,
        pa.allocated_amount,
        pa.created_at as allocated_at,
        inv.id as invoice_id,
        inv.invoice_number,
        inv.invoice_date,
        inv.total_amount as invoice_total,
        COALESCE((
          SELECT SUM(pa_sub.allocated_amount)
          FROM payment_allocations pa_sub
          JOIN payments p_sub ON pa_sub.payment_id = p_sub.id
          WHERE pa_sub.invoice_id = inv.id AND p_sub.status != 'CANCELLED'
        ), 0) as invoice_total_paid
      FROM payment_allocations pa
      JOIN invoices inv ON pa.invoice_id = inv.id
      WHERE pa.payment_id = ?
      ORDER BY pa.created_at ASC
    `;

    const allocRes = await query(allocSql, [id]);

    const allocations = allocRes.rows.map(row => {
      const invTotal = parseFloat(row.invoice_total || '0');
      const paid = parseFloat(row.invoice_total_paid || '0');
      const outstanding = Math.max(0, Math.round((invTotal - paid) * 100) / 100);
      return {
        ...row,
        allocated_amount: parseFloat(row.allocated_amount || '0'),
        invoice_total: invTotal,
        invoice_total_paid: paid,
        invoice_current_outstanding: outstanding
      };
    });

    const totalAllocated = allocations.reduce((sum, a) => sum + a.allocated_amount, 0);
    const amt = parseFloat(payment.amount || '0');
    const unallocated = Math.max(0, Math.round((amt - totalAllocated) * 100) / 100);

    return res.json({
      ...payment,
      amount: amt,
      total_allocated_amount: Math.round(totalAllocated * 100) / 100,
      unallocated_amount: unallocated,
      allocations
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. POST /api/payments (Record Payment & Allocation)
router.post(
  '/',
  authenticateToken,
  requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        customer_id,
        payment_date,
        amount,
        payment_mode,
        reference_number,
        bank_name,
        transaction_date,
        remarks,
        allocations
      } = req.body;

      const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key;

      // Idempotency Check
      if (idempotencyKey) {
        const existing = await query('SELECT * FROM payments WHERE idempotency_key = ?', [idempotencyKey]);
        if (existing.rows.length > 0) {
          const existingPay = existing.rows[0];
          const allocsRes = await query('SELECT * FROM payment_allocations WHERE payment_id = ?', [existingPay.id]);
          return res.status(200).json({ ...existingPay, allocations: allocsRes.rows });
        }
      }

      // Validations
      if (!customer_id) {
        return res.status(400).json({ error: 'Customer selection is required.' });
      }

      const custRes = await query('SELECT * FROM customers WHERE id = ?', [customer_id]);
      if (custRes.rows.length === 0) {
        return res.status(404).json({ error: 'Customer record not found.' });
      }

      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Payment amount must be a positive number greater than 0.' });
      }

      if (!payment_mode || !ALLOWED_MODES.includes(payment_mode.toString().toUpperCase())) {
        return res.status(400).json({
          error: `Payment mode must be one of: ${ALLOWED_MODES.join(', ')}.`
        });
      }

      const mode = payment_mode.toString().toUpperCase();
      const payDate = payment_date || new Date().toISOString().slice(0, 10);

      // Validate Allocations array if provided
      const preparedAllocations: any[] = [];
      let totalAllocatedSum = 0;

      if (allocations && Array.isArray(allocations) && allocations.length > 0) {
        for (let i = 0; i < allocations.length; i++) {
          const alloc = allocations[i];
          const { invoice_id, allocated_amount } = alloc;

          if (!invoice_id) {
            return res.status(400).json({ error: `Allocation ${i + 1}: Invoice ID is required.` });
          }

          const numAllocated = parseFloat(allocated_amount);
          if (isNaN(numAllocated) || numAllocated <= 0) {
            return res.status(400).json({ error: `Allocation ${i + 1}: Allocated amount must be greater than 0.` });
          }

          // Fetch invoice
          const invRes = await query('SELECT * FROM invoices WHERE id = ?', [invoice_id]);
          if (invRes.rows.length === 0) {
            return res.status(404).json({ error: `Allocation ${i + 1}: Invoice record not found.` });
          }
          const invoice = invRes.rows[0];

          // Rule A: Invoice status check
          if (invoice.status === 'CANCELLED') {
            return res.status(400).json({
              error: `Allocation ${i + 1}: Cannot allocate payment to CANCELLED Invoice ${invoice.invoice_number}.`
            });
          }

          // Rule B: Cross-customer allocation check (evaluated before outstanding balance)
          if (invoice.customer_id !== customer_id) {
            return res.status(400).json({
              error: `Allocation ${i + 1}: Invoice ${invoice.invoice_number} belongs to a different customer.`
            });
          }

          // Rule C: Check live outstanding balance inside transaction
          const paidRes = await query(
            `SELECT COALESCE(SUM(pa.allocated_amount), 0) as paid_so_far
             FROM payment_allocations pa
             JOIN payments p ON pa.payment_id = p.id
             WHERE pa.invoice_id = ? AND p.status != 'CANCELLED'`,
            [invoice_id]
          );

          const invTotal = parseFloat(invoice.total_amount || '0');
          const paidSoFar = parseFloat(paidRes.rows[0]?.paid_so_far || '0');
          const liveOutstanding = Math.max(0, Math.round((invTotal - paidSoFar) * 100) / 100);

          if (numAllocated > liveOutstanding) {
            return res.status(400).json({
              error: `Allocation ${i + 1}: Allocated amount (₹${numAllocated}) exceeds current live outstanding balance (₹${liveOutstanding}) for Invoice ${invoice.invoice_number}.`
            });
          }

          totalAllocatedSum += numAllocated;
          preparedAllocations.push({
            invoice_id,
            invoice_number: invoice.invoice_number,
            allocated_amount: Math.round(numAllocated * 100) / 100
          });
        }

        totalAllocatedSum = Math.round(totalAllocatedSum * 100) / 100;

        // Rule D: Total allocated cannot exceed payment amount
        if (totalAllocatedSum > numAmount) {
          return res.status(400).json({
            error: `Total allocated amount (₹${totalAllocatedSum}) exceeds total payment amount (₹${numAmount}).`
          });
        }
      }

      // Generate payment number
      const paymentId = uuidv4();
      const paymentNumber = await generatePaymentNumber();

      // Insert Payment
      await query(
        `INSERT INTO payments (
          id, payment_number, customer_id, payment_date, amount, payment_mode,
          reference_number, bank_name, transaction_date, remarks, status,
          received_by_user_id, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, datetime('now'), datetime('now'))`,
        [
          paymentId,
          paymentNumber,
          customer_id,
          payDate,
          numAmount,
          mode,
          reference_number || null,
          bank_name || null,
          transaction_date || payDate,
          remarks || null,
          req.user!.id,
          idempotencyKey || null
        ]
      );

      // Insert Allocations
      for (const pa of preparedAllocations) {
        const allocId = uuidv4();
        await query(
          `INSERT INTO payment_allocations (id, payment_id, invoice_id, allocated_amount, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [allocId, paymentId, pa.invoice_id, pa.allocated_amount]
        );
      }

      // Audit Log
      await logAuditEvent({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: 'PAYMENT_CREATED',
        recordRef: paymentId,
        changedValues: {
          payment_number: paymentNumber,
          customer_id,
          amount: numAmount,
          payment_mode: mode,
          reference_number: reference_number || null,
          total_allocated: totalAllocatedSum,
          allocation_count: preparedAllocations.length
        },
        reason: `Payment ${paymentNumber} received from Customer`
      });

      const createdRes = await query('SELECT * FROM payments WHERE id = ?', [paymentId]);
      const createdAllocationsRes = await query('SELECT * FROM payment_allocations WHERE payment_id = ?', [paymentId]);

      return res.status(201).json({
        ...createdRes.rows[0],
        allocations: createdAllocationsRes.rows
      });
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed: payments.idempotency_key')) {
        const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key;
        const existing = await query('SELECT * FROM payments WHERE idempotency_key = ?', [idempotencyKey]);
        if (existing.rows.length > 0) {
          const existingPay = existing.rows[0];
          const allocsRes = await query('SELECT * FROM payment_allocations WHERE payment_id = ?', [existingPay.id]);
          return res.status(200).json({ ...existingPay, allocations: allocsRes.rows });
        }
      }
      return res.status(500).json({ error: err.message });
    }
  }
);

// 6. POST /api/payments/:id/cancel (Non-destructive Payment Reversal: ADMIN / SUPER_ADMIN only)
router.post(
  '/:id/cancel',
  authenticateToken,
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { cancellation_reason } = req.body;

      if (!cancellation_reason || !cancellation_reason.trim()) {
        return res.status(400).json({ error: 'Cancellation reason is mandatory for payment cancellation.' });
      }

      const payRes = await query('SELECT * FROM payments WHERE id = ?', [id]);
      if (payRes.rows.length === 0) {
        return res.status(404).json({ error: 'Payment record not found.' });
      }

      const payment = payRes.rows[0];

      if (payment.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Payment record is already cancelled.' });
      }

      await query(
        `UPDATE payments
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
        action: 'PAYMENT_CANCELLED',
        recordRef: id,
        changedValues: {
          payment_number: payment.payment_number,
          status: 'CANCELLED',
          restored_amount: payment.amount
        },
        reason: cancellation_reason.trim()
      });

      const updatedRes = await query('SELECT * FROM payments WHERE id = ?', [id]);
      const allocsRes = await query('SELECT * FROM payment_allocations WHERE payment_id = ?', [id]);

      return res.json({
        ...updatedRes.rows[0],
        allocations: allocsRes.rows
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
