/**
 * overviewHealth - the judgements the Marketing Overview makes, with no database standing by.
 *
 * Pure by construction: no I/O, no imports from the model layer, and no clock of its own -
 * every function takes `now`. The Overview is the first screen an operator opens, and the two
 * questions it answers there are the ones most worth proving rather than hoping:
 *
 *   "can we still publish?"   -> accountHealth()
 *   "did something not go?"   -> isLate()
 *
 * Both used to be answerable only by opening a post and reading its job, which is why nobody
 * answered them until a publish had already failed.
 */

/** How an account reads on the Overview. Ordered worst-first; `worstHealth` relies on it. */
export type AccountHealth = 'revoked' | 'expired' | 'unhealthy' | 'unselected' | 'expiring' | 'ok';

const SEVERITY: AccountHealth[] = ['revoked', 'expired', 'unhealthy', 'unselected', 'expiring', 'ok'];

/**
 * How long before expiry the Overview starts warning.
 *
 * LinkedIn member tokens last 60 days and reconnecting is a person walking through an OAuth
 * consent screen - not something to discover on the morning a campaign ships. Two weeks is
 * enough to schedule that walk without the warning becoming wallpaper.
 */
export const EXPIRY_WARNING_DAYS = 14;

/**
 * How late a scheduled post may be before the Overview calls it late.
 *
 * Matches LATE_GRACE_MS in needsAttentionService - the two surfaces disagreeing about what
 * "late" means is worse than either threshold being wrong, because the operator then sees a
 * post flagged in one place and clean in the other and trusts neither.
 */
export const LATE_GRACE_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CredentialLike {
  credential_type: string;
  token_expires_at: Date | string | null;
}

export interface AccountLike {
  status: string;
  revoked_at: Date | string | null;
  last_health_ok: boolean | null;
  credentials: CredentialLike[];
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * When the ACCESS token dies. The refresh token's expiry is deliberately ignored.
 *
 * `channelAccountService.connectAccount` stores a refresh token when the provider returns one,
 * and as of 2026-09-18 nothing in the codebase ever reads it: `getAccessToken` opens the
 * access-token row and hands it back without consulting `token_expires_at`, and there is no
 * refresh path anywhere in services/publishing. So a live refresh token beside a dead access
 * token does NOT mean the account still works - it means the next publish fails with a 401 that
 * no code is watching for. Reporting health off the access token is what makes this screen
 * honest; if a refresh path is ever built, this function is the thing to revisit.
 */
export function accessTokenExpiry(account: AccountLike): Date | null {
  const access = account.credentials.find((c) => c.credential_type === 'access_token');
  return access ? asDate(access.token_expires_at) : null;
}

/**
 * When the CONNECTION dies, for a network nothing publishes to yet.
 *
 * X access tokens live two hours, Google's one, TikTok's a day; each comes with a long-lived
 * refresh token. Judged by the access token, such an account reads "Token expired" two hours
 * after it was connected, which is alarming and says nothing useful. For a network with no live
 * adapter, no post uses any token yet, so the question is only whether the connection is still
 * alive - and that is the refresh token's lifetime (null: the provider states none, so it lives
 * until revoked). With no refresh token at all, the access token is all there is.
 *
 * NOT for a network with a live adapter: adapters read the access token as stored and nothing
 * renews it (see accessTokenExpiry), so there the access token IS the truth. The adapter PR that
 * brings X, YouTube or TikTok live must build renewal; this function assumes that it will.
 */
export function connectionExpiry(account: AccountLike): Date | null {
  const refresh = account.credentials.find((c) => c.credential_type === 'refresh_token');
  return refresh ? asDate(refresh.token_expires_at) : accessTokenExpiry(account);
}

/** Whole days from `now` until `when`, rounded down. Negative once past. Null if never expires. */
export function daysUntil(when: Date | null, now: Date): number | null {
  if (!when) return null;
  return Math.floor((when.getTime() - now.getTime()) / DAY_MS);
}

/**
 * What the dot next to an account says.
 *
 * Worst-first, because an account can be several of these at once and the operator needs the
 * one that stops a post going out. A revoked account is revoked whatever its token says; an
 * expired token is fatal whatever the last health check said, since that check may predate the
 * expiry entirely.
 */
export function accountHealth(
  account: AccountLike,
  now: Date,
  /** True for a network with no live adapter - see connectionExpiry. Default: access token. */
  judgeByConnection = false,
): AccountHealth {
  if (account.status === 'revoked' || asDate(account.revoked_at)) return 'revoked';

  // Discovered but not chosen. The token may be perfectly good; what is missing is a decision,
  // so this is reported ahead of expiry - "pick one" is the action, not "reconnect".
  if (account.status === 'needs_selection') return 'unselected';

  const expiry = judgeByConnection ? connectionExpiry(account) : accessTokenExpiry(account);
  const days = daysUntil(expiry, now);
  if (days !== null && days < 0) return 'expired';

  // `needs_reconnect` is written by getAccessToken when a credential will not open. It means
  // the same thing to an operator as a failed health check and gets the same colour.
  if (account.status === 'needs_reconnect' || account.last_health_ok === false) return 'unhealthy';

  if (days !== null && days <= EXPIRY_WARNING_DAYS) return 'expiring';
  return 'ok';
}

/** The most severe health among several accounts, for a brand-level or page-level summary. */
export function worstHealth(healths: AccountHealth[]): AccountHealth | null {
  if (healths.length === 0) return null;
  return SEVERITY.find((h) => healths.includes(h)) ?? 'ok';
}

/** Whether an account can carry a post right now. Only `ok` and `expiring` can. */
export function canPublish(health: AccountHealth): boolean {
  return health === 'ok' || health === 'expiring';
}

/**
 * A scheduled post whose time has passed and which has not published.
 *
 * The grace window exists because the worker ticks on a schedule: a post one minute past due is
 * waiting for the next tick, not stuck. Fifteen minutes past due with nothing published is a
 * problem worth a colour.
 */
export function isLate(scheduledFor: Date | string | null, now: Date, graceMs = LATE_GRACE_MS): boolean {
  const when = asDate(scheduledFor);
  if (!when) return false;
  return now.getTime() - when.getTime() > graceMs;
}

/**
 * Networks with no usable account - the ones a person still posts by hand.
 *
 * Takes health into account rather than mere existence. A connected-but-expired LinkedIn is not
 * a channel you can publish to, and listing it as connected while its posts fail is exactly the
 * reassurance this panel exists to stop giving.
 */
export function handoffProviders(
  allProviders: readonly string[],
  usable: readonly string[],
): string[] {
  const live = new Set(usable);
  return allProviders.filter((p) => !live.has(p));
}
