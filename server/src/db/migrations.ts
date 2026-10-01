import Database from 'better-sqlite3';

export function runErpMigrations(db: Database.Database) {
  // 1. Revoked tokens table for session management
  db.exec(`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token TEXT PRIMARY KEY,
      revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 2. Customers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      gst_number TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 3. Parts master (Customer Rates)
  db.exec(`
    CREATE TABLE IF NOT EXISTS parts (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      part_number TEXT NOT NULL,
      part_name TEXT NOT NULL,
      process_type TEXT NOT NULL,
      surface_area_sqdm REAL DEFAULT 0,
      rate_per_piece REAL NOT NULL CHECK (rate_per_piece >= 0),
      base_unit TEXT NOT NULL DEFAULT 'nos' CHECK (base_unit IN ('nos', 'kg', 'sets')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(customer_id, part_number)
    );
  `);

  // 4. Customer Orders
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      customer_po_number TEXT,
      order_date TEXT NOT NULL,
      expected_delivery_date TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED')),
      total_quantity REAL NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
      total_amount REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
      notes TEXT,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      confirmed_at TEXT,
      confirmed_by_user_id TEXT REFERENCES users(id),
      cancelled_at TEXT,
      cancelled_by_user_id TEXT REFERENCES users(id),
      cancellation_reason TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 5. Customer Order Items
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_order_items (
      id TEXT PRIMARY KEY,
      customer_order_id TEXT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
      part_id TEXT NOT NULL REFERENCES parts(id),
      quantity REAL NOT NULL CHECK (quantity > 0),
      rate REAL NOT NULL CHECK (rate >= 0),
      process_type TEXT,
      line_amount REAL NOT NULL CHECK (line_amount >= 0),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 6. Customer Parts Inward
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_parts_inward (
      id TEXT PRIMARY KEY,
      inward_number TEXT UNIQUE NOT NULL,
      customer_order_id TEXT NOT NULL REFERENCES customer_orders(id),
      customer_order_item_id TEXT NOT NULL REFERENCES customer_order_items(id),
      challan_number TEXT NOT NULL,
      challan_date TEXT NOT NULL,
      received_date TEXT NOT NULL,
      accepted_qty REAL NOT NULL CHECK (accepted_qty >= 0),
      rejected_qty REAL NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
      rejection_reason TEXT,
      notes TEXT,
      received_by_user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'CANCELLED')),
      cancelled_at TEXT,
      cancelled_by_user_id TEXT REFERENCES users(id),
      cancellation_reason TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 7. Job Cards
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_cards (
      id TEXT PRIMARY KEY,
      job_card_number TEXT UNIQUE NOT NULL,
      customer_parts_inward_id TEXT NOT NULL REFERENCES customer_parts_inward(id),
      customer_order_item_id TEXT NOT NULL REFERENCES customer_order_items(id),
      allocated_qty REAL NOT NULL CHECK (allocated_qty > 0),
      tank_id TEXT REFERENCES tanks(id),
      plating_process TEXT,
      target_thickness_microns REAL,
      priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'URGENT')),
      status TEXT NOT NULL DEFAULT 'RELEASED' CHECK (status IN ('RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
      released_by_user_id TEXT NOT NULL REFERENCES users(id),
      released_at TEXT NOT NULL DEFAULT (datetime('now')),
      cancelled_at TEXT,
      cancelled_by_user_id TEXT REFERENCES users(id),
      cancellation_reason TEXT,
      idempotency_key TEXT UNIQUE,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 8. Chemical Purchase Orders
  db.exec(`
    CREATE TABLE IF NOT EXISTS chemical_purchase_orders (
      id TEXT PRIMARY KEY,
      po_number TEXT UNIQUE NOT NULL,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      po_date TEXT NOT NULL,
      expected_delivery_date TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED')),
      total_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      approved_by_user_id TEXT REFERENCES users(id),
      approved_at TEXT,
      cancelled_by_user_id TEXT REFERENCES users(id),
      cancelled_at TEXT,
      cancellation_reason TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 9. Chemical PO Items
  db.exec(`
    CREATE TABLE IF NOT EXISTS chemical_po_items (
      id TEXT PRIMARY KEY,
      chemical_po_id TEXT NOT NULL REFERENCES chemical_purchase_orders(id) ON DELETE CASCADE,
      chemical_id TEXT NOT NULL REFERENCES chemicals(id),
      ordered_qty REAL NOT NULL CHECK (ordered_qty > 0),
      received_qty REAL NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
      rate_per_unit REAL NOT NULL CHECK (rate_per_unit >= 0),
      line_amount REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 10. Non-destructive column additions
  const tryAddCol = (table: string, colDef: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
    } catch (e) {
      // Column may already exist
    }
  };

  tryAddCol('tanks', 'capacity_liters REAL DEFAULT 0');
  tryAddCol('tanks', 'status TEXT DEFAULT \'ACTIVE\'');
  tryAddCol('tanks', 'location TEXT');
  tryAddCol('purchase_receipts', 'chemical_po_id TEXT REFERENCES chemical_purchase_orders(id)');
  tryAddCol('receipt_lots', 'chemical_po_item_id TEXT REFERENCES chemical_po_items(id)');
  tryAddCol('chemical_issues', 'job_card_id TEXT REFERENCES job_cards(id)');
  tryAddCol('chemical_issues', 'production_execution_id TEXT REFERENCES production_executions(id)');

  // 11. Production Executions Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_executions (
      id TEXT PRIMARY KEY,
      production_number TEXT UNIQUE NOT NULL,
      job_card_id TEXT NOT NULL REFERENCES job_cards(id),
      tank_id TEXT NOT NULL REFERENCES tanks(id),
      production_date TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      planned_qty REAL NOT NULL CHECK (planned_qty > 0),
      processed_qty REAL NOT NULL DEFAULT 0 CHECK (processed_qty >= 0),
      rejected_qty REAL NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
      status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
      operator_user_id TEXT NOT NULL REFERENCES users(id),
      notes TEXT,
      cancelled_at TEXT,
      cancelled_by_user_id TEXT REFERENCES users(id),
      cancellation_reason TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 12. Quality Control (QC) Inspections Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS qc_inspections (
      id TEXT PRIMARY KEY,
      qc_number TEXT UNIQUE NOT NULL,
      production_execution_id TEXT NOT NULL REFERENCES production_executions(id),
      job_card_id TEXT NOT NULL REFERENCES job_cards(id),
      inspector_user_id TEXT NOT NULL REFERENCES users(id),
      inspection_date TEXT NOT NULL,
      inspected_qty REAL NOT NULL CHECK (inspected_qty > 0),
      accepted_qty REAL NOT NULL DEFAULT 0 CHECK (accepted_qty >= 0),
      rejected_qty REAL NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
      coating_thickness REAL,
      min_thickness REAL,
      max_thickness REAL,
      thickness_unit TEXT DEFAULT 'microns',
      visual_defect TEXT CHECK (visual_defect IN ('NO_DEFECT', 'SCRATCH', 'PIT', 'DISCOLORATION', 'ROUGH_SURFACE', 'PEELING', 'OTHER')),
      defect_details TEXT,
      remarks TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'INSPECTED', 'PASS', 'FAIL')),
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_qc_prod_exec ON qc_inspections(production_execution_id);
    CREATE INDEX IF NOT EXISTS idx_qc_job_card ON qc_inspections(job_card_id);
    CREATE INDEX IF NOT EXISTS idx_qc_status ON qc_inspections(status);
    CREATE INDEX IF NOT EXISTS idx_qc_inspection_date ON qc_inspections(inspection_date);
  `);

  // 13. Dispatches Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS dispatches (
      id TEXT PRIMARY KEY,
      dispatch_number TEXT UNIQUE NOT NULL,
      job_card_id TEXT NOT NULL REFERENCES job_cards(id),
      production_execution_id TEXT NOT NULL REFERENCES production_executions(id),
      qc_inspection_id TEXT NOT NULL REFERENCES qc_inspections(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      dispatch_date TEXT NOT NULL,
      dispatched_qty REAL NOT NULL CHECK (dispatched_qty > 0),
      vehicle_number TEXT,
      transporter_name TEXT,
      delivery_address TEXT,
      challan_number TEXT,
      remarks TEXT,
      status TEXT NOT NULL DEFAULT 'DISPATCHED' CHECK (status IN ('DISPATCHED', 'CANCELLED')),
      dispatched_by_user_id TEXT NOT NULL REFERENCES users(id),
      cancelled_at TEXT,
      cancelled_by_user_id TEXT REFERENCES users(id),
      cancellation_reason TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dispatch_job_card ON dispatches(job_card_id);
    CREATE INDEX IF NOT EXISTS idx_dispatch_production ON dispatches(production_execution_id);
    CREATE INDEX IF NOT EXISTS idx_dispatch_qc ON dispatches(qc_inspection_id);
    CREATE INDEX IF NOT EXISTS idx_dispatch_customer ON dispatches(customer_id);
    CREATE INDEX IF NOT EXISTS idx_dispatch_status ON dispatches(status);
    CREATE INDEX IF NOT EXISTS idx_dispatch_date ON dispatches(dispatch_date);
  `);

  // 14. Invoices Table & Lines
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      invoice_date TEXT NOT NULL,
      subtotal REAL NOT NULL CHECK (subtotal >= 0),
      cgst_amount REAL NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
      sgst_amount REAL NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
      igst_amount REAL NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
      tax_amount REAL NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
      discount_amount REAL NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
      round_off REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL CHECK (total_amount >= 0),
      place_of_supply TEXT,
      billing_address TEXT,
      shipping_address TEXT,
      gstin TEXT,
      status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('DRAFT', 'ISSUED', 'CANCELLED')),
      cancellation_reason TEXT,
      cancelled_at TEXT,
      cancelled_by_user_id TEXT REFERENCES users(id),
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS invoice_lines (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
      job_card_id TEXT NOT NULL REFERENCES job_cards(id),
      production_execution_id TEXT NOT NULL REFERENCES production_executions(id),
      qc_inspection_id TEXT NOT NULL REFERENCES qc_inspections(id),
      description TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_price REAL NOT NULL CHECK (unit_price >= 0),
      taxable_value REAL NOT NULL CHECK (taxable_value >= 0),
      gst_rate REAL NOT NULL DEFAULT 0 CHECK (gst_rate >= 0),
      cgst_amount REAL NOT NULL DEFAULT 0,
      sgst_amount REAL NOT NULL DEFAULT 0,
      igst_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL CHECK (line_total >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_lines_dispatch ON invoice_lines(dispatch_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
  `);

  // 15. Payments & Payment Allocations Tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      payment_number TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      payment_date TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      payment_mode TEXT NOT NULL CHECK (payment_mode IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER')),
      reference_number TEXT,
      bank_name TEXT,
      transaction_date TEXT,
      remarks TEXT,
      status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'CANCELLED')),
      cancelled_at TEXT,
      cancelled_by_user_id TEXT REFERENCES users(id),
      cancellation_reason TEXT,
      received_by_user_id TEXT NOT NULL REFERENCES users(id),
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      allocated_amount REAL NOT NULL CHECK (allocated_amount > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
    CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id);
    CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON payment_allocations(invoice_id);
  `);

  // 16. Production Plans Table (Task 30 - Planning & Workboard Layer)
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_plans (
      id TEXT PRIMARY KEY,
      job_card_id TEXT UNIQUE NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
      priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('URGENT', 'HIGH', 'NORMAL', 'LOW')),
      planned_date TEXT,
      planned_start_time TEXT,
      planning_notes TEXT,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_prod_plans_job_card ON production_plans(job_card_id);
    CREATE INDEX IF NOT EXISTS idx_prod_plans_planned_date ON production_plans(planned_date);
    CREATE INDEX IF NOT EXISTS idx_prod_plans_priority ON production_plans(priority);
  `);

  // 11. Three-Account Model user role migration
  // Ensure table supports SUPER_ADMIN, ADMIN, STAFF, STOREKEEPER, READONLY
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get() as any;
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes('SUPER_ADMIN')) {
      db.exec(`
        PRAGMA foreign_keys=OFF;
        CREATE TABLE users_migrated (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'STAFF', 'STOREKEEPER', 'READONLY')),
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users_migrated (id, email, password_hash, name, role, is_active, created_at, updated_at)
        SELECT id, email, password_hash, name, role, is_active, created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrated RENAME TO users;
        PRAGMA foreign_keys=ON;
      `);
    }
  } catch (err) {
    console.warn('User migration check error (ignored if already valid):', err);
  }
}
