/** Règles du code PIN de paiement : miroir du contrat (`paymentPinSchema`, lot 6B) pour répondre sans aller-retour. */
export const PIN_LENGTH = 6;

export type PinCheck = 'ok' | 'length' | 'weak';

/** Suites montantes ou descendantes, chiffre répété, motifs 121212 / 123123. */
export function isWeakPin(pin: string): boolean {
  const d = [...pin].map(Number);
  if (d.length === 0) return false;
  if (d.every((x) => x === d[0])) return true;
  const steps = d.slice(1).map((x, i) => x - d[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  return pin.slice(0, 2).repeat(3) === pin || pin.slice(0, 3).repeat(2) === pin;
}

export function checkPin(pin: string): PinCheck {
  if (!/^\d{6}$/.test(pin)) return 'length';
  return isWeakPin(pin) ? 'weak' : 'ok';
}

/** Ne garde que des chiffres, au plus `PIN_LENGTH`. */
export function appendDigit(pin: string, digit: string): string {
  return /^\d$/.test(digit) && pin.length < PIN_LENGTH ? pin + digit : pin;
}

export type PinFormIssue = 'length' | 'weak' | 'mismatch' | 'password';

/** Création / changement : deux saisies identiques, règles respectées, mot de passe renseigné. */
export function validatePinForm(pin: string, confirm: string, password: string): PinFormIssue | null {
  const c = checkPin(pin);
  if (c !== 'ok') return c;
  if (pin !== confirm) return 'mismatch';
  if (password.length === 0) return 'password';
  return null;
}
