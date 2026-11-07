/** Secret base32 affiché en groupes de 4 caractères (« JBSW Y3DP … »), sans espaces ni tirets d'origine. */
export function formatSecret(secret: string): string {
  const clean = rawSecret(secret);
  return clean.replace(/(.{4})/g, '$1 ').trim();
}

/** Secret brut (sans espaces), tel qu'on le copie vers une application d'authentification. */
export function rawSecret(secret: string): string {
  return secret.replace(/[\s-]/g, '').toUpperCase();
}

/** Seuls les liens otpauth:// sont ouverts par le bouton « Ouvrir l'application d'authentification ». */
export function isOtpauthUri(uri: string): boolean {
  return /^otpauth:\/\/totp\//i.test(uri);
}

/** Codes de secours, un par ligne (copie, partage). */
export function backupCodesText(codes: readonly string[]): string {
  return codes.join('\n');
}

/** Un code de secours ressemble à `abcde-fghij` : 8 caractères au moins une fois le tiret et les espaces retirés. */
export function looksLikeBackupCode(input: string): boolean {
  return input.replace(/[\s-]/g, '').length >= 8;
}
