/**
 * [INPUT]: 依赖安装路径、SQLite 迁移和私有凭据初始化。
 * [OUTPUT]: 初始化 state 目录、VAPID 和持久产品状态。
 * [POS]: 安装后的幂等状态入口；API 与 worker 复用同一推送身份。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { chmodSync, mkdirSync } from "node:fs";
import { openCyberOsDb, openCyberOsDbReadOnly } from "@cyberos/db";
import { loadBrowserPushVapidKeys } from "@cyberos/shared/browser-push-node";
import { loadBootstrap } from "@cyberos/shared";
import { upgradeShareCredential, verifySettingsUpgrade } from "./lib/settings-upgrade.js";

const bootstrap = loadBootstrap();
if (process.argv[2] === "--settings-upgrade-check") {
  const db = openCyberOsDbReadOnly(bootstrap.paths.databasePath);
  try { console.log(verifySettingsUpgrade(db, bootstrap.paths)); } finally { db.close(); }
  process.exit(0);
}
mkdirSync(bootstrap.paths.stateDir, { recursive: true, mode: 0o750 });
mkdirSync(bootstrap.paths.secretsDir, { recursive: true, mode: 0o700 });
mkdirSync(bootstrap.paths.backupSecretsDir, { recursive: true, mode: 0o700 });
mkdirSync(bootstrap.paths.shareSecretsDir, { recursive: true, mode: 0o700 });
mkdirSync(bootstrap.paths.mcpStateDir, { recursive: true, mode: 0o700 });
mkdirSync(bootstrap.paths.tvStateDir, { recursive: true, mode: 0o750 });

loadBrowserPushVapidKeys(bootstrap.paths.secretsDir);
const db = openCyberOsDb(bootstrap.paths.databasePath);
try { upgradeShareCredential(db, bootstrap.paths); } finally { db.close(); }
chmodSync(bootstrap.paths.databasePath, 0o640);

console.log(JSON.stringify({
  event: "cyberos.state.initialized",
  databasePath: bootstrap.paths.databasePath
}));
