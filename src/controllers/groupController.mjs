/**
 * @fileoverview Group Controller - Business logic for group operations
 * @module controllers/groupController
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
 * Normalizes group ID to WhatsApp format
 * @param {string} id - Group ID
 * @returns {string} Normalized group ID
 */
function normalizeGroupId(id) {
  return id.includes("@") ? id : `${id}@g.us`;
}

/**
 * Normalizes participant ID to WhatsApp format
 * @param {string} id - Participant ID
 * @returns {string} Normalized participant ID
 */
function normalizeParticipantId(id) {
  return id.includes("@") ? id : `${id}@c.us`;
}

/**
 * Create a new group
 * @param {string} name - Group name
 * @param {Array<string>} participants - Participant IDs
 * @returns {Promise<Object>} Created group info
 */
export async function createGroup(name, participants) {
  ensureClientReady();
  
  try {
    const participantIds = participants.map(normalizeParticipantId);
    const result = await client.createGroup(name, participantIds);
    
    logger.info({ groupId: result.gid._serialized, name }, "Group created");
    return {
      id: result.gid._serialized,
      name,
      participants: result.participants || [],
    };
  } catch (error) {
    logger.error({ error, name }, "Failed to create group");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to create group",
      true
    );
  }
}

/**
 * Get group info
 * @param {string} id - Group ID
 * @returns {Promise<Object>} Group info
 */
export async function getGroupInfo(id) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    
    if (!chat.isGroup) {
      throw new AppError(
        ErrorTypes.VALIDATION_ERROR,
        HttpStatusCodes.BAD_REQUEST,
        "Not a group chat",
        true
      );
    }
    
    return {
      id: chat.id._serialized,
      name: chat.name,
      description: chat.groupMetadata?.desc || null,
      owner: chat.owner?._serialized || null,
      createdAt: chat.groupMetadata?.creation || null,
      participants: chat.participants?.map((p) => ({
        id: p.id._serialized,
        isAdmin: p.isAdmin,
        isSuperAdmin: p.isSuperAdmin,
      })) || [],
      participantCount: chat.participants?.length || 0,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, groupId }, "Failed to get group info");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.NOT_FOUND,
      "Group not found",
      true
    );
  }
}

/**
 * Update group subject (name)
 * @param {string} id - Group ID
 * @param {string} subject - New subject
 */
export async function updateSubject(id, subject) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    await chat.setSubject(subject);
    logger.info({ groupId, subject }, "Group subject updated");
  } catch (error) {
    logger.error({ error, groupId }, "Failed to update subject");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update group subject",
      true
    );
  }
}

/**
 * Update group description
 * @param {string} id - Group ID
 * @param {string} description - New description
 * @returns {Promise<boolean>} Success status
 */
export async function updateDescription(id, description) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    const success = await chat.setDescription(description);
    
    if (!success) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.FORBIDDEN,
        "No permission to update description",
        true
      );
    }
    
    logger.info({ groupId }, "Group description updated");
    return true;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ error, groupId }, "Failed to update description");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update group description",
      true
    );
  }
}

/**
 * Get group invite code
 * @param {string} id - Group ID
 * @returns {Promise<Object>} Invite code and link
 */
export async function getInviteCode(id) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    const code = await chat.getInviteCode();
    
    return {
      code,
      link: `https://chat.whatsapp.com/${code}`,
    };
  } catch (error) {
    logger.error({ error, groupId }, "Failed to get invite code");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to get invite code",
      true
    );
  }
}

/**
 * Revoke group invite code
 * @param {string} id - Group ID
 * @returns {Promise<Object>} New invite code and link
 */
export async function revokeInvite(id) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    const newCode = await chat.revokeInvite();
    
    logger.info({ groupId }, "Group invite revoked");
    return {
      code: newCode,
      link: `https://chat.whatsapp.com/${newCode}`,
    };
  } catch (error) {
    logger.error({ error, groupId }, "Failed to revoke invite");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to revoke invite code",
      true
    );
  }
}

/**
 * Add participants to group
 * @param {string} id - Group ID
 * @param {Array<string>} participants - Participant IDs
 * @returns {Promise<Object>} Result
 */
export async function addParticipants(id, participants) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    const participantIds = participants.map(normalizeParticipantId);
    const result = await chat.addParticipants(participantIds);
    
    logger.info({ groupId, count: participantIds.length }, "Participants added");
    return result;
  } catch (error) {
    logger.error({ error, groupId }, "Failed to add participants");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to add participants",
      true
    );
  }
}

/**
 * Remove participants from group
 * @param {string} id - Group ID
 * @param {Array<string>} participants - Participant IDs
 */
export async function removeParticipants(id, participants) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    const participantIds = participants.map(normalizeParticipantId);
    await chat.removeParticipants(participantIds);
    
    logger.info({ groupId, count: participantIds.length }, "Participants removed");
  } catch (error) {
    logger.error({ error, groupId }, "Failed to remove participants");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to remove participants",
      true
    );
  }
}

/**
 * Promote participants to admin
 * @param {string} id - Group ID
 * @param {Array<string>} participants - Participant IDs
 */
export async function promoteParticipants(id, participants) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    const participantIds = participants.map(normalizeParticipantId);
    await chat.promoteParticipants(participantIds);
    
    logger.info({ groupId, count: participantIds.length }, "Participants promoted");
  } catch (error) {
    logger.error({ error, groupId }, "Failed to promote participants");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to promote participants",
      true
    );
  }
}

/**
 * Demote participants from admin
 * @param {string} id - Group ID
 * @param {Array<string>} participants - Participant IDs
 */
export async function demoteParticipants(id, participants) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    const participantIds = participants.map(normalizeParticipantId);
    await chat.demoteParticipants(participantIds);
    
    logger.info({ groupId, count: participantIds.length }, "Participants demoted");
  } catch (error) {
    logger.error({ error, groupId }, "Failed to demote participants");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to demote participants",
      true
    );
  }
}

/**
 * Leave group
 * @param {string} id - Group ID
 */
export async function leaveGroup(id) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    await chat.leave();
    logger.info({ groupId }, "Left group");
  } catch (error) {
    logger.error({ error, groupId }, "Failed to leave group");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to leave group",
      true
    );
  }
}

/**
 * Get membership requests
 * @param {string} id - Group ID
 * @returns {Promise<Array>} List of requests
 */
export async function getMembershipRequests(id) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    const requests = await chat.getGroupMembershipRequests();
    
    return requests.map((r) => ({
      id: r.id._serialized,
      timestamp: r.t,
    }));
  } catch (error) {
    logger.error({ error, groupId }, "Failed to get membership requests");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to get membership requests",
      true
    );
  }
}

/**
 * Approve membership requests
 * @param {string} id - Group ID
 * @param {Array<string>} requesters - Requester IDs (optional)
 * @returns {Promise<Object>} Result
 */
export async function approveMembershipRequests(id, requesters) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    const options = requesters ? { requesterIds: requesters } : {};
    const result = await chat.approveGroupMembershipRequests(options);
    
    logger.info({ groupId }, "Membership requests approved");
    return result;
  } catch (error) {
    logger.error({ error, groupId }, "Failed to approve requests");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to approve requests",
      true
    );
  }
}

/**
 * Reject membership requests
 * @param {string} id - Group ID
 * @param {Array<string>} requesters - Requester IDs (optional)
 * @returns {Promise<Object>} Result
 */
export async function rejectMembershipRequests(id, requesters) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    const options = requesters ? { requesterIds: requesters } : {};
    const result = await chat.rejectGroupMembershipRequests(options);
    
    logger.info({ groupId }, "Membership requests rejected");
    return result;
  } catch (error) {
    logger.error({ error, groupId }, "Failed to reject requests");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to reject requests",
      true
    );
  }
}

/**
 * Update group settings
 * @param {string} id - Group ID
 * @param {Object} settings - Settings to update
 */
export async function updateSettings(id, settings) {
  ensureClientReady();
  const groupId = normalizeGroupId(id);
  
  try {
    const chat = await client.getChatById(groupId);
    
    if (settings.messagesAdminsOnly !== undefined) {
      await chat.setMessagesAdminsOnly(settings.messagesAdminsOnly);
    }
    if (settings.infoAdminsOnly !== undefined) {
      await chat.setInfoAdminsOnly(settings.infoAdminsOnly);
    }
    if (settings.addMembersAdminsOnly !== undefined) {
      await chat.setAddMembersAdminsOnly(settings.addMembersAdminsOnly);
    }
    
    logger.info({ groupId }, "Group settings updated");
  } catch (error) {
    logger.error({ error, groupId }, "Failed to update settings");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to update group settings",
      true
    );
  }
}
