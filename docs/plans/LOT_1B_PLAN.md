# Plan — Lot backend 1b (compléments identité)

> **Statut d'exécution (2026-11-01) :** fait, **testé** (82 tests sur 11 fichiers, voir [PROGRESS.md](../PROGRESS.md)), sans commit. Écart au plan : les migrations sont réparties en `0002_platform_controls.sql` (flags), `0003_privacy_blocks.sql` (confidentialité et blocages) et `0004_account_deletion.sql` (suppression), au lieu d'un seul fichier 0002, car les phases ont été menées en parallèle. Autres écarts mineurs : un flag réglementé sans confirmation renvoie 409, et la confirmation est aussi exigée pour élargir la portée d'un flag actif (ADR-013) ; le `handle` anonymisé compte 12 caractères hexadécimaux au lieu de 8.

## Primary goal

Un utilisateur CASELIND contrôle qui peut le trouver et le contacter, peut bloquer quelqu'un, exporter ses données et demander la suppression de son compte. L'équipe peut activer ou désactiver chaque module selon le pays et le rôle : les modules réglementés sont coupés par défaut. Les développeurs mobile et web disposent d'une spécification OpenAPI à jour, et la base ne grossit pas de données d'authentification périmées.

Contrainte : **aucun commit Git** (pas encore autorisé).

---

## Phase 0 — Découverte de la documentation et des API (faite le 2026-11-01)

**How this serves the primary goal:** évite d'inventer des API qui n'existent pas dans les versions installées (NestJS 12, Zod 4, TypeScript 7).

Sources vérifiées et API autorisées :

| Besoin | API vérifiée | Preuve |
|---|---|---|
| JSON Schema depuis les contrats | `z.toJSONSchema(schema, { io: 'input' })` (Zod 4.6.7) | Exécuté localement : renvoie un schéma draft 2020-12 |
| Tâches planifiées | `@nestjs/schedule` 12.0.2 : `ScheduleModule.forRoot()`, décorateur `@Interval(name, ms)` | `npm view` : peer `@nestjs/core ^11 \|\| ^12` |
| Patterns internes à copier | Contrôleur + `ZodPipe` : `apps/api/src/users/users.controller.ts` ; service Drizzle : `apps/api/src/users/users.service.ts` ; garde et décorateurs de métadonnées : `apps/api/src/security/auth.guard.ts` ; audit : `apps/api/src/audit/audit.service.ts` ; migration : `apps/api/migrations/0001_identity.sql` ; tests : `apps/api/test/helpers.ts`, `test/users.e2e.test.ts` | Code du lot 1 (39 tests verts) |

**Anti-patterns :**
- **Ne pas** installer `@nestjs/swagger` : il exige TypeScript 5/6 (le projet est en TS 7) et class-validator.
- Ne pas modifier `0001_identity.sql` : ajouter `0002_*.sql`.
- Ne pas contourner `ZodPipe` ni lire les rôles depuis le JWT.

---

## Phase 1 — Feature flags par pays et par rôle

**How this serves the primary goal:** permet d'activer chaque module là où il est autorisé et garantit que les modules réglementés restent coupés tant qu'ils ne sont pas validés (CDC §21, §26).

- Migration `0002_platform_controls.sql` : table `feature_flags`.
  - Colonnes : `key` PK (motif `^[a-z0-9_.]+$`), `description`, `enabled` bool, `regulated` bool, `allowed_countries` char(2)[] NULL (NULL = tous), `allowed_roles` text[] NULL, `updated_at`, `updated_by`.
  - Seeds `regulated=true, enabled=false` : `wallet.real_money`, `wallet.p2p_transfer`, `gifts.red_packets`, `csl_coins`, `betting`, `trading.live`, `health.teleconsultation`, `health.prescriptions`.
  - Seeds `enabled=true` : `social.stories`, `messaging`.
- `FlagsService.evaluate(key, {country, roles})` et `evaluateAll(...)`. Une clé inconnue vaut `false`.
- `GET /v1/config/flags` (auth) renvoie `{ flags: Record<string, boolean> }` pour le pays et les rôles de l'utilisateur.
- `GET /v1/admin/flags` et `PUT /v1/admin/flags/:key` (`@Roles('admin')`), audités (`admin.flag_updated`). Activer un flag `regulated` exige `confirmRegulated: true` dans le corps.
- Décorateur `@RequireFlag(key)` lu par la garde : 403 `feature_disabled` si le flag est inactif.
- Contrats dans `packages/contracts/src/flags.ts`.

**Vérification :** tests e2e sur la restriction par pays, par rôle, la clé inconnue (false), un 403 admin pour un non-admin, un flag réglementé non activable sans confirmation, et l'écriture d'un événement d'audit.

---

## Phase 2 — Confidentialité et blocages

**How this serves the primary goal:** l'utilisateur décide qui le trouve et qui le contacte (cartographie A-10, A-11).

- Migration (même fichier 0002) : colonnes `users.discoverable_by_phone` bool (défaut false), `discoverable_by_email` (false), `contact_requests_from` text (`everyone` | `contacts_of_contacts` | `nobody`, défaut `everyone`), `read_receipts` bool (true).
- Migration : table `user_blocks(blocker_id, blocked_id, created_at)` avec PK composite, `CHECK blocker_id <> blocked_id` et FK en `ON DELETE CASCADE`.
- `GET/PATCH /v1/me/privacy`.
- `GET /v1/blocks`, `PUT /v1/blocks/:userId` (idempotent, 204), `DELETE /v1/blocks/:userId` (204). Se bloquer soi-même → 400. Utilisateur inconnu → 404.
- `GET /v1/users/:handle` renvoie 404 si l'un des deux a bloqué l'autre.
- Méthode `PrivacyService.isBlockedEitherWay(a, b)`, réutilisable par la messagerie du lot 3.

**Vérification :** tests sur la valeur par défaut, la mise à jour, le blocage et le profil masqué dans les deux sens, l'idempotence et l'auto-blocage.

---

## Phase 3 — Export et suppression de compte

**How this serves the primary goal:** droit d'accès et d'effacement (CDC §4, §29).

- Migration : `users.deletion_requested_at timestamptz`.
- `GET /v1/me/export` : JSON avec profil, confidentialité, sessions, blocages et événements de sécurité, sans hash ni jeton. Audité (`user.data_exported`).
- `POST /v1/me/deletion-request { password }` : vérifie le mot de passe, pose `deletion_requested_at`, révoque toutes les sessions et audite. Le profil public renvoie alors 404.
- Pendant le délai de grâce (`ACCOUNT_DELETION_GRACE_DAYS`, défaut 30), une connexion réussie annule la demande (`auth.deletion_cancelled`). C'est le comportement le plus courant et il est réversible ; il est documenté comme décision.
- Après le délai, la purge (Phase 5) anonymise le compte :
  - `status='deleted'` ;
  - e-mail et téléphone à NULL ;
  - `handle='deleted_<8 caractères d'id>'`, nom affiché `Compte supprimé` ;
  - bio et avatar à NULL ;
  - hash de mot de passe inutilisable ;
  - sessions supprimées.

  L'audit est conservé (append-only), avec une référence à l'id seulement.
- La contrainte `users_identifier_required` doit accepter `status='deleted'`. **Une contrainte ne se modifie pas en place** : ajouter un DROP puis un ADD de la contrainte dans 0002.

**Vérification :** l'export ne contient ni « argon2 » ni jeton ; un mauvais mot de passe donne 401 ; après la demande, les sessions sont révoquées ; une reconnexion annule ; la purge forcée (horloge passée) anonymise et libère l'e-mail.

---

## Phase 4 — OpenAPI généré depuis les contrats Zod

**How this serves the primary goal:** les apps mobile et web consomment un contrat lisible et exact.

- `apps/api/src/openapi/registry.ts` : liste déclarative `{ method, path, summary, auth, body?, query?, response?, status }` qui référence les schémas de `@caselind/contracts`.
- `buildOpenApiDocument()` produit un document OpenAPI 3.1 via `z.toJSONSchema(..., { io: 'input' })` pour les entrées et `io: 'output'` pour les sorties.
- `GET /v1/openapi.json` (public, sans throttle).
- Test d'exhaustivité : chaque route NestJS réellement montée (via `app.getHttpAdapter().getInstance()._router` ou `DiscoveryService` et `MetadataScanner`, à vérifier dans le code de `@nestjs/core` installé avant usage) doit figurer dans le registre, et inversement.

**Vérification :** le test d'exhaustivité passe ; le document a `openapi: '3.1.0'` ; la route register expose un schéma de requête.

---

## Phase 5 — Nettoyage planifié

**How this serves the primary goal:** borne la croissance des données sensibles périmées et exécute les suppressions dues.

- Installer `@nestjs/schedule@12.0.2`, puis `ScheduleModule.forRoot()` dans `AppModule`.
- `MaintenanceService.runOnce(now = new Date())` :
  - supprime les `otp_challenges` expirés depuis plus de 24 h ;
  - supprime les `refresh_tokens` expirés ou utilisés depuis plus de 7 jours ;
  - supprime les `sessions` révoquées ou expirées depuis plus de 30 jours ;
  - purge les comptes dont le délai de suppression est passé ;
  - renvoie les compteurs.
- `@Interval('maintenance', 3_600_000)`, désactivable par `MAINTENANCE_ENABLED=false` (désactivé dans les tests).
- Le verrou consultatif `pg_try_advisory_lock` évite une exécution concurrente entre instances.

**Vérification :** test qui crée des lignes périmées et récentes, appelle `runOnce`, et constate que seules les périmées disparaissent.

---

## Phase 6 — Vérification finale

**How this serves the primary goal:** prouve que tout ce qui précède fonctionne, sans régression du lot 1.

- `npm run typecheck` (racine) : 0 erreur.
- `npm test -w @caselind/api` : tous les tests verts, les 39 du lot 1 compris.
- grep : aucun `@nestjs/swagger`, aucune modification de `0001_identity.sql` (vérifiée par le checksum du test de migration).
- Mise à jour de `docs/PROGRESS.md`, `docs/BACKLOG.md`, `docs/architecture/API_CONTRACTS.md` et des états A-10, A-11, A-15, I-15 dans `WECHAT_FUNCTIONAL_MAP.md`.
- Pas de commit.

## Hors périmètre de ce lot (reporté au backlog)

2FA TOTP · changement d'identifiant · connexion web par QR · Dockerfile et CI · cache Redis.
