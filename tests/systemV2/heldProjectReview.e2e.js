/**
 * heldProjectReview.e2e.js — a build HELD for review must be reviewable.
 *
 * THE FAILURE THIS GUARDS, observed on production 2026-10-01. A project built through
 * an admin door is held at `drafted` so the student cannot see an unreviewed plan. Tasks
 * are written by materialisation, materialisation runs at publish, and the hold is
 * precisely the decision not to publish yet — so the admin board, which reads
 * `student_tasks`, showed `0/0 tasks, no releases` for a project whose plan held 30
 * requirements, 5 releases and 19 stories. The reviewer had to assign a project in order
 * to see whether they wanted to assign it.
 *
 * `getProjectGantt` now falls back to the newest plan when nothing is materialised. Unit
 * tests cover that in isolation; this proves it through the REAL request path — admin
 * auth, route, service, database — against a live server.
 *
 * WHY IT RUNS INSIDE THE BACKEND CONTAINER, unlike the browser e2e scripts beside it.
 * The condition under test is "a plan exists and no tasks do", and on a healthy system
 * that state is transient: the only way to reach it through HTTP is a real LLM build,
 * which costs minutes, money and determinism. So the fixture is seeded directly and
 * removed again, which needs the database and the server's own JWT secret — both of
 * which live in the container and neither of which should leave it.
 *
 * IT CREATES AND DELETES A PROJECT. Everything it writes is prefixed `[e2e]` and removed
 * in a `finally`, including on failure. It REFUSES to attach its fixture to a real
 * student's account: the owner must look like a test identity, or the run aborts
 * without writing anything. A fixture left on a student's Projects page would be a worse
 * outcome than no test.
 *
 * Usage, from the repo root:
 *   docker cp tests/systemV2/heldProjectReview.e2e.js accelerator-backend:/tmp/
 *   docker exec accelerator-backend node /tmp/heldProjectReview.e2e.js
 *
 * Exit 0 = all checks pass · 1 = a check failed · 2 = could not set up safely.
 */
const crypto = require('crypto');
const jwt = require('/app/node_modules/jsonwebtoken');

const PORT = process.env.PORT || '3001';
const BASE = `http://127.0.0.1:${PORT}`;

/** Owners this fixture may be attached to. Anyone else is somebody's real work. */
const TEST_OWNER = /(^ali@colaberry\.com$)|(\+e2e)|(test)|(colaberry-test\.local$)/i;

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); failures += 1; }
};

/** Two releases, three stories, two requirements. Small enough to assert exactly. */
const PLAN = {
  project_name: '[e2e] Held Plan Fixture',
  descriptor: 'A fixture, not a real build',
  requirements: [
    { id: 'REQ-001', statement: 'Every specimen must have a chain of custody record.' },
    { id: 'REQ-002', statement: 'Audit records must be retained for seven years.' },
  ],
  releases: [
    { key: 'r0', name: 'Walking Skeleton', goal: 'Proves the trust spine.', week_start: 1, week_end: 2 },
    { key: 'r1', name: 'Interfaces', goal: 'The people who touch it daily.', week_start: 3, week_end: 4 },
  ],
  stories: [
    { id: 'STORY-001', release: 'r0', title: 'Record chain of custody', narrative: 'As a dispatcher…', fulfills: ['REQ-001'], acceptance: ['Given a handover, when it happens, then it is recorded.'] },
    { id: 'STORY-002', release: 'r0', title: 'Retain the audit log', narrative: 'As a supervisor…', fulfills: ['REQ-002'], acceptance: ['Given a change, when it lands, then it is kept.'] },
    { id: 'STORY-003', release: 'r1', title: 'Driver views route', narrative: 'As a driver…', fulfills: [], acceptance: [] },
  ],
};

async function get(path, token) {
  const res = await fetch(`${BASE}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON is itself the finding */ }
  return { status: res.status, body };
}

(async () => {
  const { sequelize } = require('/app/dist/config/database');
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[e2e] JWT_SECRET is not set in this container. Aborting without writing anything.');
    process.exit(2);
  }

  // Borrow identity from an existing project so enrollment_id and program_id are a
  // matched, valid pair — inventing either would test the fixture, not the product.
  const [owners] = await sequelize.query(
    `SELECT p.enrollment_id, p.program_id, e.email
       FROM projects p JOIN enrollments e ON e.id = p.enrollment_id
      WHERE p.program_id IS NOT NULL
      ORDER BY p.created_at DESC`,
  );
  const owner = owners.find((o) => TEST_OWNER.test(String(o.email || '')));
  if (!owner) {
    console.error('[e2e] No test-owned project to borrow an enrollment from. REFUSING to attach a');
    console.error('      fixture to a real student. Nothing was written.');
    process.exit(2);
  }
  console.log(`[e2e] Held-plan review, against ${BASE}`);
  console.log(`[e2e] fixture owner: ${owner.email}`);

  const token = jwt.sign({ sub: 'e2e-admin', email: 'e2e-admin@colaberry-test.local', role: 'admin' }, secret, { expiresIn: '10m' });
  let projectId = null;

  try {
    const [created] = await sequelize.query(
      `INSERT INTO projects (id, enrollment_id, program_id, name, project_stage, project_variables, created_at, updated_at)
       VALUES (gen_random_uuid(), :enr, :prog, '[e2e] Held Plan Fixture', 'discovery', '{}'::jsonb, NOW(), NOW())
       RETURNING id`,
      { replacements: { enr: owner.enrollment_id, prog: owner.program_id } },
    );
    projectId = created[0].id;

    await sequelize.query(
      `INSERT INTO build_plans (project_id, version, status, plan_json, plan_sha256, gate_ok, created_at, updated_at)
       VALUES (:p, 1, 'draft', CAST(:plan AS JSONB), :sha, TRUE, NOW(), NOW())`,
      {
        replacements: {
          p: projectId,
          plan: JSON.stringify(PLAN),
          sha: crypto.createHash('sha256').update(JSON.stringify(PLAN)).digest('hex'),
        },
      },
    );
    console.log(`[e2e] seeded held project ${String(projectId).slice(0, 8)} — plan, no tasks\n`);

    // ── 1. The route is still guarded ────────────────────────────────────────
    const anon = await get(`/api/admin/projects/${projectId}/gantt`);
    check('unauthenticated read is refused', anon.status === 401, `got ${anon.status}`);

    // ── 2. The held plan is visible and drillable ────────────────────────────
    const held = await get(`/api/admin/projects/${projectId}/gantt`, token);
    check('authenticated read succeeds', held.status === 200, `got ${held.status}`);
    const h = held.body || {};
    check('reports plan_only, so the page can say "not assigned yet"', h.plan_only === true, `got ${h.plan_only}`);
    check('renders both releases from the plan', (h.releases || []).length === 2, `got ${(h.releases || []).length}`);

    const stories = (h.releases || []).flatMap((r) => r.tasks || []);
    check('renders all three stories', stories.length === 3, `got ${stories.length}`);
    check('counts them in totals', h.totals && h.totals.tasks === 3, `got ${h.totals && h.totals.tasks}`);

    // The reviewer's actual job: reading a story against the requirement it claims to
    // fulfil. Without these the drill-down is a list of titles.
    const s1 = stories.find((t) => t.id === 'STORY-001');
    check('story carries its requirement ids', !!s1 && JSON.stringify(s1.fulfills) === '["REQ-001"]', JSON.stringify(s1 && s1.fulfills));
    check('story carries its acceptance criteria', !!s1 && (s1.acceptance || []).length === 1);
    check('requirement ids resolve to statements', (h.requirements || {})['REQ-002'] === 'Audit records must be retained for seven years.');

    // A held plan is unscheduled. Inventing a due date would be worse than showing none.
    check('claims no due dates it does not have', stories.every((t) => t.due_on === null));
    check('nothing reads as overdue or slipped', stories.every((t) => !t.overdue && !t.slipped));
    check('nothing reads as complete', h.totals && h.totals.complete === 0, `got ${h.totals && h.totals.complete}`);

    // ── 3. Materialised work takes precedence once it exists ─────────────────
    // A task belongs to a list — `task_list_id` is NOT NULL — so materialisation always
    // writes the list first. The fixture has to do the same or it is not the real shape.
    const [list] = await sequelize.query(
      `INSERT INTO student_task_lists (id, project_id, enrollment_id, cluster, title, status, created_at, updated_at)
       VALUES (gen_random_uuid(), :p, :enr, 'r0', '[e2e] Walking Skeleton', 'not_started', NOW(), NOW())
       RETURNING id`,
      { replacements: { p: projectId, enr: owner.enrollment_id } },
    );
    await sequelize.query(
      `INSERT INTO student_tasks (id, project_id, task_list_id, story_id, title, status, release_key, position, created_at, updated_at)
       VALUES (gen_random_uuid(), :p, :list, 'STORY-000', '[e2e] materialised task', 'not_started', 'r0', 0, NOW(), NOW())`,
      { replacements: { p: projectId, list: list[0].id } },
    );
    const live = await get(`/api/admin/projects/${projectId}/gantt`, token);
    const l = live.body || {};
    check('plan_only flips to false once a task exists', l.plan_only === false, `got ${l.plan_only}`);
    check('the materialised task wins over the plan', (l.releases || []).flatMap((r) => r.tasks || []).length === 1);
    check('requirement statements survive the switch', (l.requirements || {})['REQ-001'] !== undefined);
  } catch (err) {
    console.error(`  ✗ threw: ${err && err.message}`);
    failures += 1;
  } finally {
    if (projectId) {
      // build_plans is ON DELETE NO ACTION and blocks the project delete; tasks CASCADE.
      await sequelize.query('DELETE FROM student_tasks WHERE project_id = :p', { replacements: { p: projectId } }).catch(() => {});
      await sequelize.query('DELETE FROM student_task_lists WHERE project_id = :p', { replacements: { p: projectId } }).catch(() => {});
      await sequelize.query('DELETE FROM build_plans WHERE project_id = :p', { replacements: { p: projectId } }).catch(() => {});
      await sequelize.query('DELETE FROM projects WHERE id = :p', { replacements: { p: projectId } }).catch(() => {});
      const [left] = await sequelize.query('SELECT count(*)::int n FROM projects WHERE id = :p', { replacements: { p: projectId } });
      console.log(`\n[e2e] cleaned up fixture ${String(projectId).slice(0, 8)} — rows remaining: ${left[0].n}`);
      if (left[0].n !== 0) { console.error('[e2e] FIXTURE NOT REMOVED — delete it by hand.'); failures += 1; }
    }
  }

  console.log(failures === 0 ? '\n[e2e] PASS' : `\n[e2e] FAIL (${failures} failed check(s))`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('[e2e] FAILED', e && e.message); process.exit(1); });
