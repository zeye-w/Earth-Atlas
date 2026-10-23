# 互联网基础设施图层：协作文档

阶段 1（静态图层）和阶段 2（实测 DNS 查询流）的共同依据。不同的对话或 Codex 之间不共享上下文，这里写的就是全部约定。Claude 各对话开工前先读这份文档；Codex 按任务书干活，只看任务书链接到的章节（任务书格式见 [`docs/codex/README.md`](codex/README.md)）。

## 目标

在地球上叠加五个图层：
- 海底光缆和登陆站
- 互联网交换中心（IXP）
- 数据中心（互联设施）
- DNS 根服务器的任播实例
- RIPE Atlas **实测**的 DNS 查询：探针 → 实际应答的根服务器实例

原则沿用整个项目：**每个点、每条线都要能说明是实测、推算还是示意。** 拿不到数据时就如实说"暂不可用"，绝不画虚构的数据。

## 数据源（2026-10-23 决定）

项目暂不向 PeeringDB、TeleGeography、root-servers.org 申请再分发许可，**只公开发布许可明确允许再分发的数据**：

| 图层 | 数据源 | 许可 | 说明 |
| --- | --- | --- | --- |
| 海底光缆 | OpenStreetMap（Overpass） | ODbL 1.0 | 志愿者逐段标注，覆盖不完整；年份很少，所以只有带年份的光缆占三成以上时才显示年份滑块；OSM 没有登陆站标注，**不发布推断的端点** |
| 数据中心 | OpenStreetMap | ODbL 1.0 | 无接入网络数 |
| 交换中心 | Wikidata（SPARQL） | CC0 1.0 | 数量远少于实际 |
| 根服务器 | **不发布静态文件**。Worker 在服务端读取 root-servers.org 用于匹配，网站只显示实测查询命中的实例 | — | 见 C 线 |
| DNS 实测查询 | RIPE Atlas | RIPE Atlas 服务条款第 4 条 | 实时 |

PeeringDB / TeleGeography / root-servers.org 的适配代码保留在 `scripts/internet/`，由发布开关挡住（仓库变量 `INTERNET_DATA_PUBLICATION_APPROVED`），拿到许可后才启用。

## 现状（骨架，已在 main 上）

| 部分 | 文件 | 状态（2026-10-23） |
| --- | --- | --- |
| 数据格式（接口约定） | `src/internet/types.ts` | 定稿。要改先改这里和本文档 |
| 解析与校验 | `src/internet/data.ts` | 定稿。生产方用这些解析器测试自己的输出 |
| 渲染 | `src/internet/internetOverlay.ts`、`flowMaterial.ts` | 完成：光缆辉光与流动脉冲、年份滑块、DNS 查询飞行光点 |
| 图层 hook | `src/layers/useInternet.ts` | 可用：按需加载，DNS 流每 5 分钟刷新 |
| 图层面板 | `src/panels/InternetGroup.tsx` | 占位：开关和状态行（D 线完善） |
| 信息卡 | `src/panels/InternetCard.tsx`、`src/panels/internet.css` | 占位（D 线完善） |
| Worker 接口 | `worker/ripeAtlas.ts`，路由 `/api/internet/dns-flows` | 完成（PR #17）；改为实时读取 root-servers.org 进行中（`codex/dns-roots`） |
| 数据管线 | `scripts/internet/`、`public/data/internet/` | 完成（PR #16）：光缆、数据中心、交换中心三个开放数据文件 |
| 实测根实例 | `src/internet/measuredRoots.ts` | 完成：根服务器图层从实测查询取实例 |
| 测试假数据 | `tests/e2e/fixtures/internet/*.json` | 合成数据，不是真实基础设施 |
| 测试 | `tests/internetData.test.mjs`、`tests/e2e/internet.spec.ts` | 通过 |

图层开关（分享链接里的键名）：`cables`、`ixps`、`dataCenters`、`rootServers`、`dnsFlows`。

## 数据文件

静态数据集（A 线每周生成，提交到仓库）：

| 文件 | 类型 | 大小上限（未压缩） |
| --- | --- | --- |
| `public/data/internet/cables.json` | `CableDataset` | 2.5 MB |
| `public/data/internet/ixps.json` | `IxpDataset` | 400 KB |
| `public/data/internet/facilities.json` | `FacilityDataset` | 1.2 MB |

实时接口（C 线）：`GET /api/internet/dns-flows` 返回 `DnsFlowSnapshot`。`DnsFlow` 可以带 `instanceCity`、`instanceCountry`（可选），信息卡会显示。

通用规则：
- 坐标一律是 `[经度, 纬度]`，单位为度。光缆坐标保留 2–3 位小数，节点保留 3 位。
- 每个文件都带 `version: 1`、`generatedAt`，以及 `sources`（名称、链接、许可证、抓取时间）。
- 输出必须能通过 `src/internet/data.ts` 里对应的解析器，并且**不能被丢弃任何条目**（测试要检查解析前后数量相等）。
- 光缆跨越 180° 经线时，路径要在 ±180° 处拆成两段，不能出现从 179° 直接连到 −179° 的长线段。

## 分工

| 线 | 负责方 | 分支 | 只改这些文件 |
| --- | --- | --- | --- |
| A 数据管线 | Codex 1 | `codex/internet-data` | `scripts/internet/**`、`public/data/internet/**`、`.github/workflows/internet-data.yml`、`tests/internetDataFiles.test.mjs` |
| B 渲染 | Claude 开发对话 | `claude/*` | `src/internet/internetOverlay.ts`、`src/internet/flowMaterial.ts`、`src/internet/*Overlay*.ts`、`src/layers/useInternet.ts` |
| C 实测 DNS 查询流 | Codex 2 | `codex/dns-flows` | `worker/ripeAtlas.ts`、`worker/ripeAtlas/**`、`src/internet/dnsFlows.ts`、`tests/dnsFlows.test.mjs`、`tests/fixtures/ripe-atlas/**` |
| D 界面 | A 或 C 完成后，交给先空下来的 Codex | `codex/internet-ui` | `src/panels/InternetGroup.tsx`、`src/panels/InternetCard.tsx`、`src/panels/internet.css` |
| 集成与审查 | Claude 集成对话（见 `docs/integrator.md`） | `main` | 下面的热点文件；**只有它合并到 `main`** |

**热点文件只由 Claude 修改**，清单在 `.github/hotspots.txt`（`src/App.tsx`、`src/internet/types.ts`、`src/internet/data.ts`、`worker/index.ts`、`tests/e2e/mocks.ts`、测试假数据、`package.json` 等）。需要改这些文件时，在 PR 描述里写清楚要改什么、为什么，由 Claude 来改。来自 `codex/*` 分支的 PR 如果改了这些文件，GitHub Actions 的 `ownership` 检查会直接标红。

## 合并规则

1. 从最新的 `main` 拉分支；开 PR 前先合并一次 `main`（用 merge，不要 rebase 别人的提交）。
2. PR 描述里写清楚：做了什么、怎么验证的（命令和结果）、数据来源和许可证的核实结论、已知问题。
3. 提交前本地跑 `npm run typecheck` 和与改动相关的单元测试（例如 `node --experimental-strip-types --test tests/dnsFlows.test.mjs`）。全部单元测试、构建和浏览器测试 `e2e` 交给 CI；CI 红了，只在本地复现失败的那一项。截图只在任务书要求时做。
4. 不要跳过或删除测试来让测试通过；不要改热点文件。
5. 合并由 Claude 集成对话审查后执行。Claude 开发对话的改动同样走 PR。
6. 审查意见和追加修改都推到**原来那个 PR 的分支**上，不要另开新 PR；原 PR 已合并或关闭时才开新的。合并不等浏览器测试 `e2e`，它在合并后的 `main` 上跑（细节见 `docs/integrator.md`“合并节奏”）。

## 各线的验收标准

**A 数据管线**
- 四个文件都通过解析器，条目一个不丢，大小在上限内。
- 数量合理：光缆 > 400 条，登陆站 > 1000 个，IXP > 500 个，设施 > 2000 个；根服务器 13 个字母齐全，实例 > 1000 个。
- 每周自动更新数据的 Action 能手动触发并成功运行。
- PR 里附各数据源当前许可条款的原文链接和结论。

**B 渲染**（Claude）
- 光缆带辉光并沿线流动，节点远看聚合、拉近展开，点击能拾取。
- 光缆随时间轴按投产年份显示；DNS 查询画成从探针飞到实例再返回的光点，飞行速度按实测延迟。
- 全部图层同时打开时，帧率和现在相比没有明显下降。

**C 实测 DNS 查询流**
- `/api/internet/dns-flows` 返回能通过 `parseDnsFlowSnapshot` 的数据，`flows` 至少几百条，覆盖多个字母。
- 只输出能确定应答实例的查询，`examined` 和 `matched` 如实反映匹配率。
- 有上游失败时的降级处理（返回最后一次成功的数据，或者 503），并控制 Worker 的 CPU 和子请求开销。
- 解析和匹配逻辑有单元测试，用录制下来的真实响应样本做测试数据。

**D 界面**
- 图例；每个图层标明"实测 / 推算 / 示意"；面板里列出数据来源、许可证和数据时间。
- 信息卡排版完善，手机窄屏可用。
