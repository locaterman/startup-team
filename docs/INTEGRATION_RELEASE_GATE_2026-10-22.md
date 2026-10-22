# Startup Team — integration release gate (2026-10-22)

Status: **OPEN / NOT ACCEPTED**. Applies only to `chatgpt/complete-api-integration`, not to `main`. The test preview shares the test database with the original frontend.

## Why this gate exists

The original backend review and the complete-design review covered separate implementations. The current hybrid integration must be reviewed and tested as a **new system**. A TypeScript/Vite build is necessary but never a sufficient release criterion.

## Confirmed defects and fixes (not yet browser-verified)

- [x] Login/retry incorrectly emitted global "Готово" through `perform`: auth paths now use a separate single-flight handler.
- [x] `SESSION_EXPIRED` was shown untranslated: client now maps error codes to Russian copy.
- [x] A user with an existing vacancy application still saw an enabled "Откликнуться": the client now uses one authenticated `GET /applications/mine` response, suppresses duplicate submission UI, and links to existing attempts.
- [x] Disabled auth / existing-application buttons lacked clearly distinct styling: disabled states are now dark grey.
- [ ] Confirm the above fixes in a real browser after rebuilding the preview.

## Automated checks now implemented

- [x] Native Node regression tests for `getApplyState` (new, pending, rejected, withdrawn, reset, owner, paused, archived, expired).
- [x] API-client regression tests (cursor paging/cycle protection, credential mode, CSRF, Idempotency-Key, If-Match, session error localization).
- [x] `frontend/Dockerfile` runs `npm test` before `npm run build`.
- [x] GitHub Actions runs tests and TypeScript/Vite build: [successful run](https://github.com/locaterman/startup-team/actions/runs/39770048428).
- [ ] Browser Playwright scenarios are authored in `frontend/e2e/live-smoke.spec.mjs`, **but have not been executed in a running browser**. E2E environment setup is pending.

## P0 — required browser acceptance before merging

- [ ] Clean browser, demo login: config loads, a single login request, `/auth/csrf` and `/auth/context` work; no false success banner.
- [ ] Expired session: show a correctly translated message where appropriate; "Повторить проверку" restores a valid existing session without spawning another login request; no false "Готово".
- [ ] Distinct test-host cookies: old `127.0.0.1:18080` and preview `localhost:18086` do not collide. Do not compare two ports on the same hostname when testing independent sessions.
- [ ] Login with two distinct demo users in isolated browser contexts; names, own applications, managed projects and private notifications never leak between users.
- [ ] New startup + vacancy are persisted; refresh page, server state remains correct.
- [ ] Apply once to vacancy: POST succeeds; afterward the Apply button is disabled, indicates "Отклик уже отправлен", and provides "Мои отклики". Reload keeps the disabled state. Repeat is done only via the existing application/attempt flow when the backend allows it.
- [ ] Apply command errors, network loss and permission denial: no false success; form retained, retry cannot create duplicates; `Idempotency-Key` semantics maintained.
- [ ] Attempt history and vacancy versions remain bound to historical conditions; don't infer from the current vacancy.
- [ ] Candidate review and offer: candidate, owner and recruiter views respect server access control and self-review restrictions.
- [ ] Reserved/occupied vacancy capacity cannot be exceeded by concurrent offers/acceptance.
- [ ] Recruiter invitation and grant remain separate; revoking recruiter access does not revoke membership.
- [ ] Read/unread notifications belong to the signed-in user; no synthetic target links.
- [ ] Logout revokes session, clears CSRF/private state and does not show a success banner on the auth screen.
- [ ] Telegram initData and first-time onboarding are tested on HTTPS in actual Telegram WebView (not inferred from demo login).

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

1. Legacy global `frontend/src/style.css` is still imported; dark theme is partly a scoped override. Consequently "complete" visual parity **is not complete**.
2. The current implementation still contains working UI logic inside a large `App.tsx` and reuses `ApplicationCard`, `OfferCard`, `VacancyView`, `FormDialog`, `Team` and `Recruiters`. They require scoped migration, not premature deletion.
3. There is no automated browser E2E suite in `frontend`. A compilation success alone leaves functional and cross-session regressions untested.
