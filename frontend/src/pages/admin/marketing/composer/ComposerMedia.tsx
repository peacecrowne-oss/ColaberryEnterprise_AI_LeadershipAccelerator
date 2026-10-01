import React, { useRef, useState } from 'react';
import type { ItemMedia } from '../../../../services/contentComposerApi';

/**
 * ComposerMedia — attach images or a video to the post.
 *
 * Presentational, all state as props, like the rest of the composer. The one piece of local
 * state is the alt-text box, because the description is typed BEFORE the upload rather than
 * asked for afterwards: the moment the operator has the image in front of them is the only
 * moment they will write one, and the backend refuses an upload without it.
 *
 * What it says, and why: file limits are printed up front so a 12 MB photo is not a surprise
 * at the end of a form; the accepted types are named so an SVG logo is not tried three times.
 */

export interface UploadState {
  /** The file being sent, for the label. */
  name: string;
  sent: number;
  total: number;
}

export interface ComposerMediaProps {
  media: ItemMedia[];
  busy: boolean;
  /** False until the draft exists - there is nothing to attach to. */
  enabled: boolean;
  /** Non-null while an upload is in flight; drives the progress bar. */
  upload?: UploadState | null;
  onAttach: (file: File, altText: string) => void;
  onDetach: (mediaAssetId: string) => void;
}

const ACCEPT = 'image/png,image/jpeg,image/gif,video/mp4,application/pdf';

function durationLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function sizeLabel(bytes: number | null): string {
  if (bytes === null) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * The bar has two phases and says which. Bytes on the wire is what the browser can report;
 * once they are all sent the server still hashes, sniffs and (for images) strips EXIF, which
 * for a 10 MB PNG is a visible second or two. A bar stuck at 100% reads as "hung"; the word
 * "Processing" reads as "working".
 */
function UploadBar({ upload }: { upload: UploadState }) {
  const pct = upload.total > 0 ? Math.min(100, Math.round((upload.sent / upload.total) * 100)) : 0;
  const processing = upload.total > 0 && upload.sent >= upload.total;
  return (
    <div className="mb-2" data-testid="media-upload" aria-live="polite">
      <div className="d-flex justify-content-between small mb-1">
        <span className="text-truncate" style={{ maxWidth: '24rem' }}>{processing ? 'Processing' : 'Uploading'} {upload.name}</span>
        <span className="text-muted" data-testid="media-upload-label">
          {processing ? 'checking the file' : `${pct}% · ${sizeLabel(upload.sent)} of ${sizeLabel(upload.total)}`}
        </span>
      </div>
      <div className="progress" style={{ height: '0.5rem' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Upload ${pct}%`}>
        <div className={`progress-bar${processing ? ' progress-bar-striped progress-bar-animated' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ComposerMedia({ media, busy, enabled, upload = null, onAttach, onDetach }: ComposerMediaProps) {
  const [altText, setAltText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // `enabled` used to mean "a draft exists" and disabled everything until it did, which read
  // as a broken control: pick `video`, see a file picker, click it, nothing. The page now
  // creates the draft when a file is attached, so what remains is the operator's own two
  // requirements - a file, and alt text for someone who cannot see it.
  const canAttach = !busy && file !== null && altText.trim().length >= 3;

  const submit = () => {
    if (!file || !canAttach) return;
    onAttach(file, altText.trim());
    setFile(null);
    setAltText('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="mb-3" data-testid="composer-media">
      <div className="small fw-semibold mb-1">Media</div>
      {media.length > 0 && (
        <ul className="list-unstyled mb-2 d-flex flex-column gap-1">
          {media.map((m) => (
            <li key={m.mediaAssetId} className="d-flex align-items-center gap-2 small" data-testid={`media-${m.mediaAssetId}`}>
              <span className="badge text-bg-light border">{m.mimeType.replace(/^(image|video)\//, '')}</span>
              <span className="text-truncate" style={{ maxWidth: '18rem' }}>{m.originalFilename ?? m.mediaAssetId}</span>
              {m.width && m.height && <span className="text-muted">{m.width}×{m.height}</span>}
              {m.durationMs !== null && <span className="text-muted" data-testid="media-duration">{durationLabel(m.durationMs)}</span>}
              {m.pages !== null && <span className="text-muted" data-testid="media-pages">{m.pages} page{m.pages === 1 ? '' : 's'}</span>}
              <span className="text-muted">{sizeLabel(m.byteSize)}</span>
              <span className="text-muted fst-italic text-truncate" style={{ maxWidth: '20rem' }}>“{m.altText}”</span>
              <button type="button" className="btn btn-sm btn-link text-danger py-0" disabled={busy} onClick={() => onDetach(m.mediaAssetId)} data-testid={`detach-${m.mediaAssetId}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {upload && <UploadBar upload={upload} />}

      <div className="d-flex flex-wrap align-items-end gap-2">
        <div>
          <input
            id="composer-media-file"
            ref={inputRef}
            type="file"
            className="form-control form-control-sm"
            accept={ACCEPT}
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="media-file"
          />
        </div>
        <div className="flex-grow-1" style={{ minWidth: '16rem' }}>
          <input
            id="composer-media-alt"
            className="form-control form-control-sm"
            placeholder={file?.type === 'application/pdf' ? 'Document title, shown above the carousel on LinkedIn (required)' : 'Describe it for someone who cannot see it (required)'}
            value={altText}
            maxLength={300}
            disabled={busy}
            onChange={(e) => setAltText(e.target.value)}
            data-testid="media-alt"
          />
        </div>
        <button type="button" className="btn btn-sm btn-outline-primary" disabled={!canAttach} onClick={submit} data-testid="media-attach">
          Attach
        </button>
      </div>
      <div className="form-text">
        PNG, JPEG or GIF up to 10 MB; MP4 up to 200 MB; PDF up to 100 MB (LinkedIn document posts).
        Location and camera data is removed from images automatically.
        {!enabled && ' Attaching creates the draft, naming it after the file if you have not titled it yet.'}
      </div>
    </div>
  );
}
