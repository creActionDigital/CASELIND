# Parcours utilisateurs de référence

Dernière mise à jour : 2026-11-01. Chaque parcours précise son chemin nominal, ses branches d'erreur et ses règles serveur. Les parcours marqués **[lot 1]** sont implémentés et testés côté API (voir [PROGRESS.md](../PROGRESS.md)).

## F-01 Inscription [lot 1]
1. L'utilisateur saisit un téléphone (E.164) **ou** un e-mail, un mot de passe (≥ 10 caractères) et un nom affiché.
2. `POST /v1/auth/register` crée l'utilisateur en statut `pending_verification` et un défi OTP (6 chiffres, 10 min, 5 essais max). Le code est stocké **haché**.
3. Le code est remis par le canal configuré (en dev : outbox journalisée, **aucun SMS réel**).
4. `POST /v1/auth/otp/verify` active le compte et ouvre la première session (jetons d'accès + refresh).

Erreurs : identifiant déjà utilisé → réponse **identique** à un succès (anti-énumération), sans nouveau compte ; OTP invalide → 400 + essais restants ; OTP épuisé ou expiré → 410 ; trop de requêtes → 429.

## F-02 Connexion [lot 1]
`POST /v1/auth/login` (identifiant + mot de passe + infos appareil). Échecs → 401 générique. Après 5 échecs en 15 min, le compte est verrouillé 15 min (423), ce qui est journalisé. Un compte non vérifié reçoit 403 `account_not_verified`. Un compte suspendu reçoit 403 `account_suspended`.

## F-03 Rafraîchissement et détection de vol de jeton [lot 1]
`POST /v1/auth/refresh` : chaque refresh token est à usage unique (rotation). Réutiliser un refresh déjà consommé révoque **toute la famille de session** et journalise `refresh_token_reuse`.

## F-04 Sessions et déconnexion à distance [lot 1]
`GET /v1/auth/sessions` liste les sessions actives (appareil, plateforme, dernière activité, session courante). `DELETE /v1/auth/sessions/:id` révoque une session de l'utilisateur ; la session d'autrui → 404. `POST /v1/auth/logout` révoque la session courante.

## F-05 Mot de passe oublié [lot 1]
`POST /v1/auth/password/forgot` répond toujours 202 (anti-énumération). `POST /v1/auth/password/reset` (identifiant + code + nouveau mot de passe) révoque toutes les sessions.

## F-06 Publier (bouton +) — planifié
Le bouton + ouvre une feuille : Post · Story · Vidéo courte · Produit (si rôle vendeur dans l'org active) · Live (flag) · Annonce. Les médias sont téléversés par URL signée, puis la publication est créée avec sa visibilité. Brouillon conservé hors ligne.

## F-07 Conversation et message — planifié
Ouvrir ou créer une conversation directe (idempotent par paire). L'envoi est optimiste avec un `client_id` (dédoublonnage serveur). Les états envoyé, reçu et lu passent par WebSocket. Hors connexion, le message est mis en file locale et renvoyé.

## F-08 Achat multi-vendeurs — planifié
Panier → checkout → une commande parent et N sous-commandes vendeur → paiement **sandbox** (clé d'idempotence) → écritures ledger → notifications vendeur et acheteur → suivi.

## F-09 Paiement QR marchand (sandbox) — planifié
Scan → `qr/resolve` (signature serveur, marchand vérifié) → montant → PIN ou biométrie → `pay` idempotent → reçu.

## F-10 Connexion d'une mini-app — planifié
La mini-app appelle `caselind.login()`. Le conteneur obtient un code éphémère (5 min, usage unique), que le serveur de la mini-app échange contre un jeton limité aux scopes accordés. Ce modèle est inspiré du mécanisme public de `wx.login` (preuve S2), avec une conception CASELIND propre.
