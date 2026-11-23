export type NavSection = 'discover' | 'studio' | 'pricing' | 'admin';

export type ConversationMode =
  | 'auto'
  | 'romantic'
  | 'friendship'
  | 'funny'
  | 'daily_life'
  | 'stories';

export interface CountryInfo {
  code: string;
  name: string;
  currency: 'INR' | 'USD';
  tax_name: string;
  tax_rate_percent: number;
  gateway: 'razorpay' | 'stripe';
  is_supported: number;
}

export interface LanguageInfo {
  code: string;
  name: string;
  native_name: string;
  is_active: number;
}

export interface VoiceProfile {
  id: string;
  slug: string;
  name: string;
  gender: 'female' | 'male';
  provider_voice_name: string;
  tagline: string;
  avatar_url: string;
  is_active: number;
}

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

export interface PackageItem {
  id: string;
  name: string;
  minutes: number;
  inr_price_paise: number;
  usd_price_cents: number;
  region_scope: string;
  description: string;
  quote: PriceQuote;
}

export interface WalletBalance {
  userId: string;
  paidSeconds: number;
  trialSeconds: number;
  totalAvailableSeconds: number;
  totalPurchasedSeconds: number;
  totalUsedSeconds: number;
}

export interface WalletTransaction {
  id: string;
  type: string;
  seconds_delta: number;
  balance_after_seconds: number;
  reference_id: string | null;
  description: string;
  created_at: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  role: 'user' | 'admin';
  countryCode: string;
  languageCode: string;
  timezone: string;
  consentAccepted: boolean;
}

export interface UserProfile {
  user_id: string;
  display_name: string;
  preferred_voice_id: string;
  preferred_mode: ConversationMode;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'system';
  content: string;
  audio_duration_seconds?: number;
  audioBase64?: string;
  detectedLanguage?: string;
  detectedStyle?: string;
  created_at?: string;
}
