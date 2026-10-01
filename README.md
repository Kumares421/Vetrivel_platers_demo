# Vetrivel Platers - Chemical Stores & FIFO Dispatch Portal

A full-stack industrial chemical stores management system featuring batch receipt tracking, strict FIFO (First-In, First-Out) dispatch allocation, historical stock ledgers, and automated low-stock and expiry monitoring.

---

## System Requirements

- **Operating System**: Windows 10/11 (or macOS / Linux)
- **Node.js**: Version 18.0.0 or higher ([Download Node.js](https://nodejs.org/))
- **Browser**: Google Chrome, Microsoft Edge, or Firefox

---

## Quick Start (Windows)

1. Extract `Vetrivel_Platers_Demo.zip` to any folder on your computer.
2. Double-click **`start_demo.bat`**.
3. The script will automatically install missing npm dependencies and start both the backend server and frontend client.
4. Open your browser and navigate to: **`http://localhost:3000`**

---

## Manual Command Line Startup

If you prefer starting from a terminal:

```bash
# 1. Install dependencies
npm install

# 2. Start dev server (Express backend on port 5000 + Vite frontend on port 3000)
npm run dev
```

---

## Initial Database Setup & Administrator Accounts

On the very first launch, the app automatically initializes a clean local SQLite database (`data/qelanto_factory.sqlite`) with full table schemas and seeds initial access credentials.

### Default Login Credentials

| Role | Email | Password |
| :--- | :--- | :--- |
| **System Admin** | `admin@vetrivel.com` | `admin123` |
| **Store Manager** | `storekeeper@vetrivel.com` | `storekeeper123` |
| **Plant Auditor** | `auditor@vetrivel.com` | `auditor123` |

### Creating Additional Admin Accounts

1. Log in using the default administrator account (`admin@vetrivel.com`).
2. Navigate to **Settings** -> **User Management** in the top navigation bar.
3. Click **Add User**, enter the user details, and assign the **Admin** role.

---

## Core Features & Workflow

1. **Chemical Master**: Manage chemical codes, base units, and minimum safety stock levels.
2. **Inward Receipts**: Receive chemical batches with invoice details, unit costs, and expiry dates. Automatically generates unique Lot Numbers (e.g. `LOT-20260924-0001`).
3. **Tank Issue Engine**: Enforces strict FIFO allocation. When issuing chemicals to production tanks, the engine automatically draws from the oldest available lots first.
4. **Historical Stock Ledger**: View date-rangeOpening, Receipts, Issues, Adjustments, and Closing balances per chemical.
5. **Low Stock & Expiry Register**: Monitors chemicals below minimum safety stock levels and flags lots expiring within 30 days or already expired.
6. **System Backups & Seed**: Backup/restore application data or reset test transactions under **Settings** -> **System Backups & Seed**.

---

## Technical Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons, Vite
- **Backend**: Express.js, TypeScript, better-sqlite3 (SQLite DB engine)
- **Authentication**: JWT (JSON Web Tokens) + bcrypt password hashing
