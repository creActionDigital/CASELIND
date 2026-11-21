# Prompt de reprise CASELIND (2026-11-21) : à coller dans une nouvelle conversation

Reprends CASELIND (E:\CASELIND), en français. Lis d'abord ce fichier, puis docs/QA_ECRANS.md, puis la mémoire (C:\Users\HP\.claude\projects\E--CASELIND\memory\MEMORY.md : identité de marque, exigence QA). Les règles du propriétaire de docs/PROMPT_REPRISE_2026-11-20.md restent valables (commits en français par lot après tests verts, exclusions, blocages tiers, pièges Windows).

## État
- master, commits locaux NON POUSSÉS depuis origin/main (7f71ae7) : jusqu'à « QA écrans : rapport des 3 passes… » et le correctif qui suit. Demander l'accord explicite avant `git push origin master:main`.
- Tests observés verts : API 1239/1239, mobile 555/555, tsc api + mobile propres, sw 4704/4704. Fumée OK. Charge : 50 utilisateurs, 181 req/s, p95 136 ms (seuls refus : limiteur de recherche par IP, tous les utilisateurs simulés partageant localhost).
- Fait cette session : correctifs de sécurité 0088-0100 (+ migration 0103), restes connus, logo officiel et couleurs du logo (ADR-032), en-tête logo · notifications · wallet · panier · « ⋯ » + case de recherche, notifications qui s'ouvrent, retours fiables, cœurs favoris, ergonomie commerce/wallet, démo complète (hugo chauffeur et second admin, covoiturage, location, mini-app), QA 237 écrans × 3 passes, double validation vérifiée dans l'interface.
- Serveurs de test : `.claude/launch.json` → db, api-static (API compilée, sans rechargement : faire `npm run build -w @caselind/api` puis redémarrer), mobile-web. Robot : `scripts/qa/crawl-screens.mjs` (voir son en-tête ; relever les limites de débit dans apps/api/.env le temps du robot puis les remettre à 120/10).

## À faire
1. Décisions du propriétaire attendues : bouton central « + » = menu de création (publication, story, vidéo, live) ? installer expo-document-picker pour les fichiers dans la messagerie ?
2. Non vérifiés en interface : inscription avec OTP, acceptation d'une course par hugo, réservation de covoiturage, location, consentement réel d'une mini-app (données de démo prêtes).
3. Manques vs grandes applis (docs/QA_ECRANS.md, « Restes ») : PIN par OTP, photos dans les avis, facture, suivi de livraison sur carte, compteurs et grille du profil, destinataire par contact.
4. Relancer le robot complet après ces changements et mettre à jour le tableau de docs/QA_ECRANS.md.
