/** Transforme le texte tapé (une info par ligne ou séparées par « ; ») en faits pour l'IA : 1 à 10, 200 caractères maximum chacun. Logique pure, sans dépendance à React Native (testable seule). */
export function factsFromText(text: string): string[] {
  return text
    .split(/[\n;]+/)
    .map((x) => x.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 10);
}
