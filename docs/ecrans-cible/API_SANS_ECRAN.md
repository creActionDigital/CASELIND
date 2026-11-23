# Routes utilisateur de l'API sans écran mobile

Méthode : 823 routes du registre (`apps/api/src/openapi/registry.ts`) comparées aux chemins appelés par le mobile (littéraux `/...` de `apps/mobile/src/**`, gabarits `${…}` en jokers). 71 routes non retrouvées au premier passage ; après exclusion de `/admin`, `/internal`, webhooks, OAuth machine, API mini-app serveur : 49 candidates, dont une vérification à la main a écarté 27 faux positifs (chemins construits par `base(scope)`, `/${action}`, etc. : services/offres, classes d'école, publish/unpublish, visites/offres, devis, split-bills).

## Reliées
| Route | Fonction | Écran | Accès |
|---|---|---|---|
| GET /blocks, DELETE /blocks/{userId} | `fetchBlocks`, `setBlocked` | `/blocked` | Menu ⋯ > Réglages > Personnes bloquées ; Confidentialité > Voir les personnes bloquées |
| PUT /blocks/{userId} | `setBlocked` | Bouton « Bloquer » (+ « Signaler ») sur le profil d'une personne | Profil, 1 toucher |
| GET /me/security-events | `fetchSecurityEvents` | Section « Activité de sécurité récente » de `/sessions` | Menu ⋯ > Sécurité > Sessions |
| DELETE /reviews/{reviewId} | `deleteReview` | « Supprimer mon avis » sur ses propres avis (fiche produit > Avis) | 2 touchers |
| PATCH /reviews/{reviewId} | `updateReview` | `/review/new` en mode édition | Fiche produit > Avis > Modifier (`product/[productId]`) |
| GET /me/stories/archive, GET /users/{userId}/stories | `fetchStoryArchive`, `fetchUserStories` | `/stories-archive`, `/story/[userId]` | Menu ⋯ (lien de `menu-logic`) |
| GET /hashtags/suggest | `fetchHashtagSuggestions` | `compose.tsx` | Nouvelle publication (Vidéos ou feuille de publication) |
| GET /payment-methods | `fetchPaymentMethods` | `checkout.tsx` | Panier ou fiche produit > Paiement |
| POST /orgs/{orgId}/ai/product-description | `draftDescription` | Fiche produit vendeur | Tableau de bord vendeur > Produits > fiche (`seller/[orgId]/products/[productId]`) |
| PUT /me/job-profile/cv | `setCvFile` | `/jobs/cv` | Emploi (liste ou fiche d'offre) > Mon CV |
| PUT /courses/{id}/lessons/{lessonId}/files | `setLessonFiles` | `education/edit/[id]` | Éducation > cours > modifier |
| DELETE /orgs/{orgId}/school/guardians/{id}, DELETE /me/school/guardians/{id} | `removeGuardian`, `endMyParentLink` | `seller/[orgId]/school/guardians`, `/school` | Parents : École > enfants > « Arrêter le suivi » ; école : tableau de bord vendeur > parents |
| GET /orgs/{orgId}/deliveries, POST …/deliveries/{id}/status | — | `seller/[orgId]/deliveries` | Tableau de bord vendeur |

Contrôle fait le 22/11/2026 : chaque fonction est appelée par un écran et chaque écran est atteint par un lien (recherche dans le code). Chargement au navigateur, en clair et en sombre et sans erreur : `/maps`, `/blocked`, `/stories-archive`, `/sessions`, `/jobs/cv`, `/compose`, `/school`, tableau de bord vendeur, livraisons et produits d'une boutique, menu Plus. Les actions elles-mêmes (envoi du CV, pièces jointes de leçon, retrait d'un lien parent) n'ont pas été rejouées une à une.

## Restantes
Aucune route utilisateur restante. Faux positifs de l'audit : `GET /visits/{id}`, `GET /offers/{id}` et `GET /wallet/split-bills/{id}` sont déjà appelées par leurs écrans (`listings/visits`, `listings/offers`, `wallet/split`). `POST /lives/{id}/signal` est reliée par `calllive/useRtcLive` (direct vidéo, maillage de 8 spectateurs au plus ; au-delà il faut un serveur média). Les routes `/media/uploads/...` passent par d'autres gabarits.

## Deuxième passage (23/11/2026) : routes du registre complet
Méthode : 824 routes comparées segment par segment aux chemins appelés par le mobile (les `/${action}` comptent comme jokers). 59 non retrouvées ; après vérification à la main, restaient réellement sans écran :

| Route | Écran | Accès |
|---|---|---|
| POST /admin/ads/settle | Bouton « Clôturer les campagnes terminées » (`admin/ads`) | Administration > Publicités |
| POST /admin/subscriptions/renew-due | Bouton « Renouveler les abonnements échus » (`admin/subscriptions`) | Administration > Abonnements |
| GET /admin/ledger/accounts/{id}, POST …/freeze, …/unfreeze | « Consulter un compte » (`admin/ledger`), gel et dégel avec confirmation ; 202 si double validation | Administration > Registre |
| POST /admin/games/tournaments | Formulaire « Ouvrir un tournoi » (`admin/games`) | Administration > Jeux |
| GET /admin/kyc/submissions/{id} | Appelée à l'ouverture des justificatifs (`admin/kyc`) : lecture tracée côté serveur | Administration > KYC |
| GET /rides/shared/{token} | `rides/shared/[token]` : trajet partagé en lecture seule ; le message de partage envoie un lien de l'application | Lien reçu d'un proche |

Hors périmètre mobile, volontairement : `/auth/qr/session` (créée par le web, approuvée par le mobile), `/media/uploads/{id}/token|content` (appelées avec le jeton reçu de l'annonce), `/miniapp-api/*` et `/oauth/token` (API machine des mini-apps), `/health/*`, `/openapi.json`, `/config/public`.
## Accessibilité (≤ 3 touchers depuis l'accueil)
Contrôle automatique de tous les écrans `src/app/(app)` hors admin : chaque écran est référencé par au moins un lien (menu ⋯, Plus, lien contextuel ou tableau de bord vendeur/prestataire en chemins relatifs `go('/…')`). Aucun écran orphelin. Liens contextuels déjà présents : commande → retour/réclamation, produit → boutique, portefeuille → reçus/limites, course → partage/contacts de confiance, profil → message/pourboire, profil → bloquer/signaler, Confidentialité → personnes bloquées.
