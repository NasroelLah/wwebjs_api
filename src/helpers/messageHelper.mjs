import { getMediaContent } from "./mediaHelper.mjs";

export async function buildMessageContent({
  type,
  text,
  media,
  location,
  caption,
}) {
  let messageContent,
    sendOptions = {};
  if (type === "text") {
    if (!text?.body) throw new Error("Text body is required for text message.");
    messageContent = text.body;
  } else if (["image", "document", "video", "audio"].includes(type)) {
    const mediaContent = await getMediaContent(media);
    messageContent = mediaContent;
    if (caption) sendOptions.caption = caption;
    if (type === "document") sendOptions.sendMediaAsDocument = true;
  } else if (type === "location") {
    if (location?.latitude === undefined || location?.longitude === undefined) {
      throw new Error("Location data is required for location message.");
    }
    messageContent = {
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        ...(location.address && { description: location.address }),
      },
    };
  } else {
    throw new Error("Unsupported message type.");
  }
  return { messageContent, sendOptions };
}
