import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import path from 'path';
import { resetDemoDatabase } from './reset_demo_database';

export interface DemoDatasetSummary {
  dbPath: string;
  customersCount: number;
  partsCount: number;
  tanksCount: number;
  chemicalsCount: number;
  receiptLotsCount: number;
  ordersCount: number;
  inwardsCount: number;
  jobCardsCount: number;
  productionPlansCount: number;
  productionExecutionsCount: number;
  qcInspectionsCount: number;
  dispatchesCount: number;
  invoicesCount: number;
  paymentsCount: number;
  paymentAllocationsCount: number;
  chemicalIssuesCount: number;
}

/**
 * Seeds the isolated demo database with a realistic, end-to-end UAT dataset.
 * STRICT SAFETY RULE: Refuses to run against data/qelanto_factory.sqlite.
 */
export function seedDemoData(targetPath?: string): DemoDatasetSummary {
  const dbPath = targetPath || process.env.DEMO_DB_PATH || 'data/demo_factory.sqlite';

  // CRITICAL SAFETY CHECK
  const normalizedPath = path.normalize(dbPath).toLowerCase();
  if (normalizedPath.includes('qelanto_factory.sqlite')) {
    console.error('================================================================');
    console.error('CRITICAL SAFETY VIOLATION DETECTED:');
    console.error('Attempted to execute seed script on production database!');
    console.error(`Target: ${dbPath}`);
    console.error('ABORTING IMMEDIATELY TO PROTECT PRODUCTION DATA.');
    console.error('================================================================');
    throw new Error('SAFETY_VIOLATION: Refusing to operate on production database data/qelanto_factory.sqlite');
  }

  console.log('================================================================');
  console.log('VETRIVEL PLATERS ERP — DEMO / UAT DATASET SEEDER');
  console.log(`Database: ${dbPath} (ISOLATED DEMO DATABASE)`);
  console.log('================================================================\n');

  // Reset database before seeding to guarantee determinism
  resetDemoDatabase(dbPath);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // -------------------------------------------------------------
  // 1. SEED USERS (Three-Account Model)
  // -------------------------------------------------------------
  console.log('1. Seeding User Accounts (SUPER_ADMIN, ADMIN, STAFF)...');
  const superAdminId = uuidv4();
  const adminId = uuidv4();
  const staffId = uuidv4();

  const superHash = bcrypt.hashSync('superadmin123', 8);
  const adminHash = bcrypt.hashSync('admin123', 8);
  const staffHash = bcrypt.hashSync('staff123', 8);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, role, is_active)
    VALUES 
      (?, 'superadmin@vetrivel.com', ?, 'Vetrivel Super Admin', 'SUPER_ADMIN', 1),
      (?, 'admin@vetrivel.com', ?, 'Plant Manager (Admin)', 'ADMIN', 1),
      (?, 'staff@vetrivel.com', ?, 'Floor Supervisor (Staff)', 'STAFF', 1)
  `).run(superAdminId, superHash, adminId, adminHash, staffId, staffHash);

  // -------------------------------------------------------------
  // 2. SEED CUSTOMERS
  // -------------------------------------------------------------
  console.log('2. Seeding Customers...');
  const custAbcId = uuidv4();
  const custXyzId = uuidv4();
  const custSmcId = uuidv4();

  db.prepare(`
    INSERT INTO customers (id, name, code, contact_person, phone, email, address, gst_number)
    VALUES 
      (?, 'ABC Auto Components Pvt Ltd', 'ABC-01', 'K. Rajesh', '9840112233', 'orders@abcauto.com', 'Plot 45, Ambattur Industrial Estate, Chennai, Tamil Nadu - 600058', '33DEMOABC1234F1Z5'),
      (?, 'XYZ Engineering Industries', 'XYZ-02', 'S. Vignesh', '9840223344', 'purchase@xyzengg.com', 'SIDCO Industrial Estate, Coimbatore, Tamil Nadu - 641021', '33DEMOXYZ5678G1Z2'),
      (?, 'Sri Murugan Components', 'SMC-03', 'M. Ramanathan', '9840334455', 'smc@murugancomp.com', 'Kappalur Industrial Area, Madurai, Tamil Nadu - 625008', '33DEMOSMC9999M1Z1')
  `).run(custAbcId, custXyzId, custSmcId);

  // -------------------------------------------------------------
  // 3. SEED PARTS
  // -------------------------------------------------------------
  console.log('3. Seeding Parts...');
  const partBrkId = uuidv4();
  const partPinId = uuidv4();
  const partBoltId = uuidv4();

  db.prepare(`
    INSERT INTO parts (id, customer_id, part_number, part_name, process_type, rate_per_piece, base_unit)
    VALUES 
      (?, ?, 'BRK-001', 'Automotive Brake Bracket', 'Zinc Plating', 250.00, 'nos'),
      (?, ?, 'PIN-002', 'Precision Shaft Pin', 'Nickel Plating', 120.00, 'nos'),
      (?, ?, 'BOLT-003', 'High-Tensile Plated Bolt', 'Zinc Plating', 45.00, 'nos')
  `).run(partBrkId, custAbcId, partPinId, custXyzId, partBoltId, custSmcId);

  // -------------------------------------------------------------
  // 4. SEED TANKS / BATHS
  // -------------------------------------------------------------
  console.log('4. Seeding Tanks/Baths...');
  const tankZnId = uuidv4();
  const tankNiId = uuidv4();

  db.prepare(`
    INSERT INTO tanks (id, code, display_name, capacity_liters, status, location, is_active)
    VALUES 
      (?, 'TANK-ZN-01', 'Zinc Cyanide Bath 1', 3000.0, 'ACTIVE', 'Bay A - Line 1', 1),
      (?, 'TANK-NI-02', 'Nickel Electroplating Bath 2', 2500.0, 'ACTIVE', 'Bay B - Line 2', 1)
  `).run(tankZnId, tankNiId);

  // -------------------------------------------------------------
  // 5. SEED SUPPLIERS & CHEMICAL MASTER & CHRONOLOGICAL FIFO LOTS
  // -------------------------------------------------------------
  console.log('5. Seeding Chemicals, Suppliers & Multi-Lot FIFO Stock...');
  const supplierId = uuidv4();
  db.prepare(`
    INSERT INTO suppliers (id, name, contact_details, address, is_active)
    VALUES (?, 'Industrial Chemical Suppliers Ltd', 'Sales: 9444109876, chemicals@indchem.com', 'Plot 12, Manali Industrial Belt, Chennai', 1)
  `).run(supplierId);

  const chemZnId = uuidv4();
  const chemNiId = uuidv4();
  const chemHclId = uuidv4();

  db.prepare(`
    INSERT INTO chemicals (id, code, name, base_unit, min_stock_level, is_active, description)
    VALUES 
      (?, 'CHEM-ZN-01', 'Zinc Cyanide Salt', 'kg', 50.0, 1, 'High-grade zinc plating salt for Bath 1'),
      (?, 'CHEM-NI-01', 'Nickel Sulfate Hexahydrate', 'kg', 40.0, 1, 'Electroplating nickel bath grade'),
      (?, 'CHEM-HCL-01', 'Hydrochloric Acid 33%', 'L', 100.0, 1, 'Surface pickling & acid activation chemical')
  `).run(chemZnId, chemNiId, chemHclId);

  // Purchase Receipts & Receipt Lots with distinct chronological actual_received_at timestamps
  const prZn1Id = uuidv4();
  const prZn2Id = uuidv4();
  const prNi1Id = uuidv4();
  const prNi2Id = uuidv4();

  db.prepare(`
    INSERT INTO purchase_receipts (id, receipt_number, supplier_id, bill_number, bill_date, actual_received_at, status, created_by_user_id)
    VALUES 
      (?, 'PR-DEMO-ZN-01', ?, 'INV-IND-8801', '2026-09-01', '2026-09-01 09:00:00', 'POSTED', ?),
      (?, 'PR-DEMO-ZN-02', ?, 'INV-IND-8910', '2026-09-15', '2026-09-15 10:00:00', 'POSTED', ?),
      (?, 'PR-DEMO-NI-01', ?, 'INV-IND-8820', '2026-09-05', '2026-09-05 09:30:00', 'POSTED', ?),
      (?, 'PR-DEMO-NI-02', ?, 'INV-IND-8930', '2026-09-20', '2026-09-20 11:00:00', 'POSTED', ?)
  `).run(
    prZn1Id, supplierId, adminId,
    prZn2Id, supplierId, adminId,
    prNi1Id, supplierId, adminId,
    prNi2Id, supplierId, adminId
  );

  const lotZnAId = uuidv4();
  const lotZnBId = uuidv4();
  const lotNiAId = uuidv4();
  const lotNiBId = uuidv4();

  // Zinc Salt Lots: Lot A (100 kg, older) and Lot B (150 kg, newer)
  db.prepare(`
    INSERT INTO receipt_lots (id, purchase_receipt_id, chemical_id, lot_number, supplier_batch_number, initial_qty, remaining_qty, status, actual_received_at)
    VALUES 
      (?, ?, ?, 'LOT-DEMO-ZN-01', 'BAT-ZN-001', 100.0, 100.0, 'AVAILABLE', '2026-09-01 09:00:00'),
      (?, ?, ?, 'LOT-DEMO-ZN-02', 'BAT-ZN-002', 150.0, 150.0, 'AVAILABLE', '2026-09-15 10:00:00')
  `).run(lotZnAId, prZn1Id, chemZnId, lotZnBId, prZn2Id, chemZnId);

  // Nickel Sulfate Lots: Lot A (80 kg, older) and Lot B (120 kg, newer)
  db.prepare(`
    INSERT INTO receipt_lots (id, purchase_receipt_id, chemical_id, lot_number, supplier_batch_number, initial_qty, remaining_qty, status, actual_received_at)
    VALUES 
      (?, ?, ?, 'LOT-DEMO-NI-01', 'BAT-NI-001', 80.0, 80.0, 'AVAILABLE', '2026-09-05 09:30:00'),
      (?, ?, ?, 'LOT-DEMO-NI-02', 'BAT-NI-002', 120.0, 120.0, 'AVAILABLE', '2026-09-20 11:00:00')
  `).run(lotNiAId, prNi1Id, chemNiId, lotNiBId, prNi2Id, chemNiId);

  // -------------------------------------------------------------
  // 6. PRIMARY DEMO SCENARIO (Customer Order → Inward → Job Card → Planning → FIFO → Prod → QC → Disp → Inv → Payment)
  // -------------------------------------------------------------
  console.log('6. Seeding Primary End-to-End Demo Workflow (CO-DEMO-001)...');

  // Stage 1: Customer Order
  const order1Id = uuidv4();
  const orderItem1Id = uuidv4();
  db.prepare(`
    INSERT INTO customer_orders (id, order_number, customer_id, customer_po_number, order_date, expected_delivery_date, status, total_quantity, total_amount, notes, created_by_user_id)
    VALUES (?, 'CO-DEMO-001', ?, 'ABC/PO/2026/001', '2026-10-01', '2026-10-10', 'CONFIRMED', 100, 25000.00, 'Primary UAT Automotive Braking Bracket order', ?)
  `).run(order1Id, custAbcId, adminId);

  db.prepare(`
    INSERT INTO customer_order_items (id, customer_order_id, part_id, quantity, rate, line_amount, process_type, notes)
    VALUES (?, ?, ?, 100, 250.00, 25000.00, 'Zinc Plating', 'Target 8.0 microns clear passivated')
  `).run(orderItem1Id, order1Id, partBrkId);

  // Stage 2: Parts Inward
  const inward1Id = uuidv4();
  db.prepare(`
    INSERT INTO customer_parts_inward (id, inward_number, customer_order_id, customer_order_item_id, challan_number, challan_date, received_date, accepted_qty, rejected_qty, rejection_reason, status, received_by_user_id, notes)
    VALUES (?, 'INW-DEMO-001', ?, ?, 'DC-ABC-9901', '2026-10-01', '2026-10-01', 98, 2, 'Physical damage / surface defect', 'RECEIVED', ?, '98 accepted, 2 rejected on inward inspection')
  `).run(inward1Id, order1Id, orderItem1Id, staffId);

  // Stage 3: Job Card
  const jobCard1Id = uuidv4();
  db.prepare(`
    INSERT INTO job_cards (id, job_card_number, customer_parts_inward_id, customer_order_item_id, allocated_qty, target_thickness_microns, plating_process, tank_id, priority, status, released_by_user_id, notes)
    VALUES (?, 'JC-DEMO-001', ?, ?, 98, 8.0, 'Zinc Plating', ?, 'URGENT', 'COMPLETED', ?, 'Job Card allocated from accepted inward')
  `).run(jobCard1Id, inward1Id, orderItem1Id, tankZnId, adminId);

  // Stage 4: Production Planning
  const plan1Id = uuidv4();
  db.prepare(`
    INSERT INTO production_plans (id, job_card_id, priority, planned_date, planned_start_time, planning_notes, created_by_user_id)
    VALUES (?, ?, 'HIGH', '2026-10-02', '08:30:00', 'Priority customer order — complete before scheduled dispatch.', ?)
  `).run(plan1Id, jobCard1Id, adminId);

  // Stage 5: Production Execution
  const prodExec1Id = uuidv4();
  db.prepare(`
    INSERT INTO production_executions (id, production_number, job_card_id, tank_id, production_date, started_at, completed_at, planned_qty, processed_qty, rejected_qty, status, operator_user_id, notes)
    VALUES (?, 'PRD-DEMO-001', ?, ?, '2026-10-02', '2026-10-02 08:30:00', '2026-10-02 12:45:00', 98, 98, 0, 'COMPLETED', ?, 'Plated on TANK-ZN-01 strictly adhering to 8 microns spec')
  `).run(prodExec1Id, jobCard1Id, tankZnId, staffId);

  // Stage 6: Chemical Store / FIFO Consumption
  // Production consumes 15 kg of Zinc Salt from oldest Lot A
  const issue1Id = uuidv4();

  db.prepare(`
    UPDATE receipt_lots
    SET remaining_qty = remaining_qty - 15.0
    WHERE id = ?
  `).run(lotZnAId); // Lot A now 85.0 kg

  db.prepare(`
    INSERT INTO chemical_issues (id, issue_number, issue_date, chemical_id, required_qty, tank_id, job_card_id, production_execution_id, issued_by_user_id, remarks, total_allocated_value, status)
    VALUES (?, 'ISS-DEMO-001', '2026-10-02', ?, 15.0, ?, ?, ?, ?, 'Zinc bath replenishment for JC-DEMO-001', 1500.0, 'POSTED')
  `).run(issue1Id, chemZnId, tankZnId, jobCard1Id, prodExec1Id, staffId);

  db.prepare(`
    INSERT INTO fifo_allocations (id, chemical_issue_id, receipt_lot_id, allocated_qty, rate_per_unit, allocation_value)
    VALUES (?, ?, ?, 15.0, 100.0, 1500.0)
  `).run(uuidv4(), issue1Id, lotZnAId);

  db.prepare(`
    INSERT INTO stock_movements (id, movement_type, chemical_id, receipt_lot_id, reference_type, reference_id, quantity_change, balance_after, movement_date, created_by_user_id, reason)
    VALUES (?, 'ISSUE', ?, ?, 'CHEMICAL_ISSUE', ?, -15.0, 85.0, '2026-10-02', ?, 'FIFO deduction of 15 kg from oldest Lot A')
  `).run(uuidv4(), chemZnId, lotZnAId, issue1Id, staffId);

  // Stage 7: Quality Control (QC)
  const qc1Id = uuidv4();
  db.prepare(`
    INSERT INTO qc_inspections (id, qc_number, production_execution_id, job_card_id, inspector_user_id, inspection_date, inspected_qty, accepted_qty, rejected_qty, coating_thickness, min_thickness, max_thickness, visual_defect, defect_details, remarks, status, completed_at)
    VALUES (?, 'QC-DEMO-001', ?, ?, ?, '2026-10-02', 98, 95, 3, 8.2, 7.8, 8.6, 'PEELING', 'Minor edge blister on 3 pcs', '95 pcs passed standard salt spray & thickness criteria; 3 pcs segregated for stripping & rework', 'PASS', '2026-10-02 14:30:00')
  `).run(qc1Id, prodExec1Id, jobCard1Id, staffId);

  // Stage 8: Dispatch (95 pcs passed)
  const dispatch1Id = uuidv4();
  db.prepare(`
    INSERT INTO dispatches (id, dispatch_number, job_card_id, production_execution_id, qc_inspection_id, customer_id, dispatch_date, dispatched_qty, vehicle_number, transporter_name, delivery_address, challan_number, remarks, status, dispatched_by_user_id)
    VALUES (?, 'DSP-DEMO-001', ?, ?, ?, ?, '2026-10-03', 95, 'TN-XX-1234', 'Demo Logistics', 'Plot 45, Ambattur Industrial Estate, Chennai', 'DC-DEMO-001', 'Dispatched 95 certified parts with mill test certificate', 'DISPATCHED', ?)
  `).run(dispatch1Id, jobCard1Id, prodExec1Id, qc1Id, custAbcId, staffId);

  // Stage 9: Invoice (95 pcs @ ₹250.00 = Taxable: ₹23,750, CGST: ₹2,137.50, SGST: ₹2,137.50, Total: ₹28,025.00)
  const invoice1Id = uuidv4();
  db.prepare(`
    INSERT INTO invoices (id, invoice_number, customer_id, invoice_date, subtotal, cgst_amount, sgst_amount, igst_amount, tax_amount, total_amount, place_of_supply, billing_address, gstin, status, created_by_user_id)
    VALUES (?, 'INV-DEMO-001', ?, '2026-10-03', 23750.00, 2137.50, 2137.50, 0, 4275.00, 28025.00, 'Tamil Nadu (33)', 'Plot 45, Ambattur Industrial Estate, Chennai', '33DEMOABC1234F1Z5', 'ISSUED', ?)
  `).run(invoice1Id, custAbcId, adminId);

  db.prepare(`
    INSERT INTO invoice_lines (id, invoice_id, dispatch_id, job_card_id, production_execution_id, qc_inspection_id, description, quantity, unit_price, taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, line_total)
    VALUES (?, ?, ?, ?, ?, ?, 'Zinc Plating Service for Automotive Brake Bracket', 95, 250.00, 23750.00, 18.0, 2137.50, 2137.50, 0, 28025.00)
  `).run(uuidv4(), invoice1Id, dispatch1Id, jobCard1Id, prodExec1Id, qc1Id);

  // Stage 10: Payment (₹20,000 partial payment)
  const payment1Id = uuidv4();
  db.prepare(`
    INSERT INTO payments (id, payment_number, customer_id, payment_date, amount, payment_mode, reference_number, bank_name, transaction_date, remarks, status, received_by_user_id)
    VALUES (?, 'PAY-DEMO-001', ?, '2026-10-04', 20000.00, 'BANK_TRANSFER', 'NEFT-ABC-20261002-001', 'HDFC Bank', '2026-10-04', 'Partial settlement against INV-DEMO-001', 'RECEIVED', ?)
  `).run(payment1Id, custAbcId, adminId);

  db.prepare(`
    INSERT INTO payment_allocations (id, payment_id, invoice_id, allocated_amount)
    VALUES (?, ?, ?, 20000.00)
  `).run(uuidv4(), payment1Id, invoice1Id);

  // -------------------------------------------------------------
  // 7. ADDITIONAL SCENARIOS
  // -------------------------------------------------------------
  console.log('7. Seeding Additional Scenarios (A: Fully Paid, B: Partial Inward, C: Production Pending, D: QC Fail, E: Multi-Lot FIFO)...');

  // Scenario A: Fully Paid Customer (XYZ Engineering Industries)
  const order2Id = uuidv4();
  const orderItem2Id = uuidv4();
  const inward2Id = uuidv4();
  const jobCard2Id = uuidv4();
  const prodExec2Id = uuidv4();
  const qc2Id = uuidv4();
  const dispatch2Id = uuidv4();
  const invoice2Id = uuidv4();
  const payment2Id = uuidv4();

  db.prepare(`
    INSERT INTO customer_orders (id, order_number, customer_id, customer_po_number, order_date, expected_delivery_date, status, total_quantity, total_amount, created_by_user_id)
    VALUES (?, 'CO-DEMO-002', ?, 'XYZ/PO/2026/088', '2026-09-28', '2026-10-08', 'CONFIRMED', 50, 6000.00, ?)
  `).run(order2Id, custXyzId, adminId);

  db.prepare(`
    INSERT INTO customer_order_items (id, customer_order_id, part_id, quantity, rate, line_amount, process_type)
    VALUES (?, ?, ?, 50, 120.00, 6000.00, 'Nickel Plating')
  `).run(orderItem2Id, order2Id, partPinId);

  db.prepare(`
    INSERT INTO customer_parts_inward (id, inward_number, customer_order_id, customer_order_item_id, challan_number, challan_date, received_date, accepted_qty, rejected_qty, status, received_by_user_id)
    VALUES (?, 'INW-DEMO-002', ?, ?, 'DC-XYZ-4421', '2026-09-28', '2026-09-28', 50, 0, 'RECEIVED', ?)
  `).run(inward2Id, order2Id, orderItem2Id, staffId);

  db.prepare(`
    INSERT INTO job_cards (id, job_card_number, customer_parts_inward_id, customer_order_item_id, allocated_qty, target_thickness_microns, plating_process, tank_id, priority, status, released_by_user_id)
    VALUES (?, 'JC-DEMO-002', ?, ?, 50, 10.0, 'Nickel Plating', ?, 'NORMAL', 'COMPLETED', ?)
  `).run(jobCard2Id, inward2Id, orderItem2Id, tankNiId, adminId);

  db.prepare(`
    INSERT INTO production_executions (id, production_number, job_card_id, tank_id, production_date, planned_qty, processed_qty, rejected_qty, status, operator_user_id)
    VALUES (?, 'PRD-DEMO-002', ?, ?, '2026-09-29', 50, 50, 0, 'COMPLETED', ?)
  `).run(prodExec2Id, jobCard2Id, tankNiId, staffId);

  db.prepare(`
    INSERT INTO qc_inspections (id, qc_number, production_execution_id, job_card_id, inspector_user_id, inspection_date, inspected_qty, accepted_qty, rejected_qty, status)
    VALUES (?, 'QC-DEMO-002', ?, ?, ?, '2026-09-29', 50, 50, 0, 'PASS')
  `).run(qc2Id, prodExec2Id, jobCard2Id, staffId);

  db.prepare(`
    INSERT INTO dispatches (id, dispatch_number, job_card_id, production_execution_id, qc_inspection_id, customer_id, dispatch_date, dispatched_qty, challan_number, status, dispatched_by_user_id)
    VALUES (?, 'DSP-DEMO-002', ?, ?, ?, ?, '2026-09-30', 50, 'DC-XYZ-DISP-02', 'DISPATCHED', ?)
  `).run(dispatch2Id, jobCard2Id, prodExec2Id, qc2Id, custXyzId, staffId);

  db.prepare(`
    INSERT INTO invoices (id, invoice_number, customer_id, invoice_date, subtotal, cgst_amount, sgst_amount, igst_amount, tax_amount, total_amount, place_of_supply, status, created_by_user_id)
    VALUES (?, 'INV-DEMO-002', ?, '2026-09-30', 6000.00, 540.00, 540.00, 0, 1080.00, 7080.00, 'Tamil Nadu (33)', 'ISSUED', ?)
  `).run(invoice2Id, custXyzId, adminId);

  db.prepare(`
    INSERT INTO invoice_lines (id, invoice_id, dispatch_id, job_card_id, production_execution_id, qc_inspection_id, description, quantity, unit_price, taxable_value, gst_rate, cgst_amount, sgst_amount, line_total)
    VALUES (?, ?, ?, ?, ?, ?, 'Nickel Plating for Precision Shaft Pin', 50, 120.00, 6000.00, 18.0, 540.00, 540.00, 7080.00)
  `).run(uuidv4(), invoice2Id, dispatch2Id, jobCard2Id, prodExec2Id, qc2Id);

  // Full Payment -> Outstanding is ZERO
  db.prepare(`
    INSERT INTO payments (id, payment_number, customer_id, payment_date, amount, payment_mode, reference_number, status, received_by_user_id)
    VALUES (?, 'PAY-DEMO-002', ?, '2026-10-01', 7080.00, 'UPI', 'UPI-XYZ-998877', 'RECEIVED', ?)
  `).run(payment2Id, custXyzId, adminId);

  db.prepare(`
    INSERT INTO payment_allocations (id, payment_id, invoice_id, allocated_amount)
    VALUES (?, ?, ?, 7080.00)
  `).run(uuidv4(), payment2Id, invoice2Id);

  // Scenario B: Partial Inward (XYZ Engineering Industries)
  const order3Id = uuidv4();
  const orderItem3Id = uuidv4();
  const inward3Id = uuidv4();

  db.prepare(`
    INSERT INTO customer_orders (id, order_number, customer_id, customer_po_number, order_date, expected_delivery_date, status, total_quantity, total_amount, created_by_user_id)
    VALUES (?, 'CO-DEMO-003', ?, 'XYZ/PO/2026/099', '2026-10-01', '2026-10-25', 'CONFIRMED', 200, 24000.00, ?)
  `).run(order3Id, custXyzId, adminId);

  db.prepare(`
    INSERT INTO customer_order_items (id, customer_order_id, part_id, quantity, rate, line_amount, process_type)
    VALUES (?, ?, ?, 200, 120.00, 24000.00, 'Nickel Plating')
  `).run(orderItem3Id, order3Id, partPinId);

  // Received 120 out of 200 -> 80 pending!
  db.prepare(`
    INSERT INTO customer_parts_inward (id, inward_number, customer_order_id, customer_order_item_id, challan_number, challan_date, received_date, accepted_qty, rejected_qty, status, received_by_user_id, notes)
    VALUES (?, 'INW-DEMO-003', ?, ?, 'DC-XYZ-5510', '2026-10-01', '2026-10-01', 120, 0, 'RECEIVED', ?, 'Partial consignment received (120 of 200 pcs)')
  `).run(inward3Id, order3Id, orderItem3Id, staffId);

  // Scenario C: Production Pending on Workboard
  const jobCard3Id = uuidv4();
  db.prepare(`
    INSERT INTO job_cards (id, job_card_number, customer_parts_inward_id, customer_order_item_id, allocated_qty, target_thickness_microns, plating_process, tank_id, priority, status, released_by_user_id)
    VALUES (?, 'JC-DEMO-003', ?, ?, 120, 10.0, 'Nickel Plating', ?, 'NORMAL', 'RELEASED', ?)
  `).run(jobCard3Id, inward3Id, orderItem3Id, tankNiId, adminId);

  db.prepare(`
    INSERT INTO production_plans (id, job_card_id, priority, planned_date, planned_start_time, planning_notes, created_by_user_id)
    VALUES (?, ?, 'NORMAL', '2026-10-06', '09:00:00', 'Second batch for XYZ - waiting for line clearance', ?)
  `).run(uuidv4(), jobCard3Id, adminId);

  // Scenario D: QC Failure (Sri Murugan Components)
  const order4Id = uuidv4();
  const orderItem4Id = uuidv4();
  const inward4Id = uuidv4();
  const jobCard4Id = uuidv4();
  const prodExec4Id = uuidv4();
  const qc4Id = uuidv4();

  db.prepare(`
    INSERT INTO customer_orders (id, order_number, customer_id, customer_po_number, order_date, expected_delivery_date, status, total_quantity, total_amount, created_by_user_id)
    VALUES (?, 'CO-DEMO-004', ?, 'SMC/PO/2026/012', '2026-09-25', '2026-10-05', 'CONFIRMED', 50, 2250.00, ?)
  `).run(order4Id, custSmcId, adminId);

  db.prepare(`
    INSERT INTO customer_order_items (id, customer_order_id, part_id, quantity, rate, line_amount, process_type)
    VALUES (?, ?, ?, 50, 45.00, 2250.00, 'Zinc Plating')
  `).run(orderItem4Id, order4Id, partBoltId);

  db.prepare(`
    INSERT INTO customer_parts_inward (id, inward_number, customer_order_id, customer_order_item_id, challan_number, challan_date, received_date, accepted_qty, rejected_qty, status, received_by_user_id)
    VALUES (?, 'INW-DEMO-004', ?, ?, 'DC-SMC-101', '2026-09-26', '2026-09-26', 50, 0, 'RECEIVED', ?)
  `).run(inward4Id, order4Id, orderItem4Id, staffId);

  db.prepare(`
    INSERT INTO job_cards (id, job_card_number, customer_parts_inward_id, customer_order_item_id, allocated_qty, target_thickness_microns, plating_process, tank_id, priority, status, released_by_user_id)
    VALUES (?, 'JC-DEMO-004', ?, ?, 50, 5.0, 'Zinc Plating', ?, 'NORMAL', 'COMPLETED', ?)
  `).run(jobCard4Id, inward4Id, orderItem4Id, tankZnId, adminId);

  db.prepare(`
    INSERT INTO production_executions (id, production_number, job_card_id, tank_id, production_date, planned_qty, processed_qty, rejected_qty, status, operator_user_id)
    VALUES (?, 'PRD-DEMO-004', ?, ?, '2026-09-27', 50, 50, 0, 'COMPLETED', ?)
  `).run(prodExec4Id, jobCard4Id, tankZnId, staffId);

  // QC FAIL: 50 rejected, 0 accepted -> Ineligible for dispatch!
  db.prepare(`
    INSERT INTO qc_inspections (id, qc_number, production_execution_id, job_card_id, inspector_user_id, inspection_date, inspected_qty, accepted_qty, rejected_qty, visual_defect, defect_details, remarks, status)
    VALUES (?, 'QC-DEMO-004', ?, ?, ?, '2026-09-27', 50, 0, 50, 'PEELING', 'Severe blister and adhesion detachment under scratch test', 'Lot rejected. Material returned for chemical de-plating and reprocessing.', 'FAIL')
  `).run(qc4Id, prodExec4Id, jobCard4Id, staffId);

  // Scenario E: Multi-Lot FIFO Issue Split Demonstration
  // Consumes 95 kg of Nickel Sulfate across Lot A (80 kg) and Lot B (15 kg)
  const issue2Id = uuidv4();
  db.prepare(`
    UPDATE receipt_lots
    SET remaining_qty = 0.0, status = 'EXHAUSTED'
    WHERE id = ?
  `).run(lotNiAId); // Lot A exhausted

  db.prepare(`
    UPDATE receipt_lots
    SET remaining_qty = remaining_qty - 15.0
    WHERE id = ?
  `).run(lotNiBId); // Lot B now 105.0 kg

  db.prepare(`
    INSERT INTO chemical_issues (id, issue_number, issue_date, chemical_id, required_qty, tank_id, issued_by_user_id, remarks, total_allocated_value, status)
    VALUES (?, 'ISS-DEMO-002', '2026-09-29', ?, 95.0, ?, ?, 'Multi-lot FIFO issue: 80 kg from Lot A + 15 kg from Lot B', 9500.0, 'POSTED')
  `).run(issue2Id, chemNiId, tankNiId, staffId);

  db.prepare(`
    INSERT INTO fifo_allocations (id, chemical_issue_id, receipt_lot_id, allocated_qty, rate_per_unit, allocation_value)
    VALUES 
      (?, ?, ?, 80.0, 100.0, 8000.0),
      (?, ?, ?, 15.0, 100.0, 1500.0)
  `).run(uuidv4(), issue2Id, lotNiAId, uuidv4(), issue2Id, lotNiBId);

  db.prepare(`
    INSERT INTO stock_movements (id, movement_type, chemical_id, receipt_lot_id, reference_type, reference_id, quantity_change, balance_after, movement_date, created_by_user_id, reason)
    VALUES 
      (?, 'ISSUE', ?, ?, 'CHEMICAL_ISSUE', ?, -80.0, 0.0, '2026-09-29', ?, 'FIFO deduction from Lot A (older)'),
      (?, 'ISSUE', ?, ?, 'CHEMICAL_ISSUE', ?, -15.0, 105.0, '2026-09-29', ?, 'FIFO deduction from Lot B (newer)')
  `).run(uuidv4(), chemNiId, lotNiAId, issue2Id, staffId, uuidv4(), chemNiId, lotNiBId, issue2Id, staffId);

  // -------------------------------------------------------------
  // 8. COMPILE AND PRINT METRICS SUMMARY
  // -------------------------------------------------------------
  const summary: DemoDatasetSummary = {
    dbPath,
    customersCount: (db.prepare(`SELECT count(*) as c FROM customers`).get() as any).c,
    partsCount: (db.prepare(`SELECT count(*) as c FROM parts`).get() as any).c,
    tanksCount: (db.prepare(`SELECT count(*) as c FROM tanks`).get() as any).c,
    chemicalsCount: (db.prepare(`SELECT count(*) as c FROM chemicals`).get() as any).c,
    receiptLotsCount: (db.prepare(`SELECT count(*) as c FROM receipt_lots`).get() as any).c,
    ordersCount: (db.prepare(`SELECT count(*) as c FROM customer_orders`).get() as any).c,
    inwardsCount: (db.prepare(`SELECT count(*) as c FROM customer_parts_inward`).get() as any).c,
    jobCardsCount: (db.prepare(`SELECT count(*) as c FROM job_cards`).get() as any).c,
    productionPlansCount: (db.prepare(`SELECT count(*) as c FROM production_plans`).get() as any).c,
    productionExecutionsCount: (db.prepare(`SELECT count(*) as c FROM production_executions`).get() as any).c,
    qcInspectionsCount: (db.prepare(`SELECT count(*) as c FROM qc_inspections`).get() as any).c,
    dispatchesCount: (db.prepare(`SELECT count(*) as c FROM dispatches`).get() as any).c,
    invoicesCount: (db.prepare(`SELECT count(*) as c FROM invoices`).get() as any).c,
    paymentsCount: (db.prepare(`SELECT count(*) as c FROM payments`).get() as any).c,
    paymentAllocationsCount: (db.prepare(`SELECT count(*) as c FROM payment_allocations`).get() as any).c,
    chemicalIssuesCount: (db.prepare(`SELECT count(*) as c FROM chemical_issues`).get() as any).c,
  };

  db.close();

  console.log('--- SEEDING COMPLETED SUCCESSFULLY ---');
  console.log(`Customers             : ${summary.customersCount}`);
  console.log(`Parts                 : ${summary.partsCount}`);
  console.log(`Tanks                 : ${summary.tanksCount}`);
  console.log(`Chemicals             : ${summary.chemicalsCount}`);
  console.log(`Receipt Lots          : ${summary.receiptLotsCount}`);
  console.log(`Customer Orders       : ${summary.ordersCount}`);
  console.log(`Customer Parts Inward : ${summary.inwardsCount}`);
  console.log(`Job Cards             : ${summary.jobCardsCount}`);
  console.log(`Production Plans      : ${summary.productionPlansCount}`);
  console.log(`Production Executions : ${summary.productionExecutionsCount}`);
  console.log(`QC Inspections        : ${summary.qcInspectionsCount}`);
  console.log(`Dispatches            : ${summary.dispatchesCount}`);
  console.log(`Invoices              : ${summary.invoicesCount}`);
  console.log(`Payments              : ${summary.paymentsCount}`);
  console.log(`Payment Allocations   : ${summary.paymentAllocationsCount}`);
  console.log(`Chemical Issues       : ${summary.chemicalIssuesCount}`);
  console.log('================================================================\n');

  return summary;
}

// Execute directly if run as main script
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/seed_demo_data.ts')) {
  try {
    seedDemoData();
  } catch (err: any) {
    console.error('[SEED ERROR]:', err.message);
    process.exit(1);
  }
}
