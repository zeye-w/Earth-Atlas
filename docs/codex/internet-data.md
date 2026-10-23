# Codex 指令 · A 线：互联网基础设施数据管线

仓库 zeye-w/Earth-Atlas。从最新的 `main` 拉出分支 `codex/internet-data`，完成后开 PR 合并到 `main`。

**开工前先完整读一遍 `docs/internet-layers.md`**（协作文档），以及 `src/internet/types.ts`（数据格式）和 `src/internet/data.ts`（解析器）。你的输出必须符合这些约定。

## 任务

写脚本抓取四类公开数据，清洗、简化后生成四个静态 JSON 文件，并配一个每周自动更新的 GitHub Action。

### 1. 先核实数据源

逐个确认当前可用的接口地址和许可条款，结论（附条款原文链接）写进 PR 描述。下面是已知的线索，可能已经变了：

| 数据 | 线索 | 已知许可 |
| --- | --- | --- |
| 海底光缆 | TeleGeography：`https://www.submarinecablemap.com/api/v3/cable/cable-geo.json`、`/api/v3/landing-point/landing-point-geo.json`，单条详情 `/api/v3/cable/{id}.json`（投产年份、长度、运营方、登陆站） | CC BY-NC-SA 3.0（本项目不商用，可用，需署名） |
| IXP 与设施 | PeeringDB API：`/api/ix`、`/api/fac`、`/api/ixfac`、`/api/netixlan`（按 IXP 汇总成员数和端口速率） | 遵守其使用条款；匿名访问有频率限制，可选用仓库机密 `PEERINGDB_API_KEY` |
| DNS 根服务器 | root-servers.org 的实例列表（找机器可读的版本：字母、城市、国家、经纬度、global/local） | 核实 |

请求要礼貌：设置 User-Agent（`Earth-Atlas data builder (+https://github.com/zeye-w/Earth-Atlas)`），串行加适当间隔，失败重试有上限。

### 2. 生成文件

| 输出 | 类型 | 要点 |
| --- | --- | --- |
| `public/data/internet/cables.json` | `CableDataset` | 用 Douglas–Peucker 简化路径（容差约 0.03–0.05°），坐标保留 2–3 位小数；跨越 180° 经线时在 ±180° 处拆段；`landingIds` 与 `landings[].id` 对应；投产年份取 RFS 年份，计划中的光缆保留未来年份 |
| `public/data/internet/ixps.json` | `IxpDataset` | `position` 取该 IXP 所在设施坐标的中心，没有设施坐标就用城市坐标；`members` 为接入网络数；`portCapacityGbps` 为端口速率之和 |
| `public/data/internet/facilities.json` | `FacilityDataset` | 只保留有坐标的设施；`ixCount`、`networkCount` 用 PeeringDB 给的计数 |
| `public/data/internet/root-servers.json` | `RootServerDataset` | 13 个字母的运营机构和 IPv4/IPv6 地址；每个实例给稳定的 `id`（例如 `k-ams-1`）。上游如果提供实例的主机名或标识（hostname.bind / NSID 的值或规律），写进 `identifiers`，C 线会用它把 RIPE Atlas 的应答对应到具体实例 |

每个文件都要有 `version: 1`、`generatedAt` 和 `sources`（名称、链接、许可证、抓取时间）。大小上限见协作文档。

### 3. 脚本和自动更新

- 脚本放在 `scripts/internet/`，用 Node 22 的 ESM（`.mjs`）。可以用 `node --experimental-strip-types` 直接 import `src/internet/data.ts` 的解析器做自检。一个入口：`node --experimental-strip-types scripts/internet/build.mjs`，依次生成四个文件。
- **不要新增 npm 依赖**；需要的话先在 PR 里说明理由。
- `.github/workflows/internet-data.yml`：
  - 每周一 03:17 UTC 定时运行，也支持手动触发。
  - 跑完脚本后，运行 `npm test` 校验。
  - 只有文件内容变了才提交到 `main`，提交信息 `data: refresh internet datasets (YYYY-MM-DD)`，需要 `permissions: contents: write`。
  - 任何一个数据源失败时保留旧文件，不提交残缺数据，并让这次运行标红。

### 4. 测试

新建 `tests/internetDataFiles.test.mjs`：
- 用解析器读取四个文件，检查解析前后条目数相等（没有被丢弃的条目）。
- 检查大小上限，以及协作文档里的数量下限（光缆 > 400、登陆站 > 1000、IXP > 500、设施 > 2000、13 个字母齐全、实例 > 1000）。
- 检查光缆路径里没有跨越 180° 经线的线段（相邻两点经度差 > 180°）。

## 不要做的事

- 不要修改协作文档列出的热点文件（`src/App.tsx`、`src/internet/types.ts`、`src/internet/data.ts`、`package.json`、`tests/e2e/mocks.ts` 等）。如果数据格式不够用，在 PR 描述里提出需要改什么，由 Claude 来改。
- 不要修改 `tests/e2e/fixtures/internet/`（那是合成测试数据）。
- 不要跳过或删除已有测试。

## 验收

- 本地通过：`npm run typecheck`、`npm test`、`npm run build`，以及 `npx playwright test tests/e2e/internet.spec.ts`（需要本地 Chromium）。
- 手动触发一次 `internet-data` Action 并成功运行（可以在你的分支上用 `workflow_dispatch` 测试，测试时不要提交到 `main`）。
- PR 描述包含：数据源和许可核实结论、四个文件的条目数和大小、已知的数据质量问题（例如缺坐标被丢弃的数量）。
