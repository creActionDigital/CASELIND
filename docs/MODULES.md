# Inventaire des modules (apps/api/src)

Dernière mise à jour : 2026-11-20 · Relevé fait par lecture du dépôt (dossiers de `apps/api/src`, `CREATE TABLE` des migrations, `@Controller`, `@RequireFlag`, `ORG_ROLE_PERMISSIONS`, `emitTo*`, `webhooks.emit`, écrans `apps/mobile/src/app`). Les routes ci-dessous sont les préfixes de classe `@Controller` (sous `/v1`) ; les contrôleurs sans préfixe déclarent leurs routes complètes méthode par méthode : la liste exhaustive est dans `apps/api/src/openapi/registry.ts` et `GET /v1/openapi.json`. Les migrations vont de `0001` à `0100` (95 fichiers : les numéros 0033, 0040, 0051, 0098 et 0099 n'existent pas). Le tableau signale **en cours** ce qui est encore modifié ou non commité au moment du relevé (agents actifs : mobilité, mini-apps phase 2, administration, correctifs).

Légende : « flag » = `@RequireFlag` (403 `feature_disabled`) ; « perm. » = permission d'organisation (`OrgPermissionKey`, voir la fin du document) ; « — » = aucun / sans objet ; « à vérifier » = information non confirmée par le relevé.

## 1. Socle technique

| Module | Rôle | Tables | Routes | Flag / perm. | Mobile | Temps réel / webhooks |
|---|---|---|---|---|---|---|
| `config` | Variables d'environnement validées (Zod) au démarrage ; refus des secrets faibles en production | — | — | — | — | — |
| `db` | Pool `pg`, Drizzle, schémas typés (`schema-*.ts`), migrateur SQL forward-only avec checksum et verrou consultatif | `schema_migrations` (à vérifier le nom exact) | — | — | — | — |
| `common` | `AppError`, filtre d'exceptions (enveloppe d'erreur), pipe Zod, masquage des journaux, métadonnées de requête | — | — | — | — | — |
| `security` | Garde globale (session lue en base, statut, rôles), Argon2id, JWT, `SessionVerifier` (partagé avec Socket.IO), limiteur HTTP | — | — | — | — | — |
| `audit` | Journal d'audit append-only (trigger) | `audit_events` | — | rôle plateforme `admin` pour la lecture | `admin/audit` | — |
| `observability` | Métriques Prometheus sans dépendance | — | `/metrics` (hors `/v1`) | `METRICS_TOKEN` (404 sans lui) | — | — |
| `openapi` | OpenAPI 3.1 généré depuis les contrats Zod | — | `/v1/openapi.json` | public | — | — |
| `maintenance` | Nettoyage horaire (OTP, sessions), anonymisation des comptes, médias orphelins ; verrou consultatif | — | — | `MAINTENANCE_ENABLED` | — | métrique `caselind_maintenance_runs_total` |
| `health` (sondes) | Sondes `GET /health`, `/health/live`, `/health/ready` (publiques) ; **le même dossier héberge le module santé personnelle** (section 5) | — | `health` | — | — | — |
| `realtime` | Passerelle Socket.IO (`/v1/socket.io`), rooms `user:`, `session:`, `conversation:`, `order:` | — | — | — | `lib` / `realtime` (client) | tous les événements serveur → client (voir `API_CONTRACTS.md`) |

## 2. Identité, comptes, gouvernance

| Module | Rôle | Tables | Routes | Flag / perm. | Mobile | Temps réel / webhooks |
|---|---|---|---|---|---|---|
| `auth` | Inscription, OTP (e-mail Brevo, WhatsApp), connexion, refresh à rotation, sessions, 2FA TOTP, changement d'identifiant, connexion par QR | `users`, `sessions`, `refresh_tokens`, `otp_challenges`, `user_totp`, `user_backup_codes`, `two_factor_challenges`, `qr_login_sessions` | `auth`, `me/2fa/totp`, `me/identifier-change`, `auth/qr` | — | `(auth)`, `security/2fa`, `security/identifier`, `security/qr-approve`, `sessions` | — |
| `users` | Profil, @handle, profil public, journal de sécurité | `users` | `me`, `users/:handle`, `me/security-events` | — | `profile`, `u/[handle]` | — |
| `account` | Export des données, demande de suppression avec délai de grâce | — (lit toutes les tables du compte) | `me/export`, `me/deletion-request` | — | `my-data` | notifie les mini-apps (`user.data_deletion_requested`) |
| `privacy` | Réglages de confidentialité, blocages | `user_blocks` (+ colonnes de `users`) | `me/privacy`, `blocks` | — | `privacy` | — |
| `consents` | Journal central des consentements (append-only) : `health`, `marketing`, `location_sharing`, `ai_processing`, `analytics`, `translation` | `user_consents` (+ `health_consents`, `marketing_consents` historiques) | `me/consents` | — | `consents` | — |
| `flags` | Feature flags par pays et par rôle ; flags réglementés avec `confirmRegulated` ; garde `@RequireFlag` | `feature_flags` | `config`, `admin/flags` | rôle `admin` | `admin/flags` | — |
| `admin` | Back-office : audit, gouvernance (comptes, rôles plateforme), double validation, analytique | `admin_approvals` (+ index 0074) | `admin`, `admin/approvals`, `admin/analytics` | rôles plateforme `admin` / `moderator` ; 4 opérations sensibles en double validation | `admin/*` (index, approvals, analytics, audit, governance, flags, kyc, ledger, moderation, disputes, games, health, ai, miniapps, mobility) ; **en cours** | notification de décision au demandeur |
| `moderation` | Signalements, file de modération, registre de cibles (message, publication, produit…) | `reports` | `reports`, `me/reports`, `admin/moderation` | rôle `admin` / `moderator` | `my-reports`, `admin/moderation` | `message.updated` après action sur un message |
| `kyc` | Niveaux KYC, dossiers, revue humaine, code PIN de paiement, limites ; documents chiffrés | `kyc_profiles`, `kyc_submissions`, `payment_pins` | `me/kyc`, `me/payment-pin`, `admin/kyc` | — (utilisé avec le wallet sandbox) | `kyc`, `wallet/pin`, `admin/kyc` | — |
| `notifications` | Centre de notifications, préférences, jetons push (Expo, port `PushGateway`) | `push_tokens`, `notifications`, `notification_preferences` | `notifications`, `me/push-tokens`, `me/notification-preferences` | — | `notifications`, `notification-preferences` | `notification.new` |

## 3. Médias, messagerie, appels, social

| Module | Rôle | Tables | Routes | Flag / perm. | Mobile | Temps réel / webhooks |
|---|---|---|---|---|---|---|
| `media` | Téléversement signé, validation MIME (sniff), miniatures, contrôle d'accès par finalité, chiffrement des fichiers sensibles | `media_assets` (+ `milestone_files`, `lesson_files`, `product_files`, `org_gallery_files` pour les liaisons) | `media`, `public/media`, `me/avatar` | quotas `MEDIA_*` | `media` (client) | — |
| `messaging` | Conversations, groupes, communautés, messages, réactions, accusés, brouillons, programmés, favoris, sondages, présence, recherche, traduction | `conversations`, `conversation_members`, `messages`, `message_hidden`, `message_reactions`, `message_favorites`, `scheduled_messages`, `conversation_drafts`, `message_polls`, `message_poll_options`, `message_poll_votes`, `communities`, `community_bans`, `message_translations` | `conversations`, `messages`, `me`, `presence`, `communities`, `conversations/:id/community` | flag `messaging` | `(tabs)/messages`, `messages/[conversationId]`, `group/[conversationId]`, `chat-info/[conversationId]`, `scheduled`, `favorites` | `message.new`, `message.updated`, `message.reaction`, `message.poll`, `receipt.updated`, `conversation.updated`, `conversation.member_added`, `conversation.member_removed`, `draft.updated`, `presence.updated`, `typing` |
| `calls` | Appels 1-1 et lives : signalisation relayée (jamais stockée) | `calls`, `lives`, `live_viewers`, `live_messages` | `calls`, `lives`, `conversations` (appels), `me/calls` | flags `calls`, `live` | `calls/[id]`, `lives/[id]`, `live/preview` | `call.ringing`, `call.updated`, `call.signal`, `live.viewers`, `live.ended`, `live.message`, `live.signal` |
| `social` | Abonnements, publications, fil, réactions, commentaires | `follows`, `posts`, `post_media`, `post_reactions`, `post_comments` | `feed`, `posts`, `comments`, `users/:id/...` | flag `social` | `(tabs)/index`, `compose`, `post/[postId]`, `user/[userId]/*`, `u/[handle]` | — |
| `stories` | Stories éphémères, vues | `stories`, `story_views` | `stories`, `me/stories` | flag `social.stories` | `story/new`, `story/[userId]` | — |
| `creator` | Outils créateur : signets, hashtags, statistiques, boosts (test), pourboires | `post_bookmarks`, `post_hashtags`, `post_impressions`, `post_impression_viewers`, `post_boosts` | `me/bookmarks`, `hashtags`, `me/creator`, `admin/boosts` | flags `social`, `wallet.sandbox` | `creator`, `bookmarks`, `hashtag/[tag]` | — |
| `search` | Recherche universelle, historique, recherche en langage naturel | `search_history`, `search_settings` | `search`, `me/search-history` | flag `search` | `search`, `(tabs)/maps` | — |
| `places` | Lieux et recherche de proximité (boîte englobante + haversine, ADR-019) | colonnes de `organizations` | `places`, `orgs/:orgId/location` | flag `search` ; perm. `org.profile.edit` | `(tabs)/maps`, `seller/[orgId]/location` | — |
| `wishlist` | Liste de souhaits | `wishlist_items` | `me/wishlist` | flag `commerce` | `wishlist` | — |

## 4. Organisations, commerce, livraison, finances

| Module | Rôle | Tables | Routes | Flag / perm. | Mobile | Temps réel / webhooks |
|---|---|---|---|---|---|---|
| `orgs` | Organisations, membres, rôles, vitrine, mises à jour, avis et questions | `organizations`, `org_members`, `org_updates`, `org_reviews`, `org_questions` | `orgs`, `me`, `public/orgs`, `orgs/:orgId/updates` | perm. `org.members.*`, `org.profile.edit`, `orders.manage` (questions) | `seller/*`, `store/[slug]`, `seller/[orgId]/{vitrine,updates,questions,reviews}` | webhook `org.question_asked` |
| `business` | Gestion d'entreprise : fournisseurs, bons de commande, dépenses, rentabilité | `suppliers`, `purchase_orders`, `purchase_order_lines`, `expenses`, `business_documents` | `orgs/:orgId/...` | flag `commerce` ; perm. `finance.view`, `finance.manage`, `inventory.manage` | `seller/[orgId]/{purchasing,expenses,profitability,documents}` | — |
| `catalog` | Produits, variantes, stock, vitrine publique | `product_categories`, `products`, `product_media`, `product_variants`, `stock_movements` | `products`, `public/orgs`, `orgs/:orgId/products`, `orgs/:orgId/variants` | flag `commerce` ; perm. `catalog.manage`, `inventory.manage` | `shop`, `product/[productId]`, `product/compare`, `seller/[orgId]/{products,stock}` | — |
| `commerce` | Seulement le port `CatalogPort` (catalogue ↔ commandes) | — | — | — | — | — |
| `cart` | Panier (verrou consultatif par utilisateur) | `cart_items` | `cart` | flag `commerce` | `cart` | — |
| `orders` | Commandes multi-vendeurs (paiement à la livraison), coupons, retours et remboursements enregistrés | `orders`, `order_items`, `order_events`, `coupons`, `coupon_redemptions`, `order_returns`, `order_return_events` | `orders`, `payment-methods`, `returns`, `orgs/:orgId/...`, `admin` (litiges) | flag `commerce` ; perm. `orders.view`, `orders.manage` | `checkout`, `orders/*`, `seller/[orgId]/{orders,coupons,returns}`, `admin/disputes` | webhooks `order.created`, `order.status_changed`, `order.return_requested` |
| `reviews` | Avis vérifiés produits et organisations | `reviews` | `reviews`, `products/:id/reviews`, `orgs/:orgId/reviews` | flag `commerce` ; perm. `catalog.manage`, `orders.*` | `review/new`, `seller/[orgId]/reviews` | — |
| `promotions` | Promotions produits | `product_promotions` | `promotions`, `orgs/:orgId/promotions` | flag `commerce` ; perm. `catalog.manage` | `seller/[orgId]/promotions` | — |
| `loyalty` | Fidélité, consentement marketing, campagnes | `loyalty_programs`, `loyalty_movements`, `marketing_consents`, `marketing_campaigns` | `me`, `orgs/:orgId` | flag `commerce` ; perm. `orders.manage` | `loyalty`, `seller/[orgId]/{loyalty,campaigns,customers}` | — |
| `pos` | Caisse : ventes, annulations, sessions de caisse | `pos_sales`, `pos_shifts` | `orgs/:orgId/pos` | flag `commerce` ; perm. `orders.manage` | `seller/[orgId]/{pos,sales}` | webhooks `pos.sale_created`, `pos.sale_voided` ; métrique `caselind_pos_operations_total` |
| `inventory-ops` | Lots, péremption, inventaires physiques | `stock_batches`, `stock_batch_alerts`, `inventory_counts`, `inventory_count_lines` | `orgs/:orgId/...` | flag `commerce` ; perm. `inventory.manage` | `seller/[orgId]/{batches,inventory}` | — |
| `digital` | Produits numériques (fichiers livrés après commande) | `product_files` | `me/downloads`, `orgs/:orgId/products/...` | flag `commerce` ; perm. `catalog.manage` | `downloads`, `seller/[orgId]/product-files` | — |
| `delivery` | Zones, livraisons, suivi, preuve de livraison | `delivery_zones`, `deliveries`, `delivery_events`, `delivery_proofs` | `orgs/:orgId/...`, `me/deliveries`, `deliveries/:id/proof` | flag `commerce` ; perm. `orders.view`, `orders.manage` | `deliveries/*`, `seller/[orgId]/zones` | `delivery.updated`, `delivery.location` |
| `courier` | Courses de coursier à la demande | `courier_requests` | `courier-requests`, `courier` | flag `mobility` | `courier/*` | `delivery.updated`, `delivery.location` |
| `payments-qr` | QR marchand signé (HMAC), paiement par QR | `payment_qr_codes` | `orgs/:orgId/payment-qr`, `wallet/qr` | flag `wallet.sandbox` | `pay`, `scan`, `seller/[orgId]/qr` | — |
| `wallet` | Ports uniquement (`LedgerPort`, `KycPort`, `PinPort`) | — | — | — | — | — |
| `ledger` | Ledger en partie double append-only, comptes, virements P2P (sandbox) | `ledger_accounts`, `journal_entries`, `postings` | `wallet`, `orgs/:orgId/wallet`, `admin/ledger` | flag `wallet.sandbox` ; perm. `finance.view` | `wallet`, `wallet/{send,receive,topup,pin,cards,manage}`, `seller/[orgId]/wallet`, `admin/ledger` | — |
| `wallet-finance` | Demandes d'argent, partage de frais, paiements programmés, épargne, alertes d'anomalies | `split_bills`, `split_bill_shares`, `money_requests`, `wallet_alerts`, `scheduled_payments`, `scheduled_payment_runs`, `savings_goals`, `savings_movements` | `wallet`, `admin/wallet-alerts` | flag `wallet.sandbox` | `wallet/{requests,split,scheduled,savings,alerts,finance}` | — |
| `finance` | Budgets personnels | `budgets` | `finance` | flag `wallet.sandbox` | `wallet/finance` | — |

## 5. Services, mobilité, verticales

| Module | Rôle | Tables | Routes | Flag / perm. | Mobile | Temps réel / webhooks |
|---|---|---|---|---|---|---|
| `services` | Services de proximité et réservations | `service_categories`, `service_providers`, `service_offers`, `service_offer_media`, `service_availability_rules`, `service_availability_exceptions`, `service_bookings`, `service_booking_events`, `service_reviews` | `services`, `bookings`, `me/services`, `me/bookings`, `orgs/:orgId/services` | flag `services` ; perm. `catalog.manage` | `services/*`, `bookings/*`, `provider/[scope]/*`, `seller/[orgId]/services` | — |
| `mobility` | Taxi et moto-taxi : chauffeurs, courses, notes, messages rapides, contacts de confiance, lieux favoris, admin | `mobility_drivers`, `mobility_rides`, `mobility_ride_ratings`, `mobility_ride_messages`, `mobility_trusted_contacts`, `mobility_favorite_places` | `rides`, `me/rides`, `mobility/driver`, `me/trusted-contacts`, `me/favorite-places`, `admin/mobility` | flag `mobility` | `rides/*` (index, driver, history, places, contacts, [rideId]), `admin/mobility`, `(tabs)/maps` (carte à tuiles) ; **en cours** | `ride.updated`, `ride.location`, `ride.message` |
| `mobility-extra` | Covoiturage, location de véhicules, dépannage routier | `carpool_trips`, `carpool_bookings`, `carpool_ratings`, `rental_vehicles`, `rental_vehicle_media`, `rental_bookings`, `roadside_requests` | `carpool`, `rentals`, `rental-bookings`, `orgs/:orgId/rentals`, `roadside` | flag `mobility` ; perm. `catalog.manage` | `carpool/*`, `rentals/*`, `roadside/*`, `seller/[orgId]/rentals` | — (**en cours**, dossier non commité) |
| `listings` | Petites annonces, offres, visites, alertes | `listings`, `listing_media`, `listing_offers`, `listing_visits`, `listing_alerts` | `listings`, `me/listing-alerts`, `me/offers`, `me/visits` | flag `listings` | `listings/*` | — |
| `jobs` | Offres d'emploi, profils, candidatures, entretiens, alertes | `job_postings`, `job_profiles`, `job_applications`, `job_alerts`, `job_interviews` | `jobs`, `me/job-*`, `orgs/:orgId/...` | flag `jobs` ; perm. `hr.manage` | `jobs/*`, `work`, `seller/[orgId]/jobs` | — |
| `freelance` | Missions, propositions, contrats à jalons, litiges, profils | `missions`, `mission_proposals`, `freelance_contracts`, `contract_milestones`, `freelance_reviews`, `contract_disputes`, `freelance_profiles` | `missions`, `proposals`, `freelancers`, `freelance-contracts`, `me/freelance-*`, `admin/freelance` | flag `freelance` | `freelance/*` | — |
| `education` | Cours, leçons, quiz, examens, certificats vérifiables | `courses`, `course_lessons`, `course_questions`, `course_enrollments`, `lesson_progress`, `quiz_attempts`, `certificates`, `course_reviews`, `exam_sessions` | `courses`, `me/courses`, `me/certificates`, `public/certificates` | flag `education` | `education/*` | — |
| `school` | Gestion scolaire : classes, inscriptions, frais, tuteurs, bourses | `school_classes`, `school_enrollments`, `school_lessons`, `school_announcements`, `school_fees`, `school_fee_payments`, `school_guardians`, `school_scholarships` | `orgs/:orgId/school`, `me/school`, `schools` | flag `school` ; perm. `org.members.manage` | `school/*`, `seller/[orgId]/school` | — |
| `health` (dossier) | Santé personnelle chiffrée, professionnels, rendez-vous, partages, résultats, rappels | `health_consents`, `health_entries`, `health_reminders`, `health_doses`, `health_professionals`, `health_appointments`, `health_shares`, `health_access_log`, `health_prescriptions`, `health_availability`, `health_results` | `me/health`, `health`, `health-professionals`, `admin/health` | flag `health` (réglementé) | `health/*`, `admin/health` | — |
| `games` | Quiz, tournois (sans mise d'argent) | `game_questions`, `game_sessions`, `game_tournaments` | `games/quiz`, `admin/games/*` | flag `games` | `games/*`, `admin/games` | — |
| `hr` | RH : dossiers employés, congés, plannings, registre de paie | `employee_profiles`, `leave_requests`, `work_shifts`, `salary_register` | `orgs/:orgId/hr`, `me/hr` | perm. `hr.manage`, `payroll.manage` | `seller/[orgId]/hr` | — |

## 6. Plateforme ouverte, IA, intégrations

| Module | Rôle | Tables | Routes | Flag / perm. | Mobile | Temps réel / webhooks |
|---|---|---|---|---|---|---|
| `miniapps` | Mini-apps : registre, OAuth + PKCE, jetons opaques, `miniapp-api`, versions, quotas par application, statistiques d'usage, journal d'accès, relevés de revenus indicatifs, webhooks et notifications d'application | `miniapps`, `miniapp_grants`, `miniapp_auth_codes`, `miniapp_tokens`, `miniapp_payment_requests`, `miniapp_versions`, `miniapp_usage_daily`, `miniapp_access_log`, `miniapp_revenue_statements`, `miniapp_webhooks`, `miniapp_webhook_deliveries`, `miniapp_notify_daily` | `miniapps`, `oauth`, `miniapp-api`, `me/miniapps`, `orgs/:orgId/miniapps`, `admin/miniapps` | flag `miniapps` ; perm. `org.admins.manage` ; rôles plateforme `admin` / `moderator` pour la revue | `miniapps/{index,activity,developer/*}`, `admin/miniapps` ; **phase 2 en cours** | événements `authorization.granted`, `authorization.revoked`, `payment.confirmed`, `payment.declined`, `user.data_deletion_requested` |
| `webhooks` | Webhooks d'organisation : signature HMAC, anti-SSRF, reprises, journal | `org_webhooks`, `org_webhook_deliveries` | `orgs/:orgId/webhooks` | perm. `org.admins.manage` | `seller/[orgId]/webhooks` | émetteur des événements d'organisation ; métrique `caselind_webhook_deliveries_total` |
| `ai` | Assistant IA multi-fournisseurs (Gemini, compatibles OpenAI), traduction de messages, actions IA | `ai_model_settings`, `ai_user_settings`, `ai_conversations`, `ai_messages`, `ai_usage_daily`, `ai_actions`, `ai_action_log` | `ai`, `me/ai-settings`, `messages` (traduction), `orgs/:orgId/ai`, `admin/ai` | flag `ai` ; perm. `catalog.manage` (aide vendeur) | `ai/*`, `admin/ai` | — |

## 7. Permissions d'organisation (`orgs/org-permissions.ts`)

Permissions : `org.view`, `org.profile.edit`, `org.members.view`, `org.members.manage`, `org.admins.manage`, `org.delete`, `catalog.manage`, `orders.view`, `orders.manage`, `inventory.manage`, `finance.view`, `finance.manage`, `hr.manage`, `payroll.manage`, `support.inbox`, `delivery.tasks`.

| Rôle | Permissions |
|---|---|
| `owner` | toutes |
| `admin` | toutes sauf `org.admins.manage` et `org.delete` |
| `manager` | `org.view`, `org.members.view`, `catalog.manage`, `orders.view`, `orders.manage`, `inventory.manage`, `support.inbox`, `delivery.tasks` |
| `finance` | `org.view`, `finance.view`, `finance.manage`, `payroll.manage`, `orders.view` |
| `stock` | `org.view`, `inventory.manage` |
| `sales` | `org.view`, `catalog.manage`, `orders.view`, `orders.manage` |
| `hr` | `org.view`, `org.members.view`, `hr.manage`, `payroll.manage` |
| `support` | `org.view`, `support.inbox`, `orders.view` |
| `delivery` | `org.view`, `delivery.tasks` |
| `employee` | `org.view` |

## 8. Drapeaux de fonctionnalité utilisés par les contrôleurs

`ai`, `calls`, `commerce`, `education`, `freelance`, `games`, `health`, `jobs`, `listings`, `live`, `messaging`, `miniapps`, `mobility`, `school`, `search`, `services`, `social`, `social.stories`, `wallet.sandbox` (plus `betting` dans les tests de la garde). Les flags réglementés sont coupés par défaut ; la liste et l'état par défaut se lisent dans `0002_platform_controls.sql` et `flags.service.ts` (à vérifier pour les flags ajoutés après la migration 0002).

## 9. Points à vérifier / en cours

- Nom exact de la table de suivi des migrations (non relevé).
- Écrans mobiles de `social` et `stories` dans les onglets : relevés par nom de fichier, non ouverts.
- `apps/web` existe (15 fichiers suivis : Vite, `App.tsx`, `sw.js`, manifeste) ; son périmètre fonctionnel n'est pas documenté ici (à vérifier ; le web reste conditionné à la validation du mobile).
- En cours au moment du relevé : mobilité (`mobility`, `mobility-extra`), mini-apps phase 2 (`miniapps` : versions, quotas, webhooks, revenus), administration (`admin` : analytique, double validation), correctifs de revue (migrations 0097 et 0100).
