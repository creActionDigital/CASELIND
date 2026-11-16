const fr = {
  tagline: 'Discutez, achetez, payez, tout au même endroit.',
  intro: 'CASELIND réunit messagerie, boutiques, services, portefeuille et bien plus dans une seule application.',
  slugLabel: 'Adresse de l’entreprise (ex. chez-awa)',
  open: 'Ouvrir',
  loading: 'Chargement…',
  notFound: 'Page introuvable.',
  shopMissing: 'Cette entreprise est introuvable ou n’est pas publique.',
  error: 'Impossible de charger la page. Vérifiez votre connexion.',
  verified: 'Vérifiée',
  hours: 'Horaires',
  closed: 'Fermé',
  contact: 'Contact',
  website: 'Site web',
  days: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
  getApp: 'Pour discuter avec cette entreprise ou commander, ouvrez l’application CASELIND.',
};
const en: typeof fr = {
  tagline: 'Chat, shop, pay, all in one place.',
  intro: 'CASELIND brings messaging, shops, services, a wallet and much more into a single app.',
  slugLabel: 'Business address (e.g. chez-awa)',
  open: 'Open',
  loading: 'Loading…',
  notFound: 'Page not found.',
  shopMissing: 'This business was not found or is not public.',
  error: 'The page could not be loaded. Check your connection.',
  verified: 'Verified',
  hours: 'Opening hours',
  closed: 'Closed',
  contact: 'Contact',
  website: 'Website',
  days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  getApp: 'To chat with this business or order, open the CASELIND app.',
};
export type Lang = 'fr' | 'en';
export const messages = { fr, en };
export type Messages = typeof fr;
export const initialLang = (): Lang => {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    // storage can be blocked: fall back to the browser language
  }
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
};
