import xss from "xss";

const SANITIZED_MESSAGE_FIELDS = new Set([
  "body",
  "caption",
  "address",
  "filename"
]);

function sanitizeMessagePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const sanitized = { ...payload };

  if (sanitized.text?.body && typeof sanitized.text.body === "string") {
    sanitized.text = {
      ...sanitized.text,
      body: xss(sanitized.text.body)
    };
  }

  if (typeof sanitized.caption === "string") {
    sanitized.caption = xss(sanitized.caption);
  }

  if (sanitized.location?.address && typeof sanitized.location.address === "string") {
    sanitized.location = {
      ...sanitized.location,
      address: xss(sanitized.location.address)
    };
  }

  if (sanitized.media?.filename && typeof sanitized.media.filename === "string") {
    sanitized.media = {
      ...sanitized.media,
      filename: xss(sanitized.media.filename)
    };
  }

  return sanitized;
}

export default function sanitizeInput(request, _reply, done) {
  if (!request.body || typeof request.body !== "object") {
    done();
    return;
  }

  if (Array.isArray(request.body.messages)) {
    request.body = {
      ...request.body,
      messages: request.body.messages.map(sanitizeMessagePayload)
    };
  } else if ([...SANITIZED_MESSAGE_FIELDS, "text", "media", "location"].some((field) => field in request.body)) {
    request.body = sanitizeMessagePayload(request.body);
  }

  done();
}
