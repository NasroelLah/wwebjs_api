import wwebjs from "whatsapp-web.js";

const { Location, MessageMedia } = wwebjs;
const format = "nas-wapi-scheduled-v1";

// Envelope distinguishes text from structured content without changing the SQLite schema.
export function serializeScheduledContent(content) {
  if (content instanceof MessageMedia) {
    return JSON.stringify({ format, type: "media", value: {
      mimetype: content.mimetype,
      data: content.data,
      filename: content.filename,
      filesize: content.filesize,
    } });
  }
  if (content instanceof Location) {
    return JSON.stringify({ format, type: "location", value: {
      latitude: content.latitude,
      longitude: content.longitude,
      name: content.name,
      address: content.address,
      url: content.url,
    } });
  }
  if (typeof content === "string") {
    return JSON.stringify({ format, type: "text", value: content });
  }
  throw new TypeError("Unsupported scheduled message content");
}

export function deserializeScheduledContent(content) {
  let parsed;
  try { parsed = JSON.parse(content); } catch { return content; }
  if (!parsed || typeof parsed !== "object") return content;
  if (parsed.format === format) {
    if (parsed.type === "text" && typeof parsed.value === "string") return parsed.value;
    if (parsed.type === "media" && parsed.value) {
      const { mimetype, data, filename, filesize } = parsed.value;
      return new MessageMedia(mimetype, data, filename, filesize);
    }
    if (parsed.type === "location" && parsed.value) {
      const { latitude, longitude, ...options } = parsed.value;
      return new Location(latitude, longitude, options);
    }
    throw new TypeError("Invalid scheduled message content");
  }
  // Existing rows stored objects as JSON and plain text without an envelope.
  if (parsed.mimetype && parsed.data) {
    return new MessageMedia(parsed.mimetype, parsed.data, parsed.filename, parsed.filesize);
  }
  if (parsed.location && typeof parsed.location.latitude === "number" && typeof parsed.location.longitude === "number") {
    const { latitude, longitude, description, ...options } = parsed.location;
    return new Location(latitude, longitude, { ...options, address: options.address ?? description });
  }
  return content;
}
