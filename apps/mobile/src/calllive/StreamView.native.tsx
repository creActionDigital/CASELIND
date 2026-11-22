import { RTCView } from 'react-native-webrtc';
import type { StreamLike } from './rtc-types';

/** Affiche (natif) un flux avec RTCView. L'audio d'un flux distant joue sans vue : rien à afficher si `hidden`. */
export function StreamView({ stream, mirror = false, hidden = false }: { stream: StreamLike | null; muted?: boolean; mirror?: boolean; hidden?: boolean }) {
  if (hidden || !stream?.toURL) return null;
  return <RTCView streamURL={stream.toURL()} objectFit="cover" mirror={mirror} style={{ width: '100%', height: '100%', backgroundColor: '#000' }} />;
}
