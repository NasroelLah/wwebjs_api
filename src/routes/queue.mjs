import { redisManager, getMessageStatusSummary } from "../helpers/redisHelper.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

export default async function queueManagementRoutes(fastify) {
  fastify.addHook("preHandler", fastify.authenticate);

  async function summary() {
    const healthy = await redisManager.healthCheck();
    if (!healthy) throw new AppError(ErrorTypes.DATABASE_ERROR, HttpStatusCodes.SERVICE_UNAVAILABLE, "Upstash Redis unavailable", true);
    return getMessageStatusSummary();
  }

  fastify.get("/queue/metrics", async (_request, reply) => {
    const counts = await summary();
    return reply.send({ status: "success", message: "Queue status counts", data: { ...counts, processingTimeMetrics: null } });
  });
  fastify.get("/queue/health", async (_request, reply) => {
    const counts = await summary();
    return reply.send({ status: "success", message: "Queue storage healthy", data: { status: "healthy", counts } });
  });
  fastify.get("/queue/status", async (_request, reply) => {
    const counts = await summary();
    return reply.send({ status: "success", message: "Queue status retrieved", data: { queueSize: counts.scheduled, ...counts } });
  });
}
