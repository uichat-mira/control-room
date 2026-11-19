import type { OrganizationRepository, RepositoryWorkflow } from "./shared";

export type BuildState = "failed" | "action" | "running" | "passed" | "neutral" | "unknown";
export type FleetFilter = "all" | "attention" | "running" | "archived";

export function buildState(run: RepositoryWorkflow | null): BuildState {
  if (!run) return "unknown";
  if (run.status === "queued" || run.status === "in_progress") return "running";
  if (run.conclusion === "success") return "passed";
  if (run.conclusion === "action_required") return "action";
  if (["failure", "timed_out", "startup_failure"].includes(run.conclusion ?? "")) return "failed";
  if (["cancelled", "skipped", "neutral"].includes(run.conclusion ?? "")) return "neutral";
  // A completed Run without a trustworthy conclusion (or stale/other
  // GitHub conclusion) does not establish success or failure.
  return "unknown";
}

export function buildLabel(run: RepositoryWorkflow | null): string {
  const state = buildState(run);
  if (!run) return "尚无构建记录";
  if (state === "running") return run.status === "queued" ? "排队中" : "构建执行中";
  if (state === "passed") return "Run 通过";
  if (state === "failed") return "Run " + (run.conclusion ?? "失败");
  if (state === "action") return "需要人工操作";
  if (state === "neutral") return "Run " + (run.conclusion ?? "中立");
  return "结果未知";
}

export function summarizeFleet(repositories: OrganizationRepository[]) {
  const counts = { passed: 0, failed: 0, action: 0, running: 0, neutral: 0, unknown: 0 };
  for (const repo of repositories) counts[buildState(repo.latestWorkflow)]++;
  return {
    counts,
    withRuns: repositories.filter((repo) => repo.latestWorkflow !== null).length,
    released: repositories.filter((repo) => repo.latestRelease !== null).length,
    nonArchived: repositories.filter((repo) => !repo.archived).length,
  };
}

export function filterFleet(
  repositories: OrganizationRepository[],
  search: string,
  filter: FleetFilter,
): OrganizationRepository[] {
  const q = search.trim().toLocaleLowerCase();
  const ranks: Record<BuildState, number> = { failed: 0, action: 1, running: 2, unknown: 3, neutral: 4, passed: 5 };
  const timestamp = (value: string | null) => {
    const number = Date.parse(value ?? "");
    return Number.isFinite(number) ? number : 0;
  };
  return repositories
    .filter((repo) => {
      const phase = buildState(repo.latestWorkflow);
      if (filter === "attention" && phase !== "failed" && phase !== "action") return false;
      if (filter === "running" && phase !== "running") return false;
      if (filter === "archived" && !repo.archived) return false;
      if (!q) return true;
      return [repo.name, repo.fullName, repo.description ?? "", repo.language ?? "", repo.defaultBranch]
        .some((value) => value.toLocaleLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      return ranks[buildState(a.latestWorkflow)] - ranks[buildState(b.latestWorkflow)] ||
        timestamp(b.latestWorkflow?.updatedAt ?? b.pushedAt) -
        timestamp(a.latestWorkflow?.updatedAt ?? a.pushedAt) ||
        a.name.localeCompare(b.name);
    });
}
