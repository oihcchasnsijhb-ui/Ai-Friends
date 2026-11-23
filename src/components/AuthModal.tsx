import React, { useState } from 'react';
import { X, Phone, Mail, ShieldCheck } from 'lucide-react';
import { apiRequest, detectLocaleDefaults, setAuthToken } from '../lib/api';
import type { AuthUser, CountryInfo, LanguageInfo, UserProfile, WalletBalance } from '../types';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  countries: CountryInfo[];
  languages: LanguageInfo[];
  onAuthenticated: (payload: {
    user: AuthUser;
    profile: UserProfile;
    wallet: WalletBalance;
  }) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  onClose,
  countries,
  languages,
  onAuthenticated,
}) => {
  const defaults = detectLocaleDefaults();
  const [authMethod, setAuthMethod] = useState<'email' | 'otp'>('email');
  const [isRegister, setIsRegister] = useState(true);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('+91');
  const [otpId, setOtpId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [previewOtp, setPreviewOtp] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState(defaults.countryCode);
  const [languageCode, setLanguageCode] = useState(defaults.languageCode);
  const [consentAccepted, setConsentAccepted] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const data = await apiRequest<{
        token: string;
        user: AuthUser;
        profile: UserProfile;
        wallet: WalletBalance;
      }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          displayName,
          countryCode,
          languageCode,
          timezone: defaults.timezone,
          consentAccepted,
        }),
      });
      setAuthToken(data.token);
      onAuthenticated({ user: data.user, profile: data.profile, wallet: data.wallet });
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        otpId: string;
        previewVerificationCode?: string;
      }>('/api/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setOtpId(res.otpId);
      setPreviewOtp(res.previewVerificationCode || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpId) return;
    setError(null);
    setLoading(true);
    try {
      const data = await apiRequest<{
        token: string;
        user: AuthUser;
        profile: UserProfile;
        wallet: WalletBalance;
      }>('/api/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({
          otpId,
          phone,
          code: otpCode,
          displayName,
          countryCode,
          languageCode,
          timezone: defaults.timezone,
          consentAccepted,
        }),
      });
      setAuthToken(data.token);
      onAuthenticated({ user: data.user, profile: data.profile, wallet: data.wallet });
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/12 bg-[#110D1B] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-white">
              {authMethod === 'email'
                ? isRegister
                  ? 'Create Your DIL SE AI Account'
                  : 'Welcome Back'
                : 'Mobile OTP Sign In'}
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Your AI Friend, Always Ready to Talk · 02:00 evaluation trial included
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/6 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Auth method switcher */}
        <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg bg-[#07060B] p-1 border border-white/8">
          <button
            type="button"
            onClick={() => {
              setAuthMethod('email');
              setError(null);
            }}
            className={`flex items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition-colors cursor-pointer ${
              authMethod === 'email' ? 'bg-[#181226] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Mail className="h-3.5 w-3.5" />
            Email Login
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMethod('otp');
              setError(null);
            }}
            className={`flex items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition-colors cursor-pointer ${
              authMethod === 'otp' ? 'bg-[#181226] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Phone className="h-3.5 w-3.5" />
            Mobile OTP
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
            {error}
          </div>
        )}

        {authMethod === 'email' ? (
          <form onSubmit={handleEmailSubmit} className="mt-5 space-y-3.5">
            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How should Ananya & Kabir address you?"
                  className="w-full rounded-lg border border-white/10 bg-[#07060B] px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-pink-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-white/10 bg-[#07060B] px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-pink-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full rounded-lg border border-white/10 bg-[#07060B] px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-pink-500 focus:outline-none"
              />
            </div>

            {isRegister && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Country</label>
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#07060B] px-2.5 py-2 text-xs text-white focus:border-pink-500 focus:outline-none"
                  >
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.currency})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Language</label>
                  <select
                    value={languageCode}
                    onChange={(e) => setLanguageCode(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#07060B] px-2.5 py-2 text-xs text-white focus:border-pink-500 focus:outline-none"
                  >
                    {languages.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name} ({l.native_name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {isRegister && (
              <label className="flex items-start gap-2.5 text-xs text-zinc-400 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={consentAccepted}
                  onChange={(e) => setConsentAccepted(e.target.checked)}
                  className="mt-0.5 accent-pink-500"
                />
                <span>
                  I understand DIL SE AI companions are AI-generated voices, not human persons, and I accept the privacy terms.
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gradient-to-r from-pink-600 to-blue-600 py-2.5 text-sm font-semibold text-white hover:from-pink-500 hover:to-blue-500 disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsRegister(!isRegister);
                  setError(null);
                }}
                className="text-xs text-zinc-400 hover:text-white cursor-pointer"
              >
                {isRegister ? 'Already have an account? Sign in' : 'New to DIL SE AI? Create account'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="mt-5 space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Mobile Number (with country code)</label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+919876543210"
                  className="flex-1 rounded-lg border border-white/10 bg-[#07060B] px-3 py-2.5 text-sm text-white font-mono focus:border-pink-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={loading}
                  className="rounded-lg border border-white/12 bg-[#181226] px-3.5 py-2 text-xs font-semibold text-white hover:border-pink-500/50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {otpId ? 'Resend' : 'Send OTP'}
                </button>
              </div>
            </div>

            {previewOtp && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
                SMS gateway not configured in preview · Verification code:{' '}
                <span className="font-mono font-bold text-white">{previewOtp}</span>
              </div>
            )}

            {otpId && (
              <>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">6-Digit OTP Code</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    className="w-full rounded-lg border border-white/10 bg-[#07060B] px-3 py-2.5 text-sm text-white font-mono tracking-widest focus:border-pink-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Name (for new accounts)</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your first name"
                    className="w-full rounded-lg border border-white/10 bg-[#07060B] px-3 py-2 text-sm text-white focus:border-pink-500 focus:outline-none"
                  />
                </div>

                <label className="flex items-start gap-2.5 text-xs text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-0.5 accent-pink-500"
                  />
                  <span>
                    I acknowledge DIL SE AI provides AI-generated voice companions and accept the privacy terms.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-gradient-to-r from-pink-600 to-blue-600 py-2.5 text-sm font-semibold text-white hover:from-pink-500 hover:to-blue-500 disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Verifying...' : 'Verify & Continue'}
                </button>
              </>
            )}
          </form>
        )}

        <div className="mt-4 flex items-center gap-2 border-t border-white/8 pt-3 text-[11px] text-zinc-500">
          <ShieldCheck className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
          <span>Session tokens stay in memory; passwords use salted scrypt hashing.</span>
        </div>
      </div>
    </div>
  );
};
