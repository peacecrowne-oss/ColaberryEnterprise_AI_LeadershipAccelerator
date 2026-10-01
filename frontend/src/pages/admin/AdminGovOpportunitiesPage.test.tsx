import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import AdminGovOpportunitiesPage from './AdminGovOpportunitiesPage';
import * as factoryApi from '../../services/factoryApi';
import type { GovOpportunity, GovOpportunityFeed } from '../../services/factoryApi';

// No @testing-library in this repo: render via react-dom/client + act and read container.textContent.
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ ...jest.requireActual('react-router-dom'), useNavigate: () => mockNavigate }));
jest.mock('../../services/factoryApi');

const candidate: GovOpportunity = {
  uuid: 'u9', title: 'Digital Evidence Platform', agency: 'City of Dallas',
  closeDate: '2026-10-23', closeAt: '2026-10-23T13:00:00.000Z', fitScore: 80, priorityScore: 79,
  estimatedValue: 1000000, valueBasis: 'unverified', category: 'IT Services',
  sourceUrl: 'https://dallascityhall.bonfirehub.com/opportunities/1',
  pursuitStatus: 'none', vetVerdict: null, vetVerdictPresent: true,
};
const liveFeed: GovOpportunityFeed = { opportunities: [candidate], source: 'live', snapshotDate: null, snapshotReason: null };

let container: HTMLDivElement;
let root: Root;

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><AdminGovOpportunitiesPage /></MemoryRouter>); });
  // Two flushes: one for listGovOpportunities resolving, one for the resulting setFeed re-render.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  jest.clearAllMocks();
});

describe('AdminGovOpportunitiesPage — dashboard redesign (honesty rails preserved)', () => {
  it('renders the legacy scores as advisory chips and never says "best fit"', async () => {
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue(liveFeed);
    await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('79');   // priority chip
    expect(text).toContain('80');   // fit chip
    expect(text).toContain('Legacy discovery scores are advisory, not verified company fit');
    expect(text).not.toContain('best fit');
  });

  it('shows Unassessed for BOTH an absent and an explicitly-null verdict (one badge per row)', async () => {
    const absent: GovOpportunity = { ...candidate, uuid: 'ab', vetVerdict: undefined, vetVerdictPresent: false };
    const nulled: GovOpportunity = { ...candidate, uuid: 'nu', vetVerdict: null, vetVerdictPresent: true };
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue({ opportunities: [absent, nulled], source: 'live', snapshotDate: null, snapshotReason: null });
    await renderPage();
    const unassessed = Array.from(container.querySelectorAll('.badge')).filter((b) => b.textContent === 'Unassessed');
    expect(unassessed.length).toBe(2);
  });

  it('explains a flagged verdict with its reason + method and marks a weak legacy assessment (never a candidate)', async () => {
    const flagged: GovOpportunity = { ...candidate, uuid: 'fl', title: 'Out Of Domain RFP', vetVerdict: { status: 'no_bid', reason: 'construction', method: 'title_regex', evidence: null }, vetVerdictPresent: true };
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue({ opportunities: [flagged], source: 'live', snapshotDate: null, snapshotReason: null });
    await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('Flagged for review');
    expect(text).toContain('no bid — construction');
    expect(text).toContain('method: title_regex');
    expect(text).toContain('legacy, unevidenced (weak)');
  });

  it('"Qualify" routes to the qualification workspace (no canonical id derived from the title)', async () => {
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue(liveFeed);
    await renderPage();
    const qualify = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Qualify'));
    expect(qualify).toBeDefined();
    await act(async () => { qualify!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
    expect(mockNavigate).toHaveBeenCalledWith('/admin/gov-qualification');
  });

  it('row: unverified value, Source link, deadline warning; live pill in the header', async () => {
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue(liveFeed);
    await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('Live from Opportunity Pulse');
    expect(text).toContain('$1.0M');
    expect(text).toContain('unverified');
    expect(text).toContain('not revenue');   // the pipeline card never calls an estimate revenue
    const sourceLink = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('Source'));
    expect(sourceLink!.getAttribute('href')).toBe('https://dallascityhall.bonfirehub.com/opportunities/1');
    expect(container.querySelector('.ri-error-warning-line')).toBeTruthy(); // deadline verification warning
  });

  it('summarises the pipeline and distribution without presenting estimates as revenue', async () => {
    const other: GovOpportunity = { ...candidate, uuid: 'o2', title: 'Advisory Services', agency: 'U3P', category: 'Consulting', fitScore: 70, priorityScore: 54, estimatedValue: 250000, closeDate: '2026-10-05' };
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue({ opportunities: [candidate, other], source: 'live', snapshotDate: null, snapshotReason: null });
    await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('Pipeline value');
    expect(text).toContain('Priority mix');
    expect(text).toContain('Fit mix');
    // IT vs Consulting split surfaced
    expect(text).toMatch(/IT \$1\.0M/);
    expect(text).toMatch(/Consulting \$250K|Consulting \$0K/);
  });

  it('distinguishes a CONFIGURED-but-FAILED source from "not configured"', async () => {
    const snap: GovOpportunityFeed = { opportunities: [{ uuid: 'u1', title: 'Agenda RFP', agency: 'Harris County', closeDate: '2026-06-22', fitScore: 70, estimatedValue: 300000, sourceUrl: 'https://x/1' }], source: 'snapshot', snapshotDate: '2026-06-08', snapshotReason: 'source_failed' };
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue(snap);
    await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('Live source unavailable');
    expect(text).toContain('did not respond');
  });

  it('shows an error message when loading fails', async () => {
    (factoryApi.listGovOpportunities as jest.Mock).mockRejectedValue(new Error('boom'));
    await renderPage();
    expect(container.textContent ?? '').toContain('Could not load government opportunities');
  });

  // ── Discovery upgrade: show more, good-fits, decent filter, details popup, team dismiss/restore ──
  const goodFit: GovOpportunity = { ...candidate, uuid: 'g1', title: 'High Fit Platform', fitScore: 80, priorityScore: 78 };
  const lowFit: GovOpportunity = { ...candidate, uuid: 'l1', title: 'Low Fit Services', agency: 'U3P', category: 'Consulting', fitScore: 50, priorityScore: 40 };

  const findButton = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label);
  const clickEl = async (el: Element) => {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  };

  it('shows a Good fits count (fit ≥ 75) and a Decent options filter', async () => {
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue({ opportunities: [goodFit, lowFit], source: 'live', snapshotDate: null, snapshotReason: null, totalAvailable: 50 });
    await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('Good fits');
    expect(text).toContain('Decent options');
    expect(text).toContain('decent'); // the good-fits hint names the decent threshold
  });

  it('the Decent options filter hides a fit<60 row', async () => {
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue({ opportunities: [goodFit, lowFit], source: 'live', snapshotDate: null, snapshotReason: null, totalAvailable: 50 });
    await renderPage();
    expect(container.textContent ?? '').toContain('Low Fit Services'); // both shown initially
    const toggle = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Decent options'));
    await clickEl(toggle!);
    const text = container.textContent ?? '';
    expect(text).toContain('High Fit Platform'); // fit 80 kept
    expect(text).not.toContain('Low Fit Services'); // fit 50 hidden
  });

  it('shows how many are available vs shown', async () => {
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue({ opportunities: [goodFit, lowFit], source: 'live', snapshotDate: null, snapshotReason: null, totalAvailable: 50, dismissedCount: 3 });
    await renderPage();
    const text = container.textContent ?? '';
    expect(text).toMatch(/Showing\s*2\s*of\s*50/);
    expect(text).toContain('3'); // dismissed count surfaced
  });

  it('Details opens a popup with why-it-surfaced + the PRELIMINARY, UNVERIFIED overview', async () => {
    const withSummary: GovOpportunity = { ...candidate, uuid: 's1', title: 'Summarized RFP', preliminarySummary: 'A courts case-management modernization.' };
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue({ opportunities: [withSummary], source: 'live', snapshotDate: null, snapshotReason: null });
    await renderPage();
    await clickEl(findButton('Details')!);
    const text = container.textContent ?? '';
    expect(text).toContain('Why it surfaced');
    expect(text).toContain('Project overview');
    expect(text).toContain('Preliminary, unverified'); // the honesty label
    expect(text).toContain('not confirmed requirements');
    expect(text).toContain('A courts case-management modernization.');
  });

  it('Details overview falls back to an explicit "not available yet" when no summary', async () => {
    const noSummary: GovOpportunity = { ...candidate, uuid: 'n1', title: 'No Summary RFP', preliminarySummary: null };
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue({ opportunities: [noSummary], source: 'live', snapshotDate: null, snapshotReason: null });
    await renderPage();
    await clickEl(findButton('Details')!);
    expect(container.textContent ?? '').toContain('No preliminary summary available yet');
  });

  it('Dismiss calls the API with the OP uuid and removes the row', async () => {
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue({ opportunities: [goodFit, lowFit], source: 'live', snapshotDate: null, snapshotReason: null, totalAvailable: 50 });
    (factoryApi.dismissGovOpportunity as jest.Mock).mockResolvedValue({ dismissed: { opportunity_key: 'g1', restored_at: null } });
    await renderPage();
    const dismissBtn = findButton('Dismiss'); // the row dismiss button (icon + visually-hidden "Dismiss")
    expect(dismissBtn).toBeDefined();
    await clickEl(dismissBtn!);
    expect(factoryApi.dismissGovOpportunity).toHaveBeenCalledWith('g1', expect.objectContaining({ title: 'High Fit Platform' }));
    expect(container.textContent ?? '').not.toContain('High Fit Platform'); // row removed optimistically
  });

  it('Restore calls the API for a session-dismissed opportunity', async () => {
    (factoryApi.listGovOpportunities as jest.Mock).mockResolvedValue({ opportunities: [goodFit, lowFit], source: 'live', snapshotDate: null, snapshotReason: null, totalAvailable: 50 });
    (factoryApi.dismissGovOpportunity as jest.Mock).mockResolvedValue({ dismissed: { opportunity_key: 'g1', restored_at: null } });
    (factoryApi.restoreGovOpportunity as jest.Mock).mockResolvedValue({ restored: { opportunity_key: 'g1', restored_at: '2026-10-01T00:00:00Z' } });
    await renderPage();
    await clickEl(findButton('Dismiss')!);                 // dismiss g1 (l1 remains, so the card still renders)
    const disclosure = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Dismissed this session'));
    expect(disclosure).toBeDefined();
    await clickEl(disclosure!);                             // open the dismissed manager
    const restoreBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Restore'));
    await clickEl(restoreBtn!);
    expect(factoryApi.restoreGovOpportunity).toHaveBeenCalledWith('g1');
  });
});
