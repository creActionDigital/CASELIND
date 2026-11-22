# Routes utilisateur de l'API sans écran mobile

Méthode : 823 routes du registre (`apps/api/src/openapi/registry.ts`) comparées aux chemins appelés par le mobile (littéraux `/...` de `apps/mobile/src/**`, gabarits `${…}` en jokers). 71 routes non retrouvées au premier passage ; après exclusion de `/admin`, `/internal`, webhooks, OAuth machine, API mini-app serveur : 49 candidates, dont une vérification à la main a écarté 27 faux positifs (chemins construits par `base(scope)`, `/${action}`, etc. : services/offres, classes d'école, publish/unpublish, visites/offres, devis, split-bills).

## Reliées
| Route | Fonction | Écran | Accès |
|---|---|---|---|
| GET /blocks, DELETE /blocks/{userId} | `fetchBlocks`, `setBlocked` | `/blocked` | Menu ⋯ > Réglages > Personnes bloquées ; Confidentialité > Voir les personnes bloquées |
| PUT /blocks/{userId} | `setBlocked` | Bouton « Bloquer » (+ « Signaler ») sur le profil d'une personne | Profil, 1 toucher |
| GET /me/security-events | `fetchSecurityEvents` | Section « Activité de sécurité récente » de `/sessions` | Menu ⋯ > Sécurité > Sessions |
| DELETE /reviews/{reviewId} | `deleteReview` | « Supprimer mon avis » sur ses propres avis (fiche produit > Avis) | 2 touchers |
| PATCH /reviews/{reviewId} | `updateReview` | `/review/new` en mode édition | (chemin d'accès non revérifié) |
| GET /me/stories/archive, GET /users/{userId}/stories | `fetchStoryArchive`, `fetchUserStories` | `/stories-archive`, `/story/[userId]` | (chemin d'accès non revérifié) |
| GET /hashtags/suggest | `fetchHashtagSuggestions` | `compose.tsx` | (chemin d'accès non revérifié) |
| GET /payment-methods | `fetchPaymentMethods` | `checkout.tsx` | (chemin d'accès non revérifié) |
| POST /orgs/{orgId}/ai/product-description | `draftDescription` | Fiche produit vendeur | (chemin d'accès non revérifié) |
| PUT /me/job-profile/cv | `setCvFile` | `/jobs/cv` | (chemin d'accès non revérifié) |
| PUT /courses/{id}/lessons/{lessonId}/files | `setLessonFiles` | `education/edit/[id]` | (chemin d'accès non revérifié) |
| DELETE /orgs/{orgId}/school/guardians/{id}, DELETE /me/school/guardians/{id} | `removeGuardian`, `endMyParentLink` | `seller/[orgId]/school/guardians`, `/school` | (chemin d'accès non revérifié) |
| GET /orgs/{orgId}/deliveries, POST …/deliveries/{id}/status | — | `seller/[orgId]/deliveries` | Tableau de bord vendeur |

Contrôle fait le 22/11/2026 : chaque fonction est appelée par un écran (recherche dans le code). Chargement des écrans `/maps`, `/blocked`, `/stories-archive`, `/sessions`, `/jobs/cv`, `/compose`, `/school` vérifié au navigateur en clair et en sombre, sans erreur. Les actions elles-mêmes (envoi du CV, pièces jointes de leçon, livraisons d'organisation, etc.) n'ont pas été rejouées une à une.

## Restantes
| Route | Raison |
|---|---|
| GET /visits/{id}, GET /offers/{id}, GET /wallet/split-bills/{id} | Listes seulement ; détails sans valeur ajoutée (0,25 j chacun, faible priorité) |
| POST /lives/{id}/signal | Signalisation WebRTC du direct : gros chantier, > 5 j (le module d'appel 1:1 `calllive/useRtcCall` peut servir de base) |
| POST /media/uploads/{id}/token, PUT …/content, GET /media/{id}/content | Appelées via d'autres gabarits ; aucune action |

## Accessibilité (≤ 3 touchers depuis l'accueil)
Contrôle automatique de tous les écrans `src/app/(app)` hors admin : chaque écran est référencé par au moins un lien (menu ⋯, Plus, lien contextuel ou tableau de bord vendeur/prestataire en chemins relatifs `go('/…')`). Aucun écran orphelin. Liens contextuels déjà présents : commande → retour/réclamation, produit → boutique, portefeuille → reçus/limites, course → partage/contacts de confiance, profil → message/pourboire, profil → bloquer/signaler, Confidentialité → personnes bloquées.
