import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { query, isUsingPostgres } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

let isResetInProgress = false;

// Directory for automated pre-reset backups
const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// 1. Eligibility Check Helper
function checkResetEligibility(req: AuthenticatedRequest) {
  const isUserAdmin = req.user?.role === 'ADMIN';
  const allowDemoReset = process.env.ALLOW_DEMO_RESET === 'true' || process.env.ALLOW_DEMO_RESET === '1';
  const isTestDb = process.env.IS_TEST_DB === 'true' || process.env.IS_TEST_DB === '1' || process.env.APP_ENV === 'test' || process.env.APP_ENV === 'demo';
  const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production' || process.env.IS_PRODUCTION === 'true';

  if (!isUserAdmin) {
    return { eligible: false, reason: 'Reset actions require authenticated ADMIN role permissions.' };
  }
  if (isProduction) {
    return { eligible: false, reason: 'Test data resets are strictly forbidden in production databases.' };
  }
  if (!allowDemoReset) {
    return { eligible: false, reason: 'Test reset feature is disabled. Enable ALLOW_DEMO_RESET=true in server configuration.' };
  }
  if (!isTestDb) {
    return { eligible: false, reason: 'Test data resets require an explicitly designated TEST/DEMO database environment (set IS_TEST_DB=true or APP_ENV=test).' };
  }

  return { eligible: true, reason: 'Reset controls active for designated TEST/DEMO environment.' };
}

// GET /api/health
router.get('/health', async (req, res) => {
  try {
    const dbRes = await query('SELECT 1 as alive');
    return res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: isUsingPostgres() ? 'PostgreSQL' : 'SQLite (Local Fallback)',
      version: '1.0.0',
      uptime_seconds: process.uptime()
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'ERROR', error: err.message });
  }
});

// Helper: Backup database to JSON and verify integrity
async function createAndVerifyBackup(backupByEmail?: string) {
  const tables = [
    'users', 'chemicals', 'suppliers', 'tanks',
    'purchase_receipts', 'receipt_lots', 'opening_stock_entries',
    'chemical_issues', 'fifo_allocations', 'stock_movements',
    'stock_adjustments', 'reversals', 'attachments', 'audit_events', 'period_locks'
  ];

  const backupData: Record<string, any[]> = {};

  for (const t of tables) {
    try {
      const resTable = await query(`SELECT * FROM ${t}`);
      backupData[t] = resTable.rows || [];
    } catch (e) {
      backupData[t] = [];
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `vetrivel_backup_${timestamp}.json`;
  const filePath = path.join(BACKUP_DIR, filename);

  const dumpObject = {
    app: 'Qelanto Factory Manager',
    company: 'Vetrivel Platers',
    backup_timestamp: new Date().toISOString(),
    backup_by: backupByEmail || 'system',
    data: backupData
  };

  const jsonDump = JSON.stringify(dumpObject, null, 2);
  fs.writeFileSync(filePath, jsonDump, 'utf8');

  // Verification: verify file exists, size > 0, parses correctly, contains data keys
  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file creation failed at path ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    throw new Error(`Backup file created at ${filePath} is 0 bytes`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed.data || typeof parsed.data !== 'object') {
    throw new Error('Backup verification failed: Invalid JSON structure');
  }

  return { filename, filePath, dumpObject, sizeBytes: stats.size };
}

// GET /api/export (Admin manual export download)
router.get('/export', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const backup = await createAndVerifyBackup(req.user?.email);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
    return res.send(JSON.stringify(backup.dumpObject, null, 2));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/backup/download/:filename (Admin authenticated download of pre-reset backups)
router.get('/backup/download/:filename', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const safeFilename = path.basename(req.params.filename);
    const filePath = path.join(BACKUP_DIR, safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    return res.sendFile(filePath);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/backup/reset-summary (Read-only pre-execution status & count breakdown)
router.get('/backup/reset-summary', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eligibility = checkResetEligibility(req);

    const getCount = async (table: string) => {
      try {
        const r = await query(`SELECT COUNT(*) as cnt FROM ${table}`);
        return parseInt(r.rows[0]?.cnt || '0', 10);
      } catch (e) {
        return 0;
      }
    };

    const counts = {
      transactions: {
        purchase_receipts: await getCount('purchase_receipts'),
        receipt_lots: await getCount('receipt_lots'),
        opening_stock_entries: await getCount('opening_stock_entries'),
        chemical_issues: await getCount('chemical_issues'),
        fifo_allocations: await getCount('fifo_allocations'),
        stock_movements: await getCount('stock_movements'),
        stock_adjustments: await getCount('stock_adjustments'),
        reversals: await getCount('reversals'),
        attachments: await getCount('attachments')
      },
      masters: {
        chemicals: await getCount('chemicals'),
        suppliers: await getCount('suppliers'),
        tanks: await getCount('tanks')
      },
      system: {
        users: await getCount('users'),
        audit_events: await getCount('audit_events')
      }
    };

    return res.json({
      eligible: eligibility.eligible,
      eligibility_reason: eligibility.reason,
      database_identity: {
        database_engine: isUsingPostgres() ? 'PostgreSQL' : 'SQLite (Local File)',
        node_env: process.env.NODE_ENV || 'development',
        app_env: process.env.APP_ENV || 'development',
        allow_demo_reset: process.env.ALLOW_DEMO_RESET === 'true' || process.env.ALLOW_DEMO_RESET === '1',
        is_test_db: process.env.IS_TEST_DB === 'true' || process.env.IS_TEST_DB === '1' || process.env.APP_ENV === 'test' || process.env.APP_ENV === 'demo'
      },
      counts
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/backup/reset-test-data (Atomic test data reset with pre-reset backup and audit logging)
router.post('/backup/reset-test-data', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const eligibility = checkResetEligibility(req);
  if (!eligibility.eligible) {
    return res.status(403).json({ error: eligibility.reason });
  }

  if (isResetInProgress) {
    return res.status(409).json({ error: 'A data reset or backup process is currently running. Please try again shortly.' });
  }

  const { scope, confirmation_text } = req.body;

  if (scope !== 'TRANSACTIONS_ONLY' && scope !== 'FULL_TEST_RESET') {
    return res.status(400).json({ error: 'Invalid scope specified. Must be TRANSACTIONS_ONLY or FULL_TEST_RESET.' });
  }

  if (scope === 'TRANSACTIONS_ONLY' && confirmation_text !== 'RESET TEST TRANSACTIONS') {
    return res.status(400).json({ error: 'Confirmation phrase mismatch. You must type "RESET TEST TRANSACTIONS" to confirm.' });
  }

  if (scope === 'FULL_TEST_RESET' && confirmation_text !== 'RESET ALL TEST DATA') {
    return res.status(400).json({ error: 'Confirmation phrase mismatch. You must type "RESET ALL TEST DATA" to confirm.' });
  }

  isResetInProgress = true;
  let backupInfo: any = null;

  try {
    // 1. Create and verify automated pre-reset backup
    try {
      backupInfo = await createAndVerifyBackup(req.user?.email);
    } catch (bErr: any) {
      isResetInProgress = false;
      return res.status(500).json({ error: `Automated pre-reset backup failed: ${bErr.message}. Reset operation aborted.` });
    }

    // Record snapshot of affected counts before deletion
    const getCount = async (t: string) => {
      try {
        const r = await query(`SELECT COUNT(*) as cnt FROM ${t}`);
        return parseInt(r.rows[0]?.cnt || '0', 10);
      } catch (e) { return 0; }
    };

    const deletedCounts = {
      fifo_allocations: await getCount('fifo_allocations'),
      stock_movements: await getCount('stock_movements'),
      stock_adjustments: await getCount('stock_adjustments'),
      opening_stock_entries: await getCount('opening_stock_entries'),
      attachments: await getCount('attachments'),
      receipt_lots: await getCount('receipt_lots'),
      purchase_receipts: await getCount('purchase_receipts'),
      chemical_issues: await getCount('chemical_issues'),
      reversals: await getCount('reversals'),
      period_locks: await getCount('period_locks'),
      chemicals: scope === 'FULL_TEST_RESET' ? await getCount('chemicals') : 0,
      suppliers: scope === 'FULL_TEST_RESET' ? await getCount('suppliers') : 0,
      tanks: scope === 'FULL_TEST_RESET' ? await getCount('tanks') : 0
    };

    // 2. Execute deletion in strict foreign key schema dependency order
    await query('BEGIN TRANSACTION');

    try {
      await query('DELETE FROM fifo_allocations');
      await query('DELETE FROM stock_movements');
      await query('DELETE FROM stock_adjustments');
      await query('DELETE FROM opening_stock_entries');
      await query(`DELETE FROM attachments WHERE parent_type IN ('PURCHASE_RECEIPT', 'STOCK_ADJUSTMENT', 'CHEMICAL_ISSUE', 'OPENING_STOCK')`);
      await query('DELETE FROM receipt_lots');
      await query('DELETE FROM purchase_receipts');
      await query('DELETE FROM chemical_issues');
      await query('DELETE FROM reversals');
      await query('DELETE FROM period_locks');

      if (scope === 'FULL_TEST_RESET') {
        await query('DELETE FROM chemicals');
        await query('DELETE FROM suppliers');
        await query('DELETE FROM tanks');
      }

      // 3. Record Audit Event INSIDE the transaction
      const auditId = uuidv4();
      const auditReason = scope === 'FULL_TEST_RESET' 
        ? 'Full test reset executed: cleared transactions, chemical, supplier, and tank masters.'
        : 'Reset test transactions executed: cleared all receipt, lot, issue, and stock movement records while preserving masters.';

      await query(
        `INSERT INTO audit_events (id, user_id, user_email, action, record_ref, changed_values, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          auditId,
          req.user?.id || null,
          req.user?.email || 'admin@vetrivel.com',
          'TEST_DATA_RESET',
          `system/reset/${scope.toLowerCase()}`,
          JSON.stringify({
            scope,
            backup_filename: backupInfo.filename,
            deleted_counts: deletedCounts,
            timestamp: new Date().toISOString()
          }),
          auditReason
        ]
      );

      await query('COMMIT');
    } catch (dbErr: any) {
      await query('ROLLBACK');
      throw dbErr;
    }

    isResetInProgress = false;

    return res.json({
      success: true,
      scope,
      backup_file: backupInfo.filename,
      backup_download_url: `/api/backup/download/${backupInfo.filename}`,
      deleted_counts: deletedCounts,
      message: scope === 'FULL_TEST_RESET'
        ? 'Full test data reset completed successfully. Transactions and masters cleared.'
        : 'Test transactions reset completed successfully. Chemical masters, suppliers, tanks, and login accounts preserved.'
    });

  } catch (err: any) {
    isResetInProgress = false;
    return res.status(500).json({ error: `Reset execution failed and was rolled back: ${err.message}` });
  }
});

export default router;
