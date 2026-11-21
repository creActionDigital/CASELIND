# Module 18 : Publicité et monétisation (écran → route | statut | note)

Paiement en MODE TEST : débit du portefeuille de test par le grand livre (PIN, idempotence), vers le compte système `fees`. Aucun argent réel ; le point de bascule vers un prestataire est `apps/api/src/premium/pay.service.ts` (`charge`). Trading, CSL Coins et NFT : exclus.

| Écran | Route | Statut | Note |
|---|---|---|---|
| 1 Centre publicitaire | /ads | fait | liste, filtres, pause / reprise / arrêt |
| 2 Créer une campagne | /ads/new | fait | objectif, publication ou produit, PIN |
| 3 Audience | /ads/new | fait | pays appliqué ; ville, âge, intérêts enregistrés, non appliqués (pas de donnée) |
| 4 Budget | /ads/new | fait | total + quotidien, USD/CDF, clic facturé 0,10 USD |
| 5 Emplacements | /ads/new | fait | fil (injection serveur), marketplace et recherche (bandeau), vidéos (API prête) |
| 6 Aperçu | /ads/new | fait | mention « Sponsorisé » |
| 7 Gestion des campagnes | /ads, /admin/ads | fait | revue admin avant diffusion, remboursement au refus / à l'arrêt / à l'échéance |
| 8 Statistiques | /ads/[id] | fait | impressions, clics, dépense, par jour |
| 9 Facturation | /ads/billing | fait | débits et remboursements |
| 10 Premium | /premium | fait | mensuel/annuel, badge seul avantage, renouvellement auto désactivable, résiliation |
| 11 Forfaits pros | /premium/pro | fait | portefeuille de l'organisation si approvisionné, sinon propriétaire |
| 12 Historique des paiements | /premium/history | fait | reçus numérotés |
| Admin Publicités / Abonnements | /admin/ads, /admin/subscriptions | fait | prix des plans réglables, annulation |

Existant réutilisé : boosts créateur (`creator/boosts.service.ts`, `/admin/boosts`) restent un mécanisme à part (publication seule, 1 à 14 jours) ; les campagnes l'étendent (produit, audience, budgets, revue préalable). Commissions et ledger : inchangés.
