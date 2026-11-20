# Déploiement de l'API CASELIND

Aucun déploiement automatique n'existe : l'hébergement n'est pas choisi (Q6, voir `BACKLOG.md`). La CI (`.github/workflows/ci.yml`) vérifie seulement le code ; l'image Docker se construit à la main.

## Prérequis

- PostgreSQL >= 16 (la CI et les tests utilisent la 18). Un utilisateur dédié, une base vide : les migrations (`apps/api/migrations`) sont appliquées au démarrage.
- Node >= 22 si l'on lance sans Docker.
- Stockage des médias : disque local (`MEDIA_STORAGE_DIR`, volume persistant `/data/media` dans l'image). L'adaptateur S3 et le CDN viennent après Q6 ; le staging des envois restera local.
- Proxy inverse TLS devant l'API : mettre `TRUST_PROXY=true` uniquement derrière un proxy de confiance, qui doit transmettre `X-Forwarded-For` et `X-Forwarded-Proto` (limitation de débit et IP des journaux en dépendent) et le Upgrade WebSocket (`/socket.io`, Socket.IO).
- Renseigner `CORS_ORIGINS` (liste séparée par des virgules) si un client web appelle l'API.

## Variables d'environnement (`apps/api/src/config/env.ts`)

Aucune valeur secrète ici ; les secrets s'injectent par le gestionnaire de secrets de l'hébergeur.

**Noyau** : `NODE_ENV=production`, `PORT` (3000), `DATABASE_URL` (obligatoire), `LOG_LEVEL`, `TRUST_PROXY`, `CORS_ORIGINS`, `MAINTENANCE_ENABLED` (false sur les instances qui ne doivent pas exécuter le nettoyage horaire).

**Authentification** : `JWT_ACCESS_SECRET` (obligatoire, >= 32 car.), `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`, `ACCOUNT_DELETION_GRACE_DAYS`.

**Codes OTP** : `OTP_PEPPER` (obligatoire, >= 32 car.), `OTP_TTL_SECONDS`, `OTP_RESEND_COOLDOWN_SECONDS`. En production le fournisseur `console` est refusé au démarrage : `OTP_EMAIL_PROVIDER=brevo` avec `BREVO_API_KEY`, `OTP_EMAIL_FROM` (et `OTP_EMAIL_FROM_NAME`) ; `OTP_PHONE_PROVIDER=whatsapp` avec `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_OTP_TEMPLATE` (et `WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_GRAPH_VERSION`). `OTP_PROVIDER` est un alias de repli, à ne pas utiliser.

**Limitation de débit** : `RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE`, `MEDIA_RATE_LIMIT_PER_MINUTE`, `MESSAGING_RATE_LIMIT_PER_MINUTE`, `REPORTS_RATE_LIMIT_PER_MINUTE`.

**Médias** : `MEDIA_SIGNING_SECRET` (obligatoire, >= 32 car.), `MEDIA_STORAGE_DIR`, `MEDIA_MAX_IMAGE_BYTES`, `MEDIA_MAX_VIDEO_BYTES`, `MEDIA_MAX_AUDIO_BYTES`, `MEDIA_MAX_DOCUMENT_BYTES`, `MEDIA_MAX_PENDING_PER_USER`, `MEDIA_QUOTA_BYTES_PER_USER`.

**Messagerie, temps réel, notifications** : `MESSAGING_GROUP_MAX_MEMBERS`, `MESSAGE_RECALL_WINDOW_SECONDS`, `REALTIME_SESSION_RECHECK_SECONDS`, `STORY_TTL_HOURS`, `PUSH_PROVIDER` (`log` ne délivre rien ; `expo` en production) et `EXPO_ACCESS_TOKEN`.

**Commerce et portefeuille** : `COMMERCE_CURRENCIES`, `WALLET_SANDBOX_TOPUP_ENABLED` (laisser absent ou `false` en production), `WALLET_SANDBOX_TOPUP_MAX_MINOR`.

**Double validation des opérations admin sensibles** : `ADMIN_DUAL_APPROVAL` (`true` ou `false` ; défaut `true` en production, `false` sinon). Active, un drapeau réglementé activé ou désactivé, un rôle plateforme donné, un gel ou dégel de compte du registre et la suspension d'un compte modérateur ou support créent une demande (réponse 202) qu'un AUTRE administrateur approuve ou rejette (`/v1/admin/approvals`) ; elle expire après 24 h. Il faut donc au moins deux administrateurs actifs : avec un seul, ces opérations restent en attente.

**Clés de chiffrement** : `TOTP_ENCRYPTION_KEY` et `HEALTH_ENCRYPTION_KEY` (obligatoires en production, 32 octets minimum en hex ou base64, à sauvegarder hors du serveur : la clé santé protège aussi les fichiers de comptes rendus et pièces d'identité stockés, scellés AES-256-GCM ; les fichiers antérieurs au chiffrement restent lisibles). `WEBHOOK_ENCRYPTION_KEY` (facultative, même format) scelle les secrets des webhooks ; sans elle, `TOTP_ENCRYPTION_KEY` est utilisée, et au moins l'une des deux est exigée au démarrage en production. Les secrets scellés portent un identifiant de clé : pour changer de clé, ajouter la nouvelle `WEBHOOK_ENCRYPTION_KEY` en gardant l'ancienne `TOTP_ENCRYPTION_KEY`, les anciens secrets restent lisibles ; un secret illisible donne l'erreur de livraison `secret` (sans désactiver la souscription) : le faire tourner. Plafond : 120 événements webhook par organisation et par minute (par instance).

**KYC et paiements** : `KYC_ENCRYPTION_KEY` (obligatoire en production, 32 octets minimum en hex ou base64 ; sa perte rend les numéros de pièces illisibles, la sauvegarder), `PAYMENT_QR_SECRET` (obligatoire en production, >= 32 car.), `KYC_LIMITS` (JSON optionnel), `PAYMENT_PIN_MAX_ATTEMPTS`, `PAYMENT_PIN_LOCK_MINUTES`.

Le démarrage échoue avec la liste des variables invalides ; c'est le premier contrôle à lire en cas d'échec.

## Construction et lancement

Image (depuis la racine du dépôt ; non construite ni testée à ce jour, Docker n'étant pas installé sur la machine de développement) :

```
docker build -f apps/api/Dockerfile -t caselind-api .
docker run --env-file prod.env -p 3000:3000 -v caselind-media:/data/media caselind-api
```

L'image tourne en utilisateur `node`, `NODE_ENV=production`, avec un `HEALTHCHECK` sur `/v1/health` (vérifie aussi la base). `main.ts` applique les migrations en attente avant d'écouter ; avec plusieurs instances, lancer d'abord une fois `node dist/db/migrate-cli.js` (`npm run db:migrate -w @caselind/api`, `DATABASE_URL` requis) comme étape de déploiement.

Sans Docker : `npm ci`, `npm run build -w @caselind/api`, puis `npm start -w @caselind/api`.

## Observabilité : sondes, métriques, identifiant de requête (cahier §29)

**Sondes** (publiques, sans limitation de débit, aucun détail de version ni de configuration) :

| Route | Rôle | Réponse |
|---|---|---|
| `GET /v1/health/live` | liveness : le processus répond, **sans base** (une panne de base ne doit pas faire redémarrer l'API) | `200 {status:"ok"}` |
| `GET /v1/health/ready` | readiness : base joignable **et** dernière migration livrée avec cette version appliquée | `200`, sinon `503` (`Database unavailable` ou `Migrations pending`) |
| `GET /v1/health` | inchangé : liveness + base ; c'est le `HEALTHCHECK` du Dockerfile | `200 {status:"ok",db:"ok"}` |

Orchestrateur : liveness sur `/v1/health/live`, readiness (retrait du load balancer) sur `/v1/health/ready`.

**Identifiant de requête.** Chaque réponse porte `X-Request-Id`. Un identifiant entrant valide (1 à 64 caractères `A-Za-z0-9._-`) est conservé, sinon un UUID est généré. Il figure dans les journaux pino de la requête (champ `req.id`) et dans toute erreur (`error.requestId`) : le client peut le citer au support, qui retrouve la requête dans les journaux. Les journaux ne contiennent ni corps ni en-têtes d'authentification (`LOG_REDACT_PATHS`).

**Métriques Prometheus** : `GET /metrics` (hors préfixe `/v1`, texte Prometheus 0.0.4). Variable `METRICS_TOKEN` (facultative, 16 caractères minimum ; `openssl rand -hex 24`). Sans elle la route répond `404` ; jeton absent ou faux : `401` ; comparaison à temps constant. Scrape : `Authorization: Bearer <METRICS_TOKEN>` (`authorization` dans `scrape_configs`). **Ne pas exposer `/metrics` publiquement** : l'interdire dans le Caddyfile (ou filtrer par IP) et scraper par le réseau interne.

| Métrique | Contenu |
|---|---|
| `http_requests_total{method,route,status_class}` | requêtes ; `route` = gabarit Nest (`/v1/orders/:id`), jamais l'URL brute ; URL inconnue = `unmatched` |
| `http_request_duration_seconds` (histogramme, `method`, `route`) | latence |
| `process_resident_memory_bytes`, `process_heap_used_bytes`, `process_cpu_seconds_total`, `process_uptime_seconds` | processus |
| `nodejs_eventloop_lag_{mean,p99,max}_seconds` | délai de la boucle d'événements depuis le dernier scrape |
| `pg_pool_connections_total`, `pg_pool_connections_idle`, `pg_pool_waiting_requests` | pool PostgreSQL (10 connexions max) |
| `socketio_connections_active` | connexions Socket.IO authentifiées |
| `caselind_maintenance_runs_total{result}` | exécutions du nettoyage horaire (`success` / `failure`) |
| `caselind_webhook_deliveries_total{status}` | livraisons webhooks (`delivered` / `retry` / `failed`) |
| `caselind_pos_operations_total{type}` | opérations de caisse (`sale` / `void` / `shift_open`) |

Les compteurs sont par processus et repartent à zéro au redémarrage (utiliser `rate()` / `increase()`).

**Règles d'alerte conseillées** (Prometheus, à ajuster après une semaine de trafic réel) :

| Alerte | Expression | Seuil / durée |
|---|---|---|
| Taux de 5xx | `sum(rate(http_requests_total{status_class="5xx"}[5m])) / sum(rate(http_requests_total[5m]))` | > 2 % pendant 5 min |
| Latence p95 | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))` | > 1 s pendant 10 min |
| Boucle d'événements | `nodejs_eventloop_lag_p99_seconds` | > 0,2 s pendant 5 min |
| Pool saturé | `pg_pool_waiting_requests` ; ou `pg_pool_connections_idle == 0` avec `pg_pool_connections_total >= 10` | > 0 pendant 2 min |
| Nettoyage en échec | `increase(caselind_maintenance_runs_total{result="failure"}[2h])` | > 0 |
| Nettoyage absent | `increase(caselind_maintenance_runs_total[3h]) == 0` (instance où `MAINTENANCE_ENABLED=true`) | 3 h |
| Webhooks | `increase(caselind_webhook_deliveries_total{status="failed"}[1h])` | > 20 |
| Mémoire | `process_resident_memory_bytes` | > 80 % de la limite du conteneur |
| Instance prête | sonde `/v1/health/ready` en échec | 2 min |

Non fait : traçage distribué, agrégation centralisée des journaux, tableaux de bord, métriques métier (inscriptions, commandes) ; décision d'hébergement Q6 d'abord.

## Test de fumée après déploiement

`scripts/smoke/smoke.mjs` (Node >= 22, aucune dépendance) vérifie une instance déployée et affiche `OK` / `ECHEC` / `IGNORE` par étape, code de sortie 1 si une étape échoue : `/v1/health`, `/v1/health/ready`, `/v1/openapi.json` (chemins attendus), connexion d'un compte de test, `GET /v1/me`, catalogue, et `/metrics` si `METRICS_TOKEN` est fourni.

```
BASE_URL=https://api.<domaine> SMOKE_IDENTIFIER=smoke@<domaine> SMOKE_PASSWORD=... node scripts/smoke/smoke.mjs
```

`BASE_URL` sans `/v1`. Le compte de test doit exister (inscription via l'application, code OTP reçu par le fournisseur réel) ; sans lui le parcours connecté est `IGNORE` (`SMOKE_REQUIRE_ACCOUNT=1` pour l'exiger). `SMOKE_ORG_SLUG=<boutique>` ajoute le catalogue public. À lancer après chaque `up -d --build` ; en cas d'échec, revenir à l'image précédente. Le script est couvert par `apps/api/test/smoke-scripts.e2e.test.ts`.

## CI (`.github/workflows/ci.yml`)

Jobs : `api` (PostgreSQL **17**, la version déployée par `deploy/docker-compose.yml` ; le développement local utilise 18 embarqué), `mobile`, `web` (typecheck, tests, `vite build`), `docker` (build de l'image API sans publication, cache GitHub Actions) et `audit`. `audit` est **bloquant** : `npm audit --omit=dev --audit-level=high` échoue sur une vulnérabilité haute ou critique des dépendances de production ; les dépendances de développement et les niveaux moderate/low ne bloquent pas (8 « moderate » aujourd'hui, à revoir). Pas de job de lint : ESLint n'est pas une dépendance du dépôt.

## Préparation de l'hébergement (prête, non testée : Docker absent de la machine de développement)

Dossier `deploy/` à la racine : pile d'un seul serveur (VPS) quand l'hébergement sera choisi.

| Fichier | Rôle |
|---|---|
| `deploy/docker-compose.yml` | PostgreSQL 17 (volume `pgdata`, aucun port publié) + API (image `apps/api/Dockerfile`, volume `media`) + Caddy (TLS automatique, WebSocket, `X-Forwarded-*`) |
| `deploy/Caddyfile` | proxy inverse sur `API_DOMAIN`, en-têtes de sécurité |
| `deploy/env.production.example` | modèle de `deploy/prod.env` (ignoré par Git) |
| `deploy/gen-secrets.mjs` | génère les secrets obligatoires (`node deploy/gen-secrets.mjs`), n'écrit rien sur le disque |
| `deploy/backup.sh`, `deploy/restore.sh` | sauvegarde quotidienne (base + médias, 14 jours) et restauration |
| `apps/mobile/eas.json` | profils `development`, `preview` (APK), `production` ; l'adresse de l'API passe par `EXPO_PUBLIC_API_URL` |

Mise en service, une fois un serveur et un nom de domaine disponibles :
1. DNS : `api.<domaine>` vers l'IP du serveur ; ports 80 et 443 ouverts.
2. `cp deploy/env.production.example deploy/prod.env`, y coller la sortie de `gen-secrets.mjs`, renseigner `API_DOMAIN` et les fournisseurs (Brevo, WhatsApp, Expo). **Sauvegarder `KYC_ENCRYPTION_KEY` hors du serveur.**
3. `docker compose -f deploy/docker-compose.yml --env-file deploy/prod.env up -d --build` ; vérifier `https://api.<domaine>/v1/health`.
4. Cron de sauvegarde (voir l'en-tête de `backup.sh`) et copie du dossier de sauvegarde sur une autre machine ; **tester une restauration** avant d'ouvrir au public.
5. Mobile : renseigner l'adresse dans `eas.json`, `npx expo login`, `eas init` (le `projectId` est écrit dans `app.json`), puis `eas build --profile preview --platform android`.

Pour les appels audio/vidéo : un serveur TURN (par exemple coturn sur le même VPS, UDP 3478 et plage de relais) puis les variables correspondantes ; voir « À décider ».

## À décider

- **Q6, hébergement** : staging et production, base managée, stockage S3 et CDN. Pas de déploiement continu avant ce choix.
- **Redis** : limitation de débit, sessions Socket.IO et diffusion temps réel sont en mémoire ; le multi-instance (adaptateur Socket.IO, compteurs partagés) exige Redis. Une seule instance d'ici là.
- **TURN/SFU** pour les appels WebRTC.
- Sauvegardes PostgreSQL et du volume médias, rotation des secrets, métriques et alertes.
