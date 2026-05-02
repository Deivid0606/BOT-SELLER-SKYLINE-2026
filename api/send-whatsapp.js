// api/send-whatsapp.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = process.env.WAHA_BASE_URL;
const WAHA_API_KEY = process.env.WAHA_API_KEY;

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
async function getConfig({ userId, tenantId }) {
  let query = supabase
    .from("whatsapp_config")
    .select("phone_number_id, permanent_token, provider, waha_session");

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  } else {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("❌ Error buscando config:", error);
    return null;
  }

  return data;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function cleanPhone(phone) {
  return String(phone || "").replace(/[^0-9]/g, "");
}

function toChatId(phone) {
  return `${cleanPhone(phone)}@c.us`;
}

function wahaHeaders() {
  const h = { "Content-Type": "application/json" };
  if (WAHA_API_KEY) h["X-Api-Key"] = WAHA_API_KEY;
  return h;
}

// ─────────────────────────────────────────────
// META
// ─────────────────────────────────────────────
async function metaSendText(config, to, text) {
  const r = await fetch(
    `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.permanent_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    }
  );

  if (!r.ok) {
    const err = await r.text();
    throw new Error(err);
  }
}

async function metaSendMedia(config, to, url, type, caption = "") {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type,
    [type]: caption ? { link: url, caption } : { link: url },
  };

  const r = await fetch(
    `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.permanent_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!r.ok) {
    const err = await r.text();
    throw new Error(err);
  }
}

// ─────────────────────────────────────────────
// WAHA
// ─────────────────────────────────────────────
async function wahaSendText(session, to, text) {
  await fetch(`${WAHA_BASE_URL}/api/sendText`, {
    method: "POST",
    headers: wahaHeaders(),
    body: JSON.stringify({
      session,
      chatId: toChatId(to),
      text,
    }),
  });
}

async function wahaSendImage(session, to, url, caption = "") {
  await fetch(`${WAHA_BASE_URL}/api/sendImage`, {
    method: "POST",
    headers: wahaHeaders(),
    body: JSON.stringify({
      session,
      chatId: toChatId(to),
      file: { url },
      caption,
    }),
  });
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;

    const to = body.to;
    const userId = body.user_id;
    const tenantId = body.tenant_id || null;
    const message = body.message || "";
    const mediaUrl = body.media_url;
    const mediaType = body.media_type;

    if (!to || !userId) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    const config = await getConfig({ userId, tenantId });

    if (!config) {
      return res.status(400).json({
        error: "WhatsApp no configurado para este usuario",
      });
    }

    // 🔥 CORRECCIÓN CLAVE
    const provider = body.connection_type || config.provider || "meta";

    console.log("🧠 Provider:", {
      frontend: body.connection_type,
      db: config.provider,
      final: provider,
    });

    const cleanTo = cleanPhone(to);

    if (provider === "waha") {
      if (!config.waha_session) {
        return res.status(400).json({
          error: "WAHA no configurado",
        });
      }

      if (mediaUrl) {
        await wahaSendImage(config.waha_session, cleanTo, mediaUrl, message);
      } else {
        await wahaSendText(config.waha_session, cleanTo, message);
      }
    } else {
      if (!config.phone_number_id || !config.permanent_token) {
        return res.status(400).json({
          error: "Meta no configurado",
        });
      }

      if (mediaUrl) {
        await metaSendMedia(config, cleanTo, mediaUrl, mediaType || "image", message);
      } else {
        await metaSendText(config, cleanTo, message);
      }
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
