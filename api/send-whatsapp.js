// api/send-whatsapp.js
// Envío MANUAL de mensajes (texto o media) desde el Inbox
// Usa Meta Cloud API con la columna permanent_token

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function splitMessage(text, max = 3500) {
  if (!text) return [];
  const parts = [];
  let s = String(text);
  while (s.length > max) {
    let cut = s.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = s.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    parts.push(s.slice(0, cut));
    s = s.slice(cut).trimStart();
  }
  if (s.length) parts.push(s);
  return parts;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};

    const user_id = body.user_id || body.userId;
    const phone = body.phone || body.to || body.number || body.wa_id;
    const message = body.message || body.text || "";
    const media_url = body.media_url || body.mediaUrl || null;
    const media_type = body.media_type || body.mediaType || null;
    const caption = body.caption || body.message || "";

    if (!user_id) return res.status(400).json({ error: "user_id required" });
    if (!phone) return res.status(400).json({ error: "phone required" });
    if (!message && !media_url) return res.status(400).json({ error: "message or media_url required" });

    const { data: cfg, error: cfgErr } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", user_id)
      .maybeSingle();

    if (cfgErr) return res.status(500).json({ error: "Config error: " + cfgErr.message });
    if (!cfg) return res.status(400).json({ error: "WhatsApp config not found for user" });
    if (!cfg.phone_number_id || !cfg.permanent_token) {
      return res.status(400).json({ error: "Missing phone_number_id or permanent_token in whatsapp_config" });
    }

    const url = `https://graph.facebook.com/v20.0/${cfg.phone_number_id}/messages`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.permanent_token}`,
    };

    const results = [];

    // 1) Media (con caption)
    if (media_url) {
      const type = (media_type || "image").toLowerCase();
      const metaType = type === "gif" ? "image" : type;
      const mediaPayload = {
        messaging_product: "whatsapp",
        to: String(phone),
        type: metaType,
        [metaType]: {
          link: media_url,
          ...(metaType === "image" || metaType === "video" || metaType === "document"
            ? { caption: (caption || "").slice(0, 1024) }
            : {}),
        },
      };
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(mediaPayload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(r.status).json({ error: d?.error?.message || "Media send failed", data: d });
      results.push({ type: "media", data: d });

      await supabase.from("inbox_messages").insert({
        user_id,
        sender_id: String(phone),
        message: caption || `[${metaType}]`,
        source: "outbound",
        media_url: [media_url],
        is_read: true,
      }).then(() => {}, () => {});
    }

    // 2) Texto solo si no hubo media
    if (message && !media_url) {
      const chunks = splitMessage(message);
      for (const chunk of chunks) {
        const textPayload = {
          messaging_product: "whatsapp",
          to: String(phone),
          type: "text",
          text: { body: chunk, preview_url: false },
        };
        const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(textPayload) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(r.status).json({ error: d?.error?.message || "Text send failed", data: d });
        results.push({ type: "text", data: d });
      }

      await supabase.from("inbox_messages").insert({
        user_id,
        sender_id: String(phone),
        message,
        source: "outbound",
        is_read: true,
      }).then(() => {}, () => {});
    }

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
