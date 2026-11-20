# Backlog CASELIND

Dernière mise à jour : 2026-11-20 (analyse de conformité ligne à ligne : voir la section « État réel au 2026-11-20 » en bas de ce fichier) (audit de conformité : voir [AUDIT_CONFORMITE_LOTS_1_12.md](AUDIT_CONFORMITE_LOTS_1_12.md)). **Règle CDC §0 : rien n'est supprimé.** Ce qui est différé reste ici avec son statut. Traçabilité fonctionnelle complète : [WECHAT_FUNCTIONAL_MAP.md](reverse-engineering/WECHAT_FUNCTIONAL_MAP.md) (96 lignes).

Statuts : `planifié` · `en cours` · `implémenté` · `testé` · `validé` · `bloqué` · `reporté`

## Décisions du propriétaire (2026-11-15) — à respecter à chaque lot
- **Trading (CDC §20) et paris sportifs : RETIRÉS du projet** (malgré le cahier des charges). Ne rien développer, ne rien proposer. Tuiles « Trading » et « Paris » supprimées du menu Plus.
- **Santé (§12) et tout le reste : à développer intégralement.** Les modules réglementés (santé, etc.) restent coupés par défaut côté serveur (flag `regulated`, activation admin avec confirmation) ; le code est livré, l'activation reste une décision d'exploitation.
- Suivre le cahier des charges à la lettre (`CASELIND_CAHIER_DES_CHARGES_DEFINITIF.md`), relire la section de chaque lot, consigner le différé, ne pas inventer les règles CSL Coins (§18, question ouverte).
- Finir le projet le plus tôt possible ; aucune erreur : tests complets avant chaque commit.
- **Réponses du 2026-11-16 :** (1) dépôt GitHub privé : accord donné, je le crée via son navigateur connecté. (2) Mineurs : c'est à l'établissement de gérer le consentement (lot 17b : pas de compte parent côté plateforme). (3) Services publics : retirés, lot 19 abandonné. (4) CSL Coins : plus tard, je peux proposer des règles. (5) FlexPay : plus tard. (6) Brevo/WhatsApp : pas encore. (7) Expo : je peux tester quand je veux. (8) IA : Gemini non, OmniRoute d'abord. (9) Pas d'hébergement ni de domaine ; le reste (WebRTC/TURN) à ma charge. (10) Santé : pays = RDC. (11) Banque de quiz : à moi de décider. (12) Outils pro 16c : à moi de décider. (13) Web après le mobile. (14) OmniRoute : seulement si vraiment nécessaire. Consigne : coder avec OmniRoute plutôt qu'avec les tokens Claude si possible.
- **Consigne du 2026-11-16 (soir) : le web ne doit pas être abordé** tant que toutes les fonctionnalités du backend et du mobile ne sont pas finies, et **qu'avec l'accord explicite du propriétaire**. Une v1 (`apps/web`) existe déjà (commit f80183d) : à retirer si le propriétaire le demande. Dépôt GitHub rendu public ; push refusé (403) : la machine est connectée sous `VainqueurBahati`, sans droit d'écriture sur `creActionDigital/CASELIND`.

## Feuille de route des lots restants (mise à jour à chaque lot)
| Lot | Cahier §| Contenu | Statut |
|---|---|---|---|
| 13 | §19 | Finance personnelle (budget, bilan) | testé |
| 15 | §15 | Petites annonces | testé |
| 16a | §14 | Emploi : offres, CV, candidatures | testé ; modification d’offre à l’écran et alertes d’offres (16d) faites |
| 16b | §14 | Freelance : missions, propositions, jalons, litiges | testé (paiement externe, séquestre différé) |
| 16c | §14 | Outils pro : devis, factures, CRM, caisse, fidélité, campagnes | analyse de ventes, devis et factures, clients, fidélité et campagnes (16h), **caisse** (ventes au comptoir, migration 0059) testés ; contrats, ventes sans stock, annulation de vente et fermeture de caisse différés |
| 17a | §13 | Éducation : cours, quiz, certificats | testé ; avis et notes sur les cours (17d) faits |
| 17b | §13 | Établissements : emplois du temps, parents, frais, bourses | testé (classes, emploi du temps, annonces, notifications aux inscrits, recherche d’établissements, bourses sans candidature en ligne ; frais scolaires différés) |
| 18a | §12 | Santé : consentement, dossier chiffré, rappels | testé (module réglementé, coupé par défaut) |
| 18b | §12 | Santé : professionnels vérifiés, rendez-vous, partage du dossier, ordonnances | testé (réglementé, coupé par défaut) ; pharmacie, résultats d’examens, assurance, vidéo : différés |
| 19 | §16 | Administration publique, alertes, urgences, signalements urbains | **abandonné : le propriétaire a retiré les services publics (2026-11-16)** ; le code reste sur la branche `wip/lot19-services-publics`, non fusionné |
| 20a | §21 | Jeux : quiz éclair et classement (sans argent) | testé |
| 20b | §21 | Jeux : tournois et badges non monétaires (autres jeux : différé) | testé (API + mobile ; écran vérifié dans le navigateur) |
| — | §20, paris | Trading, paris sportifs | **retiré** |
| — | §18 | CSL Coins | bloqué : règles non spécifiées (question ouverte) |
| M9 | §6, §4 | Appels 1:1 et lives : signalisation WebRTC relayée par le temps réel (rien de stocké), historique des appels, salons live (chat, compteur, pic), drapeaux calls/live, export et purge | **API testée** (e2e calls-live, migration 0058) ; mobile : écran d’appel, bandeau d’appel entrant, boutons dans la conversation, onglet Live ; typecheck OK, **non vérifié à l’écran**. **Média (audio/vidéo) NON fait** : exige un serveur STUN/TURN (Q6) et un appareil réel ; `react-native-webrtc` hors Expo Go |
| 2c | §5 | Vitrine mini-site : coordonnées, horaires, zones, liens, sections libres, questions fréquentes, logo et bannière, éditeur « Ma vitrine » ; photo de profil | **testé** (migrations 0061 à 0065 : page, galerie, actualités, avis de la boutique, questions des visiteurs ; page et éditeur vérifiés dans le navigateur, le reste seulement au typage) ; SEO/URL `@nom`/domaine personnalisé, vidéos de galerie depuis le mobile, images des actualités : différés |
| 16c+ | §14 | Caisse : annulation de vente, sessions avec fond, ticket, fuseau de la boutique (0063) | **testé** ; écrans non vérifiés ; contrats et ventes hors catalogue : différés |
| 17b+ | §13 | Établissements : lien parent-élève, rappels d'échéance, export des frais (0066) | **testé** ; écrans non vérifiés ; lien invisible pour l'élève majeur : à corriger |
| 3b+ | §6 | Messagerie : sondages, recherche dans les messages, présence en ligne (0067) | **testé** ; écrans non vérifiés ; présence fiable en multi-instance seulement avec Redis |
| 8+ | §10 | Livraison : preuve par photo (0068) | **testé** ; tracé de la signature côté mobile différé (pas de bibliothèque de capture) |
| 18d | §12 | Santé : résultats d'examens chiffrés (0070) | **testé** (réglementé, coupé par défaut) ; fichiers non chiffrés au repos : à traiter ; pharmacie, assurance, vidéo : différés |
| G5+ | — | Webhooks sortants signés des organisations (0069) | **testé** ; compteur d'échecs à affiner, clé de chiffrement dédiée à prévoir |
| Web | §27 | React + Vite, PWA | **v1 minimale** (accueil, vitrine publique `/s/<adresse>`, PWA ; 296 lignes) : comptes, catalogue public, SEO/sitemap/rendu serveur, swahili, parité avec le mobile **non faits** (hors de la série du 2026-11-20 : décision du propriétaire) |

## Ordre imposé

1. Reverse engineering et cartographie WeChat : **v1 faite** (sources publiques ; à enrichir module par module)
2. **Backend** : lots 1 à 18 et 20 livrés et testés (voir la feuille de route ci-dessus) ; 19 abandonné ; restent les différés de chaque lot dans PROGRESS.md
3. **Mobile** (React Native + Expo) : en cours. M1 (socle, auth, messagerie temps réel, notifications) codé et testé sur Expo web ; validation sur appareil à faire
4. Intégration mobile ↔ backend, tests et validation
5. **Web** (React + TS + Vite) : seulement après la validation du mobile

## Lots backend

| Lot | Contenu | Critères d'acceptation | Statut |
|---|---|---|---|
| **1 — Identité** | Socle (config, BD, migrations, erreurs, journaux, rate limit, health), inscription téléphone/e-mail + OTP, connexion, verrouillage, rotation des refresh tokens + détection de rejeu, sessions et révocation à distance, mot de passe oublié, profil et @handle, profil public, journal de sécurité, audit append-only, RBAC plateforme | 39 tests automatisés (voir PROGRESS) | **testé** |
| **1b — Compléments identité** | Feature flags par pays et par rôle (réglementés coupés par défaut, confirmation explicite verrouillée en transaction) ; confidentialité et blocages ; export des données et demande de suppression (grâce de 30 j, puis anonymisation) ; OpenAPI 3.1 généré depuis Zod (`GET /v1/openapi.json`) ; nettoyage planifié des OTP, refresh tokens et sessions périmés | 82 tests automatisés au total, dont 43 nouveaux (voir PROGRESS). Réglages de confidentialité stockés, appliqués par les lots messagerie et recherche | **testé** |
| 1c — Reste identité | 2FA TOTP, changement d'identifiant, connexion web par QR ; CI et Dockerfile | 439 tests (voir PROGRESS) | **testé** (CI non exécutée ici) |
| 2 — Organisations et médias | Organisations, membres et rôles, invitations, vitrine publique ; médias avec détection du type réel, quotas et purge ; intégration avec la suppression de compte | 162 tests (voir PROGRESS) | **testé** |
| 2b — Reste médias et organisations | Adaptateur S3 + CDN (après Q6), Range/304 vidéo, ré-encodage et suppression EXIF, expiration et limite des invitations, slugs réservés en base, suspension et vérification des organisations par l'admin, suppression d'organisation | | planifié |
| 3 — Messagerie et notifications | Conversations 1:1 et groupes, messages, pièces jointes, accusés, WebSocket, push Expo, centre de notifications | 223 tests (voir PROGRESS) | **testé** |
| 3b — Reste messagerie | **Faits** : transfert, favoris, brouillons serveur, messages éphémères et programmés, sondages, recherche, présence, traduction (avec consentement), mentions. **Restent** : messages vocaux (enregistrement mobile), partage de position, reçus différés Expo, appels WebRTC (média : serveur TURN et appareil réel), conversation commerciale dans le fil | partiel |
| 4 — Social | Posts, visibilité, réactions, commentaires, abonnements, stories 24 h, vidéos courtes, signalements et modération | 273 tests (voir PROGRESS) | **testé** |
| 4b — Reste social | Listes d’amis proches et audiences personnalisées, salons, live, favoris (C-08), stickers (C-11), tableau de bord créateur (C-12), classement du flux vidéo, limite de débit des publications, accès modérateur aux médias masqués | | planifié |
| 5 — Commerce | Catalogue, variantes, stock, panier multi-vendeurs, commandes scindées, avis vérifiés, coupons | 330 tests (voir PROGRESS) ; paiement à la livraison seulement (ADR-017) | **testé** |
| 5b — Reste commerce | Contact du vendeur depuis une commande, avis par organisation, `details.reason` sur les 409 du catalogue, lecture des variantes pour le rôle `stock`, devise du minimum des coupons en pourcentage ; paiement en ligne (après Q5), livraison et suivi (lot 9), promotions et ventes flash (E-05), live shopping (E-07), service client dans le chat (E-06), favoris produits, recherche plein texte avancée | | planifié |
| 6 — Ledger et wallet (sandbox) | Ledger en partie double, wallet USD/CDF, transferts idempotents, QR marchand signé, KYC par niveaux, PIN ; **aucun argent réel** | 439 tests | **testé** (sandbox) ; FlexPay après contrat (Q5) |
| 7 — Lieux et recherche | Lieux par distance (sans PostGIS), recherche universelle, historique contrôlable | 439 tests | **testé** |
| 8 — Livraison | Zones, frais, retrait, livreur, statuts, preuve par code, position consentie, évaluation | 467 tests | **testé** (backend) ; écrans mobiles M6 |
| 9 — Services et réservations | Offres, prestataires, créneaux, devis, réservations, avis | 467 tests | **testé** (backend) ; écrans mobiles M6 |
| 10 — Mini-apps | OAuth + PKCE, scopes, paiement confirmé par PIN | 509 tests | **testé** (backend) |
| 11 — Mobilité | Courses type Uber, espèces | 509 tests | **testé** (backend) |
| 12 — Assistant IA | Multi-fournisseurs, Gemini par défaut | 509 tests | **testé** (backend, sans clé réelle) |
| 13+ | Lots 13 à 20 : voir la feuille de route « Feuille de route des lots restants » en tête de ce fichier (livrés et testés, sauf 19 abandonné) | | testé |

| 14 — Communautés publiques | Un groupe publié par son propriétaire (description, 5 étiquettes max) : liste filtrable, étiquettes tendance, rejoindre (idempotent, sans historique antérieur), retiré par un admin = interdit de rejoindre, limite de membres respectée, audité. Mobile : « Explorer les communautés » (filtre Groupes), « Mes groupes », bouton propriétaire Publier / Retirer | 515+ tests | **testé** (backend 5 tests, OpenAPI, mobile vérifié à l'écran) ; description et étiquettes saisies à l'écran, signalement d'une communauté : à faire |
## Lots mobile

| Lot | Contenu | Statut |
|---|---|---|
| M1 — Socle et messagerie | Design system, navigation imposée, en-tête, auth, sessions, confidentialité, messagerie temps réel, notifications, push | **testé** (unitaires + parcours Expo web contre l'API réelle) ; appareil réel à faire |
| M1b — Reste | Contacts et QR, recherche dans les messages, messages programmés : **faits**. Restent : messages vocaux (enregistrement mobile), avatars partout dans le fil et la messagerie, compte Expo/EAS pour le push réel | partiellement fait |
| M3 — Commerce | Boutique, fiche produit, panier, commande (paiement à la livraison), suivi, avis ; espace vendeur (produits, stock, commandes, coupons, avis) | **testé** (unitaires + parcours d'achat Expo web contre l'API réelle) ; espace vendeur non exercé à l'écran |
| M4a — Wallet | Wallet sandbox, envoi avec PIN, recharge de test, wallet d'organisation | **testé** (unitaires + parcours Expo web) |
| M5 — Recherche, lieux, QR, sécurité | Recherche, Maps (liste par distance), scanner et paiement QR, QR vendeur et profil, 2FA, KYC, changement d'identifiant, compléments de messagerie | **testé** (unitaires + parcours recherche, lieux, paiement QR sur Expo web) |
| M6 — Livraison et services | Écrans acheteur, vendeur, livreur et prestataire | **testé** (unitaires) ; parcours complets non exercés |
| M2 — Social | Fil, publications, commentaires, profils, Stories, signalements ; design Apple (ADR-016) | **testé** (unitaires + parcours Expo web contre l'API réelle) |

## Écarts relevés par l'audit de conformité (2026-11-16, détails dans AUDIT_CONFORMITE_LOTS_1_12.md)

| Réf. | Écart | Statut |
|---|---|---|
| G1 | Aucun outil pour suspendre un compte ou vérifier une organisation | **fait** : API + écran `admin/governance.tsx` ; console d'administration complète le 2026-11-20 (modération, drapeaux, KYC, audit, ledger, mini-apps, santé, mobilité, jeux, IA, analytique, approbations) |
| G2 | Retours, remboursements et litiges de commande | fait sans mouvement d'argent (migrations 0071-0072) : retour sous 7 jours après livraison, remboursement = statut + montant réglé hors plateforme, litige arbitré par admin/support ; reste : branchement d'un paiement en ligne (Q5) à l'étape « remboursé » |
| G3 | Double validation des opérations sensibles, remboursement wallet, audit des lectures de mini-apps, limite de débit des publications | planifié |
| G4 | Mini-apps sans écran mobile (tuile « Plus » sans effet) | **écran mobile fait** (annuaire, applications autorisées + révocation, demandes de paiement par PIN) ; typecheck et 245 tests mobile OK, non vérifié à l’écran ; consentement OAuth : se fait dans le navigateur de l’application
| G5 | Non consignés jusqu'ici : connexion sociale (Google, Apple, Facebook), biométrie, présence en ligne (fait : 0067), sondages (fait : 0067), recherche dans les messages (fait), messages vocaux côté API, publications sponsorisées, preuve de livraison par photo ou signature, webhooks, actions de l'assistant IA, recherche en langage naturel | planifié |
| G6 | Export et purge : notifications, brouillons, messages programmés | **fait** : purge déjà couverte (notifications, brouillons, messages programmés) ; export ajouté (section « messaging », 200 dernières notifications) ; test e2e du compte OK
| G7 | Consentements non centralisés (table `user_consents`) | planifié |
| G8 | Swahili absent du mobile, langue non persistée (§27) | **fait** : 3090 clés sur 3090 traduites (fichiers `sw-*.ts`) ; **relecture par un locuteur natif obligatoire avant la mise en production** ; la langue est rechargée depuis le profil serveur à la connexion |

## Décisions attendues du propriétaire (bloquantes seulement pour leur module)

| # | Question | Bloque | Options / recommandation |
|---|---|---|---|
| Q1 | **Pays de lancement et devises** | — | **Décidé le 2026-11-07 : RDC, ville pilote Goma ; devises USD et CDF** (défaut `COMMERCE_CURRENCIES=USD,CDF` conforme) |
| Q2 | **Fournisseur OTP** (le propriétaire veut du gratuit) | OTP réels en staging et production | Aucun SMS gratuit en RDC. Décision du 2026-11-07 (ADR-018, code livré, mise en service : docs/OTP_SETUP.md) : e-mail via Brevo (gratuit, 300/jour) + WhatsApp Cloud API (≈ 0,004–0,005 $ par code, à confirmer sur la grille Meta) ; SMS (≈ 0,03 à 0,44 $ selon l’opérateur) en secours seulement. **En attente : création des comptes Brevo et Meta Business par le propriétaire** |
| Q3 | **Chemins des sources SaaS achetées** | Réutilisation (CDC §3) | Voir [SAAS_INVENTORY.md](SAAS_INVENTORY.md) |
| Q4 | **Règles CSL Coins** | Module CSL (désactivé) | Ne seront pas inventées (CDC §18) |
| Q5 | Partenaire Mobile Money | Paiement en ligne, wallet réel | Recommandation du 2026-11-07 : **FlexPay** (agrégateur congolais agréé par la BCC : M-Pesa, Airtel Money, Orange Money, Afrimoney ; USD/CDF), alternative Nomba. **En attente : compte marchand (documents d’entreprise) et grille de frais du fournisseur** |
| Q6 | Hébergement (budget) | Staging et production, TURN/SFU, stockage médias | Option bas coût : VPS + PostgreSQL managé + stockage S3-compatible |
| Q8 | **Compte Expo / EAS** | Push réel, builds iOS/Android | Le propriétaire indique en avoir un ; la machine n’est pas connectée (`expo whoami` : non connecté) et `app.json` n’a pas de `projectId`. **En attente : `npx expo login` par le propriétaire, puis `eas init`** |
| Q9 | **Fournisseur IA** (assistant, CDC §22) | Lot IA | **Décidé le 2026-11-08 : plusieurs fournisseurs au choix de l'utilisateur** (Gemini par défaut ; Groq, Mistral, OpenRouter, tout service compatible OpenAI), activés par l'admin quand une clé est configurée, fiche de chaque modèle (gratuit, vitesse, utilisation des données pour l'entraînement), bascule automatique seulement si l'utilisateur l'accepte. L'offre gratuite peut entraîner sur les données hors EEE : seul du contenu non sensible lui est envoyé (questions posées à l'assistant avec avertissement, textes de produits) ; jamais de messages privés, de KYC ni de paiement. **En attente : clés API créées par le propriétaire (Google AI Studio, puis Groq, Mistral, OpenRouter au choix)** |
| Q7 | Découverte de proximité type « People Nearby » (H-09) | — | Recommandation : ne pas la retenir (vie privée) |

## Risques suivis

- Versions très récentes (NestJS 12, TypeScript 7, Vitest 5) : écosystème de plugins moins éprouvé. Mitigation : peu de plugins, tests d'intégration réels.
- PostGIS : **non utilisé** (distances calculées sans extension, décision du lot 7) ; ne rien installer pour cela.
- Throttling en mémoire : à passer sur Redis en multi-instance.
- La garde d'authentification fait une requête BD par appel : à mettre en cache si la charge l'exige.


## État réel au 2026-11-20 (analyse du code contre le cahier, deux relectures indépendantes)
**À lire avant tout autre tableau de ce fichier** : « testé » signifie API et logique pure testées par machine ; les écrans mobiles de nombreux lots n'ont **pas** été vus à l'écran (galerie, actualités, avis, parents, sondages, webhooks, résultats d'examens, retours, console d'administration, RH, achats, promotions, courses de coursier…). Seuls la page publique de vitrine, l'éditeur « Ma vitrine », la caisse (session, vente, ticket, annulation, clôture), l'onglet Maps et la carte des courses ont été vérifiés dans le navigateur.

| Domaine | Livré dans la série du 2026-11-19/20 | Reste |
|---|---|---|
| Commerce | retours, remboursements (statut, hors plateforme) et litiges (0071-0072), promotions, ventes flash, prix barrés et liste de souhaits (0076-0077), achats/fournisseurs/dépenses/rentabilité/exports CSV (0082-0083) | paiement en ligne (tiers), produits numériques, comparaison de prix du catalogue |
| Entreprise | RH sans calcul de paie légal, plannings, congés (0084), lots, péremption, inventaire physique (0085) | comptabilité, taxes, paie légale (barèmes non spécifiés) |
| Livraison | express et programmée, coursier à la demande, tournée simple (0078-0079) | entrepôts, flotte, international ; le coursier est un chauffeur de mobilité approuvé (pas de livreur indépendant distinct) |
| Administration | console mobile, analytique, double validation à deux administrateurs (0073-0074) | tableau de bord de rétention avancé, commissions, paramètres par pays |
| Vie privée | consentements centralisés append-only, écrans « Mes données » et « Mes consentements », nom d'appareil (0075) | les consentements position, analytique ne sont lus par aucun module |
| Plateforme | /metrics, request-id, liveness/readiness, CI web et Docker, test de charge, test de fumée, docs QUALITY et LOAD_TESTING | lint (ESLint non installé), tests de parcours automatisés sur mobile, Redis pour plusieurs instances, S3/CDN, sauvegardes jamais exécutées |
| Créateurs | favoris de publications, hashtags (tendances, suggestions, rattrapage), statistiques de portée sans identité des spectateurs, tableau de bord créateur, pourboires et publications sponsorisées **en mode test** (argent fictif du portefeuille de test ; budget des boosts versé au compte système `fees`, remboursé au rejet par un modérateur) (0086-0087) | **abonnements payants** : NON, ils exigent de l'argent réel récurrent donc le paiement en ligne (tiers) ; annulation d'un boost par l'auteur (statut `cancelled` prévu, pas de route) ; les pourboires et boosts n'ont aucune valeur réelle |
| Mobilité (2e partie) | covoiturage (trajets, réservations avec places sous verrou, recherche par proximité, évaluations, cible de signalement `carpool_trip`), location de véhicules par des organisations (disponibilité sans chevauchement, total serveur, 0092), dépannage avec prestataires = chauffeurs approuvés, position consentie (0093) ; espèces uniquement | avis des locataires (le modèle d'avis de services ne s'y prête pas), photos des véhicules depuis l'écran mobile (l'API les accepte), écrans mobiles non vus à l'écran, tuiles de menu à brancher |
| IA | traduction avec consentement, actions confirmées, recherche en langage naturel, mentions (0080-0081) | MCP/agents, voix et image, analyses d'entreprise |

**Retirés ou exclus par le propriétaire** : trading, paris, services publics, CSL Coins (règles non spécifiées), abonnements payants (argent réel récurrent), web (7 de la liste) et e-mails transactionnels (11).
**Bloqués par un tiers** : paiement en ligne et Mobile Money (FlexPay), OTP réels (Brevo, WhatsApp), push réel et builds (compte Expo), médias d'appels (TURN), hébergement, domaine, stockage objet et CDN, tuiles de carte de production, connexion sociale (clés Google, Apple, Facebook), biométrie (paquet à installer, refusé par le système d'autorisations), envoi de PDF depuis le mobile (paquet `expo-document-picker`, refusé).
