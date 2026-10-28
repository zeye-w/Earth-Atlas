import { t } from "../i18n";
import { X } from "lucide-react";
import { PlaceSearch } from "../LocationSearch";
import type { SearchPlace } from "../placeSearch";

export function SearchPanel({ onClose, onSelect }: { onClose: () => void; onSelect: (place: SearchPlace) => void }) {
  return (
    <section id="place-search-panel" className="scene-tool-panel glass-panel" aria-label={t("地点搜索")}>
      <button className="tool-close" type="button" aria-label={t("关闭搜索")} onClick={onClose}><X size={16} /></button>
      <PlaceSearch onSelect={onSelect} />
    </section>
  );
}

export function SharePanel({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <section className="scene-tool-panel share-panel glass-panel" role="dialog" aria-label={t("分享当前场景")}>
      <button className="tool-close" type="button" aria-label={t("关闭分享")} onClick={onClose}><X size={16} /></button>
      <label htmlFor="scene-share-url">{t("分享当前场景")}</label>
      <input id="scene-share-url" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
      <p className="search-hint">{t("链接保存视角、图层和所选坐标。观测与预报数据会更新，不是历史快照。")}</p>
    </section>
  );
}
