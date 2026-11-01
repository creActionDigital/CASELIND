# Preuves, niveaux de confiance et lacunes — référence WeChat/Weixin

Dernière mise à jour : 2026-11-01

## 1. Méthode réellement appliquée

| Outil prévu | État vérifié le 2026-11-01 | Conséquence |
|---|---|---|
| REA (`reverse-engineer-anything`) | Skill présent (`~/.claude/skills/reverse-engineer-anything/SKILL.md`). **Aucun serveur MCP `rea` enregistré** (seul `playwright` est déclaré dans `~/.claude.json`), **aucun CLI `rea`** dans le PATH. | REA n'a pas été exécuté. Par ailleurs, REA sert à analyser des artefacts livrés (binaires, APK, ASAR). Décompiler l'application WeChat propriétaire sortirait du cadre autorisé (pas de licence, risque de propriété intellectuelle). La cartographie repose donc sur les sources publiques. |
| replica-skill | Introuvable dans `~/.claude` | Non utilisé |
| Agent-Reach | Introuvable dans `~/.claude` | Non utilisé ; recherche web standard à la place |
| Recherche web | Disponible | 3 recherches ciblées effectuées (voir §3) |
| Navigateur / Playwright | MCP `playwright` disponible | Pas utilisé pour WeChat : l'application est mobile et exige un compte. Aucune observation d'écrans privés. |

**Aucun écran WeChat n'a été observé directement** dans cette session. Aucun compte n'a été utilisé et aucune protection n'a été contournée.

## 2. Niveaux de confiance utilisés dans la cartographie

| Code | Signification |
|---|---|
| **V** | Vérifié dans cette session sur une documentation officielle Tencent/Weixin (URL citée) |
| **DP** | Documenté publiquement par une source tierce consultée dans cette session (URL citée), non confirmé officiellement |
| **CG** | Connaissance générale largement documentée, **non revérifiée dans cette session** : à confirmer avant d'en faire un critère strict |
| **D** | Déduit (mécanisme probable, non documenté) |
| **I** | Inconnu / non observable sans compte ni région |

## 3. Sources consultées (2026-11-01)

| # | Source | Type | Apport |
|---|---|---|---|
| S1 | https://www.tencent.com/products/weixin-wechat/ | Officielle (Tencent) | Fonctions cœur : Moments, Official Accounts, Weixin Pay, Mini Programs, Search, Mini Games, Channels ; plus d'un milliard de transactions commerciales quotidiennes revendiquées |
| S2 | https://developers.weixin.qq.com/miniprogram/en/dev/api/open-api/login/wx.login.html | Officielle (dev) | `wx.login` donne un code temporaire (5 min, usage unique), échangé côté serveur (`code2Session`) contre openid/unionid/session_key, et la session_key ne doit pas être renvoyée au client |
| S3 | https://developers.weixin.qq.com/minigame/en/dev/tutorial/open-ability/authorize.html | Officielle (dev) | Autorisations par « scope » (userInfo, userLocation, record…), demandées au premier usage et révocables, avec échec direct après refus |
| S4 | https://developers.weixin.qq.com/miniprogram/en/dev/api/open-api/authorize/wx.authorizeForMiniProgram.html | Officielle (dev) | Scopes limités pour les plugins |
| S5 | https://blog.omnichat.ai/wechat-official-account/ | Tierce | Comptes officiels : types Subscription et Service (la taxonomie varie selon les sources) |
| S6 | https://ltl-school.com/wechat-pay-for-foreigners/ , https://wise.com/gb/blog/wechat-pay-for-foreigners , https://www.trip.com/guide/phone/wechat-pay-for-foreigners.html | Tierces | Cartes étrangères acceptées pour les paiements QR et marchands ; transferts P2P et red packets restreints ; **plafonds contradictoires selon les sources** |

## 4. Ce que ces preuves établissent pour CASELIND

1. **SSO avec code éphémère (S2)** : un code court, à usage unique, échangé côté serveur, sans que le secret de session ne soit exposé au client. Ce modèle est repris pour l'**authentification des mini-apps CASELIND** (backlog MINI-02). Implémentation propre, sans code WeChat.
2. **Permissions par scope, consentement au premier usage, révocables (S3/S4)** : reprises pour les mini-apps et les agents IA. C'est conforme au cahier des charges, §22-23.
3. **Restrictions des paiements selon le statut de l'utilisateur (S6)** : les capacités financières dépendent du pays, du KYC et du moyen de paiement. Le wallet CASELIND doit appliquer des **limites et capacités par niveau KYC et par pays**, sans plafonds codés en dur. Les montants des sources tierces étant contradictoires, aucune valeur n'est reprise.

## 5. Lacunes connues (à combler ou à accepter)

| Lacune | Impact | Action proposée |
|---|---|---|
| Écrans exacts de WeChat (versions Chine / international), variantes régionales | Moyen : l'inventaire d'écrans CASELIND est conçu à partir des parcours, pas copié | Accepté. CASELIND a sa propre identité. Revue possible via des captures publiques fournies par le propriétaire. |
| Fonctions réservées à la Chine continentale (services publics, santé, transport via Weixin Pay) | Faible pour CASELIND (marchés cibles non chinois) | Marquées **I/CG régional**. Les équivalents CASELIND dépendent des partenaires locaux. |
| Règles anti-fraude internes de Weixin Pay | Non observables | Concevoir les contrôles CASELIND d'après les bonnes pratiques (limites, vélocité, double validation), pas d'après WeChat |
| Algorithmes de recommandation Channels / Moments | Non observables | Commencer par un fil chronologique et des abonnements, avec un classement explicable plus tard |
| Chiffrement des messages WeChat | Non vérifié | Ne pas annoncer d'E2E dans CASELIND avant implémentation vérifiée (CDC §29) |
| Marchés de lancement CASELIND (pays, devises, partenaires) | **Bloquant pour les paiements réels** | Question ouverte au propriétaire (voir `docs/BACKLOG.md` › Décisions) |
