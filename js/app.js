// ═══════════════════════════════════════════════════════════════
  // KONFIGURASI SUPABASE  — ganti dengan milik project kamu
  // ═══════════════════════════════════════════════════════════════
  var SUPABASE_URL = 'https://ohpocbtxbdptvuanxnze.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_3mByHkVTPwtukH40bOHvow_sB1WW6og';

  // Aturan (rules) — nilai default; ditimpa oleh tabel settings saat load bila ada.
  var MAX_DURASI = { 'CS': 14, 'KAPTEN': 14, 'KASIR': 12 };
  var MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var MONTHS_ID = ['Januari','Februari','Maret','April','Mei','Juni',
                   'Juli','Agustus','September','Oktober','November','Desember'];
  var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

  // Status yang otomatis pindah ke menu "Sedang Cuti"
  var ONGOING_STATUSES = ['SEDANG CUTI'];
  function isOngoing(task) { return ONGOING_STATUSES.indexOf(String(task || '').toUpperCase()) !== -1; }
  // Status yang otomatis pindah ke menu "Selesai Cuti"
  var ARCHIVED_STATUSES = ['SELESAI CUTI'];
  function isArchived(task) { return ARCHIVED_STATUSES.indexOf(String(task || '').toUpperCase()) !== -1; }

  // Status inti yang otomatisasi aplikasi bergantung padanya (segmentasi menu, cooldown, dll).
  // Teks-teks ini TIDAK boleh diubah di database, atau logika otomatis akan berhenti mengenalinya.
  // Daftar ini selalu tersedia di dropdown status walau konfigurasi TASK di DB tidak lengkap.
  var CORE_STATUSES = ['WAITING', 'DONE CATAT', 'SEDANG CUTI', 'SELESAI CUTI'];

  // Gabungkan konfigurasi TASK dari DB dengan status inti — status inti dijamin selalu ada.
  // Urutan: ikuti CONFIG.TASK, lalu tambahkan status inti yang belum tercantum.
  function taskOptions() {
    var out = [], seen = {};
    (CONFIG.TASK || []).forEach(function(s) {
      var u = String(s).toUpperCase();
      if (!seen[u]) { seen[u] = 1; out.push(s); }
    });
    CORE_STATUSES.forEach(function(s) {
      if (!seen[s]) { seen[s] = 1; out.push(s); }
    });
    return out;
  }

  // Peringatkan admin bila status inti hilang/berubah teksnya di DB (kerusakan senyap → terlihat).
  function checkCoreStatuses() {
    var have = {};
    (CONFIG.TASK || []).forEach(function(s) { have[String(s).toUpperCase()] = 1; });
    var missing = CORE_STATUSES.filter(function(s) { return !have[s]; });
    if (missing.length) {
      toast('⚠ Status inti hilang dari konfigurasi: ' + missing.join(', ') +
        '. Otomatisasi menu bisa terganggu — periksa data TASK di Supabase.', 'err');
    }
  }

  // Jeda wajib setelah cuti selesai sebelum staff boleh mengajukan lagi
  var COOLDOWN_MONTHS = 6;

  // Satu sumber kebenaran: sebuah record milik menu (segmen) yang mana?
  // Dashboard = sisanya (WAITING, DONE CATAT, dll) — jadi tiap record hanya ada di SATU menu.
  function inSegment(r, segment) {
    var t = r.task1;
    if (segment === 'BERJALAN') return isOngoing(t);
    if (segment === 'ARSIP')    return isArchived(t);
    return !isOngoing(t) && !isArchived(t);
  }
  // Perihal yg dihitung bentroknya
  var CLASH_PERIHAL = ['CUTI LOKAL', 'CUTI INDO'];

  // ── Format "Copy" (ubah sesuai kebutuhan) ─────────────────────
  var COPY_HEADER = 'HOKIJITU';        // baris judul paling atas
  var ACC_LDR     = 'VITTO GUNAWAN';   // nama leader yang meng-ACC

  // ── AUTH ADMIN (Supabase Auth) ────────────────────────────────
  // Sesi disimpan di localStorage agar admin tetap login setelah refresh.
  var AUTH_KEY = 'hokijitu_admin_session';
  var AUTH = null;
  var _refreshTimer = null;

  function loadSession() {
    try { var s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); if (s && s.access_token) AUTH = s; }
    catch (e) { AUTH = null; }
  }
  function saveSession(s) { AUTH = s; try { localStorage.setItem(AUTH_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { AUTH = null; try { localStorage.removeItem(AUTH_KEY); } catch (e) {} }
  function startRefreshTimer() {
  if (_refreshTimer) clearInterval(_refreshTimer);   // matikan timer lama dulu
  _refreshTimer = setInterval(function() {
    if (AUTH && AUTH.refresh_token) authRefresh().catch(clearSession);
    else { clearInterval(_refreshTimer); _refreshTimer = null; }
  }, 50 * 60 * 1000);
}
  function isAdmin() { return !!(AUTH && AUTH.access_token); }

  // Login dgn email+password → simpan sesi. Kembalikan Promise.
  function authLogin(email, password) {
    return fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error_description || data.msg || data.error || 'Login gagal');
        saveSession({
          access_token: data.access_token, refresh_token: data.refresh_token,
          expires_at: Date.now() + (data.expires_in || 3600) * 1000,
          email: (data.user && data.user.email) || email
        });
        return AUTH;
      });
    });
  }
  // Perpanjang sesi dgn refresh_token (token akses Supabase kedaluwarsa ~1 jam)
  function authRefresh() {
    if (!AUTH || !AUTH.refresh_token) return Promise.reject(new Error('no session'));
    return fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: AUTH.refresh_token })
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok || !data.access_token) throw new Error('refresh gagal');
        saveSession({
          access_token: data.access_token, refresh_token: data.refresh_token,
          expires_at: Date.now() + (data.expires_in || 3600) * 1000,
          email: (data.user && data.user.email) || AUTH.email
        });
        return AUTH;
      });
    });
  }
    function ensureToken() {
    if (!AUTH || !AUTH.access_token) return Promise.resolve();
    if (AUTH.expires_at && AUTH.expires_at < Date.now() + 300000) {
      return authRefresh().catch(function() { clearSession(); });
    }
    return Promise.resolve();
  }
  function sbFetchRetry(fn) {
    return ensureToken().then(fn).then(function(res) {
      if (res.status !== 401) return res;
      return authRefresh().then(fn).catch(function() { return res; });
    });
  }
  function authLogout() {
    if (AUTH && AUTH.access_token) {
      fetch(SUPABASE_URL + '/auth/v1/logout', {
        method: 'POST', headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + AUTH.access_token }
      }).catch(function() {});
    }
    clearSession();
  }

  // ── UI login ──────────────────────────────────────────────────
  function applyAuthUI() {
    var admin = isAdmin();
    document.body.classList.toggle('is-admin', admin);
    var loginBtn = document.getElementById('loginBtn');
    var status = document.getElementById('authStatus');
    if (loginBtn) loginBtn.style.display = admin ? 'none' : '';
    if (status) status.style.display = admin ? '' : 'none';
    if (admin) { var em = document.getElementById('authEmail'); if (em) em.textContent = (AUTH && AUTH.email) || 'Admin'; }
  }
  function openLogin() {
    document.getElementById('loginMsg').textContent = '';
    document.getElementById('loginMsg').className = 'msg';
    document.getElementById('loginOverlay').classList.add('open');
    setTimeout(function(){ var e=document.getElementById('loginEmail'); if(e) e.focus(); }, 50);
  }
  function closeLogin() { document.getElementById('loginOverlay').classList.remove('open'); }
  function doLogout() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    authLogout(); applyAuthUI();
    toast('Anda keluar dari mode admin', 'ok');
    logActivity('AUTH', 'LOGOUT', 'Admin logout');
    // Muat ulang tampilan agar kontrol admin & tab rekening tersembunyi kembali
    invalidate(); switchTab('dashboard');
  }
  function submitLogin() {
    var email = document.getElementById('loginEmail').value.trim();
    var pass = document.getElementById('loginPass').value;
    var msg = document.getElementById('loginMsg');
    if (!email || !pass) { msg.className = 'msg error'; msg.textContent = 'Isi email dan password.'; return; }
    var btn = document.getElementById('loginSubmit');
    btn.disabled = true; btn.textContent = 'Masuk…';
    authLogin(email, pass).then(function() {
      btn.disabled = false; btn.textContent = 'Masuk';
      document.getElementById('loginPass').value = '';
      closeLogin(); applyAuthUI();
      toast('Berhasil masuk sebagai admin', 'ok');
      logActivity('AUTH', 'LOGIN', 'Admin login: ' + email);
      if (AUTH && AUTH.refresh_token) startRefreshTimer();
      invalidate(); loadDashboard(true);   // muat ulang agar kontrol admin muncul
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = 'Masuk';
      msg.className = 'msg error'; msg.textContent = 'Login gagal: ' + err.message;
    });
  }

  // ── Supabase REST helpers ─────────────────────────────────────
  function sbHeaders(extra) {
    // Saat login admin, pakai token user (role 'authenticated') agar lolos RLS admin.
    // Tanpa login, pakai anon key (role 'anon') — hanya boleh lihat & ajukan.
    var bearer = (AUTH && AUTH.access_token) ? AUTH.access_token : SUPABASE_KEY;
    var h = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + bearer, 'Content-Type': 'application/json' };
    if (extra) Object.keys(extra).forEach(function(k) { h[k] = extra[k]; });
    return h;
  }
  function sbGet(table, qs) {
    var url = SUPABASE_URL + '/rest/v1/' + table + (qs ? '?' + qs : '');
    return sbFetchRetry(function() {
      return fetch(url, { headers: sbHeaders() });
    }).then(function(res) {
      if (!res.ok) return res.text().then(function(t) { throw new Error(t || 'HTTP ' + res.status); });
      return res.json();
    });
  }
  function sbPost(table, data, extra) {
    return sbFetchRetry(function() {
      return fetch(SUPABASE_URL + '/rest/v1/' + table, {
        method: 'POST', headers: sbHeaders(extra), body: JSON.stringify(data)
      });
    }).then(function(res) {
      if (!res.ok) return res.text().then(function(t) { throw new Error(t || 'HTTP ' + res.status); });
      return res.text().then(function(t) { return t ? JSON.parse(t) : null; });
    });
  }
  function sbPatch(table, filter, data) {
    return sbFetchRetry(function() {
      return fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + filter, {
        method: 'PATCH', headers: sbHeaders({ 'Prefer': 'return=minimal' }), body: JSON.stringify(data)
      });
    }).then(function(res) {
      if (!res.ok) return res.text().then(function(t) { throw new Error(t || 'HTTP ' + res.status); });
      return null;
    });
  }
  // DELETE memakai return=representation agar kita tahu baris mana yang BENAR-BENAR
  // terhapus. Dengan return=minimal, Supabase tetap membalas sukses walau 0 baris
  // terhapus (mis. diblokir izin/RLS) — itu menyesatkan.
  function sbDelete(table, filter) {
    return sbFetchRetry(function() {
      return fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + filter, {
        method: 'DELETE', headers: sbHeaders({ 'Prefer': 'return=representation' })
      });
    }).then(function(res) {
      if (!res.ok) return res.text().then(function(t) { throw new Error(t || 'HTTP ' + res.status); });
      return res.text().then(function(t) { return t ? JSON.parse(t) : []; });
    });
  }

  // ── Utilities ─────────────────────────────────────────────────
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function formatDate(iso) {
    if (!iso) return '';
    var s = String(iso).trim();
    if (s.length > 10) s = s.slice(0, 10);
    var p = s.split('-');
    if (p.length !== 3) return s;
    return parseInt(p[2]) + ' ' + MONTHS[parseInt(p[1]) - 1] + ' ' + parseInt(p[0]);
  }
  function formatDateShort(iso) {
    if (!iso) return '';
    var s = String(iso).trim();
    if (s.length > 10) s = s.slice(0, 10);
    var p = s.split('-');
    if (p.length !== 3) return s;
    return parseInt(p[2]) + ' ' + MONTHS_SHORT[parseInt(p[1]) - 1] + ' ' + parseInt(p[0]);
  }
  function dayKey(iso) {
    if (!iso) return 0;
    var p = String(iso).slice(0,10).split('-');
    if (p.length !== 3) return 0;
    return Math.round(Date.UTC(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2])) / 86400000);
  }
  // Tanggal hari ini sebagai 'YYYY-MM-DD' (waktu lokal pengguna)
  function todayISO() {
    var n = new Date();
    function p(x) { return String(x).padStart(2, '0'); }
    return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate());
  }
  // Tambah n bulan ke sebuah tanggal ISO, aman terhadap bulan pendek.
  // Contoh: 31 Agu + 6 bln = 28/29 Feb (bukan meluber ke Maret).
  function addMonthsISO(iso, n) {
    var s = String(iso).slice(0, 10).split('-');
    if (s.length !== 3) return '';
    var y = parseInt(s[0]), m = parseInt(s[1]) - 1, d = parseInt(s[2]);
    var total = m + n, ny = y + Math.floor(total / 12), nm = ((total % 12) + 12) % 12;
    var lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();  // hari terakhir bulan target
    var nd = Math.min(d, lastDay);
    function p(x) { return String(x).padStart(2, '0'); }
    return ny + '-' + p(nm + 1) + '-' + p(nd);
  }
  // Suffix acak yang praktis mustahil bertabrakan (12 karakter dari crypto bila ada).
  // Dipakai sebagai ekor ID agar dua pengajuan di detik yang sama tetap unik.
  function randSuffix(len) {
    len = len || 12;
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // tanpa 0/O/1/I agar mudah dibaca
    var out = '';
    if (window.crypto && crypto.getRandomValues) {
      var buf = new Uint8Array(len);
      crypto.getRandomValues(buf);
      for (var i = 0; i < len; i++) out += chars[buf[i] % chars.length];
    } else {
      for (var j = 0; j < len; j++) out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }
  function genId() {
    var now = new Date();
    function pad(n) { return String(n).padStart(2, '0'); }
    // Timestamp (mudah dibaca) + suffix acak 12 karakter (anti-tabrakan)
    return 'CUTI-' + now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '-' +
      pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '-' + randSuffix(12);
  }

  // ── Data logic ────────────────────────────────────────────────
  function getConfig() {
    return sbGet('dropdown_options', 'select=category,value&order=id.asc').then(function(rows) {
      var cfg = { ROLE: [], PERIHAL: [], KETERANGAN: [], TAMBAHAN: [], TASK: [], LDR: [], BANK: [], TASK_REK: [], TASK_RESIGN: [], STAFF: [] };
      rows.forEach(function(r) { if (cfg[r.category]) cfg[r.category].push(r.value); });
      return cfg;
    });
  }
  function getCuti() {
    var cols = 'id,id_pengajuan,created_at,role,nama,start1,end1,start2,end2,durasi1,durasi2,perihal1,perihal2,keterangan,tambahan,task1';
    return sbGet('cuti', 'select=' + cols + '&order=created_at.desc').then(function(rows) {
      return rows.map(function(r) {
        return {
          rowId: r.id, id: r.id_pengajuan || r.id, timestamp: r.created_at || '',
          role: r.role || '', nama: r.nama || '',
          start1Raw: r.start1 || null, end1Raw: r.end1 || null,
          start2Raw: r.start2 || null, end2Raw: r.end2 || null,
          start1: formatDate(r.start1), end1: formatDate(r.end1),
          start2: formatDate(r.start2), end2: formatDate(r.end2),
          durasi1: r.durasi1 || '', perihal1: r.perihal1 || '',
          durasi2: r.durasi2 || '', perihal2: r.perihal2 || '',
          keterangan: r.keterangan || '', tambahan: r.tambahan || 'Tidak Ada',
          task1: r.task1 || 'WAITING'
        };
      });
    });
  }

  // Ambil jumlah hari dari teks tambahan, mis. "Penambahan 2 Hari ..." → 2
  function parseTambahanDays(str) {
    var s = String(str || '');
    if (!s || /tidak ada/i.test(s)) return 0;
    var m = s.match(/penambahan\s+(\d+)\s*hari/i) || s.match(/(\d+)\s*hari/i);
    return m ? parseInt(m[1], 10) : 0;
  }
  // Ambil angka dari teks durasi, mis. "7 Hari" → 7 (termasuk tanda minus bila ada,
  // mis. "-4 Hari" → -4 — dulu regex-nya tidak menangkap "-" sehingga durasi negatif
  // yang salah hitung terbaca sebagai angka positif dan mencemari statistik total
  // hari secara diam-diam; lihat catatan audit bug #4. Durasi negatif seharusnya
  // sudah dicegah masuk lewat validateLeaves(), ini cuma jaring pengaman tambahan.
  function parseDurasi(str) {
    var m = String(str || '').match(/-?\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }
  // Total cuti = jumlah hari rentang tanggal (cuti 1 + cuti 2).
  // extra = berapa hari dari jatah tambahan yang benar-benar terpakai
  // (yaitu kelebihan di atas batas normal role), BUKAN ditambahkan lagi ke total.
  function computeTotal(durasiList, tambahan, role) {
    var max = MAX_DURASI[role] || 0;
    var allowance = parseTambahanDays(tambahan);
    var total = 0, lebih = 0;
    (durasiList || []).forEach(function(d) {
      var n = (typeof d === 'number' ? d : parseDurasi(d));
      total += n;
      if (max) lebih += Math.max(0, n - max);
    });
    var used = Math.min(lebih, allowance);
    return { total: total, base: total - used, extra: used, allowance: allowance };
  }

  // Validasi daftar cuti → kembalikan durasi[] atau lempar Error
  function validateLeaves(role, leaves, extraDays) {
    if (!MAX_DURASI[role]) throw new Error('Role tidak valid.');
    extraDays = extraDays || 0;
    var max = MAX_DURASI[role];
    var limit = max + extraDays;          // batas efektif setelah penambahan
    var durasi = [], totalLebih = 0;
    for (var i = 0; i < leaves.length; i++) {
      var lv = leaves[i];
      if (!lv.perihal || lv.perihal === ADD) throw new Error('Pilih perihal untuk semua cuti.');
      if (!lv.start || !lv.end) throw new Error('Isi tanggal mulai dan selesai untuk semua cuti.');
      var days = dayKey(lv.end) - dayKey(lv.start) + 1;
      if (days <= 0) throw new Error('Tanggal selesai tidak boleh sebelum tanggal mulai.');
      if (days > limit) {
        throw new Error(extraDays > 0
          ? 'Durasi maksimal role ' + role + ' adalah ' + max + ' hari + tambahan ' + extraDays +
            ' hari = ' + limit + ' hari. Diajukan: ' + days + ' hari.'
          : 'Durasi maksimal role ' + role + ' adalah ' + max + ' hari. Diajukan: ' + days +
            ' hari. Pilih "Tambahan Cuti" bila ingin melebihi batas ini.');
      }
      totalLebih += Math.max(0, days - max);
      durasi.push(days);
    }
    // Hari tambahan adalah jatah bersama, tidak berlaku ganda untuk 2 cuti
    if (totalLebih > extraDays) {
      throw new Error('Kelebihan durasi ' + totalLebih + ' hari melebihi tambahan yang dipilih (' +
        extraDays + ' hari). Pilih tambahan yang lebih besar atau kurangi tanggal.');
    }
    if (leaves.length === 2 && leaves[0].perihal === leaves[1].perihal)
      throw new Error('Jika mengajukan 2 cuti, perihalnya harus berbeda.');
    return durasi;
  }

  // Cek apakah staff masih punya pengajuan aktif
  // Periksa apakah `nama` boleh mengajukan cuti baru.
  // Mengembalikan null bila boleh, atau objek { kind, ... } bila diblokir:
  //   kind 'active'   → masih ada cuti berjalan (WAITING/SEDANG CUTI)
  //   kind 'cooldown' → cuti terakhir selesai, tapi belum lewat 6 bulan
  function checkEligibility(nama, cutiStartDate) {
    var qs = 'select=id_pengajuan,nama,task1,start1,end1,start2,end2&nama=eq.' + encodeURIComponent(nama);
    return sbGet('cuti', qs).then(function(rows) {
      // 1) Masih ada pengajuan yang BELUM selesai? (WAITING, DONE CATAT, SEDANG CUTI, dll)
      //    Selama ada, staff tak boleh mengajukan ulang — cukup edit yang sudah ada.
      var active = rows.filter(function(r) { return !isArchived(r.task1); });
      if (active.length) {
        var latest = '';
        active.forEach(function(r) { [r.end1, r.end2].forEach(function(d) { if (d && d > latest) latest = d; }); });
        return { kind: 'active', status: active[0].task1, until: latest };
      }

      // 2) Jeda 6 bulan sejak cuti terakhir SELESAI
      //    Bandingkan tanggal MULAI CUTI yang diajukan, bukan tanggal hari ini
      var lastEnd = '';
      rows.forEach(function(r) {
        if (!isArchived(r.task1)) return;
        [r.end1, r.end2].forEach(function(d) { if (d && d > lastEnd) lastEnd = d; });
      });
      if (lastEnd) {
        var bolehLagi = addMonthsISO(lastEnd, COOLDOWN_MONTHS);
        var checkDate = cutiStartDate || todayISO();
        if (dayKey(checkDate) < dayKey(bolehLagi)) {
          return { kind: 'cooldown', lastEnd: lastEnd, eligibleOn: bolehLagi };
        }
      }
      return null;   // boleh mengajukan
    });
  }

  function buildRowPayload(id, role, nama, keterangan, tambahan, leaves, durasi, task1) {
    var c1 = leaves[0] || {}, c2 = leaves[1] || {};
    return {
      id: id, id_pengajuan: id, role: role, nama: nama,
      start1: c1.start || null, end1: c1.end || null,
      durasi1: durasi[0] ? durasi[0] + ' Hari' : '', perihal1: c1.perihal || '',
      start2: c2.start || null, end2: c2.end || null,
      durasi2: durasi[1] ? durasi[1] + ' Hari' : '', perihal2: c2.perihal || '',
      keterangan: String(keterangan || ''), tambahan: String(tambahan || 'Tidak Ada'),
      task1: task1 || 'WAITING'
    };
  }

  function addOption(category, value) {
    return sbPost('dropdown_options', { category: category, value: value },
      { 'Prefer': 'resolution=ignore-duplicates,return=minimal' }).then(function() {
      if (CONFIG[category] && CONFIG[category].indexOf(value) === -1) CONFIG[category].push(value);
      return CONFIG;
    });
  }
  // Ubah teks sebuah opsi dropdown (mis. perbaiki typo nama staff)
  function renameOption(category, oldVal, newVal) {
    var f = 'category=eq.' + encodeURIComponent(category) + '&value=eq.' + encodeURIComponent(oldVal);
    return sbPatch('dropdown_options', f, { value: newVal }).then(function() {
      if (CONFIG[category]) {
        var i = CONFIG[category].indexOf(oldVal);
        if (i !== -1) CONFIG[category][i] = newVal;
      }
      return CONFIG;
    });
  }
  // Hapus sebuah opsi dropdown
  function removeOption(category, value) {
    var f = 'category=eq.' + encodeURIComponent(category) + '&value=eq.' + encodeURIComponent(value);
    return sbDelete('dropdown_options', f).then(function(rows) {
      if (CONFIG[category]) CONFIG[category] = CONFIG[category].filter(function(v) { return v !== value; });
      return { cfg: CONFIG, deleted: (rows || []).length };
    });
  }

  // ── Clash (bentrok) ───────────────────────────────────────────
  // Indeks bentrok: dikelompokkan per ROLE (CUTI LOKAL & INDO digabung), supaya
  // "berapa orang role X yang cuti" dihitung menyeluruh — apa pun label lokal/indo-nya.
  function buildClashIndex(rows) {
    var idx = {};
    rows.forEach(function(r) {
      [[r.perihal1, r.start1Raw, r.end1Raw], [r.perihal2, r.start2Raw, r.end2Raw]].forEach(function(t) {
        if (CLASH_PERIHAL.indexOf(t[0]) !== -1 && t[1] && t[2]) {
          var k = r.role;   // kunci hanya role → LOKAL & INDO satu kelompok
          (idx[k] = idx[k] || []).push({ nama: r.nama, role: r.role, perihal: t[0], s: dayKey(t[1]), e: dayKey(t[2]) });
        }
      });
    });
    return idx;
  }
  // Indeks di-cache; hanya dibangun ulang saat data berubah
  var _clashIdx = null;
  function clashIndex() {
    if (!_clashIdx) _clashIdx = buildClashIndex(_cache || []);
    return _clashIdx;
  }
  function clashInfo(perihal, startRaw, endRaw, nama, index, role) {
    if (CLASH_PERIHAL.indexOf(perihal) === -1 || !startRaw || !endRaw) return null;
    var s = dayKey(startRaw), e = dayKey(endRaw);
    var list = (index && index[role]) || [];
    // Saring dulu: hanya kandidat (role & perihal sama) yang rentangnya beririsan
    var cand = [], others = [];
    for (var i = 0; i < list.length; i++) {
      var iv = list[i];
      if (iv.nama === nama || iv.s > e || iv.e < s) continue;
      cand.push(iv);
      if (others.indexOf(iv.nama) === -1) others.push(iv.nama);
    }
    if (!cand.length) return { count: 1, names: [] };
    // Cari hari tersibuk (jumlah staff berbeda terbanyak, termasuk diri sendiri)
    var maxConcurrent = 1;
    for (var d = s; d <= e; d++) {
      var onDay = {}; onDay[nama] = 1;
      for (var j = 0; j < cand.length; j++) {
        var c2 = cand[j];
        if (c2.s <= d && d <= c2.e) onDay[c2.nama] = 1;
      }
      var n = Object.keys(onDay).length;
      if (n > maxConcurrent) maxConcurrent = n;
    }
    return { count: maxConcurrent, names: others };
  }

  // ── GERBANG VALIDASI BENTROK (blokir pengajuan sebelum tersimpan) ──
  // Memakai ulang CLASH_PERIHAL, dayKey, dan semantik interval yang sama dengan
  // indeks bentrok di atas — bukan sistem kedua. Aturan per role:
  //   • KAPTEN      : maks 1 orang/tanggal → 1 hari bertabrakan saja sudah ditolak.
  //   • CS & KASIR  : maks 2 orang/tanggal, DAN durasi bentrok berpasangan maks 3 hari.
  // Hanya CUTI LOKAL & CUTI INDO yang dihitung; LOKAL vs INDO dipisah (sesuai kolom Bentrok).
  var CLASH_MAX_PEOPLE = { CS: 2, KASIR: 2, KAPTEN: 1 };
  var CLASH_MAX_OVERLAP_DAYS = 3;

  // Background dashboard (gambar custom + opacity) — nilai default; ditimpa oleh tabel settings.
  var BG_IMAGE = '';
  var BG_OPACITY = 100;

  // ── Aturan dari tabel settings (bisa diedit admin) ────────────
  // Muat nilai aturan dari DB & terapkan ke konstanta yang dipakai validasi.
  function loadRules() {
    return sbGet('settings', 'select=key,value').then(function(rows) {
      var m = {};
      (rows || []).forEach(function(r) { m[r.key] = r.value; });
      function num(k, def) { var v = parseInt(m[k], 10); return isNaN(v) ? def : v; }
      COOLDOWN_MONTHS = num('cooldown_months', COOLDOWN_MONTHS);
      CLASH_MAX_OVERLAP_DAYS = num('clash_max_overlap_days', CLASH_MAX_OVERLAP_DAYS);
      CLASH_MAX_PEOPLE.CS = num('clash_max_people_cs', CLASH_MAX_PEOPLE.CS);
      CLASH_MAX_PEOPLE.KASIR = num('clash_max_people_kasir', CLASH_MAX_PEOPLE.KASIR);
      CLASH_MAX_PEOPLE.KAPTEN = num('clash_max_people_kapten', CLASH_MAX_PEOPLE.KAPTEN);
      MAX_DURASI.CS = num('max_durasi_cs', MAX_DURASI.CS);
      MAX_DURASI.KAPTEN = num('max_durasi_kapten', MAX_DURASI.KAPTEN);
      MAX_DURASI.KASIR = num('max_durasi_kasir', MAX_DURASI.KASIR);
      // Background dashboard (opsional — kolom baru dari background_setup.sql)
      BG_IMAGE = m.bg_image || '';
      BG_OPACITY = num('bg_opacity', BG_OPACITY);
      applyBackground();
      return m;
    }).catch(function() { return {}; });   // tabel belum ada → pakai default, jangan gagalkan app
  }
  // Simpan satu aturan (admin). Kembalikan Promise.
  function saveRule(key, value) {
    return sbPatch('settings', 'key=eq.' + encodeURIComponent(key), { value: String(value) });
  }

  // ── UI editor aturan ──────────────────────────────────────────
  var RULE_FIELDS = [
    ['rule_cooldown_months', function(){return COOLDOWN_MONTHS;}],
    ['rule_clash_max_overlap_days', function(){return CLASH_MAX_OVERLAP_DAYS;}],
    ['rule_clash_max_people_cs', function(){return CLASH_MAX_PEOPLE.CS;}],
    ['rule_clash_max_people_kasir', function(){return CLASH_MAX_PEOPLE.KASIR;}],
    ['rule_clash_max_people_kapten', function(){return CLASH_MAX_PEOPLE.KAPTEN;}],
    ['rule_max_durasi_cs', function(){return MAX_DURASI.CS;}],
    ['rule_max_durasi_kasir', function(){return MAX_DURASI.KASIR;}],
    ['rule_max_durasi_kapten', function(){return MAX_DURASI.KAPTEN;}]
  ];
  function openRules() {
    if (!isAdmin()) return;
    RULE_FIELDS.forEach(function(f) { var el = document.getElementById(f[0]); if (el) el.value = f[1](); });
    var m = document.getElementById('rulesMsg'); m.className = 'msg'; m.textContent = '';
    document.getElementById('rulesOverlay').classList.add('open');
  }
  function closeRules() { document.getElementById('rulesOverlay').classList.remove('open'); }
  function submitRules() {
    if (!isAdmin()) return;
    var msg = document.getElementById('rulesMsg');
    // Kumpulkan & validasi (semua bilangan bulat ≥ batas minimal wajar)
    var vals = {};
    for (var i = 0; i < RULE_FIELDS.length; i++) {
      var id = RULE_FIELDS[i][0];
      var raw = document.getElementById(id).value.trim();
      var n = parseInt(raw, 10);
      var minVal = (id === 'rule_cooldown_months') ? 0 : 1;   // cooldown boleh 0, sisanya ≥1
      if (raw === '' || isNaN(n) || n < minVal) {
        msg.className = 'msg error'; msg.textContent = 'Nilai tidak valid pada salah satu kolom (minimal ' + minVal + ').';
        return;
      }
      vals[id.replace('rule_', '')] = n;
    }
    var btn = document.getElementById('rulesSave');
    btn.disabled = true; btn.textContent = 'Menyimpan…';
    // Simpan semua key paralel
    var keys = Object.keys(vals);
    Promise.all(keys.map(function(k) { return saveRule(k, vals[k]); })).then(function() {
      // Terapkan langsung ke konstanta di memori
      COOLDOWN_MONTHS = vals.cooldown_months;
      CLASH_MAX_OVERLAP_DAYS = vals.clash_max_overlap_days;
      CLASH_MAX_PEOPLE.CS = vals.clash_max_people_cs;
      CLASH_MAX_PEOPLE.KASIR = vals.clash_max_people_kasir;
      CLASH_MAX_PEOPLE.KAPTEN = vals.clash_max_people_kapten;
      MAX_DURASI.CS = vals.max_durasi_cs;
      MAX_DURASI.KASIR = vals.max_durasi_kasir;
      MAX_DURASI.KAPTEN = vals.max_durasi_kapten;
      btn.disabled = false; btn.textContent = '💾 Simpan aturan';
      closeRules(); toast('Aturan diperbarui', 'ok');
      if (typeof updateTotalBox === 'function') updateTotalBox();   // segarkan catatan batas durasi
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '💾 Simpan aturan';
      msg.className = 'msg error'; msg.textContent = 'Gagal menyimpan: ' + err.message;
    });
  }

  // ── BACKGROUND DASHBOARD (gambar custom + opacity, admin) ──────
  // Terapkan BG_IMAGE & BG_OPACITY yang sedang aktif ke layer di belakang halaman.
  function applyBackground() {
    var layer = document.getElementById('appBgLayer');
    if (!layer) return;
    layer.style.backgroundImage = BG_IMAGE ? 'url(' + BG_IMAGE + ')' : 'none';
    layer.style.opacity = String(Math.max(0, Math.min(100, BG_OPACITY)) / 100);
  }

  var _bgPendingImage = null;   // null = belum diubah dari yang tersimpan; '' = akan dihapus
  var _bgPendingOpacity = null;

  function bgPreviewRefresh() {
    var box = document.getElementById('bgPreviewBox');
    if (!box) return;
    var img = (_bgPendingImage !== null) ? _bgPendingImage : BG_IMAGE;
    if (img) { box.style.backgroundImage = 'url(' + img + ')'; box.textContent = ''; }
    else { box.style.backgroundImage = 'none'; box.textContent = 'Belum ada gambar'; }
  }

  function openBgSettings() {
    if (!isAdmin()) return;
    _bgPendingImage = null; _bgPendingOpacity = null;
    document.getElementById('bg_file').value = '';
    document.getElementById('bg_opacity').value = BG_OPACITY;
    document.getElementById('bg_opacity_val').textContent = BG_OPACITY + '%';
    var sizeMsg = document.getElementById('bgSizeMsg'); sizeMsg.className = 'msg'; sizeMsg.textContent = '';
    var m = document.getElementById('bgMsg'); m.className = 'msg'; m.textContent = '';
    bgPreviewRefresh();
    document.getElementById('bgOverlay').classList.add('open');
  }
  function closeBgSettings() { document.getElementById('bgOverlay').classList.remove('open'); }

  // Ubah ukuran & kompres gambar via canvas supaya string base64 yang disimpan tetap ringan.
  // Mencoba beberapa kualitas JPEG berurutan sampai ukurannya wajar untuk disimpan di kolom TEXT.
  function compressImage(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function() { reject(new Error('Gagal membaca file gambar')); };
      reader.onload = function() {
        var img = new Image();
        img.onerror = function() { reject(new Error('File bukan gambar yang valid')); };
        img.onload = function() {
          var MAX_DIM = 1920;
          var w = img.naturalWidth, h = img.naturalHeight;
          if (w > MAX_DIM || h > MAX_DIM) {
            var scale = Math.min(MAX_DIM / w, MAX_DIM / h);
            w = Math.round(w * scale); h = Math.round(h * scale);
          }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          var qualities = [0.75, 0.6, 0.45, 0.3];
          var LIMIT = 1500000;   // ~1.5MB string base64 — batas aman untuk kolom settings.value
          var out = null;
          for (var i = 0; i < qualities.length; i++) {
            var candidate = canvas.toDataURL('image/jpeg', qualities[i]);
            out = candidate;
            if (candidate.length <= LIMIT) break;
          }
          if (out.length > LIMIT) { reject(new Error('Gambar masih terlalu besar setelah dikompres. Coba gambar dengan resolusi lebih kecil.')); return; }
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  document.getElementById('bg_file').addEventListener('change', function() {
    var file = this.files && this.files[0];
    var sizeMsg = document.getElementById('bgSizeMsg');
    if (!file) return;
    sizeMsg.className = 'msg'; sizeMsg.textContent = 'Memproses gambar…';
    compressImage(file).then(function(dataUrl) {
      _bgPendingImage = dataUrl;
      bgPreviewRefresh();
      sizeMsg.className = 'msg success';
      sizeMsg.textContent = 'Gambar siap (' + Math.round(dataUrl.length / 1024) + ' KB setelah dikompres).';
    }).catch(function(err) {
      sizeMsg.className = 'msg error'; sizeMsg.textContent = err.message;
    });
  });

  document.getElementById('bg_opacity').addEventListener('input', function() {
    _bgPendingOpacity = parseInt(this.value, 10);
    document.getElementById('bg_opacity_val').textContent = _bgPendingOpacity + '%';
  });

  document.getElementById('bgRemoveBtn').addEventListener('click', function() {
    _bgPendingImage = '';
    document.getElementById('bg_file').value = '';
    var sizeMsg = document.getElementById('bgSizeMsg'); sizeMsg.className = 'msg'; sizeMsg.textContent = '';
    bgPreviewRefresh();
  });

  document.getElementById('bgSaveBtn').addEventListener('click', function() {
    if (!isAdmin()) return;
    var msg = document.getElementById('bgMsg');
    var newImage = (_bgPendingImage !== null) ? _bgPendingImage : BG_IMAGE;
    var newOpacity = (_bgPendingOpacity !== null) ? _bgPendingOpacity : BG_OPACITY;
    var btn = this;
    btn.disabled = true; btn.textContent = 'Menyimpan…';
    Promise.all([saveRule('bg_image', newImage), saveRule('bg_opacity', newOpacity)]).then(function() {
      BG_IMAGE = newImage; BG_OPACITY = newOpacity;
      applyBackground();
      btn.disabled = false; btn.textContent = '💾 Simpan';
      closeBgSettings(); toast('Background diperbarui', 'ok');
      logActivity('CUTI', 'UPDATE', 'Ubah background dashboard');
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '💾 Simpan';
      msg.className = 'msg error'; msg.textContent = 'Gagal menyimpan: ' + err.message +
        ' — pastikan sudah menjalankan background_setup.sql di Supabase.';
    });
  });

  document.getElementById('bgOverlay').addEventListener('click', function(e) { if (e.target === this) closeBgSettings(); });

  // Ambil interval cuti dari server untuk sebuah role (data TERKINI, bukan cache).
  // CUTI LOKAL & INDO DIGABUNG jadi satu daftar — yang dihitung adalah "berapa orang
  // role ini yang cuti", tanpa peduli label lokal/indo.
  function fetchRoleClashPool(role) {
    var qs = 'select=nama,perihal1,start1,end1,perihal2,start2,end2&role=eq.' + encodeURIComponent(role);
    return sbGet('cuti', qs).then(function(rows) {
      var pool = [];   // [{nama, s, e}]
      rows.forEach(function(r) {
        [[r.perihal1, r.start1, r.end1], [r.perihal2, r.start2, r.end2]].forEach(function(t) {
          if (CLASH_PERIHAL.indexOf(t[0]) !== -1 && t[1] && t[2]) {
            pool.push({ nama: r.nama, s: dayKey(t[1]), e: dayKey(t[2]) });
          }
        });
      });
      return pool;
    });
  }

  // Validasi satu pengajuan terhadap pool. Kembalikan null bila lolos, atau string alasan bila ditolak.
  // newSlots: [{perihal, s, e}] dari pengajuan baru (hanya perihal bentrok).
  function validateClashRules(nama, role, newSlots, pool) {
    var roleU = String(role || '').toUpperCase();
    var maxPeople = CLASH_MAX_PEOPLE[roleU] || 2;
    // Interval milik orang lain (kecualikan diri sendiri). LOKAL & INDO sudah tergabung.
    var others = pool.filter(function(iv) { return iv.nama !== nama; });

    for (var k = 0; k < newSlots.length; k++) {
      var slot = newSlots[k];

      // ATURAN 1 — jumlah orang per tanggal (inklusif). Pemohon dihitung 1 orang.
      var staffOverlapDays = {};
      var hasViolation = false;
      for (var d = slot.s; d <= slot.e; d++) {
        var dayPeople = [nama];
        for (var i = 0; i < others.length; i++) {
          if (others[i].s <= d && d <= others[i].e) dayPeople.push(others[i].nama);
        }
        if (dayPeople.length > maxPeople) {
          hasViolation = true;
          if (roleU === 'KAPTEN') { break; }
          var othersOnDay = dayPeople.filter(function(n) { return n !== nama; });
          for (var oi = 0; oi < othersOnDay.length; oi++) {
            var on = othersOnDay[oi];
            if (!staffOverlapDays[on]) staffOverlapDays[on] = { min: d, max: d };
            else { if (d < staffOverlapDays[on].min) staffOverlapDays[on].min = d; if (d > staffOverlapDays[on].max) staffOverlapDays[on].max = d; }
          }
        }
      }

      if (hasViolation) {
        if (roleU === 'KAPTEN') {
          var firstDay = null;
          for (var d2 = slot.s; d2 <= slot.e; d2++) {
            var cnt = 1;
            for (var i2 = 0; i2 < others.length; i2++) { if (others[i2].s <= d2 && d2 <= others[i2].e) cnt++; }
            if (cnt > maxPeople) { firstDay = d2; break; }
          }
          return '⛔ Pengajuan cuti ditolak.\nPada tanggal ' + formatDate(isoFromKey(firstDay)) + ' cuti bentrok dengan KAPTEN lainnya.\nROLE KAPTEN hanya mengizinkan 1 orang cuti pada periode yang sama ⛔';
        }
        var lines = ['⛔ Pengajuan cuti ditolak.'];
        var staffNames = Object.keys(staffOverlapDays);
        for (var si = 0; si < staffNames.length; si++) {
          var sn = staffNames[si];
          var rng = staffOverlapDays[sn];
          lines.push('Pada tanggal ' + formatDateRangeByKey(rng.min, rng.max) + ' cuti bentrok dengan staff ' + sn + '.');
        }
        lines.push('Batas maksimal adalah ' + maxPeople + ' orang ⛔');
        return lines.join('\n');
      }

      // ATURAN 2 — durasi bentrok berpasangan maks 3 hari (hanya CS & KASIR).
      if (roleU !== 'KAPTEN') {
        for (var j = 0; j < others.length; j++) {
          var os = Math.max(slot.s, others[j].s), oe = Math.min(slot.e, others[j].e);
          if (os <= oe) {
            var durasi = oe - os + 1;
            if (durasi > CLASH_MAX_OVERLAP_DAYS) {
              return '⛔ Pengajuan cuti ditolak.\nBentrok dengan staff ' + others[j].nama + ' ' + durasi + ' hari.\nBatas maksimal durasi bentrok sesama ROLE adalah ' + CLASH_MAX_OVERLAP_DAYS + ' hari ⛔';
            }
          }
        }
      }
    }
    return null;   // lolos semua aturan
  }

  // Ubah day-key kembali ke 'YYYY-MM-DD' (untuk pesan tanggal). Aman lintas bulan/tahun.
  function isoFromKey(k) {
    var d = new Date(k * 86400000);
    function p(x) { return String(x).padStart(2, '0'); }
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  function formatDateRangeByKey(startKey, endKey) {
    var start = formatDate(isoFromKey(startKey));
    var end = formatDate(isoFromKey(endKey));
    return startKey === endKey ? start : start + ' sampai ' + end;
  }

  // Pemeriksa lengkap dipakai di alur submit: ambil pool terkini lalu validasi.
  function checkClashOnSubmit(nama, role, leaves) {
    // Hanya slot ber-perihal bentrok & tanggal lengkap yang divalidasi
    var slots = [];
    leaves.forEach(function(lv) {
      if (CLASH_PERIHAL.indexOf(lv.perihal) !== -1 && lv.start && lv.end) {
        slots.push({ perihal: lv.perihal, s: dayKey(lv.start), e: dayKey(lv.end) });
      }
    });
    if (!slots.length) return Promise.resolve(null);   // tak ada cuti lokal/indo → tak perlu cek
    return fetchRoleClashPool(role).then(function(pool) {
      return validateClashRules(nama, role, slots, pool);
    });
  }

  // ── State ─────────────────────────────────────────────────────
  var CONFIG = { ROLE: [], PERIHAL: [], KETERANGAN: [], TAMBAHAN: [], TASK: [], LDR: [], BANK: [], TASK_REK: [], TASK_RESIGN: [], STAFF: [] };
  var ADD = '__ADD__';
  var _cache = null, _loaded = false, _prefetch = null;
  var _filterVer = 0;                                    // naik setiap cache berubah
  var _memoMonth = null, _memoMonthKey = null;           // memo buildMonthOptions
  var _memoStatus = null, _memoStatusKey = null;         // memo buildStatusOptions
  var filterState = { role: 'ALL', search: '', month: 'ALL', status: 'ALL', segment: 'AKTIF' };
  var ROW_LIMIT = 120, _showAllRows = false;   // batasi baris agar tabel tetap ringan

  // ── Toast & Confirm ───────────────────────────────────────────
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = (type === 'ok' ? '✅ ' : type === 'err' ? '⚠️ ' : '') + msg;
    document.getElementById('toastWrap').appendChild(el);
    setTimeout(function() { el.style.transition = 'opacity .3s'; el.style.opacity = '0';
      setTimeout(function() { el.remove(); }, 300); }, 3200);
  }
  var _confirmCancelFn = null;   // dipakai bila ditutup lewat Escape / klik luar
  function confirmDialog(opts, onOk, onCancel) {
    if (typeof opts === 'string') opts = { text: opts };   // pemakaian lama tetap jalan
    var ov = document.getElementById('confirmOverlay');
    var titleEl = document.getElementById('confirmTitle');
    var textEl = document.getElementById('confirmText');
    var warnEl = document.getElementById('confirmWarn');
    var okBtn = document.getElementById('confirmOk');
    var cancelBtn = document.getElementById('confirmCancel');

    titleEl.textContent = opts.title || 'Konfirmasi';
    textEl.textContent = opts.text || '';
    if (opts.warn) { warnEl.textContent = opts.warn; warnEl.style.display = 'block'; }
    else warnEl.style.display = 'none';
    okBtn.textContent = opts.okLabel || 'Hapus';
    okBtn.className = 'btn ' + (opts.okClass || 'btn-danger');
    cancelBtn.textContent = opts.cancelLabel || 'Batal';
    ov.classList.add('open');

    function cleanup() { ov.classList.remove('open'); okBtn.onclick = null; cancelBtn.onclick = null; _confirmCancelFn = null; }
    okBtn.onclick = function() { cleanup(); if (onOk) onOk(); };
    cancelBtn.onclick = function() { cleanup(); if (onCancel) onCancel(); };
    _confirmCancelFn = function() { cleanup(); if (onCancel) onCancel(); };
  }
  function closeConfirm() { if (_confirmCancelFn) _confirmCancelFn(); else document.getElementById('confirmOverlay').classList.remove('open'); }

  // ── Tab ───────────────────────────────────────────────────────
  function switchTab(view) {
    // Accent theme per module (dipakai juga untuk warna hover tabel — lihat style.css)
    document.body.classList.remove('theme-resign', 'theme-rekening', 'theme-ongoing', 'theme-archive', 'theme-revisi');
    if (view === 'resign') document.body.classList.add('theme-resign');
    else if (view === 'rekening') document.body.classList.add('theme-rekening');
    else if (view === 'ongoing') document.body.classList.add('theme-ongoing');
    else if (view === 'archive') document.body.classList.add('theme-archive');
    else if (view === 'revisi') document.body.classList.add('theme-revisi');

    // Tab active (legacy, hidden)
    document.querySelectorAll('.tab').forEach(function(t) {
      t.classList.toggle('active', t.id === 'tab' + view.charAt(0).toUpperCase() + view.slice(1));
    });
    // Sidebar active
    var sbMap = { dashboard:'sbDashboard', ongoing:'sbOngoing', archive:'sbArchive',
      calendar:'sbCalendar', resign:'sbResign', rekening:'sbRekening', log:'sbLog', revisi:'sbRevisi' };
    document.querySelectorAll('.sb-item').forEach(function(s) { s.classList.remove('active'); });
    var sbEl = document.getElementById(sbMap[view]);
    if (sbEl) sbEl.classList.add('active');
    // Sedang Cuti & Selesai Cuti memakai tampilan dashboard yang sama, hanya isinya yang berbeda
    var target = (view === 'archive' || view === 'ongoing') ? 'dashboard' : view;
    document.querySelectorAll('.view').forEach(function(v) {
      v.classList.toggle('active', v.id === 'view-' + target);
    });
    if (target === 'dashboard') {
      var segBaru = (view === 'archive') ? 'ARSIP' : (view === 'ongoing') ? 'BERJALAN' : 'AKTIF';
      // Berpindah antar menu (Dashboard/Sedang Cuti/Selesai Cuti) → mulai bersih:
      // reset semua filter & batas baris supaya tidak ada sisa filter dari menu sebelumnya
      // yang membuat tabel tampak kosong tanpa sebab.
      if (segBaru !== filterState.segment) resetDashboardFilters();
      filterState.segment = segBaru;
      applySegmentUI();
      loadDashboard(false);
    }
    if (view === 'calendar') renderCalendar();
    if (view === 'rekening') loadRekening(false);
    if (view === 'resign') loadResign(false);
    if (view === 'log') loadLog(false);
    if (view === 'revisi') loadRevisi(false);
  }

  // Kembalikan semua filter dashboard ke kondisi awal (dipakai saat pindah menu)
  function resetDashboardFilters() {
    filterState.role = 'ALL';
    filterState.search = '';
    filterState.month = 'ALL';
    filterState.status = 'ALL';
    _showAllRows = false;                 // batasi baris lagi agar tabel tetap ringan
    var si = document.getElementById('searchInput'); if (si) si.value = '';   // kosongkan kotak pencarian
  }

  // Sesuaikan judul, keterangan, dan tombol sesuai segmen yang dibuka
  function applySegmentUI() {
    var seg = filterState.segment;
    var judul = { AKTIF: 'Data Pengajuan Cuti', BERJALAN: 'Staff Sedang Cuti', ARSIP: 'Data Selesai Cuti' };
    var desc = {
      AKTIF: 'Kolom <strong>Bentrok</strong> menghitung staff <strong>dengan role sama</strong> yang CUTI LOKAL/INDO di tanggal beririsan.',
      BERJALAN: 'Pengajuan yang statusnya <strong>SEDANG CUTI</strong> otomatis pindah ke sini. Ubah ke <strong>SELESAI CUTI</strong> bila staff sudah kembali.',
      ARSIP: 'Pengajuan yang statusnya <strong>SELESAI CUTI</strong> otomatis pindah ke sini.'
    };
    var h = document.getElementById('dashTitle'), p = document.getElementById('dashDesc');
    if (h) h.textContent = judul[seg] || judul.AKTIF;
    if (p) p.innerHTML = desc[seg] || desc.AKTIF;
    // Form pengajuan hanya relevan di Dashboard
    var btn = document.getElementById('toggleFormBtn');
    if (btn) btn.style.display = (seg === 'AKTIF') ? '' : 'none';
    if (seg !== 'AKTIF') toggleForm(false);
  }

  // Perbarui angka pada tab Sedang Cuti & Selesai Cuti
  function updateTabCounts() {
    var nOngoing = 0, nArchive = 0;
    (_cache || []).forEach(function(r) {
      if (inSegment(r, 'BERJALAN')) nOngoing++;
      else if (inSegment(r, 'ARSIP')) nArchive++;
    });
    var oEl = _domOngoingCount || document.getElementById('ongoingCount');
    var aEl = _domArchiveCount || document.getElementById('archiveCount');
    if (oEl) { oEl.textContent = nOngoing; oEl.style.display = nOngoing ? '' : 'none'; }
    if (aEl) { aEl.textContent = nArchive; aEl.style.display = nArchive ? '' : 'none'; }
    // Sync sidebar badges
    var sbO = document.getElementById('sbOngoingCount');
    var sbA = document.getElementById('sbArchiveCount');
    if (sbO) { sbO.textContent = nOngoing; sbO.style.display = nOngoing ? '' : 'none'; }
    if (sbA) { sbA.textContent = nArchive; sbA.style.display = nArchive ? '' : 'none'; }
    refreshWaitingAlert();
  }

  // Efek "menyapu" HANYA menyala pada menu sidebar yang benar-benar punya
  // pengajuan belum diproses — bukan global ke semua menu. WAITING pada cuti
  // hanya pernah tampil di menu Dashboard Pengajuan (lihat inSegment: baris
  // WAITING bukan bagian dari segmen BERJALAN/ARSIP), jadi cukup ditandai di
  // situ; ganti rekening & resign masing-masing ditandai di menunya sendiri.
  function refreshWaitingAlert() {
    var cutiWaiting = (_cache || []).some(function(r) { return String(r.task1 || '').toUpperCase() === 'WAITING'; });
    var rekWaiting = (_rekCache || []).some(function(r) { return String(r.task || '').toUpperCase() === 'WAITING'; });
    var resignPending = (_resignCache || []).some(function(r) { return String(r.task || '').toUpperCase() === 'PENDING'; });
    var sbDash = document.getElementById('sbDashboard');
    var sbRek = document.getElementById('sbRekening');
    var sbRes = document.getElementById('sbResign');
    if (sbDash) sbDash.classList.toggle('sb-waiting-alert', cutiWaiting);
    if (sbRek) sbRek.classList.toggle('sb-waiting-alert', rekWaiting);
    if (sbRes) sbRes.classList.toggle('sb-waiting-alert', resignPending);
  }

  // ── Dropdown helpers ──────────────────────────────────────────
  // ── Combobox nama staff (dropdown custom, bisa ketik bebas) ───
  // Dibuat sendiri (bukan <datalist>) agar tampilannya rapi & bisa di-CSS.
  var _combos = [];
  var _docComboHandler = null;   // daftar combobox aktif, agar bisa di-refresh saat CONFIG.STAFF berubah

  // Pisahkan "NAMA - ID" jadi bagian nama & ID untuk tampilan dua kolom
  function splitStaff(v) {
    var i = String(v).lastIndexOf(' - ');
    return i === -1 ? { nm: v, id: '' } : { nm: v.slice(0, i), id: v.slice(i + 3) };
  }

  function initCombo(wrap) {
    var input = wrap.querySelector('.combo-input');
    var panel = wrap.querySelector('.combo-panel');
    var arrow = wrap.querySelector('.combo-arrow');
    var cat = wrap.dataset.cat || 'STAFF';
    var activeIdx = -1;     // indeks item tersorot (navigasi keyboard)
    var mode = 'list';      // 'list' | 'edit' | 'add'  → saat edit/add, list tidak dirender ulang
    var editingVal = null;  // nama yang sedang diedit

    // Panel dibagi dua: daftar yang bisa di-scroll + footer tetap (tombol Tambah Staff)
    panel.innerHTML = '<div class="combo-list"></div><div class="combo-foot"></div>';
    var listEl = panel.querySelector('.combo-list');
    var footEl = panel.querySelector('.combo-foot');

    function isOpen() { return wrap.classList.contains('open'); }
    function open() { wrap.classList.add('open'); input.setAttribute('aria-expanded', 'true'); }
    function close() {
      if (mode !== 'list') return;   // jangan tutup saat sedang edit/tambah
      wrap.classList.remove('open'); input.setAttribute('aria-expanded', 'false'); activeIdx = -1;
    }
    function options() { return Array.prototype.slice.call(listEl.querySelectorAll('.combo-opt')); }

    function highlight(q, text) {
      if (!q) return esc(text);
      var i = text.toLowerCase().indexOf(q.toLowerCase());
      if (i === -1) return esc(text);
      return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
    }

    var EDIT_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    var DEL_SVG  = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    // Gambar daftar nama (bagian atas panel)
    function renderList() {
      var q = input.value.trim(), ql = q.toLowerCase();
      var all = (CONFIG[cat] || []);
      var list = ql ? all.filter(function(s) { return s.toLowerCase().indexOf(ql) !== -1; }) : all.slice();
      list.sort(function(a, b) { return a.localeCompare(b); });

      if (!list.length) {
        listEl.innerHTML = '<div class="combo-empty">' + (q ? 'Tidak ada nama yang cocok.' : 'Daftar kosong.') + '</div>';
        return;
      }
      listEl.innerHTML = list.map(function(v) {
        var p = splitStaff(v);
        return '<div class="combo-opt" data-val="' + esc(v) + '">' +
          '<span class="co-nm">' + highlight(q, p.nm) + '</span>' +
          (p.id ? '<span class="co-id">' + highlight(q, p.id) + '</span>' : '') +
          '<span class="co-tools admin-only">' +
            '<button type="button" class="co-ic" data-edit title="Ubah nama">' + EDIT_SVG + '</button>' +
            '<button type="button" class="co-ic danger" data-del title="Hapus dari daftar">' + DEL_SVG + '</button>' +
          '</span>' +
        '</div>';
      }).join('');
      activeIdx = -1;
    }

    // Gambar footer sesuai mode (tombol Tambah Staff ATAU form 2 kolom nama+ID)
    function renderFoot() {
      if (mode === 'add') {
        footEl.innerHTML =
          '<div class="combo-addform">' +
            '<div class="caf-fields">' +
              '<input type="text" class="co-add-nama" placeholder="Nama Lengkap (mis. HOKIJITU)" autocomplete="off">' +
              '<input type="text" class="co-add-id" placeholder="No. Passport / ID (mis. X123456)" autocomplete="off">' +
            '</div>' +
            '<div class="caf-actions">' +
              '<button type="button" class="co-ic ok" data-save title="Simpan">✓</button>' +
              '<button type="button" class="co-ic" data-cancel title="Batal">✕</button>' +
            '</div>' +
          '</div>';
      } else {
        footEl.innerHTML = '<div class="combo-add admin-only" data-addnew>＋ Tambah Staff</div>';
      }
    }

    function render() { if (mode === 'list') { renderList(); renderFoot(); } }

    function choose(val) { input.value = val; setMode('list'); close(); input.dispatchEvent(new Event('change', { bubbles: true })); }

    function setMode(m) { mode = m; wrap.classList.toggle('editing-mode', m !== 'list'); }

    // ── Tambah staff baru (2 kolom → digabung jadi satu string "NAMA - ID") ──
    function startAdd() { if (!isAdmin()) return;
      setMode('add'); renderFoot();
      var fNama = footEl.querySelector('.co-add-nama'), fId = footEl.querySelector('.co-add-id');
      focusSoon(fNama);
      [fNama, fId].forEach(function(el) {
        el.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); commitAdd(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancelFoot(); }
        });
      });
    }
    function cancelFoot() { setMode('list'); renderFoot(); input.focus(); }
    function commitAdd() {
      var fNama = footEl.querySelector('.co-add-nama'), fId = footEl.querySelector('.co-add-id');
      var nm = String(fNama.value || '').trim().toUpperCase();
      var id = String(fId.value || '').trim().toUpperCase();
      if (!nm) { toast('Nama lengkap wajib diisi', 'err'); fNama.focus(); return; }
      if (!id) { toast('Nomor passport / ID wajib diisi', 'err'); fId.focus(); return; }
      // Gabung jadi SATU string utuh — inilah nilai tunggal yang disimpan
      var v = nm + ' - ' + id;
      if ((CONFIG[cat] || []).some(function(s) { return s.toLowerCase() === v.toLowerCase(); })) {
        toast('Staff itu sudah ada di daftar', 'err'); fNama.focus(); return;
      }
      fNama.disabled = fId.disabled = true;
      addOption(cat, v).then(function(cfg) {
        CONFIG = cfg; setMode('list'); render(); input.focus();
        toast('Staff baru ditambahkan: ' + v, 'ok');
        logActivity('STAFF', 'CREATE', 'Tambah staff: ' + v);
      }).catch(function(err) {
        fNama.disabled = fId.disabled = false; toast('Gagal menambah: ' + err.message, 'err');
      });
    }

    // ── Edit nama (dari baris) ──
    function startEdit(row, val) { if (!isAdmin()) return;
      if (!row) return;
      setMode('edit'); editingVal = val;
      row.classList.add('editing');
      row.innerHTML =
        '<input type="text" class="co-edit-input" value="' + esc(val) + '">' +
        '<span class="co-tools">' +
          '<button type="button" class="co-ic ok" data-save title="Simpan">✓</button>' +
          '<button type="button" class="co-ic" data-cancel title="Batal">✕</button>' +
        '</span>';
      var ei = row.querySelector('.co-edit-input');
      focusSoon(ei, true);
      ei.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(row); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      });
    }
    function cancelEdit() { editingVal = null; setMode('list'); renderList(); input.focus(); }
    function commitEdit(row) {
      var ei = row.querySelector('.co-edit-input');
      var oldVal = editingVal, newVal = String(ei.value || '').trim();
      if (!newVal) { toast('Nama tidak boleh kosong', 'err'); ei.focus(); return; }
      if (newVal === oldVal) { cancelEdit(); return; }
      if ((CONFIG[cat] || []).some(function(s) { return s.toLowerCase() === newVal.toLowerCase() && s.toLowerCase() !== oldVal.toLowerCase(); })) {
        toast('Nama itu sudah ada di daftar', 'err'); ei.focus(); return;
      }
      ei.disabled = true;
      renameOption(cat, oldVal, newVal).then(function(cfg) {
        CONFIG = cfg; editingVal = null; setMode('list');
        if (input.value.trim() === oldVal) input.value = newVal;
        render(); input.focus();
        toast('Nama diperbarui', 'ok');
        logActivity('STAFF', 'UPDATE', 'Rename: ' + oldVal + ' → ' + newVal);
      }).catch(function(err) {
        ei.disabled = false; toast('Gagal mengubah nama: ' + err.message, 'err');
      });
    }

    function askDelete(val) { if (!isAdmin()) return;
      confirmDialog({
        title: 'Hapus dari Daftar',
        warn: 'Hanya menghapus dari daftar pilihan — data cuti yang sudah memakai nama ini tidak terpengaruh.',
        text: 'Hapus “' + val + '” dari daftar nama staff?',
        okLabel: 'Ya, hapus', okClass: 'btn-danger', cancelLabel: 'Batal'
      }, function() {
        removeOption(cat, val).then(function(res) {
          if (!res.deleted) { toast('Tidak terhapus — periksa izin akses (RLS)', 'err'); return; }
          CONFIG = res.cfg; render(); input.focus();
          toast('Nama dihapus dari daftar', 'ok');
          logActivity('STAFF', 'DELETE', 'Hapus staff: ' + val);
        }).catch(function(err) { toast('Gagal menghapus: ' + err.message, 'err'); });
      });
    }

    // Fokus elemen setelah pemrosesan mousedown selesai (hindari fokus balik ke input utama)
    function focusSoon(el, toEnd) {
      setTimeout(function() {
        if (!el) return;
        el.focus();
        if (toEnd && el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length);
      }, 0);
    }

    function move(step) {
      var opts = options();
      if (!opts.length) return;
      activeIdx = (activeIdx + step + opts.length) % opts.length;
      opts.forEach(function(o, i) { o.classList.toggle('active', i === activeIdx); });
      opts[activeIdx].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('focus', function() { if (mode === 'list') { render(); open(); } });
    input.addEventListener('input', function() { if (mode === 'list') { render(); open(); } });
    arrow.addEventListener('mousedown', function(e) {
      e.preventDefault();
      if (isOpen()) { setMode('list'); close(); }
      else { render(); open(); input.focus(); }
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowDown') { if (!isOpen()) { render(); open(); } else move(1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { move(-1); e.preventDefault(); }
      else if (e.key === 'Enter') {
        var opts = options();
        if (isOpen() && activeIdx >= 0 && opts[activeIdx]) { e.preventDefault(); choose(opts[activeIdx].dataset.val); }
        else { close(); }   // pakai teks apa adanya
      }
      else if (e.key === 'Escape') { setMode('list'); close(); }
    });

    // Delegasi klik untuk SELURUH panel (daftar + footer)
    var _fromPanel = false;   // ditandai saat mousedown berasal dari dalam panel
    panel.addEventListener('mousedown', function(e) {
      _fromPanel = true;   // WAJIB paling atas: sebelum innerHTML diubah (target bisa terlepas dari DOM)
      // Klik di dalam kolom ketik (edit/add): biarkan fokus normal, jangan diproses
      if (e.target.closest('.co-edit-input, .co-add-nama, .co-add-id')) return;
      e.preventDefault();   // cegah input utama kehilangan fokus sebelum kita atur sendiri

      if (e.target.closest('[data-save]')) {
        if (mode === 'add') commitAdd();
        else { var r = e.target.closest('.combo-opt'); if (r) commitEdit(r); }
        return;
      }
      if (e.target.closest('[data-cancel]')) { (mode === 'add') ? cancelFoot() : cancelEdit(); return; }
      if (e.target.closest('[data-addnew]')) { startAdd(); return; }

      var editBtn = e.target.closest('[data-edit]');
      var delBtn  = e.target.closest('[data-del]');
      var row = e.target.closest('.combo-opt');
      if (editBtn && row) { startEdit(row, row.dataset.val); return; }
      if (delBtn && row) { askDelete(row.dataset.val); return; }
      if (row) { choose(row.dataset.val); return; }
    });

    // Tutup saat klik DI LUAR combobox.
    // Melewati klik yang berasal dari panel (target-nya bisa sudah terlepas dari DOM
    // setelah innerHTML diubah, sehingga wrap.contains keliru menganggapnya "di luar").
    _combos.push({ render: render, docClick: function(e) {
      if (_fromPanel) { _fromPanel = false; return; }
      if (!wrap.contains(e.target) && isOpen()) { setMode('list'); close(); renderFoot(); }
    }});
  }

  // Bangun semua combobox & sediakan cara refresh saat daftar staff bertambah
  function initCombos() {
    _combos = [];
    if (_docComboHandler) { document.removeEventListener('mousedown', _docComboHandler); }
    document.querySelectorAll('.combo').forEach(initCombo);
    _docComboHandler = function(e) { _combos.forEach(function(c) { c.docClick(e); }); };
    document.addEventListener('mousedown', _docComboHandler);
  }
  function fillStaffList() { /* nama dibaca langsung dari CONFIG saat panel dibuka; tak perlu pra-isi */ }

  function fillSelect(sel, cat, selected, withAdd) {
    var list = CONFIG[cat] || [];
    var parts = ['<option value="" disabled' + (selected ? '' : ' selected') + '>Pilih…</option>'];
    list.forEach(function(v) { parts.push('<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>'); });
    if (withAdd !== false) parts.push('<option value="' + ADD + '">＋ Tambah opsi baru…</option>');
    sel.innerHTML = parts.join('');
  }
  // Isi dropdown PERIHAL (dipakai modal Ajukan Revisi & Ubah Revisi) — SELALU dari
  // CONFIG.PERIHAL yang sebenarnya (bukan daftar statis 3 opsi), supaya kategori
  // seperti CUTI MELAHIRKAN / CUTI NIKAH / opsi kustom lain tidak hilang saat form
  // dibuka lalu disimpan ulang. `optional`=true untuk slot Cuti 2 yang boleh kosong
  // (opsi "— Kosong —" bisa dipilih ulang, bukan placeholder disabled).
  function fillPerihalSelect(sel, selected, optional) {
    var list = CONFIG.PERIHAL || [];
    var parts = optional
      ? ['<option value="">— Kosong —</option>']
      : ['<option value="" disabled' + (selected ? '' : ' selected') + '>Pilih…</option>'];
    list.forEach(function(v) { parts.push('<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>'); });
    parts.push('<option value="' + ADD + '">＋ Tambah opsi baru…</option>');
    sel.innerHTML = parts.join('');
  }
  // dropdown "tambah opsi baru"
  document.addEventListener('change', function(e) {
    var sel = e.target;
    if (sel.tagName !== 'SELECT' || sel.value !== ADD) return;
    var cat = sel.dataset.cat;
    if (!cat) return;
    var val = prompt('Ketik opsi baru untuk ' + cat + ':');
    if (!val || !val.trim()) { fillSelect(sel, cat, ''); return; }
    sel.disabled = true;
    addOption(cat, val.trim()).then(function(cfg) {
      CONFIG = cfg;
      document.querySelectorAll('select[data-cat="' + cat + '"]').forEach(function(s) {
        fillSelect(s, cat, s === sel ? val.trim() : s.value === ADD ? '' : s.value);
      });
      sel.disabled = false;
      if (cat === 'ROLE') renderRoleChips();
      if (cat === 'LDR') fillLdr(val.trim());
    }).catch(function(err) { toast('Gagal menambah opsi: ' + err.message, 'err'); fillSelect(sel, cat, ''); sel.disabled = false; });
  });

  // ── Leave block builder (dipakai form & modal) ────────────────
  function createLeaveBlock(container, opts) {
    opts = opts || {};
    var block = document.createElement('div');
    block.className = 'leave-block';
    var idx = container.querySelectorAll('.leave-block').length + 1;
    var html = '<div class="header-block"><span class="badge">Cuti ' + idx + '</span>';
    if (opts.removable) html += '<button class="remove-btn" type="button">✕ Hapus</button>';
    html += '</div><div class="grid">' +
      '<div class="field"><label>Perihal</label><select data-cat="PERIHAL"></select></div>' +
      '<div class="field"><label>Tanggal Mulai</label><input type="date" class="start-date"></div>' +
      '<div class="field"><label>Tanggal Selesai</label><input type="date" class="end-date"></div>' +
      '<div class="field"><label>Durasi</label><input type="text" class="duration" readonly placeholder="0 Hari"></div>' +
      '</div>';
    block.innerHTML = html;
    container.appendChild(block);

    var pf = opts.prefill || {};
    block.querySelectorAll('select[data-cat]').forEach(function(sel) { fillSelect(sel, sel.dataset.cat, pf.perihal || ''); });
    var s = block.querySelector('.start-date'), en = block.querySelector('.end-date'), du = block.querySelector('.duration');
    if (pf.start) s.value = pf.start;
    if (pf.end) en.value = pf.end;
    function calc() {
      if (s.value && en.value) {
        var d = dayKey(en.value) - dayKey(s.value) + 1;
        du.value = d > 0 ? d + ' Hari' : '⚠ Selesai < Mulai';
      } else du.value = '';
      if (opts.onChange) opts.onChange();
    }
    s.addEventListener('change', calc); en.addEventListener('change', calc); calc();

    var rm = block.querySelector('.remove-btn');
    if (rm) rm.addEventListener('click', function() { block.remove(); if (opts.onRemove) opts.onRemove(); });
    return block;
  }
  function gatherLeaves(container) {
    var leaves = [];
    container.querySelectorAll('.leave-block').forEach(function(b) {
      var perihal = b.querySelector('[data-cat="PERIHAL"]').value;
      var start = b.querySelector('.start-date').value;
      var end = b.querySelector('.end-date').value;
      if ((perihal && perihal !== ADD) || start || end) leaves.push({ perihal: perihal, start: start, end: end });
    });
    return leaves;
  }
  function renumber(container) {
    container.querySelectorAll('.leave-block').forEach(function(b, i) {
      var bd = b.querySelector('.badge'); if (bd) bd.textContent = 'Cuti ' + (i + 1);
    });
  }

  // ── FORM (panel toggle di dashboard) ──────────────────────────
  function toggleForm(force) {
    var panel = document.getElementById('formPanel');
    var btn = document.getElementById('toggleFormBtn');
    var open = (force === undefined) ? !panel.classList.contains('open') : !!force;
    panel.classList.toggle('open', open);
    btn.innerHTML = open ? '✕ Tutup form' : '＋ Ajukan Cuti';
    btn.classList.toggle('btn-primary', !open);
    btn.classList.toggle('btn-secondary', open);
    if (!open) { var m = document.getElementById('formMsg'); m.className = 'msg'; m.textContent = ''; }
  }
  document.getElementById('formPanel').addEventListener('click', function(e) { if (e.target === this) toggleForm(false); });

  var formC = document.getElementById('leaves-container');
  function toggleAddBtn() {
    document.getElementById('addLeave').style.display = formC.querySelectorAll('.leave-block').length >= 2 ? 'none' : 'block';
  }
  function addFormLeave(removable) {
    createLeaveBlock(formC, {
      removable: removable,
      onChange: updateTotalBox,
      onRemove: function() { renumber(formC); toggleAddBtn(); updateTotalBox(); }
    });
    renumber(formC); toggleAddBtn(); updateTotalBox();
  }
  document.getElementById('addLeave').addEventListener('click', function() { addFormLeave(true); });

  // Hitung & tampilkan total cuti secara langsung di form
  function updateTotalBox() {
    var box = document.getElementById('totalBox');
    var val = document.getElementById('totalValue');
    var det = document.getElementById('totalDetail');
    if (!box) return;
    var tambahan = document.getElementById('tambahan').value || '';
    var durasi = [];
    formC.querySelectorAll('.leave-block').forEach(function(b) {
      var s = b.querySelector('.start-date').value, e = b.querySelector('.end-date').value;
      if (s && e) { var d = dayKey(e) - dayKey(s) + 1; if (d > 0) durasi.push(d); }
    });
    var role = document.getElementById('role').value;
    var t = computeTotal(durasi, tambahan, role);
    val.innerHTML = t.total + ' <span>Hari</span>';
    box.classList.toggle('has-extra', t.extra > 0);
    if (t.total === 0) {
      det.textContent = t.allowance > 0
        ? 'Tambahan ' + t.allowance + ' hari siap dipakai — lengkapi tanggal cuti'
        : 'Lengkapi tanggal cuti terlebih dahulu';
    } else if (t.extra > 0) {
      det.textContent = 'Termasuk ' + t.extra + ' hari dari tambahan (disetujui)';
    } else if (t.allowance > 0) {
      det.textContent = 'Tambahan ' + t.allowance + ' hari dipilih, belum terpakai';
    } else {
      det.textContent = durasi.length > 1 ? 'Gabungan cuti 1 & cuti 2' : 'Dalam batas normal';
    }

    // Perbarui catatan batas efektif (maks role + hari tambahan)
    var note = document.getElementById('limitNote');
    if (note) {
      if (MAX_DURASI[role]) {
        var max = MAX_DURASI[role], limit = max + t.allowance;
        note.innerHTML = t.allowance > 0
          ? 'Batas durasi ' + role + ': <strong>' + max + ' hari + ' + t.allowance + ' hari tambahan = ' +
            limit + ' hari</strong> — tanggal cuti boleh sampai ' + limit + ' hari.'
          : 'Batas durasi ' + role + ': <strong>maks. ' + max + ' hari</strong>. Pilih “Tambahan Cuti” bila ingin melebihi.';
        note.classList.toggle('note-hi', t.allowance > 0);
      } else {
        note.textContent = 'Batas durasi per pengajuan — CS & KAPTEN maks. 14 hari, KASIR maks. 12 hari.';
        note.classList.remove('note-hi');
      }
    }
  }
  document.getElementById('tambahan').addEventListener('change', updateTotalBox);
  document.getElementById('role').addEventListener('change', updateTotalBox);

  document.getElementById('submitBtn').addEventListener('click', function() {
    var role = document.getElementById('role').value;
    var nama = document.getElementById('nama').value.trim();
    var keterangan = document.getElementById('keterangan').value;
    var tambahan = document.getElementById('tambahan').value || 'Tidak Ada';

    if (!role || role === ADD) return showMsg('error', 'Pilih role terlebih dahulu.');
    if (!nama) return showMsg('error', 'Isi nama lengkap beserta ID.');
    // Aturan: nama HARUS berasal dari daftar staff terdaftar (bukan teks bebas)
    var staffResmi = resolveStaff(nama);
    if (!staffResmi) return showMsg('error', STAFF_NOT_FOUND_MSG);
    nama = staffResmi;   // pakai string resmi dari daftar (samakan kapitalisasi)
    if (!keterangan || keterangan === ADD) return showMsg('error', 'Pilih keterangan passport.');

    var leaves = gatherLeaves(formC);
    if (leaves.length === 0) return showMsg('error', 'Tambahkan minimal 1 cuti.');
    var durasi;
    try { durasi = validateLeaves(role, leaves, parseTambahanDays(tambahan)); }
    catch (err) { return showMsg('error', err.message); }

    var btn = this;
    btn.disabled = true; btn.textContent = 'Memeriksa…';

    checkEligibility(nama, leaves[0].start).then(function(block) {
      if (block) {
        btn.disabled = false; btn.textContent = '📤 Kirim pengajuan';
        if (block.kind === 'active') {
          return showMsg('warn', '⛔ ' + nama + ' masih punya pengajuan berstatus ' + block.status +
            ' yang belum selesai. Tidak bisa mengajukan ulang — bila ingin mengubah cutinya, silakan gunakan tombol Edit (✎) pada baris cuti tersebut.');
        }
        // kind === 'cooldown'
        return showMsg('warn', '⛔ ' + nama + ' baru selesai cuti ' + formatDate(block.lastEnd) +
          '. Sesuai aturan jeda ' + COOLDOWN_MONTHS + ' bulan, tanggal mulai cuti berikutnya paling cepat ' +
          formatDate(block.eligibleOn) + '.');
      }
      // Lolos syarat pengajuan ulang → cek bentrok jadwal (aturan per role) dgn data terkini
      btn.textContent = 'Memeriksa bentrok…';
      return checkClashOnSubmit(nama, role, leaves).then(function(clashReason) {
        if (clashReason) {
          btn.disabled = false; btn.textContent = '📤 Kirim pengajuan';
          return showMsg('error', clashReason);
        }
        btn.textContent = 'Mengirim…';
        var id = genId();
        var payload = buildRowPayload(id, role, nama, keterangan, tambahan, leaves, durasi, 'WAITING');
        return sbPost('cuti', payload, { 'Prefer': 'return=minimal' }).then(function() {
          btn.disabled = false; btn.textContent = '📤 Kirim pengajuan';
          showMsg('success', 'Pengajuan berhasil dibuat — ID: ' + id);
          toast('Pengajuan tersimpan', 'ok');
          logActivity('CUTI', 'CREATE', 'Pengajuan cuti ' + nama + ' (' + durasi + ' hari)');
          var newRow = {
            rowId: id, id: id, timestamp: new Date().toISOString(),
            role: payload.role, nama: payload.nama,
            start1Raw: payload.start1, end1Raw: payload.end1,
            start2Raw: payload.start2, end2Raw: payload.end2,
            start1: formatDate(payload.start1), end1: formatDate(payload.end1),
            start2: formatDate(payload.start2), end2: formatDate(payload.end2),
            durasi1: payload.durasi1, perihal1: payload.perihal1,
            durasi2: payload.durasi2, perihal2: payload.perihal2,
            keterangan: payload.keterangan, tambahan: payload.tambahan,
            task1: payload.task1
          };
          if (_cache) { _cache.unshift(newRow); _clashIdx = null; _filterVer++; _memoMonth = null; _memoStatus = null; renderFilters(); applyFilters(); updateTabCounts(); }
          else { invalidate(); loadDashboard(true); }
          resetForm(); toggleForm(false);
        }).catch(function(err) {
          btn.disabled = false; btn.textContent = '📤 Kirim pengajuan';
          showMsg('error', 'Gagal menyimpan: ' + err.message);
        });
      });
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '📤 Kirim pengajuan';
      showMsg('error', 'Gagal memeriksa data: ' + err.message);
    });
  });

  // Cari staff terdaftar yang cocok PERSIS (abaikan besar/kecil huruf).
  // Kembalikan string resmi dari daftar, atau null bila tidak terdaftar.
  // Dipakai untuk aturan: nilai nama HARUS berasal dari daftar dropdown.
  function resolveStaff(nama) {
    var v = String(nama || '').trim().toLowerCase();
    if (!v) return null;
    var list = CONFIG.STAFF || [];
    for (var i = 0; i < list.length; i++) if (String(list[i]).toLowerCase() === v) return list[i];
    return null;
  }
  var STAFF_NOT_FOUND_MSG = 'Staff tidak ditemukan dalam daftar. Silakan pilih staff yang tersedia.';

  function showMsg(type, text) {
    var el = document.getElementById('formMsg');
    el.className = 'msg ' + type; el.textContent = text;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function resetForm() {
    document.getElementById('role').value = '';
    document.getElementById('nama').value = '';
    document.getElementById('keterangan').value = '';
    document.getElementById('tambahan').value = 'Tidak Ada';
    formC.innerHTML = ''; addFormLeave(false);
    var m = document.getElementById('formMsg'); m.className = 'msg'; m.textContent = '';
  }

  // ── EDIT MODAL ────────────────────────────────────────────────
  var eC = document.getElementById('e_leaves');
  var editingId = null;
  function eToggleAdd() {
    document.getElementById('e_addLeave').style.display = eC.querySelectorAll('.leave-block').length >= 2 ? 'none' : 'block';
  }
  document.getElementById('e_addLeave').addEventListener('click', function() {
    createLeaveBlock(eC, { removable: true, onRemove: function() { renumber(eC); eToggleAdd(); } });
    renumber(eC); eToggleAdd();
  });
  function fillTaskSelect(sel, selected) {
    var list = taskOptions();
    sel.innerHTML = list.map(function(v) { return '<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  }
  function openEdit(rowId) {
    var r = null;
    for (var i = 0; i < (_cache || []).length; i++) if (_cache[i].rowId === rowId) { r = _cache[i]; break; }
    if (!r) return;
    editingId = rowId;
    fillSelect(document.getElementById('e_role'), 'ROLE', r.role);
    document.getElementById('e_nama').value = r.nama;
    fillSelect(document.getElementById('e_keterangan'), 'KETERANGAN', r.keterangan);
    fillSelect(document.getElementById('e_tambahan'), 'TAMBAHAN', r.tambahan, false);
    fillTaskSelect(document.getElementById('e_task'), r.task1);
    eC.innerHTML = '';
    createLeaveBlock(eC, { removable: false, prefill: { perihal: r.perihal1, start: r.start1Raw, end: r.end1Raw } });
    if (r.start2Raw || r.perihal2)
      createLeaveBlock(eC, { removable: true, prefill: { perihal: r.perihal2, start: r.start2Raw, end: r.end2Raw }, onRemove: function() { renumber(eC); eToggleAdd(); } });
    renumber(eC); eToggleAdd();
    document.getElementById('e_msg').className = 'msg'; document.getElementById('e_msg').textContent = '';
    document.getElementById('editOverlay').classList.add('open');
  }
  function closeEdit() { document.getElementById('editOverlay').classList.remove('open'); editingId = null; }
  function eShow(type, text) { var el = document.getElementById('e_msg'); el.className = 'msg ' + type; el.textContent = text; }

  document.getElementById('e_save').addEventListener('click', function() {
    if (!editingId) return;
    var role = document.getElementById('e_role').value;
    var nama = document.getElementById('e_nama').value.trim();
    var keterangan = document.getElementById('e_keterangan').value;
    var tambahan = document.getElementById('e_tambahan').value || 'Tidak Ada';
    var task1 = document.getElementById('e_task').value;

    if (!role || role === ADD) return eShow('error', 'Pilih role.');
    if (!nama) return eShow('error', 'Isi nama beserta ID.');
    var staffResmi = resolveStaff(nama);
    if (!staffResmi) return eShow('error', STAFF_NOT_FOUND_MSG);
    nama = staffResmi;
    if (!keterangan || keterangan === ADD) return eShow('error', 'Pilih keterangan passport.');
    var leaves = gatherLeaves(eC);
    if (leaves.length === 0) return eShow('error', 'Minimal 1 cuti.');
    var durasi;
    try { durasi = validateLeaves(role, leaves, parseTambahanDays(tambahan)); } catch (err) { return eShow('error', err.message); }

    var patch = buildRowPayload(editingId, role, nama, keterangan, tambahan, leaves, durasi, task1);
    delete patch.id; delete patch.id_pengajuan; // id tidak diubah
    var btn = this; btn.disabled = true; btn.textContent = 'Menyimpan…';
    sbPatch('cuti', 'id=eq.' + encodeURIComponent(editingId), patch).then(function() {
      btn.disabled = false; btn.textContent = '💾 Simpan perubahan';
      if (_cache) {
        for (var i = 0; i < _cache.length; i++) {
          if (_cache[i].rowId === editingId) {
            var c = _cache[i];
            c.role = patch.role; c.nama = patch.nama;
            c.start1Raw = patch.start1; c.end1Raw = patch.end1;
            c.start2Raw = patch.start2; c.end2Raw = patch.end2;
            c.start1 = formatDate(patch.start1); c.end1 = formatDate(patch.end1);
            c.start2 = formatDate(patch.start2); c.end2 = formatDate(patch.end2);
            c.durasi1 = patch.durasi1; c.perihal1 = patch.perihal1;
            c.durasi2 = patch.durasi2; c.perihal2 = patch.perihal2;
            c.keterangan = patch.keterangan; c.tambahan = patch.tambahan;
            c.task1 = patch.task1; break;
          }
        }
        _clashIdx = null; _filterVer++; _memoMonth = null; _memoStatus = null;
        renderFilters(); applyFilters(); updateTabCounts();
      }
      closeEdit(); toast('Perubahan tersimpan', 'ok');
      logActivity('CUTI', 'UPDATE', 'Edit cuti ' + (document.getElementById('e_nama') ? document.getElementById('e_nama').value : editingId));
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '💾 Simpan perubahan';
      eShow('error', 'Gagal menyimpan: ' + err.message);
    });
  });

  // ── DELETE ────────────────────────────────────────────────────
  function deleteRow(rowId, label) {
    confirmDialog({
      title: 'Hapus Pengajuan',
      warn: 'DATA AKAN DIHAPUS PERMANEN DARI DATABASE DAN TIDAK BISA DIKEMBALIKAN',
      text: 'Hapus pengajuan cuti milik "' + label + '"?',
      okLabel: 'Ya, hapus permanen',
      okClass: 'btn-danger'
    }, function() {
      sbDelete('cuti', 'id=eq.' + encodeURIComponent(rowId)).then(function(hapus) {
        // Pastikan benar-benar ada baris yang terhapus di server
        if (!hapus || hapus.length === 0) {
          toast('Data tidak terhapus — periksa izin akses (RLS) di Supabase', 'err');
          return;
        }
        // Buang dari cache lokal supaya tabel langsung ikut berubah
        if (_cache) {
          for (var i = 0; i < _cache.length; i++) {
            if (_cache[i].rowId === rowId) { _cache.splice(i, 1); break; }
          }
          _clashIdx = null; _filterVer++; _memoMonth = null; _memoStatus = null;
          renderFilters(); applyFilters(); updateTabCounts();
        }
        toast('Pengajuan dihapus permanen', 'ok');
        logActivity('CUTI', 'DELETE', 'Hapus cuti ' + label);
        // Ikut bersihkan riwayat revisi (bila ada) supaya tidak jadi data "yatim"
        // yang menunjuk ke cuti_id yang sudah tidak ada.
        sbDelete('revisi_cuti', 'cuti_id=eq.' + encodeURIComponent(rowId)).then(function(hapusRevisi) {
          if (hapusRevisi && hapusRevisi.length > 0 && _revisiCache) {
            _revisiCache = _revisiCache.filter(function(r) { return r.cutiId !== rowId; });
            updateRevisiCount();
          }
        }).catch(function() { /* diam-diam gagal — bukan blocker penghapusan cuti utamanya */ });
      }).catch(function(err) { toast('Gagal menghapus: ' + err.message, 'err'); });
    });
  }

  // ── DASHBOARD ─────────────────────────────────────────────────
  function invalidate() { _loaded = false; _cache = null; _prefetch = null; _clashIdx = null; _filterVer++; _memoMonth = null; _memoMonthKey = null; _memoStatus = null; _memoStatusKey = null; _rekLoaded = false; _rekCache = null; _resignLoaded = false; _resignCache = null; _revisiLoaded = false; _revisiCache = null; _logLoaded = false; _logCache = null; }

  function loadDashboard(force) {
    var loading = document.getElementById('dashboardLoading');
    var content = document.getElementById('dashboardContent');
    var statBox = document.getElementById('statBox');
    var refreshBtn = document.getElementById('refreshBtn');

    if (!force && _loaded && _cache) { renderFilters(); applyFilters(); updateTabCounts(); content.style.display = 'block'; return; }

    loading.style.display = 'block'; loading.textContent = 'Memuat data…';
    content.style.display = 'none'; statBox.innerHTML = renderSkeletonStats();
    if (refreshBtn) refreshBtn.disabled = true;

    if (!force && _prefetch) {
      _prefetch.then(function(rows) {
        if (rows == null) return fetchFresh();
        done(rows);
      }).catch(function() { fetchFresh(); }).finally(function() { if (refreshBtn) refreshBtn.disabled = false; });
      return;
    }
    fetchFresh();

    function fetchFresh() {
      var p = getCuti();
      _prefetch = p.then(function(rows) { _cache = rows; _loaded = true; _clashIdx = null; _filterVer++; _memoMonth = null; _memoStatus = null; return rows; })
                   .catch(function(err) { _prefetch = null; throw err; });
      p.then(done).catch(function(err) { loading.textContent = '❌ Gagal memuat data: ' + err.message; })
       .finally(function() { if (refreshBtn) refreshBtn.disabled = false; });
    }
    function done(rows) {
      loading.style.display = 'none'; statBox.innerHTML = '';
      renderFilters(); applyFilters(); updateTabCounts(); content.style.display = 'block';
    }
  }

  function renderRoleChips() {
    var wrap = document.getElementById('roleChips');
    var roles = ['ALL'].concat(CONFIG.ROLE || []);
    wrap.innerHTML = roles.map(function(rl) {
      var active = filterState.role === rl ? ' active' : '';
      var label = rl === 'ALL' ? 'Semua' : rl;
      var dot = rl === 'ALL' ? '' : '<i class="role-dot ' + roleCls(rl) + '"></i>';
      return '<button class="chip' + active + '" data-role="' + esc(rl) + '">' + dot + esc(label) + '</button>';
    }).join('');
    // listener via event delegation pada #roleChips (dipasang sekali, lihat bawah)
  }

  // Bulan sebuah pengajuan = bulan dari TANGGAL MULAI PALING AWAL.
  // Satu pengajuan hanya masuk ke SATU bulan, walau cuti 2-nya di bulan lain.
  // Contoh: Cuti Kerja 30 Sep–9 Okt + Cuti Lokal 10–11 Okt  →  September.
  function startMonth(r) {
    var awal = null;
    [r.start1Raw, r.start2Raw].forEach(function(d) {
      if (!d) return;
      var v = String(d).slice(0, 10);            // 'YYYY-MM-DD'
      // Format YYYY-MM-DD bisa dibandingkan langsung sebagai teks (urutannya sama
      // dengan urutan tanggal), jadi tidak perlu konversi ke Date — bebas timezone.
      if (v.length === 10 && (awal === null || v < awal)) awal = v;
    });
    return awal ? awal.slice(0, 7) : null;       // → 'YYYY-MM'
  }

  // Bangun opsi dropdown Bulan dari rentang tanggal semua cuti
  function buildMonthOptions() {
    var memoKey = filterState.segment + '|' + _filterVer + '|' + filterState.month;
    if (_memoMonthKey === memoKey && _memoMonth !== null) {
      document.getElementById('monthFilter').innerHTML = _memoMonth;
      return;
    }
    // Hanya hitung data pada menu yang sedang dibuka
    var data = (_cache || []).filter(function(r) { return inSegment(r, filterState.segment); });

    var count = {}, minK = null, maxK = null;
    data.forEach(function(r) {
      var k = startMonth(r);
      if (!k) return;                             // tanpa tanggal mulai → dilewati
      count[k] = (count[k] || 0) + 1;             // 1 record = 1 bulan, dihitung sekali
      if (minK === null || k < minK) minK = k;
      if (maxK === null || k > maxK) maxK = k;
    });

    var sel = document.getElementById('monthFilter');
    if (!minK) {                                   // belum ada data sama sekali
      filterState.month = 'ALL';
      sel.innerHTML = '<option value="ALL">Semua Bulan</option>';
      return;
    }

    // Susun daftar BERURUTAN PENUH dari bulan terawal s/d terakhir (tanpa bolong),
    // dikelompokkan per tahun agar mudah dibaca.
    var y = +minK.slice(0, 4), m = +minK.slice(5, 7) - 1;
    var yEnd = +maxK.slice(0, 4), mEnd = +maxK.slice(5, 7) - 1;
    var opts = ['<option value="ALL">Semua Bulan</option>'];
    var tahunAktif = null, ada = {};
    while (y < yEnd || (y === yEnd && m <= mEnd)) {
      if (tahunAktif !== y) {
        if (tahunAktif !== null) opts.push('</optgroup>');
        opts.push('<optgroup label="' + y + '">');
        tahunAktif = y;
      }
      var k = y + '-' + String(m + 1).padStart(2, '0');
      var n = count[k] || 0;
      ada[k] = 1;
      opts.push('<option value="' + k + '"' + (k === filterState.month ? ' selected' : '') + '>' +
        MONTHS_ID[m] + ' ' + y + (n ? ' · ' + n : '') + '</option>');
      m++; if (m > 11) { m = 0; y++; }
    }
    if (tahunAktif !== null) opts.push('</optgroup>');

    // Pilihan lama yang sudah di luar rentang → kembalikan ke "Semua Bulan"
    if (filterState.month !== 'ALL' && !ada[filterState.month]) {
      filterState.month = 'ALL';
      opts[0] = '<option value="ALL" selected>Semua Bulan</option>';
    }
    var html = opts.join('');
    sel.innerHTML = html;
    _memoMonth = html; _memoMonthKey = filterState.segment + '|' + _filterVer + '|' + filterState.month;
  }
  // Bangun opsi dropdown Status dari status yang benar-benar ada di menu ini
  function buildStatusOptions() {
    var memoKey = filterState.segment + '|' + _filterVer + '|' + filterState.status + '|' + _revisiVer;
    if (_memoStatusKey === memoKey && _memoStatus !== null) {
      document.getElementById('statusFilter').innerHTML = _memoStatus;
      return;
    }
    var data = (_cache || []).filter(function(r) { return inSegment(r, filterState.segment); });
    var count = {};
    data.forEach(function(r) {
      var s = String(r.task1 || '').toUpperCase() || '(kosong)';
      count[s] = (count[s] || 0) + 1;
    });
    var revisiCount = 0;
    data.forEach(function(r) { if (findPendingRevisi(r.rowId)) revisiCount++; });
    // "Kembali Besok" hanya relevan di menu Sedang Cuti (BERJALAN)
    var besokCount = 0;
    if (filterState.segment === 'BERJALAN') {
      var hariIni = todayKey();
      data.forEach(function(r) { if (isKembaliBesok(r, hariIni)) besokCount++; });
    }
    // Urutkan mengikuti urutan pada CONFIG.TASK bila ada, sisanya menyusul alfabetis
    var order = (CONFIG.TASK || []).map(function(s) { return s.toUpperCase(); });
    var keys = Object.keys(count).sort(function(a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    var sel = document.getElementById('statusFilter');
    var opts = ['<option value="ALL">Semua Status</option>'];
    // Opsi ini tetap ditampilkan (walau hitungannya 0) selama memang sedang aktif
    // dipilih — supaya klik dari kartu stat "Minta Revisi"/"Kembali Besok" selalu
    // benar-benar menyaring tabel, bukan diam-diam dibatalkan balik ke Semua Status.
    if (revisiCount > 0 || filterState.status === 'ADA_REVISI') {
      opts.push('<option value="ADA_REVISI"' + (filterState.status === 'ADA_REVISI' ? ' selected' : '') + '>🟡 Ada Revisi · ' + revisiCount + '</option>');
    }
    if (besokCount > 0 || filterState.status === 'KEMBALI_BESOK') {
      opts.push('<option value="KEMBALI_BESOK"' + (filterState.status === 'KEMBALI_BESOK' ? ' selected' : '') + '>📅 Kembali Besok · ' + besokCount + '</option>');
    }
    keys.forEach(function(s) {
      opts.push('<option value="' + esc(s) + '"' + (s === filterState.status ? ' selected' : '') + '>' +
        esc(s) + ' · ' + count[s] + '</option>');
    });
    // Pilihan lama yang tak ada lagi di menu ini → kembalikan ke "Semua Status"
    // (ADA_REVISI & KEMBALI_BESOK tidak pernah dianggap "hilang" — lihat komentar di atas)
    var statusMasihValid = filterState.status === 'ALL' ||
      filterState.status === 'ADA_REVISI' ||
      filterState.status === 'KEMBALI_BESOK' ||
      count[filterState.status];
    if (!statusMasihValid) {
      filterState.status = 'ALL';
      opts[0] = '<option value="ALL" selected>Semua Status</option>';
    }
    var html = opts.join('');
    sel.innerHTML = html;
    _memoStatus = html; _memoStatusKey = filterState.segment + '|' + _filterVer + '|' + filterState.status + '|' + _revisiVer;
  }
  function renderFilters() { renderRoleChips(); buildMonthOptions(); buildStatusOptions(); }

  // Cocokkan record dengan bulan terpilih — satu record hanya milik satu bulan.
  function recordInMonth(r, ym) {
    if (ym === 'ALL') return true;
    return startMonth(r) === ym;
  }
  // Satu sumber kebenaran untuk semua filter
  function matchFilters(r) {
    if (!inSegment(r, filterState.segment)) return false;   // Dashboard / Sedang Cuti / Selesai Cuti
    if (filterState.role !== 'ALL' && r.role !== filterState.role) return false;
    if (filterState.search) {
      var hay = (r.nama + ' ' + r.role + ' ' + r.id).toLowerCase();
      if (hay.indexOf(filterState.search) === -1) return false;
    }
    if (!recordInMonth(r, filterState.month)) return false;
    if (filterState.status === 'ADA_REVISI') {
      if (!findPendingRevisi(r.rowId)) return false;
    } else if (filterState.status === 'KEMBALI_BESOK') {
      if (!isKembaliBesok(r)) return false;
    } else if (filterState.status !== 'ALL' && String(r.task1 || '').toUpperCase() !== filterState.status) return false;
    return true;
  }

  var _searchTimer = null;

  // Cache elemen DOM yang sering di-query agar tidak getElementById tiap saat
  var _domResultCount  = document.getElementById('resultCount');
  var _domStatBox      = document.getElementById('statBox');
  var _domOngoingCount = document.getElementById('ongoingCount');
  var _domArchiveCount = document.getElementById('archiveCount');

  // Event delegation untuk role chips — satu listener permanen, tidak dobel tiap render
  document.getElementById('roleChips').addEventListener('click', function(e) {
    var btn = e.target.closest('.chip');
    if (!btn) return;
    filterState.role = btn.dataset.role; _showAllRows = false; renderRoleChips(); applyFilters();
  });
  document.getElementById('searchInput').addEventListener('input', function() {
    var v = this.value.trim().toLowerCase();
    clearTimeout(_searchTimer);                 // tunggu user berhenti mengetik
    _searchTimer = setTimeout(function() {
      filterState.search = v; _showAllRows = false; applyFilters();
    }, 140);
  });
  document.getElementById('monthFilter').addEventListener('change', function() {
    filterState.month = this.value; _showAllRows = false; applyFilters();
  });
  document.getElementById('statusFilter').addEventListener('change', function() {
    filterState.status = this.value; _showAllRows = false; applyFilters();
  });

  function applyFilters() {
    if (!_cache) return;
    var rows = _cache.filter(matchFilters);
    var rc = _domResultCount;
    var filtered = (filterState.role !== 'ALL' || filterState.search || filterState.month !== 'ALL');
    rc.innerHTML = 'Menampilkan <strong>' + rows.length + '</strong> dari ' + _cache.length + ' pengajuan' + (filtered ? ' · terfilter' : '');
    // Kartu stat SELALU menampilkan total keseluruhan menu ini (Dashboard/Sedang Cuti/
    // Selesai Cuti), tidak ikut menyusut saat role/pencarian/bulan/status sedang difilter —
    // supaya angkanya tetap jadi acuan yang stabil, bukan cuma "sisa hasil filter".
    var segmentRows = _cache.filter(function(r) { return inSegment(r, filterState.segment); });
    renderStats(segmentRows);
    renderTable(rows, clashIndex());  // indeks ter-cache: filter/pencarian tetap ringan
  }

  function renderSkeletonStats() {
    var h = '';
    for (var i = 0; i < 5; i++) h += '<div class="stat-item"><span class="skeleton-cell" style="width:40px;height:40px;border-radius:11px;"></span><div style="flex:1"><span class="skeleton-cell" style="width:55%;margin-bottom:8px;"></span><span class="skeleton-cell" style="width:35%;height:20px;"></span></div></div>';
    return h;
  }
  function renderStats(rows) {
    var total = rows.length, waiting = 0, done = 0;
    rows.forEach(function(r) {
      var t = (r.task1 || '').toUpperCase();
      if (t === 'WAITING') waiting++;
      else if (t === 'DONE CATAT') done++;
    });
    var box = _domStatBox;

    if (filterState.segment === 'BERJALAN') {
      // Hitung berapa yang mulai masuk kerja lagi besok (cuti berakhir hari ini)
      var hariIni = todayKey();
      var hari = 0, besok = 0;
      rows.forEach(function(r) {
        hari += computeTotal([r.durasi1, r.durasi2], r.tambahan, r.role).total;
        if (isKembaliBesok(r, hariIni)) besok++;
      });
      box.innerHTML =
        statCard('Total Sedang Cuti', total, 'var(--blue)', 'var(--blue-bg)', '🏝️',
          { onclick: "filterByStatus('ALL')", title: 'Klik untuk lihat semua staff yang sedang cuti' }) +
        statCard('Total Hari Berjalan', hari, 'var(--brand-ink)', 'var(--brand-050)', '📅',
          { onclick: "filterByStatus('ALL')", title: 'Klik untuk lihat semua staff yang sedang cuti' }) +
        statCard('Kembali Besok', besok, 'var(--amber)', 'var(--amber-bg)', '⏰',
          { onclick: "filterByStatus('KEMBALI_BESOK')", title: 'Klik untuk lihat staff yang mulai masuk kerja lagi besok',
            extraClass: besok > 0 ? ' stat-alert' : '', pulseRgb: '251,191,36' });

    } else if (filterState.segment === 'ARSIP') {
      var hariArsip = 0;
      rows.forEach(function(r) { hariArsip += computeTotal([r.durasi1, r.durasi2], r.tambahan, r.role).total; });
      box.innerHTML =
        statCard('Total Selesai Cuti', total, 'var(--green)', 'var(--green-bg)', '✅',
          { onclick: "filterByStatus('ALL')", title: 'Klik untuk lihat semua staff yang selesai cuti' }) +
        statCard('Total Hari Diambil', hariArsip, 'var(--brand-ink)', 'var(--brand-050)', '📅',
          { onclick: "filterByStatus('ALL')", title: 'Klik untuk lihat semua staff yang selesai cuti' });

    } else {
      // Dihitung dari `rows` (baris di segmen menu ini saja), BUKAN dari seluruh
      // _revisiCache — supaya angkanya selalu sama dengan jumlah baris yang benar-
      // benar muncul saat kartu ini diklik (filterByStatus('ADA_REVISI') hanya
      // menyaring baris dalam segmen yang sedang aktif, lihat matchFilters()).
      var revisiPending = 0;
      rows.forEach(function(r) { if (findPendingRevisi(r.rowId)) revisiPending++; });
      box.innerHTML =
        statCard('Total Aktif', total, 'var(--brand-ink)', 'var(--brand-050)', '📋',
          { onclick: "filterByStatus('ALL')", title: 'Klik untuk lihat semua pengajuan' }) +
        statCard('Waiting', waiting, 'var(--amber)', 'var(--amber-bg)', '⏳',
          { onclick: "filterByStatus('WAITING')", title: 'Klik untuk lihat pengajuan berstatus Waiting',
            extraClass: waiting > 0 ? ' stat-alert' : '', pulseRgb: '251,191,36' }) +
        statCard('Done Catat', done, 'var(--slate)', 'var(--slate-bg)', '🗂️',
          { onclick: "filterByStatus('DONE CATAT')", title: 'Klik untuk lihat pengajuan berstatus Done Catat' }) +
        statCard('Minta Revisi', revisiPending, 'var(--yellow)', 'var(--yellow-bg)', '📝',
          { onclick: "filterByStatus('ADA_REVISI')", title: 'Klik untuk lihat baris yang mengajukan revisi cuti',
            extraClass: revisiPending > 0 ? ' stat-alert' : '', pulseRgb: '234,179,8' });
    }
  }
  // Terapkan filter status sesuai stat card yang diklik — satu fungsi generik untuk semua kartu.
  function filterByStatus(status) {
    filterState.status = status;
    buildStatusOptions(); applyFilters();
  }
  // Hari ini sebagai day-key (epoch hari, UTC) — dipakai untuk hitungan "segera kembali".
  function todayKey() { var n = new Date(); return ymdKey(n.getFullYear(), n.getMonth(), n.getDate()); }
  // Tanggal akhir cuti TERAKHIR milik satu baris (ambil yang paling belakangan dari 2 periode).
  function rowLastEndDay(r) {
    var akhir = null;
    [r.end1Raw, r.end2Raw].forEach(function(d) {
      if (!d) return;
      var k = dayKey(d);
      if (akhir === null || k > akhir) akhir = k;
    });
    return akhir;
  }
  // "Kembali Besok" = hari terakhir cuti adalah HARI INI, jadi besok staff ybs
  // mulai masuk kerja lagi (bukan lagi rentang "≤3 hari" seperti sebelumnya).
  function isKembaliBesok(r, hariIni) {
    var akhir = rowLastEndDay(r);
    return akhir !== null && akhir === (hariIni != null ? hariIni : todayKey());
  }
  function statCard(label, value, color, bg, icon, opts) {
    opts = opts || {};
    var extraClass = opts.extraClass || '';
    var attrs = (opts.onclick ? ' onclick="' + opts.onclick + '" role="button" tabindex="0" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click();}"' : '') +
      (opts.title ? ' title="' + esc(opts.title) + '"' : '') +
      (opts.pulseRgb ? ' style="--stat-alert-rgb:' + opts.pulseRgb + '"' : '');
    return '<div class="stat-item' + extraClass + '"' + attrs + '>' +
      '<div class="stat-ic" style="background:' + bg + ';color:' + color + '">' + icon + '</div>' +
      '<div class="stat-txt"><div class="label">' + esc(label) + '</div><div class="value">' + value + '</div></div>' +
    '</div>';
  }

  function taskCls(v) {
    var u = (v || '').toUpperCase();
    if (u === 'WAITING') return 'task-WAITING';
    if (u === 'SEDANG CUTI') return 'task-SEDANG';
    if (u === 'SELESAI CUTI') return 'task-selesaicuti';   // khusus dashboard cuti: merah pudar
    if (u === 'DONE CATAT') return 'task-donecatat';        // khusus dashboard cuti: hijau dominan
    return 'task-DONE';
  }
  function clashCell(perihal, startRaw, endRaw, nama, intervals, role, rowId, slot) {
    var info = clashInfo(perihal, startRaw, endRaw, nama, intervals, role);
    if (!info) return '<span class="pill pill-dash">–</span>';
    if (info.count <= 1) return '<span class="pill pill-clash-ok">✓ Aman</span>';
    var cls = info.count >= 3 ? 'pill-clash-alert' : 'pill-clash-warn';
    // Detail lengkap dihitung saat di-hover (lihat clashDetail), jadi render tabel tetap ringan.
    return '<span class="pill ' + cls + '" data-crow="' + esc(rowId) + '" data-cslot="' + slot +
      '" tabindex="0" aria-label="Lihat detail bentrok">⚠ ' + info.count + ' staff</span>';
  }

  // ── Detail bentrok (untuk tooltip) ────────────────────────────
  // Cari irisan tanggal antara cuti baris ini dengan cuti staff lain
  // yang ROLE & PERIHAL-nya sama.
  function clashDetail(rowId, slot) {
    var r = null;
    for (var i = 0; i < (_cache || []).length; i++) if (_cache[i].rowId === rowId) { r = _cache[i]; break; }
    if (!r) return null;

    var perihal = slot === 2 ? r.perihal2 : r.perihal1;
    var sRaw    = slot === 2 ? r.start2Raw : r.start1Raw;
    var eRaw    = slot === 2 ? r.end2Raw   : r.end1Raw;
    if (CLASH_PERIHAL.indexOf(perihal) === -1 || !sRaw || !eRaw) return null;

    var s = dayKey(sRaw), e = dayKey(eRaw);
    var list = clashIndex()[r.role] || [];
    var items = [];
    list.forEach(function(iv) {
      if (iv.nama === r.nama) return;
      var os = Math.max(s, iv.s), oe = Math.min(e, iv.e);   // irisan tanggal
      if (os > oe) return;                                   // tidak beririsan
      items.push({ nama: iv.nama, perihal: iv.perihal, s: os, e: oe, days: oe - os + 1 });
    });
    if (!items.length) return null;
    items.sort(function(a, b) { return a.s - b.s || a.nama.localeCompare(b.nama); });

    return { role: r.role, perihal: perihal, nama: r.nama, s: s, e: e, items: items };
  }

  // Tanggal ringkas: "3 – 7 Okt 2026" atau "3 Okt 2026"
  function rangeLabel(s, e) {
    var ds = keyToDate(s), de = keyToDate(e);
    var a = ds.getUTCDate() + ' ' + MONTHS_SHORT[ds.getUTCMonth()];
    var b = de.getUTCDate() + ' ' + MONTHS_SHORT[de.getUTCMonth()];
    if (ds.getUTCFullYear() !== de.getUTCFullYear()) a += ' ' + ds.getUTCFullYear();
    return (s === e ? a : a + ' – ' + b) + ' ' + de.getUTCFullYear();
  }

  var _tipEl = null;
  function tipEl() {
    if (!_tipEl) { _tipEl = document.createElement('div'); _tipEl.className = 'clash-tip'; document.body.appendChild(_tipEl); }
    return _tipEl;
  }
  function hideClashTip() { if (_tipEl) _tipEl.classList.remove('show'); }

  function showClashTip(pill) {
    var d = clashDetail(pill.getAttribute('data-crow'), +pill.getAttribute('data-cslot'));
    if (!d) return;
    var el = tipEl();
    var rows = d.items.map(function(it, i) {
      return '<div class="ct-row' + (i === 0 ? ' first' : '') + '">' +
        '<div class="ct-main">' +
          '<div class="ct-nm">' + esc(titleCase(shortName(it.nama))) + '</div>' +
          '<div class="ct-dt">' + esc(rangeLabel(it.s, it.e)) + '</div>' +
        '</div>' +
        '<span class="ct-d">' + it.days + ' hari</span>' +
      '</div>';
    }).join('');
    el.innerHTML =
      '<div class="ct-head">Bentrok ' + esc(d.perihal) + ' · ' + esc(d.role) + '</div>' + rows +
      '<div class="ct-foot">Cuti <span class="ct-you">' + esc(titleCase(shortName(d.nama))) + '</span>: ' +
      esc(rangeLabel(d.s, d.e)) + '</div>';

    // Tampilkan di atas pill; pindah ke bawah bila mepet tepi layar
    el.style.left = '0px'; el.style.top = '-9999px'; el.classList.add('show');
    var pr = pill.getBoundingClientRect(), tr = el.getBoundingClientRect();
    var left = pr.left + pr.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
    var top = pr.top - tr.height - 9;
    if (top < 8) top = pr.bottom + 9;
    el.style.left = Math.round(left) + 'px';
    el.style.top  = Math.round(top) + 'px';
  }

  (function bindClashTip() {
    var host = document.getElementById('tableBody');
    function pillOf(t) { return t && t.closest ? t.closest('[data-crow]') : null; }
    host.addEventListener('mouseover', function(e) { var p = pillOf(e.target); if (p) showClashTip(p); });
    host.addEventListener('mouseout',  function(e) { if (pillOf(e.target)) hideClashTip(); });
    host.addEventListener('focusin',   function(e) { var p = pillOf(e.target); if (p) showClashTip(p); });
    host.addEventListener('focusout',  hideClashTip);
    // Layar sentuh: tidak ada hover, jadi ketuk untuk membuka
    host.addEventListener('click', function(e) {
      var p = pillOf(e.target);
      if (p) { showClashTip(p); e.stopPropagation(); } else hideClashTip();
    });
    document.addEventListener('click', hideClashTip);
    window.addEventListener('scroll', hideClashTip, true);   // termasuk scroll di dalam tabel
    window.addEventListener('resize', hideClashTip);
  })();
  function totalCell(r) {
    var t = computeTotal([r.durasi1, r.durasi2], r.tambahan, r.role);
    if (t.total <= 0) return '<span class="pill pill-dash">–</span>';
    var cls = t.extra > 0 ? 'pill-total plus' : 'pill-total';
    var rincian = t.extra > 0
      ? 'Total ' + t.total + ' hari — ' + t.extra + ' hari di antaranya dari tambahan'
      : 'Total ' + t.total + ' hari (dalam batas normal)';
    var label = t.total + ' Hari' + (t.extra > 0 ? ' (+' + t.extra + ')' : '');
    return '<span class="pill ' + cls + '" title="' + esc(rincian) + '">' + esc(label) + '</span>';
  }

  function taskSelect(currentVal, rowId, taskList) {
    // Non-admin: status ditampilkan statis (tak bisa diubah)
    if (!isAdmin()) return '<span class="pill ' + taskCls(currentVal) + '" style="border-radius:var(--radius-pill);padding:4px 11px;">' + esc(currentVal) + '</span>';
    // Begitu statusnya sudah masuk fase Sedang Cuti / Selesai Cuti, opsi
    // "Waiting" & "Done Catat" tidak lagi ditawarkan — tidak boleh mundur
    // ke fase sebelum staff itu benar-benar mulai cuti.
    var curUp = String(currentVal || '').toUpperCase();
    var list = taskList;
    if (curUp === 'SEDANG CUTI' || curUp === 'SELESAI CUTI') {
      list = taskList.filter(function(t) {
        var u = String(t).toUpperCase();
        return u !== 'WAITING' && u !== 'DONE CATAT';
      });
    }
    var opts = list.map(function(t) { return '<option' + (t === currentVal ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
    return '<select class="task-select ' + taskCls(currentVal) + '" data-rowid="' + esc(rowId) + '" data-status="' + esc(currentVal) + '">' + opts + '</select>';
  }

  // Kolom Status pada tabel utama. Khusus menu Sedang Cuti (BERJALAN) untuk
  // admin: setiap baris di sana SELALU berstatus "Sedang Cuti" (itulah
  // syarat masuk segmen ini), jadi dropdownnya diganti langsung dengan
  // tombol konfirmasi "Sudah Masuk" — satu aksi yang jelas, bukan dropdown
  // + tombol terpisah di kolom Aksi yang bikin berdesakan/rancu.
  function statusCell(r, taskList) {
    if (filterState.segment === 'BERJALAN' && isAdmin()) {
      return '<button class="btn-mark-return" title="Tandai staff ini sudah masuk kerja kembali" onclick="tandaiSudahMasuk(\'' + esc(r.rowId) + '\',\'' + esc(r.nama) + '\')">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
          '<span>Sudah Masuk</span>' +
        '</button>';
    }
    return taskSelect(r.task1, r.rowId, taskList);
  }
  function findPendingRevisi(rowId) {
    var found = null;
    (_revisiCache || []).some(function(r) { if (r.cutiId === rowId && r.status === 'PENDING') { found = r; return true; } return false; });
    return found;
  }
  // Bila sebuah baris cuti pindah ke status arsip (mis. SELESAI CUTI), pengajuan
  // revisi PENDING yang masih menggantung untuk baris itu otomatis ditolak — cuti
  // sudah ditutup, jadi permintaan ubah tanggal untuknya sudah tidak relevan dan
  // tidak boleh menggantung selamanya sebagai "Minta Revisi". Dipakai dari SEMUA
  // jalur yang bisa memindahkan status ke arsip (tombol "Sudah Masuk Kerja" MAUPUN
  // dropdown status biasa) supaya keduanya konsisten — sebelumnya hanya salah satu
  // jalur yang membersihkan revisi PENDING, yang lain membiarkannya menggantung.
  function autoRejectPendingRevisiForRow(rowId) {
    var pendingRevisi = findPendingRevisi(rowId);
    if (!pendingRevisi) return Promise.resolve(null);
    return sbPatch('revisi_cuti', 'id=eq.' + encodeURIComponent(pendingRevisi.id), {
      status: 'DITOLAK', catatan_admin: 'Otomatis ditolak — cuti sudah ditandai selesai/diarsipkan'
    }).then(function() {
      if (_revisiCache) {
        for (var j = 0; j < _revisiCache.length; j++) {
          if (_revisiCache[j].id === pendingRevisi.id) { _revisiCache[j].status = 'DITOLAK'; break; }
        }
      }
      updateRevisiCount();
      return pendingRevisi;
    }).catch(function() { return null; /* diam-diam gagal — bukan blocker status cuti utamanya */ });
  }
  function actionCell(rowId, label) {
    // Non-admin: tombol revisi hanya di menu Dashboard
    if (!isAdmin()) {
      if (filterState.segment === 'AKTIF') {
        // Cek apakah sudah ada revisi PENDING untuk cuti ini
        var hasPending = !!findPendingRevisi(rowId);
        if (hasPending) {
          return '<span class="row-actions">' +
            '<button class="icon-btn" title="Revisi sedang diproses" disabled style="border-color:var(--yellow-bd);color:var(--yellow);opacity:.5;cursor:not-allowed;">' +
              '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
            '</button></span>';
        }
        return '<span class="row-actions">' +
          '<button class="icon-btn" title="Ajukan Revisi" onclick="openRevisiForm(\'' + esc(rowId) + '\')" style="border-color:var(--yellow-bd);color:var(--yellow);">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button></span>';
      }
      return '<span class="row-actions" style="color:var(--faint);font-size:12px;">—</span>';
    }
    // Admin: kalau baris ini punya pengajuan revisi yang menunggu, tambahkan tombol Review
    // yang sengaja tampil beda (pill kuning berlabel) dari tombol ikon Ubah/Hapus di sebelahnya.
    var pendingRevisi = findPendingRevisi(rowId);
    var revisiBtn = pendingRevisi
      ? '<button class="btn-review-revisi" title="Review pengajuan revisi cuti" onclick="openRevisiReview(\'' + esc(pendingRevisi.id) + '\')">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '<span>Review</span>' +
        '</button>'
      : '';
    // Catatan: tombol "Tandai Sudah Masuk Kerja" untuk menu Sedang Cuti TIDAK
    // ditaruh di sini lagi — sekarang menggantikan dropdown di kolom Status
    // itu sendiri (lihat statusCell), supaya tidak ada dua cara berbeda untuk
    // hal yang sama dan kolom Aksi tidak berdesakan.
    return '<span class="row-actions">' +
      revisiBtn +
      '<button class="icon-btn" title="Ubah" onclick="openEdit(\'' + esc(rowId) + '\')">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
      '</button>' +
      '<button class="icon-btn danger" title="Hapus" onclick="deleteRow(\'' + esc(rowId) + '\',\'' + esc(label) + '\')">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
      '</button>' +
    '</span>';
  }

  // ── COPY FORMAT ───────────────────────────────────────────────
  // Isi dropdown leader; bila belum ada data, pakai nama bawaan
  function fillLdr(selected) {
    var sel = document.getElementById('ldrSelect');
    if (!sel) return;
    var list = (CONFIG.LDR && CONFIG.LDR.length) ? CONFIG.LDR.slice() : [ACC_LDR];
    var cur = selected || (sel.value && sel.value !== ADD ? sel.value : null);
    if (!cur || list.indexOf(cur) === -1) cur = list.indexOf(ACC_LDR) >= 0 ? ACC_LDR : list[0];
    var parts = list.map(function(v) {
      return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    parts.push('<option value="' + ADD + '">＋ Tambah leader…</option>');
    sel.innerHTML = parts.join('');
  }
  function currentLeader() {
    var sel = document.getElementById('ldrSelect');
    var v = sel && sel.value;
    return (v && v !== ADD) ? v : ACC_LDR;
  }

  // Susun teks pengajuan siap tempel (WhatsApp/grup)
  function buildCopyFormat(r) {
    var leaves = [];
    if (r.perihal1 && r.start1Raw && r.end1Raw)
      leaves.push({ p: r.perihal1, s: r.start1Raw, e: r.end1Raw, d: r.durasi1 });
    if (r.perihal2 && r.start2Raw && r.end2Raw)
      leaves.push({ p: r.perihal2, s: r.start2Raw, e: r.end2Raw, d: r.durasi2 });

    var judul = leaves.map(function(l) { return l.p; }).join(' & ');
    var lines = [];
    lines.push(COPY_HEADER);
    lines.push('PENGAJUAN CUTI : ' + judul + ' ( ' + (r.keterangan || '') + ' )');
    lines.push('Nama Staff : ' + r.nama);
    lines.push('Status : ' + r.role);
    lines.push('');
    lines.push('Tanggal Pengajuan : ');
    leaves.forEach(function(l) {
      lines.push(l.p + ' : ' + formatDate(l.s) + ' - ' + formatDate(l.e) + ' ( ' + l.d + ' )');
    });
    // Baris keterangan penambahan hari (hanya bila memang ada tambahan)
    if (r.tambahan && !/tidak ada/i.test(r.tambahan)) lines.push(r.tambahan);
    lines.push('');
    lines.push('ACC LDR : ' + currentLeader());
    return lines.join('\n');
  }

  // Salin ke clipboard; pakai cara cadangan bila API modern tidak tersedia
  function copyText(text) {
    return new Promise(function(resolve, reject) {
      function fallback() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed'; ta.style.top = '-9999px'; ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select(); ta.setSelectionRange(0, ta.value.length);
          var ok = document.execCommand && document.execCommand('copy');
          document.body.removeChild(ta);
          ok ? resolve() : reject(new Error('Browser menolak penyalinan'));
        } catch (e) { reject(e); }
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(resolve, fallback);
      } else fallback();
    });
  }

  // Panel cadangan: tampilkan teks agar bisa disalin manual
  function showCopyFallback(text) {
    var ov = document.getElementById('copyOverlay');
    var box = document.getElementById('copyText');
    box.value = text;
    ov.classList.add('open');
    setTimeout(function() { box.focus(); box.select(); }, 60);
  }
  function closeCopy() { document.getElementById('copyOverlay').classList.remove('open'); }

  function copyRow(rowId, btn) {
    var r = null;
    for (var i = 0; i < (_cache || []).length; i++) if (_cache[i].rowId === rowId) { r = _cache[i]; break; }
    if (!r) return;
    var text = buildCopyFormat(r);
    copyText(text).then(function() {
      toast('Format pengajuan disalin', 'ok');
      if (btn) {   // umpan balik singkat di tombol
        var label = btn.querySelector('span'), asli = label ? label.textContent : '';
        btn.classList.add('done'); if (label) label.textContent = 'Tersalin';
        setTimeout(function() { btn.classList.remove('done'); if (label) label.textContent = asli; }, 1600);
      }
    }).catch(function() {
      showCopyFallback(text);
    });
  }

  function roleCls(role) {
    var u = String(role || '').trim().toUpperCase();
    if (u === 'CS' || u === 'KAPTEN' || u === 'KASIR') return 'role-' + u;
    return '';   // role lain → warna netral
  }
  function periodeCell(sRaw, eRaw) {
    if (!sRaw || !eRaw) return '<span class="pill-dash">–</span>';
    return '<span class="periode" title="' + esc(formatDate(sRaw) + ' – ' + formatDate(eRaw)) + '">' +
      esc(formatDateShort(sRaw)) + '<i>→</i>' + esc(formatDateShort(eRaw)) + '</span>';
  }
  function passportCell(v) {
    var s = String(v || '');
    if (!s) return '<span class="pill pill-dash">–</span>';
    var ambil = !/tidak/i.test(s);
    return '<span class="pill ' + (ambil ? 'pill-pass-yes' : 'pill-pass-no') + '" title="' + esc(s) + '">' +
      (ambil ? 'Ambil' : 'Tidak') + '</span>';
  }

  function copyCell(rowId) {
    return '<button class="copy-btn" type="button" title="Salin format pengajuan" onclick="copyRow(\'' + esc(rowId) + '\', this)">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
      '<span>Salin</span></button>';
  }

  function renderTable(rows, intervals) {
    var tbody = document.getElementById('tableBody');
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty">Tidak ada pengajuan yang cocok dengan filter.</td></tr>';
      return;
    }
    var taskList = taskOptions();
    var parts = [];
    var total = rows.length;
    var shown = (_showAllRows || total <= ROW_LIMIT) ? rows : rows.slice(0, ROW_LIMIT);
    shown.forEach(function(r, ri) {
      var has2 = !!(r.start2Raw || r.perihal2);
      var alt = (ri % 2 === 1) ? ' rec-alt' : '';
      var hasRevisi = !!findPendingRevisi(r.rowId);
      var isWaiting = String(r.task1 || '').toUpperCase() === 'WAITING';
      var line2 = function(html) { return has2 ? '<div style="margin-top:3px;padding-top:3px;border-top:1px solid rgba(148,163,184,.1);">' + html + '</div>' : ''; };
      parts.push('<tr class="rec' + alt + (isWaiting ? ' is-waiting' : '') + (hasRevisi ? ' has-revisi' : '') + '">' +
        '<td><span class="pill pill-role ' + roleCls(r.role) + '">' + esc(r.role) + '</span></td>' +
        '<td><span class="cell-name" title="' + esc(r.nama) + '">' + esc(r.nama) + '</span></td>' +
        '<td style="white-space:normal;">' + periodeCell(r.start1Raw, r.end1Raw) +
          (has2 ? '<div style="margin-top:3px;padding-top:3px;border-top:1px solid rgba(148,163,184,.1);"><span style="color:var(--faint);margin-right:3px;font-size:11px;">↳</span>' + periodeCell(r.start2Raw, r.end2Raw) + '</div>' : '') + '</td>' +
        '<td style="white-space:normal;"><span class="pill pill-durasi">' + esc(r.durasi1) + '</span>' +
          (has2 ? line2('<span class="pill pill-durasi">' + esc(r.durasi2) + '</span>') : '') + '</td>' +
        '<td style="white-space:normal;"><span class="pill pill-perihal">' + esc(r.perihal1) + '</span>' +
          (has2 ? line2('<span class="pill pill-perihal">' + esc(r.perihal2) + '</span>') : '') + '</td>' +
        '<td style="white-space:normal;">' + clashCell(r.perihal1, r.start1Raw, r.end1Raw, r.nama, intervals, r.role, r.rowId, 1) +
          (has2 ? line2(clashCell(r.perihal2, r.start2Raw, r.end2Raw, r.nama, intervals, r.role, r.rowId, 2)) : '') + '</td>' +
        '<td>' + totalCell(r) + '</td>' +
        '<td>' + passportCell(r.keterangan) + '</td>' +
        '<td>' + statusCell(r, taskList) + '</td>' +
        '<td>' + copyCell(r.rowId) + '</td>' +
        '<td>' + actionCell(r.rowId, r.nama) + '</td>' +
      '</tr>');
    });
    if (shown.length < total) {
      parts.push('<tr class="more-row"><td colspan="11">' +
        '<button class="btn btn-secondary btn-sm" type="button" onclick="showAllRows()">Tampilkan semua ' + total + ' pengajuan</button>' +
        '<span class="more-note">Menampilkan ' + shown.length + ' terbaru agar tabel tetap ringan.</span>' +
        '</td></tr>');
    }
    tbody.innerHTML = parts.join('');
  }
  function showAllRows() { _showAllRows = true; applyFilters(); }

  // status change (task-select)
  // Simpan perubahan status ke database
  function simpanStatus(sel, rowId, value, oldVal) {
    sel.classList.add('task-saving');
    sbPatch('cuti', 'id=eq.' + encodeURIComponent(rowId), { task1: value }).then(function() {
      sel.classList.remove('task-saving');
      sel.className = 'task-select ' + taskCls(value); sel.setAttribute('data-status', value);
      sel.classList.add('task-flash'); setTimeout(function() { sel.classList.remove('task-flash'); }, 700);
      logActivity('CUTI', 'STATUS', (function(){ var n=''; (_cache||[]).forEach(function(r){ if(r.rowId===rowId) n=r.nama; }); return 'Status cuti ' + (n||rowId) + ' → ' + value; })());
      if (_cache) { for (var i = 0; i < _cache.length; i++) if (_cache[i].rowId === rowId) { _cache[i].task1 = value; break; } _filterVer++; _memoStatus = null; }
      buildMonthOptions(); buildStatusOptions();   // hitungan filter ikut menyesuaikan
      applyFilters();          // baris otomatis berpindah ke menu yang sesuai
      updateTabCounts();
      // Beri tahu ke mana baris ini berpindah (bila memang keluar dari menu saat ini)
      var tujuan = isOngoing(value) ? 'BERJALAN' : isArchived(value) ? 'ARSIP' : 'AKTIF';
      var namaMenu = { BERJALAN: 'Sedang Cuti', ARSIP: 'Selesai Cuti', AKTIF: 'Dashboard' };
      toast(tujuan !== filterState.segment
        ? 'Status diperbarui — dipindahkan ke ' + namaMenu[tujuan]
        : 'Status diperbarui', 'ok');
      // Status baru bersifat arsip → revisi PENDING terkait (kalau ada) ikut
      // otomatis ditolak, sama seperti jalur tombol "Sudah Masuk Kerja".
      if (isArchived(value)) autoRejectPendingRevisiForRow(rowId);
    }).catch(function(err) {
      sel.classList.remove('task-saving'); sel.value = oldVal; toast('Gagal update status: ' + err.message, 'err');
    });
  }

  // Tombol "Tandai Sudah Masuk Kerja" di baris Sedang Cuti — memindahkan
  // status cuti ke "Selesai Cuti" langsung lewat sbPatch (kolom Status di
  // menu ini sudah bukan <select> lagi, jadi TIDAK bisa lagi numpang lewat
  // simpanStatus() yang butuh elemen <select> asli). Kalau baris ini masih
  // punya pengajuan revisi yang PENDING, revisi itu otomatis ditolak juga —
  // cuti sudah ditutup, jadi permintaan ubah tanggal untuknya sudah tidak
  // relevan lagi dan tidak boleh menggantung selamanya sebagai "Minta Revisi".
  function tandaiSudahMasuk(rowId, label) {
    var row = null;
    (_cache || []).forEach(function(r) { if (r.rowId === rowId) row = r; });
    if (row && String(row.task1 || '').toUpperCase() === 'SELESAI CUTI') return; // sudah selesai, tak perlu apa-apa

    var pendingRevisi = findPendingRevisi(rowId);
    var warnRevisi = pendingRevisi
      ? ' Pengajuan revisi cuti yang masih menunggu untuk baris ini akan otomatis ditolak.'
      : '';

    confirmDialog({
      title: 'Tandai Sudah Masuk Kerja',
      text: 'Tandai "' + label + '" sudah masuk kerja kembali? Status cutinya akan dipindah ke "Selesai Cuti".' + warnRevisi,
      okLabel: 'Ya, sudah masuk',
      okClass: 'btn-primary',
      cancelLabel: 'Batal'
    }, function() {
      sbPatch('cuti', 'id=eq.' + encodeURIComponent(rowId), { task1: 'SELESAI CUTI' }).then(function() {
        logActivity('CUTI', 'STATUS', 'Status cuti ' + (label || rowId) + ' → SELESAI CUTI (tandai sudah masuk kerja)');
        if (_cache) { for (var i = 0; i < _cache.length; i++) if (_cache[i].rowId === rowId) { _cache[i].task1 = 'SELESAI CUTI'; break; } _filterVer++; _memoStatus = null; }
        buildMonthOptions(); buildStatusOptions();
        applyFilters();
        updateTabCounts();
        toast('"' + label + '" ditandai sudah masuk kerja — dipindahkan ke Selesai Cuti', 'ok');
        return autoRejectPendingRevisiForRow(rowId);
      }).catch(function(err) {
        toast('Gagal menandai — ' + (err && err.message ? err.message : 'coba lagi'), 'err');
      });
    });
  }

  document.getElementById('tableBody').addEventListener('change', function(e) {
    var sel = e.target;
    if (!sel.classList.contains('task-select')) return;
    var rowId = sel.dataset.rowid, value = sel.value, oldVal = sel.getAttribute('data-status');
    if (value === oldVal) return;                       // tidak berubah → abaikan

    var nama = '';
    if (_cache) for (var i = 0; i < _cache.length; i++) if (_cache[i].rowId === rowId) { nama = _cache[i].nama; break; }

    confirmDialog({
      title: 'Ubah Status Cuti',
      warn: 'HANYA LEADER DAN CS LINE YANG MENGUBAH STATUS CUTI',
      text: 'Ubah status ' + (nama ? nama + ' ' : '') + 'dari "' + oldVal + '" menjadi "' + value + '"?',
      okLabel: 'Ya, ubah status',
      okClass: 'btn-primary',
      cancelLabel: 'Batal'
    },
    function() { simpanStatus(sel, rowId, value, oldVal); },   // disetujui
    function() { sel.value = oldVal; }                          // dibatalkan → kembalikan
    );
  });

  // close modal on overlay/Escape
  document.getElementById('editOverlay').addEventListener('click', function(e) { if (e.target === this) closeEdit(); });
  document.getElementById('copyOverlay').addEventListener('click', function(e) { if (e.target === this) closeCopy(); });
  document.getElementById('confirmOverlay').addEventListener('click', function(e) { if (e.target === this) closeConfirm(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeEdit(); closeCopy(); closeConfirm(); closeRekEdit(); closeResignEdit(); closeRevisiForm(); closeRevisiReview(); closeRevisiEdit(); closeBgSettings(); }
  });

  // ══════════════════════════════════════════════════════════════
  // MODUL GANTI REKENING
  // ══════════════════════════════════════════════════════════════
  var REK_STATUSES = ['WAITING', 'DONE'];
  var _rekCache = null, _rekLoaded = false;
  var rekFilter = { status: 'ALL', search: '' };
  var rekEditingId = null;

  function rekTaskList() { return CONFIG.TASK_REK.length ? CONFIG.TASK_REK : REK_STATUSES; }

  function getRekening() {
    return sbGet('rekening', 'select=*&order=created_at.desc').then(function(rows) {
      return rows.map(function(r) {
        return {
          rowId: r.id, id: r.id_pengajuan || r.id, timestamp: r.created_at || '',
          paspor: r.no_paspor || '', nama: r.nama || '',
          bankLama: r.bank_lama || '', rekLama: r.rek_lama || '', pemilikLama: r.pemilik_lama || '',
          bankBaru: r.bank_baru || '', rekBaru: r.rek_baru || '', pemilikBaru: r.pemilik_baru || '',
          alasan: r.alasan || '',
          task: r.task || 'WAITING'
        };
      });
    });
  }

  function genRekId() {
    var now = new Date();
    function pad(n) { return String(n).padStart(2, '0'); }
    return 'REK-' + now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '-' +
      pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '-' + randSuffix(12);
  }

  // Buang spasi/strip yang biasa diketik orang, sisakan angka saja
  function cleanRek(v) { return String(v || '').replace(/[\s\-\.]/g, ''); }

  // Kumpulkan & validasi isi form. Lempar Error bila ada yang salah.
  function gatherRek(prefix) {
    function val(id) { var el = document.getElementById(prefix + id); return el ? String(el.value || '').trim() : ''; }
    var d = {
      paspor: val('paspor').toUpperCase(),
      nama: val('nama').toUpperCase(),
      rekLama: cleanRek(val('rekLama')), bankLama: val('bankLama'), pemilikLama: val('pemilikLama').toUpperCase(),
      rekBaru: cleanRek(val('rekBaru')), bankBaru: val('bankBaru'), pemilikBaru: val('pemilikBaru').toUpperCase(),
      alasan: val('alasan').toUpperCase()
    };
    if (!d.paspor) throw new Error('Isi nomor paspor.');
    if (!d.nama) throw new Error('Isi nama staff.');
    if (!d.rekLama) throw new Error('Isi nomor rekening sebelumnya.');
    if (!/^\d+$/.test(d.rekLama)) throw new Error('Nomor rekening sebelumnya hanya boleh berisi angka.');
    if (d.rekLama.length < 6) throw new Error('Nomor rekening sebelumnya terlalu pendek (minimal 6 angka).');
    if (!d.bankLama || d.bankLama === ADD) throw new Error('Pilih bank rekening sebelumnya.');
    if (!d.pemilikLama) throw new Error('Isi nama pemilik rekening sebelumnya.');
    if (!d.rekBaru) throw new Error('Isi nomor rekening terbaru.');
    if (!/^\d+$/.test(d.rekBaru)) throw new Error('Nomor rekening terbaru hanya boleh berisi angka.');
    if (d.rekBaru.length < 6) throw new Error('Nomor rekening terbaru terlalu pendek (minimal 6 angka).');
    if (!d.bankBaru || d.bankBaru === ADD) throw new Error('Pilih bank rekening terbaru.');
    if (!d.pemilikBaru) throw new Error('Isi nama pemilik rekening terbaru.');
    if (!d.alasan) throw new Error('Isi alasan mengganti rekening.');
    return d;
  }

  function rekPayload(id, d, task) {
    return {
      id: id, id_pengajuan: id, no_paspor: d.paspor, nama: d.nama,
      bank_lama: d.bankLama, rek_lama: d.rekLama, pemilik_lama: d.pemilikLama,
      bank_baru: d.bankBaru, rek_baru: d.rekBaru, pemilik_baru: d.pemilikBaru,
      alasan: d.alasan,
      task: task || 'WAITING'
    };
  }

  // ── Form ──────────────────────────────────────────────────────
  function toggleRekForm(force) {
    var panel = document.getElementById('rekFormPanel');
    var btn = document.getElementById('rekToggleBtn');
    var open = (force === undefined) ? !panel.classList.contains('open') : !!force;
    panel.classList.toggle('open', open);
    btn.innerHTML = open ? '✕ Tutup form' : '＋ Ajukan Ganti Rekening';
    btn.classList.toggle('btn-primary', !open);
    btn.classList.toggle('btn-secondary', open);
    if (!open) rekMsg('', '');
  }
  document.getElementById('rekFormPanel').addEventListener('click', function(e) { if (e.target === this) toggleRekForm(false); });
  function rekMsg(type, text) {
    var el = document.getElementById('r_formMsg');
    el.className = 'msg ' + (type || ''); el.textContent = text || '';
    if (text) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function resetRekForm() {
    ['r_paspor','r_nama','r_rekLama','r_pemilikLama','r_rekBaru','r_pemilikBaru','r_alasan'].forEach(function(id) {
      document.getElementById(id).value = '';
    });
    fillSelect(document.getElementById('r_bankLama'), 'BANK', '');
    fillSelect(document.getElementById('r_bankBaru'), 'BANK', '');
    rekMsg('', '');
    rekLiveNote();
  }

  // Catatan langsung: ingatkan bila rekening baru sama persis dengan yang lama
  function rekLiveNote() {
    var note = document.getElementById('r_note');
    if (!note) return;
    var a = cleanRek(document.getElementById('r_rekLama').value);
    var b = cleanRek(document.getElementById('r_rekBaru').value);
    var bankA = document.getElementById('r_bankLama').value;
    var bankB = document.getElementById('r_bankBaru').value;
    if (a && b && a === b && bankA === bankB) {
      note.innerHTML = '⚠️ Rekening terbaru <strong>sama persis</strong> dengan rekening sebelumnya — pastikan ini memang disengaja.';
      note.classList.add('note-hi');
    } else {
      note.textContent = 'Nomor rekening hanya boleh berisi angka.';
      note.classList.remove('note-hi');
    }
  }
  ['r_rekLama','r_rekBaru','r_bankLama','r_bankBaru'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', rekLiveNote);
  });

  document.getElementById('r_submitBtn').addEventListener('click', function() {
    var d;
    try { d = gatherRek('r_'); } catch (err) { return rekMsg('error', err.message); }
    var btn = this;
    btn.disabled = true; btn.textContent = 'Mengirim…';
    var id = genRekId();
    sbPost('rekening', rekPayload(id, d, 'WAITING'), { 'Prefer': 'return=minimal' }).then(function() {
      btn.disabled = false; btn.textContent = '📤 Kirim pengajuan';
      rekMsg('success', 'Pengajuan berhasil dibuat — ID: ' + id);
      toast('Pengajuan ganti rekening tersimpan', 'ok');
      logActivity('REKENING', 'CREATE', 'Ganti rekening ' + d.nama);
      resetRekForm(); toggleRekForm(false);
      _rekLoaded = false; loadRekening(true);
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '📤 Kirim pengajuan';
      rekMsg('error', 'Gagal menyimpan: ' + err.message);
    });
  });

  // ── Muat & render ─────────────────────────────────────────────
  function loadRekening(force) {
    var loading = document.getElementById('rekLoading');
    var content = document.getElementById('rekContent');
    var refresh = document.getElementById('rekRefreshBtn');
    if (!force && _rekLoaded && _rekCache) { renderRekAll(); content.style.display = 'block'; loading.style.display = 'none'; return; }

    loading.style.display = 'block'; loading.textContent = 'Memuat data…';
    content.style.display = 'none';
    document.getElementById('rekStatBox').innerHTML = renderSkeletonStats();
    if (refresh) refresh.disabled = true;

    getRekening().then(function(rows) {
      _rekCache = rows; _rekLoaded = true;
      loading.style.display = 'none';
      document.getElementById('rekStatBox').innerHTML = '';
      renderRekAll(); content.style.display = 'block';
    }).catch(function(err) {
      loading.textContent = '❌ Gagal memuat data: ' + err.message;
      document.getElementById('rekStatBox').innerHTML = '';
    }).finally(function() { if (refresh) refresh.disabled = false; });
  }

  function renderRekAll() { renderRekChips(); applyRekFilters(); updateRekCount(); }

  function updateRekCount() {
    var waiting = (_rekCache || []).filter(function(r) { return String(r.task).toUpperCase() === 'WAITING'; }).length;
    var total = (_rekCache || []).length;
    var el = document.getElementById('rekCount');
    if (el) { el.textContent = waiting; el.style.display = waiting ? '' : 'none'; }
    var sb = document.getElementById('sbRekCount');
    if (sb) { sb.textContent = total; sb.style.display = total ? '' : 'none'; }
    refreshWaitingAlert();
  }

  function renderRekChips() {
    var wrap = document.getElementById('rekChips');
    var list = ['ALL'].concat(rekTaskList());
    wrap.innerHTML = list.map(function(s) {
      var active = rekFilter.status === s ? ' active' : '';
      return '<button class="chip' + active + '" data-rekstatus="' + esc(s) + '">' + esc(s === 'ALL' ? 'Semua' : s) + '</button>';
    }).join('');
    wrap.querySelectorAll('.chip').forEach(function(c) {
      c.addEventListener('click', function() {
        rekFilter.status = c.dataset.rekstatus; renderRekChips(); applyRekFilters();
      });
    });
  }

  var _rekSearchTimer = null;
  document.getElementById('rekSearch').addEventListener('input', function() {
    var v = this.value.trim().toLowerCase();
    clearTimeout(_rekSearchTimer);
    _rekSearchTimer = setTimeout(function() { rekFilter.search = v; applyRekFilters(); }, 140);
  });

  function matchRek(r) {
    if (rekFilter.status !== 'ALL' && String(r.task).toUpperCase() !== rekFilter.status.toUpperCase()) return false;
    if (rekFilter.search) {
      var hay = (r.nama + ' ' + r.paspor + ' ' + r.rekLama + ' ' + r.rekBaru + ' ' + r.id).toLowerCase();
      if (hay.indexOf(rekFilter.search) === -1) return false;
    }
    return true;
  }

  function applyRekFilters() {
    if (!_rekCache) return;
    var rows = _rekCache.filter(matchRek);
    var filtered = (rekFilter.status !== 'ALL' || rekFilter.search);
    document.getElementById('rekResultCount').innerHTML =
      'Menampilkan <strong>' + rows.length + '</strong> dari ' + _rekCache.length + ' pengajuan' + (filtered ? ' · terfilter' : '');
    renderRekStats(rows);
    renderRekTable(rows);
  }

  function renderRekStats(rows) {
    var waiting = 0, done = 0;
    rows.forEach(function(r) {
      if (String(r.task).toUpperCase() === 'WAITING') waiting++; else done++;
    });
    document.getElementById('rekStatBox').innerHTML =
      statCard('Total Pengajuan', rows.length, 'var(--brand-ink)', 'var(--brand-050)', '🏦') +
      statCard('Waiting', waiting, 'var(--amber)', 'var(--amber-bg)', '⏳') +
      statCard('Done', done, 'var(--green)', 'var(--green-bg)', '✅');
  }

  function rekTaskCls(v) { return String(v || '').toUpperCase() === 'WAITING' ? 'task-WAITING' : 'task-SELESAI'; }

  // Tampilkan nomor rekening + bank dalam satu sel
  function rekCell(nomor, bank, pemilik) {
    if (!nomor) return '<span class="pill pill-dash">–</span>';
    return '<span class="rek-cell" title="' + esc(pemilik) + '">' +
      '<span class="rek-no">' + esc(nomor) + '</span>' +
      '<span class="rek-bank">' + esc(bank) + '</span>' +
      (pemilik ? '<span class="rek-pemilik">' + esc(pemilik) + '</span>' : '') +
    '</span>';
  }

  function renderRekTable(rows) {
    var tbody = document.getElementById('rekTableBody');
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Belum ada pengajuan ganti rekening.</td></tr>';
      return;
    }
    var list = rekTaskList();
    tbody.innerHTML = rows.map(function(r, i) {
      var opts = list.map(function(t) {
        return '<option' + (t === r.task ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join('');
      var alasanShort = r.alasan.length > 35 ? r.alasan.slice(0, 35) + '…' : r.alasan;
      return '<tr class="rec' + (i % 2 === 1 ? ' rec-alt' : '') + '">' +
        '<td><span class="cell-name" title="' + esc(r.nama) + '">' + esc(r.nama) + '</span></td>' +
        '<td><span class="pill pill-perihal">' + esc(r.paspor) + '</span></td>' +
        '<td>' + rekCell(r.rekLama, r.bankLama, r.pemilikLama) + '</td>' +
        '<td>' + rekCell(r.rekBaru, r.bankBaru, r.pemilikBaru) + '</td>' +
        '<td title="' + esc(r.alasan) + '">' + esc(alasanShort || '-') + '</td>' +
        '<td>' + (isAdmin()
          ? '<select class="task-select ' + rekTaskCls(r.task) + '" data-rekrow="' + esc(r.rowId) +
            '" data-status="' + esc(r.task) + '">' + opts + '</select>'
          : '<span class="pill ' + rekTaskCls(r.task) + '" style="border-radius:var(--radius-pill);padding:4px 11px;">' + esc(r.task) + '</span>') + '</td>' +
        '<td><button class="copy-btn" type="button" title="Salin format pengajuan" onclick="copyRek(\'' + esc(r.rowId) + '\', this)">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '<span>Salin</span></button></td>' +
        '<td>' + (isAdmin() ? '<span class="row-actions">' +
          '<button class="icon-btn" title="Ubah" onclick="openRekEdit(\'' + esc(r.rowId) + '\')">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button>' +
          '<button class="icon-btn danger" title="Hapus" onclick="deleteRek(\'' + esc(r.rowId) + '\',\'' + esc(r.nama) + '\')">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
          '</button>' +
        '</span>' : '<span class="row-actions" style="color:var(--faint);font-size:12px;">—</span>') + '</td>' +
      '</tr>';
    }).join('');
  }

  // ── Ubah status ───────────────────────────────────────────────
  document.getElementById('rekTableBody').addEventListener('change', function(e) {
    var sel = e.target;
    if (!sel.classList.contains('task-select')) return;
    var rowId = sel.dataset.rekrow, value = sel.value, oldVal = sel.getAttribute('data-status');
    if (value === oldVal) return;
    var nama = '';
    (_rekCache || []).forEach(function(r) { if (r.rowId === rowId) nama = r.nama; });

    confirmDialog({
      title: 'Ubah Status Ganti Rekening',
      warn: 'HANYA LEADER DAN CS LINE YANG MENGUBAH STATUS',
      text: 'Ubah status ' + (nama ? nama + ' ' : '') + 'dari "' + oldVal + '" menjadi "' + value + '"?',
      okLabel: 'Ya, ubah status', okClass: 'btn-primary', cancelLabel: 'Batal'
    }, function() {
      sel.classList.add('task-saving');
      sbPatch('rekening', 'id=eq.' + encodeURIComponent(rowId), { task: value }).then(function() {
        sel.classList.remove('task-saving');
        sel.className = 'task-select ' + rekTaskCls(value);
        sel.setAttribute('data-status', value);
        sel.classList.add('task-flash'); setTimeout(function() { sel.classList.remove('task-flash'); }, 700);
        (_rekCache || []).forEach(function(r) { if (r.rowId === rowId) r.task = value; });
        applyRekFilters(); updateRekCount();
        toast('Status diperbarui', 'ok');
        logActivity('REKENING', 'STATUS', 'Status rekening ' + (nama||rowId) + ' → ' + value);
      }).catch(function(err) {
        sel.classList.remove('task-saving'); sel.value = oldVal;
        toast('Gagal update status: ' + err.message, 'err');
      });
    }, function() { sel.value = oldVal; });
  });

  // ── Edit ──────────────────────────────────────────────────────
  function openRekEdit(rowId) {
    var r = null;
    (_rekCache || []).forEach(function(x) { if (x.rowId === rowId) r = x; });
    if (!r) return;
    rekEditingId = rowId;
    document.getElementById('re_paspor').value = r.paspor;
    document.getElementById('re_nama').value = r.nama;
    document.getElementById('re_rekLama').value = r.rekLama;
    document.getElementById('re_pemilikLama').value = r.pemilikLama;
    document.getElementById('re_rekBaru').value = r.rekBaru;
    document.getElementById('re_pemilikBaru').value = r.pemilikBaru;
    document.getElementById('re_alasan').value = r.alasan || '';
    fillSelect(document.getElementById('re_bankLama'), 'BANK', r.bankLama);
    fillSelect(document.getElementById('re_bankBaru'), 'BANK', r.bankBaru);
    var t = document.getElementById('re_task');
    t.innerHTML = rekTaskList().map(function(v) {
      return '<option' + (v === r.task ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
    var m = document.getElementById('re_msg'); m.className = 'msg'; m.textContent = '';
    document.getElementById('rekEditOverlay').classList.add('open');
  }
  function closeRekEdit() { document.getElementById('rekEditOverlay').classList.remove('open'); rekEditingId = null; }

  document.getElementById('re_save').addEventListener('click', function() {
    if (!rekEditingId) return;
    var el = document.getElementById('re_msg');
    var d;
    try { d = gatherRek('re_'); }
    catch (err) { el.className = 'msg error'; el.textContent = err.message; return; }
    var patch = rekPayload(rekEditingId, d, document.getElementById('re_task').value);
    delete patch.id; delete patch.id_pengajuan;
    var btn = this; btn.disabled = true; btn.textContent = 'Menyimpan…';
    sbPatch('rekening', 'id=eq.' + encodeURIComponent(rekEditingId), patch).then(function() {
      btn.disabled = false; btn.textContent = '💾 Simpan perubahan';
      closeRekEdit(); toast('Perubahan tersimpan', 'ok');
      logActivity('REKENING', 'UPDATE', 'Edit rekening ' + (document.getElementById('rke_nama') ? document.getElementById('rke_nama').value : rekEditingId));
      _rekLoaded = false; loadRekening(true);
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '💾 Simpan perubahan';
      el.className = 'msg error'; el.textContent = 'Gagal menyimpan: ' + err.message;
    });
  });

  // ── Hapus ─────────────────────────────────────────────────────
  function deleteRek(rowId, label) {
    confirmDialog({
      title: 'Hapus Pengajuan',
      warn: 'DATA AKAN DIHAPUS PERMANEN DARI DATABASE DAN TIDAK BISA DIKEMBALIKAN',
      text: 'Hapus pengajuan ganti rekening milik "' + label + '"?',
      okLabel: 'Ya, hapus permanen', okClass: 'btn-danger'
    }, function() {
      sbDelete('rekening', 'id=eq.' + encodeURIComponent(rowId)).then(function(hapus) {
        if (!hapus || hapus.length === 0) {
          toast('Data tidak terhapus — periksa izin akses (RLS) di Supabase', 'err');
          return;
        }
        if (_rekCache) {
          for (var i = 0; i < _rekCache.length; i++) {
            if (_rekCache[i].rowId === rowId) { _rekCache.splice(i, 1); break; }
          }
          applyRekFilters(); updateRekCount();
        }
        toast('Pengajuan dihapus permanen', 'ok');
        logActivity('REKENING', 'DELETE', 'Hapus rekening ' + label);
      }).catch(function(err) { toast('Gagal menghapus: ' + err.message, 'err'); });
    });
  }

  // ── Format Copy ───────────────────────────────────────────────
  function buildRekFormat(r) {
    return [
      'NO PASPOR : ' + r.paspor,
      'NAMA STAFF : ' + r.nama,
      '',
      'NOMOR REKENING SEBELUM NYA : ' + r.rekLama + ' (' + r.bankLama + ')',
      'NAMA PEMILIK REKENING : ' + r.pemilikLama,
      '',
      'NOMOR REKENING TERBARU NYA : ' + r.rekBaru + ' (' + r.bankBaru + ')',
      'NAMA PEMILIK REKENING : ' + r.pemilikBaru,
      '',
      'ALASAN MENGGANTI : ' + (r.alasan || '-')
    ].join('\n');
  }

  function copyRek(rowId, btn) {
    var r = null;
    (_rekCache || []).forEach(function(x) { if (x.rowId === rowId) r = x; });
    if (!r) return;
    var text = buildRekFormat(r);
    copyText(text).then(function() {
      toast('Format pengajuan disalin', 'ok');
      if (btn) {
        var label = btn.querySelector('span'), asli = label ? label.textContent : '';
        btn.classList.add('done'); if (label) label.textContent = 'Tersalin';
        setTimeout(function() { btn.classList.remove('done'); if (label) label.textContent = asli; }, 1600);
      }
    }).catch(function() { showCopyFallback(text); });
  }

  document.getElementById('rekEditOverlay').addEventListener('click', function(e) { if (e.target === this) closeRekEdit(); });

  // ══════════════════════════════════════════════════════════════
  // MODUL PENGAJUAN RESIGN
  // ══════════════════════════════════════════════════════════════
  var RESIGN_STATUSES = ['PENDING', 'ACC', 'DITOLAK'];
  var _resignCache = null, _resignLoaded = false;
  var resignFilter = { status: 'ALL', search: '' };
  var resignEditingId = null;

  function resignTaskList() { return CONFIG.TASK_RESIGN.length ? CONFIG.TASK_RESIGN : RESIGN_STATUSES; }

  function getResign() {
    return sbGet('resign', 'select=*&order=created_at.desc').then(function(rows) {
      return rows.map(function(r) {
        return {
          rowId: r.id, id: r.id_pengajuan || r.id, timestamp: r.created_at || '',
          paspor: r.no_paspor || '', nama: r.nama || '',
          tglResign: r.tanggal_resign || '', tglLast: r.tanggal_last || '',
          keterangan: r.keterangan || '',
          task: r.task || 'PENDING'
        };
      });
    });
  }

  function genResignId() {
    var now = new Date();
    function pad(n) { return String(n).padStart(2, '0'); }
    return 'RSG-' + now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '-' +
      pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '-' + randSuffix(12);
  }

  function gatherResign(prefix) {
    function val(id) { var el = document.getElementById(prefix + id); return el ? String(el.tagName === 'TEXTAREA' ? el.value : el.value || '').trim() : ''; }
    var d = {
      paspor: val('paspor').toUpperCase(),
      nama: val('nama').toUpperCase(),
      tglResign: val('tglResign'),
      tglLast: val('tglLast'),
      keterangan: val('keterangan')
    };
    if (!d.paspor) throw new Error('Isi nomor paspor.');
    if (!d.nama) throw new Error('Isi nama staff.');
    if (!d.tglResign) throw new Error('Isi tanggal pengajuan resign.');
    if (!d.tglLast) throw new Error('Isi tanggal last kerja.');
    if (d.tglLast < d.tglResign) throw new Error('Tanggal last kerja tidak boleh sebelum tanggal pengajuan.');
    if (!d.keterangan) throw new Error('Isi keterangan resign.');
    return d;
  }

  function resignPayload(id, d, task) {
    return {
      id: id, id_pengajuan: id, no_paspor: d.paspor, nama: d.nama,
      tanggal_resign: d.tglResign, tanggal_last: d.tglLast,
      keterangan: d.keterangan,
      task: task || 'PENDING'
    };
  }

  // ── Form ──────────────────────────────────────────────────────
  function toggleResignForm(force) {
    var panel = document.getElementById('resignFormPanel');
    var btn = document.getElementById('resignToggleBtn');
    var open = (force === undefined) ? !panel.classList.contains('open') : !!force;
    panel.classList.toggle('open', open);
    btn.innerHTML = open ? '✕ Tutup form' : '＋ Ajukan Resign';
    btn.classList.toggle('btn-primary', !open);
    btn.classList.toggle('btn-secondary', open);
    if (!open) resignMsg('', '');
  }
  document.getElementById('resignFormPanel').addEventListener('click', function(e) { if (e.target === this) toggleResignForm(false); });
  function resignMsg(type, text) {
    var el = document.getElementById('rs_formMsg');
    el.className = 'msg ' + (type || ''); el.textContent = text || '';
    if (text) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function resetResignForm() {
    ['rs_paspor','rs_tglResign','rs_tglLast'].forEach(function(id) {
      document.getElementById(id).value = '';
    });
    document.getElementById('rs_nama').value = '';
    document.getElementById('rs_keterangan').value = '';
    resignMsg('', '');
  }

  // Saat staff dipilih dari combo: ambil nama saja, isi paspor otomatis.
  // Intercept setter 'value' agar SETIAP kali combo menulis nilai (choose),
  // ID langsung distrip dan paspor langsung terisi — tanpa bergantung event.
  (function() {
    var el = document.getElementById('rs_nama');
    var proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(el, 'value', {
      get: function() { return proto.get.call(this); },
      set: function(v) {
        var p = splitStaff(String(v || ''));
        if (p.id) {
          proto.set.call(this, p.nm);
          document.getElementById('rs_paspor').value = p.id;
        } else {
          proto.set.call(this, v);
        }
      }
    });
  })();

  document.getElementById('rs_submitBtn').addEventListener('click', function() {
    var d;
    try { d = gatherResign('rs_'); } catch (err) { return resignMsg('error', err.message); }
    var btn = this;
    btn.disabled = true; btn.textContent = 'Mengirim…';
    var id = genResignId();
    sbPost('resign', resignPayload(id, d, 'PENDING'), { 'Prefer': 'return=minimal' }).then(function() {
      btn.disabled = false; btn.textContent = '📤 Kirim pengajuan';
      resignMsg('success', 'Pengajuan berhasil dibuat — ID: ' + id);
      toast('Pengajuan resign tersimpan', 'ok');
      logActivity('RESIGN', 'CREATE', 'Pengajuan resign ' + d.nama);
      resetResignForm(); toggleResignForm(false);
      _resignLoaded = false; loadResign(true);
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '📤 Kirim pengajuan';
      resignMsg('error', 'Gagal menyimpan: ' + err.message);
    });
  });

  // ── Muat & render ─────────────────────────────────────────────
  function loadResign(force) {
    var loading = document.getElementById('resignLoading');
    var content = document.getElementById('resignContent');
    var refresh = document.getElementById('resignRefreshBtn');
    if (!force && _resignLoaded && _resignCache) { renderResignAll(); content.style.display = 'block'; loading.style.display = 'none'; return; }

    loading.style.display = 'block'; loading.textContent = 'Memuat data…';
    content.style.display = 'none';
    document.getElementById('resignStatBox').innerHTML = renderSkeletonStats();
    if (refresh) refresh.disabled = true;

    getResign().then(function(rows) {
      _resignCache = rows; _resignLoaded = true;
      loading.style.display = 'none';
      document.getElementById('resignStatBox').innerHTML = '';
      renderResignAll(); content.style.display = 'block';
    }).catch(function(err) {
      loading.textContent = '❌ Gagal memuat data: ' + err.message;
      document.getElementById('resignStatBox').innerHTML = '';
    }).finally(function() { if (refresh) refresh.disabled = false; });
  }

  function renderResignAll() { renderResignChips(); applyResignFilters(); updateResignCount(); }

  function updateResignCount() {
    var pending = (_resignCache || []).filter(function(r) { return String(r.task).toUpperCase() === 'PENDING'; }).length;
    var total = (_resignCache || []).length;
    var el = document.getElementById('resignCount');
    if (el) { el.textContent = pending; el.style.display = pending ? '' : 'none'; }
    var sb = document.getElementById('sbResignCount');
    if (sb) { sb.textContent = total; sb.style.display = total ? '' : 'none'; }
    refreshWaitingAlert();
  }

  function renderResignChips() {
    var wrap = document.getElementById('resignChips');
    var list = ['ALL'].concat(resignTaskList());
    wrap.innerHTML = list.map(function(s) {
      var active = resignFilter.status === s ? ' active' : '';
      return '<button class="chip' + active + '" data-resignstatus="' + esc(s) + '">' + esc(s === 'ALL' ? 'Semua' : s) + '</button>';
    }).join('');
    wrap.querySelectorAll('.chip').forEach(function(c) {
      c.addEventListener('click', function() {
        resignFilter.status = c.dataset.resignstatus; renderResignChips(); applyResignFilters();
      });
    });
  }

  var _resignSearchTimer = null;
  document.getElementById('resignSearch').addEventListener('input', function() {
    var v = this.value.trim().toLowerCase();
    clearTimeout(_resignSearchTimer);
    _resignSearchTimer = setTimeout(function() { resignFilter.search = v; applyResignFilters(); }, 140);
  });

  function matchResign(r) {
    if (resignFilter.status !== 'ALL' && String(r.task).toUpperCase() !== resignFilter.status.toUpperCase()) return false;
    if (resignFilter.search) {
      var hay = (r.nama + ' ' + r.paspor + ' ' + r.id).toLowerCase();
      if (hay.indexOf(resignFilter.search) === -1) return false;
    }
    return true;
  }

  function applyResignFilters() {
    if (!_resignCache) return;
    var rows = _resignCache.filter(matchResign);
    var filtered = (resignFilter.status !== 'ALL' || resignFilter.search);
    document.getElementById('resignResultCount').innerHTML =
      'Menampilkan <strong>' + rows.length + '</strong> dari ' + _resignCache.length + ' pengajuan' + (filtered ? ' · terfilter' : '');
    renderResignStats(rows);
    renderResignTable(rows);
  }

  function renderResignStats(rows) {
    var pending = 0, acc = 0, ditolak = 0;
    rows.forEach(function(r) {
      var t = String(r.task).toUpperCase();
      if (t === 'PENDING') pending++;
      else if (t === 'ACC') acc++;
      else if (t === 'DITOLAK') ditolak++;
    });
    document.getElementById('resignStatBox').innerHTML =
      statCard('Total Pengajuan', rows.length, 'var(--brand-ink)', 'var(--brand-050)', '📝') +
      statCard('Pending', pending, 'var(--amber)', 'var(--amber-bg)', '⏳') +
      statCard('ACC', acc, 'var(--green)', 'var(--green-bg)', '✅') +
      statCard('Ditolak', ditolak, 'var(--red, #e74c3c)', 'var(--red-bg, #fde8e8)', '❌');
  }

  function resignTaskCls(v) {
    var u = String(v || '').toUpperCase();
    if (u === 'PENDING') return 'task-WAITING';
    if (u === 'ACC') return 'task-SELESAI';
    if (u === 'DITOLAK') return 'task-DONE';
    return 'task-DONE';
  }

  function renderResignTable(rows) {
    var tbody = document.getElementById('resignTableBody');
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Belum ada pengajuan resign.</td></tr>';
      return;
    }
    var list = resignTaskList();
    tbody.innerHTML = rows.map(function(r, i) {
      var opts = list.map(function(t) {
        return '<option' + (t === r.task ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join('');
      var ketShort = r.keterangan.length > 40 ? r.keterangan.slice(0, 40) + '…' : r.keterangan;
      return '<tr class="rec' + (i % 2 === 1 ? ' rec-alt' : '') + '">' +
        '<td><span class="cell-name" title="' + esc(r.nama) + '">' + esc(r.nama) + '</span></td>' +
        '<td><span class="pill pill-perihal">' + esc(r.paspor) + '</span></td>' +
        '<td>' + esc(formatDate(r.tglResign)) + '</td>' +
        '<td>' + esc(formatDate(r.tglLast)) + '</td>' +
        '<td title="' + esc(r.keterangan) + '">' + esc(ketShort) + '</td>' +
        '<td>' + (isAdmin()
          ? '<select class="task-select ' + resignTaskCls(r.task) + '" data-resignrow="' + esc(r.rowId) +
            '" data-status="' + esc(r.task) + '">' + opts + '</select>'
          : '<span class="pill ' + resignTaskCls(r.task) + '" style="border-radius:var(--radius-pill);padding:4px 11px;">' + esc(r.task) + '</span>') + '</td>' +
        '<td><button class="copy-btn" type="button" title="Salin format pengajuan" onclick="copyResign(\'' + esc(r.rowId) + '\', this)">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '<span>Salin</span></button></td>' +
        '<td>' + (isAdmin() ? '<span class="row-actions">' +
          '<button class="icon-btn" title="Ubah" onclick="openResignEdit(\'' + esc(r.rowId) + '\')">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button>' +
          '<button class="icon-btn danger" title="Hapus" onclick="deleteResign(\'' + esc(r.rowId) + '\',\'' + esc(r.nama) + '\')">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
          '</button>' +
        '</span>' : '<span class="row-actions" style="color:var(--faint);font-size:12px;">—</span>') + '</td>' +
      '</tr>';
    }).join('');
  }

  // ── Ubah status ───────────────────────────────────────────────
  document.getElementById('resignTableBody').addEventListener('change', function(e) {
    var sel = e.target;
    if (!sel.classList.contains('task-select')) return;
    var rowId = sel.dataset.resignrow, value = sel.value, oldVal = sel.getAttribute('data-status');
    if (value === oldVal) return;
    var nama = '';
    (_resignCache || []).forEach(function(r) { if (r.rowId === rowId) nama = r.nama; });

    confirmDialog({
      title: 'Ubah Status Resign',
      warn: 'HANYA LEADER DAN CS LINE YANG MENGUBAH STATUS',
      text: 'Ubah status ' + (nama ? nama + ' ' : '') + 'dari "' + oldVal + '" menjadi "' + value + '"?',
      okLabel: 'Ya, ubah status', okClass: 'btn-primary', cancelLabel: 'Batal'
    }, function() {
      sel.classList.add('task-saving');
      sbPatch('resign', 'id=eq.' + encodeURIComponent(rowId), { task: value }).then(function() {
        sel.classList.remove('task-saving');
        sel.className = 'task-select ' + resignTaskCls(value);
        sel.setAttribute('data-status', value);
        sel.classList.add('task-flash'); setTimeout(function() { sel.classList.remove('task-flash'); }, 700);
        (_resignCache || []).forEach(function(r) { if (r.rowId === rowId) r.task = value; });
        applyResignFilters(); updateResignCount();
        toast('Status diperbarui', 'ok');
        logActivity('RESIGN', 'STATUS', 'Status resign ' + (nama||rowId) + ' → ' + value);
      }).catch(function(err) {
        sel.classList.remove('task-saving'); sel.value = oldVal;
        toast('Gagal update status: ' + err.message, 'err');
      });
    }, function() { sel.value = oldVal; });
  });

  // ── Edit ──────────────────────────────────────────────────────
  function openResignEdit(rowId) {
    var r = null;
    (_resignCache || []).forEach(function(x) { if (x.rowId === rowId) r = x; });
    if (!r) return;
    resignEditingId = rowId;
    document.getElementById('rse_paspor').value = r.paspor;
    document.getElementById('rse_nama').value = r.nama;
    document.getElementById('rse_tglResign').value = r.tglResign;
    document.getElementById('rse_tglLast').value = r.tglLast;
    document.getElementById('rse_keterangan').value = r.keterangan;
    var t = document.getElementById('rse_task');
    t.innerHTML = resignTaskList().map(function(v) {
      return '<option' + (v === r.task ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
    var m = document.getElementById('rse_msg'); m.className = 'msg'; m.textContent = '';
    document.getElementById('resignEditOverlay').classList.add('open');
  }
  function closeResignEdit() { document.getElementById('resignEditOverlay').classList.remove('open'); resignEditingId = null; }

  document.getElementById('rse_save').addEventListener('click', function() {
    if (!resignEditingId) return;
    var el = document.getElementById('rse_msg');
    var d;
    try { d = gatherResign('rse_'); }
    catch (err) { el.className = 'msg error'; el.textContent = err.message; return; }
    var patch = resignPayload(resignEditingId, d, document.getElementById('rse_task').value);
    delete patch.id; delete patch.id_pengajuan;
    var btn = this; btn.disabled = true; btn.textContent = 'Menyimpan…';
    sbPatch('resign', 'id=eq.' + encodeURIComponent(resignEditingId), patch).then(function() {
      btn.disabled = false; btn.textContent = '💾 Simpan perubahan';
      closeResignEdit(); toast('Perubahan tersimpan', 'ok');
      logActivity('RESIGN', 'UPDATE', 'Edit resign ' + (document.getElementById('rse_nama') ? document.getElementById('rse_nama').value : resignEditingId));
      _resignLoaded = false; loadResign(true);
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '💾 Simpan perubahan';
      el.className = 'msg error'; el.textContent = 'Gagal menyimpan: ' + err.message;
    });
  });

  // ── Hapus ─────────────────────────────────────────────────────
  function deleteResign(rowId, label) {
    confirmDialog({
      title: 'Hapus Pengajuan',
      warn: 'DATA AKAN DIHAPUS PERMANEN DARI DATABASE DAN TIDAK BISA DIKEMBALIKAN',
      text: 'Hapus pengajuan resign milik "' + label + '"?',
      okLabel: 'Ya, hapus permanen', okClass: 'btn-danger'
    }, function() {
      sbDelete('resign', 'id=eq.' + encodeURIComponent(rowId)).then(function(hapus) {
        if (!hapus || hapus.length === 0) {
          toast('Data tidak terhapus — periksa izin akses (RLS) di Supabase', 'err');
          return;
        }
        if (_resignCache) {
          for (var i = 0; i < _resignCache.length; i++) {
            if (_resignCache[i].rowId === rowId) { _resignCache.splice(i, 1); break; }
          }
          applyResignFilters(); updateResignCount();
        }
        toast('Pengajuan dihapus permanen', 'ok');
        logActivity('RESIGN', 'DELETE', 'Hapus resign ' + label);
      }).catch(function(err) { toast('Gagal menghapus: ' + err.message, 'err'); });
    });
  }

  // ── Format Copy ───────────────────────────────────────────────
  function buildResignFormat(r) {
    var lines = [
      'No Paspor : ' + r.paspor,
      'Nama Staff : ' + r.nama,
      'Tanggal Pengajuan Resign : ' + formatDate(r.tglResign),
      'Tanggal Last Kerja : ' + formatDate(r.tglLast),
      'Keterangan : ' + (r.keterangan || '-')
    ];
    if (String(r.task).toUpperCase() === 'ACC') {
      lines.push('');
      lines.push('ACC : ' + currentLeader());
    }
    return lines.join('\n');
  }

  function copyResign(rowId, btn) {
    var r = null;
    (_resignCache || []).forEach(function(x) { if (x.rowId === rowId) r = x; });
    if (!r) return;
    var text = buildResignFormat(r);
    copyText(text).then(function() {
      toast('Format pengajuan disalin', 'ok');
      if (btn) {
        var label = btn.querySelector('span'), asli = label ? label.textContent : '';
        btn.classList.add('done'); if (label) label.textContent = 'Tersalin';
        setTimeout(function() { btn.classList.remove('done'); if (label) label.textContent = asli; }, 1600);
      }
    }).catch(function() { showCopyFallback(text); });
  }

  document.getElementById('resignEditOverlay').addEventListener('click', function(e) { if (e.target === this) closeResignEdit(); });

  // ══════════════════════════════════════════════════════════════
  // MODUL RIWAYAT LOG
  // ══════════════════════════════════════════════════════════════
  var _logCache = null, _logLoaded = false;
  var logFilter = { module: 'ALL', search: '' };
  var LOG_MODULES = ['CUTI', 'RESIGN', 'REKENING', 'STAFF', 'AUTH'];

  function logActivity(module, action, detail) {
    var id = 'LOG-' + Date.now() + '-' + randSuffix(8);
    var userName = currentLeader() || 'System';
    sbPost('activity_log', {
      id: id, module: module, action: action,
      detail: detail, user_name: userName
    }, { 'Prefer': 'return=minimal' }).catch(function(err) {
      console.warn('Log gagal:', err.message);
    });
  }

  function getLog() {
    return sbGet('activity_log', 'select=*&order=created_at.desc&limit=500').then(function(rows) {
      return rows.map(function(r) {
        return {
          id: r.id, timestamp: r.created_at || '',
          module: r.module || '', action: r.action || '',
          detail: r.detail || '', userName: r.user_name || ''
        };
      });
    });
  }

  function loadLog(force) {
    var loading = document.getElementById('logLoading');
    var content = document.getElementById('logContent');
    var refresh = document.getElementById('logRefreshBtn');
    if (!force && _logLoaded && _logCache) { renderLogAll(); content.style.display = 'block'; loading.style.display = 'none'; return; }
    loading.style.display = 'block'; loading.textContent = 'Memuat log…';
    content.style.display = 'none';
    if (refresh) refresh.disabled = true;
    getLog().then(function(rows) {
      _logCache = rows; _logLoaded = true;
      loading.style.display = 'none';
      renderLogAll(); content.style.display = 'block';
    }).catch(function(err) {
      loading.textContent = '❌ Gagal memuat log: ' + err.message;
    }).finally(function() { if (refresh) refresh.disabled = false; });
  }

  function renderLogAll() { renderLogChips(); applyLogFilters(); }

  function renderLogChips() {
    var wrap = document.getElementById('logChips');
    var list = ['ALL'].concat(LOG_MODULES);
    wrap.innerHTML = list.map(function(s) {
      var active = logFilter.module === s ? ' active' : '';
      return '<button class="chip' + active + '" data-logmod="' + esc(s) + '">' + esc(s === 'ALL' ? 'Semua' : s) + '</button>';
    }).join('');
    wrap.querySelectorAll('.chip').forEach(function(c) {
      c.addEventListener('click', function() {
        logFilter.module = c.dataset.logmod; renderLogChips(); applyLogFilters();
      });
    });
  }

  var _logSearchTimer = null;
  document.getElementById('logSearch').addEventListener('input', function() {
    var v = this.value.trim().toLowerCase();
    clearTimeout(_logSearchTimer);
    _logSearchTimer = setTimeout(function() { logFilter.search = v; applyLogFilters(); }, 140);
  });

  function matchLog(r) {
    if (logFilter.module !== 'ALL' && r.module !== logFilter.module) return false;
    if (logFilter.search) {
      var hay = (r.detail + ' ' + r.action + ' ' + r.userName + ' ' + r.module).toLowerCase();
      if (hay.indexOf(logFilter.search) === -1) return false;
    }
    return true;
  }

  function applyLogFilters() {
    if (!_logCache) return;
    var rows = _logCache.filter(matchLog);
    var filtered = (logFilter.module !== 'ALL' || logFilter.search);
    document.getElementById('logResultCount').innerHTML =
      'Menampilkan <strong>' + rows.length + '</strong> dari ' + _logCache.length + ' log' + (filtered ? ' · terfilter' : '');
    renderLogTable(rows);
  }

  function logModuleCls(mod) {
    var m = String(mod).toUpperCase();
    if (m === 'CUTI') return 'background:var(--blue-bg);color:var(--blue);border-color:var(--blue-bd);';
    if (m === 'RESIGN') return 'background:#FDF1F4;color:#D4587A;border-color:#F4BDC9;';
    if (m === 'REKENING') return 'background:#EEFBF7;color:#2DAE8A;border-color:#A8E2D2;';
    if (m === 'STAFF') return 'background:var(--role-kap-bg);color:var(--role-kap);border-color:var(--role-kap-bd);';
    if (m === 'AUTH') return 'background:var(--role-cs-bg);color:var(--role-cs);border-color:var(--role-cs-bd);';
    return 'background:var(--slate-bg);color:var(--slate);';
  }

  function logActionCls(act) {
    var a = String(act).toUpperCase();
    if (a === 'CREATE') return 'background:var(--green-bg);color:var(--green);border-color:var(--green-bd);';
    if (a === 'UPDATE' || a === 'STATUS') return 'background:var(--blue-bg);color:var(--blue);border-color:var(--blue-bd);';
    if (a === 'DELETE') return 'background:var(--red-bg);color:var(--red);border-color:var(--red-bd);';
    if (a === 'LOGIN' || a === 'LOGOUT') return 'background:var(--amber-bg);color:var(--amber);border-color:var(--amber-bd);';
    return '';
  }

  function formatLogTime(ts) {
    if (!ts) return '-';
    var d = new Date(ts);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return pad(d.getDate()) + '/' + pad(d.getMonth()+1) + '/' + d.getFullYear() + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function renderLogTable(rows) {
    var tbody = document.getElementById('logTableBody');
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">Belum ada log aktivitas.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(r, i) {
      return '<tr class="rec' + (i % 2 === 1 ? ' rec-alt' : '') + '">' +
        '<td style="text-align:center;white-space:nowrap;font-size:12px;color:var(--text-muted);font-variant-numeric:tabular-nums;">' + esc(formatLogTime(r.timestamp)) + '</td>' +
        '<td style="text-align:center;"><span class="pill" style="' + logModuleCls(r.module) + '">' + esc(r.module) + '</span></td>' +
        '<td style="text-align:center;"><span class="pill" style="' + logActionCls(r.action) + '">' + esc(r.action) + '</span></td>' +
        '<td style="text-align:center;font-size:12.5px;color:var(--text-secondary);line-height:1.45;">' + esc(r.detail) + '</td>' +
      '</tr>';
    }).join('');
  }

  function clearLog() {
    confirmDialog({
      title: 'Bersihkan Log',
      warn: 'SEMUA RIWAYAT LOG AKAN DIHAPUS PERMANEN',
      text: 'Yakin ingin menghapus seluruh riwayat log aktivitas?',
      okLabel: 'Ya, hapus semua', okClass: 'btn-danger'
    }, function() {
      sbDelete('activity_log', 'id=neq.___').then(function() {
        _logCache = []; _logLoaded = false;
        loadLog(true);
        toast('Log berhasil dihapus', 'ok');
      }).catch(function(err) { toast('Gagal menghapus: ' + err.message, 'err'); });
    });
  }

  // ══════════════════════════════════════════════════════════════
  // MODUL REVISI CUTI
  // ══════════════════════════════════════════════════════════════
  var _revisiCache = null, _revisiLoaded = false, _revisiVer = 0;
  var revisiFilter = { status: 'ALL', search: '' };
  var _revisiReviewId = null;

  function getRevisi() {
    return sbGet('revisi_cuti', 'select=*&order=created_at.desc').then(function(rows) {
      return rows.map(function(r) {
        return {
          id: r.id, cutiId: r.cuti_id, nama: r.nama, timestamp: r.created_at || '',
          start1: r.start1_baru || '', end1: r.end1_baru || '', perihal1: r.perihal1_baru || '',
          start2: r.start2_baru || '', end2: r.end2_baru || '', perihal2: r.perihal2_baru || '',
          alasan: r.alasan || '', status: r.status || 'PENDING',
          catatan: r.catatan_admin || ''
        };
      });
    });
  }

  // ── Form ajukan revisi (non-admin) ────────────────────────────
  function openRevisiForm(cutiId) {
    // Cek duplikat PENDING - lokal dulu
    var hasPending = (_revisiCache || []).some(function(r) { return r.cutiId === cutiId && r.status === 'PENDING'; });
    if (hasPending) return toast('Revisi untuk cuti ini sedang menunggu persetujuan admin', 'err');

    var r = null;
    (_cache || []).forEach(function(x) { if (x.rowId === cutiId) r = x; });
    if (!r) return toast('Data cuti tidak ditemukan', 'err');
    document.getElementById('rv_cutiId').value = cutiId;
    document.getElementById('rv_role').value = r.role || '';
    document.getElementById('rv_nama').value = r.nama;
    fillPerihalSelect(document.getElementById('rv_perihal1'), r.perihal1 || 'CUTI KERJA', false);
    document.getElementById('rv_start1').value = r.start1Raw || '';
    document.getElementById('rv_end1').value = r.end1Raw || '';
    fillPerihalSelect(document.getElementById('rv_perihal2'), r.perihal2 || '', true);
    document.getElementById('rv_start2').value = r.start2Raw || '';
    document.getElementById('rv_end2').value = r.end2Raw || '';
    document.getElementById('rv_alasan').value = '';
    var m = document.getElementById('rv_msg'); m.className = 'msg'; m.textContent = '';
    calcRevisiDurasi();
    document.getElementById('revisiOverlay').classList.add('open');
  }
  function closeRevisiForm() { document.getElementById('revisiOverlay').classList.remove('open'); }
  document.getElementById('revisiOverlay').addEventListener('click', function(e) { if (e.target === this) closeRevisiForm(); });

  // Auto-hitung "N Hari" di form Ajukan Revisi, sama seperti form cuti utama.
  function calcRevisiDurasiSlot(startId, endId, durasiId) {
    var s = document.getElementById(startId).value;
    var e = document.getElementById(endId).value;
    var du = document.getElementById(durasiId);
    if (!du) return;
    if (s && e) {
      var d = dayKey(e) - dayKey(s) + 1;
      du.value = d > 0 ? d + ' Hari' : '⚠ Selesai < Mulai';
    } else {
      du.value = '';
    }
  }
  function calcRevisiDurasi() {
    calcRevisiDurasiSlot('rv_start1', 'rv_end1', 'rv_durasi1');
    calcRevisiDurasiSlot('rv_start2', 'rv_end2', 'rv_durasi2');
  }
  ['rv_start1', 'rv_end1', 'rv_start2', 'rv_end2'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', calcRevisiDurasi);
  });

  document.getElementById('rv_submitBtn').addEventListener('click', function() {
    var cutiId = document.getElementById('rv_cutiId').value;
    var nama = document.getElementById('rv_nama').value;
    var alasan = document.getElementById('rv_alasan').value.trim();
    var s1 = document.getElementById('rv_start1').value;
    var e1 = document.getElementById('rv_end1').value;
    var p1 = document.getElementById('rv_perihal1').value;
    var s2 = document.getElementById('rv_start2').value;
    var e2 = document.getElementById('rv_end2').value;
    var p2 = document.getElementById('rv_perihal2').value;
    var role = document.getElementById('rv_role').value;
    var msg = document.getElementById('rv_msg');

    if (!s1 || !e1 || !p1) { msg.className = 'msg error'; msg.textContent = 'Isi minimal Cuti 1 (perihal, tanggal mulai & selesai).'; return; }
    if (!alasan) { msg.className = 'msg error'; msg.textContent = 'Isi alasan revisi.'; return; }

    // Validasi urutan tanggal & batas durasi role — sebelumnya form ini TIDAK
    // memanggil validateLeaves() sama sekali, jadi tanggal selesai < mulai bisa
    // lolos (cuma dikasih teks kosmetik "⚠ Selesai < Mulai" di field Durasi,
    // tidak memblokir submit) dan berujung durasi negatif tersimpan ke `cuti`
    // saat di-ACC admin. Sekarang dicek dengan gerbang yang sama seperti
    // pengajuan cuti biasa (lihat catatan audit bug #4).
    var leaves = [{ perihal: p1, start: s1, end: e1 }];
    if (p2 && s2 && e2) leaves.push({ perihal: p2, start: s2, end: e2 });
    var origRowForValidasi = null;
    (_cache || []).forEach(function(x) { if (x.rowId === cutiId) origRowForValidasi = x; });
    var extraDays = parseTambahanDays(origRowForValidasi && origRowForValidasi.tambahan);
    try {
      validateLeaves(role, leaves, extraDays);
    } catch (errValidasi) {
      msg.className = 'msg error'; msg.textContent = errValidasi.message;
      return;
    }

    var id = 'RV-' + Date.now() + '-' + randSuffix(8);
    var payload = {
      id: id, cuti_id: cutiId, nama: nama,
      start1_baru: s1, end1_baru: e1, perihal1_baru: p1,
      start2_baru: s2 || null, end2_baru: e2 || null, perihal2_baru: p2 || null,
      alasan: alasan, status: 'PENDING'
    };
    var btn = this; btn.disabled = true; btn.textContent = 'Memeriksa…';
    msg.className = 'msg'; msg.textContent = '';

    // Server-side duplicate check
    sbGet('revisi_cuti', 'select=id&cuti_id=eq.' + encodeURIComponent(cutiId) + '&status=eq.PENDING&limit=1').then(function(existing) {
      if (existing && existing.length > 0) {
        btn.disabled = false; btn.textContent = '📤 Kirim Revisi';
        msg.className = 'msg error'; msg.textContent = 'Revisi untuk cuti ini sudah ada yang PENDING. Tunggu admin mereview.';
        return;
      }
      // Tanggal baru yang diajukan juga wajib lolos aturan bentrok — sama seperti
      // pengajuan cuti biasa, memakai gerbang validasi & pool data terkini yang sama.
      btn.textContent = 'Memeriksa bentrok…';
      return checkClashOnSubmit(nama, role, leaves).then(function(clashReason) {
        if (clashReason) {
          btn.disabled = false; btn.textContent = '📤 Kirim Revisi';
          msg.className = 'msg error'; msg.textContent = clashReason;
          return;
        }
        btn.textContent = 'Mengirim…';
        return sbPost('revisi_cuti', payload, { 'Prefer': 'return=minimal' }).then(function() {
          btn.disabled = false; btn.textContent = '📤 Kirim Revisi';
          toast('Revisi berhasil diajukan', 'ok');
          logActivity('CUTI', 'CREATE', 'Ajukan revisi cuti ' + nama);
          closeRevisiForm();
          _revisiLoaded = false; loadRevisi(true);
        });
      });
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '📤 Kirim Revisi';
      msg.className = 'msg error'; msg.textContent = 'Gagal: ' + err.message;
    });
  });

  // ── Load & render revisi ──────────────────────────────────────
  function loadRevisi(force) {
    var loading = document.getElementById('revisiLoading');
    var content = document.getElementById('revisiContent');
    if (!force && _revisiLoaded && _revisiCache) { renderRevisiAll(); content.style.display = 'block'; loading.style.display = 'none'; return; }
    loading.style.display = 'block'; content.style.display = 'none';

    // Pastikan cache cuti tersedia untuk kolom Periode Awal
    var cutiPromise = _cache ? Promise.resolve() : getCuti().then(function(rows) { _cache = rows; _loaded = true; });

    cutiPromise.then(function() {
      return getRevisi();
    }).then(function(rows) {
      _revisiCache = rows; _revisiLoaded = true;
      loading.style.display = 'none'; renderRevisiAll(); content.style.display = 'block';
    }).catch(function(err) { loading.textContent = '❌ Gagal: ' + err.message; });
  }

  function renderRevisiAll() { renderRevisiChips(); applyRevisiFilters(); updateRevisiCount(); }

  function updateRevisiCount() {
    var n = (_revisiCache || []).filter(function(r) { return r.status === 'PENDING'; }).length;
    var sb = document.getElementById('sbRevisiCount');
    if (sb) {
      sb.textContent = n; sb.style.display = n ? '' : 'none';
      sb.classList.toggle('sb-badge-pulse', n > 0);
    }
    // Juga beri efek pada sidebar item (aman walau elemen sudah tak ada di sidebar)
    var sbItem = document.getElementById('sbRevisi');
    if (sbItem) sbItem.classList.toggle('sb-has-pending', n > 0);
    // Segarkan tabel Pengajuan Cuti — baris yg punya revisi pending, dropdown status,
    // dan kartu notifikasi "Minta Revisi" semua bergantung pada _revisiCache.
    _revisiVer++; _memoStatus = null;
    if (_cache && document.getElementById('view-dashboard').classList.contains('active')) {
      buildStatusOptions(); applyFilters();
    }
  }

  function renderRevisiChips() {
    var wrap = document.getElementById('revisiChips');
    var list = ['ALL', 'PENDING', 'DONE REVISI', 'DITOLAK'];
    wrap.innerHTML = list.map(function(s) {
      var active = revisiFilter.status === s ? ' active' : '';
      return '<button class="chip' + active + '" data-rvs="' + esc(s) + '">' + esc(s === 'ALL' ? 'Semua' : s) + '</button>';
    }).join('');
    wrap.querySelectorAll('.chip').forEach(function(c) {
      c.addEventListener('click', function() { revisiFilter.status = c.dataset.rvs; renderRevisiChips(); applyRevisiFilters(); });
    });
  }

  var _revisiSearchTimer = null;
  document.getElementById('revisiSearch').addEventListener('input', function() {
    var v = this.value.trim().toLowerCase();
    clearTimeout(_revisiSearchTimer);
    _revisiSearchTimer = setTimeout(function() { revisiFilter.search = v; applyRevisiFilters(); }, 140);
  });

  function applyRevisiFilters() {
    if (!_revisiCache) return;
    var rows = _revisiCache.filter(function(r) {
      if (revisiFilter.status !== 'ALL' && r.status !== revisiFilter.status) return false;
      if (revisiFilter.search && (r.nama + ' ' + r.alasan).toLowerCase().indexOf(revisiFilter.search) === -1) return false;
      return true;
    });
    document.getElementById('revisiResultCount').innerHTML =
      'Menampilkan <strong>' + rows.length + '</strong> dari ' + _revisiCache.length + ' revisi';
    renderRevisiTable(rows);
  }

  function revisiStatusCls(s) {
    if (s === 'PENDING') return 'task-WAITING';
    if (s === 'DONE REVISI') return 'task-SELESAI';
    if (s === 'DITOLAK') return 'task-DONE';
    return '';
  }

  function renderRevisiTable(rows) {
    var tbody = document.getElementById('revisiTableBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">Belum ada pengajuan revisi.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(r, i) {
      // Cari data cuti asli dari cache
      var orig = null;
      (_cache || []).forEach(function(c) { if (c.rowId === r.cutiId) orig = c; });
      var periodeAwal = '-';
      if (orig) {
        periodeAwal = formatDate(orig.start1Raw) + ' — ' + formatDate(orig.end1Raw);
        if (orig.start2Raw && orig.end2Raw) periodeAwal += '<br><span style="color:var(--faint);font-size:10px;">↳</span> ' + formatDate(orig.start2Raw) + ' — ' + formatDate(orig.end2Raw);
      }
      var periode = formatDate(r.start1) + ' — ' + formatDate(r.end1);
      if (r.start2 && r.end2) periode += '<br><span style="color:var(--faint);font-size:10px;">↳</span> ' + formatDate(r.start2) + ' — ' + formatDate(r.end2);
      var perihal = r.perihal1 || '-';
      if (r.perihal2) perihal += ', ' + r.perihal2;
      var alasanShort = r.alasan.length > 40 ? r.alasan.slice(0, 40) + '…' : r.alasan;
      var copyCol = '';
      if (r.status === 'PENDING') {
        copyCol = isAdmin() ? '<button class="btn btn-sm btn-primary" onclick="openRevisiReview(\'' + esc(r.id) + '\')">Review</button>' : '<span class="pill task-WAITING" style="border-radius:var(--radius-pill);padding:3px 10px;font-size:10px;">Menunggu</span>';
      } else if (r.status === 'DONE REVISI') {
        copyCol = '<button class="copy-btn" type="button" onclick="copyRevisi(\'' + esc(r.id) + '\', this)">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
            '<span>Salin</span></button>';
      }
      var aksi = '';
      if (isAdmin()) {
        aksi = '<span class="row-actions" style="justify-content:center;display:inline-flex;gap:4px;align-items:center;">' +
          '<button class="icon-btn" title="Ubah" onclick="openRevisiEdit(\'' + esc(r.id) + '\')">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
          '<button class="icon-btn danger" title="Hapus" onclick="deleteRevisi(\'' + esc(r.id) + '\',\'' + esc(r.nama) + '\')">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
          '</span>';
      }
      return '<tr class="rec' + (i % 2 === 1 ? ' rec-alt' : '') + '">' +
        '<td style="text-align:center;white-space:nowrap;font-size:11px;color:var(--text-muted);">' + esc(formatLogTime(r.timestamp)) + '</td>' +
        '<td style="text-align:left;font-weight:600;font-size:12px;white-space:normal;">' + esc(r.nama) + '</td>' +
        '<td style="text-align:left;font-size:11.5px;white-space:normal;color:var(--text-muted);">' + periodeAwal + '</td>' +
        '<td style="text-align:left;font-size:11.5px;white-space:normal;color:var(--text-secondary);">' + periode + '</td>' +
        '<td style="text-align:center;"><span class="pill pill-perihal" style="font-size:10px;">' + esc(perihal) + '</span></td>' +
        '<td style="text-align:center;font-size:11.5px;white-space:normal;color:var(--text-secondary);" title="' + esc(r.alasan) + '">' + esc(alasanShort) + '</td>' +
        '<td style="text-align:center;"><span class="pill ' + revisiStatusCls(r.status) + '" style="border-radius:var(--radius-pill);padding:3px 10px;font-size:10px;">' + esc(r.status) + '</span></td>' +
        '<td style="text-align:center;">' + copyCol + '</td>' +
        '<td style="text-align:center;white-space:nowrap;" class="admin-only">' + aksi + '</td>' +
      '</tr>';
    }).join('');
  }

  function buildRevisiFormat(r) {
    var lines = [
      'REVISI CUTI STAFF',
      '',
      'Nama Staff : ' + r.nama,
      '',
      'Cuti 1 (Revisi) :',
      'Perihal : ' + (r.perihal1 || '-'),
      'Tanggal : ' + formatDate(r.start1) + ' — ' + formatDate(r.end1)
    ];
    if (r.start2 && r.end2) {
      lines.push('');
      lines.push('Cuti 2 (Revisi) :');
      lines.push('Perihal : ' + (r.perihal2 || '-'));
      lines.push('Tanggal : ' + formatDate(r.start2) + ' — ' + formatDate(r.end2));
    }
    lines.push('');
    lines.push('Alasan Revisi : ' + (r.alasan || '-'));
    lines.push('');
    lines.push('ACC : ' + currentLeader());
    return lines.join('\n');
  }

  function copyRevisi(revId, btn) {
    var r = null;
    (_revisiCache || []).forEach(function(x) { if (x.id === revId) r = x; });
    if (!r) return;
    var text = buildRevisiFormat(r);
    copyText(text).then(function() {
      toast('Format revisi disalin', 'ok');
      if (btn) {
        var label = btn.querySelector('span'), asli = label ? label.textContent : '';
        btn.classList.add('done'); if (label) label.textContent = 'Tersalin';
        setTimeout(function() { btn.classList.remove('done'); if (label) label.textContent = asli; }, 1600);
      }
    }).catch(function() { showCopyFallback(text); });
  }

  // ── Edit revisi (admin) ───────────────────────────────────────
  var _revisiEditId = null;
  function openRevisiEdit(revId) {
    var r = null;
    (_revisiCache || []).forEach(function(x) { if (x.id === revId) r = x; });
    if (!r) return;
    _revisiEditId = revId;
    document.getElementById('rve_nama').value = r.nama;
    fillPerihalSelect(document.getElementById('rve_perihal1'), r.perihal1 || '', false);
    document.getElementById('rve_start1').value = r.start1 || '';
    document.getElementById('rve_end1').value = r.end1 || '';
    fillPerihalSelect(document.getElementById('rve_perihal2'), r.perihal2 || '', true);
    document.getElementById('rve_start2').value = r.start2 || '';
    document.getElementById('rve_end2').value = r.end2 || '';
    document.getElementById('rve_alasan').value = r.alasan || '';
    document.getElementById('rve_status').value = r.status || 'PENDING';
    var m = document.getElementById('rve_msg'); m.className = 'msg'; m.textContent = '';
    document.getElementById('revisiEditOverlay').classList.add('open');
  }
  function closeRevisiEdit() { document.getElementById('revisiEditOverlay').classList.remove('open'); _revisiEditId = null; }

  document.getElementById('rve_saveBtn').addEventListener('click', function() {
    if (!_revisiEditId) return;
    var msg = document.getElementById('rve_msg');
    var patch = {
      nama: document.getElementById('rve_nama').value.trim(),
      start1_baru: document.getElementById('rve_start1').value || null,
      end1_baru: document.getElementById('rve_end1').value || null,
      perihal1_baru: document.getElementById('rve_perihal1').value || null,
      start2_baru: document.getElementById('rve_start2').value || null,
      end2_baru: document.getElementById('rve_end2').value || null,
      perihal2_baru: document.getElementById('rve_perihal2').value || null,
      alasan: document.getElementById('rve_alasan').value.trim(),
      status: document.getElementById('rve_status').value
    };
    var btn = this; btn.disabled = true; btn.textContent = 'Menyimpan…';
    sbPatch('revisi_cuti', 'id=eq.' + encodeURIComponent(_revisiEditId), patch).then(function() {
      btn.disabled = false; btn.textContent = '💾 Simpan';
      closeRevisiEdit(); toast('Revisi diperbarui', 'ok');
      logActivity('CUTI', 'UPDATE', 'Edit revisi cuti ' + patch.nama);
      _revisiLoaded = false; loadRevisi(true);
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '💾 Simpan';
      msg.className = 'msg error'; msg.textContent = 'Gagal: ' + err.message;
    });
  });

  function deleteRevisi(revId, label) {
    confirmDialog({
      title: 'Hapus Revisi',
      warn: 'DATA REVISI AKAN DIHAPUS PERMANEN',
      text: 'Hapus pengajuan revisi milik "' + label + '"?',
      okLabel: 'Ya, hapus', okClass: 'btn-danger'
    }, function() {
      sbDelete('revisi_cuti', 'id=eq.' + encodeURIComponent(revId)).then(function(res) {
        if (!res || !res.length) { toast('Gagal hapus — periksa izin RLS', 'err'); return; }
        if (_revisiCache) {
          for (var i = 0; i < _revisiCache.length; i++) {
            if (_revisiCache[i].id === revId) { _revisiCache.splice(i, 1); break; }
          }
          applyRevisiFilters(); updateRevisiCount();
        }
        toast('Revisi dihapus', 'ok');
        logActivity('CUTI', 'DELETE', 'Hapus revisi cuti ' + label);
      }).catch(function(err) { toast('Gagal: ' + err.message, 'err'); });
    });
  }

  document.getElementById('revisiEditOverlay').addEventListener('click', function(e) { if (e.target === this) closeRevisiEdit(); });

  // ── Review revisi (admin) ─────────────────────────────────────
  // Satu baris "PERIHAL : tgl mulai – tgl selesai ( N Hari )" untuk satu slot cuti.
  function revFormatLine(perihal, s, e) {
    if (!s || !e) return '';
    var hari = calcDurasi(s, e);
    return '<div>' + esc(perihal || '-') + ' : ' + formatDate(s) + ' – ' + formatDate(e) +
      ' ( ' + hari + ' Hari )</div>';
  }
  // Daftar baris (flat list, bisa 0/1/2 baris) untuk satu sisi (sebelum ATAU sesudah revisi).
  function revLinesHtml(perihal1, s1, e1, perihal2, s2, e2) {
    var l1 = revFormatLine(perihal1, s1, e1);
    var l2 = revFormatLine(perihal2, s2, e2);
    var out = l1 + l2;
    return out || '<div style="color:var(--text-faint);">— Tidak ada —</div>';
  }
  function openRevisiReview(revId) {
    var r = null;
    (_revisiCache || []).forEach(function(x) { if (x.id === revId) r = x; });
    if (!r) return;
    _revisiReviewId = revId;
    // Cari data cuti asli (sebelum revisi) untuk perbandingan
    var orig = null;
    (_cache || []).forEach(function(x) { if (x.rowId === r.cutiId) orig = x; });
    var warnOrphan = !orig
      ? '<div class="msg warn" style="margin-bottom:10px;">⚠️ Data cuti asli tidak ditemukan (kemungkinan sudah dihapus) — bagian "Tanggal Pengajuan Sebelumnya" tidak tersedia.</div>'
      : '';
    // Nama staff sudah diisi lengkap dengan "NAMA - Passport" pada field nama itu sendiri,
    // jadi cukup ditampilkan apa adanya (tidak perlu tambahan ID Pengajuan di belakangnya).
    var before = orig
      ? revLinesHtml(orig.perihal1, orig.start1Raw, orig.end1Raw, orig.perihal2, orig.start2Raw, orig.end2Raw)
      : '<div style="color:var(--text-faint);">— Tidak tersedia —</div>';
    var after = revLinesHtml(r.perihal1, r.start1, r.end1, r.perihal2, r.start2, r.end2);
    var detail = '<div style="font-size:13px;line-height:1.7;color:var(--text-secondary);">' +
      '<div style="font-weight:700;font-size:15px;color:var(--text-primary);margin-bottom:12px;">' +
        esc((r.nama || '').toUpperCase()) +
      '</div>' +
      warnOrphan +
      '<div style="margin-bottom:14px;">' +
        '<div style="font-size:9px;font-weight:800;letter-spacing:.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:6px;">Tanggal Pengajuan Sebelumnya :</div>' +
        '<div style="color:var(--text-muted);">' + before + '</div>' +
      '</div>' +
      '<div style="margin-bottom:6px;">' +
        '<div style="font-size:9px;font-weight:800;letter-spacing:.08em;color:var(--text-faint);text-transform:uppercase;margin-bottom:6px;">Tanggal Pengajuan Setelah Revisi :</div>' +
        '<div style="font-weight:600;color:var(--yellow);">' + after + '</div>' +
      '</div>' +
      '<div style="margin-top:10px;"><strong>Alasan:</strong> ' + esc(r.alasan) + '</div>' +
      '</div>';
    document.getElementById('rvr_detail').innerHTML = detail;
    document.getElementById('rvr_catatan').value = '';
    var m = document.getElementById('rvr_msg'); m.className = 'msg'; m.textContent = '';
    document.getElementById('revisiReviewOverlay').classList.add('open');
  }
  function closeRevisiReview() { document.getElementById('revisiReviewOverlay').classList.remove('open'); _revisiReviewId = null; }
  document.getElementById('revisiReviewOverlay').addEventListener('click', function(e) { if (e.target === this) closeRevisiReview(); });

  function reviewRevisi(keputusan, opts) {
    if (!_revisiReviewId) return;
    var r = null;
    (_revisiCache || []).forEach(function(x) { if (x.id === _revisiReviewId) r = x; });
    if (!r) return;
    var accBtn = document.getElementById('rvr_acc');
    var tolakBtn = document.getElementById('rvr_tolak');
    // Bug #6 — cegah klik ganda / klik cepat ACC lalu Tolak (atau sebaliknya)
    // sebelum request pertama selesai: selama salah satu tombol sedang terkunci,
    // panggilan baru diabaikan sepenuhnya, bukan cuma dilewat begitu saja.
    if (accBtn.disabled || tolakBtn.disabled) return;

    var msg = document.getElementById('rvr_msg');
    var catatan = document.getElementById('rvr_catatan').value.trim();
    var statusSave = keputusan === 'ACC' ? 'DONE REVISI' : 'DITOLAK';

    var orig = null;
    (_cache || []).forEach(function(x) { if (x.rowId === r.cutiId) orig = x; });

    if (keputusan === 'ACC') {
      // Bug #2 — data cuti asli sudah dihapus (orphan): PATCH ke tabel `cuti`
      // tidak akan mengubah baris apa pun sama sekali, tapi sbPatch memakai
      // return=minimal yang tetap membalas "sukses" walau 0 baris ter-update —
      // jadi harus ditolak DI SINI, bukan dibiarkan menampilkan toast berhasil
      // yang palsu (lihat juga komentar di fungsi sbDelete soal celah yang sama).
      if (!orig) {
        msg.className = 'msg error';
        msg.textContent = 'Tidak bisa ACC: data cuti asli untuk revisi ini sudah tidak ada (kemungkinan sudah dihapus). Tolak revisi ini, atau minta staff mengajukan cuti baru.';
        return;
      }
      // Bug #9 — cek ulang aturan bentrok jadwal dengan data TERKINI sebelum
      // benar-benar diterapkan (bisa saja ada pengajuan lain yang baru disetujui
      // setelah staff mengirim revisi ini, sehingga tanggal revisi jadi bentrok).
      // Sebelumnya bentrok hanya dicek sekali saat staff submit, tidak pernah
      // dicek ulang saat admin approve. `opts._forceClash` dipakai saat admin
      // memilih tetap melanjutkan walau ada bentrok (override manual).
      if (!(opts && opts._forceClash)) {
        var leavesCek = [];
        if (r.start1 && r.end1) leavesCek.push({ perihal: r.perihal1, start: r.start1, end: r.end1 });
        if (r.start2 && r.end2) leavesCek.push({ perihal: r.perihal2, start: r.start2, end: r.end2 });
        accBtn.disabled = true; tolakBtn.disabled = true;
        var accLabelCek = accBtn.textContent; accBtn.textContent = 'Memeriksa bentrok…';
        checkClashOnSubmit(r.nama, orig.role, leavesCek).then(function(clashReason) {
          accBtn.disabled = false; tolakBtn.disabled = false; accBtn.textContent = accLabelCek;
          if (clashReason) {
            confirmDialog({
              title: 'Tanggal Revisi Bentrok',
              text: 'Tanggal hasil revisi ini bentrok dengan pengajuan cuti lain yang sudah ada (' + clashReason.replace(/\n/g, ' ') + '). Tetap ACC & terapkan tanggal ini? Aturan bentrok akan dilewati secara manual oleh admin.',
              okLabel: 'Tetap ACC', okClass: 'btn-danger', cancelLabel: 'Batal'
            }, function() { reviewRevisi('ACC', { _forceClash: true }); });
            return;
          }
          reviewRevisi('ACC', { _forceClash: true });
        }).catch(function(err) {
          accBtn.disabled = false; tolakBtn.disabled = false; accBtn.textContent = accLabelCek;
          msg.className = 'msg error'; msg.textContent = 'Gagal memeriksa bentrok: ' + err.message;
        });
        return;
      }
    }

    // Bug #6 — kunci kedua tombol selama request benar-benar berjalan.
    accBtn.disabled = true; tolakBtn.disabled = true;
    var accLabel = accBtn.textContent, tolakLabel = tolakBtn.textContent;
    (keputusan === 'ACC' ? accBtn : tolakBtn).textContent = 'Memproses…';

    // Update status revisi
    sbPatch('revisi_cuti', 'id=eq.' + encodeURIComponent(_revisiReviewId), {
      status: statusSave, catatan_admin: catatan
    }).then(function() {
      if (keputusan === 'ACC') {
        // Terapkan perubahan ke cuti asli
        var patch = {
          start1: r.start1 || null, end1: r.end1 || null, perihal1: r.perihal1 || null,
          start2: r.start2 || null, end2: r.end2 || null, perihal2: r.perihal2 || null,
          durasi1: r.start1 && r.end1 ? calcDurasi(r.start1, r.end1) + ' Hari' : null,
          durasi2: r.start2 && r.end2 ? calcDurasi(r.start2, r.end2) + ' Hari' : null
        };
        return sbPatch('cuti', 'id=eq.' + encodeURIComponent(r.cutiId), patch).then(function() {
          toast('Revisi di-ACC & diterapkan ke data cuti', 'ok');
          logActivity('CUTI', 'UPDATE', 'ACC revisi cuti ' + r.nama);
          invalidate(); loadDashboard(true);
        });
      } else {
        toast('Revisi ditolak', 'ok');
        logActivity('CUTI', 'STATUS', 'Tolak revisi cuti ' + r.nama);
      }
    }).then(function() {
      accBtn.disabled = false; tolakBtn.disabled = false; accBtn.textContent = accLabel; tolakBtn.textContent = tolakLabel;
      closeRevisiReview();
      _revisiLoaded = false; loadRevisi(true);
    }).catch(function(err) {
      accBtn.disabled = false; tolakBtn.disabled = false; accBtn.textContent = accLabel; tolakBtn.textContent = tolakLabel;
      msg.className = 'msg error'; msg.textContent = 'Gagal: ' + err.message;
    });
  }

  function calcDurasi(start, end) {
    var s = new Date(start), e = new Date(end);
    return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
  }

  // ── KALENDER ──────────────────────────────────────────────────
  var calRef = new Date(); calRef.setDate(1);

  function ymdKey(y, m, d) { return Math.round(Date.UTC(y, m, d) / 86400000); }
  function keyToDate(k) { return new Date(k * 86400000); }

  function ensureData(cb) {
    if (_cache) { cb(); return; }
    var p = _prefetch || getCuti().then(function(r) { _cache = r; _loaded = true; _clashIdx = null; _filterVer++; _memoMonth = null; _memoStatus = null; return r; });
    p.then(function() { cb(); }).catch(function() { _cache = _cache || []; cb(); });
  }

  // Semua cuti (kedua slot) sebagai batang kalender
  var _allLeavesMemo = null, _allLeavesVer = -1;
  function allLeaves() {
    if (_allLeavesVer === _filterVer && _allLeavesMemo !== null) return _allLeavesMemo;
    var out = [];
    (_cache || []).forEach(function(r) {
      [[r.perihal1, r.start1Raw, r.end1Raw], [r.perihal2, r.start2Raw, r.end2Raw]].forEach(function(t) {
        if (t[1] && t[2]) out.push({
          nama: r.nama, role: r.role, perihal: t[0] || '',
          s: dayKey(t[1]), e: dayKey(t[2]), sRaw: t[1], eRaw: t[2]
        });
      });
    });
    _allLeavesMemo = out; _allLeavesVer = _filterVer;
    return out;
  }

  // Hari-hari bentrok: { dayKey: { perihal: jumlahStaff } } untuk LOKAL/INDO
  function computeClashDays(leaves) {
    var byDay = {};
    leaves.forEach(function(lv) {
      if (CLASH_PERIHAL.indexOf(lv.perihal) === -1) return;
      var key = (lv.role || '-') + ' • ' + lv.perihal;   // bentrok dihitung PER ROLE
      for (var d = lv.s; d <= lv.e; d++) {
        byDay[d] = byDay[d] || {};
        byDay[d][key] = byDay[d][key] || {};
        byDay[d][key][lv.nama] = 1;
      }
    });
    var clash = {};
    Object.keys(byDay).forEach(function(d) {
      Object.keys(byDay[d]).forEach(function(k) {
        var n = Object.keys(byDay[d][k]).length;
        if (n >= 2) { clash[d] = clash[d] || {}; clash[d][k] = n; }
      });
    });
    return clash;
  }

  function shortName(nama) {
    var s = String(nama || '').split(' - ')[0].trim();
    return s || nama || '?';
  }
  function titleCase(s) {
    return String(s || '').toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }
  function fmtKey(k) {
    var d = keyToDate(k);
    return d.getUTCDate() + ' ' + MONTHS_ID[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function calShift(n) { calRef.setMonth(calRef.getMonth() + n); renderCalendar(); }
  function calToday() { calRef = new Date(); calRef.setDate(1); renderCalendar(); }

  // Segmen bentrok: rentang hari berurutan di mana kumpulan staff (ROLE & perihal sama)
  // tetap sama dan berjumlah >= 2 orang.
  function computeClashSegments(leaves, winStart, winEnd) {
    var segs = [];
    var roles = {};
    leaves.forEach(function (l) { if (l.role) roles[l.role] = 1; });
    Object.keys(roles).forEach(function (role) {
      CLASH_PERIHAL.forEach(function (perihal) {
        var ivs = leaves.filter(function (l) {
          if (l.perihal !== perihal || l.role !== role) return false;
          // hanya cuti yang menyentuh jendela tampil (hemat perhitungan)
          if (winStart != null && (l.s > winEnd || l.e < winStart)) return false;
          return true;
        });
        if (ivs.length < 2) return;
        var minD = Infinity, maxD = -Infinity;
        ivs.forEach(function (l) { if (l.s < minD) minD = l.s; if (l.e > maxD) maxD = l.e; });
        if (winStart != null) { minD = Math.max(minD, winStart); maxD = Math.min(maxD, winEnd); }
        var curKey = null, curNames = null, curStart = null;
        for (var d = minD; d <= maxD; d++) {
          var names = [];
          for (var i = 0; i < ivs.length; i++) if (ivs[i].s <= d && d <= ivs[i].e) names.push(ivs[i].nama);
          names.sort();
          var key = names.join('|');
          if (key !== curKey) {
            if (curNames && curNames.length >= 2)
              segs.push({ role: role, perihal: perihal, s: curStart, e: d - 1, names: curNames });
            curKey = key; curNames = names; curStart = d;
          }
        }
        if (curNames && curNames.length >= 2)
          segs.push({ role: role, perihal: perihal, s: curStart, e: maxD, names: curNames });
      });
    });
    segs.sort(function (a, b) { return a.s - b.s || String(a.role).localeCompare(b.role); });
    return segs;
  }

  function renderClashList(segments) {
    var host = document.getElementById('calClashList');
    if (!segments.length) {
      host.innerHTML = '<div class="clash-none">✅ Tidak ada bentrok di bulan ini.</div>';
      return;
    }
    host.innerHTML = segments.map(function (sg) {
      var lokal = sg.perihal === 'CUTI LOKAL';
      var dot = lokal ? 'dot-lokal' : 'dot-indo';
      var lv = sg.names.length >= 3 ? 'lv3' : 'lv2';
      var tgl = sg.s === sg.e ? fmtKey(sg.s) : (fmtKey(sg.s) + ' – ' + fmtKey(sg.e));
      var nm = sg.names.map(function (n) { return titleCase(shortName(n)); }).join(', ');
      return '<div class="clash-item">' +
        '<span class="clash-dot ' + dot + '"></span>' +
        '<div class="clash-main"><div class="clash-names">' + esc(nm) + '</div>' +
        '<div class="clash-meta">' + esc(sg.perihal) + ' · ' + esc(tgl) + '</div></div>' +
        '<span class="pill pill-role ' + roleCls(sg.role) + '">' + esc(sg.role) + '</span>' +
        '<span class="clash-badge ' + lv + '">' + sg.names.length + ' staff</span>' +
      '</div>';
    }).join('');
  }

  function renderCalendar() {
    var grid = document.getElementById('calGrid');
    grid.innerHTML = '<div class="cal-empty">Memuat…</div>';
    ensureData(function () {
      var year = calRef.getFullYear(), month = calRef.getMonth();
      document.getElementById('calTitle').textContent = MONTHS_ID[month] + ' ' + year;

      var leaves = allLeaves();
      var clashDays = computeClashDays(leaves);   // { hari: { perihal: jumlah } }

      var firstKey = ymdKey(year, month, 1);
      var firstDow = (keyToDate(firstKey).getUTCDay() + 6) % 7;   // Senin=0 … Minggu=6
      var gridStart = firstKey - firstDow;
      var daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      var lastKey = ymdKey(year, month, daysInMonth);
      var todayKey = (function () { var n = new Date(); return ymdKey(n.getFullYear(), n.getMonth(), n.getDate()); })();

      var html = '', gridEnd = gridStart;
      for (var w = 0; w < 6; w++) {
        var weekStart = gridStart + w * 7;
        if (weekStart > lastKey) break;
        var cells = '';
        for (var i = 0; i < 7; i++) {
          var k = weekStart + i, dt = keyToDate(k);
          gridEnd = k;
          var out = dt.getUTCMonth() !== month ? ' out' : '';
          var today = k === todayKey ? ' today' : '';
          var cd = clashDays[k], cnt = 0;
          if (cd) Object.keys(cd).forEach(function (p) { if (cd[p] > cnt) cnt = cd[p]; });
          var cls = cnt >= 3 ? ' clash-3' : cnt >= 2 ? ' clash-2' : '';
          var badge = cnt >= 2 ? '<span class="cal-count' + (cnt >= 3 ? ' hi' : '') + '">⚠ ' + cnt + '</span>' : '';
          cells += '<div class="cal-day' + out + today + cls + '"><span class="dnum">' + dt.getUTCDate() + '</span>' + badge + '</div>';
        }
        html += '<div class="cal-week">' + cells + '</div>';
      }
      grid.innerHTML = html || '<div class="cal-empty">Belum ada data cuti.</div>';

      // Daftar rincian bentrok yg terlihat di rentang kalender ini
      var segs = computeClashSegments(leaves, gridStart, gridEnd);
      renderClashList(segs);
    });
  }


  // ── Init ──────────────────────────────────────────────────────
  // Pulihkan sesi admin (bila ada) SEBELUM request pertama, agar token ikut terpakai.
  loadSession();
  function bootAuth() {
    // Bila token sudah/hampir kedaluwarsa, coba perpanjang dulu
    if (AUTH && AUTH.expires_at && AUTH.expires_at < Date.now() + 60000) {
      return authRefresh().catch(function() { clearSession(); });
    }
    return Promise.resolve();
  }

  // Listener tombol login & aturan
  document.getElementById('loginSubmit').addEventListener('click', submitLogin);
  document.getElementById('loginPass').addEventListener('keydown', function(e){ if(e.key==='Enter') submitLogin(); });
  document.getElementById('loginOverlay').addEventListener('click', function(e){ if(e.target===this) closeLogin(); });
  document.getElementById('rulesSave').addEventListener('click', submitRules);
  document.getElementById('rulesOverlay').addEventListener('click', function(e){ if(e.target===this) closeRules(); });

  bootAuth().then(function() {
  applyAuthUI();
  if (AUTH && AUTH.refresh_token) startRefreshTimer();
    _prefetch = getCuti().then(function(rows) {
      _cache = rows; _loaded = true; _clashIdx = null; _filterVer++; _memoMonth = null; _memoStatus = null;
      if (document.getElementById('view-dashboard').classList.contains('active')) {
        document.getElementById('dashboardLoading').style.display = 'none';
        renderFilters(); applyFilters(); updateTabCounts();
        document.getElementById('dashboardContent').style.display = 'block';
      } else {
        // Meski view Dashboard Pengajuan belum aktif, badge sidebar & notifikasi
        // "menyapu" tetap harus tahu ada cuti WAITING sejak awal.
        refreshWaitingAlert();
      }
      return rows;
    }).catch(function() { _prefetch = null; return null; });

    loadRules();   // muat aturan dari settings (diam-diam pakai default bila belum ada)

    getConfig().then(function(cfg) {
      CONFIG = cfg;
      checkCoreStatuses();
      fillSelect(document.getElementById('role'), 'ROLE', '');
      fillSelect(document.getElementById('keterangan'), 'KETERANGAN', '');
      fillSelect(document.getElementById('tambahan'), 'TAMBAHAN', 'Tidak Ada', false);
      fillSelect(document.getElementById('r_bankLama'), 'BANK', '');
      fillSelect(document.getElementById('r_bankBaru'), 'BANK', '');
      initCombos();
      renderRekChips();
      renderResignChips();
      renderLogChips();
      renderRevisiChips();
      addFormLeave(false);
      fillLdr();
      renderFilters();
      if (_cache && document.getElementById('view-dashboard').classList.contains('active')) applyFilters();

      // Pre-fetch resign & rekening counts untuk sidebar badges
      getResign().then(function(rows) { _resignCache = rows; _resignLoaded = true; updateResignCount(); }).catch(function() {});
      getRekening().then(function(rows) { _rekCache = rows; _rekLoaded = true; updateRekCount(); }).catch(function() {});
      getRevisi().then(function(rows) { _revisiCache = rows; _revisiLoaded = true; updateRevisiCount(); }).catch(function() {});
    }).catch(function(err) {
      toast('Gagal memuat konfigurasi — cek SUPABASE_URL & KEY', 'err');
      alert('Gagal memuat konfigurasi: ' + err.message + '\n\nPastikan SUPABASE_URL dan SUPABASE_KEY sudah benar.');
    });
  });
