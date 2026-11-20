import { AI_ACTIONS_MAX_PER_REPLY, type AiActionTool, aiActionArgsSchemas, aiActionToolSchema } from '@caselind/contracts';

/** Pure protocol of the assistant actions: parsing the model reply, validating proposals, gating. */

/** Added to the system prompt only when actions are on. The model proposes; the user confirms. */
export const ACTIONS_PROMPT = [
  "Tu peux PROPOSER des actions que l'utilisateur confirmera lui-même (rien ne s'exécute sans son accord).",
  "Pour en proposer, termine ta réponse par un bloc <actions>[{\"tool\":\"...\",\"args\":{...},\"label\":\"...\"}]</actions> (JSON strict, 3 actions au plus).",
  'Outils autorisés, et aucun autre :',
  '- search_products {"q": texte, "maxPriceMinor"?: entier, "currency"?: "USD"} : rechercher des produits.',
  '- search_places {"lat": nombre, "lng": nombre, "kind"?: "restaurant"|"pharmacy"|"hotel"|"shop"|..., "q"?: texte} : lieux proches, SEULEMENT si l\'utilisateur a écrit lui-même ses coordonnées.',
  '- summarize_text {"text": texte recopié tel quel depuis le message de l\'utilisateur} : résumer un texte qu\'il a fourni.',
  '- prepare_cart {"items": [{"q": nom du produit, "quantity": entier}]} : proposer des lignes de panier.',
  '- open_screen {"path": "/cart"|"/orders"|"/search"|"/favorites"|"/wallet"|"/notifications"|"/consents"|"/scheduled"|"/loyalty"|"/ai"} : ouvrir un écran.',
  'Le label est une courte phrase (80 caractères au plus) décrivant l\'action. N\'invente jamais de coordonnées ni de texte.',
].join('\n');

export interface Proposal {
  tool: AiActionTool;
  args: Record<string, unknown>;
  label: string | null;
}

export interface ParsedReply {
  /** The reply without the actions block. */
  text: string;
  proposals: Proposal[];
  /** Entries dropped: unknown tool, invalid arguments, or beyond the limit. */
  ignoredTools: (AiActionTool | 'unknown')[];
}

const BLOCK_RE = /<actions>([\s\S]*?)<\/actions>/gi;

/** Extracts and validates the actions of a model reply. Never throws: anything unusable is ignored. */
export function parseModelReply(reply: string): ParsedReply {
  const blocks = [...reply.matchAll(BLOCK_RE)];
  const text = reply.replace(BLOCK_RE, '').trim();
  const proposals: Proposal[] = [];
  const ignoredTools: ParsedReply['ignoredTools'] = [];
  for (const b of blocks) {
    let raw: unknown;
    try {
      raw = JSON.parse(b[1]!.trim());
    } catch {
      ignoredTools.push('unknown');
      continue;
    }
    if (!Array.isArray(raw)) {
      ignoredTools.push('unknown');
      continue;
    }
    for (const entry of raw) {
      const p = validateProposal(entry);
      if (!p) {
        ignoredTools.push(toolOf(entry));
      } else if (proposals.length >= AI_ACTIONS_MAX_PER_REPLY) {
        ignoredTools.push(p.tool);
      } else {
        proposals.push(p);
      }
    }
  }
  return { text, proposals, ignoredTools };
}

function toolOf(entry: unknown): AiActionTool | 'unknown' {
  const t = aiActionToolSchema.safeParse((entry as { tool?: unknown } | null)?.tool);
  return t.success ? t.data : 'unknown';
}

/** One proposal: a whitelisted tool, strict arguments, an optional short label. */
export function validateProposal(entry: unknown): Proposal | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as { tool?: unknown; args?: unknown; label?: unknown };
  const tool = aiActionToolSchema.safeParse(e.tool);
  if (!tool.success) return null;
  const args = aiActionArgsSchemas[tool.data].safeParse(e.args ?? {});
  if (!args.success) return null;
  const label = typeof e.label === 'string' ? e.label.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return { tool: tool.data, args: args.data as Record<string, unknown>, label: label || null };
}

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** summarize_text only summarises text the user actually wrote in this turn. */
export function textFromUser(text: string, userMessage: string): boolean {
  return normalize(userMessage).includes(normalize(text));
}

/** search_places only uses a position the user typed (both numbers, to 2 decimals, appear in the message). */
export function coordinatesFromUser(lat: number, lng: number, userMessage: string): boolean {
  const numbers = (userMessage.match(/-?\d{1,3}(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));
  const at = (v: number, not = -1) => numbers.findIndex((n, i) => i !== not && Math.abs(n - v) < 0.005);
  const i = at(lat);
  return i >= 0 && at(lng, i) >= 0;
}

/** Default French label when the model gave none. */
export function defaultLabel(tool: AiActionTool, args: Record<string, unknown>): string {
  switch (tool) {
    case 'search_products':
      return `Rechercher « ${String(args.q)} »`.slice(0, 120);
    case 'search_places':
      return 'Chercher des lieux proches de la position indiquée';
    case 'summarize_text':
      return 'Résumer le texte fourni';
    case 'prepare_cart':
      return 'Préparer un panier';
    case 'open_screen':
      return `Ouvrir ${String(args.path)}`;
  }
}

/**
 * Emergency stop. `AI_ACTIONS_ENABLED=false` stops everything; `true` forces on; unset: on outside production,
 * and in production only once an admin switches the `ai_actions` flag on.
 */
export function aiActionsEnabled(opts: { envFlag: boolean | undefined; production: boolean; flagOn: boolean }): boolean {
  if (opts.envFlag !== undefined) return opts.envFlag;
  return opts.production ? opts.flagOn : true;
}
