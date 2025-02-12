import pkg from "whatsapp-web.js";
const { MessageMedia } = pkg;

export async function getMediaContent(media) {
  if (media.url) {
    return await MessageMedia.fromUrl(media.url);
  } else if (media.base64) {
    if (!media.mimeType)
      throw new Error("mimeType is required when sending media via base64.");
    return new MessageMedia(media.mimeType, media.base64, media.filename || "");
  }
  throw new Error("Media url or base64 is required.");
}
