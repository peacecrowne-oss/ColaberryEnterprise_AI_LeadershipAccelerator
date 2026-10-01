import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getAgentDetail, AgentDetail, AgentDetailTicket } from '../../services/agentDetailApi';
import { getManagerInboxItems, ManagerInboxItem } from '../../services/managerInboxApi';
import { getTicketStatusLabel } from '../../utils/ticketTypeMeta';
import { resetAgents, reactivateAgent, AutonomyLevel } from '../../services/workforceOrgChartApi';
import '../../styles/agentDetailV2.css';
import { TabKey } from '../../components/admin/agentDetailV2/AgentDetailV2Header';
import AgentDetailLayout from '../../components/admin/agentDetailV2/AgentDetailLayout';
import AgentOverviewV2 from '../../components/admin/agentDetailV2/AgentOverviewV2';
import AgentWorkDecisionsTab from '../../components/admin/AgentWorkDecisionsTab';
import AgentWorkV2 from '../../components/admin/agentDetailV2/AgentWorkV2';
import AgentTalkTab from '../../components/admin/AgentTalkTab';
import AgentPerformanceSettingsTab from '../../components/admin/AgentPerformanceSettingsTab';

// Agent Detail — Ali's requested transparency page: who this agent is, its real
// system prompt, its real tools/capabilities, its live status, and its linked
// ProofDesk ticket activity. Built generically (works for any AiAgent id) so it
// is the reusable blueprint for every future agent, not a one-off Reese page.
// Same independent-panel-failure posture as AdminWorkLedgerHealthPage.tsx.
//
// AI Workforce Management, Checkpoint B (2026-08-28) — tab shell, minimal-first
// slice (Ali's explicit choice over building all 10 planned tabs at once):
// "Overview" is everything this page already had, extracted verbatim into
// AgentOverviewTab.tsx; "Charter" is the one new real capability
// (AgentRoleCharter, PR #1898). The other 8 tabs from
// docs/architecture/ai-workforce-management/TARGET_ARCHITECTURE.md
// (Talk/Work/Decisions/Reports/Trust/Goals/Memory/Tools & Access/Activity)
// are NOT stubbed in here — a grayed-out tab for a capability that doesn't
// exist yet would misrepresent what this page can actually do. Add a tab only
// when its backend is real, per this repo's own "never fabricate" posture.
//
// AI Workforce Management, Checkpoint A of the Command Center redesign
// (2026-09-01) — "Command Center" added as a third, real tab, built entirely
// from the same detail payload plus the real per-agent Manager Inbox. Kept as
// a selectable tab rather than the new default: the ~1000-line
// AgentDetailPage.smoke.test.tsx suite asserts on Overview content assuming
// it's the tab that renders on mount, with no tab-click step anywhere in that
// file. Flipping the default here would silently break all of that coverage
// to switch a UX default — logged as a deliberate, reversible choice; ping
// once this has been reviewed live and the default can flip in one line.
//
// Checkpoint B (2026-09-02) — "Work & Decisions" added as a fourth tab:
// real pending approvals (now with real, agent-scoped approve/reject) and a
// Decision Journal from agentExplainabilityService.ts. Shares the same
// inbox state as Command Center (approving something here must update both
// tabs' view of what's pending) — see fetchInbox below.
//
// Checkpoint C (2026-09-02) — "Talk" added as a fifth tab: a real
// conversation (GPT-4o-mini) plus Ask vs. Direct, where Direct creates a
// real ManagerDirective (reusing the CRUD this mission already shipped and
// tested, not a new mechanism). No automated directive-conflict detection
// or effective-behavior preview — neither exists in the backend, so the UI
// shows the real active-directive list instead of fabricating either.
//
// Checkpoint C, Reports slice (2026-09-02) — "Reports" added as a sixth
// tab: real report-subscription CRUD (already shipped, zero prior frontend
// consumers) plus a brand-new GET /api/admin/agents/:id/report-runs this
// slice added, since delivery history had no read endpoint before this.
// successRatePct is null (rendered as "Not enough data yet"), never a
// fabricated 0% or 100%, when there's no real sent-or-failed evidence.
//
// Checkpoint D, Performance slice (2026-09-02) — "Performance" added as a
// seventh tab: real Goals (agentGoalService.ts's own zero-row-denominator
// bug was fixed this same checkpoint — a goal now reads UNMEASURED, never
// vacuously "met," when there's no underlying data) and real 1:1 check-ins
// (only agenda + outcome notes exist today, nothing fabricated beyond that).
//
// Checkpoint E, Trust & Control slice 1 (2026-09-03) — the standalone
// "Charter" tab from Checkpoint B was folded into a new "Trust & Control"
// tab (same total tab count, genuine consolidation): Charter is reused
// wholesale, plus two capabilities with no prior UI anywhere — Governed
// Memory (AgentMemoryProposal's real approve/reject gate) and a
// consolidated Directives view (revoke here; creation stays in Talk's
// Ask/Direct composer). Deliberately does NOT re-render
// authorization_summary/tools capabilities/persona_version_history —
// AgentOverviewTab's AgentTrustSummaryCard already shows all of that, live
// and tested; an Architecture Drawer (execution limits, department/scope)
// is real, deliberately deferred scope for the next slice.
//
// Checkpoint F, "At a Glance" (2026-09-03) — Ali, after reviewing all five
// sections: "this is a lot of information... a small update or
// conditionally formatted KPI... for each section... easy to navigate."
// Approved as an HTML mockup first, then built here. At the time this
// shipped, "Overview" was folded into Command Center and "At a Glance"
// took its old default-tab slot. Superseded by Checkpoint G below (Overview
// returns as its own standalone tab) and, later, by the Agent Detail
// redesign Track A1 comment further down (Overview becomes the default
// tab again) — "At a Glance" itself is unchanged and still real, just no
// longer the landing view. Tab count stays at seven.
//
// Checkpoint G (2026-09-10) — Ali, on Reese's own page: "The command
// center is too big and can be broken out into more tabs." Command Center
// unfolds back into two tabs, reversing Checkpoint F's fold the same way
// Checkpoint F reversed Checkpoint B's: "command" keeps its real-time
// content (operational state, attention required, current work, recent
// outcome, the stat row) under the new label "Live Status"
// (AgentLiveStatusTab.tsx, renamed from AgentCommandCenterTab.tsx — same
// tab key, so At a Glance's click-through target needed no change), and
// "Overview" (AgentOverviewTab.tsx, unchanged) returns to being its own
// top-level tab. Tab count goes to eight.
//
// Checkpoint H (2026-09-10) — same session, Ali's next request: "Overview
// should have subtabs." AgentOverviewTab.tsx's nine flat sections become
// seven sub-tabs (Identity, Trust, System prompt, Reports to, Tools,
// Scheduled tasks, Tickets) — see that file for the full breakdown. Role
// Charter moves from Trust & Control into Identity (a real relocation,
// Ali's own wording); AgentTrustControlTab no longer takes an `agentName`
// prop as a result. Reports to gains a real Mermaid diagram of this
// agent's own upward chain, built client-side from the existing
// reports_to.trail data — no backend change needed. Top-level tab count
// stays at eight; this checkpoint only restructures what's inside Overview.
//
// Checkpoint I (2026-09-11) — Ali pasted a full mockup ("Reese - agent
// page redesign") and asked to match its format. Replaced <PageHeader> +
// the Bootstrap nav-tabs chrome with AgentDetailV2Header (new page-scoped
// visual language, see styles/agentDetailV2.css) and rebuilt Overview as
// AgentOverviewV2 — a single flowing two-column page, matching the
// mockup, instead of Checkpoint H's sub-tabs. Same real content as
// before (see AgentOverviewV2's own components for the field-by-field
// mapping); AgentOverviewTab.tsx and its sub-tab files are removed as a
// result — nothing else referenced them. TabKey now lives in
// AgentDetailV2Header.tsx since the header owns tab rendering. The other
// six tabs' own content is intentionally NOT restyled in this pass — a
// deliberate scoping choice (same "ship the named surface first"
// precedent as every earlier checkpoint on this page), not an oversight.
//
// Dashboard redesign, Slice 1, Checkpoint J (2026-09-19) — Ali shared a
// real interactive mockup ("Reese - Employee workspace preview") whose
// Performance & Settings destination folds Reports/Performance/Trust &
// Control into one page with 3 internal sub-tabs — the same kind of fold
// Checkpoint E already did for Charter, applied at the top-level-tab
// scale this time. New AgentPerformanceSettingsTab.tsx hosts all 3
// components unchanged, plus Capabilities relocated out of Overview
// (AgentOverviewV2ToolsChannels.tsx) into its own "Tools & channels"
// sub-tab, matching the mockup's placement. Top-level tab count drops
// from 8 to 6. AgentAtAGlanceTab.tsx's 3 click-throughs that used to
// target 'reports'/'performance'/'trust' now all target
// 'performance_settings' — the tiles themselves are unchanged, only
// their destination. Overview, Talk, Work & Decisions, At a Glance
// (beyond the 3 retargeted clicks), and Live Status are unchanged in
// this slice — the mockup's Work/Decisions split and Overview's hero/KPI/
// timeline content were deliberately deferred at this point; Slice 2b
// (below) shipped Overview's hero/KPI/timeline shortly after, and the
// Agent Detail redesign Track A1 (further below) later shipped the Work
// tab's real list+detail split.
//
// Agent Detail redesign, Track A0 (2026-09-21) — the sidebar/topbar
// contextual shell (AgentDetailLayout.tsx), replacing this page's old
// horizontal AgentDetailV2Header chrome. See
// .loop-architect/runs/20260921-agent-detail-redesign-a0/handoff.md.
//
// Agent Detail redesign, Track A1 (2026-09-21) — Overview becomes the
// default landing tab (was "At a Glance"); its hero/metrics top ported
// from Bootstrap into the mockup's own `.adv2-hero`/`.adv2-metrics`
// visual language; the Work tab rebuilt as a real list+detail split
// (AgentWorkV2.tsx, replacing AgentWorkTab.tsx) — same 4 real buckets,
// no fictional 5-step ladder or 3-way split (neither has any real
// backing anywhere in this codebase). Every one of the 11 real sections
// that existed on Overview before this run is unchanged, just reflowed —
// see .loop-architect/runs/20260921-agent-detail-redesign-a1/ for the
// full reasoning.

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Agent Detail redesign, Track A1 (2026-09-21) — Overview is now the
  // default landing tab (was 'glance'/"At a Glance"), matching the mockup's
  // own default page. Generic by construction (this page fetches by route
  // id with no agent-specific branching) — every agent's own page changes
  // its landing tab, not just Reese's, same disclosed characteristic as
  // Track A0's shell change.
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  // Agent Detail polish round 4 (2026-09-30) — Ali, live: "Discuss with
  // Reese... should send a message about that case to reese so we can
  // already start the conversation." Confirmed via AskUserQuestion:
  // pre-fill the Talk compose box, never auto-send. Kept as its own small,
  // separate piece of state/prop — never widening the shared
  // onNavigate: (tab: TabKey) => void signature 25+ other call sites on
  // this page depend on.
  // Reese manager-directed growth mission, Phase 2 (2026-09-30) — widened from a plain
  // string to carry the real ticket id alongside the draft text (root cause of "Discuss with
  // Reese" producing "I cannot access the conversation details": the ticket's own id was
  // discarded right here, before it ever reached the backend — see this run's
  // execution-contract.md for the full trace). `ticketId: null` is the honest shape for a
  // non-ticket draft (e.g. the Results & Reports "Discuss this report" button below).
  const [talkDraft, setTalkDraft] = useState<{ text: string; ticketId: string | null } | null>(null);
  const handleDraftTalk = useCallback((ticket: AgentDetailTicket) => {
    const who = ticket.ticket_number != null ? `ticket #${ticket.ticket_number}` : 'this ticket';
    setTalkDraft({
      text: `Can you catch me up on ${who} — "${ticket.title}"? It's currently ${getTicketStatusLabel(ticket.status)}.`,
      ticketId: ticket.id,
    });
  }, []);
  const handleDraftTalkText = useCallback((text: string) => setTalkDraft({ text, ticketId: null }), []);
  // Agent Detail polish round 2 (2026-09-29) — Ali, live: clicking a
  // cross-tab link (e.g. Talk's "Inspect work records") switched tabs
  // correctly but landed wherever the window happened to be scrolled,
  // often the bottom of whatever tab was open before — no scroll container
  // exists anywhere in this shell (.adv2-shell-content sets no `overflow`,
  // so the window/document itself scrolls), and nothing reset scroll
  // position on tab change. Every tab switch now starts at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [activeTab]);
  // AI Workforce Reset (2026-08-24) — Ali, live: deactivate an agent and
  // cancel its open tickets, reversible (enabled:false, real ticket
  // cancellation) — see workforceOrgChartApi.ts::resetAgents().
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  // AI Workforce Reset, Phase C (2026-08-24) — Ali, live: "add new ones
  // slowly... so I can see how they perform." Reactivating a deactivated
  // agent requires a deliberate autonomy-level choice — never a bare
  // confirm, never a silent flip back to unlimited trust. `''` (no
  // selection) is the initial state so "Reactivate" starts disabled.
  const [selectedAutonomyLevel, setSelectedAutonomyLevel] = useState<AutonomyLevel | ''>('');
  const [reactivating, setReactivating] = useState(false);
  const [reactivationMessage, setReactivationMessage] = useState<string | null>(null);
  // Command Center, Checkpoint A (2026-09-01) — separate fetch, separate
  // loading/error state from the detail payload above. Only fetched once the
  // Command Center tab is actually opened, not on every page load, since the
  // other two tabs have no use for it.
  const [inboxItems, setInboxItems] = useState<ManagerInboxItem[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [inboxFetchedFor, setInboxFetchedFor] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getAgentDetail(id);
      setDetail(data);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load agent detail');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
    const interval = setInterval(fetchDetail, 30000);
    return () => clearInterval(interval);
  }, [fetchDetail]);

  // Command Center, Checkpoint A — fetch the manager inbox lazily, the first
  // time a tab that needs it is opened, not on every page load (Overview/
  // Charter have no use for it). Checkpoint B: Work & Decisions shares this
  // same state (and its own approve/reject calls force a real refetch via
  // fetchInbox below, not just the id-change cache check). Checkpoint F:
  // "At a Glance" is the new default tab and needs inboxItems for its own
  // Command Center + Work & Decisions tiles, so it joins the gate below —
  // this makes the inbox fetch effectively eager again (glance is the
  // landing tab), which is the correct tradeoff since the summary view
  // needs this data immediately, not on a later click.
  const fetchInbox = useCallback(async () => {
    if (!id) return;
    setInboxLoading(true);
    setInboxError(null);
    try {
      const items = await getManagerInboxItems(id);
      setInboxItems(items);
      setInboxFetchedFor(id);
    } catch (err: any) {
      setInboxError(err?.response?.data?.error || 'Failed to load pending approvals');
    } finally {
      setInboxLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if ((activeTab !== 'decisions' && activeTab !== 'overview') || !id || inboxFetchedFor === id) return;
    fetchInbox();
  }, [activeTab, id, inboxFetchedFor, fetchInbox]);

  const handleDeactivate = useCallback(async () => {
    if (!id || !detail) return;
    const displayName = detail.identity?.display_name || detail.agent.agent_name;
    const confirmed = window.confirm(
      `Deactivate ${displayName} and cancel its open tickets? This sets enabled:false (reversible) and cancels every currently-open ticket via the real ticket status transition — not a delete.`,
    );
    if (!confirmed) return;
    setResetting(true);
    setResetMessage(null);
    try {
      const [result] = await resetAgents([id]);
      setResetMessage(
        result.error
          ? `Failed to deactivate: ${result.error}`
          : `Deactivated. ${result.ticketsCancelled} open ticket${result.ticketsCancelled === 1 ? '' : 's'} cancelled.`,
      );
      await fetchDetail();
    } catch (err: any) {
      setResetMessage(err?.response?.data?.error || 'Failed to deactivate agent.');
    } finally {
      setResetting(false);
    }
  }, [id, detail, fetchDetail]);

  const handleReactivate = useCallback(async () => {
    if (!id || !selectedAutonomyLevel) return;
    // Ali, live: the picker used to only appear for a disabled agent, so
    // every real call here was a genuine reactivation. It's now also
    // reachable for an already-enabled agent to deliberately set/change its
    // level — same backend call (reactivateAgent() is a no-op on `enabled`
    // when already true), but "Reactivated" would misdescribe that case.
    const wasAlreadyEnabled = detail?.agent.enabled ?? false;
    setReactivating(true);
    setReactivationMessage(null);
    try {
      const result = await reactivateAgent(id, selectedAutonomyLevel);
      setReactivationMessage(
        result.error
          ? `Failed to reactivate: ${result.error}`
          : wasAlreadyEnabled
            ? `Autonomy level set to "${result.autonomyLevel}".`
            : `Reactivated at autonomy level "${result.autonomyLevel}".`,
      );
      setSelectedAutonomyLevel('');
      await fetchDetail();
    } catch (err: any) {
      setReactivationMessage(err?.response?.data?.error || 'Failed to reactivate agent.');
    } finally {
      setReactivating(false);
    }
  }, [id, selectedAutonomyLevel, detail, fetchDetail]);

  if (loading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (error || !detail || !id) {
    return <div className="alert alert-danger">{error || 'Agent not found'}</div>;
  }

  const { agent, identity } = detail;
  // Agent Alias & Identity Fix — same fix as the Live Agents card list: prefer the
  // real AdminUser.display_name over the raw technical agent_name. Falls back to
  // agent_name for a non-blueprint agent (identity is null — no linked AdminUser).
  const displayName = identity?.display_name || agent.agent_name;

  return (
    <AgentDetailLayout
      detail={detail}
      displayName={displayName}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onDeactivate={handleDeactivate}
      resetting={resetting}
      resetMessage={resetMessage}
      refreshing={loading}
      onRefresh={fetchDetail}
      reactivating={reactivating}
      reactivationMessage={reactivationMessage}
      selectedAutonomyLevel={selectedAutonomyLevel}
      onSelectAutonomyLevel={setSelectedAutonomyLevel}
      onReactivate={handleReactivate}
    >
      {activeTab === 'overview' && (
        <AgentOverviewV2 detail={detail} inboxItems={inboxItems} inboxLoading={inboxLoading} inboxError={inboxError} onInboxChanged={fetchInbox} onNavigate={setActiveTab} onReportsToChanged={fetchDetail} />
      )}
      {activeTab === 'work' && (
        <AgentWorkV2 detail={detail} onNavigate={setActiveTab} onDraftTalk={handleDraftTalk} />
      )}
      {activeTab === 'decisions' && (
        <AgentWorkDecisionsTab agentId={id} inboxItems={inboxItems} inboxLoading={inboxLoading} inboxError={inboxError} onInboxChanged={fetchInbox} />
      )}
      {activeTab === 'talk' && (
        <AgentTalkTab
          agentId={id}
          detail={detail}
          onNavigate={setActiveTab}
          initialDraft={talkDraft}
          onDraftConsumed={() => setTalkDraft(null)}
        />
      )}
      {activeTab === 'performance_settings' && (
        <AgentPerformanceSettingsTab agentId={id} detail={detail} inboxItems={inboxItems} onDraftTalkText={handleDraftTalkText} onNavigate={setActiveTab} />
      )}
    </AgentDetailLayout>
  );
}
