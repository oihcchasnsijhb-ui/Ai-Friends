import React from 'react';
import type { AuthUser, NavSection, WalletBalance } from '../types';
import { formatDurationMMSS } from '../lib/api';

interface NavbarProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  user: AuthUser | null;
  wallet: WalletBalance | null;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeSection,
  onNavigate,
  user,
  wallet,
  onOpenAuth,
  onOpenAccount,
}) => {
  const links: Array<{ id: NavSection; label: string }> = [
    { id: 'discover', label: 'Companions' },
    { id: 'studio', label: 'Studio' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'admin', label: 'Admin' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-[#07060B]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-8 px-6 py-4">
        {/* Zone 1: Single-element Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('discover')}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 rounded"
        >
          DIL SE AI
        </button>

        {/* Zone 2: 4 single-line navigation links */}
        <nav className="hidden md:flex items-center gap-7" aria-label="Primary">
          {links.map((link) => {
            const isActive = activeSection === link.id;
            return (
              <button
                key={link.id}
                type="button"
                onClick={() => onNavigate(link.id)}
                className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 rounded ${
                  isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {link.label}
                {isActive && (
                  <span className="absolute inset-x-0 -bottom-[17px] h-[2px] bg-gradient-to-r from-pink-500 to-blue-500" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="shrink-0">
          {user ? (
            <button
              type="button"
              onClick={onOpenAccount}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#181226] border border-white/12 hover:border-pink-500/50 rounded-lg transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"
            >
              {wallet ? `Wallet ${formatDurationMMSS(wallet.totalAvailableSeconds)}` : 'Account'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-pink-600 to-blue-600 hover:from-pink-500 hover:to-blue-500 rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Compact mobile navigation row */}
      <nav className="flex md:hidden items-center justify-around border-t border-white/6 px-3 py-2" aria-label="Mobile navigation">
        {links.map((link) => {
          const isActive = activeSection === link.id;
          return (
            <button
              key={link.id}
              type="button"
              onClick={() => onNavigate(link.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                isActive ? 'text-white bg-white/10' : 'text-zinc-400'
              }`}
            >
              {link.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
