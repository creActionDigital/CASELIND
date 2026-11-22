import { createElement, useEffect, useRef } from 'react';
import type { StreamLike } from './rtc-types';

/** Affiche (web) un flux dans un élément <video>. `hidden` : flux audio seul, lu sans image. */
export function StreamView({ stream, muted = false, mirror = false, hidden = false }: { stream: StreamLike | null; muted?: boolean; mirror?: boolean; hidden?: boolean }) {
  const ref = useRef<{ srcObject: unknown; play?: () => Promise<void> } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    void el.play?.().catch(() => undefined);
  }, [stream]);
  return createElement('video', {
    ref,
    autoPlay: true,
    playsInline: true,
    muted,
    style: hidden
      ? { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }
      : { width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000', transform: mirror ? 'scaleX(-1)' : undefined },
  });
}
