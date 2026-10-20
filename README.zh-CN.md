<div align="center">

# TerraScope · 数字地球

**在浏览器里运行的实时三维数字地球：实时日照、城市夜光、极光、地震、火山、卫星与全球地质，全部来自开放数据。**

[English](README.md) · 简体中文

[**在线体验 →**](https://earth-atlas.edwardlab.workers.dev/)

[![CI](https://github.com/zeye-w/Earth-Atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/zeye-w/Earth-Atlas/actions/workflows/ci.yml)
![React 19](https://img.shields.io/badge/React-19-61dafb)
![CesiumJS](https://img.shields.io/badge/CesiumJS-1.146-6caddf)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

![TerraScope：实时日照、城市夜光与图层面板](docs/screenshots/hero.jpg)

</div>

## 亮点

- **此刻真实的地球**：按当前 UTC 时间计算太阳位置，白天是 NASA Blue Marble 卫星影像，夜半球是 NASA Black Marble 城市灯光。
- **实时地球物理数据**：USGS 地震、NOAA 极光预报与 Kp 地磁指数、史密森尼火山名录、PB2002 板块边界。
- **在轨卫星**：根据 CelesTrak 轨道根数用 SGP4 预测位置，轨道线画在真实高度上。
- **按需加载的地质图**：Macrostrat 全球地质图，点击任意位置查看岩石单元、地质年代和岩性。
- **不编造数据**：数据源不可用时，图层会明确提示并且不绘制；示意性的内容都有标注。
- **轻快**：按需渲染，按帧率自动调整画质，图层打开时才加载；无需 API Key，不使用付费服务。

## 功能展示

<table>
<tr>
<td width="50%"><img src="docs/screenshots/night-lights.jpg" alt="夜半球城市灯光"><br><b>城市夜光</b><br>NASA Black Marble（VIIRS）夜光沿真实晨昏线显示在夜半球。只保留灯光并加上柔和光晕，底下是压暗的白天影像，看起来是同一个地球。</td>
<td width="50%"><img src="docs/screenshots/aurora.jpg" alt="极光与 Kp 面板"><br><b>极光与地磁活动</b><br>极光帘幕的位置和亮度来自 NOAA SWPC OVATION 实时预报；面板显示当前 Kp 指数、NOAA 磁暴等级和过去 24 小时变化。</td>
</tr>
<tr>
<td><img src="docs/screenshots/tectonics.jpg" alt="地震、板块边界与火山"><br><b>地震、板块与火山</b><br>USGS 实时地震（大小表示震级，颜色表示震源深度）、Bird (2003) 板块边界（突出俯冲带）以及约 1,200 座全新世火山，点击可查看详情。</td>
<td><img src="docs/screenshots/satellites.jpg" alt="卫星与轨道"><br><b>卫星</b><br>国际空间站、天宫、哈勃和对地观测卫星沿 SGP4 预测轨道运行，可切换 60× / 300× 加速预览。</td>
</tr>
<tr>
<td><img src="docs/screenshots/geology.jpg" alt="地质图与查询面板"><br><b>全球地质</b><br>Macrostrat 地质图（栅格，或实验性的年代 / 岩性矢量视图）。点击地面即可列出该处的地质单元、年代和岩石类型。</td>
<td><img src="docs/screenshots/atmosphere-layers.jpg" alt="地球边缘的大气分层"><br><b>大气分层</b><br>按真实高度绘制对流层、平流层、中间层、卡门线和热层的顶部边界（美国标准大气 1976），可放大 5× / 20× 并标注为示意。</td>
</tr>
<tr>
<td><img src="docs/screenshots/geo-labels.jpg" alt="东亚地理标注"><br><b>地理标注</b><br>大洋、海域、海峡、山脉、沙漠、平原、盆地和河流的中文标注，位置取自 Natural Earth 地理数据；自动避让重叠，拉近后显示更多。</td>
<td><img src="docs/screenshots/clouds.jpg" alt="红外卫星云图"><br><b>卫星云图</b><br>SSEC RealEarth 逐小时多卫星红外合成图，所有瓦片对齐到同一观测时次，并在面板中显示观测时间。</td>
</tr>
</table>

<p align="center"><img src="docs/screenshots/mobile.jpg" alt="手机上的 TerraScope" width="260"><br><sub>手机上也能用：面板变为底部抽屉，默认使用省电画质。</sub></p>

**其他功能**：地点与坐标搜索；可分享的场景链接（还原视角、图层与筛选条件）；全屏；尊重"减少动态效果"系统设置；省电 / 均衡 / 高清三档画质。

## 数据来源

| 图层 | 来源 | 更新频率 |
| --- | --- | --- |
| 白天影像 | NASA GIBS：Blue Marble 地形晕渲与海底地形 | 静态 |
| 城市夜光 | NASA GIBS：VIIRS Black Marble 2016 | 2016 年合成（不是今晚的灯光） |
| 极光 | NOAA SWPC：OVATION 极光实时预报 | 每 10 分钟 |
| Kp 指数 | NOAA SWPC：行星际 K 指数 | 每 10 分钟 |
| 地震 | USGS：GeoJSON 汇总数据 | 每 5 分钟 |
| 火山 | 史密森尼学会 GVP：*Volcanoes of the World* | 内置，由工作流刷新 |
| 板块边界 | Bird (2003) PB2002，Hugo Ahlenius / Nordpil 转换的 GeoJSON（ODC-BY） | 内置 |
| 卫星 | CelesTrak：GP 轨道根数（OMM JSON），`satellite.js` SGP4 计算 | 缓存至少 2 小时 |
| 云图 | SSEC / UW–Madison RealEarth：`globalir` | 逐小时 |
| 地质 | Macrostrat（CC BY 4.0） | 实时瓦片与查询 |
| 地理标注 | Natural Earth（公共领域） | 内置 |
| 搜索 | Open-Meteo / GeoNames；mledoze/countries（ODbL） | 按需 |

完整的数据署名和科学说明见 [docs/TECHNICAL.md](docs/TECHNICAL.md)（英文）。

## 快速开始

需要 Node.js 22 及以上版本。

```bash
npm install
npm run dev          # 启动开发服务器
npm test             # 单元测试
npm run build        # 生产构建
npm run test:e2e     # 基于构建产物的 Playwright 端到端测试（外部服务全部模拟）
```

不需要任何 API Key；实时影像和数据需要联网。

## 项目结构

```
src/
  App.tsx            组合各个 hook 与面板
  hooks/             Viewer、渲染画质、图层设置、实时数据轮询
  layers/            每个地图图层一个 hook（夜光、极光、地震、卫星……）
  panels/ ui/        玻璃卡片界面
  data/              内置数据集（火山、板块边界、地理标注）
scripts/             数据生成、线上数据源检查、截图生成
tests/               单元测试（node:test）与端到端测试（Playwright）
```

以静态资源形式部署在 Cloudflare Workers（`wrangler.jsonc`）。本页截图由 [README Screenshots](.github/workflows/screenshots.yml) 工作流使用实时数据渲染生成。

## 科学说明

- 卫星位置是根据公开轨道根数做的 SGP4 **预测**，不是实时遥测。
- 城市夜光是 2016 年的年度合成影像；极光帘幕的形状和动画是风格化的，位置和亮度来自 NOAA 预报。
- 火山颜色反映名录中的喷发年份，不是当前的预警级别。
- 地质单元是地表填图单元；同一位置有多个结果时作为候选项列出。

更多细节见 [docs/TECHNICAL.md](docs/TECHNICAL.md)。

## 许可证

代码采用 MIT 许可证；第三方数据集遵循各自的许可（见上表）。
