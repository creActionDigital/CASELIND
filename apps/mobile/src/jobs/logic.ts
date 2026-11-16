import { APPLICATION_TRANSITIONS, isTerminalApplication, type ApplicationStatus, type InterviewStatus, type ContractType, type Job, type OrgRole } from '@caselind/contracts';
import type { MessageKey } from '../i18n';
import { formatMoney } from '../shop/format';

export const CONTRACT_TYPES: ContractType[] = ['full_time', 'part_time', 'contract', 'internship', 'temporary'];
export const contractKey = (c: ContractType): MessageKey => `jobs.contract.${c}` as MessageKey;
export const statusKey = (s: ApplicationStatus): MessageKey => `jobs.status.${s}` as MessageKey;

/** Statuts que le recruteur peut poser depuis l'état courant (le serveur reste la référence). */
export type RecruiterStatus = Exclude<ApplicationStatus, 'submitted' | 'withdrawn'>;
export const nextStatuses = (s: ApplicationStatus): RecruiterStatus[] => APPLICATION_TRANSITIONS[s] as RecruiterStatus[];

/** Une candidature décidée ne peut plus être retirée par le candidat. */
export const canWithdraw = (s: ApplicationStatus): boolean => !isTerminalApplication(s);

/** Miroir de `hr.manage` (owner, admin, hr) pour n'afficher l'espace recruteur qu'à ces rôles. */
export const canManageJobs = (role: OrgRole | undefined): boolean => role === 'owner' || role === 'admin' || role === 'hr';

export function salaryLabel(j: Pick<Job, 'salary'>, locale: string): string | null {
  if (!j.salary) return null;
  const { minMinor, maxMinor, currency } = j.salary;
  if (minMinor !== null && maxMinor !== null) return `${formatMoney(minMinor, currency, locale)} – ${formatMoney(maxMinor, currency, locale)}`;
  return formatMoney((minMinor ?? maxMinor) as number, currency, locale);
}

export const interviewStatusKey = (s: InterviewStatus): MessageKey => `jobs.interview.status.${s}` as MessageKey;
/** Un entretien se propose tant que la candidature n'est pas décidée. */
export const canPropose = (s: ApplicationStatus): boolean => !isTerminalApplication(s);
/** "AAAA-MM-JJ HH:MM" (heure locale) vers un instant UTC ISO ; null si invalide. */
export function parseLocalDateTime(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h ? date.toISOString() : null;
}
