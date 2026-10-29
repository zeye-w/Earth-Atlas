/** The /admin dashboard: one self-contained page (no external scripts, fonts or images). */
export const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>TerraScope · 统计后台</title>
<style>
  :root { color-scheme: dark; --bg:#05070b; --card:#0e131c; --line:rgba(255,255,255,.09); --text:#eef2f8; --dim:rgba(238,242,248,.58); --a:#5aa2ff; --b:#8fe3ff; --c:#f6b26b; }
  * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  header { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:18px 22px; border-bottom:1px solid var(--line); }
  header h1 { margin:0; font-size:15px; letter-spacing:.24em; font-weight:500; } header h1 b { font-weight:700; }
  header .sub { color:var(--dim); font-size:12px; } header .grow { flex:1; }
  main { max-width:1180px; margin:0 auto; padding:20px 16px 48px; }
  select, button, input { font:inherit; color:var(--text); background:#141a25; border:1px solid var(--line); border-radius:9px; padding:7px 11px; }
  button { cursor:pointer; } button.primary { background:var(--a); border-color:var(--a); color:#03101f; font-weight:600; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
  .kpi .label { color:var(--dim); font-size:12px; } .kpi .value { font-size:26px; font-weight:600; margin-top:4px; font-variant-numeric:tabular-nums; } .kpi .note { color:var(--dim); font-size:11px; }
  h2 { font-size:13px; font-weight:600; letter-spacing:.06em; color:var(--dim); margin:26px 0 10px; }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:10px; }
  table { width:100%; border-collapse:collapse; font-size:13px; } td, th { padding:6px 4px; border-bottom:1px solid var(--line); text-align:left; } th { color:var(--dim); font-weight:500; } td.n { text-align:right; font-variant-numeric:tabular-nums; }
  .bar { height:6px; border-radius:3px; background:linear-gradient(90deg, var(--a), var(--b)); }
  .legend { display:flex; gap:16px; font-size:12px; color:var(--dim); margin-bottom:6px; } .legend i { display:inline-block; width:10px; height:3px; margin-right:6px; vertical-align:middle; }
  svg text { fill:var(--dim); font-size:10px; }
  .login { max-width:380px; margin:12vh auto; } .login p { color:var(--dim); font-size:13px; } .login form { display:flex; gap:8px; } .login input { flex:1; }
  .msg { color:#ff9c8a; font-size:13px; margin-top:10px; } .empty { color:var(--dim); font-size:13px; padding:8px 0; }
</style>
</head>
<body>
<header><h1>TERRA<b>SCOPE</b></h1><span class="sub">统计后台 · 匿名使用数据</span><span class="grow"></span>
  <label class="sub">时间范围 <select id="days"><option value="7">近 7 天</option><option value="30" selected>近 30 天</option><option value="90">近 90 天</option><option value="365">近 1 年</option></select></label>
  <button id="logout" type="button">退出</button></header>
<main id="app"></main>
<script>
(function () {
  var app = document.getElementById("app"), daysSelect = document.getElementById("days");
  var KEY = "terrascope.stats.token";
  var token = sessionStorage.getItem(KEY) || "";
  var FEATURE = { layer: "图层", show: "互动体验", share: "分享", tour: "旅行导览", live_photo: "实况图", search: "搜索" };
  var DIM = { lang: "界面语言", device: "设备", country: "国家/地区", referrer: "来源网站" };
  var VALUE = { en: "英文", zh: "中文", phone: "手机", tablet: "平板", desktop: "电脑" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(n) { return (Number(n) || 0).toLocaleString("zh-CN"); }
  function pct(a, b) { return b ? Math.round(100 * a / b) + "%" : "—"; }
  function login(message) {
    app.innerHTML = '<div class="login card"><h2 style="margin-top:0">输入访问口令</h2><p>口令是部署时设置的 STATS_TOKEN，只保存在本标签页，关闭即失效。</p>' +
      '<form id="f"><input id="t" type="password" autocomplete="current-password" aria-label="访问口令" required><button class="primary">查看</button></form>' +
      (message ? '<div class="msg">' + esc(message) + '</div>' : '') + '</div>';
    document.getElementById("f").onsubmit = function (e) { e.preventDefault(); token = document.getElementById("t").value; sessionStorage.setItem(KEY, token); load(); };
  }
  function kpi(label, value, note) { return '<div class="card kpi"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="note">' + (note || "&nbsp;") + '</div></div>'; }
  function chart(daily, from, to) {
    var days = [], d = new Date(from + "T00:00:00Z"), end = new Date(to + "T00:00:00Z");
    for (; d <= end; d = new Date(d.getTime() + 864e5)) days.push(d.toISOString().slice(0, 10));
    var byDay = {}; daily.forEach(function (r) { byDay[r.day] = r; });
    var series = [["users", "var(--a)", "活跃用户"], ["new_users", "var(--c)", "新用户"], ["sessions", "var(--b)", "访问次数"]];
    var max = 1; days.forEach(function (day) { var r = byDay[day] || {}; series.forEach(function (s) { max = Math.max(max, r[s[0]] || 0); }); });
    var W = 1000, H = 220, L = 34, B = 22, step = days.length > 1 ? (W - L - 8) / (days.length - 1) : 0;
    var y = function (v) { return 8 + (H - B - 8) * (1 - v / max); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="每日趋势">';
    [0, .5, 1].forEach(function (f) { var v = Math.round(max * f); svg += '<line x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="rgba(255,255,255,.07)"/><text x="' + (L - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + v + '</text>'; });
    series.forEach(function (s) {
      var pts = days.map(function (day, i) { return (L + i * step).toFixed(1) + "," + y((byDay[day] || {})[s[0]] || 0).toFixed(1); }).join(" ");
      svg += '<polyline fill="none" stroke="' + s[1] + '" stroke-width="2" stroke-linejoin="round" points="' + pts + '"/>';
    });
    var every = Math.max(1, Math.ceil(days.length / 8));
    days.forEach(function (day, i) { if (i % every === 0 || i === days.length - 1) svg += '<text x="' + (L + i * step) + '" y="' + (H - 6) + '" text-anchor="' + (i === days.length - 1 && days.length > 1 ? "end" : "middle") + '">' + day.slice(5) + '</text>'; });
    return '<div class="legend">' + series.map(function (s) { return '<span><i style="background:' + s[1] + '"></i>' + s[2] + '</span>'; }).join("") + '</div>' + svg + '</svg>';
  }
  function table(rows, columns) {
    if (!rows.length) return '<div class="empty">暂无数据</div>';
    var max = Math.max.apply(null, rows.map(function (r) { return r.users || 0; })) || 1;
    return '<table><tr>' + columns.map(function (c) { return '<th' + (c.n ? ' class="n"' : '') + '>' + c.title + '</th>'; }).join("") + '<th style="width:28%"></th></tr>' +
      rows.map(function (r) { return '<tr>' + columns.map(function (c) { return '<td' + (c.n ? ' class="n"' : '') + '>' + c.cell(r) + '</td>'; }).join("") +
        '<td><div class="bar" style="width:' + (100 * (r.users || 0) / max).toFixed(1) + '%"></div></td></tr>'; }).join("") + '</table>';
  }
  function render(s) {
    var t = s.totals || {}, a = s.activity || {}, r = s.retention || {};
    var today = (s.daily.filter(function (row) { return row.day === s.to; })[0] || {}).users || 0;
    var minutesPerUser = t.users ? (t.active_minutes / t.users).toFixed(1) : "0";
    var html = '<div class="kpis">' +
      kpi("今日活跃用户", num(today), "UTC " + s.to) +
      kpi("近 7 天活跃 (WAU)", num(a.wau)) + kpi("近 30 天活跃 (MAU)", num(a.mau), "粘性 DAU/MAU " + pct(today, a.mau)) +
      kpi("用户数", num(t.users), "所选范围内") + kpi("新用户", num(t.new_users), "老用户 " + num(Math.max(0, t.users - t.new_users))) +
      kpi("访问次数", num(t.sessions), "页面打开 " + num(t.views)) + kpi("人均使用时长", minutesPerUser + " 分钟", "页面在前台的时间") +
      kpi("次日留存", pct(r.day1, r.day1_eligible), "新用户 " + num(r.day1_eligible) + " 人中") + kpi("7 日留存", pct(r.day7, r.day7_eligible), "新用户 " + num(r.day7_eligible) + " 人中") +
      '</div><h2>每日趋势</h2><div class="card">' + chart(s.daily, s.from, s.to) + '</div>' +
      '<h2>功能使用（按使用人数）</h2><div class="card">' + table(s.features, [
        { title: "功能", cell: function (row) { return esc(FEATURE[row.name] || row.name) + (row.detail ? ' · <span class="sub">' + esc(row.detail) + '</span>' : ''); } },
        { title: "人数", n: 1, cell: function (row) { return num(row.users); } }, { title: "次数", n: 1, cell: function (row) { return num(row.uses); } }]) + '</div>' +
      '<div class="grid2">' + Object.keys(DIM).map(function (k) {
        return '<div><h2>' + DIM[k] + '</h2><div class="card">' + table(s.breakdowns[k] || [], [
          { title: DIM[k], cell: function (row) { return esc(VALUE[row.value] || row.value); } }, { title: "用户", n: 1, cell: function (row) { return num(row.users); } }]) + '</div></div>';
      }).join("") + '</div>';
    app.innerHTML = html;
  }
  function load() {
    if (!token) return login();
    app.innerHTML = '<div class="empty">加载中…</div>';
    fetch("/api/stats/summary?days=" + daysSelect.value, { headers: { Authorization: "Bearer " + token } }).then(function (res) {
      if (res.status === 401) { sessionStorage.removeItem(KEY); token = ""; return login("口令不正确"); }
      return res.json().then(function (body) {
        if (!res.ok) return login(body.error === "not_configured" ? "统计尚未配置：" + body.detail : "加载失败（" + res.status + "）");
        render(body);
      });
    }).catch(function () { app.innerHTML = '<div class="msg">网络错误，稍后重试</div>'; });
  }
  daysSelect.onchange = load;
  document.getElementById("logout").onclick = function () { sessionStorage.removeItem(KEY); token = ""; login(); };
  load();
})();
</script>
</body>
</html>`;
