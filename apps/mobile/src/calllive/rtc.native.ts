import { MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, mediaDevices } from 'react-native-webrtc';
import type { CandidateLike, PeerLike, RtcApi, SdpLike, StreamLike } from './rtc-types';

/** WebRTC natif (react-native-webrtc) : exige une version de développement (pas Expo Go). */
export const rtc: RtcApi | null = {
  native: true,
  createPeer: (config) => new RTCPeerConnection(config) as unknown as PeerLike,
  getUserMedia: (c) => mediaDevices.getUserMedia(c as never) as unknown as Promise<StreamLike>,
  newStream: () => new MediaStream() as unknown as StreamLike,
  description: (d: SdpLike) => new RTCSessionDescription(d as never) as unknown as SdpLike,
  candidate: (c: CandidateLike) => new RTCIceCandidate(c as never) as unknown as CandidateLike,
};
