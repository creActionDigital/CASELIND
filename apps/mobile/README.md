# CASELIND mobile (`@caselind/mobile`)

Expo SDK 58 + expo-router, TypeScript strict. Lot M1a : authentification, AppShell (en-tête global, onglets, feuille Publier), Accueil, Maps, Plus, Compte. Lot M1b : messagerie temps réel et notifications.

## Lancement

```bash
npm install                      # à la racine du monorepo
npm run build -w @caselind/contracts   # les contrats sont consommés depuis dist/
cd apps/mobile
npx expo start                   # QR code (Expo Go / client de développement)
npx expo start --web             # navigateur (vérification uniquement)
```

## API

`EXPO_PUBLIC_API_URL` (défaut `http://localhost:3000/v1`, port par défaut de l'API). Sur un émulateur Android, utilisez `http://10.0.2.2:3000/v1` ; sur un téléphone physique, l'adresse IP de la machine.

Pour Expo web, ajoutez `http://localhost:8081` à `CORS_ORIGINS` dans l'`.env` de l'API (les applications natives n'en ont pas besoin).

## Vérifications

```bash
npm run typecheck -w @caselind/mobile
npx vitest run                   # client API : un seul /auth/refresh pour des requêtes concurrentes
npx expo export --platform web
```

Le refresh token est stocké dans `expo-secure-store` (repli mémoire + `sessionStorage` sur le web, développement uniquement, dans `src/lib/token-store.ts`).

## Messagerie et notifications (M1b)

- Socket unique (`src/realtime/`) : `socket.io-client` 4.8.4, path `/v1/socket.io`, jeton en fonction (reconnexion avec le jeton courant), un seul refresh sur `unauthenticated`, coupé au logout. Les événements alimentent le cache react-query (`src/messaging/cache.ts`, fonctions pures testées).
- Salon : envoi optimiste (`clientId` uuid, boîte d'envoi séparée du cache serveur, réessai avec le même `clientId`), accusés (envoyé/reçu/lu), « écrit… » (émission limitée à 2 s), réponses, réactions, rappel, masquage, images (`expo-image-picker`, `POST /media/uploads` puis `PUT` avec `X-Upload-Token`). Les images sont téléchargées avec le jeton (`AuthImage`, cache mémoire ; `expo-file-system` sur natif, blob URL sur web).
- Notifications : centre et préférences depuis le menu Compte (badge de non-lus). Push (`expo-notifications`, natif seulement) : permission demandée après une explication à l'écran ; sans `projectId` EAS (`extra.eas.projectId`), le jeton Expo est ignoré et journalisé. Au logout, `POST /me/push-tokens/unregister` précède `POST /auth/logout`. Un tap sur une notification `{conversationId}` ouvre le salon.
- Le push et le temps réel se testent sur appareil ou émulateur avec l'API lancée ; le web n'a pas de push.
