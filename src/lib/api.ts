// Client API wrapper — stores session token strictly in memory (never localStorage)

let inMemoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  inMemoryToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export function detectLocaleDefaults(): {
  countryCode: string;
  timezone: string;
  languageCode: string;
} {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const navLang = (navigator.language || 'en-US').toLowerCase();

  let countryCode = 'US';
  if (timezone.startsWith('Asia/Kolkata') || timezone.startsWith('Asia/Calcutta') || navLang.endsWith('-in')) {
    countryCode = 'IN';
  } else if (timezone.startsWith('Europe/London') || navLang.endsWith('-gb')) {
    countryCode = 'GB';
  } else if (timezone.startsWith('Asia/Dubai')) {
    countryCode = 'AE';
  } else if (timezone.startsWith('Asia/Singapore')) {
    countryCode = 'SG';
  } else if (timezone.startsWith('Australia/')) {
    countryCode = 'AU';
  } else if (timezone.startsWith('Europe/Berlin')) {
    countryCode = 'DE';
  } else if (timezone.startsWith('Asia/Tokyo')) {
    countryCode = 'JP';
  } else if (timezone.startsWith('America/Toronto') || timezone.startsWith('America/Vancouver')) {
    countryCode = 'CA';
  }

  let languageCode = 'en';
  if (navLang.startsWith('hi')) languageCode = 'hi';
  else if (navLang.startsWith('es')) languageCode = 'es';
  else if (navLang.startsWith('fr')) languageCode = 'fr';
  else if (navLang.startsWith('ar')) languageCode = 'ar';
  else if (navLang.startsWith('ja')) languageCode = 'ja';

  return { countryCode, timezone, languageCode };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };

  if (inMemoryToken) {
    headers.Authorization = `Bearer ${inMemoryToken}`;
  }

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || 'Unexpected server response' };
  }

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`) as Error & {
      status?: number;
      code?: string;
      data?: any;
    };
    err.status = res.status;
    err.code = data.code;
    err.data = data;
    throw err;
  }

  return data as T;
}

export function formatDurationMMSS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
