import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { TranslationContext, HighContrastContext } from "./root";

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

  const clone = region.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, style, [aria-hidden='true'], [data-tts-skip]")
    .forEach(el => el.remove());

  const text = (clone.innerText ?? clone.textContent ?? "")
    .replace(/\s{2,}/g, " ")
    .trim();

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

  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  return (
    <TTSContext.Provider value={{ speak, stop, isSpeaking }}>
      {children}
    </TTSContext.Provider>
  );
}

const LENS_SIZE = 400;
const ZOOM = 2.2;

function MagnifierLens({ mouseX, mouseY }: { mouseX: number; mouseY: number }) {
  const cloneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      if (!cloneRef.current) return;
      const bodyClone = document.body.cloneNode(true) as HTMLElement;
      // Remove the lens itself from the clone to prevent infinite nesting
      bodyClone.querySelectorAll("[data-magnifier-lens]").forEach(el => el.remove());
      cloneRef.current.replaceChildren(...Array.from(bodyClone.childNodes));
    };
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, []);

  const R = LENS_SIZE / 2;

  return createPortal(
    <div
      data-magnifier-lens
      style={{
        position:      "fixed",
        left:          mouseX - R,
        top:           mouseY - R,
        width:         LENS_SIZE,
        height:        LENS_SIZE,
        borderRadius:  "50%",
        overflow:      "hidden",
        pointerEvents: "none",
        zIndex:        10000,
        border:        "3px solid rgba(0,0,0,0.45)",
        boxShadow:     "0 4px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div
        ref={cloneRef}
        style={{
          position:        "absolute",
          top:             R - mouseY,
          left:            R - mouseX,
          width:           "100vw",
          height:          "100vh",
          transform:       `scale(${ZOOM})`,
          transformOrigin: `${mouseX}px ${mouseY}px`,
          pointerEvents:   "none",
          background:      "white",
        }}
      />
    </div>,
    document.body
  );
}

export function TTSWidget() {
  const ctx    = useContext(TTSContext);
  const hcCtx  = useContext(HighContrastContext);
  const location = useLocation();

  const [magnifierOn, setMagnifierOn] = useState(false);
  const [mousePos, setMousePos]       = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!magnifierOn) return;
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, [magnifierOn]);

  if (!ctx || TTS_HIDDEN_ROUTES.includes(location.pathname)) return null;

  const { speak, stop, isSpeaking } = ctx;
  const highContrast       = hcCtx?.highContrast ?? false;
  const toggleHighContrast = hcCtx?.toggleHighContrast ?? (() => {});

  return (
    <>
      <div
        className="fixed bottom-5 left-5 z-50 flex flex-col items-start gap-2"
        data-tts-skip
        aria-label="Accessibility controls"
      >
        <button
          onClick={toggleHighContrast}
          aria-pressed={highContrast}
          aria-label={highContrast ? "Disable high contrast mode" : "Enable high contrast mode"}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold shadow-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2
            ${highContrast
              ? "bg-yellow-400 hover:bg-yellow-300 text-black focus:ring-yellow-400"
              : "bg-slate-700 hover:bg-slate-600 text-white focus:ring-slate-500"}`}
        >
          <span aria-hidden="true">◑</span> {highContrast ? "Normal" : "High Contrast"}
        </button>

        <button
          type="button"
          onClick={() => setMagnifierOn(v => !v)}
          aria-pressed={magnifierOn}
          aria-label={magnifierOn ? "Disable magnifier" : "Enable magnifier"}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold shadow-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2
            ${magnifierOn
              ? "bg-indigo-600 hover:bg-indigo-500 text-white focus:ring-indigo-500"
              : "bg-slate-700 hover:bg-slate-600 text-white focus:ring-slate-500"}`}
        >
          <span aria-hidden="true">🔍</span> {magnifierOn ? "Magnifier On" : "Magnifier"}
        </button>

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

      {magnifierOn && <MagnifierLens mouseX={mousePos.x} mouseY={mousePos.y} />}
    </>
  );
}
