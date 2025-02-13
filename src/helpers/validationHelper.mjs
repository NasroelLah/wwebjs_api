import { DateTime } from "luxon";

export function isValidScheduleFormat(schedule) {
  const appTimezone = process.env.APP_TIMEZONE || "UTC";
  const scheduledTime = DateTime.fromFormat(schedule, "yyyy-MM-dd H:mm:ss", {
    zone: appTimezone,
  });
  return scheduledTime.isValid;
}
