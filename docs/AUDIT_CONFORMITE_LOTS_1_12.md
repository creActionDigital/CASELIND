# Audit de conformité au cahier des charges, lots 1 à 12

Date : 2026-11-16. Audit en lecture seule (aucune suite de tests lancée, aucun serveur démarré). Méthode : lecture du cahier (§1 à §39), de `docs/PROGRESS.md`, `docs/BACKLOG.md`, `docs/architecture/DECISIONS.md`, puis vérification par lecture et recherche dans `apps/api/src`, `apps/api/migrations`, `apps/api/test`, `apps/mobile/src`. Les tests n'ont pas été exécutés : « testé » signifie ici « un test e2e existe et couvre le point d'après son titre et le code lu ». Les nombres de tests annoncés dans PROGRESS sont **non vérifiés**.

Statuts : CONFORME (codé et testé) · PARTIEL · ABSENT · DIFFÉRÉ (consigné avec raison) · HORS PÉRIMÈTRE (décision du propriétaire : trading, paris, CSL Coins, lot 19).
Les chemins sont relatifs à `apps/api/` sauf mention. « e2e » = `test/<nom>.e2e.test.ts`.

## 1. Règles non négociables §34 et transversales

| Règle | Statut | Preuve | Remarque |
|---|---|---|---|
| Permissions côté serveur, pas seulement UI (§4) | CONFORME | `src/app.module.ts:531-534` (gardes globales : throttler, `AuthGuard`, `FlagGuard`) ; `src/security/auth.guard.ts` (refus par défaut sauf `@Public`, rôles relus en base) ; `src/orgs/org.guard.ts`, `org-permissions.ts` ; e2e `orgs`, `users` (RBAC admin 403 puis 200) | Les contrôles par ressource (propriétaire, membre de la conversation, etc.) sont dans les services : 23 contrôleurs n'ont pas de décorateur propre et reposent sur la garde globale. Couverture par ressource : vérifiée par échantillon seulement, pas exhaustivement |
| Données sensibles chiffrées | CONFORME (limité) | AES-256-GCM : `src/kyc/kyc-crypto.ts` (numéro de pièce), `src/auth/identity/totp-crypto.ts` (secret TOTP lié à l'utilisateur), `src/health/health-crypto.ts` ; clés exigées en production `src/config/env.ts:240` ; PIN et mots de passe : Argon2id ; e2e `kyc` « stores the number encrypted » | En dev, la clé TOTP dérive de `JWT_ACCESS_SECRET` (acceptable, refusé en production). Les adresses de livraison et les messages sont en clair en base (pas de chiffrement au repos applicatif, §29 « selon l'infrastructure ») |
| Rien de sensible dans les journaux | CONFORME | `src/common/log-scrub.ts` (en-têtes d'autorisation, requêtes `places`/`search`/`ai` expurgées) + `log-scrub.test.ts` ; filtre d'exceptions sans paramètres SQL `test/exception-filter.test.ts` ; ADR-022 (ni prompt ni réponse IA) ; OTP : code jamais journalisé (ADR-018) | Corps de requête jamais journalisés (pino) |
| Audit append-only | CONFORME | `migrations/0001_identity.sql` (trigger), `src/audit/audit.service.ts`, e2e `platform` « audit append-only » ; entrées ledger append-only e2e `ledger` « rejects UPDATE and DELETE » | |
| Idempotence des opérations d'argent | CONFORME | `src/ledger/ledger.service.ts` ; e2e `ledger` (« idempotent per clientId, same key another amount = 409 », 20 transferts concurrents), `payment-qr` (rejeu avec autre montant refusé, QR à usage unique sous concurrence), `miniapps` (demande idempotente sur `clientRef`) ; commandes : `clientId` e2e `orders` | |
| Partie double, rapprochement | CONFORME | `migrations/0013_ledger.sql` (somme nulle vérifiée au commit), `src/maintenance/maintenance.service.ts:120-147` (rapprochement horaire) ; e2e `ledger` « reconciles clean, then detects a tampered balance cache » | Rapprochement avec un partenaire : sans objet (pas de partenaire) |
| Aucun argent réel | CONFORME | flag `wallet.real_money` coupé et inutilisé (`migrations/0002_platform_controls.sql:27`, `0013_ledger.sql:2,113`) ; recharge de test coupée en production e2e `ledger` ; commandes : `cash_on_delivery` seulement (ADR-017) ; mobilité en espèces ; bandeau « Mode test » mobile | |
| Consentements | PARTIEL | Position livreur : `location_consent` (`migrations/0019_delivery.sql`, e2e `delivery`) ; chauffeur en ligne avec consentement (lot 11) ; IA : avertissement exigé avant un modèle qui entraîne sur les données (409 `data_notice_required`, e2e `ai`) ; mini-apps : aperçu de consentement par scopes (e2e `miniapps`) ; push sans contenu par défaut (ADR-015) ; découverte par téléphone/e-mail coupée par défaut (`src/privacy`) | Pas de registre de consentements générique (finalités, date, version). Traduction des messages (consentement exigé §6) : ABSENTE, donc rien à consentir |
| Signalement et masquage des contenus publics | CONFORME (avec trous) | `src/moderation/*` (file, `hide`/`restore`/`dismiss`, audit sans contenu), cibles `user, post, comment, story, message, product, review, service, service_review, ride` (`moderation-registry.ts:3`) ; e2e `moderation`, `social-stories`, `catalog` | Voir écart G2 : les organisations (vitrines) et les mini-apps ne sont pas des cibles de signalement ; la cible `user` n'a aucun effet (`social-moderation.ts:73` : « sanctioned through admin tooling », outil inexistant) |
| Export et suppression de compte | CONFORME | `src/account/account.service.ts:82-450` (export : profil, confidentialité, sessions, blocages, messages, publications, commandes, livraisons, KYC statuts, wallet, services, mobilité, IA, mini-apps, historique de recherche) ; `src/maintenance/maintenance.service.ts:240-410` (purge : anonymisation, messages, posts, KYC, PIN, TOTP, mobilité, IA, mini-apps, recherche, adresses de commande) ; ADR-012 ; e2e `account`, `ledger`, `kyc`, `bookings`, `mobility` (export + purge) | Non vérifiés : notifications (`notifications` titre/corps) et brouillons/messages programmés ne semblent ni exportés ni purgés ; le contenu de ces notifications est « sans données personnelles » d'après PROGRESS mais non contrôlé ici |
| Statut honnête des intégrations | CONFORME | OTP : `console` refusé en production (`env.test.ts`) ; Brevo/WhatsApp codés mais jamais appelés en réel (PROGRESS, `docs/OTP_SETUP.md`) ; IA testée avec `fetch` simulé et dit sans clé ; services « non vérifié » affiché ; mobilité « estimation » ; push Expo non réel | Les adaptateurs Brevo, WhatsApp, Gemini et Expo ne sont pas validés contre le service réel : présentés comme tels dans PROGRESS |
| Limitation de débit, validation, erreurs uniformes (§28-29) | CONFORME | `src/security/http-throttler.guard.ts`, `src/common/zod.pipe.ts`, `all-exceptions.filter.ts` ; e2e `platform` (429 sur `/auth`) ; OpenAPI exhaustif e2e `openapi` | Throttling en mémoire (ADR-010), à passer sur Redis en multi-instance (consigné) |
| Webhooks signés, versionnement d'API tierces (§24) | DIFFÉRÉ / ABSENT | aucune occurrence de « webhook » dans `src` | Aucun partenaire contracté (Q5) ; non consigné explicitement comme différé dans BACKLOG |
| Feature flags, fonctions réglementées coupées (§26, §34-11) | CONFORME | `src/flags/*`, ADR-013, e2e `flags`, `flag-guard` (verrou de ligne testé) ; `@RequireFlag` sur 30 contrôleurs | |
| Chiffrement de bout en bout annoncé ? | CONFORME (non annoncé) | Aucune mention E2E dans `apps/mobile/src` | Conforme à §29 : ne pas annoncer |

## 2. Lot 1 / 1b / 1c : identité et sécurité (§4)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Inscription et connexion téléphone / e-mail, OTP | CONFORME | `src/auth/*`, `auth/otp/*` ; e2e `auth` (21) | Envoi réel non exercé (Q2) |
| Fournisseurs sociaux (Google, Apple, Facebook) | ABSENT | aucun code ; non consigné au BACKLOG | « selon disponibilité » (§4) mais à consigner (règle §0 : rien n'est oublié) |
| OTP par WhatsApp | PARTIEL | `auth/otp/whatsapp-otp.sender.ts`, ADR-018 | Code livré, pas de compte Meta : jamais testé en réel |
| Récupération de compte, mot de passe oublié | CONFORME | e2e `auth` | Délai de `password/forgot` qui distingue un compte connu : consigné comme « à traiter » |
| Changement de téléphone / e-mail | CONFORME | `auth/identity/*`, e2e `identity-extras` ; ADR-020 | Sans second facteur : décision du propriétaire |
| Appareils, sessions, déconnexion à distance, rotation + détection de rejeu | CONFORME | `src/auth`, ADR-007 ; e2e `auth` (rejeu, révocation, test de mutation consigné) | |
| Journal de sécurité | CONFORME | `GET /me/security-events`, e2e `users` | |
| 2FA TOTP + codes de secours | CONFORME | `auth/identity/totp*.ts`, e2e `identity-extras` | Biométrie : ABSENTE côté mobile (aucune occurrence) ; non consignée |
| SSO interne / mini-apps reçoivent le minimum | CONFORME | lot 10, ADR-021, e2e `miniapps` | |
| Connexion web par QR | CONFORME | `qr-login.service.ts`, e2e `identity-extras` | |
| KYC par niveaux, revue humaine, configurable | CONFORME | `src/kyc/*`, `migrations/0014_kyc_qr.sql`, e2e `kyc` (16 points) | Pas d'auto-validation, vérifié par test |
| RBAC plateforme et organisation | CONFORME | `org-permissions.ts`, e2e `orgs`, `users` | Rôles métier `hr.manage` déclaré mais aucune fonction RH (hors lots 1-12) |
| Blocage | CONFORME | `src/privacy`, e2e `privacy` | |
| Signalement | CONFORME | voir §1 | |
| **Suspension / réactivation d'un compte** | **ABSENT** | aucune route admin ne modifie `users.status` (recherche `UPDATE users SET status` / `set({ status` : seulement la vérification d'inscription) ; `admin.controller.ts` n'expose que `GET audit-events` | Les e2e posent le statut directement en base. Écart G1 |
| Multi-profils / multi-boutiques | CONFORME | un compte, plusieurs organisations (`src/orgs`) | |
| Préférence de langue | PARTIEL | `users.locale` fr/en/sw (`migrations/0001_identity.sql:20`) | Mobile : fr/en seulement, langue non persistée (PROGRESS M1) ; swahili d'interface non vérifié |
| Confidentialité | CONFORME | e2e `privacy` | Réglages appliqués par messagerie et recherche (e2e `search`, `messaging`) |
| Feature flags par pays/rôle | CONFORME | e2e `flags` | Un flag lu en base à chaque requête (consigné) |
| OpenAPI | CONFORME | e2e `openapi` | |
| Nettoyage planifié | CONFORME | e2e `maintenance` | Planification elle-même non testée (consigné) |

## 3. Lots 2 et 2b : organisations, vitrines, médias (§5, §8, §29)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Organisations configurables, membres, rôles, invitations | CONFORME | `src/orgs/*`, e2e `orgs` (19) | Expiration/limite des invitations : DIFFÉRÉ (BACKLOG 2b) |
| Vitrine publique sans connexion, données privées protégées | CONFORME | `orgs.service.ts:224-232` (public ET actif), horaires `opening_hours` (migration 0005) | |
| Vitrine « mini-site » (galerie, Q&R, promos, sections, événements) | PARTIEL | logo, bannière, horaires, coordonnées, produits via lot 5 | Sections personnalisables, galerie, Q&R : non consignés au BACKLOG |
| SEO, sitemap, domaine personnalisé, sous-domaines | DIFFÉRÉ | BACKLOG Web (« SEO à faire »), réponse 9 (pas de domaine) ; aucune occurrence `sitemap`/`custom_domain` dans l'API | Sous-domaines et DNS non consignés individuellement |
| Badge « vérifié » d'organisation | **ABSENT (chemin d'attribution)** | retiré si le nom change (e2e `orgs`) mais aucune route admin ne le pose (recherche `verified` dans `orgs/`, `admin/`) | Écart G1. Le BACKLOG 2b mentionne « vérification des organisations par l'admin » : planifié, donc consigné |
| Suspension / suppression d'organisation | DIFFÉRÉ | BACKLOG 2b ; la suspension automatique d'une organisation orpheline existe (`maintenance.service.ts:318`) | `org.delete` déclaré dans les permissions sans route |
| Médias : type réel, quotas, nosniff, CSP | CONFORME | `src/media/*`, e2e `media` (19) | |
| EXIF, ré-encodage, Range/304, S3+CDN | DIFFÉRÉ | BACKLOG 2b, Q6 | |
| Gestion d'entreprise générique (stock, CRM, caisse, RH, rapports) | HORS lots 1-12 | tableau de bord vendeur (lot 5) seulement ; devis, factures, CRM : lot 16c | RH (§8) non couvert ni consigné |

## 4. Lots 3 et 3b : messagerie, notifications (§6, §24)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Conversations 1:1 et groupes, rôles, annonce | CONFORME | `src/messaging/*`, e2e `messaging` (25) | |
| Accusés envoyé/reçu/lu, non-lus, réactions, mentions, réponses, rappel | CONFORME | e2e `messaging`, `messaging-realtime` (2 clients Socket.IO) | |
| Pièces jointes, photos, vidéo | CONFORME | lecture limitée aux membres, e2e `messaging` | Compression : non vérifiée |
| Messages vocaux | ABSENT | aucun code mobile ni API dédié (PROGRESS 3b : « côté mobile ») | Consigné BACKLOG 3b/M1b |
| Transfert, favoris, brouillons, éphémères, programmés | CONFORME | `message-extras.service.ts`, `scheduled-messages.service.ts`, e2e `messaging-extras` (13) | |
| Partage de position dans un message | DIFFÉRÉ | BACKLOG 3b | |
| Présence en ligne | ABSENT | aucune occurrence « presence » | Non consigné explicitement ; « en train d'écrire » existe |
| Recherche dans les messages | ABSENT | la recherche universelle ne porte pas sur les messages (`src/search`) | Non consigné ; cohérent avec la vie privée mais à documenter |
| Appels audio/vidéo WebRTC, salons audio, live | DIFFÉRÉ | BACKLOG 3b (TURN/SFU, Q6), réponse 9 | Écran `live/preview` mobile = démonstration locale libellée « bientôt » (`apps/mobile/src/app/(app)/live/preview.tsx`) : honnête |
| Sondages, messages de groupe avancés | ABSENT | aucune occurrence | Non consigné |
| Traduction instantanée avec consentement | DIFFÉRÉ | BACKLOG 3b (« traduction (consentement) ») | |
| Conversation commerciale (contact vendeur depuis commande) | CONFORME | lot 5b, `org-contact.ts` | Devis/négociation dans le fil : lot 15d (hors audit) |
| Temps réel : authentification au handshake, coupure à la révocation | CONFORME | `src/realtime/*`, e2e `realtime` (20) | Suspension hors chemins connus : ≤ 60 s (consigné) |
| Notifications : centre, préférences par catégorie, mode silencieux, `security` non désactivable | CONFORME | `src/notifications/*`, e2e `notifications` (15) | Préférence « fréquence » et canal e-mail : non vérifiés |
| Push sans contenu par défaut | CONFORME | ADR-015, e2e `messaging-realtime` | Push réel jamais envoyé (Q8) |

## 5. Lots 4 et 4b : social, stories, modération (§6, §26)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Publications, 4 visibilités, fil, vidéos courtes, réactions, commentaires, abonnements | CONFORME | `src/social/*`, e2e `social` (20), `social-stories` | Flux vidéo chronologique, pas de classement (consigné 4b) |
| Les médias suivent la visibilité de la publication | CONFORME | correctif de revue consigné ; e2e `social` | |
| Stories 24 h, vues, archive | CONFORME | `src/stories/*`, e2e `stories` (14) | |
| Favoris, listes d'amis proches, salons, live, stickers, tableau de bord créateur | DIFFÉRÉ | BACKLOG 4b | |
| Publications sponsorisées, statistiques de portée, dons/pourboires, abonnements payants | ABSENT | aucune occurrence « sponsor » | Non consignés au BACKLOG (§6 « outils créateurs ») |
| Limite de débit des publications | DIFFÉRÉ | BACKLOG 4b | Risque de spam (G3) |
| File de modération, sanctions graduées, recours, détection de spam/bots (§26) | PARTIEL | file `hide/restore/dismiss`, audit (e2e `moderation` 12) | Pas de sanctions graduées, pas de recours, pas de suspension de compte (voir G1) ; non consignés |
| Signaleur notifié, un seul signalement ouvert par cible | CONFORME | e2e `moderation` | |

## 6. Lots 5 et 5b : commerce et catalogue (§7)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Catalogue, variantes, stock append-only jamais négatif, catégories, devises USD/CDF | CONFORME | `src/catalog/*`, `migrations/0011_catalog.sql`, e2e `catalog` (21) | |
| Panier multi-vendeurs, commandes scindées par (org, devise), idempotence `clientId`, réservation de stock | CONFORME | `src/cart`, `src/orders`, e2e `orders` (33), `commerce` (course sur le dernier article) | |
| Paiement en ligne | DIFFÉRÉ | ADR-017, Q5 | Paiement à la livraison seulement |
| Avis vérifiés (acheteurs livrés), réponse vendeur | CONFORME | `src/reviews`, e2e `reviews` | Faux avis : modération `review` seulement |
| Coupons | CONFORME | `coupons.service.ts` | Promotions et ventes flash : DIFFÉRÉ (5b, E-05) |
| Liste de souhaits / favoris produits | DIFFÉRÉ | BACKLOG 5b | |
| Retours, remboursement, litige sur commande | **ABSENT** | statuts de commande : `pending…delivered, cancelled` seulement (`migrations/0012_orders.sql:55`) ; aucun remboursement de commande | §7 « annulation, retour, remboursement, litige » ; **non consigné au BACKLOG** (seul « service client dans le chat » l'est). Écart G2. Le litige existe pour le freelance (hors lots 1-12) |
| Facture / reçu de commande | PARTIEL | `src/orders/documents.service.ts` (hors lots 1-12, lot 16c) ; reçu de paiement QR et de course | Non audité en profondeur |
| Comparaison de prix, recommandations, Q&R produit, enchères, produits numériques, annonces payantes | ABSENT / DIFFÉRÉ | recherche plein texte avancée et live shopping consignés (5b) ; le reste non consigné | |
| Outils vendeur : exports, indicateurs de performance, commissions | PARTIEL | tableau de bord vendeur ; analyse de ventes (lot 16c) ; pas d'export ni de commissions | Commissions : politique non définie (§36) |
| Modération des annonces, produits interdits | PARTIEL | cible `product` masquable ; pas de détection de produits interdits | |

## 7. Lot 6 : ledger, wallet sandbox, KYC, QR (§17)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Solde, historique, transferts P2P idempotents avec PIN | CONFORME | `src/ledger/*`, `src/wallet/*`, e2e `ledger` (15 points) | |
| Registre append-only, partie double, limites KYC, comptes gelés | CONFORME | `migrations/0013_ledger.sql`, e2e `ledger` | |
| Paiement marchand par QR signé (HMAC, usage unique, expiration, révocation) | CONFORME | `src/payments-qr/*`, e2e `payment-qr` (16 points) | QR commande/retrait/identité (§24) : QR de profil mobile seulement, non audité côté serveur |
| Wallet d'organisation | CONFORME | e2e `ledger` « finance.view members only » | |
| Demandes d'argent, paiements partagés, paiements programmés, abonnements | ABSENT | aucune occurrence | Non consignés (finance personnelle lot 13 hors audit) |
| Dépôts / retraits via partenaires | DIFFÉRÉ | Q5 (FlexPay), recharge de test seulement | |
| Remboursement d'un paiement | ABSENT | aucune route de remboursement du wallet (`ledger.port.ts` mentionne le mot dans un commentaire) | §17 « remboursements » ; non consigné. Écart G3 |
| Double validation des opérations sensibles (§17, §26, §29) | ABSENT | aucune occurrence ; la réconciliation admin existe, mais le gel et le dégel de compte sont à validation unique (e2e `ledger` « unfrozen (admin, audited) ») | Non consigné. Écart G3 |
| Alertes d'anomalie | PARTIEL | réconciliation horaire journalisée en erreur ; aucune alerte antifraude | |
| Escrow, BNPL, cartes, multi-devises avec taux | DIFFÉRÉ | §17 « après validation juridique » ; USD/CDF sans conversion | |
| PIN : Argon2id, verrou, jamais exporté | CONFORME | e2e `kyc` (4 tests PIN) | |

## 8. Lot 7 : lieux et recherche (§24, §25)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Lieux triés par distance, position jamais stockée | CONFORME | ADR-019, `src/places/*`, `log-scrub.ts` ; e2e `places` (4) | |
| Carte interactive | PARTIEL | liste par distance et lien vers l'app de cartes (PROGRESS M5a) | Pas de carte tuilée : cohérent avec §25 « itinéraires seulement si source cartographique » mais à indiquer au BACKLOG |
| Recherche universelle, historique contrôlable, respect de la visibilité et des blocages | CONFORME | `src/search/*`, e2e `search` (11) | |
| PostGIS | DIFFÉRÉ | ADR-019, ADR-004 | Remplaçable sans changer l'API |
| Suggestions, recherche en langage naturel | PARTIEL | filtres structurés seulement | Langage naturel : voir lot 12 |

## 9. Lot 8 : livraison (§9)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Zones, frais, retrait, choix au checkout | CONFORME | `src/delivery/*`, `migrations/0019_delivery.sql`, e2e `delivery` (9) | |
| Livreur, affectation, réaffectation, statuts append-only | CONFORME | idem | |
| Preuve par code à 6 chiffres (HMAC, 5 essais, verrou) | CONFORME | idem | Photo / signature : ABSENTES, non consignées |
| Position livreur consentie, effacée à la fin | CONFORME | idem | |
| Évaluation du livreur | CONFORME | idem | |
| Incidents, retours, remboursement de livraison | PARTIEL | statuts `failed`/`returned` existent ; pas de remboursement | Voir G2 |
| Express/programmée, multi-étapes, tournées, internationale, entrepôts | ABSENT / DIFFÉRÉ | non consignés individuellement ; §9 interdit de simuler l'international : conforme | |
| Test de la purge livreur | PARTIEL | code `maintenance.service.ts:383-402` ; e2e `delivery` n'a que 9 tests | Couverture de la purge livreur : non vérifiée |

## 10. Lot 9 : services et réservations (§11)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| 15 catégories, offres d'organisations et de particuliers | CONFORME | `src/services/*`, `migrations/0020_bookings.sql`, e2e `bookings` (15) | |
| Prix fixe ou sur devis, créneaux, pas de double réservation (index unique) | CONFORME | idem | |
| « non vérifié » affiché, « urgent » / « garanti » seulement si renseignés | CONFORME | PROGRESS ; `verification_status` par défaut `unverified` | Aucune route ne passe un prestataire à `verified` (même cause que G1) : non vérifié par test |
| Paiement sur place seulement, avis vérifiés, annulation avec délai | CONFORME | idem | Paiement en ligne : DIFFÉRÉ (Q5) |
| Portfolio, vérification de prestataire | PARTIEL | photos d'offres « non testées » (PROGRESS) | |

## 11. Lot 10 : mini-apps (§23)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| OAuth 2.0 + PKCE S256 obligatoire, codes à usage unique, jetons hachés, rotation et détection de réutilisation | CONFORME | `src/miniapps/oauth.service.ts`, ADR-021, e2e `miniapps` (18 points) | |
| Scopes déclarés, révocables, jetons d'app refusés sur routes utilisateur | CONFORME | idem | |
| `wallet.pay` ne débite jamais sans PIN | CONFORME | idem | |
| Revue / certification par admin, suspension | CONFORME | `miniapps.service.ts:173`, audit | |
| Accès audités | PARTIEL | audit des autorisations, rejeux, révocations, paiements (`oauth.service.ts`, `miniapp-api.service.ts:221`) ; les lectures de profil/commandes par l'app ne sont pas auditées | §23 « accès audités ». Écart G3 |
| Quotas par app | PARTIEL | limite de débit du point de jeton (e2e `miniapps`) ; pas de quota par app sur les routes de données (non vérifié) | |
| SDK, tableau de bord développeur, versions, analyse d'usage, partage de revenus | DIFFÉRÉ / ABSENT | non consignés individuellement ; revenus : §36 politique non définie | |
| Écrans mobiles | **ABSENT** | aucun écran ; la tuile « Mini-apps » du menu Plus n'ouvre rien (`apps/mobile/src/app/(app)/(tabs)/more.tsx:18`) | PROGRESS lot 10 le dit ; BACKLOG « Lots mobile » n'a aucune ligne mini-apps. Écart G4 |

## 12. Lot 11 : mobilité (§10)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Courses taxi / moto, estimation affichée comme telle, fourchette de prix | CONFORME | `src/mobility/*`, `migrations/0022_mobility.sql`, e2e `mobility` (17) | |
| Chauffeurs approuvés par admin avec KYC niveau 1 | CONFORME | idem | |
| Un seul chauffeur gagnant, code de départ, programmée, étape | CONFORME | idem | |
| Partage du trajet, alerte, contacts de confiance, évaluations, lieux favoris, reçu | CONFORME | idem ; purge e2e | |
| Paiement | PARTIEL | espèces seulement | Autorisé (§10 + Q5) |
| Covoiturage, location, bus/train/avion, hôtels, dépannage, EV/parking | ABSENT / DIFFÉRÉ | non consignés individuellement | §10 conditionne les réservations de transport à des fournisseurs ; à consigner |
| ETA et itinéraires | PARTIEL | estimation (distance) seulement, libellée comme telle | Conforme à §25 |
| Écrans mobiles | CONFORME | M7 (PROGRESS), `apps/mobile/src/app/(app)/rides` | Vérifié à l'écran : écran Courses seulement |

## 13. Lot 12 : assistant IA (§22)

| Exigence | Statut | Preuve | Remarque |
|---|---|---|---|
| Assistant conversationnel multi-fournisseurs, choix de l'utilisateur, activation admin, fiche de modèle | CONFORME | `src/ai/*`, ADR-022, e2e `ai` (10) | Aucune clé réelle : testé avec `fetch` simulé |
| Pas de messages privés, KYC, paiements envoyés ; ni prompt ni réponse dans les journaux | CONFORME | ADR-022, `log-scrub.ts` (`/ai`), audit sans contenu (`ai-models.service.ts:100`) | Contrôle exhaustif des appels : par échantillon |
| Quotas, limite de débit, historique privé exporté et purgé | CONFORME | export `account.service.ts:460`, purge `maintenance.service.ts:376-379` | |
| Génération de descriptions produit (jamais publiée automatiquement) | CONFORME | `POST orgs/:orgId/ai/product-description` | |
| Exécuter des tâches avec autorisations explicites (agent, MCP, confirmation avant action) | ABSENT | l'assistant ne fait que répondre ; aucun outil / action | Non consigné comme différé. Cohérent avec « ne pas donner d'accès par défaut » |
| Recherche en langage naturel, recommandations, résumés de messages, traduction, IA entreprise, détection de fraude, images, voix | ABSENT | aucun code | Non consignés au BACKLOG (seule la partie texte du lot 12 est décrite) |
| Écrans mobiles | CONFORME | M7 : `apps/mobile/src/app/(app)/ai` | Vérifié « sans clé » seulement |

## 14. Écarts à corriger (par gravité)

### Grave
**G1. Aucun outil d'administration pour suspendre / réactiver un compte, ni pour vérifier ou suspendre une organisation ou un prestataire.**
Constat : `admin.controller.ts` n'expose que la lecture de l'audit ; aucune route ne modifie `users.status` ni le badge vérifié ; la cible de signalement `user` est un no-op (`social-stories` : `social-moderation.ts:73`). Les e2e suspendent par SQL direct. Conséquence : une fois un signalement reçu, la modération ne peut pas sanctionner un auteur (§4, §26, §34 « signalement, masquage »).
Correction minimale : `PUT /v1/admin/users/:id/status` (rôle `admin`, motif obligatoire, audit `admin.user_status_changed`, sessions révoquées à la suspension, interdiction de s'auto-suspendre) ; `PUT /v1/admin/orgs/:id/status` et `/verify` ; un test e2e par route. Environ une journée.

### Moyen
**G2. Retours, remboursements et litiges de commande absents et non consignés.** Les statuts de commande s'arrêtent à `delivered/cancelled`. Correction : ajouter au BACKLOG (lot 5c) avec dépendance au paiement (Q5) ; à défaut, au minimum un statut `refund_requested` et un litige à arbitrer par un admin, sans mouvement d'argent (paiement à la livraison). Les organisations et les mini-apps ne sont pas signalables : ajouter les cibles `organization` et `miniapp` au registre de modération.

**G3. Opérations sensibles sans double validation, ni remboursement wallet, ni audit des lectures de mini-apps, ni limite de débit des publications.** Correction minimale : consigner chacun au BACKLOG ; pour la double validation, exiger un second administrateur pour le dégel d'un compte financier et la réconciliation corrective ; auditer (action seule, sans contenu) l'appel de profil/commandes d'une mini-app (`miniapp.data_read`) ; throttler dédié sur `POST` des publications comme pour la messagerie (modèle : `MESSAGING_RATE_LIMIT_PER_MINUTE`).

**G4. Mini-apps sans écran mobile alors que la tuile du menu Plus existe.** Correction : retirer la tuile ou la libeller « bientôt » comme `live`, et ajouter une ligne M8 mini-apps au BACKLOG (annuaire, consentement OAuth, apps autorisées, révocation).

### Faible
**G5. Éléments du cahier non consignés au BACKLOG** (la règle §0 exige de ne rien oublier) : connexion sociale (Google/Apple/Facebook), biométrie, présence en ligne, sondages, recherche dans les messages, messages vocaux côté API, posts sponsorisés et statistiques de portée, preuve de livraison par photo/signature, covoiturage / location / transports, SDK et tableau de bord développeur, webhooks signés, agent IA avec actions, recherche en langage naturel, RH. Correction : une ligne par thème dans BACKLOG avec statut `reporté` et raison.

**G6. Export / purge : notifications, brouillons et messages programmés non vérifiés** (`notifications.title/body` conservés après anonymisation). Correction : vérifier le contenu des notifications ; si elles portent des noms, les purger dans `purgeUsers` et les exporter.

**G7. Consentements non centralisés.** Correction : table `user_consents` (type, version, date, retrait) quand la traduction ou la diffusion IA seront activées ; sans urgence tant que ces fonctions n'existent pas.

**G8. Mobile : langue d'interface fr/en, swahili non fourni, langue non persistée** (§27). À consigner.

## 15. Divergences docs / code

| Document | Affirmation | Réalité constatée |
|---|---|---|
| PROGRESS (lot 1b, « Non fait ») | « `@RequireFlag` n'est posé sur aucune route de production » | Posé sur 30 contrôleurs (`grep @RequireFlag`). Affirmation périmée |
| PROGRESS (lot 1, « Non fait ») | « Aucun commit Git » ; « Pas de Dockerfile ni CI » | Dépôt avec 74 commits ; CI et Dockerfile livrés au lot 1c (`e67bcbc`). Affirmation périmée |
| PROGRESS (lot 2, « Limites ») | permissions métier des organisations « pas encore utilisées » | Utilisées par catalogue, commandes, wallet d'organisation, QR (`catalog.manage`, `orders.manage`, `finance.view`) |
| PROGRESS lot 4 / ADR | « sanction d'un compte par son statut (admin tooling) » (code `social-moderation.ts:73`) | L'outil n'existe pas (G1) |
| BACKLOG en-tête | « Dernière mise à jour : 2026-11-02 » | Le contenu va jusqu'au 2026-11-16 |
| BACKLOG ligne « 13+ » | services publics « planifié » | Lot 19 abandonné (même fichier, ligne 27) |
| BACKLOG 5b | « livraison et suivi (lot 9) » listés comme planifiés | Livraison faite au lot 8 |
| BACKLOG 4b / 3b / 5b | éléments « planifié » sans suivi | Plusieurs portés par les lots 14 à 20 ou jamais ouverts : statut à remettre à jour |
| BACKLOG « Lots mobile » | M1b « planifié », absence de M4a/M7/mini-apps | M7 (mobilité et IA) et M4a existent dans PROGRESS ; aucun lot mobile pour les mini-apps |
| BACKLOG (Q8) | compte Expo « en attente » | Réponse 7 : « Expo : je peux tester quand je veux » ; non réconcilié |
| PROGRESS (tests) | 183 / 199 tests mobile, 509 tests API, « 609 tests » (message de commit e26912e) | **Non vérifié** : suites non lancées pour cet audit. Les e2e comptent 53 fichiers dans `test/` ; les 40 + fichiers du lot 1-12 existent bien |
| PROGRESS (lot 8) | 467 tests dont livraison | `delivery.e2e.test.ts` ne contient que 9 `it(` : la couverture de la purge livreur n'a pas été confirmée |
| ADR-016 vs PROGRESS M1 | accent `#4F46E5` / `#3730A3` | Deux valeurs différentes pour le même accent (cosmétique ; `src/theme/tokens.ts` fait foi, non lu) |
| PROGRESS M1 | tuile « Paris » visible si le flag l'autorise | Retirée depuis (aucune occurrence `betting` dans `apps/mobile/src`) : cohérent avec la décision du 2026-11-15. Les flags `betting`, `trading.live`, `csl_coins` existent encore en base (coupés) : conformes au cahier §21/§26 |

Fait à noter : les affirmations vérifiées et confirmées dans le code sont, entre autres, la purge du compte (messages, KYC, TOTP, mobilité, IA, mini-apps), le chiffrement AES-256-GCM du numéro de pièce, le PKCE obligatoire, l'idempotence du ledger, la réconciliation horaire, l'absence d'argent réel et l'absence d'annonce de chiffrement de bout en bout.

## 16. Non vérifié

Résultats des suites de tests (non exécutées) ; comportement à l'écran des écrans mobiles ; adaptateurs réels Brevo, WhatsApp, Gemini, Expo ; contrôle exhaustif de l'autorisation par ressource des 476 routes ; contenu des notifications ; couverture de test des sections Lot 8 hors `delivery.e2e` ; lot 18 et suivants (hors périmètre de cet audit).
