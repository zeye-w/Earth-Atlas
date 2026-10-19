/**
 * Curated world-city display coordinates in WGS84 degrees.
 *
 * Locations are approximate city centres suitable for cartographic labels,
 * NOT administrative centroids, borders, or a population ranking.
 * Deliberately bounded to preserve globe performance without a map API.
 */
export interface WorldCity {
  id: string;
  english: string;
  chinese: string;
  latitude: number;
  longitude: number;
  tier: 1 | 2;
}

export const WORLD_CITIES: readonly WorldCity[] = [
  { id:"tokyo", english:"Tokyo", chinese:"东京", latitude:35.6762, longitude:139.6503, tier:1 },
  { id:"osaka", english:"Osaka", chinese:"大阪", latitude:34.6937, longitude:135.5023, tier:2 },
  { id:"beijing", english:"Beijing", chinese:"北京", latitude:39.9042, longitude:116.4074, tier:1 },
  { id:"shanghai", english:"Shanghai", chinese:"上海", latitude:31.2304, longitude:121.4737, tier:1 },
  { id:"shenzhen", english:"Shenzhen", chinese:"深圳", latitude:22.5431, longitude:114.0579, tier:2 },
  { id:"hong-kong", english:"Hong Kong", chinese:"香港", latitude:22.3193, longitude:114.1694, tier:2 },
  { id:"taipei", english:"Taipei", chinese:"台北", latitude:25.0330, longitude:121.5654, tier:2 },
  { id:"seoul", english:"Seoul", chinese:"首尔", latitude:37.5665, longitude:126.9780, tier:1 },
  { id:"singapore", english:"Singapore", chinese:"新加坡", latitude:1.3521, longitude:103.8198, tier:1 },
  { id:"bangkok", english:"Bangkok", chinese:"曼谷", latitude:13.7563, longitude:100.5018, tier:2 },
  { id:"jakarta", english:"Jakarta", chinese:"雅加达", latitude:-6.2088, longitude:106.8456, tier:1 },
  { id:"manila", english:"Manila", chinese:"马尼拉", latitude:14.5995, longitude:120.9842, tier:2 },
  { id:"delhi", english:"Delhi", chinese:"德里", latitude:28.6139, longitude:77.2090, tier:1 },
  { id:"mumbai", english:"Mumbai", chinese:"孟买", latitude:19.0760, longitude:72.8777, tier:1 },
  { id:"bengaluru", english:"Bengaluru", chinese:"班加罗尔", latitude:12.9716, longitude:77.5946, tier:2 },
  { id:"dubai", english:"Dubai", chinese:"迪拜", latitude:25.2048, longitude:55.2708, tier:1 },
  { id:"riyadh", english:"Riyadh", chinese:"利雅得", latitude:24.7136, longitude:46.6753, tier:2 },
  { id:"tehran", english:"Tehran", chinese:"德黑兰", latitude:35.6892, longitude:51.3890, tier:2 },
  { id:"istanbul", english:"Istanbul", chinese:"伊斯坦布尔", latitude:41.0082, longitude:28.9784, tier:1 },
  { id:"moscow", english:"Moscow", chinese:"莫斯科", latitude:55.7558, longitude:37.6173, tier:1 },
  { id:"london", english:"London", chinese:"伦敦", latitude:51.5074, longitude:-0.1278, tier:1 },
  { id:"paris", english:"Paris", chinese:"巴黎", latitude:48.8566, longitude:2.3522, tier:1 },
  { id:"berlin", english:"Berlin", chinese:"柏林", latitude:52.5200, longitude:13.4050, tier:2 },
  { id:"madrid", english:"Madrid", chinese:"马德里", latitude:40.4168, longitude:-3.7038, tier:2 },
  { id:"rome", english:"Rome", chinese:"罗马", latitude:41.9028, longitude:12.4964, tier:2 },
  { id:"amsterdam", english:"Amsterdam", chinese:"阿姆斯特丹", latitude:52.3676, longitude:4.9041, tier:2 },
  { id:"zurich", english:"Zurich", chinese:"苏黎世", latitude:47.3769, longitude:8.5417, tier:2 },
  { id:"cairo", english:"Cairo", chinese:"开罗", latitude:30.0444, longitude:31.2357, tier:1 },
  { id:"lagos", english:"Lagos", chinese:"拉各斯", latitude:6.5244, longitude:3.3792, tier:1 },
  { id:"nairobi", english:"Nairobi", chinese:"内罗毕", latitude:-1.2921, longitude:36.8219, tier:2 },
  { id:"addis-ababa", english:"Addis Ababa", chinese:"亚的斯亚贝巴", latitude:9.0192, longitude:38.7525, tier:2 },
  { id:"johannesburg", english:"Johannesburg", chinese:"约翰内斯堡", latitude:-26.2041, longitude:28.0473, tier:1 },
  { id:"new-york", english:"New York", chinese:"纽约", latitude:40.7128, longitude:-74.0060, tier:1 },
  { id:"washington", english:"Washington, D.C.", chinese:"华盛顿", latitude:38.9072, longitude:-77.0369, tier:2 },
  { id:"chicago", english:"Chicago", chinese:"芝加哥", latitude:41.8781, longitude:-87.6298, tier:2 },
  { id:"los-angeles", english:"Los Angeles", chinese:"洛杉矶", latitude:34.0522, longitude:-118.2437, tier:1 },
  { id:"san-francisco", english:"San Francisco", chinese:"旧金山", latitude:37.7749, longitude:-122.4194, tier:2 },
  { id:"seattle", english:"Seattle", chinese:"西雅图", latitude:47.6062, longitude:-122.3321, tier:2 },
  { id:"toronto", english:"Toronto", chinese:"多伦多", latitude:43.6532, longitude:-79.3832, tier:1 },
  { id:"vancouver", english:"Vancouver", chinese:"温哥华", latitude:49.2827, longitude:-123.1207, tier:2 },
  { id:"mexico-city", english:"Mexico City", chinese:"墨西哥城", latitude:19.4326, longitude:-99.1332, tier:1 },
  { id:"bogota", english:"Bogotá", chinese:"波哥大", latitude:4.7110, longitude:-74.0721, tier:2 },
  { id:"lima", english:"Lima", chinese:"利马", latitude:-12.0464, longitude:-77.0428, tier:2 },
  { id:"sao-paulo", english:"São Paulo", chinese:"圣保罗", latitude:-23.5505, longitude:-46.6333, tier:1 },
  { id:"rio", english:"Rio de Janeiro", chinese:"里约热内卢", latitude:-22.9068, longitude:-43.1729, tier:2 },
  { id:"buenos-aires", english:"Buenos Aires", chinese:"布宜诺斯艾利斯", latitude:-34.6037, longitude:-58.3816, tier:1 },
  { id:"santiago", english:"Santiago", chinese:"圣地亚哥", latitude:-33.4489, longitude:-70.6693, tier:2 },
  { id:"sydney", english:"Sydney", chinese:"悉尼", latitude:-33.8688, longitude:151.2093, tier:1 },
  { id:"melbourne", english:"Melbourne", chinese:"墨尔本", latitude:-37.8136, longitude:144.9631, tier:2 },
  { id:"auckland", english:"Auckland", chinese:"奥克兰", latitude:-36.8485, longitude:174.7633, tier:2 },
] as const;

export function validWorldCities(cities: readonly WorldCity[] = WORLD_CITIES): boolean {
  const ids = new Set<string>();
  return cities.every((city) => {
    if (!city.id || ids.has(city.id)) return false;
    ids.add(city.id);
    return Boolean(city.chinese && city.english) &&
      Number.isFinite(city.latitude) && city.latitude >= -90 && city.latitude <= 90 &&
      Number.isFinite(city.longitude) && city.longitude >= -180 && city.longitude <= 180 &&
      (city.tier === 1 || city.tier === 2);
  });
}
