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

  return ((clone.innerText ?? clone.textContent ?? "")
    .replace(/\s{2,}/g, " ").trim()).slice(0, 4000);
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
    const lang  = translationCtx?.language ?? "en";
    const utt   = new SpeechSynthesisUtterance(text);
    utt.lang    = LANG_BCP47[lang] ?? "en-US";
    utt.rate    = 1;
    utt.onstart = () => setIsSpeaking(true);
    utt.onend   = () => setIsSpeaking(false);
    utt.onerror = () => setIsSpeaking(false);
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
      bodyClone.querySelectorAll("[data-magnifier-lens]").forEach(el => el.remove());
      cloneRef.current.replaceChildren(...Array.from(bodyClone.childNodes));
    };
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, []);

  const R = LENS_SIZE / 2;
  return createPortal(
    <div data-magnifier-lens style={{
      position: "fixed", left: mouseX - R, top: mouseY - R,
      width: LENS_SIZE, height: LENS_SIZE, borderRadius: "50%",
      overflow: "hidden", pointerEvents: "none", zIndex: 10000,
      border: "3px solid rgba(0,0,0,0.45)", boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
    }}>
      <div ref={cloneRef} style={{
        position: "absolute", top: R - mouseY, left: R - mouseX,
        width: "100vw", height: "100vh",
        transform: `scale(${ZOOM})`, transformOrigin: `${mouseX}px ${mouseY}px`,
        pointerEvents: "none", background: "white",
      }} />
    </div>,
    document.body
  );
}

export function TTSWidget() {
  const ctx     = useContext(TTSContext);
  const hcCtx   = useContext(HighContrastContext);
  const tranCtx = useContext(TranslationContext);
  const location = useLocation();

  const [panelOpen, setPanelOpen]     = useState(false);
  const [magnifierOn, setMagnifierOn] = useState(false);
  const [mousePos, setMousePos]       = useState({ x: 0, y: 0 });
  const [dictating, setDictating]     = useState(false);
  const dictRef  = useRef<SpeechRecognition | null>(null);

  const stopDictation = () => {
    dictRef.current?.stop();
    dictRef.current = null;
    setDictating(false);
  };

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

  const hasSpeechAPI = typeof window !== "undefined" &&
    !!(window.SpeechRecognition ||
       (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  const toggleDictation = () => {
    if (dictating) { stopDictation(); return; }
    const SR: typeof SpeechRecognition =
      window.SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition: typeof SpeechRecognition }).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = LANG_BCP47[tranCtx?.language ?? "en"] ?? "en-US";
    rec.continuous = true;   // keep listening until explicitly stopped
    rec.interimResults = false;
    rec.onstart  = () => setDictating(true);
    rec.onend    = () => setDictating(false);
    rec.onerror  = () => { stopDictation(); };
    rec.onresult = (e: SpeechRecognitionEvent) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const text = e.results[i][0].transcript;
        const el = document.activeElement;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const proto = el instanceof HTMLInputElement
            ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) {
            setter.call(el, el.value + (el.value ? " " : "") + text);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      }
    };
    dictRef.current = rec;
    rec.start();
  };

  const btn = "flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1";

  return (
    <>
      <div
        className="fixed bottom-0 left-0 z-50 flex flex-col items-start pl-4 pb-3"
        data-tts-skip
        aria-label="Accessibility controls"
      >
        {/* Collapsible panel — slides up from the toggle button */}
        {panelOpen && (
          <div className="mb-2 bg-slate-800/95 backdrop-blur-sm rounded-2xl shadow-xl p-3 flex flex-col gap-1.5 w-52 border border-slate-700">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-1 mb-0.5">Accessibility</p>

            <button onClick={toggleHighContrast} aria-pressed={highContrast}
              className={`${btn} focus:ring-yellow-400 ${highContrast ? "bg-yellow-400 text-black" : "bg-slate-700 text-white hover:bg-slate-600"}`}>
              <span aria-hidden="true">◑</span>
              {highContrast ? "Normal Mode" : "High Contrast"}
            </button>

            <button type="button" onClick={() => setMagnifierOn(v => !v)} aria-pressed={magnifierOn}
              className={`${btn} focus:ring-indigo-500 ${magnifierOn ? "bg-indigo-600 text-white" : "bg-slate-700 text-white hover:bg-slate-600"}`}>
              <span aria-hidden="true">🔍</span>
              {magnifierOn ? "Magnifier On" : "Magnifier"}
            </button>

            {isSpeaking ? (
              <button onClick={stop}
                className={`${btn} bg-red-600 hover:bg-red-700 text-white focus:ring-red-500`}>
                <span aria-hidden="true">■</span> Stop Reading
              </button>
            ) : (
              <button onClick={() => speak(getPageText())}
                className={`${btn} bg-slate-700 text-white hover:bg-slate-600 focus:ring-indigo-500`}>
                <span aria-hidden="true">▶</span> Read Page
              </button>
            )}

            {hasSpeechAPI && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleDictation}
                aria-pressed={dictating}
                className={`${btn} focus:ring-red-500 ${dictating ? "bg-red-600 text-white animate-pulse" : "bg-slate-700 text-white hover:bg-slate-600"}`}
              >
                <span aria-hidden="true">🎤</span>
                {dictating ? "Listening…" : "Dictate to field"}
              </button>
            )}
          </div>
        )}

        {/* Panel toggle — minimal footprint when closed */}
        <button
          type="button"
          onClick={() => setPanelOpen(v => !v)}
          aria-expanded={panelOpen}
          aria-label="Toggle accessibility panel"
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white px-3.5 py-2 rounded-full shadow-lg text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <span aria-hidden="true">♿</span>
          <span aria-hidden="true" className="text-xs">{panelOpen ? "▼" : "▲"}</span>
        </button>
      </div>

      {magnifierOn && <MagnifierLens mouseX={mousePos.x} mouseY={mousePos.y} />}
    </>
  );
}
