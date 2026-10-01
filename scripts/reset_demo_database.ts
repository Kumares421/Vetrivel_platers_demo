import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getSQLiteSchemaStatements } from '../server/src/db/index';
import { runErpMigrations } from '../server/src/db/migrations';

/**
 * Resets and initializes the demo database.
 * Strict safety check: Refuses to operate on production database (data/qelanto_factory.sqlite).
 */
export function resetDemoDatabase(targetPath?: string): string {
  const dbPath = targetPath || process.env.DEMO_DB_PATH || 'data/demo_factory.sqlite';

  // CRITICAL SAFETY CHECK: Refuse production database
  const normalizedPath = path.normalize(dbPath).toLowerCase();
  if (normalizedPath.includes('qelanto_factory.sqlite')) {
    console.error('================================================================');
    console.error('CRITICAL SAFETY VIOLATION DETECTED:');
    console.error('Attempted to execute reset script on production database!');
    console.error(`Target: ${dbPath}`);
    console.error('ABORTING IMMEDIATELY TO PROTECT PRODUCTION DATA.');
    console.error('================================================================');
    throw new Error('SAFETY_VIOLATION: Refusing to operate on production database data/qelanto_factory.sqlite');
  }

  console.log(`[RESET] Target Demo Database: ${dbPath}`);

  // Clean existing demo database files
  if (fs.existsSync(dbPath)) {
    try { fs.unlinkSync(dbPath); } catch (e) {}
    try { fs.unlinkSync(`${dbPath}-wal`); } catch (e) {}
    try { fs.unlinkSync(`${dbPath}-shm`); } catch (e) {}
    console.log(`[RESET] Removed previous demo database files.`);
  }

  // Ensure data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Create isolated demo database connection
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');

  // Truncate/drop any existing tables if file existed
  const existingTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[];
  for (const tbl of existingTables) {
    try {
      db.exec(`DROP TABLE IF EXISTS "${tbl.name}"`);
    } catch (e) {}
  }
  db.pragma('foreign_keys = ON');

  // 1. Run base schema statements
  console.log(`[RESET] Applying base SQLite schema statements...`);
  for (const stmt of getSQLiteSchemaStatements()) {
    try {
      db.exec(stmt);
    } catch (e: any) {
      // Ignore table already exists warnings
    }
  }

  // 2. Run ERP migrations
  console.log(`[RESET] Applying ERP migrations (including Task 30 production_plans)...`);
  runErpMigrations(db);

  db.close();
  console.log(`[RESET] Demo database cleanly initialized at ${dbPath} ✅\n`);
  return dbPath;
}

// Execute directly if run as main script
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/reset_demo_database.ts')) {
  try {
    resetDemoDatabase();
  } catch (err: any) {
    console.error('[RESET ERROR]:', err.message);
    process.exit(1);
  }
}
