import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createTestHarness } from "wrangler";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const NEXT_HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const POLICY_COMMIT = "3333333333333333333333333333333333333333";
const POLICY_BLOB = "4444444444444444444444444444444444444444";
const OUTPUT_BLOB = "5555555555555555555555555555555555555555";

// The Cloudflare Vite build writes the production Worker config and a redirect to it.
const deployRedirectPath = resolve(".wrangler/deploy/config.json");
const deployRedirect = JSON.parse(
  readFileSync(deployRedirectPath, "utf8"),
) as { configPath: string };
const builtWorkerConfig = resolve(
  dirname(deployRedirectPath),
  deployRedirect.configPath,
);

// Keep GitHub as the mocked external boundary while the production Worker runs in workerd.
const network = setupServer();
const harness = createTestHarness({
  workers: [
    {
      configPath: builtWorkerConfig,
      secrets: {
        GITHUB_READ_TOKEN: "github-read",
        GITHUB_PUBLISH_TOKEN: "github-publish",
        AI_REVIEW_GATEWAY_TOKEN: "caller-token",
      },
    },
  ],
});

before(async () => {
  network.listen({ onUnhandledRequest: "error" });
  await harness.listen();
});

afterEach(async () => {
  network.resetHandlers();
  await harness.reset();
});

after(async () => {
  network.close();
  await harness.close();
});

function contentResponse(path: string, sha: string, content: string) {
  return HttpResponse.json({
    type: "file",
    path,
    sha,
    encoding: "base64",
    content: Buffer.from(content, "utf8").toString("base64"),
  });
}

function submission(review: unknown = {
  verdict: "NO_BLOCKING_FINDINGS",
  findings: [],
  validationGaps: [],
}) {
  return {
    repository: "uichat-mira/mira-desktop",
    pullRequest: 7,
    identity: {
      repository: "uichat-mira/mira-desktop",
      pullRequest: 7,
      reviewMode: "CODE_REVIEW",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      policyCommitSha: POLICY_COMMIT,
      policyBlobSha: POLICY_BLOB,
      outputContractBlobSha: OUTPUT_BLOB,
      profileBlobSha: null,
      rootContractBlobSha: null,
      taskContract: {
        state: "unavailable",
        reason: "no_linked_issue",
      },
    },
    execution: {
      engine: "opencode",
      provider: "opencode-go",
      model: "minimax-m3",
      role: "routine",
      latencyMs: 250,
      review,
    },
  };
}

function githubHandlers(options: {
  heads?: string[];
  published: string[];
}) {
  let pullRead = 0;
  const nextHead = () => {
    const heads = options.heads ?? [HEAD_SHA];
    const value = heads[Math.min(pullRead, heads.length - 1)];
    pullRead += 1;
    return value;
  };

  return [
    http.get(
      "https://api.github.com/repos/uichat-mira/mira-desktop/pulls/7",
      () =>
        HttpResponse.json({
          number: 7,
          title: "External review",
          body: null,
          draft: false,
          user: { login: "builder" },
          base: {
            ref: "dev",
            sha: BASE_SHA,
            repo: { full_name: "uichat-mira/mira-desktop" },
          },
          head: {
            ref: "feat/example",
            sha: nextHead(),
            repo: { full_name: "uichat-mira/mira-desktop" },
          },
        }),
    ),
    http.get(
      "https://api.github.com/repos/uichat-mira/.github/commits/main",
      () => HttpResponse.json({ sha: POLICY_COMMIT }),
    ),
    http.get(
      "https://api.github.com/repos/uichat-mira/.github/contents/ai-review/POLICY.md",
      () => contentResponse("ai-review/POLICY.md", POLICY_BLOB, "policy"),
    ),
    http.get(
      "https://api.github.com/repos/uichat-mira/.github/contents/ai-review/OUTPUT-CONTRACT.md",
      () => contentResponse("ai-review/OUTPUT-CONTRACT.md", OUTPUT_BLOB, "output"),
    ),
    http.get(
      "https://api.github.com/repos/uichat-mira/mira-desktop/contents/.ai/review-profile.md",
      () => new HttpResponse("not found", { status: 404 }),
    ),
    http.get(
      "https://api.github.com/repos/uichat-mira/mira-desktop/contents/AGENTS.md",
      () => new HttpResponse("not found", { status: 404 }),
    ),
    http.get(
      `https://api.github.com/repos/uichat-mira/mira-desktop/compare/${BASE_SHA}...${HEAD_SHA}`,
      () => new HttpResponse("diff --git a/a b/a\\n+change\\n"),
    ),
    http.get(
      `https://api.github.com/repos/uichat-mira/mira-desktop/compare/${BASE_SHA}...${NEXT_HEAD_SHA}`,
      () => new HttpResponse("diff --git a/a b/a\\n+newer\\n"),
    ),
    http.post(
      "https://api.github.com/graphql",
      () =>
        HttpResponse.json({
          data: {
            repository: {
              pullRequest: {
                closingIssuesReferences: { nodes: [] },
              },
            },
          },
        }),
    ),
    http.get(
      "https://api.github.com/user",
      () => HttpResponse.json({ login: "publisher" }),
    ),
    http.get(
      "https://api.github.com/repos/uichat-mira/mira-desktop/issues/7/comments",
      () => HttpResponse.json([]),
    ),
    http.post(
      "https://api.github.com/repos/uichat-mira/mira-desktop/issues/7/comments",
      async ({ request }) => {
        const body = (await request.json()) as { body: string };
        options.published.push(body.body);
        return HttpResponse.json({
          id: 41,
          body: body.body,
          user: { login: "publisher" },
        });
      },
    ),
  ];
}

async function submit(body: unknown) {
  const worker = harness.getWorker();
  return worker.fetch("/api/v1/ai-review/result", {
    method: "POST",
    headers: {
      authorization: "Bearer caller-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("Worker runtime publishes normalized external review through trusted handoff", async () => {
  const published: string[] = [];
  network.use(...githubHandlers({ published }));

  const response = await submit(submission());
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.equal(body.freshness.state, "CURRENT");
  assert.equal(body.execution.state, "COMPLETED");
  assert.equal(body.execution.review.verdict, "HUMAN_CHECK_NEEDED");
  assert.equal(body.execution.provider.engine, "opencode");
  assert.equal(published.length, 1);
  assert.match(published[0], /HUMAN_CHECK_NEEDED/);
  assert.match(published[0], /\*\*Engine:\*\* opencode/);
});

test("Worker runtime publishes STALE_REVIEW when head changes before write", async () => {
  const published: string[] = [];
  network.use(
    ...githubHandlers({
      heads: [HEAD_SHA, NEXT_HEAD_SHA],
      published,
    }),
  );

  const response = await submit(submission());
  const body = (await response.json()) as any;

  assert.equal(response.status, 409);
  assert.deepEqual(body.freshness, {
    state: "STALE_REVIEW",
    reasons: ["head_sha"],
  });
  assert.equal(published.length, 1);
  assert.match(published[0], /STALE_REVIEW/);
  assert.match(published[0], new RegExp(NEXT_HEAD_SHA));
});

test("Worker runtime replaces malformed external output with REVIEW_UNAVAILABLE", async () => {
  const published: string[] = [];
  network.use(...githubHandlers({ published }));

  const response = await submit(
    submission({
      verdict: "PASS",
      findings: [],
      validationGaps: [],
    }),
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 422);
  assert.equal(body.error, "invalid_external_review");
  assert.equal(published.length, 1);
  assert.match(published[0], /REVIEW_UNAVAILABLE/);
  assert.match(published[0], /external\\_review\\_invalid/);
});
