import { Plane } from "lucide-react";
import { BAND_COLORS } from "../flightOverlay";
import type { FlightState } from "../layers/useFlights";
import type { LayerToggles } from "../hooks/useLayerSettings";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";

const SOURCES = { "adsb.lol": "adsb.lol（ODbL）", opensky: "OpenSky Network" } as const;

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  flights: FlightState;
  live: boolean;
}

export function FlightsGroup({ layers, setLayer, flights, live }: Props) {
  return (
    <LayerGroup title="AVIATION" subtitle="实时航班">
      <ToggleRow icon={<Plane {...ICON} />} title="实时航班" caption="ADS-B 广播位置 · adsb.lol 志愿者接收网 · 每分钟更新" checked={layers.flights} onChange={(v) => setLayer("flights", v)} />
      {layers.flights && (
        <div className="layer-extra">
          <p className="layer-status" role="status">
            {!live ? "航班数据只有实时位置，没有历史记录；回到「实时」后显示。" :
             flights.status === "loading" ? "正在读取全球航班位置…" :
             flights.status === "error" ? "航班数据暂不可用，未显示；不会绘制虚构航班。" :
             flights.status === "ready" ? flights.total.toLocaleString("zh-CN") + " 架航空器 · 空中 " + flights.airborne.toLocaleString("zh-CN") + " 架 · 数据时间 " + (flights.time ? new Date(flights.time).toISOString().slice(11, 19) : "—") + " UTC" : ""}
          </p>
          {live && flights.status === "ready" && (
            <>
              <div className="thematic-legend">
                <span><i style={{ background: BAND_COLORS.high }} />9,000 m 以上</span>
                <span><i style={{ background: BAND_COLORS.mid }} />3,000–9,000 m</span>
                <span><i style={{ background: BAND_COLORS.low }} />3,000 m 以下</span>
                <span><i style={{ background: BAND_COLORS.ground }} />地面</span>
              </div>
              <p className="layer-note">来源：{flights.source ? SOURCES[flights.source] : "—"}。只包含被志愿者接收站收到的航空器，海洋上空和部分国家覆盖很少，并不是全部航班。两次更新之间按航速和航向推算位置。点击飞机查看航班号、机型、高度和速度。</p>
            </>
          )}
        </div>
      )}
    </LayerGroup>
  );
}
