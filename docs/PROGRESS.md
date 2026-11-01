# Suivi d'avancement CASELIND

## 2026-11-01 — Lot backend 1b (compléments identité)

### Exécution
- Plan suivi : [plans/LOT_1B_PLAN.md](plans/LOT_1B_PLAN.md) (phase 0 de vérification des API installées, puis phases 1 à 6).
- Chaque phase a été confiée à plusieurs sous-agents en parallèle. Conséquence : les migrations sont réparties sur trois fichiers (0002, 0003, 0004) au lieu d'un seul 0002 prévu.
- Une revue de code a relevé **1 point moyen** et **4 points faibles**. Tous ont été corrigés, chacun avec un test.
  - Moyen : TOCTOU sur la confirmation des flags réglementés. Deux mises à jour concurrentes pouvaient laisser un flag réglementé actif avec une portée que personne n'avait confirmée. Correction : lecture, décision, écriture et audit dans une seule transaction, ligne verrouillée (`SELECT … FOR UPDATE`).
  - Le test de concurrence (`flags.e2e.test.ts`, dernier test) ordonne deux requêtes derrière un verrou tenu par le test. Il **échoue sans le verrou de ligne** et passe avec.

### Réalisé
| Élément | Fichiers |
|---|---|
| Feature flags par pays et par rôle : table, 8 flags réglementés coupés par défaut, `social.stories` et `messaging` actifs ; une clé inconnue vaut `false` | `apps/api/migrations/0002_platform_controls.sql`, `apps/api/src/flags/flags.service.ts` |
| `GET /v1/config/flags` (flags évalués pour le pays et les rôles lus en base) ; `GET /v1/admin/flags`, `PUT /v1/admin/flags/:key` (admin, audité `admin.flag_updated`). Activer un flag réglementé, ou changer sa portée (pays, rôles) quand il est actif, exige `confirmRegulated: true`, sinon 409 | `apps/api/src/flags/flags.controller.ts` |
| Décorateur `@RequireFlag(key)` et garde globale placée après `AuthGuard` : 403 `feature_disabled` | `apps/api/src/flags/flag.guard.ts` |
| Confidentialité : `GET/PATCH /v1/me/privacy` (introuvable par téléphone et par e-mail par défaut, demandes de contact `everyone`, accusés de lecture actifs), audité | `apps/api/migrations/0003_privacy_blocks.sql`, `apps/api/src/privacy/*` |
| Blocages : `GET /v1/blocks` (pagination par curseur opaque, 50 par défaut, 200 max), `PUT` et `DELETE /v1/blocks/:userId` (idempotents, 204). S'auto-bloquer → 400 ; id inconnu, inactif ou mal formé → 404. Le profil public est masqué dans les deux sens. `PrivacyService.isBlockedEitherWay` est prêt pour la messagerie | idem |
| Export : `GET /v1/me/export` (profil, confidentialité, sessions, blocages, événements de sécurité ; colonnes choisies une à une, sans hash ni jeton), audité `user.data_exported` | `apps/api/src/account/*` |
| Suppression : `POST /v1/me/deletion-request { password }` → 202 avec la date prévue ; toutes les sessions sont révoquées et le profil public est masqué. Une connexion pendant le délai de grâce annule la demande (`auth.deletion_cancelled`). Après le délai, la connexion est refusée (403 `account_suspended`), même si la purge n'est pas encore passée | `apps/api/migrations/0004_account_deletion.sql`, `apps/api/src/account/*`, `apps/api/src/auth/auth.service.ts` |
| Nettoyage planifié toutes les heures (`@nestjs/schedule`) et une première fois 60 s après le démarrage ; verrou consultatif entre instances. Il supprime les OTP expirés depuis plus de 24 h, les refresh tokens expirés ou utilisés depuis plus de 7 j, les sessions révoquées ou expirées depuis plus de 30 j. Il anonymise les comptes dont le délai est passé : identifiants libérés, `handle` `deleted_<12 hex>`, mot de passe inutilisable, sessions, OTP et blocages supprimés. L'audit est conservé et la purge ajoute `user.deleted` | `apps/api/src/maintenance/maintenance.service.ts` |
| OpenAPI 3.1 généré depuis les contrats Zod : `GET /v1/openapi.json` (public, sans throttle) ; registre de 27 opérations | `apps/api/src/openapi/*` |
| Contrats partagés | `packages/contracts/src/{flags,privacy,account}.ts` |
| Configuration : `MAINTENANCE_ENABLED` (défaut `true`), `ACCOUNT_DELETION_GRACE_DAYS` (défaut 30, de 1 à 365) | `apps/api/src/config/env.ts`, `apps/api/.env.example` |

### Tests réellement exécutés (2026-11-01)
- `npm test -w @caselind/api` : **11 fichiers, 82 tests, 82 réussis** (≈ 43 s), contre PostgreSQL 18.6 embarqué réel. Les 39 tests du lot 1 en font partie et restent verts.
  - `test/flags.e2e.test.ts` (11) : authentification requise, flags réglementés coupés, restriction par pays (un utilisateur sans pays est exclu), restriction par rôle lu en base, clé inconnue → false, 403 pour un non-admin, liste admin, `confirmRegulated` exigé pour activer un flag réglementé et pour changer la portée d'un flag réglementé déjà actif, audit, 404/400, test de concurrence.
  - `test/flag-guard.e2e.test.ts` (4) : `@RequireFlag` sur une route de test (pays autorisé, pays exclu → 403, flag coupé → 403, 401 avant 403).
  - `src/flags/flag.guard.test.ts` (6) : garde et évaluation pure (unitaires).
  - `test/privacy.e2e.test.ts` (9) : valeurs par défaut, mise à jour partielle auditée, profil masqué dans les deux sens, idempotence, 400/404, audit côté bloqueur seulement, cascade à la suppression, pagination, cible supprimée pendant le blocage → 404.
  - `test/account.e2e.test.ts` (6) : export sans secret, authentification requise, mauvais mot de passe → 401 sans effet, demande de suppression (sessions révoquées, profil masqué, reconnexion qui annule), connexion refusée après le délai, purge (anonymisation, e-mail libéré, audit conservé).
  - `test/maintenance.e2e.test.ts` (2) : seules les lignes périmées disparaissent, idempotence ; exécution sautée quand le verrou est tenu.
  - `test/openapi.e2e.test.ts` (5) : document 3.1 public avec le schéma d'inscription, **exhaustivité dans les deux sens** (routes montées = registre), bearer exigé sur toute route non publique, paramètres de requête, aucun secret.
  - Lot 1, inchangés : `test/auth.e2e.test.ts` (18), `test/users.e2e.test.ts` (6), `test/platform.e2e.test.ts` (7), `src/config/env.test.ts` (8, dont 4 cas `it.each`).

### Non fait / limites
- Aucun commit Git (en attente de votre accord).
- OpenAPI : les erreurs sont décrites par une réponse `default` générique (enveloppe `ApiError`), pas par code d'erreur ni par statut.
- `FlagsService` lit la base à chaque évaluation, sans cache. Un changement admin prend effet immédiatement, mais chaque route protégée coûte une requête.
- La première exécution du nettoyage au démarrage (60 s) et l'`@Interval` horaire ne sont pas couverts par un test automatisé. Les tests désactivent la planification et appellent `runOnce` directement.
- `@RequireFlag` n'est posé sur aucune route de production pour l'instant (seulement sur une route de test). Il servira aux modules des lots suivants.
- Les réglages `discoverable_by_phone`, `discoverable_by_email`, `contact_requests_from` et `read_receipts` sont stockés et modifiables, **mais pas encore appliqués** : il n'existe encore ni recherche ni messagerie. Ils le seront aux lots messagerie (3) et recherche (7). Il en va de même pour le blocage, appliqué aujourd'hui au profil public seulement.
- Suppression : après le délai de grâce, la connexion est refusée avec `account_suspended`. Il n'y a pas de code d'erreur dédié.
- Reportés au lot 1c : 2FA TOTP, changement d'identifiant, connexion web par QR, Dockerfile + CI, cache Redis.

### Prochaine étape
Lot 2 (organisations et médias), puis lot 3 (messagerie et notifications). Le mobile Expo démarre ensuite.

## 2026-11-01 — Audit initial + lot backend 1 (Identité)

### Audit : ce qui a été réellement inspecté
- `E:\CASELIND` : seul `CASELIND_CAHIER_DES_CHARGES_DEFINITIF.md` existait (643 lignes, lu en entier). Pas de dépôt Git, pas de code, **aucune source SaaS**.
- Outillage machine : Node 26.13, npm 11.15, Python 3.14 ; **absents** : pnpm, Docker, PostgreSQL.
- Skills : `reverse-engineer-anything` (REA) présent comme skill, **mais aucun serveur MCP ni CLI REA**. replica-skill et Agent-Reach : **non installés**. graphify, frontend-design, ui-ux-pro-max : présents (utiles pour les phases UI). MCP Playwright : déclaré.
- WeChat : cartographie établie à partir de 3 recherches web et de la documentation officielle Tencent/Weixin. **Aucun écran observé directement.** Détails et limites : [EVIDENCE_AND_GAPS.md](reverse-engineering/EVIDENCE_AND_GAPS.md).

### Réalisé
| Élément | Fichiers |
|---|---|
| Git initialisé (aucun commit créé) | `.gitignore` |
| Monorepo npm workspaces, TypeScript strict | `package.json`, `tsconfig.base.json` |
| Contrats partagés Zod (auth, users, erreurs, pagination) | `packages/contracts/src/*` |
| Migration 0001 : users, sessions, refresh_tokens, otp_challenges, audit_events (trigger append-only), contraintes CHECK/UNIQUE | `apps/api/migrations/0001_identity.sql` |
| Migrateur versionné (transaction, verrou, checksum) | `apps/api/src/db/migrator.ts` |
| Socle API : config validée, erreurs uniformes, request-id, journaux pino masqués, helmet, CORS, rate limit global + auth | `apps/api/src/{config,common,bootstrap.ts,app.module.ts}` |
| Sécurité : Argon2id, JWT + refresh à rotation, garde globale (session, statut et rôles vérifiés en base), RBAC | `apps/api/src/security/*` |
| Auth : register, OTP verify/resend, login + verrouillage, refresh, logout, sessions, mot de passe oublié/réinitialisation | `apps/api/src/auth/*` |
| Users : /me, PATCH /me, /me/security-events, /users/:handle ; admin : /admin/audit-events | `apps/api/src/{users,admin}/*` |
| Scripts dev : BD embarquée persistante, boucle watch | `apps/api/scripts/*`, `apps/api/.env.example` |
| Docs : cartographie WeChat et matrice (96 lignes), écrans, parcours, preuves, architecture, contrats, ADR, backlog, registre SaaS | `docs/**` |

### Tests réellement exécutés (2026-11-01)
- `npx tsc --noEmit` (src + tests) : **0 erreur**.
- `npm test -w @caselind/api` : **4 fichiers, 39 tests, 39 réussis** (≈ 17 s), contre un **PostgreSQL 18.6 réel** (embarqué), une base migrée par fichier de test.
  - `test/auth.e2e.test.ts` (18) : inscription e-mail et téléphone, validation, anti-énumération (inscription et mot de passe oublié), OTP faux / épuisé / usage unique / renvoi, connexion non vérifiée, 401 identiques, verrouillage après 5 échecs, compte suspendu (sessions coupées), jetons falsifiés, rotation + rejeu → session révoquée, liste et révocation des sessions (y compris la tentative sur la session d'autrui → 404), logout, réinitialisation du mot de passe (sessions révoquées), code d'inscription refusé pour la réinitialisation.
  - `test/users.e2e.test.ts` (6) : mise à jour du profil, conflit de @handle insensible à la casse, champs hors contrat ignorés (pas d'escalade de rôle), profil public limité et masqué si suspendu, journal de sécurité sans secrets, RBAC admin (403 puis 200, rôle lu en base).
  - `test/platform.e2e.test.ts` (7) : health, en-têtes de sécurité et request-id, 404 dans l'enveloppe d'erreur, **429 sur /auth** avec /health toujours disponible, audit append-only (UPDATE/DELETE refusés par la BD), migrations idempotentes et checksum, contraintes BD.
  - `src/config/env.test.ts` (8) : validation de config (secrets faibles, OTP console refusé en production), génération de @handle, format des codes OTP.
- **Contrôle par mutation** : en retirant la condition `used_at IS NULL` de la rotation des refresh tokens, le test de rejeu échoue (1 échec sur 18), puis repasse une fois le code restauré.
- **Démarrage réel** du build compilé (`node dist/main.js`) sur la BD de dev : migration appliquée, `GET /v1/health` → 200, `POST /v1/auth/register` → 202, connexion non vérifiée → 403 `account_not_verified`. Vérifié que le mot de passe et l'en-tête Authorization n'apparaissent pas dans le log.

### Non fait / limites
- Aucun commit Git (en attente de votre accord).
- Pas d'OpenAPI généré, pas de Dockerfile, pas de CI (lot 1b). Docker n'est pas installé, donc un Dockerfile ne serait pas testable ici.
- Aucun envoi réel de SMS ni d'e-mail : fournisseur à choisir (Q2).
- Pas de test de charge ni de scan de sécurité outillé ; `npm audit` : 0 vulnérabilité au moment de l'installation.
- Mobile et web : non commencés, conformément à l'ordre imposé.

### Prochaine étape
Lot 1b (feature flags par pays, confidentialité et blocages, OpenAPI, nettoyage planifié), puis les lots 2 et 3 (organisations, médias, messagerie, notifications). Ce socle permet ensuite de démarrer le mobile Expo : auth, accueil, messagerie.
