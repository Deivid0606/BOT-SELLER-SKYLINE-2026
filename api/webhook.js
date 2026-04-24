import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = "miTokenSeguro2026";

const clean = (t) => String(t || "").trim();
const norm = (t) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// =================== UTIL ===================
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

// =================== ENVÍO TEXTO ===================
async function enviarMensaje(userId, to, text) {
  try {
    const { data: config, error } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !config?.phone_number_id || !config?.permanent_token) {
      console.log("❌ Sin config WhatsApp:", error);
      return false;
    }

    const msg = clean(text);
    if (!msg) return false;

    const partes = splitMessage(msg, 3500);
    console.log(`📤 Enviando ${partes.length} parte(s) de texto`);

    for (const parte of partes) {
      const r = await fetch(
        `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.permanent_token.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: parte, preview_url: false },
          }),
        }
      );
      const raw = await r.text();
      console.log("📤 Meta status:", r.status);
      if (!r.ok) {
        console.log("📤 Meta resp:", raw);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error("❌ enviarMensaje:", err);
    return false;
  }
}

// =================== ENVÍO MEDIA ===================
async function enviarMedia(userId, to, mediaUrl, mediaType, caption = "") {
  try {
    const { data: config } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (!config?.phone_number_id || !config?.permanent_token) {
      console.log("❌ Sin config WhatsApp para media");
      return false;
    }

    // gif → se envía como video en WhatsApp
    let waType = "image";
    if (mediaType === "video" || mediaType === "gif") waType = "video";

    const mediaPayload = { link: mediaUrl };
    if (caption && (waType === "image" || waType === "video")) {
      mediaPayload.caption = clean(caption).slice(0, 1024);
    }

    const body = {
      messaging_product: "whatsapp",
      to,
      type: waType,
      [waType]: mediaPayload,
    };

    console.log(`📤 Enviando ${waType}:`, mediaUrl);

    const r = await fetch(
      `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.permanent_token.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const raw = await r.text();
    console.log("📤 Meta media status:", r.status);
    if (!r.ok) {
      console.log("📤 Meta media resp:", raw);
      return false;
    }
    return true;
  } catch (err) {
    console.error("❌ enviarMedia:", err);
    return false;
  }
}

// =================== ENVIAR PLANTILLA ===================
async function enviarPlantilla(userId, to, template) {
  try {
    const texto = clean(template?.content || template?.message || "");
    const variables = template?.variables || {};
    const media = variables?.media || {};

    const imageUrls = Array.isArray(media.imageUrls) ? media.imageUrls : [];
    const videoUrl = media.videoUrl || null;
    const gifUrl = media.gifUrl || null;
    const legacyUrl = template?.media_url || null;
    const legacyType = template?.media_type || null;

    const tieneMedia =
      imageUrls.length > 0 || !!videoUrl || !!gifUrl || !!legacyUrl;

    if (tieneMedia) {
      let primeraEnviada = false;
      let okAlguna = false;

      if (imageUrls.length > 0) {
        for (let i = 0; i < imageUrls.length; i++) {
          const cap = i === 0 ? texto : "";
          const ok = await enviarMedia(userId, to, imageUrls[i], "image", cap);
          if (ok) okAlguna = true;
          primeraEnviada = true;
        }
      }
      if (videoUrl) {
        const cap = !primeraEnviada ? texto : "";
        const ok = await enviarMedia(userId, to, videoUrl, "video", cap);
        if (ok) okAlguna = true;
        primeraEnviada = true;
      }
      if (gifUrl) {
        const cap = !primeraEnviada ? texto : "";
        const ok = await enviarMedia(userId, to, gifUrl, "gif", cap);
        if (ok) okAlguna = true;
        primeraEnviada = true;
      }
      if (!imageUrls.length && !videoUrl && !gifUrl && legacyUrl) {
        const ok = await enviarMedia(
          userId,
          to,
          legacyUrl,
          legacyType || "image",
          texto
        );
        if (ok) okAlguna = true;
        primeraEnviada = true;
      }

      // Caption truncado → mandar resto como texto
      if (texto.length > 1024) {
        await enviarMensaje(userId, to, texto);
      }

      // Si toda la media falló, al menos mandar el texto
      if (!okAlguna && texto) {
        return await enviarMensaje(userId, to, texto);
      }
      return okAlguna;
    }

    if (texto) return await enviarMensaje(userId, to, texto);
    return false;
  } catch (err) {
    console.error("❌ enviarPlantilla:", err);
    return false;
  }
}

// =================== TRIGGERS ===================
async function buscarTriggerYResponder(userId, from, texto) {
  try {
    const { data: triggers, error } = await supabase
      .from("triggers")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      console.log("❌ getTriggers:", error);
      return false;
    }
    if (!triggers || triggers.length === 0) {
      console.log("ℹ️ Sin triggers activos");
      return false;
    }

    const msgN = norm(texto);
    let matched = null;

    for (const t of triggers) {
      const keyword = norm(t.keyword || t.condition || "");
      if (!keyword) continue;
      const matchType = (t.match_type || "contains").toLowerCase();

      let hit = false;
      if (matchType === "exact") {
        hit = msgN === keyword;
      } else if (matchType === "starts_with" || matchType === "startswith") {
        hit = msgN.startsWith(keyword);
      } else {
        const kws = keyword.split(",").map((k) => k.trim()).filter(Boolean);
        hit = kws.some((k) => msgN.includes(k));
      }

      if (hit) {
        matched = t;
        break;
      }
    }

    if (!matched) {
      console.log("ℹ️ Ningún trigger coincide con:", msgN);
      return false;
    }

    console.log(
      "🎯 Trigger match:",
      matched.name || matched.keyword || matched.condition
    );

    // Buscar plantilla por id O por nombre
    let template = null;
    const tplRef = clean(
      matched.template_id || matched.template || matched.template_name || ""
    );
    console.log("🔎 Buscando plantilla ref:", tplRef);

    if (tplRef) {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          tplRef
        );

      if (isUuid) {
        const { data: tpl, error: e1 } = await supabase
          .from("templates")
          .select("*")
          .eq("id", tplRef)
          .maybeSingle();
        if (e1) console.log("❌ tpl by id:", e1);
        template = tpl;
      }

      if (!template) {
        // Buscar por nombre (sin filtrar por user_id porque la columna puede no existir
        // o la plantilla puede ser global). Si hay varias coincidencias, preferimos la del
        // mismo user; si no, la primera.
        const { data: tplsByName, error: e2 } = await supabase
          .from("templates")
          .select("*")
          .ilike("name", tplRef)
          .limit(5);
        if (e2) console.log("❌ tpl by name:", e2);
        if (tplsByName && tplsByName.length > 0) {
          template =
            tplsByName.find((t) => t.user_id === userId) || tplsByName[0];
        }
      }
    }

    const fallbackText = clean(
      matched.response ||
        matched.message ||
        template?.content ||
        template?.message ||
        ""
    );

    if (template) {
      template = {
        ...template,
        content: clean(template.content || template.message || fallbackText),
        variables: template.variables || {},
        media_url: template.media_url || matched.media_url || null,
        media_type: template.media_type || matched.media_type || null,
      };
      console.log(
        "📄 Plantilla:",
        template.name,
        "media:",
        !!template.media_url,
        "imgs:",
        template?.variables?.media?.imageUrls?.length || 0
      );
    } else {
      console.log("⚠️ Sin plantilla, usando texto del trigger");
      template = {
        content: fallbackText,
        variables: matched.variables || {},
        media_url: matched.media_url || null,
        media_type: matched.media_type || null,
      };
    }

    let sent = await enviarPlantilla(userId, from, template);

    if (!sent && fallbackText) {
      console.log("⚠️ Falló envío, mandando solo texto");
      sent = await enviarMensaje(userId, from, fallbackText);
    }

    if (sent) {
      const textOut = clean(
        template.content || template.message || fallbackText
      );
      const media = template?.variables?.media || {};
      const firstMedia =
        media.imageUrls?.[0] ||
        media.videoUrl ||
        media.gifUrl ||
        template.media_url ||
        null;

      await saveInboxMessage({
        userId,
        from,
        message: textOut || "[Plantilla con multimedia]",
        source: "out",
        mediaUrl: firstMedia,
      });

      if (template.id) {
        await supabase
          .from("templates")
          .update({ usage_count: (template.usage_count || 0) + 1 })
          .eq("id", template.id);
      }
    }

    return sent;
  } catch (err) {
    console.error("❌ buscarTriggerYResponder:", err);
    return false;
  }
}

// =================== CONTEXTO ===================
async function getContexto(userId, from) {
  try {
    const { data, error } = await supabase
      .from("chat_context")
      .select("*")
      .eq("user_id", userId)
      .eq("from_number", from)
      .maybeSingle();
    if (error) console.log("❌ getContexto:", error);
    return data || {};
  } catch (err) {
    console.error("❌ getContexto:", err);
    return {};
  }
}

async function saveContexto(userId, from, ctx = {}) {
  try {
    const { error } = await supabase.from("chat_context").upsert(
      {
        user_id: userId,
        from_number: from,
        last_topic: ctx?.last_topic || null,
        last_trigger: ctx?.last_trigger || null,
        current_product: ctx?.current_product || null,
        step: ctx?.step || null,
        order_data: ctx?.order_data || {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,from_number" }
    );
    if (error) console.log("❌ saveContexto:", error);
  } catch (err) {
    console.error("❌ saveContexto:", err);
  }
}

// =================== PAUSA IA ===================
async function isAiPaused(from) {
  try {
    const { data } = await supabase
      .from("conversation_settings")
      .select("ai_paused")
      .eq("phone", from)
      .maybeSingle();
    return !!data?.ai_paused;
  } catch {
    return false;
  }
}

// =================== INBOX ===================
async function getHistory(userId, from) {
  try {
    const { data, error } = await supabase
      .from("inbox_messages")
      .select("message, created_at, source")
      .eq("user_id", userId)
      .eq("sender_id", from)
      .order("created_at", { ascending: false })
      .limit(14);

    if (error) {
      console.log("❌ getHistory:", error);
      return [];
    }

    return (data || [])
      .reverse()
      .map((m) => ({
        role: m.source === "out" ? "assistant" : "user",
        content: clean(m.message),
      }))
      .filter((m) => m.content);
  } catch (err) {
    console.error("❌ getHistory:", err);
    return [];
  }
}

async function saveInboxMessage({
  userId,
  from,
  message,
  source,
  mediaUrl = null,
}) {
  try {
    const payload = {
      user_id: userId,
      source,
      sender_id: from,
      message: message || null,
      media_url: mediaUrl ? [mediaUrl] : null,
      is_read: source === "out" ? true : false,
    };

    const { error } = await supabase.from("inbox_messages").insert(payload);
    if (error) console.log("❌ saveInboxMessage:", error);
    return !error;
  } catch (err) {
    console.error("❌ saveInboxMessage:", err);
    return false;
  }
}

// =================== CHAT IA ===================
async function llamarChatIA({ req, userId, texto, from, ctx, history }) {
  const host = req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  if (!host) throw new Error("No host");

  const url = `${protocol}://${host}/api/chat-ia`;
  console.log("🌐 chat-ia URL:", url);

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      message: texto,
      from_number: from,
      context: ctx || {},
      history: history || [],
    }),
  });

  const raw = await r.text();
  console.log("🧠 chat-ia status:", r.status, "len:", raw.length);

  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("chat-ia no devolvió JSON");
  }
  if (!r.ok) throw new Error(data?.error || `chat-ia error ${r.status}`);
  return data;
}

// =================== PROCESAR MENSAJE ===================
async function procesar(req, message, userId, from) {
  try {
    if (message.type !== "text") return;
    const texto = clean(message.text?.body || "");
    if (!texto) return;

    console.log("━━━━━━━━━━━━━━");
    console.log("📩 IN:", from, texto);

    await saveInboxMessage({ userId, from, message: texto, source: "in" });

    // 1) DISPARADORES PRIMERO
    const triggerSent = await buscarTriggerYResponder(userId, from, texto);
    if (triggerSent) {
      console.log("✅ Respondido por trigger");
      return;
    }

    // 2) Pausa IA
    const paused = await isAiPaused(from);
    if (paused) {
      console.log("⏸️ IA pausada para", from);
      return;
    }

    // 3) IA
    const ctx = await getContexto(userId, from);
    const history = await getHistory(userId, from);

    let data = {};
    try {
      data = await llamarChatIA({ req, userId, texto, from, ctx, history });
    } catch (err) {
      console.error("❌ chat-ia:", err);
      const errMsg =
        "⚠️ Disculpá, hubo un error momentáneo. Escribime nuevamente por favor.";
      await enviarMensaje(userId, from, errMsg);
      await saveInboxMessage({ userId, from, message: errMsg, source: "out" });
      return;
    }

    if (data?.context) await saveContexto(userId, from, data.context);

    if (data?.response) {
      const sent = await enviarMensaje(userId, from, data.response);
      if (sent) {
        await saveInboxMessage({
          userId,
          from,
          message: data.response,
          source: "out",
        });
      }
      return;
    }

    const fallback =
      "👋 Hola! ¿En qué puedo ayudarte?\n\n📋 Catálogo:\nhttps://cat-logomegatodo-com.vercel.app/";
    await enviarMensaje(userId, from, fallback);
    await saveInboxMessage({ userId, from, message: fallback, source: "out" });
  } catch (err) {
    console.error("❌ procesar:", err);
  }
}

// =================== HANDLER ===================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verificado");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Token inválido");
  }

  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("📥 BODY:", JSON.stringify(body).slice(0, 1500));

      if (body.object !== "whatsapp_business_account") {
        return res.status(404).send("Not WhatsApp");
      }

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          const phoneId = value?.metadata?.phone_number_id;
          if (!phoneId) continue;

          const { data: config, error } = await supabase
            .from("whatsapp_config")
            .select("user_id")
            .eq("phone_number_id", phoneId)
            .maybeSingle();

          if (error || !config?.user_id) {
            console.log("❌ Sin user_id para phoneId:", phoneId);
            continue;
          }

          for (const msg of value.messages || []) {
            await procesar(req, msg, config.user_id, msg.from);
          }
        }
      }

      return res.status(200).send("EVENT_RECEIVED");
    } catch (e) {
      console.error("❌ webhook:", e);
      return res.status(500).json({ error: "Error interno" });
    }
  }

  return res.status(405).send("Method Not Allowed");
}
