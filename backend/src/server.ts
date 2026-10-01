import fs from 'fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { connectDatabase, sequelize } from './config/database';
import { errorHandler } from './middlewares/errorHandler';
import { traceMiddleware } from './middlewares/traceMiddleware';
import healthRoutes from './routes/healthRoutes';
import deliveryClientAuthRoutes from './routes/deliveryClientAuthRoutes';
import deliveryClientRoutes from './routes/deliveryClientRoutes';
import deliveryAdminRoutes from './routes/deliveryAdminRoutes';
import leadRoutes from './routes/leadRoutes';
import enrollmentRoutes from './routes/enrollmentRoutes';
import webhookRoutes from './routes/webhookRoutes';
import unsubscribeRoutes from './routes/unsubscribeRoutes';
import adminRoutes from './routes/adminRoutes';
import calendarRoutes from './routes/calendarRoutes';
import strategyPrepRoutes from './routes/strategyPrepRoutes';
import trackingRoutes from './routes/trackingRoutes';
import publicCaseStudyRoutes from './routes/publicCaseStudyRoutes';
import { mountLearnerPortalRoutes } from './routes/mountLearnerPortalRoutes';
import capeAdminRoutes from './routes/admin/capeAdminRoutes';
import capeGovernanceRoutes from './routes/admin/capeGovernanceRoutes';
import communityRoomsRoutes from './routes/communityRoomsRoutes';
import alumniReferralRoutes from './routes/alumniReferralRoutes';
import qrRedirectRoutes from './routes/qrRedirectRoutes';
import trackedLinkRedirectRoutes from './routes/trackedLinkRedirectRoutes';
import openclawShortLinkRoutes from './routes/openclawShortLinkRoutes';
import mediaFetchRoutes from './routes/mediaFetchRoutes';
import linkedInCallbackRoutes from './routes/linkedInCallbackRoutes';
import marketingOAuthCallbackRoutes from './routes/marketingOAuthCallbackRoutes';
import v1Routes from './routes/v1Routes';
import advisorRoutes from './routes/advisorRoutes';
import showcaseArtifactRoutes from './routes/showcaseArtifactRoutes';
import buildArtifactRoutes from './routes/buildArtifactRoutes';
import buildLogDraftRoutes from './routes/buildLogDraftRoutes';
import publicPortfolioRoutes from './routes/publicPortfolioRoutes';
import publicCareerPortfolioRoutes from './routes/publicCareerPortfolioRoutes';
import { previewProxyMiddleware } from './middlewares/previewProxyMiddleware';
import { startScheduler } from './services/schedulerService';
import { startRepoTreeRefresh } from './services/repoTree/repoTreeRefreshService';
import { UPLOAD_DIR } from './config/upload';
import { seedProgramCurriculum } from './seeds/seedProgramCurriculum';
import { seedDepartments } from './seeds/seedDepartments';
import { seedCurriculumTypeDefinitions } from './seeds/seedCurriculumTypeDefinitions';
import { seedCurriculumCourseLinks } from './seeds/seedCurriculumCourseLinks';
import { seedAllCampaigns } from './seeds/seedAllCampaigns';
import { ensureExplorerCampaignKeyIndex } from './db/ensureExplorerCampaignKeyIndex';
import cron from 'node-cron';
import { ensureIntelligenceTables, runDiscoveryAgent, intelligenceMiddleware } from './intelligence';
import { ensureLiveSessionSchema } from './db/ensureLiveSessionSchema';
import { ensureInboxCaseSchema } from './db/ensureInboxCaseSchema';
import { ensureInboxCommitmentSchema } from './db/ensureInboxCommitmentSchema';
import { ensureLeadViewPreferenceSchema } from './db/ensureLeadViewPreferenceSchema';
import { ensureScholarshipInterviewSchema } from './db/ensureScholarshipInterviewSchema';
import { ensureWorkLedgerSchema } from './db/ensureWorkLedgerSchema';
import { ensureExplorerGrowthSchema } from './db/ensureExplorerGrowthSchema';
import { ensurePageEventLeadId } from './db/ensurePageEventLeadId';
// Student Build Pipeline. These two were dropped from server.ts when the
// sponsor magic-link fix (c21cd66e) resolved a conflict in this file by
// taking one side wholesale. Without them build_intake/build_plans are never
// created and github_connections is never re-keyed, so the pipeline fails on
// first use with 'relation does not exist'. Both are idempotent and assert
// their own post-conditions.
import { ensureSbpSchema } from './db/ensureSbpSchema';
import { ensureCertPrepSchema } from './db/ensureCertPrepSchema';
import { ensureProjectArchiveSchema } from './db/ensureProjectArchiveSchema';
import { ensureProjectApprovalSchema } from './db/ensureProjectApprovalSchema';
import { ensureContractTrackSchema } from './db/ensureContractTrackSchema';
import { ensureGovQualificationSchema } from './db/ensureGovQualificationSchema';
import { ensureGovOpportunityDismissalSchema } from './db/ensureGovOpportunityDismissalSchema';
import { ensureFactoryTaskSchema } from './db/ensureFactoryTaskSchema';
import { ensureEmailSendLedgerSchema } from './db/ensureEmailSendLedgerSchema';
import { ensureInternshipSchema } from './db/ensureInternshipSchema';
import { ensureMilestoneLadderSchema } from './db/ensureMilestoneLadderSchema';
import { ensureOauthTokenVaultSchema } from './db/ensureOauthTokenVaultSchema';
import { ensureWorkspaceRepoSchema } from './db/ensureWorkspaceRepoSchema';
import { ensureAgentAttachmentSchema } from './db/ensureAgentAttachmentSchema';
import { ensureReeseWelcomeSchema } from './db/ensureReeseWelcomeSchema';
import { ensureAdminUserIdentitySchema } from './db/ensureAdminUserIdentitySchema';
import { ensureAiAgentIdentitySchema } from './db/ensureAiAgentIdentitySchema';
import { ensureAiAgentReportsToSchema } from './db/ensureAiAgentReportsToSchema';
import { ensureAiAgentHierarchySchema } from './db/ensureAiAgentHierarchySchema';
import { ensureAiAgentAutonomyLevelSchema } from './db/ensureAiAgentAutonomyLevelSchema';
import { ensureAiAgentAutonomySourceSchema } from './db/ensureAiAgentAutonomySourceSchema';
import { ensureAiAgentAbacOverrideSchema } from './db/ensureAiAgentAbacOverrideSchema';
import { ensureAiAgentReportsToAuditSchema } from './db/ensureAiAgentReportsToAuditSchema';
import { ensureAiAgentConsolidationSchema } from './db/ensureAiAgentConsolidationSchema';
import { ensureAgentPersonaVersionHistorySchema } from './db/ensureAgentPersonaVersionHistorySchema';
import { ensureAgentRoleCharterSchema } from './db/ensureAgentRoleCharterSchema';
import { ensureManagerDirectiveSchema } from './db/ensureManagerDirectiveSchema';
import { ensureAgentManagerConversationSchema } from './db/ensureAgentManagerConversationSchema';
import { ensureAgentGoalSchema } from './db/ensureAgentGoalSchema';
import { ensureProjectUnderstandingSchema } from './db/ensureProjectUnderstandingSchema';
import { ensureProjectDiscoveryCallSchema } from './db/ensureProjectDiscoveryCallSchema';
import { ensureStoryEnrichmentSchema } from './db/ensureStoryEnrichmentSchema';
import { ensureAgentOneOnOneSchema } from './db/ensureAgentOneOnOneSchema';
import { ensureAgentReportSubscriptionSchema } from './db/ensureAgentReportSubscriptionSchema';
import { ensureAgentReportRunSchema } from './db/ensureAgentReportRunSchema';
import { ensureAgentMemoryProposalSchema } from './db/ensureAgentMemoryProposalSchema';
import { ensureAiAgentDepartmentScopeSchema } from './db/ensureAiAgentDepartmentScopeSchema';
import { ensureTicketCreatorIndexSchema } from './db/ensureTicketCreatorIndexSchema';
import { ensureMetricReliabilityRecordSchema } from './db/ensureMetricReliabilityRecordSchema';
import { ensureStudentAssessmentSchema } from './db/ensureStudentAssessmentSchema';
import { ensureChecklistInstanceSchema } from './db/ensureChecklistInstanceSchema';
import { ensureAgentManagerConversationReliabilitySchema } from './db/ensureAgentManagerConversationReliabilitySchema';
import { ensureAgentManagerConversationIntentSchema } from './db/ensureAgentManagerConversationIntentSchema';
import { ensureAgentManagerConversationFocusedTicketSchema } from './db/ensureAgentManagerConversationFocusedTicketSchema';
import { ensureEvidenceSchema } from './db/ensureEvidenceSchema';
import { ensureCaseStudySchema, assertCaseStudySchema } from './db/ensureCaseStudySchema';
import {
  ensureCaseStudyStoryAssets, assertCaseStudyStoryAssets,
} from './db/ensureCaseStudyStoryAssets';
import { ensureTicketIndexesSchema } from './db/ensureTicketIndexesSchema';
import { ensureSessionReminderSchema } from './db/ensureSessionReminderSchema';
import { ensureEnrollmentNotificationSchema } from './db/ensureEnrollmentNotificationSchema';
import { ensureWorkGraphSchema } from './db/ensureWorkGraphSchema';
import { ensureAgentWorkLifecycleFieldsSchema } from './db/ensureAgentWorkLifecycleFieldsSchema';
import { ensureApprovalRequestsSchema } from './db/ensureApprovalRequestsSchema';
import { ensureOrgAccountSchema } from './db/ensureOrgAccountSchema';
import { ensureMultiTenantSchema } from './db/ensureMultiTenantSchema';
import { ensureGrowthJourneySchema } from './db/ensureGrowthJourneySchema';
import { ensureRoutingAuditSchema } from './db/ensureRoutingAuditSchema';
import { ensureRefactoredDeliverySchema } from './db/ensureRefactoredDeliverySchema';
import { ensureCareerPublicationSchema } from './db/ensureCareerPublicationSchema';
import { ensureOutcomeMeasurementsSchema } from './db/ensureOutcomeMeasurementsSchema';
import { ensureMarketingTrackingSchema } from './db/ensureMarketingTrackingSchema';
import { ensureMarketingCampaignSchema } from './db/ensureMarketingCampaignSchema';
import { ensureContentOsSchema } from './db/ensureContentOsSchema';
import { ensurePublishingSchema } from './db/ensurePublishingSchema';
import { ensureMarketingAttributionSchema } from './db/ensureMarketingAttributionSchema';
import { ensureBrandGovernanceSchema } from './db/ensureBrandGovernanceSchema';
import { ensureChannelAccountSchema } from './db/ensureChannelAccountSchema';
import { ensureCapeSchema } from './db/ensureCapeSchema';
import { ensureCapstoneSchema } from './db/ensureCapstoneSchema';
import { ensureCapePlacementSchema } from './db/ensureCapePlacementSchema';
import { ensureCapeCurriculumMapSchema } from './db/ensureCapeCurriculumMapSchema';
import { ensureCapeLearningValueRankerSchema } from './db/ensureCapeLearningValueRankerSchema';
import { ensureCapeTodayPlanSchema } from './db/ensureCapeTodayPlanSchema';
import { ensureCapeGovernanceSchema } from './db/ensureCapeGovernanceSchema';
import { ensureCapeAiPulseExposureSchema } from './db/ensureCapeAiPulseExposureSchema';

// Import models to register associations before sync
import './models';

const app = express();

// Trust first proxy (nginx) for correct IP detection in rate limiting
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());

// Trace middleware (TBI audit P1-4): assign/propagate an x-trace-id for every request
// (including webhooks) and run the request inside an AsyncLocalStorage context so AI events
// emitted deep in the call chain are correlated to the originating request.
app.use(traceMiddleware);

// Webhook routes — each sub-route handles its own body parsing
app.use(webhookRoutes);

// Public one-click unsubscribe — mounted before the JSON parser; the POST
// (RFC 8058 one-click) handles its own urlencoded body parsing.
app.use(unsubscribeRoutes);

// Preview proxy — mounted BEFORE the JSON parser so request bodies pass through
// raw to upstream preview stacks.
app.use('/preview', previewProxyMiddleware());

// Global JSON parser for all other routes
app.use(express.json({ limit: '5mb' }));

// Intelligence process observation middleware (before routes)
app.use(intelligenceMiddleware());

app.use(healthRoutes);
// Client reviewer sign-in (Google SSO). Mounted UNAUTHENTICATED on purpose - it is the
// door. It grants nothing: it verifies a Google identity, looks up delivery memberships
// that already exist, and refuses when there are none.
app.use(deliveryClientAuthRoutes);
// The client read surface. Registered immediately after the auth route and BEFORE the
// admin tree: routes mounted after adminRoutes inherit its guard and answer 401 to a
// perfectly valid client token.
app.use(deliveryClientRoutes);
// Admin-gated; requireAdmin is applied per-route inside.
app.use(deliveryAdminRoutes);
app.use(leadRoutes);
app.use(enrollmentRoutes);
// The learner-portal mounts - participant, CAPE portal, career portfolio, Explorer signals, consent prompt - live in
// routes/mountLearnerPortalRoutes.ts (Phase 5 T514), mounted here at the position they held: after the enrolment routes,
// before the CAPE admin routes, and above adminRoutes.
mountLearnerPortalRoutes(app);
app.use(capeAdminRoutes);
app.use(capeGovernanceRoutes);
// Colaberry Commons — Community Rooms (flag-gated inside the router; 404s when
// COMMUNITY_ROOMS_ENABLED is off).
app.use(communityRoomsRoutes);
app.use(showcaseArtifactRoutes);
app.use(buildArtifactRoutes);
app.use(buildLogDraftRoutes);
app.use(publicPortfolioRoutes);
app.use(advisorRoutes);
app.use(alumniReferralRoutes);
app.use(qrRedirectRoutes);
// Marketing Operations - the public tracked-link redirect, GET /r/:shortCode.
//
// Mounted HERE, beside the QR redirect and after leadRoutes, because routers registered
// later sit behind the broad auth guard (leadRoutes.ts documents that ordering). A visitor
// clicking a link in a social post has no session, so a guarded mount would 401 every real
// click and the failure would look like the link being broken rather than misplaced.
//
// It re-validates its destination against the brand-domain allowlist on every request and
// issues nothing at all if that fails - see the route's header for why validating only at
// creation time is not sufficient.
app.use(trackedLinkRedirectRoutes);
// OpenClaw outreach short link (/i/:tag) - public, same reason and same rule as /r/ above.
// It sat BELOW adminRoutes from 2026-08-27 to 2026-09-11 and 401'd every visitor.
app.use(openclawShortLinkRoutes);
// Signed media fetch (/m/...) - public, a provider fetches it at publish time with no session.
// Same rule as /r/ and /i/: above adminRoutes or the guard 401s it. Pinned by its own test.
app.use(mediaFetchRoutes);
// LinkedIn's browser redirect after consent: no JWT, trusts the signed state. Above adminRoutes, like /r/ /i/ /m/.
app.use(linkedInCallbackRoutes);
// Every other network's browser redirect after consent (Meta, YouTube, TikTok, X, LinkedIn Pages).
// Same rule: no JWT on a top-level navigation, so above adminRoutes or it 401s.
app.use(marketingOAuthCallbackRoutes);
app.use(v1Routes);

// PUBLIC API routes — MUST stay mounted BEFORE adminRoutes. adminRoutes is mounted
// with no path prefix and chains many admin sub-routers that call `router.use(requireAdmin)`
// with no path scope. Because of that, any request that doesn't match an earlier route
// falls into adminRoutes and is 401'd ("Authentication required") by the first requireAdmin
// guard before it can ever reach these public routes. Mounting them ahead of adminRoutes lets
// their specific paths (/api/calendar/*, /api/strategy-prep/*, /api/t/*, /api/chat/*) match
// first. This was the cause of the strategy-call booking 401 bug (see
// reference_calendar_booking_401_bug). DO NOT move these below adminRoutes.
app.use(calendarRoutes);
app.use(strategyPrepRoutes);
app.use(trackingRoutes);
// Case Study OS public read API (/api/public/case-studies*, /api/public/case-study-*).
// Same rule as the block above, and it is not theoretical here: this router serves
// /stories to anonymous visitors, so mounting it below adminRoutes would make the
// public proof library return 401 to every real reader while every authenticated
// smoke test kept passing. publicCaseStudyRoutes.test.ts builds both orders against
// an adminRoutes-shaped stand-in and asserts 200 above / 401 below, so the failure
// mode is pinned by a test rather than by this comment.
// MUST stay above adminRoutes: a public route mounted after it inherits the admin
// auth guard and 401s for the strangers it exists to serve.
app.use(publicCareerPortfolioRoutes);
app.use(publicCaseStudyRoutes);

app.use(adminRoutes);

app.use(errorHandler);

// Explicit migration: AI Ops Command Center (Phase 0) — create the 4 ops tables.
//
// Why explicit instead of `sequelize.sync({ alter: true })`: that path is
// unreliable on prod because the alter pass hits a pre-existing index
// conflict elsewhere in the 215-model graph and the fallback create-only
// sync also fails on the same conflict. The explicit CREATE TABLE IF NOT
// EXISTS path matches the lead-ingestion schema pattern below and is the
// only reliable way to land new tables on prod right now.
async function ensureOpsCommandCenterSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS ops_bc_todos (
       bc_id VARCHAR(50) PRIMARY KEY,
       project_id VARCHAR(50) NOT NULL,
       todolist_id VARCHAR(50),
       title TEXT NOT NULL,
       description TEXT,
       status VARCHAR(30) NOT NULL DEFAULT 'active',
       due_on DATE,
       assignee_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
       bc_creator_id VARCHAR(50),
       bc_app_url TEXT,
       urgency_score INTEGER,
       ai_opportunity_score INTEGER,
       brand_score INTEGER,
       category VARCHAR(40) NOT NULL DEFAULT 'unscored',
       last_human_action_at TIMESTAMPTZ,
       downstream_blocked_count INTEGER NOT NULL DEFAULT 0,
       bc_created_at TIMESTAMPTZ NOT NULL,
       bc_updated_at TIMESTAMPTZ NOT NULL,
       last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ops_bc_todos_project ON ops_bc_todos (project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_bc_todos_status ON ops_bc_todos (status)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_bc_todos_urgency ON ops_bc_todos (urgency_score)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_bc_todos_category ON ops_bc_todos (category)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_bc_todos_due ON ops_bc_todos (due_on)`,

    `CREATE TABLE IF NOT EXISTS ops_ai_assessments (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       todo_bc_id VARCHAR(50) NOT NULL,
       agent VARCHAR(60) NOT NULL,
       agent_version VARCHAR(20) NOT NULL,
       urgency_score INTEGER,
       ai_opportunity_score INTEGER,
       brand_score INTEGER,
       category VARCHAR(40),
       reasoning JSONB,
       llm_model VARCHAR(60),
       llm_input_tokens INTEGER,
       llm_output_tokens INTEGER,
       llm_cost_usd DECIMAL(10,5),
       computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ops_ai_assess_todo ON ops_ai_assessments (todo_bc_id, computed_at)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_ai_assess_agent ON ops_ai_assessments (agent)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_ai_assess_computed ON ops_ai_assessments (computed_at)`,

    `CREATE TABLE IF NOT EXISTS ops_approval_queue (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       todo_bc_id VARCHAR(50) NOT NULL,
       artifact_id UUID,
       summary TEXT NOT NULL,
       recommended_decision VARCHAR(40),
       confidence DECIMAL(4,3),
       estimated_review_seconds INTEGER,
       blocked_downstream_count INTEGER NOT NULL DEFAULT 0,
       urgency_snapshot INTEGER,
       ai_opportunity_snapshot INTEGER,
       target_user_id VARCHAR(100),
       enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       decided_at TIMESTAMPTZ,
       decision VARCHAR(40),
       decided_by VARCHAR(100),
       decision_reasoning TEXT,
       next_actions JSONB,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ops_approval_open ON ops_approval_queue (decided_at)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_approval_urgency ON ops_approval_queue (urgency_snapshot)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_approval_user_open ON ops_approval_queue (target_user_id, decided_at)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_approval_todo ON ops_approval_queue (todo_bc_id)`,

    // Phase 1 additions
    `ALTER TABLE ops_bc_todos ADD COLUMN IF NOT EXISTS todolist_name TEXT`,
    `ALTER TABLE ops_bc_todos ADD COLUMN IF NOT EXISTS is_dismissed BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE ops_bc_todos ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ`,
    `ALTER TABLE ops_bc_todos ADD COLUMN IF NOT EXISTS dismissed_by VARCHAR(120)`,
    `ALTER TABLE ops_bc_todos ADD COLUMN IF NOT EXISTS dismissed_reason VARCHAR(40)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_bc_todos_dismissed ON ops_bc_todos (is_dismissed)`,
    `CREATE TABLE IF NOT EXISTS ops_bc_projects (
       bc_id VARCHAR(50) PRIMARY KEY,
       name TEXT NOT NULL,
       description TEXT,
       is_cb_managed BOOLEAN NOT NULL DEFAULT TRUE,
       weight DECIMAL(3,2) NOT NULL DEFAULT 1.0,
       last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ops_bc_projects_cb_managed ON ops_bc_projects (is_cb_managed)`,

    // Phase 2-light: skill extraction
    `CREATE TABLE IF NOT EXISTS ops_skills (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       name TEXT NOT NULL,
       action_kind VARCHAR(40) NOT NULL DEFAULT 'default',
       captured_from_todo_bc_id VARCHAR(50),
       captured_from_todo_title TEXT,
       reasoning TEXT,
       decision VARCHAR(40),
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       use_count INTEGER NOT NULL DEFAULT 0,
       created_by VARCHAR(120),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ops_skills_action_kind ON ops_skills (action_kind)`,
    `CREATE INDEX IF NOT EXISTS idx_ops_skills_active ON ops_skills (is_active)`,

    // Phase 4-light: automation rules
    `CREATE TABLE IF NOT EXISTS ops_automation_rules (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       name TEXT NOT NULL,
       description TEXT,
       condition_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
       action_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       last_fired_at TIMESTAMPTZ,
       fire_count INTEGER NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ops_automation_rules_active ON ops_automation_rules (is_active)`,

    `CREATE TABLE IF NOT EXISTS ops_metrics_daily (
       date DATE PRIMARY KEY,
       approvals_completed INTEGER NOT NULL DEFAULT 0,
       approvals_open_at_end INTEGER NOT NULL DEFAULT 0,
       approvals_avg_seconds INTEGER,
       approvals_p95_seconds INTEGER,
       downstream_unblocked INTEGER NOT NULL DEFAULT 0,
       hours_saved_estimated DECIMAL(8,2) NOT NULL DEFAULT 0,
       hours_blocked_estimated DECIMAL(8,2) NOT NULL DEFAULT 0,
       revenue_at_risk_estimated DECIMAL(12,2),
       revenue_protected_estimated DECIMAL(12,2),
       meetings_eliminated INTEGER NOT NULL DEFAULT 0,
       skills_created INTEGER NOT NULL DEFAULT 0,
       skills_used INTEGER NOT NULL DEFAULT 0,
       automations_fired INTEGER NOT NULL DEFAULT 0,
       agent_calls_count INTEGER NOT NULL DEFAULT 0,
       agent_total_cost_usd DECIMAL(10,4) NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn(`[DB] Ops Command Center schema statement failed:`, err.message?.split('\n')[0]);
    }
  }
  console.log('[DB] Ops Command Center schema ensured');
}

// Explicit migration: ensure Lead Ingestion tables + Lead columns exist.
// Runs BEFORE sequelize.sync so the FK on leads.source_id can resolve during alter.
async function ensureIngestionSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS lead_sources (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       slug VARCHAR(100) UNIQUE NOT NULL,
       name VARCHAR(255) NOT NULL,
       domain VARCHAR(255) NOT NULL,
       api_key_hash VARCHAR(255),
       hmac_secret VARCHAR(255),
       hmac_secret_prev VARCHAR(255),
       rate_limit INTEGER,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ
     )`,
    `CREATE TABLE IF NOT EXISTS entry_points (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       source_id UUID NOT NULL REFERENCES lead_sources(id) ON DELETE CASCADE,
       slug VARCHAR(100) NOT NULL,
       name VARCHAR(255),
       page VARCHAR(500),
       form_name VARCHAR(255),
       description TEXT,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ,
       UNIQUE (source_id, slug)
     )`,
    `CREATE TABLE IF NOT EXISTS form_definitions (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       entry_point_id UUID NOT NULL REFERENCES entry_points(id) ON DELETE CASCADE,
       field_map JSONB NOT NULL DEFAULT '{}'::jsonb,
       required_fields JSONB NOT NULL DEFAULT '["email"]'::jsonb,
       version INTEGER NOT NULL DEFAULT 1,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ
     )`,
    `CREATE TABLE IF NOT EXISTS routing_rules (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       name VARCHAR(255) NOT NULL,
       priority INTEGER NOT NULL DEFAULT 100,
       conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
       actions JSONB NOT NULL DEFAULT '[]'::jsonb,
       continue_on_match BOOLEAN NOT NULL DEFAULT FALSE,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ DEFAULT NOW(),
       updated_at TIMESTAMPTZ
     )`,
    `CREATE TABLE IF NOT EXISTS raw_lead_payloads (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       source_slug VARCHAR(100),
       entry_slug VARCHAR(100),
       headers JSONB,
       body JSONB,
       remote_ip VARCHAR(64),
       received_at TIMESTAMPTZ DEFAULT NOW(),
       resulting_lead_id INTEGER,
       status VARCHAR(20) NOT NULL DEFAULT 'pending',
       error_message TEXT
     )`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_id UUID`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS entry_point_id UUID`,
    `CREATE INDEX IF NOT EXISTS idx_lead_sources_active ON lead_sources (is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_entry_points_active ON entry_points (is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_form_defs_entry_active ON form_definitions (entry_point_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_routing_rules_active_priority ON routing_rules (is_active, priority)`,
    `CREATE INDEX IF NOT EXISTS idx_raw_payloads_received_at ON raw_lead_payloads (received_at)`,
    `CREATE INDEX IF NOT EXISTS idx_raw_payloads_status ON raw_lead_payloads (status)`,
    `CREATE INDEX IF NOT EXISTS idx_raw_payloads_source_entry ON raw_lead_payloads (source_slug, entry_slug)`,
    `CREATE INDEX IF NOT EXISTS idx_raw_payloads_lead ON raw_lead_payloads (resulting_lead_id)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn(`[DB] Ingestion schema statement failed:`, err.message?.split('\n')[0]);
    }
  }
  console.log('[DB] Ingestion schema ensured');
}

// Explicit migration: ensure composite index for the admin communications
// AI events telemetry table (TBI audit P1). Explicit idempotent creation because prod does
// not run sequelize.sync (DB_BOOT_SYNC is off by default); columns mirror the AiEvent model.
async function ensureStudentTaskMergeSchema() {
  // Unified StudentTask (F): relax requirement_key to nullable and add the
  // story-driven columns so requirement-based tasks (Kes's ProjectDnaWizard
  // path) and story/engine-based tasks live in one table. Idempotent. The
  // partial unique on (project_id, story_id) keeps engine upserts idempotent
  // without affecting requirement-based rows (story_id NULL).
  // Base tables first (idempotent CREATE) so a fresh/partial DB always has
  // student_task_lists + student_tasks BEFORE the ALTERs run — otherwise the
  // merge schema silently no-ops on a DB that never created them.
  try {
    const { seedStudentTaskTables } = await import('./seeds/seedStudentTasks');
    await seedStudentTaskTables();
  } catch (err: any) {
    console.warn('[DB] student-task base tables ensure failed:', err?.message);
  }
  const statements = [
    `ALTER TABLE student_tasks ALTER COLUMN requirement_key DROP NOT NULL`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS story_id VARCHAR(60)`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS narrative TEXT`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS owner_agent VARCHAR(120)`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS acceptance JSONB`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS build TEXT`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS vibe TEXT`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS trust TEXT`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(30)`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS fulfills JSONB`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS release_key VARCHAR(60)`,
    `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS blocked_by JSONB`,
    `CREATE INDEX IF NOT EXISTS idx_student_tasks_story ON student_tasks (story_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS student_tasks_unique_story ON student_tasks (project_id, story_id) WHERE story_id IS NOT NULL`,
    // SBP-REQ-v1 FR-012: a requirement is fulfilled by MANY stories, so
    // UNIQUE (project_id, requirement_key) was never a valid constraint. It
    // aborted importProject on the first task that re-cited a requirement —
    // in production every student build persisted exactly 3 tasks and then
    // 500'd (see docs/BUILD_PIPELINE_AUDIT.md, finding F-1). Task identity is
    // (project_id, story_id), enforced by the partial unique index above.
    // Recreate ONLY if you can also prove one requirement never spans two
    // stories, which the product explicitly does not guarantee.
    // Sequelize's `unique: true` creates a CONSTRAINT, not a bare index, so
    // `DROP INDEX` fails with "cannot drop index ... because constraint ...
    // requires it" and — because this loop catches and logs each statement —
    // fails SILENTLY. Drop the constraint first (that removes its backing index
    // too), then the bare-index form for any DB where it exists without a
    // constraint. Both are IF EXISTS, so running this twice is a no-op.
    `ALTER TABLE student_tasks DROP CONSTRAINT IF EXISTS student_tasks_unique_req_key`,
    `DROP INDEX IF EXISTS student_tasks_unique_req_key`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] student-task merge schema stmt skipped:', err?.message);
    }
  }

  // Post-condition check. Every statement above is best-effort and its failure is
  // only warned about, so a statement that MUST take effect cannot be verified by
  // "it didn't throw" — that is exactly how the first attempt at this drop failed
  // silently (DROP INDEX against a constraint-backed index). Assert the outcome.
  try {
    const [rows]: any = await sequelize.query(
      `SELECT
         (SELECT count(*) FROM pg_constraint
           WHERE conrelid = 'student_tasks'::regclass
             AND conname = 'student_tasks_unique_req_key') AS con,
         (SELECT count(*) FROM pg_indexes
           WHERE tablename = 'student_tasks'
             AND indexname = 'student_tasks_unique_req_key') AS idx`
    );
    const con = Number(rows?.[0]?.con ?? 0);
    const idx = Number(rows?.[0]?.idx ?? 0);
    if (con > 0 || idx > 0) {
      // Loud and structured: while this survives, every student build silently
      // truncates at the first task that re-cites a requirement (audit F-1).
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'backend',
        event: 'student_tasks_unique_req_key_still_present',
        outcome: 'failure',
        error_class: 'SchemaInvariantViolation',
        context: {
          constraint: con, index: idx,
          impact: 'student build imports will abort on the first duplicate requirement_key',
          remedy: "ALTER TABLE student_tasks DROP CONSTRAINT IF EXISTS student_tasks_unique_req_key",
        },
      }));
    } else {
      console.log('[DB] student_tasks_unique_req_key confirmed absent (FR-012)');
    }
  } catch (err: any) {
    console.warn('[DB] student-task schema post-check failed:', err?.message);
  }
}

async function ensureOnboardingProfileSchema() {
  // Background onboarding profile (S4): resume/LinkedIn + derived prefill that
  // seeds the ProjectDnaWizard. Idempotent.
  const statements = [
    `CREATE TABLE IF NOT EXISTS onboarding_profiles (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       resume_text TEXT,
       linkedin_url VARCHAR(500),
       prefill JSONB,
       extracted JSONB,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS onboarding_profiles_unique_enrollment ON onboarding_profiles (enrollment_id)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] onboarding-profile schema stmt skipped:', err?.message);
    }
  }
}

async function ensurePortalSettingsSchema() {
  // Student Settings page: profile photo (base64 on the enrollment) + an
  // uploaded resume FILE (base64 on the onboarding profile, so it survives
  // container redeploys and needs no static serving). Idempotent/additive.
  const statements = [
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS avatar_data_url TEXT`,
    `ALTER TABLE onboarding_profiles ADD COLUMN IF NOT EXISTS resume_file_name VARCHAR(255)`,
    `ALTER TABLE onboarding_profiles ADD COLUMN IF NOT EXISTS resume_mime VARCHAR(120)`,
    `ALTER TABLE onboarding_profiles ADD COLUMN IF NOT EXISTS resume_data TEXT`,
    `ALTER TABLE onboarding_profiles ADD COLUMN IF NOT EXISTS resume_uploaded_at TIMESTAMPTZ`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] portal-settings schema stmt skipped:', err?.message);
    }
  }
}

async function ensureOpenHouseSchema() {
  // Cohort-agnostic open house / info sessions (S3). Guests RSVP before joining.
  const statements = [
    `CREATE TABLE IF NOT EXISTS open_house_events (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       title VARCHAR(255) NOT NULL,
       description TEXT,
       starts_at TIMESTAMPTZ NOT NULL,
       timezone VARCHAR(60) NOT NULL DEFAULT 'America/Chicago',
       registration_url VARCHAR(500),
       meeting_link VARCHAR(500),
       status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_open_house_events_status_starts ON open_house_events (status, starts_at)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] open-house schema stmt skipped:', err?.message);
    }
  }
}

async function ensurePointsSchema() {
  // Append-only student points ledger (S2). Idempotent create + unique index so
  // pointsService.award is idempotent per (enrollment_id, event_key).
  const statements = [
    `CREATE TABLE IF NOT EXISTS student_points_events (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       event_type VARCHAR(60) NOT NULL,
       event_key VARCHAR(120) NOT NULL,
       points INTEGER NOT NULL DEFAULT 0,
       metadata JSONB,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS student_points_events_unique ON student_points_events (enrollment_id, event_key)`,
    `CREATE INDEX IF NOT EXISTS idx_student_points_events_enrollment ON student_points_events (enrollment_id)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] points schema stmt skipped:', err?.message);
    }
  }
}

async function ensureCommunityMemberRoleSchema() {
  // People directory role (student|mentor|staff), admin-assigned, default student.
  // Idempotent DDL (sequelize.sync is disabled on this graph) so a deploy adds the
  // column without a manual migration step. Mirrors 20260721_add_community_member_role.sql.
  const statements = [
    `ALTER TABLE community_members ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'student'`,
    `ALTER TABLE community_members DROP CONSTRAINT IF EXISTS ck_community_members_role`,
    `ALTER TABLE community_members ADD CONSTRAINT ck_community_members_role CHECK (role IN ('student', 'mentor', 'staff'))`,
    // Management-portal role for staff (Owner/Admin/Curriculum/Revenue/Admissions/
    // Support/Community Organizer). NULL = not a mgmt user. Gates admin sections
    // via mgmtRoles.ts.
    `ALTER TABLE community_members ADD COLUMN IF NOT EXISTS mgmt_role VARCHAR(20)`,
    `ALTER TABLE community_members DROP CONSTRAINT IF EXISTS ck_community_members_mgmt_role`,
    `ALTER TABLE community_members ADD CONSTRAINT ck_community_members_mgmt_role CHECK (mgmt_role IS NULL OR mgmt_role IN ('owner','admin','curriculum','revenue','admissions','support','community_organizer'))`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] community member role schema stmt skipped:', err?.message);
    }
  }
}

async function ensureCommunityCommentModerationSchema() {
  // Comment moderation (Community Organizer role, Ali 2026-08-05): mirrors the
  // existing community_posts status/removed_at/removed_by soft-delete pattern
  // (20260713_add_community_moderation.sql) so a removed comment stays in the
  // DB for audit but drops out of the thread. Idempotent DDL (sequelize.sync
  // is disabled on this graph) so a deploy adds the columns without a manual
  // migration step.
  const statements = [
    `ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'visible'`,
    `ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ`,
    `ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS removed_by UUID`,
    `ALTER TABLE community_comments DROP CONSTRAINT IF EXISTS ck_community_comments_status`,
    `ALTER TABLE community_comments ADD CONSTRAINT ck_community_comments_status CHECK (status IN ('visible', 'removed'))`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] community comment moderation schema stmt skipped:', err?.message);
    }
  }
}

async function ensureCommunityWinsSchema() {
  // Peer Wins (community_discussion type) — tether a community post to the
  // curriculum card + program/week it was posted from, plus a structured win_meta.
  // All nullable/additive; idempotent DDL (sequelize.sync is disabled on this graph)
  // so a deploy adds the columns without a manual migration step. The partial index
  // makes the per-(cohort, program, week) wins aggregation cheap.
  const statements = [
    `ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS program_id UUID`,
    `ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS week INTEGER`,
    `ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS source_card_id UUID`,
    `ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS ritual_meta JSONB`,
    `CREATE INDEX IF NOT EXISTS idx_community_posts_wins ON community_posts (cohort_id, program_id, week) WHERE source_card_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_community_posts_source_card ON community_posts (source_card_id, member_id) WHERE source_card_id IS NOT NULL`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] community wins schema stmt skipped:', err?.message);
    }
  }
}

async function ensureTodayMediaWatchSchema() {
  // Ambient media watch progress (ambientMediaGateService): podcasts and
  // testimonials on the Today feed have no timeline_card row, so the card watch
  // gate cannot track them. One row per (student, media ref) holding the same
  // WatchState shape the card gate stores in TimelineCardProgress.analytics.
  // Additive + idempotent, like the blocks above; no manual migration.
  const statements = [
    `CREATE TABLE IF NOT EXISTS today_media_watch (
       enrollment_id UUID NOT NULL,
       ref TEXT NOT NULL,
       watch_state JSONB NOT NULL DEFAULT '{}'::jsonb,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (enrollment_id, ref)
     )`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] today media watch schema stmt skipped:', err?.message);
    }
  }
}

async function ensureOrgSchema() {
  // Free-trial Organization / Manager layer. A manager registers free → gets a
  // management org + their own free enrollment; teammates join as free members.
  // Explicit idempotent DDL (sequelize.sync is disabled on this graph). The unique
  // index on (org_id, email) makes inviting the same teammate twice a no-op.
  const statements = [
    `CREATE TABLE IF NOT EXISTS organizations (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       name VARCHAR(255) NOT NULL,
       owner_enrollment_id UUID NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS organizations_owner_enrollment_unique ON organizations (owner_enrollment_id)`,
    `CREATE TABLE IF NOT EXISTS org_members (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       org_id UUID NOT NULL,
       enrollment_id UUID,
       email VARCHAR(255) NOT NULL,
       team VARCHAR(120),
       role VARCHAR(20) NOT NULL DEFAULT 'member',
       invite_status VARCHAR(20) NOT NULL DEFAULT 'invited',
       invited_by UUID,
       joined_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_email_unique ON org_members (org_id, email)`,
    `CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON org_members (org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_org_members_enrollment_id ON org_members (enrollment_id)`,
    // Opt-in auto-roster: when true, anyone assigned the community 'staff' role is
    // automatically added to this org's roster (and removed on demotion). See
    // communityService.setMemberRole → syncStaffToAutoOrgs.
    `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS auto_staff_sync BOOLEAN NOT NULL DEFAULT false`,
    // AI Workforce Management, Checkpoint D prerequisite (REPORTING_MAP.md's
    // "Timezone prerequisite" finding): no per-user timezone existed anywhere
    // in the codebase, so a report-subscription delivery-time picker had
    // nowhere honest to read from. Default matches the literal every cron
    // timezone value elsewhere in this repo already uses.
    `ALTER TABLE org_members ADD COLUMN IF NOT EXISTS timezone VARCHAR(60) NOT NULL DEFAULT 'America/Chicago'`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] org schema stmt skipped:', err?.message);
    }
  }
}

async function ensureSubscriptionSchema() {
  // Student self-serve subscriptions. Explicit idempotent create (sequelize.sync
  // is disabled on this graph). One row per checkout; payment_ref is the
  // PaySimple external_id used to activate on the payment webhook.
  const statements = [
    `CREATE TABLE IF NOT EXISTS subscriptions (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       plan VARCHAR(20) NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'pending',
       amount_cents INTEGER NOT NULL DEFAULT 0,
       payment_ref VARCHAR(120) NOT NULL,
       paysimple_customer_id VARCHAR(120),
       paysimple_payment_id VARCHAR(120),
       started_at TIMESTAMPTZ,
       current_period_end TIMESTAMPTZ,
       canceled_at TIMESTAMPTZ,
       cancel_reason TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_payment_ref_unique ON subscriptions (payment_ref)`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_enrollment ON subscriptions (enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status)`,
    // Account-credit applied to this checkout's first charge (added 2026-07 with account_credits).
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS applied_credit_cents INTEGER NOT NULL DEFAULT 0`,
    // The standing PaySimple schedule, once one exists (added 2026-08 with recurring
    // billing). NULL means the member is still on manual renewal. This MUST land
    // before or with the deploy that ships the model field: Sequelize selects every
    // declared attribute, so a model column with no database column turns every
    // subscription read into "column does not exist".
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paysimple_schedule_id VARCHAR(120)`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_schedule ON subscriptions (paysimple_schedule_id)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] subscription schema stmt skipped:', err?.message);
    }
  }
}

async function ensureAccountCreditSchema() {
  // Account credits (Open House $50 "hold your spot" deposits → applied to the
  // student's next subscription payment). Append-only ledger; unique
  // source_event_id makes granting idempotent (a re-run cannot double-credit).
  const statements = [
    `CREATE TABLE IF NOT EXISTS account_credits (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       amount_cents INTEGER NOT NULL,
       reason VARCHAR(64) NOT NULL,
       source_event_id VARCHAR(200) NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'available',
       applied_subscription_id UUID,
       applied_at TIMESTAMPTZ,
       granted_by VARCHAR(120),
       note TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS account_credits_source_event_unique ON account_credits (source_event_id)`,
    `CREATE INDEX IF NOT EXISTS idx_account_credits_enrollment_status ON account_credits (enrollment_id, status)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] account-credit schema stmt skipped:', err?.message);
    }
  }
}

async function ensureRefundSchema() {
  // Admin-issued PaySimple refunds/voids. Ledger row per attempt; written
  // pending before the API call so a mid-flight crash is visible (no silent
  // double-refund). Idempotent create — safe to re-run.
  const statements = [
    `CREATE TABLE IF NOT EXISTS refunds (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID,
       paysimple_payment_id VARCHAR(120) NOT NULL,
       paysimple_refund_id VARCHAR(120),
       amount_cents INTEGER NOT NULL,
       method VARCHAR(20) NOT NULL DEFAULT 'refund',
       status VARCHAR(20) NOT NULL DEFAULT 'pending',
       reason TEXT,
       customer_email VARCHAR(255),
       voided_credit_cents INTEGER NOT NULL DEFAULT 0,
       issued_by VARCHAR(120),
       error TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds (paysimple_payment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds (status)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] refund schema stmt skipped:', err?.message);
    }
  }
}

async function ensureFreeTierSchema() {
  // Free/guest tier support: a `tier` column on enrollments, and a nullable
  // cohort_id so self-serve free (non-member) accounts can exist without a
  // cohort. Idempotent — both statements are safe to re-run.
  const statements = [
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'member'`,
    `ALTER TABLE enrollments ALTER COLUMN cohort_id DROP NOT NULL`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] free-tier schema stmt skipped:', err?.message);
    }
  }
}

async function ensureEnrollmentColumns() {
  // Drift guard: the Enrollment model has been extended over time (paysimple
  // tracking, intensives, referral, scores, portal token, enrollment_type, …)
  // without a single migration keeping the table in sync, so older/other DBs
  // silently miss columns and every Enrollment SELECT then 500s (e.g. dev1's
  // free-signup was broken by exactly this). Idempotently ensure every non-core
  // nullable model column exists. ADD COLUMN IF NOT EXISTS is a no-op where the
  // column is already present. `tier`/`cohort_id` are handled by
  // ensureFreeTierSchema and `avatar_data_url` by ensurePortalSettingsSchema.
  const statements = [
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS paysimple_invoice_id VARCHAR(255)`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS paysimple_customer_id VARCHAR(255)`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS paysimple_external_id VARCHAR(255)`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS paysimple_payment_id VARCHAR(255)`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS intensives VARCHAR(500)`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS industry_track VARCHAR(100)`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS referral_channel VARCHAR(50)`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2)`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS readiness_score DOUBLE PRECISION`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS prework_score DOUBLE PRECISION`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS attendance_score DOUBLE PRECISION`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS assignment_score DOUBLE PRECISION`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS maturity_level INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS intake_completed BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS intake_data_json JSONB`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS notes TEXT`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS portal_token UUID`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS portal_token_expires_at TIMESTAMPTZ`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS active_project_id UUID`,
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS enrollment_type VARCHAR(20) NOT NULL DEFAULT 'standard'`,
    // Nullable future-dated access gate: an enrollment can be active/paid but have
    // its full-curriculum access deliberately deferred to a later date (e.g. a
    // postponed cohort move) while retaining free-tier portal access in the
    // interim. NULL (the default) means no gate — behavior for every existing
    // enrollment is unchanged. See contentEntitlement.ts.
    `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS access_starts_at DATE`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] enrollment-columns schema stmt skipped:', err?.message);
    }
  }
}

async function ensureAiEventsSchema() {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS ai_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id UUID,
        event_type VARCHAR(50) NOT NULL,
        workflow_id VARCHAR(100),
        agent_id VARCHAR(100),
        actor_type VARCHAR(20),
        user_id VARCHAR(100),
        external_system VARCHAR(40),
        model VARCHAR(100),
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        cost_usd DECIMAL(12,6),
        duration_ms INTEGER,
        outcome VARCHAR(20) NOT NULL DEFAULT 'success',
        error_class VARCHAR(100),
        cache_hit BOOLEAN NOT NULL DEFAULT false,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    for (const idx of ['event_type', 'created_at', 'trace_id', 'model', 'outcome']) {
      await sequelize.query(`CREATE INDEX IF NOT EXISTS ai_events_${idx} ON ai_events(${idx})`);
    }
    console.log('[DB] ai_events schema ensured');
  } catch (err: any) {
    console.warn('[DB] ai_events schema ensure failed:', err?.message);
  }
}

// Explicit migration: ensure composite index for the admin communications
// list endpoint's outcomes subquery. Sync-based index creation is unreliable
// on prod (alter sync hits out-of-shared-memory on 170+ models).
async function ensureCommunicationIndexes() {
  // CONCURRENTLY avoids locking the table during index build — important on
  // prod where interaction_outcomes is write-heavy.
  try {
    await sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interaction_outcomes_lead_channel_created
       ON interaction_outcomes (lead_id, channel, created_at)`
    );
    console.log('[DB] Communication indexes ensured');
  } catch (err: any) {
    console.warn('[DB] Communication index ensure failed:', err?.message);
  }
}

// Explicit migration: ensure Campaign Link Registry columns exist even if alter sync fails
async function ensureCampaignLinkColumns() {
  const columns = [
    { name: 'channel', sql: "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS channel VARCHAR(30)" },
    { name: 'destination_path', sql: "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS destination_path VARCHAR(255)" },
    { name: 'tracking_link', sql: "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tracking_link VARCHAR(500)" },
    { name: 'objective', sql: "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS objective TEXT" },
    { name: 'approval_status', sql: "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) DEFAULT 'draft'" },
    { name: 'approved_by', sql: "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_by UUID" },
    { name: 'approved_at', sql: "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ" },
    { name: 'budget_cap', sql: "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS budget_cap DECIMAL(10,2)" },
    { name: 'cost_per_lead_target', sql: "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cost_per_lead_target DECIMAL(10,2)" },
    { name: 'expected_roi', sql: "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS expected_roi DECIMAL(8,2)" },
  ];
  for (const col of columns) {
    try {
      await sequelize.query(col.sql);
    } catch (err: any) {
      if (!err.message?.includes('already exists')) {
        console.warn(`[DB] Failed to ensure column ${col.name}:`, err.message);
      }
    }
  }
  console.log('[DB] Campaign link registry columns ensured');
}

// Missed Opportunities Report schema — explicit idempotent creation because
// alter sync is unreliable on prod (hits pre-existing index conflicts and
// never reaches new models). Mirrors the Sequelize models in
// InboxOpportunityScore / InboxFalseNegativeFeedback / InboxSurfacePreference.
// Experience Builder (Phase 1): promote curriculum_type_definitions into versioned
// AI Components. Additive ALTERs + the component_versions snapshot table. Idempotent.
async function ensureExperienceBuilderSchema() {
  const statements = [
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS design_prompt TEXT`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS category VARCHAR(60)`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ready'`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS learning_objectives JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS architect_domains JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS inputs JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS outputs JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS artifacts_produced JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS evidence_produced JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS portfolio_assets JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS github_assets JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS evaluation_type VARCHAR(20)`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS completion_rules JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS dependencies JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS version_locked BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS renderers JSONB NOT NULL DEFAULT '{}'::jsonb`,
    // Surface placement (Today Timeline v2, Phase 0) — additive/nullable; seeded from the type registry.
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS home_surface VARCHAR(20)`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS feed_mode VARCHAR(20)`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS today_eligible BOOLEAN NOT NULL DEFAULT TRUE`,
    // Curriculum-inclusion approval gate: only approved components may be used by the Curriculum Composer.
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255)`,
    // Seed an initial approved baseline (the core week activities) ONLY on first run —
    // once anything is approved/unapproved by hand, this guard is false and never fights the author.
    `UPDATE curriculum_type_definitions SET approved = TRUE, approved_at = NOW(), approved_by = 'system:baseline'
       WHERE slug IN ('announcement','warmup','video','knowledge_check','deep_dive','prompt_lab',
                      'implementation_task','artifact_submission','reflection','community_discussion',
                      'mock_interview','survey','evaluation','live_class')
       AND NOT EXISTS (SELECT 1 FROM curriculum_type_definitions WHERE approved = TRUE)`,
    `CREATE TABLE IF NOT EXISTS component_analytics (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       component_slug VARCHAR(100) NOT NULL UNIQUE,
       creation_count INTEGER NOT NULL DEFAULT 0,
       runtime_count INTEGER NOT NULL DEFAULT 0,
       avg_runtime_ms INTEGER NOT NULL DEFAULT 0,
       avg_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
       completion_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
       dropoff_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
       avg_rating DOUBLE PRECISION NOT NULL DEFAULT 0,
       prompt_quality DOUBLE PRECISION NOT NULL DEFAULT 0,
       evaluation_quality DOUBLE PRECISION NOT NULL DEFAULT 0,
       github_success_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
       portfolio_success_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
       domain_coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
       seeded BOOLEAN NOT NULL DEFAULT FALSE,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS renderer_prompt TEXT`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS generation_prompt TEXT`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS evaluation_prompt TEXT`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS reflection_prompt TEXT`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS github_prompt TEXT`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS improvement_prompt TEXT`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS preview_examples JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS variable_keys JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS est_input_tokens INTEGER`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS est_output_tokens INTEGER`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS est_cost_usd DOUBLE PRECISION`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS est_runtime_ms INTEGER`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS component_version INTEGER NOT NULL DEFAULT 1`,
    `CREATE TABLE IF NOT EXISTS component_versions (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       component_slug VARCHAR(100) NOT NULL,
       version INTEGER NOT NULL,
       snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
       label VARCHAR(255),
       author VARCHAR(255),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_component_versions_slug_version ON component_versions (component_slug, version)`,
    `CREATE INDEX IF NOT EXISTS idx_component_versions_slug ON component_versions (component_slug)`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] Experience Builder schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] Experience Builder schema ensured');
}

// Network Video Library — the ColaberryTV testimonial/marketing/motivational
// catalog (network_videos) + a per-enrollment anti-repeat ledger
// (network_video_views). Powers the Testimonials type's random personalized
// mode. See docs/NETWORK_VIDEO_LIBRARY.md and scripts/ingestNetworkVideos.js.
async function ensureNetworkVideoSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS network_videos (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       source VARCHAR(64) NOT NULL DEFAULT 'colaberrytv',
       external_source_id INTEGER,
       category VARCHAR(64) NOT NULL,
       title TEXT,
       description TEXT,
       host VARCHAR(32),
       provider_video_id VARCHAR(160),
       embed_url TEXT,
       watch_url TEXT,
       original_url TEXT,
       thumbnail_url TEXT,
       duration_seconds INTEGER,
       tags JSONB NOT NULL DEFAULT '[]'::jsonb,
       playable BOOLEAN NOT NULL DEFAULT TRUE,
       needs_attention TEXT,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (source, external_source_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_network_videos_active_cat ON network_videos (category) WHERE is_active`,
    `CREATE INDEX IF NOT EXISTS idx_network_videos_tags ON network_videos USING gin (tags)`,
    `CREATE TABLE IF NOT EXISTS network_video_views (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       video_id UUID NOT NULL REFERENCES network_videos(id) ON DELETE CASCADE,
       category VARCHAR(64),
       first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       seen_count INTEGER NOT NULL DEFAULT 1,
       last_timeline_card_id UUID,
       context JSONB NOT NULL DEFAULT '{}'::jsonb,
       UNIQUE (enrollment_id, video_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_nvv_enrollment_cat ON network_video_views (enrollment_id, category)`,
    `CREATE INDEX IF NOT EXISTS idx_nvv_enrollment_card ON network_video_views (enrollment_id, last_timeline_card_id)`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] Network Video schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] Network Video schema ensured');
}

// Podcast catalog + per-student listen ledger (Podcast type's random personalized mode,
// see podcastMediaService). Boot has no global sequelize.sync, so the tables are ensured
// here from the Sequelize models themselves (single schema source; CREATE IF NOT EXISTS).
// Order matters: podcast_views references podcasts(id).
async function ensurePodcastSchema() {
  try {
    const { Podcast, PodcastView } = await import('./models');
    await Podcast.sync();
    await PodcastView.sync();
    // Default Studio thumbnail for the Podcast type (the show's channel artwork) —
    // ONLY when unset, so anything an admin sets in the Experience Studio wins.
    await sequelize.query(
      `UPDATE curriculum_type_definitions
          SET thumbnail_url = :art
        WHERE slug = 'podcast' AND (thumbnail_url IS NULL OR thumbnail_url = '')`,
      { replacements: { art: 'https://storage.buzzsprout.com/um2agaid5j7zpurbt3t3e74b67wg?.jpg' } },
    );
    console.log('[DB] Podcast schema ensured');
  } catch (err: any) {
    console.warn('[DB] Podcast schema ensure failed:', err.message?.split('\n')[0]);
  }
}

// "Recommend a friend" onboarding step — one row per friend recommended. Model is
// the schema contract; targeted sync creates the table if missing (boot has no
// global sync).
async function ensureFriendReferralSchema() {
  try {
    const { FriendReferral } = await import('./models');
    await FriendReferral.sync();
    // .sync() only CREATEs a missing table — it does not backfill indexes onto a
    // table that already exists (this one shipped to dev before the unique
    // constraint below was added). Add it explicitly, idempotently, so
    // submitReferrals()'s ignoreDuplicates bulkCreate has a real constraint to
    // conflict against on every environment, not just fresh ones.
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS friend_referrals_enrollment_email_uidx
         ON friend_referrals (enrollment_id, friend_email)`,
    );
    console.log('[DB] FriendReferral schema ensured');
  } catch (err: any) {
    console.warn('[DB] FriendReferral schema ensure failed:', err.message?.split('\n')[0]);
  }
}

// Sponsor portal magic-link audit trail (STORY-001). Append-only; the model is
// the schema contract and targeted sync creates the table if missing, since
// boot runs no global sync. Non-fatal on failure: an unavailable audit table
// must not stop the API from booting, and every audit write is best-effort.
async function ensureSponsorPortalAuditSchema() {
  try {
    const { SponsorPortalAuditLog } = await import('./models');
    await SponsorPortalAuditLog.sync();
    console.log('[DB] Sponsor portal audit schema ensured');
  } catch (err: any) {
    console.warn('[DB] Sponsor portal audit schema ensure failed:', err.message?.split('\n')[0]);
  }
}

// Per-card student comments (Runtime workspace, newest-first). Model is the schema
// contract; targeted sync creates the table if missing (boot has no global sync).
async function ensureCardCommentsSchema() {
  try {
    const { TimelineCardComment } = await import('./models');
    await TimelineCardComment.sync();
    console.log('[DB] Card comments schema ensured');
  } catch (err: any) {
    console.warn('[DB] Card comments schema ensure failed:', err.message?.split('\n')[0]);
  }
}

// Weekly feedback Survey answers — one row per (card, enrollment); idempotent
// create + unique index so a re-submit upserts. Boot runs no global sync.
async function ensureSurveyResponsesSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS timeline_survey_responses (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       card_id UUID NOT NULL,
       enrollment_id UUID NOT NULL,
       program_id UUID,
       week INTEGER,
       answers JSONB NOT NULL DEFAULT '{"items":[],"open":null}'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS timeline_survey_responses_unique ON timeline_survey_responses (card_id, enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_survey_responses_program_week ON timeline_survey_responses (program_id, week)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] survey responses schema stmt skipped:', err?.message);
    }
  }
}

// Reflection entries — per-student strategic signals captured by the weekly
// "Week in Review" Reflection card (readiness, application, direction, + a JSONB
// catch-all). One row per (card, enrollment), upserted on re-submit. Sibling of
// ensureSurveyResponsesSchema.
async function ensureReflectionEntriesSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS reflection_entries (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       card_id UUID NOT NULL,
       enrollment_id UUID NOT NULL,
       program_id UUID,
       week INTEGER,
       readiness INTEGER,
       application VARCHAR(64),
       direction VARCHAR(64),
       note TEXT,
       answers JSONB NOT NULL DEFAULT '{}'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS reflection_entries_unique ON reflection_entries (card_id, enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reflection_entries_program_week ON reflection_entries (program_id, week)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] reflection entries schema stmt skipped:', err?.message);
    }
  }
}

// Assessment attempts — per-student Knowledge Check (quiz) + Evaluation attempts:
// score, per-question responses, per-competency breakdown, 75% pass gate, and the
// program_id+week keys that pair a section's quiz (beginning) with its evaluation
// (current) for pre/post growth. Sibling of ensureSurveyResponsesSchema.
async function ensureAssessmentSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS runtime_assessment_attempts (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       card_id UUID NOT NULL,
       program_id UUID,
       week INTEGER,
       kind VARCHAR(20) NOT NULL DEFAULT 'quiz',
       score DOUBLE PRECISION NOT NULL DEFAULT 0,
       correct_count INTEGER NOT NULL DEFAULT 0,
       total_count INTEGER NOT NULL DEFAULT 0,
       passed BOOLEAN,
       pass_threshold DOUBLE PRECISION,
       attempt_number INTEGER NOT NULL DEFAULT 1,
       duration_ms INTEGER,
       responses JSONB NOT NULL DEFAULT '[]'::jsonb,
       competency_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
       started_at TIMESTAMPTZ,
       submitted_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_assess_enrollment_card ON runtime_assessment_attempts (enrollment_id, card_id)`,
    `CREATE INDEX IF NOT EXISTS idx_assess_section ON runtime_assessment_attempts (enrollment_id, program_id, week, kind)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] assessment schema stmt skipped:', err?.message);
    }
  }
}

// Blog library (training.colaberry.com/blog) + per-student read ledger — powers the
// Blog type's auto-match mode (see blogMediaService / blogIngestionService). Raw
// idempotent DDL with DB-side defaults, sibling of ensureNetworkVideoSchema.
// Order matters: blog_post_views references blog_posts(id).
async function ensureBlogSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS blog_posts (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       source VARCHAR(64) NOT NULL DEFAULT 'training-blog',
       slug VARCHAR(300) NOT NULL UNIQUE,
       title TEXT,
       excerpt TEXT,
       author VARCHAR(200),
       url TEXT,
       thumbnail_url TEXT,
       published_at TIMESTAMPTZ,
       hubspot_post_id VARCHAR(64),
       tags JSONB NOT NULL DEFAULT '[]'::jsonb,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_blog_posts_active ON blog_posts (is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_blog_posts_tags ON blog_posts USING gin (tags)`,
    `CREATE TABLE IF NOT EXISTS blog_post_views (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       blog_post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
       first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       seen_count INTEGER NOT NULL DEFAULT 1,
       last_timeline_card_id UUID,
       context JSONB NOT NULL DEFAULT '{}'::jsonb,
       UNIQUE (enrollment_id, blog_post_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_bpv_enrollment ON blog_post_views (enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bpv_enrollment_card ON blog_post_views (enrollment_id, last_timeline_card_id)`,
    // read_state drives the blog 2-minute read gate (continuous dwell → collect points)
    `ALTER TABLE blog_post_views ADD COLUMN IF NOT EXISTS read_state JSONB NOT NULL DEFAULT '{}'::jsonb`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] Blog schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] Blog schema ensured');
}

// AI News Flash intelligence pipeline — the library table behind the news feed.
// Idempotent DDL, DB-side defaults; the ingestion service upserts by guid.
async function ensureAiNewsSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS ai_news_items (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       guid VARCHAR(200) NOT NULL UNIQUE,
       source VARCHAR(80) NOT NULL,
       title TEXT NOT NULL,
       url TEXT,
       excerpt TEXT,
       published_at TIMESTAMPTZ,
       importance INTEGER NOT NULL DEFAULT 0,
       summary_json JSONB,
       card_id UUID,
       first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_news_importance ON ai_news_items (importance DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_news_card ON ai_news_items (card_id)`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] AI News schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] AI News schema ensured');
}

// Today Timeline v2 (Phase 1): per-student append-only feed sequence backing the
// never-ending engagement feed. Deterministic pagination + interact-to-hide;
// sibling of the *_views ledgers. Idempotent DDL, DB-side defaults.
async function ensureTodayFeedSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS today_feed_impressions (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       position INTEGER NOT NULL,
       kind VARCHAR(12) NOT NULL,
       ref TEXT NOT NULL,
       provider VARCHAR(20),
       card_id UUID,
       item JSONB NOT NULL DEFAULT '{}'::jsonb,
       served_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       interacted_at TIMESTAMPTZ,
       interaction VARCHAR(16),
       UNIQUE (enrollment_id, position)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_tfi_enrollment_ref ON today_feed_impressions (enrollment_id, ref)`,
    `CREATE INDEX IF NOT EXISTS idx_tfi_enrollment_pos ON today_feed_impressions (enrollment_id, position)`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] Today feed schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] Today feed schema ensured');
}

// Feed Control plane — additive per-card + per-type routing/cadence columns.
// `priority` + `release_date` already exist on timeline_cards (activated here);
// these add the surface override + cadence/frequency/pin knobs. All nullable →
// a card/type with no override falls back to its type default then the policy.
async function ensureFeedControlSchema() {
  const statements = [
    `ALTER TABLE timeline_cards ADD COLUMN IF NOT EXISTS feed_surface VARCHAR(20)`,
    `ALTER TABLE timeline_cards ADD COLUMN IF NOT EXISTS feed_cadence INTEGER`,
    `ALTER TABLE timeline_cards ADD COLUMN IF NOT EXISTS feed_frequency_cap INTEGER`,
    `ALTER TABLE timeline_cards ADD COLUMN IF NOT EXISTS feed_cooldown_days INTEGER`,
    `ALTER TABLE timeline_cards ADD COLUMN IF NOT EXISTS pinned_until TIMESTAMPTZ`,
    `CREATE INDEX IF NOT EXISTS idx_tc_priority ON timeline_cards (priority DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_tc_pinned ON timeline_cards (pinned_until)`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS feed_cadence INTEGER`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS feed_frequency_cap INTEGER`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS feed_cooldown_days INTEGER`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] Feed control schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] Feed control schema ensured');
}

// Enhance the existing (stub) `testimonial` curriculum type into the working
// "Testimonials" type: relabel, publish its link-vs-random settings schema, and
// mark it approved for the Composer. Idempotent; runs after the type is seeded.
async function seedTestimonialType() {
  const settingsSchema = {
    mode: {
      type: 'enum', values: ['link', 'random'], default: 'link', label: 'Source',
      help: 'Link = play one specific pasted video. Random = pick a matched testimonial per student (personalized, non-repeating).',
    },
    testimonial_category: { type: 'string', default: 'testimonial', label: 'Library category' },
  };
  try {
    await sequelize.query(
      `UPDATE curriculum_type_definitions
          SET label='Testimonials', student_label='Testimonials', render_band='media',
              is_active=TRUE, settings_schema = :schema::jsonb
        WHERE slug='testimonial'`,
      { replacements: { schema: JSON.stringify(settingsSchema) } },
    );
  } catch (err: any) { console.warn('[DB] Testimonials type seed failed:', err.message?.split('\n')[0]); }
  try {
    await sequelize.query(
      `UPDATE curriculum_type_definitions
          SET approved=TRUE, approved_at=NOW(), approved_by=COALESCE(approved_by,'system:testimonials')
        WHERE slug='testimonial' AND approved IS DISTINCT FROM TRUE`,
    );
  } catch { /* approved column absent on old schemas — non-fatal */ }
  console.log('[DB] Testimonials type ensured');
}

async function ensureTimelineEngineSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS timeline_cards (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       type VARCHAR(100) NOT NULL,
       title VARCHAR(500) NOT NULL,
       subtitle VARCHAR(500),
       description TEXT,
       week INTEGER,
       bucket VARCHAR(20) NOT NULL DEFAULT 'learn',
       event_id UUID,
       session_id UUID,
       visibility VARCHAR(20) NOT NULL DEFAULT 'draft',
       release_date TIMESTAMPTZ,
       unlock_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
       completion_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
       estimated_time INTEGER,
       difficulty VARCHAR(20) NOT NULL DEFAULT 'core',
       priority INTEGER NOT NULL DEFAULT 0,
       points JSONB NOT NULL DEFAULT '{}'::jsonb,
       competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
       ref_kind VARCHAR(20) NOT NULL DEFAULT 'none',
       ref_id UUID,
       prompt_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
       variable_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
       creates_variable_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
       artifact_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
       github JSONB NOT NULL DEFAULT '{}'::jsonb,
       ai_actions JSONB NOT NULL DEFAULT '{}'::jsonb,
       status VARCHAR(20) NOT NULL DEFAULT 'active',
       cohort_id UUID,
       program_id UUID,
       "order" INTEGER NOT NULL DEFAULT 0,
       metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_cards_cohort_seq ON timeline_cards (cohort_id, week, bucket, "order")`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_cards_type ON timeline_cards (type)`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_cards_event ON timeline_cards (event_id)`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_cards_session ON timeline_cards (session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_cards_visibility ON timeline_cards (visibility)`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_cards_ref ON timeline_cards (ref_kind, ref_id)`,

    `CREATE TABLE IF NOT EXISTS timeline_card_progress (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       card_id UUID NOT NULL,
       enrollment_id UUID NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'locked',
       student_progress JSONB,
       evidence JSONB,
       analytics JSONB,
       quiz_score DOUBLE PRECISION,
       attempts INTEGER NOT NULL DEFAULT 0,
       started_at TIMESTAMPTZ,
       completed_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_progress_card_enrollment ON timeline_card_progress (card_id, enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_progress_enrollment ON timeline_card_progress (enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_progress_status ON timeline_card_progress (status)`,

    `CREATE TABLE IF NOT EXISTS timeline_events (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       cohort_id UUID,
       slug VARCHAR(100) NOT NULL,
       title VARCHAR(500) NOT NULL,
       description TEXT,
       week INTEGER,
       event_date DATE,
       session_id UUID,
       card_template_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
       metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_events_cohort_week ON timeline_events (cohort_id, week)`,
    `CREATE INDEX IF NOT EXISTS idx_timeline_events_slug ON timeline_events (slug)`,

    // Per-(program, section/bucket) gating rules — see timelineGatingService.
    `CREATE TABLE IF NOT EXISTS timeline_section_rules (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       program_id UUID NOT NULL,
       bucket VARCHAR(20) NOT NULL,
       rules JSONB NOT NULL DEFAULT '[]'::jsonb,
       active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_section_rules_program_bucket ON timeline_section_rules (program_id, bucket)`,

    `CREATE TABLE IF NOT EXISTS points_config (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       scope VARCHAR(30) NOT NULL,
       key VARCHAR(150) NOT NULL,
       learning_xp INTEGER,
       builder_xp INTEGER,
       community_xp INTEGER,
       config JSONB NOT NULL DEFAULT '{}'::jsonb,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_points_config_scope_key ON points_config (scope, key)`,
    `CREATE INDEX IF NOT EXISTS idx_points_config_active ON points_config (is_active)`,

    // Extend curriculum_type_definitions with the registry metadata (additive).
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS bucket_default VARCHAR(30)`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS render_band VARCHAR(60)`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS learning_xp INTEGER`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS builder_xp INTEGER`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS community_xp INTEGER`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS estimated_time INTEGER`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20)`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS competencies JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS evidence_required BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS github_required BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS ai_evaluation BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS instructor_review BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS portfolio_eligible BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE curriculum_type_definitions ADD COLUMN IF NOT EXISTS certification_mapping JSONB NOT NULL DEFAULT '{}'::jsonb`,

    // ── Progression (Phase 2) ──────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS competency_domains (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       program_id UUID,
       domain_id VARCHAR(60) NOT NULL,
       name VARCHAR(150) NOT NULL,
       description TEXT,
       confidence_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.7,
       weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_competency_domains_prog_domain ON competency_domains (program_id, domain_id)`,

    `CREATE TABLE IF NOT EXISTS student_competency (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       domain_id VARCHAR(60) NOT NULL,
       confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
       evidence_count INTEGER NOT NULL DEFAULT 0,
       last_evidence_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_student_competency_enrollment_domain ON student_competency (enrollment_id, domain_id)`,

    `CREATE TABLE IF NOT EXISTS evidence_records (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       card_id UUID,
       source_type VARCHAR(30) NOT NULL,
       source_ref VARCHAR(255),
       competency_weights JSONB NOT NULL DEFAULT '[]'::jsonb,
       builder_xp INTEGER NOT NULL DEFAULT 0,
       validated BOOLEAN NOT NULL DEFAULT TRUE,
       idempotency_key VARCHAR(255) NOT NULL UNIQUE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_evidence_enrollment ON evidence_records (enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_evidence_source ON evidence_records (source_type)`,

    `CREATE TABLE IF NOT EXISTS xp_events (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       stream VARCHAR(20) NOT NULL,
       card_id UUID,
       amount INTEGER NOT NULL DEFAULT 0,
       reason VARCHAR(255),
       idempotency_key VARCHAR(255) NOT NULL UNIQUE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_xp_events_enrollment_stream ON xp_events (enrollment_id, stream)`,

    `CREATE TABLE IF NOT EXISTS builder_levels (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       slug VARCHAR(40) NOT NULL UNIQUE,
       rank INTEGER NOT NULL DEFAULT 0,
       label VARCHAR(80) NOT NULL,
       required_competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
       min_evidence INTEGER NOT NULL DEFAULT 0,
       min_artifacts INTEGER NOT NULL DEFAULT 0,
       min_github INTEGER NOT NULL DEFAULT 0,
       min_evaluations INTEGER NOT NULL DEFAULT 0,
       min_implementation INTEGER NOT NULL DEFAULT 0,
       min_attendance INTEGER NOT NULL DEFAULT 0,
       requires_ai_approval BOOLEAN NOT NULL DEFAULT FALSE,
       is_active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,

    `CREATE TABLE IF NOT EXISTS student_level (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL UNIQUE,
       level_slug VARCHAR(40) NOT NULL DEFAULT 'builder',
       rank INTEGER NOT NULL DEFAULT 0,
       architect_readiness DOUBLE PRECISION NOT NULL DEFAULT 0,
       promotion_evidence JSONB,
       ai_approval JSONB,
       promoted_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn(`[DB] Timeline Engine schema statement failed:`, err.message?.split('\n')[0]);
    }
  }
  console.log('[DB] Timeline Engine schema ensured');
}

async function ensureCurriculumComposerSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS curriculum_blueprints (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       title VARCHAR(500) NOT NULL,
       purpose TEXT,
       problem_statement TEXT,
       target_audience VARCHAR(300),
       program_id UUID,
       cohort_id UUID,
       week INTEGER,
       session VARCHAR(120),
       scope VARCHAR(30) NOT NULL DEFAULT 'week',
       difficulty VARCHAR(20) NOT NULL DEFAULT 'core',
       estimated_hours DOUBLE PRECISION,
       learning_objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
       competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
       architect_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
       session_competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
       bloom JSONB NOT NULL DEFAULT '[]'::jsonb,
       evidence_produced JSONB NOT NULL DEFAULT '[]'::jsonb,
       github_deliverables JSONB NOT NULL DEFAULT '[]'::jsonb,
       portfolio_deliverables JSONB NOT NULL DEFAULT '[]'::jsonb,
       builder_xp INTEGER NOT NULL DEFAULT 0,
       learning_xp INTEGER NOT NULL DEFAULT 0,
       community_xp INTEGER NOT NULL DEFAULT 0,
       architect_readiness DOUBLE PRECISION NOT NULL DEFAULT 0,
       certification_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
       unlock_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
       completion_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
       success_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
       instructor_notes TEXT,
       ai_notes TEXT,
       risk_areas JSONB NOT NULL DEFAULT '[]'::jsonb,
       student_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
       generated_plan JSONB,
       dna JSONB,
       quality_score INTEGER NOT NULL DEFAULT 0,
       coverage_score INTEGER NOT NULL DEFAULT 0,
       readiness_score INTEGER NOT NULL DEFAULT 0,
       status VARCHAR(20) NOT NULL DEFAULT 'draft',
       published_card_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_curriculum_blueprints_status ON curriculum_blueprints (status)`,
    `CREATE INDEX IF NOT EXISTS idx_curriculum_blueprints_week ON curriculum_blueprints (week)`,
    // Additive column for pre-existing tables (session/Academy competencies — see competencyDictionary).
    `ALTER TABLE curriculum_blueprints ADD COLUMN IF NOT EXISTS session_competencies JSONB NOT NULL DEFAULT '[]'::jsonb`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] Curriculum Composer schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] Curriculum Composer schema ensured');
}

async function ensureIntelligenceSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS graph_nodes (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       node_type VARCHAR(40) NOT NULL,
       entity_id VARCHAR(120) NOT NULL,
       label VARCHAR(400) NOT NULL,
       metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
       owner VARCHAR(120),
       trust_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
       status VARCHAR(20) NOT NULL DEFAULT 'active',
       version INTEGER NOT NULL DEFAULT 1,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_nodes_type_entity ON graph_nodes (node_type, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes (node_type)`,
    `CREATE TABLE IF NOT EXISTS graph_edges (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       from_id UUID NOT NULL,
       to_id UUID NOT NULL,
       edge_type VARCHAR(40) NOT NULL,
       strength DOUBLE PRECISION NOT NULL DEFAULT 1,
       confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8,
       evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_triple ON graph_edges (from_id, to_id, edge_type)`,
    `CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges (from_id)`,
    `CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges (to_id)`,
    `CREATE TABLE IF NOT EXISTS graph_events (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       node_id UUID,
       event_type VARCHAR(40) NOT NULL,
       summary VARCHAR(500) NOT NULL,
       actor VARCHAR(120),
       ref VARCHAR(120),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_graph_events_created ON graph_events (created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS decisions (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       title VARCHAR(400) NOT NULL,
       domain VARCHAR(40) NOT NULL,
       reason TEXT,
       evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
       alternatives JSONB NOT NULL DEFAULT '[]'::jsonb,
       expected_outcome VARCHAR(500),
       actual_outcome VARCHAR(500),
       lessons TEXT,
       status VARCHAR(20) NOT NULL DEFAULT 'proposed',
       source_rec_key VARCHAR(120),
       decided_by VARCHAR(120),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions (status)`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] Intelligence schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] Enterprise Intelligence schema ensured');
}

async function ensureWorkforceSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS workforce_tasks (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       employee_slug VARCHAR(40) NOT NULL,
       title VARCHAR(400) NOT NULL,
       description TEXT,
       status VARCHAR(20) NOT NULL DEFAULT 'assigned',
       priority VARCHAR(10) NOT NULL DEFAULT 'medium',
       deadline TIMESTAMPTZ,
       approver VARCHAR(40),
       evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
       source_rec_key VARCHAR(120),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_wf_tasks_employee ON workforce_tasks (employee_slug, status)`,
    `CREATE TABLE IF NOT EXISTS workforce_meetings (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       meeting_date VARCHAR(10) NOT NULL UNIQUE,
       title VARCHAR(200) NOT NULL DEFAULT 'Daily Leadership Meeting',
       agenda JSONB NOT NULL DEFAULT '{}'::jsonb,
       participants JSONB NOT NULL DEFAULT '[]'::jsonb,
       contributions JSONB NOT NULL DEFAULT '[]'::jsonb,
       action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
       notes TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS workforce_memory (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       employee_slug VARCHAR(40) NOT NULL,
       kind VARCHAR(20) NOT NULL DEFAULT 'working',
       content TEXT NOT NULL,
       ref VARCHAR(120),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_wf_memory_employee ON workforce_memory (employee_slug, kind)`,
    `CREATE TABLE IF NOT EXISTS workforce_messages (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       from_slug VARCHAR(40) NOT NULL,
       to_slug VARCHAR(40) NOT NULL,
       subject VARCHAR(300) NOT NULL,
       body TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] Workforce schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] AI Workforce schema ensured');
}

async function ensureOpsCenterSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS ops_recommendations (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       rec_key VARCHAR(120) NOT NULL UNIQUE,
       domain VARCHAR(40) NOT NULL,
       title VARCHAR(400) NOT NULL,
       why TEXT,
       evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
       impact VARCHAR(400),
       confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
       action_type VARCHAR(20) NOT NULL DEFAULT 'open',
       severity VARCHAR(10) NOT NULL DEFAULT 'medium',
       status VARCHAR(20) NOT NULL DEFAULT 'open',
       assigned_to VARCHAR(255),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ops_recs_status ON ops_recommendations (status)`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] Ops Center schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] AI Operations Center schema ensured');
}

async function ensureRuntimeSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS runtime_mentor_turns (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       card_id UUID,
       mode VARCHAR(20) NOT NULL DEFAULT 'ask',
       question TEXT,
       reply TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_mentor_turns_enrollment ON runtime_mentor_turns (enrollment_id, card_id)`,
    `CREATE TABLE IF NOT EXISTS runtime_portfolio_artifacts (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       card_id UUID,
       kind VARCHAR(40) NOT NULL DEFAULT 'case_study',
       title VARCHAR(400) NOT NULL,
       summary TEXT,
       content JSONB NOT NULL DEFAULT '{}'::jsonb,
       competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_portfolio_enrollment ON runtime_portfolio_artifacts (enrollment_id)`,
    `CREATE TABLE IF NOT EXISTS runtime_notes (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       card_id UUID,
       kind VARCHAR(20) NOT NULL DEFAULT 'note',
       title VARCHAR(400),
       body TEXT,
       back TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_runtime_notes_enrollment ON runtime_notes (enrollment_id, kind)`,
    `CREATE TABLE IF NOT EXISTS learner_memory (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL UNIQUE,
       summary TEXT,
       misconceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
       goals TEXT,
       strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
       last_distilled_on DATE,
       last_turn_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_learner_memory_enrollment ON learner_memory (enrollment_id)`,
  ];
  for (const sql of statements) {
    try { await sequelize.query(sql); }
    catch (err: any) { console.warn('[DB] Runtime schema statement failed:', err.message?.split('\n')[0]); }
  }
  console.log('[DB] Learning Runtime schema ensured');
}

async function ensureMissedOpportunitiesSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS inbox_opportunity_scores (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       email_id UUID NOT NULL REFERENCES inbox_emails(id),
       report_date DATE NOT NULL,
       score INTEGER NOT NULL DEFAULT 0,
       band VARCHAR(10) NOT NULL DEFAULT 'low',
       confidence INTEGER NOT NULL DEFAULT 0,
       reason_hidden TEXT,
       hidden_state VARCHAR(20) NOT NULL,
       factors JSONB NOT NULL DEFAULT '[]'::jsonb,
       topics JSONB NOT NULL DEFAULT '[]'::jsonb,
       computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_opp_scores_email_date
       ON inbox_opportunity_scores(email_id, report_date)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_opp_scores_report_date
       ON inbox_opportunity_scores(report_date)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_opp_scores_score
       ON inbox_opportunity_scores(score)`,
    `CREATE TABLE IF NOT EXISTS inbox_false_negative_feedback (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       email_id UUID NOT NULL REFERENCES inbox_emails(id),
       action VARCHAR(30) NOT NULL,
       source VARCHAR(20) NOT NULL DEFAULT 'report',
       score_at_feedback INTEGER,
       created_by VARCHAR(120),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_fn_feedback_email_id
       ON inbox_false_negative_feedback(email_id)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_fn_feedback_action
       ON inbox_false_negative_feedback(action)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_fn_feedback_created_at
       ON inbox_false_negative_feedback(created_at)`,
    `CREATE TABLE IF NOT EXISTS inbox_surface_preferences (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       pattern_type VARCHAR(10) NOT NULL,
       pattern_value VARCHAR(255) NOT NULL,
       source_email_id UUID,
       enabled BOOLEAN NOT NULL DEFAULT true,
       created_by VARCHAR(120),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_surface_pref_pattern
       ON inbox_surface_preferences(pattern_type, pattern_value)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_surface_pref_enabled
       ON inbox_surface_preferences(enabled)`,
    `CREATE TABLE IF NOT EXISTS inbox_deleted_emails (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       provider VARCHAR(20) NOT NULL,
       provider_message_id VARCHAR(255) NOT NULL,
       folder VARCHAR(10) NOT NULL,
       from_address VARCHAR(320) NOT NULL,
       from_name VARCHAR(320),
       to_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
       subject TEXT NOT NULL,
       body_text TEXT,
       body_html TEXT,
       headers JSONB,
       received_at TIMESTAMPTZ NOT NULL,
       discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       has_attachments BOOLEAN NOT NULL DEFAULT false
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_deleted_provider_msg
       ON inbox_deleted_emails(provider, provider_message_id)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_deleted_received_at
       ON inbox_deleted_emails(received_at)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_deleted_folder
       ON inbox_deleted_emails(folder)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      if (!err.message?.includes('already exists')) {
        console.warn('[DB] Failed to ensure Missed Opportunities schema:', err.message);
      }
    }
  }
  console.log('[DB] Missed Opportunities schema ensured');
}

// Colaberry Commons — Community Rooms layer. Explicit idempotent DDL (sync is
// off on this graph). Additive & reversible: new room_* / community_rooms tables
// only, no ALTERs to existing tables. NO cross-table FK constraints (plain UUID
// columns, like student_tasks) so creation ordering never matters. The whole
// feature stays dark behind env.communityRoomsEnabled regardless of these tables.
// Messaging extras (additive, idempotent): a per-member DM read cursor for
// unread state, and a widened community_notifications type CHECK so friend /
// message notifications can be inserted (the column is VARCHAR; only the CHECK
// restricts values). Both safe to run every boot.
async function ensureMessagingSchema() {
  const statements = [
    `ALTER TABLE room_memberships ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ`,
    `ALTER TABLE community_notifications DROP CONSTRAINT IF EXISTS ck_community_notifications_type`,
    `ALTER TABLE community_notifications ADD CONSTRAINT ck_community_notifications_type CHECK (notification_type IN ('mention','reply','like','friend_request','friend_accepted','new_message'))`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      if (!err.message?.includes('already exists')) {
        console.warn('[DB] Failed to ensure messaging schema:', err.message);
      }
    }
  }
  console.log('[DB] Messaging schema ensured');
}

// Friendships — the friend graph behind the portal Contacts rail. Idempotent,
// additive; status is VARCHAR + CHECK (not a Postgres ENUM) so new states are a
// one-line CHECK change, never a type migration. No feature flag.
async function ensureFriendshipSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS friendships (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       requester_id UUID NOT NULL,
       addressee_id UUID NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'pending',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       CONSTRAINT ck_friendships_status CHECK (status IN ('pending','accepted','declined'))
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique ON friendships (requester_id, addressee_id)`,
    `CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id)`,
    `CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requester_id)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      if (!err.message?.includes('already exists')) {
        console.warn('[DB] Failed to ensure Friendship schema:', err.message);
      }
    }
  }
  console.log('[DB] Friendship schema ensured');
}

async function ensureCommunityRoomsSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS community_rooms (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       slug VARCHAR(140) NOT NULL,
       name VARCHAR(200) NOT NULL,
       category VARCHAR(40) NOT NULL DEFAULT 'social',
       room_type VARCHAR(30) NOT NULL DEFAULT 'persistent',
       privacy VARCHAR(20) NOT NULL DEFAULT 'public',
       status VARCHAR(20) NOT NULL DEFAULT 'active',
       description TEXT,
       topic VARCHAR(255),
       capacity INTEGER,
       owner_enrollment_id UUID,
       linked_cohort_id UUID,
       linked_project_id UUID,
       linked_module_id UUID,
       linked_live_session_id UUID,
       is_system BOOLEAN NOT NULL DEFAULT false,
       created_by VARCHAR(60) NOT NULL DEFAULT 'system',
       metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS community_rooms_slug_unique ON community_rooms (slug)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS community_rooms_linked_session_unique ON community_rooms (linked_live_session_id) WHERE linked_live_session_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_community_rooms_cohort ON community_rooms (linked_cohort_id)`,
    `CREATE INDEX IF NOT EXISTS idx_community_rooms_category ON community_rooms (category)`,
    `CREATE INDEX IF NOT EXISTS idx_community_rooms_privacy_status ON community_rooms (privacy, status)`,
    `ALTER TABLE community_rooms ADD COLUMN IF NOT EXISTS is_video BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE community_rooms ADD COLUMN IF NOT EXISTS always_open BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE community_rooms ADD COLUMN IF NOT EXISTS meeting_link VARCHAR(600)`,
    // A room's own logo. Nullable on purpose: most rooms will never have one and
    // an emoji is a perfectly good mark. Additive and idempotent like its
    // neighbours, so an existing deployment gains the column on the next boot
    // with no migration step and no downtime.
    `ALTER TABLE community_rooms ADD COLUMN IF NOT EXISTS icon_url VARCHAR(600)`,

    `CREATE TABLE IF NOT EXISTS room_memberships (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       room_id UUID NOT NULL,
       enrollment_id UUID NOT NULL,
       role VARCHAR(20) NOT NULL DEFAULT 'member',
       access_state VARCHAR(20) NOT NULL DEFAULT 'active',
       notification_pref VARCHAR(20) NOT NULL DEFAULT 'mentions',
       invited_by UUID,
       joined_at TIMESTAMPTZ,
       left_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS room_memberships_unique ON room_memberships (room_id, enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_room_memberships_enrollment ON room_memberships (enrollment_id)`,

    `CREATE TABLE IF NOT EXISTS room_bookings (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       room_id UUID NOT NULL,
       variant VARCHAR(30) NOT NULL DEFAULT 'study',
       title VARCHAR(255) NOT NULL,
       description TEXT,
       outcome TEXT,
       agenda TEXT,
       host_enrollment_id UUID,
       co_hosts JSONB NOT NULL DEFAULT '[]'::jsonb,
       start_at TIMESTAMPTZ,
       end_at TIMESTAMPTZ,
       timezone VARCHAR(60),
       recurrence VARCHAR(40),
       privacy VARCHAR(20) NOT NULL DEFAULT 'public',
       audience_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
       capacity INTEGER,
       approval_required BOOLEAN NOT NULL DEFAULT false,
       meeting_provider VARCHAR(30) NOT NULL DEFAULT 'zoom',
       meeting_link VARCHAR(600),
       google_event_id VARCHAR(255),
       external_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
       related_module_id UUID,
       related_live_session_id UUID,
       related_project_id UUID,
       skill_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
       rsvp_deadline TIMESTAMPTZ,
       reminder_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
       recording_policy VARCHAR(30) NOT NULL DEFAULT 'ask',
       artifact_prompt TEXT,
       reflection_prompt TEXT,
       moderation_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
       state VARCHAR(20) NOT NULL DEFAULT 'draft',
       timeline_published BOOLEAN NOT NULL DEFAULT false,
       timeline_card_id UUID,
       created_by_enrollment_id UUID,
       idempotency_key VARCHAR(160),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS room_bookings_idem_unique ON room_bookings (idempotency_key) WHERE idempotency_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_room_bookings_room ON room_bookings (room_id)`,
    `CREATE INDEX IF NOT EXISTS idx_room_bookings_state_start ON room_bookings (state, start_at)`,
    `CREATE INDEX IF NOT EXISTS idx_room_bookings_related_session ON room_bookings (related_live_session_id)`,

    `CREATE TABLE IF NOT EXISTS room_booking_attendees (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       booking_id UUID NOT NULL,
       enrollment_id UUID NOT NULL,
       rsvp_state VARCHAR(20) NOT NULL DEFAULT 'none',
       approval_state VARCHAR(20) NOT NULL DEFAULT 'auto',
       attended BOOLEAN NOT NULL DEFAULT false,
       attendance_source VARCHAR(20),
       joined_at TIMESTAMPTZ,
       waitlist_position INTEGER,
       feedback_rating INTEGER,
       feedback_text TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS room_booking_attendees_unique ON room_booking_attendees (booking_id, enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_room_booking_attendees_enrollment ON room_booking_attendees (enrollment_id)`,

    `CREATE TABLE IF NOT EXISTS room_messages (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       room_id UUID NOT NULL,
       booking_id UUID,
       enrollment_id UUID,
       sender_name VARCHAR(120) NOT NULL,
       content TEXT NOT NULL,
       thread_root_id UUID,
       kind VARCHAR(20) NOT NULL DEFAULT 'message',
       question_status VARCHAR(20),
       moderation_state VARCHAR(20) NOT NULL DEFAULT 'visible',
       edited_at TIMESTAMPTZ,
       deleted_at TIMESTAMPTZ,
       metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_room_messages_room_created ON room_messages (room_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_room_messages_thread ON room_messages (thread_root_id)`,

    `CREATE TABLE IF NOT EXISTS room_resources (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       room_id UUID NOT NULL,
       booking_id UUID,
       resource_type VARCHAR(20) NOT NULL,
       title VARCHAR(255),
       url VARCHAR(1000),
       body TEXT,
       created_by_enrollment_id UUID,
       is_pinned BOOLEAN NOT NULL DEFAULT false,
       metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_room_resources_room ON room_resources (room_id, resource_type)`,
    // Docs & Files (room_resources 'file' uploads): real files carry their MIME
    // type, byte size, and the disk-resolved storage key (UUID+ext) separately
    // from `url`, which stays reserved for link/recording resource types.
    `ALTER TABLE room_resources ADD COLUMN IF NOT EXISTS mime_type VARCHAR(120)`,
    `ALTER TABLE room_resources ADD COLUMN IF NOT EXISTS size_bytes INTEGER`,
    `ALTER TABLE room_resources ADD COLUMN IF NOT EXISTS storage_key VARCHAR(255)`,

    `CREATE TABLE IF NOT EXISTS room_outbox_events (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       event_type VARCHAR(50) NOT NULL,
       aggregate_type VARCHAR(30) NOT NULL,
       aggregate_id UUID NOT NULL,
       payload JSONB NOT NULL DEFAULT '{}'::jsonb,
       idempotency_key VARCHAR(180) NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'pending',
       attempts INTEGER NOT NULL DEFAULT 0,
       max_attempts INTEGER NOT NULL DEFAULT 6,
       next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_error TEXT,
       correlation_id UUID,
       processed_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS room_outbox_events_idem_unique ON room_outbox_events (idempotency_key)`,
    `CREATE INDEX IF NOT EXISTS idx_room_outbox_ready ON room_outbox_events (status, next_attempt_at)`,
    `CREATE INDEX IF NOT EXISTS idx_room_outbox_aggregate ON room_outbox_events (aggregate_type, aggregate_id)`,

    `CREATE TABLE IF NOT EXISTS room_reports (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       reporter_enrollment_id UUID NOT NULL,
       target_type VARCHAR(20) NOT NULL,
       target_id UUID NOT NULL,
       reason VARCHAR(60) NOT NULL,
       detail TEXT,
       status VARCHAR(20) NOT NULL DEFAULT 'open',
       resolution TEXT,
       resolved_by VARCHAR(60),
       resolved_at TIMESTAMPTZ,
       idempotency_key VARCHAR(180),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS room_reports_idem_unique ON room_reports (idempotency_key) WHERE idempotency_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_room_reports_status ON room_reports (status)`,

    `CREATE TABLE IF NOT EXISTS room_presence (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       room_id UUID NOT NULL,
       enrollment_id UUID NOT NULL,
       in_video BOOLEAN NOT NULL DEFAULT false,
       last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS room_presence_unique ON room_presence (room_id, enrollment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_room_presence_room_seen ON room_presence (room_id, last_seen_at)`,

    `CREATE TABLE IF NOT EXISTS community_contributions (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       enrollment_id UUID NOT NULL,
       category VARCHAR(30) NOT NULL,
       action VARCHAR(40) NOT NULL,
       points INTEGER NOT NULL DEFAULT 0,
       room_id UUID,
       booking_id UUID,
       message_id UUID,
       idempotency_key VARCHAR(180) NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS community_contributions_idem_unique ON community_contributions (idempotency_key)`,
    `CREATE INDEX IF NOT EXISTS idx_community_contributions_enrollment_cat ON community_contributions (enrollment_id, category)`,
  ];
  for (const sql of statements) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      if (!err.message?.includes('already exists')) {
        console.warn('[DB] Failed to ensure Community Rooms schema:', err.message);
      }
    }
  }
  console.log('[DB] Community Rooms schema ensured');
}

async function start(): Promise<void> {
  // Ensure uploads directory exists
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  await connectDatabase();

  // Migrate mini_section_type from ENUM to VARCHAR for dynamic curriculum types
  try {
    await sequelize.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'enum_mini_sections_mini_section_type'
        ) THEN
          ALTER TABLE mini_sections ALTER COLUMN mini_section_type TYPE VARCHAR(100) USING mini_section_type::VARCHAR;
          DROP TYPE IF EXISTS "enum_mini_sections_mini_section_type";
          RAISE NOTICE 'Migrated mini_section_type ENUM -> VARCHAR';
        END IF;
      END $$;
    `);
  } catch (err: any) {
    console.warn('[DB] mini_section_type ENUM migration skipped:', err?.message);
  }

  // Ingestion schema first — so the leads.source_id FK can resolve during alter sync.
  await ensureIngestionSchema();
  // Phase 2 (T226): routing_rules.version + routing_rule_executions. Must follow
  // ensureIngestionSchema, which creates the table the ALTER names.
  await ensureRoutingAuditSchema();
  // Ops Command Center schema — explicit creation because alter sync hits
  // pre-existing index conflicts elsewhere and never reaches the ops_* models.
  await ensureOpsCommandCenterSchema();
  // Missed Opportunities Report schema (idempotent, before alter sync).
  await ensureMissedOpportunitiesSchema();
  // AI events telemetry table (TBI audit P1) — explicit because prod does not run sync.
  await ensureAiEventsSchema();
  // Free/guest tier: enrollments.tier column + nullable cohort_id (idempotent).
  await ensureFreeTierSchema();
  // Drift guard: ensure every extended enrollments column exists (idempotent).
  await ensureEnrollmentColumns();
  // Student points ledger (idempotent).
  await ensurePointsSchema();
  // Live Sessions build-out: 5 live-session tables (idempotent DDL, sync is disabled).
  await ensureLiveSessionSchema();
  // Inbox Intel — Case Resolution Engine: 6 case-resolution tables (idempotent DDL).
  await ensureInboxCaseSchema();
  // /inbox-zero commitment ledger (what Ali owes). Depends on inbox_cases above.
  await ensureInboxCommitmentSchema();
  await ensureLeadViewPreferenceSchema();
  await ensureScholarshipInterviewSchema();
  // ProofDesk Work Ledger — Milestone 1 (Foundation): 4 ledger tables + 12 additive
  // nullable ticket columns (idempotent DDL, shadow mode).
  await ensureWorkLedgerSchema();
  // Explorer Growth OS — EPIC 1 (Foundation): 5 tables for the learner decision
  // layer (idempotent DDL, additive only). Nothing reads or writes them until the
  // EXPLORER_GROWTH_OS_ENABLED flag is on, which it is not by default.
  await ensureExplorerGrowthSchema();
  // D1 fix: page_events.lead_id. contextGraphService has always queried this
  // column and it has never existed, so buildCompositeContext() throws and every
  // campaign email silently falls back to the legacy prompt. Additive + nullable.
  await ensurePageEventLeadId();
  // ProofDesk Evidence — Milestone 2 (Proof & Ticket Experience): 3 evidence/decision
  // tables (idempotent DDL, additive only, no binary storage).
  await ensureEvidenceSchema();
  // Case Study OS: 10 tables for the canonical, GitHub-fed, evidence-aware Case
  // Study domain that backs /stories. Placed after ensureEvidenceSchema because it
  // references evidence_records and runtime_portfolio_artifacts by id (as bare
  // UUID columns, not FKs — see that module's header for why). The assert is not
  // decoration: every statement in the ensure step is swallowed into a
  // console.warn, so ensure resolving proves nothing about whether the tables
  // exist. Non-fatal by design, matching every other schema step here — a failed
  // post-check must not take the whole API down, it must be loud in the logs.
  await ensureCaseStudySchema();
  await assertCaseStudySchema();
  // Story Studio assets: 4 tables (storylines, AI drafts, quotes, charts). A
  // peer module rather than four more statements in ensureCaseStudySchema,
  // which is already 508 lines against the 500 ceiling AND is read as source
  // text by two guard suites that pin its table count and column total. Same
  // ensure-then-assert shape and the same non-fatal posture: a failed post-check
  // must be loud in the logs, never take the API down.
  await ensureCaseStudyStoryAssets();
  await assertCaseStudyStoryAssets();
  // Ticket Board Performance fix (2026-08-18): idx_tickets_created_at +
  // idx_tickets_status_created_at, CONCURRENTLY (tickets is write-heavy). Powers the
  // new "last 7 days" default board view. See ensureTicketIndexesSchema.ts header.
  await ensureTicketIndexesSchema();
  // Session-reminder arming columns on live_sessions. Must be ensured before the
  // reminder cron starts, or the sweep falls back to re-sending on every deploy.
  await ensureSessionReminderSchema();
  await ensureEnrollmentNotificationSchema();
  // ProofDesk Work Graph — Milestone 3 (Multi-Agent Work Graph): 3 work-graph tables
  // + FK from M1's pre-existing work_ledger_events.work_unit_id (idempotent DDL,
  // additive only).
  await ensureWorkGraphSchema();
  // Reese Agentic Employee & Manager Workspace, Phase 1, R12 — 3 new nullable/
  // defaulted columns on ticket_work_units (plan_version/next_wakeup_at/
  // attempt_count), schema-only, nothing reads or writes them yet.
  await ensureAgentWorkLifecycleFieldsSchema();
  // ProofDesk Governance — Milestone 4 (Governance Enforcement, SHADOW MODE ONLY):
  // approval_requests table + FK from M1's pre-existing
  // work_ledger_events.authorization_decision_id (idempotent DDL, additive only).
  // Nothing that reads this table gates a real action yet — see
  // agentActionAuthorizationBridge.ts's header.
  await ensureApprovalRequestsSchema();
  // Business accounts: organizations.status / status_changed_at / status_changed_by /
  // lead_id, plus the org_cohorts join table (idempotent DDL, additive only).
  // Before this, `organizations` had no lifecycle column, so an account could not be
  // suspended without deleting the row and cascading its members away; and there was
  // no org<->cohort relationship anywhere in the schema.
  await ensureOrgAccountSchema();
  // Multi-tenant ecosystem foundation: 9 new tables (tenants, brands, brand_domains,
  // sender_profiles, platform_identities, platform_identity_links, tenant_memberships,
  // lead_tenant_contexts, communication_preferences) plus additive nullable tenancy
  // columns on lead_sources, entry_points, visitor_sessions, page_events, campaigns,
  // follow_up_sequences, organizations, org_members and event_ledger.
  //
  // Runs AFTER ensureOrgAccountSchema because it adds columns to `organizations` and
  // `org_members`, and BEFORE anything that reads tenancy, because a missing table here
  // degrades context resolution to null rather than failing — which is the intended
  // behaviour for tracking but would silently unscope an admin read if the ordering
  // were reversed. Additive only; no NOT NULL, no backfill (backfills are separate
  // explicitly-invoked scripts, never boot work).
  await ensureMultiTenantSchema();
  // Growth Journey OS — Phase 1: journey_programs and journey_paths, the shared
  // framework Explorer Growth becomes the first program on.
  //
  // MUST run after ensureMultiTenantSchema, and this ordering is load-bearing rather
  // than tidy: journey_programs carries foreign keys to tenants(id) and brands(id), and
  // ensureMultiTenantSchema is what creates both. Registering it beside
  // ensureExplorerGrowthSchema (line 2444) would reference tables that do not exist yet
  // — and because each statement is individually caught, that failure surfaces as a
  // console warning at boot, not a crash. The tables would simply be absent until
  // something queried them.
  //
  // Additive only. Creates two tables; alters nothing. Nothing reads them until the
  // Growth Journey flags are set, which they are not.
  await ensureGrowthJourneySchema();
  // Refactored AI Delivery OS — Gate 1: 7 delivery tables (engagements, projects, the
  // student-project bridge, project membership, contracts, the decision ledger and the
  // append-only event stream), plus the ESC-1 relaxation of
  // `organizations.owner_enrollment_id` to nullable.
  //
  // Runs LAST of the organization-touching modules, and that ordering is load-bearing.
  // Two earlier statements recreate `organizations` with `owner_enrollment_id UUID NOT
  // NULL` on a fresh database (the inline DDL above, and ensureOrgAccountSchema). Both
  // are CREATE TABLE IF NOT EXISTS, so on an existing database they are no-ops and the
  // ordering is irrelevant — but on a fresh one (dev, preview stacks, CI) the DROP NOT
  // NULL has to come after them or a brand-new environment would silently keep the
  // constraint that blocks client organizations, and the failure would only appear the
  // first time somebody created one.
  //
  // Additive apart from that single relaxation; no backfill beyond stamping
  // organization_type on rows that predate the column.
  await ensureRefactoredDeliverySchema();
  await ensureCareerPublicationSchema();
  // ProofDesk Outcomes & Learning — Milestone 5: 1 outcome_measurements table
  // (idempotent DDL, additive only). Scheduled by ticketService.ts's done-hook,
  // processed by schedulerService.ts's daily cron.
  await ensureOutcomeMeasurementsSchema();
  // Marketing Operations — tracked links and click capture: 2 new tables
  // (tracked_links, link_clicks), idempotent DDL, additive only.
  //
  // Runs AFTER ensureMultiTenantSchema because tracked_links.tenant_id is NOT NULL and
  // the brands/tenants it scopes to must exist first on a fresh database. It carries no
  // foreign keys, so this ordering is about a coherent fresh-boot rather than a
  // constraint — but a preview stack or CI database built in the other order would
  // create links pointing at tenants that do not exist yet.
  await ensureMarketingTrackingSchema();
  // Marketing Operations — campaign planning + taxonomy columns on the EXISTING campaigns
  // table (funnel stage, owner/approver, planned window, canonical utm slug, typed goals,
  // parent rollup, archival). Additive only; nothing NOT NULL, no backfill.
  //
  // Ordering is load-bearing: its unique index is on `(tenant_id, utm_campaign_slug)`, and
  // `campaigns.tenant_id` is itself added by ensureMultiTenantSchema() above. On a fresh
  // database built in the other order the index creation would fail — and because these
  // loops only warn, it would fail SILENTLY, leaving slug collisions possible in production.
  await ensureMarketingCampaignSchema();
  // Marketing Operations - Content OS: 7 new tables (content items, platform variants, the
  // media library and its join, versioned templates, and a REAL content approval gate with
  // an append-only event trail). Additive only.
  //
  // Runs AFTER ensureMarketingCampaignSchema because content_items.campaign_id points at
  // campaigns, and after ensureMultiTenantSchema for tenant_id/brand_id. Those two columns
  // are bare UUIDs with no FK, so this ordering is about a coherent fresh boot rather than a
  // constraint - but a preview stack or CI database built in the other order would create
  // content rows referring to campaigns and tenants that do not exist yet.
  await ensureContentOsSchema();
  // Marketing Operations - publishing queue: 3 new tables (jobs with a REAL publish_at,
  // external publication receipts, and an append-only redacted provider event stream).
  //
  // Runs AFTER ensureContentOsSchema: publishing_jobs carries real FKs to content_items and
  // content_variants, so unlike the earlier orderings in this subsystem this one is a genuine
  // constraint, not just fresh-boot coherence. Built in the wrong order the CREATE TABLE
  // fails - and because the loop only warns, it fails silently.
  await ensurePublishingSchema();
  // Marketing Operations - the attribution fields that were being validated and discarded:
  // utm_term and utm_content (packed into strapi_attribution JSONB, unqueryable) and the four
  // platform click IDs (absent from the codebase entirely). Additive columns on the LIVE
  // visitor_sessions table; nothing NOT NULL, no backfill.
  await ensureMarketingAttributionSchema();
  // Versioned per-brand governance rules (T022). Rows, not a column, so an approval given
  // under version N can still be read against what N said after N+1 is published.
  await ensureBrandGovernanceSchema();
  // After brand governance: the FK it adds to content_variants needs the accounts table, and
  // the accounts table references brands.
  await ensureChannelAccountSchema();
  // CAPE (Colaberry Adaptive Path Engine) Phase 0-1 — skill ontology, evidence-band
  // weights, append-only skill-evidence ledger, derived skill state (idempotent DDL,
  // additive only, parallel to the existing XP/promotion tables).
  await ensureCapeSchema();

  await ensureCommunityMemberRoleSchema();
  // Peer Wins — community_posts curriculum tether columns (idempotent, additive).
  await ensureCommunityWinsSchema();
  // Podcast / testimonial listen-to-earn progress (today_media_watch).
  await ensureTodayMediaWatchSchema();
  // Comment moderation (Community Organizer role) — status/removed_at/removed_by
  // on community_comments, mirroring the existing post-moderation columns.
  await ensureCommunityCommentModerationSchema();
  // Capstone Record — the two capstone tables plus community_posts.shared_to_portfolio.
  //
  // Runs AFTER the community ensures above because the consent column is an ALTER
  // against community_posts: on a fresh database a reversed ordering drops that
  // statement into its catch and leaves consent unreadable, which reads at runtime
  // as "nobody consented" rather than as a missing column.
  await ensureCapstoneSchema();
  // Free-trial Organization / Manager layer — org + roster tables (idempotent).
  await ensureOrgSchema();
  // Student self-serve subscriptions (idempotent).
  await ensureSubscriptionSchema();
  // Account credits — Open House $50 deposits applied to next payment (idempotent).
  await ensureAccountCreditSchema();
  // Admin-issued refunds/voids (idempotent).
  await ensureRefundSchema();
  // Open house events (idempotent).
  await ensureOpenHouseSchema();
  // Onboarding profile (resume/LinkedIn prefill) (idempotent).
  await ensureOnboardingProfileSchema();
  // Student Settings: avatar photo + uploaded resume file columns (idempotent).
  await ensurePortalSettingsSchema();
  // CAPE Phase 2 — resume/LinkedIn placement + adaptive diagnostic: 2 new
  // onboarding_profiles columns + 2 new tables (idempotent DDL, additive
  // only). Must run AFTER ensurePortalSettingsSchema() so onboarding_profiles
  // already exists.
  await ensureCapePlacementSchema();
  // Unified StudentTask: nullable requirement_key + story-driven columns (idempotent).
  await ensureStudentTaskMergeSchema();
  // Timeline Engine (Classroom rebuild) — explicit idempotent table creation + type/registry ALTERs.
  await ensureTimelineEngineSchema();
  // CAPE Phase 3 — curriculum-to-skill mapping: curriculum_skill_maps +
  // architecture_skill_prerequisites tables + 5 stamp columns on timeline_cards
  // (idempotent DDL, additive only). Must run AFTER ensureTimelineEngineSchema() so
  // timeline_cards already exists before the ALTER TABLE statements run.
  await ensureCapeCurriculumMapSchema();
  // Network Video Library (Testimonials random personalized mode) — catalog + per-enrollment view ledger.
  await ensureNetworkVideoSchema();
  // Podcast Library (Podcast random personalized mode) — catalog + per-enrollment listen ledger.
  await ensurePodcastSchema();
  // "Recommend a friend" onboarding step — friend_referrals table.
  await ensureFriendReferralSchema();
  // Sponsor portal magic-link audit trail (STORY-001) — sponsor_portal_audit_log.
  await ensureSponsorPortalAuditSchema();
  await ensureSbpSchema();
  // Builds the last process left mid-generation. The queue that owned them died with it;
  // the rows did not. Before listen, so nothing can race a resumed run - and a failure here
  // is a log line, never a boot that does not happen.
  try {
    const { recoverStrandedBuilds } = await import('./services/sbp/sbpOrchestrator');
    const swept = await recoverStrandedBuilds();
    if (swept.resumed.length || swept.abandoned.length) {
      console.log(`[SBP] resumed ${swept.resumed.length} stranded build(s), abandoned ${swept.abandoned.length}`);
    }
  } catch (err: any) {
    console.warn('[SBP] stranded-build sweep failed:', err?.message);
  }
  // Cert Prep (Claude Certified Architect readiness) — eight additive tables.
  // Ensured at boot like its siblings, and NOT gated on CERT_PREP_ENABLED: the
  // flag decides whether the feature answers requests, not whether its tables
  // exist. Creating them only when the flag flips would mean the first request
  // after enabling it races the DDL, and turning the flag off would leave a
  // half-known schema behind. The DDL is idempotent and additive, so a
  // flag-off deployment simply carries eight empty tables.
  //
  // It refuses to claim success it did not have: four of these tables
  // REFERENCE enrollments(id), and on a database without it they failed
  // silently while the per-statement try/catch let boot log "schema ensured".
  // The function now post-checks and names what is missing.
  await ensureCertPrepSchema();
  // projects.archived_at — the soft-delete stamp behind "remove my own project".
  // Must run before any request can hit the archive routes, because every
  // student-project listing query now filters on this column and a missing
  // column would 500 the whole Projects surface rather than degrade it.
  await ensureProjectArchiveSchema();
  // projects.approval_state and friends — "review your project, then approve it".
  // Additive and default-free: NULL means never gated, so this changes nothing
  // for existing projects. Runs next to the archive schema for the same reason —
  // the project tree DTO now reads these columns and a missing one would 500 the
  // student's project page rather than degrade it.
  await ensureProjectApprovalSchema();
  // AI Project Factory: the two-track contract model (contract_tracks, contract_requirements,
  // the requirement link tables, and the versioned contract_process_documents). Additive NEW
  // tables that FK to delivery_projects (and projects) — no existing table is altered.
  await ensureContractTrackSchema();
  // AI Project Factory Phase 2: the Enterprise-owned gov qualification model (gov_qualifications,
  // build_authorizations, gov_opportunity_aliases). Additive NEW tables that FK to delivery_projects
  // (and the qualification table itself) — no existing table is altered; placed after the contract
  // tables since build_authorizations references delivery_projects.
  await ensureGovQualificationSchema();
  // AI Project Factory: the team-scoped gov-opportunity dismissal record (gov_opportunity_dismissals). A single
  // additive NEW table so a reviewer can hide a discovered v1 candidate from the whole team's feed (reversible).
  // No existing table is altered; it FKs to nothing (keyed by tenant_id + OP's opportunity uuid).
  await ensureGovOpportunityDismissalSchema();
  // AI Project Factory: the executor/accountable/skills/judgment/confidence/source-evidence
  // attributes, added to student_tasks as new nullable columns (the archived_at/approval_state
  // pattern). Existing rows are untouched and unset until the factory populates them.
  await ensureFactoryTaskSchema();
  // Transactional email dedup ledger. CLAUDE.md mandates application-level
  // dedup on (recipient, subject, business_event_id) for Mandrill sends and
  // production had no such table, so every batch send was one retry away from
  // mailing a student twice. The claim in services/email/idempotentSend.ts is
  // useless without the UNIQUE indexes this creates, which is why it is
  // ensured at boot alongside its siblings rather than by the send script.
  await ensureEmailSendLedgerSchema();
  // AI Internship: application lifecycle, two-channel interview, decisions,
  // documents, and `cohort_memberships` — the secondary membership that lets an
  // intern join the internship cohort WITHOUT disturbing the class cohort in
  // enrollments.cohort_id (docs/AI_INTERNSHIP_DISCOVERY.md §3.2). Ensured after
  // enrollments/cohorts exist, since every table here hangs off one of them.
  await ensureInternshipSchema();
  // Milestone ladder: `student_milestones` (latched curriculum / project /
  // certification milestones the promotion engine counts) and
  // `student_certifications` (student-uploaded, staff-approved). Additive;
  // the engine reads them only when MILESTONE_LADDER_ENABLED is on.
  await ensureMilestoneLadderSchema();
  // Durable store for provider-rotated OAuth refresh tokens (MS Graph/Hotmail).
  // Without it every rotation is discarded and the deployment drifts toward a
  // dead credential that only an interactive re-consent can recover.
  await ensureOauthTokenVaultSchema();
  await ensureWorkspaceRepoSchema();
  // Files a student hands to an agent (Cory, Reese) for the read_attachments tool.
  await ensureAgentAttachmentSchema();
  // Reese's first-login welcome ledger — also the "has this student logged in
  // before" marker, since enrollments carry no last_login_at.
  await ensureReeseWelcomeSchema();
  // Per-card student comments (Runtime workspace).
  await ensureCardCommentsSchema();
  // Weekly feedback Survey answers (idempotent).
  await ensureSurveyResponsesSchema();
  // Knowledge Check (quiz) + Evaluation attempts — scores, responses, pre/post correlation.
  await ensureAssessmentSchema();
  // Weekly "Week in Review" Reflection — per-student captured signals (idempotent).
  await ensureReflectionEntriesSchema();
  // Blog library (Blog type's auto-match mode) — catalog + per-student read ledger,
  // then a NON-BLOCKING one-time populate for fresh environments (weekly cron keeps it current).
  await ensureBlogSchema();
  await ensureTodayFeedSchema();
  await ensureCapeLearningValueRankerSchema(); // CAPE Phase 4 (T007) — additive columns; must run AFTER ensureTodayFeedSchema
  await ensureCapeTodayPlanSchema(); // CAPE Phase 5 (T003) — new today_plan_feedback table, references enrollments(id)
  await ensureCapeGovernanceSchema(); // CAPE Phase 6 — cape_governance_policy + cape_lifecycle_mode_policy (additive, byte-identical seed defaults)
  await ensureCapeAiPulseExposureSchema(); // ai_pulse rotation bugfix (2026-08-06) — cape_ai_pulse_exposure table, references enrollments(id)
  await ensureFeedControlSchema();
  await ensureAiNewsSchema();
  import('./services/blog/blogIngestionService')
    .then(({ refreshBlogPostsIfEmpty }) => refreshBlogPostsIfEmpty())
    .catch((err: any) => console.warn('[DB] Blog boot refresh skipped:', err?.message?.split('\n')[0]));
  // AI News Flash pipeline: populate a fresh env, then catch up a missed daily
  // run so a redeploy through the 03:15 cron window doesn't drop a day's card
  // (non-blocking). Materialization is cost-gated by AI_NEWS_INGEST_ENABLED.
  import('./services/intel/aiNewsIngestionService')
    .then(({ refreshAiNewsOnBoot }) => refreshAiNewsOnBoot())
    .catch((err: any) => console.warn('[DB] AI News boot ingest skipped:', err?.message?.split('\n')[0]));
  // Intelligence pipelines (the 9 generators): ensure the shared library table,
  // register all source adapters, then run each source's boot catch-up so a
  // redeploy through the cron window doesn't drop a day (non-blocking). Each is
  // cost-gated by its own <SLUG>_INGEST_ENABLED flag (default OFF) — dark until set.
  import('./services/intel/sources')
    .then(async () => {
      const { ensureIntelItemsSchema } = await import('./models/IntelItem');
      await ensureIntelItemsSchema();
      const { listIntelSources, runIntelPipelineOnBoot } = await import('./services/intel/intelPipeline');
      for (const src of listIntelSources()) {
        runIntelPipelineOnBoot(src.slug).catch((err: any) =>
          console.warn(`[DB] Intel ${src.slug} boot ingest skipped:`, err?.message?.split('\n')[0]));
      }
    })
    .catch((err: any) => console.warn('[DB] Intel pipelines boot skipped:', err?.message?.split('\n')[0]));
  // Experience Builder (Phase 1) — AI Component columns + component_versions.
  await ensureExperienceBuilderSchema();
  await ensureCurriculumComposerSchema();
  await ensureRuntimeSchema();
  await ensureOpsCenterSchema();
  await ensureWorkforceSchema();
  // Workforce OS perf fix — missing tickets.created_by_id index (EXPLAIN ANALYZE-
  // confirmed Seq Scan on every per-agent ticket count). Additive, idempotent, no flag.
  await ensureTicketCreatorIndexSchema();
  await ensureIntelligenceSchema();
  // Colaberry Commons — Community Rooms tables (idempotent, additive). Created
  // unconditionally (cheap CREATE IF NOT EXISTS); the feature stays dark behind
  // env.communityRoomsEnabled at the route/worker/linkage layers.
  await ensureCommunityRoomsSchema();
  // Friendships (portal Contacts rail friend graph) — idempotent, additive, no flag.
  await ensureFriendshipSchema();
  // Messaging extras — DM read cursor + widened notification-type CHECK. Additive.
  await ensureMessagingSchema();
  // Reese Phase 1 — staff-identity columns on admin_users (display_name,
  // is_ai_operated, agent_id). Additive, idempotent, no flag.
  await ensureAdminUserIdentitySchema();
  // Reese Phase 1 — agent-transparency columns on ai_agents (system_prompt,
  // tools_granted, persona_version). Additive, idempotent, no flag.
  await ensureAiAgentIdentitySchema();
  // Agent Ticket Standard — reports_to_org_member_id on ai_agents (every
  // ticket-creating agent must report to a real human). Additive, idempotent, no flag.
  await ensureAiAgentReportsToSchema();
  // AI Leadership / AI Staff hierarchy — reports_to_type/reports_to_id, superseding
  // reports_to_org_member_id above as the resolver's source of truth. Additive, idempotent, no flag.
  await ensureAiAgentHierarchySchema();
  // AI Workforce Reset, Phase C — autonomy_level (docs/ai-governance/abac-design.md's
  // 4-level ladder), required at agent reactivation time. Additive, idempotent, no flag.
  await ensureAiAgentAutonomyLevelSchema();
  // Fleet-wide autonomy-level auto-classification, Phase 2 — autonomy_level_source
  // ('auto'|'manual'|null), distinguishing a classifier-set level from a real human
  // decision. Additive, idempotent, no flag.
  await ensureAiAgentAutonomySourceSchema();
  // Real-enforcement scoping, Phase 3 — abac_mode_override ('shadow'|'enforce'|null),
  // the per-agent switch Ali asked for. Additive, idempotent, no flag.
  await ensureAiAgentAbacOverrideSchema();
  // Reports-to editor (2026-09-30) — reports_to_set_at/reports_to_set_by, the real audit
  // trail for the new "change who this agent reports to" admin write. Additive, idempotent,
  // no flag.
  await ensureAiAgentReportsToAuditSchema();
  // AI Employee Consolidation Program, Phase 4 — record_kind/parent_agent_id/
  // migration_status, the program's legacy-item-to-employee ownership fields.
  // Additive, idempotent, no flag.
  await ensureAiAgentConsolidationSchema();
  // Trust Contract Phase 1 — real history behind AiAgent.persona_version,
  // written by seedAgentRegistry() (below) whenever a registry entry's
  // version genuinely changes. Additive, idempotent, no flag. Must run
  // before seedAgentRegistry() so the table exists on a fresh boot.
  await ensureAgentPersonaVersionHistorySchema();
  // AI Workforce Management, Checkpoint B — an agent's business-facing job
  // description, manager-editable, separate from system_prompt. Additive,
  // idempotent, no flag. No seeder writes to it; a manager writes the first
  // row via PUT /api/admin/agents/:id/charter, so no ordering dependency.
  await ensureAgentRoleCharterSchema();
  // AI Workforce Management, Checkpoint C — standing manager instructions
  // injected into runtime prompt assembly (agentSystemPrompt.ts), never into
  // AiAgent.system_prompt. Additive, idempotent, no flag. No seeder writes
  // to it; a manager writes the first row via POST .../directives.
  await ensureManagerDirectiveSchema();
  // AI Workforce Management, Checkpoint C — Direct Agent Communication:
  // a manager's continuous conversation thread with their agent. Additive,
  // idempotent, no flag. No seeder writes to it; a manager writes the first
  // row via GET .../conversation (find-or-create) or POST .../messages.
  await ensureAgentManagerConversationSchema();
  // AI Workforce Management, Checkpoint D — a manager-set target for a
  // real, computable metric on an agent. Additive, idempotent, no flag. No
  // seeder writes to it; a manager writes the first row via
  // POST .../goals.
  await ensureAgentGoalSchema();
  await ensureProjectUnderstandingSchema();
  // Unified Project Discovery, Phase 5: a student's request to be called about
  // their project, with the consent scoped to it. Additive, idempotent.
  await ensureProjectDiscoveryCallSchema();
  // Phase 6: the ledger of what each story's repo taught the truth, keyed
  // so a replay is a no-op. Additive, idempotent.
  await ensureStoryEnrichmentSchema();
  // AI Workforce Management, Checkpoint D — a manager's structured 1:1
  // check-in record with their agent. Additive, idempotent, no flag. No
  // seeder writes to it; a manager writes the first row via
  // POST .../one-on-ones.
  await ensureAgentOneOnOneSchema();
  // AI Workforce Management, Checkpoint D — a manager's standing request to
  // receive a recurring email report about an agent, at their own delivery
  // hour and timezone. Additive, idempotent, no flag. No seeder writes to
  // it; a manager writes the first row via POST .../report-subscriptions.
  // Report generation/delivery is a separate, later piece.
  await ensureAgentReportSubscriptionSchema();
  // AI Workforce Management, Checkpoint D — one attempt to generate/deliver
  // a subscription's report for one delivery period. Additive, idempotent,
  // no flag. No seeder writes to it; the AgentReportSubscriptionDispatch
  // cron (schedulerService.ts) writes the first row on the first tick
  // where an enabled subscription's local delivery hour matches.
  await ensureAgentReportRunSchema();
  // AI Workforce Management, Checkpoint E — a proposed fact about an agent,
  // pending human review before it can ever reach that agent's runtime
  // context (agentSystemPrompt.ts / agentManagerConversationPrompt.ts).
  // Additive, idempotent, no flag. No seeder writes to it; a manager writes
  // the first row via POST .../memory-proposals.
  await ensureAgentMemoryProposalSchema();
  // Reese Agentic AI Employee mission, Checkpoint B — the metric reliability
  // registry, confirmed absent anywhere in this codebase at Checkpoint A
  // discovery. Additive, idempotent, no flag. No seeder writes to it; a
  // manager or an agent-detected reliability change writes the first row
  // via metricReliabilityService.ts's declareReliabilityChange().
  await ensureMetricReliabilityRecordSchema();
  // Reese Agentic AI Employee mission, Checkpoint D — student health
  // assessment history, confirmed absent at discovery. Additive, idempotent,
  // no flag. No seeder writes to it; assessStudentHealth.ts writes the first
  // row on demand.
  await ensureStudentAssessmentSchema();
  await ensureChecklistInstanceSchema();
  // Reese Agentic AI Employee mission, Checkpoint B — the manager
  // confirmation workflow's one new column (pending_reliability_confirmation)
  // on the existing agent_manager_conversations table. Additive, idempotent,
  // no flag.
  await ensureAgentManagerConversationReliabilitySchema();
  // Reese Agentic AI Employee mission, Capability 8 — the generic pending-
  // intent-confirmation workflow's one new column (pending_intent_confirmation)
  // on the same table. Additive, idempotent, no flag.
  await ensureAgentManagerConversationIntentSchema();
  // Reese manager-directed growth mission, Phase 2 — the real case a conversation is
  // currently focused on (focused_ticket_id), on the same table. Additive, idempotent, no flag.
  await ensureAgentManagerConversationFocusedTicketSchema();
  // AI Workforce Reset, Phase D.1 "Inventory" — department/scope (Ali signed off on
  // abac-design.md's own recommendations wholesale, 2026-08-24). Additive, idempotent, no flag.
  await ensureAiAgentDepartmentScopeSchema();
  // Colaberry Commons — seed the 10 always-open fruit video rooms (idempotent).
  // Gated on the feature flag so it only populates envs where Rooms is enabled.
  if (env.communityRoomsEnabled) {
    try {
      const { seedDefaultCommunityRooms } = await import('./seeds/seedDefaultCommunityRooms');
      const r = await seedDefaultCommunityRooms();
      console.log(`[CommunityRooms] default rooms: ${r.created} created, ${r.existing} existing`);
    } catch (err: any) {
      console.warn('[CommunityRooms] default room seed failed:', err?.message);
    }
  }
  // Intelligence-pipeline sample cards — one evergreen card per intel type, to
  // carry the Today feed before the ingestion pipelines have produced anything.
  //
  // OFF by default. That cold-start justification has expired: the pipelines
  // have since generated hundreds of real published cards across all ten types,
  // so on a populated database this seed only adds demo content on top of real
  // content. Running it unconditionally caused two production problems:
  //   1. It re-asserted all ten cards on EVERY boot and forced them back to
  //      published, so a correction made in the DB or by an admin silently
  //      reverted on the next deploy (a dead video link came back this way on
  //      2026-08-13).
  //   2. Its permanent card meant a type's card count was never 0, which
  //      suppressed the INTEL_SOURCE_EXHAUSTED / POOL_EMPTY diagnostics until
  //      feedTypeStatsService.ts added an explicit exclusion on 2026-08-10.
  //
  // Set SEED_INTEL_SAMPLE_CARDS=true to run it — intended for a fresh dev or
  // preview database, which is what it was written for. Still fail-soft.
  if (process.env.SEED_INTEL_SAMPLE_CARDS === 'true') {
    try {
      const { seedIntelSampleCards } = await import('./seeds/seedIntelSampleCards');
      const r = await seedIntelSampleCards();
      console.log(`[IntelSamples] ${r.created.length} created, ${r.updated.length} updated`);
    } catch (err: any) {
      console.warn('[IntelSamples] sample-card seed failed:', err?.message);
    }
  }
  // Additive schema self-heal for the models that break user-facing flows when
  // they drift behind their table (sync({alter}) is off — see below). Adds any
  // missing column as NULLABLE; never drops/alters. Fixes the recurring
  // enrollments drift that took down the student Classroom twice. Set
  // SCHEMA_RECONCILE=false to disable. To protect another model, add it here.
  if (process.env.SCHEMA_RECONCILE !== 'false') {
    try {
      const { reconcileMissingColumns } = await import('./config/schemaReconcile');
      const Enrollment = (await import('./models/Enrollment')).default;
      const TimelineCard = (await import('./models/TimelineCard')).default;
      const TimelineCardProgress = (await import('./models/TimelineCardProgress')).default;
      const TimelineSectionRule = (await import('./models/TimelineSectionRule')).default;
      const CurriculumTypeDefinition = (await import('./models/CurriculumTypeDefinition')).default;
      const Subscription = (await import('./models/Subscription')).default;
      const AccountCredit = (await import('./models/AccountCredit')).default;
      const Refund = (await import('./models/Refund')).default;
      const r = await reconcileMissingColumns([
        Enrollment,
        TimelineCard,
        TimelineCardProgress,
        TimelineSectionRule,
        CurriculumTypeDefinition,
        Subscription,
        AccountCredit,
        Refund,
      ]);
      if (r.added.length) {
        console.log(
          `[schema-reconcile] healed ${r.added.length} missing column(s): ` +
            r.added.map((a) => `${a.table}.${a.column}`).join(', '),
        );
      } else {
        console.log(`[schema-reconcile] ${r.checked} model(s) checked, schema in sync`);
      }
    } catch (err: any) {
      console.warn('[schema-reconcile] failed (non-fatal):', err?.message);
    }
  }
  // Seed the curriculum types + progression config only when the engine is enabled (idempotent upsert).
  if (process.env.TIMELINE_ENGINE_ENABLED === 'true') {
    try {
      const { seedCurriculumTypeDefinitions } = await import('./services/timeline/typeSeeder');
      const r = await seedCurriculumTypeDefinitions();
      console.log(`[TimelineEngine] curriculum types seeded: ${r.created} created, ${r.updated} updated`);
      // Layer human-authored config (generation prompt, thumbnail, Parts, contracts)
      // on top of the freshly-seeded type registry. Idempotent; keyed on slug.
      const { seedComponentAuthoring } = await import('./seeds/seedComponentAuthoring');
      const authoring = await seedComponentAuthoring();
      console.log(`[TimelineEngine] component authoring applied: ${authoring.updated.length} updated${authoring.missing.length ? `, missing: ${authoring.missing.join(',')}` : ''}`);
      // Testimonials type: relabel + publish link/random settings AFTER authoring so it wins.
      await seedTestimonialType();
      const { seedProgressionConfig } = await import('./services/progression/seeders');
      const p = await seedProgressionConfig();
      console.log(`[TimelineEngine] progression seeded: ${p.domains} domains, ${p.levels} levels, ${p.points} point defaults`);
      // CAPE Phase 0-1: 10 Architecture Skill definitions + default evidence-band weights.
      const { seedCapeConfig } = await import('./services/cape/capeSeeders');
      const cape = await seedCapeConfig();
      console.log(`[CAPE] seeded: ${cape.skillDefinitions} skill definitions, ${cape.weights} weight config`);
      // CAPE Phase 3: type-default curriculum_skill_maps rows — one per registered
      // Curriculum Type (50/50, including explicit zero-credit rows for the
      // system/community/delivery-event policy groups). Idempotent — only inserts
      // when no current row exists yet for a given type_slug.
      const { seedTypeSkillMaps } = await import('./services/cape/capeTypeSkillMapSeeds');
      const typeMaps = await seedTypeSkillMaps();
      console.log(`[CAPE] type-default skill maps seeded: ${typeMaps.created} created, ${typeMaps.skipped} already current`);
      // CAPE Phase 3: week-level curriculum_skill_maps targets — Weeks 0-12, the
      // second resolution tier (supersedes a type default for any card with a week
      // number). Idempotent.
      const { seedWeekSkillMaps } = await import('./services/cape/capeWeekSkillMapSeeds');
      const weekMaps = await seedWeekSkillMaps();
      console.log(`[CAPE] week-target skill maps seeded: ${weekMaps.created} created, ${weekMaps.skipped} already current, ${weekMaps.blueprintGapsLogged} blueprint gaps logged`);
      // CAPE Phase 3: Architecture Skill prerequisite graph — a small starter seed
      // (execution-contract.md Assumption 6), consumed by Phase 4's ranker later.
      const { seedSkillPrerequisites } = await import('./services/cape/capeSkillPrerequisiteSeeds');
      const prereqs = await seedSkillPrerequisites();
      console.log(`[CAPE] skill prerequisites seeded: ${prereqs.created} created, ${prereqs.skipped} already existed`);
      // Feed Control: re-apply stored type routing to the registry AFTER the seed
      // (typeSeeder re-asserts surface columns from code, so routing must win last).
      const { applyFeedRoutingToRegistry } = await import('./services/timeline/feedControlService');
      await applyFeedRoutingToRegistry();
      // Invariant: at most one published build station per week — archive any
      // artifact_submission duplicate of an implementation_task so a re-scaffold that
      // re-published it self-heals (idempotent). See buildStationReconciler.
      const { reconcileBuildStationLayout } = await import('./services/timeline/buildStationReconciler');
      const bs = await reconcileBuildStationLayout();
      if (bs.archived) console.log(`[TimelineEngine] build-station dedup: archived ${bs.archived} duplicate artifact_submission card(s)`);
      // Invariant: every published reflect-chain eval/survey/reflection card carries
      // its computed unlock_rules — self-heals drift from any card-creation path that
      // bypasses createCard()'s auto-gate (seed scripts, legacy migrations) or cards
      // added out of order. See reflectGatingReconciler.
      const { reconcileReflectGating } = await import('./services/timeline/reflectGatingReconciler');
      const rg = await reconcileReflectGating();
      if (rg.fixed) console.log(`[TimelineEngine] reflect-gating reconcile: fixed ${rg.fixed}/${rg.checked} card(s)`);
    } catch (err: any) {
      console.warn('[TimelineEngine] seed failed:', err?.message);
    }
  }
  // Consent ledger (TBI audit P0-3) — explicit, idempotent. Powers the shadow consent gate.
  try {
    const { ensureConsentSchema } = await import('./services/consentService');
    await ensureConsentSchema();
  } catch (err: any) {
    console.warn('[DB] consent_records schema ensure failed:', err?.message);
  }
  // Portal "Open on your phone" handoff tokens (idempotent, single-use QR bridge).
  try {
    const { ensureHandoffSchema } = await import('./services/portalHandoffService');
    await ensureHandoffSchema();
  } catch (err: any) {
    console.warn('[DB] portal_handoff_tokens schema ensure failed:', err?.message);
  }
  // Seed v0 automation rules (idempotent).
  try {
    const { seedDefaultAutomationRules } = await import('./services/ops/automationRulesService');
    await seedDefaultAutomationRules();
  } catch (err: any) {
    console.warn('[OpsAutomation] seed failed:', err?.message);
  }

  // Schema is managed explicitly above (ensureOpsCommandCenterSchema, lead-ingestion,
  // Missed Opportunities, etc.) because sequelize.sync({ alter: true }) is unreliable
  // on this 215-model prod graph — see the comment on ensureOpsCommandCenterSchema.
  // It is also SLOW: even when the alter pass fails, the fallback create-only sync runs
  // a full per-table schema introspection across all 215 models (~6 min on prod) before
  // erroring on a pre-existing enum drift (anthropic_content_registry.content_type), so
  // every boot/deploy became a multi-minute API outage. Off by default; set
  // DB_BOOT_SYNC=true only for a deliberate, supervised schema reconciliation.
  if (process.env.DB_BOOT_SYNC === 'true') {
    try {
      await sequelize.sync({ alter: true });
    } catch (err: any) {
      console.warn('[DB] sync({ alter: true }) failed, falling back to create-only sync:', err?.message);
      try {
        await sequelize.sync();
      } catch (fallbackErr: any) {
        console.warn('[DB] fallback sync also failed:', fallbackErr?.message);
      }
    }
  }
  await ensureCampaignLinkColumns();
  await ensureCommunicationIndexes();
  try {
    const { seedMissedOpportunitiesReport } = await import('./seeds/seedMissedOpportunitiesReport');
    await seedMissedOpportunitiesReport();
  } catch (err: any) {
    console.warn('[Seed] Missed Opportunities Report registration failed:', err?.message);
  }
  try {
    // The legacy 5-module "Enterprise AI Leadership Accelerator" pilot seed
    // (seedProgramCurriculum) runs on every backend boot and attaches its stale
    // 5-module curriculum + April-2026 LiveSessions onto the OLDEST cohort in the
    // DB (Cohort.findOne order created_at ASC). In production that would silently
    // corrupt a real cohort's curriculum the moment it becomes the oldest row, so
    // it must never run there. Dev/staging still seed it so the local portal UX
    // has content to render. See BC todo 10071007473.
    if (env.nodeEnv !== 'production') {
      await seedProgramCurriculum();
    } else {
      console.log('[Seed] Skipping seedProgramCurriculum in production (legacy 5-week pilot content)');
    }
    await seedDepartments();
    await seedCurriculumTypeDefinitions();
    await seedCurriculumCourseLinks();
  } catch (err: any) {
    console.warn('[Seed] curriculum/departments seed failed (non-fatal):', err?.message);
  }

  // Seed landing pages and migrate existing campaign deployments
  try {
    const { seedLandingPages, migrateExistingCampaigns } = await import('./services/deploymentService');
    await seedLandingPages();
    const migrationResult = await migrateExistingCampaigns();
    if (migrationResult.migrated > 0) {
      console.log(`[Deploy] Migrated ${migrationResult.migrated} campaigns to deployments`);
    }
  } catch (err: any) {
    console.warn('[Deploy] Landing page / deployment seed failed:', err?.message);
  }
  // Explorer campaign_key uniqueness, BEFORE seedAllCampaigns below - the seed
  // creates the rows this index constrains, so it has to exist first rather than
  // race them. Never throws: a duplicate would make CREATE UNIQUE INDEX raise,
  // and start() is called bare with app.listen() as its last statement, so an
  // uncontained throw here would stop the backend binding its port.
  try { await ensureExplorerCampaignKeyIndex(); } catch (err: any) { console.warn('[DB] explorer campaign key index failed (non-fatal):', err?.message); }

  // Run campaign seeding in background — it may make slow external API calls (GHL)
  // that should not block server startup
  seedAllCampaigns().catch((err) =>
    console.error('[Seed] Campaign seeding failed:', err?.message)
  );

  // Growth Journey OS T202: §4's offer catalog and brand-offer policy.
  //
  // AWAITED, not backgrounded like the campaign seed above: this is local
  // database work with no external API call, so there is nothing slow to keep
  // off the boot path. Wrapped because `start()` is called bare with
  // `app.listen()` as its last statement — an uncontained throw here would stop
  // the backend binding its port.
  //
  // MUST RUN AFTER `ensureGrowthJourneySchema()` (line ~2521), which creates the
  // two tables it writes to. Seeding first is not a crash: every write is
  // individually caught, so it would surface as a handful of warnings and an
  // empty policy table — which then DENIES every brand every family, because
  // the resolver fails closed. Silent and safe, but wrong.
  //
  // Unflagged deliberately. An empty table denies everything; seeding is what
  // makes §4's intent true, and the denies land before the allows. Nothing
  // reads the table yet.
  try {
    const { seedBrandOfferPolicy } = await import('./seeds/growthJourney/seedBrandOfferPolicy');
    const policy = await seedBrandOfferPolicy();
    console.log(
      `[GrowthJourney] offer policy seeded: ${policy.families_created} families created, ` +
        `${policy.policies_created} policies created, ${policy.policies_updated} denies restored` +
        (policy.skipped_brands.length ? `, brands absent: ${policy.skipped_brands.join(',')}` : '') +
        (policy.failed.length ? `, failed: ${policy.failed.length}` : ''),
    );
  } catch (err: any) {
    console.warn('[GrowthJourney] offer policy seed failed (non-fatal):', err?.message);
  }

  // Growth Journey OS T212: §5's four journey programs, their paths, and each
  // brand's default pointer.
  //
  // AFTER the policy seed above, and that order is meaningful even though it is
  // not a database dependency: a programme's paths are DERIVED from the same
  // brand-offer policy definitions, so reading the two steps in this order is
  // how the next person sees that §4 governs §5 rather than the reverse.
  //
  // EVERY PROGRAMME IS SEEDED `draft`, so `resolveDefaultJourney` returns
  // `program_not_active` for every brand until a human activates one. That is
  // the intended resting state, not an unfinished one: T201 made `draft` the
  // default precisely so a programme seeded by mistake cannot be resolved as a
  // brand's default, and T203 enforces it. This step builds the structure and
  // stops. Turning a journey on stays a decision.
  //
  // Nothing here can send anything - these rows describe structure, and a path
  // existing does not mean an offer may be made: T202's eligibility gate is a
  // separate check at the moment of use.
  try {
    const { seedJourneyPrograms } = await import('./seeds/growthJourney/seedJourneyPrograms');
    const programs = await seedJourneyPrograms();
    console.log(
      `[GrowthJourney] journey programs seeded: ${programs.programs_created} created, ` +
        `${programs.paths_created} paths created, ${programs.defaults_set} brand defaults set` +
        (programs.defaults_left_alone
          ? `, ${programs.defaults_left_alone} defaults left as an operator set them`
          : '') +
        (programs.skipped_brands.length ? `, brands absent: ${programs.skipped_brands.join(',')}` : '') +
        (programs.failed.length ? `, failed: ${programs.failed.length}` : ''),
    );
  } catch (err: any) {
    console.warn('[GrowthJourney] journey program seed failed (non-fatal):', err?.message);
  }

  // Growth Journey OS T403: the 24 queue policy rows (six queues x four brands),
  // created ONCE with daily_capacity NULL and a default SLA per queue, and
  // never touched again - every number is the operator's from then on. The
  // capacity reader answers `unknown` until a human writes a number, which
  // unlocks nothing; nothing here assigns, notifies or sends.
  //
  // AFTER the programme seed: the rows are per programme BRAND, and reading
  // the steps in this order shows the queues following the programmes.
  try {
    const { seedGrowthJourneyPolicies } = await import('./seeds/growthJourney/seedGrowthJourneyPolicies');
    const policies = await seedGrowthJourneyPolicies();
    console.log(
      `[GrowthJourney] queue policies seeded: ${policies.created} created, ${policies.existing} left as they are` +
        (policies.skipped_brands.length ? `, brands absent: ${policies.skipped_brands.join(',')}` : '') +
        (policies.failed.length ? `, failed: ${policies.failed.length}` : ''),
    );
  } catch (err: any) {
    console.warn('[GrowthJourney] queue policy seed failed (non-fatal):', err?.message);
  }

  // Intelligence OS: ensure tables exist and start autonomous discovery
  try { await ensureIntelligenceTables(); } catch (err: any) { console.warn('[Intelligence] ensure tables failed (non-fatal):', err?.message); }
  setTimeout(() => {
    runDiscoveryAgent().catch((err) =>
      console.error('[Intelligence] Startup discovery failed:', err?.message)
    );
  }, 5000);
  cron.schedule('*/10 * * * *', () => {
    runDiscoveryAgent().catch((err) =>
      console.error('[Intelligence] Scheduled discovery failed:', err?.message)
    );
  });

  // AI Ops Command Center metrics_daily rollup — runs on the 5-minute
  // cadence so the Today's Pulse tile stays fresh during the day. The
  // upsert is idempotent + cheap (one row per date).
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { rollupToday } = await import('./services/ops/metricsDailyService');
      await rollupToday();
    } catch (err: any) {
      console.warn('[OpsMetricsDaily] scheduled rollup failed:', err?.message);
    }
  });

  // AI Ops Command Center BC mirror — pulls all projects → todolists → todos
  // every 2 min so the Command Center reads from a fresh local mirror.
  // After each sync, runs the Priority Engine v0 over the mirror so the
  // Waiting on Human queue surface is sorted by a meaningful urgency score.
  cron.schedule('*/2 * * * *', async () => {
    try {
      const [{ runBcSync }, { runPriorityEngine }, opsRoutesMod] = await Promise.all([
        import('./services/ops/bcSyncService'),
        import('./services/ops/priorityEngineService'),
        import('./routes/admin/opsRoutes'),
      ]);
      const syncResult = await runBcSync();
      opsRoutesMod.setLastSync(syncResult);
      if (syncResult.errors.length > 0) {
        console.warn(
          `[OpsBcSync] completed with ${syncResult.errors.length} errors`,
          syncResult.errors.slice(0, 3),
        );
      }
      // Score every active todo after the mirror is fresh.
      const scoreResult = await runPriorityEngine();
      opsRoutesMod.setLastPriorityRun(scoreResult);
      if (scoreResult.errors.length > 0) {
        console.warn(
          `[OpsPriorityEngine] completed with ${scoreResult.errors.length} errors`,
          scoreResult.errors.slice(0, 3),
        );
      }
      // Run automation rules after scoring.
      try {
        const { runAutomationRules } = await import('./services/ops/automationRulesService');
        const automationResult = await runAutomationRules();
        opsRoutesMod.setLastAutomationRun(automationResult);
        if (automationResult.rules_fired > 0) {
          console.log(
            `[OpsAutomation] fired ${automationResult.rules_fired} rule(s)`,
            automationResult.fire_results.filter((f) => f.rows_affected > 0),
          );
        }
      } catch (err: any) {
        console.warn('[OpsAutomation] cron run failed:', err?.message);
      }
    } catch (err: any) {
      console.warn('[OpsBcSync/Priority] scheduled run failed:', err?.message);
    }
  });

  // Server-side Architect build retrieval: pull + build out completed Architect
  // builds even if the user closed the tab (client polling can't be relied on
  // for a ~15-min build). Runs every 2 minutes; idempotent.
  cron.schedule('*/2 * * * *', () => {
    import('./services/architectBuildPollerService')
      .then(({ pollArchitectBuilds }) => pollArchitectBuilds())
      .catch((err) => console.warn('[ArchitectPoller] scheduled run failed:', err?.message));
  });

  // Cory health canary — exercises real read-only Cory tool executors every 4h so
  // tool.call + retrieval observability (Trust Center P1-6) stays live even during
  // weeks with no organic Cory investigation traffic. Read-only, no LLM involved,
  // no write tools exposed. See services/observability/coryHealthCanaryService.ts.
  cron.schedule('0 */4 * * *', () => {
    import('./services/observability/coryHealthCanaryService')
      .then(({ runCoryHealthCanary }) => runCoryHealthCanary())
      .then((result) => {
        if (result.errors.length > 0) {
          console.warn('[CoryHealthCanary] completed with errors:', result.errors);
        }
      })
      .catch((err) => console.warn('[CoryHealthCanary] scheduled run failed:', err?.message));
  });

  // Colaberry Commons — drain the community-rooms outbox every minute (Meet-link
  // provisioning, timeline publish, reminders). Flag-gated so it registers no cron
  // at all when the feature is off; the drain itself is idempotent + retryable
  // with dead-lettering (see roomOutboxService).
  if (env.communityRoomsEnabled) {
    cron.schedule('* * * * *', () => {
      import('./services/communityRooms/roomOutboxService')
        .then(({ drainOutbox }) => drainOutbox(25))
        .catch((err) => console.warn('[CommunityRoomsOutbox] drain failed:', err?.message));
    });

    // Sweep RSVP reminders into the outbox every 5 minutes. Idempotent — the
    // outbox de-dups each (booking, window) reminder; the drain above delivers.
    cron.schedule('*/5 * * * *', () => {
      import('./services/communityRooms/roomReminderService')
        .then(({ sweepReminders }) => sweepReminders())
        .catch((err) => console.warn('[CommunityRoomsReminders] sweep failed:', err?.message));
    });
  }

  // AI Flotation calls the completion webhook missed. Every call now carries our webhook
  // URL, but a delivery we do not control is not a guarantee, and a prospect has no page
  // polling on their behalf. Reads each `sent` call back from Synthflow and completes it
  // the way the webhook would. Bounded, idempotent, one failure never stops the sweep.
  // Not gated on any feature flag: the calls are placed whether or not anything else is on.
  cron.schedule('*/5 * * * *', () => {
    import('./services/delivery/flotationCallCompletion')
      .then(({ reconcileOpenFlotationCalls }) => reconcileOpenFlotationCalls())
      .then((out) => { if (out.reconciled.length) console.log(`[FlotationCalls] sweep completed ${out.reconciled.length} of ${out.checked} open call(s)`); })
      .catch((err) => console.warn('[FlotationCalls] sweep failed:', err?.message));
  });

  // Start follow-up email scheduler if enabled
  if (env.enableFollowUpScheduler) {
    startScheduler();
  }

  // Keep the platform's view of student repositories current. Nothing re-read a repo
  // after the one-time setup flows, so a student could commit finished work and have
  // the portfolio keep showing a months-old snapshot. Read-only against GitHub, capped
  // per sweep, and safe to call twice.
  startRepoTreeRefresh();

  // Register the cognitive-incident email subscriber (BC #10099862873 P1 item 3,
  // idempotent — re-registering on restart is safe, registerIncidentSubscriber
  // just replaces the in-memory subscriber list)
  import('./services/incidentSubscriberBootstrap').then(({ registerCognitiveIncidentSubscriber }) => {
    registerCognitiveIncidentSubscriber().catch((err) => {
      console.error('[Server] Failed to register cognitive incident subscriber:', err.message);
    });
  });

  app.listen(env.port, () => {
    console.log(`Server running on port ${env.port} [${env.nodeEnv}]`);
  });
}

start();

export default app;
