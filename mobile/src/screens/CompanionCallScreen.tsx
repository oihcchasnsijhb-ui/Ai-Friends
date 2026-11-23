import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { DilSeMobileClient } from '../api/client';

interface Props {
  client: DilSeMobileClient;
  initialVoiceId: 'voice-female-ananya' | 'voice-male-kabir';
  languageCode: string;
  mode: 'romantic' | 'friendship' | 'funny' | 'daily_life' | 'stories';
}

export const CompanionCallScreen: React.FC<Props> = ({
  client,
  initialVoiceId,
  languageCode,
  mode,
}) => {
  const [voiceId, setVoiceId] = useState(initialVoiceId);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'ended'>('idle');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [warning, setWarning] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const startCall = async () => {
    setStatus('connecting');
    setWarning(null);
    try {
      const { session, wallet }: any = await client.createSession({
        voiceId,
        mode: 'live_call',
        conversationStyle: mode,
        languageCode,
      });
      setRemainingSeconds(wallet.totalAvailableSeconds);

      const wsUrl = client.getLiveCallWebSocketUrl({
        sessionId: session.id,
        voiceId,
        mode,
        lang: languageCode,
      });

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ready') setStatus('live');
        if (msg.type === 'wallet_tick') setRemainingSeconds(msg.remainingSeconds);
        if (msg.type === 'low_balance_warning') {
          setWarning(`Low balance: ${msg.remainingSeconds}s remaining`);
        }
        if (msg.type === 'balance_exhausted') {
          setWarning('Session ended automatically because wallet balance reached 00:00.');
          setStatus('ended');
          ws.close();
        }
      };
      ws.onclose = () => setStatus('ended');
    } catch (err: any) {
      setWarning(err.message);
      setStatus('idle');
    }
  };

  const endCall = () => {
    wsRef.current?.close();
    setStatus('ended');
  };

  const mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const secs = String(remainingSeconds % 60).padStart(2, '0');

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>DIL SE AI · {Platform.OS.toUpperCase()}</Text>
      <Text style={styles.disclosure}>AI-Generated Companion · Not a real person</Text>

      <Text style={styles.companionName}>
        {voiceId === 'voice-female-ananya' ? 'Ananya (Female AI)' : 'Kabir (Male AI)'}
      </Text>
      <Text style={styles.timer}>
        {mins}:{secs}
      </Text>

      {warning ? <Text style={styles.warning}>{warning}</Text> : null}

      <View style={styles.switchRow}>
        <TouchableOpacity
          style={[styles.switchBtn, voiceId === 'voice-female-ananya' && styles.switchActive]}
          onPress={() => setVoiceId('voice-female-ananya')}
        >
          <Text style={styles.btnText}>Ananya</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.switchBtn, voiceId === 'voice-male-kabir' && styles.switchActive]}
          onPress={() => setVoiceId('voice-male-kabir')}
        >
          <Text style={styles.btnText}>Kabir</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={status === 'live' ? styles.endBtn : styles.callBtn}
        onPress={status === 'live' ? endCall : startCall}
      >
        <Text style={styles.btnText}>
          {status === 'live' ? 'End Live Call' : status === 'connecting' ? 'Connecting...' : 'Start Live AI Call'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07060B', padding: 24, justifyContent: 'center', alignItems: 'center' },
  brand: { color: '#EC4899', fontSize: 13, fontWeight: '700', letterSpacing: 1.2 },
  disclosure: { color: '#A1A1AA', fontSize: 12, marginTop: 6, marginBottom: 24 },
  companionName: { color: '#FFFFFF', fontSize: 26, fontWeight: '700' },
  timer: { color: '#93C5FD', fontSize: 36, fontVariant: ['tabular-nums'], marginVertical: 16 },
  warning: { color: '#FBBF24', fontSize: 13, marginBottom: 16, textAlign: 'center' },
  switchRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  switchBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: '#181226' },
  switchActive: { borderWidth: 1, borderColor: '#EC4899' },
  callBtn: { backgroundColor: '#EC4899', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 },
  endBtn: { backgroundColor: '#DC2626', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 },
  btnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
});
