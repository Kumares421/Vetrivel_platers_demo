import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// GET /api/stock/summary (Chemical level summary with on-hand, available, blocked, low stock)
router.get('/summary', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        c.id, c.code, c.name, c.base_unit, c.min_stock_level, c.is_active,
        COALESCE(SUM(l.remaining_qty), 0) as total_on_hand,
        COALESCE(SUM(CASE WHEN l.status = 'AVAILABLE' AND (l.expiry_date IS NULL OR l.expiry_date >= CURRENT_DATE) THEN l.remaining_qty ELSE 0 END), 0) as total_available,
        COALESCE(SUM(CASE WHEN l.status IN ('QUARANTINED', 'BLOCKED') THEN l.remaining_qty ELSE 0 END), 0) as total_blocked,
        COALESCE(SUM(CASE WHEN l.expiry_date < CURRENT_DATE THEN l.remaining_qty ELSE 0 END), 0) as total_expired,
        COUNT(l.id) as lot_count
      FROM chemicals c
      LEFT JOIN receipt_lots l ON c.id = l.chemical_id AND l.remaining_qty > 0
      GROUP BY c.id, c.code, c.name, c.base_unit, c.min_stock_level, c.is_active
      ORDER BY c.code ASC
    `;
    const result = await query(sql);

    const summary = result.rows.map(row => ({
      ...row,
      min_stock_level: parseFloat(row.min_stock_level || '0'),
      total_on_hand: parseFloat(row.total_on_hand || '0'),
      total_available: parseFloat(row.total_available || '0'),
      total_blocked: parseFloat(row.total_blocked || '0'),
      total_expired: parseFloat(row.total_expired || '0'),
      // Low stock only when eligible available stock is STRICTLY LESS THAN minimum.
      // Equal to minimum is NOT below minimum.
      is_low_stock: parseFloat(row.min_stock_level || '0') > 0 && parseFloat(row.total_available || '0') < parseFloat(row.min_stock_level || '0')
    }));

    return res.json(summary);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/stock/lots (Expandable list of receipt lots with filters)
router.get('/lots', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chemical_id, status, supplier_batch, lot_id, include_exhausted } = req.query;

    let sql = `
      SELECT 
        l.*, c.code as chemical_code, c.name as chemical_name, c.base_unit,
        s.name as supplier_name, COALESCE(pr.bill_number, 'OPENING-STOCK') as bill_number,
        pr.bill_date,
        (SELECT COALESCE(SUM(allocated_qty), 0) FROM fifo_allocations WHERE receipt_lot_id = l.id) as total_issued_qty
      FROM receipt_lots l
      JOIN chemicals c ON l.chemical_id = c.id
      LEFT JOIN purchase_receipts pr ON l.purchase_receipt_id = pr.id
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (chemical_id) {
      sql += ` AND l.chemical_id = ?`;
      params.push(chemical_id);
    }
    if (status) {
      sql += ` AND l.status = ?`;
      params.push(status);
    }
    if (supplier_batch) {
      sql += ` AND UPPER(l.supplier_batch_number) LIKE UPPER(?)`;
      params.push(`%${supplier_batch}%`);
    }
    if (lot_id) {
      sql += ` AND l.id = ?`;
      params.push(lot_id);
    }
    if (include_exhausted !== 'true') {
      sql += ` AND l.remaining_qty > 0`;
    }

    sql += ` ORDER BY l.actual_received_at ASC, l.created_at ASC`;

    const result = await query(sql, params);

    const lots = result.rows.map(row => ({
      ...row,
      initial_qty: parseFloat(row.initial_qty),
      remaining_qty: parseFloat(row.remaining_qty),
      total_issued_qty: parseFloat(row.total_issued_qty || '0'),
      rate_per_unit: row.rate_per_unit != null ? parseFloat(row.rate_per_unit) : null,
      stock_value: row.rate_per_unit != null ? Math.round(parseFloat(row.remaining_qty) * parseFloat(row.rate_per_unit) * 100) / 100 : null
    }));

    return res.json(lots);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/stock/lots/:id/movements (Full lot movement history timeline)
router.get('/lots/:id/movements', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = `
      SELECT 
        sm.*, u.name as user_name,
        l.lot_number, l.supplier_batch_number,
        c.code as chemical_code, c.name as chemical_name, c.base_unit
      FROM stock_movements sm
      JOIN receipt_lots l ON sm.receipt_lot_id = l.id
      JOIN chemicals c ON sm.chemical_id = c.id
      JOIN users u ON sm.created_by_user_id = u.id
      WHERE sm.receipt_lot_id = ?
      ORDER BY sm.movement_date ASC, sm.created_at ASC
    `;
    const result = await query(sql, [req.params.id]);

    const movements = result.rows.map(m => ({
      ...m,
      quantity_change: parseFloat(m.quantity_change),
      balance_after: parseFloat(m.balance_after)
    }));

    return res.json(movements);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/stock/adjustments (Quarantine, Unblock, Damage Write-off, Count Correction)
router.post('/adjustments', authenticateToken, requireRole(['ADMIN', 'STOREKEEPER']), async (req: AuthenticatedRequest, res: Response) => {
  const dbClient = await getClient();
  try {
    const { receipt_lot_id, adjustment_type, quantity, reason } = req.body;

    if (!receipt_lot_id || !adjustment_type || !reason || !reason.trim()) {
      return res.status(400).json({ error: 'Receipt lot, adjustment type, and explicit reason are required' });
    }

    if (!['QUARANTINE', 'UNBLOCK', 'DAMAGE_WRITE_OFF', 'COUNT_CORRECTION'].includes(adjustment_type)) {
      return res.status(400).json({ error: 'Invalid adjustment type' });
    }

    await dbClient.beginTransaction();

    const lotRes = await dbClient.query(`SELECT * FROM receipt_lots WHERE id = ? FOR UPDATE`, [receipt_lot_id]);
    if (lotRes.rows.length === 0) {
      throw new Error('Receipt lot not found');
    }

    const lot = lotRes.rows[0];
    const currentQty = parseFloat(lot.remaining_qty);
    const adjQty = quantity != null ? parseFloat(quantity) : 0;
    const adjId = uuidv4();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const adjNum = `ADJ-${dateStr}-${uuidv4().substring(0, 4).toUpperCase()}`;

    let newQty = currentQty;
    let newStatus = lot.status;

    if (adjustment_type === 'QUARANTINE') {
      newStatus = 'QUARANTINED';
    } else if (adjustment_type === 'UNBLOCK') {
      newStatus = currentQty > 0 ? 'AVAILABLE' : 'EXHAUSTED';
    } else if (adjustment_type === 'DAMAGE_WRITE_OFF') {
      if (adjQty <= 0 || adjQty > currentQty) {
        throw new Error(`Write-off quantity (${adjQty}) cannot exceed available lot balance (${currentQty})`);
      }
      newQty = currentQty - adjQty;
      if (newQty === 0) newStatus = 'EXHAUSTED';
    } else if (adjustment_type === 'COUNT_CORRECTION') {
      if (adjQty < 0) {
        throw new Error('Count correction must be non-negative');
      }
      newQty = adjQty;
      newStatus = newQty > 0 ? (lot.status === 'QUARANTINED' ? 'QUARANTINED' : 'AVAILABLE') : 'EXHAUSTED';
    }

    await dbClient.query(
      `INSERT INTO stock_adjustments (
        id, adjustment_number, chemical_id, receipt_lot_id, adjustment_type, quantity, reason, adjusted_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [adjId, adjNum, lot.chemical_id, lot.id, adjustment_type, adjQty, reason.trim(), req.user?.id]
    );

    await dbClient.query(
      `UPDATE receipt_lots SET remaining_qty = ?, status = ? WHERE id = ?`,
      [newQty, newStatus, lot.id]
    );

    const qtyChange = newQty - currentQty;
    const movementId = uuidv4();

    await dbClient.query(
      `INSERT INTO stock_movements (
        id, movement_type, chemical_id, receipt_lot_id, reference_type, reference_id,
        quantity_change, balance_after, movement_date, created_by_user_id, reason
      ) VALUES (?, 'ADJUSTMENT', ?, ?, 'STOCK_ADJUSTMENT', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
      [
        movementId, lot.chemical_id, lot.id, adjId, qtyChange, newQty,
        req.user?.id, `Adjustment ${adjNum} (${adjustment_type}): ${reason.trim()}`
      ]
    );

    await dbClient.commit();

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'STOCK_ADJUSTMENT_POSTED',
      recordRef: `stock_adjustments/${adjId}`,
      changedValues: { adjustment_number: adjNum, lot_id: lot.id, adjustment_type, quantity: adjQty, oldQty: currentQty, newQty },
      reason: reason.trim()
    });

    return res.status(201).json({
      id: adjId,
      adjustment_number: adjNum,
      new_remaining_qty: newQty,
      new_status: newStatus,
      message: 'Stock adjustment posted successfully'
    });
  } catch (err: any) {
    await dbClient.rollback();
    return res.status(400).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

export default router;
