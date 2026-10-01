import { Request, Response } from 'express';
import { z } from 'zod';
import { sendManagerMessageInputSchema } from '../schemas/agentManagerConversationSchema';
import { getConversationHistory, sendManagerMessage, AgentNotFoundError, TicketNotAccessibleError } from '../services/agentManagerConversationService';

// AI Workforce Management, Checkpoint C — requireAgentManagerOrAdmin-gated
// (route layer), same 500-on-unexpected-failure / never-a-raw-stack-trace
// posture as agentDetailController.ts.

function agentIdParam(req: Request): string | null {
  const idParam = req.params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  return id || null;
}

export async function handleGetConversation(req: Request, res: Response) {
  try {
    const id = agentIdParam(req);
    if (!id) {
      res.status(400).json({ error: 'Agent id is required' });
      return;
    }
    const view = await getConversationHistory(id, req.admin!.email);
    if (!view) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(view);
  } catch (err: any) {
    console.error('[AgentManagerConversation] Error:', err.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
}

export async function handleSendManagerMessage(req: Request, res: Response) {
  try {
    const id = agentIdParam(req);
    if (!id) {
      res.status(400).json({ error: 'Agent id is required' });
      return;
    }
    const input = sendManagerMessageInputSchema.parse(req.body || {});
    const view = await sendManagerMessage(id, req.admin!.email, req.agentManagerOrgMemberId ?? null, input.message, input.ticket_id ?? null);
    res.status(201).json(view);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', issues: err.issues });
      return;
    }
    if (err instanceof AgentNotFoundError || err instanceof TicketNotAccessibleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[AgentManagerConversation] Error:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
}
