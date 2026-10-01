/**
 * The Command Center read API. The sample endpoint serves the day-one fixture (no DB); the contract
 * endpoint reconstructs a FactoryProject from the persisted doc_json subset + the track/requirement
 * rows, 404s when nothing is generated yet, and 400s a bad id. Every route is section-gated — asserted
 * both behaviourally (mocked guard) and at the source, since the route-auth lint is a required CI check.
 */
import fs from 'fs';
import path from 'path';

const requireSection = jest.fn(() => (req: any, _res: any, next: any) => { req.admin = { email: 'admin@test' }; next(); });
jest.mock('../../../middlewares/authMiddleware', () => ({ requireSection: (...a: any[]) => requireSection(...a) }));

const docFindAll = jest.fn();
const trackFindAll = jest.fn();
const reqFindAll = jest.fn();
const projectFindAll = jest.fn();
jest.mock('../../../models/ContractProcessDocument', () => ({ __esModule: true, default: { findAll: (...a: any[]) => docFindAll(...a) } }));
jest.mock('../../../models/ContractTrack', () => ({ __esModule: true, default: { findAll: (...a: any[]) => trackFindAll(...a) } }));
jest.mock('../../../models/ContractRequirement', () => ({ __esModule: true, default: { findAll: (...a: any[]) => reqFindAll(...a) } }));
const govProjFindOne = jest.fn();
const govProjCreate = jest.fn();
jest.mock('../../../models/DeliveryProject', () => ({ __esModule: true, default: { findAll: (...a: any[]) => projectFindAll(...a), findOne: (...a: any[]) => govProjFindOne(...a), create: (...a: any[]) => govProjCreate(...a) } }));

const fetchBestFitOpportunities = jest.fn();
jest.mock('../../../services/factory/opportunities/oppPulseClient', () => ({ fetchBestFitOpportunities: (...a: any[]) => fetchBestFitOpportunities(...a) }));
const backfillUnassessedContract = jest.fn();
jest.mock('../../../services/factory/factoryBackfill', () => ({ backfillUnassessedContract: (...a: any[]) => backfillUnassessedContract(...a) }));
const lookupGovContractsContainer = jest.fn();
jest.mock('../../../scripts/lib/factoryDemoContainer', () => ({ lookupGovContractsContainer: (...a: any[]) => lookupGovContractsContainer(...a) }));
const dismissOpportunity = jest.fn();
const restoreOpportunity = jest.fn();
const listActiveDismissedKeys = jest.fn();
jest.mock('../../../services/factory/opportunities/govOpportunityDismissals', () => ({
  dismissOpportunity: (...a: any[]) => dismissOpportunity(...a),
  restoreOpportunity: (...a: any[]) => restoreOpportunity(...a),
  listActiveDismissedKeys: (...a: any[]) => listActiveDismissedKeys(...a),
}));
const ingestProposal = jest.fn();
jest.mock('../../../services/factory/proposal/proposalIngest', () => ({ ingestProposal: (...a: any[]) => ingestProposal(...a) }));
const generateDecomposition = jest.fn();
jest.mock('../../../services/factory/factoryDecomposeRun', () => ({ generateDecomposition: (...a: any[]) => generateDecomposition(...a) }));

// Partial mocks: override the write functions but KEEP the real error classes (instanceof must work).
const approveProcessDocument = jest.fn();
jest.mock('../../../services/factory/factoryApproval', () => {
  const actual = jest.requireActual('../../../services/factory/factoryApproval');
  return { ...actual, approveProcessDocument: (...a: any[]) => approveProcessDocument(...a) };
});
const requestChanges = jest.fn();
jest.mock('../../../services/factory/factoryReview', () => {
  const actual = jest.requireActual('../../../services/factory/factoryReview');
  return { ...actual, requestChanges: (...a: any[]) => requestChanges(...a) };
});

import express from 'express';
import request from 'supertest';
import factoryRoutes, { toContractRequirement } from '../factoryRoutes';
import { buildSampleContractProject } from '../../../services/factory/sample/sampleContractProject';
import { ApprovalConflictError, ApprovalGateError } from '../../../services/factory/factoryApproval';

const app = express();
app.use(express.json());
app.use(factoryRoutes);

const s = buildSampleContractProject();
const UUID = '11111111-1111-4111-a111-111111111111'; // a valid RFC-4122 v4 uuid

beforeEach(() => jest.clearAllMocks());

describe('GET /api/admin/factory/sample — the day-one fixture', () => {
  it('serves the sample view, flagged isSample, gate clean, no persisted approval, without touching the DB', async () => {
    const res = await request(app).get('/api/admin/factory/sample');
    expect(res.status).toBe(200);
    expect(res.body.isSample).toBe(true);
    expect(res.body.contractName).toBe('AI Government Contract Finder');
    expect(res.body.gate.ok).toBe(true);
    expect(res.body.approval).toBeNull();
    expect(docFindAll).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/factory/contract/:deliveryProjectId', () => {
  it('404s when no decomposition has been generated for the contract', async () => {
    docFindAll.mockResolvedValue([]);
    const res = await request(app).get(`/api/admin/factory/contract/${UUID}`);
    expect(res.status).toBe(404);
    expect(reqFindAll).not.toHaveBeenCalled(); // short-circuits before loading siblings
  });

  it('400s an invalid (non-uuid) delivery project id', async () => {
    const res = await request(app).get('/api/admin/factory/contract/not-a-uuid');
    expect(res.status).toBe(400);
    expect(docFindAll).not.toHaveBeenCalled();
  });

  it('reconstructs a full FactoryProject from doc_json + tracks + requirements, with the approval state', async () => {
    docFindAll.mockResolvedValue([
      {
        track_type: 'solution_build', version: 2,
        doc_json: {
          processes: s.processes, roles: s.roles, tasks: s.tasks, assignments: s.assignments,
          transitions: s.transitions, allocation: s.allocation, role_map: s.role_map, source_blocks: s.source_blocks,
        },
        status: 'documented', approval_level: 'documented', enrichment_status: 'partial', content_sha256: 'hash123',
      },
    ]);
    trackFindAll.mockResolvedValue(s.tracks); // already track-shaped
    reqFindAll.mockResolvedValue(s.requirements.map((r) => ({ ...r, canonical_req_id: r.id }))); // DB row uses canonical_req_id

    const res = await request(app).get(`/api/admin/factory/contract/${UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.isSample).toBe(false);
    expect(res.body.deliveryProjectId).toBe(UUID);
    expect(res.body.gate.ok).toBe(true);                 // the sample subset is gate-clean
    expect(res.body.compliance).toHaveLength(4);          // requirements reconstructed from the rows
    expect(res.body.allocation).toHaveLength(4);
    expect(res.body.approval).toEqual({
      status: 'documented', level: 'documented', version: 2, trackType: 'solution_build', enrichmentStatus: 'partial', contentHash: 'hash123',
    });
  });
});

describe('POST /api/admin/factory/contract/:id/approve', () => {
  const body = { trackType: 'solution_build', expectedVersion: 1, level: 'documented', enrichmentStatus: 'partial' };

  it('approves and returns the dto; approvedBy + revisionId come from the token/params, not the body', async () => {
    approveProcessDocument.mockResolvedValue({ id: 'doc-2', version: 2, status: 'documented' });
    const res = await request(app).post(`/api/admin/factory/contract/${UUID}/approve`).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 2, status: 'documented' });
    const arg = approveProcessDocument.mock.calls[0][0];
    expect(arg.approvedBy).toBe('admin@test');            // from the JWT, never the body
    expect(arg.revisionId).toBe(`${UUID}:solution_build:1`);
    expect(arg.level).toBe('documented');
  });

  it('maps a stale expected_version to 409 with currentVersion', async () => {
    approveProcessDocument.mockRejectedValue(new ApprovalConflictError(5));
    const res = await request(app).post(`/api/admin/factory/contract/${UUID}/approve`).send(body);
    expect(res.status).toBe(409);
    expect(res.body.currentVersion).toBe(5);
  });

  it('maps a gate-blocked document to 422 with the issues', async () => {
    approveProcessDocument.mockRejectedValue(new ApprovalGateError([{ code: 'PERFORMER', message: 'x', severity: 'error' }]));
    const res = await request(app).post(`/api/admin/factory/contract/${UUID}/approve`).send(body);
    expect(res.status).toBe(422);
    expect(res.body.issues[0].code).toBe('PERFORMER');
  });

  it('maps no-document to 404 and an illegal transition to 409', async () => {
    approveProcessDocument.mockRejectedValueOnce(new Error('no process document to approve'));
    let res = await request(app).post(`/api/admin/factory/contract/${UUID}/approve`).send(body);
    expect(res.status).toBe(404);
    approveProcessDocument.mockRejectedValueOnce(new Error('illegal approval transition draft -> full'));
    res = await request(app).post(`/api/admin/factory/contract/${UUID}/approve`).send(body);
    expect(res.status).toBe(409);
  });

  it('400s a bad body (missing level) without calling the engine', async () => {
    const res = await request(app).post(`/api/admin/factory/contract/${UUID}/approve`).send({ trackType: 'x', expectedVersion: 1, enrichmentStatus: 'partial' });
    expect(res.status).toBe(400);
    expect(approveProcessDocument).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/factory/contract/:id/request-changes', () => {
  it('records a change request (201) with requestedBy from the token', async () => {
    requestChanges.mockResolvedValue({ id: 'rev-1', decision: 'changes_requested' });
    const res = await request(app).post(`/api/admin/factory/contract/${UUID}/request-changes`).send({ trackType: 'solution_build', reviewedVersion: 1, reason: 'tighten the oversight' });
    expect(res.status).toBe(201);
    expect(requestChanges.mock.calls[0][0].requestedBy).toBe('admin@test');
  });

  it('400s a blank reason (Zod) and records nothing', async () => {
    const res = await request(app).post(`/api/admin/factory/contract/${UUID}/request-changes`).send({ trackType: 'solution_build', reviewedVersion: 1, reason: '' });
    expect(res.status).toBe(400);
    expect(requestChanges).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/factory/contracts', () => {
  it('lists projects with a persisted decomposition, latest per project, with names', async () => {
    docFindAll.mockResolvedValue([
      { delivery_project_id: 'dp-1', track_type: 'solution_build', version: 2, status: 'documented' },
      { delivery_project_id: 'dp-1', track_type: 'proposal', version: 1, status: 'draft' },
      { delivery_project_id: 'dp-2', track_type: 'solution_build', version: 1, status: 'draft' },
    ]);
    projectFindAll.mockResolvedValue([{ id: 'dp-1', name: 'Contract A' }, { id: 'dp-2', name: 'Contract B' }]);
    const res = await request(app).get('/api/admin/factory/contracts');
    expect(res.status).toBe(200);
    expect(res.body.contracts).toHaveLength(2); // one row per project (latest)
    expect(res.body.contracts.find((c: any) => c.deliveryProjectId === 'dp-1')).toMatchObject({ name: 'Contract A', version: 2 });
  });
});

describe('GET /api/admin/factory/opportunities', () => {
  const container = { tenant: { id: 'ten-1' }, org: { id: 'org-1' } };
  const liveFeed = {
    opportunities: [
      { uuid: 'u1', title: 'A', agency: 'X', closeDate: null, fitScore: 70, estimatedValue: 100, sourceUrl: null },
      { uuid: 'u2', title: 'B', agency: 'Y', closeDate: null, fitScore: 80, estimatedValue: 200, sourceUrl: null },
    ],
    source: 'live', snapshotDate: null, snapshotReason: null, totalAvailable: 50,
  };

  it('returns the best-fit feed from the client (source + snapshotDate passthrough)', async () => {
    fetchBestFitOpportunities.mockResolvedValue({
      opportunities: [{ uuid: 'u1', title: 'A', agency: 'X', closeDate: null, fitScore: 70, estimatedValue: 100, sourceUrl: null }],
      source: 'snapshot', snapshotDate: '2026-06-08',
    });
    const res = await request(app).get('/api/admin/factory/opportunities');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('snapshot');
    expect(res.body.snapshotDate).toBe('2026-06-08');
    expect(res.body.opportunities).toHaveLength(1);
  });

  it('filters out actively-dismissed keys and reports totalAvailable + dismissedCount', async () => {
    fetchBestFitOpportunities.mockResolvedValue(liveFeed);
    lookupGovContractsContainer.mockResolvedValue(container);
    listActiveDismissedKeys.mockResolvedValue(new Set(['u1'])); // u1 dismissed for this team
    const res = await request(app).get('/api/admin/factory/opportunities');
    expect(res.status).toBe(200);
    expect(res.body.opportunities.map((o: any) => o.uuid)).toEqual(['u2']);
    expect(res.body.dismissedCount).toBe(1);
    expect(res.body.totalAvailable).toBe(50);
    expect(listActiveDismissedKeys).toHaveBeenCalledWith('ten-1'); // tenant-scoped
  });

  it('serves the UNFILTERED feed (dismissedCount 0) when the gov container is not configured — discovery stays up', async () => {
    fetchBestFitOpportunities.mockResolvedValue(liveFeed);
    lookupGovContractsContainer.mockResolvedValue(null);
    const res = await request(app).get('/api/admin/factory/opportunities');
    expect(res.status).toBe(200);
    expect(res.body.opportunities).toHaveLength(2);
    expect(res.body.dismissedCount).toBe(0);
    expect(listActiveDismissedKeys).not.toHaveBeenCalled();
  });

  it('serves the UNFILTERED feed when the dismissal lookup throws (non-fatal)', async () => {
    fetchBestFitOpportunities.mockResolvedValue(liveFeed);
    lookupGovContractsContainer.mockResolvedValue(container);
    listActiveDismissedKeys.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/admin/factory/opportunities');
    expect(res.status).toBe(200);
    expect(res.body.opportunities).toHaveLength(2); // filter failure must not hide the feed
    expect(res.body.dismissedCount).toBe(0);
  });
});

describe('POST /api/admin/factory/opportunities/:key/dismiss — team-scoped, idempotent, fail-closed', () => {
  const container = { tenant: { id: 'ten-1' }, org: { id: 'org-1' } };
  beforeEach(() => { lookupGovContractsContainer.mockResolvedValue(container); });

  it('dismisses an opportunity (200) with tenant/org + actor from the token, not the body', async () => {
    dismissOpportunity.mockResolvedValue({ id: 'd1', opportunity_key: 'u1', restored_at: null });
    const res = await request(app).post('/api/admin/factory/opportunities/u1/dismiss').send({ reason: 'out of scope', title: 'A', agency: 'X' });
    expect(res.status).toBe(200);
    expect(res.body.dismissed).toMatchObject({ opportunity_key: 'u1' });
    const arg = dismissOpportunity.mock.calls[0][0];
    expect(arg).toMatchObject({ tenantId: 'ten-1', organizationId: 'org-1', opportunityKey: 'u1', dismissedBy: 'admin@test', reason: 'out of scope' });
  });

  it('is idempotent at the route: a second dismiss of the same key still returns 200', async () => {
    dismissOpportunity.mockResolvedValue({ id: 'd1', opportunity_key: 'u1', restored_at: null });
    const r1 = await request(app).post('/api/admin/factory/opportunities/u1/dismiss').send({});
    const r2 = await request(app).post('/api/admin/factory/opportunities/u1/dismiss').send({});
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(dismissOpportunity).toHaveBeenCalledTimes(2);
  });

  it('FAILS CLOSED (503) when the gov container is unresolvable — never dismisses', async () => {
    lookupGovContractsContainer.mockResolvedValue(null);
    const res = await request(app).post('/api/admin/factory/opportunities/u1/dismiss').send({});
    expect(res.status).toBe(503);
    expect(dismissOpportunity).not.toHaveBeenCalled();
  });

  it('400s a too-long opportunity key (never dismisses)', async () => {
    const res = await request(app).post(`/api/admin/factory/opportunities/${'x'.repeat(201)}/dismiss`).send({});
    expect(res.status).toBe(400);
    expect(dismissOpportunity).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/factory/opportunities/:key/restore — reversible, fail-closed', () => {
  const container = { tenant: { id: 'ten-1' }, org: { id: 'org-1' } };
  beforeEach(() => { lookupGovContractsContainer.mockResolvedValue(container); });

  it('restores an opportunity (200), tenant-scoped', async () => {
    restoreOpportunity.mockResolvedValue({ id: 'd1', opportunity_key: 'u1', restored_at: new Date().toISOString() });
    const res = await request(app).post('/api/admin/factory/opportunities/u1/restore').send({});
    expect(res.status).toBe(200);
    expect(restoreOpportunity.mock.calls[0][0]).toMatchObject({ tenantId: 'ten-1', opportunityKey: 'u1' });
  });

  it('FAILS CLOSED (503) when the gov container is unresolvable', async () => {
    lookupGovContractsContainer.mockResolvedValue(null);
    const res = await request(app).post('/api/admin/factory/opportunities/u1/restore').send({});
    expect(res.status).toBe(503);
    expect(restoreOpportunity).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/factory/opportunities/:uuid/start — PHASE 1 qualification guard + tenant isolation (server-enforced)', () => {
  const uuid = '2e287828-9040-4948-98fe-a0250a5d66a5';
  // The read-only lookup's return shape: fixed refactored tenant + scoped org + engagement.
  const container = { tenant: { id: 'ten-1', name: 'refactored' }, org: { id: 'org-1', tenant_id: 'ten-1' }, engagement: { id: 'eng-1', tenant_id: 'ten-1', organization_id: 'org-1' } };
  beforeEach(() => { lookupGovContractsContainer.mockResolvedValue(container); });

  it('BLOCKS a NEW government pursuit: 409 qualificationRequired, creates NO project and NO tracks', async () => {
    govProjFindOne.mockResolvedValue(null); // no existing gov-<uuid> project in the gov container
    const res = await request(app).post(`/api/admin/factory/opportunities/${uuid}/start`).send({ title: 'Agenda RFP', agency: 'Harris County' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ qualificationRequired: true });
    expect(res.body.error).toMatch(/qualification/i);
    // the whole point: a direct POST cannot create a new government project or backfill tracks
    expect(govProjCreate).not.toHaveBeenCalled();
    expect(backfillUnassessedContract).not.toHaveBeenCalled();
  });

  it('PRESERVES access to an EXISTING gov project: returns it (200, created:false), creates/changes nothing', async () => {
    govProjFindOne.mockResolvedValue({ id: 'dp-gov-1' }); // one of the two existing government projects
    const res = await request(app).post(`/api/admin/factory/opportunities/${uuid}/start`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deliveryProjectId: 'dp-gov-1', created: false });
    expect(govProjCreate).not.toHaveBeenCalled();          // never creates
    expect(backfillUnassessedContract).not.toHaveBeenCalled(); // never re-backfills / mutates the existing project
  });

  it('RECORD-LEVEL ISOLATION: the lookup is scoped to the gov container tenant/org + government class', async () => {
    govProjFindOne.mockResolvedValue({ id: 'dp-gov-1' });
    await request(app).post(`/api/admin/factory/opportunities/${uuid}/start`).send({});
    // slug alone is unique only per tenant; the query MUST also pin tenant_id + organization_id + class,
    // so a same-slug project in another tenant/org/class can never be resolved by this route.
    const where = govProjFindOne.mock.calls[0][0].where;
    expect(where).toMatchObject({
      slug: `gov-${uuid}`,
      tenant_id: 'ten-1',
      organization_id: 'org-1',
      project_class: 'government_public_sector',
    });
  });

  it('CROSS-TENANT NEGATIVE: a gov-<uuid> project in a different tenant is NOT returned (scoped query misses it -> 409)', async () => {
    // Simulate the DB: a project with this slug exists in ANOTHER tenant, so the tenant/org/class-scoped
    // findOne returns null. The route must 409, never leak the other tenant's project id.
    govProjFindOne.mockResolvedValue(null);
    const res = await request(app).post(`/api/admin/factory/opportunities/${uuid}/start`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ qualificationRequired: true });
    // and it was a SCOPED lookup, not a bare slug lookup
    expect(govProjFindOne.mock.calls[0][0].where).toMatchObject({ tenant_id: 'ten-1', organization_id: 'org-1', project_class: 'government_public_sector' });
  });

  it('FAILS CLOSED when the gov container is not configured: 503, creates nothing, does not even look up a project', async () => {
    lookupGovContractsContainer.mockResolvedValue(null); // read-only lookup returns null (missing tenant/org/engagement)
    const res = await request(app).post(`/api/admin/factory/opportunities/${uuid}/start`).send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
    expect(govProjFindOne).not.toHaveBeenCalled();   // no project lookup once the container is unresolved
    expect(govProjCreate).not.toHaveBeenCalled();
    expect(backfillUnassessedContract).not.toHaveBeenCalled();
  });

  it('400s an invalid opportunity id (never creates, never looks up)', async () => {
    const res = await request(app).post('/api/admin/factory/opportunities/not-a-uuid/start').send({});
    expect(res.status).toBe(400);
    expect(govProjCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/factory/contract/:id/ingest-proposal — upload the solicitation zip', () => {
  it('ingests a .zip and returns the counts (200)', async () => {
    ingestProposal.mockResolvedValue({ requirements: 3, blocks: 5, fileName: 'RFP.zip' });
    const res = await request(app)
      .post(`/api/admin/factory/contract/${UUID}/ingest-proposal`)
      .attach('proposal', Buffer.from('PK fake zip bytes'), 'RFP.zip');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requirements: 3, blocks: 5, fileName: 'RFP.zip' });
    expect(ingestProposal.mock.calls[0][0]).toBe(UUID);
  });

  it('rejects a non-zip file (400, never ingests)', async () => {
    const res = await request(app)
      .post(`/api/admin/factory/contract/${UUID}/ingest-proposal`)
      .attach('proposal', Buffer.from('x'), 'RFP.pdf');
    expect(res.status).toBe(400);
    expect(ingestProposal).not.toHaveBeenCalled();
  });

  it('rejects a missing file (400)', async () => {
    const res = await request(app).post(`/api/admin/factory/contract/${UUID}/ingest-proposal`);
    expect(res.status).toBe(400);
    expect(ingestProposal).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/factory/contract/:id/generate — run the generation engine', () => {
  it('returns 200 accepted when the decomposition is gate-clean', async () => {
    generateDecomposition.mockResolvedValue({ status: 'generated', errorCount: 0 });
    const res = await request(app).post(`/api/admin/factory/contract/${UUID}/generate`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true, errorCount: 0 });
    expect(generateDecomposition).toHaveBeenCalledWith(UUID);
  });

  it('returns 422 with the issue count when the result is gate-dirty (never a fake pass)', async () => {
    generateDecomposition.mockResolvedValue({ status: 'rejected', errorCount: 2, issues: [{ code: 'START' }, { code: 'END' }] });
    const res = await request(app).post(`/api/admin/factory/contract/${UUID}/generate`);
    expect(res.status).toBe(422);
    expect(res.body.errorCount).toBe(2);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('returns 409 when the generation engine is off', async () => {
    generateDecomposition.mockResolvedValue({ status: 'disabled' });
    const res = await request(app).post(`/api/admin/factory/contract/${UUID}/generate`);
    expect(res.status).toBe(409);
    expect(res.body.generationDisabled).toBe(true);
  });

  it('400s an invalid delivery project id (never generates)', async () => {
    const res = await request(app).post('/api/admin/factory/contract/not-a-uuid/generate');
    expect(res.status).toBe(400);
    expect(generateDecomposition).not.toHaveBeenCalled();
  });
});

describe('route-auth — every route is section-gated (required CI lint)', () => {
  it('the source guards every route with requireSection(\'program\')', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'factoryRoutes.ts'), 'utf8');
    const guards = src.match(/requireSection\('program'\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(11); // + opportunities/:key/dismiss, opportunities/:key/restore (prev 9: sample, contract, contracts, approve, request-changes, opportunities, start, ingest-proposal, generate)
  });
});

describe('toContractRequirement — evidence honesty (Phase 6)', () => {
  const base = { canonical_req_id: 'REQ-1', statement: 'x', tracks: ['proposal'] };

  it("maps a null/unknown evidence_state to 'unassessed', never 'planned'", () => {
    expect(toContractRequirement({ ...base, evidence_state: null }).evidence_state).toBe('unassessed');
    expect(toContractRequirement({ ...base }).evidence_state).toBe('unassessed'); // undefined → unassessed
  });

  it("passes an explicit evidence_state through unchanged (incl. 'unassessed')", () => {
    expect(toContractRequirement({ ...base, evidence_state: 'unassessed' }).evidence_state).toBe('unassessed');
    expect(toContractRequirement({ ...base, evidence_state: 'demonstrated' }).evidence_state).toBe('demonstrated');
    expect(toContractRequirement({ ...base, evidence_state: 'planned' }).evidence_state).toBe('planned');
  });
});
