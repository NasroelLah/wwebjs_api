import { messageWorkflow } from "../../workflows/messageWorkflows.mjs";

/**
 * Message workflow endpoint
 * POST /api/workflows/message
 */
export default function messageWorkflowRoute(fastify) {
  fastify.post('/', messageWorkflow);
}