# Retained research to portfolio handoff

**Status:** pure domain module with constructor/fixture tests. It is not wired into CLI, MCP, HTTP, GUI, packaging, persistence or a live Elfa workflow. Offchain owns those integration steps after independent review. Public/frozen releases and existing workspaces are unchanged.

The free manual journey is: open an exact saved research version → the personal agent supplies an explicit portfolio assessment → bind retained evidence → run the existing deterministic contribution calculator → inspect → separately save. The bridge never reasons from sentiment or prose, fetches a URL, calls a model, reserves money, changes targets or approves an action. Managed background operation is a different service.

## Interface

```js
import { prepareResearchPortfolioHandoff } from './src/domain/research-portfolio-bridge.mjs';

const handoff = prepareResearchPortfolioHandoff({
  brief,                     // Exact authorized retained research brief, not an authored draft.
  expectedBriefDigest,       // Full-record canonical SHA-256 from the trusted handoff/resolver.
  evidenceBindings,          // Explicit one-to-one bindings described below.
  assessment,                // Separately agent-authored angbao-portfolio-assessment@1.
  portfolio,                 // Dated supplied angbao-portfolio-snapshot@1.
  policy,                    // Explicit owner angbao-allocation-policy@1; never inferred.
  asOf,                      // Explicit canonical ISO time, never filled with now.
  // Optional, supplied together when selected method cards provide retained content:
  researchWork,
  expectedResearchWorkDigest,
});
```

The transport must resolve the selected records from an authorized workspace and obtain expected digests independently. A caller can invent a record and matching hash: hashes identify bytes, not an owner, provider truth or authority. This pure function neither authenticates clients nor proves that an asserted record was actually saved.

`retainedResearchBriefs` validates the brief. `researchDigest` is the existing sorted-key canonical JSON digest and matches `readFinancialHandoff` on the **whole record**, including server metadata. The work's internal `digest` excludes that field and is **not** the expected full-record digest. Tests compare both references with actual `readFinancialHandoff` output.

## Explicit evidence binding

Each retained brief evidence ID must occur exactly once, with a unique source ID:

```js
{
  evidenceId: 'the-retained-citation-id',
  source: {
    sourceId: 'the-explicit-portfolio-source-id',
    version: 1,
    channel: 'news',                 // article/x/telegram/substack/news/manual
    capture: 'elfa-derived',         // user-forwarded/agent-retrieved/elfa-derived
    contentKind: 'derived-summary',  // source-text/source-excerpt/derived-summary/link-only
    url: 'https://example.org/source',
    text: 'The exact retained content',
    publishedAt: null,
    observedAt: '2026-10-24T07:00:00.000Z',
  },
  // Optional, only with the paired validated research work:
  workCardRef: { packDigest, provider: 'elfa', recordId },
}
```

| Content route | Exact binding | Limits and refusal |
|---|---|---|
| Brief only | `source.url/text/publishedAt/observedAt` equal the saved citation URL/excerpt/times. An empty excerpt maps to `text:null` and `link-only` | Saved brief excerpts are at most 600 characters. The bridge never fills them from the answer, a URL, a title or new unretained text. Explicit classification is caller-declared and unverified |
| Selected method card | Validate the entire completed work using `validateResearchWorkRecord`; bind work `briefId`, exact brief `methodRunRef`, normalized authored content and expected full-record digest. Card must be selected and contain the exact retained citation ID | Native `saveResearchBrief` content normalization is reused on detached scratch state, matching the existing import validator. Generated IDs/state are discarded; no workspace is saved. Normalization permits native whitespace handling, not substantive content changes |
| Provider summary card | Exact `card.summary.text`; `derived-summary` mandatory; Elfa additionally requires `elfa-derived`. `publishedAt` is the card's publication time, `observedAt` its retrieval time | Original citation publication time remains separately visible. Provider analysis/first-seen times never fill an unknown publication time. Missing summary body is needs-input; no title fallback |
| Source-reference card | **Link-only**, with the selected citation's own URL, publication time and observation time | Current method cards retain `originalPostText` and citation membership but not the original body's source URL. Membership, citation order and even a sole citation cannot establish body origin. The bridge refuses to promote that body into any cited source; the native calculator blocks sizing |

The method work retains **selected cards and input-provenance metadata**, not necessarily the complete original provider response. The output preserves those cards, their issues, citation associations, provider timestamps, pack digest and coverage/pagination metadata. It makes no whole-pack availability or completeness claim. Provider summaries can exceed the brief's 600-character excerpt limit through the optional validated work route; the existing portfolio-source maximum remains **8,000 characters**. Oversized or missing content is refused, never truncated. Existing method-work retention limits still apply before this bridge.

**Representation limitation:** a source-reference card's original text remains visible in `sourceMapping.retainedCard`, but is not usable as a URL-bound source body with the current retained schema. Full original-source coverage requires a separate upstream retention change that preserves and validates the original body-to-URL relationship. This bridge does not reconstruct that relationship from pack digests or undeclared source data. The existing direct supplied-excerpt route remains available when its saved citation already binds the excerpt and dates; provider summaries remain explicitly derived rather than original articles.

## Assessment and calculation contract

The personal agent supplies the existing portfolio assessment schema unchanged. It must explicitly:

- Reference every mapped source ID and its constructed digest.
- Preserve every retained supporting and contradicting claim with the same ID, stance and text; map its `evidenceIds` to the corresponding `sourceIds` in the same order.
- Retain saved inferences and gaps. Separately authored portfolio inferences may be added with valid claim references; the bridge does not create them.
- Carry every retained contradicting claim into counterevidence.
- Specify claim-to-instrument relevance and exact focus instrument IDs present in the portfolio. A ticker is not an instrument mapping.

`createPortfolioSourceSync`, `validatePortfolioSourceSync` and `preparePortfolioDecisionSync` remain the native source/calculation boundary. The bridge returns the exact native shape:

```text
input = { method, asOf, sources, assessment, portfolio, policy }
method = { id: 'portfolio-contribution', version: '1.0.0' }
```

No lineage fields are inserted into the calculator schema, no allocation formula is duplicated, and the supplied assessment/portfolio/policy are cloned without modification. Existing gaps prevent sizing for stale/missing inputs, incompatible asset identity, changed owner targets, unsupported rebalance and unread links. Listed equity, issuer-specific tokenized equity and crypto remain separate identities. DCA is an unscheduled, unexecuted proposal; no quantities, live prices, order routing or actual financial result is implied.

## Output and errors

```text
{
  format: 'angbao-research-portfolio-handoff@1',
  researchRef,             // Exact brief identity/version/full digest and optional method reference.
  researchWorkRef?,        // Exact completed work/full digest/run identity; outside calculation.
  sourceMapping,           // Retained evidence digest, exact source refs, classification and dates.
  input, decision,         // Existing calculator result unchanged.
  gaps,                    // Calculator gaps plus retained research gaps, without dropping either.
  saved: false,
  financialAuthority: false,
  digest                   // Canonical digest of this complete wrapper excluding digest itself.
}
```

The returned graph is detached and frozen. The input and original records remain untouched. `ResearchPortfolioBridgeError` reports invalid mappings, changed full-record digests or `research_portfolio_needs_input`. Existing research/portfolio validators retain their own errors. Structurally valid inputs with unresolved financial/evidence gaps return the calculator's blocked/research/watch outcome, not a fabricated contribution. Unsupported fields, accessors, cycles, non-finite values, sparse lists and oversized input fail before mapping. The aggregate handoff bound is 256 KiB.

## Integration and acceptance remaining

Offchain should register an explicit manual preview operation after authorized exact-record resolution. Show the linked research/work/source versions, classification, unknown times, selected target identities and gaps. Keep explicit save separate and persist this wrapper's provenance through a reviewed schema/retention change; saving only its native `decision` would lose the bridge's research/work references. This packet changes no storage schema and does not claim that lineage is already persisted.

For live Elfa, reuse the existing default-off one-shot provider service and its consent/resource gates; do not introduce a second connector. The owner's personal agent supplies synthesis. Then accept one actual permitted fetch → retained method/brief → explicit assessment → bridge → proposal save/GUI → restart/export, naming the actual client. Real provider rights, costs, current entitlement, credential configuration, hosted isolation and wallet approval remain outside this module. A real financial action still requires its separate existing review and approval route.

## Checks

```sh
node --test tests/research-portfolio-bridge.test.mjs
node --check src/domain/research-portfolio-bridge.mjs
```

Tests use actual saved-brief and completed-method constructors with synthetic sources, plus the native calculation and handoff constructors. They cover full-record digest parity, method references, evidence dates, support/counterclaims/inferences/gaps, distinct equity/token identity, stale and missing data, immutable policy, DCA conservation, forged references/body/classification, the long retained-summary route, oversize refusal, link-only behavior and zero external calls. Regression cases cover primary text incorrectly assigned to a secondary URL, a sole citation with unprovable body origin, preservation of citation-specific dates, and native completed-work whitespace normalization without accepting substantive changes. They are source/fixture acceptance, not live provider, external-harness, GUI, publication or real-chain evidence.
