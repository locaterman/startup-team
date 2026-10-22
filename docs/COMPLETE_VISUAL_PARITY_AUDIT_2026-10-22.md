# Complete → FastAPI frontend: independent visual comparison

Date: 2026-10-22. Branch: `chatgpt/complete-api-integration`. **Draft: not a release acceptance certificate.**

## Verifiable sources

- **Approved reference:** [Original complete Chromium screenshots](https://github.com/locaterman/startup-team/actions/runs/39787330681) — captured by running `design/prototypes/complete.html` using its own seed data and CSS at **1365×900** and **390×844**.
- **Integrated live app (prior stable build):** [Actual backend + Chromium screenshots](https://github.com/locaterman/startup-team/actions/runs/39785055577) — real demo login, real FastAPI and disposable PostgreSQL; includes empty and populated application, offer and candidate screens at identical viewports.
- **Current code after this audit:** changes to `App.tsx`, `FormDialog.tsx`, `ProjectSettingsPanel.tsx`, `project-settings.css`, `complete-records.css`, `discovery.css`, and E2E tests. Full fresh acceptance for these latest edits must be read from the latest branch CI, **not** inferred from prior runs.

The reference seed and live backend contain different projects, applications and usernames. Therefore raw pixel-difference percentage or an exact match threshold would be misleading. Audit compares components, hierarchy, typography, spacing, interactions and data correctness; the browser suite separately checks real commands.

## Source-grounded findings and resolution

| UI surface | Reference behavior / appearance | Before audit in live app | Current status |
|---|---|---|---|
| Header | Two-line brand, section tabs, account and notifications | Similar dark header; demo-only eyebrow/help text is deliberately absent | Accept semantic difference; not exact pixel certified |
| Catalog (desktop) | Search, filters, create-project controls on the same toolbar row | Create-project button wrapped to another line in 1365px screenshot | **Fixed in CSS** for viewport >=1100px; needs latest screenshot confirmation |
| Applications (empty) | Grouped sections, ruled separators, prominent centered empty state and **Найти проект** CTA; link to teams | Only brief plain text, no empty-state navigation | **Fixed** with actual `ctx.showProjects` / `ctx.showTeams`; Chromium assertions added |
| Cabinet settings | Inline titled project editor, project-status sidebar, archiving actions | Read-only summary and a button that opened a modal | **Fixed**: real revision-aware PATCH via inline `ProjectSettingsPanel`, disabled/dirty/save/reset states and pause/archiving commands |
| Cabinet settings after save | Remains on project settings | Revision refresh briefly unmounted child and reset active tab to Responses | **Fixed** by retaining selected workspace tab in `Cabinet`; browser regression test added |
| Candidate review | Selected candidate profile (bio, skills, portfolio), letter, historic attempt conditions and event timeline in the right panel | Only name and application letter initially; historic details hidden under extra click | **Fixed**: authenticated `GET /users/{id}` for profile, historic detail expanded by default in manager mode; browser assertions added |
| Mobile candidate review | List → detail → back navigation | Earlier hybrid showed simultaneous list/detail | Already fixed and verified in a populated Chromium scenario |
| Application history | Versioned conditions are snapshotted per attempt | Current API component reads `/applications/{id}/attempts` | Preserved; regression E2E for old/new version passes |
| Offers/capacity | State labels and invitation actions | Backend API route implementation present | Preserved; capacity and acceptance browser flows pass |
| Modal/drawer | Original uses a full-height side panel with keyboard navigation | Hybrid used centered modal | Migrated to right drawer; FormDialog has been extracted without changing server command ownership |
| Removal of empty project | Prototype contains delete-empty-project action | Backend **does not expose** `DELETE /api/v1/startups/{id}` | **Not implemented intentionally**: cannot invent a client-only action or bypass server contract; separate backend product decision required |
| Footer, demo-only text | Prototype marks local demo information | Live app has genuine authenticated API | Demo-specific copy omitted intentionally |

## Cleanup completed

1. Legacy green/white `frontend/src/style.css` is deleted.
2. Extracted working command form from monolithic App into `frontend/src/FormDialog.tsx` (component, types, focus trap, errors and busy). No duplicate command implementation.
3. Deleted obsolete `openProjectSettings` modal helper after replacing settings with the inline form.
4. Removed proven-unused old `cw-settings-layout`, mini-grid and old helper CSS rules.
5. All actual API client/session logic, attempts, offers, recruiter grants and CSRF/If-Match/idempotency paths remain server-controlled.

## Required before PR acceptance

- [x] Latest integration run: frontend unit + TypeScript/Vite, **99 backend tests and 14 Chromium E2E without retries** including historic conditions, inline settings, authentication, concurrency and mobile candidate details. [Run #39806856679](https://github.com/locaterman/startup-team/actions/runs/39806856679).
- [ ] Review **new** screenshots for actual catalog toolbar, empty applications, inline settings and populated candidate inspector at 1365px/390px against reference. Previous screenshots alone do not validate new code.
- [ ] Verify keyboard navigation, focus trapping/restoration and contrast; automated smoke checks are not an accessibility audit.
- [x] Browser E2E: simulated failed PATCH preserves input without a false success; retry saves it. Stale If-Match returns conflict without overwriting the newer server record or losing the unsaved draft.
- [ ] Verify Telegram WebView + HTTPS and prevent demo auth in production.
- [x] Parallel PostgreSQL test: simultaneous offer creation for one remaining seat and simultaneous acceptance of the same offer never create extra offers, accepted members or events.
- [ ] Independent PR review and explicit release acceptance are still required before merge or deployment.

**Protection:** original `main`, the Debian home server and its PostgreSQL volume must remain unchanged until release is accepted.
