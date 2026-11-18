# QA écrans (vue web mobile 375x812, API locale) - 2026-11-16

Méthode : navigateur Playwright, comptes du seed (alice, bob), lecture du texte + captures. Sécurité non testée.
Limites : session web perdue après plusieurs rechargements complets (429 sur /auth/refresh) ; navigation faite en SPA.

| Lot | Écran | Résultat | Détail |
|---|---|---|---|
| 1 | Connexion, accueil, profil, sessions, langue, confidentialité, KYC, notifications | OK | Textes fr corrects, aucune clé brute, 375 px sans débordement. |
| 1 | Rechargement répété de la page | KO | 429 sur /v1/auth/refresh : l'app renvoie à la connexion au lieu de réessayer (api client, refresh). |
| 1 | Sessions | KO mineur | Toutes les sessions web s'appellent « Appareil inconnu » (sessions.tsx). |
| 1 | Langue > Kiswahili | OK partiel | Seules quelques clés sont traduites (accueil, Plus, Langue) ; le reste retombe en anglais. Aucune clé brute. |
| 2 | Messagerie : liste, conversation directe, groupe, menu, envoi | OK | Envoi, groupe, menu et infos fonctionnent. |
| 2 | Conversation : saisie dans le champ | KO | « Illegal invocation » (overlay d'erreur) à chaque frappe sur le web : `timers.set` appelé détaché de `setTimeout` (src/messaging/extras-logic.ts:80-94, debounce du brouillon). Passer `(f,ms)=>setTimeout(f,ms)`. |
| 3 | Fil, publication, commentaire, statuts, favoris, programmés | OK | Publier, commenter, voir un statut OK. |
| 3 | Hub (onglet central) > Vidéos | KO mineur | Titre « Aucune vidéo pour le moment » en gris foncé sur fond noir, quasi illisible (hub/*). |
| 4 | Boutique, produit, panier, commande, suivi | OK | Ajout panier, checkout (validation « requis »), commande créée avec code livraison. |
| 4 | Badge panier de l'en-tête | KO mineur | Affiche « Panier, 0 article(s) » après ajout au panier dans la même session SPA, puis « 1 » chez bob ; rafraîchissement non systématique. À vérifier. |
| 5 | Wallet, recharge test, envoi avec PIN, reçu, budget, cartes, gérer | OK | Solde mis à jour, bandeau « Mode test » partout. |
| 6 | Livraison (Mes livraisons, suivi acheteur) | OK | Écrans vides corrects ; parcours livreur non testé. |
| 7 | Services, offre, créneaux, réservation, Mes réservations | OK | Réservation créée, message de délai d'annulation cohérent. |
| 8 | Mobilité : estimation, commande, annulation, historique, lieux, contacts, chauffeur | OK | Estimation 3,3 km, annulation avec motif OK. Course acceptée par chauffeur non testée. |
| 9 | Assistant IA : liste, conversation, réglages | OK | Sans clé : « L'assistant est indisponible » (attendu). |
| 10 | Recherche | OK | « sac » trouve le produit ; onglets présents. |
| 11 | Plus : mini-apps (annuaire, autorisées, paiements) | OK (vide) | Annuaire vide : aucune app seedée, parcours OAuth/paiement non testé. |
| 12 | Annonces (liste, fiche, mes annonces, offres, visites, alertes, comparer) | OK | |
| 13 | Emploi, Freelance, Éducation (liste, fiche, mes cours, vérifier) | OK | Quiz et examen non parcourus. |
| 14 | Santé (consentement, dossier, rappels, RDV, partage) | OK | Ajout d'une entrée et d'un rappel OK. |
| 14 | /health/reminders | KO | Titre d'en-tête brut « health/reminders » (Stack.Screen sans title dans (app)/_layout.tsx). |
| 14 | /health/record, /rappels, /rendez-vous sans consentement | KO mineur | « Oups Accès refusé » au lieu d'une redirection vers l'écran de consentement. |
| 15 | École, frais, bourses, Gouvernance | OK | Après rebuild de l'API (build périmé : 404 sur /me/school/fees et /admin/users). |
| 16 | Vendeur (tableau de bord) | OK | Raccourcis présents ; sous-écrans non parcourus. |
| 17 | Plus : tuile Finance | KO mineur | Étiquetée « Bientôt » alors que /wallet/finance (Budget) fonctionne. |
| 18 | /live/preview (maquette) | KO | Défilement horizontal de 2 px (377 px) ; prix « 25 000,00 CDF » coupé à droite de la colonne produits. |
| 19 | Hub > Live : lancer, rejoindre (bob), chat, compteur, terminer | OK | Compteur 0 -> 1, message de bob reçu par alice, fin du live vue par l'hôte. Vidéo : non implémenté (indiqué à l'écran). |
| 19 | Salon de live terminé | KO mineur | Le texte « Le chat et le compteur sont en direct » reste affiché après la fin ; le chat reçoit des 409 en boucle (polling non arrêté). |
| 20 | Appel audio/vidéo alice -> bob : sonnerie, bandeau, répondre, refuser, raccrocher | OK | « Ça sonne… », bandeau « Appel entrant », « En communication », « Appel terminé / refusé » côté appelant aussi. Média : non implémenté (normal). |
| 20 | Bandeau d'appel entrant | KO mineur | N'a qu'un bouton « Répondre » (ni Refuser, ni nom de l'appelant) ; il ouvre l'écran d'appel où il faut re-appuyer sur Répondre (calllive/IncomingCall.tsx). |

## Environnement
- Le Metro lancé avant les commits d'appels ne voyait pas le dossier src/calllive (UnableToResolve) : redémarrage nécessaire (`expo start -c`).
- Le build API présent était périmé ; rebuild contracts + api nécessaire.

## Non testé
Caméra/QR, 2FA, KYC photo, transfert vers inconnu, livreur et chauffeur (acceptation), paiement mini-app OAuth, quiz/examen, comptes carla/david/emma/frank/gina/hugo (seulement vus comme contenu), caméra/upload photos.
