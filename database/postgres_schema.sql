-- DIL SE AI — Production PostgreSQL Schema
-- All 14 relational tables with strict constraints, idempotency guarantees, and indexes.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS countries (
  code CHAR(2) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  currency CHAR(3) NOT NULL CHECK (currency IN ('INR', 'USD')),
  tax_name VARCHAR(64) NOT NULL,
  tax_rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  gateway VARCHAR(32) NOT NULL CHECK (gateway IN ('razorpay', 'stripe')),
  is_supported BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(32) UNIQUE,
  password_hash TEXT,
  role VARCHAR(24) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  country_code CHAR(2) NOT NULL DEFAULT 'US' REFERENCES countries(code),
  language_code VARCHAR(16) NOT NULL DEFAULT 'en',
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_contact_check CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX idx_users_country ON users(country_code);
CREATE INDEX idx_users_active ON users(is_active) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(80) NOT NULL,
  gender VARCHAR(16) NOT NULL CHECK (gender IN ('female', 'male')),
  provider_voice_name VARCHAR(64) NOT NULL,
  tagline VARCHAR(180) NOT NULL,
  personality_prompt TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(100) NOT NULL,
  preferred_voice_id UUID REFERENCES voice_profiles(id),
  preferred_mode VARCHAR(32) NOT NULL DEFAULT 'friendship',
  bio_notes TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes >= 15),
  inr_price_paise INTEGER NOT NULL CHECK (inr_price_paise > 0),
  usd_price_cents INTEGER NOT NULL CHECK (usd_price_cents > 0),
  region_scope VARCHAR(16) NOT NULL DEFAULT 'global' CHECK (region_scope IN ('india', 'international', 'global')),
  description VARCHAR(240) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_packages_active_sort ON packages(is_active, sort_order);

CREATE TABLE IF NOT EXISTS pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  currency CHAR(3) NOT NULL CHECK (currency IN ('INR', 'USD')),
  min_minutes INTEGER NOT NULL DEFAULT 15 CHECK (min_minutes >= 15),
  tax_rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code)
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  paid_seconds INTEGER NOT NULL DEFAULT 0 CHECK (paid_seconds >= 0),
  trial_seconds INTEGER NOT NULL DEFAULT 120 CHECK (trial_seconds >= 0),
  total_purchased_seconds INTEGER NOT NULL DEFAULT 0,
  total_used_seconds INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES packages(id),
  gateway VARCHAR(32) NOT NULL CHECK (gateway IN ('razorpay', 'stripe', 'apple_iap', 'google_play')),
  currency CHAR(3) NOT NULL CHECK (currency IN ('INR', 'USD')),
  subtotal_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes >= 15),
  idempotency_key VARCHAR(128) UNIQUE NOT NULL,
  gateway_order_id VARCHAR(128),
  gateway_payment_id VARCHAR(128) UNIQUE,
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'refunded')),
  refund_reason TEXT,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_user_created ON payments(user_id, created_at DESC);
CREATE INDEX idx_payments_status ON payments(status);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(24) NOT NULL CHECK (type IN ('credit_purchase', 'debit_usage', 'refund_reversal', 'admin_adjustment')),
  seconds_delta INTEGER NOT NULL,
  balance_after_seconds INTEGER NOT NULL,
  reference_id VARCHAR(128),
  description VARCHAR(240) NOT NULL,
  idempotency_key VARCHAR(128) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_tx_user ON wallet_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voice_id UUID NOT NULL REFERENCES voice_profiles(id),
  mode VARCHAR(24) NOT NULL CHECK (mode IN ('live_call', 'voice_message', 'text_chat')),
  conversation_style VARCHAR(32) NOT NULL,
  language_code VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'terminated_zero_balance')),
  billed_seconds INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user_started ON sessions(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender VARCHAR(16) NOT NULL CHECK (sender IN ('user', 'ai', 'system')),
  content TEXT NOT NULL,
  audio_duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_session ON messages(session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id VARCHAR(160) UNIQUE NOT NULL,
  seconds_deducted INTEGER NOT NULL CHECK (seconds_deducted > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_logs_user ON usage_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tickets_status ON support_tickets(status, created_at DESC);
