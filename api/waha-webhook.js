// api/waha-webhook.js
// ✅ CONFIGURACIÓN CORRECTA PARA WAHA EN RAILWAY

import { createClient } from "@supabase/supabase-js";
import { procesar } from "./webhook.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = "https://waha-production-d6eb.up.railway.app";
const WAHA_API_KEY = "884b70d0e02a36e041df0d7c3fd424e2";

function wahaToMeta(wahaMsg) {
  const fromRaw = wahaMsg.from || "";
  const from = fromRaw.replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "");

  const base = {
    id: wahaMsg.id,
    from,
    timestamp: String(wahaMsg.timestamp || Math.floor(Date.now() / 1000)),
  };

  const hasMedia = !!wahaMsg.hasMedia || !!wahaMsg.media;
  const mediaUrl = wahaMsg.media?.url || null;
  const mimeType = wahaMsg.media?.mimetype || wahaMsg.mediaMimeType || null;
  const caption = wahaMsg.caption || wahaMsg.body || "";

  if (!hasMedia) {
    return { ...base, type: "text", text: { body: wahaMsg.body || "" } };
  }

  if (mimeType?.startsWith("image/")) {
    return {
      ...base,
      type: "image",
      image: { id: wahaMsg.id, mime_type: mimeType, caption, _waha_url: mediaUrl },
    };
  }
  if (mimeType?.startsWith("audio/")) {
    return {
      ...base,
      type: "audio",
      audio: { id: wahaMsg.id, mime_type: mimeType, _waha_url: mediaUrl },
    };
  }
  if (mimeType?.startsWith("video/")) {
    return {
      ...base,
      type: "video",
      video: { id: wahaMsg.id, mime_type: mimeType, caption, _waha_url: mediaUrl },
    };
  }
  return {
    ...base,
    type: "document",
    document: {
      id: wahaMsg.id,
      mime_type: mimeType || "application/octet-stream",
      filename: wahaMsg.media?.filename || "archivo",
      caption,
      _waha_url: mediaUrl,
    },
  };
}

async function getUserIdByPhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;
  
  const { data } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("connected_phone", phoneNumber)
    .maybeSingle();
  
  return data?.user_id || null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
  
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const apiKey = req.headers["x-api-key"];
  if (apiKey !== WAHA_API_KEY) {
    console.log("❌ API key inválida");
    return res.status(401).send("Unauthorized");
  }

  try {
    const body = req.body;
    const event = body?.event;
    const payload = body?.payload || body;
    const sessionName = body?.session || "default";

    console.log(`📡 WAHA event: ${event} | session: ${sessionName}`);

    if (event === "session.status") {
      const wahaStatus = payload.status;
      let dbStatus = "disconnected";
      if (wahaStatus === "STARTING") dbStatus = "starting";
      else if (wahaStatus === "SCAN_QR_CODE") dbStatus = "pending_qr";
      else if (wahaStatus === "WORKING") dbStatus = "connected";
      else if (wahaStatus === "FAILED") dbStatus = "failed";
      else if (wahaStatus === "STOPPED") dbStatus = "disconnected";

      const connectedPhone = payload.me?.id?.replace(/@c\.us$/, "") || null;

      await supabase
        .from("whatsapp_qr_sessions")
        .update({
          status: dbStatus,
          connected_phone: connectedPhone,
          last_event_at: new Date().toISOString(),
          ...(dbStatus === "connected" ? { connected_at: new Date().toISOString() } : {}),
        })
        .eq("session_name", sessionName);

      console.log(`✅ Estado actualizado: ${dbStatus}`);
      return res.status(200).send("OK");
    }

    if (event === "message" || event === "message.any") {
      if (payload.fromMe) {
        return res.status(200).send("OK (fromMe)");
      }

      const toPhone = payload.to?.replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "");
      const userId = await getUserIdByPhoneNumber(toPhone);

      if (!userId) {
        console.log(`⚠️ No se encontró usuario para: ${toPhone}`);
        return res.status(200).send("OK (no user)");
      }

      console.log(`✅ Mensaje para usuario: ${userId}`);

      const metaMsg = wahaToMeta(payload);
      const fakeReq = {
        headers: {
          host: req.headers.host,
          "x-forwarded-proto": req.headers["x-forwarded-proto"] || "https",
        },
      };

      await procesar(fakeReq, metaMsg, userId, metaMsg.from);
      return res.status(200).send("OK");
    }

    return res.status(200).send("OK (ignored)");
  } catch (err) {
    console.error("❌ waha-webhook error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}
