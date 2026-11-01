# Architecture CASELIND

Dernière mise à jour : 2026-11-01 · Décisions détaillées : [DECISIONS.md](DECISIONS.md)

## 1. Vue d'ensemble

Monolithe modulaire (CDC §28 : « pas de microservices prématurés ») dans un monorepo npm workspaces.

```
caselind/
├── apps/
│   ├── api/          NestJS 12 · PostgreSQL · Drizzle ORM          ← PHASE 1 (en cours)
│   ├── mobile/       React Native + Expo                            ← PHASE 2 (après le backend)
│   └── web/          React + TypeScript + Vite (pas de Next.js)     ← PHASE 3 (après validation mobile)
└── packages/
    ├── contracts/    Schémas Zod + types partagés api/mobile/web    ← en place
    ├── i18n/         FR / EN / SW                                   (planifié)
    └── ui-tokens/    Tokens de design partagés mobile/web           (planifié)
```

L'ordre de livraison **backend → mobile → web** est imposé par le propriétaire. Le web ne démarre pas avant la validation des principales fonctions mobiles.

## 2. Stack backend réellement installée (vérifiée le 2026-11-01)

| Rôle | Choix | Version | Justification |
|---|---|---|---|
| Runtime | Node.js | 26.13 (≥ 22 requis) | Présent sur la machine |
| Framework API | NestJS | 12.3 (ESM) | Imposé par le CDC §28 |
| Langage | TypeScript | 7.0 | `emitDecoratorMetadata` vérifié fonctionnel |
| Base de données | PostgreSQL | 18.6 (dev/test) | CDC §28 ; PostGIS en production |
| Accès données | Drizzle ORM + `pg` | 0.45 / 8.23 | Typage fort, SQL explicite, sans moteur binaire |
| Migrations | SQL versionné maison (`apps/api/migrations`) | — | Contrôle total : extensions, CHECK, triggers append-only ; checksum anti-modification |
| Validation | Zod (contrats partagés) | 4.6 | Mêmes schémas côté mobile et web |
| Mots de passe | Argon2id (`@node-rs/argon2`) | 2.2 | Paramètres OWASP minimum |
| Jetons | JWT HS256 (`jose`) + refresh opaque haché | 6.2 | Rotation à usage unique |
| Journaux | pino (`nestjs-pino`) | 10 | JSON structuré, `x-request-id`, secrets masqués |
| Anti-abus | `@nestjs/throttler` | 6.7 | Budget global + budget strict pour `/auth` |
| Tâches planifiées | `@nestjs/schedule` | 12.0.2 | Nettoyage horaire (lot 1b) ; module chargé seulement si `MAINTENANCE_ENABLED=true` |
| OpenAPI | Généré depuis Zod (`z.toJSONSchema`) | — | Pas de `@nestjs/swagger` (ADR-011) |
| En-têtes | helmet | 8.3 | — |
| Tests | Vitest + SWC + supertest, PostgreSQL embarqué réel | 5.0 | Le backend est en ESM ; pas de mock de la base |
| BD locale | `embedded-postgres` | 18.6 | **Ni Docker ni PostgreSQL installés** sur la machine |

## 3. Découpage en modules backend (cible)

Chaque module possède : contrôleur(s), service(s), migrations, contrats dans `packages/contracts`, tests d'intégration. Les modules communiquent par services injectés ; les événements de domaine passeront par une file (outbox PostgreSQL, puis Redis/BullMQ si la charge le justifie).

| Module | Contenu | Lot | État |
|---|---|---|---|
| `core` | config validée, BD, erreurs, journaux, request-id, rate limit, health | 1 | **testé** |
| `security` | Argon2id, JWT, garde globale (session + statut + rôles lus en base), RBAC plateforme | 1 | **testé** |
| `audit` | Journal append-only (trigger BD) | 1 | **testé** |
| `auth` | Inscription, OTP, connexion, verrouillage, rotation des refresh tokens, sessions, mot de passe oublié | 1 | **testé** |
| `users` | Profil, @handle, profil public, journal de sécurité personnel | 1 | **testé** |
| `admin` | Back-office : audit (lot 1), API des flags (lot 1b) ; modération, comptes, interface back-office (lots suivants) | 1+ | audit et flags **testés** |
| `flags` | Feature flags par pays et par rôle, modules réglementés coupés par défaut, `confirmRegulated` sous verrou de ligne (ADR-013), garde `@RequireFlag` (403 `feature_disabled`). Pas de restriction par ville ; pas de cache | 1b | **testé** |
| `privacy` | Réglages de confidentialité (stockés ; appliqués aux lots 3 et 7), blocages (appliqués au profil public ; `isBlockedEitherWay` prêt pour la messagerie). Consentements : planifiés | 1b | **testé** (réglages, blocages) |
| `account` | Export des données (`GET /v1/me/export`), demande de suppression avec délai de grâce (ADR-012) | 1b | **testé** |
| `maintenance` | Nettoyage horaire (OTP, refresh tokens, sessions périmés) et anonymisation des comptes dont le délai de grâce est passé ; verrou consultatif entre instances | 1b | **testé** (`runOnce` ; planification non testée automatiquement) |
| `openapi` | Document OpenAPI 3.1 généré depuis les contrats Zod, registre des routes et test d'exhaustivité (ADR-011) | 1b | **testé** |
| `media` | Téléversement par URL signée (S3-compatible), validation MIME et taille, miniatures | 2 | planifié |
| `orgs` | Organisations, membres, rôles org (propriétaire, manager, finance, stock, ventes, RH, support, livreur), vitrine | 2 | planifié |
| `messaging` | Conversations, messages, accusés, WebSocket (Socket.IO), signalisation d'appels | 3 | planifié |
| `notifications` | Centre, préférences, push Expo | 3 | planifié |
| `social` | Posts, réactions, commentaires, abonnements, stories, vidéos courtes, signalements | 4 | planifié |
| `catalog` / `orders` | Produits, variantes, stock, panier, commandes multi-vendeurs, avis | 5 | planifié |
| `ledger` / `wallet` / `payments` | Ledger en partie double append-only, wallet **sandbox**, idempotence, rapprochement | 6 | planifié (sandbox) |
| `kyc` | Niveaux KYC, dossiers, revue humaine | 6 | planifié |
| `places` / `maps` | Lieux, recherche de proximité (PostGIS en prod) | 7 | planifié |
| `search` | Recherche universelle (pg_trgm, puis moteur dédié si nécessaire) | 7 | planifié |
| `delivery`, `mobility`, `services`, `health`, `education`, `jobs`, `realestate`, `publicservices` | Modules verticaux, selon partenaires et licences | 8+ | planifié |
| `miniapps` | Registre, OAuth à code éphémère, scopes révocables | 8 | planifié |
| `ai` | Abstraction fournisseur, consentement, limites de coût, journal | 9 | planifié |
| `games`, `trading` (simulation), `csl` (désactivé) | Selon règles et licences | 10+ | planifié / bloqué |

## 4. Modèle de sécurité (appliqué dès le lot 1)

- **Tout est authentifié par défaut** : garde globale ; seules les routes marquées `@Public()` sont ouvertes.
- **Chaque requête authentifiée vérifie en base** que la session existe, n'est ni révoquée ni expirée, et que l'utilisateur est `active`. Révocation, suspension et changement de rôle prennent donc effet **immédiatement**. Coût : une requête indexée par appel, à mettre en cache (Redis) quand la charge l'exigera.
- **Rôles lus en base**, jamais seulement depuis le JWT.
- **Refresh tokens** opaques (256 bits), stockés hachés (SHA-256), à usage unique. Le rejeu d'un jeton consommé révoque toute la session.
- **OTP** à 6 chiffres, HMAC-SHA256 avec un *pepper* secret, 10 min, 5 essais comptés atomiquement, usage unique, renvoi limité (3, avec délai).
- **Anti-énumération** : l'inscription et le mot de passe oublié répondent de façon identique, que l'identifiant existe ou non (défi leurre invérifiable). Pour un identifiant inconnu, le hachage factice garde un temps de réponse comparable.
- **Verrouillage** après N échecs (configurable), journalisé.
- **Journal d'audit append-only** garanti par un trigger PostgreSQL.
- **Contraintes en base** (CHECK, UNIQUE, citext) en plus de la validation applicative.
- **Configuration validée au démarrage** ; refus de démarrer en production avec des secrets faibles ou le fournisseur OTP « console ».
- **Journaux** sans corps de requête ; `authorization` et `cookie` masqués.

## 5. Données et migrations

- Migrations SQL **forward-only**, numérotées, appliquées dans une transaction chacune, sous verrou consultatif (plusieurs instances peuvent démarrer en même temps). Un checksum empêche de modifier une migration déjà appliquée.
- `apps/api/src/db/schema.ts` est le miroir typé des migrations : à tenir synchronisé à chaque migration.
- Multi-tenant (lot 2) : `org_id` sur les tables métier, contrôlé dans les services ; RLS PostgreSQL à évaluer.
- Production : PostgreSQL managé **avec PostGIS**, sauvegardes chiffrées et test de restauration périodique (procédure à rédiger avec le choix de l'hébergeur).

## 6. Temps réel, fichiers, tâches asynchrones (planifié)

- **Socket.IO** sur le même processus NestJS, authentifié par le jeton d'accès ; adaptateur Redis lorsqu'il y aura plusieurs instances.
- **Fichiers** : stockage S3-compatible (MinIO en local, fournisseur à choisir en production), URLs signées, analyse de type, limite de taille.
- **Tâches** : outbox PostgreSQL et worker. Redis + BullMQ seulement quand le volume l'exige.
- **Appels** : WebRTC ; TURN (coturn) et SFU (LiveKit) à héberger, ce qui a un coût et demande une décision.

## 7. Environnements et déploiement

| Env | Base | OTP | Paiements |
|---|---|---|---|
| dev | `npm run db:dev` (embarqué) | console (log) | aucun |
| test | PostgreSQL embarqué, une base par fichier de test | capture en mémoire | aucun |
| staging | PostgreSQL managé + PostGIS | fournisseur réel en sandbox | sandbox partenaire |
| prod | idem, sauvegardes et PITR | fournisseur réel | partenaire agréé uniquement |

Le conteneur Docker et la CI (lint, typecheck, tests, audit des dépendances) sont reportés au lot 1c. Docker n'est pas installé localement, donc le Dockerfile ne pourra pas être testé sur cette machine.

Variables ajoutées au lot 1b (validées au démarrage, voir `apps/api/.env.example`) :

| Variable | Défaut | Effet |
|---|---|---|
| `MAINTENANCE_ENABLED` | `true` | `false` : ni nettoyage horaire ni exécution au démarrage sur cette instance (les tests le désactivent) |
| `ACCOUNT_DELETION_GRACE_DAYS` | `30` (1 à 365) | Délai entre la demande de suppression et l'anonymisation ; une connexion pendant ce délai annule la demande |
