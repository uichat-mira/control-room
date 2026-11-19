import type { GovernancePayload, GovernanceRepository } from "./data";

export type GovernanceFilter = "all" | "activity" | "review" | "unknown";

export type GovernanceInventory = {
  repositories: number;
  issues: number | null;
  issuesKnown: number;
  prs: number | null;
  prsKnown: number;
  protected: number;
  protectionKnown: number;
  unprotected: number;
  protectionUnknown: number;
  rulesets: number | null;
  rulesetsKnown: number;
  partialReads: number;
  activeRepos: number;
};

export function summarizeGovernance(rows: GovernanceRepository[] | null): GovernanceInventory | null {
  if (!rows) return null;
  const issues = rows.map(r => r.governance.openIssues).filter((n): n is number => n !== null);
  const prs = rows.map(r => r.governance.openPullRequests).filter((n): n is number => n !== null);
  const rulesets = rows.map(r => r.governance.activeRulesets).filter((n): n is number => n !== null);
  const protection = rows.map(r => r.governance.defaultBranchProtected);
  return {
    repositories: rows.length,
    issues: issues.length === 0 ? null : issues.reduce((a,b) => a+b,0),
    issuesKnown: issues.length,
    prs: prs.length === 0 ? null : prs.reduce((a,b) => a+b,0),
    prsKnown: prs.length,
    rulesets: rulesets.length === 0 ? null : rulesets.reduce((a,b) => a+b,0),
    rulesetsKnown: rulesets.length,
    protected: protection.filter(x => x === true).length,
    protectionKnown: protection.filter(x => x !== null).length,
    unprotected: protection.filter(x => x === false).length,
    protectionUnknown: protection.filter(x => x === null).length,
    partialReads: rows.filter(r => r.governance.status === "partial").length,
    activeRepos: rows.filter(r => (r.governance.openIssues ?? 0) > 0 || (r.governance.openPullRequests ?? 0) > 0).length,
  };
}

export function requiresPolicyReview(repo: GovernanceRepository): boolean {
  // GitHub branch protection=false is a review fact, not a policy violation.
  return repo.governance.defaultBranchProtected === false;
}

export function filterGovernance(
  rows: GovernanceRepository[], search: string, filter: GovernanceFilter,
): GovernanceRepository[] {
  const q = search.trim().toLocaleLowerCase();
  return rows.filter(r => {
    const g = r.governance;
    if (filter === "review" && !requiresPolicyReview(r)) return false;
    if (filter === "activity" && (g.openIssues ?? 0) === 0 && (g.openPullRequests ?? 0) === 0) return false;
    if (filter === "unknown" && !(g.status === "partial" ||
      g.defaultBranchProtected === null || g.openIssues === null ||
      g.openPullRequests === null || g.activeRulesets === null)) return false;
    if (q && ![r.name, r.fullName, r.defaultBranch].some(x => x.toLocaleLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b) =>
    (b.governance.openPullRequests ?? 0) - (a.governance.openPullRequests ?? 0) ||
    (b.governance.openIssues ?? 0) - (a.governance.openIssues ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

export function governanceSourcePartial(data: GovernancePayload | null, refreshError: string | null): boolean {
  return Boolean(refreshError || !data || data.status !== "connected" ||
    data.github.governanceStatus === "partial" ||
    data.github.projects.status !== "connected" ||
    data.repositories.some(r => r.governance.status === "partial"));
}
