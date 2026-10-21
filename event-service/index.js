// Event Service - manages college events and their seats.
const express = require("express");
const os = require("os");
const { connect } = require("./db");

const PORT = Number(process.env.PORT || 4001);
const app = express();
app.use(express.json());

let events; // MongoDB collection

const EVENTS = [
  { eventId: "EV101", title: "Cloud Computing Workshop", venue: "Seminar Hall 1", date: "2026-11-05", seatsTotal: 30 },
  { eventId: "EV102", title: "Hackathon 2026", venue: "Main Auditorium", date: "2026-11-08", seatsTotal: 60 },
  { eventId: "EV103", title: "Web Development Bootcamp", venue: "Lab 204", date: "2026-11-12", seatsTotal: 40 },
  { eventId: "EV104", title: "AI and ML Seminar", venue: "Seminar Hall 2", date: "2026-11-15", seatsTotal: 50 },
  { eventId: "EV105", title: "Cyber Security Talk", venue: "Conference Room", date: "2026-11-19", seatsTotal: 25 },
  { eventId: "EV106", title: "Robotics Workshop", venue: "Robotics Lab", date: "2026-11-22", seatsTotal: 5 },
];

// Health check, used by Kubernetes probes and the System Status page.
// servedBy = the pod (container) name, so we can see which replica answered.
app.get("/health", (req, res) => {
  res.json({ status: "UP", service: "event-service", servedBy: os.hostname() });
});

app.get("/events", async (req, res) => {
  const list = await events.find({}, { projection: { _id: 0 } }).sort({ eventId: 1 }).toArray();
  res.json({ servedBy: os.hostname(), events: list });
});

// Called by the Registration Service. The filter "seatsLeft > 0" makes this
// atomic: when the last seat is left, only one request can take it.
app.post("/events/:eventId/reserve", async (req, res) => {
  const { eventId } = req.params;
  const result = await events.updateOne({ eventId, seatsLeft: { $gt: 0 } }, { $inc: { seatsLeft: -1 } });
  if (result.modifiedCount === 1) return res.json({ ok: true, eventId, servedBy: os.hostname() });
  const exists = await events.findOne({ eventId });
  res.status(exists ? 409 : 404).json({ ok: false, message: exists ? "No seats left for this event" : `Event ${eventId} not found` });
});

app.post("/events/:eventId/release", async (req, res) => {
  const { eventId } = req.params;
  const result = await events.updateOne({ eventId }, { $inc: { seatsLeft: 1 } });
  if (result.modifiedCount === 1) return res.json({ ok: true, eventId, servedBy: os.hostname() });
  res.status(404).json({ ok: false, message: `Event ${eventId} not found` });
});

async function start() {
  const db = await connect("eventhub");
  events = db.collection("events");
  await events.createIndex({ eventId: 1 }, { unique: true });

  // Add the events the first time the database is empty
  if ((await events.countDocuments({})) === 0) {
    // ordered:false + unique index = safe even if two replicas start at the same time
    await events.insertMany(EVENTS.map((e) => ({ ...e, seatsLeft: e.seatsTotal })), { ordered: false }).catch(() => {});
    console.log(`Added ${EVENTS.length} events`);
  }

  app.listen(PORT, () => console.log(`Event Service running on port ${PORT} (${os.hostname()})`));
}

start().catch((err) => { console.error(err); process.exit(1); });
