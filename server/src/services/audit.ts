import { query } from '../db';
import { v4 as uuidv4 } from 'uuid';

export async function logAuditEvent(params: {
  userId?: string;
  userEmail?: string;
  action: string;
  recordRef: string;
  changedValues?: any;
  reason?: string;
}) {
  try {
    const id = uuidv4();
    const changedJson = params.changedValues ? JSON.stringify(params.changedValues) : null;
    await query(
      `INSERT INTO audit_events (id, user_id, user_email, action, record_ref, changed_values, reason, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        id,
        params.userId || null,
        params.userEmail || null,
        params.action,
        params.recordRef,
        changedJson,
        params.reason || null
      ]
    );
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
}
