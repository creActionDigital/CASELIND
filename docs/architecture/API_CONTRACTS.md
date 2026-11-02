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
| 413 | `payload_too_large` (`details.maxBytes`) |
| 415 | `unsupported_media_type` (`details.reason`) |
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

## Lot 2a — Organisations (implémenté et testé)

Commerces et établissements (`kind` : shop, restaurant, hotel, pharmacy, school, hospital, services, warehouse, other), membres avec rôle par organisation (owner, admin, manager, finance, stock, sales, hr, support, delivery, employee) et page vitrine publique. Schémas : `packages/contracts/src/orgs.ts` ; permissions par rôle : `apps/api/src/orgs/org-permissions.ts`.

Routes `/orgs/:orgId…` : identifiant mal formé, organisation inconnue ou appelant non membre **actif** (invitations en attente comprises) → 404 (une organisation privée n'est jamais révélée) ; rôle sans la permission → 403 `forbidden` ; organisation `suspended` → 403 pour tout sauf la lecture (GET) par un propriétaire.

| Méthode | Route | Accès | Corps → Réponse |
|---|---|---|---|
| POST | `/orgs` | auth | `{slug (3–40, a-z 0-9 -, mis en minuscules, mots réservés refusés), name, kind, description?, country?, city?, address?, phone? (E.164), email?, website? (https uniquement), openingHours?, visibility? (public par défaut)}` → **201** `Org` ; le créateur devient propriétaire actif ; slug pris (insensible à la casse) → 409 `details {field:'slug'}` ; plus de 10 organisations possédées → 409 `details {reason:'owner_limit', limit:10}` ; audité |
| GET | `/orgs/:orgId` | membre (`org.view`) | → `Org` |
| PATCH | `/orgs/:orgId` | `org.profile.edit` | sous-ensemble non vide de `{name, kind, description, country, city, address, phone, email, website, openingHours, visibility}` (`null` efface) → `Org` ; slug, statut, vérification, logo et bannière non modifiables ici ; audité |
| GET | `/orgs/:orgId/members` | `org.members.view` | `?limit (1–100, défaut 20)&cursor&status (invited \| active)` → `{items: OrgMember[], nextCursor}` (plus anciens d'abord) |
| POST | `/orgs/:orgId/invitations` | `org.members.manage` | `{handle, role}` → **201** `OrgMember` (`status: invited`) ; rôle owner/admin → `org.admins.manage` requis (403) ; handle inconnu, compte non actif ou blocage dans un sens ou l'autre avec l'invitant → même 404 ; déjà membre ou invité → 409 `details {reason:'already_member'}` ; audité |
| PATCH | `/orgs/:orgId/members/:userId` | `org.members.manage` | `{role}` → `OrgMember` ; si l'ancien ou le nouveau rôle est owner/admin → `org.admins.manage` requis (403) ; rétrograder le dernier propriétaire actif → 409 `details {reason:'last_owner'}` ; audité |
| DELETE | `/orgs/:orgId/members/:userId` | membre | → **204** ; son propre identifiant = quitter ; sinon `org.members.manage` (+ `org.admins.manage` pour un owner/admin) ; annule aussi une invitation ; dernier propriétaire actif → 409 `last_owner` ; audité |
| GET | `/me/orgs` | auth | → `{items: MyOrgMembership[]}` `{org: OrgSummary, role, status, invitedBy, createdAt, joinedAt}`, invitations en attente comprises |
| POST | `/me/org-invitations/:orgId/accept` | auth | → `MyOrgMembership` ; pas d'invitation en attente → 404 ; organisation suspendue → 403 ; invitation owner soumise au quota de 10 ; audité |
| POST | `/me/org-invitations/:orgId/decline` | auth | → **204** (supprime l'invitation) ; audité |
| GET | `/public/orgs/:slug` | **public** | → `PublicOrg` (champs publics + `verified`) ; organisation privée, suspendue ou inconnue → 404 |

`openingHours` = `{mon?…sun?: [{open:"HH:MM", close:"HH:MM"}]}` : au plus 4 plages par jour, triées, sans chevauchement, `open < close` ; `close` peut valoir `24:00` ; une nuit qui passe minuit s'écrit en deux plages. Journal d'audit : `org.created`, `org.updated`, `org.member_invited`, `org.invitation_accepted`, `org.invitation_declined`, `org.member_role_changed`, `org.member_removed` (`metadata.orgId` toujours renseigné).

## Lot 2b — Médias (implémenté et testé)

Envoi en deux temps : annonce (JSON), puis octets bruts. Le type réel est détecté sur les premiers octets (signatures binaires), jamais déduit de l'en-tête ou de l'extension : SVG, HTML, XML, exécutables, archives, HEIC, QuickTime… sont refusés (CDC §29).

| Méthode | Route | Accès | Corps → Réponse |
|---|---|---|---|
| POST | `/media/uploads` | auth | `{purpose, mime, sizeBytes}` → **201** `{assetId, uploadUrl, uploadToken, expiresAt (15 min), maxBytes}` ; type non admis pour l'usage ou taille au-delà de la limite → 400 `validation_failed` (`details[0].maxBytes`) ; `maxBytes` = `sizeBytes` annoncé ; quotas par utilisateur dépassés → 409 `conflict` `{reason: 'quota_exceeded', quota: 'pending_uploads' | 'bytes', limit}` (`MEDIA_MAX_PENDING_PER_USER` envois non terminés `pending`+`rejected`, défaut 20 ; `MEDIA_QUOTA_BYTES_PER_USER` octets `ready` + tailles annoncées `pending`, défaut 1 Gio) |
| POST | `/media/uploads/:id/token` | auth (propriétaire) | → **200** même forme que la réponse d'annonce, nouveau jeton de 15 min ; média d'un autre → 404 ; plus `pending` → 409 |
| PUT | `/media/uploads/:id/content` | auth (propriétaire) + en-tête `X-Upload-Token` | octets bruts, `Content-Type: application/octet-stream` (ou le type du fichier) → `MediaAsset` (`ready`) ; jeton absent, faux, expiré ou d'un autre média → 403 `forbidden` ; média d'un autre → 404 ; déjà `ready`/`rejected` → 409 ; au-delà de `maxBytes` (taille annoncée) → 413 `payload_too_large` ; échec d'écriture disque → 500, média laissé `pending` ; type refusé ou différent du type annoncé → 415 `unsupported_media_type` (`details.reason` : `unsupported_type`, `type_mismatch`, `unsupported_content_type`) ; 413 et 415 (sauf `unsupported_content_type`) passent le média en `rejected` et suppriment le fichier |
| GET | `/media/:id` | auth | propriétaire → `MediaAsset` (tous les états) ; les autres → vue réduite `{id, purpose, mime, sizeBytes, contentUrl, createdAt}` des seuls médias `ready` qu'ils ont le droit de lire, 404 sinon |
| GET | `/media/:id/content` | auth | → octets, `Content-Type` détecté, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` pour les PDF et `inline` sinon, `Cache-Control: private`, `ETag` = sha256, CSP `sandbox` ; non `ready` ou non autorisé → 404 |
| DELETE | `/media/:id` | auth (propriétaire) | → **204** ; supprime le fichier ; vide l'avatar s'il l'utilisait ; audité |
| PATCH | `/me/avatar` | auth | `{assetId}` (média `ready`, usage `avatar`, à soi ; sinon 400, ou 404 s'il n'est pas à soi) ou `{assetId: null}` → `Me` ; `avatarUrl` = `/v1/media/{id}/content` ; audité |

`MediaAsset` = `{id, ownerId, purpose, status (pending | ready | rejected), declaredMime, mime (détecté, null avant réception), sizeBytes, sha256, contentUrl, createdAt, uploadedAt, rejectedReason}`.

Limitation de débit dédiée (`MEDIA_RATE_LIMIT_PER_MINUTE`, défaut 30) sur l'annonce, l'envoi des octets et la réémission de jeton, comptée par client et par route → 429 `rate_limited`.

Types admis par usage (`MEDIA_ALLOWED_MIMES` dans les contrats) : images `image/jpeg|png|webp|gif` pour `avatar`, `org_logo`, `org_banner`, `product`, `post`, `story`, `message` ; vidéo `video/mp4|webm` pour `post`, `story`, `message` ; audio `audio/mp4|ogg|mpeg` pour `message` ; `application/pdf` pour `document` et `message`. Un MP4 audio annoncé `audio/mp4` mais portant une marque ISO générique est accepté comme `audio/mp4`. Limites par nature (configurables) : images 10 Mio, vidéo 100 Mio, audio 20 Mio, PDF 20 Mio.

Lecture (`canRead`, `apps/api/src/media/access.ts`) : `avatar`, `org_logo`, `org_banner`, `product`, `post`, `story` lisibles par tout utilisateur connecté ; `message` et `document` par le propriétaire seulement (le lot messagerie ouvrira l'accès aux participants de la conversation).

Stockage : interface `MediaStorage` avec un seul adaptateur, disque local (`MEDIA_STORAGE_DIR`, défaut `apps/api/.data/media`). Le fournisseur de stockage objet n'est pas choisi (décision Q6 du BACKLOG) : l'adaptateur S3-compatible et le CDN viendront après cette décision, sans service payant activé sans accord (CDC §40.9). Les envois sont toujours vérifiés sur disque local avant d'être confiés au stockage. La maintenance horaire supprime les envois non terminés (`pending`) ou refusés (`rejected`) de plus de 24 h et leurs fichiers temporaires (`staleUploads`). Journal d'audit : `media.uploaded`, `media.rejected`, `media.deleted`, `user.avatar_updated` (`metadata.assetId`).

**Côté clients** : le contenu exige le jeton d'accès ; une balise `<img>` web ne peut pas l'envoyer, il faut donc télécharger avec `fetch` + en-tête `Authorization` puis afficher un blob (des URL signées CDN viendront avec le stockage objet).

## Lots suivants — contrats prévus (non implémentés)

Les routes sont listées dans [WECHAT_FUNCTIONAL_MAP.md](../reverse-engineering/WECHAT_FUNCTIONAL_MAP.md), colonne « API & données ». Chacune sera ajoutée ici au moment de son implémentation, avec son schéma dans `packages/contracts`.
