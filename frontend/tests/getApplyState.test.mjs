import assert from "node:assert/strict";
import test from "node:test";
import { getApplyState } from "../src/getApplyState.ts";

const now = Date.parse("2026-10-22T12:00:00Z");
const vacancy = {
  id: "v-1",
  owner_id: "owner",
  startup_status: "active",
  status: "published",
  application_deadline: "2026-11-30T12:00:00Z",
};
const mine = (status = "pending") => [
  { vacancy_id: "v-1", applicant_id: "candidate", status },
];
const state = (overrides = {}, applications = [], error = "", busy = false) =>
  getApplyState({ ...vacancy, ...overrides }, "candidate", applications, error, busy, now);

test("new candidate can apply only after existing applications were fetched", () => {
  assert.deepEqual(state({}, []), { kind: "available" });
  assert.deepEqual(state({}, undefined), { kind: "loading" });
  assert.deepEqual(state({}, undefined, "Network unavailable"), { kind: "error" });
});

test("an existing application can never be created twice, regardless of attempt status", () => {
  for (const status of [
    "pending", "reviewing", "offer_pending", "joined", "rejected",
    "withdrawn", "reset", "already_joined", "closed",
  ]) {
    assert.deepEqual(
      state({}, mine(status)),
      { kind: "existing", applicationStatus: status },
      "status " + status,
    );
  }
});

test("only the current candidate's application for the exact vacancy counts", () => {
  assert.deepEqual(state({}, [
    { vacancy_id: "v-2", applicant_id: "candidate", status: "pending" },
    { vacancy_id: "v-1", applicant_id: "another", status: "pending" },
  ]), { kind: "available" });
});

test("the owner, inactive project, closed vacancy, expired deadline, malformed deadline have no apply action", () => {
  for (const change of [
    { owner_id: "candidate" },
    { startup_status: "paused" },
    { startup_status: "archived" },
    { status: "intake_closed" },
    { status: "archived" },
    { application_deadline: "2026-10-22T11:59:59Z" },
    { application_deadline: "not-a-date" },
  ]) {
    assert.deepEqual(state(change), { kind: "hidden" });
  }
});

test("pending mutation blocks new submission, but existing server application takes precedence", () => {
  assert.deepEqual(state({}, [], "", true), { kind: "busy" });
  assert.deepEqual(
    state({}, mine("pending"), "", true),
    { kind: "existing", applicationStatus: "pending" },
  );
});
