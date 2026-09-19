/* ===== 数据层：localStorage 优先 + Supabase 同步 ===== */

var DB = {
  user: null,
  tasks: [],          // {id,title,note,date,deadline,tags,done,doneAt,createdAt,updatedAt}
  tags: CFG.defaultTags.slice(),
  filter: '全部',
  date: todayStr(),
  deleted: []         // 已删除的 id，防止从云端拉回来
};

var SYNC = 'off';
var listeners = [];
function onSync(fn) { listeners.push(fn); }
function setSync(s) { SYNC = s; listeners.forEach(function (f) { f(s); }); }

/* ---------- 本地 ---------- */
function lkey(u) { return 'tdl_data_' + u; }
var storageWarnHook = null;
function onStorageWarn(fn) { storageWarnHook = fn; }

function saveLocal() {
  if (!DB.user) return;
  try {
    localStorage.setItem(lkey(DB.user), JSON.stringify({
      tasks: DB.tasks, tags: DB.tags, deleted: DB.deleted.slice(-200)
    }));
  } catch (e) {
    // 多半是图片太多把 5MB 配额撑爆了。数据还在内存里、也还会推云端，
    // 但下次打开这台设备可能读不回来，所以要提醒。
    if (storageWarnHook) storageWarnHook();
  }
}
/* 老版本生成的 id 不是 UUID（会被数据库拒绝），这里统一换成真 UUID */
function normalizeIds(list) {
  var changed = false;
  (list || []).forEach(function (t) {
    if (!t || isUuid(t.id)) return;
    t.id = uid();
    changed = true;
  });
  return changed;
}

function loadLocal(u) {
  try {
    var raw = localStorage.getItem(lkey(u));
    if (!raw) return null;
    var o = JSON.parse(raw);
    var tasks = o.tasks || [];
    if (normalizeIds(tasks)) {                 // 修好立刻回写，避免反复改 id
      try { localStorage.setItem(lkey(u), JSON.stringify({ tasks: tasks, tags: o.tags || [], deleted: o.deleted || [] })); } catch (e) {}
    }
    return { tasks: tasks, tags: o.tags || CFG.defaultTags.slice(), deleted: o.deleted || [] };
  } catch (e) { return null; }
}

/* 最近登录过的用户名 */
function pushRecent(u) {
  try {
    var arr = JSON.parse(localStorage.getItem('tdl_recent') || '[]');
    arr = arr.filter(function (x) { return x !== u; });
    arr.unshift(u);
    localStorage.setItem('tdl_recent', JSON.stringify(arr.slice(0, 4)));
  } catch (e) {}
}
function getRecent() {
  try { return JSON.parse(localStorage.getItem('tdl_recent') || '[]'); } catch (e) { return []; }
}

/* ---------- 行 <-> 任务 ---------- */
function rowToTask(r) {
  var note = r.note;
  if (typeof note === 'string') { try { note = JSON.parse(note); } catch (e) { note = { text: note }; } }
  note = note || {};
  return {
    id: r.id,
    title: r.title || '',
    note: { text: note.text || '', images: note.images || [], links: note.links || [] },
    date: r.task_date,
    deadline: r.deadline || null,
    tags: Array.isArray(r.tags) ? r.tags : [],
    done: !!r.done,
    doneAt: r.done_at || null,
    createdAt: r.created_at || new Date().toISOString(),
    updatedAt: r.updated_at || new Date().toISOString()
  };
}
function taskToRow(t) {
  return {
    id: t.id,
    username: DB.user,
    title: t.title,
    note: t.note,
    task_date: t.date,
    deadline: t.deadline || null,
    tags: t.tags || [],
    done: t.done,
    done_at: t.doneAt || null,
    created_at: t.createdAt || t.updatedAt || new Date().toISOString(),
    updated_at: t.updatedAt || new Date().toISOString()
  };
}

/* ---------- 云端 ---------- */
async function pullRemote() {
  if (!sb) { setSync('off'); return false; }
  setSync('syncing');
  try {
    var res = await sb.from('todos').select('*').eq('username', DB.user);
    if (res.error) throw res.error;

    var map = {};
    DB.tasks.forEach(function (t) { map[t.id] = t; });
    var delSet = {};
    DB.deleted.forEach(function (id) { delSet[id] = 1; });

    (res.data || []).forEach(function (r) {
      if (delSet[r.id]) return;                 // 本地删过的，不再拉回
      var rt = rowToTask(r);
      var cur = map[rt.id];
      if (!cur || new Date(rt.updatedAt) > new Date(cur.updatedAt)) map[rt.id] = rt;
    });
    DB.tasks = Object.keys(map).map(function (k) { return map[k]; });

    var tg = await sb.from('todo_tags').select('name').eq('username', DB.user);
    if (!tg.error && tg.data) {
      var set = {};
      DB.tags.forEach(function (t) { set[t] = 1; });
      tg.data.forEach(function (r) { set[r.name] = 1; });
      DB.tags = Object.keys(set);
    }
    saveLocal();
    setSync('ok');
    return true;
  } catch (e) {
    console.warn('pull failed:', e && e.message);
    setSync('error');
    return false;
  }
}

/* 同步失败时通知 UI（只提示一次，别刷屏） */
var syncErrorHook = null;
function onSyncError(fn) { syncErrorHook = fn; }
function reportSyncError(msg) { if (syncErrorHook) syncErrorHook(msg); }

async function pushTask(t) {
  if (!sb) return;
  if (!isUuid(t.id)) t.id = uid();
  setSync('syncing');
  try {
    var r = await sb.from('todos').upsert(taskToRow(t), { onConflict: 'id' });
    if (r.error) {
      console.warn('push failed:', r.error.message);
      reportSyncError(r.error.message);
      setSync('error');
    } else {
      setSync('ok');
    }
  } catch (e) { setSync('error'); }
}

/* 登录后把本地全部任务推一遍，保证两个设备能收敛 */
async function pushAll() {
  if (!sb) return;
  for (var i = 0; i < DB.tasks.length; i++) await pushTask(DB.tasks[i]);
  for (var j = 0; j < DB.tags.length; j++) await pushTag(DB.tags[j]);
}

async function removeRemote(id) {
  if (!sb) return;
  try { await sb.from('todos').delete().eq('id', id); } catch (e) {}
}

async function pushTag(name) {
  if (!sb) return;
  try { await sb.from('todo_tags').upsert({ username: DB.user, name: name }, { onConflict: 'username,name' }); } catch (e) {}
}

/* ---------- CRUD ---------- */
function newTask(date) {
  return {
    id: uid(), title: '', note: { text: '', images: [], links: [] },
    date: date, deadline: null, tags: [], done: false, doneAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

function saveTask(t) {
  t.updatedAt = new Date().toISOString();
  var i = DB.tasks.findIndex(function (x) { return x.id === t.id; });
  if (i >= 0) DB.tasks[i] = t; else DB.tasks.push(t);
  var d = DB.deleted.indexOf(t.id);
  if (d >= 0) DB.deleted.splice(d, 1);
  saveLocal();
  pushTask(t);
}

function deleteTask(id) {
  DB.tasks = DB.tasks.filter(function (t) { return t.id !== id; });
  if (DB.deleted.indexOf(id) < 0) DB.deleted.push(id);
  saveLocal();
  removeRemote(id);
}

function toggleDone(t) {
  t.done = !t.done;
  t.doneAt = t.done ? new Date().toISOString() : null;
  saveTask(t);
}

function addTag(name) {
  name = String(name || '').trim();
  if (!name) return false;
  if (DB.tags.indexOf(name) < 0) {
    DB.tags.push(name);
    saveLocal();
    pushTag(name);
    return true;
  }
  return false;
}

/* ---------- 查询 ---------- */
/* 某一天要显示的任务。
   规则：当天自己的任务 + 之前几天没做完的（自动顺延到今天，直到做完为止）。
   不做复制，只有一条记录，所以在原定那天也还看得到。 */
function tasksOf(date) {
  var today = todayStr();
  return DB.tasks.filter(function (t) {
    if (t.date === date) return true;
    return date === today && !t.done && t.date < today;
  });
}
function isCarried(t, viewDate) {
  return !t.done && t.date < viewDate;
}
function visibleTasks(date) {
  var list = tasksOf(date);
  if (DB.filter !== '全部') {
    list = list.filter(function (t) { return (t.tags || []).indexOf(DB.filter) >= 0; });
  }
  var now = Date.now();
  return list.slice().sort(function (a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return new Date(b.doneAt || 0) - new Date(a.doneAt || 0);
    var ua = urgencyOf(a.deadline, now), ub = urgencyOf(b.deadline, now);
    if (Math.abs(ub - ua) > 0.0005) return ub - ua;          // 紧急的在上面
    var da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    var db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    if (da !== db) return da - db;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}
function daysWithTasks() {
  var m = {};
  DB.tasks.forEach(function (t) { if (!t.done) m[t.date] = (m[t.date] || 0) + 1; });
  return m;
}
