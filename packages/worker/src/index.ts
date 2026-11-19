/**
 * [INPUT]: 依赖运行配置、作业队列和独立通知发送器。
 * [OUTPUT]: 启动作业、命令与通知轮询，关闭时等待资源释放。
 * [POS]: worker 进程入口；通知不占用 Agent 并发槽。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import { disposePiAgentHosts } from "@cyberos/agent";
import { cleanupNotifications, openCyberOsDb, recoverInterruptedAgentSessionCommands } from "@cyberos/db";
import { loadCyberOsRuntime } from "@cyberos/shared";
import { processNextNotification } from "./notifications.js";
import { AGENT_JOB_LEASE_MS, processNextAgentCommand, processNextJob } from "./processor.js";

const config = loadCyberOsRuntime();
const db = openCyberOsDb(config.paths.databasePath);
recoverInterruptedAgentSessionCommands(db);

let shuttingDown = false;
let activeTicks = 0;
let databaseClosed = false;
let activeJobTicks = 0;
let activeCommandTicks = 0;
let activeNotificationTick = false;
let lastNotificationCleanup = 0;
const notificationAbort = new AbortController();
let finalizing = false;
const workerId = `${os.hostname()}:${process.pid}:${randomUUID()}`;
const workerConcurrency = config.worker.concurrency ?? 2;

async function tick(): Promise<void> {
  if (shuttingDown || activeJobTicks >= workerConcurrency) {
    return;
  }

  activeJobTicks += 1;
  activeTicks += 1;
  try {
    await processNextJob({ db, config, workerId, leaseMs: AGENT_JOB_LEASE_MS });
  } catch (error) {
    console.error(error);
  } finally {
    activeTicks -= 1;
    activeJobTicks -= 1;
    closeDatabaseWhenIdle();
  }
}

async function commandTick(): Promise<void> {
  if (shuttingDown || activeCommandTicks >= workerConcurrency) return;
  activeCommandTicks += 1;
  activeTicks += 1;
  try {
    await processNextAgentCommand({ db, config, workerId });
  } catch (error) {
    console.error(error);
  } finally {
    activeTicks -= 1;
    activeCommandTicks -= 1;
    closeDatabaseWhenIdle();
  }
}

async function notificationTick(): Promise<void> {
  if (shuttingDown || activeNotificationTick) return;
  activeNotificationTick = true;
  activeTicks += 1;
  try {
    if (Date.now() - lastNotificationCleanup >= 3_600_000) {
      cleanupNotifications(db);
      lastNotificationCleanup = Date.now();
    }
    await processNextNotification({ db, config, workerId, signal: notificationAbort.signal });
  } catch {
    // 传输凭据不写日志；发送器将稳定错误码存入通知状态。
    console.error("Notification sender tick failed");
  } finally {
    activeTicks -= 1;
    activeNotificationTick = false;
    closeDatabaseWhenIdle();
  }
}

const notificationTimer = setInterval(() => { void notificationTick(); }, 500);
const timer = setInterval(() => {
  void tick();
}, config.worker.pollMs);
const commandTimer = setInterval(() => {
  void commandTick();
}, Math.min(config.worker.pollMs, 250));

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

void tick();
void commandTick();
void notificationTick();

function shutdown(): void {
  shuttingDown = true;
  clearInterval(timer);
  clearInterval(commandTimer);
  clearInterval(notificationTimer);
  notificationAbort.abort();
  closeDatabaseWhenIdle();
}

function closeDatabaseWhenIdle(): void {
  if (!shuttingDown || activeTicks !== 0 || databaseClosed || finalizing) return;
  finalizing = true;
  void disposePiAgentHosts().finally(() => {
    databaseClosed = true;
    db.close();
  });
}
