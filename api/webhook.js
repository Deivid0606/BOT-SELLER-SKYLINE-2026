// api/webhook.js — webhook_v18.js (FLUJO CORRECTO: pide datos antes de confirmar)
// WhatsApp Cloud API → Triggers → Gemini (texto + imagen + audio)
// + Descarga de audios/imágenes/videos a Supabase Storage
// + CONFIRMACIÓN ÚNICA Y DETECCIÓN DE INTENCIONES
// + DETECCIÓN DE PRODUCTOS - PIDE DATOS DEL CLIENTE PRIMERO

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = "miTokenSeguro2026";

// Sistema de estados por conversación
const conversationStates = new Map();

function getConversationState(chatId) {
  if (!conversationStates.has(chatId)) {
    conversationStates.set(chatId, {
      orderConfirmed: false,
      lastConfirmationTime: null,
      lastMessageTime: null,
      orderData: null
    });
  }
  return conversationStates.get(chatId);
}

function updateConversationState(chatId, updates) {
  const state = getConversationState(chatId);
  Object.assign(state, updates);
  conversationStates.set(chatId, state);
}

const clean = (t) => String(t || "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normalize = (t) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// ═══════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES PARA EXTRAER DATOS DEL CLIENTE
// ═══════════════════════════════════════════════════════════

function extraerNombre(texto) {
  const msg = texto;
  
  const patterns = [
    /(?:mi nombre es|me llamo|soy|nombre:?)\s*([A-Za-zÀ-ÿ\s]{2,40})(?:\n|\.|,|$)/i,
    /^([A-Za-zÀ-ÿ\s]{2,40})(?:\n|\.|,|$)/i,
  ];
  
  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match && match[1] && !match[1].toLowerCase().includes('calle') && !match[1].toLowerCase().includes('dirección')) {
      const nombre = clean(match[1]);
      if (nombre.length > 2 && nombre.length < 50) return nombre;
    }
  }
  return null;
}

function extraerDireccion(texto) {
  const msg = texto;
  
  const patterns = [
    /(?:dirección|direccion|ubicación|ubicacion|domicilio|calle|av\.?|avenida|casa|barrio)\s*:?\s*([A-Za-z0-9À-ÿ\s.,#\-ñÑ]{10,100})(?:\n|\.|,|$)/i,
    /([A-Za-z0-9À-ÿ\s.,#\-]{10,80})\s*(?:entre|y|esq\.?|esquina)/i,
    /(calle|av\.?|avenida|ruta)\s+[A-Za-z0-9À-ÿ\s.,#\-]{5,60}/i,
  ];
  
  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match && match[1]) {
      const direccion = clean(match[1]);
      if (direccion.length > 5 && !direccion.toLowerCase().includes('nombre')) return direccion;
    }
  }
  return null;
}

function extraerTelefono(texto) {
  const msg = texto;
  
  const patterns = [
    /(?:teléfono|telefono|celular|whatsapp|contacto|cel|tel)\s*:?\s*(\+?[\d\s\-]{8,20})/i,
    /(\+?59[5-9]?\d{8,12})/,
    /(0?9\d{8,9})/,
    /(\d{8,12})/,
  ];
  
  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match && match[1]) {
      let telefono = match[1].replace(/[\s\-]/g, '');
      if (telefono.length >= 8 && telefono.length <= 15) return telefono;
    }
  }
  return null;
}

function detectIntent(message, orderConfirmed) {
  const msg = normalize(message);
  
  const confirmKeywords = ['si', 'sí', 'confirmo', 'acepto', 'dale', 'ok', 'bueno'];
  const rescheduleKeywords = ['mañana', 'otro día', 'cambiar fecha', 'reprogramar', 'más tarde'];
  const cancelKeywords = ['cancelar', 'no quiero', 'anular', 'cancelación', 'baja'];
  const locationKeywords = ['no estoy en mi casa', 'no estoy en casa', 'fuera de casa', 'otra dirección'];
  const thanksKeywords = ['gracias', 'disculpe', 'perdón', 'gracias disculpe'];
  
  if (!orderConfirmed && confirmKeywords.some(k => msg.includes(k))) {
    return 'confirm';
  }
  
  if (rescheduleKeywords.some(k => msg.includes(k))) return 'reschedule';
  if (cancelKeywords.some(k => msg.includes(k))) return 'cancel';
  if (locationKeywords.some(k => msg.includes(k))) return 'location_changed';
  if (thanksKeywords.some(k => msg.includes(k))) return 'thanks';
  
  return 'unknown';
}

// ═══════════════════════════════════════════════════════════
// DETECCIÓN DE PRODUCTOS EN MENSAJES DE CLIENTES
// ═══════════════════════════════════════════════════════════

async function detectProductFromClientMessage(userId, from, clientMessage, lastBotMessage) {
  const msg = normalize(clientMessage);
  
  const buyPatterns = [
    /quiero\s+(\d+)/i,
    /quiero\s+(\d+)\s*unidades?/i,
    /comprar\s+(\d+)/i,
    /pedir\s+(\d+)/i,
    /llevo\s+(\d+)/i,
    /(\d+)\s+unidades?/i,
    /quiero\s+uno/i,
    /quiero\s+una/i,
    /dame\s+uno/i,
    /me\s+interesa/i,
    /quiero$/i,
  ];
  
  let quantity = 1;
  
  for (const pattern of buyPatterns) {
    const match = msg.match(pattern);
    if (match) {
      if (match[1] && !isNaN(parseInt(match[1]))) {
        quantity = parseInt(match[1]);
      }
      break;
    }
  }
  
  const isBuyIntent = msg.includes("quiero") || 
                      msg.includes("comprar") || 
                      msg.includes("pedir") || 
                      msg.includes("llevo") ||
                      msg.includes("dame") ||
                      msg.includes("me interesa");
  
  if (!isBuyIntent) {
    return { detected: false };
  }
  
  if (lastBotMessage) {
    const botMsg = lastBotMessage;
    
    const productPatterns = [
      /💥\s*([^*\n]{5,80})/i,
      /WILD\s+TORNADO[^\n]{0,50}/i,
      /DESTAPA\s+CAÑERIAS[^\n]{0,50}/i,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,5})/i,
    ];
    
    let productName = null;
    let productPrice = null;
    
    for (const pattern of productPatterns) {
      const match = botMsg.match(pattern);
      if (match && match[1]) {
        let candidate = clean(match[1]);
        if (candidate.length > 5 && candidate.length < 100 && 
            !candidate.includes("PEDIDO") && 
            !candidate.includes("CONFIRMADO")) {
          productName = candidate;
          break;
        }
      }
    }
    
    if (!productName) {
      if (botMsg.includes("WILD TORNADO")) {
        productName = "WILD TORNADO DESTAPA CAÑERÍAS";
      } else if (botMsg.includes("DESTAPA CAÑERÍAS")) {
        productName = "WILD TORNADO DESTAPA CAÑERÍAS";
      }
    }
    
    const pricePatterns = [
      /\$?(\d{2,6}(?:\.\d{3})*)\s*(?:GS|Gs|guaranies|G\.)/i,
      /PRECIO\s*PROMOCIONAL:\s*\$?(\d{2,6}(?:\.\d{3})*)/i,
      /(\d{2,6}(?:\.\d{3})*)\s*GS/i,
    ];
    
    for (const pattern of pricePatterns) {
      const match = botMsg.match(pattern);
      if (match && match[1]) {
        productPrice = parseInt(match[1].replace(/\./g, ''));
        break;
      }
    }
    
    if (productName) {
      console.log(`🛍️ Producto detectado: "${productName}" | Precio: ${productPrice} | Cantidad: ${quantity}`);
      return {
        product: productName,
        quantity: quantity,
        price: productPrice || 159900,
        detected: true
      };
    }
  }
  
  return { detected: false };
}

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

// ═══════════════════════════════════════════════════════════
// GOOGLE SHEETS
// ═══════════════════════════════════════════════════════════

async function enviarASheet(userId, order, nota = "") {
  try {
    const { data: config, error } = await supabase
      .from("whatsapp_config")
      .select("google_sheets_url")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.log("⚠️ Error leyendo google_sheets_url:", error.message || error);
      return false;
    }

    const url = clean(config?.google_sheets_url);
    if (!url) {
      console.log("ℹ️ google_sheets_url no configurada, se omite envío a Sheet");
      return false;
    }

    const payload = {
      customer_name: clean(order.customer_name),
      customer_phone: clean(order.phone || order.from_number),
      customer_city: clean(order.city),
      product: clean(order.product),
      quantity: order.quantity || 1,
      total_amount: order.total_amount || "",
      customer_address: clean(order.address),
      note: clean(nota),
      nombre_cliente: clean(order.customer_name),
      whatsapp: clean(order.phone || order.from_number),
      ciudad: clean(order.city),
      producto: clean(order.product),
      cantidad: order.quantity || 1,
      total_a_pagar: order.total_amount || "",
      calle: clean(order.address),
      nota: clean(nota),
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    if (!response.ok) {
      console.log("❌ Google Sheets error:", response.status, raw);
      return false;
    }

    console.log("✅ Pedido enviado a Google Sheets:", raw.slice(0, 200));
    return true;
  } catch (err) {
    console.log("❌ enviarASheet error:", err.message || err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// ENVÍO DE MENSAJES Y MEDIA A WHATSAPP
// ═══════════════════════════════════════════════════════════

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
    for (const parte of partes) {
      const response = await fetch(
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
      const raw = await response.text();
      if (!response.ok) {
        console.log("📤 Meta error:", response.status, raw);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error("❌ Error enviarMensaje:", err);
    return false;
  }
}

async function enviarMedia(userId, to, mediaUrl, mediaType = "image", caption = "") {
  try {
    const { data: config } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (!config?.phone_number_id || !config?.permanent_token || !mediaUrl) return false;

    const type = mediaType === "video" ? "video" : "image";
    const payload = {
      messaging_product: "whatsapp",
      to,
      type,
      [type]: caption ? { link: mediaUrl, caption } : { link: mediaUrl },
    };

    const response = await fetch(
      `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.permanent_token.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      console.log(`📤 Media error (${type}):`, await response.text());
      return false;
    }
    console.log(`✅ Media enviado: ${type} → ${mediaUrl.slice(0, 60)}...`);
    return true;
  } catch (err) {
    console.error("❌ enviarMedia error:", err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// DESCARGA MEDIA DE WHATSAPP Y LA SUBE A SUPABASE STORAGE
// ═══════════════════════════════════════════════════════════

async function descargarYSubirMedia({ userId, mediaId, mimeType, from }) {
  try {
    if (!mediaId) return null;

    const { data: config } = await supabase
      .from("whatsapp_config")
      .select("permanent_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (!config?.permanent_token) {
      console.log("❌ Sin token para descargar media");
      return null;
    }
    const token = config.permanent_token.trim();

    const metaRes = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      console.log("❌ Meta media URL error:", metaRes.status, await metaRes.text());
      return null;
    }
    const metaJson = await metaRes.json();
    const downloadUrl = metaJson.url;
    const realMime = metaJson.mime_type || mimeType || "application/octet-stream";
    if (!downloadUrl) {
      console.log("❌ Meta no devolvió url de descarga");
      return null;
    }

    const binRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!binRes.ok) {
      console.log("❌ Descarga binario error:", binRes.status);
      return null;
    }
    const arrayBuffer = await binRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const extMap = {
      "audio/ogg": "ogg",
      "audio/ogg; codecs=opus": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
      "audio/amr": "amr",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "video/mp4": "mp4",
      "video/3gpp": "3gp",
      "application/pdf": "pdf",
    };
    const baseMime = String(realMime).split(";")[0].trim().toLowerCase();
    const ext = extMap[baseMime] || extMap[realMime] || "bin";

    const path = `wa-incoming/${userId}/${from}/${Date.now()}-${mediaId}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("comprobantes")
      .upload(path, buffer, {
        contentType: baseMime,
        upsert: false,
      });

    if (upErr) {
      console.log("❌ Storage upload error:", upErr.message || upErr);
      return null;
    }

    const { data: pub } = supabase.storage.from("comprobantes").getPublicUrl(path);
    const publicUrl = pub?.publicUrl || null;
    console.log(`✅ Media subida: ${baseMime} → ${publicUrl}`);
    return { url: publicUrl, mime: baseMime };
  } catch (err) {
    console.error("❌ descargarYSubirMedia error:", err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// CONTEXTO E HISTORIAL
// ═══════════════════════════════════════════════════════════

async function getContexto(userId, from) {
  try {
    const { data } = await supabase
      .from("chat_context")
      .select("*")
      .eq("user_id", userId)
      .eq("from_number", from)
      .maybeSingle();
    return data || {};
  } catch {
    return {};
  }
}

async function saveContexto(userId, from, ctx = {}) {
  try {
    const payload = {
      user_id: userId,
      from_number: from,
      last_topic: ctx?.last_topic || null,
      last_trigger: ctx?.last_trigger || null,
      current_product: ctx?.current_product || null,
      step: ctx?.step || null,
      order_data: ctx?.order_data || {},
      updated_at: new Date().toISOString(),
    };
    await supabase.from("chat_context").upsert(payload, {
      onConflict: "user_id,from_number",
    });
  } catch (err) {
    console.error("❌ saveContexto error:", err);
  }
}

async function getHistory(userId, from) {
  try {
    const { data } = await supabase
      .from("inbox_messages")
      .select("message, created_at, message_type")
      .eq("user_id", userId)
      .eq("sender_id", from)
      .order("created_at", { ascending: false })
      .limit(14);
    return (data || [])
      .reverse()
      .map((m) => ({
        role: (m.message_type || "").startsWith("out_") ? "assistant" : "user",
        content: clean(m.message),
      }))
      .filter((m) => m.content);
  } catch {
    return [];
  }
}

async function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  try {
    const { data } = await supabase
      .from("inbox_messages")
      .select("id")
      .eq("wa_message_id", messageId)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

async function saveReceivedMessage({
  userId,
  from,
  message,
  messageType,
  mediaUrl = null,
  waMessageId = null,
}) {
  try {
    const isOutgoing = (messageType || "").startsWith("out_");
    const payload = {
      user_id: userId,
      source: "whatsapp",
      platform: "whatsapp",
      sender_id: from,
      sender_name: from,
      from_number: from,
      message,
      message_type: messageType || "text",
      media_url: mediaUrl ? (Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl]) : null,
      media_url_text: mediaUrl ? (Array.isArray(mediaUrl) ? mediaUrl[0] : mediaUrl) : null,
      is_read: !!isOutgoing,
      is_processed: !!isOutgoing,
      ...(waMessageId ? { wa_message_id: waMessageId } : {}),
    };
    const { data, error } = await supabase
      .from("inbox_messages")
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("❌ saveReceivedMessage error:", error);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error("❌ saveReceivedMessage error:", err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// PLANTILLAS
// ═══════════════════════════════════════════════════════════

function extraerMediosDePlantilla(plantilla) {
  const imagenes = [];
  let video = null;
  let gif = null;

  if (!plantilla) return { imagenes, video, gif };

  const m = plantilla.variables?.media;
  if (m && typeof m === "object") {
    if (Array.isArray(m.imageUrls)) {
      for (const u of m.imageUrls) if (u) imagenes.push(u);
    }
    if (m.videoUrl) video = m.videoUrl;
    if (m.gifUrl) gif = m.gifUrl;
  }

  if (Array.isArray(plantilla.media_urls)) {
    for (const u of plantilla.media_urls) {
      if (u && !imagenes.includes(u)) imagenes.push(u);
    }
  }

  if (imagenes.length === 0 && !video && !gif && plantilla.media_url) {
    if (plantilla.media_type === "video") video = plantilla.media_url;
    else if (plantilla.media_type === "gif") gif = plantilla.media_url;
    else imagenes.push(plantilla.media_url);
  }

  return { imagenes, video, gif };
}

async function enviarPlantillaCompleta({ userId, from, templateName, fallbackText }) {
  let plantilla = null;
  if (templateName && templateName !== "Ninguna") {
    const { data: tpl } = await supabase
      .from("templates")
      .select("*")
      .eq("user_id", userId)
      .eq("name", templateName)
      .maybeSingle();
    plantilla = tpl;
  }

  const mensajeFinal = clean(plantilla?.content || fallbackText || "");
  const { imagenes, video, gif } = extraerMediosDePlantilla(plantilla);
  console.log(
    `📦 Plantilla "${plantilla?.name || templateName}" → ${imagenes.length} img, video: ${!!video}, gif: ${!!gif}`
  );

  for (let i = 0; i < imagenes.length; i++) {
    const url = imagenes[i];
    const caption = i === 0 && mensajeFinal ? mensajeFinal : "";
    const ok = await enviarMedia(userId, from, url, "image", caption);
    if (ok) {
      await saveReceivedMessage({
        userId,
        from,
        message: caption || `[image] ${url}`,
        messageType: "out_image",
        mediaUrl: url,
      });
    }
  }

  if (imagenes.length === 0 && mensajeFinal) {
    const sent = await enviarMensaje(userId, from, mensajeFinal);
    if (sent) {
      await saveReceivedMessage({
        userId,
        from,
        message: mensajeFinal,
        messageType: "out_text",
      });
    }
  }

  if (video) {
    const ok = await enviarMedia(userId, from, video, "video", "");
    if (ok) {
      await saveReceivedMessage({
        userId,
        from,
        message: `[video] ${video}`,
        messageType: "out_video",
        mediaUrl: video,
      });
    }
  }

  if (gif) {
    const ok = await enviarMedia(userId, from, gif, "image", "");
    if (ok) {
      await saveReceivedMessage({
        userId,
        from,
        message: `[gif] ${gif}`,
        messageType: "out_gif",
        mediaUrl: gif,
      });
    }
  }

  if (plantilla?.id) {
    try {
      await supabase
        .from("templates")
        .update({ usage_count: (plantilla.usage_count || 0) + 1 })
        .eq("id", plantilla.id);
    } catch {}
  }

  return plantilla;
}

// ═══════════════════════════════════════════════════════════
// AUTO-TAGS Y DISPARADORES
// ═══════════════════════════════════════════════════════════

async function aplicarAutoTag(userId, contactId, tagName) {
  if (!tagName) return;
  try {
    const { data: tag } = await supabase
      .from("tags")
      .select("id")
      .eq("user_id", userId)
      .eq("name", tagName)
      .maybeSingle();
    if (!tag) {
      console.log(`⚠️ auto_tag: no existe etiqueta "${tagName}" en tabla tags`);
      return;
    }
    await supabase
      .from("contact_tags")
      .upsert(
        { contact_id: contactId, tag_id: tag.id, user_id: userId },
        { onConflict: "contact_id,tag_id,user_id" }
      );
    console.log(`🏷️ auto_tag aplicado: "${tagName}" → ${contactId}`);
  } catch (e) {
    console.log("⚠️ aplicarAutoTag error:", e.message);
  }
}

function matchKeywords(condicion, tipo, textoNorm) {
  if (!condicion) return false;
  const cond = normalize(condicion);
  if (!cond) return false;
  const t = (tipo || "").toLowerCase();
  if (t === "exact" || t.includes("exacto")) return textoNorm === cond;
  return textoNorm.includes(cond);
}

function matchSecundario(secundario, textoNorm) {
  if (!secundario?.enabled) return false;
  const valores = Array.isArray(secundario.conditionValues) ? secundario.conditionValues : [];
  if (valores.length === 0) return false;
  const tipo = secundario.conditionType === "exact" ? "exact" : "keyword";
  return valores.some((v) => matchKeywords(v, tipo, textoNorm));
}

async function evaluarDisparadores({ userId, from, texto }) {
  try {
    const { data: triggers, error } = await supabase
      .from("triggers")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true);

    if (error) {
      console.log("❌ Error leyendo triggers:", error);
      return false;
    }
    if (!triggers || triggers.length === 0) return false;

    const textoNorm = normalize(texto);
    const ctx = await getContexto(userId, from);
    const lastTrigger = ctx?.last_trigger || null;

    const triggersOrdenados = [...triggers].sort((a, b) => {
      if (a.name === lastTrigger) return -1;
      if (b.name === lastTrigger) return 1;
      return 0;
    });

    for (const trig of triggersOrdenados) {
      const matchPrimary = matchKeywords(trig.condition, trig.type, textoNorm);
      const secundarioPermitido = matchPrimary || lastTrigger === trig.name;
      const matchSecondary =
        secundarioPermitido && matchSecundario(trig.secondary, textoNorm);

      if (!matchPrimary && !matchSecondary) continue;

      console.log(
        `🎯 Disparador MATCH: "${trig.name}" → primary=${matchPrimary} secondary=${matchSecondary} (lastTrigger=${lastTrigger})`
      );

      if (trig.no_repeat) {
        const { data: yaEnviado } = await supabase
          .from("inbox_messages")
          .select("id")
          .eq("user_id", userId)
          .eq("sender_id", from)
          .eq("message_type", "out_text")
          .ilike("message", `%${trig.template || trig.name}%`)
          .limit(1)
          .maybeSingle();
        if (yaEnviado) {
          console.log("⏭️ no_repeat: ya se envió antes");
          continue;
        }
      }

      if (trig.send_limit && trig.send_limit !== "" && trig.send_limit !== "∞") {
        const limite = parseInt(trig.send_limit, 10);
        if (!isNaN(limite) && limite > 0) {
          const { count } = await supabase
            .from("trigger_log")
            .select("*", { count: "exact", head: true })
            .eq("trigger_id", trig.id);
          if ((count || 0) >= limite) {
            console.log("⏭️ send_limit alcanzado");
            continue;
          }
        }
      }

      let plantillaPrimary = null;
      let contenidoPrimary = "";
      let contenidoSecondary = "";

      if (matchPrimary) {
        plantillaPrimary = await enviarPlantillaCompleta({
          userId,
          from,
          templateName: trig.template,
          fallbackText: trig.response,
        });
        contenidoPrimary = clean(plantillaPrimary?.content || trig.response || "");

        if (trig.auto_tag) {
          await aplicarAutoTag(userId, from, trig.auto_tag);
        }
      }

      if (matchSecondary) {
        if (matchPrimary) {
          console.log("⏳ Esperando 5s antes del secundario...");
          await sleep(5000);
        }
        const plantillaSec = await enviarPlantillaCompleta({
          userId,
          from,
          templateName: trig.secondary?.template,
          fallbackText: trig.secondary?.response,
        });
        contenidoSecondary = clean(plantillaSec?.content || trig.secondary?.response || "");
      }

      try {
        await supabase.from("trigger_log").insert({
          trigger_id: trig.id,
          user_id: userId,
          from_number: from,
          sent_at: new Date().toISOString(),
        });
      } catch {}

      await saveContexto(userId, from, { ...ctx, last_trigger: trig.name });
      return true;
    }

    return false;
  } catch (err) {
    console.error("❌ evaluarDisparadores error:", err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// LLAMADA A CHAT-IA
// ═══════════════════════════════════════════════════════════

async function llamarChatIA({
  req,
  userId,
  texto,
  from,
  ctx,
  history,
  mediaUrl = null,
  mediaType = null,
  mimeType = null,
}) {
  const host = req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  if (!host) throw new Error("No se detectó host");

  const url = `${protocol}://${host}/api/chat-ia`;
  const resIA = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      message: texto,
      from_number: from,
      context: ctx || {},
      history: history || [],
      media_url: mediaUrl,
      media_type: mediaType,
      mime_type: mimeType,
    }),
  });
  const raw = await resIA.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("chat-ia no devolvió JSON");
  }
  if (!resIA.ok) throw new Error(data?.error || `chat-ia error ${resIA.status}`);
  return data;
}

// ═══════════════════════════════════════════════════════════
// DETECTOR DE PEDIDOS CONFIRMADOS
// ═══════════════════════════════════════════════════════════

function esMensajePedidoConfirmado(texto) {
  const t = clean(texto);
  const tieneMarcador = /✅\s*PEDIDO CONFIRMADO/i.test(t);
  const tieneProducto = /Producto:\s*\S/i.test(t);
  const tieneTotal = /Total:\s*\S/i.test(t);
  return tieneMarcador && tieneProducto && tieneTotal;
}

async function detectarYGuardarPedidoConfirmado({
  userId,
  from,
  textoMensaje,
  sourceMessageId,
}) {
  try {
    console.log(`📦 Guardando pedido confirmado para ${from}`);
    // Aquí iría la lógica para guardar el pedido en la tabla orders
    // Por ahora solo logueamos
    console.log(`✅ Pedido confirmado: ${textoMensaje.substring(0, 200)}`);
  } catch (err) {
    console.error("❌ detectarYGuardarPedidoConfirmado error:", err);
  }
}

async function asociarComprobanteAlPedido({ userId, from, mediaUrl }) {
  try {
    if (!mediaUrl) return;
    console.log(`💳 Comprobante recibido: ${mediaUrl}`);
  } catch (err) {
    console.error("❌ asociarComprobanteAlPedido error:", err);
  }
}

// ═══════════════════════════════════════════════════════════
// PROCESAR MENSAJE ENTRANTE - FLUJO CORRECTO
// ═══════════════════════════════════════════════════════════

export async function procesar(req, message, userId, from) {
  try {
    const tipoMsg = message.type;

    let texto = "";
    let mediaUrl = null;
    let messageType = "text";
    let mediaId = null;
    let mimeType = null;

    if (tipoMsg === "text") {
      texto = clean(message.text?.body || "");
      messageType = "text";
    } else if (tipoMsg === "image") {
      texto = clean(message.image?.caption || "");
      mediaId = message.image?.id || null;
      mimeType = message.image?.mime_type || "image/jpeg";
      messageType = "image";
    } else if (tipoMsg === "audio" || tipoMsg === "voice") {
      texto = "";
      mediaId = message.audio?.id || message.voice?.id || null;
      mimeType = message.audio?.mime_type || message.voice?.mime_type || "audio/ogg";
      messageType = "audio";
    } else if (tipoMsg === "video") {
      texto = clean(message.video?.caption || "[video]");
      mediaId = message.video?.id || null;
      mimeType = message.video?.mime_type || "video/mp4";
      messageType = "video";
    } else {
      console.log(`⚠️ Tipo de mensaje no soportado: ${tipoMsg}`);
      return { response: null, error: "Tipo no soportado" };
    }

    if (await isDuplicateMessage(message.id)) {
      console.log("⚠️ Duplicado ignorado");
      return { response: null, error: "Duplicado" };
    }

    let mediaMime = mimeType;
    if (mediaId) {
      const result = await descargarYSubirMedia({ userId, mediaId, mimeType, from });
      if (result) {
        mediaUrl = result.url;
        mediaMime = result.mime || mimeType;
      }
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`📩 WhatsApp ${messageType}:`, from, texto);

    await saveReceivedMessage({
      userId,
      from,
      message: texto || `[${messageType}]`,
      messageType,
      mediaUrl,
      waMessageId: message.id || null,
    });

    // Solo procesar texto
    if (messageType !== "text") {
      return { response: null, handled_by: "non_text" };
    }

    const chatState = getConversationState(from);
    const intent = detectIntent(texto, chatState.orderConfirmed);
    
    console.log(`🎯 Intención: ${intent} | Confirmado: ${chatState.orderConfirmed} | Step: ${chatState.orderData?.step}`);

    // ═══════════════════════════════════════════════════════════════
    // MANEJO DE INTENCIONES BÁSICAS
    // ═══════════════════════════════════════════════════════════════

    if (intent === 'reschedule') {
      const msg = "📅 Entiendo que querés cambiar la fecha de entrega. Decime ¿para cuándo preferís recibir tu pedido?";
      await enviarMensaje(userId, from, msg);
      await saveReceivedMessage({ userId, from, message: msg, messageType: "out_text" });
      return { response: msg, handled_by: "reschedule" };
    }

    if (intent === 'cancel') {
      const msg = "❌ ¿Querés cancelar tu pedido? Respondé *CONFIRMAR CANCELACIÓN* para anularlo.";
      await enviarMensaje(userId, from, msg);
      await saveReceivedMessage({ userId, from, message: msg, messageType: "out_text" });
      return { response: msg, handled_by: "cancel" };
    }

    if (intent === 'location_changed') {
      const msg = "📍 Entiendo que no estás en tu domicilio. Pasame la nueva dirección.";
      await enviarMensaje(userId, from, msg);
      await saveReceivedMessage({ userId, from, message: msg, messageType: "out_text" });
      return { response: msg, handled_by: "location" };
    }

    if (intent === 'thanks') {
      const msg = "¡A vos! Gracias por confiar en Mega Todo Store 💜 ¿Necesitas algo más?";
      await enviarMensaje(userId, from, msg);
      await saveReceivedMessage({ userId, from, message: msg, messageType: "out_text" });
      return { response: msg, handled_by: "thanks" };
    }

    // ═══════════════════════════════════════════════════════════════
    // FLUJO: ESPERANDO CONFIRMACIÓN FINAL
    // ═══════════════════════════════════════════════════════════════

    if (chatState.orderData?.step === 'awaiting_final_confirmation' && !chatState.orderConfirmed) {
      const finalMsg = normalize(texto);
      if (finalMsg.includes('si') || finalMsg.includes('sí') || finalMsg.includes('confirmo')) {
        updateConversationState(from, { orderConfirmed: true, orderData: { ...chatState.orderData, step: 'confirmed' } });
        
        const confirmMsg = `✅ *¡PEDIDO CONFIRMADO!* ✅

✅ Producto: ${chatState.orderData.product}
✅ Cliente: ${chatState.orderData.customer_name}
✅ Cantidad: ${chatState.orderData.quantity} u.
💰 Total: ${chatState.orderData.total_amount.toLocaleString('es')} Gs

📍 *Dirección de entrega:* ${chatState.orderData.address}
📞 *Contacto:* ${chatState.orderData.phone}

🚚 **ENVÍO GRATIS** · **Pagás al recibir**

📦 Tu pedido queda agendado. El delivery se comunicará contigo.

¡Gracias por elegir Mega Todo Store! 💜✨`;

        await enviarMensaje(userId, from, confirmMsg);
        await saveReceivedMessage({ userId, from, message: confirmMsg, messageType: "out_text" });
        
        await detectarYGuardarPedidoConfirmado({
          userId, from, textoMensaje: confirmMsg, sourceMessageId: null
        });
        
        return { response: confirmMsg, handled_by: "final_confirmation" };
      } else if (finalMsg.includes('no') || finalMsg.includes('cancelar')) {
        updateConversationState(from, { orderData: { step: null } });
        const msg = "❌ Pedido cancelado. Si necesitas algo más, escribinos. ¡Gracias!";
        await enviarMensaje(userId, from, msg);
        await saveReceivedMessage({ userId, from, message: msg, messageType: "out_text" });
        return { response: msg, handled_by: "order_cancelled" };
      } else {
        const msg = "¿Confirmas tu pedido? Responde *SÍ* para confirmar o *NO* para cancelar.";
        await enviarMensaje(userId, from, msg);
        await saveReceivedMessage({ userId, from, message: msg, messageType: "out_text" });
        return { response: msg, handled_by: "ask_confirmation" };
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // FLUJO: ESPERANDO DATOS DEL CLIENTE
    // ═══════════════════════════════════════════════════════════════

    if (chatState.orderData?.step === 'awaiting_customer_data' && !chatState.orderConfirmed) {
      const customerName = extraerNombre(texto);
      const customerAddress = extraerDireccion(texto);
      const customerPhone = extraerTelefono(texto) || from;
      
      if (customerName && customerAddress) {
        const orderData = chatState.orderData;
        const confirmMsg = `✅ *RESUMEN DE TU PEDIDO* ✅

✅ Producto: ${orderData.product}
✅ Cliente: ${customerName}
✅ Cantidad: ${orderData.quantity} u.
💰 Total: ${orderData.total_amount.toLocaleString('es')} Gs

📍 *Dirección de entrega:* ${customerAddress}
📞 *Contacto:* ${customerPhone}

🚚 **ENVÍO GRATIS** · **Pagás al recibir**

¿Confirmas este pedido? Responde *SÍ* para finalizar o *NO* para cancelar.`;

        await enviarMensaje(userId, from, confirmMsg);
        await saveReceivedMessage({ userId, from, message: confirmMsg, messageType: "out_text" });
        
        updateConversationState(from, { 
          orderData: {
            ...orderData,
            customer_name: customerName,
            address: customerAddress,
            phone: customerPhone,
            step: 'awaiting_final_confirmation'
          }
        });
        
        return { response: confirmMsg, handled_by: "customer_data_received" };
      } else {
        let missingDataMsg = "📋 *Para completar tu pedido necesito:*\n\n";
        if (!customerName) missingDataMsg += "❓ Tu *nombre completo*\n";
        if (!customerAddress) missingDataMsg += "❓ Tu *dirección de entrega* (calle, número, barrio)\n";
        if (!customerPhone) missingDataMsg += "❓ Tu *teléfono de contacto*\n";
        missingDataMsg += "\n✅ *Ejemplo:* Juan Pérez | Av. España 123, Asunción | 0981123456";
        
        await enviarMensaje(userId, from, missingDataMsg);
        await saveReceivedMessage({ userId, from, message: missingDataMsg, messageType: "out_text" });
        
        return { response: missingDataMsg, handled_by: "missing_data" };
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // DETECCIÓN DE PRODUCTO - PEDIR DATOS
    // ═══════════════════════════════════════════════════════════════

    const { data: lastOutboundMsg } = await supabase
      .from("inbox_messages")
      .select("message")
      .eq("user_id", userId)
      .eq("sender_id", from)
      .eq("source", "whatsapp")
      .like("message_type", "out_%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    const productDetection = await detectProductFromClientMessage(
      userId, from, texto, lastOutboundMsg?.message || ""
    );
    
    if (productDetection.detected && !chatState.orderConfirmed && chatState.orderData?.step !== 'awaiting_customer_data') {
      const totalPrice = productDetection.price * productDetection.quantity;
      console.log(`🛍️ Producto solicitado: ${productDetection.product} x${productDetection.quantity} - ${totalPrice.toLocaleString('es')} GS`);
      
      updateConversationState(from, { 
        orderData: {
          product: productDetection.product,
          quantity: productDetection.quantity,
          unit_price: productDetection.price,
          total_amount: totalPrice,
          step: 'awaiting_customer_data'
        }
      });
      
      const askDataMsg = `🛍️ *¡Gracias por tu interés!* 🛍️

Producto: *${productDetection.product}*
Cantidad: *${productDetection.quantity}* u.
Precio unitario: *${productDetection.price.toLocaleString('es')} GS*
Total: *${totalPrice.toLocaleString('es')} GS*

Para agendar tu pedido, necesito tus datos:

📝 *Nombre completo:*
📍 *Dirección de entrega:* (calle, número, barrio)
📞 *Teléfono de contacto:*

¡Respondé con tus datos y confirmamos tu pedido! 💜`;

      await enviarMensaje(userId, from, askDataMsg);
      await saveReceivedMessage({ userId, from, message: askDataMsg, messageType: "out_text" });
      
      return { response: askDataMsg, handled_by: "product_request", awaiting_data: true };
    }

    // ═══════════════════════════════════════════════════════════════
    // SI YA ESTÁ CONFIRMADO
    // ═══════════════════════════════════════════════════════════════

    if (chatState.orderConfirmed) {
      const msg = "✅ Tu pedido ya está confirmado. ¿Necesitas modificar algo? Responde: CAMBIAR FECHA, CAMBIAR UBICACIÓN o CANCELAR.";
      await enviarMensaje(userId, from, msg);
      await saveReceivedMessage({ userId, from, message: msg, messageType: "out_text" });
      return { response: msg, handled_by: "already_confirmed" };
    }

    // ═══════════════════════════════════════════════════════════════
    // TRIGGERS Y IA
    // ═══════════════════════════════════════════════════════════════

    const disparado = await evaluarDisparadores({ userId, from, texto });
    if (disparado) {
      console.log("✅ Disparador atendió el mensaje");
      return { response: null, handled_by: "trigger" };
    }

    const ctx = await getContexto(userId, from);
    const history = await getHistory(userId, from);

    let data = {};
    try {
      data = await llamarChatIA({ req, userId, texto, from, ctx, history });
    } catch (err) {
      console.error("❌ chat-ia error:", err);
      const fallbackMsg = "⚠️ Disculpá, hubo un error. Escribime nuevamente.";
      await enviarMensaje(userId, from, fallbackMsg);
      return { response: fallbackMsg, error: err.message };
    }

    if (data?.context) await saveContexto(userId, from, data.context);

    if (data?.response) {
      await enviarMensaje(userId, from, data.response);
      await saveReceivedMessage({ userId, from, message: data.response, messageType: "out_text" });
      return { response: data.response, context: data.context };
    }

    const fallback = "👋 Hola! ¿En qué puedo ayudarte?\n\n📋 Catálogo:\nhttps://cat-logomegatodo-com.vercel.app/";
    await enviarMensaje(userId, from, fallback);
    await saveReceivedMessage({ userId, from, message: fallback, messageType: "out_text" });
    return { response: fallback };

  } catch (err) {
    console.error("❌ procesar error:", err);
    return { response: null, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN)
      return res.status(200).send(challenge);
    return res.status(403).send("Token inválido");
  }

  if (req.method === "POST") {
    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account")
        return res.status(404).send("Not WhatsApp");

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
            console.log("❌ No user_id para phoneId:", phoneId);
            continue;
          }

          for (const msg of value.messages || []) {
            await procesar(req, msg, config.user_id, msg.from);
          }
        }
      }
      return res.status(200).send("EVENT_RECEIVED");
    } catch (e) {
      console.error("❌ webhook error:", e);
      return res.status(500).json({ error: "Error interno" });
    }
  }

  return res.status(405).send("Method Not Allowed");
}
