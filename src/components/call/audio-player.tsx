"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  getRecordingStatus,
  getRecordingUrl,
} from "@/app/app/[tenant]/calls/actions";
import { formatDuration } from "@/lib/calls";
import type { RecordingStatus } from "@/lib/recording-retry";
import { WaveLoader } from "@/components/logo";

/**
 * Real HTML5 playback against a short-lived signed URL (spec §6.3).
 *
 * The URL is fetched lazily on first play, so its five-minute lifetime starts
 * when the listener actually needs it rather than when the detail page loads.
 */
export function AudioPlayer({
  callId,
  durationSeconds,
  hasRecording,
  recordingStatus,
}: {
  callId: string;
  durationSeconds: number;
  hasRecording: boolean;
  recordingStatus: RecordingStatus;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RecordingStatus>(
    hasRecording ? "ready" : recordingStatus
  );

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

  // Sarvam finalises transcripts before it always finalises the WAV. Poll only
  // while this row is open and pending; the server action respects the
  // database's next_retry_at, so several tabs do not hammer the provider.
  useEffect(() => {
    if (status !== "pending") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      const next = await getRecordingStatus(callId);
      if (cancelled) return;
      setStatus(next);
      if (next === "pending") timer = setTimeout(check, 10_000);
    }

    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [callId, status]);

  async function toggle() {
    if (status !== "ready") return;

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

  function seek(seconds: number) {
    const el = audioRef.current;
    if (!el || !url || !Number.isFinite(duration)) return;
    el.currentTime = seconds;
    setElapsed(el.currentTime);
  }

  if (status === "pending") {
    return (
      <div className="player recording-status pending" role="status" aria-live="polite">
        <span className="recording-status-icon" aria-hidden="true">
          <WaveLoader height={14} />
        </span>
        <span>We are preparing the recording. It should be ready shortly.</span>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="player recording-status failed" role="status">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 3 2.8 19h18.4L12 3Z" />
          <path d="M12 9v4.5M12 17h.01" />
        </svg>
        <span>
          We couldn&apos;t retrieve the recording. The transcript and trip details
          are still available.
        </span>
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className="player recording-status unavailable" role="status">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8" />
          <path d="m7.8 7.8 8.4 8.4" />
        </svg>
        <span>No recording stored for this call.</span>
      </div>
    );
  }

  return (
    <div className="player player-detail">
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

      <span className="t elapsed">{formatDuration(elapsed)}</span>
      <input
        className="audio-scrubber"
        type="range"
        min="0"
        max={Math.max(duration, 0)}
        step="1"
        value={Math.min(elapsed, duration)}
        disabled={!url}
        onChange={(event) => seek(Number(event.currentTarget.value))}
        aria-label="Recording position"
        aria-valuetext={`${formatDuration(elapsed)} of ${formatDuration(duration)}`}
        style={{ "--audio-progress": `${duration > 0 ? (elapsed / duration) * 100 : 0}%` } as CSSProperties}
      />
      <span className="t total">{formatDuration(duration)}</span>

      {error && (
        <span style={{ fontSize: 12, color: "var(--negative)" }}>{error}</span>
      )}

      {url && <audio ref={audioRef} src={url} preload="metadata" />}
    </div>
  );
}
