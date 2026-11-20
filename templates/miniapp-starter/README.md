# CASELIND mini-app starter

Copy this folder, then:

1. Edit `manifest.json` (what you read, why, for how long, costs, terms). `npm run validate` checks it with the same rules as the platform.
2. Register the app in the developer portal (redirect URI: `${PUBLIC_URL}/callback`, https, exact match), paste the manifest, submit.
3. Create the webhook (portal or `POST /v1/miniapps/{id}/webhook`) and copy its secret once into `WEBHOOK_SECRET`.
4. Set `CASELIND_API`, `CLIENT_ID`, `CLIENT_SECRET`, `PUBLIC_URL`, `WEBHOOK_SECRET` and run `npm run dev`.

`src/index.ts` shows the authorization URL, the callback, a profile call, a PIN payment and a verified webhook handler.
Full guide: `docs/DEVELOPERS.md` (submission checklist, threat model, what the platform guarantees).
