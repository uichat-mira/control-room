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

test("keeps provider API keys in Actions secrets while provider metadata comes from variables", () => {
  assert.match(
    deployWorkflow,
    /AI_REVIEW_PRIMARY_API_KEY: \$\{\{ secrets\.AI_REVIEW_PRIMARY_API_KEY \}\}/,
  );
  assert.match(
    deployWorkflow,
    /AI_REVIEW_FALLBACK_API_KEY: \$\{\{ secrets\.AI_REVIEW_FALLBACK_API_KEY \}\}/,
  );
  assert.match(
    deployWorkflow,
    /AI_REVIEW_PRIMARY_ENDPOINT: \$\{\{ vars\.AI_REVIEW_PRIMARY_ENDPOINT \}\}/,
  );
  assert.match(
    deployWorkflow,
    /AI_REVIEW_FALLBACK_MODEL: \$\{\{ vars\.AI_REVIEW_FALLBACK_MODEL \}\}/,
  );
  assert.doesNotMatch(
    deployWorkflow,
    /AI_REVIEW_(?:PRIMARY|FALLBACK)_API_KEY: \$\{\{ vars\./,
  );
});

test("validates provider slot state before production deployment", () => {
  assert.match(deployWorkflow, /Validate AI Review provider slots/);
  assert.match(deployWorkflow, /buildReviewProviderRegistry\(process\.env\)/);
  assert.match(
    deployWorkflow,
    /state !== 'unconfigured' && state !== 'configured'/,
  );
  assert.match(deployWorkflow, /refusing deployment/);
});

test("passes non-secret provider settings as authoritative Worker vars and never exposes API keys as vars", () => {
  assert.match(deployWorkflow, /append_var_if_set/);
  for (const name of [
    "AI_REVIEW_PRIMARY_ID",
    "AI_REVIEW_PRIMARY_ENDPOINT",
    "AI_REVIEW_PRIMARY_MODEL",
    "AI_REVIEW_PRIMARY_RESPONSE_FORMAT",
    "AI_REVIEW_PRIMARY_MAX_PROMPT_CHARACTERS",
    "AI_REVIEW_PRIMARY_MAX_OUTPUT_TOKENS",
    "AI_REVIEW_PRIMARY_OUTPUT_TOKEN_PARAMETER",
    "AI_REVIEW_FALLBACK_ID",
    "AI_REVIEW_FALLBACK_ENDPOINT",
    "AI_REVIEW_FALLBACK_MODEL",
    "AI_REVIEW_FALLBACK_RESPONSE_FORMAT",
    "AI_REVIEW_FALLBACK_MAX_PROMPT_CHARACTERS",
    "AI_REVIEW_FALLBACK_MAX_OUTPUT_TOKENS",
    "AI_REVIEW_FALLBACK_OUTPUT_TOKEN_PARAMETER",
  ]) {
    assert.match(deployWorkflow, new RegExp(`\\b${name}\\b`));
  }
  assert.doesNotMatch(
    deployWorkflow,
    /--var\s+"AI_REVIEW_(?:PRIMARY|FALLBACK)_API_KEY:/,
  );
});

test("uploads configured provider API keys only through the Worker secrets file", () => {
  assert.match(
    deployWorkflow,
    /AI_REVIEW_PRIMARY_API_KEY=%s\\n' "\$AI_REVIEW_PRIMARY_API_KEY"/,
  );
  assert.match(
    deployWorkflow,
    /AI_REVIEW_FALLBACK_API_KEY=%s\\n' "\$AI_REVIEW_FALLBACK_API_KEY"/,
  );
  assert.match(deployWorkflow, /--secrets-file \/tmp\/control-room-secrets\.env/);
});

test("explicitly deletes stale remote provider API-key secrets when the desired slot key is absent", () => {
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

test("post-deploy smoke refuses partial or invalid provider slot state", () => {
  assert.match(
    smokeWorkflow,
    /new Set\(\['unconfigured', 'configured'\]\)/,
  );
  assert.match(
    smokeWorkflow,
    /Non-deployable provider slot state reached production/,
  );
  assert.doesNotMatch(
    smokeWorkflow,
    /new Set\(\['unconfigured', 'configured', 'partial', 'invalid'\]\)/,
  );
});

test("does not require a provider slot to be configured before deploy", () => {
  assert.doesNotMatch(
    deployWorkflow,
    /test -n "\$\{AI_REVIEW_(?:PRIMARY|FALLBACK)_(?:ID|ENDPOINT|API_KEY|MODEL)/,
  );
});
