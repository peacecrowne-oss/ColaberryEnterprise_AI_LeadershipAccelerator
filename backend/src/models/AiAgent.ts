import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export type AiAgentType =
  // Existing operational agents
  | 'repair'
  | 'content_optimization'
  | 'conversation_optimization'
  | 'health_scanner'
  | 'scheduled_processor'
  | 'signal_detector'
  | 'intent_scorer'
  | 'trigger_evaluator'
  | 'insight_computer'
  | 'opportunity_scorer'
  | 'session_manager'
  | 'maintenance'
  | 'digest'
  | 'reminder'
  | 'orchestration_health'
  | 'student_monitor'
  | 'prompt_monitor'
  | 'orchestration_repair'
  | 'campaign_qa'
  | 'self_healing'
  // Intelligence layer agents
  | 'planner'
  | 'critic'
  | 'memory'
  // Autonomous operations agents
  | 'problem_discovery'
  | 'root_cause'
  | 'action_planner'
  | 'impact_estimator'
  | 'risk_evaluator'
  | 'execution'
  | 'monitor'
  | 'audit'
  // Strategic agents
  | 'strategic_intelligence'
  | 'revenue_optimization'
  | 'cost_optimization'
  | 'growth_experiment'
  | 'resource_allocator'
  | 'governance'
  // Meta-agents
  | 'architecture_analyzer'
  | 'prompt_optimizer'
  | 'performance_tracker'
  | 'experiment_runner'
  // Lead intelligence
  | 'lead_intelligence'
  // Website intelligence
  | 'website_ui'
  | 'website_links'
  | 'website_conversion'
  | 'website_ux'
  | 'website_behavior'
  | 'website_repair'
  | 'website_strategist'
  // Admissions intelligence
  | 'admissions_identity'
  | 'admissions_activity'
  | 'admissions_memory'
  | 'admissions_intent'
  | 'admissions_planning'
  | 'admissions_knowledge'
  | 'admissions_proactive'
  | 'admissions_page_context'
  | 'admissions_continuity'
  | 'admissions_high_intent'
  | 'admissions_ceo_recognition'
  | 'admissions_insights'
  | 'admissions_executive_update'
  // Admissions operations
  | 'admissions_document_delivery'
  | 'admissions_email'
  | 'admissions_sms'
  | 'admissions_appointment'
  | 'admissions_synthflow_call'
  | 'admissions_call_governance'
  | 'admissions_call_compliance'
  | 'admissions_callback'
  | 'admissions_task_monitor'
  | 'admissions_assistant'
  // Curriculum agents
  | 'curriculum_architect'
  | 'artifact_generator'
  | 'curriculum_qa'
  | 'curriculum_optimizer'
  // Platform agents
  | 'platform_fix'
  | 'curriculum_type_creator'
  | 'curriculum_type_fix'
  // Ticket & student tracking
  | 'ticket_management'
  | 'student_behavior_intelligence'
  // Executive & organizational
  | 'organization_health'
  | 'executive_briefing'
  // Strategy
  | 'product_strategy'
  | 'human_learning_strategy'
  | 'program_evolution'
  // Marketing
  | 'content_marketing'
  // Admissions extensions
  | 'enterprise_opportunity'
  // Alumni
  | 'alumni_outreach'
  | 'alumni_reengagement'
  | 'alumni_referral'
  // Partnerships
  | 'enterprise_partnership'
  | 'corporate_training'
  | 'employer_relationship'
  // Platform extensions
  | 'ux_optimization'
  | 'deployment'
  | 'performance_monitoring'
  // Intelligence extensions
  | 'data_intelligence'
  | 'trend_detection'
  | 'analytics'
  | 'opportunity_detection'
  // Governance
  | 'policy'
  | 'risk'
  | 'approval'
  // GitHub
  | 'github_automation'
  // OpenClaw Outreach Network
  | 'openclaw_supervisor'
  | 'openclaw_research'
  | 'openclaw_detection'
  | 'openclaw_content'
  | 'openclaw_browser'
  | 'openclaw_learning'
  | 'openclaw_infra_monitor'
  | 'openclaw_tech_research'
  | 'openclaw_authority_content'
  | 'openclaw_engagement_monitor'
  | 'openclaw_response_orchestrator'
  | 'openclaw_follow_up'
  | 'openclaw_quality_gate'
  | 'openclaw_linkedin_flow'
  | 'openclaw_linkedin_comment_monitor'
  // Reporting department
  | 'reporting_intelligence'
  | 'insight_discovery'
  | 'visualization_generation'
  | 'narrative_generation'
  | 'trend_analysis'
  | 'department_reporter'
  | 'executive_briefing_reporting'
  | 'experiment_recommendation'
  | 'revenue_opportunity_detection'
  | 'agent_performance_analytics'
  | 'knowledge_graph_builder'
  // Department Strategy Architects
  | 'dept_strategy_architect'
  // Security Operations
  | 'security_director'
  | 'secret_detection'
  | 'code_security'
  | 'dependency_security'
  | 'runtime_threat'
  | 'access_control'
  | 'ai_safety'
  | 'agent_behavior'
  // Executive intelligence modules
  | 'autonomous_engine'
  | 'strategic_cycle'
  | 'meta_agent_loop'
  // Dynamic (created by AI COO)
  | 'dynamic'
  // Department super agents
  | 'super_agent'
  // AI Workforce directors (orgRegistry.ts) — one tool + one action each
  | 'workforce_director'
  // Reese Phase 1 — real staff-facing AI mentor identity (student DM, ProofDesk-
  // linked). See backend/src/services/reeseIdentitySeed.ts.
  | 'ai_staff_mentor'
  // Agent Registration Stage 1 — identity-only registrations for real,
  // high-volume ticket-creator processes (cory-engine, CoryBrain,
  // InboxCaseEngine, workforce_intelligence_engine, bpos_orchestrator) that
  // have no conversational/staff-facing role. These rows exist so
  // resolveActorDisplayName() can resolve a ticket's created_by_id string to
  // a real display name; they carry no behavior of their own and are
  // distinct from any scheduler-tracked run-identity row for the same
  // underlying cron (e.g. 'cory-engine' here vs. the separate
  // 'AutonomousEngine' registry row used for run-count tracking). See
  // backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts.
  | 'ticket_creator_identity'
  // AI Employee Consolidation Program (2026-09-15/16) — a real, durable AI
  // employee built to Reese Employee Standard 2.0, WITHOUT Reese's own
  // 'ai_staff_mentor' type's student-DM-mentor-specific meaning (its own
  // comment above ties it to "student DM, ProofDesk-linked"). Employee #1
  // (Dara, Curriculum/Learning/Certification) has no student-facing surface
  // at all — a generic type, not a Reese-specific one, so future employees
  // (#2-#10) reuse this same literal rather than each minting their own.
  | 'ai_employee';

export type AiAgentStatus = 'idle' | 'running' | 'paused' | 'error';
export type AiAgentTriggerType = 'cron' | 'on_demand' | 'event_driven';
export type AiAgentCategory = 'outbound' | 'behavioral' | 'maintenance' | 'ai_ops' | 'accelerator' | 'autonomous' | 'strategic' | 'memory' | 'meta' | 'security' | 'website_intelligence' | 'admissions' | 'admissions_ops' | 'curriculum' | 'operations' | 'executive' | 'alumni' | 'partnerships' | 'student_success' | 'governance_ops' | 'openclaw' | 'reporting' | 'dept_strategy' | 'security_ops' | 'dept_super' | 'workforce_director';

interface AiAgentAttributes {
  id?: string;
  agent_name: string;
  agent_type: AiAgentType;
  status?: AiAgentStatus;
  config?: Record<string, any>;
  last_run_at?: Date;
  last_result?: Record<string, any>;
  // Registry fields
  module?: string;
  source_file?: string;
  trigger_type?: AiAgentTriggerType;
  schedule?: string;
  category?: AiAgentCategory;
  description?: string;
  enabled?: boolean;
  run_count?: number;
  avg_duration_ms?: number;
  error_count?: number;
  last_error?: string;
  last_error_at?: Date;
  // Execution limits
  max_runs_per_hour?: number;
  max_writes_per_execution?: number;
  max_proposals_per_run?: number;
  // Super-agent grouping
  agent_group?: string;
  created_at?: Date;
  updated_at?: Date;
  // Reese Phase 1 — agent-transparency fields (additive, see
  // backend/src/db/ensureAiAgentIdentitySchema.ts). All optional/nullable so
  // existing AiAgent rows are unaffected.
  system_prompt?: string | null;
  tools_granted?: string[] | null;
  persona_version?: string | null;
  // Agent Ticket Standard — the real human (org_members.id, org "Colaberry") this
  // agent is accountable to. Nullable at the DB level (see
  // db/ensureAiAgentReportsToSchema.ts); ticketService.createTicket() rejects
  // ticket creation from any non-human creator whose resolved AiAgent row has this
  // null. See directives/register-ticket-creating-agent.md.
  // Superseded by reports_to_type/reports_to_id below (2026-08-19) — left in place
  // for historical/audit value only, no longer read by the resolver.
  reports_to_org_member_id?: string | null;
  // AI Leadership / AI Staff hierarchy (2026-08-19). 'human': reports_to_id is an
  // org_members.id (this agent IS AI Leadership). 'agent': reports_to_id is
  // another ai_agents.id (this agent is AI Staff, reporting through a leadership
  // agent). See services/ticketCreatorReportsToResolver.ts's chain-walking
  // resolveReportsToHuman() for how a ticket's real human assignee gets derived
  // from this — it always resolves to a human at the end, however many hops.
  reports_to_type?: 'human' | 'agent' | null;
  reports_to_id?: string | null;
  // AI Workforce Reset, Phase C (2026-08-24) — the 4-level autonomy ladder
  // docs/ai-governance/abac-design.md proposed. Governs the REAL
  // agentAuthorizationService.ts gate only when autonomy_level_set_at is
  // non-null (see that field's own comment) — otherwise the gate's
  // pre-existing tier-derived level keeps governing, unchanged. See
  // ensureAiAgentAutonomyLevelSchema.ts for the real schema.
  autonomy_level?: 'observe' | 'suggest' | 'act_audited' | 'communicate' | null;
  // 2026-08-25 — null until agentReactivationService.ts's reactivateAgent()
  // sets it in the same update as autonomy_level. Distinguishes "an operator
  // deliberately chose this level" from "the migration's untouched 'observe'
  // default sitting on every agent that has never been through that flow" —
  // see agentAuthorizationService.ts's resolveLevel() for why this matters.
  autonomy_level_set_at?: Date | null;
  // Fleet-wide autonomy-level auto-classification, Phase 2 (2026-09-14) —
  // 'auto' (agentCapabilityClassifier.ts set this from real granted tools)
  // vs 'manual' (a human set it via reactivateAgent()) vs null (neither has
  // ever touched this agent). See ensureAiAgentAutonomySourceSchema.ts.
  autonomy_level_source?: 'auto' | 'manual' | null;
  // AI Employee Consolidation Program (2026-09-15/16) — the program's own
  // legacy-item-to-employee ownership fields. See
  // ensureAiAgentConsolidationSchema.ts. All three purely declarative and
  // additive; `null` for any row the program hasn't classified/absorbed yet.
  record_kind?: 'employee' | 'behavior' | 'tool' | null;
  parent_agent_id?: string | null;
  migration_status?: 'legacy' | 'absorbed' | 'archived' | null;
  // AI Workforce Reset, Phase D.1 "Inventory" (2026-08-24) — one of the 18 real
  // `departments` table slugs, or null when not yet classified / genuinely
  // cross-cutting (never forced). `scope` is JSONB, reserved for a future
  // per-campaign/per-lead-segment grant (abac-design.md decision 4's deferred
  // half) — unused today; `department` alone IS the scope for this phase. Both
  // purely declarative — see ensureAiAgentDepartmentScopeSchema.ts.
  department?: string | null;
  scope?: Record<string, any>;
  // Real-enforcement scoping, Phase 3 (2026-09-20) — the per-agent switch Ali asked for:
  // "I would like a switch for each agent so I can turn off/on Shadow mode." `null` means
  // "follow the global `abac_enforcement` SystemSetting" (agentAuthorizationService.ts's
  // getAbacMode()) — the real, untouched state of every agent on the day this shipped, so
  // adding this column is a genuine fleet-wide no-op, not just claimed. Deliberately excludes
  // 'off' — that stays a global-only concept (see ensureAiAgentAbacOverrideSchema.ts's own
  // header for why). See that file for the real schema.
  abac_mode_override?: 'shadow' | 'enforce' | null;
  // Null until an admin deliberately sets an override via agentAbacOverrideService.ts. Same
  // honesty pattern as autonomy_level_set_at above — distinguishes "an operator chose this"
  // from "no one has ever touched this agent's enforcement mode."
  abac_mode_override_set_at?: Date | null;
  // Goes further than autonomy_level's own precedent (which never recorded who) — an
  // authorization-enforcement switch is more consequential than an autonomy-level choice, so
  // this is a real audit trail: the admin's email/sub, per req.admin in workforceController.ts.
  abac_mode_override_set_by?: string | null;
  // Reports-to editor (2026-09-30) — null until an admin deliberately changes who this agent
  // reports to via agentReportsToService.ts. Same audit-trail shape as
  // abac_mode_override_set_at/_set_by: a misconfigured reports-to chain can silently break
  // this agent's own ticket creation (enforceReportsToGate()), so this write gets the same
  // real audit trail, not the sparser autonomy_level_set_at-only precedent.
  reports_to_set_at?: Date | null;
  reports_to_set_by?: string | null;
}

class AiAgent extends Model<AiAgentAttributes> implements AiAgentAttributes {
  declare id: string;
  declare agent_name: string;
  declare agent_type: AiAgentType;
  declare status: AiAgentStatus;
  declare config: Record<string, any>;
  declare last_run_at: Date;
  declare last_result: Record<string, any>;
  declare module: string;
  declare source_file: string;
  declare trigger_type: AiAgentTriggerType;
  declare schedule: string;
  declare category: AiAgentCategory;
  declare description: string;
  declare enabled: boolean;
  declare run_count: number;
  declare avg_duration_ms: number;
  declare error_count: number;
  declare last_error: string;
  declare last_error_at: Date;
  declare max_runs_per_hour: number;
  declare max_writes_per_execution: number;
  declare max_proposals_per_run: number;
  declare agent_group: string;
  declare created_at: Date;
  declare updated_at: Date;
  declare system_prompt: string | null;
  declare tools_granted: string[] | null;
  declare persona_version: string | null;
  declare reports_to_org_member_id: string | null;
  declare reports_to_type: 'human' | 'agent' | null;
  declare reports_to_id: string | null;
  declare autonomy_level: 'observe' | 'suggest' | 'act_audited' | 'communicate' | null;
  declare autonomy_level_set_at: Date | null;
  declare autonomy_level_source: 'auto' | 'manual' | null;
  declare record_kind: 'employee' | 'behavior' | 'tool' | null;
  declare parent_agent_id: string | null;
  declare migration_status: 'legacy' | 'absorbed' | 'archived' | null;
  declare department: string | null;
  declare scope: Record<string, any>;
  declare abac_mode_override: 'shadow' | 'enforce' | null;
  declare abac_mode_override_set_at: Date | null;
  declare abac_mode_override_set_by: string | null;
  declare reports_to_set_at: Date | null;
  declare reports_to_set_by: string | null;
}

AiAgent.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    agent_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    agent_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'idle',
    },
    config: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    last_run_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_result: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    // --- Registry fields ---
    module: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    source_file: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    trigger_type: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    schedule: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    run_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    avg_duration_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    error_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    last_error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    last_error_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Execution limits — null means unlimited (use system defaults)
    max_runs_per_hour: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    max_writes_per_execution: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    max_proposals_per_run: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Super-agent grouping — links subordinate agents to their super agent
    agent_group: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    system_prompt: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    tools_granted: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },
    persona_version: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    reports_to_org_member_id: {
      type: DataTypes.UUID,
      allowNull: true,
      // No DB-level FK constraint — matches this table's own convention of not
      // foreign-key-constraining actor-ref/ownership columns (see the header
      // comment in db/ensureAiAgentReportsToSchema.ts for why). Superseded by
      // reports_to_type/reports_to_id below (2026-08-19) — no longer read by
      // the resolver, kept for historical/audit value only.
      references: { model: 'org_members', key: 'id' },
    },
    reports_to_type: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    reports_to_id: {
      // Deliberately no `references` — unlike reports_to_org_member_id, this
      // column's target table depends on reports_to_type ('org_members' or
      // 'ai_agents'), which a single static FK/reference declaration can't
      // express. Same no-DB-FK convention either way; see above.
      type: DataTypes.UUID,
      allowNull: true,
    },
    autonomy_level: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: 'observe',
    },
    autonomy_level_set_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    autonomy_level_source: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    record_kind: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    parent_agent_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    migration_status: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    department: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    scope: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    abac_mode_override: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    abac_mode_override_set_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    abac_mode_override_set_by: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    reports_to_set_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    reports_to_set_by: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'ai_agents',
    timestamps: false,
    indexes: [
      { fields: ['category'] },
      { fields: ['enabled'] },
      { fields: ['trigger_type'] },
      { fields: ['agent_group'] },
      { fields: ['reports_to_org_member_id'] },
      { fields: ['reports_to_id'] },
    ],
  }
);

export default AiAgent;
