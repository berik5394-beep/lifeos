import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useVoice } from '@/hooks/use-voice';
import { useUtterance } from '@/hooks/use-utterance';
import { DictationModal } from '@/components/voice';

/**
 * Один микрофон на весь дом (инструменты ↔ комната). Два useVoice на двух
 * экранах слушали бы одно распознавание и слали фразу дважды — поэтому голос
 * живёт здесь, а экраны берут его из контекста.
 */
export interface SharedVoice {
  isRecording: boolean;
  isProcessing: boolean;
  liveTranscript: string;
  error: string | null;
  startRecording: () => Promise<void> | void;
  stopRecording: () => Promise<void> | void;
  /** Сказанное/набранное → кодовое слово, диктофон, режим разговора или мозг. */
  send: (text: string) => void;
  /** Юзер печатает — робот «слушает». */
  typing: boolean;
  setTyping: (on: boolean) => void;
  /** Знакомство подсвечивает строку ввода. */
  inputHighlight: boolean;
  setInputHighlight: (on: boolean) => void;
}

const Ctx = createContext<SharedVoice | null>(null);

export function SharedVoiceProvider({ children }: { children: ReactNode }) {
  const { isRecording, isProcessing, lastResult, liveTranscript, error, startRecording, stopRecording } = useVoice({
    transcribeOnly: true,
  });
  const utterance = useUtterance();
  const handle = utterance.handle;
  useEffect(() => {
    if (lastResult?.transcript) handle(lastResult.transcript);
  }, [lastResult, handle]);
  const [typing, setTyping] = useState(false);
  const [inputHighlight, setInputHighlight] = useState(false);

  const value = useMemo<SharedVoice>(
    () => ({
      isRecording,
      isProcessing,
      liveTranscript: liveTranscript ?? '',
      error: error ?? null,
      startRecording,
      stopRecording,
      send: handle,
      typing,
      setTyping,
      inputHighlight,
      setInputHighlight,
    }),
    [isRecording, isProcessing, liveTranscript, error, startRecording, stopRecording, handle, typing, inputHighlight],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <DictationModal visible={utterance.dictationOpen} onClose={utterance.closeDictation} />
    </Ctx.Provider>
  );
}

export function useSharedVoice(): SharedVoice {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSharedVoice: нет SharedVoiceProvider');
  return v;
}
