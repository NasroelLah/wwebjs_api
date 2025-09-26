import { cleanupWorkflow } from "../../workflows/messageWorkflows.mjs";

/**
 * Cleanup workflow endpoint
 * POST /api/workflows/cleanup
 */
export default function cleanupWorkflowRoute(fastify) {
  fastify.post('/', cleanupWorkflow);
}