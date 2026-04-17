import express from "express";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 8080);
const API_TOKEN = process.env.API_TOKEN || "";
const BITRIX_WEBHOOK_BASE = (process.env.BITRIX_WEBHOOK_BASE || "").replace(/\/$/, "");

// ==== твої поля Bitrix ====
const FIELD_TARIFF = "UF_CRM_1610558031277";
const FIELD_ADDRESS = "UF_CRM_1615773157";
const FIELD_LAST_ACTIVITY = "UF_CRM_1612145652";
const FIELD_IP = "UF_CRM_1599819039270";
const FIELD_PAYMENT_ID = "UF_CRM_1599818926979";
const FIELD_BALANCE = "UF_CRM_1607899720";
const FIELD_MONTHLY_FEE = "UF_CRM_1619306007";

let tariffMapCache = null;

function checkAuth(req, res, next) {
  const token = req.headers["x-api-token"];
  if (!API_TOKEN || token === API_TOKEN) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

function digitsOnly(s) {
  return String(s || "").replace(/\D+/g, "");
}

function normalizePhone(raw) {
  const digits = digitsOnly(raw);
  if (!digits) return { digits: "", variants: [] };

  const variants = [];

  const e164 = digits.startsWith("380")
    ? digits
    : digits.startsWith("0")
      ? `38${digits}`
      : digits;

  const e164Plus = `+${e164}`;

  let nat = digits.length >= 10 ? digits.slice(-10) : digits;
  if (nat.length === 9 && !nat.startsWith("0")) {
    nat = `0${nat}`;
  }

  const tail9 = nat.length >= 9 ? nat.slice(-9) : nat;

  for (const v of [e164, digits, e164Plus, nat, tail9]) {
    if (v && !variants.includes(v)) variants.push(v);
  }

  return { digits, variants };
}

async function b24(method, params = {}) {
  if (!BITRIX_WEBHOOK_BASE) {
    throw new Error("BITRIX_WEBHOOK_BASE is missing");
  }

  const url = `${BITRIX_WEBHOOK_BASE}/${method}.json`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params)
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`B24 error: ${data.error}: ${data.error_description || ""}`);
  }

  return data.result;
}

async function getTariffMap() {
  if (tariffMapCache) return tariffMapCache;

  const fields = await b24("crm.contact.userfield.list", {
    order: { SORT: "ASC" }
  });

  const field = Array.isArray(fields)
    ? fields.find((f) => f.FIELD_NAME === FIELD_TARIFF)
    : null;

  const map = {};

  if (field && Array.isArray(field.LIST)) {
    for (const item of field.LIST) {
      map[String(item.ID)] = item.VALUE;
    }
  }

  tariffMapCache = map;
  return map;
}

function buildFullName(contact) {
  return [contact.NAME, contact.SECOND_NAME, contact.LAST_NAME]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function extractPhone(contact, fallback = "") {
  if (Array.isArray(contact.PHONE) && contact.PHONE.length > 0) {
    return contact.PHONE[0]?.VALUE || fallback;
  }
  return fallback;
}

async function b24FindContactByPhone(rawPhone) {
  const { digits, variants } = normalizePhone(rawPhone);
  if (!digits) return null;

  const tariffMap = await getTariffMap();

  for (const v of variants) {
    try {
      const result = await b24("crm.contact.list", {
        filter: {
          PHONE: v
        },
        select: [
          "ID",
          "NAME",
          "SECOND_NAME",
          "LAST_NAME",
          "PHONE",
          FIELD_TARIFF,
          FIELD_ADDRESS,
          FIELD_LAST_ACTIVITY,
          FIELD_IP,
          FIELD_PAYMENT_ID,
          FIELD_BALANCE,
          FIELD_MONTHLY_FEE
        ]
      });

      if (Array.isArray(result) && result.length > 0) {
        const c = result[0];

        const tariffId = c[FIELD_TARIFF] != null ? String(c[FIELD_TARIFF]) : "";
        const tariffName = tariffMap[tariffId] || tariffId || "";

        return {
          id: c.ID || "",
          full_name: buildFullName(c) || "—",
          phone: extractPhone(c, rawPhone),
          address: c[FIELD_ADDRESS] || "",
          last_activity_date: c[FIELD_LAST_ACTIVITY] || "",
          ip: c[FIELD_IP] || "",
          payment_id: c[FIELD_PAYMENT_ID] || "",
          balance: c[FIELD_BALANCE] || "",
          monthly_fee: c[FIELD_MONTHLY_FEE] || "",
          tariff: tariffName
        };
      }
    } catch (error) {
      console.error("[b24FindContactByPhone] variant error:", v, error.message);
    }
  }

  return null;
}

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/customer/by-phone", checkAuth, async (req, res) => {
  try {
    const phone = String(req.query.phone || "").trim();

    if (!phone) {
      return res.status(400).json({ ok: false, error: "missing_phone" });
    }

    const customer = await b24FindContactByPhone(phone);

    return res.status(200).json({
      ok: true,
      found: Boolean(customer),
      customer: customer || null
    });
  } catch (error) {
    console.error("customer/by-phone error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`integration-app listening on 0.0.0.0:${PORT}`);
});
