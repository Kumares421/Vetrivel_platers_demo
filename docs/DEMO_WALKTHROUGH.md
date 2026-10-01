# VETRIVEL PLATERS ERP — FACTORY OWNER DEMO & UAT WALKTHROUGH

This document provides a guided walkthrough for the factory owner to demonstrate the complete, end-to-end industrial electroplating workflow using the **isolated demo dataset** (`data/demo_factory.sqlite`).

---

## 🚀 How to Launch the Demo Environment

### 1. Seed or Reset the Demo Dataset
```bash
# Seed the demo dataset into data/demo_factory.sqlite (guaranteed zero production DB pollution)
npm run demo:seed

# Or to perform a clean database wipe:
npm run demo:reset
```

### 2. Start the Local Server with Demo Database
On Windows PowerShell:
```powershell
$env:SQLITE_DB_PATH="demo_factory.sqlite"; npm run dev
```

On Linux / macOS:
```bash
SQLITE_DB_PATH="demo_factory.sqlite" npm run dev
```

Open your browser at: **[http://localhost:3000](http://localhost:3000)**

---

## 🔑 Login Accounts

| Role | Username / Email | Password | What to Demonstrate |
|---|---|---|---|
| **Super Admin** | `superadmin@vetrivel.com` | `superadmin123` | Complete visibility across plant operations, settings, and full traceability |
| **Plant Manager (Admin)** | `admin@vetrivel.com` | `admin123` | Order confirmation, planning schedule, cancellation & audit authorization |
| **Floor Supervisor (Staff)** | `staff@vetrivel.com` | `staff123` | Parts inward receipt, production execution runs, QC recording, dispatch generation |

---

## 🏭 13-Step Factory Owner Demonstration Flow

### Step 1: Login
- Log in as **Plant Manager** (`admin@vetrivel.com` / `admin123`).
- **Concept**: Strict Three-Account Role-Based Access Control (RBAC) ensures segregation of duties between management, administration, and shop floor operations.

### Step 2: Customer Master
- Navigate to **Customers**.
- View **ABC Auto Components Pvt Ltd** (`33DEMOABC1234F1Z5`), **XYZ Engineering Industries**, and **Sri Murugan Components**.
- **Concept**: Centralized GST-compliant customer master directory.

### Step 3: Customer Order (`CO-DEMO-001`)
- Navigate to **Customer Orders**.
- Open order **`CO-DEMO-001`** (Customer PO: `ABC/PO/2026/001`).
- Notice the line item: **100 pcs** of **`BRK-001` (Automotive Brake Bracket)** @ **₹250.00/pc** (Total: ₹25,000.00).
- Status is **CONFIRMED**, unlocking downstream parts inward.

### Step 4: Customer Parts Inward (`INW-DEMO-001`)
- Navigate to **Parts Inward**.
- Open inward **`INW-DEMO-001`** (Challan: `DC-ABC-9901`).
- **Key Observation**:
  - Received: **100 pcs**
  - Accepted: **98 pcs**
  - Rejected: **2 pcs** (Reason: *Physical damage / surface defect*)
  - Pending Order Balance: **0 pcs**
- **Concept**: Strict incoming material verification prevents flawed customer raw forgings from entering the plating line.

### Step 5: Job Card Creation (`JC-DEMO-001`)
- Navigate to **Job Cards**.
- Select **`JC-DEMO-001`**.
- Notice:
  - Allocated Quantity: **98 pcs** (strictly matches accepted inward quantity).
  - Target Plating Thickness: **8.0 microns**.
  - Tank Assignment: **`TANK-ZN-01` (Zinc Cyanide Bath 1)**.
  - Priority: **URGENT / HIGH**.

### Step 6: Production Planning & Workboard
- Navigate to **Production Planning** on the top navigation bar.
- Review the Top KPI cards:
  - Ready, Planned Today, In Queue, In Production, Urgent, Overdue, Pending Qty.
- Find **`JC-DEMO-001`**:
  - Status: **PLANNED** (Schedule: 2026-10-02 08:30).
  - Priority Badge: **HIGH**.
  - Planned Notes: *"Priority customer order — complete before scheduled dispatch."*
- Click **Actions → View Details** or **Open Traceability**.

### Step 7: Chemical Stores & Chronological FIFO Issue
- Navigate to **Chemical Store** & **Chemical Issues**.
- Review chemical **Zinc Cyanide Salt (`CHEM-ZN-01`)**:
  - **Lot A** (`LOT-DEMO-ZN-01`, received 2026-09-01): Original 100 kg.
  - **Lot B** (`LOT-DEMO-ZN-02`, received 2026-09-15): Original 150 kg.
- Open Issue **`ISS-DEMO-001`** (15 kg drawn for Bath 1):
  - Consumed strictly from **Lot A** (oldest eligible stock).
  - Lot A remaining quantity is **85 kg**; Lot B remains **150 kg** untouched.
- Review Issue **`ISS-DEMO-002`** for Nickel Sulfate:
  - Multi-lot split: **80 kg from Lot A (EXHAUSTED)** + **15 kg from Lot B (105 kg remaining)**.
- **Concept**: Frozen FIFO contract (`actual_received_at ASC → created_at ASC → id ASC`) ensures older chemicals are never stranded in stores.

### Step 8: Production Execution (`PRD-DEMO-001`)
- Navigate to **Production Execution**.
- Open execution **`PRD-DEMO-001`**:
  - Linked to Job Card **`JC-DEMO-001`** on **`TANK-ZN-01`**.
  - Planned: **98 pcs** | Processed: **98 pcs**.
  - Started: `08:30:00` | Completed: `12:45:00`.
  - Status: **COMPLETED**.
- **Concept**: Production execution remains the sole authoritative source of truth for actual physical floor output.

### Step 9: Quality Control Inspection (`QC-DEMO-001`)
- Navigate to **Quality Control**.
- Open inspection **`QC-DEMO-001`**:
  - Inspected: **98 pcs**.
  - Accepted / Passed: **95 pcs** (Measured thickness: 8.2 microns vs 8.0 target).
  - Rejected: **3 pcs** (Visual defect: *PEELING* / minor edge blister).
  - Verdict: **PASS**.
- **Concept**: Strict QC pass/fail gating ensures only certified pieces are eligible for customer dispatch.

### Step 10: Finished Goods Dispatch (`DSP-DEMO-001`)
- Navigate to **Dispatch**.
- Open dispatch **`DSP-DEMO-001`**:
  - Dispatched Quantity: **95 pcs** (strictly matches QC passed quantity).
  - Vehicle Number: **`TN-XX-1234`** | Transporter: **Demo Logistics**.
  - Delivery Challan: **`DC-DEMO-001`**.
  - Customer: **ABC Auto Components Pvt Ltd**.

### Step 11: Tax Invoice & Billing (`INV-DEMO-001`)
- Navigate to **Invoices**.
- Open invoice **`INV-DEMO-001`**:
  - 95 pcs @ ₹250.00 = Taxable Value: **₹23,750.00**.
  - CGST (9%): **₹2,137.50** | SGST (9%): **₹2,137.50**.
  - Total GST: **₹4,275.00** | Grand Total: **₹28,025.00**.
  - Status: **ISSUED**.
- **Concept**: Automated GST calculation using dispatch line items and place-of-supply tax logic.

### Step 12: Customer Payment & Settlement Allocation (`PAY-DEMO-001`)
- Navigate to **Payments**.
- Open payment **`PAY-DEMO-001`**:
  - Payment Amount: **₹20,000.00** (Bank Transfer / NEFT).
  - Allocated against **`INV-DEMO-001`**: **₹20,000.00**.
  - Remaining Invoice Outstanding: **₹8,025.00**.
- Compare with **`INV-DEMO-002`** (Customer XYZ):
  - Total: ₹7,080.00 | Paid: ₹7,080.00 | Outstanding: **₹0.00 (PAID)**.

### Step 13: End-to-End Traceability Hub
- Navigate to **Traceability**.
- Search for order **`CO-DEMO-001`** or Job Card **`JC-DEMO-001`**.
- View the unified 8-stage interactive tree:
  ```
  Customer Order (CO-DEMO-001)
    └── Parts Inward (INW-DEMO-001)
         └── Job Card (JC-DEMO-001)
              └── Production (PRD-DEMO-001)
                   └── QC Inspection (QC-DEMO-001)
                        └── Dispatch (DSP-DEMO-001)
                             └── Tax Invoice (INV-DEMO-001)
                                  └── Payment Settlement (PAY-DEMO-001)
  ```
- **Concept**: Instant recall and forensic audit capability for OEM customer audits.

---

## 🔒 Production Database Safety Guarantee

The production database is located at:
```text
data/qelanto_factory.sqlite
```
All demo and UAT operations run exclusively on `data/demo_factory.sqlite`. The seed and reset scripts are hard-coded with abort checks that instantly reject any execution targeting `qelanto_factory.sqlite`.
