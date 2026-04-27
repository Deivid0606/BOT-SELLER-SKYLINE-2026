// api/webhook.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = "miTokenSeguro2026";
const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
const STORAGE_BUCKET_COMPROBANTES = "comprobantes";

const clean = (t) => String(t || "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normalize = (t) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

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
      // Campos EXACTOS que lee tu Apps Script
      customer_name: clean(order.customer_name),
      customer_phone: clean(order.phone || order.from_number),
      customer_city: clean(order.city),
      product: clean(order.product),
      quantity: order.quantity || 1,
      total_amount: order.total_amount || "",
      customer_address: clean(order.address),
      note: clean(nota),

      // Campos extra compatibles por si luego cambias el Apps Script
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
  console.log(`📦 Plantilla "${plantilla?.name || templateName}" → ${imagenes.length} img, video: ${!!video}, gif: ${!!gif}`);

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
        userId, from,
        message: mensajeFinal,
        messageType: "out_text",
      });
    }
  }

  if (video) {
    const ok = await enviarMedia(userId, from, video, "video", "");
    if (ok) {
      await saveReceivedMessage({
        userId, from,
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
        userId, from,
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

    for (const trig of triggers) {
      const matchPrimary = matchKeywords(trig.condition, trig.type, textoNorm);
      const matchSecondary = matchSecundario(trig.secondary, textoNorm);

      if (!matchPrimary && !matchSecondary) continue;

      console.log(`🎯 Disparador MATCH: "${trig.name}" → primary=${matchPrimary} secondary=${matchSecondary}`);

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

      // 🆕 Revisar AMBOS contenidos (primary + secondary) por confirmación de pedido
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

      await saveContexto(userId, from, { last_trigger: trig.name });
      return true;
    }

    return false;
  } catch (err) {
    console.error("❌ evaluarDisparadores error:", err);
    return false;
  }
}

async function llamarChatIA({ req, userId, texto, from, ctx, history }) {
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
    }),
  });
  const raw = await resIA.text();
  let data = {};
  try { data = JSON.parse(raw); } catch { throw new Error("chat-ia no devolvió JSON"); }
  if (!resIA.ok) throw new Error(data?.error || `chat-ia error ${resIA.status}`);
  return data;
}

// ═══════════════════════════════════════════════════════════
// 🆕 DETECTOR DE PEDIDOS CONFIRMADOS (Opción C — Mixto)
// ═══════════════════════════════════════════════════════════

function esMensajePedidoConfirmado(texto) {
  const t = clean(texto);
  const tieneMarcador = /✅\s*PEDIDO CONFIRMADO/i.test(t);
  const tieneProducto = /Producto:\s*\S/i.test(t);
  const tieneTotal = /Total:\s*\S/i.test(t);
  const tieneUbicacion = /Ubicaci[oó]n:\s*\S/i.test(t);
  return tieneMarcador && tieneProducto && tieneTotal && tieneUbicacion;
}

// 🆕 Detecta si un texto es bloque de datos bancarios / transferencia
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

// 🆕 Limpia el texto del producto: quita bloque bancario y datos sueltos
function limpiarProducto(productoRaw) {
  if (!productoRaw) return null;
  let p = clean(productoRaw);

  // Si es claramente un bloque bancario, descartar todo
  if (esBloqueDatosBancarios(p)) {
    // Intentar rescatar nombres de productos después del bloque bancario
    // Buscar separadores tipo " + Producto x1" después de los datos bancarios
    const idxAlias = p.search(/alias:\s*\d+/i);
    if (idxAlias >= 0) {
      // Cortar a partir del primer "+" después del Alias
      const restoDespuesAlias = p.substring(idxAlias);
      const idxPlus = restoDespuesAlias.indexOf("+");
      if (idxPlus >= 0) {
        p = restoDespuesAlias.substring(idxPlus + 1).trim();
      } else {
        return null; // solo había datos bancarios, sin productos
      }
    } else {
      return null;
    }
  }

  // Partir por "+" y filtrar items que parezcan basura bancaria
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

  // 🆕 Limpiar producto de datos bancarios ANTES de validar
  const producto = limpiarProducto(productoRaw);

  const esProductoValido = (p) => {
    if (!p) return false;
    if (p.length > 200) return false;
    const blacklist = [
      "nunca decir", "ir directo", "→", "gracias por tu audio",
      "entendi que queres", "asuncion, hernandarias", "ypane, villeta",
      "datos para transferencia", "titular:", "alias:", "cuenta:",
      "banco familiar", "banco continental",
    ];
    const pn = normalize(p);
    return !blacklist.some((b) => pn.includes(b));
  };

  const esNombreValido = (n) => {
    if (!n) return false;
    if (n.length > 60) return false;
    const malosInicios = [
      "yo ", "es ", "dale ", "el de ", "la ", "no ", "si ",
      "quiero", "queria", "necesito", "me ",
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

// ───────────────────────────────────────────────────────────
// 🛒 Helpers para manejar el campo "product" como carrito
// Formato: "Veneno de Abeja x2 + Plantilla Ortopiex x1"
// ───────────────────────────────────────────────────────────

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
      // 🆕 filtrar items que sean datos bancarios
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

// 🆕 Parsea "A x1 + B x2" como múltiples items individuales
function expandirItemsDelMensaje(productoFinal, quantityFallback) {
  const items = parsearCarrito(productoFinal);
  if (items.length === 0) return [];
  // Si solo hay 1 item y no traía xN explícito, usar quantityFallback
  if (items.length === 1 && !/x\s*\d+\s*$/i.test(productoFinal)) {
    items[0].qty = quantityFallback || items[0].qty || 1;
  }
  return items;
}

// ───────────────────────────────────────────────────────────

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

    // 🆕 Expandir productos múltiples ("A x1 + B x1") en items separados
    const itemsNuevos = expandirItemsDelMensaje(datos.product, datos.quantity);
    if (itemsNuevos.length === 0) {
      console.log("🚫 No quedaron items válidos tras expandir");
      return;
    }

    // Buscar pedido reciente del mismo cliente (última 1 hora)
    // Si pasó más de 1h desde el último pedido → se considera un pedido NUEVO,
    // aunque el cliente vuelva a escribir el mismo número.
    // Además solo agrupamos si el pedido sigue en estado "confirmado" (carrito abierto).
    // Si ya está "cargado", "droppx" o cualquier estado cerrado, no se toca: se crea uno nuevo.
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

    // ─── No hay pedido reciente → crear uno nuevo ───
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

    // ─── Hay pedido reciente → modo carrito ───
    // 🆕 Limpiar el carrito existente de basura bancaria que pudiera haberse colado antes
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

    // Total: si el mensaje trae un total nuevo y mayor, usarlo (es el total acumulado del bot)
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
      return;
    }

    if (pedido.comprobante_url) {
      console.log("ℹ️ El pedido ya tiene comprobante, no sobrescribo");
      return;
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
      return;
    }

    console.log(`💳 Comprobante asociado al pedido ${pedido.id}`);
  } catch (err) {
    console.error("❌ asociarComprobanteAlPedido error:", err);
  }
}

// ═══════════════════════════════════════════════════════════
// 🖼️ SISTEMA DE PROCESAMIENTO DE IMÁGENES + IA VISUAL
// ═══════════════════════════════════════════════════════════

// 1) Descarga el binario de una imagen desde la API de WhatsApp
async function descargarMediaWhatsapp(userId, mediaId) {
  try {
    const { data: config } = await supabase
      .from("whatsapp_config")
      .select("permanent_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (!config?.permanent_token) return null;
    const token = config.permanent_token.trim();

    // Paso 1: obtener URL temporal del media
    const metaRes = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      console.error("❌ media meta:", metaRes.status, await metaRes.text());
      return null;
    }
    const meta = await metaRes.json();
    if (!meta.url) return null;

    // Paso 2: descargar el binario (también requiere auth)
    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!binRes.ok) {
      console.error("❌ media bin:", binRes.status);
      return null;
    }
    const arrayBuf = await binRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const mimeType = meta.mime_type || "image/jpeg";
    return { buffer, mimeType, sizeBytes: buffer.length };
  } catch (err) {
    console.error("❌ descargarMediaWhatsapp:", err);
    return null;
  }
}

// 2) Sube el comprobante a Supabase Storage y devuelve URL pública
async function subirComprobanteAStorage({ userId, from, buffer, mimeType }) {
  try {
    const ext = (mimeType.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const fileName = `${userId}/${from}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET_COMPROBANTES)
      .upload(fileName, buffer, { contentType: mimeType, upsert: false });
    if (error) {
      console.error("❌ storage upload:", error);
      return null;
    }
    const { data: pub } = supabase.storage
      .from(STORAGE_BUCKET_COMPROBANTES)
      .getPublicUrl(fileName);
    return pub?.publicUrl || null;
  } catch (err) {
    console.error("❌ subirComprobanteAStorage:", err);
    return null;
  }
}

// 3) Extrae el bloque de "datos bancarios" del entrenamiento del vendedor
async function cargarEntrenamiento(userId) {
  try {
    const { data } = await supabase
      .from("training_data")
      .select("response")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return clean(data?.response || "");
  } catch (err) {
    console.error("❌ cargarEntrenamiento:", err);
    return "";
  }
}

// Heurística: busca un bloque que contenga "datos bancarios", "transferencia",
// "cuenta", "banco", "titular" y devuelve hasta ~25 líneas alrededor.
function extraerDatosBancariosDelEntrenamiento(training) {
  if (!training) return "";
  const lines = training.split("\n");
  const lower = lines.map((l) => normalize(l));
  const palabrasClave = [
    "datos bancarios", "datos para transferir", "datos para transferencia",
    "datos para deposito", "datos para depósito", "transferencia bancaria",
    "cuenta bancaria", "metodo de pago", "métodos de pago", "metodos de pago",
    "forma de pago", "formas de pago", "cuenta corriente", "caja de ahorro",
  ];
  let startIdx = -1;
  for (let i = 0; i < lower.length; i++) {
    if (palabrasClave.some((p) => lower[i].includes(p))) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    // fallback: filtrar líneas que mencionen bancos típicos paraguayos / titulares
    const bancos = ["itau", "itaú", "ueno", "vision", "visión", "continental",
      "atlas", "familiar", "regional", "banco", "tigo money", "personal pay",
      "billetera", "wally", "zimple", "giros tigo", "claro pay"];
    const filtradas = lines.filter((l, i) =>
      bancos.some((b) => lower[i].includes(b)) ||
      /\b(c[íi]\.?\s*\d|ruc|c\.?c\.?|c\.?a\.?)\b/i.test(lower[i])
    );
    return filtradas.slice(0, 25).join("\n");
  }
  // Tomar 25 líneas a partir del match (o hasta encontrar línea muy en blanco doble)
  const bloque = [];
  for (let i = startIdx; i < Math.min(startIdx + 25, lines.length); i++) {
    bloque.push(lines[i]);
    if (i > startIdx && lines[i].trim() === "" && lines[i - 1]?.trim() === "") break;
  }
  return bloque.join("\n").trim();
}

// 4) Llama a Lovable AI Gateway con la imagen + tool calling para JSON estructurado
async function analizarImagenConIA({ buffer, mimeType, datosBancarios }) {
  if (!LOVABLE_API_KEY) {
    console.error("❌ Falta LOVABLE_API_KEY");
    return null;
  }
  try {
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const systemPrompt = `Sos un asistente que analiza imágenes recibidas por WhatsApp en una tienda paraguaya.
Tu tarea: determinar si la imagen es un COMPROBANTE DE PAGO (transferencia bancaria, depósito, captura de billetera Tigo Money / Personal Pay / Zimple / Wally / Claro Pay, etc.) o cualquier otra cosa (foto de producto, captura de chat, meme, foto personal, documento, etc.).

Si es comprobante: extraé titular destino, banco/billetera destino, monto, fecha y número de operación si se ven.
Si NO es comprobante: describí brevemente qué se ve en la imagen para que el bot pueda responder al cliente.

DATOS BANCARIOS DEL VENDEDOR (contra los que hay que validar el destino):
${datosBancarios || "(no disponibles)"}

Comparación: si el titular o banco/billetera del comprobante coincide con alguno del vendedor (ignorá mayúsculas/acentos/espacios), marcá datos_coinciden=true.`;

    const body = {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Analizá esta imagen y devolvé el resultado usando la función analizar_imagen." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "analizar_imagen",
          description: "Devuelve el análisis de la imagen recibida por WhatsApp.",
          parameters: {
            type: "object",
            properties: {
              es_comprobante: { type: "boolean", description: "true si la imagen es un comprobante de pago/transferencia/billetera" },
              datos_coinciden: { type: "boolean", description: "true solo si el titular o banco destino coincide con los datos del vendedor" },
              titular_destino: { type: "string", description: "Nombre del titular/cuenta destino tal como aparece en el comprobante. Vacío si no es comprobante." },
              banco_destino: { type: "string", description: "Banco o billetera destino (Itaú, Ueno, Tigo Money, etc.). Vacío si no aplica." },
              monto: { type: "number", description: "Monto en guaraníes. 0 si no se ve." },
              fecha: { type: "string", description: "Fecha del comprobante en formato YYYY-MM-DD. Vacío si no se ve." },
              numero_operacion: { type: "string", description: "Número de operación / referencia. Vacío si no se ve." },
              descripcion_imagen: { type: "string", description: "Si NO es comprobante: descripción breve (máx 200 chars) de qué se ve. Si es comprobante: vacío." },
            },
            required: ["es_comprobante", "datos_coinciden", "titular_destino", "banco_destino", "monto", "fecha", "numero_operacion", "descripcion_imagen"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "analizar_imagen" } },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("❌ Lovable AI:", res.status, t.slice(0, 400));
      return null;
    }
    const data = await res.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("❌ Sin tool_call en respuesta IA");
      return null;
    }
    return JSON.parse(toolCall.function.arguments);
  } catch (err) {
    console.error("❌ analizarImagenConIA:", err);
    return null;
  }
}

// 5) Flujo completo cuando llega una imagen
async function procesarImagenEntrante({ userId, from, mediaId, caption }) {
  try {
    // a) Descargar de WhatsApp
    const media = await descargarMediaWhatsapp(userId, mediaId);
    if (!media) {
      await enviarMensaje(userId, from, "⚠️ No pude descargar la imagen, ¿podés reenviarla?");
      return;
    }

    // b) Subir a storage
    const publicUrl = await subirComprobanteAStorage({
      userId, from, buffer: media.buffer, mimeType: media.mimeType,
    });

    // c) Cargar datos bancarios desde el entrenamiento del vendedor
    const training = await cargarEntrenamiento(userId);
    const datosBancarios = extraerDatosBancariosDelEntrenamiento(training);
    console.log("🏦 Datos bancarios detectados:", datosBancarios.slice(0, 200));

    // d) Analizar con IA
    const analisis = await analizarImagenConIA({
      buffer: media.buffer,
      mimeType: media.mimeType,
      datosBancarios,
    });

    if (!analisis) {
      await enviarMensaje(userId, from, "⚠️ Recibí tu imagen pero no pude analizarla. Te respondo enseguida 🙏");
      return;
    }

    console.log("🔍 Análisis IA:", JSON.stringify(analisis));

    // e) Decidir según el caso
    if (analisis.es_comprobante) {
      // Buscar pedido reciente del cliente
      const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: pedido } = await supabase
        .from("orders")
        .select("id, comprobante_url, customer_name, product")
        .eq("user_id", userId)
        .eq("from_number", from)
        .gte("created_at", hace24h)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Asociar siempre que haya pedido (aunque no matchee, para revisión manual)
      if (pedido && publicUrl && !pedido.comprobante_url) {
        await supabase.from("orders").update({
          comprobante_url: publicUrl,
          metodo_pago: "transferencia",
          comprobante_titular: analisis.titular_destino || null,
          comprobante_banco: analisis.banco_destino || null,
          comprobante_monto: analisis.monto || null,
          comprobante_validado: !!analisis.datos_coinciden,
          updated_at: new Date().toISOString(),
        }).eq("id", pedido.id);
        console.log(`💳 Comprobante asociado al pedido ${pedido.id} | match=${analisis.datos_coinciden}`);
      }

      // Responder al cliente
      let respuesta;
      if (analisis.datos_coinciden) {
        respuesta = `✅ ¡Perfecto! Recibí tu comprobante${analisis.titular_destino ? ` a nombre de *${analisis.titular_destino}*` : ""}${analisis.monto ? ` por *Gs. ${Number(analisis.monto).toLocaleString("es-PY")}*` : ""}.\n\nLo verifico y te confirmo el envío en breve 📦🙌`;
      } else {
        respuesta = `📩 Recibí tu comprobante${analisis.titular_destino ? ` a nombre de *${analisis.titular_destino}*` : ""}, pero los datos no coinciden con los míos. ¿Podrías revisar que hayas transferido a la cuenta correcta? 🙏\n\nSi ya transferiste y estás seguro, avisame y lo verifico manualmente.`;
      }
      await enviarMensaje(userId, from, respuesta);
      await saveReceivedMessage({ userId, from, message: respuesta, messageType: "out_text" });
      return;
    }

    // NO es comprobante → pasarle a la IA conversacional con la descripción
    const textoVirtual = caption
      ? `[el cliente envió una imagen con texto: "${caption}". Descripción de la imagen: ${analisis.descripcion_imagen}]`
      : `[el cliente envió una imagen. Descripción: ${analisis.descripcion_imagen}]`;

    const ctx = await getContexto(userId, from);
    const history = await getHistory(userId, from);
    let data = {};
    try {
      data = await llamarChatIA({ userId, texto: textoVirtual, from, ctx, history });
    } catch (err) {
      console.error("❌ chat-ia (imagen) error:", err);
    }
    if (data?.context) await saveContexto(userId, from, data.context);
    const respuesta = data?.response || `Recibí tu imagen 👀 ¿En qué te puedo ayudar?`;
    await enviarMensaje(userId, from, respuesta);
    await saveReceivedMessage({ userId, from, message: respuesta, messageType: "out_text" });
  } catch (err) {
    console.error("❌ procesarImagenEntrante:", err);
  }
}

// ═══════════════════════════════════════════════════════════

async function procesar(req, message, userId, from) {
  try {
    const tipoMsg = message.type;

    let texto = "";
    let mediaUrl = null;
    let mediaIdEntrante = null;
    let captionImagen = "";

    if (tipoMsg === "text") {
      texto = clean(message.text?.body || "");
    } else if (tipoMsg === "image") {
      captionImagen = clean(message.image?.caption || "");
      texto = captionImagen || "[imagen]";
      mediaIdEntrante = message.image?.id || null;
      mediaUrl = mediaIdEntrante ? `wa_media:${mediaIdEntrante}` : null;
    } else {
      return;
    }

    if (!texto && !mediaUrl) return;

    console.log("━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📩 WhatsApp recibido:", from, texto, mediaUrl ? "(con media)" : "");

    if (await isDuplicateMessage(message.id)) {
      console.log("⚠️ Duplicado ignorado");
      return;
    }

    const sourceMessageId = await saveReceivedMessage({
      userId, from,
      message: texto,
      messageType: tipoMsg === "image" ? "image" : "text",
      mediaUrl,
      waMessageId: message.id || null,
    });

    if (tipoMsg === "image" && mediaIdEntrante) {
      // Flujo completo: descarga + storage + IA visual + respuesta
      await procesarImagenEntrante({
        userId, from,
        mediaId: mediaIdEntrante,
        caption: captionImagen,
      });
      return;
    }

    const disparado = await evaluarDisparadores({ userId, from, texto });
    if (disparado) {
      console.log("✅ Disparador atendió el mensaje. No se llama a Gemini.");
      return;
    }

    const ctx = await getContexto(userId, from);
    const history = await getHistory(userId, from);

    let data = {};
    try {
      data = await llamarChatIA({ req, userId, texto, from, ctx, history });
    } catch (err) {
      console.error("❌ chat-ia error:", err);
      await enviarMensaje(userId, from, "⚠️ Disculpá, hubo un error momentáneo. Escribime nuevamente.");
      return;
    }

    if (data?.context) await saveContexto(userId, from, data.context);

    if (data?.response) {
      const sent = await enviarMensaje(userId, from, data.response);
      if (sent) {
        await saveReceivedMessage({
          userId, from,
          message: data.response,
          messageType: "out_text",
        });

        if (esMensajePedidoConfirmado(data.response)) {
          await detectarYGuardarPedidoConfirmado({
            userId,
            from,
            textoMensaje: data.response,
            sourceMessageId: null,
          });
        }
      }
      return;
    }

    const fallback = "👋 Hola! ¿En qué puedo ayudarte hoy?\n\n📋 Catálogo:\nhttps://cat-logomegatodo-com.vercel.app/";
    await enviarMensaje(userId, from, fallback);
    await saveReceivedMessage({ userId, from, message: fallback, messageType: "out_text" });
  } catch (err) {
    console.error("❌ procesar error:", err);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Token inválido");
  }

  if (req.method === "POST") {
    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return res.status(404).send("Not WhatsApp");

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
