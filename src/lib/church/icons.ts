import {
  Bell,
  BookOpen,
  Cross,
  Flame,
  HandHeart,
  Lamp,
  ScrollText,
  Star,
} from "lucide-react";

import { ROLE_ICONS, type RoleIcon } from "./ministry";

/**
 * The glyph each role icon key is drawn with.
 *
 * A map rather than a dynamic import of `lucide-react/dist/icons/${name}`, which is the tempting way to
 * do this and which silently renders nothing for a key that does not exist -- there is no error, no
 * broken import, just an empty box on the parish's public page. Every key is listed here explicitly, so
 * `ROLE_ICONS` and this map are checked against each other by a test rather than at 3am.
 *
 * The names are chosen for what they actually are rather than for their names: there is no candle in
 * lucide, so a `Lamp` stands in for one, and `Flame` carries the incense.
 */
const GLYPH: Record<RoleIcon, typeof Bell> = {
  cross: Cross,
  candle: Lamp,
  censer: Flame,
  bell: Bell,
  book: BookOpen,
  star: Star,
  hands: HandHeart,
  scroll: ScrollText,
};

/**
 * The icon for a stored role icon key.
 *
 * Falls back to the cross for an unrecognised key rather than rendering nothing. The API refuses an
 * unrecognised key on the way in, so this can only be reached by a row written before that check
 * existed -- and a card with a cross in it is a wrong answer that is visible, which beats an empty box
 * that is not.
 */
export function glyphFor(key: string | null | undefined) {
  const key1 = (key ?? "") as RoleIcon;
  const Icon = GLYPH[key1] ?? Cross;
  return Icon;
}

export { ROLE_ICONS };