import "dotenv/config";

export function validateApiKey(request, reply) {
  const authHeader = request.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.status(401).send({
      status: "error",
      message: "Missing or invalid Authorization header.",
    });
    return false;
  }

  const token = authHeader.split(" ")[1];
  if (!token || token !== process.env.API_KEY) {
    reply.status(401).send({
      status: "error",
      message: "Invalid API key.",
    });
    return false;
  }

  return true;
}
