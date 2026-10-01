import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import ComposerSetup, { type CampaignOption, type SetupValues } from '../composer/ComposerSetup';

/**
 * The "no UTM slug" warning used to be a dead end: it told the operator tracked links would
 * be refused and offered nothing to do about it, because nothing in the app could assign a
 * slug. The warning now carries the action, and the action carries the campaign id.
 */

let container: HTMLDivElement;
let root: Root;

const VALUES: SetupValues = {
  brand_id: 'b-1', campaign_id: 'c-1', title: '', destination_url: '', canonical_body: '',
  content_type: 'text', is_paid: false, has_offer: false, poll: null,
};
const CAMPAIGNS: CampaignOption[] = [
  { id: 'c-1', name: 'Nov Open House', brand_id: 'b-1', utm_campaign_slug: null },
  { id: 'c-2', name: 'Alumni', brand_id: 'b-1', utm_campaign_slug: 'colaberry-awareness-alumni-all-2026q3' },
];

function render(props: Partial<React.ComponentProps<typeof ComposerSetup>> = {}) {
  act(() => {
    root.render(
      <ComposerSetup values={VALUES} brands={[] as any} campaigns={CAMPAIGNS} locked={false} busy={false} onChange={() => {}} onSubmit={() => {}} {...props} />,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

describe('ComposerSetup slug assignment', () => {
  it('offers to assign the slug for a slugless campaign and passes that campaign id', () => {
    const onAssignSlug = jest.fn();
    render({ onAssignSlug });
    const btn = container.querySelector('[data-testid="assign-slug"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toMatch(/Assign UTM slug/);
    act(() => { btn.click(); });
    expect(onAssignSlug).toHaveBeenCalledWith('c-1');
  });

  it('shows no warning and no button once the campaign has a slug', () => {
    render({ values: { ...VALUES, campaign_id: 'c-2' }, onAssignSlug: jest.fn() });
    expect(container.textContent).not.toMatch(/This campaign has no UTM slug/);
    expect(container.querySelector('[data-testid="assign-slug"]')).toBeNull();
  });

  it('disables the button while the page is busy, so a double click cannot fire twice', () => {
    render({ onAssignSlug: jest.fn(), busy: true });
    const btn = container.querySelector('[data-testid="assign-slug"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe('ComposerSetup poll', () => {
  it('shows the poll editor only for a poll post, seeded with two empty options', () => {
    render({ values: { ...VALUES, content_type: 'text' } });
    expect(container.querySelector('[data-testid="poll-editor"]')).toBeNull();
    render({ values: { ...VALUES, content_type: 'poll' } });
    expect(container.querySelector('[data-testid="poll-editor"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="poll-option-"]')).toHaveLength(2);
  });

  it('adds up to four options, removes down to two, and reports every change through onChange', () => {
    const onChange = jest.fn();
    render({ values: { ...VALUES, content_type: 'poll', poll: { question: 'Which?', options: ['A', 'B', 'C', 'D'], durationDays: 7 } }, onChange });
    const add = container.querySelector<HTMLButtonElement>('[data-testid="poll-add-option"]')!;
    expect(add.disabled).toBe(true); // four is the ceiling
    act(() => { container.querySelector<HTMLButtonElement>('[aria-label="Remove option 4"]')!.click(); });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ poll: { question: 'Which?', options: ['A', 'B', 'C'], durationDays: 7 } }));

    render({ values: { ...VALUES, content_type: 'poll', poll: { question: 'Which?', options: ['A', 'B'], durationDays: 3 } }, onChange });
    const removes = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label^="Remove option"]'));
    expect(removes.every((b) => b.disabled)).toBe(true); // two is the floor
    act(() => { container.querySelector<HTMLButtonElement>('[data-testid="poll-add-option"]')!.click(); });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ poll: { question: 'Which?', options: ['A', 'B', ''], durationDays: 3 } }));
  });

  it("names both networks' option limits, because the editor cannot know which one is chosen", () => {
    render({ values: { ...VALUES, content_type: 'poll' } });
    expect(container.textContent).toMatch(/LinkedIn allows 30 characters per option, X allows 25/);
  });
});

describe('ComposerSetup content type', () => {
  it('says WHAT to attach, now that the upload sits in this section', () => {
    // These two assertions used to check for "attach the file under Channels › Media" and for
    // option labels carrying the same. Both were right until 2026-10-01, when the upload moved
    // into Setup beside the content type - Ali: "the video should be uploaded at the time you
    // select that you want a video." Pointing somewhere else is now the wrong thing to say.
    render({ values: { ...VALUES, content_type: 'image' } });
    const hint = container.querySelector('[data-testid="media-type-hint"]')!;
    expect(hint).not.toBeNull();
    expect(hint.textContent).toMatch(/PNG, JPEG or GIF/);
    expect(hint.textContent).not.toMatch(/Channels/);
  });

  it('says nothing for a text post, which takes no file at all', () => {
    render({ values: { ...VALUES, content_type: 'text' } });
    expect(container.querySelector('[data-testid="media-type-hint"]')).toBeNull();
  });

  it('leaves the dropdown as plain type names, the destination having moved out of it', () => {
    render();
    const options = Array.from(container.querySelectorAll('#composer-type option')).map((o) => o.textContent);
    expect(options).toContain('image');
    expect(options).toContain('document');
    expect(options).toContain('text');
    // No option may still advertise a place to attach the file.
    expect(options.join(' ')).not.toMatch(/Channels/);
  });
});
