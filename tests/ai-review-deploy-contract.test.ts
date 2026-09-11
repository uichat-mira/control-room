import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deployWorkflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const smokeWorkflow = readFileSync(
  new URL("../.github/workflows/ai-review-gateway-smoke.yml", import.meta.url),
  "utf8",
);
const providerCatalog = readFileSync(
  new URL("../config/ai-review/providers.json", import.meta.url),
  "utf8",
);
const routing = readFileSync(
  new URL("../config/ai-review/routing.json", import.meta.url),
  "utf8",
);

test("deploy receives only provider-account credentials from Actions secrets", () => {
  for (const name of [
    "AI_PROVIDER_MINIMAX_CN_CODEPLAN_KEY",
    "AI_PROVIDER_VOLCENGINE_CODING_PLAN_KEY",
    "AI_PROVIDER_OPENCODE_GO_KEY",
  ]) {
    assert.match(
      deployWorkflow,
      new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`),
    );
  }

  assert.doesNotMatch(deployWorkflow, /AI_PROVIDER_[A-Z0-9_]+_KEY: \$\{\{ vars\./);
});

test("provider metadata and review routing are version-controlled JSON rather than Actions variables", () => {
  assert.match(providerCatalog, /"minimax-cn-codeplan"/);
  assert.match(providerCatalog, /"volcengine-coding-plan"/);
  assert.match(providerCatalog, /"opencode-go"/);
  assert.match(routing, /"routine"/);
  assert.match(routing, /"fallback"/);
  assert.match(routing, /"escalation"/);

  assert.doesNotMatch(deployWorkflow, /AI_REVIEW_PRIMARY_(?:ID|ENDPOINT|MODEL|RESPONSE_FORMAT|MAX_)/);
  assert.doesNotMatch(deployWorkflow, /AI_REVIEW_FALLBACK_(?:ID|ENDPOINT|MODEL|RESPONSE_FORMAT|MAX_)/);
  assert.doesNotMatch(deployWorkflow, /vars\.AI_REVIEW_/);
});

test("validates trusted provider catalog and mode-specific routing before production deployment", () => {
  assert.match(deployWorkflow, /Validate AI Review provider catalog and routing/);
  assert.match(deployWorkflow, /buildReviewRoutingHealth\(process\.env\)/);
  assert.match(deployWorkflow, /configuredProviderSecretRefs/);
  assert.match(
    deployWorkflow,
    /target\.state !== 'unconfigured' && target\.state !== 'configured'/,
  );
  assert.match(deployWorkflow, /refusing deployment/);
});

test("uploads configured provider-account keys only through Worker secrets", () => {
  assert.match(deployWorkflow, /configuredProviderSecretRefs\(\)/);
  assert.match(deployWorkflow, /printf '%s=%s\\n' "\$name" "\$value"/);
  assert.match(deployWorkflow, /--secrets-file \/tmp\/control-room-secrets\.env/);
  assert.doesNotMatch(deployWorkflow, /--var\s+"AI_PROVIDER_/);
});

test("explicitly removes stale managed provider-account secrets", () => {
  assert.match(
    deployWorkflow,
    /wrangler secret list --name uichat-mira-control-room --format json/,
  );
  assert.match(
    deployWorkflow,
    /if \(!process\.env\[name\] && remote\.has\(name\)\) deletions\[name\] = null/,
  );
  assert.match(
    deployWorkflow,
    /wrangler secret bulk[\s\S]*ai-review-provider-secret-deletions\.json[\s\S]*--name uichat-mira-control-room/,
  );
});

test("post-deploy smoke validates every modeled route and keeps no-provider execution explicit", () => {
  assert.match(smokeWorkflow, /providerRoutes/);
  assert.match(smokeWorkflow, /CODE_REVIEW/);
  assert.match(smokeWorkflow, /PROMOTION_REVIEW/);
  assert.match(smokeWorkflow, /RELEASE_REVIEW/);
  assert.match(smokeWorkflow, /new Set\(\['unconfigured', 'configured'\]\)/);
  assert.match(smokeWorkflow, /Non-deployable provider route reached production/);
  assert.match(smokeWorkflow, /no-provider review execution/);
});
