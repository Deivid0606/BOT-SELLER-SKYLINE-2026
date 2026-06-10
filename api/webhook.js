// api/webhook.js — webhook_v17.js (CON PRECIOS DINÁMICOS)
// WhatsApp Cloud API → Triggers → Gemini (texto + imagen + audio)
// + ✅ Precios obtenidos de: trigger/plantilla (primero) o full_training (segundo)
// + ✅ Sin precios hardcodeados
// + ✅ Detección correcta de "Destapa Cañerías" (prioridad alta)
// + ✅ Flujo de ventas local completo

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = "miTokenSeguro2026";

const clean = (t) => String(t || "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normalize = (t) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// ═══════════════════════════════════════════════════════════
// EXTRACCIÓN DE PRECIO DESDE TEXTO
// ═══════════════════════════════════════════════════════════

function extraerPrecioDesdeTexto(texto = "") {
  if (!texto) return null;
  
  const patterns = [
    /PRECIO(?:\s+PROMOCIONAL)?:\s*([\d.,]+)\s*GS/i,
    /Precio:\s*([\d.,]+)\s*GS/i,
    /💰\s*([\d.,]+)\s*GS/i,
    /([\d.,]+)\s*GS/i,
    /Gs\.\s*([\d.,]+)/i,
    /₲\s*([\d.,]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = texto.match(pattern);
    if (match) {
      const precioStr = match[1].replace(/\./g, '').replace(/,/g, '');
      const precio = parseInt(precioStr, 10);
      if (!isNaN(precio) && precio > 0) {
        console.log(`💰 Precio detectado en texto: ${precio} GS`);
        return precio;
      }
    }
  }
  return null;
}

async function obtenerPrecioProducto(userId, productName, textoReferencia = "") {
  if (textoReferencia) {
    const precio = extraerPrecioDesdeTexto(textoReferencia);
    if (precio) return precio;
  }
  
  try {
    const { data: config } = await supabase
      .from("whatsapp_config")
      .select("full_training")
      .eq("user_id", userId)
      .maybeSingle();
    
    const fullTraining = config?.full_training;
    if (fullTraining?.products && Array.isArray(fullTraining.products)) {
      const productNorm = normalize(productName);
      for (const product of fullTraining.products) {
        const nameNorm = normalize(product.name);
        if (nameNorm.includes(productNorm) || productNorm.includes(nameNorm)) {
          if (product.price) {
            console.log(`💰 Precio desde full_training: ${product.price} GS para ${product.name}`);
            return product.price;
          }
        }
        if (product.keywords && Array.isArray(product.keywords)) {
          for (const kw of product.keywords) {
            if (productNorm.includes(normalize(kw))) {
              if (product.price) return product.price;
            }
          }
        }
      }
    }
  } catch (err) {
    console.log("⚠️ Error buscando precio en full_training:", err.message);
  }
  
  console.log(`⚠️ No se encontró precio para: ${productName}`);
  return null;
}

// ═══════════════════════════════════════════════════════════
// CIUDADES PARAGUAY Y EXTRACCIÓN
// ═══════════════════════════════════════════════════════════

const CIUDADES_PARAGUAY = [
  "asuncion", "asunción", "san lorenzo", "fernando de la mora", "lambaré",
  "luque", "capiatá", "limpio", "Ñemby", "villa elisa", "san antonio",
  "mariano roque alonso", "itaugua", "ypane", "ypacarai", "aregua",
  "pirayu", "villeta", "ita", "guarambare", "encarnación", "ciudad del este",
  "hernandarias", "presidente franco", "minga guazú", "pedro juan caballero",
  "concepción", "coronel oviedo", "caaguazú", "villarrica", "caazapá", "pilar"
];

function extractCityFromText(texto = "") {
  const t = normalize(texto);
  
  const patterns = [
    /(?:soy de|vivo en|de|en|desde)\s+([a-záéíóúñ\s]+)/i,
    /^([a-záéíóúñ\s]{3,30})$/i,
  ];

  for (const pattern of patterns) {
    const match = t.match(pattern);
    if (match) {
      const candidate = normalize(match[1]);
      for (const ciudad of CIUDADES_PARAGUAY) {
        if (normalize(ciudad).includes(candidate) || candidate.includes(normalize(ciudad))) {
          return ciudad;
        }
      }
    }
  }
  return null;
}

function getTipoCobertura(city) {
  const ciudadesConCobertura = [
    "asuncion", "asunción", "fernando de la mora", "san lorenzo", 
    "lambaré", "luque", "capiatá", "limpio", "Ñemby", "villa elisa"
  ];
  const cityNorm = normalize(city);
  const tieneCobertura = ciudadesConCobertura.some(c => normalize(c) === cityNorm);
  return tieneCobertura ? "envio_propio" : "envio_compartido";
}

// ═══════════════════════════════════════════════════════════
// DETECTOR DE PRODUCTOS DESDE TEXTO (CORREGIDO)
// ═══════════════════════════════════════════════════════════

function detectarProductoDesdeTexto(texto = "") {
  const t = normalize(texto);
  
  // PRIORIDAD ALTA: Destapa Cañerías (detectar primero para no confundir con "veneno")
  if (t.includes("destapa") || t.includes("cañeria") || t.includes("cañería") || 
      t.includes("tornado") || (t.includes("wild") && t.includes("tornado")) ||
      t.includes("desagüe") || t.includes("tuberia") || t.includes("tubería")) {
    return "Destapa Cañerías Tornado";
  }
  
  if (t.includes("limpiador") || t.includes("carbonilla") || t.includes("oven cleaner")) {
    return "Limpiador de Ollas y Carbonilla";
  }

  if (t.includes("perfume asad") || t.includes(" asad") || t === "asad") {
    return "Perfume Asad";
  }

  if ((t.includes("veneno") || t.includes("abeja")) && !t.includes("destapa")) {
    return "Crema de Veneno de Abeja";
  }

  if (t.includes("peladora") || t.includes("pela papas")) {
    return "Peladora Automática";
  }

  if (t.includes("tabla") && (t.includes("picar") || t.includes("marmol"))) {
    return "Tabla de Picar de Mármol";
  }

  return "";
}

// ═══════════════════════════════════════════════════════════
// BUILDERS DE RESPUESTAS LOCALES
// ═══════════════════════════════════════════════════════════

function buildCityQuestionResponse(product) {
  return `✅ Producto: ${product}\n\n📍 ¿A qué ciudad querés recibir tu pedido?\n\n📝 Ejemplos:\n• Asunción\n• San Lorenzo\n• Fernando de la Mora\n• Lambaré`;
}

function buildQuantityAfterCityResponse(product, city) {
  const cobertura = getTipoCobertura(city);
  let coberturaText = "";
  
  if (cobertura === "envio_propio") {
    coberturaText = "✅ ¡Genial! Tenemos delivery propio en tu zona. El costo es de 15.000 Gs.";
  } else {
    coberturaText = "📦 Para tu ciudad, coordinamos con servicio de encomienda. El costo de envío se confirma al momento.";
  }
  
  return `📍 Ciudad: ${city}\n\n${coberturaText}\n\n🔢 ¿Cuántas unidades querés llevar?\n\n📝 Ejemplo: "Quiero 2" o "2 unidades"`;
}

function buildOrderSummary(order, totalAmount, precioUnitario) {
  const items = order.items || [{ name: order.product, qty: order.quantity || 1 }];
  const itemsList = items.map((i) => `• ${i.name} x${i.qty}`).join("\n");
  
  let totalText = "";
  if (totalAmount && totalAmount > 0) {
    totalText = `💰 *Total:* ${totalAmount.toLocaleString()} Gs`;
  } else if (precioUnitario) {
    totalText = `💰 *Precio unitario:* ${precioUnitario.toLocaleString()} Gs`;
  }
  
  return `✅ *PEDIDO CONFIRMADO*\n\n📦 *Producto:*\n${itemsList}\n\n👤 *Cliente:* ${order.customer_name || "—"}\n📍 *Ubicación:* ${order.city || "—"} ${order.address ? `— ${order.address}` : ""}\n📞 *Contacto:* ${order.phone || "—"}\n🔢 *Cantidad total:* ${items.reduce((s, i) => s + i.qty, 0)}\n${totalText}\n\n✅ ¿Todo correcto? Envíanos el comprobante de pago para confirmar tu pedido.`;
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
      last_user_product: ctx?.last_user_product || ctx?.current_product || null,
      tipo_cobertura: ctx?.tipo_cobertura || null,
      updated_at: new Date().toISOString(),
    };
    await supabase.from("chat_context").upsert(payload, {
      onConflict: "user_id,from_number",
    });
  } catch (err) {
    console.error("❌ saveContexto error:", err);
  }
}

function isContextoVencido(ctx) {
  if (!ctx?.updated_at) return false;
  const updatedAt = new Date(ctx.updated_at).getTime();
  if (!updatedAt) return false;
  return Date.now() - updatedAt > 24 * 60 * 60 * 1000;
}

async function limpiarContextoVencido(userId, from, ctx) {
  if (!isContextoVencido(ctx)) return ctx || {};

  await supabase
    .from("chat_context")
    .delete()
    .eq("user_id", userId)
    .eq("from_number", from);

  return {};
}

async function getHistory(userId, from) {
  try {
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase
      .from("inbox_messages")
      .select("message, created_at, message_type")
      .eq("user_id", userId)
      .eq("sender_id", from)
      .gte("created_at", hace24h)
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

  return { plantilla, mensajeFinal };
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
      let precioDetectado = null;

      if (matchPrimary) {
        const result = await enviarPlantillaCompleta({
          userId,
          from,
          templateName: trig.template,
          fallbackText: trig.response,
        });
        plantillaPrimary = result.plantilla;
        contenidoPrimary = clean(result.mensajeFinal || trig.response || "");
        
        precioDetectado = extraerPrecioDesdeTexto(contenidoPrimary);

        if (trig.auto_tag) {
          await aplicarAutoTag(userId, from, trig.auto_tag);
        }
      }

      if (matchSecondary) {
        if (matchPrimary) {
          console.log("⏳ Esperando 5s antes del secundario...");
          await sleep(5000);
        }
        const result = await enviarPlantillaCompleta({
          userId,
          from,
          templateName: trig.secondary?.template,
          fallbackText: trig.secondary?.response,
        });
        contenidoSecondary = clean(result.mensajeFinal || trig.secondary?.response || "");
        
        if (!precioDetectado) {
          precioDetectado = extraerPrecioDesdeTexto(contenidoSecondary);
        }
      }

      try {
        await supabase.from("trigger_log").insert({
          trigger_id: trig.id,
          user_id: userId,
          from_number: from,
          sent_at: new Date().toISOString(),
        });
      } catch {}

      try {
        const contenidosEnviados = [contenidoPrimary, contenidoSecondary].filter(Boolean);
        for (const contenido of contenidosEnviados) {
          if (esMensajePedidoConfirmado(contenido)) {
            await detectarYGuardarPedidoConfirmado({
              userId,
              from,
              textoMensaje: contenido,
              sourceMessageId: null,
            });
          }
        }
      } catch (e) {
        console.log("⚠️ post-trigger pedido check error:", e.message);
      }

      const productoDetectado =
        detectarProductoDesdeTexto(texto) ||
        detectarProductoDesdeTexto(contenidoPrimary) ||
        detectarProductoDesdeTexto(contenidoSecondary) ||
        detectarProductoDesdeTexto(trig.name) ||
        detectarProductoDesdeTexto(trig.template);

      const nuevoCtx = {
        ...ctx,
        last_trigger: trig.name,
      };

      if (productoDetectado) {
        nuevoCtx.current_product = productoDetectado;
        nuevoCtx.last_topic = productoDetectado;
        nuevoCtx.step = "selling";
        nuevoCtx.order_data = {
          product: productoDetectado,
          quantity: 0,
          city: "",
          customer_name: "",
          phone: "",
          address: "",
          items: [],
          total_amount: 0,
          precio_unitario: precioDetectado,
        };
        console.log(`🛍️ Producto detectado en trigger: "${productoDetectado}" → contexto actualizado, precio: ${precioDetectado || "no detectado"}`);
      }

      await saveContexto(userId, from, nuevoCtx);
      return true;
    }

    return false;
  } catch (err) {
    console.error("❌ evaluarDisparadores error:", err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// LLAMADA A CHAT-IA (con fallback local)
// ═══════════════════════════════════════════════════════════

async function llamarChatIAConFallback({
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
  // PRIMERO: Intentar manejar localmente si es un mensaje de texto con flujo de ventas
  if (!mediaUrl && texto) {
    const currentProduct = ctx?.current_product || null;
    const previousStep = ctx?.step || null;
    const oldOrder = ctx?.order_data || {};
    const precioUnitarioGuardado = oldOrder?.precio_unitario || null;
    
    // A. "quiero X" con producto activo
    const qFromBuy = texto.match(/^\s*(quiero|llevo|dame|mandame|compro)\s+(\d{1,3})\s*$/i);
    
    if (qFromBuy && currentProduct) {
      const cantidad = Number(qFromBuy[2]);
      const order = { ...oldOrder, product: currentProduct, quantity: cantidad };
      
      if (!order.city) {
        const response = buildCityQuestionResponse(currentProduct);
        await enviarMensaje(userId, from, response);
        await saveReceivedMessage({ userId, from, message: response, messageType: "out_text" });
        await saveContexto(userId, from, {
          ...ctx,
          step: "collecting_city",
          current_product: currentProduct,
          order_data: order,
          updated_at: new Date().toISOString(),
        });
        return { response, handled_by: "local_flow" };
      }
      
      let precioUnitario = precioUnitarioGuardado;
      if (!precioUnitario) {
        precioUnitario = await obtenerPrecioProducto(userId, currentProduct, "");
      }
      
      const totalAmount = precioUnitario ? precioUnitario * cantidad : null;
      const response = buildOrderSummary({ ...order, city: order.city, quantity: cantidad }, totalAmount, precioUnitario);
      await enviarMensaje(userId, from, response);
      await saveReceivedMessage({ userId, from, message: response, messageType: "out_text" });
      await saveContexto(userId, from, {
        ...ctx,
        step: "awaiting_payment",
        order_data: { ...order, quantity: cantidad, items: [{ name: currentProduct, qty: cantidad }], precio_unitario: precioUnitario },
        updated_at: new Date().toISOString(),
      });
      return { response, handled_by: "local_flow" };
    }
    
    // B. Esperando ciudad
    if (previousStep === "collecting_city" && currentProduct) {
      const city = extractCityFromText(texto);
      if (city) {
        const order = { ...oldOrder, product: currentProduct, city, quantity: oldOrder?.quantity || 0 };
        const response = buildQuantityAfterCityResponse(currentProduct, city);
        await enviarMensaje(userId, from, response);
        await saveReceivedMessage({ userId, from, message: response, messageType: "out_text" });
        await saveContexto(userId, from, {
          ...ctx,
          step: "collecting_quantity",
          current_product: currentProduct,
          tipo_cobertura: getTipoCobertura(city),
          order_data: order,
          updated_at: new Date().toISOString(),
        });
        return { response, handled_by: "local_flow" };
      } else {
        const response = "📍 No entendí la ciudad. ¿Podés decirme en qué ciudad querés recibir tu pedido?\n\n📝 Ejemplos: Asunción, San Lorenzo, Fernando de la Mora, Lambaré";
        await enviarMensaje(userId, from, response);
        await saveReceivedMessage({ userId, from, message: response, messageType: "out_text" });
        return { response, handled_by: "local_flow" };
      }
    }
    
    // C. Esperando cantidad
    if (previousStep === "collecting_quantity" && currentProduct) {
      const cantidadMatch = texto.match(/(\d+)/);
      if (cantidadMatch) {
        const cantidad = parseInt(cantidadMatch[1], 10);
        
        let precioUnitario = precioUnitarioGuardado;
        if (!precioUnitario) {
          precioUnitario = await obtenerPrecioProducto(userId, currentProduct, "");
        }
        
        const totalAmount = precioUnitario ? precioUnitario * cantidad : null;
        const response = buildOrderSummary({ ...oldOrder, quantity: cantidad, items: [{ name: currentProduct, qty: cantidad }] }, totalAmount, precioUnitario);
        await enviarMensaje(userId, from, response);
        await saveReceivedMessage({ userId, from, message: response, messageType: "out_text" });
        await saveContexto(userId, from, {
          ...ctx,
          step: "awaiting_payment",
          order_data: { ...oldOrder, quantity: cantidad, items: [{ name: currentProduct, qty: cantidad }], precio_unitario: precioUnitario },
          updated_at: new Date().toISOString(),
        });
        return { response, handled_by: "local_flow" };
      } else {
        const response = "🔢 Por favor, indicame cuántas unidades querés. Ejemplo: 'Quiero 2' o '2 unidades'";
        await enviarMensaje(userId, from, response);
        await saveReceivedMessage({ userId, from, message: response, messageType: "out_text" });
        return { response, handled_by: "local_flow" };
      }
    }
    
    // D. Detectar producto nuevo
    if (!currentProduct) {
      const detectedProduct = detectarProductoDesdeTexto(texto);
      if (detectedProduct) {
        const response = buildCityQuestionResponse(detectedProduct);
        await enviarMensaje(userId, from, response);
        await saveReceivedMessage({ userId, from, message: response, messageType: "out_text" });
        await saveContexto(userId, from, {
          ...ctx,
          step: "collecting_city",
          current_product: detectedProduct,
          order_data: { product: detectedProduct, quantity: 0, city: "", items: [] },
          updated_at: new Date().toISOString(),
        });
        return { response, handled_by: "local_flow" };
      }
    }
  }
  
  // Si no se manejó localmente, intentar con chat-ia
  try {
    const host = req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || "https";
    if (!host) throw new Error("No se detectó host");
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    
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
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const raw = await resIA.text();
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("chat-ia no devolvió JSON");
    }
    if (!resIA.ok) throw new Error(data?.error || `chat-ia error ${resIA.status}`);
    return data;
  } catch (err) {
    console.error("❌ chat-ia error:", err.message);
    
    const fallback = "👋 ¡Hola! ¿En qué producto estás interesado?\n\n💬 Escribime el nombre del producto que te interesa y te ayudo con tu pedido.";
    await enviarMensaje(userId, from, fallback);
    await saveReceivedMessage({ userId, from, message: fallback, messageType: "out_text" });
    return { response: fallback, handled_by: "fallback" };
  }
}

// ═══════════════════════════════════════════════════════════
// DETECTOR DE PEDIDOS CONFIRMADOS
// ═══════════════════════════════════════════════════════════

function esMensajePedidoConfirmado(texto) {
  const t = clean(texto);
  const tieneMarcador = /✅\s*PEDIDO CONFIRMADO/i.test(t);
  const tieneProducto = /Producto:\s*\S/i.test(t);
  return tieneMarcador && tieneProducto;
}

function esBloqueDatosBancarios(texto) {
  if (!texto) return false;
  const tn = normalize(texto);
  const señales = [
    "datos para transferencia", "datos de transferencia", "titular:",
    "banco familiar", "banco continental", "banco itau", "cuenta:", "alias:"
  ];
  let hits = 0;
  for (const s of señales) {
    if (tn.includes(s)) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

function limpiarProducto(productoRaw) {
  if (!productoRaw) return null;
  let p = clean(productoRaw);

  if (esBloqueDatosBancarios(p)) {
    const idxAlias = p.search(/alias:\s*\d+/i);
    if (idxAlias >= 0) {
      const restoDespuesAlias = p.substring(idxAlias);
      const idxPlus = restoDespuesAlias.indexOf("+");
      if (idxPlus >= 0) {
        p = restoDespuesAlias.substring(idxPlus + 1).trim();
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  const items = p.split(/\s*\+\s*/).filter((it) => {
    const itClean = clean(it);
    if (!itClean) return false;
    if (itClean.length > 100) return false;
    const itn = normalize(itClean);
    const blacklistItem = [
      "datos para transferencia", "titular", "banco ", "cuenta:", "alias:", "https://"
    ];
    return !blacklistItem.some((b) => itn.includes(b));
  });

  if (items.length === 0) return null;
  return items.join(" + ");
}

function parsearPedidoConfirmado(texto) {
  const get = (regex) => {
    const m = texto.match(regex);
    return m ? clean(m[1]) : null;
  };

  const productoRaw = get(/Producto:\s*([^\n]+)/i);
  const cliente = get(/Cliente:\s*([^\n]+)/i);
  const ubicacionRaw = get(/Ubicaci[oó]n:\s*([^\n]+)/i);
  const contacto = get(/Contacto:\s*([^\n]+)/i);
  const cantidadRaw = get(/Cantidad:\s*([^\n]+)/i);
  const totalRaw = get(/Total:\s*([^\n]+)/i);

  const producto = limpiarProducto(productoRaw);

  const esProductoValido = (p) => {
    if (!p) return false;
    if (p.length > 200) return false;
    const blacklist = ["nunca decir", "datos para transferencia", "alias:", "cuenta:"];
    const pn = normalize(p);
    return !blacklist.some((b) => pn.includes(b));
  };

  if (!esProductoValido(producto)) {
    console.log("🚫 Producto inválido tras limpieza:", productoRaw?.substring(0, 80));
    return null;
  }

  let city = null;
  let address = null;
  if (ubicacionRaw) {
    const partes = ubicacionRaw.split(/\s*[—–-]\s*/);
    city = partes[0] ? clean(partes[0]) : null;
    address = partes.slice(1).join(" — ").trim() || null;
  }

  let quantity = 1;
  if (cantidadRaw) {
    const m = cantidadRaw.match(/(\d+)/);
    if (m) quantity = parseInt(m[1], 10);
  }

  let totalNum = null;
  if (totalRaw) {
    const soloDigitos = totalRaw.replace(/[^\d]/g, "");
    if (soloDigitos) totalNum = parseInt(soloDigitos, 10);
  }

  return {
    customer_name: cliente,
    product: producto,
    city,
    address,
    phone: contacto,
    quantity,
    total_amount: totalNum,
  };
}

function parsearCarrito(productString) {
  if (!productString) return [];
  return productString
    .split(/\s*\+\s*/)
    .map((item) => {
      const m = item.match(/^(.*?)\s*x\s*(\d+)\s*$/i);
      if (m) {
        return { name: clean(m[1]), qty: parseInt(m[2], 10) || 1 };
      }
      return { name: clean(item), qty: 1 };
    })
    .filter((it) => {
      if (!it.name) return false;
      const itn = normalize(it.name);
      const blacklist = ["datos para transferencia", "titular", "banco ", "cuenta:", "alias:"];
      return !blacklist.some((b) => itn.includes(b));
    });
}

function serializarCarrito(items) {
  return items
    .filter((it) => it.name && it.qty > 0)
    .map((it) => `${it.name} x${it.qty}`)
    .join(" + ");
}

function buscarItemEnCarrito(carrito, productName) {
  const target = normalize(productName);
  return carrito.findIndex((it) => normalize(it.name) === target);
}

function expandirItemsDelMensaje(productoFinal, quantityFallback) {
  const items = parsearCarrito(productoFinal);
  if (items.length === 0) return [];
  if (items.length === 1 && !/x\s*\d+\s*$/i.test(productoFinal)) {
    items[0].qty = quantityFallback || items[0].qty || 1;
  }
  return items;
}

async function yaExistePedidoParaMensaje(messageId) {
  if (!messageId) return false;
  try {
    const { data } = await supabase
      .from("orders")
      .select("id")
      .eq("source_message_id", messageId)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

async function detectarYGuardarPedidoConfirmado({
  userId,
  from,
  textoMensaje,
  sourceMessageId,
}) {
  try {
    if (sourceMessageId && (await yaExistePedidoParaMensaje(sourceMessageId))) {
      console.log("⏭️ Ya existe pedido para ese mensaje, skip");
      return;
    }

    const datos = parsearPedidoConfirmado(textoMensaje);
    if (!datos || !datos.product) {
      console.log("🚫 Texto no parece pedido válido, descartado");
      return;
    }

    const itemsNuevos = expandirItemsDelMensaje(datos.product, datos.quantity);
    if (itemsNuevos.length === 0) {
      console.log("🚫 No quedaron items válidos tras expandir");
      return;
    }

    const hace1hora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: reciente } = await supabase
      .from("orders")
      .select("id, product, total_amount, quantity, status")
      .eq("user_id", userId)
      .eq("from_number", from)
      .eq("status", "confirmed")
      .gte("created_at", hace1hora)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!reciente) {
      const cantidadTotal = itemsNuevos.reduce((s, it) => s + it.qty, 0);
      const insertPayload = {
        user_id: userId,
        from_number: from,
        phone: datos.phone || from,
        customer_name: datos.customer_name,
        product: serializarCarrito(itemsNuevos),
        quantity: cantidadTotal,
        total_amount: datos.total_amount,
        address: datos.address,
        city: datos.city,
        status: "confirmed",
        metodo_pago: "efectivo",
        source_message_id: sourceMessageId || null,
        detected_by_ai: true,
        created_at: new Date().toISOString(),
      };

      const { data: nuevo, error } = await supabase
        .from("orders")
        .insert(insertPayload)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("❌ Error insertando pedido:", error);
        return;
      }
      console.log(`✅ Pedido NUEVO creado: ${nuevo?.id} → ${insertPayload.product}`);
      await enviarASheet(userId, { ...insertPayload, id: nuevo?.id }, "NUEVO");
      return;
    }

    const carrito = parsearCarrito(reciente.product);
    let totalActual = reciente.total_amount || 0;
    const cambios = [];

    for (const nuevo of itemsNuevos) {
      const idx = buscarItemEnCarrito(carrito, nuevo.name);
      if (idx >= 0) {
        const itemViejo = carrito[idx];
        if (itemViejo.qty === nuevo.qty) {
          cambios.push(`⏭️ ${nuevo.name} x${nuevo.qty} ya estaba (skip)`);
          continue;
        }
        carrito[idx].qty = nuevo.qty;
        cambios.push(`🔄 ${nuevo.name}: ${itemViejo.qty} → ${nuevo.qty}`);
      } else {
        carrito.push({ name: nuevo.name, qty: nuevo.qty });
        cambios.push(`➕ ${nuevo.name} x${nuevo.qty}`);
      }
    }

    if (datos.total_amount && datos.total_amount > totalActual) {
      totalActual = datos.total_amount;
    }

    const productoSerializado = serializarCarrito(carrito);
    const cantidadTotal = carrito.reduce((sum, it) => sum + it.qty, 0);

    const updatePayload = {
      product: productoSerializado,
      quantity: cantidadTotal,
      total_amount: totalActual,
      updated_at: new Date().toISOString(),
    };
    if (datos.address) updatePayload.address = datos.address;
    if (datos.city) updatePayload.city = datos.city;
    if (datos.customer_name) updatePayload.customer_name = datos.customer_name;

    const { error: updErr } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", reciente.id);

    if (updErr) {
      console.error("❌ update pedido:", updErr);
      return;
    }
    console.log(
      `🛒 Carrito actualizado pedido ${reciente.id} | ${cambios.join(" | ")} | total: ${totalActual} | ${productoSerializado}`
    );
    await enviarASheet(
      userId,
      {
        id: reciente.id,
        user_id: userId,
        from_number: from,
        phone: datos.phone || from,
        customer_name: datos.customer_name,
        product: productoSerializado,
        quantity: cantidadTotal,
        total_amount: totalActual,
        address: datos.address,
        city: datos.city,
      },
      `ACTUALIZADO: ${cambios.join(" | ")}`
    );
  } catch (err) {
    console.error("❌ detectarYGuardarPedidoConfirmado error:", err);
  }
}

async function asociarComprobanteAlPedido({ userId, from, mediaUrl }) {
  try {
    if (!mediaUrl) return;

    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: pedido } = await supabase
      .from("orders")
      .select("id, comprobante_url")
      .eq("user_id", userId)
      .eq("from_number", from)
      .eq("status", "confirmed")
      .gte("created_at", hace24h)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!pedido) {
      console.log("ℹ️ Comprobante recibido pero no hay pedido confirmado reciente");
      return false;
    }

    if (pedido.comprobante_url) {
      console.log("ℹ️ El pedido ya tiene comprobante, no sobrescribo");
      return true;
    }

    const { error } = await supabase
      .from("orders")
      .update({
        comprobante_url: mediaUrl,
        metodo_pago: "transferencia",
        updated_at: new Date().toISOString(),
      })
      .eq("id", pedido.id);

    if (error) {
      console.error("❌ Error asociando comprobante:", error);
      return false;
    }

    console.log(`💳 Comprobante asociado al pedido ${pedido.id}`);
    return true;
  } catch (err) {
    console.error("❌ asociarComprobanteAlPedido error:", err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// PROCESAR MENSAJE ENTRANTE
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
    } else if (tipoMsg === "audio") {
      texto = "";
      mediaId = message.audio?.id || null;
      mimeType = message.audio?.mime_type || "audio/ogg";
      messageType = "audio";
    } else if (tipoMsg === "voice") {
      texto = "";
      mediaId = message.voice?.id || null;
      mimeType = message.voice?.mime_type || "audio/ogg";
      messageType = "audio";
    } else if (tipoMsg === "video") {
      texto = clean(message.video?.caption || "[video]");
      mediaId = message.video?.id || null;
      mimeType = message.video?.mime_type || "video/mp4";
      messageType = "video";
    } else if (tipoMsg === "document") {
      texto = clean(message.document?.caption || message.document?.filename || "[documento]");
      mediaId = message.document?.id || null;
      mimeType = message.document?.mime_type || "application/octet-stream";
      messageType = "document";
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

    console.log(`📩 WhatsApp ${messageType}: ${from}`, texto?.slice(0, 80));

    await saveReceivedMessage({
      userId,
      from,
      message: texto || `[${messageType}]`,
      messageType,
      mediaUrl,
      waMessageId: message.id || null,
    });

    if (messageType === "text") {
      const disparado = await evaluarDisparadores({ userId, from, texto });
      if (disparado) {
        console.log("✅ Disparador atendió el mensaje.");
        return { response: null, handled_by: "trigger", error: null };
      }

      let ctx = await getContexto(userId, from);
      const estabaVencido = isContextoVencido(ctx);
      if (estabaVencido) ctx = await limpiarContextoVencido(userId, from, ctx);
      const history = estabaVencido ? [] : await getHistory(userId, from);

      const data = await llamarChatIAConFallback({
        req, userId, texto, from, ctx, history,
        mediaUrl: null, mediaType: null, mimeType: null
      });

      if (data?.context) await saveContexto(userId, from, data.context);
      
      if (data?.response && data.handled_by !== "local_flow") {
        if (esMensajePedidoConfirmado(data.response)) {
          await detectarYGuardarPedidoConfirmado({
            userId, from, textoMensaje: data.response, sourceMessageId: null
          });
        }
      }
      
      return { response: data?.response || null, handled_by: data?.handled_by };
    }

    if ((messageType === "image" || messageType === "document") && mediaUrl) {
      asociarComprobanteAlPedido({ userId, from, mediaUrl }).catch(e => console.error(e));

      let ctx = await getContexto(userId, from);
      const estabaVencido = isContextoVencido(ctx);
      if (estabaVencido) ctx = await limpiarContextoVencido(userId, from, ctx);
      const history = estabaVencido ? [] : await getHistory(userId, from);

      const data = await llamarChatIAConFallback({
        req, userId, texto: texto || "", from, ctx, history,
        mediaUrl, mediaType: "image", mimeType: mediaMime
      });

      if (data?.context) await saveContexto(userId, from, data.context);
      if (data?.is_payment_proof) await asociarComprobanteAlPedido({ userId, from, mediaUrl });
      
      return { response: data?.response || null };
    }

    if (messageType === "audio" && mediaUrl) {
      let ctx = await getContexto(userId, from);
      const estabaVencido = isContextoVencido(ctx);
      if (estabaVencido) ctx = await limpiarContextoVencido(userId, from, ctx);
      const history = estabaVencido ? [] : await getHistory(userId, from);

      const data = await llamarChatIAConFallback({
        req, userId, texto: "", from, ctx, history,
        mediaUrl, mediaType: "audio", mimeType: mediaMime
      });

      if (data?.context) await saveContexto(userId, from, data.context);
      return { response: data?.response || null };
    }

    return { response: null, handled_by: "no_ia" };
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
