import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

/**
 * A team-scoped "don't show me this opportunity again" record for the v1 gov discovery feed. One row per
 * (tenant_id, opportunity_key); `restored_at IS NULL` means the dismissal is ACTIVE (the row is hidden from the
 * feed). Reversible in place via restore. NOT a qualification decision — it never touches gov_qualifications or any
 * pursuit state. Schema: db/ensureGovOpportunityDismissalSchema.ts.
 */
export interface GovOpportunityDismissalAttributes {
  id?: string;
  tenant_id: string;
  organization_id?: string | null;
  /** OP's stable Bonfire opportunity id (the mapped `uuid`). NEVER a title-derived value. */
  opportunity_key: string;
  title?: string | null;
  agency?: string | null;
  reason?: string | null;
  dismissed_by?: string | null;
  dismissed_at?: Date;
  /** null => active (hidden); non-null => restored (shown again). */
  restored_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

class GovOpportunityDismissal extends Model<GovOpportunityDismissalAttributes> implements GovOpportunityDismissalAttributes {
  declare id: string;
  declare tenant_id: string;
  declare organization_id: string | null;
  declare opportunity_key: string;
  declare title: string | null;
  declare agency: string | null;
  declare reason: string | null;
  declare dismissed_by: string | null;
  declare dismissed_at: Date;
  declare restored_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;
}

GovOpportunityDismissal.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    organization_id: { type: DataTypes.UUID, allowNull: true },
    opportunity_key: { type: DataTypes.TEXT, allowNull: false },
    title: { type: DataTypes.TEXT, allowNull: true },
    agency: { type: DataTypes.TEXT, allowNull: true },
    reason: { type: DataTypes.TEXT, allowNull: true },
    dismissed_by: { type: DataTypes.TEXT, allowNull: true },
    dismissed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    restored_at: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'gov_opportunity_dismissals', timestamps: true, underscored: true },
);

export default GovOpportunityDismissal;
