/* ===== 配置 / 工具 ===== */

var SUPABASE_URL = 'https://ztjddowhmwxqbbfvfwzp.supabase.co';
var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0amRkb3dobXd4cWJiZnZmd3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3NjQwNzEsImV4cCI6MjEwNTM0MDA3MX0.Y5SwEguN5a9JMKFgWsmWoa1DO6rNZ8DLahGXv-S6YWU';

var CFG = {
  bucket: 'todo-images',
  defaultTags: ['工作', '日常'],
  urgency: {
    horizonHours: 14 * 24, // 超过 14 天视为「还很远」→ 白色
    curve: 1.8,            // 曲线：越大越「平时很淡、临近才红」
    redIntensity: 255,     // 红色通道强度 0-255（越大越红）
    blueRatio: 0.72,       // 蓝通道衰减比例，调小更偏粉
    strongTextAt: 0.55     // 超过此值徽章用白字
  }
};

var sb = null;
try {
  if (window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  }
} catch (e) { sb = null; }

/* ---------- 日期 ---------- */
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function todayStr() { return ymd(new Date()); }
function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function fmtDateCN(s) { var d = parseYmd(s); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()]; }
function fmtMonthCN(y, m) { return y + '年' + (m + 1) + '月'; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/* ---------- 紧急度 ----------
   返回 0~1：0 = 没 deadline / 很远（白），1 = 已过期或马上到期（大红） */
function urgencyOf(deadline, now) {
  if (!deadline) return 0;
  var t = new Date(deadline).getTime();
  if (!isFinite(t)) return 0;
  var ms = t - (now || Date.now());
  if (ms <= 0) return 1;
  var u = 1 - (ms / 3600000) / CFG.urgency.horizonHours;
  u = Math.max(0, Math.min(1, u));
  return Math.pow(u, CFG.urgency.curve);
}

/* 渐变色：白 → 粉 → 大红 */
function urgencyColor(u) {
  u = Math.max(0, Math.min(1, u || 0));
  var it = CFG.urgency.redIntensity;
  var g = Math.round(255 - it * u);
  var b = Math.round(255 - it * CFG.urgency.blueRatio * u);
  return 'rgb(255,' + g + ',' + b + ')';
}
function urgencyTextColor(u) {
  return u >= CFG.urgency.strongTextAt ? '#fff' : '#3E4A46';
}
function urgencyLabel(u, deadline) {
  if (!deadline) return '未设置';
  if (u >= 0.85) return '火烧眉毛';
  if (u >= 0.55) return '有点紧';
  if (u >= 0.25) return '还可以';
  return '还很远';
}

/* deadline 展示文案 */
function deadlineText(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var ds = ymd(d);
  var td = todayStr();
  var day;
  if (ds === td) day = '今天';
  else if (ds === addDays(td, 1)) day = '明天';
  else if (ds === addDays(td, -1)) day = '昨天';
  else day = (d.getMonth() + 1) + '月' + d.getDate() + '日';
  var time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  var overdue = d.getTime() < Date.now();
  return (overdue ? '已过期 · ' : '') + day + ' ' + time;
}

/* deadline 快捷值 */
function quickDeadline(kind, baseStr) {
  var base = parseYmd(baseStr || todayStr());
  if (kind === 'today') { base.setHours(23, 59, 0, 0); return base; }
  if (kind === 'week') {
    var dow = base.getDay();           // 0=周日本周最后一天
    var delta = 6 - ((dow + 6) % 7);   // 以周一为起点算到周日
    base.setDate(base.getDate() + delta);
    base.setHours(23, 59, 0, 0);
    return base;
  }
  if (kind === 'month') {
    var last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    last.setHours(23, 59, 0, 0);
    return last;
  }
  return null;
}

/* datetime-local 拆成 date / time 输入 */
function splitDT(iso) {
  if (!iso) return { date: '', time: '' };
  var d = new Date(iso);
  return { date: ymd(d), time: pad2(d.getHours()) + ':' + pad2(d.getMinutes()) };
}
function joinDT(dateStr, timeStr) {
  if (!dateStr) return null;
  var t = timeStr || '23:59';
  var p = t.split(':');
  var d = parseYmd(dateStr);
  d.setHours(+p[0] || 0, +p[1] || 0, 0, 0);
  return d.toISOString();
}

/* 文本里的链接转成可点 */
function linkify(str) {
  var esc = String(str || '').replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
  return esc.replace(/(https?:\/\/[^\s，。）】]+)/g, function (u) {
    return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
  });
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
}
