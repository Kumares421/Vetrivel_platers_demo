import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const db = new Database('data/test_checkpoint.sqlite');

const hashAdmin = bcrypt.hashSync('admin123', 10);
const hashSuper = bcrypt.hashSync('superadmin123', 10);
const hashStaff = bcrypt.hashSync('staff123', 10);

// Check current users
const currentUsers = db.prepare("SELECT * FROM users").all();
console.log('Current users before:', currentUsers.map((u: any) => ({ email: u.email, role: u.role })));

// Migrate existing 3 accounts
if (currentUsers.length === 3) {
  db.prepare("UPDATE users SET email = 'superadmin@vetrivel.com', name = 'Vetrivel Super Admin', role = 'SUPER_ADMIN', password_hash = ? WHERE id = ?")
    .run(hashSuper, currentUsers[0].id);

  db.prepare("UPDATE users SET email = 'admin@vetrivel.com', name = 'Plant Admin', role = 'ADMIN', password_hash = ? WHERE id = ?")
    .run(hashAdmin, currentUsers[1].id);

  db.prepare("UPDATE users SET email = 'staff@vetrivel.com', name = 'Production Staff', role = 'STAFF', password_hash = ? WHERE id = ?")
    .run(hashStaff, currentUsers[2].id);
}

const updatedUsers = db.prepare("SELECT id, email, name, role, is_active FROM users").all();
console.log('Updated users after:', updatedUsers);
