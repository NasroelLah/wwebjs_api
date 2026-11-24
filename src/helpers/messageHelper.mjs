import wwebjs from "whatsapp-web.js";
import { getMediaContent } from "./mediaHelper.mjs";

const { Location } = wwebjs;

export async function buildMessageContent({
  type,
  text,
  media,
  location,
  caption,
}) {
  let messageContent;
  const sendOptions = {};
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
    messageContent = new Location(location.latitude, location.longitude, {
      address: location.address,
    });
  } else {
    throw new Error("Unsupported message type.");
  }
  return { messageContent, sendOptions };
}
