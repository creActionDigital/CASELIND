# Prompt de reprise — CASELIND (à coller dans une nouvelle conversation)

Tu reprends le projet CASELIND dans `E:\CASELIND` (Windows, Git Bash et PowerShell). Le produit s'appelle CASELIND, jamais Casalind. Réponds en français, brièvement.

## À lire d'abord
1. `docs/PROGRESS.md` (état réel, tests exécutés), `docs/BACKLOG.md` (lots, décisions Q1–Q9), `docs/architecture/DECISIONS.md` (ADR-001 à 022), `docs/architecture/API_CONTRACTS.md`, `docs/CONTROLE_ET_COMPTES.md` (qui contrôle quoi).
2. `docs/reverse-engineering/WECHAT_FUNCTIONAL_MAP.md` et `SCREEN_INVENTORY.md`. WeChat est la base fonctionnelle (on clone les fonctions, jamais l'identité ni le code). REA n'est pas connecté ici ; ne décompile aucune application tierce (ADR-009).
3. `git log --oneline` : dernier commit de code `0484be7` (refonte design).

## État (2026-11-14)
- **Backend** NestJS 12 + PostgreSQL (migrations 0001–0024), lots 1 à 12 testés : identité, 2FA, organisations, médias, messagerie temps réel, notifications push, social, stories (« statuts »), modération, commerce, livraison, services, wallet **sandbox**, KYC, QR, mini-apps OAuth, mobilité, IA multi-fournisseurs, recherche, lieux. **509 tests API** ; mobile **208 tests**. Aucun argent réel, aucune clé de service externe active.
- **Mobile** Expo SDK 58 (`apps/mobile`) : tous les écrans des lots codés ; refonte du design faite d'après le dossier `C:\Users\HP\Desktop\CASELIND Design\Modals` (règles ci-dessous). Planche de maquettes : `Desktop\CASELIND Design\index.html`.
- **Web** : non commencé. Ordre imposé : backend → mobile → validation du mobile par le propriétaire → web (React + Vite, pas de Next.js).

## Ce qui attend, dans l'ordre
1. **`npm run dev` à la racine ne marche pas** (« Missing script: dev »). Le propriétaire veut une seule commande qui lance base + API + application. À écrire : un script racine (base `npm run db:dev -w @caselind/api` ; API compilée `node --env-file=.env dist/main.js` depuis `apps/api` après `npm run build -w @caselind/api` ; Expo web `npx expo start --web --port 8083` dans `apps/mobile`). Le mode `--watch` de l'API redémarre en boucle quand Expo touche `node_modules` : utiliser l'API compilée.
2. **Vérifier et améliorer les designs** (demande du propriétaire) avec les skills `apple-design` et `ui-ux-pro-max` et du mouvement. Framer Motion est du web : sous React Native, utiliser `react-native-reanimated` s'il est installé (le skill `motion` servira au futur web). Animations sobres, respect de « réduire les animations ».
3. Images du dossier `Modals` non attribuées : `card`, `kyc`, `communities`, `MarketPlace`. Demander au propriétaire pour quels écrans.
4. Puis lots 13+ (santé, éducation, emploi, immobilier, services publics, jeux, trading simulation, finance personnelle) et le web, **seulement après validation du mobile**.

## Règles de design décidées par le propriétaire
- **Aucun dégradé** : couleur de marque unie `#4F46E5` (`brandColor`, `src/theme/tokens.ts`). Police Poppins. Style Apple.
- Logo : « C » ouvert + point, indigo uni (`Desktop\CASELIND Design\Logo`).
- Barre du bas flottante : Accueil · Maps · **+** (Live · Vidéos · Posts · Produits) · Messagerie · Plus. En-tête : logo, recherche, **IA bien visible**, **$ sans montant** (le solde n'est que dans l'écran Wallet), panier, compte.
- « Stories » s'appellent **« Statuts »**. Maps : boutiques, restaurants, pharmacies, stations-service. Paris, trading, jeux : mini-applications dans le menu Plus, pas dans le cœur.
- **Une photo de référence par écran, rien d'autre** : n'applique pas à un écran une image qui ne lui est pas attribuée.

## Lancement local (si rien ne tourne)
Trois processus : base, API, Expo web (commandes ci-dessus). Un ancien Expo peut occuper le port 8083 : le stopper d'abord. Comptes de test (base locale) : `alice@caselind.test` et `bob@caselind.test`, mot de passe `TestPass-2026!`. La base de dev doit être en UTF-8.

## Méthode (décisions déjà prises)
- **Fais le travail toi-même** ; le propriétaire a reproché de tout déléguer. Au plus 1 à 2 sous-agents (modèle `sonnet`), consignes courtes, comptes rendus de 10 lignes. Il veut aussi **économiser les tokens**.
- Machine juste en mémoire : un seul gros processus à la fois ; **jamais deux `npm install` en parallèle** (corruption de paquets) ; lancer les tests API serveurs de dev arrêtés (`npm test -w @caselind/api`).
- Après chaque lot : typecheck + tests, mise à jour de `docs/PROGRESS.md` et `docs/BACKLOG.md`, commit. Ne dis « validé » qu'après validation du propriétaire ; distingue prévu, codé, testé.
- Signale toujours ce dont tu as besoin pour le projet (comptes, clés, décisions).

## Décisions et comptes qui attendent le propriétaire
- **Sauvegarde du code : aucune copie en ligne** (dépôt Git local seulement). Urgent : dépôt GitHub privé à son nom.
- Q2 comptes Brevo (e-mail) et Meta WhatsApp pour les codes (`docs/OTP_SETUP.md`) ; Q5 compte marchand FlexPay (Mobile Money) ; Q8 `npx expo login` ; clé API Google AI Studio (Gemini) pour l'assistant ; Q6 hébergement et nom de domaine.
- Des photos libres de droits (CC0) ont été ajoutées aux produits de démo de la base locale : données de test seulement, non versionnées.
