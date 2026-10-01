/**
 * The admin door: guarded, idempotent, and it resolves the enrolment the way the enquiry
 * path does - by the person's email - so an admin does not have to know a UUID to try it.
 *
 * REAL auth middleware, mocked models and service. What is being tested is the door, not the
 * pipeline behind it.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.mock('../../../config/env', () => ({
  env: { jwtSecret: 'test-secret', nodeEnv: 'test' },
}));
jest.mock('../../../services/aiEventService', () => ({
  emitAiEvent: jest.fn().mockResolvedValue(undefined),
}));

const mockRecordFindAll = jest.fn();
const mockRecordFindByPk = jest.fn();
const mockLeadFindAll = jest.fn();
const mockLeadFindByPk = jest.fn();
const mockEnrollmentFindAll = jest.fn();
const mockEnrollmentFindOne = jest.fn();
const mockEnrollmentFindByPk = jest.fn();
const mockStart = jest.fn();
const mockTurn = jest.fn();

jest.mock('../../../models/ProjectUnderstandingRecord', () => ({
  __esModule: true,
  default: {
    findAll: (...a: any[]) => mockRecordFindAll(...a),
    findByPk: (...a: any[]) => mockRecordFindByPk(...a),
  },
}));
jest.mock('../../../models', () => ({
  Lead: { findAll: (...a: any[]) => mockLeadFindAll(...a), findByPk: (...a: any[]) => mockLeadFindByPk(...a) },
  Enrollment: {
    findAll: (...a: any[]) => mockEnrollmentFindAll(...a),
    findOne: (...a: any[]) => mockEnrollmentFindOne(...a),
    findByPk: (...a: any[]) => mockEnrollmentFindByPk(...a),
  },
  CommunicationLog: { findOne: jest.fn() },
}));
jest.mock('../../../services/delivery/buildFromUnderstanding', () => ({
  startBuildFromUnderstanding: (...a: any[]) => mockStart(...a),
}));
jest.mock('../../../services/delivery/projectIntake', () => ({
  runIntakeTurn: (...a: any[]) => mockTurn(...a),
}));
// The voice door lives in the same file and is tested in flotationIntakeCallRoutes.test.ts;
// here it only needs to not drag the real database config in through its import.
jest.mock('../../../services/callbackRequestService', () => ({ requestInstantCallback: jest.fn() }));
jest.mock('../../../services/delivery/flotationCallCompletion', () => ({ reconcileFlotationCall: jest.fn() }));
// The parser itself is not the door's business; what IS its business is what it does with
// text, with no text, and with a parser that threw.
const mockExtract = jest.fn();
jest.mock('../../../services/fileExtractionService', () => ({
  extractTextFromBuffer: (...a: any[]) => mockExtract(...a),
}));
// The list asks which builds are published so a row can say "assigned" rather than
// "held". Mocked rather than removed, so the query is actually exercised here.
const mockQuery = jest.fn();
jest.mock('../../../config/database', () => ({
  sequelize: { query: (...a: any[]) => mockQuery(...a) },
}));

import flotationIntakeRoutes from '../flotationIntakeRoutes';

const app = express();
app.use(express.json());
app.use(flotationIntakeRoutes);

const ADMIN = jwt.sign({ sub: 'staff-1', email: 'staff@colaberry.com', role: 'admin' }, 'test-secret');
const REC = '11111111-1111-4111-8111-111111111111';
const ENR = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
  mockRecordFindAll.mockResolvedValue([]);
  mockLeadFindAll.mockResolvedValue([]);
  mockEnrollmentFindAll.mockResolvedValue([]);
  mockQuery.mockResolvedValue([[]]);
  mockStart.mockResolvedValue({ ok: true, projectId: 'proj-1', correlationId: 'c', status: 'generating', reused: false, intake: { name: 'x', answers: [], dropped: [] } });
});

describe('auth', () => {
  it('refuses the list without a token', async () => {
    expect((await request(app).get('/api/admin/flotation/understandings')).status).toBe(401);
  });

  it('refuses a build without a token', async () => {
    expect((await request(app).post(`/api/admin/flotation/understandings/${REC}/build`).send({})).status).toBe(401);
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/flotation/understandings', () => {
  it('joins the person and where their build would land, and says whether one exists', async () => {
    mockRecordFindAll.mockResolvedValue([
      { id: REC, title: 'Tool Loan Management System', source: 'chat', items: [1, 2, 3], confirmed_at: null, lead_id: 42, scope: { build: { project_id: 'proj-9', started_at: '2026-09-16T00:00:00Z' } } },
    ]);
    mockLeadFindAll.mockResolvedValue([{ id: 42, name: 'Marta', email: 'Marta@Northside.test', company: 'Northside' }]);
    mockEnrollmentFindAll.mockResolvedValue([{ id: ENR, email: 'marta@northside.test', tier: 'guest', cohort_id: 'cohort-p' }]);

    const res = await request(app).get('/api/admin/flotation/understandings').set('Authorization', `Bearer ${ADMIN}`);

    expect(res.status).toBe(200);
    expect(res.body.understandings[0]).toMatchObject({
      id: REC,
      items: 3,
      lead: { id: 42, email: 'Marta@Northside.test' },
      enrollment: { id: ENR, tier: 'guest' },
      build: { project_id: 'proj-9' },
    });
  });

  it('reads the hand-off from its own column first, and from the old scope key for older rows', async () => {
    mockRecordFindAll.mockResolvedValue([
      { id: 'new', title: 'New', source: 'chat', items: [], confirmed_at: null, lead_id: 1, build_handoff: { project_id: 'proj-col', started_at: 't1' }, scope: { version: 3 } },
      { id: 'old', title: 'Old', source: 'chat', items: [], confirmed_at: null, lead_id: 1, build_handoff: null, scope: { build: { project_id: 'proj-legacy', started_at: 't0' } } },
    ]);
    mockLeadFindAll.mockResolvedValue([{ id: 1, name: 'Marta', email: 'marta@northside.test', company: null }]);

    const res = await request(app).get('/api/admin/flotation/understandings').set('Authorization', `Bearer ${ADMIN}`);

    expect(res.body.understandings.map((u: any) => u.build.project_id)).toEqual(['proj-col', 'proj-legacy']);
  });

  it('lists only extracted understandings', async () => {
    await request(app).get('/api/admin/flotation/understandings').set('Authorization', `Bearer ${ADMIN}`);
    expect(mockRecordFindAll).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'extracted' } }));
  });

  describe('assigned — "has a project" and "they can see it" are different facts', () => {
    const twoRows = () => {
      mockRecordFindAll.mockResolvedValue([
        { id: 'a', title: 'Published one', source: 'chat', items: [], confirmed_at: null, lead_id: 1, build_handoff: { project_id: 'proj-live', started_at: 't1' } },
        { id: 'b', title: 'Held one', source: 'chat', items: [], confirmed_at: null, lead_id: 1, build_handoff: { project_id: 'proj-held', started_at: 't2' } },
      ]);
      mockLeadFindAll.mockResolvedValue([{ id: 1, name: 'Marta', email: 'marta@northside.test', company: null }]);
    };

    it('says assigned only for the build that actually published', async () => {
      // Builds are held for review now, so a row reading "built" for a plan still waiting
      // on a reviewer tells that reviewer their job is already done.
      twoRows();
      mockQuery.mockResolvedValue([[{ project_id: 'proj-live' }]]);

      const res = await request(app).get('/api/admin/flotation/understandings').set('Authorization', `Bearer ${ADMIN}`);

      expect(res.status).toBe(200);
      expect(res.body.understandings.map((u: any) => [u.build.project_id, u.build.assigned]))
        .toEqual([['proj-live', true], ['proj-held', false]]);
    });

    it('asks ONCE for all of them, not once per row', async () => {
      // This list runs to a hundred; a query per row is a page that times out.
      twoRows();
      await request(app).get('/api/admin/flotation/understandings').set('Authorization', `Bearer ${ADMIN}`);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('still returns the list when that lookup fails, with the badge unknown', async () => {
      // It decides a badge. A reviewer who cannot see their enquiries at all because a
      // status query broke is strictly worse off than one whose badges read "held".
      twoRows();
      mockQuery.mockRejectedValue(new Error('relation "build_plans" does not exist'));

      const res = await request(app).get('/api/admin/flotation/understandings').set('Authorization', `Bearer ${ADMIN}`);

      expect(res.status).toBe(200);
      expect(res.body.understandings).toHaveLength(2);
      expect(res.body.understandings.every((u: any) => u.build.assigned === false)).toBe(true);
    });

    it('does not ask at all when nothing has been built', async () => {
      mockRecordFindAll.mockResolvedValue([
        { id: 'c', title: 'Unbuilt', source: 'chat', items: [], confirmed_at: null, lead_id: 1, build_handoff: null, scope: {} },
      ]);
      mockLeadFindAll.mockResolvedValue([{ id: 1, name: 'Marta', email: 'marta@northside.test', company: null }]);

      await request(app).get('/api/admin/flotation/understandings').set('Authorization', `Bearer ${ADMIN}`);

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});

describe('POST /api/admin/flotation/understandings/:id/build', () => {
  it('starts the build on the enrolment given', async () => {
    const res = await request(app)
      .post(`/api/admin/flotation/understandings/${REC}/build`)
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ enrollment_id: ENR });

    expect(res.status).toBe(202);
    expect(mockStart).toHaveBeenCalledWith({ recordId: REC, enrollmentId: ENR, requireConfirmed: false, holdForReview: true });
  });

  it('HOLDS it, the same as the conversation door, so both admin buttons behave alike', async () => {
    // "the Build this project button should be the same across the admin and student
    // side ... built the exact same." Before this, one door held and the other published
    // straight to the student, and nothing on screen said which you were pressing.
    await request(app)
      .post(`/api/admin/flotation/understandings/${REC}/build`)
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ enrollment_id: ENR });

    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ holdForReview: true }));
  });

  it('finds the enrolment by the lead\'s email when none is given - the way the enquiry path does', async () => {
    mockRecordFindByPk.mockResolvedValue({ id: REC, lead_id: 42 });
    mockLeadFindByPk.mockResolvedValue({ id: 42, email: 'Marta@Northside.test' });
    mockEnrollmentFindOne.mockResolvedValue({ id: ENR });

    const res = await request(app).post(`/api/admin/flotation/understandings/${REC}/build`).set('Authorization', `Bearer ${ADMIN}`).send({});

    expect(res.status).toBe(202);
    expect(mockEnrollmentFindOne).toHaveBeenCalledWith({ where: { email: 'marta@northside.test' } });
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ enrollmentId: ENR }));
  });

  it('says plainly when there is nowhere for the build to land', async () => {
    mockRecordFindByPk.mockResolvedValue({ id: REC, lead_id: 42 });
    mockLeadFindByPk.mockResolvedValue({ id: 42, email: 'nobody@x.test' });
    mockEnrollmentFindOne.mockResolvedValue(null);

    const res = await request(app).post(`/api/admin/flotation/understandings/${REC}/build`).set('Authorization', `Bearer ${ADMIN}`).send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no enrolment/);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('answers a repeat with 200 and the earlier project, not a second build', async () => {
    mockStart.mockResolvedValue({ ok: true, projectId: 'proj-earlier', correlationId: 'c', status: 'already_started', reused: true, intake: { name: 'x', answers: [], dropped: [] } });

    const res = await request(app).post(`/api/admin/flotation/understandings/${REC}/build`).set('Authorization', `Bearer ${ADMIN}`).send({ enrollment_id: ENR });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reused: true, projectId: 'proj-earlier' });
  });

  it('passes the §17 insistence through, and maps the refusal to 409', async () => {
    mockStart.mockResolvedValue({ ok: false, reason: 'not_confirmed', error: 'not confirmed' });

    const res = await request(app).post(`/api/admin/flotation/understandings/${REC}/build`).set('Authorization', `Bearer ${ADMIN}`).send({ enrollment_id: ENR, require_confirmed: true });

    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ requireConfirmed: true }));
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('not_confirmed');
  });

  it('rejects a malformed enrollment id before touching anything', async () => {
    const res = await request(app).post(`/api/admin/flotation/understandings/${REC}/build`).set('Authorization', `Bearer ${ADMIN}`).send({ enrollment_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/flotation/intake/turn - the interview, from the management side', () => {
  const turns = [{ role: 'user', text: 'We run a repair cafe and track loans on paper.' }];

  beforeEach(() => {
    mockEnrollmentFindByPk.mockResolvedValue({ id: ENR, full_name: 'Marta Okafor', company: 'Northside Repair Cafe', email: 'marta@northside.test' });
    mockTurn.mockResolvedValue({ done: false, message: 'Who runs the desk?', exchanges: 1 });
  });

  it('refuses without a token', async () => {
    const res = await request(app).post('/api/admin/flotation/intake/turn').send({ enrollment_id: ENR, session_id: SESSION, turns });
    expect(res.status).toBe(401);
    expect(mockTurn).not.toHaveBeenCalled();
  });

  it('runs the ONE intake for the named student, addressed by their name', async () => {
    const res = await request(app).post('/api/admin/flotation/intake/turn').set('Authorization', `Bearer ${ADMIN}`).send({ enrollment_id: ENR, session_id: SESSION, turns });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ done: false, message: 'Who runs the desk?', exchanges: 1 });
    expect(mockTurn).toHaveBeenCalledWith({
      turns,
      facts: { name: 'Marta Okafor', company: 'Northside Repair Cafe', role: null },
      sourceRef: `admin:${SESSION}`,
      leadId: null,
      buildFor: { kind: 'enrollment', enrollmentId: ENR },
      documents: undefined,
      // This door holds; see "HOLDS the build for review" below for why.
      holdForReview: true,
    });
  });

  it('passes the finished result through untouched, project and all', async () => {
    mockTurn.mockResolvedValue({ done: true, message: 'Thanks.', understanding: 'created', understanding_id: REC, build: { started: true, project_id: 'proj-1' } });

    const res = await request(app).post('/api/admin/flotation/intake/turn').set('Authorization', `Bearer ${ADMIN}`).send({ enrollment_id: ENR, session_id: SESSION, turns });

    expect(res.status).toBe(200);
    expect(res.body.build).toEqual({ started: true, project_id: 'proj-1' });
  });

  it('404s an unknown student before running anything', async () => {
    mockEnrollmentFindByPk.mockResolvedValue(null);
    const res = await request(app).post('/api/admin/flotation/intake/turn').set('Authorization', `Bearer ${ADMIN}`).send({ enrollment_id: ENR, session_id: SESSION, turns });
    expect(res.status).toBe(404);
    expect(mockTurn).not.toHaveBeenCalled();
  });

  it.each([
    ['no turns', { enrollment_id: ENR, session_id: SESSION, turns: [] }],
    ['a bad role', { enrollment_id: ENR, session_id: SESSION, turns: [{ role: 'system', text: 'x' }] }],
    ['an over-long turn', { enrollment_id: ENR, session_id: SESSION, turns: [{ role: 'user', text: 'x'.repeat(4001) }] }],
    ['a non-uuid session', { enrollment_id: ENR, session_id: 'sess-1', turns }],
    ['no enrolment', { session_id: SESSION, turns }],
  ])('400s %s at the boundary', async (_name, body) => {
    const res = await request(app).post('/api/admin/flotation/intake/turn').set('Authorization', `Bearer ${ADMIN}`).send(body);
    expect(res.status).toBe(400);
    expect(mockTurn).not.toHaveBeenCalled();
  });

  it('answers a thrown intake with a plain sentence, not the stack', async () => {
    mockTurn.mockRejectedValue(new Error('ECONNRESET upstream'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await request(app).post('/api/admin/flotation/intake/turn').set('Authorization', `Bearer ${ADMIN}`).send({ enrollment_id: ENR, session_id: SESSION, turns });
    expect(res.status).toBe(500);
    expect(res.body.error).not.toContain('ECONNRESET');
    errSpy.mockRestore();
  });
});

describe('GET /api/admin/flotation/intake/enrollments - finding the student', () => {
  it('needs at least two characters, so a keystroke does not scan the table', async () => {
    const res = await request(app).get('/api/admin/flotation/intake/enrollments?q=m').set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);
    expect(res.body.enrollments).toEqual([]);
    expect(mockEnrollmentFindAll).not.toHaveBeenCalled();
  });

  it('matches name or email, case-insensitively, and returns what the picker needs', async () => {
    mockEnrollmentFindAll.mockResolvedValue([{ id: ENR, full_name: 'Marta Okafor', email: 'marta@northside.test', tier: 'guest', cohort_id: 'c1', password_hash: 'never' }]);

    const res = await request(app).get('/api/admin/flotation/intake/enrollments?q=MARTA').set('Authorization', `Bearer ${ADMIN}`);

    expect(res.status).toBe(200);
    expect(res.body.enrollments).toEqual([{ id: ENR, full_name: 'Marta Okafor', email: 'marta@northside.test', tier: 'guest', cohort_id: 'c1' }]);
    const where = mockEnrollmentFindAll.mock.calls[0][0].where;
    const branches = Object.getOwnPropertySymbols(where).map((sym) => (where as any)[sym])[0];
    expect(branches).toHaveLength(2);
    const pattern = (o: any) => Object.getOwnPropertySymbols(o).map((sym) => o[sym])[0];
    expect(pattern(branches[0].email)).toBe('%marta%');
    expect(pattern(branches[1].full_name)).toBe('%marta%');
  });

  it('refuses without a token', async () => {
    expect((await request(app).get('/api/admin/flotation/intake/enrollments?q=marta')).status).toBe(401);
  });
});

/**
 * POST /intake/document — reading a document so the interview can use it.
 *
 *     "Also I should be able to add documents to this process that can be analyzed
 *      before submitting the next question and can be used when creating the
 *      requirements."  (Ali, 2026-09-29)
 *
 * The door's whole job is to turn a file into text and refuse honestly when it cannot.
 * The failure that matters is the QUIET one: a scan with no text layer parses fine,
 * returns an empty string, and would otherwise attach a document that contributes
 * nothing to the requirements while the screen says it worked.
 */
describe('POST /api/admin/flotation/intake/document', () => {
  const doc = () => Buffer.from('REQ-1: every dispatch is logged.');

  beforeEach(() => {
    mockExtract.mockResolvedValue('REQ-1: every dispatch is logged.');
  });

  it('refuses without a token', async () => {
    const res = await request(app)
      .post('/api/admin/flotation/intake/document')
      .attach('file', doc(), 'spec.md');

    expect(res.status).toBe(401);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('returns the text it read, and keeps nothing', async () => {
    const res = await request(app)
      .post('/api/admin/flotation/intake/document')
      .set('Authorization', `Bearer ${ADMIN}`)
      .attach('file', doc(), 'spec.md');

    expect(res.status).toBe(200);
    expect(res.body.document).toEqual({ name: 'spec.md', text: 'REQ-1: every dispatch is logged.' });
    expect(res.body.clipped).toBe(false);
  });

  it('422s a document that extracted to NOTHING, rather than attaching an empty one', async () => {
    // The real failure: a scanned PDF. Parsing succeeds and yields ''. A 200 here would
    // put a document on screen that changes no requirement.
    mockExtract.mockResolvedValue('   ');

    const res = await request(app)
      .post('/api/admin/flotation/intake/document')
      .set('Authorization', `Bearer ${ADMIN}`)
      .attach('file', doc(), 'scan.pdf');

    expect(res.status).toBe(422);
    expect(res.body.error_class).toBe('NoTextExtracted');
    expect(res.body.error).toContain('scan.pdf');
  });

  it('422s a parser failure with a sentence, not a stack', async () => {
    mockExtract.mockRejectedValue(new Error('officeparser exploded at offset 12'));

    const res = await request(app)
      .post('/api/admin/flotation/intake/document')
      .set('Authorization', `Bearer ${ADMIN}`)
      .attach('file', doc(), 'broken.docx');

    expect(res.status).toBe(422);
    expect(res.body.error_class).toBe('ExtractionFailed');
    expect(res.body.error).not.toContain('offset 12');
  });

  it('400s a file type it cannot read text from, with the types that work', async () => {
    // Multer refuses this before the handler runs. Without the error bridge it would
    // reach Express's default handler and answer HTML with a 500.
    const res = await request(app)
      .post('/api/admin/flotation/intake/document')
      .set('Authorization', `Bearer ${ADMIN}`)
      .attach('file', Buffer.from('\x89PNG\r\n'), 'screenshot.png');

    expect(res.status).toBe(400);
    expect(res.body.error_class).toBe('RejectedFileType');
    expect(res.body.error).toMatch(/PDF/);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('400s when no file was attached at all', async () => {
    const res = await request(app)
      .post('/api/admin/flotation/intake/document')
      .set('Authorization', `Bearer ${ADMIN}`);

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('says so when a long document was clipped', async () => {
    mockExtract.mockResolvedValue('z'.repeat(40_000));

    const res = await request(app)
      .post('/api/admin/flotation/intake/document')
      .set('Authorization', `Bearer ${ADMIN}`)
      .attach('file', doc(), 'long.pdf');

    expect(res.status).toBe(200);
    expect(res.body.clipped).toBe(true);
    expect(res.body.document.text.length).toBeLessThan(40_000);
  });
});

describe('the turn carries the documents through', () => {
  const turns = [{ role: 'user', text: 'We run a repair cafe and track loans on paper.' }];
  const documents = [{ name: 'spec.md', text: 'REQ-1: every dispatch is logged.' }];

  beforeEach(() => {
    mockEnrollmentFindByPk.mockResolvedValue({ id: ENR, full_name: 'Marta Okafor', company: null, email: 'marta@northside.test' });
    mockTurn.mockResolvedValue({ done: false, message: 'Who authorises those?', exchanges: 1 });
  });

  it('hands attached documents to the ONE intake, not to something of its own', async () => {
    const res = await request(app)
      .post('/api/admin/flotation/intake/turn')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ enrollment_id: ENR, session_id: SESSION, turns, documents });

    expect(res.status).toBe(200);
    expect(mockTurn).toHaveBeenCalledWith(expect.objectContaining({ documents }));
  });

  it('rejects more documents than the schema allows before anything runs', async () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => ({ name: `d${i}.md`, text: 'content' }));

    const res = await request(app)
      .post('/api/admin/flotation/intake/turn')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ enrollment_id: ENR, session_id: SESSION, turns, documents: tooMany });

    expect(res.status).toBe(400);
    expect(mockTurn).not.toHaveBeenCalled();
  });

  it('HOLDS the build for review, because this door is a reviewer building for someone else', async () => {
    const res = await request(app)
      .post('/api/admin/flotation/intake/turn')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ enrollment_id: ENR, session_id: SESSION, turns });

    expect(res.status).toBe(200);
    expect(mockTurn).toHaveBeenCalledWith(expect.objectContaining({ holdForReview: true }));
  });

  it('still works with no documents at all', async () => {
    const res = await request(app)
      .post('/api/admin/flotation/intake/turn')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ enrollment_id: ENR, session_id: SESSION, turns });

    expect(res.status).toBe(200);
    expect(mockTurn.mock.calls[0][0].documents).toBeUndefined();
  });
});
