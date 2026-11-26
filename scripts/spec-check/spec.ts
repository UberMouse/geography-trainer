/**
 * Reads the spec's markdown into entries: one per heading that starts with an ID.
 *
 * Tiers, by file and ID shape (see spec/README.md):
 * - L0 `spec/00-product.md`, IDs `PRD-01`
 * - L1 `spec/features/*.md`, IDs `SES-03`
 * - L2 `spec/contracts/*.md`, IDs `SES-C03`
 */

export type Tier = 0 | 1 | 2;

export const VERIFIED_KINDS = ['manual', 'typecheck', 'lint', 'build:data'] as const;
export type VerifiedKind = (typeof VERIFIED_KINDS)[number];

export interface SpecEntry {
  id: string;
  tier: Tier;
  title: string;
  file: string;
  line: number;
  /** IDs one tier up that this entry refines (`Up:` line). */
  up: string[];
  /** Set when the entry is checked by something other than a tagged test (`Verified:` line). */
  verified?: { kind: string; reason: string };
  /** Whether the entry's body holds a ```gherkin block with a Scenario in it. */
  hasScenario: boolean;
}

/** An ID anywhere: an area of 2–4 capitals, a dash, an optional C (contract), 2–3 digits. */
export const ID_SOURCE = '[A-Z]{2,4}-C?\\d{2,3}';
const HEADING = new RegExp(`^#{2,4}\\s+(${ID_SOURCE})\\b[\\s:.—-]*(.*)$`);
const ID_IN_TEXT = new RegExp(`\\b${ID_SOURCE}\\b`, 'g');

/** The tier an ID's shape claims: PRD-nn is L0, AREA-Cnn is L2, AREA-nn is L1. */
export function tierOfId(id: string): Tier {
  if (id.startsWith('PRD-')) return 0;
  return /-C\d/.test(id) ? 2 : 1;
}

/** The tier a spec file holds, by its path relative to the repo root; null for other files. */
export function tierOfFile(file: string): Tier | null {
  if (file === 'spec/00-product.md') return 0;
  if (/^spec\/features\/[^/]+\.md$/.test(file)) return 1;
  if (/^spec\/contracts\/[^/]+\.md$/.test(file)) return 2;
  return null;
}

export function parseSpecFile(file: string, text: string, tier: Tier): SpecEntry[] {
  const entries: SpecEntry[] = [];
  const lines = text.split('\n');
  let current: SpecEntry | null = null;
  /** The heading level (number of #) of the current entry. */
  let currentLevel = 0;
  /** The open fence: its marker (``` or ~~~, at its length) and info string. */
  let fence: { marker: string; lang: string } | null = null;
  let fenceHasScenario = false;

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (fence) {
      // Only a run of the same character, at least as long and with nothing after it, closes.
      const close = /^\s*(`{3,}|~{3,})$/.exec(line);
      if (close && close[1]![0] === fence.marker[0] && close[1]!.length >= fence.marker.length) {
        if (current && fence.lang === 'gherkin' && fenceHasScenario) current.hasScenario = true;
        fence = null;
      } else if (/^\s*Scenario( Outline)?:/.test(line)) fenceHasScenario = true;
      return;
    }
    const open = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(line);
    if (open) {
      fence = { marker: open[1]!, lang: open[2] ?? '' };
      fenceHasScenario = false;
      return;
    }
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const m = HEADING.exec(line);
      if (m) {
        current = { id: m[1]!, tier, title: (m[2] ?? '').trim(), file, line: i + 1, up: [], hasScenario: false };
        currentLevel = level;
        entries.push(current);
      } else if (level <= currentLevel) {
        // A heading at the entry's level or above ends it; a deeper one (#### Notes) is inside it.
        current = null;
        currentLevel = 0;
      }
      return;
    }
    if (!current) return;
    const up = /^\s*Up:\s*(.*)$/.exec(line);
    if (up) {
      current.up.push(...(up[1]!.match(ID_IN_TEXT) ?? []));
      return;
    }
    // The kind is a word, or two joined by a colon (build:data); a colon after it is a separator.
    const verified = /^\s*Verified:\s*([a-z]+(?::[a-z]+)?)\s*(?:[—–-]+|:)?\s*(.*)$/.exec(line);
    if (verified) current.verified = { kind: verified[1]!, reason: verified[2]!.trim() };
  });
  return entries;
}
