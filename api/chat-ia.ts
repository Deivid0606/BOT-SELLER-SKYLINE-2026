// api/chat-ia.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const CATALOG_URL = "https://cat-logomegatodo-com.vercel.app/";

const clean = (t: any): string => String(t || "").trim();

const normalize = (t: string): string =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function getPriceLines(training: string): string[] {
  return training
    .split("\n")
    .map((l) => clean(l))
    .filter((l) => l.length > 3);
}

function extractProductNameFromLine(line: string): string {
  const c = line
    .replace(/^[-•\s]+/, "")
    .replace(/[💙🦶🎯💰🔥✨]/g, "")
    .trim();

  const parts = c.split(/—|-{2,}|–/);
  return clean(parts[0] || c);
}

function detectProduct(text: string, training: string, prev?: string) {
  const msg = normalize(text);
  const lines = getPriceLines(training);

  let best = "";
  let bestScore = 0;

  for (const line of lines) {
    const name = extractProductNameFromLine(line);
    const n = normalize(name);

    if (!n || n.length < 3) continue;

    const words = n.split(" ").filter((w) => w.length >= 4);

    let score = 0;

    if (msg.includes(n)) score += 20;

    for (const w of words) {
      if (msg.includes(w)) score += 4;
    }

    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }

  if (bestScore >= 4) return best;

  return clean(prev || "");
}

function isPriceIntent(text: string) {
  const m = normalize(text);

  return (
    m.includes("precio") ||
    m.includes("cuanto") ||
    m.includes("cuesta") ||
    m.includes("valor") ||
    m.includes("costo")
  );
}

function isBuyIntent(text: string) {
  const m = normalize(text);

  return (
    /\b(si|sí|quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmo|confirmar|ok|dale|listo|mandame|dame)\b/.test(
      m
    ) ||
    /\b\d+\s*(unidad|unidades|u)\b/.test(m) ||
    /^\d+$/.test(m)
  );
}

function getLastAssistantMessage(history: any[]) {
  if (!Array.isArray(history)) return "";

  const last = history
    .filter((h: any) => h?.role === "assistant" || h?.role === "model")
    .slice(-1)[0];

  return clean(last?.content);
}

function botWasAskingQuantity(history: any[]) {
  const lastAssistantMessage = normalize(getLastAssistantMessage(history));

  return (
    lastAssistantMessage.includes("cuantas unidades") ||
    lastAssistantMessage.includes("cuantos unidades") ||
    lastAssistantMessage.includes("cantidad") ||
    lastAssistantMessage.includes("cuantas queres") ||
    lastAssistantMessage.includes("cuantas te gustaria")
  );
}

function extractData(msg: string, currentStep?: string, forceQuantityMode = false) {
  const text = clean(msg);
  const norm = normalize(text);

  const phone = text.match(/(?:09\d{8}|\+595\d{9})/)?.[0] || "";

  let quantity = 0;

  if (
    forceQuantityMode ||
    currentStep === "collecting_quantity" ||
    currentStep === "esperando_cantidad"
  ) {
    const onlyNumber = norm.match(/^\s*(\d{1,3})\s*$/);

    if (onlyNumber) {
      const num = Number(onlyNumber[1]);

      if (num >= 1 && num <= 999) {
        quantity = num;
      }
    }
  }

  if (!quantity) {
    const q1 = norm.match(/\b(\d{1,3})\s*(unidad|unidades|u)\b/);

    if (q1) {
      quantity = Number(q1[1]);
    }
  }

  if (
    !quantity &&
    /\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/.test(norm)
  ) {
    const words: Record<string, number> = {
      uno: 1,
      una: 1,
      dos: 2,
      tres: 3,
      cuatro: 4,
      cinco: 5,
      seis: 6,
      siete: 7,
      ocho: 8,
      nueve: 9,
      diez: 10,
    };

    for (const [word, num] of Object.entries(words)) {
      if (new RegExp(`\\b${word}\\b`).test(norm)) {
        quantity = num;
        break;
      }
    }
  }

  if (!quantity) {
    const looksLikeQuantity =
      /\b(quiero|llevo|mandame|dame|solo|solamente|nomas|nomás|unidad|unidades|u)\b/.test(
        norm
      );

    if (looksLikeQuantity) {
      const q2 = norm.match(/\b(\d{1,3})\b/);

      if (q2) {
        const num = Number(q2[1]);

        if (num >= 1 && num <= 999) {
          quantity = num;
        }
      }
    }
  }

  const cityAliases: Record<string, string> = {
    asuncion: "Asunción",
    capiata: "Capiatá",
    capilata: "Capiatá",
    kapiata: "Capiatá",
    cde: "Ciudad del Este",
    "ciudad del este": "Ciudad del Este",
    luque: "Luque",
    ita: "Itá",
    lambare: "Lambaré",
    "san lorenzo": "San Lorenzo",
    sanlo: "San Lorenzo",
    "san lorenso": "San Lorenzo",
    fdm: "Fernando de la Mora",
    "fernando de la mora": "Fernando de la Mora",
    nemby: "Ñemby",
    ñemby: "Ñemby",
    ypane: "Ypané",
    limpio: "Limpio",
    "villa elisa": "Villa Elisa",
    hernandarias: "Hernandarias",
    "presidente franco": "Presidente Franco",
    "pte franco": "Presidente Franco",
    aregua: "Areguá",
    areguá: "Areguá",
  };

  let city = "";

  for (const [k, v] of Object.entries(cityAliases)) {
    if (new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(norm)) {
      city = v;
      break;
    }
  }

  const address =
    text.match(/(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i)
      ?.[1] || "";

  let name = "";

  const nameMatch = text.match(
    /(?:soy|me llamo|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{3,60})/i
  )?.[1];

  if (nameMatch) {
    name = clean(nameMatch).replace(/de\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/i, "").trim();
  } else if (
    /^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,60}$/.test(text) &&
    !city &&
    !phone &&
    !norm.includes("precio") &&
    !norm.includes("hola") &&
    !norm.includes("si")
  ) {
    name = text;
  }

  return {
    quantity,
    city,
    name,
    phone,
    address: clean(address),
  };
}

function mergeOrderData(old: any, ext: any, product: string, replaceQuantity = false) {
  const oldQuantity =
    typeof old?.quantity === "number" && old.quantity > 0 ? old.quantity : 0;

  const newQuantity =
    typeof ext?.quantity === "number" && ext.quantity > 0 ? ext.quantity : 0;

  return {
    product: product || old?.product || "",
    quantity: replaceQuantity ? newQuantity || 0 : newQuantity || oldQuantity || 0,
    city: ext.city || old?.city || "",
    customer_name: ext.name || old?.customer_name || "",
    phone: ext.phone || old?.phone || "",
    address: ext.address || old?.address || "",
  };
}

function nextStep(o: any) {
  if (!o.product) return "selling";
  if (!o.city) return "collecting_city";
  if (!o.quantity) return "collecting_quantity";
  if (!o.customer_name) return "collecting_name";
  if (!o.phone) return "collecting_phone";
  if (!o.address) return "collecting_address";
  return "confirm_order";
}

async function safeUpsertOrder(
  userId: string,
  from: string,
  order: any,
  confirm = false
) {
  try {
    if (!order?.product) return null;

    if (!from) {
      console.error("❌ safeUpsertOrder: from_number vacío, abortando");
      return null;
    }

    const { data: existing, error: findErr } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .eq("from_number", from)
      .in("status", [
        "draft",
        "collecting_name",
        "collecting_city",
        "collecting_quantity",
        "collecting_phone",
        "collecting_address",
        "confirm_pending",
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) {
      console.error("❌ findOrder:", findErr);
      return null;
    }

    const step = nextStep(order);

    const finalStatus =
      confirm && step === "confirm_order"
        ? "confirmed"
        : step === "confirm_order"
        ? "confirm_pending"
        : step;

    const payload: any = {
      user_id: userId,
      from_number: from,
      phone: order.phone || from,
      product: order.product || null,
      producto: order.product || null,
      customer_name: order.customer_name || null,
      city: order.city || null,
      ciudad: order.city || null,
      address: order.address || null,
      quantity: order.quantity || null,
      total_amount: order.total_amount || null,
      status: finalStatus,
      fecha: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { error } = await supabase
        .from("orders")
        .update(payload)
        .eq("id", existing.id);

      if (error) console.error("❌ updateOrder:", error);

      return existing.id;
    }

    const { data, error } = await supabase
      .from("orders")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.error("❌ insertOrder:", error);
      return null;
    }

    return data?.id || null;
  } catch (e) {
    console.error("❌ safeUpsertOrder:", e);
    return null;
  }
}

async function fetchMediaAsBase64(
  url: string
): Promise<{ data: string; mime: string } | null> {
  try {
    const r = await fetch(url);

    if (!r.ok) {
      console.error("❌ fetchMedia:", r.status, url.slice(0, 80));
      return null;
    }

    const mime = r.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await r.arrayBuffer());

    return {
      data: buf.toString("base64"),
      mime: mime.split(";")[0].trim(),
    };
  } catch (e) {
    console.error("❌ fetchMediaAsBase64:", e);
    return null;
  }
}

async function callGemini({
  apiKey,
  model,
  system,
  contents,
  temperature,
  maxTokens,
}: any) {
  const body: any = {
    systemInstruction: {
      parts: [{ text: system }],
    },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: 0.95,
      topK: 40,
    },
  };

  if (String(model).includes("2.5")) {
    body.generationConfig.thinkingConfig = {
      thinkingBudget: 0,
    };
  }

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const data = await r.json();

  if (!r.ok) {
    console.error("❌ Gemini:", JSON.stringify(data).slice(0, 800));
    return "";
  }

  const c = data?.candidates?.[0];

  const text = clean(
    c?.content?.parts?.map((p: any) => p.text || "").join("") || ""
  );

  console.log("🧠 finishReason:", c?.finishReason, "len:", text.length);

  return text;
}

async function analyzeImageWithGemini({
  apiKey,
  model,
  imageBase64,
  mime,
  caption,
  productList,
}: any): Promise<{
  kind: "payment_proof" | "product" | "other";
  transcript: string;
}> {
  const system = `
Sos un clasificador. Recibís una IMAGEN enviada por un cliente de WhatsApp a una tienda paraguaya.
Devolvé EXCLUSIVAMENTE un JSON válido con esta forma:
{"kind":"payment_proof"|"product"|"other","transcript":"..."}

Reglas:
- "payment_proof" → comprobante, transferencia, billetera, depósito o ticket bancario.
- "product" → imagen de producto, envase, caja, frasco o consulta visual de producto.
- "other" → cualquier otra imagen.

"transcript": descripción breve en español, máximo 200 caracteres.

Caption del cliente: "${clean(caption) || "(vacío)"}"
Catálogo de referencia: ${productList.slice(0, 800)}

NO devuelvas texto fuera del JSON.
`.trim();

  const contents = [
    {
      role: "user",
      parts: [
        {
          inlineData: {
            mimeType: mime,
            data: imageBase64,
          },
        },
        {
          text: caption ? `Caption: ${caption}` : "Analizá la imagen.",
        },
      ],
    },
  ];

  const raw = await callGemini({
    apiKey,
    model,
    system,
    contents,
    temperature: 0.1,
    maxTokens: 512,
  });

  try {
    const match = raw.match(/\{[\s\S]*\}/);

    if (!match) throw new Error("no json");

    const parsed = JSON.parse(match[0]);

    const kind =
      parsed.kind === "payment_proof" ||
      parsed.kind === "product" ||
      parsed.kind === "other"
        ? parsed.kind
        : "other";

    return {
      kind,
      transcript: clean(parsed.transcript),
    };
  } catch {
    console.warn("⚠️ analyzeImage no parseó JSON:", raw.slice(0, 200));

    return {
      kind: "other",
      transcript: clean(raw).slice(0, 200),
    };
  }
}

async function transcribeAudioWithGemini({
  apiKey,
  model,
  audioBase64,
  mime,
}: any): Promise<string> {
  const system =
    "Transcribí el audio al español tal cual lo dijo el hablante. Devolvé SOLO la transcripción en texto plano.";

  const contents = [
    {
      role: "user",
      parts: [
        {
          inlineData: {
            mimeType: mime,
            data: audioBase64,
          },
        },
        {
          text: "Transcribí este audio.",
        },
      ],
    },
  ];

  const txt = await callGemini({
    apiKey,
    model,
    system,
    contents,
    temperature: 0.1,
    maxTokens: 1024,
  });

  return clean(txt);
}

export default async function handler(req: any, res: any) {
  console.log("🔥 VERSION CORREGIDA CANTIDAD ACTIVADA");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const {
      user_id,
      message,
      from_number,
      context,
      history,
      media_url,
      media_type,
      mime_type,
    } = req.body;

    let texto = clean(message);
    const fromNumber = clean(from_number);
    const mediaUrl = clean(media_url);
    const mediaType = clean(media_type);
    const mimeHint = clean(mime_type);

    console.log(
      "🧠 CHAT-IA:",
      texto || "(sin texto)",
      "from:",
      fromNumber,
      mediaType ? `media=${mediaType}` : ""
    );

    if (!user_id) {
      return res.status(400).json({
        error: "Falta user_id",
      });
    }

    if (!fromNumber) {
      return res.status(400).json({
        error: "Falta from_number",
      });
    }

    if (!texto && !mediaUrl) {
      return res.status(400).json({
        error: "Faltan message o media",
      });
    }

    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key) {
      return res.json({
        response: "⚠️ La IA no está configurada o desactivada.",
      });
    }

    const { data: trainingRow } = await supabase
      .from("training_data")
      .select("id, intent, response, updated_at")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .order("updated_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    const fullTraining = clean(trainingRow?.response);

    if (!fullTraining) {
      return res.json({
        response: "⚠️ No encontré entrenamiento activo.",
      });
    }

    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    let isPaymentProof = false;

    if (mediaUrl && mediaType === "image") {
      const fetched = await fetchMediaAsBase64(mediaUrl);

      if (fetched) {
        const mime = mimeHint || fetched.mime || "image/jpeg";

        const analysis = await analyzeImageWithGemini({
          apiKey,
          model,
          imageBase64: fetched.data,
          mime,
          caption: texto,
          productList: fullTraining,
        });

        console.log("🖼️ Vision:", analysis.kind, "|", analysis.transcript);

        if (analysis.kind === "payment_proof") {
          isPaymentProof = true;

          const replyPago = `¡Perfecto! 🙏 Recibí tu comprobante (${
            analysis.transcript || "transferencia"
          }). Ya estamos verificando el pago y enseguida te confirmamos el envío 🚚✨`;

          return res.json({
            response: replyPago,
            is_payment_proof: true,
            context: {
              ...(context || {}),
              last_topic: "comprobante",
              updated_at: new Date().toISOString(),
            },
          });
        }

        if (analysis.kind === "product") {
          texto = texto
            ? `${texto}\n[el cliente envió una FOTO. Descripción: ${analysis.transcript}]`
            : `Mandé una foto. ${analysis.transcript}`;
        } else {
          texto = texto || `Te mandé una imagen. ${analysis.transcript}`;
        }
      } else {
        texto = texto || "Te mandé una imagen pero no pudiste descargarla.";
      }
    }

    if (mediaUrl && mediaType === "audio") {
      const fetched = await fetchMediaAsBase64(mediaUrl);

      if (fetched) {
        const mime = mimeHint || fetched.mime || "audio/ogg";

        const transcript = await transcribeAudioWithGemini({
          apiKey,
          model,
          audioBase64: fetched.data,
          mime,
        });

        console.log("🎙️ Transcripción:", transcript.slice(0, 200));

        texto = transcript || texto || "Te mandé un audio.";
      } else {
        texto = texto || "Te mandé un audio pero no pudiste descargarlo.";
      }
    }

    if (!texto) texto = "(mensaje sin texto)";

    const oldOrder = context?.order_data || {};
    const previousStep = clean(context?.step);

    const lastAssistantMessage = getLastAssistantMessage(history || []);
    const wasAskingQuantity = botWasAskingQuantity(history || []);

    const isOnlyNumber = /^\s*\d{1,3}\s*$/.test(texto);

    const isPureQuantityReply =
      isOnlyNumber &&
      !!oldOrder?.product &&
      !!oldOrder?.city &&
      wasAskingQuantity;

    const product = detectProduct(
      texto,
      fullTraining,
      context?.current_product || oldOrder?.product
    );

    const extracted = extractData(texto, previousStep, isPureQuantityReply);

    if (isPureQuantityReply) {
      extracted.quantity = Number(texto.trim());
    }

    const orderData = mergeOrderData(
      oldOrder,
      extracted,
      product,
      isPureQuantityReply
    );

    const step = nextStep(orderData);

    const wantsToBuy = isBuyIntent(texto);
    const asksPrice = isPriceIntent(texto);

    const hasOrderData =
      !!extracted.quantity ||
      !!extracted.city ||
      !!extracted.name ||
      !!extracted.phone ||
      !!extracted.address;

    const shouldCollect =
      !!orderData.product &&
      (wantsToBuy ||
        hasOrderData ||
        previousStep.startsWith("collecting") ||
        previousStep === "esperando_cantidad" ||
        isPureQuantityReply);

    const isConfirming = step === "confirm_order" && wantsToBuy;

    console.log("🧩 DEBUG FLUJO:", {
      previousStep,
      step,
      texto,
      lastAssistantMessage,
      wasAskingQuantity,
      isPureQuantityReply,
      extractedQuantity: extracted.quantity,
      orderQuantity: orderData.quantity,
      product: orderData.product,
      city: orderData.city,
    });

    if (shouldCollect) {
      await safeUpsertOrder(user_id, fromNumber, orderData, isConfirming);
    }

    let cleanHistory = Array.isArray(history) ? history : [];

    if (isPureQuantityReply) {
      cleanHistory = [];
    }

    const system = `
Sos el asistente de ventas de Mega Todo Store. Respondé SIEMPRE siguiendo el entrenamiento oficial del usuario.
NO inventes precios.
NO inventes datos.
NO agregues reglas externas.
NO muestres variables internas.

═══════════════════════════════════
ENTRENAMIENTO OFICIAL DEL USUARIO:
═══════════════════════════════════
${fullTraining}
═══════════════════════════════════

ESTADO ACTUAL DEL CLIENTE:
- Producto: ${orderData.product || "ninguno"}
- Cantidad: ${orderData.quantity || "pendiente"}
- Ciudad: ${orderData.city || "pendiente"}
- Nombre: ${orderData.customer_name || "pendiente"}
- Teléfono: ${orderData.phone || "pendiente"}
- Dirección: ${orderData.address || "pendiente"}
- Paso anterior: ${previousStep || "ninguno"}
- Paso actual: ${step}
- Última pregunta del bot: ${lastAssistantMessage || "ninguna"}
- Intención: ${wantsToBuy ? "QUIERE COMPRAR" : asksPrice ? "PREGUNTA PRECIO" : "CONSULTA"}

REGLAS TÉCNICAS OBLIGATORIAS:
1. Si la última pregunta del bot fue sobre cantidad y el cliente respondió solo un número, ese número es la cantidad final exacta.
2. Nunca concatenes cantidades.
3. Nunca conviertas 1 en 11, 2 en 22, 3 en 33.
4. La cantidad actual reemplaza cualquier cantidad anterior.
5. Si Cantidad no está pendiente, usá exactamente esa cantidad.
6. Si el paso actual es collecting_quantity, preguntá cuántas unidades quiere.
7. Si el paso actual es collecting_name, pedí nombre completo.
8. Si el paso actual es collecting_phone, pedí teléfono.
9. Si el paso actual es collecting_address, pedí dirección exacta.
10. Si el paso actual es confirm_order, confirmá el pedido con la plantilla del entrenamiento.
11. Si solo pregunta precio, respondé precio + CTA, sin pedir datos todavía.
12. No repitas saludo si ya hubo conversación.
13. No cambies de producto salvo que el cliente lo pida.
14. Cerrá siempre con el siguiente paso.
15. Catálogo: ${CATALOG_URL}
16. Español paraguayo natural, con emojis.
17. Nunca respondas vacío.
`.trim();

    const contents = cleanHistory
      .slice(-8)
      .filter((h: any) => clean(h?.content))
      .map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [
          {
            text: clean(h.content),
          },
        ],
      }));

    const currentUserText = isPureQuantityReply
      ? `El cliente eligió EXACTAMENTE ${orderData.quantity} unidades. No es 11. No es número concatenado. Mensaje original: "${texto}".`
      : texto;

    contents.push({
      role: "user",
      parts: [
        {
          text: currentUserText,
        },
      ],
    });

    let response = await callGemini({
      apiKey,
      model,
      system,
      contents,
      temperature: iaConfig.temperature ?? 0.3,
      maxTokens: Math.max(iaConfig.max_tokens ?? 0, 2048),
    });

    if (!response) {
      console.warn("⚠️ Vacío, reintentando...");

      response = await callGemini({
        apiKey,
        model,
        system,
        contents,
        temperature: 0.3,
        maxTokens: 3072,
      });
    }

    const newContext = {
      ...context,
      current_product: orderData.product || context?.current_product || null,
      step: shouldCollect ? step : "selling",
      order_data: orderData,
      last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
      updated_at: new Date().toISOString(),
    };

    return res.json({
      response:
        response || `📋 Te invito a revisar nuestro catálogo:\n${CATALOG_URL}`,
      context: newContext,
      is_payment_proof: isPaymentProof,
    });
  } catch (error: any) {
    console.error("❌ chat-ia:", error);

    return res.status(500).json({
      error: error.message || "Error interno",
    });
  }
}
