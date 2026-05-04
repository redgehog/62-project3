export interface TranslationOptions {
  from?: string;
  to: string;
}

export async function translateText(
  text: string,
  options: TranslationOptions
): Promise<string> {
  try {
    const params = new URLSearchParams({
      q: text,
      tl: options.to,
      sl: options.from ?? 'auto',
    });

    const response = await fetch(`/api/translate?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Translation proxy error: ${response.status}`);
    }

    const data = await response.json();

    if (typeof data.translated === 'string') {
      return data.translated;
    }

    throw new Error(`Unexpected response: ${JSON.stringify(data)}`);
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

export type LanguageCode =
  typeof MAJOR_LANGUAGES[keyof typeof MAJOR_LANGUAGES];