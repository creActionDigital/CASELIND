import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Vrai si l'utilisateur a demandé de réduire les animations (suit les changements en direct). */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let on = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => on && setReduce(v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      on = false;
      sub.remove();
    };
  }, []);
  return reduce;
}
