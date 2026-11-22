/** Types minimaux communs au WebRTC du navigateur et à react-native-webrtc (même abstraction web et natif). */
export interface TrackLike {
  kind: string;
  enabled: boolean;
  stop(): void;
  /** react-native-webrtc seulement : bascule avant/arrière. */
  _switchCamera?: () => void;
}
export interface StreamLike {
  getTracks(): TrackLike[];
  getAudioTracks(): TrackLike[];
  getVideoTracks(): TrackLike[];
  addTrack(t: TrackLike): void;
  /** react-native-webrtc seulement. */
  toURL?: () => string;
}
export interface SdpLike {
  type: string;
  sdp?: string;
}
export interface CandidateLike {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  toJSON?: () => unknown;
}
export interface PeerLike {
  localDescription: SdpLike | null;
  remoteDescription: SdpLike | null;
  iceConnectionState: string;
  createOffer(options?: { iceRestart?: boolean }): Promise<SdpLike>;
  createAnswer(): Promise<SdpLike>;
  setLocalDescription(d: SdpLike): Promise<void>;
  setRemoteDescription(d: SdpLike): Promise<void>;
  addIceCandidate(c: CandidateLike): Promise<void>;
  addTrack(t: TrackLike, s: StreamLike): unknown;
  getSenders(): { track: TrackLike | null; replaceTrack(t: TrackLike | null): Promise<void> }[];
  close(): void;
  onicecandidate: ((e: { candidate: CandidateLike | null }) => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  ontrack: ((e: { streams: StreamLike[]; track: TrackLike }) => void) | null;
}
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}
export interface RtcApi {
  /** true avec react-native-webrtc (appareil réel, version de développement). */
  native: boolean;
  createPeer(config: { iceServers: IceServer[] }): PeerLike;
  getUserMedia(c: { audio: boolean; video: false | { facingMode: 'user' | 'environment' } }): Promise<StreamLike>;
  newStream(): StreamLike;
  description(d: SdpLike): SdpLike;
  candidate(c: CandidateLike): CandidateLike;
}
