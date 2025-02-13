import { MongoClient, ObjectId } from "mongodb";
import logger from "../logger.mjs";

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  auth: {
    username: process.env.MONGODB_USER,
    password: process.env.MONGODB_PASSWORD,
  },
});

async function connect() {
  if (!client.topology?.isConnected()) await client.connect();
  return client.db("wapi").collection("scheduledMessages");
}

export async function saveScheduledMessage(chatId, content, options, delay) {
  const collection = await connect();
  const scheduledTime = new Date(Date.now() + delay);
  const message = {
    chatId,
    content,
    options,
    scheduledTime,
    status: "scheduled",
  };
  const result = await collection.insertOne(message);
  logger.info(`Scheduled message saved to MongoDB for chatId ${chatId}`);
  return result.insertedId;
}

export async function getScheduledMessages() {
  const collection = await connect();
  return await collection.find({ status: "scheduled" }).toArray();
}

export async function updateMessageStatus(id, status) {
  const collection = await connect();
  const objectId = new ObjectId(String(id));
  await collection.updateOne({ _id: objectId }, { $set: { status } });
  logger.info(`Message status updated to ${status} for id ${id}`);
}
