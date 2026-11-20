import { z } from 'zod';

/** Translation of one message on demand (CDC section 6). Consent 'translation' and an on-screen notice are required. */
export const TRANSLATION_LOCALES = ['fr', 'en', 'sw'] as const;
export const translationLocaleSchema = z.enum(TRANSLATION_LOCALES);
export type TranslationLocale = z.infer<typeof translationLocaleSchema>;

/** Longest message text sent to the provider. */
export const TRANSLATION_TEXT_MAX = 2000;

export const translateMessageRequestSchema = z.object({
  target: translationLocaleSchema,
  /** The client shows what leaves for the provider before asking; always true. */
  informed: z.literal(true),
});
export type TranslateMessageRequest = z.infer<typeof translateMessageRequestSchema>;

export const translationResultSchema = z.object({
  text: z.string(),
  targetLocale: translationLocaleSchema,
  /** Always true: the original stays one tap away. */
  machineTranslated: z.literal(true),
  /** Catalogue id of the model that produced the translation. */
  provider: z.string(),
  cached: z.boolean(),
});
export type TranslationResult = z.infer<typeof translationResultSchema>;
