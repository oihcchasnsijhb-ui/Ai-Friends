import React, { useState, useRef } from 'react';
import { Play, Square, Mic, MessageSquare, Globe, Shield, Smartphone } from 'lucide-react';
import { AudioWaveform } from './AudioWaveform';
import { apiRequest } from '../lib/api';
import type { ConversationMode, LanguageInfo, NavSection, VoiceProfile } from '../types';

interface DiscoverViewProps {
  voices: VoiceProfile[];
  languages: LanguageInfo[];
  selectedLanguage: string;
  onSelectVoiceAndGoStudio: (voiceId: string, mode?: ConversationMode) => void;
  onNavigate: (section: NavSection) => void;
}

const MODES: Array<{ id: ConversationMode; title: string; summary: string }> = [
  { id: 'romantic', title: 'Romantic', summary: 'Affectionate, poetic, and warm late-night talks.' },
  { id: 'friendship', title: 'Friendship', summary: 'Relaxed best-friend check-ins whenever you want company.' },
  { id: 'funny', title: 'Funny', summary: 'Playful banter, quick wit, and lighthearted laughs.' },
  { id: 'daily_life', title: 'Daily Life', summary: 'Work reflections, chai breaks, travel, and routines.' },
  { id: 'stories', title: 'Stories & Entertainment', summary: 'Interactive tales, mysteries, and spoken storytelling.' },
];

export const DiscoverView: React.FC<DiscoverViewProps> = ({
  voices,
  languages,
  selectedLanguage,
  onSelectVoiceAndGoStudio,
  onNavigate,
}) => {
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlaySample = async (voice: VoiceProfile) => {
    setSampleError(null);
    if (playingVoiceId === voice.id) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }

    audioRef.current?.pause();
    setLoadingSampleId(voice.id);
    try {
      const res = await apiRequest<{ audioBase64: string; mimeType: string }>('/api/voice/sample', {
        method: 'POST',
        body: JSON.stringify({ voiceId: voice.id, languageCode: selectedLanguage }),
      });
      const audio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => setPlayingVoiceId(null);
      audio.onerror = () => {
        setPlayingVoiceId(null);
        setSampleError('Audio playback failed on this browser.');
      };
      setPlayingVoiceId(voice.id);
      await audio.play();
    } catch (err: any) {
      setSampleError(err.message || 'Could not synthesize voice sample.');
      setPlayingVoiceId(null);
    } finally {
      setLoadingSampleId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10 space-y-20">
      {/* 1. Hero Split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
        <div className="lg:col-span-6 flex flex-col justify-between py-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-pink-400">
              AI Voice Companion · Hindi, English, Bhojpuri & Global Languages
            </p>
            <h1 className="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight text-white text-balance leading-[1.08]">
              Your AI Friend, Always Ready to Talk.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-300">
              Speak naturally in real-time voice calls, exchange expressive voice notes, or text chat with Ananya and Kabir. Built with transparent per-minute wallet billing and strict AI ethics.
            </p>
          </div>

          <div className="mt-8 space-y-5">
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onSelectVoiceAndGoStudio(voices[0]?.id || 'voice-female-ananya', 'friendship')}
                className="px-6 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-pink-600 to-blue-600 hover:from-pink-500 hover:to-blue-500 transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                Enter Voice Studio
              </button>
              <button
                type="button"
                onClick={() => onNavigate('pricing')}
                className="px-5 py-3 rounded-xl text-sm font-medium text-zinc-200 border border-white/12 bg-[#110D1B] hover:border-white/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                View INR & USD Packages
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              AI Transparency: Companions are AI-generated voices, never real humans, and never pressure you to buy minutes.
            </p>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="relative h-full min-h-[280px] overflow-hidden rounded-2xl border border-white/10 bg-[#110D1B]">
            {!heroImgFailed ? (
              <img
                src="/src/assets/images/hero_voice_studio_1795443144340.jpg"
                alt="DIL SE AI sculptural acoustic studio waves in obsidian and violet glass"
                referrerPolicy="no-referrer"
                onError={() => setHeroImgFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full min-h-[280px] items-center justify-center bg-gradient-to-br from-[#181226] via-[#110D1B] to-[#07060B] p-8">
                <AudioWaveform active={true} level={0.6} accent="blend" height={96} />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#07060B]/85 via-transparent to-transparent" />
            <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-zinc-300">Real-Time Speech Engine</p>
                <p className="text-sm font-semibold text-white">Low-latency voice calls · Instant voice switching</p>
              </div>
              <span className="font-mono text-xs text-blue-300 tabular-nums whitespace-nowrap">24kHz Audio</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4-Column Summary Strip below Hero */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-6 border-y border-white/8 py-7">
        <div>
          <p className="font-mono text-2xl font-semibold text-white tabular-nums">2 Voices</p>
          <p className="mt-1 text-xs text-zinc-400">Ananya (Female) & Kabir (Male)</p>
        </div>
        <div>
          <p className="font-mono text-2xl font-semibold text-white tabular-nums">{languages.length} Languages</p>
          <p className="mt-1 text-xs text-zinc-400">Hindi, English, Bhojpuri & Global</p>
        </div>
        <div>
          <p className="font-mono text-2xl font-semibold text-white tabular-nums">₹149 / $20</p>
          <p className="mt-1 text-xs text-zinc-400">Minimum 15-minute wallet package</p>
        </div>
        <div>
          <p className="font-mono text-2xl font-semibold text-white tabular-nums">3 Modes</p>
          <p className="mt-1 text-xs text-zinc-400">Live Voice Call, Voice Notes & Text</p>
        </div>
      </section>

      {/* 2. AI Companion Voices Showcase */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
              Meet Your AI Companions
            </h2>
            <p className="mt-1.5 text-sm text-zinc-400">
              Preview live AI-synthesized greetings or switch voices anytime mid-conversation.
            </p>
          </div>
          {sampleError && <p className="text-xs text-amber-300">{sampleError}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {voices.map((voice) => {
            const isFemale = voice.gender === 'female';
            const isPlaying = playingVoiceId === voice.id;
            const isLoading = loadingSampleId === voice.id;

            return (
              <div
                key={voice.id}
                className="rounded-2xl border border-white/10 bg-[#110D1B] p-6 flex flex-col justify-between gap-6"
              >
                <div className="flex items-start gap-5">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-white/12 bg-[#181226]">
                    {!failedAvatars[voice.id] ? (
                      <img
                        src={voice.avatar_url}
                        alt={`${voice.name} AI companion portrait`}
                        referrerPolicy="no-referrer"
                        onError={() => setFailedAvatars((prev) => ({ ...prev, [voice.id]: true }))}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-pink-500/20 to-blue-500/20 font-display text-2xl font-bold text-white">
                        {voice.name[0]}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <span className={isFemale ? 'text-pink-400 font-medium' : 'text-blue-400 font-medium'}>
                        {isFemale ? 'Female AI Voice' : 'Male AI Voice'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>AI Companion</span>
                    </div>
                    <h3 className="mt-1 font-display text-2xl font-bold text-white">{voice.name}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{voice.tagline}</p>
                  </div>
                </div>

                <div className="rounded-xl bg-[#07060B] px-4 py-3 border border-white/6">
                  <AudioWaveform
                    active={isPlaying}
                    level={isPlaying ? 0.72 : 0.2}
                    accent={isFemale ? 'pink' : 'blue'}
                    height={44}
                    bars={32}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => handlePlaySample(voice)}
                    disabled={isLoading}
                    className="flex items-center gap-2 rounded-lg border border-white/12 bg-[#181226] px-4 py-2.5 text-xs font-semibold text-white hover:border-pink-500/40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isPlaying ? <Square className="h-3.5 w-3.5 text-pink-400" /> : <Play className="h-3.5 w-3.5 text-pink-400" />}
                    {isLoading ? 'Synthesizing...' : isPlaying ? 'Stop Greeting' : 'Hear Live Sample'}
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectVoiceAndGoStudio(voice.id, 'friendship')}
                    className={`rounded-lg px-4 py-2.5 text-xs font-semibold text-white transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      isFemale
                        ? 'bg-pink-600 hover:bg-pink-500'
                        : 'bg-blue-600 hover:bg-blue-500'
                    }`}
                  >
                    Talk with {voice.name}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Conversation Styles & Global Reach */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-[#110D1B] p-6">
          <h2 className="font-display text-xl font-bold text-white">Conversation Modes</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Select a tone before or during your session — switch anytime.
          </p>
          <div className="mt-5 divide-y divide-white/8">
            {MODES.map((m, idx) => (
              <div key={m.id} className="flex items-center justify-between gap-4 py-3.5">
                <div>
                  <p className="text-sm font-semibold text-white">
                    0{idx + 1}. {m.title}
                  </p>
                  <p className="text-xs text-zinc-400">{m.summary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectVoiceAndGoStudio(voices[0]?.id || 'voice-female-ananya', m.id)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-pink-500/40 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                >
                  Start
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-white/10 bg-[#110D1B] p-6 flex flex-col justify-between gap-6">
          <div>
            <h2 className="font-display text-xl font-bold text-white">Global & Cross-Platform</h2>
            <p className="mt-1 text-sm text-zinc-400">
              One unified account, wallet balance, and conversation history across Web, Android, and iOS.
            </p>

            <div className="mt-6 space-y-4">
              <div className="flex items-start gap-3">
                <Globe className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Auto Language & Style Matching</p>
                  <p className="text-xs text-zinc-400">
                    Automatically detects and switches across 20+ languages including Hindi, Hinglish, Bhojpuri, Urdu, Punjabi, Bengali, Marathi, Tamil, Telugu, Spanish, French, Arabic, German, Japanese & Korean—mirroring your tone and pace.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mic className="h-4 w-4 text-pink-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Live Calls & Voice Messages</p>
                  <p className="text-xs text-zinc-400">
                    Minute deduction begins strictly when active audio interaction starts, with automatic stop at 00:00.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Smartphone className="h-4 w-4 text-purple-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Mobile Native Apps Included</p>
                  <p className="text-xs text-zinc-400">
                    React Native Android & iOS clients share the same authenticated API and idempotent wallet ledger.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Shield className="h-4 w-4 text-zinc-300 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Respectful AI Boundaries</p>
                  <p className="text-xs text-zinc-400">
                    Never claims human identity, never stores raw card numbers, and supports one-click account deletion.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSelectVoiceAndGoStudio(voices[1]?.id || 'voice-male-kabir', 'daily_life')}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/12 bg-[#181226] py-3 text-xs font-semibold text-white hover:border-blue-500/50 transition-colors cursor-pointer"
          >
            <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
            Open Live Studio
          </button>
        </div>
      </section>
    </div>
  );
};
