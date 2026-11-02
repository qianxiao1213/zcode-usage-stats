# 仿zcode的使用统计（zcode-usage-stats）

在 DeepSeek Harness（DSH）设置页提供的 Token 用量统计插件：扫描全历史会话，聚合每天 / 每小时 / 每个模型的 Token 用量，并以「按天 / 按小时趋势图」「模型用量仪表盘」「活跃热力图」展示。

## 界面预览

![使用统计界面](assets/usage-stats.png)


## 特性

- **多种时间范围**：今天、昨天、最近 7 天、最近 30 天、本月、上月、**全部（累积）**、自定义区间（自研日期选择器，年 / 月 / 日均可点选，起止自动校验防倒序）。
- **「全部」一键累积**：不枚举日期、不手动选区间，直接取宿主全历史扫描结果；标题下注明实际起止区间与有活动天数，累积 tokens / 活跃天数 / 模型占比与全量口径完全一致。
- **长区间自动降采样**：区间过长时趋势图自动按「周 / 月 / 季度」聚合（按日历边界分桶，绘图点数控制在 60 以内），标题与说明行标注聚合粒度，悬停可见该桶含几天。
- **单日窗口自动切换按小时**：选择今天 / 昨天 / 单日自定义时，趋势图横轴从「天」自动变为「小时」。
- **多模型面积趋势图**：Catmull-Rom 平滑曲线 + 参考线 + 数据点吸附提示，图例可显隐单系列；曲线裁剪保证不越坐标轴。
- **模型用量仪表盘**：环形占比 + 图例，窗口口径统一。
- **活跃热力图**：GitHub 风格，按窗口日折叠列，hover 放大 + tooltip。
- **深浅主题跟随**：颜色与 DSH 主题（`<body data-ds-dark-theme>`）联动切换，不写死。
- **性能**：磁盘 + 内存双层缓存，过期后后台刷新（SWR），首屏秒开；并发有限池扫描 + 超时保护。

## 安装

先确保已安装 `@deepseek-ai/dsh`（以及 `pnpm`，DSH 插件命令依赖）：

```bash
dsh plugin --profile web add zcode-usage-stats
```

或从 GitHub 源码安装：

```bash
dsh plugin --profile web add github:<你的用户名>/zcode-usage-stats
```

安装后重启 DSH 进程，打开 **设置 → 使用统计** 即可看到统计页面。

## 使用

- 顶部切换时间范围（含「全部」累积视图），或点击「自定义」弹出日期选择卡片选择起止日期。
- 「全部」下数据点过多时趋势图自动按周 / 月 / 季度聚合，数值总量不变；热力图仍按天显示全历史。
- 趋势图可悬停查看参考线联动数据，点击图例项显隐对应模型。
- 「刷新」强制重新扫描全量会话。

## 兼容性

- 针对 DSH 开发者预览版开发，锁定 `@deepseek-ai/dsh` 的 `>=0.1.0-rc.5`。
- 依赖 DSH 宿主提供的 `sessionPersistence`、`webServer` 服务，以及客户端运行时的 `@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-slots`。

## 数据口径

- token 用量：以 `assistant/message` 事件携带的全量 `usage` 为准（去除重复计数）。
- turns：以 `step/end` 事件按新 turn 计数。
- 未知模型归并为 `other`。
- 「全部」区间的 tokens / 活跃天数 / 模型占比与宿主 `GET /api/usage-stats` 的全量口径严格相等；趋势图仅在绘图点数上做周 / 月 / 季度聚合，不改变任何总量。

## 测试

零依赖，无需安装任何包（用内置 React 桩件渲染组件树）：

```bash
node test/all-range.test.mjs
```

覆盖「全部」tab 与数据口径、长区间自动降采样（周 / 月 / 季度）、原有 6 个预设范围与自定义区间的回归、单日按小时、空数据与倒序区间等边界。可选传入宿主导出的 JSON 叠加真实数据校验：

```bash
curl -s http://127.0.0.1:<port>/api/usage-stats > /tmp/us.json
node test/all-range.test.mjs /tmp/us.json
```

## 许可

MIT
