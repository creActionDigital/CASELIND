# Prompt de reprise — CASELIND (à coller dans une nouvelle conversation)

Tu reprends le projet CASELIND dans `E:\CASELIND` (Windows, Git Bash et PowerShell disponibles). Le nom du produit est CASELIND, jamais Casalind.

## Commence par lire, dans cet ordre
1. `docs/PROGRESS.md` (état réel et tests exécutés), `docs/BACKLOG.md` (lots, décisions Q1–Q7 en attente), `docs/architecture/CASELIND_ARCHITECTURE.md`, `docs/architecture/DECISIONS.md` (ADR-001 à 013), `docs/architecture/API_CONTRACTS.md`.
2. `docs/reverse-engineering/WECHAT_FUNCTIONAL_MAP.md` (matrice de couverture WeChat → CASELIND) et `SCREEN_INVENTORY.md` (écrans mobiles et navigation imposée).
3. Le cahier des charges `CASELIND_CAHIER_DES_CHARGES_DEFINITIF.md` : seulement les sections utiles au lot en cours (§6 messagerie, §24 notifications, §27 et §32 UX).
4. `git log --oneline` : `1ee71ff` (lots 1 et 1b), `a30d667` (lot 2). L'identité Git est configurée localement pour ce dépôt.

## État au 2026-11-02
- Backend NestJS 12 (ESM) + PostgreSQL (Drizzle, migrations SQL 0001–0006), contrats Zod partagés dans `packages/contracts`, OpenAPI généré sur `GET /v1/openapi.json`. Le test d'exhaustivité exige que chaque nouvelle route soit ajoutée à `apps/api/src/openapi/registry.ts`.
- Lots testés : 1 (identité), 1b (flags, confidentialité, export et suppression), 2 (organisations et médias). **162 tests sur 162** (`npm test -w @caselind/api`, PostgreSQL embarqué réel, pas de Docker).
- Ni mobile ni web commencés.

## Ordre imposé (ne pas modifier sans mon accord)
Backend → **mobile React Native + Expo** → intégration et validation du mobile → web React + TypeScript + Vite (pas de Next.js). Ne commence pas le web avant la validation du mobile.

## Prochaine étape : lot backend 3 (messagerie et notifications), puis le mobile
Recherche déjà faite (versions vérifiées le 2026-11-01) :
- Installer `@nestjs/websockets@12.3.2`, `@nestjs/platform-socket.io@12.3.2` (socket.io 4.8.4), `expo-server-sdk@8.0.0` ; en devDependency, `socket.io-client@4.8.4`. Aucune contrainte TypeScript 7.
- **Authentification WebSocket au handshake** : un middleware `server.use()` dans `afterInit`, avec le token passé dans `socket.handshake.auth.token` (jamais dans l'URL). Il réutilise la même vérification de session en base que `AuthGuard` (extraire une méthode partagée). `handleConnection` n'est pas attendu par Nest et n'est pas protégé : ne pas y faire l'authentification.
- La garde HTTP globale doit ignorer les contextes non HTTP (`ctx.getType() !== 'http'`). Socket.IO a sa propre configuration CORS.
- Diffuser uniquement via des rooms (`user:<id>`, `conversation:<id>`), pour pouvoir passer plus tard à l'adaptateur Redis. Déconnecter les sockets d'un utilisateur quand une session est révoquée ou un compte suspendu.
- Push : un port `PushGateway`, avec un adaptateur Expo (seul fichier qui importe expo-server-sdk) et un faux adaptateur pour les tests (jamais de réseau en test). Envoyer après le commit, sans faire échouer la requête. Supprimer les jetons `DeviceNotRegistered`.
- La messagerie doit appliquer les blocages (`PrivacyService.isBlockedEitherWay`), les réglages `contactRequestsFrom` et `readReceipts`, et étendre `canRead` des médias aux pièces jointes de conversation (point d'extension dans `apps/api/src/media/access.ts`).
- Migrations suivantes : 0007+.

Ensuite : le **mobile Expo** (`apps/mobile`).
- Navigation imposée en bas d'écran : Accueil · Maps · + Publier · Messagerie · Plus.
- En-tête : logo CASELIND, recherche, wallet avec devise, panier, menu compte.
- Stories en haut de l'accueil.
- Le refresh token est stocké dans `expo-secure-store`, avec un seul rafraîchissement à la fois.

## Méthode de travail (décisions déjà prises avec moi)
- Sois autonome : ne me demande que les décisions métier, financières, réglementaires ou les dépenses.
- **Délègue à des sous-agents**, au plus deux en parallèle, chacun avec ses propres fichiers (migration et module dédiés). Les fichiers partagés (`app.module.ts`, `schema.ts`, `audit.service.ts`, `registry.ts`, l'index des contrats) se modifient par petites retouches, relues juste avant.
- **Économie de tokens** : briefs précis, rapports d'agents de 15 lignes maximum, une seule passe revue + vérification par lot, une seule exécution complète des tests par lot avant le commit. Pas de re-recherche de faits déjà établis ici.
- Après chaque lot : je vérifie moi-même (typecheck + tests), mise à jour de `docs/PROGRESS.md` et `docs/BACKLOG.md`, puis commit (message terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Ne jamais déclarer « validé » sans validation de ma part ; distinguer prévu / codé / testé.

## Outils
- Skills utiles :
  - `frontend-design`, `ui-ux-pro-max`, `apple-design` et `motion`, pour le design system et les écrans mobiles ;
  - `graphify`, si une carte des dépendances aide.
- REA (`reverse-engineer-anything`) : seul le skill est installé, sans serveur MCP ni CLI. Ne pas décompiler WeChat (ADR-009). Cartographie fondée sur des sources publiques.
- Navigateur intégré, et MCP Playwright s'il se connecte, pour vérifier le web et Expo web plus tard.
- Plugins `ecc`, `claude-mem` et `claude-code-setup` désactivés par choix (coût en tokens). Les agents de revue se font avec des sous-agents généralistes.

## Décisions qui m'attendent (ne bloquent que leur module)
Q1 pays et devises · Q2 fournisseur SMS · Q3 sources SaaS achetées · Q4 règles CSL Coins · Q5 partenaire de paiement · Q6 hébergement et stockage objet · Q7 découverte de proximité.
