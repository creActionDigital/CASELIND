/** Données d'un écran live. La source (démonstration locale aujourd'hui, API plus tard) est séparée de l'affichage. */
export interface LiveHost {
  name: string;
  verified: boolean;
  followers: number;
}
export interface LiveProduct {
  id: string;
  title: string;
  priceMinor: number;
  currency: string;
  /** Mise en avant (« populaire »). */
  hot?: boolean;
  /** Couleur unie de la vignette tant qu'aucune image n'est fournie. */
  tint: string;
}
export interface LiveComment {
  id: string;
  user: string;
  text: string;
  replyTo?: string;
}
export interface LiveSession {
  host: LiveHost;
  viewers: number;
  products: LiveProduct[];
  comments: LiveComment[];
}
