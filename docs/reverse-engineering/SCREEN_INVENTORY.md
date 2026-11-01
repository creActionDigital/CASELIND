# Inventaire des écrans CASELIND (mobile d'abord)

Dernière mise à jour : 2026-11-01

Cet inventaire est **dérivé des parcours** de la cartographie ([WECHAT_FUNCTIONAL_MAP.md](WECHAT_FUNCTIONAL_MAP.md)) et du cahier des charges. Il ne reproduit pas les écrans de WeChat, qui n'ont pas été observés directement (voir [EVIDENCE_AND_GAPS.md](EVIDENCE_AND_GAPS.md)). Chaque écran doit gérer cinq états : **chargement, contenu, vide, erreur (réseau / serveur), accès refusé**.

## Structure de navigation (exigence fonctionnelle)

```
RootStack
├── AuthStack (non connecté)
│   Onboarding · LanguagePicker · SignUp · OtpVerify · SignIn · ForgotPassword · ResetPassword
└── AppShell (connecté)
    ├── Header global : Logo CASELIND (gauche) · Search · WalletChip (solde + devise) · CartButton · AccountMenu
    ├── BottomTabs (fixes)
    │   1. Accueil     → HomeFeed (StoriesBar en haut du flux)
    │   2. Maps        → MapExplore
    │   3. + Publier   → PublishSheet (post, story, vidéo, produit, live, annonce)
    │   4. Messagerie  → ChatList
    │   5. Plus        → More (mini-apps, jeux, trading, paris*, finance, santé, éducation, voyages, services…)
    └── Écrans empilés (ci-dessous)
```

\*Paris : affiché seulement si le feature flag pays l'autorise. Désactivé par défaut (CDC §21).

`AccountMenu` donne accès à : MyProfile, Settings, PrivacySettings, Sessions, SecurityLog, KycStatus, AccountSwitcher, Language, Theme, Help, SignOut.

## Inventaire par module

| Module | Écrans | Réf. carto | Priorité mobile |
|---|---|---|---|
| Auth | Onboarding, LanguagePicker, SignUp, OtpVerify, SignIn, ForgotPassword, ResetPassword, TwoFactor | A-01…A-05, A-13 | P0 |
| Compte | MyProfile, EditProfile, MyQr, Settings, PrivacySettings, Sessions, SecurityLog, ChangeIdentifier, BlockedUsers, DeleteAccount, DataExport, AccountSwitcher, KycStatus, KycSubmit | A-06…A-16 | P0/P1 |
| Accueil / social | HomeFeed, StoriesBar, StoryViewer, StoryComposer, Composer, PostDetail, ShortVideoFeed, VideoComposer, CreatorDashboard, ReportSheet | C-01…C-12 | P0 |
| Messagerie | ChatList, ChatRoom, MediaViewer, GroupInfo, GroupMembers, Contacts, AddContact, FriendRequests, ContactLabels, ChatSearch, ShareLocation, LiveLocation, CallScreen, IncomingCall | B-01…B-17 | P0 |
| Recherche | Search, SearchResults | C-09, H-01 | P0 |
| Scanner | Scanner (QR universel) | H-10, D-03 | P1 |
| Maps | MapExplore, PlaceDetail, MapFilters | H-02 | P1 |
| Commerce | Shop, Category, ProductDetail, Cart, Checkout, OrderList, OrderDetail, OrderTracking, Reviews, Promotions, Wishlist | E-01…E-08 | P1 |
| Organisation | OrgPage, OrgAdmin, OrgMembers, OrgInbox, OrgDashboard, ProductEditor, StorefrontEditor (assisté par IA) | G-01…G-05, I-01 | P1 |
| Wallet (sandbox) | Wallet, Transactions, Receipt, Transfer, RequestMoney, ScanPay, PaymentCode, PayConfirm, PaymentPin, PaymentMethods, BillPay, Coupons, CslCoins (désactivé), Dispute | D-01…D-11 | P1 (sandbox) |
| Plus / écosystème | More, MiniAppStore, MiniAppHost, MiniAppPermissions, Games, Trading (simulation), Finance (PFM), Health, Education, Travel, Mobility, Services, Jobs, RealEstate, PublicServices | F-01…F-08, H, I | P2 |
| Notifications | NotificationCenter, NotificationPreferences | I-14 | P0 |
| IA | Assistant | I-12 | P2 |

P0 = premier lot mobile après le backend correspondant ; P1 = second lot ; P2 = ultérieur. Rien n'est supprimé du périmètre.
