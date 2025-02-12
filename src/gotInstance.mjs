import got from "got";
import http from "http";
import https from "https";

export const gotInstance = got.extend({
  agent: {
    http: new http.Agent({ keepAlive: true }),
    https: new https.Agent({ keepAlive: true }),
  },
  timeout: {
    request: 5000,
  },
  responseType: "json",
});
