/**
 * "Done means" explains itself BEFORE the student touches it.
 *
 * ── THE DEFECT THESE TESTS PIN ───────────────────────────────────────────────
 *
 * The acceptance criteria render as real, enabled, unchecked checkboxes. A
 * student can click them, and clicking does nothing for credit: the handler
 * writes `te_ws_acc_<project>_<story>` to localStorage and sends no request at
 * all, while the counter beside the heading counts CONFIRMED criteria, which
 * only the platform can grant by reading the repo. So the boxes tick and the
 * count does not move.
 *
 * The one sentence that explained this was gated on `selfTickedCount > 0` — it
 * appeared only AFTER the student had already ticked something. A student
 * looking at three bare clickable boxes got no warning whatsoever. Million
 * Abate went four support rounds on exactly this, and the cohort is largely
 * non-technical, so "experiment and infer" is not a route any of them will
 * take.
 *
 * The fix is not more words after the fact. It is that the panel states what
 * the boxes ARE, above the first row, unconditionally — and that the control
 * stops dressing itself as a completion control.
 *
 * ── WHAT EACH TEST WOULD CATCH IF IT REGRESSED ───────────────────────────────
 *
 *   1-3  the explanation exists, sits ahead of the first box, and does not wait
 *        for a tick — the exact regression that shipped.
 *   4    the counter names WHO confirms, so "0 of 3" cannot read as a scoreboard
 *        the student's own ticks should have moved.
 *   5-6  the pull-only student is sent to the button that builds their file,
 *        and the push student is not sent to a button that is not on their page.
 *   7    the page actually wires the repo's write access through — a correct
 *        component reached with the wrong prop helps nobody.
 *   8    a self-tick is never struck through. Strike-through is the universal
 *        "done" mark, and the whole point is that a note is not a completion.
 *
 * Uses the `createRoot` + `act` pattern proven in
 * ProjectWorkspacePage.repoBeforePrompt.test.tsx — there is no
 * `@testing-library/*` in this package and adding one for a test would be a
 * drive-by install.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { StudentProject, ProjectTask } from '../projectsStore';

let mockProject: StudentProject | null = null;
let mockWriteAccess: 'push' | 'pull_only' | null = 'pull_only';
// The repo's CONNECTION state, separate from its write access: a project with
// no repo reports `write_access: null`, which is also what a connected repo
// reports before the permission check has run, so the two cannot be told apart
// from write access alone. That conflation is the defect the last block pins.
let mockConnectState = 'connected';

jest.mock('react-router-dom', () => ({
  __esModule: true,
  useParams: () => ({ projectId: 'p1', taskId: 'STORY-000' }),
  useNavigate: () => () => { /* the page never navigates in these tests */ },
  useLocation: () => ({ state: null }),
}));
jest.mock('../projectSync', () => ({
  __esModule: true,
  refreshProjectsFromBackend: () => Promise.resolve(),
  syncProjectsWithBackend: () => Promise.resolve(),
}));
// Plain functions, not jest.fn(): CRA sets `resetMocks: true`, which strips the
// implementation off every jest.fn before each test and would leave these
// returning undefined where the page expects a promise.
jest.mock('../../../../utils/portalApi', () => ({
  __esModule: true,
  default: { post: () => Promise.resolve({ data: { reply: 'ok' } }) },
}));
jest.mock('../../../../services/workspaceRepoApi', () => ({
  __esModule: true,
  getWorkspaceRepo: () => Promise.resolve({
    connected: true,
    provisioned: true,
    repo_url: 'https://github.com/stu/build',
    repo_owner: 'stu',
    repo_name: 'build',
    student_github_login: 'stu',
    file_count: 12,
    last_sync: null,
    recent_commits: [],
    connect: {
      state: mockConnectState,
      method: 'byo',
      owner: 'stu',
      repo: 'build',
      url: 'https://github.com/stu/build',
      private: false,
      default_branch: 'main',
      challenge: null,
      adopt_commands: null,
      write_access: mockWriteAccess,
      access: { ok: true, error_class: null, checked_at: null },
      connected_at: null,
    },
  }),
  provisionWorkspaceRepo: () => Promise.resolve(null),
  syncWorkspaceRepo: () => Promise.resolve(null),
  startRepoConnect: () => Promise.resolve(null),
  confirmRepoConnect: () => Promise.resolve(null),
  downloadDocsBundle: () => Promise.resolve({ blob: new Blob(), filename: 'x.zip' }),
  downloadProgressFile: () => Promise.resolve({ blob: new Blob(), filename: 'progress.json', existing: 'merged' }),
  connectErrorOf: (_e: unknown, fallback: string) => ({ error: fallback, error_class: null }),
  getStoryVerification: () => Promise.reject(new Error('404')),
  getWebhookSetup: () => Promise.reject(new Error('not configured')),
}));
jest.mock('../projectsStore', () => ({
  ...jest.requireActual('../projectsStore'),
  getProject: () => mockProject,
}));

import AcceptanceChecklist from '../AcceptanceChecklist';
import ProjectWorkspacePage from '../ProjectWorkspacePage';
import { runtimeCss } from '../../runtime/runtimeKit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout, so the mentor rail's auto-scroll would throw.
(Element.prototype as any).scrollIntoView = () => { /* no layout in jsdom */ };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  mockWriteAccess = 'pull_only';
  mockConnectState = 'connected';
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  document.body.removeChild(container);
});

const CRITERIA = [
  'The Command Center renders',
  'It reads your plan',
  'It shows how far along you are',
];

const text = () => container.textContent || '';
const firstBox = (): HTMLInputElement => {
  const box = container.querySelector('.rt-acc input[type="checkbox"]');
  if (!box) throw new Error('the checklist rendered no checkboxes');
  return box as HTMLInputElement;
};

/**
 * The standing explanation, found by ROLE IN THE MARKUP rather than by its
 * sentences, so the assertions below measure placement and presence without
 * pinning the exact wording of copy that will be edited again.
 */
const explanation = (): HTMLElement => {
  const el = container.querySelector('.rt-acc-note');
  if (!el) throw new Error('the checklist rendered no standing explanation (.rt-acc-note)');
  return el as HTMLElement;
};

async function mountChecklist(opts: {
  ticked?: Record<string, boolean>;
  confirmed?: string[];
  writeAccess?: 'push' | 'pull_only' | null;
  /** Omitted, the component's own default applies — which is "connected". */
  repoConnected?: boolean;
} = {}) {
  const confirmed = new Set(opts.confirmed ?? []);
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AcceptanceChecklist
        acceptance={CRITERIA}
        stepNo={1}
        isConfirmed={(t) => confirmed.has(t)}
        isJustConfirmed={() => false}
        ticked={opts.ticked ?? {}}
        onToggle={() => { /* the store write is not what these tests are about */ }}
        writeAccess={opts.writeAccess ?? null}
        repoConnected={opts.repoConnected}
      />,
    );
  });
}

/**
 * Mount the real page, so a test can prove the prop is actually WIRED and not
 * merely honoured by a component reached directly. Shared by the two wiring
 * tests below rather than pasted twice — the fixture is long enough that a
 * second copy would drift.
 */
async function mountPage() {
  mockProject = {
    id: 'p1',
    name: 'SupplyMind AI',
    slug: 'supplymind',
    descriptor: '',
    accent: '#367895',
    cover: '',
    icon: 'M0 0h1',
    status: 'ready',
    createdAt: 1,
    stage: 'Release 1',
    curStep: 3,
    size: 'project',
    idea: '',
    reqs: [],
    lists: [{
      id: 'L1',
      step: 2,
      name: 'Release 1',
      sub: '',
      tasks: [{
        id: 'p1-STORY-000',
        storyId: 'STORY-000',
        title: 'STORY-000 · Build your Command Center',
        what: 'One page that shows what you are building.',
        req: null as unknown as string,
        prompt: 'Step 1 — let the platform see your pushes',
        state: 'todo',
        due: 'today',
        acceptance: CRITERIA,
      } as ProjectTask],
    }],
    activity: [],
    preview: {
      toolName: 'x', summary: '', tools: [], dataSources: [], guardrails: [],
    },
  } as unknown as StudentProject;

  await act(async () => { root = createRoot(container); root.render(<ProjectWorkspacePage />); });
}

describe('the acceptance panel explains itself before it is used', () => {
  it('shows the explanation with nothing ticked at all', async () => {
    // The reported defect, stated directly: a student who has just arrived and
    // touched nothing must already know what the boxes are.
    await mountChecklist();

    expect(container.querySelector('.rt-acc-note')).toBeTruthy();
  });

  it('puts the explanation AHEAD of the first checkbox', async () => {
    // Presence is not enough. An explanation below three checkboxes is read
    // after the student has already clicked one, which is the order that
    // failed. Asserted on the position bitmask rather than on index arithmetic
    // so it does not depend on how many wrappers each half happens to use.
    await mountChecklist();

    // eslint-disable-next-line no-bitwise
    const boxIsAfterNote = Boolean(
      explanation().compareDocumentPosition(firstBox()) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(boxIsAfterNote).toBe(true);
  });

  it('says the same thing whether or not the student has ticked anything', async () => {
    // The regression was a conditional. Same panel, one tick apart, must carry
    // the same explanation.
    await mountChecklist();
    const untouched = explanation().textContent;

    act(() => { root.unmount(); });
    await mountChecklist({ ticked: { 0: true } });

    expect(explanation().textContent).toBe(untouched);
  });

  it('names who does the confirming in the count', async () => {
    // "0 of 3 confirmed" beside three boxes the student has just ticked reads
    // as a scoreboard that is broken. The count has to say where the number
    // comes from.
    await mountChecklist({ ticked: { 0: true, 1: true, 2: true } });

    expect(container.querySelector('.rt-step-c')?.textContent)
      .toBe('0 of 3 confirmed from your repo');
  });
});

describe('the instruction matches the access the platform actually has', () => {
  it('sends a pull-only student to the button that builds their progress file', async () => {
    // On a pull-only repo the platform never seeded .colaberry/progress.json,
    // so "tick it in your progress file" points at a file that may not exist —
    // or, worse, at one built by hand from a story document, which can confirm
    // STORY-000 and nothing else. "Get my progress.json" is the fix, and it is
    // on this same page.
    await mountChecklist({ writeAccess: 'pull_only' });

    expect(explanation().textContent).toContain('Get my progress.json');
  });

  it('does not send a push student to a button their page does not show', async () => {
    // WorkspaceRepoPanel renders that button in its pull_only branch only.
    // Naming it to a student with write access points at nothing.
    await mountChecklist({ writeAccess: 'push' });

    expect(explanation().textContent).not.toContain('Get my progress.json');
    expect(explanation().textContent).toContain('.colaberry/progress.json');
  });

  it('wires the repo\'s write access through from the workspace page', async () => {
    // A correct component reached with the wrong prop helps nobody.
    await mountPage();

    expect(explanation().textContent).toContain('Get my progress.json');
    // And the panel is still the acceptance panel, not something else that
    // happens to carry the class.
    expect(text()).toContain('Done means');
  });
});

/**
 * ── A STUDENT WITH NO REPO IS NOT SENT TO EDIT A FILE THEY DO NOT HAVE ──────
 *
 * Both branches above assume a repo exists; they differ only on whether the
 * platform can write to it. A project with NO repo connected fell into the
 * `push` branch, because `write_access` is null there — the same null a
 * connected repo reports before its permission check has run. So the panel
 * told a student with nothing connected to "open `.colaberry/progress.json`
 * in your repo, change that line ... commit and push", naming four things
 * they do not have.
 *
 * It is the same failure as STORY-000's Step 1 pointing at a panel the page
 * had not drawn yet: an instruction is only honest if what it names is on the
 * screen. The only true next step with no repo is connecting one.
 */
describe('a student with no repo is told to connect one, not to edit a file', () => {
  it('names the connect panel and no progress file', async () => {
    await mountChecklist({ repoConnected: false });

    const note = explanation().textContent || '';
    expect(note).toContain('Connect your project folder');
    // The heading above is the one WorkspaceRepoPanel actually renders in its
    // not-connected branch. Naming any other control would re-commit the
    // original mistake in a new place.
    expect(note).not.toContain('.colaberry/progress.json');
    expect(note).not.toContain('Get my progress.json');
  });

  it('still says plainly that nothing here can be confirmed yet', async () => {
    // The student should learn WHY the counter will not move, not just what
    // to press. "0 of 3 confirmed" beside a silent panel is the trap this
    // whole file exists to close.
    await mountChecklist({ repoConnected: false });

    expect(explanation().textContent).toContain('no repo connected');
  });

  it('leaves the connected wording alone', async () => {
    // The floor under this change: a connected student must see exactly what
    // they saw before, or the fix has cost more than it bought.
    await mountChecklist({ repoConnected: true, writeAccess: 'push' });

    expect(explanation().textContent).toContain('.colaberry/progress.json');
    expect(explanation().textContent).not.toContain('Connect your project folder');
  });

  it('defaults to the connected wording when the prop is not passed', async () => {
    // Every caller that has not been updated keeps today's behaviour. The
    // failure mode of this flag must be telling a connected student something
    // they know, never the reverse.
    await mountChecklist({ writeAccess: 'push' });

    expect(explanation().textContent).toContain('.colaberry/progress.json');
  });

  it('wires the CONNECTION STATE through from the workspace page', async () => {
    // The wiring test that matters most here: `write_access` stays null in
    // this fixture, exactly as it is for a real unconnected project, so a page
    // still reading write access alone would render the push wording and fail
    // this test. Only reading `connect.state` passes it.
    mockConnectState = 'not_connected';
    mockWriteAccess = null;

    await mountPage();

    expect(explanation().textContent).toContain('Connect your project folder');
    expect(explanation().textContent).not.toContain('.colaberry/progress.json');
  });
});

describe('a note is never dressed as a completion', () => {
  /**
   * Asserted against the STYLESHEET SOURCE rather than a computed style.
   *
   * `runtimeCss` is a plain exported string injected as a <style> tag, and
   * jsdom does not resolve the cascade for a shorthand like `text-decoration`
   * with any reliability — a getComputedStyle assertion here would pass or fail
   * for reasons unrelated to the rule. The rule text is the thing that decides
   * this on a real browser, so the rule text is what gets pinned.
   *
   * What was wrong: `.rt-acc input:checked+span` set `line-through` at
   * specificity (0,2,2), and the self-tick's own `.rt-acc-self>label>span`
   * reset at (0,1,2) lost to it. So a student's private note rendered struck
   * through — the universal "done" mark — while the file's own header comment
   * promised it would be drawn quieter than an untouched row, not louder.
   */
  it('does not strike through every checked criterion, only confirmed ones', () => {
    // Reduced to the SELECTORS that strike an acceptance row through, so a
    // failure reads as one short list rather than dumping the whole sheet.
    const strikers = runtimeCss
      // Comments first: this sheet documents its own rules by name, so a note
      // ABOUT the strike-through would otherwise be counted as one.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .filter((rule) => rule.includes('rt-acc') && rule.includes('line-through'))
      .map((rule) => rule.split('{')[0].trim());

    expect(strikers).toEqual(['.rt-acc-ok input:checked+span']);
  });
});
