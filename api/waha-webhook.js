// api/waha-webhook.js — v4 FINAL CON FLUJO DE VENTAS COMPLETO
// Recibe eventos de WAHA (QR) y los procesa con la misma lógica que webhook.js
// + FALLBACK cuando chat-ia no responde
// + Flujo de ventas: producto → ciudad → cantidad → resumen

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = (process.env.WAHA_BASE_URL || "").replace(/\/$/, "");
const WAHA_API_KEY = process.env.WAHA_API_KEY || "";

const clean = (t) => String(t || "").trim();
const normalize = (t) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// ═══════════════════════════════════════════════════════════
// DETECTOR DE PRODUCTOS DESDE TEXTO
// ═══════════════════════════════════════════════════════════

function detectarProductoDesdeTexto(texto = "") {
  const t = normalize(texto);

  if (t.includes("limpiador") || t.includes("carbonilla") || t.includes("oven cleaner")) {
    return "Limpiador de Ollas y Carbonilla";
  }

  if (t.includes("perfume asad") || t.includes(" asad") || t === "asad") {
    return "Perfume Asad";
  }

  if (t.includes("veneno") || t.includes("abeja")) {
    return "Crema de Veneno de Abeja";
  }

  if (t.includes("peladora") || t.includes("pela papas")) {
    return "Peladora Automática";
  }

  if (t.includes("tabla") && (t.includes("picar") || t.includes("marmol"))) {
    return "Tabla de Picar de Mármol";
  }

  if (t.includes("destapa") || t.includes("tornado")) {
    return "Destapa Cañerías Tornado";
  }

  return "";
}

// ═══════════════════════════════════════════════════════════
// CIUDADES Y EXTRACCIÓN
// ═══════════════════════════════════════════════════════════

const CIUDADES_PARAGUAY = [
  "asuncion", "asunción", "san lorenzo", "fernando de la mora", "lambaré",
  "luque", "capiatá", "limpio", "Ñemby", "villa elisa", "san antonio",
  "mariano roque alonso", "itaugua", "ypane", "ypacarai", "aregua",
  "pirayu", "villeta", "ita", "guarambare", "encarnación", "ciudad del este",
  "hernandarias", "presidente franco", "minga guazú", "pedro juan caballero",
  "concepción", "coronel oviedo", "caaguazú", "villarrica", "caazapá", "pilar"
];

function extractCityFromText(text) {
  const t = normalize(text);
  
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
// ENVÍO DE MENSAJES POR WAHA
// ═══════════════════════════════════════════════════════════

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
  return parts.filter(p => p.length > 0);
}

async function enviarPorWAHA(chatId, texto) {
  try {
    const chatIdFormateado = chatId.includes("@c.us") || chatId.includes("@lid")
      ? chatId
      : `${chatId}@c.us`;

    const partes = splitMessage(texto, 3500);
    
    for (const parte of partes) {
      const response = await fetch(`${WAHA_BASE_URL}/api/sendText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": WAHA_API_KEY,
        },
        body: JSON.stringify({
          session: "default",
          chatId: chatIdFormateado,
          text: parte,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`❌ WAHA sendText error [${response.status}]:`, err);
        return false;
      }
    }

    console.log(`✅ Mensaje WAHA enviado a ${chatIdFormateado}`);
    return true;
  } catch (error) {
    console.error("❌ enviarPorWAHA error:", error.message);
    return false;
  }
}

async function enviarImagenWAHA(chatId, imageUrl, caption = "") {
  try {
    const chatIdFormateado = chatId.includes("@") ? chatId : `${chatId}@c.us`;
    await fetch(`${WAHA_BASE_URL}/api/sendImage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": WAHA_API_KEY,
      },
      body: JSON.stringify({
        session: "default",
        chatId: chatIdFormateado,
        file: { url: imageUrl },
        caption,
      }),
    });
  } catch (err) {
    console.error("❌ enviarImagenWAHA error:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// CONTEXTO E HISTORIAL
// ═══════════════════════════════════════════════════════════

async function getUserId() {
  const { data: session } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("session_name", "default")
    .eq("status", "connected")
    .maybeSingle();

  if (session?.user_id) return session.user_id;

  const { data: fallback } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("session_name", "default")
    .maybeSingle();

  return fallback?.user_id || null;
}

async function saveMessage({ userId, from, message, messageType = "text", mediaUrl = null }) {
  try {
    const numero = String(from).replace(/@c\.us$|@lid$/, "");
    await supabase.from("inbox_messages").insert({
      user_id: userId,
      source: "whatsapp_qr",
      platform: "whatsapp",
      sender_id: numero,
      sender_name: numero,
      from_number: numero,
      message: clean(message),
      message_type: messageType,
      media_url: mediaUrl || null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ saveMessage error:", err.message);
  }
}

async function getContexto(userId, from) {
  const numero = String(from).replace(/@c\.us$|@lid$/, "");
  const { data } = await supabase
    .from("chat_context")
    .select("*")
    .eq("user_id", userId)
    .eq("from_number", numero)
    .maybeSingle();
  return data || {};
}

async function saveContexto(userId, from, ctx = {}) {
  const numero = String(from).replace(/@c\.us$|@lid$/, "");
  await supabase.from("chat_context").upsert(
    {
      user_id: userId,
      from_number: numero,
      last_topic: ctx?.last_topic || null,
      last_trigger: ctx?.last_trigger || null,
      current_product: ctx?.current_product || null,
      step: ctx?.step || null,
      order_data: ctx?.order_data || {},
      last_user_product: ctx?.last_user_product || ctx?.current_product || null,
      tipo_cobertura: ctx?.tipo_cobertura || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,from_number" }
  );
}

async function getHistory(userId, from) {
  const numero = String(from).replace(/@c\.us$|@lid$/, "");
  const { data } = await supabase
    .from("inbox_messages")
    .select("message, message_type, created_at")
    .eq("user_id", userId)
    .eq("sender_id", numero)
    .order("created_at", { ascending: false })
    .limit(20);

  return (data || [])
    .reverse()
    .filter((h) => h.message && h.message_type !== "image" && h.message_type !== "audio")
    .map((h) => ({
      role: (h.message_type || "").startsWith("out_") ? "assistant" : "user",
      content: String(h.message),
    }));
}

// ═══════════════════════════════════════════════════════════
// BUILDERS DE RESPUESTAS
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

function buildOrderSummary(order, totalAmount) {
  const items = order.items || [{ name: order.product, qty: order.quantity || 1 }];
  const itemsList = items.map((i) => `• ${i.name} x${i.qty}`).join("\n");
  
  return `✅ *PEDIDO CONFIRMADO*\n\n📦 *Producto:*\n${itemsList}\n\n👤 *Cliente:* ${order.customer_name || "—"}\n📍 *Ubicación:* ${order.city || "—"} ${order.address ? `— ${order.address}` : ""}\n📞 *Contacto:* ${order.phone || "—"}\n🔢 *Cantidad total:* ${items.reduce((s, i) => s + i.qty, 0)}\n💰 *Total:* ${totalAmount.toLocaleString()} Gs\n\n✅ ¿Todo correcto? Envíanos el comprobante de pago para confirmar tu pedido.`;
}

// ═══════════════════════════════════════════════════════════
// PROCESAR MENSAJE CON FLUJO COMPLETO
// ═══════════════════════════════════════════════════════════

async function procesarMensaje({ host, userId, from, texto, mediaUrl = null, mediaType = null }) {
  const numero = from.replace(/@c\.us$|@lid$/, "");

  // Guardar mensaje entrante
  await saveMessage({
    userId,
    from: numero,
    message: texto || (mediaType ? `[${mediaType}]` : ""),
    messageType: mediaType || "text",
    mediaUrl,
  });

  // Obtener contexto actual
  let ctx = await getContexto(userId, numero);
  const previousStep = ctx?.step || null;
  const currentActiveProduct = ctx?.current_product || ctx?.last_user_product || null;
  const oldOrder = ctx?.order_data || {};

  console.log(`📊 Contexto: step=${previousStep}, product=${currentActiveProduct}`);

  // ═══════════════════════════════════════════════════════════
  // A. "quiero 1" con producto activo → directo a cantidad/ciudad
  // ═══════════════════════════════════════════════════════════
  const qFromBuy = texto.match(/^\s*(quiero|llevo|dame|mandame|compro)\s+(\d{1,3})\s*$/i);
  
  if (qFromBuy && currentActiveProduct && !mediaUrl) {
    const cantidad = Number(qFromBuy[2]);
    const order = {
      ...oldOrder,
      product: currentActiveProduct,
      quantity: cantidad,
    };

    // Si falta ciudad, preguntar ciudad
    if (!order.city) {
      console.log(`🛍️ "quiero ${cantidad}" con producto "${currentActiveProduct}" → falta ciudad`);
      const response = buildCityQuestionResponse(currentActiveProduct);
      await enviarPorWAHA(from, response);
      await saveMessage({ userId, from: numero, message: response, messageType: "out_text" });
      await saveContexto(userId, numero, {
        ...ctx,
        step: "collecting_city",
        current_product: currentActiveProduct,
        last_user_product: currentActiveProduct,
        last_topic: currentActiveProduct,
        order_data: order,
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // Si tiene ciudad, mostrar resumen
    console.log(`🛍️ "quiero ${cantidad}" con producto "${currentActiveProduct}" → mostrar resumen`);
    const totalAmount = 50000 * cantidad; // Placeholder, ajustar según producto
    const response = buildOrderSummary({ ...order, city: order.city, quantity: cantidad }, totalAmount);
    await enviarPorWAHA(from, response);
    await saveMessage({ userId, from: numero, message: response, messageType: "out_text" });
    await saveContexto(userId, numero, {
      ...ctx,
      step: "awaiting_payment",
      current_product: currentActiveProduct,
      order_data: { ...order, quantity: cantidad, items: [{ name: currentActiveProduct, qty: cantidad }] },
      updated_at: new Date().toISOString(),
    });
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // B. Esperando ciudad → extraer ciudad y avanzar
  // ═══════════════════════════════════════════════════════════
  if (previousStep === "collecting_city" && !mediaUrl) {
    const city = extractCityFromText(texto);
    
    if (city && currentActiveProduct) {
      console.log(`📍 Ciudad detectada: "${city}" para producto "${currentActiveProduct}"`);
      
      const order = {
        ...oldOrder,
        product: currentActiveProduct,
        city,
        quantity: oldOrder?.quantity || 0,
      };
      
      const response = buildQuantityAfterCityResponse(currentActiveProduct, city);
      await enviarPorWAHA(from, response);
      await saveMessage({ userId, from: numero, message: response, messageType: "out_text" });
      await saveContexto(userId, numero, {
        ...ctx,
        step: "collecting_quantity",
        current_product: currentActiveProduct,
        last_user_product: currentActiveProduct,
        last_topic: currentActiveProduct,
        tipo_cobertura: getTipoCobertura(city),
        order_data: order,
        updated_at: new Date().toISOString(),
      });
      return;
    }
    
    // No se detectó ciudad, repetir pregunta
    if (!city && texto.trim()) {
      console.log(`📍 No se detectó ciudad en: "${texto}"`);
      const response = `📍 No entendí la ciudad. ¿Podés decirme en qué ciudad querés recibir tu pedido?\n\n📝 Ejemplos: Asunción, San Lorenzo, Fernando de la Mora, Lambaré`;
      await enviarPorWAHA(from, response);
      await saveMessage({ userId, from: numero, message: response, messageType: "out_text" });
      return;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // C. Esperando cantidad → procesar cantidad
  // ═══════════════════════════════════════════════════════════
  if (previousStep === "collecting_quantity" && !mediaUrl && currentActiveProduct) {
    const cantidadMatch = texto.match(/(\d+)/);
    if (cantidadMatch) {
      const cantidad = parseInt(cantidadMatch[1], 10);
      console.log(`🔢 Cantidad detectada: ${cantidad} para ${currentActiveProduct}`);
      
      const totalAmount = 50000 * cantidad; // Placeholder
      const response = buildOrderSummary({ ...oldOrder, quantity: cantidad, items: [{ name: currentActiveProduct, qty: cantidad }] }, totalAmount);
      await enviarPorWAHA(from, response);
      await saveMessage({ userId, from: numero, message: response, messageType: "out_text" });
      await saveContexto(userId, numero, {
        ...ctx,
        step: "awaiting_payment",
        order_data: { ...oldOrder, quantity: cantidad, items: [{ name: currentActiveProduct, qty: cantidad }] },
        updated_at: new Date().toISOString(),
      });
      return;
    } else {
      const response = "🔢 Por favor, indicame cuántas unidades querés. Ejemplo: 'Quiero 2' o '2 unidades'";
      await enviarPorWAHA(from, response);
      await saveMessage({ userId, from: numero, message: response, messageType: "out_text" });
      return;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // D. Detectar producto si no hay producto activo
  // ═══════════════════════════════════════════════════════════
  let detectedProduct = null;
  
  if (!currentActiveProduct && texto && !mediaUrl) {
    detectedProduct = detectarProductoDesdeTexto(texto);
    
    if (detectedProduct) {
      console.log(`🛍️ Producto detectado: "${detectedProduct}"`);
      const response = buildCityQuestionResponse(detectedProduct);
      await enviarPorWAHA(from, response);
      await saveMessage({ userId, from: numero, message: response, messageType: "out_text" });
      await saveContexto(userId, numero, {
        ...ctx,
        step: "collecting_city",
        current_product: detectedProduct,
        last_user_product: detectedProduct,
        last_topic: detectedProduct,
        order_data: { product: detectedProduct, quantity: 0, city: "", items: [] },
        updated_at: new Date().toISOString(),
      });
      return;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // E. Intentar llamar a chat-ia (con fallback)
  // ═══════════════════════════════════════════════════════════
  
  // Solo llamar a IA si hay texto o media
  if (texto || mediaUrl) {
    try {
      const chatIaUrl = `https://${host}/api/chat-ia`;
      const history = await getHistory(userId, numero);
      
      console.log(`📡 Llamando a chat-ia: ${chatIaUrl}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      
      const response = await fetch(chatIaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          from_number: numero,
          message: texto || "",
          context: ctx,
          history: history,
          media_url: mediaUrl,
          media_type: mediaType,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`chat-ia error ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data?.context) await saveContexto(userId, numero, data.context);
      
      if (data?.response) {
        await enviarPorWAHA(from, data.response);
        await saveMessage({ userId, from: numero, message: data.response, messageType: "out_text" });
        console.log(`💬 IA respondió a ${numero}`);
        return;
      }
    } catch (err) {
      console.error("❌ chat-ia error:", err.message);
      // Fallback a respuesta genérica
      const fallback = "👋 ¡Hola! ¿En qué producto estás interesado?\n\n📋 *Productos disponibles:*\n• Limpiador de Ollas y Carbonilla\n• Perfume Asad\n• Crema de Veneno de Abeja\n• Peladora Automática\n• Tabla de Picar de Mármol\n• Destapa Cañerías Tornado\n\n💬 Escribime el nombre del producto que te interesa.";
      await enviarPorWAHA(from, fallback);
      await saveMessage({ userId, from: numero, message: fallback, messageType: "out_text" });
      return;
    }
  }

  // Fallback final
  const fallback = "👋 ¡Hola! ¿En qué puedo ayudarte hoy?\n\n📋 *Productos disponibles:*\n• Limpiador de Ollas y Carbonilla\n• Perfume Asad\n• Crema de Veneno de Abeja\n• Peladora Automática\n• Tabla de Picar de Mármol\n• Destapa Cañerías Tornado\n\n💬 Escribime el nombre del producto que te interesa.";
  await enviarPorWAHA(from, fallback);
  await saveMessage({ userId, from: numero, message: fallback, messageType: "out_text" });
}

// ═══════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  // Responder inmediatamente a WAHA (evita timeouts)
  res.status(200).send("OK");

  try {
    const body = req.body;
    const event = body?.event;
    const payload = body?.payload || {};

    console.log(`📡 WAHA evento: ${event}`);

    // Actualizar estado de sesión
    if (event === "session.status") {
      const wahaStatus = payload.status;
      const statusMap = {
        STARTING: "starting",
        SCAN_QR_CODE: "pending_qr",
        WORKING: "connected",
        STOPPED: "disconnected",
        FAILED: "failed",
      };
      const dbStatus = statusMap[wahaStatus] || "disconnected";

      await supabase
        .from("whatsapp_qr_sessions")
        .update({ status: dbStatus, last_event_at: new Date().toISOString() })
        .eq("session_name", "default");

      console.log(`📊 Sesión WAHA: ${wahaStatus} → ${dbStatus}`);
      return;
    }

    // Procesar mensajes
    if (event === "message" || event === "message.any") {
      if (payload.fromMe) {
        console.log("📌 Mensaje propio, ignorado.");
        return;
      }

      const from = payload.from || "";
      const texto = payload.body || "";
      const host = req.headers.host || "bot-seller-skyline-2026.vercel.app";

      if (!from) {
        console.log("⚠️ Mensaje sin 'from', ignorado.");
        return;
      }

      const hasText = texto && texto.trim().length > 0;
      const hasMedia = payload.hasMedia && payload.media?.url;
      
      if (!hasText && !hasMedia) {
        console.log(`📌 Sin contenido, ignorado.`);
        return;
      }

      const userId = await getUserId();
      if (!userId) {
        console.error("❌ No se encontró user_id para la sesión WAHA.");
        return;
      }

      let mediaUrl = null;
      let mediaType = null;

      if (payload.media?.url) {
        mediaUrl = payload.media.url;
        if (payload.type === "image") mediaType = "image";
        else if (payload.type === "audio") mediaType = "audio";
        else if (payload.type === "video") mediaType = "video";
      }

      console.log(`📨 WAHA: ${from.replace(/@c\.us$/, "")} → "${texto.slice(0, 80)}"`);

      // Procesar en background
      procesarMensaje({ host, userId, from, texto, mediaUrl, mediaType }).catch((err) =>
        console.error("❌ procesarMensaje error:", err.message)
      );

      return;
    }

    console.log(`ℹ️ Evento WAHA no manejado: ${event}`);
  } catch (err) {
    console.error("❌ waha-webhook handler error:", err.message);
  }
}
