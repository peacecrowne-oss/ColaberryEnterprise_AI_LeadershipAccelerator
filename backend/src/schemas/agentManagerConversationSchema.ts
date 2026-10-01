import { z } from 'zod';

// Runtime validation for sending a manager message (AI Workforce Management,
// Checkpoint C — Direct Agent Communication).

export const sendManagerMessageInputSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  // Reese manager-directed growth mission, Phase 2 (2026-09-30) — present only on the
  // message that binds (or explicitly switches) the conversation's focus to a real ticket;
  // omitted to reuse whatever case is already bound. See sendManagerMessage()'s own comment.
  ticket_id: z.string().uuid().optional(),
});

export type SendManagerMessageInput = z.infer<typeof sendManagerMessageInputSchema>;
