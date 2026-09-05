"use client";

import { useRef, useState } from "react";

/**
 * A long value with a copy button.
 *
 * Webhook URLs run to well over a hundred characters because the Sarvam token
 * is 64 of them. Selecting that by hand off a wrapped line is how half a token
 * ends up pasted into a provider console, and the resulting 401 looks like our
 * bug rather than a copy that missed the end.
 */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  const codeRef = useRef<HTMLElement>(null);

  /**
   * Copy, and if that is refused, SELECT instead.
   *
   * The previous version swallowed the failure in silence on purpose, reasoning
   * that the value was on screen and selectable anyway. In practice the button
   * then does nothing at all when clicked, which reads as broken rather than as
   * degraded — reported 2026-09-05.
   *
   * `navigator.clipboard` is refused more often than it looks: a non-HTTPS
   * origin, a denied permission, an unfocused document, or an iframe without
   * `clipboard-write`. The fallback selects the text so one keystroke finishes
   * the job, and the label says which keystroke. Either way the button visibly
   * responds.
   */
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      const node = codeRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setState("selected");
    }
    setTimeout(() => setState("idle"), 3000);
  }

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = isMac ? "\u2318C" : "Ctrl+C";

  return (
    <div className="copy-field">
      <code ref={codeRef}>{value}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`}>
        {state === "selected" ? (
          <>Selected · press {shortcut}</>
        ) : state === "copied" ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
            Copy
          </>
        )}
      </button>
    </div>
  );
}
