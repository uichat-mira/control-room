import assert from "node:assert/strict";
import test from "node:test";

import {
  getGitHubOverviewStats,
  renderGitHubOverviewSvg,
  renderGitHubOverviewUnavailableSvg,
} from "../src/github-overview.ts";
import type { OrganizationSnapshot } from "../src/shared.ts";

function snapshot(): OrganizationSnapshot {
  return {
    status: "connected",
    generatedAt: "2026-09-11T06:30:00.000Z",
    organization: {
      login: "uichat-mira",
      name: "Mira",
      htmlUrl: "https://github.com/uichat-mira",
      avatarUrl: "https://example.test/avatar.png",
      description: null,
      publicRepos: 3,
      followers: 0,
    },
    sources: {
      github: "connected",
      cloudflare: "connected",
    },
    repositories: [
      {
        name: "one",
        fullName: "uichat-mira/one",
        htmlUrl: "https://github.com/uichat-mira/one",
        description: null,
        visibility: "public",
        defaultBranch: "prod",
        archived: false,
        fork: false,
        language: "TypeScript",
        pushedAt: null,
        updatedAt: "2026-09-11T06:00:00.000Z",
        openIssuesCount: 0,
        stars: 0,
        latestRelease: null,
        latestWorkflow: {
          name: "CI",
          status: "completed",
          conclusion: "success",
          htmlUrl: "https://example.test/run/1",
          createdAt: "2026-09-11T05:00:00.000Z",
          updatedAt: "2026-09-11T05:10:00.000Z",
        },
      },
      {
        name: "two",
        fullName: "uichat-mira/two",
        htmlUrl: "https://github.com/uichat-mira/two",
        description: null,
        visibility: "public",
        defaultBranch: "prod",
        archived: false,
        fork: false,
        language: "TypeScript",
        pushedAt: null,
        updatedAt: "2026-09-11T06:00:00.000Z",
        openIssuesCount: 0,
        stars: 0,
        latestRelease: null,
        latestWorkflow: {
          name: "CI",
          status: "completed",
          conclusion: "failure",
          htmlUrl: "https://example.test/run/2",
          createdAt: "2026-09-11T05:00:00.000Z",
          updatedAt: "2026-09-11T05:10:00.000Z",
        },
      },
      {
        name: "three",
        fullName: "uichat-mira/three",
        htmlUrl: "https://github.com/uichat-mira/three",
        description: null,
        visibility: "public",
        defaultBranch: "prod",
        archived: false,
        fork: false,
        language: null,
        pushedAt: null,
        updatedAt: "2026-09-11T06:00:00.000Z",
        openIssuesCount: 0,
        stars: 0,
        latestRelease: null,
        latestWorkflow: null,
      },
    ],
    services: [
      {
        id: "website",
        label: "Website",
        url: "https://mira.tomz.io",
        status: "online",
        httpStatus: 200,
        latencyMs: 50,
        detail: "Healthy",
      },
      {
        id: "relay",
        label: "Relay",
        url: "https://relay.tomz.io/health",
        status: "online",
        httpStatus: 200,
        latencyMs: 30,
        detail: "Healthy",
      },
    ],
    cloudflare: {} as OrganizationSnapshot["cloudflare"],
    deployedCommit: "abc123",
  };
}

test("derives compact organization metrics from the shared snapshot", () => {
  assert.deepEqual(getGitHubOverviewStats(snapshot()), {
    repositories: 3,
    trackedBuilds: 2,
    successfulBuilds: 1,
    failedBuilds: 1,
    runningBuilds: 0,
    services: 2,
    onlineServices: 2,
  });
});

test("renders a self-contained GitHub overview SVG", () => {
  const svg = renderGitHubOverviewSvg(snapshot());

  assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(svg, /Mira Control Room/);
  assert.match(svg, /3<\/text>/);
  assert.match(svg, /1\/2 green/);
  assert.match(svg, /2\/2 online/);
  assert.match(svg, /GitHub connected/);
  assert.match(svg, /Cloudflare connected/);
  assert.doesNotMatch(svg, /<script/i);
});

test("renders a valid fallback image when the snapshot cannot be loaded", () => {
  const svg = renderGitHubOverviewUnavailableSvg();

  assert.match(svg, /Snapshot temporarily unavailable/);
  assert.match(svg, /Open Control Room/);
  assert.doesNotMatch(svg, /<script/i);
});
