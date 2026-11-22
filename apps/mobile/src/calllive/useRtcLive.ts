import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '../realtime/realtime-context';
import { fetchIceServers, sendLiveSignal } from './api';
import { phaseFromIce, type CallPhase } from './call-machine';
import { candidatePayload, FALLBACK_ICE, sdpPayload } from './rtc-payload';
import { rtc } from './rtc';
import type { CandidateLike, PeerLike, SdpLike, StreamLike } from './rtc-types';

/** Un direct sans serveur média : l'hôte ouvre une liaison WebRTC directe par spectateur (maillage). Au-delà, le spectateur voit « complet ». */
export const MAX_LIVE_PEERS = 8;
const RETRY_MS = 6000;
const MAX_ATTEMPTS = 5;

export type LiveMediaError = 'denied' | 'unsupported' | 'failed' | null;
type LiveSignal = { liveId?: string; from?: string; type?: 'offer' | 'answer' | 'ice'; payload?: string };

/**
 * Média d'un direct. Hôte : caméra et micro, une réponse WebRTC par spectateur. Spectateur : réception seule, il fait l'offre (et la
 * refait toutes les 6 s tant que l'hôte n'a pas répondu). La signalisation passe par POST /lives/:id/signal (relayée, jamais stockée).
 */
export function useRtcLive({ liveId, isHost, active }: { liveId: string; isHost: boolean; active: boolean }) {
  const { socket } = useRealtime();
  const [local, setLocal] = useState<StreamLike | null>(null);
  const [remote, setRemote] = useState<StreamLike | null>(null);
  const [phase, setPhase] = useState<CallPhase>('connecting');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState<LiveMediaError>(null);
  const localRef = useRef<StreamLike | null>(null);

  useEffect(() => {
    if (!active || !liveId) return;
    if (!rtc) {
      setError('unsupported');
      return;
    }
    const api = rtc;
    let cancelled = false;
    const peers = new Map<string, PeerLike>(); // hôte : un pair par spectateur ; spectateur : la clé « host »
    const pending = new Map<string, CandidateLike[]>();
    let chain: Promise<void> = Promise.resolve();
    let socketOff: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const closePeer = (key: string) => {
      const pc = peers.get(key);
      if (pc) {
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.ontrack = null;
        pc.close();
      }
      peers.delete(key);
      pending.delete(key);
    };
    const flush = async (key: string, pc: PeerLike) => {
      for (const c of pending.get(key) ?? []) await pc.addIceCandidate(api.candidate(c)).catch(() => undefined);
      pending.delete(key);
    };
    const iceServers = async () => {
      try {
        return (await fetchIceServers()).iceServers;
      } catch {
        return FALLBACK_ICE;
      }
    };
    const listen = (handler: (m: Required<Pick<LiveSignal, 'type' | 'payload'>> & { from: string }) => Promise<void>) => {
      if (!socket) return;
      const on = (raw: unknown) => {
        const m = raw as LiveSignal;
        if (m?.liveId !== liveId || !m.type || typeof m.payload !== 'string' || !m.from) return;
        const msg = { type: m.type, payload: m.payload, from: m.from };
        chain = chain.then(() => handler(msg)).catch(() => undefined);
      };
      socket.on('live.signal', on);
      socketOff = () => socket.off('live.signal', on);
    };

    if (isHost) {
      (async () => {
        let stream: StreamLike;
        try {
          stream = await api.getUserMedia({ audio: true, video: { facingMode: 'user' } });
        } catch {
          try {
            stream = await api.getUserMedia({ audio: true, video: false });
          } catch {
            if (!cancelled) setError('denied');
            return;
          }
        }
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        localRef.current = stream;
        setLocal(stream);
        setCamOn(stream.getVideoTracks().length > 0);
        const servers = await iceServers();
        listen(async ({ type, payload, from }) => {
          if (type === 'offer') {
            if (!peers.has(from) && peers.size >= MAX_LIVE_PEERS) return; // direct complet : le spectateur réessaiera puis verra « échec »
            closePeer(from);
            const pc = api.createPeer({ iceServers: servers });
            peers.set(from, pc);
            stream.getTracks().forEach((t) => pc.addTrack(t, stream));
            pc.onicecandidate = (e) => {
              if (e.candidate) void sendLiveSignal(liveId, 'ice', candidatePayload(e.candidate), from).catch(() => undefined);
            };
            pc.oniceconnectionstatechange = () => {
              if (['failed', 'closed'].includes(pc.iceConnectionState) && peers.get(from) === pc) closePeer(from);
            };
            await pc.setRemoteDescription(api.description(JSON.parse(payload) as SdpLike));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendLiveSignal(liveId, 'answer', sdpPayload(answer), from);
            await flush(from, pc);
          } else if (type === 'ice') {
            const pc = peers.get(from);
            const c = JSON.parse(payload) as CandidateLike;
            if (pc?.remoteDescription) await pc.addIceCandidate(api.candidate(c)).catch(() => undefined);
            else pending.set(from, [...(pending.get(from) ?? []), c]);
          }
        });
      })();
    } else {
      let attempts = 0;
      let current: PeerLike | null = null;
      let currentPhase: CallPhase = 'connecting';
      const attempt = async (servers: Awaited<ReturnType<typeof iceServers>>) => {
        attempts += 1;
        if (current) closePeer('host');
        pending.delete('host');
        const pc = api.createPeer({ iceServers: servers });
        current = pc;
        peers.set('host', pc);
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
        let stream: StreamLike | null = null;
        pc.ontrack = (e) => {
          if (e.streams[0]) stream = e.streams[0];
          else {
            stream ??= api.newStream();
            stream.addTrack(e.track);
          }
          setRemote(stream);
        };
        pc.onicecandidate = (e) => {
          if (e.candidate) void sendLiveSignal(liveId, 'ice', candidatePayload(e.candidate)).catch(() => undefined);
        };
        pc.oniceconnectionstatechange = () => {
          currentPhase = phaseFromIce(currentPhase, pc.iceConnectionState);
          setPhase(currentPhase);
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendLiveSignal(liveId, 'offer', sdpPayload(offer));
      };
      (async () => {
        const servers = await iceServers();
        if (cancelled) return;
        listen(async ({ type, payload }) => {
          const pc = peers.get('host');
          if (!pc) return;
          const c = type === 'ice' ? (JSON.parse(payload) as CandidateLike) : null;
          if (type === 'answer') {
            await pc.setRemoteDescription(api.description(JSON.parse(payload) as SdpLike));
            await flush('host', pc);
          } else if (c) {
            if (pc.remoteDescription) await pc.addIceCandidate(api.candidate(c)).catch(() => undefined);
            else pending.set('host', [...(pending.get('host') ?? []), c]);
          }
        });
        await attempt(servers).catch(() => undefined);
        timer = setInterval(() => {
          if (cancelled || currentPhase === 'connected') return;
          if (attempts >= MAX_ATTEMPTS) {
            setError('failed');
            if (timer) clearInterval(timer);
            return;
          }
          void attempt(servers).catch(() => undefined);
        }, RETRY_MS);
      })();
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      socketOff?.();
      for (const key of [...peers.keys()]) closePeer(key);
      localRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
      setLocal(null);
      setRemote(null);
      setPhase('connecting');
      setError(null);
    };
  }, [active, isHost, liveId, socket]);

  const toggleMic = useCallback(() => {
    const tracks = localRef.current?.getAudioTracks() ?? [];
    const next = !(tracks[0]?.enabled ?? true);
    tracks.forEach((t) => (t.enabled = next));
    setMicOn(next);
  }, []);
  const toggleCam = useCallback(() => {
    const tracks = localRef.current?.getVideoTracks() ?? [];
    if (tracks.length === 0) return;
    const next = !tracks[0]!.enabled;
    tracks.forEach((t) => (t.enabled = next));
    setCamOn(next);
  }, []);

  return { local, remote, phase, micOn, camOn, error, toggleMic, toggleCam };
}
