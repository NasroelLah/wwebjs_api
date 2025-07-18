/* global process */
import logger from '../logger.mjs';
import { AppError } from './AppError.mjs';

/**
 * Centralized Error Handler
 */
class ErrorHandler {
  /**
   * Handle all application errors
   * @param {Error} error - The error to handle
   * @param {Object} reply - Fastify reply object (optional)
   */
  async handleError(error, reply = null) {
    await this.logError(error);
    await this.fireMonitoringMetric(error);
    
    if (reply) {
      await this.sendErrorResponse(error, reply);
    }
    
    if (!this.isTrustedError(error)) {
      process.exit(1);
    }
  }

  /**
   * Log the error with appropriate level
   * @param {Error} error - Error to log
   */
  async logError(error) {
    const errorInfo = {
      name: error.name || 'UnknownError',
      message: error.message,
      stack: error.stack,
      statusCode: error.statusCode,
      isOperational: error.isOperational
    };

    if (this.isTrustedError(error)) {
      logger.warn(errorInfo, 'Operational error occurred');
    } else {
      logger.error(errorInfo, 'Programmer error occurred');
    }
  }

  /**
   * Send appropriate error response to client
   * @param {Error} error - Error object
   * @param {Object} reply - Fastify reply object
   */
  async sendErrorResponse(error, reply) {
    if (reply.sent) return;

    const statusCode = error.statusCode || 500;
    const message = this.isTrustedError(error) 
      ? error.message 
      : 'Internal server error';

    const errorResponse = {
      status: 'error',
      message,
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack,
        details: error
      })
    };

    reply.status(statusCode).send(errorResponse);
  }

  /**
   * Check if error is operational/trusted
   * @param {Error} error - Error to check
   * @returns {boolean} True if error is operational
   */
  isTrustedError(error) {
    if (error instanceof AppError) {
      return error.isOperational;
    }
    return false;
  }

  /**
   * Fire monitoring metrics (placeholder for actual implementation)
   * @param {Error} error - Error to monitor
   */
  async fireMonitoringMetric(error) {
    // TODO: Implement actual monitoring (e.g., send to external service)
    logger.debug({ errorName: error.name }, 'Error metric fired');
  }
}

export const errorHandler = new ErrorHandler();
