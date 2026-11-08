import type { AiCatalogEntry } from '@caselind/contracts';

/**
 * Default AI_MODELS catalogue. Model names and data policies are indicative and must be re-checked by the
 * owner against each provider's current terms before enabling a model (ADR-022). `trainsOnData`:
 * Gemini free tier may use submitted content to improve Google products; Groq states it does not train on
 * customer data; the others are not established here ("unknown").
 */
export const DEFAULT_AI_MODELS: AiCatalogEntry[] = [
  {
    id: 'gemini-flash',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    label: 'Gemini Flash (Google)',
    free: true,
    trainsOnData: true,
    dataPolicy:
      "Offre gratuite de Google AI Studio : vos questions peuvent être utilisées par Google pour améliorer ses produits et relues par des humains, y compris hors de l'EEE. N'y mettez rien de sensible.",
    speed: 'fast',
  },
  {
    id: 'groq-llama',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B (Groq)',
    free: true,
    trainsOnData: false,
    dataPolicy: "Groq indique ne pas entraîner de modèles sur les données des clients de son API. Les échanges transitent par ses serveurs, hors de l'EEE.",
    speed: 'fast',
  },
  {
    id: 'mistral-small',
    provider: 'mistral',
    model: 'mistral-small-latest',
    label: 'Mistral Small (Mistral AI)',
    free: false,
    trainsOnData: 'unknown',
    dataPolicy: "Politique de données à vérifier selon le plan de l'API Mistral (serveurs en Europe). Nous ne pouvons pas garantir l'absence d'entraînement.",
    speed: 'balanced',
  },
  {
    id: 'openrouter-auto',
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct',
    label: 'Llama 3.3 70B (OpenRouter)',
    free: false,
    trainsOnData: 'unknown',
    dataPolicy: "OpenRouter transmet votre question à un fournisseur tiers dont la politique varie. Nous ne pouvons pas garantir l'absence d'entraînement.",
    speed: 'balanced',
  },
];
