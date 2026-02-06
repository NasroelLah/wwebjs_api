/**
 * @fileoverview Contact Controller - Business logic for contact operations
 * @module controllers/contactController
 */

import { client, isClientReady } from "../whatsappClient.mjs";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

// Simple in-memory cache for contacts
const contactCache = new Map();
const CACHE_TTL = 60000; // 1 minute

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
 * Normalizes contact ID to WhatsApp format
 * @param {string} id - Contact ID
 * @returns {string} Normalized contact ID
 */
function normalizeContactId(id) {
  return id.includes("@") ? id : `${id}@c.us`;
}

/**
 * Serializes contact object for API response
 * @param {Object} contact - WhatsApp contact object
 * @returns {Object} Serialized contact
 */
function serializeContact(contact) {
  return {
    id: contact.id._serialized,
    name: contact.name || null,
    pushname: contact.pushname || null,
    shortName: contact.shortName || null,
    isMe: contact.isMe,
    isUser: contact.isUser,
    isGroup: contact.isGroup,
    isBlocked: contact.isBlocked,
    isBusiness: contact.isBusiness,
  };
}

/**
 * Get all contacts with caching
 * @returns {Promise<Array>} List of contacts
 */
export async function getAllContacts() {
  ensureClientReady();
  
  const cacheKey = "all_contacts";
  const cached = contactCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug("Returning cached contacts");
    return cached.data;
  }
  
  try {
    const contacts = await client.getContacts();
    const data = contacts.map(serializeContact);
    
    contactCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    logger.error({ error }, "Failed to get contacts");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to get contacts",
      true
    );
  }
}

/**
 * Get contact by ID
 * @param {string} id - Contact ID
 * @returns {Promise<Object>} Contact object
 */
export async function getContactById(id) {
  ensureClientReady();
  const contactId = normalizeContactId(id);
  
  try {
    const contact = await client.getContactById(contactId);
    return serializeContact(contact);
  } catch (error) {
    logger.error({ error, contactId }, "Failed to get contact");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.NOT_FOUND,
      "Contact not found",
      true
    );
  }
}

/**
 * Get contact profile picture URL
 * @param {string} id - Contact ID
 * @returns {Promise<string|null>} Profile picture URL
 */
export async function getProfilePicture(id) {
  ensureClientReady();
  const contactId = normalizeContactId(id);
  
  try {
    const url = await client.getProfilePicUrl(contactId);
    return url || null;
  } catch (error) {
    logger.error({ error, contactId }, "Failed to get profile picture");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.NOT_FOUND,
      "Profile picture not found",
      true
    );
  }
}

/**
 * Block a contact
 * @param {string} id - Contact ID
 */
export async function blockContact(id) {
  ensureClientReady();
  const contactId = normalizeContactId(id);
  
  try {
    const contact = await client.getContactById(contactId);
    await contact.block();
    logger.info({ contactId }, "Contact blocked");
    contactCache.delete("all_contacts"); // Invalidate cache
  } catch (error) {
    logger.error({ error, contactId }, "Failed to block contact");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to block contact",
      true
    );
  }
}

/**
 * Unblock a contact
 * @param {string} id - Contact ID
 */
export async function unblockContact(id) {
  ensureClientReady();
  const contactId = normalizeContactId(id);
  
  try {
    const contact = await client.getContactById(contactId);
    await contact.unblock();
    logger.info({ contactId }, "Contact unblocked");
    contactCache.delete("all_contacts"); // Invalidate cache
  } catch (error) {
    logger.error({ error, contactId }, "Failed to unblock contact");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to unblock contact",
      true
    );
  }
}

/**
 * Get all blocked contacts
 * @returns {Promise<Array>} List of blocked contacts
 */
export async function getBlockedContacts() {
  ensureClientReady();
  
  try {
    const blocked = await client.getBlockedContacts();
    return blocked.map((c) => ({
      id: c.id._serialized,
      name: c.name || null,
      pushname: c.pushname || null,
    }));
  } catch (error) {
    logger.error({ error }, "Failed to get blocked contacts");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to get blocked contacts",
      true
    );
  }
}

/**
 * Clear contact cache
 */
export function clearContactCache() {
  contactCache.clear();
  logger.debug("Contact cache cleared");
}
