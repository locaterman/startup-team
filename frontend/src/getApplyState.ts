import type { Application, Vacancy } from "./api";

export type ApplyState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "existing"; applicationStatus: string }
  | { kind: "member" }
  | { kind: "busy" }
  | { kind: "available" };

/**
 * Presentation eligibility only. The backend always remains authoritative:
 * this function never grants permission or creates an application.
 *
 * The canonical applications list is returned by GET /applications/mine.
 * Creating another application for the same vacancy is forbidden even after
 * a reset, withdraw or reject: the existing attempt/history must be reused.
 */
export function getApplyState(
  vacancy: Pick<Vacancy, "id" | "startup_id" | "owner_id" | "startup_status" | "status" | "application_deadline">,
  currentUserId: string,
  applications: ReadonlyArray<Pick<Application, "vacancy_id" | "applicant_id" | "status">> | undefined,
  applicationsError: string,
  busy: boolean,
  now: number = Date.now(),
  joinedStartupIds: ReadonlySet<string> = new Set(),
): ApplyState {
  if (
    vacancy.owner_id === currentUserId ||
    vacancy.startup_status !== "active" ||
    vacancy.status !== "published" ||
    !(Date.parse(vacancy.application_deadline) > now)
  ) return { kind: "hidden" };

  if (applications === undefined) {
    return applicationsError ? { kind: "error" } : { kind: "loading" };
  }

  const existing = applications.find(
    (app) => app.vacancy_id === vacancy.id && app.applicant_id === currentUserId,
  );
  if (existing) return { kind: "existing", applicationStatus: existing.status };
  if (joinedStartupIds.has(vacancy.startup_id)) return { kind: "member" };

  return busy ? { kind: "busy" } : { kind: "available" };
}
