/**
 * govOpportunityDismissals — the team-scoped "hide this discovered candidate" service for the v1 gov feed.
 *
 * A dismissal is a soft, reversible hide for the WHOLE team (per tenant), NOT a qualification decision: it touches
 * only gov_opportunity_dismissals and never gov_qualifications, delivery_projects, or any pursuit state. One row per
 * (tenant_id, opportunity_key); `restored_at IS NULL` means ACTIVE (hidden). dismiss/restore are idempotent — the
 * same call twice yields the same end state, with no duplicate row (UNIQUE(tenant_id, opportunity_key) guards it).
 *
 * The model is lazy-loaded inside each function so importing this module never initializes the ORM (same pattern as
 * govQualification / govOpportunityAlias).
 */

/** A Postgres unique-violation surfaced through Sequelize (name or pg code 23505) — used for the create race. */
function isUniqueViolation(err: any): boolean {
  return err?.name === 'SequelizeUniqueConstraintError'
    || err?.original?.code === '23505'
    || err?.parent?.code === '23505';
}

export interface DismissOpportunityInput {
  tenantId: string;
  organizationId?: string | null;
  /** OP's stable Bonfire opportunity id (the mapped `uuid`). NEVER a title-derived value. */
  opportunityKey: string;
  title?: string | null;
  agency?: string | null;
  reason?: string | null;
  dismissedBy: string;
}

/**
 * Hide an opportunity from the team's feed. Idempotent upsert: if a row already exists for (tenant, key) it is
 * REACTIVATED in place (restored_at → null, dismissed_by/at refreshed) rather than duplicated — so re-dismissing,
 * or dismissing a previously restored key, is safe. Create races (two concurrent first-dismisses) are caught via
 * the unique index and resolved by falling back to the update path.
 */
export async function dismissOpportunity(input: DismissOpportunityInput): Promise<any> {
  const { default: GovOpportunityDismissal } = await import('../../../models/GovOpportunityDismissal');
  const where = { tenant_id: input.tenantId, opportunity_key: input.opportunityKey };

  const applyActive = async (row: any): Promise<any> => {
    row.restored_at = null;
    row.dismissed_at = new Date();
    if (input.dismissedBy) row.dismissed_by = input.dismissedBy;
    if (input.reason !== undefined) row.reason = input.reason ?? null;
    if (input.title) row.title = input.title;
    if (input.agency) row.agency = input.agency;
    await row.save();
    return row.get ? row.get() : row;
  };

  const existing: any = await GovOpportunityDismissal.findOne({ where });
  if (existing) return applyActive(existing);

  try {
    const row: any = await GovOpportunityDismissal.create({
      tenant_id: input.tenantId, organization_id: input.organizationId ?? null, opportunity_key: input.opportunityKey,
      title: input.title ?? null, agency: input.agency ?? null, reason: input.reason ?? null,
      dismissed_by: input.dismissedBy, dismissed_at: new Date(), restored_at: null,
    });
    return row.get ? row.get() : row;
  } catch (err: any) {
    if (!isUniqueViolation(err)) throw err;
    // A concurrent dismiss won the insert; reactivate the row it created.
    const raced: any = await GovOpportunityDismissal.findOne({ where });
    if (!raced) throw err;
    return applyActive(raced);
  }
}

export interface RestoreOpportunityInput { tenantId: string; opportunityKey: string; }

/**
 * Un-hide an opportunity (recovery). Idempotent: sets restored_at if the row is active, returns the already-restored
 * row unchanged, and returns null when there is nothing to restore (no row for this tenant+key).
 */
export async function restoreOpportunity(input: RestoreOpportunityInput): Promise<any | null> {
  const { default: GovOpportunityDismissal } = await import('../../../models/GovOpportunityDismissal');
  const existing: any = await GovOpportunityDismissal.findOne({
    where: { tenant_id: input.tenantId, opportunity_key: input.opportunityKey },
  });
  if (!existing) return null;
  if (existing.restored_at) return existing.get ? existing.get() : existing;
  existing.restored_at = new Date();
  await existing.save();
  return existing.get ? existing.get() : existing;
}

/**
 * The set of opportunity keys ACTIVELY dismissed for this tenant (restored_at IS NULL). The feed subtracts this set.
 * Tenant-scoped: never returns another tenant's dismissals.
 */
export async function listActiveDismissedKeys(tenantId: string): Promise<Set<string>> {
  const { default: GovOpportunityDismissal } = await import('../../../models/GovOpportunityDismissal');
  const rows: any[] = await GovOpportunityDismissal.findAll({
    where: { tenant_id: tenantId, restored_at: null },
    attributes: ['opportunity_key'],
  });
  const keys = new Set<string>();
  for (const r of rows) {
    const k = r?.opportunity_key ?? (r?.get ? r.get('opportunity_key') : undefined);
    if (typeof k === 'string' && k) keys.add(k);
  }
  return keys;
}

/**
 * The active dismissals for this tenant, newest first, as plain rows for the "Dismissed — manage" view. Tenant-scoped.
 */
export async function listActiveDismissals(tenantId: string): Promise<any[]> {
  const { default: GovOpportunityDismissal } = await import('../../../models/GovOpportunityDismissal');
  const rows: any[] = await GovOpportunityDismissal.findAll({
    where: { tenant_id: tenantId, restored_at: null },
    order: [['dismissed_at', 'DESC']],
  });
  return rows.map((r) => (r?.get ? r.get() : r));
}
