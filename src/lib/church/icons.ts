import { ROLE_ICONS, type RoleIcon } from "./ministry";

/**
 * The character each role icon key is drawn with.
 *
 * These are the glyphs from the supplied reference — ✝ 🕯 ♨ 🔔 — kept as they were written rather than
 * replaced with drawn icons. They are the parish's choice of symbol, and "make it look better" is not a
 * reason to disagree with them.
 *
 * The storage decision is unchanged and still worth keeping: the *column* holds one of `ROLE_ICONS`, not
 * a character. So the database cannot accumulate arbitrary text that then renders on a public page, the
 * API can refuse a key it cannot draw, and the glyph itself lives in this file where it is reviewed like
 * any other code. That is the same arrangement the reference has between its markup and its stylesheet,
 * and it is why a role can be re-glyphed without a migration.
 *
 * The four beyond the reference's are for roles the parish adds later, which it will, since the roles at
 * one parish are not the roles at the next.
 */
const GLYPH: Record<RoleIcon, string> = {
  cross: "✝",
  candle: "🕯",
  censer: "♨",
  bell: "🔔",
  book: "📖",
  star: "★",
  hands: "🙏",
  scroll: "📜",
};

/**
 * The character for a stored role icon key.
 *
 * Falls back to the cross for an unrecognised key rather than rendering nothing. The API refuses an
 * unrecognised key on the way in, so this is only reachable by a row written before that check existed
 * — and a card with a cross on it is a wrong answer that is visible, which beats an empty box that is not.
 */
export function glyphFor(key: string | null | undefined): string {
  return GLYPH[(key ?? "") as RoleIcon] ?? GLYPH.cross;
}

export { ROLE_ICONS };
