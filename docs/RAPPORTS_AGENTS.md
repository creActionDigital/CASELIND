# Rapports des agents (série du 2026-11-19/20) : à lire par toute conversation qui reprend le projet

Les rapports des sous-agents ne sont reçus que par la conversation qui les a lancés. Ce fichier en garde l'essentiel pour qu'une autre conversation puisse reprendre. **Rien de ce qui suit n'est commité** sauf mention contraire : `git status` donne l'état réel. Tests : chaque agent a lancé ses tests ciblés (un fichier à la fois) ; la suite complète n'a PAS été relancée sur l'ensemble.

## Lots livrés et rapportés verts par leur agent
| Lot (migrations) | Où se trouve le code | Reste / limites déclarées |
|---|---|---|
| Console d'administration | `apps/mobile/src/admin/console-*`, `app/(app)/admin/*` (hub + 10 écrans) | pas de pagination des questions de jeu et des modèles IA ; pas de filtre d'audit par acteur ; le rôle support n'a aucune route admin |
| Analytique + double validation (0073-74) | `apps/api/src/admin/{analytics,approvals}*`, `apps/mobile/src/admin-ops/` | au moins 2 administrateurs actifs en production ; `ADMIN_DUAL_APPROVAL` vrai par défaut en production |
| RGPD à l'écran, consentements (0075) | `apps/api/src/consents/`, `apps/mobile/src/privacy/`, `app/(app)/{my-data,consents}.tsx` | les consentements position/analytique ne sont lus par aucun module ; l'annulation de suppression se fait en se reconnectant |
| Observabilité et qualité | `apps/api/src/observability/`, `scripts/{load,smoke}/`, `docs/{QUALITY,LOAD_TESTING}.md`, `.github/workflows/ci.yml` | ESLint non installé (pas de lint) ; `/metrics` à interdire côté Caddy ; Docker jamais exécuté |
| Retours, remboursements, litiges (0071-72) | `apps/api/src/orders/order-returns*`, `apps/mobile/src/returns/`, `seller/[orgId]/returns.tsx`, `admin/disputes.tsx` | pas de bouton « Retours » sur le détail vendeur ; textes Kiswahili absents |
| Promotions, souhaits (0076-77) | `apps/api/src/{promotions,wishlist}/`, `apps/mobile/src/promotions/`, `wishlist.tsx`, `seller/[orgId]/promotions.tsx` | **plafond de promotion épuisable en commandant puis annulant** (constat sécurité n°2, ouvert) ; `fixed_price` avec devises mixtes |
| Livraison express, coursier (0078-79) | `apps/api/src/courier/`, `apps/mobile/src/courier/`, `app/(app)/courier/*` | le coursier est un chauffeur de mobilité approuvé ; constats ouverts : lecture d'adresses après annulation, verrou du code de remise |
| IA : traduction, actions, recherche naturelle, mentions (0080-81) | `apps/api/src/ai/`, `apps/api/src/search/natural-*`, `apps/mobile/src/ai/` | quota partagé avec le chat ; « près de moi » non appliqué ; traduction d'un message d'un tiers sans son consentement (choix produit) |
| Achats, dépenses, marges (0082-83) | `apps/api/src/business/`, `apps/mobile/src/business/` | pas de modification d'un bon brouillon à l'écran |
| RH, lots, inventaire (0084-85) | `apps/api/src/{hr,inventory-ops}/`, `apps/mobile/src/business/{hr,inventory}/` | aucun calcul de paie légal (volontaire) ; motif de congé maladie lisible du manager (constat n°15) |
| Outils créateurs, mode test (0086-87) | `apps/api/src/creator/`, `apps/mobile/src/creator/` | pas d'annulation de boost par l'auteur ; plafond quotidien de pourboires non atomique (n°8) |
| Plateforme développeurs phase 1 (0088-89) | `apps/api/src/miniapps/miniapp-dev*,usage*`, `packages/sdk/`, `docs/DEVELOPERS.md` | quotas en mémoire par instance ; `packages/sdk` absent du lockfile (à régénérer) |
| Produits numériques (0094) | `apps/api/src/digital/`, `apps/mobile/src/digital/`, `downloads.tsx`, `seller/[orgId]/product-files.tsx` | envoi de PDF depuis le mobile bloqué (paquet) ; tuile vendeur « fichiers numériques » à brancher ; une commande numérique passe par le retrait |
| Comparaison de produits | `apps/mobile/src/shop/compare-*`, `product/compare.tsx` | mobile seulement |

## Agents encore en cours au moment de l'écriture (leurs rapports arrivent dans l'ANCIENNE conversation)
- Finance du wallet en mode test (0090-91) : `apps/api/src/ledger`, `apps/mobile/src/wallet/finance/`.
- Mobilité 2 : covoiturage, location, dépannage (0092-93) : chemins mobiles prévus `/carpool`, `/rentals`, `/roadside`, `seller/[orgId]/rentals`.
- Mini-apps phase 2 (0095-96) : manifeste déclaratif, écran de consentement natif, événements sortants, notifications d'app, relevé de revenus, certification, écrans admin, SDK étendu, gabarit `templates/miniapp-starter`.
- Relecture de correction (lecture seule) des lots 0071-0087.
**Pour savoir où ils en sont** : `git status`, `ls apps/api/migrations | tail`, et les fichiers cités. Leurs transcriptions complètes sont dans `C:\Users\HP\AppData\Local\Temp\claude\E--CASELIND\6c218120-2890-4fcd-adf6-8e0d7a8dcb7b\tasks\*.output` (très volumineuses : ne pas les lire en entier, chercher la dernière section).

## Corrections de sécurité déjà appliquées avec test (non commitées)
Drapeaux réglementés (changement de portée = double validation), approbation refusée si l'auteur n'est plus admin actif, rejet d'un boost terminé refusé, prix démesuré de la recherche naturelle borné, identifiant de requête client ≥ 8 caractères.

## Constats de sécurité encore OUVERTS (relecture lots 0071-0087)
Promotion épuisable par annulation (n°2) ; coursier relit les adresses après annulation (n°3) ; traduction d'un tiers (n°5, choix produit) ; `payInternal` pourboires : plafond quotidien non verrouillé (n°8) ; promotion `fixed_price` multi-devises (n°10) ; garde de double validation désactivable silencieusement en production (n°11 : ajouter un avertissement au démarrage) ; journal des consentements : DELETE/TRUNCATE non bloqués et course dans `appendConsent` (n°13-14) ; motif de congé maladie (n°15) ; code de remise du coursier se débloque seul (n°16) ; retry concurrent d'un boost (n°6).

## À brancher dans les menus (chemins et clés de texte)
Fait : retours, promotions, achats, dépenses, rentabilité, RH, lots, inventaire (tableau vendeur) ; souhaits, coursier, mon travail, créateur, favoris, téléchargements (menu Plus). **À faire** : wallet finance (`/wallet/requests`, `/wallet/split`, `/wallet/scheduled`, `/wallet/savings`, `/wallet/alerts`), mobilité 2, espace développeur déjà lié depuis `miniapps/index.tsx`, fichiers numériques d'un produit (lien depuis l'écran produit vendeur vers `seller/[orgId]/product-files?productId=`).

## Relecture de correction (lots 0071-0087) : constats et état
**Corrigés (code écrit, tests à relancer)** : webhook `order.return_requested` non souscriptible (migration 0097), recomptage d'inventaire qui retranchait deux fois une vente (la ligne relit le stock du moment ; test adapté), interblocage des impressions (ordre fixe), index manquants (0097), devise d'un bon d'achat refusée dès le brouillon (**le test « devises incompatibles » de `purchasing.e2e` peut devoir être adapté**), plafond de courses actives du coursier (verrou).
**Restent à faire** : analytique « actifs par jour » fausse au-delà de 7 jours (jetons purgés à 7 jours) ; export de compte : journal des consentements tronqué à 200 lignes, favoris de publications absents ; rentabilité : retours remboursés non déduits ; suites post-commit qui peuvent renvoyer 500 (`ai.service` actions, notifications de retours, RH : entourer de `bestEffort`) ; plafond quotidien de pourboires non sérialisé ; fournisseur supprimé pendant la création d'un bon (FOR SHARE) ; alertes de péremption, congés : « aujourd'hui » en UTC au lieu du fuseau de la boutique ; recherche naturelle : prix filtré sur le prix de base, pas promotionnel ; journal d'actions IA sans rétention ; `approvals.list` écrit à la lecture.

## Etat au 2026-11-20 (limite d'usage atteinte, reprise a faire)
- Termines (rapports lus) : mobilite 2 (0092-0093), relecture UI (16 defauts), menus Plus et tableau vendeur branches (covoiturage, location, depannage).
- Interrompus par la limite puis relances, resultats NON lus : administration complete (0098-0099 : module PlatformOps, controleurs, registre OpenAPI, export des sanctions dans account.service, describeApproval mobile pour sanction.issue et setting.sensitive, ecrans admin, mes sanctions), mini-apps phase 2 (0095-0096 : cles mp.* absentes, ManifestSummary 11 erreurs tsc), correctifs des relectures (0100), kiswahili des nouvelles cles (+ scripts/i18n-coverage.mjs), documentation d'architecture (docs/MODULES.md etc.), correctifs d'ecrans (16 defauts, hors admin).
- Fait par moi : actions d'audit, variables ANTISPAM_*, types Row (platform-ops), package-lock avec packages/sdk (npm ci --dry-run OK).
- A faire a la reprise : tsc api + mobile propres, suites completes (une a la fois), commits nommes par lot, relecture securite des lots 0088+, puis demander la permission avant tout push.
