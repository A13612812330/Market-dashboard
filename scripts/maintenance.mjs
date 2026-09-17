import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const databasePath = path.join(dataDir, "market.sqlite");
const backupDir = path.join(dataDir, "backups");
const logPath = path.join(dataDir, "maintenance.log");
const lockPath = path.join(dataDir, ".maintenance.lock");
const checkOnly = process.argv.includes("--check");

function shanghaiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
}

function writeLog(payload) {
  fs.appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`, "utf8");
}

function directorySize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(target) : fs.statSync(target).size;
  }
  return total;
}

function backupKind(name, isDirectory) {
  if (isDirectory && /^(weekly-db|strategy-db|health-governance)-/.test(name)) return "database";
  if (/^market-backup-.*\.json$/i.test(name)) return "market-export";
  if (/^paper-rebalance-.*\.json$/i.test(name)) return "paper-rebalance";
  if (isDirectory && /^(observation-maintenance|scheduler-cache|security-master)-/.test(name)) return "maintenance";
  return null;
}

function pruneOldBackups() {
  if (!fs.existsSync(backupDir)) return { removed: [], kept: [], skipped: [] };
  const limits = {
    database: { count: 2, days: 30 },
    "market-export": { count: 2, days: 30 },
    "paper-rebalance": { count: 14, days: 30 },
    maintenance: { count: 4, days: 7 }
  };
  const grouped = new Map();
  for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
    const kind = backupKind(entry.name, entry.isDirectory());
    if (!kind) continue;
    const target = path.join(backupDir, entry.name);
    const rows = grouped.get(kind) || [];
    rows.push({ name: entry.name, path: target, isDirectory: entry.isDirectory(), time: fs.statSync(target).mtimeMs });
    grouped.set(kind, rows);
  }
  const removed = [];
  const kept = [];
  const skipped = [];
  for (const [kind, entries] of grouped) {
    const rule = limits[kind];
    const cutoff = Date.now() - rule.days * 86400000;
    entries.sort((a, b) => b.time - a.time);
    entries.forEach((entry, index) => {
      const expired = index >= rule.count && entry.time < cutoff;
      if (!expired) {
        kept.push(entry.name);
        return;
      }
      if (checkOnly) {
        skipped.push(entry.name);
        return;
      }
      fs.rmSync(entry.path, { recursive: entry.isDirectory, force: true });
      removed.push(entry.name);
    });
  }
  return { removed, kept, skipped };
}

if (!fs.existsSync(databasePath)) throw new Error("未找到 market.sqlite，维护已跳过");
let lock;
const startedAt = Date.now();
try {
  lock = fs.openSync(lockPath, "wx");
  writeLog({ ok: true, phase: "started", checkOnly, message: checkOnly ? "维护检查开始" : "夜间维护开始" });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA busy_timeout=15000");
  const today = shanghaiDateKey();
  const snapshotCutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const newsCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const before = db.prepare("SELECT COUNT(*) AS count FROM paper_intraday_observations WHERE trade_date < ?").get(today).count;
  const staleSnapshots = db.prepare("SELECT COUNT(*) AS count FROM snapshots WHERE datetime(fetched_at) < datetime(?)").get(snapshotCutoff).count;
  const staleNewsBodies = db.prepare("SELECT COUNT(*) AS count FROM news_items WHERE datetime(created_at) < datetime(?) AND (summary <> '' OR content <> '')").get(newsCutoff).count;
  let deletedObservations = 0;
  let deletedSnapshots = 0;
  let clearedNewsBodies = 0;
  if (!checkOnly) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM paper_intraday_observations WHERE trade_date < ?").run(today);
      db.prepare("DELETE FROM snapshots WHERE datetime(fetched_at) < datetime(?)").run(snapshotCutoff);
      db.prepare("UPDATE news_items SET summary = '', content = '' WHERE datetime(created_at) < datetime(?)").run(newsCutoff);
      db.exec("COMMIT");
      deletedObservations = before;
      deletedSnapshots = staleSnapshots;
      clearedNewsBodies = staleNewsBodies;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  const checkpoint = checkOnly ? [] : db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
  const checkpointBusy = checkpoint.some((row) => Number(row.busy) > 0);
  const remaining = db.prepare("SELECT COUNT(*) AS count FROM paper_intraday_observations").get().count;
  db.close();
  const backups = pruneOldBackups();
  const result = { ok: !checkpointBusy, phase: checkpointBusy ? "checkpoint-pending-retry" : "completed", checkOnly, today, deletedObservations, staleObservations: before, deletedSnapshots, staleSnapshots, clearedNewsBodies, staleNewsBodies, remainingObservations: remaining, checkpoint, checkpointBusy, backups, dataBytes: directorySize(dataDir), durationMs: Date.now() - startedAt, message: checkpointBusy ? "数据库忙，WAL checkpoint 待下次维护重试" : (checkOnly ? "维护检查完成" : "维护完成") };
  writeLog(result);
  console.log(JSON.stringify(result));
} catch (error) {
  writeLog({ ok: false, phase: "failed", checkOnly, durationMs: Date.now() - startedAt, message: String(error.message || error) });
  console.error(String(error.stack || error));
  process.exitCode = 1;
} finally {
  if (lock !== undefined) fs.closeSync(lock);
  fs.rmSync(lockPath, { force: true });
}
