import { batchMessageWorkflow } from "../../workflows/messageWorkflows.mjs";

/**
 * Batch message workflow endpoint
 * POST /api/workflows/batch-message
 */
export const POST = batchMessageWorkflow;