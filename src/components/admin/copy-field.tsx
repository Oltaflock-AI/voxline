"use client";

import { useState } from "react";

/**
 * A long value with a copy button.
 *
 * Webhook URLs run to well over a hundred characters because the Sarvam token
 * is 64 of them. Selecting that by hand off a wrapped line is how half a token
 * ends up pasted into a provider console, and the resulting 401 looks like our
 * bug rather than a copy that missed the end.
 */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // The value is on screen and selectable, so this is a lost convenience
      // rather than a lost capability — say nothing and let them select it.
    }
  }

  return (
    <div className="copy-field">
      <code>{value}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? (
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
