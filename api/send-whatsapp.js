// api/send-whatsapp.js
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { phone, message, media_url, media_type, caption } = req.body || {};
    if (!phone) return res.status(400).json({ error: "phone required" });

    const BAILEYS_URL = process.env.BAILEYS_URL; // ej: https://tu-baileys.fly.dev
    const BAILEYS_TOKEN = process.env.BAILEYS_TOKEN;

    if (!BAILEYS_URL) return res.status(500).json({ error: "BAILEYS_URL not configured" });

    // Detectar tipo si no viene
    let type = media_type;
    if (media_url && !type) {
      const u = media_url.toLowerCase();
      if (u.match(/\.(jpg|jpeg|png|webp)(\?|$)/)) type = "image";
      else if (u.match(/\.(mp4|mov|webm)(\?|$)/)) type = "video";
      else if (u.match(/\.gif(\?|$)/)) type = "gif"; // se envía como video con gifPlayback
      else if (u.match(/\.(mp3|ogg|wav|m4a)(\?|$)/)) type = "audio";
      else type = "document";
    }

    const payload = media_url
      ? {
          phone,
          type, // image | video | gif | audio | document
          url: media_url,
          caption: caption ?? message ?? "",
        }
      : { phone, type: "text", message };

    const r = await fetch(`${BAILEYS_URL}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(BAILEYS_TOKEN ? { Authorization: `Bearer ${BAILEYS_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data?.error || "Send failed", data });

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
