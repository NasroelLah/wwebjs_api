import { DateTime } from "luxon";
import { addMessageToQueue } from "./queueHelper.mjs";
import { appConfig } from "../config.mjs";
import logger from "../logger.mjs";

export function scheduleDispatch(chatId, content, options, schedule) {
  const appTimezone = appConfig.timezone;
  const scheduledTime = DateTime.fromFormat(schedule, "yyyy-MM-dd H:mm:ss", {
    zone: appTimezone,
  });
  const now = DateTime.now().setZone(appTimezone);
  const delay = scheduledTime.toMillis() - now.toMillis();
  if (delay > 0) {
    logger.info(`Message scheduled in ${delay} ms`);
    return addMessageToQueue(chatId, content, options, delay);
  }
  logger.warn(`Scheduled time ${schedule} is in the past.`);
  return false;
}
