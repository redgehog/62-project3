import { useState, useCallback, useRef } from "react";

export function useSpeechToText(onResult: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognition | null>(null);

  const supported = typeof window !== "undefined" &&
    !!(window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  const start = useCallback(() => {
    if (!supported) return;
    const SR: typeof SpeechRecognition =
      window.SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition: typeof SpeechRecognition }).webkitSpeechRecognition;

    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (e: SpeechRecognitionEvent) => {
      onResult(e.results[0][0].transcript);
    };

    recRef.current = rec;
    rec.start();
  }, [onResult, supported]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    listening ? stop() : start();
  }, [listening, start, stop]);

  return { listening, toggle, supported };
}
