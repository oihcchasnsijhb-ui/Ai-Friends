// Shared Mobile API Client for Android & iOS connecting to the unified DIL SE AI backend

export interface MobileApiConfig {
  baseUrl: string;
  token: string | null;
}

export class DilSeMobileClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Network request failed');
    }
    return data as T;
  }

  requestOtp(phone: string) {
    return this.request('/api/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  }

  verifyOtp(payload: {
    otpId: string;
    phone: string;
    code: string;
    countryCode: string;
    languageCode: string;
    consentAccepted: boolean;
  }) {
    return this.request('/api/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getCatalog(countryCode: string) {
    return this.request(`/api/catalog?country=${encodeURIComponent(countryCode)}`);
  }

  getWallet() {
    return this.request('/api/wallet');
  }

  createOrder(packageId: string, countryCode: string, idempotencyKey: string) {
    return this.request('/api/payments/create-order', {
      method: 'POST',
      body: JSON.stringify({ packageId, countryCode, idempotencyKey }),
    });
  }

  createSession(payload: {
    voiceId: string;
    mode: 'live_call' | 'voice_message' | 'text_chat';
    conversationStyle: string;
    languageCode: string;
  }) {
    return this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getLiveCallWebSocketUrl(params: {
    sessionId: string;
    voiceId: string;
    mode: string;
    lang: string;
  }): string {
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    return `${wsBase}/ws/live-call?token=${encodeURIComponent(this.token || '')}&sessionId=${encodeURIComponent(params.sessionId)}&voiceId=${encodeURIComponent(params.voiceId)}&mode=${encodeURIComponent(params.mode)}&lang=${encodeURIComponent(params.lang)}`;
  }
}
