import InCallManager from 'react-native-incall-manager';
import type { SpeakerApi } from './speaker-types';

export const speaker: SpeakerApi | null = {
  start: (video) => {
    InCallManager.start({ media: video ? 'video' : 'audio' });
    InCallManager.setForceSpeakerphoneOn(video);
  },
  setSpeaker: (on) => InCallManager.setForceSpeakerphoneOn(on),
  stop: () => InCallManager.stop(),
};