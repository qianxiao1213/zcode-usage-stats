// dsh-usage-stats —— 使用统计(客户端)
// 在 dsh 设置页注册「使用统计」分区，严格复刻「使用统计子组件库」HTML 样式。
window.__ModuleLoader__.load({
	id: "zcode-usage-stats",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const element = react.createElement;

		const inject = ["slots"];

		// ---------- 格式化 ----------
		function fmtLarge(n) {
			n = Number(n) || 0;
			if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
			if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
			return String(n);
		}
		function fmtFull(n) {
			return (Number(n) || 0).toLocaleString();
		}
		function fmtDayLabel(dateStr) {
			const p = String(dateStr || "").split("-");
			if (p.length !== 3) return dateStr;
			return Number(p[1]) + "月" + Number(p[2]) + "日";
		}
		function dateKey(d) {
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		}
		function todayKey() { return dateKey(new Date()); }
		function addDays(key, n) {
			const p = key.split("-").map(Number);
			const d = new Date(p[0], p[1] - 1, p[2]);
			d.setDate(d.getDate() + n);
			return dateKey(d);
		}
		function rangeKeyOf(y, m, d) {
			return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
		}

		// ---------- 时间范围(Range)统一模型(见《时间范围扩展规范》) ----------
		const RANGES = [
			{ id: "today", label: "今天", build: (now) => [rangeKeyOf(now.getFullYear(), now.getMonth() + 1, now.getDate())] },
			{ id: "yesterday", label: "昨天", build: (now) => { const d = new Date(now); d.setDate(now.getDate() - 1); return [rangeKeyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())]; } },
			{ id: "last7", label: "最近 7 天", build: (now) => { const a = []; for (let i = 6; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); a.push(rangeKeyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())); } return a; } },
			{ id: "last30", label: "最近 30 天", build: (now) => { const a = []; for (let i = 29; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); a.push(rangeKeyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())); } return a; } },
			{ id: "month", label: "本月", build: (now) => { const y = now.getFullYear(), m = now.getMonth() + 1; const last = new Date(y, m, 0).getDate(); const to = Math.min(last, now.getDate()); const a = []; for (let i = 1; i <= to; i++) a.push(rangeKeyOf(y, m, i)); return a; } },
			{ id: "prevMonth", label: "上月", build: (now) => { const p = new Date(now.getFullYear(), now.getMonth() - 1, 1); const y = p.getFullYear(), m = p.getMonth() + 1; const last = new Date(y, m, 0).getDate(); const a = []; for (let i = 1; i <= last; i++) a.push(rangeKeyOf(y, m, i)); return a; } },
			// 全部(累积):不枚举日期,直接取宿主返回的全部 days(宿主本来就是全历史扫描)。
			// 必须放数组末尾:resolveWindow 的兜底按 id 取 last30,顺序变化不再影响兜底。
			{ id: "all", label: "全部", all: true },
		];
		const DEFAULT_RANGE_ID = "last30"; // 兜底范围(替代原先按下标取 RANGES[3] 的耦合写法)

		// 自定义区间:起止两端含,升序
		function customKeys(from, to) {
			const a = [];
			if (!from || !to || from > to) return a;
			let k = from;
			let guard = 0;
			while (k <= to && guard < 3660) { a.push(k); k = addDays(k, 1); guard++; }
			return a;
		}

		// 解析 range 状态(字符串 id 或 {id:'custom',from,to}) → 统一窗口 { id,label,dateKeys,stamp,custom,all }
		function resolveWindow(range, now = new Date()) {
			const r = typeof range === "string" ? { id: range } : (range || {});
			if (r.id === "custom") {
				const dateKeys = customKeys(r.from, r.to);
				return { id: "custom", label: r.from || r.to ? (r.from + " ~ " + r.to) : "自定义", dateKeys, custom: true, stamp: "custom:" + dateKeys.join(",") };
			}
			// 全部(累积):窗口不携带 dateKeys,由 fillDays 直接取宿主全部 days。
			// stamp 用定长串,避免把上百个日期拼进 useEffect 依赖。
			if (r.id === "all") {
				return { id: "all", label: "全部", dateKeys: null, all: true, stamp: "all" };
			}
			const def = RANGES.find((x) => x.id === r.id) || RANGES.find((x) => x.id === DEFAULT_RANGE_ID) || RANGES[0];
			const dateKeys = def.build(now);
			return { id: def.id, label: def.label, dateKeys, custom: false, stamp: def.id + ":" + dateKeys.join(",") };
		}

		// 窗口内"有日历格可画"的天数:全部区间取宿主实际返回的天数,其余取枚举出的 dateKeys 数
		function windowDayCount(windowObj, days) {
			if (windowObj && windowObj.all) return (days || []).length;
			return (windowObj && windowObj.dateKeys ? windowObj.dateKeys : []).length;
		}

		function fillDays(days, windowObj) {
			if (windowObj && windowObj.all) return (days || []).slice(); // 宿主已按 date 升序聚合,直接用
			const map = new Map();
			(days || []).forEach((d) => map.set(d.date, d));
			return (windowObj.dateKeys || []).map((k) => map.get(k) || { date: k, total: 0, turns: 0, byModel: [] });
		}

		// ---------- 全量/长区间的趋势图降采样 ----------
		// 点数超过 MAX_POINTS 时按"日历边界"聚合成周/月/季度(不用下标切块:稀疏数据会把不同月混进一格)
		const MAX_POINTS = 60;
		const METRIC_KEYS = ["input", "output", "cacheRead", "cacheWrite"];
		function pickBucketUnit(n) {
			if (n <= MAX_POINTS) return null;
			if (Math.ceil(n / 7) <= MAX_POINTS) return "week";
			if (Math.ceil(n / 31) <= MAX_POINTS) return "month";
			return "quarter";
		}
		function bucketStartKey(dateStr, unit) {
			const p = String(dateStr || "").split("-").map(Number);
			if (p.length !== 3 || p.some((x) => Number.isNaN(x))) return dateStr;
			const y = p[0], m = p[1], d = p[2];
			if (unit === "month") return rangeKeyOf(y, m, 1);
			if (unit === "quarter") return rangeKeyOf(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
			// week: 归到该日所在周一(周一为一周起点)
			const dt = new Date(y, m - 1, d);
			const dow = dt.getDay(); // 0=周日
			dt.setDate(d - ((dow + 6) % 7));
			return rangeKeyOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
		}
		function bucketLabel(startKey, unit) {
			const p = String(startKey || "").split("-").map(Number);
			if (p.length !== 3) return startKey;
			if (unit === "month") return (p[0] === new Date().getFullYear() ? "" : p[0] + "年") + p[1] + "月";
			if (unit === "quarter") return p[0] + " Q" + (Math.floor((p[1] - 1) / 3) + 1);
			return fmtDayLabel(startKey);
		}
		// 按桶累加 total/turns,byModel 按 model 合并(保留首次出现的 color,与仪表盘口径一致)
		function aggregateDays(list, unit) {
			if (!unit || !Array.isArray(list)) return list;
			const order = [];
			const map = new Map();
			list.forEach((d) => {
				const key = bucketStartKey(d.date, unit);
				let b = map.get(key);
				if (!b) {
					b = { date: key, label: bucketLabel(key, unit), unit, total: 0, turns: 0, dayCount: 0, byModel: [], _models: new Map() };
					map.set(key, b);
					order.push(b);
				}
				b.total += totalOf(d);
				b.turns += turnsOf(d);
				b.dayCount += 1;
				(d.byModel || []).forEach((m) => {
					const cur = b._models.get(m.model);
					if (cur) {
						cur.total += m.total || 0;
						METRIC_KEYS.forEach((k) => { cur[k] += m[k] || 0; });
					} else {
						const clone = { model: m.model, color: m.color, total: m.total || 0 };
						METRIC_KEYS.forEach((k) => { clone[k] = m[k] || 0; });
						b._models.set(m.model, clone);
					}
				});
			});
			return order.map((b) => {
				b.byModel = [...b._models.values()];
				delete b._models;
				return b;
			});
		}

		// ---------- SVG 图标 ----------
		function IconToken() {
			return element("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 },
				element("path", { d: "M12 2L2 7l10 5 10-5-10-5z" }),
				element("path", { d: "M2 17l10 5 10-5" }),
				element("path", { d: "M2 12l10 5 10-5" }),
			);
		}
		function IconChat() {
			return element("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 },
				element("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }),
			);
		}
		function IconMail() {
			return element("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 },
				element("path", { d: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" }),
				element("polyline", { points: "22,6 12,13 2,6" }),
			);
		}
		function IconCalendar() {
			return element("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 },
				element("rect", { x: 3, y: 4, width: 18, height: 18, rx: 2, ry: 2 }),
				element("line", { x1: 16, y1: 2, x2: 16, y2: 6 }),
				element("line", { x1: 8, y1: 2, x2: 8, y2: 6 }),
				element("line", { x1: 3, y1: 10, x2: 21, y2: 10 }),
			);
		}
		function IconTrend() {
			return element("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 },
				element("polyline", { points: "23 6 13.5 15.5 8.5 10.5 1 18" }),
				element("polyline", { points: "17 6 23 6 23 12" }),
			);
		}
		function IconBolt() {
			return element("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 },
				element("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" }),
			);
		}
		function IconRefresh() {
			return element("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 },
				element("polyline", { points: "23 4 23 10 17 10" }),
				element("polyline", { points: "1 20 1 14 7 14" }),
				element("path", { d: "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" }),
			);
		}

		// ---------- 样式(严格复刻「使用统计子组件库」) ----------
		const CSS = `
.ust-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; flex-direction: column; gap: 16px; color: #fff; }
.ust-group { background-color: #2c2c2e; border: 1px solid #3a3a40; border-radius: 10px; overflow: hidden; padding: 16px 20px; }
.ust-header { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
.ust-page-title { font-size: 28px; font-weight: 600; color: #ffffff; }
.ust-tabs { display: flex; gap: 4px; }
.ust-tab { padding: 4px 12px; font-size: 12px; cursor: pointer; border-radius: 6px; color: #888; transition: background-color 0.15s ease; }
.ust-tab.active { background: #333; color: #e0e0e0; }
.ust-tab:hover:not(.active) { background: #252525; }
.ust-rangebox { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; position: relative; }
.ust-tabs { flex-wrap: wrap; }
.ust-custom-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.ust-custom-sep { font-size: 12px; color: #888; }
.ust-date-input { background: #18181b; color: #e0e0e0; border: 1px solid #3a3a40; border-radius: 6px; padding: 5px 8px; font-size: 12px; color-scheme: dark; }
.ust-custom-apply { padding: 5px 12px; background: #333; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 12px; cursor: pointer; }
.ust-custom-apply:hover:not(:disabled) { background: #444; }
.ust-custom-apply:disabled { opacity: 0.5; cursor: default; }
.ust-custom-panel { position: absolute; top: calc(100% + 8px); left: 0; z-index: 60; background-color: #2c2c2e; border: 1px solid #3a3a40; border-radius: 10px; padding: 12px 14px; box-shadow: 0 12px 30px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 10px; min-width: 300px; }
.ust-custom-actions { display: flex; justify-content: flex-end; gap: 8px; }
.ust-custom-cancel { padding: 5px 12px; background: transparent; border: 1px solid #3a3a40; border-radius: 6px; color: #c8c8c8; font-size: 12px; cursor: pointer; }
.ust-custom-cancel:hover:not(:disabled) { background: #2a2a2e; }
.ust-date-input:focus { outline: none; border-color: #4a4a52; box-shadow: none; }
.ust-custom-apply:focus, .ust-custom-cancel:focus { outline: none; }
.ust-dp { position: relative; display: inline-block; }
.ust-dp-trigger { display: flex; align-items: center; gap: 6px; background: #18181b; color: #e0e0e0; border: 1px solid #3a3a40; border-radius: 6px; padding: 5px 8px; font-size: 12px; cursor: pointer; color-scheme: dark; min-width: 104px; justify-content: space-between; }
.ust-dp-trigger:hover { border-color: #4a4a52; }
.ust-dp-trigger:focus { outline: none; }
.ust-dp-value { user-select: none; }
.ust-dp-panel { position: absolute; top: calc(100% + 4px); left: 0; z-index: 80; background-color: #2c2c2e; border: 1px solid #3a3a40; border-radius: 10px; padding: 10px 12px; box-shadow: 0 12px 30px rgba(0,0,0,0.5); width: 244px; }
.ust-dp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.ust-dp-nav { cursor: pointer; color: #a6a6a6; background: none; border: none; font-size: 16px; padding: 0 8px; line-height: 1; }
.ust-dp-nav:hover { color: #fff; }
.ust-dp-title { color: #e0e0e0; font-size: 13px; display: flex; gap: 6px; }
.ust-dp-title b { cursor: pointer; font-weight: 500; padding: 1px 4px; border-radius: 4px; }
.ust-dp-title b:hover { background: #3a3a40; }
.ust-dp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
.ust-dp-week { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; color: #888; font-size: 11px; margin-bottom: 4px; }
.ust-dp-day, .ust-dp-cell { height: 26px; font-size: 12px; color: #d0d0d0; cursor: pointer; border-radius: 5px; display: flex; align-items: center; justify-content: center; }
.ust-dp-day:hover, .ust-dp-cell:hover { background: #3a3a40; }
.ust-dp-day.sel, .ust-dp-cell.sel { background: #3d91e7; color: #fff; font-weight: 600; }
.ust-dp-day.dis { color: #555; cursor: not-allowed; }
.ust-dp-today { margin-top: 8px; padding-top: 6px; border-top: 1px solid #333336; text-align: center; color: #3d91e7; font-size: 12px; cursor: pointer; }
.ust-dp-today:hover { text-decoration: underline; }
.ust-warn { font-size: 12px; color: #f2b95b; background: rgba(242,185,91,0.08); border: 1px solid rgba(242,185,91,0.3); border-radius: 6px; padding: 8px 12px; line-height: 1.5; }
.ust-time-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.ust-time-label { font-size: 13px; color: #888; }

/* 统计卡片 */
.ust-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
.ust-stat-card { background: #2c2c2e; border: 1px solid #3a3a40; border-radius: 8px; padding: 14px; }
.ust-stat-label { font-size: 11px; color: #888; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
.ust-stat-value { font-size: 24px; font-weight: 600; color: #fff; }
.ust-stat-value-sm { font-size: 16px; font-weight: 600; color: #fff; }
.ust-stat-sub { font-size: 11px; color: #888; }

/* 热力图 */
.ust-heat-title { font-size: 14px; font-weight: 500; color: #a6a6a6; }
.ust-heat-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.ust-heat-legend { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #888; }
.ust-heat-legend-label { margin-right: 4px; }
.ust-heat-swatch { width: 12px; height: 12px; border-radius: 3px; }
.ust-heat-scroll { overflow-x: auto; overflow-y: hidden; white-space: nowrap; width: 100%; scrollbar-width: thin; scrollbar-color: #444 #222; }
.ust-heat-scroll::-webkit-scrollbar { height: 6px; }
.ust-heat-scroll::-webkit-scrollbar-track { background: #2a2a30; border-radius: 4px; }
.ust-heat-scroll::-webkit-scrollbar-thumb { background: #444; border-radius: 4px; }
.ust-heat-scroll::-webkit-scrollbar-thumb:hover { background: #666; }
.ust-heat-grid { display: grid; grid-template-rows: repeat(7, 16px); grid-auto-flow: column; grid-auto-columns: 16px; gap: 4px; padding: 6px 8px 8px; }
.ust-cell { width: 16px; height: 16px; background-color: #202024; border-radius: 4px; cursor: pointer; transition: transform 0.15s cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 0.15s ease; position: relative; }
.ust-cell:hover { transform: scale(1.4); z-index: 10; box-shadow: 0 0 10px rgba(0,0,0,0.6); outline: 1px solid rgba(255,255,255,0.18); outline-offset: 1px; }
.ust-l0 { background-color: #202024; }
.ust-l1 { background-color: #2e4a66; }
.ust-l2 { background-color: #3a6e9f; }
.ust-l3 { background-color: #5b99d0; }
.ust-l4 { background-color: #7cc2f2; }

/* 趋势图(多模型面积图) */
.ust-trend-card { background-color: #2c2c2e; border: 1px solid #3a3a40; border-radius: 12px; padding: 24px; }
.ust-section-title { color: #a6a6a6; font-size: 14px; font-weight: 500; margin-bottom: 24px; }
.ust-chart-scroll { width: 100%; }
.ust-chart-wrap { position: relative; width: 100%; aspect-ratio: 880 / 280; box-sizing: border-box; background-image: radial-gradient(circle at 1px 1px, #35353d 1px, transparent 0); background-size: 40px 40px; background-position: -1px -1px; }
.ust-area-svg { width: 100%; height: 100%; display: block; overflow: visible; }
.ust-area-grid { stroke: #35353d; stroke-width: 1; stroke-dasharray: 4 4; }
.ust-area-axis { stroke: #35353d; stroke-width: 1; }
.ust-area-path { stroke-width: 2; fill-opacity: 0.22; stroke-linejoin: round; stroke-linecap: round; transition: opacity 0.2s ease; }
.ust-area-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; transition: opacity 0.2s ease; }
.ust-area-dot { r: 3; fill: #2c2c2e; stroke-width: 2; transition: r 0.15s ease, fill 0.15s ease; cursor: pointer; }
.ust-area-dot:hover { r: 5; }
.ust-area-dot.active { r: 6; fill: #ffffff; stroke-width: 2.5; }
.ust-area-cursor { stroke: rgba(255,255,255,0.22); stroke-width: 1; stroke-dasharray: 3 3; pointer-events: none; }
.ust-area-hit { fill: transparent; cursor: crosshair; }
.ust-axis-label { font-size: 11px; fill: #6a6a70; }
.ust-y-label { font-size: 10px; fill: #6a6a70; text-anchor: end; }
.ust-trend-legend { display: flex; flex-wrap: wrap; gap: 18px; row-gap: 8px; padding-top: 16px; }
.ust-trend-legend-item { display: flex; align-items: center; font-size: 13px; color: #c8c8c8; gap: 8px; cursor: pointer; transition: opacity 0.2s ease; }
.ust-trend-legend-item:hover { opacity: 0.8; }
.ust-trend-dot { width: 10px; height: 10px; border-radius: 50%; }

/* 模型用量 */
.ust-panel { background-color: #2c2c2e; border: 1px solid #3a3a40; border-radius: 12px; padding: 24px 32px; }
.ust-donut-rim { fill: #2c2c2e; }
.ust-panel-title { color: #a6a6a6; font-size: 14px; font-weight: 500; margin-bottom: 20px; }
.ust-panel-content { display: flex; align-items: center; justify-content: space-between; }
.ust-donut-box { position: relative; width: 160px; height: 160px; flex-shrink: 0; }
.ust-donut-box svg { overflow: visible; transform: rotate(-90deg); position: relative; z-index: 1; }
.ust-slice { transition: transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94), filter 0.25s ease; transform-origin: 100px 100px; cursor: pointer; pointer-events: stroke; }
.ust-slice:hover { transform: scale(1.05); filter: drop-shadow(0 0 8px rgba(255,255,255,0.3)); }
.ust-center { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; pointer-events: none; z-index: 10; }
.ust-center .num { font-size: 20px; font-weight: 600; color: #e0e0e0; letter-spacing: 0.5px; }
.ust-center .lab { font-size: 11px; color: #888; margin-top: 4px; }
.ust-mlegend { list-style: none; padding: 0; margin: 0 0 0 30px; flex: 1; }
.ust-mitem { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #333336; cursor: pointer; transition: opacity 0.2s; }
.ust-mitem:last-child { border-bottom: none; }
.ust-mitem:hover .ust-mname, .ust-mitem.active .ust-mname { color: #ffffff; }
.ust-minfo { display: flex; flex-direction: column; justify-content: center; }
.ust-mname { display: flex; align-items: center; font-size: 14px; color: #c8c8c8; transition: color 0.2s; }
.ust-mdot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
.ust-mtokens { font-size: 12px; color: #888; margin-left: 16px; margin-top: 2px; }
.ust-mpct { font-size: 12px; color: #e0e0e0; }

/* 底部刷新 */
.ust-refresh-row { display: flex; justify-content: flex-end; }
.ust-refresh { padding: 6px 14px; background: transparent; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background-color 0.15s ease; }
.ust-refresh:hover { background-color: #2d2d2d; }
.ust-refresh:disabled { opacity: 0.5; cursor: default; }

/* 全局固定 Tooltip */
.ust-tooltip { display: none; position: fixed; pointer-events: none; background-color: #18181b; padding: 14px 16px; border-radius: 8px; border: 1px solid #3a3a40; box-shadow: 0 8px 20px rgba(0,0,0,0.7); z-index: 10000; min-width: 200px; transition: opacity 0.15s ease; opacity: 0; }
.ust-tooltip.visible { opacity: 1; }
.ust-tooltip-header { font-size: 14px; font-weight: 500; color: #fff; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #333; }
.ust-tooltip-list { list-style: none; padding: 0; margin: 0; }
.ust-tooltip-item { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #ccc; margin-bottom: 6px; }
.ust-tooltip-item:last-child { margin-bottom: 0; }
.ust-tooltip-left { display: flex; align-items: center; gap: 8px; }
.ust-tooltip-bar { width: 4px; height: 14px; border-radius: 2px; }
.ust-tooltip-val { color: #a6a6a6; font-family: monospace; }
.ust-tooltip-sm { display: none; position: fixed; pointer-events: none; background-color: #1a1a1a; padding: 10px 14px; border-radius: 6px; border-left: 3px solid transparent; box-shadow: 0 4px 12px rgba(0,0,0,0.7); z-index: 10000; min-width: 150px; transition: opacity 0.15s ease; opacity: 0; }
.ust-tooltip-sm.visible { opacity: 1; }
.ust-tooltip-sm-header { display: flex; align-items: center; font-size: 14px; font-weight: 500; color: #fff; margin-bottom: 4px; }
.ust-tooltip-sm-color { display: inline-block; width: 8px; height: 12px; border-radius: 2px; margin-right: 8px; }
.ust-tooltip-sm-body { display: flex; justify-content: space-between; font-size: 12px; color: #ccc; padding-left: 16px; }

/* 热力图小 Tooltip */
.ust-heat-tooltip { display: none; position: fixed; pointer-events: none; background-color: #242426; padding: 10px 14px; border-radius: 8px; border: 1px solid #3a3a40; box-shadow: 0 6px 16px rgba(0,0,0,0.5); z-index: 10000; white-space: nowrap; transition: opacity 0.15s ease; opacity: 0; font-size: 13px; }
.ust-heat-tooltip.visible { opacity: 1; }
.ust-heat-tooltip-text { color: #ffffff; letter-spacing: 0.2px; }
.ust-heat-tooltip-text span { color: #a6a6a6; }

/* 浅色主题覆盖(规范 F15):深色为默认样式,浅色依据 DSH 主题切换(<body> 移除 data-ds-dark-theme),
   而非 prefers-color-scheme。选择器统一为 body:not([data-ds-dark-theme]) */
body:not([data-ds-dark-theme]) .ust-root { color: #1a1a1a; }
body:not([data-ds-dark-theme]) .ust-group,
body:not([data-ds-dark-theme]) .ust-trend-card,
body:not([data-ds-dark-theme]) .ust-panel,
body:not([data-ds-dark-theme]) .ust-stat-card { background-color: #ffffff; border-color: #e4e4ea; }
body:not([data-ds-dark-theme]) .ust-page-title,
body:not([data-ds-dark-theme]) .ust-stat-value,
body:not([data-ds-dark-theme]) .ust-stat-value-sm,
body:not([data-ds-dark-theme]) .ust-mitem:hover .ust-mname,
body:not([data-ds-dark-theme]) .ust-mitem.active .ust-mname,
body:not([data-ds-dark-theme]) .ust-center .num { color: #1a1a1a; }
body:not([data-ds-dark-theme]) .ust-stat-label,
body:not([data-ds-dark-theme]) .ust-stat-sub,
body:not([data-ds-dark-theme]) .ust-section-title,
body:not([data-ds-dark-theme]) .ust-panel-title,
body:not([data-ds-dark-theme]) .ust-mtokens,
body:not([data-ds-dark-theme]) .ust-mpct,
body:not([data-ds-dark-theme]) .ust-tab,
body:not([data-ds-dark-theme]) .ust-time-label,
body:not([data-ds-dark-theme]) .ust-custom-sep,
body:not([data-ds-dark-theme]) .ust-heat-title,
body:not([data-ds-dark-theme]) .ust-heat-legend,
body:not([data-ds-dark-theme]) .ust-center .lab { color: #6b6b72; }
body:not([data-ds-dark-theme]) .ust-trend-legend-item,
body:not([data-ds-dark-theme]) .ust-mname { color: #3a3a40; }
body:not([data-ds-dark-theme]) .ust-tab.active { background: #eaeaf0; color: #1a1a1a; }
body:not([data-ds-dark-theme]) .ust-tab:hover:not(.active) { background: #f0f0f4; }
body:not([data-ds-dark-theme]) .ust-custom-apply { background: #f2f2f5; border-color: #d6d6dd; color: #1a1a1a; }
body:not([data-ds-dark-theme]) .ust-custom-apply:hover:not(:disabled) { background: #e7e7ec; }
body:not([data-ds-dark-theme]) .ust-custom-panel { background: #ffffff; border-color: #e4e4ea; box-shadow: 0 12px 30px rgba(0,0,0,0.12); }
body:not([data-ds-dark-theme]) .ust-custom-cancel { border-color: #d6d6dd; color: #1a1a1a; }
body:not([data-ds-dark-theme]) .ust-custom-cancel:hover:not(:disabled) { background: #f0f0f4; }
body:not([data-ds-dark-theme]) .ust-refresh { border-color: #d6d6dd; color: #1a1a1a; }
body:not([data-ds-dark-theme]) .ust-refresh:hover:not(:disabled) { background-color: #f0f0f4; }
body:not([data-ds-dark-theme]) .ust-mitem { border-bottom-color: #ececf1; }
body:not([data-ds-dark-theme]) .ust-heat-scroll { scrollbar-color: #c4c4ce #e9e9ef; }
body:not([data-ds-dark-theme]) .ust-heat-scroll::-webkit-scrollbar-track { background: #e9e9ef; }
body:not([data-ds-dark-theme]) .ust-heat-scroll::-webkit-scrollbar-thumb { background: #c4c4ce; }
body:not([data-ds-dark-theme]) .ust-heat-scroll::-webkit-scrollbar-thumb:hover { background: #acacb8; }
body:not([data-ds-dark-theme]) .ust-cell { background-color: #e4e4ea; }
body:not([data-ds-dark-theme]) .ust-cell.ust-l0 { background-color: #e4e4ea; }
body:not([data-ds-dark-theme]) .ust-cell.ust-l1 { background-color: #c6e0f5; }
body:not([data-ds-dark-theme]) .ust-cell.ust-l2 { background-color: #94c4ea; }
body:not([data-ds-dark-theme]) .ust-cell.ust-l3 { background-color: #5b99d0; }
body:not([data-ds-dark-theme]) .ust-cell.ust-l4 { background-color: #2e6fa8; }
/* 图例 swatch 是 JS inline 色,浅色下用 !important 覆盖成同一阶梯 */
body:not([data-ds-dark-theme]) .ust-heat-swatch:nth-child(2) { background: #c6e0f5 !important; }
body:not([data-ds-dark-theme]) .ust-heat-swatch:nth-child(3) { background: #94c4ea !important; }
body:not([data-ds-dark-theme]) .ust-heat-swatch:nth-child(4) { background: #5b99d0 !important; }
body:not([data-ds-dark-theme]) .ust-heat-swatch:nth-child(5) { background: #2e6fa8 !important; }
body:not([data-ds-dark-theme]) .ust-chart-wrap { background-image: radial-gradient(circle at 1px 1px, #cfcfd6 1px, transparent 0); }
body:not([data-ds-dark-theme]) .ust-donut-rim { fill: #ececf1; }
body:not([data-ds-dark-theme]) .ust-area-dot { fill: #ffffff; }
body:not([data-ds-dark-theme]) .ust-area-dot.active { fill: #ffffff; }
body:not([data-ds-dark-theme]) .ust-area-grid { stroke: #d9d9e0; }
body:not([data-ds-dark-theme]) .ust-area-cursor { stroke: rgba(0,0,0,0.28); }
body:not([data-ds-dark-theme]) .ust-tooltip,
body:not([data-ds-dark-theme]) .ust-tooltip-sm,
body:not([data-ds-dark-theme]) .ust-heat-tooltip { background-color: #ffffff; border-color: #e0e0e6; box-shadow: 0 8px 20px rgba(0,0,0,0.12); }
body:not([data-ds-dark-theme]) .ust-tooltip-header { color: #1a1a1a; border-bottom-color: #ececf1; }
body:not([data-ds-dark-theme]) .ust-tooltip-item { color: #444; }
body:not([data-ds-dark-theme]) .ust-tooltip-val { color: #777; }
body:not([data-ds-dark-theme]) .ust-tooltip-sm-header,
body:not([data-ds-dark-theme]) .ust-heat-tooltip-text { color: #1a1a1a; }
body:not([data-ds-dark-theme]) .ust-heat-tooltip-text span { color: #6b6b72; }
body:not([data-ds-dark-theme]) .ust-tooltip-sm-body { color: #444; }
body:not([data-ds-dark-theme]) .ust-axis-label,
body:not([data-ds-dark-theme]) .ust-y-label { fill: #9a9aa2; }
body:not([data-ds-dark-theme]) .ust-warn { color: #a8781d; border-color: rgba(168,120,29,0.35); background: rgba(168,120,29,0.10); }
body:not([data-ds-dark-theme]) .ust-date-input { color-scheme: light; background: #ffffff; color: #1a1a1a; border-color: #d6d6dd; }
body:not([data-ds-dark-theme]) .ust-dp-trigger { background: #ffffff; color: #1a1a1a; border-color: #d6d6dd; color-scheme: light; }
body:not([data-ds-dark-theme]) .ust-dp-trigger:hover { border-color: #b8b8c2; }
body:not([data-ds-dark-theme]) .ust-dp-panel { background: #ffffff; border-color: #e4e4ea; box-shadow: 0 12px 30px rgba(0,0,0,0.12); }
body:not([data-ds-dark-theme]) .ust-dp-nav { color: #6b6b72; }
body:not([data-ds-dark-theme]) .ust-dp-nav:hover { color: #1a1a1a; }
body:not([data-ds-dark-theme]) .ust-dp-title { color: #1a1a1a; }
body:not([data-ds-dark-theme]) .ust-dp-title b:hover { background: #f0f0f4; }
body:not([data-ds-dark-theme]) .ust-dp-day, body:not([data-ds-dark-theme]) .ust-dp-cell { color: #3a3a40; }
body:not([data-ds-dark-theme]) .ust-dp-day:hover, body:not([data-ds-dark-theme]) .ust-dp-cell:hover { background: #f0f0f4; }
body:not([data-ds-dark-theme]) .ust-dp-day.dis { color: #c8c8d0; }
body:not([data-ds-dark-theme]) .ust-dp-week { color: #6b6b72; }
body:not([data-ds-dark-theme]) .ust-dp-today { border-top-color: #ececf1; }
body:not([data-ds-dark-theme]) .ust-heat-swatch:nth-child(6) { background: #2e6fa8 !important; }
body:not([data-ds-dark-theme]) .ust-cell:hover { outline-color: rgba(0,0,0,0.25); }
body:not([data-ds-dark-theme]) .ust-area-axis { stroke: #d9d9e0; }
`;

		// ---------- 数据辅助 ----------
		function totalOf(day) { return day ? day.total : 0; }
		function turnsOf(day) { return day ? day.turns : 0; }
		function dayMap(days) {
			const m = new Map();
			(days || []).forEach((d) => m.set(d.date, d));
			return m;
		}
		function calcStats(days, windowObj) {
			const filtered = fillDays(days, windowObj);
			const total = filtered.reduce((s, d) => s + totalOf(d), 0);
			const turns = filtered.reduce((s, d) => s + turnsOf(d), 0);
			const daySet = new Set(filtered.filter((d) => totalOf(d) > 0).map((d) => d.date));
			return { total, turns, activeDays: daySet.size };
		}

		// ---------- 1) 统计卡片 ----------
		function StatCard({ icon, label, value, sub }) {
			return element("div", { className: "ust-stat-card" },
				element("div", { className: "ust-stat-label" }, icon, label),
				sub
					? element(react.Fragment, null, element("div", { className: "ust-stat-value-sm" }, value), element("div", { className: "ust-stat-sub" }, sub))
					: element("div", { className: "ust-stat-value" }, value),
			);
		}

		// ---------- 2) 活跃热力图 ----------
		const HEAT_COLORS = ["#2a2a30", "#2e4a66", "#3a6e9f", "#5b99d0", "#7cc2f2"];
		function heatLevel(turns) {
			if (turns === 0) return 0;
			if (turns < 3) return 1;
			if (turns < 8) return 2;
			if (turns < 16) return 3;
			return 4;
		}
		function Heatmap({ days, window: wnd }) {
				const map = dayMap(days);
				// 全部区间没有枚举 dateKeys,直接用宿主实际返回的天
				const dateKeys = wnd.all ? (days || []).map((d) => d.date) : wnd.dateKeys;
				const count = dateKeys.length;
				const [tip, setTip] = react.useState(null); // { day, total, turns, x, y }
				const scrollRef = react.useRef(null);
				const [totalCols, setTotalCols] = react.useState(14);

				// 列数策略:数据按 7 行/列折叠成 dataCols 列并补空白填满容器;最新一天靠右下
				// + ResizeObserver 自适应容器宽度变化(规范 F13)
				react.useEffect(() => {
					const el = scrollRef.current;
					if (!el) return;
					const colUnit = 16 + 4;
					const dataCols = Math.max(1, Math.ceil(count / 7));
					const compute = () => {
						const fillCols = Math.max(2, Math.ceil(el.clientWidth / colUnit) - 1);
						setTotalCols(Math.max(fillCols, dataCols, 2));
					};
					compute();
					requestAnimationFrame(() => { el.scrollLeft = el.scrollWidth; });
					const ro = new ResizeObserver(compute);
					ro.observe(el);
					return () => ro.disconnect();
				}, [count, wnd.stamp]);

				// 依据窗口 dateKeys 排放格子(instead of 自算 today 偏移)
				const dataCols = Math.max(1, Math.ceil(count / 7));
				const colStart = Math.max(0, totalCols - dataCols);
				const cells = [];
				dateKeys.forEach((key, i) => {
					const day = map.get(key);
					cells.push({
						key,
						col: colStart + Math.floor(i / 7),
						row: i % 7,
						lvl: heatLevel(turnsOf(day)),
						total: totalOf(day),
						turns: turnsOf(day),
					});
				});
				const allCells = [];
				// 预建 (col,row) → cell 索引:全量区间下避免 O(格数 × 天数) 的线性 find
				const cellAt = new Map();
				cells.forEach((x) => cellAt.set(x.col + "-" + x.row, x));
				for (let c = 0; c < totalCols; c++) for (let r = 0; r < 7; r++) {
					const hit = cellAt.get(c + "-" + r);
					allCells.push(hit || { key: `empty-${c}-${r}`, lvl: 0, total: 0, turns: 0, empty: true });
				}

				const updateTip = (e) => {
					let x = e.clientX + 15;
					let y = e.clientY - 15;
					if (x + 200 > window.innerWidth) x = e.clientX - 200 - 15;
					if (y + 50 > window.innerHeight) y = e.clientY - 50 - 15;
					if (y < 0) y = 10;
					setTip((t) => (t ? { ...t, x, y } : t));
				};

				return element("div", { className: "ust-group" },
					count === 0 ? null : element(react.Fragment, null,
						element("div", { className: "ust-heat-head" },
							element("div", { className: "ust-heat-title" }, "活跃热力图（" + wnd.label + "）"),
							element("div", { className: "ust-heat-legend" },
								element("span", { className: "ust-heat-legend-label" }, "较少"),
								HEAT_COLORS.map((c) => element("div", { key: c, className: "ust-heat-swatch", style: { background: c } })),
								element("span", { className: "ust-heat-legend-label", style: { marginLeft: 4 } }, "较多"),
							),
						),
						element("div", { className: "ust-heat-scroll", ref: scrollRef },
							element("div", { className: "ust-heat-grid" },
								allCells.map((cell) => element("div", {
									key: cell.key,
									className: "ust-cell ust-l" + cell.lvl,
									onMouseEnter: cell.empty ? undefined : (e) => { setTip({ day: cell.key, total: cell.total, turns: cell.turns, x: 0, y: 0 }); updateTip(e); },
									onMouseMove: (e) => { if (tip) updateTip(e); },
									onMouseLeave: () => setTip(null),
								})),
							),
						),
						element("div", { className: "ust-heat-tooltip" + (tip ? " visible" : ""), style: { left: tip ? tip.x : 0, top: tip ? tip.y : 0, display: tip ? "block" : "none" } },
							tip && element("div", { className: "ust-heat-tooltip-text" },
								fmtDayLabel(tip.day), "：", element("span", null, fmtFull(tip.total)), " Tokens • ", element("span", null, tip.turns), " 轮",
							),
						),
					),
				);
			}

		// ---------- 3) 按天 Token 趋势(多模型面积图) ----------
		function catmullRom2bezier(points) {
			const result = [];
			for (let i = 0; i < points.length - 1; i++) {
				const p0 = i > 0 ? points[i - 1] : points[0];
				const p1 = points[i];
				const p2 = points[i + 1];
				const p3 = i < points.length - 2 ? points[i + 2] : p2;
				const cp1x = p1.x + (p2.x - p0.x) / 6;
		// 把控制点 y 限制在段两端数据点的 y 范围内:消除段内过冲,
		// 使曲线极值恰好落在数据点(不再出现"曲线峰与数据点偏移/双峰")
		const lo = Math.min(p1.y, p2.y);
		const hi = Math.max(p1.y, p2.y);
		const cp1y = Math.min(hi, Math.max(lo, p1.y + (p2.y - p0.y) / 6));
		const cp2x = p2.x - (p3.x - p1.x) / 6;
		const cp2y = Math.min(hi, Math.max(lo, p2.y - (p3.y - p1.y) / 6));
				result.push({ c1: { x: cp1x, y: cp1y }, c2: { x: cp2x, y: cp2y }, e: { x: p2.x, y: p2.y } });
			}
			return result;
		}

		function TrendChart({ days, window: wnd }) {
			const [hover, setHover] = react.useState(null);
			const [mousePos, setMousePos] = react.useState({ x: 0, y: 0 });
			const scrollRef = react.useRef(null);
			// hot: 被吸附激活的数据点索引; refX: 垂直参考线在 SVG 内的 x(连续跟随鼠标)
			const [hot, setHot] = react.useState(null);
			const [refX, setRefX] = react.useState(null);

			// 单日窗口(今天/昨天/单日自定义)→ 按小时绘制;多日 → 按天绘制
			const dayList = fillDays(days, wnd);
			// 全量/长区间 → 自动按周/月/季度聚合,避免上千个点
			const bucketUnit = wnd.all ? pickBucketUnit(dayList.length) : null;
			const xDays = bucketUnit ? aggregateDays(dayList, bucketUnit) : dayList;
			const isHour = !wnd.all && dayList.length === 1;
			const singleDate = isHour ? dayList[0].date : null;
			// 小时数据来自单日项的 hours(宿主已按天聚合小时;缺失补 0 保连续)
			const singleDay = dayList[0] || null;
			const hoursRaw = isHour && singleDay && Array.isArray(singleDay.hours) ? singleDay.hours : [];
			const hourMap = new Map(hoursRaw.map((h) => [h.hour, h]));
			const hours = isHour ? Array.from({ length: 24 }, (_, h) => (hourMap.get(h) || { hour: h, total: 0, byModel: [] })) : [];
			const xData = isHour ? hours : xDays;
			const xLabel = (d) => (isHour ? String(d.hour).padStart(2, "0") + ":00" : (d.label || fmtDayLabel(d.date)));

			// 收集模型颜色
			const allModels = [];
			const seen = new Set();
			(xData || []).forEach((d) => (d.byModel || []).forEach((m) => {
				if (!seen.has(m.model)) { seen.add(m.model); allModels.push(m); }
			}));

			const W = 880; // viewBox 宽(绘图区+左右边距)
			const H = 280; // viewBox 高(绘图区 + 底部日期区)
			const padding = { top: 12, right: 14, bottom: 40, left: 46 };
			const chartW = W - padding.left - padding.right; // 实际绘图宽
			const chartH = H - padding.top - padding.bottom; // 实际绘图高
			const baseY = padding.top + chartH; // 绘图区底部基线
			const N = xData.length || 1;
			const stepX = N > 1 ? chartW / (N - 1) : chartW;
			const modelMax = Math.max(1, ...xData.flatMap((d) => (d.byModel || []).map((m) => m.total)));

			const px = (i) => padding.left + i * stepX;
			const py = (v) => padding.top + chartH - (v / modelMax) * chartH;

			// 构造每个模型的点序列
			const series = allModels.map((m) => ({
				model: m.model,
				color: m.color,
				points: xData.map((d, i) => {
					const mm = (d.byModel || []).find((x) => x.model === m.model);
					return { x: px(i), y: py(mm ? mm.total : 0), total: mm ? mm.total : 0 };
				}),
			}));

			const areaPath = (pts) => {
				if (pts.length === 0) return "";
				if (pts.length === 1) return `M ${pts[0].x} ${padding.top + chartH} L ${pts[0].x} ${pts[0].y} L ${pts[0].x} ${padding.top + chartH} Z`;
				const baseY = padding.top + chartH;
				const bez = catmullRom2bezier(pts);
				let d = `M ${pts[0].x} ${baseY} L ${pts[0].x} ${pts[0].y}`;
				bez.forEach((b) => { d += ` C ${b.c1.x.toFixed(2)} ${b.c1.y.toFixed(2)}, ${b.c2.x.toFixed(2)} ${b.c2.y.toFixed(2)}, ${b.e.x.toFixed(2)} ${b.e.y.toFixed(2)}`; });
				d += ` L ${pts[pts.length - 1].x} ${baseY} Z`;
				return d;
			};

			const linePath = (pts) => {
				if (pts.length === 0) return "";
				if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
				const bez = catmullRom2bezier(pts);
				let d = `M ${pts[0].x} ${pts[0].y}`;
				bez.forEach((b) => { d += ` C ${b.c1.x.toFixed(2)} ${b.c1.y.toFixed(2)}, ${b.c2.x.toFixed(2)} ${b.c2.y.toFixed(2)}, ${b.e.x.toFixed(2)} ${b.e.y.toFixed(2)}`; });
				return d;
			};

			// 轴标签(渲染为 SVG 文本,随图等比缩放,不再被容器裁切)
			// 疏稀策略:小时模式每 3 小时一个标签;多日较挤时约每 8 个数据天取一个
			const labelEvery = isHour ? 3 : (xData.length > 8 ? Math.max(1, Math.ceil(xData.length / 8)) : 0);
			const axisLabels = xData.map((d, i) => {
				const show = isHour
					? (i % labelEvery === 0)
					: (xData.length <= 1 ? i === 0 : (i === 0 || i === xData.length - 1 || (labelEvery > 1 && i % labelEvery === 0)));
				return show ? element("text", { key: "x" + i, className: "ust-axis-label", x: px(i), y: baseY + 22, textAnchor: "middle" }, xLabel(d)) : null;
			});

			// 网格线 + 左侧 Y 轴刻度
			const gridLines = [];
			for (let g = 0; g <= 4; g++) {
				const y = padding.top + (chartH * g) / 4;
				const val = modelMax * (1 - g / 4);
				gridLines.push(element("line", { key: "g" + g, className: "ust-area-grid", x1: padding.left, y1: y, x2: W - padding.right, y2: y }));
				gridLines.push(element("text", { key: "yl" + g, className: "ust-y-label", x: padding.left - 8, y: y + 3, textAnchor: "end" }, fmtLarge(val)));
			}

			const updateTipPosition = (e) => {
				let x = e.clientX + 15;
				let y = e.clientY - 20;
				const ww = window.innerWidth;
				const wh = window.innerHeight;
				if (x + 280 > ww) x = e.clientX - 280 - 15;
				if (y + 120 > wh) y = e.clientY - 120 - 15;
				if (y < 10) y = 10;
				if (x < 10) x = 10;
				setMousePos({ x, y });
			};

			const onMove = (e) => {
				const rect = e.currentTarget.getBoundingClientRect();
				const sc = scrollRef.current ? scrollRef.current.scrollLeft : 0;
				// 容器像素 → SVG 坐标(考虑横向滚动与 SVG 缩放比例)
				const scale = rect.width > 0 ? W / rect.width : 1;
				const svgX = (e.clientX - rect.left + sc) * scale;
				setRefX(svgX);
				// 吸附到最近的绘图数据点,激活该点并联动 tooltip
				const idx = Math.min(N - 1, Math.max(0, Math.round((svgX - padding.left) / stepX)));
				setHot(idx);
				setHover(xData[idx]);
				updateTipPosition(e);
			};

			// 惰性初始化(F17),并在 allModels 变化时清理/补齐(切换范围不错位,规范 F9)
			const [dim, setDim] = react.useState(() => {
				const o = {};
				allModels.forEach((m) => { o[m.model] = false; });
				return o;
			});
			const modelsKey = allModels.map((m) => m.model).join("\u0001");
			react.useEffect(() => {
				setDim((d) => {
					const nd = { ...d };
					Object.keys(nd).forEach((k) => { if (!allModels.some((m) => m.model === k)) delete nd[k]; });
					allModels.forEach((m) => { if (!(m.model in nd)) nd[m.model] = false; });
					return nd;
				});
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [modelsKey]);

			return element("div", { className: "ust-trend-card" },
			element("div", { className: "ust-section-title" }, `${isHour ? "按小时" : (bucketUnit ? "按" + (bucketUnit === "week" ? "周" : bucketUnit === "month" ? "月" : "季度") : "按天")} Token 趋势（${wnd.label}）`),
			element("div", { className: "ust-chart-scroll", ref: scrollRef },
				element("div", { className: "ust-chart-wrap" },
					element("svg", { className: "ust-area-svg", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet" },
						// 裁剪到基线以上:防止 Catmull-Rom 平滑曲线在 0 值拐点处的过冲画到坐标轴下方(规范)
						element("defs", null,
							element("clipPath", { id: "ustAreaClip" },
								element("rect", { x: padding.left, y: padding.top, width: chartW, height: chartH }),
							),
						),
						gridLines,
						series.filter((s) => !dim[s.model]).map((s) => element(react.Fragment, { key: s.model },
							element("path", { className: "ust-area-path", d: areaPath(s.points), fill: s.color, stroke: "none", clipPath: "url(#ustAreaClip)" }),
							element("path", { className: "ust-area-line", d: linePath(s.points), stroke: s.color, clipPath: "url(#ustAreaClip)" }),
							s.points.map((p, i) => element("circle", {
								key: i,
								className: "ust-area-dot" + (i === hot ? " active" : ""),
								cx: p.x,
								cy: p.y,
								stroke: s.color,
							})),
						)),
						refX !== null && element("line", {
							className: "ust-area-cursor",
							x1: refX, y1: padding.top,
							x2: refX, y2: baseY,
						}),
						axisLabels,
						element("rect", {
							className: "ust-area-hit",
							x: 0, y: 0, width: W, height: H,
							onMouseMove: onMove,
							onMouseLeave: () => { setHover(null); setHot(null); setRefX(null); },
						}),
					),
				),
			),
			allModels.length > 0 && element("div", { className: "ust-trend-legend" },
				allModels.map((m) => element("span", {
					key: m.model,
					className: "ust-trend-legend-item",
					onClick: () => setDim((d) => ({ ...d, [m.model]: !d[m.model] })),
					style: { opacity: dim[m.model] ? 0.35 : 1 },
				},
					element("span", { className: "ust-trend-dot", style: { background: m.color } }),
					m.model,
				)),
			),
				element("div", {
					className: "ust-tooltip",
					style: { left: mousePos.x, top: mousePos.y, display: (hover && hot !== null) ? "block" : "none", opacity: (hover && hot !== null) ? 1 : 0 },
				},
					hover && element(react.Fragment, null,
						element("div", { className: "ust-tooltip-header" }, `${isHour ? fmtDayLabel(singleDate) + " " + xLabel(hover) : xLabel(hover) + (hover.dayCount ? " · " + hover.dayCount + "天" : "")} - ${fmtLarge(totalOf(hover))} tokens`),
						element("ul", { className: "ust-tooltip-list" },
							allModels.filter((m) => !dim[m.model]).map((m) => {
								const hit = (hover.byModel || []).find((x) => x.model === m.model);
								return element("li", { key: m.model, className: "ust-tooltip-item" },
									element("div", { className: "ust-tooltip-left" },
										element("span", { className: "ust-tooltip-bar", style: { background: m.color } }),
										m.model,
									),
									element("span", { className: "ust-tooltip-val" }, fmtFull(hit ? hit.total : 0)),
								);
							}),
						),
					),
				),
			);
		}

		// ---------- 4) 模型用量仪表盘 ----------
		function Donut({ days, window: wnd }) {
			const filtered = fillDays(days, wnd); // 与趋势图同一窗口聚合口径(规范 F12)
			const modelMap = new Map();
			(filtered || []).forEach((d) => {
				(d.byModel || []).forEach((m) => {
					const cur = modelMap.get(m.model) || { ...m, total: 0 };
					cur.total += m.total;
					modelMap.set(m.model, cur);
				});
			});
			const list = [...modelMap.values()].sort((a, b) => b.total - a.total);
			const sum = list.reduce((s, m) => s + (m.total || 0), 0);
			const R = 65, SW = 30;
			const CIRC = 2 * Math.PI * R;
			let offset = 0;
			const slices = list.map((m) => {
				const frac = sum > 0 ? m.total / sum : 0;
				const dash = frac * CIRC;
				const o = offset;
				offset += dash;
				return { ...m, frac, dash, offset: -o };
			});
			const [hover, setHover] = react.useState(null);
			const [mousePos, setMousePos] = react.useState({ x: 0, y: 0 });

			const updateTipPosition = (e) => {
				let x = e.clientX + 15;
				let y = e.clientY - 15;
				const ww = window.innerWidth;
				const wh = window.innerHeight;
				if (x + 150 > ww) x = e.clientX - 160;
				if (y + 80 > wh) y = e.clientY - 80;
				if (y < 0) y = 10;
				setMousePos({ x, y });
			};

			return element("div", { className: "ust-panel" },
				element("div", { className: "ust-panel-title" }, "模型用量"),
				element("div", { className: "ust-panel-content" },
					element("div", { className: "ust-donut-box" },
						element("svg", { width: 160, height: 160, viewBox: "0 0 200 200" },
							slices.map((m) => element("circle", {
								key: m.model,
								className: "ust-slice",
								cx: 100, cy: 100, r: R, fill: "transparent",
								stroke: m.color, strokeWidth: SW,
								strokeDasharray: `${m.dash} ${CIRC - m.dash}`,
								strokeDashoffset: m.offset,
								onMouseEnter: (e) => { setHover(m); updateTipPosition(e); },
								onMouseMove: (e) => { if (hover) updateTipPosition(e); },
								onMouseLeave: () => setHover(null),
							})),
							element("circle", { cx: 100, cy: 100, r: R - SW / 2, className: "ust-donut-rim" }),
						),
						element("div", { className: "ust-center" },
							element("div", { className: "num" }, fmtLarge(sum)),
							element("div", { className: "lab" }, "tokens"),
						),
					),
					element("ul", { className: "ust-mlegend" },
						slices.map((m) => element("li", {
							key: m.model,
							className: "ust-mitem" + (hover?.model === m.model ? " active" : ""),
							onMouseEnter: (e) => { setHover(m); updateTipPosition(e); },
							onMouseMove: (e) => { if (hover) updateTipPosition(e); },
							onMouseLeave: () => setHover(null),
						},
							element("div", { className: "ust-minfo" },
								element("div", { className: "ust-mname" }, element("span", { className: "ust-mdot", style: { background: m.color } }), m.model),
								element("div", { className: "ust-mtokens" }, fmtLarge(m.total) + " tokens"),
							),
							element("div", { className: "ust-mpct" }, Math.round(m.frac * 100) + "%"),
						)),
					),
				),
				element("div", {
					className: "ust-tooltip-sm" + (hover ? " visible" : ""),
					style: { left: mousePos.x, top: mousePos.y, display: hover ? "block" : "none", borderLeftColor: hover ? hover.color : undefined },
				},
					hover && element(react.Fragment, null,
						element("div", { className: "ust-tooltip-sm-header" },
							element("span", { className: "ust-tooltip-sm-color", style: { background: hover.color } }),
							hover.model,
						),
						element("div", { className: "ust-tooltip-sm-body" },
							element("span", null, fmtLarge(hover.total) + " tokens"),
							element("span", null, Math.round(hover.frac * 100) + "%"),
						),
					),
				),
			);
		}

		// ---------- 自研日期选择器(年/月/日/图标均可点击) ----------
		function DatePicker({ value, onChange, min, max, open, onOpenToggle, placeholder }) {
			const pad = (n) => String(n).padStart(2, "0");
			const toKey = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);
			const parse = (s) => {
				const p = String(s || "").split("-").map(Number);
				if (p.length !== 3 || p.some((x) => Number.isNaN(x))) return null;
				return { y: p[0], m: p[1], d: p[2] };
			};
			const now = new Date();
			const todayStr = toKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
			const sel = parse(value);
			const vY0 = sel ? sel.y : now.getFullYear();
			const vM0 = sel ? sel.m : now.getMonth() + 1;
			const [viewY, setViewY] = react.useState(vY0);
			const [viewM, setViewM] = react.useState(vM0);
			const [mode, setMode] = react.useState("d"); // d=日 M=月 y=年
			// 打开或 value 变化时,把视图同步到当前值所在年月
			react.useEffect(() => {
				if (open) { const p = parse(value); setViewY(p ? p.y : vY0); setViewM(p ? p.m : vM0); setMode("d"); }
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [open]);
			// 点击面板外部关闭
			react.useEffect(() => {
				if (!open) return;
				const h = (e) => {
					const t = e.target;
					if (t && t.closest && !t.closest(".ust-dp")) onOpenToggle && onOpenToggle(false);
				};
				document.addEventListener("mousedown", h);
				return () => document.removeEventListener("mousedown", h);
			}, [open]);

			const lastDay = new Date(viewY, viewM, 0).getDate();
			const firstDow = new Date(viewY, viewM - 1, 1).getDay();
			const weekHead = ["日", "一", "二", "三", "四", "五", "六"];
			const cells = [];
			for (let i = 0; i < firstDow; i++) cells.push(null);
			for (let d = 1; d <= lastDay; d++) cells.push(d);
			const dis = (k) => !!((min && k < min) || (max && k > max));
			const pick = (k, y, m, d) => {
				if (dis(k)) return;
				onChange(k);
				setViewY(y); setViewM(m);
				onOpenToggle && onOpenToggle(false);
			};
			const nav = (delta) => {
				let ny = viewY, nm = viewM + delta;
				if (nm < 1) { nm = 12; ny--; } if (nm > 12) { nm = 1; ny++; }
				setViewY(ny); setViewM(nm);
			};
			const years = [];
			for (let y = viewY - 6; y <= viewY + 5; y++) years.push(y);
			const months = [];
			for (let m = 1; m <= 12; m++) months.push(m);

			return element("div", { className: "ust-dp" },
				element("button", {
					type: "button",
					className: "ust-dp-trigger",
					onClick: () => { setMode("d"); onOpenToggle && onOpenToggle(!open); },
					title: "选择日期",
				},
					element("span", { className: "ust-dp-value" }, value || placeholder || "选择日期"),
					element("svg", { className: "ust-dp-ico", width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 },
						element("rect", { x: 3, y: 4, width: 18, height: 18, rx: 2 }),
						element("line", { x1: 16, y1: 2, x2: 16, y2: 6 }),
						element("line", { x1: 8, y1: 2, x2: 8, y2: 6 }),
						element("line", { x1: 3, y1: 10, x2: 21, y2: 10 }),
					),
				),
				open && element("div", { className: "ust-dp-panel" },
					element("div", { className: "ust-dp-head" },
						element("button", { type: "button", className: "ust-dp-nav", onClick: () => nav(-1) }, "‹"),
						element("div", { className: "ust-dp-title" },
							element("b", { onClick: () => setMode("y") }, viewY + "年"),
							element("b", { onClick: () => setMode("M") }, viewM + "月"),
						),
						element("button", { type: "button", className: "ust-dp-nav", onClick: () => nav(1) }, "›"),
					),
					mode === "M" && element("div", { className: "ust-dp-grid" },
						months.map((m) => element("span", {
							key: m,
							className: "ust-dp-cell" + (m === viewM ? " sel" : ""),
							onClick: () => { setViewM(m); setMode("d"); },
						}, m + "月")),
					),
					mode === "y" && element("div", { className: "ust-dp-grid" },
						years.map((y) => element("span", {
							key: y,
							className: "ust-dp-cell" + (y === viewY ? " sel" : ""),
							onClick: () => { setViewY(y); setMode("d"); },
						}, y)),
					),
					mode === "d" && element(react.Fragment, null,
						element("div", { className: "ust-dp-week" },
							weekHead.map((w) => element("span", { key: w }, w)),
						),
						element("div", { className: "ust-dp-grid" },
							cells.map((d, i) => (d === null
								? element("span", { key: "e" + i })
								: element("span", {
									key: d,
									className: "ust-dp-day"
										+ (toKey(viewY, viewM, d) === value ? " sel" : "")
										+ (dis(toKey(viewY, viewM, d)) ? " dis" : ""),
									onClick: () => pick(toKey(viewY, viewM, d), viewY, viewM, d),
								}, d))),
						),
					),
					element("div", { className: "ust-dp-today", onClick: () => { setViewY(now.getFullYear()); setViewM(now.getMonth() + 1); onChange(todayStr); onOpenToggle && onOpenToggle(false); } }, "回到今天"),
				),
			);
		}

		// ---------- 主视图 ----------
		function UsageStatsView() {
			const [data, setData] = react.useState(null);
			const [error, setError] = react.useState(null);
			const [loading, setLoading] = react.useState(true);
			const [range, setRange] = react.useState({ id: "last30" }); // 时间范围(见《时间范围扩展规范》)
			const [showCustom, setShowCustom] = react.useState(false);
			const [customFrom, setCustomFrom] = react.useState("");
			const [customTo, setCustomTo] = react.useState("");
			// 自研日期选择器互斥开合:同一时刻只展开一个(from 或 to)
			const [dpOpen, setDpOpen] = react.useState(null);

			const load = react.useCallback(async (force) => {
				setLoading(true);
				try {
					const url = "/api/usage-stats" + (force ? "?refresh=1" : "");
					const res = await fetch(url);
					if (!res.ok) throw new Error("HTTP " + res.status);
					const json = await res.json();
					if (!json || json.ok === false) throw new Error(json && json.error ? json.error : "bad payload");
					setData(json);
					setError(null);
				} catch (e) {
					setError(String(e && e.message ? e.message : e));
				}
				setLoading(false);
			}, []);

			react.useEffect(() => { load(false); }, [load]);

			const wnd = react.useMemo(() => resolveWindow(range), [range]);

			if (loading && !data) {
				return element("div", { className: "ust-group" }, element("div", { style: { color: "#888", padding: 40, textAlign: "center" } }, "统计加载中…"));
			}
			if (error && !data) {
				return element("div", { className: "ust-group" },
					element("div", { style: { color: "#888", padding: 40, textAlign: "center" } }, "加载失败，请重试。\n(" + error + ")"),
					element("button", { className: "ust-refresh", onClick: () => load(true), style: { marginTop: 12 } }, "重试"),
				);
			}

			const days = data?.days || [];
			const hasData = days.length > 0;

			const stats = calcStats(days, wnd);
			const winDays = windowDayCount(wnd, days);
			// 全部区间的范围说明:起止日期 + 有活动天数 +(降采样时)聚合粒度
			let allNote = null;
			if (wnd.all && hasData) {
				const first = days[0]?.date, last = days[days.length - 1]?.date;
				const unit = pickBucketUnit(days.length);
				const unitText = unit ? " · 趋势图按" + (unit === "week" ? "周" : unit === "month" ? "月" : "季度") + "聚合" : "";
				allNote = element("div", { className: "ust-time-row" },
					element("span", { className: "ust-time-label" }, `全部区间：${first} ~ ${last} · ${days.length} 天有活动${unitText}`),
				);
			}
			// 窗口内最常用模型(与窗口总用量同口径,规范 F10)
			let winTop = null;
			let winMax = 0;
			const winMap = new Map();
			fillDays(days, wnd).forEach((d) => (d.byModel || []).forEach((m) => {
				const v = (winMap.get(m.model) || 0) + m.total;
				winMap.set(m.model, v);
			}));
			winMap.forEach((v, k) => { if (v > winMax) { winMax = v; winTop = k; } });
			const topName = winTop || data.topModel?.name || "-";
			const topSub = winTop ? ("占比 " + (stats.total > 0 ? Math.round((winMax / stats.total) * 100) : 0) + "%") : (data.topModel ? "占比 " + data.topModel.percent + "%" : "");

			// 自定义区间校验:from>to(倒序)视为无效,禁止应用并提示
			const customInvalid = !!(customFrom && customTo && customFrom > customTo);
			const applyCustom = () => {
				if (customFrom && customTo && customFrom <= customTo) {
					setRange({ id: "custom", from: customFrom, to: customTo });
					setShowCustom(false);
				}
			};

			return element("div", { className: "ust-root" },
				element("div", { className: "ust-header" },
					element("h1", { className: "ust-page-title" }, "使用统计"),
					element("div", { className: "ust-rangebox" },
						element("div", { className: "ust-tabs" },
						RANGES.map((r) => element("span", {
							key: r.id,
							className: "ust-tab" + (range.id === r.id ? " active" : ""),
							onClick: () => { setRange({ id: r.id }); setShowCustom(false); },
						}, r.label)),
						element("span", { className: "ust-tab" + (range.id === "custom" ? " active" : ""), onClick: () => setShowCustom((v) => !v) }, "自定义"),
					),
					showCustom && element("div", { className: "ust-custom-panel" },
						element("div", { className: "ust-custom-row" },
						element(DatePicker, { value: customFrom, onChange: setCustomFrom, max: customTo || undefined, open: dpOpen === "from", onOpenToggle: (v) => setDpOpen(v ? "from" : null), placeholder: "开始日期" }),
						element("span", { className: "ust-custom-sep" }, "至"),
						element(DatePicker, { value: customTo, onChange: setCustomTo, min: customFrom || undefined, open: dpOpen === "to", onOpenToggle: (v) => setDpOpen(v ? "to" : null), placeholder: "结束日期" }),
						),
						customInvalid && element("div", { className: "ust-warn" }, "结束日期不能早于开始日期。"),
						element("div", { className: "ust-custom-actions" },
							element("button", { className: "ust-custom-cancel", onClick: () => { setShowCustom(false); setCustomFrom(""); setCustomTo(""); } }, "取消"),
							element("button", { className: "ust-custom-apply", onClick: applyCustom, disabled: !(customFrom && customTo) || customInvalid, title: customInvalid ? "结束日期不能早于开始日期" : undefined }, "应用"),
						),
					),
					),
				),
				winDays === 0 && element("div", { className: "ust-warn" }, "当前时间范围无数据或区间无效。"),
				allNote,
				data && data.warnings && data.warnings.length > 0 && element("div", { className: "ust-warn" }, data.warnings.join("；")),
				element("div", { className: "ust-stats-grid" },
					element(StatCard, { icon: element(IconToken), label: "tokens 用量", value: fmtLarge(stats.total) }),
					element(StatCard, { icon: element(IconChat), label: "会话数量 · 累计", value: String(data?.sessionCount || 0) }),
					element(StatCard, { icon: element(IconMail), label: "消息数量 · 累计", value: String(data?.messageCount || 0) }),
					element(StatCard, { icon: element(IconCalendar), label: "活跃天数", value: String(stats.activeDays) }),
					element(StatCard, { icon: element(IconTrend), label: "当前连续天数", value: String(data?.currentStreak || 0) }),
					element(StatCard, { icon: element(IconBolt), label: "最常用模型", value: topName, sub: topSub }),
				),
				hasData && winDays > 0 && element(Heatmap, { days, window: wnd }),
				hasData && winDays > 0 && element(TrendChart, { days, window: wnd }),
				hasData && winDays > 0 && element(Donut, { days, window: wnd }),
				element("div", { className: "ust-refresh-row" },
					element("button", { className: "ust-refresh", disabled: loading, onClick: () => load(true) }, element(IconRefresh), "刷新"),
				),
			);
		}

		// ---------- 注册设置页分区 ----------
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-usage-stats";
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => { style.remove(); };
			});

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "usage-stats",
				order: 80,
				label: () => "使用统计",
				inject: () => ({}),
			}, UsageStatsView));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
