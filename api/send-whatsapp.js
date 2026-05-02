// api/send-whatsapp.js
// Envío saliente de WhatsApp con ruteo automático Meta ↔ WAHA
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
    .select("phone_number_id, permanent_token, provider, waha_session, user_id, tenant_id");

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  } else {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("❌ Error buscando whatsapp_config:", error);
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
  const clean = cleanPhone(phone);
  return `${clean}@c.us`;
}

function wahaHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (WAHA_API_KEY) headers["X-Api-Key"] = WAHA_API_KEY;
  return headers;
}

function normalizeMedia(body) {
  const imageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls
    : Array.isArray(body.images)
      ? body.images
      : [];

  let videoUrl = body.videoUrl || null;
  let gifUrl = body.gifUrl || null;

  const mediaUrl = body.media_url || body.mediaUrl || null;
  const mediaType = body.media_type || body.mediaType || null;

  if (mediaUrl && mediaType) {
    if (mediaType === "image") imageUrls.push(mediaUrl);
    else if (mediaType === "video") videoUrl = mediaUrl;
    else if (mediaType === "gif") gifUrl = mediaUrl;
    else imageUrls.push(mediaUrl);
  }

  return { imageUrls, videoUrl, gifUrl };
}

// ─────────────────────────────────────────────
// META
// ─────────────────────────────────────────────
async function metaSendText(config, to, text) {
  const response = await fetch(
    `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(config.permanent_token || "").trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: text,
          preview_url: false,
        },
      }),
    }
  );

  const resultText = await response.text();

  if (!response.ok) {
    console.error("❌ Meta text error:", resultText);
    throw new Error(resultText || "Error enviando texto por Meta");
  }

  return resultText;
}

async function metaSendMedia(config, to, mediaUrl, type = "image", caption = "") {
  const finalType = type === "video" ? "video" : "image";

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: finalType,
    [finalType]: caption
      ? { link: mediaUrl, caption }
      : { link: mediaUrl },
  };

  const response = await fetch(
    `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(config.permanent_token || "").trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const resultText = await response.text();

  if (!response.ok) {
    console.error(`❌ Meta ${finalType} error:`, resultText);
    throw new Error(resultText || `Error enviando ${finalType} por Meta`);
  }

  return resultText;
}

// ─────────────────────────────────────────────
// WAHA
// ─────────────────────────────────────────────
async function wahaSendText(session, to, text) {
  const response = await fetch(`${WAHA_BASE_URL}/api/sendText`, {
    method: "POST",
    headers: wahaHeaders(),
    body: JSON.stringify({
      session,
      chatId: toChatId(to),
      text,
    }),
  });

  const resultText = await response.text();

  if (!response.ok) {
    console.error("❌ WAHA text error:", resultText);
    throw new Error(resultText || "Error enviando texto por WAHA");
  }

  return resultText;
}

async function wahaSendImage(session, to, mediaUrl, caption = "") {
  const response = await fetch(`${WAHA_BASE_URL}/api/sendImage`, {
    method: "POST",
    headers: wahaHeaders(),
    body: JSON.stringify({
      session,
      chatId: toChatId(to),
      file: { url: mediaUrl },
      caption: caption || undefined,
    }),
  });

  const resultText = await response.text();

  if (!response.ok) {
    console.error("❌ WAHA image error:", resultText);
    throw new Error(resultText || "Error enviando imagen por WAHA");
  }

  return resultText;
}

async function wahaSendVideo(session, to, mediaUrl, caption = "") {
  const response = await fetch(`${WAHA_BASE_URL}/api/sendVideo`, {
    method: "POST",
    headers: wahaHeaders(),
    body: JSON.stringify({
      session,
      chatId: toChatId(to),
      file: { url: mediaUrl },
      caption: caption || undefined,
    }),
  });

  const resultText = await response.text();

  if (!response.ok) {
    console.error("❌ WAHA video error:", resultText);
    throw new Error(resultText || "Error enviando video por WAHA");
  }

  return resultText;
}

// ─────────────────────────────────────────────
// GUARDAR MENSAJE SALIENTE
// ─────────────────────────────────────────────
async function saveOutgoingMessage({
  userId,
  tenantId,
  to,
  message,
  imageUrls,
  videoUrl,
  gifUrl,
}) {
  const allMedia = [
    ...imageUrls,
    ...(videoUrl ? [videoUrl] : []),
    ...(gifUrl ? [gifUrl] : []),
  ];

  const cleanTo = cleanPhone(to);

  const messageType =
    imageUrls.length > 0
      ? "out_image"
      : videoUrl
        ? "out_video"
        : gifUrl
          ? "out_gif"
          : "out_text";

  const row = {
    user_id: userId,
    platform: "whatsapp",
    from_number: cleanTo,
    message: message || "",
    message_type: messageType,
    media_url: allMedia[0] || null,
    is_processed: true,
  };

  if (tenantId) row.tenant_id = tenantId;

  const { error } = await supabase.from("received_messages").insert(row);

  if (error) {
    console.error("⚠️ No se pudo guardar saliente en received_messages:", error);
  }
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    const to = body.to || body.To || body.number || body.phone;
    const userId = body.userId || body.userid || body.user_id;
    const tenantId = body.tenant_id || body.tenantId || null;
    const message = body.message || body.text || "";

    const { imageUrls, videoUrl, gifUrl } = normalizeMedia(body);

    if (!to || !userId) {
      console.error("❌ Payload inválido:", JSON.stringify(body).slice(0, 500));
      return res.status(400).json({
        error: "Falta número o usuario",
        received: { to, userId, tenantId },
      });
    }

    const cleanTo = cleanPhone(to);

    if (!cleanTo) {
      return res.status(400).json({ error: "Número de teléfono inválido" });
    }

    const config = await getConfig({ userId, tenantId });

    if (!config) {
      return res.status(400).json({
        error: "WhatsApp no configurado para este usuario o tenant",
      });
    }

    const provider = config.provider || body.connection_type || "meta";

    console.log("📤 Enviando WhatsApp:", {
      provider,
      to: cleanTo,
      userId,
      tenantId,
      hasText: !!message,
      images: imageUrls.length,
      hasVideo: !!videoUrl,
      hasGif: !!gifUrl,
    });

    // ─────────────────────────────────────────────
    // WAHA
    // ─────────────────────────────────────────────
    if (provider === "waha") {
      if (!WAHA_BASE_URL) {
        return res.status(500).json({
          error: "WAHA_BASE_URL no configurado en el servidor",
        });
      }

      if (!config.waha_session) {
        return res.status(400).json({
          error: "Sesión WAHA no configurada para este usuario",
        });
      }

      const session = config.waha_session;

      for (let i = 0; i < imageUrls.length; i++) {
        const caption = i === 0 && message ? message : "";
        await wahaSendImage(session, cleanTo, imageUrls[i], caption);
      }

      if (imageUrls.length === 0 && message) {
        await wahaSendText(session, cleanTo, message);
      }

      if (videoUrl) {
        await wahaSendVideo(session, cleanTo, videoUrl, "");
      }

      if (gifUrl) {
        await wahaSendImage(session, cleanTo, gifUrl, "");
      }
    }

    // ─────────────────────────────────────────────
    // META
    // ─────────────────────────────────────────────
    else {
      if (!config.phone_number_id || !config.permanent_token) {
        return res.status(400).json({
          error: "Meta WhatsApp no configurado para este usuario",
        });
      }

      for (let i = 0; i < imageUrls.length; i++) {
        const caption = i === 0 && message ? message : "";
        await metaSendMedia(config, cleanTo, imageUrls[i], "image", caption);
      }

      if (imageUrls.length === 0 && message) {
        await metaSendText(config, cleanTo, message);
      }

      if (videoUrl) {
        await metaSendMedia(config, cleanTo, videoUrl, "video", "");
      }

      if (gifUrl) {
        await metaSendMedia(config, cleanTo, gifUrl, "image", "");
      }
    }

    await saveOutgoingMessage({
      userId,
      tenantId,
      to: cleanTo,
      message,
      imageUrls,
      videoUrl,
      gifUrl,
    });

    return res.status(200).json({
      ok: true,
      provider,
      to: cleanTo,
    });
  } catch (error) {
    console.error("❌ send-whatsapp error:", error);
    return res.status(500).json({
      error: error?.message || "Error interno enviando WhatsApp",
    });
  }
}
