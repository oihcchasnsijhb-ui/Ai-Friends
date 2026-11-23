import crypto from 'node:crypto';
import { db } from './db.ts';

export interface PriceQuote {
  packageId: string;
  packageName: string;
  minutes: number;
  countryCode: string;
  currency: 'INR' | 'USD';
  gateway: 'razorpay' | 'stripe';
  taxName: string;
  taxRatePercent: number;
  discountPercent: number;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  formattedSubtotal: string;
  formattedTax: string;
  formattedTotal: string;
}

export function formatMinorCurrency(minor: number, currency: 'INR' | 'USD'): string {
  const major = minor / 100;
  if (currency === 'INR') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    }).format(major);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: major % 1 === 0 ? 0 : 2,
  }).format(major);
}

export function calculatePackageQuote(packageId: string, countryCode: string): PriceQuote {
  const pkg = db
    .prepare('SELECT id, name, minutes, inr_price_paise, usd_price_cents, is_active FROM packages WHERE id = ?')
    .get(packageId) as
    | {
        id: string;
        name: string;
        minutes: number;
        inr_price_paise: number;
        usd_price_cents: number;
        is_active: number;
      }
    | undefined;

  if (!pkg || !pkg.is_active) {
    throw new Error('Selected package is unavailable.');
  }
  if (pkg.minutes < 15) {
    throw new Error('Minimum paid package is 15 minutes.');
  }

  const normalizedCountry = (countryCode || 'US').toUpperCase();
  const country = (db
    .prepare('SELECT code, currency, tax_name, tax_rate_percent, gateway, is_supported FROM countries WHERE code = ?')
    .get(normalizedCountry) ||
    db
      .prepare("SELECT code, currency, tax_name, tax_rate_percent, gateway, is_supported FROM countries WHERE code = 'US'")
      .get()) as {
    code: string;
    currency: 'INR' | 'USD';
    tax_name: string;
    tax_rate_percent: number;
    gateway: 'razorpay' | 'stripe';
    is_supported: number;
  };

  if (!country.is_supported) {
    throw new Error(`Service is not currently supported in ${country.code}.`);
  }

  const rule = db
    .prepare('SELECT tax_rate_percent, discount_percent, min_minutes FROM pricing_rules WHERE country_code = ?')
    .get(country.code) as
    | { tax_rate_percent: number; discount_percent: number; min_minutes: number }
    | undefined;

  if (rule && pkg.minutes < rule.min_minutes) {
    throw new Error(`Minimum package for ${country.code} is ${rule.min_minutes} minutes.`);
  }

  const currency: 'INR' | 'USD' = country.code === 'IN' ? 'INR' : 'USD';
  const gateway: 'razorpay' | 'stripe' = currency === 'INR' ? 'razorpay' : 'stripe';
  const baseMinor = currency === 'INR' ? pkg.inr_price_paise : pkg.usd_price_cents;
  const discountPercent = rule?.discount_percent ?? 0;
  const discountedMinor = Math.round(baseMinor * (1 - discountPercent / 100));
  const taxRatePercent = rule?.tax_rate_percent ?? country.tax_rate_percent;
  const taxMinor = Math.round(discountedMinor * (taxRatePercent / 100));
  const totalMinor = discountedMinor + taxMinor;

  return {
    packageId: pkg.id,
    packageName: pkg.name,
    minutes: pkg.minutes,
    countryCode: country.code,
    currency,
    gateway,
    taxName: country.tax_name,
    taxRatePercent,
    discountPercent,
    subtotalMinor: discountedMinor,
    taxMinor,
    totalMinor,
    formattedSubtotal: formatMinorCurrency(discountedMinor, currency),
    formattedTax: formatMinorCurrency(taxMinor, currency),
    formattedTotal: formatMinorCurrency(totalMinor, currency),
  };
}

export function getGatewayAvailability() {
  return {
    razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || null,
  };
}

export async function createRazorpayOrder(params: {
  amountPaise: number;
  receiptId: string;
  notes: Record<string, string>;
}): Promise<{ id: string; amount: number; currency: string }> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_NOT_CONFIGURED');
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: params.amountPaise,
      currency: 'INR',
      receipt: params.receiptId,
      notes: params.notes,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Razorpay order creation failed: ${errText}`);
  }
  return (await res.json()) as { id: string; amount: number; currency: string };
}

export function verifyRazorpaySignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const body = `${params.orderId}|${params.paymentId}`;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(params.signature || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createStripeCheckoutSession(params: {
  amountCents: number;
  packageName: string;
  minutes: number;
  paymentId: string;
  userEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', params.successUrl);
  form.set('cancel_url', params.cancelUrl);
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][unit_amount]', String(params.amountCents));
  form.set('line_items[0][price_data][product_data][name]', `DIL SE AI — ${params.packageName} (${params.minutes} Minutes)`);
  form.set('line_items[0][quantity]', '1');
  form.set('metadata[paymentId]', params.paymentId);
  if (params.userEmail) {
    form.set('customer_email', params.userEmail);
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Stripe checkout creation failed: ${errText}`);
  }
  return (await res.json()) as { id: string; url: string };
}

export function verifyStripeWebhookSignature(rawBody: string, sigHeader: string): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return false;

  const parts = Object.fromEntries(
    sigHeader.split(',').map((item) => {
      const [k, v] = item.split('=');
      return [k?.trim(), v?.trim()];
    })
  );
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
