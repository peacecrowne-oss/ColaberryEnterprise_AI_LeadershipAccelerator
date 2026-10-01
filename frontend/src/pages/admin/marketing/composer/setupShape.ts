import type { ContentType } from '../../../../services/contentComposerApi';

/**
 * What Setup should show for the content type you chose.
 *
 * WHY. The form showed every field for every type. Choosing "video" left the message box sitting
 * there with a "Write a first draft" button, as though the text were the post, while the upload
 * that the type actually requires lived in a different section two steps away. Reported from
 * production 2026-10-01: "Am I supposed to generate the Canonical Message for videos because it
 * still gives me the option and that's confusing", and "the setup should be customized by each
 * content type. Only allow the things that are needed."
 *
 * The message is NOT dropped for media types - a Facebook video post still carries body text, and
 * Instagram's caption is this field. What changes is what it is CALLED and what is said about it,
 * because "canonical message" on a video post reads as "write the post here".
 */

export type MediaRole = 'none' | 'required' | 'optional';

export interface SetupShape {
  /** Whether this type needs a file, and whether the composer should say so up front. */
  mediaRole: MediaRole;
  /** Heading for the upload, beside the content type rather than two sections away. */
  mediaLabel: string;
  /** What to attach, in the operator's terms. Null when the type takes no file. */
  mediaHint: string | null;
  /** What the long text field is for THIS type. */
  messageLabel: string;
  messageHint: string | null;
  /** Offer "Write a first draft"? Not where the text is a caption for something already made. */
  offerDraft: boolean;
  /** A tracked destination only makes sense where the network renders a link. */
  showLandingPage: boolean;
  showPoll: boolean;
}

const CAPTION_HINT = 'The words that go with it. Instagram shows this as the caption; Facebook and LinkedIn as the post body.';

const SHAPES: Record<ContentType, SetupShape> = {
  text: {
    mediaRole: 'none', mediaLabel: 'Media', mediaHint: null,
    messageLabel: 'Canonical message', messageHint: 'The post itself. Each network gets its own variant generated from this.',
    offerDraft: true, showLandingPage: true, showPoll: false,
  },
  image: {
    mediaRole: 'required', mediaLabel: 'Image', mediaHint: 'One image. PNG, JPEG or GIF up to 10 MB.',
    messageLabel: 'Caption', messageHint: CAPTION_HINT,
    offerDraft: true, showLandingPage: true, showPoll: false,
  },
  carousel: {
    mediaRole: 'required', mediaLabel: 'Images', mediaHint: 'Two to ten images, in the order they should appear.',
    messageLabel: 'Caption', messageHint: CAPTION_HINT,
    offerDraft: true, showLandingPage: true, showPoll: false,
  },
  video: {
    mediaRole: 'required', mediaLabel: 'Video', mediaHint: 'One MP4 up to 200 MB.',
    messageLabel: 'Caption', messageHint: CAPTION_HINT,
    // The video is the post. Drafting prose from a topic invites writing the post twice.
    offerDraft: false, showLandingPage: true, showPoll: false,
  },
  document: {
    mediaRole: 'required', mediaLabel: 'Document', mediaHint: 'One PDF up to 100 MB. LinkedIn only - no other network has a document post.',
    messageLabel: 'Caption', messageHint: CAPTION_HINT,
    offerDraft: false, showLandingPage: true, showPoll: false,
  },
  poll: {
    mediaRole: 'none', mediaLabel: 'Media', mediaHint: null,
    messageLabel: 'Message above the poll', messageHint: 'Context for the question. The question and its options are set below.',
    offerDraft: false, showLandingPage: false, showPoll: true,
  },
  link: {
    mediaRole: 'optional', mediaLabel: 'Thumbnail (optional)', mediaHint: 'Most networks build their own preview from the page. Attach one only to override it.',
    messageLabel: 'Message', messageHint: 'What you say about the link. The link itself goes in Landing page.',
    offerDraft: true, showLandingPage: true, showPoll: false,
  },
  thread: {
    mediaRole: 'optional', mediaLabel: 'Media (optional)', mediaHint: 'Attach to the first post of the thread.',
    messageLabel: 'Canonical message', messageHint: 'The thread, as one piece of text. It is split per network at generation.',
    offerDraft: true, showLandingPage: true, showPoll: false,
  },
};

export function setupShape(contentType: ContentType): SetupShape {
  return SHAPES[contentType] ?? SHAPES.text;
}

/**
 * The one line that replaces the old blanket warning.
 *
 * It used to say, for every media type, "this declares what you will attach; it does not create
 * one... attach the file under Channels > Media" - which was accurate and also the reason the
 * upload felt hidden. With the upload now beside the type, what is left to say is only whether
 * the draft has to exist first.
 */
export function mediaGateNote(shape: SetupShape, draftExists: boolean): string | null {
  if (shape.mediaRole === 'none') return null;
  if (draftExists) return null;
  return shape.mediaRole === 'required'
    ? `Create the draft first, then attach the ${shape.mediaLabel.toLowerCase()}. Validation will block this post without it.`
    : 'Create the draft first if you want to attach a file.';
}

/** Whether the post is missing the file its own type promises. Drives the warning, not a block. */
export function missingRequiredMedia(shape: SetupShape, attachedCount: number): boolean {
  return shape.mediaRole === 'required' && attachedCount === 0;
}
