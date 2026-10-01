import { GOV_OPPORTUNITY_DISMISSAL_STATEMENTS, REQUIRED_TABLES } from '../ensureGovOpportunityDismissalSchema';
import { modelsByTable, modelColumnNames, parseCreatedTables } from './schemaParityHelpers';
// Register the model so sequelize.models knows it (Model.init needs no DB connection).
import '../../models/GovOpportunityDismissal';

/**
 * DDL/model parity + additive-only guarantee for the team-scoped gov-opportunity dismissal table. A dropped write
 * here would let a "dismissed" opportunity reappear (or a duplicate row defeat the idempotent upsert), so the
 * UNIQUE(tenant_id, opportunity_key) target and the DDL↔model column agreement are asserted explicitly.
 */
describe('ensureGovOpportunityDismissalSchema — DDL and model agree', () => {
  const created = parseCreatedTables(GOV_OPPORTUNITY_DISMISSAL_STATEMENTS);

  it('creates exactly the one expected table', () => {
    expect(created.map((c) => c.table).sort()).toEqual([...REQUIRED_TABLES].sort());
  });

  it('every created column is declared as a model attribute', () => {
    const byTable = modelsByTable();
    const missing: string[] = [];
    for (const { table, columns } of created) {
      const model = byTable[table];
      if (!model) continue;
      const mapped = modelColumnNames(model);
      for (const column of columns) if (!mapped.has(column)) missing.push(`${table}.${column}`);
    }
    expect(missing).toEqual([]);
  });

  it('declares no model attribute that the DDL will not create', () => {
    const byTable = modelsByTable();
    const extra: string[] = [];
    for (const { table, columns } of created) {
      const model = byTable[table];
      if (!model) continue;
      const ddl = new Set(columns);
      for (const field of modelColumnNames(model)) if (!ddl.has(field)) extra.push(`${table}.${field}`);
    }
    expect(extra).toEqual([]);
  });

  it('is additive only and idempotent (never ALTER/DROP/RENAME an existing table)', () => {
    const joined = GOV_OPPORTUNITY_DISMISSAL_STATEMENTS.join('\n').toUpperCase();
    expect(joined).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/);
    expect(joined).not.toMatch(/RENAME|ALTER\s+TABLE|TRUNCATE|DELETE\s+FROM/);
    for (const sql of GOV_OPPORTUNITY_DISMISSAL_STATEMENTS) expect(sql).toMatch(/IF\s+NOT\s+EXISTS/i);
  });

  it('introduces NO foreign keys (keyed by tenant_id + OP uuid; no existing table is touched)', () => {
    expect(GOV_OPPORTUNITY_DISMISSAL_STATEMENTS.join('\n')).not.toMatch(/REFERENCES/i);
  });

  it('is idempotent per team+opportunity: UNIQUE on (tenant_id, opportunity_key)', () => {
    const idx = GOV_OPPORTUNITY_DISMISSAL_STATEMENTS.find((s) => s.includes('uq_gov_opp_dismissal_key'));
    expect(idx).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(idx).toMatch(/\(\s*tenant_id\s*,\s*opportunity_key\s*\)/);
  });

  it('carries the team scope + the reversible-hide fields (restored_at distinguishes active vs restored)', () => {
    const mapped = modelColumnNames(modelsByTable()['gov_opportunity_dismissals']);
    for (const col of ['tenant_id', 'organization_id', 'opportunity_key', 'dismissed_by', 'dismissed_at', 'restored_at']) {
      expect(mapped.has(col)).toBe(true);
    }
  });
});
