// API Gateway - the single entry point for the frontend.
// It forwards each request to the right microservice and checks their health.
const express = require("express");
const http = require("http");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PORT || 8080);
const SERVICES = {
  "event-service": process.env.EVENT_SERVICE_URL || "http://localhost:4001",
  "registration-service": process.env.REGISTRATION_SERVICE_URL || "http://localhost:4002",
  "notification-service": process.env.NOTIFICATION_SERVICE_URL || "http://localhost:4003",
};

const app = express();
app.use(express.json());

// Sends one HTTP request to a service.
// agent:false opens a new connection every time. Kubernetes spreads
// connections across replicas, so this lets every request reach any replica.
function request(base, urlPath, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(new URL(urlPath, base), {
      method, agent: false, timeout: 5000,
      headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {},
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: { message: data } }); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Forward /api/<prefix>/... to the matching service
function forward(serviceName, prefix) {
  return async (req, res) => {
    const rest = req.url === "/" ? "" : req.url;
    try {
      const hasBody = req.method !== "GET" && req.body && Object.keys(req.body).length > 0;
      const r = await request(SERVICES[serviceName], prefix + rest, req.method, hasBody ? req.body : req.method === "GET" ? null : {});
      res.status(r.status).json(r.data);
    } catch {
      res.status(503).json({ ok: false, message: `${serviceName} is not reachable` });
    }
  };
}

app.use("/api/events", forward("event-service", "/events"));
app.use("/api/registrations", forward("registration-service", "/registrations"));
app.use("/api/notifications", forward("notification-service", "/notifications"));

app.get("/health", (req, res) => res.json({ status: "UP", service: "api-gateway", servedBy: os.hostname() }));

// Checks every service and reports status, response time and which pod answered
app.get("/api/system/health", async (req, res) => {
  const started = Date.now();
  const checks = await Promise.all(Object.entries(SERVICES).map(async ([name, base]) => {
    const t0 = Date.now();
    try {
      const r = await request(base, "/health");
      return { service: name, status: r.data.status || "DOWN", latencyMs: Date.now() - t0, servedBy: r.data.servedBy };
    } catch {
      return { service: name, status: "DOWN", latencyMs: Date.now() - t0, servedBy: null };
    }
  }));
  checks.unshift({ service: "api-gateway", status: "UP", latencyMs: 0, servedBy: os.hostname() });
  const healthy = checks.every((c) => c.status === "UP");
  res.status(healthy ? 200 : 503).json({ overallStatus: healthy ? "HEALTHY" : "DEGRADED", timestamp: new Date().toISOString(), totalDurationMs: Date.now() - started, services: checks });
});

// Scalability test: call the Event Service several times and count which pod answered each call
app.get("/api/system/load-test", async (req, res) => {
  const count = Math.min(Number(req.query.count) || 10, 30);
  const answers = [];
  for (let i = 0; i < count; i++) {
    try { answers.push((await request(SERVICES["event-service"], "/health")).data.servedBy); }
    catch { answers.push("no answer"); }
  }
  const perPod = {};
  answers.forEach((pod) => (perPod[pod] = (perPod[pod] || 0) + 1));
  res.json({ requests: count, perPod, answers });
});

// Only for running without Docker: the gateway can also serve the frontend files
if (process.env.STATIC_DIR) app.use(express.static(path.resolve(process.env.STATIC_DIR)));

app.listen(PORT, () => console.log(`API Gateway running on port ${PORT} (${os.hostname()})`));
