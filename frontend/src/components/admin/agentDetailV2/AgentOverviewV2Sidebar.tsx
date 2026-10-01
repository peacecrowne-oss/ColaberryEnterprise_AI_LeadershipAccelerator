import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AgentDetail } from '../../../services/agentDetailApi';
import { AgentRoleCharter, getAgentRoleCharter, saveAgentRoleCharter, AgentRoleCharterInput } from '../../../services/agentRoleCharterApi';
import { timeAgo } from '../shell/trust';
import TruncatedText from './TruncatedText';
import AgentOverviewV2EmployeeFacts from './AgentOverviewV2EmployeeFacts';
import AgentOverviewV2ReportsToEditor from './AgentOverviewV2ReportsToEditor';

// Agent Detail V2, sidebar (2026-09-11) — Identity, Role Charter, Reports to
// (chain), Persona/prompt. The mockup Ali pasted didn't include Role
// Charter (it predates that build), but it's real, already-shipped content
// on this agent's Identity — "same content" means it doesn't get silently
// dropped, so it's added here in the new visual language. Reuses
// resolveReportsToChainWithTrail()'s own hop format (parsed the same way
// OverviewReportsToTab.tsx already does) rather than a second parser.

interface ParsedHop { name: string; terminal: 'human' | 'dangling' | 'unset' | null; }
const HOP_PATTERN = /^(.*) \(agent\)(?: -> \[(human|dangling|unset)\])?$/;
function parseHop(hop: string): ParsedHop {
  const match = hop.match(HOP_PATTERN);
  if (!match) return { name: hop, terminal: null };
  return { name: match[1], terminal: (match[2] as ParsedHop['terminal']) ?? null };
}

const emptyDraft: AgentRoleCharterInput = { roleTitle: '', mission: '', responsibilities: [''], kpis: [''] };
function toDraft(charter: AgentRoleCharter): AgentRoleCharterInput {
  return {
    roleTitle: charter.roleTitle,
    mission: charter.mission,
    responsibilities: charter.responsibilities.length ? charter.responsibilities : [''],
    kpis: charter.kpis.length ? charter.kpis : [''],
  };
}

interface Props {
  detail: AgentDetail;
  agentId: string;
  agentDisplayName: string;
  onReportsToChanged: () => void;
}

export default function AgentOverviewV2Sidebar({ detail, agentId, agentDisplayName, onReportsToChanged }: Props) {
  const { identity, agent, reports_to, persona_version_history } = detail;

  const [charter, setCharter] = useState<AgentRoleCharter | null | undefined>(undefined);
  const [charterLoadError, setCharterLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AgentRoleCharterInput>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchCharter = useCallback(async () => {
    try {
      const view = await getAgentRoleCharter(agentId);
      setCharter(view.charter);
    } catch (err: any) {
      setCharterLoadError(err?.response?.data?.error || 'Failed to load role charter.');
    }
  }, [agentId]);

  useEffect(() => { fetchCharter(); }, [fetchCharter]);

  const startEditing = () => {
    setDraft(charter ? toDraft(charter) : emptyDraft);
    setSaveError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const cleaned: AgentRoleCharterInput = {
        roleTitle: draft.roleTitle.trim(),
        mission: draft.mission.trim(),
        responsibilities: draft.responsibilities.map((r) => r.trim()).filter(Boolean),
        kpis: draft.kpis.map((k) => k.trim()).filter(Boolean),
      };
      const view = await saveAgentRoleCharter(agentId, cleaned);
      setCharter(view.charter);
      setEditing(false);
    } catch (err: any) {
      setSaveError(err?.response?.data?.error || 'Failed to save role charter.');
    } finally {
      setSaving(false);
    }
  };

  const hops = reports_to ? reports_to.trail.map(parseHop) : [];

  return (
    <div className="adv2-col">

      <section className="adv2-card">
        <h2>Identity</h2>
        <div className="adv2-body">
          {!identity && <p className="adv2-muted" style={{ marginBottom: 12 }}>No linked staff identity yet.</p>}
          <dl className="adv2-rows adv2-rows-narrow">
            {identity && (
              <>
                <dt>Real staff account</dt><dd>{identity.display_name || identity.email} ({identity.email})</dd>
                <dt>AI-operated</dt>
                <dd>{identity.is_ai_operated ? <span className="adv2-pill adv2-trust">AI-operated (admin view only — never shown to students)</span> : 'No'}</dd>
              </>
            )}
            <dt>Agent type</dt><dd>{agent.agent_type}{agent.category ? ` · ${agent.category}` : ''}</dd>
            <dt>Persona</dt><dd className="adv2-mono">{agent.persona_version || '—'}</dd>
          </dl>
        </div>
      </section>

      <section className="adv2-card">
        <h2>
          Role charter
          {charter !== undefined && !editing && (
            <span className="adv2-right"><span role="button" tabIndex={0} className="adv2-link" onClick={startEditing} onKeyDown={(e) => e.key === 'Enter' && startEditing()}>{charter ? 'Edit' : 'Write one'}</span></span>
          )}
        </h2>
        <div className="adv2-body">
          {charter === undefined && !charterLoadError && <p className="adv2-muted">Loading…</p>}
          {charterLoadError && <p style={{ color: 'var(--adv2-bad)' }}>{charterLoadError}</p>}

          {editing ? (
            <>
              {saveError && <p style={{ color: 'var(--adv2-bad)', fontSize: 13 }}>{saveError}</p>}
              <label style={{ display: 'block', fontSize: 12.5, color: 'var(--adv2-ink-3)', marginBottom: 4 }}>Role title</label>
              <input
                value={draft.roleTitle}
                onChange={(e) => setDraft((d) => ({ ...d, roleTitle: e.target.value }))}
                maxLength={255}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--adv2-rule-2)', borderRadius: 6, marginBottom: 10, font: 'inherit' }}
              />
              <label style={{ display: 'block', fontSize: 12.5, color: 'var(--adv2-ink-3)', marginBottom: 4 }}>Mission</label>
              <textarea
                value={draft.mission}
                onChange={(e) => setDraft((d) => ({ ...d, mission: e.target.value }))}
                maxLength={2000}
                rows={3}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--adv2-rule-2)', borderRadius: 6, marginBottom: 10, font: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="adv2-btn" onClick={handleSave} disabled={saving || !draft.roleTitle.trim() || !draft.mission.trim()}>{saving ? 'Saving…' : 'Save'}</button>
                <button className="adv2-btn" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
              </div>
              <p className="adv2-muted" style={{ marginTop: 10, fontSize: 12 }}>Responsibilities and KPIs stay as last saved — this quick editor covers role title and mission only.</p>
            </>
          ) : charter ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{charter.roleTitle}</div>
              <p style={{ margin: 0, color: 'var(--adv2-ink-2)' }}><TruncatedText text={charter.mission} /></p>
              <p className="adv2-muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5 }}>Last updated by {charter.updatedByEmail} on {new Date(charter.updatedAt).toLocaleDateString()}</p>
            </>
          ) : charter === null ? (
            <p className="adv2-muted">No role charter has been written for {agentDisplayName} yet.</p>
          ) : null}
        </div>
      </section>

      <section className="adv2-card">
        <h2>Reports to</h2>
        <div className="adv2-body">
          {reports_to ? (
            <ol className="adv2-chain">
              {hops.map((hop, i) => (
                <li key={i}>
                  {i === 0 ? (
                    <span className="adv2-who">{agentDisplayName}</span>
                  ) : i === 1 && reports_to.immediate_agent ? (
                    <Link className="adv2-link adv2-who" to={`/admin/agents/${reports_to.immediate_agent.id}`}>{hop.name}</Link>
                  ) : (
                    <span className="adv2-who">{hop.name}</span>
                  )}
                  <span className="adv2-role">{i === 0 ? 'This agent' : 'Agent, AI Leadership'}</span>
                </li>
              ))}
              {reports_to.resolved_human ? (
                <li>
                  <span className="adv2-who">{reports_to.resolved_human.name}</span>
                  <span className="adv2-role">Ultimately accountable. {reports_to.resolved_human.email}</span>
                </li>
              ) : (
                <li>
                  <span className="adv2-who">No human resolved</span>
                  <span className="adv2-role">This chain does not currently resolve to a real human.</span>
                </li>
              )}
            </ol>
          ) : (
            <p className="adv2-muted">No reports-to chain configured for this agent.</p>
          )}
          <AgentOverviewV2ReportsToEditor
            agentId={agentId}
            agentDisplayName={agentDisplayName}
            currentReportsToType={agent.reports_to_type}
            currentReportsToId={agent.reports_to_id}
            onChanged={onReportsToChanged}
          />
        </div>
      </section>

      <AgentOverviewV2EmployeeFacts detail={detail} agentId={agentId} />

      <section className="adv2-card">
        <h2>Persona and prompt</h2>
        <div className="adv2-body">
          <div className="adv2-version">
            <span className="adv2-muted">Version</span>
            <span className="adv2-mono">{agent.persona_version || '—'}</span>
          </div>
          {persona_version_history.length === 0 ? (
            <div className="adv2-version">
              <span className="adv2-muted">Changes recorded</span>
              <span>No version change recorded yet</span>
            </div>
          ) : (
            persona_version_history.map((h) => (
              <div className="adv2-version" key={h.id}>
                <span className="adv2-mono">{h.previous_version || '—'} → {h.persona_version}</span>
                <span className="adv2-muted">{timeAgo(h.created_at)}</span>
              </div>
            ))
          )}
          <details className="adv2-disclosure">
            <summary>Show system prompt</summary>
            {agent.system_prompt ? (
              <pre className="adv2-prompt">{agent.system_prompt}</pre>
            ) : (
              <p className="adv2-muted" style={{ marginTop: 10 }}>No system prompt recorded.</p>
            )}
          </details>
        </div>
      </section>

    </div>
  );
}
