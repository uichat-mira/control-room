export type SourceStatus = "ok" | "pending" | "unavailable";

export interface SourceState {
  label: string;
  status: SourceStatus;
  detail: string;
}

export interface ControlRoomSummary {
  status: "operational" | "degraded";
  generatedAt: string;
  sources: {
    github: SourceState;
    cloudflare: SourceState;
    health: SourceState;
  };
  builds: Array<{
    name: string;
    status: "passed" | "running" | "pending";
    detail: string;
  }>;
  services: Array<{
    name: string;
    status: "online" | "unknown";
    detail: string;
  }>;
  work: {
    main: string;
    next: string;
    blocked: string;
  };
}
