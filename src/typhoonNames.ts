/**
 * Chinese names of western North Pacific tropical cyclones (the ESCAP/WMO
 * Typhoon Committee list, as used by the China Meteorological Administration).
 * Names not listed here, and storms of other basins, keep their English name.
 */
const NAMES: Readonly<Record<string, string>> = {
  damrey: "达维", haikui: "海葵", kirogi: "鸿雁", kai_tak: "启德", tembin: "天秤", bolaven: "布拉万", sanba: "三巴",
  jelawat: "杰拉华", ewiniar: "艾云尼", maliksi: "马力斯", gaemi: "格美", prapiroon: "派比安", maria: "玛莉亚",
  son_tinh: "山神", ampil: "安比", wukong: "悟空", jongdari: "云雀", shanshan: "珊珊", yagi: "摩羯", leepi: "丽琵",
  bebinca: "贝碧嘉", pulasan: "普拉桑", soulik: "苏力", cimaron: "西马仑", jebi: "飞燕", krathon: "山陀儿",
  barijat: "百里嘉", trami: "潭美", kong_rey: "康妮", yinxing: "银杏", toraji: "桃芝", man_yi: "万宜", usagi: "天兔",
  pabuk: "帕布", wutip: "蝴蝶", sepat: "圣帕", mun: "木恩", danas: "丹娜丝", nari: "百合", wipha: "韦帕",
  francisco: "范斯高", co_may: "竹节草", krosa: "罗莎", bailu: "白鹿", podul: "杨柳", lingling: "玲玲", kajiki: "剑鱼",
  tapah: "塔巴", mitag: "米娜", ragasa: "桦加沙", neoguri: "浣熊", bualoi: "博罗依", matmo: "麦德姆", halong: "夏浪",
  nakri: "娜基莉", fengshen: "风神", kalmaegi: "海鸥", fung_wong: "凤凰", nuri: "黄蜂", sinlaku: "森拉克",
  hagupit: "黑格比", jangmi: "蔷薇", mekkhala: "米克拉", higos: "海高斯", bavi: "巴威", maysak: "美莎克",
  haishen: "海神", noul: "红霞", dolphin: "白海豚", kujira: "鲸鱼", chan_hom: "灿鸿", nangka: "浪卡",
  saudel: "沙德尔", atsani: "艾莎尼", etau: "艾涛", krovanh: "科罗旺", dujuan: "杜鹃", surigae: "舒力基",
  choi_wan: "彩云", koguma: "小熊", champi: "蔷琵", in_fa: "烟花", cempaka: "查帕卡", nepartak: "尼伯特",
  lupit: "卢碧", mirinae: "银河", nida: "妮妲", omais: "奥麦斯", conson: "康森", chanthu: "灿都", dianmu: "电母",
  mindulle: "蒲公英", lionrock: "狮子山", kompasu: "圆规", namtheun: "南川", malou: "玛瑙", nyatoh: "妮亚图",
  rai: "雷伊", malakas: "马勒卡", megi: "鲇鱼", chaba: "暹芭", aere: "艾利", songda: "桑达", mulan: "木兰",
  meari: "米雷", ma_on: "马鞍", tokage: "蝎虎", hinnamnor: "轩岚诺", muifa: "梅花", merbok: "苗柏",
  nanmadol: "南玛都", talas: "塔拉斯", noru: "奥鹿", kulap: "玫瑰", roke: "洛克", sonca: "桑卡", nesat: "纳沙",
  haitang: "海棠", nalgae: "尼格", banyan: "榕树", yamaneko: "山猫", pakhar: "帕卡", sanvu: "珊瑚", mawar: "玛娃",
  guchol: "古超", talim: "泰利", doksuri: "杜苏芮", khanun: "卡努", lan: "兰恩", saola: "苏拉",
};

const key = (name: string) => name.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** The Chinese name of a western Pacific typhoon, or null. */
export function typhoonChineseName(name: string): string | null {
  return NAMES[key(name)] ?? null;
}

/** How a storm is named in the UI: Chinese name with the English one, or the English one alone. */
export function stormDisplayName(name: string, locale: "zh" | "en"): string {
  const pretty = name.length > 3 && name === name.toUpperCase() ? name.charAt(0) + name.slice(1).toLowerCase() : name;
  const chinese = locale === "zh" ? typhoonChineseName(name) : null;
  return chinese ? `${chinese}（${pretty}）` : pretty;
}
