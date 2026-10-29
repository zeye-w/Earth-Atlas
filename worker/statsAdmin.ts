/** The /admin dashboard: one self-contained page (no external scripts, fonts or images). */
export const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>TerraScope · 统计后台</title>
<style>
  :root {
    color-scheme:light;
    --bg:#f5f7fa; --card:#fff; --line:#dce3eb;
    --text:#26364b; --dim:#627389; --a:#527fa6; --b:#4b988e; --c:#c49a59;
    --grid:rgba(91,113,136,.16);
  }
  * { box-sizing:border-box; }
  body {
    min-height:100vh; margin:0; color:var(--text);
    background:radial-gradient(ellipse at 10% 0%,#edf3f8 0%,transparent 43%),var(--bg);
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  header {
    display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:18px max(22px,calc((100% - 1148px)/2));
    border-bottom:1px solid var(--line); background:rgba(255,255,255,.92);
    box-shadow:0 2px 12px rgba(38,54,75,.035);
  }
  header h1 { margin:0; font-size:15px; letter-spacing:.24em; font-weight:500; color:#30465c; }
  header h1 b { font-weight:750; }
  header .sub { color:var(--dim); font-size:12px; } header .grow { flex:1; }
  main { max-width:1180px; margin:0 auto; padding:26px 16px 56px; }
  select,button,input {
    min-height:36px; padding:7px 11px; border:1px solid #ccd7e3; border-radius:9px;
    background:#fff; color:var(--text); font:inherit;
    transition:border-color .16s,box-shadow .16s,background .16s;
  }
  button { cursor:pointer; }
  button:hover,select:hover { border-color:#a8bacd; background:#f8fbfd; }
  button:focus-visible,select:focus-visible,input:focus-visible { outline:2px solid var(--a); outline-offset:2px; }
  button.primary { background:var(--a); border-color:var(--a); color:#fff; font-weight:600; }
  button.primary:hover { background:#416e94; border-color:#416e94; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .card {
    padding:16px 18px; border:1px solid var(--line); border-radius:15px;
    background:var(--card); box-shadow:0 3px 18px rgba(43,69,92,.045);
  }
  .kpi .label { color:var(--dim); font-size:12px; }
  .kpi .value { margin-top:5px; color:#253e56; font-size:27px; font-weight:650; letter-spacing:-.025em; font-variant-numeric:tabular-nums; }
  .kpi .note { color:var(--dim); font-size:11px; }
  h2 { margin:28px 0 11px; color:#4d6178; font-size:13px; font-weight:650; letter-spacing:.055em; }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr)); gap:12px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  td,th { padding:9px 5px; border-bottom:1px solid #e9eef4; text-align:left; }
  tr:last-child td { border-bottom:none; }
  th { color:var(--dim); font-weight:600; }
  td.n,th.n { text-align:right; font-variant-numeric:tabular-nums; }
  .bar { height:6px; border-radius:4px; background:linear-gradient(90deg,var(--a),var(--b)); }
  .legend { display:flex; flex-wrap:wrap; gap:8px 18px; margin-bottom:10px; color:var(--dim); font-size:12px; }
  .legend i { display:inline-block; width:12px; height:4px; margin-right:6px; border-radius:3px; vertical-align:middle; }
  svg text { fill:var(--dim); font-size:10px; }
  .login { max-width:410px; margin:11vh auto; padding:26px 27px; }
  .login h2 { margin-top:0; color:var(--text); font-size:17px; letter-spacing:0; }
  .login p { color:var(--dim); font-size:13px; line-height:1.8; }
  .login form { display:flex; gap:9px; margin-top:18px; }
  .login input { flex:1; min-width:0; }
  .msg { margin-top:12px; color:#a54338; font-size:13px; }
  .empty { padding:8px 0; color:var(--dim); font-size:13px; }
  @media (max-width:540px) {
    header { padding:15px 16px; } header .grow { flex-basis:100%; }
    main { padding:18px 12px 40px; } .card { padding:14px; }
    .login { margin:8vh auto; padding:22px; }
  }
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
    [0, .5, 1].forEach(function (f) { var v = Math.round(max * f); svg += '<line x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--grid)"/><text x="' + (L - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + v + '</text>'; });
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
