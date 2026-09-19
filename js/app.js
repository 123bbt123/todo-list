/* ===== UI ===== */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1900);
  }
  function shake(el) {
    el.style.transition = 'none';
    el.style.transform = 'translateX(-6px)';
    setTimeout(function () { el.style.transition = 'transform .3s'; el.style.transform = 'translateX(6px)'; }, 60);
    setTimeout(function () { el.style.transform = 'translateX(0)'; }, 160);
    setTimeout(function () { el.style.transition = ''; }, 500);
  }
  function show(sel) { $(sel).classList.remove('hidden'); }
  function hide(sel) { $(sel).classList.add('hidden'); }

  /* ---------------- 登录 ---------------- */
  function renderRecent() {
    var arr = getRecent();
    $('#login-recent').innerHTML = arr.length
      ? '<div style="font-size:12px;color:var(--ink-3);width:100%;margin-bottom:4px">最近用过</div>' +
        arr.map(function (u) { return '<button class="recent-chip">' + esc(u) + '</button>'; }).join('')
      : '';
    $$('#login-recent .recent-chip').forEach(function (b) {
      b.onclick = function () { $('#login-input').value = b.textContent; doLogin(); };
    });
  }

  function doLogin() {
    var u = $('#login-input').value.trim();
    if (!u) { shake($('#login-input')); toast('先告诉我你叫啥 🌱'); return; }
    DB.user = u;
    var local = loadLocal(u);
    DB.tasks = local ? local.tasks : [];
    DB.tags = (local && local.tags && local.tags.length) ? local.tags : CFG.defaultTags.slice();
    DB.deleted = local ? local.deleted : [];
    DB.date = todayStr();
    DB.filter = '全部';
    pushRecent(u);
    try { localStorage.setItem('tdl_user', u); } catch (e) {}
    $('#screen-login').classList.add('hidden');
    $('#screen-home').classList.remove('hidden');
    renderHome();
    pullRemote().then(async function (ok) {
      if (ok) {
        await pushAll();            // 本地补推一遍，保证两端收敛
        await migrateImages();      // 把塞在任务里的图片搬到云存储（桶建好后自动生效）
      }
      renderHome();
      if (!ok) {
        setSync('off');
        toast(sb ? '云端表还没建好，先存本地 · 建好后自动同步' : '离线模式，数据存在这台设备上');
      }
    });
  }

  /* 备注里以 base64 形式存着的图片，一旦有了存储桶就自动搬上去 */
  async function migrateImages() {
    if (!sb) return;
    var changed = false;
    for (var i = 0; i < DB.tasks.length; i++) {
      var imgs = (DB.tasks[i].note && DB.tasks[i].note.images) || [];
      for (var j = 0; j < imgs.length; j++) {
        if (!/^data:image\//i.test(imgs[j])) continue;
        var url = await uploadImage(dataURLtoBlob(imgs[j]));
        if (url) { imgs[j] = url; changed = true; }
      }
    }
    if (changed) {
      DB.tasks.forEach(function (t) { saveTask(t); });
      renderHome();
      toast('备注图片已搬到云存储 🖼');
    }
  }

  function dataURLtoBlob(dataUrl) {
    try {
      var parts = dataUrl.split(',');
      var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch (e) { return null; }
  }

  /* ---------------- 首页 ---------------- */
  function renderHome() {
    var d = parseYmd(DB.date);
    $('#btn-date').textContent = fmtDateCN(DB.date);
    $('#btn-today').classList.toggle('off', DB.date !== todayStr());
    $('#cf-month').textContent = (d.getMonth() + 1) + '月';
    $('#cf-num').textContent = d.getDate();
    renderTagbar();
    renderList();
  }

  function renderTagbar() {
    var html = '<button class="tag-chip' + (DB.filter === '全部' ? ' on' : '') + '" data-tag="全部">全部</button>';
    DB.tags.forEach(function (g) {
      var custom = CFG.defaultTags.indexOf(g) < 0;
      html += '<button class="tag-chip' + (DB.filter === g ? ' on' : '') + '" data-tag="' + esc(g) + '">' +
        esc(g) + (custom ? '<span class="del" data-del="' + esc(g) + '">✕</span>' : '') + '</button>';
    });
    html += '<button class="tag-chip add" data-tag="__add">＋ 新标签</button>';
    $('#tagbar').innerHTML = html;
  }

  function cardHtml(t) {
    var u = urgencyOf(t.deadline);
    var col = t.deadline ? urgencyColor(u) : '#FFFFFF';
    var txt = urgencyTextColor(u);
    var h = '<div class="card' + (t.done ? ' done' : '') + '" data-id="' + t.id + '">';
    h += '<span class="accent" style="background:' + (t.deadline ? col : '#E9EFEE') + '"></span>';
    h += '<button class="check' + (t.done ? ' on' : '') + '" data-act="toggle" aria-label="完成"></button>';
    h += '<div class="card-main">';
    h += '<div class="card-title">' + esc(t.title) + '</div>';
    var meta = '';
    if (t.deadline) {
      meta += '<span class="pill" style="background:' + col + ';color:' + txt + ';border:1px solid rgba(0,0,0,.08)">⏰ ' +
        esc(deadlineText(t.deadline)) + '</span>';
    }
    (t.tags || []).forEach(function (g) { meta += '<span class="pill tagpill">#' + esc(g) + '</span>'; });
    if (meta) h += '<div class="card-meta">' + meta + '</div>';
    var note = t.note || {};
    if (note.text) h += '<div class="card-note">' + linkify(note.text) + '</div>';
    if ((note.images || []).length || (note.links || []).length) {
      var row = (note.images || []).map(function (s) {
        return '<img class="thumb" src="' + esc(s) + '" data-act="zoom" alt="">';
      }).join('');
      if (row) h += '<div class="attach-row">' + row + '</div>';
      (note.links || []).forEach(function (l) {
        h += '<a class="link-chip" href="' + esc(l) + '" target="_blank" rel="noopener">🔗 <span>' + esc(hostOf(l)) + '</span></a>';
      });
    }
    h += '</div></div>';
    return h;
  }

  function renderList() {
    var page = $('#page');
    var list = visibleTasks(DB.date);
    var all = tasksOf(DB.date);
    if (!list.length) {
      page.innerHTML = '<div class="empty"><span class="emo">🌿</span>' +
        (all.length ? '这个筛选下没有任务' : '这一天还空着<br>点右上角小日历加一个吧') + '</div>';
      return;
    }
    var undone = list.filter(function (t) { return !t.done; });
    var done = list.filter(function (t) { return t.done; });
    var html = '<div class="day-head"><span>待办 ' + undone.length + ' · 共 ' + all.length + ' 项</span><span>' +
      (DB.filter === '全部' ? '' : '# ' + esc(DB.filter)) + '</span></div>';
    html += undone.map(cardHtml).join('');
    if (done.length) {
      html += '<div class="done-head">已完成 ' + done.length + '</div>' + done.map(cardHtml).join('');
    }
    page.innerHTML = html;
  }

  /* 列表交互 */
  $('#page').addEventListener('click', function (e) {
    if (e.target.closest('a')) return;                 // 链接交給浏览器
    var card = e.target.closest('.card');
    if (!card) return;
    var t = DB.tasks.filter(function (x) { return x.id === card.dataset.id; })[0];
    if (!t) return;
    if (e.target.closest('[data-act="zoom"]')) { openImg(e.target.closest('[data-act="zoom"]').src); return; }
    if (e.target.closest('[data-act="toggle"]')) {
      toggleDone(t);
      renderHome();
      if (t.done) toast('完成一项，很棒 ✿');
      return;
    }
    openTask(t);
  });

  /* ---------------- 左右滑动 ---------------- */
  var animating = false;
  var page = $('#page'), vp = $('#viewport');

  function goDay(dir) {
    if (animating) return;
    animating = true;
    page.style.transition = 'transform .18s ease, opacity .18s ease';
    page.style.transform = 'translateX(' + (-dir * 60) + 'px)';
    page.style.opacity = '.25';
    setTimeout(function () {
      DB.date = addDays(DB.date, dir);
      renderHome();
      page.style.transition = 'none';
      page.style.transform = 'translateX(' + (dir * 60) + 'px)';
      requestAnimationFrame(function () {
        page.style.transition = 'transform .2s ease, opacity .2s ease';
        page.style.transform = 'translateX(0)';
        page.style.opacity = '1';
        setTimeout(function () { animating = false; }, 220);
      });
    }, 180);
  }

  var sx = 0, sy = 0, dragging = false, moved = 0, axis = null;
  vp.addEventListener('pointerdown', function (e) {
    if (e.target.closest('a')) return;
    dragging = true; sx = e.clientX; sy = e.clientY; moved = 0; axis = null;
    page.style.transition = 'none';
  });
  vp.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (!axis && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (axis !== 'x') return;
    moved = dx;
    page.style.transform = 'translateX(' + (dx * 0.4) + 'px)';
    page.style.opacity = String(1 - Math.min(0.35, Math.abs(dx) / 500));
    hideHint();
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    page.style.transition = 'transform .22s ease, opacity .22s ease';
    if (axis === 'x' && Math.abs(moved) > 65) goDay(moved < 0 ? 1 : -1);
    else { page.style.transform = 'translateX(0)'; page.style.opacity = '1'; }
  }
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { vp.addEventListener(ev, endDrag); });

  var hinted = false;
  function hideHint() {
    if (hinted) return; hinted = true;
    $('#swipe-hint').style.opacity = '0';
  }

  /* ---------------- 日历 ---------------- */
  var calCursor = new Date();
  function openCal() {
    calCursor = parseYmd(DB.date);
    renderCal();
    show('#modal-cal');
  }
  function renderCal() {
    var y = calCursor.getFullYear(), m = calCursor.getMonth();
    $('#cal-title').textContent = fmtMonthCN(y, m);
    var startDow = new Date(y, m, 1).getDay();
    var days = new Date(y, m + 1, 0).getDate();
    var prevDays = new Date(y, m, 0).getDate();
    var marks = daysWithTasks();
    var html = '';
    for (var i = 0; i < startDow; i++) html += '<div class="cal-cell out">' + (prevDays - startDow + 1 + i) + '</div>';
    for (var d = 1; d <= days; d++) {
      var s = ymd(new Date(y, m, d));
      var cls = 'cal-cell';
      if (s === todayStr()) cls += ' today';
      if (s === DB.date) cls += ' sel';
      html += '<div class="' + cls + '" data-d="' + s + '">' + d + (marks[s] ? '<span class="dot"></span>' : '') + '</div>';
    }
    var tail = (7 - ((startDow + days) % 7)) % 7;
    for (var k = 1; k <= tail; k++) html += '<div class="cal-cell out">' + k + '</div>';
    $('#cal-grid').innerHTML = html;
  }
  $('#cal-prev').onclick = function () { calCursor.setMonth(calCursor.getMonth() - 1); renderCal(); };
  $('#cal-next').onclick = function () { calCursor.setMonth(calCursor.getMonth() + 1); renderCal(); };
  $('#cal-grid').addEventListener('click', function (e) {
    var cell = e.target.closest('.cal-cell[data-d]');
    if (!cell) return;
    DB.date = cell.dataset.d;
    hide('#modal-cal');
    renderHome();
    openTask(null, DB.date);
  });

  /* ---------------- 任务表单 ---------------- */
  var editing = null, formDate = '', form = { tags: [], images: [], links: [] };

  function openTask(t, date) {
    editing = t || null;
    formDate = date || (t ? t.date : DB.date);
    form = {
      tags: t ? (t.tags || []).slice() : [],
      images: t ? (t.note && t.note.images || []).slice() : [],
      links: t ? (t.note && t.note.links || []).slice() : []
    };
    $('#task-head').textContent = t ? '编辑任务' : '添加 · ' + fmtDateCN(formDate);
    $('#t-title').value = t ? t.title : '';
    $('#t-note').value = t ? (t.note && t.note.text || '') : '';
    var sp = splitDT(t && t.deadline);
    $('#t-date').value = sp.date;
    $('#t-time').value = sp.time;
    $('#t-del').classList.toggle('hidden', !t);
    $('#t-linkrow').classList.add('hidden');
    $('#t-linkurl').value = '';
    renderFormTags();
    renderAttach();
    updateUrgency();
    show('#modal-task');
    setTimeout(function () { if (!t) $('#t-title').focus(); }, 320);
  }

  function renderFormTags() {
    var html = DB.tags.map(function (g) {
      return '<button class="chip' + (form.tags.indexOf(g) >= 0 ? ' on' : '') + '" data-t="' + esc(g) + '">' + esc(g) + '</button>';
    }).join('');
    html += '<button class="chip add" data-t="__new">＋ 新标签</button>';
    $('#t-tags').innerHTML = html;
  }
  $('#t-tags').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    var v = b.dataset.t;
    if (v === '__new') {
      var name = prompt('新标签名字（比如：买菜、健身）');
      if (name && name.trim()) {
        name = name.trim();
        if (addTag(name)) toast('标签已记住 ✿');
        if (form.tags.indexOf(name) < 0) form.tags.push(name);
        renderFormTags();
      }
      return;
    }
    var i = form.tags.indexOf(v);
    if (i >= 0) form.tags.splice(i, 1); else form.tags.push(v);
    renderFormTags();
  });

  function updateUrgency() {
    var iso = joinDT($('#t-date').value, $('#t-time').value);
    var u = urgencyOf(iso);
    var col = iso ? urgencyColor(u) : '#F2F6F5';
    $('#ubar-fill').style.width = Math.round(u * 100) + '%';
    $('#ubar-fill').style.background = iso ? urgencyColor(u) : '#E9EFEE';
    var chip = $('#u-chip');
    chip.textContent = iso ? urgencyLabel(u, iso) : '未设置';
    chip.style.background = col;
    chip.style.color = iso ? urgencyTextColor(u) : '#7C8A85';
    chip.style.border = '1px solid rgba(0,0,0,.08)';
  }
  $('#t-date').oninput = updateUrgency;
  $('#t-time').oninput = updateUrgency;

  $$('.qbtn').forEach(function (b) {
    b.onclick = function () {
      var kind = b.dataset.quick;
      if (kind === 'clear') { $('#t-date').value = ''; $('#t-time').value = ''; }
      else {
        var d = quickDeadline(kind, formDate);
        $('#t-date').value = ymd(d);
        $('#t-time').value = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      }
      updateUrgency();
    };
  });

  /* 备注：图片 / 链接 */
  $('#t-img').onclick = function () { $('#t-file').click(); };
  $('#t-file').addEventListener('change', async function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    for (var i = 0; i < files.length; i++) {
      toast('处理图片中…');
      var blob = await compressImage(files[i]);
      var url = await uploadImage(blob);
      if (!url) {
        url = await toDataURL(blob);
        toast('云端存储没开，图片只存在这台设备');
      }
      if (url) form.images.push(url);
    }
    renderAttach();
  });
  $('#t-link').onclick = function () { $('#t-linkrow').classList.toggle('hidden'); $('#t-linkurl').focus(); };
  $('#t-linkadd').onclick = function () {
    var v = $('#t-linkurl').value.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    form.links.push(v);
    $('#t-linkurl').value = '';
    $('#t-linkrow').classList.add('hidden');
    renderAttach();
  };

  function renderAttach() {
    var html = form.images.map(function (s, i) {
      return '<div class="attach-item"><img src="' + esc(s) + '" alt=""><button class="rm" data-rm="img" data-i="' + i + '">✕</button></div>';
    }).join('');
    html += form.links.map(function (l, i) {
      return '<div class="attach-item"><a class="attach-link" href="' + esc(l) + '" target="_blank" rel="noopener">🔗 <span>' +
        esc(hostOf(l)) + '</span></a><button class="rm" data-rm="link" data-i="' + i + '">✕</button></div>';
    }).join('');
    $('#t-attach').innerHTML = html;
  }
  $('#t-attach').addEventListener('click', function (e) {
    var b = e.target.closest('.rm');
    if (!b) return;
    if (b.dataset.rm === 'img') form.images.splice(+b.dataset.i, 1);
    else form.links.splice(+b.dataset.i, 1);
    renderAttach();
  });

  function saveForm() {
    var title = $('#t-title').value.trim();
    if (!title) { shake($('#t-title')); toast('任务名称是唯一必填的 🌱'); return; }
    var t = editing || newTask(formDate);
    t.title = title;
    t.date = formDate;
    t.deadline = joinDT($('#t-date').value, $('#t-time').value);
    t.tags = form.tags.slice();
    t.note = { text: $('#t-note').value.trim(), images: form.images.slice(), links: form.links.slice() };
    saveTask(t);
    hide('#modal-task');
    DB.date = t.date;
    renderHome();
    toast(editing ? '已更新 ✿' : '加好啦 ✿');
  }
  $('#t-save').onclick = saveForm;
  $('#t-del').onclick = function () {
    if (!editing) return;
    if (!confirm('删除「' + editing.title + '」？')) return;
    deleteTask(editing.id);
    hide('#modal-task');
    renderHome();
    toast('已删除');
  };

  function compressImage(file) {
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var scale = Math.min(1, 1280 / img.width);
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (b) { resolve(b || file); }, 'image/jpeg', 0.82);
        } catch (err) { resolve(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  function toDataURL(blob) {
    return new Promise(function (res) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { res(null); };
      r.readAsDataURL(blob);
    });
  }
  async function uploadImage(blob) {
    if (!sb || !blob) return null;
    try {
      var path = DB.user + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.jpg';
      var up = await sb.storage.from(CFG.bucket).upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) return null;
      return sb.storage.from(CFG.bucket).getPublicUrl(path).data.publicUrl;
    } catch (e) { return null; }
  }

  /* 图片查看 */
  function openImg(src) { $('#img-big').src = src; show('#modal-img'); }

  /* ---------------- 标签筛选 ---------------- */
  $('#tagbar').addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (del) { removeTag(del.dataset.del); return; }
    var chip = e.target.closest('.tag-chip');
    if (!chip) return;
    var v = chip.dataset.tag;
    if (v === '__add') {
      var name = prompt('新标签名字（比如：买菜、健身）');
      if (name && name.trim()) { addTag(name.trim()); renderHome(); toast('标签已记住 ✿'); }
      return;
    }
    DB.filter = v;
    renderHome();
  });

  async function removeTag(name) {
    if (!confirm('删除标签「' + name + '」？任务上的这个标签也会一起去掉。')) return;
    DB.tags = DB.tags.filter(function (x) { return x !== name; });
    DB.tasks.forEach(function (t) {
      if (t.tags && t.tags.indexOf(name) >= 0) { t.tags = t.tags.filter(function (x) { return x !== name; }); saveTask(t); }
    });
    if (DB.filter === name) DB.filter = '全部';
    saveLocal();
    try { if (sb) await sb.from('todo_tags').delete().eq('username', DB.user).eq('name', name); } catch (e) {}
    renderHome();
    toast('标签已删除');
  }

  /* ---------------- 其他事件 ---------------- */
  $('#btn-prev').onclick = function () { goDay(-1); hideHint(); };
  $('#btn-next').onclick = function () { goDay(1); hideHint(); };
  $('#btn-today').onclick = function () { DB.date = todayStr(); renderHome(); };
  $('#btn-date').onclick = openCal;
  $('#fab-add').onclick = openCal;

  $('#login-btn').onclick = doLogin;
  $('#login-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

  $$('[data-close]').forEach(function (el) { el.onclick = function () { hide('#modal-cal'); hide('#modal-task'); hide('#modal-img'); }; });

  document.addEventListener('keydown', function (e) {
    var anyModal = !$('#modal-cal').classList.contains('hidden') || !$('#modal-task').classList.contains('hidden');
    if (e.key === 'Escape') { hide('#modal-cal'); hide('#modal-task'); hide('#modal-img'); }
    if (anyModal || $('#screen-home').classList.contains('hidden')) return;
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft') goDay(-1);
    if (e.key === 'ArrowRight') goDay(1);
  });

  onSync(function (s) {
    var dot = $('#sync-dot');
    dot.className = 'sync-dot ' + s;
    dot.title = s === 'ok' ? '已同步到云端' : s === 'syncing' ? '同步中' : s === 'error' ? '同步失败（数据只在本地）' : '离线';
  });

  var syncErrShown = false;
  onSyncError(function (msg) {
    if (syncErrShown) return;
    syncErrShown = true;
    toast('没同步上去：' + (msg || '云端写入失败'));
  });

  onStorageWarn(function () {
    toast('本地空间满了（图片太多）· 建个 todo-images 存储桶就没事了');
  });

  /* ---------------- 启动 ---------------- */
  $('#logo-num').textContent = new Date().getDate();
  renderRecent();
  try {
    var last = localStorage.getItem('tdl_user');
    if (last) $('#login-input').value = last;
  } catch (e) {}
})();
