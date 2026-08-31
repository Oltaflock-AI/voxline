import Link from "next/link";

/**
 * Mark + wordmark. Spec §7.4: the mark is five bars in a rounded square, the
 * wordmark is uppercase with 0.19em tracking, and they always appear together.
 */
export function Logo({
  href = "/",
  size = "md",
}: {
  href?: string;
  size?: "md" | "sm";
}) {
  const sm = size === "sm";
  return (
    <Link className="logo" href={href} style={sm ? { fontSize: 15 } : undefined}>
      <span
        className="logo-mark"
        style={sm ? { width: 26, height: 26, borderRadius: 8 } : undefined}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
        </svg>
      </span>
      Voxline
    </Link>
  );
}

/**
 * Five bars on a staggered animation delay. Spec §7.4 lists exactly three
 * places this belongs: the status pill, the "answering now" card, and (at 35%
 * opacity) empty-state art. Nowhere else.
 */
export function WaveLoader({ height = 11 }: { height?: number }) {
  return (
    <span className="wave-load" style={{ height, gap: 2 }} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
