import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Code, Crosshair, Layers, Maximize, Minimize, Orbit, Search, Share2, SlidersHorizontal } from "lucide-react";
import { AUTO_QUALITY_MIN_FPS, RENDER_QUALITY_LABELS, RENDER_QUALITY_ORDER, type RenderQuality } from "../performance";
import { ICON, Segmented } from "../ui/controls";

interface Props {
  clock: ReactNode;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onShare: () => void;
  controlsOpen: boolean;
  onToggleControls: () => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  quality: RenderQuality;
  onChooseQuality: (quality: RenderQuality) => void;
  autoQuality: boolean;
  onAutoQuality: (auto: boolean) => void;
}

export function TopBar(props: Props) {
  const { clock, searchOpen, onToggleSearch, onShare, controlsOpen, onToggleControls, detailsOpen, onToggleDetails } = props;
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="TerraScope 首页">
        <span className="brand-symbol" aria-hidden="true"><Orbit size={18} strokeWidth={1.6} /></span>
        <span className="brand-name">TERRA<strong>SCOPE</strong></span>
        <span className="brand-divider" />
        <span className="brand-caption">数字地球</span>
      </a>
      <div className="header-right">
        {clock}
        <div className="header-actions" role="group" aria-label="页面视图控制">
          <button type="button" className="header-action" aria-label="搜索地点" aria-expanded={searchOpen} aria-controls="place-search-panel" onClick={onToggleSearch}><Search {...ICON} /><span className="action-caption">搜索</span></button>
          <button type="button" className="header-action" aria-label="分享当前场景" onClick={onShare}><Share2 {...ICON} /><span className="action-caption">分享</span></button>
          <button type="button" className={"header-action" + (controlsOpen ? " active" : "")} onClick={onToggleControls} aria-label="图层" aria-expanded={controlsOpen} aria-controls="earth-layer-panel">
            <Layers {...ICON} aria-hidden="true" /><span className="action-caption">图层</span>
          </button>
          <button type="button" className={"header-action" + (detailsOpen ? " active" : "")} onClick={onToggleDetails} aria-label="地点" aria-expanded={detailsOpen} aria-controls="earth-inspector-panel">
            <Crosshair {...ICON} aria-hidden="true" /><span className="action-caption">地点</span>
          </button>
          <SettingsMenu {...props} />
        </div>
      </div>
    </header>
  );
}

function SettingsMenu({ quality, onChooseQuality, autoQuality, onAutoQuality }: Props) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  // Close the popover on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="settings-anchor" ref={anchorRef}>
      <button type="button" className={"header-action" + (open ? " active" : "")} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="view-settings" aria-label="显示设置">
        <SlidersHorizontal {...ICON} aria-hidden="true" /><span className="action-caption">设置</span>
      </button>
      {open && (
        <div id="view-settings" className="settings-popover" role="dialog" aria-label="显示设置">
          <div className="metric-label">RENDER QUALITY · 画质</div>
          <Segmented label="渲染画质" options={RENDER_QUALITY_ORDER} value={quality} onChange={onChooseQuality} format={(q) => RENDER_QUALITY_LABELS[q]} />
          <p className="settings-hint">省电模式降低分辨率并关闭玻璃模糊，适合笔记本和手机。</p>
          <label className="settings-toggle">
            <input type="checkbox" checked={autoQuality} onChange={(event) => onAutoQuality(event.target.checked)} />
            <span><strong>自动调整画质</strong><small>{autoQuality ? "拖动时帧率持续低于 " + AUTO_QUALITY_MIN_FPS + " fps 会自动降低一档" : "已改为手动选择画质"}</small></span>
          </label>
          <button type="button" className="settings-row" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize {...ICON} aria-hidden="true" /> : <Maximize {...ICON} aria-hidden="true" />}
            <span>{fullscreen ? "退出全屏" : "全屏浏览"}</span>
          </button>
          <a className="settings-row" href="https://github.com/zeye-w/Earth-Atlas" target="_blank" rel="noreferrer">
            <Code {...ICON} aria-hidden="true" /><span>GitHub 源代码</span><ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}
