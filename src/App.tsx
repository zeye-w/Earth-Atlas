import { useEffect, useRef, useState } from "react";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Credit,
  Ellipsoid,
  EllipsoidTerrainProvider,
  Math as CesiumMath,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
  type ImageryLayer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { queryGeology, type GeologicalUnit } from "./geology";
import "./styles.css";

type QueryStatus = "idle" | "loading" | "success" | "empty" | "error";
type Coordinates = { latitude: number; longitude: number };
type Region = { label: string; subtitle: string; lat: number; lon: number };

const REGIONS: Region[] = [
  { label: "日本列岛", subtitle: "Japan", lat: 36.2, lon: 138.3 },
  { label: "青藏高原", subtitle: "Tibetan Plateau", lat: 31.8, lon: 88.8 },
  { label: "阿尔卑斯", subtitle: "Alps", lat: 46.6, lon: 10.1 },
  { label: "北美西部", subtitle: "Western US", lat: 39.5, lon: -113.6 },
];

function coordinateLabel(value: number, positive: string, negative: string): string {
  return Math.abs(value).toFixed(4) + "° " + (value >= 0 ? positive : negative);
}

function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const geologicalLayerRef = useRef<ImageryLayer | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [geologyVisible, setGeologyVisible] = useState(true);
  const [opacity, setOpacity] = useState(90);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [geologicalUnit, setGeologicalUnit] = useState<GeologicalUnit | null>(null);
  const [status, setStatus] = useState<QueryStatus>("idle");
  const [globeError, setGlobeError] = useState<string | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    let viewer: Viewer | null = null;
    try {
      viewer = new Viewer(mountRef.current, {
        baseLayer: false,
        baseLayerPicker: false,
        terrainProvider: new EllipsoidTerrainProvider(),
        animation: false,
        timeline: false,
        geocoder: false,
        homeButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        skyBox: false,
        skyAtmosphere: false,
        shouldAnimate: false,
      });

      viewerRef.current = viewer;
      viewer.scene.backgroundColor = Color.fromCssColorString("#0b1725");
      viewer.scene.globe.baseColor = Color.fromCssColorString("#164258");
      viewer.scene.globe.enableLighting = false;
      viewer.scene.fog.enabled = false;
      if (viewer.scene.sun) viewer.scene.sun.show = false;
      if (viewer.scene.moon) viewer.scene.moon.show = false;
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 15000;
      viewer.scene.screenSpaceCameraController.maximumZoomDistance = 65000000;
      viewer.camera.setView({ destination: Cartesian3.fromDegrees(58, 19, 21500000) });

      const provider = new UrlTemplateImageryProvider({
        url: "https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png",
        minimumLevel: 0,
        maximumLevel: 12,
        credit: new Credit('<a href="https://macrostrat.org" target="_blank" rel="noopener noreferrer">Geologic map © Macrostrat / source geological surveys · CC BY 4.0</a>'),
      });
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      geologicalLayerRef.current = layer;

      viewer.screenSpaceEventHandler.setInputAction((event: { position: Cartesian2 }) => {
        if (!viewer || viewer.isDestroyed()) return;
        const position = viewer.camera.pickEllipsoid(event.position, Ellipsoid.WGS84);
        if (!position) return;
        const cartographic = Cartographic.fromCartesian(position);
        const latitude = CesiumMath.toDegrees(cartographic.latitude);
        const longitude = CesiumMath.toDegrees(cartographic.longitude);
        setCoordinates({ latitude, longitude });
        setGeologicalUnit(null);
        setStatus("loading");
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        void queryGeology(latitude, longitude, controller.signal)
          .then((unit) => {
            if (controller.signal.aborted) return;
            setGeologicalUnit(unit);
            setStatus(unit ? "success" : "empty");
          })
          .catch(() => {
            if (!controller.signal.aborted) setStatus("error");
          });
      }, ScreenSpaceEventType.LEFT_CLICK);
    } catch (error) {
      setGlobeError(error instanceof Error ? error.message : "3D globe initialization failed");
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    }

    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      geologicalLayerRef.current = null;
      viewerRef.current = null;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  useEffect(() => {
    if (geologicalLayerRef.current) {
      geologicalLayerRef.current.show = geologyVisible;
      geologicalLayerRef.current.alpha = opacity / 100;
      viewerRef.current?.scene.requestRender();
    }
  }, [geologyVisible, opacity]);

  const flyTo = (region: Region) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(region.lon, region.lat, 3500000),
      duration: 1.8,
    });
  };

  const resetCamera = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(58, 19, 21500000),
      duration: 1.6,
    });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Earth Atlas home">
          <span className="brand-symbol" aria-hidden="true">◎</span>
          <span className="brand-name">EARTH <strong>ATLAS</strong></span>
          <span className="brand-divider" />
          <span className="brand-caption">地球科学图集</span>
        </a>
        <div className="header-right">
          <span className="online-indicator"><span /> LIVE GEOLOGICAL DATA</span>
          <a href="https://github.com/zeye-w/Earth-Atlas" target="_blank" rel="noreferrer" className="source-link">GitHub ↗</a>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="side-content">
            <div className="eyebrow"><span className="serial">01</span> GLOBAL GEOLOGICAL EXPLORER</div>
            <h1>阅读地球的<br /><em>岩石记忆。</em></h1>
            <p className="lead">旋转地球，探索不同地区的地质年代、岩性与出露地质单元。</p>

            <div className="section-divider" />
            <div className="section-caption">MAP LAYERS <span>图层控制</span></div>
            <label className="toggle-row">
              <span className="layer-icon">▧</span>
              <span className="toggle-copy"><strong>全球地质图</strong><small>Macrostrat · Surface geology</small></span>
              <input type="checkbox" checked={geologyVisible} onChange={(event) => setGeologyVisible(event.target.checked)} aria-label="显示全球地质图" />
              <span className="switch" aria-hidden="true" />
            </label>
            <div className={"opacity-control" + (!geologyVisible ? " muted" : "")}>
              <div className="opacity-head"><span>图层不透明度</span><span>{opacity}%</span></div>
              <input type="range" min="15" max="100" step="5" value={opacity} disabled={!geologyVisible} onChange={(event) => setOpacity(Number(event.target.value))} aria-label="地质图不透明度" />
            </div>

            <div className="section-divider" />
            <div className="section-caption">EXPLORE REGIONS <span>快速定位</span></div>
            <div className="regions">
              {REGIONS.map((region) => (
                <button key={region.label} className="region-btn" onClick={() => flyTo(region)}>
                  <span className="region-mark">⌖</span>
                  <span><strong>{region.label}</strong><small>{region.subtitle}</small></span>
                  <span className="region-arrow">↗</span>
                </button>
              ))}
            </div>

            <div className="sidebar-note">
              <span className="note-icon">i</span>
              <p>地质图反映地表地质单元，不代表地下岩层。年代与岩性取自原始地质图编绘数据。</p>
            </div>
          </div>
          <div className="sidebar-bottom">EARTH ATLAS <span>—</span> MVP 0.1</div>
        </aside>

        <section className="globe-panel" aria-label="可交互三维地质地球">
          <div className="globe-mount" ref={mountRef} />
          <div className="globe-top-left">
            <span className="map-tag"><span className="tag-dot" /> 3D GLOBAL VIEW</span>
            <span className="map-subtitle">GEOLOGICAL SURFACE MAP</span>
          </div>
          <button className="reset-button" type="button" onClick={resetCamera} title="返回全球视角" aria-label="返回全球视角">◎ <span>重置视角</span></button>
          <div className="globe-guide"><span className="guide-orbit">↔</span><span>拖动旋转 · 滚轮缩放 · 点击查询</span></div>
          <div className="globe-attribution">Map data: <a href="https://macrostrat.org/" target="_blank" rel="noreferrer">Macrostrat</a> · CC BY 4.0 · Source surveys</div>
          {globeError && <div className="globe-error" role="alert">三维地球启动失败：{globeError}<p>请检查 WebGL 支持和浏览器环境。</p></div>}
        </section>

        <aside className="details-panel" aria-live="polite">
          <div className="details-head">
            <div className="section-caption">GEOLOGICAL INSPECTOR <span>地质信息</span></div>
            <span className="inspect-status">{status === "loading" ? "QUERYING" : status === "success" ? "RECORD FOUND" : "AWAITING POINT"}</span>
          </div>

          {status === "idle" && (
            <div className="empty-inspector">
              <div className="empty-emblem">⌖</div>
              <h2>选择地球上的<br />任意位置</h2>
              <p>点击球体上的一个地点，即可查看已编绘的地质年代与岩石类型。</p>
              <span className="empty-hint">CLICK THE GLOBE TO BEGIN</span>
            </div>
          )}

          {coordinates && status !== "idle" && (
            <div className="inspector-body">
              <div className="coordinates-block">
                <div className="metric-label">SELECTED COORDINATES</div>
                <div className="coordinate-values"><span>{coordinateLabel(coordinates.latitude, "N", "S")}</span><span>{coordinateLabel(coordinates.longitude, "E", "W")}</span></div>
              </div>

              {status === "loading" && <div className="query-message"><span className="loading-ring" />正在查询 Macrostrat 地质数据库…</div>}
              {status === "error" && <div className="message-card error" role="alert"><strong>地质查询暂时不可用</strong><p>请检查网络连接或稍后重试。不会使用模拟数据替代查询结果。</p></div>}
              {status === "empty" && <div className="message-card"><strong>当前位置暂无地质单元数据</strong><p>这可能是海域、未编绘区域或数据源暂时没有匹配记录。请尝试其他陆地区域。</p></div>}
              {status === "success" && geologicalUnit && (
                <>
                  <div className="unit-heading"><div className="metric-label">MAP UNIT / 地质单元</div><h2>{geologicalUnit.name}</h2></div>
                  <div className="info-field"><span className="metric-label">GEOLOGICAL AGE · 地质年代</span><strong>{geologicalUnit.age ?? "未提供"}</strong></div>
                  <div className="info-field"><span className="metric-label">LITHOLOGY · 岩性</span><strong>{geologicalUnit.lithology ?? "未提供"}</strong></div>
                  <div className="info-field"><span className="metric-label">NUMERICAL AGE · 数值年龄</span><strong>{geologicalUnit.ageRangeMa ?? "未提供"}</strong></div>
                  {geologicalUnit.description && <div className="info-field"><span className="metric-label">DESCRIPTION · 原图描述</span><p>{geologicalUnit.description}</p></div>}
                  <div className="source-card"><div className="metric-label">SOURCE / 数据来源</div><strong>{geologicalUnit.sourceName ?? "Macrostrat integrated geologic map"}</strong>{geologicalUnit.sourceId !== null && <span>Source ID: {geologicalUnit.sourceId}</span>}<a href={geologicalUnit.sourceId !== null ? "https://macrostrat.org/api/v2/defs/sources?source_id=" + geologicalUnit.sourceId : "https://macrostrat.org/map/"} target="_blank" rel="noreferrer">核对原始地图来源 ↗</a></div>
                </>
              )}
            </div>
          )}
          <div className="details-footer">
            <span className="details-footer-dot" />
            <span>科学数据来自 Macrostrat。不同区域的比例尺、精度和数据完整性可能不同。</span>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
