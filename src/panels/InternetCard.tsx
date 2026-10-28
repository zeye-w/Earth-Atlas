import { t, localeTag } from "../i18n";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { InternetSelection } from "../internet/types";
import "./internet.css";

interface Props {
  selection: InternetSelection;
  onClose: () => void;
}

const count = (n: number) => n.toLocaleString(localeTag());
// Open-data placeholders ("Unnamed OSM cable (osm-way-1)") read better in Chinese.
const named = (name: string, unnamed: string) => (name.startsWith("Unnamed OSM") ? unnamed : name);
const place = (city: string, country: string | null) => [city, country].filter(Boolean).join(" · ") || "—";

function rows(s: InternetSelection): { title: string; kind: string; items: Array<[string, string]>; link?: [string, string] } {
  switch (s.kind) {
    case "cable": return { title: named(s.cable.name, t("未命名光缆段")), kind: "海底光缆", link: s.cable.url ? [t("在 OpenStreetMap 查看"), s.cable.url] : undefined, items: [
      [t("投产年份"), s.cable.rfsYear ? String(s.cable.rfsYear) : "—"],
      [t("长度"), s.cable.lengthKm ? count(s.cable.lengthKm) + " km" : "—"],
      ...(s.landings.length ? [[t("线路端点"), s.landings.map((l) => l.name).join("、")]] as Array<[string, string]> : []),
      [t("运营方"), s.cable.owners.join("、") || "—"],
    ] };
    case "landing": return { title: s.landing.name, kind: "光缆端点（按线路推算）", items: [
      [t("国家 / 地区"), s.landing.country ?? "—"],
      [t("接入光缆"), s.cables.length ? s.cables.map((c) => c.name).join("、") : "—"],
    ] };
    case "ixp": return { title: s.ixp.name, kind: "互联网交换中心", link: s.ixp.website ? [t("官方网站"), s.ixp.website] : undefined, items: [
      [t("城市"), place(s.ixp.city, s.ixp.country)],
      ...(s.ixp.positionSource === "city" ? [[t("位置"), t("所在城市的坐标（推算），不是交换中心的实际地址")]] as Array<[string, string]> : []),
      ...(s.ixp.positionSource === null ? [[t("位置来源"), t("数据未说明，不能确定是否为城市推算")]] as Array<[string, string]> : []),
      [t("接入网络"), s.ixp.members !== null ? count(s.ixp.members) : "—"],
      [t("端口总容量"), s.ixp.portCapacityGbps !== null ? count(Math.round(s.ixp.portCapacityGbps)) + " Gbit/s" : "—"],
      [t("所在设施"), s.facilities.length ? s.facilities.map((f) => f.name).join("、") : "—"],
    ] };
    case "facility": return { title: named(s.facility.name, t("未命名数据中心")), kind: "数据中心", items: [
      [t("城市"), place(s.facility.city, s.facility.country)],
      [t("运营方"), s.facility.operator ?? "—"],
      [t("接入网络"), count(s.facility.networkCount)],
      [t("交换中心"), s.ixps.length ? s.ixps.map((x) => x.name).join("、") : count(s.facility.ixCount)],
    ] };
    case "rootInstance": return { title: s.instance.letter.toUpperCase() + t(" 根 · ") + (s.instance.city || "任播实例"), kind: "DNS 根服务器实例", items: [
      ...(s.server ? [[t("运营机构"), s.server.operator], [t("地址"), [s.server.ipv4, s.server.ipv6].filter(Boolean).join(" / ")]] as Array<[string, string]> : []),
      [t("位置"), place(s.instance.city, s.instance.country)],
      ...(s.measured ? [
        [t("实测查询"), count(s.measured.queries) + t(" 次 · 来自 ") + count(s.measured.probes) + t(" 个 RIPE Atlas 探针")],
        [t("往返延迟"), t("中位数 ") + s.measured.medianRttMs.toFixed(1) + " ms"],
      ] as Array<[string, string]> : []),
    ] };
  }
}

/** Accessible details for the selected infrastructure object. */
export function InternetCard({ selection, onClose }: Props) {
  const { title, kind, items, link } = rows(selection);
  // The globe isolates its stacking context; portal the card above overlapping mobile panels.
  return createPortal(
    <section className="internet-card glass-panel" aria-label={t(kind + " " + title)}>
      <header>
        <div><span>{t(kind)}</span><strong>{t(title)}</strong>{selection.kind === "ixp" && <small className="internet-position-badge">{t(selection.ixp.positionSource === "city" ? "○ 推算位置" : selection.ixp.positionSource === "item" ? "● 条目坐标" : "位置来源未说明")}</small>}</div>
        <button type="button" onClick={onClose} aria-label={t("关闭")}><X size={13} aria-hidden="true" /></button>
      </header>
      <dl>{items.map(([k, v]) => <div key={k}><dt>{t(k)}</dt><dd>{t(v)}</dd></div>)}</dl>
      {link && <a className="internet-card-link" href={link[1]} target="_blank" rel="noopener noreferrer">{t(link[0])}</a>}
    </section>,
    document.querySelector<HTMLElement>(".workspace") ?? document.body,
  );
}
