# Implementation and verification status — 2026-10-20

Update 2026-10-21: review findings F1/F3/F4/F5 fixed in the working copy; **96 backend tests + 24 independent checks passed** on disposable PostgreSQL, with matching 67 API methods. Details: [review fixes](REVIEW_FIXES_2026-10-21.md). The original assignment text was supplied directly in the current user conversation.

Update 2026-10-22: F2/F6 fixed in the separate design prototype; **47 prototype rule/render checks**, TypeScript and Vite/Docker build passed. Browser verified one submission per version/attempt and candidate access to complete historical conditions after reset/reapplication. Details: [stage two](DESIGN_STAGE2_2026-10-22.md). The prototype still uses localStorage and is not API-integrated; full domain parity is not claimed.

Current implementation: v0.5.0, 67 API operations. Telegram auth implementation and current evidence: [setup/status](TELEGRAM_SETUP.md), including 67 backend checks plus 24 independent safety probes. Real BotFather/HTTPS deployment and Telegram iOS/Android checks remain pending. See the earlier [completion report](COMPLETION_2026-10-20.md) for domain behavior and historical evidence. The new full design remains a separate prototype; only real auth/onboarding screens use its visual system so far.

## Implemented

- Profile/session/CSRF, startup and vacancy catalogs, publication and contextual owner/recruiter access.
- General and vacancy applications, decisions with reasons, withdrawal/restoration, historical attempts and reapplication after reset or team departure.
- Startup/vacancy state controls, vacancy settings and immutable versions, optional versioned tests and explicit-version submissions.
- Offers with exact historical conditions, seat reservations, candidate consent, team membership/exit/removal, separate recruiter invitations/grants.
- Actor-bound command receipts, same-key replay/conflict, optional optimistic revision guards, signed cursor pages and independent managed/member lists.
- Protected history and address-specific notification production for core events.
- UI screens/actions for these selected workflows; main entities have meaningful names and links.
- Frozen initial schema and a separate validating upgrade migration. The existing main DB remains at its original revision until deliberately upgraded.

## Verified

- 42 standard/static/regression tests on disposable PostgreSQL 16, including command replay after reset/resubmission, concurrent retries, stale revisions, historical conditions/reasons, 104-record pagination, URL validation and migration preservation/refusal cases.
- 24 unchanged independent safety probes: 20 controlled concurrency interleavings, independent deadlines and authorization/session matrix.
- JSON Schema validation of 21 representative response resources plus an error envelope; not exhaustive conformance certification of every operation.
- Backend and frontend image builds, TypeScript/Vite compilation.
- Browser: general/vacancy applications, decision reason, version reset, resubmission with both historical letters, explicit test version submission, external recruiter invitation/acceptance, offer acceptance and membership.
- Dedicated named-volume stand survived full container removal/recreation with identical entity/session counts; the browser session and membership survived.
- Cabinet at 390×844: document/body width 390; no horizontal overflow in observed content.
- Upgrade of the exact observed schema-only snapshot of the existing DB with synthetic data. Main DB data was not copied into tests or migrated.

## Remaining limits / delivery inputs

- Server page formation currently materializes authorized lists before slicing. SQL-side selection is a scale improvement; no hidden 100-record cutoff remains.
- UI retry keys survive a network failure only within the current page lifetime. Direct clients must retain keys; after reload inspect results before issuing a fresh destructive command.
- No external email/Telegram notification delivery, AI matching or ranking. Signed initData authorization is now implemented and tested offline; actual Telegram launch is not yet verified.
- Demo authentication/default secrets are for loopback development. Public production deployment has not been tested.
- No claim of testing every UI/role/state combination, real on-screen keyboards, screen readers or every possible race/stress condition.
- Historical v0.1 schema variants beyond the observed/simulated compatible schemas have not been verified. Migration refuses detected contradictory relationships instead of deleting data.
- The original assignment text has now been supplied by the user. Applicant must personally supply the AI-verification example and actual development time. The GitHub repository is private by user request; local design/auth work is not committed/pushed yet. Public submission/access remains a separate delivery step.
