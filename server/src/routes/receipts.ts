import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// Function to generate internal receipt lot number format: LOT-YYYYMMDD-XXXX
async function generateLotNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `LOT-${dateStr}-`;
  
  const result = await query(
    `SELECT lot_number FROM receipt_lots WHERE lot_number LIKE ? ORDER BY lot_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].lot_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// Function to generate receipt header number format: REC-YYYYMMDD-XXXX
async function generateReceiptNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `REC-${dateStr}-`;
  
  const result = await query(
    `SELECT receipt_number FROM purchase_receipts WHERE receipt_number LIKE ? ORDER BY receipt_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastNum = result.rows[0].receipt_number;
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// GET /api/receipts (List all receipts with optional status filter)
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, supplier_id } = req.query;
    let sql = `
      SELECT 
        pr.*, s.name as supplier_name, u.name as created_by_name,
        (SELECT COUNT(*) FROM receipt_lots WHERE purchase_receipt_id = pr.id) as line_count,
        (SELECT COUNT(*) FROM attachments WHERE parent_type = 'PURCHASE_RECEIPT' AND parent_id = pr.id) as attachment_count
      FROM purchase_receipts pr
      JOIN suppliers s ON pr.supplier_id = s.id
      JOIN users u ON pr.created_by_user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ` AND pr.status = ?`;
      params.push(status);
    }
    if (supplier_id) {
      sql += ` AND pr.supplier_id = ?`;
      params.push(supplier_id);
    }

    sql += ` ORDER BY pr.created_at DESC`;

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/receipts/check-duplicate-bill
router.get('/check-duplicate-bill', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { supplier_id, bill_number } = req.query;
    if (!supplier_id || !bill_number) {
      return res.json({ isDuplicate: false });
    }

    const result = await query(
      `SELECT id, receipt_number, bill_date, status FROM purchase_receipts 
       WHERE supplier_id = ? AND UPPER(bill_number) = UPPER(?) AND status != 'REVERSED'`,
      [supplier_id, (bill_number as string).trim()]
    );

    if (result.rows.length > 0) {
      return res.json({ 
        isDuplicate: true, 
        existingReceipt: result.rows[0],
        warning: `Supplier already has an existing active receipt (${result.rows[0].receipt_number}) with Bill No "${bill_number}"` 
      });
    }

    return res.json({ isDuplicate: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/receipts/:id (Details with lines & attachments)
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const receiptRes = await query(
      `SELECT pr.*, s.name as supplier_name, u.name as created_by_name
       FROM purchase_receipts pr
       JOIN suppliers s ON pr.supplier_id = s.id
       JOIN users u ON pr.created_by_user_id = u.id
       WHERE pr.id = ?`,
      [req.params.id]
    );

    if (receiptRes.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase receipt not found' });
    }

    const receipt = receiptRes.rows[0];

    const linesRes = await query(
      `SELECT l.*, c.code as chemical_code, c.name as chemical_name, c.base_unit
       FROM receipt_lots l
       JOIN chemicals c ON l.chemical_id = c.id
       WHERE l.purchase_receipt_id = ?
       ORDER BY l.created_at ASC`,
      [req.params.id]
    );

    const attachmentsRes = await query(
      `SELECT * FROM attachments WHERE parent_type = 'PURCHASE_RECEIPT' AND parent_id = ?`,
      [req.params.id]
    );

    receipt.lines = linesRes.rows.map(line => ({
      ...line,
      initial_qty: parseFloat(line.initial_qty),
      remaining_qty: parseFloat(line.remaining_qty),
      rate_per_unit: line.rate_per_unit != null ? parseFloat(line.rate_per_unit) : null,
      line_amount: line.line_amount != null ? parseFloat(line.line_amount) : null
    }));

    receipt.attachments = attachmentsRes.rows;

    return res.json(receipt);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/receipts (Create Draft / Review / Post with optional PO linkage and idempotency)
router.post('/', authenticateToken, requireRole(['STAFF', 'ADMIN', 'SUPER_ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const { 
      supplier_id, bill_number, bill_date, actual_received_at, delivery_challan_number, 
      notes, lines, status: requestedStatus, chemical_po_id, idempotency_key 
    } = req.body;

    const idempotencyKeyHeader = req.headers['x-idempotency-key'] as string | undefined;
    const finalIdempotencyKey = idempotency_key || idempotencyKeyHeader || null;

    if (!supplier_id || !bill_number || !bill_date || !actual_received_at) {
      return res.status(400).json({ error: 'Supplier, bill number, bill date, and actual received date/time are required' });
    }

    if (new Date(actual_received_at) > new Date()) {
      return res.status(400).json({ error: 'Actual received date/time cannot be in the future.' });
    }

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'At least one chemical line item is required' });
    }

    // Check duplicate bill number for this supplier
    const dupBillCheck = await query(
      `SELECT id, receipt_number FROM purchase_receipts WHERE supplier_id = ? AND bill_number = ? AND status != 'REVERSED'`,
      [supplier_id, bill_number.trim()]
    );
    if (dupBillCheck.rows.length > 0) {
      return res.status(400).json({
        error: `Bill Number ${bill_number.trim()} has already been recorded under Receipt ${dupBillCheck.rows[0].receipt_number}. Duplicate bills are prohibited.`
      });
    }

    const status = requestedStatus === 'POSTED' ? 'POSTED' : 'DRAFT';

    await dbClient.beginTransaction();

    // Verify PO status if chemical_po_id is provided
    if (chemical_po_id) {
      const poCheck = await dbClient.query(
        `SELECT id, status FROM chemical_purchase_orders WHERE id = ?`,
        [chemical_po_id]
      );
      if (poCheck.rows.length === 0) {
        throw new Error('Associated Chemical Purchase Order not found');
      }
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(poCheck.rows[0].status)) {
        throw new Error(`Cannot receive chemicals against PO in status ${poCheck.rows[0].status}. PO must be APPROVED.`);
      }
    }

    const receiptId = uuidv4();
    const receiptNumber = await generateReceiptNumber();

    // Insert header
    await dbClient.query(
      `INSERT INTO purchase_receipts (
        id, receipt_number, supplier_id, bill_number, bill_date, actual_received_at,
        delivery_challan_number, notes, status, created_by_user_id, created_at, posted_at, posted_by_user_id,
        chemical_po_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ${status === 'POSTED' ? "datetime('now')" : 'NULL'}, ${status === 'POSTED' ? '?' : 'NULL'}, ?)`,
      status === 'POSTED'
        ? [receiptId, receiptNumber, supplier_id, bill_number.trim(), bill_date, actual_received_at, delivery_challan_number || null, notes || null, status, req.user?.id, req.user?.id, chemical_po_id || null]
        : [receiptId, receiptNumber, supplier_id, bill_number.trim(), bill_date, actual_received_at, delivery_challan_number || null, notes || null, status, req.user?.id, chemical_po_id || null]
    );

    const createdLots = [];

    for (const line of lines) {
      if (!line.chemical_id || !line.supplier_batch_number || line.received_qty == null) {
        throw new Error('Each line must have a chemical, supplier batch number, and received quantity');
      }

      const qty = parseFloat(line.received_qty);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('Received quantity must be a positive number');
      }

      // If line is linked to a PO item, check and update PO item received quantity
      if (line.chemical_po_item_id) {
        const poItemRes = await dbClient.query(
          `SELECT id, ordered_qty, received_qty FROM chemical_po_items WHERE id = ?`,
          [line.chemical_po_item_id]
        );
        if (poItemRes.rows.length > 0) {
          const poItem = poItemRes.rows[0];
          const ordered = parseFloat(poItem.ordered_qty);
          const prevReceived = parseFloat(poItem.received_qty || '0');
          const pending = Math.round((ordered - prevReceived) * 10000) / 10000;

          if (qty > pending) {
            throw new Error(
              `Excess receipt rejected: Received quantity (${qty}) exceeds pending quantity (${pending}) for PO item. Ordered: ${ordered}, already received: ${prevReceived}.`
            );
          }

          await dbClient.query(
            `UPDATE chemical_po_items SET received_qty = received_qty + ? WHERE id = ?`,
            [qty, line.chemical_po_item_id]
          );
        }
      }

      // Check backdated posting constraint if posting
      if (status === 'POSTED') {
        const latestMovementRes = await dbClient.query(
          `SELECT MAX(m.movement_date) as max_date 
           FROM stock_movements m
           LEFT JOIN receipt_lots l ON m.receipt_lot_id = l.id
           LEFT JOIN purchase_receipts pr ON l.purchase_receipt_id = pr.id
           WHERE m.chemical_id = ? 
             AND (pr.status IS NULL OR pr.status != 'REVERSED')
             AND (l.status IS NULL OR l.status != 'BLOCKED')`,
          [line.chemical_id]
        );
        const maxDate = latestMovementRes.rows[0]?.max_date;
        if (maxDate && new Date(actual_received_at) < new Date(maxDate)) {
          throw new Error(
            `Backdated posting rejected: Received date (${actual_received_at}) is prior to the latest posted movement (${new Date(maxDate).toISOString()}) for chemical ID ${line.chemical_id}.`
          );
        }
      }

      const lotId = uuidv4();
      const lotNumber = await generateLotNumber();
      const rate = line.rate_per_unit != null ? parseFloat(line.rate_per_unit) : null;
      const lineAmt = rate != null ? Math.round(qty * rate * 100) / 100 : null;

      await dbClient.query(
        `INSERT INTO receipt_lots (
          id, lot_number, purchase_receipt_id, chemical_id, supplier_batch_number,
          initial_qty, remaining_qty, rate_per_unit, line_amount, location, expiry_date,
          status, actual_received_at, is_opening_stock, chemical_po_item_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, 0, ?)`,
        [
          lotId, lotNumber, receiptId, line.chemical_id, line.supplier_batch_number.trim(),
          qty, qty, rate, lineAmt, line.location || null, line.expiry_date || null, actual_received_at,
          line.chemical_po_item_id || null
        ]
      );

      // If posting, record stock movement ledger entry
      if (status === 'POSTED') {
        const movementId = uuidv4();
        await dbClient.query(
          `INSERT INTO stock_movements (
            id, movement_type, chemical_id, receipt_lot_id, reference_type, reference_id,
            quantity_change, balance_after, movement_date, created_by_user_id, reason
          ) VALUES (?, 'RECEIPT', ?, ?, 'PURCHASE_RECEIPT', ?, ?, ?, ?, ?, ?)`,
          [
            movementId, line.chemical_id, lotId, receiptId, qty, qty, actual_received_at,
            req.user?.id, `Chemical Purchase Receipt ${receiptNumber} - Lot ${lotNumber}`
          ]
        );
      }

      createdLots.push({ lotId, lotNumber, chemicalId: line.chemical_id, qty });
    }

    // If linked to PO, update PO overall status
    if (chemical_po_id) {
      const allItemsRes = await dbClient.query(
        `SELECT ordered_qty, received_qty FROM chemical_po_items WHERE chemical_po_id = ?`,
        [chemical_po_id]
      );
      const isComplete = allItemsRes.rows.every(
        (it: any) => parseFloat(it.received_qty) >= parseFloat(it.ordered_qty)
      );
      const newPoStatus = isComplete ? 'COMPLETED' : 'PARTIALLY_RECEIVED';
      await dbClient.query(
        `UPDATE chemical_purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?`,
        [newPoStatus, chemical_po_id]
      );
    }

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: status === 'POSTED' ? 'PURCHASE_RECEIPT_POSTED' : 'PURCHASE_RECEIPT_DRAFTED',
      recordRef: `purchase_receipts/${receiptId}`,
      changedValues: { receiptNumber, billNumber: bill_number, supplier_id, status, lineCount: lines.length, chemical_po_id },
    });

    return res.status(201).json({
      id: receiptId,
      receipt_number: receiptNumber,
      status,
      lots: createdLots,
      message: status === 'POSTED' ? 'Chemical purchase receipt posted successfully and stock updated' : 'Purchase receipt draft saved'
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// POST /api/receipts/:id/post (Post a draft receipt)
router.post('/:id/post', authenticateToken, requireRole(['ADMIN', 'STOREKEEPER']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const { id } = req.params;
    await dbClient.beginTransaction();

    const receiptRes = await dbClient.query(`SELECT * FROM purchase_receipts WHERE id = ? FOR UPDATE`, [id]);
    if (receiptRes.rows.length === 0) {
      throw new Error('Purchase receipt not found');
    }

    const receipt = receiptRes.rows[0];
    if (receipt.status === 'POSTED') {
      throw new Error('This purchase receipt has already been posted');
    }
    if (receipt.status === 'REVERSED') {
      throw new Error('Cannot post a reversed receipt');
    }

    const lotsRes = await dbClient.query(`SELECT * FROM receipt_lots WHERE purchase_receipt_id = ?`, [id]);
    const lots = lotsRes.rows;

    for (const lot of lots) {
      const latestMovementRes = await dbClient.query(
        `SELECT MAX(movement_date) as max_date FROM stock_movements WHERE chemical_id = ?`,
        [lot.chemical_id]
      );
      const maxDate = latestMovementRes.rows[0]?.max_date;
      if (maxDate && new Date(receipt.actual_received_at) < new Date(maxDate)) {
        throw new Error(
          `Backdated posting rejected: Received date (${receipt.actual_received_at}) is prior to latest posted movement date.`
        );
      }

      const movementId = uuidv4();
      const qty = parseFloat(lot.initial_qty);

      await dbClient.query(
        `INSERT INTO stock_movements (
          id, movement_type, chemical_id, receipt_lot_id, reference_type, reference_id,
          quantity_change, balance_after, movement_date, created_by_user_id, reason
        ) VALUES (?, 'RECEIPT', ?, ?, 'PURCHASE_RECEIPT', ?, ?, ?, ?, ?, ?)`,
        [
          movementId, lot.chemical_id, lot.id, id, qty, qty, receipt.actual_received_at,
          req.user?.id, `Posted Draft Receipt ${receipt.receipt_number} - Lot ${lot.lot_number}`
        ]
      );
    }

    await dbClient.query(
      `UPDATE purchase_receipts SET status = 'POSTED', posted_at = CURRENT_TIMESTAMP, posted_by_user_id = ? WHERE id = ?`,
      [req.user?.id, id]
    );

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PURCHASE_RECEIPT_POSTED',
      recordRef: `purchase_receipts/${id}`,
      reason: `Posted purchase receipt draft ${receipt.receipt_number}`,
    });

    return res.json({ id, message: 'Receipt posted successfully' });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// POST /api/receipts/:id/correct-date (Admin Receipt-Date Correction with audit logging)
router.post('/:id/correct-date', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const { id } = req.params;
    const { new_actual_received_at, reason } = req.body;

    if (!new_actual_received_at || !reason || !reason.trim()) {
      return res.status(400).json({ error: 'New actual received date/time and explicit audit reason are required' });
    }

    if (new Date(new_actual_received_at) > new Date()) {
      return res.status(400).json({ error: 'Actual received date/time cannot be in the future.' });
    }

    await dbClient.beginTransaction();

    const receiptRes = await dbClient.query(`SELECT * FROM purchase_receipts WHERE id = ? FOR UPDATE`, [id]);
    if (receiptRes.rows.length === 0) {
      throw new Error('Purchase receipt not found');
    }

    const receipt = receiptRes.rows[0];
    if (receipt.status === 'REVERSED') {
      throw new Error('Cannot correct receipt date for a reversed receipt');
    }

    const oldActualReceivedAt = receipt.actual_received_at;

    // Dependency check: check all lots belonging to this receipt
    const lotsRes = await dbClient.query(`SELECT * FROM receipt_lots WHERE purchase_receipt_id = ?`, [id]);
    const lots = lotsRes.rows;

    for (const lot of lots) {
      const issueCheckRes = await dbClient.query(
        `SELECT ci.issue_number, ci.issue_date
         FROM fifo_allocations fa
         JOIN chemical_issues ci ON fa.chemical_issue_id = ci.id
         WHERE fa.receipt_lot_id = ? AND ci.issue_date < ? AND ci.status != 'REVERSED'`,
        [lot.id, new_actual_received_at]
      );

      if (issueCheckRes.rows.length > 0) {
        const issue = issueCheckRes.rows[0];
        throw new Error(
          `Cannot set receipt date to ${new_actual_received_at}: Issue ${issue.issue_number} was posted on ${issue.issue_date} prior to this date.`
        );
      }
    }

    // 1. Update purchase_receipts
    await dbClient.query(
      `UPDATE purchase_receipts SET actual_received_at = ? WHERE id = ?`,
      [new_actual_received_at, id]
    );

    // 2. Update receipt_lots
    await dbClient.query(
      `UPDATE receipt_lots SET actual_received_at = ? WHERE purchase_receipt_id = ?`,
      [new_actual_received_at, id]
    );

    // 3. Update stock_movements for this receipt
    await dbClient.query(
      `UPDATE stock_movements SET movement_date = ? WHERE reference_type = 'PURCHASE_RECEIPT' AND reference_id = ?`,
      [new_actual_received_at, id]
    );

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'PURCHASE_RECEIPT_DATE_CORRECTED',
      recordRef: `purchase_receipts/${id}`,
      changedValues: {
        receipt_number: receipt.receipt_number,
        old_actual_received_at: oldActualReceivedAt,
        new_actual_received_at: new_actual_received_at
      },
      reason: reason.trim()
    });

    return res.json({
      id,
      receipt_number: receipt.receipt_number,
      old_actual_received_at: oldActualReceivedAt,
      new_actual_received_at: new_actual_received_at,
      message: `Receipt ${receipt.receipt_number} actual received date updated to ${new_actual_received_at}`
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

export default router;
