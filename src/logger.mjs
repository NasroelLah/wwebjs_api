import "dotenv/config";
import winston from "winston";

const isLoggerEnabled = process.env.ENABLE_LOGGER === "true";
const logLevel = isLoggerEnabled ? "debug" : "error";

const logger = winston.createLogger({
  level: logLevel,
  transports: [
    new winston.transports.Console({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
});

export default logger;
