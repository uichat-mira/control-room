# Environment Model

Control Room follows the Organization branch flow for source promotion:

`feat/* -> dev -> test -> prod`

This repository has a documented runtime-environment exception.

## Runtime exception

Control Room does **not** maintain dedicated shared `dev` or `test` Cloudflare Workers.

Reason:

- it is a small, read-only operational projection;
- maintaining duplicate shared runtimes would add infrastructure and credential surface without proportionate product value;
- its production Worker is already protected by deterministic CI, exact deployment identity, rate limiting, public-safe projection rules, and post-deploy smoke.

Therefore:

- `dev` and `test` are source/CI promotion gates only;
- pushes and pull requests for `dev`, `test`, and `prod` run repository verification;
- only `prod` may deploy the production Worker;
- runtime behavior that cannot be proven locally is verified by a bounded, non-destructive T5 production smoke on the exact deployed commit;
- a failed production smoke is a release blocker and must not be reclassified as a successful deployment.

This exception omits dedicated T4 shared environments. It does **not** permit feature branches, `dev`, or `test` to deploy production, and it does not weaken the requirement for T1/T2/T3 evidence before promotion.

## Factory TV

Factory TV follows the same rule.

The real Worker lifecycle read model is verified before promotion with deterministic contract tests, type checking, and build evidence. The exact production deployment then receives a bounded smoke against a known public External Worker Run.

Workers Observability is an optional observation source, not the lifecycle source of truth. Production smoke must remain small and must not turn a page view into an unbounded log scan.
