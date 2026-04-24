// api/webhook.js
// Webhook de WhatsApp Business (Meta Cloud API).
// Funciones:
//  - Verificación GET
//  - Recepción de mensajes
//  - Triggers + plantillas
//  - Reenvío a IA (chat-ia) si no hay trigger
//  - Detecta "✅ PEDIDO CONFIRMADO" y crea fila en `orders` + `order_confirmations`

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const VERIFY_TOKEN = "miTokenSeguro2026";

// ======================= Helpers =======================
const clean = (t) => (t || "").toString().trim();
const norm = (t) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

function splitMessage(text, max = 3500) {
  if (!text) return [];
  const out = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

// ======================= Envío WhatsApp =======================
async function getCfg(userId) {
  const { data, error } = await supabase
    .from("whatsapp_config")
    .select("phone_number_id, permanent_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("whatsapp_config not found");
  if (!data.phone_number_id || !data.permanent_token) {
    throw new Error("whatsapp_config missing phone_number_id or permanent_token");
  }
  return data;
}

async function enviarMensaje(userId, to, text) {
  try {
    const cfg = await getCfg(userId);
    const parts = splitMessage(text);
    for (const part of parts) {
      const r = await fetch(
        `https://graph.facebook.com/v20.0/${cfg.phone_number_id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.permanent_token}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: part, preview_url: false },
          }),
        }
      );
      if (!r.ok) {
        const errTxt = await r.text();
        console.error("❌ enviarMensaje Meta error:", r.status, errTxt);
      }
    }
    return true;
  } catch (e) {
    console.error("❌ enviarMensaje:", e.message);
    return false;
  }
}

async function enviarMedia(userId, to, mediaUrl, mediaType, caption = "") {
  try {
    const cfg = await getCfg(userId);
    let type = (mediaType || "").toLowerCase();
    if (type === "gif") type = "video";
    if (!type) type = "image";

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
          Authorization: `Bearer ${cfg.permanent_token}`,
        },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) {
      const errTxt = await r.text();
      console.error("❌ enviarMedia Meta error:", r.status, errTxt);
    }
    return r.ok;
  } catch (e) {
    console.error("❌ enviarMedia:", e.message);
    return false;
  }
}

async function enviarPlantilla(userId, to, template) {
  if (template?.media_url) {
    await enviarMedia(
      userId,
      to,
      template.media_url,
      template.media_type,
      template.message || ""
    );
  } else if (template?.message) {
    await enviarMensaje(userId, to, template.message);
  }
}

// ======================= Inbox / Contexto / Historial =======================
async function saveInboxMessage({ userId, from, message, source, mediaUrl = null }) {
  try {
    await supabase.from("inbox_messages").insert({
      user_id: userId,
      sender_id: from,
      source,
      message: message || "",
      media_url: mediaUrl ? [mediaUrl] : null,
      is_read: source !== "inbound",
    });
  } catch (e) {
    console.error("saveInboxMessage:", e.message);
  }
}

async function getContexto(userId, from) {
  try {
    const { data } = await supabase
      .from("chat_context")
      .select("context")
      .eq("user_id", userId)
      .eq("sender_id", from)
      .maybeSingle();
    return data?.context || {};
  } catch {
    return {};
  }
}

async function saveContexto(userId, from, ctx = {}) {
  try {
    await supabase
      .from("chat_context")
      .upsert(
        { user_id: userId, sender_id: from, context: ctx, updated_at: new Date().toISOString() },
        { onConflict: "user_id,sender_id" }
      );
  } catch (e) {
    console.error("saveContexto:", e.message);
  }
}

async function isAiPaused(from) {
  try {
    const { data } = await supabase
      .from("conversation_settings")
      .select("ai_paused")
      .eq("sender_id", from)
      .maybeSingle();
    return !!data?.ai_paused;
  } catch {
    return false;
  }
}

async function getHistory(userId, from) {
  try {
    const { data } = await supabase
      .from("inbox_messages")
      .select("source, message, created_at")
      .eq("user_id", userId)
      .eq("sender_id", from)
      .order("created_at", { ascending: false })
      .limit(20);
    return (data || []).reverse();
  } catch {
    return [];
  }
}

// ======================= Detección y creación de pedidos =======================
function parseOrderFromText(text) {
  if (!text) return null;
  const t = text.replace(/\r/g, "");
  const isOrder =
    /pedido\s+confirmado/i.test(t) ||
    /✅\s*pedido/i.test(t) ||
    /confirmaci[oó]n\s+de\s+pedido/i.test(t);
  if (!isOrder) return null;

  const grab = (regexes) => {
    for (const re of regexes) {
      const m = t.match(re);
      if (m && m[1]) return clean(m[1]).replace(/[*_`]/g, "");
    }
    return null;
  };

  const product = grab([
    /producto\s*[:\-]\s*(.+)/i,
    /art[ií]culo\s*[:\-]\s*(.+)/i,
  ]);
  const quantityRaw = grab([
    /cantidad\s*[:\-]\s*(\d+)/i,
    /unidades?\s*[:\-]\s*(\d+)/i,
  ]);
  const customer = grab([
    /cliente\s*[:\-]\s*(.+)/i,
    /nombre\s*[:\-]\s*(.+)/i,
  ]);
  const city = grab([/ciudad\s*[:\-]\s*(.+)/i, /municipio\s*[:\-]\s*(.+)/i]);
  const address = grab([
    /direcci[oó]n\s*[:\-]\s*(.+)/i,
    /domicilio\s*[:\-]\s*(.+)/i,
    /barrio\s*[:\-]\s*(.+)/i,
  ]);
  const total = grab([
    /total\s*[:\-]\s*\$?\s*([\d.,]+)/i,
    /precio\s*[:\-]\s*\$?\s*([\d.,]+)/i,
    /valor\s*[:\-]\s*\$?\s*([\d.,]+)/i,
  ]);

  return {
    product: product || null,
    quantity: quantityRaw ? parseInt(quantityRaw, 10) : 1,
    customer_name: customer || null,
    city: city || null,
    address: address || null,
    total_amount: total || null,
  };
}

async function maybeCreateOrderFromOutbound({ userId, to, text }) {
  try {
    const parsed = parseOrderFromText(text);
    if (!parsed) return;

    const sinceIso = new Date(Date.now() - 60_000).toISOString();
    const { data: dupe } = await supabase
      .from("orders")
      .select("id")
      .eq("user_id", userId)
      .eq("phone", to)
      .gte("created_at", sinceIso)
      .limit(1);
    if (dupe && dupe.length) return;

    const ctx = await getContexto(userId, to);
    const nowIso = new Date().toISOString();

    const orderRow = {
      user_id: userId,
      from_number: to,
      phone: to,
      product: parsed.product || ctx.producto || ctx.product || null,
      producto: parsed.product || ctx.producto || ctx.product || null,
      customer_name: parsed.customer_name || ctx.nombre || ctx.customer_name || null,
      city: parsed.city || ctx.ciudad || ctx.city || null,
      ciudad: parsed.city || ctx.ciudad || ctx.city || null,
      address: parsed.address || ctx.direccion || ctx.address || null,
      quantity: parsed.quantity || ctx.cantidad || 1,
      total_amount: parsed.total_amount || ctx.total || null,
      status: "confirmed",
      order_confirmation_sent: true,
      order_confirmation_sent_at: nowIso,
      current_step: "confirmed",
      fecha: nowIso,
      conversation_history: ctx.history || null,
    };

    const { data: inserted, error } = await supabase
      .from("orders")
      .insert(orderRow)
      .select("id")
      .single();

    if (error) {
      console.error("orders insert error:", error.message);
      return;
    }

    await supabase.from("order_confirmations").insert({
      user_id: userId,
      order_id: inserted.id,
      to_number: to,
      message: text,
      status: "sent",
      sent_at: nowIso,
      retry_count: 0,
    });

    console.log("✅ Pedido creado:", inserted.id, "para", to);
  } catch (e) {
    console.error("maybeCreateOrderFromOutbound error:", e.message);
  }
}

// ======================= Triggers =======================
async function buscarTriggerYResponder(userId, from, texto) {
  try {
    const nTexto = norm(texto);
    const { data: triggers } = await supabase
      .from("triggers")
      .select("id, keywords, template_id, match_type, enabled")
      .eq("user_id", userId)
      .eq("enabled", true);

    if (!triggers || !triggers.length) return false;

    let matched = null;
    for (const tr of triggers) {
      const kws = (tr.keywords || []).map((k) => norm(k));
      const hit = kws.some((k) => {
        if (!k) return false;
        if (tr.match_type === "exact") return nTexto === k;
        return nTexto.includes(k);
      });
      if (hit) {
        matched = tr;
        break;
      }
    }
    if (!matched) return false;

    const { data: tpl } = await supabase
      .from("templates")
      .select("id, message, media_url, media_type, usage_count")
      .eq("id", matched.template_id)
      .maybeSingle();

    if (!tpl) return false;

    await enviarPlantilla(userId, from, tpl);
    await supabase
      .from("templates")
      .update({ usage_count: (tpl.usage_count || 0) + 1 })
      .eq("id", tpl.id);

    await saveInboxMessage({
      userId,
      from,
      message: tpl.message || "",
      source: "outbound",
      mediaUrl: tpl.media_url || null,
    });

    await maybeCreateOrderFromOutbound({ userId, to: from, text: tpl.message || "" });

    return true;
  } catch (e) {
    console.error("buscarTriggerYResponder error:", e.message);
    return false;
  }
}

// ======================= IA =======================
async function llamarChatIA({ req, userId, texto, from, ctx, history }) {
  try {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const url = `${proto}://${host}/api/chat-ia`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, from, message: texto, context: ctx, history }),
    });
    const data = await r.json().catch(() => ({}));
    return data?.reply || data?.message || null;
  } catch (e) {
    console.error("chat-ia error:", e.message);
    return null;
  }
}

async function procesar(req, message, userId, from) {
  const texto = clean(message?.text?.body || message?.button?.text || "");
  if (!texto) return;

  await saveInboxMessage({ userId, from, message: texto, source: "inbound" });

  const hit = await buscarTriggerYResponder(userId, from, texto);
  if (hit) return;

  if (await isAiPaused(from)) return;

  const ctx = await getContexto(userId, from);
  const history = await getHistory(userId, from);
  const reply = await llamarChatIA({ req, userId, texto, from, ctx, history });

  if (reply) {
    await enviarMensaje(userId, from, reply);
    await saveInboxMessage({ userId, from, message: reply, source: "ai" });
    await maybeCreateOrderFromOutbound({ userId, to: from, text: reply });
  }
}

// ======================= Handler =======================
export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  if (req.method !== "POST") return res.status(405).end();

  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return res.sendStatus(404);

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const { data: cfg } = await supabase
          .from("whatsapp_config")
          .select("user_id")
          .eq("phone_number_id", phoneNumberId)
          .maybeSingle();
        if (!cfg?.user_id) continue;

        for (const message of value.messages || []) {
          const from = message.from;
          await procesar(req, message, cfg.user_id, from);
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("webhook error:", e);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
