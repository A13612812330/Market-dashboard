const windowMap = {
  today: "今日",
  five: "五日",
  day: "日",
  month: "月",
  quarter: "季",
  year: "年",
  all: "全部"
};

const fieldMeta = {
  code: { label: "代码", type: "text" },
  name: { label: "名称", type: "text" },
  sector: { label: "板块", type: "text" },
  change_pct: { label: "涨跌幅", type: "number", unit: "%" },
  volume_ratio: { label: "量比", type: "number" },
  turnover_rate: { label: "换手率", type: "number", unit: "%" },
  amount: { label: "成交额", type: "money" },
  float_market_cap: { label: "流通市值", type: "money" },
  market_cap: { label: "总市值", type: "money" },
  price: { label: "价格", type: "number" },
  amplitude: { label: "振幅", type: "number", unit: "%" },
  update_time: { label: "更新时间", type: "text" },
  hit_score: { label: "命中分", type: "number" },
  research_score: { label: "研究评分", type: "number" }
};

const templates = {
  overnight: [
    { field: "change_pct", operator: "between", value: "3", value2: "5" },
    { field: "volume_ratio", operator: ">", value: "1", value2: "" },
    { field: "turnover_rate", operator: "between", value: "5", value2: "10" },
    { field: "market_cap", operator: "between", value: "5000000000", value2: "20000000000" }
  ],
  tail: [
    { field: "change_pct", operator: ">", value: "2", value2: "" },
    { field: "volume_ratio", operator: ">", value: "1.3", value2: "" },
    { field: "amount", operator: ">", value: "3000000000", value2: "" },
    { field: "sector", operator: "contains", value: "光", value2: "" }
  ],
  turnover: [
    { field: "turnover_rate", operator: ">", value: "7", value2: "" },
    { field: "amount", operator: ">", value: "2000000000", value2: "" },
    { field: "amplitude", operator: ">", value: "4", value2: "" },
    { field: "change_pct", operator: "<", value: "6", value2: "" }
  ],
  reversal: [
    { field: "change_pct", operator: "between", value: "-5", value2: "-0.5" },
    { field: "volume_ratio", operator: ">", value: "1", value2: "" },
    { field: "turnover_rate", operator: "between", value: "2", value2: "12" },
    { field: "amount", operator: ">", value: "50000000", value2: "" }
  ],
  breakout: [
    { field: "change_pct", operator: "between", value: "1.5", value2: "6" },
    { field: "volume_ratio", operator: ">", value: "1.5", value2: "" },
    { field: "turnover_rate", operator: "between", value: "3", value2: "15" },
    { field: "amount", operator: ">", value: "100000000", value2: "" }
  ],
  flow: [
    { field: "change_pct", operator: ">", value: "0.5", value2: "" },
    { field: "volume_ratio", operator: ">", value: "1.2", value2: "" },
    { field: "amount", operator: ">", value: "300000000", value2: "" },
    { field: "turnover_rate", operator: "between", value: "2", value2: "15" }
  ],
  lowAbsorb: [
    { field: "change_pct", operator: "between", value: "-3", value2: "1" },
    { field: "volume_ratio", operator: ">", value: "0.8", value2: "" },
    { field: "turnover_rate", operator: "between", value: "1", value2: "10" },
    { field: "amount", operator: ">", value: "50000000", value2: "" }
  ]
};

const sessionDefaults = {
  preopen: { articleType: "早盘观察", modules: ["美股", "港股/海外", "商品/汇率", "风险提示"] },
  midday: { articleType: "午间快评", modules: ["A股", "板块资金", "ETF观察", "风险提示"] },
  close: { articleType: "收盘复盘", modules: ["A股", "美股", "港股/海外", "ETF观察", "板块资金", "新闻资讯", "风险提示"] }
};
const articleModules = ["美股", "A股", "港股/海外", "商品/汇率", "ETF观察", "板块资金", "新闻资讯", "风险提示"];
const regionTrendMap = {
  "A股": "000001.SH",
  "美股": "IXIC",
  "港股": "HSTECH",
  "日本": "N225",
  "韩国": "KS11"
};

const stockColumns = ["code", "name", "sector", "change_pct", "volume_ratio", "turnover_rate", "amount", "float_market_cap", "market_cap", "price", "amplitude", "update_time", "hit_score", "research_score"];
const defaultVisibleColumns = ["code", "name", "sector", "change_pct", "volume_ratio", "turnover_rate", "amount", "float_market_cap", "market_cap", "update_time", "hit_score"];

const state = {
  markets: [],
  marketsUpdatedAt: "",
  trends: [],
  todayTrends: [],
  trendSource: "趋势数据",
  selectedTrend: "",
  allStocks: [],
  etfs: [],
  selectedEtfCategory: "全部",
  etfSort: "net_inflow",
  etfSearch: "",
  etfPage: 1,
  etfPageSize: 10,
  sectorFlows: [],
  sectorSort: "change_pct",
  sectorSearch: "",
  sectorPage: 1,
  sectorPageSize: 6,
  etfSource: "数据源",
  sectorSource: "数据源",
  sectorDetails: new Map(),
  sectorCloudType: "industry",
  sectorCloudRows: [],
  sectorRankType: "industry",
  newsItems: [],
  newsMonitorRows: [],
  workflow: null,
  dataCompleteness: null,
  workflowResult: null,
  syncTimer: null,
  paperTimer: null,
  nextSyncAt: 0,
  syncBusy: false,
  assets: [],
  drafts: [],
  currentReview: null,
  currentDraftId: null,
  currentArticleAssets: { cover: null, body: [] },
  settingsConfig: null,
  historyCache: new Map(),
  dataSource: "数据源",
  selectedRegion: "全部",
  selectedWindow: "today",
  selectedWechatModules: new Set(sessionDefaults.close.modules),
  marketSort: "change_pct",
  indexSearch: "",
  conditions: structuredClone(templates.overnight),
  logic: "AND",
  stockSort: { field: "hit_score", direction: "desc" },
  screenerResearchScoring: false,
  stocks: [],
  watchlist: [],
  watchlistGroups: ["默认组"],
  selectedWatchlistGroup: "全部",
  watchlistGroupModalMode: "create",
  prediction: null,
  research: null,
  selectedWatchlistCode: "",
  watchlistHistory: null,
  paper: null,
  paperAuto: null,
  paperPortfolioOverview: null,
  paperStrategies: [],
  paperStrategyId: "trend",
  access: { local: true, lanReadonly: false },
  auth: null,
  adminOverview: null,
  adminUserPage: 1,
  adminAccountSearch: "",
  adminAccountUser: "",
  adminAccountSort: { field: "updated_at", direction: "desc" },
  adminDetailPages: { positions: 1, orders: 1 },
  paperAccountId: null,
  paperOrderPage: 1,
  paperEquityWindow: "today",
  paperConditions: [],
  paperUsesPreviousDailyBar: false,
  visibleColumns: new Set(defaultVisibleColumns)
  ,chartMode: "auto"
  ,activeIndicator: "ma"
};

document.addEventListener("DOMContentLoaded", async () => {
  mergeMarketWorkspaceIntoHome();
  const authenticated = await loadAuth();
  if (!authenticated) {
    bindLoginForm();
    return;
  }
  await loadAccessMode();
  bindNavigation();
  bindHomeControls();
  bindScreenerControls();
  bindResearchControls();
  bindPaperControls();
  bindModalControls();
  bindSettingsControls();
  bindWatchlistControls();
  bindAdminControls();
  renderAuthState();
  renderColumnToggles();
  renderConditionLists();
  renderModulePicker();
  renderWechatModulePicker();
  await refreshAll();
  if (state.auth?.role === "admin") await loadAdminOverview();
  const viewFromHash = window.location.hash.replace(/^#/, "");
  if (viewFromHash && document.querySelector(`#${viewFromHash}`)?.classList.contains("view")) showView(viewFromHash);
  startAutoSync();
});

function mergeMarketWorkspaceIntoHome() {
  const home = document.querySelector("#home");
  const workspace = document.querySelector("#market-full");
  if (!home || !workspace) return;
  workspace.classList.add("home-market-section");
  home.appendChild(workspace);
}

async function loadAuth() {
  try {
    const data = await fetchJson("/api/auth/me");
    if (!data.authenticated) return false;
    state.auth = data.user;
    document.body.classList.add("authenticated");
    return true;
  } catch {
    return false;
  }
}

function bindLoginForm() {
  const form = document.querySelector("#loginForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.querySelector("#loginError");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    if (error) error.textContent = "";
    try {
      await postJson("/api/auth/login", { username: document.querySelector("#loginUsername").value.trim(), password: document.querySelector("#loginPassword").value });
      window.location.reload();
    } catch (loginError) {
      if (error) error.textContent = loginError.message || "登录失败";
    } finally {
      button.disabled = false;
    }
  });
}

function renderAuthState() {
  const user = document.querySelector("#authUser");
  const adminNav = document.querySelector("#adminNav");
  if (user) user.textContent = state.auth ? `${state.auth.username}${state.auth.role === "admin" ? " · 管理员" : ""}` : "";
  if (adminNav) adminNav.hidden = state.auth?.role !== "admin";
  document.querySelector("#logoutButton")?.addEventListener("click", async () => {
    await postJson("/api/auth/logout", {});
    window.location.reload();
  });
}

async function loadAccessMode() {
  try {
    state.access = await fetchJson("/api/access");
    const isAdmin = state.auth?.role === "admin";
    if (!state.access.local && state.access.lanReadonly && !state.access.guestPaper && !isAdmin) {
      document.querySelector('[data-view="paper"]')?.remove();
      document.querySelector("#paper")?.classList.add("legacy-removed");
      const banner = document.querySelector("#lanReadonlyBanner");
      if (banner) banner.hidden = false;
    } else if (!state.access.local && state.access.guestPaper && !isAdmin) {
      document.querySelector('[data-view="settings"]')?.remove();
      document.querySelector("#settings")?.classList.add("legacy-removed");
      const strategySelect = document.querySelector("#paperStrategySelect");
      if (strategySelect) {
        [...strategySelect.options].forEach((option) => { if (option.value !== "custom") option.remove(); });
        strategySelect.value = "custom";
      }
      const accountName = document.querySelector("#paperAccountName");
    }
  } catch {
    state.access = { local: true, lanReadonly: false };
  }
}

async function refreshAll() {
  await Promise.all([loadMarkets(), loadTrends(), loadStockPool(), loadEtfs(), loadSectorFlows(), loadSectorCloud(), loadWatchlist(), runScreener(), loadPrivateSignal(), loadSettings(), loadDataCompleteness()]);
  if (state.access.local || !state.access.lanReadonly || state.access.guestPaper || state.auth?.role === "admin") {
    await loadPaperAccounts();
    await loadPaperStatus();
  }
}

async function loadDataCompleteness() {
  const data = await fetchJson("/api/data/completeness");
  state.dataCompleteness = data;
  renderDataCompleteness(data);
  renderFullMarketSummary(selectedIndexes());
}

async function loadWatchlist() {
  try {
    const data = await fetchJson("/api/watchlist");
    state.watchlist = data.items || [];
    state.watchlistGroups = [...new Set(["默认组", ...(data.groups || []), ...state.watchlist.map((item) => item.group_name).filter(Boolean)])];
    if (state.selectedWatchlistGroup !== "全部" && !state.watchlistGroups.includes(state.selectedWatchlistGroup)) state.selectedWatchlistGroup = "全部";
    syncWatchlistButtons();
    renderWatchlist();
  } catch {
    state.watchlist = [];
  }
}

function watchlistQuoteItem(item) {
  return [...state.allStocks, ...state.etfs].find((row) => String(row.code) === String(item.code)) || item;
}

function renderWatchlist() {
  const host = document.querySelector("#watchlistRows");
  if (!host) return;
  const groupHost = document.querySelector("#watchlistGroups");
  if (groupHost) {
    groupHost.innerHTML = ["全部", ...state.watchlistGroups].map((group) => `<button type="button" class="watchlist-group-tab ${state.selectedWatchlistGroup === group ? "active" : ""}" data-watch-group="${escapeHtml(group)}">${escapeHtml(group)}<small>${group === "全部" ? state.watchlist.length : state.watchlist.filter((item) => (item.group_name || "默认组") === group).length}</small></button>`).join("");
    groupHost.querySelectorAll("[data-watch-group]").forEach((button) => button.addEventListener("click", () => {
      state.selectedWatchlistGroup = button.dataset.watchGroup || "全部";
      renderWatchlist();
    }));
  }
  const query = String(document.querySelector("#watchlistSearch")?.value || "").trim().toLowerCase();
  const rows = state.watchlist.filter((item) => (state.selectedWatchlistGroup === "全部" || (item.group_name || "默认组") === state.selectedWatchlistGroup) && (!query || `${item.code} ${item.name}`.toLowerCase().includes(query)));
  const meta = document.querySelector("#watchlistMeta");
  if (meta) meta.textContent = `${rows.length} 个标的 · ${state.selectedWatchlistGroup} · 实时行情与真实历史 K 线`;
  host.innerHTML = rows.length ? rows.map((saved) => {
    const quote = watchlistQuoteItem(saved); const change = Number(quote.change_pct);
    const options = state.watchlistGroups.map((group) => `<option value="${escapeHtml(group)}" ${(saved.group_name || "默认组") === group ? "selected" : ""}>${escapeHtml(group)}</option>`).join("");
    return `<div class="watchlist-row ${String(saved.code) === state.selectedWatchlistCode ? "active" : ""}" data-watch-code="${escapeHtml(saved.code)}"><button type="button" class="watchlist-row-main watchlist-row-open" data-watch-open="${escapeHtml(saved.code)}"><strong>${escapeHtml(quote.name || saved.name || "暂无名称")}</strong><small>${displayCode(saved.code)} · ${escapeHtml(saved.market || quote.market || "A股")}</small></button><button type="button" class="watchlist-row-price watchlist-row-open" data-watch-open="${escapeHtml(saved.code)}"><b>${formatPrice(quote.price)}</b><em class="${change >= 0 ? "paper-up" : "paper-down"}">${formatPercent(quote.change_pct)}</em></button><button type="button" class="watchlist-row-extra watchlist-row-open" data-watch-open="${escapeHtml(saved.code)}"><small>成交额</small><b>${formatMoney(quote.amount)}</b></button><div class="watchlist-row-actions"><select class="watchlist-row-move" data-watch-move="${escapeHtml(saved.code)}" aria-label="移动自选分组">${options}</select><button type="button" class="watchlist-row-delete" data-watch-delete="${escapeHtml(saved.code)}">删除</button></div></div>`;
  }).join("") : `<div class="empty-state">暂无自选标的。可在行情、筛选器或研究结果中点击“加入自选”。</div>`;
  host.querySelectorAll("[data-watch-open]").forEach((button) => button.addEventListener("click", () => loadWatchlistDetail(button.dataset.watchOpen)));
  host.querySelectorAll("[data-watch-delete]").forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const code = button.dataset.watchDelete;
    if (!window.confirm(`确定移除 ${displayCode(code)} 吗？`)) return;
    button.disabled = true;
    try {
      await requestJson(`/api/watchlist/${encodeURIComponent(code)}`, "DELETE");
      state.watchlist = state.watchlist.filter((item) => String(item.code) !== String(code));
      state.watchlistGroups = [...new Set(["默认组", ...state.watchlist.map((item) => item.group_name || "默认组")])];
      if (state.selectedWatchlistCode === String(code)) {
        state.selectedWatchlistCode = "";
        document.querySelector("#watchlistQuote").textContent = "点击左侧自选标的查看行情。";
        document.querySelector("#watchlistOpenResearch").disabled = true;
      }
      showToast("已移除自选"); renderWatchlist(); syncWatchlistButtons();
    } catch (error) { showToast(error.message || "移除失败"); } finally { button.disabled = false; }
  }));
  host.querySelectorAll("[data-watch-move]").forEach((select) => select.addEventListener("change", async () => {
    try {
      const result = await requestJson(`/api/watchlist/${encodeURIComponent(select.dataset.watchMove)}/group`, "PUT", { groupName: select.value });
      const item = state.watchlist.find((row) => String(row.code) === String(select.dataset.watchMove));
      if (item) item.group_name = result.item.group_name;
      showToast("已移动分组"); renderWatchlist();
    } catch (error) { showToast(error.message || "移动失败"); }
  }));
}

async function loadWatchlistDetail(code, { preserveResearch = false, refreshResearch = false } = {}) {
  const saved = state.watchlist.find((item) => String(item.code) === String(code)); if (!saved) return;
  state.selectedWatchlistCode = String(code); renderWatchlist();
  const quote = watchlistQuoteItem(saved); const title = document.querySelector("#watchlistDetailTitle"); const meta = document.querySelector("#watchlistDetailMeta");
  if (title) title.textContent = quote.name || saved.name || displayCode(code);
  if (meta) meta.textContent = `${displayCode(code)} · ${saved.market || quote.market || "A股"}`;
  const researchButton = document.querySelector("#watchlistOpenResearch");
  if (researchButton) { researchButton.disabled = false; researchButton.dataset.researchCode = String(code); }
  const researchHost = document.querySelector("#watchlistResearchResult");
  if (researchHost && !preserveResearch) {
    researchHost.hidden = true;
    researchHost.className = "watchlist-research-result empty-state";
    researchHost.textContent = "选择标的后可在此加载完整研究。";
    state.watchlistResearch = null;
  }
  const quoteHost = document.querySelector("#watchlistQuote");
  if (quoteHost) quoteHost.innerHTML = `<div class="watchlist-quote-grid"><div><span>现价</span><strong>${formatPrice(quote.price)}</strong></div><div><span>涨跌幅</span><strong class="${Number(quote.change_pct) >= 0 ? "paper-up" : "paper-down"}">${formatPercent(quote.change_pct)}</strong></div><div><span>成交额</span><strong>${formatMoney(quote.amount)}</strong></div><div><span>量比</span><strong>${formatNullable(quote.volume_ratio)}</strong></div><div><span>换手率</span><strong>${formatPercent(quote.turnover_rate)}</strong></div><div><span>来源</span><strong>${escapeHtml(quote.source_name || quote.source || saved.source || "真实行情")}</strong></div></div>`;
  const window = document.querySelector("#watchlistWindow")?.value || "month"; const svg = document.querySelector("#watchlistChart");
  if (svg) svg.innerHTML = `<text x="430" y="180" text-anchor="middle">正在读取${windowMap[window]}真实历史 K 线...</text>`;
  try {
    const type = state.etfs.some((item) => String(item.code) === String(code)) ? "etf" : "stock";
    const data = await fetchJson(`/api/history?type=${type}&code=${encodeURIComponent(code)}&window=${window}`);
    state.watchlistHistory = data; renderWatchlistChart(data, quote);
    if (meta) meta.textContent = `${displayCode(code)} · ${windowMap[window]} · ${data.points?.length || 0} 个历史点 · ${data.source || "历史行情"}`;
  } catch { if (svg) svg.innerHTML = `<g class="empty-chart"><rect x="1" y="1" width="858" height="358" rx="8"/><text x="430" y="180" text-anchor="middle">暂无该标的历史 K 线</text></g>`; }
  if (refreshResearch && state.watchlistResearch && String(displayCode(state.watchlistResearch.code || "")) === String(displayCode(code))) {
    await loadWatchlistResearch(code, { scroll: false, quiet: true });
  }
}

function renderWatchlistChart(data = {}) {
  const svg = document.querySelector("#watchlistChart"); const points = (data.points || []).map((point) => ({ ...point, open: Number(point.open), high: Number(point.high), low: Number(point.low), close: Number(point.close ?? point.value), volume: Number(point.volume) })).filter((point) => Number.isFinite(point.close));
  if (!svg || points.length < 2) { if (svg) svg.innerHTML = `<g class="empty-chart"><rect x="1" y="1" width="858" height="358" rx="8"/><text x="430" y="180" text-anchor="middle">暂无足够历史 K 线</text></g>`; return; }
  const width = 860; const height = 360; const left = 56; const right = 70; const top = 28; const bottom = 272; const volumeTop = 290; const volumeHeight = 42; const highs = points.map((p) => Number.isFinite(p.high) ? p.high : p.close); const lows = points.map((p) => Number.isFinite(p.low) ? p.low : p.close); const min = Math.min(...lows); const max = Math.max(...highs); const range = max - min || 1; const x = (i) => left + i / Math.max(points.length - 1, 1) * (width - left - right); const y = (v) => top + (max - v) / range * (bottom - top); const maxVol = Math.max(...points.map((p) => p.volume || 0), 1); const candleWidth = Math.max(2, Math.min(12, (width - left - right) / points.length * .62));
  const candles = points.map((p, i) => { const open = Number.isFinite(p.open) ? p.open : p.close; const close = p.close; const high = Number.isFinite(p.high) ? p.high : Math.max(open, close); const low = Number.isFinite(p.low) ? p.low : Math.min(open, close); const up = close >= open; const cx = x(i); const bodyY = y(Math.max(open, close)); const bodyH = Math.max(1, Math.abs(y(open) - y(close))); const vh = (p.volume || 0) / maxVol * volumeHeight; return `<g class="watch-candle ${up ? "up" : "down"}"><line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(high).toFixed(1)}" y2="${y(low).toFixed(1)}"/><rect x="${(cx - candleWidth / 2).toFixed(1)}" y="${bodyY.toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${bodyH.toFixed(1)}"/><rect class="watch-volume" x="${(cx - candleWidth / 2).toFixed(1)}" y="${(volumeTop + volumeHeight - vh).toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${vh.toFixed(1)}"/></g>`; }).join("");
  const labels = [points[0], points[Math.floor(points.length / 2)], points.at(-1)].map((p, i) => `<text x="${[left, width / 2, width - right][i]}" y="${height - 15}" text-anchor="middle">${escapeHtml(String(p.time || "").slice(0, 16))}</text>`).join("");
  svg.innerHTML = `<g class="watch-kline"><rect class="chart-board" x=".5" y=".5" width="859" height="359" rx="8"/><line class="watch-grid" x1="${left}" x2="${width - right}" y1="${bottom}" y2="${bottom}"/><line class="watch-grid" x1="${left}" x2="${width - right}" y1="${volumeTop}" y2="${volumeTop}"/>${candles}<g class="watch-axis"><text x="${width - right + 8}" y="${top + 4}">${formatPrice(max)}</text><text x="${width - right + 8}" y="${bottom}">${formatPrice(min)}</text><text x="${left}" y="${volumeTop - 7}">成交量</text>${labels}</g></g>`;
}

async function loadWatchlistResearch(code, { scroll = true, quiet = false } = {}) {
  const button = document.querySelector("#watchlistOpenResearch");
  const host = document.querySelector("#watchlistResearchResult");
  if (!code || !host) return;
  if (button) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = "抓取中...";
  }
  host.hidden = false;
  host.className = "watchlist-research-result empty-state";
  host.textContent = "正在读取实时行情、历史 K 线和研究指标...";
  try {
    const data = await postJson("/api/research/stock", {
      query: code,
      window: document.querySelector("#watchlistWindow")?.value || "month"
    });
    if (!data.ok) throw new Error(data.message || "研究标的未找到");
    if (String(displayCode(data.research?.code || "")) !== String(displayCode(state.selectedWatchlistCode || ""))) {
      host.className = "watchlist-research-result empty-state";
      host.textContent = "当前已切换标的，未展示上一标的研究结果。";
      return;
    }
    state.watchlistResearch = data.research;
    renderStockResearch(data.research, "#watchlistResearchResult");
    if (scroll) host.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (!quiet) showToast("完整研究已加载到当前页面");
  } catch (error) {
    host.className = "watchlist-research-result empty-state";
    host.textContent = error.message || "研究请求失败，请稍后重试。";
    if (!quiet) showToast(error.message || "研究请求失败");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.originalText || "加载完整研究";
    }
  }
}

function isInWatchlist(code) {
  return state.watchlist.some((item) => String(item.code) === String(code));
}

function watchlistButton(item = {}) {
  const code = String(item.code || "");
  if (!code) return "";
  const active = isInWatchlist(code);
  return `<button type="button" class="watchlist-button ${active ? "active" : ""}" data-watchlist-code="${escapeHtml(code)}" data-watchlist-name="${escapeHtml(item.name || code)}" data-watchlist-market="${escapeHtml(item.market || "A股")}" data-watchlist-source="${escapeHtml(item.source || item.source_name || "行情模块")}" aria-pressed="${active}">${active ? "已自选" : "加入自选"}</button>`;
}

function syncWatchlistButtons() {
  document.querySelectorAll(".watchlist-button").forEach((button) => {
    const active = isInWatchlist(button.dataset.watchlistCode);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.textContent = active ? "已自选" : "加入自选";
  });
}

function bindWatchlistControls() {
  document.querySelector("#watchlistSearch")?.addEventListener("input", renderWatchlist);
  document.querySelector("#watchlistWindow")?.addEventListener("change", () => {
    if (state.selectedWatchlistCode) loadWatchlistDetail(state.selectedWatchlistCode, { preserveResearch: true, refreshResearch: true });
  });
  const groupModal = document.querySelector("#watchlistGroupModal");
  const groupModalTitle = document.querySelector("#watchlistGroupModalTitle");
  const groupNameInput = document.querySelector("#watchlistGroupName");
  const closeGroupModal = () => { groupModal?.classList.remove("show"); groupModal?.setAttribute("aria-hidden", "true"); };
  const openGroupModal = (mode) => {
    state.watchlistGroupModalMode = mode;
    if (groupModalTitle) groupModalTitle.textContent = mode === "rename" ? "编辑自选分组" : "新建自选分组";
    if (groupNameInput) { groupNameInput.value = mode === "rename" ? state.selectedWatchlistGroup : ""; groupNameInput.focus(); }
    groupModal?.classList.add("show"); groupModal?.setAttribute("aria-hidden", "false");
  };
  document.querySelector("#watchlistAddGroup")?.addEventListener("click", () => openGroupModal("create"));
  document.querySelector("#watchlistRenameGroup")?.addEventListener("click", () => {
    if (state.selectedWatchlistGroup === "全部") return showToast("请先选择要编辑的分组");
    openGroupModal("rename");
  });
  document.querySelector("#closeWatchlistGroupModal")?.addEventListener("click", closeGroupModal);
  document.querySelector("#cancelWatchlistGroup")?.addEventListener("click", closeGroupModal);
  groupModal?.addEventListener("click", (event) => { if (event.target === groupModal) closeGroupModal(); });
  document.querySelector("#watchlistGroupForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = groupNameInput?.value.trim().slice(0, 24);
    if (!name) return showToast("请输入分组名称");
    try {
      if (state.watchlistGroupModalMode === "rename") {
        if (name === state.selectedWatchlistGroup) return closeGroupModal();
        const result = await requestJson("/api/watchlist/group", "PUT", { oldName: state.selectedWatchlistGroup, newName: name });
        state.watchlist.forEach((item) => { if ((item.group_name || "默认组") === state.selectedWatchlistGroup) item.group_name = result.newName; });
        state.watchlistGroups = state.watchlistGroups.map((group) => group === state.selectedWatchlistGroup ? result.newName : group);
        state.selectedWatchlistGroup = result.newName;
        showToast("分组名称已更新");
      } else {
        if (state.watchlistGroups.includes(name)) return showToast("该分组已存在");
        await postJson("/api/watchlist/group", { groupName: name });
        state.watchlistGroups = [...state.watchlistGroups, name];
        state.selectedWatchlistGroup = name;
        showToast("分组已创建，可将自选移动到此分组");
      }
      closeGroupModal(); renderWatchlist();
    } catch (error) { showToast(error.message || "分组保存失败"); }
  });
  document.querySelector("#watchlistOpenResearch")?.addEventListener("click", async (event) => {
    const code = document.querySelector("#watchlistOpenResearch")?.dataset.researchCode;
    if (!code) return;
    await loadWatchlistResearch(code);
  });
  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".watchlist-button");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const code = button.dataset.watchlistCode;
    button.disabled = true;
    try {
      if (isInWatchlist(code)) {
        await requestJson(`/api/watchlist/${encodeURIComponent(code)}`, "DELETE");
        state.watchlist = state.watchlist.filter((item) => String(item.code) !== String(code));
        showToast("已移除自选");
      } else {
        const result = await postJson("/api/watchlist", { code, name: button.dataset.watchlistName, market: button.dataset.watchlistMarket, source: button.dataset.watchlistSource, groupName: state.selectedWatchlistGroup === "全部" ? "默认组" : state.selectedWatchlistGroup });
        state.watchlist = [result.item, ...state.watchlist.filter((item) => String(item.code) !== String(code))];
        showToast("已加入自选");
      }
      syncWatchlistButtons();
      renderWatchlist();
    } catch (error) {
      showToast(error.message || "自选操作失败");
    } finally {
      button.disabled = false;
    }
  }, true);
}

async function loadPaperStatus({ syncConfig = true } = {}) {
  try {
    const query = state.paperAccountId ? `?accountId=${encodeURIComponent(state.paperAccountId)}` : "";
    state.paper = await fetchJson(`/api/paper/status${query}`);
    renderPaperStatus(state.paper);
    await loadPaperAutoConfig(syncConfig);
  } catch {
    state.paper = { configured: false, message: "模拟账户状态读取失败" };
    renderPaperStatus(state.paper);
  }
}

async function loadPaperAutoConfig(syncForm = true) {
  try {
    const query = state.paperAccountId ? `?accountId=${encodeURIComponent(state.paperAccountId)}` : "";
    state.paperAuto = await fetchJson(`/api/paper/auto-config${query}`);
    const config = state.paperAuto.config || {};
    if (!syncForm) {
      renderPaperAutoStatus(state.paperAuto);
      return;
    }
    const set = (selector, value) => { const input = document.querySelector(selector); if (input && value !== undefined) input.value = value; };
    const hours = document.querySelector("#paperMarketHoursOnly");
    if (hours) hours.checked = config.marketHoursOnly !== false;
    set("#paperAutoInterval", config.intervalSeconds || 180);
    set("#paperMaxActions", config.maxActionsPerDay || 10);
    set("#paperMaxBuys", config.maxBuysPerDay || 10);
    set("#paperMaxSells", config.maxSellsPerDay || 10);
    set("#paperMaxLoss", config.maxDailyLossPct || 3);
    state.paperStrategyId = config.strategyId || config.strategy || "trend";
    renderPaperStrategySelect(state.paperStrategyId);
    set("#paperCustomLogic", config.logic || "AND");
    set("#paperCustomMarket", config.market || "all");
    state.paperConditions = structuredClone(config.conditions || []);
    applyPaperStrategyEditor(findPaperStrategy(state.paperStrategyId), config.rules || {});
    const watchlist = document.querySelector("#paperWatchlist");
    if (watchlist && Array.isArray(config.watchlist)) watchlist.value = config.watchlist.join(", ");
    renderPaperWatchlistChips();
    syncPaperCustomVisibility();
    renderPaperStrategyHelp();
    renderPaperCustomSummary();
    renderPaperAutoStatus(state.paperAuto);
    await loadPaperPortfolioOverview();
  } catch {
    renderPaperAutoStatus({ config: { enabled: false }, runtime: { lastMessage: "自动规则状态读取失败" } });
  }
}

async function loadPaperPortfolioOverview() {
  const host = document.querySelector("#paperPortfolioOverview");
  if (!host) return;
  try {
    state.paperPortfolioOverview = await fetchJson("/api/paper/portfolio-overview");
    renderPaperPortfolioOverview(state.paperPortfolioOverview);
  } catch {
    host.hidden = true;
  }
}

function renderPaperPortfolioOverview(data = {}) {
  const host = document.querySelector("#paperPortfolioOverview");
  if (!host) return;
  const duplicates = data.duplicatedCodes || [];
  const themes = data.concentratedThemes || [];
  host.hidden = false;
  host.innerHTML = `<div class="paper-portfolio-head"><div><strong>组合总览</strong><span>${Number(data.accountCount || 0)} 个模拟账户 · 合计资产 ${formatPaperMoney(data.totalEquity)}</span></div><span>现金 ${formatPaperMoney(data.cash)} · 持仓 ${formatPaperMoney(data.marketValue)}</span></div><div class="paper-portfolio-groups"><div><b>重复代码</b>${duplicates.length ? duplicates.map((item) => `<span>${escapeHtml(item.name)} <em>${item.count} 个账户</em></span>`).join("") : "<small>暂无跨账户重复持仓</small>"}</div><div><b>主题集中</b>${themes.length ? themes.map((item) => `<span>${escapeHtml(item.theme)} <em>${item.count} 个持仓</em></span>`).join("") : "<small>暂无超过 2 个持仓的主题</small>"}</div></div>`;
}

function renderPaperAutoStatus(data = {}) {
  const status = document.querySelector("#paperAutoStatus");
  const meta = document.querySelector("#paperAutoMeta");
  const strategy = document.querySelector("#paperAutoStrategy");
  const toggle = document.querySelector("#togglePaperAuto");
  if (!status || !meta) return;
  const config = data.config || {};
  const runtime = data.runtime || {};
  const strategyNames = { trend: "趋势跟随 v2", short: "短线动量 v2", long: "长线趋势 v2", conservative: "保守低波 v2", momentum: "强势动量 v2", etf: "ETF轮动 v2", custom: "自定义策略" };
  const savedStrategy = findPaperStrategy(config.strategyId || config.strategy);
  if (strategy) strategy.textContent = savedStrategy?.name || strategyNames[config.strategy] || config.strategy || "策略未设置";
  if (toggle) {
    toggle.textContent = config.enabled ? "关闭自动模拟" : "开启自动模拟";
    toggle.classList.toggle("danger-button", Boolean(config.enabled));
  }
  const paused = /达到今日最多|触发单日亏损|真实 A股\/ETF 数据不可用/.test(String(runtime.lastMessage || ""));
  status.textContent = config.enabled ? (runtime.running ? "运行中" : (paused ? "已暂停" : "等待下一轮")) : "已关闭";
  status.className = `status-pill ${config.enabled ? "status-live" : ""}`;
  const session = runtime.sessionLabel || (data.tradingTime ? "交易时段" : "非交易时段");
  const next = runtime.nextRunAt ? ` · 下次扫描 ${formatDateTime(runtime.nextRunAt)}` : "";
  const maxSingle = Number.isFinite(Number(config.rules?.maxPositionExposure)) ? ` · 单票上限 ${Math.round(Number(config.rules.maxPositionExposure) * 100)}%` : "";
  const maxPositions = Number.isFinite(Number(config.rules?.maxPositions)) ? ` · 最多 ${Number(config.rules.maxPositions)} 个持仓` : "";
  meta.textContent = `${session} · ${config.marketHoursOnly !== false ? "09:30-11:30 / 13:00-15:00" : "未限制时段"} · 每 ${Math.max(1, Math.round(Number(config.intervalSeconds || 180) / 60))} 分钟扫描${maxPositions}${maxSingle} · ${runtime.lastMessage || (config.enabled ? "等待自动扫描" : "自动模拟默认关闭")}${next} · 无触发时不交易`;
  renderPaperAutoDecision(runtime);
}

const paperRiskProfiles = {
  steady: { label: "稳健", hint: "仓位较低，优先减少频繁操作。", perPosition: 12, maxExposure: 55, maxPositions: 4, sellStop: -4.5, trailingStop: 3, maxActions: 6, maxBuys: 4, maxSells: 6, maxLoss: 3 },
  balanced: { label: "平衡", hint: "在趋势确认后参与，兼顾机会和回撤。", perPosition: 18, maxExposure: 75, maxPositions: 5, sellStop: -6, trailingStop: 4, maxActions: 12, maxBuys: 8, maxSells: 10, maxLoss: 5 },
  active: { label: "主动", hint: "仓位与响应更积极，适合本地模拟观察。", perPosition: 20, maxExposure: 90, maxPositions: 5, sellStop: -8, trailingStop: 5, maxActions: 16, maxBuys: 10, maxSells: 10, maxLoss: 7 }
};

function paperRiskProfileFor(rules = {}) {
  const exposure = Number(rules.maxExposure || 0) * 100;
  if (exposure >= 85) return "active";
  if (exposure <= 65) return "steady";
  return "balanced";
}

function renderPaperRiskProfile(rules = {}) {
  const active = paperRiskProfileFor(rules);
  document.querySelectorAll("[data-paper-risk-profile]").forEach((button) => {
    const selected = button.dataset.paperRiskProfile === active;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const hint = document.querySelector("#paperRiskProfileHint");
  if (hint) hint.textContent = `当前：${paperRiskProfiles[active].label}。${paperRiskProfiles[active].hint}`;
}

function applyPaperRiskProfile(profile) {
  const selected = paperRiskProfiles[profile];
  if (!selected) return;
  const set = (selector, value) => { const input = document.querySelector(selector); if (input) input.value = value; };
  set("#paperRulePerPosition", selected.perPosition);
  set("#paperRuleMaxExposure", selected.maxExposure);
  set("#paperRuleMaxPositions", selected.maxPositions);
  set("#paperRuleSellStop", selected.sellStop);
  set("#paperRuleTrailingStop", selected.trailingStop);
  set("#paperMaxActions", selected.maxActions);
  set("#paperMaxBuys", selected.maxBuys);
  set("#paperMaxSells", selected.maxSells);
  set("#paperMaxLoss", selected.maxLoss);
  renderPaperRiskProfile({ maxExposure: selected.maxExposure / 100 });
  showToast(`已切换为${selected.label}档，点击“保存规则”后生效`);
}

function renderPaperStrategySummary() {
  const host = document.querySelector("#paperStrategySummary");
  if (!host) return;
  const key = document.querySelector("#paperStrategySelect")?.value || "trend";
  const customCount = state.paperConditions.length;
  const summaries = {
    trend: ["跟着趋势做", "系统只在短期趋势向上、成交活跃且大盘环境不过弱时才进入候选。"],
    short: ["短线强势", "优先观察放量、活跃且趋势未走坏的股票或 ETF，持有时间较短。"],
    long: ["中长线趋势", "优先等待中期均线走强，信号少但更强调趋势完整性。"],
    conservative: ["低波动观察", "尽量回避波动太大的标的，以稳定和少操作为主。"],
    momentum: ["强势动量", "关注活跃上涨标的，但会避开过热和流动性不足的情况。"],
    etf: ["ETF轮动", "只在 ETF 中比较相对强弱、成交活跃度和市场环境。"],
    reversal: ["低位反弹观察", "先确认回撤、止跌和反弹，再进入候选，不追逐急涨。"],
    etf_reversal: ["ETF低位修复", "只看回撤后的 ETF，等待止跌改善后再观察。"],
    custom: ["按我的条件", customCount ? `已加载 ${customCount} 条筛选条件；系统只会在满足条件的范围内选择。` : "请先载入自选或添加条件，避免策略没有筛选范围。"]
  };
  const [title, text] = summaries[key] || summaries.trend;
  const previous = state.paperUsesPreviousDailyBar ? "趋势判断使用截至昨日的完整日 K。" : "趋势判断使用当前可用的真实历史日 K。";
  host.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span><small>${escapeHtml(previous)}</small>`;
}

function renderPaperAutoDecision(runtime = {}) {
  const host = document.querySelector("#paperAutoDecision");
  if (!host) return;
  const rows = runtime.lastDecisionRows || [];
  const rejected = rows.filter((row) => !row.passed);
  const reasons = [...new Set(rejected.map((row) => row.reason || "未通过"))].map((reason) => ({ reason, count: rejected.filter((row) => (row.reason || "未通过") === reason).length })).sort((a, b) => b.count - a.count).slice(0, 5);
  const actionCount = Number(runtime.lastActions || 0);
  const pipeline = Number(runtime.candidateCount) ? `粗筛 ${runtime.candidateCount} → 实时核验 ${runtime.quoteCount || 0}` : "";
  const feeds = runtime.dataHealth?.feeds || [];
  const health = feeds.length ? `<div class="paper-auto-data-health">${feeds.map((item) => {
    const label = item.status === "fresh" ? "可用" : (item.status === "fallback" ? "已回退" : "过期");
    const age = Number.isFinite(Number(item.ageMinutes)) ? `${item.ageMinutes} 分钟前` : "暂无时间";
    return `<span class="${escapeHtml(item.status || "stale")}" title="${escapeHtml(item.source || "暂无来源")} · ${escapeHtml(age)}"><b>${escapeHtml(item.label || item.key)}</b>${label} · ${escapeHtml(age)}</span>`;
  }).join("")}</div>` : "";
  const scan = pipeline || (rows.length ? `候选 ${rows.length} · 操作 ${actionCount}` : (runtime.lastMessage || "等待自动扫描"));
  host.innerHTML = `<div class="paper-auto-decision-head"><div><strong>本轮决策</strong><span>${escapeHtml(runtime.sessionLabel || "等待时段")} · ${runtime.lastRunAt ? `上次 ${formatDateTime(runtime.lastRunAt)}` : "尚未扫描"}${runtime.nextRunAt ? ` · 下次 ${formatDateTime(runtime.nextRunAt)}` : ""}</span></div><span>${escapeHtml(scan)}</span></div>${health}${reasons.length ? `<div class="paper-auto-reasons">${reasons.map((item) => `<span><b>${item.count}</b>${escapeHtml(item.reason)}</span>`).join("")}</div>` : `<small class="paper-auto-decision-empty">${escapeHtml(runtime.dataHealth?.summary || runtime.lastMessage || "无候选时保持原持仓，不会为了交易而交易")}</small>`}`;
}

function paperWatchlistValues() {
  return [...new Set((document.querySelector("#paperWatchlist")?.value || "").split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean))];
}

function renderPaperWatchlistChips() {
  const host = document.querySelector("#paperWatchlistChips");
  if (!host) return;
  const values = paperWatchlistValues();
  if (!values.length) {
    host.innerHTML = `<span class="paper-watchlist-empty">未限制交易范围，将按策略市场扫描；也可以载入行情自选。</span>`;
    return;
  }
  host.innerHTML = values.map((value) => {
    const saved = state.watchlist.find((item) => String(item.code) === value || String(item.name) === value);
    const label = saved?.name ? `${saved.name} ${displayCode(saved.code)}` : value;
    return `<button type="button" data-paper-watch-remove="${escapeHtml(value)}" title="从交易范围移除">${escapeHtml(label)}<b>×</b></button>`;
  }).join("");
}

function syncPaperCustomVisibility() {
  const selectedId = document.querySelector("#paperStrategySelect")?.value || state.paperStrategyId;
  const strategy = findPaperStrategy(selectedId);
  const custom = selectedId === "custom" || (strategy && !strategy.builtin);
  const details = document.querySelector("#paperCustomRules");
  if (details) details.open = Boolean(custom);
}

function renderPaperCustomSummary() {
  const summary = document.querySelector("#paperCustomSummary");
  if (!summary) return;
  const count = state.paperConditions.length;
  const logic = document.querySelector("#paperCustomLogic")?.value === "OR" ? "任一满足" : "全部满足";
  const watchlist = (document.querySelector("#paperWatchlist")?.value || "").split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean).length;
  summary.textContent = count || watchlist ? `已设置：${count} 条条件${count ? `（${logic}）` : ""} · ${watchlist} 个自选范围 · 保存后运行` : "未设置条件时，请填写自选范围；自定义策略需要至少一项规则。";
}

function findPaperStrategy(id) {
  return state.paperStrategies.find((item) => item.id === id) || null;
}

function renderPaperStrategySelect(preferredId = "trend") {
  const select = document.querySelector("#paperStrategySelect");
  if (!select) return;
  const primary = state.paperStrategies.filter((item) => item.builtin);
  const custom = state.paperStrategies.filter((item) => !item.builtin);
  const current = findPaperStrategy(preferredId);
  const visible = [...primary];
  if (current && !visible.some((item) => item.id === current.id)) visible.push(current);
  custom.forEach((item) => { if (!visible.some((row) => row.id === item.id)) visible.push(item); });
  select.innerHTML = visible.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("") + `<option value="custom">按我的条件</option>`;
  select.value = visible.some((item) => item.id === preferredId) || preferredId === "custom" ? preferredId : "trend";
}

async function loadPaperStrategies() {
  try {
    const data = await fetchJson("/api/paper/strategies");
    state.paperStrategies = data.strategies || [];
    const current = state.paperStrategyId || document.querySelector("#paperStrategySelect")?.value || "trend";
    renderPaperStrategySelect(current);
    state.paperStrategyId = document.querySelector("#paperStrategySelect")?.value || "trend";
    applyPaperStrategyEditor(findPaperStrategy(state.paperStrategyId));
    syncPaperCustomVisibility();
  } catch {
    showToast("策略模板读取失败，继续使用内置规则");
  }
}

function applyPaperStrategyEditor(strategy, overrideRules = {}) {
  if (!strategy && !Object.keys(overrideRules).length) return;
  const rules = { ...(strategy?.rules || {}), ...overrideRules };
  const set = (selector, value) => { const input = document.querySelector(selector); if (input) input.value = value ?? ""; };
  set("#paperStrategyName", strategy?.name || (state.paperStrategyId === "custom" ? "自定义策略" : ""));
  set("#paperStrategyDescription", strategy?.description || "");
  const fields = { minChange: "#paperRuleMinChange", maxChange: "#paperRuleMaxChange", minVolume: "#paperRuleMinVolume", minTurnover: "#paperRuleMinTurnover", maxTurnover: "#paperRuleMaxTurnover", minAmount: "#paperRuleMinAmount", maxRsi: "#paperRuleMaxRsi", minDrawdown: "#paperRuleMinDrawdown", maxDrawdown: "#paperRuleMaxDrawdown", minScore: "#paperRuleMinScore", sellStop: "#paperRuleSellStop", takeProfit: "#paperRuleTakeProfit", trailingStop: "#paperRuleTrailingStop", maxHoldingDays: "#paperRuleMaxHoldingDays", cooldownMinutes: "#paperRuleCooldown", minMarketChange: "#paperRuleMinMarketChange", perPosition: "#paperRulePerPosition", maxExposure: "#paperRuleMaxExposure", maxPositions: "#paperRuleMaxPositions", openingNoAddMinutes: "#paperRuleOpeningNoAdd", lowOpenThreshold: "#paperRuleLowOpen", lowOpenNoRedMinutes: "#paperRuleLowOpenMinutes", highOpenReduceThreshold: "#paperRuleHighReduce", highOpenReduceMinutes: "#paperRuleHighReduceMinutes", highOpenClearThreshold: "#paperRuleHighClear", highOpenClearMinutes: "#paperRuleHighClearMinutes", largeVolumeRatio: "#paperRuleLargeVolume", tailMoveThreshold: "#paperRuleTailMove" };
  Object.entries(fields).forEach(([key, selector]) => set(selector, rules[key] === undefined || rules[key] === null ? "" : key === "perPosition" || key === "maxExposure" ? Number(rules[key]) * 100 : rules[key]));
  const gate = document.querySelector("#paperRuleMarketGate");
  if (gate) gate.checked = Boolean(rules.requireMarketTrend);
  const rebound = document.querySelector("#paperRuleRebound");
  if (rebound) rebound.checked = Boolean(rules.requireRebound);
  const longTrend = document.querySelector("#paperRuleLongTrend");
  if (longTrend) longTrend.checked = Boolean(rules.requireLongTrend);
  const intraday = document.querySelector("#paperRuleIntradayGate");
  if (intraday) intraday.checked = Boolean(rules.intradayReference);
  if (Object.prototype.hasOwnProperty.call(rules, "usePreviousDailyBar")) {
    state.paperUsesPreviousDailyBar = Boolean(rules.usePreviousDailyBar);
  }
  const meta = document.querySelector("#paperStrategyEditorMeta");
  if (meta) meta.textContent = strategy?.builtin ? "默认策略可查看；如需修改，请先复制为自定义。" : "当前为可编辑策略，保存后可绑定到当前账户。";
  const deleteButton = document.querySelector("#deletePaperStrategy");
  if (deleteButton) deleteButton.disabled = !strategy || strategy.builtin;
  if (strategy && !strategy.builtin && Array.isArray(strategy.conditions)) {
    state.paperConditions = structuredClone(strategy.conditions);
    renderConditionLists();
  }
  renderPaperRiskProfile(rules);
  renderPaperStrategySummary();
}

function getPaperEditorRules() {
  const value = (selector) => { const number = Number(document.querySelector(selector)?.value); return Number.isFinite(number) ? number : null; };
  const percent = (selector) => { const number = value(selector); return number === null ? null : number / 100; };
  const strategyId = document.querySelector("#paperStrategySelect")?.value || state.paperStrategyId || "trend";
  const strategy = findPaperStrategy(strategyId);
  return { signalMode: strategyId === "custom" || !strategy?.builtin ? "custom" : strategy.rules?.signalMode, minChange: value("#paperRuleMinChange"), maxChange: value("#paperRuleMaxChange"), minVolume: value("#paperRuleMinVolume"), minTurnover: value("#paperRuleMinTurnover"), maxTurnover: value("#paperRuleMaxTurnover"), minAmount: value("#paperRuleMinAmount"), maxRsi: value("#paperRuleMaxRsi"), minDrawdown: value("#paperRuleMinDrawdown"), maxDrawdown: value("#paperRuleMaxDrawdown"), minScore: value("#paperRuleMinScore"), perPosition: percent("#paperRulePerPosition"), maxExposure: percent("#paperRuleMaxExposure"), maxPositions: value("#paperRuleMaxPositions"), sellStop: value("#paperRuleSellStop"), takeProfit: value("#paperRuleTakeProfit"), trailingStop: value("#paperRuleTrailingStop"), maxHoldingDays: value("#paperRuleMaxHoldingDays"), cooldownMinutes: value("#paperRuleCooldown"), requireMarketTrend: Boolean(document.querySelector("#paperRuleMarketGate")?.checked), requireRebound: Boolean(document.querySelector("#paperRuleRebound")?.checked), requireLongTrend: Boolean(document.querySelector("#paperRuleLongTrend")?.checked), minMarketChange: value("#paperRuleMinMarketChange"), intradayReference: Boolean(document.querySelector("#paperRuleIntradayGate")?.checked), openingNoAddMinutes: value("#paperRuleOpeningNoAdd"), lowOpenThreshold: value("#paperRuleLowOpen"), lowOpenNoRedMinutes: value("#paperRuleLowOpenMinutes"), highOpenReduceThreshold: value("#paperRuleHighReduce"), highOpenReduceMinutes: value("#paperRuleHighReduceMinutes"), highOpenClearThreshold: value("#paperRuleHighClear"), highOpenClearMinutes: value("#paperRuleHighClearMinutes"), largeVolumeRatio: value("#paperRuleLargeVolume"), tailMoveThreshold: value("#paperRuleTailMove"), usePreviousDailyBar: state.paperUsesPreviousDailyBar };
}

async function runPaperBacktest() {
  const query = document.querySelector("#paperWatchlist")?.value.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean)[0] || "";
  const host = document.querySelector("#paperBacktestResult");
  if (!host) return;
  if (!query) { showToast("请先在自选范围填写一个代码或名称，再进行策略验证"); return; }
  host.hidden = false;
  host.textContent = "正在读取历史 K 线并验证规则...";
  try {
    const strategy = document.querySelector("#paperStrategySelect")?.value || "trend";
    const data = await fetchJson(`/api/paper/backtest?code=${encodeURIComponent(query)}&window=month&strategy=${encodeURIComponent(strategy)}`);
    const coverage = data.coverage || {};
    const omitted = Array.isArray(coverage.omittedRules) ? coverage.omittedRules.join("、") : "暂无";
    host.innerHTML = `<strong>${escapeHtml(data.name)} · ${escapeHtml(data.strategy)}</strong><span>模拟交易 ${data.sampleCount} 笔 · 胜率 ${formatPercent(data.winRate)} · 平均单笔 ${formatPercent(data.averageReturn)}</span><span>总收益 ${formatPercent(data.totalReturn)} · 最大单笔亏损 ${formatPercent(data.maxLoss)} · 策略曲线回撤 ${formatPercent(data.maxDrawdown)}</span><small>覆盖 ${Number(coverage.historyPoints || 0)} 根K线；未覆盖：${escapeHtml(omitted)}。</small><small>${escapeHtml(data.note)}</small>`;
  } catch (error) {
    host.textContent = error.message || "历史验证失败，可能暂无该标的历史数据";
  }
}

async function loadPaperAccounts() {
  try {
    const data = await fetchJson("/api/paper/accounts");
    const accounts = data.accounts || [];
    if (!state.paperAccountId && accounts[0]) state.paperAccountId = accounts[0].id;
    if (state.paperAccountId && !accounts.some((item) => item.id === state.paperAccountId)) state.paperAccountId = accounts[0]?.id || null;
    const select = document.querySelector("#paperAccountSelect");
    if (select) {
      select.innerHTML = accounts.length ? accounts.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${formatPaperMoney(item.initial_cash)}</option>`).join("") : `<option value="">尚未创建账户</option>`;
      select.value = state.paperAccountId || "";
    }
  } catch {
    showToast("模拟账户列表读取失败");
  }
}

function renderDataCompleteness(data) {
  const host = document.querySelector("#dataCompleteness");
  const summary = document.querySelector("#dataHealthSummary");
  if (!host || !data) return;
  if (summary) {
    summary.textContent = data.summary;
    summary.className = data.ready ? "health-ready" : "health-warning";
  }
  host.innerHTML = (data.modules || []).map((item) => `
    <div class="data-health-item ${item.state}">
      <div><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.message)}</span></div>
      <strong>${item.rows ? `${formatNumber(item.rows)}条` : item.state === "partial" ? "部分" : "暂无"}</strong>
      <small>${escapeHtml(cleanMarketText(item.source || "暂无来源"))}</small>
    </div>
  `).join("");
}

async function loadMarkets() {
  const data = await fetchJson("/api/markets");
  state.markets = data.markets;
  state.marketsUpdatedAt = data.updatedAt;
  state.dataSource = data.source;
  setFreshness(data.updatedAt, data.source);
  renderRegionTabs();
  renderWindowTabs();
  renderMarkets();
}

async function loadTrends() {
  const data = await fetchJson("/api/trends");
  state.todayTrends = data.series || [];
  state.trends = state.todayTrends;
  state.trendSource = data.source;
  const preferred = state.trends.find((item) => item.code === "000001.SH")
    || state.trends.find((item) => item.region === "A股")
    || state.trends[0];
  state.selectedTrend = state.selectedTrend || preferred?.code || "";
  renderTrendSelect();
  renderTrendChart();
}

async function loadStockPool() {
  const data = await fetchJson("/api/stocks");
  state.allStocks = data.stocks || [];
  renderWatchlist();
  if (state.markets.length) renderMarkets();
}

async function loadEtfs() {
  const data = await fetchJson("/api/etfs");
  state.etfs = data.etfs;
  renderWatchlist();
  state.etfSource = data.source;
  renderEtfTabs();
  renderEtfs();
  renderFullMarketSummary(selectedIndexes());
}

async function loadSectorFlows() {
  const data = await fetchJson("/api/sector-flows");
  state.sectorFlows = data.sectors;
  state.sectorSource = data.source;
  renderSectorFlows();
  renderFullMarketSummary(selectedIndexes());
  if (state.markets.length) renderMarkets();
}

async function loadSectorCloud() {
  const sort = document.querySelector("#sectorCloudSort")?.value || "net_inflow";
  const data = await fetchJson(`/api/sectors/heatmap?type=${encodeURIComponent(state.sectorCloudType)}&sort=${encodeURIComponent(sort)}`);
  state.sectorCloudRows = data.sectors || [];
  renderSectorCloud(data);
}

async function loadNewsItems() {
  const data = await fetchJson("/api/news");
  state.newsItems = data.news || [];
  renderNewsItems();
}

async function loadNewsMonitor() {
  const params = new URLSearchParams({
    keyword: document.querySelector("#newsMonitorKeyword")?.value || "",
    region: document.querySelector("#newsMonitorRegion")?.value || "",
    market: document.querySelector("#newsMonitorMarket")?.value || "",
    importance: document.querySelector("#newsMonitorImportance")?.value || ""
  });
  const data = await fetchJson(`/api/news/feed?${params.toString()}`);
  state.newsMonitorRows = data.news || [];
  const fill = (selector, key, label) => {
    const select = document.querySelector(selector);
    if (!select) return;
    const current = select.value;
    const values = [...new Set(state.newsMonitorRows.map((item) => item[key]).filter(Boolean))].sort();
    select.innerHTML = `<option value="">${label}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    select.value = values.includes(current) ? current : "";
  };
  fill("#newsMonitorRegion", "region", "全部地区");
  fill("#newsMonitorMarket", "market", "全部市场");
  renderNewsMonitor();
}

async function runScreener() {
  const payload = {
    conditions: state.conditions,
    logic: state.logic,
    sort: state.stockSort,
    researchScoring: state.screenerResearchScoring
  };
  const data = await postJson("/api/screener/run", payload);
  state.stocks = data.stocks;
  document.querySelector("#screenerCount").textContent = data.researchScoring ? `${data.count} 条（筛选命中 ${data.matchedCount || data.count} 条）` : `${data.count} 条`;
  const scoreMeta = document.querySelector("#screenerScoreMeta");
  if (scoreMeta) scoreMeta.textContent = data.researchScoring ? `已完成 ${data.researchScoredCount} 条研究评分${data.matchedCount > data.researchLimit ? `，按成交额取前 ${data.researchLimit} 条` : ""}` : "";
  const researchButton = document.querySelector("#runScreenerResearch");
  if (researchButton) {
    researchButton.classList.toggle("active", Boolean(data.researchScoring));
    researchButton.textContent = data.researchScoring ? "关闭研究评分" : "整体研究评分";
  }
  renderScreenerQuality(data.quality, data.source);
  renderStockTable();
}

async function runPrediction() {
  const query = document.querySelector("#predictQuery")?.value.trim();
  const host = document.querySelector("#predictionResult");
  if (!query) {
    showToast("请输入代码或名称");
    return;
  }
  host.classList.add("empty-state");
  host.textContent = "正在计算命中分...";
  const data = await postJson("/api/screener/predict", {
    query,
    conditions: state.conditions,
    logic: state.logic
  });
  if (!data.ok) {
    state.prediction = null;
    host.classList.add("empty-state");
    host.textContent = data.message || "未找到对应标的。";
    return;
  }
  state.prediction = data.prediction;
  renderPrediction(data.prediction);
}

async function loadPrivateSignal() {
  const data = await fetchJson("/api/private-signal");
  document.querySelector("#privateMood").textContent = data.mood;
  document.querySelector("#privateSummary").textContent = data.summary;
  const meta = document.querySelector("#privateSignalMeta");
  const timingMeta = document.querySelector("#privateSignalTiming");
  if (meta) {
    const live = data.liveStatus || {};
    meta.textContent = `${live.connected ? "Futu实时订阅" : "最近真实快照"} · ${live.stockRows || 0} 条A股 · ${live.etfRows || 0} 条ETF · ${live.sectorRows || 0} 个板块 · 更新 ${formatDateTime(data.updatedAt)}`;
  }
  if (timingMeta) {
    const timing = data.signalTiming || {};
    timingMeta.textContent = timing.isTradingDay === false
      ? `当前为非交易日 · 暂不展示未来时段风险`
      : `当前阶段：${timing.session || "暂无"} · 北京时间 ${timing.clock || "--:--"} · 下一阶段：${timing.nextSession || "下个交易日盘前"} ${timing.nextSessionAt || ""}`;
  }
  let riskRadar = data.riskRadar || [];
  const riskMeta = document.querySelector("#riskRadarMeta");
  if (riskMeta) riskMeta.textContent = `${riskRadar.length} 项有效监控 · 行情与公开资讯证据`;
  renderRiskRadar(riskRadar);
  renderPrivateCandidates(data.candidates);
  decorateResearchPercentages(document.querySelector("#private"));
  // 先展示本地实时规则，再异步补充Agnes解释，避免AI延迟阻塞行情刷新。
  postJson("/api/ai/risk-radar", { riskRadar }).then((optimized) => {
    if (optimized.ok && Array.isArray(optimized.riskRadar)) {
      renderRiskRadar(optimized.riskRadar);
      decorateResearchPercentages(document.querySelector("#riskRadar"));
    }
  }).catch(() => {
    // Agnes不可用时保留本地规则，不影响风险雷达和行情刷新。
  });
  void loadMarketReport();
}

function shanghaiMarketReportDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function defaultMarketReportSession() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(values.hour || 0) * 60 + Number(values.minute || 0);
  if (minutes < 12 * 60) return "pre-market";
  if (minutes < 15 * 60 + 30) return "midday";
  return "closing";
}

function marketReportLabel(session) {
  return { "pre-market": "盘前报告", midday: "午间报告", closing: "收盘复盘" }[session] || "市场报告";
}

function renderMarketReportTabs(session) {
  document.querySelectorAll("[data-market-report-session]").forEach((button) => {
    const active = button.dataset.marketReportSession === session;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

async function loadMarketReport(options = {}) {
  const host = document.querySelector("#workbuddyReports");
  if (!host) return;
  if (options.manual) host.dataset.manualSession = "true";
  const session = options.session || (host.dataset.manualSession === "true" ? host.dataset.session : defaultMarketReportSession()) || defaultMarketReportSession();
  const date = options.date || shanghaiMarketReportDate();
  const meta = document.querySelector("#marketReportMeta");
  host.dataset.session = session;
  renderMarketReportTabs(session);
  host.innerHTML = `<div class="market-report-loading">正在读取${marketReportLabel(session)}...</div>`;
  try {
    const data = await fetchJson(`/api/market-report/${encodeURIComponent(session)}?date=${encodeURIComponent(date)}`);
    if (!data.ok || !data.report) {
      host.innerHTML = `<div class="market-report-empty"><strong>${date} 暂无${marketReportLabel(session)}</strong><span>WorkBuddy 会在交易日 08:30、12:00、15:30 写入对应文件；当前不会使用模板代替正式报告。</span></div>`;
      if (meta) meta.textContent = `请求 ${date} · 暂无报告`;
      return;
    }
    const report = data.report;
    const tags = [...(report.meta?.markets || []), ...(report.meta?.tags?.sector || []).slice(0, 4), ...(report.meta?.tags?.etf || []).slice(0, 4)];
    const basis = (report.entries?.researchBasis || []).map((item) => item.desc).filter(Boolean).slice(0, 4).join(" · ");
    const riskClass = report.meta?.risk_level === "高" ? "danger" : report.meta?.risk_level === "中" ? "warning" : "";
    const status = data.isFallback ? "最近交易日" : "今日报告";
    if (meta) meta.textContent = `${data.resolvedDate} · ${status}`;
    host.innerHTML = `<article class="market-report-document ${riskClass}"><header class="market-report-document-head"><div><strong>${escapeHtml(report.meta?.report_type || marketReportLabel(session))}</strong><small>${escapeHtml(report.meta?.generated_at || report.updatedAt || data.resolvedDate)} · ${escapeHtml(report.meta?.source || "WorkBuddy")}</small></div><span class="market-report-risk">风险 ${escapeHtml(report.meta?.risk_level || "未标注")}</span></header>${tags.length ? `<div class="market-report-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}${basis ? `<small class="market-report-basis">研究依据：${escapeHtml(basis)}</small>` : ""}<div class="workbuddy-report-body">${report.html || "暂无正文"}</div></article>`;
  } catch (error) {
    host.innerHTML = `<div class="market-report-empty error"><strong>报告加载失败</strong><span>${escapeHtml(error.message || "请检查市场报告目录和服务状态")}</span></div>`;
    if (meta) meta.textContent = "读取失败";
  }
  decorateResearchPercentages(host);
}

async function loadWechatDraft() {
  const data = await fetchJson("/api/wechat/draft");
  applyDraft(data);
}

async function loadSettings() {
  const [data, config, health, maintenance, feishu] = await Promise.all([
    fetchJson("/api/settings/status"), fetchJson("/api/settings/config"), fetchJson("/api/system/health"), fetchJson("/api/system/maintenance"), fetchJson("/api/system/feishu")
  ]);
  state.settingsConfig = config;
  document.querySelector("#serverStatus").value = `http://${data.server.host}:${data.server.port}`;
  const aiStatus = document.querySelector("#agnesStatus");
  if (aiStatus) aiStatus.value = data.agnes.anyConfigured
    ? `${data.agnes.writerProvider || "AI"} · ${data.agnes.writerModel || data.agnes.model || "已配置"}`
    : "未配置 Key";
  const moduleNames = { futu: "Futu", ashare_futu: "Futu A股", etf_futu: "Futu ETF", ashare: "A股", etf: "ETF", sector: "板块", global: "海外", history: "历史", sector_members: "成分", news: "资讯" };
  const sourceItems = Object.entries(data.sources || {})
    .filter(([key, item]) => moduleNames[key] && item && typeof item === "object" && "ok" in item)
    .map(([key, item]) => `${moduleNames[key]}:${item.ok ? "可用" : "不可用"}(${cleanMarketText(item.sourceName || key)}${Number.isFinite(Number(item.rows)) ? ` ${item.rows}条` : ""})`);
  const futu = data.dataProviders?.futu?.enabled ? `Futu OpenD:${data.dataProviders.futu.host}:${data.dataProviders.futu.port}` : "Futu未启用";
  const emquant = data.dataProviders?.emquant?.enabled && data.dataProviders?.emquant?.configured ? "EmQuant已配置" : "EmQuant未配置";
  document.querySelector("#dataSourceStatus").value = `${sourceItems.length ? sourceItems.join(" / ") : "尚未刷新"} / ${futu} / ${emquant}`;
  const databasePath = document.querySelector("#databasePath");
  if (databasePath) databasePath.value = data.database.path;
  const assetsPath = document.querySelector("#assetsPath");
  if (assetsPath) assetsPath.value = data.assetsDir;
  fillSettingsForm(config);
  renderSystemHealth(health, maintenance, feishu);
}

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return "暂无";
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(size / 1024)} KB`;
}

function healthLabel(level) {
  return level === "danger" ? "红色预警" : level === "warning" ? "黄色预警" : "正常";
}

function renderSystemHealth(health = {}, maintenance = {}, feishu = {}) {
  const grid = document.querySelector("#runtimeHealthGrid");
  const meta = document.querySelector("#runtimeHealthMeta");
  const history = document.querySelector("#maintenanceHistory");
  if (!grid) return;
  const freshness = health.freshness || [];
  const capacity = health.capacity || {};
  const stale = health.cache?.coreDataStale;
  const cards = [
    [health.futu?.connected ? "正常" : "异常", "Futu OpenD", health.futu?.connected ? "本机端口可连接" : (health.futu?.message || "未连接")],
    [stale ? "黄色预警" : "正常", "核心行情", stale ? "超过 5 分钟或数据源回退，自动交易跳过本轮" : `最新数据 ${freshness.map((item) => `${item.key} ${item.ageMinutes ?? "暂无"} 分钟`).join(" · ")}`],
    [healthLabel(capacity.dataLevel), "数据目录", `${formatBytes(capacity.dataBytes)} · ${capacity.backupCreationAllowed ? "允许完整备份" : "暂停新的完整备份"}`],
    [healthLabel(capacity.walLevel), "SQLite WAL", `${formatBytes(capacity.walBytes)} · 数据库 ${formatBytes(capacity.databaseBytes)}`],
    [health.auto?.running || health.auto?.active ? "正常" : "正常", "自动模拟", health.auto?.accountCount ? `${health.auto.accountCount} 个账户已启用${health.auto.blockedByStaleData ? " · 等待新数据" : ""}` : "当前没有启用账户"],
    [feishu.enabled && feishu.configured ? "正常" : "黄色预警", "飞书通知", feishu.enabled && feishu.configured ? `${feishu.mode === "app" ? "自建应用" : "Webhook"} · 每 ${feishu.pollSeconds || 60} 秒检查 · 上次 ${feishu.state?.updatedAt ? formatDateTime(feishu.state.updatedAt) : "暂无发送"}` : "未配置或已停用"],
    [health.maintenance?.lockActive ? "黄色预警" : "正常", "夜间维护", health.maintenance?.runtime?.message || health.maintenance?.latest?.message || "等待每日 02:20 任务"]
  ];
  grid.innerHTML = cards.map(([level, label, detail]) => `<article class="runtime-health-card ${level === "红色预警" ? "danger" : level === "黄色预警" ? "warning" : "ok"}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(level)}</strong><small>${escapeHtml(detail)}</small></article>`).join("");
  if (meta) meta.textContent = `检查于 ${formatDateTime(health.checkedAt)} · 数据阈值 20/30 GB · WAL 阈值 200/500 MB`;
  if (history) {
    const entries = maintenance.entries || [];
    history.innerHTML = entries.length ? `<div class="maintenance-title">最近维护</div>${entries.slice(0, 5).map((item) => `<div class="maintenance-row"><time>${formatDateTime(item.at)}</time><span>${escapeHtml(item.phase || "记录")}</span><span>${escapeHtml(item.message || "完成")}</span><small>${item.deletedObservations !== undefined ? `观察清理 ${item.deletedObservations} 条` : ""}${item.checkpointBusy ? " · WAL 待重试" : ""}</small></div>`).join("")}` : `<div class="maintenance-empty">暂无维护记录</div>`;
  }
}

async function loadWorkflow() {
  const data = await fetchJson("/api/workflow/today");
  state.workflow = data;
  renderWorkflow();
  renderSyncStrip();
}

async function loadAssets() {
  const data = await fetchJson("/api/assets");
  state.assets = data.assets;
  renderAssets();
}

async function loadDraftHistory() {
  const data = await fetchJson("/api/wechat/drafts");
  state.drafts = data.drafts;
  renderDraftHistory();
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.view);
    });
  });
  document.querySelectorAll(".view-link").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.targetView));
  });
}

function showView(viewName) {
  const target = document.querySelector(`#${viewName}`);
  if (!target) return;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewName));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindHomeControls() {
  document.querySelectorAll("#chartToolbar [data-chart-mode]").forEach((button) => button.addEventListener("click", () => {
    state.chartMode = button.dataset.chartMode;
    document.querySelectorAll("#chartToolbar [data-chart-mode]").forEach((item) => item.classList.toggle("active", item === button));
    renderTrendChart();
  }));
  document.querySelectorAll("#chartToolbar [data-indicator]").forEach((button) => button.addEventListener("click", () => {
    state.activeIndicator = button.dataset.indicator;
    document.querySelectorAll("#chartToolbar [data-indicator]").forEach((item) => item.classList.toggle("active", item === button));
    renderTrendChart();
  }));
  document.querySelector("#marketSort")?.addEventListener("change", (event) => {
    state.marketSort = event.target.value;
    renderMarkets();
  });
  document.querySelector("#trendSelect").addEventListener("change", async (event) => {
    state.selectedTrend = event.target.value;
    if (state.selectedWindow === "today") {
      renderMarkets();
      return;
    }
    showProgress("正在读取历史行情", `正在读取${windowMap[state.selectedWindow] || "当前周期"} K 线，请稍候。`, true);
    try {
      await loadSelectedHistoryTrend();
      renderMarkets();
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#etfSort").addEventListener("change", (event) => {
    state.etfSort = event.target.value;
    state.etfPage = 1;
    renderEtfs();
  });
  document.querySelector("#etfPageSize")?.addEventListener("change", (event) => {
    state.etfPageSize = Number(event.target.value) || 10;
    state.etfPage = 1;
    renderEtfs();
  });
  document.querySelector("#sectorSort").addEventListener("change", (event) => {
    state.sectorSort = event.target.value;
    state.sectorPage = 1;
    renderSectorFlows();
  });
  document.querySelector("#sectorSearch")?.addEventListener("input", (event) => {
    state.sectorSearch = event.target.value;
    state.sectorPage = 1;
    renderSectorFlows();
  });
  document.querySelector("#etfSearch")?.addEventListener("input", (event) => {
    state.etfSearch = event.target.value;
    state.etfPage = 1;
    renderEtfs();
  });
  document.querySelector("#indexSearch")?.addEventListener("input", (event) => {
    state.indexSearch = event.target.value;
    renderMarkets();
  });
  document.querySelector("#refreshBtn").addEventListener("click", async () => {
    const button = document.querySelector("#refreshBtn");
    if (state.syncBusy) {
      showToast("已有数据刷新任务正在执行，请等待完成");
      return;
    }
    state.syncBusy = true;
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = "刷新中...";
    showProgress("正在刷新真实数据", "正在连接 Futu、AkShare 等数据源，可能需要几十秒；页面不会冻结。", true);
    try {
      const result = await postJson("/api/data/refresh", {});
      updateProgress("数据采集完成，正在更新页面", result.saved?.length ? `已写入：${result.saved.join("、")}，正在重新读取最新数据。` : result.message);
      await refreshAll();
      showToast(result.ok ? `刷新完成：${result.saved?.length ? result.saved.join("、") : "未获取新数据，继续使用缓存"}` : `刷新失败：${result.message}`);
    } catch (error) {
      showToast(`刷新请求失败：${error.message || "请检查服务状态"}`);
    } finally {
      state.syncBusy = false;
      button.disabled = false;
      button.textContent = button.dataset.originalText || "刷新";
      hideProgress();
    }
  });
  document.querySelectorAll("#sectorTypeTabs [data-sector-type]").forEach((button) => button.addEventListener("click", async () => {
    state.sectorCloudType = button.dataset.sectorType;
    document.querySelectorAll("#sectorTypeTabs [data-sector-type]").forEach((item) => item.classList.toggle("active", item === button));
    await loadSectorCloud();
  }));
  document.querySelector("#sectorCloudSort")?.addEventListener("change", loadSectorCloud);
  document.querySelectorAll("#sectorRankTypeTabs [data-sector-rank-type]").forEach((button) => button.addEventListener("click", () => {
    state.sectorRankType = button.dataset.sectorRankType || "industry";
    state.sectorPage = 1;
    document.querySelectorAll("#sectorRankTypeTabs [data-sector-rank-type]").forEach((item) => item.classList.toggle("active", item === button));
    renderSectorFlows();
  }));
  document.querySelectorAll("#sectorViewTabs [data-sector-view]").forEach((button) => button.addEventListener("click", async () => {
    const mode = button.dataset.sectorView;
    document.querySelectorAll("#sectorViewTabs [data-sector-view]").forEach((item) => item.classList.toggle("active", item === button));
    const cloud = document.querySelector("#sectorCloudView");
    const rank = document.querySelector("#sectorRankView");
    if (cloud) cloud.hidden = mode === "rank";
    if (rank) rank.hidden = mode === "cloud";
    if (mode === "detail") {
      const first = state.sectorCloudRows[0] || state.sectorFlows[0];
      if (first?.name) await openSectorModal(first.name);
    }
  }));
  document.querySelector("#newsMonitorKeyword")?.addEventListener("input", debounce(loadNewsMonitor, 300));
  ["#newsMonitorRegion", "#newsMonitorMarket", "#newsMonitorImportance"].forEach((selector) => document.querySelector(selector)?.addEventListener("change", loadNewsMonitor));
  document.querySelector("#refreshNewsFeed")?.addEventListener("click", async () => {
    showProgress("正在刷新资讯", "正在读取公开资讯和本地素材，不会抓取未授权全文。");
    try { await loadNewsMonitor(); showToast("资讯已刷新"); } finally { hideProgress(); }
  });
}

function bindWorkflowControls() {
  const session = document.querySelector("#workflowSession");
  if (!session) return;
  session.addEventListener("change", () => {
    const preset = sessionDefaults[session.value] || sessionDefaults.close;
    document.querySelector("#articleType").value = preset.articleType;
    renderModulePicker(preset.modules);
    syncWorkflowToWechat();
  });
  ["#articleType", "#articleStyle", "#articleKeywords", "#articleRequirements"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("input", syncWorkflowToWechat);
    document.querySelector(selector)?.addEventListener("change", syncWorkflowToWechat);
  });
  document.querySelector("#generateWorkflow").addEventListener("click", generateWorkflow);
}

function bindTopicPresets() {
  document.querySelectorAll(".topic-preset").forEach((button) => {
    button.addEventListener("click", () => {
      const keywords = button.dataset.keywords || "";
      const requirements = button.dataset.requirements || "";
      const modules = (button.dataset.modules || "").split(",").filter(Boolean);
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        if (input) input.value = value;
      };
      setValue("#articleKeywords", keywords);
      setValue("#articleRequirements", requirements);
      setValue("#wechatKeywords", keywords);
      setValue("#wechatRequirements", requirements);
      state.selectedWechatModules = new Set(modules);
      renderModulePicker(modules);
      renderWechatModulePicker();
      document.querySelectorAll(".topic-preset").forEach((item) => item.classList.toggle("active", item.dataset.keywords === keywords));
      showToast(`已选择主题：${keywords}`);
    });
  });
}

function bindScreenerControls() {
  document.querySelectorAll(".template-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.conditions = structuredClone(templates[button.dataset.template]);
      renderConditionLists();
      runScreener();
    });
  });

  document.querySelector("#logicToggle").addEventListener("change", (event) => {
    state.logic = event.target.checked ? "OR" : "AND";
    runScreener();
  });

  document.querySelector("#addCondition").addEventListener("click", () => {
    state.conditions.push({ field: "volume_ratio", operator: ">", value: "1", value2: "" });
    renderConditionLists();
  });

  document.querySelector("#runScreener").addEventListener("click", runScreener);
  document.querySelector("#runScreenerResearch")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    state.screenerResearchScoring = !state.screenerResearchScoring;
    state.stockSort = { field: state.screenerResearchScoring ? "research_score" : "hit_score", direction: "desc" };
    if (state.screenerResearchScoring) state.visibleColumns.add("research_score");
    button.disabled = true;
    showProgress("正在计算整体研究评分", "正在读取当前筛选结果的历史 K 线与实时活跃度，最多处理 40 条。", true);
    try {
      await runScreener();
      renderColumnToggles();
      showToast(state.screenerResearchScoring ? "整体研究评分已完成" : "已切回条件命中分排序");
    } catch (error) {
      showToast(error.message || "整体研究评分失败");
    } finally {
      button.disabled = false;
      hideProgress();
    }
  });
  document.querySelector("#resetScreener").addEventListener("click", () => {
    state.conditions = [];
    state.screenerResearchScoring = false;
    state.stockSort = { field: "hit_score", direction: "desc" };
    renderConditionLists();
    runScreener();
  });
  document.querySelector("#runPrediction")?.addEventListener("click", runPrediction);
  bindPredictionLookup();
  document.querySelector("#predictQuery")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runPrediction();
  });
}

function bindPredictionLookup() {
  const input = document.querySelector("#predictQuery");
  const host = document.querySelector("#predictSuggestions");
  if (!input || !host) return;
  let timer = null;
  let token = 0;
  const hide = () => { host.hidden = true; host.replaceChildren(); };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (!query) { hide(); return; }
    host.hidden = false;
    host.innerHTML = `<div class="research-suggestion-loading">正在匹配代码和名称...</div>`;
    const currentToken = ++token;
    timer = setTimeout(async () => {
      try {
        const data = await fetchJson(`/api/research/search?q=${encodeURIComponent(query)}`);
        if (currentToken !== token || input.value.trim() !== query) return;
        renderResearchSuggestions(data.results || [], "#predictSuggestions");
      } catch {
        if (currentToken === token) host.innerHTML = `<div class="research-suggestion-loading">匹配失败，请直接预测</div>`;
      }
    }, 180);
  });
  host.addEventListener("click", (event) => {
    const item = event.target.closest("[data-research-query]");
    if (!item) return;
    input.value = item.dataset.researchQuery || "";
    hide();
    input.focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".prediction-query-field")) hide();
  });
}

function bindResearchControls() {
  document.querySelector(".market-report-tabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-market-report-session]");
    if (!button) return;
    void loadMarketReport({ session: button.dataset.marketReportSession || "pre-market", manual: true });
  });
  document.querySelector("#refreshRiskRadar")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    showProgress("正在刷新公开资讯", "采集新浪财经与东方财富公开内容，去重后重新生成风险证据。", true);
    try {
      const result = await postJson("/api/news/refresh", {});
      const meta = document.querySelector("#riskRadarMeta");
      if (meta) meta.textContent = result.message || "资讯已更新";
      await loadPrivateSignal();
      showToast(result.message || "风险雷达已更新");
    } catch (error) {
      showToast(error.message || "资讯刷新失败，继续保留已有风险雷达");
    } finally {
      button.disabled = false;
      hideProgress();
    }
  });
  const input = document.querySelector("#researchQuery");
  const button = document.querySelector("#runResearch");
  if (!input || !button) return;
  const suggestions = document.querySelector("#researchSuggestions");
  let searchTimer = null;
  let searchToken = 0;
  const hideSuggestions = () => {
    if (!suggestions) return;
    suggestions.hidden = true;
    suggestions.replaceChildren();
  };
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();
    if (!query) {
      hideSuggestions();
      return;
    }
    if (suggestions) {
      suggestions.hidden = false;
      suggestions.innerHTML = `<div class="research-suggestion-loading">正在匹配代码和名称...</div>`;
    }
    const token = ++searchToken;
    searchTimer = setTimeout(async () => {
      try {
        const data = await fetchJson(`/api/research/search?q=${encodeURIComponent(query)}`);
        if (token !== searchToken || input.value.trim() !== query) return;
        renderResearchSuggestions(data.results || []);
      } catch {
        if (token === searchToken && suggestions) suggestions.innerHTML = `<div class="research-suggestion-loading">匹配失败，请直接开始研究</div>`;
      }
    }, 180);
  });
  suggestions?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-research-query]");
    if (!item) return;
    input.value = item.dataset.researchQuery || "";
    hideSuggestions();
    input.focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".research-query-field")) hideSuggestions();
  });
  button.addEventListener("click", runResearch);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runResearch();
  });
}

function renderResearchSuggestions(rows = [], selector = "#researchSuggestions") {
  const host = document.querySelector(selector);
  if (!host) return;
  if (!rows.length) {
    host.hidden = false;
    host.innerHTML = `<div class="research-suggestion-loading">暂无匹配，请检查代码或名称</div>`;
    return;
  }
  host.hidden = false;
  host.innerHTML = rows.map((item) => {
    const fromDirectory = Boolean(item.quote_status);
    const detail = fromDirectory
      ? `${item.quote_status} · ${item.source_name || "证券目录"}`
      : `价格 ${formatPrice(item.price)} · 成交额 ${formatMoney(item.amount)}`;
    return `<button type="button" class="research-suggestion" data-research-query="${escapeHtml(item.code || item.name || "")}"><span><strong>${escapeHtml(item.name || "暂无名称")}</strong><small>${escapeHtml(displayCode(item.code || ""))} · ${escapeHtml(item.market || "A股")} · ${escapeHtml(item.sector || item.category || item.tracking || "暂无分类")}</small><em>${escapeHtml(detail)}</em></span><b>${Number.isFinite(Number(item.change_pct)) ? formatPercent(item.change_pct) : (fromDirectory ? "目录" : "暂无")}</b></button>`;
  }).join("");
}

function bindPaperControls() {
  document.querySelector("#paperEquityWindowTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-equity-window]");
    if (!button) return;
    state.paperEquityWindow = button.dataset.equityWindow === "today" ? "today" : "all";
    renderPaperEquityWindowTabs();
    if (state.paper) renderPaperStatus(state.paper);
  });
  document.querySelector("#paperStrategyHelp")?.addEventListener("click", openPaperStrategyModal);
  document.querySelector("#paperStrategySelect")?.addEventListener("change", (event) => {
    state.paperStrategyId = event.target.value;
    applyPaperStrategyEditor(findPaperStrategy(state.paperStrategyId));
    if (event.target.value === "custom" && !state.paperConditions.length && state.conditions.length) {
      state.paperConditions = structuredClone(state.conditions);
      renderConditionLists();
    }
    syncPaperCustomVisibility();
    renderPaperCustomSummary();
    renderPaperStrategyHelp();
    renderPaperStrategySummary();
  });
  document.querySelectorAll("[data-paper-risk-profile]").forEach((button) => button.addEventListener("click", () => applyPaperRiskProfile(button.dataset.paperRiskProfile)));
  document.querySelector("#loadPaperWatchlist")?.addEventListener("click", async () => {
    await loadWatchlist();
    if (!state.watchlist.length) {
      showToast("行情自选为空，请先在“行情自选”页面添加股票或 ETF");
      return;
    }
    const input = document.querySelector("#paperWatchlist");
    if (input) input.value = state.watchlist.map((item) => item.code || item.name).filter(Boolean).join(", ");
    renderPaperWatchlistChips();
    renderPaperCustomSummary();
    showToast(`已载入 ${state.watchlist.length} 个行情自选，保存后仅扫描这些标的`);
  });
  document.querySelector("#clearPaperWatchlist")?.addEventListener("click", () => {
    const input = document.querySelector("#paperWatchlist");
    if (input) input.value = "";
    renderPaperWatchlistChips();
    renderPaperCustomSummary();
  });
  document.querySelector("#paperWatchlistChips")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-paper-watch-remove]");
    if (!button) return;
    const remaining = paperWatchlistValues().filter((item) => item !== button.dataset.paperWatchRemove);
    const input = document.querySelector("#paperWatchlist");
    if (input) input.value = remaining.join(", ");
    renderPaperWatchlistChips();
    renderPaperCustomSummary();
  });
  document.querySelector("#clonePaperStrategy")?.addEventListener("click", async () => {
    const sourceId = document.querySelector("#paperStrategySelect")?.value || "trend";
    try {
      const result = await postJson(`/api/paper/strategy/${encodeURIComponent(sourceId)}/clone`, { name: document.querySelector("#paperStrategyName")?.value || "" });
      state.paperStrategies.push(result.strategy);
      state.paperStrategyId = result.strategy.id;
      renderPaperStrategySelect(result.strategy.id);
      applyPaperStrategyEditor(result.strategy);
      syncPaperCustomVisibility();
      showToast("已复制为可编辑策略");
    } catch (error) { showToast(error.message || "策略复制失败"); }
  });
  document.querySelector("#savePaperStrategy")?.addEventListener("click", async () => {
    const selectedId = document.querySelector("#paperStrategySelect")?.value || "trend";
    const current = findPaperStrategy(selectedId);
    const payload = { name: document.querySelector("#paperStrategyName")?.value, description: document.querySelector("#paperStrategyDescription")?.value, market: document.querySelector("#paperCustomMarket")?.value || "all", logic: document.querySelector("#paperCustomLogic")?.value || "AND", conditions: state.paperConditions, rules: getPaperEditorRules() };
    try {
      let result;
      if (current?.builtin || selectedId === "custom") {
        result = await postJson("/api/paper/strategy", { ...payload, builtin: false });
        state.paperStrategyId = result.strategy.id;
        state.paperStrategies.push(result.strategy);
        renderPaperStrategySelect(result.strategy.id);
      } else {
        result = await requestJson(`/api/paper/strategy/${encodeURIComponent(selectedId)}`, "PUT", { ...payload, id: selectedId });
        const index = state.paperStrategies.findIndex((item) => item.id === selectedId);
        if (index >= 0) state.paperStrategies[index] = result.strategy;
      }
      applyPaperStrategyEditor(result.strategy);
      syncPaperCustomVisibility();
      renderPaperCustomSummary();
      renderPaperStrategyHelp();
      showToast("策略已保存；如需当前账户使用，请点击“保存策略规则”");
    } catch (error) { showToast(error.message || "策略保存失败"); }
  });
  document.querySelector("#deletePaperStrategy")?.addEventListener("click", async () => {
    const selectedId = document.querySelector("#paperStrategySelect")?.value || "";
    const current = findPaperStrategy(selectedId);
    if (!current || current.builtin || selectedId === "custom") return;
    if (!window.confirm(`删除“${current.name}”？不会删除账户、持仓或交易日志。`)) return;
    try {
      await requestJson(`/api/paper/strategy/${encodeURIComponent(selectedId)}`, "DELETE");
      state.paperStrategies = state.paperStrategies.filter((item) => item.id !== selectedId);
      state.paperStrategyId = "trend";
      renderPaperStrategySelect("trend");
      applyPaperStrategyEditor(findPaperStrategy("trend"));
      syncPaperCustomVisibility();
      renderPaperStrategyHelp();
      showToast("自定义策略已删除；当前账户仍需重新保存策略绑定");
    } catch (error) { showToast(error.message || "策略删除失败"); }
  });
  document.querySelector("#runPaperBacktest")?.addEventListener("click", runPaperBacktest);
  document.querySelector("#warmupPaperHistory")?.addEventListener("click", async () => {
    if (!state.paperAccountId) {
      showToast("请先选择模拟账户");
      return;
    }
    const button = document.querySelector("#warmupPaperHistory");
    button.disabled = true;
    showProgress("正在补齐候选历史", "只处理当前账户持仓与粗筛候选，最多 20 只；不会抓取全市场。", true);
    try {
      const result = await postJson("/api/paper/history-warmup", { accountIds: [state.paperAccountId], limit: 20 });
      const loaded = Number(result.loaded || 0);
      const cached = Number(result.cached || 0);
      const gaps = Number(result.insufficient || 0) + Number(result.unavailable || 0);
      updateProgress("历史补齐完成", `已补齐 ${loaded} 只，已有缓存 ${cached} 只，仍需观察 ${gaps} 只。`);
      await new Promise((resolve) => setTimeout(resolve, 800));
      await loadPaperStatus({ syncConfig: true });
      showToast(gaps ? `历史补齐完成：${loaded + cached} 只可用，${gaps} 只仍待数据源补充` : `历史补齐完成：${loaded + cached} 只已具备样本`);
    } catch (error) {
      showToast(error.message || "历史补齐失败，请稍后重试");
    } finally {
      button.disabled = false;
      hideProgress();
    }
  });
  loadPaperStrategies();
  document.querySelector("#useScreenerConditions")?.addEventListener("click", () => {
    state.paperConditions = structuredClone(state.conditions || []);
    renderConditionLists();
    renderPaperCustomSummary();
    document.querySelector("#paperStrategySelect").value = "custom";
    renderPaperStrategyHelp();
    showToast(state.paperConditions.length ? "已加载条件筛选当前条件" : "当前没有可加载的筛选条件");
  });
  document.querySelector("#addPaperCondition")?.addEventListener("click", () => {
    state.paperConditions.push({ field: "volume_ratio", operator: ">", value: "1", value2: "" });
    renderConditionLists();
    renderPaperCustomSummary();
    document.querySelector("#paperStrategySelect").value = "custom";
    renderPaperStrategyHelp();
  });
  ["#paperCustomLogic", "#paperCustomMarket", "#paperWatchlist"].forEach((selector) => {
    ["input", "change"].forEach((eventName) => document.querySelector(selector)?.addEventListener(eventName, () => {
      if (selector === "#paperWatchlist") renderPaperWatchlistChips();
      renderPaperCustomSummary();
    }));
  });
  document.querySelector("#paperAccountSelect")?.addEventListener("change", async (event) => {
    state.paperAccountId = Number(event.target.value) || null;
    state.paperOrderPage = 1;
    await loadPaperStatus({ syncConfig: true });
  });
  document.querySelector("#createPaperAccount")?.addEventListener("click", async () => {
    const input = document.querySelector("#paperInitialCash");
    const initialCash = Number(input?.value);
    if (!Number.isFinite(initialCash) || initialCash < 1000) {
      showToast("请输入不少于 1000 元的初始资金");
      return;
    }
    showProgress("正在设置模拟账户", "只创建本地纸面账户，不会连接交易接口。", true);
    try {
      const result = await postJson("/api/paper/account", { initialCash, name: document.querySelector("#paperAccountName")?.value.trim() || (state.access.guestPaper ? "模拟账号" : "Komo模拟账户") });
      state.paperAccountId = result.account?.id || null;
      await loadPaperAccounts();
      await loadPaperStatus({ syncConfig: true });
      showToast("模拟账户已创建");
    } catch (error) {
      showToast(error.message || "账户设置失败；已有账户需先重置");
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#resetPaperAccount")?.addEventListener("click", async () => {
    const input = document.querySelector("#paperInitialCash");
    const initialCash = Number(input?.value);
    if (!Number.isFinite(initialCash) || initialCash < 1000) {
      showToast("重置前请填写新的初始资金");
      return;
    }
    if (!window.confirm("重置会清空当前模拟持仓、订单和资金曲线，是否继续？")) return;
    showProgress("正在重置模拟账户", "正在清空纸面交易记录并建立新账户。", true);
    try {
      await postJson("/api/paper/account", { initialCash, reset: true, accountId: state.paperAccountId });
      state.paperAccountId = null;
      await loadPaperAccounts();
      await loadPaperStatus({ syncConfig: true });
      showToast("模拟账户已重置");
    } catch (error) {
      showToast(error.message || "账户重置失败");
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#deletePaperAccount")?.addEventListener("click", async () => {
    if (!state.paperAccountId) {
      showToast("当前没有可删除的模拟账户");
      return;
    }
    if (!window.confirm("删除后将清空该账户的持仓、订单和资金曲线，且无法恢复，是否继续？")) return;
    showProgress("正在删除模拟账户", "正在删除当前账户的本地纸面交易记录。", true);
    try {
      await postJson("/api/paper/account/delete", { accountId: state.paperAccountId });
      state.paperAccountId = null;
      await loadPaperAccounts();
      await loadPaperStatus({ syncConfig: true });
      showToast("当前模拟账户已删除");
    } catch (error) {
      showToast(error.message || "账户删除失败");
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#runPaperStrategy")?.addEventListener("click", async () => {
    if (!state.paper?.configured) {
      showToast("请先设置模拟账户初始资金");
      return;
    }
    const button = document.querySelector("#runPaperStrategy");
    button.disabled = true;
    showProgress("正在运行模拟策略", "读取真实 A股和 ETF 行情，计算趋势、风险和仓位。", true);
    try {
      const result = await postJson("/api/paper/run", {
        accountId: state.paperAccountId,
        strategy: document.querySelector("#paperStrategySelect")?.value || "trend",
        conditions: state.paperConditions,
        logic: document.querySelector("#paperCustomLogic")?.value || "AND",
        market: document.querySelector("#paperCustomMarket")?.value || "all",
        watchlist: (document.querySelector("#paperWatchlist")?.value || "").split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean)
        ,rules: getPaperEditorRules(),
        maxActionsPerDay: Number(state.paperAuto?.config?.maxActionsPerDay || 10),
        maxBuysPerDay: Number(state.paperAuto?.config?.maxBuysPerDay || 10),
        maxSellsPerDay: Number(state.paperAuto?.config?.maxSellsPerDay || 10)
      });
      state.paper = result;
      renderPaperStatus(result);
      showToast(result.actions?.length ? `模拟策略完成：${result.actions.length} 笔操作` : "本轮没有满足条件的模拟操作");
    } catch (error) {
      showToast(error.message || "模拟策略运行失败");
    } finally {
      button.disabled = false;
      hideProgress();
    }
  });
  document.querySelector("#dryRunPaperStrategy")?.addEventListener("click", async () => {
    if (!state.paper?.configured) {
      showToast("请先设置模拟账户初始资金");
      return;
    }
    const button = document.querySelector("#dryRunPaperStrategy");
    button.disabled = true;
    showProgress("正在试跑策略", "读取当前真实缓存与策略规则，不会创建订单、修改持仓或资金曲线。", true);
    try {
      const result = await postJson("/api/paper/run", {
        accountId: state.paperAccountId,
        strategy: document.querySelector("#paperStrategySelect")?.value || "trend",
        conditions: state.paperConditions,
        logic: document.querySelector("#paperCustomLogic")?.value || "AND",
        market: document.querySelector("#paperCustomMarket")?.value || "all",
        watchlist: (document.querySelector("#paperWatchlist")?.value || "").split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean),
        rules: getPaperEditorRules(),
        maxActionsPerDay: Number(state.paperAuto?.config?.maxActionsPerDay || 10),
        maxBuysPerDay: Number(state.paperAuto?.config?.maxBuysPerDay || 10),
        maxSellsPerDay: Number(state.paperAuto?.config?.maxSellsPerDay || 10),
        dryRun: true
      });
      renderPaperDecisionPanel(result.decisionRows || [], result.decisions || []);
      showToast(result.actions?.length ? `试跑完成：理论 ${result.actions.length} 笔操作，未写入账户` : "试跑完成：当前没有可执行操作");
    } catch (error) {
      showToast(error.message || "策略试跑失败");
    } finally {
      button.disabled = false;
      hideProgress();
    }
  });
  const persistPaperConfig = async (enabled) => {
    const accountId = state.paperAccountId;
    if (!accountId) {
      showToast("请先选择模拟账户，再开启自动模拟交易");
      return null;
    }
    const button = enabled ? document.querySelector("#togglePaperAuto") : document.querySelector("#savePaperProfile");
    button.disabled = true;
    showProgress(enabled ? "正在开启自动交易" : "正在保存策略规则", "只保存本地纸面交易规则，不会连接真实交易接口。", true);
    try {
      const result = await postJson("/api/paper/auto-config", {
        enabled,
        accountId,
        intervalSeconds: Number(document.querySelector("#paperAutoInterval")?.value || 180),
        marketHoursOnly: Boolean(document.querySelector("#paperMarketHoursOnly")?.checked),
        maxActionsPerDay: Number(document.querySelector("#paperMaxActions")?.value || 10),
        maxBuysPerDay: Number(document.querySelector("#paperMaxBuys")?.value || 10),
        maxSellsPerDay: Number(document.querySelector("#paperMaxSells")?.value || 10),
        maxDailyLossPct: Number(document.querySelector("#paperMaxLoss")?.value || 3),
        strategy: document.querySelector("#paperStrategySelect")?.value || "trend",
        conditions: state.paperConditions,
        logic: document.querySelector("#paperCustomLogic")?.value || "AND",
        market: document.querySelector("#paperCustomMarket")?.value || "all",
        watchlist: (document.querySelector("#paperWatchlist")?.value || "").split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean)
        ,rules: getPaperEditorRules()
      });
      state.paperAuto = result;
      renderPaperAutoStatus(result);
      showToast(result.message || (enabled ? "自动交易已开启" : "策略规则已保存"));
      return result;
    } catch (error) {
      showToast(error.message || (enabled ? "自动交易开启失败" : "策略规则保存失败"));
      return null;
    } finally {
      button.disabled = false;
      hideProgress();
    }
  };
  document.querySelector("#savePaperProfile")?.addEventListener("click", () => persistPaperConfig(Boolean(state.paperAuto?.config?.enabled)));
  document.querySelector("#togglePaperAuto")?.addEventListener("click", () => persistPaperConfig(!Boolean(state.paperAuto?.config?.enabled)));
  renderPaperStrategyHelp();
  renderPaperStrategySummary();
  renderPaperEquityWindowTabs();
}

function renderPaperEquityWindowTabs() {
  document.querySelectorAll("#paperEquityWindowTabs [data-equity-window]").forEach((button) => {
    const active = button.dataset.equityWindow === state.paperEquityWindow;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function renderPaperStrategyHelp() {
  const key = document.querySelector("#paperStrategySelect")?.value || "trend";
  const host = document.querySelector(".strategy-tooltip");
  if (!host) return;
  const selected = findPaperStrategy(key);
  if (selected && !selected.builtin) {
    const rules = selected.rules || {};
    host.innerHTML = `<strong>${escapeHtml(selected.name)} · 已保存版本</strong><span>${escapeHtml(selected.description || "本地可编辑模拟策略")}</span><span>买入规则：${selected.conditions?.length ? `自定义条件 ${selected.conditions.length} 条（${selected.logic === "OR" ? "任一满足" : "全部满足"}）` : "使用基础行情规则"}；范围：${escapeHtml(selected.market || "all")}。</span><span>风险规则：止损 ${formatPercent(rules.sellStop)} · 止盈 ${formatPercent(rules.takeProfit)} · 移动止盈 ${formatPercent(rules.trailingStop)} · 最长 ${rules.maxHoldingDays || 0} 天。</span><small>修改后点击“保存策略”，再点击“保存策略规则”绑定当前账户；仅用于本地模拟。</small>`;
    return;
  }
  const descriptions = {
    trend: ["趋势跟随 v4", "MA5/MA20、市场环境、量比与流动性共同确认。", "单标的 20%，总持仓 80%，最多 5 个。", "卖出：止损、止盈、移动止盈、持仓天数和 T+1。"],
    short: ["短线动量 v4", "量比、换手率、均线和流动性共同判断。", "单标的 20%，总持仓 70%，最多 4 个。", "卖出：止损、止盈、移动止盈和 T+1。"],
    long: ["长线趋势 v6", "实时行情、流动性和基础趋势优先；长周期均线只作参考。", "单标的 25%，总持仓 85%，最多 6 个。", "卖出：趋势破坏、止损 -8%，最长持仓 45 天。"],
    conservative: ["保守低波 v4", "限制波动、换手和仓位，减少错误交易。", "单标的 15%，总持仓 60%，最多 4 个。", "卖出：止损 -2%，移动止盈 1.5%。"],
    momentum: ["强势动量 v4", "高活跃、放量、均线向上且流动性达标。", "单标的 15%，总持仓 60%，最多 4 个。", "卖出：止损 -3%，止盈和移动止盈。"],
    etf: ["ETF轮动 v4", "ETF趋势、相对强弱、成交额、量比和市场环境共同确认。", "单标的 15%，总仓位 60%，最多 4 个。", "卖出：止损、止盈、最长持仓和 T+1。"],
    reversal: ["超跌反转 v2", "RSI超卖、回撤和止跌反弹共同确认。", "最低评分 60，单标的 15%，总仓位 60%。", "卖出：止损 -4%，反弹止盈和移动止盈。"],
    etf_reversal: ["ETF超跌修复 v2", "ETF回撤、RSI、量能与反弹确认后观察。", "最低评分 60，单标的 15%，总仓位 60%。", "卖出：止损 -3%，最长持仓 15 天。"],
    custom: ["自定义策略", `使用条件筛选：${state.paperConditions.length ? `已加载 ${state.paperConditions.length} 条` : "未加载"}。`, "可叠加自选代码/名称范围；填写后只在自选范围内选择。", "基础风险退出：涨跌幅低于 -2%。"]
  };
  const rows = descriptions[key] || descriptions.trend;
  host.innerHTML = `<strong>${rows[0]}</strong>${rows.slice(1).map((item) => `<span>${item}</span>`).join("")}<small>仅模拟，不调用 Futu 交易接口；规则用于研究，不代表收益预测。</small>`;
}

function strategyRulePercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number > 0 ? "+" : ""}${number.toFixed(1)}%` : "未限制";
}

function strategyAllocationPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(0)}%` : "未设置";
}

function strategyRuleText(rules, key, label, formatter = strategyRulePercent) {
  const value = rules?.[key];
  return `<span><b>${label}</b>${formatter(value)}</span>`;
}

function renderPaperStrategyLibrary() {
  const host = document.querySelector("#paperStrategyModalBody");
  if (!host) return;
  const selectedId = state.paperAuto?.config?.strategyId || state.paperAuto?.config?.strategy || state.paperStrategyId || document.querySelector("#paperStrategySelect")?.value || "trend";
  if (!state.paperStrategies.length) {
    host.innerHTML = `<div class="strategy-library-empty">策略正在读取，请稍后重试。</div>`;
    return;
  }
  host.innerHTML = state.paperStrategies.map((strategy) => {
    const rules = strategy.rules || {};
    const current = String(strategy.id) === String(selectedId);
    const conditions = Array.isArray(strategy.conditions) ? strategy.conditions : [];
    const entry = [
      strategyRuleText(rules, "minChange", "最低涨幅"),
      strategyRuleText(rules, "maxChange", "最高涨幅"),
      strategyRuleText(rules, "minVolume", "最低量比", (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "未限制"),
      strategyRuleText(rules, "minTurnover", "最低换手", strategyRulePercent),
      strategyRuleText(rules, "minAmount", "最低成交额", formatMoney),
      strategyRuleText(rules, "minScore", "最低评分", (value) => Number(value) > 0 ? `${Number(value)} 分` : "未限制")
    ].join("");
    const management = [
      strategyRuleText(rules, "perPosition", "单票仓位", strategyAllocationPercent),
      strategyRuleText(rules, "maxExposure", "总仓位", strategyAllocationPercent),
      strategyRuleText(rules, "maxPositions", "最大持仓", (value) => Number.isFinite(Number(value)) ? `${Number(value)} 个` : "未设置"),
      strategyRuleText(rules, "cooldownMinutes", "同票冷却", (value) => Number.isFinite(Number(value)) ? `${Number(value)} 分钟` : "未设置")
    ].join("");
    const risk = [
      strategyRuleText(rules, "sellStop", "止损"),
      strategyRuleText(rules, "takeProfit", "止盈"),
      strategyRuleText(rules, "trailingStop", "移动止盈"),
      strategyRuleText(rules, "maxHoldingDays", "最长持仓", (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? `${Number(value)} 天` : "未限制")
    ].join("");
    const conditionText = conditions.length ? conditions.slice(0, 4).map(describeAdminCondition).join("；") + (conditions.length > 4 ? `；另 ${conditions.length - 4} 条` : "") : "使用基础行情与风险规则";
    return `<article class="strategy-library-card ${current ? "current" : ""}">
      <div class="strategy-library-head"><div><h3>${escapeHtml(strategy.name || strategy.id || "未命名策略")}</h3><p>${escapeHtml(strategy.description || "本地模拟策略")}</p></div><div class="strategy-library-tags">${current ? "<span class=\"strategy-current-tag\">当前账户</span>" : ""}<span>${escapeHtml(strategy.market || "all")}</span>${strategy.builtin ? "<span>内置</span>" : "<span>自定义</span>"}</div></div>
      <section><h4>入场筛选</h4><div class="strategy-rule-list">${entry}</div></section>
      <section><h4>仓位管理</h4><div class="strategy-rule-list">${management}</div></section>
      <section><h4>退出与风险</h4><div class="strategy-rule-list">${risk}</div></section>
      <footer><span>大盘过滤：${rules.requireMarketTrend ? "启用" : "关闭"}</span><span>长周期均线：${rules.requireLongTrend ? "参考开启" : "不作为开仓条件"}</span><span>盘中形态参考：${rules.intradayReference ? "启用（仅研究）" : "关闭"}</span><p>条件：${escapeHtml(conditionText)}</p></footer>
    </article>`;
  }).join("");
}

function openPaperStrategyModal() {
  const modal = document.querySelector("#paperStrategyModal");
  if (!modal) return;
  renderPaperStrategyLibrary();
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.querySelector("#closePaperStrategyModal")?.focus();
}

function closePaperStrategyModal() {
  const modal = document.querySelector("#paperStrategyModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.querySelector("#paperStrategyHelp")?.focus();
}

function renderPaperStatus(data = {}) {
  const notice = document.querySelector("#paperNotice");
  const metrics = document.querySelector("#paperMetrics");
  const positionsHost = document.querySelector("#paperPositions");
  const ordersHost = document.querySelector("#paperOrders");
  const positionCount = document.querySelector("#paperPositionCount");
  const orderCount = document.querySelector("#paperOrderCount");
  if (!metrics || !positionsHost || !ordersHost) return;
  if (!data.configured) {
    if (notice) notice.textContent = data.message || "尚未设置初始资金，模拟策略不会执行。";
    metrics.innerHTML = ["总资产", "可用资金", "持仓市值", "今日盈亏", "累计盈亏", "回撤"].map((label) => `<article class="paper-metric"><span>${label}</span><strong>暂无</strong><small>等待账户设置</small></article>`).join("");
    positionsHost.innerHTML = `<div class="paper-empty">设置初始资金后，模拟持仓会显示在这里。</div>`;
    ordersHost.innerHTML = `<tr><td colspan="10" class="paper-empty">暂无模拟操作日志。</td></tr>`;
    document.querySelector("#paperOrderPager")?.replaceChildren();
    renderPaperDecisionPanel();
    renderPaperEquityChart([]);
    if (positionCount) positionCount.textContent = "0 个";
    if (orderCount) orderCount.textContent = "0 条";
    return;
  }
  const account = data.account;
  const pnl = Number(account.realized_pnl || 0) + Number(account.unrealized_pnl || 0);
  const strategyName = document.querySelector("#paperStrategySelect option:checked")?.textContent || data.strategy || "趋势跟随 v1";
  if (notice) notice.textContent = `策略：${strategyName} · ${data.stream?.connected ? "Futu实时推送中" : data.stream?.openDConnected ? "OpenD已连接，等待推送" : "最近行情/缓存"} · ${data.stream?.message || "等待实时推送"} · 最近更新 ${formatDateTime(data.updatedAt || account.updated_at)}`;
  renderPaperDecisionPanel(data.decisionRows || [], data.decisions || []);
  metrics.innerHTML = [
    ["总资产", formatPaperMoney(account.equity), "初始资金 " + formatPaperMoney(account.initial_cash), ""],
    ["可用资金", formatPaperMoney(account.cash), "现金余额", ""],
    ["持仓市值", formatPaperMoney(account.market_value), `${data.positions?.length || 0} 个标的`, ""],
    ["今日盈亏", formatPaperMoney(account.today_pnl), account.today_equity_points ? `今日基线 ${formatPaperMoney(account.today_baseline)}` : "暂无今日资金基线", Number(account.today_pnl) >= 0 ? "positive" : "negative"],
    ["累计盈亏", formatPaperMoney(pnl), `收益率 ${formatPercent(account.return_pct)}`, pnl >= 0 ? "positive" : "negative"],
    ["最大回撤", formatPercent(account.drawdown), "基于资金曲线高点", account.drawdown >= 0 ? "" : "negative"]
  ].map(([label, value, detail, cls]) => `<article class="paper-metric ${cls}"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`).join("");
  const positions = buildPaperPositionDisplayRows(data.positions || [], data.todayPositions || []);
  if (positionCount) positionCount.textContent = `${positions.length} 个`;
  positionsHost.innerHTML = positions.length ? positions.map((item) => {
    const holding = item.status !== "cleared";
    const pnl = holding ? Number(item.unrealized_pnl || 0) : Number(item.realized_pnl || 0);
    const pnlClass = pnl >= 0 ? "paper-up" : "paper-down";
    const priceText = holding ? `现价 ${formatPaperPrice(item.last_price)} · 成本 ${formatPaperPrice(item.avg_cost)} · 当日 ${formatPercent(item.change_pct)}` : `卖出价 ${formatPaperPrice(item.last_price)} · 今日已清仓`;
    return `<article class="paper-position ${holding ? "" : "paper-position-cleared"}"><div><span class="paper-position-status ${holding ? "status-live" : "status-neutral"}">${escapeHtml(item.status_label || (holding ? "持有中" : "今日已清仓"))}</span><strong>${escapeHtml(item.name)}</strong><span>${displayCode(item.code)} · ${holding ? item.quantity : 0}股/份</span></div><div class="paper-position-pnl ${pnlClass}"><strong>${formatPaperMoney(pnl)}</strong><span>${holding ? "浮动" : "已实现"}收益率 ${Number.isFinite(Number(item.return_pct)) ? formatPercent(item.return_pct) : "--"}</span></div><small>${priceText}</small></article>`;
  }).join("") : `<div class="paper-empty">当前没有持仓，运行策略后会记录模拟操作。</div>`;
  const orders = data.orders || [];
  if (orderCount) orderCount.textContent = `${orders.length} 条`;
  renderPaperOrders(orders);
  const equityRows = [...(data.equity || [])];
  if (Number.isFinite(Number(account.equity))) {
    const lastEquity = equityRows.at(-1);
    if (!lastEquity || Number(lastEquity.equity) !== Number(account.equity) || paperTimestampMs(lastEquity.created_at) < paperTimestampMs(account.updated_at)) {
      equityRows.push({ equity: account.equity, created_at: account.updated_at, live: true });
    }
  }
  const selectedDay = paperShanghaiDay(account.updated_at || new Date().toISOString());
  const allOrders = data.orders || [];
  const visibleEquityRows = state.paperEquityWindow === "today"
    ? equityRows.filter((row) => paperShanghaiDay(row.created_at) === selectedDay)
    : equityRows;
  const visibleOrders = state.paperEquityWindow === "today"
    ? allOrders.filter((order) => paperShanghaiDay(order.created_at) === selectedDay)
    : allOrders;
  renderPaperEquityChart(visibleEquityRows, visibleOrders, state.paperEquityWindow === "today");
  renderPaperEquityWindowTabs();
}

function buildPaperPositionDisplayRows(positions = [], todayPositions = []) {
  const todayByCode = new Map((todayPositions || []).map((item) => [String(item.code), item]));
  const holdingRows = (positions || []).map((position) => ({
    ...position,
    status: "holding",
    status_label: todayByCode.get(String(position.code))?.status_label || "持有中",
    return_pct: position.unrealized_return_pct
  }));
  const clearedRows = (todayPositions || []).filter((item) => item.status === "cleared");
  return [...holdingRows, ...clearedRows];
}

function renderPaperDecisionPanel(rows = [], decisions = []) {
  const host = document.querySelector("#paperDecisionPanel");
  if (!host) return;
  if (!rows.length && !decisions.length) { host.hidden = true; host.replaceChildren(); return; }
  const passed = rows.filter((item) => item.passed).length;
  const passedRows = rows.filter((item) => item.passed).slice(0, 5);
  const rejected = rows.filter((item) => !item.passed).slice(0, 8);
  host.hidden = false;
  host.innerHTML = `<div class="paper-decision-head"><strong>本轮触发解释</strong><span>${rows.length ? `检查 ${rows.length} 个候选 · 通过初筛 ${passed} 个` : "暂无候选明细"}</span></div>${decisions.slice(0, 3).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}${passedRows.length ? `<div class="paper-decision-list paper-decision-passed">${passedRows.map((item) => `<span><b>${escapeHtml(item.name || item.code)}</b>通过初筛${Number.isFinite(Number(item.signal_score)) ? ` · 综合评分 ${Number(item.signal_score)}` : ""}${item.event ? `<small>${escapeHtml(item.event)}</small>` : ""}</span>`).join("")}</div>` : ""}${rejected.length ? `<div class="paper-decision-list">${rejected.map((item) => `<span><b>${escapeHtml(item.name || item.code)}</b>${escapeHtml(item.reason)}${item.event ? `<small>${escapeHtml(item.event)}</small>` : ""}</span>`).join("")}</div>` : ""}`;
}

function renderPaperOrders(orders = []) {
  const host = document.querySelector("#paperOrders");
  if (!host) return;
  if (!orders.length) {
    host.innerHTML = `<tr><td colspan="10" class="paper-empty">暂无模拟操作日志。</td></tr>`;
    document.querySelector("#paperOrderPager")?.replaceChildren();
    return;
  }
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  state.paperOrderPage = clamp(state.paperOrderPage || 1, 1, totalPages);
  const start = (state.paperOrderPage - 1) * pageSize;
  const rows = orders.slice(start, start + pageSize);
  host.innerHTML = rows.map((item) => `<tr><td>${formatDateTime(item.created_at)}</td><td class="${item.side === "BUY" ? "paper-up" : "paper-down"}">${item.side === "BUY" ? "模拟买入" : "模拟卖出"}</td><td>${displayCode(item.code)}</td><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${formatPaperPrice(item.price)}</td><td>${formatPaperMoney(item.amount)}</td><td>${formatPaperMoney(item.fee)}</td><td class="${Number(item.realized_pnl) >= 0 ? "paper-up" : "paper-down"}">${formatPaperMoney(item.realized_pnl)}</td><td>${escapeHtml(item.reason)}</td></tr>`).join("");
  renderPager("#paperOrderPager", { page: state.paperOrderPage, pageSize, total: orders.length, totalPages }, (page) => {
    state.paperOrderPage = page;
    renderPaperOrders(orders);
  });
}

function formatPaperMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}元` : "暂无数据";
}

function formatPaperPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : "暂无";
}

function renderPaperEquityChart(rows = [], orders = [], isToday = false) {
  const svg = document.querySelector("#paperEquityChart");
  const meta = document.querySelector("#paperChartMeta");
  if (!svg) return;
  if (!rows.length) {
    svg.innerHTML = `<g class="empty-chart"><rect x="1" y="1" width="858" height="318" rx="8" /><text x="430" y="142" text-anchor="middle">${isToday ? "今日暂无资金曲线" : "设置账户并运行策略后显示资金曲线"}</text><text x="430" y="168" text-anchor="middle" class="chart-empty-hint">${isToday ? "运行策略或等待实时估值记录" : "运行策略后会记录真实模拟权益"}</text></g>`;
    if (meta) meta.textContent = isToday ? "今日暂无足够资金记录" : "等待首次模拟记录";
    return;
  }
  const pointsRows = rows.map((row) => ({ row, value: Number(row.equity), timestamp: paperTimestampMs(row.created_at) })).filter((item) => Number.isFinite(item.value)).sort((a, b) => (a.timestamp || Number(a.row.id) || 0) - (b.timestamp || Number(b.row.id) || 0));
  const values = pointsRows.map((item) => item.value);
  const width = 860;
  const height = 320;
  const pad = { left: 88, right: 30, top: 58, bottom: 48 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = rawMax - rawMin;
  const padding = rawRange || Math.max(Math.abs(rawMax) * 0.005, 1);
  const min = rawMin - padding * 0.12;
  const max = rawMax + padding * 0.12;
  const range = max - min || 1;
  const toX = (index) => isToday
    ? paperTimeToTradingX(pointsRows[index]?.row?.created_at, pad.left, width - pad.right)
    : pad.left + index / Math.max(values.length - 1, 1) * plotWidth;
  const toY = (value) => pad.top + (max - value) / range * plotHeight;
  const points = values.map((value, index) => [toX(index), toY(value)]);
  const path = points.map(([x, y], index) => {
    const previous = pointsRows[index - 1];
    const breakForLunch = isToday && previous && isPaperLunchBreakBetween(previous.row, pointsRows[index].row);
    return `${index === 0 || breakForLunch ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const baseline = values[0];
  const last = values.at(-1);
  const profit = last - baseline;
  const returnPct = baseline ? profit / baseline * 100 : null;
  const ticks = [0, 1, 2, 3, 4].map((index) => min + (max - min) * (1 - index / 4));
  const timeIndexes = [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])];
  const tickMarkup = ticks.map((value, index) => {
    const y = pad.top + index * plotHeight / 4;
    return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" class="chart-grid" /><text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" class="chart-axis">${formatPaperMoney(value)}</text>`;
  }).join("");
  const timeMarkup = isToday
    ? tradingTimeMarkers(pad.left, width - pad.right).filter((marker) => marker.kind !== "lunch").map((marker) => `<line x1="${marker.x}" x2="${marker.x}" y1="${pad.top}" y2="${height - pad.bottom}" class="chart-grid vertical" /><text x="${marker.x}" y="${height - 18}" text-anchor="${marker.anchor}" class="chart-label">${marker.label}</text>`).join("")
    : timeIndexes.map((index) => `<line x1="${points[index][0]}" x2="${points[index][0]}" y1="${pad.top}" y2="${height - pad.bottom}" class="chart-grid vertical" /><text x="${points[index][0]}" y="${height - 18}" text-anchor="middle" class="chart-label">${formatChartTime(pointsRows[index].row.created_at)}</text>`).join("");
  const lunchMarkup = isToday
    ? `<line x1="${tradingLunchBounds(pad.left, width - pad.right).centerX}" x2="${tradingLunchBounds(pad.left, width - pad.right).centerX}" y1="${pad.top}" y2="${height - pad.bottom}" class="paper-session-divider" /><text x="${tradingLunchBounds(pad.left, width - pad.right).centerX}" y="${pad.top + 16}" text-anchor="middle" class="paper-session-label">午休 11:30 / 13:00</text>`
    : "";
  const dayBoundaries = [];
  let previousDay = "";
  pointsRows.forEach((item, index) => {
    const day = paperShanghaiDay(item.row.created_at);
    if (day && day !== previousDay) {
      if (index > 0) dayBoundaries.push({ index, day });
      previousDay = day;
    }
  });
  const dayBoundaryMarkup = dayBoundaries.map(({ index, day }) => `<g class="paper-day-divider"><line x1="${points[index][0]}" x2="${points[index][0]}" y1="${pad.top}" y2="${height - pad.bottom}" /><text x="${points[index][0] + 5}" y="${height - 18}">${day.slice(5)}</text></g>`).join("");
  const tradeGroups = new Map();
  orders.forEach((order) => {
    const timestamp = paperTimestampMs(order.created_at);
    if (!Number.isFinite(timestamp) || !pointsRows.length) return;
    let nearestIndex = 0;
    let distance = Number.POSITIVE_INFINITY;
    pointsRows.forEach((item, index) => {
      const candidateDistance = Number.isFinite(item.timestamp) ? Math.abs(item.timestamp - timestamp) : Number.POSITIVE_INFINITY;
      if (candidateDistance < distance) {
        distance = candidateDistance;
        nearestIndex = index;
      }
    });
    const group = tradeGroups.get(nearestIndex) || { orders: [], buys: 0, sells: 0 };
    group.orders.push(order);
    if (order.side === "BUY") group.buys += 1;
    else group.sells += 1;
    tradeGroups.set(nearestIndex, group);
  });
  const tradeMarkers = [...tradeGroups.entries()].map(([nearestIndex, group]) => {
    const point = points[nearestIndex];
    const markerType = group.buys && group.sells ? "mixed" : group.buys ? "buy" : "sell";
    const summary = `${group.buys ? `买入 ${group.buys} 笔` : ""}${group.buys && group.sells ? " · " : ""}${group.sells ? `卖出 ${group.sells} 笔` : ""}`;
    const labels = group.orders.slice(0, 3).map((order) => `${order.side === "BUY" ? "买" : "卖"}${displayCode(order.code)}`).join("、");
    return `<g class="paper-trade-marker ${markerType}" transform="translate(${point[0].toFixed(1)} ${point[1].toFixed(1)})"><line x1="0" x2="0" y1="${pad.top - point[1]}" y2="${height - pad.bottom - point[1]}" /><circle r="5" /><text x="8" y="-7">${group.orders.length > 1 ? group.orders.length : ""}</text><title>${summary} · ${labels}${group.orders.length > 3 ? " 等" : ""}</title></g>`;
  }).join("");
  svg.innerHTML = `
    <rect x="0.5" y="0.5" width="859" height="319" rx="8" class="chart-board" />
    <text x="${pad.left}" y="24" class="chart-title">${formatPaperMoney(last)}</text>
    <text x="${pad.left + 128}" y="24" class="chart-subtitle ${profit >= 0 ? "paper-up" : "paper-down"}">${profit >= 0 ? "+" : ""}${formatPaperMoney(profit)} · ${formatPercent(returnPct)}</text>
    <text x="${width - pad.right}" y="24" text-anchor="end" class="chart-subtitle">收益曲线 · ${pointsRows.length} 条记录</text>
    ${tickMarkup}${timeMarkup}${lunchMarkup}${dayBoundaryMarkup}
    <line x1="${pad.left}" x2="${width - pad.right}" y1="${toY(baseline)}" y2="${toY(baseline)}" class="paper-baseline" />
    <text x="${width - pad.right}" y="${toY(baseline) - 6}" text-anchor="end" class="chart-label">起始 ${formatPaperMoney(baseline)}</text>
    <path d="${path}" class="paper-equity-line" />
    ${tradeMarkers}
    <circle cx="${points.at(-1)[0]}" cy="${points.at(-1)[1]}" r="4" class="paper-equity-dot" />
    <g class="paper-trade-legend"><circle cx="${pad.left}" cy="40" r="4" class="buy" /><text x="${pad.left + 9}" y="44">买入</text><circle cx="${pad.left + 58}" cy="40" r="4" class="sell" /><text x="${pad.left + 67}" y="44">卖出</text></g>
    <rect id="paperEquityTooltip" x="0" y="0" width="180" height="58" rx="4" class="paper-equity-tooltip" opacity="0" />
    <text id="paperEquityTooltipText1" x="0" y="0" class="paper-equity-tooltip-text" opacity="0"></text>
    <text id="paperEquityTooltipText2" x="0" y="0" class="paper-equity-tooltip-text" opacity="0"></text>
  `;
  svg.onmousemove = (event) => {
    const tooltip = svg.querySelector("#paperEquityTooltip");
    const text1 = svg.querySelector("#paperEquityTooltipText1");
    const text2 = svg.querySelector("#paperEquityTooltipText2");
    if (!tooltip || !text1 || !text2) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    if (x < pad.left || x > width - pad.right) { tooltip.setAttribute("opacity", "0"); text1.setAttribute("opacity", "0"); text2.setAttribute("opacity", "0"); return; }
    let index = clamp(Math.round((x - pad.left) / plotWidth * (values.length - 1)), 0, values.length - 1);
    if (isToday) {
      index = points.reduce((nearest, point, pointIndex) => Math.abs(point[0] - x) < Math.abs(points[nearest][0] - x) ? pointIndex : nearest, 0);
    }
    const point = points[index];
    const row = pointsRows[index].row;
    const tooltipWidth = 230;
    const tooltipHeight = 58;
    const boxX = clamp(point[0] > width - pad.right - tooltipWidth ? point[0] - tooltipWidth - 8 : point[0] + 10, pad.left + 4, width - pad.right - tooltipWidth - 4);
    const boxY = clamp(point[1] < pad.top + 72 ? point[1] + 10 : point[1] - tooltipHeight - 8, pad.top + 4, height - pad.bottom - tooltipHeight - 4);
    tooltip.setAttribute("width", tooltipWidth);
    tooltip.setAttribute("x", boxX); tooltip.setAttribute("y", boxY);
    text1.setAttribute("x", boxX + 10); text1.setAttribute("y", boxY + 22);
    text2.setAttribute("x", boxX + 10); text2.setAttribute("y", boxY + 42);
    text1.textContent = formatDateTime(row.created_at);
    const nearbyTrades = orders.filter((order) => Math.abs((paperTimestampMs(order.created_at) || 0) - (pointsRows[index].timestamp || 0)) < 10 * 60 * 1000);
    text2.textContent = `资产 ${formatPaperMoney(values[index])} · ${formatPercent(baseline ? (values[index] - baseline) / baseline * 100 : null)}${nearbyTrades.length ? ` · 操作 ${nearbyTrades.length} 笔` : ""}`;
    tooltip.setAttribute("opacity", "1"); text1.setAttribute("opacity", "1"); text2.setAttribute("opacity", "1");
  };
  svg.onmouseleave = () => svg.querySelectorAll("#paperEquityTooltip, #paperEquityTooltipText1, #paperEquityTooltipText2").forEach((item) => item.setAttribute("opacity", "0"));
  if (meta) meta.textContent = `起始 ${formatPaperMoney(baseline)} · 当前 ${formatPaperMoney(last)} · 最近 ${formatDateTime(pointsRows.at(-1).row.created_at)} · 标记 ${orders.length} 笔操作`;
}

function paperTimestampMs(value) {
  if (!value) return NaN;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function paperShanghaiDay(value) {
  const timestamp = paperTimestampMs(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}

function paperShanghaiMinutes(value) {
  const timestamp = paperTimestampMs(value);
  if (!Number.isFinite(timestamp)) return NaN;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : NaN;
}

function paperTimeToTradingX(value, left, right) {
  const minutes = paperShanghaiMinutes(value);
  return Number.isFinite(minutes) ? tradingMinuteToX(minutes, left, right) : left;
}

function isPaperLunchBreakBetween(previous, current) {
  const previousMinutes = paperShanghaiMinutes(previous?.created_at);
  const currentMinutes = paperShanghaiMinutes(current?.created_at);
  return Number.isFinite(previousMinutes) && Number.isFinite(currentMinutes)
    && previousMinutes <= 11 * 60 + 30 && currentMinutes >= 13 * 60;
}

async function runResearch() {
  const query = document.querySelector("#researchQuery")?.value.trim();
  const host = document.querySelector("#researchResult");
  document.querySelector("#researchSuggestions")?.setAttribute("hidden", "hidden");
  if (!query) {
    showToast("请输入代码或名称");
    return;
  }
  host.className = "research-result empty-state";
  host.textContent = "正在读取股票池与历史 K 线...";
  showProgress("正在开始研究", "正在读取实时数据和历史 K 线，请稍候。");
  try {
    const data = await postJson("/api/research/stock", {
      query,
      window: document.querySelector("#researchWindow")?.value || "month"
    });
    if (!data.ok) {
      host.textContent = data.message || "研究标的未找到";
      showToast(data.message || "研究标的未找到");
      return;
    }
    state.research = data.research;
    renderStockResearch(data.research);
    showToast("研究完成");
  } catch (error) {
    host.textContent = "研究请求失败，请稍后重试。";
    showToast("研究请求失败");
  } finally {
    hideProgress();
  }
}

function bindDraftControls() {
  document.querySelector("#wechatArticleType").addEventListener("change", () => {
    const session = articleTypeToSession(document.querySelector("#wechatArticleType").value);
    state.selectedWechatModules = new Set(sessionDefaults[session]?.modules || sessionDefaults.close.modules);
    renderWechatModulePicker();
  });
  document.querySelector("#generateDraft").addEventListener("click", async () => {
    const session = articleTypeToSession(document.querySelector("#wechatArticleType").value);
    const modules = [...document.querySelectorAll("#wechatModulePicker input:checked")].map((input) => input.value);
    const params = new URLSearchParams({
      ai: "1",
      session,
      articleType: document.querySelector("#wechatArticleType").value,
      style: document.querySelector("#wechatStyle").value,
      keywords: document.querySelector("#wechatKeywords").value,
      requirements: document.querySelector("#wechatRequirements").value,
      modules: modules.join(",")
    });
    showProgress("正在生成文章", "正在整理行情、关键词和公开资讯。");
    try {
      const data = await fetchJson(`/api/wechat/draft?${params.toString()}`);
      applyDraft(data);
      showToast("公众号文章已生成");
    } catch {
      showToast("文章生成失败，请稍后重试");
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#reviewDraft").addEventListener("click", async () => {
    const text = document.querySelector("#draftText").value;
    showProgress("正在检查文章", "正在检查荐股、收益承诺和数据表达。");
    try {
      const review = await postJson("/api/wechat/review", { text });
      state.currentReview = review;
      renderReview(review);
      showToast(review.passed ? "文章检查通过" : "发现需要改写的表达");
    } catch {
      showToast("文章检查失败，请稍后重试");
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#saveDraft").addEventListener("click", async () => {
    const markdown = document.querySelector("#draftText").value;
    const html = buildArticlePreviewHtml(markdown);
    const assetIds = getCurrentArticleAssetIds();
    showProgress("正在保存版本", "正在保存文章、审稿结果和已选素材。");
    try {
      const result = await postJson("/api/wechat/draft", {
        markdown,
        html,
        title: extractTitle(markdown),
        topic: document.querySelector("#wechatArticleType").value || "市场观察",
        articleType: document.querySelector("#wechatArticleType").value || "市场观察",
        assetIds
      });
      state.currentDraftId = result.draft?.id || state.currentDraftId;
      await loadDraftHistory();
      showToast("文章版本已保存");
    } catch {
      showToast("保存失败，请稍后重试");
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#copyDraft").addEventListener("click", async () => {
    const text = document.querySelector("#draftText").value;
    try {
      const html = buildArticlePreviewHtml(text);
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" })
        })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      showToast(state.currentArticleAssets.cover ? "文章和配图已复制；本地图片需在公众号后台上传" : "文章已复制，可粘贴到公众号后台");
    } catch {
      showToast("复制失败，请手动选择文章内容复制");
    }
  });
  document.querySelector("#generateVideo")?.addEventListener("click", generateVideoMaterial);
  document.querySelector("#generateBodyMarketImage")?.addEventListener("click", generateBodyMarketImage);
  document.querySelector("#draftText").addEventListener("input", () => {
    const markdown = document.querySelector("#draftText").value;
    renderDraftPreview(markdownToHtml(markdown));
  });
  document.querySelector("#addAsset").addEventListener("click", async () => {
    await postJson("/api/assets", {
      title: document.querySelector("#assetTitle").value,
      type: document.querySelector("#assetType").value,
      purpose: "公众号",
      source: "本地",
      local_path: document.querySelector("#assetPath").value,
      prompt: document.querySelector("#assetPrompt").value
    });
    document.querySelector("#assetTitle").value = "";
    document.querySelector("#assetPath").value = "";
    document.querySelector("#assetPrompt").value = "";
    await loadAssets();
    showToast("素材已登记");
  });
  document.querySelector("#addNews")?.addEventListener("click", async () => {
    await postJson("/api/news", {
      title: document.querySelector("#newsTitle").value,
      url: document.querySelector("#newsUrl").value,
      source: document.querySelector("#newsSource").value || "手动素材",
      category: document.querySelector("#newsCategory").value,
      summary: document.querySelector("#newsSummary").value,
      content: ""
    });
    ["#newsTitle", "#newsUrl", "#newsSource", "#newsSummary"].forEach((selector) => {
      const input = document.querySelector(selector);
      if (input) input.value = "";
    });
    await loadNewsItems();
    showToast("资讯素材已加入");
  });
}

async function generateBodyMarketImage() {
  const button = document.querySelector("#generateBodyMarketImage");
  const status = document.querySelector("#bodyImageStatus");
  const type = document.querySelector("#bodyImageType")?.value || "market-overview";
  if (!button) return;
  button.disabled = true;
  if (status) status.textContent = "正在绘制真实行情图...";
  showProgress("正在生成正文行情图", "正在使用当前页面真实数据绘制图片，不调用 AI 编造行情。", true);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 760;
    drawMarketImageCard(canvas, type);
    const result = await postJson("/api/assets/upload", {
      dataUrl: canvas.toDataURL("image/png"),
      title: bodyImageTitle(type),
      source: "本地真实行情",
      prompt: `正文行情图：${bodyImageTitle(type)}，数据时间${state.marketsUpdatedAt || "暂无数据"}`
    });
    if (!result.ok) throw new Error(result.message || "正文行情图保存失败");
    if (!state.currentArticleAssets.body.some((asset) => asset.id === result.asset.id)) state.currentArticleAssets.body.push(result.asset);
    await loadAssets();
    renderDraftPreview();
    renderAssets();
    if (status) status.textContent = `已加入当前文章 · ${getCurrentArticleAssetIds().length} 张图`;
    showToast("正文行情图已生成并插入文章预览");
  } catch (error) {
    if (status) status.textContent = "生成失败，请重试";
    showToast(error.message || "正文行情图生成失败");
  } finally {
    button.disabled = false;
    hideProgress();
  }
}

function bodyImageTitle(type) {
  return ({
    "market-overview": "A股行情全览",
    trend: "A股大盘趋势",
    "sector-flow": "A股板块资金",
    "etf-rank": "ETF强弱排行"
  }[type] || "正文行情图");
}

function drawMarketImageCard(canvas, type) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const bg = "#0b1218";
  const panel = "#111c24";
  const line = "#2a3b47";
  const text = "#e8edf0";
  const muted = "#8ea0ac";
  const up = "#ef5b5b";
  const down = "#31b989";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#f2b84b";
  ctx.fillRect(48, 44, 8, 58);
  ctx.fillStyle = text;
  ctx.font = "700 32px Microsoft YaHei, sans-serif";
  ctx.fillText(bodyImageTitle(type), 76, 72);
  ctx.fillStyle = muted;
  ctx.font = "16px Microsoft YaHei, sans-serif";
  ctx.fillText(`Komo Market · ${state.marketsUpdatedAt || "暂无更新时间"} · ${state.dataSource || "真实行情"}`, 76, 98);
  const rows = type === "sector-flow"
    ? state.sectorFlows.slice(0, 8).map((item) => ({ name: item.name, value: item.change_pct, extra: formatSectorMoneySigned(item.net_inflow) }))
    : type === "etf-rank"
      ? [...state.etfs].sort((a, b) => Number(b.change_pct || -Infinity) - Number(a.change_pct || -Infinity)).slice(0, 8).map((item) => ({ name: item.name || displayCode(item.code), value: item.change_pct, extra: formatMoney(item.amount) }))
      : state.markets.filter((item) => item.region === "A股" || !item.region).slice(0, 8).map((item) => ({ name: item.name, value: item.change_pct, extra: formatPrice(item.price) }));
  if (!rows.length) {
    ctx.fillStyle = muted;
    ctx.font = "24px Microsoft YaHei, sans-serif";
    ctx.fillText("暂无可用真实行情数据", 80, 260);
    return;
  }
  const left = 48;
  const top = 150;
  const rowHeight = 62;
  const chartWidth = width - 96;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (let i = 0; i <= rows.length; i += 1) {
    const y = top + i * rowHeight;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - left, y);
    ctx.stroke();
  }
  rows.forEach((row, index) => {
    const y = top + index * rowHeight + 39;
    const change = Number(row.value);
    const color = Number.isFinite(change) && change >= 0 ? up : down;
    ctx.fillStyle = text;
    ctx.font = "600 21px Microsoft YaHei, sans-serif";
    ctx.fillText(String(row.name || "暂无数据").slice(0, 18), left + 16, y);
    ctx.fillStyle = muted;
    ctx.font = "16px Microsoft YaHei, sans-serif";
    ctx.fillText(String(row.extra || "暂无数据"), left + 350, y);
    ctx.fillStyle = color;
    ctx.font = "700 22px Consolas, monospace";
    ctx.fillText(Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "暂无数据", width - 220, y);
    const barWidth = Number.isFinite(change) ? Math.min(Math.abs(change) * 24, 170) : 0;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.68;
    ctx.fillRect(left + 520, y - 18, barWidth, 8);
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = muted;
  ctx.font = "14px Microsoft YaHei, sans-serif";
  ctx.fillText("数据仅作公开市场信息整理，不构成投资建议", left, height - 34);
}

function bindSettingsControls() {
  document.querySelector("#saveSettings")?.addEventListener("click", saveSettings);
  document.querySelector("#backupData")?.addEventListener("click", async () => {
    showProgress("正在备份历史数据", "正在导出行情快照、历史K线、筛选记录和研究预估。");
    try {
      const result = await postJson("/api/data/backup", {});
      showToast(result.message || "历史数据备份完成");
    } catch {
      showToast("备份失败，请稍后重试");
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#checkFutu")?.addEventListener("click", async () => {
    showProgress("正在检查 Futu OpenD", "仅检测本机行情服务连接，不会调用交易接口。");
    try {
      const status = await fetchJson("/api/data/futu-status");
      showToast(`${status.status}：${status.message}`);
    } catch {
      showToast("Futu OpenD 状态检查失败");
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#checkSystemHealth")?.addEventListener("click", async () => {
    showProgress("正在检查运行状态", "检查数据新鲜度、SQLite、WAL、Futu 和自动模拟状态。", true);
    try {
      await loadSettings();
      showToast("运行状态已更新");
    } catch (error) {
      showToast(error.message || "运行状态检查失败");
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#testFeishu")?.addEventListener("click", async () => {
    showProgress("正在发送飞书测试", "仅发送一条测试卡片，不影响报告和模拟账户的去重状态。", true);
    try {
      const result = await postJson("/api/system/feishu/test", {});
      showToast(result.message || "飞书测试消息已发送");
      await loadSettings();
    } catch (error) {
      showToast(error.message || "飞书测试失败");
    } finally {
      hideProgress();
    }
  });
  document.querySelector("#runMaintenance")?.addEventListener("click", async () => {
    showProgress("正在检查维护任务", "交易时段只检查；非交易时段会清理过期盘中观察并尝试 WAL checkpoint。", true);
    try {
      const result = await postJson("/api/system/maintenance", { run: true });
      updateProgress("维护任务完成", result.result?.message || result.runtime?.message || "请查看最近维护记录");
      await loadSettings();
      showToast(result.executed ? "维护任务已完成" : "交易时段仅完成检查");
    } catch (error) {
      showToast(error.message || "维护任务失败");
    } finally {
      hideProgress();
    }
  });
  document.querySelectorAll(".model-preset").forEach((button) => {
    button.addEventListener("click", () => applyModelPreset(button.dataset.preset));
  });
  document.querySelectorAll(".refresh-scope").forEach((button) => {
    button.addEventListener("click", async () => {
      const scope = button.dataset.scope || "all";
      button.disabled = true;
      showProgress(`正在刷新${scopeLabel(scope)}`, `正在采集${scopeLabel(scope)}数据；完成后会自动重新读取页面。`, true);
      try {
        const result = await postJson(`/api/data/refresh?scope=${scope}`, {});
        updateProgress("采集完成，正在更新页面", result.saved?.length ? `已写入：${result.saved.join("、")}` : result.message);
        await refreshAll();
        showToast(result.ok ? `${scopeLabel(scope)}刷新完成` : `${scopeLabel(scope)}刷新失败：${result.message}`);
      } catch (error) {
        showToast(`${scopeLabel(scope)}刷新失败：${error.message || "继续使用最近数据"}`);
      } finally {
        button.disabled = false;
        hideProgress();
      }
    });
  });
}

function bindAdminControls() {
  if (state.auth?.role !== "admin") return;
  document.querySelector("#refreshAdminOverview")?.addEventListener("click", loadAdminOverview);
  document.querySelector("#adminAccountSearch")?.addEventListener("input", (event) => {
    state.adminAccountSearch = event.target.value.trim();
    if (state.adminOverview) renderAdminOverview(state.adminOverview);
  });
  document.querySelector("#adminAccountUserFilter")?.addEventListener("change", (event) => {
    state.adminAccountUser = event.target.value || "";
    if (state.adminOverview) renderAdminOverview(state.adminOverview);
  });
  document.querySelector("#adminAccountSort")?.addEventListener("change", (event) => {
    const [field, direction] = String(event.target.value || "updated_at:desc").split(":");
    state.adminAccountSort = { field, direction: direction || "desc" };
    if (state.adminOverview) renderAdminOverview(state.adminOverview);
  });
  document.querySelector("#adminAccounts")?.addEventListener("click", (event) => {
    const button = event.target.closest(".admin-account-view");
    if (!button) return;
    const item = (state.adminOverview?.accounts || []).find((row) => String(row.account?.id) === String(button.dataset.accountId));
    if (item) openAdminAccountDetail(item);
  });
  document.querySelector("#closeAdminAccountModal")?.addEventListener("click", closeAdminAccountModal);
  document.querySelector("#adminAccountModal")?.addEventListener("click", (event) => {
    if (event.target.id === "adminAccountModal") closeAdminAccountModal();
  });
  document.querySelector("#adminUsers")?.addEventListener("click", async (event) => {
    const editButton = event.target.closest(".admin-edit-user");
    if (editButton) {
      const user = (state.adminOverview?.users || []).find((item) => String(item.id) === String(editButton.dataset.id));
      if (user) openAdminMemberModal(user);
      return;
    }
    const deleteButton = event.target.closest(".admin-delete-user");
    const resetButton = event.target.closest(".admin-reset-password");
    if (resetButton) {
      const user = (state.adminOverview?.users || []).find((item) => String(item.id) === String(resetButton.dataset.id));
      if (!user || !window.confirm(`确定将成员“${user.username}”的密码重置为 123456 吗？`)) return;
      resetButton.disabled = true;
      try {
        const result = await postJson(`/api/admin/users/${user.id}/reset-password`, {});
        showToast(result.message || "密码已重置");
      } catch (error) {
        showToast(error.message || "密码重置失败");
        resetButton.disabled = false;
      }
      return;
    }
    if (!deleteButton) return;
    const user = (state.adminOverview?.users || []).find((item) => String(item.id) === String(deleteButton.dataset.id));
    if (!user || !window.confirm(`确定删除成员“${user.username}”吗？该成员的模拟账户、持仓、日志和资金曲线也会删除。`)) return;
    deleteButton.disabled = true;
    try {
      const result = await requestJson(`/api/admin/users/${user.id}`, "DELETE");
      showToast(result.message || "成员已删除");
      await loadAdminOverview();
    } catch (error) {
      showToast(error.message || "成员删除失败");
      deleteButton.disabled = false;
    }
  });
  document.querySelector("#closeAdminMemberModal")?.addEventListener("click", closeAdminMemberModal);
  document.querySelector("#cancelAdminMember")?.addEventListener("click", closeAdminMemberModal);
  document.querySelector("#adminMemberModal")?.addEventListener("click", (event) => {
    if (event.target.id === "adminMemberModal") closeAdminMemberModal();
  });
  document.querySelector("#toggleAdminPasswordEdit")?.addEventListener("click", () => {
    const editor = document.querySelector("#adminMemberPasswordEditor");
    if (!editor) return;
    editor.hidden = !editor.hidden;
    document.querySelector("#toggleAdminPasswordEdit").textContent = editor.hidden ? "修改密码" : "取消修改";
    if (!editor.hidden) document.querySelector("#adminMemberPassword")?.focus();
  });
  document.querySelector("#toggleAdminPasswordVisibility")?.addEventListener("click", () => {
    const password = document.querySelector("#adminMemberPassword");
    const confirm = document.querySelector("#adminMemberPasswordConfirm");
    const visible = password?.type === "text";
    if (password) password.type = visible ? "password" : "text";
    if (confirm) confirm.type = visible ? "password" : "text";
    document.querySelector("#toggleAdminPasswordVisibility").textContent = visible ? "显示密码" : "隐藏密码";
  });
  document.querySelector("#adminMemberForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = document.querySelector("#adminMemberId")?.value;
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const passwordEditor = document.querySelector("#adminMemberPasswordEditor");
      const password = passwordEditor?.hidden ? "" : document.querySelector("#adminMemberPassword").value;
      const passwordConfirm = passwordEditor?.hidden ? "" : document.querySelector("#adminMemberPasswordConfirm").value;
      if (passwordEditor && !passwordEditor.hidden && password !== passwordConfirm) throw new Error("两次输入的新密码不一致");
      const result = await requestJson(`/api/admin/users/${id}`, "PUT", { username: document.querySelector("#adminMemberUsername").value.trim(), password, active: document.querySelector("#adminMemberActive").checked });
      closeAdminMemberModal();
      showToast(result.message || "成员资料已更新");
      await loadAdminOverview();
    } catch (error) {
      showToast(error.message || "成员资料更新失败");
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector("#createMemberForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await postJson("/api/admin/users", { username: document.querySelector("#memberUsername").value.trim(), password: document.querySelector("#memberPassword").value });
      showToast(result.message || "成员账号已创建");
      event.target.reset();
      await loadAdminOverview();
    } catch (error) {
      showToast(error.message || "成员账号创建失败");
    }
  });
}

async function loadAdminOverview() {
  if (state.auth?.role !== "admin") return;
  try {
    const data = await fetchJson("/api/admin/overview");
    renderAdminOverview(data);
  } catch (error) {
    showToast(error.message || "成员状态读取失败");
  }
}

function renderAdminOverview(data = {}) {
  const usersHost = document.querySelector("#adminUsers");
  const accountsHost = document.querySelector("#adminAccounts");
  const userCount = document.querySelector("#adminUserCount");
  const users = data.users || [];
  state.adminOverview = data;
  const userFilter = document.querySelector("#adminAccountUserFilter");
  if (userFilter) {
    const usernames = [...new Set((data.accounts || []).map((item) => item.owner?.username).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const selected = usernames.includes(state.adminAccountUser) ? state.adminAccountUser : "";
    state.adminAccountUser = selected;
    userFilter.innerHTML = `<option value="">全部用户名</option>${usernames.map((username) => `<option value="${escapeHtml(username)}">${escapeHtml(username)}</option>`).join("")}`;
    userFilter.value = selected;
  }
  if (userCount) userCount.textContent = `${users.length} 人`;
  const userPage = paginate(users, state.adminUserPage, 5);
  state.adminUserPage = userPage.page;
  if (usersHost) usersHost.innerHTML = userPage.rows.map((user) => `<div class="admin-user-row"><div class="admin-user-identity"><span class="admin-user-avatar">${escapeHtml(String(user.username || "?").slice(0, 1).toUpperCase())}</span><div class="admin-user-main"><strong>${escapeHtml(user.username)}</strong><small>${user.role === "admin" ? "管理员" : "成员"} · 创建于 ${formatDateTime(user.created_at)}</small></div></div><div class="admin-user-state"><span class="status-pill ${user.active ? "status-live" : ""}">${user.active ? "可登录" : "已停用"}</span></div>${user.role !== "admin" ? `<div class="admin-user-actions"><button class="text-button admin-edit-user" type="button" data-id="${user.id}">编辑</button><button class="text-button admin-reset-password" type="button" data-id="${user.id}">重置密码</button><button class="text-button admin-toggle-user" type="button" data-id="${user.id}" data-active="${user.active ? "0" : "1"}">${user.active ? "停用" : "启用"}</button><button class="text-button danger-text admin-delete-user" type="button" data-id="${user.id}">删除</button></div>` : `<span class="status-pill">管理员保护</span>`}</div>`).join("") || `<div class="empty-state">暂无成员。</div>`;
  renderPager("#adminUserPager", userPage, (page) => {
    state.adminUserPage = page;
    renderAdminOverview(state.adminOverview);
  });
  usersHost?.querySelectorAll(".admin-toggle-user").forEach((button) => button.addEventListener("click", async () => {
    await postJson(`/api/admin/users/${button.dataset.id}/active`, { active: button.dataset.active === "1" });
    await loadAdminOverview();
  }));
  const search = state.adminAccountSearch.toLowerCase();
  const accountRows = (data.accounts || []).filter((item) => {
    if (state.adminAccountUser && item.owner?.username !== state.adminAccountUser) return false;
    if (!search) return true;
    const account = item.account || {};
    const auto = item.auto?.config || {};
    return [item.owner?.username, account.name, auto.strategy].some((value) => String(value || "").toLowerCase().includes(search));
  }).sort((left, right) => {
    const field = state.adminAccountSort.field;
    const value = (item) => {
      const account = item.account || {};
      if (field === "total_pnl") return Number(account.realized_pnl || 0) + Number(account.unrealized_pnl || 0);
      if (field === "positions") return item.positions?.length || 0;
      if (field === "orders") return item.orders?.length || 0;
      if (field === "updated_at") return new Date(account.updated_at || 0).getTime() || 0;
      return Number(account[field] || 0);
    };
    const delta = value(left) - value(right);
    return state.adminAccountSort.direction === "asc" ? delta : -delta;
  });
  const accountCount = document.querySelector("#adminAccountCount");
  if (accountCount) accountCount.textContent = `${accountRows.length}/${(data.accounts || []).length} 个账户`;
  const accountHeader = `<div class="admin-account-header" role="row"><span>用户名 / 账户</span><span>策略 / 状态</span><span>总资产</span><span>今日盈亏</span><span>累计收益</span><span>持仓</span><span>操作数</span><span>运行状态</span><span>查看</span></div>`;
  if (accountsHost) accountsHost.innerHTML = accountHeader + (accountRows.map((item) => {
    const account = item.account || {};
    const auto = item.auto?.config || {};
    const runtime = item.auto?.runtime || {};
    const pnl = Number(account.realized_pnl || 0) + Number(account.unrealized_pnl || 0);
    return `<article class="admin-account-card"><div class="admin-account-head"><strong>${escapeHtml(item.owner?.username || "未归属")}</strong><span>${escapeHtml(account.name || "模拟账号")}</span></div><div class="admin-account-head"><strong>${escapeHtml(auto.strategy || "未设置策略")}</strong><span class="status-pill ${auto.enabled ? "status-live" : ""}">${auto.enabled ? "自动运行" : "未开启"}</span></div><div class="admin-account-metrics"><span>总资产 <b>${formatPaperMoney(account.equity)}</b></span><span>今日盈亏 <b class="${Number(account.today_pnl) >= 0 ? "paper-up" : "paper-down"}">${formatPaperMoney(account.today_pnl)}</b></span><span>累计收益 <b class="${pnl >= 0 ? "paper-up" : "paper-down"}">${formatPaperMoney(pnl)}</b></span><span>持仓 <b>${item.positions?.length || 0} 个</b></span><span>操作 <b>${item.orders?.length || 0} 条</b></span></div><div class="admin-account-runtime">${escapeHtml(compactAdminRuntime(runtime.lastMessage, item.stream?.connected))}</div><button class="ghost-button admin-account-view" type="button" data-account-id="${account.id}">查看</button></article>`;
  }).join("") || `<div class="empty-state">${state.adminAccountUser || search ? "没有匹配的成员模拟账户。" : "暂无成员模拟账户。"}</div>`);
}

function compactAdminRuntime(message, connected) {
  const text = String(message || "等待运行");
  let summary = "等待运行";
  if (/没有满足条件/.test(text)) summary = "本轮无触发";
  else if (/自动完成\s*(\d+)\s*笔/.test(text)) summary = `本轮完成 ${text.match(/自动完成\s*(\d+)\s*笔/)?.[1] || ""} 笔`;
  else if (/达到今日最多/.test(text)) summary = "今日已达上限";
  else if (/熔断/.test(text)) summary = "已触发熔断";
  else if (/不在 A 股交易时段/.test(text)) summary = "非交易时段";
  else if (/异常|失败|不可用/.test(text)) summary = "运行异常";
  else if (/等待/.test(text)) summary = "等待运行";
  return `${summary} · ${connected ? "实时" : "最近数据"}`;
}

function openAdminAccountDetail(item, preservePages = false) {
  const modal = document.querySelector("#adminAccountModal");
  const body = document.querySelector("#adminAccountModalBody");
  if (!modal || !body) return;
  if (!preservePages) state.adminDetailPages = { positions: 1, orders: 1 };
  const account = item.account || {};
  const auto = item.auto?.config || {};
  const runtime = item.auto?.runtime || {};
  const orders = item.orders || [];
  const positions = item.positions || [];
  const displayPositions = buildPaperPositionDisplayRows(item.positions || [], item.todayPositions || []);
  const equity = item.equity || [];
  const pnl = Number(account.realized_pnl || 0) + Number(account.unrealized_pnl || 0);
  const todayPnl = Number(account.today_pnl);
  const todayReturnPct = Number(account.today_return_pct);
  const hasTodayBaseline = Number(account.today_equity_points || 0) > 0 && Number.isFinite(todayPnl) && Number.isFinite(todayReturnPct);
  const todayPnlClass = hasTodayBaseline && todayPnl < 0 ? "paper-down" : "paper-up";
  const todayReturnClass = hasTodayBaseline && todayReturnPct < 0 ? "paper-down" : "paper-up";
  const strategy = auto.strategy || "未设置策略";
  const conditionRows = Array.isArray(auto.conditions) ? auto.conditions : [];
  const watchlist = Array.isArray(auto.watchlist) ? auto.watchlist : [];
  const trendRows = equity.map((row) => ({ value: Number(row.equity), time: formatDateTime(row.created_at) })).filter((row) => Number.isFinite(row.value));
  const builtInRules = {
    trend: "涨跌幅 0.5% 至 5%，量比不低于 1；跌幅低于 -2% 风险退出。",
    short: "涨跌幅 1.5% 至 7%，量比不低于 1.5，换手率约 3% 至 18%。",
    long: "偏好量比不低于 0.7 的活跃标的，低频调仓；跌幅低于 -8% 风险退出。",
    conservative: "涨跌幅 0.2% 至 3%，量比不低于 0.8，换手率不超过 8%。",
    momentum: "涨跌幅 2% 至 7%，量比不低于 1.5，换手率约 3% 至 15%。",
    etf: "仅筛选 ETF，重点观察涨跌幅、量比和成交活跃度。",
    custom: "使用已保存的自定义条件，不自动补充其他筛选条件。"
  };
  const strategyMarkup = `<div class="admin-strategy-meta"><div>策略：<strong>${escapeHtml(strategy)}</strong></div><div>筛选组合：<strong>${auto.logic === "OR" ? "任一条件满足" : "全部条件满足"}</strong> · 范围：<strong>${escapeHtml(auto.market || "A股 + ETF")}</strong></div><div>运行频率：<strong>每 ${Math.round(Number(auto.intervalSeconds || 180) / 60)} 分钟</strong> · 总操作 ${Number(auto.maxActionsPerDay || 10)} 笔 · 买入 ${Number(auto.maxBuysPerDay || 10)} 笔 · 卖出 ${Number(auto.maxSellsPerDay || 10)} 笔 · 单日熔断 ${Number(auto.maxDailyLossPct || 3)}%</div><div>运行状态：<strong>${auto.enabled ? "自动运行" : "未开启"}</strong> · ${escapeHtml(runtime.lastMessage || "等待自动运行")}</div>${watchlist.length ? `<div>自选范围：<strong>${escapeHtml(watchlist.join("、"))}</strong></div>` : ""}</div>`;
  const screeningMarkup = `<div class="admin-screening-label">${conditionRows.length ? `已保存自定义条件 · ${conditionRows.length} 条` : "当前使用策略内置筛选"}</div>${conditionRows.length ? `<div class="admin-condition-chips">${conditionRows.map((condition) => `<span>${escapeHtml(describeAdminCondition(condition))}</span>`).join("")}</div>` : `<div class="admin-built-in-rule">${escapeHtml(builtInRules[auto.strategy] || builtInRules.trend)}</div>`}`;
  const positionPageSize = 5;
  const orderPageSize = 10;
  const positionTotalPages = Math.max(1, Math.ceil(displayPositions.length / positionPageSize));
  const orderTotalPages = Math.max(1, Math.ceil(orders.length / orderPageSize));
  state.adminDetailPages.positions = clamp(state.adminDetailPages.positions, 1, positionTotalPages);
  state.adminDetailPages.orders = clamp(state.adminDetailPages.orders, 1, orderTotalPages);
  const visiblePositions = displayPositions.slice((state.adminDetailPages.positions - 1) * positionPageSize, state.adminDetailPages.positions * positionPageSize);
  const visibleOrders = orders.slice((state.adminDetailPages.orders - 1) * orderPageSize, state.adminDetailPages.orders * orderPageSize);
  const positionMarkup = displayPositions.length ? `<div class="table-wrap"><table><thead><tr><th>状态</th><th>代码</th><th>名称</th><th>数量</th><th>成本</th><th>现价/卖出价</th><th>市值</th><th>盈亏</th><th>收益率</th></tr></thead><tbody>${visiblePositions.map((row) => { const holding = row.status !== "cleared"; const pnl = holding ? Number(row.unrealized_pnl || 0) : Number(row.realized_pnl || 0); const pnlClass = pnl >= 0 ? "paper-up" : "paper-down"; return `<tr><td><span class="paper-position-status ${holding ? "status-live" : "status-neutral"}">${escapeHtml(row.status_label || (holding ? "持有中" : "今日已清仓"))}</span></td><td>${displayCode(row.code)}</td><td>${escapeHtml(row.name)}</td><td>${holding ? row.quantity : 0}</td><td>${holding ? formatPaperPrice(row.avg_cost) : "--"}</td><td>${formatPaperPrice(row.last_price)}</td><td>${holding ? formatPaperMoney(row.market_value) : "0.00元"}</td><td class="${pnlClass}">${formatPaperMoney(pnl)}</td><td class="${pnlClass}">${Number.isFinite(Number(row.return_pct)) ? formatPercent(row.return_pct) : "--"}</td></tr>`; }).join("")}</tbody></table></div>${renderAdminDetailPager("positions", state.adminDetailPages.positions, positionTotalPages)}` : `<div class="admin-empty-log">暂无持仓。</div>`;
  const orderMarkup = orders.length ? `<div class="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>名称</th><th>代码</th><th>数量</th><th>价格</th><th>成交额</th><th>手续费</th><th>策略</th><th>理由</th></tr></thead><tbody>${visibleOrders.map((row) => `<tr><td>${formatDateTime(row.created_at)}</td><td class="${row.side === "BUY" ? "paper-up" : "paper-down"}">${row.side === "BUY" ? "模拟买入" : "模拟卖出"}</td><td>${escapeHtml(row.name || "暂无")}</td><td>${displayCode(row.code)}</td><td>${row.quantity}</td><td>${formatPaperPrice(row.price)}</td><td>${formatPaperMoney(row.amount)}</td><td>${formatPaperMoney(row.fee)}</td><td>${escapeHtml(row.strategy || "--")}</td><td>${escapeHtml(row.reason || "--")}</td></tr>`).join("")}</tbody></table></div>${renderAdminDetailPager("orders", state.adminDetailPages.orders, orderTotalPages)}` : `<div class="admin-empty-log">暂无操作日志。</div>`;
  document.querySelector("#adminAccountModalTitle").textContent = `${item.owner?.username || "未归属"} · ${account.name || "模拟账号"}`;
  body.innerHTML = `<section class="admin-detail-overview"><article><span>总资产</span><strong>${formatPaperMoney(account.equity)}</strong></article><article><span>当日盈亏</span><strong class="${todayPnlClass}">${hasTodayBaseline ? formatPaperMoney(todayPnl) : "暂无数据"}</strong><small>${hasTodayBaseline ? `今日基线 ${formatPaperMoney(account.today_baseline)}` : "暂无今日资金基线"}</small></article><article><span>当日收益率</span><strong class="${todayReturnClass}">${hasTodayBaseline ? formatPercent(todayReturnPct) : "暂无数据"}</strong><small>${hasTodayBaseline ? "按今日基线计算" : "暂无今日资金基线"}</small></article><article><span>累计收益</span><strong class="${pnl >= 0 ? "paper-up" : "paper-down"}">${formatPaperMoney(pnl)}</strong></article><article><span>累计收益率</span><strong class="${Number(account.return_pct) >= 0 ? "paper-up" : "paper-down"}">${formatPercent(account.return_pct)}</strong></article><article><span>数据状态</span><strong>${item.stream?.connected ? "Futu实时" : "最近数据"}</strong></article></section><section class="admin-detail-section"><h3>收益趋势</h3>${trendRows.length >= 2 ? renderMiniTrend(trendRows, "账户收益") : `<div class="admin-empty-log">暂无足够资金曲线数据。</div>`}</section><div class="admin-detail-grid"><section class="admin-detail-section"><h3>策略与自动交易</h3>${strategyMarkup}<div class="admin-detail-subsection"><h4>筛选条件</h4>${screeningMarkup}</div></section><section class="admin-detail-section"><h3>当前持仓 · ${displayPositions.length} 个 · 含今日已清仓 · 当前第 ${state.adminDetailPages.positions}/${positionTotalPages} 页</h3>${positionMarkup}</section></div><section class="admin-detail-section"><h3>操作日志 · ${orders.length} 条 · 当前第 ${state.adminDetailPages.orders}/${orderTotalPages} 页</h3>${orderMarkup}</section>`;
  body.querySelectorAll("[data-admin-detail-page]").forEach((button) => button.addEventListener("click", () => {
    state.adminDetailPages[button.dataset.adminDetailPage] = Number(button.dataset.page);
    openAdminAccountDetail(item, true);
  }));
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function closeAdminAccountModal() {
  const modal = document.querySelector("#adminAccountModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function openAdminMemberModal(user) {
  const modal = document.querySelector("#adminMemberModal");
  if (!modal) return;
  document.querySelector("#adminMemberId").value = user.id;
  document.querySelector("#adminMemberUsername").value = user.username || "";
  document.querySelector("#adminMemberPassword").value = "";
  document.querySelector("#adminMemberPasswordConfirm").value = "";
  document.querySelector("#adminMemberPassword").type = "password";
  document.querySelector("#adminMemberPasswordConfirm").type = "password";
  document.querySelector("#adminMemberPasswordEditor").hidden = true;
  document.querySelector("#toggleAdminPasswordEdit").textContent = "修改密码";
  document.querySelector("#toggleAdminPasswordVisibility").textContent = "显示密码";
  document.querySelector("#adminMemberActive").checked = Boolean(user.active);
  document.querySelector("#adminMemberModalTitle").textContent = `编辑成员 · ${user.username}`;
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.querySelector("#adminMemberUsername")?.focus();
}

function closeAdminMemberModal() {
  const modal = document.querySelector("#adminMemberModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function renderAdminDetailPager(kind, page, totalPages) {
  if (totalPages <= 1) return "";
  return `<div class="admin-detail-pager"><button class="ghost-button" type="button" data-admin-detail-page="${kind}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button><span>第 ${page} / ${totalPages} 页</span><button class="ghost-button" type="button" data-admin-detail-page="${kind}" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button></div>`;
}

function describeAdminCondition(condition = {}) {
  const label = fieldMeta[condition.field]?.label || condition.field || "条件";
  const operators = { between: "区间", contains: "包含", not_contains: "不包含", ">": ">", ">=": ">=", "<": "<", "<=": "<=", "=": "=" };
  const op = operators[condition.operator] || condition.operator || "";
  return condition.operator === "between" ? `${label} ${op} ${condition.value ?? ""}-${condition.value2 ?? ""}` : `${label} ${op} ${condition.value ?? ""}`;
}

function applyModelPreset(preset) {
  const set = (selector, value) => {
    const input = document.querySelector(selector);
    if (input) input.value = value;
  };
  if (preset === "agnes") {
    set("#aiProvider", "Agnes");
    set("#aiBaseUrl", "https://apihub.agnes-ai.com/v1");
    set("#aiModel", "agnes-2.0-flash");
  } else {
    set("#aiProvider", "Shanqu");
    set("#aiBaseUrl", "https://gw-ai.shanqu.cc/v1");
    set("#aiModel", "gpt-5.4");
  }
  set("#agnesProviderInput", "Agnes");
  set("#agnesBaseUrl", "https://apihub.agnes-ai.com/v1");
  set("#agnesModelInput", "agnes-2.0-flash");
  set("#imageProvider", "Agnes");
  set("#imageBaseUrl", "https://apihub.agnes-ai.com/v1");
  set("#imageModel", "agnes-image-2.0-flash");
  set("#videoProvider", "Agnes");
  set("#videoBaseUrl", "https://apihub.agnes-ai.com/v1");
  set("#videoModel", "agnes-video-2.0");
  showToast("模型方案已填入，点保存配置后生效");
}

async function saveSettings() {
  const value = (selector) => document.querySelector(selector)?.value || "";
  const payload = {
    ai: {
      provider: value("#aiProvider"),
      baseUrl: value("#aiBaseUrl"),
      model: value("#aiModel"),
      apiKey: value("#aiApiKey")
    }
  };
  const result = await postJson("/api/settings/config", payload);
  ["#aiApiKey"].forEach((selector) => {
    const input = document.querySelector(selector);
    if (input) input.value = "";
  });
  await loadSettings();
  showToast(result.message || "配置已保存");
}

function bindModalControls() {
  document.querySelector("#closeSectorModal")?.addEventListener("click", closeSectorModal);
  document.querySelector("#sectorModal")?.addEventListener("click", (event) => {
    if (event.target.id === "sectorModal") closeSectorModal();
  });
  document.querySelector("#closePaperStrategyModal")?.addEventListener("click", closePaperStrategyModal);
  document.querySelector("#paperStrategyModal")?.addEventListener("click", (event) => {
    if (event.target.id === "paperStrategyModal") closePaperStrategyModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeSectorModal();
    closePaperStrategyModal();
  });
}

function renderRegionTabs() {
  const regions = ["全部", ...state.markets.map((market) => market.region)];
  const host = document.querySelector("#regionTabs");
  host.innerHTML = regions.map((region) => `<button class="${region === state.selectedRegion ? "active" : ""}" data-region="${region}">${region}</button>`).join("");
  host.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRegion = button.dataset.region;
      if (state.selectedRegion !== "全部") selectRegionTrend(state.selectedRegion);
      renderRegionTabs();
      renderMarkets();
    });
  });
}

function renderWindowTabs() {
  const host = document.querySelector("#windowTabs");
  host.innerHTML = Object.entries(windowMap).map(([key, label]) => {
    const available = key === "today" || hasWindowData(key);
    return `<button class="${key === state.selectedWindow ? "active" : ""} ${available ? "" : "muted"}" data-window="${key}" title="${available ? "可用" : "读取历史K线；无数据则显示暂无"}">${label}</button>`;
  }).join("");
  host.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedWindow = button.dataset.window;
      renderWindowTabs();
      renderMarkets();
      renderWindowHint();
      const label = windowMap[state.selectedWindow] || "周期";
      if (state.selectedWindow === "today") {
        await loadSelectedHistoryTrend();
        showToast("已切换到今日分时");
        return;
      }
      showProgress(`正在读取${label}行情`, `正在读取真实历史 K 线，数据源响应可能需要几秒。`, true);
      try {
        await loadVisibleHistoryForWindow();
        await loadSelectedHistoryTrend();
        showToast(hasWindowData(state.selectedWindow) ? `已切换到${label} K 线` : `${label}暂无历史数据`);
      } finally {
        hideProgress();
      }
    });
  });
  renderWindowHint();
}

function renderMarkets() {
  const indexes = selectedIndexes()
    .map((item) => ({
      ...item,
      displayChange: windowChangeValue(item, state.selectedWindow),
      trend_score: trendScore(item.trend, windowChangeValue(item, state.selectedWindow))
    }))
    .sort((a, b) => {
      const field = state.marketSort === "change_pct" ? "displayChange" : state.marketSort;
      return compareValues(a[field], b[field], "desc", field);
    });

  renderTemperature(indexes);
  renderIndexGrid(indexes);
  renderASharePulse(indexes);
  renderMarketBrief(indexes);
  renderRankingSplit(indexes);
  renderMarketRhythm(indexes);
  renderHomeCoreIndexes(indexes);
  renderHomeSummaries(indexes);
  renderFullMarketSummary(indexes);
}

function renderFullMarketSummary(indexes = selectedIndexes()) {
  const host = document.querySelector("#marketFullSummary");
  if (!host) return;
  const aShare = indexes.filter((item) => item.region === "A股").length;
  const etfCount = state.etfs.length;
  const sectorCounts = state.sectorFlows.reduce((result, item) => {
    const type = item.type || "industry";
    result[type] = (result[type] || 0) + 1;
    return result;
  }, {});
  const historyRows = state.dataCompleteness?.modules?.find((item) => item.key === "history")?.rows;
  host.innerHTML = [
    ["A股指数", `${aShare} 个`, "主视角"],
    ["ETF", `${etfCount} 个`, state.etfSource || "真实行情"],
    ["行业板块", `${sectorCounts.industry || 0} 个`, "资金字段优先"],
    ["概念 / 主题", `${sectorCounts.concept || 0} / ${sectorCounts.theme || 0} 个`, "字段按源显示"],
    ["历史K线", historyRows ? `${formatNumber(historyRows)} 条` : "暂无", "真实历史数据"]
  ].map(([label, value, note]) => `<article><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
}

function renderHomeCoreIndexes(indexes) {
  const host = document.querySelector("#homeCoreIndexes");
  if (!host) return;
  const rows = indexes.filter((item) => item.region === "A股");
  const overseas = indexes.filter((item) => item.region !== "A股");
  const renderCore = (item) => `<button class="core-index ${Number(item.displayChange) >= 0 ? "up" : "down"} ${item.code === state.selectedTrend ? "active" : ""}" data-code="${escapeHtml(item.code)}">
    <span>${escapeHtml(item.name)}</span><strong>${formatPercent(item.displayChange)}</strong><small>${formatIndexPoint(item.value)} 点 · ${displayCode(item.code)}</small>
  </button>`;
  const renderPeripheral = (item) => `<button class="home-peripheral-index ${Number(item.displayChange) >= 0 ? "up" : "down"} ${item.code === state.selectedTrend ? "active" : ""}" data-code="${escapeHtml(item.code)}">
    <span>${escapeHtml(item.name)}</span><strong>${formatPercent(item.displayChange)}</strong><small>${escapeHtml(item.region || "海外")}</small>
  </button>`;
  host.innerHTML = `${rows.length ? `<section class="home-index-group"><div class="home-index-group-title"><strong>A股指数</strong><span>${rows.length} 个</span></div><div class="home-index-card-grid">${rows.map(renderCore).join("")}</div></section>` : `<div class="empty-state">暂无 A 股指数数据</div>`}
    ${overseas.length ? `<section class="home-index-group peripheral-home-index-group"><div class="home-index-group-title"><strong>海外辅助</strong><span>${overseas.length} 个</span></div><div class="home-peripheral-grid">${overseas.map(renderPeripheral).join("")}</div></section>` : ""}`;
  host.querySelectorAll("[data-code]").forEach((button) => button.addEventListener("click", async () => {
    state.selectedTrend = button.dataset.code;
    renderTrendSelect();
    renderMarkets();
    await loadSelectedHistoryTrend();
  }));
}

function renderHomeSummaries(indexes) {
  const sectorHost = document.querySelector("#homeSectorSummary");
  const etfHost = document.querySelector("#homeEtfSummary");
  const globalHost = document.querySelector("#homeGlobalSummary");
  if (sectorHost) sectorHost.innerHTML = topRows(state.sectorFlows, "net_inflow", 4, (item) => `${escapeHtml(item.name)}<b>${formatPercent(item.change_pct)}</b><small>${formatSectorMoneySigned(item.net_inflow)}</small>`);
  if (etfHost) etfHost.innerHTML = topRows(state.etfs, "change_pct", 4, (item) => `${escapeHtml(item.name)}<b>${formatPercent(item.change_pct)}</b><small>${formatMoney(item.amount)}</small>`);
  if (globalHost) globalHost.innerHTML = topRows(indexes.filter((item) => item.region !== "A股"), "displayChange", 4, (item) => `${escapeHtml(item.name)}<b>${formatPercent(item.displayChange)}</b><small>${escapeHtml(item.region || "海外")}</small>`);
}

function topRows(rows, sortField, limit, render) {
  const sorted = [...(rows || [])].sort((a, b) => Number(b[sortField] ?? -Infinity) - Number(a[sortField] ?? -Infinity)).slice(0, limit);
  return sorted.length ? sorted.map((item) => `<div class="summary-row">${render(item)}</div>`).join("") : `<div class="empty-state">暂无数据</div>`;
}

function renderWindowHint() {
  const host = document.querySelector("#windowHint");
  if (!host) return;
  const label = windowMap[state.selectedWindow] || "周期";
  const isRealWindow = state.selectedWindow === "today" || hasWindowData(state.selectedWindow);
  host.innerHTML = isRealWindow
    ? `<strong>${label}</strong><span>当前可用。趋势图由本地行情记录累积生成。</span>`
    : `<strong>${label}历史数据</strong><span>趋势图会读取历史 K 线；没有数据时显示暂无历史数据，不沿用实时涨跌。</span>`;
}

function renderMarketBrief(indexes) {
  const host = document.querySelector("#marketBrief");
  if (!host) return;
  const sorted = [...indexes].sort((a, b) => Number(b.displayChange || 0) - Number(a.displayChange || 0));
  const strongest = sorted[0];
  const weakest = sorted.at(-1);
  const upCount = indexes.filter((item) => Number(item.displayChange) >= 0).length;
  const downCount = indexes.length - upCount;
  const topFlow = [...state.sectorFlows].sort((a, b) => Number(b.net_inflow || 0) - Number(a.net_inflow || 0))[0];
  host.innerHTML = `
    <article>
      <span>市场强弱</span>
      <strong>${upCount}涨 / ${downCount}跌</strong>
      <small>${strongest ? `领涨 ${strongest.name} ${formatPercent(strongest.displayChange)}` : "暂无指数数据"}</small>
    </article>
    <article>
      <span>弱势观察</span>
      <strong>${weakest ? weakest.name : "--"}</strong>
      <small>${weakest ? formatPercent(weakest.displayChange) : "暂无数据"}</small>
    </article>
    <article>
      <span>资金线索</span>
      <strong>${topFlow ? topFlow.name : "暂无板块"}</strong>
      <small>${topFlow ? `净流入 ${formatSectorMoneySigned(topFlow.net_inflow)}` : "等待板块资金刷新"}</small>
    </article>
    <article>
      <span>更新时间</span>
      <strong>${formatDateTime(state.marketsUpdatedAt || indexes[0]?.updated_at)}</strong>
      <small>自动同步中</small>
    </article>
  `;
}

function renderMarketRhythm(indexes) {
  const host = document.querySelector("#marketRhythm");
  if (!host) return;
  const statusText = state.workflow?.sources?.length
    ? state.workflow.sources.map((item) => `${cleanMarketText(item.sourceName)}:${item.ok ? "可用" : "异常"}${item.rows ? ` ${item.rows}条` : ""}`).join(" / ")
    : "等待数据源状态";
  const strongestSector = [...state.sectorFlows].sort((a, b) => Number(b.change_pct || 0) - Number(a.change_pct || 0))[0];
  const topEtf = [...state.etfs].sort((a, b) => Number(b.change_pct || 0) - Number(a.change_pct || 0))[0];
  const aShare = indexes.filter((item) => item.region === "A股");
  const mainIndex = aShare[0] || indexes[0];
  host.innerHTML = `
    <div><b>同步</b><span>指数约1分钟；ETF/板块约3分钟；失败时保留最近数据</span></div>
    <div><b>主盘</b><span>${mainIndex ? `${mainIndex.name} ${formatPercent(mainIndex.displayChange)}` : "暂无指数数据"}</span></div>
    <div><b>板块</b><span>${strongestSector ? `${strongestSector.name} ${formatPercent(strongestSector.change_pct)}，净流入${formatSectorMoneySigned(strongestSector.net_inflow)}` : "暂无板块资金"}</span></div>
    <div><b>ETF</b><span>${topEtf ? `${topEtf.name} ${formatPercent(topEtf.change_pct)}，成交额${formatMoney(topEtf.amount)}` : "暂无ETF数据"}</span></div>
    <div><b>来源</b><span>${escapeHtml(statusText)}</span></div>
  `;
}

function renderRankingSplit(indexes) {
  const host = document.querySelector("#rankingSplit");
  if (!host) return;
  const aShareStocks = state.allStocks
    .filter((item) => Number.isFinite(Number(item.change_pct)))
    .map((item) => ({
      code: item.code,
      name: item.name,
      value: item.price,
      change: Number(item.change_pct),
      meta: item.sector || item.update_time || "A股"
    }));
  const aShareIndexes = indexes
    .filter((item) => item.region === "A股" && Number.isFinite(Number(item.displayChange)))
    .map((item) => ({
      code: item.code,
      name: item.name,
      value: item.value,
      change: Number(item.displayChange),
      meta: "A股指数"
    }));
  const source = aShareStocks.length >= 10 ? aShareStocks : [...aShareStocks, ...aShareIndexes];
  const top = [...source].sort((a, b) => b.change - a.change).slice(0, 5);
  const bottom = [...source].sort((a, b) => a.change - b.change).slice(0, 5);
  const renderRows = (items) => items.length
    ? items.map((item, index) => {
      const direction = item.change >= 0 ? "up" : "down";
      return `
        <button class="ranking-row ${direction}" data-code="${escapeHtml(item.code || "")}">
          <span class="rank-no">${index + 1}</span>
          <span class="rank-name"><b>${escapeHtml(item.name || "--")}</b><small>${displayCode(item.code || item.meta || "--")}</small></span>
          <span class="rank-meta">${escapeHtml(item.meta || "--")}</span>
          <strong>${formatPercent(item.change)}</strong>
        </button>
      `;
    }).join("")
    : `<div class="empty-state">暂无 A股涨跌排行数据。</div>`;

  host.innerHTML = `
    <article class="ranking-panel gainers">
      <div class="ranking-head">
        <h2>A股涨幅前五</h2>
        <span>${aShareStocks.length ? "股票池" : "指数口径"}</span>
      </div>
      <div class="ranking-list">${renderRows(top)}</div>
    </article>
    <article class="ranking-panel losers">
      <div class="ranking-head">
        <h2>A股跌幅前五</h2>
        <span>${aShareStocks.length ? "股票池" : "指数口径"}</span>
      </div>
      <div class="ranking-list">${renderRows(bottom)}</div>
    </article>
  `;

  host.querySelectorAll(".ranking-row").forEach((row) => {
    row.addEventListener("click", () => {
      const code = row.dataset.code;
      if (!code || !state.trends.some((trend) => trend.code === code)) return;
      state.selectedTrend = code;
      renderTrendSelect();
      renderTrendChart();
      renderMarkets();
    });
  });
}

function renderTrendSelect() {
  const host = document.querySelector("#trendSelect");
  const hasSelected = state.trends.some((item) => item.code === state.selectedTrend);
  host.innerHTML = [
    ...state.trends.map((item) => `<option value="${item.code}" ${item.code === state.selectedTrend ? "selected" : ""}>${item.name}</option>`),
    hasSelected ? "" : `<option value="${state.selectedTrend}" selected>暂无趋势数据</option>`
  ].join("");
}

async function loadSelectedHistoryTrend() {
  if (!state.selectedTrend || state.selectedWindow === "today") {
    if (state.todayTrends.length) {
      state.trends = state.todayTrends;
      renderTrendSelect();
    }
    renderTrendChart();
    return;
  }
  const item = selectedIndexes().find((index) => index.code === state.selectedTrend) || state.trends.find((trend) => trend.code === state.selectedTrend);
  const type = historyTypeForCode(state.selectedTrend, item?.region);
  try {
    const data = await fetchJson(`/api/history?type=${encodeURIComponent(type)}&code=${encodeURIComponent(state.selectedTrend)}&window=${encodeURIComponent(state.selectedWindow)}`);
    const series = buildHistorySeries(data, item, state.selectedTrend);
    state.historyCache.set(`${state.selectedWindow}:${state.selectedTrend}`, series);
    state.trends = [series, ...state.trends.filter((trend) => trend.code !== state.selectedTrend)];
    state.trendSource = data.source || "历史行情";
    renderTrendSelect();
    renderTrendChart();
    renderMarkets();
  } catch {
    state.trends = [{ name: item?.name || state.selectedTrend, code: state.selectedTrend, points: [], historyStatus: "empty" }, ...state.trends.filter((trend) => trend.code !== state.selectedTrend)];
    renderTrendChart();
  }
}

async function loadVisibleHistoryForWindow() {
  if (state.selectedWindow === "today") {
    renderMarkets();
    return;
  }
  const indexes = selectedIndexes().slice(0, 24);
  await Promise.all(indexes.map(async (item) => {
    const cacheKey = `${state.selectedWindow}:${item.code}`;
    if (state.historyCache.has(cacheKey)) return;
    try {
      const type = historyTypeForCode(item.code, item.region);
      const data = await fetchJson(`/api/history?type=${encodeURIComponent(type)}&code=${encodeURIComponent(item.code)}&window=${encodeURIComponent(state.selectedWindow)}`);
      state.historyCache.set(cacheKey, buildHistorySeries(data, item, item.code));
    } catch {
      state.historyCache.set(cacheKey, { name: item.name, code: item.code, region: item.region, points: [], historyStatus: "empty", source_name: "暂无历史数据" });
    }
  }));
  renderWindowTabs();
  renderMarkets();
}

function buildHistorySeries(data, item, code) {
  return {
    name: item?.name || data.code || code,
    code,
    region: item?.region || "",
    points: (data.points || []).map((point) => ({ time: point.time, value: point.close ?? point.value, ...point })),
    historyStatus: data.status,
    source_name: data.source
  };
}

function historyTypeForCode(code, region = "") {
  if (state.etfs.some((item) => item.code === code)) return "etf";
  if (state.sectorFlows.some((item) => item.name === code)) return "sector";
  return "index";
}

function renderTrendChart() {
  const svg = document.querySelector("#trendChart");
  svg.setAttribute("viewBox", "0 0 860 430");
  const selected = state.trends.find((item) => item.code === state.selectedTrend);
  if (!selected || !Array.isArray(selected.points) || selected.points.length < 2) {
    const index = selectedIndexes().find((item) => item.code === state.selectedTrend);
    document.querySelector("#trendMeta").textContent = index
      ? `${index.name} · ${displayCode(index.code)} · 趋势数据不足`
      : "趋势数据不足";
    const latestPoint = selected?.points?.at(-1);
    if (state.selectedWindow === "today") {
      renderTodayEmptyChart(svg, index, latestPoint);
      return;
    }
    svg.innerHTML = `
      <g class="empty-chart">
        <rect x="1" y="1" width="858" height="428" rx="8" />
        <text x="430" y="185" text-anchor="middle">趋势数据不足，暂不绘制趋势线</text>
        <text x="430" y="217" text-anchor="middle">${index ? `${index.name} · ${displayCode(index.code)}` : "请切换其他标的"}</text>
        <text x="430" y="247" text-anchor="middle">${latestPoint ? `最新 ${formatNumber(latestPoint.value)} · ${latestPoint.time}` : "刷新几次后会形成趋势"}</text>
      </g>
    `;
    return;
  }

  const chartPoints = prepareChartPoints(selected.points, state.selectedWindow);
  if (chartPoints.length < 2) {
    const index = selectedIndexes().find((item) => item.code === state.selectedTrend);
    document.querySelector("#trendMeta").textContent = `${selected.name || index?.name || "当前标的"} · ${displayCode(selected.code)} · 当前周期暂无足够真实记录`;
    document.querySelector("#chartDataHint").textContent = state.selectedWindow === "today" ? "等待盘中快照" : "暂无该周期历史行情，不沿用其他周期数据";
    svg.innerHTML = `
      <g class="empty-chart">
        <rect x="1" y="1" width="858" height="428" rx="8" />
        <text x="430" y="190" text-anchor="middle">当前周期暂无足够趋势数据</text>
        <text x="430" y="222" text-anchor="middle">${escapeHtml(selected.name || index?.name || "当前标的")} · ${escapeHtml(windowMap[state.selectedWindow] || "今日")}</text>
        <text x="430" y="254" text-anchor="middle">请刷新数据或切换到有历史记录的周期</text>
      </g>`;
    return;
  }
  const hasOhlc = chartPoints.filter((point) => [point.open, point.high, point.low, point.close].every((value) => Number.isFinite(Number(value)))).length >= 2;
  const wantsCandle = state.chartMode === "candle" || (state.chartMode === "auto" && state.selectedWindow !== "today");
  if (wantsCandle && state.selectedWindow !== "today" && hasOhlc) {
    renderCandlestickChart(selected, chartPoints);
    return;
  }
  const width = 860;
  const height = 430;
  const pad = { left: 58, right: 86, top: 92, bottom: 46 };
  const volumeTop = 326;
  const volumeHeight = 58;
  const plotHeight = volumeTop - pad.top - 22;
  const plotBottom = pad.top + plotHeight;
  const values = chartPoints.map((point) => point.value);
  const latest = chartPoints.at(-1);
  const first = chartPoints[0];
  const currentIndex = selectedIndexes().find((item) => item.code === selected.code);
  const sourceChange = Number(currentIndex?.change_pct ?? latest.change_pct);
  const hasSourceChange = state.selectedWindow === "today" && Number.isFinite(sourceChange);
  const baselineValue = hasSourceChange ? latest.value / (1 + sourceChange / 100) : first.value;
  const rawMin = Math.min(...values, baselineValue);
  const rawMax = Math.max(...values, baselineValue);
  const padding = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.0008);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const range = max - min || 1;
  const hasTradingTimes = state.selectedWindow === "today" && chartPoints.some((point) => Number.isFinite(timeToTradingX(point.market_time || point.fetched_at || point.time, pad.left, width - pad.right)));
  const useTodaySequence = state.selectedWindow === "today" && !hasTradingTimes;
  const toX = state.selectedWindow === "today" && !useTodaySequence
    ? (index) => timeToTradingX(chartPoints[index]?.market_time || chartPoints[index]?.fetched_at || chartPoints[index]?.time, pad.left, width - pad.right)
    : (index) => pad.left + (index / Math.max(chartPoints.length - 1, 1)) * (width - pad.left - pad.right);
  const toY = (value) => pad.top + (1 - (value - min) / range) * plotHeight;
  const points = chartPoints.map((point, index) => [toX(index), toY(point.value)]);
  const line = points.map(([x, y], index) => {
    const previous = chartPoints[index - 1];
    const breakForLunch = previous && isLunchBreakBetween(previous, chartPoints[index]);
    return `${index === 0 || breakForLunch ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const area = state.selectedWindow === "today" ? "" : `${line} L ${points.at(-1)[0].toFixed(1)} ${plotBottom.toFixed(1)} L ${points[0][0].toFixed(1)} ${plotBottom.toFixed(1)} Z`;
  const change = hasSourceChange ? sourceChange : ((latest.value - first.value) / first.value) * 100;
  const changePoint = latest.value - baselineValue;
  const direction = change >= 0 ? "up" : "down";
  const baseY = toY(baselineValue);
  const maValues = movingAverage(values, Math.min(5, values.length));
  const maPoints = maValues.map((value, index) => [toX(index), toY(value)]);
  const maLine = maPoints.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const maxDelta = Math.max(...values.map((value, index) => Math.abs(value - (values[index - 1] ?? value))), 1);
  const high = rawMax;
  const low = rawMin;
  const gridTicks = [0, 1, 2, 3, 4, 5];
  const timeTicks = buildTimeTicks(chartPoints.length, state.selectedWindow);
  const tradingMarkers = state.selectedWindow === "today" ? tradingTimeMarkers(pad.left, width - pad.right) : [];

  const todayMode = state.selectedWindow === "today" ? (useTodaySequence ? "快照序列" : "盘中时间") : windowMap[state.selectedWindow];
  const firstTradingMinutes = tradingPointMinutes(chartPoints[0]);
  const todayCoverage = state.selectedWindow === "today"
    ? `${firstTradingMinutes <= 9 * 60 + 30 ? "开盘有采样" : "开盘暂无采样"} · ${chartPoints.some((point) => tradingPointMinutes(point) <= 11 * 60 + 30) ? "上午有数据" : "上午暂无采样"} · ${chartPoints.some((point) => tradingPointMinutes(point) >= 13 * 60) ? "下午有数据" : "下午暂无采样"}`
    : "";
  document.querySelector("#trendMeta").textContent = `${selected.name} · ${displayCode(selected.code)} · ${selected.points.length}条记录 · ${todayMode} ${formatPercent(change)}`;
  document.querySelector("#chartDataHint").textContent = state.selectedWindow === "today"
    ? `真实分时 · ${selected.source_name || state.trendSource} · ${todayCoverage} · ${chartPoints.length} 个有效时间点`
    : `收盘价折线 · ${selected.source_name || state.trendSource} · 可切换 K 线`;
  svg.innerHTML = `
    <g class="stock-chart ${direction}">
      <defs>
        <linearGradient id="chartFillGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.22" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <rect class="chart-board" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" />
      <rect class="quote-strip" x="1" y="1" width="${width - 2}" height="74" rx="8" />
      <text class="chart-title" x="18" y="28">${escapeHtml(selected.name)}</text>
      <text class="chart-subtitle" x="18" y="52">${escapeHtml(displayCode(selected.code))}</text>
      <text class="quote-price ${direction}" x="148" y="43">${formatIndexPoint(latest.value)}</text>
      <text class="quote-change ${direction}" x="318" y="31">${formatIndexPointSigned(changePoint)}</text>
      <text class="quote-change ${direction}" x="318" y="55">${formatPercent(change)}</text>
      <g class="quote-metrics">
        <text x="455" y="31">${state.selectedWindow === "today" ? "昨收" : "起始"} ${formatIndexPoint(baselineValue)}</text>
        <text x="455" y="55">均线 ${formatIndexPoint(maValues.at(-1) ?? latest.value)}</text>
        <text x="595" y="31">最高 ${formatIndexPoint(high)}</text>
        <text x="595" y="55">最低 ${formatIndexPoint(low)}</text>
        <text x="730" y="31">记录 ${selected.points.length}条</text>
        <text x="730" y="55">${state.selectedWindow === "today" ? todayMode : `显示 ${chartPoints.length}点`}</text>
      </g>
      <rect class="main-plot" x="${pad.left}" y="${pad.top}" width="${width - pad.left - pad.right}" height="${plotHeight}" />
      <rect class="volume-plot" x="${pad.left}" y="${volumeTop}" width="${width - pad.left - pad.right}" height="${volumeHeight}" />
      ${gridTicks.map((tick) => {
        const y = pad.top + tick * (plotHeight / (gridTicks.length - 1));
        const value = max - tick * (range / (gridTicks.length - 1));
        return `
          <line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" />
          <text class="chart-axis left-axis" x="${pad.left - 8}" y="${y + 4}" text-anchor="end">${formatPercent(((value - baselineValue) / baselineValue) * 100)}</text>
          <text class="chart-axis" x="${width - pad.right + 8}" y="${y + 4}">${formatIndexPoint(value)}</text>
        `;
      }).join("")}
      ${timeTicks.map((index) => {
        const x = toX(index);
        const label = chartPoints[index]?.time || "";
        return `
          <line class="chart-grid vertical" x1="${x}" x2="${x}" y1="${pad.top}" y2="${volumeTop + volumeHeight}" />
          <text class="chart-label" x="${x}" y="${height - 20}" text-anchor="middle">${formatChartTime(label)}</text>
        `;
      }).join("")}
      <line class="session-marker lunch-marker" x1="${tradingLunchBounds(pad.left, width - pad.right).centerX}" x2="${tradingLunchBounds(pad.left, width - pad.right).centerX}" y1="${pad.top}" y2="${volumeTop + volumeHeight}" />
      <text class="lunch-label" x="${tradingLunchBounds(pad.left, width - pad.right).centerX}" y="${pad.top + 16}" text-anchor="middle">午休 11:30 / 13:00</text>
      ${tradingMarkers.filter((marker) => marker.kind !== "lunch").map((marker) => `
        <line class="session-marker" x1="${marker.x}" x2="${marker.x}" y1="${pad.top}" y2="${volumeTop + volumeHeight}" />
        <text class="session-label" x="${marker.x}" y="${pad.top - 10}" text-anchor="${marker.anchor}">${marker.label}</text>
      `).join("")}
      ${state.selectedWindow === "today" && useTodaySequence ? `<text class="chart-label" x="${width - pad.right}" y="${height - 20}" text-anchor="end">快照时间集中，按记录顺序展开</text>` : ""}
      <line class="chart-base" x1="${pad.left}" x2="${width - pad.right}" y1="${baseY}" y2="${baseY}" />
      <text class="baseline-label" x="${pad.left + 6}" y="${baseY - 6}">${state.selectedWindow === "today" ? "昨收线" : "起始线"}</text>
      ${area ? `<path class="chart-area" d="${area}" />` : ""}
      <path class="chart-line" d="${line}" />
      <path class="chart-ma" d="${maLine}" />
      ${points.map(([x, y], index) => index % Math.max(1, Math.ceil(points.length / 24)) === 0 || index === points.length - 1
        ? `<circle class="chart-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" />`
        : "").join("")}
      <circle class="chart-last-dot" cx="${points.at(-1)[0]}" cy="${points.at(-1)[1]}" r="4" />
      <g class="price-tag ${direction}">
        <rect x="${width - pad.right + 4}" y="${points.at(-1)[1] - 12}" width="82" height="24" rx="4" />
        <text x="${width - pad.right + 45}" y="${points.at(-1)[1] + 4}" text-anchor="middle">${formatIndexPoint(latest.value)}</text>
      </g>
      <text class="chart-label volume-title" x="${pad.left}" y="${volumeTop - 8}">价格变化柱 · 仅基于已有记录</text>
      ${chartPoints.map((point, index) => {
        const prev = chartPoints[index - 1]?.value ?? point.value;
        const delta = point.value - prev;
        const barHeight = Math.max(2, Math.abs(delta) / maxDelta * volumeHeight);
        const x = toX(index) - 2.5;
        const y = volumeTop + volumeHeight - barHeight;
        const cls = delta >= 0 ? "up" : "down";
        return `<rect class="volume-bar ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="5" height="${barHeight.toFixed(1)}" />`;
      }).join("")}
      <g id="trendCrosshair" class="crosshair" opacity="0">
        <line id="crosshairX" x1="0" x2="0" y1="${pad.top}" y2="${volumeTop + volumeHeight}" />
        <line id="crosshairY" x1="${pad.left}" x2="${width - pad.right}" y1="0" y2="0" />
        <rect id="crosshairBox" x="0" y="0" width="126" height="44" rx="5" />
        <text id="crosshairText1" x="0" y="0"></text>
        <text id="crosshairText2" x="0" y="0"></text>
      </g>
      <rect class="chart-hit-area" x="${pad.left}" y="${pad.top}" width="${width - pad.left - pad.right}" height="${volumeTop + volumeHeight - pad.top}" />
    </g>
  `;
  bindTrendCrosshair(svg, { ...selected, points: chartPoints, isToday: state.selectedWindow === "today" }, points, pad, width, height);
}

function renderCandlestickChart(selected, chartPoints) {
  const svg = document.querySelector("#trendChart");
  const width = 860;
  const height = 430;
  const pad = { left: 58, right: 86, top: 92, bottom: 46 };
  const volumeTop = 326;
  const volumeHeight = 58;
  const plotHeight = volumeTop - pad.top - 22;
  const plotBottom = pad.top + plotHeight;
  const candles = chartPoints.map((point) => ({
    ...point,
    open: Number(point.open), high: Number(point.high), low: Number(point.low), close: Number(point.close ?? point.value), volume: Number(point.volume)
  })).filter((point) => [point.open, point.high, point.low, point.close].every(Number.isFinite));
  const values = candles.flatMap((point) => [point.high, point.low]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * .08, max * .0008);
  const range = max - min + padding * 2 || 1;
  const toX = (index) => pad.left + (index / Math.max(candles.length - 1, 1)) * (width - pad.left - pad.right);
  const toY = (value) => pad.top + (1 - (value - (min - padding)) / range) * plotHeight;
  const latest = candles.at(-1);
  const first = candles[0];
  const change = first.close ? ((latest.close - first.close) / first.close) * 100 : null;
  const direction = change >= 0 ? "up" : "down";
  const maxVolume = Math.max(...candles.map((point) => Number.isFinite(point.volume) ? point.volume : 0), 1);
  const ma5 = movingAverage(candles.map((point) => point.close), 5);
  const ma20 = movingAverage(candles.map((point) => point.close), 20);
  const indicatorValues = state.activeIndicator === "rsi"
    ? calculateClientRsiSeries(candles.map((point) => point.close), 14)
    : state.activeIndicator === "macd"
      ? calculateClientMacdSeries(candles.map((point) => point.close))
      : [];
  const indicatorNumbers = indicatorValues.filter((value) => Number.isFinite(value));
  const indicatorMin = state.activeIndicator === "rsi" ? 0 : Math.min(...indicatorNumbers, 0);
  const indicatorMax = state.activeIndicator === "rsi" ? 100 : Math.max(...indicatorNumbers, 0);
  const indicatorRange = indicatorMax - indicatorMin || 1;
  const indicatorY = (value) => volumeTop + volumeHeight - ((value - indicatorMin) / indicatorRange) * (volumeHeight - 8) - 4;
  const indicatorPoints = indicatorValues.map((value, index) => ({ value, index })).filter((item) => Number.isFinite(item.value));
  const indicatorLine = indicatorPoints.length ? `<path class="indicator-line ${state.activeIndicator}" d="${indicatorPoints.map((item, index) => `${index ? "L" : "M"} ${toX(item.index).toFixed(1)} ${indicatorY(item.value).toFixed(1)}`).join(" ")}" />` : "";
  const maLine = (values, colorClass) => {
    const points = values.map((value, index) => [toX(index), toY(value)]).filter((point) => Number.isFinite(point[1]));
    if (!points.length) return "";
    return `<path class="candle-${colorClass}" d="${points.map(([x, y], index) => `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")}" />`;
  };
  const timeTicks = buildTimeTicks(candles.length, state.selectedWindow);
  const indicatorText = state.activeIndicator === "rsi"
    ? `RSI14 ${formatNullable(calculateClientRsi(candles.map((point) => point.close), 14))}`
    : state.activeIndicator === "macd"
      ? `MACD ${formatNullable(calculateClientMacd(candles.map((point) => point.close)))}`
      : `MA5 ${formatIndexPoint(ma5.at(-1))} · MA20 ${formatIndexPoint(ma20.at(-1))}`;
  document.querySelector("#trendMeta").textContent = `${selected.name} · ${displayCode(selected.code)} · ${candles.length}根日K · ${windowMap[state.selectedWindow]} ${formatPercent(change)}`;
  document.querySelector("#chartDataHint").textContent = `真实 OHLC · ${selected.source_name || state.trendSource} · ${indicatorText}`;
  svg.innerHTML = `
    <g class="stock-chart candle-chart ${direction}">
      <rect class="chart-board" x="0.5" y="0.5" width="859" height="429" rx="8" />
      <rect class="quote-strip" x="1" y="1" width="858" height="74" rx="8" />
      <text class="chart-title" x="18" y="28">${escapeHtml(selected.name)}</text>
      <text class="chart-subtitle" x="18" y="52">${escapeHtml(displayCode(selected.code))} · 日K</text>
      <text class="quote-price ${direction}" x="148" y="43">${formatIndexPoint(latest.close)}</text>
      <text class="quote-change ${direction}" x="318" y="31">${formatPercent(change)}</text>
      <text class="quote-change ${direction}" x="318" y="55">${indicatorText}</text>
      <text class="quote-metrics" x="560" y="31">开 ${formatIndexPoint(latest.open)} · 高 ${formatIndexPoint(latest.high)}</text>
      <text class="quote-metrics" x="560" y="55">低 ${formatIndexPoint(latest.low)} · ${candles.length} 根</text>
      <rect class="main-plot" x="${pad.left}" y="${pad.top}" width="${width - pad.left - pad.right}" height="${plotHeight}" />
      <rect class="volume-plot" x="${pad.left}" y="${volumeTop}" width="${width - pad.left - pad.right}" height="${volumeHeight}" />
      <line class="volume-divider" x1="${pad.left}" x2="${width - pad.right}" y1="${volumeTop + volumeHeight / 2}" y2="${volumeTop + volumeHeight / 2}" />
      <text class="volume-axis" x="${width - pad.right + 8}" y="${volumeTop + 12}">${formatChartVolume(maxVolume)}</text>
      <text class="volume-axis" x="${width - pad.right + 8}" y="${volumeTop + volumeHeight}">0</text>
      ${[0, 1, 2, 3, 4].map((tick) => { const y = pad.top + tick * plotHeight / 4; const value = max + padding - tick * range / 4; return `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" /><text class="chart-axis" x="${width - pad.right + 8}" y="${y + 4}">${formatIndexPoint(value)}</text>`; }).join("")}
      ${timeTicks.map((index) => { const x = toX(index); return `<line class="chart-grid vertical" x1="${x}" x2="${x}" y1="${pad.top}" y2="${volumeTop + volumeHeight}" /><text class="chart-label" x="${x}" y="${height - 20}" text-anchor="middle">${formatChartTime(candles[index]?.time || "")}</text>`; }).join("")}
      ${candles.map((point, index) => { const x = toX(index); const rising = point.close >= point.open; const bodyTop = Math.min(toY(point.open), toY(point.close)); const bodyHeight = Math.max(2, Math.abs(toY(point.close) - toY(point.open))); const barHeight = Number.isFinite(point.volume) ? Math.max(2, point.volume / maxVolume * volumeHeight) : 2; return `<line class="candle-wick ${rising ? "up" : "down"}" x1="${x}" x2="${x}" y1="${toY(point.high)}" y2="${toY(point.low)}" /><rect class="candle-body ${rising ? "up" : "down"}" x="${x - 3.5}" y="${bodyTop}" width="7" height="${bodyHeight}" /><rect class="volume-bar ${rising ? "up" : "down"}" x="${x - 3.5}" y="${volumeTop + volumeHeight - barHeight}" width="7" height="${barHeight}" />`; }).join("")}
      ${indicatorLine}
      ${maLine(ma5, "ma5")}${maLine(ma20, "ma20")}
      <text class="chart-label volume-title" x="${pad.left}" y="${volumeTop - 8}">成交量</text>
      <circle class="chart-last-dot" cx="${toX(candles.length - 1)}" cy="${toY(latest.close)}" r="4" />
    </g>`;
}

function calculateClientRsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0; let losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) { const delta = values[index] - values[index - 1]; if (delta >= 0) gains += delta; else losses += Math.abs(delta); }
  return losses === 0 ? 100 : 100 - 100 / (1 + (gains / period) / (losses / period));
}

function calculateClientMacd(values) {
  if (values.length < 26) return null;
  const ema = (period) => { const multiplier = 2 / (period + 1); let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period; for (const value of values.slice(period)) current = (value - current) * multiplier + current; return current; };
  return ema(12) - ema(26);
}

function calculateClientRsiSeries(values, period = 14) {
  return values.map((_, index) => calculateClientRsi(values.slice(0, index + 1), period));
}

function calculateClientMacdSeries(values) {
  const emaSeries = (period) => {
    const multiplier = 2 / (period + 1);
    let current = values[0];
    return values.map((value, index) => {
      if (index === 0) return current;
      current = (value - current) * multiplier + current;
      return current;
    });
  };
  const fast = emaSeries(12);
  const slow = emaSeries(26);
  return fast.map((value, index) => index < 25 ? null : value - slow[index]);
}

function prepareChartPoints(points, windowKey) {
  let clean = (points || []).map((point) => ({ ...point, value: Number(point.value ?? point.close) })).filter((point) => Number.isFinite(point.value));
  if (windowKey === "today") {
    clean = clean.filter((point) => isTradingPoint(point.market_time || point.updated_at || point.fetched_at || point.time));
    const unique = new Map();
    clean.forEach((point) => unique.set(String(point.market_time || point.time || point.fetched_at), point));
    clean = [...unique.values()];
  }
  // 今日分时点数通常只有 240 个左右，全部保留，避免首屏看起来少了一段。
  const maxPoints = { today: 600, five: 80, day: 80, month: 80, quarter: 100, year: 140, all: 180 }[windowKey] || 120;
  if (clean.length <= maxPoints) return clean;
  const result = [];
  const step = (clean.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    result.push(clean[Math.round(i * step)]);
  }
  return result;
}

function isTradingPoint(value) {
  const text = String(value || "");
  let hours;
  let minutes;
  const timeMatch = text.match(/(?:T|\s)(\d{1,2}):(\d{2})/) || text.match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
  } else {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    hours = date.getHours();
    minutes = date.getMinutes();
  }
  const total = hours * 60 + minutes;
  return (total >= 9 * 60 + 30 && total <= 11 * 60 + 30) || (total >= 13 * 60 && total <= 15 * 60);
}

function buildTimeTicks(length, windowKey) {
  if (windowKey === "today") return [];
  const count = { today: 5, five: 8, day: 8, month: 10, quarter: 10, year: 12, all: 14 }[windowKey] || 8;
  return [...new Set(Array.from({ length: count }, (_, index) => Math.round((index / Math.max(count - 1, 1)) * (length - 1))))];
}

function shouldUseTodaySequence(points, left, right) {
  if (!Array.isArray(points) || points.length < 3) return false;
  const xs = points
    .map((point) => timeToTradingX(point.market_time || point.updated_at || point.fetched_at || point.time, left, right))
    .filter((value) => Number.isFinite(value));
  if (xs.length < 3) return true;
  const span = Math.max(...xs) - Math.min(...xs);
  return span < (right - left) * 0.18;
}

function tradingTimeMarkers(left, right) {
  return [
    { label: "09:30 开盘", minutes: 9 * 60 + 30, anchor: "start" },
    { label: "11:30 / 13:00 午休", minutes: 11 * 60 + 30, anchor: "middle", kind: "lunch" },
    { label: "15:00 收盘", minutes: 15 * 60, anchor: "end" }
  ].map((item) => ({ ...item, x: tradingMinuteToX(item.minutes, left, right) }));
}

function tradingLunchBounds(left, right) {
  const startX = tradingMinuteToX(11 * 60 + 30, left, right);
  const endX = tradingMinuteToX(13 * 60, left, right);
  return { startX, endX, centerX: startX, width: 0 };
}

function isLunchBreakX(x, left, right) {
  const bounds = tradingLunchBounds(left, right);
  return x > bounds.startX && x < bounds.endX;
}

function timeToTradingX(value, left, right) {
  const minutes = tradingPointMinutes(value);
  if (!Number.isFinite(minutes)) return left;
  return tradingMinuteToX(minutes, left, right);
}

function tradingPointMinutes(point) {
  const value = typeof point === "object" ? (point.market_time || point.updated_at || point.fetched_at || point.time) : point;
  const text = String(value || "");
  const match = text.match(/(?:T|\s|^)(\d{1,2}):(\d{2})/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? NaN : date.getHours() * 60 + date.getMinutes();
}

function isLunchBreakBetween(previous, current) {
  const previousMinutes = tradingPointMinutes(previous);
  const currentMinutes = tradingPointMinutes(current);
  return Number.isFinite(previousMinutes) && Number.isFinite(currentMinutes)
    && previousMinutes <= 11 * 60 + 30 && currentMinutes >= 13 * 60;
}

function tradingMinuteToX(minutes, left, right) {
  const morningStart = 9 * 60 + 30;
  const morningEnd = 11 * 60 + 30;
  const afternoonStart = 13 * 60;
  const afternoonEnd = 15 * 60;
  const clamped = clamp(minutes, morningStart, afternoonEnd);
  const compressedMinutes = clamped <= morningEnd
    ? clamped - morningStart
    : clamped >= afternoonStart
      ? (morningEnd - morningStart) + (clamped - afternoonStart)
      : (morningEnd - morningStart);
  const totalSessionMinutes = (morningEnd - morningStart) + (afternoonEnd - afternoonStart);
  return left + (compressedMinutes / totalSessionMinutes) * (right - left);
}

function renderTodayEmptyChart(svg, index, latestPoint) {
  const width = 860;
  const height = 430;
  const left = 58;
  const right = width - 86;
  const top = 92;
  const bottom = 384;
  const markers = tradingTimeMarkers(left, right);
  svg.innerHTML = `
    <g class="empty-chart today-empty">
      <rect x="1" y="1" width="858" height="428" rx="8" />
      <rect class="main-plot" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" />
      ${[0, 1, 2, 3].map((tick) => {
        const y = top + tick * ((bottom - top) / 3);
        return `<line class="chart-grid" x1="${left}" x2="${right}" y1="${y}" y2="${y}" />`;
      }).join("")}
      <line class="session-marker lunch-marker" x1="${tradingLunchBounds(left, right).centerX}" x2="${tradingLunchBounds(left, right).centerX}" y1="${top}" y2="${bottom}" />
      <text class="lunch-label" x="${tradingLunchBounds(left, right).centerX}" y="${top + 18}" text-anchor="middle">午休 11:30 / 13:00</text>
      ${markers.filter((marker) => marker.kind !== "lunch").map((marker) => `
        <line class="session-marker" x1="${marker.x}" x2="${marker.x}" y1="${top}" y2="${bottom}" />
        <text class="session-label" x="${marker.x}" y="${bottom + 26}" text-anchor="${marker.anchor}">${marker.label}</text>
      `).join("")}
      <text x="430" y="182" text-anchor="middle">今日趋势数据不足</text>
      <text x="430" y="216" text-anchor="middle">${index ? `${index.name} · ${displayCode(index.code)}` : "请刷新几次形成盘中快照"}</text>
      <text x="430" y="248" text-anchor="middle">${latestPoint ? `最新 ${formatNumber(latestPoint.value)} · ${latestPoint.time}` : "盘中按 09:30 / 11:30 / 13:00 / 15:00 展示"}</text>
    </g>
  `;
}

function formatChartTime(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(5);
  if (/^\d{4}-\d{2}/.test(text)) return text.slice(5, 10);
  return text;
}

function selectedIndexes() {
  return state.markets
    .filter((market) => state.selectedRegion === "全部" || market.region === state.selectedRegion)
    .flatMap((market) => market.indexes.map((index) => ({ ...index, region: market.region })));
}

function renderTemperature(indexes) {
  const host = document.querySelector("#marketTemperature");
  if (!host) return;
  const renderCells = (items) => items.map((item) => {
    const pct = clamp(Math.abs(item.displayChange) * 18 + 18, 10, 100);
    const direction = item.displayChange >= 0 ? "up" : "down";
    return `
      <div class="temp-cell ${direction}" style="--w:${pct}%" data-region="${escapeHtml(item.region)}">
        <span>${item.region}</span>
        <strong>${item.name}</strong>
        <em>${formatPercent(item.displayChange)}</em>
      </div>
    `;
  }).join("");
  const aShare = indexes.filter((item) => item.region === "A股");
  const overseas = indexes.filter((item) => item.region !== "A股");
  host.innerHTML = `
    <div class="market-row primary-row">
      <div class="market-row-title">
        <strong>A股</strong>
        <span>主视角</span>
      </div>
      <div class="market-row-grid">${renderCells(aShare)}</div>
    </div>
    <div class="market-row compact-row">
      <div class="market-row-title">
        <strong>外围</strong>
        <span>风险偏好参考</span>
      </div>
      <div class="market-row-grid">${renderCells(overseas)}</div>
    </div>
  `;
  host.querySelectorAll(".temp-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      const region = cell.dataset.region || cell.querySelector("span")?.textContent;
      if (region) selectRegionTrend(region);
    });
  });
}

function renderIndexGrid(indexes) {
  const host = document.querySelector("#indexGrid");
  if (!host) return;
  const renderCard = (item) => {
    const direction = Number(item.displayChange) >= 0 ? "up" : "down";
    const active = item.code === state.selectedTrend ? " active" : "";
    const hasTrend = state.trends.some((trend) => trend.code === item.code);
    return `
      <article class="index-card ${item.region === "A股" ? "primary-market" : "peripheral-market"} ${direction}${active}" data-code="${item.code}" tabindex="0" role="button" aria-pressed="${item.code === state.selectedTrend}" aria-label="查看${item.name}趋势图">
        <div class="card-head">
          <span>${item.region}</span>
          <b>${hasTrend ? item.trend : "暂无趋势"}</b>
        </div>
        ${item.code === state.selectedTrend ? `<span class="selected-badge">趋势中</span>` : ""}
        <h3>${item.name}</h3>
        <div class="index-value">${formatIndexPoint(item.value)}</div>
        <div class="change-line">
          <strong>${formatPercent(item.displayChange)}</strong>
          <span>${state.selectedWindow === "today" ? formatIndexPointSigned(item.change_point) : "历史K线"}</span>
        </div>
        <small>${displayCode(item.code)} · ${windowMap[state.selectedWindow]} · ${formatDateTime(item.updated_at)}</small>
      </article>
    `;
  };
  const filtered = indexes.filter((item) => matchesKeyword(item, state.indexSearch, ["name", "code", "region", "trend"]));
  // 指数与周期行情是核心观察区，完整展示；筛选和排序仍保留。
  const pageRows = filtered;
  if (state.selectedRegion === "全部") {
    const aShare = pageRows.filter((item) => item.region === "A股");
    const others = pageRows.filter((item) => item.region !== "A股");
    host.innerHTML = `
      ${aShare.length ? `<section class="index-section a-share-section">
        <div class="section-title"><h2>A股主盘</h2><span>${aShare.length} 个</span></div>
        <div class="a-share-index-grid">${aShare.map(renderCard).join("")}</div>
      </section>` : ""}
      ${others.length ? `<section class="index-section peripheral-section">
        <div class="section-title"><h2>外围观察</h2><span>${others.length} 个</span></div>
        <div class="peripheral-index-grid">${others.map(renderCard).join("")}</div>
      </section>` : ""}
      ${pageRows.length ? "" : `<div class="empty-state">没有匹配的指数。</div>`}
    `;
  } else {
    const gridClass = state.selectedRegion === "A股" ? "a-share-index-grid" : "peripheral-index-grid";
    host.innerHTML = pageRows.length
      ? `<div class="${gridClass}">${pageRows.map(renderCard).join("")}</div>`
      : `<div class="empty-state">没有匹配的指数。</div>`;
  }
  const meta = document.querySelector("#indexMeta");
  if (meta) meta.textContent = `共 ${filtered.length} 个指数 · 当前周期：${windowMap[state.selectedWindow]} · 点击卡片切换趋势图`;

  host.querySelectorAll(".index-card").forEach((card) => {
    const selectCardTrend = () => {
      state.selectedTrend = card.dataset.code;
      renderTrendSelect();
      loadSelectedHistoryTrend();
      renderMarkets();
    };
    card.addEventListener("click", selectCardTrend);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCardTrend();
      }
    });
  });
}

function renderASharePulse(indexes) {
  const aIndexes = indexes.filter((item) => item.region === "A股");
  const host = document.querySelector("#aSharePulse");
  const rows = aIndexes.length ? aIndexes : selectedIndexes().slice(0, 4);
  host.innerHTML = rows.map((item) => `<div><b>${item.name}</b><span>${item.trend} · ${formatPercent(item.displayChange)}</span></div>`).join("");
}

function renderEtfTabs() {
  const categories = ["全部", ...new Set(state.etfs.map((item) => item.category))];
  const host = document.querySelector("#etfTabs");
  host.innerHTML = categories.map((category) => `<button class="${category === state.selectedEtfCategory ? "active" : ""}" data-category="${category}">${category}</button>`).join("");
  host.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedEtfCategory = button.dataset.category;
      state.etfPage = 1;
      renderEtfTabs();
      renderEtfs();
    });
  });
}

function renderEtfs() {
  const allRows = state.etfs
    .filter((item) => state.selectedEtfCategory === "全部" || item.category === state.selectedEtfCategory)
    .filter((item) => matchesKeyword(item, state.etfSearch, ["name", "code", "category", "tracking"]))
    .sort((a, b) => compareValues(a[state.etfSort], b[state.etfSort], "desc", state.etfSort));
  const page = paginate(allRows, state.etfPage, state.etfPageSize);
  state.etfPage = page.page;
  const rows = page.rows;

  document.querySelector("#etfGrid").innerHTML = rows.length ? rows.map((item) => {
    const direction = item.change_pct >= 0 ? "up" : "down";
    return `
      <article class="etf-card ${direction}">
        <div class="card-head">
          <span title="${escapeHtml(item.category || "暂无")} · ${escapeHtml(item.tracking || "暂无")}">${escapeHtml(item.category || "暂无")} · ${escapeHtml(item.tracking || "暂无")}</span>
          <b>${displayCode(item.code)}</b>
        </div>
        <div class="etf-title-row"><h3 title="${escapeHtml(item.name || "")}">${escapeHtml(item.name || "--")}</h3>${watchlistButton({ ...item, market: "ETF", source: state.etfSource })}</div>
        <div class="etf-metrics">
          <div><span>价格</span><strong>${formatPrice(item.price)}</strong></div>
          <div><span>涨跌</span><strong>${formatPercent(item.change_pct)}</strong></div>
          <div><span>成交额</span><strong>${formatMoney(item.amount)}</strong></div>
          <div><span>净流入</span><strong>${formatMoneySigned(item.net_inflow)}</strong></div>
          <div><span>量比</span><strong>${formatNullable(item.volume_ratio)}</strong></div>
          <div><span>换手</span><strong>${formatPercent(item.turnover_rate)}</strong></div>
        </div>
        <small>${item.update_time} · ${state.etfSource}</small>
      </article>
    `;
  }).join("") : `<div class="empty-state">没有匹配的 ETF。</div>`;
  renderPager("#etfPager", page, (nextPage) => {
    state.etfPage = nextPage;
    renderEtfs();
  });
  const meta = document.querySelector("#etfMeta");
  if (meta) meta.textContent = `共 ${allRows.length} 个 · 每页 ${state.etfPageSize} 个 · ${state.etfSource}`;
}

function renderDraftPreview(html) {
  const markdown = document.querySelector("#draftText").value;
  document.querySelector("#draftPreview").innerHTML = buildArticlePreviewHtml(markdown, html);
}

function applyDraft(data) {
  state.currentDraftId = data.draft?.id || data.id || null;
  state.currentArticleAssets = { cover: data.imageAsset || null, body: data.bodyAssets || [] };
  const hasRestoredAssets = Boolean(data.assets?.length);
  if (hasRestoredAssets) state.currentArticleAssets = assetsFromIds(data.assets);
  document.querySelector("#draftText").value = data.markdown;
  state.currentReview = data.review;
  renderDraftPreview(hasRestoredAssets ? "" : data.html);
  renderReview(data.review);
  renderImagePrompt(data.imagePrompt, data.imageAsset, data.aiPipeline);
  renderAssets();
}

function assetsFromIds(assets = []) {
  const cover = assets.find((asset) => asset.type === "封面") || assets[0] || null;
  const body = assets.filter((asset) => asset.id !== cover?.id);
  return { cover, body };
}

function getCurrentArticleAssetIds() {
  return [state.currentArticleAssets.cover, ...(state.currentArticleAssets.body || [])]
    .filter(Boolean)
    .map((asset) => Number(asset.id))
    .filter(Number.isFinite);
}

function assetUrl(asset) {
  const path = String(asset?.local_path || "");
  return path.startsWith("http") ? path : `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildArticlePreviewHtml(markdown, fallbackHtml = "") {
  const body = fallbackHtml || markdownToHtml(markdown);
  const cover = state.currentArticleAssets.cover;
  const bodyAssets = state.currentArticleAssets.body || [];
  const coverHtml = cover?.local_path
    ? `<figure class="article-image"><img src="${escapeHtml(assetUrl(cover))}" alt="${escapeHtml(cover.title || "文章封面图")}" /><figcaption>封面图：${escapeHtml(cover.title || "公众号配图")}</figcaption></figure>`
    : "";
  const bodyHtml = bodyAssets.filter((asset) => asset?.local_path).map((asset) => `<figure class="article-image"><img src="${escapeHtml(assetUrl(asset))}" alt="${escapeHtml(asset.title || "正文配图")}" /><figcaption>${escapeHtml(asset.title || "正文配图")}</figcaption></figure>`).join("");
  return `${coverHtml}${body}${bodyHtml}`;
}

function renderImagePrompt(prompt, imageAsset = null, pipeline = []) {
  const host = document.querySelector("#imagePrompt");
  if (!host) return;
  const steps = Array.isArray(pipeline) && pipeline.length
    ? `<div class="pipeline-steps">${pipeline.map((item) => `<span class="${item.ok ? "ok" : "warn"}">${escapeHtml(item.step)}：${item.ok ? "完成" : escapeHtml(item.message || "跳过")}</span>`).join("")}</div>`
    : "";
  const activeCover = state.currentArticleAssets.cover || imageAsset;
  const image = activeCover?.local_path
    ? `<img class="generated-cover" src="${escapeHtml(activeCover.local_path)}" alt="AI生成封面" />`
    : "";
  const bound = activeCover?.id && state.currentArticleAssets.cover?.id === activeCover.id;
  host.innerHTML = `
    ${image}
    <strong>${activeCover?.local_path ? (bound ? "AI 配图已生成，并已绑定当前文章" : "AI 配图已生成") : "下一步：生成封面图"}</strong>
    <span>${prompt ? escapeHtml(prompt) : "生成草稿后显示封面图和正文图提示词。"}</span>
    ${prompt && !activeCover?.local_path ? `<button id="generateCoverImage" class="primary-button">使用 Agnes 生成并插入封面</button><small class="image-next-step">生成完成后会自动保存、绑定并显示在右侧排版预览。</small>` : ""}
    ${activeCover?.local_path ? `<div class="image-actions"><button id="insertBodyImage" class="ghost-button">同时插入正文</button><button id="unbindArticleImage" class="text-button">取消绑定</button></div><small class="image-next-step">当前文章已绑定 ${getCurrentArticleAssetIds().length} 张图片。</small>` : ""}
    ${steps}
  `;
  document.querySelector("#generateCoverImage")?.addEventListener("click", () => generateCoverImageFromPrompt(prompt));
  document.querySelector("#insertBodyImage")?.addEventListener("click", () => {
    if (activeCover && !state.currentArticleAssets.body.some((asset) => asset.id === activeCover.id)) state.currentArticleAssets.body.push(activeCover);
    renderDraftPreview();
    renderImagePrompt(prompt, activeCover, pipeline);
    showToast("配图已插入正文预览");
  });
  document.querySelector("#unbindArticleImage")?.addEventListener("click", () => {
    state.currentArticleAssets = { cover: null, body: [] };
    renderDraftPreview();
    renderImagePrompt(prompt, null, pipeline);
    showToast("已取消当前文章配图绑定");
  });
  const videoPrompt = document.querySelector("#videoPrompt");
  if (videoPrompt && prompt && !videoPrompt.value.trim()) {
    videoPrompt.value = prompt
      .replace("财经公众号封面图", "财经公众号短视频素材")
      .replace("包含抽象指数折线、资金流向、城市夜景", "包含抽象指数折线动态、资金流动、金融报纸版式、城市夜景")
      .replace("不出现具体股票代码、收益承诺、平台Logo", "6秒横版，不出现具体股票代码、收益承诺、平台Logo");
  }
  renderWechatPipeline(pipeline);
}

async function generateCoverImageFromPrompt(prompt) {
  const button = document.querySelector("#generateCoverImage");
  if (!prompt) return;
  button.disabled = true;
  showProgress("正在生成封面图", "Agnes 正在根据文章主题生成图片，通常需要几十秒。");
  try {
    const result = await postJson("/api/ai/image/generate", {
      prompt,
      title: extractDraftTitle(document.querySelector("#draftText").value) || "公众号封面"
    });
    if (result.ok) {
      state.currentArticleAssets.cover = result.asset;
      state.currentArticleAssets.body = [];
      state.assets = state.assets.map((item) => item.id === result.asset.id ? { ...item, selected: true } : item);
      await loadAssets();
      renderImagePrompt(prompt, result.asset, [{ step: "Agnes 生图", provider: result.provider || "Agnes", ok: true }]);
      renderDraftPreview();
      showToast("封面图已生成");
    } else {
      showToast(result.message || "封面图生成失败");
    }
  } catch {
    showToast("封面图生成失败");
  } finally {
    button.disabled = false;
    hideProgress();
  }
}

async function generateVideoMaterial() {
  const input = document.querySelector("#videoPrompt");
  const status = document.querySelector("#videoStatus");
  const button = document.querySelector("#generateVideo");
  const prompt = input?.value.trim();
  if (!prompt) {
    showToast("请先填写视频提示词");
    return;
  }
  button.disabled = true;
  status.textContent = "正在提交 Agnes 视频任务...";
  try {
    const result = await postJson("/api/ai/video/generate", {
      prompt,
      title: extractDraftTitle(document.querySelector("#draftText").value) || "公众号视频素材",
      duration: 6,
      size: "1280x720"
    });
    status.textContent = result.ok ? `${result.message}${result.taskId ? ` 任务：${result.taskId}` : ""}` : result.message;
    if (result.asset) await loadAssets();
    showToast(result.ok ? "视频任务已提交" : "视频任务失败");
  } catch {
    status.textContent = "视频任务提交失败";
    showToast("视频任务提交失败");
  } finally {
    button.disabled = false;
  }
}

function extractDraftTitle(markdown) {
  return String(markdown || "").split("\n").find((line) => line.trim().startsWith("# "))?.replace(/^#\s*/, "").trim() || "";
}

function renderModulePicker(selected = null) {
  const host = document.querySelector("#modulePicker");
  if (!host) return;
  const active = new Set(selected || sessionDefaults[document.querySelector("#workflowSession")?.value || "close"].modules);
  host.innerHTML = articleModules.map((name) => `
    <label class="module-chip">
      <input type="checkbox" value="${name}" ${active.has(name) ? "checked" : ""} />
      ${name}
    </label>
  `).join("");
  host.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", syncWorkflowToWechat);
  });
}

function renderWechatModulePicker() {
  const host = document.querySelector("#wechatModulePicker");
  if (!host) return;
  const active = state.selectedWechatModules instanceof Set ? state.selectedWechatModules : new Set(sessionDefaults.close.modules);
  host.innerHTML = articleModules.map((name) => `
    <label class="module-chip">
      <input type="checkbox" value="${name}" ${active.has(name) ? "checked" : ""} />
      ${name}
    </label>
  `).join("");
  host.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.selectedWechatModules.add(input.value);
      else state.selectedWechatModules.delete(input.value);
    });
  });
}

function syncWorkflowToWechat() {
  const articleType = document.querySelector("#articleType")?.value;
  const style = document.querySelector("#articleStyle")?.value;
  const keywords = document.querySelector("#articleKeywords")?.value;
  const requirements = document.querySelector("#articleRequirements")?.value;
  if (articleType) document.querySelector("#wechatArticleType").value = articleType;
  if (style) document.querySelector("#wechatStyle").value = style;
  if (keywords !== undefined) document.querySelector("#wechatKeywords").value = keywords;
  if (requirements !== undefined) document.querySelector("#wechatRequirements").value = requirements;
  state.selectedWechatModules = new Set([...document.querySelectorAll("#modulePicker input:checked")].map((input) => input.value));
  renderWechatModulePicker();
}

function fillSettingsForm(config) {
  if (!config) return;
  const setValue = (selector, value) => {
    const input = document.querySelector(selector);
    if (input) input.value = value || "";
  };
  setValue("#aiProvider", config.ai?.provider);
  setValue("#aiBaseUrl", config.ai?.baseUrl);
  setValue("#aiModel", config.ai?.model);
  setValue("#agnesProviderInput", config.agnes?.provider);
  setValue("#agnesBaseUrl", config.agnes?.baseUrl);
  setValue("#agnesModelInput", config.agnes?.model);
  setValue("#imageProvider", config.image?.provider);
  setValue("#imageBaseUrl", config.image?.baseUrl);
  setValue("#imageModel", config.image?.model);
  setValue("#videoProvider", config.video?.provider);
  setValue("#videoBaseUrl", config.video?.baseUrl);
  setValue("#videoModel", config.video?.model);
  const aiPreview = document.querySelector("#aiKeyPreview");
  if (aiPreview) aiPreview.textContent = config.ai?.keyPreview ? `当前 Key：${config.ai.keyPreview} · ${config.ai.source}` : "未配置";
}

function renderWechatPipeline(pipeline = []) {
  const host = document.querySelector("#wechatPipeline");
  if (!host) return;
  host.innerHTML = Array.isArray(pipeline) && pipeline.length
    ? pipeline.map((item) => `
      <div class="pipeline-row ${item.ok ? "ok" : "warn"}">
        <b>${escapeHtml(item.step || "--")}</b>
        <span>${escapeHtml(item.provider || "")}${item.ok ? " · 完成" : ` · ${item.message || "跳过"}`}</span>
      </div>
    `).join("")
    : `<div class="empty-state">生成 AI 草稿后显示 Agnes 汇总、成稿、生图状态。</div>`;
}

function renderWorkflow() {
  const host = document.querySelector("#workflowCards");
  if (!host || !state.workflow) return;
  host.innerHTML = state.workflow.sessions.map((item) => `
    <article class="workflow-card ${workflowTimeState(item.key).className}" data-session="${item.key}">
      <div class="card-head">
        <span>${item.window}</span>
        <b>${workflowTimeState(item.key).label}</b>
      </div>
      <h3>${item.title}</h3>
      <p>${item.publicTitle}</p>
      <div class="workflow-meta">
        <span>数据：${item.dataStatus}</span>
        <span>审稿：${item.review?.passed ? "通过" : "待修改"}</span>
        <span>${workflowTimeState(item.key).hint}</span>
      </div>
      <small>${formatDateTime(item.lastRefresh)} · ${item.source}</small>
      <button class="ghost-button" data-generate="${item.key}">生成${item.articleType}</button>
    </article>
  `).join("");
  host.querySelectorAll("[data-generate]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("#workflowSession").value = button.dataset.generate;
      const preset = sessionDefaults[button.dataset.generate] || sessionDefaults.close;
      document.querySelector("#articleType").value = preset.articleType;
      renderModulePicker(preset.modules);
      generateWorkflow();
    });
  });
}

function workflowTimeState(key) {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const windows = {
    preopen: { start: 8 * 60 + 30, end: 9 * 60 + 15, label: "盘前固定窗口" },
    midday: { start: 11 * 60 + 35, end: 12 * 60 + 30, label: "午休固定窗口" },
    close: { start: 15 * 60 + 15, end: 17 * 60 + 30, label: "收盘固定窗口" }
  };
  const item = windows[key] || windows.close;
  if (minutes < item.start) return { className: "pending", label: "待开始", hint: item.label };
  if (minutes <= item.end) return { className: "current", label: "当前时段", hint: item.label };
  return { className: "done", label: "已过时段", hint: item.label };
}

function renderSyncStrip() {
  const host = document.querySelector("#syncStrip");
  if (!host || !state.workflow) return;
  host.innerHTML = state.workflow.refreshPlan.map((item) => `
    <div class="sync-cell">
      <span>${item.name}</span>
      <strong>${item.label}</strong>
      <small>${item.scope}</small>
    </div>
  `).join("");
}

async function generateWorkflow() {
  const selectedModules = [...document.querySelectorAll("#modulePicker input:checked")].map((input) => input.value);
  const payload = {
    session: document.querySelector("#workflowSession").value,
    articleType: document.querySelector("#articleType").value,
    style: document.querySelector("#articleStyle").value,
    modules: selectedModules,
    keywords: document.querySelector("#articleKeywords").value,
    requirements: document.querySelector("#articleRequirements").value
  };
  showProgress("正在生成文章", "先整理行情和资讯，再生成公众号公开稿。");
  try {
    const data = await postJson("/api/workflow/generate", payload);
    state.workflowResult = data;
    applyDraft(data.publicDraft);
    document.querySelector("#wechatArticleType").value = data.articleType;
    document.querySelector("#wechatStyle").value = data.style;
    document.querySelector("#wechatKeywords").value = payload.keywords;
    document.querySelector("#wechatRequirements").value = payload.requirements;
    renderWorkflowResult(data);
    showToast(`${sessionName(data.session)}内容已生成`);
  } catch (error) {
    showToast("文章生成失败，请检查 AI 配置或稍后重试");
  } finally {
    hideProgress();
  }
}

function renderWorkflowResult(data) {
  const host = document.querySelector("#workflowResult");
  if (!host) return;
  host.classList.remove("empty-state");
  host.innerHTML = `
    <div class="result-block">
      <span>公开稿</span>
      <strong>${escapeHtml(data.publicDraft.title)}</strong>
      <small>${data.publicDraft.review.passed ? "审稿通过" : "存在需改写表达"} · ${data.publicDraft.sections.length} 个模块</small>
    </div>
    <div class="result-block">
      <span>自用版</span>
      <strong>${escapeHtml(data.privateSignal.mood)}</strong>
      <small>候选池 ${data.privateSignal.candidates.length} 条，仅个人研究</small>
    </div>
    <div class="result-block">
      <span>AI 流程</span>
      <strong>${data.ai.agnesConfigured ? "Agnes汇总可用" : "Agnes汇总未配置"} / ${data.ai.textConfigured ? "成稿模型可用" : "成稿模型未配置"} / ${data.ai.imageAsset ? "封面已生成" : data.ai.imageConfigured ? "图片入口可用" : "图片入口待配置"} / ${data.ai.videoConfigured ? "视频入口可用" : "视频入口待配置"}</strong>
      <small>${escapeHtml(data.ai.imagePrompt)}</small>
    </div>
  `;
}

function renderReview(review) {
  const panel = document.querySelector("#reviewPanel");
  if (!review) {
    panel.innerHTML = `<div class="empty-state">点击审稿检查后显示结果。</div>`;
    return;
  }
  document.querySelector("#reviewStatus").textContent = review.passed ? "通过" : "需修改";
  panel.innerHTML = `
    <div class="review-result ${review.passed ? "passed" : "failed"}">
      <strong>${review.passed ? "公开稿检查通过" : "发现风险表达"}</strong>
      <span>${review.hits?.length ? `命中：${review.hits.join("、")}` : "未发现明显荐股或收益承诺表达"}</span>
    </div>
    ${(review.warnings || []).map((item) => `<div class="review-warning">${item}</div>`).join("")}
  `;
}

function renderAssets() {
  document.querySelector("#assetCount").textContent = `${state.assets.length} 个`;
  document.querySelector("#assetList").innerHTML = state.assets.length
    ? state.assets.map((item) => `
      <label class="asset-item ${getCurrentArticleAssetIds().includes(Number(item.id)) ? "bound" : ""}">
        <input type="checkbox" data-id="${item.id}" ${item.selected ? "checked" : ""} />
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.type)} · ${escapeHtml(item.source)}</span>
          <small>${escapeHtml(item.local_path || "未填写路径")}</small>
        </div>
        ${getCurrentArticleAssetIds().includes(Number(item.id)) ? `<em>当前文章已用</em>` : `<button type="button" class="text-button asset-bind" data-id="${item.id}">加入当前文章</button>`}
      </label>
    `).join("")
    : `<div class="empty-state">暂无素材。可以先登记封面、正文图、二维码或免责声明图。</div>`;
  document.querySelectorAll("#assetList input").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.id);
      state.assets = state.assets.map((item) => item.id === id ? { ...item, selected: input.checked } : item);
    });
  });
  document.querySelectorAll("#assetList .asset-bind").forEach((button) => button.addEventListener("click", () => {
    const asset = state.assets.find((item) => item.id === Number(button.dataset.id));
    if (!asset) return;
    if (asset.type === "封面") state.currentArticleAssets.cover = asset;
    else state.currentArticleAssets.body.push(asset);
    renderAssets();
    renderImagePrompt(document.querySelector("#imagePrompt span")?.textContent || "", state.currentArticleAssets.cover, []);
    renderDraftPreview();
    showToast("素材已加入当前文章");
  }));
}

function renderDraftHistory() {
  document.querySelector("#draftHistory").innerHTML = state.drafts.length
    ? state.drafts.map((item) => `
      <div class="history-item">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.topic)} · ${escapeHtml(item.source)} · ${formatDateTime(item.created_at)}</span>
        <small>${item.assetIds?.length ? `已绑定 ${item.assetIds.length} 张图片` : "未绑定图片"}</small>
        <button type="button" class="text-button load-draft" data-draft-id="${item.id}">打开此版本</button>
      </div>
    `).join("")
    : `<div class="empty-state">暂无保存版本。</div>`;
  document.querySelectorAll(".load-draft").forEach((button) => button.addEventListener("click", async () => {
    showProgress("正在打开草稿", "正在恢复正文、审稿结果和文章配图。", true);
    try {
      const data = await fetchJson(`/api/wechat/drafts/${button.dataset.draftId}`);
      const draft = data.draft;
      document.querySelector("#wechatArticleType").value = draft.topic || "收盘复盘";
      applyDraft({ ...draft, imageAsset: null, assets: data.assets || [] });
      showToast("草稿已打开，文章配图已恢复");
    } catch (error) {
      showToast(error.message || "打开草稿失败");
    } finally {
      hideProgress();
    }
  }));
}

function renderNewsItems() {
  const count = document.querySelector("#newsCount");
  const host = document.querySelector("#newsList");
  if (!host) return;
  if (count) count.textContent = `${state.newsItems.length} 条`;
  host.innerHTML = state.newsItems.length
    ? renderNewsRows(state.newsItems.slice(0, 12))
    : `<div class="empty-state">暂无资讯素材。可以粘贴链接、标题和摘要，或在设置页刷新公开新闻。</div>`;
}

function renderNewsRows(items) {
  return `<div class="news-rows">${(items || []).map((item) => `
    <article class="news-item">
      <strong>${escapeHtml(item.title || "未命名资讯")}</strong>
      <span>${escapeHtml(item.source || "未知来源")} · ${escapeHtml(item.category || "市场资讯")} ${item.published_at ? `· ${escapeHtml(item.published_at)}` : ""}</span>
      ${item.summary ? `<p>${escapeHtml(item.summary).slice(0, 160)}</p>` : ""}
      ${item.url ? `<small>${escapeHtml(item.url)}</small>` : ""}
    </article>
  `).join("")}</div>`;
}

function renderSectorFlows() {
  const allRows = [...state.sectorFlows]
    .filter((item) => hasUsableSectorRow(item))
    .filter((item) => (item.type || "industry") === state.sectorRankType)
    .filter((item) => matchesKeyword(item, state.sectorSearch, ["name", "signal", "source_name", "leaders"]))
    .sort((a, b) => compareValues(a[state.sectorSort], b[state.sectorSort], "desc", state.sectorSort));
  const page = paginate(allRows, state.sectorPage, state.sectorPageSize);
  state.sectorPage = page.page;
  const rows = page.rows;
  const validInflows = rows.map((item) => Number(item.net_inflow)).filter(Number.isFinite);
  const maxAbs = Math.max(...validInflows.map((value) => Math.abs(value)), 1);
  document.querySelector("#sectorFlowList").innerHTML = rows.length ? rows.map((item) => {
    const change = Number(item.change_pct);
    const inflow = Number(item.net_inflow);
    const direction = Number.isFinite(change) ? (change >= 0 ? "up" : "down") : "neutral";
    const width = Number.isFinite(inflow) ? clamp((Math.abs(inflow) / maxAbs) * 100, 8, 100) : 0;
    return `
      <button class="sector-flow-item ${direction}" data-sector="${escapeHtml(item.name || "")}">
        <div class="sector-flow-main">
          <b>${escapeHtml(item.name || "--")}</b>
          <span>${escapeHtml(item.signal || "板块")} · ${Number.isFinite(inflow) ? formatSectorMoneySigned(inflow) : "资金暂无"}</span>
        </div>
        <strong class="sector-change">${Number.isFinite(change) ? formatPercent(change) : "涨跌暂无"}</strong>
        <div class="flow-bar"><i style="width:${width}%"></i></div>
        <div class="sector-flow-meta">
          <span>涨 ${item.up_count} / 跌 ${item.down_count}</span>
        </div>
        <small>${compactSource([...(item.leaders || []), item.source_name || state.sectorSource].filter(Boolean).join(" / "), 28)}</small>
      </button>
    `;
  }).join("") : `<div class="empty-state">没有匹配的板块资金数据。</div>`;
  document.querySelectorAll("#sectorFlowList .sector-flow-item").forEach((item) => {
    item.addEventListener("click", () => openSectorModal(item.dataset.sector));
  });
  renderPager("#sectorPager", page, (nextPage) => {
    state.sectorPage = nextPage;
    renderSectorFlows();
  });
  const meta = document.querySelector("#sectorFlowMeta");
  if (meta) meta.textContent = `${state.sectorRankType === "industry" ? "行业" : state.sectorRankType === "concept" ? "概念" : "主题"} · 共 ${allRows.length} 个 · 每页 ${state.sectorPageSize} 个 · ${state.sectorSource}`;
}

function renderSectorCloud(data = {}) {
  const host = document.querySelector("#sectorCloud");
  if (!host) return;
  const rows = (data.sectors || []).filter((item) => hasUsableSectorRow(item)).slice(0, 36);
  const meta = document.querySelector("#sectorCloudMeta");
  if (meta) meta.textContent = `${data.areaMetric || "面积按净流入绝对值"}；红色为净流入/上涨，绿色为净流出/下跌；点击查看成分股、ETF和资讯 · ${data.source || state.sectorSource || "数据源"}`;
  if (!rows.length) {
    host.innerHTML = `<div class="empty-state">暂无${state.sectorCloudType === "industry" ? "行业" : state.sectorCloudType === "concept" ? "概念" : "主题"}板块数据。</div>`;
    return;
  }
  host.innerHTML = rows.map((item) => {
    const change = Number(item.change_pct);
    const hasChange = Number.isFinite(change);
    const hasInflow = Number.isFinite(Number(item.net_inflow)) && Math.abs(Number(item.net_inflow)) > 0;
    const direction = hasChange ? (change >= 0 ? "up" : "down") : "neutral";
    const hasArea = Number.isFinite(Number(item.area)) && Number(item.area) > 0;
    const size = hasArea ? Math.max(104, Math.min(250, 104 + Number(item.area) * 1.05)) : 128;
    return `<button class="sector-cloud-tile ${direction} ${hasArea ? "sized" : "equal-size"}" data-sector="${escapeHtml(item.name || "")}" style="--tile-size:${size}px">
      <strong>${escapeHtml(item.name || "暂无板块")}</strong>
      <b>${hasChange ? formatPercent(change) : "暂无涨跌"}</b>
      <span>${hasInflow ? `资金 ${formatSectorMoneySigned(item.net_inflow)}` : "资金暂无"}</span>
      <small>${escapeHtml(item.signal || (state.sectorCloudType === "theme" ? "主题目录" : "板块"))} · ${hasArea ? `面积 ${item.area_source || "净流入"}` : "面积暂无数据"} · 涨 ${formatNullable(item.up_count)} / 跌 ${formatNullable(item.down_count)}</small>
    </button>`;
  }).join("");
  host.querySelectorAll("[data-sector]").forEach((button) => button.addEventListener("click", () => openSectorModal(button.dataset.sector)));
}

function hasUsableSectorRow(item = {}) {
  const numeric = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  return numeric(item.change_pct)
    || (numeric(item.net_inflow) && Math.abs(Number(item.net_inflow)) > 0)
    || (numeric(item.amount) && Number(item.amount) > 0)
    || (numeric(item.up_count) && Number(item.up_count) > 0)
    || (numeric(item.down_count) && Number(item.down_count) > 0);
}

function renderNewsMonitor() {
  const host = document.querySelector("#newsMonitorList");
  const count = document.querySelector("#newsMonitorCount");
  if (!host) return;
  const rows = state.newsMonitorRows || [];
  if (count) count.textContent = `${rows.length} 条`;
  host.innerHTML = rows.length ? rows.slice(0, 24).map((item) => `
    <article class="news-monitor-item">
      <div class="news-monitor-head"><strong>${escapeHtml(item.title || "未命名资讯")}</strong><span>${escapeHtml(item.importance || "普通")}</span></div>
      <div class="news-monitor-meta">${escapeHtml(item.region || "中国")} · ${escapeHtml(item.market || "A股")} · ${escapeHtml(item.source || "公开来源")} · ${escapeHtml(item.published_at || item.created_at || "")}</div>
      ${item.summary ? `<p>${escapeHtml(item.summary).slice(0, 180)}</p>` : ""}
      <div class="news-monitor-foot"><span>${(item.event_tags || []).map((tag) => `#${escapeHtml(tag)}`).join(" ") || "待归类"}</span>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">查看来源</a>` : ""}<button class="text-button add-news-material" data-news-id="${item.id}">加入文章素材</button></div>
    </article>`).join("") : `<div class="empty-state">暂无符合条件的资讯。可以粘贴公开链接或摘要进入素材池。</div>`;
  host.querySelectorAll(".add-news-material").forEach((button) => button.addEventListener("click", async () => {
    const id = Number(button.dataset.newsId);
    const result = await postJson("/api/news/add-to-draft", { ids: [id] });
    showToast(result.message || "已加入文章素材");
  }));
}

async function openSectorModal(sectorName) {
  const sector = state.sectorFlows.find((item) => item.name === sectorName);
  if (!sector) return;
  let detail = state.sectorDetails.get(sectorName);
  if (!detail) {
    try {
      detail = await fetchJson(`/api/sectors/${encodeURIComponent(sectorName)}/detail`);
      state.sectorDetails.set(sectorName, detail);
    } catch {
      detail = { members: [], news: [] };
    }
  }
  let sectorHistory = null;
  try {
    sectorHistory = await fetchJson(`/api/history?type=sector&code=${encodeURIComponent(sectorName)}&window=${encodeURIComponent(state.selectedWindow === "today" ? "month" : state.selectedWindow)}`);
  } catch {
    sectorHistory = { points: [], status: "empty" };
  }
  const mappedStocks = (detail.members || []).map((member) => ({ ...member, sector: sectorName, mapped: true }));
  const stocks = mappedStocks.length ? mappedStocks.slice(0, 12) : matchSectorStocks(sector).slice(0, 12);
  const etfs = matchSectorEtfs(sector).slice(0, 8);
  const matchMode = mappedStocks.length ? "成分股映射" : "弱匹配";
  const modal = document.querySelector("#sectorModal");
  document.querySelector("#sectorModalTitle").textContent = `${sector.name} · ${formatPercent(sector.change_pct)}`;
  document.querySelector("#sectorModalBody").innerHTML = `
    <div class="sector-detail-tabs" role="tablist">
      <button class="active" data-detail-tab="overview">概览</button>
      <button data-detail-tab="members">成分股</button>
      <button data-detail-tab="etfs">相关 ETF</button>
      <button data-detail-tab="news">资讯</button>
    </div>
    <section class="sector-modal-summary modal-tab-panel" data-detail-panel="overview">
      <article><span>涨跌幅</span><strong class="${sector.change_pct >= 0 ? "positive" : "negative"}">${formatPercent(sector.change_pct)}</strong></article>
      <article><span>净流入</span><strong class="${sector.net_inflow >= 0 ? "positive" : "negative"}">${formatSectorMoneySigned(sector.net_inflow)}</strong></article>
      <article><span>涨跌家数</span><strong>涨 ${formatNullable(sector.up_count)} / 跌 ${formatNullable(sector.down_count)}</strong></article>
      <article><span>线索</span><strong>${escapeHtml(sector.signal || "暂无")}</strong></article>
    </section>
    <section class="modal-section modal-tab-panel" data-detail-panel="overview">
      <h3>龙头/来源线索</h3>
      <div class="tag-list">${(sector.leaders || []).length ? sector.leaders.map((name) => `<span>${escapeHtml(name)}</span>`).join("") : "<span>暂无</span>"}</div>
    </section>
    <section class="modal-section modal-tab-panel" data-detail-panel="overview">
      <h3>板块趋势</h3>
      ${renderMiniTrend(sectorHistory, sector.name)}
    </section>
    <section class="modal-section modal-tab-panel" data-detail-panel="members" hidden>
      <h3>相关股票 · ${matchMode}</h3>
      ${stocks.length ? renderMiniRows(stocks, ["code", "name", "change_pct", "turnover_rate", "volume_ratio"]) : `<div class="empty-state">股票池中暂无可匹配条目。</div>`}
    </section>
    <section class="modal-section modal-tab-panel" data-detail-panel="etfs" hidden>
      <h3>匹配 ETF</h3>
      ${etfs.length ? renderMiniRows(etfs, ["code", "name", "change_pct", "amount", "net_inflow"]) : `<div class="empty-state">ETF 池中暂无可匹配条目。</div>`}
    </section>
    <section class="modal-section modal-tab-panel" data-detail-panel="news" hidden>
      <h3>相关资讯</h3>
      ${(detail.news || []).length ? renderNewsRows(detail.news.slice(0, 5)) : `<div class="empty-state">暂无相关资讯素材。</div>`}
    </section>
  `;
  const detailBody = document.querySelector("#sectorModalBody");
  detailBody.querySelectorAll("[data-detail-tab]").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.detailTab;
    detailBody.querySelectorAll("[data-detail-tab]").forEach((item) => item.classList.toggle("active", item === button));
    detailBody.querySelectorAll("[data-detail-panel]").forEach((panel) => { panel.hidden = !panel.dataset.detailPanel.split(" ").includes(tab); });
  }));
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function renderMiniTrend(history, label) {
  const points = (history?.points || []).map((point) => ({ time: point.time, value: Number(point.close ?? point.value) })).filter((point) => Number.isFinite(point.value));
  if (points.length < 2) return `<div class="empty-state">暂无${escapeHtml(label || "板块")}历史趋势数据。</div>`;
  const width = 620;
  const height = 150;
  const pad = { left: 46, right: 20, top: 18, bottom: 28 };
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const toX = (index) => pad.left + (index / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right);
  const toY = (value) => pad.top + (1 - (value - min) / range) * (height - pad.top - pad.bottom);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${toX(index).toFixed(1)} ${toY(point.value).toFixed(1)}`).join(" ");
  const first = points[0].value;
  const last = points.at(-1).value;
  const direction = last >= first ? "up" : "down";
  return `
    <div class="mini-trend ${direction}">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}趋势">
        <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" />
        <line x1="${pad.left}" x2="${width - pad.right}" y1="${toY(first)}" y2="${toY(first)}" />
        <path d="${line}" />
        <text x="${pad.left}" y="${height - 9}">${escapeHtml(points[0].time || "")}</text>
        <text x="${width - pad.right}" y="${height - 9}" text-anchor="end">${escapeHtml(points.at(-1).time || "")}</text>
        <text x="${pad.left}" y="15">${formatNumber(last)} · ${formatPercent(first ? ((last - first) / first) * 100 : null)}</text>
      </svg>
    </div>
  `;
}

function closeSectorModal() {
  const modal = document.querySelector("#sectorModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function renderConditionLists() {
  renderConditionList("#conditionList", state.conditions, true);
  if (document.querySelector("#paperConditionList")) renderConditionList("#paperConditionList", state.paperConditions, false);
}

function renderConditionList(selector = "#conditionList", conditions = state.conditions, runAfterChange = true) {
  const host = document.querySelector(selector);
  if (!host) return;
  if (!conditions.length) {
    host.innerHTML = `<div class="empty-state">暂无条件。可以添加条件，或选择上方模板。</div>`;
    return;
  }

  host.innerHTML = conditions.map((condition, index) => `
    <div class="condition-row" data-index="${index}">
      <select class="field-select">${Object.entries(fieldMeta).filter(([, meta]) => meta.type !== "money" || true).map(([field, meta]) => `<option value="${field}" ${condition.field === field ? "selected" : ""}>${meta.label}</option>`).join("")}</select>
      <select class="operator-select">${operatorOptions(condition.operator)}</select>
      <input class="value-input" value="${escapeHtml(condition.value ?? "")}" placeholder="数值/文本" />
      <input class="value2-input" value="${escapeHtml(condition.value2 ?? "")}" placeholder="区间上限" />
      <button class="delete-condition">删除</button>
    </div>
  `).join("");

  host.querySelectorAll(".condition-row").forEach((row) => {
    const index = Number(row.dataset.index);
    row.querySelector(".field-select").addEventListener("change", (event) => { conditions[index].field = event.target.value; });
    row.querySelector(".operator-select").addEventListener("change", (event) => { conditions[index].operator = event.target.value; });
    row.querySelector(".value-input").addEventListener("input", (event) => { conditions[index].value = event.target.value; });
    row.querySelector(".value2-input").addEventListener("input", (event) => { conditions[index].value2 = event.target.value; });
    row.querySelector(".delete-condition").addEventListener("click", () => {
      conditions.splice(index, 1);
      renderConditionLists();
      if (runAfterChange) runScreener();
    });
  });
}

function operatorOptions(selected) {
  const options = [[">", "大于"], [">=", "大于等于"], ["<", "小于"], ["<=", "小于等于"], ["between", "区间"], ["=", "等于"], ["contains", "包含"], ["not_contains", "不包含"]];
  return options.map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function updateCondition(index, key, value) {
  state.conditions[index][key] = value;
}

function renderColumnToggles() {
  const host = document.querySelector("#columnToggles");
  host.innerHTML = stockColumns.map((field) => `
    <label>
      <input type="checkbox" value="${field}" ${state.visibleColumns.has(field) ? "checked" : ""} />
      ${fieldMeta[field].label}
    </label>
  `).join("");

  host.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        state.visibleColumns.add(input.value);
      } else if (state.visibleColumns.size > 1) {
        state.visibleColumns.delete(input.value);
      } else {
        input.checked = true;
        showToast("至少保留一个显示字段");
        return;
      }
      renderStockTable();
    });
  });
}

function renderStockTable() {
  const visibleColumns = stockColumns.filter((field) => state.visibleColumns.has(field));
  const head = document.querySelector("#stockHeader");
  head.innerHTML = visibleColumns.map((field) => {
    const active = state.stockSort.field === field ? "active" : "";
    const arrow = active ? (state.stockSort.direction === "asc" ? "↑" : "↓") : "";
    return `<th class="${active}" data-field="${field}">${fieldMeta[field].label} ${arrow}</th>`;
  }).join("") + "<th>自选</th>";
  head.querySelectorAll("th").forEach((cell) => {
    cell.addEventListener("click", () => {
      const field = cell.dataset.field;
      state.stockSort = {
        field,
        direction: state.stockSort.field === field && state.stockSort.direction === "desc" ? "asc" : "desc"
      };
      runScreener();
    });
  });

  document.querySelector("#stockRows").innerHTML = state.stocks.map((item) => `
    <tr class="stock-row" data-code="${escapeHtml(item.code || "")}">
      ${visibleColumns.map((field) => `<td>${formatField(item[field], field)}</td>`).join("")}
      <td>${watchlistButton({ ...item, market: "A股", source: state.dataSource })}</td>
    </tr>
  `).join("");
  document.querySelectorAll("#stockRows .stock-row").forEach((row) => {
    row.addEventListener("click", () => {
      const code = row.dataset.code;
      if (!code) return;
      document.querySelector("#predictQuery").value = code;
      runPrediction();
    });
  });
}

function renderPrediction(item) {
  const host = document.querySelector("#predictionResult");
  if (!host || !item) return;
  host.classList.remove("empty-state");
  const levelClass = item.hit_score >= 80 ? "high" : item.hit_score >= 55 ? "mid" : "low";
  const metrics = item.metrics || {};
  host.innerHTML = `
    <div class="prediction-head ${levelClass}">
      <div>
        <strong>${escapeHtml(item.name)} <span>${displayCode(item.code)}</span></strong>
        <small>${escapeHtml(item.market || "A股")} · ${escapeHtml(item.sector || item.category || "暂无板块")} · ${escapeHtml(item.source || "当前行情")} · ${formatDateTime(item.updatedAt)}</small>
      </div>
      <div class="score-badge">
        <span>命中分</span>
        <b>${formatNullable(item.hit_score)}</b>
        <em>${escapeHtml(item.level)}</em>
        ${watchlistButton({ ...item, market: item.market || "A股", source: item.source || "条件筛选" })}
      </div>
    </div>
    <div class="prediction-metrics">
      <div><span>现价</span><strong>${formatPrice(metrics.price)}</strong></div>
      <div><span>涨跌幅</span><strong>${formatPercent(metrics.change_pct)}</strong></div>
      <div><span>量比</span><strong>${formatNullable(metrics.volume_ratio)}</strong></div>
      <div><span>换手率</span><strong>${formatPercent(metrics.turnover_rate)}</strong></div>
      <div><span>成交额</span><strong>${formatMoney(metrics.amount)}</strong></div>
      <div><span>流通市值</span><strong>${formatMoney(metrics.float_market_cap)}</strong></div>
      <div><span>总市值</span><strong>${formatMoney(metrics.market_cap)}</strong></div>
      <div><span>振幅</span><strong>${formatPercent(metrics.amplitude)}</strong></div>
    </div>
    <div class="prediction-columns">
      <section>
        <h3>命中条件</h3>
        ${(item.conditionHits || []).length
          ? item.conditionHits.map((condition) => `<p class="${condition.hit ? "hit" : "miss"}">${condition.hit ? "命中" : "未命中"} · ${escapeHtml(condition.label)} · 当前 ${formatPredictionValue(condition.value, condition.field)}</p>`).join("")
          : `<p class="miss">当前没有筛选条件，命中分仅按基础活跃度计算。</p>`}
      </section>
      <section>
        <h3>优势</h3>
        ${(item.strengths || []).map((text) => `<p class="hit">${escapeHtml(text)}</p>`).join("")}
      </section>
      <section>
        <h3>风险</h3>
        ${(item.risks || []).map((text) => `<p class="miss">${escapeHtml(text)}</p>`).join("")}
      </section>
    </div>
    <button class="ghost-button open-research" data-code="${escapeHtml(item.code || "")}">打开完整研究</button>
    <small class="prediction-disclaimer">数据：${escapeHtml(item.source || "当前行情")} · 更新：${formatDateTime(item.updatedAt)} · ${escapeHtml(item.disclaimer || "仅供个人研究，不构成投资建议。")}</small>
  `;
  host.querySelector(".open-research")?.addEventListener("click", () => {
    document.querySelector("#researchQuery").value = item.code || "";
    showView("private");
    runResearch();
  });
}

function formatPredictionValue(value, field) {
  if (field === "change_pct" || field === "turnover_rate" || field === "amplitude") return formatPercent(value);
  if (field === "amount" || field === "float_market_cap" || field === "market_cap") return formatMoney(value);
  return formatNullable(value);
}

function renderScreenerQuality(quality, source) {
  const host = document.querySelector("#screenerQuality");
  if (!host || !quality) return;
  const labels = {
    volume_ratio: "量比",
    turnover_rate: "换手率",
    amount: "成交额",
    float_market_cap: "流通市值",
    market_cap: "总市值",
    amplitude: "振幅"
  };
  const chips = Object.entries(quality.detail || {}).map(([field, item]) => {
    const ratio = Math.round((item.ratio || 0) * 100);
    const cls = ratio >= 80 ? "good" : ratio >= 40 ? "warn" : "bad";
    return `<span class="${cls}">${labels[field] || field} ${ratio}%</span>`;
  }).join("");
  host.innerHTML = `
    <strong>${escapeHtml(source || "数据源")} · 股票池 ${quality.total || 0} 条</strong>
    <div>${chips}</div>
  `;
}

function renderStockResearch(item, selector = "#researchResult") {
  const host = document.querySelector(selector);
  if (!host || !item) return;
  const metrics = item.metrics || {};
  const metric = (label, value, formatter = formatNullable) => `<div><span>${label}</span><strong>${formatter(value)}</strong></div>`;
  host.hidden = false;
  host.className = selector === "#watchlistResearchResult" ? "watchlist-research-result research-result" : "research-result";
  const forecast = item.forecast || {};
  const horizons = forecast.horizons || [];
  host.innerHTML = `
    <div class="research-head">
      <div>
        <p class="eyebrow">${escapeHtml(item.sector || "A股研究")}</p>
        <h3>${escapeHtml(item.name)} <small>${displayCode(item.code)}</small></h3>
        <span>${escapeHtml(cleanMarketText(item.source))} · ${formatDateTime(item.updatedAt)}</span>
      </div>
      <div class="research-score"><span>${escapeHtml(item.score_type || "研究评分")}</span><strong>${formatNumber(item.hit_score)}</strong><small>${escapeHtml(item.level)}</small>${watchlistButton({ ...item, market: item.market || "A股", source: item.source || "单票研究" })}</div>
    </div>
    <section class="research-chart-block">
      <div class="research-block-title"><strong>价格趋势</strong><span>${item.points?.length || 0} 条历史数据 · ${escapeHtml(windowMap[item.window] || item.window || "当前周期")}</span></div>
      <div class="research-chart">${renderResearchChart(item.points)}</div>
    </section>
    <section class="research-metrics-block">
      <div class="research-block-title"><strong>核心指标</strong><span>实时行情与历史技术指标</span></div>
      <div class="research-metrics">
      ${metric("现价", metrics.price, formatPrice)}
      ${metric("涨跌幅", metrics.change_pct, formatPercent)}
      ${metric("区间变化", metrics.period_change_pct, formatPercent)}
      ${metric("量比", metrics.volume_ratio, formatNumber)}
      ${metric("换手率", metrics.turnover_rate, formatPercent)}
      ${metric("成交额", metrics.amount, formatMoney)}
      ${metric("MA5", metrics.ma5, formatNumber)}
      ${metric("MA20", metrics.ma20, formatNumber)}
      ${metric("RSI14", metrics.rsi14, formatNumber)}
      ${metric("MACD", metrics.macd, formatNumber)}
      ${metric("波动率", metrics.volatility, formatPercent)}
      </div>
    </section>
    <section class="research-insight-block">
      <div class="research-block-title"><strong>研究依据</strong><span>结构化证据与风险线索</span></div>
      <div class="research-columns">
      <section><h4>结构化证据</h4>${(item.evidence || []).map((row) => `<p><b>${escapeHtml(row.label)}</b><span>${escapeHtml(row.value)} · ${escapeHtml(row.detail)}</span></p>`).join("")}</section>
      <section><h4>优势线索</h4>${(item.strengths || []).map((text) => `<p class="hit">${escapeHtml(text)}</p>`).join("")}</section>
      <section><h4>风险线索</h4>${(item.risks || []).map((text) => `<p class="miss">${escapeHtml(text)}</p>`).join("")}</section>
      <section><h4>评分构成</h4>${(item.score_breakdown || []).length ? (item.score_breakdown || []).map((row) => `<p class="${row.available && row.points > 0 ? "hit" : row.available ? "miss" : ""}"><b>${escapeHtml(row.label)} ${formatNumber(row.points)}/${formatNumber(row.weight)}</b><span>${escapeHtml(row.detail)}</span></p>`).join("") : `<p>当前为筛选条件命中分，未启用研究评分构成。</p>`}</section>
      </div>
    </section>
    <section class="forecast-panel">
      <div class="forecast-head"><h4>未来研究预估</h4><span>${escapeHtml(forecast.model || "历史量价模型")}</span></div>
      <div class="forecast-grid">${horizons.length ? horizons.map((row) => `<article><b>${escapeHtml(row.horizon)}</b><strong>${escapeHtml(row.direction)}</strong><span>中心区间 ${formatPercent(row.expected_change_pct)}</span><small>可能范围 ${formatPercent(row.range_pct?.[0])} 至 ${formatPercent(row.range_pct?.[1])} · 置信度 ${escapeHtml(row.confidence || "低")}</small></article>`).join("") : `<div class="empty-state">历史样本不足，暂无研究预估。</div>`}</div>
      <p class="forecast-note">${(forecast.risks || []).map((text) => escapeHtml(text)).join(" ")}</p>
      <div class="forecast-history"><span>最近研究记录</span>${(item.forecastHistory || []).slice(0, 5).map((row) => `<small>${escapeHtml(row.created_at || "")} · ${escapeHtml(row.source || "本地量化研究")}</small>`).join("") || "<small>暂无历史记录</small>"}</div>
    </section>
    <div class="research-foot">周期：${windowMap[item.window] || item.window} · 历史数据：${item.historyStatus === "ok" ? `${item.points.length} 条` : "暂无"} · ${escapeHtml(item.disclaimer)}</div>
  `;
}

function renderResearchChart(points = []) {
  const values = points.map((point) => Number(point.close ?? point.value)).filter(Number.isFinite);
  if (values.length < 2) return `<div class="empty-state">暂无足够历史K线，无法绘制研究趋势。</div>`;
  const width = 760;
  const height = 180;
  const pad = { left: 8, right: 8, top: 14, bottom: 22 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (index) => pad.left + index / (values.length - 1) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - min) / range) * (height - pad.top - pad.bottom);
  const pointsText = values.map((value, index) => `${index ? "L" : "M"} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const last = values.at(-1);
  const first = values[0];
  const direction = last >= first ? "up" : "down";
  return `<svg viewBox="0 0 ${width} ${height}" class="research-line-chart" role="img" aria-label="历史价格趋势"><line class="research-baseline" x1="0" x2="${width}" y1="${y(first)}" y2="${y(first)}"/><path class="research-line ${direction}" d="${pointsText}"/><circle class="research-dot ${direction}" cx="${x(values.length - 1)}" cy="${y(last)}" r="4"/><text x="8" y="${height - 5}">${escapeHtml(points[0]?.time || "")}</text><text x="${width - 8}" y="${height - 5}" text-anchor="end">${escapeHtml(points.at(-1)?.time || "")}</text><text x="8" y="14">历史收盘价 · ${formatNumber(last)}</text></svg>`;
}

function renderRiskRadar(items) {
  const host = document.querySelector("#riskRadar");
  if (!host) return;
  if (!items.length) {
    host.innerHTML = `<div class="empty-state">暂无足够实时数据生成风险雷达。</div>`;
    return;
  }
  const sessions = ["早盘", "午盘", "收盘"];
  const visibleSessions = sessions.filter((session) => items.some((item) => (item.session || "收盘") === session));
  host.innerHTML = visibleSessions.map((session) => {
    const rows = items.filter((item) => (item.session || "收盘") === session);
    return `<details class="risk-session" data-risk-session="${session}" open><summary class="risk-session-title"><strong>${session}</strong><span>${rows.length} 项监控</span><i aria-hidden="true"></i></summary><div class="risk-session-body">${rows.map((item) => `
        <div class="risk-item risk-${item.level === "高" ? "high" : item.level === "中" ? "medium" : "low"}">
          <b>${escapeHtml(item.level || "暂无")}</b>
        <div><strong><em>${formatRiskText(item.category || "监控")}</em>${formatRiskText(item.title || "暂无风险项")}</strong><span>${formatRiskText(item.detail || "暂无说明")}</span>${item.aiNote ? `<span class="risk-ai-note">解读：${formatRiskText(item.aiNote)}</span>` : ""}<small class="risk-action">关注：${formatRiskText(item.aiAction || item.action || "继续观察数据变化")}</small><small>${escapeHtml(compactSignalSource(item.evidence || "规则扫描"))} · ${formatDateTime(item.updatedAt)}</small></div>
      </div>
    `).join("") || `<div class="risk-empty">暂无该时段数据</div>`}</div></details>`;
  }).join("");
}

function cleanSignalText(value) {
  return String(value || "").replace(/\*+/g, "").replace(/\s+/g, " ").trim();
}

function formatRiskText(value) {
  const text = escapeHtml(cleanSignalText(value));
  const tokenPattern = /(?<![\d.])[+-]\s*\d+(?:\.\d+)?\s*%|(?:上涨|涨超|反弹|回升|走高|净流入|流入|下跌|跌超|下滑|回落|走低|净流出|流出)\s*(?:超)?\d+(?:\.\d+)?\s*%|(?:A股|ETF|板块|指数|成交额|成交量|换手率|量比|市值|融资余额|北向资金|风险|资金|波动|放量|缩量|突破|跌破|高股息|半导体|银行|电力设备|人工智能|政策|公告|宏观|流动性|市场情绪)|\d+(?:\.\d+)?(?:万亿元|亿元|亿美元|万手|家|个)/g;
  return text.replace(tokenPattern, (token) => {
    const normalized = token.replace(/\s+/g, "");
    const tone = /^(?:\+|上涨|涨超|反弹|回升|走高|净流入|流入)/.test(normalized)
      ? "up"
      : /^(?:-|下跌|跌超|下滑|回落|走低|净流出|流出)/.test(normalized)
        ? "down"
        : "keyword";
    return `<mark class="risk-token risk-token-${tone}">${token}</mark>`;
  });
}

function decorateResearchPercentages(root) {
  if (!root) return;
  const pattern = /(?<![\d.])([+-]\s*\d+(?:\.\d+)?\s*%)/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(".research-percent, .risk-token")) continue;
    if (pattern.test(node.nodeValue || "")) nodes.push(node);
    pattern.lastIndex = 0;
  }
  nodes.forEach((textNode) => {
    const fragment = document.createDocumentFragment();
    const text = textNode.nodeValue || "";
    let cursor = 0;
    text.replace(pattern, (match, _value, offset) => {
      fragment.append(text.slice(cursor, offset));
      const mark = document.createElement("strong");
      mark.className = `research-percent ${match.trim().startsWith("+") ? "is-up" : "is-down"}`;
      mark.textContent = match;
      fragment.append(mark);
      cursor = offset + match.length;
      return match;
    });
    fragment.append(text.slice(cursor));
    textNode.replaceWith(fragment);
  });
}

function compactSignalSource(value) {
  return cleanSignalText(value)
    .replace(/Futu OpenD实时订阅 \+ 本地真实快照/g, "实时行情")
    .replace(/Futu OpenD/g, "Futu实时")
    .replace(/本地真实快照/g, "真实快照")
    .split(" / ").filter(Boolean).slice(0, 2).join(" / ");
}

function renderPrivateCandidates(items) {
  const host = document.querySelector("#privateCandidates");
  if (!host) return;
  host.innerHTML = items.length ? items.map((item) => `
    <tr>
      <td>${displayCode(item.code)}</td>
      <td>${item.name}</td>
      <td>${item.sector}</td>
      <td>${item.hit_score}</td>
      <td>${formatPercent(item.change_pct)}</td>
      <td>${formatNullable(item.volume_ratio)}</td>
      <td>${formatPercent(item.turnover_rate)}</td>
      <td>${escapeHtml(item.reason || "暂无")}</td>
      <td>${watchlistButton({ ...item, market: "A股", source: item.source_name || "自用候选池" })}</td>
    </tr>
  `).join("") : `<tr><td colspan="9"><div class="empty-state">当前没有同时满足候选池规则的标的，系统不会用股票池前排数据填充。</div></td></tr>`;
}

function movingAverage(values, windowSize) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function matchesKeyword(item, keyword, fields) {
  const query = String(keyword || "").trim().toLowerCase();
  if (!query) return true;
  return fields.some((field) => {
    const value = item[field];
    if (Array.isArray(value)) return value.join(" ").toLowerCase().includes(query);
    return String(value ?? "").toLowerCase().includes(query);
  });
}

function hasWindowData(windowKey) {
  if (windowKey === "today") return true;
  return selectedIndexes().some((item) => {
    const cached = state.historyCache.get(`${windowKey}:${item.code}`);
    return cached?.points?.length >= 2;
  });
}

function windowChangeValue(item, windowKey) {
  if (windowKey === "today") return item.windows?.today ?? item.change_pct;
  const cached = state.historyCache.get(`${windowKey}:${item.code}`);
  if (cached?.points?.length >= 2) {
    const first = Number(cached.points[0].value ?? cached.points[0].close);
    const last = Number(cached.points.at(-1).value ?? cached.points.at(-1).close);
    return first ? ((last - first) / first) * 100 : null;
  }
  return null;
}

function sectorKeywords(sector) {
  return [
    sector?.name,
    sector?.signal,
    ...(sector?.leaders || [])
  ].filter(Boolean).map((item) => String(item).toLowerCase());
}

function matchSectorStocks(sector) {
  const keywords = sectorKeywords(sector);
  return state.allStocks
    .filter((item) => keywords.some((keyword) => [item.sector, item.name, item.code].some((value) => String(value || "").toLowerCase().includes(keyword) || keyword.includes(String(value || "").toLowerCase()))))
    .sort((a, b) => compareValues(a.change_pct, b.change_pct, "desc", "change_pct"));
}

function matchSectorEtfs(sector) {
  const keywords = sectorKeywords(sector);
  return state.etfs
    .filter((item) => keywords.some((keyword) => [item.category, item.tracking, item.name, item.code].some((value) => String(value || "").toLowerCase().includes(keyword) || keyword.includes(String(value || "").toLowerCase()))))
    .sort((a, b) => compareValues(a.change_pct, b.change_pct, "desc", "change_pct"));
}

function renderMiniRows(rows, fields) {
  const labels = {
    code: "代码",
    name: "名称",
    change_pct: "涨跌幅",
    turnover_rate: "换手",
    volume_ratio: "量比",
    amount: "成交额",
    net_inflow: "净流入"
  };
  return `
    <div class="mini-table-wrap">
      <table class="mini-table">
        <thead><tr>${fields.map((field) => `<th>${labels[field] || field}</th>`).join("")}<th>自选</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr>${fields.map((field) => `<td>${formatMiniField(row[field], field)}</td>`).join("")}<td>${watchlistButton({ ...row, market: row.market || "A股", source: row.source_name || "板块详情" })}</td></tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function paginate(rows, requestedPage, pageSize) {
  const size = Math.max(1, Number(pageSize) || 8);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const page = clamp(Number(requestedPage) || 1, 1, totalPages);
  const start = (page - 1) * size;
  return {
    rows: rows.slice(start, start + size),
    page,
    pageSize: size,
    total,
    totalPages
  };
}

function renderPager(selector, page, onChange) {
  const host = document.querySelector(selector);
  if (!host) return;
  host.innerHTML = `
    <button class="ghost-button" data-page="${page.page - 1}" ${page.page <= 1 ? "disabled" : ""}>上一页</button>
    <span>第 ${page.page} / ${page.totalPages} 页 · ${page.total} 条</span>
    <button class="ghost-button" data-page="${page.page + 1}" ${page.page >= page.totalPages ? "disabled" : ""}>下一页</button>
  `;
  host.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const nextPage = Number(button.dataset.page);
      if (Number.isFinite(nextPage)) onChange(nextPage);
    });
  });
}

function bindTrendCrosshair(svg, selected, points, pad, width, height) {
  const crosshair = svg.querySelector("#trendCrosshair");
  const lineX = svg.querySelector("#crosshairX");
  const lineY = svg.querySelector("#crosshairY");
  const box = svg.querySelector("#crosshairBox");
  const text1 = svg.querySelector("#crosshairText1");
  const text2 = svg.querySelector("#crosshairText2");
  if (!crosshair || !lineX || !lineY || !box || !text1 || !text2) return;
  svg.onmousemove = (event) => {
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    if (x < pad.left || x > width - pad.right || y < pad.top || y > height - pad.bottom) {
      crosshair.setAttribute("opacity", "0");
      return;
    }
    if (selected.isToday && isLunchBreakX(x, pad.left, width - pad.right)) {
      crosshair.setAttribute("opacity", "0");
      return;
    }
    let index = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    points.forEach(([pointX], candidateIndex) => {
      const distance = Math.abs(pointX - x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        index = candidateIndex;
      }
    });
    const [px, py] = points[index];
    const point = selected.points[index];
    if (!point) {
      crosshair.setAttribute("opacity", "0");
      return;
    }
    lineX.setAttribute("x1", px);
    lineX.setAttribute("x2", px);
    lineY.setAttribute("y1", py);
    lineY.setAttribute("y2", py);
    const boxX = px > width - pad.right - 132 ? px - 128 : px + 10;
    const boxY = py < pad.top + 54 ? py + 12 : py - 56;
    box.setAttribute("x", boxX);
    box.setAttribute("y", boxY);
    text1.setAttribute("x", boxX + 10);
    text1.setAttribute("y", boxY + 18);
    text2.setAttribute("x", boxX + 10);
    text2.setAttribute("y", boxY + 36);
    text1.textContent = point.time;
    text2.textContent = formatNumber(point.value);
    crosshair.setAttribute("opacity", "1");
  };
  svg.onmouseleave = () => crosshair.setAttribute("opacity", "0");
}

function selectRegionTrend(region) {
  const fallback = state.markets.find((market) => market.region === region)?.indexes?.[0]?.code;
  state.selectedTrend = regionTrendMap[region] || fallback || state.selectedTrend;
  renderTrendSelect();
  renderTrendChart();
  loadSelectedHistoryTrend();
}

function articleTypeToSession(type) {
  if (type === "早盘观察") return "preopen";
  if (type === "午间快评") return "midday";
  return "close";
}

function sessionName(session) {
  return { preopen: "盘前风向", midday: "午间复盘", close: "收盘总结" }[session] || "收盘总结";
}

function scopeLabel(scope) {
  return { ashare: "A股/代码", etf: "ETF", sector: "板块", global: "海外", history: "历史K线", "sector-members": "板块成分", news: "公开资讯", all: "全量数据" }[scope] || "数据";
}

function startAutoSync() {
  state.nextSyncAt = Date.now() + 60_000;
  state.syncTimer = setInterval(async () => {
    const remain = Math.max(0, state.nextSyncAt - Date.now());
    document.querySelector("#syncCountdown").textContent = `下次同步 ${Math.ceil(remain / 1000)}s`;
    if (remain > 0 || state.syncBusy) return;
    state.syncBusy = true;
    try {
      const status = await fetchJson("/api/data/refresh-status");
      const scheduler = status.scheduler || {};
      const nextAt = new Date(scheduler.nextRunAt || "").getTime();
      if (Number.isFinite(nextAt) && nextAt > Date.now()) state.nextSyncAt = nextAt;
      await Promise.all([loadMarkets(), loadTrends(), loadEtfs(), loadSectorFlows(), loadPrivateSignal(), loadSettings(), loadPaperStatus({ syncConfig: false })]);
    } catch {
      // The server owns collection; this client retry only refreshes the displayed state.
    } finally {
      if (state.nextSyncAt <= Date.now()) state.nextSyncAt = Date.now() + 60_000;
      state.syncBusy = false;
    }
  }, 1000);
  state.paperTimer = setInterval(async () => {
    if (state.paper?.configured && document.querySelector("#paper.view.active")) await loadPaperStatus({ syncConfig: false });
  }, 3000);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`请求失败: ${url}`);
  return response.json();
}

async function requestJson(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `请求失败: ${url}`);
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `请求失败: ${url}`);
  return data;
}

function trendScore(label, change) {
  const base = { "强势": 90, "偏强": 70, "震荡": 50, "偏弱": 30, "风险": 10 }[label] ?? 40;
  return base + Number(change || 0);
}

function compareValues(a, b, direction = "desc", field = "") {
  const aMissing = a === null || a === undefined || a === "";
  const bMissing = b === null || b === undefined || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let result;
  if (field.includes("time") || field.endsWith("_at")) {
    result = new Date(a).getTime() - new Date(b).getTime();
  } else {
    const an = Number(a);
    const bn = Number(b);
    result = Number.isFinite(an) && Number.isFinite(bn)
      ? an - bn
      : String(a).localeCompare(String(b), "zh-Hans-CN");
  }
  return direction === "asc" ? result : -result;
}

function formatField(value, field) {
  if (field === "code") return displayCode(value);
  if (field === "amount" || field === "market_cap" || field === "float_market_cap") return formatMoney(value);
  if (field === "change_pct" || field === "turnover_rate" || field === "amplitude") return formatPercent(value);
  return formatNullable(value);
}

function formatMiniField(value, field) {
  if (field === "code") return displayCode(value);
  if (field === "amount") return formatMoney(value);
  if (field === "net_inflow") return formatMoneySigned(value);
  if (field === "change_pct" || field === "turnover_rate") return formatPercent(value);
  return escapeHtml(formatNullable(value));
}

function formatMoney(value) {
  if (value === null || value === undefined) return "暂无";
  const n = Number(value);
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

function formatMoneySigned(value) {
  if (value === null || value === undefined) return "暂无";
  const n = Number(value);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${formatMoney(Math.abs(n))}`;
}

function formatSectorMoneySigned(value) {
  if (value === null || value === undefined) return "暂无";
  const n = Number(value);
  if (!Number.isFinite(n)) return "暂无";
  const abs = Math.abs(n);
  const text = abs > 0 && abs < 10000 ? `${abs.toFixed(2)}亿` : formatMoney(abs);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${text}`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "暂无";
  const n = Number(value);
  if (!Number.isFinite(n)) return "暂无";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatIndexPoint(value) {
  return formatNumber(value);
}

function formatChartVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "暂无";
  if (number >= 100000000) return `${(number / 100000000).toFixed(1)}亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`;
  return number.toFixed(0);
}

function formatIndexPointSigned(value) {
  if (value === null || value === undefined || value === "") return "暂无";
  const n = Number(value);
  if (!Number.isFinite(n)) return "暂无";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}`;
}

function formatPrice(value) {
  const text = formatNumber(value);
  return text === "暂无" ? text : `${text}元`;
}

function formatPercent(value) {
  if (value === null || value === undefined) return "暂无";
  const n = Number(value);
  if (!Number.isFinite(n)) return "暂无";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatSigned(value) {
  if (value === null || value === undefined) return "暂无";
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}`;
}

function formatNullable(value) {
  return value === null || value === undefined || value === "" ? "暂无" : value;
}

function displayCode(value) {
  const text = String(value || "");
  if (!text) return "暂无";
  if (/^(sh|sz|bj)\.?\d{6}$/i.test(text)) return text.replace(/^(sh|sz|bj)\.?/i, "");
  if (/^\d{6}\.(SH|SZ|BJ)$/i.test(text)) return text.slice(0, 6);
  return escapeHtml(text);
}

function compactSource(value, maxLength = 18) {
  const text = String(value || "暂无");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatDateTime(value) {
  if (!value) return "--";
  const text = String(value);
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) return `今日 ${text}`;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? text : new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function setFreshness(updatedAt, source) {
  document.querySelector("#freshness").textContent = `${cleanMarketText(source)} · ${formatDateTime(updatedAt)}`;
  document.querySelector(".side-note strong").textContent = cleanMarketText(source) || "暂无数据";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function debounce(callback, delay = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function cleanMarketText(value) {
  return String(value || "")
    .replaceAll("真实快照趋势", "趋势")
    .replaceAll("真实快照", "最近数据")
    .replaceAll("上一快照", "最近数据")
    .replaceAll("快照", "记录");
}

function markdownToHtml(markdown) {
  return String(markdown)
    .split(/\n{2,}/)
    .map((block) => {
      const text = escapeHtml(block.trim());
      if (!text) return "";
      if (text.startsWith("# ")) return `<h1>${text.slice(2)}</h1>`;
      if (text.startsWith("## ")) return `<h2>${text.slice(3)}</h2>`;
      return `<p>${text.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

function extractTitle(markdown) {
  return String(markdown).split("\n").find((line) => line.startsWith("# "))?.replace(/^#\s+/, "") || "今日市场观察";
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function showProgress(title, message) {
  const modal = document.querySelector("#progressModal");
  if (!modal) return;
  document.querySelector("#progressTitle").textContent = title || "正在处理";
  document.querySelector("#progressMessage").textContent = message || "请稍候。";
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function updateProgress(title, message) {
  const modal = document.querySelector("#progressModal");
  if (!modal || !modal.classList.contains("show")) return;
  document.querySelector("#progressTitle").textContent = title || "正在处理";
  document.querySelector("#progressMessage").textContent = message || "请稍候。";
}

function hideProgress() {
  const modal = document.querySelector("#progressModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}
