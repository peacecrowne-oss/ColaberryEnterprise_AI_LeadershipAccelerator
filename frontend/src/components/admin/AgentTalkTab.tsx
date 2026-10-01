import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TabKey } from './agentDetailV2/AgentDetailV2Header';
import { timeAgo } from './shell/trust';
import { adv2PillClass } from './agentDetailV2/adv2PillTone';
import { Conversation, getConversation, sendMessage } from '../../services/agentManagerConversationApi';
import { ManagerDirective, listDirectives, createDirective, revokeDirective } from '../../services/managerDirectiveApi';
import { AgentRoleCharter, getAgentRoleCharter } from '../../services/agentRoleCharterApi';
import { AgentDetail } from '../../services/agentDetailApi';
import { remarkPreserveGeneratedLineBreaks } from '../../utils/remarkPreserveGeneratedLineBreaks';
import TruncatedText from './agentDetailV2/TruncatedText';

// AI Agent Dashboard redesign, Checkpoint C (2026-09-02) — Talk: a real
// conversation (GPT-4o-mini round trip, both turns persisted) plus Ask vs.
// Direct per the original design brief. "Direct" creates a real, durable
// ManagerDirective — never a message-table row — so it's provably subject
// to the same real runtime injection and revocation as every other
// directive on this agent. Deliberately does NOT claim an automated
// conflict check or an "effective behavior preview": neither exists in the
// backend today (confirmed — managerDirectiveService.ts has no conflict
// logic, and predicting how a directive changes real model behavior isn't
// something this codebase can honestly claim to preview). Instead: the
// real active-directive list is shown before every Direct submission so the
// manager can check for conflicts themselves, and the one thing the code
// really does guarantee — a directive can only narrow behavior, never grant
// a new capability or bypass authorization (no code path reads
// ManagerDirective to do either) — is stated plainly.
//
// Agent Detail redesign, Track F (2026-09-28) — reflowed to this page's
// adv2-* visual language (the mockup's own .msg/.bubble/.composer shape),
// composer upgraded from a single-line <input> to a <textarea> (Enter
// sends, Shift+Enter inserts a newline — the real baseline's !sending
// idempotent-send guard is explicitly preserved, not dropped, and
// disabled={sending} stays on the textarea exactly as it was on the input).
// New "Shared working context" sidebar card, backed entirely by real data
// already fetched elsewhere on this page (role charter's mission/
// authorityApprovalRequired, the real active-directive count, trust_
// contract.schedule) — never a fabricated field. Zero change to any real
// API call or the Ask/Direct logic below.

interface Props {
  agentId: string;
  detail: AgentDetail;
  onNavigate: (tab: TabKey) => void;
  /** Agent Detail polish round 4 (2026-09-30) — a real, ticket-specific
   * message from the Work tab's "Discuss with Reese" button, pre-filled
   * into the composer below (never auto-sent). Kept separate from
   * `onNavigate` deliberately — see AgentDetailPage.tsx's own comment.
   * Reese manager-directed growth mission, Phase 2 (2026-09-30) — widened
   * to carry the real ticket id alongside the draft text (was `string |
   * null`), so the send that consumes this draft can bind the conversation
   * to that real case — the actual fix for "I cannot access the
   * conversation details." `ticketId` is null for a non-ticket draft (e.g.
   * the Results & Reports "Discuss this report" button). */
  initialDraft?: { text: string; ticketId: string | null } | null;
  onDraftConsumed?: () => void;
}

type ComposerMode = 'ask' | 'direct';

const QUICK_PROMPTS = [
  'What are you working on right now?',
  'What needs my decision?',
  'Summarize your recent activity.',
];

export default function AgentTalkTab({ agentId, detail, onNavigate, initialDraft, onDraftConsumed }: Props) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [conversationError, setConversationError] = useState<string | null>(null);

  const [directives, setDirectives] = useState<ManagerDirective[]>([]);
  const [directivesLoading, setDirectivesLoading] = useState(true);
  const [directivesError, setDirectivesError] = useState<string | null>(null);

  const [charter, setCharter] = useState<AgentRoleCharter | null | undefined>(undefined);
  const [charterError, setCharterError] = useState<string | null>(null);

  const [mode, setMode] = useState<ComposerMode>('ask');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [draftTicketId, setDraftTicketId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversation = useCallback(async () => {
    setConversationLoading(true);
    setConversationError(null);
    try {
      setConversation(await getConversation(agentId));
    } catch (err: any) {
      setConversationError(err?.response?.data?.error || 'Failed to load the conversation');
    } finally {
      setConversationLoading(false);
    }
  }, [agentId]);

  const fetchDirectives = useCallback(async () => {
    setDirectivesLoading(true);
    setDirectivesError(null);
    try {
      const all = await listDirectives(agentId);
      setDirectives(all);
    } catch (err: any) {
      setDirectivesError(err?.response?.data?.error || 'Failed to load standing directives');
    } finally {
      setDirectivesLoading(false);
    }
  }, [agentId]);

  const fetchCharter = useCallback(async () => {
    try {
      const view = await getAgentRoleCharter(agentId);
      setCharter(view.charter);
    } catch (err: any) {
      setCharterError(err?.response?.data?.error || 'Failed to load role charter.');
    }
  }, [agentId]);

  useEffect(() => { fetchConversation(); }, [fetchConversation]);
  useEffect(() => { fetchDirectives(); }, [fetchDirectives]);
  useEffect(() => { fetchCharter(); }, [fetchCharter]);

  // Ali, live: "I have to scroll every time I type something new... make it
  // more like ChatGPT." The message list never auto-scrolled to the newest
  // message — every new send/reply landed below the fold. Jump to the
  // bottom on initial load and whenever the message count changes.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation?.messages.length]);

  // Agent Detail polish round 4 (2026-09-30) — Ali, live: "Discuss with
  // Reese... should send a message about that case." Copies a real,
  // ticket-specific draft into the composer, resets the mode to 'ask'
  // (never let a drafted message about a ticket go out as a standing Direct
  // instruction if the composer was last left in Direct mode), then clears
  // the parent's one-shot state so leaving and returning to Talk — or
  // drafting about a different ticket — never repopulates/duplicates it.
  useEffect(() => {
    if (!initialDraft) return;
    setText(initialDraft.text);
    setDraftTicketId(initialDraft.ticketId);
    setMode('ask');
    onDraftConsumed?.();
  }, [initialDraft, onDraftConsumed]);

  const activeDirectives = directives.filter((d) => d.status === 'active');

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (mode === 'direct') {
      const confirmed = window.confirm(
        `Add this as a standing directive for this agent?\n\n"${trimmed}"\n\n` +
        `This can only narrow what the agent does — it can never grant a new capability or bypass authorization. ` +
        `${activeDirectives.length} other directive${activeDirectives.length === 1 ? ' is' : 's are'} already active; review the list below for conflicts before confirming.`,
      );
      if (!confirmed) return;
    }

    setSending(true);
    setSendError(null);
    try {
      if (mode === 'ask') {
        // Reese manager-directed growth mission, Phase 2 (2026-09-30) — one-shot: the real
        // ticket id only accompanies the message that consumed a fresh draft, never a later
        // manually-typed message. The backend persists this onto the conversation's own
        // focused_ticket_id and reuses it for follow-ups without it being resent every time.
        const updated = await sendMessage(agentId, trimmed, draftTicketId ?? undefined);
        setConversation(updated);
        setDraftTicketId(null);
      } else {
        await createDirective(agentId, trimmed);
        await fetchDirectives();
      }
      setText('');
    } catch (err: any) {
      setSendError(err?.response?.data?.error || `Failed to ${mode === 'ask' ? 'send message' : 'create directive'}`);
    } finally {
      setSending(false);
    }
  }, [agentId, mode, text, draftTicketId, activeDirectives.length, fetchDirectives]);

  const handleRevoke = useCallback(async (directiveId: string) => {
    setRevokingId(directiveId);
    try {
      await revokeDirective(agentId, directiveId);
      await fetchDirectives();
    } catch (err: any) {
      setDirectivesError(err?.response?.data?.error || 'Failed to revoke directive');
    } finally {
      setRevokingId(null);
    }
  }, [agentId, fetchDirectives]);

  // The real baseline guard (AgentTalkTab.tsx, pre-Track F) was
  // `e.key === 'Enter' && !sending`. The textarea upgrade ADDS a
  // `!e.shiftKey` check (so Shift+Enter can insert a real newline) — it
  // does not remove `!sending`. preventDefault() is only called on the
  // plain-Enter-and-not-sending branch, so Shift+Enter's native newline
  // insert fires untouched, and a second Enter while a send is already in
  // flight is blocked by this guard AND by disabled={sending} below.
  const handleComposerKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !sending) {
      e.preventDefault();
      handleSend();
    }
  }, [sending, handleSend]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="adv2-grid">
        <div className="adv2-card">
          <h2>
            Talk
            <span className="adv2-hint">Ask is a normal conversational turn. Direct creates a durable, versioned standing instruction.</span>
          </h2>
          <div className="adv2-body">
            {conversationError && <p style={{ color: 'var(--adv2-warn)' }}>Could not load the conversation: {conversationError}</p>}
            {conversationLoading && <p className="adv2-muted">Loading the conversation…</p>}
            {!conversationLoading && conversation && (
              <div className="adv2-chat">
                {conversation.messages.length === 0 ? (
                  <p className="adv2-muted" style={{ textAlign: 'center', padding: '24px 0' }}>No messages yet — say hello.</p>
                ) : (
                  conversation.messages.map((m) => (
                    <div key={m.id} className={`adv2-msg${m.role === 'manager' ? ' adv2-user' : ''}`}>
                      <div className="adv2-who">{m.role === 'manager' ? 'You' : 'Agent'} · {timeAgo(m.createdAt)}</div>
                      <div className="adv2-bubble">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkPreserveGeneratedLineBreaks]}>
                          {m.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            <p className="adv2-evidence adv2-muted" style={{ marginTop: 14 }}>
              Every reply here has real standing directives and any approved memory injected into it — but there is no per-message record of exactly which ones, or the model/cost/duration for a specific reply. Not tracked at that granularity today.
            </p>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, marginBottom: 8 }}>
              <button type="button" className={`adv2-btn${mode === 'ask' ? ' adv2-primary' : ''}`} onClick={() => setMode('ask')}>Ask</button>
              <button type="button" className={`adv2-btn${mode === 'direct' ? ' adv2-primary' : ''}`} onClick={() => setMode('direct')}>Direct</button>
            </div>
            {mode === 'ask' ? (
              <p className="adv2-muted">A normal conversational turn. Creates no lasting instruction.</p>
            ) : (
              <p className="adv2-muted">
                Creates a durable, versioned standing instruction. Can only narrow what the agent does — never grants a new capability or bypasses authorization.
                {!directivesLoading && ` ${activeDirectives.length} other directive${activeDirectives.length === 1 ? ' is' : 's are'} already active — see below.`}
              </p>
            )}

            {mode === 'ask' && (
              <div className="adv2-chatprompts">
                {QUICK_PROMPTS.map((p) => (
                  <button key={p} type="button" className="adv2-btn" style={{ fontSize: 12.5 }} onClick={() => setText(p)}>{p}</button>
                ))}
              </div>
            )}

            {sendError && <p style={{ color: 'var(--adv2-bad)', marginTop: 10 }}>{sendError}</p>}

            <div className="adv2-composer" style={{ marginTop: 14 }}>
              <textarea
                placeholder={mode === 'ask' ? 'Message this agent…' : 'e.g. "Hold anything under $50 impact until Friday\'s review."'}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                disabled={sending}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="adv2-btn adv2-primary" onClick={handleSend} disabled={sending || !text.trim()}>
                  {sending ? 'Sending…' : mode === 'ask' ? 'Send' : 'Add Directive'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div className="adv2-card">
            <h2>Shared working context</h2>
            <dl className="adv2-rows adv2-rows-narrow adv2-body" style={{ margin: 0 }}>
              <dt>Objective</dt>
              <dd>
                {charter === undefined && !charterError && 'Loading…'}
                {charterError && charterError}
                {charter === null && 'No role charter has been written yet.'}
                {charter && <TruncatedText text={charter.mission || 'No mission text recorded.'} />}
              </dd>
              <dt>Standing direction</dt>
              <dd>
                {directivesLoading ? 'Loading…' : activeDirectives.length === 0
                  ? 'None active right now.'
                  : `${activeDirectives.length} active — see below.`}
              </dd>
              <dt>Permission boundary</dt>
              <dd>
                {charter === undefined && !charterError && 'Loading…'}
                {charter === null && 'No role charter has been written yet.'}
                {charter && (!charter.authorityApprovalRequired || charter.authorityApprovalRequired.length === 0
                  ? 'None recorded.'
                  : charter.authorityApprovalRequired.join(', '))}
              </dd>
              <dt>Next scheduled check</dt>
              <dd>{detail.trust_contract.schedule || 'None'}</dd>
            </dl>
          </div>

          <div className="adv2-card" style={{ background: 'var(--adv2-trust-soft)' }}>
            <div className="adv2-body">
              <h3 style={{ margin: '0 0 8px' }}>Words become accountable work</h3>
              <p className="adv2-muted" style={{ margin: '0 0 8px' }}>
                An assignment should produce a plan. A promise should produce a commitment. A completed action should have a receipt.
              </p>
              <button type="button" className="adv2-btn" onClick={() => onNavigate('work')}>Inspect work records →</button>
            </div>
          </div>
        </div>
      </div>

      <div className="adv2-card">
        <h2>
          Standing Directives
          <span className="adv2-hint">Real, active instructions injected into every reply this agent gives.</span>
        </h2>
        {directivesLoading && <p className="adv2-body adv2-muted">Loading…</p>}
        {directivesError && <p className="adv2-body" style={{ color: 'var(--adv2-warn)' }}>{directivesError}</p>}
        {!directivesLoading && !directivesError && activeDirectives.length === 0 && (
          <p className="adv2-body adv2-muted">No standing directives active for this agent.</p>
        )}
        {!directivesLoading && !directivesError && activeDirectives.map((d) => (
          <div key={d.id} className="adv2-task">
            <div>
              <span className={adv2PillClass('success')}>Active</span>
              <p style={{ margin: '8px 0 4px' }}>{d.directiveText}</p>
              <p className="adv2-muted" style={{ margin: 0, fontSize: 13.5 }}>Set by {d.createdByEmail}, {timeAgo(d.createdAt)}</p>
            </div>
            <button className="adv2-btn adv2-danger" disabled={revokingId === d.id} onClick={() => handleRevoke(d.id)}>
              {revokingId === d.id ? 'Revoking…' : 'Revoke'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
