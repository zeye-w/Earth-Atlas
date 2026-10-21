# 网页当前场景 → iPhone 实况图（实验功能）

> **现在网页不再需要这个本地服务。** 录制、H.264 编码和 JPG/MOV 配对封装都已在浏览器里完成（`src/livePhotoCapture.ts`、`src/livePhotoFormat.ts`，后者是本目录 `vendor/makelive_mov.py` 与 `jpeg.mjs` 的移植），线上网站即可导出。本目录保留作参考实现：`jpeg.mjs` 和 `movValidation.mjs` 被根目录的 `tests/livePhoto.test.mjs` 用来交叉校验浏览器版的输出。下面是原本地服务版本的说明。

顶部「实况图」→ 录制当前场景 3 秒 → 预览并拖动封面滑块 → 导出资源包。
画面直接来自 Cesium 的 postRender，不改变普通浏览的 WebGL 配置。可以固定/手动镜头或缓慢环绕；卫星跟踪时禁用额外环绕。只录地球 Canvas 和数据署名，不录面板或麦克风。关闭面板、取消录制或切到后台会停止录制并释放资源，环绕后恢复相机。

## 本地启动

需要 Node.js（支持 AbortSignal.any）、Python 3，首次安装时需联网下载 FFmpeg。

```powershell
npm ci
npm ci --prefix tools/live-photo
# 终端一：本地封装服务，默认仅监听 127.0.0.1:4174
npm start --prefix tools/live-photo
# 终端二：本分支网页，Vite 自动代理 /api/live-photo
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

打开 http://127.0.0.1:5175/ 。如 Python 不在 PATH，给封装服务设置 `PYTHON_PATH` 为完整可执行文件路径。测试：`npm test --prefix tools/live-photo`。

## 导出内容与手机导入

- `TERRASCOPE.JPG`：选定封面帧，Apple MakerNote 0x0011 配对 UUID。
- `TERRASCOPE.MOV`：H.264 / yuv420p，匹配的 QuickTime content identifier；`mebx` 元数据轨在所选封面时刻携带 `still-image-time`。
- `scene.json`：录制时间、场景时间、相机、图层与数据状态、封面时间和校验状态。
- `导入说明.txt`：导入流程与已知限制。

这是一组 Live Photo 配对资源，而不是一个能直接从 Safari 保存为实况图的普通图片文件。在 Mac「照片」中同时导入 JPG/MOV，再通过 iCloud 照片同步到 iPhone，或使用支持 `photo` + `pairedVideo` 的 iOS 导入程序。**当前开发环境为 Windows，没有连接 iPhone；自动化测试只能验证文件结构，尚不能确认真机相册显示 LIVE、播放及封面选择。** 未完成真机验收前保持实验标记。

## 部署边界

Cloudflare Workers 静态站点不包含 Node/Python/FFmpeg 服务。发布此分支网页后仍可录制、预览、下载原始片段及场景 JSON；完整封装目前只支持上述本地启动方式，不会自动上传到第三方。不能把本地 API 当作可直接部署到 Workers 的服务。后续可另做受控媒体后端或原生 iOS 保存器。

本地 API 只接受 loopback Host/Origin，单任务，40 MB 请求上限；视频最长转换 3 秒，转换超时 120 秒，临时目录在请求结束后删除。不接受用户路径/文件名或 shell 命令。

## 科学数据和第三方代码

录制当前真实渲染，保留署名及画面已有水印；不添加或增强科学图层，不伪造手机品牌、型号、GPS 或相机拍摄信息。静态图层、科学预报和轨道推算的含义沿用网站说明。测试中的 `testsrc2`/海洋色块是明确的测试夹具，不是地球观测样片。

录制期间暂缓自动降低画质，结束后恢复原来的自动策略；相机环绕也会恢复起始视角。文件封装测试会由 ExifTool 独立读取 JPEG/MOV 标识及 timed metadata，并检查 QuickTime edit list 对封面时刻的映射。浏览器全流程测试单独放在 `tests/live-photo`，运行 `npx playwright test --config playwright.live-photo.config.ts`，不会混入普通站点的 E2E 配置。

`vendor/makelive_mov.py` 与 `vendor/apple-meta-trak.bin` 来自 [Ariesshin/live-photo](https://github.com/Ariesshin/live-photo)，固定提交 `d6dc3f3cf3e711e65277c80c1731d85fe244d28a`，MIT 许可见 `vendor/LICENSE`。仅复用 MOV 容器/元数据封装；不使用其相机 JPEG 供体，也不添加其相机设备信息。JPEG EXIF 写入由本项目实现，并用独立 ExifTool 验证。

参考：[Apple Live Photo metadata](https://developer.apple.com/documentation/avfoundation/avcapturephotosettings/livephotomoviemetadata)、[Apple 保存配对资源](https://developer.apple.com/documentation/avfoundation/capturing-and-saving-live-photos)。

## 本次验证

- 站点 TypeScript / 生产构建及静态资源检查通过；与最新 main 集成后的 124 项单元测试通过。
- 2 项本地工具测试通过：独立 EXIF/QuickTime 解析、封面像素一致、视频解码、异常输入/非本地请求拒绝。
- 4 项浏览器测试通过：场景录制到 ZIP、封面选择、相机及画质恢复、取消/关闭后重录、服务离线保存片段、手机布局和不支持录制时的提示。
- 已用真实网站数据完成一次浏览器录制到导出，未捕获页面错误。测试夹具不作真实数据样片。
- 待人工验收：Mac「照片」导入，以及 iPhone 相册的 LIVE 标识、播放、封面和分享行为。没有标为真机通过。
