# Routes utilisateur de l'API sans écran mobile

Méthode : 823 routes du registre (`apps/api/src/openapi/registry.ts`) comparées aux chemins appelés par le mobile (littéraux `/...` de `apps/mobile/src/**`, gabarits `${…}` en jokers). 71 routes non retrouvées au premier passage ; après exclusion de `/admin`, `/internal`, webhooks, OAuth machine, API mini-app serveur : 49 candidates, dont une vérification à la main a écarté 27 faux positifs (chemins construits par `base(scope)`, `/${action}`, etc. : services/offres, classes d'école, publish/unpublish, visites/offres, devis, split-bills).

## Reliées dans ce lot
| Route | Fonction | Écran | Accès |
|---|---|---|---|
| GET /blocks, DELETE /blocks/{userId} | `fetchBlocks`, `setBlocked` | `/blocked` (nouveau) | Menu ⋯ > Réglages > Personnes bloquées ; Confidentialité > Voir les personnes bloquées |
| PUT /blocks/{userId} | `setBlocked` | Bouton « Bloquer » (+ « Signaler ») sur le profil d'une personne | Profil, 1 toucher |
| GET /me/security-events | `fetchSecurityEvents` | Section « Activité de sécurité récente » de `/sessions` | Menu ⋯ > Sécurité > Sessions |
| DELETE /reviews/{reviewId} | `deleteReview` | « Supprimer mon avis » sur ses propres avis (fiche produit > Avis) | 2 touchers |

## Restantes (écran ou intégration à faire)
| Route | Écran existant ? | Action / estimation |
|---|---|---|
| PATCH /reviews/{reviewId} | non (création seule : `/review/new`) | Réutiliser `/review/new` en mode édition, 0,5 j |
| GET /me/stories/archive, GET /users/{userId}/stories | non | Écran « Archive de mes stories » (liste + ré-ouverture), 0,5 j ; dans l'espace stories (hors périmètre de cet agent ?) |
| GET /hashtags/suggest | non | Suggestions de tags dans `compose.tsx` (champ + puces), 0,5 j |
| GET /payment-methods | non | Aujourd'hui une seule méthode (paiement à la livraison) : afficher dans `checkout.tsx` quand un partenaire sera choisi, 0,25 j |
| POST /orgs/{orgId}/ai/product-description | non | Bouton « Générer la description » dans le formulaire produit vendeur, 0,5 j |
| PUT /me/job-profile/cv | oui partiel (`/jobs/cv`) | Vérifier l'envoi du fichier CV, 0,25 j |
| PUT /courses/{id}/lessons/{lessonId}/files | non | Pièces jointes de leçon dans l'éditeur de cours, 1 j |
| DELETE /orgs/{orgId}/school/guardians/{id}, DELETE /me/school/guardians/{id} | oui (`/school/children`, `seller/.../school/guardians`) | Bouton « Retirer le lien », 0,25 j |
| GET /orgs/{orgId}/deliveries, POST …/deliveries/{id}/status | partiel (courses livreur) | Vue d'organisation des livraisons, 1 j |
| GET /visits/{id}, GET /offers/{id}, GET /wallet/split-bills/{id} | listes seulement | Détails sans valeur ajoutée, 0,25 j chacun (faible priorité) |
| POST /lives/{id}/signal | non | Signalisation WebRTC du direct : gros (module vidéo natif), > 5 j |
| POST /media/uploads/{id}/token, PUT …/content, GET /media/{id}/content | oui (`media/upload.ts`, `AuthImage`) | Appelées via d'autres gabarits ; aucune action |

## Accessibilité (≤ 3 touchers depuis l'accueil)
Contrôle automatique de tous les écrans `src/app/(app)` hors admin : chaque écran est référencé par au moins un lien (menu ⋯, Plus, lien contextuel ou tableau de bord vendeur/prestataire en chemins relatifs `go('/…')`). Aucun écran orphelin. Liens contextuels déjà présents : commande → retour/réclamation, produit → boutique, portefeuille → reçus/limites, course → partage/contacts de confiance, profil → message/pourboire. Ajoutés : profil → bloquer/signaler, Confidentialité → personnes bloquées.
