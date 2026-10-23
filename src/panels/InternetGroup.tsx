import { Activity, Building2, Cable, Network, Server } from "lucide-react";
import type { LayerToggles } from "../hooks/useLayerSettings";
import type { DatasetStatus, InternetState } from "../layers/useInternet";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  internet: InternetState;
  live: boolean;
}

const count = (n: number) => n.toLocaleString("zh-CN");

function status(s: DatasetStatus, ready: string): string {
  return s === "loading" ? "正在读取…" : s === "error" ? "数据暂不可用，未显示。" : s === "ready" ? ready : "";
}

/**
 * Internet infrastructure (docs/internet-layers.md). First cut: toggles and
 * status lines; track D adds the legend, sources and "measured / estimated /
 * illustrative" labels.
 */
export function InternetGroup({ layers, setLayer, internet, live }: Props) {
  const { data, datasets, dns } = internet;
  return (
    <LayerGroup title="INTERNET" subtitle="互联网基础设施">
      <ToggleRow icon={<Cable {...ICON} />} title="海底光缆" caption="光缆走向与登陆站 · TeleGeography" checked={layers.cables} onChange={(v) => setLayer("cables", v)} />
      {layers.cables && <p className="layer-status" role="status">{status(datasets.cables, count(data.cables?.cables.length ?? 0) + " 条光缆 · " + count(data.cables?.landings.length ?? 0) + " 个登陆站")}</p>}
      <ToggleRow icon={<Network {...ICON} />} title="互联网交换中心" caption="IXP · PeeringDB" checked={layers.ixps} onChange={(v) => setLayer("ixps", v)} />
      {layers.ixps && <p className="layer-status" role="status">{status(datasets.ixps, count(data.ixps?.ixps.length ?? 0) + " 个交换中心")}</p>}
      <ToggleRow icon={<Building2 {...ICON} />} title="数据中心" caption="互联设施 · PeeringDB" checked={layers.dataCenters} onChange={(v) => setLayer("dataCenters", v)} />
      {layers.dataCenters && <p className="layer-status" role="status">{status(datasets.facilities, count(data.facilities?.facilities.length ?? 0) + " 个设施")}</p>}
      <ToggleRow icon={<Server {...ICON} />} title="DNS 根服务器" caption="13 个根 · 全球任播实例 · root-servers.org" checked={layers.rootServers} onChange={(v) => setLayer("rootServers", v)} />
      {layers.rootServers && <p className="layer-status" role="status">{status(datasets.rootServers, count(data.rootServers?.instances.length ?? 0) + " 个实例")}</p>}
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
