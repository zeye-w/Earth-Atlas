import { X } from "lucide-react";
import type { InternetSelection } from "../internet/types";
import "./internet.css";

interface Props {
  selection: InternetSelection;
  onClose: () => void;
}

const count = (n: number) => n.toLocaleString("zh-CN");
const place = (city: string, country: string | null) => [city, country].filter(Boolean).join(" · ") || "—";

function rows(s: InternetSelection): { title: string; kind: string; items: Array<[string, string]> } {
  switch (s.kind) {
    case "cable": return { title: s.cable.name, kind: "海底光缆", items: [
      ["投产年份", s.cable.rfsYear ? String(s.cable.rfsYear) : "—"],
      ["长度", s.cable.lengthKm ? count(s.cable.lengthKm) + " km" : "—"],
      ...(s.landings.length ? [["线路端点", s.landings.map((l) => l.name).join("、")]] as Array<[string, string]> : []),
      ["运营方", s.cable.owners.join("、") || "—"],
    ] };
    case "landing": return { title: s.landing.name, kind: "光缆端点（按线路推算，非核实的登陆站）", items: [
      ["国家 / 地区", s.landing.country ?? "—"],
      ["接入光缆", s.cables.length ? s.cables.map((c) => c.name).join("、") : "—"],
    ] };
    case "ixp": return { title: s.ixp.name, kind: "互联网交换中心", items: [
      ["城市", place(s.ixp.city, s.ixp.country)],
      ...(s.ixp.positionSource === "city" ? [["位置", "所在城市的坐标（推算），不是交换中心的实际地址"]] as Array<[string, string]> : []),
      ["接入网络", s.ixp.members !== null ? count(s.ixp.members) : "—"],
      ["端口总容量", s.ixp.portCapacityGbps !== null ? count(Math.round(s.ixp.portCapacityGbps)) + " Gbit/s" : "—"],
      ["所在设施", s.facilities.length ? s.facilities.map((f) => f.name).join("、") : "—"],
    ] };
    case "facility": return { title: s.facility.name, kind: "数据中心 / 互联设施", items: [
      ["城市", place(s.facility.city, s.facility.country)],
      ["运营方", s.facility.operator ?? "—"],
      ["接入网络", count(s.facility.networkCount)],
      ["交换中心", s.ixps.length ? s.ixps.map((x) => x.name).join("、") : count(s.facility.ixCount)],
    ] };
    case "rootInstance": return { title: s.instance.letter.toUpperCase() + " 根 · " + (s.instance.city || "实例"), kind: "DNS 根服务器实例", items: [
      ["运营机构", s.server?.operator ?? "—"],
      ["地址", s.server ? [s.server.ipv4, s.server.ipv6].filter(Boolean).join(" / ") : "—"],
      ["位置", place(s.instance.city, s.instance.country)],
      ["广播范围", s.instance.scope === "global" ? "全球" : s.instance.scope === "local" ? "本地" : "—"],
    ] };
  }
}

/** Details of a picked cable, landing, exchange, facility or root instance (track D polishes this). */
export function InternetCard({ selection, onClose }: Props) {
  const { title, kind, items } = rows(selection);
  return (
    <section className="internet-card glass-panel" aria-label={kind + " " + title}>
      <header>
        <div><span>{kind}</span><strong>{title}</strong></div>
        <button type="button" onClick={onClose} aria-label="关闭"><X size={13} aria-hidden="true" /></button>
      </header>
      <dl>{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}
