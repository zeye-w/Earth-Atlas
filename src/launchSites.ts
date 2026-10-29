/**
 * Well-known orbital launch pads, for the virtual launch and the space show.
 * Bundled so they work without the launch calendar feed. Coordinates are the
 * pads' published positions to about 100 m; labels are Chinese source strings
 * translated through the English catalog.
 */
export interface LaunchSite {
  id: string;
  label: string;
  /** Pad name as used by the operator. */
  pad: string;
  latitude: number;
  longitude: number;
}

export const LAUNCH_SITES: readonly LaunchSite[] = [
  { id: "wenchang", label: "文昌", pad: "LC-101", latitude: 19.6145, longitude: 110.951 },
  { id: "jiuquan", label: "酒泉", pad: "LC-43/91", latitude: 40.958, longitude: 100.291 },
  { id: "xichang", label: "西昌", pad: "LC-2", latitude: 28.2457, longitude: 102.0268 },
  { id: "taiyuan", label: "太原", pad: "LC-9", latitude: 38.8634, longitude: 111.6085 },
  { id: "ksc", label: "肯尼迪航天中心", pad: "LC-39A", latitude: 28.6083, longitude: -80.6041 },
  { id: "ccsfs", label: "卡纳维拉尔角", pad: "SLC-40", latitude: 28.5619, longitude: -80.5774 },
  { id: "vandenberg", label: "范登堡", pad: "SLC-4E", latitude: 34.6321, longitude: -120.6106 },
  { id: "starbase", label: "星舰基地", pad: "OLP-1", latitude: 25.9969, longitude: -97.1546 },
  { id: "baikonur", label: "拜科努尔", pad: "Site 31/6", latitude: 45.996, longitude: 63.5643 },
  { id: "vostochny", label: "东方航天发射场", pad: "Site 1S", latitude: 51.8844, longitude: 128.3337 },
  { id: "kourou", label: "库鲁", pad: "ELA-4", latitude: 5.2617, longitude: -52.7867 },
  { id: "tanegashima", label: "种子岛", pad: "LA-Y1", latitude: 30.4009, longitude: 130.9749 },
  { id: "sriharikota", label: "斯里哈里科塔", pad: "SLP", latitude: 13.7199, longitude: 80.2304 },
  { id: "mahia", label: "马希亚半岛", pad: "LC-1A", latitude: -39.2615, longitude: 177.8649 },
];

export const launchSite = (id: string) => LAUNCH_SITES.find((site) => site.id === id) ?? null;
