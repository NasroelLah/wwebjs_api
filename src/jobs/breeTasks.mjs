/* eslint-disable import/no-unresolved */
import Bree from "bree";
import path from "path";

const bree = new Bree({
  root: path.resolve("src", "jobs"),
  jobs: [
    {
      name: "processScheduledMessages.mjs",
      interval: "1m", // Alternatively, you can use a cron expression: "*/1 * * * *"
      concurrent: true,
    },
  ],
  extensions: ["mjs"],
});

export default bree;
