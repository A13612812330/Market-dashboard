import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mockPayloads } from "./mock-data.mjs";

function shanghaiDateKey(value = new Date()) {
  const text = typeof value === "string" ? value : "";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : value;
  const date = value instanceof Date ? value : new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function openStore(rootDir) {
  const dataDir = path.join(rootDir, "data");
  const assetsDir = path.join(dataDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "market.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_type_time ON snapshots(type, fetched_at DESC);
    CREATE TABLE IF NOT EXISTS screener_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      logic TEXT NOT NULL,
      conditions_json TEXT NOT NULL,
      sort_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS wechat_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      markdown TEXT NOT NULL,
      html TEXT NOT NULL,
      review_json TEXT NOT NULL,
      asset_ids_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      source TEXT NOT NULL,
      local_path TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      usable_for_wechat INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS data_status (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS securities (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      security_type TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_securities_name ON securities(name);
    CREATE INDEX IF NOT EXISTS idx_securities_market_type ON securities(market, security_type);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE TABLE IF NOT EXISTS watchlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_token TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      market TEXT NOT NULL DEFAULT 'A股',
      source TEXT NOT NULL DEFAULT '行情模块',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_token, code) ON CONFLICT REPLACE
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_owner_time ON watchlist_items(owner_token, updated_at DESC);
    CREATE TABLE IF NOT EXISTS watchlist_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_token TEXT NOT NULL,
      group_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_token, group_name) ON CONFLICT IGNORE
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_groups_owner ON watchlist_groups(owner_token, group_name);
    CREATE TABLE IF NOT EXISTS market_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL NOT NULL,
      volume REAL,
      amount REAL,
      change_pct REAL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      UNIQUE(item_type, code, trade_date) ON CONFLICT REPLACE
    );
    CREATE INDEX IF NOT EXISTS idx_market_history_lookup ON market_history(item_type, code, trade_date DESC);
    CREATE TABLE IF NOT EXISTS sector_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sector TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      rank_no INTEGER,
      change_pct REAL,
      amount REAL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(sector, code) ON CONFLICT REPLACE
    );
    CREATE INDEX IF NOT EXISTS idx_sector_members_sector ON sector_members(sector);
    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '市场资讯',
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '中国',
      market TEXT NOT NULL DEFAULT 'A股',
      event_tags TEXT NOT NULL DEFAULT '[]',
      importance TEXT NOT NULL DEFAULT '普通',
      material_status TEXT NOT NULL DEFAULT '待整理',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(url) ON CONFLICT IGNORE
    );
    CREATE INDEX IF NOT EXISTS idx_news_items_time ON news_items(created_at DESC);
    CREATE TABLE IF NOT EXISTS forecast_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      horizon TEXT NOT NULL,
      forecast_json TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_forecast_records_code_time ON forecast_records(code, created_at DESC);
    CREATE TABLE IF NOT EXISTS paper_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'Komo模拟账户',
      owner_token TEXT NOT NULL DEFAULT 'local',
      initial_cash REAL NOT NULL,
      cash REAL NOT NULL,
      realized_pnl REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS paper_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      market TEXT NOT NULL DEFAULT 'A股',
      quantity INTEGER NOT NULL,
      avg_cost REAL NOT NULL,
      last_price REAL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, code)
    );
    CREATE TABLE IF NOT EXISTS paper_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      side TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      strategy TEXT NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_paper_orders_account_time ON paper_orders(account_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS paper_equity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      cash REAL NOT NULL,
      market_value REAL NOT NULL,
      equity REAL NOT NULL,
      realized_pnl REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      drawdown REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_paper_equity_account_time ON paper_equity(account_id, created_at ASC);
    CREATE TABLE IF NOT EXISTS paper_intraday_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      market TEXT NOT NULL DEFAULT 'A股',
      trade_date TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      price REAL,
      change_pct REAL,
      amount REAL,
      volume_ratio REAL,
      turnover_rate REAL,
      source TEXT NOT NULL DEFAULT '实时行情',
      UNIQUE(account_id, code, observed_at) ON CONFLICT REPLACE
    );
    CREATE INDEX IF NOT EXISTS idx_paper_intraday_lookup ON paper_intraday_observations(account_id, code, trade_date, observed_at ASC);
  `);
  ensureColumn(db, "paper_accounts", "owner_token", "TEXT NOT NULL DEFAULT 'local'");
  ensureColumn(db, "news_items", "region", "TEXT NOT NULL DEFAULT '中国'");
  ensureColumn(db, "news_items", "market", "TEXT NOT NULL DEFAULT 'A股'");
  ensureColumn(db, "news_items", "event_tags", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "news_items", "importance", "TEXT NOT NULL DEFAULT '普通'");
  ensureColumn(db, "news_items", "material_status", "TEXT NOT NULL DEFAULT '待整理'");
  ensureColumn(db, "paper_positions", "high_price", "REAL");
  ensureColumn(db, "paper_positions", "entry_at", "TEXT");
  ensureColumn(db, "watchlist_items", "group_name", "TEXT NOT NULL DEFAULT '默认组'");

  return {
    db,
    dataDir,
    assetsDir,
    ensureAdminUser(username, password) {
      const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
      if (existing) {
        if (existing.role !== "admin" || !existing.active) db.prepare("UPDATE users SET role = 'admin', active = 1 WHERE id = ?").run(existing.id);
        db.prepare("UPDATE paper_accounts SET owner_token = ? WHERE owner_token = 'local'").run(`user:${existing.id}`);
        return db.prepare("SELECT id, username, role, active, created_at FROM users WHERE id = ?").get(existing.id);
      }
      const salt = randomBytes(16).toString("hex");
      const hash = scryptSync(String(password), salt, 64).toString("hex");
      const result = db.prepare("INSERT INTO users(username, password_hash, password_salt, role, active) VALUES (?, ?, ?, 'admin', 1)").run(username, hash, salt);
      db.prepare("UPDATE paper_accounts SET owner_token = ? WHERE owner_token = 'local'").run(`user:${result.lastInsertRowid}`);
      return db.prepare("SELECT id, username, role, active, created_at FROM users WHERE id = ?").get(result.lastInsertRowid);
    },
    authenticateUser(username, password) {
      const user = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(String(username || "").trim());
      if (!user) return null;
      const expected = Buffer.from(user.password_hash, "hex");
      const actual = scryptSync(String(password || ""), user.password_salt, expected.length);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      return { id: user.id, username: user.username, role: user.role, active: Boolean(user.active), created_at: user.created_at };
    },
    createSession(userId, ttlDays = 14) {
      const token = randomBytes(32).toString("hex");
      const hash = createHash("sha256").update(token).digest("hex");
      const expires = new Date(Date.now() + ttlDays * 86400000).toISOString();
      db.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(hash, Number(userId), expires);
      return token;
    },
    getSessionUser(token) {
      if (!token) return null;
      const hash = createHash("sha256").update(String(token)).digest("hex");
      const row = db.prepare("SELECT u.id, u.username, u.role, u.active, u.created_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").get(hash);
      if (!row || !row.active || new Date(row.expires_at).getTime() <= Date.now()) return null;
      return { id: row.id, username: row.username, role: row.role, active: Boolean(row.active), created_at: row.created_at };
    },
    deleteSession(token) {
      if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(createHash("sha256").update(String(token)).digest("hex"));
    },
    listUsers() {
      return db.prepare("SELECT id, username, role, active, created_at FROM users ORDER BY id ASC").all().map((user) => ({ ...user, active: Boolean(user.active) }));
    },
    createUser(username, password, role = "member") {
      const name = String(username || "").trim();
      if (!/^[A-Za-z0-9_\u4e00-\u9fff-]{2,32}$/.test(name)) throw new Error("用户名需为 2-32 位字母、数字、下划线或中文");
      if (String(password || "").length < 6) throw new Error("密码至少 6 位");
      const salt = randomBytes(16).toString("hex");
      const hash = scryptSync(String(password), salt, 64).toString("hex");
      const result = db.prepare("INSERT INTO users(username, password_hash, password_salt, role, active) VALUES (?, ?, ?, ?, 1)").run(name, hash, salt, role === "admin" ? "admin" : "member");
      return db.prepare("SELECT id, username, role, active, created_at FROM users WHERE id = ?").get(result.lastInsertRowid);
    },
    setUserActive(userId, active) {
      db.prepare("UPDATE users SET active = ? WHERE id = ? AND role != 'admin'").run(active ? 1 : 0, Number(userId));
      return db.prepare("SELECT id, username, role, active, created_at FROM users WHERE id = ?").get(Number(userId));
    },
    updateUser(userId, { username, password, active } = {}) {
      const id = Number(userId);
      const current = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      if (!current) throw new Error("成员不存在");
      if (current.role === "admin") throw new Error("管理员账号不能通过成员管理修改");
      const name = String(username ?? current.username).trim();
      if (!/^[A-Za-z0-9_\u4e00-\u9fff-]{2,32}$/.test(name)) throw new Error("用户名需为 2-32 位字母、数字、下划线或中文");
      const duplicate = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(name, id);
      if (duplicate) throw new Error("用户名已存在");
      if (password !== undefined && String(password) !== "") {
        if (String(password).length < 6) throw new Error("密码至少 6 位");
        const salt = randomBytes(16).toString("hex");
        const hash = scryptSync(String(password), salt, 64).toString("hex");
        db.prepare("UPDATE users SET username = ?, password_hash = ?, password_salt = ?, active = ? WHERE id = ?").run(name, hash, salt, active === undefined ? (current.active ? 1 : 0) : (active ? 1 : 0), id);
      } else {
        db.prepare("UPDATE users SET username = ?, active = ? WHERE id = ?").run(name, active === undefined ? (current.active ? 1 : 0) : (active ? 1 : 0), id);
      }
      return db.prepare("SELECT id, username, role, active, created_at FROM users WHERE id = ?").get(id);
    },
    resetUserPassword(userId, password = "123456") {
      const id = Number(userId);
      const current = db.prepare("SELECT id, username, role, active, created_at FROM users WHERE id = ?").get(id);
      if (!current) throw new Error("成员不存在");
      if (current.role === "admin") throw new Error("管理员账号不能通过成员管理重置密码");
      if (String(password).length < 6) throw new Error("密码至少 6 位");
      const salt = randomBytes(16).toString("hex");
      const hash = scryptSync(String(password), salt, 64).toString("hex");
      db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").run(hash, salt, id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      return db.prepare("SELECT id, username, role, active, created_at FROM users WHERE id = ?").get(id);
    },
    deleteUser(userId) {
      const id = Number(userId);
      const user = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(id);
      if (!user) throw new Error("成员不存在");
      if (user.role === "admin") throw new Error("管理员账号不能删除");
      const ownerToken = `user:${id}`;
      const accounts = db.prepare("SELECT id FROM paper_accounts WHERE owner_token = ?").all(ownerToken).map((row) => Number(row.id));
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
        for (const accountId of accounts) {
          db.prepare("DELETE FROM paper_positions WHERE account_id = ?").run(accountId);
          db.prepare("DELETE FROM paper_orders WHERE account_id = ?").run(accountId);
          db.prepare("DELETE FROM paper_equity WHERE account_id = ?").run(accountId);
        }
        db.prepare("DELETE FROM paper_accounts WHERE owner_token = ?").run(ownerToken);
        db.prepare("DELETE FROM users WHERE id = ?").run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { ...user, accountIds: accounts };
    },
    listAllPaperAccounts() {
      return db.prepare("SELECT * FROM paper_accounts ORDER BY created_at ASC, id ASC").all();
    },
    ensureSeed() {
      for (const [type, payload] of Object.entries(mockPayloads)) {
        const row = db.prepare("SELECT id FROM snapshots WHERE type = ? LIMIT 1").get(type);
        if (!row) {
          saveSnapshot(db, type, payload, "模拟数据", "fallback", new Date().toISOString());
        }
      }
      const status = db.prepare("SELECT key FROM data_status WHERE key = 'sources'").get();
      if (!status) {
        setStatus(db, "sources", {
          akshare: { ok: false, message: "尚未刷新" },
          baostock: { ok: false, message: "尚未刷新" },
          yfinance: { ok: false, message: "尚未刷新" }
        });
      }
    },
    getSnapshot(type, responseKey) {
      const row = db.prepare("SELECT * FROM snapshots WHERE type = ? ORDER BY fetched_at DESC, id DESC LIMIT 1").get(type);
      if (!row) {
        return {
          updatedAt: new Date().toISOString(),
          source: "暂无数据",
          status: "empty",
          [responseKey]: []
        };
      }
      return {
        updatedAt: row.fetched_at,
        source: row.source,
        status: row.status,
        [responseKey]: JSON.parse(row.payload)
      };
    },
    getMarketTrendSeries(limit = 160) {
      const dedicated = this.getSnapshot("trends", "series");
      const allRows = db.prepare("SELECT payload, source, fetched_at FROM snapshots WHERE type = 'markets' AND status = 'ok' ORDER BY fetched_at DESC, id DESC LIMIT ?").all(limit);
      const latestDate = localDateKey(allRows[0]?.fetched_at);
      const rows = allRows.filter((row) => localDateKey(row.fetched_at) === latestDate);
      const byCode = new Map();
      let latestAt = null;
      let latestSource = "";
      for (const row of rows.reverse()) {
        latestAt = row.fetched_at;
        latestSource = row.source || latestSource;
        let markets = [];
        try {
          markets = JSON.parse(row.payload);
        } catch {
          markets = [];
        }
        for (const market of markets || []) {
          for (const index of market.indexes || []) {
            if (!index?.code || !Number.isFinite(Number(index.value))) continue;
            if (!byCode.has(index.code)) {
              byCode.set(index.code, {
                name: index.name || index.code,
                code: index.code,
                region: market.region || "",
                source_name: index.source_name || row.source || "行情记录",
                pointMap: new Map()
              });
            }
            const series = byCode.get(index.code);
            series.name = index.name || series.name;
            series.region = market.region || series.region;
            series.source_name = index.source_name || series.source_name;
            const marketTime = index.updated_at || index.update_time || row.fetched_at;
            const timeKey = formatPointTime(marketTime);
            // Same-minute refreshes are repeated snapshots, not separate trend points.
            // Keep the latest observation for each market minute.
            series.pointMap.set(timeKey, {
              time: timeKey,
              value: Number(index.value),
              fetched_at: row.fetched_at,
              market_time: marketTime,
              change_pct: Number(index.change_pct || 0)
            });
          }
        }
      }
      const series = [...byCode.values()]
        .map((item) => ({
          name: item.name,
          code: item.code,
          region: item.region,
          source_name: item.source_name,
          points: [...item.pointMap.values()]
            .sort((a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime())
            .slice(-60)
        }))
        .filter((item) => item.points.length);
      const dedicatedUpdated = dedicated.updatedAt ? new Date(dedicated.updatedAt).getTime() : 0;
      const marketUpdated = latestAt ? new Date(latestAt).getTime() : 0;
      if (dedicated.status === "ok" && Array.isArray(dedicated.series) && dedicated.series.length && dedicatedUpdated >= marketUpdated) {
        return {
          updatedAt: dedicated.updatedAt,
          source: `趋势 · ${dedicated.source || "真实趋势数据"}`,
          status: "ok",
          series: dedicated.series
        };
      }
      return {
        updatedAt: latestAt || new Date().toISOString(),
        source: latestSource ? `趋势 · ${latestSource}` : "暂无趋势数据",
        status: series.length ? "ok" : "empty",
        series
      };
    },
    saveSnapshot(type, payload, source = "真实数据", status = "ok", fetchedAt = new Date().toISOString()) {
      saveSnapshot(db, type, payload, source, status, fetchedAt);
    },
    upsertSecurities(rows = []) {
      const stmt = db.prepare(`
        INSERT INTO securities(code, name, market, security_type, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          name = excluded.name,
          market = excluded.market,
          security_type = excluded.security_type,
          source = excluded.source,
          updated_at = excluded.updated_at
      `);
      let count = 0;
      runInTransaction(db, (items) => {
        for (const row of items || []) {
          const code = String(row?.code || "").trim().toLowerCase();
          const name = String(row?.name || "").trim();
          if (!code || !name) continue;
          stmt.run(code, name, String(row.market || "A股"), String(row.security_type || "stock"), String(row.source || "证券目录"), String(row.updated_at || new Date().toISOString()));
          count += 1;
        }
      }, rows);
      return { count };
    },
    searchSecurities(query, limit = 30) {
      const text = String(query || "").trim().toLowerCase();
      if (!text) return [];
      const compact = text.replace(/[.\s_-]/g, "");
      const digits = text.replace(/\D/g, "");
      const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
      const rows = db.prepare(`
        SELECT code, name, market, security_type, source, updated_at
        FROM securities
        WHERE lower(code) LIKE ? OR lower(replace(code, '.', '')) LIKE ? OR lower(name) LIKE ?
        LIMIT ?
      `).all(`%${text}%`, `%${compact}%`, `%${text}%`, safeLimit * 3);
      const rank = (row) => {
        const code = String(row.code || "").toLowerCase();
        const codeCompact = code.replace(/[.\s_-]/g, "");
        const name = String(row.name || "").toLowerCase();
        if (code === text || codeCompact === compact || (digits && code.replace(/\D/g, "") === digits)) return 100;
        if (name === text) return 95;
        if (code.includes(text) || codeCompact.includes(compact)) return 80;
        return name.includes(text) ? 70 : 0;
      };
      return rows.map((row) => ({ ...row, rank: rank(row) })).filter((row) => row.rank > 0)
        .sort((a, b) => b.rank - a.rank || String(a.name).localeCompare(String(b.name), "zh-CN"))
        .slice(0, safeLimit);
    },
    getSecurityByQuery(query) {
      return this.searchSecurities(query, 1)[0] || null;
    },
    getSecurityMasterStatus() {
      return db.prepare("SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at FROM securities").get();
    },
    saveHistoryRows(rows = []) {
      const stmt = db.prepare(`
        INSERT INTO market_history(item_type, code, name, trade_date, open, high, low, close, volume, amount, change_pct, source, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      runInTransaction(db, (items) => {
        for (const row of items || []) {
          if (!row?.type || !row?.code || !row?.date || row.close === null || row.close === undefined) continue;
          stmt.run(
            row.type,
            row.code,
            row.name || row.code,
            row.date,
            nullableNumber(row.open),
            nullableNumber(row.high),
            nullableNumber(row.low),
            Number(row.close),
            nullableNumber(row.volume),
            nullableNumber(row.amount),
            nullableNumber(row.change_pct),
            row.source || "历史行情",
            row.fetched_at || new Date().toISOString()
          );
        }
      }, rows);
    },
    getHistory({ type, code, window = "month" }) {
      const limit = historyLimit(window);
      const rows = db.prepare(`
        SELECT * FROM market_history
        WHERE item_type = ? AND code = ?
        ORDER BY trade_date DESC
        LIMIT ?
      `).all(type, code, limit);
      const ordered = rows.reverse();
      return {
        updatedAt: ordered.at(-1)?.fetched_at || new Date().toISOString(),
        source: ordered.at(-1)?.source || "暂无历史数据",
        status: ordered.length ? "ok" : "empty",
        type,
        code,
        window,
        points: ordered.map((row) => ({
          time: row.trade_date,
          value: row.close,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          amount: row.amount,
          change_pct: row.change_pct
        }))
      };
    },
    countHistoryRows() {
      return Number(db.prepare("SELECT COUNT(*) AS count FROM market_history").get()?.count || 0);
    },
    saveSectorMembers(rows = []) {
      const stmt = db.prepare(`
        INSERT INTO sector_members(sector, code, name, rank_no, change_pct, amount, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      runInTransaction(db, (items) => {
        for (const row of items || []) {
          if (!row?.sector || !row?.code || !row?.name) continue;
          stmt.run(row.sector, row.code, row.name, row.rank_no ?? null, nullableNumber(row.change_pct), nullableNumber(row.amount), row.source || "板块成分", row.updated_at || new Date().toISOString());
        }
      }, rows);
    },
    listSectorMembers(sector) {
      return db.prepare("SELECT * FROM sector_members WHERE sector = ? ORDER BY rank_no IS NULL, rank_no ASC, change_pct DESC LIMIT 80").all(sector);
    },
    countSectorMembers() {
      return Number(db.prepare("SELECT COUNT(*) AS count FROM sector_members").get()?.count || 0);
    },
    listSectorFlow({ type = "industry", search = "", sort = "change_pct", limit = 120 } = {}) {
      const allowed = new Set(["change_pct", "net_inflow", "amount", "up_count", "heat_score"]);
      const order = allowed.has(sort) ? sort : "change_pct";
      const rows = this.getSnapshot("sectorFlows", "sectors").sectors || [];
      return rows.filter((row) => {
        const rowType = row.type || "industry";
        const text = `${row.name || ""} ${row.signal || ""} ${(row.leaders || []).join(" ")}`.toLowerCase();
        return rowType === type && (!search || text.includes(String(search).toLowerCase()));
      }).sort((a, b) => nullableSortValue(b[order]) - nullableSortValue(a[order])).slice(0, Math.max(1, Math.min(Number(limit) || 120, 500)));
    },
    saveNewsItems(rows = []) {
      const stmt = db.prepare(`
        INSERT INTO news_items(title, url, source, category, summary, content, published_at, region, market, event_tags, importance, material_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      runInTransaction(db, (items) => {
        for (const row of items || []) addNewsRow(stmt, row);
      }, rows);
    },
    addNewsItem(row) {
      const duplicate = findNewsDuplicate(db, row || {});
      if (duplicate) return { ...normalizeNews(duplicate), duplicate: true };
      const stmt = db.prepare(`
        INSERT INTO news_items(title, url, source, category, summary, content, published_at, region, market, event_tags, importance, material_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      addNewsRow(stmt, row || {});
      return { ...normalizeNews(db.prepare("SELECT * FROM news_items ORDER BY id DESC LIMIT 1").get()), duplicate: false };
    },
    addNewsItems(rows = []) {
      const inserted = [];
      let duplicates = 0;
      for (const row of rows) {
        const item = this.addNewsItem(row);
        if (item.duplicate) duplicates += 1;
        else inserted.push(item);
      }
      return { inserted, duplicates };
    },
    listNewsItems(limit = 30) {
      return db.prepare("SELECT * FROM news_items ORDER BY COALESCE(NULLIF(published_at, ''), created_at) DESC, id DESC LIMIT ?").all(limit).map(normalizeNews);
    },
    queryNews({ region = "", market = "", source = "", keyword = "", importance = "", materialStatus = "", limit = 100 } = {}) {
      const rows = this.listNewsItems(Math.min(Number(limit) || 100, 500));
      const match = (value, query) => !query || String(value || "").toLowerCase().includes(String(query).toLowerCase());
      return rows.filter((item) => match(item.region, region) && match(item.market, market) && match(item.source, source) && match(item.importance, importance) && match(item.material_status, materialStatus) && match(`${item.title} ${item.summary} ${item.content} ${(item.event_tags || []).join(" ")}`, keyword));
    },
    countNewsItems() {
      return Number(db.prepare("SELECT COUNT(*) AS count FROM news_items").get()?.count || 0);
    },
    setStatus(key, value) {
      setStatus(db, key, value);
    },
    getStatus(key) {
      const row = db.prepare("SELECT value_json FROM data_status WHERE key = ?").get(key);
      return row ? JSON.parse(row.value_json) : null;
    },
    listAssets() {
      return db.prepare("SELECT * FROM assets ORDER BY created_at DESC, id DESC").all().map(normalizeAsset);
    },
    addAsset(asset) {
      const stmt = db.prepare(`
        INSERT INTO assets(title, type, purpose, source, local_path, prompt, usable_for_wechat)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        asset.title || "未命名素材",
        asset.type || "正文图",
        asset.purpose || "公众号",
        asset.source || "本地",
        asset.local_path || "",
        asset.prompt || "",
        asset.usable_for_wechat === false ? 0 : 1
      );
      return normalizeAsset(db.prepare("SELECT * FROM assets WHERE id = ?").get(result.lastInsertRowid));
    },
    getPaperAccount(accountId = null, ownerToken = "local") {
      return accountId
        ? (ownerToken === null
          ? db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(Number(accountId)) || null
          : db.prepare("SELECT * FROM paper_accounts WHERE id = ? AND owner_token = ?").get(Number(accountId), ownerToken) || null)
        : db.prepare("SELECT * FROM paper_accounts WHERE owner_token = ? ORDER BY id ASC LIMIT 1").get(ownerToken) || null;
    },
    listPaperAccounts(ownerToken = "local") {
      return db.prepare("SELECT id, name, initial_cash, cash, realized_pnl, created_at, updated_at FROM paper_accounts WHERE owner_token = ? ORDER BY created_at ASC, id ASC").all(ownerToken);
    },
    listWatchlist(ownerToken = "local") {
      return db.prepare("SELECT id, code, name, market, source, group_name, created_at, updated_at FROM watchlist_items WHERE owner_token = ? ORDER BY group_name ASC, updated_at DESC, id DESC").all(ownerToken);
    },
    addWatchlistItem(item = {}, ownerToken = "local") {
      const code = String(item.code || "").trim();
      if (!code) throw new Error("自选标的代码不能为空");
      const name = String(item.name || code).trim().slice(0, 80);
      const market = String(item.market || "A股").trim().slice(0, 20);
      const source = String(item.source || "行情模块").trim().slice(0, 60);
      const groupName = normalizeWatchlistGroup(item.groupName || item.group_name || "默认组");
      db.prepare(`INSERT INTO watchlist_items(owner_token, code, name, market, source, group_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_token, code) DO UPDATE SET name = excluded.name, market = excluded.market, source = excluded.source, group_name = excluded.group_name, updated_at = excluded.updated_at`).run(ownerToken, code, name, market, source, groupName, new Date().toISOString());
      return db.prepare("SELECT id, code, name, market, source, group_name, created_at, updated_at FROM watchlist_items WHERE owner_token = ? AND code = ?").get(ownerToken, code);
    },
    removeWatchlistItem(code, ownerToken = "local") {
      const target = String(code || "").trim();
      db.prepare("DELETE FROM watchlist_items WHERE owner_token = ? AND code = ?").run(ownerToken, target);
      return { code: target };
    },
    listWatchlistGroups(ownerToken = "local") {
      db.prepare("INSERT OR IGNORE INTO watchlist_groups(owner_token, group_name) VALUES (?, '默认组')").run(ownerToken);
      const rows = db.prepare(`SELECT group_name FROM watchlist_groups WHERE owner_token = ? UNION SELECT group_name FROM watchlist_items WHERE owner_token = ? ORDER BY group_name COLLATE NOCASE ASC`).all(ownerToken, ownerToken);
      return rows.map((row) => row.group_name).filter(Boolean);
    },
    addWatchlistGroup(groupName, ownerToken = "local") {
      const nextGroup = normalizeWatchlistGroup(groupName);
      const result = db.prepare("INSERT OR IGNORE INTO watchlist_groups(owner_token, group_name, updated_at) VALUES (?, ?, ?)").run(ownerToken, nextGroup, new Date().toISOString());
      return { groupName: nextGroup, created: Number(result.changes) > 0 };
    },
    moveWatchlistItem(code, groupName, ownerToken = "local") {
      const target = String(code || "").trim();
      const nextGroup = normalizeWatchlistGroup(groupName);
      const result = db.prepare("UPDATE watchlist_items SET group_name = ?, updated_at = ? WHERE owner_token = ? AND code = ?").run(nextGroup, new Date().toISOString(), ownerToken, target);
      if (!result.changes) throw new Error("自选标的不存在");
      return db.prepare("SELECT id, code, name, market, source, group_name, created_at, updated_at FROM watchlist_items WHERE owner_token = ? AND code = ?").get(ownerToken, target);
    },
    renameWatchlistGroup(oldName, newName, ownerToken = "local") {
      const oldGroup = normalizeWatchlistGroup(oldName);
      const nextGroup = normalizeWatchlistGroup(newName);
      if (oldGroup === nextGroup) return { oldName: oldGroup, newName: nextGroup, changed: 0 };
      const exists = db.prepare("SELECT 1 AS found FROM watchlist_groups WHERE owner_token = ? AND group_name = ?").get(ownerToken, oldGroup) || db.prepare("SELECT 1 AS found FROM watchlist_items WHERE owner_token = ? AND group_name = ?").get(ownerToken, oldGroup);
      if (!exists) throw new Error("自选分组不存在");
      const observedAt = new Date();
      observedAt.setSeconds(0, 0);
      const now = observedAt.toISOString();
      db.prepare("INSERT OR IGNORE INTO watchlist_groups(owner_token, group_name, updated_at) VALUES (?, ?, ?)").run(ownerToken, nextGroup, now);
      const result = db.prepare("UPDATE watchlist_items SET group_name = ?, updated_at = ? WHERE owner_token = ? AND group_name = ?").run(nextGroup, now, ownerToken, oldGroup);
      db.prepare("DELETE FROM watchlist_groups WHERE owner_token = ? AND group_name = ?").run(ownerToken, oldGroup);
      return { oldName: oldGroup, newName: nextGroup, changed: Number(result.changes) };
    },
    updatePaperAccountName(accountId, name, ownerToken = "local") {
      const id = Number(accountId);
      const nextName = String(name || "").trim().slice(0, 32);
      if (!Number.isInteger(id) || id <= 0) throw new Error("账户编号无效");
      if (!nextName) throw new Error("账户名称不能为空");
      const account = this.getPaperAccount(id, ownerToken);
      if (!account) throw new Error("模拟账户不存在");
      db.prepare("UPDATE paper_accounts SET name = ?, updated_at = ? WHERE id = ? AND owner_token = ?")
        .run(nextName, new Date().toISOString(), id, ownerToken);
      return db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(id);
    },
    deletePaperAccount(accountId, ownerToken = "local") {
      const id = Number(accountId);
      if (!Number.isInteger(id) || id <= 0) throw new Error("账户编号无效");
      const account = this.getPaperAccount(id, ownerToken);
      if (!account) throw new Error("模拟账户不存在");
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM paper_positions WHERE account_id = ?").run(id);
        db.prepare("DELETE FROM paper_orders WHERE account_id = ?").run(id);
        db.prepare("DELETE FROM paper_equity WHERE account_id = ?").run(id);
        db.prepare("DELETE FROM paper_intraday_observations WHERE account_id = ?").run(id);
        db.prepare("DELETE FROM paper_accounts WHERE id = ?").run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return account;
    },
    createPaperAccount(initialCash, { reset = false, accountId = null, name = "Komo模拟账户", ownerToken = "local" } = {}) {
      const amount = Number(initialCash);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("初始资金必须大于 0");
      if (reset) {
        if (!accountId) throw new Error("重置模拟账户需要指定账户");
        const target = this.getPaperAccount(accountId, ownerToken);
        if (!target) throw new Error("模拟账户不存在");
        db.prepare("DELETE FROM paper_positions WHERE account_id = ?").run(Number(accountId));
        db.prepare("DELETE FROM paper_orders WHERE account_id = ?").run(Number(accountId));
        db.prepare("DELETE FROM paper_equity WHERE account_id = ?").run(Number(accountId));
        db.prepare("DELETE FROM paper_accounts WHERE id = ?").run(Number(accountId));
      }
      const result = db.prepare("INSERT INTO paper_accounts(name, owner_token, initial_cash, cash, realized_pnl, updated_at) VALUES (?, ?, ?, ?, 0, ?)").run(name, ownerToken, amount, amount, new Date().toISOString());
      return db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(result.lastInsertRowid);
    },
    listPaperPositions(accountId) {
      return db.prepare("SELECT * FROM paper_positions WHERE account_id = ? ORDER BY code").all(Number(accountId));
    },
    markPaperPosition(accountId, code, lastPrice, highPrice) {
      db.prepare("UPDATE paper_positions SET last_price = ?, high_price = ?, updated_at = ? WHERE account_id = ? AND code = ?")
        .run(Number(lastPrice), Number(highPrice), new Date().toISOString(), Number(accountId), code);
    },
    listPaperOrders(accountId, limit = 100) {
      return db.prepare("SELECT * FROM paper_orders WHERE account_id = ? ORDER BY id DESC LIMIT ?").all(Number(accountId), Math.min(Number(limit) || 100, 500));
    },
    getPaperSellableQuantity(accountId, code) {
      const position = db.prepare("SELECT quantity FROM paper_positions WHERE account_id = ? AND code = ?").get(Number(accountId), code);
      if (!position) return 0;
      const today = shanghaiDateKey();
      const orders = db.prepare("SELECT side, quantity, created_at FROM paper_orders WHERE account_id = ? AND code = ? ORDER BY id ASC").all(Number(accountId), code);
      const boughtToday = orders.filter((item) => item.side === "BUY" && shanghaiDateKey(item.created_at) === today).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const soldToday = orders.filter((item) => item.side === "SELL" && shanghaiDateKey(item.created_at) === today).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      return Math.max(0, Number(position.quantity) - Math.max(0, boughtToday - soldToday));
    },
    listPaperEquity(accountId, limit = 500) {
      const safeLimit = Math.min(Number(limit) || 500, 5000);
      return db.prepare("SELECT * FROM (SELECT * FROM paper_equity WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT ?) ORDER BY created_at ASC, id ASC").all(Number(accountId), safeLimit);
    },
    savePaperIntradayObservations(accountId, rows = []) {
      const stmt = db.prepare(`
        INSERT INTO paper_intraday_observations(account_id, code, name, market, trade_date, observed_at, price, change_pct, amount, volume_ratio, turnover_rate, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString();
      const tradeDate = shanghaiDateKey(now);
      db.exec("BEGIN");
      try {
        for (const row of rows || []) {
          if (!row?.code || !Number.isFinite(Number(row.price)) || Number(row.price) <= 0) continue;
          stmt.run(Number(accountId), String(row.code), String(row.name || row.code), String(row.market || "A股"), tradeDate, now, nullableNumber(row.price), nullableNumber(row.change_pct), nullableNumber(row.amount), nullableNumber(row.volume_ratio), nullableNumber(row.turnover_rate), String(row.source || row.source_name || "实时行情"));
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { saved: (rows || []).length, tradeDate, observedAt: now };
    },
    listPaperIntradayObservations(accountId, code = "", tradeDate = shanghaiDateKey(), limit = 1000) {
      const safeLimit = Math.min(Math.max(Number(limit) || 1000, 1), 20000);
      return code
        ? db.prepare("SELECT * FROM paper_intraday_observations WHERE account_id = ? AND code = ? AND trade_date = ? ORDER BY observed_at ASC, id ASC LIMIT ?").all(Number(accountId), String(code), tradeDate, safeLimit)
        : db.prepare("SELECT * FROM paper_intraday_observations WHERE account_id = ? AND trade_date = ? ORDER BY observed_at ASC, id ASC LIMIT ?").all(Number(accountId), tradeDate, safeLimit);
    },
    applyPaperTrade({ accountId, side, code, name, market = "A股", quantity, price, fee = 0, strategy, reason, source, skipT1 = false }) {
      const qty = Math.floor(Number(quantity));
      const px = Number(price);
      const charge = Number(fee) || 0;
      if (!accountId || !["BUY", "SELL"].includes(side) || !code || qty <= 0 || !Number.isFinite(px) || px <= 0) throw new Error("模拟订单参数无效");
      const account = db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(Number(accountId));
      if (!account) throw new Error("模拟账户不存在，请先设置初始资金");
      const position = db.prepare("SELECT * FROM paper_positions WHERE account_id = ? AND code = ?").get(Number(accountId), code);
      const amount = qty * px;
      let realized = 0;
      let nextCash = Number(account.cash);
      db.exec("BEGIN");
      try {
        if (side === "BUY") {
          if (nextCash < amount + charge) throw new Error("可用资金不足");
          nextCash -= amount + charge;
          if (position) {
            const nextQty = position.quantity + qty;
            const avgCost = ((position.quantity * position.avg_cost) + amount + charge) / nextQty;
            db.prepare("UPDATE paper_positions SET quantity = ?, avg_cost = ?, last_price = ?, high_price = ?, name = ?, updated_at = ? WHERE id = ?").run(nextQty, avgCost, px, Math.max(Number(position.high_price || position.last_price || px), px), name, new Date().toISOString(), position.id);
          } else {
            const entryAt = new Date().toISOString();
            db.prepare("INSERT INTO paper_positions(account_id, code, name, market, quantity, avg_cost, last_price, high_price, entry_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(accountId, code, name, market, qty, (amount + charge) / qty, px, px, entryAt, entryAt);
          }
        } else {
          if (!position || position.quantity < qty) throw new Error("持仓数量不足");
          if (!skipT1 && (market === "A股" || market === "ETF")) {
            const sellable = this.getPaperSellableQuantity(accountId, code);
            if (sellable < qty) throw new Error(`A股 T+1：今日买入的 ${Math.max(0, qty - sellable)} 股/份尚不能卖出`);
          }
          realized = (px - position.avg_cost) * qty - charge;
          nextCash += amount - charge;
          if (position.quantity === qty) db.prepare("DELETE FROM paper_positions WHERE id = ?").run(position.id);
          else db.prepare("UPDATE paper_positions SET quantity = ?, last_price = ?, updated_at = ? WHERE id = ?").run(position.quantity - qty, px, new Date().toISOString(), position.id);
        }
        db.prepare("UPDATE paper_accounts SET cash = ?, realized_pnl = realized_pnl + ?, updated_at = ? WHERE id = ?").run(nextCash, realized, new Date().toISOString(), accountId);
        const order = db.prepare("INSERT INTO paper_orders(account_id, side, code, name, quantity, price, amount, fee, realized_pnl, strategy, reason, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(accountId, side, code, name, qty, px, amount, charge, realized, strategy || "趋势跟随", reason || "策略条件触发", source || "真实行情");
        db.exec("COMMIT");
        return db.prepare("SELECT * FROM paper_orders WHERE id = ?").get(order.lastInsertRowid);
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    savePaperEquity(row) {
      db.prepare("INSERT INTO paper_equity(account_id, cash, market_value, equity, realized_pnl, unrealized_pnl, drawdown) VALUES (?, ?, ?, ?, ?, ?, ?)").run(row.accountId, row.cash, row.marketValue, row.equity, row.realizedPnl, row.unrealizedPnl, row.drawdown || 0);
      return db.prepare("SELECT * FROM paper_equity WHERE account_id = ? ORDER BY id DESC LIMIT 1").get(row.accountId);
    },
    saveScreenerRun({ logic, conditions, sort, results }) {
      db.prepare(`
        INSERT INTO screener_runs(logic, conditions_json, sort_json, result_json)
        VALUES (?, ?, ?, ?)
      `).run(logic, JSON.stringify(conditions), JSON.stringify(sort), JSON.stringify(results));
    },
    saveDraft(draft) {
      const review = draft.review || reviewDraftText(draft.markdown || "");
      const html = draft.html || markdownToHtml(draft.markdown || "");
      const result = db.prepare(`
        INSERT INTO wechat_drafts(title, topic, markdown, html, review_json, asset_ids_json, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        draft.title || "今日市场观察",
        draft.topic || "市场观察",
        draft.markdown || "",
        html,
        JSON.stringify(review),
        JSON.stringify(draft.assetIds || []),
        draft.source || "本地草稿"
      );
      return db.prepare("SELECT * FROM wechat_drafts WHERE id = ?").get(result.lastInsertRowid);
    },
    listDrafts() {
      return db.prepare("SELECT id, title, topic, source, asset_ids_json, created_at FROM wechat_drafts ORDER BY created_at DESC, id DESC LIMIT 20").all().map(normalizeDraft);
    },
    getDraft(id) {
      const row = db.prepare("SELECT * FROM wechat_drafts WHERE id = ?").get(Number(id));
      return row ? normalizeDraft(row) : null;
    },
    saveForecast(forecast) {
      // Repeated research within a day refreshes the record instead of growing the cache.
      db.prepare("DELETE FROM forecast_records WHERE code = ? AND horizon = ? AND created_at >= datetime('now', '-24 hours')")
        .run(forecast.code || "", forecast.horizon || "next-session");
      const result = db.prepare(`INSERT INTO forecast_records(code, name, horizon, forecast_json, source) VALUES (?, ?, ?, ?, ?)`).run(
        forecast.code || "",
        forecast.name || forecast.code || "",
        forecast.horizon || "next-session",
        JSON.stringify(forecast),
        forecast.source || "本地量化研究"
      );
      return db.prepare("SELECT * FROM forecast_records WHERE id = ?").get(result.lastInsertRowid);
    },
    listForecasts(code = "", limit = 20) {
      const rows = code
        ? db.prepare("SELECT * FROM forecast_records WHERE code = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(code, limit)
        : db.prepare("SELECT * FROM forecast_records ORDER BY created_at DESC, id DESC LIMIT ?").all(limit);
      return rows.map((row) => { try { return { ...row, forecast: JSON.parse(row.forecast_json) }; } catch { return row; } });
    },
    exportBackup() {
      const tables = ["snapshots", "market_history", "sector_members", "news_items", "screener_runs", "forecast_records", "wechat_drafts", "assets", "watchlist_items", "watchlist_groups", "paper_accounts", "paper_positions", "paper_orders", "paper_equity", "paper_intraday_observations", "data_status"];
      const backup = { exportedAt: new Date().toISOString(), schema: 1, tables: {} };
      for (const table of tables) {
        backup.tables[table] = table === "paper_accounts"
          ? db.prepare("SELECT id, name, initial_cash, cash, realized_pnl, created_at, updated_at FROM paper_accounts").all()
          : db.prepare(`SELECT * FROM ${table}`).all();
      }
      return backup;
    }
  };
}

export function reviewDraftText(text) {
  const banned = ["买入", "卖出", "必涨", "必跌", "目标收益", "目标价", "仓位指令", "明日推荐股", "推荐股", "候选池", "命中分", "稳赚", "翻倍"];
  const hits = banned.filter((word) => text.includes(word));
  return {
    passed: hits.length === 0,
    hits,
    warnings: hits.length ? ["公开稿包含不适合公众号发布的表达，需要改写。"] : ["未发现明显荐股或收益承诺表达。"]
  };
}

export function markdownToHtml(markdown) {
  return markdown
    .split(/\n{2,}/)
    .map((block) => {
      const text = escapeHtml(block.trim());
      if (!text) return "";
      if (text.startsWith("# ")) return `<h1>${text.slice(2)}</h1>`;
      if (text.startsWith("## ")) return `<h2>${text.slice(3)}</h2>`;
      return `<p>${text.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

function saveSnapshot(db, type, payload, source, status, fetchedAt) {
  db.exec("BEGIN");
  try {
    const result = db.prepare("INSERT INTO snapshots(type, payload, source, status, fetched_at) VALUES (?, ?, ?, ?, ?)")
      .run(type, JSON.stringify(payload || []), source, status, fetchedAt);
    // Full snapshot payloads already carry the latest state. Keeping older copies only grows SQLite.
    db.prepare("DELETE FROM snapshots WHERE type = ? AND id <> ?").run(type, result.lastInsertRowid);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function setStatus(db, key, value) {
  db.prepare(`
    INSERT INTO data_status(key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString());
}

function runInTransaction(db, fn, payload) {
  db.exec("BEGIN");
  try {
    fn(payload);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function addNewsRow(stmt, row) {
  if (!row?.title) return;
  stmt.run(
    String(row.title || "未命名资讯"),
    String(row.url || `manual:${Date.now()}:${Math.random().toString(16).slice(2)}`),
    String(row.source || "手动素材"),
    String(row.category || "市场资讯"),
    String(row.summary || ""),
    String(row.content || ""),
    String(row.published_at || row.publishedAt || ""),
    String(row.region || inferNewsRegion(row.category, row.title)),
    String(row.market || inferNewsMarket(row.category, row.title)),
    JSON.stringify(Array.isArray(row.event_tags) ? row.event_tags : String(row.event_tags || "").split(/[、,，]/).map((item) => item.trim()).filter(Boolean)),
    String(row.importance || "普通"),
    String(row.material_status || "待整理")
  );
}

function newsTitleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s\W_]+/g, "")
    .slice(0, 160);
}

function findNewsDuplicate(db, row) {
  const url = String(row?.url || "").trim();
  if (url) {
    const byUrl = db.prepare("SELECT * FROM news_items WHERE url = ? LIMIT 1").get(url);
    if (byUrl) return byUrl;
  }
  const key = newsTitleKey(row?.title);
  if (!key) return null;
  const recent = db.prepare("SELECT * FROM news_items ORDER BY id DESC LIMIT 300").all();
  return recent.find((item) => newsTitleKey(item.title) === key) || null;
}

function normalizeNews(row) {
  if (!row) return row;
  let tags = [];
  try { tags = JSON.parse(row.event_tags || "[]"); } catch { tags = []; }
  return { ...row, event_tags: Array.isArray(tags) ? tags : [] };
}

function inferNewsRegion(category = "", title = "") {
  const text = `${category} ${title}`;
  if (/美股|纳指|标普|美国|美联储/.test(text)) return "美国";
  if (/港股|恒生|香港/.test(text)) return "中国香港";
  if (/日股|日经|日本/.test(text)) return "日本";
  if (/韩股|韩国|KOSPI/.test(text)) return "韩国";
  if (/欧洲|欧股|德国|英国/.test(text)) return "欧洲";
  return "中国";
}

function inferNewsMarket(category = "", title = "") {
  const text = `${category} ${title}`;
  if (/美股|纳指|标普|美国|美联储/.test(text)) return "美股";
  if (/港股|恒生|香港/.test(text)) return "港股";
  if (/商品|黄金|原油|美元|汇率/.test(text)) return "商品/汇率";
  if (/政策|宏观|地缘|国际/.test(text)) return "宏观/海外";
  if (/ETF/.test(text)) return "ETF";
  return "A股";
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function normalizeWatchlistGroup(value) {
  const group = String(value || "默认组").trim().replace(/[<>]/g, "").slice(0, 24);
  return group || "默认组";
}

function nullableSortValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : -Infinity;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function historyLimit(window) {
  return {
    today: 80,
    five: 5,
    day: 2,
    month: 24,
    quarter: 66,
    year: 250,
    all: 1200
  }[window] || 24;
}

function normalizeAsset(row) {
  return {
    ...row,
    usable_for_wechat: Boolean(row.usable_for_wechat)
  };
}

function normalizeDraft(row) {
  let assetIds = [];
  let review = null;
  try { assetIds = JSON.parse(row.asset_ids_json || "[]"); } catch { assetIds = []; }
  try { review = JSON.parse(row.review_json || "null"); } catch { review = null; }
  return { ...row, assetIds, review };
}

function formatPointTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "--");
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
