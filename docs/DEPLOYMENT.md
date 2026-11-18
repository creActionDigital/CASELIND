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
