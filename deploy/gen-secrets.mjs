// Génère les secrets obligatoires de production (à coller dans deploy/prod.env). N'écrit rien sur le disque.
//   node deploy/gen-secrets.mjs
import { randomBytes } from 'node:crypto';

const b64 = () => randomBytes(48).toString('base64url');
console.log(`POSTGRES_PASSWORD=${randomBytes(24).toString('base64url')}`);
console.log(`JWT_ACCESS_SECRET=${b64()}`);
console.log(`OTP_PEPPER=${b64()}`);
console.log(`MEDIA_SIGNING_SECRET=${b64()}`);
console.log(`PAYMENT_QR_SECRET=${b64()}`);
console.log(`KYC_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
console.log(`TOTP_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
console.log(`HEALTH_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
console.log(`WEBHOOK_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
console.error('\nSauvegardez KYC_ENCRYPTION_KEY hors du serveur : sans elle, les pièces KYC chiffrées sont perdues.');
