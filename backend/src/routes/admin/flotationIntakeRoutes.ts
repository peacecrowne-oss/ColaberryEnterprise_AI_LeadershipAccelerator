/**
 * The admin door into the one intake.
 *
 *     "on the management side of the internship admin page ... as an admin, I can create the
 *      project myself so I test the processes (that must stay in sync) and understand the
 *      user experience."  (Ali, 2026-09-16)
 *
 * Two endpoints. One lists the understandings that came out of AI Flotation conversations,
 * with who they belong to and whether a build has already been started from them. The other
 * starts that build - through `startBuildFromUnderstanding`, which calls the same
 * `startBuild` the portal wizard does. Nothing here knows how a build works; that is the
 * point.
 *
 * Both are admin-only and both are POST-idempotent: starting the same understanding twice
 * returns the project the first call made.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { z, ZodError } from 'zod';
import { Op } from 'sequelize';
import { requireAdmin } from '../../middlewares/authMiddleware';
import ProjectUnderstandingRecord from '../../models/ProjectUnderstandingRecord';
import { CommunicationLog, Enrollment, Lead } from '../../models';
import { startBuildFromUnderstanding } from '../../services/delivery/buildFromUnderstanding';
import { runIntakeTurn } from '../../services/delivery/projectIntake';
import { DOCUMENT_TEXT_MAX } from '../../services/delivery/intakeDocuments';
import { intakeDocumentUpload } from '../../config/upload';
import { extractTextFromBuffer } from '../../services/fileExtractionService';
import { requestInstantCallback } from '../../services/callbackRequestService';
import { COLABERRY_BRAND } from '../../services/voiceCallPrompt';
import { reconcileFlotationCall } from '../../services/delivery/flotationCallCompletion';

/** The brand whose intake this is. The call is scripted and routed by this slug. */
const FLOTATION_SOURCE = 'ai-flotation';

const router = Router();

/**
 * The understandings an admin can build from, newest first.
 *
 * Joins the lead (for the person) and the enrolment (for where the build would land) by
 * email, because the understanding carries a lead_id and the build needs an enrolment - and
 * the two are only ever linked through the person's address.
 */
router.get('/api/admin/flotation/understandings', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const records: any[] = await ProjectUnderstandingRecord.findAll({
      where: { status: 'extracted' },
      order: [['scope_generated_at', 'DESC NULLS LAST'], ['revision', 'DESC']],
      limit: 100,
    });

    const leadIds = [...new Set(records.map((r) => r.lead_id).filter(Boolean))];
    const leads: any[] = leadIds.length ? await Lead.findAll({ where: { id: { [Op.in]: leadIds } } }) : [];
    const leadById = new Map(leads.map((l) => [l.id, l]));

    const emails = [...new Set(leads.map((l) => String(l.email || '').toLowerCase()).filter(Boolean))];
    const enrollments: any[] = emails.length ? await Enrollment.findAll({ where: { email: { [Op.in]: emails } } }) : [];
    const enrollmentByEmail = new Map(enrollments.map((e) => [String(e.email || '').toLowerCase(), e]));

    // Which of these builds has actually been published to the person.
    //
    // Builds are held for review now, so "has a project" and "they can see it" are two
    // different facts and the row has to carry both — a list that says "built" for a plan
    // still waiting on a reviewer is telling the reviewer their job is done. ONE query for
    // all of them rather than one per row: this list runs to a hundred.
    const projectIds = records
      .map((r) => (r.build_handoff || (r.scope as any)?.build || null)?.project_id)
      .filter(Boolean) as string[];
    // FAILS SOFT. This decides a badge; the list is the thing the page is for. A reviewer
    // who cannot see their enquiries because a status lookup broke is strictly worse off
    // than one whose badges all read "held".
    const publishedIds = new Set<string>();
    if (projectIds.length) {
      try {
        const { sequelize } = await import('../../config/database');
        const [rows] = await sequelize.query(
          `select distinct project_id from build_plans where status = 'published' and project_id in (:ids)`,
          { replacements: { ids: projectIds } },
        );
        for (const row of rows as Array<{ project_id: string }>) publishedIds.add(row.project_id);
      } catch (err: any) {
        console.warn('[AdminIntake] could not read which builds are published:', err?.message);
      }
    }

    res.json({
      understandings: records.map((r) => {
        const lead = r.lead_id ? leadById.get(r.lead_id) : null;
        const enrollment = lead ? enrollmentByEmail.get(String(lead.email || '').toLowerCase()) : null;
        const build = r.build_handoff || (r.scope as any)?.build || null;
        return {
          id: r.id,
          title: r.title,
          source: r.source,
          items: (r.items || []).length,
          confirmed_at: r.confirmed_at,
          lead: lead ? { id: lead.id, name: lead.name, email: lead.email, company: lead.company } : null,
          enrollment: enrollment ? { id: enrollment.id, tier: enrollment.tier, cohort_id: enrollment.cohort_id } : null,
          build: build
            ? {
              project_id: build.project_id,
              started_at: build.started_at,
              /** Published and materialised, so the person can actually see it. */
              assigned: publishedIds.has(build.project_id),
            }
            : null,
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const startSchema = z.object({
  /** Where the project lands. Defaults to the enrolment matching the lead's email. */
  enrollment_id: z.string().uuid().optional(),
  /** §17. Off by default until the confirmation UI exists; an admin can insist. */
  require_confirmed: z.boolean().optional(),
});

/**
 * Start a build from an understanding. Same pipeline as the portal wizard, entered from
 * the management side.
 */
router.post('/api/admin/flotation/understandings/:id/build', requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = startSchema.parse(req.body || {});

    let enrollmentId = body.enrollment_id;
    if (!enrollmentId) {
      const record: any = await ProjectUnderstandingRecord.findByPk(req.params.id as string);
      if (!record) return res.status(404).json({ error: 'understanding not found' });
      const lead: any = record.lead_id ? await Lead.findByPk(record.lead_id) : null;
      const enrollment: any = lead?.email ? await Enrollment.findOne({ where: { email: String(lead.email).toLowerCase() } }) : null;
      if (!enrollment) {
        return res.status(409).json({
          error: 'no enrolment for this understanding — pass enrollment_id, or make sure the enquiry produced a prospect account',
        });
      }
      enrollmentId = enrollment.id;
    }

    // HELD, exactly as the conversation door holds.
    //
    //     "the Build this project button should be the same across the admin and student
    //      side ... built the exact same."  (Ali, 2026-09-30)
    //
    // Both admin surfaces start a build; before this they disagreed about what happened
    // next, and nothing on screen said which one you were getting. An admin building for
    // somebody else reviews first, wherever the button was.
    const result = await startBuildFromUnderstanding({
      holdForReview: true,
      recordId: req.params.id as string,
      enrollmentId: enrollmentId!,
      requireConfirmed: body.require_confirmed === true,
    });

    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : result.reason === 'failed' ? 500 : 409;
      return res.status(status).json({ error: result.error, reason: result.reason });
    }

    return res.status(result.reused ? 200 : 202).json(result);
  } catch (err: any) {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.issues });
    return res.status(500).json({ error: err.message });
  }
});

/**
 * The interview itself, from the management side.
 *
 *     "I want that same exact intake on the Mgmt side so I can build projects for students."
 *
 * The admin plays the customer and names the student the project is for. Everything else -
 * the interviewer, the bound on the transcript, the extraction, the automatic build - is
 * `runIntakeTurn`, the same function the public /start page calls. There is no admin
 * version of the interview to drift; there is one interview and this is its second door.
 *
 * Stateless, like the public door: the client carries the transcript and posts the whole
 * thing each turn. The session id is minted client-side and becomes the extraction's
 * idempotency key, so a repeated final turn cannot produce a second understanding.
 */
const turnSchema = z.object({
  enrollment_id: z.string().uuid(),
  session_id: z.string().uuid(),
  turns: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(4000) }))
    .min(1)
    .max(30),
  /**
   * Documents attached during the conversation, already extracted to text by
   * `/intake/document`. Carried by the client and re-sent each turn, like the
   * transcript, because this endpoint holds nothing between turns.
   *
   * The ceilings here are the schema's outer bound; `runIntakeTurn` re-bounds with
   * `boundDocuments`, which is the one that decides what actually reaches a prompt.
   * Two layers deliberately: a validation ceiling that rejects nonsense, and a service
   * ceiling that cannot be bypassed by a future door that forgets to validate.
   */
  documents: z
    .array(z.object({ name: z.string().min(1).max(200), text: z.string().min(1).max(50_000) }))
    .max(6)
    .optional(),
});

router.post('/api/admin/flotation/intake/turn', requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = turnSchema.parse(req.body || {});

    const enrollment: any = await Enrollment.findByPk(body.enrollment_id);
    if (!enrollment) return res.status(404).json({ error: 'enrolment not found' });

    const result = await runIntakeTurn({
      turns: body.turns,
      // The student is the person the project is for, so the interviewer addresses them.
      facts: { name: enrollment.full_name || null, company: enrollment.company || null, role: null },
      sourceRef: `admin:${body.session_id}`,
      leadId: null,
      buildFor: { kind: 'enrollment', enrollmentId: enrollment.id },
      documents: body.documents,
      // HELD. This door is a reviewer building for somebody else, and the reviewer has to
      // be able to read the plan before the intern does — otherwise the approval is
      // theatre over a plan already on their Projects page. The public door does not pass
      // this and still publishes itself.
      holdForReview: true,
    });

    return res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.issues });
    console.error('[AdminIntake] error:', err?.message);
    return res.status(500).json({ error: 'We could not continue the conversation right now.' });
  }
});

/**
 * Read a document so the interview can use it.
 *
 *     "Also I should be able to add documents to this process that can be analyzed
 *      before submitting the next question and can be used when creating the
 *      requirements."  (Ali, 2026-09-29)
 *
 * EXTRACTION ONLY. It takes a file, returns its text, and keeps nothing — no row, no
 * disk, no id to look up later. The client holds the text and sends it with each turn,
 * which is what keeps the turn endpoint stateless and a reload resumable.
 *
 * "Before submitting the next question" is why this is its own call rather than a field
 * on the turn: the person attaches, sees what was read, and only then types. Parsing on
 * the turn instead would mean discovering a scanned PDF yielded nothing at the moment
 * they were expecting an answer.
 *
 * An unreadable file is a 422 that says so. A document that extracted to nothing is the
 * common real failure — a scan with no text layer — and returning 200 with an empty
 * string would attach a document that silently contributes nothing to the requirements.
 */
router.post(
  '/api/admin/flotation/intake/document',
  requireAdmin,
  // Multer's own refusals — wrong type, over 15MB — arrive as an error it hands to
  // `next()`, which without this reaches Express's default handler and answers HTML with
  // a 500. A refused file type is a 400 the person can act on, and the filter already
  // wrote the sentence that tells them which types work.
  (req: Request, res: Response, next: NextFunction) => {
    intakeDocumentUpload.single('file')(req, res, (err: any) => {
      if (!err) return next();
      const tooBig = err?.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        error: tooBig ? 'That file is over 15MB. Attach a smaller one, or paste the relevant part.' : err.message,
        error_class: tooBig ? 'FileTooLarge' : 'RejectedFileType',
      });
    });
  },
  async (req: Request, res: Response) => {
    const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
    if (!file) return res.status(400).json({ error: 'Attach a file.' });

    const name = String(file.originalname || 'Untitled document').slice(0, 200);

    try {
      const text = (await extractTextFromBuffer(file.buffer, name)).trim();

      if (!text) {
        return res.status(422).json({
          error: `I could not read any text out of ${name}. If it is a scan, it has no text layer — `
            + 'paste the important parts into the conversation instead.',
          error_class: 'NoTextExtracted',
        });
      }

      const clipped = text.length > DOCUMENT_TEXT_MAX;
      return res.status(200).json({
        document: { name, text: text.slice(0, DOCUMENT_TEXT_MAX) },
        chars: Math.min(text.length, DOCUMENT_TEXT_MAX),
        // Said out loud, because a clipped document that reports success is how a
        // requirement goes missing while everything looks fine.
        clipped,
      });
    } catch (err: any) {
      console.error('[AdminIntake] document extraction failed', {
        error_class: err instanceof Error ? err.constructor.name : 'Unknown',
        message: err?.message,
        name,
      });
      return res.status(422).json({
        error: `I could not read ${name}. Try a PDF, Word or plain-text version.`,
        error_class: 'ExtractionFailed',
      });
    }
  },
);

/** Students an admin can build for, by name or email. */
router.get('/api/admin/flotation/intake/enrollments', requireAdmin, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json({ enrollments: [] });

    const rows: any[] = await Enrollment.findAll({
      where: {
        [Op.or]: [
          { email: { [Op.iLike]: `%${q}%` } },
          { full_name: { [Op.iLike]: `%${q}%` } },
        ],
      },
      limit: 12,
      order: [['created_at', 'DESC']],
    });

    return res.json({
      enrollments: rows.map((e) => ({ id: e.id, full_name: e.full_name, email: e.email, tier: e.tier, cohort_id: e.cohort_id })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * The spoken interview, from the management side.
 *
 *     "I want the exact same setup (deterministic) as AI flotation - that includes voice
 *      intake."  (Ali, 2026-09-16)
 *
 * This places the same call a prospect gets from "Call me now" on /start: the same
 * `requestInstantCallback`, the same consent, dedup and safety gates, the same completion
 * webhook - which then runs the same `finishIntake` the typed interview ends with. Two
 * things are stamped on the call when it is placed: which student the project is for, and
 * the business the agent names - Colaberry here (COLABERRY_BRAND), not AI Flotation, since
 * this door is run from the Colaberry side for an intern. The script is otherwise identical.
 *
 * The phone is whoever should be on the line. To test the experience, an admin gives
 * their own number and plays the customer; the project still lands in the student's
 * portal, because the enrolment - not the phone - says where it goes.
 */
const callSchema = z.object({
  enrollment_id: z.string().uuid(),
  phone: z.string().min(7).max(50),
  /** What the project is, in a sentence - the agent opens with it, as it does on /start. */
  idea: z.string().max(5000).optional(),
});

router.post('/api/admin/flotation/intake/call', requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = callSchema.parse(req.body || {});

    const enrollment: any = await Enrollment.findByPk(body.enrollment_id);
    if (!enrollment) return res.status(404).json({ error: 'enrolment not found' });
    if (!enrollment.email) return res.status(409).json({ error: 'this enrolment has no email, and the call is keyed on one' });

    const correlationId = randomUUID();
    const result = await requestInstantCallback(
      {
        name: enrollment.full_name || 'there',
        email: String(enrollment.email).toLowerCase(),
        phone: body.phone,
        source: FLOTATION_SOURCE,
        company: enrollment.company || undefined,
        message: body.idea || undefined,
        consent_contact: true,
      },
      correlationId,
      // This intake is run from the Colaberry side for an intern, so the agent
      // names Colaberry, not AI Flotation — same plumbing, correct business name.
      { enrollmentId: enrollment.id, requestedBy: 'admin', brand: COLABERRY_BRAND },
    );

    // The honesty contract from the routing action: a call was placed, or here is why not.
    const status =
      result.status === 'call_initiated' || result.status === 'deduplicated' ? 200
      : result.status === 'failed' ? 502
      : 409;
    return res.status(status).json({ ...result, correlation_id: correlationId });
  } catch (err: any) {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.issues });
    console.error('[AdminIntake] call error:', err?.message);
    return res.status(500).json({ error: 'We could not place that call right now.' });
  }
});

/**
 * Where a call has got to: ringing, ended, written up, building. The page polls this after
 * placing a call, because the vendor talks to the webhook, not to the browser.
 */
router.get('/api/admin/flotation/intake/call/:callId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const callId = String(req.params.callId || '').trim();
    if (!callId || callId.length > 128) return res.status(400).json({ error: 'call id required' });

    let commLog: any = await CommunicationLog.findOne({ where: { provider: 'synthflow', provider_message_id: callId } });
    if (!commLog) return res.status(404).json({ error: 'call not found' });

    // Still `sent`? Ask Synthflow rather than wait for a webhook that may never come - the
    // same completion runs either way, so the page sees the same thing it would have.
    let live: string | null = null;
    if (commLog.status === 'sent') {
      const out = await reconcileFlotationCall(callId);
      if (out.reconciled) commLog = await CommunicationLog.findOne({ where: { provider: 'synthflow', provider_message_id: callId } });
      else if (out.reason === 'still_active') live = out.status ?? 'in-progress';
    }

    const record: any = await ProjectUnderstandingRecord.findOne({ where: { source: 'voice_transcript', source_ref: callId } });
    const build = record?.build_handoff || record?.scope?.build || null;
    const transcript = String(commLog.provider_response?.transcript || '');

    return res.json({
      call: {
        // 'sent' = placed, 'delivered' = ended and the transcript is in, 'failed' = did not complete.
        status: commLog.status,
        /** Synthflow's own word for where the call is while still `sent`: ringing, in-progress. */
        live_status: live,
        duration: commLog.provider_response?.duration ?? null,
        has_transcript: transcript.length > 0,
        // The conversation itself, so the page can show it where the typed one would be.
        transcript: transcript.slice(0, 20_000),
        end_reason: commLog.provider_response?.end_call_reason ?? null,
      },
      understanding: record ? { id: record.id, status: record.status, title: record.title, items: (record.items || []).length } : null,
      build: build ? { project_id: build.project_id, started_at: build.started_at } : null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/flotation/import-repo
 *
 *     "Also allow me to add projects that aren't connected to the system, but I
 *      can give you the repo to read and upload the project."  (Ali, 2026-09-29)
 *
 * A THIRD way into the same pipeline, beside the conversation and the wizard.
 * The repository becomes a brief and the brief goes through `startBuild`, so an
 * imported project lands with the same releases, stories and requirements as
 * any other and shows up on the same board with the same case-study score.
 *
 * Held for review: a plan assembled from somebody's README wants a human read
 * before it reaches their Projects page.
 *
 * 202, because generation runs on the queue and is minutes long. The response
 * says which documents were actually read, so a thin plan can be traced to a
 * thin repository rather than blamed on the decomposer.
 */
router.post('/api/admin/flotation/import-repo', requireAdmin, async (req: Request, res: Response) => {
  const repoUrl = String(req.body?.repo_url ?? '').trim();
  const enrollmentId = String(req.body?.enrollment_id ?? '').trim();
  if (!repoUrl || !enrollmentId) {
    return res.status(400).json({ error: 'A repository and the person it belongs to are both required.' });
  }
  try {
    // Imported HERE, not at the top of the file. The import service reaches
    // projectService and therefore config/database, and both flotation route
    // suites mock the database away — a top-level import makes real Sequelize
    // load before their mocks apply and the whole suite fails to run. Same
    // reasoning as sbpOrchestrator's deferred alertService import.
    const { importProjectFromRepo } = await import('../../services/delivery/repoProjectImport');
    const result = await importProjectFromRepo({
      repoUrl,
      enrollmentId,
      name: typeof req.body?.name === 'string' ? req.body.name : null,
      size: typeof req.body?.size === 'string' ? req.body.size : null,
    });
    return res.status(202).json(result);
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: status >= 500 ? 'error' : 'warn', service: 'backend',
      event: 'repo_project_import_failed', outcome: 'failure',
      error_class: err?.error_class ?? err?.constructor?.name ?? 'Error',
      context: { repo_url: repoUrl.slice(0, 200), message: err?.message },
    }));
    return res.status(status).json({
      error: status >= 500 ? 'Could not import that repository.' : String(err?.message ?? 'Could not import that repository.'),
    });
  }
});

export default router;
