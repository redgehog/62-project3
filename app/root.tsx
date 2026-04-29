import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { createContext, useEffect, useState } from "react";
import { ClerkProvider } from "@clerk/react-router";
import { clerkMiddleware, rootAuthLoader } from "@clerk/react-router/server";
import type { LanguageCode } from "./translate";
import { TTSProvider, TTSWidget } from "./tts";

import type { Route } from "./+types/root";
import "./app.css";

export const middleware: Route.MiddlewareFunction[] = [clerkMiddleware()];
export const loader = (args: Route.LoaderArgs) => rootAuthLoader(args);

type TranslationContextValue = {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
};

export const TranslationContext = createContext<TranslationContextValue | null>(null);

type HighContrastContextValue = {
  highContrast: boolean;
  toggleHighContrast: () => void;
  uiScale: "normal" | "large" | "xlarge";
  setUiScale: (scale: "normal" | "large" | "xlarge") => void;
};

export const HighContrastContext = createContext<HighContrastContextValue | null>(null);

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Reads localStorage before first paint to avoid a flash when high-contrast was previously enabled */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(localStorage.getItem('high-contrast')==='true')document.documentElement.classList.add('high-contrast');}catch(e){}})();` }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [highContrast, setHighContrast] = useState(false);
  const [uiScale, setUiScale] = useState<"normal" | "large" | "xlarge">("normal");

  // Sync initial value from localStorage (after hydration)
  useEffect(() => {
    setHighContrast(localStorage.getItem("high-contrast") === "true");
    const savedScale = localStorage.getItem("ui-scale");
    if (savedScale === "normal" || savedScale === "large" || savedScale === "xlarge") {
      setUiScale(savedScale);
    }
  }, []);

  // Apply/remove class and persist preference whenever it changes
  useEffect(() => {
    document.documentElement.classList.toggle("high-contrast", highContrast);
    localStorage.setItem("high-contrast", String(highContrast));
  }, [highContrast]);

  useEffect(() => {
    const fontSizeByScale = {
      normal: "16px",
      large: "18px",
      xlarge: "20px",
    } as const;
    document.documentElement.style.fontSize = fontSizeByScale[uiScale];
    localStorage.setItem("ui-scale", uiScale);
  }, [uiScale]);

  const toggleHighContrast = () => setHighContrast(v => !v);

  return (
    <ClerkProvider loaderData={loaderData}>
      <TranslationContext.Provider value={{ language, setLanguage }}>
        <HighContrastContext.Provider value={{ highContrast, toggleHighContrast, uiScale, setUiScale }}>
          <TTSProvider>
            <Outlet />
            <TTSWidget />
          </TTSProvider>
        </HighContrastContext.Provider>
      </TranslationContext.Provider>
    </ClerkProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
