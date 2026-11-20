# Qualité : ce qui est automatisé, ce qui ne l'est pas (cahier §30)

État au 2026-11-19. Compte des fichiers de test, pas des cas ; les nombres de cas changent à chaque lot (voir `docs/PROGRESS.md` pour les derniers relevés).

## Contrôles automatisés

| Contrôle | Commande (racine du dépôt) | Couvre | CI |
|---|---|---|---|
| Types API | `npm run typecheck -w @caselind/api` | tout `apps/api/src` et `test` | job `api` |
| Tests API (e2e) | `npm test -w @caselind/api` (un fichier : `cd apps/api && npx vitest run test/orders.e2e.test.ts`) | 76 fichiers `test/*.e2e.test.ts` + 9 tests unitaires dans `src/` ; vraie application Nest, **vrai PostgreSQL** (embarqué 18 en local, service `postgres:17` en CI), une base migrée par fichier | job `api` |
| Contrats | `npm run build -w @caselind/contracts` | schémas zod partagés, compilés avant chaque suite | tous les jobs |
| Types + logique mobile | `npm run typecheck -w @caselind/mobile` ; `npm test -w @caselind/mobile` | 46 fichiers de test, **logique pure seulement** (`src/**/*.test.ts`, environnement Node) : i18n, formats, files hors ligne, messages webhooks, etc. | job `mobile` |
| Build web de l'application mobile | `cd apps/mobile && npx expo export --platform web` | l'application compile et s'assemble | job `mobile` |
| Site web (types, tests, build) | `npm run typecheck -w @caselind/web` ; `npm test -w @caselind/web` ; `cd apps/web && npx vite build` | 1 fichier de test (`logic.test.ts`) | job `web` |
| Image Docker de l'API | `docker build -f apps/api/Dockerfile -t caselind-api .` | le Dockerfile construit (sans publication) ; **jamais exécuté localement** (Docker absent) | job `docker` |
| Audit des dépendances | `npm audit --omit=dev --audit-level=high` | vulnérabilités hautes ou critiques de production (bloquant) | job `audit` |
| Registre OpenAPI | inclus dans `test/openapi.e2e.test.ts` | chaque route montée est décrite et inversement | job `api` |
| Test de fumée | `node scripts/smoke/smoke.mjs` (voir `DEPLOYMENT.md`) | une instance déployée ; son exécution contre l'application de test est dans `test/smoke-scripts.e2e.test.ts` | manuel après déploiement |
| Test de charge | `node scripts/load/api-load.mjs` (voir `LOAD_TESTING.md`) | latences, erreurs, débit sous charge sur une instance | manuel |

Dans `apps/api`, lancer **un fichier à la fois** sous Windows quand la mémoire est serrée (erreur 1455 ou worker qui plante : relancer seul).

## Observabilité (cahier §29)

Identifiant de requête corrélé (`X-Request-Id`, journaux, enveloppe d'erreur), `GET /metrics` Prometheus, sondes `/v1/health/live` et `/v1/health/ready` : testés par `test/observability.e2e.test.ts`. Règles d'alerte : documentées dans `DEPLOYMENT.md`, **pas déployées** (aucun Prometheus ni Alertmanager installé).

## Ce qui n'est PAS automatisé

- **Parcours à l'écran** : aucune automatisation de l'interface mobile (pas de Detox/Maestro) ni du site web (pas de Playwright versionné). Les parcours sont vérifiés à la main selon `docs/QA_ECRANS.md`.
- **Rendu des écrans mobiles** : les tests mobiles n'affichent aucun composant React ; seule la logique extraite l'est.
- **Charge réelle** : le script existe mais aucune mesure de référence n'a été faite ; les seuils par défaut sont arbitraires. Pas de test multi-instance ni de WebSocket sous charge.
- **Scan de sécurité** : seulement `npm audit` des dépendances de production. Pas d'analyse statique (CodeQL, Semgrep), pas de scan de secrets, pas de scan de l'image Docker (Trivy), pas de test d'intrusion.
- **Lint et formatage** : ESLint n'est pas installé dans le dépôt (`apps/mobile` a un script `lint` = `expo lint` qui l'exige) ; aucun job de lint en CI tant que la dépendance et sa configuration ne sont pas ajoutées.
- **Couverture de code** : non mesurée.
- **Fournisseurs réels** : Brevo, WhatsApp, Expo Push, paiements mobile money, KYC : testés avec des doubles uniquement (le réseau n'est jamais touché par les tests).
- **Déploiement** : la chaîne Docker, Caddy, sauvegarde et restauration n'a jamais été exécutée de bout en bout.
- **PostgreSQL 17** : la CI vise la version déployée (17) alors que le développement local utilise 18 embarqué ; un écart de comportement ne sera vu qu'à la première exécution de la CI.
- **Appareils réels** (iOS/Android, réseau faible, mode hors ligne prolongé) : manuel uniquement.
