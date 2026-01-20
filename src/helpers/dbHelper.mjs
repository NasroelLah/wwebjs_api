/* global process */
import { MongoClient, ObjectId } from "mongodb";
import logger from "../logger.mjs";
import { dbConfig } from "../config.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

class DatabaseManager {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
  }

  async connect() {
    // Forward-compatible connection check
    if (this.isConnected && this.client) {
      try {
        // Verify connection is still alive
        await this.client.db("admin").command({ ping: 1 });
        return this.db;
      } catch {
        logger.warn('Connection lost, reconnecting...');
        this.isConnected = false;
      }
    }

    try {
      const options = {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        retryWrites: true,
        retryReads: true,
      };

      if (dbConfig.mongodb.user && dbConfig.mongodb.password) {
        options.auth = {
          username: dbConfig.mongodb.user,
          password: dbConfig.mongodb.password,
        };
      }

      this.client = new MongoClient(dbConfig.mongodb.uri, options);
      await this.client.connect();
      
      this.db = this.client.db(dbConfig.mongodb.database);
      this.isConnected = true;
      
      logger.info('Connected to MongoDB successfully');
      return this.db;
    } catch (error) {
      logger.error({ error }, 'Failed to connect to MongoDB');
      throw new AppError(
        ErrorTypes.DATABASE_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        'Database connection failed',
        true
      );
    }
  }

  async getCollection(collectionName) {
    const db = await this.connect();
    return db.collection(collectionName);
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      logger.info('MongoDB connection closed');
    }
  }

  async healthCheck() {
    try {
      if (!this.client || !this.isConnected) {
        await this.connect();
      }
      await this.client.db("admin").command({ ping: 1 });
      return true;
    } catch (error) {
      logger.error({ error }, 'MongoDB health check failed');
      return false;
    }
  }
}

// Singleton instance
const dbManager = new DatabaseManager();

export async function saveScheduledMessage(chatId, content, options, delay) {
  try {
    const collection = await dbManager.getCollection("scheduledMessages");
    const scheduledTime = new Date(Date.now() + delay);
    
    const message = {
      chatId,
      content,
      options,
      scheduledTime,
      status: "scheduled",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    const result = await collection.insertOne(message);
    logger.info(`Scheduled message saved to MongoDB for chatId ${chatId}`);
    return result.insertedId;
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to save scheduled message');
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to save scheduled message',
      true
    );
  }
}

export async function getScheduledMessages() {
  try {
    const collection = await dbManager.getCollection("scheduledMessages");
    return await collection.find({ status: "scheduled" }).toArray();
  } catch (error) {
    logger.error({ error }, 'Failed to get scheduled messages');
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to retrieve scheduled messages',
      true
    );
  }
}

export async function updateMessageStatus(id, status) {
  try {
    const collection = await dbManager.getCollection("scheduledMessages");
    const objectId = new ObjectId(String(id));
    
    const result = await collection.updateOne(
      { _id: objectId },
      { 
        $set: { 
          status, 
          updatedAt: new Date() 
        } 
      }
    );
    
    if (result.matchedCount === 0) {
      throw new AppError(
        ErrorTypes.DATABASE_ERROR,
        HttpStatusCodes.NOT_FOUND,
        `Message with id ${id} not found`,
        true
      );
    }
    
    logger.info(`Message status updated to ${status} for id ${id}`);
  } catch (error) {
    if (error instanceof AppError) throw error;
    
    logger.error({ error, id, status }, 'Failed to update message status');
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to update message status',
      true
    );
  }
}

// Graceful shutdown handler
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, closing database connection...');
  await dbManager.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, closing database connection...');
  await dbManager.close();
  process.exit(0);
});

export { dbManager };
