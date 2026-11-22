import type { CandidateLike, PeerLike, RtcApi, SdpLike, StreamLike } from './rtc-types';

/** WebRTC du navigateur (version web). Le fichier `rtc.native.ts` fournit la même interface avec react-native-webrtc. */
const supported =
  typeof RTCPeerConnection !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';

export const rtc: RtcApi | null = supported
  ? {
      native: false,
      createPeer: (config) => new RTCPeerConnection(config) as unknown as PeerLike,
      getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c as MediaStreamConstraints) as unknown as Promise<StreamLike>,
      newStream: () => new MediaStream() as unknown as StreamLike,
      description: (d: SdpLike) => ({ type: d.type, sdp: d.sdp }),
      candidate: (c: CandidateLike) => ({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex }),
    }
  : null;
