import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleAiReviewRequest } from "../src/ai-review.ts";
import {
  PUBLISH_PILOT_REPOSITORIES,
  PUBLISH_PILOT_REPOSITORY,
  isPublishPilotRepository,
} from "../src/ai-review-publication.ts";

const EXPECTED_PILOT_REPOSITORIES = [
  "uichat-mira/mira-mobile",
  "uichat-mira/uichat-mira-docs",
  "uichat-mira/mira-desktop",
];

test("publisher allowlist contains only Mobile, Docs, and Desktop pilots", () => {
  assert.deepEqual([...PUBLISH_PILOT_REPOSITORIES], EXPECTED_PILOT_REPOSITORIES);
  assert.equal(PUBLISH_PILOT_REPOSITORY, EXPECTED_PILOT_REPOSITORIES[0]);
  assert.equal(isPublishPilotRepository("uichat-mira/mira-mobile"), true);
  assert.equal(isPublishPilotRepository("uichat-mira/uichat-mira-docs"), true);
  assert.equal(isPublishPilotRepository("uichat-mira/mira-desktop"), true);
  assert.equal(isPublishPilotRepository("uichat-mira/uichat-mira-relay"), false);
});

test("health exposes the bounded pilot repository set while preserving the Mobile compatibility field", async () => {
  const response = await handleAiReviewRequest(
    new Request("https://control.example/api/v1/ai-review/health"),
    {
      GITHUB_READ_TOKEN: "github-read-token",
      GITHUB_PUBLISH_TOKEN: "github-publish-token",
      AI_REVIEW_GATEWAY_TOKEN: "caller-token",
    },
  );
  const body = (await response.json()) as any;

  assert.equal(response.status, 200);
  assert.equal(body.publisherRepository, "uichat-mira/mira-mobile");
  assert.deepEqual(body.publisherRepositories, EXPECTED_PILOT_REPOSITORIES);
});

test("publisher secret sync targets all three pilots and does not enable Relay", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ai-review-publisher-secret-sync.yml", import.meta.url),
    "utf8",
  );

  for (const repository of EXPECTED_PILOT_REPOSITORIES) {
    assert.match(workflow, new RegExp(repository.replace("/", "\\/")));
  }
  assert.equal(workflow.includes("uichat-mira/uichat-mira-relay"), false);
});
