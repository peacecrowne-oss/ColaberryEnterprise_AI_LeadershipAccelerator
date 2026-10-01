import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

/**
 * AgentManagerConversation — a continuous DM-style thread between one real
 * human manager and one agent. AI Workforce Management, Checkpoint C
 * (2026-08-28), Direct Agent Communication — first slice.
 *
 * Keyed on `(agent_id, participant_email)`, not `org_member_id`: email is
 * always populated from the JWT regardless of role (matches the same
 * "email is the reliable identity, org_member_id is a when-available
 * enrichment" convention already established in ManagerDirective.ts). A
 * conversation genuinely needs to distinguish WHICH human is talking — unlike
 * a directive's attribution, a shared `null` key would incorrectly merge
 * every superadmin's conversation with one agent into a single thread.
 *
 * Find-or-create semantics: one row per (agent, manager) pair, mirroring the
 * real precedent of a continuous relationship (Reese's own student DM thread
 * — one room per enrollment, not a new thread per message) rather than named/
 * multiple threads. If a real need for multiple named conversations per
 * manager emerges later, that's a new column, not a retrofit onto this one.
 */
/**
 * Reese Agentic AI Employee mission, Checkpoint B — the one pending
 * quarantine/restore proposal a manager's message detected, awaiting their
 * next reply to confirm or cancel. Never applied to durable reliability
 * state until confirmed — see managerReliabilityIntentService.ts.
 */
export interface PendingReliabilityConfirmation {
  direction: 'quarantine' | 'restore';
  sourceSystem: string;
  metricKey: string;
  scopeType: 'global' | 'cohort' | 'student' | 'time_range';
  scopeValue: string | null;
  reason: string;
  detectedAt: string;
}

/**
 * Reese Agentic AI Employee mission, Capability 8 — the generic pending-
 * intent-confirmation shape, additive alongside `pending_reliability_confirmation`
 * (which keeps its own dedicated column and flow unchanged; see
 * managerReliabilityIntentService.ts). A discriminated union on `intentType`
 * so future intents (SCHEDULE, ASSIGN_WORK, ...) extend this type rather than
 * each getting their own column — the exact generalization Checkpoint B's own
 * header comment named as deferred scope. `metricKey`/`comparison` mirror
 * AgentGoal.ts's own closed union as plain strings (not imported types) for
 * the same reason PendingReliabilityConfirmation mirrors its own service's
 * types as strings — this model has no business depending on a service module.
 */
export interface PendingGoalChangeConfirmation {
  intentType: 'CHANGE_GOAL';
  metricKey: string;
  comparison: 'at_most' | 'at_least';
  targetValue: number;
  reason: string;
  detectedAt: string;
}

/**
 * Capability 8, second intent on the generic column — SCHEDULE (a manager
 * asking to book a 1:1 check-in). `agenda` is the manager's own message
 * verbatim, not an extracted/summarized field — see
 * managerOneOnOneIntentService.ts for why: agentOneOnOneService.createOneOnOne()
 * takes only a free-text agenda, no date/time, so there is nothing to parse
 * out beyond the trigger phrase itself.
 */
export interface PendingOneOnOneConfirmation {
  intentType: 'SCHEDULE_ONE_ON_ONE';
  agenda: string;
  detectedAt: string;
}

/**
 * Capability 8, third intent on the generic column — INSTRUCT (a manager
 * giving a standing directive). `directiveText` is the manager's own
 * message verbatim, same "no fragile extraction" posture as
 * PendingOneOnOneConfirmation's agenda — see managerDirectiveIntentService.ts.
 */
export interface PendingDirectiveConfirmation {
  intentType: 'INSTRUCT';
  directiveText: string;
  detectedAt: string;
}

/**
 * Capability 8, fourth intent on the generic column — ASSIGN_WORK (a manager
 * handing this agent a specific task). Unlike the first three, the real
 * backing write (orgChartTaskAssignmentService.assignTaskToAgent()) requires
 * a real client-generated idempotency key, so `idempotencyKey` is minted
 * once at detection time and carried on the pending record — the same key
 * is replayed at confirm time rather than a second one being generated,
 * which is what actually makes the write idempotent end to end. `title` is
 * the manager's own message verbatim, same "no fragile extraction" posture
 * as PendingOneOnOneConfirmation/PendingDirectiveConfirmation — see
 * managerAssignWorkIntentService.ts.
 */
export interface PendingAssignWorkConfirmation {
  intentType: 'ASSIGN_WORK';
  title: string;
  idempotencyKey: string;
  detectedAt: string;
}

/**
 * Capability 8, fifth and sixth intents on the generic column — APPROVE and
 * REJECT (a manager deciding on a pending `ProposedAgentAction`, the same
 * real object the Manager Inbox UI's own approve/reject buttons act on).
 * Genuinely different shape from the first four: "which proposal" is never
 * in the manager's own message text, so it's resolved against real pending
 * state (see managerApprovalDecisionIntentService.ts's
 * resolvePendingApprovalTarget()) BEFORE a confirmation card is ever built —
 * conservative, proceeding only when exactly one pending proposal exists for
 * this agent. `proposalId`/`reason` are carried forward so the confirm turn
 * never has to re-resolve (and can't silently pick up a DIFFERENT proposal
 * that became the sole pending item in between the two turns).
 */
export interface PendingApproveConfirmation {
  intentType: 'APPROVE';
  proposalId: string;
  reason: string;
  detectedAt: string;
}

export interface PendingRejectConfirmation {
  intentType: 'REJECT';
  proposalId: string;
  reason: string;
  detectedAt: string;
}

export type PendingIntentConfirmation =
  | PendingGoalChangeConfirmation
  | PendingOneOnOneConfirmation
  | PendingDirectiveConfirmation
  | PendingAssignWorkConfirmation
  | PendingApproveConfirmation
  | PendingRejectConfirmation;

export interface AgentManagerConversationAttributes {
  id?: string;
  agent_id: string;
  participant_email: string;
  /** Nullable for the same reason as ManagerDirective.created_by_org_member_id
   * — a platform super_admin is never resolved to an org_member by the auth
   * gate. */
  participant_org_member_id?: string | null;
  pending_reliability_confirmation?: PendingReliabilityConfirmation | null;
  pending_intent_confirmation?: PendingIntentConfirmation | null;
  /** Reese manager-directed growth mission, Phase 2 (2026-09-30) — the real case this
   * conversation is currently discussing, or null for the existing, unchanged manager-wide
   * question behavior. Set only by an explicit "Discuss with Reese on this case" action,
   * never inferred from free text alone. See ensureAgentManagerConversationFocusedTicketSchema.ts. */
  focused_ticket_id?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

class AgentManagerConversation
  extends Model<AgentManagerConversationAttributes>
  implements AgentManagerConversationAttributes
{
  declare id: string;
  declare agent_id: string;
  declare participant_email: string;
  declare participant_org_member_id: string | null;
  declare pending_reliability_confirmation: PendingReliabilityConfirmation | null;
  declare pending_intent_confirmation: PendingIntentConfirmation | null;
  declare focused_ticket_id: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

AgentManagerConversation.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agent_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'ai_agents', key: 'id' } },
    participant_email: { type: DataTypes.STRING(255), allowNull: false },
    participant_org_member_id: { type: DataTypes.UUID, allowNull: true, references: { model: 'org_members', key: 'id' } },
    pending_reliability_confirmation: { type: DataTypes.JSONB, allowNull: true },
    pending_intent_confirmation: { type: DataTypes.JSONB, allowNull: true },
    focused_ticket_id: { type: DataTypes.UUID, allowNull: true, references: { model: 'tickets', key: 'id' } },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'agent_manager_conversations',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['agent_id', 'participant_email'] }],
  }
);

export default AgentManagerConversation;
