import sharp from 'sharp';
import { looksLikeMp4, probeMp4, Mp4ParseError, type Mp4Facts } from './mp4Probe';
import { looksLikePdf, probePdf, PdfParseError, type PdfFacts } from './pdfProbe';
import { ContentItem, ContentItemMedia, MediaAsset } from '../../models';
import { WorkflowError, assertWritable } from '../content/contentWorkflowService';
import { MediaStoreError, assertAcceptable, put, signedUrl } from './mediaStore';
import { mediaPublicBaseUrl } from '../publishing/adapterRegistry';

/**
 * mediaAssetService — attach an uploaded file to a content item.
 *
 * The one place `sharp` is finally imported (it has been a dependency nobody used since
 * T004). Two jobs, both at upload time rather than publish time, because an upload is one
 * event and a publish is one per network:
 *   1. Record real width/height/format from the bytes, not from the filename or the browser's
 *      claimed MIME type. A `.png` that is actually a JPEG is stored as a JPEG.
 *   2. STRIP EXIF. A marketing photo taken on a phone carries GPS coordinates, the device
 *      model and a timestamp. Posting that is a privacy leak for whoever took it and a
 *      location disclosure for wherever it was taken. `sharp` re-encodes without metadata.
 *      Videos are stored as-is but READ: the container's own boxes give duration, display
 *      size (rotation applied), codec and audio presence, which is what every network's video
 *      rule asks about (mp4Probe.ts). A file that is not a readable MP4 is refused here, at
 *      upload, not at publish. (Stripping video metadata is a different tool and out of
 *      scope); stated, not hidden.
 *
 * ALT TEXT IS REQUIRED AT UPLOAD, not at publish. Spec 8.4 makes accessibility a
 * requirement, and the moment the operator has the image in front of them is the only moment
 * they will write a description for it. A field that can be filled later is a field that is
 * never filled.
 */

export interface AttachInput {
  contentItemId: string;
  bytes: Buffer;
  /** The browser's claim. Verified against the bytes for images. */
  claimedMimeType: string;
  originalFilename: string | null;
  altText: string;
  uploadedBy: string | null;
}

export interface AttachedMedia {
  mediaAssetId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Documents only, when the file states it plainly. */
  pages: number | null;
  altText: string;
  position: number;
  /** True when the exact bytes were already in this brand's library and were reused. */
  reused: boolean;
}

const MAX_ATTACHMENTS_PER_ITEM = 10;

/** Format sniffed from bytes -> the MIME type we store. Anything else is refused. */
const SHARP_FORMAT_TO_MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' };

async function normaliseImage(bytes: Buffer, claimed: string): Promise<{ bytes: Buffer; mimeType: string; width: number; height: number }> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes, { animated: true }).metadata();
  } catch {
    throw new MediaStoreError('That file is not a readable image.', 'UnreadableImage', 415);
  }
  const mimeType = meta.format ? SHARP_FORMAT_TO_MIME[meta.format] : undefined;
  if (!mimeType) {
    throw new MediaStoreError(`The image is ${meta.format ?? 'an unknown format'}; use PNG, JPEG or GIF.`, 'UnsupportedMediaType', 415);
  }
  if (mimeType !== claimed) {
    // Not an error: browsers guess. Recorded so an operator reading the row sees the truth.
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(), level: 'info', service: 'media',
      event: 'mime_corrected', outcome: 'success', context: { claimed, actual: mimeType },
    }));
  }
  // Re-encode without metadata. GIFs keep their frames; the EXIF is what goes.
  const stripped = await sharp(bytes, { animated: true }).toBuffer();
  return { bytes: stripped, mimeType, width: meta.width ?? 0, height: meta.pageHeight ?? meta.height ?? 0 };
}

/**
 * What we know about a video before it is stored. Refused with the parser's own reason: the
 * operator can re-export in seconds, and a wrong duration would let a 12-minute clip through a
 * 10-minute rule.
 */
function probeVideo(bytes: Buffer): Mp4Facts {
  if (!looksLikeMp4(bytes)) {
    throw new WorkflowError('That file is not an MP4 video. Export it as MP4 (H.264) and attach it again.', 415, 'UnreadableVideo');
  }
  try {
    return probeMp4(bytes);
  } catch (err) {
    if (err instanceof Mp4ParseError) throw new WorkflowError(err.message, 415, 'UnreadableVideo');
    throw err;
  }
}

/** A document is stored as-is; what we read is whether it IS a PDF and, when stated plainly, its page count. */
function probeDocument(bytes: Buffer): PdfFacts {
  if (!looksLikePdf(bytes)) {
    throw new WorkflowError('That file is not a PDF. Export it as PDF and attach it again.', 415, 'UnreadableDocument');
  }
  try {
    return probePdf(bytes);
  } catch (err) {
    if (err instanceof PdfParseError) throw new WorkflowError(err.message, 415, 'UnreadableDocument');
    throw err;
  }
}

export async function attachMedia(input: AttachInput): Promise<AttachedMedia> {
  const altText = input.altText.trim();
  if (altText.length < 3) {
    throw new WorkflowError('Describe the image for people who cannot see it (alt text is required).', 400, 'AltTextRequired');
  }
  if (altText.length > 300) {
    // LinkedIn's cap; the smallest among the providers we target, so it is the one to enforce.
    throw new WorkflowError('Alt text is limited to 300 characters.', 400, 'AltTextTooLong');
  }

  const item = await ContentItem.findByPk(input.contentItemId);
  if (!item) throw new WorkflowError('Content item not found', 404, 'NotFound');
  assertWritable(item);
  if (!item.brand_id) {
    throw new WorkflowError('This item has no brand, so its media has no library to live in.', 409, 'BrandRequired');
  }

  const attached = await ContentItemMedia.count({ where: { content_item_id: item.id } });
  if (attached >= MAX_ATTACHMENTS_PER_ITEM) {
    throw new WorkflowError(`A post can carry at most ${MAX_ATTACHMENTS_PER_ITEM} media items.`, 409, 'TooManyAttachments');
  }

  // Size and type gate BEFORE decoding: sharp will happily spend seconds on a 200 MB "png".
  const entry = assertAcceptable(input.claimedMimeType, input.bytes.length);

  let bytes = input.bytes;
  let mimeType = input.claimedMimeType;
  let width: number | null = null;
  let height: number | null = null;
  let durationMs: number | null = null;
  let video: Mp4Facts | null = null;
  let document: PdfFacts | null = null;
  if (entry.kind === 'image') {
    const normalised = await normaliseImage(input.bytes, input.claimedMimeType);
    bytes = normalised.bytes;
    mimeType = normalised.mimeType;
    width = normalised.width;
    height = normalised.height;
  } else if (entry.kind === 'video') {
    video = probeVideo(input.bytes);
    width = video.width;
    height = video.height;
    durationMs = video.durationMs;
  } else {
    document = probeDocument(input.bytes);
  }

  const stored = await put(item.brand_id, mimeType, bytes);

  // The (brand, checksum) unique index means a second upload of the same bytes must reuse the
  // row, not race it. Look up first; create only when absent.
  let asset = await MediaAsset.findOne({ where: { brand_id: item.brand_id, checksum_sha256: stored.sha256 } });
  const reused = asset !== null;
  if (!asset) {
    asset = await MediaAsset.create({
      tenant_id: item.tenant_id,
      brand_id: item.brand_id,
      storage_key: stored.key,
      original_filename: input.originalFilename,
      mime_type: mimeType,
      byte_size: stored.byteSize,
      checksum_sha256: stored.sha256,
      width,
      height,
      duration_ms: durationMs,
      alt_text: altText,
      uploaded_by: input.uploadedBy,
      metadata: {
        exif_stripped: entry.kind === 'image',
        claimed_mime: input.claimedMimeType,
        ...(video ? { video: { codec: video.codec, codec_family: video.codecFamily, has_audio: video.hasAudio, rotation: video.rotation, major_brand: video.majorBrand } } : {}),
        ...(document ? { document: { pages: document.pages, pdf_version: document.version } } : {}),
      },
    } as any);
  } else if (!asset.alt_text) {
    await asset.update({ alt_text: altText });
  }

  // Idempotent attach: the same asset on the same item twice is one attachment.
  const existingLink = await ContentItemMedia.findOne({ where: { content_item_id: item.id, media_asset_id: asset.id } });
  const position = existingLink ? existingLink.position : attached;
  if (!existingLink) {
    await ContentItemMedia.create({ content_item_id: item.id, media_asset_id: asset.id, position } as any);
  }

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(), level: 'info', service: 'media', event: 'media_attached', outcome: 'success',
    context: { content_item_id: item.id, media_asset_id: asset.id, mime: mimeType, bytes: stored.byteSize, reused, width, height },
  }));

  return {
    mediaAssetId: asset.id,
    storageKey: stored.key,
    mimeType,
    byteSize: stored.byteSize,
    width,
    height,
    durationMs,
    pages: document?.pages ?? pagesOf(asset.metadata),
    altText: asset.alt_text ?? altText,
    position,
    reused,
  };
}

/** The page count the upload recorded, if any. */
export function pagesOf(metadata: unknown): number | null {
  const pages = (metadata as { document?: { pages?: unknown } } | null)?.document?.pages;
  return typeof pages === 'number' ? pages : null;
}

export interface ItemMediaView {
  mediaAssetId: string;
  mimeType: string;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  altText: string | null;
  position: number;
  originalFilename: string | null;
  durationMs: number | null;
  pages: number | null;
  /**
   * A short-lived signed URL the browser can load, so the composer's preview shows the ACTUAL
   * file rather than a grey rectangle. The same `/m/` route Meta fetches from, with the same
   * expiry - no second way to serve media, and nothing new made public.
   *
   * Null when the server has no public base URL configured. The preview falls back to its
   * placeholder then, rather than rendering a broken image.
   */
  url: string | null;
}

/** Sign, or return null. `signedUrl` throws without JWT_SECRET or on a key it does not recognise. */
function safeSignedUrl(storageKey: string, base: string): string | null {
  try {
    return signedUrl(storageKey, base).url;
  } catch {
    return null;
  }
}

export async function listItemMedia(contentItemId: string): Promise<ItemMediaView[]> {
  const links = await ContentItemMedia.findAll({ where: { content_item_id: contentItemId }, order: [['position', 'ASC']] });
  if (links.length === 0) return [];
  const assets = await MediaAsset.findAll({ where: { id: links.map((l) => l.media_asset_id) } });
  const byId = new Map(assets.map((a) => [a.id, a]));
  // Signed once per listing, not per asset lookup, so every URL in one response shares an expiry.
  const base = mediaPublicBaseUrl();
  return links.flatMap((l) => {
    const a = byId.get(l.media_asset_id);
    if (!a) return [];
    return [{
      // BIGINT arrives from Postgres as a string; the view promises a number.
      mediaAssetId: a.id, mimeType: a.mime_type, byteSize: a.byte_size == null ? null : Number(a.byte_size), width: a.width, height: a.height,
      altText: a.alt_text, position: l.position, originalFilename: a.original_filename, durationMs: a.duration_ms,
      pages: pagesOf(a.metadata),
      // A signing failure must not take the whole listing down with it: the media still exists
      // and the operator still needs to see that it is attached.
      url: base ? safeSignedUrl(a.storage_key, base) : null,
    }];
  });
}

/** Detach from the item. The asset row and its bytes stay: another item may use them, and the library is per brand. */
export async function detachMedia(contentItemId: string, mediaAssetId: string): Promise<void> {
  const item = await ContentItem.findByPk(contentItemId);
  if (!item) throw new WorkflowError('Content item not found', 404, 'NotFound');
  assertWritable(item);
  const removed = await ContentItemMedia.destroy({ where: { content_item_id: contentItemId, media_asset_id: mediaAssetId } });
  if (removed === 0) throw new WorkflowError('That media is not attached to this item.', 404, 'NotFound');
}
