/**
 * The layer panel's categories: which group sits under which tab, which
 * layer toggles belong to each, and which layers count as "turned on by the
 * visitor" (on now but off in the default view). Pure, so it can be tested.
 */
import type { LayerToggles } from "../hooks/useLayerSettings";

export type LayerTab = "earth" | "space" | "human" | "play";
export const LAYER_TABS: readonly LayerTab[] = ["earth", "space", "human", "play"];
export const TAB_LABELS: Record<LayerTab, string> = { earth: "地球", space: "太空", human: "人类活动", play: "互动" };

type LayerKey = keyof LayerToggles;

/** Every toggle with its tab and the name shown on its chip (the toggle's own title). */
export const LAYER_INFO: Record<LayerKey, { tab: LayerTab; label: string }> = {
  dayNight: { tab: "earth", label: "实时昼夜光照" },
  atmosphere: { tab: "earth", label: "大气散射" },
  shells: { tab: "earth", label: "大气分层" },
  trueColor: { tab: "earth", label: "每日真彩影像" },
  clouds: { tab: "earth", label: "卫星云图（红外）" },
  lights: { tab: "earth", label: "城市夜光" },
  aurora: { tab: "earth", label: "极光" },
  solarWind: { tab: "earth", label: "太阳风与磁层" },
  geoLabels: { tab: "earth", label: "地理标注" },
  cities: { tab: "earth", label: "全球主要城市" },
  temperature: { tab: "earth", label: "全球气温" },
  quakes: { tab: "earth", label: "实时地震" },
  volcanoes: { tab: "earth", label: "火山" },
  plates: { tab: "earth", label: "板块边界" },
  geology: { tab: "earth", label: "全球地质图" },
  naturalEvents: { tab: "earth", label: "全球自然事件" },
  storms: { tab: "earth", label: "台风路径" },
  satellites: { tab: "space", label: "真实卫星轨道" },
  paths: { tab: "space", label: "卫星预测轨迹" },
  starlink: { tab: "space", label: "星链星座" },
  launches: { tab: "space", label: "火箭发射日历" },
  moon: { tab: "space", label: "月亮" },
  eclipses: { tab: "space", label: "日食与月食" },
  meteors: { tab: "space", label: "流星雨" },
  realSky: { tab: "space", label: "真实星空" },
  constellations: { tab: "space", label: "星座连线" },
  sun: { tab: "space", label: "实时太阳" },
  asteroids: { tab: "space", label: "近地小行星" },
  probes: { tab: "space", label: "深空探测器" },
  flights: { tab: "human", label: "实时航班" },
  cables: { tab: "human", label: "海底光缆" },
  ixps: { tab: "human", label: "互联网交换中心" },
  dataCenters: { tab: "human", label: "数据中心" },
  rootServers: { tab: "human", label: "DNS 根服务器" },
  dnsFlows: { tab: "human", label: "DNS 查询（实测）" },
};

/** On in the default view; turning these on is not "opening" a layer. */
export const DEFAULT_ON: ReadonlySet<LayerKey> = new Set(["dayNight", "atmosphere", "lights", "aurora", "geoLabels", "cities", "satellites", "realSky"]);

/** Layers the visitor has turned on beyond the default view, in panel order. */
export function openedLayers(layers: LayerToggles): LayerKey[] {
  return (Object.keys(LAYER_INFO) as LayerKey[]).filter((key) => layers[key] && !DEFAULT_ON.has(key)
    // Predicted paths only show with the satellites.
    && !(key === "paths" && !layers.satellites)
    && !(key === "constellations" && !layers.realSky));
}

export function openedCounts(layers: LayerToggles): Record<LayerTab, number> {
  const counts: Record<LayerTab, number> = { earth: 0, space: 0, human: 0, play: 0 };
  for (const key of openedLayers(layers)) counts[LAYER_INFO[key].tab]++;
  return counts;
}

const STORAGE_KEY = "terrascope.layerTab";

export function savedTab(): LayerTab {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LAYER_TABS as readonly string[]).includes(saved)) return saved as LayerTab;
  } catch { /* storage blocked */ }
  return "earth";
}

export function saveTab(tab: LayerTab): void {
  try { localStorage.setItem(STORAGE_KEY, tab); } catch { /* storage blocked */ }
}
