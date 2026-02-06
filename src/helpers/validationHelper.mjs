import { DateTime } from "luxon";

export function isValidScheduleFormat(schedule) {
  if (!schedule || typeof schedule !== "string") {
    return false;
  }
  const appTimezone = process.env.APP_TIMEZONE || "UTC";
  const scheduledTime = DateTime.fromFormat(schedule, "yyyy-MM-dd H:mm:ss", {
    zone: appTimezone,
  });
  return scheduledTime.isValid;
}
