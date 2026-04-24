import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const clean = (t) => String(t || "").trim();

function splitMessage(text, max = 3500) {
  const msg = clean(text);
  if (msg.length <= max) return [msg];
  const parts = [];
  let remaining = msg;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = remaining.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = remaining.lastIndexOf(". ", max);
    if (cut < max * 0.5) cut = remaining.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    parts.push(remaining.substring(0, cut).trim());
    remaining = remaining.substring(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts.filter((p) => p.length > 0);
}

function detectMediaKind(mediaType, mediaUrl) {
  const t = String(mediaType || "").toLowerCase();
  if (t.includes("image")) return "image";
  if (t.includes("video")) return "video";
  if (t.includes("audio")) return "audio";
  const ext = String(mediaUrl || "").split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["mp3", "ogg", "wav", "m4a"].includes(ext)) return "audio";
  return "document";
}

async function saveOut({ userId, to, message, mediaUrl }) {
  await supabase.from("inbox_messages").insert({
    user_id: userId,
    source: "out",
    sender_id: to,
    message: message || null,
    media_url: mediaUrl ? [mediaUrl] : null,
    is_read: true,
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { user_id, to, message, media_url, media_type } = req.body || {};
    if (!user_id || !to)
      return res.status(400).json({ error: "Faltan user_id o to" });

    const text = clean(message);
    if (!text && !media_url)
      return res.status(400).json({ error: "Mensaje vacío" });

    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", user_id)
      .maybeSingle();

    if (configError || !config?.phone_number_id || !config?.permanent_token) {
      console.error("❌ Sin config:", configError);
      return res.status(400).json({ error: "WhatsApp no configurado" });
    }

    const baseUrl = `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`;
    const headers = {
      Authorization: `Bearer ${config.permanent_token.trim()}`,
      "Content-Type": "application/json",
    };

    // 1) Media
    if (media_url) {
      const kind = detectMediaKind(media_type, media_url);
      const mediaPayload = {
        messaging_product: "whatsapp",
        to,
        type: kind,
        [kind]: {
          link: media_url,
          ...(text && kind !== "audio" ? { caption: text } : {}),
        },
      };

      const r = await fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(mediaPayload),
      });
      const raw = await r.text();
      console.log("📤 Media status:", r.status);
      if (!r.ok)
        return res.status(500).json({ error: `Error media: ${raw}` });

      await saveOut({ userId: user_id, to, message: text, mediaUrl: media_url });

      if (kind !== "audio" || !text)
        return res.status(200).json({ ok: true });
    }

    // 2) Texto
    if (text) {
      const partes = splitMessage(text, 3500);
      for (const parte of partes) {
        const r = await fetch(baseUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: parte, preview_url: false },
          }),
        });
        if (!r.ok) {
          const raw = await r.text();
          console.error("❌ Texto:", raw);
          return res.status(500).json({ error: `Error texto: ${raw}` });
        }
      }

      if (!media_url) {
        await saveOut({ userId: user_id, to, message: text, mediaUrl: null });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ send-whatsapp:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
}
