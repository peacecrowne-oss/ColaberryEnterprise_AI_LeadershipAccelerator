/**
 * ensureGovOpportunityDismissalSchema — the team-scoped "don't show me this opportunity again" record, additive.
 *
 * A reviewer can eliminate a discovered v1 candidate so it stops appearing in the discovery feed for the WHOLE
 * team (per tenant, not per user). This is a soft, reversible hide — NOT a qualification decision and NOT a no-bid:
 * it never touches gov_qualifications, delivery_projects, or any pursuit state. One row per (tenant, opportunity),
 * reactivated-or-restored in place (no second row), so dismiss/restore are idempotent.
 *
 *   gov_opportunity_dismissals — tenant_id + opportunity_key (OP's stable Bonfire uuid, NEVER a title) uniquely
 *                                identify a dismissal; restored_at IS NULL means the dismissal is ACTIVE (hidden),
 *                                a non-null restored_at means it was brought back. title/agency are a convenience
 *                                label for the "Dismissed" manager; reason/dismissed_by are audit.
 *
 * Every CREATE is `IF NOT EXISTS`; no existing table is altered — a new table is as safe as new nullable columns.
 */
import { sequelize } from '../config/database';

export const REQUIRED_TABLES: ReadonlyArray<string> = ['gov_opportunity_dismissals'];

/** Every DDL statement, hoisted so a test can assert the whole set is additive (CREATE ... IF NOT EXISTS only). */
export const GOV_OPPORTUNITY_DISMISSAL_STATEMENTS: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS gov_opportunity_dismissals (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id UUID NOT NULL,
     organization_id UUID,
     opportunity_key TEXT NOT NULL,
     title TEXT,
     agency TEXT,
     reason TEXT,
     dismissed_by TEXT,
     dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     restored_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // One dismissal row per (tenant, opportunity): the dismiss upsert's ON CONFLICT target, so a re-dismiss (even of
  // a previously restored key) reactivates the SAME row instead of inserting a duplicate.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_opp_dismissal_key
     ON gov_opportunity_dismissals (tenant_id, opportunity_key)`,
  `CREATE INDEX IF NOT EXISTS idx_gov_opp_dismissal_tenant
     ON gov_opportunity_dismissals (tenant_id)`,
];

export async function ensureGovOpportunityDismissalSchema(): Promise<void> {
  for (const sql of GOV_OPPORTUNITY_DISMISSAL_STATEMENTS) {
    try {
      await sequelize.query(sql);
    } catch (err: any) {
      console.warn('[DB] gov opportunity dismissal schema stmt skipped:', err?.message);
    }
  }
  await assertGovOpportunityDismissalSchema();
}

/** Post-condition: name the table if it failed to appear (bool_or introspection — see ensureGovQualificationSchema). */
export async function assertGovOpportunityDismissalSchema(): Promise<boolean> {
  const problems: string[] = [];
  try {
    const selects = REQUIRED_TABLES.map((t, i) => `bool_or(table_name = '${t}') AS t${i}`).join(', ');
    const [rows] = await sequelize.query(
      `SELECT ${selects} FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const row = (((rows as any[]) || [])[0] || {}) as Record<string, boolean>;
    REQUIRED_TABLES.forEach((t, i) => { if (!row[`t${i}`]) problems.push(`table ${t} missing`); });
  } catch (err: any) {
    problems.push(`schema introspection failed: ${err?.message}`);
  }

  if (problems.length === 0) {
    console.log('[DB] gov opportunity dismissal schema ensured');
    return true;
  }
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(), level: 'error', service: 'backend',
    event: 'gov_opportunity_dismissal_schema_invariant_violated', outcome: 'failure',
    error_class: 'SchemaInvariantViolation',
    context: { problems, impact: 'Gov opportunity dismiss/restore reads/writes will fail.', remedy: 'Run the CREATE statements in ensureGovOpportunityDismissalSchema.' },
  }));
  return false;
}
