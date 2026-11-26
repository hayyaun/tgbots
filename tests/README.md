# Inmankist tests

Run from the repository root with Node 22.12 or newer and the project's native canvas prerequisites:

- `npm ci` — install the locked dependencies.
- `npm test` — execute every test.
- `npm run test:coverage` — also generate `coverage/index.html` and `coverage/coverage-summary.json`, including when tests fail.
- `npm run test:typecheck` — typecheck production and test TypeScript.
- `npx eslint tests --ext .ts` — lint the test files.

The lockfile contains the platform-specific optional native dependencies required by Vitest. It was repaired using a compatible npm 11.16 invocation; no platform-specific package was added as a direct project dependency and no runtime loader was patched.

## Scope and test design

The suite contains nine files and exercises all seven quizzes, four languages, three quiz modes, and both archetype genders. The full conversation matrix has 96 start-to-result cases. These dispatch realistic commands and callback updates through a real grammY Bot with the actual command/callback registrations, reducer, session logic, scoring, result text, and persistence calls.

External Telegram, Redis, and PostgreSQL boundaries use documented Vitest mocks and grammY API transformers. No test imports the application entry point, starts polling, contacts Telegram, connects to a database, runs migrations, or uses a real user's data. The storage double serializes values and enforces TTLs instead of sharing application objects. Tests inject read/write/delete failures and deliberately reorder background writes.

The conversation suite replaces image composition at its boundary so it can inspect result labels and percentages. The separate rendering suite imports the actual native canvas functions, renders all 15 archetype image assets and political compass corners/center in all four languages, and decodes all 16 MBTI assets. It verifies image encoding, dimensions and that archetype rendering did not silently fall back to the unmodified source image. These are not visual screenshot comparisons or a guarantee that every installed font looks identical across hosts.

Question-bank expectations read raw JSON independently of the production question loader. Scoring expectations use independent totals and normalization rather than calling the implementation as their oracle. In addition to fixed extremes and mixed responses, fast-check explores 1,160 generated properties/histories per run with a recorded seed, covering final-answer revisions, duplicate taps, reordered presentation and sample sizes outside the normal modes.

Tests cover missing/expired/corrupt sessions, cache misses and serialization, 24-hour session and 48-hour result expiry, language-service fallback, selected-language TTL renewal, user isolation, profile-field preservation, saved-result replay, result detail buttons, wrong-stage/out-of-order events, stale messages from old quizzes, invalid/oversized answers, malformed callback data, repeated final answers, and failure recovery.

## Current verified baseline

On 2026-11-26, the complete suite passed **892 tests**, with zero failed, skipped or expected-failure tests. This includes the original 871 tests without changes to their files or assertions and 21 additional regression cases in `fix-regressions.test.ts`. All 96 normal start-to-result cases, question-bank/sampling checks and native rendering tests pass.

The initial baseline was 834 passing and 37 failing assertions. The application fixes resolved all 37 failures; the original tests were not weakened to match the old behavior. Additional regressions cover failed first/next question delivery, failed follow-up delivery, immutable published results during cleanup retries, prompt/chat provenance, immediate acknowledgment while a previous tap is blocked, delayed writes racing deletion, structurally corrupt sessions, language defaults and all localized political-compass quadrants.

Coverage for the configured Inmankist scope is **89.95% of lines and 81.56% of branches**. Question JSON and static descriptive catalogs are excluded from executable-code coverage; their bank structure and assets have separate checks. Coverage configuration was not changed for these fixes. Uncovered branches remain visible in the report; the suite is not exhaustive proof over every possible interleaving.

Production/test TypeScript checking, ESLint for all changed application files and tests, and `git diff --check` pass. Application code release `01d11e8` was subsequently built and deployed on the external server on 2026-11-27. The exact released Alpine image also passed all 892 tests in a separate container with networking disabled and no mounts. See `DOCKER-RESOURCES.md` for image identity, live health checks and retained resources.

## Reproduced defects fixed

1. **Missing callback/session validation.** Answer values above 3, unsafe integers, out-of-bank and unsampled questions, extra callback prefix/suffix text, and answers from a previous quiz can mutate the active session. A callback can also answer before mode selection or before the question was displayed. See `adversarial-flow.test.ts` and `src/inmankist/callbacks.ts`.
2. **Old answers survive bank resampling.** A stale mode or gender-selection button can change the active question selection while retaining answers keyed to the previous selection. Tests accept either rejecting the stale action or resetting answers for the new selection.
3. **Completion cannot reliably recover from an I/O failure.** Once the last answer is saved, a failed result delivery, result-cache write or session cleanup can leave the quiz stuck. Repeating that answer is treated as a revision and does not retry completion.
4. **Background writes can lose a later revision.** An older Redis write completing after a newer one restores an old answer after the local cache expires. The test controls write ordering to reproduce the race deterministically.
5. **Corrupt stored quiz JSON gives no user recovery message.** The callback logs the error but does not guide the user back into the flow.
6. **All-zero cognitive answers conflict with their displayed percentages.** The result is classified as strong right while the percentages say 50/50.
7. **All-zero archetype answers render invalid percentages.** The renderer receives `NaN%` labels because the total score is zero.
8. **Invalid language/gender selections are accepted.** An unsupported language can become the selected language, and unsupported archetype gender can overwrite the session.
9. **Persian language TTL is not renewed.** Refresh skips the default language even if the user explicitly selected it.
10. **Introduction localization gaps.** Arabic MBTI help contains Russian text. Political-compass introductions remain Persian when English or Russian is selected.

## Implementation and deployment notes

Quiz callbacks are acknowledged before entering a per-user mutation queue. Mode and gender prompts and all displayed questions are bound to their actual Telegram message and chat IDs. Earlier displayed answers remain editable within the current quiz; stale setup buttons cannot resample an answered quiz. A failed send can be retried from its original button. Published completion results are immutable while follow-up delivery or cleanup resumes.

Session writes remain asynchronous for responsiveness, but snapshots are serialized per user. Cache-miss reads and deletion wait for pending writes. Invalid stored sessions recover with a localized restart message. Zero-score cognitive results are balanced at 50/50, zero-score archetype labels are finite, explicitly selected Persian renews its TTL, and unsupported language values are ignored. Political-compass introductions, results, details and buttons now support all four languages; Arabic MBTI introduction text is Arabic.

No database schema change or migration is required. Sessions from the previous version lack message bindings and must restart with `/start`; the bot explains this in the user's language. The separate deployment completed successfully after owner-provided shared host swap was enabled; PostgreSQL and Redis were not restarted.

Concurrency and recent-completion suppression operate inside one bot process. These tests do not establish distributed locking across multiple bot replicas. Telegram delivery and Redis persistence are separate operations: a crash or ambiguous network response between delivery and checkpoint persistence can still require recovery and cannot provide a universal exactly-once delivery guarantee. Redis session writes and database profile writes retain their existing best-effort availability behavior; permanent service outages cannot be made durable by these local tests.

## Limits of the scoring contract

The arithmetic oracle follows the application's current 0–3 answer scale, category definitions, stated normalization/range and explicit classification boundaries. MBTI's current tie-break toward I/N/F/P is tested for deterministic consistency; that is not a scientific endorsement of the tie policy. The mental-age oracle checks the stated linear 5–100 range, not contradictory approximate comments.

No authoritative external scoring key, item validation or psychometric norm dataset is present in this repository. These tests establish computational and workflow behavior; they cannot certify the scientific validity of the custom personality questionnaires or the semantic accuracy of all translations.

The environment and live Telegram network are outside the deterministic suite. Real service persistence and delivery behavior require a separately authorized integration environment. No owner setup action is needed to run this local suite in the existing development environment.

## grammY 1.48.0 upgrade verification

The project dependency and lockfile now use grammY 1.48.0 and its matching Telegram types. Runner remains at 2.0.3. All 902 tests pass locally: the existing 892 tests plus ten compatibility cases in `grammy-compatibility.test.ts`. Original test cases and assertions remain byte-identical. The shared fake bot profile gained the seven required Telegram capability booleans; no assertion, test exclusion, skip or failure expectation was changed.

Compatibility tests exercise each bot's actual startup registrations and a representative command through real grammY handlers, IVWhat URL conversion, and Converslation language selection plus inline translation-result construction with an external-service double. The runner boundary is mocked so tests can inspect the requested update types without polling Telegram. The tests revealed an existing polling configuration defect: Converslation handled inline_query internally but never requested those updates. Shared initialization now accepts a typed per-bot update list; only Converslation adds inline_query. The regression was observed failing before the application fix.

These tests replace Telegram transport, database/Redis access and OpenAI responses. They do not establish real OpenAI credentials or completion availability, real matchmaking with users, or real Telegram account interaction. Production connectivity and polling subscription checks are recorded separately in DOCKER-RESOURCES.md after deployment.
