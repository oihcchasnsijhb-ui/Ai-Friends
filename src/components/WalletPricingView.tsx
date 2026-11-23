import React, { useEffect, useState } from 'react';
import { CreditCard, ShieldCheck, Receipt, AlertCircle } from 'lucide-react';
import { apiRequest, formatDurationMMSS } from '../lib/api';
import type {
  AuthUser,
  CountryInfo,
  PackageItem,
  WalletBalance,
  WalletTransaction,
} from '../types';

interface WalletPricingViewProps {
  user: AuthUser | null;
  wallet: WalletBalance | null;
  countries: CountryInfo[];
  selectedCountry: string;
  onChangeCountry: (code: string) => void;
  packages: PackageItem[];
  onOpenAuth: () => void;
}

export const WalletPricingView: React.FC<WalletPricingViewProps> = ({
  user,
  wallet,
  countries,
  selectedCountry,
  onChangeCountry,
  packages,
  onOpenAuth,
}) => {
  const [selectedPkg, setSelectedPkg] = useState<PackageItem | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<{
    type: 'info' | 'error' | 'config';
    title: string;
    detail: string;
    missingEnvVars?: string[];
  } | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [payments, setPayments] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    apiRequest<{ wallet: WalletBalance; transactions: WalletTransaction[] }>('/api/wallet')
      .then((res) => setTransactions(res.transactions))
      .catch(() => {});
    apiRequest<{ payments: any[] }>('/api/payments/history')
      .then((res) => setPayments(res.payments))
      .catch(() => {});
  }, [user]);

  const activeCountryObj = countries.find((c) => c.code === selectedCountry);

  const handleCreateOrder = async (pkg: PackageItem) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    setSelectedPkg(pkg);
    setCheckoutStatus(null);
    setLoadingOrder(true);
    try {
      const idempotencyKey = `web-${user.id.slice(0, 8)}-${pkg.id}-${Date.now()}`;
      const res = await apiRequest<any>('/api/payments/create-order', {
        method: 'POST',
        body: JSON.stringify({
          packageId: pkg.id,
          countryCode: selectedCountry,
          idempotencyKey,
        }),
      });

      if (res.status === 'configuration_required') {
        setCheckoutStatus({
          type: 'config',
          title: `${res.gateway === 'razorpay' ? 'Razorpay' : 'Stripe'} Gateway Credentials Required`,
          detail: res.message,
          missingEnvVars: res.missingEnvVars,
        });
      } else if (res.gateway === 'stripe' && res.checkoutUrl) {
        window.location.assign(res.checkoutUrl);
      } else if (res.gateway === 'razorpay' && res.orderId) {
        setCheckoutStatus({
          type: 'info',
          title: 'Razorpay Order Created',
          detail: `Order ${res.orderId} is ready for Razorpay Checkout verification.`,
        });
      }

      const hist = await apiRequest<{ payments: any[] }>('/api/payments/history');
      setPayments(hist.payments);
    } catch (err: any) {
      setCheckoutStatus({
        type: 'error',
        title: 'Order Creation Error',
        detail: err.message,
      });
    } finally {
      setLoadingOrder(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10 space-y-12">
      {/* Header + Regional Selector */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/8 pb-6">
        <div>
          <p className="text-xs font-medium text-pink-400">
            Transparent Minute Packages · Minimum 15 Minutes
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-white">
            Wallet & Global Pricing
          </h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            India uses INR billing via Razorpay. International regions use USD billing. All applicable taxes are shown prior to payment.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="country-pricing" className="text-xs font-medium text-zinc-400 whitespace-nowrap">
            Billing Region
          </label>
          <select
            id="country-pricing"
            value={selectedCountry}
            onChange={(e) => {
              onChangeCountry(e.target.value);
              setSelectedPkg(null);
              setCheckoutStatus(null);
            }}
            className="rounded-lg border border-white/12 bg-[#110D1B] px-3.5 py-2 text-xs font-medium text-white focus:border-pink-500 focus:outline-none"
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} — {c.currency} ({c.tax_name} {c.tax_rate_percent}%)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Current Wallet Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6">
          <p className="text-xs text-zinc-400">Available Voice Balance</p>
          <p className="mt-2 font-mono text-3xl font-bold text-white tabular-nums">
            {user && wallet ? formatDurationMMSS(wallet.totalAvailableSeconds) : '00:00'}
          </p>
          <p className="mt-1.5 text-xs text-zinc-500">
            {user && wallet
              ? `Paid ${formatDurationMMSS(wallet.paidSeconds)} · Trial ${formatDurationMMSS(wallet.trialSeconds)}`
              : 'Sign in to view wallet & claim 02:00 evaluation pass'}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6">
          <p className="text-xs text-zinc-400">Selected Tax & Gateway</p>
          <p className="mt-2 font-display text-2xl font-bold text-white">
            {activeCountryObj ? `${activeCountryObj.currency} · ${activeCountryObj.gateway.toUpperCase()}` : 'USD'}
          </p>
          <p className="mt-1.5 text-xs text-zinc-500">
            {activeCountryObj
              ? `${activeCountryObj.tax_name} (${activeCountryObj.tax_rate_percent}%) applied transparently`
              : 'Regional taxes calculated before checkout'}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6">
          <p className="text-xs text-zinc-400">Payment Security Policy</p>
          <p className="mt-2 font-display text-lg font-semibold text-white">
            Verified Webhooks Only
          </p>
          <p className="mt-1.5 text-xs text-zinc-500">
            Minutes activate strictly after gateway cryptographic verification. Card details are never stored.
          </p>
        </div>
      </div>

      {/* Package Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className={`rounded-2xl border p-6 flex flex-col justify-between gap-6 transition-colors ${
              selectedPkg?.id === pkg.id
                ? 'border-pink-500/60 bg-[#181226]'
                : 'border-white/10 bg-[#110D1B]'
            }`}
          >
            <div>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>{pkg.name}</span>
                <span className="font-mono tabular-nums">{pkg.minutes} min</span>
              </div>

              <p className="mt-3 font-mono text-3xl font-bold text-white tabular-nums">
                {pkg.quote.formattedSubtotal}
              </p>
              <p className="mt-1 text-xs text-zinc-400 font-mono tabular-nums">
                + {pkg.quote.formattedTax} {pkg.quote.taxName} ({pkg.quote.taxRatePercent}%) ={' '}
                <span className="text-white font-semibold">{pkg.quote.formattedTotal}</span>
              </p>

              <p className="mt-3 text-xs leading-relaxed text-zinc-400">{pkg.description}</p>
            </div>

            <button
              type="button"
              disabled={loadingOrder}
              onClick={() => handleCreateOrder(pkg)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-blue-600 hover:from-pink-500 hover:to-blue-500 py-2.5 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
            >
              <CreditCard className="h-3.5 w-3.5" />
              {loadingOrder && selectedPkg?.id === pkg.id
                ? 'Preparing Checkout...'
                : `Checkout ${pkg.quote.formattedTotal}`}
            </button>
          </div>
        ))}
      </div>

      {/* Checkout Feedback */}
      {checkoutStatus && (
        <div
          className={`rounded-2xl border p-5 ${
            checkoutStatus.type === 'error'
              ? 'border-red-500/35 bg-red-500/10 text-red-100'
              : 'border-amber-500/35 bg-amber-500/10 text-amber-100'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="space-y-1.5 text-xs">
              <p className="font-semibold text-sm">{checkoutStatus.title}</p>
              <p>{checkoutStatus.detail}</p>
              {checkoutStatus.missingEnvVars && (
                <p className="font-mono text-[11px] text-amber-200/90 pt-1">
                  Required server secrets: {checkoutStatus.missingEnvVars.join(', ')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Transaction & Payment History */}
      {user && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-pink-400" />
              <h2 className="font-display text-lg font-bold text-white">Payment History</h2>
            </div>
            <div className="mt-4 overflow-x-auto">
              {payments.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4">No payment orders created yet.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/8 text-zinc-400">
                      <th className="py-2 pr-3">Package</th>
                      <th className="py-2 pr-3">Gateway</th>
                      <th className="py-2 pr-3 text-right">Total</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 pr-3 text-white font-medium">
                          {p.package_name} ({p.minutes}m)
                        </td>
                        <td className="py-2.5 pr-3 text-zinc-400 uppercase">{p.gateway}</td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-white">
                          {p.currency} {(p.total_minor / 100).toFixed(2)}
                        </td>
                        <td className="py-2.5 text-right text-zinc-300 capitalize">{p.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#110D1B] p-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-400" />
              <h2 className="font-display text-lg font-bold text-white">Wallet Ledger</h2>
            </div>
            <div className="mt-4 overflow-x-auto">
              {transactions.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4">Wallet usage and purchase entries will appear here.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/8 text-zinc-400">
                      <th className="py-2 pr-3">Description</th>
                      <th className="py-2 pr-3 text-right">Delta</th>
                      <th className="py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6">
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td className="py-2.5 pr-3 text-zinc-200">{tx.description}</td>
                        <td
                          className={`py-2.5 pr-3 text-right font-mono tabular-nums ${
                            tx.seconds_delta >= 0 ? 'text-emerald-400' : 'text-zinc-300'
                          }`}
                        >
                          {tx.seconds_delta >= 0 ? `+${tx.seconds_delta}s` : `${tx.seconds_delta}s`}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-white">
                          {formatDurationMMSS(tx.balance_after_seconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
