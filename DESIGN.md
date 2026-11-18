# Control Room Design Principles

> **Status:** repository-wide design direction · approved visual reference, not a claim that all existing pages already conform
>
> **Visual reference:** [Factory TV frontend PR #75](https://github.com/uichat-mira/control-room/pull/75), especially its desktop wall, workstation detail and mobile previews. The Factory TV design is the **visual baseline for all of Control Room**, not a special skin limited to `/factory`.
>
> **Scope of this change:** design governance only. This document does not change CSS, routes, themes, components, APIs, production behavior or deployment.

## 1. Product and visual identity

**Control Room is Mira's industrial operations room.** It should feel like a real production-control floor: CCTV monitors, dispatch boards, machine labels, signal lights, operating records and an occasional old-fashioned propaganda bulletin. The interface has a distinct, critical and slightly satirical personality, but its operational facts must remain absolutely clear.

Three rules underpin every page:

1. **See the running system.** Present what is alive, what is doing work, what has changed, what needs attention and what evidence supports those statements.
2. **Industrial order, not decorative noise.** Dense information can be legible when hierarchy, grids, typographic rhythm and consistent semantic signals are disciplined.
3. **Facts first; satire second.** Dark humor and anti-996 language express the brand's point of view. They must never invent activity, failures, costs, throughput, completion or causes.

This language applies to **Overview, Engineering, Runtime, Governance, Factory TV and future Control Room views**, including `/wall`. The content and interactions differ by domain; the underlying visual grammar does not.

### What this is not

- Not a generic SaaS admin dashboard with rounded cards nested inside more cards.
- Not a neon cyberpunk game, fake terminal or permanently flashing alarm screen.
- Not an excuse to turn every page into a red propaganda poster.
- Not a claim that a green CI check or an animated indicator proves the product is working.
- Not a reason to force Factory TV's three-tab information architecture onto unrelated pages.

## 2. Global visual grammar

### 2.1 Material, atmosphere and composition

- **Dark industrial surfaces are the primary visual reference:** coal/graphite backgrounds, subdued metal-grey panels, restrained warm/off-white text, precise borders.
- Favor **flat planes, shared grid lines, sectional bands and aligned rows** over floating card islands. Separate sections first with space and rules; use surfaces only where they clarify grouping.
- Allow restrained visual texture (grain, manufacturing stripes, signal markings, camera labels) **only as a low-contrast accent**. It cannot impair reading or obscure data.
- Maintain recognizable Control Room hierarchy: site/organization identity → business domain → current status → evidence/details → secondary context.
- Every dense screen needs an unmistakable visual focal point and a quiet secondary hierarchy. **Density is useful; clutter is not.**
- Reserve visual drama for genuinely important state changes, a channel masthead, or an editorial message. Operational tables and controls remain calm.

### 2.2 Color as meaning

The approved Factory TV palette is the **direction for the global token system**, not a separate sub-brand. Current code still uses root tokens in `src/styles.css` and local `--ft-*` variables in `src/factory-tv.css`; those are implementation facts, **not two competing design standards**.

| Role | Direction | Rule |
| --- | --- | --- |
| Canvas | coal / near-black charcoal | Main visual reference, avoid pure flat black everywhere |
| Secondary planes | graphite / muted industrial green-grey | Only to establish content hierarchy |
| Text | warm off-white / ash grey | Clear primary, secondary and tertiary contrast |
| Structure | subdued steel-grey lines | Precise boundaries, not excessive separators |
| Editorial accent | industrial red | Identity, selected highlights, propaganda/editorial devices |
| Work / confirmed success | restrained green | Only on evidence of the relevant successful state |
| Attention / observation delay | warm amber | Uncertainty or warning, **not** automatic failure |
| Failure / destructive state | distinct alert red | Never infer failure from mere silence |

**Semantic priority beats decorative color.** Editorial red and failure red must remain distinguishable through text, icons and location; do not rely on hue alone. A colored dot is supplemental, never the sole status description.

The **existing system/light/dark theme support stays a product capability**. Dark is the flagship expression of this industrial identity; light must eventually express the *same grammar* using paper/steel/control-sheet materials, grid lines and type hierarchy—not revert to an unrelated rounded SaaS design. Do not remove light mode without a separate product decision.

**Token ownership:** `src/styles.css` currently owns global semantic tokens (`--bg`, `--surface`, `--text`, `--line`, `--accent`, `--ok`, `--warn`, `--danger`, etc.). Future implementation should evolve those shared tokens and retire redundant per-page palette definitions **only when the actual components migrate**. This document does not rewrite token values or declare the existing palette already migrated.

### 2.3 Typography and labels

- Use strong, controlled **industrial display type** for major screen titles and occasional channel/section identifiers, with appropriate Chinese font fallback. A display headline is a deliberate exception, not the default for every label.
- Use legible sans-serif for body copy, controls and longer explanations. Monospaced numerals/type belong to Run IDs, timestamps, counters, issue references, version/build data and machine-like labels.
- Establish hierarchy with **weight, size, rhythm and contrast**, not a dozen unrelated text styles. Use restrained uppercase Latin technical labels, not artificial letter-spacing across Chinese paragraphs.
- Numerical readouts should align predictably (tabular figures), include units/time zone or time context when needed, and avoid decorative zero-padding unless the label is explicitly a channel/camera number.
- Editorial captions may be witty. Error messages, credentials/permission notices, data provenance and remediation instructions must remain plain and unambiguous.

### 2.4 Spacing, geometry, alignment

- Prefer tight, squared-off geometry: **minimal radii**, shallow/no shadows, crisp focus/selection indicators.
- Organize each page around one structural grid; align headings, metrics, status text, tables, charts and evidence panels to it.
- Use breathing room between **major sections** rather than wrapping every metric in a card.
- Component density should follow reading/task needs: overview is scannable, engineering tables are compact, station timelines have sufficient event spacing, governance records are traceable.
- Avoid horizontal overflow in content panels. Long IDs and links must wrap, truncate with a way to inspect the original, or be explicitly scrollable as structured data.
- Motion is purposeful and restrained: brief state transitions, explicit polling indicators where appropriate; no perpetual pulsing that falsely suggests live activity. Respect reduced-motion preference.

## 3. Reusable interface patterns

### 3.1 Navigation and page structure

- Keep Control Room's shallow business-domain navigation. A new channel/view may have local tabs, but it does not replace the global navigation.
- Main heading communicates **where**, page summary communicates **why**, current-status section communicates **what is happening**, and evidence links communicate **how we know**.
- Active navigation must be identifiable without color alone; tab and route state must survive direct navigation and reload.
- `/wall` remains the system-level large-screen mode. Factory TV's wall is a specialized view in the **same visual system**, not a replacement for `/wall`.
- Avoid presenting the same dashboard metric in several places with diverging eligibility or denominators.

### 3.2 Status and provenance

Every operational statement should answer:

1. **Which entity?** Repository, Worker, service, Job, Run, PR, artifact or deployment.
2. **What exact state?** Reported state must match the source's semantics.
3. **When was it observed?** Timestamp, freshness or sampling window where material.
4. **What is the evidence?** Navigable source reference, read-only record, or a clearly stated absence of evidence.

A running GitHub Job is **not** proof that an AI model is currently making progress. Missing Reporter signals are **not** proof the Worker died. `202 Accepted` is not log persistence. An Artifact being captured is not verified delivery. The visual system must preserve those distinctions.

Always differentiate **loading, empty, stale, unknown, disconnected, partially complete, failed and successful** states. In particular, *unknown* and *failed* must not share the same presentation or be silently mapped to success.

The current application is a **read-only projection**. UI ornamentation, statuses and live-looking counters must not turn it into a second task ledger or source of truth.

### 3.3 Evidence-driven timelines, monitoring, metrics and tables

- Workstation timelines and engineering activity feeds should identify evidence class (GitHub job/step, Reporter stage event, Artifact, PR, deployment) and temporal order.
- Do not synthesize intermediate tool activity or animation from coarse stage data. If only stage events exist, display **stage events**, not fictitious keystrokes or command logs.
- Charts have units, time windows, source/freshness and a clear meaning. Favor restrained data graphics over ornamental gauges.
- Table hierarchy: meaningful row label first, then scope/state/time/evidence; don't sacrifice inspectability for stylistic uniformity.
- Use links to authoritative upstream records when evidence lives there. Do not embed privileged telemetry/Observability credentials in browser code.
- Show ongoing polling as **data refresh**, not as proof of process heartbeat.

### 3.4 Industrial voice and satire

The factory narrative belongs to **all of Control Room's personality**, though each screen uses it at an appropriate intensity:

- **Overview**: editorial signal, short operational headlines, concise source facts.
- **Engineering**: workshop/production language, build and delivery evidence, technical clarity first.
- **Runtime**: control-room instruments, measured availability, conspicuous uncertainty.
- **Governance**: rulebooks, inspection records, review trails; sober and precise.
- **Factory TV**: the most theatrical expression—CCTV camera numbers, station walls, labor bulletin, black humor.
- **Public documentation/API/security surfaces**: minimize satire where it could obscure a contract, permission boundary, incident severity or remediation step.

The anti-996 stance is a recognizable editorial voice, **not a functional or legal statement about labor conditions**. Satirical labels must never ridicule actual people, mask a failure, or make users mistake fabricated content for monitoring facts.

## 4. Responsive and accessible by default

- Desktop: provide a dense overview and adjacent detail/evidence pane when the available width supports it.
- Tablet: collapse columns gradually; preserve the strongest information hierarchy, not the exact desktop proportions.
- Mobile: use single-column reading order, compact metrics and readable data rows. Native navigation/tabs may scroll intentionally; the **document body must not drift horizontally**.
- Touch targets should be comfortably operable (target about 44px high for primary controls), with visible keyboard focus and meaningful link/button labels.
- Maintain usable contrast (aim for WCAG AA, including 4.5:1 normal text and 3:1 large text/essential graphics), keyboard access, text zoom and reduced-motion support.
- Every color-coded state also has a textual state or accessible equivalent.
- A background texture, poster or decorative SVG cannot impede accessibility or make the screen dependent on motion.

## 5. Governance, adoption and review

### Source-of-truth boundaries

- **This `DESIGN.md`:** normative visual direction for the **entire** Control Room.
- **`src/styles.css`, `src/navigation.css`, `src/visual.css`:** current working global implementation and tokens.
- **`src/factory-tv.css` on PR #75:** approved reference implementation for the visual language; it is **not** authorized to remain a permanent independent design system.
- **Other component-local CSS:** temporary implementation detail; must not silently define competing visual rules.
- **GitHub PR/Issue and browser evidence:** specific proposed changes and their validation, not a replacement for these principles.

This is a **target-state design rule**. Existing Overview, Engineering, Runtime, Governance and `/wall` are not declared compliant merely because this file is committed. Differences should be corrected in separate small implementation changes, guided by current product priorities and real screenshots—not by a giant, simultaneous CSS rewrite.

### Design review checklist

For any UI PR, reviewers should establish:

- [ ] Does it visibly belong to the industrial Control Room family rather than a generic SaaS template?
- [ ] Are hierarchy, alignment, text density and spacing disciplined? Are nested cards/radii/shadows restrained?
- [ ] Does it reuse or intentionally evolve shared semantic tokens instead of inventing another color system?
- [ ] Are state, freshness, uncertainty and evidence distinguishable and truthful?
- [ ] Is editorial satire clearly separated from facts, errors and instructions?
- [ ] Do keyboard navigation, small screens, reduced motion and contrast remain usable?
- [ ] Was the actual page checked in a browser at relevant desktop/mobile widths, with screenshots or similarly inspectable evidence?
- [ ] Were runtime/data/API/security changes kept outside a design-only change unless separately authorized?

### Rollout sequence

1. Ratify this shared design direction without changing production visuals.
2. Review PR #75 against it and decide whether the Factory TV implementation serves as the initial visual reference.
3. In **separate UI tasks**, converge global tokens and common shell components first; then migrate individual pages.
4. Preserve working API, data provenance, navigation, light/dark preference and deployment contracts during visual adoption.
5. Accept visual changes only after real browser review; a passing build alone is not visual acceptance.

**North star:** *One industrial Control Room; different operational screens; a single credible visual language.*
