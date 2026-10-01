import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { calculateFIFOAllocation } from '../services/fifoEngine';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Function to generate issue number format: ISS-YYYYMMDD-XXXX
async function generateIssueNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ISS-${dateStr}-`;
  
  const result = await query(
    `SELECT issue_number FROM chemical_issues WHERE issue_number LIKE ? ORDER BY issue_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].issue_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// GET /api/issues (List all issues)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chemical_id, tank_id } = req.query;
    let sql = `
      SELECT 
        ci.*, c.code as chemical_code, c.name as chemical_name, c.base_unit,
        t.code as tank_code, t.display_name as tank_name, u.name as issued_by_name,
        (SELECT COUNT(*) FROM fifo_allocations WHERE chemical_issue_id = ci.id) as lot_count
      FROM chemical_issues ci
      JOIN chemicals c ON ci.chemical_id = c.id
      JOIN tanks t ON ci.tank_id = t.id
      JOIN users u ON ci.issued_by_user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (chemical_id) {
      sql += ` AND ci.chemical_id = ?`;
      params.push(chemical_id);
    }
    if (tank_id) {
      sql += ` AND ci.tank_id = ?`;
      params.push(tank_id);
    }

    sql += ` ORDER BY ci.issue_date DESC`;

    const result = await query(sql, params);
    const rows = result.rows.map(row => ({
      ...row,
      required_qty: parseFloat(row.required_qty),
      total_allocated_value: parseFloat(row.total_allocated_value || '0')
    }));

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/issues/fifo-preview (Generate read-only allocation preview)
router.get('/fifo-preview', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chemical_id, required_qty, allow_override, issue_date } = req.query;

    if (!chemical_id || required_qty == null) {
      return res.status(400).json({ error: 'Chemical and required quantity are required' });
    }

    const qty = parseFloat(required_qty as string);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Required quantity must be greater than zero' });
    }

    const fifoResult = await calculateFIFOAllocation(
      chemical_id as string,
      qty,
      allow_override === 'true',
      undefined,
      issue_date as string | undefined
    );

    return res.json({
      is_sufficient: fifoResult.isFullyAllocated,
      total_allocated: fifoResult.totalAllocatedQty,
      total_available: fifoResult.totalAllocatedQty + fifoResult.shortageQty,
      shortage_qty: fifoResult.shortageQty,
      proposed_allocations: fifoResult.allocations.map(a => ({
        lot_id: a.lotId,
        lot_number: a.lotNumber,
        supplier_batch_number: a.supplierBatch,
        received_at: a.actualReceivedAt,
        remaining_qty: a.availableQty,
        allocated_qty: a.allocatedQty,
        rate_per_unit: a.ratePerUnit,
        allocation_value: a.allocationValue
      })),
      ineligible_lots: fifoResult.ineligibleLots.map(l => ({
        id: l.lotId,
        lot_number: l.lotNumber,
        supplier_batch_number: l.supplierBatch,
        remaining_qty: l.remainingQty,
        status: l.reason
      }))
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/issues/preview & POST /api/issues/fifo-preview (Body payload preview)
const handlePreviewPost = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chemical_id, required_qty, allow_override, issue_date } = req.body;

    if (!chemical_id || required_qty == null) {
      return res.status(400).json({ error: 'Chemical and required quantity are required' });
    }

    const qty = parseFloat(required_qty);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Required quantity must be greater than zero' });
    }

    const fifoResult = await calculateFIFOAllocation(
      chemical_id,
      qty,
      Boolean(allow_override),
      undefined,
      issue_date
    );

    return res.json({
      is_sufficient: fifoResult.isFullyAllocated,
      total_allocated: fifoResult.totalAllocatedQty,
      total_available: fifoResult.totalAllocatedQty + fifoResult.shortageQty,
      shortage_qty: fifoResult.shortageQty,
      proposed_allocations: fifoResult.allocations.map(a => ({
        lot_id: a.lotId,
        lot_number: a.lotNumber,
        supplier_batch_number: a.supplierBatch,
        received_at: a.actualReceivedAt,
        remaining_qty: a.availableQty,
        allocated_qty: a.allocatedQty,
        rate_per_unit: a.ratePerUnit,
        allocation_value: a.allocationValue
      })),
      ineligible_lots: fifoResult.ineligibleLots.map(l => ({
        id: l.lotId,
        lot_number: l.lotNumber,
        supplier_batch_number: l.supplierBatch,
        remaining_qty: l.remainingQty,
        status: l.reason
      }))
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

router.post('/preview', authenticateToken, handlePreviewPost);
router.post('/fifo-preview', authenticateToken, handlePreviewPost);

// GET /api/issues/:id (Details with FIFO lot allocations)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const issueRes = await query(
      `SELECT ci.*, c.code as chemical_code, c.name as chemical_name, c.base_unit,
              t.code as tank_code, t.display_name as tank_name, u.name as issued_by_name
       FROM chemical_issues ci
       JOIN chemicals c ON ci.chemical_id = c.id
       JOIN tanks t ON ci.tank_id = t.id
       JOIN users u ON ci.issued_by_user_id = u.id
       WHERE ci.id = ?`,
      [req.params.id]
    );

    if (issueRes.rows.length === 0) {
      return res.status(404).json({ error: 'Chemical issue record not found' });
    }

    const issue = issueRes.rows[0];

    const allocRes = await query(
      `SELECT fa.*, l.lot_number, l.supplier_batch_number, l.actual_received_at, l.location,
              COALESCE(pr.bill_number, 'OPENING-STOCK') as bill_number
       FROM fifo_allocations fa
       JOIN receipt_lots l ON fa.receipt_lot_id = l.id
       LEFT JOIN purchase_receipts pr ON l.purchase_receipt_id = pr.id
       WHERE fa.chemical_issue_id = ?
       ORDER BY fa.created_at ASC`,
      [req.params.id]
    );

    issue.allocations = allocRes.rows.map(a => ({
      ...a,
      allocated_qty: parseFloat(a.allocated_qty),
      rate_per_unit: a.rate_per_unit != null ? parseFloat(a.rate_per_unit) : null,
      allocation_value: a.allocation_value != null ? parseFloat(a.allocation_value) : null
    }));

    return res.json(issue);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/issues (Atomic transaction posting with row lock & idempotency check)
router.post('/', authenticateToken, requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN', 'STOREKEEPER']), async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required. Valid user session not found.' });
  }

  const dbClient = await getClient();
  try {
    const {
      issue_date, chemical_id, required_qty, tank_id,
      job_reference, job_card_number, job_card_id, production_execution_id,
      issued_by_name, shift, remarks,
      idempotency_key, override_reason, allow_override
    } = req.body;

    const finalJobRef = job_reference || job_card_number || null;
    const idempotencyKeyHeader = req.headers['x-idempotency-key'] as string | undefined;
    const finalIdempotencyKey = idempotency_key || idempotencyKeyHeader || null;

    if (!chemical_id || !tank_id || required_qty == null) {
      return res.status(400).json({ error: 'Chemical, target tank, and required quantity are required' });
    }

    const reqQty = parseFloat(required_qty);
    if (isNaN(reqQty) || reqQty <= 0) {
      return res.status(400).json({ error: 'Required quantity must be greater than zero' });
    }

    // Validate chemical existence & active status
    const chemCheck = await query('SELECT id, is_active FROM chemicals WHERE id = ?', [chemical_id]);
    if (chemCheck.rows.length === 0 || !chemCheck.rows[0].is_active) {
      return res.status(400).json({ error: 'Selected chemical is invalid, deleted, or inactive' });
    }

    // Validate tank existence & active status
    const tankCheck = await query('SELECT id, is_active FROM tanks WHERE id = ?', [tank_id]);
    if (tankCheck.rows.length === 0 || !tankCheck.rows[0].is_active) {
      return res.status(400).json({ error: 'Selected production tank is invalid, deleted, or inactive' });
    }

    // Idempotency protection check
    if (finalIdempotencyKey) {
      const idempRes = await query(`SELECT id, issue_number, total_allocated_value FROM chemical_issues WHERE idempotency_key = ?`, [finalIdempotencyKey]);
      if (idempRes.rows.length > 0) {
        const existing = idempRes.rows[0];
        return res.json({
          id: existing.id,
          issue_number: existing.issue_number,
          issue: {
            id: existing.id,
            issue_number: existing.issue_number,
          },
          total_allocated_value: parseFloat(existing.total_allocated_value || '0'),
          message: 'Duplicate submission blocked by idempotency key. Original issue returned.'
        });
      }
    }

    await dbClient.beginTransaction();

    // Re-verify stock & calculate allocation under transaction
    const fifoResult = await calculateFIFOAllocation(chemical_id, reqQty, Boolean(allow_override), dbClient);

    if (!fifoResult.isFullyAllocated) {
      throw new Error(
        `Insufficient stock to fulfill request. Required: ${reqQty}, Available eligible stock: ${fifoResult.totalAllocatedQty}. Shortage: ${fifoResult.shortageQty}`
      );
    }

    // Validate backdated issue posting rule
    const issueTimestamp = issue_date || new Date().toISOString();
    const latestMovementRes = await dbClient.query(
      `SELECT MAX(m.movement_date) as max_date 
       FROM stock_movements m
       LEFT JOIN receipt_lots l ON m.receipt_lot_id = l.id
       LEFT JOIN purchase_receipts pr ON l.purchase_receipt_id = pr.id
       WHERE m.chemical_id = ? 
         AND (pr.status IS NULL OR pr.status != 'REVERSED')
         AND (l.status IS NULL OR l.status != 'BLOCKED')`,
      [chemical_id]
    );
    const maxDate = latestMovementRes.rows[0]?.max_date;
    if (maxDate && new Date(issueTimestamp) < new Date(maxDate)) {
      throw new Error(
        `Backdated issue rejected: Issue timestamp (${issueTimestamp}) is prior to latest posted movement (${new Date(maxDate).toISOString()}) for this chemical.`
      );
    }

    const issueId = uuidv4();
    const issueNumber = await generateIssueNumber();

    // Prepare combined remarks string if shift/issued_by_name provided
    let combinedRemarks = remarks ? remarks.trim() : '';
    if (shift) {
      combinedRemarks = combinedRemarks ? `[Shift: ${shift}] ${combinedRemarks}` : `[Shift: ${shift}]`;
    }

    // Lock and update receipt lots in consistent order
    for (const alloc of fifoResult.allocations) {
      // Pessimistic row lock
      const lotLockRes = await dbClient.query(`SELECT remaining_qty FROM receipt_lots WHERE id = ? FOR UPDATE`, [alloc.lotId]);
      if (lotLockRes.rows.length === 0) {
        throw new Error(`Receipt lot ${alloc.lotNumber} no longer exists`);
      }

      const currentLotRemaining = parseFloat(lotLockRes.rows[0].remaining_qty);
      if (currentLotRemaining < alloc.allocatedQty) {
        throw new Error(
          `Stock balance changed concurrently for lot ${alloc.lotNumber}. Please re-preview the issue allocation.`
        );
      }

      const newLotRemaining = Math.round((currentLotRemaining - alloc.allocatedQty) * 10000) / 10000;
      const newLotStatus = newLotRemaining === 0 ? 'EXHAUSTED' : 'AVAILABLE';

      await dbClient.query(
        `UPDATE receipt_lots SET remaining_qty = ?, status = ? WHERE id = ?`,
        [newLotRemaining, newLotStatus, alloc.lotId]
      );
    }

    // Save chemical issue header
    await dbClient.query(
      `INSERT INTO chemical_issues (
        id, issue_number, issue_date, chemical_id, required_qty, tank_id,
        job_reference, job_card_id, production_execution_id, issued_by_user_id, remarks, total_allocated_value, status,
        idempotency_key, override_reason, created_at, posted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        issueId, issueNumber, issueTimestamp, chemical_id, reqQty, tank_id,
        finalJobRef, job_card_id || null, production_execution_id || null, req.user.id, combinedRemarks || null, fifoResult.totalAllocatedValue,
        finalIdempotencyKey, override_reason || null
      ]
    );

    // Save allocations and stock movements
    for (const alloc of fifoResult.allocations) {
      const allocId = uuidv4();
      await dbClient.query(
        `INSERT INTO fifo_allocations (
          id, chemical_issue_id, receipt_lot_id, allocated_qty, rate_per_unit, allocation_value
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [allocId, issueId, alloc.lotId, alloc.allocatedQty, alloc.ratePerUnit, alloc.allocationValue]
      );

      const movementId = uuidv4();
      await dbClient.query(
        `INSERT INTO stock_movements (
          id, movement_type, chemical_id, receipt_lot_id, reference_type, reference_id,
          quantity_change, balance_after, movement_date, created_by_user_id, reason
        ) VALUES (?, 'ISSUE', ?, ?, 'CHEMICAL_ISSUE', ?, ?, ?, ?, ?, ?)`,
        [
          movementId, chemical_id, alloc.lotId, issueId, -alloc.allocatedQty,
          alloc.remainingAfter, issueTimestamp, req.user.id,
          `Issued to Tank/Dept (${tank_id}) - Issue Ref ${issueNumber}`
        ]
      );
    }

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'CHEMICAL_ISSUE_POSTED',
      recordRef: `chemical_issues/${issueId}`,
      changedValues: { issueNumber, chemical_id, tank_id, required_qty: reqQty, allocatedLotsCount: fifoResult.allocations.length, job_reference: finalJobRef, issued_by_name: issued_by_name || req.user.name },
    });

    const responsePayload = {
      id: issueId,
      issue_number: issueNumber,
      total_allocated_qty: fifoResult.totalAllocatedQty,
      total_allocated_value: fifoResult.totalAllocatedValue,
      allocations: fifoResult.allocations,
      issue: {
        id: issueId,
        issue_number: issueNumber,
      },
      message: 'Chemical issue posted atomically and stock movements committed'
    };

    return res.status(201).json(responsePayload);
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

export default router;
