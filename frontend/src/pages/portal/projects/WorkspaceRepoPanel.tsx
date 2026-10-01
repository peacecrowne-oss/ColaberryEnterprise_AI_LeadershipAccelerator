import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  WorkspaceRepoView, ConnectStateView, ConnectApiError, connectErrorOf,
  startRepoConnect, confirmRepoConnect, provisionWorkspaceRepo,
  syncWorkspaceRepo, downloadDocsBundle, downloadProgressFile,
} from '../../../services/workspaceRepoApi';
import WebhookSetupBlock from './WebhookSetupBlock';

/**
 * WorkspaceRepoPanel — the step that connects a student's EXISTING folder to
 * the platform.
 *
 * ## The copy assumes they already started
 *
 * On day one of class students set up a local folder with their own CLAUDE.md.
 * They are already working in it. This panel used to offer one thing — "give me
 * your GitHub username and I'll create you a repo" — which hands a student a
 * SECOND home for one project and leaves them to reconcile the two. Every
 * sentence here is written for someone with a folder open in another window.
 * Nothing says "start", "new project", or "clone".
 *
 * ## Two doors, in order of how many students need them
 *
 * **Connect the repo you already have** leads, because student build repos are
 * student-owned (decision, 2026-08-14): the platform holds a pointer and the
 * record of what was finished, never the code. **Have one created** is folded
 * away underneath, for a student whose folder is not on GitHub yet — and even
 * that path adopts their existing folder rather than starting a new one.
 *
 * A download is offered third, so someone with no GitHub account at all can
 * still get the documents their prompts reference today. It states plainly that
 * verification and points need a connected repo, because they do.
 */

type Props = {
  projectId: string;
  repo: WorkspaceRepoView | null;
  onRepoChange: (view: WorkspaceRepoView) => void;
  onConnectChange: (connect: ConnectStateView) => void;
};

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  margin: 0,
};

/** A copyable block of shell. The commands are the deliverable, so Copy is loud. */
const CommandBlock: React.FC<{ label: string; commands: string[] }> = ({ label, commands }) => {
  const [copied, setCopied] = useState(false);
  const text = commands.join('\n');
  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div style={{ marginTop: 10 }}>
      <div className="rt-prompt-h">
        <div className="rt-lab" style={{ margin: 0 }}>{label}</div>
        <button className={`rt-btn${copied ? ' pri' : ''}`} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre className="rt-in" style={mono}>{text}</pre>
    </div>
  );
};

/**
 * Hand a fetched blob to the browser as a download.
 *
 * Shared by the two download buttons rather than written twice: the revoke
 * timing below is the sort of detail that gets copied once, fixed once, and
 * then silently diverges. Revoked on the next tick because revoking
 * synchronously can beat the download in some browsers and produce an empty
 * file — which for the progress file would look exactly like the platform
 * handing a stuck student an empty answer.
 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ErrorNote: React.FC<{ err: ConnectApiError; onConfirmReplace?: () => void }> = ({ err, onConfirmReplace }) => (
  <div style={{ marginTop: 10 }}>
    <p style={{ color: 'var(--cherry, #E5121D)', margin: 0 }}>{err.error}</p>
    {err.error_class === 'RepoRebindRefused' && onConfirmReplace && (
      <button className="rt-btn" style={{ marginTop: 8 }} onClick={onConfirmReplace}>
        Move this build to the new repo anyway
      </button>
    )}
  </div>
);

/**
 * Where this repo is up to, from the workspace view the page already holds.
 *
 * Exported because the acceptance checklist needs the same answer to decide
 * whether "open `.colaberry/progress.json` in your repo" is an instruction a
 * student can actually follow. Two copies of this expression would be two
 * chances for the checklist to promise a file while the panel below it is
 * still offering to connect the repo that would contain it — so there is one,
 * and both read it. `connect.state` wins when present; `repo.connected` is the
 * fallback for a view fetched before the connect state existed; and no repo at
 * all is `not_connected`, which is also what an unloaded page reports, matching
 * the panel's own render.
 */
export function repoConnectionState(repo: WorkspaceRepoView | null | undefined): string {
  return repo?.connect?.state ?? (repo?.connected ? 'connected' : 'not_connected');
}

const WorkspaceRepoPanel: React.FC<Props> = ({ projectId, repo, onRepoChange, onConnectChange }) => {
  const connect = repo?.connect ?? null;
  const state = repoConnectionState(repo);

  const [refInput, setRefInput] = useState('');
  const refTouched = useRef(false);

  /**
   * Seed the box with the repo already on the row. This is what makes an expired
   * challenge a one-click recovery: the backend degrades `awaiting_proof` to
   * `not_connected` once the token dies but KEEPS the repo, so the student lands
   * here with their own address already filled in rather than retyping it.
   *
   * Seeded from an effect rather than `useState(url)` because the parent loads
   * the repo asynchronously — on first render there is no url to seed from. It
   * runs once and never fights the student for the field afterwards.
   */
  useEffect(() => {
    if (refTouched.current || !connect?.url || state === 'connected') return;
    setRefInput(connect.url);
  }, [connect?.url, state]);

  const editRef = useCallback((value: string) => { refTouched.current = true; setRefInput(value); }, []);
  const [ghLogin, setGhLogin] = useState('');
  const [showFallback, setShowFallback] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<ConnectApiError | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = useCallback(async (
    tag: string, fallbackMessage: string, fn: () => Promise<void>,
  ) => {
    setErr(null); setNote(null); setBusy(tag);
    try {
      await fn();
    } catch (e: any) {
      setErr(connectErrorOf(e, fallbackMessage));
    } finally {
      setBusy('');
    }
  }, []);

  const doStart = useCallback((confirmReplace = false) => run(
    'connect', 'Could not connect that repo. Check the address and try again.',
    async () => onConnectChange(await startRepoConnect(projectId, refInput.trim(), confirmReplace)),
  ), [run, projectId, refInput, onConnectChange]);

  const doConfirm = useCallback(() => run(
    'confirm', 'Could not check your repo just now. Try again in a moment.',
    async () => onConnectChange(await confirmRepoConnect(projectId)),
  ), [run, projectId, onConnectChange]);

  const doProvision = useCallback(() => run(
    'provision', 'Could not create a repo. Check the username and try again.',
    async () => onConnectChange(await provisionWorkspaceRepo(projectId, ghLogin.trim())),
  ), [run, projectId, ghLogin, onConnectChange]);

  const doSync = useCallback(() => run(
    'sync', 'Sync failed. Make sure you have pushed your work.',
    async () => onRepoChange(await syncWorkspaceRepo(projectId)),
  ), [run, projectId, onRepoChange]);

  const doDownload = useCallback(() => run(
    'download', 'Could not build your document bundle just now.',
    async () => {
      const { blob, filename } = await downloadDocsBundle(projectId);
      saveBlob(blob, filename);
      // The tail of this line is only true before a repo is connected. Said to
      // someone who has already connected one, it reads as a warning about a
      // problem they do not have.
      setNote(state === 'connected'
        ? `Downloaded ${filename}. Unzip it into your repo, keeping the paths as they are, then commit. `
          + 'It carries no .colaberry/progress.json, so it cannot overwrite your ticks.'
        : `Downloaded ${filename}. Unzip it into your project folder. Verification and points still need a connected repo.`);
    },
  ), [run, projectId, state]);

  /**
   * THE ONE ACTION THAT MAKES THE FILE REACHABLE.
   *
   * The backend renders every story's exact criteria, reads whatever is at
   * `.colaberry/progress.json` in this student's repo, merges their ticks and
   * their own custom keys across, and returns the result. So the instruction
   * afterwards is the simple, safe one — save it over your file — instead of
   * "open both files side by side and reconcile them", which is what pointing a
   * student at a blank seed actually asks of them.
   *
   * `existing` is read back so the ONE case where "your ticks are already in it"
   * would be false — a file that is present but does not parse, so nothing could
   * be carried across — is told the truth instead. Null means the header was not
   * exposed to us, and the copy falls back to what is true without it.
   */
  const doDownloadProgress = useCallback(() => run(
    'progress', 'Could not build your progress file just now.',
    async () => {
      const { blob, filename, existing } = await downloadProgressFile(projectId);
      saveBlob(blob, filename);
      setNote(existing === 'unreadable'
        ? `Downloaded ${filename}. IMPORTANT: the .colaberry/progress.json already in your repo could not be read, `
          + 'so nothing in it could be carried across and this file starts every criterion at false. '
          + 'Open your old file first and re-tick anything you had genuinely finished, then save this one over it and commit.'
        : `Downloaded ${filename}. Save it in your repo at .colaberry/progress.json, replacing the file that is there, `
          + 'then commit and push. Everything you had already ticked is in it.');
    },
  ), [run, projectId]);

  // ── connected ─────────────────────────────────────────────────────────────
  if (state === 'connected' && repo?.repo_owner) {
    const lostAccess = connect?.access && connect.access.ok === false;
    return (
      <div className="rt-card">
        <div className="rt-lab" style={{ marginTop: 0 }}>Your repo</div>
        <p style={{ margin: '8px 0' }}>
          <a href={repo.repo_url || '#'} target="_blank" rel="noreferrer">{repo.repo_owner}/{repo.repo_name}</a>
          {typeof repo.file_count === 'number' && <span className="rt-muted"> · {repo.file_count} files</span>}
          {connect?.method === 'byo' && <span className="rt-muted"> · yours</span>}
        </p>

        {lostAccess && (
          <p className="rt-muted" style={{ margin: '8px 0' }}>
            The platform cannot read this repo at the moment. If you renamed it, made it private, or removed
            the platform's access, reconnect it below. <strong>Everything you have already had verified stays
            exactly as it is</strong> — that record lives here, not in the repo.
          </p>
        )}

        {/* PULL-ONLY IS A CHOICE, AND ITS CONSEQUENCE IS THE STUDENT'S TO KNOW.
            The platform holds read access to this repo and nothing more, so it
            never installs the managed block or seeds `.colaberry/progress.json`.
            Left unsaid, that reads to a student as a working connection: they
            press Sync, nothing lands, their agent has no contract to copy, and
            it invents a file the platform cannot read. That is the whole of the
            2026-08-17 failure, and it was silent from end to end.

            Stated plainly here, with the one thing they have to do about it, and
            deliberately not styled as an error — verification, points and the
            whole build work exactly the same on a repo we only read.

            ── WHY THIS NOW OFFERS A BUTTON AND NOT A PATH ─────────────────────

            It used to say "Open STORY-000 and copy the JSON block under Step 3".
            That block is `progressFileExample()`, and it carries STORY-000's
            five criteria and NOTHING ELSE — it is an illustration of the file's
            shape, not the file. A student who followed that instruction exactly
            as written produced a `progress.json` that can confirm STORY-000 and
            can never confirm anything else, because every other story arrives
            with no `criteria` array for the verifier to match a tick against.
            The failure is silent: no error, no warning, just a story that never
            ticks however much they build. It was our instruction, followed
            correctly, that built the broken file.

            The first correction pointed at `.colaberry/progress.seed.json`
            instead. That was the same defect one layer down. `seedPathFor` is
            called in exactly one place — inside the docs zip — and reading all
            fifteen pull-only repos on 2026-08-21 found the seed in ZERO of them,
            with no evidence any of these students had ever extracted a bundle.
            Rewriting copy to name a second file they cannot reach would have
            been the third time we answered a delivery problem with wording.

            So the file is now BUILT ON REQUEST, by `/api/portal/workspace/
            progress-file`, and handed over at the path it belongs at. And it is
            merged server-side over whatever is already in their repo, which is
            what lets this copy say "replace your file" — the only instruction
            short enough to survive being skimmed. Several of these students hold
            real ticked criteria and one holds nine custom top-level keys her
            Command Center reads at runtime; asking a stuck non-technical reader
            to hand-reconcile two JSON documents was never going to work, and
            it is not what a fix should require. */}
        {connect?.write_access === 'pull_only' && (
          <div className="rt-muted" style={{ margin: '8px 0' }}>
            <p style={{ margin: '0 0 8px' }}>
              <strong>The platform has read-only access to this repo.</strong> Your verification and points are
              unaffected — it reads your commits and confirms your stories exactly as normal, and everything you
              earn is recorded here rather than in the repo.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              <strong>What it does cost you is your portfolio.</strong> The artifacts you build in Claude Code
              are saved here, but they cannot be written into your repo — so they never appear on your GitHub,
              which is the version an employer or client actually looks at. Granting write access syncs every
              artifact you have already built, not just future ones.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              To grant it: on GitHub, open your repo&rsquo;s <strong>Settings &rarr; Collaborators</strong>, add{' '}
              <code>ColaberryIntern</code>, and we accept the invitation automatically within the hour.
              GitHub invitations expire after 7 days, so if one has lapsed just send it again.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              Until then, the whole of <code>.colaberry/</code> is yours to place.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              <strong>Your progress file is the one that matters, and the button below builds it for you.</strong>
            </p>
            <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>
              <li>Press <strong>Get my progress.json</strong>.</li>
              <li>
                Save it in your repo at <strong><code>.colaberry/progress.json</code></strong>, replacing the
                file that is already there.
              </li>
              <li>Commit it and push.</li>
            </ol>
            {/* SITED HERE, NOT IN THE BUTTON ROW BELOW.
                The row below is the panel's general controls, and a student who
                has just read three paragraphs about their progress file should
                not then have to find the control among four others. The action
                sits against the sentence that asks for it, and it is the primary
                style because for this cohort it is the whole of the fix. */}
            <div style={{ margin: '0 0 10px' }}>
              <button className="rt-btn pri" disabled={busy === 'progress'} onClick={doDownloadProgress}>
                {busy === 'progress' ? 'Building…' : 'Get my progress.json'}
              </button>
            </div>
            <p style={{ margin: '0 0 8px' }}>
              <strong>It covers every story in your build — not just the first one — and it already contains
              your work.</strong> Under each story, every acceptance criterion is written out in the exact
              words the platform checks against. Before the file reaches you, the platform reads the{' '}
              <code>.colaberry/progress.json</code> that is in your repo right now and carries across
              everything you have already done: every criterion you had ticked stays ticked, and anything else
              you added to the file, including your own notes and any extra keys your Command Center reads,
              comes across untouched.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              <strong>So replacing your file with this one is safe, and doing it twice is safe.</strong> You
              will not lose a tick and you will not end up with duplicate stories. After that, your job is only
              ever to change a <code>false</code> to <code>true</code> as something genuinely passes. Never
              retype the wording: the platform matches on the exact sentence, so a reworded line quietly counts
              for nothing.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              <strong>Do not build this file by hand from the JSON block inside a story document.</strong>{' '}
              Those blocks show you the shape of the file using one story as the example, and a progress file
              built from one of them contains that story alone. Every other story would be missing its
              criteria, and a story with no criteria can never be confirmed no matter how much of it you build
              — with no error to tell you why. If your <code>.colaberry/progress.json</code> today has the full
              wording for STORY-000 but little or nothing for the rest, that is what happened, it was our
              instruction that caused it, and the button above is the fix.
            </p>
            <p style={{ margin: 0 }}>
              Separately, press <strong>Download the documents</strong> and unzip it into your repo, keeping
              the folders as they are. That gives you <code>.colaberry/plan.json</code> and{' '}
              <code>.colaberry/manifest.json</code> ready to commit. Unzipping is always safe: the archive
              deliberately carries no file at <code>.colaberry/progress.json</code>, so extracting it cannot
              cost you ticks you have already earned. If you would rather the platform maintained all of this
              for you, add it as a collaborator with write access and reconnect.
            </p>
          </div>
        )}

        <div className="rt-row">
          <button className="rt-btn" disabled={busy === 'sync'} onClick={doSync}>
            {busy === 'sync' ? 'Syncing…' : 'Sync from GitHub'}
          </button>
          <button className="rt-btn" onClick={() => { editRef(''); onConnectChange({ ...(connect as ConnectStateView), state: 'not_connected' }); }}>
            {lostAccess ? 'Reconnect' : 'Use a different repo'}
          </button>
          {/* THE DATA FILES HAVE TO STAY REACHABLE AFTER CONNECTING.
              STORY-000 criteria 3 and 4 are scored against a Command Center that
              reads `.colaberry/plan.json` and `.colaberry/manifest.json` at
              runtime, and the prompt tells the student the platform commits
              those files on every sync. On a repo we cannot push to, the write
              fails at the GitHub boundary and they never arrive — leaving the
              two criteria unsatisfiable through no fault of the student.

              This bundle is the only surface that hands over those exact files,
              and it used to be offered ONLY before connecting, so connecting
              took it away. Offered here too: a no-op for anyone whose repo we
              can write, and the entire answer for anyone whose repo we cannot. */}
          <button className="rt-btn" disabled={busy === 'download'} onClick={doDownload}>
            {busy === 'download' ? 'Building…' : 'Download the documents'}
          </button>
        </div>

        {/* One-time plumbing, only offered once a repo is actually connected —
            there is nothing to register a hook against before that. */}
        <WebhookSetupBlock projectId={projectId} repoLabel={`${repo.repo_owner}/${repo.repo_name}`} />

        {note && <p className="rt-muted" style={{ margin: '8px 0 0' }}>{note}</p>}

        {repo.recent_commits?.length > 0 && (
          <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
            {repo.recent_commits.slice(0, 3).map((c) => (
              <li key={c.sha} className="rt-muted" style={{ marginBottom: 4 }}>{c.message}</li>
            ))}
          </ul>
        )}
        {err && <ErrorNote err={err} />}
      </div>
    );
  }

  // ── door A, step 2: prove the push ────────────────────────────────────────
  if (state === 'awaiting_proof' && connect?.challenge) {
    return (
      <div className="rt-card">
        <div className="rt-lab" style={{ marginTop: 0 }}>Finish connecting</div>
        <p className="rt-muted" style={{ margin: '8px 0' }}>
          The platform can see <strong>{connect.owner}/{connect.repo}</strong>. Run these in the folder you are
          already working in. They turn it into a git repo if it is not one yet, then push it — which is what
          proves the repo is yours, and the only thing that does.
        </p>
        <p className="rt-muted" style={{ margin: '8px 0' }}>
          <strong>This first push uploads everything in the folder</strong>, not just the connection file — so
          check the <code>git status</code> list before you commit, and keep anything private (a{' '}
          <code>.env</code>, scratch files in <code>tmp/</code>) out of it.
        </p>
        <CommandBlock label={`Run in your project folder`} commands={connect.challenge.commands} />
        {/* THE SECOND GRANT, ASKED FOR HERE BECAUSE NOTHING ELSE ASKS FOR IT.
            The push above proves the repo is THEIRS. It says nothing about
            whether COLABERRY can write to it — those are two different grants on
            GitHub, and adding a collaborator only creates an invitation that
            somebody still has to accept. Measured 2026-08-23: 18 connections
            read "connected" while exactly ONE had platform push, so this step
            was being skipped by essentially everyone who ever connected. It sits
            in the same card as the push rather than after it, because a student
            who reaches "connected" considers themselves finished and never
            comes back. */}
        <p className="rt-muted" style={{ margin: '12px 0 0' }}>
          <strong>One more grant, and it is the one that builds your portfolio.</strong> Pushing proves the repo
          is yours. Separately, on GitHub open <strong>Settings &rarr; Collaborators</strong> and add{' '}
          <code>ColaberryIntern</code> — that is what lets the platform write the artifacts you build in Claude
          Code into your repo, so they show up on your GitHub rather than only here. We accept the invitation
          automatically within the hour, and GitHub expires invitations after 7 days.
        </p>
        <p className="rt-muted" style={{ margin: '8px 0 0' }}>
          You can connect without it and add it later — nothing you earn depends on it, and every artifact you
          have already built syncs the moment access lands.
        </p>
        <div className="rt-row" style={{ marginTop: 12 }}>
          <button className="rt-btn pri" disabled={busy === 'confirm'} onClick={doConfirm}>
            {busy === 'confirm' ? 'Checking…' : "I've pushed — connect it"}
          </button>
          <button className="rt-btn" onClick={() => { editRef(''); onConnectChange({ ...connect, state: 'not_connected', challenge: null }); }}>
            Use a different repo
          </button>
        </div>
        {err && <ErrorNote err={err} />}
      </div>
    );
  }

  // ── door B, step 2: point the existing folder at the new empty repo ───────
  if (state === 'awaiting_push' && connect?.adopt_commands) {
    return (
      <div className="rt-card">
        <div className="rt-lab" style={{ marginTop: 0 }}>Point your folder at it</div>
        <p className="rt-muted" style={{ margin: '8px 0' }}>
          <strong>{connect.owner}/{connect.repo}</strong> is created and empty, and you have push access.
          Run these in the folder you already have — your files and your whole history go up exactly as they
          are. Nothing is overwritten and nothing is forced. <strong>Everything in the folder goes up</strong>,
          so check the <code>git status</code> list before you commit.
        </p>
        <CommandBlock label="Run in your project folder" commands={connect.adopt_commands} />
        <div className="rt-row" style={{ marginTop: 12 }}>
          <button className="rt-btn pri" disabled={busy === 'sync'} onClick={doSync}>
            {busy === 'sync' ? 'Checking…' : "I've pushed — check it"}
          </button>
        </div>
        {err && <ErrorNote err={err} />}
      </div>
    );
  }

  // ── not connected: both doors, plus the download ──────────────────────────
  return (
    <div className="rt-card">
      <div className="rt-lab" style={{ marginTop: 0 }}>Connect your project folder</div>
      <p className="rt-muted" style={{ margin: '8px 0 12px' }}>
        You already have a folder for this build. Point the platform at its GitHub repo and everything stays
        where it is — <strong>the repo stays yours</strong>, under your own account. The platform keeps a
        pointer to it and the record of what you finish, never your code. It only ever writes{' '}
        <code>CLAUDE.md</code> (inside a marked block, around what you wrote), <code>docs/</code> and{' '}
        <code>.colaberry/</code>.
      </p>

      <div className="rt-row">
        <input
          className="rt-in"
          value={refInput}
          onChange={(e) => editRef(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && refInput.trim()) doStart(); }}
          placeholder="https://github.com/you/your-project"
          aria-label="Your GitHub repository address"
        />
        <button className="rt-btn pri" disabled={busy === 'connect' || !refInput.trim()} onClick={() => doStart()}>
          {busy === 'connect' ? 'Checking…' : 'Connect this repo'}
        </button>
      </div>
      {err && <ErrorNote err={err} onConfirmReplace={() => doStart(true)} />}

      <hr style={{ border: 0, borderTop: '1px solid var(--rt-line, rgba(128,128,128,.25))', margin: '16px 0 12px' }} />

      {!showFallback ? (
        <button className="rt-btn" onClick={() => setShowFallback(true)}>
          My folder is not on GitHub yet
        </button>
      ) : (
        <>
          <p className="rt-muted" style={{ margin: '0 0 8px' }}>
            The platform will create an <strong>empty public repo</strong> and add you to it, then give you the
            two commands that push your existing folder into it. Empty on purpose: your history arrives intact,
            with nothing to merge and nothing to force.
          </p>
          {/* Said before the button, not after it. A student who reads this
              AFTER pushing has already published whatever was in the folder. */}
          <p className="rt-hook-warn">
            <strong>This repo will be public. Anyone on the internet can read it.</strong> That is on
            purpose: it is your portfolio, and it is what lets GitHub Pages put your Command Center
            online for free at the end of Story 000. It also means everything you push is visible, so
            never commit a password, an API key, or a <code>.env</code> file. If something has to stay
            secret, keep it out of the folder.
          </p>
          <div className="rt-row">
            <input
              className="rt-in"
              value={ghLogin}
              onChange={(e) => setGhLogin(e.target.value)}
              placeholder="your-github-username"
              aria-label="Your GitHub username"
            />
            <button className="rt-btn" disabled={busy === 'provision' || !ghLogin.trim()} onClick={doProvision}>
              {busy === 'provision' ? 'Creating…' : 'Create an empty repo'}
            </button>
          </div>
        </>
      )}

      <p className="rt-muted" style={{ margin: '14px 0 0', fontSize: 12.5 }}>
        No GitHub account yet?{' '}
        <button
          className="rt-btn"
          style={{ padding: '2px 8px', fontSize: 12.5 }}
          disabled={busy === 'download'}
          onClick={doDownload}
        >
          {busy === 'download' ? 'Building…' : 'Download the documents'}
        </button>{' '}
        — the same files, as a zip you drop into your folder. Your prompts will work today, but stories cannot
        be verified and no points are awarded until a repo is connected: verification is a read of your repo.
      </p>
      {note && <p className="rt-muted" style={{ margin: '8px 0 0' }}>{note}</p>}
    </div>
  );
};

export default WorkspaceRepoPanel;
