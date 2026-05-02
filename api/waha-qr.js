// api/waha-qr.js
// Endpoint que la UI usa para: start | get-qr | status | logout
// Body: { action: 'start'|'get-qr'|'status'|'logout', user_id }
//
// ⚠️ WAHA Core solo soporta UNA sesión llamada "default".
// Por eso usamos sessionName = "default" SIEMPRE, y guardamos el user_id
// dueño de la sesión en la columna user_id de whatsapp_qr_sessions.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = (process.env.WAHA_BASE_URL || "").replace(/\/$/, "");
const WAHA_API_KEY = process.env.WAHA_API_KEY;

// WAHA Core solo permite "default"
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
  await supabase
    .from("whatsapp_qr_sessions")
    .upsert(
      {
        user_id: userId,
        session_name: SESSION_NAME,
        status: "disconnected",
      },
      { onConflict: "user_id" }
    );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
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

      // 1. Verificar si ya existe en WAHA
      const existing = await wahaFetch(`/api/sessions/${SESSION_NAME}`);

      if (!existing.ok || existing.status === 404) {
        // Crear sesión nueva
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
          return res
            .status(500)
            .json({ error: "No se pudo crear la sesión", detail: created.raw });
        }
      } else {
        // Si existe pero está parada, iniciar
        const status = existing.data?.status;
        if (status === "STOPPED" || status === "FAILED") {
          await wahaFetch(`/api/sessions/${SESSION_NAME}/start`, {
            method: "POST",
          });
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

    // ─── GET-QR: obtener QR (raw base64) ───
    if (action === "get-qr") {
      const qrRes = await wahaFetch(`/api/${SESSION_NAME}/auth/qr?format=raw`);
      if (!qrRes.ok) {
        // 422 = ya conectado o no en estado SCAN_QR_CODE
        return res.status(200).json({ qr: null, status: qrRes.status });
      }
      const qrValue = qrRes.data?.value || qrRes.data?.qr || null;
      if (qrValue) {
        await supabase
          .from("whatsapp_qr_sessions")
          .update({
            last_qr: qrValue,
            qr_updated_at: new Date().toISOString(),
            status: "pending_qr",
          })
          .eq("user_id", userId);
      }
      return res.status(200).json({ qr: qrValue });
    }

    // ─── STATUS: leer estado actual desde WAHA y reflejarlo en DB ───
    if (action === "status") {
      const s = await wahaFetch(`/api/sessions/${SESSION_NAME}`);
      if (!s.ok) return res.status(200).json({ status: "disconnected" });

      const wahaStatus = s.data?.status;
      let dbStatus = "disconnected";
      if (wahaStatus === "STARTING") dbStatus = "starting";
      else if (wahaStatus === "SCAN_QR_CODE") dbStatus = "pending_qr";
      else if (wahaStatus === "WORKING") dbStatus = "connected";
      else if (wahaStatus === "FAILED") dbStatus = "failed";

      const phone = s.data?.me?.id?.replace(/@c\.us$/, "") || null;

      await supabase
        .from("whatsapp_qr_sessions")
        .update({
          status: dbStatus,
          connected_phone: phone,
          last_event_at: new Date().toISOString(),
          ...(dbStatus === "connected"
            ? { connected_at: new Date().toISOString() }
            : {}),
        })
        .eq("user_id", userId);

      return res.status(200).json({ status: dbStatus, phone });
    }

    // ─── LOGOUT: cerrar y borrar sesión ───
    if (action === "logout") {
      await wahaFetch(`/api/sessions/${SESSION_NAME}/logout`, {
        method: "POST",
      });
      await wahaFetch(`/api/sessions/${SESSION_NAME}`, { method: "DELETE" });

      await supabase
        .from("whatsapp_qr_sessions")
        .update({
          status: "disconnected",
          last_qr: null,
          connected_phone: null,
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
