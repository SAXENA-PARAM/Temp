import { Queue } from "bullmq";
import { redisConnection } from "../db/redis.js";
 
export const wqiQueue = new Queue("wqi-calculation", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,         // 5s, 25s, 125s between retries
    },
    removeOnComplete: true,  // clean up completed jobs from Redis
    removeOnFail: false,     // keep failed jobs for inspection
  },
});
 
wqiQueue.on("error", (err) => {
  console.error("WQI queue error:", err.message);
});