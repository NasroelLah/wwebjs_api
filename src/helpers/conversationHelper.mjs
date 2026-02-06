import { dbManager } from "./dbHelper.mjs";
import logger from "../logger.mjs";
import { llmConfig } from "../config.mjs";

export async function initConversationTable() {
  try {
    await dbManager.connect();
    const db = dbManager.getDatabase();

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_conversations_contact 
        ON conversations(contact_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_created 
        ON conversations(created_at);
    `);

    logger.info("Conversation table initialized");
  } catch (error) {
    logger.error({ error }, "Failed to init conversation table");
  }
}

export async function getConversationHistory(contactId, limit = 20) {
  try {
    await dbManager.connect();
    const db = dbManager.getDatabase();

    const stmt = db.prepare(`
      SELECT role, content, created_at
      FROM conversations
      WHERE contact_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(contactId, limit);

    // Return in chronological order (oldest first)
    return rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
    }));
  } catch (error) {
    logger.error({ error, contactId }, "Failed to get conversation history");
    return [];
  }
}

export async function saveMessage(contactId, role, content) {
  try {
    await dbManager.connect();
    const db = dbManager.getDatabase();

    const stmt = db.prepare(`
      INSERT INTO conversations (contact_id, role, content, created_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(contactId, role, content, new Date().toISOString());
  } catch (error) {
    logger.error({ error, contactId, role }, "Failed to save message");
  }
}

export async function clearConversation(contactId) {
  try {
    await dbManager.connect();
    const db = dbManager.getDatabase();

    const stmt = db.prepare(`DELETE FROM conversations WHERE contact_id = ?`);
    const result = stmt.run(contactId);

    logger.info({ contactId, deleted: result.changes }, "Conversation cleared");
    return result.changes;
  } catch (error) {
    logger.error({ error, contactId }, "Failed to clear conversation");
    return 0;
  }
}

export async function clearOldConversations(daysOld = 7) {
  try {
    await dbManager.connect();
    const db = dbManager.getDatabase();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const stmt = db.prepare(`
      DELETE FROM conversations 
      WHERE created_at < ?
    `);

    const result = stmt.run(cutoffDate.toISOString());
    logger.info({ deleted: result.changes, daysOld }, "Old conversations cleared");
    return result.changes;
  } catch (error) {
    logger.error({ error }, "Failed to clear old conversations");
    return 0;
  }
}

export async function getConversationStats() {
  try {
    await dbManager.connect();
    const db = dbManager.getDatabase();

    const stats = db
      .prepare(
        `
      SELECT 
        COUNT(DISTINCT contact_id) as total_contacts,
        COUNT(*) as total_messages,
        SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as user_messages,
        SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) as assistant_messages
      FROM conversations
    `
      )
      .get();

    return stats;
  } catch (error) {
    logger.error({ error }, "Failed to get conversation stats");
    return null;
  }
}

// Rate limiting
const rateLimitMap = new Map();

export function checkRateLimit(contactId) {
  const limit = llmConfig.rateLimit || 10;
  const windowMs = 60000; // 1 minute

  const now = Date.now();
  const contactData = rateLimitMap.get(contactId) || { count: 0, resetAt: now + windowMs };

  // Reset if window expired
  if (now > contactData.resetAt) {
    contactData.count = 0;
    contactData.resetAt = now + windowMs;
  }

  if (contactData.count >= limit) {
    return false; // Rate limited
  }

  contactData.count++;
  rateLimitMap.set(contactId, contactData);
  return true;
}

export function getRateLimitInfo(contactId) {
  const limit = llmConfig.rateLimit || 10;
  const data = rateLimitMap.get(contactId);

  if (!data) {
    return { remaining: limit, resetIn: 0 };
  }

  const now = Date.now();
  if (now > data.resetAt) {
    return { remaining: limit, resetIn: 0 };
  }

  return {
    remaining: Math.max(0, limit - data.count),
    resetIn: Math.ceil((data.resetAt - now) / 1000),
  };
}
