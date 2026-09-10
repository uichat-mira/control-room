import type { ControlRoomSummary } from "./shared";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

const summary = (): ControlRoomSummary => ({
  status: "operational",
  generatedAt: new Date().toISOString(),
  sources: {
    github: {
      label: "GitHub",
      status: "pending",
      detail: "Organization connector pending",
    },
    cloudflare: {
      label: "Cloudflare",
      status: "pending",
      detail: "Read-only runtime token pending",
    },
    health: {
      label: "Runtime",
      status: "ok",
      detail: "Control Room Worker online",
    },
  },
  builds: [
    {
      name: "Control Room",
      status: "running",
      detail: "V0.1 bootstrap",
    },
  ],
  services: [
    {
      name: "Control Room",
      status: "online",
      detail: "Worker + Static Assets",
    },
  ],
  work: {
    main: "Organization migration",
    next: "Connect GitHub and Cloudflare read models",
    blocked: "None",
  },
});

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "mira-control-room",
        version: "0.1.0",
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/summary") {
      return json(summary());
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
