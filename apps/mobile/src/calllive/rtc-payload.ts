import type { CandidateLike, IceServer, SdpLike } from './rtc-types';

/** Serveur STUN public par défaut si GET /calls/ice-servers est injoignable. */
export const FALLBACK_ICE: IceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];

export const sdpPayload = (d: SdpLike) => JSON.stringify({ type: d.type, sdp: d.sdp });
export const candidatePayload = (c: CandidateLike) =>
  JSON.stringify(c.toJSON ? c.toJSON() : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });
