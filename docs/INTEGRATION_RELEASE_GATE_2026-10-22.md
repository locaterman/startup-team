# Startup Team — integration release gate (2026-10-22)

Status: **OPEN / NOT ACCEPTED**. Applies only to `chatgpt/complete-api-integration`, not to `main`. The test preview shares the test database with the original frontend.

## Why this gate exists

The original backend review and the complete-design review covered separate implementations. The current hybrid integration must be reviewed and tested as a **new system**. A TypeScript/Vite build is necessary but never a sufficient release criterion.

## Confirmed defects and regression fixes

- [x] Login/retry incorrectly emitted global "Готово" through `perform`: auth paths now use a separate single-flight handler.
- [x] `SESSION_EXPIRED` was shown untranslated: client now maps error codes to Russian copy.
- [x] A user with an existing vacancy application still saw an enabled "Откликнуться": the client now uses one authenticated `GET /applications/mine` response, suppresses duplicate submission UI, and links to existing attempts.
- [x] Disabled auth / existing-application buttons lacked clearly distinct styling: disabled states are now dark grey.
- [x] Core login, logout, duplicate-submission, reset and resubmission flows passed on the isolated CI browser stack. Local Debian preview still needs an update and manual UI verification.

## Automated checks now implemented

- [x] Native Node regression tests for `getApplyState` (new, pending, rejected, withdrawn, reset, owner, paused, archived, expired).
- [x] API-client regression tests (cursor paging/cycle protection, credential mode, CSRF, Idempotency-Key, If-Match, session error localization).
- [x] `frontend/Dockerfile` runs `npm test` before `npm run build`.
- [x] GitHub Actions runs tests and TypeScript/Vite build: [successful run](https://github.com/locaterman/startup-team/actions/runs/39770048428).
- [x] **7 Playwright Chromium tests passed without retries** against an isolated disposable PostgreSQL/Compose stack: [GitHub Actions run](https://github.com/locaterman/startup-team/actions/runs/39777299638). Includes 12 sequential logins immediately followed by CSRF/profile/context reads, version reset and resubmission, capacity reservations/acceptance, recruiter grants/revocation, old-cookie login and two-account submission. Temporary database deleted.
- [x] Found and fixed response framing bug: logout emits bodyless 204; pytest and ASGI-log checks pass.
- [x] FastAPI >=0.121 and `Depends(db, scope="function")` ensure transaction commit precedes response delivery (including session creation). GitHub run above verifies actual behavior.
- [x] **Complete backend regression suite: 97 passed**, 1 nonblocking StarletteDeprecationWarning, in separately migrated `startup_test_ci` database on the disposable CI stack; 7 Chromium E2E passed without retries afterward. [Verified CI run](https://github.com/locaterman/startup-team/actions/runs/39777958779).

## P0 — required browser acceptance before merging

- [x] Chromium demo login and logout with no false "Готово"; 12 immediate CSRF/profile/context reads after login all returned 200 without retries.
- [ ] Expired session: show a correctly translated message where appropriate; "Повторить проверку" restores a valid existing session without spawning another login request; no false "Готово".
- [ ] Distinct test-host cookies: old `127.0.0.1:18080` and preview `localhost:18086` do not collide. Do not compare two ports on the same hostname when testing independent sessions.
- [ ] Login with two distinct demo users in isolated browser contexts; names, own applications, managed projects and private notifications never leak between users.
- [ ] New startup + vacancy are persisted; refresh page, server state remains correct.
- [x] Two-user Chromium flow: owner creates project and vacancy, candidate submits an application, UI disables duplicate Apply, refresh preserves disabled state, and "Мои отклики" shows the application.
- [ ] Apply command errors, network loss and permission denial: no false success; form retained, retry cannot create duplicates; `Idempotency-Key` semantics maintained.
- [x] Chromium + real API: original vacancy version retained after reset, new attempt references version 2; both historical versions and resubmission event verified.
- [ ] Candidate review and offer: candidate, owner and recruiter views respect server access control and self-review restrictions.
- [x] Sequential full-capacity flow: a pending offer reserves the last place, a second offer is rejected, accepted offer becomes occupied. **Concurrent race** test still outstanding.
- [x] Owner-issued recruiter invitation, acceptance, delegated vacancy creation and revoke tested; recruiter grant did not create membership. **Grant revocation of an already-active member** still outstanding.
- [ ] Read/unread notifications belong to the signed-in user; no synthetic target links.
- [x] Logout 204 has no body, deletes cookie, and browser returns to auth without success banner; separate backend HTTP framing pytest passes.
- [ ] Telegram initData and first-time onboarding are tested on HTTPS in actual Telegram WebView (not inferred from demo login).


**Scope note:** passing seven browser tests is not complete P0 acceptance. Telegram WebView, true concurrent writes, full UI parity, some denied states and accessibility remain open.

## Visual integration progress (2026-10-22)

- [x] Physically deleted unused old white-and-green `frontend/src/style.css`, replaced with `app-foundation.css` based on approved `final/complete` colors and font.
- [x] API-backed project review workspace updated to approved side-list + detail-panel layout.
- [x] Desktop 1365px and mobile 390px visual foundation tests passed (9 total browser E2E, with 97 backend tests) after old stylesheet removal: [successful run](https://github.com/locaterman/startup-team/actions/runs/39779895275).
- [x] GitHub Actions saves screenshot evidence under `complete-design-visual-evidence` artifact for every visible section and dialog.
- [x] Screenshots inspected: discovered real overlapping workspace tabs at 390px; fixed with non-shrinking horizontal-scroll tabs and added geometric non-overlap assertion. Final CI rerun required.
- [ ] Independent side-by-side screenshot review against complete prototype, including all empty/error/status states and mobile-specific detail navigation.
- [ ] Rework the still-active older components into approved full layout where screenshot differences remain (without deleting domain actions).

## Current component migration (2026-10-22)

- [x] Production `ApplicationCard` and `OfferCard` rows now follow the approved complete list-row presentation, preserving all backend transitions and revision checks.
- [x] `ApplicationDetails` shows event history as a timeline and keeps server attempt snapshots, versioned test submissions and manager review handlers.
- [x] `VacancyView`, member and recruiter lists use the same dark record hierarchy without replacing real data with prototype localStorage.
- [x] Forms display in the complete-design right-side full-height drawer, keeping working `FormDialog` inputs, busy/validation, focus trapping and command execution.
- [x] At mobile width, selecting a candidate opens a separate details view with a back-to-list action; Chromium test added with real project and candidate state.
- [ ] Latest complete browser/backend CI green status and screenshot inspection after all revisions (pending at time of writing).
- [ ] Strict visual parity with the approved prototype across all populated workflows, combined error/conflict/empty states and responsive detail navigation. Further independent design review required.
- [ ] Component extraction from monolithic `App.tsx` and removal of old, now-unused helper markup without losing API behavior.

## P1 — visual and interaction parity

- [ ] Compare screens to `design/prototypes/src/complete/` at desktop and 390px width: catalog, vacancies, project detail, workspace (all tabs), personal applications, teams, profile, notifications and modals.
- [ ] Verify loading, empty, denied, conflict, expiration and retry states for each major screen.
- [ ] Verify all form controls disabled while action is pending; double-click does not issue duplicate actions.
- [ ] Keyboard focus: skip link, dialogs, tabs, candidate list, mobile detail/back navigation.
- [ ] Check all buttons, status badges, links and layout under current dark design. Remove visual remnants of the legacy green/white UI.

## Architectural cleanup — after parity + scenario verification

- [ ] Extract/rewrite remaining working legacy UI components only after their API actions have been preserved and tested.
- [ ] Remove legacy CSS selectors and obsolete frontend files only when no active references remain; never wholesale-delete the existing auth/API transport.
- [ ] Rebuild **again** and repeat P0 smoke test after cleanup.
- [ ] Independent review of PR diff and test evidence before merge.

## Build and deployment rule

- The preview must build using `frontend/Dockerfile` (`tsc -b && vite build`).
- Build `chatgpt/complete-api-integration` using isolated `~/startup-team-ui-check` worktree.
- Rebuild image fully **before** replacing preview `startup-team-ui-preview` bound to `127.0.0.1:18086`.
- Keep backend/database/`startup_team` production-like service on `18080` unchanged. No `docker compose down -v`, data deletion, or auto-merging.
- PR stays a draft until all P0 items are evidenced and frontend visual parity is verified.

## Known remaining risks

1. Legacy global `frontend/src/style.css` has been deleted and replaced by `frontend/src/app-foundation.css` using approved complete/final dark theme tokens. Reused functional components and screen-specific overrides remain, so full pixel/interaction parity with `complete` **is not yet certified**.
2. The current implementation still contains working UI logic inside a large `App.tsx` and reuses `ApplicationCard`, `OfferCard`, `VacancyView`, `FormDialog`, `Team` and `Recruiters`. They require scoped migration, not premature deletion.
3. Chromium E2E and transactional commit tests are now automated, but the scope is still limited. These tests are not a substitute for full visual parity, accessibility, true concurrent capacity checks or Telegram WebView.
