import React, { useCallback, useState } from 'react';
import { setAgentReportsTo } from '../../../services/agentDetailApi';
import { getOrgChart } from '../../../services/workforceOrgChartApi';

// Reports-to editor (2026-09-30) — Dhee, on this exact card: "I should be able to change
// who Reese reports to. The functionality already exists - it's just not on this
// dashboard." Verified that belief was wrong (no real, HTTP-reachable write path existed
// anywhere). Extracted into its own file, mirroring AgentTrustControlEnforcement.tsx's own
// extraction precedent, rather than growing AgentOverviewV2Sidebar.tsx further.
//
// Candidate lists come from getOrgChart() — the one real, already-fetched-elsewhere source
// for human/agent lists, mirroring OrgChartHumanDrawer.tsx's own "plain <select> from an
// already-fetched list" pattern. The server independently re-validates (agentReportsToService.ts
// dry-runs the chain before persisting) — this picker is a UI convenience only.

interface Props {
  agentId: string;
  agentDisplayName: string;
  /** The raw columns, not the derived display chain — threaded through specifically so this
   * editor never has to guess the current value from a chain that goes null on a dangling
   * target even when reports_to_type is still set. */
  currentReportsToType: 'human' | 'agent' | null;
  currentReportsToId: string | null;
  /** Calls the page's existing fetchDetail — reports_to has 2 real consumers on this page
   * (this card and the layout footer's "manager" card), so a full refetch keeps both in
   * sync, unlike the ABAC override's local-state-only pattern (which has exactly 1 consumer). */
  onChanged: () => void;
}

type TargetType = 'human' | 'agent';
interface AgentCandidate { id: string; label: string }

export default function AgentOverviewV2ReportsToEditor({
  agentId, agentDisplayName, currentReportsToType, currentReportsToId, onChanged,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [humans, setHumans] = useState<{ id: string; name: string; email: string }[]>([]);
  const [agentCandidates, setAgentCandidates] = useState<AgentCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<TargetType>(currentReportsToType ?? 'human');
  const [targetId, setTargetId] = useState<string>(currentReportsToId ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openEditor = useCallback(async () => {
    setEditing(true);
    setTargetType(currentReportsToType ?? 'human');
    setTargetId(currentReportsToId ?? '');
    setSaveError(null);
    setCandidatesLoading(true);
    setCandidatesError(null);
    try {
      const chart = await getOrgChart();
      setHumans(chart.humans.map((h) => ({ id: h.id, name: h.name, email: h.email })));
      setAgentCandidates([
        ...chart.leadership.map((a) => ({ id: a.id, label: `${a.display_name} (AI Leadership)` })),
        ...chart.staff.map((a) => ({ id: a.id, label: `${a.display_name} (AI Staff)` })),
      ].filter((a) => a.id !== agentId));
    } catch (err: any) {
      setCandidatesError(err?.response?.data?.error || 'Failed to load real candidates');
    } finally {
      setCandidatesLoading(false);
    }
  }, [agentId, currentReportsToType, currentReportsToId]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!targetId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setAgentReportsTo(agentId, targetType, targetId);
      setEditing(false);
      onChanged();
    } catch (err: any) {
      setSaveError(err?.response?.data?.error || 'Failed to update who this agent reports to');
    } finally {
      setSaving(false);
    }
  }, [agentId, targetType, targetId, onChanged]);

  const unchanged = targetType === currentReportsToType && targetId === (currentReportsToId ?? '');

  if (!editing) {
    return (
      <button type="button" className="adv2-btn" style={{ fontSize: 12.5, padding: '3px 10px', marginTop: 10 }} onClick={openEditor}>
        Change manager…
      </button>
    );
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--adv2-rule)' }}>
      {candidatesLoading && <p className="adv2-muted">Loading real candidates…</p>}
      {candidatesError && <p style={{ color: 'var(--adv2-bad)' }}>{candidatesError}</p>}
      {!candidatesLoading && !candidatesError && (
        <>
          <div className="adv2-radio-row">
            <input
              type="radio"
              id={`reportsto-${agentId}-human`}
              name={`reportsto-type-${agentId}`}
              checked={targetType === 'human'}
              onChange={() => { setTargetType('human'); setTargetId(''); }}
            />
            <label htmlFor={`reportsto-${agentId}-human`}>Reports directly to a human (AI Leadership)</label>
          </div>
          <div className="adv2-radio-row">
            <input
              type="radio"
              id={`reportsto-${agentId}-agent`}
              name={`reportsto-type-${agentId}`}
              checked={targetType === 'agent'}
              onChange={() => { setTargetType('agent'); setTargetId(''); }}
            />
            <label htmlFor={`reportsto-${agentId}-agent`}>Reports through another agent (AI Staff)</label>
          </div>
          <select
            aria-label={`Choose who ${agentDisplayName} reports to`}
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--adv2-rule-2)', marginTop: 8, width: '100%' }}
          >
            <option value="">Choose a real {targetType === 'human' ? 'person' : 'agent'}…</option>
            {targetType === 'human'
              ? humans.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.email})</option>)
              : agentCandidates.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          {saveError && <p style={{ color: 'var(--adv2-bad)', marginTop: 8 }}>{saveError}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="adv2-btn adv2-primary" disabled={saving || !targetId || unchanged} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="adv2-btn" disabled={saving} onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
