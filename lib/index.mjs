// dsh-usage-stats —— 使用统计(宿主侧)
// 扫描全历史会话(sessionPersistence.list + open/read/close),回放事件聚合 Token 用量:
//   - 按天聚合(趋势图 + 热力图素材)
//   - 按小时聚合到天(单日窗口"按小时"趋势图素材)
//   - 按模型聚合(仪表盘)
//   - 额外统计:会话数、消息数、活跃天数、当前连续天数、最常用模型
// 暴露 GET /api/usage-stats   (?refresh=1 强制重新扫描)
// 性能:扫描结果做内存缓存 + 磁盘持久化缓存;过期后"先返回旧数据、后台异步刷新"(SWR),
//       首屏由磁盘缓存秒速渲染,不再因全量扫描卡顿。
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const inject = ["sessionPersistence", "webServer"];

// 已知模型 → 固定颜色(与「使用统计子组件库」视觉一致);其余按名称散列取调色板
const MODEL_COLORS = {
  "GLM-5.2": "#3d91e7",
  "jiaorong-deepseek-v4-pro": "#41b87b",
  "glm-5.2": "#8c64ef",
  "deepseek-v4-flash": "#ff4d4f",
  "deepseek-v4-pro": "#faad14",
};
const FALLBACK_PALETTE = [
  "#4da6ff", "#50d682", "#a684ff", "#ff7a9e", "#f2b95b",
  "#5ad0ce", "#e07bd0", "#7ac04f", "#e28a5a", "#6d8ef2",
];

function modelColor(model) {
  if (MODEL_COLORS[model]) return MODEL_COLORS[model];
  let h = 0;
  for (let i = 0; i < model.length; i++) h = (h * 31 + model.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

// 把 UNIX 毫秒时间戳折叠成本地日期键 YYYY-MM-DD
function dateKey(ms) {
  try {
    const d = new Date(ms);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  } catch {
    return null;
  }
}

// 本地小时 0-23
function hourOf(ms) {
  try {
    return new Date(ms).getHours();
  } catch {
    return null;
  }
}

function emptyMetrics() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function addMetrics(target, usage) {
  const input = typeof usage?.inputTokens === "number" ? usage.inputTokens : 0;
  const output = typeof usage?.outputTokens === "number" ? usage.outputTokens : 0;
  const cacheRead = typeof usage?.cacheReadTokens === "number" ? usage.cacheReadTokens : 0;
  const cacheWrite = typeof usage?.cacheWriteTokens === "number" ? usage.cacheWriteTokens : 0;
  target.input += input;
  target.output += output;
  target.cacheRead += cacheRead;
  target.cacheWrite += cacheWrite;
  target.total += input + output + cacheRead + cacheWrite;
}

function usageTotal(usage) {
  if (!usage) return 0;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

// 有限并发池:最多并发 limit 个任务;超过 deadline(ms) 提前返回部分结果(已处理的计入)
async function mapLimit(items, limit, deadline, fn) {
  const out = new Array(items.length);
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      if (Date.now() > deadline) return; // 超时:跳过未处理项,保留已处理结果(部分结果)
      const cur = i++;
      out[cur] = await fn(items[cur], cur);
    }
  };
  const n = Math.max(1, Math.min(limit || 8, items.length) || 1);
  await Promise.all(Array.from({ length: n }, run));
  return out;
}

// 一次全量扫描:返回聚合数据结构
async function scanSessions(sessionPersistence, { timeoutMs = 20000 } = {}) {
  const days = new Map();   // dateKey -> { total, turns, byModel: Map(model->metrics) }
  const hourly = new Map(); // dateKey -> Map<hour, { total, byModel: Map(model->metrics) }>
  const modelTotals = new Map(); // model -> metrics
  const warnings = []; // 扫描过程中的失败/降级提示(供前端展示)
  const deadline = Date.now() + timeoutMs;

  const ensureDay = (key) => {
    let d = days.get(key);
    if (!d) {
      d = { total: 0, turns: 0, byModel: new Map() };
      days.set(key, d);
    }
    return d;
  };
  const ensureModel = (map, model) => {
    let m = map.get(model);
    if (!m) {
      m = emptyMetrics();
      map.set(model, m);
    }
    return m;
  };
  // account:按天 + 按小时 同时累计(小时供单日窗口趋势图,规范)
  const account = (dayKey, hour, model, usage) => {
    if (!dayKey) return;
    const day = ensureDay(dayKey);
    const dayModel = ensureModel(day.byModel, model);
    const cumModel = ensureModel(modelTotals, model);
    addMetrics(dayModel, usage);
    addMetrics(cumModel, usage);
    day.total += usageTotal(usage);
    if (typeof hour === "number") {
      let hm = hourly.get(dayKey);
      if (!hm) { hm = new Map(); hourly.set(dayKey, hm); }
      let hb = hm.get(hour);
      if (!hb) { hb = { total: 0, byModel: new Map() }; hm.set(hour, hb); }
      const hmModel = ensureModel(hb.byModel, model);
      addMetrics(hmModel, usage);
      hb.total += usageTotal(usage);
    }
  };

  let sessions;
  let messageCount = 0;
  try {
    sessions = sessionPersistence.list ? await sessionPersistence.list() : [];
  } catch (e) {
    sessions = [];
    warnings.push("无法枚举会话：" + (e && e.message ? e.message : e));
  }

  const scanOne = async (snap) => {
    // 新版 sessionPersistence.list() 返回快照 {header, ...};旧版直接返回 header
    const header = snap && typeof snap === "object" && snap.header ? snap.header : snap;
    const id = header && header.id;
    if (!id) {
      warnings.push("会话读取失败：快照缺少会话 id");
      return;
    }
    let events;
    let handle;
    try {
      if (typeof sessionPersistence.open === "function") {
        // DSH >= 0.2 的持久化 seam:open(id,'read') 拿读句柄,read(from,to) 取事件,用完 close
        handle = await sessionPersistence.open(id, "read");
        ({ events } = await handle.read(0, undefined));
      } else {
        // 旧版(README 锁定的 0.1.x)seam:readFrom(id, from)
        ({ events } = await sessionPersistence.readFrom(id, 0));
      }
    } catch (e) {
      warnings.push("会话读取失败 " + id + "：" + (e && e.message ? e.message : e));
      return;
    } finally {
      if (handle) { try { await handle.close(); } catch { /* 忽略关闭失败 */ } }
    }
    // currentModel 缺失时归一为 "other"(杂项),避免 unknown 散落为独立饼块(规范 H6)
    let currentModel = "other";
    let lastTurn = null;
    const seenSteps = new Set();
    const accountOnce = (model, ev, usage) => {
      const turn = ev.data?.turn;
      const step = ev.data?.step;
      if (typeof turn === "number" && typeof step === "number") {
        const stepKey = `${turn}:${step}`;
        if (seenSteps.has(stepKey)) return;
        seenSteps.add(stepKey);
      }
      account(dateKey(ev.time), hourOf(ev.time), model, usage);
    };
    for (const ev of events || []) {
      if (!ev || typeof ev !== "object") continue;
      switch (ev.type) {
        case "request/context":
          currentModel = ev.data && typeof ev.data.model === "string" ? ev.data.model : currentModel;
          break;
        case "request/header": {
          // v4:请求头里带完整 config(provider/model),作为 currentModel 的权威来源之一
          const cfg = ev.data && ev.data.header && ev.data.header.config;
          if (cfg && typeof cfg.model === "string" && cfg.model) currentModel = cfg.model;
          break;
        }
        case "step/end":
          // turns 官方口径:一个新 turn 记 1 次。以 step/end 为权威——每个 step 必然发出,
          // 覆盖 completed/failed/cancelled/max-tokens;而 assistant/message 会漏 cancelled、多算 max-tokens。
          if (typeof ev.data.turn === "number" && ev.data.turn !== lastTurn) {
            lastTurn = ev.data.turn;
            const key = dateKey(ev.time);
            if (key) ensureDay(key).turns += 1;
          }
          break;
        case "assistant/message":
          messageCount += 1;
          // usage 只在每步一次的全量 assistant/message 上取;assistant/chunk 的 usage 是同一步的相同全量值,再计会重复,故不再消费
          if (ev.data && ev.data.usage !== undefined) {
            // 优先从消息 source 取模型(v4),再退到消息自身 model 字段(旧格式),最后兜底 currentModel / other
            const src = ev.data.message && ev.data.message.source;
            const m = (src && typeof src.model === "string" && src.model)
              || (typeof ev.data.model === "string" && ev.data.model)
              || currentModel;
            accountOnce(m, ev, ev.data.usage);
          }
          break;
        default:
          break;
      }
    }
  };

  // 有限并发读取会话(规范 H4);越期自动停止(规范 H5 超时保护)
  await mapLimit(sessions || [], 8, deadline, scanOne);
  if (Date.now() > deadline) warnings.push("扫描超时，返回部分统计结果");

  // 计算当前连续活跃天数
  let currentStreak = 0;
  const sortedDates = [...days.keys()].sort();
  if (sortedDates.length > 0) {
    const todayKey = dateKey(Date.now());
    const lastActive = sortedDates[sortedDates.length - 1];
    if (lastActive === todayKey) {
      currentStreak = 1;
      const d = new Date();
      while (true) {
        d.setDate(d.getDate() - 1);
        if (days.has(dateKey(d.getTime()))) {
          currentStreak += 1;
        } else {
          break;
        }
      }
    }
  }

  return { days, hourly, modelTotals, sessionCount: sessions.length, messageCount, currentStreak, warnings };
}

// ---------- 缓存 ----------
// 内存 + 磁盘双层缓存;SWR:过期后先返回旧数据、后台异步刷新,首屏不因全量扫描阻塞。
let cache = null;
let cacheAt = 0;
const CACHE_TTL = 60_000; // 60s 后触发后台刷新(SWR)
let inflight = null; // 并发重扫互斥:并发期间共享同一份扫描结果(规范 H3)

function cacheFilePath() {
  return join(homedir(), ".dsh", "profiles", "web", "usage-stats-cache.json");
}

async function loadDiskCache() {
  try {
    const s = await readFile(cacheFilePath(), "utf8");
    const j = JSON.parse(s);
    if (j && typeof j === "object" && (j.ok || j.error)) return j;
    return null;
  } catch {
    return null;
  }
}

async function persistDiskCache(data) {
  const p = cacheFilePath();
  const tmp = p + ".tmp";
  try {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, p).catch(() => writeFile(p, JSON.stringify(data), "utf8"));
  } catch {
    // 写盘失败不影响主流程(下次启动退化回全量扫描)
  }
}

// 把扫描结果转成可序列化、可直接返回给前端的响应结构
function buildCache(s) {
  const dayList = [...s.days.entries()]
    .map(([date, d]) => {
      const hours = [...(s.hourly.get(date) || new Map()).entries()]
        .map(([hour, o]) => ({
          hour,
          total: o.total,
          byModel: [...o.byModel.entries()].map(([model, m]) => ({ model, color: modelColor(model), ...m })),
        }))
        .sort((a, b) => a.hour - b.hour);
      return {
        date,
        total: d.total,
        turns: d.turns,
        byModel: [...d.byModel.entries()].map(([model, m]) => ({ model, color: modelColor(model), ...m })),
        hours: hours.length > 0 ? hours : undefined,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const totals = [...s.modelTotals.entries()]
    .map(([model, m]) => ({ model, color: modelColor(model), ...m }))
    .sort((a, b) => b.total - a.total);
  const grandTotal = totals.reduce((sum, m) => sum + m.total, 0);
  const top = totals[0];
  const topModel = top
    ? { name: top.model, color: top.color, tokens: top.total, percent: grandTotal > 0 ? Math.round((top.total / grandTotal) * 100) : 0 }
    : null;
  return {
    ok: true,
    generatedAt: Date.now(),
    sessionCount: s.sessionCount,
    messageCount: s.messageCount,
    dayCount: dayList.length,
    currentStreak: s.currentStreak,
    grandTotal,
    topModel,
    totals,
    days: dayList,
    warnings: s.warnings, // 失败/降级提示(规范 H5)
  };
}

export function apply(ctx) {
  const { sessionPersistence, webServer } = ctx;
  if (!webServer) return;

  // 启动时异步加载磁盘缓存,回填内存(不阻塞 apply)
  loadDiskCache().then((c) => { if (c && c.ok && !cache) { cache = c; cacheAt = c.generatedAt || 0; } });

  const ensureScan = () => {
    if (!inflight) {
      inflight = (async () => {
        const s = await scanSessions(sessionPersistence, { timeoutMs: 20000 });
        const built = buildCache(s);
        cache = built;
        cacheAt = built.generatedAt;
        try { await persistDiskCache(built); } catch { /* 忽略写盘失败 */ }
      })().catch((e) => {
        cache = { ok: false, error: String(e && e.message ? e.message : e), generatedAt: Date.now() };
        cacheAt = Date.now();
      }).finally(() => { inflight = null; });
    }
    return inflight;
  };

  webServer.register({
    kind: "exact",
    path: "/api/usage-stats",
    handler: async (req, res) => {
      const url = new URL(req.url, "http://x");
      const refresh = url.searchParams.get("refresh") === "1";
      if (!cache || refresh) {
        // 无缓存:必须同步扫描首屏等待;或强制刷新:等待新结果
        await ensureScan();
      } else {
        // 有缓存:立即返回;若过期则后台异步刷新,不阻塞本次响应(SWR)
        const stale = Date.now() - (cache.generatedAt || 0) > CACHE_TTL;
        if (stale) ensureScan();
      }
      res.writeHead(cache && cache.ok ? 200 : 500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(cache));
    },
  });
}