import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { InternetSelection } from "../internet/types";
import "./internet.css";

interface Props {
  selection: InternetSelection;
  onClose: () => void;
}

const count = (n: number) => n.toLocaleString("zh-CN");
// Open-data placeholders ("Unnamed OSM cable (osm-way-1)") read better in Chinese.
const named = (name: string, unnamed: string) => (name.startsWith("Unnamed OSM") ? unnamed : name);
const place = (city: string, country: string | null) => [city, country].filter(Boolean).join(" · ") || "—";

function rows(s: InternetSelection): { title: string; kind: string; items: Array<[string, string]>; link?: [string, string] } {
  switch (s.kind) {
    case "cable": return { title: named(s.cable.name, "未命名光缆段"), kind: "海底光缆", link: s.cable.url ? ["在 OpenStreetMap 查看", s.cable.url] : undefined, items: [
      ["投产年份", s.cable.rfsYear ? String(s.cable.rfsYear) : "—"],
      ["长度", s.cable.lengthKm ? count(s.cable.lengthKm) + " km" : "—"],
      ...(s.landings.length ? [["线路端点", s.landings.map((l) => l.name).join("、")]] as Array<[string, string]> : []),
      ["运营方", s.cable.owners.join("、") || "—"],
    ] };
    case "landing": return { title: s.landing.name, kind: "光缆端点（按线路推算）", items: [
      ["国家 / 地区", s.landing.country ?? "—"],
      ["接入光缆", s.cables.length ? s.cables.map((c) => c.name).join("、") : "—"],
    ] };
    case "ixp": return { title: s.ixp.name, kind: "互联网交换中心", link: s.ixp.website ? ["官方网站", s.ixp.website] : undefined, items: [
      ["城市", place(s.ixp.city, s.ixp.country)],
      ...(s.ixp.positionSource === "city" ? [["位置", "所在城市的坐标（推算），不是交换中心的实际地址"]] as Array<[string, string]> : []),
      ...(s.ixp.positionSource === null ? [["位置来源", "数据未说明，不能确定是否为城市推算"]] as Array<[string, string]> : []),
      ["接入网络", s.ixp.members !== null ? count(s.ixp.members) : "—"],
      ["端口总容量", s.ixp.portCapacityGbps !== null ? count(Math.round(s.ixp.portCapacityGbps)) + " Gbit/s" : "—"],
      ["所在设施", s.facilities.length ? s.facilities.map((f) => f.name).join("、") : "—"],
    ] };
    case "facility": return { title: named(s.facility.name, "未命名数据中心"), kind: "数据中心", items: [
      ["城市", place(s.facility.city, s.facility.country)],
      ["运营方", s.facility.operator ?? "—"],
      ["接入网络", count(s.facility.networkCount)],
      ["交换中心", s.ixps.length ? s.ixps.map((x) => x.name).join("、") : count(s.facility.ixCount)],
    ] };
    case "rootInstance": return { title: s.instance.letter.toUpperCase() + " 根 · " + (s.instance.city || "任播实例"), kind: "DNS 根服务器实例", items: [
      ...(s.server ? [["运营机构", s.server.operator], ["地址", [s.server.ipv4, s.server.ipv6].filter(Boolean).join(" / ")]] as Array<[string, string]> : []),
      ["位置", place(s.instance.city, s.instance.country)],
      ...(s.measured ? [
        ["实测查询", count(s.measured.queries) + " 次 · 来自 " + count(s.measured.probes) + " 个 RIPE Atlas 探针"],
        ["往返延迟", "中位数 " + s.measured.medianRttMs.toFixed(1) + " ms"],
      ] as Array<[string, string]> : []),
    ] };
  }
}

/** Accessible details for the selected infrastructure object. */
export function InternetCard({ selection, onClose }: Props) {
  const { title, kind, items, link } = rows(selection);
  // The globe isolates its stacking context; portal the card above overlapping mobile panels.
  return createPortal(
    <section className="internet-card glass-panel" aria-label={kind + " " + title}>
      <header>
        <div><span>{kind}</span><strong>{title}</strong>{selection.kind === "ixp" && <small className="internet-position-badge">{selection.ixp.positionSource === "city" ? "○ 推算位置" : selection.ixp.positionSource === "item" ? "● 条目坐标" : "位置来源未说明"}</small>}</div>
        <button type="button" onClick={onClose} aria-label="关闭"><X size={13} aria-hidden="true" /></button>
      </header>
      <dl>{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {link && <a className="internet-card-link" href={link[1]} target="_blank" rel="noopener noreferrer">{link[0]}</a>}
    </section>,
    document.querySelector<HTMLElement>(".workspace") ?? document.body,
  );
}
