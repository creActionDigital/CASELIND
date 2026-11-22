import type { Call } from '@caselind/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '../realtime/realtime-context';
import { fetchIceServers, sendCallSignal } from './api';
import { phaseFromIce, shouldCreateOffer, shouldRestartIce, splitSignals, type CallPhase, type Signal } from './call-machine';
import { rtc } from './rtc';
import type { CandidateLike, IceServer, PeerLike, SdpLike, StreamLike } from './rtc-types';

export type MediaError = 'denied' | 'unsupported' | null;
const FALLBACK_ICE: IceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];

const sdpPayload = (d: SdpLike) => JSON.stringify({ type: d.type, sdp: d.sdp });
const candidatePayload = (c: CandidateLike) => JSON.stringify(c.toJSON ? c.toJSON() : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });

/**
 * Média d'un appel 1:1 (web : navigateur ; natif : react-native-webrtc). Démarre quand l'appel devient « actif » : l'appelant crée l'offre,
 * l'appelé répond, les candidats ICE passent par POST /calls/:id/signal (relayé en temps réel, jamais stocké). Libère micro et caméra à la fin.
 */
export function useRtcCall(call: Call | undefined, meId: string | undefined) {
  const { socket } = useRealtime();
  const callId = call?.id;
  const status = call?.status;
  const kind = call?.kind;
  const isCaller = !!call && call.callerId === meId;
  const active = status === 'active';

  const [local, setLocal] = useState<StreamLike | null>(null);
  const [remote, setRemote] = useState<StreamLike | null>(null);
  const [phase, setPhase] = useState<CallPhase>('connecting');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState<MediaError>(null);
  const [seconds, setSeconds] = useState(0);

  const pcRef = useRef<PeerLike | null>(null);
  const localRef = useRef<StreamLike | null>(null);
  const phaseRef = useRef<CallPhase>('connecting');
  const queue = useRef<Signal[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const restarts = useRef(0);
  const facing = useRef<'user' | 'environment'>('user');
  const connectedAt = useRef<number | null>(null);

  const drain = useCallback(() => {
    chain.current = chain.current.then(async () => {
      const pc = pcRef.current;
      if (!pc || !callId || !rtc) return;
      const { now, later } = splitSignals(queue.current.splice(0), !!pc.remoteDescription);
      queue.current.push(...later);
      for (const s of now) {
        try {
          if (s.type === 'ice') await pc.addIceCandidate(rtc.candidate(JSON.parse(s.payload) as CandidateLike));
          else {
            await pc.setRemoteDescription(rtc.description(JSON.parse(s.payload) as SdpLike));
            if (s.type === 'offer') {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await sendCallSignal(callId, 'answer', sdpPayload(answer));
            }
          }
        } catch {
          /* un candidat tardif ou une description rejetée ne doit pas casser l'appel */
        }
      }
      if (queue.current.length > 0 && pc.remoteDescription) drain();
    });
  }, [callId]);

  // Signaux reçus : toujours écoutés (même avant le démarrage du média), mis en file puis appliqués dans l'ordre.
  useEffect(() => {
    if (!socket || !callId) return;
    const onSignal = (raw: unknown) => {
      const m = raw as { callId?: string; type?: Signal['type']; payload?: string };
      if (m?.callId !== callId || !m.type || typeof m.payload !== 'string') return;
      queue.current.push({ type: m.type, payload: m.payload });
      drain();
    };
    socket.on('call.signal', onSignal);
    return () => {
      socket.off('call.signal', onSignal);
    };
  }, [socket, callId, drain]);

  useEffect(() => {
    if (!active || !callId || !kind) return;
    if (!rtc) {
      setError('unsupported');
      return;
    }
    const api = rtc;
    let cancelled = false;
    const stopAll = () => {
      localRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
      const pc = pcRef.current;
      if (pc) {
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.ontrack = null;
        pc.close();
      }
      pcRef.current = null;
      queue.current = [];
      setLocal(null);
      setRemote(null);
    };
    const offer = async (pc: PeerLike, iceRestart = false) => {
      const o = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await pc.setLocalDescription(o);
      await sendCallSignal(callId, 'offer', sdpPayload(o));
    };
    (async () => {
      setError(null);
      let ice = FALLBACK_ICE;
      try {
        ice = (await fetchIceServers()).iceServers;
      } catch {
        /* serveur ICE par défaut */
      }
      let stream: StreamLike;
      try {
        stream = await api.getUserMedia({ audio: true, video: kind === 'video' ? { facingMode: facing.current } : false });
      } catch {
        try {
          stream = await api.getUserMedia({ audio: true, video: false }); // caméra refusée : on garde le son
        } catch {
          if (!cancelled) setError('denied');
          return;
        }
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localRef.current = stream;
      setLocal(stream);
      setMicOn(true);
      setCamOn(stream.getVideoTracks().length > 0);
      const pc = api.createPeer({ iceServers: ice });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      let remoteStream: StreamLike | null = null;
      pc.ontrack = (e) => {
        if (e.streams[0]) remoteStream = e.streams[0];
        else {
          remoteStream ??= api.newStream();
          remoteStream.addTrack(e.track);
        }
        setRemote(remoteStream);
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) void sendCallSignal(callId, 'ice', candidatePayload(e.candidate)).catch(() => undefined);
      };
      pc.oniceconnectionstatechange = () => {
        const next = phaseFromIce(phaseRef.current, pc.iceConnectionState);
        phaseRef.current = next;
        setPhase(next);
        if (next === 'connected') {
          connectedAt.current ??= Date.now();
          restarts.current = 0;
        }
        if (shouldRestartIce(isCaller, next, restarts.current)) {
          restarts.current += 1;
          void offer(pc, true).catch(() => undefined);
        }
      };
      phaseRef.current = 'connecting';
      setPhase('connecting');
      if (shouldCreateOffer(isCaller, 'active')) await offer(pc).catch(() => undefined);
      drain();
    })();
    return () => {
      cancelled = true;
      stopAll();
      connectedAt.current = null;
      restarts.current = 0;
      setSeconds(0);
    };
  }, [active, callId, kind, isCaller, drain]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (connectedAt.current) setSeconds(Math.floor((Date.now() - connectedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

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
  const flip = useCallback(async () => {
    const stream = localRef.current;
    const pc = pcRef.current;
    const old = stream?.getVideoTracks()[0];
    if (!rtc || !stream || !pc || !old) return;
    facing.current = facing.current === 'user' ? 'environment' : 'user';
    if (old._switchCamera) return old._switchCamera(); // natif : bascule avant/arrière sur place
    try {
      const fresh = (await rtc.getUserMedia({ audio: false, video: { facingMode: facing.current } })).getVideoTracks()[0];
      if (!fresh) return;
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      await sender?.replaceTrack(fresh);
      old.stop();
      const next = rtc.newStream();
      stream.getAudioTracks().forEach((t) => next.addTrack(t));
      next.addTrack(fresh);
      localRef.current = next;
      setLocal(next);
      setCamOn(true);
    } catch {
      /* un seul appareil photo : on garde le flux actuel */
    }
  }, []);

  return { local, remote, phase, micOn, camOn, error, seconds, toggleMic, toggleCam, flip };
}
