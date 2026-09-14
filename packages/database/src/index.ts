export {
  Prisma,
  PrismaClient,
  type TaskScheduleBlock,
  type User,
  type Event,
  type Task,
  type Integration,
} from "./generated/prisma/client.js";
export { getPrismaClient } from "./client.js";
