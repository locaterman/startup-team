# Review remediation — v0.2 (static patch, runtime verification pending)

Review source: user-supplied engineering review, 9 findings.

| Finding | Change in v0.2 | Status |
|---|---|---|
| F-01 cross-record integrity | `001_initial.sql` integrity triggers for attempt/version, offer/attempt identity, membership/offer, recruiter/grant, test/version; immutable binding fields; adversarial PostgreSQL tests | **Patched, PostgreSQL not yet run** |
| F-02 missing migration/UI/build/runtime proof | Added DB-integrity test module. No actual PostgreSQL server / Docker validation yet | **OPEN** |
| F-03 idempotency + optimistic revisions | Existing schema has a key table and revisions, but no middleware enforcing `Idempotency-Key`/`If-Match` | **OPEN** |
| F-04 offer/attempt coupled transition | Added explicit matrix and changed expiry/revoke logic; accept offer before membership insertion to satisfy DB constraint | **Patched, runtime not run** |
| F-05 test version drift | Required `test_version_id` in API schema and backend; validates vacancy and rejects versions superseded by critical update | **Patched, runtime not run** |
| F-06 reducing vacancy capacity | Already guarded in `vacancy_settings()` under startup lock | **Present in v0.1; runtime not run** |
| F-07 authorization scope | Added contextual read rules to OpenAPI, matrix in domain document; backend checks existed for primary private endpoints | **Documented; runtime authorization tests OPEN** |
| F-08 pagination | List schemas now require `next_cursor`; actual backend still always reports null and some endpoints limit results | **PARTIAL: cursor pagination OPEN** |
| F-09 recruiter invite lifecycle | Explicit matrix + owner revoke endpoint + startup archive revocation | **Patched, runtime not run** |

Static checks in v0.2: **7 passed, 2 skipped** (the skipped modules require a migrated PostgreSQL test database).

No P0 remediation is considered **verified** without migrated PostgreSQL and negative/adversarial tests. Full frontend build, idempotency, `If-Match`, cursor pagination, notifications and full integration tests remain open; do not submit as completed.

Migration warning: `0001_initial.py` reads `db/001_initial.sql`. Updated SQL defines a new **fresh install** schema, not an incremental Alembic revision. Apply only to a disposable new database. To upgrade an existing v0.1 database, write and test a separate Alembic migration; never reapply initial SQL to live data.
