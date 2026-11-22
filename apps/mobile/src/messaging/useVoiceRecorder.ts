import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform } from 'react-native';
import { recReduce, type RecEffect, type RecEvent, type RecState } from './voice-logic';

export type VoiceError = 'denied' | 'unsupported' | 'failed';
const IDLE: RecState = { phase: 'idle' };

/** Enregistrement d'un vocal : maintenir (envoi au relâchement), toucher pour verrouiller, glisser à gauche pour annuler. */
export function useVoiceRecorder(onRecorded: (r: { uri: string; seconds: number }) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<RecState>(IDLE);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<VoiceError | null>(null);
  const live = useRef<RecState>(IDLE);
  const started = useRef<Promise<boolean>>(Promise.resolve(false));
  const cb = useRef(onRecorded);
  cb.current = onRecorded;

  const apply = useCallback(
    async (effect: RecEffect) => {
      if (!effect) return;
      const ok = await started.current;
      if (!ok) return;
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (effect.do === 'send' && uri) cb.current({ uri, seconds: effect.seconds });
      } catch {
        setError('failed');
      } finally {
        void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      }
    },
    [recorder],
  );

  const dispatch = useCallback(
    (e: RecEvent) => {
      const r = recReduce(live.current, e);
      live.current = r.state;
      setState(r.state);
      void apply(r.effect);
    },
    [apply],
  );

  const begin = useCallback(async (): Promise<boolean> => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('denied');
        return false;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      return true;
    } catch {
      setError('failed');
      return false;
    }
  }, [recorder]);

  const press = useCallback(() => {
    if (live.current.phase !== 'idle') return;
    if (Platform.OS === 'web' && typeof MediaRecorder === 'undefined') return setError('unsupported');
    setError(null);
    setElapsed(0);
    dispatch({ type: 'press', now: Date.now() });
    started.current = begin().then((ok) => {
      if (!ok) dispatch({ type: 'cancel' }); // permission refusée ou micro indisponible : retour au clavier
      return ok;
    });
  }, [begin, dispatch]);

  useEffect(() => {
    if (state.phase === 'idle') return;
    const timer = setInterval(() => {
      const now = Date.now();
      setElapsed((now - (live.current as { startedAt: number }).startedAt) / 1000);
      dispatch({ type: 'tick', now });
    }, 250);
    return () => clearInterval(timer);
  }, [state.phase, dispatch]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: press,
        onPanResponderMove: (_e, g) => dispatch({ type: 'slide', dx: g.dx }),
        onPanResponderRelease: () => dispatch({ type: 'release', now: Date.now() }),
        onPanResponderTerminate: () => dispatch({ type: 'release', now: Date.now() }),
      }),
    [press, dispatch],
  );

  return {
    phase: state.phase,
    elapsed,
    error,
    clearError: () => setError(null),
    panHandlers: pan.panHandlers,
    send: () => dispatch({ type: 'send', now: Date.now() }),
    cancel: () => dispatch({ type: 'cancel' }),
  };
}
