"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import {
  SENTENCE_HIGHLIGHT,
  WORD_HIGHLIGHT,
  collectSpeechText,
  pickVoice,
  rangeForOffsets,
  setSpeechHighlight,
  splitSentences,
  wordEnd,
  type SpeechText,
} from "@/lib/read-aloud";

export type ReadAloudState = 'idle' | 'speaking' | 'paused';

interface Options {
  /** The element whose text is read; looked up when reading starts. */
  getRoot: () => Element | null;
  /** The text's language (BCP 47), when known; otherwise the voice decides. */
  lang?: string | null;
  /** Reading stops when this changes (another message opened). */
  resetKey?: unknown;
}

function speech(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
    ? window.speechSynthesis
    : null;
}

/**
 * Reads a message aloud with the browser's speech synthesis, at the speed
 * and in the voice from Settings > Accessibility, one sentence per utterance.
 * The sentence being read is highlighted, and the word too where the browser
 * sends word boundary events.
 */
export function useReadAloud({ getRoot, lang, resetKey }: Options) {
  const rate = useSettingsStore((state) => state.readAloudRate);
  const voiceName = useSettingsStore((state) => state.readAloudVoice);
  const [state, setState] = useState<ReadAloudState>('idle');
  const supported = speech() !== null;
  // Bumped by every start and stop, so callbacks of an old run do nothing.
  const runRef = useRef(0);
  const docRef = useRef<Document | null>(null);

  const clearHighlights = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    setSpeechHighlight(doc, SENTENCE_HIGHLIGHT, null);
    setSpeechHighlight(doc, WORD_HIGHLIGHT, null);
  }, []);

  const stop = useCallback(() => {
    runRef.current += 1;
    speech()?.cancel();
    clearHighlights();
    setState('idle');
  }, [clearHighlights]);

  const start = useCallback(() => {
    const synth = speech();
    const root = getRoot();
    if (!synth || !root) return;
    synth.cancel();
    clearHighlights();
    const run = ++runRef.current;
    const doc = root.ownerDocument;
    docRef.current = doc;
    const text: SpeechText = collectSpeechText(root);
    const chunks = splitSentences(text.text, lang ?? undefined);
    if (chunks.length === 0) {
      setState('idle');
      return;
    }
    const voice = pickVoice(synth.getVoices(), voiceName);

    const speakChunk = (index: number) => {
      if (run !== runRef.current) return;
      if (index >= chunks.length) {
        clearHighlights();
        setState('idle');
        return;
      }
      const chunk = chunks[index];
      const utterance = new SpeechSynthesisUtterance(text.text.slice(chunk.start, chunk.end));
      utterance.rate = rate;
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else if (lang) {
        utterance.lang = lang;
      }
      utterance.onstart = () => {
        if (run !== runRef.current) return;
        const range = rangeForOffsets(text, chunk.start, chunk.end);
        setSpeechHighlight(doc, SENTENCE_HIGHLIGHT, range);
        setSpeechHighlight(doc, WORD_HIGHLIGHT, null);
        // Keep the sentence on screen without animating the scroll.
        const anchor = range?.startContainer.parentElement;
        anchor?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      };
      utterance.onboundary = (event) => {
        if (run !== runRef.current || event.name !== 'word') return;
        const from = chunk.start + event.charIndex;
        const to = event.charLength ? from + event.charLength : wordEnd(text.text, from);
        setSpeechHighlight(doc, WORD_HIGHLIGHT, rangeForOffsets(text, from, to));
      };
      utterance.onend = () => speakChunk(index + 1);
      utterance.onerror = (event) => {
        // "interrupted"/"canceled" come from our own stop.
        if (run !== runRef.current) return;
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        stop();
      };
      synth.speak(utterance);
    };
    setState('speaking');
    speakChunk(0);
  }, [getRoot, lang, rate, voiceName, clearHighlights, stop]);

  const pause = useCallback(() => {
    speech()?.pause();
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    speech()?.resume();
    setState('speaking');
  }, []);

  // Another message, or the reader closed: stop talking.
  useEffect(() => stop, [resetKey, stop]);

  return { supported, state, start, pause, resume, stop };
}

/** The browser's speech voices, updated when the browser finishes loading them. */
export function useSpeechVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => speech()?.getVoices() ?? []);
  useEffect(() => {
    const synth = speech();
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener?.('voiceschanged', update);
    return () => synth.removeEventListener?.('voiceschanged', update);
  }, []);
  return voices;
}
