import { cleanupWorkflow } from "../../workflows/messageWorkflows.mjs";

/**
 * Cleanup workflow endpoint
 * POST /api/workflows/cleanup
 */
export const POST = cleanupWorkflow;