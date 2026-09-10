import type { ServiceProbe } from "./shared";

async function probe(
  id: string,
  label: string,
  url: string,
  expected?: (response: Response) => Promise<boolean>,
): Promise<ServiceProbe> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "uichat-mira-control-room-health" },
    });
    const latencyMs = Date.now() - startedAt;
    const valid = response.ok && (expected ? await expected(response.clone()) : true);

    return {
      id,
      label,
      url,
      status: valid ? "online" : response.ok ? "degraded" : "offline",
      httpStatus: response.status,
      latencyMs,
      detail: valid ? "Healthy" : response.ok ? "Unexpected response" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      id,
      label,
      url,
      status: "offline",
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.name : "Probe failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getServiceSnapshot(): Promise<ServiceProbe[]> {
  return Promise.all([
    probe("website", "Mira Website", "https://mira.tomz.io/"),
    probe("relay", "Relay", "https://relay.tomz.io/health", async (response) => {
      try {
        const body = (await response.json()) as { ok?: boolean };
        return body.ok === true;
      } catch {
        return false;
      }
    }),
    Promise.resolve({
      id: "control-room",
      label: "Control Room",
      url: "https://uichat-mira-control-room.dangjingtao.workers.dev",
      status: "online" as const,
      httpStatus: 200,
      latencyMs: 0,
      detail: "Serving this request",
    }),
  ]);
}
