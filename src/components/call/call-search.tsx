"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/**
 * Search the call log by caller name or number — spec §6.3 lists this as
 * Phase 2, and at 169 calls the filter chips alone are not enough to find the
 * person who rang on Tuesday.
 *
 * The query lives in the URL rather than in component state, so a search is
 * shareable, survives a refresh, and composes with the outcome and score
 * filters already there. Filtering happens in Postgres for the same reason the
 * chip counts do: fetching every row to match in the browser would silently
 * stop at PostgREST's 1000-row cap.
 */
export function CallSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const first = useRef(true);

  // Debounced, because a navigation per keystroke would queue a database query
  // for every letter of "Ananya" and land them out of order.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      // A new search always starts at page one; staying on page 3 of the old
      // result set shows an empty page and looks broken.
      next.delete("page");
      startTransition(() => router.replace(`?${next.toString()}`));
    }, 300);
    return () => clearTimeout(t);
    // `params` is intentionally excluded: it changes as a RESULT of this
    // effect, and including it would make the debounce re-fire itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, router]);

  return (
    <div className={`call-search${isPending ? " is-pending" : ""}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        className="call-search-input"
        placeholder="Search by caller name or number…"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        aria-label="Search calls by caller name or number"
      />
      {value && (
        <button
          type="button"
          className="call-search-clear"
          onClick={() => setValue("")}
          aria-label="Clear search"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
