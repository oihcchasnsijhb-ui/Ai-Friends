import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = path.resolve(process.cwd(), '.data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'dilse.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS countries (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD')),
      tax_name TEXT NOT NULL,
      tax_rate_percent REAL NOT NULL DEFAULT 0,
      gateway TEXT NOT NULL CHECK (gateway IN ('razorpay', 'stripe')),
      is_supported INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS languages (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      native_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      country_code TEXT NOT NULL DEFAULT 'US',
      language_code TEXT NOT NULL DEFAULT 'en',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      consent_accepted INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS voice_profiles (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      gender TEXT NOT NULL CHECK (gender IN ('female', 'male')),
      provider_voice_name TEXT NOT NULL,
      tagline TEXT NOT NULL,
      personality_prompt TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      preferred_voice_id TEXT REFERENCES voice_profiles(id),
      preferred_mode TEXT NOT NULL DEFAULT 'friendship',
      bio_notes TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      minutes INTEGER NOT NULL CHECK (minutes >= 15),
      inr_price_paise INTEGER NOT NULL CHECK (inr_price_paise > 0),
      usd_price_cents INTEGER NOT NULL CHECK (usd_price_cents > 0),
      region_scope TEXT NOT NULL DEFAULT 'global' CHECK (region_scope IN ('india', 'international', 'global')),
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pricing_rules (
      id TEXT PRIMARY KEY,
      country_code TEXT UNIQUE NOT NULL REFERENCES countries(code),
      currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD')),
      min_minutes INTEGER NOT NULL DEFAULT 15 CHECK (min_minutes >= 15),
      tax_rate_percent REAL NOT NULL DEFAULT 0,
      discount_percent REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      paid_seconds INTEGER NOT NULL DEFAULT 0 CHECK (paid_seconds >= 0),
      trial_seconds INTEGER NOT NULL DEFAULT 120 CHECK (trial_seconds >= 0),
      total_purchased_seconds INTEGER NOT NULL DEFAULT 0,
      total_used_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      package_id TEXT NOT NULL REFERENCES packages(id),
      gateway TEXT NOT NULL CHECK (gateway IN ('razorpay', 'stripe', 'apple_iap', 'google_play')),
      currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD')),
      subtotal_minor INTEGER NOT NULL,
      tax_minor INTEGER NOT NULL,
      total_minor INTEGER NOT NULL,
      minutes INTEGER NOT NULL CHECK (minutes >= 15),
      idempotency_key TEXT UNIQUE NOT NULL,
      gateway_order_id TEXT,
      gateway_payment_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'refunded')),
      refund_reason TEXT,
      refunded_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('credit_purchase', 'debit_usage', 'refund_reversal', 'admin_adjustment')),
      seconds_delta INTEGER NOT NULL,
      balance_after_seconds INTEGER NOT NULL,
      reference_id TEXT,
      description TEXT NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      voice_id TEXT NOT NULL REFERENCES voice_profiles(id),
      mode TEXT NOT NULL CHECK (mode IN ('live_call', 'voice_message', 'text_chat')),
      conversation_style TEXT NOT NULL,
      language_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'terminated_zero_balance')),
      billed_seconds INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('user', 'ai', 'system')),
      content TEXT NOT NULL,
      audio_duration_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT UNIQUE NOT NULL,
      seconds_deducted INTEGER NOT NULL CHECK (seconds_deducted > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_otps (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_country ON users(country_code);
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user_id, created_at);
  `);

  seedInitialData();
}

function seedInitialData() {
  const countryCount = (db.prepare('SELECT COUNT(*) as c FROM countries').get() as { c: number }).c;
  if (countryCount === 0) {
    const insertCountry = db.prepare(
      'INSERT INTO countries (code, name, currency, tax_name, tax_rate_percent, gateway, is_supported) VALUES (?, ?, ?, ?, ?, ?, 1)'
    );
    const countries: Array<[string, string, 'INR' | 'USD', string, number, 'razorpay' | 'stripe']> = [
      ['IN', 'India', 'INR', 'GST', 18.0, 'razorpay'],
      ['US', 'United States', 'USD', 'Estimated Sales Tax', 0.0, 'stripe'],
      ['GB', 'United Kingdom', 'USD', 'VAT', 20.0, 'stripe'],
      ['CA', 'Canada', 'USD', 'GST/HST', 5.0, 'stripe'],
      ['AE', 'United Arab Emirates', 'USD', 'VAT', 5.0, 'stripe'],
      ['SG', 'Singapore', 'USD', 'GST', 9.0, 'stripe'],
      ['AU', 'Australia', 'USD', 'GST', 10.0, 'stripe'],
      ['DE', 'Germany', 'USD', 'VAT', 19.0, 'stripe'],
      ['JP', 'Japan', 'USD', 'Consumption Tax', 10.0, 'stripe'],
    ];
    for (const c of countries) {
      insertCountry.run(...c);
    }

    const insertRule = db.prepare(
      'INSERT INTO pricing_rules (id, country_code, currency, min_minutes, tax_rate_percent, discount_percent) VALUES (?, ?, ?, 15, ?, 0)'
    );
    for (const c of countries) {
      insertRule.run(crypto.randomUUID(), c[0], c[2], c[4]);
    }
  }

  const insertLang = db.prepare(
    'INSERT OR IGNORE INTO languages (code, name, native_name, is_active, sort_order) VALUES (?, ?, ?, 1, ?)'
  );
  const langs: Array<[string, string, string, number]> = [
    ['en', 'English', 'English', 1],
    ['hi', 'Hindi', 'हिन्दी', 2],
    ['hinglish', 'Hinglish', 'Hinglish', 3],
    ['bho', 'Bhojpuri', 'भोजपुरी', 4],
    ['ur', 'Urdu', 'اردو', 5],
    ['pa', 'Punjabi', 'ਪੰਜਾਬੀ', 6],
    ['bn', 'Bengali', 'বাংলা', 7],
    ['mr', 'Marathi', 'मराठी', 8],
    ['gu', 'Gujarati', 'ગુજરાતી', 9],
    ['ta', 'Tamil', 'தமிழ்', 10],
    ['te', 'Telugu', 'తెలుగు', 11],
    ['kn', 'Kannada', 'ಕನ್ನಡ', 12],
    ['ml', 'Malayalam', 'മലയാളം', 13],
    ['es', 'Spanish', 'Español', 14],
    ['fr', 'French', 'Français', 15],
    ['ar', 'Arabic', 'العربية', 16],
    ['de', 'German', 'Deutsch', 17],
    ['pt', 'Portuguese', 'Português', 18],
    ['ja', 'Japanese', '日本語', 19],
    ['ko', 'Korean', '한국어', 20],
  ];
  for (const l of langs) {
    insertLang.run(...l);
  }

  const voiceCount = (db.prepare('SELECT COUNT(*) as c FROM voice_profiles').get() as { c: number }).c;
  if (voiceCount === 0) {
    const insertVoice = db.prepare(
      'INSERT INTO voice_profiles (id, slug, name, gender, provider_voice_name, tagline, personality_prompt, avatar_url, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
    );
    insertVoice.run(
      'voice-female-ananya',
      'ananya',
      'Ananya',
      'female',
      'Kore',
      'Sweet, expressive, warm & deeply attentive conversationalist',
      'You are Ananya, a warm, sweet, expressive female AI voice companion on DIL SE AI. Speak naturally with gentle warmth, playful wit when invited, and genuine attentiveness.',
      '/src/assets/images/avatar_female_aria_1795443142920.jpg'
    );
    insertVoice.run(
      'voice-male-kabir',
      'kabir',
      'Kabir',
      'male',
      'Charon',
      'Relaxed, grounded, expressive & effortlessly charming companion',
      'You are Kabir, a relaxed, grounded, expressive male AI voice companion on DIL SE AI. Speak naturally in an easygoing conversational rhythm with warmth and dry humor.',
      '/src/assets/images/avatar_male_kabir_1795443143985.jpg'
    );
  }

  const pkgCount = (db.prepare('SELECT COUNT(*) as c FROM packages').get() as { c: number }).c;
  if (pkgCount === 0) {
    const insertPkg = db.prepare(
      'INSERT INTO packages (id, name, minutes, inr_price_paise, usd_price_cents, region_scope, description, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'
    );
    // Exact India (INR) & International (USD) pricing tiers
    const packages: Array<[string, string, number, number, number, string, string, number]> = [
      ['pkg-15', 'Spark 15', 15, 14900, 2000, 'global', '15 minutes of live AI voice calls & voice messages', 1],
      ['pkg-30', 'Warmth 30', 30, 27900, 3500, 'global', '30 minutes across Hindi, English, Bhojpuri & global languages', 2],
      ['pkg-60', 'Heartline 60', 60, 49900, 6500, 'global', '1 full hour of expressive conversations with instant voice switching', 3],
      ['pkg-120', 'Horizon 120', 120, 89900, 12000, 'global', '2 hours of uninterrupted companion talks & stories', 4],
      ['pkg-300', 'Endless 300', 300, 199900, 27500, 'global', '5 hours of priority live voice & story sessions', 5],
      ['pkg-600', 'Global 600', 600, 369900, 49900, 'international', '10 hours tailored for frequent international callers', 6],
    ];
    for (const p of packages) {
      insertPkg.run(...p);
    }
  }
}

export interface WalletBalance {
  userId: string;
  paidSeconds: number;
  trialSeconds: number;
  totalAvailableSeconds: number;
  totalPurchasedSeconds: number;
  totalUsedSeconds: number;
}

export function getWallet(userId: string): WalletBalance {
  const row = db
    .prepare('SELECT user_id, paid_seconds, trial_seconds, total_purchased_seconds, total_used_seconds FROM wallets WHERE user_id = ?')
    .get(userId) as
    | {
        user_id: string;
        paid_seconds: number;
        trial_seconds: number;
        total_purchased_seconds: number;
        total_used_seconds: number;
      }
    | undefined;

  if (!row) {
    return {
      userId,
      paidSeconds: 0,
      trialSeconds: 0,
      totalAvailableSeconds: 0,
      totalPurchasedSeconds: 0,
      totalUsedSeconds: 0,
    };
  }

  return {
    userId: row.user_id,
    paidSeconds: row.paid_seconds,
    trialSeconds: row.trial_seconds,
    totalAvailableSeconds: row.paid_seconds + row.trial_seconds,
    totalPurchasedSeconds: row.total_purchased_seconds,
    totalUsedSeconds: row.total_used_seconds,
  };
}

/**
 * Idempotent wallet deduction: uses unique event_id in usage_logs so a single
 * usage event can never deduct minutes twice. Consumes trial_seconds first, then paid_seconds.
 */
export function deductUsageSeconds(params: {
  userId: string;
  sessionId: string;
  eventId: string;
  seconds: number;
  description: string;
}): {
  deducted: number;
  duplicate: boolean;
  balance: WalletBalance;
  exhausted: boolean;
} {
  const { userId, sessionId, eventId, seconds, description } = params;
  if (seconds <= 0) {
    const balance = getWallet(userId);
    return { deducted: 0, duplicate: false, balance, exhausted: balance.totalAvailableSeconds <= 0 };
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const existingLog = db
      .prepare('SELECT id FROM usage_logs WHERE event_id = ?')
      .get(eventId);
    if (existingLog) {
      db.exec('ROLLBACK');
      const balance = getWallet(userId);
      return { deducted: 0, duplicate: true, balance, exhausted: balance.totalAvailableSeconds <= 0 };
    }

    const wallet = db
      .prepare('SELECT paid_seconds, trial_seconds, total_used_seconds FROM wallets WHERE user_id = ?')
      .get(userId) as { paid_seconds: number; trial_seconds: number; total_used_seconds: number } | undefined;

    if (!wallet) {
      db.exec('ROLLBACK');
      throw new Error('Wallet not found');
    }

    const available = wallet.paid_seconds + wallet.trial_seconds;
    const toDeduct = Math.min(seconds, available);

    if (toDeduct <= 0) {
      db.exec('ROLLBACK');
      const balance = getWallet(userId);
      return { deducted: 0, duplicate: false, balance, exhausted: true };
    }

    const trialUsed = Math.min(toDeduct, wallet.trial_seconds);
    const paidUsed = toDeduct - trialUsed;

    const newTrial = wallet.trial_seconds - trialUsed;
    const newPaid = wallet.paid_seconds - paidUsed;
    const newTotalAvailable = newTrial + newPaid;

    db.prepare(
      `UPDATE wallets
       SET trial_seconds = ?, paid_seconds = ?, total_used_seconds = total_used_seconds + ?, updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(newTrial, newPaid, toDeduct, userId);

    db.prepare(
      'INSERT INTO usage_logs (id, session_id, user_id, event_id, seconds_deducted) VALUES (?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), sessionId, userId, eventId, toDeduct);

    db.prepare(
      'UPDATE sessions SET billed_seconds = billed_seconds + ? WHERE id = ?'
    ).run(toDeduct, sessionId);

    db.prepare(
      `INSERT INTO wallet_transactions (id, user_id, type, seconds_delta, balance_after_seconds, reference_id, description, idempotency_key)
       VALUES (?, ?, 'debit_usage', ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      userId,
      -toDeduct,
      newTotalAvailable,
      sessionId,
      description,
      `usage:${eventId}`
    );

    if (newTotalAvailable <= 0) {
      db.prepare(
        `UPDATE sessions SET status = 'terminated_zero_balance', ended_at = datetime('now') WHERE id = ? AND status = 'active'`
      ).run(sessionId);
    }

    db.exec('COMMIT');
    const balance = getWallet(userId);
    return {
      deducted: toDeduct,
      duplicate: false,
      balance,
      exhausted: newTotalAvailable <= 0,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Idempotent credit upon verified payment only.
 */
export function creditVerifiedPayment(params: {
  paymentId: string;
  gatewayPaymentId: string;
}): { credited: boolean; alreadyVerified: boolean; balance: WalletBalance } {
  const { paymentId, gatewayPaymentId } = params;

  db.exec('BEGIN IMMEDIATE');
  try {
    const payment = db
      .prepare('SELECT id, user_id, minutes, status FROM payments WHERE id = ?')
      .get(paymentId) as { id: string; user_id: string; minutes: number; status: string } | undefined;

    if (!payment) {
      db.exec('ROLLBACK');
      throw new Error('Payment record not found');
    }

    if (payment.status === 'verified') {
      db.exec('ROLLBACK');
      return { credited: false, alreadyVerified: true, balance: getWallet(payment.user_id) };
    }

    if (payment.status !== 'pending') {
      db.exec('ROLLBACK');
      throw new Error(`Cannot verify payment in status: ${payment.status}`);
    }

    const secondsToAdd = payment.minutes * 60;
    db.prepare(
      `UPDATE payments SET status = 'verified', gateway_payment_id = ? WHERE id = ?`
    ).run(gatewayPaymentId, payment.id);

    db.prepare(
      `UPDATE wallets
       SET paid_seconds = paid_seconds + ?, total_purchased_seconds = total_purchased_seconds + ?, updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(secondsToAdd, secondsToAdd, payment.user_id);

    const updatedWallet = getWallet(payment.user_id);
    db.prepare(
      `INSERT INTO wallet_transactions (id, user_id, type, seconds_delta, balance_after_seconds, reference_id, description, idempotency_key)
       VALUES (?, ?, 'credit_purchase', ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      payment.user_id,
      secondsToAdd,
      updatedWallet.totalAvailableSeconds,
      payment.id,
      `Verified purchase: +${payment.minutes} min`,
      `payment:${payment.id}`
    );

    db.exec('COMMIT');
    return { credited: true, alreadyVerified: false, balance: updatedWallet };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
