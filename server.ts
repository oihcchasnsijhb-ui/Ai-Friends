import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Modality, type LiveServerMessage } from '@google/genai';
import {
  db,
  initDatabase,
  getWallet,
  deductUsageSeconds,
  creditVerifiedPayment,
} from './server/db.ts';
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  loadUserById,
  requireAuth,
  requireAdmin,
  isAdminConfigured,
  verifyAdminPasscode,
  claimFirstAdminPasscode,
  type AuthRequest,
} from './server/auth.ts';
import { createRateLimiter } from './server/rateLimit.ts';
import {
  getGeminiClient,
  buildCompanionSystemInstruction,
  generateCompanionTextReply,
  synthesizeCompanionSpeech,
  transcribeUserAudio,
} from './server/ai.ts';
import {
  calculatePackageQuote,
  getGatewayAvailability,
  createRazorpayOrder,
  verifyRazorpaySignature,
  verifyRazorpayWebhookSignature,
  createStripeCheckoutSession,
  verifyStripeWebhookSignature,
  formatMinorCurrency,
} from './server/payments.ts';

initDatabase();

const app = express();
app.set('trust proxy', 1);

// Keep rawBody for webhook HMAC signature verification
app.use(
  express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, keyPrefix: 'auth' });
const aiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, keyPrefix: 'ai' });
const payLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, keyPrefix: 'pay' });

// ==================== PUBLIC CATALOG & HEALTH ====================

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'dil-se-ai', timestamp: new Date().toISOString() });
});

app.get('/api/catalog', (req, res) => {
  const countryParam = (typeof req.query.country === 'string' ? req.query.country : 'US').toUpperCase();
  const countries = db
    .prepare('SELECT code, name, currency, tax_name, tax_rate_percent, gateway, is_supported FROM countries ORDER BY name ASC')
    .all();
  const languages = db
    .prepare('SELECT code, name, native_name, is_active FROM languages WHERE is_active = 1 ORDER BY sort_order ASC')
    .all();
  const voices = db
    .prepare('SELECT id, slug, name, gender, provider_voice_name, tagline, avatar_url, is_active FROM voice_profiles WHERE is_active = 1')
    .all();
  const rawPackages = db
    .prepare('SELECT id, name, minutes, inr_price_paise, usd_price_cents, region_scope, description, is_active FROM packages WHERE is_active = 1 ORDER BY sort_order ASC')
    .all() as Array<{
      id: string;
      name: string;
      minutes: number;
      inr_price_paise: number;
      usd_price_cents: number;
      region_scope: string;
      description: string;
      is_active: number;
    }>;

  const quotedPackages = rawPackages
    .filter((p) => {
      if (countryParam === 'IN') {
        return p.region_scope === 'global' || p.region_scope === 'india';
      }
      return p.region_scope === 'global' || p.region_scope === 'international';
    })
    .map((p) => {
      try {
        const quote = calculatePackageQuote(p.id, countryParam);
        return { ...p, quote };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  res.json({
    countries,
    languages,
    voices,
    packages: quotedPackages,
    gateways: getGatewayAvailability(),
  });
});

// ==================== AUTHENTICATION ====================

app.post('/api/auth/register', authLimiter, (req, res) => {
  const { email, password, displayName, countryCode, languageCode, timezone, consentAccepted } = req.body ?? {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required.' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!consentAccepted) {
    return res.status(400).json({ error: 'Please accept the AI Companion disclosure and privacy terms.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const userId = crypto.randomUUID();
  const safeCountry = typeof countryCode === 'string' && countryCode.length === 2 ? countryCode.toUpperCase() : 'US';
  const safeLang = typeof languageCode === 'string' ? languageCode.slice(0, 12) : 'en';
  const safeTz = typeof timezone === 'string' ? timezone.slice(0, 60) : 'UTC';
  const safeName = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 80) : normalizedEmail.split('@')[0];

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, country_code, language_code, timezone, consent_accepted)
       VALUES (?, ?, ?, 'user', ?, ?, ?, 1)`
    ).run(userId, normalizedEmail, hashPassword(password), safeCountry, safeLang, safeTz);

    db.prepare(
      `INSERT INTO user_profiles (user_id, display_name, preferred_voice_id, preferred_mode)
       VALUES (?, ?, 'voice-female-ananya', 'friendship')`
    ).run(userId, safeName);

    // 120s complimentary evaluation trial; paid_seconds remains strictly 0 until verified payment
    db.prepare(
      `INSERT INTO wallets (user_id, paid_seconds, trial_seconds) VALUES (?, 0, 120)`
    ).run(userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const token = signSessionToken(userId, 'user');
  const user = loadUserById(userId);
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
  res.status(201).json({
    token,
    user,
    profile,
    wallet: getWallet(userId),
  });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const row = db
    .prepare('SELECT id, password_hash, role, is_active, deleted_at FROM users WHERE email = ?')
    .get(normalizedEmail) as
    | { id: string; password_hash: string | null; role: 'user' | 'admin'; is_active: number; deleted_at: string | null }
    | undefined;

  if (!row || !row.password_hash || !verifyPassword(String(password), row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (!row.is_active || row.deleted_at) {
    return res.status(403).json({ error: 'This account is inactive or deleted.' });
  }

  const token = signSessionToken(row.id, row.role);
  const user = loadUserById(row.id);
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(row.id);
  res.json({ token, user, profile, wallet: getWallet(row.id) });
});

app.post('/api/auth/otp/request', authLimiter, (req, res) => {
  const { phone } = req.body ?? {};
  const cleaned = String(phone || '').replace(/[^\d+]/g, '');
  if (cleaned.length < 8 || cleaned.length > 16) {
    return res.status(400).json({ error: 'Enter a valid mobile number with country code (e.g. +919876543210).' });
  }

  const code = String(crypto.randomInt(100000, 999999));
  const otpId = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  db.prepare(
    'INSERT INTO auth_otps (id, phone, code_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).run(otpId, cleaned, hashPassword(code), expiresAt);

  // In production with an SMS provider (Twilio/MSG91/Firebase Auth), send via SMS API and omit devOtp.
  const smsProviderConfigured = Boolean(process.env.SMS_GATEWAY_API_KEY);
  res.json({
    otpId,
    phone: cleaned,
    expiresInSeconds: 300,
    smsDelivered: smsProviderConfigured,
    ...(smsProviderConfigured ? {} : { previewVerificationCode: code }),
  });
});

app.post('/api/auth/otp/verify', authLimiter, (req, res) => {
  const { otpId, phone, code, displayName, countryCode, languageCode, timezone, consentAccepted } = req.body ?? {};
  const cleanedPhone = String(phone || '').replace(/[^\d+]/g, '');
  if (!otpId || !cleanedPhone || !code) {
    return res.status(400).json({ error: 'Phone number, OTP reference, and verification code are required.' });
  }

  const otpRow = db
    .prepare('SELECT id, code_hash, expires_at, consumed FROM auth_otps WHERE id = ? AND phone = ?')
    .get(String(otpId), cleanedPhone) as
    | { id: string; code_hash: string; expires_at: number; consumed: number }
    | undefined;

  if (!otpRow || otpRow.consumed || otpRow.expires_at < Date.now() || !verifyPassword(String(code), otpRow.code_hash)) {
    return res.status(401).json({ error: 'Invalid or expired OTP verification code.' });
  }

  db.prepare('UPDATE auth_otps SET consumed = 1 WHERE id = ?').run(otpRow.id);

  let userRow = db
    .prepare('SELECT id, role, is_active, deleted_at FROM users WHERE phone = ?')
    .get(cleanedPhone) as { id: string; role: 'user' | 'admin'; is_active: number; deleted_at: string | null } | undefined;

  if (!userRow) {
    if (!consentAccepted) {
      return res.status(400).json({ error: 'Please accept the AI Companion disclosure and privacy terms to register.' });
    }
    const newId = crypto.randomUUID();
    const safeCountry = typeof countryCode === 'string' && countryCode.length === 2 ? countryCode.toUpperCase() : cleanedPhone.startsWith('+91') ? 'IN' : 'US';
    const safeLang = typeof languageCode === 'string' ? languageCode.slice(0, 12) : 'en';
    const safeTz = typeof timezone === 'string' ? timezone.slice(0, 60) : 'UTC';
    const safeName = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 80) : `Friend ${cleanedPhone.slice(-4)}`;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO users (id, phone, role, country_code, language_code, timezone, consent_accepted)
         VALUES (?, ?, 'user', ?, ?, ?, 1)`
      ).run(newId, cleanedPhone, safeCountry, safeLang, safeTz);

      db.prepare(
        `INSERT INTO user_profiles (user_id, display_name, preferred_voice_id, preferred_mode)
         VALUES (?, ?, 'voice-female-ananya', 'friendship')`
      ).run(newId, safeName);

      db.prepare(
        `INSERT INTO wallets (user_id, paid_seconds, trial_seconds) VALUES (?, 0, 120)`
      ).run(newId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    userRow = { id: newId, role: 'user', is_active: 1, deleted_at: null };
  } else if (!userRow.is_active || userRow.deleted_at) {
    return res.status(403).json({ error: 'This account is inactive or deleted.' });
  }

  const token = signSessionToken(userRow.id, userRow.role);
  const user = loadUserById(userRow.id);
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userRow.id);
  res.json({ token, user, profile, wallet: getWallet(userRow.id) });
});

app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
  res.json({
    user: req.authUser,
    profile,
    wallet: getWallet(userId),
  });
});

app.get('/api/auth/admin-status', (_req, res) => {
  res.json(isAdminConfigured());
});

app.post('/api/auth/admin-claim', authLimiter, (req, res) => {
  const { passcode, email } = req.body ?? {};
  if (!passcode || typeof passcode !== 'string' || passcode.length < 8) {
    return res.status(400).json({ error: 'Admin passcode must be at least 8 characters.' });
  }
  const claimed = claimFirstAdminPasscode(passcode);
  if (!claimed) {
    return res.status(409).json({ error: 'Admin credentials are already configured.' });
  }

  const adminEmail = typeof email === 'string' && email.includes('@') ? email.trim().toLowerCase() : 'admin@dilse.ai';
  let adminUser = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail) as { id: string } | undefined;
  if (!adminUser) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, country_code, language_code, timezone, consent_accepted)
       VALUES (?, ?, ?, 'admin', 'IN', 'en', 'Asia/Kolkata', 1)`
    ).run(id, adminEmail, hashPassword(passcode));
    db.prepare(
      `INSERT INTO user_profiles (user_id, display_name, preferred_voice_id, preferred_mode)
       VALUES (?, 'Platform Admin', 'voice-female-ananya', 'daily_life')`
    ).run(id);
    db.prepare(`INSERT INTO wallets (user_id, paid_seconds, trial_seconds) VALUES (?, 0, 120)`).run(id);
    adminUser = { id };
  } else {
    db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(adminUser.id);
  }

  const token = signSessionToken(adminUser.id, 'admin');
  res.status(201).json({
    token,
    user: loadUserById(adminUser.id),
    wallet: getWallet(adminUser.id),
  });
});

app.post('/api/auth/admin-login', authLimiter, (req, res) => {
  const { passcode, email } = req.body ?? {};
  if (!passcode || !verifyAdminPasscode(String(passcode))) {
    return res.status(401).json({ error: 'Invalid admin passcode.' });
  }

  const adminEmail = typeof email === 'string' && email.includes('@') ? email.trim().toLowerCase() : 'admin@dilse.ai';
  let adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  if (!adminUser) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, role, country_code, language_code, timezone, consent_accepted)
       VALUES (?, ?, 'admin', 'IN', 'en', 'Asia/Kolkata', 1)`
    ).run(id, adminEmail);
    db.prepare(
      `INSERT INTO user_profiles (user_id, display_name, preferred_voice_id, preferred_mode)
       VALUES (?, 'Platform Admin', 'voice-female-ananya', 'daily_life')`
    ).run(id);
    db.prepare(`INSERT INTO wallets (user_id, paid_seconds, trial_seconds) VALUES (?, 0, 120)`).run(id);
    adminUser = { id };
  }

  const token = signSessionToken(adminUser.id, 'admin');
  res.json({
    token,
    user: loadUserById(adminUser.id),
    wallet: getWallet(adminUser.id),
  });
});

// ==================== ACCOUNT PROFILE & DELETION ====================

app.patch('/api/account/profile', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  const { displayName, countryCode, languageCode, timezone, preferredVoiceId, preferredMode } = req.body ?? {};

  if (typeof countryCode === 'string' && countryCode.length === 2) {
    db.prepare('UPDATE users SET country_code = ? WHERE id = ?').run(countryCode.toUpperCase(), userId);
  }
  if (typeof languageCode === 'string' && languageCode.length >= 2) {
    db.prepare('UPDATE users SET language_code = ? WHERE id = ?').run(languageCode.slice(0, 12), userId);
  }
  if (typeof timezone === 'string' && timezone.length >= 2) {
    db.prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone.slice(0, 64), userId);
  }
  if (typeof displayName === 'string' && displayName.trim()) {
    db.prepare("UPDATE user_profiles SET display_name = ?, updated_at = datetime('now') WHERE user_id = ?").run(
      displayName.trim().slice(0, 80),
      userId
    );
  }
  if (typeof preferredVoiceId === 'string') {
    db.prepare("UPDATE user_profiles SET preferred_voice_id = ?, updated_at = datetime('now') WHERE user_id = ?").run(
      preferredVoiceId,
      userId
    );
  }
  if (typeof preferredMode === 'string') {
    db.prepare("UPDATE user_profiles SET preferred_mode = ?, updated_at = datetime('now') WHERE user_id = ?").run(
      preferredMode,
      userId
    );
  }

  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
  res.json({ user: loadUserById(userId), profile });
});

app.delete('/api/account', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE users
       SET email = NULL, phone = NULL, password_hash = NULL, is_active = 0, deleted_at = datetime('now')
       WHERE id = ?`
    ).run(userId);
    db.prepare("UPDATE user_profiles SET display_name = 'Deleted Account', bio_notes = '' WHERE user_id = ?").run(userId);
    db.prepare("UPDATE sessions SET status = 'ended', ended_at = datetime('now') WHERE user_id = ? AND status = 'active'").run(userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ deleted: true });
});

// ==================== WALLET & SESSIONS ====================

app.get('/api/wallet', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  const wallet = getWallet(userId);
  const transactions = db
    .prepare(
      'SELECT id, type, seconds_delta, balance_after_seconds, reference_id, description, created_at FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    )
    .all(userId);
  res.json({ wallet, transactions });
});

app.get('/api/sessions', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  const rows = db
    .prepare(
      `SELECT s.*, v.name as voice_name, v.gender as voice_gender, v.avatar_url as voice_avatar
       FROM sessions s
       JOIN voice_profiles v ON v.id = s.voice_id
       WHERE s.user_id = ?
       ORDER BY s.started_at DESC
       LIMIT 30`
    )
    .all(userId);
  res.json({ sessions: rows });
});

app.post('/api/sessions', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  const { voiceId, mode, conversationStyle, languageCode } = req.body ?? {};
  const wallet = getWallet(userId);

  if (wallet.totalAvailableSeconds <= 0 && mode !== 'text_chat') {
    return res.status(402).json({
      error: 'Your wallet balance is 00:00. Purchase a voice minute package to start a live voice session.',
      code: 'INSUFFICIENT_BALANCE',
    });
  }

  const voice = db
    .prepare('SELECT id, name, gender, provider_voice_name, avatar_url FROM voice_profiles WHERE id = ? AND is_active = 1')
    .get(String(voiceId || 'voice-female-ananya')) as any;
  if (!voice) {
    return res.status(404).json({ error: 'Selected AI voice profile is unavailable.' });
  }

  const sessionId = crypto.randomUUID();
  const safeMode = ['live_call', 'voice_message', 'text_chat'].includes(mode) ? mode : 'text_chat';
  const safeStyle = typeof conversationStyle === 'string' ? conversationStyle : 'friendship';
  const safeLang = typeof languageCode === 'string' ? languageCode : req.authUser!.languageCode;

  db.prepare(
    `INSERT INTO sessions (id, user_id, voice_id, mode, conversation_style, language_code, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`
  ).run(sessionId, userId, voice.id, safeMode, safeStyle, safeLang);

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  res.status(201).json({ session, voice, wallet });
});

app.patch('/api/sessions/:id/voice', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  const { voiceId } = req.body ?? {};
  const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  const voice = db.prepare('SELECT id, name, gender, avatar_url FROM voice_profiles WHERE id = ? AND is_active = 1').get(String(voiceId));
  if (!voice) return res.status(404).json({ error: 'Voice profile not found.' });

  db.prepare('UPDATE sessions SET voice_id = ? WHERE id = ?').run(String(voiceId), req.params.id);
  res.json({ updated: true, voice });
});

app.post('/api/sessions/:id/end', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  db.prepare(
    `UPDATE sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'active'`
  ).run(req.params.id, userId);
  res.json({ ended: true, wallet: getWallet(userId) });
});

app.get('/api/sessions/:id/messages', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  const messages = db
    .prepare('SELECT id, sender, content, audio_duration_seconds, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  res.json({ messages });
});

// ==================== AI VOICE & CONVERSATION ENDPOINTS ====================

app.post('/api/voice/sample', aiLimiter, async (req, res) => {
  try {
    const { voiceId, languageCode } = req.body ?? {};
    const voice = db
      .prepare('SELECT id, name, gender, provider_voice_name FROM voice_profiles WHERE id = ?')
      .get(String(voiceId || 'voice-female-ananya')) as
      | { id: string; name: string; gender: 'female' | 'male'; provider_voice_name: string }
      | undefined;

    if (!voice) return res.status(404).json({ error: 'Voice not found.' });

    const greetings: Record<string, string> = {
      hi:
        voice.gender === 'female'
          ? 'नमस्ते! मैं अनन्या हूँ, आपकी एआई दोस्त। बताइए, आज आपका दिन कैसा जा रहा है?'
          : 'अरे नमस्ते! मैं कबीर हूँ, आपका एआई दोस्त। कैसे हैं आप? चलो आराम से बात करते हैं।',
      bho:
        voice.gender === 'female'
          ? 'प्रणाम! हम अनन्या बानी, राउर एआई सखी। बताईं आज मन कइसन बा?'
          : 'का हाल बा दोस्त! हम कबीर बानी। बताईं आज का बातचीत कइल जाव?',
      en:
        voice.gender === 'female'
          ? "Hey there, I'm Ananya, your AI companion on Dil Se AI. Whenever you feel like talking, I'm right here listening."
          : "Hey! I'm Kabir, your AI friend on Dil Se AI. Grab a coffee, relax, and tell me what's on your mind today.",
    };

    const sampleText = greetings[String(languageCode || 'en')] || greetings.en;
    const base64Audio = await synthesizeCompanionSpeech({
      text: sampleText,
      voiceName: voice.provider_voice_name,
      gender: voice.gender,
      mode: 'friendship',
    });

    res.json({ audioBase64: base64Audio, mimeType: 'audio/wav', transcript: sampleText });
  } catch (err: any) {
    console.error('Voice sample error:', err);
    res.status(502).json({ error: err?.message || 'Unable to generate voice sample right now.' });
  }
});

app.post('/api/chat/message', requireAuth, aiLimiter, async (req: AuthRequest, res) => {
  try {
    const userId = req.authUser!.id;
    const { sessionId, message, voiceId, mode, languageCode, includeAudio, eventId } = req.body ?? {};
    if (!sessionId || !message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Session ID and message text are required.' });
    }

    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(String(sessionId), userId) as any;
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    if (session.status !== 'active') {
      return res.status(409).json({ error: 'This conversation session has already ended.' });
    }

    const activeVoiceId = String(voiceId || session.voice_id);
    const activeMode = String(mode || session.conversation_style);
    const activeLangCode = String(languageCode || 'auto');

    const voice = db
      .prepare('SELECT * FROM voice_profiles WHERE id = ?')
      .get(activeVoiceId) as any;
    const langRow =
      activeLangCode === 'auto'
        ? undefined
        : (db.prepare('SELECT name FROM languages WHERE code = ?').get(activeLangCode) as { name: string } | undefined);
    const profile = db
      .prepare('SELECT display_name FROM user_profiles WHERE user_id = ?')
      .get(userId) as { display_name: string } | undefined;

    const history = db
      .prepare('SELECT sender, content FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 20')
      .all(session.id) as Array<{ sender: string; content: string }>;

    const userMsgId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO messages (id, session_id, user_id, sender, content) VALUES (?, ?, ?, ?, ?)'
    ).run(userMsgId, session.id, userId, 'user', message.trim().slice(0, 4000));

    const matched = await generateCompanionTextReply({
      config: {
        voiceName: voice.provider_voice_name,
        companionName: voice.name,
        gender: voice.gender,
        personalityPrompt: voice.personality_prompt,
        mode: activeMode,
        languageName: activeLangCode === 'auto' ? 'Auto-Detect' : langRow?.name || 'Auto-Detect',
        userName: profile?.display_name || 'Friend',
      },
      history,
      userMessage: message.trim().slice(0, 4000),
    });

    const aiReplyText = matched.reply;
    let audioBase64: string | null = null;
    let billedSeconds = 0;

    if (includeAudio) {
      const wallet = getWallet(userId);
      if (wallet.totalAvailableSeconds <= 0) {
        return res.status(402).json({
          error: 'Insufficient voice minutes for audio synthesis. Please top up your wallet or continue in text chat.',
          code: 'INSUFFICIENT_BALANCE',
          replyText: aiReplyText,
          detectedLanguage: matched.detectedLanguage,
          detectedStyle: matched.detectedStyle,
          wallet,
        });
      }

      audioBase64 = await synthesizeCompanionSpeech({
        text: aiReplyText,
        voiceName: voice.provider_voice_name,
        gender: voice.gender,
        mode: activeMode,
        voiceDeliveryCue: matched.voiceDeliveryCue,
      });

      const wordCount = aiReplyText.split(/\s+/).filter(Boolean).length;
      const estimatedSeconds = Math.max(5, Math.min(60, Math.ceil(wordCount / 2.5)));
      const deduction = deductUsageSeconds({
        userId,
        sessionId: session.id,
        eventId: String(eventId || `tts:${userMsgId}`),
        seconds: estimatedSeconds,
        description: `Voice reply with ${voice.name} (${estimatedSeconds}s)`,
      });
      billedSeconds = deduction.deducted;
    }

    const aiMsgId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO messages (id, session_id, user_id, sender, content, audio_duration_seconds) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(aiMsgId, session.id, userId, 'ai', aiReplyText, billedSeconds);

    res.json({
      userMessageId: userMsgId,
      aiMessageId: aiMsgId,
      replyText: aiReplyText,
      detectedLanguage: matched.detectedLanguage,
      detectedLanguageCode: matched.detectedLanguageCode,
      detectedStyle: matched.detectedStyle,
      audioBase64,
      audioMimeType: audioBase64 ? 'audio/wav' : null,
      billedSeconds,
      wallet: getWallet(userId),
    });
  } catch (err: any) {
    console.error('Chat error:', err);
    res.status(502).json({ error: err?.message || 'AI response generation failed.' });
  }
});

app.post('/api/voice/message', requireAuth, aiLimiter, async (req: AuthRequest, res) => {
  try {
    const userId = req.authUser!.id;
    const { sessionId, audioBase64, mimeType, durationSeconds, voiceId, mode, languageCode, eventId } = req.body ?? {};
    if (!sessionId || !audioBase64 || !mimeType) {
      return res.status(400).json({ error: 'Session ID, recorded audio data, and mimeType are required.' });
    }

    const wallet = getWallet(userId);
    if (wallet.totalAvailableSeconds <= 0) {
      return res.status(402).json({
        error: 'Wallet balance is 00:00. Top up minutes to send voice messages.',
        code: 'INSUFFICIENT_BALANCE',
      });
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(String(sessionId), userId) as any;
    if (!session || session.status !== 'active') {
      return res.status(404).json({ error: 'Active session not found.' });
    }

    const transcript = await transcribeUserAudio({
      base64Audio: String(audioBase64),
      mimeType: String(mimeType),
    });

    if (!transcript) {
      return res.status(422).json({ error: 'Could not hear speech clearly. Please record again.' });
    }

    const activeVoiceId = String(voiceId || session.voice_id);
    const activeMode = String(mode || session.conversation_style);
    const activeLangCode = String(languageCode || 'auto');
    const voice = db.prepare('SELECT * FROM voice_profiles WHERE id = ?').get(activeVoiceId) as any;
    const langRow =
      activeLangCode === 'auto'
        ? undefined
        : (db.prepare('SELECT name FROM languages WHERE code = ?').get(activeLangCode) as { name: string } | undefined);
    const profile = db.prepare('SELECT display_name FROM user_profiles WHERE user_id = ?').get(userId) as { display_name: string } | undefined;

    const history = db
      .prepare('SELECT sender, content FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 20')
      .all(session.id) as Array<{ sender: string; content: string }>;

    const userMsgId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO messages (id, session_id, user_id, sender, content, audio_duration_seconds) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userMsgId, session.id, userId, 'user', transcript, Number(durationSeconds) || 5);

    const matched = await generateCompanionTextReply({
      config: {
        voiceName: voice.provider_voice_name,
        companionName: voice.name,
        gender: voice.gender,
        personalityPrompt: voice.personality_prompt,
        mode: activeMode,
        languageName: activeLangCode === 'auto' ? 'Auto-Detect' : langRow?.name || 'Auto-Detect',
        userName: profile?.display_name || 'Friend',
      },
      history,
      userMessage: transcript,
    });

    const replyText = matched.reply;
    const replyAudioBase64 = await synthesizeCompanionSpeech({
      text: replyText,
      voiceName: voice.provider_voice_name,
      gender: voice.gender,
      mode: activeMode,
      voiceDeliveryCue: matched.voiceDeliveryCue,
    });

    const wordCount = replyText.split(/\s+/).filter(Boolean).length;
    const replyDuration = Math.max(5, Math.min(60, Math.ceil(wordCount / 2.5)));
    const totalUsageSec = Math.max(5, Math.min(120, (Number(durationSeconds) || 4) + replyDuration));

    const deduction = deductUsageSeconds({
      userId,
      sessionId: session.id,
      eventId: String(eventId || `vmsg:${userMsgId}`),
      seconds: totalUsageSec,
      description: `Voice message exchange with ${voice.name} (${totalUsageSec}s)`,
    });

    const aiMsgId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO messages (id, session_id, user_id, sender, content, audio_duration_seconds) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(aiMsgId, session.id, userId, 'ai', replyText, replyDuration);

    res.json({
      userTranscript: transcript,
      replyText,
      detectedLanguage: matched.detectedLanguage,
      detectedLanguageCode: matched.detectedLanguageCode,
      detectedStyle: matched.detectedStyle,
      audioBase64: replyAudioBase64,
      audioMimeType: 'audio/wav',
      billedSeconds: deduction.deducted,
      exhausted: deduction.exhausted,
      wallet: deduction.balance,
    });
  } catch (err: any) {
    console.error('Voice message error:', err);
    res.status(502).json({ error: err?.message || 'Voice message processing failed.' });
  }
});

// ==================== PAYMENTS & VERIFIED WEBHOOKS ====================

app.get('/api/payments/history', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  const rows = db
    .prepare(
      `SELECT p.*, pkg.name as package_name
       FROM payments p
       JOIN packages pkg ON pkg.id = p.package_id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC
       LIMIT 50`
    )
    .all(userId);
  res.json({ payments: rows });
});

app.post('/api/payments/create-order', requireAuth, payLimiter, async (req: AuthRequest, res) => {
  try {
    const userId = req.authUser!.id;
    const { packageId, countryCode, idempotencyKey } = req.body ?? {};
    if (!packageId || !idempotencyKey) {
      return res.status(400).json({ error: 'Package ID and idempotency key are required.' });
    }

    // Duplicate payment protection via idempotency key
    const existing = db
      .prepare('SELECT * FROM payments WHERE idempotency_key = ? AND user_id = ?')
      .get(String(idempotencyKey), userId) as any;

    const quote = calculatePackageQuote(String(packageId), String(countryCode || req.authUser!.countryCode));

    if (existing) {
      return res.json({
        payment: existing,
        quote,
        gateways: getGatewayAvailability(),
        reusedIdempotentOrder: true,
      });
    }

    const paymentId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO payments (id, user_id, package_id, gateway, currency, subtotal_minor, tax_minor, total_minor, minutes, idempotency_key, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(
      paymentId,
      userId,
      quote.packageId,
      quote.gateway,
      quote.currency,
      quote.subtotalMinor,
      quote.taxMinor,
      quote.totalMinor,
      quote.minutes,
      String(idempotencyKey)
    );

    const gateways = getGatewayAvailability();

    if (quote.gateway === 'razorpay') {
      if (!gateways.razorpayConfigured) {
        return res.status(200).json({
          status: 'configuration_required',
          gateway: 'razorpay',
          missingEnvVars: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
          message:
            'Razorpay credentials are not configured in server secrets yet. Payment order was recorded as pending; paid minutes will only activate after real Razorpay signature verification.',
          paymentId,
          quote,
        });
      }
      const order = await createRazorpayOrder({
        amountPaise: quote.totalMinor,
        receiptId: paymentId.slice(0, 36),
        notes: { userId, paymentId, minutes: String(quote.minutes) },
      });
      db.prepare('UPDATE payments SET gateway_order_id = ? WHERE id = ?').run(order.id, paymentId);
      return res.json({
        status: 'ready',
        gateway: 'razorpay',
        razorpayKeyId: gateways.razorpayKeyId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        paymentId,
        quote,
      });
    } else {
      if (!gateways.stripeConfigured) {
        return res.status(200).json({
          status: 'configuration_required',
          gateway: 'stripe',
          missingEnvVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
          message:
            'International Stripe credentials are not configured in server secrets yet. Payment order was recorded as pending; paid minutes will only activate after verified payment.',
          paymentId,
          quote,
        });
      }
      const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const session = await createStripeCheckoutSession({
        amountCents: quote.totalMinor,
        packageName: quote.packageName,
        minutes: quote.minutes,
        paymentId,
        userEmail: req.authUser!.email,
        successUrl: `${baseUrl}/?payment=success&paymentId=${paymentId}`,
        cancelUrl: `${baseUrl}/?payment=cancelled&paymentId=${paymentId}`,
      });
      db.prepare('UPDATE payments SET gateway_order_id = ? WHERE id = ?').run(session.id, paymentId);
      return res.json({
        status: 'ready',
        gateway: 'stripe',
        checkoutUrl: session.url,
        sessionId: session.id,
        paymentId,
        quote,
      });
    }
  } catch (err: any) {
    console.error('Create order error:', err);
    res.status(400).json({ error: err?.message || 'Unable to create payment order.' });
  }
});

app.post('/api/payments/verify-razorpay', requireAuth, payLimiter, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  const { paymentId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
  if (!paymentId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing Razorpay verification fields.' });
  }

  const row = db
    .prepare('SELECT id, user_id, gateway_order_id FROM payments WHERE id = ? AND user_id = ?')
    .get(String(paymentId), userId) as { id: string; user_id: string; gateway_order_id: string | null } | undefined;
  if (!row) return res.status(404).json({ error: 'Payment record not found.' });

  const isValid = verifyRazorpaySignature({
    orderId: String(razorpay_order_id),
    paymentId: String(razorpay_payment_id),
    signature: String(razorpay_signature),
  });

  if (!isValid) {
    return res.status(400).json({ error: 'Invalid Razorpay cryptographic signature. Minutes were NOT activated.' });
  }

  const result = creditVerifiedPayment({
    paymentId: row.id,
    gatewayPaymentId: String(razorpay_payment_id),
  });

  res.json({ verified: true, ...result });
});

app.post('/api/webhooks/razorpay', (req: any, res) => {
  const sig = req.headers['x-razorpay-signature'] as string;
  if (!verifyRazorpayWebhookSignature(req.rawBody || '', sig || '')) {
    return res.status(401).json({ error: 'Invalid Razorpay webhook signature.' });
  }
  const event = req.body;
  if (event?.event === 'payment.captured') {
    const entity = event?.payload?.payment?.entity;
    const paymentId = entity?.notes?.paymentId;
    if (paymentId && entity?.id) {
      creditVerifiedPayment({ paymentId: String(paymentId), gatewayPaymentId: String(entity.id) });
    }
  }
  res.json({ received: true });
});

app.post('/api/webhooks/stripe', (req: any, res) => {
  const sig = req.headers['stripe-signature'] as string;
  if (!verifyStripeWebhookSignature(req.rawBody || '', sig || '')) {
    return res.status(401).json({ error: 'Invalid Stripe webhook signature.' });
  }
  const event = req.body;
  if (event?.type === 'checkout.session.completed') {
    const session = event?.data?.object;
    const paymentId = session?.metadata?.paymentId;
    if (paymentId && session?.payment_intent) {
      creditVerifiedPayment({
        paymentId: String(paymentId),
        gatewayPaymentId: String(session.payment_intent),
      });
    }
  }
  res.json({ received: true });
});

// ==================== SUPPORT TICKETS ====================

app.post('/api/support/tickets', requireAuth, (req: AuthRequest, res) => {
  const userId = req.authUser!.id;
  const { subject, message } = req.body ?? {};
  if (!subject || !message) {
    return res.status(400).json({ error: 'Subject and message are required.' });
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO support_tickets (id, user_id, subject, message) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    String(subject).slice(0, 160),
    String(message).slice(0, 2000)
  );
  res.status(201).json({ id, status: 'open' });
});

app.get('/api/support/tickets', requireAuth, (req: AuthRequest, res) => {
  const tickets = db
    .prepare('SELECT id, subject, message, status, created_at FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.authUser!.id);
  res.json({ tickets });
});

// ==================== ADMIN DASHBOARD API ====================

app.get('/api/admin/overview', requireAdmin, (_req, res) => {
  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users WHERE deleted_at IS NULL').get() as { c: number }).c;
  const activeUsers = (db.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1 AND deleted_at IS NULL').get() as { c: number }).c;
  const activeSessions = (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE status = 'active'").get() as { c: number }).c;
  const totalSessions = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c;

  const revRows = db
    .prepare(
      `SELECT
         currency,
         COALESCE(SUM(total_minor), 0) as total_minor,
         COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN total_minor ELSE 0 END), 0) as daily_minor,
         COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') THEN total_minor ELSE 0 END), 0) as monthly_minor
       FROM payments
       WHERE status = 'verified'
       GROUP BY currency`
    )
    .all() as Array<{ currency: 'INR' | 'USD'; total_minor: number; daily_minor: number; monthly_minor: number }>;

  const revenueByCurrency = {
    INR: { totalMinor: 0, dailyMinor: 0, monthlyMinor: 0, formattedTotal: '₹0', formattedDaily: '₹0', formattedMonthly: '₹0' },
    USD: { totalMinor: 0, dailyMinor: 0, monthlyMinor: 0, formattedTotal: '$0', formattedDaily: '$0', formattedMonthly: '$0' },
  };
  for (const r of revRows) {
    revenueByCurrency[r.currency] = {
      totalMinor: r.total_minor,
      dailyMinor: r.daily_minor,
      monthlyMinor: r.monthly_minor,
      formattedTotal: formatMinorCurrency(r.total_minor, r.currency),
      formattedDaily: formatMinorCurrency(r.daily_minor, r.currency),
      formattedMonthly: formatMinorCurrency(r.monthly_minor, r.currency),
    };
  }

  const totalMinutesUsed = Math.round(
    ((db.prepare('SELECT COALESCE(SUM(billed_seconds), 0) as s FROM sessions').get() as { s: number }).s || 0) / 60
  );

  res.json({
    totalUsers,
    activeUsers,
    activeSessions,
    totalSessions,
    totalMinutesUsed,
    revenueByCurrency,
  });
});

app.get('/api/admin/users', requireAdmin, (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.phone, u.role, u.country_code, u.language_code, u.timezone, u.is_active, u.deleted_at, u.created_at,
              p.display_name, w.paid_seconds, w.trial_seconds, w.total_used_seconds
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN wallets w ON w.user_id = u.id
       ORDER BY u.created_at DESC
       LIMIT 100`
    )
    .all();
  res.json({ users });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { isActive } = req.body ?? {};
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, req.params.id);
  res.json({ updated: true });
});

app.get('/api/admin/payments', requireAdmin, (_req, res) => {
  const payments = db
    .prepare(
      `SELECT p.*, pkg.name as package_name, u.email as user_email, u.phone as user_phone
       FROM payments p
       JOIN packages pkg ON pkg.id = p.package_id
       JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC
       LIMIT 100`
    )
    .all();
  res.json({ payments });
});

app.post('/api/admin/payments/:id/refund', requireAdmin, (req, res) => {
  const { reason } = req.body ?? {};
  const payment = db
    .prepare('SELECT id, user_id, minutes, status FROM payments WHERE id = ?')
    .get(req.params.id) as { id: string; user_id: string; minutes: number; status: string } | undefined;

  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (payment.status !== 'verified') {
    return res.status(400).json({ error: 'Only verified payments can be refunded.' });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE payments SET status = 'refunded', refund_reason = ?, refunded_at = datetime('now') WHERE id = ?`
    ).run(String(reason || 'Admin-approved refund').slice(0, 240), payment.id);

    const secondsToReverse = payment.minutes * 60;
    const wallet = getWallet(payment.user_id);
    const actualDeduct = Math.min(wallet.paidSeconds, secondsToReverse);

    db.prepare(
      `UPDATE wallets SET paid_seconds = paid_seconds - ?, updated_at = datetime('now') WHERE user_id = ?`
    ).run(actualDeduct, payment.user_id);

    const updated = getWallet(payment.user_id);
    db.prepare(
      `INSERT INTO wallet_transactions (id, user_id, type, seconds_delta, balance_after_seconds, reference_id, description, idempotency_key)
       VALUES (?, ?, 'refund_reversal', ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      payment.user_id,
      -actualDeduct,
      updated.totalAvailableSeconds,
      payment.id,
      `Refund reversal: ${reason || 'Admin-approved'}`,
      `refund:${payment.id}`
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  res.json({ refunded: true });
});

app.get('/api/admin/sessions', requireAdmin, (_req, res) => {
  const sessions = db
    .prepare(
      `SELECT s.*, v.name as voice_name, u.email as user_email, u.phone as user_phone
       FROM sessions s
       JOIN voice_profiles v ON v.id = s.voice_id
       JOIN users u ON u.id = s.user_id
       ORDER BY s.started_at DESC
       LIMIT 100`
    )
    .all();
  res.json({ sessions });
});

app.get('/api/admin/config', requireAdmin, (_req, res) => {
  const voices = db.prepare('SELECT * FROM voice_profiles').all();
  const packages = db.prepare('SELECT * FROM packages ORDER BY sort_order ASC').all();
  const pricingRules = db
    .prepare(
      `SELECT pr.*, c.name as country_name, c.tax_name, c.gateway
       FROM pricing_rules pr
       JOIN countries c ON c.code = pr.country_code
       ORDER BY c.name ASC`
    )
    .all();
  const languages = db.prepare('SELECT * FROM languages ORDER BY sort_order ASC').all();
  const tickets = db
    .prepare(
      `SELECT t.*, u.email as user_email, u.phone as user_phone
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC`
    )
    .all();
  res.json({ voices, packages, pricingRules, languages, tickets });
});

app.patch('/api/admin/voices/:id', requireAdmin, (req, res) => {
  const { name, tagline, personality_prompt, provider_voice_name, is_active } = req.body ?? {};
  db.prepare(
    `UPDATE voice_profiles
     SET name = COALESCE(?, name),
         tagline = COALESCE(?, tagline),
         personality_prompt = COALESCE(?, personality_prompt),
         provider_voice_name = COALESCE(?, provider_voice_name),
         is_active = COALESCE(?, is_active)
     WHERE id = ?`
  ).run(
    name ?? null,
    tagline ?? null,
    personality_prompt ?? null,
    provider_voice_name ?? null,
    typeof is_active === 'boolean' ? (is_active ? 1 : 0) : null,
    req.params.id
  );
  res.json({ updated: true });
});

app.patch('/api/admin/packages/:id', requireAdmin, (req, res) => {
  const { name, minutes, inr_price_paise, usd_price_cents, is_active } = req.body ?? {};
  if (minutes !== undefined && Number(minutes) < 15) {
    return res.status(400).json({ error: 'Minimum paid package is 15 minutes.' });
  }
  db.prepare(
    `UPDATE packages
     SET name = COALESCE(?, name),
         minutes = COALESCE(?, minutes),
         inr_price_paise = COALESCE(?, inr_price_paise),
         usd_price_cents = COALESCE(?, usd_price_cents),
         is_active = COALESCE(?, is_active)
     WHERE id = ?`
  ).run(
    name ?? null,
    minutes !== undefined ? Number(minutes) : null,
    inr_price_paise !== undefined ? Number(inr_price_paise) : null,
    usd_price_cents !== undefined ? Number(usd_price_cents) : null,
    typeof is_active === 'boolean' ? (is_active ? 1 : 0) : null,
    req.params.id
  );
  res.json({ updated: true });
});

app.patch('/api/admin/pricing-rules/:countryCode', requireAdmin, (req, res) => {
  const { tax_rate_percent, discount_percent } = req.body ?? {};
  db.prepare(
    `UPDATE pricing_rules
     SET tax_rate_percent = COALESCE(?, tax_rate_percent),
         discount_percent = COALESCE(?, discount_percent),
         updated_at = datetime('now')
     WHERE country_code = ?`
  ).run(
    tax_rate_percent !== undefined ? Number(tax_rate_percent) : null,
    discount_percent !== undefined ? Number(discount_percent) : null,
    req.params.countryCode.toUpperCase()
  );
  res.json({ updated: true });
});

app.patch('/api/admin/languages/:code', requireAdmin, (req, res) => {
  const { is_active } = req.body ?? {};
  db.prepare('UPDATE languages SET is_active = ? WHERE code = ?').run(is_active ? 1 : 0, req.params.code);
  res.json({ updated: true });
});

app.patch('/api/admin/tickets/:id', requireAdmin, (req, res) => {
  const { status } = req.body ?? {};
  if (!['open', 'in_progress', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid ticket status.' });
  }
  db.prepare('UPDATE support_tickets SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ updated: true });
});

// ==================== SERVER & LIVE VOICE WEBSOCKET ====================

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  if (url.pathname === '/ws/live-call') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, url);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (clientWs: WebSocket, _req: http.IncomingMessage, url: URL) => {
  const token = url.searchParams.get('token') || '';
  const sessionId = url.searchParams.get('sessionId') || '';
  const voiceIdParam = url.searchParams.get('voiceId') || '';
  const modeParam = url.searchParams.get('mode') || 'friendship';
  const langParam = url.searchParams.get('lang') || 'en';

  const payload = verifySessionToken(token);
  if (!payload) {
    clientWs.send(JSON.stringify({ type: 'error', error: 'Unauthorized live call token.' }));
    clientWs.close();
    return;
  }
  const user = loadUserById(payload.sub);
  if (!user) {
    clientWs.send(JSON.stringify({ type: 'error', error: 'User account unavailable.' }));
    clientWs.close();
    return;
  }

  const sessionRow = db
    .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, user.id) as any;
  if (!sessionRow) {
    clientWs.send(JSON.stringify({ type: 'error', error: 'Session not found.' }));
    clientWs.close();
    return;
  }

  const initialWallet = getWallet(user.id);
  if (initialWallet.totalAvailableSeconds <= 0) {
    clientWs.send(JSON.stringify({ type: 'balance_exhausted', wallet: initialWallet }));
    clientWs.close();
    return;
  }

  const voice = db
    .prepare('SELECT * FROM voice_profiles WHERE id = ?')
    .get(voiceIdParam || sessionRow.voice_id) as any;
  const langRow =
    langParam === 'auto'
      ? undefined
      : (db.prepare('SELECT name FROM languages WHERE code = ?').get(langParam) as { name: string } | undefined);
  const profile = db.prepare('SELECT display_name FROM user_profiles WHERE user_id = ?').get(user.id) as { display_name: string } | undefined;

  let liveSession: any = null;
  let billingInterval: NodeJS.Timeout | null = null;
  let tickIndex = 0;
  let lowWarningSent = false;
  const callInstanceId = crypto.randomUUID().slice(0, 8);

  const cleanup = () => {
    if (billingInterval) {
      clearInterval(billingInterval);
      billingInterval = null;
    }
    try {
      liveSession?.close?.();
    } catch {
      // ignore close error
    }
    liveSession = null;
  };

  try {
    const ai = getGeminiClient();
    const systemInstruction = buildCompanionSystemInstruction({
      voiceName: voice.provider_voice_name,
      companionName: voice.name,
      gender: voice.gender,
      personalityPrompt: voice.personality_prompt,
      mode: modeParam,
      languageName: langParam === 'auto' ? 'Auto-Detect' : langRow?.name || 'Auto-Detect',
      userName: profile?.display_name || 'Friend',
    });

    liveSession = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice.provider_voice_name || 'Kore' },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction,
      },
      callbacks: {
        onopen: () => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                type: 'ready',
                voice: { id: voice.id, name: voice.name, gender: voice.gender },
                wallet: getWallet(user.id),
              })
            );
          }
        },
        onmessage: (message: LiveServerMessage) => {
          if (clientWs.readyState !== WebSocket.OPEN) return;
          const content = message.serverContent;
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              clientWs.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
            }
          }
          if (content?.inputTranscription?.text) {
            clientWs.send(JSON.stringify({ type: 'input_transcript', text: content.inputTranscription.text }));
          }
          if (content?.outputTranscription?.text) {
            clientWs.send(JSON.stringify({ type: 'output_transcript', text: content.outputTranscription.text }));
          }
          if (content?.interrupted) {
            clientWs.send(JSON.stringify({ type: 'interrupted' }));
          }
        },
        onerror: (err: any) => {
          console.error('Gemini Live error:', err);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'error', error: err?.message || 'Live voice stream error' }));
          }
        },
        onclose: () => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'session_closed' }));
          }
        },
      },
    });

    // Server-authoritative 1-second billing ticker starting when live call connects
    billingInterval = setInterval(() => {
      if (clientWs.readyState !== WebSocket.OPEN) {
        cleanup();
        return;
      }
      tickIndex += 1;
      const result = deductUsageSeconds({
        userId: user.id,
        sessionId: sessionRow.id,
        eventId: `live:${sessionRow.id}:${callInstanceId}:${tickIndex}`,
        seconds: 1,
        description: `Live call (${voice.name})`,
      });

      clientWs.send(
        JSON.stringify({
          type: 'wallet_tick',
          wallet: result.balance,
          remainingSeconds: result.balance.totalAvailableSeconds,
        })
      );

      if (!lowWarningSent && result.balance.totalAvailableSeconds > 0 && result.balance.totalAvailableSeconds <= 60) {
        lowWarningSent = true;
        clientWs.send(
          JSON.stringify({
            type: 'low_balance_warning',
            remainingSeconds: result.balance.totalAvailableSeconds,
          })
        );
      }

      if (result.exhausted) {
        clientWs.send(JSON.stringify({ type: 'balance_exhausted', wallet: result.balance }));
        cleanup();
        clientWs.close();
      }
    }, 1000);

    clientWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'audio' && msg.data && liveSession) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && msg.text && liveSession) {
          liveSession.sendRealtimeInput({ text: String(msg.text) });
        }
      } catch {
        // ignore malformed packets
      }
    });

    clientWs.on('close', () => {
      cleanup();
    });
  } catch (err: any) {
    console.error('Failed to connect Gemini Live session:', err);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', error: err?.message || 'Could not start live AI voice call.' }));
      clientWs.close();
    }
    cleanup();
  }
});

// ==================== VITE / STATIC SERVING ====================

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`DIL SE AI server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
