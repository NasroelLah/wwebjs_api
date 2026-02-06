import "dotenv/config";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

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
  if (!token || token !== process.env.API_KEY) {
    throw new AppError(
      ErrorTypes.AUTHENTICATION_ERROR,
      HttpStatusCodes.UNAUTHORIZED,
      "Invalid API key",
      true
    );
  }

  return true;
}
