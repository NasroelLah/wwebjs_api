import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, existsSync } from "fs";
import logger from "../logger.mjs";
import { dbConfig } from "../config.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DatabaseManager {
  constructor() {
    this.db = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected && this.db) {
      return this.db;
    }

    try {
      const defaultDataDir = join(__dirname, "..", "..", "data");
      const dbPath = dbConfig.sqlite.path || join(defaultDataDir, "whatsapp_api.db");
      
      // Ensure parent directory exists for database file
      const dbDir = dirname(dbPath);
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
        logger.info(`Created database directory: ${dbDir}`);
      }
      
      // better-sqlite3 auto-creates the db file if not exists
      this.db = new Database(dbPath, {
        verbose: dbConfig.sqlite.verbose ? (msg) => logger.debug(msg) : null,
      });

      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");

      this._initSchema();

      this.isConnected = true;
      logger.info(`Connected to SQLite database: ${dbPath}`);
      return this.db;
    } catch (error) {
      logger.error({ error }, "Failed to connect to SQLite");
      throw new AppError(
        ErrorTypes.DATABASE_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Database connection failed",
        true
      );
    }
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        content TEXT NOT NULL,
        options TEXT,
        scheduled_time TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_scheduled_messages_status 
        ON scheduled_messages(status);
      CREATE INDEX IF NOT EXISTS idx_scheduled_messages_scheduled_time 
        ON scheduled_messages(scheduled_time);
    `);
    logger.info("SQLite schema initialized");
  }

  getDatabase() {
    if (!this.db || !this.isConnected) {
      throw new AppError(
        ErrorTypes.DATABASE_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Database not connected",
        true
      );
    }
    return this.db;
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.isConnected = false;
      logger.info("SQLite connection closed");
    }
  }

  async healthCheck() {
    try {
      if (!this.db || !this.isConnected) {
        await this.connect();
      }
      this.db.prepare("SELECT 1").get();
      return true;
    } catch (error) {
      logger.error({ error }, "SQLite health check failed");
      return false;
    }
  }
}

const dbManager = new DatabaseManager();

export async function saveScheduledMessage(chatId, content, options, delay) {
  try {
    await dbManager.connect();
    const db = dbManager.getDatabase();

    const id = randomUUID();
    const scheduledTime = new Date(Date.now() + delay).toISOString();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO scheduled_messages (id, chat_id, content, options, scheduled_time, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)
    `);

    stmt.run(
      id,
      chatId,
      typeof content === "string" ? content : JSON.stringify(content),
      options ? JSON.stringify(options) : null,
      scheduledTime,
      now,
      now
    );

    logger.info(`Scheduled message saved to SQLite for chatId ${chatId}`);
    return id;
  } catch (error) {
    logger.error({ error, chatId }, "Failed to save scheduled message");
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to save scheduled message",
      true
    );
  }
}

export async function getScheduledMessages() {
  try {
    await dbManager.connect();
    const db = dbManager.getDatabase();

    const stmt = db.prepare(`
      SELECT id, chat_id, content, options, scheduled_time, status, created_at, updated_at
      FROM scheduled_messages
      WHERE status = 'scheduled'
    `);

    const rows = stmt.all();

    return rows.map((row) => ({
      _id: row.id,
      chatId: row.chat_id,
      content: row.content,
      options: row.options ? JSON.parse(row.options) : null,
      scheduledTime: new Date(row.scheduled_time),
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  } catch (error) {
    logger.error({ error }, "Failed to get scheduled messages");
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to retrieve scheduled messages",
      true
    );
  }
}

export async function updateMessageStatus(id, status) {
  try {
    await dbManager.connect();
    const db = dbManager.getDatabase();

    const now = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE scheduled_messages
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(status, now, String(id));

    if (result.changes === 0) {
      throw new AppError(
        ErrorTypes.DATABASE_ERROR,
        HttpStatusCodes.NOT_FOUND,
        `Message with id ${id} not found`,
        true
      );
    }

    logger.info(`Message status updated to ${status} for id ${id}`);
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error({ error, id, status }, "Failed to update message status");
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update message status",
      true
    );
  }
}

process.on("SIGINT", async () => {
  logger.info("Received SIGINT, closing database connection...");
  await dbManager.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, closing database connection...");
  await dbManager.close();
  process.exit(0);
});

export { dbManager };
