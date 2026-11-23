import { useCallback, useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { DiscoverView } from './components/DiscoverView';
import { StudioView } from './components/StudioView';
import { WalletPricingView } from './components/WalletPricingView';
import { AdminDashboardView } from './components/AdminDashboardView';
import { AuthModal } from './components/AuthModal';
import { AccountDrawer } from './components/AccountDrawer';
import { apiRequest, detectLocaleDefaults, setAuthToken } from './lib/api';
import type {
  AuthUser,
  ConversationMode,
  CountryInfo,
  LanguageInfo,
  NavSection,
  PackageItem,
  UserProfile,
  VoiceProfile,
  WalletBalance,
} from './types';

export default function App() {
  const locale = detectLocaleDefaults();

  const [section, setSection] = useState<NavSection>('discover');
  const [countries, setCountries] = useState<CountryInfo[]>([]);
  const [languages, setLanguages] = useState<LanguageInfo[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [packages, setPackages] = useState<PackageItem[]>([]);

  const [selectedCountry, setSelectedCountry] = useState(locale.countryCode);
  const [selectedLanguage, setSelectedLanguage] = useState('auto');
  const [selectedVoiceId, setSelectedVoiceId] = useState('voice-female-ananya');
  const [selectedMode, setSelectedMode] = useState<ConversationMode>('auto');

  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const loadCatalog = useCallback(async (country: string) => {
    try {
      const data = await apiRequest<{
        countries: CountryInfo[];
        languages: LanguageInfo[];
        voices: VoiceProfile[];
        packages: PackageItem[];
      }>(`/api/catalog?country=${encodeURIComponent(country)}`);

      setCountries(data.countries);
      setLanguages(data.languages);
      setVoices(data.voices);
      setPackages(data.packages);
    } catch (err) {
      console.error('Failed to load catalog:', err);
    }
  }, []);

  useEffect(() => {
    loadCatalog(selectedCountry);
  }, [selectedCountry, loadCatalog]);

  const handleSelectVoiceAndGoStudio = (voiceId: string, mode?: ConversationMode) => {
    setSelectedVoiceId(voiceId);
    if (mode) setSelectedMode(mode);
    setSection('studio');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSignedOut = () => {
    setAuthToken(null);
    setUser(null);
    setProfile(null);
    setWallet(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#07060B] text-zinc-100">
      <Navbar
        activeSection={section}
        onNavigate={(next) => {
          setSection(next);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        user={user}
        wallet={wallet}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
      />

      <main className="flex-1">
        {section === 'discover' && (
          <DiscoverView
            voices={voices}
            languages={languages}
            selectedLanguage={selectedLanguage}
            onSelectVoiceAndGoStudio={handleSelectVoiceAndGoStudio}
            onNavigate={setSection}
          />
        )}

        {section === 'studio' && (
          <StudioView
            user={user}
            wallet={wallet}
            voices={voices}
            languages={languages}
            selectedVoiceId={selectedVoiceId}
            selectedMode={selectedMode}
            selectedLanguage={selectedLanguage}
            onChangeVoice={setSelectedVoiceId}
            onChangeMode={setSelectedMode}
            onChangeLanguage={setSelectedLanguage}
            onWalletUpdated={setWallet}
            onOpenAuth={() => setAuthModalOpen(true)}
            onNavigate={setSection}
          />
        )}

        {section === 'pricing' && (
          <WalletPricingView
            user={user}
            wallet={wallet}
            countries={countries}
            selectedCountry={selectedCountry}
            onChangeCountry={setSelectedCountry}
            packages={packages}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        )}

        {section === 'admin' && (
          <AdminDashboardView
            user={user}
            onAdminAuthenticated={(u, w) => {
              setUser(u);
              setWallet(w);
            }}
            onCatalogUpdated={() => loadCatalog(selectedCountry)}
          />
        )}
      </main>

      <footer className="border-t border-white/8 py-8 mt-16">
        <div className="mx-auto max-w-[1280px] px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <p>DIL SE AI · Your AI Friend, Always Ready to Talk</p>
          <p>AI-generated voice companions · Transparent wallet billing · Privacy & consent protected</p>
        </div>
      </footer>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        countries={countries}
        languages={languages}
        onAuthenticated={({ user: u, profile: p, wallet: w }) => {
          setUser(u);
          setProfile(p);
          setWallet(w);
          setSelectedCountry(u.countryCode);
        }}
      />

      <AccountDrawer
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        user={user}
        profile={profile}
        wallet={wallet}
        countries={countries}
        languages={languages}
        onUpdated={(u, p) => {
          setUser(u);
          setProfile(p);
          setSelectedCountry(u.countryCode);
          setSelectedLanguage(u.languageCode);
        }}
        onSignedOut={handleSignedOut}
      />
    </div>
  );
}
