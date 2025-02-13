import xss from "xss";

function sanitizeValue(value) {
  if (typeof value === "string") {
    return xss(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    return sanitizeObject(value);
  }
  return value;
}

function sanitizeObject(obj) {
  const sanitized = {};
  Object.keys(obj).forEach((key) => {
    sanitized[key] = sanitizeValue(obj[key]);
  });
  return sanitized;
}

export default function sanitizeInput(request, reply, done) {
  if (request.body && typeof request.body === "object") {
    request.body = sanitizeObject(request.body);
  }
  done();
}
