import "dotenv/config";
import { API_KEY } from "../config.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

export function validateApiKey(request, reply) {
  // Pastikan reply object ada
  if (!reply) {
    throw new AppError(
      ErrorTypes.AUTHENTICATION_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Reply object not provided to validateApiKey",
      false
    );
  }

  const authHeader = request.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError(
      ErrorTypes.AUTHENTICATION_ERROR,
      HttpStatusCodes.UNAUTHORIZED,
      "Missing or invalid Authorization header",
      true
    );
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token !== API_KEY) {
    throw new AppError(
      ErrorTypes.AUTHENTICATION_ERROR,
      HttpStatusCodes.UNAUTHORIZED,
      "Invalid API key",
      true
    );
  }

  return true;
}
