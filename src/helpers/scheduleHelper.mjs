import { DateTime } from "luxon";
import { sendMessageWithRetry } from "./sendHelper.mjs";
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
    setTimeout(async () => {
      try {
        await sendMessageWithRetry(chatId, content, options);
        logger.info(`Scheduled message sent to ${chatId}`);
      } catch (error) {
        logger.error(`Scheduled send failed: ${error.message}`);
      }
    }, delay);
    return true;
  }
  return false;
}
