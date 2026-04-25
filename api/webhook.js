// api/webhook.js
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
      if (matchPrimary) {
        plantillaPrimary = await enviarPlantillaCompleta({
          userId,
          from,
          templateName: trig.template,
          fallbackText: trig.response,
        });

        if (trig.auto_tag) {
          await aplicarAutoTag(userId, from, trig.auto_tag);
        }
      }

      if (matchSecondary) {
        if (matchPrimary) {
          console.log("⏳ Esperando 5s antes del secundario...");
          await sleep(5000);
        }
        await enviarPlantillaCompleta({
          userId,
          from,
          templateName: trig.secondary?.template,
          fallbackText: trig.secondary?.response,
        });
      }

      try {
        await supabase.from("trigger_log").insert({
          trigger_id: trig.id,
          user_id: userId,
          from_number: from,
          sent_at: new Date().toISOString(),
        });
      } catch {}

      // Después de enviar el trigger, revisar si la plantilla enviada
      // contiene "✅ PEDIDO CONFIRMADO" y crear el pedido en orders.
      try {
        const contenidoEnviado = clean(
          plantillaPrimary?.content ||
          trig.response ||
          ""
        );
        if (esMensajePedidoConfirmado(contenidoEnviado)) {
          await detectarYGuardarPedidoConfirmado({
            userId,
            from,
            textoMensaje: contenidoEnviado,
            sourceMessageId: null,
          });
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
// 🆕 DETECTOR DE PEDIDOS CONFIRMADOS (estricto + anti-duplicado)
// ═══════════════════════════════════════════════════════════

// Detecta si un texto es REALMENTE la plantilla "✅ PEDIDO CONFIRMADO"
// (no cualquier mensaje que mencione "pedido confirmado")
function esMensajePedidoConfirmado(texto) {
  const t = clean(texto);
  const tieneMarcador = /✅\s*PEDIDO CONFIRMADO/i.test(t);
  const tieneProducto = /Producto:\s*\S/i.test(t);
  const tieneTotal = /Total:\s*\S/i.test(t);
  const tieneUbicacion = /Ubicaci[oó]n:\s*\S/i.test(t);
  return tieneMarcador && tieneProducto && tieneTotal && tieneUbicacion;
}

// Parsea los campos del mensaje, descartando basura del prompt
function parsearPedidoConfirmado(texto) {
  const get = (regex) => {
    const m = texto.match(regex);
    return m ? clean(m[1]) : null;
  };

  const producto = get(/Producto:\s*([^\n]+)/i);
  const cliente = get(/Cliente:\s*([^\n]+)/i);
  const ubicacionRaw = get(/Ubicaci[oó]n:\s*([^\n]+)/i);
  const contacto = get(/Contacto:\s*([^\n]+)/i);
  const cantidadRaw = get(/Cantidad:\s*([^\n]+)/i);
  const calce = get(/Calce:\s*([^\n]+)/i);
  const totalRaw = get(/Total:\s*([^\n]+)/i);

  // 🚫 Validación anti-basura del producto
  const esProductoValido = (p) => {
    if (!p) return false;
    if (p.length > 120) return false;
    const blacklist = [
      "nunca decir", "ir directo", "→", "gracias por tu audio",
      "entendi que queres", "asuncion, hernandarias", "ypane, villeta",
    ];
    const pn = normalize(p);
    return !blacklist.some((b) => pn.includes(b));
  };

  // 🚫 Validación anti-basura del nombre
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

  if (!esProductoValido(producto)) return null;

  let city = null;
  let address = null;
  if (ubicacionRaw) {
    const partes = ubicacionRaw.split(/\s*[—–-]\s*/);
    city = partes[0] ? clean(partes[0]) : null;
    address = partes.slice(1).join(" — ").trim() || null;
  }

  let quantity = null;
  if (cantidadRaw) {
    const m = cantidadRaw.match(/(\d+)/);
    if (m) quantity = parseInt(m[1], 10);
  }

  // total como número (Gs)
  let totalNum = null;
  if (totalRaw) {
    const soloDigitos = totalRaw.replace(/[^\d]/g, "");
    if (soloDigitos) totalNum = parseInt(soloDigitos, 10);
  }

  let productoFinal = producto;
  if (calce && producto) productoFinal = `${producto} (Calce ${calce})`;

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

// Verifica si ya existe pedido para el mensaje origen (anti-duplicado por mensaje)
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

// Crea el pedido en orders (con dedupe por teléfono + 30 min)
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
    if (!datos) {
      console.log("🚫 Texto no parece pedido válido, descartado");
      return;
    }
    if (!datos.product) {
      console.log("🚫 Sin producto válido, descartado");
      return;
    }

    // 🛡️ Anti-duplicado: ¿hay un pedido del mismo teléfono en los últimos 30 min?
    const hace30min = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: reciente } = await supabase
      .from("orders")
      .select("id, product")
      .eq("user_id", userId)
      .eq("from_number", from)
      .gte("created_at", hace30min)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reciente) {
      // Mismo producto → es duplicado, no insertamos
      if (normalize(reciente.product || "") === normalize(datos.product)) {
        console.log(`⏭️ Pedido duplicado (mismo producto en <30min) → ${from}`);
        return;
      }
      // Otro producto → el cliente modificó su pedido, actualizamos el existente
      const updatePayload = {
        product: datos.product,
        updated_at: new Date().toISOString(),
      };
      if (datos.quantity != null) updatePayload.quantity = datos.quantity;
      if (datos.total_amount != null) updatePayload.total_amount = datos.total_amount;
      if (datos.address) updatePayload.address = datos.address;
      if (datos.city) updatePayload.city = datos.city;
      if (datos.customer_name) updatePayload.customer_name = datos.customer_name;

      const { error: updErr } = await supabase
        .from("orders")
        .update(updatePayload)
        .eq("id", reciente.id);

      if (updErr) console.error("❌ update pedido:", updErr);
      else console.log(`🔄 Pedido actualizado (cliente cambió producto): ${reciente.id}`);
      return;
    }

    // No hay pedido reciente → insertar nuevo
    const insertPayload = {
      user_id: userId,
      from_number: from,
      phone: datos.phone || from,
      customer_name: datos.customer_name,
      product: datos.product,
      quantity: datos.quantity,
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

    console.log(`✅ Pedido creado: ${nuevo?.id} → ${datos.customer_name} | ${datos.product}`);
  } catch (err) {
    console.error("❌ detectarYGuardarPedidoConfirmado error:", err);
  }
}

// Cuando el cliente manda una imagen, la asociamos al último pedido confirmado de él (24h)
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

async function procesar(req, message, userId, from) {
  try {
    const tipoMsg = message.type;

    let texto = "";
    let mediaUrl = null;

    if (tipoMsg === "text") {
      texto = clean(message.text?.body || "");
    } else if (tipoMsg === "image") {
      texto = clean(message.image?.caption || "[imagen]");
      mediaUrl = message.image?.id ? `wa_media:${message.image.id}` : null;
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

    // Si llega imagen del cliente → intentar asociar como comprobante
    if (tipoMsg === "image" && mediaUrl) {
      asociarComprobanteAlPedido({ userId, from, mediaUrl }).catch((e) =>
        console.error("comprobante bg error:", e)
      );
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

        // También chequear si la respuesta de la IA contiene "PEDIDO CONFIRMADO"
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
