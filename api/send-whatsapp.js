// api/send-whatsapp.js
// Envío manual de mensajes y plantillas desde el Inbox.
// Usa Meta Cloud API (igual que webhook.js). Acepta phone | to | number.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function splitMessage(text, max = 3500) {
  if (!text) return [];
  const out = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

async function getConfig(userId) {
  const { data, error } = await supabase
    .from("whatsapp_config")
    .select("phone_number_id, access_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("whatsapp_config: " + error.message);
  if (!data) throw new Error("whatsapp_config no encontrado para user");
  return data;
}

async function sendText(cfg, to, text) {
  const parts = splitMessage(text);
  let last = null;
  for (const part of parts) {
    const r = await fetch(
      `https://graph.facebook.com/v20.0/${cfg.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.access_token}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: part },
        }),
      }
    );
    last = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(JSON.stringify(last));
  }
  return last;
}

async function sendMedia(cfg, to, mediaUrl, mediaType, caption = "") {
  let type = (mediaType || "").toLowerCase();
  if (!type) {
    const u = mediaUrl.toLowerCase();
    if (u.match(/\.(jpg|jpeg|png|webp)(\?|$)/)) type = "image";
    else if (u.match(/\.(mp4|mov|webm)(\?|$)/)) type = "video";
    else if (u.match(/\.gif(\?|$)/)) type = "image";
    else type = "document";
  }
  if (type === "gif") type = "video";

  const body = {
    messaging_product: "whatsapp",
    to,
    type,
    [type]: {
      link: mediaUrl,
      ...(caption && type !== "audio" ? { caption: caption.slice(0, 1024) } : {}),
    },
  };

  const r = await fetch(
    `https://graph.facebook.com/v20.0/${cfg.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.access_token}`,
      },
      body: JSON.stringify(body),
    }
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function saveOutbound({ userId, to, message, mediaUrl }) {
  try {
    await supabase.from("inbox_messages").insert({
      user_id: userId,
      sender_id: to,
      source: "outbound",
      message: message || "",
      media_url: mediaUrl ? [mediaUrl] : null,
      is_read: true,
    });
  } catch (e) {
    console.error("saveOutbound error:", e.message);
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    // Aceptar varios nombres de campo desde el frontend
    const to = body.phone || body.to || body.number || body.wa_id;
    const userId = body.user_id || body.userId;
    const message = body.message ?? body.text ?? body.caption ?? "";
    const mediaUrl = body.media_url || body.mediaUrl || null;
    const mediaType = body.media_type || body.mediaType || null;
    const caption = body.caption ?? message;
    const template = body.template || null; // { media_url, media_type, message } opcional

    if (!to) return res.status(400).json({ error: "phone/to/number required" });
    if (!userId) return res.status(400).json({ error: "user_id required" });

    const cfg = await getConfig(userId);
    let result = null;

    // 1) Plantilla (objeto template con media + texto)
    if (template && (template.media_url || template.message)) {
      if (template.media_url) {
        result = await sendMedia(
          cfg,
          to,
          template.media_url,
          template.media_type,
          template.message || ""
        );
      } else if (template.message) {
        result = await sendText(cfg, to, template.message);
      }
      await saveOutbound({
        userId,
        to,
        message: template.message || "",
        mediaUrl: template.media_url,
      });
      return res.status(200).json({ ok: true, data: result });
    }

    // 2) Media suelto
    if (mediaUrl) {
      result = await sendMedia(cfg, to, mediaUrl, mediaType, caption || "");
      await saveOutbound({ userId, to, message: caption || "", mediaUrl });
      return res.status(200).json({ ok: true, data: result });
    }

    // 3) Texto
    if (!message) return res.status(400).json({ error: "message or media_url required" });
    result = await sendText(cfg, to, message);
    await saveOutbound({ userId, to, message, mediaUrl: null });
    return res.status(200).json({ ok: true, data: result });
  } catch (e) {
    console.error("send-whatsapp error:", e);
    return res.status(500).json({ error: e.message });
  }
}
