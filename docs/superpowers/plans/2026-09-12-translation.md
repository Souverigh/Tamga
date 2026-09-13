# Translation and translation templates implementation plan

**Goal:** Separate translation with original retained, reusable form labels and exports.
**Architecture:** Existing recognition results feed an independent translation panel. Pure document/template logic is shared with Node tests; a bounded server endpoint uses Gemini and existing atomic rate-limit RPC with a separate translation namespace. No OCR quota is consumed.
**Tech Stack:** Browser ES modules, Node CommonJS, Gemini, existing JSZip, browser print.
**Spec:** ../specs/2026-09-12-document-workspace.md

## Global constraints

- Keep originals unchanged; translation only on explicit action.
- Never silently discard source text, unmatched fields or table cells.
- Templates apply only to an exact document type, language and unambiguous field catalog.
- No personal data persistence in localStorage. Template JSON contains labels only.
- Text segmentation and successful-result cache stay in tab memory; reset on source replacement.
- Count translation requests separately from OCR. Fail closed on unavailable counters.
- First version preserves existing paragraphs and extracted tables; it cannot recover headings or page geometry absent from OCR results.

## Tasks

- [x] Pure model and tests: `public/js/translation/model.mjs`, `scripts/test-translation.cjs`. Test unknown fields, required fields, wrong form, numbers, Unicode and chunk coverage before implementing.
- [x] Bounded API: `lib/translation.js`, `lib/translationQuota.js`, `api/translate.js`; extend `lib/geminiClient.js` with text input. Test response IDs, omitted segments, changed numbers, client gate and counter failures. Reuse `consume_feedback_attempt` with `translation:` keys, verified live definition supports arbitrary window and key. No database migration.
- [x] UI implementation: `public/js/translation/panel.js` plus `app.js` hook. Document/language selection, original/translation, editable results, cancellation, retry missing blocks, stale detection, template editor and JSON import/export. Browser verification remains below.
- [x] Export implementation: `public/js/translation/export.mjs`: TXT, DOCX with original optional, print/PDF view. Preserve tables; escape all XML/HTML. Export is disabled while incomplete or stale. Visual verification remains below.
- [ ] Verification: `node --test scripts/test-translation.cjs`, existing `npm test`, syntax checks and local browser synthetic flow. Real provider quality and actual office viewers are reported separately if unavailable.

## Acceptance examples

```js
assert.deepEqual(splitText(text, 2000).join(''), text);
assert.throws(() => validateTranslationResponse([{id:'a',text:'№ 123'}], [{id:'a',text:'№ 124'}]));
assert.equal(applyTemplate(document, wrongType, 'en').applied, false);
```

Daily defaults: 5 anonymous / 50 authenticated requests of at most 2000 source characters; 30-day defaults: 100 / 1000. Limits are server configurable and conservative (failed upstream attempts still consume a request). Existing global Gemini budget remains in force. These are request quotas, not monetary billing or exact character accounting.

## Verification record

- Initial 5 tests failed on missing implementation; all 11 current tests pass.
- `npm test` passes including recognition, page streaming and security suites.
- Syntax checks and `git diff --check` pass.
- Browser verification attempted with a local synthetic harness, but CUA returned
  `No browser is available`. The temporary server was stopped afterwards.
- Local Gemini/Supabase environment variables are absent; no live translation
  or rendered Word/PDF check is claimed. No deployment or production mutation.
