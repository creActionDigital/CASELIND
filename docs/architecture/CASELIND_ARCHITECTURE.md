# Architecture CASELIND

Dernière mise à jour : 2026-11-20 · Décisions détaillées : [DECISIONS.md](DECISIONS.md) · Inventaire des modules : [../MODULES.md](../MODULES.md) · Contrats : [API_CONTRACTS.md](API_CONTRACTS.md) · Déploiement : [../DEPLOYMENT.md](../DEPLOYMENT.md)

Ce document décrit ce qui existe dans le dépôt au 2026-11-20. Ce qui est encore en chantier (mobilité, mini-apps phase 2, administration, correctifs de revue) est marqué **en cours**. Ce qui n'a pas pu être vérifié est marqué « à vérifier ».

## 1. Vue d'ensemble

Monolithe modulaire (cahier des charges §28 : « pas de microservices prématurés ») dans un monorepo npm workspaces.

```
caselind/
├── apps/
│   ├── api/          NestJS · PostgreSQL · Drizzle ORM · Socket.IO        (une cinquantaine de modules, migrations 0001 à 0100)
│   ├── mobile/       React Native + Expo (expo-router, écrans dans src/app) (client principal)
│   └── web/          React + Vite, PWA minimale (15 fichiers suivis)        (périmètre à vérifier ; web conditionné à la validation du mobile)
└── packages/
    ├── contracts/    Schémas Zod + types partagés api / mobile / web / SDK
    └── sdk/          SDK des mini-apps : client, PKCE, vérification de signature des webhooks, manifeste
```

L'ordre de livraison **backend, puis mobile, puis web** est imposé par le propriétaire. Les paquets `i18n` et `ui-tokens` prévus au départ n'existent pas : les traductions (fr, en, sw) et les tokens de design vivent dans `apps/mobile/src/i18n` et `apps/mobile/src/theme`.

### Pourquoi un monolithe modulaire et pas des microservices

- Le cahier des charges (§28) l'impose, et la charge réelle (ville pilote, quelques milliers d'utilisateurs au départ) ne justifie ni la complexité d'exploitation ni le coût d'une flotte de services.
- Les invariants les plus importants sont **transactionnels** : un virement, une commande avec réservation de stock, un retrait de wallet, une approbation à double validation. Dans un seul processus avec une seule base, ils se règlent par une transaction PostgreSQL et un verrou de ligne ; répartis entre services, ils demanderaient des sagas, une file fiable et de la réconciliation.
- Une seule équipe, un seul déploiement, un seul jeu de tests d'intégration contre une vraie base : la cohérence des contrats (Zod partagé) est vérifiée par le compilateur et non par des tests de contrat entre services.
- Les frontières existent déjà dans le code (un dossier par module, communication par services injectés et par **ports** : `CatalogPort`, `LedgerPort`, `KycPort`, `PinPort`, `OtpSender`, `PushGateway`, `MediaStorage`, `LlmProvider`, `WebhookTransport`). Extraire un module plus tard reste possible (section 9).

## 2. Stack (versions relevées le 2026-11-01 ; à revérifier dans les `package.json`)

| Rôle | Choix | Justification |
|---|---|---|
| Runtime | Node.js (image Docker `node:22-slim`, Node ≥ 22 requis) | Voir `apps/api/Dockerfile` |
| Framework API | NestJS 12 en ESM | Imposé par le cahier des charges §28 |
| Langage | TypeScript 7 | `emitDecoratorMetadata` vérifié |
| Base de données | PostgreSQL (18 en dev et test, ≥ 16 supporté) ; PostGIS en production non utilisé aujourd'hui (ADR-019) | Cahier §28 |
| Accès données | Drizzle ORM + `pg` ; SQL brut (`sql\`…\``) pour les requêtes sensibles | Typage fort, SQL explicite, sans moteur binaire |
| Migrations | SQL versionné maison (`apps/api/migrations`, 0001 à 0100, 95 fichiers) | CHECK, triggers append-only, checksum anti-modification |
| Validation | Zod, contrats partagés | Mêmes schémas côté serveur, mobile, web, SDK |
| Mots de passe | Argon2id (`@node-rs/argon2`) | Paramètres OWASP minimum |
| Jetons | JWT HS256 (`jose`) de 15 min + refresh opaque haché à rotation | Révocation immédiate |
| Temps réel | Socket.IO sur le même processus (`/v1/socket.io`) | ADR-014 |
| Journaux | pino (`nestjs-pino`), `x-request-id`, secrets masqués | JSON structuré |
| Anti-abus | `@nestjs/throttler` (budget global, budget strict pour `/auth`) + limiteurs dédiés | En mémoire (section 10) |
| Tâches planifiées | `@nestjs/schedule` (`@Interval`), chargé si `MAINTENANCE_ENABLED=true` | Nettoyage, reprises de webhooks, paiements programmés |
| OpenAPI | Généré depuis Zod (`z.toJSONSchema`), registre de routes testé pour l'exhaustivité | ADR-011 |
| Observabilité | `/metrics` Prometheus maison, sans dépendance | Section 8 |
| Tests | Vitest + SWC + supertest, PostgreSQL embarqué réel | Pas de mock de la base (ADR-004) |

## 3. Couches et découpage

Chaque module (`apps/api/src/<module>/`) suit le même schéma :

1. **Contrôleur** : route, garde (`@RequireFlag`, permission d'organisation, rôle plateforme), validation Zod (`ZodPipe`) du corps et des paramètres, aucune logique métier.
2. **Service** : règles métier, transactions, verrous, audit, effets de bord après commit (temps réel, push, webhooks).
3. **Accès données** : Drizzle et SQL, dans les services (pas de couche « repository » séparée) ; schémas typés dans `src/db/schema-*.ts`, miroir des migrations.
4. **Contrats** : `packages/contracts/src/<module>.ts` (schémas, types, constantes partagées comme `WEBHOOK_EVENTS`).
5. **Registre OpenAPI** : `src/openapi/registry.ts` ; un test échoue si une route montée manque au registre ou inversement.

Transversal : `config` (environnement validé), `common` (`AppError`, filtre d'exceptions, pipe Zod, masquage des journaux), `security` (garde globale, mots de passe, jetons, vérification de session), `audit`, `flags`, `observability`, `realtime`. Les modules communiquent par services injectés ou par ports ; les événements de domaine ne passent pas par une file (pas d'outbox, voir section 10).

Le catalogue des 60 dossiers de `src/` avec leurs tables, routes, flags, permissions, écrans mobiles et événements est dans [MODULES.md](../MODULES.md).

## 4. Sécurité

- **Tout est authentifié par défaut** : garde globale ; seules les routes `@Public()` sont ouvertes. Une requête authentifiée vérifie en base que la session existe, n'est ni révoquée ni expirée et que l'utilisateur est `active` ; rôles lus en base, jamais seulement depuis le JWT (révocation, suspension, changement de rôle immédiats).
- **Refresh tokens** opaques, hachés (SHA-256), à usage unique ; le rejeu d'un jeton consommé révoque la session. **OTP** HMAC-SHA256 avec pepper, 10 min, 5 essais, usage unique. Anti-énumération à l'inscription et au mot de passe oublié. Verrouillage après N échecs. 2FA TOTP et codes de secours.
- **Permissions d'organisation** (`orgs/org-permissions.ts`) : rôle, puis permission, imposées par le serveur ; un objet d'une autre organisation répond 404.
- **Drapeaux de fonctionnalité** par pays et par rôle ; les flags réglementés (paiements, paris, santé…) sont coupés par défaut et exigent `confirmRegulated` (ADR-013) ; les modifications sensibles passent par la double validation (section 7).
- **Jetons d'applications tierces** (mini-apps) : opaques, distincts des sessions, relus en base à chaque appel (ADR-021).
- **Contraintes en base** (CHECK, UNIQUE, citext) en plus de la validation applicative ; triggers **append-only** sur `audit_events`, `stock_movements`, `order_events`, `journal_entries` / `postings`, `user_consents`.
- **Configuration validée au démarrage** ; refus de démarrer en production avec des secrets faibles, des clés de chiffrement absentes ou le fournisseur OTP « console ».
- En-têtes `helmet`, CORS fermé tant que `CORS_ORIGINS` est vide, corps JSON limité à 100 ko, `trust proxy` configurable (`TRUST_PROXY`).

## 5. Transactions, verrous, idempotence

- **Une transaction par opération métier** (`db.transaction`), l'audit étant écrit dans la même transaction que l'effet. Les effets externes (temps réel, push, webhooks, notifications) partent **après le commit** et ne font jamais échouer la requête (`bestEffort`).
- **Verrous de ligne** `SELECT … FOR UPDATE` (ou `FOR NO KEY UPDATE`) pour les décisions qui dépendent de l'état lu : flags réglementés (ADR-013), comptes du ledger verrouillés **dans l'ordre des id** pour éviter les interblocages, dernier propriétaire d'organisation (ADR-012), stock, approbations. **Verrous consultatifs** `pg_advisory_xact_lock` pour les contraintes que SQL n'exprime pas (panier par utilisateur, numérotation fournisseur, changement d'identifiant…) et pour que plusieurs instances n'exécutent pas la maintenance ni les migrations en même temps.
- **Ledger en partie double** : une écriture par mouvement, postings de somme nulle (trigger différé), append-only ; le solde ne devient jamais négatif. Montants en unités mineures entières, une devise par opération. **Bac à sable uniquement : aucun argent réel** (cahier §17).
- **Idempotence** : `clientId` (UUID du client) unique en base par ressource (messages, publications, commandes, virements…) ; rejeu identique = 200 avec la ressource existante, valeurs différentes = 409 `idempotency_mismatch`. Détail dans [API_CONTRACTS.md](API_CONTRACTS.md).
- **Tâches reprises** : les paiements programmés, les webhooks en échec et les rappels s'exécutent par `@Interval` ou `setInterval` ; une livraison de webhook réclamée porte un bail de 2 minutes pour qu'un autre worker ne la reprenne pas.

## 6. Temps réel, médias, contrôle d'accès

**Socket.IO** (ADR-014) : même processus, même vérificateur de session que HTTP (`SessionVerifier`), authentification au handshake uniquement (`handshake.auth.token`), diffusion par rooms (`user:`, `session:`, `conversation:`, `order:`). Les écritures passent par HTTP (validation, idempotence, OpenAPI) ; seul `typing` entre par la socket. Liste des événements : [API_CONTRACTS.md](API_CONTRACTS.md). Un adaptateur Redis pourrait être ajouté sans changer le code des modules (les noms de rooms sont stables).

**Médias** (`media/`) : téléversement signé, fichier d'abord mis en attente sur disque local, contrôle du type réel (`sniff.ts`, pas seulement le type déclaré), limites par type (`MEDIA_MAX_*`), quota par utilisateur (`MEDIA_QUOTA_BYTES_PER_USER`), limite de débit. Le stockage passe par le port `MediaStorage`, dont le seul adaptateur est `LocalDiskStorage` (fournisseur S3 non choisi, Q6).

**Contrôle d'accès par finalité** (`media/access.ts`, `canRead` puis `canReadAsync`) : chaque média a une finalité (`avatar`, `org_logo`, `product`, `listing`, `post`, `story`, `message`, `document`, `kyc_document`, `cv`, `lesson`, `delivery`, `delivery_proof`, `digital_file`, `health_result`…) et une règle de lecture propre. Exemples : avatars et images de catalogue lisibles par tout utilisateur connecté ; pièces jointes de messages lisibles par les membres actifs de la conversation (message ni rappelé ni expiré, envoyé après leur arrivée) ; documents d'identité : propriétaire et administrateurs KYC ; résultats de santé : le patient et un professionnel disposant d'un partage actif ; fichiers numériques : acheteurs d'une commande livrée et gestionnaires du catalogue. Le contrôle est refait à chaque lecture ; les contenus sensibles sont servis sans cache partagé.

## 7. Données sensibles, consentements, double validation

- **Chiffrement au repos (AES-256-GCM)** : données de santé personnelles (`health-crypto.ts`, clé `HEALTH_ENCRYPTION_KEY`, identifiant du propriétaire en données authentifiées), pièces KYC (`kyc-crypto.ts`, `KYC_ENCRYPTION_KEY`), secrets TOTP (`totp-crypto.ts`, `TOTP_ENCRYPTION_KEY`), secrets des webhooks d'organisation et de mini-apps (`WEBHOOK_ENCRYPTION_KEY`, repli sur `TOTP_ENCRYPTION_KEY`, identifiant de clé inclus pour permettre la rotation). Les **fichiers** des finalités `health_result` et `kyc_document` sont aussi chiffrés sur disque (`media.service.ts`, format `CLSEAL1\0` + IV + tag + données, identifiant du média en données authentifiées ; fichiers en clair anciens relus tels quels). Hors production, une clé de repli est dérivée de `JWT_ACCESS_SECRET` ; en production les clés sont exigées. Limite : chiffrement en mémoire du fichier entier (plafond 20 Mo).
- **Consentements** (`consents/`) : journal append-only `user_consents` (trigger qui refuse UPDATE et DELETE), un état courant par type (`health`, `marketing`, `location_sharing`, `ai_processing`, `analytics`, `translation`) avec la version du texte accepté. Les tables historiques de la santé et du marketing restent source de vérité pour leur effet. Certaines routes refusent de partir sans consentement (409 `consent_required`).
- **Double validation** (`admin/approvals.service.ts`, table `admin_approvals`) : quatre opérations sensibles (`flag.regulated.change`, `user.platform_role.grant`, `ledger.account.freeze`, `user.suspend.staff`) ne s'exécutent que lorsqu'un **autre** administrateur approuve la demande ; l'exécution et la décision partagent une transaction ; une demande expire au bout de 24 h. Notifications au demandeur. **en cours** (administration).
- **Journal d'audit** append-only, sans mot de passe, secret ni contenu privé ; les webhooks y figurent par hôte et non par URL complète.

## 8. Observabilité

- Journaux pino JSON avec `x-request-id` propagé (en-tête de réponse, enveloppe d'erreur, journaux) ; `authorization`, `cookie` et chaînes de requête sensibles masqués (`log-scrub`) ; jamais de corps de requête.
- `/metrics` Prometheus (jeton `METRICS_TOKEN`, 404 sans lui) : requêtes HTTP par gabarit de route, histogramme de durée, mémoire, CPU, retard de boucle d'événements, pool PostgreSQL, connexions Socket.IO, compteurs de maintenance, de webhooks et de caisse. Liste exacte dans [API_CONTRACTS.md](API_CONTRACTS.md).
- Sondes `GET /v1/health`, `/v1/health/live`, `/v1/health/ready`. Journal d'accès des mini-apps (qui, quel scope, quelle ressource) et statistiques d'usage par jour pour les développeurs.
- Pas de traçage distribué ni d'alertes configurées dans le dépôt (à vérifier côté hébergement).

## 9. Trajectoire d'extraction en services

Principe : on n'extrait un module que lorsqu'un critère mesurable est atteint, et on le sort derrière le port qu'il a déjà. Aucune extraction n'est faite ni planifiée à ce jour.

| Candidat | Pourquoi il sortirait en premier | Critères de déclenchement | Prérequis déjà en place | À prévoir |
|---|---|---|---|---|
| Messagerie temps réel (Socket.IO, présence, saisie) | Charge de connexions longues, scalabilité horizontale différente de l'API REST | > quelques milliers de sockets simultanées par instance ou latence d'envoi dégradée ; besoin de déployer sans couper les sockets | Rooms nommées de façon stable, écritures en HTTP, effets après commit | Adaptateur Redis (ou équivalent), présence hors mémoire, file de diffusion |
| Médias | Disque local, CPU (miniatures, chiffrement en mémoire), volumétrie | Stockage > capacité d'un volume, ou traitements d'image qui pénalisent l'API ; passage au stockage objet (Q6) | Port `MediaStorage`, accès contrôlé par finalité dans `access.ts` | Adaptateur S3, URL signées, traitement asynchrone, antivirus |
| Appels et lives | WebRTC : TURN et SFU à héberger, charge sans rapport avec le CRUD | Premier déploiement réel d'appels de groupe ou de lives avec audience | Signalisation relayée en temps réel (`call.*`, `live.*`) et jamais stockée | coturn, SFU (LiveKit ou équivalent), choix d'hébergeur et coût |
| IA | Latence et coûts des fournisseurs, clés tierces, quotas | Volume qui impose files, reprises et budgets par organisation | Port `LlmProvider`, catalogue de modèles, consentement, quotas journaliers | Service isolé avec ses propres clés, file de travaux, métriques de coût |
| Wallet / ledger | Exigences réglementaires (agrément, cloisonnement, audit), cycle de déploiement prudent | **Obligatoire** avant tout argent réel : partenaire de paiement agréé et exigences de conformité ; sinon, seulement si l'isolation des données financières devient une exigence | Ports `LedgerPort`, `KycPort`, `PinPort`, ledger en partie double append-only, idempotence | Base dédiée, protocoles de réconciliation, outbox transactionnelle, sagas pour les commandes |

Conditions communes avant toute extraction : outbox PostgreSQL pour les événements de domaine (absente aujourd'hui), jetons de service à service, traçage de bout en bout, contrats versionnés.

## 10. Limites connues

- **Une seule instance de l'API** est supportée de façon fiable. Sont **en mémoire de processus** : le limiteur de débit NestJS (`@nestjs/throttler`) et les limiteurs dédiés ; le limiteur par application des mini-apps (`miniapp-rate-limit.ts`, avec commentaire `shortcut` : le plafond réel serait N fois plus élevé avec N instances) ; le plafond d'événements de webhooks par organisation ; la limitation de `typing` ; les compteurs de `/metrics` (singleton de processus). La présence est stockée en base (`last_seen_at`) mais la diffusion Socket.IO ne traverse pas les instances.
- **Pas de Redis** (aucune dépendance `redis` / `bull` dans `apps/api/package.json`). Conséquences : pas de cache de sessions (une requête indexée par appel), pas de file de tâches, pas d'adaptateur Socket.IO partagé. Les tâches périodiques (`@Interval`) s'appuient sur des verrous consultatifs et des baux en base.
- **Stockage des médias sur disque local** (`MEDIA_STORAGE_DIR`, volume `/data/media` dans l'image Docker) : pas de réplication, pas de CDN ; sauvegardes à organiser avec celles de la base.
- **Pas d'outbox** : un effet externe perdu après le commit (crash entre le commit et l'envoi) n'est pas rejoué, sauf les webhooks (journal de livraisons et reprises).
- **Argent** : sandbox uniquement ; paiement à la livraison pour le commerce ; remboursements, commissions et revenus de mini-apps sont des relevés indicatifs (ADR du 2026-11-20).
- **Pas d'environnement de production** : hébergement non choisi (Q6). La CI vérifie le code mais ne déploie rien ([DEPLOYMENT.md](../DEPLOYMENT.md)).
- **PostGIS non utilisé** : recherche de proximité par boîte englobante et haversine (ADR-019).
- **Interface web** : `apps/web` existe mais son périmètre n'est pas décrit ici (à vérifier).
- **en cours** : mobilité (taxi, covoiturage, location, dépannage), mini-apps phase 2 (versions, quotas, revenus indicatifs, webhooks, notifications), administration (analytique, double validation), correctifs de revue (migrations 0097 et 0100) ; les modules concernés peuvent changer de forme avant leur commit.

## 11. Données et migrations

- Migrations SQL **forward-only**, numérotées, chacune dans une transaction, sous verrou consultatif (plusieurs instances peuvent démarrer ensemble). Un checksum empêche de modifier une migration déjà appliquée. Les numéros 0033, 0040, 0051, 0098 et 0099 n'existent pas.
- `apps/api/src/db/schema-*.ts` est le miroir typé des migrations : à tenir synchronisé à chaque migration.
- Multi-tenant : `org_id` sur les tables métier, contrôlé dans les services (permissions d'organisation) ; RLS PostgreSQL non utilisée.
- Production : PostgreSQL managé, sauvegardes chiffrées et test de restauration périodique (procédure à rédiger avec le choix de l'hébergeur).
- Suppression de compte : délai de grâce puis anonymisation, médias effacés après commit, audit conservé (ADR-012).

## 12. Environnements

| Env | Base | OTP | Paiements |
|---|---|---|---|
| dev | `npm run db:dev` (PostgreSQL embarqué) | console (journal) | aucun |
| test | PostgreSQL embarqué, une base par fichier de test | capture en mémoire | aucun |
| staging / prod | PostgreSQL managé (à choisir) | e-mail Brevo, téléphone WhatsApp Cloud API (ADR-018) | aucun argent réel ; partenaire agréé seulement le jour venu |

Variables de configuration (toutes validées dans `apps/api/src/config/env.ts`, exemples dans `apps/api/.env.example`) : voir [DEPLOYMENT.md](../DEPLOYMENT.md). Clés de chiffrement à fournir en production : `KYC_ENCRYPTION_KEY`, `TOTP_ENCRYPTION_KEY`, `HEALTH_ENCRYPTION_KEY`, `PAYMENT_QR_SECRET`, `MEDIA_SIGNING_SECRET`, et `WEBHOOK_ENCRYPTION_KEY` (ou `TOTP_ENCRYPTION_KEY`).
