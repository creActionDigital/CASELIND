import type { LiveSession } from './types';

/** Données de démonstration, purement locales : aucun réseau, aucune personne ni marque réelle. */
export const DEMO_LIVE: LiveSession = {
  host: { name: 'Boutique Démo', verified: true, followers: 12_400 },
  viewers: 545,
  products: [
    { id: 'd1', title: 'T-shirt coton', priceMinor: 1500, currency: 'USD', hot: true, tint: '#D9CBB6' },
    { id: 'd2', title: 'Baskets blanches', priceMinor: 4200, currency: 'USD', tint: '#E4E4EA' },
    { id: 'd3', title: 'Pantalon cargo', priceMinor: 3000, currency: 'USD', tint: '#7C8460' },
    { id: 'd4', title: 'Veste en jean', priceMinor: 25_000_00, currency: 'CDF', tint: '#7E9CC4' },
  ],
  comments: [
    { id: 'c1', user: 'amina_k', text: 'Bonjour depuis Kinshasa !' },
    { id: 'c2', user: 'patrick99', text: 'Quelle taille pour le t-shirt ?' },
    { id: 'c3', user: 'grace_m', text: 'Super, je prends !', replyTo: 'patrick99' },
  ],
};
