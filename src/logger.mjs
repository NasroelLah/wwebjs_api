import "dotenv/config";
import pino from "pino";

const isLoggerEnabled = process.env.ENABLE_LOGGER === "true";
const logLevel = isLoggerEnabled ? "debug" : "error";

const logger = pino({
  level: logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
