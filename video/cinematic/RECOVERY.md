# 固定快照补录

2026-10-22 的正式任务 `39791271455` 因 486–575 段的 7 帧未就绪失败，其他成功分段另有 4 帧未就绪。原始 900 帧与 `cine-plan` 都由工作流保留，不必再等一次过境或重新采集实时数据。

## 修复策略

每帧先按原来的 45 秒等待。超时后，相机、虚拟时间、图层和特效时间保持不变，仅继续调用原 `idle()`，增加 90 秒和 180 秒两次有界等待。就绪条件和原来的正式质量上限不变，不将超时改记为成功。

`CINE_FRAMES` 支持逗号分隔的帧或范围；补录时设置 `CINE_REQUIRE_SETTLED=1`，任何补录帧未就绪即失败，不将不合格截图交给合并脚本。补录仍从原始 `plan.json` 与 `data/` 回放，不新取轨道、航班或天气。只有本地代理 `/api/flights` 允许跨本机端口匹配同一快照，其他数据仍匹配原始来源。

## 恢复步骤

1. 下载原任务的 `cine-plan` 和所有 `cine-frames-*` artifacts，保留原始目录。
2. 收集各 `capture-*.json` 中所有 `settled=false` 帧，使用同一 `CINE_PLAN`、原尺寸模型和修复后的 capture 脚本补录到新目录。
3. 执行 `node video/cinematic/recover.mjs SOURCE_ARTIFACT_DIR REPAIR_DIR PLAN_DIR NEW_FRAME_DIR 39791271455`。
4. 执行 `python video/cinematic/verify_recovery.py NEW_FRAME_DIR SOURCE_ARTIFACT_DIR PLAN_DIR`，独立复算原图、交付图和数据文件哈希，验证所有相机与时间不变。
5. 使用原 plan 重新生成 sfx，并通过 `render.py` 合成视频。可设置 `CINE_FFMPEG` 指向便携 FFmpeg；默认仍从 PATH 查找。

合并要求：原始 900 帧唯一且齐全；只替换未就绪帧；补录时间与相机完全一致；合并后 **0 帧未就绪**。900 帧的原始/新图 SHA-256、各捕获报告与数据快照哈希保存在 `recovery.json`，原素材不覆盖。

原 651–725 段的 5 条 `console ... net::ERR_FAILED` 警告会保留到 provenance 和合并后的 capture 记录，不认定为无害或清空。缺失快照、不同拍摄时刻、未捕获 JavaScript 错误，以及补录中的任何错误都会阻止合并；原网络警告对应的画面另做人工审查。

代码验证：`node --test tests/cinematic-recovery.test.mjs`，覆盖稀疏选帧、有界等待、相机/时刻一致性及零未就绪约束。恢复素材与成片存入 `.cache/`，不提交 Git。

## Automatic local resume

Run the same capture command again with the same CINE_PLAN, CINE_OUT and CINE_FRAMES. Each completed JPEG is atomically renamed and its SHA-256 and HUD metadata are atomically checkpointed immediately. Only settled JPEGs with matching hashes are skipped; missing, changed, partial and unsettled frames are recaptured. Interrupted writes can leave a .tmp file, which is never reused. Earlier attempt warnings are preserved in previousAttempts. A snapshot replay miss invalidates the earlier attempt's frames.

The checkpoint binds the full plan/snapshot, built dist files, tracked source contents, site and model parameters. Changed inputs or legacy reports require a fresh output directory; do not bypass this guard. Complete verified ranges exit before launching Chromium. GitHub Actions: dispatch cinematic-promo.yml at the original commit with resume_run set to the completed source run ID, and identical mode/model_rotation parameters. It restores the original cine-plan and available per-range artifacts; absent chunks are captured from the same frozen plan. It never searches for a new window in resume mode. Changed commits, expired/missing plans, incompatible checkpoints or changed model parameters fail safely. Full/preview jobs are queued rather than cancelling an existing recording, and chunk failures no longer cancel sibling chunks. Legacy captures without checkpoints need a new output or the documented recovery tool. This only works while source artifacts remain available (7 days). Keep the original plan directory and build. Use separate output directories when comparing night-light changes.
