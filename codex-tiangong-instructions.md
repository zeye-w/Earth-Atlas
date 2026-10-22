# 任务：宣传片的主角从国际空间站（ISS）换成天宫空间站，拍 2026-10-22 波斯湾窗口

仓库 zeye-w/Earth-Atlas。在分支 `claude/exciting-hypatia-1rt14s` 上开发，当前 HEAD 是 34a0bde；改完后推送到这个分支，并同步推到 `main`（作者已授权直接推 main）。
相关代码：`video/cinematic/`（README.md 有整体说明）、`.github/workflows/cinematic-promo.yml`、`tests/cinematic.test.mjs`、`src/recording.ts`。

## 目标窗口（硬性截止时间）

- 天宫（网站内部 id `"tiangong"`，NORAD 48274，见 `src/satelliteOrbits.ts`），波斯湾上空（区域 `middle-east`，约 27.3°N 52.9°E）。
- 窗口 T0 ≈ **2026-10-22 14:37:47 UTC**（北京时间 22:37），宽约 150 秒。
- 正式录制（`mode=full`）最早只能在 T0 前 300 分钟启动（`max_wait_min` 上限 300，plan job 超时 340 分钟），并且必须在 **14:20 UTC 之前**派发（等 runner、npm ci、build 要几分钟，plan 会在 T0−35 s 拍数据快照）。
- 在那之前要先跑一次 preview（约 40 分钟）检查模型和构图。

## 必须先解决的坑：plan 默认拍"最近的窗口"

`plan.mjs` 现在取 `windows[0]`。天宫今天在波斯湾之前还有 11:35 UTC 成渝、13:05 UTC 斋浦尔两个窗口，不加限制就会拍错地方。
处理办法：加环境变量 `CINE_REGION`（对应 workflow 输入 `region`，默认空 = 不限制），设了它就只取该区域的第一个窗口。preview 也要遵守这个变量；没有合格窗口时 preview 用 relaxed 搜索，同样按区域过滤。

## 改动清单

### 1. 通用化：ISS → station

`story.mjs` 新增并导出：

```js
export const STATION = { id: "tiangong", noradId: 48274, name: "TIANGONG", spanM: 55 };
```

在 `video/cinematic/*.mjs`、`*.py` 和 `tests/cinematic.test.mjs` 里重命名：

| 原名 | 新名 |
| --- | --- |
| `issOmm` | `stationOmm`（plan.json 字段同步改） |
| `issModel` | `stationModel` |
| `ISS_LOCK` | `STATION_LOCK` |
| `ISS_CLOSEST`、`ISS_CLOSEST_SECONDS` | `STATION_CLOSEST`… |
| `ctx.iss` | `ctx.station`（`contextFrom` 返回 `station:`） |
| `pass.mjs` 的参数 `iss` | `station` |
| capture 每帧记录里的 `iss:` 键 | `station:` |

ISS 相关的注释也一起改。测试里的合成轨道可以保留（它只是一个"类 ISS"轨道），断言文字改成 station。

### 2. 镜头（story.mjs 的 B_CAMERA）

天宫翼展约 55 m，只有 ISS（109 m）的一半，所以近处三个关键帧的距离减半：
- t=11.9：`APPROACH × 0.5e3`
- t=13.1：`[-0.075e3, 0.18e3, 0.09e3]`
- t=14.4：`RETREAT × 0.5e3`

远处的关键帧不动。`tests/cinematic.test.mjs` 必须全部通过：每帧视角转动 ≤3°，最近距离在 150–600 m 之间；如果超出就微调，让最近距离落在 180–250 m。

### 3. plan.mjs

- 拉取轨道根数改成 `CATNR=48274`。
- 从快照的 `GROUP=STATIONS&FORMAT=JSON` 响应里找 `NORAD_CAT_ID === 48274`。
- 日志和报错里的 "ISS" 改成 "Tiangong"。
- plan.json 增加 `station: STATION`。
- 加上前面说的 `CINE_REGION` 过滤。
- 已有的规则保持：锁定航班离瞄准点超过 250 km 时，full 模式报错。

### 4. capture.mjs

- 默认 `MODEL_URL = "/record-assets/tiangong.glb"`。
- `CINE_MODEL_ROTATION` 默认 `"0,0,0"`，`CINE_MODEL_SCALE` 默认 `1`（模型直接按米建）。
- `satelliteModel({ id: STATION.id, ... })`、`api.satellitePosition(STATION.id)`。
- 删掉 NASA ISS 模型轴向的那段注释。

### 5. 新建程序化模型 `video/cinematic/tiangong_model.py`

- 用法：`python3 video/cinematic/tiangong_model.py out.glb`。
- 只用 Python 标准库加 numpy，确定性输出 glTF 2.0 binary：带法线，三角形朝外，按材质分 primitive。
- 已验证的 Cesium 轴向（ISS 模型实测过）：Cesium 给 glTF 做 Y-up→Z-up 和 forward Z→X 转换，`recording.ts` 再把模型系对齐到"x=速度方向、y=左、z=背离地心"。所以在 rotation 为 `0,0,0` 时：
  - glTF **+Z** → 飞行方向
  - glTF **+Y** → 天顶（背离地球）
  - glTF **+X** → 横跨轨道
- 构型（近似，单位 m），T 字形：
  - **天和核心舱**沿 Z 轴，长 16.6 m：小柱段 Ø2.8 m 长 6 m，大柱段 Ø4.2 m 长 9 m，末端 Ø2.8 m 长 1.6 m。
  - 前端是**节点舱**，球体 Ø2.8 m。
  - **问天、梦天**两个实验舱各长 17.9 m、Ø4.2 m，从节点舱沿 ±X 伸出，组成横梁，总跨度约 38.6 m。
  - 两个实验舱外端各有一对**大太阳翼**：沿 ±Z 各伸 26 m，宽 3.2 m，厚 0.05 m。
  - 核心舱后部有一对**小太阳翼**：沿 ±X 各 10 m × 2.5 m。
  - 后端对接的**天舟货运飞船**：长 10.6 m、Ø3.35 m 的圆柱。
  - 节点舱底部（−Y）对接的**神舟飞船**：Ø2.8 m、长 9 m 的圆柱。
- 材质（PBR）：
  - 舱体近白色，`baseColorFactor [0.85,0.85,0.82,1]`，metallic 0，roughness 0.6
  - 太阳翼深蓝，`[0.06,0.08,0.18,1]`，metallic 0.3，roughness 0.35，doubleSided
  - 翼框和支架用金色 `[0.75,0.6,0.3,1]`
- 圆柱 24 段，带端盖。
- 写完用一个小脚本解析 glb：检查 accessor 的 min/max，确认包围盒约为 X ±45、Y −10..+3、Z −30..+30 量级。

### 6. render.py

- 用 `rec.get("station")`。
- 锁定框大小改用 `plan["station"]["spanM"]`（默认 55）代替写死的 109。
- 标签改为 `"TIANGONG  ·  CHINA SPACE STATION"`。保持全英文，因为这里用的是 Inter 字体，中文会缺字。
- 右下角改为 `"MODEL  ·  SCHEMATIC  ·  ATTITUDE APPROX."`。
- 片尾 credits 的 `ISS MODEL  NASA` 改为 `STATION MODEL  SCHEMATIC`。

### 7. Workflow：cinematic-promo.yml

- 删掉 env 里的 `ISS_MODEL`。两个 job 的 "Local site with the ISS model" 步骤改成 `python3 video/cinematic/tiangong_model.py dist/record-assets/tiangong.glb`，原来的 curl 和 trim 都删掉。确认 runner 上有 numpy；没有的话先 `pip install --user --break-system-packages numpy`。
- 输入 `model_rotation` 的默认值和 capture 的兜底值都改回 `"0,0,0"`。
- 新增输入 `region`（默认 `""`），在 plan 步骤里作为 `CINE_REGION` 传入。
- 顶部注释改成 Tiangong。
- 删除 `video/cinematic/trim_model.py`。
- `.github/workflows/cinematic-windows.yml` 已经会列出 ISS、天宫、哈勃的窗口，不用改。

### 8. 文档

- `video/cinematic/README.md`：主角换成天宫；说明模型是按公开构型程序化生成的示意模型；把 `region` 输入写进"运行"一节；文件表里 `trim_model.py` 换成 `tiangong_model.py`。
- `sfx.py` 里的注释改为 station。

## 验证（推送前必须全部通过）

1. `npm test`（之前是 134 个全过）、`npx tsc --noEmit -p .`、`npm run build`。
2. `node --test tests/cinematic.test.mjs`。
3. 生成 glb 并检查包围盒。条件允许的话，在本地用 Playwright 加 `?record` 跑 `capture.mjs` 的 357、393、410 三帧，看模型。参考：`CINE_FRAMES=393-393`，`PW_CHROMIUM_PATH` 可指定 Chromium。确认三点：
   - T 字横梁横跨画面
   - 太阳翼完整
   - 没有漂浮的零件
4. 推送到 `claude/exciting-hypatia-1rt14s` 和 `main`。推送分支会自动跑 preview，但自动 preview 没有 region 参数，可能拍到别的窗口。所以推送后再手动派发一次 `Cinematic promo`：`mode=preview`、`region=middle-east`。注意：同一个 mode 的新 run 会取消正在跑的 run（concurrency 组），两个 preview 只保留后派发的那个。
5. preview 跑完后，静帧会推到 `video/cinematic-review` 分支，plan.json 也在里面。检查四项：
   - 区域是 `middle-east`
   - 锁定航班的 `distanceFromAimKm` < 250
   - 天宫模型的朝向和大小
   - 锁定框套住天宫
6. 没问题就派发正式录制，**必须在 14:20 UTC 前**：`mode=full`、`max_wait_min=300`、`region=middle-east`、`model_rotation=0,0,0`。
   - plan job 的日志里应该显示 "Filming over 中东 … 2026-10-22 14:37 UTC"，然后开始等待。
   - 窗口过后 11 个 capture 分段并行，render 大约再要 1–1.5 小时。
   - 成片在 artifact `terrascope-cinematic-full` 里。
7. 正式录制进行中**不要再推送** `video/cinematic/**`。会触发新的 preview，虽然不会取消 full，但会占用 runner。

## 不要做的事

- 不要改 `src/` 下与天宫无关的逻辑。网站本来就在显示天宫，快照里的 STATIONS 数据已经包含它。
- 不要放宽"空间站被照亮、正下方天黑"的窗口条件。
- 提交信息里不要写任何模型名称。
