import { DateTime } from "luxon";
import { appConfig } from "../config.mjs";

export function isValidScheduleFormat(schedule) {
  const appTimezone = appConfig.timezone;
  const scheduledTime = DateTime.fromFormat(schedule, "yyyy-MM-dd H:mm:ss", {
    zone: appTimezone,
  });
  return scheduledTime.isValid;
}
