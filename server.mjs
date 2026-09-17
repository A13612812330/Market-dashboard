import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import { openStore, markdownToHtml, reviewDraftText } from "./lib/store.mjs";
import { markets as mockMarkets, stocks as mockStocks, trends as mockTrends, etfs as mockEtfs, sectorFlows as mockSectorFlows } from "./lib/mock-data.mjs";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadLocalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (/^[A-Z][A-Z0-9_]*$/.test(key) && process.env[key] === undefined) process.env[key] = value;
  }
}

// .env stays local and is ignored by Git. It makes a fresh clone usable
// without requiring machine-wide environment variables.
loadLocalEnvFile(path.join(__dirname, ".env"));
const app = express();
const store = openStore(__dirname);
store.ensureSeed();
const adminUser = store.ensureAdminUser(process.env.ADMIN_USERNAME || "liyou", process.env.ADMIN_PASSWORD || "Ly123321");
const runtimeConfigPath = path.join(__dirname, "data", "runtime-config.json");
const dingTalkConfigPath = path.join(__dirname, "data", "dingtalk-robot.json");
const dingTalkStatePath = path.join(__dirname, "data", "dingtalk-push-state.json");
const feishuConfigPath = path.join(__dirname, "data", "feishu-robot.json");
const feishuStatePath = path.join(__dirname, "data", "feishu-push-state.json");
const feishuAppConfigPath = path.join(__dirname, "data", "feishu-app.json");
const refreshRuntime = {
  active: false,
  scope: "",
  phase: "idle",
  message: "暂无刷新任务",
  startedAt: "",
  finishedAt: "",
  lastResult: null
};
const futuStream = { child: null, startedAt: "" };
const futuLivePath = path.join(__dirname, "data", "futu-live.json");
const futuSubscriptionsPath = path.join(__dirname, "data", "futu-subscriptions.json");
const maintenanceLockPath = path.join(__dirname, "data", ".maintenance.lock");
const maintenanceLogPath = path.join(__dirname, "data", "maintenance.log");
const maintenanceScriptPath = path.join(__dirname, "scripts", "maintenance.mjs");
const dataDirPath = path.join(__dirname, "data");
const databasePath = path.join(dataDirPath, "market.sqlite");
const workBuddyResearchDir = path.resolve("E:\\新建文件夹\\WorkBuddy\\2026-07-29-16-37-49\\research-reports");
const marketReportsDir = path.resolve("E:\\新建文件夹\\WorkBuddy\\market-reports");
const maintenanceRuntime = { active: false, phase: "idle", message: "暂无维护任务", startedAt: "", finishedAt: "", lastResult: null };
const lanReadonly = process.env.LAN_READONLY !== "0";
const lanGuestPaper = process.env.LAN_GUEST_PAPER !== "0";
const paperAutoRuntime = {
  active: false,
  running: false,
  startedAtMs: 0,
  runToken: "",
  accounts: {},
  timer: null
};
const paperObservationRuntime = new Map();
// Auto entries need two consecutive qualified scans. This prevents an opening
// snapshot from immediately becoming a paper order while keeping exits reactive.
const paperSignalRuntime = new Map();
const paperHistoryWarmupRuntime = { pending: new Map(), attemptedAt: new Map(), outcomes: new Map() };
const PAPER_HISTORY_READY_POINTS = 200;
const newsRuntime = {
  active: false,
  lastRunAt: "",
  lastResult: null,
  timer: null
};
const marketSchedulerRuntime = {
  active: false,
  running: false,
  startedAtMs: 0,
  runToken: "",
  lastRunAt: "",
  nextRunAt: "",
  lastMessage: "等待服务端定时同步",
  lastRunByScope: {},
  timer: null
};
const MARKET_TICK_TIMEOUT_MS = 150_000;
const PAPER_TICK_TIMEOUT_MS = 150_000;
const PAPER_ACCOUNT_TIMEOUT_MS = 75_000;
const dingTalkRuntime = {
  active: false,
  running: false,
  timer: null,
  lastCheckAt: "",
  lastSuccessAt: "",
  lastError: "",
  results: {}
};
const feishuRuntime = {
  active: false,
  running: false,
  timer: null,
  lastCheckAt: "",
  lastSuccessAt: "",
  lastError: "",
  results: {}
};
const feishuAppRuntime = { tenantAccessToken: "", tokenExpiresAt: 0 };

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(store.assetsDir));

function isLoopbackRequest(req) {
  const address = String(req.socket.remoteAddress || req.ip || "").replace(/^::ffff:/, "");
  return address === "127.0.0.1" || address === "::1" || address === "localhost";
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map((item) => item.trim());
  const entry = cookies.find((item) => item.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function attachAccessContext(req, res, next) {
  const local = isLoopbackRequest(req);
  const user = store.getSessionUser(cookieValue(req, "komo_session"));
  if (local) {
    req.accessContext = { local: true, guest: false, user, ownerToken: user ? `user:${user.id}` : "local" };
  } else {
    let guestId = cookieValue(req, "komo_guest_id");
    if (!/^[0-9a-f-]{20,}$/i.test(guestId)) {
      guestId = randomUUID();
      res.setHeader("Set-Cookie", `komo_guest_id=${encodeURIComponent(guestId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    }
    req.accessContext = { local: false, guest: Boolean(lanGuestPaper && user && user.role !== "admin"), user, ownerToken: user ? `user:${user.id}` : `guest:${guestId}` };
  }
  next();
}

app.use(attachAccessContext);

function rejectLanPaperAccess(req, res, next) {
  if (!isLoopbackRequest(req) && !lanGuestPaper) {
    res.status(403).json({ ok: false, code: "LAN_READONLY", message: "局域网当前为只读模式，未开放访客模拟功能。" });
    return;
  }
  next();
}

app.use("/api/paper", rejectLanPaperAccess);

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `komo_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600`);
}

function requireAuth(req, res, next) {
  if (!req.accessContext.user) {
    res.status(401).json({ ok: false, code: "AUTH_REQUIRED", message: "请先登录" });
    return;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.accessContext.user?.role !== "admin") {
    res.status(403).json({ ok: false, code: "ADMIN_REQUIRED", message: "只有管理员可以访问" });
    return;
  }
  next();
}

app.get("/api/auth/me", (req, res) => res.json({ authenticated: Boolean(req.accessContext.user), user: req.accessContext.user || null }));
app.post("/api/auth/login", (req, res) => {
  const user = store.authenticateUser(req.body?.username, req.body?.password);
  if (!user) {
    res.status(401).json({ ok: false, message: "用户名或密码错误" });
    return;
  }
  const token = store.createSession(user.id);
  setSessionCookie(res, token);
  res.json({ ok: true, user });
});
app.post("/api/auth/logout", (req, res) => {
  store.deleteSession(cookieValue(req, "komo_session"));
  res.setHeader("Set-Cookie", "komo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/access", (req, res) => res.json({ local: req.accessContext.local, guestPaper: Boolean(req.accessContext.guest), lanReadonly, mode: req.accessContext.local ? "local" : (req.accessContext.guest ? "lan-guest" : "lan-readonly"), user: req.accessContext.user || null }));

app.use("/api", requireAuth);

setTimeout(() => syncFutuSubscriptions(), 1200);
setTimeout(() => migratePaperAutoRulesV7(), 1400);
setTimeout(() => startPaperAutoLoop(), 1500);
setTimeout(() => { void startMarketDataScheduler(); }, 3000);
setTimeout(() => startFeishuPushLoop(), 4500);

app.get("/api/markets", (_req, res) => res.json(store.getSnapshot("markets", "markets")));
app.get("/api/system/dingtalk", requireAdmin, (_req, res) => {
  const config = getDingTalkConfig();
  const state = readDingTalkPushState();
  res.json({
    configured: config.configured,
    enabled: config.enabled,
    pollSeconds: config.pollSeconds,
    runtime: { ...dingTalkRuntime, timer: undefined },
    state: summarizeDingTalkPushState(state)
  });
});
app.get("/api/system/feishu", requireAdmin, (_req, res) => {
  const config = getFeishuDeliveryConfig();
  const appConfig = getFeishuAppConfig();
  const state = readFeishuPushState();
  res.json({
    configured: config.configured,
    enabled: config.enabled,
    pollSeconds: config.pollSeconds,
    mode: config.mode,
    app: { configured: appConfig.configured, enabled: appConfig.enabled, targetBound: Boolean(appConfig.chatId) },
    runtime: { ...feishuRuntime, timer: undefined },
    state: summarizeFeishuPushState(state)
  });
});
app.post("/api/system/feishu/test", requireAdmin, async (_req, res) => {
  try {
    await sendFeishuCard("Komo 飞书通知测试", "**飞书机器人已连接。**\n\n后续将在交易日按计划发送市场报告和 Liyou 模拟账户通知。");
    res.json({ ok: true, message: "飞书测试消息已发送" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/system/feishu/manual-closing", requireAdmin, async (_req, res) => {
  try {
    const date = shanghaiDateKey();
    const result = readMarketReport("closing", date);
    if (!result?.report || result.resolvedDate !== date) throw new Error("今日暂无收盘报告");
    await sendFeishuCard(`Komo · ${date} 收盘复盘`, buildFeishuReportElements(result.report, "closing", date));
    const snapshot = buildLiyouPaperSnapshot();
    if (!snapshot) throw new Error("未找到 Liyou 模拟账户");
    await sendFeishuCard("Komo · Liyou 收盘账户情况", buildFeishuPaperElements(snapshot));
    const latestOrder = snapshot.allOrders.at(-1);
    if (latestOrder) {
      const accountRow = snapshot.accountRows.find((item) => item.account.name === latestOrder.accountName);
      const tradeElements = accountRow
        ? buildFeishuTradeElements(accountRow, latestOrder)
        : [feishuMarkdownBlock(`**${latestOrder.side === "BUY" ? "买入" : "卖出"}** ${latestOrder.name || latestOrder.code}（${latestOrder.code}）\n${formatDingTalkTradeReason(latestOrder.reason)}`)];
      await sendFeishuCard(feishuTradeCardTitle(accountRow, latestOrder), tradeElements, { headerTemplate: "blue" });
    } else {
      await sendFeishuCard("Komo · 今日交易情况", [feishuMarkdownBlock(`**${date} 暂无 Liyou 模拟交易记录。**`)]);
    }
    res.json({ ok: true, date, reportCards: 1, accountCards: 1, tradeCards: 1, message: "收盘报告、账户情况和交易情况已按结构化飞书卡片发送" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/system/feishu/manual-sell", requireAdmin, async (_req, res) => {
  try {
    const snapshot = buildLiyouPaperSnapshot();
    if (!snapshot) throw new Error("未找到 Liyou 模拟账户");
    const order = [...snapshot.allOrders].reverse().find((item) => item.side === "SELL");
    if (!order) throw new Error("当前没有可发送的卖出记录");
    const accountRow = snapshot.accountRows.find((item) => item.account.name === order.accountName);
    if (!accountRow) throw new Error("卖出记录对应账户不存在");
    await sendFeishuCard(feishuTradeCardTitle(accountRow, order), buildFeishuTradeElements(accountRow, order), { headerTemplate: "blue" });
    res.json({ ok: true, account: order.accountName, code: order.code, name: order.name || "", message: "最近卖出记录已发送" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/system/feishu/manual-trade", requireAdmin, async (_req, res) => {
  try {
    const snapshot = buildLiyouPaperSnapshot();
    if (!snapshot) throw new Error("未找到 Liyou 模拟账户");
    const order = snapshot.allOrders.at(-1);
    if (!order) throw new Error("当前没有可发送的模拟交易记录");
    const accountRow = snapshot.accountRows.find((item) => item.account.name === order.accountName);
    if (!accountRow) throw new Error("交易记录对应账户不存在");
    await sendFeishuCard(feishuTradeCardTitle(accountRow, order), buildFeishuTradeElements(accountRow, order), { headerTemplate: "blue" });
    res.json({ ok: true, account: order.accountName, code: order.code, name: order.name || "", message: "最近一条交易记录已发送" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.get("/api/trends", (_req, res) => res.json(store.getMarketTrendSeries()));
app.get("/api/stocks", (_req, res) => res.json(store.getSnapshot("stocks", "stocks")));
app.get("/api/etfs", (_req, res) => res.json(store.getSnapshot("etfs", "etfs")));
app.get("/api/securities/search", (req, res) => {
  const query = String(req.query.q || "").trim();
  res.json({ results: query ? store.searchSecurities(query, Number(req.query.limit || 30)) : [], master: store.getSecurityMasterStatus() });
});
app.get("/api/watchlist", (req, res) => {
  const items = store.listWatchlist(req.accessContext.ownerToken);
  res.json({ ok: true, items, groups: store.listWatchlistGroups(req.accessContext.ownerToken) });
});
app.post("/api/watchlist", (req, res) => {
  try {
    const item = store.addWatchlistItem(req.body || {}, req.accessContext.ownerToken);
    res.json({ ok: true, item, message: "已加入自选" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.delete("/api/watchlist/:code", (req, res) => {
  const result = store.removeWatchlistItem(decodeURIComponent(req.params.code || ""), req.accessContext.ownerToken);
  res.json({ ok: true, ...result, message: "已移除自选" });
});
app.put("/api/watchlist/:code/group", (req, res) => {
  try {
    const item = store.moveWatchlistItem(decodeURIComponent(req.params.code || ""), req.body?.groupName, req.accessContext.ownerToken);
    res.json({ ok: true, item, message: "已移动分组" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/watchlist/group", (req, res) => {
  try {
    const result = store.addWatchlistGroup(req.body?.groupName, req.accessContext.ownerToken);
    if (!result.created) {
      res.status(409).json({ ok: false, message: "该分组已存在" });
      return;
    }
    res.json({ ok: true, ...result, message: "分组已创建" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.put("/api/watchlist/group", (req, res) => {
  try {
    const result = store.renameWatchlistGroup(req.body?.oldName, req.body?.newName, req.accessContext.ownerToken);
    res.json({ ok: true, ...result, message: "分组已更新" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.get("/api/sector-flows", (_req, res) => {
  const snapshot = store.getSnapshot("sectorFlows", "sectors");
  res.json({ ...snapshot, sectors: (snapshot.sectors || []).filter(hasUsableSectorData) });
});
app.get("/api/data/completeness", (_req, res) => res.json(buildDataCompleteness()));
app.get("/api/history", (req, res) => {
  res.json(store.getHistory({
    type: String(req.query.type || "index"),
    code: String(req.query.code || ""),
    window: String(req.query.window || "month")
  }));
});
app.get("/api/sectors/:name/detail", (req, res) => {
  const sector = decodeURIComponent(req.params.name || "");
  res.json({
    sector,
    members: store.listSectorMembers(sector),
    news: relatedNews(store.listNewsItems(80), sector).slice(0, 8)
  });
});
app.get("/api/sectors", (req, res) => {
  const type = String(req.query.type || "industry");
  const rows = decorateSectorRows(store.listSectorFlow({ type, search: String(req.query.search || ""), sort: String(req.query.sort || "change_pct"), limit: Number(req.query.limit || 120) })).filter(hasUsableSectorData);
  res.json({ type, source: store.getSnapshot("sectorFlows", "sectors").source, updatedAt: store.getSnapshot("sectorFlows", "sectors").updatedAt, sectors: rows });
});
app.get("/api/sectors/heatmap", (req, res) => {
  const type = String(req.query.type || "industry");
  const sort = String(req.query.sort || "change_pct");
  const rows = decorateSectorRows(store.listSectorFlow({ type, search: String(req.query.search || ""), sort, limit: Number(req.query.limit || 120) })).filter(hasUsableSectorData);
  const areaValues = rows.map((item) => Math.abs(Number(item.net_inflow))).filter(Number.isFinite).filter((value) => value > 0);
  const maxInflow = Math.max(...areaValues, 0);
  res.json({
    type,
    sort,
    source: store.getSnapshot("sectorFlows", "sectors").source,
    updatedAt: store.getSnapshot("sectorFlows", "sectors").updatedAt,
    areaMetric: maxInflow > 0 ? "面积按净流入绝对值" : "等面积（暂无净流入）",
    sectors: rows.map((item) => {
      const inflow = Number(item.net_inflow);
      const hasInflow = Number.isFinite(inflow) && Math.abs(inflow) > 0;
      return {
        ...item,
        area: hasInflow && maxInflow > 0 ? Math.max(8, Math.round((Math.abs(inflow) / maxInflow) * 100)) : null,
        area_source: hasInflow ? "净流入绝对值" : "暂无净流入"
      };
    })
  });
});
app.get("/api/sectors/:name/overview", (req, res) => {
  const name = decodeURIComponent(req.params.name || "");
  const sector = decorateSectorRows(store.getSnapshot("sectorFlows", "sectors").sectors || []).filter(hasUsableSectorData).find((item) => item.name === name);
  res.json({ sector: sector || { name, status: "empty" }, source: store.getSnapshot("sectorFlows", "sectors").source });
});
app.get("/api/sectors/:name/members", (req, res) => {
  const name = decodeURIComponent(req.params.name || "");
  res.json({ sector: name, members: store.listSectorMembers(name), matchMode: store.listSectorMembers(name).length ? "成分股映射" : "弱匹配" });
});
app.get("/api/sectors/:name/etfs", (req, res) => {
  const name = decodeURIComponent(req.params.name || "");
  const etfs = store.getSnapshot("etfs", "etfs").etfs || [];
  const words = name.toLowerCase().split(/[·/\s]/).filter(Boolean);
  const matched = etfs.filter((item) => words.some((word) => `${item.name || ""} ${item.track_index || ""} ${item.sector || ""}`.toLowerCase().includes(word))).slice(0, 30);
  res.json({ sector: name, etfs: matched, matchMode: matched.length ? "指数/主题映射" : "暂无匹配" });
});
app.get("/api/news", (_req, res) => res.json({ news: store.listNewsItems(40) }));
app.get("/api/news/feed", (req, res) => {
  const news = store.queryNews({ region: req.query.region, market: req.query.market, source: req.query.source, keyword: req.query.keyword, importance: req.query.importance, materialStatus: req.query.materialStatus, limit: req.query.limit });
  res.json({ news, count: news.length, updatedAt: now(), source: "公开来源/手动素材", runtime: newsRuntime.lastResult });
});
app.post("/api/news/refresh", async (_req, res) => res.json(await refreshPublicNews()));
app.get("/api/news/events", (req, res) => {
  const news = store.queryNews({ region: req.query.region, market: req.query.market, keyword: req.query.keyword, limit: 200 });
  const groups = new Map();
  for (const item of news) {
    const key = String(item.title || "").replace(/[：:，,。.!！?？].*$/, "").slice(0, 32) || `event-${item.id}`;
    const group = groups.get(key) || { event: key, latestAt: item.published_at || item.created_at, importance: item.importance, markets: new Set(), sources: [], items: [] };
    group.markets.add(item.market || "A股");
    if (item.source && !group.sources.includes(item.source)) group.sources.push(item.source);
    group.items.push(item);
    groups.set(key, group);
  }
  res.json({ events: [...groups.values()].map((item) => ({ ...item, markets: [...item.markets] })).slice(0, 80) });
});
app.get("/api/news/filters", (_req, res) => {
  const news = store.listNewsItems(500);
  res.json({ regions: uniqueValues(news, "region"), markets: uniqueValues(news, "market"), sources: uniqueValues(news, "source"), importances: uniqueValues(news, "importance") });
});
app.post("/api/news/collect", (req, res) => {
  const body = req.body || {};
  const item = store.addNewsItem({ ...body, material_status: body.material_status || "待整理" });
  res.json({ ok: true, item, message: "资讯已进入监控中心" });
});
app.post("/api/news/normalize", (req, res) => {
  const body = req.body || {};
  res.json({ ok: true, normalized: normalizeNewsPayload(body) });
});
app.post("/api/news/add-to-draft", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  const selected = store.listNewsItems(500).filter((item) => ids.includes(Number(item.id)));
  res.json({ ok: true, count: selected.length, materials: selected, message: "已整理为公众号素材，可在生成设置中使用" });
});
app.get("/api/data/futu-status", async (_req, res) => res.json(await probeFutu()));
app.get("/api/data/futu-stream-status", (_req, res) => res.json(readFutuLive()));

app.get("/api/system/health", async (_req, res) => {
  const health = await getSystemHealth();
  res.json(health);
});
app.get("/api/system/maintenance", (_req, res) => {
  res.json({ runtime: { ...maintenanceRuntime }, entries: readMaintenanceEntries(20), tradingTime: isAshareTradingTime() });
});
app.post("/api/system/maintenance", async (req, res) => {
  if (maintenanceRuntime.active) return res.status(202).json({ ok: false, busy: true, ...maintenanceRuntime });
  const requestedRun = Boolean(req.body?.run);
  const canRun = requestedRun && !isAshareTradingTime();
  maintenanceRuntime.active = true;
  maintenanceRuntime.phase = canRun ? "preparing" : "checking";
  maintenanceRuntime.message = canRun ? "正在准备维护任务" : (requestedRun ? "交易时段只执行检查" : "正在检查缓存与维护状态");
  maintenanceRuntime.startedAt = now();
  maintenanceRuntime.finishedAt = "";
  try {
    maintenanceRuntime.phase = "running-script";
    maintenanceRuntime.message = canRun ? "正在清理过期盘中观察并检查 WAL" : "正在检查过期观察、WAL 与备份保留";
    const { stdout } = await execFileAsync(process.execPath, [maintenanceScriptPath, ...(canRun ? [] : ["--check"])], { cwd: __dirname, timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
    const result = JSON.parse(String(stdout || "{}").trim().split(/\r?\n/).at(-1) || "{}");
    maintenanceRuntime.lastResult = result;
    maintenanceRuntime.phase = result.checkpointBusy ? "checkpoint-pending-retry" : "completed";
    maintenanceRuntime.message = result.message || "维护完成";
    maintenanceRuntime.finishedAt = now();
    res.json({ ok: Boolean(result.ok), executed: canRun, result, runtime: { ...maintenanceRuntime } });
  } catch (error) {
    maintenanceRuntime.phase = "failed";
    maintenanceRuntime.message = String(error.message || error);
    maintenanceRuntime.finishedAt = now();
    res.status(500).json({ ok: false, message: maintenanceRuntime.message, runtime: { ...maintenanceRuntime } });
  } finally {
    maintenanceRuntime.active = false;
  }
});

function allowMockApi(req, res, payload) {
  if (process.env.ALLOW_MOCK_API !== "1") return res.status(404).json({ ok: false, message: "模拟接口已关闭；请使用真实行情或最近缓存" });
  return res.json(payload);
}
app.get("/api/mock/markets", (_req, res) => allowMockApi(_req, res, { updatedAt: now(), source: "模拟数据", status: "fallback", markets: mockMarkets }));
app.get("/api/mock/stocks", (_req, res) => allowMockApi(_req, res, { updatedAt: now(), source: "模拟数据", status: "fallback", stocks: mockStocks }));
app.get("/api/mock/trends", (_req, res) => allowMockApi(_req, res, { updatedAt: now(), source: "模拟数据", status: "fallback", series: mockTrends }));
app.get("/api/mock/etfs", (_req, res) => allowMockApi(_req, res, { updatedAt: now(), source: "模拟数据", status: "fallback", etfs: mockEtfs }));
app.get("/api/mock/sector-flows", (_req, res) => allowMockApi(_req, res, { updatedAt: now(), source: "模拟数据", status: "fallback", sectors: mockSectorFlows }));

app.post("/api/data/refresh", async (req, res) => {
  if (refreshRuntime.active) {
    res.status(202).json({ ok: false, busy: true, scope: refreshRuntime.scope, phase: refreshRuntime.phase, message: "已有刷新任务正在执行，请等待当前任务完成。" });
    return;
  }
  const result = await refreshMarketData(String(req.query.scope || req.body?.scope || "all"), String(req.query.code || req.body?.code || ""));
  res.json(result);
});
app.get("/api/data/refresh-status", (_req, res) => res.json({
  ...refreshRuntime,
  scheduler: {
    active: marketSchedulerRuntime.active,
    running: marketSchedulerRuntime.running,
    lastRunAt: marketSchedulerRuntime.lastRunAt,
    nextRunAt: marketSchedulerRuntime.nextRunAt,
    lastMessage: marketSchedulerRuntime.lastMessage,
    lastRunByScope: marketSchedulerRuntime.lastRunByScope
  }
}));

app.get("/api/settings/status", (_req, res) => {
  const ai = getAiConfig();
  const agnes = getAgnesConfig();
  const imageAi = getImageAiConfig();
  const videoAi = getVideoAiConfig();
  const runtimeConfig = getRuntimeConfig();
  res.json({
    updatedAt: now(),
    server: { port, host, configPath: runtimeConfigPath },
    database: { ok: true, path: path.join(__dirname, "data", "market.sqlite") },
    assetsDir: store.assetsDir,
    dataProviders: {
      futu: {
        enabled: process.env.FUTU_ENABLED !== "0",
        host: process.env.FUTU_HOST || "127.0.0.1",
        port: Number(process.env.FUTU_PORT || 11111),
        note: "需要本机运行 Futu OpenD 并完成登录"
      },
      emquant: {
        enabled: process.env.EMQUANT_ENABLED === "1",
        configured: Boolean(process.env.EMQUANT_TOKEN),
        note: "需要 EmQuant Python 包和 Token"
      }
    },
    agnes: {
      configured: agnes.configured,
      anyConfigured: agnes.configured || ai.configured || imageAi.configured,
      model: agnes.model,
      baseUrl: agnes.baseUrl,
      provider: agnes.provider,
      keyPreview: maskKey(agnes.apiKey),
      writerConfigured: ai.configured,
      writerModel: ai.model,
      writerBaseUrl: ai.baseUrl,
      writerProvider: ai.provider,
      writerKeyPreview: maskKey(ai.apiKey),
      imageConfigured: imageAi.configured,
      imageModel: imageAi.model,
      imageBaseUrl: imageAi.baseUrl,
      imageProvider: imageAi.provider,
      imageKeyPreview: maskKey(imageAi.apiKey),
      videoConfigured: videoAi.configured,
      videoModel: videoAi.model,
      videoBaseUrl: videoAi.baseUrl,
      videoProvider: videoAi.provider,
      videoKeyPreview: maskKey(videoAi.apiKey),
      configSource: runtimeConfig.__exists ? "本地配置/环境变量" : "环境变量"
    },
    sources: store.getStatus("sources")
  });
});

app.get("/api/settings/config", (_req, res) => {
  const ai = getAiConfig();
  const agnes = getAgnesConfig();
  const imageAi = getImageAiConfig();
  const videoAi = getVideoAiConfig();
  res.json({
    server: { port, host, configPath: runtimeConfigPath },
    ai: safeConfigForClient(ai),
    agnes: safeConfigForClient(agnes),
    image: safeConfigForClient(imageAi),
    video: safeConfigForClient(videoAi),
    sources: store.getStatus("sources")
  });
});

app.post("/api/settings/config", (req, res) => {
  const body = req.body || {};
  const current = getRuntimeConfig();
  const next = {
    ai: sanitizeConfigSection(body.ai, current.ai),
    agnes: sanitizeConfigSection(body.agnes, current.agnes),
    image: sanitizeConfigSection(body.image, current.image),
    video: sanitizeConfigSection(body.video, current.video),
    paper: current.paper || undefined
  };
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
  fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  res.json({
    ok: true,
    message: "本地配置已保存，后续 AI 调用立即使用新配置。",
    config: {
      ai: safeConfigForClient(resolveProviderConfig("ai", {
        provider: "Agnes",
        model: "agnes-2.0-flash",
        baseUrl: "https://apihub.agnes-ai.com/v1"
      })),
      agnes: safeConfigForClient(resolveProviderConfig("agnes", {
        provider: "Agnes",
        model: "agnes-2.0-flash",
        baseUrl: "https://apihub.agnes-ai.com/v1"
      })),
      image: safeConfigForClient(resolveProviderConfig("image", {
        provider: "Agnes",
        model: "agnes-image-2.0-flash",
        baseUrl: "https://apihub.agnes-ai.com/v1"
      })),
      video: safeConfigForClient(resolveProviderConfig("video", {
        provider: "Agnes",
        model: "agnes-video-2.0",
        baseUrl: "https://apihub.agnes-ai.com/v1"
      }))
    }
  });
});

app.post("/api/screener/run", (req, res) => {
  const { conditions = [], logic = "AND", sort = { field: "hit_score", direction: "desc" }, researchScoring = false } = req.body || {};
  const data = store.getSnapshot("stocks", "stocks");
  const matched = (data.stocks || [])
    .map((item) => ({ ...item, hit_score: scoreStock(item, conditions) }))
    .filter((item) => matchesConditions(item, conditions, logic));
  const maxResearchRows = 40;
  const scored = researchScoring
    ? [...matched]
      .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
      .slice(0, maxResearchRows)
      .map((item) => {
        const researchScore = buildResearchScore({ ...item, market: "A股" }, getStockHistory(item, "quarter"));
        return { ...item, research_score: researchScore.score, research_level: researchScore.level, research_coverage: researchScore.availableWeight };
      })
    : matched;
  const filtered = scored.sort((a, b) => compareByField(a, b, sort.field, sort.direction));

  store.saveScreenerRun({ logic, conditions, sort, results: filtered });
  res.json({
    updatedAt: data.updatedAt,
    source: data.source,
    status: data.status,
    quality: stockPoolQuality(data.stocks || []),
    logic,
    sort,
    count: filtered.length,
    matchedCount: matched.length,
    researchScoring: Boolean(researchScoring),
    researchScoredCount: researchScoring ? filtered.length : 0,
    researchLimit: researchScoring ? maxResearchRows : 0,
    stocks: filtered
  });
});

app.post("/api/screener/predict", (req, res) => {
  const { query = "", conditions = [], logic = "AND" } = req.body || {};
  const data = store.getSnapshot("stocks", "stocks");
  const etfs = store.getSnapshot("etfs", "etfs");
  const stock = findStockByQuery([...(data.stocks || []).map((item) => ({ ...item, market: "A股" })), ...(etfs.etfs || []).map((item) => ({ ...item, market: "ETF" }))], String(query || ""));
  if (!stock) {
    res.json({
      ok: false,
      query,
      message: "未在当前股票池或 ETF 池中找到对应代码或名称，请先刷新行情。"
    });
    return;
  }
  const isEtf = (etfs.etfs || []).some((item) => String(item.code || "") === String(stock.code || ""));
  const researchStock = { ...stock, market: isEtf ? "ETF" : "A股" };
  const history = getStockHistory(researchStock, "quarter");
  const prediction = buildStockPrediction(researchStock, conditions, logic, { ...data, source: isEtf ? etfs.source : data.source }, history);
  res.json({ ok: true, prediction });
});

app.post("/api/research/stock", async (req, res) => {
  const { query = "", window = "month" } = req.body || {};
  const stocksData = store.getSnapshot("stocks", "stocks");
  const etfsData = store.getSnapshot("etfs", "etfs");
  let stock = findStockByQuery([...(stocksData.stocks || []), ...(etfsData.etfs || [])], String(query || ""));
  const master = stock ? null : store.getSecurityByQuery(String(query || ""));
  if (!stock && master) {
    const quote = await refreshSecurityQuote(master.code, master.security_type);
    stock = quote ? { ...master, ...quote } : null;
  }
  if (!stock) {
    res.json({ ok: false, message: master ? `已找到 ${master.name}，但按需行情暂不可用，请检查 Futu OpenD 或稍后重试。` : "未在证券目录或当前行情池中找到对应代码或名称。" });
    return;
  }
  const isEtf = master ? master.security_type === "etf" : (etfsData.etfs || []).some((item) => String(item.code || "") === String(stock.code || ""));
  let history = getStockHistory(stock, String(window || "month"));
  if (!history.points?.length && !isEtf) {
    await refreshStockHistory(stock.code);
    history = getStockHistory(stock, String(window || "month"));
  }
  const researchStock = { ...stock, market: isEtf ? "ETF" : "A股" };
  const researchData = master ? { ...stocksData, source: stock.source_name || master.source || stocksData.source, updatedAt: stock.update_time || stocksData.updatedAt } : stocksData;
  const prediction = buildStockPrediction(researchStock, [], "AND", researchData, history);
  const forecast = buildResearchForecast(researchStock, history, prediction);
  store.saveForecast(forecast);
  res.json({
    ok: true,
    updatedAt: researchData.updatedAt,
    source: researchData.source,
    research: { ...buildStockResearch(researchStock, history, prediction), forecast, forecastHistory: store.listForecasts(stock.code, 8) }
  });
});
app.get("/api/research/search", (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) {
    res.json({ results: [] });
    return;
  }
  const stocksData = store.getSnapshot("stocks", "stocks");
  const etfsData = store.getSnapshot("etfs", "etfs");
  const liveResults = [
    ...findStockMatches(stocksData.stocks || [], query, 30).map(({ item, rank }) => ({ ...item, rank, market: "A股" })),
    ...findStockMatches(etfsData.etfs || [], query, 30).map(({ item, rank }) => ({ ...item, rank, market: "ETF" }))
  ].sort((a, b) => b.rank - a.rank).slice(0, 30);
  const liveCodes = new Set(liveResults.map((item) => String(item.code || "").toLowerCase()));
  const directoryResults = store.searchSecurities(query, 30)
    .filter((item) => !liveCodes.has(String(item.code || "").toLowerCase()))
    .map((item) => ({ ...item, price: null, change_pct: null, amount: null, source_name: item.source || "证券目录", quote_status: "未载入实时行情" }));
  const results = [...liveResults, ...directoryResults].sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0)).slice(0, 30).map(({ rank: _rank, ...item }) => item);
  res.json({ results, updatedAt: stocksData.updatedAt || etfsData.updatedAt || "", source: `${stocksData.source || etfsData.source || "最近数据"} / ${store.getSecurityMasterStatus().count ? "证券目录" : "证券目录待同步"}`, master: store.getSecurityMasterStatus() });
});
app.get("/api/research/forecasts", (req, res) => {
  res.json({ forecasts: store.listForecasts(String(req.query.code || ""), Number(req.query.limit || 30)) });
});
app.get("/api/research/reports/:slot", (req, res) => {
  const report = readWorkBuddyResearchReport(req.params.slot);
  if (!report) return res.status(404).json({ ok: false, message: "该时段暂无 WorkBuddy 市场报告" });
  res.json({ ok: true, report });
});
app.post("/api/research/reports/:slot/risk-radar", (req, res) => {
  const report = readWorkBuddyResearchReport(req.params.slot);
  if (!report) return res.status(404).json({ ok: false, message: "该时段暂无 WorkBuddy 市场报告" });
  if (!report.entries.riskRadar) return res.status(400).json({ ok: false, message: "该报告未授权加入风险雷达" });
  const current = Array.isArray(store.getStatus("workbuddy-report-risk-radar")) ? store.getStatus("workbuddy-report-risk-radar") : [];
  const next = [{ reportId: report.meta.report_id || `${report.slot}-${report.fileName}`, slot: report.slot, title: `${report.meta.report_type || report.slot}报告风险参考`, detail: `风险等级 ${report.meta.risk_level || "未标注"}；${(report.meta.tags?.sector || []).slice(0, 4).join("、") || "暂无板块标签"}。请结合实时行情核验，不作为交易指令。`, evidence: `${report.meta.source || "WorkBuddy"} · ${report.meta.generated_at || report.fileName}`, level: report.meta.risk_level || "中", updatedAt: now() }, ...current.filter((item) => item.reportId !== (report.meta.report_id || `${report.slot}-${report.fileName}`))].slice(0, 10);
  store.setStatus("workbuddy-report-risk-radar", next);
  res.json({ ok: true, message: "已加入研究中心风险雷达，后续实时行情刷新仍会保留该报告证据。", item: next[0] });
});
app.get("/api/market-report/available", (_req, res) => {
  const reports = listAvailableMarketReports();
  res.json({ ok: true, count: reports.length, reports });
});
app.get("/api/market-report/:session", (req, res) => {
  const session = String(req.params.session || "");
  const requestedDate = String(req.query.date || shanghaiDateKey());
  if (!isMarketReportSession(session)) {
    return res.status(400).json({ ok: false, code: "INVALID_SESSION", message: "报告时段无效" });
  }
  if (!isMarketReportDate(requestedDate)) {
    return res.status(400).json({ ok: false, code: "INVALID_DATE", message: "日期格式应为 YYYY-MM-DD" });
  }
  const result = readMarketReport(session, requestedDate);
  if (!result) {
    return res.json({ ok: false, code: "NO_REPORT", requestedDate, session, message: "该时段暂无市场报告" });
  }
  res.json({ ok: true, requestedDate, resolvedDate: result.resolvedDate, session, isFallback: result.isFallback, report: result.report });
});
app.get("/api/admin/overview", requireAdmin, (_req, res) => {
  const users = store.listUsers();
  const userMap = new Map(users.map((user) => [`user:${user.id}`, user]));
  const accounts = store.listAllPaperAccounts().map((account) => {
    const owner = userMap.get(account.owner_token) || { username: "未归属", role: "unknown" };
    const status = buildPaperStatus(account, false);
    return { account: publicPaperAccount(status.account), owner, positions: status.positions, todayPositions: status.todayPositions, orders: status.orders, equity: status.equity, auto: getPaperAutoStatus(account.id), stream: status.stream };
  });
  res.json({ users, accounts });
});
app.post("/api/admin/users", requireAdmin, (req, res) => {
  try {
    const user = store.createUser(req.body?.username, req.body?.password, "member");
    res.json({ ok: true, user, message: "成员账号已创建" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/admin/users/:id/active", requireAdmin, (req, res) => {
  try {
    const user = store.setUserActive(req.params.id, req.body?.active !== false);
    res.json({ ok: true, user });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.put("/api/admin/users/:id", requireAdmin, (req, res) => {
  try {
    const user = store.updateUser(req.params.id, { username: req.body?.username, password: req.body?.password, active: req.body?.active });
    res.json({ ok: true, user, message: "成员资料已更新" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/admin/users/:id/reset-password", requireAdmin, (req, res) => {
  try {
    const user = store.resetUserPassword(req.params.id, "123456");
    res.json({ ok: true, user, message: `成员 ${user.username} 的密码已重置为 123456，现有登录已退出` });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  try {
    const deleted = store.deleteUser(req.params.id);
    const runtime = getRuntimeConfig();
    const currentAccounts = runtime.paper?.accounts || {};
    const accounts = { ...currentAccounts };
    for (const accountId of deleted.accountIds || []) delete accounts[String(accountId)];
    if (runtime.paper) {
      fs.writeFileSync(runtimeConfigPath, `${JSON.stringify({ ...runtime, __exists: undefined, paper: { ...runtime.paper, accounts } }, null, 2)}\n`, "utf-8");
      restartPaperAutoLoop();
    }
    syncFutuSubscriptions();
    res.json({ ok: true, user: deleted, message: "成员及其模拟账户记录已删除" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.get("/api/paper/accounts", (req, res) => res.json({ accounts: store.listPaperAccounts(req.accessContext.ownerToken), guest: Boolean(req.accessContext.guest) }));
app.get("/api/paper/status", (req, res) => {
  const account = store.getPaperAccount(req.query.accountId ? Number(req.query.accountId) : null, req.accessContext.ownerToken);
  if (!account) {
    const stream = readFutuLive();
    res.json({ configured: false, message: "请先设置模拟账户初始资金。", account: null, positions: [], orders: [], equity: [], stream: { connected: stream.connected, message: stream.message || "等待实时推送", updatedAt: stream.updatedAt || "", codes: stream.codes || [] } });
    return;
  }
  syncFutuSubscriptions(account.id);
  res.json(buildPaperStatus(account, false));
});
app.post("/api/paper/account", (req, res) => {
  try {
    const isGuest = Boolean(req.accessContext.guest);
    if (isGuest && req.body?.reset) throw new Error("访客账户不支持重置，只能删除后重新创建");
    const requestedName = String(req.body?.name || "").trim().slice(0, 32);
    const account = store.createPaperAccount(req.body?.initialCash, { reset: Boolean(req.body?.reset), accountId: req.body?.accountId ? Number(req.body.accountId) : null, name: isGuest ? (requestedName || "模拟账号") : (requestedName || "Komo模拟账户"), ownerToken: req.accessContext.ownerToken });
    syncFutuSubscriptions(account.id);
    res.json({ ok: true, account: publicPaperAccount(account), message: "模拟账户已设置" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.put("/api/paper/account/:id/name", (req, res) => {
  try {
    const account = store.updatePaperAccountName(req.params.id, req.body?.name, req.accessContext.ownerToken);
    res.json({ ok: true, account: publicPaperAccount(account), message: "模拟账户名称已更新" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/paper/account/delete", (req, res) => {
  try {
    const deleted = store.deletePaperAccount(req.body?.accountId, req.accessContext.ownerToken);
    const runtime = getRuntimeConfig();
    if (runtime.paper?.accounts?.[String(deleted.id)]) {
      const accounts = { ...runtime.paper.accounts };
      delete accounts[String(deleted.id)];
      fs.writeFileSync(runtimeConfigPath, `${JSON.stringify({ ...runtime, __exists: undefined, paper: { ...(runtime.paper || {}), accounts } }, null, 2)}\n`, "utf-8");
      restartPaperAutoLoop();
    }
    syncFutuSubscriptions();
    res.json({ ok: true, account: publicPaperAccount(deleted), message: "模拟账户及其本地记录已删除" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/paper/history-warmup", requireAdmin, async (req, res) => {
  try {
    const requestedLimit = Math.max(1, Math.min(Number(req.body?.limit) || 20, 20));
    const accounts = store.listPaperAccounts(req.accessContext.ownerToken);
    const requestedIds = Array.isArray(req.body?.accountIds) ? req.body.accountIds.map(Number).filter(Number.isInteger) : [];
    const selectedAccounts = requestedIds.length
      ? requestedIds.map((id) => accounts.find((account) => account.id === id)).filter(Boolean)
      : accounts;
    if (requestedIds.length && selectedAccounts.length !== requestedIds.length) throw new Error("存在不可访问的模拟账户");
    const stocks = store.getSnapshot("stocks", "stocks");
    const etfs = store.getSnapshot("etfs", "etfs");
    if (stocks.status === "fallback" || etfs.status === "fallback") throw new Error("当前真实 A股或ETF快照不可用，暂不补历史K线");
    const selected = new Map();
    for (const account of selectedAccounts) {
      for (const position of store.listPaperPositions(account.id)) selected.set(String(position.code), { ...position, market: position.market || "A股" });
      const config = getPaperAutoConfig(account.id);
      for (const item of buildPaperFocusUniverse(account, config, stocks, etfs)) {
        if (selected.size >= requestedLimit) break;
        selected.set(String(item.code), item);
      }
      if (selected.size >= requestedLimit) break;
    }
    const selectedRows = [...selected.values()].slice(0, requestedLimit);
    const rows = await mapWithConcurrency(selectedRows, 2, async (item) => {
      const before = getPaperIndicators(item, { usePreviousDailyBar: true });
      if (before.available && before.points >= PAPER_HISTORY_READY_POINTS) {
        return { code: item.code, name: item.name, status: "cached", points: before.points, source: before.source };
      }
      let result = null;
      let refreshError = "";
      try {
        result = await refreshStockHistory(item.code);
      } catch (error) {
        refreshError = String(error.message || error);
      }
      paperIndicatorCache.delete(String(item.code));
      paperIndicatorCache.delete(`${String(item.code)}:previous`);
      const after = getPaperIndicators(item, { usePreviousDailyBar: true });
      const enoughHistory = after.available && Number(after.points || 0) >= PAPER_HISTORY_READY_POINTS;
      return {
        code: item.code,
        name: item.name,
        status: enoughHistory ? "loaded" : (after.available ? "insufficient" : "unavailable"),
        points: after.points || 0,
        source: after.source || result?.sources?.history || "暂无历史数据",
        message: enoughHistory ? "历史样本已补齐，可用于趋势与回测" : (refreshError || `历史样本不足（${after.points || 0}/${PAPER_HISTORY_READY_POINTS}），已保留实时行情降级运行`)
      };
    });
    const coverage = {
      checkedAt: now(),
      accountIds: selectedAccounts.map((account) => account.id),
      requiredPoints: PAPER_HISTORY_READY_POINTS,
      requested: selected.size,
      loaded: rows.filter((item) => item.status === "loaded").length,
      cached: rows.filter((item) => item.status === "cached").length,
      insufficient: rows.filter((item) => item.status === "insufficient").length,
      unavailable: rows.filter((item) => item.status === "unavailable").length,
      gaps: rows.filter((item) => item.status === "insufficient" || item.status === "unavailable").map((item) => ({ code: item.code, name: item.name, points: item.points, status: item.status, message: item.message || "暂无历史数据" }))
    };
    const runtime = getRuntimeConfig();
    fs.writeFileSync(runtimeConfigPath, `${JSON.stringify({ ...runtime, __exists: undefined, paper: { ...(runtime.paper || {}), historyCoverage: coverage } }, null, 2)}\n`, "utf-8");
    res.json({ ok: true, ...coverage, rows });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/paper/rebalance/today", requireAdmin, async (req, res) => {
  try {
    const accounts = store.listPaperAccounts(req.accessContext.ownerToken);
    const positions = accounts.flatMap((account) => store.listPaperPositions(account.id).map((position) => ({ account, position })));
    const backupDir = path.join(__dirname, "data", "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `paper-rebalance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ createdAt: now(), accounts, positions, orders: Object.fromEntries(accounts.map((account) => [account.id, store.listPaperOrders(account.id, 500)])), runtime: getRuntimeConfig().paper || {} }, null, 2), "utf-8");
    const quotes = await refreshSecurityQuotes(positions.map((item) => item.position.code));
    const quoteByCode = new Map((quotes || []).map((item) => [normalizeLookupText(item.code), item]));
    const actions = [];
    const skipped = [];
    for (const { account, position } of positions) {
      const quote = quoteByCode.get(normalizeLookupText(position.code));
      const price = Number(quote?.price);
      if (!Number.isFinite(price) || price <= 0) {
        skipped.push({ accountId: account.id, code: position.code, name: position.name, reason: "未取得真实报价，未清仓" });
        continue;
      }
      const quantity = Number(position.quantity);
      const order = store.applyPaperTrade({ accountId: account.id, side: "SELL", code: position.code, name: position.name, market: position.market, quantity, price, fee: quantity * price * 0.0003, strategy: "策略重建", reason: `${shanghaiDateKey()} 策略重建清仓（模拟，当日临时解除T+1）`, source: "Futu OpenD实时行情", skipT1: true });
      actions.push({ accountId: account.id, code: position.code, name: position.name, quantity, price, orderId: order.id });
    }
    const runtime = getRuntimeConfig();
    writePaperRuntime({ ...runtime, paper: { ...(runtime.paper || {}), t1BypassDate: shanghaiDateKey() } });
    syncFutuSubscriptions();
    res.json({ ok: true, backupPath, t1BypassDate: shanghaiDateKey(), sold: actions.length, skipped, actions, message: "已按真实报价完成模拟清仓；当日新仓允许同日卖出，明日自动恢复T+1。自动策略将按两轮确认重新建仓。" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/paper/t1-bypass/today", requireAdmin, (_req, res) => {
  const runtime = getRuntimeConfig();
  const date = shanghaiDateKey();
  writePaperRuntime({
    ...runtime,
    paper: {
      ...(runtime.paper || {}),
      t1BypassDate: date,
      t1BypassNote: "管理员于当日优化模拟持仓时启用；次日自动恢复 T+1",
      t1BypassEnabledAt: now()
    }
  });
  res.json({ ok: true, date, message: `${date} 已启用本地模拟账户当日 T+0 例外；仅今日有效，明日自动恢复 T+1。` });
});
app.post("/api/paper/t1-bypass/clear", requireAdmin, (_req, res) => {
  const runtime = getRuntimeConfig();
  const paper = { ...(runtime.paper || {}) };
  delete paper.t1BypassDate;
  delete paper.t1BypassNote;
  delete paper.t1BypassEnabledAt;
  writePaperRuntime({ ...runtime, paper });
  res.json({ ok: true, message: "已关闭当日 T+0 例外，模拟账户恢复 T+1 规则。" });
});
app.post("/api/paper/run", (req, res) => {
  try {
    const account = store.getPaperAccount(req.body?.accountId ? Number(req.body.accountId) : null, req.accessContext.ownerToken);
    if (!account) throw new Error("请先设置模拟账户初始资金");
    const savedAutoConfig = getPaperAutoConfig(account.id);
    const isGuest = Boolean(req.accessContext.guest);
    const conditions = Array.isArray(req.body?.conditions) ? req.body.conditions : [];
    const watchlist = Array.isArray(req.body?.watchlist) ? req.body.watchlist : [];
    const requestedStrategy = isGuest ? "custom" : String(req.body?.strategy || "trend");
    const savedStrategy = findPaperStrategy(requestedStrategy);
    const effectiveConditions = conditions.length ? conditions : (savedStrategy?.conditions || []);
    const effectiveLogic = req.body?.logic === "OR" ? "OR" : (savedStrategy?.logic || "AND");
    const effectiveMarket = ["all", "A股", "ETF"].includes(String(req.body?.market)) ? String(req.body.market) : (savedStrategy?.market || "all");
    const effectiveRules = req.body?.rules && Object.keys(req.body.rules).length ? req.body.rules : (savedStrategy?.rules || {});
    if (requestedStrategy === "custom" && !effectiveConditions.length && !watchlist.length) throw new Error("自定义策略必须填写条件或自选代码");
    const stocks = store.getSnapshot("stocks", "stocks");
    const etfs = store.getSnapshot("etfs", "etfs");
    if (stocks.status === "fallback" || etfs.status === "fallback" || [stocks.source, etfs.source].some((source) => String(source || "").includes("模拟数据"))) {
      throw new Error("当前只有模拟数据，暂不执行模拟交易；请先刷新真实 A股和 ETF 数据");
    }
    const result = runPaperStrategy(account, stocks, etfs, {
      strategy: requestedStrategy,
      conditions: effectiveConditions,
      logic: effectiveLogic,
      market: effectiveMarket,
      accountRole: String(req.body?.accountRole || savedAutoConfig.accountRole || "trend"),
      watchlist,
      rules: normalizePaperRules(effectiveRules),
      dryRun: Boolean(req.body?.dryRun),
      sameDaySellAllowed: Boolean(savedAutoConfig.sameDaySellAllowed),
      maxActionsPerDay: Number(req.body?.maxActionsPerDay || savedAutoConfig.maxActionsPerDay || 10),
      maxBuysPerDay: Number(req.body?.maxBuysPerDay || savedAutoConfig.maxBuysPerDay || 10),
      maxSellsPerDay: Number(req.body?.maxSellsPerDay || savedAutoConfig.maxSellsPerDay || 10),
      // A supervised close replay can deliberately be limited to buys or
      // risk exits. Normal manual and scheduled runs keep both directions.
      allowBuy: req.body?.allowBuy !== false,
      allowSell: req.body?.allowSell !== false,
      executionLabel: String(req.body?.executionLabel || "").trim().slice(0, 120),
      // Used by the decision console to preview the same time-window and
      // confirmation gate as the scheduler without writing orders.
      auto: Boolean(req.body?.auto)
    });
    res.json({ ok: true, dryRun: Boolean(req.body?.dryRun), ...result });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.get("/api/paper/auto-config", (req, res) => {
  const accountId = req.query.accountId ? Number(req.query.accountId) : null;
  if (accountId && !store.getPaperAccount(accountId, req.accessContext.ownerToken)) return res.status(404).json({ ok: false, message: "模拟账户不存在" });
  res.json(getPaperAutoStatus(accountId));
});
app.get("/api/paper/portfolio-overview", (req, res) => {
  try {
    res.json({ ok: true, ...getPaperPortfolioOverview(req.accessContext.ownerToken) });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});
app.post("/api/paper/auto-config", (req, res) => {
  try {
    const current = getRuntimeConfig();
    const accountId = Number(req.body?.accountId);
    if (!accountId || !store.getPaperAccount(accountId, req.accessContext.ownerToken)) throw new Error("请先选择有效的模拟账户");
    const isGuest = Boolean(req.accessContext.guest);
    const conditions = Array.isArray(req.body?.conditions) ? req.body.conditions : [];
    const watchlist = Array.isArray(req.body?.watchlist) ? req.body.watchlist.map(String).filter(Boolean).slice(0, 100) : [];
    const requestedStrategy = isGuest ? "custom" : String(req.body?.strategy || "trend");
    if (requestedStrategy === "custom" && !conditions.length && !watchlist.length) throw new Error("自定义策略必须填写条件或自选代码");
    const previous = getPaperAutoConfig(accountId);
    const next = {
      enabled: Boolean(req.body?.enabled),
      intervalSeconds: [60, 180, 300].includes(Number(req.body?.intervalSeconds)) ? Number(req.body.intervalSeconds) : 180,
      marketHoursOnly: req.body?.marketHoursOnly !== false,
      maxActionsPerDay: Math.max(1, Math.min(50, Number(req.body?.maxActionsPerDay) || 10)),
      maxBuysPerDay: Math.max(1, Math.min(50, Number(req.body?.maxBuysPerDay) || 10)),
      maxSellsPerDay: Math.max(1, Math.min(50, Number(req.body?.maxSellsPerDay) || 10)),
      maxDailyLossPct: Math.max(0.1, Math.min(20, Number(req.body?.maxDailyLossPct) || 3)),
      accountId,
      strategy: requestedStrategy,
      strategyId: requestedStrategy,
      conditions,
      logic: req.body?.logic === "OR" ? "OR" : (previous.logic || "AND"),
      market: ["all", "A股", "ETF"].includes(String(req.body?.market)) ? String(req.body.market) : (previous.market || "all"),
      watchlist: watchlist.length ? watchlist : (Array.isArray(previous.watchlist) ? previous.watchlist : [])
      ,rules: normalizePaperRules(req.body?.rules || previous.rules || {})
    };
    const accounts = { ...(current.paper?.accounts || {}), [String(accountId)]: next };
    fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
    fs.writeFileSync(runtimeConfigPath, `${JSON.stringify({ ...current, __exists: undefined, paper: { ...(current.paper || {}), accounts } }, null, 2)}\n`, "utf-8");
    restartPaperAutoLoop();
    res.json({ ok: true, message: next.enabled ? "当前账户自动模拟已开启，仅执行本地纸面交易" : "当前账户自动模拟已关闭", ...getPaperAutoStatus(accountId) });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});

app.get("/api/paper/strategies", (req, res) => {
  const runtime = getRuntimeConfig();
  const custom = runtime.paper?.strategies || {};
  res.json({ strategies: [...defaultPaperStrategies(), ...Object.values(custom)].map((item) => ({ ...item, rules: normalizePaperRules(item.rules || {}) })) });
});

app.get("/api/paper/strategy/:id", (req, res) => {
  const strategy = findPaperStrategy(req.params.id);
  if (!strategy) return res.status(404).json({ ok: false, message: "策略不存在" });
  res.json({ strategy });
});

app.post("/api/paper/strategy", (req, res) => {
  try {
    const strategy = normalizePaperStrategyInput(req.body || {});
    const runtime = getRuntimeConfig();
    const strategies = { ...(runtime.paper?.strategies || {}), [strategy.id]: strategy };
    writePaperRuntime({ ...runtime, paper: { ...(runtime.paper || {}), strategies } });
    res.json({ ok: true, strategy, message: "策略已保存" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});

app.put("/api/paper/strategy/:id", (req, res) => {
  try {
    const runtime = getRuntimeConfig();
    if (!runtime.paper?.strategies?.[req.params.id]) throw new Error("默认策略不可直接覆盖，请先复制为自定义策略");
    const strategy = normalizePaperStrategyInput({ ...(runtime.paper.strategies[req.params.id]), ...(req.body || {}), id: req.params.id });
    const strategies = { ...(runtime.paper.strategies || {}), [strategy.id]: strategy };
    writePaperRuntime({ ...runtime, paper: { ...(runtime.paper || {}), strategies } });
    res.json({ ok: true, strategy, message: "策略已更新" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});

app.post("/api/paper/strategy/:id/clone", (req, res) => {
  try {
    const source = findPaperStrategy(req.params.id);
    if (!source) throw new Error("原策略不存在");
    const strategy = normalizePaperStrategyInput({ ...source, id: `custom-${Date.now()}`, name: req.body?.name || `${source.name}（自定义）`, builtin: false });
    const runtime = getRuntimeConfig();
    const strategies = { ...(runtime.paper?.strategies || {}), [strategy.id]: strategy };
    writePaperRuntime({ ...runtime, paper: { ...(runtime.paper || {}), strategies } });
    res.json({ ok: true, strategy, message: "已复制为可编辑策略" });
  } catch (error) {
    res.status(400).json({ ok: false, message: String(error.message || error) });
  }
});

app.delete("/api/paper/strategy/:id", (req, res) => {
  const runtime = getRuntimeConfig();
  if (!runtime.paper?.strategies?.[req.params.id]) return res.status(400).json({ ok: false, message: "默认策略不可删除" });
  const strategies = { ...(runtime.paper.strategies || {}) };
  delete strategies[req.params.id];
  writePaperRuntime({ ...runtime, paper: { ...(runtime.paper || {}), strategies } });
  res.json({ ok: true, message: "自定义策略已删除" });
});

app.get("/api/paper/decisions", (req, res) => {
  const accountId = Number(req.query.accountId || 0);
  if (!accountId || !store.getPaperAccount(accountId, req.accessContext.ownerToken)) return res.status(404).json({ ok: false, message: "模拟账户不存在" });
  const status = getPaperAutoStatus(accountId);
  res.json({ ok: true, strategy: status.config.strategy, rules: status.config.rules, rows: status.runtime.lastDecisionRows || [], decisions: status.runtime.lastDecisions || [], updatedAt: status.runtime.lastRunAt || "" });
});

app.get("/api/paper/backtest", (req, res) => {
  const query = String(req.query.code || "").trim();
  const window = String(req.query.window || "month");
  const strategy = String(req.query.strategy || "trend");
  const stocks = store.getSnapshot("stocks", "stocks");
  const etfs = store.getSnapshot("etfs", "etfs");
  const item = findStockByQuery([...(stocks.stocks || []), ...(etfs.etfs || [])], query);
  if (!item) return res.status(404).json({ ok: false, message: "请输入有效股票或 ETF 代码/名称" });
  const historyWindow = ["year", "all"].includes(window) ? window : "all";
  const history = getStockHistory(item, historyWindow);
  const preset = findPaperStrategy(strategy) || defaultPaperStrategies()[0];
  const rules = normalizePaperRules(preset.rules || {});
  const result = runPaperHistoricalBacktest(history.points || [], rules);
  res.json({ ok: true, code: item.code, name: item.name, window: historyWindow, strategy: preset.name, source: history.source || "本地历史K线", ...result });
});
app.post("/api/data/backup", (_req, res) => {
  try {
    if (directorySizeBytes(dataDirPath) >= 30 * 1024 ** 3) {
      return res.status(409).json({ ok: false, message: "数据目录已超过 30 GB，已暂停创建新的完整备份；请先在设置页检查维护状态。" });
    }
    const backupDir = path.join(__dirname, "data", "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const filename = `market-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const filePath = path.join(backupDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(store.exportBackup(), null, 2), "utf-8");
    res.json({ ok: true, path: filePath, message: "行情、历史、筛选和预估记录已备份" });
  } catch (error) {
    res.status(500).json({ ok: false, message: String(error.message || error) });
  }
});

app.get("/api/mock/private-signal", (_req, res) => allowMockApi(_req, res, buildPrivateSignal()));
app.get("/api/mock/wechat-draft", (_req, res) => allowMockApi(_req, res, buildWechatDraft()));
app.get("/api/private-signal", (_req, res) => res.json(buildPrivateSignal()));
app.post("/api/ai/risk-radar", async (req, res) => {
  const rows = Array.isArray(req.body?.riskRadar) ? req.body.riskRadar.slice(0, 10) : [];
  const agnes = getAgnesConfig();
  if (!rows.length || !agnes.configured) {
    res.json({ ok: false, configured: agnes.configured, riskRadar: rows, message: agnes.configured ? "暂无风险项" : "Agnes未配置，使用本地规则" });
    return;
  }
  const prompt = {
    task: "优化风险雷达解释",
    rules: ["只能基于detail、evidence和level解释，不得新增数字、标的、来源或时间", "不得输出买入、卖出、目标价、收益承诺或确定性预测", "每条只返回topic、note、action，note解释为什么值得关注，action是数据核验动作，不是交易指令", "输出严格JSON数组，不要Markdown"],
    items: rows.map((row) => ({ topic: row.topic, category: row.category, level: row.level, title: row.title, detail: row.detail, evidence: row.evidence }))
  };
  const result = await callChatCompletion(agnes, [{ role: "system", content: "你是金融行情监控解释器。你不能创造行情数字，只能把已有证据解释得清楚、具体、克制。" }, { role: "user", content: JSON.stringify(prompt) }], { temperature: 0.1, timeoutMs: 30_000, maxTokens: 1200 });
  if (!result.ok) {
    res.json({ ok: false, configured: true, riskRadar: rows, message: result.error || "Agnes解释失败，使用本地规则" });
    return;
  }
  try {
    const jsonText = String(result.text).match(/\[[\s\S]*\]/)?.[0] || result.text;
    const items = JSON.parse(jsonText);
    const aiByTopic = new Map((Array.isArray(items) ? items : []).map((item) => [String(item.topic || ""), item]));
    res.json({ ok: true, configured: true, provider: agnes.provider || "Agnes", riskRadar: rows.map((row) => {
      const ai = aiByTopic.get(String(row.topic || ""));
      return ai ? { ...row, aiNote: String(ai.note || "").slice(0, 220), aiAction: String(ai.action || "").slice(0, 220) } : row;
    }) });
  } catch {
    res.json({ ok: false, configured: true, riskRadar: rows, message: "Agnes返回格式无法解析，使用本地规则" });
  }
});
app.get("/api/wechat/draft", async (req, res) => {
  const options = {
    session: String(req.query.session || "close"),
    articleType: String(req.query.articleType || ""),
    style: String(req.query.style || ""),
    modules: splitCsv(req.query.modules),
    keywords: String(req.query.keywords || ""),
    requirements: String(req.query.requirements || ""),
    generateImage: String(req.query.image || "") === "1"
  };
  const useAi = String(req.query.ai || "") === "1";
  res.json(useAi ? await generateWechatPackage(options) : buildWechatDraft(options));
});

app.get("/api/workflow/today", (_req, res) => {
  res.json(buildTodayWorkflow());
});

app.post("/api/workflow/generate", async (req, res) => {
  const options = normalizeWorkflowOptions(req.body || {});
  const publicDraft = await generateWechatPackage(options);
  const privateSignal = buildPrivateSignal(options);
  res.json({
    ok: true,
    session: options.session,
    articleType: options.articleType,
    style: options.style,
    modules: options.modules,
    publicDraft,
    privateSignal,
    ai: {
      textConfigured: getAiConfig().configured,
      agnesConfigured: getAgnesConfig().configured,
      imageConfigured: getImageAiConfig().configured,
      videoConfigured: getVideoAiConfig().configured,
      imagePrompt: publicDraft.imagePrompt,
      imageAsset: publicDraft.imageAsset || null,
      pipeline: publicDraft.aiPipeline || []
    }
  });
});

app.post("/api/wechat/review", (req, res) => {
  const text = String(req.body?.text || "");
  res.json(reviewDraftText(text));
});

app.post("/api/wechat/draft", (req, res) => {
  const markdown = String(req.body?.markdown || "");
  const saved = store.saveDraft({
    title: String(req.body?.title || extractTitle(markdown) || "今日市场观察"),
    topic: String(req.body?.topic || req.body?.articleType || "市场观察"),
    markdown,
    html: String(req.body?.html || markdownToHtml(markdown)),
    review: reviewDraftText(markdown),
    assetIds: req.body?.assetIds || [],
    source: String(req.body?.source || "公众号工作台")
  });
  res.json({ ok: true, draft: saved });
});

app.get("/api/wechat/drafts", (_req, res) => {
  res.json({ drafts: store.listDrafts() });
});

app.get("/api/wechat/drafts/:id", (req, res) => {
  const draft = store.getDraft(req.params.id);
  if (!draft) {
    res.status(404).json({ ok: false, message: "草稿不存在" });
    return;
  }
  const assets = (draft.assetIds || []).map((id) => store.listAssets().find((asset) => asset.id === Number(id))).filter(Boolean);
  res.json({ ok: true, draft, assets });
});

app.get("/api/assets", (_req, res) => {
  res.json({ assets: store.listAssets(), assetsDir: store.assetsDir });
});

app.post("/api/assets", (req, res) => {
  const asset = store.addAsset(req.body || {});
  res.json({ ok: true, asset });
});
app.post("/api/assets/upload", (req, res) => {
  const dataUrl = String(req.body?.dataUrl || "");
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) {
    res.status(400).json({ ok: false, message: "只支持 PNG、JPG 或 WebP 图片。" });
    return;
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    res.status(400).json({ ok: false, message: "图片为空或超过 8MB。" });
    return;
  }
  const extension = match[1].toLowerCase() === "jpeg" || match[1].toLowerCase() === "jpg" ? "jpg" : match[1].toLowerCase();
  const filename = `wechat-market-${Date.now()}.${extension}`;
  fs.writeFileSync(path.join(store.assetsDir, filename), buffer);
  const asset = store.addAsset({
    title: String(req.body?.title || "正文行情图"),
    type: "正文图",
    purpose: "公众号",
    source: String(req.body?.source || "本地真实行情"),
    local_path: `/assets/${filename}`,
    prompt: String(req.body?.prompt || "")
  });
  res.json({ ok: true, asset });
});
app.post("/api/ai/image/generate", async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) {
    res.json({ ok: false, message: "请先生成或填写配图提示词。" });
    return;
  }
  const result = await generateCoverImage(prompt, String(req.body?.title || "公众号封面"));
  res.json(result.ok ? { ok: true, asset: result.asset, provider: result.provider, message: "封面图已生成并登记素材库。" } : { ok: false, provider: result.provider, message: result.error || "封面图生成失败" });
});
app.post("/api/ai/video/generate", async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) {
    res.json({ ok: false, message: "请先填写视频提示词。" });
    return;
  }
  res.json(await generateVideoMaterial(prompt, req.body || {}));
});
app.post("/api/news", (req, res) => {
  const item = store.addNewsItem(req.body || {});
  res.json({ ok: true, item });
});

app.post("/api/ai/market-summary", async (_req, res) => {
  const context = buildMarketContext();
  const ai = getAiConfig();
  if (!ai.configured) {
    res.json({ source: "本地摘要", configured: false, summary: localSummary(context) });
    return;
  }
  try {
    const response = await fetch(`${ai.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ai.apiKey}`
      },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: "system", content: "你只基于用户提供的结构化行情数据做中文摘要。不要编造数字，不要给买入卖出建议，不要输出目标收益。" },
          { role: "user", content: JSON.stringify(context) }
        ],
        temperature: 0.2
      })
    });
    if (!response.ok) throw new Error(`${ai.provider} 请求失败: ${response.status}`);
    const data = await response.json();
    res.json({ source: ai.provider, configured: true, summary: data.choices?.[0]?.message?.content || "" });
  } catch (error) {
    res.json({ source: "本地摘要", configured: true, error: String(error.message || error), summary: localSummary(context) });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = Number(process.env.PORT || 5190);
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () => {
  console.log(`Komo Market Dashboard running at http://${host}:${port}`);
});

function shanghaiClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const hour = Number(get("hour") || 0);
  const minute = Number(get("minute") || 0);
  return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday"), hour, minute, total: hour * 60 + minute };
}

function ashareTradingSession(date = new Date()) {
  const clock = shanghaiClock(date);
  if (!isAshareMarketDay(date)) return { ...clock, code: "closed", label: "休市" };
  if (clock.total < 570) return { ...clock, code: "pre", label: "等待开盘" };
  if (clock.total < 690) return { ...clock, code: "morning", label: "上午盘" };
  if (clock.total < 780) return { ...clock, code: "break", label: "午间休市" };
  if (clock.total < 900) return { ...clock, code: "afternoon", label: "下午盘" };
  return { ...clock, code: "closed", label: "已收盘" };
}

function isAshareMarketDay(date = new Date()) {
  const clock = shanghaiClock(date);
  if (/Sat|Sun/i.test(clock.weekday)) return false;
  // Exchange holidays can be supplied without code changes, for example: 2026-10-01,2026-10-02.
  const closedDates = new Set(String(process.env.ASHARE_CLOSED_DATES || "").split(",").map((item) => item.trim()).filter(Boolean));
  return !closedDates.has(clock.dateKey);
}

function snapshotAgeSeconds(key) {
  const snapshot = store.getSnapshot(key, key === "markets" ? "markets" : key);
  const timestamp = new Date(snapshot.updatedAt || "").getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 1000)) : Infinity;
}

function isScopeDue(scope, intervalSeconds) {
  const last = Number(marketSchedulerRuntime.lastRunByScope[scope] || 0);
  return !last || Date.now() - last >= intervalSeconds * 1000;
}

function runtimeTimedOut(startedAtMs, timeoutMs) {
  return Number(startedAtMs) > 0 && Date.now() - Number(startedAtMs) > timeoutMs;
}

function withRuntimeTimeout(task, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超过 ${Math.round(timeoutMs / 1000)} 秒，已跳过本轮`)), timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function runMarketDataTick() {
  if (marketSchedulerRuntime.running) {
    if (!runtimeTimedOut(marketSchedulerRuntime.startedAtMs, MARKET_TICK_TIMEOUT_MS)) return;
    marketSchedulerRuntime.running = false;
    marketSchedulerRuntime.startedAtMs = 0;
    marketSchedulerRuntime.lastMessage = "上一轮行情同步超时，已自动恢复";
  }
  if (refreshRuntime.active) return;
  const session = ashareTradingSession();
  marketSchedulerRuntime.lastRunAt = now();
  if (!isAshareMarketDay()) {
    marketSchedulerRuntime.active = false;
    marketSchedulerRuntime.lastMessage = "非交易日不采集盘中行情";
    marketSchedulerRuntime.nextRunAt = nextAshareSessionAt();
    return;
  }
  if (!["morning", "afternoon"].includes(session.code)) {
    marketSchedulerRuntime.active = false;
    marketSchedulerRuntime.lastMessage = session.code === "break" ? "午间休市，13:00 恢复同步" : "等待下一个交易时段";
    marketSchedulerRuntime.nextRunAt = nextAshareSessionAt();
    return;
  }
  marketSchedulerRuntime.active = true;
  marketSchedulerRuntime.running = true;
  marketSchedulerRuntime.startedAtMs = Date.now();
  const runToken = randomUUID();
  marketSchedulerRuntime.runToken = runToken;
  marketSchedulerRuntime.nextRunAt = new Date(Date.now() + 60_000).toISOString();
  try {
    const dueScopes = [];
    if (isScopeDue("ashare", 60) || snapshotAgeSeconds("markets") > 75 || snapshotAgeSeconds("stocks") > 75) dueScopes.push("ashare");
    if (isScopeDue("etf", 180) || snapshotAgeSeconds("etfs") > 210) dueScopes.push("etf");
    if (isScopeDue("sector", 180)) dueScopes.push("sector");
    for (const scope of dueScopes) {
      marketSchedulerRuntime.lastMessage = `正在同步${scopeLabelForServer(scope)}`;
      const result = await refreshMarketData(scope);
      marketSchedulerRuntime.lastRunByScope[scope] = Date.now();
      marketSchedulerRuntime.lastMessage = result.ok ? `${scopeLabelForServer(scope)}已同步` : `${scopeLabelForServer(scope)}同步失败，保留最近数据`;
    }
    if (isScopeDue("news", 300)) {
      await refreshPublicNews();
      marketSchedulerRuntime.lastRunByScope.news = Date.now();
    }
  } finally {
    if (marketSchedulerRuntime.runToken === runToken) {
      marketSchedulerRuntime.running = false;
      marketSchedulerRuntime.startedAtMs = 0;
    }
  }
}

function startMarketDataScheduler() {
  if (marketSchedulerRuntime.timer) clearInterval(marketSchedulerRuntime.timer);
  marketSchedulerRuntime.timer = setInterval(() => { void runMarketDataTick(); }, 15_000);
  void runMarketDataTick();
  // Securities are a daily search directory, never a repeated intraday snapshot.
  if (isAshareMarketDay()) void ensureSecurityMaster();
}

function nextAshareSessionAt(date = new Date()) {
  const session = ashareTradingSession(date);
  if (session.code === "pre") return new Date(`${session.dateKey}T09:30:00+08:00`).toISOString();
  if (session.code === "break") return new Date(`${session.dateKey}T13:00:00+08:00`).toISOString();
  let cursor = new Date(`${session.dateKey}T12:00:00+08:00`);
  for (let offset = 1; offset <= 8; offset += 1) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    const next = shanghaiClock(cursor);
    if (isAshareMarketDay(cursor)) return new Date(`${next.dateKey}T09:30:00+08:00`).toISOString();
  }
  return new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
}

function isAshareTradingTime(date = new Date()) {
  return ["morning", "afternoon"].includes(ashareTradingSession(date).code);
}

function shanghaiDateKey(value = new Date()) {
  const text = typeof value === "string" ? value : "";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : value;
  const date = value instanceof Date ? value : new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function paperTodayMetrics(accountId, equity) {
  const today = shanghaiDateKey();
  const rows = store.listPaperEquity(accountId, 2000).filter((row) => shanghaiDateKey(row.created_at) === today).sort((a, b) => Number(a.id) - Number(b.id));
  const baseline = Number(rows[0]?.equity);
  if (!Number.isFinite(baseline) || baseline <= 0) return { today_pnl: null, today_return_pct: null, today_baseline: null, today_equity_points: 0 };
  const todayPnl = Number(equity) - baseline;
  return { today_pnl: todayPnl, today_return_pct: (todayPnl / baseline) * 100, today_baseline: baseline, today_equity_points: rows.length };
}

function todayOrderCount(accountId, side = null) {
  const today = shanghaiDateKey();
  return store.listPaperOrders(accountId, 500).filter((item) => shanghaiDateKey(item.created_at) === today && (!side || item.side === side)).length;
}

function paperAutoLossExceeded(account, limitPct) {
  const today = shanghaiDateKey();
  const rows = store.listPaperEquity(account.id, 2000).filter((item) => shanghaiDateKey(item.created_at) === today);
  if (!rows.length) return false;
  const baseline = Number(rows[0].equity);
  const latest = Number(rows.at(-1).equity);
  return baseline > 0 && ((latest - baseline) / baseline) * 100 <= -Math.abs(limitPct);
}

function normalizePaperAutoConfig(config = {}, accountId = null) {
  const strategyId = String(config.strategyId || config.strategy || "trend");
  const selectedStrategy = findPaperStrategy(strategyId);
  const strategyDefaults = selectedStrategy?.rules || {};
  const savedRules = config.rules || {};
  const restoreBuiltinMode = Boolean(selectedStrategy?.builtin) && savedRules.signalMode === "momentum" && strategyDefaults.signalMode !== "momentum";
  return {
    enabled: Boolean(config.enabled),
    intervalSeconds: [60, 180, 300].includes(Number(config.intervalSeconds)) ? Number(config.intervalSeconds) : 180,
    marketHoursOnly: config.marketHoursOnly !== false,
    maxActionsPerDay: Math.max(1, Number(config.maxActionsPerDay) || 10),
    maxBuysPerDay: Math.max(1, Number(config.maxBuysPerDay || 10)),
    maxSellsPerDay: Math.max(1, Number(config.maxSellsPerDay || 10)),
    maxDailyLossPct: Math.max(0.1, Number(config.maxDailyLossPct) || 3),
    accountId: Number(accountId || config.accountId) || null,
    strategy: strategyId,
    strategyId,
    conditions: Array.isArray(config.conditions) ? config.conditions : [],
    logic: config.logic === "OR" ? "OR" : "AND",
    market: ["all", "A股", "ETF"].includes(String(config.market)) ? String(config.market) : "all",
    accountRole: ["short_term", "trend", "long_term", "etf_rotation", "etf_defense", "archived"].includes(String(config.accountRole)) ? String(config.accountRole) : "trend",
    watchlist: Array.isArray(config.watchlist) ? config.watchlist : [],
    rules: normalizePaperRules({ ...strategyDefaults, ...savedRules, ...(restoreBuiltinMode ? { signalMode: strategyDefaults.signalMode } : {}) })
  };
}

function migratePaperAutoRulesV7() {
  const runtime = getRuntimeConfig();
  const paper = runtime.paper || {};
  if (!runtime.__exists || Number(paper.strategyRuleVersion || 0) >= 7 || !paper.accounts) return;
  const accounts = { ...paper.accounts };
  let changed = false;
  for (const [accountId, config] of Object.entries(accounts)) {
    const strategyId = String(config?.strategyId || config?.strategy || "trend");
    const preset = defaultPaperStrategies().find((item) => item.id === strategyId);
    if (!preset) continue;
    const currentRules = { ...(config?.rules || {}) };
    const nextRules = { ...currentRules };
    if (!nextRules.signalMode || (nextRules.signalMode === "momentum" && preset.rules.signalMode !== "momentum")) nextRules.signalMode = preset.rules.signalMode;
    if (Number(nextRules.minScore || 0) <= 0 && Number(preset.rules.minScore || 0) > 0) nextRules.minScore = preset.rules.minScore;
    // 长周期均线只保留为研究参考，不再作为自动模拟的硬性开仓门槛。
    if (nextRules.requireLongTrend !== false) nextRules.requireLongTrend = false;
    // 日K指标统一截至昨日；盘中判断另行使用真实实时行情，避免未收盘日K干扰信号。
    if (nextRules.usePreviousDailyBar !== true) nextRules.usePreviousDailyBar = true;
    if (JSON.stringify(nextRules) !== JSON.stringify(currentRules)) {
      accounts[accountId] = { ...config, rules: nextRules };
      changed = true;
    }
  }
  writePaperRuntime({ ...runtime, paper: { ...paper, accounts, strategyRuleVersion: 7 } });
}

function getPaperAutoConfig(accountId = null) {
  const paper = getRuntimeConfig().paper || {};
  const accounts = paper.accounts || {};
  const decorate = (config, id) => ({ ...normalizePaperAutoConfig(config, id), sameDaySellAllowed: String(paper.t1BypassDate || "") === shanghaiDateKey() });
  if (accountId && accounts[String(accountId)]) return decorate(accounts[String(accountId)], accountId);
  if (paper.accountId) return decorate(paper, paper.accountId);
  return decorate({}, accountId);
}

function listPaperAutoConfigs() {
  const paper = getRuntimeConfig().paper || {};
  const accounts = paper.accounts || {};
  const rows = Object.keys(accounts).map((accountId) => getPaperAutoConfig(accountId));
  if (!rows.length && paper.accountId) rows.push(getPaperAutoConfig(paper.accountId));
  return rows.filter((config) => config.accountId && config.enabled);
}

function getPaperAutoStatus(accountId = null) {
  const config = getPaperAutoConfig(accountId);
  const session = ashareTradingSession();
  const runtime = paperAutoRuntime.accounts[String(config.accountId)] || { active: false, running: false, lastRunAt: "", nextRunAt: "", lastMessage: "自动模拟交易默认关闭", lastActions: 0, lastDecisionRows: [], lastDecisions: [], sessionLabel: session.label, dataHealth: paperDataHealth(config) };
  runtime.sessionLabel = session.label;
  runtime.dataHealth = paperDataHealth(config);
  return { config, runtime, tradingTime: isAshareTradingTime(), activeAccounts: listPaperAutoConfigs().map((item) => item.accountId) };
}

function restartPaperAutoLoop() {
  if (paperAutoRuntime.timer) clearInterval(paperAutoRuntime.timer);
  paperAutoRuntime.timer = null;
  paperAutoRuntime.active = false;
  paperAutoRuntime.accounts = {};
  paperSignalRuntime.clear();
  const configs = listPaperAutoConfigs();
  if (!configs.length) {
    return;
  }
  paperAutoRuntime.active = true;
  paperAutoRuntime.timer = setInterval(runPaperAutoTick, 30_000);
  // Let the HTTP server become responsive before the first synchronous strategy scan.
  setTimeout(() => { void runPaperAutoTick(); }, 10_000);
}

function startPaperAutoLoop() {
  restartPaperAutoLoop();
}

async function runPaperAutoTick() {
  if (paperAutoRuntime.running) {
    if (!runtimeTimedOut(paperAutoRuntime.startedAtMs, PAPER_TICK_TIMEOUT_MS)) return;
    paperAutoRuntime.running = false;
    paperAutoRuntime.startedAtMs = 0;
    paperAutoRuntime.runToken = "";
    for (const runtime of Object.values(paperAutoRuntime.accounts)) {
      if (runtime.running) {
        runtime.running = false;
        runtime.lastActions = 0;
        runtime.lastMessage = "上一轮策略扫描超时，已自动恢复";
        runtime.lastDecisions = [runtime.lastMessage];
        runtime.nextRunAt = new Date().toISOString();
      }
    }
  }
  if (fs.existsSync(maintenanceLockPath)) return;
  paperAutoRuntime.running = true;
  paperAutoRuntime.startedAtMs = Date.now();
  const runToken = randomUUID();
  paperAutoRuntime.runToken = runToken;
  try {
    const configs = listPaperAutoConfigs();
    for (const config of configs) {
      try {
        await withRuntimeTimeout(() => runPaperAutoAccount(config), PAPER_ACCOUNT_TIMEOUT_MS, `${config.accountId} 账户策略扫描`);
      } catch (error) {
        const runtime = paperAutoRuntime.accounts[String(config.accountId)] || (paperAutoRuntime.accounts[String(config.accountId)] = {});
        runtime.running = false;
        runtime.lastActions = 0;
        runtime.lastMessage = String(error.message || error);
        runtime.lastDecisions = [runtime.lastMessage];
        runtime.nextRunAt = new Date(Date.now() + config.intervalSeconds * 1000).toISOString();
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    if (paperAutoRuntime.runToken === runToken) {
      paperAutoRuntime.running = false;
      paperAutoRuntime.startedAtMs = 0;
    }
  }
}

function paperUniverse(stocks, etfs) {
  return [
    ...(stocks.stocks || []).map((item) => ({ ...item, market: "A股" })),
    ...(etfs.etfs || []).map((item) => ({ ...item, market: "ETF" }))
  ];
}

function matchesPaperWatchlist(item, watchlist = []) {
  return watchlist.some((key) => normalizeLookupText(item.code).includes(key) || normalizeLookupText(item.name).includes(key));
}

function buildPaperFocusUniverse(account, config, stocks, etfs) {
  const universe = paperUniverse(stocks, etfs);
  const selectedStrategy = findPaperStrategy(config.strategy || "trend");
  const strategyKey = selectedStrategy && !selectedStrategy.builtin ? "custom" : (config.strategy || "trend");
  const strategy = paperStrategyConfig(strategyKey, config.conditions || selectedStrategy?.conditions || [], config.logic || selectedStrategy?.logic || "AND", config.market || selectedStrategy?.market || "all", config.rules || selectedStrategy?.rules || {});
  const watchlist = (config.watchlist || []).map((item) => normalizeLookupText(item)).filter(Boolean);
  const existing = store.listPaperPositions(account.id);
  const focused = new Map();
  const add = (item) => {
    if (item?.code) focused.set(String(item.code), item);
  };

  for (const position of existing) {
    add(universe.find((item) => item.code === position.code) || store.getSecurityByQuery(position.code) || { ...position });
  }
  for (const target of config.watchlist || []) {
    add(universe.find((item) => normalizeLookupText(item.code) === normalizeLookupText(target) || normalizeLookupText(item.name) === normalizeLookupText(target)) || store.getSecurityByQuery(target));
  }

  const recentOrders = store.listPaperOrders(account.id, 500);
  const recentlyTraded = new Set(recentOrders
    .filter((order) => Date.now() - new Date(String(order.created_at || "").replace(" ", "T") + "Z").getTime() < 2 * 86400000)
    .map((order) => String(order.code)));
  const roughCandidates = universe
    .filter((item) => !paperRiskName(item))
    .filter((item) => strategy.market === "all" || item.market === strategy.market)
    .filter((item) => !watchlist.length || matchesPaperWatchlist(item, watchlist))
    .filter((item) => strategy.name !== "自定义策略" || !strategy.conditions?.length || matchesConditions(item, strategy.conditions, strategy.logic))
    .filter((item) => strategy.name === "自定义策略" || (
      Number.isFinite(Number(item.change_pct)) && Number(item.change_pct) >= strategy.minChange && Number(item.change_pct) <= strategy.maxChange
      && Number.isFinite(Number(item.volume_ratio)) && Number(item.volume_ratio) >= strategy.minVolume
      && (!Number(strategy.minAmount) || Number(item.amount) >= strategy.minAmount)
      && (!Number.isFinite(strategy.minTurnover) || Number(item.turnover_rate) >= strategy.minTurnover)
      && (!Number.isFinite(strategy.maxTurnover) || Number(item.turnover_rate) <= strategy.maxTurnover)
    ))
    .map((item) => ({ ...item, paper_focus_score: paperFocusScore(item, strategy, recentlyTraded) }))
    .sort((a, b) => Number(b.paper_focus_score || 0) - Number(a.paper_focus_score || 0))
    .slice(0, 40);
  diversifyPaperCandidates(roughCandidates, 40).forEach(add);
  return [...focused.values()].slice(0, 60);
}

function paperCandidateTheme(item = {}) {
  const text = String(item.name || "").replace(/ETF|LOF|联接|基金|华夏|易方达|嘉实|南方|广发|国泰|华泰柏瑞|银华|汇添富|富国|博时|工银|招商|鹏华|华宝|国联安|永赢|景顺长城/gi, "");
  const themes = ["半导体", "芯片", "人工智能", "算力", "通信", "5G", "创新药", "医疗", "证券", "银行", "消费", "新能源", "光伏", "锂电", "有色", "黄金", "军工", "红利", "央企", "港股", "科创", "创业板", "中证1000", "中证500", "沪深300", "A500", "机器人", "软件", "互联网", "游戏", "农业", "房地产", "汽车"];
  const hit = themes.find((theme) => text.includes(theme));
  if (hit) return hit;
  const code = String(item.code || "").toLowerCase();
  if (item.market === "ETF") return `ETF:${text.replace(/[^\u4e00-\u9fa5a-z0-9]/gi, "").slice(0, 12) || code}`;
  if (code.includes(".688")) return "科创板";
  if (code.includes(".300") || code.includes(".301")) return "创业板";
  return `A股:${code.slice(0, 5) || text.slice(0, 8)}`;
}

function paperFocusScore(item, strategy, recentlyTraded = new Set()) {
  const amount = Math.max(0, Number(item.amount || 0));
  const volume = Math.max(0, Number(item.volume_ratio || 0));
  const turnover = Math.max(0, Number(item.turnover_rate || 0));
  const change = Number(item.change_pct || 0);
  const liquidity = Math.min(35, Math.log10(amount + 1) * 4) + Math.min(18, volume * 5) + Math.min(12, turnover * 0.8);
  const move = strategy.signalMode === "reversal" ? Math.max(0, 5 - Math.abs(change + 2)) * 4 : Math.max(0, 8 - Math.abs(change - Math.max(0.3, Number(strategy.minChange || 0)))) * 3;
  const recentPenalty = recentlyTraded.has(String(item.code)) ? 25 : 0;
  return liquidity + move - recentPenalty;
}

function diversifyPaperCandidates(rows = [], limit = 40) {
  const counts = new Map();
  const output = [];
  for (const row of rows) {
    const theme = paperCandidateTheme(row);
    const cap = row.market === "ETF" ? 1 : 2;
    if ((counts.get(theme) || 0) >= cap) continue;
    counts.set(theme, (counts.get(theme) || 0) + 1);
    output.push({ ...row, paper_theme: theme });
    if (output.length >= limit) break;
  }
  return output;
}

function paperOwnerPortfolio(account, quoteMap = new Map()) {
  const codeCounts = new Map();
  const themeCounts = new Map();
  if (!account?.owner_token) return { codeCounts, themeCounts };
  for (const sibling of store.listPaperAccounts(account.owner_token)) {
    for (const position of store.listPaperPositions(sibling.id)) {
      const quote = quoteMap.get(position.code);
      const security = quote || store.getSecurityByQuery(position.code) || position;
      const theme = paperCandidateTheme({ ...security, market: position.market || security.market });
      codeCounts.set(position.code, (codeCounts.get(position.code) || 0) + 1);
      themeCounts.set(theme, (themeCounts.get(theme) || 0) + 1);
    }
  }
  return { codeCounts, themeCounts };
}

function getPaperPortfolioOverview(ownerToken) {
  const accounts = store.listPaperAccounts(ownerToken);
  const stocks = store.getSnapshot("stocks", "stocks");
  const etfs = store.getSnapshot("etfs", "etfs");
  const quoteMap = paperQuoteMap(stocks, etfs);
  mergeLivePaperQuotes(quoteMap);
  const codeGroups = new Map();
  const themeGroups = new Map();
  let cash = 0;
  let marketValue = 0;
  for (const account of accounts) {
    cash += Number(account.cash || 0);
    for (const position of store.listPaperPositions(account.id)) {
      const quote = quoteMap.get(position.code) || position;
      const price = Number(quote.price || position.last_price || position.avg_cost || 0);
      marketValue += Number(position.quantity || 0) * price;
      const detail = { accountId: account.id, account: account.name, code: position.code, name: position.name, market: position.market };
      const theme = paperCandidateTheme({ ...position, ...quote });
      if (!codeGroups.has(position.code)) codeGroups.set(position.code, []);
      codeGroups.get(position.code).push(detail);
      if (!themeGroups.has(theme)) themeGroups.set(theme, []);
      themeGroups.get(theme).push(detail);
    }
  }
  const duplicatedCodes = [...codeGroups.entries()].filter(([, rows]) => rows.length > 1).map(([code, rows]) => ({ code, name: rows[0]?.name || code, count: rows.length, accounts: rows.map((row) => row.account) })).slice(0, 8);
  const concentratedThemes = [...themeGroups.entries()].filter(([, rows]) => rows.length > 2).map(([theme, rows]) => ({ theme, count: rows.length, accounts: [...new Set(rows.map((row) => row.account))] })).slice(0, 8);
  return {
    accountCount: accounts.length,
    totalEquity: cash + marketValue,
    cash,
    marketValue,
    duplicatedCodes,
    concentratedThemes,
    updatedAt: new Date().toISOString()
  };
}

function adjustPaperOwnerPortfolio(portfolio, item, delta) {
  if (!portfolio || !item?.code) return;
  const code = String(item.code);
  const theme = item.paper_theme || paperCandidateTheme(item);
  const adjust = (map, key) => {
    const next = Math.max(0, Number(map.get(key) || 0) + delta);
    if (next) map.set(key, next); else map.delete(key);
  };
  adjust(portfolio.codeCounts, code);
  adjust(portfolio.themeCounts, theme);
}

function paperCandidateStrength(item = {}, config = {}) {
  const signal = Number(item.signal_score || 0);
  const change = Math.max(-5, Math.min(8, Number(item.change_pct || 0)));
  const volume = Math.max(0, Math.min(4, Number(item.volume_ratio || 0)));
  const amount = Math.max(0, Number(item.amount || 0));
  const liquidity = Math.min(12, Math.log10(amount + 1) - 5);
  return signal + change * 1.2 + volume * 2 + liquidity;
}

function paperPositionStrength(position = {}, quote = {}, config = {}) {
  const price = Number(quote?.price || position.last_price || position.avg_cost);
  const cost = Number(position.avg_cost || 0);
  const high = Math.max(Number(position.high_price || 0), price, cost);
  const change = Math.max(-7, Math.min(7, Number(quote?.change_pct || 0)));
  const returnPct = cost > 0 && price > 0 ? (price / cost - 1) * 100 : 0;
  const drawdown = high > 0 && price > 0 ? (price / high - 1) * 100 : 0;
  const indicators = getPaperIndicators({ ...position, ...quote }, config);
  let score = 50 + change * 1.3 + Math.max(-12, Math.min(12, returnPct)) * 0.8 + Math.max(-10, drawdown) * 0.6;
  if (indicators.available) {
    score += indicators.ma5AboveMa20 ? 10 : -12;
    score += indicators.ma20AboveMa60 === true ? 6 : 0;
    if (Number.isFinite(indicators.rsi14) && indicators.rsi14 >= 78) score -= 4;
  }
  return Number(score.toFixed(1));
}

function findPaperReplacement(account, positions, candidate, quoteMap, config, options = {}) {
  if (!config.allowReplacement || !positions.length) return null;
  const candidateStrength = paperCandidateStrength(candidate, config);
  const sellablePositions = positions.map((position) => {
    const sellable = options.sameDaySellAllowed ? Number(position.quantity) : store.getPaperSellableQuantity(account.id, position.code);
    return { position, sellable, strength: paperPositionStrength(position, quoteMap.get(position.code), config) };
  }).filter((item) => item.sellable >= Number(item.position.quantity) && !options.protectedCodes?.has(String(item.position.code))).sort((a, b) => a.strength - b.strength);
  const weakest = sellablePositions[0];
  if (!weakest) return { blocked: "T+1限制：现有持仓今日均不可卖，暂不换仓" };
  const gap = candidateStrength - weakest.strength;
  if (gap < config.replacementScoreGap) return { blocked: `候选强度不足换仓：${candidateStrength.toFixed(1)} 对 ${weakest.strength.toFixed(1)}，需至少高 ${config.replacementScoreGap}` };
  return { ...weakest, candidateStrength, gap };
}

function paperEntryPhase(date = new Date()) {
  const minutes = shanghaiClock(date).total;
  if (minutes < 9 * 60 + 45) return { allowBuy: false, label: "09:30-09:45 开盘观察，只处理持仓风险" };
  if (minutes < 11 * 60 + 20) return { allowBuy: true, label: "上午确认交易段" };
  if (minutes < 13 * 60 + 20) return { allowBuy: false, label: "午间及午后前20分钟确认，不开新仓" };
  if (minutes < 14 * 60 + 40) return { allowBuy: true, label: "午后确认交易段" };
  return { allowBuy: false, label: "14:40 后不再新开短线仓，仅处理风险" };
}

function paperEntryConfirmation(accountId, item, phase, passed) {
  const key = `${accountId}:${item.code}`;
  if (!passed || !phase.allowBuy) {
    paperSignalRuntime.delete(key);
    return { confirmed: false, count: 0 };
  }
  const previous = paperSignalRuntime.get(key);
  const nowMs = Date.now();
  const samePhase = previous?.phase === phase.label;
  const consecutive = samePhase && nowMs - Number(previous.at || 0) <= 10 * 60 * 1000 ? Number(previous.count || 0) + 1 : 1;
  paperSignalRuntime.set(key, { at: nowMs, phase: phase.label, count: consecutive });
  return { confirmed: consecutive >= 2, count: consecutive };
}

function applyPaperFreshQuotes(focusRows = [], quotes = []) {
  const byCode = new Map((quotes || []).filter((item) => item?.code).map((item) => [String(item.code), item]));
  return (focusRows || []).map((item) => {
    const quote = byCode.get(String(item.code));
    return quote ? { ...item, ...quote, market: item.market || "A股" } : null;
  }).filter(Boolean);
}

function queuePaperHistoryWarmup(rows = []) {
  const nowMs = Date.now();
  const pendingCount = paperHistoryWarmupRuntime.pending.size;
  const slots = Math.max(0, 3 - pendingCount);
  if (!slots) return;
  const missing = (rows || []).filter((item) => {
    if (!item?.code || paperHistoryWarmupRuntime.pending.has(String(item.code))) return false;
    const previous = paperHistoryWarmupRuntime.attemptedAt.get(String(item.code)) || { at: 0, outcome: "" };
    const lastAttempt = Number(typeof previous === "number" ? previous : previous.at || 0);
    const outcome = typeof previous === "object" ? String(previous.outcome || "") : "";
    const retryDelay = outcome === "empty" ? 2 * 60 * 60 * 1000 : outcome === "error" ? 10 * 60 * 1000 : 60 * 60 * 1000;
    if (nowMs - lastAttempt < retryDelay) return false;
    const indicators = getPaperIndicators(item, { usePreviousDailyBar: true });
    return !indicators.available || indicators.points < PAPER_HISTORY_READY_POINTS;
  }).slice(0, slots);
  for (const item of missing) {
    const code = String(item.code);
    paperHistoryWarmupRuntime.attemptedAt.set(code, { at: nowMs, outcome: "pending" });
    const task = refreshStockHistory(code)
      .then((payload) => {
        const rowCount = Number(payload?.history?.length || 0);
        paperHistoryWarmupRuntime.attemptedAt.set(code, { at: Date.now(), outcome: rowCount ? "loaded" : "empty" });
        paperHistoryWarmupRuntime.outcomes.set(code, { at: now(), outcome: rowCount ? "loaded" : "empty", rows: rowCount, source: payload?.sources?.history || "暂无历史数据" });
        return payload;
      })
      .catch((error) => {
        paperHistoryWarmupRuntime.attemptedAt.set(code, { at: Date.now(), outcome: "error" });
        paperHistoryWarmupRuntime.outcomes.set(code, { at: now(), outcome: "error", message: String(error.message || error).slice(0, 160) });
        return null;
      })
      .finally(() => {
        paperHistoryWarmupRuntime.pending.delete(code);
        paperIndicatorCache.delete(code);
        paperIndicatorCache.delete(`${code}:previous`);
      });
    paperHistoryWarmupRuntime.pending.set(code, task);
  }
}

async function runPaperAutoAccount(config) {
  const key = String(config.accountId);
  const runtime = paperAutoRuntime.accounts[key] || (paperAutoRuntime.accounts[key] = { active: true, running: false, lastRunAt: "", nextRunAt: "", lastMessage: "等待自动扫描", lastActions: 0, lastDecisionRows: [], lastDecisions: [], sessionLabel: "等待时段", dataHealth: null });
  const nowMs = Date.now();
  if (runtime.nextRunAt && nowMs < new Date(runtime.nextRunAt).getTime()) return;
  const session = ashareTradingSession();
  runtime.sessionLabel = session.label;
  runtime.dataHealth = paperDataHealth(config);
  if (config.marketHoursOnly && !["morning", "afternoon"].includes(session.code)) {
    runtime.lastMessage = session.code === "break" ? "午休暂停，13:00 恢复扫描" : "等待下一个 A 股交易时段";
    runtime.lastDecisions = [runtime.lastMessage];
    runtime.nextRunAt = nextAshareSessionAt();
    return;
  }
  const account = store.getPaperAccount(config.accountId, null);
  if (!account) { runtime.lastMessage = "自动策略等待有效模拟账户"; runtime.lastDecisions = [runtime.lastMessage]; return; }
  if (hasStalePaperData(config)) {
    const staleFeeds = (runtime.dataHealth?.feeds || []).filter((item) => item.status !== "fresh").map((item) => item.label).join("、");
    runtime.lastMessage = `行情不新鲜：${staleFeeds || "所需数据"}超过 5 分钟或已回退，本轮跳过`;
    runtime.lastDecisionRows = [];
    runtime.lastDecisions = [runtime.lastMessage];
    runtime.nextRunAt = new Date(Date.now() + config.intervalSeconds * 1000).toISOString();
    return;
  }
  // 每个账户每天第一次自动检查先落一条权益基线，避免把历史累计浮亏算成当日亏损。
  buildPaperStatus(account, true);
  const buyCount = todayOrderCount(account.id, "BUY");
  const sellCount = todayOrderCount(account.id, "SELL");
  if (buyCount + sellCount >= config.maxActionsPerDay) { runtime.lastMessage = `已达到今日总操作上限 ${config.maxActionsPerDay} 笔（买 ${buyCount}/${config.maxBuysPerDay} · 卖 ${sellCount}/${config.maxSellsPerDay}）`; runtime.lastDecisions = [runtime.lastMessage]; return; }
  if (buyCount >= config.maxBuysPerDay && sellCount >= config.maxSellsPerDay) { runtime.lastMessage = `已达到今日买卖上限（买 ${buyCount} 笔 · 卖 ${sellCount} 笔）`; runtime.lastDecisions = [runtime.lastMessage]; return; }
  if (paperAutoLossExceeded(account, config.maxDailyLossPct)) { runtime.lastMessage = `已触发单日亏损 ${config.maxDailyLossPct}% 熔断`; runtime.lastDecisions = [runtime.lastMessage]; return; }
  runtime.running = true;
  runtime.lastRunAt = new Date().toISOString();
  try {
    const stocks = store.getSnapshot("stocks", "stocks");
    const etfs = store.getSnapshot("etfs", "etfs");
    if (stocks.status === "fallback" || etfs.status === "fallback") throw new Error("真实 A股/ETF 数据不可用，自动策略已跳过");
    const focusRows = buildPaperFocusUniverse(account, config, stocks, etfs);
    if (!focusRows.length) {
      runtime.lastActions = 0;
      runtime.lastDecisionRows = [];
      runtime.lastDecisions = ["粗筛后没有符合范围和流动性条件的标的"];
      runtime.lastMessage = "本轮粗筛无候选，保持原持仓";
      return;
    }
    const quotes = await refreshSecurityQuotes(focusRows.map((item) => item.code));
    const freshRows = applyPaperFreshQuotes(focusRows, quotes);
    if (!freshRows.length) throw new Error("候选按需行情获取失败，自动策略已跳过");
    queuePaperHistoryWarmup(freshRows);
    const focusedStocks = { ...stocks, stocks: freshRows.filter((item) => item.market !== "ETF"), source: "Futu OpenD候选实时行情" };
    const focusedEtfs = { ...etfs, etfs: freshRows.filter((item) => item.market === "ETF"), source: "Futu OpenD候选实时行情" };
    const result = runPaperStrategy(account, focusedStocks, focusedEtfs, { strategy: config.strategy, conditions: config.conditions, logic: config.logic, market: config.market, accountRole: config.accountRole, watchlist: config.watchlist, rules: config.rules, maxActionsPerDay: config.maxActionsPerDay, maxBuysPerDay: config.maxBuysPerDay, maxSellsPerDay: config.maxSellsPerDay, observationLimit: 40, auto: true, sameDaySellAllowed: config.sameDaySellAllowed });
    runtime.lastActions = result.actions?.length || 0;
    runtime.lastDecisionRows = result.decisionRows || [];
    runtime.lastDecisions = result.decisions || [];
    runtime.candidateCount = focusRows.length;
    runtime.quoteCount = freshRows.length;
    runtime.lastMessage = result.actions?.length ? `候选 ${freshRows.length} 条，完成 ${result.actions.length} 笔模拟操作` : `候选 ${freshRows.length} 条，${result.decisions?.[0] || "本轮无触发，保持原持仓"}`;
  } catch (error) {
    runtime.lastActions = 0;
    runtime.lastMessage = String(error.message || error);
  } finally {
    runtime.running = false;
    runtime.nextRunAt = new Date(Date.now() + config.intervalSeconds * 1000).toISOString();
  }
}

function decorateSectorRows(rows = []) {
  return rows.map((item) => {
    const change = Number(item.change_pct);
    const inflow = Number(item.net_inflow);
    const amount = Number(item.amount);
    const heat = Number(item.heat_score);
    return {
      ...item,
      type: item.type || "industry",
      change_pct: Number.isFinite(change) ? change : null,
      net_inflow: Number.isFinite(inflow) ? inflow : null,
      amount: Number.isFinite(amount) ? amount : null,
      heat_score: Number.isFinite(heat) ? Number(heat.toFixed(2)) : null,
      data_quality: item.data_quality || (Number.isFinite(amount) || Number.isFinite(inflow) ? "partial" : "missing")
    };
  });
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((item) => item[key]).filter(Boolean))].sort();
}

function normalizeNewsPayload(body) {
  const title = String(body.title || "").trim();
  const summary = String(body.summary || body.content || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const text = `${title} ${summary}`;
  const eventTags = [...new Set([
    ...(Array.isArray(body.event_tags) ? body.event_tags : []),
    /政策|监管|会议|发布/.test(text) ? "政策" : "",
    /资金|净流入|成交额|流动性/.test(text) ? "资金" : "",
    /公告|业绩|回购|增持/.test(text) ? "公告" : "",
    /海外|美联储|地缘|战争|原油|黄金|汇率/.test(text) ? "海外事件" : "",
    /ETF|基金/.test(text) ? "基金/ETF" : "",
    /风险|下调|预警|暴雨|地震|事故|制裁|冲突|停产/.test(text) ? "风险事件" : ""
  ].filter(Boolean))];
  const importance = body.importance || (eventTags.some((tag) => ["政策", "海外事件", "风险事件", "公告"].includes(tag)) ? "重要" : "普通");
  return { ...body, title, summary, region: body.region || "中国", market: body.market || "A股", event_tags: eventTags, importance };
}

function stripNewsHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&emsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyNewsMarket(text) {
  if (/美股|美联储|纳斯达克|标普|道琼斯/.test(text)) return "美股";
  if (/港股|恒生/.test(text)) return "港股";
  if (/ETF|基金/.test(text)) return "ETF";
  if (/原油|黄金|美元|汇率|期货/.test(text)) return "商品/汇率";
  if (/政策|监管|国务院|证监会|央行/.test(text)) return "宏观政策";
  return "A股";
}

function sourceNewsRecord(row, source) {
  const raw = stripNewsHtml(row.rich_text || row.title || row.summary || "");
  const bracketHeadline = raw.match(/^【([^】]{4,80})】/)?.[1] || "";
  const title = stripNewsHtml(row.title || bracketHeadline || raw.slice(0, 58)).slice(0, 100);
  const summary = stripNewsHtml(row.summary || raw || row.content).slice(0, 500);
  const text = `${title} ${summary}`;
  return normalizeNewsPayload({
    title,
    summary,
    url: String(row.url || row.docurl || "").trim(),
    source,
    category: "公开快讯",
    published_at: String(row.published_at || row.showTime || row.create_time || row.update_time || "").trim(),
    region: /美股|美联储|海外|国际|地缘/.test(text) ? "海外" : "中国",
    market: classifyNewsMarket(text),
    material_status: "已采集"
  });
}

async function fetchPublicJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 KomoMarketDashboard/1.0", ...headers },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchSinaNews() {
  const payload = await fetchPublicJson("https://zhibo.sina.com.cn/api/zhibo/feed?zhibo_id=152&page_size=40&dire=f", { Referer: "https://finance.sina.com.cn/" });
  const rows = payload?.result?.data?.feed?.list || [];
  return rows.map((row) => sourceNewsRecord(row, "新浪财经7x24")).filter((row) => row.title);
}

async function fetchEastmoneyNews() {
  const url = "https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?column=345&client=web&biz=web_news_col&page_index=1&page_size=40&sortStart=0&sortEnd=0&req_trace=komo";
  const payload = await fetchPublicJson(url, { Referer: "https://finance.eastmoney.com/" });
  const rows = payload?.data?.list || [];
  return rows.map((row) => sourceNewsRecord(row, row.mediaName || "东方财富资讯")).filter((row) => row.title);
}

async function refreshPublicNews() {
  if (newsRuntime.active) return { ok: false, busy: true, message: "资讯刷新正在进行，请稍候", ...newsRuntime.lastResult };
  newsRuntime.active = true;
  const startedAt = now();
  try {
    const settled = await Promise.allSettled([fetchSinaNews(), fetchEastmoneyNews()]);
    const sourceResults = ["新浪财经7x24", "东方财富资讯"].map((source, index) => {
      const result = settled[index];
      return result.status === "fulfilled"
        ? { source, ok: true, rows: result.value.length, message: "已获取" }
        : { source, ok: false, rows: 0, message: String(result.reason?.message || result.reason || "采集失败") };
    });
    const rows = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const saved = store.addNewsItems(rows);
    const sourceStatus = mergeSourceStatus(store.getStatus("sources"), {
      news: { ok: sourceResults.some((item) => item.ok), message: sourceResults.map((item) => `${item.source}${item.ok ? ` ${item.rows}条` : "不可用"}`).join("；"), updatedAt: now() }
    });
    store.setStatus("sources", sourceStatus);
    const result = {
      ok: sourceResults.some((item) => item.ok),
      scope: "news",
      startedAt,
      updatedAt: now(),
      sources: sourceResults,
      fetched: rows.length,
      inserted: saved.inserted.length,
      duplicates: saved.duplicates,
      message: rows.length ? `资讯已更新：新增 ${saved.inserted.length} 条，去重 ${saved.duplicates} 条` : "公开资讯源暂未返回内容，保留已有资讯"
    };
    newsRuntime.lastRunAt = result.updatedAt;
    newsRuntime.lastResult = result;
    return result;
  } catch (error) {
    const result = { ok: false, scope: "news", startedAt, updatedAt: now(), fetched: 0, inserted: 0, duplicates: 0, sources: [], message: `资讯刷新失败：${String(error.message || error)}` };
    newsRuntime.lastResult = result;
    return result;
  } finally {
    newsRuntime.active = false;
  }
}

function probeFutu() {
  return new Promise((resolve) => {
    const enabled = process.env.FUTU_ENABLED !== "0";
    const futuHost = process.env.FUTU_HOST || "127.0.0.1";
    const futuPort = Number(process.env.FUTU_PORT || 11111);
    if (!enabled) return resolve({ enabled: false, connected: false, host: futuHost, port: futuPort, status: "未启用", message: "在设置中启用后检查 Futu OpenD" });
    const socket = net.createConnection({ host: futuHost, port: futuPort });
    const finish = (payload) => { socket.destroy(); resolve({ enabled: true, host: futuHost, port: futuPort, ...payload }); };
    socket.setTimeout(1500);
    socket.once("connect", () => finish({ connected: true, status: "OpenD 可连接", message: "已检测到 Futu OpenD，行情适配器可继续接入" }));
    socket.once("timeout", () => finish({ connected: false, status: "连接超时", message: "请确认 Futu OpenD 已启动并监听端口" }));
    socket.once("error", (error) => finish({ connected: false, status: "不可用", message: String(error.message || error) }));
  });
}

async function refreshMarketData(scope = "all", code = "") {
  const allowedScopes = new Set(["all", "ashare", "etf", "sector", "global", "history", "stock-history", "sector-members", "news", "securities"]);
  const selectedScope = allowedScopes.has(scope) ? scope : "all";
  if (selectedScope === "news") return refreshPublicNews();
  const python = process.env.PYTHON_BIN || "python";
  refreshRuntime.active = true;
  refreshRuntime.scope = selectedScope;
  refreshRuntime.phase = "collecting";
  refreshRuntime.message = `正在采集${scopeLabelForServer(selectedScope)}数据`;
  refreshRuntime.startedAt = now();
  refreshRuntime.finishedAt = "";
  try {
    const args = [path.join(__dirname, "scripts", "collect_market_data.py"), "--scope", selectedScope];
    if (selectedScope === "stock-history") args.push("--code", code);
    refreshRuntime.phase = "waiting-source";
    refreshRuntime.message = `正在等待${scopeLabelForServer(selectedScope)}数据源返回`;
    const { stdout } = await execFileAsync(python, args, {
      cwd: __dirname,
      timeout: selectedScope === "all" ? 240_000 : selectedScope === "history" || selectedScope === "securities" ? 180_000 : selectedScope === "global" ? 60_000 : selectedScope === "news" ? 30_000 : 120_000,
      maxBuffer: 20 * 1024 * 1024
    });
    const payload = JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "{}");
    const fetchedAt = payload.fetchedAt || now();
    const saved = [];

    if (Array.isArray(payload.markets) && payload.markets.length) {
      const currentMarkets = store.getSnapshot("markets", "markets");
      const data = selectedScope === "all" ? payload.markets : mergeMarkets(currentMarkets.markets || [], payload.markets);
      store.saveSnapshot("markets", data, marketSourceLabel(selectedScope, payload.sources?.markets), "ok", fetchedAt);
      saved.push("markets");
    }
    if (Array.isArray(payload.trends) && payload.trends.length) {
      store.saveSnapshot("trends", mergeTrends(payload.trends), payload.sources?.trends || "真实趋势数据", "ok", fetchedAt);
      saved.push("trends");
    }
    if (Array.isArray(payload.stocks) && payload.stocks.length) {
      store.saveSnapshot("stocks", payload.stocks, payload.sources?.stocks || "真实股票池", "ok", fetchedAt);
      saved.push("stocks");
    }
    if (Array.isArray(payload.etfs) && payload.etfs.length) {
      store.saveSnapshot("etfs", payload.etfs, payload.sources?.etfs || "真实ETF", "ok", fetchedAt);
      saved.push("etfs");
    }
    if (Array.isArray(payload.sectorFlows) && payload.sectorFlows.length) {
      store.saveSnapshot("sectorFlows", payload.sectorFlows, payload.sources?.sectorFlows || "真实板块资金", "ok", fetchedAt);
      saved.push("sectorFlows");
    }
    if (Array.isArray(payload.history) && payload.history.length) {
      store.saveHistoryRows(payload.history);
      saved.push("history");
    }
    if (Array.isArray(payload.sectorMembers) && payload.sectorMembers.length) {
      store.saveSectorMembers(payload.sectorMembers);
      saved.push("sectorMembers");
    }
    if (Array.isArray(payload.newsItems) && payload.newsItems.length) {
      store.saveNewsItems(payload.newsItems);
      saved.push("newsItems");
    }
    if (Array.isArray(payload.securities) && payload.securities.length) {
      const result = store.upsertSecurities(payload.securities);
      saved.push(`securities:${result.count}`);
    }
    const currentStatus = payload.status || {};
    const mergedStatus = mergeSourceStatus(store.getStatus("sources"), currentStatus);
    store.setStatus("sources", mergedStatus);
    const result = {
      ok: true,
      scope: selectedScope,
      saved,
      status: mergedStatus,
      modules: summarizeSourceStatus(currentStatus),
      message: saved.length ? "刷新完成" : "未获取到新数据，继续使用缓存"
    };
    refreshRuntime.lastResult = result;
    return result;
  } catch (error) {
    const status = { collector: { ok: false, message: String(error.message || error) } };
    store.setStatus("sources", mergeSourceStatus(store.getStatus("sources"), status));
    const result = { ok: false, scope: selectedScope, saved: [], status, modules: summarizeSourceStatus(status), message: "刷新失败，继续使用缓存或模拟数据", error: String(error.message || error) };
    refreshRuntime.lastResult = result;
    return result;
  } finally {
    refreshRuntime.active = false;
    refreshRuntime.phase = "idle";
    refreshRuntime.message = "暂无刷新任务";
    refreshRuntime.finishedAt = now();
  }
}

function scopeLabelForServer(scope) {
  return { all: "全量", ashare: "A股", etf: "ETF", sector: "板块", global: "海外", history: "历史K线", "stock-history": "单票历史K线", "sector-members": "板块成分", news: "资讯", securities: "证券目录" }[scope] || "行情";
}

async function mapWithConcurrency(items, concurrency, worker) {
  const rows = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, rows.length || 1));
  const output = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await worker(rows[index], index);
    }
  }));
  return output;
}

async function refreshStockHistory(code) {
  const python = process.env.PYTHON_BIN || "python";
  const { stdout } = await execFileAsync(python, [path.join(__dirname, "scripts", "collect_market_data.py"), "--scope", "stock-history", "--code", String(code || "")], {
    cwd: __dirname,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const payload = JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "{}");
  if (Array.isArray(payload.history) && payload.history.length) store.saveHistoryRows(payload.history);
  if (payload.status) store.setStatus("sources", mergeSourceStatus(store.getStatus("sources"), payload.status));
  return payload;
}

async function refreshSecurityQuote(code, securityType = "stock") {
  const python = process.env.PYTHON_BIN || "python";
  const { stdout } = await execFileAsync(python, [path.join(__dirname, "scripts", "collect_market_data.py"), "--scope", "security-quote", "--code", String(code || ""), "--security-type", securityType === "etf" ? "etf" : "stock"], {
    cwd: __dirname,
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const payload = JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "{}");
  if (payload.status) store.setStatus("sources", mergeSourceStatus(store.getStatus("sources"), payload.status));
  return payload.quote || null;
}

async function refreshSecurityQuotes(codes = []) {
  const uniqueCodes = [...new Set((codes || []).map((code) => String(code || "").trim()).filter(Boolean))].slice(0, 100);
  if (!uniqueCodes.length) return [];
  const python = process.env.PYTHON_BIN || "python";
  const { stdout } = await execFileAsync(python, [path.join(__dirname, "scripts", "collect_market_data.py"), "--scope", "security-quotes", "--codes", uniqueCodes.join(",")], {
    cwd: __dirname,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const payload = JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "{}");
  if (payload.status) store.setStatus("sources", mergeSourceStatus(store.getStatus("sources"), payload.status));
  return Array.isArray(payload.quotes) ? payload.quotes : [];
}

async function ensureSecurityMaster() {
  const master = store.getSecurityMasterStatus();
  const updatedDate = master.updated_at ? shanghaiDateKey(master.updated_at) : "";
  if (Number(master.count || 0) > 0 && updatedDate === shanghaiDateKey()) return;
  if (refreshRuntime.active) return;
  await refreshMarketData("securities");
}

function mergeTrends(realTrends) {
  const cached = store.getSnapshot("trends", "series").series || [];
  const byCode = new Map([...mockTrends, ...cached].map((item) => [item.code, item]));
  for (const trend of realTrends) byCode.set(trend.code, trend);
  return [...byCode.values()];
}

function mergeMarkets(currentMarkets, incomingMarkets) {
  const byRegion = new Map((currentMarkets || []).map((market) => [market.region, market]));
  for (const market of incomingMarkets || []) byRegion.set(market.region, market);
  return [...byRegion.values()];
}

function marketSourceLabel(scope, incomingSource) {
  if (scope === "ashare") return `A股:${incomingSource || "真实指数数据"} / 其他:最近数据`;
  if (scope === "global") return `海外:${incomingSource || "yfinance"} / A股:最近数据`;
  return incomingSource || "真实指数数据";
}

function summarizeSourceStatus(status) {
  const modules = ["futu", "ashare_futu", "etf_futu", "ashare", "etf", "securities_futu", "security_quote", "sector", "global", "history", "sector_members", "news"];
  return modules
    .map((key) => {
      const item = status?.[key];
      if (!item) return null;
      return {
        key,
        sourceName: item.sourceName || key,
        ok: Boolean(item.ok),
        rows: Number(item.rows || 0),
        message: item.message || ""
      };
    })
    .filter(Boolean);
}

function mergeSourceStatus(previous, current) {
  const merged = {
    ...(previous || {}),
    ...(current || {}),
    fetched_at: current?.fetched_at || previous?.fetched_at || now(),
    scope: current?.scope || previous?.scope || "all"
  };
  if (current && !current.collector) delete merged.collector;
  return merged;
}

function futuCodeForStream(code) {
  const text = String(code || "").trim().toUpperCase();
  if (/^(SH|SZ|HK|US)\./.test(text)) return text;
  if (/^\d{6}$/.test(text)) return `${text.startsWith("6") ? "SH" : "SZ"}.${text}`;
  return text;
}

function syncFutuSubscriptions(accountId = null) {
  const codes = ["SH.000001", "SZ.399001", "SZ.399006", "SH.000300"];
  const account = store.getPaperAccount(accountId);
  if (account) {
    for (const position of store.listPaperPositions(account.id)) codes.push(futuCodeForStream(position.code));
  }
  fs.mkdirSync(path.dirname(futuSubscriptionsPath), { recursive: true });
  fs.writeFileSync(futuSubscriptionsPath, JSON.stringify({ codes: [...new Set(codes)] }, null, 2), "utf-8");
  ensureFutuStream();
}

function ensureFutuStream() {
  if (process.env.FUTU_ENABLED === "0") return;
  if (futuStream.child && !futuStream.child.killed) return;
  const python = process.env.PYTHON_BIN || "python";
  const script = path.join(__dirname, "scripts", "futu_stream.py");
  try {
    futuStream.child = spawn(python, [script], { cwd: __dirname, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    futuStream.startedAt = now();
    futuStream.child.on("exit", () => { futuStream.child = null; });
  } catch {
    futuStream.child = null;
  }
}

function readFutuLive() {
  try {
    if (!fs.existsSync(futuLivePath)) return { connected: false, quotes: {}, message: "实时订阅尚未启动" };
    const data = JSON.parse(fs.readFileSync(futuLivePath, "utf-8"));
    const updated = new Date(data.updatedAt || 0).getTime();
    const process = Boolean(futuStream.child && !futuStream.child.killed);
    return { ...data, connected: Boolean(data.connected && Date.now() - updated < 15_000), openDConnected: Boolean(data.connected && process), quotes: data.quotes || {}, process };
  } catch (error) {
    return { connected: false, quotes: {}, message: String(error.message || error) };
  }
}

function mergeLivePaperQuotes(baseMap) {
  const live = readFutuLive();
  for (const [code, quote] of Object.entries(live.quotes || {})) {
    const previous = baseMap.get(code) || {};
    const usable = Object.fromEntries(Object.entries(quote || {}).filter(([, value]) => value !== null && value !== undefined && value !== ""));
    baseMap.set(code, { ...previous, ...usable });
  }
  return live;
}

function publicPaperAccount(account) {
  if (!account) return null;
  const { owner_token: _ownerToken, ...safe } = account;
  return safe;
}

function buildPaperStatus(account, saveEquity = false, quotes = null) {
  const stocks = store.getSnapshot("stocks", "stocks");
  const etfs = store.getSnapshot("etfs", "etfs");
  const quoteMap = quotes || paperQuoteMap(stocks, etfs);
  const live = mergeLivePaperQuotes(quoteMap);
  const positions = store.listPaperPositions(account.id).map((position) => {
    const quote = quoteMap.get(position.code) || {};
    const lastPrice = Number(quote.price ?? quote.last_price ?? position.last_price ?? position.avg_cost);
    const marketValue = position.quantity * lastPrice;
    const unrealizedPnl = (lastPrice - position.avg_cost) * position.quantity;
    const unrealizedReturnPct = Number(position.avg_cost) > 0 ? ((lastPrice / Number(position.avg_cost)) - 1) * 100 : null;
    return { ...position, last_price: lastPrice, change_pct: quote.change_pct ?? null, volume_ratio: quote.volume_ratio ?? null, turnover_rate: quote.turnover_rate ?? null, market_value: marketValue, unrealized_pnl: unrealizedPnl, unrealized_return_pct: unrealizedReturnPct, source_name: quote.source_name || stocks.source || etfs.source || "最近数据" };
  });
  const marketValue = positions.reduce((sum, item) => sum + Number(item.market_value || 0), 0);
  const unrealizedPnl = positions.reduce((sum, item) => sum + Number(item.unrealized_pnl || 0), 0);
  const cash = Number(account.cash);
  const equity = cash + marketValue;
  const history = store.listPaperEquity(account.id, 2000);
  const highWaterMark = Math.max(Number(account.initial_cash), ...history.map((item) => Number(item.equity || 0)), equity);
  const drawdown = highWaterMark ? ((equity - highWaterMark) / highWaterMark) * 100 : 0;
  const today = paperTodayMetrics(account.id, equity);
  const orders = store.listPaperOrders(account.id, 500);
  const todayPositions = buildPaperTodayPositions(positions, orders);
  const snapshot = { ...publicPaperAccount(account), cash, market_value: marketValue, equity, return_pct: ((equity / account.initial_cash) - 1) * 100, unrealized_pnl: unrealizedPnl, drawdown, ...today, updated_at: new Date().toISOString() };
  if (saveEquity) store.savePaperEquity({ accountId: account.id, cash, marketValue, equity, realizedPnl: Number(account.realized_pnl), unrealizedPnl, drawdown });
  return { configured: true, account: snapshot, positions, todayPositions, orders: orders.slice(0, 100), equity: store.listPaperEquity(account.id, 5000), dataSource: live.connected ? "Futu OpenD实时订阅" : `${stocks.source || "A股"} / ${etfs.source || "ETF"}`, stream: { connected: live.connected, openDConnected: live.openDConnected, process: live.process, message: live.message || (live.connected ? "实时订阅中" : "等待实时推送"), updatedAt: live.updatedAt || "", codes: live.codes || [] }, updatedAt: live.updatedAt || stocks.updatedAt || etfs.updatedAt };
}

function buildPaperTodayPositions(positions = [], orders = []) {
  const today = shanghaiDateKey();
  const activeByCode = new Map((positions || []).map((position) => [String(position.code), position]));
  const rowsByCode = new Map();
  for (const position of positions || []) {
    rowsByCode.set(String(position.code), {
      code: position.code,
      name: position.name,
      market: position.market || "",
      status: "holding",
      quantity: Number(position.quantity || 0),
      last_price: position.last_price,
      avg_cost: position.avg_cost,
      market_value: position.market_value,
      unrealized_pnl: position.unrealized_pnl,
      unrealized_return_pct: position.unrealized_return_pct,
      buy_quantity: 0,
      sell_quantity: 0,
      realized_cost: 0,
      realized_pnl: 0,
      first_trade_at: "",
      last_trade_at: ""
    });
  }
  for (const order of orders || []) {
    if (shanghaiDateKey(order.created_at) !== today) continue;
    const code = String(order.code || "");
    if (!code) continue;
    const active = activeByCode.get(code);
    const row = rowsByCode.get(code) || {
      code,
      name: order.name || code,
      market: active?.market || "",
      status: "cleared",
      quantity: 0,
      last_price: Number(order.price || 0),
      avg_cost: null,
      market_value: 0,
      unrealized_pnl: 0,
      unrealized_return_pct: null,
      buy_quantity: 0,
      sell_quantity: 0,
      buy_cost: 0,
      realized_cost: 0,
      realized_pnl: 0,
      first_trade_at: "",
      last_trade_at: ""
    };
    const quantity = Number(order.quantity || 0);
    if (order.side === "BUY") {
      row.buy_quantity += quantity;
      row.buy_cost = Number(row.buy_cost || 0) + Number(order.amount || 0) + Number(order.fee || 0);
    } else if (order.side === "SELL") {
      row.sell_quantity += quantity;
      const realizedPnl = Number(order.realized_pnl || 0);
      row.realized_pnl += realizedPnl;
      row.realized_cost += Math.max(0, Number(order.amount || 0) - Number(order.fee || 0) - realizedPnl);
      row.last_price = Number(order.price || row.last_price || 0);
    }
    const orderTime = new Date(order.created_at || 0).getTime();
    const firstTime = new Date(row.first_trade_at || 0).getTime();
    const lastTime = new Date(row.last_trade_at || 0).getTime();
    if (!row.first_trade_at || (Number.isFinite(orderTime) && (!Number.isFinite(firstTime) || orderTime < firstTime))) row.first_trade_at = order.created_at || "";
    if (!row.last_trade_at || (Number.isFinite(orderTime) && (!Number.isFinite(lastTime) || orderTime > lastTime))) row.last_trade_at = order.created_at || "";
    rowsByCode.set(code, row);
  }
  return [...rowsByCode.values()]
    .map((row) => {
      const holding = Number(row.quantity || 0) > 0;
      const realizedReturnPct = !holding && Number(row.realized_cost || 0) > 0 ? (Number(row.realized_pnl || 0) / Number(row.realized_cost)) * 100 : null;
      return {
        ...row,
        status: holding ? "holding" : "cleared",
        status_label: holding ? (row.sell_quantity > 0 ? "持有中 · 今日已卖出" : "持有中") : "今日已清仓",
        return_pct: holding ? row.unrealized_return_pct : realizedReturnPct
      };
    })
    .sort((left, right) => Number(right.last_trade_at ? new Date(right.last_trade_at).getTime() : 0) - Number(left.last_trade_at ? new Date(left.last_trade_at).getTime() : 0) || left.name.localeCompare(right.name, "zh-CN"));
}

function paperQuoteMap(stocks, etfs) {
  const map = new Map();
  for (const item of [...(stocks.stocks || []), ...(etfs.etfs || [])]) {
    if (item?.code) map.set(item.code, item);
  }
  return map;
}

function paperRiskName(item) {
  return /ST|退|停牌/.test(String(item?.name || "")) || !Number.isFinite(Number(item?.price)) || Number(item.price) <= 0;
}

function defaultPaperStrategies() {
  return [
    { id: "trend", name: "趋势跟随 v5", description: "均线、市场环境、量能与流动性共同确认；盘中形态默认仅作研究参考。", builtin: true, market: "all", logic: "AND", conditions: [], rules: { signalMode: "trend", minChange: 0.2, maxChange: 5, minVolume: 1, minScore: 45, sellStop: -3, takeProfit: 6, trailingStop: 2.5, maxHoldingDays: 15, cooldownMinutes: 60, minAmount: 100000000, requireMarketTrend: true, minMarketChange: -1 } },
    { id: "short", name: "短线动量 v5", description: "放量、换手、均线、流动性和市场环境共同确认，不把盘中经验直接变成卖出指令。", builtin: true, market: "all", logic: "AND", conditions: [], rules: { signalMode: "momentum", minChange: 0.8, maxChange: 6, minVolume: 1.5, minTurnover: 3, maxTurnover: 18, minScore: 50, sellStop: -2.5, takeProfit: 6, trailingStop: 2.5, maxHoldingDays: 5, cooldownMinutes: 60, minAmount: 300000000, requireMarketTrend: true, minMarketChange: -1.5 } },
    { id: "long", name: "长线趋势 v6", description: "以实时行情、流动性和基础趋势判断为主；长周期均线仅作研究参考。", builtin: true, market: "all", logic: "AND", conditions: [], rules: { signalMode: "trend", requireLongTrend: false, minChange: -1, maxChange: 4, minVolume: 0.7, minScore: 50, sellStop: -8, takeProfit: 12, trailingStop: 4, maxHoldingDays: 45, cooldownMinutes: 240, minAmount: 50000000, requireMarketTrend: true, minMarketChange: -1.5 } },
    { id: "conservative", name: "保守低波 v5", description: "限制波动、换手和仓位，优先减少错误交易。", builtin: true, market: "all", logic: "AND", conditions: [], rules: { signalMode: "low_vol", minChange: -1, maxChange: 3, minVolume: 0.8, maxTurnover: 8, minScore: 45, sellStop: -2, takeProfit: 4, trailingStop: 1.5, maxHoldingDays: 20, cooldownMinutes: 240, minAmount: 100000000, requireMarketTrend: true, minMarketChange: -0.8 } },
    { id: "momentum", name: "强势动量 v5", description: "高活跃标的需要通过趋势、量能和流动性过滤；盘中形态仅作为候选解释。", builtin: true, market: "all", logic: "AND", conditions: [], rules: { signalMode: "momentum", minChange: 1, maxChange: 7, minVolume: 1.5, minTurnover: 3, maxTurnover: 15, minScore: 50, sellStop: -3, takeProfit: 7, trailingStop: 3, maxHoldingDays: 7, cooldownMinutes: 120, minAmount: 300000000, requireMarketTrend: true, minMarketChange: -1 } },
    { id: "etf", name: "ETF轮动 v5", description: "ETF趋势、成交额、量比和大盘环境共同确认。", builtin: true, market: "ETF", logic: "AND", conditions: [], rules: { signalMode: "rotation", minChange: 0.1, maxChange: 4, minVolume: 1, minScore: 40, sellStop: -2.5, takeProfit: 5, trailingStop: 2, maxHoldingDays: 15, cooldownMinutes: 180, minAmount: 50000000, requireMarketTrend: true, minMarketChange: -1.2 } },
    { id: "reversal", name: "超跌反转 v2", description: "RSI超卖、回撤和止跌确认后进入观察，盘中形态只辅助解释。", builtin: true, market: "all", logic: "AND", conditions: [], rules: { signalMode: "reversal", maxRsi: 35, minDrawdown: -20, maxDrawdown: -6, requireRebound: true, minChange: -5, maxChange: 2, minVolume: 0.8, sellStop: -4, takeProfit: 6, trailingStop: 2.5, maxHoldingDays: 10, cooldownMinutes: 240, minAmount: 50000000, requireMarketTrend: true, minMarketChange: -1.5, minScore: 60 } },
    { id: "etf_reversal", name: "ETF超跌修复 v3", description: "ETF回撤后出现止跌改善时进入观察，保留仓位与风险限制，避免条件过严导致长期零触发。", builtin: true, market: "ETF", logic: "AND", conditions: [], rules: { signalMode: "reversal", maxRsi: 48, minDrawdown: -12, maxDrawdown: -3, requireRebound: true, minChange: -2, maxChange: 1.5, minVolume: 0.6, sellStop: -3, takeProfit: 5, trailingStop: 2, maxHoldingDays: 15, cooldownMinutes: 180, minAmount: 30000000, requireMarketTrend: true, minMarketChange: -2.5, minScore: 45 } }
  ];
}

function normalizePaperRules(rules = {}) {
  const number = (key, fallback, min = -Infinity, max = Infinity) => {
    if (rules[key] === null || rules[key] === undefined || String(rules[key]).trim() === "") return fallback;
    const value = Number(rules[key]);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  };
  return {
    minChange: number("minChange", 0.5, -20, 20), maxChange: number("maxChange", 5, -20, 30),
    minVolume: number("minVolume", 1, 0, 100), minTurnover: number("minTurnover", null, 0, 100), maxTurnover: number("maxTurnover", null, 0, 100),
    minAmount: number("minAmount", 0, 0, 1e15), sellStop: number("sellStop", -2, -50, 0), takeProfit: number("takeProfit", 5, 0, 100),
    trailingStop: number("trailingStop", 2, 0, 50), maxHoldingDays: number("maxHoldingDays", 15, 0, 3650), cooldownMinutes: number("cooldownMinutes", 60, 0, 10080),
    signalMode: ["custom", "trend", "momentum", "low_vol", "rotation", "reversal"].includes(String(rules.signalMode)) ? String(rules.signalMode) : "momentum",
    maxRsi: number("maxRsi", null, 1, 99), minDrawdown: number("minDrawdown", null, -100, 0), maxDrawdown: number("maxDrawdown", null, -100, 0),
    requireRebound: Boolean(rules.requireRebound), requireLongTrend: Boolean(rules.requireLongTrend), minScore: number("minScore", 0, 0, 100),
    usePreviousDailyBar: rules.usePreviousDailyBar !== false,
    intradayReference: Boolean(rules.intradayReference),
    openingNoAddMinutes: number("openingNoAddMinutes", 30, 0, 120),
    lowOpenThreshold: number("lowOpenThreshold", -0.5, -10, 0),
    lowOpenNoRedMinutes: number("lowOpenNoRedMinutes", 10, 1, 60),
    highOpenReduceThreshold: number("highOpenReduceThreshold", 2, 0, 20),
    highOpenReduceMinutes: number("highOpenReduceMinutes", 30, 1, 120),
    highOpenClearThreshold: number("highOpenClearThreshold", 5, 0, 30),
    highOpenClearMinutes: number("highOpenClearMinutes", 20, 1, 120),
    largeVolumeRatio: number("largeVolumeRatio", 1.5, 0, 100),
    lateBoardHour: number("lateBoardHour", 14, 12, 15),
    tailMoveThreshold: number("tailMoveThreshold", 1.5, 0.1, 20),
    requireMarketTrend: Boolean(rules.requireMarketTrend), minMarketChange: number("minMarketChange", -2, -20, 20),
    perPosition: number("perPosition", 0.2, 0.01, 1), maxExposure: number("maxExposure", 0.8, 0.01, 1), maxPositions: number("maxPositions", 5, 1, 100),
    maxPositionExposure: number("maxPositionExposure", 0.5, 0.01, 1),
    minPositions: number("minPositions", 0, 0, 20),
    allowReplacement: rules.allowReplacement !== false,
    replacementScoreGap: number("replacementScoreGap", 12, 1, 80),
    maxThemePositions: number("maxThemePositions", 2, 1, 20),
    maxPortfolioCodeCopies: number("maxPortfolioCodeCopies", 1, 1, 20),
    maxPortfolioThemeCopies: number("maxPortfolioThemeCopies", 3, 1, 40)
  };
}

function normalizePaperStrategyInput(input = {}) {
  const name = String(input.name || "自定义策略").trim().slice(0, 40);
  if (!name) throw new Error("策略名称不能为空");
  return {
    id: String(input.id || `custom-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60), name,
    description: String(input.description || "本地可编辑模拟策略").trim().slice(0, 160), builtin: Boolean(input.builtin),
    market: ["all", "A股", "ETF"].includes(input.market) ? input.market : "all", logic: input.logic === "OR" ? "OR" : "AND",
    conditions: Array.isArray(input.conditions) ? input.conditions.slice(0, 20) : [], rules: normalizePaperRules({ signalMode: input.builtin === false ? "custom" : undefined, ...(input.rules || {}) })
  };
}

function findPaperStrategy(id) {
  const runtime = getRuntimeConfig();
  const custom = runtime.paper?.strategies?.[String(id)];
  const builtIn = defaultPaperStrategies().find((item) => item.id === String(id));
  if (custom) return { ...custom, rules: normalizePaperRules({ signalMode: "custom", ...(custom.rules || {}) }) };
  if (builtIn) return { ...builtIn, rules: normalizePaperRules(builtIn.rules || {}) };
  return null;
}

function writePaperRuntime(runtime) {
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
  fs.writeFileSync(runtimeConfigPath, `${JSON.stringify({ ...runtime, __exists: undefined }, null, 2)}\n`, "utf-8");
  restartPaperAutoLoop();
}

function paperStrategyConfig(key, conditions = [], logic = "AND", market = "all", customRules = {}) {
  const presets = Object.fromEntries(defaultPaperStrategies().map((item) => [item.id, item]));
  const configs = {
    trend: { name: "趋势跟随 v5", maxExposure: 0.8, perPosition: 0.2, maxPositions: 5, market: "all" }, short: { name: "短线动量 v5", maxExposure: 0.7, perPosition: 0.2, maxPositions: 4, market: "all" },
    long: { name: "长线趋势 v5", maxExposure: 0.85, perPosition: 0.25, maxPositions: 6, market: "all" }, conservative: { name: "保守低波 v5", maxExposure: 0.6, perPosition: 0.15, maxPositions: 4, market: "all" },
    momentum: { name: "强势动量 v5", maxExposure: 0.8, perPosition: 0.2, maxPositions: 5, market: "all" }, etf: { name: "ETF轮动 v5", maxExposure: 0.8, perPosition: 0.2, maxPositions: 4, market: "ETF" },
    reversal: { name: "超跌反转 v2", maxExposure: 0.6, perPosition: 0.15, maxPositions: 4, market: "all" },
    etf_reversal: { name: "ETF超跌修复 v2", maxExposure: 0.6, perPosition: 0.15, maxPositions: 4, market: "ETF" },
    custom: { name: "自定义策略", maxExposure: 0.8, perPosition: 0.2, maxPositions: 5, market, logic, conditions }
  };
  const preset = presets[key];
  const rules = normalizePaperRules(customRules && Object.keys(customRules).length ? customRules : preset?.rules || {});
  return { ...(configs[key] || configs.trend), ...rules, logic, conditions, market: key === "custom" ? market : (preset?.market || configs[key]?.market || market) };
}

const paperIndicatorCache = new Map();

function getPaperIndicators(item, config = {}) {
  const code = String(item?.code || "");
  if (!code) return { available: false, reason: "缺少代码" };
  const completedOnly = Boolean(config.usePreviousDailyBar);
  const cacheKey = `${code}:${completedOnly ? "previous" : "latest"}`;
  const cached = paperIndicatorCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 60_000) return cached.value;
  // 策略指标需要完整本地日K；“季”窗口只适合图表展示，会截断为约66根。
  const history = getStockHistory(item, "all");
  const points = (history.points || []).filter((point) => !completedOnly || String(point.date || point.trade_date || "") < shanghaiDateKey());
  const closes = points.map((point) => Number(point.close ?? point.value)).filter(Number.isFinite);
  if (closes.length < 20) {
    const value = { available: false, reason: `历史样本不足（${closes.length}/20）`, points: closes.length, completedOnly };
    paperIndicatorCache.set(cacheKey, { cachedAt: Date.now(), value });
    return value;
  }
  const latest = closes.at(-1);
  const previous = closes.at(-2);
  const ma5 = average(closes.slice(-5));
  const ma20 = average(closes.slice(-20));
  const ma60 = closes.length >= 60 ? average(closes.slice(-60)) : null;
  const high20 = Math.max(...closes.slice(-20));
  const low20 = Math.min(...closes.slice(-20));
  const drawdown20 = high20 ? (latest / high20 - 1) * 100 : null;
  const rebound = Number.isFinite(previous) && latest > previous && latest > low20;
  const value = {
    available: true,
    points: closes.length,
    latest,
    ma5,
    ma20,
    ma60,
    rsi14: calculateRsi(closes, 14),
    volatility: calculateVolatility(closes),
    drawdown20,
    rebound,
    ma5AboveMa20: Number.isFinite(ma5) && Number.isFinite(ma20) ? ma5 >= ma20 : null,
    ma20AboveMa60: Number.isFinite(ma20) && Number.isFinite(ma60) ? ma20 >= ma60 : null,
    source: history.source || "本地历史K线",
    updatedAt: history.updatedAt || item.update_time || "",
    asOfDate: String(points.at(-1)?.date || points.at(-1)?.trade_date || ""),
    completedOnly
  };
  paperIndicatorCache.set(cacheKey, { cachedAt: Date.now(), value });
  return value;
}

function evaluatePaperSignal(item, config) {
  const mode = config.signalMode || "momentum";
  if (mode === "custom") return { pass: true, score: null, reason: "自定义条件通过" };
  const indicators = getPaperIndicators(item, config);
  if (!indicators.available) {
    return { pass: true, score: 30, reason: `${indicators.reason}，降级使用真实实时数据与两轮确认`, indicators, realtimeOnly: true };
  }
  const scoreParts = [];
  if (indicators.ma5AboveMa20) scoreParts.push(20);
  if (indicators.ma20AboveMa60 || indicators.ma20AboveMa60 === null) scoreParts.push(15);
  if (Number.isFinite(indicators.rsi14) && indicators.rsi14 < 75) scoreParts.push(15);
  if (indicators.rebound) scoreParts.push(15);
  if (Number.isFinite(indicators.drawdown20) && indicators.drawdown20 > -8) scoreParts.push(10);
  const score = scoreParts.reduce((sum, value) => sum + value, 0);
  if (mode === "reversal") {
    if (Number.isFinite(config.maxRsi) && (!Number.isFinite(indicators.rsi14) || indicators.rsi14 > config.maxRsi)) return { pass: false, score, reason: `RSI未进入超卖区（当前 ${Number(indicators.rsi14 || 0).toFixed(1)}）`, indicators };
    if (Number.isFinite(config.minDrawdown) && (!Number.isFinite(indicators.drawdown20) || indicators.drawdown20 < config.minDrawdown)) return { pass: false, score, reason: `回撤超过策略容许范围（当前 ${Number(indicators.drawdown20 || 0).toFixed(2)}%）`, indicators };
    if (Number.isFinite(config.maxDrawdown) && (!Number.isFinite(indicators.drawdown20) || indicators.drawdown20 > config.maxDrawdown)) return { pass: false, score, reason: `回撤不足（当前 ${Number(indicators.drawdown20 || 0).toFixed(2)}%）`, indicators };
    if (config.requireRebound && !indicators.rebound) return { pass: false, score, reason: "尚未出现止跌反弹确认", indicators };
    if (score < Number(config.minScore || 0)) return { pass: false, score, reason: `反转评分不足（${score}/${config.minScore}）`, indicators };
    return { pass: true, score, reason: `超跌反转确认，评分 ${score}`, indicators };
  }
  if (["trend", "momentum", "low_vol", "rotation"].includes(mode) && indicators.ma5AboveMa20 === false) return { pass: false, score, reason: "MA5低于MA20，趋势未确认", indicators };
  if (config.requireLongTrend && indicators.ma20AboveMa60 !== true) return { pass: false, score, reason: "MA20未高于MA60，长周期趋势未确认", indicators };
  if (mode === "momentum" && Number.isFinite(indicators.rsi14) && indicators.rsi14 >= 80) return { pass: false, score, reason: `RSI过热（${indicators.rsi14.toFixed(1)}）`, indicators };
  if (mode === "low_vol" && Number.isFinite(indicators.volatility) && indicators.volatility > 4) return { pass: false, score, reason: `波动率过高（${indicators.volatility.toFixed(2)}%）`, indicators };
  if (Number(config.minScore || 0) > 0 && score < Number(config.minScore)) return { pass: false, score, reason: `综合趋势评分不足（${score}/${config.minScore}）`, indicators };
  const asOf = indicators.asOfDate ? `（截至${indicators.asOfDate}）` : "";
  return { pass: true, score, reason: `历史趋势指标通过${asOf}`, indicators };
}

function paperLimitUpPct(item = {}) {
  const name = String(item.name || "");
  const code = String(item.code || "").toLowerCase().replace(/^(sh|sz|bj)\./, "");
  if (name.includes("ST")) return 5;
  if (String(item.market || "") === "ETF") return 10;
  if (code.startsWith("300") || code.startsWith("301") || code.startsWith("688")) return 20;
  return 10;
}

function paperObservationMinute(row) {
  const value = getShanghaiClock(new Date(row.observed_at));
  return Number.isFinite(value.minutes) ? value.minutes : null;
}

function paperPct(from, to) {
  const start = Number(from?.price);
  const end = Number(to?.price);
  return Number.isFinite(start) && start > 0 && Number.isFinite(end) ? (end / start - 1) * 100 : null;
}

function paperIntradayReference(item, config, accountId, rowsOverride = null) {
  if (!config.intradayReference) return { buyBlocked: false, sellFraction: 0, sellReason: "", reasons: [], observation: "未启用盘中形态参考" };
  const today = shanghaiDateKey();
  const rows = rowsOverride || store.listPaperIntradayObservations(accountId, item.code, today, 600);
  const clock = getShanghaiClock();
  const currentMinutes = clock.minutes;
  const first = rows[0];
  const firstMinute = first ? paperObservationMinute(first) : null;
  const openingReady = Number.isFinite(firstMinute) && firstMinute <= 9 * 60 + 35;
  const elapsed = openingReady ? Math.max(0, currentMinutes - firstMinute) : null;
  const reasons = [];
  let sellFraction = 0;
  let sellReason = "";
  const addReference = (reason) => {
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  };
  if (!rows.length || !openingReady) return { buyBlocked: false, sellFraction: 0, sellReason: "", reasons: [], observation: "盘中样本不足：尚未记录 09:30 附近的开盘基线" };
  if (currentMinutes >= 9 * 60 + 30 && currentMinutes < 10 * 60 && elapsed < Number(config.openingNoAddMinutes)) reasons.push(`开盘前 ${config.openingNoAddMinutes} 分钟只减仓，不加仓`);
  const openingGap = Number(first.change_pct);
  const limitPct = paperLimitUpPct(item);
  const boardRows = rows.filter((row) => Number(row.change_pct) >= limitPct - 0.5);
  const boardMinute = boardRows.length ? paperObservationMinute(boardRows[0]) : null;
  const redInWindow = (minutes) => rows.some((row) => {
    const minute = paperObservationMinute(row);
    return Number.isFinite(minute) && minute <= firstMinute + minutes && Number(row.change_pct) >= 0;
  });
  if (Number.isFinite(openingGap) && openingGap <= Number(config.lowOpenThreshold) && elapsed >= Number(config.lowOpenNoRedMinutes) && !redInWindow(Number(config.lowOpenNoRedMinutes))) {
    addReference(`低开 ${openingGap.toFixed(2)}%，${config.lowOpenNoRedMinutes} 分钟未翻红`);
  }
  if (Number.isFinite(openingGap) && openingGap >= Number(config.highOpenClearThreshold) && elapsed >= Number(config.highOpenClearMinutes) && !boardRows.some((row) => {
    const minute = paperObservationMinute(row); return Number.isFinite(minute) && minute <= firstMinute + Number(config.highOpenClearMinutes);
  })) addReference(`高开 ${openingGap.toFixed(2)}%，${config.highOpenClearMinutes} 分钟未封板`);
  else if (Number.isFinite(openingGap) && openingGap >= Number(config.highOpenReduceThreshold) && elapsed >= Number(config.highOpenReduceMinutes) && !boardRows.some((row) => {
    const minute = paperObservationMinute(row); return Number.isFinite(minute) && minute <= firstMinute + Number(config.highOpenReduceMinutes);
  })) addReference(`高开 ${openingGap.toFixed(2)}%，${config.highOpenReduceMinutes} 分钟未封板`);
  if (Number.isFinite(boardMinute) && boardMinute <= 10 * 60) {
    const volume = Number(rows.at(-1)?.volume_ratio);
    if (Number.isFinite(volume) && volume < Number(config.largeVolumeRatio)) addReference(`10点前封板但量比 ${volume.toFixed(2)} 偏小，封板质量不足`);
    else reasons.push("10点前封板，标记为早盘强势观察");
  }
  if (Number.isFinite(boardMinute) && boardMinute >= Number(config.lateBoardHour) * 60) {
    reasons.push("14点后封板，标记为弱势封板，次日低开风险增加");
  }
  const morningRows = rows.filter((row) => (paperObservationMinute(row) || 0) <= 11 * 60 + 30);
  const morningMax = Math.max(...morningRows.map((row) => Number(row.price)).filter(Number.isFinite), 0);
  const currentPrice = Number(rows.at(-1)?.price);
  const earlyMaxChange = Math.max(...rows.filter((row) => (paperObservationMinute(row) || 0) <= 10 * 60).map((row) => Number(row.change_pct)).filter(Number.isFinite), -Infinity);
  if (currentMinutes >= 13 * 60 && Number.isFinite(earlyMaxChange) && earlyMaxChange >= 3 && currentPrice > 0 && morningMax > 0 && currentPrice < morningMax * 0.99) {
    addReference("早盘急拉未封板，午后回落");
  }
  const morningPrices = morningRows.map((row) => Number(row.price)).filter(Number.isFinite);
  const morningMin = Math.min(...morningPrices, Infinity);
  const sideways = morningMin > 0 && morningMax > 0 && (morningMax / morningMin - 1) * 100 <= 1.5;
  if (currentMinutes >= 13 * 60 && sideways && currentPrice >= morningMax * 1.003) reasons.push("早盘拉升后横盘，午后向上突破，允许进入候选观察");
  const recentRows = rows.slice(-12);
  const moves = recentRows.slice(1).map((row, index) => paperPct(recentRows[index], row)).filter(Number.isFinite);
  const fastFallSlowRise = moves.some((move) => move <= -0.8) && moves.slice(-3).filter((move) => move > 0).length >= 2;
  const fastRiseSlowFall = moves.some((move) => move >= 0.8) && moves.slice(-3).filter((move) => move < 0).length >= 2;
  if (fastFallSlowRise) reasons.push("快跌慢涨，暂按洗盘观察，等待趋势确认");
  if (fastRiseSlowFall) {
    reasons.push("快涨慢跌，暂按出货风险处理");
    addReference("快涨慢跌，注意冲高回落风险");
  }
  if (currentMinutes >= 14 * 60 + 40 && rows.length >= 2) {
    const tail = rows.filter((row) => (paperObservationMinute(row) || 0) >= 14 * 60 + 40);
    const tailChange = paperPct(tail[0], tail.at(-1));
    if (Number.isFinite(tailChange) && tailChange <= -Math.abs(Number(config.tailMoveThreshold))) reasons.push(`尾盘10分钟下杀 ${tailChange.toFixed(2)}%，记录次日高开观察，不直接追买`);
    const tail20 = rows.filter((row) => (paperObservationMinute(row) || 0) >= 14 * 60 + 20);
    const tail20Change = paperPct(tail20[0], tail20.at(-1));
    if (Number.isFinite(tail20Change) && tail20Change >= Math.abs(Number(config.tailMoveThreshold))) addReference(`尾盘20分钟急拉 ${tail20Change.toFixed(2)}%，记录次日低开风险`);
  }
  return { buyBlocked: false, buyReason: "", sellFraction: 0, sellReason: "", reasons, observation: reasons.join("；") || "盘中形态未命中", openingGap, boardMinute, samples: rows.length, referenceOnly: true };
}

function runPaperStrategy(account, stocks, etfs, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const executionLabel = String(options.executionLabel || "").trim().slice(0, 120);
  const executionNote = executionLabel ? `；${executionLabel}` : "";
  const source = `${stocks.source || "A股"} / ${etfs.source || "ETF"}${executionLabel ? ` / ${executionLabel}` : ""}`;
  const allowBuy = options.allowBuy !== false;
  const allowSell = options.allowSell !== false;
  const quoteMap = paperQuoteMap(stocks, etfs);
  mergeLivePaperQuotes(quoteMap);
  const existing = store.listPaperPositions(account.id);
  const ownerPortfolio = paperOwnerPortfolio(account, quoteMap);
  const simulatedClosedCodes = new Set();
  const actions = [];
  const decisions = [];
  const selectedStrategy = findPaperStrategy(options.strategy || "trend");
  const strategyKey = selectedStrategy && !selectedStrategy.builtin ? "custom" : (options.strategy || "trend");
  const strategyConditions = Array.isArray(options.conditions) && options.conditions.length ? options.conditions : (selectedStrategy?.conditions || []);
  const strategyRules = options.rules && Object.keys(options.rules).length ? options.rules : (selectedStrategy?.rules || {});
  const config = { ...paperStrategyConfig(strategyKey, strategyConditions, options.logic || selectedStrategy?.logic || "AND", options.market || selectedStrategy?.market || "all", strategyRules), accountRole: String(options.accountRole || "trend") };
  const strategy = config.name;
  const maxActionsPerDay = Math.max(1, Number(options.maxActionsPerDay) || 10);
  const maxBuysPerDay = Math.max(1, Number(options.maxBuysPerDay) || 10);
  const maxSellsPerDay = Math.max(1, Number(options.maxSellsPerDay) || 10);
  let buysToday = todayOrderCount(account.id, "BUY");
  let sellsToday = todayOrderCount(account.id, "SELL");
  const environment = paperMarketEnvironment();
  const entryPhase = paperEntryPhase();
  const entryLabel = executionLabel ? "收盘后受控补录" : entryPhase.label;
  const universe = Array.isArray(options.universe) && options.universe.length ? options.universe : paperUniverse(stocks, etfs);
  const watchlist = (options.watchlist || []).map((item) => normalizeLookupText(item)).filter(Boolean);
  const observationLimit = Math.max(10, Math.min(Number(options.observationLimit) || 40, 60));
  const heldCodes = new Set(existing.map((item) => item.code));
  const observationUniverse = [...universe]
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    .slice(0, observationLimit);
  for (const item of universe) {
    const watched = watchlist.some((key) => normalizeLookupText(item.code).includes(key) || normalizeLookupText(item.name).includes(key));
    if ((heldCodes.has(item.code) || watched) && !observationUniverse.some((row) => row.code === item.code)) observationUniverse.push(item);
  }
  const lastObservationAt = Number(paperObservationRuntime.get(account.id) || 0);
  if (!dryRun && Date.now() - lastObservationAt >= 5 * 60 * 1000) {
    store.savePaperIntradayObservations(account.id, observationUniverse);
    paperObservationRuntime.set(account.id, Date.now());
  }
  const intradayByCode = new Map();
  for (const row of store.listPaperIntradayObservations(account.id, "", shanghaiDateKey(), 1200)) {
    if (!intradayByCode.has(row.code)) intradayByCode.set(row.code, []);
    intradayByCode.get(row.code).push(row);
  }
  const eventContexts = new Map(universe.map((item) => [item.code, paperIntradayReference(item, config, account.id, intradayByCode.get(item.code) || [])]));
  const environmentBlock = paperEnvironmentBlockReason(environment, config);
  if (environmentBlock) decisions.push(`${environmentBlock}${Number.isFinite(environment.changePct) ? `（上证 ${environment.changePct.toFixed(2)}%）` : ""}`);
  for (const position of existing) {
    const quote = quoteMap.get(position.code);
    if (!quote || !Number.isFinite(Number(quote.price))) continue;
    const price = Number(quote.price);
    const highPrice = Math.max(Number(position.high_price || position.last_price || position.avg_cost), price);
    if (!dryRun) store.markPaperPosition(account.id, position.code, price, highPrice);
    const change = Number(quote.change_pct);
    const returnPct = position.avg_cost ? (price / Number(position.avg_cost) - 1) * 100 : null;
    const drawdownFromHigh = highPrice ? (price / highPrice - 1) * 100 : null;
    const holdingDays = position.entry_at ? Math.max(0, (Date.now() - new Date(position.entry_at).getTime()) / 86400000) : null;
    const exitReasons = [];
    const event = eventContexts.get(position.code) || { sellFraction: 0, reasons: [] };
    if (Number.isFinite(change) && change <= config.sellStop) exitReasons.push(`日内跌幅 ${change.toFixed(2)}% 触发止损 ${config.sellStop}%`);
    if (Number.isFinite(returnPct) && returnPct >= config.takeProfit) exitReasons.push(`持仓收益 ${returnPct.toFixed(2)}% 触发止盈 ${config.takeProfit}%`);
    if (Number.isFinite(drawdownFromHigh) && drawdownFromHigh <= -Math.abs(config.trailingStop) && highPrice > Number(position.avg_cost)) exitReasons.push(`距持仓高点回撤 ${drawdownFromHigh.toFixed(2)}% 触发移动止盈`);
    if (Number.isFinite(holdingDays) && config.maxHoldingDays > 0 && holdingDays >= config.maxHoldingDays) exitReasons.push(`持仓 ${holdingDays.toFixed(1)} 天达到上限`);
    if (exitReasons.length) {
      if (!allowSell) {
        decisions.push(`仅执行补仓：跳过 ${position.name || position.code} 的卖出信号`);
        continue;
      }
      if (sellsToday >= maxSellsPerDay || buysToday + sellsToday >= maxActionsPerDay) {
        decisions.push(`卖出上限：今日卖出 ${sellsToday}/${maxSellsPerDay} 笔`);
        continue;
      }
      const sellable = options.sameDaySellAllowed ? Number(position.quantity) : store.getPaperSellableQuantity(account.id, position.code);
      if (sellable <= 0) {
        decisions.push(`T+1限制：${position.name} 今日买入数量暂不卖出`);
      } else {
        const quantity = Math.min(position.quantity, sellable);
        const settlementNote = options.sameDaySellAllowed ? "当日临时解除T+1" : "遵守 T+1";
        const order = dryRun
          ? { side: "SELL", code: position.code, name: position.name, market: position.market, quantity, price, amount: quantity * price, fee: quantity * price * 0.0003, strategy, reason: `${exitReasons.join("；")}；${settlementNote}${executionNote}` }
          : store.applyPaperTrade({ accountId: account.id, side: "SELL", code: position.code, name: position.name, market: position.market, quantity, price, fee: quantity * price * 0.0003, strategy, reason: `${exitReasons.join("；")}；${settlementNote}${executionNote}`, source, skipT1: Boolean(options.sameDaySellAllowed) });
        actions.push({ type: "SELL", order, reason: order.reason });
        sellsToday += 1;
        if (quantity >= Number(position.quantity)) {
          adjustPaperOwnerPortfolio(ownerPortfolio, { ...position, paper_theme: paperCandidateTheme({ ...position, ...quote }) }, -1);
        }
        if (dryRun && quantity >= Number(position.quantity)) simulatedClosedCodes.add(position.code);
      }
    }
  }
  let refreshedPositions = store.listPaperPositions(account.id).filter((item) => !simulatedClosedCodes.has(item.code));
  const held = new Set(refreshedPositions.map((item) => item.code));
  let totalExposure = refreshedPositions.reduce((sum, item) => sum + item.quantity * Number(quoteMap.get(item.code)?.price || item.last_price || item.avg_cost), 0);
  // 卖出处理结束后重新读取现金；后续每笔买入都会即时扣减，避免同一轮批量下单超出可用资金。
  let availableCash = Number(store.getPaperAccount(account.id, null)?.cash ?? account.cash ?? 0);
  const recentOrders = store.listPaperOrders(account.id, 500);
  const decisionRows = [];
  let candidates = (allowBuy ? universe : []).filter((item) => {
    let reason = "通过";
    let signal = null;
    let awaitingConfirmation = false;
    const itemTheme = paperCandidateTheme(item);
    const event = eventContexts.get(item.code) || { buyBlocked: true, buyReason: "盘中样本不足" };
    if (held.has(item.code)) reason = "已有持仓";
    else if (paperRiskName(item)) reason = "ST、停牌或价格无效";
    else if (config.market !== "all" && item.market !== config.market) reason = `范围限制：${config.market}`;
    else if (watchlist.length && !watchlist.some((key) => normalizeLookupText(item.code).includes(key) || normalizeLookupText(item.name).includes(key))) reason = "不在自选范围";
    else if ((ownerPortfolio.codeCounts.get(item.code) || 0) >= config.maxPortfolioCodeCopies) reason = "跨账户重复代码已达上限";
    else if ((ownerPortfolio.themeCounts.get(itemTheme) || 0) >= config.maxPortfolioThemeCopies) reason = "跨账户同主题已达上限";
    else if (refreshedPositions.filter((position) => paperCandidateTheme({ ...position, ...quoteMap.get(position.code) }) === itemTheme).length >= config.maxThemePositions) reason = "当前账户同主题已达上限";
    else if (environmentBlock) reason = environmentBlock;
    else if (config.name === "自定义策略" && config.conditions?.length && !matchesConditions(item, config.conditions, config.logic)) reason = "自定义条件未满足";
    else if (config.name !== "自定义策略" && (!Number.isFinite(Number(item.change_pct)) || Number(item.change_pct) < config.minChange || Number(item.change_pct) > config.maxChange)) reason = "涨跌幅未满足";
    else if (config.name !== "自定义策略" && (!Number.isFinite(Number(item.volume_ratio)) || Number(item.volume_ratio) < config.minVolume)) reason = "量比未满足";
    else if (Number(config.minAmount) > 0 && (!Number.isFinite(Number(item.amount)) || Number(item.amount) < config.minAmount)) reason = "成交额不足";
    else if (Number.isFinite(config.minTurnover) && (!Number.isFinite(Number(item.turnover_rate)) || Number(item.turnover_rate) < config.minTurnover)) reason = "换手率不足";
    else if (Number.isFinite(config.maxTurnover) && Number(item.turnover_rate) > config.maxTurnover) reason = "换手率过高";
    else {
      signal = evaluatePaperSignal(item, config);
      if (!signal.pass) reason = signal.reason;
      else if (options.auto) {
        if (!entryPhase.allowBuy) reason = entryPhase.label;
        else if (dryRun) reason = "自动试跑：实盘调度需要连续两轮确认";
        else {
          const confirmation = paperEntryConfirmation(account.id, item, entryPhase, true);
          if (!confirmation.confirmed) {
            awaitingConfirmation = true;
            reason = `等待连续确认（${confirmation.count}/2）`;
          }
        }
      }
    }
    if (reason === "通过") {
      const lastOrder = recentOrders.find((order) => order.code === item.code);
      const ageMinutes = lastOrder ? (Date.now() - new Date(String(lastOrder.created_at).replace(" ", "T") + "Z").getTime()) / 60000 : Infinity;
      if (ageMinutes < config.cooldownMinutes) reason = `冷却中：${Math.ceil(config.cooldownMinutes - ageMinutes)} 分钟`;
    }
    // 连续确认的首轮不能被当前循环当作失败立即清空，否则永远无法从 1/2 到达 2/2。
    if (options.auto && !dryRun && reason !== "通过" && !awaitingConfirmation) paperEntryConfirmation(account.id, item, entryPhase, false);
    item.paper_theme = itemTheme;
    if (decisionRows.length < 80) decisionRows.push({ code: item.code, name: item.name, market: item.market, theme: item.paper_theme, passed: reason === "通过", reason, signal_score: signal?.score ?? null, event: event.observation || "" });
    item.signal_score = signal?.score ?? 0;
    item.signal_reason = signal?.reason || "基础条件通过";
    return reason === "通过";
  }).sort((a, b) => (Number(b.signal_score || 0) * 10 + Number(b.change_pct || 0) + Number(b.volume_ratio || 0) * 0.8 + Number(b.amount || 0) / Math.max(config.minAmount || 1, 1) * 0.1) - (Number(a.signal_score || 0) * 10 + Number(a.change_pct || 0) + Number(a.volume_ratio || 0) * 0.8 + Number(a.amount || 0) / Math.max(config.minAmount || 1, 1) * 0.1));
  if (allowBuy && !candidates.length && options.auto && refreshedPositions.length < config.minPositions && entryPhase.allowBuy && !environmentBlock) {
    const minimumAmount = Math.max(20_000_000, Number(config.minAmount || 0) * 0.25);
    const fallbackRows = universe
      .filter((item) => !held.has(item.code) && !paperRiskName(item))
      .filter((item) => config.market === "all" || item.market === config.market)
      .filter((item) => !watchlist.length || watchlist.some((key) => normalizeLookupText(item.code).includes(key) || normalizeLookupText(item.name).includes(key)))
      .filter((item) => Number.isFinite(Number(item.price)) && Number(item.price) > 0)
      .filter((item) => Number.isFinite(Number(item.change_pct)) && Number(item.change_pct) >= -2.5 && Number(item.change_pct) <= 4)
      .filter((item) => Number.isFinite(Number(item.volume_ratio)) && Number(item.volume_ratio) >= 0.5)
      .filter((item) => Number.isFinite(Number(item.amount)) && Number(item.amount) >= minimumAmount)
      .map((item) => {
        const signal = evaluatePaperSignal(item, config);
        if (!signal.pass) return null;
        if (dryRun) return { ...item, signal_score: signal.score ?? 20, signal_reason: `${signal.reason}；最低仓位候选`, paper_minimum_exposure: true };
        const confirmation = paperEntryConfirmation(account.id, item, entryPhase, true);
        if (!confirmation.confirmed) {
          if (decisionRows.length < 80) decisionRows.push({ code: item.code, name: item.name, market: item.market, theme: paperCandidateTheme(item), passed: false, reason: `最低仓位等待连续确认（${confirmation.count}/2）`, signal_score: signal.score ?? null, event: "" });
          return null;
        }
        return { ...item, signal_score: signal.score ?? 20, signal_reason: `${signal.reason}；最低仓位候选`, paper_minimum_exposure: true };
      }).filter(Boolean)
      .sort((a, b) => paperFocusScore(b, config) - paperFocusScore(a, config));
    if (fallbackRows.length) {
      candidates = fallbackRows;
      decisions.push(`当前持仓少于最低 ${config.minPositions} 只，启用最低仓位候选`);
    }
  }
  const selectedCandidates = diversifyPaperCandidates(candidates, Math.max(config.maxPositions * 2, 6));
  let exposure = totalExposure;
  const replacementNotes = new Map();
  const protectedCodes = new Set();
  for (const candidate of selectedCandidates) {
    if (buysToday >= maxBuysPerDay || buysToday + sellsToday >= maxActionsPerDay) {
      const reason = `买入次数已满：${buysToday}/${maxBuysPerDay} 笔`;
      decisions.push(reason);
      decisionRows.push({ code: "组合约束", name: "组合约束", market: "", theme: "", passed: false, reason, signal_score: null, event: "本轮其余候选不再下单" });
      break;
    }
    if (environmentBlock) {
      const reason = `${environmentBlock}${Number.isFinite(environment.changePct) ? `：上证 ${environment.changePct.toFixed(2)}%` : ""}`;
      decisions.push(reason);
      decisionRows.push({ code: "市场环境", name: "市场环境", market: "", theme: "", passed: false, reason, signal_score: null, event: "不新增仓位" });
      break;
    }
    const positionCount = refreshedPositions.length;
    if (positionCount >= config.maxPositions) {
      if (!allowSell) {
        const reason = `仅执行补仓：持仓已满 ${positionCount}/${config.maxPositions} 个`;
        decisions.push(reason);
        if (decisionRows.length < 90) decisionRows.push({ code: candidate.code, name: candidate.name, market: candidate.market, theme: candidate.paper_theme || "", passed: false, reason, signal_score: candidate.signal_score ?? null, event: "" });
        continue;
      }
      const replacement = findPaperReplacement(account, refreshedPositions, candidate, quoteMap, config, { ...options, protectedCodes });
      if (!replacement || replacement.blocked) {
        const reason = replacement?.blocked || `持仓已满：${positionCount}/${config.maxPositions} 个`;
        decisions.push(reason);
        if (decisionRows.length < 90) decisionRows.push({ code: candidate.code, name: candidate.name, market: candidate.market, theme: candidate.paper_theme || "", passed: false, reason, signal_score: candidate.signal_score ?? null, event: "" });
        continue;
      }
      if (sellsToday >= maxSellsPerDay || buysToday + sellsToday >= maxActionsPerDay) {
        const reason = `换仓受限：今日卖出 ${sellsToday}/${maxSellsPerDay} 笔`;
        decisions.push(reason);
        if (decisionRows.length < 90) decisionRows.push({ code: candidate.code, name: candidate.name, market: candidate.market, theme: candidate.paper_theme || "", passed: false, reason, signal_score: candidate.signal_score ?? null, event: "" });
        continue;
      }
      const old = replacement.position;
      const oldQuote = quoteMap.get(old.code);
      const oldPrice = Number(oldQuote?.price || old.last_price || old.avg_cost);
      if (!Number.isFinite(oldPrice) || oldPrice <= 0) {
        const reason = `换仓失败：${old.name || old.code} 缺少有效实时价格`;
        decisions.push(reason);
        continue;
      }
      const sellQuantity = Math.min(Number(old.quantity), Number(replacement.sellable));
      const sellAmount = sellQuantity * oldPrice;
      const sellFee = sellAmount * 0.0003;
      const replacementReason = `强弱替换：候选强度 ${replacement.candidateStrength.toFixed(1)}，高于 ${old.name || old.code} 的 ${replacement.strength.toFixed(1)}（差 ${replacement.gap.toFixed(1)}）`;
      const settlementNote = options.sameDaySellAllowed ? "当日临时解除T+1" : "遵守 T+1";
      const sellOrder = dryRun
        ? { side: "SELL", code: old.code, name: old.name, market: old.market, quantity: sellQuantity, price: oldPrice, amount: sellAmount, fee: sellFee, strategy, reason: `${replacementReason}；${settlementNote}${executionNote}` }
        : store.applyPaperTrade({ accountId: account.id, side: "SELL", code: old.code, name: old.name, market: old.market, quantity: sellQuantity, price: oldPrice, fee: sellFee, strategy, reason: `${replacementReason}；${settlementNote}${executionNote}`, source, skipT1: Boolean(options.sameDaySellAllowed) });
      actions.push({ type: "SELL", order: sellOrder, reason: sellOrder.reason });
      sellsToday += 1;
      availableCash += sellAmount - sellFee;
      exposure = Math.max(0, exposure - sellAmount);
      refreshedPositions = refreshedPositions.filter((item) => item.code !== old.code);
      held.delete(old.code);
      adjustPaperOwnerPortfolio(ownerPortfolio, { ...old, paper_theme: paperCandidateTheme({ ...old, ...oldQuote }) }, -1);
      replacementNotes.set(candidate.code, replacementReason);
    }
    if (exposure >= account.initial_cash * config.maxExposure) {
      const currentPct = account.initial_cash ? exposure / account.initial_cash * 100 : 0;
      const limitPct = config.maxExposure * 100;
      const reason = `总仓位已满：${currentPct.toFixed(1)}%/${limitPct.toFixed(0)}%`;
      decisions.push(reason);
      decisionRows.push({ code: "组合约束", name: "组合约束", market: "", theme: "", passed: false, reason, signal_score: null, event: `候选 ${candidate.name || candidate.code} 暂不买入` });
      break;
    }
    const price = Number(candidate.price);
    const targetValue = Math.min(
      account.initial_cash * config.perPosition * paperEnvironmentPositionMultiplier(environment, config),
      account.initial_cash * config.maxPositionExposure,
      account.initial_cash * config.maxExposure - exposure,
      availableCash / 1.0003
    );
    const quantity = Math.floor(targetValue / price / 100) * 100;
    if (quantity < 100) {
      const reason = `可用资金不足：不足 1 手 ${candidate.name || candidate.code}`;
      decisions.push(reason);
      if (decisionRows.length < 90) decisionRows.push({ code: candidate.code, name: candidate.name, market: candidate.market, theme: candidate.paper_theme || "", passed: false, reason, signal_score: candidate.signal_score ?? null, event: "" });
      continue;
    }
    const event = eventContexts.get(candidate.code);
    const reference = event?.observation && event.observation !== "未启用盘中形态参考" ? `；盘中参考：${event.observation}` : "";
    const replacementNote = replacementNotes.get(candidate.code) ? `；${replacementNotes.get(candidate.code)}` : "";
    const orderReason = `触发：${candidate.signal_reason || "基础条件通过"}；${entryLabel}；主题 ${candidate.paper_theme || "未分类"}；涨跌幅 ${Number(candidate.change_pct).toFixed(2)}%，量比 ${Number(candidate.volume_ratio).toFixed(2)}，成交额 ${Number(candidate.amount || 0).toFixed(0)}${reference}${replacementNote}；进入分散观察组合${executionNote}`;
    const amount = quantity * price;
    const fee = amount * 0.0003;
    if (amount + fee > availableCash + 0.000001) {
      const reason = `可用资金不足：${candidate.name || candidate.code} 需要 ${Math.round(amount + fee)} 元`;
      decisions.push(reason);
      if (decisionRows.length < 90) decisionRows.push({ code: candidate.code, name: candidate.name, market: candidate.market, theme: candidate.paper_theme || "", passed: false, reason, signal_score: candidate.signal_score ?? null, event: "" });
      continue;
    }
    const order = dryRun
      ? { side: "BUY", code: candidate.code, name: candidate.name, market: candidate.market, quantity, price, amount, fee, strategy, reason: orderReason }
      : store.applyPaperTrade({ accountId: account.id, side: "BUY", code: candidate.code, name: candidate.name, market: candidate.market, quantity, price, fee, strategy, reason: orderReason, source });
    actions.push({ type: "BUY", order, reason: order.reason });
    buysToday += 1;
    exposure += amount;
    availableCash -= amount + fee;
    held.add(candidate.code);
    // 同一轮刚建的仓位不参与后续候选的换仓比较，避免一次调仓反复买卖。
    protectedCodes.add(candidate.code);
    refreshedPositions.push({ code: candidate.code, name: candidate.name, market: candidate.market, quantity, avg_cost: price, last_price: price, high_price: price });
    adjustPaperOwnerPortfolio(ownerPortfolio, candidate, 1);
  }
  if (!dryRun) syncFutuSubscriptions(account.id);
  const status = buildPaperStatus(store.getPaperAccount(account.id, null), !dryRun, quoteMap);
  const passedCount = decisionRows.filter((item) => item.passed).length;
  const reasonCounts = decisionRows.reduce((map, item) => map.set(item.reason, (map.get(item.reason) || 0) + 1), new Map());
  const topRejection = [...reasonCounts.entries()].filter(([reason]) => reason !== "通过").sort((a, b) => b[1] - a[1])[0];
  const idleReason = topRejection ? `本轮无触发：${topRejection[0]}（${topRejection[1]} 条）` : `本轮无触发：${passedCount} 个候选通过初筛，但未达到仓位或持仓上限`;
  return { strategy, strategyKey: options.strategy || "trend", rules: config, environment, entryPhase, actions, decisionRows, eventSummary: [...eventContexts.values()].flatMap((item) => item.reasons || []).slice(0, 20), decisions: actions.length ? [...actions.map((item) => item.reason), ...decisions] : (decisions.length ? decisions : [idleReason]), ...status };
}

function directorySizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    total += entry.isDirectory() ? directorySizeBytes(target) : fs.statSync(target).size;
  }
  return total;
}

function safeTimestampAgeMinutes(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 60000)) : null;
}

function hasStaleCoreData() {
  return ["markets", "stocks", "etfs"].some((key) => {
    const snapshot = store.getSnapshot(key, key === "markets" ? "markets" : key);
    const age = safeTimestampAgeMinutes(snapshot.updatedAt);
    return snapshot.status === "fallback" || age === null || age > 5;
  });
}

function hasStalePaperData(config = {}) {
  const keys = ["markets"];
  if (config.market !== "ETF") keys.push("stocks");
  if (config.market !== "A股") keys.push("etfs");
  return keys.some((key) => {
    const snapshot = store.getSnapshot(key, key === "markets" ? "markets" : key);
    const age = safeTimestampAgeMinutes(snapshot.updatedAt);
    return snapshot.status === "fallback" || age === null || age > 5;
  });
}

function paperDataHealth(config = {}) {
  const keys = ["markets"];
  if (config.market !== "ETF") keys.push("stocks");
  if (config.market !== "A股") keys.push("etfs");
  const labels = { markets: "A股指数", stocks: "A股股票", etfs: "ETF" };
  const feeds = keys.map((key) => {
    const snapshot = store.getSnapshot(key, key === "markets" ? "markets" : key);
    const ageMinutes = safeTimestampAgeMinutes(snapshot.updatedAt);
    const fresh = snapshot.status !== "fallback" && ageMinutes !== null && ageMinutes <= 5;
    return {
      key,
      label: labels[key] || key,
      source: snapshot.source || "暂无来源",
      updatedAt: snapshot.updatedAt || "",
      ageMinutes,
      status: fresh ? "fresh" : (snapshot.status === "fallback" ? "fallback" : "stale")
    };
  });
  const stale = feeds.some((item) => item.status !== "fresh");
  return {
    status: stale ? "blocked" : "fresh",
    checkedAt: new Date().toISOString(),
    feeds,
    summary: stale ? "行情不新鲜，本轮不执行自动模拟" : "所需行情均在 5 分钟内"
  };
}

function healthLevel(value, warning, danger) {
  return value >= danger ? "danger" : value >= warning ? "warning" : "ok";
}

function readMaintenanceEntries(limit = 20) {
  if (!fs.existsSync(maintenanceLogPath)) return [];
  return fs.readFileSync(maintenanceLogPath, "utf8").split(/\r?\n/).filter(Boolean).slice(-Math.max(limit * 3, limit)).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean).slice(-limit).reverse();
}

function parseWorkBuddyScalar(value = "") {
  const text = String(value).trim();
  if (!text) return "";
  if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text.replace(/^['"]|['"]$/g, "");
}

function parseWorkBuddyResearchReport(raw, slot, fileName, filePath) {
  const match = String(raw || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const meta = { tags: { sector: [], etf: [] } };
  let tagsMode = false;
  for (const line of match[1].split(/\r?\n/)) {
    const tag = line.match(/^\s{2}([a-z_]+):\s*(.+)$/i);
    const field = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (tag && tagsMode) {
      const value = parseWorkBuddyScalar(tag[2]);
      meta.tags[tag[1]] = Array.isArray(value) ? value.map(String) : [];
    } else if (field) {
      tagsMode = field[1] === "tags";
      if (!tagsMode) meta[field[1]] = parseWorkBuddyScalar(field[2]);
    }
  }
  const bodyWithEntries = match[2];
  const riskRadar = /<!--\s*entry:risk_radar\s*=\s*true\s*-->/i.test(bodyWithEntries);
  const basisMatch = bodyWithEntries.match(/<!--\s*entry:research_basis\s*=\s*(\[[\s\S]*?\])\s*-->/i);
  let basis = [];
  try { basis = basisMatch ? JSON.parse(basisMatch[1]) : []; } catch { basis = []; }
  const body = bodyWithEntries.replace(/<!--[\s\S]*?-->/g, "").trim();
  return {
    slot,
    fileName,
    filePath,
    meta,
    body,
    html: renderWorkBuddyMarkdown(body),
    entries: { riskRadar, researchBasis: Array.isArray(basis) ? basis.slice(0, 12) : [] },
    updatedAt: fs.statSync(filePath).mtime.toISOString(),
    isToday: fileName === `${shanghaiDateKey()}.md`
  };
}

function escapeReportHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inlineWorkBuddyMarkdown(value) {
  return escapeReportHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
}

function splitWorkBuddyTableRow(line) {
  return String(line || "").trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function renderWorkBuddyMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineWorkBuddyMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (line.startsWith("|") && /^\|?\s*:?-{3,}/.test(String(lines[index + 1] || "").trim())) {
      const headers = splitWorkBuddyTableRow(line);
      index += 2;
      const rows = [];
      while (String(lines[index] || "").trim().startsWith("|")) { rows.push(splitWorkBuddyTableRow(lines[index])); index += 1; }
      out.push(`<div class="workbuddy-markdown-table"><table><thead><tr>${headers.map((cell) => `<th>${inlineWorkBuddyMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${inlineWorkBuddyMarkdown(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (/^[-*]\s+/.test(String(lines[index] || "").trim())) { items.push(String(lines[index]).trim().replace(/^[-*]\s+/, "")); index += 1; }
      out.push(`<ul>${items.map((item) => `<li>${inlineWorkBuddyMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (line.startsWith(">")) {
      const quotes = [];
      while (String(lines[index] || "").trim().startsWith(">")) { quotes.push(String(lines[index]).trim().replace(/^>\s?/, "")); index += 1; }
      out.push(`<blockquote>${quotes.map(inlineWorkBuddyMarkdown).join("<br>")}</blockquote>`);
      continue;
    }
    const paragraph = [];
    while (index < lines.length) {
      const current = String(lines[index] || "").trim();
      if (!current || /^(#{1,3})\s+/.test(current) || current.startsWith("|") || /^[-*]\s+/.test(current) || current.startsWith(">")) break;
      paragraph.push(current);
      index += 1;
    }
    if (paragraph.length) out.push(`<p>${paragraph.map(inlineWorkBuddyMarkdown).join("<br>")}</p>`);
    else index += 1;
  }
  return out.join("\n");
}

function readWorkBuddyResearchReport(slot) {
  const allowed = new Set(["pre-market", "midday", "closing"]);
  if (!allowed.has(String(slot))) return null;
  const dir = path.join(workBuddyResearchDir, String(slot));
  if (!fs.existsSync(dir)) return null;
  const todayFile = path.join(dir, `${shanghaiDateKey()}.md`);
  let target = fs.existsSync(todayFile) ? todayFile : "";
  if (!target) {
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(dir, entry.name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    target = files[0] || "";
  }
  if (!target) return null;
  try { return parseWorkBuddyResearchReport(fs.readFileSync(target, "utf8"), String(slot), path.basename(target), target); } catch { return null; }
}

function isMarketReportSession(value) {
  return new Set(["pre-market", "midday", "closing"]).has(String(value));
}

function isMarketReportDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function listAvailableMarketReports() {
  if (!fs.existsSync(marketReportsDir)) return [];
  return fs.readdirSync(marketReportsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isMarketReportDate(entry.name))
    .map((entry) => {
      const dir = path.join(marketReportsDir, entry.name);
      return {
        date: entry.name,
        "pre-market": fs.existsSync(path.join(dir, "pre-market.md")),
        midday: fs.existsSync(path.join(dir, "midday.md")),
        closing: fs.existsSync(path.join(dir, "closing.md"))
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function parseMarketReport(raw, session, resolvedDate, filePath) {
  const parsed = parseWorkBuddyResearchReport(raw, session, `${session}.md`, filePath);
  const report = parsed || {
    slot: session,
    fileName: `${session}.md`,
    filePath,
    meta: { tags: { sector: [], etf: [] } },
    body: String(raw || "").trim(),
    html: renderWorkBuddyMarkdown(String(raw || "").trim()),
    entries: { riskRadar: false, researchBasis: [] },
    updatedAt: fs.statSync(filePath).mtime.toISOString()
  };
  report.isToday = resolvedDate === shanghaiDateKey();
  report.resolvedDate = resolvedDate;
  return report;
}

function readMarketReport(session, requestedDate) {
  const available = listAvailableMarketReports();
  const sameDay = available.find((item) => item.date === requestedDate && item[session]);
  const latestPrior = available.find((item) => item.date <= requestedDate && item[session]);
  const selected = sameDay || latestPrior;
  if (!selected) return null;
  const filePath = path.join(marketReportsDir, selected.date, `${session}.md`);
  try {
    return {
      resolvedDate: selected.date,
      isFallback: selected.date !== requestedDate,
      report: parseMarketReport(fs.readFileSync(filePath, "utf8"), session, selected.date, filePath)
    };
  } catch {
    return null;
  }
}

function getDingTalkConfig() {
  try {
    if (!fs.existsSync(dingTalkConfigPath)) return { configured: false, enabled: false, pollSeconds: 120 };
    const raw = JSON.parse(fs.readFileSync(dingTalkConfigPath, "utf8"));
    const webhook = String(process.env.DINGTALK_ROBOT_WEBHOOK || raw.webhook || "").trim();
    const secret = String(process.env.DINGTALK_ROBOT_SECRET || raw.secret || "").trim();
    const pollSeconds = Math.max(60, Math.min(1800, Number(raw.pollSeconds) || 120));
    let validWebhook = false;
    try {
      const url = new URL(webhook);
      validWebhook = url.protocol === "https:" && url.hostname === "oapi.dingtalk.com" && url.pathname === "/robot/send" && Boolean(url.searchParams.get("access_token"));
    } catch {
      validWebhook = false;
    }
    return {
      configured: validWebhook && Boolean(secret),
      enabled: raw.enabled !== false,
      webhook,
      secret,
      pollSeconds
    };
  } catch {
    return { configured: false, enabled: false, pollSeconds: 120 };
  }
}

function readDingTalkPushState() {
  try {
    if (!fs.existsSync(dingTalkStatePath)) return { reports: {}, paper: {}, updatedAt: "" };
    const value = JSON.parse(fs.readFileSync(dingTalkStatePath, "utf8"));
    return { reports: value.reports || {}, paper: value.paper || {}, updatedAt: value.updatedAt || "" };
  } catch {
    return { reports: {}, paper: {}, updatedAt: "" };
  }
}

function writeDingTalkPushState(state) {
  fs.mkdirSync(path.dirname(dingTalkStatePath), { recursive: true });
  const next = { ...state, updatedAt: now() };
  const tempPath = `${dingTalkStatePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, dingTalkStatePath);
}

function summarizeDingTalkPushState(state) {
  const reports = Object.fromEntries(Object.entries(state.reports || {}).map(([slot, item]) => [slot, {
    date: item.date || "",
    sourceUpdatedAt: item.sourceUpdatedAt || "",
    sentAt: item.sentAt || ""
  }]));
  return {
    reports,
    paper: {
      date: state.paper?.date || "",
      orderCount: Number(state.paper?.orderCount || 0),
      sentAt: state.paper?.sentAt || ""
    },
    updatedAt: state.updatedAt || ""
  };
}

function dingTalkHash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function dingTalkTextChunks(text, limit = 18000) {
  const source = String(text || "").trim();
  if (!source) return [];
  if (source.length <= limit) return [source];
  const chunks = [];
  let rest = source;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit * 0.6)) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function sendDingTalkMarkdown(title, markdown) {
  const config = getDingTalkConfig();
  if (!config.configured || !config.enabled) throw new Error("钉钉机器人未配置或已停用");
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", config.secret).update(`${timestamp}\n${config.secret}`).digest("base64");
  const target = new URL(config.webhook);
  target.searchParams.set("timestamp", timestamp);
  target.searchParams.set("sign", signature);
  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "markdown", markdown: { title: String(title).slice(0, 80), text: String(markdown) }, at: { isAtAll: false } })
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || Number(payload?.errcode || 0) !== 0) throw new Error(payload?.errmsg || `钉钉请求失败: HTTP ${response.status}`);
  return payload;
}

function marketReportTitle(session) {
  return { "pre-market": "盘前报告", midday: "午间报告", closing: "收盘复盘" }[session] || "市场报告";
}

function dingTalkPlainText(value, limit = 150) {
  const text = String(value || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function splitDingTalkReportSections(markdown) {
  const sections = [];
  let current = { title: "摘要", level: 0, lines: [] };
  for (const rawLine of String(markdown || "").replace(/\r/g, "").split("\n")) {
    const heading = rawLine.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      if (current.lines.length || current.title !== "摘要") sections.push(current);
      current = { title: heading[2].trim(), level: heading[1].length, lines: [] };
    } else {
      current.lines.push(rawLine);
    }
  }
  if (current.lines.length || current.title !== "摘要") sections.push(current);
  return sections;
}

function findDingTalkReportSection(sections, patterns) {
  return sections.find((section) => patterns.some((pattern) => pattern.test(section.title))) || null;
}

function dingTalkSectionParagraph(section, limit = 150) {
  if (!section) return "";
  const lines = section.lines.map((line) => line.trim()).filter(Boolean)
    .filter((line) => !line.startsWith("|") && !/^[-*]\s+/.test(line) && !line.startsWith(">") && !line.startsWith("<!--"));
  return dingTalkPlainText(lines.find((line) => !/^---+$/.test(line)) || "", limit);
}

function dingTalkSectionBullets(section, limit = 3) {
  if (!section) return [];
  return section.lines.map((line) => line.trim()).filter((line) => /^[-*]\s+/.test(line))
    .map((line) => dingTalkPlainText(line.replace(/^[-*]\s+/, ""), 108)).filter(Boolean).slice(0, limit);
}

function dingTalkSectionTable(section, limit = 3) {
  if (!section) return [];
  const rows = section.lines.map((line) => line.trim()).filter((line) => line.startsWith("|"));
  if (rows.length < 3) return [];
  const parse = (line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => dingTalkPlainText(cell, 45));
  return rows.slice(2).map(parse).filter((cells) => cells.length > 1 && !cells.every((cell) => /^:?-{3,}:?$/.test(cell))).slice(0, limit)
    .map((cells) => cells.filter(Boolean).join(" · "));
}

function buildDingTalkMarketDigest(report, session, date) {
  const sections = splitDingTalkReportSections(report.body);
  const overview = findDingTalkReportSection(sections, [/大盘综述/, /市场概览/, /隔夜外盘/, /上午盘面/, /午间盘面/, /盘面表现/, /市场表现/]);
  const strong = findDingTalkReportSection(sections, [/强势板块/, /活跃板块/, /领涨板块/, /热点方向/]);
  const weak = findDingTalkReportSection(sections, [/弱势板块/, /风险雷达/, /风险提示/, /风险/]);
  const etf = findDingTalkReportSection(sections, [/ETF/]);
  const outlook = findDingTalkReportSection(sections, [/明日预判/, /下午关注/, /开盘前关注/, /观察要点/, /策略观察/]);
  const lines = [
    `# 【${marketReportTitle(session)}】${date}`,
    `> ${report.meta?.generated_at || report.updatedAt || "数据时间未标注"} · 风险等级：${report.meta?.risk_level || "未标注"}`,
    "",
    "【市场结论】",
    `- ${dingTalkSectionParagraph(overview, 168) || "报告暂未提供可提取的市场结论。"}`
  ];
  const overviewTable = dingTalkSectionTable(overview, 4);
  if (overviewTable.length) lines.push("", "【核心数据】", ...overviewTable.map((item) => `- ${item}`));
  const strongItems = dingTalkSectionBullets(strong, 3);
  if (strongItems.length) lines.push("", "【强势方向】", ...strongItems.map((item) => `- ${item}`));
  const weakItems = dingTalkSectionBullets(weak, 3);
  if (weakItems.length) lines.push("", "【风险与偏弱】", ...weakItems.map((item) => `- ${item}`));
  const etfItems = dingTalkSectionTable(etf, 3);
  if (etfItems.length) lines.push("", "【ETF观察】", ...etfItems.map((item) => `- ${item}`));
  const outlookItems = dingTalkSectionBullets(outlook, 3);
  if (outlookItems.length) lines.push("", "【后续观察】", ...outlookItems.map((item) => `- ${item}`));
  lines.push("", `> 来源：${report.meta?.source || "WorkBuddy"}。完整原文请在研究中心查看。`);
  return lines.join("\n");
}

function normalizeDingTalkFullReport(markdown) {
  let tableHeader = null;
  return String(markdown || "").replace(/\r/g, "").split("\n").flatMap((rawLine) => {
    const line = rawLine.trimEnd();
    if (/^<!--.*-->$/.test(line.trim()) || /^---+$/.test(line.trim())) return [];
    if (/WorkBuddy.*自动生成|NeoData.*金融数据|仅作为市场参考.*不构成投资建议|完整内容按原报告展示|仅供市场研究参考/.test(line)) return [];
    if (!line.trim().startsWith("|")) {
      tableHeader = null;
      return [line];
    }
    const cells = line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).filter(Boolean);
    if (!cells.length || cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return [];
    if (!tableHeader) {
      tableHeader = cells;
      return [`**${cells.join(" · ")}**`];
    }
    return [`- ${cells.join(" · ")}`];
  }).join("\n").replace(/^#\s+.+\n+/, "").trim();
}

function buildDingTalkFullReport(report, session, date) {
  const content = normalizeDingTalkFullReport(report.body);
  return [
    `# 【${marketReportTitle(session)}】${date}`,
    `> ${report.meta?.generated_at || report.updatedAt || "数据时间未标注"} · 风险等级：${report.meta?.risk_level || "未标注"}`,
    "",
    content || "报告正文为空。"
  ].join("\n");
}

async function pushMarketReportIfChanged(session, state) {
  const date = shanghaiDateKey();
  const result = readMarketReport(session, date);
  // 定时推送只认当天报告，绝不把最近交易日的旧报告当成今日更新重复发送。
  if (!result?.report || result.resolvedDate !== date) return { sent: false, reason: "今日暂无报告" };
  // WorkBuddy may revise the same report file. DingTalk is only a notification
  // channel, so each of the three daily report slots is delivered once at most.
  if (state.reports?.[session]?.date === date) return { sent: false, reason: "本时段今日已发送" };
  const report = result.report;
  const content = String(report.body || "").trim();
  if (!content) return { sent: false, reason: "报告正文为空" };
  const fullReport = buildDingTalkFullReport(report, session, date);
  const hash = dingTalkHash(`dingtalk-market-full-v1\n${date}\n${session}\n${content}`);
  if (state.reports?.[session]?.hash === hash) return { sent: false, reason: "报告未更新" };
  const chunks = dingTalkTextChunks(fullReport);
  for (let index = 0; index < chunks.length; index += 1) {
    const suffix = chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : "";
    await sendDingTalkMarkdown(`Komo ${marketReportTitle(session)}${suffix}`, chunks[index]);
  }
  state.reports = { ...(state.reports || {}), [session]: { hash, date, sourceUpdatedAt: report.updatedAt || "", sentAt: now(), deliveryPolicy: "once-per-session-per-day" } };
  return { sent: true, chunks: chunks.length, sourceUpdatedAt: report.updatedAt || "" };
}

function paperDingTalkStrategyName(auto) {
  const strategy = findPaperStrategy(auto?.config?.strategy);
  return strategy?.name || auto?.config?.strategyName || auto?.config?.strategy || "未绑定策略";
}

function buildLiyouPaperSnapshot() {
  const user = store.listUsers().find((item) => String(item.username || "").toLowerCase() === "liyou");
  if (!user) return null;
  const accounts = store.listPaperAccounts(`user:${user.id}`);
  if (!accounts.length) return null;
  const date = shanghaiDateKey();
  const accountRows = accounts.map((account) => {
    const status = buildPaperStatus(account, false);
    const auto = getPaperAutoStatus(account.id);
    const orders = (status.orders || []).filter((item) => shanghaiDateKey(item.created_at) === date).sort((a, b) => Number(a.id) - Number(b.id));
    const held = (status.positions || []).filter((item) => Number(item.quantity || 0) > 0);
    return { account, status, auto, orders, held };
  });
  const totalEquity = accountRows.reduce((sum, row) => sum + Number(row.status.account?.equity || 0), 0);
  const totalTodayPnl = accountRows.reduce((sum, row) => sum + Number(row.status.account?.today_pnl || 0), 0);
  const allOrders = accountRows.flatMap((row) => row.orders.map((order) => ({ ...order, accountName: row.account.name }))).sort((a, b) => {
    const left = new Date(String(a.created_at || "").replace(" ", "T")).getTime();
    const right = new Date(String(b.created_at || "").replace(" ", "T")).getTime();
    return left - right || Number(a.id) - Number(b.id);
  });
  const fingerprint = accountRows.map((row) => ({
    id: row.account.id,
    name: row.account.name,
    updatedAt: row.account.updated_at,
    cash: row.account.cash,
    realizedPnl: row.account.realized_pnl,
    strategy: row.auto.config.strategy,
    enabled: row.auto.config.enabled,
    rules: row.auto.config.rules,
    todayOrders: row.orders.map((order) => ({ id: order.id, side: order.side, code: order.code, quantity: order.quantity, price: order.price, createdAt: order.created_at }))
  }));
  return {
    date,
    accountRows,
    allOrders,
    totalEquity,
    totalTodayPnl,
    holdingCount: accountRows.reduce((sum, row) => sum + row.held.length, 0),
    orderCount: allOrders.length,
    orderIds: allOrders.map((item) => Number(item.id)),
    hash: dingTalkHash(`dingtalk-paper-digest-v2\n${JSON.stringify(fingerprint)}`)
  };
}

function formatDingTalkPaperAccount(row) {
  return `- **${row.account.name}** · ${paperDingTalkStrategyName(row.auto)} · ${row.auto.config.enabled ? "自动运行" : "已暂停"} · 当日 ${formatDingTalkMoney(row.status.account?.today_pnl)} · 持仓 ${row.held.length} 个`;
}

function formatDingTalkPaperOrder(order) {
  return `- ${formatDingTalkOrderTime(order.created_at)} · **${order.side === "BUY" ? "买入" : "卖出"}** · ${order.accountName} · ${order.name || "未知标的"}（${order.code}）· ${order.quantity} 股/份 · ${formatDingTalkPrice(order.price)} 元 · ${formatDingTalkTradeReason(order.reason)}`;
}

function formatDingTalkSignedMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "暂无数据";
  const text = formatDingTalkMoney(Math.abs(number));
  return `${number > 0 ? "+" : number < 0 ? "-" : ""}${text}`;
}

function formatDingTalkSignedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "暂无数据";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function formatDingTalkMarketAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "暂无数据";
  if (Math.abs(number) >= 100_000_000) return `${(number / 100_000_000).toFixed(2)}亿元`;
  if (Math.abs(number) >= 10_000) return `${(number / 10_000).toFixed(2)}万元`;
  return `${number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}元`;
}

function formatDingTalkTradeReason(value) {
  let text = String(value || "策略条件触发").replace(/\s+/g, " ").trim();
  text = text.replace(/^触发[:：]\s*/, "");
  text = text.replace(/历史趋势指标通过[；;,，]?\s*/g, "");
  text = text.replace(/(?:上午|下午)确认交易段[；;,，]?\s*/g, "");
  text = text.replace(/主题\s+[^；;，,]+[；;,，]?\s*/g, "");
  text = text.replace(/成交额\s*([0-9]+(?:\.[0-9]+)?)(?!\s*(?:亿|万|元))/g, (_match, amount) => `成交额 ${formatDingTalkMarketAmount(amount)}`);
  text = text.replace(/进入分散观察组合/g, "满足分散持仓条件");
  text = text.replace(/；\s*；/g, "；").replace(/^[；;,，]\s*/, "").trim();
  return dingTalkPlainText(text, 180);
}

function buildDingTalkPaperAccountUpdate(row, orders = []) {
  const account = row.status.account || {};
  const lines = [
    `# 【${row.account.name}】模拟交易更新`,
    "> 当日模拟交易变动",
    "",
    "## 本次交易"
  ];
  for (const order of orders) {
    const side = order.side === "BUY" ? "买入" : "卖出";
    lines.push(`- **${side}** ${order.name || "未知标的"}（${order.code}）`);
    lines.push(`  ${formatDingTalkOrderTime(order.created_at)} · ${order.quantity} 股/份 · ${formatDingTalkPrice(order.price)} 元 · 金额 ${formatDingTalkMoney(order.amount)}`);
    if (order.side === "SELL") lines.push(`  已实现盈亏：**${formatDingTalkSignedMoney(order.realized_pnl)}**`);
    lines.push(`  原因：${formatDingTalkTradeReason(order.reason)}`);
  }
  const sold = orders.filter((order) => order.side === "SELL");
  if (sold.length) {
    lines.push("", "## 卖出后状态");
    for (const order of sold) {
      const position = row.held.find((item) => String(item.code) === String(order.code));
      lines.push(`- ${order.name || order.code}：${position ? `剩余 **${position.quantity}** 股/份，现价 ${formatDingTalkPrice(position.last_price)} 元` : "本次已清仓"}`);
    }
  }
  lines.push(
    "",
    "## 实时账户",
    `- 总资产：**${formatDingTalkMoney(account.equity)}** · 当日盈亏：**${formatDingTalkSignedMoney(account.today_pnl)}**（${formatDingTalkSignedPercent(account.today_return_pct)}）`,
    `- 现金：${formatDingTalkMoney(account.cash)} · 持仓市值：${formatDingTalkMoney(account.market_value)} · 当前持仓：${row.held.length} 个`,
    "",
    "## 当前持仓"
  );
  if (!row.held.length) {
    lines.push("- 当前无持仓。");
  } else {
    for (const position of row.held) {
      lines.push(`- **${position.name}**（${position.code}）· ${position.quantity} 股/份 · 成本 ${formatDingTalkPrice(position.avg_cost)} / 现价 ${formatDingTalkPrice(position.last_price)} · 浮动 **${formatDingTalkSignedMoney(position.unrealized_pnl)}**（${formatDingTalkSignedPercent(position.unrealized_return_pct)}）`);
    }
  }
  lines.push("", `> 当前策略：${paperDingTalkStrategyName(row.auto)}。模拟研究，不构成投资建议。`);
  return lines.join("\n");
}

function buildDingTalkPaperDigest(snapshot, options = {}) {
  const mode = options.mode || "initial";
  const rows = options.accountRows || snapshot.accountRows;
  const orders = options.orders || [];
  const title = mode === "delta" ? "【模拟交易更新】" : mode === "refresh" ? "【模拟账户状态更新】" : "【模拟账户概览】";
  const lines = [
    `# ${title}`,
    `> ${snapshot.date} · 本地模拟，非真实交易`,
    "",
    "【账户总览】",
    `- 总资产：${formatDingTalkMoney(snapshot.totalEquity)}`,
    `- 当日盈亏：${formatDingTalkMoney(snapshot.totalTodayPnl)}`,
    `- 当前持仓：${snapshot.holdingCount} 个 · 当日操作：${snapshot.orderCount} 笔`,
    "",
    mode === "delta" ? "【本次新增操作】" : "【账户状态】",
    ...(mode === "delta" ? orders.map(formatDingTalkPaperOrder) : rows.map(formatDingTalkPaperAccount))
  ];
  if (mode === "initial") {
    const latest = snapshot.allOrders.slice(-5).reverse();
    lines.push("", "【最近操作】", ...(latest.length ? latest.map(formatDingTalkPaperOrder) : ["- 今日暂无模拟操作。"]));
    if (snapshot.orderCount > latest.length) lines.push(`- 其余 ${snapshot.orderCount - latest.length} 笔操作已在工作台保留。`);
    lines.push("", "【账户持仓与卖出复盘】");
    for (const row of rows) {
      const account = row.status.account || {};
      lines.push(`### ${row.account.name}`);
      lines.push(`- 总资产：**${formatDingTalkMoney(account.equity)}** · 当日盈亏：**${formatDingTalkSignedMoney(account.today_pnl)}**（${formatDingTalkSignedPercent(account.today_return_pct)}）`);
      if (row.held.length) {
        for (const position of row.held) {
          lines.push(`- 持仓 ${position.name}（${position.code}）· ${position.quantity} 股/份 · 成本 ${formatDingTalkPrice(position.avg_cost)} / 现价 ${formatDingTalkPrice(position.last_price)} · 浮动 ${formatDingTalkSignedMoney(position.unrealized_pnl)}`);
        }
      } else {
        lines.push("- 当前无持仓。");
      }
      const sells = row.orders.filter((order) => order.side === "SELL");
      for (const order of sells) {
        lines.push(`- 卖出 ${order.name}（${order.code}）· 已实现 ${formatDingTalkSignedMoney(order.realized_pnl)} · 原因：${formatDingTalkTradeReason(order.reason)}`);
      }
    }
  }
  lines.push("", "> 仅推送新增交易或账户/策略变化，完整持仓和日志请在模拟操作页查看。");
  return lines.join("\n");
}

function formatDingTalkOrderTime(value) {
  const raw = String(value || "").trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value || "--");
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatDingTalkMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}元` : "暂无数据";
}

function formatDingTalkPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : "暂无";
}

async function pushLiyouPaperIfChanged(state, options = {}) {
  const snapshot = buildLiyouPaperSnapshot();
  if (!snapshot) return { sent: false, reason: "未找到 Liyou 模拟账户" };
  const previous = state.paper || {};
  const dailySummary = Boolean(options.dailySummary);
  const summaryAlreadySent = previous.dailySummaryDate === snapshot.date;
  const previousOrderIds = new Set(Array.isArray(previous.orderIds) ? previous.orderIds.map(Number) : []);
  const newOrders = snapshot.allOrders.filter((order) => !previousOrderIds.has(Number(order.id)));
  // 盘中只推送真实新增订单；账户汇总仅由 15:15 的定时任务发送。
  if (dailySummary && summaryAlreadySent) return { sent: false, reason: "今日账户汇总已发送" };
  if (!dailySummary && !newOrders.length) return { sent: false, reason: "无新增模拟订单" };
  const mode = dailySummary ? "initial" : "delta";
  let chunksSent = 0;
  if (dailySummary) {
    const chunks = dingTalkTextChunks(buildDingTalkPaperDigest(snapshot, { mode }));
    for (let index = 0; index < chunks.length; index += 1) {
      const suffix = chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : "";
      await sendDingTalkMarkdown(`Komo Liyou 模拟账户汇总${suffix}`, chunks[index]);
    }
    chunksSent += chunks.length;
  } else {
    for (const row of snapshot.accountRows) {
      const accountOrders = newOrders.filter((order) => order.accountName === row.account.name);
      if (!accountOrders.length) continue;
      const chunks = dingTalkTextChunks(buildDingTalkPaperAccountUpdate(row, accountOrders));
      for (let index = 0; index < chunks.length; index += 1) {
        const suffix = chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : "";
        await sendDingTalkMarkdown(`Komo Liyou · ${row.account.name}${suffix}`, chunks[index]);
      }
      chunksSent += chunks.length;
    }
  }
  state.paper = {
    ...previous,
    layoutVersion: "dingtalk-paper-digest-v2",
    hash: snapshot.hash,
    date: snapshot.date,
    dailySummaryDate: dailySummary ? snapshot.date : previous.dailySummaryDate || "",
    orderCount: snapshot.orderCount,
    orderIds: snapshot.orderIds,
    sentAt: now()
  };
  return { sent: true, chunks: chunksSent, orderCount: snapshot.orderCount, mode };
}

const dingTalkDeliverySchedule = Object.freeze([
  { session: "pre-market", at: 9 * 60 + 30, label: "09:30 盘前报告" },
  { session: "midday", at: 11 * 60 + 40, label: "11:40 午间报告" },
  { session: "closing", at: 15 * 60 + 15, label: "15:15 收盘复盘" }
]);

function getDueDingTalkReportSessions(date = new Date()) {
  if (!isAshareMarketDay(date)) return [];
  const clock = shanghaiClock(date);
  // Keep a short tolerance for timer drift, but never replay a missed report later in the day.
  return dingTalkDeliverySchedule.filter((item) => clock.total >= item.at && clock.total < item.at + 4);
}

async function runDingTalkPushTick() {
  const config = getDingTalkConfig();
  dingTalkRuntime.active = Boolean(config.configured && config.enabled);
  if (!dingTalkRuntime.active || dingTalkRuntime.running) return;
  dingTalkRuntime.running = true;
  dingTalkRuntime.lastCheckAt = now();
  try {
    const state = readDingTalkPushState();
    const results = {};
    const errors = [];
    if (!isAshareMarketDay()) {
      dingTalkRuntime.results = { schedule: { sent: false, reason: "非交易日，不读取报告或模拟账户" } };
      dingTalkRuntime.lastSuccessAt = now();
      dingTalkRuntime.lastError = "";
      return;
    }
    const dueReports = getDueDingTalkReportSessions();
    for (const { session } of dueReports) {
      try {
        results[session] = await pushMarketReportIfChanged(session, state);
        // Each source gets its own acknowledgement. A later paper-account error
        // must not cause an already delivered report to be sent again.
        if (results[session].sent) writeDingTalkPushState(state);
      } catch (error) {
        results[session] = { sent: false, error: String(error.message || error).slice(0, 240) };
        errors.push(`${marketReportTitle(session)}：${results[session].error}`);
      }
    }
    try {
      const clock = shanghaiClock();
      const closingSummaryDue = dueReports.some((item) => item.session === "closing");
      const canCheckOrderUpdates = isAshareTradingTime();
      if (closingSummaryDue) {
        results.paper = await pushLiyouPaperIfChanged(state, { dailySummary: true });
      } else if (canCheckOrderUpdates) {
        results.paper = await pushLiyouPaperIfChanged(state);
      } else {
        results.paper = { sent: false, reason: "等待盘中订单更新或 15:15 账户汇总", clock: `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}` };
      }
      if (results.paper.sent) writeDingTalkPushState(state);
    } catch (error) {
      results.paper = { sent: false, error: String(error.message || error).slice(0, 240) };
      errors.push(`模拟账户：${results.paper.error}`);
    }
    writeDingTalkPushState(state);
    dingTalkRuntime.results = results;
    if (errors.length) dingTalkRuntime.lastError = errors.join("；");
    else {
      dingTalkRuntime.lastSuccessAt = now();
      dingTalkRuntime.lastError = "";
    }
  } catch (error) {
    // Keep the last successful hash untouched so the next scheduled check retries the unsent update.
    dingTalkRuntime.lastError = String(error.message || error).slice(0, 240);
  } finally {
    dingTalkRuntime.running = false;
  }
}

function startDingTalkPushLoop() {
  if (dingTalkRuntime.timer) clearInterval(dingTalkRuntime.timer);
  const config = getDingTalkConfig();
  dingTalkRuntime.active = Boolean(config.configured && config.enabled);
  if (!dingTalkRuntime.active) return;
  dingTalkRuntime.timer = setInterval(() => { void runDingTalkPushTick(); }, config.pollSeconds * 1000);
  // The first tick only observes the current schedule window; it never replays older slots.
  void runDingTalkPushTick();
}

function getFeishuAppConfig() {
  try {
    if (!fs.existsSync(feishuAppConfigPath)) return { configured: false, enabled: false, pollSeconds: 120, chatId: "" };
    const raw = JSON.parse(fs.readFileSync(feishuAppConfigPath, "utf8"));
    // This dashboard keeps its own delivery target. Global environment variables may belong to another local project.
    const appId = String(raw.appId || process.env.FEISHU_APP_ID || "").trim();
    const appSecret = String(raw.appSecret || process.env.FEISHU_APP_SECRET || "").trim();
    const chatId = String(raw.chatId || process.env.FEISHU_CHAT_ID || "").trim();
    const pollSeconds = Math.max(60, Math.min(1800, Number(raw.pollSeconds) || 120));
    return {
      configured: /^cli_[a-zA-Z0-9]+$/.test(appId) && Boolean(appSecret) && /^oc_[a-zA-Z0-9]+$/.test(chatId),
      enabled: raw.enabled !== false,
      appId,
      appSecret,
      chatId,
      pollSeconds
    };
  } catch {
    return { configured: false, enabled: false, pollSeconds: 120, chatId: "" };
  }
}

function getFeishuConfig() {
  try {
    if (!fs.existsSync(feishuConfigPath)) return { configured: false, enabled: false, pollSeconds: 120 };
    const raw = JSON.parse(fs.readFileSync(feishuConfigPath, "utf8"));
    const webhook = String(process.env.FEISHU_ROBOT_WEBHOOK || raw.webhook || "").trim();
    const secret = String(process.env.FEISHU_ROBOT_SECRET || raw.secret || "").trim();
    const pollSeconds = Math.max(60, Math.min(1800, Number(raw.pollSeconds) || 120));
    let validWebhook = false;
    try {
      const url = new URL(webhook);
      validWebhook = url.protocol === "https:" && url.hostname === "open.feishu.cn" && /^\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(url.pathname);
    } catch {
      validWebhook = false;
    }
    return { configured: validWebhook, enabled: raw.enabled !== false, webhook, secret, pollSeconds };
  } catch {
    return { configured: false, enabled: false, pollSeconds: 120 };
  }
}

function getFeishuDeliveryConfig() {
  const webhookConfig = getFeishuConfig();
  // 保持此前已验证的本项目机器人为主通道；内部应用仅在机器人不可用时兜底。
  if (webhookConfig.configured && webhookConfig.enabled) return { ...webhookConfig, mode: "webhook" };
  const appConfig = getFeishuAppConfig();
  return { ...appConfig, mode: "app" };
}

function readFeishuPushState() {
  try {
    if (!fs.existsSync(feishuStatePath)) return { reports: {}, paper: {}, updatedAt: "" };
    const value = JSON.parse(fs.readFileSync(feishuStatePath, "utf8"));
    return { reports: value.reports || {}, paper: value.paper || {}, updatedAt: value.updatedAt || "" };
  } catch {
    return { reports: {}, paper: {}, updatedAt: "" };
  }
}

function writeFeishuPushState(state) {
  fs.mkdirSync(path.dirname(feishuStatePath), { recursive: true });
  const tempPath = `${feishuStatePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify({ ...state, updatedAt: now() }, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, feishuStatePath);
}

function summarizeFeishuPushState(state) {
  return {
    reports: Object.fromEntries(Object.entries(state.reports || {}).map(([slot, item]) => [slot, {
      date: item.date || "", sourceUpdatedAt: item.sourceUpdatedAt || "", sentAt: item.sentAt || ""
    }])),
    paper: {
      date: state.paper?.date || "", orderCount: Number(state.paper?.orderCount || 0), sentAt: state.paper?.sentAt || ""
    },
    updatedAt: state.updatedAt || ""
  };
}

function feishuTextChunks(text, limit = 15000) {
  return dingTalkTextChunks(text, limit);
}

function feishuMarkdownBlock(content) {
  return { tag: "div", text: { tag: "lark_md", content: String(content || "").trim() } };
}

function feishuTableCells(line) {
  return String(line || "").trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function isFeishuTableDivider(line) {
  const cells = feishuTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function feishuTableGrid(headers, rows) {
  const elements = [];
  const width = Math.max(1, Math.min(4, headers.length));
  for (let start = 0; start < headers.length; start += width) {
    const names = headers.slice(start, start + width);
    elements.push({
      tag: "column_set", flex_mode: "stretch", columns: names.map((name) => ({
        tag: "column", width: "weighted", weight: 1, vertical_align: "top", elements: [{ tag: "markdown", content: `**${name || "字段"}**` }]
      }))
    });
    for (const row of rows) {
      const values = row.slice(start, start + width);
      elements.push({
        tag: "column_set", flex_mode: "stretch", columns: values.map((value) => ({
          tag: "column", width: "weighted", weight: 1, vertical_align: "top", elements: [{ tag: "markdown", content: value || "—" }]
        }))
      });
    }
  }
  return elements;
}

function feishuElementsFromMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const elements = [];
  const textBuffer = [];
  const flushText = () => {
    const content = textBuffer.splice(0).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (content) elements.push(feishuMarkdownBlock(content));
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    const trimmed = line.trim();
    if (/^<!--.*-->$/.test(trimmed) || /^---+$/.test(trimmed) || /WorkBuddy.*自动生成|NeoData.*金融数据|仅作为市场参考.*不构成投资建议/.test(trimmed)) continue;
    if (trimmed.startsWith("|")) {
      flushText();
      const header = feishuTableCells(trimmed);
      const divider = lines[index + 1] || "";
      if (!header.length || !isFeishuTableDivider(divider)) {
        textBuffer.push(line);
        continue;
      }
      const rows = [];
      index += 2;
      while (index < lines.length && String(lines[index]).trim().startsWith("|")) {
        const row = feishuTableCells(lines[index]);
        if (!isFeishuTableDivider(lines[index])) rows.push(row);
        index += 1;
      }
      index -= 1;
      elements.push(...feishuTableGrid(header, rows));
      elements.push({ tag: "hr" });
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    const bracketHeading = trimmed.match(/^【(.+)】$/);
    if (heading || bracketHeading) {
      flushText();
      const title = heading ? heading[2] : bracketHeading[1];
      elements.push(feishuMarkdownBlock(`**${title}**`));
      continue;
    }
    textBuffer.push(line);
  }
  flushText();
  return elements.filter((item) => item.tag !== "div" || item.text?.content);
}

function buildFeishuReportElements(report, session, date) {
  const meta = report.meta || {};
  const body = String(report.body || "").replace(/^---[\s\S]*?---\s*/m, "");
  return [
    feishuMarkdownBlock(`**${marketReportTitle(session)} · ${date}**\n> ${meta.generated_at || report.updatedAt || "数据时间未标注"}　|　风险等级：**${meta.risk_level || "未标注"}**`),
    { tag: "hr" },
    ...feishuElementsFromMarkdown(body)
  ];
}

function buildFeishuPaperElements(snapshot) {
  const rows = snapshot.accountRows || [];
  const accountRows = rows.map((row) => {
    const account = row.status?.account || {};
    return [
      row.account.name,
      `${formatDingTalkMoney(account.equity)}\n${formatDingTalkSignedPercent(account.return_pct)}`,
      `${formatDingTalkSignedMoney(account.today_pnl)}\n${formatDingTalkSignedPercent(account.today_return_pct)}`,
      `${row.held?.length || 0} 个`
    ];
  });
  return [
    feishuMarkdownBlock(`**收盘账户总览 · ${snapshot.date}**\n**总资产：${formatDingTalkMoney(snapshot.totalEquity)}**　　**当日盈亏：${formatDingTalkSignedMoney(snapshot.totalTodayPnl)}**`),
    { tag: "hr" },
    feishuMarkdownBlock("**账户情况**"),
    ...feishuTableGrid(["账户", "资产（累计收益率）", "当日盈亏（当日收益率）", "持仓"], accountRows)
  ];
}

function buildFeishuTradeElements(row, order) {
  const account = row?.status?.account || {};
  const isBuy = order?.side === "BUY";
  const sideLabel = isBuy ? "买入" : "卖出";
  const isSell = order?.side === "SELL";
  const inferredCost = Number(order?.amount) - Number(order?.realized_pnl) + Number(order?.fee || 0);
  const rate = isSell && Number.isFinite(inferredCost) && inferredCost > 0
    ? (Number(order?.realized_pnl) / inferredCost) * 100
    : null;
  const detailRows = [
    [`数量`, `${order?.quantity || 0} 股/份`],
    [`成交价`, `${formatDingTalkPrice(order?.price)} 元`],
    [`成交额`, formatDingTalkMoney(order?.amount)],
    [`时间`, formatDingTalkOrderTime(order?.created_at)]
  ];
  if (isSell) detailRows.push([`本笔盈亏`, Number.isFinite(rate) ? formatDingTalkSignedPercent(rate) : formatDingTalkSignedMoney(order?.realized_pnl)]);
  return [
    feishuMarkdownBlock(`**${sideLabel}成交**\n**${order?.name || "未知标的"}**（${order?.code || "—"}）`),
    ...feishuMetricGrid(detailRows),
    { tag: "hr" },
    feishuMarkdownBlock(`**触发原因**\n${formatDingTalkTradeReason(order?.reason) || "未记录"}`),
    feishuMarkdownBlock(`**账户摘要**　当日盈亏 ${formatDingTalkSignedMoney(account.today_pnl)}　|　当前持仓 ${row?.held?.length || 0} 个`)
  ];
}

function feishuTradeCardTitle(row, order) {
  return `Komo · 交易情况 · ${row?.account?.name || order?.accountName || "Liyou"} · ${formatDingTalkOrderTime(order?.created_at)}`;
}

function feishuMetricGrid(rows = []) {
  const output = [];
  for (let index = 0; index < rows.length; index += 2) {
    const pair = rows.slice(index, index + 2);
    output.push({
      tag: "column_set",
      flex_mode: "stretch",
      columns: pair.map(([label, value]) => ({
        tag: "column",
        width: "weighted",
        weight: 1,
        vertical_align: "top",
        elements: [{ tag: "markdown", content: `**${label}**\n${value || "—"}` }]
      }))
    });
  }
  return output;
}

function formatFeishuTradeLines(row, order) {
  const isSell = order?.side === "SELL";
  const inferredCost = Number(order?.amount) - Number(order?.realized_pnl) + Number(order?.fee || 0);
  const rate = isSell && Number.isFinite(inferredCost) && inferredCost > 0
    ? (Number(order?.realized_pnl) / inferredCost) * 100
    : null;
  const lines = [
    `**标的**：${order?.name || "未知标的"}（${order?.code || "—"}）`,
    `**数量**：${order?.quantity || 0} 股/份`,
    `**成交价**：${formatDingTalkPrice(order?.price)} 元`,
    `**成交额**：${formatDingTalkMoney(order?.amount)}`,
    `**时间**：${formatDingTalkOrderTime(order?.created_at)}`
  ];
  if (isSell) lines.push(`**盈亏率**：${Number.isFinite(rate) ? formatDingTalkSignedPercent(rate) : `已实现盈亏 ${formatDingTalkSignedMoney(order?.realized_pnl)}`}`);
  lines.push(`**原因**：${formatDingTalkTradeReason(order?.reason)}`);
  return lines.join("\n");
}

function buildFeishuTradeBatchElements(row, orders = []) {
  const account = row?.status?.account || {};
  const sorted = [...orders].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime() || Number(left.id) - Number(right.id));
  const firstTime = formatDingTalkOrderTime(sorted[0]?.created_at);
  const lastTime = formatDingTalkOrderTime(sorted.at(-1)?.created_at);
  const tradeBlocks = sorted.flatMap((order, index) => [
    feishuMarkdownBlock(`**第 ${index + 1} 笔 · ${order.side === "SELL" ? "卖出" : "买入"}成交**\n**${order.name || "未知标的"}**（${order.code || "—"}）`),
    ...feishuMetricGrid([
      ["数量", `${order.quantity || 0} 股/份`],
      ["成交价", `${formatDingTalkPrice(order.price)} 元`],
      ["成交额", formatDingTalkMoney(order.amount)],
      ["时间", formatDingTalkOrderTime(order.created_at)]
    ]),
    feishuMarkdownBlock(`**触发原因**\n${formatDingTalkTradeReason(order.reason) || "未记录"}`),
    ...(index < sorted.length - 1 ? [{ tag: "hr" }] : [])
  ]);
  return [
    feishuMarkdownBlock(`**${row?.account?.name || "Liyou"} · 交易更新**\n${firstTime}${firstTime !== lastTime ? ` - ${lastTime}` : ""}　|　本次 ${sorted.length} 笔`),
    ...tradeBlocks,
    feishuMarkdownBlock(`**账户当日盈亏**：${formatDingTalkSignedMoney(account.today_pnl)}\n**当前持仓**：${row?.held?.length || 0} 个`)
  ];
}

async function sendFeishuCard(title, markdownOrElements, options = {}) {
  const config = getFeishuDeliveryConfig();
  if (!config.configured || !config.enabled) throw new Error("飞书机器人未配置或已停用");
  const elements = Array.isArray(markdownOrElements)
    ? markdownOrElements
    : [feishuMarkdownBlock(String(markdownOrElements || "").slice(0, 15000))];
  const card = {
    config: { wide_screen_mode: true },
    header: { template: options.headerTemplate || "turquoise", title: { tag: "plain_text", content: String(title).slice(0, 80) } },
    elements
  };
  if (config.mode === "app") {
    const token = await getFeishuTenantAccessToken(config);
    const response = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ receive_id: config.chatId, msg_type: "interactive", content: JSON.stringify(card) })
    });
    let result = null;
    try { result = await response.json(); } catch { result = null; }
    if (!response.ok || Number(result?.code || 0) !== 0) throw new Error(result?.msg || `飞书应用消息发送失败: HTTP ${response.status}`);
    return result;
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = {
    msg_type: "interactive",
    card
  };
  if (config.secret) {
    payload.timestamp = timestamp;
    payload.sign = createHmac("sha256", `${timestamp}\n${config.secret}`).digest("base64");
  }
  const response = await fetch(config.webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  let result = null;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok || (Number.isFinite(Number(result?.code)) && Number(result.code) !== 0)) {
    throw new Error(result?.msg || result?.message || `飞书请求失败: HTTP ${response.status}`);
  }
  return result;
}

async function getFeishuTenantAccessToken(config = getFeishuAppConfig()) {
  if (!config.configured) throw new Error("飞书自建应用未配置完整");
  if (feishuAppRuntime.tenantAccessToken && Date.now() < feishuAppRuntime.tokenExpiresAt - 60_000) return feishuAppRuntime.tenantAccessToken;
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret })
  });
  let result = null;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok || Number(result?.code || 0) !== 0 || !result?.tenant_access_token) throw new Error(result?.msg || `飞书应用令牌获取失败: HTTP ${response.status}`);
  feishuAppRuntime.tenantAccessToken = result.tenant_access_token;
  feishuAppRuntime.tokenExpiresAt = Date.now() + Math.max(60, Number(result.expire || 0)) * 1000;
  return feishuAppRuntime.tenantAccessToken;
}

function feishuMarketReportHash(report, session, date) {
  const content = normalizeDingTalkFullReport(report?.body);
  return createHash("sha256").update(`feishu-market-v1\n${date}\n${session}\n${content}`, "utf8").digest("hex");
}

async function pushFeishuMarketReportIfChanged(session, state, { allowRevision = false } = {}) {
  const date = shanghaiDateKey();
  const result = readMarketReport(session, date);
  if (!result?.report || result.resolvedDate !== date) return { sent: false, reason: "今日暂无报告" };
  const hash = feishuMarketReportHash(result.report, session, date);
  const previous = state.reports?.[session] || {};
  if (previous.date === date) {
    if (previous.hash === hash) return { sent: false, reason: "报告未更新" };
    if (!allowRevision) return { sent: false, reason: "本时段今日已发送，等待内容变更检查" };
    if (Number(previous.revisionCount || 0) >= 1) return { sent: false, reason: "今日内容更新已补发" };
    await sendFeishuCard(`Komo · ${marketReportTitle(session)} · 内容更新`, buildFeishuReportElements(result.report, session, date));
    state.reports = {
      ...(state.reports || {}),
      [session]: {
        ...previous,
        hash,
        date,
        sourceUpdatedAt: result.report.updatedAt || "",
        revisionCount: Number(previous.revisionCount || 0) + 1,
        revisionSentAt: now(),
        lastSentAt: now(),
        deliveryPolicy: "once-per-session-per-day + one-content-revision"
      }
    };
    return { sent: true, chunks: 1, revision: true };
  }
  await sendFeishuCard(`Komo · ${marketReportTitle(session)}`, buildFeishuReportElements(result.report, session, date));
  state.reports = {
    ...(state.reports || {}),
    [session]: {
      hash,
      date,
      sourceUpdatedAt: result.report.updatedAt || "",
      sentAt: now(),
      lastSentAt: now(),
      revisionCount: 0,
      revisionSentAt: "",
      deliveryPolicy: "once-per-session-per-day + one-content-revision"
    }
  };
  return { sent: true, chunks: 1, revision: false };
}

async function pushLiyouPaperFeishuIfChanged(state, options = {}) {
  const snapshot = buildLiyouPaperSnapshot();
  if (!snapshot) return { sent: false, reason: "未找到 Liyou 模拟账户" };
  const previous = state.paper || {};
  const dailySummary = Boolean(options.dailySummary);
  const previousOrderIds = new Set(Array.isArray(previous.orderIds) ? previous.orderIds.map(Number) : []);
  const newOrders = snapshot.allOrders.filter((order) => !previousOrderIds.has(Number(order.id)));
  if (dailySummary && previous.dailySummaryDate === snapshot.date) return { sent: false, reason: "今日账户汇总已发送" };
  if (!dailySummary && !newOrders.length) return { sent: false, reason: "无新增模拟订单" };
  let chunksSent = 0;
  if (dailySummary) {
    await sendFeishuCard("Komo · Liyou 模拟账户汇总", buildFeishuPaperElements(snapshot));
    chunksSent = 1;
  } else {
    const sentOrderIds = new Set(previousOrderIds);
    for (const row of snapshot.accountRows) {
      const accountOrders = newOrders.filter((order) => order.accountName === row.account.name)
        .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime() || Number(left.id) - Number(right.id));
      if (!accountOrders.length) continue;
      await sendFeishuCard(`Komo · 交易更新 · ${row.account.name} · ${formatDingTalkOrderTime(accountOrders.at(-1)?.created_at)}`, buildFeishuTradeBatchElements(row, accountOrders), { headerTemplate: "blue" });
      accountOrders.forEach((order) => sentOrderIds.add(Number(order.id)));
      state.paper = {
        ...previous,
        layoutVersion: "feishu-paper-card-v1",
        hash: snapshot.hash,
        date: snapshot.date,
        dailySummaryDate: previous.dailySummaryDate || "",
        orderCount: snapshot.orderCount,
        orderIds: [...sentOrderIds],
        sentAt: now(),
        deliveryPolicy: "new-orders-merged-by-account-in-time-order + closing-summary"
      };
      writeFeishuPushState(state);
      chunksSent += 1;
    }
  }
  state.paper = {
    ...previous, layoutVersion: "feishu-paper-card-v1", hash: snapshot.hash, date: snapshot.date,
    dailySummaryDate: dailySummary ? snapshot.date : previous.dailySummaryDate || "",
    orderCount: snapshot.orderCount, orderIds: snapshot.orderIds, sentAt: now(),
    deliveryPolicy: "new-orders-merged-by-account-in-time-order + closing-summary"
  };
  return { sent: true, chunks: chunksSent, orderCount: snapshot.orderCount, mode: dailySummary ? "initial" : "delta" };
}

async function runFeishuPushTick() {
  const config = getFeishuDeliveryConfig();
  feishuRuntime.active = Boolean(config.configured && config.enabled);
  if (!feishuRuntime.active || feishuRuntime.running) return;
  feishuRuntime.running = true;
  feishuRuntime.lastCheckAt = now();
  try {
    const state = readFeishuPushState();
    const results = {};
    const errors = [];
    if (!isAshareMarketDay()) {
      feishuRuntime.results = { schedule: { sent: false, reason: "非交易日，不读取报告或模拟账户" } };
      feishuRuntime.lastSuccessAt = now();
      feishuRuntime.lastError = "";
      return;
    }
    const dueReports = getDueDingTalkReportSessions();
    for (const { session } of dueReports) {
      try {
        results[session] = await pushFeishuMarketReportIfChanged(session, state);
        if (results[session].sent) writeFeishuPushState(state);
      } catch (error) {
        results[session] = { sent: false, error: String(error.message || error).slice(0, 240) };
        errors.push(`${marketReportTitle(session)}：${results[session].error}`);
      }
    }
    // A report may be revised after its scheduled slot. Check already-sent
    // sessions throughout the same trading day and allow one labelled re-send.
    const scheduledSessions = new Set(dueReports.map((item) => item.session));
    const revisionSessions = Object.entries(state.reports || {})
      .filter(([session, item]) => isMarketReportSession(session) && item?.date === shanghaiDateKey() && !scheduledSessions.has(session))
      .map(([session]) => session);
    for (const session of revisionSessions) {
      try {
        const revision = await pushFeishuMarketReportIfChanged(session, state, { allowRevision: true });
        if (revision.sent) {
          results[`${session}-revision`] = revision;
          writeFeishuPushState(state);
        }
      } catch (error) {
        const message = String(error.message || error).slice(0, 240);
        results[`${session}-revision`] = { sent: false, error: message };
        errors.push(`${marketReportTitle(session)}更新：${message}`);
      }
    }
    try {
      const closingSummaryDue = dueReports.some((item) => item.session === "closing");
      results.paper = closingSummaryDue
        ? await pushLiyouPaperFeishuIfChanged(state, { dailySummary: true })
        : isAshareTradingTime()
          ? await pushLiyouPaperFeishuIfChanged(state)
          : { sent: false, reason: "等待盘中订单更新或 15:15 账户汇总" };
      if (results.paper.sent) writeFeishuPushState(state);
    } catch (error) {
      results.paper = { sent: false, error: String(error.message || error).slice(0, 240) };
      errors.push(`模拟账户：${results.paper.error}`);
    }
    writeFeishuPushState(state);
    feishuRuntime.results = results;
    feishuRuntime.lastError = errors.length ? errors.join("；") : "";
    if (!errors.length) feishuRuntime.lastSuccessAt = now();
  } catch (error) {
    feishuRuntime.lastError = String(error.message || error).slice(0, 240);
  } finally {
    feishuRuntime.running = false;
  }
}

function startFeishuPushLoop() {
  if (feishuRuntime.timer) clearInterval(feishuRuntime.timer);
  const config = getFeishuDeliveryConfig();
  feishuRuntime.active = Boolean(config.configured && config.enabled);
  if (!feishuRuntime.active) return;
  feishuRuntime.timer = setInterval(() => { void runFeishuPushTick(); }, config.pollSeconds * 1000);
  void runFeishuPushTick();
}

async function getSystemHealth() {
  const snapshots = ["markets", "stocks", "etfs"].map((key) => ({ key, ...store.getSnapshot(key, key === "markets" ? "markets" : key) }));
  const freshness = snapshots.map((item) => ({ key: item.key, updatedAt: item.updatedAt || "", ageMinutes: safeTimestampAgeMinutes(item.updatedAt), status: item.status || "empty" }));
  const staleCore = freshness.some((item) => item.ageMinutes === null || item.ageMinutes > 5 || item.status === "fallback");
  const dataBytes = directorySizeBytes(dataDirPath);
  const walBytes = fs.existsSync(`${databasePath}-wal`) ? fs.statSync(`${databasePath}-wal`).size : 0;
  const futu = await probeFutu();
  const auto = { active: paperAutoRuntime.active, running: paperAutoRuntime.running, accountCount: listPaperAutoConfigs().length, blockedByStaleData: staleCore };
  return {
    ok: !staleCore && dataBytes < 30 * 1024 ** 3 && walBytes < 500 * 1024 ** 2,
    checkedAt: now(),
    futu,
    freshness,
    capacity: {
      dataBytes, dataLevel: healthLevel(dataBytes, 20 * 1024 ** 3, 30 * 1024 ** 3),
      databaseBytes: fs.existsSync(databasePath) ? fs.statSync(databasePath).size : 0,
      walBytes, walLevel: healthLevel(walBytes, 200 * 1024 ** 2, 500 * 1024 ** 2),
      backupCreationAllowed: dataBytes < 30 * 1024 ** 3
    },
    cache: { coreDataStale: staleCore, thresholdMinutes: 5 },
    auto,
    maintenance: { lockActive: fs.existsSync(maintenanceLockPath), runtime: { ...maintenanceRuntime }, latest: readMaintenanceEntries(1)[0] || null }
  };
}

function paperMarketEnvironment() {
  const data = store.getSnapshot("markets", "markets");
  const stocks = store.getSnapshot("stocks", "stocks");
  const sectors = store.getSnapshot("sectorFlows", "sectors");
  const indexes = (data.markets || data || []).flatMap((item) => item.indexes || []).filter((item) => item.code === "000001.SH" || item.name === "上证指数");
  const changePct = Number.isFinite(Number(indexes[0]?.change_pct)) ? Number(indexes[0].change_pct) : null;
  const changes = (stocks.stocks || []).map((item) => Number(item.change_pct)).filter(Number.isFinite);
  const breadth = changes.length ? changes.filter((value) => value > 0).length / changes.length : null;
  const sectorRows = (sectors.sectors || []).filter(hasUsableSectorData);
  const inflowCount = sectorRows.filter((item) => Number(item.net_inflow) > 0).length;
  const outflowCount = sectorRows.filter((item) => Number(item.net_inflow) < 0).length;
  let regime = "neutral";
  if ((Number.isFinite(changePct) && changePct <= -1.5) || (Number.isFinite(breadth) && breadth < 0.3)) regime = "risk";
  else if ((Number.isFinite(changePct) && changePct <= -0.5) || (Number.isFinite(breadth) && breadth < 0.42) || (outflowCount > inflowCount * 1.8 && sectorRows.length >= 8)) regime = "weak";
  else if (Number.isFinite(changePct) && changePct >= 0.35 && Number.isFinite(breadth) && breadth >= 0.55 && inflowCount >= outflowCount) regime = "strong";
  return { changePct, breadth, inflowCount, outflowCount, regime, source: data.source || "暂无数据", updatedAt: data.updatedAt || "" };
}

function paperEnvironmentBlockReason(environment, config = {}) {
  if (config.requireMarketTrend && Number.isFinite(environment.changePct) && environment.changePct < config.minMarketChange) return "市场环境未通过";
  if (environment.regime === "risk" && config.accountRole !== "etf_defense") return "市场处于风险档，仅防守ETF允许新增";
  if (environment.regime === "weak" && ["short_term", "etf_rotation"].includes(config.accountRole)) return "市场偏弱，短线与ETF轮动暂停新增";
  return "";
}

function paperEnvironmentPositionMultiplier(environment, config = {}) {
  if (environment.regime === "strong") return 1.15;
  if (environment.regime === "weak") return config.accountRole === "etf_defense" ? 0.9 : 0.7;
  if (environment.regime === "risk") return config.accountRole === "etf_defense" ? 0.7 : 0;
  return 1;
}

function getShanghaiClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday || "",
    hour: Number(values.hour),
    minute: Number(values.minute),
    minutes: Number(values.hour) * 60 + Number(values.minute)
  };
}

function getSignalTiming(date = new Date()) {
  const clock = getShanghaiClock(date);
  const isTradingDay = !["周六", "周日", "Sat", "Sun"].includes(clock.weekday);
  const boundaries = [
    { at: 9 * 60, label: "早盘", riskSession: "早盘" },
    { at: 11 * 60 + 30, label: "午盘", riskSession: "午盘" },
    { at: 13 * 60, label: "午后", riskSession: "午盘" },
    { at: 15 * 60, label: "收盘", riskSession: "收盘" }
  ];
  if (!isTradingDay) return { ...clock, isTradingDay, label: "非交易日", riskSession: "", next: boundaries[0] };
  const current = clock.minutes < boundaries[0].at
    ? { label: "盘前", riskSession: "早盘" }
    : clock.minutes < boundaries[1].at
      ? boundaries[0]
      : clock.minutes < boundaries[2].at
        ? boundaries[1]
        : clock.minutes < boundaries[3].at
          ? boundaries[2]
          : boundaries[3];
  const next = boundaries.find((item) => item.at > clock.minutes) || null;
  return { ...clock, isTradingDay, ...current, next };
}

function filterSignalByTime(riskRadar, watchPoints, timing) {
  if (!timing.isTradingDay) return { riskRadar: [], watchPoints: [] };
  const sessionOrder = { "早盘": 1, "午盘": 2, "收盘": 3 };
  const currentOrder = sessionOrder[timing.riskSession] || 0;
  // 风险雷达是当日累计视图：只隐藏尚未到时段的内容，已出现的内容继续保留。
  const activeRiskRadar = riskRadar
    .filter((item) => (sessionOrder[item.session] || 99) <= currentOrder)
    .slice(0, 10);
  const activeWatchPoints = watchPoints.filter((point) => {
    const [hours, minutes] = String(point.time || "").split(":").map(Number);
    const pointMinutes = hours * 60 + minutes;
    return timing.minutes >= pointMinutes;
  });
  return { riskRadar: activeRiskRadar, watchPoints: activeWatchPoints };
}

function buildPrivateSignal() {
  const stocksData = store.getSnapshot("stocks", "stocks");
  const etfsData = store.getSnapshot("etfs", "etfs");
  const sectorData = store.getSnapshot("sectorFlows", "sectors");
  const marketData = store.getSnapshot("markets", "markets");
  const live = readFutuLive();
  const applyLive = (item) => {
    const quote = live.quotes?.[item.code];
    return quote ? { ...item, ...quote, source_name: "Futu OpenD实时订阅" } : item;
  };
  const stockRows = (stocksData.stocks || []).map(applyLive);
  const etfRows = (etfsData.etfs || []).map(applyLive);
  const allRows = [...stockRows, ...etfRows];
  const validChanges = stockRows.map((item) => Number(item.change_pct)).filter(Number.isFinite);
  const upCount = validChanges.filter((value) => value > 0).length;
  const downCount = validChanges.filter((value) => value < 0).length;
  const sectorRows = (sectorData.sectors || []).map((item) => ({ ...item, change_pct: Number(item.change_pct), net_inflow: Number(item.net_inflow) })).filter((item) => Number.isFinite(item.change_pct) || Number.isFinite(item.net_inflow));
  const etfChanges = etfRows.map((item) => Number(item.change_pct)).filter(Number.isFinite);
  const shIndex = (marketData.markets || []).flatMap((market) => market.indexes || []).find((item) => item.code === "000001.SH" || item.name === "上证指数");
  const shChange = Number(shIndex?.change_pct);
  const topInflow = [...sectorRows].filter((item) => Number.isFinite(item.net_inflow)).sort((a, b) => b.net_inflow - a.net_inflow)[0];
  const topOutflow = [...sectorRows].filter((item) => Number.isFinite(item.net_inflow)).sort((a, b) => a.net_inflow - b.net_inflow)[0];
  const strongestEtf = [...etfRows].filter((item) => Number.isFinite(Number(item.change_pct))).sort((a, b) => Number(b.change_pct) - Number(a.change_pct))[0];
  const weakestEtf = [...etfRows].filter((item) => Number.isFinite(Number(item.change_pct))).sort((a, b) => Number(a.change_pct) - Number(b.change_pct))[0];
  const updatedAt = [live.connected ? live.updatedAt : "", stocksData.updatedAt, etfsData.updatedAt, sectorData.updatedAt, marketData.updatedAt].filter(Boolean).sort().at(-1) || now();
  const source = live.connected ? "Futu OpenD实时订阅 + 本地真实快照" : [stocksData.source, etfsData.source, sectorData.source, marketData.source].filter(Boolean).join(" / ") || "暂无数据";
  const riskRadar = [];
  const addRisk = (session, category, level, title, detail, evidence) => riskRadar.push({ session, category, level, title, detail, evidence: evidence || "", updatedAt });
  const connectionLevel = live.connected ? "低" : "中";
  const indexLevel = !Number.isFinite(shChange) ? "中" : shChange <= -1 ? "高" : shChange < -.3 ? "中" : "低";
  const breadthLevel = !validChanges.length ? "中" : downCount / validChanges.length >= .6 ? "高" : downCount / validChanges.length >= .5 ? "中" : "低";
  const flowLevel = topOutflow?.net_inflow < 0 ? "中" : topInflow ? "低" : "中";
  const etfLevel = !etfChanges.length ? "中" : weakestEtf && Number(weakestEtf.change_pct) <= -1.5 ? "中" : "低";
  const stockDetail = validChanges.length ? `上涨 ${upCount} 家、下跌 ${downCount} 家；上证指数 ${Number.isFinite(shChange) ? `${shChange.toFixed(2)}%` : "暂无"}，关注指数与个股宽度是否背离。` : "暂无足够 A股涨跌数据，不能判断股市方向。";
  const etfDetail = strongestEtf && weakestEtf ? `${strongestEtf.name} ${Number(strongestEtf.change_pct).toFixed(2)}%，${weakestEtf.name} ${Number(weakestEtf.change_pct).toFixed(2)}%，观察 ETF 强弱是否继续分化。` : "暂无足够 ETF 行情，不能判断 ETF 强弱结构。";
  const sectorDetail = topOutflow?.name && topOutflow.net_inflow < 0 ? `${topOutflow.name}净流入 ${formatMoney(topOutflow.net_inflow)}；同时关注${topInflow?.name || "强势板块"}资金是否延续。` : topInflow?.name ? `${topInflow.name}当前资金流入较多，需确认涨跌幅与资金方向是否一致。` : "暂无板块资金数据，暂不做方向判断。";
  // 每个时段保留一个基础监控，其余项目只在数据存在或风险条件触发时追加，最多展示 10 个。
  addRisk("早盘", "股市", !live.connected ? connectionLevel : indexLevel, !live.connected ? "开盘数据状态" : "开盘方向", !live.connected ? "实时行情暂未连续更新，当前使用最近真实数据；开盘前请确认数据时间。" : stockDetail, "A股指数 / 股票池");
  addRisk("午盘", "板块", flowLevel, topOutflow?.name && topOutflow.net_inflow < 0 ? `${topOutflow.name}资金观察` : "午盘板块资金", sectorDetail, "板块资金");
  addRisk("收盘", "ETF", etfLevel, "ETF收盘结构", etfDetail, "ETF行情");
  if (validChanges.length) addRisk("早盘", "股市", breadthLevel, "市场宽度", `当前上涨 ${upCount} 家、下跌 ${downCount} 家，下跌占比 ${(downCount / validChanges.length * 100).toFixed(0)}%，关注开盘后强弱扩散。`, "A股股票池");
  if (etfChanges.length) addRisk("早盘", "ETF", etfLevel, "ETF开盘强弱", etfDetail, "ETF行情");
  if (sectorRows.length) addRisk("早盘", "板块", flowLevel, "早盘板块选择", sectorDetail, "板块资金");
  if (validChanges.length && downCount / validChanges.length >= .5) addRisk("午盘", "股市", breadthLevel, "午盘市场宽度", stockDetail, "A股股票池");
  if (etfChanges.length && weakestEtf && Number(weakestEtf.change_pct) <= -1.5) addRisk("午盘", "ETF", etfLevel, "午盘ETF分化", etfDetail, "ETF行情");
  if (sectorRows.length && topInflow) addRisk("午盘", "板块", flowLevel, "资金延续", sectorDetail, "板块资金");
  if (Number.isFinite(shChange) && shChange <= -.3) addRisk("收盘", "股市", indexLevel, "收盘指数风险", `上证指数当前 ${shChange.toFixed(2)}%，收盘前确认指数与市场宽度是否同步。`, "上证指数");
  if (sectorRows.length && topOutflow?.net_inflow < 0) addRisk("收盘", "板块", flowLevel, "收盘资金回流", sectorDetail, "板块资金");
  if (!live.connected || !stockRows.length || !etfRows.length || !sectorRows.length) addRisk("收盘", "数据", "数据完整性", `当前读取 A股 ${stockRows.length} 条、ETF ${etfRows.length} 条、板块 ${sectorRows.length} 个；缺失项不参与方向判断。`, source);
  riskRadar.splice(10);
  const watchPoints = [
    { time: "09:25", session: "早盘", title: "竞价数据状态", detail: `${live.connected ? "实时订阅已连接" : "实时行情暂未连续更新，使用最近真实数据"}；开盘前先确认更新时间，再判断方向。`, evidence: live.connected ? "Futu实时" : "最近真实数据" },
    { time: "09:45", session: "早盘", title: "开盘承接强弱", detail: `当前上涨 ${upCount || "暂无"} 家、下跌 ${downCount || "暂无"} 家；若下跌占比超过 60%，将开盘判断调整为偏谨慎。`, evidence: "A股股票池" },
    { time: "10:00", session: "早盘", title: "指数与宽度背离", detail: `上证指数 ${Number.isFinite(shChange) ? `${shChange.toFixed(2)}%` : "暂无"}；对比上涨/下跌家数，确认是普涨还是少数指数股推动。`, evidence: "上证指数 / A股宽度" },
    { time: "11:20", session: "午盘", title: "午盘前资金集中度", detail: topInflow?.name ? `${topInflow.name}净流入 ${formatMoney(topInflow.net_inflow)}；同时检查${topOutflow?.name || "流出板块"}是否出现集中撤出。` : "暂无板块资金数据，午盘不做资金方向判断。", evidence: "板块资金" },
    { time: "13:00", session: "午盘", title: "午后开盘承接", detail: Number.isFinite(shChange) ? `上证指数 ${shChange.toFixed(2)}%；若指数反弹但板块资金未同步，标记为资金背离。` : "上证指数暂无数据，先确认午后数据已更新。", evidence: "上证指数 / 板块资金" },
    { time: "13:45", session: "午盘", title: "轮动是否有效", detail: strongestEtf && weakestEtf ? `强势 ETF ${strongestEtf.name} ${Number(strongestEtf.change_pct).toFixed(2)}%，弱势 ETF ${weakestEtf.name} ${Number(weakestEtf.change_pct).toFixed(2)}%；观察强弱差是否收窄。` : "暂无足够 ETF 行情，不能判断轮动质量。", evidence: "ETF行情" },
    { time: "14:30", session: "收盘", title: "尾盘风险确认", detail: weakestEtf ? `${weakestEtf.name}当前 ${Number(weakestEtf.change_pct).toFixed(2)}%；若弱势 ETF 继续扩大跌幅，降低对板块持续性的判断。` : "暂无 ETF 弱势数据，不能确认尾盘风险。", evidence: "ETF行情" },
    { time: "14:50", session: "收盘", title: "数据与复盘落点", detail: `确认 A股 ${stockRows.length} 条、ETF ${etfRows.length} 条、板块 ${sectorRows.length} 个数据完成更新，再记录资金最强/最弱板块和次日验证项。`, evidence: source }
  ];
  const timing = getSignalTiming();
  const refinedRiskRadar = buildRefinedRiskRadar({ updatedAt, source, live, stockRows, etfRows, sectorRows, validChanges, upCount, downCount, shChange, topInflow, topOutflow, strongestEtf, weakestEtf });
  const activeSignals = filterSignalByTime(refinedRiskRadar, watchPoints, timing);
  const reportRiskRadar = Array.isArray(store.getStatus("workbuddy-report-risk-radar")) ? store.getStatus("workbuddy-report-risk-radar") : [];
  const conditions = privateCandidateConditions();
  const candidates = stockRows
    .filter((item) => !isRiskName(item))
    .map((item) => ({
      ...item,
      hit_score: scoreStock(item, conditions),
      condition_hits: conditions.map((condition) => ({ label: describeCondition(condition), hit: evaluateCondition(item, condition) })),
      reason: candidateReason(item, conditions)
    }))
    .filter((item) => matchesConditions(item, conditions, "AND"))
    .sort((a, b) => compareByField(a, b, "hit_score", "desc") || compareByField(a, b, "amount", "desc"))
    .slice(0, 10);
  return {
    updatedAt,
    source,
    mood: Number.isFinite(shChange) ? (shChange >= 0.5 ? "风险偏好偏积极，但需确认量能" : shChange <= -0.5 ? "风险偏好偏谨慎，优先控制回撤" : "风险偏好中性，等待板块选择") : "暂无足够指数数据判断风向",
    summary: candidates.length
      ? `按“隔夜套利观察”模板筛选出 ${candidates.length} 条，候选池仅供个人研究。`
      : "当前没有同时满足模板条件的标的，候选池不使用股票池前排数据填充。",
    rules: {
      name: "隔夜套利观察（可编辑模板）",
      logic: "AND",
      conditions,
      exclusions: ["ST、*ST、退市风险名称", "缺少关键字段", "停牌或无有效价格"]
    },
    riskRadar: [...activeSignals.riskRadar, ...reportRiskRadar].slice(0, 10),
    watchPoints: activeSignals.watchPoints,
    signalTiming: {
      session: timing.label,
      riskSession: timing.riskSession,
      isTradingDay: timing.isTradingDay,
      clock: `${String(timing.hour).padStart(2, "0")}:${String(timing.minute).padStart(2, "0")}`,
      nextSession: timing.next?.label || "下个交易日盘前",
      nextSessionAt: timing.next ? `${String(Math.floor(timing.next.at / 60)).padStart(2, "0")}:${String(timing.next.at % 60).padStart(2, "0")}` : "下个交易日 09:00"
    },
    liveStatus: { connected: live.connected, source, updatedAt, stockRows: stockRows.length, etfRows: etfRows.length, sectorRows: sectorRows.length },
    candidates
  };
}

function buildRefinedRiskRadar({ updatedAt, source, live, stockRows, etfRows, sectorRows, validChanges, upCount, downCount, shChange, topInflow, topOutflow, strongestEtf, weakestEtf }) {
  const rows = [];
  const add = (session, topic, category, level, title, detail, action, evidence) => rows.push({ session, topic, category, level, title, detail, action, evidence, updatedAt });
  const breadthRatio = validChanges.length ? downCount / validChanges.length : null;
  const averageChange = validChanges.length ? validChanges.reduce((sum, value) => sum + value, 0) / validChanges.length : null;
  const etfChanges = etfRows.map((item) => Number(item.change_pct)).filter(Number.isFinite);
  const etfSpread = strongestEtf && weakestEtf ? Number(strongestEtf.change_pct) - Number(weakestEtf.change_pct) : null;
  const inflowCount = sectorRows.filter((item) => Number(item.net_inflow) > 0).length;
  const outflowCount = sectorRows.filter((item) => Number(item.net_inflow) < 0).length;

  if (!live.connected) {
    add("早盘", "data-connection", "数据", "中", "行情连接状态",
      `Futu实时订阅未连接，当前使用最近真实数据；A股 ${stockRows.length} 条、ETF ${etfRows.length} 条。`,
      "刷新或检查 OpenD，未恢复前不把旧数据当成盘中变化。", source);
  }

  if (!Number.isFinite(breadthRatio) || breadthRatio >= .5 || (Number.isFinite(shChange) && shChange <= -.5)) {
    add("早盘", "market-breadth", "股市", !Number.isFinite(breadthRatio) ? "中" : breadthRatio >= .6 ? "高" : "中", "市场宽度走弱",
      validChanges.length ? `上涨 ${upCount} 家、下跌 ${downCount} 家，下跌占比 ${(breadthRatio * 100).toFixed(0)}%，平均涨跌幅 ${averageChange.toFixed(2)}%。` : "暂无足够 A股涨跌数据，不能判断市场宽度。",
      "对比指数、上涨家数和板块资金是否同向；只有少数指数股支撑时按结构性走弱处理。", "A股股票池");
  }

  if (!sectorRows.length || Number(topOutflow?.net_inflow) < 0 || outflowCount > inflowCount) {
    add("午盘", "sector-flow", "板块", !sectorRows.length ? "中" : outflowCount > inflowCount ? "高" : "中", "板块资金走弱",
      sectorRows.length ? `${topInflow?.name || "暂无明显流入板块"} ${topInflow ? `净流入 ${formatMoney(topInflow.net_inflow)}` : ""}；${topOutflow?.name || "暂无明显流出板块"} ${topOutflow ? `净流入 ${formatMoney(topOutflow.net_inflow)}` : ""}。净流入板块 ${inflowCount} 个，净流出板块 ${outflowCount} 个。` : "暂无板块资金数据，不能判断资金方向。",
      "核对涨跌幅与净流入是否同步；资金和涨幅背离时降低对板块持续性的判断。", "板块资金");
  }

  if (!etfChanges.length || etfSpread >= 2 || Number(weakestEtf?.change_pct) <= -1.5) {
    add("午盘", "etf-dispersion", "ETF", !etfChanges.length ? "中" : etfSpread >= 3 || Number(weakestEtf?.change_pct) <= -2 ? "高" : "中", "ETF强弱分化",
      etfChanges.length ? `最强 ${strongestEtf.name} ${Number(strongestEtf.change_pct).toFixed(2)}%，最弱 ${weakestEtf.name} ${Number(weakestEtf.change_pct).toFixed(2)}%，强弱差 ${Number(etfSpread).toFixed(2)} 个百分点。` : "暂无足够 ETF 行情，不能判断强弱分化。",
      "核对宽基与行业 ETF 是否同步，避免把单只 ETF 的小幅波动当成整体轮动。", "ETF行情");
  }

  if (!Number.isFinite(shChange) || shChange <= -.3) {
    add("收盘", "index-risk", "股市", !Number.isFinite(shChange) ? "中" : shChange <= -1 ? "高" : "中", "上证指数走弱",
      Number.isFinite(shChange) ? `上证指数当前 ${shChange.toFixed(2)}%；需要与涨跌家数、板块资金和 ETF 强弱合并判断。` : "上证指数暂无数据，不能单独判断市场方向。",
      "确认指数、涨跌家数和板块净流入是否同向；不同向时按震荡或风险处理。", "上证指数 / A股宽度 / 板块资金");
  }

  const currentMinute = getShanghaiClock().minutes;
  const newsSession = currentMinute < 11 * 60 + 30 ? "早盘" : currentMinute < 14 * 60 + 30 ? "午盘" : "收盘";
  const cutoff = Date.now() - 36 * 60 * 60 * 1000;
  const newsRows = store.listNewsItems(120)
    .filter((item) => {
      const time = new Date(String(item.published_at || item.created_at || "").replace(" ", "T") + (String(item.published_at || "").includes("T") ? "" : "+08:00")).getTime();
      return !Number.isFinite(time) || time >= cutoff;
    })
    .filter((item) => item.importance === "重要" || item.event_tags?.some((tag) => ["风险事件", "政策", "海外事件", "资金", "基金/ETF"].includes(tag)))
    .filter((item) => /政策|监管|央行|证监会|交易所|美联储|关税|地缘|冲突|原油|黄金|汇率|指数|市场|板块|ETF|基金|资金|成交|涨停|跌停/.test(`${item.title} ${item.summary}`))
    .slice(0, 3);
  for (const item of newsRows) {
    const tags = Array.isArray(item.event_tags) ? item.event_tags : [];
    const level = tags.includes("风险事件") || tags.includes("海外事件") ? "高" : "中";
    const summary = String(item.summary || item.title || "").slice(0, 180);
    const rawTitle = String(item.title || "公开资讯");
    const conciseTitle = rawTitle.match(/^【([^】]{4,80})】/)?.[1] || rawTitle;
    add(newsSession, `news:${item.id}`, "资讯", level, conciseTitle.slice(0, 52),
      summary || "该公开资讯未提供摘要，建议打开原文核对。",
      `核对 ${item.source || "公开来源"} 的原文时间与影响范围；未出现更多证据前不把单条资讯当成市场结论。`,
      `${item.source || "公开资讯"}${item.url ? " · 原文链接已记录" : ""}`);
  }

  if (!live.connected || !stockRows.length || !etfRows.length || !sectorRows.length) {
    add("收盘", "data-quality", "数据", "中", "数据完整性", `当前读取 A股 ${stockRows.length} 条、ETF ${etfRows.length} 条、板块 ${sectorRows.length} 个；缺失字段不参与判断。`, "补齐数据源后再解释方向，当前结果只能作为不完整监控。", source);
  }
  return rows;
}

function privateCandidateConditions() {
  return [
    { field: "change_pct", operator: "between", value: "3", value2: "5" },
    { field: "volume_ratio", operator: ">", value: "1", value2: "" },
    { field: "turnover_rate", operator: "between", value: "5", value2: "10" },
    { field: "market_cap", operator: "between", value: "5000000000", value2: "20000000000" }
  ];
}

function isRiskName(item) {
  const name = String(item?.name || "");
  return /ST|退|退市|停牌/.test(name) || !Number.isFinite(Number(item?.price)) || Number(item.price) <= 0;
}

function candidateReason(item, conditions) {
  const hits = conditions.filter((condition) => evaluateCondition(item, condition)).map(describeCondition);
  const extras = [];
  if (Number(item.volume_ratio) >= 1.5) extras.push("量比活跃");
  if (Number(item.turnover_rate) >= 5) extras.push("换手适中");
  if (Number(item.amount) >= 1_000_000_000) extras.push("成交额较高");
  return [...hits, ...extras].join("；") || "满足观察条件";
}

function buildTodayWorkflow() {
  const context = buildMarketContext();
  const status = store.getStatus("sources") || {};
  const sessions = ["preopen", "midday", "close"].map((session) => {
    const meta = sessionMeta(session);
    const publicDraft = buildWechatDraft({ session, articleType: meta.articleType, style: "数据解读型" });
    return {
      key: session,
      title: meta.name,
      window: meta.window,
      status: draftStatusFor(session),
      dataStatus: context.hasAnyData ? "可用" : "暂无数据",
      lastRefresh: context.updatedAt,
      source: context.source,
      articleType: meta.articleType,
      publicTitle: publicDraft.title,
      review: publicDraft.review,
      privateAvailable: true
    };
  });
  return {
    updatedAt: context.updatedAt,
    source: context.source,
    refreshPlan: [
      { name: "指数", scope: "global/ashare", cadence: 60, label: "1分钟" },
      { name: "股票池/ETF/板块资金", scope: "ashare/etf/sector", cadence: 180, label: "3分钟" },
      { name: "新闻/素材", scope: "content", cadence: 300, label: "5分钟" },
      { name: "全量刷新", scope: "all", cadence: 600, label: "手动或10分钟+" }
    ],
    sources: summarizeSourceStatus(status),
    sessions
  };
}

function buildDataCompleteness() {
  const status = store.getStatus("sources") || {};
  const markets = store.getSnapshot("markets", "markets");
  const stocks = store.getSnapshot("stocks", "stocks");
  const etfs = store.getSnapshot("etfs", "etfs");
  const sectors = store.getSnapshot("sectorFlows", "sectors");
  const countIndexes = (markets.markets || []).reduce((sum, group) => sum + (group.indexes || []).length, 0);
  const globalRows = (markets.markets || []).filter((group) => group.region !== "A股").reduce((sum, group) => sum + (group.indexes || []).length, 0);
  const historyRows = store.countHistoryRows();
  const sectorMemberRows = store.countSectorMembers();
  const newsRows = store.countNewsItems();
  const sourceFor = (key, fallback) => status[key]?.sourceName || fallback;
  const rowsFor = (key, fallback) => Number.isFinite(Number(status[key]?.rows)) ? Number(status[key].rows) : fallback;
  const modules = [
    { key: "ashare", name: "A股指数", required: true, rows: countIndexes, source: sourceFor("ashare", markets.source), state: countIndexes ? "ready" : "missing", message: countIndexes ? "指数已入库" : "暂无指数" },
    { key: "stocks", name: "A股股票池", required: true, rows: stocks.stocks?.length || 0, source: sourceFor("ashare", stocks.source), state: stocks.stocks?.length ? "ready" : "missing", message: stocks.stocks?.length ? `字段完整度 ${Math.round((stocks.stocks[0]?.data_quality || 0) * 100)}%` : "暂无股票池" },
    { key: "etf", name: "ETF行情", required: true, rows: etfs.etfs?.length || 0, source: sourceFor("etf", etfs.source), state: etfs.etfs?.length ? "ready" : "missing", message: etfs.etfs?.length ? "行情已入库" : "暂无ETF" },
    { key: "sector", name: "板块资金", required: true, rows: sectors.sectors?.length || 0, source: sourceFor("sector", sectors.source), state: sectors.sectors?.length ? "ready" : "missing", message: sectors.sectors?.length ? "资金流已入库" : "暂无板块资金" },
    { key: "history", name: "历史K线", required: true, rows: historyRows, source: sourceFor("history", "历史行情"), state: historyRows ? "ready" : "missing", message: historyRows ? "历史K线已入库" : "暂无历史K线" },
    { key: "global", name: "海外指数", required: false, rows: globalRows, source: sourceFor("global", markets.source), state: globalRows >= 5 ? "ready" : "partial", message: globalRows >= 5 ? "海外指数已入库" : "部分海外指数不可用" },
    { key: "sector_members", name: "板块成分", required: false, rows: sectorMemberRows, source: sourceFor("sector_members", "板块成分"), state: sectorMemberRows ? "ready" : "partial", message: sectorMemberRows ? "成分映射已入库" : "暂无成分映射" },
    { key: "news", name: "公开资讯", required: false, rows: newsRows, source: sourceFor("news", "手动资讯素材"), state: newsRows ? "ready" : "partial", message: newsRows ? "资讯素材已入库" : "请手动补充资讯" }
  ];
  const required = modules.filter((item) => item.required);
  return {
    checkedAt: new Date().toISOString(),
    ready: required.every((item) => item.state === "ready"),
    modules,
    summary: required.every((item) => item.state === "ready") ? "核心数据已补齐，可开始分析" : "核心数据仍有缺口，请先刷新对应数据"
  };
}

async function generateWechatPackage(options = {}) {
  const normalized = normalizeWorkflowOptions(options);
  const localDraft = buildWechatDraft(normalized);
  const context = buildMarketContext();
  const aiContext = compactMarketContext(context);
  const agnes = getAgnesConfig();
  const writer = getAiConfig();
  const pipeline = [];
  let planningText = "";
  let markdown = localDraft.markdown;
  let source = localDraft.source;
  let planningOk = false;

  if (agnes.configured) {
    const planningPrompt = [
      "请基于以下结构化行情数据，输出公众号文章规划。",
      "只用给定数据，不编造数字；公开表达，不写个股推荐、买卖建议、收益承诺。",
      "输出控制在800字内，包含：核心摘要、文章结构、模块要点、配图方向。",
      `文章类型：${normalized.articleType}`,
      `参考风格：${normalized.style}`,
      `关键词：${normalized.keywords || "无"}`,
      `额外要求：${normalized.requirements || "无"}`,
      `模块：${normalized.modules.join("、")}`,
      JSON.stringify(aiContext)
    ].join("\n\n");
    const result = await callChatCompletion(agnes, [
      { role: "system", content: "你是财经公众号编辑助理，只做资料汇总、结构规划和排版建议。严禁编造行情数字。" },
      { role: "user", content: planningPrompt }
    ], { temperature: 0.2, timeoutMs: Number(process.env.AGNES_PLANNING_TIMEOUT_MS || 45_000), maxTokens: 900 });
    if (result.ok && result.text) {
      planningText = result.text;
      planningOk = true;
      pipeline.push({ step: "Agnes 汇总排版", provider: agnes.provider, ok: true });
    } else {
      pipeline.push({ step: "Agnes 汇总排版", provider: agnes.provider, ok: false, message: result.error || "未返回内容" });
      planningText = localDraft.sections.map((section) => `## ${section.title}\n${section.text}`).join("\n\n");
    }
  } else {
    pipeline.push({ step: "Agnes 汇总排版", provider: "Agnes", ok: false, message: "未配置 AGNES_API_KEY" });
    planningText = localDraft.sections.map((section) => `## ${section.title}\n${section.text}`).join("\n\n");
  }

  if (writer.configured) {
    const writingPrompt = [
      "请根据 Agnes 的资料汇总和排版规划，生成一篇可复制到微信公众号的 Markdown 文章。",
      "硬性规则：",
      "1. 只能使用结构化行情数据和 Agnes 汇总里的事实数字，不得新增数字。",
      "2. 不得出现买入、卖出、必涨、目标收益、目标价、仓位指令、推荐股、候选池、命中分等表达。",
      "3. 文章要像简约金融报纸风：标题克制、段落清楚、模块分明。",
      "4. 必须包含：标题、今日导读、A股、ETF/板块资金、海外/风险、免责声明。",
      "5. 输出纯 Markdown，不要解释过程。",
      `文章类型：${normalized.articleType}`,
      `参考风格：${normalized.style}`,
      `关键词：${normalized.keywords || "无"}`,
      `额外要求：${normalized.requirements || "无"}`,
      "Agnes 汇总排版：",
      planningText,
      "结构化行情数据：",
      JSON.stringify(aiContext)
    ].join("\n\n");
    const result = await callChatCompletion(writer, [
      { role: "system", content: "你是财经公众号主笔，负责把资料规划改写成公开安全、结构清楚的公众号文章。" },
      { role: "user", content: writingPrompt }
    ], { temperature: 0.35, maxTokens: 1800 });
    if (result.ok && result.text) {
      markdown = sanitizePublicMarkdown(result.text);
      source = `${planningOk ? "Agnes汇总排版" : "本地汇总"} / ${writer.provider}成稿`;
      pipeline.push({ step: "公众号成稿", provider: writer.provider, ok: true });
    } else {
      pipeline.push({ step: "公众号成稿", provider: writer.provider, ok: false, message: result.error || "未返回内容" });
    }
  } else {
    pipeline.push({ step: "公众号成稿", provider: writer.provider, ok: false, message: "未配置 AI_API_KEY" });
  }

  const title = extractTitle(markdown) || localDraft.title;
  const imagePrompt = buildImagePrompt(normalized, { title });
  let imageResult = { ok: false, asset: null, provider: getImageAiConfig().provider, error: "待手动生成封面图" };
  if (normalized.generateImage) {
    imageResult = await generateCoverImage(imagePrompt, title);
    if (imageResult.ok) {
      pipeline.push({ step: "Agnes 生图", provider: imageResult.provider, ok: true });
    } else {
      pipeline.push({ step: "Agnes 生图", provider: imageResult.provider || "Agnes", ok: false, message: imageResult.error || "未生成图片" });
    }
  } else {
    pipeline.push({ step: "Agnes 生图", provider: getImageAiConfig().provider, ok: getImageAiConfig().configured, message: getImageAiConfig().configured ? "已生成提示词，等待手动生图" : "图片入口待配置" });
  }

  const review = reviewDraftText(markdown);
  return {
    ...localDraft,
    source,
    title,
    markdown,
    html: markdownToHtml(markdown),
    review,
    summary: "Agnes 先汇总排版，文案模型再生成公众号公开稿。",
    imagePrompt,
    imageAsset: imageResult.asset || null,
    aiPlanning: planningText,
    aiPipeline: pipeline,
    sections: sectionsFromMarkdown(markdown, localDraft.sections)
  };
}

function buildWechatDraft(options = {}) {
  const normalized = normalizeWorkflowOptions(options);
  const context = buildMarketContext();
  const meta = sessionMeta(normalized.session);
  const title = titleForDraft(normalized, context);
  const sections = buildPublicSections(normalized, context);
  const lead = buildDraftLead(normalized, context);
  const intro = normalized.keywords
    ? `本篇围绕“${normalized.keywords}”整理公开行情、ETF 和板块资金线索，尽量用数据把市场节奏说清楚。`
    : `${meta.name}基于公开行情数据，整理主要指数、ETF 与板块资金变化，帮助快速把握盘面轮廓。`;
  const markdown = [
    `# ${title}`,
    "",
    intro,
    "",
    "## 今日导读",
    lead,
    "",
    ...sections.flatMap((section) => ["## " + section.title, section.text, ""]),
    "",
    `数据来源：${context.source}`,
    `更新时间：${context.updatedAt}`,
    "",
    "以上内容仅为公开市场信息整理和个人研究记录，不构成任何投资建议。市场有风险，决策需谨慎。"
  ].join("\n");
  return {
    updatedAt: context.updatedAt,
    source: context.source,
    session: normalized.session,
    articleType: normalized.articleType,
    style: normalized.style,
    modules: normalized.modules,
    title,
    summary: "公开市场信息整理，不含自用预测、候选池或买卖指令。",
    markdown,
    html: markdownToHtml(markdown),
    review: reviewDraftText(markdown),
    sections,
    imagePrompt: buildImagePrompt(normalized, { title }),
    disclaimer: "以上内容仅为公开市场信息整理和个人研究记录，不构成任何投资建议。市场有风险，决策需谨慎。"
  };
}

function buildMarketContext() {
  const marketsData = store.getSnapshot("markets", "markets");
  const etfsData = store.getSnapshot("etfs", "etfs");
  const flowsData = store.getSnapshot("sectorFlows", "sectors");
  const newsItems = store.listNewsItems(12);
  const indexes = (marketsData.markets || []).flatMap((market) => market.indexes?.map((index) => ({ ...index, region: market.region })) || []);
  const topIndexes = indexes.slice(0, 5).map((item) => `${item.region}${item.name}${formatPercent(item.change_pct)}`).join("，") || "暂无指数数据";
  const topFlows = (flowsData.sectors || []).filter(hasUsableSectorInflow).slice(0, 5).map((item) => `${item.name}净流入${formatSectorMoneySigned(item.net_inflow)}`).join("，") || "暂无有效板块净流入数据";
  const topEtfs = (etfsData.etfs || []).filter(hasUsableMarketValue).slice(0, 4).map((item) => `${item.name}涨跌幅${formatPercent(item.change_pct)}`).join("，") || "暂无有效 ETF 数据";
  return {
    updatedAt: marketsData.updatedAt,
    source: `指数:${marketsData.source} / ETF:${etfsData.source} / 板块:${flowsData.source}`,
    hasAnyData: Boolean(indexes.length || (etfsData.etfs || []).length || (flowsData.sectors || []).length),
    indexes: indexes.slice(0, 12),
    etfs: (etfsData.etfs || []).slice(0, 12),
    sectorFlows: (flowsData.sectors || []).slice(0, 12),
    newsItems: newsItems.slice(0, 8),
    marketSummary: topIndexes,
    flowSummary: `${topFlows}；ETF 观察：${topEtfs}`,
    newsSummary: newsItems.length ? newsItems.slice(0, 5).map((item) => `${item.source}:${item.title}`).join("；") : "暂无资讯素材"
  };
}

function compactMarketContext(context) {
  return {
    updatedAt: context.updatedAt,
    source: context.source,
    marketSummary: context.marketSummary,
    flowSummary: context.flowSummary,
    newsSummary: context.newsSummary,
    indexes: (context.indexes || []).slice(0, 10).map((item) => ({
      region: item.region,
      name: item.name,
      code: item.code,
      value: item.value,
      change_pct: item.change_pct,
      trend: item.trend,
      source_name: item.source_name
    })),
    sectorFlows: (context.sectorFlows || []).slice(0, 10).map((item) => ({
      name: item.name,
      change_pct: item.change_pct,
      net_inflow: item.net_inflow,
      up_count: item.up_count,
      down_count: item.down_count,
      leaders: item.leaders
    })),
    etfs: (context.etfs || []).slice(0, 10).map((item) => ({
      code: item.code,
      name: item.name,
      category: item.category,
      tracking: item.tracking,
      change_pct: item.change_pct,
      amount: item.amount,
      net_inflow: item.net_inflow
    })),
    newsItems: (context.newsItems || []).slice(0, 6).map((item) => ({
      title: item.title,
      source: item.source,
      category: item.category,
      summary: item.summary
    }))
  };
}

function normalizeWorkflowOptions(options) {
  const session = ["preopen", "midday", "close"].includes(options.session) ? options.session : "close";
  const meta = sessionMeta(session);
  const allowedModules = new Set(["美股", "A股", "港股/海外", "商品/汇率", "ETF观察", "板块资金", "新闻资讯", "风险提示"]);
  const requestedModules = Array.isArray(options.modules) ? options.modules.map(String).filter((item) => allowedModules.has(item)) : [];
  const modules = requestedModules.length ? requestedModules : meta.modules;
  return {
    session,
    articleType: String(options.articleType || meta.articleType),
    style: String(options.style || "数据解读型"),
    modules,
    keywords: String(options.keywords || ""),
    requirements: String(options.requirements || ""),
    generateImage: Boolean(options.generateImage)
  };
}

function sessionMeta(session) {
  const map = {
    preopen: {
      name: "盘前风向",
      window: "08:30-09:15",
      articleType: "早盘观察",
      modules: ["美股", "港股/海外", "商品/汇率", "风险提示"],
      titlePrefix: "早盘市场观察",
      focus: "集合竞价前"
    },
    midday: {
      name: "午间复盘",
      window: "11:35-12:30",
      articleType: "午间快评",
      modules: ["A股", "板块资金", "ETF观察", "风险提示"],
      titlePrefix: "午间盘面快评",
      focus: "下午观察"
    },
    close: {
      name: "收盘总结",
      window: "15:15-17:30",
      articleType: "收盘复盘",
      modules: ["A股", "美股", "港股/海外", "ETF观察", "板块资金", "新闻资讯", "风险提示"],
      titlePrefix: "收盘后市场复盘",
      focus: "次日准备"
    }
  };
  return map[session] || map.close;
}

function draftStatusFor(session) {
  const hour = new Date().getHours();
  if (session === "preopen") return hour >= 8 ? "待生成" : "待数据";
  if (session === "midday") return hour >= 11 ? "待生成" : "待数据";
  return hour >= 15 ? "待生成" : "待数据";
}

function titleForDraft(options, context) {
  const meta = sessionMeta(options.session);
  const mainIndex = context.indexes[0];
  const marketCue = mainIndex ? `${mainIndex.name}${formatPercent(mainIndex.change_pct)}` : "数据待更新";
  if (options.keywords) return `${meta.titlePrefix}：${options.keywords}`;
  if (options.session === "preopen") return `${meta.titlePrefix}：海外市场与今日关注`;
  if (options.session === "midday") return `${meta.titlePrefix}：${marketCue}，板块资金线索梳理`;
  return `${meta.titlePrefix}：指数、ETF 与板块资金线索`;
}

function buildPublicSections(options, context) {
  const moduleText = {
    "美股": usMarketText(context),
    "A股": aShareText(context),
    "港股/海外": overseasText(context),
    "商品/汇率": "黄金、原油、美元指数等跨市场数据暂按后续接入状态展示；缺失时不补写具体涨跌数字。",
    "ETF观察": etfText(context),
    "板块资金": sectorText(context),
    "新闻资讯": newsText(context),
    "风险提示": riskText(options)
  };
  return options.modules
    .filter((name) => moduleText[name])
    .map((name) => ({ title: name, text: moduleText[name] }));
}

function buildDraftLead(options, context) {
  const strongest = [...context.indexes].sort((a, b) => Number(b.change_pct || 0) - Number(a.change_pct || 0))[0];
  const topFlow = [...context.sectorFlows].filter(hasUsableSectorInflow).sort((a, b) => Number(b.net_inflow || 0) - Number(a.net_inflow || 0))[0];
  const topEtf = [...context.etfs].filter(hasUsableMarketValue).sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  const parts = [];
  if (strongest) parts.push(`主要指数中，${strongest.region}${strongest.name}表现相对靠前，涨跌幅为${formatPercent(strongest.change_pct)}。`);
  if (topFlow) parts.push(`板块资金方面，${topFlow.name}：净流入${formatSectorMoneySigned(topFlow.net_inflow)}，可作为观察市场热度的线索之一。`);
  if (topEtf) parts.push(`ETF 端，${topEtf.name}：涨跌幅${formatPercent(topEtf.change_pct)}，成交额${formatArticleMoney(topEtf.amount)}。`);
  if (!parts.length) return "当前数据源暂未提供足够行情细节，本文先保留结构，等待下一轮刷新补充。";
  return parts.join(" ");
}

function aShareText(context) {
  const rows = context.indexes.filter((item) => item.region === "A股").slice(0, 5);
  if (!rows.length) return "A股指数数据暂无更新，页面将继续显示缓存或暂无数据状态。";
  return rows.map((item) => `${item.name}${formatPercent(item.change_pct)}，最新点位 ${formatNumber(item.value)}。`).join(" ");
}

function usMarketText(context) {
  const rows = context.indexes.filter((item) => item.region === "美股").slice(0, 3);
  if (!rows.length) return "美股指数数据暂无更新，暂不补写具体点位和涨跌幅。";
  return rows.map((item) => `${item.name}${formatPercent(item.change_pct)}。`).join(" ");
}

function overseasText(context) {
  const rows = context.indexes.filter((item) => item.region !== "A股" && item.region !== "美股").slice(0, 6);
  if (!rows.length) return "港股、日本、韩国等海外指数数据暂无更新。";
  return rows.map((item) => `${item.region}${item.name}${formatPercent(item.change_pct)}。`).join(" ");
}

function etfText(context) {
  if (!context.etfs.length) return "ETF 数据暂无更新，暂不补写成交额或资金变化。";
  const rows = context.etfs.filter((item) => hasUsableMarketValue(item) || Number(item.change_pct) !== 0).slice(0, 5);
  if (!rows.length) return "ETF 行情暂无有效成交额或涨跌幅数据。";
  return rows.map((item) => {
    const amount = hasUsableMarketValue(item) ? `，成交额${formatArticleMoney(item.amount)}` : "，成交额暂无数据";
    return `${item.name}：涨跌幅${formatPercent(item.change_pct)}${amount}。`;
  }).join(" ");
}

function sectorText(context) {
  if (!context.sectorFlows.length) return "板块资金流数据暂无更新。";
  const rows = context.sectorFlows.filter(hasUsableSectorInflow).slice(0, 5);
  if (!rows.length) return "板块涨跌幅数据已更新，但净流入字段暂无有效数据。";
  return rows.map((item) => `${item.name}：净流入${formatSectorMoneySigned(item.net_inflow)}，涨跌幅${formatPercent(item.change_pct)}。`).join(" ");
}

function newsText(context) {
  if (!context.newsItems?.length) return "资讯素材池暂无可用内容；当前不搬运第三方公众号原文。";
  return context.newsItems.slice(0, 5).map((item) => `${item.source}：${item.title}${item.url ? `（来源链接已记录）` : ""}。`).join(" ");
}

function relatedNews(items, keyword) {
  const key = String(keyword || "").toLowerCase();
  if (!key) return items || [];
  return (items || []).filter((item) => [item.title, item.summary, item.content, item.category].some((value) => String(value || "").toLowerCase().includes(key) || key.includes(String(value || "").toLowerCase())));
}

function riskText(options) {
  const prefix = options.session === "preopen"
    ? "盘前阶段"
    : options.session === "midday"
      ? "午后阶段"
      : "收盘后复盘阶段";
  return `${prefix}需要关注外围市场波动、板块高换手后的承接变化，以及资金快速轮动带来的短线波动。本文仅整理公开信息，不构成投资建议。`;
}

function buildImagePrompt(options, draft) {
  const style = options.style || "数据解读型";
  const keyword = options.keywords ? `，主题关键词：${options.keywords}` : "";
  return `财经公众号封面图，深色行情终端风格，主题为“${draft.title || sessionMeta(options.session).titlePrefix}”，风格${style}${keyword}，包含抽象指数折线、资金流向、城市夜景，不出现具体股票代码、收益承诺、平台Logo。`;
}

function localSummary(context) {
  return [`市场概览：${context.marketSummary}`, `资金线索：${context.flowSummary}`, "提示：本摘要基于缓存数据生成，不包含买卖建议。"].join("\n");
}

function getAiConfig() {
  return resolveProviderConfig("ai", {
    provider: "Agnes",
    model: "agnes-2.0-flash",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    envProvider: process.env.AI_PROVIDER || process.env.AGNES_PROVIDER,
    envApiKey: process.env.AI_API_KEY || process.env.AGNES_API_KEY,
    envModel: process.env.AI_MODEL || process.env.AGNES_MODEL,
    envBaseUrl: process.env.AI_BASE_URL || process.env.AGNES_BASE_URL
  });
}

function getAgnesConfig() {
  return resolveProviderConfig("agnes", {
    provider: "Agnes",
    model: "agnes-2.0-flash",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    envProvider: process.env.AGNES_PROVIDER,
    envApiKey: process.env.AGNES_API_KEY,
    envModel: process.env.AGNES_MODEL,
    envBaseUrl: process.env.AGNES_BASE_URL
  });
}

function getImageAiConfig() {
  const agnes = getAgnesConfig();
  return resolveProviderConfig("image", {
    provider: agnes.provider || "Agnes",
    model: "agnes-image-2.0-flash",
    baseUrl: agnes.baseUrl || "https://apihub.agnes-ai.com/v1",
    apiKey: agnes.apiKey,
    envProvider: process.env.IMAGE_AI_PROVIDER,
    envApiKey: process.env.IMAGE_AI_API_KEY,
    envModel: process.env.IMAGE_AI_MODEL || process.env.AI_IMAGE_MODEL || process.env.AGNES_IMAGE_MODEL,
    envBaseUrl: process.env.IMAGE_AI_BASE_URL
  });
}

function getVideoAiConfig() {
  const agnes = getAgnesConfig();
  return resolveProviderConfig("video", {
    provider: agnes.provider || "Agnes",
    model: "agnes-video-2.0",
    baseUrl: agnes.baseUrl || "https://apihub.agnes-ai.com/v1",
    apiKey: agnes.apiKey,
    envProvider: process.env.VIDEO_AI_PROVIDER || process.env.AGNES_VIDEO_PROVIDER,
    envApiKey: process.env.VIDEO_AI_API_KEY || process.env.AGNES_VIDEO_API_KEY,
    envModel: process.env.VIDEO_AI_MODEL || process.env.AGNES_VIDEO_MODEL,
    envBaseUrl: process.env.VIDEO_AI_BASE_URL || process.env.AGNES_VIDEO_BASE_URL
  });
}

function getRuntimeConfig() {
  try {
    if (!fs.existsSync(runtimeConfigPath)) return { __exists: false };
    const data = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf-8"));
    return { ...data, __exists: true };
  } catch {
    return { __exists: false };
  }
}

function resolveProviderConfig(section, defaults) {
  const runtime = getRuntimeConfig()[section] || {};
  const provider = defaults.envProvider || runtime.provider || defaults.provider;
  const apiKey = defaults.envApiKey || runtime.apiKey || defaults.apiKey || "";
  const model = defaults.envModel || runtime.model || defaults.model;
  const baseUrl = defaults.envBaseUrl || runtime.baseUrl || defaults.baseUrl;
  return {
    provider,
    apiKey,
    model,
    baseUrl,
    configured: Boolean(apiKey),
    source: defaults.envApiKey ? "环境变量" : runtime.apiKey ? "本地配置" : "未配置"
  };
}

function sanitizeConfigSection(next = {}, previous = {}) {
  const clean = {
    provider: String(next.provider || previous?.provider || "").trim(),
    model: String(next.model || previous?.model || "").trim(),
    baseUrl: String(next.baseUrl || previous?.baseUrl || "").trim(),
    apiKey: String(next.apiKey || "").trim()
  };
  if (!clean.apiKey && previous?.apiKey) clean.apiKey = previous.apiKey;
  return Object.fromEntries(Object.entries(clean).filter(([, value]) => value));
}

function safeConfigForClient(config) {
  return {
    provider: config.provider || "",
    model: config.model || "",
    baseUrl: config.baseUrl || "",
    configured: Boolean(config.configured),
    keyPreview: maskKey(config.apiKey),
    source: config.source || ""
  };
}

function maskKey(key) {
  const value = String(key || "");
  if (!value) return "";
  if (value.length <= 10) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 6)}***${value.slice(-6)}`;
}

async function callChatCompletion(config, messages, options = {}) {
  if (!config.configured) return { ok: false, error: "未配置 API Key" };
  try {
    const body = {
      model: config.model,
      messages,
      temperature: options.temperature ?? 0.2
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(options.timeoutMs || 60_000),
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "KomoMarketDashboard/1.0",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) return { ok: false, error: `${config.provider} 请求失败: ${response.status}` };
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || "";
    return { ok: Boolean(text), text, data };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

async function generateCoverImage(prompt, title) {
  const config = getImageAiConfig();
  if (!config.configured) return { ok: false, provider: config.provider, error: "未配置 Agnes 生图 Key" };
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.IMAGE_AI_TIMEOUT_MS || 60_000)),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        prompt,
        size: process.env.IMAGE_AI_SIZE || "1024x768",
        extra_body: {
          response_format: process.env.IMAGE_AI_RESPONSE_FORMAT || "url"
        },
        n: 1
      })
    });
    if (!response.ok) return { ok: false, provider: config.provider, error: `${config.provider} 生图失败: ${response.status}` };
    const data = await response.json();
    const image = data.data?.[0] || {};
    const safeName = `wechat-cover-${Date.now()}.png`;
    let localPath = image.url || "";
    if (image.url) {
      try {
        const imageResponse = await fetch(image.url, { signal: AbortSignal.timeout(30_000) });
        if (imageResponse.ok) {
          const contentType = imageResponse.headers.get("content-type") || "image/png";
          const extension = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
          const filePath = path.join(store.assetsDir, `${path.basename(safeName, ".png")}.${extension}`);
          fs.writeFileSync(filePath, Buffer.from(await imageResponse.arrayBuffer()));
          localPath = `/assets/${path.basename(filePath)}`;
        }
      } catch {
        // 保留供应商 URL，避免图片下载失败导致已经生成的结果丢失。
      }
    }
    if (image.b64_json) {
      const filePath = path.join(store.assetsDir, safeName);
      fs.writeFileSync(filePath, Buffer.from(image.b64_json, "base64"));
      localPath = `/assets/${safeName}`;
    }
    if (!localPath) return { ok: false, provider: config.provider, error: "生图接口未返回图片" };
    const asset = store.addAsset({
      title: `${title || "公众号封面"}配图`,
      type: "封面",
      purpose: "公众号",
      source: config.provider,
      local_path: localPath,
      prompt
    });
    return { ok: true, provider: config.provider, asset };
  } catch (error) {
    return { ok: false, provider: config.provider, error: String(error.message || error) };
  }
}

async function generateVideoMaterial(prompt, options = {}) {
  const config = getVideoAiConfig();
  if (!config.configured) return { ok: false, provider: config.provider, message: "未配置 Agnes 视频 Key" };
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/videos`, {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.VIDEO_AI_TIMEOUT_MS || 60_000)),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        prompt,
        duration: Number(options.duration || process.env.VIDEO_AI_DURATION || 6),
        size: options.size || process.env.VIDEO_AI_SIZE || "1280x720"
      })
    });
    if (!response.ok) return { ok: false, provider: config.provider, message: `${config.provider} 视频任务失败: ${response.status}` };
    const data = await response.json();
    const video = data.data?.[0] || data;
    const taskId = video.id || video.task_id || data.id || data.task_id || "";
    const url = video.url || video.video_url || video.output_url || "";
    let asset = null;
    if (url) {
      asset = store.addAsset({
        title: `${String(options.title || "公众号视频素材").slice(0, 40)}`,
        type: "视频",
        purpose: "公众号",
        source: config.provider,
        local_path: url,
        prompt
      });
    }
    return {
      ok: true,
      provider: config.provider,
      model: config.model,
      taskId,
      url,
      asset,
      message: url ? "视频素材已生成并登记。" : "视频任务已创建，请到 Agnes 后台或接口结果中查看进度。",
      rawStatus: data.status || video.status || "submitted"
    };
  } catch (error) {
    return { ok: false, provider: config.provider, message: String(error.message || error) };
  }
}

function sanitizePublicMarkdown(markdown) {
  let text = String(markdown || "").trim();
  text = text.replace(/^```(?:markdown)?/i, "").replace(/```$/i, "").trim();
  const replacements = new Map([
    ["买入", "关注"],
    ["卖出", "回避"],
    ["必涨", "走强"],
    ["必跌", "走弱"],
    ["目标收益", "预期变化"],
    ["目标价", "估值观察"],
    ["仓位指令", "风险提示"],
    ["推荐股", "个股案例"],
    ["候选池", "观察范围"],
    ["命中分", "观察维度"],
    ["稳赚", "确定性表述"],
    ["翻倍", "大幅波动"]
  ]);
  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }
  if (!/^#\s+/m.test(text)) text = `# 今日市场观察\n\n${text}`;
  if (!text.includes("不构成任何投资建议")) {
    text += "\n\n## 免责声明\n以上内容仅为公开市场信息整理和个人研究记录，不构成任何投资建议。市场有风险，决策需谨慎。";
  }
  return text;
}

function sectionsFromMarkdown(markdown, fallback = []) {
  const matches = [...String(markdown).matchAll(/^##\s+(.+)$/gm)].map((match) => ({ title: match[1], text: "" }));
  return matches.length ? matches : fallback;
}

function matchesConditions(item, conditions, logic) {
  if (!conditions.length) return true;
  const checks = conditions.map((condition) => evaluateCondition(item, condition));
  return logic === "OR" ? checks.some(Boolean) : checks.every(Boolean);
}

function evaluateCondition(item, condition) {
  const value = item[condition.field];
  const op = condition.operator;
  if (value === null || value === undefined || value === "") return false;
  if (op === "contains") return String(value).includes(String(condition.value || ""));
  if (op === "not_contains") return !String(value).includes(String(condition.value || ""));
  if (op === "=" && Number.isNaN(Number(value))) return String(value) === String(condition.value || "");
  const numeric = Number(value);
  const target = Number(condition.value);
  const max = Number(condition.value2);
  if (!Number.isFinite(numeric)) return false;
  if (op === ">") return numeric > target;
  if (op === ">=") return numeric >= target;
  if (op === "<") return numeric < target;
  if (op === "<=") return numeric <= target;
  if (op === "=") return numeric === target;
  if (op === "between") return numeric >= target && numeric <= max;
  return false;
}

function getStockHistory(stock, window) {
  const raw = String(stock.code || "");
  const pure = raw.replace(/^(sh|sz|bj)\./i, "").replace(/\.(SH|SZ|BJ)$/i, "");
  const suffix = pure.startsWith("6") || pure.startsWith("68") ? ".SH" : pure.startsWith("8") || pure.startsWith("4") ? ".BJ" : ".SZ";
  const candidates = [...new Set([raw, pure, `${pure}${suffix}`, `${suffix.slice(1).toLowerCase()}${pure}`])];
  const types = stock?.market === "ETF" ? ["etf", "stock"] : ["stock", "etf"];
  for (const type of types) {
    for (const code of candidates) {
      const result = store.getHistory({ type, code, window });
      if (result.points?.length) return result;
    }
  }
  return { status: "empty", source: "暂无历史数据", window, points: [] };
}

function buildStockResearch(stock, history, prediction) {
  const points = (history.points || []).filter((point) => Number.isFinite(Number(point.close))).map((point) => ({ ...point, close: Number(point.close) }));
  const closes = points.map((point) => point.close);
  const latest = closes.at(-1);
  const first = closes[0];
  const change = latest && first ? ((latest / first) - 1) * 100 : null;
  const ma5 = average(closes.slice(-5));
  const ma20 = average(closes.slice(-20));
  const rsi14 = calculateRsi(closes, 14);
  const macd = calculateMacd(closes);
  const volatility = calculateVolatility(closes);
  const trend = ma5 === null || ma20 === null ? "数据不足" : ma5 >= ma20 ? "短期强于中期" : "短期弱于中期";
  const evidence = [
    { label: "价格趋势", value: trend, detail: change === null ? "历史收盘价不足" : `区间变化 ${formatPercent(change)}` },
    { label: "均线结构", value: ma5 === null ? "暂无数据" : `MA5 ${formatNumber(ma5)}`, detail: ma20 === null ? "MA20 暂无数据" : `MA20 ${formatNumber(ma20)}` },
    { label: "动能", value: rsi14 === null ? "暂无数据" : `RSI14 ${formatNumber(rsi14)}`, detail: macd === null ? "MACD 暂无数据" : `MACD ${formatNumber(macd)}` },
    { label: "波动", value: volatility === null ? "暂无数据" : `${formatPercent(volatility)} / 日`, detail: "基于历史收盘价计算" }
  ];
  const strengths = [];
  const risks = [];
  if (ma5 !== null && ma20 !== null && ma5 >= ma20) strengths.push("短期均线位于中期均线之上");
  if (Number(stock.volume_ratio) >= 1.5) strengths.push(`量比 ${formatNumber(stock.volume_ratio)}，成交活跃度较高`);
  if (Number(stock.turnover_rate) >= 5) strengths.push(`换手率 ${formatPercent(stock.turnover_rate)}，市场参与度较高`);
  if (ma5 !== null && ma20 !== null && ma5 < ma20) risks.push("短期均线弱于中期均线，趋势仍需观察");
  if (rsi14 !== null && rsi14 >= 70) risks.push("RSI 处于相对高位，注意波动放大");
  if (rsi14 !== null && rsi14 <= 30) risks.push("RSI 处于相对低位，不能单独作为反转依据");
  if (!points.length) risks.push("当前没有该标的历史 K 线，技术指标未计算");
  return {
    code: stock.code,
    name: stock.name,
    sector: stock.sector,
    updatedAt: history.updatedAt || stock.update_time,
    source: [stock.source_name || "A股股票池", history.source || "暂无历史数据"].join(" / "),
    window: history.window,
    historyStatus: history.status || "empty",
    points,
    metrics: {
      price: stock.price,
      change_pct: stock.change_pct,
      volume_ratio: stock.volume_ratio,
      turnover_rate: stock.turnover_rate,
      amount: stock.amount,
      market_cap: stock.market_cap,
      period_change_pct: change,
      ma5,
      ma20,
      rsi14,
      macd,
      volatility
    },
    evidence,
    strengths: strengths.length ? strengths : ["当前数据未显示明确优势，需要结合更多基本面和资讯判断"],
    risks: risks.length ? risks : ["未发现明显技术风险，但历史数据和实时数据可能存在延迟"],
    hit_score: prediction.hit_score,
    level: prediction.level,
    disclaimer: "仅供个人研究，不构成投资建议。命中分不是收益预测，也不代表未来表现。"
  };
}

function buildResearchForecast(stock, history, prediction) {
  const closes = (history.points || []).map((point) => Number(point.close ?? point.value)).filter(Number.isFinite);
  const latest = closes.at(-1) || Number(stock.price) || null;
  const previous = closes.at(-2) || latest;
  const fiveStart = closes.at(-6) || closes[0] || latest;
  const momentum1 = latest && previous ? (latest / previous - 1) * 100 : null;
  const momentum5 = latest && fiveStart ? (latest / fiveStart - 1) * 100 : null;
  const volatility = closes.length > 2 ? calculateVolatility(closes) : null;
  const baseVol = Number.isFinite(volatility) ? Math.max(volatility, 0.6) : 2.5;
  const signal = Number.isFinite(momentum5) ? momentum5 * 0.35 + (Number.isFinite(momentum1) ? momentum1 * 0.15 : 0) : 0;
  const buildHorizon = (horizon, multiplier) => {
    const expected = clampNumber(signal * multiplier, -8, 8);
    const band = clampNumber(baseVol * Math.sqrt(multiplier) * 1.35, 1.2, 12);
    const direction = expected > 0.5 ? "偏强" : expected < -0.5 ? "偏弱" : "震荡";
    return {
      horizon,
      direction,
      expected_change_pct: Number(expected.toFixed(2)),
      range_pct: [Number((expected - band).toFixed(2)), Number((expected + band).toFixed(2))],
      confidence: closes.length >= 20 ? (baseVol < 3 ? "中" : "低") : "低"
    };
  };
  return {
    code: stock.code,
    name: stock.name,
    createdAt: now(),
    source: "本地量化研究",
    current_price: latest,
    model: "历史动量 + 波动区间",
    basis: {
      history_points: closes.length,
      momentum_1d_pct: Number.isFinite(momentum1) ? Number(momentum1.toFixed(2)) : null,
      momentum_5d_pct: Number.isFinite(momentum5) ? Number(momentum5.toFixed(2)) : null,
      volatility_pct: Number.isFinite(volatility) ? Number(volatility.toFixed(2)) : null,
      hit_score: prediction.hit_score
    },
    horizons: [buildHorizon("下一交易日", 1), buildHorizon("未来5个交易日", 2.2)],
    risks: [
      "这是基于历史价格行为的研究区间，不是确定性预测。",
      closes.length < 20 ? "历史样本不足，置信度较低。" : "历史波动可能因突发新闻、政策和流动性变化而失效。"
    ],
    disclaimer: "仅供个人研究，不构成投资建议；不代表未来收益或买卖指令。"
  };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function calculateRsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  return 100 - (100 / (1 + (gains / period) / (losses / period)));
}

function calculateMacd(values) {
  if (values.length < 26) return null;
  const ema = (period) => {
    const multiplier = 2 / (period + 1);
    let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    for (const value of values.slice(period)) current = (value - current) * multiplier + current;
    return current;
  };
  return ema(12) - ema(26);
}

function calculateVolatility(values) {
  if (values.length < 3) return null;
  const returns = values.slice(1).map((value, index) => (value / values[index] - 1) * 100);
  const mean = average(returns);
  if (mean === null) return null;
  return Math.sqrt(average(returns.map((value) => (value - mean) ** 2)) || 0);
}

function historicalPaperIndicators(points, index) {
  const closes = points.slice(0, index + 1).map((point) => Number(point.close ?? point.value)).filter(Number.isFinite);
  const latest = closes.at(-1);
  const previous = closes.at(-2);
  const ma5 = average(closes.slice(-5));
  const ma20 = average(closes.slice(-20));
  const ma60 = closes.length >= 60 ? average(closes.slice(-60)) : null;
  const high20 = closes.length >= 20 ? Math.max(...closes.slice(-20)) : null;
  const low20 = closes.length >= 20 ? Math.min(...closes.slice(-20)) : null;
  const drawdown20 = high20 && Number.isFinite(latest) ? (latest / high20 - 1) * 100 : null;
  return {
    closes,
    latest,
    ma5,
    ma20,
    ma60,
    rsi14: calculateRsi(closes, 14),
    volatility: calculateVolatility(closes),
    drawdown20,
    rebound: Number.isFinite(previous) && Number.isFinite(low20) && latest > previous && latest > low20,
    ma5AboveMa20: Number.isFinite(ma5) && Number.isFinite(ma20) ? ma5 >= ma20 : null,
    ma20AboveMa60: Number.isFinite(ma20) && Number.isFinite(ma60) ? ma20 >= ma60 : null
  };
}

function evaluateHistoricalPaperSignal(points, index, rules) {
  const point = points[index];
  const indicators = historicalPaperIndicators(points, index);
  const close = Number(point.close ?? point.value);
  const changePct = Number(point.change_pct);
  const reasons = [];
  const omitted = [];
  if (!Number.isFinite(close) || indicators.closes.length < 20) return { pass: false, score: 0, reason: "历史样本不足（至少需要20根K线）", indicators, omitted };
  if (Number.isFinite(changePct) && (changePct < rules.minChange || changePct > rules.maxChange)) reasons.push("涨跌幅不在策略区间");
  if (!Number.isFinite(changePct)) omitted.push("涨跌幅字段缺失");
  const amount = Number(point.amount);
  if (rules.minAmount > 0) {
    if (Number.isFinite(amount)) {
      if (amount < rules.minAmount) reasons.push("成交额低于策略下限");
    } else omitted.push("历史成交额缺失");
  }
  const scoreParts = [];
  if (indicators.ma5AboveMa20) scoreParts.push(20);
  if (indicators.ma20AboveMa60 || indicators.ma20AboveMa60 === null) scoreParts.push(15);
  if (Number.isFinite(indicators.rsi14) && indicators.rsi14 < 75) scoreParts.push(15);
  if (indicators.rebound) scoreParts.push(15);
  if (Number.isFinite(indicators.drawdown20) && indicators.drawdown20 > -8) scoreParts.push(10);
  const score = scoreParts.reduce((sum, value) => sum + value, 0);
  if (rules.signalMode === "reversal") {
    if (!Number.isFinite(indicators.rsi14) || indicators.rsi14 > rules.maxRsi) reasons.push("RSI未进入超卖区");
    if (!Number.isFinite(indicators.drawdown20) || indicators.drawdown20 < rules.minDrawdown || indicators.drawdown20 > rules.maxDrawdown) reasons.push("20日回撤不在策略区间");
    if (rules.requireRebound && !indicators.rebound) reasons.push("尚未形成止跌反弹");
  } else {
    if (["trend", "momentum", "low_vol", "rotation"].includes(rules.signalMode) && indicators.ma5AboveMa20 !== true) reasons.push("MA5未高于MA20");
    if (rules.requireLongTrend && indicators.ma20AboveMa60 !== true) reasons.push("MA20未高于MA60");
    if (rules.signalMode === "momentum" && Number.isFinite(indicators.rsi14) && indicators.rsi14 >= 80) reasons.push("RSI过热");
    if (rules.signalMode === "low_vol" && Number.isFinite(indicators.volatility) && indicators.volatility > 4) reasons.push("波动率过高");
  }
  if (score < rules.minScore) reasons.push(`综合评分不足（${score}/${rules.minScore}）`);
  return { pass: reasons.length === 0, score, reason: reasons[0] || "K线条件通过", indicators, omitted };
}

function runPaperHistoricalBacktest(rawPoints, rules) {
  const points = (rawPoints || []).map((point) => ({ ...point, close: Number(point.close ?? point.value), high: Number(point.high), low: Number(point.low), amount: Number(point.amount), change_pct: Number(point.change_pct) })).filter((point) => Number.isFinite(point.close));
  const omittedRules = ["量比", "换手率", "实时市场环境", "板块资金", "盘中形态", "滑点、盘口与集合竞价"];
  const evaluatedRules = ["涨跌幅", "MA5/MA20/MA60", "RSI14", "收盘价波动率", "20日回撤", "止跌反弹", "评分", "止损/止盈/移动止盈", "最大持仓天数"];
  if (rules.minAmount > 0) evaluatedRules.push("历史成交额（存在时）");
  if (points.length < 21) return {
    sampleCount: 0, winRate: null, averageReturn: null, maxLoss: null, maxDrawdown: null, totalReturn: null, samples: [],
    coverage: { historyPoints: points.length, amountCoverage: points.filter((point) => Number.isFinite(point.amount)).length, evaluatedRules, omittedRules },
    note: "历史K线不足，至少需要21根有效日K线后才能逐根回放。"
  };
  const samples = [];
  let active = null;
  let peakEquity = 1;
  let equity = 1;
  let maxDrawdown = 0;
  for (let index = 20; index < points.length; index += 1) {
    const point = points[index];
    if (active) {
      const high = Number.isFinite(point.high) ? point.high : point.close;
      const low = Number.isFinite(point.low) ? point.low : point.close;
      active.highest = Math.max(active.highest, high);
      active.holdingDays += 1;
      const stopPrice = active.entryPrice * (1 + rules.sellStop / 100);
      const takePrice = active.entryPrice * (1 + rules.takeProfit / 100);
      const trailingPrice = active.highest * (1 - rules.trailingStop / 100);
      let exitPrice = null;
      let exitReason = "";
      // 同一日同时触及止损与止盈时，按先止损的保守假设处理。
      if (low <= stopPrice) { exitPrice = stopPrice; exitReason = "固定止损"; }
      else if (high >= takePrice) { exitPrice = takePrice; exitReason = "固定止盈"; }
      else if (rules.trailingStop > 0 && active.highest > active.entryPrice && low <= trailingPrice) { exitPrice = trailingPrice; exitReason = "移动止盈"; }
      else if (rules.maxHoldingDays > 0 && active.holdingDays >= rules.maxHoldingDays) { exitPrice = point.close; exitReason = "最大持仓天数"; }
      else if (index === points.length - 1) { exitPrice = point.close; exitReason = "样本结束平仓"; }
      if (Number.isFinite(exitPrice)) {
        const returnPct = (exitPrice / active.entryPrice - 1) * 100;
        equity *= 1 + returnPct / 100;
        peakEquity = Math.max(peakEquity, equity);
        maxDrawdown = Math.min(maxDrawdown, (equity / peakEquity - 1) * 100);
        samples.push({ entryTime: active.entryTime, exitTime: point.time, entryPrice: active.entryPrice, exitPrice, returnPct: Number(returnPct.toFixed(2)), holdingDays: active.holdingDays, exitReason, signalScore: active.signalScore });
        active = null;
      }
      continue;
    }
    const signal = evaluateHistoricalPaperSignal(points, index, rules);
    if (signal.pass) active = { entryTime: point.time, entryPrice: point.close, highest: point.close, holdingDays: 0, signalScore: signal.score };
  }
  const returns = samples.map((sample) => sample.returnPct);
  const wins = returns.filter((value) => value > 0).length;
  return {
    sampleCount: samples.length,
    winRate: samples.length ? (wins / samples.length) * 100 : null,
    averageReturn: returns.length ? average(returns) : null,
    maxLoss: returns.length ? Math.min(...returns) : null,
    maxDrawdown,
    totalReturn: (equity - 1) * 100,
    samples: samples.slice(-20).reverse(),
    coverage: { historyPoints: points.length, amountCoverage: points.filter((point) => Number.isFinite(point.amount)).length, evaluatedRules, omittedRules },
    note: samples.length ? "按收盘价入场、后续日K高低价检查出场；同日止损与止盈同时触发时按止损计算。" : "未找到同时满足可重放K线条件的入场样本；不代表策略无效或未来不会触发。"
  };
}

function scoreStock(item, conditions) {
  if (!conditions.length) return 0;
  let score = 0;
  for (const condition of conditions) if (evaluateCondition(item, condition)) score += 12;
  if (Number(item.volume_ratio) >= 1.5 && Number(item.turnover_rate) >= 5) score += 12;
  if (["半导体", "光模块", "算力", "消费电子"].includes(item.sector)) score += 8;
  return Math.min(score, 100);
}

function buildResearchScore(stock, history = {}) {
  const closes = (history.points || []).map((point) => Number(point.close ?? point.value)).filter(Number.isFinite);
  const latest = closes.at(-1);
  const ma5 = average(closes.slice(-5));
  const ma20 = average(closes.slice(-20));
  const ma60 = closes.length >= 60 ? average(closes.slice(-60)) : null;
  const rsi14 = calculateRsi(closes, 14);
  const volatility = calculateVolatility(closes);
  const fiveStart = closes.at(-6);
  const fiveDayChange = Number.isFinite(latest) && Number.isFinite(fiveStart) ? (latest / fiveStart - 1) * 100 : null;
  const factors = [];
  const add = (label, weight, available, points, detail) => factors.push({ label, weight, available, points: available ? points : 0, detail });
  add("短期趋势", 25, Number.isFinite(ma5) && Number.isFinite(ma20), ma5 >= ma20 ? 25 : 0, Number.isFinite(ma5) && Number.isFinite(ma20) ? `MA5 ${formatNumber(ma5)} ${ma5 >= ma20 ? ">=" : "<"} MA20 ${formatNumber(ma20)}` : "历史样本不足，未计分");
  add("中期趋势", 15, Number.isFinite(ma20) && Number.isFinite(ma60), ma20 >= ma60 ? 15 : 0, Number.isFinite(ma20) && Number.isFinite(ma60) ? `MA20 ${formatNumber(ma20)} ${ma20 >= ma60 ? ">=" : "<"} MA60 ${formatNumber(ma60)}` : "不足60根K线，未计分");
  const rsiPoints = !Number.isFinite(rsi14) ? 0 : rsi14 >= 40 && rsi14 <= 70 ? 15 : rsi14 >= 30 && rsi14 < 80 ? 8 : 0;
  add("动能区间", 15, Number.isFinite(rsi14), rsiPoints, Number.isFinite(rsi14) ? `RSI14 ${formatNumber(rsi14)}${rsiPoints === 15 ? "，处于中性偏强区间" : "，动能需继续观察"}` : "历史样本不足，未计分");
  const changePoints = !Number.isFinite(fiveDayChange) ? 0 : fiveDayChange >= 0 && fiveDayChange <= 8 ? 10 : fiveDayChange > -5 ? 5 : 0;
  add("五日变化", 10, Number.isFinite(fiveDayChange), changePoints, Number.isFinite(fiveDayChange) ? `近五日 ${formatPercent(fiveDayChange)}` : "历史样本不足，未计分");
  const volatilityPoints = !Number.isFinite(volatility) ? 0 : volatility <= 2.5 ? 10 : volatility <= 4 ? 5 : 0;
  add("波动控制", 10, Number.isFinite(volatility), volatilityPoints, Number.isFinite(volatility) ? `日波动率 ${formatPercent(volatility)}` : "历史样本不足，未计分");
  const volumeRatio = Number(stock.volume_ratio);
  const volumePoints = !Number.isFinite(volumeRatio) ? 0 : volumeRatio >= 1.5 ? 10 : volumeRatio >= 1 ? 5 : 0;
  add("量能活跃度", 10, Number.isFinite(volumeRatio), volumePoints, Number.isFinite(volumeRatio) ? `量比 ${formatNumber(volumeRatio)}` : "量比缺失，未计分");
  const amount = Number(stock.amount);
  const amountFloor = stock.market === "ETF" ? 50_000_000 : 100_000_000;
  add("成交流动性", 10, Number.isFinite(amount) && amount > 0, Number.isFinite(amount) && amount >= amountFloor ? 10 : 0, Number.isFinite(amount) && amount > 0 ? `成交额 ${formatMoney(amount)}${amount >= amountFloor ? "，达到研究阈值" : "，低于研究阈值"}` : "成交额缺失，未计分");
  const turnover = Number(stock.turnover_rate);
  const turnoverEligible = stock.market !== "ETF";
  const turnoverPoints = turnoverEligible && Number.isFinite(turnover) && turnover >= 1 && turnover <= 15 ? 5 : 0;
  add("换手健康度", 5, turnoverEligible && Number.isFinite(turnover), turnoverPoints, !turnoverEligible ? "ETF不纳入换手评分" : Number.isFinite(turnover) ? `换手率 ${formatPercent(turnover)}` : "换手率缺失，未计分");
  const score = factors.reduce((sum, factor) => sum + factor.points, 0);
  const availableWeight = factors.filter((factor) => factor.available).reduce((sum, factor) => sum + factor.weight, 0);
  const level = closes.length < 20 ? "历史样本不足" : availableWeight < 50 ? "数据覆盖有限" : score >= 70 ? "研究评分偏强" : score >= 45 ? "研究评分中性" : "研究评分偏弱";
  return { score, level, factors, availableWeight, historyPoints: closes.length };
}

function findStockByQuery(stocks, query) {
  return findStockMatches(stocks, query, 1)[0]?.item || null;
}

function findStockMatches(stocks, query, limit = 8) {
  const text = normalizeLookupText(query);
  if (!text) return [];
  return (stocks || [])
    .map((item) => {
      const code = normalizeLookupText(item.code);
      const pureCode = code.replace(/^(sh|sz|bj|hk|us)\.?/, "").replace(/\.(sh|sz|bj)$/i, "");
      const name = normalizeLookupText(item.name);
      let rank = 0;
      if (code === text || pureCode === text) rank = 100;
      else if (name === text) rank = 95;
      else if (code.includes(text) || pureCode.includes(text)) rank = 80;
      else if (name.includes(text) || text.includes(name)) rank = 70;
      return { item, rank };
    })
    .filter((row) => row.rank > 0)
    .sort((a, b) => b.rank - a.rank || String(a.item.name || "").localeCompare(String(b.item.name || ""), "zh-CN"))
    .slice(0, limit)
    .map(({ item, rank }) => ({ item, rank }));
}

function buildStockPrediction(stock, conditions, logic, data, history = null) {
  const conditionHits = (conditions || []).map((condition) => ({
    label: describeCondition(condition),
    hit: evaluateCondition(stock, condition),
    field: condition.field,
    value: stock[condition.field] ?? null
  }));
  const hasConditions = (conditions || []).length > 0;
  const researchScore = !hasConditions && history ? buildResearchScore(stock, history) : null;
  const hitScore = researchScore ? researchScore.score : scoreStock(stock, conditions || []);
  const conditionPassed = logic === "OR" ? conditionHits.some((item) => item.hit) : conditionHits.every((item) => item.hit);
  const missingFields = ["volume_ratio", "turnover_rate", "amount", "float_market_cap", "market_cap", "amplitude"]
    .filter((field) => stock[field] === null || stock[field] === undefined || stock[field] === "" || Number(stock[field]) === 0)
    .map((field) => fieldLabel(field));
  const strengths = [];
  const risks = [];
  if (Number(stock.change_pct) > 0) strengths.push(`涨跌幅为 ${formatPercent(stock.change_pct)}，短线表现偏强`);
  if (Number(stock.volume_ratio) >= 1.5) strengths.push(`量比 ${stock.volume_ratio}，成交活跃度抬升`);
  if (Number(stock.turnover_rate) >= 5) strengths.push(`换手率 ${formatPercent(stock.turnover_rate)}，资金参与度较高`);
  if (Number(stock.amount) >= 1_000_000_000) strengths.push(`成交额 ${formatMoney(stock.amount)}，流动性较好`);
  if (Number(stock.change_pct) <= -3) risks.push(`涨跌幅 ${formatPercent(stock.change_pct)}，短线承压`);
  if (Number(stock.turnover_rate) >= 12) risks.push("换手率偏高，注意情绪波动和承接变化");
  if (missingFields.length) risks.push(`字段缺失：${missingFields.join("、")}，命中分可信度会下降`);
  if (!conditionPassed) risks.push("未完全满足当前筛选条件");
  return {
    updatedAt: data.updatedAt,
    source: data.source,
    code: stock.code,
    name: stock.name,
    sector: stock.sector,
    hit_score: hitScore,
    level: researchScore?.level || scoreLevel(hitScore, conditionPassed, missingFields.length),
    score_type: researchScore ? "研究评分" : "条件命中分",
    score_breakdown: researchScore?.factors || [],
    score_coverage: researchScore ? { availableWeight: researchScore.availableWeight, historyPoints: researchScore.historyPoints } : null,
    conditionPassed,
    logic,
    conditionHits,
    strengths: strengths.length ? strengths : ["当前数据未显示明显强势特征"],
    risks: risks.length ? risks : ["未发现明显字段风险，但数据可能延迟"],
    metrics: {
      change_pct: stock.change_pct,
      volume_ratio: stock.volume_ratio,
      turnover_rate: stock.turnover_rate,
      amount: stock.amount,
      float_market_cap: stock.float_market_cap,
      market_cap: stock.market_cap,
      price: stock.price,
      amplitude: stock.amplitude,
      update_time: stock.update_time
    },
    disclaimer: "仅供个人研究，不构成投资建议。"
  };
}

function normalizeLookupText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "").replace(/\.(sh|sz|bj)$/i, "");
}

function describeCondition(condition) {
  const label = fieldLabel(condition.field);
  const op = { ">": ">", ">=": ">=", "<": "<", "<=": "<=", "=": "=", between: "区间", contains: "包含", not_contains: "不包含" }[condition.operator] || condition.operator;
  return condition.operator === "between"
    ? `${label} ${op} ${condition.value} - ${condition.value2}`
    : `${label} ${op} ${condition.value}`;
}

function fieldLabel(field) {
  return ({
    code: "代码",
    name: "名称",
    sector: "板块",
    change_pct: "涨跌幅",
    volume_ratio: "量比",
    turnover_rate: "换手率",
    amount: "成交额",
    float_market_cap: "流通市值",
    market_cap: "总市值",
    price: "价格",
    amplitude: "振幅",
    update_time: "更新时间",
    hit_score: "命中分"
  })[field] || field;
}

function scoreLevel(score, passed, missingCount) {
  if (!passed) return "未满足当前条件";
  if (missingCount >= 3) return "数据不足";
  if (score >= 80) return "高命中";
  if (score >= 55) return "中高命中";
  if (score >= 35) return "观察";
  return "低命中";
}

function stockPoolQuality(stocks) {
  const fields = ["volume_ratio", "turnover_rate", "amount", "float_market_cap", "market_cap", "amplitude"];
  const rows = (stocks || []).slice(0, 1500);
  const detail = Object.fromEntries(fields.map((field) => {
    const present = rows.filter((item) => item[field] !== null && item[field] !== undefined && item[field] !== "" && Number(item[field]) !== 0).length;
    return [field, { present, total: rows.length, ratio: rows.length ? present / rows.length : 0 }];
  }));
  return {
    total: stocks?.length || 0,
    sourceFieldsUsable: Object.values(detail).filter((item) => item.ratio >= 0.5).length,
    detail
  };
}

function compareByField(a, b, field, direction = "desc") {
  const av = a[field];
  const bv = b[field];
  const aMissing = av === null || av === undefined || av === "";
  const bMissing = bv === null || bv === undefined || bv === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const an = Number(av);
  const bn = Number(bv);
  const result = Number.isFinite(an) && Number.isFinite(bn)
    ? an - bn
    : String(av).localeCompare(String(bv), "zh-Hans-CN");
  return direction === "asc" ? result : -result;
}

function extractTitle(markdown) {
  return markdown.split("\n").find((line) => line.startsWith("# "))?.replace(/^#\s+/, "");
}

function formatPercent(value) {
  const n = Number(value || 0);
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatNumber(value) {
  const n = Number(value || 0);
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatMoneySigned(value) {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  const text = abs >= 100000000 ? `${(abs / 100000000).toFixed(1)}亿` : `${(abs / 10000).toFixed(1)}万`;
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${text}`;
}

function hasUsableSectorInflow(item) {
  const value = Number(item?.net_inflow);
  return Number.isFinite(value) && Math.abs(value) > 0;
}

function hasUsableSectorData(item) {
  const numeric = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  return numeric(item?.change_pct)
    || (numeric(item?.net_inflow) && Math.abs(Number(item.net_inflow)) > 0)
    || (numeric(item?.amount) && Number(item.amount) > 0)
    || (numeric(item?.up_count) && Number(item.up_count) > 0)
    || (numeric(item?.down_count) && Number(item.down_count) > 0);
}

function hasUsableMarketValue(item) {
  const value = Number(item?.amount);
  return Number.isFinite(value) && value > 0;
}

function formatSectorMoneySigned(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "暂无数据";
  return `${number > 0 ? "+" : "-"}${Math.abs(number).toFixed(2)}亿元`;
}

function formatArticleMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "暂无数据";
  const abs = Math.abs(number);
  if (abs >= 100000000) return `${(abs / 100000000).toFixed(2)}亿元`;
  if (abs >= 10000) return `${(abs / 10000).toFixed(2)}万元`;
  return `${abs.toFixed(0)}元`;
}

function formatMoney(value) {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  if (abs >= 100000000) return `${(abs / 100000000).toFixed(1)}亿`;
  if (abs >= 10000) return `${(abs / 10000).toFixed(1)}万`;
  return `${n.toFixed(0)}`;
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function now() {
  return new Date().toISOString();
}
