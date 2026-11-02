import type { ReportTargetType } from '@caselind/contracts';

export interface ReportTarget {
  targetType: ReportTargetType;
  targetId: string;
}

type Listener = (target: ReportTarget) => void;
let listener: Listener | null = null;

/** Utilisé par `ReportSheet` (montée une fois dans le layout de l'app) pour recevoir les demandes. */
export function registerReportListener(fn: Listener | null): void {
  listener = fn;
}

/** Ouvre la feuille globale de signalement pour une cible. */
export function openReport(target: ReportTarget): void {
  listener?.(target);
}
