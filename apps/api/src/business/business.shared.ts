/** Fonctions pures de la gestion d'entreprise : coût moyen pondéré, numéro de bon de commande, CSV. */

/**
 * Coût moyen pondéré après une entrée en stock, en entiers (BigInt : stock × coût peut dépasser 2^53), arrondi à l'unité mineure
 * la plus proche (0,5 vers le haut). Sans coût connu ou sans stock, le nouveau coût est celui de l'entrée : un coût inconnu ne dilue pas.
 */
export function weightedAverageCost(stock: number, costMinor: number | null, qty: number, unitCostMinor: number): number {
  if (costMinor === null || stock <= 0) return unitCostMinor;
  const den = BigInt(stock) + BigInt(qty);
  const num = BigInt(stock) * BigInt(costMinor) + BigInt(qty) * BigInt(unitCostMinor);
  return Number((2n * num + den) / (2n * den));
}

export const poNumber = (n: number): string => `PO-${String(n).padStart(4, '0')}`;

/** Une cellule CSV : jamais interprétée comme une formule (= + - @ tabulation retour chariot → apostrophe), guillemets doublés si besoin. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV UTF-8 avec BOM (Excel), en-têtes puis lignes, fins de ligne CRLF. */
export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
