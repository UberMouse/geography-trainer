// Name normalization shared by country matching, region matching and id slugs.

// Letters that NFD does not decompose into a base letter plus a combining mark.
const TRANSLITERATE: Record<string, string> = {
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ı: 'i',
};

/**
 * Case-, diacritic- and punctuation-insensitive form of a name: "Côte d'Ivoire" → "cote d ivoire",
 * "Turks & Caicos" → "turks and caicos".
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[øłđðþßæœı]/g, (ch) => TRANSLITERATE[ch] ?? ch)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Lowercase ASCII slug: "Côte d'Ivoire" → "cote-d-ivoire". */
export function slugify(name: string): string {
  return normalizeName(name).replace(/ /g, '-');
}

/** Locale-independent string order (UTF-16 code units), so sorted output is byte-stable. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
