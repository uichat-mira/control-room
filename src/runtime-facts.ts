import type { ServiceProbe } from "./shared";
import type { CloudflareWorkerAnalytics } from "./cloudflare-analytics";

export type RuntimeRisk = "offline" | "degraded" | "online";

export function servicePriority(item: ServiceProbe): number {
  return item.status === "offline" ? 0 : item.status === "degraded" ? 1 : 2;
}

export function orderServices(services: ServiceProbe[]): ServiceProbe[] {
  return [...services].sort((a, b) =>
    servicePriority(a) - servicePriority(b) || a.label.localeCompare(b.label),
  );
}

export function summarizeProbes(services: ServiceProbe[] | null) {
  if (!services) return null;
  return {
    total: services.length,
    online: services.filter(s => s.status === "online").length,
    degraded: services.filter(s => s.status === "degraded").length,
    offline: services.filter(s => s.status === "offline").length,
  };
}

export function workerTrafficRows(workers: CloudflareWorkerAnalytics[]) {
  return workers
    .filter(x => x.requests > 0)
    .map(x => ({
      name: x.name.replace(/^uichat-mira-/, ""),
      fullName: x.name,
      requests: x.requests,
      errors: x.errors,
      truncated: x.truncated,
    }))
    .sort((a, b) => b.requests - a.requests || b.errors - a.errors || a.name.localeCompare(b.name));
}

export function analyticsCoverage(workers: CloudflareWorkerAnalytics[] | null): "unknown" | "truncated" | "observed" {
  if (!workers) return "unknown";
  return workers.some(x => x.truncated) ? "truncated" : "observed";
}
