import React, { useEffect, useState } from 'react';
import { Lock, RefreshCw, RotateCcw } from 'lucide-react';
import { apiRequest, formatDurationMMSS, setAuthToken } from '../lib/api';
import type { AuthUser, WalletBalance } from '../types';

interface AdminDashboardViewProps {
  user: AuthUser | null;
  onAdminAuthenticated: (user: AuthUser, wallet: WalletBalance) => void;
  onCatalogUpdated: () => void;
}

type AdminTab = 'overview' | 'payments' | 'sessions' | 'voices' | 'pricing' | 'users';

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  user,
  onAdminAuthenticated,
  onCatalogUpdated,
}) => {
  const [adminStatus, setAdminStatus] = useState<{ hasEnvPasscode: boolean; hasClaimedAdmin: boolean } | null>(null);
  const [passcode, setPasscode] = useState('');
  const [adminEmail, setAdminEmail] = useState('admin@dilse.ai');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [config, setConfig] = useState<{
    voices: any[];
    packages: any[];
    pricingRules: any[];
    languages: any[];
    tickets: any[];
  } | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [refundTargetId, setRefundTargetId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('Customer support refund');

  useEffect(() => {
    apiRequest<{ hasEnvPasscode: boolean; hasClaimedAdmin: boolean }>('/api/auth/admin-status')
      .then(setAdminStatus)
      .catch(() => {});
  }, []);

  const loadAllAdminData = async () => {
    try {
      const [ov, pay, sess, usr, cfg] = await Promise.all([
        apiRequest<any>('/api/admin/overview'),
        apiRequest<{ payments: any[] }>('/api/admin/payments'),
        apiRequest<{ sessions: any[] }>('/api/admin/sessions'),
        apiRequest<{ users: any[] }>('/api/admin/users'),
        apiRequest<any>('/api/admin/config'),
      ]);
      setOverview(ov);
      setPayments(pay.payments);
      setSessions(sess.sessions);
      setUsers(usr.users);
      setConfig(cfg);
    } catch (err: any) {
      setActionMsg(err.message);
    }
  };

  useEffect(() => {
    if (user?.role === 'admin') {
      loadAllAdminData();
    }
  }, [user]);

  const handleAdminAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const isBootstrapNeeded = adminStatus && !adminStatus.hasEnvPasscode && !adminStatus.hasClaimedAdmin;
      const endpoint = isBootstrapNeeded ? '/api/auth/admin-claim' : '/api/auth/admin-login';
      const res = await apiRequest<{ token: string; user: AuthUser; wallet: WalletBalance }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ passcode, email: adminEmail }),
      });
      setAuthToken(res.token);
      onAdminAuthenticated(res.user, res.wallet);
      setPasscode('');
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  if (user?.role !== 'admin') {
    const isBootstrap = adminStatus && !adminStatus.hasEnvPasscode && !adminStatus.hasClaimedAdmin;
    return (
      <div className="mx-auto max-w-md px-6 py-20">
        <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-7">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[#181226] p-2.5 border border-white/10">
              <Lock className="h-4 w-4 text-pink-400" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-white">
                {isBootstrap ? 'Claim First-Run Admin Access' : 'Admin Console Sign In'}
              </h1>
              <p className="text-xs text-zinc-400">
                {isBootstrap
                  ? 'Set the initial server-verified administrator passcode.'
                  : 'Enter your administrator passcode to access operations.'}
              </p>
            </div>
          </div>

          {authError && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {authError}
            </div>
          )}

          <form onSubmit={handleAdminAuth} className="mt-5 space-y-4">
            {isBootstrap && (
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Admin Email</label>
                <input
                  type="email"
                  required
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#07060B] px-3 py-2.5 text-sm text-white focus:border-pink-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                {isBootstrap ? 'Choose Admin Passcode (min 8 chars)' : 'Admin Passcode'}
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter passcode"
                className="w-full rounded-lg border border-white/10 bg-[#07060B] px-3 py-2.5 text-sm text-white focus:border-pink-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full rounded-lg bg-gradient-to-r from-pink-600 to-blue-600 py-2.5 text-sm font-semibold text-white hover:from-pink-500 hover:to-blue-500 disabled:opacity-50 cursor-pointer"
            >
              {authLoading ? 'Verifying...' : isBootstrap ? 'Claim Admin Access' : 'Unlock Admin Console'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const handleRefund = async (paymentId: string) => {
    try {
      await apiRequest(`/api/admin/payments/${paymentId}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: refundReason.trim() || 'Customer support refund' }),
      });
      setActionMsg('Payment refunded and unused wallet minutes reversed.');
      setRefundTargetId(null);
      await loadAllAdminData();
    } catch (err: any) {
      setActionMsg(err.message);
    }
  };

  const handleUpdatePackage = async (pkg: any, inrRupees: number, usdDollars: number, minutes: number) => {
    try {
      await apiRequest(`/api/admin/packages/${pkg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          minutes,
          inr_price_paise: Math.round(inrRupees * 100),
          usd_price_cents: Math.round(usdDollars * 100),
        }),
      });
      setActionMsg(`Updated ${pkg.name} pricing.`);
      onCatalogUpdated();
      await loadAllAdminData();
    } catch (err: any) {
      setActionMsg(err.message);
    }
  };

  const handleUpdateCountryRule = async (countryCode: string, taxRate: number, discount: number) => {
    try {
      await apiRequest(`/api/admin/pricing-rules/${countryCode}`, {
        method: 'PATCH',
        body: JSON.stringify({ tax_rate_percent: taxRate, discount_percent: discount }),
      });
      setActionMsg(`Updated tax/discount rule for ${countryCode}.`);
      onCatalogUpdated();
      await loadAllAdminData();
    } catch (err: any) {
      setActionMsg(err.message);
    }
  };

  const handleToggleLanguage = async (code: string, currentActive: number) => {
    await apiRequest(`/api/admin/languages/${code}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !currentActive }),
    });
    onCatalogUpdated();
    await loadAllAdminData();
  };

  const handleUpdateVoice = async (voice: any, tagline: string) => {
    await apiRequest(`/api/admin/voices/${voice.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tagline }),
    });
    setActionMsg(`Updated ${voice.name} voice configuration.`);
    onCatalogUpdated();
    await loadAllAdminData();
  };

  const handleToggleUser = async (u: any) => {
    await apiRequest(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !u.is_active }),
    });
    await loadAllAdminData();
  };

  const handleTicketStatus = async (ticketId: string, status: string) => {
    await apiRequest(`/api/admin/tickets/${ticketId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await loadAllAdminData();
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/8 pb-5">
        <div>
          <p className="text-xs text-zinc-400">Admin Console / Operations</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-white">DIL SE AI Administration</h1>
        </div>
        <button
          type="button"
          onClick={loadAllAdminData}
          className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-[#110D1B] px-3.5 py-2 text-xs font-medium text-white hover:border-pink-500/40 cursor-pointer self-start"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Data
        </button>
      </div>

      {actionMsg && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-xs text-blue-200">
          {actionMsg}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-[#110D1B] p-1 w-fit">
        {(
          [
            { id: 'overview', label: 'Analytics' },
            { id: 'payments', label: 'Payments & Refunds' },
            { id: 'sessions', label: 'AI Sessions' },
            { id: 'voices', label: 'Voices & Languages' },
            { id: 'pricing', label: 'Packages & Country Pricing' },
            { id: 'users', label: 'Users & Tickets' },
          ] as Array<{ id: AdminTab; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              tab === t.id ? 'bg-[#181226] text-white border border-white/10' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && overview && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="rounded-xl border border-white/10 bg-[#110D1B] p-5">
              <p className="text-xs text-zinc-400">Total Users</p>
              <p className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">{overview.totalUsers}</p>
              <p className="mt-1 text-xs text-zinc-500 tabular-nums">{overview.activeUsers} active accounts</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#110D1B] p-5">
              <p className="text-xs text-zinc-400">AI Sessions</p>
              <p className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">{overview.totalSessions}</p>
              <p className="mt-1 text-xs text-zinc-500 tabular-nums">
                {overview.activeSessions} active · {overview.totalMinutesUsed} min billed
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#110D1B] p-5">
              <p className="text-xs text-zinc-400">India Revenue (INR)</p>
              <p className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
                {overview.revenueByCurrency.INR.formattedTotal}
              </p>
              <p className="mt-1 text-xs text-zinc-500 tabular-nums">
                Today {overview.revenueByCurrency.INR.formattedDaily} · Month {overview.revenueByCurrency.INR.formattedMonthly}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#110D1B] p-5">
              <p className="text-xs text-zinc-400">Global Revenue (USD)</p>
              <p className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
                {overview.revenueByCurrency.USD.formattedTotal}
              </p>
              <p className="mt-1 text-xs text-zinc-500 tabular-nums">
                Today {overview.revenueByCurrency.USD.formattedDaily} · Month {overview.revenueByCurrency.USD.formattedMonthly}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6">
            <h2 className="font-display text-base font-bold text-white">Platform Operational Summary</h2>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-zinc-300">
              <div>
                <p className="text-zinc-400">Active Voice Profiles</p>
                <p className="mt-1 font-mono text-lg text-white tabular-nums">{config?.voices.filter((v) => v.is_active).length || 2}</p>
              </div>
              <div>
                <p className="text-zinc-400">Active Languages</p>
                <p className="mt-1 font-mono text-lg text-white tabular-nums">{config?.languages.filter((l) => l.is_active).length || 7}</p>
              </div>
              <div>
                <p className="text-zinc-400">Open Support Tickets</p>
                <p className="mt-1 font-mono text-lg text-white tabular-nums">
                  {config?.tickets.filter((t) => t.status === 'open').length || 0}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'payments' && (
        <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6 overflow-x-auto">
          <h2 className="font-display text-base font-bold text-white mb-4">Payment & Refund Ledger</h2>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/8 text-zinc-400">
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Package</th>
                <th className="py-2 pr-4">Gateway</th>
                <th className="py-2 pr-4 text-right">Amount</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2.5 pr-4 text-zinc-200">{p.user_email || p.user_phone}</td>
                  <td className="py-2.5 pr-4 text-white">{p.package_name} ({p.minutes}m)</td>
                  <td className="py-2.5 pr-4 uppercase text-zinc-400">{p.gateway}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-white">
                    {p.currency} {(p.total_minor / 100).toFixed(2)}
                  </td>
                  <td className="py-2.5 pr-4 capitalize text-zinc-300">{p.status}</td>
                  <td className="py-2.5 text-right">
                    {p.status === 'verified' ? (
                      refundTargetId === p.id ? (
                        <div className="inline-flex items-center gap-1.5">
                          <input
                            type="text"
                            value={refundReason}
                            onChange={(e) => setRefundReason(e.target.value)}
                            className="w-36 rounded border border-white/15 bg-[#07060B] px-2 py-1 text-[11px] text-white"
                            placeholder="Reason"
                          />
                          <button
                            type="button"
                            onClick={() => handleRefund(p.id)}
                            className="rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setRefundTargetId(null)}
                            className="rounded bg-white/10 px-2 py-1 text-[11px] text-zinc-300 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRefundTargetId(p.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-white/12 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-red-400 cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Refund
                        </button>
                      )
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-zinc-500">
                    No payment orders recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'sessions' && (
        <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6 overflow-x-auto">
          <h2 className="font-display text-base font-bold text-white mb-4">AI Session History</h2>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/8 text-zinc-400">
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Voice</th>
                <th className="py-2 pr-4">Mode</th>
                <th className="py-2 pr-4">Language</th>
                <th className="py-2 pr-4 text-right">Billed</th>
                <th className="py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="py-2.5 pr-4 text-zinc-200">{s.user_email || s.user_phone}</td>
                  <td className="py-2.5 pr-4 text-white">{s.voice_name}</td>
                  <td className="py-2.5 pr-4 text-zinc-300">{s.mode} · {s.conversation_style}</td>
                  <td className="py-2.5 pr-4 uppercase text-zinc-400">{s.language_code}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-white">
                    {formatDurationMMSS(s.billed_seconds)}
                  </td>
                  <td className="py-2.5 text-right text-zinc-400">{s.status}</td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-zinc-500">
                    No AI sessions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'voices' && config && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-white">Voice Settings</h2>
            {config.voices.map((v) => (
              <div key={v.id} className="rounded-xl border border-white/8 bg-[#07060B] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">
                    {v.name} ({v.gender})
                  </p>
                  <span className="font-mono text-xs text-zinc-400">{v.provider_voice_name}</span>
                </div>
                <input
                  type="text"
                  defaultValue={v.tagline}
                  onBlur={(e) => {
                    if (e.target.value !== v.tagline) handleUpdateVoice(v, e.target.value);
                  }}
                  className="w-full rounded-lg border border-white/10 bg-[#110D1B] px-3 py-2 text-xs text-zinc-200 focus:border-pink-500 focus:outline-none"
                />
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-white">Language Management</h2>
            <div className="divide-y divide-white/8">
              {config.languages.map((l) => (
                <div key={l.code} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <span className="font-medium text-white">{l.name}</span>
                    <span className="ml-2 text-zinc-400">{l.native_name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleLanguage(l.code, l.is_active)}
                    className={`rounded-md px-3 py-1 font-medium cursor-pointer ${
                      l.is_active
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-white/5 text-zinc-400 border border-white/10'
                    }`}
                  >
                    {l.is_active ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'pricing' && config && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6 overflow-x-auto">
            <h2 className="font-display text-base font-bold text-white mb-4">
              Package Configuration (Minimum 15 Minutes)
            </h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/8 text-zinc-400">
                  <th className="py-2 pr-4">Package</th>
                  <th className="py-2 pr-4">Minutes</th>
                  <th className="py-2 pr-4">India (INR ₹)</th>
                  <th className="py-2 pr-4">Global (USD $)</th>
                  <th className="py-2 text-right">Scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {config.packages.map((pkg) => (
                  <tr key={pkg.id}>
                    <td className="py-2.5 pr-4 font-medium text-white">{pkg.name}</td>
                    <td className="py-2.5 pr-4">
                      <input
                        type="number"
                        min={15}
                        defaultValue={pkg.minutes}
                        onBlur={(e) =>
                          handleUpdatePackage(
                            pkg,
                            pkg.inr_price_paise / 100,
                            pkg.usd_price_cents / 100,
                            Number(e.target.value)
                          )
                        }
                        className="w-20 rounded border border-white/10 bg-[#07060B] px-2 py-1 font-mono text-white"
                      />
                    </td>
                    <td className="py-2.5 pr-4">
                      <input
                        type="number"
                        min={1}
                        defaultValue={pkg.inr_price_paise / 100}
                        onBlur={(e) =>
                          handleUpdatePackage(
                            pkg,
                            Number(e.target.value),
                            pkg.usd_price_cents / 100,
                            pkg.minutes
                          )
                        }
                        className="w-24 rounded border border-white/10 bg-[#07060B] px-2 py-1 font-mono text-white"
                      />
                    </td>
                    <td className="py-2.5 pr-4">
                      <input
                        type="number"
                        min={1}
                        defaultValue={pkg.usd_price_cents / 100}
                        onBlur={(e) =>
                          handleUpdatePackage(
                            pkg,
                            pkg.inr_price_paise / 100,
                            Number(e.target.value),
                            pkg.minutes
                          )
                        }
                        className="w-24 rounded border border-white/10 bg-[#07060B] px-2 py-1 font-mono text-white"
                      />
                    </td>
                    <td className="py-2.5 text-right capitalize text-zinc-400">{pkg.region_scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6 overflow-x-auto">
            <h2 className="font-display text-base font-bold text-white mb-4">Country-Wise Taxes & Discounts</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/8 text-zinc-400">
                  <th className="py-2 pr-4">Country</th>
                  <th className="py-2 pr-4">Currency</th>
                  <th className="py-2 pr-4">Tax Rate (%)</th>
                  <th className="py-2 pr-4">Discount (%)</th>
                  <th className="py-2 text-right">Gateway</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {config.pricingRules.map((r) => (
                  <tr key={r.country_code}>
                    <td className="py-2.5 pr-4 text-white">{r.country_name} ({r.country_code})</td>
                    <td className="py-2.5 pr-4 font-mono text-zinc-300">{r.currency}</td>
                    <td className="py-2.5 pr-4">
                      <input
                        type="number"
                        step="0.5"
                        defaultValue={r.tax_rate_percent}
                        onBlur={(e) =>
                          handleUpdateCountryRule(r.country_code, Number(e.target.value), r.discount_percent)
                        }
                        className="w-20 rounded border border-white/10 bg-[#07060B] px-2 py-1 font-mono text-white"
                      />
                    </td>
                    <td className="py-2.5 pr-4">
                      <input
                        type="number"
                        step="1"
                        defaultValue={r.discount_percent}
                        onBlur={(e) =>
                          handleUpdateCountryRule(r.country_code, r.tax_rate_percent, Number(e.target.value))
                        }
                        className="w-20 rounded border border-white/10 bg-[#07060B] px-2 py-1 font-mono text-white"
                      />
                    </td>
                    <td className="py-2.5 text-right uppercase text-zinc-400">{r.gateway}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6 overflow-x-auto">
            <h2 className="font-display text-base font-bold text-white mb-4">User Management</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/8 text-zinc-400">
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Region</th>
                  <th className="py-2 pr-4 text-right">Balance</th>
                  <th className="py-2 pr-4 text-right">Used</th>
                  <th className="py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 pr-4 text-white">
                      {u.display_name || 'User'} · {u.email || u.phone || 'Deleted'}
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-400">
                      {u.country_code} · {u.language_code}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-white">
                      {formatDurationMMSS((u.paid_seconds || 0) + (u.trial_seconds || 0))}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-zinc-400">
                      {formatDurationMMSS(u.total_used_seconds || 0)}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleUser(u)}
                        className="rounded border border-white/12 px-2.5 py-1 text-[11px] text-zinc-200 cursor-pointer"
                      >
                        {u.is_active ? 'Active' : 'Suspended'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {config && (
            <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6 overflow-x-auto">
              <h2 className="font-display text-base font-bold text-white mb-4">Support Tickets</h2>
              {config.tickets.length === 0 ? (
                <p className="text-xs text-zinc-500">No support tickets submitted.</p>
              ) : (
                <div className="space-y-3">
                  {config.tickets.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-4 rounded-xl border border-white/8 bg-[#07060B] p-4 text-xs">
                      <div>
                        <p className="font-semibold text-white">{t.subject}</p>
                        <p className="mt-1 text-zinc-400">{t.message}</p>
                        <p className="mt-1 text-[11px] text-zinc-500">{t.user_email || t.user_phone}</p>
                      </div>
                      <select
                        value={t.status}
                        onChange={(e) => handleTicketStatus(t.id, e.target.value)}
                        className="rounded border border-white/12 bg-[#110D1B] px-2.5 py-1.5 text-xs text-white"
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
