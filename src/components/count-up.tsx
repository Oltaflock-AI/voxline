"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Spec §7.3: "KPI values count up once on mount." Once — not on every re-render.
 *
 * The initial state is the final value, not zero. That way the server-rendered
 * HTML already contains the real number: no layout shift, and it is correct
 * before any JavaScript runs. The animation only replaces it afterwards.
 *
 * Spec §7.3 also requires respecting prefers-reduced-motion, so a user who has
 * asked for less movement just sees the number.
 */
export function CountUp({ value }: { value: string }) {
  const [display, setDisplay] = useState(value);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const target = Number(value.replace(/,/g, ""));
    if (Number.isNaN(target)) return; // e.g. "4:05" — nothing to animate

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const start = performance.now();
    const duration = 700;
    let frame = 0;

    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(Math.round(target * eased).toLocaleString());
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{display}</>;
}
