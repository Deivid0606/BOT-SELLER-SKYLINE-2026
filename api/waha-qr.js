// api/waha-qr.js
// Endpoint que la UI usa para: start | get-qr | status | logout
// ✅ SOLUCIONADO: Usa sesión 'default' para WAHA Core
// ✅ SOLUCIONADO: Genera QR como imagen para mostrar en la UI
// ✅ Multitenencia: múltiples usuarios comparten la sesión 'default'

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = (process.env.WAHA_BASE_URL || "").replace(/\/$/, "");
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const SESSION_NAME = "default";

const wahaHeaders = () => ({
  "Content-Type": "application/json",
  "X-Api-Key": WAHA_API_KEY,
});

async function wahaFetch(path, options = {}) {
  const url = `${WAHA_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...wahaHeaders(), ...(options.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, data: json, raw: text };
}

async function upsertSessionRow(userId) {
  const { data: existing } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  
  if (existing) {
    await supabase
      .from("whatsapp_qr_sessions")
      .update({
        session_name: SESSION_NAME,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  } else {
    await supabase
      .from("whatsapp_qr_sessions")
      .insert({
        user_id: userId,
        session_name: SESSION_NAME,
        status: "disconnected",
        created_at: new Date().toISOString(),
      });
  }
}

// Función para convertir texto QR a imagen URL usando API gratuita
function textToQrImageUrl(text) {
  if (!text) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(text)}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === "OPTIONS") return res.status(200).end();
  
  // Soporte GET para debugging y obtener QR como imagen directamente
  if (req.method === "GET" && req.query.qr === "1") {
    try {
      const qrRes = await wahaFetch(`/api/sessions/${SESSION_NAME}/auth/qr`);
      if (qrRes.ok && qrRes.data?.qr) {
        const qrText = qrRes.data.qr;
        const qrImageUrl = textToQrImageUrl(qrText);
        return res.redirect(qrImageUrl);
      }
      return res.status(404).send("QR no disponible");
    } catch (err) {
      return res.status(500).send("Error obteniendo QR");
    }
  }
  
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  if (!WAHA_BASE_URL || !WAHA_API_KEY) {
    return res.status(500).json({ error: "WAHA no configurado en el servidor" });
  }

  try {
    const { action, user_id: userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "user_id requerido" });
    if (!action) return res.status(400).json({ error: "action requerido" });

    // ─── START: crear/iniciar sesión ───
    if (action === "start") {
      await upsertSessionRow(userId);

      const existing = await wahaFetch(`/api/sessions/${SESSION_NAME}`);

      if (!existing.ok || existing.status === 404) {
        console.log("🆕 Creando sesión default en WAHA...");
        const created = await wahaFetch(`/api/sessions`, {
          method: "POST",
          body: JSON.stringify({
            name: SESSION_NAME,
            start: true,
            config: {
              webhooks: [
                {
                  url: `https://${req.headers.host}/api/waha-webhook`,
                  events: ["message", "session.status"],
                  hmac: null,
                  retries: { policy: "linear", delaySeconds: 2, attempts: 3 },
                  customHeaders: [
                    { name: "X-Api-Key", value: WAHA_API_KEY },
                  ],
                },
              ],
            },
          }),
        });
        if (!created.ok) {
          console.error("❌ WAHA create session:", created.status, created.raw);
          return res.status(500).json({ error: "No se pudo crear la sesión", detail: created.raw });
        }
        console.log("✅ Sesión default creada exitosamente");
      } else {
        const status = existing.data?.status;
        if (status === "STOPPED" || status === "FAILED") {
          console.log("🔄 Iniciando sesión default existente...");
          await wahaFetch(`/api/sessions/${SESSION_NAME}/start`, { method: "POST" });
        }
      }

      await supabase
        .from("whatsapp_qr_sessions")
        .update({
          status: "starting",
          last_event_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      return res.status(200).json({ ok: true, session: SESSION_NAME });
    }

    // ─── GET-QR: obtener QR como texto y como imagen ───
    if (action === "get-qr") {
      console.log("🔍 Obteniendo QR para sesión:", SESSION_NAME);
      
      // Intentar diferentes formatos que soporta WAHA
      let qrValue = null;
      let qrRaw = null;
      
      // Formato 1: QR estándar
      const qrRes = await wahaFetch(`/api/sessions/${SESSION_NAME}/auth/qr`);
      if (qrRes.ok && qrRes.data?.qr) {
        qrValue = qrRes.data.qr;
        console.log("✅ QR obtenido v1, longitud:", qrValue.length);
      }
      
      // Formato 2: QR raw (base64)
      if (!qrValue) {
        const qrRawRes = await wahaFetch(`/api/sessions/${SESSION_NAME}/auth/qr?format=raw`);
        if (qrRawRes.ok && (qrRawRes.data?.value || qrRawRes.data?.qr)) {
          qrValue = qrRawRes.data?.value || qrRawRes.data?.qr;
          qrRaw = qrValue;
          console.log("✅ QR obtenido v2 (raw), longitud:", qrValue?.length);
        }
      }
      
      // Formato 3: QR como texto plano
      if (!qrValue) {
        const qrTextRes = await wahaFetch(`/api/sessions/${SESSION_NAME}/auth/qr?format=text`);
        if (qrTextRes.ok && qrTextRes.raw) {
          qrValue = qrTextRes.raw;
          console.log("✅ QR obtenido v3 (texto), longitud:", qrValue?.length);
        }
      }
      
      // Si hay QR, convertirlo a imagen URL y guardar
      if (qrValue && qrValue.length > 100) {
        const qrImageUrl = textToQrImageUrl(qrValue);
        
        await supabase
          .from("whatsapp_qr_sessions")
          .update({
            last_qr: qrValue,
            qr_updated_at: new Date().toISOString(),
            status: "pending_qr",
          })
          .eq("user_id", userId);
        
        // Devolver tanto el texto como la URL de la imagen
        return res.status(200).json({ 
          qr: qrValue,
          qrImageUrl: qrImageUrl,
          message: "QR generado correctamente"
        });
      }
      
      // Verificar si ya está conectado
      const sessionInfo = await wahaFetch(`/api/sessions/${SESSION_NAME}`);
      if (sessionInfo.ok && sessionInfo.data?.status === "WORKING") {
        const phone = sessionInfo.data?.me?.id?.replace(/@c\.us$/, "") || null;
        await supabase
          .from("whatsapp_qr_sessions")
          .update({
            status: "connected",
            connected_phone: phone,
            last_event_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
        
        return res.status(200).json({ 
          qr: null, 
          alreadyConnected: true, 
          phone: phone,
          message: "WhatsApp ya está conectado"
        });
      }
      
      console.log("⚠️ No se pudo obtener QR, status:", qrRes.status);
      return res.status(200).json({ 
        qr: null, 
        message: "Esperando QR... Asegúrate de que WAHA esté corriendo",
        debug: { status: qrRes.status, sessionStatus: sessionInfo.data?.status }
      });
    }

    // ─── STATUS: leer estado actual desde WAHA y reflejarlo en DB ───
    if (action === "status") {
      const s = await wahaFetch(`/api/sessions/${SESSION_NAME}`);
      if (!s.ok) {
        return res.status(200).json({ status: "disconnected", phone: null });
      }

      const wahaStatus = s.data?.status;
      let dbStatus = "disconnected";
      if (wahaStatus === "STARTING") dbStatus = "starting";
      else if (wahaStatus === "SCAN_QR_CODE") dbStatus = "pending_qr";
      else if (wahaStatus === "WORKING") dbStatus = "connected";
      else if (wahaStatus === "FAILED") dbStatus = "failed";

      const phone = s.data?.me?.id?.replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "") || null;
      
      console.log(`📱 Estado WAHA: ${wahaStatus} | Teléfono conectado: ${phone}`);

      await supabase
        .from("whatsapp_qr_sessions")
        .update({
          status: dbStatus,
          connected_phone: phone,
          last_event_at: new Date().toISOString(),
          ...(dbStatus === "connected" ? { connected_at: new Date().toISOString() } : {}),
          ...(dbStatus !== "connected" ? { connected_phone: null } : {}),
        })
        .eq("user_id", userId);

      return res.status(200).json({ status: dbStatus, phone });
    }

    // ─── LOGOUT: cerrar y borrar sesión ───
    if (action === "logout") {
      try {
        await wahaFetch(`/api/sessions/${SESSION_NAME}/logout`, { method: "POST" });
        await wahaFetch(`/api/sessions/${SESSION_NAME}`, { method: "DELETE" });
      } catch (err) {
        console.log("⚠️ Error al cerrar sesión en WAHA:", err.message);
      }

      await supabase
        .from("whatsapp_qr_sessions")
        .update({
          status: "disconnected",
          last_qr: null,
          connected_phone: null,
          connected_at: null,
          last_event_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (err) {
    console.error("❌ waha-qr error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
}
