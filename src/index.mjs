/* global process */
import { initializeWhatsApp } from "./whatsappClient.mjs";
import { startServer } from "./server.mjs";

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

initializeWhatsApp();
startServer();
