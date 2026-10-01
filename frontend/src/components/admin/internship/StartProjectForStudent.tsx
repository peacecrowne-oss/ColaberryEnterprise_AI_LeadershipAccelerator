import React, { useEffect, useRef, useState } from 'react';
import { SectionCard, StatusBadge } from '../shell';
import {
  IntakeDocument,
  IntakeStudent,
  IntakeTurn,
  IntakeTurnResult,
  describeBuildError,
  readIntakeDocument,
  searchIntakeStudents,
  sendIntakeTurn,
} from '../../../services/adminFlotationIntakeApi';
import { getViewAsUrl } from '../../../services/adminOrgApi';
import ProjectPlanReview from './ProjectPlanReview';
import SpokenIntake from './SpokenIntake';
import { readActiveIntake, clearActiveIntake } from './flotationIntakeSession';

/**
 * The interview, from the management side.
 *
 *     "I want to be able to build the project from scratch using the same system as the
 *      AI Flotation project intake. I want that same exact intake on the Mgmt side so I can
 *      build projects for students."  (Ali, 2026-09-16)
 *
 * Pick a student, describe the project the way a customer would, answer the interviewer's
 * questions. When it has enough, it writes the understanding up and the build starts on its
 * own - through the same `runIntakeTurn` the public /start page calls, so what happens here
 * is what happens to a prospect, question for question.
 *
 * Two ways in, the same two /start offers: type it out, or have it call. The typed one
 * lives here; the spoken one is `SpokenIntake`. Both end in the same function server-side.
 *
 * The transcript lives in this component, exactly as /start keeps it in the page. One
 * session id per conversation; the server uses it to make the final turn idempotent.
 */

type Phase = 'pick' | 'choose' | 'talk' | 'done';
type Mode = 'typed' | 'spoken';

const newSessionId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export default function StartProjectForStudent({ startFor, onConsumed }: {
  /**
   * Skip the search and open straight on the two options for this student.
   *
   * Ali, 2026-09-29, from the roster above: "I want to be able to create a
   * project by clicking on a button in the intern category... so it's easy for
   * me to just click one button and I'm already setting up a project." The
   * search step exists for a student nobody is looking at; when the roster row
   * IS the student, searching for a name already on screen is a step for its
   * own sake.
   */
  startFor?: IntakeStudent | null;
  /** Called once the hand-off has been taken, so the parent can clear it. */
  onConsumed?: () => void;
} = {}) {
  // If a phone call was in flight before a page refresh, re-open straight on the
  // talk step for that student — SpokenIntake then re-attaches to the live call.
  const [resume] = useState(() => readActiveIntake());
  const [phase, setPhase] = useState<Phase>(resume ? 'talk' : 'pick');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<IntakeStudent[]>([]);
  const [searching, setSearching] = useState(false);
  const [student, setStudent] = useState<IntakeStudent | null>(resume ? resume.student : null);
  const [mode, setMode] = useState<Mode>(resume ? 'spoken' : 'typed');

  const [sessionId, setSessionId] = useState(newSessionId);
  const [turns, setTurns] = useState<IntakeTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<Extract<IntakeTurnResult, { done: true }> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  /**
   * Documents attached to this conversation, as text the server already read.
   *
   *     "I should be able to add documents to this process that can be analyzed before
   *      submitting the next question and can be used when creating the requirements."
   *      (Ali, 2026-09-29)
   *
   * Held here and re-sent with every turn, the same way the transcript is: the turn
   * endpoint keeps nothing between turns, which is what makes it safe to retry.
   */
  const [documents, setDocuments] = useState<IntakeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The plan this conversation produced. The review itself lives in ProjectPlanReview,
  // shared with the enquiry list, so both admin surfaces show one thing rather than two.
  const builtProjectId = finished?.build?.started ? finished.build.project_id ?? null : null;

  // Search as they type, after a pause, from two characters - the server refuses less.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setMatches([]); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchIntakeStudents(q);
        if (live) setMatches(found);
      } catch {
        if (live) setMatches([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, busy]);

  const pick = (s: IntakeStudent) => {
    setStudent(s);
    setMatches([]);
    setQuery('');
    setPhase('choose');
  };

  const choose = (m: Mode) => {
    setMode(m);
    setPhase('talk');
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !student || busy) return;
    const next = [...turns, { role: 'user' as const, text }];
    setTurns(next);
    setDraft('');
    setBusy(true);
    setError(null);
    try {
      const result = await sendIntakeTurn({ enrollmentId: student.id, sessionId, turns: next, documents });
      setTurns([...next, { role: 'assistant', text: result.message }]);
      if (result.done) {
        setFinished(result);
        setPhase('done');
      }
    } catch (err) {
      // Their message stays in the transcript; they can send the next one and the server
      // sees the whole thing again. Nothing was lost.
      setError(describeBuildError(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Attach a document, and read it now rather than at send time.
   *
   * Reading it here is what "analyzed before submitting the next question" means in
   * practice: the admin sees how much text came out before they type, so a scan with no
   * text layer is a visible refusal instead of a document that silently contributed
   * nothing to the requirements.
   */
  const attach = async (file: File | null | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    setDocError(null);
    try {
      const { document: doc, chars, clipped } = await readIntakeDocument(file);
      setDocuments((prev) => [...prev, doc]);
      if (clipped) {
        // Named out loud: a clipped document reporting success is exactly how a
        // requirement goes missing while the screen says everything worked.
        setDocError(`${doc.name} was long — the first ${chars.toLocaleString()} characters were kept.`);
      }
    } catch (err) {
      setDocError(describeBuildError(err));
    } finally {
      setUploading(false);
      // So the same file can be picked again after a failure; the input holds its value.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const reset = () => {
    clearActiveIntake();
    setPhase('pick');
    setStudent(null);
    setMode('typed');
    setSessionId(newSessionId());
    setTurns([]);
    setDraft('');
    setError(null);
    setDocuments([]);
    setDocError(null);
    setFinished(null);
  };

  // A roster hand-off lands here. Guarded on `phase === 'pick'` so it can never
  // interrupt a conversation already under way: clicking another intern mid
  // interview would otherwise discard the transcript with no warning.
  useEffect(() => {
    if (!startFor) return;
    if (phase === 'pick') {
      setStudent(startFor);
      setMatches([]);
      setQuery('');
      setPhase('choose');
    }
    onConsumed?.();
  }, [startFor, phase, onConsumed]);

  const viewAs = async () => {
    if (!student) return;
    const url = await getViewAsUrl(student.id);
    if (url) window.open(url, '_blank', 'noopener');
  };

  return (
    <SectionCard
      title="Start a project for a student"
      icon="chat-new-line"
      subtitle="The same interview a prospect gets on aiflotation.com, typed or by phone. The build starts when it has enough."
      actions={
        phase !== 'pick' ? (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={reset} disabled={busy}>
            <i className="ri-arrow-go-back-line me-1" />Start another
          </button>
        ) : undefined
      }
    >
      {phase === 'pick' && (
        <div style={{ maxWidth: 520 }}>
          <label htmlFor="intake-student" className="form-label small fw-semibold mb-1">Who is this project for?</label>
          <input
            id="intake-student"
            className="form-control form-control-sm"
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {searching && <div className="small text-muted mt-2">Searching&hellip;</div>}
          {!searching && query.trim().length >= 2 && matches.length === 0 && (
            <div className="small text-muted mt-2">No student matches that.</div>
          )}
          {matches.length > 0 && (
            <div className="list-group mt-2">
              {matches.map((m) => (
                <button key={m.id} type="button" className="list-group-item list-group-item-action py-2" onClick={() => pick(m)}>
                  <div className="d-flex justify-content-between align-items-center gap-2">
                    <span>
                      <span className="fw-semibold">{m.full_name || m.email}</span>
                      {m.full_name && <span className="text-muted small ms-2">{m.email}</span>}
                    </span>
                    <StatusBadge label={m.tier} tone={m.tier === 'guest' ? 'neutral' : 'info'} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {phase !== 'pick' && student && (
        <>
          <div className="d-flex align-items-center gap-2 mb-3 small flex-wrap">
            <i className="ri-user-line text-muted" aria-hidden="true" />
            <span>Building for <strong>{student.full_name || student.email}</strong></span>
            {student.full_name && <span className="text-muted">{student.email}</span>}
            {phase !== 'choose' && (
              <span className="text-muted ms-auto">
                <i className={`${mode === 'spoken' ? 'ri-phone-line' : 'ri-keyboard-line'} me-1`} aria-hidden="true" />
                {mode === 'spoken' ? 'by phone' : 'typed'}
              </span>
            )}
          </div>

          {phase === 'choose' && (
            <div className="row g-3" style={{ maxWidth: 720 }}>
              <div className="col-md-6">
                <button type="button" className="btn btn-outline-primary w-100 text-start p-3 h-100" onClick={() => choose('typed')}>
                  <div className="fw-semibold"><i className="ri-keyboard-line me-2" />Type it out</div>
                  <div className="small text-muted mt-1">You play the customer in the chat below. Same questions a prospect gets on aiflotation.com.</div>
                </button>
              </div>
              <div className="col-md-6">
                <button type="button" className="btn btn-outline-primary w-100 text-start p-3 h-100" onClick={() => choose('spoken')}>
                  <div className="fw-semibold"><i className="ri-phone-line me-2" />Have it call</div>
                  <div className="small text-muted mt-1">The AI Flotation agent phones a number and runs the interview by voice. The conversation appears here when the call ends.</div>
                </button>
              </div>
            </div>
          )}

          {mode === 'spoken' && phase === 'talk' && <SpokenIntake student={student} onViewAs={() => void viewAs()} />}

          {mode === 'typed' && phase !== 'choose' && (
          <>
          <div
            ref={logRef}
            className="border rounded p-3 mb-3"
            style={{ maxHeight: 420, overflowY: 'auto', background: 'var(--bs-tertiary-bg, #f8f9fa)' }}
            aria-live="polite"
          >
            {turns.length === 0 && (
              <p className="text-muted small mb-0">
                Start the way a customer would: what is the project, who is it for, what is painful today? One or two
                sentences is enough; the interviewer asks for the rest.
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`d-flex mb-2 ${t.role === 'user' ? 'justify-content-end' : 'justify-content-start'}`}>
                <div
                  className={`rounded px-3 py-2 small ${t.role === 'user' ? 'bg-primary text-white' : 'bg-white border'}`}
                  style={{ maxWidth: '78%', whiteSpace: 'pre-wrap' }}
                >
                  {t.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="d-flex justify-content-start mb-2">
                <div className="rounded px-3 py-2 small bg-white border text-muted">
                  <span className="spinner-border spinner-border-sm me-2" />thinking
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-danger small">{error}</p>}

          {phase === 'talk' && (
            <div className="mb-2">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <label className="btn btn-sm btn-outline-secondary mb-0" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
                  <i className="ri-attachment-2 me-1" />
                  {uploading ? 'Reading…' : 'Attach a document'}
                  <input
                    ref={fileRef}
                    type="file"
                    className="d-none"
                    accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.rtf,.txt,.md,.csv"
                    disabled={uploading || busy}
                    onChange={(e) => void attach(e.target.files?.[0])}
                  />
                </label>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  Read before the next question, and used when the requirements are written.
                </span>
              </div>

              {documents.length > 0 && (
                <div className="d-flex flex-wrap gap-2 mt-2">
                  {documents.map((d, i) => (
                    <span key={`${d.name}-${i}`} className="badge bg-light text-dark border d-inline-flex align-items-center gap-2">
                      <i className="ri-file-text-line" />
                      {d.name}
                      {/* The character count is the honest signal of what was actually
                          read: a 40-page PDF that yields 200 characters is a scan, and
                          the number says so where a filename would not. */}
                      <span className="text-muted">{d.text.length.toLocaleString()} chars</span>
                      <button
                        type="button"
                        className="btn-close"
                        style={{ fontSize: 9 }}
                        aria-label={`Remove ${d.name}`}
                        onClick={() => setDocuments((prev) => prev.filter((_, j) => j !== i))}
                      />
                    </span>
                  ))}
                </div>
              )}

              {docError && <p className="text-warning small mb-0 mt-2">{docError}</p>}
            </div>
          )}

          {phase === 'talk' && (
            <form
              className="d-flex gap-2"
              onSubmit={(e) => { e.preventDefault(); void send(); }}
            >
              <textarea
                className="form-control form-control-sm"
                rows={2}
                placeholder={turns.length === 0 ? 'Describe the project…' : 'Your answer…'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                }}
                disabled={busy}
                maxLength={4000}
              />
              <button type="submit" className="btn btn-sm btn-primary align-self-end" disabled={busy || !draft.trim()}>
                <i className="ri-send-plane-line me-1" />Send
              </button>
            </form>
          )}

          {phase === 'done' && finished && (
            <div className="border rounded p-3">
              <div className="d-flex align-items-center gap-2 mb-2">
                <StatusBadge
                  label={finished.understanding === 'created' || finished.understanding === 'deduplicated' ? 'written up' : finished.understanding}
                  tone={finished.understanding === 'created' || finished.understanding === 'deduplicated' ? 'success' : 'danger'}
                />
                {finished.build?.started ? (
                  <StatusBadge label="build started" tone="success" />
                ) : (
                  <StatusBadge label="build not started" tone="warning" />
                )}
              </div>
              <p className="small mb-2">
                {finished.build?.started ? (
                  <>
                    The project is building now - intake &rarr; decompose &rarr; gate &rarr; repair. It stops before
                    publishing and waits for you below; {student.full_name || 'they'} cannot see anything yet.
                  </>
                ) : (
                  <>The write-up was recorded but no build started: {finished.build?.reason || 'no reason given'}.</>
                )}
              </p>

              {builtProjectId && (
                <div className="mb-2">
                  <ProjectPlanReview projectId={builtProjectId} personName={student.full_name} />
                </div>
              )}

              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void viewAs()}>
                <i className="ri-eye-line me-1" />See it as they would
              </button>
            </div>
          )}
          </>
          )}
        </>
      )}
    </SectionCard>
  );
}
