import type { ChildFee, ClassMember } from '@caselind/contracts';

/** « @maman_k » → « maman_k » ; vide si la saisie n'est pas un identifiant plausible (1 à 40 signes, sans espace). */
export function normalizeHandle(text: string): string {
  const h = text.trim().replace(/^@/, '');
  return h.length >= 1 && h.length <= 40 && !/\s/.test(h) ? h : '';
}

/** Élèves inscrits (rôle élève) de toutes les classes, sans doublon, triés par nom : le choix de l'écran « Parents ». */
export function uniqueStudents(lists: readonly (readonly ClassMember[])[]): ClassMember[] {
  const seen = new Map<string, ClassMember>();
  for (const list of lists) for (const m of list) if (m.role === 'student' && !seen.has(m.handle)) seen.set(m.handle, m);
  return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Prêt à envoyer : un élève choisi et un identifiant de parent valide. */
export function canLink(studentHandle: string | null, guardianText: string): boolean {
  return studentHandle !== null && normalizeHandle(guardianText) !== '';
}

/** Statut des frais d'un enfant : combien sont réglés, combien restent à payer. */
export function feeSummary(fees: readonly Pick<ChildFee, 'paid'>[]): { paid: number; unpaid: number } {
  const paid = fees.filter((f) => f.paid).length;
  return { paid, unpaid: fees.length - paid };
}
