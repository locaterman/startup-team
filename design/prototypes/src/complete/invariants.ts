// Run against an isolated in-memory demo; never touches application data.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AttemptHistory } from "./AttemptHistory";
import {
  seed,
  normalize,
  day,
  instant,
  now,
  uid,
  sync,
  type Entry,
} from "./model";
import {
  createOffer,
  decide,
  resetApplications,
  criticalTest,
  submitSolution,
  capacity,
  setCapacity,
  canReapply,
  deleteProject,
  expire,
  availableTestVersions,
  entryRole,
} from "./rules";
let checks = 0;
function check(ok: unknown, message: string) {
  if (!ok) throw Error(message);
  checks++;
}
function rejects(fn: () => void, message: string) {
  let failed = false;
  try {
    fn();
  } catch {
    failed = true;
  }
  check(failed, message);
}
const fixture = () => {
  const s = seed(),
    a = s.entries[0],
    v = s.vacancies.find((v) => v.id === a.vacancy)!;
  return { s, a, v };
};
{
  const { s, a, v } = fixture();
  createOffer(s, a.id, "Welcome", day(2));
  const o = s.offers.slice(-1)[0]!;
  const snapshot = JSON.stringify(o);
  v.versions.push({ ...v.versions[0], number: 2, title: "Changed" });
  v.title = "Changed";
  resetApplications(s, v.id, "New conditions");
  check(
    a.status === "offer_pending",
    "Reset must preserve an existing offer and attempt",
  );
  check(JSON.stringify(o) === snapshot, "Reset must preserve offer snapshot");
  s.projects.find((p) => p.id === a.project)!.status = "paused";
  decide(s, o.id, "accept");
  check(a.status === "joined", "Existing offer accepts during pause");
  check(
    s.members.slice(-1)[0]?.vacancy === v.id,
    "Membership keeps vacancy ID",
  );
  check(a.attempts[0].version === 1, "Joined attempt keeps original version");
}
{
  const { s, a, v } = fixture();
  v.title = "New title";
  v.versions.push({ ...v.versions[0], number: 2, title: v.title });
  createOffer(s, a.id, "", day(2));
  check(
    s.offers.slice(-1)[0]?.title === v.versions[0].title,
    "Offer uses attempt version rather than latest vacancy",
  );
  v.title = "Renamed again";
  check(capacity(s, v).reserved === 1, "Reservation survives rename");
  rejects(() => setCapacity(s, v, 0), "Cannot remove reserved seat");
}
{
  const { s, a, v } = fixture();
  v.tasks = [
    {
      version: 1,
      description: "First",
      deadline: instant(day(3)),
      critical: false,
    },
  ];
  submitSolution(s, a.id, 1, "https://example.org/first");
  const beforeRepeat = JSON.stringify(s);
  rejects(
    () => submitSolution(s, a.id, 1, "https://example.org/second"),
    "API parity: one submission per attempt and test version",
  );
  check(JSON.stringify(s) === beforeRepeat, "Rejected duplicate preserves original link and events");
  check(availableTestVersions(s, a, v).length === 0, "Already submitted version is absent from the form");
  v.tasks.push({
    version: 2,
    description: "Second",
    deadline: instant(day(3)),
    critical: true,
  });
  criticalTest(s, v);
  check(
    a.submissions.every((t) => t.status === "superseded"),
    "Critical version supersedes unfinished solutions",
  );
  rejects(
    () => submitSolution(s, a.id, 1, "https://example.org/old"),
    "Old critical version cannot be submitted",
  );
  submitSolution(s, a.id, 2, "https://example.org/new");
  createOffer(s, a.id, "", day(2));
  decide(s, s.offers.slice(-1)[0]!.id, "accept");
  const historical = JSON.stringify(a.submissions);
  v.tasks.push({
    version: 3,
    description: "Third",
    deadline: instant(day(3)),
    critical: true,
  });
  criticalTest(s, v);
  check(
    JSON.stringify(a.submissions) === historical,
    "Critical change preserves completed hire solutions",
  );
  s.members.find(
    (m) => m.project === a.project && m.person === a.person,
  )!.active = false;
  check(canReapply(s, a), "Former member can start another attempt");
  const at = JSON.stringify(a.attempts[0]);
  a.attempts.push({
    number: 2,
    version: v.versions.length,
    letter: "Again",
    status: "pending",
    reason: "",
    date: now(),
  });
  a.status = "pending";
  sync(a);
  submitSolution(s, a.id, 3, "https://example.org/again");
  check(
    a.submissions.slice(-1)[0]?.attempt === 2,
    "New solution binds to new attempt",
  );
  check(
    JSON.stringify(a.attempts[0]) === at,
    "Old joined attempt remains immutable",
  );
}
{
  const { s, a, v } = fixture();
  v.tasks = [
    { version: 1, description: 'First', deadline: instant(day(3)), critical: false },
    { version: 2, description: 'Ordinary update', deadline: instant(day(3)), critical: false },
    { version: 3, description: 'Expired', deadline: '2000-01-01T00:00:00Z', critical: false },
  ];
  check(availableTestVersions(s, a, v).map((t) => t.version).join() === '1,2', 'Form offers unexpired ordinary versions');
  submitSolution(s, a.id, 1, 'https://example.org/first');
  check(availableTestVersions(s, a, v).map((t) => t.version).join() === '2', 'Another version remains available after submission');
  submitSolution(s, a.id, 2, 'https://example.org/second-version');
  check(a.submissions.length === 2 && a.submissions[0].testVersion !== a.submissions[1].testVersion, 'Solutions for distinct versions are retained');
  a.attempts.push({ ...a.attempts[0], number: 2 });
  check(availableTestVersions(s, a, v).map((t) => t.version).join() === '1,2', 'New attempt may submit a previously used ordinary version');
  submitSolution(s, a.id, 1, 'https://example.org/new-attempt');
  check(a.submissions.slice(-1)[0].attempt === 2, 'Same test version binds to new attempt');
  v.tasks.push({ version: 4, description: 'Critical', deadline: instant(day(3)), critical: true });
  check(availableTestVersions(s, a, v).map((t) => t.version).join() === '4', 'Critical update removes all older versions from selection');
}
{
  const { a, v } = fixture();
  v.versions[0] = { ...v.versions[0], title: 'Python developer v1', description: 'Same description', requirements: 'Python and PostgreSQL' };
  v.versions.push({ ...v.versions[0], number: 2, title: 'Java developer v2', requirements: 'Java and Spring' });
  v.title = 'Java developer v2';
  v.requirements = 'Java and Spring';
  a.attempts[0].status = 'reset';
  check(entryRole(a, v) === 'Python developer v1', 'Application title uses attempt conditions even after vacancy update');
  a.attempts.push({ ...a.attempts[0], number: 2, version: 2, status: 'pending', letter: 'Second letter' });
  const before = JSON.stringify(a);
  const html = renderToStaticMarkup(createElement(AttemptHistory, { entry: a, vacancy: v }));
  for (const value of ['Python developer v1', 'Python and PostgreSQL', 'Java developer v2', 'Java and Spring', a.attempts[0].letter, 'Second letter']) {
    check(html.includes(value), 'Candidate history renders exact saved field: ' + value);
  }
  check(html.split('Same description').length === 3, 'Both attempts render their identical descriptions with distinct titles/requirements');
  check(JSON.stringify(a) === before, 'Rendering history does not change past attempts');
  check(entryRole(a, v) === 'Java developer v2', 'New attempt shows its own role');
  const missing = renderToStaticMarkup(createElement(AttemptHistory, { entry: a, vacancy: { ...v, versions: [] } }));
  check(missing.includes('Исторические условия не сохранены') && !missing.includes('Java developer v2'), 'Missing history is explicit and never replaced by current conditions');
  const general = renderToStaticMarkup(createElement(AttemptHistory, { entry: { ...a, vacancy: null } }));
  check(general.includes('без привязки к вакансии') && !general.includes('условия v'), 'General application does not invent a vacancy version');
}
{
  const { s, a, v } = fixture();
  const other: Entry = {
    ...structuredClone(a),
    id: uid(),
    vacancy: null,
    status: "withdrawn",
  };
  other.attempts[0].status = "withdrawn";
  s.entries.push(other);
  createOffer(s, a.id, "", day(2));
  decide(s, s.offers.slice(-1)[0]!.id, "accept");
  check(
    other.status === "already_joined",
    "Competing application gets explicit final outcome",
  );
  check(capacity(s, v).occupied === 1, "Occupied seats count by vacancy ID");
  const sameTitle = { ...v, id: "another-vacancy" };
  check(
    capacity(s, sameTitle).occupied === 0,
    "Same title does not share seats",
  );
  rejects(
    () => deleteProject(s, a.project),
    "Cannot delete project with interaction history",
  );
}
{
  const { s, a } = fixture();
  createOffer(s, a.id, "", day(2));
  const o = s.offers.slice(-1)[0]!;
  o.deadline = "2000-01-01T00:00:00Z";
  s.recruiters[0].deadline = o.deadline;
  expire(s);
  check(
    o.status === "expired" && a.status === "reviewing",
    "Expiry frees offer and resumes review",
  );
  check(s.recruiters[0].status === "expired", "Recruiter invitation expires");
  const p = s.projects.find(
    (p) =>
      !s.entries.some((a) => a.project === p.id) &&
      !s.members.some((m) => m.project === p.id) &&
      !s.recruiters.some((g) => g.project === p.id),
  )!;
  deleteProject(s, p.id);
  check(!s.projects.some((x) => x.id === p.id), "Empty project can be deleted");
}
{
  const { s, a } = fixture();
  const raw = s as unknown as {
    entries: Record<string, unknown>[];
    offers: Record<string, unknown>[];
    members: Record<string, unknown>[];
    recruiters: Record<string, unknown>[];
  };
  delete raw.entries[0].submissions;
  raw.entries[0].solution = "https://example.org/legacy";
  raw.entries[0].testVersion = 1;
  raw.entries[0].testStatus = "reviewed";
  delete raw.offers[0].attempt;
  delete raw.members[0].vacancy;
  delete raw.recruiters[0].deadline;
  normalize(s);
  check(
    a.submissions[0].solution === "https://example.org/legacy" &&
      a.submissions[0].attempt === null,
    "Legacy solution preserved without invented binding",
  );
  check(
    s.members[0].originUnknown,
    "Unknown legacy membership not silently assigned",
  );
  check(s.recruiters[0].deadline === "", "Legacy expiry not invented");
  const before = JSON.stringify(s);
  normalize(s);
  check(JSON.stringify(s) === before, "Data upgrade is idempotent");
  createOffer(s, a.id, "", day(2));
  s.offers.slice(-1)[0]!.attempt = null;
  decide(s, s.offers.slice(-1)[0]!.id, "revoke");
  check(
    a.status === "reviewing",
    "Ambiguous legacy offer can still be revoked",
  );
}
console.log(`${checks} prototype invariant checks passed (isolated memory).`);
