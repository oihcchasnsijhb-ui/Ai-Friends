import React, { useState } from 'react';
import { X, LogOut, Trash2, LifeBuoy } from 'lucide-react';
import { apiRequest, formatDurationMMSS } from '../lib/api';
import type { AuthUser, CountryInfo, LanguageInfo, UserProfile, WalletBalance } from '../types';

interface AccountDrawerProps {
  open: boolean;
  onClose: () => void;
  user: AuthUser | null;
  profile: UserProfile | null;
  wallet: WalletBalance | null;
  countries: CountryInfo[];
  languages: LanguageInfo[];
  onUpdated: (user: AuthUser, profile: UserProfile) => void;
  onSignedOut: () => void;
}

export const AccountDrawer: React.FC<AccountDrawerProps> = ({
  open,
  onClose,
  user,
  profile,
  wallet,
  countries,
  languages,
  onUpdated,
  onSignedOut,
}) => {
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [countryCode, setCountryCode] = useState(user?.countryCode || 'US');
  const [languageCode, setLanguageCode] = useState(user?.languageCode || 'en');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!open || !user) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ user: AuthUser; profile: UserProfile }>('/api/account/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: displayName || profile?.display_name,
          countryCode,
          languageCode,
        }),
      });
      onUpdated(res.user, res.profile);
      setStatusMsg('Profile preferences saved.');
    } catch (err: any) {
      setStatusMsg(err.message);
    }
  };

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    try {
      await apiRequest('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({ subject: ticketSubject, message: ticketMessage }),
      });
      setTicketSubject('');
      setTicketMessage('');
      setStatusMsg('Support ticket submitted to the DIL SE AI team.');
    } catch (err: any) {
      setStatusMsg(err.message);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await apiRequest('/api/account', { method: 'DELETE' });
      onSignedOut();
      onClose();
    } catch (err: any) {
      setStatusMsg(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
      <div className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-[#110D1B] p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-white">Account & Preferences</h2>
            <p className="text-xs text-zinc-400">{user.email || user.phone}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account panel"
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/6 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {wallet && (
          <div className="rounded-xl border border-white/10 bg-[#07060B] p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-400">Wallet Balance</p>
              <p className="font-mono text-xl font-bold text-white tabular-nums">
                {formatDurationMMSS(wallet.totalAvailableSeconds)}
              </p>
            </div>
            <p className="text-xs text-zinc-500 font-mono tabular-nums">
              Used {formatDurationMMSS(wallet.totalUsedSeconds)}
            </p>
          </div>
        )}

        {statusMsg && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
            {statusMsg}
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Display Name</label>
            <input
              type="text"
              value={displayName || profile?.display_name || ''}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#07060B] px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Country</label>
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#07060B] px-2.5 py-2 text-xs text-white"
              >
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Language</label>
              <select
                value={languageCode}
                onChange={(e) => setLanguageCode(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#07060B] px-2.5 py-2 text-xs text-white"
              >
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-[#181226] border border-white/12 py-2 text-xs font-semibold text-white hover:border-pink-500/40 cursor-pointer"
          >
            Save Preferences
          </button>
        </form>

        <form onSubmit={handleSubmitTicket} className="border-t border-white/8 pt-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <LifeBuoy className="h-3.5 w-3.5 text-pink-400" />
            Support Request
          </div>
          <input
            type="text"
            required
            value={ticketSubject}
            onChange={(e) => setTicketSubject(e.target.value)}
            placeholder="Subject"
            className="w-full rounded-lg border border-white/10 bg-[#07060B] px-3 py-2 text-xs text-white"
          />
          <textarea
            required
            rows={3}
            value={ticketMessage}
            onChange={(e) => setTicketMessage(e.target.value)}
            placeholder="Describe your billing or voice issue..."
            className="w-full rounded-lg border border-white/10 bg-[#07060B] px-3 py-2 text-xs text-white"
          />
          <button
            type="submit"
            className="w-full rounded-lg border border-white/10 bg-[#07060B] py-2 text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
          >
            Send Support Ticket
          </button>
        </form>

        <div className="border-t border-white/8 pt-5 space-y-3">
          <button
            type="button"
            onClick={() => {
              onSignedOut();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#07060B] py-2.5 text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-red-500/25 py-2 text-xs text-red-300 hover:bg-red-500/10 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Account
            </button>
          ) : (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 space-y-2 text-xs text-red-200">
              <p>This permanently scrubs your email, phone, and closes active sessions.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  className="flex-1 rounded bg-red-600 py-1.5 font-semibold text-white cursor-pointer"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded bg-white/10 py-1.5 text-white cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
