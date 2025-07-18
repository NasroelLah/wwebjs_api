import "dotenv/config";
import pino from "pino";
import { appConfig } from "./config.mjs";

const logLevel = appConfig.isDevelopment ? "debug" : "info";

const logger = pino({
  level: logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
    error: (error) => {
      return {
        type: error.constructor.name,
        message: error.message,
        stack: error.stack,
        ...(error.statusCode && { statusCode: error.statusCode }),
        ...(error.isOperational !== undefined && { isOperational: error.isOperational })
      };
    }
  },
  transport: appConfig.isDevelopment ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      errorLikeObjectKeys: ['err', 'error'],
    }
  } : undefined,
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    error: pino.stdSerializers.err
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'password',
      'token',
      'apiKey',
      'API_KEY'
    ],
    censor: '[REDACTED]'
  }
});

// Add request ID to child loggers
logger.child = function(bindings, options) {
  return pino.prototype.child.call(this, {
    requestId: bindings?.requestId || generateRequestId(),
    ...bindings
  }, options);
};

function generateRequestId() {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

export default logger;
