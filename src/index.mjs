/* global process */
import { initializeWhatsApp, destroyWhatsApp } from "./whatsappClient.mjs";
import { closeServer, startServer } from "./server.mjs";
import logger from "./logger.mjs";

let shuttingDown = false;

async function shutdown(reason, error = null) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (error) {
    logger.error({ error }, `${reason}; shutting down`);
  } else {
    logger.info(`${reason}; shutting down`);
  }

  try {
    await closeServer();
  } catch (closeError) {
    logger.warn({ error: closeError.message }, "Failed to close HTTP server cleanly");
  }

  await destroyWhatsApp();
  process.exit(error ? 1 : 0);
}

process.on("unhandledRejection", (reason) => {
  void shutdown("Unhandled Promise Rejection", reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("uncaughtException", (error) => {
  void shutdown("Uncaught Exception", error);
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM received");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT received");
});

try {
  await initializeWhatsApp();
} catch (error) {
  logger.error({ error: error.message }, "Initial WhatsApp startup failed; device endpoint can retry later");
}

startServer();
