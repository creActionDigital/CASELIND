# Contrats d'API CASELIND — v1

Dernière mise à jour : 2026-11-01. Source de vérité : schémas Zod de [`packages/contracts/src`](../../packages/contracts/src). Ce document en est la lecture humaine.

**Source lisible par machine : `GET /v1/openapi.json`** (public, sans limitation de débit). Document OpenAPI 3.1.0 généré (à la première requête, puis mis en cache) depuis ces mêmes schémas Zod (`z.toJSONSchema`, entrées en `io: 'input'`, réponses en `io: 'output'`) à partir du registre [`apps/api/src/openapi/registry.ts`](../../apps/api/src/openapi/registry.ts). Le test `apps/api/test/openapi.e2e.test.ts` échoue si une route montée manque au registre ou inversement : toute nouvelle route doit y être déclarée. Les clients mobile et web peuvent générer leurs types depuis ce document.

## Conventions

- Base : `/v1`. JSON uniquement (corps ≤ 100 ko). Horodatages ISO 8601 UTC.
- Authentification : `Authorization: Bearer <accessToken>` sur toutes les routes, sauf celles marquées **public**.
- Traçabilité : l'en-tête `x-request-id` est accepté s'il est valide, sinon généré. Il est renvoyé dans la réponse et dans les erreurs.
- Pagination : par curseur (`limit`, `cursor` → `nextCursor`).
- Erreurs : enveloppe unique ; `code` est stable, `message` peut changer.

```json
{ "error": { "code": "validation_failed", "message": "Request validation failed",
             "details": [{ "path": "identifier", "message": "..." }], "requestId": "…" } }
```

| HTTP | `code` |
|---|---|
| 400 | `validation_failed`, `otp_invalid` (`details.attemptsRemaining`) |
| 401 | `unauthenticated`, `invalid_credentials`, `refresh_token_invalid` |
| 403 | `forbidden`, `account_not_verified`, `account_suspended`, `feature_disabled` |
| 404 | `not_found` |
| 409 | `conflict` (`details.field`) |
| 410 | `otp_expired` |
| 423 | `account_locked` (`details.lockedUntil`) |
| 429 | `rate_limited`, `otp_resend_too_soon` (`details.retryAfterSeconds`) |
| 500/503 | `internal_error` (jamais de détail interne) |

## Lot 1 — Identité (implémenté et testé)

| Méthode | Route | Accès | Corps → Réponse |
|---|---|---|---|
| GET | `/health` | public | → `{status, db}` |
| GET | `/openapi.json` | public | → document OpenAPI 3.1 (lot 1b) |
| POST | `/auth/register` | public | `{identifier (E.164 ou e-mail), password (10–128), displayName, locale?, country?}` → **202** `{challengeId, channel, expiresAt}` (réponse identique si l'identifiant existe déjà) |
| POST | `/auth/otp/verify` | public | `{challengeId, code (6 chiffres), device?{name, platform}}` → `TokenPair` |
| POST | `/auth/otp/resend` | public | `{challengeId}` → **202** `ChallengeResponse` |
| POST | `/auth/login` | public | `{identifier, password, device?}` → `TokenPair` |
| POST | `/auth/refresh` | public | `{refreshToken}` → `TokenPair` (l'ancien jeton devient invalide) |
| POST | `/auth/logout` | auth | → **204** |
| GET | `/auth/sessions` | auth | → `{items: Session[]}` |
| DELETE | `/auth/sessions/:id` | auth | → **204** (404 si absente ou appartenant à un autre utilisateur) |
| POST | `/auth/password/forgot` | public | `{identifier}` → **202** `ChallengeResponse` (toujours) |
| POST | `/auth/password/reset` | public | `{challengeId, code, newPassword}` → **204** (révoque toutes les sessions) |
| GET | `/me` | auth | → `Me` |
| PATCH | `/me` | auth | `{displayName?, handle?, bio?, locale?, country?}` → `Me` (les champs hors contrat sont ignorés) |
| GET | `/me/security-events` | auth | → `{items: SecurityEvent[]}` (50 derniers) |
| GET | `/users/:handle` | auth | → `PublicProfile` (comptes actifs seulement) |
| GET | `/admin/audit-events` | rôle `admin` | `?limit&before&action&subjectUserId` → `{items, nextCursor}` |

`TokenPair` = `{accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, sessionId}`. Le jeton d'accès dure 15 min par défaut ; le refresh dure 30 jours, en fenêtre glissante.

**Côté mobile** : stocker le refresh token dans `expo-secure-store` uniquement (jamais AsyncStorage). Rafraîchir sur un 401 `unauthenticated` en sérialisant les rafraîchissements concurrents : un seul en vol, sinon le second déclencherait la détection de rejeu.

## Lot 1b — Flags, confidentialité, droits sur les données (implémenté et testé)

| Méthode | Route | Accès | Corps → Réponse |
|---|---|---|---|
| GET | `/config/flags` | auth | → `{flags: {[key]: boolean}}`, évalués côté serveur pour le pays et les rôles de l'appelant |
| GET | `/admin/flags` | rôle `admin` | → `{items: FeatureFlag[]}` |
| PUT | `/admin/flags/:key` | rôle `admin` | `{enabled?, allowedCountries?, allowedRoles?, description?, confirmRegulated?}` (au moins un champ à modifier) → `FeatureFlag` ; flag `regulated` laissé actif avec une nouvelle portée sans `confirmRegulated: true` → 409 `conflict` (`details.regulated`) ; audité |
| GET | `/me/privacy` | auth | → `PrivacySettings` `{discoverableByPhone, discoverableByEmail, contactRequestsFrom (everyone \| contacts_of_contacts \| nobody), readReceipts}` |
| PATCH | `/me/privacy` | auth | sous-ensemble non vide de `PrivacySettings` → `PrivacySettings` |
| GET | `/blocks` | auth | `?limit (1–200, défaut 50)&cursor` → `{items: BlockedUser[], nextCursor}` (plus récents d'abord) |
| PUT | `/blocks/:userId` | auth | → **204** idempotent ; 404 si l'identifiant est mal formé ou ne désigne pas un compte actif ; 400 `validation_failed` pour soi-même |
| DELETE | `/blocks/:userId` | auth | → **204** idempotent (mêmes 404) |
| GET | `/me/export` | auth | → `AccountExport` `{exportedAt, profile, privacy, sessions (révoquées comprises), blocks, securityEvents}` ; jamais de hash de mot de passe, de jeton ou d'OTP ; audité |
| POST | `/me/deletion-request` | auth | `{password}` → **202** `{deletionScheduledFor}` ; mot de passe faux → 401 `invalid_credentials` ; révoque toutes les sessions ; une reconnexion avant l'échéance (`ACCOUNT_DELETION_GRACE_DAYS`, 30 j par défaut) annule la suppression |

Une route protégée par un flag désactivé pour l'appelant répond 403 `feature_disabled`.

## Lots suivants — contrats prévus (non implémentés)

Les routes sont listées dans [WECHAT_FUNCTIONAL_MAP.md](../reverse-engineering/WECHAT_FUNCTIONAL_MAP.md), colonne « API & données ». Chacune sera ajoutée ici au moment de son implémentation, avec son schéma dans `packages/contracts`.
