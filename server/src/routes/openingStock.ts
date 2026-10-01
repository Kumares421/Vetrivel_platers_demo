import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// GET /api/opening-stock
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT os.*, c.code as chemical_code, c.name as chemical_name, c.base_unit, u.name as verified_by_name,
              l.lot_number, l.remaining_qty
       FROM opening_stock_entries os
       JOIN chemicals c ON os.chemical_id = c.id
       JOIN users u ON os.verified_by_user_id = u.id
       LEFT JOIN receipt_lots l ON os.receipt_lot_id = l.id
       ORDER BY os.verification_date DESC, os.created_at DESC`
    );

    const rows = result.rows.map(row => ({
      ...row,
      quantity: parseFloat(row.quantity),
      rate_per_unit: row.rate_per_unit != null ? parseFloat(row.rate_per_unit) : null,
      remaining_qty: row.remaining_qty != null ? parseFloat(row.remaining_qty) : null
    }));

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/opening-stock (Admin / Storekeeper)
router.post('/', authenticateToken, requireRole(['ADMIN', 'STOREKEEPER']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const {
      verification_date, chemical_id, supplier_batch_number, quantity,
      original_received_date, rate_per_unit, expiry_date, notes, fifo_order_index
    } = req.body;

    if (!verification_date || !chemical_id || quantity == null) {
      return res.status(400).json({ error: 'Verification date, chemical, and physical quantity are required' });
    }

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive number' });
    }

    const rate = rate_per_unit != null && rate_per_unit !== '' ? parseFloat(rate_per_unit) : null;
    const receivedDate = original_received_date || verification_date;
    const isReceivedDateUnknown = !original_received_date;
    const fifoIndex = fifo_order_index != null ? parseInt(fifo_order_index, 10) : (isReceivedDateUnknown ? -1 : 0);

    await dbClient.beginTransaction();

    const entryId = uuidv4();
    const lotId = uuidv4();
    const dateStr = new Date(verification_date).toISOString().slice(0, 10).replace(/-/g, '');
    const lotNumber = `OPN-${dateStr}-${uuidv4().substring(0, 4).toUpperCase()}`;

    const batchNo = supplier_batch_number && supplier_batch_number.trim() ? supplier_batch_number.trim() : 'OPN-VERIFIED';
    const lineAmt = rate != null ? Math.round(qty * rate * 100) / 100 : null;

    // Create opening stock receipt lot
    await dbClient.query(
      `INSERT INTO receipt_lots (
        id, lot_number, chemical_id, supplier_batch_number, initial_qty, remaining_qty,
        rate_per_unit, line_amount, location, expiry_date, status, actual_received_at,
        is_opening_stock, fifo_order_index
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MAIN-STORES', ?, 'AVAILABLE', ?, true, ?)`,
      [
        lotId, lotNumber, chemical_id, batchNo, qty, qty,
        rate, lineAmt, expiry_date || null, receivedDate, fifoIndex
      ]
    );

    // Create opening stock header record
    await dbClient.query(
      `INSERT INTO opening_stock_entries (
        id, verification_date, chemical_id, supplier_batch_number, quantity,
        original_received_date, rate_per_unit, expiry_date, notes,
        fifo_review_required, verified_by_user_id, receipt_lot_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entryId, verification_date, chemical_id, batchNo, qty,
        original_received_date || null, rate, expiry_date || null, notes || null,
        isReceivedDateUnknown && fifoIndex === -1 ? 1 : 0, req.user?.id, lotId
      ]
    );

    // Record stock movement
    const movementId = uuidv4();
    await dbClient.query(
      `INSERT INTO stock_movements (
        id, movement_type, chemical_id, receipt_lot_id, reference_type, reference_id,
        quantity_change, balance_after, movement_date, created_by_user_id, reason
      ) VALUES (?, 'OPENING_STOCK', ?, ?, 'OPENING_STOCK_ENTRY', ?, ?, ?, ?, ?, ?)`,
      [
        movementId, chemical_id, lotId, entryId, qty, qty, verification_date,
        req.user?.id, `Opening Stock Physical Verification - Lot ${lotNumber}`
      ]
    );

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'OPENING_STOCK_ENTRY_CREATED',
      recordRef: `opening_stock_entries/${entryId}`,
      changedValues: { verification_date, chemical_id, quantity: qty, rate_per_unit: rate, lotNumber },
    });

    return res.status(201).json({
      id: entryId,
      lot_id: lotId,
      lot_number: lotNumber,
      message: 'Opening stock physically verified and added to inventory ledger'
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

export default router;
