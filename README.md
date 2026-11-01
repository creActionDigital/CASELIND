# CASELIND

Super-application multi-services : commerce, social, messagerie, services locaux, wallet, mini-apps. Le cahier des charges de référence est [CASELIND_CAHIER_DES_CHARGES_DEFINITIF.md](CASELIND_CAHIER_DES_CHARGES_DEFINITIF.md).

**Ordre de développement imposé : backend → mobile (Expo) → web.** État courant : [docs/PROGRESS.md](docs/PROGRESS.md).

## Structure

| Chemin | Rôle | État |
|---|---|---|
| `apps/api` | API NestJS 12 + PostgreSQL (Drizzle) | Lots 1 et 1b testés |
| `packages/contracts` | Schémas Zod partagés api/mobile/web | en place |
| `apps/mobile` | React Native + Expo | à venir (phase 2) |
| `apps/web` | React + TypeScript + Vite | à venir (phase 3) |
| `docs/` | Cartographie WeChat, architecture, contrats, backlog, suivi | à jour |

## Démarrer l'API en local (Windows, macOS, Linux ; Docker non requis)

Prérequis : Node.js ≥ 22.

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

Remplissez `JWT_ACCESS_SECRET` et `OTP_PEPPER` dans `apps/api/.env`, par exemple avec :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Dans un premier terminal, lancez la base PostgreSQL locale embarquée (données dans `apps/api/.data`) :

```bash
npm run db:dev -w @caselind/api
```

Dans un second terminal, lancez l'API. Elle tourne sur http://localhost:3000/v1 et applique les migrations au démarrage :

```bash
npm run dev -w @caselind/api
```

En développement, les codes OTP s'affichent dans le log de l'API (`[DEV ONLY]`). Aucun SMS n'est envoyé.

## Tests

```bash
npm test -w @caselind/api
```

Les tests démarrent leur propre PostgreSQL réel et créent une base par fichier. Pour utiliser un serveur existant (CI), définissez `TEST_DATABASE_ADMIN_URL`.

## Documentation

- Cartographie fonctionnelle WeChat → CASELIND et matrice de couverture : [docs/reverse-engineering/WECHAT_FUNCTIONAL_MAP.md](docs/reverse-engineering/WECHAT_FUNCTIONAL_MAP.md)
- Écrans : [SCREEN_INVENTORY.md](docs/reverse-engineering/SCREEN_INVENTORY.md) · Parcours : [USER_FLOWS.md](docs/reverse-engineering/USER_FLOWS.md) · Preuves : [EVIDENCE_AND_GAPS.md](docs/reverse-engineering/EVIDENCE_AND_GAPS.md)
- Spécification OpenAPI 3.1, générée depuis les contrats Zod : `GET /v1/openapi.json` (API lancée : http://localhost:3000/v1/openapi.json)
- Architecture : [docs/architecture/CASELIND_ARCHITECTURE.md](docs/architecture/CASELIND_ARCHITECTURE.md) · Décisions : [DECISIONS.md](docs/architecture/DECISIONS.md) · API : [API_CONTRACTS.md](docs/architecture/API_CONTRACTS.md)
- Backlog et décisions attendues : [docs/BACKLOG.md](docs/BACKLOG.md) · Sources SaaS : [docs/SAAS_INVENTORY.md](docs/SAAS_INVENTORY.md)

## Règles

Aucun secret dans le dépôt (`.env` ignoré). Fonctions réglementées (paiements réels, paris, trading réel, santé) désactivées tant que la validation n'est pas faite. Migrations SQL forward-only : ne jamais modifier une migration appliquée.
