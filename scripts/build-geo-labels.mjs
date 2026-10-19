/**
 * Build src/data/geoLabels.json: label points for oceans, seas, straits and
 * mountain ranges, deserts, plains, basins and rivers. Positions come from Natural Earth 1:10m geography polygons
 * (public domain); each label sits at the polygon's pole of inaccessibility
 * so it lands inside the feature. Natural Earth's Chinese names mix
 * simplified/traditional forms and contain some errors, so the names below
 * are curated (standard simplified Chinese geographic names).
 *
 * Usage: node scripts/build-geo-labels.mjs [dir-with-geojson]
 * Without a directory the three GeoJSON files are fetched from GitHub.
 */
import { readFileSync, writeFileSync } from "node:fs";

const NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
const MARINE = "ne_10m_geography_marine_polys.geojson";
const RIVERS_FILE = "ne_10m_rivers_lake_centerlines.geojson";
const REGIONS = "ne_10m_geography_regions_polys.geojson";

// kind: ocean | sea | strait | range | desert | plain | basin | river. tier 1 shows from far away, tier 2 closer.
// [natural earth name, chinese, tier] or [english, chinese, tier, longitude,
// latitude] placed by hand: where Natural Earth has no polygon, or where the
// pole of inaccessibility of a long or irregular feature lands at one end.
const OCEANS = [
  ["Pacific Ocean", "太平洋", 1, -150, 12],
  ["Pacific Ocean", "太平洋", 1, -125, -28],
  ["Pacific Ocean", "太平洋", 1, 165, 22],
  ["Atlantic Ocean", "大西洋", 1, -40, 28],
  ["Atlantic Ocean", "大西洋", 1, -18, -28],
  ["Indian Ocean", "印度洋", 1, 80, -22],
  ["Arctic Ocean", "北冰洋", 1, -160, 84],
  ["Southern Ocean", "南大洋", 1, 60, -58],
  ["Southern Ocean", "南大洋", 1, -110, -64],
];
const SEAS = [
  ["South China Sea", "南海", 1], ["East China Sea", "东海", 2], ["Yellow Sea", "黄海", 2], ["Bo Hai", "渤海", 2],
  ["Sea of Japan", "日本海", 1], ["Philippine Sea", "菲律宾海", 1], ["Sea of Okhotsk", "鄂霍次克海", 1],
  ["Bering Sea", "白令海", 1], ["Arabian Sea", "阿拉伯海", 1], ["Bay of Bengal", "孟加拉湾", 1],
  ["Mediterranean Sea", "地中海", 1, 18, 35], ["Black Sea", "黑海", 1], ["Caspian Sea", "里海", 1], ["Red Sea", "红海", 1],
  ["Persian Gulf", "波斯湾", 1], ["Caribbean Sea", "加勒比海", 1], ["Gulf of Mexico", "墨西哥湾", 1],
  ["Hudson Bay", "哈得孙湾", 1], ["Coral Sea", "珊瑚海", 1], ["Tasman Sea", "塔斯曼海", 1],
  ["Gulf of Alaska", "阿拉斯加湾", 1], ["Weddell Sea", "威德尔海", 1], ["Ross Sea", "罗斯海", 1],
  ["Labrador Sea", "拉布拉多海", 1], ["Beaufort Sea", "波弗特海", 1], ["Baffin Bay", "巴芬湾", 1],
  ["North Sea", "北海", 2], ["Baltic Sea", "波罗的海", 2], ["Norwegian Sea", "挪威海", 2], ["Barents Sea", "巴伦支海", 2],
  ["Greenland Sea", "格陵兰海", 2], ["Kara Sea", "喀拉海", 2], ["Laptev Sea", "拉普捷夫海", 2],
  ["East Siberian Sea", "东西伯利亚海", 2], ["Chukchi Sea", "楚科奇海", 2], ["Gulf of Guinea", "几内亚湾", 2],
  ["Arafura Sea", "阿拉弗拉海", 2], ["Timor Sea", "帝汶海", 2], ["Java Sea", "爪哇海", 2], ["Banda Sea", "班达海", 2],
  ["Celebes Sea", "苏拉威西海", 2], ["Sulu Sea", "苏禄海", 2], ["Andaman Sea", "安达曼海", 2],
  ["Gulf of Thailand", "泰国湾", 2], ["Gulf of Aden", "亚丁湾", 2], ["Golfo de California", "加利福尼亚湾", 2],
  ["Adriatic Sea", "亚得里亚海", 2], ["Aegean Sea", "爱琴海", 2], ["Tyrrhenian Sea", "第勒尼安海", 2],
  ["Sargasso Sea", "马尾藻海", 2], ["Scotia Sea", "斯科舍海", 2],
];
const STRAITS = [
  ["Strait of Malacca", "马六甲海峡", 1, 100.4, 3.4], ["Strait of Gibraltar", "直布罗陀海峡", 1],
  ["Strait of Hormuz", "霍尔木兹海峡", 1, 56.3, 26.6], ["Bab el Mandeb", "曼德海峡", 1],
  ["Bosporus", "博斯普鲁斯海峡", 1], ["English Channel", "英吉利海峡", 1, -1.8, 50.1],
  ["Bering Strait", "白令海峡", 1, -168.8, 65.8], ["Taiwan Strait", "台湾海峡", 1], ["Drake Passage", "德雷克海峡", 1, -64, -58.5],
  ["Mozambique Channel", "莫桑比克海峡", 1], ["Korea Strait", "朝鲜海峡", 1], ["Luzon Strait", "吕宋海峡", 1],
  ["Dardanelles", "达达尼尔海峡", 2], ["Strait of Dover", "多佛尔海峡", 2, 1.45, 51.0],
  ["Tsugaru Strait", "津轻海峡", 2], ["La Pérouse Strait", "宗谷海峡", 2], ["Tatar Strait", "鞑靼海峡", 2],
  ["Qiongzhou Strait", "琼州海峡", 2], ["Sunda Strait", "巽他海峡", 2, 105.8, -6.0],
  ["Lombok Strait", "龙目海峡", 2, 115.75, -8.75], ["Makassar Strait", "望加锡海峡", 2],
  ["Torres Strait", "托雷斯海峡", 2], ["Bass Strait", "巴斯海峡", 2], ["Cook Strait", "库克海峡", 2],
  ["Estrecho de Magellanes", "麦哲伦海峡", 2], ["Straits of Florida", "佛罗里达海峡", 2],
  ["Yucatan Channel", "尤卡坦海峡", 2], ["Denmark Strait", "丹麦海峡", 2], ["Davis Strait", "戴维斯海峡", 2],
  ["Hudson Strait", "哈得孙海峡", 2], ["Palk Strait", "保克海峡", 2],
];
const RANGES = [
  ["HIMALAYAS", "喜马拉雅山脉", 1, 84.5, 28.4], ["ANDES", "安第斯山脉", 1], ["ROCKY MOUNTAINS", "落基山脉", 1],
  ["ALPS", "阿尔卑斯山脉", 1], ["TIAN SHAN", "天山山脉", 1], ["URAL MOUNTAINS", "乌拉尔山脉", 1],
  ["CAUCASUS MTS.", "高加索山脉", 1], ["Transantarctic Mountains", "横贯南极山脉", 1],
  ["GREAT DIVIDING RANGE", "大分水岭", 1], ["KUNLUN MOUNTAINS", "昆仑山脉", 1], ["ATLAS MOUNTAINS", "阿特拉斯山脉", 1],
  ["APPALACHIAN MTS.", "阿巴拉契亚山脉", 1], ["PLATEAU OF TIBET", "青藏高原", 1],
  ["KARAKORAM RA.", "喀喇昆仑山脉", 2], ["HINDU KUSH", "兴都库什山脉", 2], ["PAMIRS", "帕米尔高原", 2],
  ["ALTAY MOUNTAINS", "阿尔泰山脉", 2], ["ZAGROS MOUNTAINS", "扎格罗斯山脉", 2, 48.5, 32.5], ["ETHIOPIAN HIGHLANDS", "埃塞俄比亚高原", 2],
  ["GREATER KHINGAN RANGE", "大兴安岭", 2], ["Qinling Mountains", "秦岭", 2], ["QUILIAN MOUNTAINS", "祁连山脉", 2],
  ["STANOVOY RANGE", "外兴安岭", 2], ["CHAÎNE ANNAMITIQUE", "长山山脉", 2], ["VERKHOYANSK RANGE", "上扬斯克山脉", 2],
  ["EASTERN SAYAN MTS.", "东萨彦岭", 2], ["ELBURZ MTS.", "厄尔布尔士山脉", 2], ["WESTERN GHATS", "西高止山脉", 2],
  ["EASTERN GHATS", "东高止山脉", 2], ["KJØLEN MOUNTAINS", "斯堪的纳维亚山脉", 2], ["CARPATHIAN MOUNTAINS", "喀尔巴阡山脉", 2],
  ["PYRENEES", "比利牛斯山脉", 2], ["BROOKS RANGE", "布鲁克斯山脉", 2], ["ALASKA RANGE", "阿拉斯加山脉", 2],
  ["CASCADE RANGE", "喀斯喀特山脉", 2], ["COAST MOUNTAINS", "海岸山脉", 2], ["SIERRA NEVADA", "内华达山脉", 2],
  ["SIERRA MADRE OCCIDENTAL", "西马德雷山脉", 2], ["SIERRA MADRE ORIENTAL", "东马德雷山脉", 2],
  ["DRAKENSBERG", "德拉肯斯堡山脉", 2], ["SOUTHERN ALPS", "南阿尔卑斯山脉", 2],
];


// Keep every addition/removal here; positions derive from Natural Earth.
const DESERTS = [
  ["SAHARA", "撒哈拉沙漠", 1], ["GOBI DESERT", "戈壁沙漠", 1],
  ["TAKLIMAKAN DESERT", "塔克拉玛干沙漠", 2], ["RUB’ AL KHALI", "鲁卜哈利沙漠", 1],
  ["KALAHARI DESERT", "卡拉哈里沙漠", 2], ["NAMIB DESERT", "纳米布沙漠", 2],
  ["DESIERTO DE ATACAMA", "阿塔卡马沙漠", 2], ["THAR DESERT", "塔尔沙漠", 2],
  ["GREAT VICTORIA DESERT", "维多利亚大沙漠", 2], ["GREAT SANDY DESERT", "大沙沙漠", 2],
  ["SONORAN DESERT", "索诺拉沙漠", 2], ["CHIHUAHUAN DESERT", "奇瓦瓦沙漠", 2],
];
const PLAINS = [
  ["NORTH CHINA PLAIN", "华北平原", 2], ["MANCHURIAN PLAIN", "东北平原", 2],
  ["GANGES PLAIN", "恒河平原", 2], ["NORTHERN EUROPEAN PLAIN", "欧洲北部平原", 1, 25, 53],
  ["GREAT PLAINS", "大平原", 1, -100, 41], ["PAMPAS", "潘帕斯平原", 2],
  ["NULLARBOR PLAIN", "纳拉伯平原", 2], ["LLANOS", "奥里诺科平原", 2],
];
const BASINS = [
  ["AMAZON BASIN", "亚马孙盆地", 1], ["CONGO BASIN", "刚果盆地", 1],
  ["SICHUAN BASIN", "四川盆地", 2], ["TARIM BASIN", "塔里木盆地", 2],
  ["Qaidam Basin", "柴达木盆地", 2], ["Junggar Basin", "准噶尔盆地", 2],
];
const RIVERS = [
  ["Yangtze", "长江", 1], ["Huang", "黄河", 1], ["Mekong", "湄公河", 2],
  ["Nile", "尼罗河", 1], ["Amazonas", "亚马孙河", 1], ["Congo", "刚果河", 2],
  ["Mississippi", "密西西比河", 1], ["Ganges", "恒河", 2], ["Indus", "印度河", 2],
  ["Danube", "多瑙河", 2], ["Rhine", "莱茵河", 2], ["Volga", "伏尔加河", 2],
  ["Yenisey", "叶尼塞河", 2], ["Lena", "勒拿河", 2],
];

async function load(dir, file) {
  if (dir) return JSON.parse(readFileSync(dir + "/" + file, "utf8"));
  const response = await fetch(NE_BASE + file, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(file + " HTTP " + response.status);
  return response.json();
}

// --- pole of inaccessibility on a local equirectangular projection ---------

function polygonsOf(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  throw new Error("unsupported geometry " + geometry.type);
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return Math.abs(area / 2);
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Signed distance to the polygon edge (negative outside). */
function edgeDistance(point, polygon) {
  let inside = pointInRing(point, polygon[0]);
  for (const hole of polygon.slice(1)) if (pointInRing(point, hole)) inside = false;
  let min = Infinity;
  for (const ring of polygon) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) min = Math.min(min, segmentDistance(point, ring[j], ring[i]));
  return inside ? min : -min;
}

function labelPoint(geometry) {
  // Largest part; unwrap across the antimeridian; scale longitude by cos(lat).
  const largest = polygonsOf(geometry).reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
  const lons = largest[0].map((p) => p[0]);
  const wraps = Math.max(...lons) - Math.min(...lons) > 180;
  const lats = largest[0].map((p) => p[1]);
  const k = Math.cos((((Math.max(...lats) + Math.min(...lats)) / 2) * Math.PI) / 180);
  const project = ([lon, lat]) => [(wraps && lon < 0 ? lon + 360 : lon) * k, lat];
  const polygon = largest.map((ring) => ring.map(project));
  const xs = polygon[0].map((p) => p[0]);
  const ys = polygon[0].map((p) => p[1]);
  let center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  let span = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  let best = { point: center, distance: edgeDistance(center, polygon) };
  for (let round = 0; round < 8; round++) {
    const n = 40;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const point = [center[0] - span[0] / 2 + (span[0] * i) / n, center[1] - span[1] / 2 + (span[1] * j) / n];
        const distance = edgeDistance(point, polygon);
        if (distance > best.distance) best = { point, distance };
      }
    }
    center = best.point;
    span = [span[0] / 3, span[1] / 3];
  }
  let lon = best.point[0] / k;
  if (lon > 180) lon -= 360;
  return [Math.round(lon * 100) / 100, Math.round(best.point[1] * 100) / 100];
}

// --------------------------------------------------------------------------

const dir = process.argv[2];
const marine = await load(dir, MARINE);
const regions = await load(dir, REGIONS);
const rivers = await load(dir, RIVERS_FILE);

function findFeature(collection, name) {
  const key = (f) => (f.properties.name ?? f.properties.NAME ?? "").trim();
  const matches = collection.features.filter((f) => key(f) === name);
  if (matches.length === 0) throw new Error("Natural Earth has no feature named " + name);
  return matches.reduce((a, b) => {
    const area = (f) => Math.max(...polygonsOf(f.geometry).map((p) => ringArea(p[0])));
    return area(b) > area(a) ? b : a;
  });
}

const labels = [];
function add(kind, entries, collection) {
  for (const [english, chinese, tier, lon, lat] of entries) {
    const [longitude, latitude] = lon !== undefined ? [lon, lat] : labelPoint(findFeature(collection, english).geometry);
    const name = english === english.toUpperCase() ? english.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()) : english;
    labels.push({ kind, tier, name: chinese, english: name, longitude, latitude });
  }
}
add("ocean", OCEANS, marine);
add("sea", SEAS, marine);
add("strait", STRAITS, marine);
add("range", RANGES, regions);
add("desert", DESERTS, regions);
add("plain", PLAINS, regions);
add("basin", BASINS, regions);
// River labels sit halfway along the longest named line, not at an arbitrary
// land centroid. This is a representative anchor, not the whole river extent.
for (const [english, name, tier] of RIVERS) {
  const lines = rivers.features.filter(f => f.properties.name === english).flatMap(f => f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : []);
  const length = line => line.slice(1).reduce((n,p,i) => n + Math.hypot((p[0]-line[i][0])*Math.cos(p[1]*Math.PI/180),p[1]-line[i][1]),0);
  if (!lines.length) throw new Error("Missing river: " + english);
  const line = lines.sort((a,b) => length(b)-length(a))[0];
  let remaining = length(line)/2;
  let anchor = line[0];
  for (let i=1;i<line.length;i++) {
    const a=line[i-1], b=line[i];
    const segment=Math.hypot((b[0]-a[0])*Math.cos(b[1]*Math.PI/180),b[1]-a[1]);
    if (segment >= remaining && segment > 0) { const t=remaining/segment; anchor=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]; break; }
    remaining-=segment;
  }
  labels.push({kind:"river",tier,name,english,longitude:Math.round(anchor[0]*100)/100,latitude:Math.round(anchor[1]*100)/100});
}

writeFileSync(new URL("../src/data/geoLabels.json", import.meta.url), JSON.stringify(labels, null, 0).replace(/\},\{/g, "},\n{") + "\n");
console.log("wrote", labels.length, "labels");
