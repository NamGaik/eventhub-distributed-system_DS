// Registration Service - registers students for events and cancels registrations.
// It talks to the Event Service (to take / give back a seat) and to the
// Notification Service (to record a message). This is the inter-service communication.
const express = require("express");
const os = require("os");
const { connect } = require("./db");

const PORT = Number(process.env.PORT || 4002);
const EVENT_SERVICE_URL = process.env.EVENT_SERVICE_URL || "http://localhost:4001";
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || "http://localhost:4003";

const app = express();
app.use(express.json());

let registrations;

async function callService(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, data: await res.json() };
}

// A failed notification should not cancel a registration, so errors are only logged
async function notify(message, type) {
  try { await callService(`${NOTIFICATION_SERVICE_URL}/notifications`, { message, type }); }
  catch (err) { console.log("Notification Service not reachable:", err.message); }
}

app.get("/health", (req, res) => {
  res.json({ status: "UP", service: "registration-service", servedBy: os.hostname() });
});

app.get("/registrations", async (req, res) => {
  const list = await registrations.find({}, { projection: { _id: 0 } }).sort({ registeredAt: -1 }).toArray();
  res.json(list);
});

app.post("/registrations", async (req, res) => {
  const { studentName, eventId, eventTitle } = req.body;
  if (!studentName || !eventId) return res.status(400).json({ ok: false, message: "Student name and event are required" });

  // A student can register only once for the same event
  const existing = await registrations.findOne({ studentName, eventId, status: "registered" });
  if (existing) return res.status(409).json({ ok: false, message: `${studentName} is already registered for this event` });

  // Step 1: ask the Event Service to reserve a seat
  let seat;
  try { seat = await callService(`${EVENT_SERVICE_URL}/events/${eventId}/reserve`); }
  catch { return res.status(503).json({ ok: false, message: "Event Service is not reachable" }); }
  if (seat.status !== 200) return res.status(seat.status).json(seat.data);

  // Step 2: save the registration
  const registration = {
    registrationId: `REG${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
    studentName, eventId, eventTitle: eventTitle || eventId,
    status: "registered", registeredAt: new Date().toISOString(), cancelledAt: null,
  };
  await registrations.insertOne({ ...registration });

  // Step 3: ask the Notification Service to record a message
  await notify(`${studentName} registered for ${registration.eventTitle}`, "registered");

  res.status(201).json({ ok: true, ...registration, seatServedBy: seat.data.servedBy, registrationServedBy: os.hostname() });
});

app.post("/registrations/:registrationId/cancel", async (req, res) => {
  const reg = await registrations.findOne({ registrationId: req.params.registrationId, status: "registered" });
  if (!reg) return res.status(404).json({ ok: false, message: "Active registration not found" });

  try {
    const seat = await callService(`${EVENT_SERVICE_URL}/events/${reg.eventId}/release`);
    if (seat.status !== 200) return res.status(seat.status).json(seat.data);
  } catch {
    return res.status(503).json({ ok: false, message: "Event Service is not reachable" });
  }

  const cancelledAt = new Date().toISOString();
  await registrations.updateOne({ registrationId: reg.registrationId }, { $set: { status: "cancelled", cancelledAt } });
  await notify(`${reg.studentName} cancelled registration for ${reg.eventTitle}`, "cancelled");
  res.json({ ok: true, registrationId: reg.registrationId, eventTitle: reg.eventTitle, cancelledAt });
});

async function start() {
  const db = await connect("eventhub");
  registrations = db.collection("registrations");
  app.listen(PORT, () => console.log(`Registration Service running on port ${PORT} (${os.hostname()})`));
}

start().catch((err) => { console.error(err); process.exit(1); });
