"use client";

import { useEffect, useRef, useState } from "react";
import { getRecordingUrl } from "@/app/app/[tenant]/calls/actions";
import { formatDuration } from "@/lib/calls";

/**
 * Real HTML5 playback against a short-lived signed URL (spec §6.3).
 *
 * The URL is fetched lazily, on first play, for two reasons: signing a URL for
 * every row in a 25-row page would be 25 pointless round trips, and a 5-minute
 * URL minted at page load is often expired by the time anyone clicks it.
 */
export function AudioPlayer({
  callId,
  durationSeconds,
  hasRecording,
}: {
  callId: string;
  durationSeconds: number;
  hasRecording: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The real duration once metadata loads; the DB value until then.
  const [duration, setDuration] = useState(durationSeconds);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setElapsed(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setDuration(el.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setElapsed(0);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
    };
  }, [url]);

  async function toggle() {
    if (!hasRecording) return;

    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }

    if (!url) {
      setLoading(true);
      const res = await getRecordingUrl(callId);
      setLoading(false);
      if (!res.url) {
        setError(res.error);
        return;
      }
      setUrl(res.url);
      // Wait for React to attach the src before playing.
      requestAnimationFrame(() => {
        void audioRef.current?.play();
        setPlaying(true);
      });
      return;
    }

    void audioRef.current?.play();
    setPlaying(true);
  }

  function seek(e: React.MouseEvent<HTMLSpanElement>) {
    const el = audioRef.current;
    if (!el || !url || !Number.isFinite(duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setElapsed(el.currentTime);
  }

  const pct = duration > 0 ? (elapsed / duration) * 100 : 0;

  if (!hasRecording) {
    return (
      <div className="player">
        <span
          className="t"
          style={{ color: "var(--muted)", fontFamily: "inherit" }}
        >
          No recording stored for this call
        </span>
      </div>
    );
  }

  return (
    <div className="player">
      <button
        className="play-btn"
        onClick={toggle}
        disabled={loading}
        aria-label={playing ? "Pause recording" : "Play recording"}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5l12 7-12 7z" />
          </svg>
        )}
      </button>

      <span className="t">{formatDuration(elapsed)}</span>
      <span className="track" onClick={seek}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="t">{formatDuration(duration)}</span>

      {error && (
        <span style={{ fontSize: 12, color: "var(--negative)" }}>{error}</span>
      )}

      {url && <audio ref={audioRef} src={url} preload="metadata" />}
    </div>
  );
}
