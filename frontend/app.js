// Frontend logic. Every request goes to /api/..., which reaches the API Gateway.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const time = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "");
const day = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

async function api(path, method = "GET", body) {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({ ok: false, message: "No reply from server" }));
  return { ok: res.ok, data };
}

function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast show${bad ? " bad" : ""}`;
  setTimeout(() => (t.className = "toast"), 3000);
}

// ---------- Pages ----------
const loaders = { events: loadEvents, registrations: loadRegistrations, notifications: loadNotes, status: loadStatus };
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("on", p.id === `page-${b.dataset.page}`));
  loaders[b.dataset.page]();
}));

// ---------- Events ----------
$("studentName").value = localStorage.getItem("studentName") || "";
$("studentName").addEventListener("change", () => localStorage.setItem("studentName", $("studentName").value.trim()));

async function loadEvents() {
  const { ok, data } = await api("/api/events");
  if (!ok) { $("eventList").innerHTML = `<p class="empty">${esc(data.message)}</p>`; return; }
  $("eventsServedBy").textContent = `Served by pod: ${data.servedBy}`;
  $("eventList").innerHTML = data.events.map((e) => {
    const taken = e.seatsTotal - e.seatsLeft, full = e.seatsLeft === 0;
    return `<div class="event ${full ? "full" : ""}">
      <h3>${esc(e.title)}</h3>
      <span class="meta">${day(e.date)}, ${esc(e.venue)}</span>
      <span class="seats">${full ? "No seats left" : `${e.seatsLeft} of ${e.seatsTotal} seats left`}</span>
      <div class="track"><div class="fill" style="width:${(taken / e.seatsTotal) * 100}%"></div></div>
      <button class="primary" data-id="${e.eventId}" data-title="${esc(e.title)}" ${full ? "disabled" : ""}>Register</button>
    </div>`;
  }).join("");
  document.querySelectorAll(".event button:not([disabled])").forEach((b) => b.addEventListener("click", () => register(b.dataset.id, b.dataset.title)));
}

async function register(eventId, eventTitle) {
  const studentName = $("studentName").value.trim();
  if (!studentName) return toast("Enter your name first", true);
  const { ok, data } = await api("/api/registrations", "POST", { studentName, eventId, eventTitle });
  toast(ok ? `Registered for ${eventTitle}. ID ${data.registrationId}` : data.message, !ok);
  loadEvents();
}
$("refreshEvents").addEventListener("click", loadEvents);

// ---------- Registrations ----------
async function loadRegistrations() {
  const { ok, data } = await api("/api/registrations");
  if (!ok) { $("regRows").innerHTML = `<tr><td colspan="6">${esc(data.message)}</td></tr>`; return; }
  $("regRows").innerHTML = data.length ? data.map((r) => `
    <tr><td>${r.registrationId}</td><td>${esc(r.studentName)}</td><td>${esc(r.eventTitle)}</td><td>${time(r.registeredAt)}</td>
      <td>${r.status === "registered" ? '<span class="up">Registered</span>' : "Cancelled"}</td>
      <td>${r.status === "registered" ? `<button data-id="${r.registrationId}">Cancel</button>` : ""}</td></tr>`).join("")
    : '<tr><td colspan="6" class="empty">No registrations yet. Register from the Events page.</td></tr>';
  document.querySelectorAll("#regRows button").forEach((b) => b.addEventListener("click", async () => {
    const r = await api(`/api/registrations/${b.dataset.id}/cancel`, "POST");
    toast(r.ok ? `Registration for ${r.data.eventTitle} cancelled` : r.data.message, !r.ok);
    loadRegistrations();
  }));
}

// ---------- Notifications ----------
async function loadNotes() {
  const { ok, data } = await api("/api/notifications");
  if (!ok) { $("notes").innerHTML = `<li>${esc(data.message)}</li>`; return; }
  $("notes").innerHTML = data.length ? data.map((n) => `<li class="${n.type}">${esc(n.message)}<small>${time(n.createdAt)}</small></li>`).join("")
    : '<li class="empty">No notifications yet.</li>';
}

// ---------- System status ----------
async function loadStatus() {
  const { data } = await api("/api/system/health");
  if (!data.services) { $("statusRows").innerHTML = `<tr><td colspan="4">${esc(data.message)}</td></tr>`; return; }
  $("overall").textContent = `Overall: ${data.overallStatus}`;
  $("statusRows").innerHTML = data.services.map((s) => `
    <tr><td>${s.service}</td><td class="${s.status === "UP" ? "up" : "down"}">${s.status}</td>
      <td>${s.latencyMs} ms</td><td>${esc(s.servedBy || "-")}</td></tr>`).join("");
}
$("refreshStatus").addEventListener("click", loadStatus);

$("loadTest").addEventListener("click", async () => {
  $("loadResult").innerHTML = '<p class="empty">Sending requests…</p>';
  const { data } = await api("/api/system/load-test?count=12");
  const pods = Object.entries(data.perPod);
  $("loadResult").innerHTML = `<p>${data.requests} requests were answered by <b>${pods.length}</b> pod(s):</p>` +
    pods.map(([pod, n]) => `<div class="pod-row"><span>${esc(pod)}</span><div class="bar" style="width:${(n / data.requests) * 100}%"></div><span>${n}</span></div>`).join("");
});

loadEvents();
