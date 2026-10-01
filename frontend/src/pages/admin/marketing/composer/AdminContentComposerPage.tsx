import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader, SectionCard } from '../../../../components/admin/shell';
import { listBrands, type Brand } from '../../../../services/adminBrandApi';
import api from '../../../../utils/api';
import * as composer from '../../../../services/contentComposerApi';
import type { ComposerAction, ConfirmationSummary, ContentItem, ContentVariant, ExternalPublication, ItemLink, ItemMedia, ProviderKey, ProviderSummary, PublishingJob, VariantProblem } from '../../../../services/contentComposerApi';
import ComposerSetup, { type CampaignOption, type SetupValues } from './ComposerSetup';
import ComposerMedia, { type UploadState } from './ComposerMedia';
import ComposerVariants from './ComposerVariants';
import ComposerPreview from './ComposerPreview';
import ComposerConfirmation from './ComposerConfirmation';
import ComposerPublishing from './ComposerPublishing';
import { fromCentralInput, toCentralInput } from '../centralTime';
import { listChannelAccounts } from '../../../../services/channelAccountApi';
import {
  channelChoices, connectedProviders, orphanVariantNote, pruneSelection, unavailableNote,
  type ConnectedAccountLike,
} from './channelChoices';
import { mediaGateNote, setupShape } from './setupShape';

/**
 * The marketing composer (spec 8.1). One page, five sections, in the order the work happens:
 *
 *   1. Setup      - brand, campaign, title, landing page, canonical message   (steps 1, 3, 4)
 *   2. Channels   - pick providers, generate variants, edit, links, validate  (steps 2, 5-7)
 *   3. Preview    - desktop / mobile per network                              (step 8)
 *   4. Confirm    - the server-built summary and the four actions             (steps 9-10)
 *   5. Publishing - the queue, handoff packages and receipts                  (section 9)
 *
 * The page owns the item id and the loaded state; every mutation goes to the server and the
 * page re-reads what it needs. Nothing about the content is computed here - variants, limits,
 * links, validation and the confirmation all come back from the API, so what the operator
 * confirms is what the server will act on, not a client-side approximation of it.
 */

/** Blank options are dropped before the backend sees them, so "two filled, one empty" is a valid two-option poll. */
function trimPoll(poll: NonNullable<SetupValues['poll']>): NonNullable<SetupValues['poll']> {
  return { question: poll.question.trim(), options: poll.options.map((o) => o.trim()).filter((o) => o !== ''), durationDays: poll.durationDays };
}

const EMPTY_SETUP: SetupValues = { brand_id: '', campaign_id: '', title: '', destination_url: '', canonical_body: '', content_type: 'text', is_paid: false, has_offer: false, poll: null };

export default function AdminContentComposerPage() {
  const { id: routeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [brands, setBrands] = useState<Brand[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [setup, setSetup] = useState<SetupValues>(EMPTY_SETUP);
  const [item, setItem] = useState<ContentItem | null>(null);
  const [variants, setVariants] = useState<ContentVariant[]>([]);
  const [links, setLinks] = useState<ItemLink[]>([]);
  const [media, setMedia] = useState<ItemMedia[]>([]);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [selected, setSelected] = useState<ProviderKey[]>([]);
  const [problems, setProblems] = useState<Record<string, VariantProblem[]>>({});
  const [confirmation, setConfirmation] = useState<ConfirmationSummary | null>(null);
  const [jobs, setJobs] = useState<PublishingJob[]>([]);
  const [publications, setPublications] = useState<ExternalPublication[]>([]);
  const [scheduledFor, setScheduledFor] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);

  const say = (tone: 'success' | 'danger' | 'info', text: string) => setNotice({ tone, text });
  const fail = (err: unknown, fallback: string) => say('danger', composer.errorMessage(err, fallback));

  // ── Reference data ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    listBrands().then((r) => setBrands(r.brands)).catch(() => setBrands([]));
    composer.listProviders().then(setProviders).catch(() => setProviders([]));
    api.get('/api/admin/campaigns', { params: { limit: 200 } })
      .then((r) => setCampaigns((r.data.campaigns ?? []).map((c: Record<string, unknown>) => ({
        id: String(c.id), name: String(c.name), brand_id: (c.brand_id as string | null) ?? null, utm_campaign_slug: (c.utm_campaign_slug as string | null) ?? null,
      }))))
      .catch(() => setCampaigns([]));
  }, []);

  // ── Load an existing item ───────────────────────────────────────────────────────────────
  const reload = useCallback(async (id: string) => {
    const { item: it, variants: vs } = await composer.getItem(id);
    setItem(it);
    setVariants(vs);
    setSelected(vs.map((v) => v.provider));
    setSetup((s) => ({
      ...s,
      brand_id: it.brand_id ?? '',
      campaign_id: it.campaign_id ?? '',
      title: it.title,
      canonical_body: it.canonical_body ?? '',
      content_type: it.content_type,
      is_paid: Boolean(it.metadata?.isPaid),
      has_offer: Boolean(it.metadata?.hasOffer),
      poll: (it.metadata?.poll as SetupValues['poll']) ?? null,
    }));
    // Central wall clock, not the UTC reading: see centralTime.ts for the drift this caused.
    if (it.scheduled_for) setScheduledFor(toCentralInput(it.scheduled_for));
    const problemMap: Record<string, VariantProblem[]> = {};
    for (const v of vs) problemMap[v.provider] = Array.isArray(v.validation_errors) ? v.validation_errors : [];
    setProblems(problemMap);
    const [conf, js, pubs, med] = await Promise.all([composer.getConfirmation(id), composer.listJobs(id), composer.listPublications(id), composer.listItemMedia(id)]);
    setConfirmation(conf);
    setJobs(js);
    setPublications(pubs);
    setMedia(med);
    setLinks(conf.links.map((l) => ({ provider: l.provider, trackedLinkId: '', shortUrl: l.shortUrl, finalUrl: l.finalUrl, utm: l.utm, reused: true })));
  }, []);

  useEffect(() => {
    if (!routeId) return;
    reload(routeId).catch((err) => fail(err, 'The item could not be loaded.'));
    // eslint-disable-next-line
  }, [routeId]);

  const brand = useMemo(() => brands.find((b) => b.id === setup.brand_id) ?? null, [brands, setup.brand_id]);

  /**
   * What the chosen content type needs. The upload lives in Setup for types that take a file,
   * because that is the moment the operator decided they wanted one - reported 2026-10-01:
   * "the video should be uploaded at the time you select that you want a video."
   */
  const shape = useMemo(() => setupShape(setup.content_type), [setup.content_type]);


  /**
   * Which networks THIS brand can post to. The channel row used to list every network the
   * platform knows about, so a brand with Facebook and Instagram could be given seven variants,
   * four of them with nowhere to go.
   */
  const [brandAccounts, setBrandAccounts] = useState<ConnectedAccountLike[]>([]);
  useEffect(() => {
    if (!setup.brand_id) { setBrandAccounts([]); return; }
    let cancelled = false;
    listChannelAccounts({ brand_id: setup.brand_id })
      .then((rows) => { if (!cancelled) setBrandAccounts(rows); })
      // A failed load must not silently offer everything, which is the bug this replaces.
      .catch(() => { if (!cancelled) setBrandAccounts([]); });
    return () => { cancelled = true; };
  }, [setup.brand_id]);

  const choices = useMemo(
    () => channelChoices(providers, connectedProviders(brandAccounts), Boolean(setup.brand_id)),
    [providers, brandAccounts, setup.brand_id],
  );
  const orphanNote = useMemo(
    () => orphanVariantNote(variants.map((v) => v.provider), choices),
    [variants, choices],
  );
  const channelNote = useMemo(
    () => unavailableNote(choices, Boolean(setup.brand_id), Boolean(item)),
    [choices, setup.brand_id, item],
  );

  /**
   * A tick that is no longer valid must not survive into generation.
   *
   * `selected` IS a dependency, not just `choices`. `reload()` replaces the whole selection with
   * every provider that already has a variant - so after generating, an item carrying variants
   * from before this rule existed put all seven back, checked, including the disabled ones.
   * Watching only `choices` pruned once and then never again, because the brand had not changed.
   * The identity guard below returns the same array when nothing is dropped, so React bails out
   * and this cannot loop.
   */
  useEffect(() => {
    setSelected((s) => {
      const next = pruneSelection(s, choices);
      return next.length === s.length ? s : next;
    });
  }, [choices, selected]);

  // ── First draft from a topic ────────────────────────────────────────────────────────────
  const [draftNotes, setDraftNotes] = useState<{ placeholders: string[]; unverifiedClaims: string[] } | null>(null);

  const draftMessage = async (topic: string) => {
    setBusy(true);
    try {
      const d = await composer.draftCanonicalMessage({
        topic,
        brand_id: setup.brand_id,
        campaign_id: setup.campaign_id || null,
        content_type: setup.content_type,
        is_paid: setup.is_paid,
        has_offer: setup.has_offer,
        destination_url: setup.destination_url || null,
      });
      setSetup((v) => ({ ...v, canonical_body: d.message }));
      setDraftNotes({ placeholders: d.placeholders, unverifiedClaims: d.unverifiedClaims });
      say(
        d.unverifiedClaims.length > 0 ? 'info' : 'success',
        d.unverifiedClaims.length > 0
          ? 'Draft written. Check the flagged specifics before you publish.'
          : 'Draft written. Edit it freely, it is only a starting point.',
      );
    } catch (err) { fail(err, 'The draft could not be written.'); } finally { setBusy(false); }
  };

  // ── Campaign slug (the tracked-link chain's root) ───────────────────────────────────────
  const assignSlug = async (campaignId: string) => {
    setBusy(true);
    try {
      // Send the brand the operator already chose. A campaign with no brand of its own would
      // otherwise dead-end here: the old error told them to set one on a screen that has no
      // field for it.
      const r = await composer.assignCampaignSlug(campaignId, { brand_id: setup.brand_id || null });
      setCampaigns((cs) => cs.map((c) => (
        c.id === campaignId ? { ...c, utm_campaign_slug: r.utm_campaign_slug, brand_id: r.brand_id } : c
      )));
      say('success', `UTM slug assigned: ${r.utm_campaign_slug}`);
    } catch (err) { fail(err, 'The slug could not be assigned.'); } finally { setBusy(false); }
  };

  // ── Step 1/4: create or update the draft ────────────────────────────────────────────────
  const saveSetup = async () => {
    setBusy(true);
    try {
      if (!item) {
        const created = await composer.createDraft({
          brand_id: setup.brand_id, campaign_id: setup.campaign_id || null, title: setup.title,
          canonical_body: setup.canonical_body, content_type: setup.content_type, is_paid: setup.is_paid, has_offer: setup.has_offer,
          ...(setup.content_type === 'poll' && setup.poll ? { poll: trimPoll(setup.poll) } : {}),
        });
        say('success', 'Draft created.');
        navigate(`/admin/marketing/composer/${created.id}`, { replace: true });
      } else {
        await composer.updateItem(item.id, {
          title: setup.title, canonical_body: setup.canonical_body, content_type: setup.content_type,
          // A poll post sends its poll. Any other type sends null ONLY when a poll is left over
          // from a type change - sending null every time would count as a copy change and
          // invalidate the variants on a title-only save.
          ...(setup.content_type === 'poll'
            ? { poll: setup.poll ? trimPoll(setup.poll) : null }
            : item.metadata?.poll ? { poll: null } : {}),
        });
        await reload(item.id);
        say('success', 'Draft saved. Regenerate variants if the message changed.');
      }
    } catch (err) { fail(err, 'The draft could not be saved.'); } finally { setBusy(false); }
  };

  // ── Steps 5-7 ───────────────────────────────────────────────────────────────────────────
  const withItem = (fn: (id: string) => Promise<void>, fallback: string) => async () => {
    if (!item) return;
    setBusy(true);
    try { await fn(item.id); } catch (err) { fail(err, fallback); } finally { setBusy(false); }
  };

  const generate = withItem(async (id) => {
    await composer.generateVariants(id, selected);
    await reload(id);
    say('info', 'Variants generated. Hand-edited copy was kept.');
  }, 'Variants could not be generated.');

  const saveVariant = (provider: ProviderKey, text: string) => withItem(async (id) => {
    await composer.editVariant(id, provider, text);
    await reload(id);
  }, 'The edit could not be saved.')();

  const revertVariant = (provider: ProviderKey) => withItem(async (id) => {
    await composer.revertVariant(id, provider);
    await reload(id);
  }, 'The variant could not be reverted.')();

  // Media. Reload after each change because the attachment count feeds validation (an
  // `image` post with nothing attached is a blocker) and the confirmation's asset list.
  /**
   * Attach a file, creating the draft first if there is not one yet.
   *
   * The upload used to be dead until a draft existed, which read as broken: pick `video`, see a
   * file picker, and nothing happens. Reported 2026-10-01: "None of these buttons work to upload
   * the video." They were disabled, correctly and uselessly.
   *
   * The draft is a prerequisite of the API, not of the operator's intent, so the page satisfies
   * it rather than demanding it. An empty internal title - the only other required field -
   * defaults to the file's own name, which is a better guess than an empty box and is editable.
   */
  const attachMedia = async (file: File, altText: string) => {
    if (!setup.brand_id) { say('danger', 'Choose a brand before attaching a file.'); return; }
    setBusy(true);
    setUpload({ name: file.name, sent: 0, total: file.size });
    try {
      let id = item?.id ?? null;
      if (!id) {
        const title = setup.title.trim() || file.name.replace(/\.[^.]+$/, '');
        const created = await composer.createDraft({
          brand_id: setup.brand_id, campaign_id: setup.campaign_id || null, title,
          canonical_body: setup.canonical_body, content_type: setup.content_type,
          is_paid: setup.is_paid, has_offer: setup.has_offer,
          ...(setup.content_type === 'poll' && setup.poll ? { poll: trimPoll(setup.poll) } : {}),
        });
        id = created.id;
        setSetup((prev) => ({ ...prev, title }));
        navigate(`/admin/marketing/composer/${created.id}`, { replace: true });
      }
      const next = await composer.attachMedia(id, file, altText, (sent, total) => setUpload({ name: file.name, sent, total }));
      setMedia(next);
      await reload(id);
      say('success', `Attached. ${next.length} media item${next.length === 1 ? '' : 's'} on this post.`);
    } catch (err) {
      fail(err, 'The file could not be attached.');
    } finally {
      setUpload(null);
      setBusy(false);
    }
  };

  const detachMedia = (mediaAssetId: string) => withItem(async (id) => {
    setMedia(await composer.detachMedia(id, mediaAssetId));
    await reload(id);
  }, 'The file could not be removed.')();

  const makeLinks = withItem(async (id) => {
    const ls = await composer.generateLinks(id, setup.destination_url);
    setLinks(ls);
    await reload(id);
    say('success', `${ls.length} tracked link${ls.length === 1 ? '' : 's'} ready.`);
  }, 'Tracked links could not be generated.');

  const validate = withItem(async (id) => {
    const r = await composer.validateItem(id);
    await reload(id);
    say(r.ok ? 'success' : 'danger', r.ok ? 'Every platform passed.' : `${r.providers.blockers.length} blocker(s) - see each variant.`);
  }, 'Validation could not run.');

  // ── Steps 9-10 ──────────────────────────────────────────────────────────────────────────
  const setTime = withItem(async (id) => {
    await composer.updateItem(id, { scheduled_for: scheduledFor ? fromCentralInput(scheduledFor) : null });
    await reload(id);
  }, 'The time could not be saved.');

  const act = (action: ComposerAction) => withItem(async (id) => {
    const r = await composer.runAction(id, action, action === 'schedule' && scheduledFor ? (fromCentralInput(scheduledFor) ?? undefined) : undefined);
    await reload(id);
    const jobs = r.jobs.length ? ` ${r.jobs.filter((j) => j.created).length} job(s) queued.` : '';
    say('success', `${action.replace(/_/g, ' ')}: item is now ${r.item.status.replace(/_/g, ' ')}.${jobs}`);
  }, 'The action was refused.')();

  // ── Reviewer ────────────────────────────────────────────────────────────────────────────
  const decide = (decision: 'approved' | 'changes_requested' | 'rejected') => withItem(async (id) => {
    const r = await composer.decideApproval(id, decision, null);
    await reload(id);
    say('success', `Decision recorded: ${decision.replace(/_/g, ' ')}. Item is now ${r.item.status.replace(/_/g, ' ')}.`);
  }, 'The decision was refused.')();

  // ── Queue ───────────────────────────────────────────────────────────────────────────────
  const retry = (jobId: string) => withItem(async (id) => { await composer.retryJob(jobId); await reload(id); }, 'Retry was refused.')();
  const cancel = (jobId: string) => withItem(async (id) => { await composer.cancelJob(jobId, null); await reload(id); }, 'Cancel was refused.')();
  const complete = (pubId: string, externalId: string, permalink: string | null) => withItem(async (id) => {
    await composer.completeHandoff(pubId, externalId, permalink);
    await reload(id);
    say('success', 'Handoff completed; the post is recorded as live.');
  }, 'The handoff could not be completed.')();
  const runNow = withItem(async (id) => {
    const r = await composer.runQueueNow();
    await reload(id);
    say(r.halted ? 'danger' : 'info', r.halted ? `Queue halted: ${r.haltReason}.` : `Queue ran: ${r.published} published, ${r.retried} retrying, ${r.failed + r.deadLettered} failed.`);
  }, 'The queue could not be run.');

  return (
    <div className="admin-page">
      <PageHeader
        title={item ? `Composer: ${item.title}` : 'New post'}
        subtitle="Draft once, publish per network - with tracked links, validation and a confirmation you can read."
        icon="quill-pen-line"
        breadcrumb={[{ label: 'Marketing', to: '/admin/marketing' }, { label: 'Composer' }]}
        trust={{ level: item ? 'live' : 'unverified', source: 'content', updatedAt: item?.updated_at ?? null, summary: item ? `Revision ${item.revision}, ${item.status.replace(/_/g, ' ')}` : 'Not saved yet' }}
      />

      {notice && (
        <div className={`alert alert-${notice.tone} py-2 small`} role="status">{notice.text}</div>
      )}

      <SectionCard title="1. Setup" subtitle="Brand, campaign, landing page and the canonical message." icon="settings-3-line">
        <ComposerSetup
          values={setup} brands={brands} campaigns={campaigns} locked={Boolean(item)} busy={busy}
          onChange={setSetup} onSubmit={saveSetup} onAssignSlug={assignSlug}
          onDraftMessage={draftMessage} draftNotes={draftNotes} providers={providers}
          mediaSlot={shape.mediaRole !== 'none' ? (
            // Inside the content-type column, directly under the type that asked for it.
            // It sat after the whole form until 2026-10-01: "why isn't the video upload closer
            // to where the video is. It seems weird towards the bottom."
            <div className="mt-2" data-testid="setup-media">
              <ComposerMedia media={media} busy={busy} enabled={Boolean(item)} upload={upload} onAttach={attachMedia} onDetach={detachMedia} />
            </div>
          ) : null}
        />
      </SectionCard>

      <SectionCard title="2. Channels and variants" subtitle="Pick networks, generate, edit, add tracked links, validate." icon="share-line">
        {/* Greyed boxes explained once, above the row, rather than only in seven tooltips. */}
        {channelNote && <div className="small text-warning-emphasis mb-2" data-testid="channel-note">{channelNote}</div>}
        {orphanNote && <div className="small text-warning-emphasis mb-2" data-testid="orphan-variant-note">{orphanNote}</div>}
        <div className="d-flex flex-wrap gap-3 mb-3">
          {choices.map((c) => (
            <label key={c.provider} className={`form-check small ${c.selectable ? '' : 'text-muted'}`} title={c.reason ?? undefined}>
              <input className="form-check-input" type="checkbox" disabled={!item || busy || !c.selectable}
                checked={selected.includes(c.provider)}
                data-testid={`channel-${c.provider}`}
                onChange={(e) => setSelected((s) => e.target.checked ? [...s, c.provider] : s.filter((x) => x !== c.provider))} />
              <span className="form-check-label ms-1">
                {c.displayName}{c.handoff ? ' (handoff)' : ''}
                {!c.selectable && <span className="ms-1">- not connected</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="d-flex flex-wrap gap-2 mb-3">
          <button type="button" className="btn btn-sm btn-primary" disabled={!item || busy || selected.length === 0} onClick={generate}>Generate variants</button>
          <button type="button" className="btn btn-sm btn-outline-primary" disabled={!item || busy || variants.length === 0 || !setup.destination_url} onClick={makeLinks}>Generate tracked links</button>
          <button type="button" className="btn btn-sm btn-outline-dark" disabled={!item || busy || variants.length === 0} onClick={validate}>Validate</button>
        </div>
        <ComposerVariants variants={variants} providers={providers} links={links} problems={problems} busy={busy} onSave={saveVariant} onRevert={revertVariant} />
      </SectionCard>

      <SectionCard title="3. Preview" subtitle="Desktop and mobile, per network." icon="eye-line">
        <ComposerPreview variants={variants} providers={providers} links={links} mediaCount={confirmation?.assets.length ?? 0} media={media} brandName={brand?.name ?? 'Brand'} poll={setup.content_type === 'poll' ? setup.poll : null} />
      </SectionCard>

      <SectionCard title="4. Confirm" subtitle="What will go out, where, and when (Central time)." icon="checkbox-circle-line">
        {item && (
          <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
            <div>
              <label className="form-label small mb-1" htmlFor="composer-scheduled-for">Scheduled time (Central)</label>
              <input id="composer-scheduled-for" type="datetime-local" className="form-control form-control-sm" value={scheduledFor} disabled={busy} onChange={(e) => setScheduledFor(e.target.value)} />
            </div>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={setTime}>Set time</button>
          </div>
        )}
        {confirmation
          ? <ComposerConfirmation summary={confirmation} busy={busy} onAction={act} />
          : <p className="text-muted mb-0">Create the draft to see the confirmation.</p>}
        {item?.status === 'ready_for_review' && (
          <div className="d-flex flex-wrap gap-2 align-items-center mt-3 pt-3 border-top" data-testid="reviewer-actions">
            <span className="small text-muted">Reviewer:</span>
            <button type="button" className="btn btn-sm btn-success" disabled={busy} onClick={() => decide('approved')}>Approve</button>
            <button type="button" className="btn btn-sm btn-outline-warning" disabled={busy} onClick={() => decide('changes_requested')}>Request changes</button>
            <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => decide('rejected')}>Reject</button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="5. Publishing" subtitle="The queue per network, handoff packages to post by hand, and receipts." icon="send-plane-line">
        <ComposerPublishing jobs={jobs} publications={publications} busy={busy} onRetry={retry} onCancel={cancel} onCompleteHandoff={complete} onRunNow={runNow} />
      </SectionCard>
    </div>
  );
}
