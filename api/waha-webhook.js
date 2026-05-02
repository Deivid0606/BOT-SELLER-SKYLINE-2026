// api/waha-webhook.js
// Webhook de WAHA → traduce payload al formato Meta y reusa procesar() de webhook.js
// Eventos manejados: message, session.status
// ✅ SOLUCIONADO: Usa sesión 'default' y rutea por número de teléfono para multitenencia

import { createClient } from "@supabase/supabase-js";
import { procesar } from "./webhook.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_API_KEY = process.env.WAHA_API_KEY;

// Convierte un msg de WAHA al formato esperado por procesar() (formato Meta)
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

// Obtener userId por número de teléfono (para multitenencia con sesión 'default')
async function getUserIdByPhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;
  
  const { data, error } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("connected_phone", phoneNumber)
    .maybeSingle();
  
  if (error) {
    console.error("❌ Error buscando userId por teléfono:", error);
    return null;
  }
  
  return data?.user_id || null;
}

// Fallback: obtener userId por session (para compatibilidad)
async function getUserIdBySession(sessionName) {
  const { data } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("session_name", sessionName)
    .maybeSingle();
  return data?.user_id || null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Validar API key
  const apiKey = req.headers["x-api-key"] || req.headers["x-webhook-key"];
  if (WAHA_API_KEY && apiKey && apiKey !== WAHA_API_KEY) {
    console.log("❌ WAHA webhook: API key inválida");
    return res.status(401).send("Unauthorized");
  }

  try {
    const body = req.body;
    const event = body?.event;
    const sessionName = body?.session || "default";
    const payload = body?.payload || body;

    console.log(`📡 WAHA event: ${event} | session: ${sessionName}`);
    console.log(`📦 Payload preview:`, JSON.stringify(payload).substring(0, 200));

    // ─── EVENTO: cambio de estado de sesión ───
    if (event === "session.status") {
      const wahaStatus = payload.status;
      let dbStatus = "disconnected";
      if (wahaStatus === "STARTING") dbStatus = "starting";
      else if (wahaStatus === "SCAN_QR_CODE") dbStatus = "pending_qr";
      else if (wahaStatus === "WORKING") dbStatus = "connected";
      else if (wahaStatus === "FAILED") dbStatus = "failed";
      else if (wahaStatus === "STOPPED") dbStatus = "disconnected";

      const connectedPhone = payload.me?.id?.replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "") || null;

      // Actualizar la sesión
      await supabase
        .from("whatsapp_qr_sessions")
        .update({
          status: dbStatus,
          connected_phone: connectedPhone,
          last_event_at: new Date().toISOString(),
          ...(dbStatus === "connected" ? { connected_at: new Date().toISOString() } : {}),
          ...(dbStatus === "disconnected" || dbStatus === "failed" ? { connected_phone: null, last_qr: null } : {})
        })
        .eq("session_name", sessionName);

      console.log(`✅ Estado actualizado: ${dbStatus} | Teléfono: ${connectedPhone}`);
      return res.status(200).send("OK");
    }

    // ─── EVENTO: mensaje entrante ───
    if (event === "message" || event === "message.any") {
      // Ignorar mensajes propios
      if (payload.fromMe) {
        console.log("⏭️ Ignorando mensaje propio (fromMe)");
        return res.status(200).send("OK (fromMe)");
      }

      // Obtener el número de teléfono destino (el número conectado)
      const toPhone = (payload.to || payload.recipient || payload.chatId || "")
        .replace(/@c\.us$/, "")
        .replace(/@s\.whatsapp\.net$/, "");
      
      const fromPhone = (payload.from || "")
        .replace(/@c\.us$/, "")
        .replace(/@s\.whatsapp\.net$/, "");

      console.log(`📞 Mensaje de: ${fromPhone} | para: ${toPhone}`);

      // Buscar el usuario por el número de teléfono destino
      let userId = await getUserIdByPhoneNumber(toPhone);
      
      // Fallback: buscar por sessionName
      if (!userId && sessionName) {
        console.log(`⚠️ No encontrado por teléfono, buscando por session: ${sessionName}`);
        userId = await getUserIdBySession(sessionName);
      }

      if (!userId) {
        console.log(`⚠️ No se encontró usuario para teléfono: ${toPhone} | session: ${sessionName}`);
        // Guardar mensaje huérfano para depuración
        const { error: insertError } = await supabase
          .from("inbox_messages")
          .insert({
            user_id: null,
            source: "whatsapp",
            platform: "waha",
            sender_id: fromPhone,
            from_number: fromPhone,
            message: payload.body || "[mensaje huérfano]",
            message_type: "text",
            wa_message_id: payload.id,
            is_read: false,
            is_processed: true,
            created_at: new Date().toISOString()
          });
        
        if (insertError) {
          console.error("❌ Error guardando mensaje huérfano:", insertError);
        }
        return res.status(200).send("OK (no user)");
      }

      console.log(`✅ Usuario encontrado: ${userId}`);

      const metaMsg = wahaToMeta(payload);

      const fakeReq = {
        headers: {
          host: req.headers.host,
          "x-forwarded-proto": req.headers["x-forwarded-proto"] || "https",
        },
      };

      console.log(`🚀 Procesando mensaje para usuario ${userId}...`);
      await procesar(fakeReq, metaMsg, userId, metaMsg.from);
      console.log(`✅ Mensaje procesado exitosamente`);
      
      return res.status(200).send("OK");
    }

    // Otros eventos: ignorar silenciosamente
    console.log(`ℹ️ Evento ignorado: ${event}`);
    return res.status(200).send("OK (ignored)");
  } catch (err) {
    console.error("❌ waha-webhook error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}
