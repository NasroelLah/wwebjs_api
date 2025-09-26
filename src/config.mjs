/* global process */
import dotenv from "dotenv";
import { AppError, ErrorTypes, HttpStatusCodes } from "./errors/AppError.mjs";

dotenv.config();

/**
 * Validate and parse environment variable
 * @param {string} key - Environment variable key
 * @param {*} defaultValue - Default value if not found
 * @param {string} type - Type to parse to ('string', 'number', 'boolean')
 * @param {boolean} required - Whether the variable is required
 * @returns {*} Parsed value
 */
function getEnvVar(key, defaultValue, type = 'string', required = false) {
  const value = process.env[key];
  
  if (!value && required) {
    throw new AppError(
      ErrorTypes.CONFIGURATION_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      `Required environment variable ${key} is not set`,
      false
    );
  }
  
  if (!value) return defaultValue;
  
  switch (type) {
    case 'number': {
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        throw new AppError(
          ErrorTypes.CONFIGURATION_ERROR,
          HttpStatusCodes.INTERNAL_SERVER_ERROR,
          `Environment variable ${key} must be a valid number`,
          false
        );
      }
      return num;
    }
    case 'boolean':
      return value.toLowerCase() === 'true';
    default:
      return value;
  }
}

// Server Configuration
export const NODE_ENV = getEnvVar('NODE_ENV', 'development', 'string');
export const API_KEY = getEnvVar('API_KEY', 'dev-api-key-123', 'string', NODE_ENV === 'production');
export const HOST_PORT = getEnvVar('HOST_PORT', 3000, 'number');
export const WEBHOOK_URL = getEnvVar('WEBHOOK_URL', null, 'string');
export const ENABLE_LOGGER = getEnvVar('ENABLE_LOGGER', false, 'boolean');

// Rate Limiting
export const RATE_LIMIT = getEnvVar('RATE_LIMIT', 100, 'number');
export const RATE_LIMIT_EXPIRE = getEnvVar('RATE_LIMIT_EXPIRE', 60, 'number');

// Security
export const ALLOWED_ORIGINS = getEnvVar('ALLOWED_ORIGINS', 'http://localhost:3000', 'string');

// Webhook Configuration
export const webhookConfig = {
  url: WEBHOOK_URL,
  excludeMe: getEnvVar('WEBHOOK_EXCLUDE_ME', false, 'boolean'),
  excludeGroup: getEnvVar('WEBHOOK_EXCLUDE_GROUP', false, 'boolean'),
  excludeChannel: getEnvVar('WEBHOOK_EXCLUDE_CHANNEL', false, 'boolean'),
};

// Message Configuration
export const messageConfig = {
  delayType: getEnvVar('MESSAGE_DELAY_TYPE', 'fixed', 'string'),
  delay: getEnvVar('MESSAGE_DELAY', 0, 'number'),
};

// Workflow Configuration
export const workflowConfig = {
  qstashUrl: getEnvVar('QSTASH_URL', 'https://qstash.upstash.io/v2', 'string'),
  qstashToken: getEnvVar('QSTASH_TOKEN', null, 'string', NODE_ENV === 'production'),
  qstashCurrentSigningKey: getEnvVar('QSTASH_CURRENT_SIGNING_KEY', null, 'string', NODE_ENV === 'production'),
  qstashNextSigningKey: getEnvVar('QSTASH_NEXT_SIGNING_KEY', null, 'string', NODE_ENV === 'production'),
  baseUrl: getEnvVar('WORKFLOW_BASE_URL', `http://localhost:${getEnvVar('HOST_PORT', 3000, 'number')}`, 'string'),
};

// Database Configuration
export const dbConfig = {
  redis: {
    url: getEnvVar('UPSTASH_REDIS_REST_URL', null, 'string', NODE_ENV === 'production'),
    token: getEnvVar('UPSTASH_REDIS_REST_TOKEN', null, 'string', NODE_ENV === 'production'),
  },
};

// Application Configuration
export const appConfig = {
  timezone: getEnvVar('APP_TIMEZONE', 'UTC', 'string'),
  environment: NODE_ENV,
  isDevelopment: NODE_ENV === 'development',
  isProduction: NODE_ENV === 'production',
};
