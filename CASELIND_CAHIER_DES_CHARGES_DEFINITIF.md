# CASELIND — Cahier des charges fonctionnel et technique complet

**Version :** 1.0 — document maître de référence pour Claude Code

**Nom officiel : CASELIND**

> Document consolidé à partir des exigences et directions évoquées. Il est volontairement complet : les fonctions reportées restent dans le backlog et ne sont pas supprimées. Les sources SaaS achetées doivent être inventoriées sur les fichiers réellement disponibles ; leur contenu n’est pas présumé.

## 0. Statut, objectif et règles de lecture

Document maître de référence pour concevoir, développer, tester et faire évoluer CASELIND. Il rassemble la vision produit, les fonctionnalités évoquées, les contraintes d’architecture, la stratégie de réutilisation de sources SaaS achetées, les exigences de sécurité, les étapes de livraison et les critères d’acceptation.

Règle de conservation : ce cahier des charges est additif. Une fonctionnalité ne doit pas être supprimée parce qu’elle n’est pas prévue dans la première version. Les fonctionnalités hors périmètre d’une phase doivent être consignées dans le backlog correspondant, avec leur dépendances et leur statut, et non oubliées.

Nom officiel et unique : CASELIND. Ne pas employer Marché+, MarchéPlus ou Casalind comme nom du produit. Les anciens noms sont uniquement des références historiques.

La vision est très large. Cela ne signifie pas que tout doit être livré d’un seul coup. Le produit doit être construit progressivement, par modules cohérents, avec une architecture extensible et des frontières de sécurité explicites.

Ce document définit une cible fonctionnelle et technique. Il ne prétend pas que toutes les fonctions sont déjà implémentées, ni que les sources SaaS achetées sont connues. Claude Code doit inspecter les fichiers réellement disponibles avant de décider ce qui est réutilisable.

## 1. Vision générale de CASELIND

CASELIND est une super-application et un écosystème numérique multi-services destiné aux particuliers, commerçants, entreprises, prestataires, créateurs, livreurs, établissements, partenaires et administrateurs. Elle doit combiner commerce, réseau social, communication, outils professionnels, services locaux, mobilité, livraison, éducation, santé, finances, divertissement et mini-applications dans une expérience cohérente.

Principes structurants : un compte utilisateur commun lorsque c’est pertinent ; identité et permissions centralisées ; navigation et design cohérents ; notifications centralisées ; recherche transversale ; services interconnectés par des API ; intégration progressive des paiements ; personnalisation selon le rôle et le pays ; architecture modulaire ; protection forte des données ; possibilité d’étendre la plateforme à plusieurs pays, langues, devises et catégories de services.

CASELIND doit être utilisable sur le Web responsive, comme PWA et à terme sur Android/iOS. L’expérience doit être moderne, premium, rapide, accessible, adaptée aux connexions et appareils modestes, avec prise en charge du mode clair/sombre et du fonctionnement hors ligne lorsque cela est techniquement raisonnable.

## 2. Principes de développement et méthode Claude Code

Outil principal de développement prévu : Claude Code, travaillant sur le dépôt local depuis l’environnement de développement de l’utilisateur. Le travail doit être conduit par étapes explicites et vérifiables, avec analyse du dépôt, modifications ciblées, tests et compte rendu.

Principe essentiel : ne pas coder systématiquement une fonctionnalité de zéro. L’utilisateur possède des codes sources de plusieurs SaaS achetés en ligne, chacun pouvant fournir certaines fonctionnalités. Claude Code doit d’abord recenser ces sources, comprendre leur licence, leur technologie, leurs dépendances, leur architecture, leurs modules et leur qualité, puis repérer le code réutilisable.

Pour chaque besoin, Claude Code doit rechercher dans l’inventaire si une implémentation utile existe déjà. Trois décisions sont possibles : réutiliser presque directement ; adapter et intégrer ; développer uniquement ce qui manque ou remplacer un code inutilisable/risqué.

Ne jamais copier aveuglément un SaaS entier dans CASELIND. Extraire les composants et la logique utiles, comprendre les modèles de données et les dépendances, supprimer ou isoler les fonctions inutiles, unifier l’interface et les conventions, préserver les droits de licence, contrôler les vulnérabilités et tester les interactions avec les modules existants.

Objectifs : accélérer la livraison, améliorer la qualité, réduire les tokens, les coûts et les réécritures inutiles. L’économie de tokens ne doit jamais primer sur la sécurité, la conformité, l’intégrité des données ou les tests.

Avant toute modification : examiner l’état réel du dépôt, la branche Git, les scripts, les fichiers de configuration, le système de build, les tests et les modifications non commitées. Ne pas écraser ou supprimer des travaux existants sans accord. Ne pas refondre une interface ou une architecture sans besoin démontré.

Pour chaque tâche : 1) décrire l’objectif et les critères d’acceptation ; 2) analyser l’existant et les sources SaaS ; 3) proposer le plan minimal ; 4) modifier par petits lots ; 5) lancer les tests pertinents ; 6) signaler les fichiers modifiés, les commandes exécutées, les résultats, les risques et les étapes manuelles restantes.

Garder une documentation vivante : README, architecture, inventaire des sources SaaS, décisions techniques (ADR), variables d’environnement requises sans secrets, schéma de données, API, permissions, procédures de test, déploiement, sauvegarde et reprise après incident.

## 3. Inventaire obligatoire des sources SaaS achetées

Créer un registre des projets achetés, sans présumer de leur contenu. Pour chaque source, consigner : nom, chemin local, version/date, éditeur, preuve d’achat si disponible, licence et droits de redistribution/modification, framework/langage, runtime, base de données, authentification, services tiers, dépendances, modules fonctionnels, qualité des tests, vulnérabilités connues, état de maintenance, effort d’intégration, risques et décision.

Créer une matrice Fonctionnalité CASELIND → sources candidates → composants réutilisables → adaptations nécessaires → dépendances → tests → décision. Une source peut couvrir plusieurs besoins et un besoin peut nécessiter plusieurs sources.

Avant l’intégration, inspecter package manifests, lockfiles, scripts, fichiers d’environnement d’exemple, migrations, schémas, API, composants UI, tests et documentation. Rechercher les secrets accidentellement inclus, les clés/API tokens, les appels réseau inattendus, les dépendances obsolètes et les licences incompatibles.

Ne jamais commiter de secrets. Ajouter un .env.example sans valeurs confidentielles, documenter les secrets nécessaires et utiliser les gestionnaires de secrets de l’environnement cible. Les secrets exposés dans les sources doivent être révoqués/remplacés.

Le registre doit distinguer le code réutilisable du produit SaaS complet, des services payants externes, des éléments soumis à licence commerciale, des composants open source et des dépendances impossibles à redistribuer.

Aucune source achetée n’est supposée exister dans un dossier précis tant que Claude Code ne l’a pas vérifié. Si la source n’est pas présente ou si la licence est ambiguë, documenter le blocage au lieu d’inventer ou de contourner les conditions.

## 4. Utilisateurs, identité et accès

Types de profils : utilisateur personnel, acheteur, vendeur/commerçant, entreprise, employé, livreur/coursier, prestataire, créateur/influenceur, établissement (école, hôpital, hôtel, restaurant, etc.), administrateur et partenaires. Un même compte peut posséder plusieurs espaces ou rôles lorsque les règles métier le permettent.

Inscription et connexion par téléphone, e-mail et fournisseurs sociaux pertinents (Google, Apple, Facebook, selon disponibilité). Prévoir OTP par SMS/e-mail et éventuellement WhatsApp via fournisseur autorisé ; récupération de compte ; changement de téléphone/e-mail ; gestion des appareils et sessions ; journal de sécurité ; déconnexion à distance ; 2FA et biométrie sur les plateformes compatibles.

Prévoir un SSO interne : une authentification commune pour les modules CASELIND, sans que chaque mini-application gère séparément le compte principal. Les applications et intégrations ne reçoivent que les autorisations nécessaires.

KYC/validation d’identité avec étapes adaptées au risque, statuts de vérification, documents et revue humaine si nécessaire. Le KYC doit rester un emplacement fonctionnel configurable tant que les partenaires, obligations locales et règles de conservation ne sont pas définis.

RBAC/permissions granulaires : propriétaire, administrateur d’entreprise, manager, finance, stock, ventes, RH, support, livreur, employé et autres rôles. Les permissions doivent être contrôlées côté serveur, pas seulement masquées dans l’interface.

Fonctions de compte : blocage, signalement, suspension, réactivation, multi-profils/multi-boutiques, préférences linguistiques, confidentialité, consentements, gestion des données, export et suppression conformément aux obligations légales.

## 5. Profils, pages publiques et vitrines professionnelles

Chaque utilisateur dispose d’un profil ; chaque commerce ou organisation peut disposer d’une page publique personnalisable, qui agit comme une vitrine numérique ou mini-site web, et pas uniquement comme un catalogue de produits.

La page professionnelle peut contenir : nom, logo, bannière, identité de marque, description, catégories, produits/services, tarifs, galerie photo/vidéo, coordonnées, localisation, horaires, zones desservies, avis, notes, questions/réponses, promotions, événements, publications, liens, conditions, boutons de contact et de commande, sections personnalisées et informations de vérification.

Les pages publiques doivent être indexables par les moteurs de recherche lorsque le propriétaire l’autorise ; métadonnées, URLs propres, partage social, images optimisées, sitemap et SEO technique. Protéger les informations privées et empêcher la publication accidentelle de données internes.

URLs envisagées : casalind.com/@nom ou domaine CASELIND équivalent et sous-domaines de type nom-entreprise.casalind.com ; connexion possible d’un domaine personnalisé acheté par le propriétaire, sous réserve de validation DNS, disponibilité technique, sécurité, certificats TLS et règles commerciales.

Le commerçant peut administrer sa vitrine, ses produits, ses services, ses horaires, ses publications, ses commandes, ses employés et ses statistiques depuis CASELIND, avec un niveau d’accès distinct de l’administration globale.

## 6. Réseau social et communication

Publications texte, images, vidéos, liens et contenus professionnels ; réactions/likes, commentaires, partages, abonnements, favoris, publications sponsorisées, signalement, modération et statistiques de portée.

Stories temporaires, par défaut sur une durée configurable autour de 24 heures ; flux de vidéos courtes inspiré des usages de plateformes vidéo ; fil personnalisé ; suivi des boutiques/personnes ; groupes, communautés, salons et événements.

Messagerie privée et de groupe : présence en ligne, états envoyé/reçu/lu, notifications, pièces jointes, photos/vidéos/fichiers, compression, messages vocaux, réactions, mentions, transfert, brouillons, recherche, messages éphémères et envoi programmé si approprié.

Appels audio/vidéo via technologie adaptée (ex. WebRTC) lorsque disponible ; salons audio/live ; sondages ; partage de médias ; contacts par numéro, nom d’utilisateur ou QR code ; invitations et blocage.

Traduction instantanée des messages et contenus selon les langues activées, avec indication claire de traduction automatique et possibilité de consulter l’original. Ne pas envoyer des messages privés à un fournisseur tiers sans information, base légale et contrôles appropriés.

Conversation commerciale : questions sur un produit, négociation, devis, commande, paiement, suivi de livraison et service après-vente dans le fil de discussion, sans compromettre la confidentialité ni contourner les règles de paiement.

Outils créateurs/influenceurs : profils créateurs, communautés de fans, abonnements ou contenus payants si légaux, dons/pourboires, monétisation, statistiques et règles de modération.

## 7. Commerce, marketplace et catalogue

Marketplace multi-vendeurs pour biens physiques, produits numériques, prestations et offres locales. Recherche transversale, catégories, filtres, tri, comparaison de prix, recommandations, pages produit, photos, vidéos, avis, questions/réponses et vérification des vendeurs.

Fiche produit/service : nom, description, médias, prix, devise, variantes, stock/disponibilité, localisation, livraison/retrait, vendeur, conditions, promotions et attributs spécifiques à la catégorie.

Panier, liste de souhaits, commande, paiement, facture/reçu, suivi, annulation, retour, remboursement, litige et historique. Prévoir plusieurs vendeurs dans le même parcours avec calcul transparent des frais et commandes sous-jacentes séparées si nécessaire.

Coupons, promotions, ventes flash, offres sponsorisées, annonces payantes, fidélité/cashback, recommandations, produits récurrents, ventes entre particuliers, prix négociables et enchères si la catégorie et le droit applicable le permettent.

Catalogue et services numériques : modèles, créations graphiques, ressources téléchargeables, cours, logiciels ou autres produits digitaux avec contrôle d’accès, livraison numérique, politique de remboursement et gestion des droits.

Outils vendeur : gestion de catalogue, stock, commandes, retours, prix, promotions, expédition, messages clients, avis, ventes, revenus, commissions, remboursements, exports et indicateurs de performance.

Modération des annonces, détection de fraude, faux avis, produits interdits et vendeurs abusifs ; signalement ; procédures de contestation ; historique d’actions ; règles par pays/catégorie.

## 8. Gestion d’entreprise et modules métiers

Fournir aux entreprises des espaces de gestion adaptés à leur activité : boutique, hôtel, restaurant, pharmacie, hôpital, école, quincaillerie, prestataire, entrepôt, etc. La structure doit être configurable et ne pas coder en dur une seule catégorie d’entreprise.

Fonctions transversales possibles : tableau de bord, ventes, achats, stock, fournisseurs, clients/CRM, devis, factures, dépenses, caisse, finance, rapports, personnel, horaires, permissions, notifications, documents, audit, promotions, site web, paramètres et exports.

Gestion d’inventaire : articles, variantes, unités, lots, dates d’expiration lorsque pertinentes, mouvements, seuils, transferts, inventaires physiques, fournisseurs, commandes d’achat, matières premières et traçabilité.

Gestion financière métier : recettes, dépenses, coûts, marges, factures, paiements, remboursements, rapprochement, caisse et rapports. Les données comptables et les opérations sensibles doivent disposer d’une piste d’audit et de droits séparés.

RH : employés, postes, rôles, permissions, présence/plannings si requis, congés, rémunération selon cadre légal, documents, évaluations et historiques d’accès.

Les tableaux de bord doivent conserver la cohérence de navigation et de design ; une demande ciblée ne doit pas entraîner une refonte arbitraire ni la suppression de menus ou fonctions existants.

## 9. Livraison, logistique et gestion des commandes

Livraison de repas, courses, produits essentiels, colis et documents ; livraison express, le jour même ou programmée ; coursiers à la demande ; retrait en magasin ; livraison multi-étapes et, si utile, optimisation de tournée.

Suivi GPS lorsqu’autorisé, estimation de délai/coût, statuts de commande, notifications, preuve de livraison par code, photo ou signature, gestion des retours, incidents, remboursements, réaffectation et évaluation du livreur.

Outils de dispatch : affectation de livreurs, disponibilité, zones, tarification, capacité, flotte, historique, performance et assistance. Gestion d’entrepôts et niveaux de stock selon la maturité du module.

Livraisons internationales : informations douanières, restrictions, frais et documents selon pays et prestataires ; ne pas simuler une intégration réelle sans partenaire.

## 10. Mobilité et transport

Mobilité : taxi/VTC, moto-taxi, covoiturage, trajets planifiés, trajets à étapes, location de voitures/motos/vélos/trottinettes, transport d’entreprise, dépannage/remorquage et partage du trajet.

Réservation de bus, train, bateau ou avion lorsque des fournisseurs/partenaires sont disponibles ; réservation d’hôtels et de locations ; itinéraires, ETA, géolocalisation, partage de position, paiement et historique.

Services cartographiques : itinéraires, zones, points d’intérêt, parking, stations-service et recharge de véhicules électriques selon disponibilité des données.

Paiements et réservations de transport nécessitent disponibilité en temps réel des opérateurs ; afficher clairement les informations non vérifiées et gérer annulations, retards et remboursements.

## 11. Services de proximité et réservation

Référencement et réservation de plombiers, électriciens, menuisiers, peintres, nettoyage, beauté/spa, réparation de téléphones/ordinateurs/appareils, tutorat, garde d’enfants, aide ménagère, déménagement, jardinage, photo/vidéo, traduction, rédaction, design, développement et autres prestations.

Profils prestataires : compétences, portfolio, zone de service, tarifs, disponibilités, devis, réservation, paiement, suivi, notes/avis, vérification et signalement.

Prise en charge des urgences de service lorsque les prestataires et les conditions locales le permettent ; ne pas présenter un service comme urgent ou garanti sans couverture réelle.

## 12. Santé et bien-être

Recherche de médecins, dentistes, laboratoires et professionnels ; rendez-vous, téléconsultation, dossier médical personnel, ordonnances électroniques lorsque légalement permises, livraison de médicaments par partenaires autorisés, rappels de prise, réservations d’examens et résultats.

Informations de santé, suivi de symptômes, assurance santé et contact avec pharmacien/professionnel via services autorisés. Afficher des limites claires et ne pas substituer l’assistant IA à un professionnel.

Données de santé = données hautement sensibles : accès strictement contrôlé, chiffrement, consentement explicite, journalisation, minimisation, durée de conservation, suppression/export selon loi, séparation des espaces et conformité du pays.

Les prescriptions, ventes de médicaments, téléconsultations et traitements de données médicales doivent être activés uniquement avec les licences, professionnels et partenaires requis.

## 13. Éducation et établissements

Cours en ligne, tutorat en direct, bibliothèque de ressources, quiz, examens blancs, certificats/badges, suivi d’apprentissage et profils enseignants/apprenants.

Pour écoles et universités : recherche d’établissements, emplois du temps, communication école-parents, gestion de cours/élèves selon permissions, paiements de frais scolaires, ressources, bourses et opportunités.

Protéger les données des mineurs, limiter la visibilité publique et appliquer des contrôles d’accès, consentements parentaux et obligations locales.

## 14. Emploi, freelance et opportunités

Offres d’emploi, CV/portfolio, candidatures, suivi de candidature, recrutement, entretiens vidéo et notifications.

Missions freelance et petits services : publication, devis, contrat, jalons, paiement, livraison, évaluation, résolution de litiges et prévention de fraude.

Outils professionnels pour entreprises : création d’activité selon les règles locales, devis/factures/contrats, CRM, gestion de stock/caisse, marketing, flyers, publications, campagnes, fidélité et analyse de ventes.

## 15. Immobilier, véhicules et petites annonces

Annonces immobilières de location/vente/colocation, photos, vidéos, visites virtuelles, géolocalisation, rendez-vous de visite, contacts et signalement.

Annonces de véhicules et biens d’occasion, fiches détaillées, vérification, comparaison, négociation et sécurité des échanges.

Objets perdus/trouvés et annonces locales avec règles de confidentialité et prévention des arnaques.

## 16. Administration publique, vie quotidienne et alertes

Répertoire de services publics et municipaux, rendez-vous administratifs, informations sur taxes/amendes, documents et actes civils lorsque les intégrations officielles existent.

Alertes météo, sécurité, élections, catastrophes et incidents ; numéros d’urgence ; signalement de problèmes urbains (routes, éclairage, déchets) et carte des services publics.

Aucun document officiel ou paiement gouvernemental ne doit être présenté comme validé sans connexion vérifiée à l’autorité concernée. Protéger les données et expliquer le statut réel de chaque intégration.

## 17. Portefeuille, paiements et monnaie électronique

Portefeuille intégré CASELIND : solde, historique, dépôts/retraits via partenaires, transferts P2P, demandes d’argent, paiements commerçants, QR, paiements de commandes, paiements partagés, factures/reçus, remboursements, paiements programmés et abonnements si autorisés.

Intégrations potentielles Mobile Money et opérateurs régionaux : M-Pesa, Airtel Money, Orange Money, Vodacom et autres selon pays, disponibilité, contrats et réglementation. Prévoir aussi agrégateurs de paiement comme Flutterwave, Paystack ou CinetPay si adaptés et autorisés.

Cartes bancaires ou virtuelles, paiement à la livraison, paiements de factures (téléphone/data, électricité, TV, eau, internet, loyer, école et services), recharges et paiements marchands selon intégrations réelles.

Escrow/séquestre jusqu’à confirmation de livraison, BNPL/crédit à l’achat, frais, limites, conversion multi-devises, taux de change, cashback, récompenses et cartes-cadeaux seulement après validation juridique, commerciale et technique.

Architecture financière : registre de transactions append-only/auditables, écritures cohérentes en partie double pour les soldes financiers, idempotence, rapprochement avec les partenaires, frais configurables, plafonds, contrôles anti-fraude, alertes d’anomalie, double validation des opérations sensibles, gestion des échecs et reprise.

Ne jamais considérer un simple solde UI comme une comptabilité fiable. Toute opération doit avoir un statut, une référence unique, une preuve côté fournisseur, une piste d’audit et des mécanismes de rapprochement.

Les transferts d’argent, dépôts/retraits, portefeuille, crédit, BNPL et émission de monnaie peuvent nécessiter un établissement agréé, une licence, KYC/AML, limites et règles de conservation. Construire d’abord en sandbox et avec partenaires réglementés ; ne pas prétendre fournir un service financier licencié sans autorisation.

## 18. CSL Coins, fidélité et économie interne

CSL Coins est un élément distinct de l’écosystème CASELIND déjà envisagé par l’utilisateur. Les règles précises de création, acquisition, dépense, transfert, expiration, conversion, gouvernance, émission, réserve et valeur ne sont pas entièrement définies dans les informations disponibles ici.

Ne pas inventer les mécanismes économiques ni assimiler CSL Coins à Bitcoin. Prévoir une architecture configurable et documenter les questions non tranchées. Ne pas permettre des transactions réelles avant validation des règles, du modèle comptable, des risques, de la réglementation et de la sécurité.

Éventuelles interactions avec fidélité, cashback, récompenses, achats, jeux ou mini-apps doivent être conçues comme des règles explicites, avec prévention de fraude, limites et historique auditable.

## 19. Finance personnelle et outils financiers avancés

Budgets, catégories de dépenses, objectifs d’épargne, tirelires, rappels, prévisions et tableaux de bord personnels ; demande de partage de facture et suivi de dépenses.

Services potentiels : épargne, microcrédit, prêts, score de crédit, assurances santé/voyage/biens/véhicule, investissements actions/obligations/crypto selon licences et partenaires, portefeuille d’investissement, cartes virtuelles.

Outils financiers d’entreprise : facturation, comptabilité, caisse, rapprochement bancaire, paie, cartes virtuelles, dépenses d’équipe, rapports, taxes et exports.

L’assistant IA financier doit rester explicable et prudent, distinguer information générale et conseil réglementé, protéger les données, et demander confirmation avant toute opération.

## 20. Trading, bourse et robots de trading

Fonctions envisagées : marchés et graphiques, portefeuille, suivi des actifs, ordres, historique, alertes, analyses et robots de trading paramétrables.

Développer d’abord un mode simulation/paper trading, tests historiques, limites de risque, journal d’exécution, contrôle des pertes et arrêt d’urgence. Toute connexion à un compte réel doit utiliser des partenaires autorisés et des clés avec permissions minimales.

Aucun rendement ne doit être garanti. Les robots doivent respecter les règles des marchés, les limites de risque, les conditions des courtiers et les exigences réglementaires applicables. Les clés API ne doivent jamais être exposées au client.

## 21. Jeux, Play & Win, NFT et divertissement

Zone Play & Win : jeux, compétitions, tournois, classements, récompenses et interactions avec l’économie CASELIND selon des règles transparentes.

NFT/objets numériques envisagés si utiles et légaux, avec informations de propriété, risques, frais, conservation et conditions de revente claires. Ne pas promettre une valeur financière.

Sport, divertissement, événements, communautés, lives, contenus créateurs, dons/pourboires et activités interactives.

Paris sportifs et loteries ont été évoqués uniquement sous condition de légalité. Ils doivent rester désactivés par défaut et ne pouvoir être activés qu’avec licences, partenaires, contrôle d’âge, géorestrictions, limites, auto-exclusion, transparence et mesures de jeu responsable.

## 22. Intelligence artificielle, assistants et agents

Assistant universel CASELIND capable de répondre sur les fonctions de la plateforme, guider l’utilisateur et, avec autorisations explicites, exécuter des tâches comme rechercher un service, préparer une commande, résumer des messages ou aider une entreprise.

Recherche en langage naturel : par exemple trouver un électricien proche à prix raisonnable, comparer des produits, rechercher un restaurant, un trajet ou une opportunité. La recherche doit combiner index, filtres structurés et données de localisation autorisées.

Recommandations de produits, commerces, restaurants, voyages, contenus et services ; résumés de messages/commandes ; traduction ; génération de descriptions produits, contenu marketing, flyers et publications ; aide à la création d’une boutique/site.

IA pour les entreprises : analyses, rapports, prévisions, automatisations, support 24/7, détection de fraude, faux avis, descriptions, gestion assistée des stocks et explications de performance.

Reconnaissance d’images, commandes vocales et autres fonctions multimodales si elles apportent une valeur mesurable et si les coûts et données sont maîtrisés.

Agents, robots et intégrations MCP envisagés : intégration de services externes, exécution de workflows et accès contrôlé aux outils. Appliquer permissions minimales, validation des entrées, journalisation, limites de coût, confirmation utilisateur avant action sensible, sandbox et mécanismes d’arrêt.

Ne pas donner à un agent accès à toutes les données ou actions par défaut. Les données de santé, finances, messages privés et identité doivent être protégées et traitées selon le consentement et les règles applicables.

## 23. Mini-applications et plateforme développeurs

Prévoir à terme une plateforme de mini-apps internes et tierces, avec SDK/API, authentification CASELIND, notifications, paiements intégrés selon permissions, gestion de versions, tableau de bord développeur, analyse d’usage, processus de revue/certification et partage de revenus.

Chaque mini-app doit déclarer ses permissions, données consultées, endpoints, événements, coûts potentiels et conditions d’utilisation. Les permissions doivent être révocables et les accès audités.

Isoler les applications tierces, contrôler les redirections, limiter les appels API, gérer les quotas et prévenir l’accès non autorisé aux données des autres utilisateurs/entreprises.

## 24. Notifications, recherche et intégrations transversales

Centre de notifications unique : messages, commandes, livraisons, paiements, réservations, activités sociales, alertes de sécurité, rappels et événements. Prévoir préférences par canal, catégorie, fréquence, mode silencieux et push lorsque pris en charge.

Recherche universelle avec résultats par catégorie, suggestions, filtres, historique contrôlable et personnalisation respectueuse de la vie privée.

QR codes pour identité, profil, boutique, produit, paiement, commande, retrait et autres flux physiques-numériques, avec validation côté serveur et protection contre l’usurpation.

Intégrations tierces via API documentées, webhooks signés, clés protégées, quotas, retries, idempotence, journalisation, versionnement et gestion des erreurs.

## 25. Carte, géolocalisation et découverte locale

Carte interactive des commerces, prestataires, événements, points d’intérêt, lieux de service, livraisons et offres locales. Recherche par proximité, catégorie, disponibilité et filtres.

Géolocalisation avec consentement, permissions de plateforme, précision minimale nécessaire, options de saisie manuelle et contrôle utilisateur. Ne pas enregistrer ou exposer continuellement une position précise sans nécessité et base légale.

Itinéraires et ETA uniquement lorsqu’une source cartographique ou un partenaire permet de les calculer. Distinguer les estimations des données confirmées.

## 26. Administration globale, modération et gouvernance

Back-office global : gestion des comptes, entreprises, vérifications, contenus, annonces, catégories, signalements, suspensions, litiges, commissions, paiements, remboursements, partenaires, mini-apps, paramètres pays, feature flags et communications.

Analytique : utilisateurs, activation, rétention, activité, ventes, commandes, revenus, commissions, conversion, coûts IA, incidents et performances. Accès aux métriques selon rôle et respect de la vie privée.

Modération humaine et automatisée, signalement, files de revue, sanctions graduées, recours, journal d’audit, détection de spam/bots, faux comptes, fraude, faux avis et contenus interdits.

Séparation des responsabilités pour les opérations sensibles : approbation par plusieurs personnes lorsque nécessaire, limites d’action administrateur, journal d’audit append-only et contrôle des accès privilégiés.

Feature flags et configuration par pays, ville, langue, devise, réglementation et capacité opérationnelle. Les modules qui ne sont pas prêts ou autorisés doivent être désactivés clairement.

## 27. Site web, domaines, PWA et expérience utilisateur

Site public CASELIND et pages publiques d’entreprises ; PWA installable ; interface responsive ; application mobile Android/iOS envisagée ; navigation cohérente ; mode clair/sombre ; accessibilité ; gestion des tailles de texte ; performances et chargement progressif.

Langues initiales prioritaires évoquées : français, anglais et swahili, avec architecture extensible. Prévoir traduction des interfaces et contenus, détection/préférence de langue et contrôle humain pour les informations sensibles.

SEO technique, métadonnées, liens partageables, indexation contrôlée, images adaptées, optimisation du poids, cache, compression et stratégies adaptées aux réseaux peu fiables.

Mode hors ligne uniquement pour les données pouvant être mises en cache sans risque ; synchronisation différée avec conflits gérés ; aucune promesse d’opérations financières hors ligne non sécurisées.

Ne pas refondre arbitrairement les écrans existants lors d’une tâche locale. Respecter les maquettes approuvées, le design system, les composants réutilisables et les exigences d’accessibilité.

## 28. Architecture technique cible

Architecture cible discutée : monorepo modulaire, React + TypeScript pour le Web, React Native + Expo pour le mobile, Node.js + NestJS pour l’API, PostgreSQL + PostGIS pour données relationnelles et géospatiales, Redis pour cache/présence/coordination selon besoin, WebSockets/Socket.IO pour temps réel, stockage objet et CDN pour médias, files de tâches/workers pour traitements asynchrones.

Cible d’organisation possible : apps/web, apps/api, apps/admin, apps/mobile ; packages/ui, packages/types, packages/config, packages/i18n, packages/utils. Adapter cette organisation à l’état réel du dépôt et aux sources SaaS réutilisées au lieu de réécrire le projet uniquement pour respecter une arborescence théorique.

La cible est modulaire et évolutive, sans microservices prématurés. Commencer par des modules clairement séparés dans une architecture maîtrisable ; extraire des services indépendants seulement si le besoin, la charge ou les frontières de sécurité le justifient.

Stack UI évoquée : React Router, TanStack Query, Zustand, Tailwind CSS ou CSS existant bien structuré, et animations sobres (par exemple Framer Motion) si compatibles. Les choix doivent être confirmés par audit des sources existantes, pas imposés aveuglément.

Ne pas basculer vers Next.js par défaut : les tentatives précédentes ont rencontré des difficultés de configuration et le choix de travail discuté est revenu vers React/Vite. Toute modification de stack doit être justifiée et approuvée.

Base de données : migrations versionnées, contraintes, index, transactions, stratégie de multi-tenant pour entreprises, suppression/archivage, données d’audit, sauvegardes, tests de migration et stratégie de restauration.

API : validation stricte des entrées, DTO/schémas, authentification, autorisation par ressource, pagination, limitation de débit, versionnement, documentation, observabilité, gestion uniforme des erreurs et idempotence pour les opérations sensibles.

## 29. Sécurité, confidentialité et résilience

Sécurité par conception : moindre privilège, séparation des rôles, validation serveur, protection contre XSS, injection, CSRF selon architecture, SSRF, accès direct non autorisé, téléversements dangereux, abus d’API, brute force et fuite de données.

Chiffrement en transit et au repos selon les capacités de l’infrastructure ; gestion des secrets ; rotation des clés ; sauvegardes chiffrées ; journalisation sans secrets ; surveillance ; alertes ; réponse aux incidents ; mises à jour des dépendances.

Messagerie : envisager le chiffrement de bout en bout pour certains échanges, en comprenant ses implications sur sauvegarde, recherche, modération et multi-appareil. Ne pas annoncer E2E avant une implémentation réellement vérifiée.

Paiements et opérations sensibles : idempotence, contrôles anti-rejeu, vérification des webhooks, journal immuable, rapprochement, limites, double validation et alertes d’anomalie.

Vie privée : minimisation des données, consentement, finalités, durées de conservation, export/suppression, permissions explicites, contrôle de visibilité et séparation des données de santé, finance, identité et communications.

Résilience : tests automatisés, sauvegardes et restauration vérifiées, environnements dev/staging/prod séparés, migrations contrôlées, procédures de rollback, surveillance des erreurs et plans de reprise.

## 30. Tests, qualité et livraison

Tests unitaires pour logique métier, tests d’intégration pour base/API/partenaires simulés, tests de composants, tests end-to-end pour parcours critiques, tests de permissions, tests de sécurité, tests de migrations et tests de régression.

Parcours critiques prioritaires : inscription/connexion/récupération ; changement de rôle ; création et gestion de vitrine ; publication/achat/commande ; messagerie ; notifications ; permissions d’entreprise ; paiements simulés ; remboursement/litige ; recherche ; parcours d’administration.

Chaque fonctionnalité doit avoir des critères d’acceptation testables. Une tâche n’est pas terminée uniquement parce que l’écran paraît correct : états de chargement, erreurs, permissions, validation, responsive, accessibilité, sécurité et données doivent aussi être vérifiés.

Git : commits lisibles, branches adaptées, revue des différences, aucun secret commité, historique préservé. CI/CD avec lint, typecheck, tests, build et scans de dépendances selon les capacités.

Environnements séparés ; données de test non sensibles ; sauvegardes automatiques et tests périodiques de restauration ; documentation de déploiement et de retour arrière.

## 31. Roadmap indicative en dix phases

La roadmap a évolué au fil des discussions. Les dix phases ci-dessous sont une organisation indicative consolidée, pas une autorisation de supprimer les modules non inclus dans la phase en cours. Dépendances, sources SaaS disponibles, risques et contraintes de budget peuvent faire ajuster l’ordre.

V1 — Fondations et identité : dépôt, architecture, environnements, CI, compte, authentification, OTP, récupération, profil, rôles/permissions, langues, confidentialité, journaux de sécurité, base et documentation.

V2 — Social et communication : profils, publications, médias, réactions, commentaires, abonnements, stories, messagerie, présence, notifications, modération et contrôles de confidentialité.

V3 — Entreprises et marketplace : vitrines, catalogue, recherche, commandes, outils commerçant, inventaire et premières fonctions métier.

V4 — Économie et paiements : portefeuille en sandbox, intégration de partenaires, transactions auditées, paiements, remboursements, rapprochement et règles CSL Coins à spécifier.

V5 — IA et automatisation : assistant, recherche naturelle, traduction, génération de contenu, support et agents avec permissions/approbations.

V6 — Play & Win et divertissement : jeux, classements, récompenses, événements et éventuels NFT ; fonctions réglementées désactivées sans autorisation.

V7 — Finance avancée : budgets, outils financiers professionnels, partenaires agréés, investissements ou trading uniquement après contrôles de risque et conformité.

V8 — Web, domaines et présence numérique : PWA, SEO, domaines personnalisés, pages publiques avancées et gestion des vitrines.

V9 — Écosystème : mini-apps, SDK, développeurs tiers, intégrations, services de livraison, mobilité, santé, éducation, emploi et services de proximité selon maturité.

V10 — Échelle internationale : multi-pays, multi-devises, observabilité, performance, résilience, gouvernance, conformité régionale, opérations et expansion.

Les fonctions de santé, gouvernement, paiements et sécurité ne doivent pas attendre mécaniquement une phase tardive si elles sont déjà nécessaires à une première fonctionnalité ; leurs exigences de sécurité et conformité s’appliquent dès leur introduction.

## 32. Exigences de contenu et de conception

Interface moderne, professionnelle, cohérente, rapide et accueillante. Éviter les écrans génériques, l’accumulation de gradients et les éléments décoratifs sans fonction. Utiliser un système de design avec couleurs, typographie, espacements, états, composants, icônes, responsive et accessibilité documentés.

Les espaces personnels, professionnels, sociaux, financiers et administratifs doivent rester distincts lorsque les usages et la sécurité l’exigent, tout en partageant une identité et des composants communs.

Prévoir états vides utiles, chargements, erreurs compréhensibles, confirmations, annulations, notifications, filtres, recherche, navigation mobile et comportement adapté aux petits écrans.

Les maquettes approuvées constituent la référence visuelle. Claude Code doit d’abord les comparer à l’interface existante, lister les écarts, puis appliquer les changements ciblés sans supprimer de menus ou de fonctions hors demande.

## 33. Exigences commerciales et modèle économique

Sources possibles de revenus à étudier : commissions de vente et de services, frais de livraison, abonnements professionnels, options premium, publicité et publications sponsorisées, outils professionnels, frais de mini-apps, services partenaires et produits numériques.

Chaque frais doit être transparent et configurable par pays/catégorie/partenaire. Les rapports doivent distinguer volume brut, remboursements, commissions, taxes, coûts partenaires et revenu net.

Ne pas faire dépendre le fonctionnement essentiel de services payants non budgétés. Préférer des outils gratuits/open source et des free tiers au début lorsque c’est viable, en documentant les limites, coûts de croissance et possibilités de remplacement.

## 34. Règles non négociables pour Claude Code

1. Le produit s’appelle CASELIND. 2. Ne rien supprimer de la vision globale ; différer une fonction n’est pas l’oublier. 3. Auditer les sources SaaS avant de recoder. 4. Ne pas inventer le contenu des sources absentes. 5. Ne pas inventer les règles CSL Coins. 6. Ne pas prétendre qu’un partenaire, paiement, service public ou licence est intégré sans preuve.

7. Ne pas modifier des parties non concernées par une tâche. 8. Préserver les fonctionnalités et la navigation existantes sauf demande explicite. 9. Ne pas écraser les changements de l’utilisateur. 10. Ne pas exposer les secrets. 11. Ne pas activer de fonctions réglementées sans validation. 12. Ne pas marquer comme terminé sans tests et rapport.

13. Avant une opération destructive ou une migration risquée, expliquer les conséquences et demander confirmation. 14. Favoriser des changements petits, réversibles et documentés. 15. En cas d’ambiguïté qui bloque une décision structurante, consigner la question et demander une clarification plutôt que d’inventer.

## 35. Critères d’acceptation globaux

Le projet est conforme à ce cahier des charges lorsque : les exigences sont traçables dans un backlog ; les sources SaaS sont inventoriées ; les licences et risques sont documentés ; chaque module possède une définition de terminé ; les comptes et permissions sont appliqués côté serveur ; les données sont protégées ; les parcours critiques sont testés ; les interfaces sont cohérentes ; les environnements et sauvegardes sont documentés ; les intégrations externes sont présentées honnêtement ; les fonctions non prêtes restent clairement différées/désactivées.

Pour chaque version, produire un rapport comprenant : fonctionnalités livrées, fonctionnalités différées, sources réutilisées et raisons, fichiers et migrations modifiés, tests lancés et résultats, risques connus, dépendances manuelles, coût éventuel, procédures de lancement et prochaines étapes.

## 36. Questions ouvertes à maintenir dans le backlog, sans bloquer toute la conception

Règles exactes de CSL Coins : émission, valeur, circulation, conservation, dépense, conversion, transferts, limites et conformité.

Liste réelle, emplacement et licences des codes sources SaaS achetés ; fonctionnalités présentes dans chaque source ; services tiers et frais récurrents.

Pays de lancement, structure juridique, devises prioritaires, exigences de conservation des données et partenaires agréés.

Fournisseurs concrets pour SMS/OTP, Mobile Money, paiements, cartes, cartes géographiques, stockage médias, notifications, visioconférence et livraison.

Priorités de la première version commercialisable et limites budgétaires précises pour l’hébergement, les API et les services tiers.

Politique de commissions, abonnements, publicité, monétisation des créateurs et partage de revenus mini-apps.

Règles détaillées des fonctions de jeux, NFT, trading et paris éventuels ; par défaut, les fonctions réglementées restent désactivées jusqu’à validation.

## 37. Prompt de démarrage à fournir à Claude Code

Tu travailles sur CASELIND, une super-application multi-services décrite dans ce cahier des charges. Ce document est la référence produit globale. Ne commence pas en codant immédiatement et ne tente pas de tout construire en une seule tâche.

Étape 1 : inspecte le dépôt courant, son état Git, l’arborescence, la stack réelle, les tests, les scripts, la configuration et les éventuelles modifications non commitées. N’écrase rien.

Étape 2 : localise et inventorie les codes sources SaaS achetés disponibles dans les dossiers indiqués par l’utilisateur ou accessibles dans l’environnement. Si les chemins ne sont pas évidents, dresse la liste des dossiers/projets repérés et demande uniquement les chemins manquants nécessaires. N’invente aucun dépôt.

Étape 3 : pour chaque source, documente la licence, les fonctionnalités, le framework, les dépendances, la base de données, l’authentification, les services externes, les risques et les possibilités de réutilisation. Ne copie pas tout le projet sans analyse.

Étape 4 : crée/actualise la matrice des exigences CASELIND et des sources réutilisables. Classe chaque exigence : déjà présente, réutilisable directement, réutilisable après adaptation, à développer, différée pour conformité/dépendance, ou à clarifier.

Étape 5 : propose une architecture et un plan de livraison progressif fondés sur le dépôt et les sources réellement disponibles. Respecte le stack cible comme orientation, mais ne migre pas le projet sans justification et accord. Privilégie les changements les plus petits qui apportent une valeur vérifiable.

Étape 6 : attends la validation du plan avant les changements majeurs. Pour chaque lot, applique les critères d’acceptation, teste, documente les décisions et fournis un rapport exact. Réutilise le code utile pour économiser du temps et des tokens, sans sacrifier sécurité, licence, qualité ou cohérence.

Ne considère jamais les fonctions reportées comme supprimées du cahier des charges. N’invente pas les règles de CSL Coins, les contenus des sources SaaS, les intégrations externes ou les autorisations réglementaires.


## 38. Benchmarking des plateformes existantes et inspiration UX/UI

Principe non limitatif : les sources SaaS achetées par l’utilisateur ne constituent PAS la seule source d’inspiration de CASELIND. Claude Code doit également étudier les plateformes publiques de référence, leurs parcours utilisateur, modèles fonctionnels, mécanismes d’engagement, opérations et bonnes pratiques UX/UI. Le cahier des charges est une cible évolutive, pas une limite à l’innovation.

CASELIND peut s’inspirer des concepts, parcours, comportements d’interface et modèles de service observables sur des plateformes comme WeChat, eBay, Alibaba, Amazon, TikTok et d’autres produits pertinents dans le commerce, les paiements, les wallets, la vidéo, le live shopping, la logistique, les services et les mini-applications. La liste est indicative et ne limite pas les recherches à ces marques.

Exemples de domaines à étudier : WeChat pour l’intégration de services, la communication, les comptes officiels, les paiements et les mini-programmes ; eBay pour les places de marché, enchères, vendeurs et ventes en direct lorsqu’elles sont disponibles ; Alibaba pour le commerce interentreprises, les fournisseurs, les commandes en gros, la négociation et la chaîne d’approvisionnement ; Amazon pour la recherche, les catalogues, les recommandations, les avis, les commandes, la livraison et l’après-vente ; TikTok pour les vidéos courtes, le flux personnalisé, les outils créateurs et les lives ; ainsi que des plateformes reconnues de wallets, paiement, transferts, cartes et services financiers.

Pour chaque référence, Claude Code doit identifier le problème utilisateur résolu, le parcours complet, les écrans/états, les interactions, les règles métier, les cas d’erreur, les signaux de confiance, les fonctions de modération, les contraintes mobiles et les indicateurs de réussite. Ne pas se limiter à copier l’apparence : comprendre pourquoi le parcours fonctionne et adapter le mécanisme à CASELIND.

Prévoir un benchmark continu : sélectionner les références pertinentes pour chaque module, comparer les parcours, relever les idées réutilisables, les risques, les contraintes réglementaires, les possibilités de différenciation et les coûts d’implémentation. Tenir un registre avec plateforme, fonctionnalité observée, source publique/date si disponible, idée retenue, adaptation CASELIND, risques et statut.

Copier une idée fonctionnelle ou un motif UX général n’autorise pas à copier illégalement du code propriétaire, des marques, des logos, des contenus, des textes, des assets, des interfaces distinctives ou des éléments protégés. Le code source ne doit être repris que s’il est légalement disponible et compatible avec ses licences. Pour les autres plateformes, reproduire les concepts de haut niveau avec une conception propre à CASELIND, sans usurpation ni confusion de marque.

Live commerce / vente en direct : étudier les parcours de découverte d’un live, programmation, notifications de démarrage, vidéo en direct, catalogue attaché au live, fiches produit, stock en temps réel, épingles de produits, commentaires, questions, modération, coupons, enchères ou offres temporaires si légalement adaptées, panier et paiement, suivi de commande, statistiques du vendeur et replay si autorisé. Prévoir les déconnexions, latence, modération, fraude, remboursement et protection des acheteurs. Les fonctions exactes doivent dépendre de la faisabilité technique et des fournisseurs vidéo/paiement disponibles.

Vidéos courtes / Reels : examiner la création, le montage léger, sous-titres, audio autorisé, couverture, tags, produits attachés, flux vertical, swipe, likes, commentaires, partage, favoris, signalement, contrôle de recommandations, contrôle parental/âge si nécessaire et outils créateurs. Les recommandations doivent respecter la confidentialité et proposer des moyens de contrôler ou réinitialiser la personnalisation.

Commerce intégré : examiner les parcours de recherche, filtres, comparaison, pages vendeur, confiance, évaluations, panier, checkout, options de livraison, suivi, retours, remboursement, service client et protection contre les annonces frauduleuses. Adapter les mécanismes à la capacité opérationnelle de CASELIND et aux pays de lancement.

Wallets et paiements : comparer l’expérience de dépôt/retrait, transferts, QR, paiement marchand, cartes, conversion, frais, reçus, notifications, limites, récupération de compte, litiges et prévention de fraude. N’activer aucune fonction financière réelle avant de confirmer la légalité, les partenaires, la sécurité, le KYC/AML et le rapprochement comptable.

Visa et services de voyage : étudier les plateformes officielles et les fournisseurs autorisés pour la recherche d’informations de visa, listes de documents, formulaires, rappels, prise de rendez-vous, suivi de dossier et services de voyage. CASELIND peut faciliter l’orientation et l’organisation, mais ne doit jamais se présenter comme une autorité consulaire, garantir l’approbation d’un visa ou simuler une intégration officielle. Les conseils doivent pointer vers les sources officielles et être datés.

Ne pas présumer que toutes les plateformes citées disposent de toutes les fonctionnalités dans tous les pays. Vérifier la disponibilité géographique, les changements récents et les fournisseurs réels avant d’en faire une exigence d’implémentation. Une fonctionnalité peut être réservée à certains marchés ou avoir changé depuis les observations.

Le benchmark peut conduire à proposer des améliorations non explicitement énumérées dans ce document, à condition de les enregistrer comme propositions, d’expliquer leur valeur, coût, risques et dépendances, puis d’obtenir validation avant une modification majeure du périmètre. Ne pas utiliser cette liberté pour supprimer ou remplacer silencieusement les besoins déjà définis.

Livrable attendu de Claude Code avant le développement de chaque grand module : une courte analyse comparative, les parcours de référence, les propositions adaptées à CASELIND, les composants SaaS internes réutilisables, les composants à développer, les risques juridiques/sécurité, et une liste de critères d’acceptation testables.

---

# 39. MISSION PERMANENTE : RECHERCHE, INVESTIGATION, RÉUTILISATION ET INNOVATION

## 39.1 Principe directeur

CASELIND doit devenir un produit cohérent, utile, sûr et évolutif. Le présent cahier des charges définit le périmètre connu et les exigences exprimées, mais il ne constitue pas une limite à l'innovation. Claude Code doit préserver les besoins existants, rechercher les meilleures solutions disponibles et proposer des améliorations pertinentes, même si elles ne sont pas encore décrites ici.

Ne jamais interpréter « innover » comme une autorisation de supprimer des fonctionnalités demandées, de réécrire arbitrairement l'application, de remplacer la direction artistique approuvée, de modifier les données sans migration sûre ou de lancer seul une modification majeure non validée.

## 39.2 Outils d'investigation et de recherche

Lorsque leur installation, leur configuration et leurs capacités réelles le permettent, utiliser les outils suivants :

- **REA** : investigation technique des dépôts, architecture, dépendances, flux, risques, systèmes existants et possibilités de réutilisation, dans la limite de ce que l'outil prend effectivement en charge.
- **replica-skill** : reconnaissance structurée d'applications de référence, analyse des parcours et états d'interface, aide à la conception/reconstruction et vérification fonctionnelle, selon les capacités réelles de la version installée.
- **Agent-Reach** : recherche externe dans les sources et plateformes réellement accessibles par ses connecteurs, notamment pour découvrir des projets, discussions, retours d'expérience, dépôts et références utiles.
- **Claude Code** : coordinateur de la démarche, de l'analyse, de la planification, de l'implémentation, des tests et de la documentation.

Avant de compter sur un outil, vérifier qu'il est installé, lisible, configuré et utilisable dans l'environnement réel. Ne pas prétendre qu'un outil a été exécuté, qu'une page a été consultée ou qu'un test a réussi si cela n'a pas été observé. En cas d'échec, expliquer la limite et choisir une solution de rechange réaliste.

## 39.3 Ne pas limiter les recherches aux références déjà citées

Les recherches doivent être internationales et non limitatives. Les exemples ci-dessous sont des pistes de départ, pas une liste exhaustive ni une approbation de leurs fonctionnalités dans tous les pays :

- **Commerce et places de marché** : Amazon, eBay, Alibaba, AliExpress, Etsy, Mercado Libre, Shopify et plateformes locales ou spécialisées.
- **Réseaux sociaux, vidéo et créateurs** : TikTok, Instagram, YouTube, Facebook, Snapchat, Twitch, Pinterest, Reddit et autres plateformes pertinentes.
- **Messagerie et super-applications** : WeChat, WhatsApp, Telegram, LINE, Discord et produits comparables.
- **Paiements et finance** : PayPal, Stripe, Wise, Revolut, M-Pesa, Airtel Money, Orange Money, banques et agrégateurs autorisés selon les marchés.
- **Gestion d'entreprise et SaaS** : Odoo, Salesforce, HubSpot et solutions ERP, CRM, POS, stocks, RH, marketing, support et comptabilité.
- **Autres domaines** : mobilité, livraison, santé, éducation, emploi, immobilier, tourisme, services publics, jeux, actifs numériques, IA, agents, MCP, mini-applications, automatisation, cybersécurité défensive, outils open source et solutions spécialisées.

Rechercher également des projets moins connus lorsqu'ils offrent une solution plus adaptée, plus légère, moins chère, mieux documentée ou plus facile à maintenir. Vérifier la date, la source, la disponibilité, les limites géographiques, la licence et le niveau de preuve. Ne pas confondre une démonstration marketing avec une capacité réellement utilisable.

## 39.4 Processus obligatoire avant un module majeur

1. Reformuler le besoin utilisateur et les critères de réussite sans perdre les exigences du présent document.
2. Examiner l'état réel du dépôt, les routes, les composants, les modèles de données, les API, les tests, les dépendances et les décisions existantes.
3. Rechercher les solutions, références UX, bibliothèques, services et projets open source pertinents.
4. Inspecter en priorité les sources SaaS achetées ou déjà fournies par le propriétaire, sans supposer leur contenu ni leur réutilisabilité.
5. Comparer les options : réutiliser, adapter, intégrer, remplacer ou développer spécifiquement.
6. Évaluer sécurité, confidentialité, licence, coût total, performance, accessibilité, expérience mobile, maintenance, dépendances et contraintes réglementaires.
7. Présenter une recommandation concrète, ses compromis et les questions réellement bloquantes. Ne pas multiplier les questions lorsque l'analyse du projet permet de trancher sans risque.
8. Obtenir validation du propriétaire avant les changements majeurs de périmètre, de données, d'architecture ou de design approuvé.
9. Implémenter en lots cohérents, avec changements limités et réversibles autant que possible.
10. Exécuter les tests pertinents, vérifier les parcours complets et rapporter exactement les résultats.

La recherche ne doit pas devenir une excuse pour retarder indéfiniment la livraison. Timeboxer l'exploration, décider à partir des preuves disponibles, livrer une première version de qualité, puis améliorer par itérations.

## 39.5 Matrice de comparaison minimale

Pour chaque solution sérieusement envisagée, documenter lorsque ces informations sont disponibles :

- problème résolu et utilisateurs concernés ;
- fonctionnalités réellement observées et parcours complets ;
- compatibilité avec l'architecture et les exigences de CASELIND ;
- maturité, maintenance, documentation, communauté et activité du dépôt ;
- licence, conditions d'utilisation, attribution et restrictions commerciales ;
- sécurité, traitement des données, permissions et risques de dépendance ;
- coût initial, frais récurrents, limites gratuites et coût de changement ;
- performance, accessibilité, expérience mobile, langues et localisation ;
- effort d'intégration, effort de maintenance, risques et solution de repli ;
- recommandation finale et raisons du choix.

## 39.6 Réutilisation des sources SaaS acquises

Les sources SaaS achetées par le propriétaire représentent des actifs à examiner sérieusement, mais leur contenu, leur qualité et leurs possibilités d'intégration ne doivent jamais être présumés. Pour chaque source : inventorier les fichiers et technologies, lancer le projet dans un environnement isolé lorsque c'est possible, lire la documentation, identifier les fonctions réellement présentes, examiner le modèle de données et les dépendances, inspecter la licence et les vulnérabilités, puis évaluer la réutilisation.

Ne pas copier aveuglément un projet complet dans CASELIND. Extraire les composants utiles de manière maîtrisée, harmoniser l'authentification et les permissions, le design system, la gestion des erreurs, les conventions de code et la stratégie de test. Éviter les doublons fonctionnels, les dépendances incompatibles, les secrets exposés et les migrations destructrices. Conserver la traçabilité de la provenance et des licences.

## 39.7 Propriété intellectuelle et conformité

L'étude d'une application publique autorise l'analyse des concepts généraux et des parcours observables, pas la copie illégale de code propriétaire, de logos, de marques, d'illustrations, de textes, de médias ou d'une expression visuelle protégée. Construire une réalisation originale adaptée à CASELIND. Réutiliser du code uniquement lorsque sa disponibilité et sa licence le permettent, en respectant les obligations associées.

Pour les domaines réglementés (notamment paiements, transferts, crédit, investissement, santé, identité et visa), distinguer information, simulation et opération réelle. Ne jamais présenter une intégration comme officielle sans preuve, promettre une autorisation ou un résultat administratif, ni activer un service financier réel sans vérifier les partenaires, exigences réglementaires, contrôles KYC/AML applicables, sécurité, rapprochement comptable et gestion des litiges.

## 39.8 Registre de recherche et décisions

Maintenir une documentation concise mais vérifiable contenant :

- date de recherche et module concerné ;
- sources consultées et liens lorsqu'ils sont disponibles ;
- fonctionnalités confirmées, hypothèses et éléments non vérifiés ;
- idée retenue et adaptation originale pour CASELIND ;
- options rejetées et raisons principales ;
- licence, risques, coûts, dépendances et limites ;
- décision, validation requise, statut de mise en œuvre et tests associés.

Toute affirmation importante doit être distinguée selon qu'elle est vérifiée, estimée ou encore inconnue. Ne jamais inventer de résultats, d'API, de clés, d'identifiants, de capacités ou d'intégrations.

## 39.9 Collaboration entre agents et modifications du dépôt

Si plusieurs agents ou outils travaillent sur le même projet, leur donner des tâches délimitées. Éviter les modifications concurrentes des mêmes fichiers sans stratégie de branches, d'isolation et de fusion. Avant de fusionner, inspecter les différences, résoudre les conflits, vérifier les imports, les contrats API, les migrations et les tests. Garder une seule source de vérité pour les décisions d'architecture et le cahier des charges.

## 39.10 Rapport de fin de lot

À la fin de chaque lot, fournir un rapport bref et concret :

- ce qui a été modifié et pourquoi ;
- fichiers et zones touchés ;
- tests exécutés et résultats observés ;
- tests non exécutés et raison ;
- défauts restants, risques et dépendances ;
- décisions qui attendent le propriétaire ;
- prochaine étape recommandée.

Ne jamais déclarer un lot « terminé » sur la seule base d'un code écrit. Vérifier les parcours réels pertinents et signaler les limites de l'environnement.

# 40. RÈGLES OPÉRATIONNELLES RENFORCÉES POUR CLAUDE CODE

1. Lire ce cahier des charges en entier avant de planifier les changements.
2. Inspecter le dépôt réel et établir un état initial : commandes disponibles, scripts, structure, routes, fonctionnalités présentes, tests, erreurs et configuration. Ne pas supposer que le projet est vide ou que les descriptions correspondent parfaitement au code.
3. Préserver le travail existant et les fonctionnalités validées. Ne pas effectuer de refonte générale quand une correction ciblée suffit.
4. Avant un changement sensible, expliquer le plan, les fichiers concernés, les risques et la stratégie de retour arrière ; attendre la validation lorsqu'elle est requise.
5. Ne jamais supprimer une exigence parce qu'elle n'est pas dans la première version ou le premier lot. Marquer les éléments « prévu », « en cours », « livré », « bloqué » ou « reporté ».
6. Prioriser la sécurité : secrets dans les variables d'environnement, permissions vérifiées côté serveur, validation des entrées, contrôle d'accès par ressource, journalisation sans données sensibles, protection contre abus et tests des rôles.
7. Ne jamais exposer de clés API, mots de passe, jetons, secrets, données personnelles ou fichiers `.env` dans le code, les journaux ou les commits.
8. Éviter les données fictives présentées comme réelles. Toute donnée de démonstration doit être clairement identifiée et isolée des données de production.
9. Ne pas activer silencieusement de services payants, de clés API, de stockage coûteux, de SMS, de cartes, de vidéo ou de paiements réels. Décrire les coûts et demander l'accord avant toute dépense ou activation irréversible.
10. Ne pas réécrire les règles métier non spécifiées, notamment les mécanismes de CSL Coins. Documenter les questions et proposer des options explicites.
11. Ne pas installer une dépendance uniquement parce qu'elle est populaire. Vérifier compatibilité, licence, maintenance, sécurité, taille et utilité réelle.
12. Garder le code modulaire, lisible, typé et documenté au niveau utile ; éviter les abstractions prématurées et les fichiers monolithiques.
13. Vérifier les états de chargement, succès, absence de données, erreur, accès refusé, réseau indisponible et affichage mobile.
14. Préserver l'accessibilité, la cohérence des composants, les langues prévues et la qualité de l'expérience utilisateur.
15. À la fin, fournir un état exact des changements, des tests et des tâches restantes. Ne jamais déclarer qu'une commande ou un test a réussi sans résultat observable.

# 41. PROMPT DE DÉMARRAGE À UTILISER AVEC CLAUDE CODE

Tu es l'ingénieur logiciel principal, l'architecte technique et le responsable qualité de CASELIND. Commence par lire intégralement le fichier `CASELIND_CAHIER_DES_CHARGES_DEFINITIF.md`. Ce document contient les exigences consolidées connues et doit être traité comme la source de vérité fonctionnelle, tout en restant ouvert aux améliorations validées.

**Première mission : ne modifie pas immédiatement le code.** Inspecte le dépôt réel et son état. Identifie la stack réellement utilisée, les modules présents, les fonctions incomplètes, les sources SaaS achetées, les scripts et tests disponibles, les risques de sécurité, les écarts par rapport au cahier des charges et les éventuelles instructions du projet. N'invente aucun contenu de dépôt que tu n'as pas inspecté.

Vérifie si REA, replica-skill et Agent-Reach sont réellement installés et utilisables. Utilise chacun pour les tâches où il apporte une valeur vérifiable. Si un outil est absent, mal configuré ou incapable d'effectuer une action, indique-le clairement et utilise une méthode alternative. Pour les modules majeurs, réalise une recherche comparative ciblée à l'aide des références du document et d'autres solutions pertinentes trouvées à l'échelle internationale. Les références citées ne sont pas une liste limitative.

Examine soigneusement les sources SaaS fournies ou achetées avant de décider de reconstruire des fonctions déjà disponibles. Vérifie la provenance, les licences, la qualité, la sécurité, les dépendances, l'intégration et le coût total. Réutilise ce qui est légalement réutilisable et techniquement judicieux, sans fusionner aveuglément des projets incompatibles.

Ensuite, remets un diagnostic structuré :

1. état réel du projet et commandes de démarrage ;
2. fonctionnalités présentes, partielles, absentes et cassées ;
3. écarts par rapport au cahier des charges ;
4. sources SaaS examinées et éléments réutilisables ;
5. risques prioritaires et problèmes de sécurité ;
6. proposition d'architecture et de séquencement, en préservant les décisions déjà approuvées ;
7. plan de travail par lots, critères d'acceptation et tests ;
8. questions réellement bloquantes nécessitant le propriétaire.

Ne commence pas de refonte majeure avant validation du plan. Après validation, avance par lots petits, cohérents, testables et réversibles. Préserve les fonctionnalités existantes, n'enlève aucun besoin du cahier des charges, ne change pas arbitrairement l'interface approuvée et ne prétends jamais qu'un test, une recherche ou une intégration a réussi sans preuve. À chaque étape, explique brièvement ce qui est terminé, ce qui reste, les tests réellement exécutés et les décisions attendues.

Le but n'est pas de produire une simple maquette ou une liste de pages : le but est de construire progressivement CASELIND comme un produit cohérent, fiable, sécurisé, maintenable, accessible et réellement testable, en tenant compte des contraintes de budget, des fournisseurs disponibles, des lois applicables et des priorités du propriétaire.

# 42. RÈGLE FINALE DE COMPLÉTUDE

Ce document doit rester vivant. Lorsqu'une exigence nouvelle est exprimée, l'ajouter au cahier des charges ou à un registre de décisions relié au projet, sans effacer les exigences précédentes. En cas de contradiction, la signaler explicitement, expliquer les conséquences et demander une décision plutôt que de choisir silencieusement. Les fonctions non réalisées restent dans la feuille de route avec leur statut ; elles ne disparaissent pas parce que l'implémentation est progressive.

La qualité finale se mesure à la cohérence du produit, au respect des besoins, à la fiabilité des parcours, à la sécurité, à la clarté des décisions, à la réutilisation légale des actifs existants et aux tests effectivement réalisés — et non au nombre de fichiers créés ni aux affirmations de l'agent.

