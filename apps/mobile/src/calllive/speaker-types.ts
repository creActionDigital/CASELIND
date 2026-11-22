/** Routage audio d'un appel : haut-parleur ou écouteur. Disponible seulement en natif (react-native-incall-manager). */
export interface SpeakerApi {
  /** À l'établissement de l'appel : la vidéo part sur haut-parleur, l'audio sur écouteur. */
  start(video: boolean): void;
  setSpeaker(on: boolean): void;
  stop(): void;
}