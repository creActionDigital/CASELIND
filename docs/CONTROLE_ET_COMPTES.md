# CASELIND — Qui contrôle quoi (inventaire au 2026-11-08)

Ce document liste **tout ce dont l'application dépend** : où sont le code et les données, quels services externes elle peut appeler, et quels comptes doivent être **à ton nom**. État réel vérifié dans le code (`apps/api/src/config/env.ts`, adresses appelées par le code, dépôt Git).

## 1. Ce qui est aujourd'hui uniquement sur ton PC

| Élément | Où | Risque | À faire |
|---|---|---|---|
| **Code source** (19 commits) | `E:\CASELIND` | **Aucune copie ailleurs** : le dépôt Git n'a pas de dépôt distant. Une panne du disque = tout est perdu. | Créer un dépôt **privé** GitHub (gratuit) **à ton nom** et y pousser le code. |
| **Base de données de développement** | PostgreSQL 18 embarqué, `apps/api/.data/pg` (≈ 80 Mo avec les médias) | Données de test seulement (Alice, Bob, Goma Market). | Rien d'urgent : elle sert aux essais. |
| **Fichiers envoyés** (photos, documents) | Disque local, `apps/api/.data/media` | Pas de copie. | Choisir un stockage objet en production (décision Q6). |
| **Secrets** (clés de signature, mots de passe de test) | `apps/api/.env` (exclu de Git) | Si le fichier est perdu, les sessions et QR signés deviennent invalides. | Les garder dans un gestionnaire de mots de passe ; en production, générer de nouveaux secrets. |

## 2. Base de données

- **Moteur** : **PostgreSQL** (logiciel libre, gratuit). En développement : version embarquée, lancée par `npm run db:dev -w @caselind/api`, sans Docker.
- **Accès au code** : Drizzle ORM + migrations SQL écrites à la main (`apps/api/migrations/0001` à `0023`). Aucune dépendance à un fournisseur : n'importe quel PostgreSQL ≥ 16 convient.
- **Production** : **pas encore choisie** (décision Q6 : hébergement). Options : PostgreSQL géré (payant, sauvegardes automatiques) ou sur ton propre serveur (moins cher, sauvegardes à organiser).
- **Tes données t'appartiennent** : export complet possible à tout moment (`pg_dump`), et chaque utilisateur peut exporter les siennes depuis l'app.

## 3. Services externes que le code sait appeler

**Aucun n'est actif aujourd'hui** : sans clé dans `.env`, chaque service est simplement désactivé (les codes OTP s'affichent dans la console, l'IA répond « indisponible », les push sont seulement journalisés).

| Service | Pourquoi | Statut | Compte à créer **à ton nom** | Coût |
|---|---|---|---|---|
| **Brevo** | Envoyer les codes de connexion par e-mail | Prêt, sans clé | Compte Brevo + domaine d'envoi vérifié | Gratuit jusqu'à 300 e-mails/jour |
| **Meta WhatsApp Cloud API** | Envoyer les codes par WhatsApp | Prêt, sans clé | Meta Business + numéro WhatsApp + modèle de message approuvé | ≈ 0,004–0,005 $ par code (à confirmer) |
| **Expo (notifications push)** | Notifications sur téléphone | Prêt, sans compte | Compte Expo (gratuit), relié au projet | Gratuit |
| **Google AI Studio (Gemini)** | Assistant IA, modèle par défaut | Prêt, sans clé | Clé API Google AI Studio | Offre gratuite limitée ; peut entraîner sur les données |
| **Groq, Mistral, OpenRouter** | Autres modèles d'IA au choix de l'utilisateur | Prêt, sans clé | Une clé par fournisseur, si tu veux les proposer | Offres gratuites limitées |
| **OpenStreetMap** | Lien « Itinéraire » sur le web | Simple lien, aucune donnée envoyée | Aucun | Gratuit |
| **FlexPay** (Mobile Money RDC) | Paiements réels | **Non intégré** (wallet en mode test) | Compte marchand (documents d'entreprise) | Frais à demander |

Aucun autre service tiers n'est contacté : pas de publicité, pas d'outil d'analyse d'audience, pas de traqueur.

## 4. Comptes indispensables pour publier, tous à ton nom

| Compte | Pourquoi | Coût |
|---|---|---|
| **GitHub** (dépôt privé) | Sauvegarde du code, intégration continue déjà écrite (`.github/workflows/ci.yml`) | Gratuit |
| **Nom de domaine** (ex. caselind.com / .cd) | Site web, adresses e-mail d'envoi, liens | Payant (annuel) |
| **Hébergement** (Q6) | Faire tourner l'API et la base en ligne | Payant (mensuel) |
| **Expo / EAS** | Construire les applications iOS et Android | Gratuit au départ |
| **Google Play Console** | Publier sur Android | Payant (frais unique) |
| **Apple Developer Program** | Publier sur iPhone | Payant (abonnement annuel) |
| **Brevo, Meta Business, Google AI Studio** | Voir section 3 | Voir section 3 |
| **FlexPay** | Argent réel (plus tard) | Voir section 3 |

Règle à suivre : **chaque compte à ton nom et ton adresse e-mail**, avec double authentification, et les clés copiées dans ton gestionnaire de mots de passe. Personne d'autre (développeur, prestataire) ne doit être propriétaire d'un de ces comptes.

## 5. Ton contrôle à l'intérieur de l'application

- **Compte administrateur** : le rôle `admin` donne accès à la modération, aux flags (activer ou couper un module par pays), à la validation KYC, des chauffeurs et des mini-apps, et à l'activation des modèles d'IA. Il s'attribue aujourd'hui par une commande SQL sur la base ; un écran d'administration est prévu avec le site web.
- **Modules réglementés coupés par défaut** (argent réel, paris, santé, trading réel) : ils ne s'activent que par un admin, avec confirmation explicite.
- **Journal d'audit** : toutes les actions sensibles (admin, sécurité, argent) sont enregistrées et non modifiables.

## 6. Logiciels utilisés

Tout le code repose sur des logiciels libres et gratuits (Node.js, NestJS, PostgreSQL, React Native, Expo, etc.). Aucune licence payante n'est nécessaire pour faire tourner CASELIND.

## 7. Priorités recommandées

1. **Sauvegarder le code** sur un dépôt GitHub privé à ton nom (aujourd'hui : un seul exemplaire).
2. Créer les comptes gratuits : Brevo, Google AI Studio, Expo.
3. Choisir l'hébergement (Q6) et le nom de domaine.
4. Plus tard : Meta WhatsApp, FlexPay, comptes des stores.
