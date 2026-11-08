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

## Lot 1c — Compléments d'identité (implémenté et testé)

| Méthode | Route | Accès | Corps → Réponse |
|---|---|---|---|
| POST | `/auth/login` | public | si 2FA active : **200** `{twoFactorRequired: true, challengeId}` sans jeton ; sinon `TokenPair` inchangé |
| POST | `/auth/2fa/verify` | public | `{challengeId, code | backupCode, device?}` → `TokenPair` (défi 5 min, 5 essais, puis 410) |
| POST | `/me/2fa/totp/setup` | auth | → `{secret (base32), otpauthUri}` (émetteur CASELIND) |
| POST | `/me/2fa/totp/enable` | auth | `{code, password}` → `{backupCodes[10]}` (affichés une seule fois) |
| POST | `/me/2fa/totp/disable` | auth | `{password, code | backupCode}` → **204** |
| POST | `/me/identifier-change` | auth | `{newIdentifier, password}` → **202** `ChallengeResponse` (code envoyé au nouvel identifiant) |
| POST | `/me/identifier-change/verify` | auth | `{challengeId, code}` → **204** ; 409 si pris ; autres sessions révoquées |
| POST | `/auth/qr/session` | public, limité | `{device?}` → **201** `{qrSessionId, qrPayload, expiresAt (2 min), sessionSecret}` |
| POST | `/auth/qr/approve` | auth | `{qrPayload, confirm=false}` → `{status: confirmation_required|approved, device, ...}` ; `confirm: true` approuve |
| GET | `/auth/qr/session/:id` | public, limité | en-tête `X-QR-Session-Secret` → `pending | expired | approved + tokens` (jetons délivrés une seule fois ; mauvais secret : 404) |

TOTP RFC 6238 (SHA-1, 30 s, 6 chiffres, ±1 pas), un pas déjà utilisé est refusé. Secret chiffré AES-256-GCM (`TOTP_ENCRYPTION_KEY`, requis en production). Le secret de session QR n'est jamais dans le QR. L'export ajoute `twoFactorEnabled` / `twoFactorEnabledAt`.

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

Lecture (`canRead`, `apps/api/src/media/access.ts`) : `avatar`, `org_logo`, `org_banner`, `product` lisibles par tout utilisateur connecté ; `message`, `document`, `post` et `story` par le propriétaire (`canRead`), puis par `canReadAsync` : participants pour `message`, lecteurs de la publication pour `post` (média attaché à une publication que le lecteur voit : visibilité, suppression, masquage, blocage ; un média `post` non rattaché reste privé), audience de la story pour `story`.

Stockage : interface `MediaStorage` avec un seul adaptateur, disque local (`MEDIA_STORAGE_DIR`, défaut `apps/api/.data/media`). Le fournisseur de stockage objet n'est pas choisi (décision Q6 du BACKLOG) : l'adaptateur S3-compatible et le CDN viendront après cette décision, sans service payant activé sans accord (CDC §40.9). Les envois sont toujours vérifiés sur disque local avant d'être confiés au stockage. La maintenance horaire supprime les envois non terminés (`pending`) ou refusés (`rejected`) de plus de 24 h et leurs fichiers temporaires (`staleUploads`). Journal d'audit : `media.uploaded`, `media.rejected`, `media.deleted`, `user.avatar_updated` (`metadata.assetId`).

**Côté clients** : le contenu exige le jeton d'accès ; une balise `<img>` web ne peut pas l'envoyer, il faut donc télécharger avec `fetch` + en-tête `Authorization` puis afficher un blob (des URL signées CDN viendront avec le stockage objet).

## Lot 3B — Temps réel et notifications (implémenté et testé)

Toutes les routes exigent un jeton d'accès. Schémas dans `packages/contracts/src/notifications.ts`.

| Route | Rôle |
|---|---|
| `PUT /v1/me/push-tokens` `{token, platform: ios\|android\|web}` | 204, idempotent. Rattache le jeton Expo (`ExponentPushToken[...]`) à la session courante, le réattribue s'il appartenait à un autre compte ; 400 si le jeton n'est pas Expo ; 10 jetons max par utilisateur (le plus ancien est supprimé). |
| `POST /v1/me/push-tokens/unregister` `{token}` | 204. Ne supprime que ses propres jetons. |
| `GET /v1/notifications?limit&cursor&unreadOnly` | `{items, nextCursor}`, du plus récent au plus ancien. |
| `GET /v1/notifications/unread-count` | `{count}`. |
| `POST /v1/notifications/:id/read` | 204, idempotent ; notification d'autrui ou inconnue : 404. |
| `POST /v1/notifications/read-all` | 204. |
| `GET` / `PATCH /v1/me/notification-preferences` | `{pushDisabledCategories, quietUntil, messagePreviews}`. `security` ne peut pas être désactivée (400). |

**Push** : envoyé aux seuls jetons dont la session est active. Pas de push pour une catégorie désactivée ni pendant `quietUntil`, sauf `urgent` (la catégorie `security` ignore l'opt-out). Sans `messagePreviews`, le texte des messages est remplacé par « Nouveau message ». Un jeton refusé par le fournisseur (`DeviceNotRegistered`) est supprimé. Chaque connexion réussie crée une notification `security` « Nouvelle connexion ».

**Protocole Socket.IO** : path `/v1/socket.io`, transport WebSocket recommandé. Authentification au handshake : `io(url, { path: '/v1/socket.io', auth: { token: <accessToken> } })` ; le jeton n'est jamais lu dans l'URL. Refus : `connect_error` de message `unauthenticated`. La socket est déconnectée (`io server disconnect`) à la déconnexion, la révocation de sa session, la réinitialisation du mot de passe, la détection de rejeu du jeton de rafraîchissement, la demande de suppression, ou la suspension du compte (revérification périodique, `REALTIME_SESSION_RECHECK_SECONDS`, 60 s par défaut). Un jeton d'accès expiré ne coupe pas une socket déjà ouverte ; le client doit rafraîchir ses jetons avant de se reconnecter.

Rooms : `user:<id>`, `session:<id>` et `conversation:<id>` (conversations de l'utilisateur, rejointes à la connexion).

| Événement | Sens | Charge utile |
|---|---|---|
| `message.new`, `message.updated`, `message.reaction`, `receipt.updated`, `conversation.updated`, `conversation.member_added`, `conversation.member_removed` | serveur → client | Définie par la messagerie (lot 3A). |
| `notification.new` | serveur → client | Une `Notification` (même forme que la liste). |
| `typing` | client → serveur `{conversationId}` | Accepté si la socket est dans la room ; limité à 1 par 2 s et par conversation. |
| `typing` | serveur → client | `{conversationId, userId}` aux autres membres de la room. |

Lectures, envois et reçus passent par HTTP, jamais par la socket. Variables : `PUSH_PROVIDER` (`log` par défaut, `expo`), `EXPO_ACCESS_TOKEN` (optionnel), `REALTIME_SESSION_RECHECK_SECONDS`. Les reçus différés d'Expo ne sont pas traités.

## Lot 3A — Messagerie (implémenté et testé)

Toutes les routes exigent un jeton d'accès et le flag `messaging`. Schémas dans `packages/contracts/src/messaging.ts`. Non-membre, ancien membre ou id mal formé : **404** (l'existence d'une conversation n'est jamais révélée).

| Route | Rôle |
|---|---|
| `POST /v1/conversations` `{kind:'direct', userId}` ou `{kind:'group', title, announcement?, avatarAssetId?, memberIds}` | 201 ; **200** si le direct existe déjà (une seule conversation par paire, création idempotente). Cible inactive : 404. Blocage (dans un sens ou l'autre) : 403. Réglage `contactRequestsFrom` de la cible : 403 `details.reason = contact_requests_restricted`. Groupe plein : 409 `group_full`. |
| `GET /v1/conversations?archived&limit&cursor` | Épinglées d'abord, puis dernière activité ; `unreadCount`, `lastMessage`, `peer` (direct), `mutedUntil`, `pinned`, `archived`. Un direct sans message n'apparaît pas chez le destinataire. |
| `GET /v1/conversations/:id` | Vue de l'appelant. |
| `PATCH /v1/conversations/:id` `{title?, announcement?, avatarAssetId?}` | Groupe, admin ou owner (403 sinon). Un changement de titre ajoute un message système. |
| `PATCH /v1/conversations/:id/me` `{mutedUntil?, pinned?, archived?}` | État personnel. |
| `GET /v1/conversations/:id/messages?beforeSeq&limit` | Plus récents d'abord (défaut 50, max 100), `hasMore`. Un membre ne voit que les messages postérieurs à son entrée ; ceux masqués « pour moi » sont omis. |
| `POST /v1/conversations/:id/messages` `{clientId, kind:'text'\|'media', body?, mediaId?, replyToId?, mentions?}` | 201 ; **200** si le `clientId` est déjà connu (message stocké renvoyé). Texte 1–4000 caractères. Média : asset `message`, `ready`, à soi, sinon 400. `replyToId` de la même conversation, `mentions` (≤ 50) membres, sinon 400. Direct bloqué ou pair parti : 403. |
| `POST /v1/conversations/:id/delivered` / `/read` `{seq}` | 200 `{lastDeliveredSeq, lastReadSeq, unreadCount}`. Monotone, borné au dernier `seq`. `readReceipts=false` : la position est stockée mais jamais exposée (événement, liste des membres). |
| `GET` / `POST /v1/conversations/:id/members` `{userIds}` | Liste des membres actifs ; ajout (groupe, admin/owner) : renvoie les membres réellement ajoutés. Cible bloquée ou inconnue : 404 identique ; réglage de contact : 403. |
| `PATCH /v1/conversations/:id/members/:userId` `{role}` | Owner seulement ; au moins un owner (409 `last_owner`). |
| `DELETE /v1/conversations/:id/members/:userId` | 204. Soi = quitter ; retirer un autre = admin/owner, un admin ne retire pas un owner. Le dernier owner qui part transfère au plus ancien admin, puis membre. Direct : 403. |
| `PUT /v1/messages/:id/reaction` `{emoji\|null}` | 200, une réaction par utilisateur (≤ 16 caractères). Message rappelé : 409. |
| `DELETE /v1/messages/:id?scope=me\|all` | 204. `me` (défaut) : masque pour soi. `all` : l'auteur seul, dans `MESSAGE_RECALL_WINDOW_SECONDS` (défaut 120, au-delà 409 `recall_window_elapsed`) ; corps, média et réactions effacés, le message reste comme « rappelé ». |

**Contact** : deux utilisateurs sont « contacts » s'ils sont membres actifs d'une même conversation directe. `contactRequestsFrom` de la cible s'applique à celui qui initie (création d'un direct, ajout à un groupe) : `everyone` ; `contacts_of_contacts` = contact existant ou contact commun ; `nobody` = contact existant seulement.

**Temps réel** (après commit) : `message.new`, `message.updated` (rappel), `message.reaction`, `receipt.updated` (`lastReadSeq` null si `readReceipts=false`), `conversation.updated`, `conversation.member_added/removed`. **Push** : `category:'message'`, titre = expéditeur (direct) ou groupe, corps générique « Nouveau message », jamais le contenu ; pas de push en sourdine sauf mention (`urgent`). **Médias** : un asset `message` est lisible par tout membre actif d'une conversation où il a été envoyé dans un message non rappelé. **Audit** : création de groupe, ajout/retrait de membre, changement de rôle, rappel (jamais le contenu). **Compte** : l'export ajoute `conversations` et `messagesSent` ; la purge d'un compte supprimé passe ses adhésions à « parti » et efface ses corps de messages. Variables : `MESSAGING_GROUP_MAX_MEMBERS` (500), `MESSAGE_RECALL_WINDOW_SECONDS` (120), `MESSAGING_RATE_LIMIT_PER_MINUTE` (60). **Débit** : `POST /v1/conversations/{id}/messages` est sous un throttler dédié `messaging`, par client, → 429 `rate_limited`. **Export** : `messagesSent` est limité aux 10 000 messages les plus récents (ordre chronologique) ; `messagesSentTruncated: boolean` indique que des plus anciens ont été omis. Les effets post-commit (événements temps réel, push) ne font jamais échouer la requête ; le retrait d'un membre le sort toujours de la room.

## Lot 3b — Compléments de messagerie (implémenté et testé)

Migration `0017_messaging_extras.sql` ; mêmes règles 404 que le lot 3A, flag `messaging`. Contrats : `messaging-extras.ts`. Le `Message` gagne `forwarded` et `expiresAt`, la `Conversation` gagne `disappearingSeconds`.

- **Transfert** : `POST /v1/messages/:id/forward {conversationIds (1-10), clientId}` → 200 `{results:[{conversationId, status: sent|error, message|null, code: not_found|not_allowed|null}]}`. Source illisible : 404 ; rappelée : 409 ; système : 400. Chaque destination suit toutes les règles d'envoi (membre actif, blocage, pair parti) et ne dit jamais pourquoi (`not_found` = inconnue ou non membre ; `not_allowed` = le reste). La copie est un nouveau message de l'appelant avec `forwarded: true`, sans lien vers l'auteur ni le message d'origine. Idempotent par `clientId` (identifiant dérivé par destination). Un média transféré pointe vers le même asset : `canReadAsync` le couvre déjà (tout membre actif d'une conversation où un message non rappelé et non expiré le porte), testé.
- **Favoris** : `PUT|DELETE /v1/messages/:id/favorite` (204, idempotents ; message invisible ou expéditeur bloqué : 404 ; rappelé : 409 ; système : 400), `GET /v1/me/favorites?limit&cursor` (favori récent d'abord, `{items:[{message, favoritedAt}], nextCursor}`). Les lignes ne sont jamais supprimées par la perte d'accès : la liste masque ceux dont l'appelant n'est plus membre actif, rappelés, expirés, masqués « pour moi » ou d'un expéditeur bloqué dans un sens ou l'autre. Export : `favoriteMessages` (accessibles seulement, 1 000 max) ; purge du compte : supprimés.
- **Champs par appelant** : `Message.favorited` (booléen, une requête groupée par page ; toujours `false` dans les événements temps réel) et `Conversation.draft` (`{body, updatedAt}` ou `null`, une requête groupée sur la liste).
- **Éphémères** : `PATCH /v1/conversations/:id {disappearingSeconds: null|86400|604800|7776000}` (groupe : admin ou owner ; direct : l'un ou l'autre ; un direct refuse tout autre champ). Un changement effectif ajoute un message système `disappearing_changed` (`seconds`). Les nouveaux messages reçoivent `expiresAt` ; passé cet instant l'API ne les renvoie plus (liste, dernier message, non-lus, favoris, lecture du média). La maintenance horaire efface corps, média et mentions (comme un rappel), réactions et favoris.
- **Programmés** : `POST /v1/conversations/:id/messages` avec `scheduledAt` (de 1 minute à 30 jours, sinon 400) vérifie les règles d'envoi puis répond **202** `ScheduledMessage` (200 au rejeu du `clientId` ; 409 `client_id_used` si déjà envoyé ; 409 `scheduled_limit` au-delà de 100 en attente). Aucun `seq` ni visibilité avant l'envoi. `GET /v1/me/scheduled-messages`, `DELETE /v1/me/scheduled-messages/:id` (204). Job minute `ScheduledMessagesService.runOnce(now)` : verrou consultatif 727374, lignes prises en `FOR UPDATE SKIP LOCKED`, suppression de la ligne dans la transaction qui crée le message (idempotent). Les règles sont réévaluées : membre parti, blocage, compte inactif ou média indisponible annulent le message et notifient l'expéditeur (`message`, texte générique). `MESSAGING_SCHEDULER_ENABLED` (défaut `true`) coupe le minuteur ; `runOnce` reste appelable.
- **Brouillons** : `PUT|GET|DELETE /v1/conversations/:id/draft` (`{body}` 1-4000 ; GET sans brouillon : 404 ; DELETE idempotent). Un par membre et conversation ; supprimé à l'envoi ou à la programmation ; événement `draft.updated` `{conversationId, body|null}` vers les sockets de l'utilisateur après commit.
- **Compte** : la purge supprime favoris, brouillons et messages programmés de l'utilisateur. Aucun contenu dans les logs ni l'audit (le motif d'annulation d'un programmé est loggé sans texte).

## Lot 4A — Social : abonnements, publications, fil, réactions, commentaires (implémenté et testé)

Toutes les routes sont derrière le flag `social` (403 `feature_disabled` sinon). Un élément invisible, bloqué, inconnu ou à identifiant mal formé répond 404. Pagination par curseur opaque (`limit` 1-100, défaut 20).

- **Abonnements** : `PUT|DELETE /v1/users/{userId}/follow` (204, idempotents ; soi : 400 ; inconnu, inactif ou bloqué dans un sens ou l'autre : 404), `GET /v1/users/{userId}/followers|following` (récents d'abord), `GET /v1/users/{userId}/social` (`followersCount`, `followingCount`, `isFollowing`, `followsYou` ; `PublicProfile` inchangé). Bloquer supprime les abonnements dans les deux sens. Notification `social` « Nouvel abonné » (une par abonné).
- **Amis** = abonnement mutuel (pas de table dédiée). `RelationsService` (`isFollowing`, `areFriends`, `followingIds`) est le port partagé avec les stories.
- **Publications** : `POST /v1/posts` `{clientId, body?, mediaIds?, visibility}` (texte 1-5000 ou 1-10 médias `post` prêts du créateur, au plus une vidéo ; `kind` = `text | media | video`) ; 201, ou 200 si le `clientId` a déjà servi (publication existante renvoyée). `GET|PATCH|DELETE /v1/posts/{id}` (PATCH : texte et visibilité, auteur seul ; autre lecteur : 403 ; DELETE = suppression logique, non auditée).
- **Visibilité** : `public` = tout connecté ; `followers` = abonnés + auteur ; `friends` = abonnement mutuel + auteur ; `private` = auteur. Blocage dans un sens ou l'autre : invisible. Publication masquée par la modération (`posts.hidden`, via `ModerationRegistry.get('post').setHidden`) : invisible sauf pour l'auteur et les rôles `admin`/`moderator`, avec `moderation: 'hidden'`.
- **Fil** : `GET /v1/feed` (suivis + soi, récents d'abord, curseur `createdAt,id`), `GET /v1/users/{userId}/posts`, `GET /v1/feed/videos` (publications `video` publiques, ordre chronologique simple, sans classement ni recommandation : à remplacer par un vrai flux plus tard).
- **Réactions** : `PUT /v1/posts/{id}/reaction {type: like|love|haha|wow|sad|angry|null}` (une par utilisateur) ; les publications portent `reactions` (compteurs par type), `myReaction`, `commentsCount`. Notification `social` à l'auteur, une seule par réacteur et publication, jamais pour soi.
- **Commentaires** : `GET|POST /v1/posts/{id}/comments` (1-2000 caractères, plus anciens d'abord ; `replyToId` = commentaire de premier niveau de la même publication), `DELETE /v1/comments/{id}` (auteur du commentaire ou de la publication). Commentaires d'un utilisateur bloqué avec le lecteur masqués. Notifications `social` à l'auteur de la publication et à l'auteur du commentaire parent.
- **Modération** : cibles `post`, `comment` et `user` enregistrées dans le `ModerationRegistry` (`user.setHidden` est sans effet : un compte se sanctionne par son statut).
- **Compte** : l'export ajoute `posts`, `comments`, `following` ; la purge supprime abonnements, réactions, publications et commentaires (corps compris).
- **Points ouverts** : l'URL d'un média de publication reste lisible par tout connecté qui en connaît l'id, même si la publication est privée (`canRead` inchangé pour `post`) ; pas de limitation de débit dédiée aux publications ; effets (notifications) après commit, jamais bloquants, sans contenu dans les logs.

## Lot 4B : stories, signalements et modération

Migration `0010_stories_moderation.sql` (`stories`, `story_views`, `reports`). Flag `social.stories` sur les routes de stories.

- **Stories** : `POST /v1/stories {clientId, mediaId, caption? ≤ 500, visibility: followers|friends}` (média `story` prêt de l'auteur, sinon 400 ; 201, ou 200 au rejeu du `clientId`) ; durée `STORY_TTL_HOURS` (défaut 24). `GET /v1/stories/feed` (barre : l'appelant d'abord, puis les suivis, non vues d'abord, 100 auteurs max, `seen` par story), `GET /v1/users/{userId}/stories`, `POST /v1/stories/{id}/view` (204, idempotent), `GET /v1/stories/{id}/viewers` (auteur seul, curseur), `DELETE /v1/stories/{id}` (auteur), `GET /v1/me/stories/archive` (tout l'historique de l'auteur, curseur).
- **Visibilité** : `followers` = abonnés de l'auteur ; `friends` = abonnement mutuel ; blocage dans un sens ou l'autre, story expirée ou masquée, auteur inactif : 404 (l'auteur voit toujours les siennes). Le média d'une story suit la même règle (`canReadAsync`, `StoryAccessService`).
- **Signalements** : `POST /v1/reports {targetType: user|post|comment|story|message, targetId, reason: spam|harassment|hate|violence|nudity|scam|illegal|other, details? ≤ 1000}` → 201 ; cible invisible pour le signaleur ou type non enregistré : 404 ; un seul signalement ouvert par (signaleur, cible) : 409 `already_reported` ; limite `REPORTS_RATE_LIMIT_PER_MINUTE` (défaut 10, cette route seule). `GET /v1/me/reports` (statut ouvert/traité, sans dire quelle sanction).
- **Modération** (rôles `admin` ou `moderator` ; niveau d'accès OpenAPI `moderator`) : `GET /v1/admin/moderation/reports?status=open|resolved&targetType&cursor&limit` (groupés par cible : nombre, motifs, auteur), `POST /v1/admin/moderation/actions {targetType, targetId, action: hide|restore|dismiss, note?}` → `{resolvedReports}`. Toute action résout les signalements ouverts de la cible et est auditée (`moderation.action`, métadonnées `{targetType, targetId, action}`, jamais de contenu ni de note). Le signaleur reçoit une notification `system` persistée, après commit, sans nom ni sanction.
- **Cibles** : `story` (`hidden_at`, réversible) et `message` (`hide` = rappel serveur, corps et média effacés, **irréversible** : `restore` est sans effet).
- **Compte** : l'export ajoute `stories` et `reportsFiled` ; la purge supprime stories et vues (fichiers via le circuit médias), et anonymise les signalements déposés (signaleur et détails effacés). La maintenance horaire supprime les vues des stories expirées depuis plus de 30 jours.
- **Points ouverts** : liste « amis proches » (`closeFriends` / `private_list`) ; lecture du média d'une story par son id seulement pour qui peut voir la story ; l'audit d'une action de modération n'est pas lisible par les modérateurs (route d'audit réservée à `admin`).

## Lot 5A : catalogue (produits, variantes, stock, vitrine)

Migration `0011_catalog.sql` (`product_categories`, `products`, `product_media`, `product_variants`, `stock_movements`) ; flag `commerce` (actif, non réglementé) sur toutes les routes connectées, pas sur la vitrine publique ; `COMMERCE_CURRENCIES` (défaut `USD,CDF`).

- **Catégories** : `GET /v1/catalog/categories` (10 catégories plateforme seedées).
- **Produits d'une org** (`catalog.manage` ; non-membre 404, rôle sans droit 403) : `POST/GET /v1/orgs/{orgId}/products`, `GET/PATCH/DELETE /v1/orgs/{orgId}/products/{productId}`. Titre 1-140, description ≤ 5000, 0-10 médias `product` prêts d'un membre de l'org (sinon 400), statut `draft|published|archived`, 1-50 variantes `{sku, options, priceMinor (entier > 0, unités mineures), currency ∈ COMMERCE_CURRENCIES, stock initial, trackStock, active}`. SKU unique par org (409). Publier exige une variante active (409). `PATCH.variants` : avec `id` = mise à jour complète de la variante (sans toucher au stock), sans `id` = ajout ; les autres restent. `DELETE` archive (jamais de suppression physique, idempotent).
- **Stock** : `POST /v1/orgs/{orgId}/variants/{variantId}/stock {delta, reason: restock|adjustment|damage}` (`inventory.manage` ou `catalog.manage`), verrou de ligne, jamais négatif (409), journal append-only `stock_movements` (trigger) avec raisons `initial|restock|adjustment|damage|order_reserved|order_released`.
- **Vitrine** : `GET /v1/products?q&categoryId&orgId&minPrice&maxPrice&currency&sort=recent|price_asc|price_desc&cursor&limit` et `GET /v1/products/{id}` (publiés, non masqués, org `active` et `public`, vendeur non bloqué avec l'appelant ; sinon 404) ; `GET /v1/public/orgs/{slug}/products` sans jeton. Carte = prix de la variante la moins chère correspondant aux filtres. Recherche `q` : ILIKE titre/description ; index trigram si `pg_trgm` est disponible, sinon btree sur `lower(title)`.
- **CatalogPort** (`src/commerce/catalog.port.ts`) implémenté par `CatalogPortImpl` : `reserve` verrouille les variantes `FOR UPDATE` triées par id, tout ou rien, `trackStock=false` ne décrémente pas.
- **Modération** : cible `product` (`hidden`), signalable via `/v1/reports`. Audit : `product.created|published|archived`, `stock.adjusted` (sans texte libre). Export de compte : rien.
- **Images de la vitrine publique** : `GET /v1/public/media/{id}/content` (sans jeton) sert uniquement un média `product` prêt rattaché à un produit `published`, non masqué, d'une org `active` et `public` (sinon 404) ; mêmes en-têtes que `/v1/media/{id}/content` (nosniff, CSP sandbox, `inline`), `Cache-Control: public, max-age=300`, budget de débit dédié (5 × `RATE_LIMIT_PER_MINUTE`) au lieu du défaut. `GET /v1/public/orgs/{slug}/products` renvoie des `coverUrl` pointant vers cette route ; `/v1/products*` (connecté) garde `/v1/media/{id}/content`. Tout autre média reste privé.
- **Port** : `price`, `reserve` et `productExists` appliquent la même visibilité acheteur que la vitrine (publié, non masqué, org `active` et `public`, vendeur non bloqué avec l'acheteur) : un tel article n'entre pas au panier (404) et fait échouer le checkout (409 `unavailable`).

## Lots suivants — contrats prévus (non implémentés)

Les routes sont listées dans [WECHAT_FUNCTIONAL_MAP.md](../reverse-engineering/WECHAT_FUNCTIONAL_MAP.md), colonne « API & données ». Chacune sera ajoutée ici au moment de son implémentation, avec son schéma dans `packages/contracts`.

## Lot 5B : panier, commandes, coupons, avis vérifiés

Tout est derrière le flag `commerce`. Montants en unités mineures. Seul mode de paiement : `cash_on_delivery` (port `PaymentMethods`, `GET /v1/payment-methods`) ; aucun montant ne transite par CASELIND.

- Panier : `GET /v1/cart` (groupes par organisation et devise, prix courants, `unavailable`), `PUT /v1/cart/items/:variantId {quantity 0..99}` (max 100 lignes : 409 `cart_full`), `DELETE /v1/cart`. Aucune réservation de stock.
- Checkout : `POST /v1/orders/checkout {clientId, address, paymentMethod, couponCodes?}` -> `{orders}` (201, 200 en rejeu). Une commande par (organisation, devise), une transaction : réservation via `CatalogPort.reserve` (échec : 409 `details {reason, variantIds}`), panier vide : 409 `empty_cart`.
- Cycle : `pending > confirmed > preparing > shipped > delivered`, `cancelled` avant `shipped` (acheteur : `pending` seulement ; vendeur jusqu'à `preparing`). Transition interdite : 409 `details {reason: invalid_transition, from, to}`. Historique append-only `order_events`. Acheteur : `GET /v1/orders`, `GET /v1/orders/:id`, `POST /v1/orders/:id/cancel`. Vendeur : `GET /v1/orgs/:orgId/orders[/:id]` (`orders.view`), `POST .../orders/:id/status` (`orders.manage`, audité).
- Coupons (`orders.manage`) : `POST/GET /v1/orgs/:orgId/coupons`, `PATCH .../coupons/:id {active:false}`. Coupon refusé : 400 `details {reason: expired|exhausted|min_not_reached|not_applicable, code}`. Usage libéré à l'annulation.
- Avis : `POST/GET /v1/products/:productId/reviews`, `PATCH/DELETE /v1/reviews/:reviewId`, `POST /v1/orgs/:orgId/reviews/:reviewId/reply`. Sans commande livrée : 403 `details.reason not_purchased` ; doublon : 409 `already_reviewed`. Répondre à un avis masqué par la modération : 404. Cible de modération `review`.
- Compte : l'export ajoute `orders`, `reviews` et `cart` ; la purge efface l'adresse des commandes, le panier et les avis.

## Lot 5b : compléments du commerce (migration `0015_commerce_gaps.sql`)

- **409 du catalogue avec `details.reason` stable** (ne jamais lire le message) : `sku_taken` (+ `field: 'sku'`, `sku` si identifiable), `duplicate_sku_in_request` (+ `field`, `sku`), `publish_without_variant`, `stock_not_tracked`, `stock_negative`. Schéma : `catalogConflictReasonSchema`.
- **Lecture du catalogue vendeur** : `GET /v1/orgs/:orgId/products[/:productId]` accepte `catalog.manage` **ou** `inventory.manage` (le rôle `stock` lit produits et stocks exacts) ; l'écriture reste `catalog.manage`. Autre rôle : 403, non-membre : 404.
- **Avis par organisation** : `GET /v1/orgs/:orgId/reviews?status=all|unanswered&cursor&limit` (`orders.view` ou `catalog.manage`), plus récents d'abord, avis masqués par la modération exclus, chaque avis porte `product {id, title, imageAssetId}`. Réponse inchangée : `POST .../reviews/:reviewId/reply` (`orders.manage`).
- **Contact du vendeur** : champ d'org `supportUserId` (modifiable par `PATCH /v1/orgs/:orgId`, `org.profile.edit` ; doit être un membre actif sinon 400 ; `null` = défaut). `contactUserId` = ce membre s'il est toujours actif, sinon le propriétaire actif le plus ancien ; `null` si aucun, si c'est l'appelant, ou si l'appelant et ce membre sont bloqués dans un sens ou l'autre. Exposé sur `GET /v1/orders/:id` et `POST /v1/orders/:id/cancel` (vue acheteur ; `null` côté vendeur) et sur `GET /v1/public/orgs/:slug` (jeton optionnel : sans jeton : toujours `null`, les blocages ne pouvant �tre v�rifi�s). Le client ouvre ensuite `POST /v1/conversations {kind: 'direct', userId}` ; les règles `contactRequestsFrom` du membre s'appliquent (403 `details.reason contact_requests_restricted`).
- **Devise des coupons** : `currency` optionnel sur tous les coupons, obligatoire pour un montant fixe et dès que `minOrderMinor > 0` (400 sinon). Un coupon avec devise ne s'applique qu'aux commandes de cette devise (sinon 400 `not_applicable`) et son minimum est comparé dans cette devise ; sans devise (pourcentage), il vaut pour toutes les devises et n'a pas de minimum. **Compatibilité** : la migration remet à 0 le minimum des pourcentages existants sans devise (il ne pouvait pas être rattaché à une devise) et ajoute la contrainte `coupons_min_currency_check`.

## Envoi des codes (OTP)

Aucun changement côté clients : les routes `/auth/register`, `/auth/otp/resend` et le reste du lot 1 répondent comme avant (toujours **202** pour l'envoi, même si la livraison échoue ou si l'identifiant est inconnu). Le fournisseur dépend du canal (ADR-018) :

| Identifiant | Fournisseur | Variables |
|---|---|---|
| e-mail | `OTP_EMAIL_PROVIDER=brevo` (API transactionnelle, gabarit fr/en selon la langue du compte) | `BREVO_API_KEY`, `OTP_EMAIL_FROM`, `OTP_EMAIL_FROM_NAME` (défaut `CASELIND`) |
| téléphone | `OTP_PHONE_PROVIDER=whatsapp` (WhatsApp Cloud API, modèle d'authentification approuvé) | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_OTP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` (défaut `fr`), `WHATSAPP_GRAPH_VERSION` (défaut `v21.0`) |
| les deux (dev, test) | `console` (défaut, `OTP_PROVIDER=console` en alias) : codes dans le journal du serveur | aucune |

- En production, `console` est refusé et les variables du fournisseur choisi sont obligatoires : le serveur ne démarre pas sinon.
- Le message ne contient que le code et sa durée de validité (`OTP_TTL_SECONDS`). L'avis « compte déjà existant » n'est envoyé que par e-mail (pas de modèle WhatsApp).
- Échec d'envoi : ligne `otp delivery failed channel=… to=<masqué> reason=… failures_<canal>=N` dans le journal (jamais le code ni le destinataire complet) ; l'utilisateur peut demander un renvoi (`/auth/otp/resend`, cooldown et plafond inchangés).
- Mise en service : voir [`docs/OTP_SETUP.md`](../OTP_SETUP.md).

## Lot 6A : ledger en partie double, wallet sandbox, transferts

**Aucun argent réel** (CDC §17, ADR-013/017) : tout est derrière le flag non réglementé `wallet.sandbox` (migration 0013, actif) ; `wallet.real_money` reste coupé et inutilisé ; aucun partenaire Mobile Money. Toute réponse porte `mode: 'sandbox'`. Montants en unités mineures (bigint en base).

- Modèle (`0013_ledger.sql`) : `ledger_accounts` (user/org/system, devise, `active|frozen`, solde en cache `balance_minor` maintenu par trigger et vérifiable, jamais négatif sauf `allow_negative` = `sandbox_funding`), `journal_entries` (type, clé d'idempotence unique par initiateur, métadonnées), `postings` (montant signé). Triggers : append-only (UPDATE/DELETE/TRUNCATE refusés), somme nulle par devise vérifiée en fin de transaction (trigger différé), écriture dans la devise du compte (clé étrangère composite).
- `LedgerPort` (implémenté par `LedgerService`) : transfert atomique, comptes verrouillés `FOR UPDATE` triés par id, idempotence (rejouer la clé renvoie `replayed: true`), refus `insufficient_funds | limit_exceeded | account_frozen | invalid_counterparty`. Limites `KycPort.limitsFor` (unitaire, sortie glissante 24 h, solde max du destinataire) pour les opérations avec `initiatedBy`. `PinVerifier` (`wallet/pin.port.ts`, stub `not_set` remplacé par 6B).
- Utilisateur : `GET /v1/wallet`, `GET /v1/wallet/transactions?currency&cursor&limit` (contrepartie = nom + @handle, ou organisation), `POST /v1/wallet/transfers {clientId, toHandle, amountMinor, currency, note? <=140, pin}` (201 nouveau, 200 rejeu ; autre montant avec la même clé : 409 `idempotency_mismatch` ; inconnu ou bloqué dans un sens ou l'autre : 404 ; soi : 400 ; PIN absent 409 `pin_not_set`, faux 403, verrouillé 423 ; fonds ou limite : 409 `insufficient_funds|limit_exceeded` ; compte gelé : 403), `POST /v1/wallet/sandbox/topup {clientId, amountMinor, currency}` (plafond `WALLET_SANDBOX_TOPUP_MAX_MINOR` en USD, x2800 pour CDF ; 20 par heure ; 403 `feature_disabled` si `NODE_ENV=production` sans `WALLET_SANDBOX_TOPUP_ENABLED=true`).
- Organisation (`finance.view`) : `GET /v1/orgs/:orgId/wallet`, `GET /v1/orgs/:orgId/wallet/transactions`.
- Admin : `GET /v1/admin/ledger/accounts/:id`, `POST .../freeze|unfreeze` (audités `ledger.account_frozen|unfrozen`), `GET /v1/admin/ledger/reconcile` (solde en cache vs somme des écritures par compte, somme nulle par devise). La maintenance horaire exécute la même réconciliation et journalise (erreur) toute divergence.
- Notification `payment` au destinataire : « Vous avez reçu X de Nom ». Audit `wallet.transfer` / `wallet.sandbox_topup` : montant, devise, id de contrepartie, jamais la note.
- Compte : l'export ajoute `wallet` (soldes + transactions). La purge **ne supprime jamais d'écriture** (append-only, conservation) : elle gèle les comptes de l'utilisateur ; un solde sandbox résiduel non nul reste et est rapporté par la réconciliation / le back-office.

## Lot 6B : KYC par niveaux, code PIN de paiement, QR marchand signé (sandbox, aucun argent réel)

- **Niveaux** : 0 = compte vérifié par OTP ; 1 = identité déclarée (nom légal, date de naissance 18+, type et numéro de pièce, ville) + pièce + selfie ; 2 = niveau 1 + justificatif d'adresse. Validation **manuelle par un admin** (aucun fournisseur KYC contracté, ADR-017). Limites par niveau et devise : défauts prudents (USD niveau 0 : 100,00 de solde, 50,00 par transfert, 100,00 par jour ; x2800 pour CDF), surchargeables par `KYC_LIMITS` (JSON), lues par `KycPort.limitsFor`.
- **Documents** : media avec `purpose: kyc_document` (images et PDF), lisibles uniquement par leur propriétaire et, pour les admins, par les fichiers rattachés à une demande (404 pour les autres), jamais dans l'export ni l'audit. Le numéro de pièce est chiffré (AES-256-GCM, `KYC_ENCRYPTION_KEY`, lié à l'utilisateur) ; seuls ses 4 derniers caractères sont exposés.
- `GET /v1/me/kyc` : niveau, demande en attente, dernière décision, limites du niveau et du suivant, `hasPaymentPin`.
- `POST /v1/me/kyc/submissions` : `{level: 1, legalName, birthDate, idType, idNumber, city, documentIds: [pièce, selfie]}` ou `{level: 2, documentIds: [justificatif]}`. 409 `details.reason` : `pending_exists` (une seule demande en attente), `already_verified`, `level_1_required`.
- Admin : `GET /v1/admin/kyc/submissions?status` (plus anciennes d'abord), `GET /v1/admin/kyc/submissions/:id` (liens des documents, audit `kyc.viewed`), `POST …/:id/decision {decision: approve|reject, reason?}` (motif obligatoire au refus ; audité ; notification `security` ; 409 si déjà décidée ; 403 sur sa propre demande).
- `PUT /v1/me/payment-pin {pin, password}` : 6 chiffres, suites et répétitions refusées (123456, 111111, 121212...), mot de passe du compte requis (401 sinon), Argon2id, événement d'audit `wallet.pin_set` + notification `security`, compteur remis à zéro. `PinVerifier` : 5 essais (`PAYMENT_PIN_MAX_ATTEMPTS`) puis verrou de 15 min (`PAYMENT_PIN_LOCK_MINUTES`), même le bon PIN est refusé pendant le verrou.
- **QR marchand** (D-03, flag `wallet.sandbox`) : `CLQ1.<orgId>.<qrId>.<montant>.<devise>.<expiration>.<signature>` (HMAC-SHA256 base64url, `PAYMENT_QR_SECRET`). `POST /v1/orgs/:orgId/payment-qr {amountMinor?, currency, label?, expiresInSeconds? (60-86400), singleUse?}` (`finance.view` ou `orders.manage`) : montant fixe = 15 min par défaut et usage unique par défaut ; sans montant = statique sans expiration ; liste `GET` et révocation `DELETE …/:qrId` (idempotente, auditée).
- **Réafficher un QR** : `GET /v1/orgs/:orgId/payment-qr/:qrId` → `{payload}` (même signature que la création ; mêmes droits `finance.view` ou `orders.manage` ; QR révoqué, inconnu ou d'une autre organisation : 404).
- `POST /v1/wallet/qr/resolve {payload}` : `{org: {id, name, verified}, amountMinor, currency, label, qrId}`. `POST /v1/wallet/qr/pay {clientId, payload, amountMinor?, pin}` : montant exigé si le QR n'en fixe pas (ignoré sinon), PIN puis `LedgerPort.transfer` (`merchant_payment`, métadonnées `{qrId, orgId}`), QR à usage unique consommé dans la même transaction, notification `payment` aux membres `finance.view`. Rejeu du même `clientId` : résultat initial (`replayed: true`).
- Erreurs : signature invalide, QR expiré, révoqué, déjà utilisé, organisation suspendue : 400 `details.reason` (`invalid_qr` | `expired` | `revoked` | `already_used` | `amount_required`) sans autre information ; PIN : 409 `pin_not_set`, 403 `pin_invalid` (+ `attemptsRemaining`, 0 au dernier essai avant verrou), 423 `pin_locked` (+ `lockedUntil` ISO), m�mes d�tails que le transfert wallet ; fonds : 409 `insufficient_funds` / `limit_exceeded`.
- **Compte** : l'export ajoute `kyc` (niveau, `hasPaymentPin`, demandes avec statut et dates ; ni numéro, ni identité déclarée, ni fichier) ; la purge supprime demandes, profil KYC, PIN et fichiers, la trace des décisions reste dans l'audit.

## Lot 7 : lieux et recherche universelle

Derrière le flag `search` (actif, non réglementé). Toutes les routes sont authentifiées. Aucune position d'utilisateur n'est stockée (ADR-019).

- **Lieux** : `POST|PATCH|DELETE /v1/orgs/:orgId/location {lat, lng, label?}` (permission `org.profile.edit`, audit `org.updated` avec `fields: ['location']`). POST sur une org déjà localisée : 409 `location_exists` ; PATCH sans emplacement : 404 ; DELETE idempotent. `GET /v1/places?lat&lng&radiusKm(<=50, défaut 10)&kind&q&limit&cursor` : organisations publiques et actives (propriétaire non bloqué avec l'appelant), triées par distance (`distanceKm`), pagination par clé `(distance, id)`.
- **Recherche** : `GET /v1/search?q(2-100)&scope=all|users|orgs|products|posts&limit&cursor`. Classement : correspondance exacte (0), préfixe (1), contient (2) ; égalité par nom, publications par date décroissante. `scope=all` : 5 résultats par catégorie, `cursor` refusé (400) ; `nextCursor` d'une catégorie se transmet avec `scope=<catégorie>`. Utilisateurs : actifs, hors soi et hors blocages dans les deux sens ; `@handle` cherche le handle seul ; téléphone ou e-mail seulement en correspondance **exacte** et si `discoverableByPhone` / `discoverableByEmail`. Organisations : publiques et actives. Produits : règle de la vitrine (`buyerVisibleSql`). Publications : `postVisibleSql`. Budget de débit dédié `SEARCH_RATE_LIMIT_PER_MINUTE` (défaut 60).
- **Historique** : `GET /v1/me/search-history` (`{enabled, items}`, 50 max, récent d'abord), `DELETE /v1/me/search-history`, `DELETE /v1/me/search-history/:id` (inconnu ou d'un autre : 404), `PATCH /v1/me/search-history/settings {enabled}` (actif par défaut ; désactiver garde l'existant). Seule la première page d'une recherche est enregistrée, une entrée par (requête, scope). Jamais partagé ; inclus dans l'export (`searchHistory`) ; supprimé à la purge du compte.
- **Emplacement d'organisation (lecture)** : `GET /v1/orgs/:orgId/location` (tout membre actif) → `{lat, lng, label}` ou le JSON `null`. `Org` (vue membre) gagne `location` (même forme ou `null`) ; `PublicOrg` inchangé. `GET /v1/me` gagne `twoFactorEnabled` (booléen).

## Lot 9 : services de proximité et réservations (migration `0020_bookings.sql`)

Derrière le flag `services` (actif, non réglementé). **Paiement sur place uniquement** (ADR-017) : aucun montant n'est encaissé, `paymentMode: "on_site"`. Id inconnu, étranger ou mal formé : 404.

- **Catégories** : `GET /v1/service-categories` (15, seed du CDC §11).
- **Offres** : `titre, description, categoryId, priceKind fixed|quote (+ priceMinor, currency), durationMin (15-720), cancelNoticeHours (défaut 24), city, lat/lng, radiusKm, utcOffsetMinutes, urgentAvailable, guaranteeNote, mediaIds (purpose product, 10 max), status draft|published|archived`. Deux propriétaires : une organisation de kind `services` (`/v1/orgs/:orgId/services[/:id]`, permission `catalog.manage`, autre kind : 409 `org_not_services`, lat/lng par défaut = emplacement de l'org) ou un **prestataire individuel** (`PUT /v1/me/service-profile` d'abord, sinon 409 `profile_required` ; puis `/v1/me/services[/:id]`). `DELETE` archive. Les mots « urgent » / « garanti » dans le titre ou la description sont refusés (400) tant que `urgentAvailable` / `guaranteeNote` ne sont pas remplis. `provider.verified` reste `false` et `verificationLabel` vaut « non vérifié » tant qu'aucune vérification n'existe (org : `verification_status`).
- **Disponibilités** : `PUT .../availability {rules: [{weekday 1-7 ISO, start, end "HH:MM"}], exceptions: [{date, closed} | {date, start, end}]}` remplace tout. Un jour avec exception ignore les plages hebdomadaires. Heure locale du prestataire = UTC + `utcOffsetMinutes` fixe (pas de changement d'heure). `GET /v1/services/:id/slots?from&to` (7 jours par défaut, 14 max) : créneaux d'une durée d'offre, futurs, sans réservation `requested|confirmed`.
- **Réservation** : `POST /v1/services/:id/bookings {startsAt, note?}` (`startsAt` = un créneau exact). Le verrou est la ligne de l'offre (`FOR UPDATE`) plus un index unique partiel `(offer_id, starts_at)` ; deux demandes simultanées : 201 et 409 `slot_taken` (`slot_unavailable` si ce n'est pas un créneau). Offre personnelle ou de son org : 403 `own_service`. Statuts `requested → confirmed → completed`, ou `cancelled | declined | no_show` ; chaque changement écrit `service_booking_events` (statut, acteur `client|provider|system`, horodatage) et `statusChangedAt/By`.
- **Actions** (`POST /v1/bookings/:id/…`) : prestataire (individuel ou membre `catalog.manage`) `confirm`, `decline`, `complete`, `no-show` (les deux derniers seulement après le début : 409 `not_started`), `quote {amountMinor, currency}` ; client `quote/accept`, `quote/decline` (refus = réservation annulée) ; `cancel` pour les deux : le client jusqu'à `cancelNoticeHours` avant le début (sinon 409 `cancellation_window_closed`), le prestataire à tout moment. Offre sur devis : `confirm` exige un devis accepté (409 `quote_not_accepted`) ; offre à prix fixe : 409 `not_a_quote_service`. Transition impossible : 409 `invalid_transition`. Étranger : 404 ; membre sans permission : 403.
- **Lectures** : `GET /v1/bookings/:id` (avec `events`), `GET /v1/me/bookings`, `GET /v1/me/service-bookings`, `GET /v1/orgs/:orgId/service-bookings` (`status`, `cursor`, `limit`).
- **Avis** : `POST /v1/bookings/:id/review {rating 1-5, body?}` par le client seulement et une fois, après `completed` (409 `booking_not_completed` / `already_reviewed`) ; `GET /v1/services/:id/reviews` (moyenne, distribution) ; `POST /v1/service-reviews/:id/reply` (prestataire).
- **Découverte** : `GET /v1/services?categoryId&q&lat&lng&radiusKm(<=100, défaut 10)&limit&cursor` ; avec `lat+lng` : triée par distance (clé `(distance, id)`), `distanceKm` et `inServiceZone` (le point est dans le `radiusKm` de l'offre) ; sans : plus récentes d'abord. Visibilité : publiée, non masquée, org active et publique sans propriétaire bloqué, prestataire actif et non bloqué dans un sens ou l'autre (même règle que la vitrine). La position n'est jamais stockée.
- **Notifications** `booking` (titre « Réservation », textes génériques sans nom, montant ni note ; `data.bookingId`) : demande, confirmation, refus, annulation, devis, fin, avis, réponse. Org : envoyées aux membres `catalog.manage`.
- **Modération** : cibles de signalement `service` (offre) et `service_review` ; l'offre masquée disparaît de la découverte. **Compte** : l'export ajoute `services {profile, offers, bookings (comme client, avec la note), reviews}` ; la purge supprime avis et profil prestataire, efface les notes, annule les réservations vivantes (acteur `system`) et archive les offres individuelles.

## Lot 8 : livraison (migration `0019_delivery.sql`)

Derrière le flag `commerce`. Aucun transporteur externe n'est branché : le livreur est un membre actif de l'organisation (rôle `delivery`) ou le vendeur lui-même. Les notifications (catégorie `delivery`) ne contiennent jamais d'adresse, de téléphone, de code ni de motif libre.

- **Zones et tarifs** (`orders.manage`) : `POST|GET /v1/orgs/:orgId/delivery-zones`, `PATCH|DELETE .../delivery-zones/:id`. Une zone : `name`, `areas` (villes ou quartiers, normalisés minuscules sans accents), `fees` (`{CDF: 5000, USD: 300}` en unités mineures par devise), `etaMinutes`, `active`. 50 zones max par organisation (409 `zone_limit`). Audit `delivery.zone_saved|zone_deleted`. Côté acheteur : `GET /v1/delivery/orgs/:orgId/zones` (zones actives).
- **Checkout** : `fulfillment: 'delivery' | 'pickup'` (défaut `delivery`) et `zones: [{orgId, zoneId}]`. Livraison : adresse obligatoire ; une organisation sans zone active livre gratuitement, avec zones la zone est obligatoire, doit couvrir la ville ou la 2e ligne d'adresse et avoir un tarif dans la devise de la commande. Refus : 400, `details[0].reason` = `zone_required | zone_not_found | zone_not_covered | zone_currency_unsupported`. `Order` gagne `fulfillment` et `deliveryFeeMinor` ; `totalMinor = sous-total - remise + frais` (la remise et le minimum de coupon restent calculés sur le sous-total). Retrait : gratuit, adresse facultative, pas de livraison. Les commandes antérieures valent `delivery` à frais 0 sans ligne de livraison.
- **Livraison** (une par commande à livrer, créée au checkout) : `pending → assigned → picked_up → in_transit → delivered | failed`, puis `failed → returned`. `OrderDetail.delivery` (null pour un retrait) donne statut, livreur, délai, `proofCode` (acheteur seulement), `proofLocked`, dernière position (acheteur seulement). Événements append-only (`delivery_events`, trigger SQL), visibles dans `GET /v1/orgs/:orgId/deliveries/:id`.
- **Vendeur** : `GET /v1/orgs/:orgId/deliveries` (`orders.view`, filtres `status`, `courierUserId`, curseur), `POST .../deliveries/:id/assign {courierUserId}` (`orders.manage` ; le livreur est un membre actif de rôle `delivery` ou l'appelant ; réaffectation possible jusqu'au `picked_up`, ensuite 409 `invalid_transition` ; 400 `courier_not_eligible`), `POST .../deliveries/:id/status {status: failed|returned, reason}`, `POST .../deliveries/:id/proof-reset` (nouveau code, compteur remis à 0). Audit `delivery.assigned|status_changed|proof_reset`.
- **Livreur** : `GET /v1/me/deliveries?scope=active|done|all`, `GET /v1/me/deliveries/:id` (adresse, montant à encaisser, jamais le code ; la livraison d'un autre : 404), `POST /v1/me/deliveries/:id/status {status, code?, reason?, note?}`, `POST .../incident {reason}` (événement + notification aux gestionnaires, statut inchangé). Le livreur doit rester membre actif (sinon 403). `picked_up` exige la commande `preparing` (409 `order_not_ready`) et passe la commande à `shipped` ; `delivered` passe la commande à `delivered`. Une commande annulée avant le retrait clôt sa livraison en `failed` (`order_cancelled`) et prévient le livreur.
- **Preuve par code** : 6 chiffres générés au checkout, dérivés d'une clé serveur (HMAC de l'id et d'un nonce) pour que l'acheteur puisse le relire ; la base ne garde que le nonce et un hash à clé. `delivered` exige `code` : faux = 403 `details {reason: 'invalid_proof_code', remainingAttempts}`, au 5e essai faux = 429 `proof_locked` (le bon code est refusé aussi), jusqu'à `proof-reset`.
- **Position** (facultative) : `PUT /v1/me/deliveries/:id/location-consent {granted}` puis `POST /v1/me/deliveries/:id/location {lat, lng}` (204), seulement en `in_transit` (409 `not_in_transit`) et avec consentement (403 `location_consent_required`). Seule la dernière position est conservée, diffusée en `delivery.location` dans la room `order:<orderId>` que seul l'acheteur rejoint, jamais montrée au vendeur. Effacée à la fin de la livraison ou au retrait du consentement. Événement `delivery.updated {orderId, deliveryId, status}` sur la room utilisateur de l'acheteur et du livreur.
- **Évaluation** : `POST /v1/orders/:orderId/delivery/rating {rating 1-5, comment?}` par l'acheteur après `delivered`, une seule fois (409 `not_delivered` | `already_rated`).
- **Compte** : l'export ajoute `deliveries` (rôle acheteur ou livreur, statut, note, dates ; ni code ni position). La purge efface positions et commentaire de note de l'acheteur, retire un livreur supprimé de ses livraisons ouvertes (non retirées : retour à `pending` ; en cours : `failed`) ; les événements restent (append-only).
- **Limites connues** : la zone est choisie par organisation à l'aide de `zones` ; pas de photo ni de signature de preuve, pas de tournée multi-étapes, pas de livraison internationale (aucun partenaire). Après `failed`, la commande reste `shipped` (pas de statut de commande « retournée ») : remboursement et nouvelle tentative sont gérés hors API.
