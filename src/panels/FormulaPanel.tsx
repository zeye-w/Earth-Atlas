import { t } from "../i18n";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Sigma, X } from "lucide-react";
import type { Derivation, Observer } from "../satelliteTelemetry";
import "./FormulaPanel.css";

const REFRESH_MS = 250;
// The highlight walks down the steps, one every two refreshes.
const SCAN_TICKS = 2;
const EARTH_RADIUS_KM = 6371;
const TRAIL = 48;

interface Props {
  title: string;
  derivation: (observer: Observer | null) => Derivation | null;
  observer: Observer | null;
  live: boolean;
  onLocate: () => void;
  onClose: () => void;
}

const tex = (source: string) => katex.renderToString(source, { throwOnError: false, strict: false, output: "html" });
const f = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : "\\text{—}");
// Negative values in parentheses where they are squared or substituted.
const p = (v: number, digits = 2) => (v < 0 ? "(" + f(v, digits) + ")" : f(v, digits));
const vec = (v: { x: number; y: number; z: number }, digits = 1) => "(" + [v.x, v.y, v.z].map((c) => f(c, digits)).join(",\\ ") + ")";
const deg = (radians: number) => (radians * 180) / Math.PI;

/** A formula rendered once (it never changes). */
function Static({ source }: { source: string }) {
  const localized = t(source);
  const html = useMemo(() => tex(localized), [localized]);
  return <div className="formula-tex" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Substituted numbers: re-rendered every refresh; the result flashes when it changes. */
function Live({ source, result }: { source: string; result?: string }) {
  return (
    <div className="formula-live">
      <span dangerouslySetInnerHTML={{ __html: tex(t(source)) }} />
      {result !== undefined && <span key={result} className="formula-result" dangerouslySetInnerHTML={{ __html: tex(t(result)) }} />}
    </div>
  );
}

interface Step { id: string; title: string; note: string; formula: string; body: (d: Derivation) => ReactNode }

const STEPS: Step[] = [
  {
    id: "sgp4", title: "SGP4 轨道推算", note: "CelesTrak 轨道根数 → 惯性系位置与速度（satellite.js）",
    formula: "\\vec r,\\ \\vec v = \\mathrm{SGP4}\\left(\\text{GP},\\ t\\right)",
    body: (d) => <>
      <Live source={"\\vec r = " + vec(d.eci) + "\\ \\text{km}"} />
      <Live source={"\\vec v = " + vec(d.velocity, 3) + "\\ \\text{km/s}"} />
    </>,
  },
  {
    id: "ecef", title: "惯性系 → 地固系", note: "绕地轴转过格林尼治恒星时 θ，再按 WGS84 椭球求经纬高",
    formula: "\\vec r' = \\begin{pmatrix}\\cos\\theta&\\sin\\theta&0\\\\-\\sin\\theta&\\cos\\theta&0\\\\0&0&1\\end{pmatrix}\\vec r",
    body: (d) => <>
      <Live source={"\\theta_{\\mathrm{GMST}} = " + f(deg(d.gmst), 3) + "^\\circ"} result={"\\vec r' = " + vec(d.ecf) + "\\ \\text{km}"} />
      <Live source={"(\\varphi,\\ \\lambda,\\ h)"} result={"(" + f(d.geodetic.latitude, 3) + "^\\circ,\\ " + f(d.geodetic.longitude, 3) + "^\\circ,\\ " + f(d.geodetic.altitudeKm, 1) + "\\ \\text{km})"} />
    </>,
  },
  {
    id: "speed", title: "速度", note: "惯性速度的大小",
    formula: "|\\vec v| = \\sqrt{v_x^2+v_y^2+v_z^2}",
    body: (d) => <Live source={"\\sqrt{" + p(d.velocity.x, 3) + "^2+" + p(d.velocity.y, 3) + "^2+" + p(d.velocity.z, 3) + "^2}"} result={"= \\mathbf{" + f(d.speedKmS, 3) + "}\\ \\text{km/s}"} />,
  },
  {
    id: "period", title: "轨道周期", note: "平均运动 n 来自轨道根数",
    formula: "T = \\dfrac{2\\pi}{n}",
    body: (d) => <Live source={"\\dfrac{2\\pi}{" + f(d.meanMotion, 5) + "\\ \\text{rad/min}}"} result={"= \\mathbf{" + f(d.periodMin, 2) + "}\\ \\text{min}"} />,
  },
  {
    id: "heading", title: "航向", note: "当前星下点到 10 秒后星下点的大圆方位角",
    formula: "\\theta = \\operatorname{atan2}\\!\\left(\\sin\\Delta\\lambda\\cos\\varphi_2,\\ \\cos\\varphi_1\\sin\\varphi_2-\\sin\\varphi_1\\cos\\varphi_2\\cos\\Delta\\lambda\\right)",
    body: (d) => <Live source={"\\varphi_1 = " + f(d.heading.lat1, 3) + "^\\circ,\\ \\varphi_2 = " + f(d.heading.lat2, 3) + "^\\circ,\\ \\Delta\\lambda = " + f(d.heading.lon2 - d.heading.lon1, 4) + "^\\circ"} result={"\\theta = \\mathbf{" + f(d.heading.deg, 1) + "^\\circ}"} />,
  },
  {
    id: "shadow", title: "日照 / 地影", note: "把地影当作圆柱：在太阳背面且离轴不到一个地球半径就在影子里",
    formula: "a = \\vec r'\\cdot\\hat s,\\quad d_\\perp = \\lVert \\vec r' - a\\,\\hat s\\rVert,\\quad \\text{日照} \\iff a>0 \\ \\lor\\ d_\\perp > R_\\oplus",
    body: (d) => <Live source={"a = " + f(d.shadow.along, 0) + "\\ \\text{km},\\ d_\\perp = " + f(d.shadow.offAxis, 0) + "\\ \\text{km}\\ " + (d.shadow.offAxis > EARTH_RADIUS_KM ? ">" : "<") + "\\ " + EARTH_RADIUS_KM}
      result={d.shadow.sunlit ? t("\\Rightarrow \\textbf{日照中}") : t("\\Rightarrow \\textbf{地影中}")} />,
  },
  {
    id: "look", title: "从我的位置看", note: "卫星相对观测点的向量转到当地东–北–天坐标",
    formula: "A = \\operatorname{atan2}(e,\\ n),\\qquad E = \\arcsin\\dfrac{u}{\\rho}",
    body: (d) => d.look && <>
      <Live source={"(e,\\ n,\\ u) = (" + f(d.look.east, 0) + ",\\ " + f(d.look.north, 0) + ",\\ " + f(d.look.up, 0) + ")\\ \\text{km},\\ \\rho = " + f(d.look.rangeKm, 0)} />
      <Live source="" result={"A = \\mathbf{" + f(d.look.azimuth, 1) + "^\\circ},\\quad E = \\mathbf{" + f(d.look.elevation, 1) + "^\\circ}"} />
    </>,
  },
];

/** The shadow test drawn in the plane of the Sun direction and the satellite. */
function ShadowDiagram({ d, trail }: { d: Derivation; trail: Array<[number, number]> }) {
  const W = 300, H = 132, cx = 150, cy = 80, k = 34 / EARTH_RADIUS_KM;
  const point = ([along, off]: [number, number]) => [cx + along * k, cy - off * k] as const;
  const [sx, sy] = point([d.shadow.along, d.shadow.offAxis]);
  const R = EARTH_RADIUS_KM * k;
  return (
    <svg className="formula-diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("地影圆柱示意")}>
      <defs>
        <linearGradient id="fp-shadow" x1="1" x2="0"><stop offset="0" stopColor="#0d1424" stopOpacity=".95" /><stop offset="1" stopColor="#0d1424" stopOpacity="0" /></linearGradient>
        <radialGradient id="fp-earth" cx=".7" cy=".4"><stop offset="0" stopColor="#4ea3ff" /><stop offset="1" stopColor="#123058" /></radialGradient>
      </defs>
      <rect x={0} y={cy - R} width={cx} height={2 * R} fill="url(#fp-shadow)" />
      <line x1={0} y1={cy} x2={W} y2={cy} className="fp-axis" />
      <circle cx={cx} cy={cy} r={R} fill="url(#fp-earth)" />
      <g className="fp-sun"><line x1={W - 8} y1={cy - 20} x2={W - 40} y2={cy - 20} /><polygon points={`${W - 44},${cy - 20} ${W - 36},${cy - 24} ${W - 36},${cy - 16}`} /><text x={W - 8} y={cy - 28} textAnchor="end">{t("ŝ 太阳方向")}</text></g>
      <polyline className="fp-trail" points={trail.map((t) => point(t).join(",")).join(" ")} />
      <line x1={sx} y1={sy} x2={sx} y2={cy} className="fp-guide" />
      <line x1={cx} y1={cy + 2} x2={sx} y2={cy + 2} className="fp-guide fp-a" />
      <text x={sx + 5} y={(sy + cy) / 2} className="fp-label">d⊥</text>
      <text x={(cx + sx) / 2} y={cy + 13} className="fp-label" textAnchor="middle">a</text>
      <circle cx={sx} cy={sy} r={4.5} className={d.shadow.sunlit ? "fp-sat sunlit" : "fp-sat"} />
      <text x={6} y={cy - R - 5} className="fp-label">{t("地影圆柱（半径 R⊕）")}</text>
    </svg>
  );
}

/**
 * The working behind the tracking card, live: each formula, then the same
 * formula with this moment's numbers, refreshed four times a second.
 */
export default function FormulaPanel({ title, derivation, observer, live, onLocate, onClose }: Props) {
  const [d, setD] = useState<Derivation | null>(() => derivation(observer));
  const [tick, setTick] = useState(0);
  const trail = useRef<Array<[number, number]>>([]);

  useEffect(() => {
    const update = () => {
      const next = derivation(observer);
      if (next) {
        trail.current.push([next.shadow.along, next.shadow.offAxis]);
        if (trail.current.length > TRAIL) trail.current.shift();
      }
      setD(next);
      setTick((t) => t + 1);
    };
    const timer = window.setInterval(update, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [derivation, observer]);

  const steps = STEPS.filter((s) => s.id !== "look" || d?.look);
  const active = Math.floor(tick / SCAN_TICKS) % (steps.length + 1);

  return (
    <section className="formula-panel glass-panel" aria-label={t(title + " 的实时计算")}>
      <header>
        <Sigma size={15} strokeWidth={1.8} aria-hidden="true" />
        <div>
          <strong>{t("实时计算 ·{0}", t(title))}</strong>
          <span>{t(d ? d.time.toISOString().slice(0, 19).replace("T", " ") + " UTC" + (live ? "" : " · 时间轴") : "—")}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("关闭实时计算")}><X size={13} aria-hidden="true" /></button>
      </header>
      <div className="formula-pipeline" aria-hidden="true">
        {[t("轨道根数"), "SGP4", t("惯性系"), t("地固系"), t("读数")].map((label, i) => <span key={label} style={{ animationDelay: i * 0.18 + "s" }}>{t(label)}</span>)}
      </div>
      {!d ? <p className="formula-empty">{t("这一时刻离轨道根数历元太远，没有可靠的位置。")}</p> : (
        <ol className="formula-steps">
          {steps.map((step, i) => (
            <li key={step.id} className={i === active ? "is-active" : undefined}>
              <div className="formula-step-head"><span className="formula-index">{i + 1}</span><strong>{t(step.title)}</strong><em>{t(step.note)}</em></div>
              <Static source={step.formula} />
              {step.body(d)}
              {step.id === "shadow" && <ShadowDiagram d={d} trail={trail.current} />}
            </li>
          ))}
          {!d.look && <li className="formula-locate"><button type="button" onClick={onLocate}>{t("加上我的位置：算方位角和仰角")}</button></li>}
        </ol>
      )}
      <p className="formula-note">{t("每秒刷新 4 次，数值即时代入。位置来自轨道根数 + SGP4 推算，不是实时遥测；姿态不在计算之列。")}</p>
    </section>
  );
}
