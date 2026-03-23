
import Redis from "ioredis";
import dotenv from "dotenv";
 
dotenv.config();
 
export const redisConnection = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
});
 
redisConnection.on("connect", () => console.log("Redis connected"));
redisConnection.on("error", (err) => console.error("Redis error:", err.message));