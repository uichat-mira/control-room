import { useEffect, useMemo, useState } from "react";
import type {
  GitHubOrganizationObservability,
  RepositoryGovernance,
} from "./shared";

interface GovernanceRepository {
  name: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  governance?: RepositoryGovernance;
}

interface GovernancePayload {
  generatedAt: string;
  organization: {
    login: string;
    htmlUrl: string;
  };
  github?: GitHubOrganizationObservability;
  repositories: GovernanceRepository[];
}

const formatTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const value = (input: number | null | undefined) => (input === null || input === undefined ? "—" : input);

export default function Governance() {
  const isWall = window.location.pathname === "/wall";
  const [data, setData] = useState<GovernancePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isWall) return;
    let active = true;

    const refresh = () => {
      fetch("/api/governance", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Governance API ${response.status}`);
          return response.json() as Promise<GovernancePayload>;
        })
        .then((body) => {
          if (!active) return;
          setData(body);
          setError(null);
        })
        .catch((reason) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : "Governance data unavailable");
        });
    };

    refresh();
    const timer = window.setInterval(refresh, 5 * 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isWall]);

  const totals = useMemo(() => {
    const rows = data?.repositories.map((repo) => repo.governance).filter(Boolean) ?? [];
    const issues = rows.map((row) => row?.openIssues).filter((count): count is number => count !== null && count !== undefined);
    const prs = rows.map((row) => row?.openPullRequests).filter((count): count is number => count !== null && count !== undefined);
    const protectedRows = rows
      .map((row) => row?.defaultBranchProtected)
      .filter((protectedBranch): protectedBranch is boolean => protectedBranch !== null && protectedBranch !== undefined);
    const rulesets = rows.map((row) => row?.activeRulesets).filter((count): count is number => count !== null && count !== undefined);

    return {
      issues: issues.length ? issues.reduce((sum, count) => sum + count, 0) : null,
      prs: prs.length ? prs.reduce((sum, count) => sum + count, 0) : null,
      protected: protectedRows.filter(Boolean).length,
      protectedKnown: protectedRows.length,
      rulesets: rulesets.length ? rulesets.reduce((sum, count) => sum + count, 0) : null,
    };
  }, [data]);

  if (isWall) return null;

  const projects = data?.github?.projects;
  const governanceStatus = data?.github?.governanceStatus ?? "partial";

  return (
    <section className="governance-shell" aria-label="GitHub governance">
      <div className="section-heading governance-heading">
        <div>
          <p className="eyebrow">GOVERNANCE / GITHUB</p>
          <h2>Work & policy</h2>
        </div>
        <small>
          {governanceStatus === "connected" ? "organization read model connected" : "partial visibility"}
          {data ? ` · ${formatTime(data.generatedAt)}` : ""}
        </small>
      </div>

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

      {error && !data ? (
        <div className="governance-note governance-note-warn">{error}</div>
      ) : (
        <div className="governance-table" role="table" aria-label="Repository governance facts">
          <div className="governance-row governance-head" role="row">
            <span>Repository</span>
            <span>Issues</span>
            <span>PRs</span>
            <span>Default branch</span>
            <span>Rulesets</span>
          </div>
          {(data?.repositories ?? []).map((repo) => {
            const governance = repo.governance;
            const protection = governance?.defaultBranchProtected;
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
                  <small>{governance?.status === "partial" ? "partial read" : "repository policy"}</small>
                </span>
                <span data-label="Issues">{value(governance?.openIssues)}</span>
                <span data-label="PRs">{value(governance?.openPullRequests)}</span>
                <span data-label="Default branch" className={protection === true ? "policy-ok" : protection === false ? "policy-open" : ""}>
                  <code>{repo.defaultBranch}</code>
                  <small>{protection === true ? "protected" : protection === false ? "open" : "unknown"}</small>
                </span>
                <span data-label="Rulesets">{value(governance?.activeRulesets)}</span>
              </a>
            );
          })}
        </div>
      )}

      <div className="projects-block">
        <div className="projects-heading">
          <strong>Public Projects</strong>
          <small>{projects?.status === "connected" ? `${projects.items.length} visible` : "unavailable"}</small>
        </div>

        {projects?.status === "connected" ? (
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
            {projects?.error || "GitHub Projects are not visible to this read token."}
          </div>
        )}
      </div>

      <div className="governance-footnote">
        Public-safe projection only · authenticated reads never surface private repository or private Project metadata here.
      </div>
    </section>
  );
}
