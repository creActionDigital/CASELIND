import { Alert, Platform, type AlertButton } from 'react-native';

/**
 * `Alert.alert` avec boutons : sur le web, React Native Web n'affiche rien et l'action n'est jamais lancée.
 * Même signature ; sur le web, `confirm()` du navigateur, puis le premier bouton qui n'est pas « annuler ».
 */
export function alertConfirm(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  const action = buttons?.find((b) => b.style !== 'cancel');
  // eslint-disable-next-line no-alert
  if (globalThis.confirm?.(message ? `${title}\n\n${message}` : title)) action?.onPress?.();
}
