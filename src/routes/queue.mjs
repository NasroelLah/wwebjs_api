import logger from "../logger.mjs";
import { queueMonitor } from "../helpers/queueMonitor.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";
import process from "process";

const queueManagementRoutes = async (fastify) => {
  // Rate limiting for queue management operations
  await fastify.register(import('@fastify/rate-limit'), {
    max: 20, // 20 requests per minute
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      status: "error",
      error: {
        type: "RATE_LIMIT_ERROR",
        message: "Too many queue management requests",
        details: "Rate limit: 20 requests per minute"
      }
    })
  });

  // Get queue metrics
  fastify.get('/queue/metrics', {
    schema: {
      description: "Get queue processing metrics",
      tags: ['Queue Management'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                totalProcessed: { type: 'number' },
                totalFailed: { type: 'number' },
                currentQueueSize: { type: 'number' },
                averageProcessingTime: { type: 'number' },
                lastProcessedAt: { type: ['string', 'null'] },
                uptime: { type: 'string' },
                successRate: { type: 'string' },
                recentProcessingTimes: {
                  type: 'array',
                  items: { type: 'number' }
                }
              }
            }
          }
        }
      }
    },
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const metrics = queueMonitor.getMetrics();
      
      logger.debug("Queue metrics requested");
      
      return reply.code(200).send({
        status: "success",
        message: "Queue metrics retrieved successfully",
        data: metrics
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error retrieving queue metrics");
      throw new AppError(
        ErrorTypes.INTERNAL_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Unable to retrieve queue metrics",
        true
      );
    }
  });

  // Get queue health status
  fastify.get('/queue/health', {
    schema: {
      description: "Get queue health status",
      tags: ['Queue Management'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                issues: {
                  type: 'array',
                  items: { type: 'string' }
                },
                metrics: {
                  type: 'object',
                  properties: {
                    failureRate: { type: 'string' },
                    queueSize: { type: 'number' },
                    averageProcessingTime: { type: 'string' },
                    totalProcessed: { type: 'number' }
                  }
                }
              }
            }
          }
        }
      }
    },
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const healthStatus = queueMonitor.getHealthStatus();
      
      const statusCode = healthStatus.status === 'healthy' ? 200 : 
                        healthStatus.status === 'degraded' ? 200 : 503;
      
      logger.debug({ 
        healthStatus: healthStatus.status,
        issues: healthStatus.issues.length 
      }, "Queue health status requested");
      
      return reply.code(statusCode).send({
        status: "success",
        message: `Queue status: ${healthStatus.status}`,
        data: healthStatus
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error retrieving queue health status");
      throw new AppError(
        ErrorTypes.INTERNAL_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Unable to retrieve queue health status",
        true
      );
    }
  });

  // Reset queue metrics (admin only)
  fastify.post('/queue/reset-metrics', {
    schema: {
      description: "Reset queue metrics (admin only)",
      tags: ['Queue Management'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    },
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      // Check if user has admin privileges (you might want to implement proper role checking)
      if (!request.headers['x-admin-key'] || request.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
        throw new AppError(
          ErrorTypes.AUTHORIZATION_ERROR,
          HttpStatusCodes.FORBIDDEN,
          "Admin privileges required to reset queue metrics",
          true
        );
      }

      queueMonitor.reset();
      
      logger.info({
        adminUser: request.user?.id || 'unknown'
      }, "Queue metrics reset by admin");
      
      return reply.code(200).send({
        status: "success",
        message: "Queue metrics reset successfully"
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      
      logger.error({ error: error.message }, "Error resetting queue metrics");
      throw new AppError(
        ErrorTypes.INTERNAL_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Unable to reset queue metrics",
        true
      );
    }
  });

  // Get queue status summary (lightweight endpoint)
  fastify.get('/queue/status', {
    schema: {
      description: "Get quick queue status summary",
      tags: ['Queue Management'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                queueSize: { type: 'number' },
                isProcessing: { type: 'boolean' },
                lastProcessedAt: { type: ['string', 'null'] },
                totalProcessed: { type: 'number' }
              }
            }
          }
        }
      }
    },
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const metrics = queueMonitor.getMetrics();
      
      // Determine if queue is actively processing
      const isProcessing = metrics.lastProcessedAt && 
        (Date.now() - new Date(metrics.lastProcessedAt).getTime()) < 60000; // Within last minute
      
      return reply.code(200).send({
        status: "success",
        message: "Queue status retrieved successfully",
        data: {
          queueSize: metrics.currentQueueSize,
          isProcessing,
          lastProcessedAt: metrics.lastProcessedAt,
          totalProcessed: metrics.totalProcessed
        }
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error retrieving queue status");
      throw new AppError(
        ErrorTypes.INTERNAL_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Unable to retrieve queue status",
        true
      );
    }
  });
};

export default queueManagementRoutes;
