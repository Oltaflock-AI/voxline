"use client";

import { useTransition } from "react";
import { moveLead } from "@/app/app/[tenant]/pipeline/actions";
import { STAGES, type LeadStage } from "@/lib/stages";

/**
 * The stage dropdown on a pipeline card (spec §6.4's fallback for drag and
 * drop). A Client Component — it needs to react to the user picking an option.
 */
export function StageSelect({
  leadId,
  currentStage,
  tenantSlug,
}: {
  leadId: string;
  currentStage: LeadStage;
  tenantSlug: string;
}) {
  const [isPending, startTransition] = useTransition();
  const currentTitle =
    STAGES.find((s) => s.key === currentStage)?.title ?? currentStage;

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newStage = event.target.value as LeadStage;
    startTransition(async () => {
      await moveLead(leadId, newStage, tenantSlug);
    });
  }

  return (
    // Wrapper + a hand-drawn caret, not the browser's built-in arrow: the
    // native one doesn't vertically centre reliably at this element height
    // across browsers. `appearance: none` in the CSS hides it; this SVG
    // replaces it, positioned exactly by CSS. `pointer-events: none` on the
    // SVG means clicks still pass straight through to the <select> beneath it.
    <div className="stage-select-wrap">
      {/*
        The label is rendered by us; the real <select> sits invisibly on top.

        A native select cannot size itself to the SELECTED option — it always
        reserves room for the widest one ("New inquiry"). So any fixed or auto
        width leaves "Booked" floating in a box built for a longer word, and no
        amount of text-align fixes that: the box itself is the wrong size.

        Rendering the text ourselves means the control is exactly as wide as
        what it says, with the caret a fixed 5px away. The transparent select
        stretched over it keeps the real behaviour — native menu, keyboard,
        and a proper touch target on mobile — so this is a visual swap, not a
        reimplementation.
      */}
      <span className={`stage-select-shell${isPending ? " is-pending" : ""}`}>
        <span className="stage-select-label">{currentTitle}</span>
        <svg
          className="stage-select-caret"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <select
          className="stage-select-native"
          value={currentStage}
          onChange={handleChange}
          disabled={isPending}
          aria-label="Pipeline stage"
        >
          {STAGES.map((stage) => (
            <option key={stage.key} value={stage.key}>
              {stage.title}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
