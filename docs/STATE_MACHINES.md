# Domain rules / state machines v1.2

Target implementation, selected by user. No AI matching, recommendations or ranking.

## Startup
- `active -> paused`, `paused -> active`; `active|paused -> archived`.
- `paused`: no new applications, offers, or recruiter invites; **already pending** offers may be accepted until expiry.
- `archived`: freezes recruitment, archives vacancies, revokes pending offers, preserves existing membership and history. Cannot resume.
- Empty startup with no interactions can be physically deleted; any interactions force archiving.

## Vacancy
- Status `published`, `intake_closed`, `archived`.
- `published` can receive applications only while active startup and DB current time < application_deadline.
- `intake_closed` stops intake but old applications may still receive offers.
- `archived` stops intake and new offers; outstanding offers can still be accepted under historic terms unless the parent startup is archived.
- `reopen-intake` requires a future deadline; author controls application_deadline independently from offers.
- Filled or reserved positions **do not** stop applications before the deadline.

## Application and attempt
- One permanent `Application` per (applicant, vacancy); one per (applicant, startup) for general interest.
- Attempts: `pending -> reviewing -> offer_pending -> joined`; branches `rejected`, `withdrawn`, `reset`, `declined`, `already_joined`, `closed`.
- Applicant withdraws pending or reviewing; may restore only before intake ends. Rejection cannot be independently restored.
- On major vacancy update, publisher chooses keep or reset; reset cancels unfinished attempts *except those with pending offers*. Resubmission creates new attempt without deleting historical version.
- After joining via one offer, close other unfinished attempts to same startup; do not affect other startups.
- Intake deadline affects **new** applications, not previously submitted applications or pending offers.

## Offer / places
- `pending -> accepted|declined|revoked|expired`; accepted cannot be revoked.
- Each pending offer reserves one vacancy position if vacancy_id is set. General startup offers reserve none.
- Available = positions_count - active joined members via that vacancy - **unexpired** pending offers.
- Always lock startup record during capacity-affecting operations; process expired pending offers first.
- One pending offer per candidate per startup; existing old offers are not deleted.
- Offer can be accepted during startup pause but never after startup archive.
- Candidate consent and membership creation happen in the same transaction; team membership does not confer recruiter rights.

## Recruiter / team
- Owner is fixed on startup. Recruiter grants are separate from membership.
- External recruiter may hold grants from many startups, but cannot decide on own applications or change recruiter grants.
- Member can leave, owner can remove member; preserve membership history. On leave, an active joined vacancy capacity is released, without automatically reopening archived vacancy.

## Test versions
- Candidate submits HTTPS link bound to a specific immutable test version and application attempt.
- Pending, reviewing, and offer_pending attempts may submit a solution. An outstanding offer does not prevent replacement after a critical test update; tests remain optional for accepting an offer.
- `ordinary` update keeps existing work; `critical` marks prior unfinished submissions superseded and requires newer solution for further test-based evaluation. Previously completed hiring is not retroactively changed.
- Tests are optional per vacancy; recruiter may evaluate candidates without them.

## Cross-record guarantees
- Authoritative checks are server-side; unique constraints protect duplicates.
- Effects touching several records commit or roll back together.
- Cross-table ownership and same-startup relations must be validated inside the locked transaction.
- Do not treat UI visibility as authorization.
- Event log and user-facing notifications must not disclose private candidacy information to unrelated users.

## Joint Offer/Attempt transition matrix (v1.3)

All changes in one transaction with the corresponding `startups` row locked. These
are **coupled** changes, not independent `PATCH` operations.

| Trigger | Offer before → after | ApplicationAttempt before → after | Membership / capacity |
|---|---|---|---|
| Recruiter sends invite | none → `pending` | `pending|reviewing` → `offer_pending` | Reserve 1 if vacancy-specific |
| Candidate accepts | `pending` → `accepted` | `offer_pending` → `joined` | Create matching membership; pending reservation becomes occupied |
| Candidate declines | `pending` → `declined` | `offer_pending` → `declined` | Release reservation; attempt terminal |
| Recruiter revokes | `pending` → `revoked` | `offer_pending` → `reviewing` (selection active) or `closed` (archived selection) | Release reservation |
| Clock expiry | `pending` → `expired` | `offer_pending` → `reviewing` (selection active) or `closed` (archived selection) | Release reservation |
| Startup archives | `pending` → `revoked` | `offer_pending` → `closed` | Release reservation; keep existing membership history |
| Candidate joins via another offer | `pending` → `revoked` | `offer_pending` → `already_joined` | Release competing reservations |

*"Selection active"* means parent startup has not been archived and target
vacancy, if any, has not been archived. Startup **pause** and vacancy **intake
closure** still allow review of existing applications; expired/revoked
invitations can return to `reviewing` in these cases. A prior `declined`
attempt is not restored automatically: it is a completed candidate decision.

The selection state and intake state are separate: application submission must
check `startup.status='active'`, vacancy status `published`, deadline in the
future; selection may continue after the intake deadline.

## Recruiter invitations

- Owner sends `pending` only while startup `active`.
- `pending -> accepted` requires matching invitee, not expired, startup `active`.
- `pending -> declined` belongs to invitee; can happen during pause.
- `pending -> revoked` belongs to startup owner; allowed during pause.
- `pending -> expired` uses server/database time and is permitted in any startup state.
- Archiving startup revokes all `pending` recruiter invitations.
- `accepted` creates a matching recruiter grant atomically. Grant revocation is
  separate and does not rewrite the historical invitation.

## Capacity invariants

- Vacancy `positions_count >= occupied + reserved` after every successful
  transaction changing the limit or capacity.
- `occupied` counts active members joined through **accepted** offers on that vacancy.
- `reserved` counts `pending` vacancy offers whose `expires_at` is in the future.
- No negative availability: lowering capacity below occupied+reserved fails
  (`BELOW_COMMITTED_CAPACITY`).
- All mutating capacity operations lock the parent `startups` row; creation of
  a membership updates the source offer to `accepted` first, then inserts
  membership in the **same transaction** (database trigger validates linkage).
- Archiving a vacancy never cancels already sent offers. Startup archive does.
- Leaving the team releases occupied vacancy capacity; archived vacancy remains archived.

## Read authorization / data privacy

- Applicant may see own application, attempt/test submissions, offer, and history.
- Owner and **currently granted** recruiter may see candidacies, related tests
  and nonpublic events for their startup, except no decisions on their own application.
- Normal team membership **does not** grant access to private candidacies.
- Unrelated logged-in users may see public startup/vacancy/profile information,
  not candidacies, private events or submissions.
- Public `members` lists must not expose private history or email addresses.
- Authenticated public membership reads include only current members. Owner and currently granted recruiters may additionally read departed membership rows; departure reasons and email are not part of this projection.

## Reapplication after departing team

- Old `joined` and `already_joined` outcomes and accepted offers remain historical facts. After departure, a new attempt can be made on either previous application if intake is open; no active membership may exist.
- A new attempt on the same permanent Application is allowed only after the
  person no longer has active membership, if the new intake is open.
- Resubmission after `reset` also requires an open intake. These are the only
  two currently defined reasons to create a fresh attempt.

## Implemented command receipts and pages (2026-10-20)

- Optional Idempotency-Key is actor-bound and stored atomically with successful command effects. Same key/different normalized command conflicts; concurrent same-key requests serialize through a PostgreSQL transaction advisory lock acquired before domain locks. Without a key the request is a new command.
- UI retains a pending key across network failures while the page remains open. Direct clients must retain their keys. Receipts do not automatically expire.
- Optional If-Match uses a quoted positive revision; the resource startup lock is obtained before comparing current state. Stored receipt replay precedes revision checking.
- Lists have UUID-ascending signed keyset cursors bound to actor/path/filters. Backend currently materializes authorized selections before slicing; this is a small-community implementation rather than a large-catalog optimization.
- Historical attempts, exact offer conditions, rejection reasons and related events have protected read APIs. Notifications for core application/offer/test/version events are committed with those events.
