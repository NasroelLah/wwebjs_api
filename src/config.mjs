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

// Queue Configuration
export const queueConfig = {
  connection: getEnvVar('QUEUE_CONNECTION', 'cron', 'string'),
  redis: {
    host: getEnvVar('REDIS_HOST', '127.0.0.1', 'string'),
    port: getEnvVar('REDIS_PORT', 6379, 'number'),
    user: getEnvVar('REDIS_USER', '', 'string'),
    password: getEnvVar('REDIS_PASSWORD', '', 'string'),
  },
};

// Database Configuration
export const dbConfig = {
  sqlite: {
    path: getEnvVar('SQLITE_PATH', null, 'string'), // null = default to ./data/whatsapp_api.db
    verbose: getEnvVar('SQLITE_VERBOSE', false, 'boolean'),
  },
};

// Application Configuration
export const appConfig = {
  timezone: getEnvVar('APP_TIMEZONE', 'UTC', 'string'),
  environment: NODE_ENV,
  isDevelopment: NODE_ENV === 'development',
  isProduction: NODE_ENV === 'production',
};

// LLM Configuration
export const llmConfig = {
  enabled: getEnvVar('LLM_ENABLED', false, 'boolean'),
  provider: getEnvVar('LLM_PROVIDER', 'openai', 'string'), // openai, openai-compatible, claude, gemini
  apiKey: getEnvVar('LLM_API_KEY', null, 'string'),
  model: getEnvVar('LLM_MODEL', null, 'string'),
  // OpenAI-compatible API settings (for local LLMs like Ollama, LM Studio, vLLM, etc.)
  baseUrl: getEnvVar('LLM_BASE_URL', null, 'string'), // e.g., http://localhost:11434/v1
  systemPrompt: getEnvVar('LLM_SYSTEM_PROMPT', 'You are a helpful WhatsApp assistant. Be concise and friendly.', 'string'),
  maxTokens: getEnvVar('LLM_MAX_TOKENS', 500, 'number'),
  temperature: getEnvVar('LLM_TEMPERATURE', 0.7, 'number'),
  // Auto-response settings
  triggerMode: getEnvVar('LLM_TRIGGER_MODE', 'all', 'string'), // all, keyword, prefix
  triggerKeywords: getEnvVar('LLM_TRIGGER_KEYWORDS', '', 'string'), // comma-separated
  triggerPrefix: getEnvVar('LLM_TRIGGER_PREFIX', '!ai ', 'string'),
  excludeGroups: getEnvVar('LLM_EXCLUDE_GROUPS', true, 'boolean'),
  excludeChannels: getEnvVar('LLM_EXCLUDE_CHANNELS', true, 'boolean'),
  rateLimit: getEnvVar('LLM_RATE_LIMIT', 10, 'number'), // per minute per contact
  historyLimit: getEnvVar('LLM_HISTORY_LIMIT', 10, 'number'), // messages to include
};
