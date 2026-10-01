import { Pool } from 'pg';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PostgreSQL Configuration
const pgConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/qelanto_factory',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

let pgPool: Pool | null = null;
let sqliteDb: Database.Database | null = null;
let isPostgres = false;

export async function initDb() {
  try {
    const pool = new Pool(pgConfig);
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    pgPool = pool;
    isPostgres = true;
    console.log('Connected to PostgreSQL Database.');
  } catch (err) {
    const dbDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbFilename = process.env.SQLITE_DB_PATH || 'qelanto_factory.sqlite';
    sqliteDb = new Database(path.join(dbDir, dbFilename));
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
    isPostgres = false;
  }

  await runMigrations();
}

export function isUsingPostgres(): boolean {
  return isPostgres;
}

export function sanitizeSqlParams(params: any[], isPg: boolean = false): any[] {
  return params.map(val => {
    if (val === undefined) {
      return null;
    }
    if (typeof val === 'boolean') {
      return isPg ? val : (val ? 1 : 0);
    }
    if (val instanceof Date) {
      return val.toISOString();
    }
    if (typeof val === 'object' && val !== null && !(val instanceof Buffer)) {
      return JSON.stringify(val);
    }
    return val;
  });
}

export async function query(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
  const sanitizedParams = sanitizeSqlParams(params, isPostgres);

  if (isPostgres && pgPool) {
    // Convert ? parameters to $1, $2 for Postgres if needed
    let pgSql = sql;
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

    const res = await pgPool.query(pgSql, sanitizedParams);
    return { rows: res.rows, rowCount: res.rowCount || 0 };
  } else if (sqliteDb) {
    // Replace Postgres specific syntax for SQLite fallback
    let sqliteSql = sql
      .replace(/TIMESTAMP WITH TIME ZONE/gi, 'TEXT')
      .replace(/CURRENT_TIMESTAMP/gi, "datetime('now')")
      .replace(/JSONB/gi, 'TEXT')
      .replace(/NUMERIC\(\d+,\s*\d+\)/gi, 'REAL')
      .replace(/BOOLEAN/gi, 'INTEGER')
      .replace(/BIGINT/gi, 'INTEGER')
      .replace(/\$(\d+)/g, '?');

    // Handle FOR UPDATE stripped out for sqlite
    sqliteSql = sqliteSql.replace(/FOR UPDATE/gi, '');

    const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
    if (isSelect) {
      const stmt = sqliteDb.prepare(sqliteSql);
      const rows = stmt.all(...sanitizedParams);
      return { rows, rowCount: rows.length };
    } else {
      const stmt = sqliteDb.prepare(sqliteSql);
      const info = stmt.run(...sanitizedParams);
      return { rows: [], rowCount: info.changes };
    }
  }
  throw new Error('Database not initialized');
}

export async function getClient() {
  if (isPostgres && pgPool) {
    const client = await pgPool.connect();
    return {
      query: async (sql: string, params: any[] = []) => {
        let pgSql = sql;
        let paramIndex = 1;
        pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
        return await client.query(pgSql, params);
      },
      release: () => client.release(),
      beginTransaction: async () => await client.query('BEGIN'),
      commit: async () => await client.query('COMMIT'),
      rollback: async () => await client.query('ROLLBACK'),
    };
  } else if (sqliteDb) {
    return {
      query: async (sql: string, params: any[] = []) => {
        return query(sql, params);
      },
      release: () => {},
      beginTransaction: async () => {
        sqliteDb?.prepare('BEGIN TRANSACTION').run();
      },
      commit: async () => {
        sqliteDb?.prepare('COMMIT').run();
      },
      rollback: async () => {
        sqliteDb?.prepare('ROLLBACK').run();
      },
    };
  }
  throw new Error('Database not initialized');
}

async function runMigrations() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  let schemaSql = '';
  if (fs.existsSync(schemaPath)) {
    schemaSql = fs.readFileSync(schemaPath, 'utf8');
  } else {
    // Fallback embedded schema loader
    schemaSql = getEmbeddedSchemaSql();
  }

  if (isPostgres && pgPool) {
    await pgPool.query(schemaSql);
  } else if (sqliteDb) {
    // Split and execute SQLite compatible schema commands
    const statements = getSQLiteSchemaStatements();
    for (const stmt of statements) {
      try {
        sqliteDb.exec(stmt);
      } catch (err: any) {
        // Table or index might already exist
      }
    }
    // Run ERP tables migrations
    try {
      const { runErpMigrations } = await import('./migrations');
      runErpMigrations(sqliteDb);
    } catch (err) {
      console.warn('ERP migrations execution warning:', err);
    }
  }
  console.log('Database Schema Migration completed.');
}

function getEmbeddedSchemaSql(): string {
  return `
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
  `;
}

export function getSQLiteSchemaStatements(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'STOREKEEPER', 'READONLY')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS chemicals (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      base_unit TEXT NOT NULL CHECK (base_unit IN ('kg', 'L', 'nos')),
      min_stock_level REAL NOT NULL DEFAULT 0.0,
      is_active INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_details TEXT,
      address TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS tanks (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS purchase_receipts (
      id TEXT PRIMARY KEY,
      receipt_number TEXT UNIQUE NOT NULL,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      bill_number TEXT NOT NULL,
      bill_date TEXT NOT NULL,
      actual_received_at TEXT NOT NULL,
      delivery_challan_number TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REVIEW', 'POSTED', 'REVERSED')),
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      posted_at TEXT,
      posted_by_user_id TEXT REFERENCES users(id)
    );`,
    `CREATE TABLE IF NOT EXISTS receipt_lots (
      id TEXT PRIMARY KEY,
      lot_number TEXT UNIQUE NOT NULL,
      purchase_receipt_id TEXT REFERENCES purchase_receipts(id),
      chemical_id TEXT NOT NULL REFERENCES chemicals(id),
      supplier_batch_number TEXT NOT NULL,
      initial_qty REAL NOT NULL CHECK (initial_qty >= 0),
      remaining_qty REAL NOT NULL CHECK (remaining_qty >= 0),
      rate_per_unit REAL,
      line_amount REAL,
      location TEXT,
      expiry_date TEXT,
      status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'QUARANTINED', 'BLOCKED', 'EXPIRED', 'EXHAUSTED')),
      actual_received_at TEXT NOT NULL,
      is_opening_stock INTEGER NOT NULL DEFAULT 0,
      fifo_order_index INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS opening_stock_entries (
      id TEXT PRIMARY KEY,
      verification_date TEXT NOT NULL,
      chemical_id TEXT NOT NULL REFERENCES chemicals(id),
      supplier_batch_number TEXT,
      quantity REAL NOT NULL CHECK (quantity > 0),
      original_received_date TEXT,
      rate_per_unit REAL,
      expiry_date TEXT,
      notes TEXT,
      fifo_review_required INTEGER NOT NULL DEFAULT 0,
      verified_by_user_id TEXT NOT NULL REFERENCES users(id),
      receipt_lot_id TEXT REFERENCES receipt_lots(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS chemical_issues (
      id TEXT PRIMARY KEY,
      issue_number TEXT UNIQUE NOT NULL,
      issue_date TEXT NOT NULL,
      chemical_id TEXT NOT NULL REFERENCES chemicals(id),
      required_qty REAL NOT NULL CHECK (required_qty > 0),
      tank_id TEXT NOT NULL REFERENCES tanks(id),
      job_reference TEXT,
      issued_by_user_id TEXT NOT NULL REFERENCES users(id),
      remarks TEXT,
      total_allocated_value REAL NOT NULL DEFAULT 0.0,
      status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
      idempotency_key TEXT UNIQUE,
      override_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      posted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS fifo_allocations (
      id TEXT PRIMARY KEY,
      chemical_issue_id TEXT NOT NULL REFERENCES chemical_issues(id) ON DELETE CASCADE,
      receipt_lot_id TEXT NOT NULL REFERENCES receipt_lots(id),
      allocated_qty REAL NOT NULL CHECK (allocated_qty > 0),
      rate_per_unit REAL,
      allocation_value REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      movement_type TEXT NOT NULL CHECK (movement_type IN (
        'RECEIPT', 'ISSUE', 'OPENING_STOCK', 'ADJUSTMENT', 
        'REVERSAL_RECEIPT', 'REVERSAL_ISSUE', 'QUARANTINE', 'UNBLOCK'
      )),
      chemical_id TEXT NOT NULL REFERENCES chemicals(id),
      receipt_lot_id TEXT NOT NULL REFERENCES receipt_lots(id),
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      quantity_change REAL NOT NULL,
      balance_after REAL NOT NULL,
      movement_date TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY,
      adjustment_number TEXT UNIQUE NOT NULL,
      chemical_id TEXT NOT NULL REFERENCES chemicals(id),
      receipt_lot_id TEXT NOT NULL REFERENCES receipt_lots(id),
      adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('QUARANTINE', 'UNBLOCK', 'DAMAGE_WRITE_OFF', 'COUNT_CORRECTION')),
      quantity REAL NOT NULL,
      reason TEXT NOT NULL,
      adjusted_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS reversals (
      id TEXT PRIMARY KEY,
      original_type TEXT NOT NULL CHECK (original_type IN ('RECEIPT', 'ISSUE')),
      original_id TEXT NOT NULL,
      reversal_date TEXT NOT NULL DEFAULT (datetime('now')),
      reason TEXT NOT NULL,
      reversed_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      parent_type TEXT NOT NULL CHECK (parent_type IN ('PURCHASE_RECEIPT', 'STOCK_ADJUSTMENT', 'CHEMICAL_ISSUE', 'OPENING_STOCK')),
      parent_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      uploaded_by_user_id TEXT NOT NULL REFERENCES users(id),
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      user_email TEXT,
      action TEXT NOT NULL,
      record_ref TEXT NOT NULL,
      changed_values TEXT,
      reason TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS period_locks (
      id TEXT PRIMARY KEY,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      is_locked INTEGER NOT NULL DEFAULT 1,
      locked_by_user_id TEXT NOT NULL REFERENCES users(id),
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      reason TEXT
    );`
  ];
}
