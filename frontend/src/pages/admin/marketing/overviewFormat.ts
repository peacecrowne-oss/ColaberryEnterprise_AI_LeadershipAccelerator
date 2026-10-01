import type { AccountHealth } from '../../../services/marketingOpsApi';
import { formatCentral, toCentralInput } from './centralTime';

/**
 * overviewFormat - how the Overview says things. Pure, so the wording is testable.
 *
 * Kept out of the page component because these are the sentences an operator actually reads,
 * and a sentence that is wrong in a particular state ("expires in -3 days") is a bug like any
 * other. Rendering them from a component makes them reachable only by mounting it.
 */

/** Networks the product can post to directly. Anything else is posted by hand. */
export const PROVIDER_LABELS: Record<string, string> = {
  linkedin_member: 'LinkedIn',
  linkedin_organization: 'LinkedIn Page',
  meta_facebook_page: 'Facebook',
  meta_instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
};

export function providerLabel(key: string): string {
  return PROVIDER_LABELS[key] ?? key;
}

export interface HealthPresentation {
  label: string;
  /** Bootstrap contextual suffix, e.g. `text-danger`. */
  tone: 'success' | 'warning' | 'danger' | 'secondary';
  /** Whether a post can go out on this account today. */
  usable: boolean;
}

/**
 * What the account row says, and in what colour.
 *
 * `expired` and `unhealthy` are both red rather than one red and one amber: from the operator's
 * side they are the same event - the next post will not go out - and the remedy is the same
 * click. Amber is reserved for the state where nothing is broken yet.
 */
export function presentHealth(health: AccountHealth): HealthPresentation {
  switch (health) {
    case 'ok': return { label: 'Connected', tone: 'success', usable: true };
    case 'expiring': return { label: 'Expiring soon', tone: 'warning', usable: true };
    case 'expired': return { label: 'Token expired', tone: 'danger', usable: false };
    case 'unhealthy': return { label: 'Needs reconnecting', tone: 'danger', usable: false };
    // Nothing is broken and nothing is expiring: one sign-in found several destinations and
    // nobody has said which this brand uses. Amber, because the fix is a choice, not a repair.
    case 'unselected': return { label: 'Not chosen yet', tone: 'warning', usable: false };
    case 'revoked': return { label: 'Disconnected', tone: 'secondary', usable: false };
  }
}

/**
 * "in 12 days" / "today" / "expired 3 days ago".
 *
 * Never renders a negative day count, which is what a naive `in ${days} days` produces for an
 * already-expired token and is the single most common way this kind of line goes wrong.
 */
export function expiryPhrase(days: number | null): string | null {
  if (days === null) return null;
  if (days < -1) return `expired ${Math.abs(days)} days ago`;
  if (days < 0) return 'expired yesterday';
  if (days === 0) return 'expires today';
  if (days === 1) return 'expires tomorrow';
  return `expires in ${days} days`;
}

/**
 * When a post goes out, in Central (never the viewer's laptop zone - Ali, 2026-09-18).
 *
 * Always carries the weekday. "2:00 PM" alone forces the reader to work out which day they are
 * looking at from the row above, and the whole point of the panel is to be readable at a glance.
 */
export function scheduleLabel(iso: string, now: Date = new Date()): string {
  const full = formatCentral(iso); // "Fri, Sep 18, 9:45 AM CDT"
  if (!full) return 'Unscheduled';
  const time = full.split(', ').slice(-1)[0]; // "9:45 AM CDT"
  // "Today" and "Tomorrow" are Central days too - otherwise a post at 8 PM CDT reads as
  // "Tomorrow" to a browser running on UTC.
  const dayOf = (d: string) => toCentralInput(d).slice(0, 10);
  if (dayOf(iso) === dayOf(now.toISOString())) return `Today ${time}`;
  if (dayOf(iso) === dayOf(new Date(now.getTime() + 86_400_000).toISOString())) return `Tomorrow ${time}`;
  return full;
}

/** "3 posts" / "1 post". Counting is not the place to be clever, but it is a place to be right. */
export function pluralPosts(n: number): string {
  return `${n} ${n === 1 ? 'post' : 'posts'}`;
}
