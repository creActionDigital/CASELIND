# QA écrans et parcours - 2026-11-21

Méthode :
- **Robot d'écrans** (`scripts/qa/crawl-screens.mjs`, rapport `scripts/qa/crawl-report.mjs`) : ouvre les 237 écrans de `apps/mobile/src/app/(app)` dans Expo web, connecté en alice (admin + vendeuse), en 3 passes : **fr / clair / 375 px**, **sw / sombre / 375 px**, **en / clair / 1280 px**. Il relève les erreurs JS, les réponses API ≥ 400 vues par la console, les écrans d'erreur, les clés i18n brutes et les débordements horizontaux, et prend une capture par écran (`qa-out/`, non versionné).
- **Parcours joués en cliquant** dans le navigateur (agents de QA, comptes de démo `scripts/seed-demo.mjs`) avec de vraies actions : achat, retour, wallet, caisse, mobilité, mini-apps, publications photo et vidéo, messages, groupes, préférences, sanctions et recours, notifications ouvertes une à une.
- Comparaison avec les écrans équivalents des grandes applis (Amazon, AliExpress, Instagram, WhatsApp, Uber) : boutons, liens et états manquants.
- Environnement : API compilée sans rechargement automatique (`api-static` dans `.claude/launch.json`), base de démo locale, limites de débit relevées dans `apps/api/.env` le temps des tests.

## Résultat du robot (avant les dernières corrections)

- fr / clair / 375 : 194 OK, 22 à voir, 21 non ouverts (écran à identifiant non résolu : couvert par les parcours).
- sw / sombre / 375 : 193 OK, 23 à voir, 21 non ouverts.
- en / clair / 1280 : 193 OK, 23 à voir, 21 non ouverts.

Les « à voir » se répartissent ainsi :

| Constat | Écrans | Verdict |
|---|---|---|
| Chargement sans fin sur une erreur 404/403 (React Query réessayait une 4xx) | réservation, disponibilités, fichiers produit, etc. | **Corrigé** : jamais de nouvel essai sur une 4xx, message d'erreur immédiat (`shouldRetry`). |
| Débordement horizontal 382 à 475 px | /live/preview (fr et sw) | **Corrigé** : champ de commentaire du live (`minWidth: 0`) et onglets du hub compressibles. |
| `play()` refusé par le navigateur | /hub | **Corrigé** : vidéo muette au démarrage sur le web + bouton son ; vidéo plein écran (elle restait à 320×240). |
| 404 en console | réservation de bob, cours de david, école de frank, écrans prestataire/chauffeur, mini-app non autorisée, avis sans produit | **Attendu** : le robot est alice, qui n'a pas accès à ces ressources ; l'écran affiche « Élément introuvable » (vérifié). |
| « Clés brutes » | admin audit, drapeaux, réglages, mini-apps | **Attendu** : identifiants techniques montrés à l'administrateur (codes d'action, clés de réglage, scopes). |
| Écran d'erreur | /messages en 1280 | **Faux positif** : capture vérifiée, liste correcte. |
| 401 ponctuel | /admin/disputes (1 passe) | Session de test expirée pendant la passe, non reproduit. |

## Défauts trouvés en parcours et corrigés (commits f68bd2a, eeae667 et suivant)

- Notifications : le tap n'ouvrait rien pour la plupart des catégories → chaque notification ouvre son écran, sinon une fiche de détail ; idem pour les notifications push.
- Retour : pas de flèche sans historique (lien, notification, rechargement, premier écran vendeur), et flèche masquée après navigation interne → flèche toujours présente, retour vers l'écran parent sinon.
- Produits : pas de cœur « souhaits » sur les cartes → ajouté. Panier sans « Supprimer » ni « Continuer mes achats » → ajoutés. « Laisser un avis » proposé pour un produit déjà noté → statut venu du serveur.
- Avis sans confirmation ; partage muet sur le web ; « Gratuit » affiché avant le choix de zone ; « En attente de livreur » sur une commande livrée ; « Racheter » absent → corrigés.
- Wallet : PIN demandé avant de vérifier le solde de la tirelire ; pas de « PIN oublié ? » ; reçu non partageable ; dates à taper à la main → corrigés (raccourcis de date).
- Profil public ouvert par identifiant : 400 → accepté.
- Alerte « Nouvelle connexion other » à chaque connexion → seulement pour un nouvel appareil, texte en français.
- Divers : « Vous a créé le groupe », audience « all » brute, échéance à 02:00, interrupteurs non lisibles par lecteur d'écran, titres bruts (« health/index », « miniapps/consent »), cul-de-sac « créez d'abord une organisation », bouton imbriqué dans un bouton (candidatures).

## Parcours

| Parcours | Résultat |
|---|---|
| Boutique → panier → paiement à la livraison → suivi → livraison → retour → remboursé « hors plateforme » | OK |
| Wallet : recharge test, PIN, envoi, reçu, demande, partage de note, virement programmé, tirelire, alertes | OK |
| Caisse : vente, rejeu idempotent, stock, annulation (API) | OK |
| Course : estimation, commande, annulation ; notification de course | OK (acceptation par un chauffeur : non vérifiée, chauffeur de démo ajouté depuis) |
| Dépannage : demande, annulation | OK |
| Covoiturage, location | Non vérifiés en interface (données de démo ajoutées depuis : trajet de hugo, véhicule de location) |
| Mini-apps : création développeur, annuaire, consentement | Création OK ; consentement réel non vérifié (mini-app publiée ajoutée à la démo) |
| Publications photo et vidéo, commentaire, messages texte et photo, groupe | OK |
| Sanction → mes sanctions → recours → décision | OK ; double validation à 2 admins non testée en interface (désactivée hors production) |
| Inscription avec code OTP | Non vérifiée (code dans le journal de l'API, non lu) |

## Restes et manques connus (vs grandes applis)

- Bloqués ou à décider par le propriétaire : pièces jointes de fichiers et messages vocaux dans la messagerie, menu de création sur le bouton central « + » (aujourd'hui le fil Vidéos).
- Fonctions : réinitialisation du PIN par OTP (aujourd'hui par mot de passe), photos dans les avis, facture et suivi de livraison sur carte, compteurs et grille de publications sur le profil, recherche de destinataire par contact, cartes virtuelles (« bientôt »).
- Une notification « Santé » ou « École » ouvre un écran désactivé si le module réglementé est coupé (comportement attendu, message clair).

## Tableau écran → résultat (robot, 3 passes)

| Écran | fr-light-375 | sw-dark-375 | en-light-1280 |
|---|---|---|---|
| (tabs)/hub | OK | KO : console: pageerror: play() failed because the user didn't interact with the document first | KO : console: pageerror: play() failed because the user didn't interact with the document first |
| (tabs)/index | OK | OK | OK |
| (tabs)/maps | OK | OK | OK |
| (tabs)/messages | OK | OK | KO : écran d'erreur |
| (tabs)/more | OK | OK | OK |
| admin/ai | OK | OK | OK |
| admin/analytics | OK | OK | OK |
| admin/announcements | OK | OK | OK |
| admin/appeals | OK | OK | OK |
| admin/approvals | OK | OK | OK |
| admin/audit | KO : clés brutes: moderation.action, auth.login, user.profile_updated, miniapp.authorized, mini | KO : clés brutes: moderation.action, auth.login, user.profile_updated | KO : clés brutes: moderation.action, auth.login, user.profile_updated |
| admin/boosts | OK | OK | OK |
| admin/commissions | OK | OK | OK |
| admin/disputes | KO : renvoyé à la connexion | OK | OK |
| admin/flags | OK | KO : clés brutes: gifts.red_packets, health.prescriptions, health.teleconsultation, social.stor | KO : clés brutes: gifts.red_packets, health.prescriptions, health.teleconsultation, social.stor |
| admin/games | OK | OK | OK |
| admin/governance | OK | OK | OK |
| admin/health | OK | OK | OK |
| admin/index | OK | OK | OK |
| admin/kyc | OK | OK | OK |
| admin/ledger | OK | OK | OK |
| admin/miniapp-versions | OK | OK | OK |
| admin/miniapps | KO : clés brutes: profile.basic | KO : clés brutes: profile.basic | KO : clés brutes: profile.basic |
| admin/mobility | OK | OK | OK |
| admin/moderation | OK | OK | OK |
| admin/sanctions | OK | OK | OK |
| admin/settings | KO : clés brutes: support.contact, currencies.enabled, cities.pilot, commission.defaultBps, lim | KO : clés brutes: support.contact, currencies.enabled, cities.pilot, commission.defaultBps, lim | KO : clés brutes: support.contact, currencies.enabled, cities.pilot, commission.defaultBps, lim |
| admin/wallet-alerts | OK | OK | OK |
| ai/[id] | param. | param. | param. |
| ai/index | OK | OK | OK |
| ai/settings | OK | OK | OK |
| announcements | OK | OK | OK |
| bookings/[id] | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| bookings/index | OK | OK | OK |
| bookmarks | OK | OK | OK |
| calls/[id] | param. | param. | param. |
| carpool/[id] | param. | param. | param. |
| carpool/index | OK | OK | OK |
| carpool/mine | OK | OK | OK |
| carpool/new | OK | OK | OK |
| cart | OK | OK | OK |
| chat-info/[conversationId] | OK | OK | OK |
| checkout | OK | OK | OK |
| compose | OK | OK | OK |
| consents | OK | OK | OK |
| courier/[id] | param. | param. | param. |
| courier/available | OK | OK | OK |
| courier/index | OK | OK | OK |
| courier/route | OK | OK | OK |
| creator | OK | OK | OK |
| deliveries/[deliveryId] | param. | param. | param. |
| deliveries/index | OK | OK | OK |
| downloads | OK | OK | OK |
| education/[id] | OK | OK | OK |
| education/edit/[id] | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| education/exam/[id] | param. | param. | param. |
| education/index | OK | OK | OK |
| education/mine | OK | OK | OK |
| education/new | OK | OK | OK |
| education/quiz/[id] | param. | param. | param. |
| education/verify | OK | OK | OK |
| favorites | OK | OK | OK |
| freelance/[id] | OK | OK | OK |
| freelance/contract/[id] | OK | OK | OK |
| freelance/disputes | OK | OK | OK |
| freelance/freelancers | OK | OK | OK |
| freelance/index | OK | OK | OK |
| freelance/mine | OK | OK | OK |
| freelance/new | OK | OK | OK |
| freelance/profile | OK | OK | OK |
| games/index | OK | OK | OK |
| games/play | OK | OK | OK |
| group/[conversationId] | OK | OK | OK |
| hashtag/[tag] | OK | OK | OK |
| health/appointments | OK | OK | OK |
| health/availability | OK | OK | OK |
| health/book | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| health/index | OK | OK | OK |
| health/patient/[id] | param. | param. | param. |
| health/pro | OK | OK | OK |
| health/professionals | OK | OK | OK |
| health/record | OK | OK | OK |
| health/reminders | OK | OK | OK |
| health/results | OK | OK | OK |
| health/sharing | OK | OK | OK |
| jobs/[id] | OK | OK | OK |
| jobs/alerts | OK | OK | OK |
| jobs/applications | OK | OK | OK |
| jobs/cv | OK | OK | OK |
| jobs/index | OK | OK | OK |
| jobs/interviews | OK | OK | OK |
| kyc | OK | OK | OK |
| language | OK | OK | OK |
| listings/[id] | OK | OK | OK |
| listings/alerts | OK | OK | OK |
| listings/compare | OK | OK | OK |
| listings/index | OK | OK | OK |
| listings/mine | OK | OK | OK |
| listings/new | OK | OK | OK |
| listings/offers | OK | OK | OK |
| listings/visits | OK | OK | OK |
| live/preview | KO : débordement 382>375 | KO : débordement 475>375 | OK |
| lives/[id] | param. | param. | param. |
| loyalty | OK | OK | OK |
| messages/[conversationId] | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| miniapps/activity/[appId] | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| miniapps/consent | OK | OK | OK |
| miniapps/developer/[id] | param. | param. | param. |
| miniapps/developer/index | OK | OK | OK |
| miniapps/developer/manifest/[id] | param. | param. | param. |
| miniapps/developer/new | OK | OK | OK |
| miniapps/developer/revenue/[id] | param. | param. | param. |
| miniapps/developer/webhook/[id] | param. | param. | param. |
| miniapps/index | OK | OK | OK |
| my-data | OK | OK | OK |
| my-reports | OK | OK | OK |
| my-sanctions | OK | OK | OK |
| notification-preferences | OK | OK | OK |
| notifications | OK | OK | OK |
| orders/[orderId] | param. | param. | param. |
| orders/index | OK | OK | OK |
| pay | OK | OK | OK |
| post/[postId] | OK | OK | OK |
| privacy | OK | OK | OK |
| product/[productId] | OK | OK | OK |
| product/compare | OK | OK | OK |
| profile | OK | OK | OK |
| provider/[scope]/availability | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| provider/[scope]/index | OK | OK | OK |
| provider/[scope]/offer/[id] | param. | param. | param. |
| provider/[scope]/requests | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| provider/[scope]/reviews | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| rentals/[id] | param. | param. | param. |
| rentals/index | OK | OK | OK |
| rentals/mine | OK | OK | OK |
| review/new | KO : écran d'erreur | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| rides/[rideId] | OK | OK | OK |
| rides/contacts | OK | OK | OK |
| rides/driver | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| rides/history | OK | OK | OK |
| rides/index | OK | OK | OK |
| rides/places | OK | OK | OK |
| roadside/available | OK | OK | OK |
| roadside/index | OK | OK | OK |
| scan | OK | OK | OK |
| scheduled | OK | OK | OK |
| school/[classId] | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| school/children | OK | OK | OK |
| school/fees | OK | OK | OK |
| school/index | OK | OK | OK |
| school/scholarships/[id] | param. | param. | param. |
| school/scholarships/index | OK | OK | OK |
| school/search | OK | OK | OK |
| search | OK | OK | OK |
| security/2fa | OK | OK | OK |
| security/identifier | OK | OK | OK |
| security/qr-approve | OK | OK | OK |
| seller/[orgId]/batches | OK | OK | OK |
| seller/[orgId]/campaigns | OK | OK | OK |
| seller/[orgId]/commissions | OK | OK | OK |
| seller/[orgId]/coupons/index | OK | OK | OK |
| seller/[orgId]/coupons/new | OK | OK | OK |
| seller/[orgId]/customers | OK | OK | OK |
| seller/[orgId]/documents/[id] | param. | param. | param. |
| seller/[orgId]/documents/index | OK | OK | OK |
| seller/[orgId]/documents/new | OK | OK | OK |
| seller/[orgId]/expenses | OK | OK | OK |
| seller/[orgId]/hr/index | OK | OK | OK |
| seller/[orgId]/hr/leave | OK | OK | OK |
| seller/[orgId]/hr/salary | OK | OK | OK |
| seller/[orgId]/hr/schedule | OK | OK | OK |
| seller/[orgId]/index | OK | OK | OK |
| seller/[orgId]/inventory | OK | OK | OK |
| seller/[orgId]/jobs/[jobId] | OK | OK | OK |
| seller/[orgId]/jobs/index | OK | OK | OK |
| seller/[orgId]/jobs/new | OK | OK | OK |
| seller/[orgId]/location | OK | OK | OK |
| seller/[orgId]/loyalty | OK | OK | OK |
| seller/[orgId]/orders/[orderId] | param. | param. | param. |
| seller/[orgId]/orders/index | OK | OK | OK |
| seller/[orgId]/pos | OK | OK | OK |
| seller/[orgId]/product-files | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| seller/[orgId]/products/[productId] | OK | OK | OK |
| seller/[orgId]/products/index | OK | OK | OK |
| seller/[orgId]/profitability | OK | OK | OK |
| seller/[orgId]/promotions | OK | OK | OK |
| seller/[orgId]/purchasing/[poId] | param. | param. | param. |
| seller/[orgId]/purchasing/index | OK | OK | OK |
| seller/[orgId]/purchasing/new | OK | OK | OK |
| seller/[orgId]/qr | OK | OK | OK |
| seller/[orgId]/questions | OK | OK | OK |
| seller/[orgId]/rentals | OK | OK | OK |
| seller/[orgId]/returns | OK | OK | OK |
| seller/[orgId]/reviews | OK | OK | OK |
| seller/[orgId]/sales | OK | OK | OK |
| seller/[orgId]/school/[classId] | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| seller/[orgId]/school/fees/[classId] | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| seller/[orgId]/school/guardians | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) /  | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) /  | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) /  |
| seller/[orgId]/school/index | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| seller/[orgId]/school/scholarships | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) | KO : console: Failed to load resource: the server responded with a status of 404 (Not Found) |
| seller/[orgId]/services | OK | OK | OK |
| seller/[orgId]/stock | OK | OK | OK |
| seller/[orgId]/updates | OK | OK | OK |
| seller/[orgId]/vitrine | OK | OK | OK |
| seller/[orgId]/wallet | OK | OK | OK |
| seller/[orgId]/webhooks | OK | OK | OK |
| seller/[orgId]/zones/[zoneId] | param. | param. | param. |
| seller/[orgId]/zones/index | OK | OK | OK |
| seller/index | OK | OK | OK |
| seller/new | OK | OK | OK |
| services/[id] | OK | OK | OK |
| services/index | OK | OK | OK |
| sessions | OK | OK | OK |
| shop | OK | OK | OK |
| store/[slug] | OK | OK | OK |
| story/[userId] | OK | OK | OK |
| story/new | OK | OK | OK |
| u/[handle] | OK | OK | OK |
| user/[userId]/followers | OK | OK | OK |
| user/[userId]/following | OK | OK | OK |
| user/[userId]/index | OK | OK | OK |
| wallet | OK | OK | OK |
| wallet/alerts | OK | OK | OK |
| wallet/cards | OK | OK | OK |
| wallet/finance | OK | OK | OK |
| wallet/manage | OK | OK | OK |
| wallet/pin | OK | OK | OK |
| wallet/receive | OK | OK | OK |
| wallet/requests | OK | OK | OK |
| wallet/savings | OK | OK | OK |
| wallet/scheduled | OK | OK | OK |
| wallet/send | OK | OK | OK |
| wallet/split | OK | OK | OK |
| wallet/topup | OK | OK | OK |
| wishlist | OK | OK | OK |
| work | OK | OK | OK |
| restricted | OK | OK | OK |

## Historique

La QA précédente (2026-11-16, vue 375 px, avant les lots 0071-0100) est dans l'historique git de ce fichier.
