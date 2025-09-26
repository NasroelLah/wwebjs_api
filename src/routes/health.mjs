/* global process */
import { redisManager } from "../helpers/redisHelper.mjs";
import { client } from "../whatsappClient.mjs";
import logger from "../logger.mjs";
import { appConfig } from "../config.mjs";

export async function healthRoute(fastify) {
  fastify.get(
    "/health",
    {
      schema: {
        description: "Health check endpoint",
        tags: ['Health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              uptime: { type: 'number' },
              environment: { type: 'string' },
              version: { type: 'string' },
              services: {
                type: 'object',
                properties: {
                  database: { type: 'string' },
                  whatsapp: { type: 'string' }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const startTime = Date.now();
      
      try {
        // Check Redis connection
        const redisHealthy = await redisManager.healthCheck();
        
        // Check WhatsApp client status
        const whatsappHealthy = client && client.info && client.info.wid;
        
        const health = {
          status: (redisHealthy && whatsappHealthy) ? 'healthy' : 'degraded',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          environment: appConfig.environment,
          version: process.env.npm_package_version || '1.11.1',
          services: {
            database: redisHealthy ? 'healthy' : 'unhealthy',
            whatsapp: whatsappHealthy ? 'connected' : 'disconnected'
          },
          responseTime: Date.now() - startTime
        };
        
        const statusCode = health.status === 'healthy' ? 200 : 503;
        
        logger.info({ health }, 'Health check performed');
        
        return reply.status(statusCode).send(health);
      } catch (error) {
        logger.error({ error }, 'Health check failed');
        
        return reply.status(503).send({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error.message,
          responseTime: Date.now() - startTime
        });
      }
    }
  );

  // Liveness probe - minimal check
  fastify.get(
    "/health/live",
    {
      schema: {
        description: "Liveness probe",
        tags: ['Health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      return reply.send({
        status: 'alive',
        timestamp: new Date().toISOString()
      });
    }
  );

  // Readiness probe - check if ready to accept traffic
  fastify.get(
    "/health/ready",
    {
      schema: {
        description: "Readiness probe", 
        tags: ['Health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        // Check critical dependencies
        const redisHealthy = await redisManager.healthCheck();
        
        if (!redisHealthy) {
          return reply.status(503).send({
            status: 'not ready',
            timestamp: new Date().toISOString(),
            reason: 'Redis not available'
          });
        }
        
        return reply.send({
          status: 'ready',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        return reply.status(503).send({
          status: 'not ready',
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    }
  );
}
