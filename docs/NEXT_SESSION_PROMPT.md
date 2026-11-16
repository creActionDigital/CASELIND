# Prompt de reprise — CASELIND (à coller dans une nouvelle conversation)

Tu reprends le projet CASELIND dans `E:\CASELIND` (Windows, Git Bash et PowerShell). Le produit s'appelle CASELIND, jamais Casalind. Réponds en français, brièvement. Le propriétaire veut finir vite, sans erreur, et que tu avances **sans t'arrêter ni redemander le lot** : tu lis le cahier des charges et tu enchaînes.

## À lire d'abord
1. `CASELIND_CAHIER_DES_CHARGES_DEFINITIF.md` (racine) : le cahier maître. Relis la section de chaque lot avant de le cadrer (§39.4 processus, §39.10 rapport de fin de lot, §34 règles non négociables).
2. `docs/BACKLOG.md` : **décisions du propriétaire** et feuille de route des lots, à tenir à jour. `docs/PROGRESS.md` : état réel, tests, différés par lot. `docs/CONTROLE_ET_COMPTES.md`, `docs/architecture/DECISIONS.md`.
3. `git log --oneline` : dernier lot = 20a jeux (quiz éclair).

## Décisions du propriétaire (à respecter)
- **Trading et paris sportifs : RETIRÉS du projet.** Ne rien développer ni proposer.
- Santé et tout le reste : à développer intégralement ; les modules réglementés restent **coupés par défaut côté serveur** (activation par un admin avec confirmation).
- **Lot 19 « services publics » (alertes, urgences, signalements) : reporté à la demande du propriétaire.** Le code est prêt et testé sur la branche `wip/lot19-services-publics` (commit 02bef72, migration 0033), non fusionnée. Ne pas le reprendre sans qu'il le demande ; à la reprise, fusionner, renuméroter la migration si besoin, relancer toute la suite.
- Pas d'argent réel, pas de NFT, CSL Coins (§18) bloqué : règles non spécifiées, ne rien inventer.
- Ne pas inventer de numéros d'urgence, d'agréments ou d'intégrations ; dire honnêtement le statut de chaque intégration (§34).

## État (2026-11-15)
- **Backend** NestJS + PostgreSQL, migrations 0001–0034. **580 tests API**, **231 tests mobile**, typechecks propres. Lots livrés et testés : 1 à 12 (identité, messagerie, social, commerce, livraison, services, wallet sandbox, KYC, mini-apps, mobilité, IA, lieux), 13 finance personnelle, 14 communautés, 15 petites annonces, 16a emploi, 16b freelance (paiement externe, séquestre différé), 17a éducation (cours, quiz, certificats), 18a santé personnelle (consentement, dossier chiffré, rappels), 18b santé professionnels (agrément vérifié, rendez-vous, partage du dossier, ordonnances).
- **Mobile** Expo SDK 58 (`apps/mobile`), mobile validé par le propriétaire. **Web** (React + Vite) : non commencé, après les lots backend.
- Reste à faire, dans l'ordre : **20b jeux (tournois, badges non monétaires, §21)** ; 16c outils professionnels (§14, auditer d'abord l'existant : commandes, stock, coupons, avis, wallet) ; 17b établissements scolaires (§13, **décision du propriétaire requise sur les mineurs / consentement parental**) ; puis le web (§27). Les différés de chaque lot sont dans `docs/PROGRESS.md`.

## Règles de design décidées par le propriétaire
- **Aucun dégradé** : couleur de marque unie `#4F46E5` (`brandColor`, `src/theme/tokens.ts`). Police Poppins. Style Apple.
- Barre du bas flottante : Accueil · Maps · **+** · Messagerie · Plus. En-tête : logo, recherche, **IA visible**, **$ sans montant**, panier, compte. « Stories » = **« Statuts »**. Les nouveaux modules se branchent par une tuile du menu **Plus** (visible selon le drapeau).
- **Une photo de référence par écran, rien d'autre.**

## Méthode (décisions déjà prises)
- **Fais le travail toi-même** ; au plus 1 à 2 sous-agents (modèle `sonnet`), consignes courtes. Économise les tokens.
- Chaque lot : migration forward-only, contrats zod (`packages/contracts`, à reconstruire avec `npm run build -w @caselind/contracts` avant le typecheck API), service + contrôleur NestJS, **OpenAPI à jour** (`src/openapi/registry.ts`, test à double sens), test e2e (`apps/api/test`), export de compte et audit **sans contenu sensible**, signalement/masquage si contenu public, drapeau de fonctionnalité, écrans mobiles, i18n fr+en, puis **vérification à l'écran**, `PROGRESS.md` + `BACKLOG.md`, commit. Ne dis « testé » qu'avec résultats observés ; distingue prévu, codé, testé ; consigne le différé.
- **Piège fins de ligne** : `sed -i` retire les CRLF de `app.module.ts`, `registry.ts`, `i18n/fr.ts`, `i18n/en.ts`, `more.tsx` ; vérifie `git diff --stat` (quelques lignes seulement) et rétablis avec `sed -i 's/\r//g; s/$/\r/' fichier`. Pas de Python sur la machine : scripts en Node (`/tmp/x.mjs`). Ne jamais écraser un fichier existant du même nom (le `health.controller.ts` d'origine est le contrôle de disponibilité).
- **Machine juste en mémoire** : un seul gros processus à la fois ; jamais deux `npm install` en parallèle ; tests API **serveurs de dev arrêtés** (`npm test -w @caselind/api`, ~6 min). `npm run dev` peut manquer de mémoire à la compilation : démarrage manuel = `npm run db:dev -w @caselind/api`, puis `node --env-file=.env dist/main.js` dans `apps/api` (après `npm run build -w @caselind/api`), puis `npx expo start --web --port 8083` dans `apps/mobile`. Arrêt : `taskkill //PID <pid> //T //F` (PID via `netstat -ano`) ; un `postgres.exe` figé se tue par son PID exact.
- Comptes de test (base locale) : `alice@caselind.test`, `bob@caselind.test`, mot de passe `TestPass-2026!`. Le navigateur intégré en vue mobile (375 px) sert à vérifier les écrans ; en cas de blocage, ouvrir un nouvel onglet (la session est à refaire).
- Un module réglementé en dev : l'activer par SQL sur la base locale seulement le temps du test, puis le remettre à `false` et nettoyer les données de test.

## Décisions et comptes qui attendent le propriétaire
- **Sauvegarde du code : aucune copie en ligne** (Git local seulement). Urgent : dépôt GitHub privé à son nom.
- Q2 comptes Brevo (e-mail) et Meta WhatsApp pour les codes (`docs/OTP_SETUP.md`) ; Q5 compte marchand FlexPay (Mobile Money, débloque séquestre freelance et paiements réels) ; Q8 `npx expo login` ; clé Google AI Studio (Gemini) ; Q6 hébergement, nom de domaine, WebRTC/TURN (débloque appels, entretiens et téléconsultation vidéo).
- Mineurs et consentement parental (lot 17b) ; numéros d'urgence officiels (lot 19) ; durée de conservation des données de santé par pays ; règles CSL Coins.

## Lancer Claude Code avec les modèles gratuits d'OmniRoute (PowerShell, depuis `E:\CASELIND`)
Prérequis : OmniRoute en marche (port 20128) et la clé dans `$env:OMNIROUTE_KEY`.
```powershell
$env:ANTHROPIC_BASE_URL = "http://localhost:20128"
$env:ANTHROPIC_AUTH_TOKEN = $env:OMNIROUTE_KEY
$env:ANTHROPIC_MODEL = "auto/coding:free"
$env:ANTHROPIC_SMALL_FAST_MODEL = "auto/coding:free"
claude
```
(`scripts/claude-omniroute.ps1` fait pareil mais ajoute `--continue`, qui reprend la **dernière** conversation : pour une nouvelle conversation, utiliser les lignes ci-dessus.) Les modèles gratuits sont moins fiables : relire chaque diff, lancer **tous** les tests avant chaque commit, ne jamais déclarer « fait » sans résultat observé.

## Skills à utiliser (appel par `/nom`, ou par l'outil Skill)
- `/graphify` : au début de la session, pour interroger l'architecture du dépôt (règle globale de l'utilisateur).
- `/apple-design` et `/ui-ux-pro-max` : à chaque nouvel écran mobile (style Apple, accessibilité, mouvement sobre ; décidé en ADR-016). `/frontend-design` : mise en page et choix visuels. `/motion` : **seulement pour le futur web** (sous React Native on utilise `react-native-reanimated`).
- `/ponytail` : mode « plus petit changement complet » (plugin actif sur cette machine).
- Fin de lot : `/code-review` ; pour tout module santé, argent ou authentification : `/security-review`.
- `/reverse-engineer-anything` : seulement pour cartographier une fonction WeChat à cloner, jamais pour décompiler une application tierce (ADR-009) ; aucun serveur REA n'est connecté.

## Retour d'expérience OmniRoute (modèles gratuits)
Un essai du lot 20a avec `auto/coding:free` (`gpt-oss-120b`) a échoué : modèle de données inventé, code qui ne compile pas, compte rendu qui décrit des tables inexistantes. Avec ces modèles : tâches **courtes et fermées**, une à la fois ; vérifier soi-même `npx tsc --noEmit -p .` et les tests ; ne jamais croire un compte rendu sans lire le diff. OmniRoute met ~30 s à démarrer et manque de mémoire si le navigateur et les serveurs tournent.

## QUESTIONS À POSER AU PROPRIÉTAIRE DÈS LE DÉBUT DE LA CONVERSATION (il n'y a pas encore répondu)
Pose-les **toutes tout de suite**, regroupées en une seule liste numérotée (pas une par une, pas après avoir commencé à coder), puis note les réponses dans `docs/BACKLOG.md` (section « Décisions ») et dans la mémoire. Pendant qu'il répond, enchaîne sur le travail qui ne dépend d'aucune réponse.
1. **Dépôt GitHub privé** (urgent : le code n'existe qu'en local). A-t-il un compte GitHub ? Veut-il que je crée le dépôt privé et pousse (avec son accord explicite) ?
2. **Mineurs et consentement parental** (bloque le lot 17b établissements scolaires §13) : la plateforme ne connaît pas l'âge des comptes. Faut-il demander une date de naissance à l'inscription, un âge minimum, un compte « parent » qui valide l'inscription d'un enfant ? Ou reporter 17b ?
3. **Numéros d'urgence officiels** (lot 19, branche `wip/lot19-services-publics`) : quels numéros fournir (police, pompiers, ambulance, par pays) ? Je n'en invente aucun. Et veut-il reprendre le lot 19 maintenant ou plus tard ?
4. **CSL Coins (§18)** : quelles sont les règles (création, acquisition, dépense, transfert, expiration, conversion, valeur) ? Sans elles, rien n'est codé.
5. **Paiements réels** : compte marchand FlexPay (Mobile Money, question Q5) : l'a-t-il ouvert ? Débloque le séquestre freelance, les frais, les paiements réels (toujours coupés tant que non validés).
6. **Codes de connexion** (Q2) : comptes Brevo (e-mail) et Meta WhatsApp Business créés ? (`docs/OTP_SETUP.md`)
7. **Expo** (Q8) : `npx expo login` fait ? Nécessaire pour les notifications push réelles et la compilation sur téléphone.
8. **Assistant IA** : a-t-il une clé Google AI Studio (Gemini) à configurer ? Veut-il garder OmniRoute (modèles gratuits) comme solution de repli pour l'assistant ?
9. **Hébergement, nom de domaine, WebRTC/TURN** (Q6) : où héberger ? Quel nom de domaine ? Quel service d'appels vidéo ? Débloque appels, entretiens vidéo, téléconsultation en vidéo, le web et la mise en ligne.
10. **Santé** : le module est codé mais coupé. Quand et dans quel pays veut-il l'activer ? Quelle durée de conservation des données de santé par pays (je n'en fixe aucune) ? Quels pays, quelles licences ?
11. **Quiz éclair** : veut-il que je prépare une banque de questions de départ (au moins 10 sont nécessaires pour que le jeu démarre) ? Sur quels thèmes, en quelles langues ?
12. **Outils professionnels (lot 16c, §14)** : après audit de l'existant, quels outils veut-il en priorité (devis, factures, CRM, caisse, campagnes) ?
13. **Web (React + Vite, §27)** : veut-il commencer le web maintenant que le backend est avancé, ou finir d'abord les lots restants (20b jeux, 16c, 17b, 19) ?
14. **Sécurité d'OmniRoute** : il écoute sur `0.0.0.0` sans clé obligatoire. Veut-il que je lui explique comment exiger une clé ou limiter à `localhost` ?
