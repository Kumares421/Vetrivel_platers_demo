-- Vetrivel Platers - Qelanto Factory Manager Database Schema

-- Enable UUID extension if supported
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users & Authentication
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'STOREKEEPER', 'READONLY')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Chemical Master
CREATE TABLE IF NOT EXISTS chemicals (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    base_unit VARCHAR(20) NOT NULL CHECK (base_unit IN ('kg', 'L', 'nos')),
    min_stock_level NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Supplier Master
CREATE TABLE IF NOT EXISTS suppliers (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact_details TEXT,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tank / Department Master
CREATE TABLE IF NOT EXISTS tanks (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Purchase Receipts Header
CREATE TABLE IF NOT EXISTS purchase_receipts (
    id VARCHAR(36) PRIMARY KEY,
    receipt_number VARCHAR(100) UNIQUE NOT NULL,
    supplier_id VARCHAR(36) NOT NULL REFERENCES suppliers(id),
    bill_number VARCHAR(100) NOT NULL,
    bill_date DATE NOT NULL,
    actual_received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    delivery_challan_number VARCHAR(100),
    notes TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REVIEW', 'POSTED', 'REVERSED')),
    created_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    posted_at TIMESTAMP WITH TIME ZONE,
    posted_by_user_id VARCHAR(36) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_supplier ON purchase_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_receipts_bill_number ON purchase_receipts(bill_number);

-- 6. Receipt Lots (Independently Traceable Lots)
CREATE TABLE IF NOT EXISTS receipt_lots (
    id VARCHAR(36) PRIMARY KEY,
    lot_number VARCHAR(100) UNIQUE NOT NULL,
    purchase_receipt_id VARCHAR(36) REFERENCES purchase_receipts(id),
    chemical_id VARCHAR(36) NOT NULL REFERENCES chemicals(id),
    supplier_batch_number VARCHAR(100) NOT NULL,
    initial_qty NUMERIC(14, 4) NOT NULL CHECK (initial_qty >= 0),
    remaining_qty NUMERIC(14, 4) NOT NULL CHECK (remaining_qty >= 0),
    rate_per_unit NUMERIC(14, 2), -- Can be NULL if unknown in opening stock
    line_amount NUMERIC(14, 2),
    location VARCHAR(100),
    expiry_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'QUARANTINED', 'BLOCKED', 'EXPIRED', 'EXHAUSTED')),
    actual_received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_opening_stock BOOLEAN NOT NULL DEFAULT FALSE,
    fifo_order_index INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lots_chemical_status ON receipt_lots(chemical_id, status);
CREATE INDEX IF NOT EXISTS idx_lots_received_at ON receipt_lots(actual_received_at, id);
CREATE INDEX IF NOT EXISTS idx_lots_supplier_batch ON receipt_lots(supplier_batch_number);

-- 7. Opening Stock Entries
CREATE TABLE IF NOT EXISTS opening_stock_entries (
    id VARCHAR(36) PRIMARY KEY,
    verification_date DATE NOT NULL,
    chemical_id VARCHAR(36) NOT NULL REFERENCES chemicals(id),
    supplier_batch_number VARCHAR(100),
    quantity NUMERIC(14, 4) NOT NULL CHECK (quantity > 0),
    original_received_date DATE,
    rate_per_unit NUMERIC(14, 2),
    expiry_date DATE,
    notes TEXT,
    fifo_review_required BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    receipt_lot_id VARCHAR(36) REFERENCES receipt_lots(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. Chemical Issues Header
CREATE TABLE IF NOT EXISTS chemical_issues (
    id VARCHAR(36) PRIMARY KEY,
    issue_number VARCHAR(100) UNIQUE NOT NULL,
    issue_date TIMESTAMP WITH TIME ZONE NOT NULL,
    chemical_id VARCHAR(36) NOT NULL REFERENCES chemicals(id),
    required_qty NUMERIC(14, 4) NOT NULL CHECK (required_qty > 0),
    tank_id VARCHAR(36) NOT NULL REFERENCES tanks(id),
    job_reference VARCHAR(100),
    issued_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    remarks TEXT,
    total_allocated_value NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
    idempotency_key VARCHAR(255) UNIQUE,
    override_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    posted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_issues_chemical ON chemical_issues(chemical_id);
CREATE INDEX IF NOT EXISTS idx_issues_tank ON chemical_issues(tank_id);
CREATE INDEX IF NOT EXISTS idx_issues_date ON chemical_issues(issue_date);

-- 9. FIFO Allocations & Issue Lines
CREATE TABLE IF NOT EXISTS fifo_allocations (
    id VARCHAR(36) PRIMARY KEY,
    chemical_issue_id VARCHAR(36) NOT NULL REFERENCES chemical_issues(id) ON DELETE CASCADE,
    receipt_lot_id VARCHAR(36) NOT NULL REFERENCES receipt_lots(id),
    allocated_qty NUMERIC(14, 4) NOT NULL CHECK (allocated_qty > 0),
    rate_per_unit NUMERIC(14, 2),
    allocation_value NUMERIC(14, 2),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alloc_issue ON fifo_allocations(chemical_issue_id);
CREATE INDEX IF NOT EXISTS idx_alloc_lot ON fifo_allocations(receipt_lot_id);

-- 10. Immutable Stock Movements Ledger
CREATE TABLE IF NOT EXISTS stock_movements (
    id VARCHAR(36) PRIMARY KEY,
    movement_type VARCHAR(50) NOT NULL CHECK (movement_type IN (
        'RECEIPT', 'ISSUE', 'OPENING_STOCK', 'ADJUSTMENT', 
        'REVERSAL_RECEIPT', 'REVERSAL_ISSUE', 'QUARANTINE', 'UNBLOCK'
    )),
    chemical_id VARCHAR(36) NOT NULL REFERENCES chemicals(id),
    receipt_lot_id VARCHAR(36) NOT NULL REFERENCES receipt_lots(id),
    reference_type VARCHAR(50) NOT NULL, -- e.g. 'PURCHASE_RECEIPT', 'CHEMICAL_ISSUE', 'ADJUSTMENT', 'REVERSAL'
    reference_id VARCHAR(36) NOT NULL,
    quantity_change NUMERIC(14, 4) NOT NULL, -- positive for inward, negative for outward
    balance_after NUMERIC(14, 4) NOT NULL,
    movement_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_movements_chemical_date ON stock_movements(chemical_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_movements_lot ON stock_movements(receipt_lot_id);

-- 11. Stock Adjustments (Quarantine, Unblock, Count Correction)
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id VARCHAR(36) PRIMARY KEY,
    adjustment_number VARCHAR(100) UNIQUE NOT NULL,
    chemical_id VARCHAR(36) NOT NULL REFERENCES chemicals(id),
    receipt_lot_id VARCHAR(36) NOT NULL REFERENCES receipt_lots(id),
    adjustment_type VARCHAR(50) NOT NULL CHECK (adjustment_type IN ('QUARANTINE', 'UNBLOCK', 'DAMAGE_WRITE_OFF', 'COUNT_CORRECTION')),
    quantity NUMERIC(14, 4) NOT NULL,
    reason TEXT NOT NULL,
    adjusted_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 12. Linked Reversals (Non-destructive corrections)
CREATE TABLE IF NOT EXISTS reversals (
    id VARCHAR(36) PRIMARY KEY,
    original_type VARCHAR(50) NOT NULL CHECK (original_type IN ('RECEIPT', 'ISSUE')),
    original_id VARCHAR(36) NOT NULL,
    reversal_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reason TEXT NOT NULL,
    reversed_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 13. Attachments (Object Storage Metadata)
CREATE TABLE IF NOT EXISTS attachments (
    id VARCHAR(36) PRIMARY KEY,
    parent_type VARCHAR(50) NOT NULL CHECK (parent_type IN ('PURCHASE_RECEIPT', 'STOCK_ADJUSTMENT', 'CHEMICAL_ISSUE', 'OPENING_STOCK')),
    parent_id VARCHAR(36) NOT NULL,
    object_key VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL,
    uploaded_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attachments_parent ON attachments(parent_type, parent_id);

-- 14. Audit Events Log
CREATE TABLE IF NOT EXISTS audit_events (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES users(id),
    user_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    record_ref VARCHAR(255) NOT NULL,
    changed_values JSONB,
    reason TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp DESC);

-- 15. Reporting Period Locks
CREATE TABLE IF NOT EXISTS period_locks (
    id VARCHAR(36) PRIMARY KEY,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    is_locked BOOLEAN NOT NULL DEFAULT TRUE,
    locked_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    locked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reason TEXT
);
