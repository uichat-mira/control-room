import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);

test("keeps provider API keys in Actions secrets while provider metadata comes from variables", () => {
  assert.match(
    workflow,
    /AI_REVIEW_PRIMARY_API_KEY: \$\{\{ secrets\.AI_REVIEW_PRIMARY_API_KEY \}\}/,
  );
  assert.match(
    workflow,
    /AI_REVIEW_FALLBACK_API_KEY: \$\{\{ secrets\.AI_REVIEW_FALLBACK_API_KEY \}\}/,
  );
  assert.match(
    workflow,
    /AI_REVIEW_PRIMARY_ENDPOINT: \$\{\{ vars\.AI_REVIEW_PRIMARY_ENDPOINT \}\}/,
  );
  assert.match(
    workflow,
    /AI_REVIEW_FALLBACK_MODEL: \$\{\{ vars\.AI_REVIEW_FALLBACK_MODEL \}\}/,
  );
  assert.doesNotMatch(workflow, /AI_REVIEW_(?:PRIMARY|FALLBACK)_API_KEY: \$\{\{ vars\./);
});

test("validates provider slot state before production deployment", () => {
  assert.match(workflow, /Validate AI Review provider slots/);
  assert.match(workflow, /buildReviewProviderRegistry\(process\.env\)/);
  assert.match(workflow, /state !== 'unconfigured' && state !== 'configured'/);
  assert.match(workflow, /refusing deployment/);
});

test("injects provider configuration only through the Worker runtime secret file", () => {
  for (const name of [
    "AI_REVIEW_PRIMARY_ID",
    "AI_REVIEW_PRIMARY_ENDPOINT",
    "AI_REVIEW_PRIMARY_API_KEY",
    "AI_REVIEW_PRIMARY_MODEL",
    "AI_REVIEW_PRIMARY_MAX_PROMPT_CHARACTERS",
    "AI_REVIEW_PRIMARY_MAX_OUTPUT_TOKENS",
    "AI_REVIEW_PRIMARY_OUTPUT_TOKEN_PARAMETER",
    "AI_REVIEW_FALLBACK_ID",
    "AI_REVIEW_FALLBACK_ENDPOINT",
    "AI_REVIEW_FALLBACK_API_KEY",
    "AI_REVIEW_FALLBACK_MODEL",
  ]) {
    assert.match(workflow, new RegExp(`\\b${name}\\b`));
  }

  assert.doesNotMatch(
    workflow,
    /--var\s+"AI_REVIEW_(?:PRIMARY|FALLBACK)_API_KEY:/,
  );
});

test("does not require a provider slot to be configured before deploy", () => {
  assert.doesNotMatch(
    workflow,
    /test -n "\$\{AI_REVIEW_(?:PRIMARY|FALLBACK)_(?:ID|ENDPOINT|API_KEY|MODEL)/,
  );
});
