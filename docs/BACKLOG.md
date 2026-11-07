# Backlog CASELIND

Dernière mise à jour : 2026-11-02. **Règle CDC §0 : rien n'est supprimé.** Ce qui est différé reste ici avec son statut. Traçabilité fonctionnelle complète : [WECHAT_FUNCTIONAL_MAP.md](reverse-engineering/WECHAT_FUNCTIONAL_MAP.md) (96 lignes).

Statuts : `planifié` · `en cours` · `implémenté` · `testé` · `validé` · `bloqué` · `reporté`

## Ordre imposé

1. Reverse engineering et cartographie WeChat : **v1 faite** (sources publiques ; à enrichir module par module)
2. **Backend** : en cours (lots 1, 1b, 2, 3, 4 et 5 testés)
3. **Mobile** (React Native + Expo) : en cours. M1 (socle, auth, messagerie temps réel, notifications) codé et testé sur Expo web ; validation sur appareil à faire
4. Intégration mobile ↔ backend, tests et validation
5. **Web** (React + TS + Vite) : seulement après la validation du mobile

## Lots backend

| Lot | Contenu | Critères d'acceptation | Statut |
|---|---|---|---|
| **1 — Identité** | Socle (config, BD, migrations, erreurs, journaux, rate limit, health), inscription téléphone/e-mail + OTP, connexion, verrouillage, rotation des refresh tokens + détection de rejeu, sessions et révocation à distance, mot de passe oublié, profil et @handle, profil public, journal de sécurité, audit append-only, RBAC plateforme | 39 tests automatisés (voir PROGRESS) | **testé** |
| **1b — Compléments identité** | Feature flags par pays et par rôle (réglementés coupés par défaut, confirmation explicite verrouillée en transaction) ; confidentialité et blocages ; export des données et demande de suppression (grâce de 30 j, puis anonymisation) ; OpenAPI 3.1 généré depuis Zod (`GET /v1/openapi.json`) ; nettoyage planifié des OTP, refresh tokens et sessions périmés | 82 tests automatisés au total, dont 43 nouveaux (voir PROGRESS). Réglages de confidentialité stockés, appliqués par les lots messagerie et recherche | **testé** |
| 1c — Reste identité | 2FA TOTP ; changement d'identifiant (téléphone/e-mail) ; connexion web par QR ; Dockerfile + CI ; cache Redis (sessions, flags, throttling) | à détailler au démarrage du lot | planifié |
| 2 — Organisations et médias | Organisations, membres et rôles, invitations, vitrine publique ; médias avec détection du type réel, quotas et purge ; intégration avec la suppression de compte | 162 tests (voir PROGRESS) | **testé** |
| 2b — Reste médias et organisations | Adaptateur S3 + CDN (après Q6), Range/304 vidéo, ré-encodage et suppression EXIF, expiration et limite des invitations, slugs réservés en base, suspension et vérification des organisations par l'admin, suppression d'organisation | | planifié |
| 3 — Messagerie et notifications | Conversations 1:1 et groupes, messages, pièces jointes, accusés, WebSocket, push Expo, centre de notifications | 223 tests (voir PROGRESS) | **testé** |
| 3b — Reste messagerie | Transfert, favoris, brouillons serveur, messages éphémères et programmés, partage de position, messages vocaux (côté mobile), reçus différés Expo, déconnexion immédiate à la suspension admin, filtrage par `firstSeq` des événements `message.updated`/`message.reaction`, appels WebRTC (décision TURN/SFU, Q6), traduction (consentement), conversation commerciale (lot 5) | | planifié |
| 4 — Social | Posts, visibilité, réactions, commentaires, abonnements, stories 24 h, vidéos courtes, signalements et modération | 273 tests (voir PROGRESS) | **testé** |
| 4b — Reste social | Listes d’amis proches et audiences personnalisées, salons, live, favoris (C-08), stickers (C-11), tableau de bord créateur (C-12), classement du flux vidéo, limite de débit des publications, accès modérateur aux médias masqués | | planifié |
| 5 — Commerce | Catalogue, variantes, stock, panier multi-vendeurs, commandes scindées, avis vérifiés, coupons | 330 tests (voir PROGRESS) ; paiement à la livraison seulement (ADR-017) | **testé** |
| 5b — Reste commerce | Paiement en ligne (après Q5), livraison et suivi (lot 9), promotions et ventes flash (E-05), live shopping (E-07), service client dans le chat (E-06), favoris produits, recherche plein texte avancée | | planifié |
| 6 — Ledger et wallet (sandbox) | Ledger en partie double append-only, wallet, transferts idempotents, QR marchand signé, KYC par niveaux, **aucun argent réel** | | planifié |
| 7 — Lieux et recherche | Lieux, proximité (PostGIS en prod), recherche universelle | | planifié |
| 8+ | Livraison, mini-apps (OAuth à code éphémère + scopes), IA, mobilité, services, santé, éducation, emploi, immobilier, services publics, jeux, trading (simulation), finance personnelle | | planifié |

## Lots mobile

| Lot | Contenu | Statut |
|---|---|---|
| M1 — Socle et messagerie | Design system, navigation imposée, en-tête, auth, sessions, confidentialité, messagerie temps réel, notifications, push | **testé** (unitaires + parcours Expo web contre l'API réelle) ; appareil réel à faire |
| M1b — Reste | Contacts et QR, messages vocaux, recherche, archive, avatars réels, persistance de la langue, compte Expo/EAS pour le push réel | planifié |
| M2 — Social | Fil, publications, commentaires, profils, Stories, signalements ; design Apple (ADR-016) | **testé** (unitaires + parcours Expo web contre l'API réelle) |

## Décisions attendues du propriétaire (bloquantes seulement pour leur module)

| # | Question | Bloque | Options / recommandation |
|---|---|---|---|
| Q1 | **Pays de lancement et devises** | Wallet réel, KYC, fournisseurs SMS/paiement, conformité | Ex. RDC (CDF/USD), Kenya (KES)… Le swahili suggère l'Afrique de l'Est et la RDC. |
| Q2 | **Fournisseur SMS/OTP** (payant) | OTP en staging et en production | Africa's Talking (couverture Afrique de l'Est), Twilio (global, plus cher), Infobip. Recommandation : Africa's Talking si le lancement se fait en Afrique de l'Est. |
| Q3 | **Chemins des sources SaaS achetées** | Réutilisation (CDC §3) | Voir [SAAS_INVENTORY.md](SAAS_INVENTORY.md) |
| Q4 | **Règles CSL Coins** | Module CSL (désactivé) | Ne seront pas inventées (CDC §18) |
| Q5 | Partenaire de paiement / Mobile Money | Wallet réel | Flutterwave, Paystack, CinetPay, opérateurs directs : dépend de Q1 |
| Q6 | Hébergement (budget) | Staging et production, TURN/SFU, stockage médias | Option bas coût : VPS + PostgreSQL managé + stockage S3-compatible |
| Q8 | **Compte Expo / EAS** (gratuit au départ) | Push réel et builds iOS/Android | Recommandation : compte EAS gratuit pour obtenir un `projectId` |
| Q7 | Découverte de proximité type « People Nearby » (H-09) | — | Recommandation : ne pas la retenir (vie privée) |

## Risques suivis

- Versions très récentes (NestJS 12, TypeScript 7, Vitest 5) : écosystème de plugins moins éprouvé. Mitigation : peu de plugins, tests d'intégration réels.
- PostGIS absent en dev : les requêtes géographiques du lot 7 exigeront un PostgreSQL avec PostGIS (Docker ou service distant).
- Throttling en mémoire : à passer sur Redis en multi-instance.
- La garde d'authentification fait une requête BD par appel : à mettre en cache si la charge l'exige.
