/* global process */
import { getDeviceStatus, connectDevice, removeDevice } from "../controllers/deviceController.mjs";
import { getClientState, isClientReady, client } from "../whatsappClient.mjs";
import { redisManager, listMessagesByStatus, getMessageStatusSummary, getMessageById, deleteMessage, updateMessageStatus } from "../helpers/redisHelper.mjs";
import { queueMonitor } from "../helpers/queueMonitor.mjs";
import { appConfig } from "../config.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";
import logger from "../logger.mjs";

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WhatsApp API Admin</title>
  <style>
    :root { color-scheme: dark; --bg: #07111f; --panel: #0f1c2e; --panel-2: #14243a; --text: #e6edf7; --muted: #94a3b8; --accent: #22c55e; --danger: #ef4444; --warn: #f59e0b; --line: #24364f; --blue: #38bdf8; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, #123055 0, var(--bg) 34rem); color: var(--text); }
    button, input, select { font: inherit; }
    .hidden { display: none !important; }
    .login { min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; }
    .login-card { width: min(28rem, 100%); background: rgba(15, 28, 46, .92); border: 1px solid var(--line); border-radius: 1.25rem; padding: 2rem; box-shadow: 0 1.5rem 4rem rgba(0,0,0,.35); }
    .login-card h1 { margin: 0 0 .5rem; font-size: 1.6rem; }
    .login-card p { margin: 0 0 1.5rem; color: var(--muted); }
    .field { display: grid; gap: .45rem; margin-bottom: 1rem; }
    label { color: var(--muted); font-size: .9rem; }
    input, select { width: 100%; border: 1px solid var(--line); color: var(--text); background: #091626; border-radius: .75rem; padding: .75rem .9rem; outline: none; }
    input:focus, select:focus { border-color: var(--blue); box-shadow: 0 0 0 .2rem rgba(56,189,248,.12); }
    .btn { border: 0; border-radius: .75rem; padding: .75rem 1rem; cursor: pointer; color: #03120a; background: var(--accent); font-weight: 700; transition: transform .12s ease, opacity .12s ease; }
    .btn:hover { transform: translateY(-1px); }
    .btn.secondary { background: #263850; color: var(--text); }
    .btn.danger { background: var(--danger); color: #fff; }
    .btn.warn { background: var(--warn); color: #1f1300; }
    .btn.small { padding: .45rem .65rem; font-size: .85rem; }
    .btn:disabled { opacity: .55; cursor: not-allowed; transform: none; }
    .shell { min-height: 100vh; display: grid; grid-template-columns: 16rem 1fr; }
    aside { border-right: 1px solid var(--line); background: rgba(7,17,31,.86); padding: 1.25rem; position: sticky; top: 0; height: 100vh; }
    .brand { font-size: 1.15rem; font-weight: 800; margin-bottom: 1.5rem; }
    nav { display: grid; gap: .45rem; }
    .nav-btn { text-align: left; color: var(--muted); background: transparent; border: 1px solid transparent; border-radius: .8rem; padding: .75rem .85rem; cursor: pointer; }
    .nav-btn.active, .nav-btn:hover { color: var(--text); background: var(--panel); border-color: var(--line); }
    main { padding: 1.5rem; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1.25rem; }
    h2 { margin: 0; }
    .subtle { color: var(--muted); }
    .grid { display: grid; gap: 1rem; }
    .cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .card { background: rgba(15,28,46,.88); border: 1px solid var(--line); border-radius: 1rem; padding: 1rem; box-shadow: 0 .75rem 2rem rgba(0,0,0,.16); }
    .card-title { color: var(--muted); font-size: .85rem; margin-bottom: .5rem; }
    .metric { font-size: 1.8rem; font-weight: 800; }
    .pill { display: inline-flex; align-items: center; gap: .35rem; border: 1px solid var(--line); border-radius: 999px; padding: .25rem .55rem; color: var(--muted); background: #091626; font-size: .82rem; }
    .pill.ok { color: #86efac; border-color: rgba(34,197,94,.35); }
    .pill.bad { color: #fca5a5; border-color: rgba(239,68,68,.35); }
    .pill.warn { color: #fcd34d; border-color: rgba(245,158,11,.35); }
    .actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: .8rem; }
    th, td { padding: .75rem; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-size: .82rem; font-weight: 600; background: #0b1728; }
    tr:hover td { background: rgba(20,36,58,.45); }
    code, pre { background: #081321; border: 1px solid var(--line); border-radius: .75rem; }
    pre { padding: 1rem; overflow: auto; max-height: 24rem; white-space: pre-wrap; word-break: break-word; }
    .qr-box { display: grid; gap: .75rem; }
    textarea { width: 100%; resize: vertical; border: 1px solid var(--line); color: var(--text); background: #091626; border-radius: .75rem; padding: .75rem .9rem; outline: none; }
    textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 .2rem rgba(56,189,248,.12); }
    .chat-layout { display: grid; place-items: center; }
    .chat-card { width: min(54rem, 100%); height: min(72vh, 48rem); min-height: 38rem; display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; background: #0b1728; border: 1px solid var(--line); border-radius: 1.2rem; box-shadow: 0 1rem 3rem rgba(0,0,0,.22); }
    .chat-header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 1rem; background: linear-gradient(135deg, #075e54, #0f766e); border-bottom: 1px solid rgba(255,255,255,.12); }
    .chat-messages { display: flex; flex-direction: column; gap: .75rem; padding: 1rem; overflow-y: auto; background: radial-gradient(circle at top, rgba(34,197,94,.08), transparent 18rem), #091626; }
    .bubble { max-width: min(78%, 36rem); border-radius: 1rem; padding: .75rem .9rem; line-height: 1.4; box-shadow: 0 .35rem 1rem rgba(0,0,0,.16); white-space: pre-wrap; word-break: break-word; }
    .bubble.out { align-self: flex-end; background: #075e54; border-bottom-right-radius: .25rem; }
    .bubble.in { align-self: flex-start; background: var(--panel-2); border-bottom-left-radius: .25rem; }
    .bubble.system { align-self: center; color: var(--muted); background: rgba(15,28,46,.88); border: 1px solid var(--line); font-size: .9rem; }
    .bubble-meta { display: block; margin-top: .35rem; color: rgba(230,237,247,.72); font-size: .75rem; }
    .chat-compose { display: grid; gap: .75rem; padding: 1rem; background: var(--panel); border-top: 1px solid var(--line); }
    .compose-grid { display: grid; grid-template-columns: 10rem 1fr 10rem; gap: .65rem; }
    .media-fields { display: grid; grid-template-columns: 1fr 1fr; gap: .65rem; }
    .media-fields .subtle { grid-column: 1 / -1; margin: 0; font-size: .85rem; }
    .compose-actions { justify-content: flex-end; }
    .toast { position: fixed; right: 1rem; bottom: 1rem; background: #0b1728; border: 1px solid var(--line); border-radius: .85rem; padding: .85rem 1rem; box-shadow: 0 .75rem 2rem rgba(0,0,0,.3); max-width: min(30rem, calc(100vw - 2rem)); }
    .toast.error { border-color: rgba(239,68,68,.6); }
    @media (max-width: 980px) { .shell { grid-template-columns: 1fr; } aside { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); padding: .85rem; } .brand { margin-bottom: .75rem; } nav { grid-template-columns: repeat(3, minmax(0, 1fr)); } .nav-btn { text-align: center; padding: .65rem .5rem; } main { padding: 1rem; } .cards, .two { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } .compose-grid, .media-fields { grid-template-columns: 1fr; } .chat-card { height: calc(100vh - 14rem); min-height: 34rem; } }
    @media (max-width: 640px) { body { background: var(--bg); } main { padding: .75rem; } aside { position: sticky; top: 0; z-index: 5; background: rgba(7,17,31,.96); } nav { display: flex; overflow-x: auto; gap: .5rem; padding-bottom: .2rem; } .nav-btn { flex: 0 0 auto; min-width: 7.2rem; } .actions { width: 100%; } .actions .btn { flex: 1 1 auto; } .card { padding: .8rem; border-radius: .85rem; } .metric { font-size: 1.45rem; } th, td { padding: .6rem; font-size: .86rem; } pre { max-height: 18rem; font-size: .82rem; } .chat-layout { margin: -.25rem; } .chat-card { height: calc(100vh - 12rem); min-height: 32rem; border-radius: .85rem; } .chat-header, .chat-compose { padding: .75rem; } .chat-messages { padding: .75rem; } .bubble { max-width: 90%; font-size: .92rem; } .compose-actions { gap: .5rem; } .toast { left: .75rem; right: .75rem; bottom: .75rem; } }
  </style>
</head>
<body>
  <section id="loginView" class="login">
    <form id="loginForm" class="login-card">
      <h1>WhatsApp API Admin</h1>
      <p>Login menggunakan API key. Key hanya disimpan di session tab browser.</p>
      <div class="field">
        <label for="apiKeyInput">API Key</label>
        <input id="apiKeyInput" type="password" autocomplete="current-password" placeholder="Masukkan API key" required />
      </div>
      <button class="btn" type="submit">Login</button>
    </form>
  </section>

  <section id="appView" class="shell hidden">
    <aside>
      <div class="brand">WA Admin</div>
      <nav>
        <button class="nav-btn active" data-page="overview">Overview</button>
        <button class="nav-btn" data-page="device">Device</button>
        <button class="nav-btn" data-page="tester">Send Tester</button>
        <button class="nav-btn" data-page="queue">Queue</button>
        <button class="nav-btn" data-page="schedules">Schedules</button>
        <button class="nav-btn" data-page="health">Health</button>
      </nav>
    </aside>
    <main>
      <header>
        <div>
          <h2 id="pageTitle">Overview</h2>
          <div class="subtle">Auto refresh setiap 10 detik untuk overview, device, dan queue.</div>
        </div>
        <div class="actions">
          <button id="refreshBtn" class="btn secondary" type="button">Refresh</button>
          <button id="logoutBtn" class="btn danger" type="button">Logout</button>
        </div>
      </header>

      <section id="overviewPage" class="page grid">
        <div class="grid cards">
          <div class="card"><div class="card-title">API</div><div id="apiStatus" class="metric">-</div></div>
          <div class="card"><div class="card-title">WhatsApp</div><div id="waStatus" class="metric">-</div></div>
          <div class="card"><div class="card-title">Queue Size</div><div id="queueSize" class="metric">-</div></div>
          <div class="card"><div class="card-title">Scheduled</div><div id="scheduledCount" class="metric">-</div></div>
        </div>
        <div class="grid two">
          <div class="card"><div class="card-title">Queue Metrics</div><pre id="overviewQueue">Loading...</pre></div>
          <div class="card"><div class="card-title">Schedule Summary</div><pre id="overviewSchedules">Loading...</pre></div>
        </div>
      </section>

      <section id="devicePage" class="page grid hidden">
        <div class="card">
          <div class="actions">
            <button id="connectBtn" class="btn" type="button">Connect / Generate QR</button>
            <button id="removeDeviceBtn" class="btn danger" type="button">Remove Device</button>
          </div>
        </div>
        <div class="grid two">
          <div class="card"><div class="card-title">Device Status</div><pre id="deviceStatus">Loading...</pre></div>
          <div class="card qr-box"><div class="card-title">QR Code Data</div><p class="subtle">Scan QR dari terminal server. Jika perlu, salin raw QR ini ke QR generator internal tepercaya.</p><pre id="qrData">No QR</pre></div>
        </div>
      </section>

      <section id="testerPage" class="page grid hidden">
        <div class="chat-layout">
          <div class="chat-card">
            <div class="chat-header">
              <div>
                <strong>Send Message Tester</strong>
                <div class="subtle">Uji kirim text atau media seperti percakapan WhatsApp.</div>
              </div>
              <span id="testerStatus" class="pill">Ready</span>
            </div>
            <div id="chatMessages" class="chat-messages">
              <div class="bubble system">Masukkan tujuan, pilih tipe pesan, lalu kirim pesan ujicoba.</div>
            </div>
            <form id="sendTesterForm" class="chat-compose">
              <div class="compose-grid">
                <select id="testerRecipientType" aria-label="Recipient type">
                  <option value="individual">Individual</option>
                  <option value="group">Group</option>
                </select>
                <input id="testerTo" type="text" inputmode="numeric" placeholder="Nomor / Group ID" required />
                <select id="testerType" aria-label="Message type">
                  <option value="text">Text</option>
                  <option value="image">Image</option>
                  <option value="document">Document</option>
                  <option value="video">Video</option>
                  <option value="audio">Audio</option>
                </select>
              </div>
              <textarea id="testerText" rows="3" placeholder="Tulis pesan text atau caption media"></textarea>
              <div id="mediaFields" class="media-fields hidden">
                <input id="testerMediaUrl" type="url" placeholder="Media URL, opsional jika upload file" />
                <input id="testerMediaFile" type="file" />
                <input id="testerFilename" type="text" placeholder="Filename opsional" />
                <p class="subtle">Gunakan URL media atau upload file. File akan dikonversi ke base64 di browser.</p>
              </div>
              <div class="actions compose-actions">
                <button class="btn" type="submit">Send Test</button>
                <button id="clearChatBtn" class="btn secondary" type="button">Clear Chat</button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section id="queuePage" class="page grid hidden">
        <div class="grid two">
          <div class="card"><div class="card-title">Metrics</div><pre id="queueMetrics">Loading...</pre></div>
          <div class="card"><div class="card-title">Health</div><pre id="queueHealth">Loading...</pre></div>
        </div>
      </section>

      <section id="schedulesPage" class="page grid hidden">
        <div class="card actions">
          <select id="scheduleStatus">
            <option value="scheduled">scheduled</option>
            <option value="sent">sent</option>
            <option value="failed">failed</option>
          </select>
          <input id="scheduleLimit" type="number" min="1" max="100" value="50" />
          <button id="loadSchedulesBtn" class="btn secondary" type="button">Load</button>
        </div>
        <div class="card" style="overflow:auto"><table><thead><tr><th>ID</th><th>Chat</th><th>Status</th><th>Scheduled</th><th>Updated</th><th>Action</th></tr></thead><tbody id="scheduleRows"><tr><td colspan="6">Loading...</td></tr></tbody></table></div>
        <div class="card"><div class="card-title">Selected Detail</div><pre id="scheduleDetail">No selection</pre></div>
      </section>

      <section id="healthPage" class="page grid hidden">
        <div class="card"><div class="card-title">Health</div><pre id="healthData">Loading...</pre></div>
      </section>
    </main>
  </section>
  <div id="toast" class="toast hidden"></div>

  <script>
    const state = { key: sessionStorage.getItem('wa_admin_api_key') || '', page: 'overview', timer: null };
    const $ = (id) => document.getElementById(id);
    const fmt = (value) => JSON.stringify(value, null, 2);

    function showToast(message, error = false) {
      const toast = $('toast');
      toast.textContent = message;
      toast.className = 'toast' + (error ? ' error' : '');
      setTimeout(() => toast.classList.add('hidden'), 4200);
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + state.key,
          ...(options.headers || {})
        }
      });
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : await response.text();
      if (!response.ok) {
        const message = data?.error?.message || data?.message || 'Request failed';
        throw new Error(message);
      }
      return data;
    }

    function setAuthenticated(authenticated) {
      $('loginView').classList.toggle('hidden', authenticated);
      $('appView').classList.toggle('hidden', !authenticated);
      if (authenticated) refreshCurrent();
    }

    async function login(key) {
      state.key = key;
      await api('/admin/api/me');
      sessionStorage.setItem('wa_admin_api_key', key);
      setAuthenticated(true);
      scheduleAutoRefresh();
    }

    function logout() {
      sessionStorage.removeItem('wa_admin_api_key');
      state.key = '';
      setAuthenticated(false);
      if (state.timer) clearInterval(state.timer);
    }

    function switchPage(page) {
      state.page = page;
      document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.page === page));
      document.querySelectorAll('.page').forEach((el) => el.classList.add('hidden'));
      $(page + 'Page').classList.remove('hidden');
      $('pageTitle').textContent = page.charAt(0).toUpperCase() + page.slice(1);
      refreshCurrent();
    }

    async function loadOverview() {
      const summary = await api('/admin/api/summary');
      const data = summary.data;
      $('apiStatus').textContent = data.health.status;
      $('waStatus').textContent = data.device.state;
      $('queueSize').textContent = data.queue.currentQueueSize ?? data.queue.queueSize ?? 0;
      $('scheduledCount').textContent = data.schedules.scheduled ?? 0;
      $('overviewQueue').textContent = fmt(data.queue);
      $('overviewSchedules').textContent = fmt(data.schedules);
    }

    async function loadDevice() {
      const res = await api('/admin/api/device/status');
      $('deviceStatus').textContent = fmt(res.data);
      $('qrData').textContent = res.data.qr || 'No QR in current status response. Use Connect / Generate QR.';
    }

    async function loadQueue() {
      const [metrics, health] = await Promise.all([api('/queue/metrics'), api('/queue/health')]);
      $('queueMetrics').textContent = fmt(metrics.data);
      $('queueHealth').textContent = fmt(health.data);
    }

    async function loadSchedules() {
      const status = $('scheduleStatus').value;
      const limit = $('scheduleLimit').value || 50;
      const res = await api('/admin/api/schedules?status=' + encodeURIComponent(status) + '&limit=' + encodeURIComponent(limit));
      const rows = $('scheduleRows');
      rows.innerHTML = '';
      if (!res.data.items.length) {
        rows.innerHTML = '<tr><td colspan="6">No messages</td></tr>';
        return;
      }
      for (const item of res.data.items) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td><code></code></td><td></td><td></td><td></td><td></td><td class="actions"></td>';
        tr.children[0].querySelector('code').textContent = item.id;
        tr.children[1].textContent = item.chatId;
        tr.children[2].innerHTML = '<span class="pill">' + item.status + '</span>';
        tr.children[3].textContent = new Date(item.scheduledTime).toLocaleString();
        tr.children[4].textContent = new Date(item.updatedAt).toLocaleString();
        const detail = document.createElement('button');
        detail.className = 'btn small secondary';
        detail.textContent = 'Detail';
        detail.onclick = () => loadScheduleDetail(item.id);
        const cancel = document.createElement('button');
        cancel.className = 'btn small warn';
        cancel.textContent = 'Cancel';
        cancel.disabled = item.status !== 'scheduled';
        cancel.onclick = () => updateScheduleStatus(item.id, 'failed');
        const del = document.createElement('button');
        del.className = 'btn small danger';
        del.textContent = 'Delete';
        del.onclick = () => deleteSchedule(item.id);
        tr.children[5].append(detail, cancel, del);
        rows.appendChild(tr);
      }
    }

    async function loadScheduleDetail(id) {
      const res = await api('/admin/api/schedules/' + encodeURIComponent(id));
      $('scheduleDetail').textContent = fmt(res.data);
    }

    async function updateScheduleStatus(id, status) {
      if (!confirm('Update message ' + id + ' to ' + status + '?')) return;
      await api('/admin/api/schedules/' + encodeURIComponent(id) + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
      showToast('Schedule updated');
      await loadSchedules();
    }

    async function deleteSchedule(id) {
      if (!confirm('Delete message ' + id + '?')) return;
      await api('/admin/api/schedules/' + encodeURIComponent(id), { method: 'DELETE' });
      showToast('Schedule deleted');
      await loadSchedules();
    }

    function addBubble(kind, text, meta = '') {
      const wrapper = document.createElement('div');
      wrapper.className = 'bubble ' + kind;
      wrapper.textContent = text;
      if (meta) {
        const metaEl = document.createElement('span');
        metaEl.className = 'bubble-meta';
        metaEl.textContent = meta;
        wrapper.appendChild(metaEl);
      }
      $('chatMessages').appendChild(wrapper);
      $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
    }

    function setTesterStatus(text, tone = '') {
      const status = $('testerStatus');
      status.textContent = text;
      status.className = 'pill' + (tone ? ' ' + tone : '');
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
    }

    function updateTesterFields() {
      const isMedia = $('testerType').value !== 'text';
      $('mediaFields').classList.toggle('hidden', !isMedia);
      $('testerText').placeholder = isMedia ? 'Caption media opsional' : 'Tulis pesan text';
    }

    async function sendTesterMessage(event) {
      event.preventDefault();
      const type = $('testerType').value;
      const text = $('testerText').value.trim();
      const mediaUrl = $('testerMediaUrl').value.trim();
      const file = $('testerMediaFile').files[0];
      const filename = $('testerFilename').value.trim();

      if (type === 'text' && !text) {
        showToast('Text message wajib diisi', true);
        return;
      }
      if (type !== 'text' && !mediaUrl && !file) {
        showToast('Isi media URL atau upload file', true);
        return;
      }

      const payload = {
        recipient_type: $('testerRecipientType').value,
        to: $('testerTo').value.trim(),
        type
      };

      if (type === 'text') {
        payload.text = { body: text };
      } else {
        payload.caption = text || undefined;
        payload.media = mediaUrl ? { url: mediaUrl } : {
          base64: await fileToBase64(file),
          mimeType: file.type || 'application/octet-stream',
          filename: filename || file.name
        };
        if (filename && payload.media.url) payload.media.filename = filename;
      }

      const preview = type === 'text' ? text : '[' + type + '] ' + (text || filename || mediaUrl || file?.name || 'media');
      addBubble('out', preview, 'Sending to ' + payload.to + '...');
      setTesterStatus('Sending', 'warn');

      try {
        const res = await api('/message', { method: 'POST', body: JSON.stringify(payload) });
        addBubble('in', res.message || 'Message sent successfully.', new Date().toLocaleTimeString());
        setTesterStatus('Sent', 'ok');
        $('testerText').value = '';
        $('testerMediaFile').value = '';
      } catch (error) {
        addBubble('in', 'Failed: ' + error.message, new Date().toLocaleTimeString());
        setTesterStatus('Failed', 'bad');
        showToast(error.message, true);
      }
    }

    async function loadHealth() {
      const res = await api('/health');
      $('healthData').textContent = fmt(res);
    }

    async function refreshCurrent() {
      try {
        if (!state.key) return;
        if (state.page === 'overview') await loadOverview();
        if (state.page === 'device') await loadDevice();
        if (state.page === 'queue') await loadQueue();
        if (state.page === 'schedules') await loadSchedules();
        if (state.page === 'health') await loadHealth();
      } catch (error) {
        showToast(error.message, true);
        if (error.message.toLowerCase().includes('api key') || error.message.toLowerCase().includes('unauthorized')) logout();
      }
    }

    async function connectDevice() {
      const res = await api('/admin/api/device/connect', { method: 'POST' });
      $('deviceStatus').textContent = fmt(res.data);
      $('qrData').textContent = res.data?.qr || 'No QR returned';
      showToast(res.message || 'Device connect requested');
    }

    async function removeDeviceAction() {
      if (!confirm('Remove connected WhatsApp device/session?')) return;
      const res = await api('/admin/api/device/remove', { method: 'DELETE' });
      showToast(res.message || 'Device removed');
      await loadDevice();
    }

    function scheduleAutoRefresh() {
      if (state.timer) clearInterval(state.timer);
      state.timer = setInterval(() => {
        if (['overview', 'device', 'queue'].includes(state.page)) refreshCurrent();
      }, 10000);
    }

    $('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try { await login($('apiKeyInput').value.trim()); } catch (error) { showToast(error.message, true); }
    });
    $('logoutBtn').addEventListener('click', logout);
    $('refreshBtn').addEventListener('click', refreshCurrent);
    $('connectBtn').addEventListener('click', connectDevice);
    $('removeDeviceBtn').addEventListener('click', removeDeviceAction);
    $('loadSchedulesBtn').addEventListener('click', loadSchedules);
    $('testerType').addEventListener('change', updateTesterFields);
    $('sendTesterForm').addEventListener('submit', sendTesterMessage);
    $('clearChatBtn').addEventListener('click', () => {
      $('chatMessages').innerHTML = '<div class="bubble system">Percakapan ujicoba dibersihkan.</div>';
      setTesterStatus('Ready');
    });
    updateTesterFields();
    document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', () => switchPage(btn.dataset.page)));

    if (state.key) login(state.key).catch(() => logout());
  </script>
</body>
</html>`;

function sendSuccess(reply, message, data = null, statusCode = 200) {
  return reply.code(statusCode).send({ status: "success", message, data });
}

function ensureAllowedStatus(status) {
  const allowedStatuses = new Set(["scheduled", "sent", "failed"]);
  if (!allowedStatuses.has(status)) {
    throw new AppError(
      ErrorTypes.VALIDATION_ERROR,
      HttpStatusCodes.BAD_REQUEST,
      "Status must be one of: scheduled, sent, failed",
      true
    );
  }
}

function getDeviceSummary() {
  const device = client.info?.wid ? {
    number: client.info.wid.user,
    name: client.info.pushname || "Unknown",
    platform: client.info.platform || "Unknown"
  } : null;

  return {
    state: getClientState(),
    isReady: isClientReady(),
    isConnected: Boolean(client.info?.wid),
    device
  };
}

async function getHealthSummary() {
  const redisHealthy = await redisManager.healthCheck();
  const whatsappHealthy = Boolean(client.info?.wid);

  return {
    status: redisHealthy && whatsappHealthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: appConfig.environment,
    services: {
      database: redisHealthy ? "healthy" : "unhealthy",
      whatsapp: whatsappHealthy ? "connected" : "disconnected"
    }
  };
}

export async function adminRoute(fastify) {
  fastify.get("/admin", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(ADMIN_HTML);
  });

  fastify.get("/admin/api/me", {
    preHandler: [fastify.authenticate]
  }, async (_request, reply) => sendSuccess(reply, "Authenticated", { authenticated: true }));

  fastify.get("/admin/api/summary", {
    preHandler: [fastify.authenticate]
  }, async (_request, reply) => {
    const [health, schedules] = await Promise.all([
      getHealthSummary(),
      getMessageStatusSummary()
    ]);

    return sendSuccess(reply, "Admin summary retrieved", {
      health,
      device: getDeviceSummary(),
      queue: queueMonitor.getMetrics(),
      queueHealth: queueMonitor.getHealthStatus(),
      schedules
    });
  });

  fastify.get("/admin/api/device/status", {
    preHandler: [fastify.authenticate]
  }, getDeviceStatus);

  fastify.post("/admin/api/device/connect", {
    preHandler: [fastify.authenticate]
  }, connectDevice);

  fastify.delete("/admin/api/device/remove", {
    preHandler: [fastify.authenticate]
  }, removeDevice);

  fastify.get("/admin/api/schedules", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const status = request.query?.status || "scheduled";
    ensureAllowedStatus(status);

    const result = await listMessagesByStatus({
      status,
      limit: request.query?.limit,
      offset: request.query?.offset
    });

    return sendSuccess(reply, "Scheduled messages retrieved", result);
  });

  fastify.get("/admin/api/schedules/:id", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const message = await getMessageById(request.params.id);
    if (!message) {
      throw new AppError(
        ErrorTypes.DATABASE_ERROR,
        HttpStatusCodes.NOT_FOUND,
        "Scheduled message not found",
        true
      );
    }

    return sendSuccess(reply, "Scheduled message retrieved", message);
  });

  fastify.patch("/admin/api/schedules/:id/status", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const status = request.body?.status;
    ensureAllowedStatus(status);
    await updateMessageStatus(request.params.id, status);
    logger.info({ messageId: request.params.id, status }, "Admin updated scheduled message status");
    return sendSuccess(reply, "Scheduled message status updated", { id: request.params.id, status });
  });

  fastify.delete("/admin/api/schedules/:id", {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    await deleteMessage(request.params.id);
    logger.info({ messageId: request.params.id }, "Admin deleted scheduled message");
    return sendSuccess(reply, "Scheduled message deleted", { id: request.params.id });
  });
}
