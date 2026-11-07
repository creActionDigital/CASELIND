# Mise en service de l'envoi des codes (OTP)

Décision Q2 / ADR-018 : e-mail via **Brevo**, téléphone via **WhatsApp Cloud API** (Meta). Pas de SMS. Tant que rien n'est créé, le serveur tourne en développement avec le fournisseur `console` (codes dans le journal) ; en production il refuse de démarrer sans ces réglages.

## 1. E-mail (Brevo, gratuit jusqu'à 300 e-mails par jour)
1. Créer un compte sur brevo.com.
2. Ajouter et vérifier le **domaine expéditeur** (enregistrements DNS SPF, DKIM, DMARC fournis par Brevo) ou, à défaut, une adresse expéditeur vérifiée.
3. Créer une clé API (SMTP et API > Clés API).
4. Renseigner : `OTP_EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `OTP_EMAIL_FROM` (adresse du domaine vérifié), éventuellement `OTP_EMAIL_FROM_NAME`.

## 2. Téléphone (WhatsApp Cloud API, environ 0,004 à 0,005 $ par code)
1. Créer un compte **Meta Business** et vérifier l'entreprise.
2. Créer une application Meta de type Business avec le produit WhatsApp, puis ajouter et vérifier un **numéro de téléphone** dédié (qui ne doit pas être déjà inscrit sur WhatsApp).
3. Créer un **modèle de catégorie Authentification** (un paramètre pour le code, bouton « copier le code », durée de validité dans le texte, ex. 10 minutes), dans la langue voulue, et attendre son approbation.
4. Créer un utilisateur système et un **jeton d'accès permanent** avec les permissions `whatsapp_business_messaging` et `whatsapp_business_management`.
5. Renseigner : `OTP_PHONE_PROVIDER=whatsapp`, `WHATSAPP_PHONE_NUMBER_ID` (identifiant du numéro, pas le numéro), `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_OTP_TEMPLATE` (nom du modèle), `WHATSAPP_TEMPLATE_LANG` (code de langue du modèle, ex. `fr`), et `WHATSAPP_GRAPH_VERSION` si besoin (défaut `v21.0`).

## 3. Vérifier
- Démarrer avec `NODE_ENV=production` : une variable manquante est signalée par son nom au démarrage.
- Faire une inscription réelle par e-mail puis par numéro. En cas d'échec, chercher `otp delivery failed` dans le journal (le compteur `failures_<canal>` y figure).
- Les secrets ne vont que dans l'environnement du serveur, jamais dans le dépôt.
