import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db';

export const JWT_SECRET = process.env.JWT_SECRET || 'vetrivel-platers-qelanto-secret-key-2026';

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'STOREKEEPER' | 'READONLY';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  token?: string;
  body: any;
  query: any;
  params: any;
  file?: any;
}

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUser;

    // Check if token is in revoked_tokens table
    try {
      const revoked = await query('SELECT token FROM revoked_tokens WHERE token = ?', [token]);
      if (revoked.rows.length > 0) {
        return res.status(401).json({ error: 'Session has been revoked or logged out. Please log in again.' });
      }
    } catch (e) {
      // Table may not exist yet during boot
    }

    // Verify user is still active in database
    try {
      const userRes = await query('SELECT is_active, role FROM users WHERE id = ?', [decoded.id]);
      if (userRes.rows.length === 0 || !userRes.rows[0].is_active) {
        return res.status(401).json({ error: 'User account has been deactivated or removed.' });
      }
      decoded.role = userRes.rows[0].role; // keep role current
    } catch (e) {
      // Database query failure fallback to token decoded
    }

    req.user = decoded;
    req.token = token;
    return next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(403).json({ error: 'Invalid or expired authentication token' });
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const userRole = req.user.role;

    // Super Admin has access to all roles
    if (userRole === 'SUPER_ADMIN') {
      return next();
    }

    // Admin has access if ADMIN, STAFF, STOREKEEPER, or READONLY is allowed
    if (userRole === 'ADMIN' && (allowedRoles.includes('ADMIN') || allowedRoles.includes('STAFF') || allowedRoles.includes('STOREKEEPER') || allowedRoles.includes('READONLY'))) {
      return next();
    }

    // Staff / Storekeeper access
    if ((userRole === 'STAFF' || userRole === 'STOREKEEPER') && (allowedRoles.includes('STAFF') || allowedRoles.includes('STOREKEEPER') || allowedRoles.includes('READONLY'))) {
      return next();
    }

    // Direct match check
    if (allowedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({ 
      error: `Access denied. Action requires one of the following roles: ${allowedRoles.join(', ')}` 
    });
  };
}
