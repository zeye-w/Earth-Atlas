# 全球气温与风场

独立开发分支：`codex/global-weather-map`。不修改或触发视频录制分支、工作流。

数据源为 [NOAA GFS 公共数据](https://registry.opendata.aws/noaa-gfs-bdp-pds/)，使用 0.25° `f000` 分析场中的 2 米气温、10 米东西风和南北风。它们是真实发布的数值模式产品，**不是全球逐点实时观测**。原始模式每 6 小时一个周期；脚本按原始网格每四点抽取，生成 1° 展示网格，画面双线性插值。原始下载 URL、字段字节范围与 SHA-256 存于 JSON 中，可追溯来源。处理后数据不代表 NOAA 背书。

默认关闭；开启才下载约 0.83 MB JSON 和天气绘制模块。风箭头指向风吹去的方向，屏幕长度按风速递增并封顶；视角改变后重新投影和避让。它展示 10 米风场，图形为可读性略抬升，不表示高空风。气温色带会受 Cesium 昼夜光照影响，面板可显式关闭光照。

仅支持最新分析场，历史时间轴隐藏这两个图层。数据超过 36 小时或不完整时拒绝绘制，显示原因，不生成替代天气。分享链接保留图层开关，但天气数据跟随最新分析场，不保证永久保存当日天气快照。

## 本地更新

Python 3.13：

```powershell
python -m venv .cache/weather-venv
.cache/weather-venv/Scripts/python.exe -m pip install -r scripts/weather-requirements.txt
.cache/weather-venv/Scripts/python.exe scripts/build-weather.py
```

Linux 使用 `.cache/weather-venv/bin/python`。脚本仅按 NOAA 索引下载三个 GRIB 字段，严格校验响应范围、网格、模式周期、单位和数值，不下载整个模式文件。

## 自动更新与部署

新增 `weather-data.yml`，没有 push 触发器。本次开发不启动它。以后合并至默认分支后，定时任务每日四次刷新独立 `weather-data` Release 的 `latest.json` 资产；不会向应用分支提交天气文件。可手动运行该工作流初始化 Release。需要仓库允许 Actions 写入 Release。

部署后的 Worker 拦截 `/data/weather/latest.json`，优先取该 Release，进程缓存 15 分钟，CDN 缓存 5 分钟；失败时仅允许使用仍有效的内置快照。开发服务器直接使用内置快照。若自动更新未启用，内置快照 36 小时后会明确显示过期。

## 验证

```powershell
npm run typecheck
npm test
npm run build
$env:PW_CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
npx playwright test -c playwright.weather.config.ts
```

天气浏览器测试独占 5182 端口，不使用现有录制服务端口。测试会使用真实网格数值与测试时间标记，外部底图为既有测试夹具；测试截图不作为真实卫星影像宣传材料。
