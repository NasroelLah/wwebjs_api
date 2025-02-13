import { DateTime } from "luxon";
import { addMessageToQueue } from "./queueHelper.mjs";
import logger from "../logger.mjs";

export function scheduleDispatch(chatId, content, options, schedule) {
  const appTimezone = process.env.APP_TIMEZONE || "UTC";
  const scheduledTime = DateTime.fromFormat(schedule, "yyyy-MM-dd H:mm:ss", {
    zone: appTimezone,
  });
  const now = DateTime.now().setZone(appTimezone);
  const delay = scheduledTime.toMillis() - now.toMillis();
  if (delay > 0) {
    logger.info(`Message scheduled in ${delay} ms`);
    addMessageToQueue(chatId, content, options, delay);
    return true;
  }
  logger.warn(`Scheduled time ${schedule} is in the past.`);
  return false;
}
