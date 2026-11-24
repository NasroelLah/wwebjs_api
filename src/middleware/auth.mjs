import "dotenv/config";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";
import { timingSafeEqual } from "crypto";

function isValidApiKey(token) {
  const expected = process.env.API_KEY;
  if (!expected) return false;
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  return tokenBuf.length === expectedBuf.length && timingSafeEqual(tokenBuf, expectedBuf);
}

export function validateApiKey(request, _reply) {
  const authHeader = request.headers["authorization"];
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError(
      ErrorTypes.AUTHENTICATION_ERROR,
      HttpStatusCodes.UNAUTHORIZED,
      "Missing or invalid Authorization header",
      true
    );
  }

  const token = authHeader.split(" ")[1];
  if (!token || !isValidApiKey(token)) {
    throw new AppError(
      ErrorTypes.AUTHENTICATION_ERROR,
      HttpStatusCodes.UNAUTHORIZED,
      "Invalid API key",
      true
    );
  }

  return true;
}
