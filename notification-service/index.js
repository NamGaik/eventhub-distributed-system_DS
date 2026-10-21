// Notification Service - stores messages about registrations and cancellations.
const express = require("express");
const os = require("os");
const { connect } = require("./db");

const PORT = Number(process.env.PORT || 4003);
const app = express();
app.use(express.json());

let notifications;

app.get("/health", (req, res) => {
  res.json({ status: "UP", service: "notification-service", servedBy: os.hostname() });
});

app.post("/notifications", async (req, res) => {
  const { message, type = "info" } = req.body;
  if (!message) return res.status(400).json({ ok: false, message: "message is required" });
  const note = { message, type, createdAt: new Date().toISOString() };
  await notifications.insertOne({ ...note });
  res.status(201).json({ ok: true, ...note });
});

app.get("/notifications", async (req, res) => {
  const list = await notifications.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(30).toArray();
  res.json(list);
});

async function start() {
  const db = await connect("eventhub");
  notifications = db.collection("notifications");
  app.listen(PORT, () => console.log(`Notification Service running on port ${PORT} (${os.hostname()})`));
}

start().catch((err) => { console.error(err); process.exit(1); });
