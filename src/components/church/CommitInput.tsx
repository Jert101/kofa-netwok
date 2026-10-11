"use client";

import { useEffect, useRef, useState } from "react";

/**
 * What a blur should save: the normalized draft, or null when nothing changed.
 *
 * Pure so the rule is pinned by a test. The parish editor used to compare the
 * input's value against the row's *live* state, which every keystroke had
 * already updated -- so the two were always equal at blur and no council edit
 * ever reached the server. The comparison has to be against the last value
 * the server confirmed, never against what is on screen.
 */
export function diffForCommit(
  committed: string,
  draft: string,
  normalize: (v: string) => string = (v) => v,
): string | null {
  const next = normalize(draft);
  return next === committed ? null : next;
}

type CommitInputProps = {
  /** The last server-confirmed value. The field resyncs whenever this changes. */
  value: string;
  /** Called once per blur, only when the normalized draft differs. */
  onCommit: (next: string) => void;
  /** Applied before comparing and committing. Defaults to identity. */
  normalize?: (v: string) => string;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

/**
 * A text field that saves itself when it loses focus and has actually changed.
 *
 * The draft lives here, not in the parent: the parent's state stays at the
 * last committed value until `onCommit` fires, which is what makes "changed"
 * decidable at all. (Lifting the draft up, as the council rows once did,
 * keeps parent and input in sync on every keystroke, so a blur-time
 * comparison can never see a difference and edits die silently.)
 *
 * Two-way resync contract, both directions needed:
 * - parent -> field: whenever `value` changes (reload, revert after a
 *   refused save, another row's edit), the draft and the committed marker
 *   reset to it;
 * - field -> parent: on blur with a real difference, `onCommit` fires and the
 *   marker advances immediately, so a second blur without further typing does
 *   not save twice. The parent is still expected to reflect the commit in
 *   `value` (both callers update optimistically); if it does not, the marker
 *   is already correct and the only cost is a repeated save on re-blur.
 */
export function CommitInput({
  value,
  onCommit,
  normalize = (v) => v,
  multiline = false,
  rows = 2,
  ...rest
}: CommitInputProps) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(normalize(value));
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const normalizeRef = useRef(normalize);
  normalizeRef.current = normalize;

  useEffect(() => {
    setDraft(value);
    committed.current = normalizeRef.current(value);
  }, [value]);

  const commit = () => {
    const next = diffForCommit(committed.current, draft, normalizeRef.current);
    if (next === null) return;
    committed.current = next;
    onCommitRef.current(next);
  };

  if (multiline) {
    return (
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        rows={rows}
        {...rest}
      />
    );
  }
  return <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} {...rest} />;
}
