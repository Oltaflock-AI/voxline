export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-text">
        Voxline
      </p>
      <h1 className="font-display text-4xl italic text-text">
        Day-zero scaffold
      </h1>
      <p className="max-w-md text-center text-sm text-muted">
        Build from docs/Voxline-Spec.md. The prototype in
        docs/Voxline-UI-Prototype.html wins on look and interaction; the spec
        wins on data, rules and security.
      </p>
    </main>
  );
}
