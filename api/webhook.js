// webhook_v10.js
// Cambios clave vs v9:
// - analizarImagenConIA ahora llama DIRECTO a Google Gemini (generativelanguage.googleapis.com)
//   usando la API key del vendedor desde la tabla chat_ia_gemini (mismo patrón que chat-ia.ts)
// - Ya NO depende de LOVABLE_API_KEY ni del gateway de Lovable
// - Si el vendedor no tiene IA configurada, igual responde con un mensaje genérico (no se queda mudo)

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const clean = (t) => String(t || "").trim();

// ─────────────────────────────────────────────────────────────
// 1) Descargar la imagen desde la URL de WhatsApp
// ─────────────────────────────────────────────────────────────
async function descargarMediaWhatsApp(mediaUrl, whatsappToken) {
  try {
    // mediaUrl puede venir como ID (necesita resolver) o como URL directa
    let url = mediaUrl;
    if (!mediaUrl.startsWith("http")) {
      const metaRes = await fetch(
        `https://graph.facebook.com/v20.0/${mediaUrl}`,
        { headers: { Authorization: `Bearer ${whatsappToken}` } }
      );
      const meta = await metaRes.json();
      url = meta.url;
      if (!url) {
        console.error("❌ No se pudo resolver URL de media:", meta);
        return null;
      }
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${whatsappToken}` },
    });
    if (!res.ok) {
      console.error("❌ Descarga media falló:", res.status);
      return null;
    }

    const mimeType = res.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log(
      `📥 Imagen descargada: ${buffer.length} bytes, mime: ${mimeType}`
    );
    return { buffer, mimeType };
  } catch (e) {
    console.error("❌ descargarMediaWhatsApp:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 2) Subir a Supabase Storage (NO BLOQUEANTE)
// ─────────────────────────────────────────────────────────────
async function subirComprobanteAStorage(userId, fromNumber, buffer, mimeType) {
  try {
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const path = `${userId}/${fromNumber}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("comprobantes")
      .upload(path, buffer, { contentType: mimeType, upsert: false });

    if (error) {
      console.error("⚠️ storage upload (no bloqueante):", error.message || error);
      return null;
    }
    const { data: pub } = supabase.storage.from("comprobantes").getPublicUrl(path);
    return pub?.publicUrl || null;
  } catch (e) {
    console.error("⚠️ subirComprobanteAStorage (no bloqueante):", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 3) Analizar imagen con Gemini DIRECTO (usando key del vendedor)
// ─────────────────────────────────────────────────────────────
async function analizarImagenConGemini({
  apiKey,
  model,
  buffer,
  mimeType,
  entrenamientoCompleto,
}) {
  if (!apiKey) {
    console.error("❌❌❌ Falta api_key de Gemini en chat_ia_gemini");
    return null;
  }

  const base64 = buffer.toString("base64");
  const modelo = model || "gemini-2.5-flash";

  const systemText = `
Sos un analista de imágenes para un bot de ventas en Paraguay.
Recibís una imagen que el cliente envió por WhatsApp y la información de entrenamiento de la tienda.

Tu tarea: clasificar la imagen en UNA de estas tres categorías y devolver SOLO un JSON válido (sin texto extra, sin markdown).

CATEGORÍAS:
1. "comprobante" → si es un comprobante de transferencia/pago bancario (BNF, Itaú, Visión, Ueno, Tigo Money, Personal Pay, Wally, Zimple, etc.).
2. "producto" → si la imagen muestra un producto que está listado en el ENTRENAMIENTO de la tienda.
3. "otro" → cualquier otra cosa (selfies, capturas random, memes, etc.).

ENTRENAMIENTO DE LA TIENDA (úsalo para identificar productos y comparar datos bancarios):
${entrenamientoCompleto}

FORMATO DE RESPUESTA OBLIGATORIO (JSON puro):
{
  "tipo": "comprobante" | "producto" | "otro",
  "producto_detectado": "nombre exacto del producto del entrenamiento o null",
  "es_comprobante": true | false,
  "monto": "monto detectado en Gs. o null",
  "titular_destino": "nombre del titular destino o null",
  "banco_destino": "banco destino o null",
  "datos_coinciden_con_entrenamiento": true | false | null,
  "descripcion_breve": "1 frase describiendo qué se ve"
}
`.trim();

  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: "Analizá esta imagen y devolveme el JSON." },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  };

  if (String(modelo).includes("2.5")) {
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const data = await r.json();
    if (!r.ok) {
      console.error(
        "❌ Gemini Vision error:",
        r.status,
        JSON.stringify(data).slice(0, 600)
      );
      // Fallback a flash-lite
      if (modelo !== "gemini-2.5-flash-lite") {
        console.log("↩️ Reintentando con gemini-2.5-flash-lite...");
        return await analizarImagenConGemini({
          apiKey,
          model: "gemini-2.5-flash-lite",
          buffer,
          mimeType,
          entrenamientoCompleto,
        });
      }
      return null;
    }

    const texto = clean(
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("") || ""
    );
    console.log("📊 Respuesta vision (raw):", texto.slice(0, 300));

    if (!texto) return null;

    // Parsear JSON (limpiando posibles fences ```json ... ```)
    const limpio = texto
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    try {
      const json = JSON.parse(limpio);
      console.log("📊 Análisis IA:", json);
      return json;
    } catch (e) {
      console.error("❌ JSON inválido de Gemini Vision:", limpio.slice(0, 300));
      return null;
    }
  } catch (e) {
    console.error("❌ analizarImagenConGemini:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 4) Procesar imagen entrante (orquestador)
// ─────────────────────────────────────────────────────────────
async function procesarImagenEntrante({
  userId,
  fromNumber,
  mediaId,
  whatsappToken,
}) {
  console.log("🖼️ Iniciando procesarImagenEntrante:", {
    userId,
    fromNumber,
    mediaId,
  });

  // 1. Descargar media
  const media = await descargarMediaWhatsApp(mediaId, whatsappToken);
  if (!media) {
    return {
      textoVirtual:
        "[el cliente envió una imagen pero no pude descargarla, pedile amablemente que la reenvíe]",
      analisis: null,
      comprobanteUrl: null,
    };
  }

  // 2. Leer config IA del vendedor
  const { data: iaConfig } = await supabase
    .from("chat_ia_gemini")
    .select("api_key, model")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!iaConfig?.api_key) {
    console.error("❌ Vendedor sin chat_ia_gemini activo:", userId);
    return {
      textoVirtual:
        "[el cliente envió una imagen, agradecele y pedile que cuente qué necesita]",
      analisis: null,
      comprobanteUrl: null,
    };
  }

  // 3. Leer entrenamiento
  const { data: trainingRow } = await supabase
    .from("training_data")
    .select("response")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const entrenamientoCompleto = clean(trainingRow?.response).slice(0, 12000);
  console.log("📚 Entrenamiento len:", entrenamientoCompleto.length);

  // 4. Analizar con Gemini Vision
  const analisis = await analizarImagenConGemini({
    apiKey: iaConfig.api_key,
    model: iaConfig.model || "gemini-2.5-flash",
    buffer: media.buffer,
    mimeType: media.mimeType,
    entrenamientoCompleto,
  });

  // 5. Subir a storage SOLO si parece comprobante (no bloqueante)
  let comprobanteUrl = null;
  if (analisis?.tipo === "comprobante" || analisis?.es_comprobante) {
    comprobanteUrl = await subirComprobanteAStorage(
      userId,
      fromNumber,
      media.buffer,
      media.mimeType
    );
  }

  // 6. Generar texto virtual para que la IA conversacional responda
  let textoVirtual = "";
  if (!analisis) {
    textoVirtual =
      "[el cliente envió una imagen, agradecele y pedile que cuente qué necesita]";
  } else if (analisis.tipo === "comprobante" || analisis.es_comprobante) {
    const monto = analisis.monto ? ` por ${analisis.monto}` : "";
    const titular = analisis.titular_destino
      ? ` al titular ${analisis.titular_destino}`
      : "";
    const banco = analisis.banco_destino
      ? ` (${analisis.banco_destino})` : "";
    const coincide = analisis.datos_coinciden_con_entrenamiento;
    if (coincide === true) {
      textoVirtual = `[el cliente envió un COMPROBANTE${monto}${titular}${banco}. Los datos COINCIDEN con los datos bancarios del entrenamiento. Confirmá la transferencia, agradecele y avanzá con los próximos pasos del pedido (pedir nombre/dirección/teléfono si faltan, o confirmar despacho)]`;
    } else if (coincide === false) {
      textoVirtual = `[el cliente envió un comprobante${monto} pero los datos NO coinciden con los datos bancarios del entrenamiento. Avisale amablemente que verifique a qué cuenta transfirió y pasale de nuevo los datos bancarios correctos del entrenamiento]`;
    } else {
      textoVirtual = `[el cliente envió un comprobante${monto}${titular}${banco}. Confirmá recepción y verificá los datos contra el entrenamiento]`;
    }
  } else if (analisis.tipo === "producto" && analisis.producto_detectado) {
    textoVirtual = `[el cliente envió una foto del producto "${analisis.producto_detectado}". Respondele con info, precio y CTA según el entrenamiento, como si te lo hubiera preguntado]`;
  } else {
    textoVirtual = `[el cliente envió una imagen (${analisis.descripcion_breve || "no identificada"}). Agradecele y pedile que cuente qué necesita o que envíe el comprobante / producto si era esa la intención]`;
  }

  console.log("💬 Texto virtual:", textoVirtual);

  return { textoVirtual, analisis, comprobanteUrl };
}

// ─────────────────────────────────────────────────────────────
// 5) Llamar a chat-ia.ts (tu endpoint actual de texto)
// ─────────────────────────────────────────────────────────────
async function llamarChatIA({ userId, fromNumber, message, context, history }) {
  const baseUrl = process.env.PUBLIC_BASE_URL || ""; // setealo en Vercel: https://tu-dominio.vercel.app
  const url = baseUrl
    ? `${baseUrl}/api/chat-ia`
    : `https://${process.env.VERCEL_URL}/api/chat-ia`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      from_number: fromNumber,
      message,
      context,
      history,
    }),
  });
  return await r.json();
}

// ─────────────────────────────────────────────────────────────
// 6) Enviar mensaje por WhatsApp
// ─────────────────────────────────────────────────────────────
async function enviarWhatsApp({ to, text, phoneNumberId, whatsappToken }) {
  const r = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    }
  );
  const data = await r.json();
  if (!r.ok) console.error("❌ enviarWhatsApp:", data);
  return data;
}

// ─────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Verificación inicial del webhook (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  if (req.method !== "POST") return res.status(405).end();

  try {
    const body = req.body;
    const entry = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg) return res.status(200).json({ ok: true });

    const phoneNumberId = entry.metadata.phone_number_id;
    const fromNumber = msg.from;
    const tipo = msg.type;

    console.log("📨 Mensaje entrante:", { tipo, fromNumber, phoneNumberId });

    // Resolver user_id por phone_number_id
    const { data: cuenta } = await supabase
      .from("whatsapp_accounts")
      .select("user_id, whatsapp_token")
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();

    if (!cuenta?.user_id) {
      console.error("❌ No hay vendedor para phone_number_id:", phoneNumberId);
      return res.status(200).json({ ok: true });
    }

    const userId = cuenta.user_id;
    const whatsappToken =
      cuenta.whatsapp_token || process.env.WHATSAPP_TOKEN;

    // Cargar contexto/historial de la conversación
    const { data: convo } = await supabase
      .from("conversations")
      .select("context, history")
      .eq("user_id", userId)
      .eq("from_number", fromNumber)
      .maybeSingle();

    const context = convo?.context || {};
    const history = convo?.history || [];

    let textoUsuario = "";

    if (tipo === "text") {
      textoUsuario = clean(msg.text?.body);
    } else if (tipo === "image") {
      const mediaId = msg.image?.id;
      const { textoVirtual, analisis, comprobanteUrl } =
        await procesarImagenEntrante({
          userId,
          fromNumber,
          mediaId,
          whatsappToken,
        });
      textoUsuario = textoVirtual;

      // Guardar comprobante en orders si lo es
      if (
        comprobanteUrl &&
        (analisis?.tipo === "comprobante" || analisis?.es_comprobante)
      ) {
        try {
          await supabase
            .from("orders")
            .update({
              comprobante_url: comprobanteUrl,
              comprobante_monto: analisis.monto || null,
              comprobante_validado: !!analisis.datos_coinciden_con_entrenamiento,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("from_number", fromNumber)
            .in("status", [
              "draft",
              "collecting_name",
              "collecting_city",
              "collecting_phone",
              "collecting_address",
              "confirm_pending",
              "confirmed",
            ]);
        } catch (e) {
          console.error("⚠️ update comprobante en orders:", e);
        }
      }
    } else if (tipo === "audio" || tipo === "voice") {
      textoUsuario =
        "[el cliente envió un audio. Pedile amablemente que escriba el mensaje]";
    } else {
      textoUsuario = "[el cliente envió un mensaje no soportado]";
    }

    if (!textoUsuario) {
      return res.status(200).json({ ok: true });
    }

    // Llamar a chat-ia
    const aiResp = await llamarChatIA({
      userId,
      fromNumber,
      message: textoUsuario,
      context,
      history,
    });

    const respuesta = clean(aiResp?.response);
    if (respuesta) {
      await enviarWhatsApp({
        to: fromNumber,
        text: respuesta,
        phoneNumberId,
        whatsappToken,
      });
    }

    // Guardar conversación
    const newHistory = [
      ...history,
      { role: "user", content: textoUsuario },
      { role: "assistant", content: respuesta },
    ].slice(-30);

    await supabase.from("conversations").upsert(
      {
        user_id: userId,
        from_number: fromNumber,
        context: aiResp?.context || context,
        history: newHistory,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,from_number" }
    );

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("❌ webhook error:", e);
    return res.status(200).json({ ok: true }); // siempre 200 a Meta
  }
}
