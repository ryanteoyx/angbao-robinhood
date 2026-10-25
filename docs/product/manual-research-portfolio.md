# Saved research to a portfolio proposal

This free local flow uses the user's saved research and separately authored agent assessment. No signup, source fetch, model call, job, order, wallet request or billing activation is part of this flow.

## User journey

1. Open a saved brief and choose **Check against my portfolio**.
2. Optionally select an earlier proposal for comparison. Its owner targets and limits must stay unchanged.
3. **Copy request for my agent** includes the full saved brief, its exact version reference and any retained research approach. The selected earlier proposal and its policy are included when applicable. The agent asks for missing portfolio values or meaningful choices rather than inventing them.
4. Add the agent's assessment file. Advanced JSON is available for clients that need it. The agent must retain all claims, counterevidence, inferences and gaps, and explicitly classify/map each source.
5. **Preview proposal** checks exact source versions, computes the existing deterministic contribution/DCA result and shows gaps and changes. Preview does not save.
6. **Save proposal** explicitly retains the research-linked native work record. The existing original body/key/ETag retry protects a lost acknowledgement. Reopening the saved proposal shows the same research references and comparison.
7. **Copy for another agent** returns the exact saved native record, including research lineage. **Check again** keeps the selected baseline and asks for a new assessment; it does not turn an old research date into a fresh source observation.

This integration has automated GUI-handler/local HTTP acceptance. Visual browser and named external-client acceptance remain Main's separate gates.

## Headless interface

Local capability `researchPortfolio: true` gates two tools:

- `angbao_preview_research_portfolio`: `briefId`, `expectedBriefDigest`, `evidenceBindings`, `assessment`, `portfolio`, `policy`, `asOf`; optional `researchWorkId` with `expectedResearchWorkDigest`, and `previousWorkId`.
- `angbao_save_research_portfolio`: the returned complete `handoff`, optional `previousWorkId`, current quoted `expectedETag`, original non-secret `idempotencyKey`.

CLI:

```text
angbao agent research-portfolio preview --file assessment.json
angbao agent research-portfolio save --file preview.json --etag '"N"' --key ORIGINAL_OPERATION_KEY
angbao agent portfolio read --id SAVED_WORK_ID
angbao agent handoff --portfolio SAVED_WORK_ID
```

Write preview output to a private file before using the save command. The CLI consumes the actual returned `handoff` and `previousWorkId`, leaving computed metadata out of the mutation body. These commands reject hosted mode before any hosted connection. Stdio MCP exposes the same local tools; its local message bound is 256 KiB, while hosted remains 32 KiB. HTTP preview is `POST /api/local/research-portfolio/preview`; explicit save is `POST /api/local/research-portfolio` using existing CAS/replay serialization. Existing portfolio reads, comparisons, history and handoff remain the return interfaces.

Each evidence binding has an exact saved `evidenceId` and explicit `source` fields: `sourceId`, `version`, `channel`, `capture`, `contentKind`, `url`, `text`, `publishedAt`, `observedAt`. A retained card additionally requires its exact `workCardRef` (`packDigest`, `provider`, `recordId`). Source construction and assessment schemas remain the native `portfolio-decision` contract. `examples/portfolio-decision/input.json` illustrates the schema with clearly synthetic values; it is never a substitute for the user's portfolio or evidence.

## Retained contract and boundaries

- Ordinary proposals remain `angbao-local-portfolio-work@1`. Linked proposals use `@2` with the complete accepted bridge `researchHandoff`; the whole native record remains hash-bound. The bridge, source map, reference, retained card/provenance/citation, assessment and original calculation remain intact.
- Preview resolves the exact brief and optional completed work from current local storage, never a caller-supplied record or implicit latest. Save resolves them again and recomputes the bridge before calling the existing native portfolio mutator. A changed or missing source fails without mutation. Imported historical snapshots do not substitute for missing current research and grant no authority.
- Existing targets/limits cannot silently change in a repeat. The native comparison identifies changed sources, assessment and portfolio values, with before/after contribution amounts only when comparable. Archived exact baselines work through the existing archive resolver.
- Unknown observation times stay unknown; save a new research version with the needed source details. A citation without retained text stays link-only and cannot support sizing. Retained provider summaries stay derived; Elfa summaries keep `elfa-derived` classification. Source-reference cards do not establish original body-to-URL provenance merely through citation membership.
- The existing 48 KiB native portfolio-work limit applies to the entire linked record, including duplicate calculation snapshots. Preview refuses a larger wrapper; sources, claims and provenance are never truncated to make it fit. The separate existing archive/workspace bounds are unchanged.
- The 20-version research safety bound now refuses overflow instead of silently pruning the oldest brief. Existing versions, settings, identity and billing state remain intact. No paid tier is required to retain or export them.
- Hashes identify exact snapshots; they do not prove source truth, authenticate another client or grant financial authority. Two-client trusted binding, live Elfa, managed Jobs and wallet acceptance remain separate modules/gates.

## Integration ownership

This packet is isolated in `.worktrees/manual-research-integration`, branch `codex/manual-research-integration`, after accepted bridge commits `4b71bd7` and `44f0f74` from composition base `435037f`. It does not modify Main's accepted browser checkout, hosted release or frozen archive. Main reviews and cherry-picks serially into its newer integration branch; this lane does not package, publish, deploy or push a release.
