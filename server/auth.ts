import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';

const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  return process.env.SESSION_SECRET || EPHEMERAL_FALLBACK_SECRET;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export interface TokenPayload {
  sub: string;
  role: 'user' | 'admin';
  exp: number;
}

export function signSessionToken(userId: string, role: 'user' | 'admin'): string {
  const payload: TokenPayload = {
    sub: userId,
    role,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!decoded.sub || decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  role: 'user' | 'admin';
  countryCode: string;
  languageCode: string;
  timezone: string;
  consentAccepted: boolean;
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
}

export function loadUserById(userId: string): AuthenticatedUser | null {
  const row = db
    .prepare(
      `SELECT id, email, phone, role, country_code, language_code, timezone, consent_accepted, is_active, deleted_at
       FROM users WHERE id = ?`
    )
    .get(userId) as
    | {
        id: string;
        email: string | null;
        phone: string | null;
        role: 'user' | 'admin';
        country_code: string;
        language_code: string;
        timezone: string;
        consent_accepted: number;
        is_active: number;
        deleted_at: string | null;
      }
    | undefined;

  if (!row || !row.is_active || row.deleted_at) return null;

  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    role: row.role,
    countryCode: row.country_code,
    languageCode: row.language_code,
    timezone: row.timezone,
    consentAccepted: Boolean(row.consent_accepted),
  };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
  const user = loadUserById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: 'Account unavailable' });
  }
  req.authUser = user;
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.authUser?.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator privileges required' });
    }
    next();
  });
}

export function isAdminConfigured(): {
  hasEnvPasscode: boolean;
  hasClaimedAdmin: boolean;
} {
  const hasEnvPasscode = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
  const claimedRow = db
    .prepare(`SELECT value FROM admin_config WHERE key = 'admin_passcode_hash'`)
    .get() as { value: string } | undefined;
  return {
    hasEnvPasscode,
    hasClaimedAdmin: Boolean(claimedRow),
  };
}

export function verifyAdminPasscode(passcode: string): boolean {
  const envCode = process.env.ADMIN_PASSCODE?.trim();
  if (envCode && envCode.length > 0) {
    const a = Buffer.from(passcode);
    const b = Buffer.from(envCode);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const claimedRow = db
    .prepare(`SELECT value FROM admin_config WHERE key = 'admin_passcode_hash'`)
    .get() as { value: string } | undefined;
  if (!claimedRow) return false;
  return verifyPassword(passcode, claimedRow.value);
}

export function claimFirstAdminPasscode(passcode: string): boolean {
  if (process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0) {
    return false;
  }
  const existing = db
    .prepare(`SELECT value FROM admin_config WHERE key = 'admin_passcode_hash'`)
    .get();
  if (existing) return false;

  const hash = hashPassword(passcode);
  db.prepare(
    `INSERT INTO admin_config (key, value) VALUES ('admin_passcode_hash', ?)`
  ).run(hash);
  return true;
}
