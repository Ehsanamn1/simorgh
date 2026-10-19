import { env, loadWorker, closeDatabaseClients } from './bootstrap.mjs';

const worker = await loadWorker();
const cron = process.env.MEDAR_CRON_EXPR || '*/5 * * * *';
const tasks = [];
worker.scheduled(
  { scheduledTime: Date.now(), cron },
  env,
  { waitUntil: (promise) => tasks.push(Promise.resolve(promise)) },
);

try {
  await Promise.all(tasks);
  console.log(`Medar scheduled job completed (${cron})`);
} catch (error) {
  console.error('[medar:cron] scheduled job failed', error);
  process.exitCode = 1;
} finally {
  await closeDatabaseClients();
}
