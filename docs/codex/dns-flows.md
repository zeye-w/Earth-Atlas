# Codex 指令 · C 线：RIPE Atlas 实测 DNS 查询流

仓库 zeye-w/Earth-Atlas。从最新的 `main` 拉出分支 `codex/dns-flows`，完成后开 PR 合并到 `main`。

**开工前先完整读一遍 `docs/internet-layers.md`**（协作文档），以及 `src/internet/types.ts`（`DnsFlow`、`DnsFlowSnapshot`、`RootInstance`）和 `src/internet/data.ts`（`parseDnsFlowSnapshot`）。

## 目标

实现 Worker 接口 `GET /api/internet/dns-flows`（入口 `worker/ripeAtlas.ts` 的 `dnsFlowsResponse`，路由已接好），返回一份 `DnsFlowSnapshot`：RIPE Atlas 探针向 13 个根服务器发起的**真实**查询，每条记录包括探针位置、实际应答的任播实例、往返延迟。前端会把它画成"探针 → 实例"的飞行光点。

## 要研究和实现的内容

1. **测量来源**：RIPE Atlas 对每个根服务器都有长期运行的内置 DNS 测量（查询 `hostname.bind` CHAOS TXT 或 NSID，应答里带实例标识）。找出 13 个字母对应的测量 ID（确认 IPv4 版本），结果接口类似 `https://atlas.ripe.net/api/v2/measurements/{id}/latest/`。
2. **探针位置**：从 RIPE Atlas 探针接口取探针坐标（公开的大致位置）。坐标保留 2 位小数即可。
3. **实例匹配**：把应答里的标识（例如 `ns1.nl-ams.k.ripe.net`、`ams1b.f.root-servers.org` 之类，各字母格式不同）对应到 `root-servers.json` 里的 `RootInstance.id`：
   - 优先用 `RootInstance.identifiers`；
   - 其次按标识里的机场代码或城市代码，匹配同一字母在该城市的实例；
   - 每个字母的解析规则写成独立、可测试的函数，放在 `worker/ripeAtlas/` 或 `src/internet/dnsFlows.ts`（纯函数，不依赖 Worker 环境）。
   - **对不上的就不输出**，但计入 `examined`；`matched` 如实反映匹配数。
4. **根服务器实例数据**：Worker 通过 ASSETS 绑定读取 `/data/internet/root-servers.json`（由 A 线生成，可能比你晚完成）。开发期间用 `tests/e2e/fixtures/internet/root-servers.json` 的格式自己造测试数据，但不要修改那个文件。

## 性能和稳定性约束（重要）

- Cloudflare Workers 免费版每个请求只有很少的 CPU 时间（约 10 ms），子请求数量也有限。**不要每次请求都拉取全部探针和全部结果。** 可行的思路：
  - 只用一份分布均匀的探针样本（例如每个字母 100–300 个探针），在结果请求里按 `probe_ids` 过滤；
  - 结果在 isolate 内存和 Cache API 里缓存约 5 分钟；
  - 探针坐标单独缓存 24 小时。
- 实测一下 CPU 开销，写进 PR 描述。如果确认在 Worker 里做不到，在 PR 里提出替代方案（例如用 GitHub Action 定时生成快照文件），并说明理由，先不要实现。
- 上游失败时：在 5 分钟内返回最后一次成功的快照；没有可用数据时返回 503 和 `{"error": ...}`。前端已经会把 503 显示为"实测数据暂不可用"。
- 请求 RIPE Atlas 时设置 User-Agent：`Earth-Atlas (+https://github.com/zeye-w/Earth-Atlas)`。
- 输出的 `flows` 控制在 3000 条以内。`source` 字段填 RIPE Atlas 的名称、链接和许可证（核实条款，结论写进 PR）。

## 测试

- `tests/dnsFlows.test.mjs`：用录制下来的**真实** RIPE Atlas 响应样本（放在 `tests/fixtures/ripe-atlas/`，裁剪到很小）测试：
  - 每个字母的标识解析；
  - 实例匹配，包括匹配不到的情况；
  - 最终输出能通过 `parseDnsFlowSnapshot`，并且一条都不被丢弃；
  - 上游失败时的降级行为。
- 本地通过：`npm run typecheck`、`npm test`、`npm run build`。

## 不要做的事

- 不要修改热点文件（`worker/index.ts`、`src/internet/types.ts`、`src/internet/data.ts`、`src/App.tsx`、`package.json`、`tests/e2e/mocks.ts` 等）。如果需要改数据格式或 Worker 路由，在 PR 描述里提出，由 Claude 来改。
- 不要新增 npm 依赖。
- 绝不输出编造或推测的查询：每一条 flow 都必须对应 RIPE Atlas 的一条真实结果。

## PR 描述要包含

- 13 个字母的测量 ID 和数据来源、许可核实结论。
- 实测的匹配率（每个字母 `matched / examined`）、CPU 和子请求开销。
- 已知限制，例如某个字母的标识格式无法解析。
