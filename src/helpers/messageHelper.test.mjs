import { test } from "node:test";
import assert from "node:assert/strict";
import wwebjs from "whatsapp-web.js";

const { buildMessageContent } = await import("./messageHelper.mjs");

test("location messages are upstream Location instances with address preserved", async () => {
  const { messageContent, sendOptions } = await buildMessageContent({
    type: "location",
    location: { latitude: -6.2, longitude: 106.8, address: "Jl. Merdeka 1" },
  });

  assert.ok(messageContent instanceof wwebjs.Location);
  assert.equal(messageContent.latitude, -6.2);
  assert.equal(messageContent.longitude, 106.8);
  assert.equal(messageContent.address, "Jl. Merdeka 1");
  assert.equal(messageContent.description, "Jl. Merdeka 1");
  assert.deepEqual(sendOptions, {});
  assert.equal(JSON.parse(JSON.stringify(messageContent)).address, "Jl. Merdeka 1");
});

test("location messages without address still yield a Location instance", async () => {
  const { messageContent } = await buildMessageContent({
    type: "location",
    location: { latitude: 0, longitude: 0 },
  });

  assert.ok(messageContent instanceof wwebjs.Location);
  assert.equal(messageContent.address, undefined);
  assert.equal(messageContent.description, "");
});
