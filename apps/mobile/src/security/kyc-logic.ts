import type { KycIdType } from '@caselind/contracts';

export const MIN_AGE = 18;
export const ID_TYPES: readonly KycIdType[] = ['national_id', 'passport', 'driver_license', 'voter_card'];

/** Accepte AAAA-MM-JJ ou JJ/MM/AAAA ; renvoie la date ISO ou null (dates impossibles comprises). */
export function parseBirthDate(input: string): string | null {
  const s = input.trim();
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s))) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Âge révolu à `now` (jour d'anniversaire compris), ou null si la date est invalide ou future. */
export function ageOn(birth: string, now: Date = new Date()): number | null {
  const iso = parseBirthDate(birth);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  const nm = now.getUTCMonth() + 1;
  if (nm < m || (nm === m && now.getUTCDate() < d)) age -= 1;
  return age < 0 ? null : age;
}

export function isAdult(birth: string, now: Date = new Date()): boolean {
  const age = ageOn(birth, now);
  return age !== null && age >= MIN_AGE;
}

export interface KycFormInput {
  legalName: string;
  birthDate: string;
  idType: KycIdType | null;
  idNumber: string;
  city: string;
  hasDocument: boolean;
  hasSelfie: boolean;
}
export type KycFieldIssue =
  | 'legalName'
  | 'birthDate'
  | 'underage'
  | 'idType'
  | 'idNumber'
  | 'city'
  | 'document'
  | 'selfie';

/** Bornes du contrat `createKycSubmissionRequestSchema` (niveau 1) + majorité ; liste les champs en erreur. */
export function validateKycLevel1(f: KycFormInput, now: Date = new Date()): Partial<Record<KycFieldIssue, true>> {
  const issues: Partial<Record<KycFieldIssue, true>> = {};
  const name = f.legalName.trim();
  if (name.length < 2 || name.length > 120) issues.legalName = true;
  const iso = parseBirthDate(f.birthDate);
  if (!iso || ageOn(iso, now) === null) issues.birthDate = true;
  else if (!isAdult(iso, now)) issues.underage = true;
  if (!f.idType) issues.idType = true;
  const num = f.idNumber.trim();
  if (num.length < 4 || num.length > 40) issues.idNumber = true;
  const city = f.city.trim();
  if (city.length < 2 || city.length > 80) issues.city = true;
  if (!f.hasDocument) issues.document = true;
  if (!f.hasSelfie) issues.selfie = true;
  return issues;
}

/** N'affiche jamais plus des 4 derniers caractères d'un numéro de pièce. */
export function maskIdNumber(value: string | null | undefined): string {
  if (!value) return '';
  return `•••• ${value.trim().slice(-4)}`;
}
