import type { ReactNode } from "react";
import { ArrowUpRight, Info, LocateFixed, X } from "lucide-react";
import { LayerGroup } from "../ui/controls";

export type Region = { label: string; subtitle: string; lat: number; lon: number };

const REGIONS: Region[] = [
  { label: "北京", subtitle: "Beijing · 中国", lat: 39.9042, lon: 116.4074 },
  { label: "华盛顿", subtitle: "Washington, D.C. · 美国", lat: 38.9072, lon: -77.0369 },
  { label: "伦敦", subtitle: "London · 英国", lat: 51.5074, lon: -0.1278 },
  { label: "巴黎", subtitle: "Paris · 法国", lat: 48.8566, lon: 2.3522 },
  { label: "东京", subtitle: "Tokyo · 日本", lat: 35.6762, lon: 139.6503 },
  { label: "新德里", subtitle: "New Delhi · 印度", lat: 28.6139, lon: 77.2090 },
];

/** The left glass card: intro, the layer groups (children), capitals and sources. */
export function LayerPanel({ open, onClose, onFlyTo, children }: { open: boolean; onClose: () => void; onFlyTo: (region: Region) => void; children: ReactNode }) {
  return (
    <aside id="earth-layer-panel" aria-label="地球图层" aria-hidden={!open} inert={!open} className={"sidebar glass-panel" + (!open ? " is-collapsed" : "")}>
      <button type="button" className="panel-dismiss" onClick={onClose} aria-label="收起图层面板"><X size={15} aria-hidden="true" /></button>
      <div className="side-content">
        <div className="eyebrow"><span className="serial">01</span> DIGITAL EARTH EXPLORER</div>
        <h1>观察一颗<br /><em>实时运转的地球。</em></h1>
        <p className="lead">真实的昼夜交替、在轨卫星、全球城市与地表地质，汇聚在同一颗可交互的三维地球上。</p>

        {children}

        <LayerGroup title="CAPITALS" subtitle="首都快速定位">
          <div className="regions">
            {REGIONS.map((region) => (
              <button key={region.label} className="region-btn" onClick={() => onFlyTo(region)}>
                <LocateFixed size={16} strokeWidth={1.7} className="region-mark" aria-hidden="true" />
                <span><strong>{region.label}</strong><small>{region.subtitle}</small></span>
                <ArrowUpRight size={14} className="region-arrow" aria-hidden="true" />
              </button>
            ))}
          </div>
        </LayerGroup>

        <div className="sidebar-note">
          <Info size={14} className="note-icon" aria-hidden="true" />
          <p>影像与城市夜光来自 NASA GIBS（Blue / Black Marble）与 Natural Earth，卫星轨道来自 CelesTrak，极光预报来自 NOAA SWPC，地震来自 USGS，火山来自 Smithsonian GVP，板块边界来自 Bird (2003) PB2002（Nordpil 整理，ODC-BY），地质数据来自 Macrostrat。卫星位置为轨道推算；地质图反映地表单元，不代表地下岩层。</p>
        </div>
      </div>
      <div className="sidebar-bottom">TERRASCOPE <span>—</span> MVP 0.2</div>
    </aside>
  );
}
