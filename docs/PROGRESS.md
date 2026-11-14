# Suivi d'avancement CASELIND

## 2026-11-08 — Mobile M7 (mobilité) et écrans de l'assistant IA

- **Assistant IA (écrit par l'orchestrateur)** : `src/ai/*` et `app/(app)/ai/*` : conversations privées, discussion avec le modèle indiqué sous chaque réponse, suppression, réglages (choix du modèle avec gratuité, vitesse et utilisation des données, avertissement obligatoire, bascule optionnelle), tuile « Assistant IA ». Vérifié dans le navigateur sans clé : liste, création, message « assistant indisponible » avec la question conservée, réglages « aucun modèle disponible ».
- **M7 mobilité (agent)** : commande avec estimation par type, maintenant ou programmée, course en direct (code de départ, distance du chauffeur, messages rapides, partage, alerte, annulation avec motif, reçu, évaluation), historique, lieux favoris, contacts de confiance, espace chauffeur (profil, KYC, en ligne avec consentement, demandes, code par pavé). Écran Courses vérifié dans le navigateur.
- **Défaut corrigé par l'orchestrateur (API mobilité)** : un profil chauffeur enregistré sans `photoMediaId` effaçait la photo et, compté comme une modification, renvoyait un chauffeur approuvé en revue et hors ligne. Absent = conserver, `null` = retirer. Test ajouté ; il échoue sans le correctif (vérifié).
- **Tests** : typecheck 0 erreur ; mobile **18 fichiers, 199 tests** ; API mobilité 16 tests (suite API complète non relancée : seul le service de mobilité a changé depuis la dernière exécution complète).

## 2026-11-08 — Lots backend 10 (mini-apps), 11 (mobilité), 12 (assistant IA)

- **10, mini-apps** (0021, ADR-021) : applications d'organisations validées par un admin, OAuth 2.0 avec PKCE S256 obligatoire, codes et jetons hachés, scopes, jetons d'app refusés sur les routes utilisateur, paiement sandbox toujours confirmé par le PIN de l'utilisateur, révocation, annuaire.
- **11, mobilité** (0022) : chauffeurs approuvés par un admin avec KYC niveau 1, estimation affichée comme telle, types moto/standard/confort avec fourchette de prix, arrêt intermédiaire, course programmée, un seul chauffeur gagnant sous concurrence, code de départ, partage du trajet, alerte aux contacts de confiance, évaluations, messages rapides, lieux favoris, reçu ; paiement en espèces. Fonctions inspirées des usages publics d'une app de type Uber, implémentation originale ; REA non utilisé (non connecté, et décompiler l'app d'un tiers est exclu, ADR-009).
- **12, assistant IA** (0023, ADR-022) : port multi-fournisseurs (Gemini par défaut, Groq, Mistral, OpenRouter, compatible OpenAI), modèles activés par l'admin et disponibles seulement avec une clé, choix de l'utilisateur, avertissement exigé pour un modèle qui entraîne sur les données, bascule seulement si acceptée, quotas, aucun contenu dans les journaux, aide à la rédaction de fiches produit (jamais publiée automatiquement). Format Gemini relu par l'orchestrateur (`v1beta/models/{model}:generateContent`, en-tête `x-goog-api-key`).
- **Fait par l'orchestrateur** : initiales à la place d'une roue sans fin pour une image absente (`AuthImage`, test ajouté), libellé du signalement « Course », test des lieux mis à jour (adresses favorites enregistrées volontairement).

### Tests réellement exécutés (2026-11-08)
- `npm run typecheck` : 0 erreur. API : **41 fichiers, 509 tests réussis** (508 au passage complet, puis le test des lieux mis à jour et relancé seul). Mobile : **183 tests réussis**.

### Limites
- Aucune clé IA : les fournisseurs n'ont été testés qu'avec un `fetch` simulé. Pas d'écrans mobiles pour mini-apps, mobilité et IA. Pas de revue de code dédiée (mode économe).
- Mobilité : les courses conservent départ, arrêt et arrivée ; le chauffeur ne garde que sa dernière position en ligne ; pas d'historique de trajet.

## 2026-11-08 — Mobile M6 (livraison, services et réservations)

- **M6a** : livraison ou retrait au checkout (un choix pour le panier, zone et frais par boutique), suivi acheteur (code de livraison masquable, position du livreur en direct, évaluation), zones et affectation des livreurs côté vendeur, « Mes livraisons » pour le livreur (code par pavé PIN, partage de position consenti pendant le trajet seulement).
- **M6b** : découverte des services (catégories, recherche, distance), fiche d'offre et créneaux, réservation, « Mes réservations » (annulation, devis, avis), espace prestataire (offres, disponibilités, demandes, avis).
- **Tests** : typecheck 0 erreur ; mobile **15 fichiers, 181 tests réussis**. Navigateur : page Services (15 catégories, état vide) et checkout (Livraison / Retrait, frais, paiement à la livraison) affichés contre l'API réelle. Parcours complets (réservation, livraison avec code) non exercés à l'écran.

## 2026-11-08 — Lots backend 8 (livraison) et 9 (services et réservations)

### Réalisé (2 agents, mode économe)
- **8, livraison** (migration 0019, `src/delivery/*`) : zones et frais par organisation, choix livraison ou retrait gratuit au checkout, affectation et réaffectation d'un livreur (rôle `delivery`), statuts append-only synchronisés avec la commande, preuve par code à 6 chiffres (HMAC, 5 essais puis verrou), position du livreur avec consentement pendant le trajet seulement (dernière position, effacée à la fin, visible de l'acheteur seul), évaluation du livreur.
- **9, services et réservations** (0020, `src/services/*`, flag `services`) : 15 catégories, offres d'organisations ou de prestataires individuels (prix fixe ou sur devis, « non vérifié » affiché, « urgent » et « garanti » seulement si renseignés), disponibilités et créneaux, réservation sans double réservation (verrou + index unique), devis, annulation avec délai, paiement sur place seulement, avis vérifiés, découverte par distance.
- Raccords : écran de commande mobile (`fulfillment`), libellés de signalement, test des lieux (les offres de service publient une zone, aucune position d'utilisateur n'est stockée).

### Tests réellement exécutés (2026-11-08)
- `npm run typecheck` : 0 erreur. API : **38 fichiers, 467 tests réussis** (466 au passage complet, puis le test des lieux corrigé et relancé seul). Mobile : 137 tests réussis.

### Limites
- Pas d'écrans mobiles pour la livraison (zones, livreur, code) ni pour les services : à faire (M6).
- Pas de revue de code dédiée sur ces deux lots (mode économe) : suite complète seulement.
- Photos des offres de service non testées.

## 2026-11-07 — Mobile M5 (recherche, lieux, QR, sécurité, KYC, messagerie)

### Réalisé (4 agents mobiles en parallèle, puis 1 agent API)
- **M5a** : recherche universelle (onglets, « Voir plus », historique contrôlable, 429) ; onglet Maps : boutiques par distance autour de Goma, rayon, types, « Utiliser ma position » (position jamais stockée), itinéraire vers l'app de cartes ; emplacement de boutique dans l'espace vendeur.
- **M5b** : scanner universel (`expo-camera`, repli « Coller un code »), paiement marchand avec PIN et reçu, QR de boutique (création, réaffichage, révocation), QR de profil (`react-native-qrcode-svg`).
- **M5c** : connexion en deux étapes, activation/désactivation de la 2FA avec codes de secours, changement d'identifiant (ADR-020), approbation de connexion web, KYC niveaux 1 et 2 avec photos, section « Sécurité » du compte.
- **M5d** : transférer, favoris, messages éphémères, messages programmés, brouillons synchronisés.
- **API** : `twoFactorEnabled` dans `/me`, emplacement d'org, réaffichage d'un QR, `draft` sur les conversations, `favorited` sur les messages.
- **Correctif** : l'app restait bloquée sur l'écran de chargement si `/me` ne respectait pas le contrat (cas d'une API plus ancienne que l'app) : retour à la connexion.

### Tests réellement exécutés (2026-11-07)
- `npm run typecheck` : 0 erreur. API : **36 fichiers, 443 tests, 443 réussis**. Mobile : **13 fichiers, 137 tests, 137 réussis**.
- **Navigateur intégré contre l'API réelle** : recherche « goma » (boutique + 2 produits), onglet Maps (Goma Market à 2,3 km), scan par collage d'un QR marchand de 3,00 $ → récapitulatif → PIN → reçu ; wallet de la boutique crédité de 3,00 $ ; QR à usage unique refusé au second paiement (`already_used`).

### Limites
- Caméra, 2FA, KYC, transfert et messages programmés : non exercés à l'écran. Rien sur appareil réel.
- Une installation concurrente avait corrompu `expo-camera` (réinstallé) : ne jamais lancer deux `npm install` en parallèle.
- Une boutique sans logo affiche une roue de chargement au lieu de ses initiales (recherche, lieux).

## 2026-11-07 — Lots 6 (wallet sandbox), 7 (lieux, recherche), 1c, 3b, 5b, OTP, CI et mobile M4a

### Exécution
Jusqu'à 7 agents en parallèle sur des fichiers disjoints (demande du propriétaire), puis deux revues parallèles (argent et commerce ; identité, messagerie et recherche), suite complète unique et contrôle dans le navigateur.

### Réalisé
- **6A, ledger et wallet sandbox** (migration 0013) : partie double, écritures append-only, somme nulle vérifiée par la base, solde jamais négatif, verrous ordonnés, idempotence (même clé et autres montants → 409), limites KYC, comptes gelés, réconciliation admin et horaire, recharge de test plafonnée et coupée en production, wallet d'organisation. Flag `wallet.sandbox` ; `wallet.real_money` reste coupé.
- **6B, KYC, PIN, QR** (0014) : niveaux 0–2 validés à la main par un admin (pas d'auto-validation), numéro de pièce chiffré AES-256-GCM, documents lisibles par le propriétaire et l'admin d'une demande ; PIN Argon2id (5 essais, verrou, `attemptsRemaining`/`lockedUntil`) ; QR marchand HMAC (montant fixe ou libre, expiration, usage unique, révocation).
- **Envoi des OTP** (ADR-018, `docs/OTP_SETUP.md`) : e-mail Brevo et WhatsApp Cloud API, routage par canal, console en dev, clés exigées en production.
- **1c** (0018) : TOTP maison (RFC 6238) et codes de secours, connexion en deux étapes, changement d'identifiant par OTP, connexion web par QR (secret de poll hors du QR, jetons délivrés une fois).
- **3b** (0017) : transfert, favoris, messages éphémères et programmés, brouillons.
- **7** (0016, ADR-019) : lieux d'organisation triés par distance (haversine sans PostGIS), recherche universelle respectant visibilité, blocages et consentement de découverte, historique contrôlable.
- **5b** (0015) : contact du vendeur, avis par organisation, `details.reason` sur les 409 du catalogue, rôle `stock`, devise des coupons.
- **CI** (`e67bcbc`) : GitHub Actions, Dockerfile, `docs/DEPLOYMENT.md` (non exécutés ici : pas de Docker).
- **Mobile M4a** : puce Wallet avec solde masquable, écran Wallet (USD/CDF, niveau KYC et limites, historique), envoi avec pavé PIN, recharge de test, réception par @handle, PIN, wallet d'organisation ; bandeau « Mode test » partout.
- **Revues** : 10 défauts corrigés, dont l'idempotence qui renvoyait le premier transfert pour un montant différent (élevé), un interblocage possible des paiements QR, la lecture admin de documents KYC non soumis, `contactUserId` exposé aux anonymes, le secret de session QR et les coordonnées de recherche dans les journaux, la force brute du 2FA (quota auth), un message éphémère signalable après expiration, le test OTP instable.

### Tests réellement exécutés (2026-11-07)
- `npm run typecheck` : 0 erreur. API : **36 fichiers, 439 tests, 439 réussis** (un test d'export corrigé et relancé seul). Mobile : **9 fichiers, 94 tests, 94 réussis**.
- **Navigateur intégré contre l'API réelle** : recharge de test de 50 $ ; envoi de 12,50 $ à Bob ; PIN faux → « Essais restants : 4 » ; PIN juste → nouveau solde 37,50 $ ; solde de Bob 12,50 $ côté API ; écran Wallet et historique conformes.

### Limites et décisions ouvertes
- Aucun argent réel : FlexPay (Q5) à contracter. Envoi des OTP réels : comptes Brevo et Meta à créer (Q2).
- Décidé (ADR-020) : pas de second facteur pour changer d'identifiant. À traiter : délai de `password/forgot` qui distingue un compte connu.
- Non exercés à l'écran : espace vendeur, wallet d'organisation, recherche (pas encore d'écran mobile), 2FA (pas d'écran mobile).
- La notification « Nouvelle connexion » affiche « other » comme appareil quand le client ne fournit pas de nom.

## 2026-11-07 — Mobile M3 (boutique, commandes, espace vendeur)

### Réalisé (`apps/mobile`)
- **M3a, acheteur** : boutique (catégories, recherche, filtres, tri, grille), fiche produit (galerie, sélecteur de variantes avec ruptures, quantité, avis), vitrine d'org `store/[slug]`, panier groupé par boutique et devise avec vrai compteur dans l'en-tête, commande (adresse, code promo par boutique, **paiement à la livraison seul**, `clientId`), « Mes commandes » (frise, annulation si en attente, avis sur les lignes livrées), notifications `commerce` qui ouvrent la commande.
- **M3b, vendeur** : « Espace vendeur » dans le menu Compte (ou « Créer ma boutique », invitations), tableau de bord, éditeur de produit (10 photos réordonnables, variantes, brouillon, publication, archivage), ajustements de stock, commandes reçues (onglets, appel `tel:`, transitions autorisées seulement, annulation avec note), coupons, réponses aux avis ; boutons masqués selon le rôle. Envoi des médias factorisé (`uploadImage(uri, mime, purpose)`).
- Correction après contrôle visuel : barres d'action du bas (fiche produit, panier, commande) rendues opaques.

### Tests réellement exécutés (2026-11-07)
- `npm run typecheck` : 0 erreur ; mobile `vitest` : **8 fichiers, 78 tests, 78 réussis**.
- **Navigateur intégré (375 × 812) contre l'API réelle** : Bob crée « Goma Market » et publie 2 produits (USD et CDF) par l'API ; Alice voit la boutique (prix « 9,00 $US », « 25 000,00 CDF »), ajoute le café 250 g au panier, commande (paiement à la livraison) → commande `CL-EJRB4N5Q` en attente ; Bob la confirme par l'API → Alice voit « Confirmée » et la frise ; stock 25 → 24.

### Limites
- Espace vendeur et éditeur de produit : codés, non exercés à l'écran.
- Contrats à compléter (lot 5b) : contact du vendeur depuis une commande, liste des avis par organisation, `details.reason` sur les 409 du catalogue (SKU, publication), lecture des variantes pour le rôle `stock`, devise du minimum d'un coupon en pourcentage.
- En dev, le mode `--watch` de l'API redémarre en boucle quand Expo touche `node_modules` : lancer l'API compilée (`node --env-file=.env dist/main.js`).

## 2026-11-07 — Lot backend 5 (commerce)

### Réalisé
- **5A, catalogue** (migration 0011, `apps/api/src/catalog/*`, flag `commerce`) : 10 catégories, produits d'organisation (brouillon, publié, archivé) avec 1 à 50 variantes (options, SKU unique par org, prix en unités mineures, devise parmi `COMMERCE_CURRENCIES`, défaut `USD,CDF`), stock à mouvements append-only jamais négatif, vitrine connectée (recherche, filtres, tri) et vitrine publique d'org, cible de modération `product`.
- **5B, commandes** (migration 0012, `src/cart/*`, `src/orders/*`, `src/reviews/*`) : panier multi-vendeurs ; checkout en une transaction → **une commande par (org, devise)**, réservation de stock tout ou rien, copies figées, idempotence `clientId` ; cycle `pending → confirmed → preparing → shipped → delivered` et annulation (stock rendu), événements append-only ; coupons d'org (pourcentage ou montant, minimum, dates, limites) ; avis réservés aux acheteurs livrés, réponse du vendeur ; notifications `commerce` sans données personnelles. **Paiement : `cash_on_delivery` seulement** (ADR-017).
- Port `CatalogPort` entre catalogue et commandes (aucun module n'importe les tables de l'autre).
- **Revue** : 1 défaut élevé (une variante d'org privée ou d'un vendeur bloqué pouvait être mise au panier et commandée), 2 moyens (réponse du vendeur à un avis masqué ; panier absent de l'export) ; test d'intégration réel `commerce.e2e` (2 orgs, 2 commandes, stock, rupture, annulation, livraison, avis, course sur le dernier article). Images produit des vitrines publiques servies sans connexion par `GET /v1/public/media/:id/content` (seulement produit publié d'org active et publique).

### Tests réellement exécutés (2026-11-07)
- `npm run typecheck` : 0 erreur. `npm test -w @caselind/api` : **27 fichiers, 330 tests, 330 réussis** (≈ 148 s).

### Limites
- Aucun paiement réel (Q5) ; devises à confirmer (Q1). Pas encore d'écrans mobiles commerce (M3).
- La note d'annulation de l'acheteur reste dans les événements append-only après la purge ; une bascule de `trackStock` entre commande et annulation fausse le stock rendu.

## 2026-11-02 — Mobile M2 (fil, publications, stories, signalements) et design Apple

### Réalisé (`apps/mobile`)
- **Design** (ADR-016, skills `apple-design` et `ui-ux-pro-max`) : fond neutre, accent indigo unique, rouge réservé aux pastilles, échelle typographique iOS, boutons en pilule, retour tactile, clair et sombre.
- **M2a** : fil d'accueil (défilement infini, tirer pour rafraîchir), carte de publication (voir plus, médias 1 à 4+, vidéo `expo-video`, réaction rapide et 6 types en appui long, menu modifier/supprimer/signaler), création (texte 5000, 10 photos ou 1 vidéo, visibilité, `clientId`, envoi qui continue après fermeture), détail et commentaires, profil social (Suivre, Message, abonnés, abonnements), notifications `social` qui ouvrent la publication ou le profil.
- **M2b** : barre de stories réelle (anneau indigo non vue, gris vue), visionneuse plein écran (progression, suivante et précédente, pause, balayage pour fermer, auteur suivant, spectateurs et suppression pour l'auteur), création de story, signalements (publications, stories, messages) et « Mes signalements ».
- Correction après contrôle visuel : marge du bouton « Annuler » de l'écran de création.

### Tests réellement exécutés (2026-11-02)
- `npm run typecheck` : 0 erreur ; mobile `vitest` : **6 fichiers, 39 tests, 39 réussis** ; `expo export --platform web` réussi (rapports des agents).
- **Navigateur intégré (Expo web, 375 × 812, clair) contre l'API réelle**, données créées par l'API : Bob publie et poste une story, abonnements croisés. Vérifié : la publication apparaît dans le fil d'Alice, la story dans la barre (non vue), « J'aime » enregistré côté API (`like: 1`), visionneuse ouverte avec l'image authentifiée, vue d'Alice enregistrée (liste des spectateurs de Bob), écran de création conforme.

### Limites
- Envoi de photos ou de vidéo, commentaires, profil, signalement : codés, non exercés dans le navigateur.
- Metro (Expo web) s'est arrêté une fois faute de mémoire (« process out of memory ») ; même cause probable que les plantages de vitest en parallèle.
- Progression d'envoi par fichier et non par octet ; pas de vignette vidéo côté serveur ; code d'envoi des médias dupliqué entre stories et publications (à factoriser).

## 2026-11-02 — Lot backend 4 (social, stories, modération)

### Réalisé
- **4A, social** (migration 0009, `apps/api/src/social/*`, flag `social`) : abonnements (le blocage les coupe dans les deux sens), publications texte, médias et vidéo avec 4 visibilités (public, abonnés, amis = abonnement mutuel, privé), fil des comptes suivis, flux vidéo chronologique, réactions (une par utilisateur), commentaires à un niveau de réponse, notifications `social` sans contenu, export et purge. Implémente `RelationsService`.
- **4B, stories et modération** (migration 0010, `src/stories/*`, `src/moderation/*`) : stories de 24 h (`STORY_TTL_HOURS`) visibles par abonnés ou amis, barre (non vues d'abord), vues et liste des spectateurs pour l'auteur, archive personnelle ; signalements (on ne signale que ce qu'on voit, un seul ouvert par cible, limite de débit dédiée) ; file de modération pour `admin` ou `moderator` (`hide`, `restore`, `dismiss`), auditée sans contenu, signaleur notifié. Registre `ModerationRegistry` : cibles `user`, `post`, `comment`, `story`, `message`.
- **Revue** : 1 défaut élevé (les médias de publication étaient lisibles par tout utilisateur connecté, même pour une publication privée : ils suivent désormais la visibilité de la publication), 2 moyens (purge qui laissait les corps en base ; requêtes N+1 dans la barre de stories), 1 faible (OpenAPI : niveau d'accès `moderator`). Test d'intégration sans espion (`social-stories.e2e`).
- Vitest de l'API limité à 2 workers : le PostgreSQL embarqué faisait planter des workers en parallèle sur cette machine.

### Tests réellement exécutés (2026-11-02)
- `npm run typecheck` : 0 erreur. `npm test -w @caselind/api` : **23 fichiers, 273 tests, 273 réussis** (≈ 111 s).

### Limites
- Points ouverts (lot 4b du backlog) : listes « amis proches », médias d'une publication masquée invisibles pour les modérateurs, spectateurs de story inactifs ou bloqués encore listés, rejeu du `clientId` d'une publication supprimée → 400 peu clair, pas de limite de débit sur les publications, flux vidéo sans classement.
- Le mobile n'affiche pas encore le fil ni les stories (lot M2).

## 2026-11-02 — Mobile M1 (socle Expo et messagerie)

### Réalisé (`apps/mobile`, Expo SDK 58, React Native 0.88, expo-router)
- **M1a, socle** : design system original (`src/theme/tokens.ts`, indigo `#3730A3`, bouton central ambre, clair/sombre, cibles ≥ 44 pt), composants `src/ui`, i18n fr/en. Navigation imposée en bas : Accueil · Maps · + Publier · Messagerie · Plus. En-tête : logo CASELIND, recherche, wallet « bientôt » (aucun solde inventé), panier, menu compte. Stories en haut de l'accueil (état vide : pas encore de backend social). Auth complète (connexion, inscription, OTP, mot de passe oublié). Client API validé par les contrats Zod, **un seul rafraîchissement en vol**, refresh token dans `expo-secure-store` (repli `sessionStorage` sur le web, pour le développement seulement). Profil, sessions, confidentialité, langue ; tuile « Paris » visible seulement si le flag `betting` l'autorise.
- **M1b, messagerie** : un seul socket Socket.IO (jeton fourni par fonction à chaque reconnexion, rafraîchissement sur `unauthenticated`) qui alimente le cache react-query ; liste des conversations (non-lus, épinglage, sourdine, archivage), salon avec **envoi optimiste** par `clientId`, accusés envoyé/reçu/lu, « en train d'écrire », réponse, réaction, rappel, masquage, photos (`expo-image-picker`, envoi en deux temps, affichage authentifié `AuthImage`) ; infos de groupe ; centre et préférences de notifications ; push Expo (permission demandée après une explication, jeton désenregistré avant le logout, tap qui ouvre le salon).
- **Vérification dans le navigateur (Expo web, 390 × 844) contre l'API réelle** : connexion, retour à la connexion quand le refresh échoue, création d'une conversation par @handle (idempotente), envoi d'un message avec emoji, **réception en direct** du message d'un autre utilisateur, passage à « lu ». Trois défauts trouvés et corrigés :
  - `/` sans session menait à une route inexistante (ajout de `(auth)/index`) ;
  - sur le web, la feuille « Nouvelle conversation » restait affichée par-dessus le salon ;
  - le texte vide de la messagerie annonçait encore « bientôt ».
- **Backend** : la base de dev créée lors d'une session précédente était en WIN1252, donc tout emoji provoquait une erreur 500 (`22P05`). Le migrateur refuse désormais toute base qui n'est pas en UTF-8. En local, une base `caselind_utf8` a été créée sans supprimer l'ancienne.

### Tests réellement exécutés (2026-11-02)
- `npm run typecheck` (api + mobile) : 0 erreur. Mobile `vitest` : **2 fichiers, 17 tests, 17 réussis** (rafraîchissement unique sous 10 requêtes 401 concurrentes, fusion optimiste/serveur sans doublon, état d'accusé, limitation de `typing`). `npx expo export --platform web` : réussi.
- API `npm test -w @caselind/api` : **19 fichiers, 223 tests, 223 réussis**, serveurs de dev arrêtés. Une première exécution lancée pendant que la base de dev, l'API et Metro tournaient a vu le PostgreSQL embarqué des tests redémarrer (`ECONNRESET`) : il faut lancer la suite sans les serveurs de dev.

### Non vérifié / limites
- Rien n'a tourné sur un appareil iOS ou Android ni sur un émulateur. Push réel non testé : il faut un `projectId` EAS, donc un compte Expo, à décider.
- Pas de capture d'écran (panneau du navigateur masqué) : la mise en page à 360 px et le chevauchement du bouton « + » restent à contrôler visuellement.
- Envoi de photo, groupes, réactions et rappel dans l'interface : codés, pas exercés dans le navigateur.
- Avatars en initiales seulement ; langue non persistée localement.

### Prochaine étape
Votre validation du mobile sur appareil, puis M2 (social et Stories, après le lot backend 4). Le web reste après la validation du mobile.

## 2026-11-02 — Lot backend 3 (messagerie temps réel et notifications)

### Exécution
Interfaces partagées posées d'abord (`RealtimeService`, `ConversationRoomsResolver`, `NotificationsService`), puis deux sous-agents en parallèle (3A messagerie, 3B temps réel et push), puis une passe unique de revue, correction et intégration.

### Réalisé
- **Messagerie** (migration 0007, `apps/api/src/messaging/*`, contrats `messaging.ts`, flag `messaging`) :
  - conversations directes (une par paire, création idempotente) et groupes (owner/admin/member, annonce, avatar, taille max configurable) ;
  - messages texte, média et système, numérotés par `seq` sous verrou ; idempotence par `clientId` ; réponses, mentions, réactions ; rappel pour tous dans un délai de 120 s, masquage pour soi ;
  - accusés envoyé/reçu/lu, non-lus, épinglage, sourdine, archivage ; un membre arrivé tard ne voit pas l'historique ;
  - application des blocages, de `contactRequestsFrom` (« contact » = conversation directe commune) et de `readReceipts` ;
  - pièces jointes lisibles par les membres actifs de la conversation (`canReadAsync`), plus après un rappel ;
  - export (`conversations`, `messagesSent` plafonné à 10 000) et purge (adhésions quittées, corps effacés, propriété du groupe transmise) ;
  - limite de débit dédiée à l'envoi (`MESSAGING_RATE_LIMIT_PER_MINUTE`, défaut 60).
- **Temps réel** (`apps/api/src/realtime/*`) : Socket.IO sur `/v1/socket.io` ; jeton lu seulement dans `handshake.auth.token`, vérifié par `SessionVerifier` (partagé avec `AuthGuard`) ; diffusion uniquement par rooms `user:`, `session:`, `conversation:` (compatible avec un futur adaptateur Redis) ; sockets coupées au logout, à la révocation, au rejeu, à la réinitialisation du mot de passe et à la demande de suppression ; revérification périodique (60 s) ; `typing` limité aux membres de la room. Les gardes HTTP ignorent les contextes non HTTP.
- **Notifications** (migration 0008, `apps/api/src/notifications/*`) : centre de notifications (liste, non-lus, lecture), préférences (catégories coupées, `security` non désactivable, mode silencieux, aperçus des messages coupés par défaut), jetons push liés à la session ; port `PushGateway` avec adaptateur Expo (seul import d'`expo-server-sdk`) et adaptateur de journalisation par défaut ; jetons `DeviceNotRegistered` supprimés ; notification de sécurité à chaque connexion. Les pushs de message ne contiennent jamais le texte (« Nouveau message »).
- **Revue** : 1 défaut élevé (le filtre d'exceptions journalisait les paramètres SQL, donc le corps d'un message en cas d'échec d'INSERT), 2 moyens (une erreur après commit renvoyait 500 et pouvait laisser un membre retiré dans la room), 1 bloquant de tests ; tous corrigés, avec des tests.
- Base embarquée de dev et de test forcée en UTF-8 (sous Windows, WIN1252 rendait les emoji impossibles).

### Tests réellement exécutés (2026-11-02)
- `npm run typecheck` : 0 erreur.
- `npm test -w @caselind/api` : **19 fichiers, 223 tests, 223 réussis** (≈ 53 s), sur PostgreSQL embarqué réel. Nouveaux : `messaging` (25), `realtime` (12), `notifications` (15), `messaging-realtime` (8, bout à bout avec deux clients Socket.IO et le faux PushGateway), test du filtre d'exceptions.

### Limites
- Aucun push réel envoyé (pas de réseau en test) ; les reçus différés d'Expo ne sont pas traités.
- La suspension d'un compte hors des chemins connus coupe ses sockets au contrôle périodique (≤ 60 s), pas immédiatement.
- Points faibles ouverts : `message.updated` et `message.reaction` diffusés à toute la room (enveloppe sans corps visible par un membre arrivé après le message) ; course étroite entre un `message.new` et l'ajout d'un membre.
- Ni transfert, ni messages éphémères ou programmés, ni recherche, ni appels (backlog).

### Prochaine étape
Application mobile Expo (`apps/mobile`) : authentification, accueil, messagerie.

## 2026-11-02 — Lot backend 2 (organisations et médias)

### Réalisé
- **Organisations** (migration 0005, `apps/api/src/orgs/*`) :
  - organisations configurables (`kind`), membres avec 10 rôles et permissions vérifiées côté serveur (`OrgGuard`) ;
  - invitations par @handle, vitrine publique `GET /v1/public/orgs/:slug` accessible sans connexion ;
  - invariant « au moins un propriétaire actif » protégé par transaction et verrou, y compris en concurrence ;
  - le badge vérifié est retiré si le nom, le type ou les coordonnées changent ;
  - un membre peut quitter une organisation suspendue.
- **Médias** (migration 0006, `apps/api/src/media/*`) :
  - envoi en deux temps (annonce, puis envoi des octets avec un jeton HMAC de 15 min, renouvelable) ;
  - type réel détecté par les premiers octets du fichier (SVG et HTML refusés) ;
  - limites de taille par type, quota par utilisateur (envois en attente et octets), limite de débit dédiée ;
  - diffusion avec `nosniff` et une CSP sandbox, photo de profil, purge des envois abandonnés ;
  - stockage sur disque local derrière un port : l'adaptateur S3 attend la décision Q6.
- **Intégration** :
  - suppression de compte refusée tant que l'utilisateur est le dernier propriétaire d'une organisation (409 `last_owner`) ;
  - la purge supprime les adhésions et les fichiers de l'utilisateur, et suspend une organisation restée sans propriétaire ;
  - l'export inclut les adhésions et les médias.
- **Revue de sécurité** (agent dédié) : 2 défauts élevés (plantage du processus sur une erreur d'écriture disque ; absence de quota), 4 moyens et 3 faibles corrigés, avec des tests. Reportés au backlog : Range/304 pour la vidéo, expiration des invitations, réservation de slugs en base.

### Tests réellement exécutés (2026-11-02)
- `npm run typecheck` : 0 erreur.
- `npm test -w @caselind/api` : **14 fichiers, 162 tests, 162 réussis**, sur PostgreSQL embarqué réel.

### Limites
- Aucun test de charge ; pas de stress test de concurrence pour les nouveaux verrous de suppression.
- Pas de stockage objet distant ni de CDN (Q6) ; pas de ré-encodage d'image ni de suppression des métadonnées EXIF.
- Les permissions métier des organisations (catalogue, commandes, stock…) sont déclarées mais pas encore utilisées.

### Prochaine étape
Lot 3 : messagerie temps réel (Socket.IO authentifié au handshake) et notifications push Expo, puis démarrage de l'application mobile.

## 2026-11-01 — Lot backend 1b (compléments identité)

### Exécution
- Plan suivi : [plans/LOT_1B_PLAN.md](plans/LOT_1B_PLAN.md) (phase 0 de vérification des API installées, puis phases 1 à 6).
- Chaque phase a été confiée à plusieurs sous-agents en parallèle. Conséquence : les migrations sont réparties sur trois fichiers (0002, 0003, 0004) au lieu d'un seul 0002 prévu.
- Une revue de code a relevé **1 point moyen** et **4 points faibles**. Tous ont été corrigés, chacun avec un test.
  - Moyen : TOCTOU sur la confirmation des flags réglementés. Deux mises à jour concurrentes pouvaient laisser un flag réglementé actif avec une portée que personne n'avait confirmée. Correction : lecture, décision, écriture et audit dans une seule transaction, ligne verrouillée (`SELECT … FOR UPDATE`).
  - Le test de concurrence (`flags.e2e.test.ts`, dernier test) ordonne deux requêtes derrière un verrou tenu par le test. Il **échoue sans le verrou de ligne** et passe avec.

### Réalisé
| Élément | Fichiers |
|---|---|
| Feature flags par pays et par rôle : table, 8 flags réglementés coupés par défaut, `social.stories` et `messaging` actifs ; une clé inconnue vaut `false` | `apps/api/migrations/0002_platform_controls.sql`, `apps/api/src/flags/flags.service.ts` |
| `GET /v1/config/flags` (flags évalués pour le pays et les rôles lus en base) ; `GET /v1/admin/flags`, `PUT /v1/admin/flags/:key` (admin, audité `admin.flag_updated`). Activer un flag réglementé, ou changer sa portée (pays, rôles) quand il est actif, exige `confirmRegulated: true`, sinon 409 | `apps/api/src/flags/flags.controller.ts` |
| Décorateur `@RequireFlag(key)` et garde globale placée après `AuthGuard` : 403 `feature_disabled` | `apps/api/src/flags/flag.guard.ts` |
| Confidentialité : `GET/PATCH /v1/me/privacy` (introuvable par téléphone et par e-mail par défaut, demandes de contact `everyone`, accusés de lecture actifs), audité | `apps/api/migrations/0003_privacy_blocks.sql`, `apps/api/src/privacy/*` |
| Blocages : `GET /v1/blocks` (pagination par curseur opaque, 50 par défaut, 200 max), `PUT` et `DELETE /v1/blocks/:userId` (idempotents, 204). S'auto-bloquer → 400 ; id inconnu, inactif ou mal formé → 404. Le profil public est masqué dans les deux sens. `PrivacyService.isBlockedEitherWay` est prêt pour la messagerie | idem |
| Export : `GET /v1/me/export` (profil, confidentialité, sessions, blocages, événements de sécurité ; colonnes choisies une à une, sans hash ni jeton), audité `user.data_exported` | `apps/api/src/account/*` |
| Suppression : `POST /v1/me/deletion-request { password }` → 202 avec la date prévue ; toutes les sessions sont révoquées et le profil public est masqué. Une connexion pendant le délai de grâce annule la demande (`auth.deletion_cancelled`). Après le délai, la connexion est refusée (403 `account_suspended`), même si la purge n'est pas encore passée | `apps/api/migrations/0004_account_deletion.sql`, `apps/api/src/account/*`, `apps/api/src/auth/auth.service.ts` |
| Nettoyage planifié toutes les heures (`@nestjs/schedule`) et une première fois 60 s après le démarrage ; verrou consultatif entre instances. Il supprime les OTP expirés depuis plus de 24 h, les refresh tokens expirés ou utilisés depuis plus de 7 j, les sessions révoquées ou expirées depuis plus de 30 j. Il anonymise les comptes dont le délai est passé : identifiants libérés, `handle` `deleted_<12 hex>`, mot de passe inutilisable, sessions, OTP et blocages supprimés. L'audit est conservé et la purge ajoute `user.deleted` | `apps/api/src/maintenance/maintenance.service.ts` |
| OpenAPI 3.1 généré depuis les contrats Zod : `GET /v1/openapi.json` (public, sans throttle) ; registre de 27 opérations | `apps/api/src/openapi/*` |
| Contrats partagés | `packages/contracts/src/{flags,privacy,account}.ts` |
| Configuration : `MAINTENANCE_ENABLED` (défaut `true`), `ACCOUNT_DELETION_GRACE_DAYS` (défaut 30, de 1 à 365) | `apps/api/src/config/env.ts`, `apps/api/.env.example` |

### Tests réellement exécutés (2026-11-01)
- `npm test -w @caselind/api` : **11 fichiers, 82 tests, 82 réussis** (≈ 43 s), contre PostgreSQL 18.6 embarqué réel. Les 39 tests du lot 1 en font partie et restent verts.
  - `test/flags.e2e.test.ts` (11) : authentification requise, flags réglementés coupés, restriction par pays (un utilisateur sans pays est exclu), restriction par rôle lu en base, clé inconnue → false, 403 pour un non-admin, liste admin, `confirmRegulated` exigé pour activer un flag réglementé et pour changer la portée d'un flag réglementé déjà actif, audit, 404/400, test de concurrence.
  - `test/flag-guard.e2e.test.ts` (4) : `@RequireFlag` sur une route de test (pays autorisé, pays exclu → 403, flag coupé → 403, 401 avant 403).
  - `src/flags/flag.guard.test.ts` (6) : garde et évaluation pure (unitaires).
  - `test/privacy.e2e.test.ts` (9) : valeurs par défaut, mise à jour partielle auditée, profil masqué dans les deux sens, idempotence, 400/404, audit côté bloqueur seulement, cascade à la suppression, pagination, cible supprimée pendant le blocage → 404.
  - `test/account.e2e.test.ts` (6) : export sans secret, authentification requise, mauvais mot de passe → 401 sans effet, demande de suppression (sessions révoquées, profil masqué, reconnexion qui annule), connexion refusée après le délai, purge (anonymisation, e-mail libéré, audit conservé).
  - `test/maintenance.e2e.test.ts` (2) : seules les lignes périmées disparaissent, idempotence ; exécution sautée quand le verrou est tenu.
  - `test/openapi.e2e.test.ts` (5) : document 3.1 public avec le schéma d'inscription, **exhaustivité dans les deux sens** (routes montées = registre), bearer exigé sur toute route non publique, paramètres de requête, aucun secret.
  - Lot 1, inchangés : `test/auth.e2e.test.ts` (18), `test/users.e2e.test.ts` (6), `test/platform.e2e.test.ts` (7), `src/config/env.test.ts` (8, dont 4 cas `it.each`).

### Non fait / limites
- Aucun commit Git (en attente de votre accord).
- OpenAPI : les erreurs sont décrites par une réponse `default` générique (enveloppe `ApiError`), pas par code d'erreur ni par statut.
- `FlagsService` lit la base à chaque évaluation, sans cache. Un changement admin prend effet immédiatement, mais chaque route protégée coûte une requête.
- La première exécution du nettoyage au démarrage (60 s) et l'`@Interval` horaire ne sont pas couverts par un test automatisé. Les tests désactivent la planification et appellent `runOnce` directement.
- `@RequireFlag` n'est posé sur aucune route de production pour l'instant (seulement sur une route de test). Il servira aux modules des lots suivants.
- Les réglages `discoverable_by_phone`, `discoverable_by_email`, `contact_requests_from` et `read_receipts` sont stockés et modifiables, **mais pas encore appliqués** : il n'existe encore ni recherche ni messagerie. Ils le seront aux lots messagerie (3) et recherche (7). Il en va de même pour le blocage, appliqué aujourd'hui au profil public seulement.
- Suppression : après le délai de grâce, la connexion est refusée avec `account_suspended`. Il n'y a pas de code d'erreur dédié.
- Reportés au lot 1c : 2FA TOTP, changement d'identifiant, connexion web par QR, Dockerfile + CI, cache Redis.

### Prochaine étape
Lot 2 (organisations et médias), puis lot 3 (messagerie et notifications). Le mobile Expo démarre ensuite.

## 2026-11-01 — Audit initial + lot backend 1 (Identité)

### Audit : ce qui a été réellement inspecté
- `E:\CASELIND` : seul `CASELIND_CAHIER_DES_CHARGES_DEFINITIF.md` existait (643 lignes, lu en entier). Pas de dépôt Git, pas de code, **aucune source SaaS**.
- Outillage machine : Node 26.13, npm 11.15, Python 3.14 ; **absents** : pnpm, Docker, PostgreSQL.
- Skills : `reverse-engineer-anything` (REA) présent comme skill, **mais aucun serveur MCP ni CLI REA**. replica-skill et Agent-Reach : **non installés**. graphify, frontend-design, ui-ux-pro-max : présents (utiles pour les phases UI). MCP Playwright : déclaré.
- WeChat : cartographie établie à partir de 3 recherches web et de la documentation officielle Tencent/Weixin. **Aucun écran observé directement.** Détails et limites : [EVIDENCE_AND_GAPS.md](reverse-engineering/EVIDENCE_AND_GAPS.md).

### Réalisé
| Élément | Fichiers |
|---|---|
| Git initialisé (aucun commit créé) | `.gitignore` |
| Monorepo npm workspaces, TypeScript strict | `package.json`, `tsconfig.base.json` |
| Contrats partagés Zod (auth, users, erreurs, pagination) | `packages/contracts/src/*` |
| Migration 0001 : users, sessions, refresh_tokens, otp_challenges, audit_events (trigger append-only), contraintes CHECK/UNIQUE | `apps/api/migrations/0001_identity.sql` |
| Migrateur versionné (transaction, verrou, checksum) | `apps/api/src/db/migrator.ts` |
| Socle API : config validée, erreurs uniformes, request-id, journaux pino masqués, helmet, CORS, rate limit global + auth | `apps/api/src/{config,common,bootstrap.ts,app.module.ts}` |
| Sécurité : Argon2id, JWT + refresh à rotation, garde globale (session, statut et rôles vérifiés en base), RBAC | `apps/api/src/security/*` |
| Auth : register, OTP verify/resend, login + verrouillage, refresh, logout, sessions, mot de passe oublié/réinitialisation | `apps/api/src/auth/*` |
| Users : /me, PATCH /me, /me/security-events, /users/:handle ; admin : /admin/audit-events | `apps/api/src/{users,admin}/*` |
| Scripts dev : BD embarquée persistante, boucle watch | `apps/api/scripts/*`, `apps/api/.env.example` |
| Docs : cartographie WeChat et matrice (96 lignes), écrans, parcours, preuves, architecture, contrats, ADR, backlog, registre SaaS | `docs/**` |

### Tests réellement exécutés (2026-11-01)
- `npx tsc --noEmit` (src + tests) : **0 erreur**.
- `npm test -w @caselind/api` : **4 fichiers, 39 tests, 39 réussis** (≈ 17 s), contre un **PostgreSQL 18.6 réel** (embarqué), une base migrée par fichier de test.
  - `test/auth.e2e.test.ts` (18) : inscription e-mail et téléphone, validation, anti-énumération (inscription et mot de passe oublié), OTP faux / épuisé / usage unique / renvoi, connexion non vérifiée, 401 identiques, verrouillage après 5 échecs, compte suspendu (sessions coupées), jetons falsifiés, rotation + rejeu → session révoquée, liste et révocation des sessions (y compris la tentative sur la session d'autrui → 404), logout, réinitialisation du mot de passe (sessions révoquées), code d'inscription refusé pour la réinitialisation.
  - `test/users.e2e.test.ts` (6) : mise à jour du profil, conflit de @handle insensible à la casse, champs hors contrat ignorés (pas d'escalade de rôle), profil public limité et masqué si suspendu, journal de sécurité sans secrets, RBAC admin (403 puis 200, rôle lu en base).
  - `test/platform.e2e.test.ts` (7) : health, en-têtes de sécurité et request-id, 404 dans l'enveloppe d'erreur, **429 sur /auth** avec /health toujours disponible, audit append-only (UPDATE/DELETE refusés par la BD), migrations idempotentes et checksum, contraintes BD.
  - `src/config/env.test.ts` (8) : validation de config (secrets faibles, OTP console refusé en production), génération de @handle, format des codes OTP.
- **Contrôle par mutation** : en retirant la condition `used_at IS NULL` de la rotation des refresh tokens, le test de rejeu échoue (1 échec sur 18), puis repasse une fois le code restauré.
- **Démarrage réel** du build compilé (`node dist/main.js`) sur la BD de dev : migration appliquée, `GET /v1/health` → 200, `POST /v1/auth/register` → 202, connexion non vérifiée → 403 `account_not_verified`. Vérifié que le mot de passe et l'en-tête Authorization n'apparaissent pas dans le log.

### Non fait / limites
- Aucun commit Git (en attente de votre accord).
- Pas d'OpenAPI généré, pas de Dockerfile, pas de CI (lot 1b). Docker n'est pas installé, donc un Dockerfile ne serait pas testable ici.
- Aucun envoi réel de SMS ni d'e-mail : fournisseur à choisir (Q2).
- Pas de test de charge ni de scan de sécurité outillé ; `npm audit` : 0 vulnérabilité au moment de l'installation.
- Mobile et web : non commencés, conformément à l'ordre imposé.

### Prochaine étape
Lot 1b (feature flags par pays, confidentialité et blocages, OpenAPI, nettoyage planifié), puis les lots 2 et 3 (organisations, médias, messagerie, notifications). Ce socle permet ensuite de démarrer le mobile Expo : auth, accueil, messagerie.

## 2026-11-14 — Mouvement (point 2, partiel)
- `npm run dev` racine ajouté (commit ac24c28).
- `Screen` : apparition en fondu 180 ms via `react-native-reanimated`, respecte « réduire les animations » (`ReduceMotion.System`). Retour tactile (échelle 0,97) déjà présent sur Button/TabBar. `brandGradient` = deux fois `#4F46E5` : aucun dégradé visible.
- Typecheck OK, 208 tests mobile OK. **Non vérifié visuellement** (pas de capture dans le navigateur).
- Reste : revue visuelle écran par écran avec les skills `apple-design` / `ui-ux-pro-max`.
