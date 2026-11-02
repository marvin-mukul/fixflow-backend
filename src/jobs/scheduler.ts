import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../lib/logger.js";

type Task = { name: string; run: () => Promise<unknown> };
const tasks: Task[] = [];
let running = false;

/** Services register idempotent tasks; they all run every minute. */
export function registerTask(name: string, run: () => Promise<unknown>) {
  tasks.push({ name, run });
}

export async function runAllTasks() {
  if (running) return; // never overlap runs
  running = true;
  try {
    for (const t of tasks) {
      try {
        const result = await t.run();
        if (result) logger.info({ task: t.name, result }, "scheduler task ran");
      } catch (err) {
        logger.error({ err, task: t.name }, "scheduler task failed");
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduler(): ScheduledTask {
  return cron.schedule("* * * * *", () => void runAllTasks());
}
