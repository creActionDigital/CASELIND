# Test de charge

Outil : `scripts/load/api-load.mjs` (Node >= 22, `fetch` natif, aucune dépendance). Il connecte des comptes de test, puis fait tourner des utilisateurs virtuels qui mélangent lectures (catalogue, fiche produit, recherche, fil, lieux) et une écriture légère (panier). Il mesure p50 / p95 / p99, taux d'erreur et débit.

## Lancer

```
BASE_URL=http://localhost:3000 USERS=20 DURATION_S=60 RAMP_S=10 node scripts/load/api-load.mjs
```

| Variable | Défaut | Rôle |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | racine de l'API, sans `/v1` |
| `USERS` | 10 | utilisateurs virtuels simultanés |
| `DURATION_S` | 30 | durée totale |
| `RAMP_S` | 5 | montée en charge : l'utilisateur *i* démarre à *i*/`USERS` x `RAMP_S` |
| `THINK_MS` | 200 | pause moyenne entre deux requêtes d'un utilisateur |
| `ACCOUNTS` | comptes de `scripts/seed-demo.mjs` | `identifiant:motdepasse,identifiant:motdepasse` |
| `ACCOUNTS_FILE` | - | JSON `[{"identifier":"...","password":"..."}]` (prioritaire sur `ACCOUNTS`) |
| `P95_MS` | 800 | seuil : p95 global en ms |
| `ERROR_RATE` | 0.01 | seuil : part de réponses non 2xx (réseau, 4xx, 429, 5xx) |
| `OUT_FILE` | - | écrit le rapport JSON dans ce fichier |
| `JSON=1` | - | n'affiche que le JSON sur la sortie standard |

Code de sortie : `0` seuils tenus, `1` seuil dépassé, `2` préparation impossible (aucune connexion). Utilisable en CI ou après un déploiement.

## Comptes de test

L'inscription exige un code OTP envoyé hors de l'API ; le script **ne s'inscrit donc pas** : il se connecte à des comptes existants (`POST /v1/auth/login`). Les utilisateurs virtuels se répartissent sur les comptes fournis (plus d'utilisateurs que de comptes = comptes partagés ; le limiteur étant par client, un seul compte suffit pour une première mesure).

- En développement : `node scripts/seed-demo.mjs` crée `alice@caselind.test` ... `hugo@caselind.test` (mot de passe `TestPass-2026!`, valeur par défaut du script). Le fournisseur OTP `console` écrit les codes dans le journal de l'API (voir l'en-tête de `seed-demo.mjs`).
- Ailleurs : créer 2 à 5 comptes dédiés par l'application, puis `ACCOUNTS=...`. Ne jamais lancer la charge sur la production avec de vrais comptes clients.

Les opérations dont le module est désactivé (403/404, par exemple `commerce`) sont ignorées avec un avertissement et ne comptent pas comme erreurs. Sans produit publié, le panier se limite à `GET /v1/cart`.

## Que surveiller

Pendant le test, scraper `/metrics` (voir `docs/DEPLOYMENT.md`) :

- `pg_pool_waiting_requests` > 0 : pool de 10 connexions saturé, première limite à atteindre ;
- `nodejs_eventloop_lag_p99_seconds` : au-delà de 0,2 s le processus est saturé en CPU ;
- `process_resident_memory_bytes` : croissance continue = fuite ;
- `http_request_duration_seconds` par `route` : la route lente ;
- journaux : `X-Request-Id` d'une requête lente ou en erreur.

Réponses 429 : le limiteur (`RATE_LIMIT_PER_MINUTE`, 120 par défaut) est **par client**, donc une charge issue d'une seule machine le déclenche vite. Pour mesurer le serveur et non le limiteur, relancer l'API de test avec `RATE_LIMIT_PER_MINUTE=100000` ; pour mesurer le limiteur, laisser la valeur de production et lire la ligne « refus 429 ». La connexion initiale est limitée par `AUTH_RATE_LIMIT_PER_MINUTE` (le script réessaie après 7 s).

## Limites

- **Une seule instance** : limiteur de débit, Socket.IO et sessions temps réel sont en mémoire (voir « À décider » de `DEPLOYMENT.md`) ; la charge multi-instance n'est pas représentative tant que Redis n'est pas en place.
- Générateur sur une seule machine et un seul processus Node : au-delà de quelques centaines de req/s, c'est lui qui sature. Il ne simule ni WebSocket, ni envoi de médias, ni paiements, ni paliers d'écriture lourde.
- Lectures de démonstration : la base de test est petite ; les latences d'une base de production volumineuse seront plus hautes (index, pagination).
- Seuils par défaut arbitraires : les fixer après une mesure de référence sur l'infrastructure cible. Aucune mesure de référence n'existe encore.
- Le calcul des percentiles (rang le plus proche) est testé par `apps/api/test/load-stats.test.ts` ; l'exécution du script contre une instance réelle l'est par `apps/api/test/smoke-scripts.e2e.test.ts` (2 utilisateurs, 2 s).
