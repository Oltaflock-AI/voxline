import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/tenant";
import { OUTCOME_META } from "@/lib/outcomes";
import {
  formatCallDate,
  formatDuration,
  hasBrief,
  parseAnalysis,
  parseTranscript,
} from "@/lib/calls";
import { AudioPlayer } from "@/components/call/audio-player";
import { CallWave } from "@/components/call/call-wave";
import { ScorePanel } from "@/components/call/score-panel";
import { Transcript } from "@/components/call/transcript";
import { TripBrief } from "@/components/call/trip-brief";
import type { RecordingStatus } from "@/lib/recording-retry";
import type { VoiceProvider } from "@/lib/ingest";

/** Keyed by the `voice_provider` enum, so adding a provider is a type error
 *  here until this is updated. That is the point. */
const PROVIDER_LABELS: Record<VoiceProvider, string> = {
  sarvam: "Sarvam",
  retell: "Retell AI",
  vapi: "Vapi",
};

export default async function CallDetailPage(
  props: PageProps<"/app/[tenant]/calls/[callId]">
) {
  const { tenant: slug, callId } = await props.params;
  const { tenant } = await requireTenant(slug);
  const supabase = await createClient();

  const [{ data: call }, { data: lead }] = await Promise.all([
    supabase
      .from("calls")
      .select("*, voice_agents(name, phone_number)")
      .eq("tenant_id", tenant.id)
      .eq("id", callId)
      .maybeSingle(),
    supabase
      .from("leads")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("call_id", callId)
      .maybeSingle(),
  ]);

  if (!call) notFound();

  const caller = call.caller_name ?? "Unknown Caller";
  const meta = call.outcome ? OUTCOME_META[call.outcome] : null;
  const analysis = parseAnalysis(call.analysis);
  const turns = parseTranscript(call.transcript);
  const agentName = call.voice_agents?.name ?? "Voice agent";

  return (
    <section className="panel on call-detail">
      <Link className="call-back" href={`/app/${tenant.slug}/calls`}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        Back to calls
      </Link>

      <header className={`card call-detail-hero ${meta?.cssKey ?? ""}`}>
        <div className="call-detail-wave">
          <CallWave seed={call.id.charCodeAt(0)} bars={17} />
        </div>

        <div className="call-detail-identity">
          <span className="lab">Call record</span>
          <div className="call-detail-title">
            <h2>{caller}</h2>
            {meta && (
              <span className={`badge ${meta.badge}`}>
                <span className="dot" />
                {meta.label}
              </span>
            )}
          </div>
          <p>
            <span>{call.caller_phone ?? "Caller number not captured"}</span>
            <span className="identity-sep" aria-hidden="true"> · </span>
            <span>{formatCallDate(call.started_at)}</span>
          </p>
        </div>

        <div className="call-detail-duration">
          <span className="lab">Duration</span>
          <strong className="num">{formatDuration(call.duration_seconds)}</strong>
        </div>
      </header>

      <ScorePanel
        score={call.lead_score}
        outcome={call.outcome}
        analysis={analysis}
        durationSeconds={call.duration_seconds}
      />

      <div className="call-detail-grid">
        <main className="call-detail-main">
          <section className="card recording-card" aria-labelledby="recording-title">
            <div className="detail-section-head">
              <div>
                <span className="lab">Recording</span>
                <h3 id="recording-title">Listen to the call</h3>
              </div>
              <span className="card-sub">Private · only your agency can listen</span>
            </div>
            <AudioPlayer
              callId={call.id}
              durationSeconds={call.duration_seconds}
              hasRecording={Boolean(call.recording_path)}
              recordingStatus={call.recording_status as RecordingStatus}
            />
          </section>

          <section className="card transcript-card" aria-labelledby="transcript-title">
            <div className="detail-section-head transcript-head">
              <div>
                <span className="lab">Conversation</span>
                <h3 id="transcript-title">Transcript</h3>
              </div>
              <span className="card-sub">
                {turns.length} {turns.length === 1 ? "turn" : "turns"}
              </span>
            </div>
            <Transcript turns={turns} />
          </section>
        </main>

        <aside className="call-detail-aside">
          <section className="call-detail-brief" aria-labelledby="brief-title">
            <h3 id="brief-title" className="sr-only">Trip brief</h3>
            {hasBrief(analysis) ? (
              <TripBrief
                analysis={analysis}
                leadHref={
                  lead ? `/app/${tenant.slug}/pipeline?call=${call.id}` : undefined
                }
              />
            ) : (
              <div className="card detail-empty">
                <span className="lab">Trip brief</span>
                <b>No trip details captured</b>
                <p>This call did not produce any trip details.</p>
              </div>
            )}
          </section>

          <section className="card call-facts" aria-labelledby="facts-title">
            <div className="detail-section-head">
              <div>
                <span className="lab">Call information</span>
                <h3 id="facts-title">Details</h3>
              </div>
            </div>
            <dl>
              <div><dt>Caller</dt><dd>{caller}</dd></div>
              <div><dt>Phone</dt><dd>{call.caller_phone ?? "Not captured"}</dd></div>
              <div><dt>Date and time</dt><dd>{formatCallDate(call.started_at)}</dd></div>
              <div><dt>Duration</dt><dd>{formatDuration(call.duration_seconds)}</dd></div>
              <div><dt>Outcome</dt><dd>{meta?.label ?? "Not classified"}</dd></div>
              <div><dt>Handled by</dt><dd>{agentName}</dd></div>
              <div><dt>Provider</dt><dd>{PROVIDER_LABELS[call.provider]}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </section>
  );
}
