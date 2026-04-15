const GOOGLE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';

export interface TranslationOptions {
  from?: string; // source language, auto-detect if not provided
  to: string;   // target language code (e.g., 'es', 'fr', 'zh', 'ja', 'de', 'it', 'pt', 'ru')
}

export async function translateText(text: string, options: TranslationOptions): Promise<string> {
  try {
    const source = options.from || 'auto';
    const target = options.to;
    const params = new URLSearchParams({
      client: 'gtx',
      sl: source,
      tl: target,
      dt: 't',
      q: text,
    });

    const response = await fetch(`${GOOGLE_TRANSLATE_URL}?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status}`);
    }

    const data = await response.json();
    const translated = data?.[0]?.[0]?.[0];

    if (typeof translated === 'string') {
      return translated;
    }

    throw new Error(`Unexpected Google Translate response: ${JSON.stringify(data)}`);
  } catch (error) {
    console.error('Translation failed:', error);
    return text;
  }
}

// Common language codes for 8 major languages
export const MAJOR_LANGUAGES = {
  'English': 'en',
  'Español': 'es',
  'Français': 'fr',
  '中文': 'zh',
  '日本語': 'ja',
  'Deutsch': 'de',
  'Italiano': 'it',
  'Português': 'pt',
  'Русский': 'ru',
} as const;

export type LanguageCode = typeof MAJOR_LANGUAGES[keyof typeof MAJOR_LANGUAGES];