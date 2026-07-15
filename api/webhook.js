// api/webhook.js — V75: CIUDAD OBLIGATORIA TRAS COPY + SIN IMAGEN REPETIDA
// WhatsApp Cloud API → Triggers → Gemini (texto + imagen + audio)
// + ✅ V73: imagen, copy y consulta amable de ciudad se envían como mensajes independientes
// + ✅ V85: pregunta ciudad única con bloqueo anti-duplicado
// + Descarga de audios/imágenes/videos a Supabase Storage (bucket: comprobantes)
// + FIX: disparador secundario respeta el contexto del último producto
// + ✅ AHORA RETORNA RESPUESTAS PARA WAHA QR
// + ✅ CORREGIDO: Verificación de token en base de datos (soporte multi-usuario)
// + ✅ BOTONES E IMAGEN: enviarPlantillaCompleta ahora envía botones CON imagen
// + ✅ URL ABSOLUTA CON DOMINIO DE PRODUCCIÓN FIJO (SOLUCIONA ERROR 401)
// + ✅ MANEJO DE MENSAJES INTERACTIVOS (RESPUESTA A BOTONES)
// + ✅ GUARDA PRODUCTO EN CONTEXTO AL ENVIAR PLANTILLA
// + ✅ FIX: SIEMPRE usa template si existe, ignora response cuando hay plantilla
// + ✅ LOGS DE DIAGNÓSTICO PARA VERIFICAR GUARDADO DE CONTEXTO
// + ✅ FIX UBICACIÓN: se agrega manejo de mensajes type "location"
// + ✅ FIX WEBHOOK: URL ABSOLUTA para llamar a chat-ia (soluciona error "host no detectado")
// + ✅ FIX: URL con https:// correcto (soluciona error ERR_INVALID_URL)

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const clean = (t) => String(t || "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normalize = (t) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");


const CITY_QUESTION_FRIENDLY =
  "😊 Para confirmar la modalidad de entrega, ¿me indicás por favor de qué ciudad sos? 📍";

const cityQuestionLocks = new Map();

function acquireCityQuestionLock(userId, from, ttlMs = 15000) {
  const key = `${userId}:${from}`;
  const now = Date.now();
  const expiresAt = Number(cityQuestionLocks.get(key) || 0);
  if (expiresAt > now) return false;

  cityQuestionLocks.set(key, now + ttlMs);
  setTimeout(() => {
    if (Number(cityQuestionLocks.get(key) || 0) <= Date.now()) {
      cityQuestionLocks.delete(key);
    }
  }, ttlMs + 1000);

  return true;
}

/**
 * Separa únicamente una pregunta de ciudad ubicada al final del mensaje.
 * No toca respuestas de cobertura, transportadora, pago anticipado,
 * confirmaciones de pedido ni preguntas de cantidad/datos personales.
 */
function separarPreguntaCiudad(texto) {
  const original = clean(texto);
  if (!original) {
    return { mainText: "", cityQuestion: "", separated: false };
  }

  const patterns = [
    /(?:\n\s*)?(?:📍\s*)?¿?\s*para\s+qu[eé]\s+ciudad\s+ser[ií]a\s+(?:el\s+)?env[ií]o\s*\??\s*(?:😊|🙂|📍|🚚)*\s*$/i,
    /(?:\n\s*)?(?:📍\s*)?¿?\s*de\s+qu[eé]\s+ciudad\s+sos\s*\??\s*(?:😊|🙂|📍|🚚)*\s*$/i,
    /(?:\n\s*)?(?:📍\s*)?¿?\s*cu[aá]l\s+es\s+tu\s+ciudad\s*\??\s*(?:😊|🙂|📍|🚚)*\s*$/i,
    /(?:\n\s*)?(?:📍\s*)?¿?\s*a\s+qu[eé]\s+ciudad\s+(?:ser[ií]a|va)\s+(?:el\s+)?env[ií]o\s*\??\s*(?:😊|🙂|📍|🚚)*\s*$/i,
    /(?:\n\s*)?(?:📍\s*)?¿?\s*en\s+qu[eé]\s+ciudad\s+te\s+encontr[aá]s\s*\??\s*(?:😊|🙂|📍|🚚)*\s*$/i,
    /(?:\n\s*)?(?:📍\s*)?¿?\s*me\s+indic[aá]s\s+(?:por\s+favor\s+)?(?:de\s+)?qu[eé]\s+ciudad\s+sos\s*\??\s*(?:😊|🙂|📍|🚚)*\s*$/i,
  ];

  for (const pattern of patterns) {
    if (!pattern.test(original)) continue;
    const mainText = clean(original.replace(pattern, ""));
    return {
      mainText,
      cityQuestion: CITY_QUESTION_FRIENDLY,
      separated: true,
    };
  }

  return { mainText: original, cityQuestion: "", separated: false };
}

async function enviarYGuardarTexto(userId, from, text, messageType = "out_text") {
  const msg = clean(text);
  if (!msg) return false;

  const sent = await enviarMensaje(userId, from, msg);
  if (!sent) return false;

  await saveReceivedMessage({
    userId,
    from,
    message: msg,
    messageType,
  });

  return true;
}

/**
 * Envía la respuesta principal y, cuando corresponde, la pregunta de ciudad
 * en un segundo mensaje independiente.
 */
async function enviarRespuestaSeparada(userId, from, text, options = {}) {
  const { mainText, cityQuestion, separated } = separarPreguntaCiudad(text);
  const delayMs = Number.isFinite(Number(options.delayMs))
    ? Math.max(0, Number(options.delayMs))
    : 900;

  let sentAny = false;

  if (mainText) {
    sentAny = (await enviarYGuardarTexto(userId, from, mainText, "out_text")) || sentAny;
  }

  if (cityQuestion && acquireCityQuestionLock(userId, from)) {
    if (mainText && delayMs > 0) await sleep(delayMs);
    sentAny = (await enviarYGuardarTexto(userId, from, cityQuestion, "out_text")) || sentAny;
  }

  // Si el mensaje era solamente una pregunta de ciudad que no coincidió
  // con los patrones, se envía sin modificar.
  if (!mainText && !cityQuestion && clean(text)) {
    sentAny = (await enviarYGuardarTexto(userId, from, text, "out_text")) || sentAny;
  }

  return {
    sent: sentAny,
    mainText,
    cityQuestion,
    separated,
  };
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

function enviarASheetSinBloquear(userId, order, nota = "") {
  enviarASheet(userId, order, nota).catch((err) => {
    console.log("❌ enviarASheetSinBloquear error:", err.message || err);
  });
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


async function mediaFueEnviadaRecientemente(userId, from, mediaUrl, minutes = 45) {
  const target = clean(mediaUrl);
  if (!target) return false;

  try {
    const since = new Date(Date.now() - Math.max(1, minutes) * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("inbox_messages")
      .select("media_url, media_url_text, message, created_at")
      .eq("user_id", userId)
      .eq("sender_id", from)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      console.log("⚠️ No se pudo verificar media duplicada:", error.message || error);
      return false;
    }

    return (data || []).some((row) => {
      const values = [];
      if (Array.isArray(row?.media_url)) values.push(...row.media_url);
      else if (row?.media_url) values.push(row.media_url);
      if (row?.media_url_text) values.push(row.media_url_text);
      if (row?.message && String(row.message).includes(target)) values.push(target);
      return values.some((value) => clean(value) === target);
    });
  } catch (err) {
    console.log("⚠️ mediaFueEnviadaRecientemente error:", err.message || err);
    return false;
  }
}

function plantillaPareceComercial(texto, productName, plantilla) {
  const raw = clean(texto);
  const n = normalize(raw);
  if (!raw || !clean(productName)) return false;
  if (esMensajePedidoConfirmado(raw) || esBloqueDatosBancarios(raw)) return false;
  if (/pedido confirmado|comprobante de transferencia|pago anticipado por transferencia/.test(n)) return false;

  return Boolean(
    plantilla?.id ||
    plantilla?.media_url ||
    plantilla?.variables?.media ||
    /\b(precio|promo|promocion|oferta|unidad|unidades|gs|delivery|stock|beneficios?)\b/.test(n)
  );
}

async function debeAgregarPreguntaCiudad({ userId, from, texto, productName, plantilla }) {
  if (!plantillaPareceComercial(texto, productName, plantilla)) return false;

  const ctx = await getContexto(userId, from);
  const city = clean(ctx?.order_data?.city || ctx?.city || "");
  if (city) return false;

  // Evita duplicar la misma pregunta si ya salió hace pocos minutos.
  try {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("inbox_messages")
      .select("message, created_at")
      .eq("user_id", userId)
      .eq("sender_id", from)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(15);

    const alreadyAsked = (data || []).some((row) => {
      const n = normalize(row?.message || "");
      return /de que ciudad sos|para que ciudad seria el envio|cual es tu ciudad|modalidad de entrega|confirmar la cobertura/.test(n);
    });
    if (alreadyAsked) return false;
  } catch {}

  return true;
}

// ═══════════════════════════════════════════════════════════
// PLANTILLAS CON BOTONES E IMAGEN - CORREGIDO CON DIAGNÓSTICO ✅
// ═══════════════════════════════════════════════════════════

async function enviarPlantillaCompleta({ userId, from, templateName, fallbackText, productNameFallback, resetOrderForNewPresentation = false }) {
  console.log('🔍 ===== INICIO enviarPlantillaCompleta =====');
  console.log('🔍 userId:', userId);
  console.log('🔍 from:', from);
  console.log('🔍 templateName:', templateName);
  
  let plantilla = null;
  let productName = productNameFallback || "";

  if (templateName && templateName !== "Ninguna") {
    console.log('🔍 Buscando plantilla en Supabase...');
    const { data: tpl, error } = await supabase
      .from("templates")
      .select("*")
      .eq("user_id", userId)
      .eq("name", templateName)
      .maybeSingle();
    
    if (error) {
      console.log('❌ Error buscando plantilla:', error);
    }
    
    plantilla = tpl;
    productName = plantilla?.name || templateName || productNameFallback || "";
    
    console.log('🔍 ===== DIAGNÓSTICO =====');
    console.log(`🔍 plantilla?.name: "${plantilla?.name}"`);
    console.log(`🔍 templateName recibido: "${templateName}"`);
    console.log(`🔍 productName resultante: "${productName}"`);
    console.log(`🔍 ¿productName tiene valor?: ${!!productName}`);
    
    console.log('🔍 Plantilla encontrada:', productName);
    console.log('🔍 media_url:', plantilla?.media_url);
    console.log('🔍 media_type:', plantilla?.media_type);
    console.log('🔍 variables:', JSON.stringify(plantilla?.variables, null, 2));
  }

  if (productName) {
    console.log(`📌 Guardando producto en contexto: "${productName}"`);
    const ctx = await getContexto(userId, from);
    const previousOrder = ctx?.order_data || {};
    const previousProduct = clean(previousOrder?.product || ctx?.current_product || "");
    const productChanged = normalize(previousProduct) !== normalize(productName);
    const shouldResetOrder = Boolean(resetOrderForNewPresentation || productChanged);

    const nextOrderData = shouldResetOrder
      ? {
          product: productName,
          quantity: 0,
          city: "",
          customer_name: "",
          address: "",
          phone: "",
          locked_offer: null,
          payment_proof_received: false,
          observation: "",
          preferred_delivery_date: "",
          preferred_delivery_time: "",
          payment_note: "",
        }
      : {
          ...previousOrder,
          product: productName,
        };

    await saveContexto(userId, from, {
      ...ctx,
      current_product: productName,
      last_topic: productName,
      last_trigger: templateName || null,
      step: shouldResetOrder ? "collecting_city" : ctx?.step || null,
      order_data: nextOrderData,
      updated_at: new Date().toISOString(),
    });

    console.log(
      `✅ Contexto guardado con current_product: "${productName}" | reset=${shouldResetOrder}`
    );
  } else {
    console.log('⚠️ NO se guardó contexto: productName está vacío');
  }

  const mensajePlantillaRaw = clean(plantilla?.content || fallbackText || "");
  const separacionPlantilla = separarPreguntaCiudad(mensajePlantillaRaw);
  const mensajeFinal = separacionPlantilla.mainText;
  let preguntaCiudadSeparada = separacionPlantilla.cityQuestion;

  if (
    !preguntaCiudadSeparada &&
    (
      resetOrderForNewPresentation ||
      await debeAgregarPreguntaCiudad({
        userId,
        from,
        texto: mensajePlantillaRaw,
        productName,
        plantilla,
      })
    )
  ) {
    preguntaCiudadSeparada = CITY_QUESTION_FRIENDLY;
  }
  
  let firstImage = null;
  let imagenes = [];
  
  if (plantilla?.variables?.media?.imageUrls && Array.isArray(plantilla.variables.media.imageUrls)) {
    imagenes = plantilla.variables.media.imageUrls.filter(url => url);
    console.log('🔍 Imágenes en variables.media.imageUrls:', imagenes.length);
  }
  
  if (imagenes.length === 0 && plantilla?.media_url) {
    console.log('🔍 Usando media_url como imagen:', plantilla.media_url);
    imagenes = [plantilla.media_url];
  }
  
  if (imagenes.length === 0 && plantilla?.variables?.media) {
    const media = plantilla.variables.media;
    if (media.imageUrl) {
      imagenes = [media.imageUrl];
      console.log('🔍 Imagen en variables.media.imageUrl');
    } else if (media.image_url) {
      imagenes = [media.image_url];
      console.log('🔍 Imagen en variables.media.image_url');
    } else if (media.url) {
      imagenes = [media.url];
      console.log('🔍 Imagen en variables.media.url');
    }
  }
  
  if (imagenes && imagenes.length > 0) {
    firstImage = imagenes[0];
    console.log('🔍 Primera imagen seleccionada:', firstImage);
  }
  
  let video = null;
  let gif = null;
  if (plantilla?.variables?.media?.videoUrl) {
    video = plantilla.variables.media.videoUrl;
  }
  if (plantilla?.variables?.media?.gifUrl) {
    gif = plantilla.variables.media.gifUrl;
  }
  
  const buttons = plantilla?.variables?.buttons || null;
  
  console.log(
    `📦 Plantilla "${plantilla?.name || templateName}" → ${imagenes.length} img, video: ${!!video}, gif: ${!!gif}, botones: ${buttons?.length || 0}`
  );

  if (buttons && buttons.length > 0) {
    console.log(`🎯 Enviando plantilla con ${buttons.length} botones desde webhook`);
    console.log(`📸 Imagen a enviar: ${firstImage || 'ninguna'}`);
    
    const baseUrl = 'https://bot-seller-skyline-2026.vercel.app';
    
    const imageAlreadySent = firstImage
      ? await mediaFueEnviadaRecientemente(userId, from, firstImage)
      : false;
    const imageForPayload = imageAlreadySent ? null : firstImage;

    if (imageAlreadySent) {
      console.log(`⏭️ Imagen repetida omitida en plantilla con botones: ${firstImage}`);
    }

    const payload = {
      to: from,
      userId: userId,
      user_id: userId,
      message: mensajeFinal,
      media_url: imageForPayload || null,
      media_type: imageForPayload ? 'image' : null,
      buttons: buttons,
    };

    console.log('📤 Payload a enviar a send-whatsapp:', JSON.stringify(payload, null, 2));

    try {
      const url = `${baseUrl}/api/send-whatsapp`;
      console.log(`📤 Enviando a: ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      
      console.log(`📥 Status: ${response.status}`);
      console.log(`📥 Response: ${responseText}`);
      
      if (!response.ok) {
        console.error('❌ Error enviando plantilla con botones:', response.status, responseText);
        if (firstImage) {
          await enviarMedia(userId, from, firstImage, "image", mensajeFinal);
        } else {
          await enviarMensaje(userId, from, mensajeFinal);
        }
        await saveReceivedMessage({
          userId,
          from,
          message: mensajeFinal,
          messageType: "out_text",
          mediaUrl: firstImage,
        });
      } else {
        console.log('✅ Plantilla con botones e imagen enviada desde webhook');
        
        await saveReceivedMessage({
          userId,
          from,
          message: mensajeFinal,
          messageType: "out_interactive",
          mediaUrl: firstImage,
        });
      }
    } catch (err) {
      console.error('❌ Error en fetch send-whatsapp:', err);
      if (firstImage) {
        await enviarMedia(userId, from, firstImage, "image", mensajeFinal);
      } else {
        await enviarMensaje(userId, from, mensajeFinal);
      }
      await saveReceivedMessage({
        userId,
        from,
        message: mensajeFinal,
        messageType: "out_text",
        mediaUrl: firstImage,
      });
    }

    if (preguntaCiudadSeparada && acquireCityQuestionLock(userId, from)) {
      await sleep(900);
      await enviarYGuardarTexto(userId, from, preguntaCiudadSeparada, "out_text");
    }

    if (plantilla?.id) {
      try {
        await supabase
          .from("templates")
          .update({ usage_count: (plantilla.usage_count || 0) + 1 })
          .eq("id", plantilla.id);
      } catch {}
    }

    console.log('🔍 ===== FIN enviarPlantillaCompleta (CON botones) =====');
    return plantilla;
  }

  console.log('ℹ️ Sin botones, enviando imagen, copy y ciudad por separado');

  for (let i = 0; i < imagenes.length; i++) {
    const url = imagenes[i];
    const yaEnviada = await mediaFueEnviadaRecientemente(userId, from, url);
    if (yaEnviada) {
      console.log(`⏭️ Imagen repetida omitida en plantilla: ${url}`);
      continue;
    }
    const ok = await enviarMedia(userId, from, url, "image", "");
    if (ok) {
      await saveReceivedMessage({
        userId,
        from,
        message: `[image] ${url}`,
        messageType: "out_image",
        mediaUrl: url,
      });
    }
  }

  if (mensajeFinal) {
    if (imagenes.length > 0) await sleep(450);
    await enviarYGuardarTexto(userId, from, mensajeFinal, "out_text");
  }

  if (preguntaCiudadSeparada) {
    if (mensajeFinal || imagenes.length > 0) await sleep(900);
    await enviarYGuardarTexto(userId, from, preguntaCiudadSeparada, "out_text");
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

  console.log('🔍 ===== FIN enviarPlantillaCompleta (SIN botones) =====');
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

    if (lastTrigger) {
      const trigLastMatch = triggers.find((t) => t.name === lastTrigger);
      if (trigLastMatch && matchSecundario(trigLastMatch.secondary, textoNorm)) {
        const trig = trigLastMatch;
        console.log(
          `🎯 Disparador SECUNDARIO (prioridad lastTrigger): "${trig.name}" (lastTrigger=${lastTrigger})`
        );

        if (trig.send_limit && trig.send_limit !== "" && trig.send_limit !== "∞") {
          const limite = parseInt(trig.send_limit, 10);
          if (!isNaN(limite) && limite > 0) {
            const { count } = await supabase
              .from("trigger_log")
              .select("*", { count: "exact", head: true })
              .eq("trigger_id", trig.id);
            if ((count || 0) < limite) {
              const plantillaSec = await enviarPlantillaCompleta({
                userId,
                from,
                templateName: trig.secondary?.template,
                fallbackText: trig.secondary?.response,
                productNameFallback: trig.name,
              });
              const contenidoSecondary = clean(plantillaSec?.content || trig.secondary?.response || "");
              try {
                await supabase.from("trigger_log").insert({
                  trigger_id: trig.id,
                  user_id: userId,
                  from_number: from,
                  sent_at: new Date().toISOString(),
                });
              } catch {}
              if (contenidoSecondary && esMensajePedidoConfirmado(contenidoSecondary)) {
                await detectarYGuardarPedidoConfirmado({ userId, from, textoMensaje: contenidoSecondary, sourceMessageId: null });
              }
              const ctxTrasSecundario = await getContexto(userId, from);
              await saveContexto(userId, from, { ...ctxTrasSecundario, last_trigger: trig.name });
              return true;
            }
          }
        } else {
          const plantillaSec = await enviarPlantillaCompleta({
            userId,
            from,
            templateName: trig.secondary?.template,
            fallbackText: trig.secondary?.response,
            productNameFallback: trig.name,
          });
          const contenidoSecondary = clean(plantillaSec?.content || trig.secondary?.response || "");
          try {
            await supabase.from("trigger_log").insert({
              trigger_id: trig.id,
              user_id: userId,
              from_number: from,
              sent_at: new Date().toISOString(),
            });
          } catch {}
          if (contenidoSecondary && esMensajePedidoConfirmado(contenidoSecondary)) {
            await detectarYGuardarPedidoConfirmado({ userId, from, textoMensaje: contenidoSecondary, sourceMessageId: null });
          }
          const ctxTrasSecundario2 = await getContexto(userId, from);
          await saveContexto(userId, from, { ...ctxTrasSecundario2, last_trigger: trig.name });
          return true;
        }
      }
    }

    const triggersOrdenados = [...triggers].sort((a, b) => {
      if (a.name === lastTrigger) return -1;
      if (b.name === lastTrigger) return 1;
      return 0;
    });

    for (const trig of triggersOrdenados) {
      const matchPrimary = matchKeywords(trig.condition, trig.type, textoNorm);
      const matchSecondary = matchPrimary && matchSecundario(trig.secondary, textoNorm);

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
        if (trig.template && trig.template !== "Ninguna" && trig.template !== "null") {
          console.log(`📌 Usando plantilla "${trig.template}" (ignorando response)`);
          plantillaPrimary = await enviarPlantillaCompleta({
            userId,
            from,
            templateName: trig.template,
            fallbackText: "",
            productNameFallback: trig.name,
            resetOrderForNewPresentation: true,
          });
        } else {
          console.log(`📌 No hay plantilla, usando response como fallback`);
          plantillaPrimary = await enviarPlantillaCompleta({
            userId,
            from,
            templateName: null,
            fallbackText: trig.response,
            productNameFallback: trig.name,
            resetOrderForNewPresentation: true,
          });
        }
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
          productNameFallback: trig.name,
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

      const ctxTrasDisparador = await getContexto(userId, from);
      await saveContexto(userId, from, { ...ctxTrasDisparador, last_trigger: trig.name });
      return true;
    }

    return false;
  } catch (err) {
    console.error("❌ evaluarDisparadores error:", err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// LLAMADA A CHAT-IA - ✅ CORREGIDO CON URL ABSOLUTA
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
  // ✅ FIX: Usar URL absoluta con https:// correcto
  // Esto soluciona el error "ERR_INVALID_URL" y el mensaje "hubo un error momentáneo"
  const BASE_URL = 'https://bot-seller-skyline-2026.vercel.app';
  const url = `${BASE_URL}/api/chat-ia`;
  
  console.log(`📤 Llamando a chat-ia en: ${url}`);
  console.log(`📤 userId: ${userId}, from: ${from}, texto: ${texto?.slice(0, 50)}...`);

  try {
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
    console.log(`📥 chat-ia response status: ${resIA.status}`);
    console.log(`📥 chat-ia response length: ${raw?.length || 0}`);
    
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch (parseError) {
      console.error("❌ Error parseando JSON de chat-ia:", parseError.message);
      console.error("📥 Raw response:", raw?.slice(0, 500));
      throw new Error("chat-ia no devolvió JSON válido");
    }
    
    if (!resIA.ok) {
      console.error(`❌ chat-ia error ${resIA.status}:`, data?.error || raw);
      throw new Error(data?.error || `chat-ia error ${resIA.status}`);
    }
    
    console.log(`✅ chat-ia respondió correctamente`);
    return data;
  } catch (err) {
    console.error("❌ Error en llamarChatIA:", err.message || err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════
// DETECTOR DE PEDIDOS CONFIRMADOS
// ═══════════════════════════════════════════════════════════

function esMensajePedidoConfirmado(texto) {
  const t = clean(texto);
  const tieneMarcador = /✅\s*PEDIDO CONFIRMADO/i.test(t);
  const tieneProducto = /Producto:\s*\S/i.test(t);
  const tieneTotal = /Total:\s*\S/i.test(t);
  const tieneUbicacion = /Ubicaci[oó]n:\s*\S/i.test(t);
  return tieneMarcador && tieneProducto && tieneTotal && tieneUbicacion;
}

function esBloqueDatosBancarios(texto) {
  if (!texto) return false;
  const tn = normalize(texto);
  const señales = [
    "datos para transferencia",
    "datos de transferencia",
    "titular:",
    "titular ",
    "banco familiar",
    "banco continental",
    "banco itau",
    "banco gnb",
    "banco atlas",
    "banco regional",
    "banco basa",
    "ueno bank",
    "cuenta:",
    "nro de cuenta",
    "numero de cuenta",
    "alias:",
    "cbu:",
    "cvu:",
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
      "datos para transferencia",
      "titular",
      "banco ",
      "cuenta:",
      "alias:",
      "cbu:",
      "https://",
      "http://",
      "www.",
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
  const calce = get(/Calce:\s*([^\n]+)/i);
  const totalRaw = get(/Total:\s*([^\n]+)/i);

  const producto = limpiarProducto(productoRaw);

  const esProductoValido = (p) => {
    if (!p) return false;
    if (p.length > 200) return false;
    const blacklist = [
      "nunca decir",
      "ir directo",
      "→",
      "gracias por tu audio",
      "entendi que queres",
      "asuncion, hernandarias",
      "ypane, villeta",
      "datos para transferencia",
      "titular:",
      "alias:",
      "cuenta:",
      "banco familiar",
      "banco continental",
    ];
    const pn = normalize(p);
    return !blacklist.some((b) => pn.includes(b));
  };

  const esNombreValido = (n) => {
    if (!n) return false;
    if (n.length > 60) return false;
    const malosInicios = [
      "yo ",
      "es ",
      "dale ",
      "el de ",
      "la ",
      "no ",
      "si ",
      "quiero",
      "queria",
      "necesito",
      "me ",
    ];
    const nn = normalize(n);
    return !malosInicios.some((m) => nn.startsWith(m));
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

  let productoFinal = producto;
  if (calce && producto && !/calce/i.test(producto)) {
    productoFinal = `${producto} (Calce ${calce})`;
  }

  return {
    customer_name: esNombreValido(cliente) ? cliente : null,
    product: productoFinal,
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
      .eq("status", "confirmado")
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
        status: "confirmado",
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
      .eq("status", "confirmado")
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
// PROCESAR MENSAJE ENTRANTE - CON MANEJO DE INTERACTIVOS ✅
// ═══════════════════════════════════════════════════════════

export async function procesar(req, message, userId, from) {
  try {
    const tipoMsg = message.type;

    let texto = "";
    let mediaUrl = null;
    let messageType = "text";
    let mediaId = null;
    let mimeType = null;

    if (tipoMsg === "interactive") {
      const buttonText = message.interactive?.button_reply?.title || 
                         message.interactive?.list_reply?.title || 
                         message.interactive?.button_reply?.id || 
                         "";
      
      texto = clean(buttonText);
      messageType = "interactive";
      mediaId = null;
      mimeType = null;
      
      console.log(`🔘 Botón presionado: "${texto}"`);
      
      await saveReceivedMessage({
        userId,
        from,
        message: texto,
        messageType: "interactive",
        mediaUrl: null,
        waMessageId: message.id || null,
      });
      
      const disparado = await evaluarDisparadores({ userId, from, texto });
      if (disparado) {
        console.log("✅ Disparador atendió el mensaje del botón.");
        return { response: null, handled_by: "trigger", error: null };
      }
      
      const ctx = await getContexto(userId, from);
      const history = await getHistory(userId, from);
      
      let data = {};
      try {
        data = await llamarChatIA({ req, userId, texto, from, ctx, history });
      } catch (err) {
        console.error("❌ chat-ia error:", err);
        const fallbackMsg = "⚠️ Disculpá, hubo un error momentáneo. Escribime nuevamente.";
        await enviarMensaje(userId, from, fallbackMsg);
        await saveReceivedMessage({
          userId,
          from,
          message: fallbackMsg,
          messageType: "out_text",
        });
        return { response: fallbackMsg, error: err.message };
      }
      
      if (data?.context) await saveContexto(userId, from, data.context);
      
      if (data?.response) {
        const envioRespuesta = await enviarRespuestaSeparada(
          userId,
          from,
          data.response
        );
        if (envioRespuesta.sent) {          
          if (esMensajePedidoConfirmado(data.response)) {
            await detectarYGuardarPedidoConfirmado({
              userId,
              from,
              textoMensaje: data.response,
              sourceMessageId: null,
            });
          }
        }
        return { response: data.response, context: data.context };
      }
      
      const fallback = "👋 Gracias por tu respuesta. ¿En qué más puedo ayudarte?";
      await enviarMensaje(userId, from, fallback);
      await saveReceivedMessage({
        userId,
        from,
        message: fallback,
        messageType: "out_text",
      });
      return { response: fallback, error: null };
    }

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
      texto = clean(
        message.document?.caption || message.document?.filename || "[documento]"
      );
      mediaId = message.document?.id || null;
      mimeType = message.document?.mime_type || "application/octet-stream";
      messageType = "document";
    } else if (tipoMsg === "sticker") {
      texto = "[sticker]";
      mediaId = message.sticker?.id || null;
      mimeType = message.sticker?.mime_type || "image/webp";
      messageType = "image";
    } else if (tipoMsg === "location") {
      const loc = message.location || {};
      if (loc.address) {
        texto = clean(loc.address);
      } else if (loc.name) {
        texto = clean(loc.name);
      } else if (loc.latitude && loc.longitude) {
        texto = `📍 Ubicación: ${loc.latitude}, ${loc.longitude}`;
      } else {
        texto = "📍 Ubicación compartida";
      }
      messageType = "location";
    } else {
      console.log(`⚠️ Tipo de mensaje no soportado: ${tipoMsg}`);
      return { response: null, error: "Tipo no soportado" };
    }

    if (await isDuplicateMessage(message.id)) {
      console.log("⚠️ Duplicado ignorado");
      return { response: null, error: "Duplicado" };
    }

    if (mediaId) {
      const result = await descargarYSubirMedia({ userId, mediaId, mimeType, from });
      if (result) {
        mediaUrl = result.url;
        mimeType = result.mime || mimeType;
      } else {
        console.log("⚠️ No se pudo subir media, se guarda mensaje sin URL");
      }
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `📩 WhatsApp ${messageType}:`,
      from,
      texto,
      mediaUrl ? `→ ${mediaUrl.slice(0, 60)}...` : ""
    );

    const textoParaGuardar =
      texto ||
      (messageType === "image"
        ? "[imagen]"
        : messageType === "audio"
        ? "[audio]"
        : messageType === "video"
        ? "[video]"
        : messageType === "document"
        ? "[documento]"
        : "");

    await saveReceivedMessage({
      userId,
      from,
      message: textoParaGuardar,
      messageType,
      mediaUrl,
      waMessageId: message.id || null,
    });

    if (messageType === "text" || messageType === "location") {
      const disparado = await evaluarDisparadores({ userId, from, texto });
      if (disparado) {
        console.log("✅ Disparador atendió el mensaje. No se llama a Gemini.");
        return { response: null, handled_by: "trigger", error: null };
      }

      const ctx = await getContexto(userId, from);
      const history = await getHistory(userId, from);

      let data = {};
      try {
        data = await llamarChatIA({ req, userId, texto, from, ctx, history });
      } catch (err) {
        console.error("❌ chat-ia error:", err);
        const fallbackMsg = "⚠️ Disculpá, hubo un error momentáneo. Escribime nuevamente.";
        await enviarMensaje(userId, from, fallbackMsg);
        await saveReceivedMessage({
          userId,
          from,
          message: fallbackMsg,
          messageType: "out_text",
        });
        return { response: fallbackMsg, error: err.message };
      }

      if (data?.context) await saveContexto(userId, from, data.context);

      // ✅ FIX: si chat-ia devuelve media_urls (imágenes cargadas en
      // Entrenamiento para el producto), las mandamos antes del texto.
      // ✅ FIX: SOLO se envía la PRIMERA imagen (slice 0,1)
      if (Array.isArray(data?.media_urls) && data.media_urls.length > 0) {
        // Enviar SOLO la primera imagen (la principal)
        const url = data.media_urls[0];
        if (url) {
          const yaEnviada = await mediaFueEnviadaRecientemente(userId, from, url);
          if (yaEnviada) {
            console.log(`⏭️ chat-ia devolvió una imagen ya enviada; se omite: ${url}`);
          } else {
            const ok = await enviarMedia(userId, from, url, "image", "");
            if (ok) {
            await saveReceivedMessage({
              userId,
              from,
              message: `[image] ${url}`,
              messageType: "out_image",
              mediaUrl: url,
            });
            }
          }
        }
      }

      if (data?.response) {
        const envioRespuesta = await enviarRespuestaSeparada(
          userId,
          from,
          data.response
        );
        if (envioRespuesta.sent) {
          if (esMensajePedidoConfirmado(data.response)) {
            await detectarYGuardarPedidoConfirmado({
              userId,
              from,
              textoMensaje: data.response,
              sourceMessageId: null,
            });
          }
        }
        return { response: data.response, context: data.context, is_payment_proof: data.is_payment_proof };
      }

      const fallback = "👋 Hola! ¿En qué puedo ayudarte hoy?\n\n📋 Catálogo:\nhttps://cat-logomegatodo-com.vercel.app/";
      await enviarMensaje(userId, from, fallback);
      await saveReceivedMessage({
        userId,
        from,
        message: fallback,
        messageType: "out_text",
      });
      return { response: fallback, error: null };
    }

    if (messageType === "image" && mediaUrl) {
      asociarComprobanteAlPedido({ userId, from, mediaUrl }).catch((e) =>
        console.error("comprobante bg error:", e)
      );

      const ctx = await getContexto(userId, from);
      const history = await getHistory(userId, from);

      let data = {};
      try {
        data = await llamarChatIA({
          req,
          userId,
          texto: texto || "",
          from,
          ctx,
          history,
          mediaUrl,
          mediaType: "image",
          mimeType: mimeType,
        });
      } catch (err) {
        console.error("❌ chat-ia (image) error:", err);
        return { response: null, error: err.message };
      }

      if (data?.context) await saveContexto(userId, from, data.context);

      if (data?.is_payment_proof) {
        await asociarComprobanteAlPedido({ userId, from, mediaUrl });
      }

      if (data?.response) {
        const envioRespuesta = await enviarRespuestaSeparada(
          userId,
          from,
          data.response
        );
        if (envioRespuesta.sent) {
          if (esMensajePedidoConfirmado(data.response)) {
            await detectarYGuardarPedidoConfirmado({
              userId,
              from,
              textoMensaje: data.response,
              sourceMessageId: null,
            });
          }
        }
        return { response: data.response, context: data.context, is_payment_proof: data.is_payment_proof };
      }
      return { response: null, error: null };
    }

    if (messageType === "audio" && mediaUrl) {
      const ctx = await getContexto(userId, from);
      const history = await getHistory(userId, from);

      let data = {};
      try {
        data = await llamarChatIA({
          req,
          userId,
          texto: "",
          from,
          ctx,
          history,
          mediaUrl,
          mediaType: "audio",
          mimeType: mimeType,
        });
      } catch (err) {
        console.error("❌ chat-ia (audio) error:", err);
        return { response: null, error: err.message };
      }

      if (data?.context) await saveContexto(userId, from, data.context);

      if (data?.response) {
        const envioRespuesta = await enviarRespuestaSeparada(
          userId,
          from,
          data.response
        );
        if (envioRespuesta.sent) {
          if (esMensajePedidoConfirmado(data.response)) {
            await detectarYGuardarPedidoConfirmado({
              userId,
              from,
              textoMensaje: data.response,
              sourceMessageId: null,
            });
          }
        }
        return { response: data.response, context: data.context };
      }
      return { response: null, error: null };
    }

    console.log(`ℹ️ Mensaje ${messageType} guardado, no se procesa con IA`);
    return { response: null, error: null, handled_by: "no_ia" };
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

    if (mode === "subscribe" && token) {
      try {
        const { data: config, error } = await supabase
          .from("whatsapp_config")
          .select("user_id")
          .eq("webhook_token", token)
          .maybeSingle();

        if (error) {
          console.error("❌ Error buscando token en BD:", error);
          return res.status(500).send("Error interno");
        }

        if (config) {
          console.log(`✅ Webhook verificado para usuario: ${config.user_id}`);
          return res.status(200).send(challenge);
        } else {
          console.log(`❌ Token inválido en verificación: ${token}`);
          return res.status(403).send("Token inválido");
        }
      } catch (err) {
        console.error("❌ Error en verificación:", err);
        return res.status(500).send("Error interno");
      }
    }
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
