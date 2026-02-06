/**
 * @fileoverview Message Controller - Business logic for message operations
 * @module controllers/messageController
 */

import { client, isClientReady } from "../whatsappClient.mjs";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

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
 * @returns {string} Normalized chat ID
 */
function normalizeChatId(id) {
  return id.includes("@") ? id : `${id}@c.us`;
}

/**
 * Get message by ID
 * @param {string} id - Message ID
 * @returns {Promise<Object>} Message object
 */
export async function getMessageById(id) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    return {
      id: message.id._serialized,
      body: message.body,
      type: message.type,
      timestamp: message.timestamp,
      from: message.from,
      to: message.to,
      fromMe: message.fromMe,
      hasMedia: message.hasMedia,
      hasQuotedMsg: message.hasQuotedMsg,
      isForwarded: message.isForwarded,
      isStarred: message.isStarred,
      ack: message.ack,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to get message");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.NOT_FOUND,
      "Message not found",
      true
    );
  }
}

/**
 * Reply to a message
 * @param {string} id - Message ID
 * @param {string} content - Reply content
 * @param {string} chatId - Optional chat ID to reply in
 * @returns {Promise<Object>} Sent message info
 */
export async function replyToMessage(id, content, chatId) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    const sentMessage = await message.reply(content, chatId);
    logger.info({ messageId: id }, "Message replied");
    
    return { id: sentMessage.id._serialized };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to reply");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to reply to message",
      true
    );
  }
}

/**
 * React to a message
 * @param {string} id - Message ID
 * @param {string} emoji - Emoji to react with
 */
export async function reactToMessage(id, emoji) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    await message.react(emoji);
    logger.info({ messageId: id, emoji }, "Message reacted");
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to react");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to react to message",
      true
    );
  }
}

/**
 * Forward a message
 * @param {string} id - Message ID
 * @param {string} chatId - Target chat ID
 * @returns {Promise<Object>} Forwarded message info
 */
export async function forwardMessage(id, chatId) {
  ensureClientReady();
  const targetChatId = normalizeChatId(chatId);
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    const forwardedMsg = await message.forward(targetChatId);
    logger.info({ messageId: id, targetChatId }, "Message forwarded");
    
    return { id: forwardedMsg.id._serialized };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to forward");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to forward message",
      true
    );
  }
}

/**
 * Delete a message
 * @param {string} id - Message ID
 * @param {boolean} everyone - Delete for everyone
 */
export async function deleteMessage(id, everyone = false) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    await message.delete(everyone);
    logger.info({ messageId: id, everyone }, "Message deleted");
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to delete");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to delete message",
      true
    );
  }
}

/**
 * Edit a message
 * @param {string} id - Message ID
 * @param {string} content - New content
 * @returns {Promise<Object|null>} Edited message info
 */
export async function editMessage(id, content) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    const editedMsg = await message.edit(content);
    logger.info({ messageId: id }, "Message edited");
    
    return editedMsg ? { id: editedMsg.id._serialized } : null;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to edit");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to edit message",
      true
    );
  }
}

/**
 * Star a message
 * @param {string} id - Message ID
 */
export async function starMessage(id) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    await message.star();
    logger.info({ messageId: id }, "Message starred");
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to star");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to star message",
      true
    );
  }
}

/**
 * Unstar a message
 * @param {string} id - Message ID
 */
export async function unstarMessage(id) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    await message.unstar();
    logger.info({ messageId: id }, "Message unstarred");
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to unstar");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to unstar message",
      true
    );
  }
}

/**
 * Pin a message
 * @param {string} id - Message ID
 * @param {number} duration - Duration in seconds
 */
export async function pinMessage(id, duration = 604800) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    await message.pin(duration);
    logger.info({ messageId: id, duration }, "Message pinned");
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to pin");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to pin message",
      true
    );
  }
}

/**
 * Unpin a message
 * @param {string} id - Message ID
 */
export async function unpinMessage(id) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    await message.unpin();
    logger.info({ messageId: id }, "Message unpinned");
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to unpin");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to unpin message",
      true
    );
  }
}

/**
 * Download media from message
 * @param {string} id - Message ID
 * @returns {Promise<Object>} Media object
 */
export async function downloadMedia(id) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    if (!message.hasMedia) {
      throw new AppError(
        ErrorTypes.VALIDATION_ERROR,
        HttpStatusCodes.BAD_REQUEST,
        "Message has no media",
        true
      );
    }
    
    const media = await message.downloadMedia();
    return {
      mimetype: media.mimetype,
      filename: media.filename || null,
      data: media.data,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to download media");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to download media",
      true
    );
  }
}

/**
 * Get quoted message
 * @param {string} id - Message ID
 * @returns {Promise<Object>} Quoted message object
 */
export async function getQuotedMessage(id) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    if (!message.hasQuotedMsg) {
      throw new AppError(
        ErrorTypes.VALIDATION_ERROR,
        HttpStatusCodes.BAD_REQUEST,
        "Message has no quoted message",
        true
      );
    }
    
    const quotedMsg = await message.getQuotedMessage();
    return {
      id: quotedMsg.id._serialized,
      body: quotedMsg.body,
      type: quotedMsg.type,
      timestamp: quotedMsg.timestamp,
      from: quotedMsg.from,
      fromMe: quotedMsg.fromMe,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to get quoted message");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to get quoted message",
      true
    );
  }
}

/**
 * Get message reactions
 * @param {string} id - Message ID
 * @returns {Promise<Array>} Reactions array
 */
export async function getReactions(id) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    const reactions = await message.getReactions();
    return reactions || [];
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to get reactions");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to get reactions",
      true
    );
  }
}

/**
 * Get message info (delivery/read status)
 * @param {string} id - Message ID
 * @returns {Promise<Object>} Message info
 */
export async function getMessageInfo(id) {
  ensureClientReady();
  
  try {
    const message = await client.getMessageById(id);
    
    if (!message) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Message not found",
        true
      );
    }
    
    const info = await message.getInfo();
    return info;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, messageId: id }, "Failed to get message info");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to get message info",
      true
    );
  }
}
