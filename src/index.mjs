import { initializeWhatsApp } from "./whatsappClient.mjs";
import { startServer } from "./server.mjs";

// Global error handling
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// Mulai inisialisasi WhatsApp dan server Fastify
initializeWhatsApp();
startServer();
