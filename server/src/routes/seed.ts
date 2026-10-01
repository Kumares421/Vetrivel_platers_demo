import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

// POST /api/seed/demo-data (Admin only)
router.post('/demo-data', authenticateToken, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    // 1. Seed Chemicals
    const chems = [
      { code: 'CHEM-NIC-001', name: 'Nickel Sulfate Hexahydrate', unit: 'kg', min: 100, desc: 'High-purity grade for nickel plating bath' },
      { code: 'CHEM-CHR-002', name: 'Chromic Acid Flakes', unit: 'kg', min: 50, desc: 'Technical grade for decorative chrome plating' },
      { code: 'CHEM-CYA-003', name: 'Sodium Cyanide Solution', unit: 'L', min: 200, desc: 'Alkaline copper plating bath liquid' },
      { code: 'CHEM-BRT-004', name: 'Duplex Nickel Brightener A', unit: 'L', min: 25, desc: 'Organic additive for mirror finish' },
      { code: 'CHEM-ZNC-005', name: 'Zinc Chloride Anhydrous', unit: 'kg', min: 75, desc: 'Acid zinc plating salt' },
      { code: 'CHEM-AN-006', name: 'Nickel Anode S-Rounds', unit: 'nos', min: 500, desc: 'Primary anode pieces for titanium baskets' },
    ];

    const chemIds: Record<string, string> = {};

    for (const c of chems) {
      const existing = await query('SELECT id FROM chemicals WHERE code = ?', [c.code]);
      if (existing.rows.length === 0) {
        const id = uuidv4();
        await query(
          `INSERT INTO chemicals (id, code, name, base_unit, min_stock_level, is_active, description)
           VALUES (?, ?, ?, ?, ?, true, ?)`,
          [id, c.code, c.name, c.unit, c.min, c.desc]
        );
        chemIds[c.code] = id;
      } else {
        chemIds[c.code] = existing.rows[0].id;
      }
    }

    // 2. Seed Suppliers
    const supps = [
      { name: 'ChemTech Specialities India Pvt Ltd', contact: '+91 98400 12345 / sales@chemtech.co.in', addr: 'Plot 42, Ambattur Industrial Estate, Chennai' },
      { name: 'Apex Metal Finishers & Chemicals', contact: '+91 94440 67890 / info@apexfinishers.com', addr: 'SIPCOT Industrial Park, Sriperumbudur' },
      { name: 'Vanguard Industrial Solvents', contact: '+91 91760 99999 / order@vanguard.in', addr: 'Guindy Industrial Estate, Chennai' },
    ];

    const suppIds: string[] = [];
    for (const s of supps) {
      const existing = await query('SELECT id FROM suppliers WHERE name = ?', [s.name]);
      if (existing.rows.length === 0) {
        const id = uuidv4();
        await query(
          `INSERT INTO suppliers (id, name, contact_details, address, is_active)
           VALUES (?, ?, ?, ?, true)`,
          [id, s.name, s.contact, s.addr]
        );
        suppIds.push(id);
      } else {
        suppIds.push(existing.rows[0].id);
      }
    }

    // 3. Seed Tanks
    const tanks = [
      { code: 'TANK-NKL-01', name: 'Tank 1 - Semi-Bright Nickel Bath (3000L)' },
      { code: 'TANK-NKL-02', name: 'Tank 2 - Bright Nickel Bath (4500L)' },
      { code: 'TANK-CHR-01', name: 'Tank 3 - Hard Chrome Bath (2000L)' },
      { code: 'TANK-ZNC-01', name: 'Tank 4 - Acid Zinc Rack Line (5000L)' },
      { code: 'DEPT-PRE-TREAT', name: 'Pre-Treatment & Degreasing Line' },
    ];

    for (const t of tanks) {
      const existing = await query('SELECT id FROM tanks WHERE code = ?', [t.code]);
      if (existing.rows.length === 0) {
        await query(
          `INSERT INTO tanks (id, code, display_name, is_active)
           VALUES (?, ?, ?, true)`,
          [uuidv4(), t.code, t.name]
        );
      }
    }

    // 4. Seed Receipt Lots (Multiple Lots for FIFO Demonstration)
    const today = new Date();
    const date1 = new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString(); // 15 days ago
    const date2 = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();  // 5 days ago
    const date3 = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();  // 1 day ago

    const nickelId = chemIds['CHEM-NIC-001'];
    const chromeId = chemIds['CHEM-CHR-002'];
    const cyanId = chemIds['CHEM-CYA-003'];

    if (nickelId && suppIds[0]) {
      // Lot A (Older, cheaper)
      const lotAId = uuidv4();
      await query(
        `INSERT INTO receipt_lots (
          id, lot_number, chemical_id, supplier_batch_number, initial_qty, remaining_qty,
          rate_per_unit, line_amount, location, expiry_date, status, actual_received_at, is_opening_stock
        ) VALUES (?, 'LOT-DEMO-NIC-01', ?, 'BATCH-NIC-2026-A1', 150, 50, 180.00, 27000.00, 'RACK-A-01', '2027-06-30', 'AVAILABLE', ?, false)`,
        [lotAId, nickelId, date1]
      );

      // Lot B (Newer, slightly higher price)
      const lotBId = uuidv4();
      await query(
        `INSERT INTO receipt_lots (
          id, lot_number, chemical_id, supplier_batch_number, initial_qty, remaining_qty,
          rate_per_unit, line_amount, location, expiry_date, status, actual_received_at, is_opening_stock
        ) VALUES (?, 'LOT-DEMO-NIC-02', ?, 'BATCH-NIC-2026-B2', 200, 200, 195.00, 39000.00, 'RACK-A-02', '2027-09-30', 'AVAILABLE', ?, false)`,
        [lotBId, nickelId, date2]
      );
    }

    if (chromeId && suppIds[1]) {
      const lotCId = uuidv4();
      await query(
        `INSERT INTO receipt_lots (
          id, lot_number, chemical_id, supplier_batch_number, initial_qty, remaining_qty,
          rate_per_unit, line_amount, location, expiry_date, status, actual_received_at, is_opening_stock
        ) VALUES (?, 'LOT-DEMO-CHR-01', ?, 'BATCH-CHR-990', 80, 80, 420.00, 33600.00, 'RACK-B-01', '2027-12-31', 'AVAILABLE', ?, false)`,
        [lotCId, chromeId, date2]
      );
    }

    if (cyanId && suppIds[2]) {
      const lotDId = uuidv4();
      await query(
        `INSERT INTO receipt_lots (
          id, lot_number, chemical_id, supplier_batch_number, initial_qty, remaining_qty,
          rate_per_unit, line_amount, location, expiry_date, status, actual_received_at, is_opening_stock
        ) VALUES (?, 'LOT-DEMO-CYA-01', ?, 'BATCH-CYA-441', 300, 300, 85.00, 25500.00, 'HAZARD-STORE-01', '2027-03-31', 'AVAILABLE', ?, false)`,
        [lotDId, cyanId, date3]
      );
    }

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'DEMO_DATA_SEEDED',
      recordRef: 'system/demo-seed',
      reason: 'Seeded sample demo data for Vetrivel Platers',
    });

    return res.json({ message: 'Demo sample data seeded successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
