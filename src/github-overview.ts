import type {
  OrganizationSnapshot,
  RepositoryWorkflow,
  WorkflowConclusion,
} from "./shared";

const FAILURE_CONCLUSIONS = new Set<WorkflowConclusion>([
  "failure",
  "timed_out",
  "action_required",
  "startup_failure",
]);

export interface GitHubOverviewStats {
  repositories: number;
  trackedBuilds: number;
  successfulBuilds: number;
  failedBuilds: number;
  runningBuilds: number;
  services: number;
  onlineServices: number;
}

export function getGitHubOverviewStats(snapshot: OrganizationSnapshot): GitHubOverviewStats {
  const workflows = snapshot.repositories
    .map((repository) => repository.latestWorkflow)
    .filter((workflow): workflow is RepositoryWorkflow => workflow !== null);

  return {
    repositories: snapshot.repositories.length,
    trackedBuilds: workflows.length,
    successfulBuilds: workflows.filter(
      (workflow) => workflow.status === "completed" && workflow.conclusion === "success",
    ).length,
    failedBuilds: workflows.filter(
      (workflow) =>
        workflow.status === "completed" && FAILURE_CONCLUSIONS.has(workflow.conclusion),
    ).length,
    runningBuilds: workflows.filter((workflow) => workflow.status !== "completed").length,
    services: snapshot.services.length,
    onlineServices: snapshot.services.filter((service) => service.status === "online").length,
  };
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated recently";
  return `Updated ${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function sourceLabel(name: string, state: string) {
  if (state === "connected") return `${name} connected`;
  if (state === "unconfigured") return `${name} unconfigured`;
  return `${name} attention`;
}

export function renderGitHubOverviewSvg(snapshot: OrganizationSnapshot): string {
  const stats = getGitHubOverviewStats(snapshot);
  const healthy = snapshot.status === "connected";
  const statusLabel = healthy ? "All systems nominal" : "Attention needed";
  const statusColor = healthy ? "#3fb950" : "#d29922";
  const buildsLabel =
    stats.trackedBuilds === 0
      ? "No CI data"
      : `${stats.successfulBuilds}/${stats.trackedBuilds} green`;
  const servicesLabel = `${stats.onlineServices}/${stats.services} online`;
  const githubLabel = sourceLabel("GitHub", snapshot.sources.github);
  const cloudflareLabel = sourceLabel("Cloudflare", snapshot.sources.cloudflare);
  const updatedLabel = formatGeneratedAt(snapshot.generatedAt);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" viewBox="0 0 900 220" role="img" aria-labelledby="title desc">
  <title id="title">Mira Control Room organization snapshot</title>
  <desc id="desc">${statusLabel}. ${stats.repositories} repositories, ${buildsLabel} latest CI, ${servicesLabel} services.</desc>
  <rect width="900" height="220" rx="18" fill="#0d1117"/>
  <rect x="0.5" y="0.5" width="899" height="219" rx="17.5" fill="none" stroke="#30363d"/>
  <circle cx="38" cy="38" r="7" fill="#c15f3c"/>
  <text x="58" y="45" fill="#f0f6fc" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="19" font-weight="700">Mira Control Room</text>
  <text x="58" y="68" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12">ORGANIZATION SNAPSHOT</text>

  <rect x="650" y="24" width="220" height="34" rx="17" fill="#161b22" stroke="#30363d"/>
  <circle cx="672" cy="41" r="5" fill="${statusColor}"/>
  <text x="686" y="46" fill="#f0f6fc" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="13" font-weight="600">${statusLabel}</text>

  <rect x="28" y="92" width="198" height="72" rx="12" fill="#161b22" stroke="#21262d"/>
  <text x="46" y="118" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12">REPOSITORIES</text>
  <text x="46" y="148" fill="#f0f6fc" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="25" font-weight="700">${stats.repositories}</text>

  <rect x="242" y="92" width="198" height="72" rx="12" fill="#161b22" stroke="#21262d"/>
  <text x="260" y="118" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12">LATEST CI</text>
  <text x="260" y="148" fill="#f0f6fc" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="20" font-weight="700">${buildsLabel}</text>

  <rect x="456" y="92" width="198" height="72" rx="12" fill="#161b22" stroke="#21262d"/>
  <text x="474" y="118" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12">SERVICES</text>
  <text x="474" y="148" fill="#f0f6fc" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="20" font-weight="700">${servicesLabel}</text>

  <rect x="670" y="92" width="200" height="72" rx="12" fill="#161b22" stroke="#21262d"/>
  <text x="688" y="117" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12">SOURCES</text>
  <text x="688" y="138" fill="#f0f6fc" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12" font-weight="600">${githubLabel}</text>
  <text x="688" y="156" fill="#f0f6fc" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12" font-weight="600">${cloudflareLabel}</text>

  <text x="28" y="196" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12">${updatedLabel}</text>
  <text x="870" y="196" text-anchor="end" fill="#c15f3c" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12" font-weight="600">Open Control Room →</text>
</svg>`;
}

export function renderGitHubOverviewUnavailableSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="160" viewBox="0 0 900 160" role="img" aria-labelledby="title desc">
  <title id="title">Mira Control Room snapshot unavailable</title>
  <desc id="desc">The Control Room could not produce its organization snapshot.</desc>
  <rect width="900" height="160" rx="18" fill="#0d1117"/>
  <rect x="0.5" y="0.5" width="899" height="159" rx="17.5" fill="none" stroke="#30363d"/>
  <circle cx="38" cy="38" r="7" fill="#c15f3c"/>
  <text x="58" y="45" fill="#f0f6fc" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="19" font-weight="700">Mira Control Room</text>
  <text x="28" y="98" fill="#d29922" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="18" font-weight="700">Snapshot temporarily unavailable</text>
  <text x="28" y="124" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12">Open the Control Room for the current operational view.</text>
  <text x="870" y="124" text-anchor="end" fill="#c15f3c" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12" font-weight="600">Open Control Room →</text>
</svg>`;
}
