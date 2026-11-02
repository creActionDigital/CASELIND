# Prompt de reprise — CASELIND (à coller dans une nouvelle conversation)

Tu reprends le projet CASELIND dans `E:\CASELIND` (Windows, Git Bash et PowerShell disponibles). Le nom du produit est CASELIND, jamais Casalind.

## Principe fondateur : WeChat est la base fonctionnelle de CASELIND
CASELIND est construit en **reproduisant l'écosystème fonctionnel de WeChat/Weixin** : compte, messagerie, Moments/stories, Channels, comptes officiels, Pay/wallet, mini-programmes, recherche, services. On y ajoute ensuite toutes les exigences propres au cahier des charges (marketplace, vitrines, Mobile Money, CSL Coins, IA, livraison…).
- **La référence de travail est `docs/reverse-engineering/WECHAT_FUNCTIONAL_MAP.md`** : 96 lignes, avec preuves, écarts, écrans, API, tests d'acceptation et état. Chaque module que tu construis doit partir des lignes concernées de cette matrice, puis mettre à jour leur état (planifié → en cours → implémenté → testé).
- On clone **les fonctions et les parcours**, pas l'identité. Ni logo, ni textes de marque, ni assets, ni écrans protégés, ni code propriétaire de WeChat. L'identité visuelle CASELIND est originale.

## REA (reverse engineering) : à utiliser, dans son cadre
- **Au démarrage, vérifie si REA est réellement utilisable** : outils MCP `rea` présents dans la session, ou CLI (`rea`, ou `npx -y rea-agents@latest`). Le 2026-11-01, seul le skill `reverse-engineer-anything` était installé, sans serveur MCP ni CLI. Si REA est disponible, utilise-le pour approfondir la cartographie WeChat module par module, avant de coder chaque module.
- **Cibles légitimes** :
  - comportements observables publiquement (pages web publiques, documentation officielle Weixin/Tencent pour développeurs) ;
  - captures et observations que je fournirais moi-même ;
  - artefacts dont nous avons les droits, comme nos propres builds CASELIND ou les sources SaaS achetées.
- **Interdit** (ADR-009) : décompiler ou extraire le code de l'application WeChat, contourner une authentification ou une protection, récupérer des données privées.
- Si REA est absent, continue avec les sources publiques et la recherche web, en indiquant le niveau de confiance (V / DP / CG / D / I, voir `EVIDENCE_AND_GAPS.md`). Ne prétends jamais avoir utilisé REA si ce n'est pas le cas.

## Commence par lire, dans cet ordre
1. `docs/PROGRESS.md` (état réel et tests exécutés), `docs/BACKLOG.md` (lots, décisions Q1–Q7 en attente), `docs/architecture/CASELIND_ARCHITECTURE.md`, `docs/architecture/DECISIONS.md` (ADR-001 à 013), `docs/architecture/API_CONTRACTS.md`.
2. `docs/reverse-engineering/WECHAT_FUNCTIONAL_MAP.md` (matrice de couverture WeChat → CASELIND) et `SCREEN_INVENTORY.md` (écrans mobiles et navigation imposée).
3. Le cahier des charges `CASELIND_CAHIER_DES_CHARGES_DEFINITIF.md` : seulement les sections utiles au lot en cours (§6 messagerie, §24 notifications, §27 et §32 UX).
4. `git log --oneline` : `1ee71ff` (lots 1 et 1b), `a30d667` (lot 2). L'identité Git est configurée localement pour ce dépôt.

## État au 2026-11-02 (fin de session)
- Backend NestJS 12 (ESM) + PostgreSQL (Drizzle, migrations 0001–0010), contrats Zod dans `packages/contracts`, OpenAPI sur `GET /v1/openapi.json` (toute nouvelle route va dans `apps/api/src/openapi/registry.ts`).
- Lots backend testés : 1, 1b, 2, 3 (messagerie temps réel + push), **4 (social, stories, modération)**. **273 tests sur 273** (`npm test -w @caselind/api`, à lancer **serveurs de dev arrêtés**, sinon le PostgreSQL embarqué des tests peut redémarrer).
- **Mobile M1 codé** (`apps/mobile`, Expo SDK 58, expo-router) : socle, auth, navigation imposée, messagerie temps réel, notifications. 17 tests unitaires ; parcours vérifié sur Expo web contre l'API réelle. **Pas encore validé sur appareil par le propriétaire.**
- Lancement local : `.claude/launch.json` (`db`, `api`, `mobile-web`). `apps/api/.env` est local (non versionné) ; la base de dev doit être en UTF-8 (le migrateur refuse sinon).
- Web non commencé.

## Ordre imposé (ne pas modifier sans mon accord)
Backend → **mobile React Native + Expo** → intégration et validation du mobile → web React + TypeScript + Vite (pas de Next.js). Ne commence pas le web avant la validation du mobile.

## Prochaine étape
1. Faire valider M1 par le propriétaire sur un appareil (Expo Go ou build de développement) et corriger ses retours ; contrôle visuel à 360 px (en-tête, bouton « + »).
2. Mobile M2 : fil, Stories, publication, profil social (backend lot 4 prêt). Design : ADR-016 (style Apple), skills `apple-design` et `ui-ux-pro-max`.
3. Points ouverts du lot 3 dans `docs/BACKLOG.md` (lot 3b) et décision Q8 (compte Expo/EAS pour le push réel).

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
