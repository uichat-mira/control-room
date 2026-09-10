import { useMemo } from "react";
import { GitPullRequest, ShieldAlert, ShieldCheck } from "lucide-react";
import { formatTime, type GovernancePayload, usePolling } from "./data";

const value = (input: number | null | undefined) =>
  input === null || input === undefined ? "—" : input;

export default function Governance() {
  const read = usePolling<GovernancePayload>("/api/v1/governance", 5 * 60_000);
  const data = read.data;

  const totals = useMemo(() => {
    const rows = data?.repositories.map((repo) => repo.governance) ?? [];
    const issues = rows
      .map((row) => row.openIssues)
      .filter((count): count is number => count !== null && count !== undefined);
    const prs = rows
      .map((row) => row.openPullRequests)
      .filter((count): count is number => count !== null && count !== undefined);
    const protectedRows = rows
      .map((row) => row.defaultBranchProtected)
      .filter((protectedBranch): protectedBranch is boolean => protectedBranch !== null && protectedBranch !== undefined);
    const rulesets = rows
      .map((row) => row.activeRulesets)
      .filter((count): count is number => count !== null && count !== undefined);

    return {
      issues: issues.length ? issues.reduce((sum, count) => sum + count, 0) : null,
      prs: prs.length ? prs.reduce((sum, count) => sum + count, 0) : null,
      protected: protectedRows.filter(Boolean).length,
      protectedKnown: protectedRows.length,
      rulesets: rulesets.length ? rulesets.reduce((sum, count) => sum + count, 0) : null,
    };
  }, [data]);

  if (!data) {
    return (
      <section className="page-state">
        <ShieldCheck size={16} />
        <div>
          <strong>Reading governance facts</strong>
          <small>{read.error ?? "Issues, pull requests, branch policy, and public Projects are loading."}</small>
        </div>
      </section>
    );
  }

  const projects = data.github.projects;
  const governanceStatus = data.github.governanceStatus;

  return (
    <section className="governance-page" aria-label="GitHub governance">
      <section className="source-strip source-strip-icons" aria-label="Governance data source">
        <span><ShieldCheck size={13} /> GitHub governance · {governanceStatus}</span>
        <span><GitPullRequest size={13} /> Public-safe · authenticated {data.github.authenticated ? "yes" : "no"}</span>
        <small>{formatTime(data.generatedAt)}</small>
      </section>

      <div className="governance-metrics">
        <div>
          <span>Open issues</span>
          <strong>{value(totals.issues)}</strong>
        </div>
        <div>
          <span>Open PRs</span>
          <strong>{value(totals.prs)}</strong>
        </div>
        <div>
          <span>Protected defaults</span>
          <strong>{totals.protectedKnown ? `${totals.protected}/${totals.protectedKnown}` : "—"}</strong>
        </div>
        <div>
          <span>Active rulesets</span>
          <strong>{value(totals.rulesets)}</strong>
        </div>
      </div>

      {data.error && <div className="governance-note governance-note-warn">{data.error}</div>}
      {read.error && <div className="governance-note governance-note-warn">{read.error}</div>}

      <div className="section-heading governance-heading">
        <div>
          <p className="eyebrow">POLICY / REPOSITORIES</p>
          <h2>Repository policy</h2>
        </div>
        <small>{data.repositories.length} public repositories</small>
      </div>

      <div className="governance-table" role="table" aria-label="Repository governance facts">
        <div className="governance-row governance-head" role="row">
          <span>Repository</span>
          <span>Issues</span>
          <span>PRs</span>
          <span>Default branch</span>
          <span>Rulesets</span>
        </div>
        {data.repositories.map((repo) => {
          const governance = repo.governance;
          const protection = governance.defaultBranchProtected;
          return (
            <a
              className="governance-row"
              href={repo.htmlUrl}
              target="_blank"
              rel="noreferrer"
              role="row"
              key={repo.fullName}
            >
              <span className="governance-name">
                <strong>{repo.name}</strong>
                <small>{governance.status === "partial" ? "partial read" : "repository policy"}</small>
              </span>
              <span data-label="Issues">{value(governance.openIssues)}</span>
              <span data-label="PRs">{value(governance.openPullRequests)}</span>
              <span
                data-label="Default branch"
                className={protection === true ? "policy-ok" : protection === false ? "policy-open" : ""}
              >
                <code>{repo.defaultBranch}</code>
                <small>{protection === true ? "protected" : protection === false ? "open" : "unknown"}</small>
              </span>
              <span data-label="Rulesets">{value(governance.activeRulesets)}</span>
            </a>
          );
        })}
      </div>

      <div className="projects-block">
        <div className="projects-heading">
          <strong>Public Projects</strong>
          <small>{projects.status === "connected" ? `${projects.items.length} visible` : "unavailable"}</small>
        </div>

        {projects.status === "connected" ? (
          projects.items.length ? (
            <div className="projects-list">
              {projects.items.map((project) => (
                <a className="project-row" href={project.url} target="_blank" rel="noreferrer" key={project.number}>
                  <span className="governance-name">
                    <strong>{project.title}</strong>
                    <small>{project.shortDescription || `Project #${project.number}`}</small>
                  </span>
                  <span>{project.itemCount} items</span>
                  <span className={project.closed ? "project-closed" : "policy-ok"}>{project.closed ? "closed" : "active"}</span>
                  <span>{formatTime(project.updatedAt)}</span>
                </a>
              ))}
            </div>
          ) : (
            <div className="governance-note">No public organization Project exposed.</div>
          )
        ) : (
          <div className="governance-note governance-note-warn">
            {projects.error || "GitHub Projects are not visible to this read token."}
          </div>
        )}
      </div>

      <div className="governance-footnote">
        <ShieldAlert size={12} /> Public-safe projection only · Project is an organization view; Issues remain engineering facts.
      </div>
    </section>
  );
}
