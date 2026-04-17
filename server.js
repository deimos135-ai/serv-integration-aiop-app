import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const API_TOKEN = process.env.API_TOKEN || "";

function checkAuth(req, res, next) {
  const token = req.headers["x-api-token"];
  if (!API_TOKEN || token === API_TOKEN) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/customer/by-phone", checkAuth, async (req, res) => {
  const phone = String(req.query.phone || "").trim();

  if (!phone) {
    return res.status(400).json({ ok: false, error: "missing_phone" });
  }

  return res.json({
    ok: true,
    found: true,
    customer: {
      phone,
      full_name: "Іваненко Іван Іванович",
      city: "Житомир",
      tariff: "Fiber 300",
      ip: "10.10.10.10"
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`integration-app listening on 0.0.0.0:${PORT}`);
});
