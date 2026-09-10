export type CloudflareAnalyticsStatus = "connected" | "unavailable";

export interface CloudflareWorkerAnalytics {
  name: string;
  requests: number;
  errors: number;
  errorRate: number;
  subrequests: number;
  truncated: boolean;
}

export interface CloudflareAnalytics24h {
  status: CloudflareAnalyticsStatus;
  from: string;
  to: string;
  requests: number;
  errors: number;
  errorRate: number;
  workers: CloudflareWorkerAnalytics[];
  error?: string;
}

interface WorkerAnalyticsRow {
  sum?: { requests?: number; errors?: number; subrequests?: number };
}

interface WorkerAnalyticsGraphQL {
  viewer?: {
    accounts?: Array<{
      workersInvocationsAdaptive?: WorkerAnalyticsRow[];
    }>;
  };
}

export type GraphQLRunner = <T>(
  query: string,
  variables: Record<string, string>,
) => Promise<T>;

const ANALYTICS_LIMIT = 10_000;

function rate(errors: number, requests: number): number {
  if (requests <= 0) return 0;
  return Math.round((errors / requests) * 100_000) / 1_000;
}

export function unavailableAnalytics(error?: string): CloudflareAnalytics24h {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return {
    status: "unavailable",
    from,
    to,
    requests: 0,
    errors: 0,
    errorRate: 0,
    workers: [],
    ...(error ? { error } : {}),
  };
}

export async function getWorkerAnalytics24h(
  accountTag: string,
  scriptNames: string[],
  runGraphQL: GraphQLRunner,
): Promise<CloudflareAnalytics24h> {
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const query = `
    query GetWorkersAnalytics($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          workersInvocationsAdaptive(limit: ${ANALYTICS_LIMIT}, filter: {
            scriptName: $scriptName,
            datetime_geq: $datetimeStart,
            datetime_leq: $datetimeEnd
          }) {
            sum { requests errors subrequests }
          }
        }
      }
    }
  `;

  const workers = await Promise.all(
    scriptNames.map(async (name): Promise<CloudflareWorkerAnalytics> => {
      const data = await runGraphQL<WorkerAnalyticsGraphQL>(query, {
        accountTag,
        datetimeStart: from,
        datetimeEnd: to,
        scriptName: name,
      });
      const rows = data.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
      const totals = rows.reduce(
        (sum, row) => ({
          requests: sum.requests + (row.sum?.requests ?? 0),
          errors: sum.errors + (row.sum?.errors ?? 0),
          subrequests: sum.subrequests + (row.sum?.subrequests ?? 0),
        }),
        { requests: 0, errors: 0, subrequests: 0 },
      );

      return {
        name,
        ...totals,
        errorRate: rate(totals.errors, totals.requests),
        truncated: rows.length >= ANALYTICS_LIMIT,
      };
    }),
  );

  workers.sort((a, b) => b.requests - a.requests || b.errors - a.errors || a.name.localeCompare(b.name));
  const requests = workers.reduce((sum, worker) => sum + worker.requests, 0);
  const errors = workers.reduce((sum, worker) => sum + worker.errors, 0);

  return {
    status: "connected",
    from,
    to,
    requests,
    errors,
    errorRate: rate(errors, requests),
    workers,
  };
}
