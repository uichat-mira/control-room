import { useEffect, useMemo, useState } from "react";
import type { ControlRoomSummary, SourceStatus } from "./shared";

const fallback: ControlRoomSummary = {
  status: "degraded",
  generatedAt: new Date().toISOString(),
  sources: {
    github: { label: "GitHub", status: "unavailable", detail: "API unavailable" },
    cloudflare: { label: "Cloudflare", status: "unavailable", detail: "API unavailable" },
    health: { label: "Runtime", status: "unavailable", detail: "API unavailable" },
  },
  builds: [],
  services: [],
  work: { main: "Unknown", next: "Unknown", blocked: "Unknown" },
};

const sourceGlyph = (status: SourceStatus) =>
  status === "ok" ? "●" : status === "pending" ? "◐" : "○";

export default function App() {
  const [data, setData] = useState<ControlRoomSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/summary")
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<ControlRoomSummary>;
      })
      .then(setData)
      .catch(() => {
        setFailed(true);
        setData(fallback);
      });
  }, []);

  const view = data ?? fallback;
  const generatedAt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(view.generatedAt)),
    [view.generatedAt],
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MIRA / CONTROL ROOM</p>
          <h1>System overview</h1>
        </div>
        <div className="system-state">
          <span className={"beacon " + view.status} />
          <div>
            <strong>{view.status.toUpperCase()}</strong>
            <small>{failed ? "API disconnected" : "updated " + generatedAt}</small>
          </div>
        </div>
      </header>

      <section className="source-strip" aria-label="Data sources">
        {Object.values(view.sources).map((source) => (
          <article className="source" key={source.label}>
            <span className={"source-glyph " + source.status}>{sourceGlyph(source.status)}</span>
            <div>
              <strong>{source.label}</strong>
              <small>{source.detail}</small>
            </div>
          </article>
        ))}
      </section>

      <section className="grid">
        <article className="panel panel-wide">
          <div className="panel-heading">
            <span>Builds</span>
            <small>{view.builds.length} active</small>
          </div>
          <div className="rows">
            {view.builds.length === 0 ? (
              <p className="empty">No build data yet.</p>
            ) : (
              view.builds.map((build) => (
                <div className="row" key={build.name}>
                  <div>
                    <strong>{build.name}</strong>
                    <small>{build.detail}</small>
                  </div>
                  <span className={"pill " + build.status}>{build.status}</span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <span>Services</span>
            <small>runtime</small>
          </div>
          <div className="rows">
            {view.services.map((service) => (
              <div className="row compact" key={service.name}>
                <div>
                  <strong>{service.name}</strong>
                  <small>{service.detail}</small>
                </div>
                <span className={"dot " + service.status} />
              </div>
            ))}
          </div>
        </article>

        <article className="panel work-panel">
          <div className="panel-heading">
            <span>Work</span>
            <small>SSOT projection</small>
          </div>
          <dl>
            <div>
              <dt>Main</dt>
              <dd>{view.work.main}</dd>
            </div>
            <div>
              <dt>Next</dt>
              <dd>{view.work.next}</dd>
            </div>
            <div>
              <dt>Blocked</dt>
              <dd>{view.work.blocked}</dd>
            </div>
          </dl>
        </article>
      </section>

      <footer>
        <span>Mira is building.</span>
        <span>v0.1.0 · read-only by design</span>
      </footer>
    </main>
  );
}
