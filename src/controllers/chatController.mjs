/**
 * @fileoverview Chat Controller - Business logic for chat operations
 * @module controllers/chatController
 */

import { client, isClientReady } from "../whatsappClient.mjs";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

// Simple in-memory cache for chats
const chatCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

/**
 * Ensures WhatsApp client is ready
 * @throws {AppError} If client is not ready
 */
function ensureClientReady() {
  if (!isClientReady()) {
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.SERVICE_UNAVAILABLE,
      "WhatsApp client is not ready",
      true
    );
  }
}

/**
 * Normalizes chat ID to WhatsApp format
 * @param {string} id - Chat ID
 * @param {boolean} isGroup - Whether it's a group chat
 * @returns {string} Normalized chat ID
 */
function normalizeChatId(id, isGroup = false) {
  if (id.includes("@")) return id;
  return isGroup ? `${id}@g.us` : `${id}@c.us`;
}

/**
 * Serializes chat object for API response
 * @param {Object} chat - WhatsApp chat object
 * @returns {Object} Serialized chat
 */
function serializeChat(chat) {
  return {
    id: chat.id._serialized,
    name: chat.name,
    isGroup: chat.isGroup,
    isReadOnly: chat.isReadOnly,
    unreadCount: chat.unreadCount,
    timestamp: chat.timestamp,
    pinned: chat.pinned,
    archived: chat.archived,
    isMuted: chat.isMuted,
  };
}

/**
 * Get all chats with caching
 * @returns {Promise<Array>} List of chats
 */
export async function getAllChats() {
  ensureClientReady();
  
  const cacheKey = "all_chats";
  const cached = chatCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug("Returning cached chats");
    return cached.data;
  }
  
  try {
    const chats = await client.getChats();
    const data = chats.map(serializeChat);
    
    chatCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    logger.error({ error }, "Failed to get chats");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to get chats",
      true
    );
  }
}

/**
 * Get chat by ID
 * @param {string} id - Chat ID
 * @returns {Promise<Object>} Chat object with details
 */
export async function getChatById(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    return {
      ...serializeChat(chat),
      lastMessage: chat.lastMessage ? {
        body: chat.lastMessage.body,
        timestamp: chat.lastMessage.timestamp,
        fromMe: chat.lastMessage.fromMe,
      } : null,
    };
  } catch (error) {
    logger.error({ error, chatId }, "Failed to get chat");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.NOT_FOUND,
      "Chat not found",
      true
    );
  }
}

/**
 * Fetch messages from chat
 * @param {string} id - Chat ID
 * @param {number} limit - Max messages to fetch
 * @returns {Promise<Array>} List of messages
 */
export async function fetchMessages(id, limit = 50) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: Math.min(limit, 100) });
    
    return messages.map((m) => ({
      id: m.id._serialized,
      body: m.body,
      type: m.type,
      timestamp: m.timestamp,
      fromMe: m.fromMe,
      author: m.author || null,
      hasMedia: m.hasMedia,
      isForwarded: m.isForwarded,
      isStarred: m.isStarred,
    }));
  } catch (error) {
    logger.error({ error, chatId }, "Failed to fetch messages");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to fetch messages",
      true
    );
  }
}

/**
 * Archive a chat
 * @param {string} id - Chat ID
 */
export async function archiveChat(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.archive();
    logger.info({ chatId }, "Chat archived");
    chatCache.delete("all_chats");
  } catch (error) {
    logger.error({ error, chatId }, "Failed to archive chat");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to archive chat",
      true
    );
  }
}

/**
 * Unarchive a chat
 * @param {string} id - Chat ID
 */
export async function unarchiveChat(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.unarchive();
    logger.info({ chatId }, "Chat unarchived");
    chatCache.delete("all_chats");
  } catch (error) {
    logger.error({ error, chatId }, "Failed to unarchive chat");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to unarchive chat",
      true
    );
  }
}

/**
 * Pin a chat
 * @param {string} id - Chat ID
 * @returns {Promise<boolean>} Whether chat was pinned
 */
export async function pinChat(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    const pinned = await chat.pin();
    logger.info({ chatId, pinned }, "Chat pin toggled");
    chatCache.delete("all_chats");
    return pinned;
  } catch (error) {
    logger.error({ error, chatId }, "Failed to pin chat");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to pin chat",
      true
    );
  }
}

/**
 * Unpin a chat
 * @param {string} id - Chat ID
 */
export async function unpinChat(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.unpin();
    logger.info({ chatId }, "Chat unpinned");
    chatCache.delete("all_chats");
  } catch (error) {
    logger.error({ error, chatId }, "Failed to unpin chat");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to unpin chat",
      true
    );
  }
}

/**
 * Mute a chat
 * @param {string} id - Chat ID
 * @param {number} duration - Duration in seconds (optional)
 */
export async function muteChat(id, duration) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    const unmuteDate = duration ? new Date(Date.now() + duration * 1000) : undefined;
    await chat.mute(unmuteDate);
    logger.info({ chatId, duration }, "Chat muted");
  } catch (error) {
    logger.error({ error, chatId }, "Failed to mute chat");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to mute chat",
      true
    );
  }
}

/**
 * Unmute a chat
 * @param {string} id - Chat ID
 */
export async function unmuteChat(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.unmute();
    logger.info({ chatId }, "Chat unmuted");
  } catch (error) {
    logger.error({ error, chatId }, "Failed to unmute chat");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to unmute chat",
      true
    );
  }
}

/**
 * Mark chat as read
 * @param {string} id - Chat ID
 */
export async function markAsRead(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendSeen();
    logger.info({ chatId }, "Chat marked as read");
  } catch (error) {
    logger.error({ error, chatId }, "Failed to mark as read");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to mark chat as read",
      true
    );
  }
}

/**
 * Mark chat as unread
 * @param {string} id - Chat ID
 */
export async function markAsUnread(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.markUnread();
    logger.info({ chatId }, "Chat marked as unread");
  } catch (error) {
    logger.error({ error, chatId }, "Failed to mark as unread");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to mark chat as unread",
      true
    );
  }
}

/**
 * Delete a chat
 * @param {string} id - Chat ID
 */
export async function deleteChat(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.delete();
    logger.info({ chatId }, "Chat deleted");
    chatCache.delete("all_chats");
  } catch (error) {
    logger.error({ error, chatId }, "Failed to delete chat");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to delete chat",
      true
    );
  }
}

/**
 * Clear all messages in chat
 * @param {string} id - Chat ID
 */
export async function clearChat(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.clearMessages();
    logger.info({ chatId }, "Chat cleared");
  } catch (error) {
    logger.error({ error, chatId }, "Failed to clear chat");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to clear chat",
      true
    );
  }
}

/**
 * Send typing indicator
 * @param {string} id - Chat ID
 */
export async function sendTyping(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
  } catch (error) {
    logger.error({ error, chatId }, "Failed to send typing");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to send typing indicator",
      true
    );
  }
}

/**
 * Send recording indicator
 * @param {string} id - Chat ID
 */
export async function sendRecording(id) {
  ensureClientReady();
  const chatId = normalizeChatId(id);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateRecording();
  } catch (error) {
    logger.error({ error, chatId }, "Failed to send recording");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to send recording indicator",
      true
    );
  }
}

/**
 * Clear chat cache
 */
export function clearChatCache() {
  chatCache.clear();
  logger.debug("Chat cache cleared");
}
