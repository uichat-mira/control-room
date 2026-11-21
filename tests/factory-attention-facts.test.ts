import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { readWorkerIssueState, workerIssuePath } from "../src/factory-attention-facts.ts";

const network = setupServer();
const token = "worker-attention-fixture-secret";
const env = { GITHUB_READ_TOKEN: token };
const base = "https://api.github.com";
const now = Date.parse("2026-11-21T02:00:00Z");

before(() => network.listen({ onUnhandledRequest: "error" }));
afterEach(() => network.resetHandlers());
after(() => network.close());

function issuePayload(overrides: Record<string, unknown> = {}) {
  return {
    number: 482,
    state: "open",
    state_reason: null,
    title: "[DSK-016] Unify ordinary Desktop Dev with secure Cloud Host runtime",
    html_url: "https://github.com/uichat-mira/mira-desktop/issues/482",
    updated_at: "2026-11-19T16:06:32Z",
    closed_at: null,
    ...overrides,
  };
}

test("reads one public Issue state with the bounded read token and no credential leakage", async () => {
  let calls = 0;
  let authorization: string | null = null;
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, ({ request }) => {
      calls += 1;
      authorization = request.headers.get("authorization");
      return HttpResponse.json(issuePayload());
    }),
  );

  const lookup = await readWorkerIssueState(env, "uichat-mira/mira-desktop", 482, now);

  assert.equal(calls, 1);
  assert.equal(authorization, `Bearer ${token}`);
  assert.equal(lookup.query.status, "ok");
  assert.equal(lookup.issue?.number, 482);
  assert.equal(lookup.issue?.state, "open");
  assert.equal(lookup.issue?.closedAt, null);
  assert.equal(lookup.issue?.stateReason, null);
  assert.doesNotMatch(JSON.stringify(lookup), new RegExp(token));
});

test("closed Issue state and close reason are preserved", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () =>
      HttpResponse.json(
        issuePayload({
          state: "closed",
          state_reason: "completed",
          closed_at: "2026-11-19T16:06:32Z",
        }),
      ),
    ),
  );
  const lookup = await readWorkerIssueState(env, "uichat-mira/mira-desktop", 482, now);
  assert.equal(lookup.issue?.state, "closed");
  assert.equal(lookup.issue?.stateReason, "completed");
  assert.equal(lookup.issue?.closedAt, "2026-11-19T16:06:32Z");
});

test("a pull request payload is rejected instead of pretending to be an Issue", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () =>
      HttpResponse.json(
        issuePayload({
          html_url: "https://github.com/uichat-mira/mira-desktop/pull/482",
          pull_request: { url: "https://api.github.com/repos/uichat-mira/mira-desktop/pulls/482" },
        }),
      ),
    ),
  );
  const lookup = await readWorkerIssueState(env, "uichat-mira/mira-desktop", 482, now);
  assert.equal(lookup.issue, null);
  assert.equal(lookup.query.status, "missing");
  assert.match(lookup.query.error ?? "", /pull request/);
});

test("404 is missing, not closed and not open", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () =>
      new HttpResponse(null, { status: 404 }),
    ),
  );
  const lookup = await readWorkerIssueState(env, "uichat-mira/mira-desktop", 482, now);
  assert.equal(lookup.issue, null);
  assert.equal(lookup.query.status, "missing");
  assert.equal(lookup.query.httpStatus, 404);
});

test("403 without exhausted rate-limit headers is inaccessible", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () =>
      new HttpResponse("forbidden", { status: 403 }),
    ),
  );
  const lookup = await readWorkerIssueState(env, "uichat-mira/mira-desktop", 482, now);
  assert.equal(lookup.query.status, "inaccessible");
  assert.equal(lookup.query.httpStatus, 403);
});

test("429 with a Retry-After outside the bounded window stays rate_limited", async () => {
  let calls = 0;
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () => {
      calls += 1;
      return new HttpResponse("rate limited", {
        status: 429,
        headers: { "retry-after": "30", "x-ratelimit-remaining": "0" },
      });
    }),
  );
  const lookup = await readWorkerIssueState(env, "uichat-mira/mira-desktop", 482, now);
  assert.equal(calls, 1);
  assert.equal(lookup.query.status, "rate_limited");
  assert.equal(lookup.query.retryAfterSeconds, 30);
  assert.equal(lookup.query.httpStatus, 429);
});

test("a zero-second Retry-After uses exactly one bounded retry", async () => {
  let calls = 0;
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () => {
      calls += 1;
      if (calls === 1) {
        return new HttpResponse("rate limited", {
          status: 403,
          headers: { "retry-after": "0", "x-ratelimit-remaining": "0" },
        });
      }
      return HttpResponse.json(issuePayload());
    }),
  );
  const lookup = await readWorkerIssueState(env, "uichat-mira/mira-desktop", 482, now);
  assert.equal(calls, 2);
  assert.equal(lookup.query.status, "ok");
  assert.equal(lookup.issue?.state, "open");
});

test("unreadable payload stays unavailable rather than a guessed state", async () => {
  network.use(
    http.get(`${base}/repos/uichat-mira/mira-desktop/issues/482`, () =>
      HttpResponse.json({ number: 482, state: "mystery" }),
    ),
  );
  const lookup = await readWorkerIssueState(env, "uichat-mira/mira-desktop", 482, now);
  assert.equal(lookup.issue, null);
  assert.equal(lookup.query.status, "unavailable");
});

test("invalid repositories and Issue numbers are rejected before any request", async () => {
  await assert.rejects(
    () => readWorkerIssueState(env, "other-org/repo", 482, now),
    /unsupported_repository/,
  );
  await assert.rejects(
    () => readWorkerIssueState(env, "uichat-mira/mira-desktop", 0, now),
    /invalid_issue_number/,
  );
  assert.equal(
    workerIssuePath("uichat-mira/mira-desktop", 482),
    "/repos/uichat-mira/mira-desktop/issues/482",
  );
});
