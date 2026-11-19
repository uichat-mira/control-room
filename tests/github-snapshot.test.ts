import assert from "node:assert/strict";
import test, { after, before, afterEach } from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { getGitHubSnapshot } from "../src/github.ts";

const network = setupServer();
let workflowCalls = 0;
let graphqlCalls = 0;
let releaseRestCalls = 0;

before(() => network.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  network.resetHandlers();
  workflowCalls = 0;
  graphqlCalls = 0;
  releaseRestCalls = 0;
});
after(() => network.close());

const repo = (name: string, nodeId: string, defaultBranch = "prod") => ({
  node_id: nodeId,
  name,
  full_name: `uichat-mira/${name}`,
  html_url: `https://github.com/uichat-mira/${name}`,
  description: null,
  visibility: "public",
  default_branch: defaultBranch,
  archived: false,
  fork: false,
  language: "TypeScript",
  pushed_at: "2026-11-18T06:00:00Z",
  updated_at: "2026-11-18T06:00:00Z",
  open_issues_count: 0,
  stargazers_count: 0,
});

test("batches latest releases instead of spending one REST subrequest per repository", async () => {
  network.use(
    http.get("https://api.github.com/orgs/uichat-mira", () =>
      HttpResponse.json({
        login: "uichat-mira",
        name: "Mira",
        html_url: "https://github.com/uichat-mira",
        avatar_url: "https://example.test/avatar.png",
        description: null,
        public_repos: 3,
        followers: 0,
      }),
    ),
    http.get("https://api.github.com/orgs/uichat-mira/repos", () =>
      HttpResponse.json([
        repo("control-room", "R_control_room"),
        repo("mira-mobile", "R_mira_mobile"),
        repo(".github", "R_org_meta", "main"),
      ]),
    ),
    http.get("https://api.github.com/repos/uichat-mira/:repo/actions/runs", ({ params }) => {
      workflowCalls += 1;
      return HttpResponse.json({
        workflow_runs: [{
          name: "CI",
          status: "completed",
          conclusion: "success",
          html_url: `https://github.com/uichat-mira/${params.repo}/actions/runs/1`,
          created_at: "2026-11-18T05:00:00Z",
          updated_at: "2026-11-18T05:01:00Z",
        }],
      });
    }),
    http.get("https://api.github.com/repos/uichat-mira/:repo/releases/latest", () => {
      releaseRestCalls += 1;
      return HttpResponse.json({}, { status: 500 });
    }),
    http.post("https://api.github.com/graphql", async ({ request }) => {
      graphqlCalls += 1;
      const body = await request.json() as { variables?: { ids?: string[] } };
      assert.deepEqual(body.variables?.ids, ["R_control_room", "R_mira_mobile", "R_org_meta"]);
      return HttpResponse.json({
        data: {
          nodes: [
            {
              name: "control-room",
              latestRelease: {
                tagName: "v0.2.0",
                name: "Control Room 0.2.0",
                url: "https://github.com/uichat-mira/control-room/releases/tag/v0.2.0",
                publishedAt: "2026-11-18T04:00:00Z",
              },
            },
            { name: "mira-mobile", latestRelease: null },
            { name: ".github", latestRelease: null },
          ],
        },
      });
    }),
  );

  const snapshot = await getGitHubSnapshot({ GITHUB_READ_TOKEN: "github-read" });

  assert.equal(snapshot.status, "connected");
  assert.equal(workflowCalls, 2, "only repositories with runnable workflows are queried");
  assert.equal(graphqlCalls, 1, "latest releases must use one bounded GraphQL request");
  assert.equal(releaseRestCalls, 0, "per-repository release REST fan-out must not return");

  const controlRoom = snapshot.repositories.find((item) => item.name === "control-room");
  assert.equal(controlRoom?.latestRelease?.tagName, "v0.2.0");
  assert.equal(controlRoom?.latestWorkflow?.conclusion, "success");

  const metadataRepo = snapshot.repositories.find((item) => item.name === ".github");
  assert.equal(metadataRepo?.latestWorkflow, null);
});

test("missing authenticated release enrichment is explicit instead of silently faning out", async () => {
  network.use(
    http.get("https://api.github.com/orgs/uichat-mira", () =>
      HttpResponse.json({
        login: "uichat-mira",
        name: "Mira",
        html_url: "https://github.com/uichat-mira",
        avatar_url: "",
        description: null,
        public_repos: 1,
        followers: 0,
      }),
    ),
    http.get("https://api.github.com/orgs/uichat-mira/repos", () =>
      HttpResponse.json([repo(".github", "R_org_meta", "main")]),
    ),
  );

  const snapshot = await getGitHubSnapshot();

  assert.equal(snapshot.status, "degraded");
  assert.match(snapshot.error ?? "", /authenticated github token/i);
  assert.equal(graphqlCalls, 0);
  assert.equal(releaseRestCalls, 0);
});
