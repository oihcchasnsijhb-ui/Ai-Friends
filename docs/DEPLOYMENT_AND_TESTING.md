# DIL SE AI — Deployment, Security & Testing Guide

## 1. Architecture Summary
- **Web Frontend**: React 19 + TypeScript + Tailwind CSS v4 (Obsidian & Dark Plum theme, real-time AudioWorklet/WebAudio 16kHz mic capture + 24kHz gapless playback).
- **Backend API & Live Voice Bridge**: Node.js + Express + TypeScript (`server.ts`) + WebSocket Server (`/ws/live-call`).
- **AI Engine**: Server-side `@google/genai` SDK (`gemini-4-hydrogen` conversational text, `gemini-3.8-flash-lite-tts` male/female speech synthesis, `gemini-3.5-transcribe` voice message transcription, `gemini-3.8-live` real-time bidirectional audio).
- **Database**: Local ACID SQLite (`node:sqlite`) active in preview with all 14 relational tables; complete PostgreSQL production schema provided in `database/postgres_schema.sql`.
- **Mobile Apps**: React Native (`mobile/`) supporting Android & iOS with shared API client, Razorpay/Stripe SDKs, and Apple IAP / Google Play Billing hooks.

## 2. Environment Variables
Copy `.env.example` to `.env` (or configure secrets in your hosting control panel):
- `GEMINI_API_KEY`: Required for AI chat, TTS, transcription, and Live Voice calls.
- `SESSION_SECRET`: HMAC-SHA256 signing secret for Bearer tokens.
- `ADMIN_PASSCODE`: Admin console access passcode (or claim once via first-run Admin Setup UI).
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`: Required for Indian INR billing.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: Required for international USD billing.
- `DATABASE_URL` / `REDIS_URL`: Optional external PostgreSQL & Redis connection strings for multi-instance production scaling.

## 3. Running & Deploying
```bash
npm install
npm run lint
npm run build
npm run start
```
For PostgreSQL setup in production:
```bash
psql "$DATABASE_URL" -f database/postgres_schema.sql
```

## 4. Payment & Webhook Verification Checklist
1. **Minimum Package**: All paid packages enforce `minutes >= 15` at both schema (`CHECK (minutes >= 15)`) and API layers.
2. **Regional Currency & Taxes**: India (`IN`) quotes INR with GST (18% default); international countries quote USD with regional VAT/Sales Tax displayed before payment.
3. **Zero Fake Activations**: `POST /api/payments/create-order` leaves orders in `pending` state unless gateway credentials are configured and cryptographic verification succeeds (`POST /api/payments/verify-razorpay`, `/api/webhooks/razorpay`, or `/api/webhooks/stripe`).
4. **Idempotent Wallet Billing**:
   - `usage_logs.event_id` is `UNIQUE`, guaranteeing a single usage tick or voice message can never deduct minutes twice.
   - `wallet_transactions.idempotency_key` is `UNIQUE`, guaranteeing verified purchases and refunds apply once.
   - Live calls run a server-side 1-second ticker that emits a low-balance warning at `<= 60s` and terminates the WebSocket & Gemini Live session automatically when balance reaches `00:00`.
