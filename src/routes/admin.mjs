import process from "process";
import { redisManager, listMessagesByStatus, getMessageStatusSummary, getMessageById, updateMessageStatus, deleteMessage } from "../helpers/redisHelper.mjs";
import { getDeviceStatus, connectDevice, removeDevice } from "../controllers/deviceController.mjs";
import { client, getClientState, isClientReady } from "../whatsappClient.mjs";
import { appConfig } from "../config.mjs";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

const SCHEDULED_FORMAT = "nas-wapi-scheduled-v1";
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const SCHEDULE_STATUSES = Object.freeze([
  "scheduled",
  "processing",
  "sent",
  "failed",
  "unknown",
  "enqueue_unknown",
  "cancelled",
]);

// Operator overrides. Nothing may move back to "scheduled": a retry could resend a message whose
// earlier attempt already reached WhatsApp. "processing" is locked while a worker owns the claim.
// "unknown" and "enqueue_unknown" are resolved by a human only (confirm sent, mark failed, or cancel).
const ADMIN_TRANSITIONS = Object.freeze({
  scheduled: Object.freeze(["cancelled", "failed"]),
  processing: Object.freeze([]),
  sent: Object.freeze([]),
  failed: Object.freeze([]),
  unknown: Object.freeze(["sent", "failed"]),
  enqueue_unknown: Object.freeze(["sent", "failed", "cancelled"]),
  cancelled: Object.freeze([]),
});
const OVERRIDE_TARGETS = Object.freeze(["cancelled", "failed", "sent"]);
const DELETABLE_STATUSES = Object.freeze(["sent", "failed", "cancelled"]);

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
    button, input, select, textarea { font: inherit; }
    .hidden { display: none !important; }
    .login { min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; }
    .login-card { width: min(28rem, 100%); background: rgba(15, 28, 46, .92); border: 1px solid var(--line); border-radius: 1.25rem; padding: 2rem; box-shadow: 0 1.5rem 4rem rgba(0,0,0,.35); }
    .login-card h1 { margin: 0 0 .5rem; font-size: 1.6rem; }
    .login-card p { margin: 0 0 1.5rem; color: var(--muted); }
    .field { display: grid; gap: .45rem; margin-bottom: 1rem; }
    label { color: var(--muted); font-size: .9rem; }
    input, select, textarea { width: 100%; border: 1px solid var(--line); color: var(--text); background: #091626; border-radius: .75rem; padding: .75rem .9rem; outline: none; }
    input:focus, select:focus, textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 .2rem rgba(56,189,248,.12); }
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
    main { padding: 1.5rem; min-width: 0; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1.25rem; }
    h2 { margin: 0; }
    .subtle { color: var(--muted); }
    .grid { display: grid; gap: 1rem; }
    .cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .card { background: rgba(15,28,46,.88); border: 1px solid var(--line); border-radius: 1rem; padding: 1rem; box-shadow: 0 .75rem 2rem rgba(0,0,0,.16); min-width: 0; }
    .card-title { color: var(--muted); font-size: .85rem; margin-bottom: .5rem; }
    .metric { font-size: 1.8rem; font-weight: 800; }
    .pill { display: inline-flex; align-items: center; gap: .35rem; border: 1px solid var(--line); border-radius: 999px; padding: .25rem .55rem; color: var(--muted); background: #091626; font-size: .82rem; }
    .pill.ok { color: #86efac; border-color: rgba(34,197,94,.35); }
    .pill.bad { color: #fca5a5; border-color: rgba(239,68,68,.35); }
    .pill.warn { color: #fcd34d; border-color: rgba(245,158,11,.35); }
    .actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
    .table-wrap { overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: .75rem; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-size: .82rem; font-weight: 600; background: #0b1728; }
    tr:hover td { background: rgba(20,36,58,.45); }
    code, pre { background: #081321; border: 1px solid var(--line); border-radius: .75rem; }
    code { padding: .1rem .3rem; word-break: break-all; }
    pre { padding: 1rem; overflow: auto; max-height: 24rem; white-space: pre-wrap; word-break: break-word; }
    .qr-box { display: grid; gap: .75rem; }
    .filters { align-items: center; }
    .filters select { width: auto; }
    .filters input { width: 8rem; }
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
    @media (max-width: 640px) { body { background: var(--bg); } main { padding: .75rem; } aside { position: sticky; top: 0; z-index: 5; background: rgba(7,17,31,.96); } nav { display: flex; overflow-x: auto; gap: .5rem; padding-bottom: .2rem; } .nav-btn { flex: 0 0 auto; min-width: 7.2rem; } .actions { width: 100%; } .actions .btn { flex: 1 1 auto; } .card { padding: .8rem; border-radius: .85rem; } .metric { font-size: 1.45rem; } th, td { padding: .6rem; font-size: .86rem; } pre { max-height: 18rem; font-size: .82rem; } .chat-layout { margin: -.25rem; } .chat-card { height: calc(100vh - 12rem); min-height: 32rem; border-radius: .85rem; } .chat-header, .chat-compose { padding: .75rem; } .chat-messages { padding: .75rem; } .bubble { max-width: 90%; font-size: .92rem; } }
  </style>
</head>
<body>
  <section id="loginView" class="login">
    <form id="loginForm" class="login-card">
      <h1>WhatsApp API Admin</h1>
      <p>Login menggunakan API key. Key hanya disimpan di memori halaman dan hilang saat halaman di-refresh.</p>
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
        <button class="nav-btn active" data-page="overview" type="button">Overview</button>
        <button class="nav-btn" data-page="device" type="button">Device</button>
        <button class="nav-btn" data-page="tester" type="button">Send Tester</button>
        <button class="nav-btn" data-page="queue" type="button">Queue</button>
        <button class="nav-btn" data-page="schedules" type="button">Schedules</button>
        <button class="nav-btn" data-page="health" type="button">Health</button>
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
          <div class="card"><div class="card-title">Scheduled (pending)</div><div id="scheduledCount" class="metric">-</div></div>
          <div class="card"><div class="card-title">Needs review (unknown / enqueue_unknown)</div><div id="reviewCount" class="metric">-</div></div>
        </div>
        <div class="grid two">
          <div class="card"><div class="card-title">Queue (Redis status counts)</div><pre id="overviewQueue">Loading...</pre></div>
          <div class="card"><div class="card-title">Health</div><pre id="overviewHealth">Loading...</pre></div>
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
          <div class="card qr-box"><div class="card-title">QR Code Data</div><p class="subtle">Scan QR dari terminal server. QR adalah kredensial login sesi WhatsApp; jangan dibagikan.</p><pre id="qrData">No QR</pre></div>
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
          <div class="card"><div class="card-title">Status counts (Redis, source of truth)</div><pre id="queueCounts">Loading...</pre></div>
          <div class="card"><div class="card-title">Review and queue monitor</div><pre id="queueHealth">Loading...</pre></div>
        </div>
      </section>

      <section id="schedulesPage" class="page grid hidden">
        <div class="card actions filters">
          <select id="scheduleStatus" aria-label="Status filter"></select>
          <input id="scheduleLimit" type="number" min="1" max="100" value="50" aria-label="Limit" />
          <button id="loadSchedulesBtn" class="btn secondary" type="button">Load</button>
        </div>
        <div class="card table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Chat</th><th>Status</th><th>Scheduled</th><th>Updated</th><th>Action</th></tr></thead>
            <tbody id="scheduleRows"><tr><td colspan="6">Loading...</td></tr></tbody>
          </table>
        </div>
        <div class="card"><div class="card-title">Selected Detail</div><pre id="scheduleDetail">No selection</pre></div>
      </section>

      <section id="healthPage" class="page grid hidden">
        <div class="card"><div class="card-title">Health</div><pre id="healthData">Loading...</pre></div>
      </section>
    </main>
  </section>
  <div id="toast" class="toast hidden" role="status"></div>

  <script>
    const STATUSES = ["scheduled", "processing", "sent", "failed", "unknown", "enqueue_unknown", "cancelled"];
    const STATUS_TONE = { sent: "ok", failed: "bad", unknown: "bad", processing: "warn", enqueue_unknown: "warn" };
    const ACTION_LABELS = { cancelled: "Cancel", failed: "Mark failed", sent: "Confirm sent" };
    const PAGE_TITLES = { overview: "Overview", device: "Device", tester: "Send Tester", queue: "Queue", schedules: "Schedules", health: "Health" };
    const state = { key: "", page: "overview", timer: null, toastTimer: null };
    const $ = (id) => document.getElementById(id);
    const fmt = (value) => JSON.stringify(value, null, 2);
    const display = (value) => (value === null || value === undefined ? "n/a" : String(value));

    function showToast(message, error = false) {
      const toast = $("toast");
      toast.textContent = String(message);
      toast.className = "toast" + (error ? " error" : "");
      clearTimeout(state.toastTimer);
      state.toastTimer = setTimeout(() => toast.classList.add("hidden"), 4200);
    }

    function httpError(message, status) {
      const error = new Error(message);
      error.status = status;
      return error;
    }

    async function api(path, options = {}) {
      const headers = { "Accept": "application/json", "Authorization": "Bearer " + state.key };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(path, { method: options.method || "GET", headers, body: options.body, cache: "no-store" });
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
      if (!response.ok) {
        const message = (data && typeof data === "object" && (data.message || data.error?.message)) || "Request failed (" + response.status + ")";
        throw httpError(message, response.status);
      }
      return data;
    }

    function showApp(authenticated) {
      $("loginView").classList.toggle("hidden", authenticated);
      $("appView").classList.toggle("hidden", !authenticated);
      if (authenticated) {
        scheduleAutoRefresh();
        refreshCurrent();
      }
    }

    async function login(key) {
      state.key = key;
      try {
        await api("/admin/api/me");
      } catch (error) {
        state.key = "";
        throw error;
      }
      showApp(true);
    }

    function logout() {
      state.key = "";
      clearInterval(state.timer);
      state.timer = null;
      showApp(false);
    }

    function switchPage(page) {
      state.page = page;
      document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.page === page));
      document.querySelectorAll(".page").forEach((el) => el.classList.add("hidden"));
      $(page + "Page").classList.remove("hidden");
      $("pageTitle").textContent = PAGE_TITLES[page] || page;
      refreshCurrent();
    }

    async function loadOverview() {
      const { data } = await api("/admin/api/summary");
      $("apiStatus").textContent = data.health.status;
      $("waStatus").textContent = data.device.state;
      $("scheduledCount").textContent = display(data.queue.counts.scheduled);
      const { unknown, enqueue_unknown: enqueueUnknown } = data.queue.counts;
      $("reviewCount").textContent = unknown === null || enqueueUnknown === null ? "n/a" : String(unknown + enqueueUnknown);
      $("overviewQueue").textContent = fmt(data.queue.counts);
      $("overviewHealth").textContent = fmt(data.health);
    }

    async function loadDevice() {
      const { data } = await api("/admin/api/device/status");
      $("deviceStatus").textContent = fmt(data);
      $("qrData").textContent = data.qr || "No QR in current status response. Use Connect / Generate QR.";
    }

    async function loadQueue() {
      const { data } = await api("/admin/api/queue");
      $("queueCounts").textContent = fmt(data.counts);
      $("queueHealth").textContent = fmt({ needsReview: data.needsReview, monitor: data.monitor });
    }

    function cell(text, className = "") {
      const td = document.createElement("td");
      if (className) td.className = className;
      td.textContent = text;
      return td;
    }

    function button(label, className, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = className;
      btn.textContent = label;
      btn.addEventListener("click", onClick);
      return btn;
    }

    function statusCell(status) {
      const td = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = "pill" + (STATUS_TONE[status] ? " " + STATUS_TONE[status] : "");
      pill.textContent = String(status);
      td.appendChild(pill);
      return td;
    }

    function formatDate(value) {
      if (!value) return "-";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
    }

    function actionsCell(item) {
      const td = document.createElement("td");
      td.className = "actions";
      td.appendChild(button("Detail", "btn small secondary", () => loadScheduleDetail(item.id)));
      for (const target of item.allowedTransitions || []) {
        td.appendChild(button(ACTION_LABELS[target] || target, target === "sent" ? "btn small" : "btn small warn", () => updateScheduleStatus(item.id, target)));
      }
      if (item.deletable) td.appendChild(button("Delete", "btn small danger", () => deleteSchedule(item.id)));
      if (!(item.allowedTransitions || []).length && !item.deletable) {
        const note = document.createElement("span");
        note.className = "subtle";
        note.textContent = item.status === "processing" ? "In progress" : "Manual review only";
        td.appendChild(note);
      }
      return td;
    }

    function messageRow(text) {
      const tr = document.createElement("tr");
      const td = cell(text);
      td.colSpan = 6;
      tr.appendChild(td);
      return tr;
    }

    async function loadSchedules() {
      const status = $("scheduleStatus").value;
      const limit = Math.min(Math.max(parseInt($("scheduleLimit").value, 10) || 50, 1), 100);
      const res = await api("/admin/api/schedules?status=" + encodeURIComponent(status) + "&limit=" + limit);
      const rows = $("scheduleRows");
      rows.replaceChildren();
      if (!res.data.items.length) {
        rows.appendChild(messageRow("No messages"));
        return;
      }
      for (const item of res.data.items) {
        const tr = document.createElement("tr");
        tr.append(cell(item.id, "mono"), cell(item.chatId), statusCell(item.status), cell(formatDate(item.scheduledTime)), cell(formatDate(item.updatedAt)), actionsCell(item));
        rows.appendChild(tr);
      }
    }

    async function loadScheduleDetail(id) {
      const res = await api("/admin/api/schedules/" + encodeURIComponent(id));
      $("scheduleDetail").textContent = fmt(res.data);
    }

    async function updateScheduleStatus(id, status) {
      if (!confirm("Change status of " + id + " to " + status + "? This does not send anything.")) return;
      await api("/admin/api/schedules/" + encodeURIComponent(id) + "/status", { method: "PATCH", body: JSON.stringify({ status }) });
      showToast("Schedule status updated");
      await loadSchedules();
    }

    async function deleteSchedule(id) {
      if (!confirm("Delete message " + id + "?")) return;
      await api("/admin/api/schedules/" + encodeURIComponent(id), { method: "DELETE" });
      showToast("Schedule deleted");
      await loadSchedules();
    }

    function addBubble(kind, text, meta = "") {
      const wrapper = document.createElement("div");
      wrapper.className = "bubble " + kind;
      wrapper.textContent = text;
      if (meta) {
        const metaEl = document.createElement("span");
        metaEl.className = "bubble-meta";
        metaEl.textContent = meta;
        wrapper.appendChild(metaEl);
      }
      $("chatMessages").appendChild(wrapper);
      $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
    }

    function setTesterStatus(text, tone = "") {
      const status = $("testerStatus");
      status.textContent = text;
      status.className = "pill" + (tone ? " " + tone : "");
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          resolve(result.includes(",") ? result.split(",")[1] : result);
        };
        reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
    }

    function updateTesterFields() {
      const isMedia = $("testerType").value !== "text";
      $("mediaFields").classList.toggle("hidden", !isMedia);
      $("testerText").placeholder = isMedia ? "Caption media opsional" : "Tulis pesan text";
    }

    async function sendTesterMessage(event) {
      event.preventDefault();
      const type = $("testerType").value;
      const text = $("testerText").value.trim();
      const mediaUrl = $("testerMediaUrl").value.trim();
      const file = $("testerMediaFile").files[0];
      const filename = $("testerFilename").value.trim();

      if (type === "text" && !text) {
        showToast("Text message wajib diisi", true);
        return;
      }
      if (type !== "text" && !mediaUrl && !file) {
        showToast("Isi media URL atau upload file", true);
        return;
      }

      const payload = {
        recipient_type: $("testerRecipientType").value,
        to: $("testerTo").value.trim(),
        type
      };

      try {
        if (type === "text") {
          payload.text = { body: text };
        } else {
          if (text) payload.caption = text;
          payload.media = mediaUrl ? { url: mediaUrl } : {
            base64: await fileToBase64(file),
            mimeType: file.type || "application/octet-stream",
            filename: filename || file.name
          };
          if (filename && payload.media.url) payload.media.filename = filename;
        }
      } catch (error) {
        showToast(error.message, true);
        return;
      }

      const preview = type === "text" ? text : "[" + type + "] " + (text || filename || mediaUrl || file?.name || "media");
      addBubble("out", preview, "Sending to " + payload.to + "...");
      setTesterStatus("Sending", "warn");

      try {
        const res = await api("/message", { method: "POST", body: JSON.stringify(payload) });
        addBubble("in", res.message || "Message sent successfully.", new Date().toLocaleTimeString());
        setTesterStatus("Sent", "ok");
        $("testerText").value = "";
        $("testerMediaFile").value = "";
      } catch (error) {
        addBubble("in", "Failed: " + error.message, new Date().toLocaleTimeString());
        setTesterStatus("Failed", "bad");
        showToast(error.message, true);
      }
    }

    async function loadHealth() {
      const { data } = await api("/admin/api/summary");
      $("healthData").textContent = fmt(data.health);
    }

    async function refreshCurrent() {
      if (!state.key) return;
      try {
        if (state.page === "overview") await loadOverview();
        if (state.page === "device") await loadDevice();
        if (state.page === "queue") await loadQueue();
        if (state.page === "schedules") await loadSchedules();
        if (state.page === "health") await loadHealth();
      } catch (error) {
        if (error.status === 401) {
          logout();
          showToast("Session expired. Login again.", true);
          return;
        }
        showToast(error.message, true);
      }
    }

    async function connectDevice() {
      const res = await api("/admin/api/device/connect", { method: "POST" });
      $("deviceStatus").textContent = fmt(res.data);
      $("qrData").textContent = res.data?.qr || "No QR returned";
      showToast(res.message || "Device connect requested");
    }

    async function removeDeviceAction() {
      if (!confirm("Remove connected WhatsApp device/session?")) return;
      const res = await api("/admin/api/device/remove", { method: "DELETE" });
      showToast(res.message || "Device removed");
      await loadDevice();
    }

    function scheduleAutoRefresh() {
      clearInterval(state.timer);
      state.timer = setInterval(() => {
        if (["overview", "device", "queue"].includes(state.page)) refreshCurrent();
      }, 10000);
    }

    function populateStatusFilter() {
      const select = $("scheduleStatus");
      for (const status of STATUSES) select.add(new Option(status, status, status === "scheduled", status === "scheduled"));
    }

    $("loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("apiKeyInput");
      const key = input.value.trim();
      try {
        await login(key);
        input.value = "";
      } catch (error) {
        showToast(error.message, true);
      }
    });
    $("logoutBtn").addEventListener("click", logout);
    $("refreshBtn").addEventListener("click", refreshCurrent);
    $("connectBtn").addEventListener("click", () => connectDevice().catch((error) => showToast(error.message, true)));
    $("removeDeviceBtn").addEventListener("click", () => removeDeviceAction().catch((error) => showToast(error.message, true)));
    $("loadSchedulesBtn").addEventListener("click", () => loadSchedules().catch((error) => showToast(error.message, true)));
    $("testerType").addEventListener("change", updateTesterFields);
    $("sendTesterForm").addEventListener("submit", sendTesterMessage);
    $("clearChatBtn").addEventListener("click", () => {
      $("chatMessages").replaceChildren();
      addBubble("system", "Percakapan ujicoba dibersihkan.");
      setTesterStatus("Ready");
    });
    document.querySelectorAll(".nav-btn").forEach((btn) => btn.addEventListener("click", () => switchPage(btn.dataset.page)));
    populateStatusFilter();
    updateTesterFields();
    showApp(false);
  </script>
</body>
</html>`;

function sendSuccess(reply, message, data = null, statusCode = 200) {
  return reply.code(statusCode).header("Cache-Control", "no-store").send({ status: "success", message, data });
}

function assertMessageId(id) {
  if (typeof id !== "string" || !MESSAGE_ID_PATTERN.test(id)) {
    throw new AppError(ErrorTypes.VALIDATION_ERROR, HttpStatusCodes.BAD_REQUEST, "Invalid message id", true);
  }
  return id;
}

function assertOneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new AppError(
      ErrorTypes.VALIDATION_ERROR,
      HttpStatusCodes.BAD_REQUEST,
      `${label} must be one of: ${allowed.join(", ")}`,
      true
    );
  }
}

function notFound() {
  return new AppError(ErrorTypes.DATABASE_ERROR, HttpStatusCodes.NOT_FOUND, "Scheduled message not found", true);
}

function pick(source, keys) {
  if (!source || typeof source !== "object") return {};
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

// Media bytes never leave the server through the admin API; only metadata is returned.
function mediaSummary(value = {}) {
  return {
    type: "media",
    mimetype: value.mimetype ?? null,
    filename: value.filename ?? null,
    filesize: value.filesize ?? null,
    dataIncluded: false,
  };
}

const LOCATION_KEYS = ["latitude", "longitude", "name", "address", "url"];

function describeContent(raw) {
  if (typeof raw === "string") return { type: "text", text: raw };
  if (!raw || typeof raw !== "object") return { type: "unknown" };
  if (raw.format === SCHEDULED_FORMAT) {
    if (raw.type === "text") return { type: "text", text: String(raw.value ?? "") };
    if (raw.type === "media") return mediaSummary(raw.value);
    if (raw.type === "location") return { type: "location", ...pick(raw.value, LOCATION_KEYS) };
    return { type: "unknown" };
  }
  if (raw.mimetype) return mediaSummary(raw);
  if (raw.location) return { type: "location", ...pick(raw.location, LOCATION_KEYS) };
  if (typeof raw.latitude === "number" && typeof raw.longitude === "number") return { type: "location", ...pick(raw, LOCATION_KEYS) };
  return { type: "unknown" };
}

// Drops binary payloads from options (e.g. embedded media) before they reach the browser.
function stripMediaData(value) {
  if (Array.isArray(value)) return value.map(stripMediaData);
  if (!value || typeof value !== "object") return value;
  const hasMime = Object.prototype.hasOwnProperty.call(value, "mimetype");
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !(hasMime && key === "data"))
      .map(([key, child]) => [key, stripMediaData(child)])
  );
}

function describeMessage(message) {
  if (!message) return null;
  const status = message.status;
  return {
    id: message.id ?? message._id,
    chatId: message.chatId,
    status,
    scheduledTime: message.scheduledTime,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    content: describeContent(message.content),
    options: stripMediaData(message.options ?? {}),
    allowedTransitions: [...(ADMIN_TRANSITIONS[status] ?? [])],
    deletable: DELETABLE_STATUSES.includes(status),
  };
}

function getDeviceSummary(whatsapp) {
  const info = whatsapp.isClientReady() ? whatsapp.getInfo() : null;
  return {
    state: whatsapp.getClientState(),
    isReady: whatsapp.isClientReady(),
    isConnected: whatsapp.getClientState() === "CONNECTED" || whatsapp.isClientReady(),
    device: info?.wid ? {
      number: info.wid.user,
      name: info.pushname || "Unknown",
      platform: info.platform || "Unknown",
    } : null,
  };
}

async function getHealthSummary(store, whatsapp) {
  const redisHealthy = await store.healthCheck();
  const whatsappConnected = whatsapp.isClientReady();
  return {
    status: redisHealthy && whatsappConnected ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: appConfig.environment,
    services: {
      redis: redisHealthy ? "healthy" : "unhealthy",
      whatsapp: whatsappConnected ? "connected" : "disconnected",
    },
  };
}

// queueMonitor is not fed by the send/workflow pipeline, so its metrics are reported as unavailable.
// Counts come from Redis; a status the store does not report is null ("unknown"), never 0.
async function getQueueSummary(store) {
  const raw = await store.getMessageStatusSummary();
  const counts = Object.fromEntries(
    SCHEDULE_STATUSES.map((status) => [status, Number.isInteger(raw?.[status]) ? raw[status] : null])
  );
  return {
    source: "redis",
    counts,
    needsReview: { unknown: counts.unknown, enqueue_unknown: counts.enqueue_unknown },
    monitor: {
      available: false,
      reason: "In-memory queueMonitor is not updated by the message pipeline; use Redis counts instead.",
    },
  };
}

async function overrideStatus(store, id, target) {
  assertMessageId(id);
  assertOneOf(target, OVERRIDE_TARGETS, "Status");

  const current = await store.getMessageById(id);
  if (!current) throw notFound();

  if (!(ADMIN_TRANSITIONS[current.status] ?? []).includes(target)) {
    throw new AppError(
      ErrorTypes.VALIDATION_ERROR,
      HttpStatusCodes.CONFLICT,
      `Cannot change status from ${current.status} to ${target}`,
      true
    );
  }

  // Compare-and-set: rejected if a worker changed the status after the read above.
  await store.updateMessageStatus(id, target, { expectedStatus: current.status });
  logger.info({ messageId: id, from: current.status, to: target }, "Admin changed scheduled message status");
  return { id, status: target };
}

async function removeScheduledMessage(store, id) {
  assertMessageId(id);
  const current = await store.getMessageById(id);
  if (!current) throw notFound();

  if (!DELETABLE_STATUSES.includes(current.status)) {
    throw new AppError(
      ErrorTypes.VALIDATION_ERROR,
      HttpStatusCodes.CONFLICT,
      `Cannot delete a message with status ${current.status}; only sent, failed or cancelled messages can be deleted`,
      true
    );
  }

  await store.deleteMessage(id);
  logger.info({ messageId: id, status: current.status }, "Admin deleted scheduled message");
  return { id };
}

const defaultServices = {
  store: {
    healthCheck: () => redisManager.healthCheck(),
    listMessagesByStatus,
    getMessageStatusSummary,
    getMessageById,
    updateMessageStatus,
    deleteMessage,
  },
  device: { getDeviceStatus, connectDevice, removeDevice },
  whatsapp: {
    getClientState,
    isClientReady,
    getInfo: () => client.info,
  },
};

/**
 * Admin dashboard and API. Every /admin/api route requires fastify.authenticate (bearer API key).
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{store?: object, device?: object, whatsapp?: object}} [options] - dependency overrides (tests)
 */
export async function adminRoute(fastify, options = {}) {
  const store = { ...defaultServices.store, ...options.store };
  const device = { ...defaultServices.device, ...options.device };
  const whatsapp = { ...defaultServices.whatsapp, ...options.whatsapp };
  const auth = { preHandler: [fastify.authenticate] };

  // Static page without data. Inline script/style rely on main's CSP 'unsafe-inline' directives.
  fastify.get("/admin", async (_request, reply) => {
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(ADMIN_HTML);
  });

  fastify.get("/admin/api/me", auth, async (_request, reply) =>
    sendSuccess(reply, "Authenticated", { authenticated: true })
  );

  fastify.get("/admin/api/summary", auth, async (_request, reply) => {
    const [health, queue] = await Promise.all([
      getHealthSummary(store, whatsapp),
      getQueueSummary(store),
    ]);
    return sendSuccess(reply, "Admin summary retrieved", {
      health,
      device: getDeviceSummary(whatsapp),
      queue,
    });
  });

  fastify.get("/admin/api/queue", auth, async (_request, reply) =>
    sendSuccess(reply, "Queue status retrieved", await getQueueSummary(store))
  );

  fastify.get("/admin/api/device/status", auth, device.getDeviceStatus);
  fastify.post("/admin/api/device/connect", auth, device.connectDevice);
  fastify.delete("/admin/api/device/remove", auth, device.removeDevice);

  fastify.get("/admin/api/schedules", auth, async (request, reply) => {
    const status = request.query?.status || "scheduled";
    assertOneOf(status, SCHEDULE_STATUSES, "Status");

    const result = await store.listMessagesByStatus({
      status,
      limit: request.query?.limit,
      offset: request.query?.offset,
    });

    return sendSuccess(reply, "Scheduled messages retrieved", {
      ...result,
      items: (result.items ?? []).map(describeMessage),
    });
  });

  fastify.get("/admin/api/schedules/:id", auth, async (request, reply) => {
    assertMessageId(request.params.id);
    const message = await store.getMessageById(request.params.id);
    if (!message) throw notFound();
    return sendSuccess(reply, "Scheduled message retrieved", describeMessage(message));
  });

  fastify.patch("/admin/api/schedules/:id/status", auth, async (request, reply) => {
    const result = await overrideStatus(store, request.params.id, request.body?.status);
    return sendSuccess(reply, "Scheduled message status updated", result);
  });

  fastify.delete("/admin/api/schedules/:id", auth, async (request, reply) => {
    const result = await removeScheduledMessage(store, request.params.id);
    return sendSuccess(reply, "Scheduled message deleted", result);
  });
}
