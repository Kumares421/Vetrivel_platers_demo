import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// GET /api/reversals
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT r.*, u.name as reversed_by_name
       FROM reversals r
       JOIN users u ON r.reversed_by_user_id = u.id
       ORDER BY r.reversal_date DESC`
    );
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/reversals/issue/:id (Reverse a chemical issue)
router.post('/issue/:id', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Explicit reason is required for reversing a chemical issue' });
    }

    await dbClient.beginTransaction();

    const issueRes = await dbClient.query(`SELECT * FROM chemical_issues WHERE id = ? FOR UPDATE`, [id]);
    if (issueRes.rows.length === 0) {
      throw new Error('Chemical issue record not found');
    }

    const issue = issueRes.rows[0];
    if (issue.status === 'REVERSED') {
      throw new Error('This chemical issue has already been reversed');
    }

    // Get all allocations made by this issue
    const allocsRes = await dbClient.query(`SELECT * FROM fifo_allocations WHERE chemical_issue_id = ?`, [id]);
    const allocs = allocsRes.rows;

    for (const alloc of allocs) {
      const lotRes = await dbClient.query(`SELECT * FROM receipt_lots WHERE id = ? FOR UPDATE`, [alloc.receipt_lot_id]);
      if (lotRes.rows.length > 0) {
        const lot = lotRes.rows[0];
        const currentQty = parseFloat(lot.remaining_qty);
        const restoreQty = parseFloat(alloc.allocated_qty);
        const newQty = Math.round((currentQty + restoreQty) * 10000) / 10000;
        const newStatus = lot.status === 'EXHAUSTED' ? 'AVAILABLE' : lot.status;

        // Restore quantity to original lot
        await dbClient.query(
          `UPDATE receipt_lots SET remaining_qty = ?, status = ? WHERE id = ?`,
          [newQty, newStatus, lot.id]
        );

        // Record reversal stock movement
        const movementId = uuidv4();
        await dbClient.query(
          `INSERT INTO stock_movements (
            id, movement_type, chemical_id, receipt_lot_id, reference_type, reference_id,
            quantity_change, balance_after, movement_date, created_by_user_id, reason
          ) VALUES (?, 'REVERSAL_ISSUE', ?, ?, 'REVERSAL', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
          [
            movementId, issue.chemical_id, lot.id, id, restoreQty, newQty,
            req.user?.id, `Reversal of Issue ${issue.issue_number}: ${reason.trim()}`
          ]
        );
      }
    }

    // Update issue status
    await dbClient.query(`UPDATE chemical_issues SET status = 'REVERSED' WHERE id = ?`, [id]);

    // Save reversal audit record
    const revId = uuidv4();
    await dbClient.query(
      `INSERT INTO reversals (id, original_type, original_id, reason, reversed_by_user_id)
       VALUES (?, 'ISSUE', ?, ?, ?)`,
      [revId, id, reason.trim(), req.user?.id]
    );

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'CHEMICAL_ISSUE_REVERSED',
      recordRef: `chemical_issues/${id}`,
      reason: reason.trim()
    });

    return res.json({ id, message: `Chemical issue ${issue.issue_number} reversed successfully. Issued quantities restored to lots.` });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// POST /api/reversals/receipt/:id (Reverse a purchase receipt)
router.post('/receipt/:id', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Explicit reason is required for reversing a purchase receipt' });
    }

    await dbClient.beginTransaction();

    const receiptRes = await dbClient.query(`SELECT * FROM purchase_receipts WHERE id = ? FOR UPDATE`, [id]);
    if (receiptRes.rows.length === 0) {
      throw new Error('Purchase receipt not found');
    }

    const receipt = receiptRes.rows[0];
    if (receipt.status === 'REVERSED') {
      throw new Error('This purchase receipt has already been reversed');
    }

    const lotsRes = await dbClient.query(`SELECT * FROM receipt_lots WHERE purchase_receipt_id = ?`, [id]);
    const lots = lotsRes.rows;

    // BLOCK receipt reversal if dependent issued stock has been consumed and not restored!
    for (const lot of lots) {
      const initQty = parseFloat(lot.initial_qty);
      const remQty = parseFloat(lot.remaining_qty);
      if (Math.abs(initQty - remQty) > 0.0001) {
        throw new Error(
          `Cannot reverse receipt ${receipt.receipt_number}: Stock from Lot ${lot.lot_number} (${initQty - remQty} ${lot.chemical_id}) has already been issued. Please reverse dependent issues first.`
        );
      }
    }

    // Zero out lots and record movement
    for (const lot of lots) {
      await dbClient.query(
        `UPDATE receipt_lots SET remaining_qty = 0, status = 'BLOCKED' WHERE id = ?`,
        [lot.id]
      );

      const movementId = uuidv4();
      await dbClient.query(
        `INSERT INTO stock_movements (
          id, movement_type, chemical_id, receipt_lot_id, reference_type, reference_id,
          quantity_change, balance_after, movement_date, created_by_user_id, reason
        ) VALUES (?, 'REVERSAL_RECEIPT', ?, ?, 'REVERSAL', ?, ?, 0, CURRENT_TIMESTAMP, ?, ?)`,
        [
          movementId, lot.chemical_id, lot.id, id, -parseFloat(lot.initial_qty),
          req.user?.id, `Reversal of Receipt ${receipt.receipt_number}: ${reason.trim()}`
        ]
      );
    }

    await dbClient.query(`UPDATE purchase_receipts SET status = 'REVERSED' WHERE id = ?`, [id]);

    const revId = uuidv4();
    await dbClient.query(
      `INSERT INTO reversals (id, original_type, original_id, reason, reversed_by_user_id)
       VALUES (?, 'RECEIPT', ?, ?, ?)`,
      [revId, id, reason.trim(), req.user?.id]
    );

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PURCHASE_RECEIPT_REVERSED',
      recordRef: `purchase_receipts/${id}`,
      reason: reason.trim()
    });

    return res.json({ id, message: `Purchase receipt ${receipt.receipt_number} reversed successfully` });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

export default router;
