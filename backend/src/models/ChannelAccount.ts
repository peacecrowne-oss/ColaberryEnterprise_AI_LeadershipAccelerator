import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

/**
 * ChannelAccount — one connected social account: a Facebook Page, an Instagram professional
 * account, a LinkedIn organization, a YouTube channel, a TikTok or X account.
 *
 * Columns must match backend/src/db/ensureChannelAccountSchema.ts EXACTLY. A column in the DDL
 * but absent here is invisible to Sequelize, so reads return undefined and writes are silently
 * dropped; the parity test enforces it.
 *
 * THIS MODEL HOLDS NO SECRET. The token lives in `marketing_connector_credentials`, sealed.
 * That separation is the reason an account row can be returned from an API at all, and it is
 * why `toJSON` here needs no redaction: there is nothing to redact.
 *
 * OWNED BY A BRAND OR BY A PERSON, never both and never neither (a CHECK constraint enforces
 * it). Company pages are brand-owned. Student accounts, planned, are person-owned. Anything
 * that scopes a query must branch on which one is set rather than assuming `brand_id`.
 */

/**
 * `needs_selection` is an account that exists and holds a live token but has NOT been chosen as
 * the brand's destination for its network. One sign-in can discover several destinations - an
 * admin of three LinkedIn Pages, a Facebook login with four Pages ticked - and the rule is one
 * per network per brand, so the operator has to say which. Until they do, the account publishes
 * nothing: `resolveAccountFor` only ever looks at `connected`.
 */
export type ChannelAccountStatus = 'connected' | 'needs_selection' | 'needs_reconnect' | 'revoked' | 'disabled';

export const CHANNEL_ACCOUNT_STATUSES: readonly ChannelAccountStatus[] = [
  'connected',
  'needs_selection',
  'needs_reconnect',
  'revoked',
  'disabled',
];

export interface ChannelAccountAttributes {
  id?: string;
  tenant_id: string;
  brand_id?: string | null;
  owner_member_id?: string | null;
  provider: string;
  provider_account_id: string;
  display_name: string;
  handle?: string | null;
  avatar_url?: string | null;
  status?: ChannelAccountStatus;
  granted_scopes?: string[];
  missing_scopes?: string[];
  connected_by?: string | null;
  connected_at?: Date;
  last_health_check_at?: Date | null;
  last_health_ok?: boolean | null;
  last_health_error_class?: string | null;
  revoked_at?: Date | null;
  revoked_by?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: Date;
  updated_at?: Date;
}

class ChannelAccount extends Model<ChannelAccountAttributes> implements ChannelAccountAttributes {
  declare id: string;
  declare tenant_id: string;
  declare brand_id: string | null;
  declare owner_member_id: string | null;
  declare provider: string;
  declare provider_account_id: string;
  declare display_name: string;
  declare handle: string | null;
  declare avatar_url: string | null;
  declare status: ChannelAccountStatus;
  declare granted_scopes: string[];
  declare missing_scopes: string[];
  declare connected_by: string | null;
  declare connected_at: Date;
  declare last_health_check_at: Date | null;
  declare last_health_ok: boolean | null;
  declare last_health_error_class: string | null;
  declare revoked_at: Date | null;
  declare revoked_by: string | null;
  declare metadata: Record<string, unknown>;
  declare created_at: Date;
  declare updated_at: Date;
}

ChannelAccount.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    brand_id: { type: DataTypes.UUID, allowNull: true },
    owner_member_id: { type: DataTypes.UUID, allowNull: true },
    provider: { type: DataTypes.STRING(64), allowNull: false },
    provider_account_id: { type: DataTypes.STRING(255), allowNull: false },
    display_name: { type: DataTypes.STRING(255), allowNull: false },
    handle: { type: DataTypes.STRING(255), allowNull: true },
    avatar_url: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'connected' },
    granted_scopes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    missing_scopes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    connected_by: { type: DataTypes.UUID, allowNull: true },
    connected_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    last_health_check_at: { type: DataTypes.DATE, allowNull: true },
    last_health_ok: { type: DataTypes.BOOLEAN, allowNull: true },
    last_health_error_class: { type: DataTypes.STRING(64), allowNull: true },
    revoked_at: { type: DataTypes.DATE, allowNull: true },
    revoked_by: { type: DataTypes.UUID, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'marketing_channel_accounts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);

export default ChannelAccount;
