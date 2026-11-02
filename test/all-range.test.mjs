// 「全部（累积）」范围回归测试：零依赖，用 React 桩件渲染插件客户端组件树后做断言。
//
//   node test/all-range.test.mjs
//   node test/all-range.test.mjs path/to/usage-stats-export.json   # 可选：叠加真实数据断言
//
// 覆盖点：
//   1. 「全部」tab 存在且唯一，激活态正确
//   2. 「全部」下 tokens / 活跃天数与宿主全量口径一致（grandTotal、dayCount 守恒）
//   3. 长区间趋势图自动降采样（周 / 月 / 季度），绘图点数被控制在 60 左右且总量不变
//   4. 原有 6 个预设范围 + 自定义区间无回归；单日窗口仍按小时
//   5. 空数据、全量仅 1 天等边界
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "lib", "client.js");
const src = fs.readFileSync(CLIENT, "utf8");

// ---------- React 桩件 ----------
// UsageStatsView 的 useState 顺序：data, error, loading, range, showCustom, customFrom, customTo, dpOpen
// 子组件的 hook 一律取初始值即可（本测试不做交互，只渲染一次）
function makeReact(rangeState, dataOverride) {
	let hookIdx = 0;
	const vals = [dataOverride, null, true, rangeState, false, "", "", null];
	const react = {
		Fragment: "Fragment",
		createElement: (type, props, ...children) => {
			if (typeof type === "function") return type({ ...(props || {}) }); // 渲染函数子组件
			return {
				type,
				props: props || {},
				children: children.flat(9).filter((c) => c !== null && c !== undefined && typeof c !== "boolean"),
			};
		},
		useState: (initial) => {
			const i = hookIdx++;
			const v = i < vals.length ? vals[i] : typeof initial === "function" ? initial() : initial;
			return [v, () => {}];
		},
		useEffect: () => {},
		useMemo: (fn) => fn(),
		useCallback: (fn) => fn,
		useRef: (v) => ({ current: v ?? null }),
	};
	return react;
}

// 载入插件并渲染 UsageStatsView
function render(rangeState, dataOverride) {
	const react = makeReact(rangeState, dataOverride);
	let exports;
	globalThis.window = {
		innerWidth: 1440,
		innerHeight: 900,
		__ModuleLoader__: {
			load: (o) => {
				exports = o.factory((name) => {
					if (name === "react") return react;
					throw new Error("unexpected require: " + name);
				});
			},
		},
	};
	new Function("window", src)(globalThis.window);
	let View = null;
	exports.apply({
		effect() {},
		slots: { inject(_name, fn) { fn(); }, register(_opts, comp) { View = comp; } },
	});
	if (!View) throw new Error("UsageStatsView 未注册");
	return View();
}

// ---------- 遍历工具 ----------
const cls = (n) => (n.props && typeof n.props.className === "string" ? n.props.className : "");
function texts(node, out = []) {
	if (node === null || node === undefined || typeof node === "boolean") return out;
	if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
	if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
	if (node.children) texts(node.children, out);
	return out;
}
function findAll(node, pred, out = []) {
	if (!node || typeof node !== "object") return out;
	if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out; }
	if (pred(node)) out.push(node);
	findAll(node.children, pred, out);
	return out;
}
const byCls = (tree, c) => findAll(tree, (n) => cls(n) === c);
const labelsOf = (tree, c) => byCls(tree, c).map((x) => texts(x).join(""));

// ---------- 断言 ----------
let pass = 0, fail = 0;
const ok = (cond, label, extra = "") => {
	if (cond) { pass++; console.log("  ok   " + label); }
	else { fail++; console.log("  FAIL " + label + (extra ? " :: " + extra : "")); }
};

const fmtLarge = (n) => (n >= 1e8 ? (n / 1e8).toFixed(2) + "亿" : n >= 1e4 ? (n / 1e4).toFixed(1) + "万" : String(n));
const key = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

// 造最近 n 天的全量数据（保证今天/昨天/最近7·30天/本月/上月都有可核对的内容）
function synthRecentDays(n, gapDays = 1) {
	const out = [];
	const base = new Date();
	for (let i = n - 1; i >= 0; i--) {
		const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i * gapDays);
		const ds = key(d);
		const seq = n - i;
		out.push({
			date: ds,
			total: 1000 * seq,
			turns: seq % 20,
			byModel: [
				{ model: "model-a", color: "#3d91e7", input: 600 * seq, output: 300 * seq, cacheRead: 100 * seq, cacheWrite: 0, total: 1000 * seq },
				{ model: "model-b", color: "#41b87b", input: 200 * seq, output: 100 * seq, cacheRead: 0, cacheWrite: 0, total: 300 * seq },
			],
			hours: [{ hour: 9, total: 400 * seq, byModel: [{ model: "model-a", color: "#3d91e7", input: 400 * seq, output: 0, cacheRead: 0, cacheWrite: 0, total: 400 * seq }] }],
		});
	}
	return out;
}
// 造固定起点、连续跨多年的数据（用于触发周/月/季度聚合档位）
function synthSpanDays(n, stepDays = 1, startDate = "2024-01-01") {
	const [y, m, d0] = startDate.split("-").map(Number);
	const cur = new Date(y, m - 1, d0);
	const out = [];
	for (let i = 0; i < n; i++) {
		const ds = key(cur);
		out.push({
			date: ds,
			total: 1000 + i,
			turns: 2,
			byModel: [{ model: "model-a", color: "#3d91e7", input: 100 + i, output: 5, cacheRead: 0, cacheWrite: 0, total: 1000 + i }],
		});
		cur.setDate(cur.getDate() + stepDays);
	}
	return out;
}
function toApi(days) {
	const grandTotal = days.reduce((s, d) => s + d.total, 0);
	const totals = new Map();
	days.forEach((d) => (d.byModel || []).forEach((m) => totals.set(m.model, (totals.get(m.model) || 0) + m.total)));
	return {
		ok: true,
		generatedAt: Date.now(),
		sessionCount: 42,
		messageCount: 1234,
		dayCount: days.length,
		currentStreak: 3,
		grandTotal,
		topModel: { name: "model-a", color: "#3d91e7", tokens: totals.get("model-a") || 0, percent: 70 },
		totals: [...totals.entries()].map(([model, total]) => ({ model, color: "#3d91e7", total })),
		days,
		warnings: [],
	};
}

const dataOf = (tree) => texts(tree).find((s) => s.indexOf("tokens 用量") === 0) || labelsOf(tree, "ust-stat-card")[0] || "";
const cardValue = (tree, idx) => (byCls(tree, "ust-stat-card")[idx] ? texts(byCls(tree, "ust-stat-card")[idx]).join("") : "");
const tabNodes = (tree) => findAll(tree, (n) => cls(n).startsWith("ust-tab") && !cls(n).includes("ust-tabs"));
const activeTabs = (tree) => tabNodes(tree).filter((t) => t.props.className.includes("active")).map((t) => texts(t).join(""));
const trendTitle = (tree) => labelsOf(tree, "ust-section-title").find((s) => s.includes("Token 趋势")) || "";

// ================= 1) 「全部」基本口径 =================
console.log("[1] 全部范围：数据口径与 tab");
{
	const api = toApi(synthRecentDays(30));
	const tree = render({ id: "all" }, api);
	const tabLabels = tabNodes(tree).map((t) => texts(t).join(""));
	console.log("  tabs: " + JSON.stringify(tabLabels));
	ok(tabLabels.includes("全部"), "存在「全部」tab");
	ok(tabLabels.filter((l) => l === "全部").length === 1, "「全部」只出现一次");
	ok(activeTabs(tree).length === 1 && activeTabs(tree)[0] === "全部", "「全部」为唯一高亮项: " + JSON.stringify(activeTabs(tree)));
	ok(cardValue(tree, 0).includes(fmtLarge(api.grandTotal)), "tokens 卡片 == 全量 grandTotal " + fmtLarge(api.grandTotal) + " :: " + cardValue(tree, 0));
	ok(cardValue(tree, 3).includes(String(api.dayCount)), "活跃天数 == dayCount " + api.dayCount + " :: " + cardValue(tree, 3));
	ok(cardValue(tree, 1).includes(String(api.sessionCount)), "会话数为累计口径 :: " + cardValue(tree, 1));
	const note = texts(tree).find((s) => s.indexOf("全部区间：") === 0) || "";
	ok(note.includes(api.days[0].date) && note.includes(api.days[api.days.length - 1].date), "说明行标注实际起止 :: " + note);
	ok(/30 天有活动/.test(note), "说明行标注有活动天数 :: " + note);
	ok(trendTitle(tree) === "按天 Token 趋势（全部）", "30 天不触发聚合 :: " + trendTitle(tree));
	const cells = findAll(tree, (n) => cls(n).startsWith("ust-cell"));
	ok(cells.length > 0 && cells.length % 7 === 0, "热力图按整列渲染 count=" + cells.length);
	ok(cells.filter((c) => !String(c.props.key).startsWith("empty-")).length === api.dayCount, "热力图有数据格子 == dayCount");
	ok(byCls(tree, "ust-mlegend")[0].children.length === 2, "环形图列出全部模型");
}

// ================= 2) 长区间自动降采样 =================
console.log("[2] 长区间：自动按周/月/季度聚合");
{
	const cases = [
		{ n: 40, expect: "按天", maxPoints: 40, noteGranularity: false },
		{ n: 100, expect: "按周", maxPoints: 62, noteGranularity: true },
		{ n: 500, expect: "按月", maxPoints: 62, noteGranularity: true },
		{ n: 2000, expect: "按季度", maxPoints: 62, noteGranularity: true },
	];
	for (const c of cases) {
		const days = synthSpanDays(c.n);
		const api = toApi(days);
		const tree = render({ id: "all" }, api);
		const title = trendTitle(tree);
		ok(title.includes(c.expect + " Token 趋势（全部）"), c.n + " 天 → " + c.expect + " :: " + title);
		const xs = new Set(findAll(tree, (n) => cls(n) === "ust-area-dot").map((d) => d.props.cx));
		ok(xs.size <= c.maxPoints, c.n + " 天折线点数受控 uniqueX=" + xs.size);
		ok(cardValue(tree, 0).includes(fmtLarge(api.grandTotal)), c.n + " 天总量守恒 :: " + cardValue(tree, 0));
		const note = texts(tree).find((s) => s.indexOf("全部区间：") === 0) || "";
		if (c.noteGranularity) ok(/趋势图按(周|月|季度)聚合/.test(note), c.n + " 天说明行标注聚合粒度 :: " + note);
		else ok(!/聚合/.test(note), c.n + " 天未聚合时不标注粒度");
		// 聚合桶的分项计数也应守恒（环形图按窗口重算，与卡片同口径）
		const donutCenter = texts(byCls(tree, "ust-center")[0] || {}).join("");
		ok(!c.noteGranularity || donutCenter.includes(fmtLarge(api.grandTotal)), c.n + " 天环形图中心 == 总量 :: " + donutCenter);
	}
}

// ================= 3) 原有范围无回归 =================
console.log("[3] 回归：预设范围与自定义区间行为不变");
{
	const api = toApi(synthRecentDays(60));
	const today = new Date(), yst = new Date(); yst.setDate(today.getDate() - 1);
	const expect = {
		today: 1000 * 60,
		yesterday: 1000 * 59,
		last7: (1000 * (60 + 59 + 58 + 57 + 56 + 55 + 54)),
		last30: api.days.slice(-30).reduce((s, d) => s + d.total, 0),
	};
	const presets = [
		["today", expect.today],
		["yesterday", expect.yesterday],
		["last7", expect.last7],
		["last30", expect.last30],
		["month", null],
		["prevMonth", null],
	];
	for (const [id, want] of presets) {
		const tree = render({ id }, api);
		const act = activeTabs(tree);
		ok(act.length === 1, "预设 " + id + " 恰好一个高亮 tab :: " + JSON.stringify(act));
		ok(byCls(tree, "ust-stat-card").length === 6, "预设 " + id + " 六张卡片齐全");
		ok(!texts(tree).join(" ").includes("全部区间："), "预设 " + id + " 不显示全部区间说明");
		if (want !== null) {
			ok(cardValue(tree, 0).includes(fmtLarge(want)), "预设 " + id + " tokens == " + fmtLarge(want) + " :: " + cardValue(tree, 0));
		}
	}
	// 自定义整段区间应等于「全部」
	const from = api.days[0].date, to = api.days[api.days.length - 1].date;
	const v = (t) => cardValue(t, 0);
	const tCustom = render({ id: "custom", from, to }, api);
	const tAll = render({ id: "all" }, api);
	ok(v(tCustom) === v(tAll), "自定义整段区间 == 全部 :: " + v(tCustom) + " vs " + v(tAll));
	ok(!/无数据或区间无效/.test(texts(tCustom).join(" ")), "自定义整段区间不误报无数据");
	// 倒序区间仍走原有告警
	const tBad = render({ id: "custom", from: to, to: from }, api);
	ok(/无数据或区间无效/.test(texts(tBad).join(" ")), "倒序自定义区间提示无数据");
	// 单日窗口仍按小时
	const one = toApi([api.days[api.days.length - 1]]);
	const dkey = one.days[0].date;
	const tSingle = render({ id: "custom", from: dkey, to: dkey }, one);
	ok(/按小时 Token 趋势/.test(trendTitle(tSingle)), "单日自定义按小时 :: " + trendTitle(tSingle));
	ok(/00:00|09:00/.test(texts(tSingle).join(" ")), "单日小时轴标签存在");
	// 全量恰好 1 天 → 不误切按小时（走日粒度）
	const tAllOne = render({ id: "all" }, one);
	ok(trendTitle(tAllOne) === "按天 Token 趋势（全部）", "全量仅 1 天仍按天 :: " + trendTitle(tAllOne));
	// 空数据
	const tEmpty = render({ id: "all" }, toApi([]));
	ok(/无数据或区间无效/.test(texts(tEmpty).join(" ")), "空全量提示无数据");
	ok(findAll(tEmpty, (n) => cls(n).startsWith("ust-cell")).length === 0, "空全量不渲染热力图");
	ok(/0$/.test(cardValue(tEmpty, 0) || "0"), "空全量 tokens 为 0 :: " + cardValue(tEmpty, 0));
}

// ================= 4) 可选：真实导出数据的交叉校验 =================
const exportPath = process.argv[2];
if (exportPath && fs.existsSync(exportPath)) {
	console.log("[4] 真实导出交叉校验: " + exportPath);
	const api = JSON.parse(fs.readFileSync(exportPath, "utf8"));
	if (api.ok && Array.isArray(api.days) && api.days.length > 0) {
		const tree = render({ id: "all" }, api);
		ok(cardValue(tree, 0).includes(fmtLarge(api.grandTotal)), "真实数据 tokens == grandTotal " + fmtLarge(api.grandTotal));
		ok(cardValue(tree, 3).includes(String(api.dayCount)), "真实数据活跃天数 == dayCount " + api.dayCount);
		const uniqModels = new Set(api.days.flatMap((d) => (d.byModel || []).map((m) => m.model)));
		ok(byCls(tree, "ust-mlegend")[0].children.length === uniqModels.size, "真实数据模型数一致 (" + uniqModels.size + ")");
	} else {
		console.log("  (导出文件无有效 days，跳过)");
	}
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
