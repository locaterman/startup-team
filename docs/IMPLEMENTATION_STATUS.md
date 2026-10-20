# Implementation and verification status — 2026-10-20

Current implementation: v0.4.0, 64 API operations. See [completion report](COMPLETION_2026-10-20.md) for evidence and the exact limits of verification. Earlier baseline/remediation reports describe historical states and are preserved for traceability.

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
- No external email/Telegram notification delivery, Telegram initData authorization, AI matching or ranking.
- Demo authentication/default secrets are for loopback development. Public production deployment has not been tested.
- No claim of testing every UI/role/state combination, real on-screen keyboards, screen readers or every possible race/stress condition.
- Historical v0.1 schema variants beyond the observed/simulated compatible schemas have not been verified. Migration refuses detected contradictory relationships instead of deleting data.
- Original assignment DOCX is still unavailable. Applicant must personally supply the AI-verification example and actual development time. Public GitHub link/permission to publish remain separate delivery steps; this folder has no .git metadata.
