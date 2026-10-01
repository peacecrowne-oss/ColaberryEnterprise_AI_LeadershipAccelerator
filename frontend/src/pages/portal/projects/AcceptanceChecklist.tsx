import React from 'react';

/**
 * AcceptanceChecklist — "Done means", as a VIEW OF SERVER TRUTH.
 *
 * These boxes used to be localStorage and nothing else: the student ticked
 * them, the count went up, and not one bit of it was reported anywhere. That is
 * a checklist that looks like a claim about the work while asserting nothing.
 *
 * Now there are two states and they must never be confusable:
 *
 *   CONFIRMED — the platform read this criterion as passing out of the repo.
 *     Evidence. Read-only, because there is no such thing as un-confirming your
 *     own evidence and a control that appeared to offer it would be lying about
 *     who decides.
 *
 *   SELF-TICKED — the student ticked it here. A note to self, kept because it is
 *     genuinely useful working memory, and drawn QUIETER than an untouched row
 *     rather than louder. An intention must never read as an achievement.
 *
 * They are separated on three channels at once — colour, weight and a written
 * label — because colour alone dies in a screenshot, in greyscale, and for a
 * colour-blind reader, and this distinction is the one the whole feature rests
 * on.
 *
 * ── THE EXPLANATION COMES FIRST, AND THAT IS THE WHOLE FIX ───────────────────
 *
 * All of the above was true and none of it was SAID until the student had
 * already been misled. The sentence explaining that a tick here confirms
 * nothing was rendered under `selfTickedCount > 0` — it appeared only AFTER a
 * tick. So the first thing a student met was three bare, enabled, unchecked
 * checkboxes under a heading called "Done means", beside a counter. They tick
 * one; the counter does not move (it counts confirmations, and the handler
 * writes localStorage and sends no request at all); and the page offers no
 * explanation, because the explanation was waiting on the very action it should
 * have prevented. Million Abate went four support rounds on precisely this, and
 * this cohort is largely non-technical — "click it and infer" is not a route
 * any of them will take.
 *
 * Two changes, and only the second one is copy:
 *
 *   1. THE AFFORDANCE IS MADE HONEST. An unconfirmed box is drawn as a note,
 *      not as a completion: neutral rather than the leaf green that means
 *      "confirmed" everywhere else on this page, and never struck through (see
 *      `.rt-acc-ok input:checked+span` in runtimeKit — the strike used to apply
 *      to any checked box and won on specificity over the self-tick's own
 *      reset, so a private note rendered wearing the universal "done" mark).
 *
 *   2. THE PANEL STATES WHAT THE BOXES ARE, above the first row,
 *      unconditionally. Not a warning and not an error — a plain sentence, in
 *      the place a student reads before they reach anything clickable.
 *
 * The local ticking stays. Students use it, and the "Your note — not confirmed
 * yet" state after a tick is genuinely useful. What goes is the pretence that
 * the tick is worth credit.
 */
export interface AcceptanceChecklistProps {
  /** The criteria as the published PLAN has them, in plan order. */
  acceptance: string[];
  stepNo: number;
  /** Has the platform confirmed this criterion against the repo? */
  isConfirmed: (text: string) => boolean;
  /** Is this criterion mid-celebration right now? Drives the staggered tick. */
  isJustConfirmed: (text: string) => boolean;
  /** The student's local scratchpad ticks, keyed by index. */
  ticked: Record<string, boolean>;
  onToggle: (index: number) => void;
  /**
   * Whether the PLATFORM can commit to this student's repo.
   *
   * It changes the instruction, which is why it is here rather than left to the
   * repo panel further down. On a `push` connection the platform seeded
   * `.colaberry/progress.json` itself, so "open it and set the line to true" is
   * a complete instruction. On `pull_only` it never could, so that same
   * sentence points at a file the student may not have — or, worse, at one they
   * built by hand from the JSON block inside a story document, which carries
   * one story's criteria and can never confirm any other, silently. Those
   * students need the button that BUILDS the file first, and it is on this same
   * page. `null` (a connection made before the permission was recorded) takes
   * the shorter push wording, which is true either way and names no control
   * that might not be rendered.
   */
  writeAccess?: 'push' | 'pull_only' | null;
  /**
   * Is a repo actually connected to this project yet?
   *
   * WHY THIS IS SEPARATE FROM `writeAccess`: it was not, and that was the bug.
   * A project with no repo at all reports `write_access: null`, which is the
   * same value as a connection made before the permission was recorded — so
   * both fell into the `push` branch and a student with nothing connected was
   * told to "open `.colaberry/progress.json` in your repo, change that line
   * ... commit and push". Every noun in that sentence is a thing they do not
   * have. It is the same class of mistake as pointing STORY-000's Step 1 at a
   * panel the page had not drawn (see ProjectWorkspacePage's note): an
   * instruction is only honest if the thing it names is on the screen.
   *
   * Unconnected, the only true next step is connecting, so that is the only
   * one named — and it is named as **Connect your project folder**, the
   * heading WorkspaceRepoPanel actually renders in its not-connected branch,
   * under "How to build it" on this same page. Defaults to `true` so the
   * existing wording is what renders for every caller that has not been
   * updated: the failure mode of this flag is telling a connected student
   * something they already know, never telling an unconnected one to edit a
   * file that does not exist.
   */
  repoConnected?: boolean;
}

const AcceptanceChecklist: React.FC<AcceptanceChecklistProps> = ({
  acceptance, stepNo, isConfirmed, isJustConfirmed, ticked, onToggle, writeAccess = null,
  repoConnected = true,
}) => {
  if (acceptance.length === 0) return null;

  const confirmedCount = acceptance.reduce((n, a) => (isConfirmed(a) ? n + 1 : n), 0);
  const selfTickedCount = acceptance.reduce(
    (n, a, i) => (ticked[i] && !isConfirmed(a) ? n + 1 : n), 0,
  );
  // The note explains the boxes a student can still click. Once every criterion
  // is confirmed there are none — every input is disabled and carries its own
  // evidence tag — and an explanation of an affordance that is no longer on
  // screen is just clutter on a finished story.
  const hasOpenBoxes = confirmedCount < acceptance.length;

  return (
    <section className="rt-step">
      <div className="rt-step-h">
        <span className="rt-step-n">{stepNo}</span>
        <span className="rt-step-t">Done means</span>
        {/* The count is CONFIRMED work, not ticked boxes. It used to be the local
            ticks, which meant a student could read "4 of 4" off a page where the
            platform had confirmed nothing at all.
            It now names WHERE the number comes from, because the fixed version
            has its own trap: a student who ticks all three boxes and reads
            "0 of 3 confirmed" is looking at a counter that appears broken. The
            same three words as the per-row tag, deliberately — one vocabulary
            for one idea. */}
        <span className="rt-step-c">{confirmedCount} of {acceptance.length} confirmed from your repo</span>
      </div>
      <div className="rt-card">
        {hasOpenBoxes && (
          <div className="rt-acc-note">
            <div className="rt-acc-note-h">These boxes are your own notes</div>
            <p>
              Ticking one is a note to yourself. It is saved in this browser only, it does not
              confirm anything, and it does not send us anything.
            </p>
            <p>
              {!repoConnected ? (
                <>
                  The platform confirms each line itself, by reading your repo — and this project
                  has no repo connected yet, so nothing here can be confirmed. Connect one under{' '}
                  <strong>Connect your project folder</strong> further down this page. Once it is
                  connected, these lines start confirming themselves from what you push.
                </>
              ) : (
                <>
                  The platform confirms each line itself, by reading your repo.{' '}
                  {writeAccess === 'pull_only' ? (
                    <>
                      To get a line confirmed, press <strong>Get my progress.json</strong> further
                      down this page and save that file in your repo at{' '}
                      <code>.colaberry/progress.json</code>. Then change that line from{' '}
                      <code>false</code> to <code>true</code>, commit, and push.
                    </>
                  ) : (
                    <>
                      To get a line confirmed, open <code>.colaberry/progress.json</code> in your
                      repo, change that line from <code>false</code> to <code>true</code>, then
                      commit and push.
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        )}
        <ul className="rt-acc">
          {acceptance.map((a, i) => {
            const confirmed = isConfirmed(a);
            const selfTicked = !confirmed && !!ticked[i];
            const landing = isJustConfirmed(a);
            return (
              <li
                key={i}
                className={
                  `${confirmed ? 'rt-acc-ok' : ''}`
                  + `${selfTicked ? ' rt-acc-self' : ''}`
                  + `${landing ? ' rt-acc-land' : ''}`
                }
              >
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed || !!ticked[i]}
                    disabled={confirmed}
                    onChange={() => { if (!confirmed) onToggle(i); }}
                  />
                  <span>{a}</span>
                  {/* The same honesty, for a reader who never sees the panel.
                      A screen reader announces the checkbox by its NAME, so the
                      standing note above — which is not part of any name — can
                      be walked straight past. Folded into the name it cannot be.
                      Only on rows with no visible tag of their own: a confirmed
                      row and a self-ticked row each already carry one, and a
                      second statement of the same fact is noise. */}
                  {!confirmed && !selfTicked && (
                    <span className="rt-sr"> (your own note, not confirmed)</span>
                  )}
                </label>
                {confirmed && <span className="rt-acc-tag ok">Confirmed from your repo</span>}
                {selfTicked && <span className="rt-acc-tag self">Your note — not confirmed yet</span>}
              </li>
            );
          })}
        </ul>
        {/* The count of open notes, and nothing else. The explanation this
            footer used to carry now lives above the rows where it is read
            before it is needed; repeating it here would only teach a skimming
            reader that the bottom of the panel is where the real information
            hides. */}
        {selfTickedCount > 0 && (
          <p className="rt-acc-foot">
            {selfTickedCount === 1
              ? '1 box is ticked as your own note.'
              : `${selfTickedCount} boxes are ticked as your own notes.`}{' '}
            Nothing is confirmed until the platform reads it from your repo.
          </p>
        )}
      </div>
    </section>
  );
};

export default AcceptanceChecklist;
