import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface CompanionConfig {
  voiceName: string;
  companionName: string;
  gender: 'female' | 'male';
  personalityPrompt: string;
  mode: string;
  languageName: string;
  userName: string;
}

export interface MatchedCompanionReply {
  reply: string;
  detectedLanguage: string;
  detectedLanguageCode: string;
  detectedStyle: string;
  voiceDeliveryCue: string;
}

const MODE_DIRECTIVES: Record<string, string> = {
  auto:
    'Adaptive style matching: mirror the user’s exact emotional tone and communication style automatically.',
  romantic:
    'Warm, affectionate, poetic, and thoughtful romantic companion tone—keep interactions tasteful, uplifting, respectful, and emotionally healthy.',
  friendship:
    'Warm, supportive, attentive best-friend tone—curious about the user’s day, playful, encouraging, and easy to talk to.',
  funny:
    'Witty, lighthearted, clever banter and joyful humor—keep jokes relatable, charming, and never mean-spirited.',
  daily_life:
    'Grounded everyday companion for life check-ins, routines, work reflections, food, music, and calm conversation.',
  stories:
    'Imaginative storyteller and entertainer—weave vivid short stories, interactive scenarios, and engaging tales on demand.',
};

export function buildCompanionSystemInstruction(cfg: CompanionConfig): string {
  const modeNote = MODE_DIRECTIVES[cfg.mode] || MODE_DIRECTIVES.friendship;
  const isAutoLang = !cfg.languageName || cfg.languageName.toLowerCase() === 'auto-detect' || cfg.languageName.toLowerCase() === 'auto';

  return [
    cfg.personalityPrompt,
    `You are speaking with ${cfg.userName || 'a friend'} on DIL SE AI ("Your AI Friend, Always Ready to Talk").`,
    `Base companion mood preference: ${modeNote}`,
    '',
    'SMART LANGUAGE DETECTION & SWITCHING RULES (HIGHEST PRIORITY):',
    isAutoLang
      ? '1. Automatically detect the exact language of the user’s LATEST message (written or spoken) and reply exclusively in that exact same language.'
      : `1. Preferred fallback language is ${cfg.languageName}, BUT if the user’s latest message is written or spoken in any other language, IMMEDIATELY follow the user’s latest language automatically.`,
    '2. Supported regional & global languages include: Hindi, English, Hinglish (Romanized Hindi-English mix), Bhojpuri, Urdu, Punjabi, Bengali, Marathi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Spanish, French, Arabic, German, Portuguese, Japanese, Korean, and others.',
    '3. Mid-conversation switching: If the user switches languages on any turn (e.g., English -> Hindi -> Bhojpuri -> Hinglish), switch cleanly and immediately to the newest language without commenting on the switch.',
    '4. Do NOT unnecessarily mix languages: if the user writes pure Hindi (Devanagari), respond in natural Hindi; if the user writes Hinglish (Latin script), respond in natural Hinglish; if Bhojpuri, respond in authentic Bhojpuri; if Spanish/French/Arabic/etc., stay cleanly in that language.',
    '5. Understand regional words, slang, and cultural expressions naturally. Do NOT translate the user’s message unless they explicitly ask you to translate.',
    '6. If language detection is genuinely uncertain (e.g., ambiguous single token or unclear audio), politely ask in simple bilingual/clear phrasing which language they prefer.',
    '',
    'PERSONALITY, COMMUNICATION STYLE & LENGTH MATCHING:',
    '1. Casual user -> respond casually and naturally.',
    '2. Polite/formal user -> respond politely and respectfully.',
    '3. Funny/playful user -> respond with friendly, lighthearted humor.',
    '4. Romantic user -> respond warmly, gently, and respectfully.',
    '5. Serious user -> respond thoughtfully and seriously.',
    '6. Emotional/upset user -> respond with genuine empathy, warmth, and kindness.',
    '7. Short messages -> give short, crisp, natural replies (1–2 sentences). Detailed/long messages -> give rich, engaging, thoughtful replies.',
    '8. Keep your selected companion voice identity consistent; adapt speaking speed, tone, natural pauses, and emotional cadence. Never imitate a real person’s voice.',
    '',
    'SAFETY & ETHICS:',
    '1. Never copy or echo abusive, harassing, or hateful language; respond calmly and respectfully.',
    '2. Always be honest that you are an AI companion if asked; never claim to be a real human being.',
    '3. Never emotionally manipulate users or pressure them into buying more minutes.',
  ].join('\n');
}

export async function generateCompanionTextReply(params: {
  config: CompanionConfig;
  history: Array<{ sender: string; content: string }>;
  userMessage: string;
}): Promise<MatchedCompanionReply> {
  const ai = getGeminiClient();
  const systemInstruction = buildCompanionSystemInstruction(params.config);

  const contents = params.history.slice(-14).map((m) => ({
    role: m.sender === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  contents.push({
    role: 'user',
    parts: [{ text: params.userMessage }],
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detectedLanguage: {
            type: Type.STRING,
            description: 'Human-readable name of the language detected in the user’s latest message (e.g. Hindi, Hinglish, Bhojpuri, English, Spanish, Tamil).',
          },
          detectedLanguageCode: {
            type: Type.STRING,
            description: 'Short code such as en, hi, hinglish, bho, ur, pa, bn, mr, gu, ta, te, kn, ml, es, fr, ar, de, pt, ja, ko.',
          },
          detectedStyle: {
            type: Type.STRING,
            description: 'Detected speaking style and length match (e.g. Casual · Short, Empathetic · Detailed, Funny · Playful, Polite · Formal, Warm Romantic).',
          },
          voiceDeliveryCue: {
            type: Type.STRING,
            description: 'Concise TTS voice direction adapting speed, pauses, tone, formality, and emotion while keeping the companion voice identity.',
          },
          reply: {
            type: Type.STRING,
            description: 'The natural companion response strictly in the detected language and matching speaking style and length.',
          },
        },
        required: ['detectedLanguage', 'detectedLanguageCode', 'detectedStyle', 'voiceDeliveryCue', 'reply'],
      },
    },
  });

  const raw = (response.text ?? '').trim();
  try {
    const parsed = JSON.parse(raw) as Partial<MatchedCompanionReply>;
    if (parsed.reply && parsed.reply.trim()) {
      return {
        reply: parsed.reply.trim(),
        detectedLanguage: parsed.detectedLanguage || 'English',
        detectedLanguageCode: parsed.detectedLanguageCode || 'en',
        detectedStyle: parsed.detectedStyle || 'Natural',
        voiceDeliveryCue: parsed.voiceDeliveryCue || 'Warm, natural conversational pace',
      };
    }
  } catch {
    // Fallback if non-JSON output ever occurs
  }

  return {
    reply: raw || 'I am here with you. Could you tell me which language you prefer?',
    detectedLanguage: 'Auto',
    detectedLanguageCode: 'auto',
    detectedStyle: 'Natural',
    voiceDeliveryCue: 'Warm, attentive conversational cadence',
  };
}

export async function synthesizeCompanionSpeech(params: {
  text: string;
  voiceName: string;
  gender: 'female' | 'male';
  mode: string;
  voiceDeliveryCue?: string;
}): Promise<string> {
  const ai = getGeminiClient();
  const baseCharacter =
    params.gender === 'female'
      ? 'Sweet, friendly, expressive female AI companion voice'
      : 'Relaxed, grounded, expressive male AI companion voice';
  const style = params.voiceDeliveryCue
    ? `${baseCharacter}. Delivery: ${params.voiceDeliveryCue}`
    : `${baseCharacter} (${params.mode} mood)`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: params.text,
            speechMetadata: { style },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: params.voiceName || (params.gender === 'female' ? 'Kore' : 'Charon'),
          },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Speech synthesis returned empty audio payload.');
  }
  return base64Audio;
}

export async function transcribeUserAudio(params: {
  base64Audio: string;
  mimeType: string;
}): Promise<string> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.base64Audio,
          },
        },
        {
          text: 'Transcribe this spoken voice message verbatim in the exact spoken language and script (e.g., Hindi, Bhojpuri, Hinglish, Urdu, Punjabi, Bengali, Marathi, Gujarati, Tamil, Telugu, Kannada, Malayalam, English, Spanish, French, Arabic, German, Portuguese, Japanese, Korean). Do NOT translate.',
        },
      ],
    },
  });
  return (response.text ?? '').trim();
}
