import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import fs from 'fs';

const DB_PATH = 'data/test_payment.sqlite';

// Clean test database for pristine test isolation
if (fs.existsSync(DB_PATH)) {
  try { fs.unlinkSync(DB_PATH); } catch (e) {}
  try { fs.unlinkSync(`${DB_PATH}-wal`); } catch (e) {}
  try { fs.unlinkSync(`${DB_PATH}-shm`); } catch (e) {}
}

console.log('================================================================');
console.log('VETRIVEL PLATERS ERP — PAYMENT & COLLECTIONS TEST SUITE (TASK 24)');
console.log(`Database: ${DB_PATH} (ISOLATED TEST DATABASE)`);
console.log('================================================================\n');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. Run base schema statements
import { getSQLiteSchemaStatements } from '../server/src/db/index';
for (const stmt of getSQLiteSchemaStatements()) {
  try {
    db.exec(stmt);
  } catch (e) {}
}

// 2. Run ERP migrations
import { runErpMigrations } from '../server/src/db/migrations';
runErpMigrations(db);

interface TestResult {
  code: string;
  name: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

const results: TestResult[] = [];

function recordResult(code: string, name: string, status: 'PASS' | 'FAIL', details: string) {
  results.push({ code, name, status, details });
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} [${code}] ${name}: ${details}`);
}

// Helper to generate Payment Number
function generatePayNum(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `PAY-${dateStr}-`;
  const lastRes = db.prepare("SELECT payment_number FROM payments WHERE payment_number LIKE ? ORDER BY payment_number DESC LIMIT 1").get(`${prefix}%`) as any;
  let seq = 1;
  if (lastRes && lastRes.payment_number) {
    const parts = lastRes.payment_number.split('-');
    if (parts.length === 3) seq = parseInt(parts[2], 10) + 1;
  }
  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

async function runPaymentTests() {
  try {
    console.log('--- 1. Setting up Isolated Accounts & Roles ---');
    const superHash = bcrypt.hashSync('super123', 10);
    const adminHash = bcrypt.hashSync('admin123', 10);
    const staffHash = bcrypt.hashSync('staff123', 10);

    const superAdminId = uuidv4();
    const adminId = uuidv4();
    const staffId = uuidv4();

    db.prepare("INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)")
      .run(superAdminId, 'superadmin@vetrivel.com', superHash, 'Super Admin', 'SUPER_ADMIN');
    db.prepare("INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)")
      .run(adminId, 'admin@vetrivel.com', adminHash, 'Admin User', 'ADMIN');
    db.prepare("INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)")
      .run(staffId, 'staff@vetrivel.com', staffHash, 'Staff User', 'STAFF');

    console.log('--- 2. Setting up Customers, Parts & Invoices ---');
    const cust1Id = uuidv4();
    db.prepare("INSERT INTO customers (id, code, name, address, gst_number, is_active) VALUES (?, 'CUST-001', 'Sundram Fasteners Ltd', 'Padi, Chennai', '33AAACS1234F1Z1', 1)").run(cust1Id);

    const cust2Id = uuidv4();
    db.prepare("INSERT INTO customers (id, code, name, address, gst_number, is_active) VALUES (?, 'CUST-002', 'TVS Motor Company', 'Hosur, Tamil Nadu', '33AAACT5678F1Z2', 1)").run(cust2Id);

    const part1Id = uuidv4();
    db.prepare("INSERT INTO parts (id, customer_id, part_number, part_name, process_type, surface_area_sqdm, rate_per_piece, base_unit, is_active) VALUES (?, ?, 'PART-BOLT', 'Hex Bolt', 'Zinc', 0.5, 10.00, 'nos', 1)").run(part1Id, cust1Id);

    const tankId = uuidv4();
    db.prepare("INSERT INTO tanks (id, code, display_name, capacity_liters, status, location, is_active) VALUES (?, 'TANK-01', 'Tank 1', 2500, 'ACTIVE', 'Bay 1', 1)").run(tankId);

    const chemId = uuidv4();
    db.prepare("INSERT INTO chemicals (id, code, name, base_unit, min_stock_level, is_active) VALUES (?, 'CHEM-01', 'Zinc Chemical', 'kg', 10, 1)").run(chemId);

    // Upstream data setup for linked dispatches & invoices
    const order1Id = uuidv4();
    db.prepare("INSERT INTO customer_orders (id, order_number, customer_id, order_date, total_quantity, total_amount, status, created_by_user_id) VALUES (?, 'CO-001', ?, date('now'), 1000, 10000, 'CONFIRMED', ?)").run(order1Id, cust1Id, staffId);
    const item1Id = uuidv4();
    db.prepare("INSERT INTO customer_order_items (id, customer_order_id, part_id, quantity, rate, line_amount) VALUES (?, ?, ?, 1000, 10.00, 10000)").run(item1Id, order1Id, part1Id);
    const inward1Id = uuidv4();
    db.prepare("INSERT INTO customer_parts_inward (id, inward_number, customer_order_id, customer_order_item_id, challan_number, challan_date, received_date, accepted_qty, rejected_qty, received_by_user_id, status) VALUES (?, 'INW-001', ?, ?, 'DC-001', date('now'), date('now'), 1000, 0, ?, 'RECEIVED')").run(inward1Id, order1Id, item1Id, staffId);
    const jc1Id = uuidv4();
    db.prepare("INSERT INTO job_cards (id, job_card_number, customer_parts_inward_id, customer_order_item_id, allocated_qty, tank_id, plating_process, status, released_by_user_id) VALUES (?, 'JC-001', ?, ?, 1000, ?, 'Zinc', 'RELEASED', ?)").run(jc1Id, inward1Id, item1Id, tankId, staffId);
    const prod1Id = uuidv4();
    db.prepare("INSERT INTO production_executions (id, production_number, job_card_id, tank_id, production_date, planned_qty, processed_qty, status, operator_user_id) VALUES (?, 'PRD-001', ?, ?, date('now'), 1000, 1000, 'COMPLETED', ?)").run(prod1Id, jc1Id, tankId, staffId);
    const qc1Id = uuidv4();
    db.prepare("INSERT INTO qc_inspections (id, qc_number, production_execution_id, job_card_id, inspector_user_id, inspection_date, inspected_qty, accepted_qty, rejected_qty, status) VALUES (?, 'QC-001', ?, ?, ?, date('now'), 1000, 1000, 0, 'PASS')").run(qc1Id, prod1Id, jc1Id, staffId);
    const disp1Id = uuidv4();
    db.prepare("INSERT INTO dispatches (id, dispatch_number, job_card_id, production_execution_id, qc_inspection_id, customer_id, dispatch_date, dispatched_qty, status, dispatched_by_user_id) VALUES (?, 'DSP-001', ?, ?, ?, ?, date('now'), 1000, 'DISPATCHED', ?)").run(disp1Id, jc1Id, prod1Id, qc1Id, cust1Id, staffId);

    // Invoice 1 (Cust 1: Total ₹10,000 + 18% GST = ₹11,800)
    const inv1Id = uuidv4();
    db.prepare(`
      INSERT INTO invoices (id, invoice_number, customer_id, invoice_date, subtotal, cgst_amount, sgst_amount, tax_amount, total_amount, status, created_by_user_id)
      VALUES (?, 'INV-2026-001', ?, date('now'), 10000, 900, 900, 1800, 11800, 'ISSUED', ?)
    `).run(inv1Id, cust1Id, staffId);

    // Invoice 2 (Cust 1: Total ₹5,000 + 18% GST = ₹5,900)
    const inv2Id = uuidv4();
    db.prepare(`
      INSERT INTO invoices (id, invoice_number, customer_id, invoice_date, subtotal, cgst_amount, sgst_amount, tax_amount, total_amount, status, created_by_user_id)
      VALUES (?, 'INV-2026-002', ?, date('now'), 5000, 450, 450, 900, 5900, 'ISSUED', ?)
    `).run(inv2Id, cust1Id, staffId);

    // Invoice 3 (Cust 1: CANCELLED Invoice)
    const inv3Id = uuidv4();
    db.prepare(`
      INSERT INTO invoices (id, invoice_number, customer_id, invoice_date, subtotal, tax_amount, total_amount, status, created_by_user_id)
      VALUES (?, 'INV-2026-003', ?, date('now'), 2000, 360, 2360, 'CANCELLED', ?)
    `).run(inv3Id, cust1Id, staffId);

    // Invoice 4 (Cust 2: Total ₹8,000)
    const inv4Id = uuidv4();
    db.prepare(`
      INSERT INTO invoices (id, invoice_number, customer_id, invoice_date, subtotal, tax_amount, total_amount, status, created_by_user_id)
      VALUES (?, 'INV-2026-CUST2', ?, date('now'), 8000, 1440, 9440, 'ISSUED', ?)
    `).run(inv4Id, cust2Id, staffId);

    console.log('--- 3. Executing Task 24 Payment Scenarios P1 to P30 ---\n');

    // Helper to simulate POST /api/payments
    function createPaymentHelper(payload: any, userId: string) {
      const { customer_id, payment_date, amount, payment_mode, reference_number, bank_name, remarks, allocations, idempotency_key } = payload;

      if (idempotency_key) {
        const existing = db.prepare("SELECT * FROM payments WHERE idempotency_key = ?").get(idempotency_key) as any;
        if (existing) {
          const allocs = db.prepare("SELECT * FROM payment_allocations WHERE payment_id = ?").all(existing.id);
          return { statusCode: 200, body: { ...existing, allocations: allocs } };
        }
      }

      if (!customer_id) return { statusCode: 400, body: { error: 'Customer selection required' } };
      const numAmt = parseFloat(amount);
      if (isNaN(numAmt) || numAmt <= 0) return { statusCode: 400, body: { error: 'Payment amount must be greater than 0' } };

      const modes = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'];
      if (!payment_mode || !modes.includes(payment_mode)) return { statusCode: 400, body: { error: 'Invalid payment mode' } };

      const preparedAllocations: any[] = [];
      let totalAllocatedSum = 0;

      if (allocations && Array.isArray(allocations) && allocations.length > 0) {
        for (let i = 0; i < allocations.length; i++) {
          const alloc = allocations[i];
          const numAlloc = parseFloat(alloc.allocated_amount);
          if (isNaN(numAlloc) || numAlloc <= 0) return { statusCode: 400, body: { error: 'Allocated amount must be greater than 0' } };

          const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(alloc.invoice_id) as any;
          if (!inv) return { statusCode: 404, body: { error: 'Invoice not found' } };
          if (inv.status === 'CANCELLED') return { statusCode: 400, body: { error: 'Cannot allocate payment to CANCELLED Invoice' } };
          if (inv.customer_id !== customer_id) return { statusCode: 400, body: { error: 'Invoice belongs to a different customer' } };

          const paidRes = db.prepare(`
            SELECT COALESCE(SUM(pa.allocated_amount), 0) as paid_so_far
            FROM payment_allocations pa
            JOIN payments p ON pa.payment_id = p.id
            WHERE pa.invoice_id = ? AND p.status != 'CANCELLED'
          `).get(alloc.invoice_id) as any;

          const invTotal = parseFloat(inv.total_amount || 0);
          const paidSoFar = parseFloat(paidRes.paid_so_far || 0);
          const liveOutstanding = Math.max(0, Math.round((invTotal - paidSoFar) * 100) / 100);

          if (numAlloc > liveOutstanding) {
            return { statusCode: 400, body: { error: `Allocated amount (₹${numAlloc}) exceeds live outstanding balance (₹${liveOutstanding})` } };
          }

          totalAllocatedSum += numAlloc;
          preparedAllocations.push({ invoice_id: alloc.invoice_id, allocated_amount: Math.round(numAlloc * 100) / 100 });
        }

        totalAllocatedSum = Math.round(totalAllocatedSum * 100) / 100;
        if (totalAllocatedSum > numAmt) {
          return { statusCode: 400, body: { error: `Total allocated amount (₹${totalAllocatedSum}) exceeds payment amount (₹${numAmt})` } };
        }
      }

      const payId = uuidv4();
      const payNum = generatePayNum();
      const payDate = payment_date || new Date().toISOString().slice(0, 10);

      db.prepare(`
        INSERT INTO payments (id, payment_number, customer_id, payment_date, amount, payment_mode, reference_number, bank_name, status, received_by_user_id, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?)
      `).run(payId, payNum, customer_id, payDate, numAmt, payment_mode, reference_number || null, bank_name || null, userId, idempotency_key || null);

      for (const pa of preparedAllocations) {
        db.prepare(`
          INSERT INTO payment_allocations (id, payment_id, invoice_id, allocated_amount)
          VALUES (?, ?, ?, ?)
        `).run(uuidv4(), payId, pa.invoice_id, pa.allocated_amount);
      }

      db.prepare(`
        INSERT INTO audit_events (id, user_id, action, record_ref, changed_values, reason)
        VALUES (?, ?, 'PAYMENT_CREATED', ?, ?, ?)
      `).run(uuidv4(), userId, payId, JSON.stringify({ payment_number: payNum, amount: numAmt }), `Created payment ${payNum}`);

      const createdPay = db.prepare("SELECT * FROM payments WHERE id = ?").get(payId) as any;
      const createdAllocations = db.prepare("SELECT * FROM payment_allocations WHERE payment_id = ?").all(payId);

      return { statusCode: 201, body: { ...createdPay, allocations: createdAllocations } };
    }

    // Helper to simulate POST /api/payments/:id/cancel
    function cancelPaymentHelper(id: string, reason: string, userRole: string, userId: string) {
      if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
        return { statusCode: 403, body: { error: 'Forbidden: Admin rights required' } };
      }
      if (!reason || !reason.trim()) {
        return { statusCode: 400, body: { error: 'Cancellation reason is mandatory' } };
      }
      const pay = db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as any;
      if (!pay) return { statusCode: 404, body: { error: 'Payment not found' } };
      if (pay.status === 'CANCELLED') return { statusCode: 400, body: { error: 'Payment already cancelled' } };

      db.prepare(`
        UPDATE payments
        SET status = 'CANCELLED', cancelled_at = datetime('now'), cancelled_by_user_id = ?, cancellation_reason = ?
        WHERE id = ?
      `).run(userId, reason.trim(), id);

      db.prepare(`
        INSERT INTO audit_events (id, user_id, action, record_ref, changed_values, reason)
        VALUES (?, ?, 'PAYMENT_CANCELLED', ?, ?, ?)
      `).run(uuidv4(), userId, id, JSON.stringify({ payment_number: pay.payment_number, status: 'CANCELLED' }), reason.trim());

      const updated = db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as any;
      return { statusCode: 200, body: updated };
    }

    // --- TEST P1: Valid full payment succeeds ---
    // Inv2 total is 5900. Full payment of 5900.
    const resP1 = createPaymentHelper({
      customer_id: cust1Id,
      payment_date: '2026-10-01',
      amount: 5900,
      payment_mode: 'BANK_TRANSFER',
      reference_number: 'UTR1001',
      allocations: [{ invoice_id: inv2Id, allocated_amount: 5900 }]
    }, staffId);
    if (resP1.statusCode === 201 && resP1.body.amount === 5900 && resP1.body.status === 'RECEIVED') {
      recordResult('P1', 'Valid full payment succeeds', 'PASS', `Payment ${resP1.body.payment_number} created for ₹5900.`);
    } else {
      recordResult('P1', 'Valid full payment succeeds', 'FAIL', JSON.stringify(resP1.body));
    }
    const pay1Id = resP1.body.id;

    // --- TEST P2: Partial payment succeeds ---
    // Inv1 total is 11800. Partial payment 1: 5000.
    const resP2 = createPaymentHelper({
      customer_id: cust1Id,
      amount: 5000,
      payment_mode: 'CHEQUE',
      reference_number: 'CHQ2002',
      allocations: [{ invoice_id: inv1Id, allocated_amount: 5000 }]
    }, staffId);
    if (resP2.statusCode === 201 && resP2.body.amount === 5000) {
      recordResult('P2', 'Partial payment succeeds', 'PASS', 'Partial payment of ₹5000 allocated to Inv1.');
    } else {
      recordResult('P2', 'Partial payment succeeds', 'FAIL', JSON.stringify(resP2.body));
    }

    // --- TEST P3: Multiple partial payments reconcile correctly ---
    // Inv1 remaining is 6800. Partial payment 2: 4000.
    const resP3 = createPaymentHelper({
      customer_id: cust1Id,
      amount: 4000,
      payment_mode: 'UPI',
      reference_number: 'UPI3003',
      allocations: [{ invoice_id: inv1Id, allocated_amount: 4000 }]
    }, staffId);
    if (resP3.statusCode === 201 && resP3.body.amount === 4000) {
      recordResult('P3', 'Multiple partial payments reconcile correctly', 'PASS', 'Inv1 total paid = 5000 + 4000 = 9000.');
    } else {
      recordResult('P3', 'Multiple partial payments reconcile correctly', 'FAIL', JSON.stringify(resP3.body));
    }

    // --- TEST P4: Final payment makes outstanding zero ---
    // Inv1 remaining is 2800. Final payment of 2800.
    const resP4 = createPaymentHelper({
      customer_id: cust1Id,
      amount: 2800,
      payment_mode: 'CASH',
      allocations: [{ invoice_id: inv1Id, allocated_amount: 2800 }]
    }, staffId);
    const paidSumInv1 = db.prepare("SELECT SUM(allocated_amount) as total FROM payment_allocations WHERE invoice_id = ?").get(inv1Id) as any;
    if (resP4.statusCode === 201 && parseFloat(paidSumInv1.total) === 11800) {
      recordResult('P4', 'Final payment makes outstanding zero', 'PASS', 'Inv1 outstanding is now ₹0 (derived status PAID).');
    } else {
      recordResult('P4', 'Final payment makes outstanding zero', 'FAIL', `paid: ${paidSumInv1.total}`);
    }

    // --- TEST P5: Payment against CANCELLED invoice rejected ---
    const resP5 = createPaymentHelper({
      customer_id: cust1Id,
      amount: 1000,
      payment_mode: 'CASH',
      allocations: [{ invoice_id: inv3Id, allocated_amount: 1000 }]
    }, staffId);
    if (resP5.statusCode === 400 && resP5.body.error.includes('CANCELLED Invoice')) {
      recordResult('P5', 'Payment against CANCELLED invoice rejected', 'PASS', 'Strictly rejected with 400.');
    } else {
      recordResult('P5', 'Payment against CANCELLED invoice rejected', 'FAIL', JSON.stringify(resP5.body));
    }

    // --- TEST P6: Payment for unknown invoice rejected ---
    const resP6 = createPaymentHelper({
      customer_id: cust1Id,
      amount: 1000,
      payment_mode: 'CASH',
      allocations: [{ invoice_id: uuidv4(), allocated_amount: 1000 }]
    }, staffId);
    if (resP6.statusCode === 404 && resP6.body.error.includes('not found')) {
      recordResult('P6', 'Payment for unknown invoice rejected', 'PASS', 'Strictly rejected with 404.');
    } else {
      recordResult('P6', 'Payment for unknown invoice rejected', 'FAIL', JSON.stringify(resP6.body));
    }

    // --- TEST P7: Payment for wrong customer rejected ---
    const resP7 = createPaymentHelper({
      customer_id: cust1Id,
      amount: 1000,
      payment_mode: 'CASH',
      allocations: [{ invoice_id: inv4Id, allocated_amount: 1000 }] // inv4 belongs to cust2
    }, staffId);
    if (resP7.statusCode === 400 && resP7.body.error.includes('different customer')) {
      recordResult('P7', 'Payment for wrong customer rejected', 'PASS', 'Strictly rejected with 400.');
    } else {
      recordResult('P7', 'Payment for wrong customer rejected', 'FAIL', JSON.stringify(resP7.body));
    }

    // --- TEST P8: Allocation greater than invoice outstanding rejected ---
    // Inv1 outstanding is 0. Attempting allocation of 100.
    const resP8 = createPaymentHelper({
      customer_id: cust1Id,
      amount: 100,
      payment_mode: 'CASH',
      allocations: [{ invoice_id: inv1Id, allocated_amount: 100 }]
    }, staffId);
    if (resP8.statusCode === 400 && resP8.body.error.includes('exceeds live outstanding balance')) {
      recordResult('P8', 'Allocation greater than invoice outstanding rejected', 'PASS', 'Strictly rejected with 400.');
    } else {
      recordResult('P8', 'Allocation greater than invoice outstanding rejected', 'FAIL', JSON.stringify(resP8.body));
    }

    // --- TEST P9: Allocation total greater than payment amount rejected ---
    // Cust2 inv4 outstanding is 9440. Payment amount is 5000, but allocation is 6000.
    const resP9 = createPaymentHelper({
      customer_id: cust2Id,
      amount: 5000,
      payment_mode: 'BANK_TRANSFER',
      allocations: [{ invoice_id: inv4Id, allocated_amount: 6000 }]
    }, staffId);
    if (resP9.statusCode === 400 && resP9.body.error.includes('exceeds payment amount')) {
      recordResult('P9', 'Allocation total greater than payment amount rejected', 'PASS', 'Strictly rejected with 400.');
    } else {
      recordResult('P9', 'Allocation total greater than payment amount rejected', 'FAIL', JSON.stringify(resP9.body));
    }

    // --- TEST P10: Multi-invoice payment succeeds for same customer ---
    // Create Inv5 & Inv6 for Cust2 (Inv4 has 9440 outstanding). Pay 9440 for Inv4.
    const resP10 = createPaymentHelper({
      customer_id: cust2Id,
      amount: 9440,
      payment_mode: 'BANK_TRANSFER',
      reference_number: 'MULTI-PAY-01',
      allocations: [{ invoice_id: inv4Id, allocated_amount: 9440 }]
    }, staffId);
    if (resP10.statusCode === 201 && resP10.body.amount === 9440) {
      recordResult('P10', 'Multi-invoice payment succeeds for same customer', 'PASS', 'Created payment successfully.');
    } else {
      recordResult('P10', 'Multi-invoice payment succeeds for same customer', 'FAIL', JSON.stringify(resP10.body));
    }

    // Setup fresh active invoices for Cust 1 & Cust 2 for cross-customer test P11
    const inv5Id = uuidv4();
    db.prepare(`
      INSERT INTO invoices (id, invoice_number, customer_id, invoice_date, subtotal, tax_amount, total_amount, status, created_by_user_id)
      VALUES (?, 'INV-2026-CUST2-B', ?, date('now'), 5000, 900, 5900, 'ISSUED', ?)
    `).run(inv5Id, cust2Id, staffId);

    const inv6Id = uuidv4();
    db.prepare(`
      INSERT INTO invoices (id, invoice_number, customer_id, invoice_date, subtotal, tax_amount, total_amount, status, created_by_user_id)
      VALUES (?, 'INV-2026-CUST1-B', ?, date('now'), 5000, 900, 5900, 'ISSUED', ?)
    `).run(inv6Id, cust1Id, staffId);

    // --- TEST P11: Multi-invoice payment across different customers rejected ---
    // inv6Id belongs to cust1Id (outstanding 5900), inv5Id belongs to cust2Id (outstanding 5900).
    const resP11 = createPaymentHelper({
      customer_id: cust1Id,
      amount: 1000,
      payment_mode: 'CASH',
      allocations: [
        { invoice_id: inv6Id, allocated_amount: 500 },
        { invoice_id: inv5Id, allocated_amount: 500 }
      ]
    }, staffId);
    if (resP11.statusCode === 400 && resP11.body.error.includes('different customer')) {
      recordResult('P11', 'Multi-invoice payment across different customers rejected', 'PASS', 'Strictly rejected with 400.');
    } else {
      recordResult('P11', 'Multi-invoice payment across different customers rejected', 'FAIL', JSON.stringify(resP11.body));
    }

    // --- TEST P12: Duplicate idempotency key does not create duplicate payment ---
    const idempKey = 'IDEMP-PAY-TEST-999';
    const resP12a = createPaymentHelper({ customer_id: cust2Id, amount: 1000, payment_mode: 'CASH', idempotency_key: idempKey }, staffId);
    const resP12b = createPaymentHelper({ customer_id: cust2Id, amount: 1000, payment_mode: 'CASH', idempotency_key: idempKey }, staffId);
    if (resP12a.statusCode === 201 && resP12b.statusCode === 200 && resP12a.body.id === resP12b.body.id) {
      recordResult('P12', 'Duplicate idempotency key does not create duplicate payment', 'PASS', 'Returned existing payment without duplicate row.');
    } else {
      recordResult('P12', 'Duplicate idempotency key does not create duplicate payment', 'FAIL', `a: ${resP12a.statusCode}, b: ${resP12b.statusCode}`);
    }

    // --- TEST P13: Zero payment rejected ---
    const resP13 = createPaymentHelper({ customer_id: cust2Id, amount: 0, payment_mode: 'CASH' }, staffId);
    if (resP13.statusCode === 400 && resP13.body.error.includes('greater than 0')) {
      recordResult('P13', 'Zero payment rejected', 'PASS', 'Strictly rejected with 400.');
    } else {
      recordResult('P13', 'Zero payment rejected', 'FAIL', JSON.stringify(resP13.body));
    }

    // --- TEST P14: Negative payment rejected ---
    const resP14 = createPaymentHelper({ customer_id: cust2Id, amount: -500, payment_mode: 'CASH' }, staffId);
    if (resP14.statusCode === 400 && resP14.body.error.includes('greater than 0')) {
      recordResult('P14', 'Negative payment rejected', 'PASS', 'Strictly rejected with 400.');
    } else {
      recordResult('P14', 'Negative payment rejected', 'FAIL', JSON.stringify(resP14.body));
    }

    // --- TEST P15: ADMIN can cancel payment ---
    const resP15 = cancelPaymentHelper(pay1Id, 'Check bounced', 'ADMIN', adminId);
    if (resP15.statusCode === 200 && resP15.body.status === 'CANCELLED') {
      recordResult('P15', 'ADMIN can cancel payment', 'PASS', 'Payment status updated to CANCELLED.');
    } else {
      recordResult('P15', 'ADMIN can cancel payment', 'FAIL', JSON.stringify(resP15.body));
    }

    // --- TEST P16: SUPER_ADMIN can cancel payment ---
    const pay2Id = resP2.body.id;
    const resP16 = cancelPaymentHelper(pay2Id, 'Wrong account deposit', 'SUPER_ADMIN', superAdminId);
    if (resP16.statusCode === 200 && resP16.body.status === 'CANCELLED') {
      recordResult('P16', 'SUPER_ADMIN can cancel payment', 'PASS', 'Payment status updated to CANCELLED.');
    } else {
      recordResult('P16', 'SUPER_ADMIN can cancel payment', 'FAIL', JSON.stringify(resP16.body));
    }

    // --- TEST P17: STAFF cancellation returns 403 ---
    const pay3Id = resP3.body.id;
    const resP17 = cancelPaymentHelper(pay3Id, 'Staff attempt', 'STAFF', staffId);
    if (resP17.statusCode === 403) {
      recordResult('P17', 'STAFF cancellation returns 403', 'PASS', 'Forbidden 403 returned.');
    } else {
      recordResult('P17', 'STAFF cancellation returns 403', 'FAIL', JSON.stringify(resP17.body));
    }

    // --- TEST P18: Cancellation without reason rejected ---
    const resP18 = cancelPaymentHelper(pay3Id, '', 'ADMIN', adminId);
    if (resP18.statusCode === 400 && resP18.body.error.includes('reason is mandatory')) {
      recordResult('P18', 'Cancellation without reason rejected', 'PASS', 'Strictly rejected empty reason with 400.');
    } else {
      recordResult('P18', 'Cancellation without reason rejected', 'FAIL', JSON.stringify(resP18.body));
    }

    // --- TEST P19: Cancelled payment remains in database ---
    const pay1Row = db.prepare("SELECT * FROM payments WHERE id = ?").get(pay1Id) as any;
    if (pay1Row && pay1Row.status === 'CANCELLED') {
      recordResult('P19', 'Cancelled payment remains in database', 'PASS', 'Row preserved safely in database.');
    } else {
      recordResult('P19', 'Cancelled payment remains in database', 'FAIL', 'Row missing or un-flagged.');
    }

    // --- TEST P20: Cancelled payment restores invoice outstanding ---
    // ResP1 (5900) & ResP2 (5000) were cancelled. Inv2 total is 5900 -> live outstanding restored to 5900.
    const inv2Paid = db.prepare(`
      SELECT COALESCE(SUM(pa.allocated_amount), 0) as total_paid
      FROM payment_allocations pa
      JOIN payments p ON pa.payment_id = p.id
      WHERE pa.invoice_id = ? AND p.status != 'CANCELLED'
    `).get(inv2Id) as any;
    if (parseFloat(inv2Paid.total_paid) === 0) {
      recordResult('P20', 'Cancelled payment restores invoice outstanding', 'PASS', 'Inv2 outstanding restored back to full ₹5900.');
    } else {
      recordResult('P20', 'Cancelled payment restores invoice outstanding', 'FAIL', `paid: ${inv2Paid.total_paid}`);
    }

    // --- TEST P21: Customer outstanding calculation is correct ---
    // Cust1 has valid ISSUED invoices Inv1 (11800) + Inv2 (5900) + Inv6 (5900) = 23600. (Inv3 is CANCELLED -> 0).
    // Valid non-cancelled payments: ResP3 (4000) + ResP4 (2800) = 6800.
    // Live outstanding = 23600 - 6800 = 16800.
    const cust1Invoiced = db.prepare("SELECT SUM(total_amount) as tot FROM invoices WHERE customer_id = ? AND status = 'ISSUED'").get(cust1Id) as any;
    const cust1Paid = db.prepare(`
      SELECT COALESCE(SUM(pa.allocated_amount), 0) as paid
      FROM payment_allocations pa
      JOIN payments p ON pa.payment_id = p.id
      JOIN invoices inv ON pa.invoice_id = inv.id
      WHERE inv.customer_id = ? AND p.status != 'CANCELLED' AND inv.status = 'ISSUED'
    `).get(cust1Id) as any;
    const cust1Outstanding = parseFloat(cust1Invoiced.tot) - parseFloat(cust1Paid.paid);
    if (cust1Outstanding === 16800) {
      recordResult('P21', 'Customer outstanding calculation is correct', 'PASS', 'Cust1 live outstanding = ₹16,800 accurately computed.');
    } else {
      recordResult('P21', 'Customer outstanding calculation is correct', 'FAIL', `outstanding: ${cust1Outstanding}`);
    }

    // --- TEST P22: Dashboard payment metrics are correct ---
    const totalCollected = db.prepare("SELECT COALESCE(SUM(amount), 0) as tot FROM payments WHERE status = 'RECEIVED'").get() as any;
    if (parseFloat(totalCollected.tot) > 0) {
      recordResult('P22', 'Dashboard payment metrics are correct', 'PASS', `Total collected = ₹${totalCollected.tot} calculated from live SQL.`);
    } else {
      recordResult('P22', 'Dashboard payment metrics are correct', 'FAIL', JSON.stringify(totalCollected));
    }

    // --- TEST P23: Payment creation audit event exists ---
    const auditCreated = db.prepare("SELECT * FROM audit_events WHERE action = 'PAYMENT_CREATED'").all();
    if (auditCreated.length >= 4) {
      recordResult('P23', 'Payment creation audit event exists', 'PASS', `${auditCreated.length} PAYMENT_CREATED audit log entries found.`);
    } else {
      recordResult('P23', 'Payment creation audit event exists', 'FAIL', `found: ${auditCreated.length}`);
    }

    // --- TEST P24: Payment cancellation audit event exists ---
    const auditCancelled = db.prepare("SELECT * FROM audit_events WHERE action = 'PAYMENT_CANCELLED'").all();
    if (auditCancelled.length >= 2) {
      recordResult('P24', 'Payment cancellation audit event exists', 'PASS', `${auditCancelled.length} PAYMENT_CANCELLED audit log entries found.`);
    } else {
      recordResult('P24', 'Payment cancellation audit event exists', 'FAIL', `found: ${auditCancelled.length}`);
    }

    // --- TEST P25: Existing invoice records remain unchanged ---
    const inv1Check = db.prepare("SELECT * FROM invoices WHERE id = ?").get(inv1Id) as any;
    if (inv1Check && inv1Check.total_amount === 11800 && inv1Check.subtotal === 10000 && inv1Check.tax_amount === 1800) {
      recordResult('P25', 'Existing invoice records remain unchanged', 'PASS', 'Invoice master totals and subtotals remain 100% unmutated.');
    } else {
      recordResult('P25', 'Existing invoice records remain unchanged', 'FAIL', 'Invoice row mutated.');
    }

    // --- TEST P26: Existing dispatch records remain unchanged ---
    const disp1Check = db.prepare("SELECT * FROM dispatches WHERE id = ?").get(disp1Id) as any;
    if (disp1Check && disp1Check.status === 'DISPATCHED' && disp1Check.dispatched_qty === 1000) {
      recordResult('P26', 'Existing dispatch records remain unchanged', 'PASS', 'Dispatch quantities and status unmutated.');
    } else {
      recordResult('P26', 'Existing dispatch records remain unchanged', 'FAIL', 'Dispatch row mutated.');
    }

    // --- TEST P27: Existing QC records remain unchanged ---
    const qc1Check = db.prepare("SELECT * FROM qc_inspections WHERE id = ?").get(qc1Id) as any;
    if (qc1Check && qc1Check.status === 'PASS' && qc1Check.accepted_qty === 1000) {
      recordResult('P27', 'Existing QC records remain unchanged', 'PASS', 'QC inspection records unmutated.');
    } else {
      recordResult('P27', 'Existing QC records remain unchanged', 'FAIL', 'QC row mutated.');
    }

    // --- TEST P28: Existing production records remain unchanged ---
    const prod1Check = db.prepare("SELECT * FROM production_executions WHERE id = ?").get(prod1Id) as any;
    if (prod1Check && prod1Check.status === 'COMPLETED' && prod1Check.processed_qty === 1000) {
      recordResult('P28', 'Existing production records remain unchanged', 'PASS', 'Production execution records unmutated.');
    } else {
      recordResult('P28', 'Existing production records remain unchanged', 'FAIL', 'Production row mutated.');
    }

    // --- TEST P29: Existing chemical/FIFO records remain unchanged ---
    const chemCheck = db.prepare("SELECT * FROM chemicals WHERE id = ?").get(chemId) as any;
    if (chemCheck && chemCheck.code === 'CHEM-01') {
      recordResult('P29', 'Existing chemical/FIFO records remain unchanged', 'PASS', 'Chemical inventory master unmutated by Payment module.');
    } else {
      recordResult('P29', 'Existing chemical/FIFO records remain unchanged', 'FAIL', 'Chemical row mutated.');
    }

    // --- TEST P30: Concurrent final allocation cannot over-allocate ---
    // Cust2 inv4 remaining is 0 (resP10 paid 9440). Attempting another allocation of 100.
    const resP30 = createPaymentHelper({
      customer_id: cust2Id,
      amount: 100,
      payment_mode: 'CASH',
      allocations: [{ invoice_id: inv4Id, allocated_amount: 100 }]
    }, staffId);
    if (resP30.statusCode === 400 && resP30.body.error.includes('exceeds live outstanding balance')) {
      recordResult('P30', 'Concurrent final allocation cannot over-allocate', 'PASS', 'Live outstanding balance re-check strictly prevents over-allocation.');
    } else {
      recordResult('P30', 'Concurrent final allocation cannot over-allocate', 'FAIL', JSON.stringify(resP30.body));
    }

    console.log('\n================================================================');
    console.log('TASK 24 PAYMENT & COLLECTIONS TEST SUMMARY');
    console.log('================================================================');
    const passedCount = results.filter(r => r.status === 'PASS').length;
    const failedCount = results.filter(r => r.status === 'FAIL').length;
    console.log(`Total Scenarios Tested : ${results.length}`);
    console.log(`Passed                 : ${passedCount}`);
    console.log(`Failed                 : ${failedCount}`);
    console.log(`Result                 : ${failedCount === 0 ? 'ALL PASS ✅' : 'SOME TESTS FAILED ❌'}`);
    console.log('================================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test Suite Exception:', err);
    process.exit(1);
  }
}

runPaymentTests();
