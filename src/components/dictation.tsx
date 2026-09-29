"use client";

import React, { useEffect, useRef, useState } from "react";
import { Textarea, useToast } from "./ui";

/**
 * The browser's speech recogniser, as much of it as is used here. TypeScript ships the result
 * types but not the recogniser itself, because only Chromium and Safari have one, under a prefix.
 */
interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognizerClass(): (new () => Recognizer) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognizer;
    webkitSpeechRecognition?: new () => Recognizer;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The recogniser listening anywhere on the page. One field at a time: starting another stops it. */
let current: Recognizer | null = null;

/**
 * What to tell you when dictation fails. Anything not listed — "no-speech" when you said nothing,
 * "aborted" when it was stopped on purpose — is not worth a message.
 */
const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked for Overwatch. Allow it in the browser's site settings.",
  "service-not-allowed": "This browser won't dictate here. On a Mac, check Dictation is on in System Settings → Keyboard.",
  "audio-capture": "No microphone was found.",
  network: "Dictation could not reach the speech service. This browser needs an internet connection for it.",
};

/** Spoken text added after what is already written, with a capital if it starts a sentence. */
function append(base: string, spoken: string): string {
  if (!spoken) return base;
  const startsSentence = base.trim() === "" || /[.!?\n]\s*$/.test(base);
  const said = startsSentence ? spoken[0].toUpperCase() + spoken.slice(1) : spoken;
  return base === "" || /\s$/.test(base) ? base + said : `${base} ${said}`;
}

/**
 * A text box you can also speak into, through a faint microphone in its corner.
 *
 * The words appear as you say them and are added after whatever is already written. Typing while
 * it listens stops it, so the two never fight over the text. Where the browser has no speech
 * recognition (Firefox) the microphone is simply not there.
 */
export function DictationTextarea({
  value,
  onChange,
  className = "",
  placeholder,
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const toast = useToast();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognizer | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Checked after mount, because the server has no window and would render the page without it.
  useEffect(() => setSupported(recognizerClass() !== null), []);

  // Closing the editor mid-sentence stops the microphone rather than leaving it listening.
  useEffect(
    () => () => {
      const r = rec.current;
      rec.current = null;
      r?.abort();
    },
    []
  );

  const start = () => {
    const Recognition = recognizerClass();
    if (!Recognition) return;
    current?.stop();
    const r = new Recognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    const base = valueRef.current;
    r.onresult = (e) => {
      if (rec.current !== r) return;
      // Every phrase so far, the last one still being guessed at, so the text follows your voice.
      const phrases: string[] = [];
      for (let i = 0; i < e.results.length; i++) phrases.push(e.results[i][0].transcript.trim());
      onChangeRef.current(append(base, phrases.filter(Boolean).join(" ")));
    };
    r.onerror = (e) => {
      const message = ERRORS[e.error];
      if (message) toast(message, "error");
    };
    r.onend = () => {
      if (current === r) current = null;
      if (rec.current !== r) return;
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      current = null;
      setListening(false);
    }
  };

  // stop() rather than abort(): it lets the last phrase finish arriving before it ends.
  const stop = () => rec.current?.stop();

  return (
    <div className="relative group">
      <Textarea
        {...rest}
        value={value}
        placeholder={listening && !value ? "Listening…" : placeholder}
        onChange={(e) => {
          if (rec.current) {
            const r = rec.current;
            rec.current = null;
            setListening(false);
            r.abort();
          }
          onChange(e.target.value);
        }}
        className={`${supported ? "pr-8!" : ""} ${className}`}
      />
      {supported && (
        <button
          type="button"
          onClick={listening ? stop : start}
          aria-pressed={listening}
          aria-label={listening ? "Stop dictating" : "Dictate"}
          title={listening ? "Stop dictating" : "Dictate — speak instead of typing"}
          // The colours are forced: globals.css gives every button `color: inherit` outside any
          // layer, which outranks Tailwind's colour classes.
          className={`absolute top-1.5 right-1.5 p-1 rounded-xs transition-opacity ${
            listening
              ? "text-neg! opacity-100"
              : "text-ink-3! opacity-60 hover:opacity-100 hover:text-ink-2! group-focus-within:opacity-100"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={listening ? "animate-pulse" : ""} aria-hidden>
            <rect x="4" y="1" width="4" height="6.5" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2.4 5.8a3.6 3.6 0 0 0 7.2 0M6 9.4V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
