# Guide développeur CASELIND : mini-applications

Ce guide couvre tout le cycle d'une mini-application : création, accès demandés (scopes), connexion OAuth 2.0 avec PKCE, jetons, paiements confirmés par PIN, webhooks d'organisation, quotas, versions et revue. Le SDK `@caselind/sdk` (paquet du dépôt, `packages/sdk`) encapsule tout cela en TypeScript, sans dépendance externe.

Toutes les routes sont préfixées par `/v1`. Les corps et réponses sont en JSON. Les erreurs ont la forme `{ "error": { "code", "message", "details", "requestId" } }`.

## 1. Créer une application

Une application appartient à une **organisation dont vous êtes propriétaire** (droit `org.admins.manage`). Dans l'application mobile : Mini-applications, puis « Espace développeur », puis « Créer une application ».

Par l'API : `POST /v1/orgs/{orgId}/miniapps`

| Champ | Règle |
| --- | --- |
| `name` | 2 à 60 caractères |
| `description` | 500 au plus, facultatif |
| `iconMediaId` | un de vos médias prêts de finalité `org_logo` (téléversement habituel), facultatif |
| `launchUrl` | https, sans identifiants ni fragment |
| `redirectUris` | 1 à 10 adresses https, **comparées exactement** (pas de joker, pas de fragment) |
| `scopes` | sous-ensemble des accès ci-dessous |
| `confidential` | `true` (défaut) : l'application reçoit un secret ; `false` : client public, PKCE seul |

La réponse contient `clientId` et, pour une application confidentielle, `clientSecret`. **Le secret n'est affiché qu'une fois** ; seul son hachage est conservé. `POST /v1/orgs/{orgId}/miniapps/{appId}/rotate-secret` en émet un nouveau (l'ancien cesse de fonctionner aussitôt ; les jetons déjà émis restent valables).

Une application naît en `draft`. Elle est modifiable (`PATCH`) tant qu'elle est `draft` ou `rejected`. `POST .../submit` la passe en revue.

### Statuts de revue de l'application

| Statut | Signification |
| --- | --- |
| `draft` | brouillon, modifiable |
| `in_review` | soumise, en attente d'un administrateur ou modérateur |
| `published` | visible dans l'annuaire, OAuth actif |
| `rejected` | refusée avec une note ; corrigez puis soumettez de nouveau |
| `suspended` | coupée par l'administration : tous les jetons sont révoqués, les demandes de paiement en attente annulées |

## 2. Accès demandés (scopes)

| Scope | Donne accès à |
| --- | --- |
| `profile.basic` | identifiant, nom, @pseudo, avatar (`GET /v1/miniapp-api/me`) |
| `profile.phone` | numéro de téléphone **vérifié** (ajouté à `me`) |
| `profile.email` | adresse e-mail **vérifiée** (ajoutée à `me`) |
| `orders.read` | commandes de l'utilisateur **chez l'organisation qui édite l'application**, rien d'autre |
| `wallet.pay` | ouvrir des demandes de paiement (sandbox), toujours confirmées par l'utilisateur avec son PIN |

Demandez le minimum. Un jeton ne porte que les scopes que l'utilisateur a consentis **et** que la version approuvée de l'application déclare encore.

## 3. Connexion OAuth 2.0 avec PKCE

Flux « code d'autorisation + PKCE », méthode **S256 uniquement**.

1. Votre application génère un `code_verifier` (43 à 128 caractères parmi `A-Z a-z 0-9 - . _ ~`), calcule `code_challenge = BASE64URL(SHA256(code_verifier))` et un `state` aléatoire (8 à 500 caractères).
2. L'utilisateur voit l'écran de consentement CASELIND (application, organisation, accès demandés). `GET /v1/oauth/authorize/preview` fournit ces données ; `POST /v1/oauth/authorize` enregistre le consentement et renvoie un **code valable 60 secondes, à usage unique**, lié à l'utilisateur, à l'application, à la redirection et au challenge. Le navigateur de l'utilisateur est renvoyé vers votre `redirect_uri` avec `code` et `state`.
3. Votre application vérifie que `state` est celui qu'elle a émis, puis échange le code : `POST /v1/oauth/token`.

```json
{ "grant_type": "authorization_code", "code": "…", "code_verifier": "…", "redirect_uri": "https://app.exemple.test/callback", "client_id": "cl_…", "client_secret": "cls_…" }
```

`client_secret` n'est exigé que pour une application confidentielle, et **jamais** dans une application mobile ou web distribuée (utilisez alors un client public).

Réponse : `access_token` (préfixe `cla_`, 15 minutes), `refresh_token` (préfixe `clr_`, 30 jours, **à usage unique**), `scope`, `expires_in`.

Rafraîchir : `grant_type: "refresh_token"` avec `refresh_token` et `client_id` (+ secret). Le jeton de rafraîchissement est tourné à chaque usage. **Le rejouer** révoque toute la chaîne de jetons : stockez toujours le dernier reçu et ne rafraîchissez pas en parallèle.

Un code rejoué, un jeton révoqué, une autorisation retirée par l'utilisateur, une application ou une organisation suspendue coupent l'accès immédiatement (la base est relue à chaque appel). Les erreurs du point d'accès suivent la RFC 6749 : `details.error` vaut `invalid_grant`, `invalid_client`, `invalid_scope`, `invalid_redirect_uri`, etc.

## 4. Appeler l'API avec un jeton

En-tête `Authorization: Bearer cla_…`.

| Route | Scope | Réponse |
| --- | --- | --- |
| `GET /v1/miniapp-api/me` | `profile.basic` | profil (+ téléphone, e-mail selon scopes) |
| `GET /v1/miniapp-api/orders?limit&cursor` | `orders.read` | commandes chez votre organisation, pagination par curseur |
| `POST /v1/miniapp-api/payment-requests` | `wallet.pay` | ouvre une demande de paiement |
| `GET /v1/miniapp-api/payment-requests/{id}` | `wallet.pay` | statut d'une demande |

Sans le scope requis : `403`. Jeton absent, expiré ou révoqué : `401`.

**Transparence pour l'utilisateur** : chaque appel servi est inscrit dans un journal (application, scope, ressource, date, jamais le contenu) que l'utilisateur consulte par application (`GET /v1/me/miniapps/{appId}/activity`, 90 jours) et qui figure dans l'export de son compte.

## 5. Paiements par PIN

Une application ne déplace jamais d'argent. Elle ouvre une demande ; seul l'utilisateur, dans CASELIND, la confirme avec son code PIN de paiement. Les montants sont en argent de test (sandbox).

```json
POST /v1/miniapp-api/payment-requests
{ "clientRef": "commande-1042", "amountMinor": 1200, "currency": "USD", "description": "Commande 1042" }
```

- `clientRef` (1 à 64 caractères) est votre clé d'idempotence : le même `clientRef` renvoie la même demande (`201` à la création, `200` ensuite) ; le réutiliser avec un autre montant, une autre devise ou un autre utilisateur donne `409`.
- La demande vit **10 minutes**. L'utilisateur est notifié et la confirme dans « Mini-applications > Demandes de paiement ».
- Statuts : `pending`, `paid`, `declined`, `cancelled` (autorisation retirée, application suspendue), `expired`.
- Le montant est viré au portefeuille de l'organisation qui édite l'application ; `transferId` renseigne le virement.

Interrogez `GET /v1/miniapp-api/payment-requests/{id}` (toutes les 2 secondes suffisent) jusqu'à ce que le statut ne soit plus `pending`.

## 6. Webhooks d'organisation

Les événements de votre organisation (commandes, ventes en caisse, questions, retours) peuvent être envoyés à votre serveur : `POST /v1/orgs/{orgId}/webhooks` (adresse https, événements `order.created`, `order.status_changed`, `pos.sale_created`, `pos.sale_voided`, `org.question_asked`, `order.return_requested`). Le secret est montré une fois ; `rotate-secret` le renouvelle ; `.../test` envoie un événement d'essai ; `.../deliveries` donne le journal.

Chaque envoi porte `X-Caselind-Event`, `X-Caselind-Delivery`, `X-Caselind-Timestamp` et `X-Caselind-Signature`. Vérifiez la signature : HMAC-SHA256 hexadécimal de `"<timestamp>.<corps brut>"` avec votre secret, et refusez les horodatages trop anciens.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
const ok = (secret: string, ts: string, raw: string, sig: string) => {
  const expected = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  return expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
};
```

## 7. Quotas

Les appels faits avec un jeton sont limités **par application** (par client OAuth), toutes utilisatrices et tous utilisateurs confondus :

- par minute : `MINIAPP_RATE_LIMIT_PER_MINUTE` (défaut 300), surchargeable pour une application par l'administration (`PATCH /v1/admin/miniapps/{appId}/quota`) ;
- par jour (UTC) : `MINIAPP_RATE_LIMIT_PER_DAY` (défaut 50 000).

Au-delà : `429` avec l'en-tête `Retry-After` (secondes) et le code `rate_limited`. Un appel refusé n'est pas compté dans le budget. Le quota en vigueur figure dans les statistiques.

Limite connue : le compteur est en mémoire, par instance de l'API (comme le limiteur global). Avec plusieurs instances, le plafond réel est multiplié par leur nombre ; un magasin partagé sera nécessaire pour un plafond exact.

## 8. Versions, revue et re-consentement

Chaque évolution de l'application est une **version** (`MAJEUR.MINEUR.CORRECTIF`, unique par application). Une version fige l'ensemble des scopes qu'elle déclare.

| Route (propriétaire de l'organisation) | Effet |
| --- | --- |
| `POST /v1/miniapps/{id}/versions` | crée un brouillon : `version`, `changelog` (1000 au plus), `scopes` (défaut : scopes actuels) |
| `GET /v1/miniapps/{id}/versions` | liste, la plus récente d'abord |
| `POST /v1/miniapps/{id}/versions/{versionId}/submit` | `draft` vers `submitted` |

Revue par un administrateur ou modérateur : `GET /v1/admin/miniapps/versions`, `POST /v1/admin/miniapps/versions/{id}/approve` ou `.../reject` (une note est obligatoire pour refuser). Statuts : `draft`, `submitted`, `approved`, `rejected`, `superseded`.

À l'approbation, la version devient la **version courante** affichée dans l'annuaire, l'application déclare exactement ses scopes, et la version approuvée précédente passe en `superseded`. Pour une application publiée (non modifiable directement), c'est la seule façon de changer ses scopes.

**Re-consentement** : une autorisation ne couvre que les scopes que l'utilisateur a consentis. Si la version ajoute des scopes, les autorisations en cours sont marquées `reconsentRequired` ; les anciens accès continuent de fonctionner, les nouveaux restent fermés tant que l'utilisateur n'a pas consenti de nouveau (relancez le flux OAuth avec les nouveaux scopes). Si la version retire un scope, il cesse de fonctionner immédiatement pour les jetons existants.

## 9. Statistiques d'usage

`GET /v1/miniapps/{id}/stats?days=7|30|90` (propriétaire uniquement) renvoie une série dense par jour UTC : autorisations, utilisateurs actifs, appels API, demandes de paiement, paiements confirmés, erreurs, plus les totaux et le quota. Ce sont des compteurs : aucune donnée d'utilisateur n'y figure. Conservation : 400 jours. L'application mobile les affiche dans « Espace développeur ».

## 10. SDK `@caselind/sdk`

TypeScript, `fetch` natif, aucune dépendance d'exécution (les types viennent de `@caselind/contracts`). Le paquet est dans `packages/sdk`.

```ts
import { CaselindClient, CaselindRateLimitError } from '@caselind/sdk';

const client = new CaselindClient({
  baseUrl: 'https://api.exemple.test',
  clientId: 'cl_…',
  redirectUri: 'https://app.exemple.test/callback',
  // clientSecret: 'cls_…',   // serveur seulement
});

// 1. Début : à conserver (session) jusqu'au retour de l'utilisateur.
const pending = await client.beginAuthorization(['profile.basic', 'wallet.pay']);
// ouvrir pending.url ; conserver pending.state et pending.codeVerifier

// 2. Retour sur redirectUri : vérifie le state, échange le code.
await client.completeAuthorization(redirectedUrl, pending);

// 3. Ressources (rafraîchissement automatique du jeton expiré).
const me = await client.me();
const orders = await client.orders({ limit: 20 });

// 4. Paiement par PIN.
const req = await client.createPaymentRequest({ clientRef: 'commande-1042', amountMinor: 1200, currency: 'USD' });
const final = await client.waitForPayment(req.id); // final.status : 'paid' | 'declined' | 'expired' | …

// 5. Erreurs typées.
try {
  await client.me();
} catch (e) {
  if (e instanceof CaselindRateLimitError) await new Promise((r) => setTimeout(r, e.retryAfterSeconds * 1000));
  else throw e; // CaselindApiError : status, code, details, oauthError
}
```

Autres points : `client.tokens` et `client.setTokens()` pour persister la session ; `exchangeCode` et `refresh` sont disponibles pour un contrôle manuel ; `codeChallengeS256`, `generateCodeVerifier` et `generateState` sont exportés. L'option `authorizeUrl` désigne la page de consentement (défaut : `<baseUrl>/oauth/authorize`) ; `fetch` permet d'injecter un autre transport.

Tests du paquet : `npx vitest run` dans `packages/sdk` (vecteur RFC 7636, construction d'URL, jetons, 429, paiements).

## 11. Bonnes pratiques

- Demandez le minimum de scopes ; expliquez-les à l'utilisateur.
- Ne journalisez jamais un jeton ou un secret ; ne les mettez pas dans une adresse.
- Gérez le `429` avec `Retry-After`, et un `401` par un rafraîchissement unique, puis une nouvelle connexion.
- Traitez `403` comme « l'utilisateur n'a pas (ou plus) consenti à ce scope ».
- Les accès sont audités et révocables par l'utilisateur à tout moment.

## 12. Phase 2 : manifeste, consentement natif, événements, notifications, revenus, certification

La plateforme fait le travail sensible à votre place (sécurité, consentement, signatures, quotas, quittances). Vous écrivez peu, vous ne pouvez presque rien oublier.

### 12.1 Manifeste déclaratif (obligatoire)

Chaque application et chaque version porte un `manifest` (JSON strict, mêmes règles côté API, SDK et script) :

- `dataAccessed` : une ligne par scope demandé `{ scope, purpose (≤120), retention (≤80) }` ; ni plus ni moins que les scopes.
- `endpoints` : `{ method, path }` pris dans le catalogue (`GET /v1/miniapp-api/me`, `GET /v1/miniapp-api/orders`, `POST /v1/miniapp-api/payment-requests`, `GET /v1/miniapp-api/payment-requests/{id}`, `POST /v1/miniapp-api/notify`), chacun couvert par un scope demandé.
- `events` : événements souscrits (`authorization.granted`, `authorization.revoked`, `payment.confirmed`, `payment.declined`, `user.data_deletion_requested` ; les événements de paiement exigent `wallet.pay`).
- `costs` : `{ model: free|per_use|subscription|other, description (≤300), maxAmountMinor|null, currency|null }`.
- `termsUrl`, `privacyUrl` (https), `supportEmail`, `dataLocation` (≤80).

La soumission d'une application ou d'une version est refusée (400, liste des problèmes) si le manifeste manque ou est incomplet. L'approbation le fige : il devient celui de l'application. Le jeton d'une application ne peut appeler QUE les endpoints et scopes du manifeste approuvé : sinon `403` avec `details.reason = "not_declared"`, compté comme erreur dans les statistiques. Une application sans manifeste approuvé ne peut rien appeler : créez une version avec un manifeste.

Valider en local : `node scripts/miniapp/validate-manifest.mjs manifest.json` (ou `checkManifest` du SDK). Modifier le manifeste d'une application publiée = nouvelle version. L'approbation d'une version qui ajoute des scopes, change une finalité, les coûts (modèle, plafond, devise) ou le lieu des données marque les autorisations « à renouveler » et notifie les utilisateurs.

### 12.2 Consentement natif

L'utilisateur autorise dans l'application CASELIND (écran `miniapps/consent`), ouvert par le lien profond `caselind://miniapps/consent?client_id=…&redirect_uri=…&scope=…&state=…&code_challenge=…&code_challenge_method=S256` (le SDK le construit avec `authorizeUrl: 'caselind://miniapps/consent'`). L'écran montre nom, certification, éditeur, accès, données, coûts, conditions et confidentialité, puis Autoriser / Refuser avec confirmation. PKCE S256 est obligatoire, `redirect_uri` doit être identique à une adresse enregistrée (aucun préfixe, aucun joker) ; l'utilisateur n'est renvoyé qu'après cette vérification. Refus : retour avec `error=access_denied&state=…`. Le renouvellement du consentement passe par le même écran.

### 12.3 Événements sortants (webhook d'application)

`POST /v1/miniapps/{id}/webhook` (un par application, https, contrôle anti-SSRF avec résolution DNS vérifiée à chaque envoi), `GET`, `DELETE`, `POST /rotate-secret`, `POST /test`, `GET /deliveries`. Le secret n'est montré qu'à la création et à la rotation. Les événements sont limités à ceux du manifeste. En-têtes `X-Caselind-Event`, `X-Caselind-Delivery`, `X-Caselind-Timestamp`, `X-Caselind-Signature` = HMAC-SHA256 hex de `${timestamp}.${corps}`. Reprises à 1 puis 10 minutes (3 essais), désactivation après 10 envois abandonnés consécutifs (le propriétaire est notifié ; un test réussi le réactive), journal des 100 derniers envois.

Les données sont minimales : `data.sub` est l'identifiant de l'utilisateur propre à votre application (`hmac(clé serveur, appId + userId)`, stable, différent pour chaque application ; c'est aussi l'`id` renvoyé par `/miniapp-api/me`), jamais l'identifiant global. `authorization.revoked` et `user.data_deletion_requested` signifient : effacez tout ce que vous détenez sur ce `sub`.

```ts
import { verifyWebhook } from '@caselind/sdk';
// signature, tolérance d'horloge (300 s), comparaison à temps constant
const event = await verifyWebhook(rawBody, req.headers, process.env.WEBHOOK_SECRET!);
if (event.event === 'authorization.revoked') await purge(event.data.sub);
```

### 12.4 Notifications envoyées par votre application (scope `notify`)

`POST /v1/miniapp-api/notify { title ≤60, body ≤200, deepLink? }` : une notification à l'utilisateur du jeton seulement, titrée « [Nom] : … » (catégorie système). Limites : 5 par jour et par utilisateur, plafond quotidien par application, `429` (`details.reason = "notify_quota"`, `Retry-After`). Aucun lien vers un hôte non déclaré (lancement, redirections, conditions, confidentialité) ; `deepLink` sur l'hôte de lancement. L'utilisateur peut couper votre application (`delivered: false`) sans retirer l'accès. L'audit ne garde jamais le texte. SDK : `client.notify({...})`.

### 12.5 Revenus (relevés indicatifs)

L'administrateur fixe `revenue_share_bps` (0 à 3000, défaut 0). Chaque mois la maintenance calcule, par application et devise, le brut des paiements confirmés (annulés, refusés et expirés exclus), la part de la plateforme (arrondie à la demi-unité supérieure, en entiers) et le reste pour le développeur ; le mois écoulé est clos et n'est plus recalculé. `GET /v1/miniapps/{id}/revenue` et `/revenue/export` (CSV). Relevé indicatif : aucun versement réel (le paiement en ligne est assuré par un tiers).

### 12.6 Certification et suspension

Niveaux : `unreviewed`, `reviewed` (application approuvée), `certified` (certification admin avec note et date). Badge dans l'annuaire et l'écran de consentement. Admin : `POST /v1/admin/miniapps/{id}/certify|decertify`, suspension via `/review` (tous les jetons coupés aussitôt, propriétaires notifiés). Écran : `admin/miniapp-versions` (file de revue, quota, partage, certification, suspension).

### 12.7 SDK et gabarit

`@caselind/sdk` : `verifyWebhook`, `parseWebhookEvent`, `notify`, `defineManifest`/`checkManifest`, `requestPayment` (clé d'idempotence automatique, flux PIN jusqu'au résultat), reprise sur `429` avec `Retry-After`, rotation des jetons (un seul rafraîchissement partagé, `onTokens` pour persister), erreurs typées `CaselindNotDeclaredError`, `CaselindQuotaError`, `CaselindConsentRequiredError`. Gabarit prêt à copier : `templates/miniapp-starter/`.

### 12.8 Checklist de soumission

1. `manifest.json` valide (`validate-manifest.mjs`), liens https qui répondent, adresse de support lue.
2. Redirections https exactes enregistrées ; aucun secret dans un binaire ou une application mobile.
3. Webhook créé, signature vérifiée sur le corps brut, purge sur `authorization.revoked` et `user.data_deletion_requested`.
4. Idempotence des paiements (`clientRef`), aucun traitement avant `payment.confirmed`.
5. Notifications rares et utiles ; aucun lien externe non déclaré.

### 12.9 Modèle de menace

La plateforme garantit : jeton limité à une application et un utilisateur ; scopes ET endpoints vérifiés à chaque appel sur le manifeste approuvé ; accès aux données d'autrui, d'une autre application ou d'une organisation dont l'utilisateur n'est pas membre impossibles ; redirections à correspondance exacte, PKCE S256 obligatoire, aucune redirection ouverte ; secrets jamais renvoyés après création ; événements signés, rejouables seulement dans la tolérance ; identifiant utilisateur propre à chaque application ; accès coupés à la révocation, à la suspension et à la demande de suppression du compte ; journal d'accès sans contenu.

Elle ne garantit pas : ce que votre serveur fait des données une fois reçues (vous devez les purger sur les événements), la sécurité de votre hébergement et de vos secrets, ni un versement réel des revenus. Les paiements restent un portefeuille de test : seul le PIN de l'utilisateur déplace des fonds.
