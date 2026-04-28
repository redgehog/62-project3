import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { TranslationContext } from "./root";

const TTS_HIDDEN_ROUTES = ["/kitchen", "/menu-board"];

const LANG_BCP47: Record<string, string> = {
  en: "en-US", es: "es-ES", fr: "fr-FR", zh: "zh-CN",
  ja: "ja-JP", de: "de-DE", it: "it-IT", pt: "pt-BR", ru: "ru-RU",
};

interface TTSContextValue {
  speak:      (text: string) => void;
  stop:       () => void;
  isSpeaking: boolean;
}

export const TTSContext = createContext<TTSContextValue | null>(null);
export const useTTS = () => useContext(TTSContext);

function getPageText(): string {
  const region =
    document.querySelector<HTMLElement>(".page-section") ??
    document.querySelector<HTMLElement>("main") ??
    document.querySelector<HTMLElement>('[role="main"]') ??
    document.body;

  // Clone so we can strip hidden/decorative nodes without mutating the DOM
  const clone = region.cloneNode(true) as HTMLElement;

  // Remove elements that shouldn't be read (scripts, styles, hidden items)
  clone.querySelectorAll("script, style, [aria-hidden='true'], [data-tts-skip]")
    .forEach(el => el.remove());

  const text = (clone.innerText ?? clone.textContent ?? "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Cap at ~4000 chars so synthesis doesn't run forever
  return text.slice(0, 4000);
}

export function TTSProvider({ children }: { children: React.ReactNode }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const translationCtx = useContext(TranslationContext);
  const utteranceRef   = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = () => {
    if (typeof window === "undefined") return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const speak = (text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const lang    = translationCtx?.language ?? "en";
    const bcp47   = LANG_BCP47[lang] ?? "en-US";
    const utt     = new SpeechSynthesisUtterance(text);
    utt.lang      = bcp47;
    utt.rate      = 1;
    utt.onstart   = () => setIsSpeaking(true);
    utt.onend     = () => setIsSpeaking(false);
    utt.onerror   = () => setIsSpeaking(false);

    utteranceRef.current = utt;
    window.speechSynthesis.speak(utt);
  };

  // Cancel on unmount
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  return (
    <TTSContext.Provider value={{ speak, stop, isSpeaking }}>
      {children}
    </TTSContext.Provider>
  );
}

export function TTSWidget() {
  const ctx      = useContext(TTSContext);
  const location = useLocation();
  if (!ctx || TTS_HIDDEN_ROUTES.includes(location.pathname)) return null;
  const { speak, stop, isSpeaking } = ctx;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2"
      data-tts-skip
      aria-label="Text to speech controls"
    >
      {isSpeaking ? (
        <button
          onClick={stop}
          aria-label="Stop reading"
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
        >
          <span aria-hidden="true">■</span> Stop
        </button>
      ) : (
        <button
          onClick={() => speak(getPageText())}
          aria-label="Read page content aloud"
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-lg transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          <span aria-hidden="true">▶</span> Read Page
        </button>
      )}
    </div>
  );
}
