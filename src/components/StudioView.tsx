import React, { useEffect, useRef, useState } from 'react';
import {
  Phone,
  PhoneOff,
  Mic,
  Square,
  Send,
  Volume2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { AudioWaveform } from './AudioWaveform';
import { apiRequest, formatDurationMMSS, getAuthToken } from '../lib/api';
import type {
  AuthUser,
  ChatMessage,
  ConversationMode,
  LanguageInfo,
  NavSection,
  VoiceProfile,
  WalletBalance,
} from '../types';

interface StudioViewProps {
  user: AuthUser | null;
  wallet: WalletBalance | null;
  voices: VoiceProfile[];
  languages: LanguageInfo[];
  selectedVoiceId: string;
  selectedMode: ConversationMode;
  selectedLanguage: string;
  onChangeVoice: (id: string) => void;
  onChangeMode: (mode: ConversationMode) => void;
  onChangeLanguage: (code: string) => void;
  onWalletUpdated: (wallet: WalletBalance) => void;
  onOpenAuth: () => void;
  onNavigate: (section: NavSection) => void;
}

const CONVERSATION_MODES: Array<{ id: ConversationMode; label: string }> = [
  { id: 'auto', label: 'Adaptive Style (Auto)' },
  { id: 'friendship', label: 'Friendship' },
  { id: 'romantic', label: 'Romantic' },
  { id: 'funny', label: 'Funny' },
  { id: 'daily_life', label: 'Daily Life' },
  { id: 'stories', label: 'Stories' },
];

function pcmFloat32ToBase64Int16(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const float32 = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < float32.length; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export const StudioView: React.FC<StudioViewProps> = ({
  user,
  wallet,
  voices,
  languages,
  selectedVoiceId,
  selectedMode,
  selectedLanguage,
  onChangeVoice,
  onChangeMode,
  onChangeLanguage,
  onWalletUpdated,
  onOpenAuth,
  onNavigate,
}) => {
  const [studioTab, setStudioTab] = useState<'live_call' | 'voice_message' | 'text_chat'>('live_call');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput] = useState('');
  const [speakReplies, setSpeakReplies] = useState(true);
  const [sending, setSending] = useState(false);

  // Live Call WebSocket & Audio refs
  const [callState, setCallState] = useState<'idle' | 'connecting' | 'live'>('idle');
  const [micLevel, setMicLevel] = useState(0.18);
  const [lowBalanceWarning, setLowBalanceWarning] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [matchedBadge, setMatchedBadge] = useState<{ language: string; style: string } | null>(null);
  const [liveCaptions, setLiveCaptions] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  // Voice Message recording
  const [isRecordingNote, setIsRecordingNote] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);

  const activeVoice = voices.find((v) => v.id === selectedVoiceId) || voices[0];

  useEffect(() => {
    return () => {
      stopLiveCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureSession = async (mode: 'live_call' | 'voice_message' | 'text_chat'): Promise<string> => {
    if (sessionId) return sessionId;
    const res = await apiRequest<{ session: { id: string }; wallet: WalletBalance }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        voiceId: selectedVoiceId,
        mode,
        conversationStyle: selectedMode,
        languageCode: selectedLanguage,
      }),
    });
    setSessionId(res.session.id);
    onWalletUpdated(res.wallet);
    return res.session.id;
  };

  const handleVoiceSwitch = async (nextVoiceId: string) => {
    onChangeVoice(nextVoiceId);
    if (sessionId && user) {
      try {
        await apiRequest(`/api/sessions/${sessionId}/voice`, {
          method: 'PATCH',
          body: JSON.stringify({ voiceId: nextVoiceId }),
        });
      } catch {
        // non-blocking
      }
    }
    if (callState === 'live') {
      stopLiveCall();
      setTimeout(() => {
        startLiveCallWithVoice(nextVoiceId);
      }, 250);
    }
  };

  const stopLiveCall = () => {
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    wsRef.current = null;
    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    inputCtxRef.current?.close().catch(() => {});
    inputCtxRef.current = null;
    outputCtxRef.current?.close().catch(() => {});
    outputCtxRef.current = null;
    nextStartTimeRef.current = 0;
    setCallState('idle');
    setMicLevel(0.18);
  };

  const startLiveCallWithVoice = async (voiceOverrideId?: string) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    setErrorMsg(null);
    setLowBalanceWarning(null);
    setCallState('connecting');

    try {
      const sid = await ensureSession('live_call');
      const token = getAuthToken();
      if (!token) throw new Error('Please sign in again to start a live call.');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const vId = voiceOverrideId || selectedVoiceId;
      const wsUrl = `${proto}//${window.location.host}/ws/live-call?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sid)}&voiceId=${encodeURIComponent(vId)}&mode=${encodeURIComponent(selectedMode)}&lang=${encodeURIComponent(selectedLanguage)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ready') {
          setCallState('live');
          if (msg.wallet) onWalletUpdated(msg.wallet);
        } else if (msg.type === 'audio' && msg.data && outputCtxRef.current) {
          const ctx = outputCtxRef.current;
          const float32 = base64Pcm16ToFloat32(msg.data);
          const buffer = ctx.createBuffer(1, float32.length, 24000);
          buffer.getChannelData(0).set(float32);
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          const startAt = Math.max(ctx.currentTime, nextStartTimeRef.current);
          src.start(startAt);
          nextStartTimeRef.current = startAt + buffer.duration;
          setMicLevel(0.75);
        } else if (msg.type === 'interrupted' && outputCtxRef.current) {
          nextStartTimeRef.current = outputCtxRef.current.currentTime;
        } else if (msg.type === 'input_transcript' && msg.text) {
          setLiveCaptions((prev) => [...prev.slice(-12), { role: 'user', text: msg.text }]);
        } else if (msg.type === 'output_transcript' && msg.text) {
          setLiveCaptions((prev) => [...prev.slice(-12), { role: 'ai', text: msg.text }]);
        } else if (msg.type === 'wallet_tick' && msg.wallet) {
          onWalletUpdated(msg.wallet);
        } else if (msg.type === 'low_balance_warning') {
          setLowBalanceWarning(msg.remainingSeconds);
        } else if (msg.type === 'balance_exhausted') {
          if (msg.wallet) onWalletUpdated(msg.wallet);
          setErrorMsg('Your balance reached 00:00 and the call was automatically ended.');
          stopLiveCall();
        } else if (msg.type === 'error') {
          setErrorMsg(msg.error || 'Live call error occurred.');
          stopLiveCall();
        }
      };

      ws.onerror = () => {
        setErrorMsg('Live audio connection interrupted.');
        stopLiveCall();
      };

      ws.onclose = () => {
        setCallState('idle');
      };

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(inputCtx.destination);

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const channel = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
        const rms = Math.sqrt(sum / channel.length);
        setMicLevel((prev) => Math.max(0.18, Math.min(1, rms * 5 + prev * 0.25)));
        const base64 = pcmFloat32ToBase64Int16(channel);
        ws.send(JSON.stringify({ type: 'audio', data: base64 }));
      };
    } catch (err: any) {
      setErrorMsg(err.message || 'Microphone permission or session initialization failed.');
      stopLiveCall();
    }
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onOpenAuth();
      return;
    }
    const trimmed = textInput.trim();
    if (!trimmed || sending) return;

    setErrorMsg(null);
    setSending(true);
    setTextInput('');

    try {
      const sid = await ensureSession('text_chat');
      const tempUserMsg: ChatMessage = { id: `u-${Date.now()}`, sender: 'user', content: trimmed };
      setMessages((prev) => [...prev, tempUserMsg]);

      const res = await apiRequest<{
        aiMessageId: string;
        replyText: string;
        detectedLanguage?: string;
        detectedStyle?: string;
        audioBase64: string | null;
        audioMimeType: string | null;
        wallet: WalletBalance;
      }>('/api/chat/message', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sid,
          message: trimmed,
          voiceId: selectedVoiceId,
          mode: selectedMode,
          languageCode: selectedLanguage,
          includeAudio: speakReplies && (wallet?.totalAvailableSeconds ?? 0) > 0,
          eventId: `chat:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        }),
      });

      onWalletUpdated(res.wallet);
      if (res.detectedLanguage && res.detectedStyle) {
        setMatchedBadge({ language: res.detectedLanguage, style: res.detectedStyle });
      }
      if (res.wallet.totalAvailableSeconds <= 60 && res.wallet.totalAvailableSeconds > 0) {
        setLowBalanceWarning(res.wallet.totalAvailableSeconds);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: res.aiMessageId,
          sender: 'ai',
          content: res.replyText,
          audioBase64: res.audioBase64 || undefined,
          detectedLanguage: res.detectedLanguage,
          detectedStyle: res.detectedStyle,
        },
      ]);

      if (res.audioBase64 && res.audioMimeType) {
        const audio = new Audio(`data:${res.audioMimeType};base64,${res.audioBase64}`);
        audio.play().catch(() => {});
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSending(false);
    }
  };

  const startVoiceNoteRecording = async () => {
    if (!user) {
      onOpenAuth();
      return;
    }
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recordStartRef.current = Date.now();

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const durationSec = Math.max(2, Math.round((Date.now() - recordStartRef.current) / 1000));
        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = String(reader.result || '');
          const base64Audio = dataUrl.split(',')[1];
          if (!base64Audio) return;
          setSending(true);
          try {
            const sid = await ensureSession('voice_message');
            const res = await apiRequest<{
              userTranscript: string;
              replyText: string;
              detectedLanguage?: string;
              detectedStyle?: string;
              audioBase64: string;
              audioMimeType: string;
              wallet: WalletBalance;
              exhausted: boolean;
            }>('/api/voice/message', {
              method: 'POST',
              body: JSON.stringify({
                sessionId: sid,
                audioBase64: base64Audio,
                mimeType: blob.type || 'audio/webm',
                durationSeconds: durationSec,
                voiceId: selectedVoiceId,
                mode: selectedMode,
                languageCode: selectedLanguage,
                eventId: `vnote:${Date.now()}`,
              }),
            });

            onWalletUpdated(res.wallet);
            if (res.detectedLanguage && res.detectedStyle) {
              setMatchedBadge({ language: res.detectedLanguage, style: res.detectedStyle });
            }
            setMessages((prev) => [
              ...prev,
              { id: `vu-${Date.now()}`, sender: 'user', content: res.userTranscript, audio_duration_seconds: durationSec },
              {
                id: `va-${Date.now()}`,
                sender: 'ai',
                content: res.replyText,
                audioBase64: res.audioBase64,
                detectedLanguage: res.detectedLanguage,
                detectedStyle: res.detectedStyle,
              },
            ]);
            const audio = new Audio(`data:${res.audioMimeType};base64,${res.audioBase64}`);
            audio.play().catch(() => {});
          } catch (err: any) {
            setErrorMsg(err.message);
          } finally {
            setSending(false);
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      setIsRecordingNote(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Microphone access is required for voice notes.');
    }
  };

  const stopVoiceNoteRecording = () => {
    recorderRef.current?.stop();
    setIsRecordingNote(false);
  };

  const playAudioSnippet = (base64: string) => {
    const audio = new Audio(`data:audio/wav;base64,${base64}`);
    audio.play().catch(() => {});
  };

  const startFreshSession = async () => {
    if (sessionId && user) {
      await apiRequest(`/api/sessions/${sessionId}/end`, { method: 'POST' }).catch(() => {});
    }
    stopLiveCall();
    setSessionId(null);
    setMessages([]);
    setLiveCaptions([]);
    setErrorMsg(null);
  };

  const availableSeconds = wallet?.totalAvailableSeconds ?? 0;

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-8 space-y-6">
      {/* Studio Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/8 pb-6">
        <div>
          <p className="text-xs text-zinc-400">
            AI Companion Studio · Generated AI voice, not a real human
            {matchedBadge ? ` · Matched: ${matchedBadge.language} · ${matchedBadge.style}` : ''}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-white">
            Talking with {activeVoice?.name || 'Ananya'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Instant Male/Female Voice Switcher */}
          <div className="flex items-center gap-1 rounded-lg bg-[#110D1B] p-1 border border-white/10">
            {voices.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => handleVoiceSwitch(v.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedVoiceId === v.id
                    ? v.gender === 'female'
                      ? 'bg-pink-600 text-white'
                      : 'bg-blue-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {v.name} ({v.gender === 'female' ? 'Female' : 'Male'})
              </button>
            ))}
          </div>

          <select
            aria-label="Conversation mode"
            value={selectedMode}
            onChange={(e) => onChangeMode(e.target.value as ConversationMode)}
            className="rounded-lg border border-white/10 bg-[#110D1B] px-3 py-2 text-xs font-medium text-white focus:border-pink-500 focus:outline-none"
          >
            {CONVERSATION_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Language"
            value={selectedLanguage}
            onChange={(e) => onChangeLanguage(e.target.value)}
            className="rounded-lg border border-white/10 bg-[#110D1B] px-3 py-2 text-xs font-medium text-white focus:border-pink-500 focus:outline-none"
          >
            <option value="auto">Auto-Detect Language (Recommended)</option>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({l.native_name})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={startFreshSession}
            title="Start new conversation"
            className="rounded-lg border border-white/10 bg-[#110D1B] p-2 text-zinc-400 hover:text-white cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Wallet Countdown & Warning Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#110D1B] px-5 py-3.5">
        <div className="flex items-center gap-4 text-xs">
          <span className="text-zinc-400">Remaining Balance</span>
          <span className="font-mono text-lg font-semibold text-white tabular-nums">
            {user ? formatDurationMMSS(availableSeconds) : 'Sign in for 02:00 Trial'}
          </span>
          {user && wallet && (
            <span className="text-zinc-500 font-mono tabular-nums">
              Trial {formatDurationMMSS(wallet.trialSeconds)} · Paid {formatDurationMMSS(wallet.paidSeconds)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {lowBalanceWarning !== null && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Low balance: {lowBalanceWarning}s left
            </span>
          )}
          <button
            type="button"
            onClick={() => onNavigate('pricing')}
            className="rounded-lg border border-pink-500/40 bg-pink-500/10 px-3.5 py-1.5 text-xs font-semibold text-pink-200 hover:bg-pink-500/20 cursor-pointer whitespace-nowrap shrink-0"
          >
            Add Minutes
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200 flex items-center justify-between gap-4">
          <span>{errorMsg}</span>
          {availableSeconds <= 0 && (
            <button
              type="button"
              onClick={() => onNavigate('pricing')}
              className="rounded-md bg-pink-600 px-3 py-1 text-xs font-semibold text-white cursor-pointer shrink-0"
            >
              View Packages
            </button>
          )}
        </div>
      )}

      {/* Mode Tabs */}
      <div className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#110D1B] p-1">
        {(
          [
            { id: 'live_call', label: 'Live Voice Call' },
            { id: 'voice_message', label: 'Voice Messages' },
            { id: 'text_chat', label: 'Text Chat' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStudioTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              studioTab === tab.id ? 'bg-[#181226] text-white border border-white/10' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Studio Surface */}
      {studioTab === 'live_call' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-[#110D1B] p-8 flex flex-col items-center justify-between text-center gap-6">
            <div className="relative">
              <div className="h-36 w-36 overflow-hidden rounded-full border-2 border-pink-500/50 bg-[#181226]">
                {activeVoice && (
                  <img
                    src={activeVoice.avatar_url}
                    alt={activeVoice.name}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
            </div>

            <div>
              <h2 className="font-display text-2xl font-bold text-white">{activeVoice?.name}</h2>
              <p className="mt-1 text-xs text-zinc-400">
                {callState === 'live'
                  ? 'Live voice stream connected · Timer active'
                  : callState === 'connecting'
                  ? 'Connecting secure audio bridge...'
                  : 'Ready to start live voice call'}
              </p>
            </div>

            <div className="w-full max-w-md rounded-xl bg-[#07060B] px-5 py-4 border border-white/8">
              <AudioWaveform
                active={callState === 'live'}
                level={micLevel}
                accent={activeVoice?.gender === 'female' ? 'pink' : 'blue'}
                height={64}
                bars={40}
              />
            </div>

            <div className="flex items-center gap-4">
              {callState === 'live' ? (
                <button
                  type="button"
                  onClick={stopLiveCall}
                  className="flex items-center gap-2 rounded-xl bg-red-600 hover:bg-red-500 px-7 py-3.5 text-sm font-semibold text-white cursor-pointer"
                >
                  <PhoneOff className="h-4 w-4" />
                  End Live Call
                </button>
              ) : (
                <button
                  type="button"
                  disabled={callState === 'connecting'}
                  onClick={() => startLiveCallWithVoice()}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-blue-600 hover:from-pink-500 hover:to-blue-500 px-7 py-3.5 text-sm font-semibold text-white disabled:opacity-60 cursor-pointer"
                >
                  <Phone className="h-4 w-4" />
                  {callState === 'connecting' ? 'Connecting...' : 'Start Live Voice Call'}
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl border border-white/10 bg-[#110D1B] p-6 flex flex-col justify-between">
            <div>
              <h3 className="font-display text-base font-semibold text-white">Live Audio Transcript</h3>
              <p className="mt-1 text-xs text-zinc-400">
                Real-time speech captions appear here while your call is active.
              </p>
            </div>

            <div className="my-5 flex-1 min-h-[240px] max-h-[340px] overflow-y-auto space-y-3 rounded-xl bg-[#07060B] p-4 border border-white/6">
              {liveCaptions.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Start the live voice call and speak naturally into your microphone. {activeVoice?.name} will reply in real time.
                </p>
              ) : (
                liveCaptions.map((cap, i) => (
                  <div key={i} className={`text-xs leading-relaxed ${cap.role === 'user' ? 'text-zinc-300' : 'text-pink-200'}`}>
                    <span className="font-semibold text-white mr-2">
                      {cap.role === 'user' ? 'You:' : `${activeVoice?.name}:`}
                    </span>
                    {cap.text}
                  </div>
                ))
              )}
            </div>

            <p className="text-[11px] text-zinc-500">
              Billing starts when the live audio stream connects and stops automatically if your balance reaches 00:00.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-[#110D1B] flex flex-col h-[560px]">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
                <p className="font-display text-lg font-semibold text-white">
                  Say hello to {activeVoice?.name}
                </p>
                <p className="mt-1.5 text-xs text-zinc-400">
                  {studioTab === 'voice_message'
                    ? 'Record a voice note below. Your speech is transcribed and answered with a natural AI voice message.'
                    : 'Send a message in English, Hindi, Bhojpuri, or any supported language.'}
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      m.sender === 'user'
                        ? 'bg-[#181226] text-white border border-white/12'
                        : 'bg-[#07060B] text-zinc-100 border border-pink-500/20'
                    }`}
                  >
                    <p>{m.content}</p>
                    {m.sender === 'ai' && (m.detectedLanguage || m.detectedStyle) && (
                      <p className="mt-1.5 text-[11px] text-zinc-500">
                        {[m.detectedLanguage, m.detectedStyle].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {m.audioBase64 && (
                      <button
                        type="button"
                        onClick={() => playAudioSnippet(m.audioBase64!)}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-pink-400 hover:text-pink-300 cursor-pointer"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        Play Voice Reply
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {studioTab === 'voice_message' ? (
            <div className="border-t border-white/8 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex-1 w-full">
                <AudioWaveform active={isRecordingNote} level={isRecordingNote ? 0.78 : 0.16} height={40} />
              </div>
              {isRecordingNote ? (
                <button
                  type="button"
                  onClick={stopVoiceNoteRecording}
                  className="flex items-center gap-2 rounded-xl bg-red-600 hover:bg-red-500 px-6 py-3 text-xs font-semibold text-white cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Square className="h-4 w-4" />
                  Stop & Send Voice Note
                </button>
              ) : (
                <button
                  type="button"
                  disabled={sending}
                  onClick={startVoiceNoteRecording}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-blue-600 hover:from-pink-500 hover:to-blue-500 px-6 py-3 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Mic className="h-4 w-4" />
                  {sending ? 'Processing Audio...' : 'Record Voice Message'}
                </button>
              )}
            </div>
          ) : (
            <form onSubmit={handleSendText} className="border-t border-white/8 p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer shrink-0 px-1">
                <input
                  type="checkbox"
                  checked={speakReplies}
                  onChange={(e) => setSpeakReplies(e.target.checked)}
                  className="accent-pink-500"
                />
                Voice reply
              </label>
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={
                  selectedLanguage === 'auto'
                    ? `Write to ${activeVoice?.name} in any language (Hindi, Hinglish, Bhojpuri, English, Spanish...)`
                    : `Message ${activeVoice?.name} in ${languages.find((l) => l.code === selectedLanguage)?.name || 'your language'}...`
                }
                className="flex-1 rounded-xl border border-white/10 bg-[#07060B] px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-pink-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !textInput.trim()}
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:from-pink-500 hover:to-blue-500 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                {sending ? 'Sending...' : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
