/** Logique pure d'un appel WebRTC : état de la connexion, minuteur, durée affichée. Sans React ni réseau (testable seule). */
export type CallPhase = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

/** Nouvel état d'après l'état ICE du navigateur. `disconnected` n'est une reconnexion que si l'appel était déjà établi. */
export function phaseFromIce(prev: CallPhase, ice: string): CallPhase {
  switch (ice) {
    case 'connected':
    case 'completed':
      return 'connected';
    case 'disconnected':
      return prev === 'connected' || prev === 'reconnecting' ? 'reconnecting' : 'connecting';
    case 'failed':
      return 'failed';
    case 'closed':
      return 'closed';
    default:
      return prev === 'connected' || prev === 'reconnecting' ? prev : 'connecting';
  }
}

/** Seul l'appelant crée l'offre (au moment où l'appel devient actif) ; l'appelé répond. */
export const shouldCreateOffer = (isCaller: boolean, status: string) => isCaller && status === 'active';

/** Relance ICE : seulement l'appelant, seulement après un échec, au plus `max` fois. */
export const shouldRestartIce = (isCaller: boolean, phase: CallPhase, attempts: number, max = 2) => isCaller && phase === 'failed' && attempts < max;

/** 65 -> « 01:05 », 3725 -> « 1:02:05 ». */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type Signal = { type: 'offer' | 'answer' | 'ice'; payload: string };

/** Les candidats ICE reçus avant la description distante sont gardés puis appliqués ensemble. */
export function splitSignals(queue: Signal[], hasRemote: boolean): { now: Signal[]; later: Signal[] } {
  if (hasRemote) return { now: queue, later: [] };
  return { now: queue.filter((s) => s.type !== 'ice'), later: queue.filter((s) => s.type === 'ice') };
}
