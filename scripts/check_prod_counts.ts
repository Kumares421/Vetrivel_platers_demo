import Database from 'better-sqlite3';

const db = new Database('data/qelanto_factory.sqlite', { readonly: true });
const tables = [
  'chemicals',
  'purchase_receipts',
  'receipt_lots',
  'chemical_issues',
  'stock_movements',
  'fifo_allocations',
  'users',
  'customer_orders',
  'customer_order_items',
  'customer_parts_inward',
  'job_cards',
  'production_plans',
  'production_executions',
  'qc_inspections',
  'dispatches',
  'invoices',
  'invoice_lines',
  'payments',
  'payment_allocations'
];

console.log('=== PRODUCTION DATABASE AUTHORITATIVE COUNTS ===');
for (const t of tables) {
  try {
    const row = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number };
    console.log(`${t.padEnd(25)} : ${row.c}`);
  } catch (err: any) {
    console.log(`${t.padEnd(25)} : TABLE NOT FOUND (${err.message})`);
  }
}
db.close();
