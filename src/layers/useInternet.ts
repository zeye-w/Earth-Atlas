import { useEffect, useMemo, useRef, useState } from "react";
import type { Viewer } from "cesium";
import { DNS_FLOWS_REFRESH_MS, fetchDnsFlows, loadInternetDataset, type InternetDatasets } from "../internet/data";
import { InternetOverlay } from "../internet/internetOverlay";
import { INTERNET_ID_PREFIX, type DnsFlowSnapshot, type InternetDatasetKey, type InternetSelection } from "../internet/types";
import { usePolledData, type PollStatus } from "../hooks/usePolledData";
import { onClockChange } from "../clock";

export interface InternetToggles {
  cables: boolean;
  ixps: boolean;
  dataCenters: boolean;
  rootServers: boolean;
  dnsFlows: boolean;
}

type Loaded = { [K in InternetDatasetKey]?: InternetDatasets[K] };
export type DatasetStatus = "idle" | "loading" | "ready" | "error";

export interface InternetState {
  datasets: Record<InternetDatasetKey, DatasetStatus>;
  data: Loaded;
  dns: { status: PollStatus; snapshot: DnsFlowSnapshot | null };
  /** Cables shown up to this ready-for-service year; null shows all, planned included. */
  cableYear: number | null;
  /** Earliest and latest ready-for-service years in the cable data. */
  cableYears: [number, number] | null;
}

const DATASET_FOR: Record<keyof Omit<InternetToggles, "dnsFlows">, InternetDatasetKey> = {
  cables: "cables", ixps: "ixps", dataCenters: "facilities", rootServers: "rootServers",
};

/**
 * Submarine cables, exchanges, data centres, DNS root instances and measured
 * DNS queries. Static datasets load the first time their layer is shown and
 * stay; the DNS flows are live (RIPE Atlas via the Worker) and only run while
 * the timeline is live.
 */
export function useInternet(viewer: Viewer | null, toggles: InternetToggles, live: boolean) {
  const overlayRef = useRef<InternetOverlay | null>(null);
  const [data, setData] = useState<Loaded>({});
  const [status, setStatus] = useState<Record<InternetDatasetKey, DatasetStatus>>({ cables: "idle", ixps: "idle", facilities: "idle", rootServers: "idle" });
  const dns = usePolledData(fetchDnsFlows, { enabled: toggles.dnsFlows && live, intervalMs: DNS_FLOWS_REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });

  useEffect(() => {
    if (!viewer) return;
    const overlay = new InternetOverlay(viewer);
    overlayRef.current = overlay;
    // Recording mode moves the clock frame by frame: follow at once.
    const offClock = onClockChange(() => overlay.advance());
    return () => { offClock(); overlay.dispose(); overlayRef.current = null; };
  }, [viewer]);

  const [cableYear, setCableYear] = useState<number | null>(null);
  useEffect(() => { overlayRef.current?.setCableYear(cableYear); }, [cableYear, viewer]);

  // Load each dataset the first time a layer needs it.
  const wanted = (Object.keys(DATASET_FOR) as Array<keyof typeof DATASET_FOR>).filter((k) => toggles[k]).map((k) => DATASET_FOR[k]);
  if (toggles.dnsFlows) wanted.push("rootServers");
  const wantedKey = [...new Set(wanted)].sort().join(",");
  useEffect(() => {
    const controller = new AbortController();
    for (const key of wantedKey ? (wantedKey.split(",") as InternetDatasetKey[]) : []) {
      if (status[key] !== "idle" && status[key] !== "error") continue;
      setStatus((s) => ({ ...s, [key]: "loading" }));
      loadInternetDataset(key, controller.signal).then((dataset) => {
        setData((d) => ({ ...d, [key]: dataset }));
        setStatus((s) => ({ ...s, [key]: "ready" }));
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("Internet dataset " + key + " unavailable", error);
        setStatus((s) => ({ ...s, [key]: "error" }));
      });
    }
    return () => controller.abort();
    // status is only read for its current value; wantedKey drives loading.
  }, [wantedKey]);

  useEffect(() => { if (data.cables) overlayRef.current?.setCables(data.cables); }, [data.cables, viewer]);
  useEffect(() => { if (data.ixps) overlayRef.current?.setIxps(data.ixps); }, [data.ixps, viewer]);
  useEffect(() => { if (data.facilities) overlayRef.current?.setFacilities(data.facilities); }, [data.facilities, viewer]);
  useEffect(() => { if (data.rootServers) overlayRef.current?.setRootServers(data.rootServers); }, [data.rootServers, viewer]);
  useEffect(() => { overlayRef.current?.setDnsFlows(dns.data?.flows ?? []); }, [dns.data, viewer]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.setVisible("cables", toggles.cables);
    overlay.setVisible("landings", toggles.cables);
    overlay.setVisible("ixps", toggles.ixps);
    overlay.setVisible("facilities", toggles.dataCenters);
    overlay.setVisible("rootServers", toggles.rootServers || toggles.dnsFlows);
    overlay.setVisible("dnsFlows", toggles.dnsFlows && live);
  }, [toggles.cables, toggles.ixps, toggles.dataCenters, toggles.rootServers, toggles.dnsFlows, live, viewer]);

  /** What a picked primitive id refers to, with its related items; null if not ours. */
  const select = (pickedId: unknown): InternetSelection | null => {
    if (typeof pickedId !== "string" || !pickedId.startsWith("internet:")) return null;
    const { cables, ixps, facilities, rootServers } = data;
    const id = (prefix: string) => (pickedId.startsWith(prefix) ? pickedId.slice(prefix.length) : null);
    const cableId = id(INTERNET_ID_PREFIX.cable), landingId = id(INTERNET_ID_PREFIX.landing);
    const ixpId = id(INTERNET_ID_PREFIX.ixp), facilityId = id(INTERNET_ID_PREFIX.facility), rootId = id(INTERNET_ID_PREFIX.rootInstance);
    if (cableId && cables) {
      const cable = cables.cables.find((c) => c.id === cableId);
      if (cable) return { kind: "cable", cable, landings: cables.landings.filter((l) => cable.landingIds.includes(l.id)) };
    }
    if (landingId && cables) {
      const landing = cables.landings.find((l) => l.id === landingId);
      if (landing) return { kind: "landing", landing, cables: cables.cables.filter((c) => c.landingIds.includes(landing.id)) };
    }
    if (ixpId && ixps) {
      const ixp = ixps.ixps.find((x) => String(x.id) === ixpId);
      if (ixp) return { kind: "ixp", ixp, facilities: facilities?.facilities.filter((f) => ixp.facilityIds.includes(f.id)) ?? [] };
    }
    if (facilityId && facilities) {
      const facility = facilities.facilities.find((f) => String(f.id) === facilityId);
      if (facility) return { kind: "facility", facility, ixps: ixps?.ixps.filter((x) => x.facilityIds.includes(facility.id)) ?? [] };
    }
    if (rootId && rootServers) {
      const instance = rootServers.instances.find((r) => r.id === rootId);
      if (instance) return { kind: "rootInstance", instance, server: rootServers.servers.find((s) => s.letter === instance.letter) ?? null };
    }
    return null;
  };

  const cableYears = useMemo<[number, number] | null>(() => {
    const years = (data.cables?.cables ?? []).map((c) => c.rfsYear).filter((y): y is number => y !== null);
    return years.length ? [Math.min(...years), Math.max(...years)] : null;
  }, [data.cables]);
  const state = useMemo<InternetState>(() => ({ datasets: status, data, dns: { status: dns.status, snapshot: dns.data }, cableYear, cableYears }), [status, data, dns.status, dns.data, cableYear, cableYears]);
  return { state, select, setCableYear };
}
