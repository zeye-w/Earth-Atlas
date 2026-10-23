import { useEffect, useState } from "react";
import { Activity, Building2, Cable, Network, Pause, Play, Server } from "lucide-react";
import type { LayerToggles } from "../hooks/useLayerSettings";
import type { DatasetStatus, InternetState } from "../layers/useInternet";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";
import "./internet.css";

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  internet: InternetState;
  live: boolean;
  onCableYear: (year: number | null) => void;
}

const count = (n: number) => n.toLocaleString("zh-CN");

const PLAY_MS_PER_YEAR = 260;
// Below this share of dated cables a year filter would hide most of the map.
const MIN_DATED_SHARE = 0.3;

/** Cables in service year by year: a slider and a play button that grows the network. */
function CableYears({ year, years, onYear }: { year: number | null; years: [number, number]; onYear: (year: number | null) => void }) {
  const [playing, setPlaying] = useState(false);
  const thisYear = new Date().getUTCFullYear();
  const [first, last] = [years[0], Math.max(years[0], Math.min(years[1], thisYear))];
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const next = (year ?? first - 1) + 1;
      if (next >= last) { onYear(last); setPlaying(false); } else onYear(next);
    }, PLAY_MS_PER_YEAR);
    return () => window.clearInterval(timer);
  }, [playing, year, first, last, onYear]);
  return (
    <div className="internet-years">
      <div className="opacity-head"><span>投产年份</span><span>{year === null ? "全部（含规划中）" : "截至 " + year + " 年"}</span></div>
      <div className="internet-years-row">
        <button type="button" onClick={() => { if (!playing && (year === null || year >= last)) onYear(first); setPlaying(!playing); }} aria-label={playing ? "暂停光缆生长" : "播放光缆生长"}>
          {playing ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
        </button>
        <input type="range" min={first} max={last} step={1} value={year ?? last} aria-label="光缆投产年份" onChange={(e) => { setPlaying(false); onYear(Number(e.target.value)); }} />
        <button type="button" className={year === null ? "active" : undefined} onClick={() => { setPlaying(false); onYear(null); }}>全部</button>
      </div>
    </div>
  );
}

function status(s: DatasetStatus, ready: string): string {
  return s === "loading" ? "正在读取…" : s === "error" ? "数据暂不可用，未显示。" : s === "ready" ? ready : "";
}

/**
 * Internet infrastructure (docs/internet-layers.md). First cut: toggles and
 * status lines; track D adds the legend, sources and "measured / estimated /
 * illustrative" labels.
 */
export function InternetGroup({ layers, setLayer, internet, live, onCableYear }: Props) {
  const { data, datasets, dns } = internet;
  const cableCount = data.cables?.cables.length ?? 0;
  const unnamedCables = data.cables?.cables.filter((c) => c.name.startsWith("Unnamed OSM")).length ?? 0;
  const yearsUsable = cableCount > 0 && internet.datedCables / cableCount >= MIN_DATED_SHARE;
  const letters = new Set(internet.measuredRoots.map((r) => r.instance.letter)).size;
  return (
    <LayerGroup title="INTERNET" subtitle="互联网基础设施">
      <ToggleRow icon={<Cable {...ICON} />} title="海底光缆" caption="OpenStreetMap 志愿者标注 · 覆盖不完整" checked={layers.cables} onChange={(v) => setLayer("cables", v)} />
      {layers.cables && (
        <div className="layer-extra">
          <p className="layer-status" role="status">{status(datasets.cables, count(cableCount) + " 段光缆" + (unnamedCables ? "（其中 " + count(unnamedCables) + " 段未命名）" : ""))}</p>
          {datasets.cables === "ready" && (yearsUsable && internet.cableYears
            ? <CableYears year={internet.cableYear} years={internet.cableYears} onYear={onCableYear} />
            : <p className="layer-note">只有 {count(internet.datedCables)} 段标注了投产年份，暂不提供按年份浏览。OpenStreetMap 里的海底光缆由志愿者逐段标注，并不完整；白色亮点沿光缆流动，表示这是通信线路，不代表实际流量。</p>)}
        </div>
      )}
      <ToggleRow icon={<Network {...ICON} />} title="互联网交换中心" caption="Wikidata 收录 · 远少于实际数量" checked={layers.ixps} onChange={(v) => setLayer("ixps", v)} />
      {layers.ixps && <p className="layer-status" role="status">{status(datasets.ixps, count(data.ixps?.ixps.length ?? 0) + " 个交换中心")}</p>}
      <ToggleRow icon={<Building2 {...ICON} />} title="数据中心" caption="OpenStreetMap 标注的数据中心" checked={layers.dataCenters} onChange={(v) => setLayer("dataCenters", v)} />
      {layers.dataCenters && <p className="layer-status" role="status">{status(datasets.facilities, count(data.facilities?.facilities.length ?? 0) + " 个设施")}</p>}
      <ToggleRow icon={<Server {...ICON} />} title="DNS 根服务器" caption="此刻实测查询命中的任播实例" checked={layers.rootServers} onChange={(v) => setLayer("rootServers", v)} />
      {layers.rootServers && (
        <p className="layer-status" role="status">
          {!live ? "实例取自最新的实测查询；回到「实时」后显示。" :
           dns.status === "error" && !dns.snapshot ? "实测数据暂不可用，未显示。" :
           dns.snapshot ? "此刻实测命中 " + count(internet.measuredRoots.length) + " 个实例 · 13 个根字母中的 " + letters + " 个" :
           "正在读取 RIPE Atlas 测量结果…"}
        </p>
      )}
      <ToggleRow icon={<Activity {...ICON} />} title="DNS 查询（实测）" caption="RIPE Atlas 探针 → 实际应答的根服务器实例" checked={layers.dnsFlows} onChange={(v) => setLayer("dnsFlows", v)} />
      {layers.dnsFlows && (
        <p className="layer-status" role="status">
          {!live ? "实测查询只有最新结果；回到「实时」后显示。" :
           dns.status === "error" && !dns.snapshot ? "实测数据暂不可用，未显示；不会绘制虚构的查询。" :
           dns.snapshot ? count(dns.snapshot.flows.length) + " 次查询 · 匹配到实例 " + count(dns.snapshot.matched) + " / " + count(dns.snapshot.examined) :
           "正在读取 RIPE Atlas 测量结果…"}
        </p>
      )}
    </LayerGroup>
  );
}
