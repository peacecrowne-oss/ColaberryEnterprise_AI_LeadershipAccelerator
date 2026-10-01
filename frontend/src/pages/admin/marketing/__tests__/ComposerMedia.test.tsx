import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import ComposerMedia from '../composer/ComposerMedia';
import type { ItemMedia } from '../../../../services/contentComposerApi';

/**
 * The attach control's one rule: no file leaves the browser without a description. The
 * backend refuses an upload without alt text, so the button must not be pressable until
 * both halves exist - otherwise the operator uploads a 40 MB video, waits, and gets a 400.
 */

let container: HTMLDivElement;
let root: Root;

const ATTACHED: ItemMedia[] = [
  { mediaAssetId: 'a1a1a1a1-0000-4000-8000-000000000001', mimeType: 'image/png', byteSize: 2_400_000, width: 1200, height: 628, altText: 'Two people at a whiteboard', position: 0, originalFilename: 'class.png', durationMs: null, pages: null, url: 'https://www.refactored.ai/m/b/aaa.png?e=1&s=x' },
  { mediaAssetId: 'a1a1a1a1-0000-4000-8000-000000000002', mimeType: 'video/mp4', byteSize: 41_000_000, width: 1080, height: 1920, altText: 'A short clip', position: 1, originalFilename: null, durationMs: 45_000, pages: null, url: 'https://www.refactored.ai/m/b/bbb.mp4?e=1&s=x' },
];

function render(props: Partial<React.ComponentProps<typeof ComposerMedia>> = {}) {
  act(() => {
    root.render(<ComposerMedia media={[]} busy={false} enabled onAttach={() => {}} onDetach={() => {}} {...props} />);
  });
}

function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pickFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const attachButton = () => container.querySelector<HTMLButtonElement>('[data-testid="media-attach"]')!;
const altInput = () => container.querySelector<HTMLInputElement>('[data-testid="media-alt"]')!;
const fileInput = () => container.querySelector<HTMLInputElement>('[data-testid="media-file"]')!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });

describe('ComposerMedia attach rule', () => {
  it('keeps Attach disabled until BOTH a file and a description (3+ chars) exist', () => {
    const onAttach = jest.fn();
    render({ onAttach });
    expect(attachButton().disabled).toBe(true);

    act(() => { pickFile(fileInput(), new File(['png-bytes'], 'class.png', { type: 'image/png' })); });
    expect(attachButton().disabled).toBe(true); // file alone is not enough

    act(() => { setNativeValue(altInput(), 'ab'); });
    expect(attachButton().disabled).toBe(true); // two characters is not a description

    act(() => { setNativeValue(altInput(), '  Two people at a whiteboard  '); });
    expect(attachButton().disabled).toBe(false);

    act(() => { attachButton().click(); });
    expect(onAttach).toHaveBeenCalledTimes(1);
    const [file, alt] = onAttach.mock.calls[0];
    expect((file as File).name).toBe('class.png');
    expect(alt).toBe('Two people at a whiteboard'); // trimmed, as the backend would trim it
    // The form clears so the next attach cannot accidentally reuse the last description.
    expect(altInput().value).toBe('');
    expect(attachButton().disabled).toBe(true);
  });

  it('WORKS before the draft exists, because attaching creates one', () => {
    // This asserted the opposite until 2026-10-01: everything disabled until a draft existed,
    // which read as a broken control - "None of these buttons work to upload the video."
    // They were disabled, correctly and uselessly. The draft is a prerequisite of the API, not
    // of the operator's intent, so the page satisfies it on attach instead of demanding it.
    render({ enabled: false });
    expect(fileInput().disabled).toBe(false);
    expect(altInput().disabled).toBe(false);
    expect(container.textContent).not.toMatch(/Create the draft first/);
  });

  it('and says what attaching will do, so the draft is not created by surprise', () => {
    render({ enabled: false });
    expect(container.textContent).toMatch(/Attaching creates the draft, naming it after the file/);
  });

  it('says nothing of the sort once the draft exists', () => {
    render({ enabled: true });
    expect(container.textContent).not.toMatch(/Attaching creates the draft/);
  });

  it('names the limits and accepted types up front', () => {
    render();
    expect(container.textContent).toMatch(/10 MB/);
    expect(container.textContent).toMatch(/200 MB/);
    expect(fileInput().accept).toBe('image/png,image/jpeg,image/gif,video/mp4,application/pdf');
  });
});

describe('ComposerMedia documents', () => {
  it('accepts PDF, asks for a TITLE rather than a description when a PDF is picked, and lists page counts', () => {
    render({ media: [{ mediaAssetId: 'a1a1a1a1-0000-4000-8000-000000000003', mimeType: 'application/pdf', byteSize: 4_000_000, width: null, height: null, altText: 'Five AI habits', position: 0, originalFilename: 'deck.pdf', durationMs: null, pages: 12, url: null }] });
    expect(fileInput().accept).toContain('application/pdf');
    expect(container.querySelector('[data-testid="media-pages"]')!.textContent).toBe('12 pages');
    expect(container.textContent).toMatch(/PDF up to 100 MB/);
    expect(altInput().placeholder).toMatch(/Describe it/);
    act(() => { pickFile(fileInput(), new File(['%PDF-1.4'], 'deck.pdf', { type: 'application/pdf' })); });
    expect(altInput().placeholder).toMatch(/Document title, shown above the carousel/);
  });
});

describe('ComposerMedia upload progress', () => {
  it('shows nothing when no upload is in flight', () => {
    render();
    expect(container.querySelector('[data-testid="media-upload"]')).toBeNull();
  });

  it('while bytes are on the wire: percentage, sent of total, and the file name', () => {
    render({ upload: { name: 'class-recap.mp4', sent: 41 * 1024 * 1024, total: 82 * 1024 * 1024 } });
    const label = container.querySelector('[data-testid="media-upload-label"]')!.textContent;
    expect(label).toBe('50% · 41.0 MB of 82.0 MB');
    expect(container.textContent).toMatch(/Uploading class-recap\.mp4/);
    expect(container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('50');
  });

  it('once every byte is sent, says Processing rather than sitting at 100%', () => {
    // The server still hashes, sniffs and strips EXIF after the last byte; a bar stuck at 100%
    // reads as hung. The word is the difference.
    render({ upload: { name: 'hero.png', sent: 9_000_000, total: 9_000_000 } });
    expect(container.textContent).toMatch(/Processing hero\.png/);
    expect(container.querySelector('[data-testid="media-upload-label"]')!.textContent).toBe('checking the file');
    expect(container.querySelector('.progress-bar-animated')).not.toBeNull();
  });
});

describe('ComposerMedia attached list', () => {
  it('lists each attachment with its description and removes by asset id', () => {
    const onDetach = jest.fn();
    render({ media: ATTACHED, onDetach });
    expect(container.textContent).toMatch(/class\.png/);
    expect(container.textContent).toMatch(/1200×628/);
    expect(container.textContent).toMatch(/2\.3 MB/);
    expect(container.textContent).toMatch(/Two people at a whiteboard/);
    expect(container.textContent).toMatch(/A short clip/);
    // The video's length, read from the file, shown before validation has to say it is too long.
    expect(container.querySelector('[data-testid="media-duration"]')!.textContent).toBe('0:45');
    expect(container.querySelectorAll('[data-testid="media-duration"]')).toHaveLength(1); // images have none

    act(() => { container.querySelector<HTMLButtonElement>(`[data-testid="detach-${ATTACHED[1].mediaAssetId}"]`)!.click(); });
    expect(onDetach).toHaveBeenCalledWith(ATTACHED[1].mediaAssetId);
  });

  it('disables Remove while a request is in flight, so a double click is not a double detach', () => {
    render({ media: ATTACHED, busy: true });
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid^="detach-"]'));
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });
});
