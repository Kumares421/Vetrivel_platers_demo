import { query, initDb } from './db';

async function resetDemoState() {
  await initDb();
  console.log('=== Cleaning up test data & resetting DEMO-001 and DEMO-002 lots ===');

  // 1. Remove extra issues and allocations on CHEM-NIC-001
  await query(`DELETE FROM fifo_allocations WHERE chemical_issue_id IN (SELECT id FROM chemical_issues WHERE chemical_id = '984b414c-379f-4e76-b028-e727eb804e42')`);
  await query(`DELETE FROM stock_movements WHERE chemical_id = '984b414c-379f-4e76-b028-e727eb804e42' AND reference_type = 'CHEMICAL_ISSUE'`);
  await query(`DELETE FROM chemical_issues WHERE chemical_id = '984b414c-379f-4e76-b028-e727eb804e42'`);

  // 2. Remove extra test receipts
  await query(`DELETE FROM stock_movements WHERE reference_id IN (SELECT id FROM purchase_receipts WHERE receipt_number = 'REC-20260923-0004')`);
  await query(`DELETE FROM receipt_lots WHERE purchase_receipt_id IN (SELECT id FROM purchase_receipts WHERE receipt_number = 'REC-20260923-0004')`);
  await query(`DELETE FROM purchase_receipts WHERE receipt_number = 'REC-20260923-0004'`);

  // 3. Restore DEMO-002 receipt (REC-20260923-0003) to POSTED with initial uncorrected timestamp 2026-09-24T19:54:00
  await query(`DELETE FROM stock_movements WHERE receipt_lot_id = '76a224c0-e383-477b-ae37-385e25669afa' AND movement_type = 'REVERSED'`);
  await query(`DELETE FROM stock_movements WHERE receipt_lot_id = '76a224c0-e383-477b-ae37-385e25669afa' AND movement_type = 'REVERSAL_RECEIPT'`);
  await query(`UPDATE purchase_receipts SET status = 'POSTED', actual_received_at = '2026-09-24T19:54:00' WHERE id = '5a1fa6a8-5b10-4d17-942b-3da03c17257a'`);
  await query(`UPDATE receipt_lots SET status = 'AVAILABLE', remaining_qty = 15, actual_received_at = '2026-09-24T19:54:00' WHERE id = '76a224c0-e383-477b-ae37-385e25669afa'`);
  await query(`UPDATE stock_movements SET movement_date = '2026-09-24T19:54:00' WHERE receipt_lot_id = '76a224c0-e383-477b-ae37-385e25669afa' AND movement_type = 'RECEIPT'`);

  // 4. Restore DEMO-001 receipt (REC-20260923-0002) to POSTED with timestamp 2026-09-23T19:51:00
  await query(`UPDATE purchase_receipts SET status = 'POSTED', actual_received_at = '2026-09-23T19:51:00' WHERE id = 'ce4768b2-9fed-43d2-b91c-04c2f0ee1254'`);
  await query(`UPDATE receipt_lots SET status = 'AVAILABLE', remaining_qty = 20, actual_received_at = '2026-09-23T19:51:00' WHERE id = 'cd9ccc3f-95aa-41c8-aea2-0092a47d9db4'`);

  // 5. Clean reversals table for clean state
  await query(`DELETE FROM reversals WHERE original_id = '5a1fa6a8-5b10-4d17-942b-3da03c17257a'`);

  console.log('Database state reset successfully!');
  process.exit(0);
}

resetDemoState().catch(err => {
  console.error(err);
  process.exit(1);
});
