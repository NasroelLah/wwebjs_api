/* global process */
import dotenv from "dotenv";
dotenv.config();

export const API_KEY = process.env.API_KEY;
export const HOST_PORT = process.env.HOST_PORT || 3000;
export const WEBHOOK_URL = process.env.WEBHOOK_URL;
export const ENABLE_LOGGER = process.env.ENABLE_LOGGER === "true";

export const RATE_LIMIT = process.env.RATE_LIMIT
  ? parseInt(process.env.RATE_LIMIT, 10)
  : 100;
export const RATE_LIMIT_EXPIRE = process.env.RATE_LIMIT_EXPIRE
  ? parseInt(process.env.RATE_LIMIT_EXPIRE, 10)
  : 60;
