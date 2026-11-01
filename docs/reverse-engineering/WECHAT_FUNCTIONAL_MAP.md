# Cartographie fonctionnelle WeChat/Weixin → CASELIND et matrice de couverture

Dernière mise à jour : 2026-11-01 · Codes de confiance : voir [EVIDENCE_AND_GAPS.md](EVIDENCE_AND_GAPS.md) (V, DP, CG, D, I).

**Lecture :** chaque ligne indique la fonction de référence, sa preuve, l'équivalent CASELIND, l'écart à combler, les écrans, les API/données, un test d'acceptation et l'**état réel**. L'état suit l'échelle : `à analyser` → `planifié` → `en cours` → `implémenté` → `testé` → `validé`. Les noms d'écrans renvoient à [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md) et les parcours (`F-xx`) à [USER_FLOWS.md](USER_FLOWS.md).

Les fonctions CASELIND qui n'existent pas dans WeChat (exigences propres du cahier des charges) figurent dans la section **I**. Elles ne sont pas secondaires.

Disponibilité dans WeChat : **G** = globale, **R** = régionale (surtout Chine continentale), **P** = soumise à des partenaires ou licences.

---

## A. Compte, identité et sécurité

| ID | Fonction de référence | Dispo / preuve | Équivalent CASELIND | Écart / adaptation | Écrans | API & données | Test d'acceptation | État |
|---|---|---|---|---|---|---|---|---|
| A-01 | Onboarding, choix de langue | G / CG | Onboarding FR/EN/SW, choix de langue et de pays | Ajouter le pays (feature flags §26) | `Onboarding`, `LanguagePicker` | `GET /v1/config/public` | La langue choisie persiste après redémarrage | planifié |
| A-02 | Inscription par téléphone et OTP SMS | G / CG | Inscription par téléphone **ou** e-mail avec OTP | Fournisseur SMS non choisi : canal `dev` (outbox journalisée) en attendant | `SignUp`, `OtpVerify` | `POST /v1/auth/register`, `POST /v1/auth/otp/verify` ; tables `users`, `otp_challenges` | Un compte non vérifié ne peut pas se connecter, et l'OTP expire et se bloque après 5 essais | **testé** (lot 1) |
| A-03 | Connexion mot de passe / SMS | G / CG | Connexion identifiant + mot de passe, puis OTP de connexion (backlog) | Connexion sans mot de passe par OTP : lot 1b | `SignIn` | `POST /v1/auth/login` | Mauvais mot de passe → 401 générique ; verrouillage temporaire après N échecs | **testé** (lot 1) |
| A-04 | Connexion via QR depuis un autre appareil (web) | G / CG | Le mobile approuve la session web par QR | Requiert le web (phase 4) ; contrat API défini dès maintenant | `QrScanner`, `ApproveDevice` | `POST /v1/auth/qr/challenge`, `POST /v1/auth/qr/approve` | Le QR expire en 2 min ; usage unique | planifié |
| A-05 | Récupération de compte | G / CG | Réinitialisation du mot de passe par OTP ; récupération assistée (support) | Révoque toutes les sessions | `ForgotPassword`, `ResetPassword` | `POST /v1/auth/password/forgot`, `POST /v1/auth/password/reset` | Après réinitialisation, les anciens refresh tokens sont refusés | **testé** (lot 1) |
| A-06 | Gestion des appareils et sessions | G / CG | Liste des sessions actives, révocation à distance | — | `Sessions` | `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/:id` | Une session révoquée ne peut plus rafraîchir son jeton | **testé** (lot 1) |
| A-07 | Journal de sécurité / alertes de connexion | G / CG | Journal de sécurité consultable + notification de nouvelle connexion | Notification : lot notifications | `SecurityLog` | `GET /v1/me/security-events` ; table `audit_events` | Chaque connexion, échec, réinitialisation et révocation est journalisé sans secret | **testé** (lot 1) |
| A-08 | Changement de téléphone / e-mail | G / CG | Changement avec OTP sur le nouvel identifiant + mot de passe | — | `ChangeIdentifier` | `POST /v1/me/identifiers` | L'ancien identifiant reste actif tant que le nouveau n'est pas vérifié | planifié |
| A-09 | Profil (avatar, nom, ID, signature, QR perso) | G / CG | Profil : nom affiché, @handle unique, bio, avatar, QR de profil | — | `MyProfile`, `EditProfile`, `MyQr` | `GET/PATCH /v1/me`, `GET /v1/users/:handle` | @handle unique insensible à la casse | **testé** (lot 1, sans avatar) |
| A-10 | Confidentialité (qui peut m'ajouter, me trouver, voir mes publications) | G / CG | Réglages de confidentialité par axe | — | `PrivacySettings` | `GET/PATCH /v1/me/privacy` ; colonnes `users.discoverable_by_*`, `contact_requests_from`, `read_receipts` | Un utilisateur introuvable par téléphone n'apparaît pas en recherche | **testé** (lot 1b) : réglages stockés et modifiables ; leur application viendra avec la messagerie (lot 3) et la recherche (lot 7) |
| A-11 | Blocage / liste noire | G / CG | Blocage bidirectionnel (messages, profil, recherche) | — | `BlockedUsers` | `GET /v1/blocks`, `PUT/DELETE /v1/blocks/:userId` ; table `user_blocks` | Un utilisateur bloqué ne peut pas envoyer de message (403) | **testé** (lot 1b) côté profil : masqué dans les deux sens ; application à la messagerie au lot 3 |
| A-12 | Signalement d'un compte | G / CG | Signalement + file de modération | Lien avec l'admin (§26) | `ReportSheet` | `POST /v1/reports` | Le signalement crée une entrée de modération | planifié |
| A-13 | 2FA / biométrie | G / CG (vérification de sécurité) | TOTP + biométrie locale (Expo LocalAuthentication) pour déverrouiller l'app | — | `TwoFactor` | `POST /v1/me/2fa/*` | Connexion avec 2FA activé : un second facteur est exigé | planifié |
| A-14 | Vérification d'identité réelle (requise pour le paiement) | R,P / DP (S6) | KYC par niveaux (aucun / basique / complet), configurable par pays | Partenaire KYC non choisi, statuts seulement | `KycStatus`, `KycSubmit` | `GET/POST /v1/kyc` ; `kyc_cases` | Les capacités financières dépendent du niveau | planifié |
| A-15 | Suppression du compte, export des données | G / CG | Demande de suppression (délai de grâce) + export | Règles de conservation par pays | `DeleteAccount`, `DataExport` | `POST /v1/me/deletion-request`, `GET /v1/me/export` ; `users.deletion_requested_at` | Le compte est désactivé immédiatement, puis supprimé après le délai | **testé** (lot 1b) : sessions révoquées et profil masqué dès la demande, anonymisation après 30 j ; règles de conservation par pays non traitées |
| A-16 | Multi-comptes sur un appareil | G / CG | Bascule entre profils personnel et professionnels (organisations) | Les organisations ne sont pas des comptes séparés | `AccountSwitcher` | `GET /v1/me/memberships` | La bascule change le contexte org des requêtes | planifié |

## B. Communication

| ID | Fonction de référence | Dispo / preuve | Équivalent CASELIND | Écart / adaptation | Écrans | API & données | Test d'acceptation | État |
|---|---|---|---|---|---|---|---|---|
| B-01 | Chats 1:1 | G / V (S1) | Conversation directe | — | `ChatList`, `ChatRoom` | `POST /v1/conversations`, `GET/POST /v1/conversations/:id/messages` ; WebSocket `message.new` | Un non-membre ne peut pas lire les messages (403) | planifié (lot 3) |
| B-02 | Groupes (jusqu'à plusieurs centaines de membres), admin, annonce, @mention | G / CG | Groupes : rôles propriétaire/admin/membre, annonce épinglée, mentions | Taille max configurable | `GroupInfo`, `GroupMembers` | `/v1/conversations/:id/members` | Seul un admin peut retirer un membre | planifié |
| B-03 | Texte, emoji, photos, vidéos, fichiers | G / CG | Pièces jointes avec compression, limites par type | Stockage objet (S3-compatible) | `ChatRoom`, `MediaViewer` | `POST /v1/media/uploads` (URL signée) | Un type refusé renvoie 415 ; taille max respectée | planifié |
| B-04 | Messages vocaux | G / CG | Messages vocaux (Expo AV), transcription en option | Transcription via IA : coût à valider | `ChatRoom` | Média `audio/*` | Lecture du message vocal hors connexion après cache | planifié |
| B-05 | Accusés de réception (WeChat n'affiche pas les « lu ») | G / CG | Envoyé / reçu / lu, désactivable dans la confidentialité | Différence volontaire (exigence CDC §6) | `ChatRoom` | `message_receipts` | Les accusés « lu » désactivés ne sont pas émis | planifié |
| B-06 | Rappel (retrait) de message dans un délai | G / CG | Suppression pour tous dans un délai configurable | — | `ChatRoom` | `DELETE /v1/messages/:id?scope=all` | Au-delà du délai → 409 | planifié |
| B-07 | Citation, transfert, favoris | G / CG | Réponse citée, transfert, favoris | — | `ChatRoom`, `Favorites` | `reply_to_id`, `/v1/favorites` | Un transfert vers une conversation interdite échoue | planifié |
| B-08 | Appels audio / vidéo 1:1 et groupe | G / CG | WebRTC : signalisation via WebSocket, serveurs TURN | **TURN à héberger (coût)** ; groupe = SFU (LiveKit, open source) à décider | `CallScreen`, `IncomingCall` | Événements WS `call.*` | Un appel non accepté expire en 45 s | planifié — décision infra |
| B-09 | Partage de position (ponctuel / en temps réel) | G / CG | Position ponctuelle + partage live temporaire | Consentement explicite, durée limitée (CDC §25) | `ShareLocation`, `LiveLocation` | Message `location` | Le partage live s'arrête à l'expiration | planifié |
| B-10 | Contacts, ajout par ID / téléphone / QR, demandes d'amitié | G / CG | Contacts, demandes, QR de profil | Respecte la confidentialité A-10 | `Contacts`, `AddContact`, `FriendRequests` | `/v1/contacts`, `/v1/contact-requests` | Une demande en double est idempotente | planifié |
| B-11 | Tags / étiquettes de contacts | G / CG | Listes de contacts (utilisées pour la visibilité des posts) | — | `ContactLabels` | `/v1/contact-lists` | — | planifié |
| B-12 | Recherche dans les conversations | G / CG | Recherche plein texte (pg_trgm) par conversation et globale | Incompatible avec l'E2E futur : à noter | `ChatSearch` | `GET /v1/search?scope=messages` | Ne renvoie que les messages des conversations du demandeur | planifié |
| B-13 | Non-lus, épingler, sourdine, masquer | G / CG | Compteurs de non-lus, épinglage, sourdine, archivage | — | `ChatList` | `conversation_members.last_read_at, muted_until, pinned` | Le compteur se remet à zéro à la lecture | planifié |
| B-14 | Traduction de message | G / V (S1 mentionne la traduction) / DP | Traduction à la demande, avec l'original consultable | Fournisseur tiers = consentement (CDC §6) | `ChatRoom` | `POST /v1/translate` | Le texte traduit est marqué comme traduction automatique | planifié |
| B-15 | Red packets (enveloppes rouges) | R,P / DP (S6) | « Enveloppe » cadeau via le wallet **sandbox uniquement** | Fonction financière réglementée | `SendGift` | Ledger | Désactivé tant que le wallet réel n'est pas validé | planifié — bloqué conformité |
| B-16 | Messages éphémères / programmés | — (absent de WeChat, CG) | Exigence CDC §6 | Spécifique CASELIND | `ChatRoom` | `expires_at`, `scheduled_at` | Message expiré non renvoyé par l'API | planifié |
| B-17 | Conversation commerciale (devis, commande dans le chat) | Partiel via comptes de service / CG | Cartes produit, devis, commande et paiement dans le fil | Spécifique CASELIND (CDC §6) | `ChatRoom` (cartes) | Message `type=product/quote/order` | Le paiement passe par le checkout, pas par le chat | planifié |

## C. Réseau social et contenus

| ID | Fonction de référence | Dispo / preuve | Équivalent CASELIND | Écart / adaptation | Écrans | API & données | Test d'acceptation | État |
|---|---|---|---|---|---|---|---|---|
| C-01 | Moments (fil des amis) : texte, photos, vidéo, lien | G / V (S1) | Fil Accueil : posts texte/médias/liens, d'amis, d'abonnements et de boutiques | CASELIND mélange social et commerce (CDC §6) | `HomeFeed`, `PostDetail`, `Composer` | `/v1/posts`, `/v1/feed` | Un post « amis seulement » est invisible pour les non-amis | planifié (lot 4) |
| C-02 | Likes et commentaires visibles seulement par amis communs | G / CG | Réactions et commentaires ; visibilité configurable | Modèle plus ouvert que WeChat (public possible) | `PostDetail` | `/v1/posts/:id/reactions`, `/comments` | Respect de la visibilité du post parent | planifié |
| C-03 | Visibilité par groupe d'amis / masquer à certains | G / CG | Public / abonnés / amis / listes / privé | — | `Composer` | `posts.visibility`, `post_audiences` | Test de matrice de visibilité | planifié |
| C-04 | Statut (état temporaire 24 h) | G / CG | **Stories** en haut de l'Accueil (exigence de navigation) | Exigence CDC (24 h configurable) | `StoriesBar`, `StoryViewer`, `StoryComposer` | `/v1/stories` ; `expires_at` | Une story expirée n'est plus servie | planifié |
| C-05 | Channels : vidéos courtes, flux vertical | G / V (S1), DP (S5) | Flux vidéo court vertical | Transcodage (coût) | `ShortVideoFeed`, `VideoComposer` | `/v1/videos` | — | planifié |
| C-06 | Live (Channels live, live commerce) | G / DP | Live + live shopping (CDC §38) | **Fournisseur vidéo à choisir** (coût) | `LiveRoom`, `GoLive` | — | — | planifié — décision infra |
| C-07 | Comptes officiels : abonnement, articles, menus | G / V (S1), DP (S5) | Pages publiques d'organisation : publications, abonnement, menu de services | Vitrine professionnelle (CDC §5) plus riche | `OrgPage`, `Article` | `/v1/orgs/:slug`, `/v1/orgs/:id/posts` | Seuls les rôles éditeurs de l'org publient | planifié |
| C-08 | Favoris (collections) | G / CG | Favoris transverses (messages, posts, produits) | — | `Favorites` | `/v1/favorites` | — | planifié |
| C-09 | Recherche de contenus (Weixin Search) | G / V (S1) | Recherche universelle (CDC §24) | — | `Search`, `SearchResults` | `GET /v1/search` | Résultats par catégorie, sans contenu privé d'autrui | planifié |
| C-10 | Signalement et modération des contenus | G / CG | Signalement, file de revue, sanctions graduées | — | `ReportSheet`, admin | `/v1/reports`, `/v1/admin/moderation` | Un contenu masqué par la modération n'est plus servi | planifié |
| C-11 | Stickers / emoji personnalisés | G / CG | Packs de stickers (originaux) | Pas d'assets WeChat | `StickerPicker` | `/v1/stickers` | — | planifié |
| C-12 | Outils créateurs, pourboires | G / CG | Profils créateurs, statistiques, pourboires (wallet) | Financier → sandbox | `CreatorDashboard` | — | — | planifié |

## D. Paiements et services financiers

> Règle : **aucune** fonction de cette section n'est réelle tant que le wallet n'a pas de ledger en partie double, de partenaire agréé, de KYC et de rapprochement (CDC §17). Tout fonctionne d'abord en **sandbox** avec indication visible.

| ID | Fonction de référence | Dispo / preuve | Équivalent CASELIND | Écart / adaptation | Écrans | API & données | Test d'acceptation | État |
|---|---|---|---|---|---|---|---|---|
| D-01 | Portefeuille, solde | R,P / V (S1 : Weixin Pay) | Wallet multi-devises, solde **calculé depuis le ledger** | Ledger append-only en partie double | `Wallet`, en-tête (solde + devise) | `GET /v1/wallet`, tables `ledger_accounts`, `ledger_entries` | La somme des écritures d'une transaction vaut 0 | planifié (lot 6) |
| D-02 | Moyens de paiement (cartes, banques) | R,P / DP (S6) | Mobile Money (M-Pesa, Airtel, Orange…), agrégateurs (Flutterwave, Paystack, CinetPay) | **Partenaire et pays à choisir** | `PaymentMethods` | `/v1/payment-methods` | — | bloqué — décision propriétaire |
| D-03 | Payer en scannant un QR marchand | G* / DP (S6) | QR marchand signé côté serveur | — | `ScanPay`, `PayConfirm` | `POST /v1/payments/qr/resolve`, `/pay` | Un QR falsifié est rejeté (signature) | planifié |
| D-04 | Code de paiement (le marchand scanne le client) | G* / DP (S6) | Code de paiement dynamique (TOTP-like, 60 s) | — | `PaymentCode` | — | Un code réutilisé est refusé | planifié |
| D-05 | Transfert P2P, demande d'argent | R / DP (S6 : restreint selon le statut) | Transfert P2P selon niveau KYC et pays | Limites configurables | `Transfer`, `RequestMoney` | `POST /v1/transfers` (clé d'idempotence) | Un double envoi avec la même clé = une seule transaction | planifié |
| D-06 | Red packets | R / DP | Voir B-15 | — | — | — | — | bloqué conformité |
| D-07 | Historique, reçus, factures | G / CG | Historique filtrable et reçus PDF | — | `Transactions`, `Receipt` | `GET /v1/wallet/transactions` | — | planifié |
| D-08 | Remboursement, contestation | G / CG | Remboursements, litiges liés aux commandes, séquestre | Escrow : validation juridique | `Dispute` | `/v1/disputes` | Remboursement = écritures inverses, jamais modification | planifié |
| D-09 | Services (recharge mobile, factures, etc.) | R,P / CG | Paiement de factures via partenaires | Intégrations réelles uniquement | `BillPay` | — | — | planifié — partenaires |
| D-10 | Contrôles de sécurité (PIN de paiement, limites) | G / CG | PIN de paiement distinct, biométrie, plafonds, vélocité, double validation | — | `PaymentPin` | — | Trois PIN erronés bloquent temporairement les paiements | planifié |
| D-11 | Coupons / cartes de fidélité | G / CG | Coupons marchands et fidélité ; **CSL Coins** séparés (règles non définies) | Ne pas inventer les règles CSL | `Coupons`, `CslCoins` | — | CSL Coins désactivés par feature flag | planifié — bloqué règles |

## E. Commerce

| ID | Fonction de référence | Dispo / preuve | Équivalent CASELIND | Écart / adaptation | Écrans | API & données | Test d'acceptation | État |
|---|---|---|---|---|---|---|---|---|
| E-01 | Boutiques (Weixin Shop / mini-programmes marchands) | G / DP | Marketplace multi-vendeurs + vitrines (CDC §5, §7) | Natif, pas via mini-programme | `Shop`, `OrgPage` | `/v1/orgs`, `/v1/products` | — | planifié (lot 5) |
| E-02 | Recherche, catégories, filtres | G / CG | Recherche produits/services, filtres, tri | — | `Search`, `Category` | `GET /v1/products?…` | — | planifié |
| E-03 | Panier, commande, paiement | G / CG | Panier multi-vendeurs → commandes séparées par vendeur | — | `Cart` (icône d'en-tête), `Checkout`, `OrderDetail` | `/v1/cart`, `/v1/orders` | Une commande multi-vendeurs crée N sous-commandes | planifié |
| E-04 | Livraison et suivi | G / CG | Statuts, suivi, preuve de livraison (CDC §9) | — | `OrderTracking` | `/v1/orders/:id/events` | — | planifié |
| E-05 | Promotions, coupons, ventes flash | G / CG | Promotions configurables | — | `Promotions` | — | — | planifié |
| E-06 | Service client dans le chat | G / CG | Chat commercial (B-17) | — | — | — | — | planifié |
| E-07 | Live shopping | G / DP | C-06 + produits épinglés | — | `LiveRoom` | — | — | planifié |
| E-08 | Avis et notes | partiel / CG | Avis vérifiés (achat confirmé) | Anti-faux avis | `Reviews` | `/v1/products/:id/reviews` | Seul un acheteur livré peut noter | planifié |

## F. Mini-programmes et services

| ID | Fonction de référence | Dispo / preuve | Équivalent CASELIND | Écart / adaptation | Écrans | API & données | Test d'acceptation | État |
|---|---|---|---|---|---|---|---|---|
| F-01 | Découverte, recherche, récents, favoris | G / V (S1) | Menu **Plus** : catalogue de mini-apps, récents, favoris | Navigation imposée (Plus) | `More`, `MiniAppStore` | `GET /v1/miniapps` | — | planifié |
| F-02 | Lancement dans un conteneur | G / V (S1) | Conteneur WebView isolé + pont JS signé | Sandbox, liste blanche d'origines | `MiniAppHost` | — | Une mini-app ne peut pas lire le jeton CASELIND | planifié |
| F-03 | Login silencieux via code éphémère (`wx.login` → `code2Session`) | G / **V (S2)** | `caselind.login()` → code 5 min usage unique → échange serveur à serveur | Conception propre | — | `POST /v1/miniapps/auth/code`, `POST /v1/oauth/token` | Code réutilisé ou expiré refusé | planifié |
| F-04 | Autorisations par scope, révocables | G / **V (S3, S4)** | Scopes CASELIND (profil, position, paiement, contacts…) | — | `MiniAppPermissions` | `miniapp_grants` | Scope refusé → appel API refusé | planifié |
| F-05 | Paiement dans la mini-app | G / CG | Paiement via le checkout CASELIND (jamais par la mini-app) | — | `PayConfirm` | — | — | planifié |
| F-06 | Partage et liens profonds | G / CG | Liens `caselind://` et liens universels | — | — | — | — | planifié |
| F-07 | Console développeur, revue, versions | G / CG | Portail développeur (web, phase 4) | — | (web) | `/v1/dev/*` | — | planifié |
| F-08 | Mini-jeux | G / V (S1) | Play & Win (CDC §21) | Paris désactivés par défaut | `Games` | — | — | planifié |

## G. Entreprises et comptes professionnels

| ID | Fonction de référence | Dispo / preuve | Équivalent CASELIND | Écart / adaptation | Écrans | API & données | Test d'acceptation | État |
|---|---|---|---|---|---|---|---|---|
| G-01 | Comptes officiels (service / abonnement) | G / V (S1), DP (S5) | Organisations : page publique, abonnés, publications | — | `OrgPage`, `OrgAdmin` | `/v1/orgs` | — | planifié (lot 2) |
| G-02 | Messages clients, réponses automatiques | G / CG | Boîte de réception org partagée, réponses rapides et IA | — | `OrgInbox` | — | Un employé sans rôle « support » n'accède pas à l'inbox | planifié |
| G-03 | WeCom (communication interne) | G / CG | Espace équipe : membres, rôles, permissions | — | `OrgMembers` | `/v1/orgs/:id/members` | RBAC appliqué côté serveur | planifié (lot 2) |
| G-04 | Statistiques | G / CG | Tableaux de bord org | — | `OrgDashboard` | — | — | planifié |
| G-05 | Gestion d'entreprise (ERP léger) | — (hors WeChat) | Stock, caisse, CRM, RH (CDC §8) | Spécifique CASELIND | (web prioritaire) | — | — | planifié |

## H. Autres domaines

| ID | Fonction de référence | Dispo / preuve | Équivalent CASELIND | Écrans | État |
|---|---|---|---|---|---|
| H-01 | Recherche globale | G / V (S1) | Recherche universelle (C-09) | `Search` | planifié |
| H-02 | Cartes, services locaux (« à proximité ») | R / CG | Onglet **Maps** : commerces, prestataires, événements | `MapExplore`, `PlaceDetail` | planifié (lot 7) |
| H-03 | Transport, VTC, train, avion (via mini-programmes partenaires) | R,P / CG | Mobilité (CDC §10) via partenaires | `Mobility` | planifié — partenaires |
| H-04 | Santé (hôpitaux, rendez-vous) | R,P / CG | Santé (CDC §12), données hautement sensibles | `Health` | planifié — licences |
| H-05 | Éducation | R,P / CG | Éducation (CDC §13) | `Education` | planifié |
| H-06 | Services publics | R,P / CG | Annuaire, alertes (CDC §16), aucune intégration officielle simulée | `PublicServices` | planifié |
| H-07 | Stickers | G / CG | C-11 | — | planifié |
| H-08 | Publicité (Moments ads, comptes officiels) | G / CG | Publications sponsorisées (CDC §7, §33) | — | planifié |
| H-09 | Shake / People Nearby (découverte de proximité) | G / CG (fonctions modifiées ou retirées selon les versions) | **Non retenu** : risques vie privée. Proposition à valider. | — | à analyser |
| H-10 | « Scan » universel (QR, produit, traduction) | G / CG | Scanner universel : profil, boutique, paiement, produit (CDC §24) | `Scanner` | planifié |
| H-11 | Assistant / traduction intégrée | G / DP | Assistant IA CASELIND (CDC §22) | `Assistant` | planifié |

## I. Exigences propres à CASELIND (hors référence WeChat)

| ID | Exigence (CDC §) | Équivalent / module | Dépendances | État |
|---|---|---|---|---|
| I-01 | Vitrines pro / mini-sites, domaine perso (§5) | `orgs`, `storefront` | orgs, media, SEO web | planifié |
| I-02 | Marketplace multi-vendeurs, produits digitaux (§7) | `catalog`, `orders` | orgs, wallet | planifié |
| I-03 | Gestion d'entreprise : stock, caisse, CRM, RH (§8) | `erp-*` | orgs, RBAC | planifié |
| I-04 | Livraison, dispatch, coursiers (§9) | `delivery` | orders, maps, realtime | planifié |
| I-05 | Mobilité (§10), services de proximité (§11) | `mobility`, `services` | maps, partenaires | planifié |
| I-06 | Santé (§12), éducation (§13), emploi (§14), immobilier (§15), services publics (§16) | modules dédiés | licences et partenaires | planifié |
| I-07 | Wallet, Mobile Money, ledger (§17) | `wallet`, `ledger`, `payments` | KYC, partenaire | planifié (sandbox) |
| I-08 | CSL Coins (§18) | `csl` (désactivé) | **règles du propriétaire** | bloqué — décision |
| I-09 | Finance personnelle (§19) | `pfm` | wallet | planifié |
| I-10 | Trading + robots, paper trading d'abord (§20) | `trading` (simulation) | données de marché, licences | planifié (simulation) |
| I-11 | Play & Win, NFT, paris désactivés (§21) | `games` | légal | planifié |
| I-12 | IA : assistant, recherche naturelle, création de boutique assistée, agents (§22) | `ai` (abstraction fournisseur) | coûts, consentement | planifié |
| I-13 | Plateforme mini-apps et SDK (§23) | `miniapps` | auth OAuth | planifié |
| I-14 | Notifications centrales (§24) | `notifications` (Expo Push) | — | planifié (lot 3) |
| I-15 | Back-office, feature flags par pays (§26) | `admin`, `flags` | RBAC | flags **testé** (lot 1b, API par pays et par rôle) ; interface back-office à venir |
| I-16 | i18n FR/EN/SW (§27) | `packages/i18n` | — | planifié |
| I-17 | Navigation mobile imposée : Accueil · Maps · + · Messagerie · Plus ; en-tête logo / recherche / wallet + devise / panier / compte | app mobile | — | planifié (phase mobile) |

---

### Synthèse de couverture (2026-11-01)

- Lignes cartographiées : 96 (A 16, B 17, C 12, D 11, E 8, F 8, G 5, H 11, I 17 exigences propres)
- **Testé** : 9 (lot 1 : A-02, A-03, A-05, A-06, A-07 ; lot 1b : A-10, A-11, A-15, I-15) et A-09 partiel. Backend seulement. A-10 et A-11 sont testés côté réglages et profil, pas encore dans la messagerie ni la recherche ; voir [PROGRESS.md](../PROGRESS.md) pour les résultats exacts.
- Bloqué par une décision du propriétaire : D-02, D-06/B-15, D-11/I-08, et les décisions d'infrastructure B-08 et C-06.
- Rien n'est **validé** : aucune validation propriétaire ni test bout-en-bout mobile n'a eu lieu.
