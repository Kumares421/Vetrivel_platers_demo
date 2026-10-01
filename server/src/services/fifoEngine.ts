import { query } from '../db';

export interface FIFOAllocationProposal {
  lotId: string;
  lotNumber: string;
  supplierBatch: string;
  billNumber: string;
  actualReceivedAt: string;
  availableQty: number;
  allocatedQty: number;
  remainingAfter: number;
  ratePerUnit: number | null;
  allocationValue: number | null;
  isOpeningStock: boolean;
  location: string | null;
}

export interface IneligibleLotInfo {
  lotId: string;
  lotNumber: string;
  supplierBatch: string;
  remainingQty: number;
  reason: string;
}

export interface FIFOCalculationResult {
  allocations: FIFOAllocationProposal[];
  totalAllocatedQty: number;
  totalAllocatedValue: number;
  isFullyAllocated: boolean;
  shortageQty: number;
  ineligibleLots: IneligibleLotInfo[];
}

export async function calculateFIFOAllocation(
  chemicalId: string,
  requiredQty: number,
  allowOpeningStockReviewOverride: boolean = false,
  dbClient?: any,
  asOfTimestamp?: string
): Promise<FIFOCalculationResult> {
  const executeQuery = dbClient ? dbClient.query : query;

  let sql = `
    SELECT 
      l.id, l.lot_number, l.supplier_batch_number, l.remaining_qty,
      l.rate_per_unit, l.location, l.expiry_date, l.status, l.actual_received_at,
      l.is_opening_stock, l.fifo_order_index,
      COALESCE(p.bill_number, 'OPENING-STOCK') as bill_number
    FROM receipt_lots l
    LEFT JOIN purchase_receipts p ON l.purchase_receipt_id = p.id
    WHERE l.chemical_id = ? AND l.remaining_qty > 0
  `;
  const params: any[] = [chemicalId];

  if (asOfTimestamp) {
    sql += ` AND l.actual_received_at <= ?`;
    params.push(asOfTimestamp);
  }

  sql += ` ORDER BY l.actual_received_at ASC, l.fifo_order_index ASC, l.id ASC`;

  const res = await executeQuery(sql, params);
  const lots = res.rows;

  const today = new Date().toISOString().split('T')[0];
  const eligibleLots: any[] = [];
  const ineligibleLots: IneligibleLotInfo[] = [];

  for (const lot of lots) {
    const remQty = parseFloat(lot.remaining_qty);
    if (remQty <= 0) continue;

    // Check Expiry
    if (lot.expiry_date && lot.expiry_date < today) {
      ineligibleLots.push({
        lotId: lot.id,
        lotNumber: lot.lot_number,
        supplierBatch: lot.supplier_batch_number,
        remainingQty: remQty,
        reason: `Expired on ${lot.expiry_date}`
      });
      continue;
    }

    // Check Quarantined / Blocked status
    if (lot.status === 'QUARANTINED') {
      ineligibleLots.push({
        lotId: lot.id,
        lotNumber: lot.lot_number,
        supplierBatch: lot.supplier_batch_number,
        remainingQty: remQty,
        reason: 'Lot is currently QUARANTINED'
      });
      continue;
    }
    if (lot.status === 'BLOCKED') {
      ineligibleLots.push({
        lotId: lot.id,
        lotNumber: lot.lot_number,
        supplierBatch: lot.supplier_batch_number,
        remainingQty: remQty,
        reason: 'Lot is BLOCKED by Storekeeper/Admin'
      });
      continue;
    }

    // Check Unresolved Opening Stock Sequence Flag
    if (lot.is_opening_stock && lot.fifo_order_index === -1 && !allowOpeningStockReviewOverride) {
      ineligibleLots.push({
        lotId: lot.id,
        lotNumber: lot.lot_number,
        supplierBatch: lot.supplier_batch_number,
        remainingQty: remQty,
        reason: 'Unresolved opening stock order requires admin FIFO review'
      });
      continue;
    }

    eligibleLots.push(lot);
  }

  let remainingToAllocate = requiredQty;
  const allocations: FIFOAllocationProposal[] = [];
  let totalAllocatedValue = 0;

  for (const lot of eligibleLots) {
    if (remainingToAllocate <= 0) break;

    const available = parseFloat(lot.remaining_qty);
    const take = Math.min(remainingToAllocate, available);
    const remainingAfter = available - take;
    const rate = lot.rate_per_unit != null ? parseFloat(lot.rate_per_unit) : null;
    const val = rate != null ? Math.round(take * rate * 100) / 100 : null;

    allocations.push({
      lotId: lot.id,
      lotNumber: lot.lot_number,
      supplierBatch: lot.supplier_batch_number,
      billNumber: lot.bill_number,
      actualReceivedAt: lot.actual_received_at,
      availableQty: available,
      allocatedQty: take,
      remainingAfter: Math.round(remainingAfter * 10000) / 10000,
      ratePerUnit: rate,
      allocationValue: val,
      isOpeningStock: Boolean(lot.is_opening_stock),
      location: lot.location || null
    });

    if (val != null) {
      totalAllocatedValue += val;
    }
    remainingToAllocate -= take;
  }

  const totalAllocatedQty = requiredQty - Math.max(0, remainingToAllocate);
  const shortageQty = Math.max(0, remainingToAllocate);

  return {
    allocations,
    totalAllocatedQty: Math.round(totalAllocatedQty * 10000) / 10000,
    totalAllocatedValue: Math.round(totalAllocatedValue * 100) / 100,
    isFullyAllocated: shortageQty === 0,
    shortageQty: Math.round(shortageQty * 10000) / 10000,
    ineligibleLots
  };
}
