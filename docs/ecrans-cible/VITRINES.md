# 25 écrans vitrines (demande du propriétaire, 2026-11-21)

Niveau visé : irréprochable. Animations fluides, hiérarchie visuelle forte, composants premium, zéro friction.
Références visuelles : `docs/ecrans-cible/references/1.jpg` à `17.jpg` (super-app d'accueil, jeux/récompenses, wallet, voyages/billets, communauté et chat, Premium, notifications, support/chatbot, hôtel, QR, Uber, TikTok, tournois).
On reprend leur **mise en page, hiérarchie, densité et micro-interactions**, PAS leurs couleurs : charte CASELIND = bleu #0F70B7, orange #ED6B1B, neutres existants, **aucun dégradé**, Poppins, clair et sombre, 375 px et bureau, fr/en/sw.

Boîte à outils déjà installée : react-native-reanimated 4, react-native-gesture-handler, expo-blur, composants `src/ui` et jetons `src/theme/tokens.ts`. Règles d'animation : 150-300 ms, ressorts doux, rien qui bloque l'action, respect de « réduire les animations » (AccessibilityInfo.isReduceMotionEnabled), squelettes de chargement plutôt que roues.

## Les 10 prioritaires
| # | Écran | Route actuelle | Références | Direction |
|---|---|---|---|---|
| 1 | Accueil principal | (tabs)/index | 1, 5 | Salutation, recherche, raccourcis services en grille (Scanner/payer, Envoyer, Course, Livraison, Mini-apps...), stories, bannières promo, rangées Marketplace et publications ; donne envie d'explorer. |
| 2 | Marketplace | shop | 1 | Catégories en pastilles illustrées, flash deals à compte à rebours, cartes produit premium (cœur, note, prix promo), sections recommandées. |
| 3 | Maps | (tabs)/maps | 10, 15 | Carte plein écran, feuille glissante (lieux proches, catégories), raccourcis transport/livraison. |
| 4 | Wallet | wallet | 3, 9 | Solde en grand (masquable), 4 actions rondes (Ajouter, Envoyer, Recevoir, Plus), dernières opérations, objectifs d'épargne, bandeau « Mode test » discret mais visible. |
| 5 | Messagerie | (tabs)/messages, messages/[id] | 5 | Liste aérée, filtres en pastilles, bulles soignées, barre de saisie avec pièce jointe/emoji, états d'envoi. |
| 6 | Vidéos et découverte | hub | 16 | Plein écran vertical, gestes, colonne d'actions à droite, auteur + légende + son en bas, Pour vous / Abonnements. |
| 7 | Réservation de transport | rides | 10, 15 | « Où allez-vous ? », lieux enregistrés, suggestions (Course, Moto, Location, Covoiturage, Dépannage), choix du véhicule en cartes avec prix et ETA, bouton d'action fixe. |
| 8 | Assistant IA | ai, ai/[id] | 13 | Accueil avec agents spécialisés en cartes, questions suggérées, conversation fluide, pièces jointes, état « réfléchit ». |
| 9 | Jeux et défis | games | 2, 17 | Catalogue visuel, défis et missions avec progression, classements. **Sans CSL Coins** (exclus) : récompenses non monétaires (badges, niveaux). |
| 10 | Trading | — | — | **Exclu par décision du propriétaire** (à confirmer s'il change d'avis). |

## Les 15 suivants
| # | Écran | Route | Direction |
|---|---|---|---|
| 11 | Splash / Onboarding | _layout, (auth) | Logo animé (apparition + léger rebond), onboarding 3 pages à pagination fluide. |
| 12 | Connexion / Inscription | (auth)/* | Minimaliste, rassurant, logo vertical, champs généreux, boutons sociaux grisés « bientôt ». |
| 13 | Profil utilisateur | profile, user/[userId] | Couverture, avatar, compteurs, boutons, grille de publications, onglets. |
| 14 | Stories | story/* | Plein écran, barres de progression, appui pour mettre en pause, glisser pour fermer. |
| 15 | Création (+) | CreateSheet, compose | Feuille animée, tuiles claires, éditeur multimédia avec aperçu. |
| 16 | Détail produit | product/[productId] | Galerie plein largeur à pagination, prix fort, variantes en pastilles, achat rapide fixe en bas. |
| 17 | Panier / Checkout | cart, checkout | Étapes claires, récapitulatif collant, validation sans friction. |
| 18 | Boutique vendeur | store/[slug] | Bannière, logo, note, abonnement, onglets produits/avis/infos. |
| 19 | Tableau de bord vendeur | seller/[orgId] | Cartes chiffres clés, graphiques simples (ventes 7/30 j), tâches à faire. |
| 20 | Centre Mini Apps | miniapps | Catalogue par catégories, icônes, récentes/favorites. |
| 21 | Découverte des services | services, more | Exploration visuelle par catégories. |
| 22 | Réservation hôtel / restaurant | (fiches lieu) + bookings | Galerie, équipements, dates/invités en compteurs, réservation (réf. 11). |
| 23 | Notifications | notifications | Groupées Aujourd'hui / Hier / Cette semaine, icônes par type, non lues marquées, « tout lire » (réf. 7). |
| 24 | Profil professionnel | seller/[orgId]/vitrine, store | Présentation d'entreprise complète. |
| 25 | Plus / Centre de services | (tabs)/more | Portail de l'écosystème en sections et tuiles. |

Contrôle : chaque écran vitrine est vérifié dans le navigateur (clair et sombre, 375 et 1280), avec capture dans qa-out/vitrines/.
