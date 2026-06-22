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
    .replace(/ñ/g, "n")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type ProductItem = {
  product: string;
  canonical: string;
  aliases: string[];
  price1: number;
  price2?: number;
  price3?: number;
  requiresSize?: boolean;
  sizes?: string[];
};

type ParsedTraining = {
  products: ProductItem[];
  coverageCities: { alias: string; canonical: string }[];
  corrections: { alias: string; canonical: string }[];
};

function extractSection(text: string, start: string, end?: string) {
  const source = String(text || "");
  const startIndex = source.indexOf(start);
  if (startIndex === -1) return "";

  const sliced = source.slice(startIndex + start.length);
  if (!end) return sliced;

  const endIndex = sliced.indexOf(end);
  if (endIndex === -1) return sliced;

  return sliced.slice(0, endIndex);
}

function parseTraining(training: string): ParsedTraining {
  const products: ProductItem[] = [];

  const catalog = extractSection(
    training,
    "CATALOGO_PRODUCTOS",
    "FIN_CATALOGO_PRODUCTOS"
  );

  const blocks = catalog
    .split(/\n\s*\n/g)
    .map((b) => b.trim())
    .filter((b) => b.includes("PRODUCTO:"));

  for (const block of blocks) {
    const product = clean(block.match(/PRODUCTO:\s*(.+)/i)?.[1]);
    const canonical =
      clean(block.match(/NOMBRE_CANONICO:\s*(.+)/i)?.[1]) || product;

    const aliasRaw = clean(block.match(/ALIAS:\s*(.+)/i)?.[1]);
    const aliases = aliasRaw
      ? aliasRaw
          .split(",")
          .map((a) => clean(a))
          .filter(Boolean)
      : [];

    const price1 = Number(clean(block.match(/PRECIO_1:\s*(\d+)/i)?.[1]) || 0);
    const price2Match = block.match(/PRECIO_2:\s*(\d+)/i);
    const price3Match = block.match(/PRECIO_3:\s*(\d+)/i);

    const requiresSize = /REQUIERE_CALCE:\s*true/i.test(block);
    const sizesRaw = clean(block.match(/CALCES_DISPONIBLES:\s*(.+)/i)?.[1]);
    const sizes = sizesRaw
      ? sizesRaw.split(",").map((s) => clean(s)).filter(Boolean)
      : [];

    if (product && price1 > 0) {
      products.push({
        product,
        canonical,
        aliases: Array.from(new Set([product, canonical, ...aliases])),
        price1,
        price2: price2Match ? Number(price2Match[1]) : undefined,
        price3: price3Match ? Number(price3Match[1]) : undefined,
        requiresSize,
        sizes,
      });
    }
  }

  const coverageText = extractSection(
    training,
    "ZONAS CON COBERTURA",
    "ZONAS SIN COBERTURA"
  );

  const fullCityListText = extractSection(
    training,
    "LISTA COMPLETA POR CIUDAD",
    "⚙️ INSTRUCCIÓN FINAL"
  );

  const correctionsText = extractSection(
    training,
    "TABLA DE ERRORES COMUNES Y CORRECCIONES",
    "📐 REGLAS PARA NORMALIZAR"
  );

  const coverageCities: { alias: string; canonical: string }[] = [];
  const corrections: { alias: string; canonical: string }[] = [];

  const addCity = (alias: string, canonical?: string) => {
    const a = clean(alias);
    const c = clean(canonical || alias);
    if (!a || a.length < 2) return;
    coverageCities.push({ alias: a, canonical: c });
  };

  const greenLine = coverageText
    .split("\n")
    .find((l) => l.includes("📍") && l.includes(",")) || "";

  greenLine
    .replace("📍", "")
    .split(",")
    .map((c) => clean(c))
    .filter(Boolean)
    .forEach((c) => addCity(c, c));

  const cityBlocks = fullCityListText.split(/📍\s*/g).filter(Boolean);

  for (const block of cityBlocks) {
    const lines = block.split("\n").map((l) => clean(l)).filter(Boolean);
    const canonical = clean(lines[0]);
    const variantsLine = lines.find((l) => l.startsWith("✅"));
    if (!canonical || !variantsLine) continue;

    variantsLine
      .replace(/^✅\s*/, "")
      .split(",")
      .map((v) => clean(v))
      .filter(Boolean)
      .forEach((v) => addCity(v, canonical));

    addCity(canonical, canonical);
  }

  for (const line of correctionsText.split("\n")) {
    if (!line.includes("→")) continue;
    const [left, right] = line.split("→");
    const canonical = clean(right);
    if (!canonical) continue;

    left
      .split(",")
      .map((v) => clean(v))
      .filter(Boolean)
      .forEach((alias) => {
        corrections.push({ alias, canonical });
        addCity(alias, canonical);
      });

    addCity(canonical, canonical);
  }

  return {
    products,
    coverageCities: dedupeCities(coverageCities),
    corrections,
  };
}

function dedupeCities(items: { alias: string; canonical: string }[]) {
  const map = new Map<string, { alias: string; canonical: string }>();

  for (const item of items) {
    const key = normalize(item.alias);
    if (!key) continue;
    map.set(key, item);
  }

  return Array.from(map.values());
}

async function getAllTrainingData(userId: string) {
  const { data, error } = await supabase
    .from("training_data")
    .select("id, intent, examples, response, is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("❌ training_data:", error);
    return [];
  }

  return data || [];
}

function buildTrainingText(trainingItems: any[]) {
  return trainingItems
    .map((t) => {
      const examples = Array.isArray(t.examples) ? t.examples.join("\n") : "";
      return `${t.intent || ""}\n${examples}\n${t.response || ""}`;
    })
    .join("\n\n---\n\n");
}

function buildTrainingContext(trainingItems: any[]) {
  if (!trainingItems?.length) return "";

  return trainingItems
    .map((item) => {
      const examples = Array.isArray(item.examples)
        ? item.examples.map((e: string) => `• ${e}`).join("\n")
        : "";

      return `### ${item.intent || "Entrenamiento"}
${item.response || ""}
${examples}`;
    })
    .join("\n\n");
}

function findMatchingTraining(trainingItems: any[], message: string) {
  const msg = normalize(message);
  if (!msg) return null;

  for (const item of trainingItems) {
    if (!Array.isArray(item.examples)) continue;

    for (const example of item.examples) {
      const ex = normalize(example);
      if (!ex) continue;

      if (
        msg === ex ||
        msg.includes(ex) ||
        ex.includes(msg) ||
        msg.includes(ex.substring(0, 12))
      ) {
        return {
          intent: item.intent,
          response: item.response,
          matched_example: example,
        };
      }
    }
  }

  return null;
}

function detectProduct(text: string, parsed: ParsedTraining, prev?: string) {
  const msg = normalize(text);
  if (!msg) return clean(prev || "");

  let best: ProductItem | null = null;
  let bestScore = 0;

  for (const product of parsed.products) {
    for (const alias of product.aliases) {
      const a = normalize(alias);
      if (!a || a.length < 3) continue;

      let score = 0;

      if (msg === a) score += 100;
      if (msg.includes(a)) score += 60;
      if (a.includes(msg) && msg.length >= 4) score += 40;

      const words = a.split(" ").filter((w) => w.length >= 4);
      for (const w of words) {
        if (msg.includes(w)) score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        best = product;
      }
    }
  }

  if (best && bestScore >= 10) return best.canonical;
  return clean(prev || "");
}

function getProductInfo(productName: string, parsed: ParsedTraining) {
  const p = normalize(productName);

  return (
    parsed.products.find((item) => {
      const names = [item.product, item.canonical, ...item.aliases].map(normalize);
      return names.some((n) => n === p || n.includes(p) || p.includes(n));
    }) || null
  );
}

function detectCity(text: string, parsed: ParsedTraining, prev?: string) {
  const msg = normalize(text);
  if (!msg) return clean(prev || "");

  let best = "";
  let bestScore = 0;

  for (const city of parsed.coverageCities) {
    const aliasNorm = normalize(city.alias);
    if (!aliasNorm || aliasNorm.length < 2) continue;

    let score = 0;

    if (msg === aliasNorm) score += 100;
    if (msg.includes(aliasNorm)) score += 70;
    if (aliasNorm.includes(msg) && msg.length >= 3) score += 50;

    const words = aliasNorm.split(" ").filter((w) => w.length >= 4);
    for (const w of words) {
      if (msg.includes(w)) score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = city.canonical;
    }
  }

  if (bestScore >= 50) return best;
  return clean(prev || "");
}

function hasCoverage(city: string, parsed: ParsedTraining) {
  const c = normalize(city);
  if (!c) return false;

  return parsed.coverageCities.some((item) => {
    const a = normalize(item.alias);
    const canonical = normalize(item.canonical);
    return c === a || c === canonical || c.includes(a) || a.includes(c);
  });
}

function isPriceIntent(text: string) {
  const m = normalize(text);
  return /\b(precio|cuanto|cuesta|valor|costo)\b/.test(m);
}

function isBuyIntent(text: string) {
  const m = normalize(text);
  return /\b(si|sí|quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmo|confirmar|ok|dale|listo)\b/.test(
    m
  );
}

function extractQuantity(text: string) {
  const norm = normalize(text);

  const q1 = norm.match(/\b(\d+)\s*(unidad|unidades|u|und|unds|pieza|piezas)\b/);
  if (q1) return Number(q1[1]);

  const q2 = norm.match(/\b(quiero|llevo|dame|mandame|envia|reservame)\s+(\d+)\b/);
  if (q2) return Number(q2[2]);

  const q3 = norm.match(/\b(\d+)\s+(quiero|llevo|dame|mandame|envia)\b/);
  if (q3) return Number(q3[1]);

  if (/^\d+$/.test(norm)) return Number(norm);

  if (/\buno\b|\buna\b/.test(norm)) return 1;
  if (/\bdos\b/.test(norm)) return 2;
  if (/\btres\b/.test(norm)) return 3;
  if (/\bcuatro\b/.test(norm)) return 4;
  if (/\bcinco\b/.test(norm)) return 5;

  return 0;
}

function extractPhone(text: string) {
  const raw = clean(text);
  const compact = raw.replace(/\s+/g, "");
  return compact.match(/(?:09\d{8}|\+595\d{9}|5959\d{8})/)?.[0] || "";
}

function extractName(text: string, city: string, phone: string) {
  const raw = clean(text);
  const norm = normalize(raw);

  if (!raw || city || phone) return "";

  const explicit = raw.match(
    /(?:soy|me llamo|nombre|mi nombre es)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,80})/i
  )?.[1];

  if (explicit) return clean(explicit);

  const banned = [
    "hola",
    "quiero",
    "precio",
    "cuanto",
    "ok",
    "dale",
    "si",
    "sí",
    "gracias",
    "nebulizador",
    "delivery",
    "envio",
    "enviar",
  ];

  if (banned.some((b) => norm === normalize(b) || norm.includes(normalize(b)))) {
    return "";
  }

  const words = raw.split(/\s+/).filter(Boolean);

  if (
    words.length >= 2 &&
    words.length <= 5 &&
    /^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(raw)
  ) {
    return raw;
  }

  return "";
}

function extractAddress(text: string, city: string, phone: string, name: string) {
  const raw = clean(text);
  const norm = normalize(raw);

  const explicit = raw.match(
    /(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i
  )?.[1];

  if (explicit) return clean(explicit);

  if (raw.includes("maps.app") || raw.includes("google.com/maps")) return raw;

  if (city || phone || name) return "";

  if (
    /\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote)\b/.test(
      norm
    )
  ) {
    return raw;
  }

  if (/\d/.test(raw) && raw.length >= 8) return raw;

  return "";
}

function extractData(text: string, parsed: ParsedTraining, old: any = {}) {
  const city = detectCity(text, parsed, old?.city || "");
  const phone = extractPhone(text);
  const quantity = extractQuantity(text);
  const name = extractName(text, city && city !== old?.city ? city : "", phone);
  const address = extractAddress(text, city && city !== old?.city ? city : "", phone, name);

  return {
    quantity,
    city: city && city !== old?.city ? city : "",
    name,
    phone,
    address,
  };
}

function mergeOrderData(old: any, ext: any, product: string) {
  return {
    product: product || old?.product || "",
    quantity:
      ext.quantity > 0
        ? ext.quantity
        : old?.quantity > 0
        ? old.quantity
        : 1,
    city: ext.city || old?.city || "",
    customer_name: ext.name || old?.customer_name || "",
    phone: ext.phone || old?.phone || "",
    address: ext.address || old?.address || "",
    size: ext.size || old?.size || "",
  };
}

function calculateTotal(productName: string, quantity: number, parsed: ParsedTraining) {
  const p = getProductInfo(productName, parsed);
  if (!p) return 0;

  if (quantity === 2 && p.price2) return p.price2;
  if (quantity === 3 && p.price3) return p.price3;

  return p.price1 * quantity;
}

function formatGs(n: number) {
  return Number(n || 0).toLocaleString("es-PY");
}

function nextStep(order: any) {
  if (!order.product) return "selling";
  if (!order.city) return "collecting_city";
  if (!order.quantity) return "collecting_quantity";
  if (!order.customer_name) return "collecting_name";
  if (!order.address) return "collecting_address";
  if (!order.phone) return "collecting_phone";
  return "confirm_order";
}

function buildMissingDataReply(order: any) {
  const missing = [];

  if (!order.customer_name) missing.push("nombre y apellido");
  if (!order.address) missing.push("dirección exacta o ubicación");
  if (!order.phone) missing.push("número de celular");

  if (missing.length === 3) {
    return `🔥 Perfecto 😊

📎 Necesito tus datos para agendar la entrega:

✅ nombre y apellido
✅ dirección exacta o ubicación por Google Maps
✅ número de celular

📲 Podés enviarlo TODO JUNTO o de a uno, voy registrando 😊`;
  }

  return `✅ Ya voy registrando tus datos. Me falta: ${missing.join(", ")} 😊`;
}

function buildConfirmation(order: any, parsed: ParsedTraining) {
  const total = calculateTotal(order.product, order.quantity || 1, parsed);
  const coverage = hasCoverage(order.city, parsed);

  if (coverage) {
    return `✅ PEDIDO CONFIRMADO

✅ Producto: ${order.product}
✅ Cliente: ${order.customer_name}
✅ Ubicación: ${order.city} — ${order.address}
✅ Contacto: ${order.phone}
✅ Cantidad: ${order.quantity || 1} u.
💰 Total: ${formatGs(total)} Gs

🚚 Envío GRATIS · Pagás al recibir

🚚 Tu pedido queda agendado para la próxima ronda de envíos. Si pagás al recibir, el delivery lo confirma al llegar a tu zona.

⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

💵 Podés pagar en EFECTIVO o TRANSFERENCIA AL DELIVERY cuando recibas tu producto. ¡Como te quede más cómodo! 🚚

¡Gracias por tu compra! 🛍️✨

Te dejo nuestro catálogo completo 👇

👉 ${CATALOG_URL}

Podés pedir cualquier producto con el mismo proceso rápido y seguro. ¡Te esperamos! 💜`;
  }

  return `✅ PEDIDO CONFIRMADO

✅ Producto: ${order.product}
✅ Cliente: ${order.customer_name}
✅ Ubicación: ${order.city}
✅ Contacto: ${order.phone}
✅ Cantidad: ${order.quantity || 1} u.
💰 Total: ${formatGs(total)} Gs

🚚 Su encomienda será enviada por transportadora.

📎 Una vez depositado el costo del delivery, le estaremos enviando su comprobante de envío.

⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

💵 Pago anticipado por transferencia.

📲 DATOS PARA TRANSFERENCIA:

Titular: DAVID AGUSTIN ALCARAZ AGUILAR
Banco Familiar
Cuenta: 81-4981442
Alias: 0994130022

¡Gracias por tu compra! 🛍️✨

Te dejo nuestro catálogo completo 👇

👉 ${CATALOG_URL}

Podés pedir cualquier producto con el mismo proceso rápido y seguro. ¡Te esperamos! 💜`;
}

async function safeUpsertOrder(
  userId: string,
  from: string,
  order: any,
  parsed: ParsedTraining,
  confirm = false
) {
  if (!order?.product || !from) return null;

  const step = nextStep(order);
  const finalStatus =
    confirm && step === "confirm_order"
      ? "confirmed"
      : step === "confirm_order"
      ? "confirm_pending"
      : step;

  const total = calculateTotal(order.product, order.quantity || 1, parsed);

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
    quantity: order.quantity || 1,
    total_amount: total || null,
    status: finalStatus,
    fecha: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .eq("from_number", from)
    .in("status", [
      "draft",
      "selling",
      "collecting_city",
      "collecting_quantity",
      "collecting_name",
      "collecting_phone",
      "collecting_address",
      "confirm_pending",
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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
}

async function fetchMediaAsBase64(url: string) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;

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
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: 0.95,
      topK: 40,
    },
  };

  if (String(model).includes("2.5")) {
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await r.json();

  if (!r.ok) {
    console.error("❌ Gemini:", JSON.stringify(data).slice(0, 800));
    return "";
  }

  return clean(
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      .join("") || ""
  );
}

async function analyzeImageWithGemini({
  apiKey,
  model,
  imageBase64,
  mime,
  caption,
}: any) {
  const system = `
Devolvé exclusivamente JSON válido:
{"kind":"payment_proof"|"product"|"other","transcript":"..."}

payment_proof: comprobante de transferencia, depósito, billetera, banco.
product: imagen de producto.
other: cualquier otra imagen.
`.trim();

  const raw = await callGemini({
    apiKey,
    model,
    system,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: mime, data: imageBase64 } },
          { text: caption || "Analizá la imagen." },
        ],
      },
    ],
    temperature: 0.1,
    maxTokens: 512,
  });

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON");
    const parsed = JSON.parse(match[0]);

    return {
      kind: ["payment_proof", "product", "other"].includes(parsed.kind)
        ? parsed.kind
        : "other",
      transcript: clean(parsed.transcript),
    };
  } catch {
    return { kind: "other", transcript: clean(raw).slice(0, 200) };
  }
}

async function transcribeAudioWithGemini({
  apiKey,
  model,
  audioBase64,
  mime,
}: any) {
  return callGemini({
    apiKey,
    model,
    system:
      "Transcribí el audio al español tal cual. Devolvé solo texto plano.",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: mime, data: audioBase64 } },
          { text: "Transcribí este audio." },
        ],
      },
    ],
    temperature: 0.1,
    maxTokens: 1024,
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });
    if (!texto && !mediaUrl) {
      return res.status(400).json({ error: "Faltan message o media" });
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

    const allTraining = await getAllTrainingData(user_id);
    const combinedTraining = buildTrainingText(allTraining);
    const parsed = parseTraining(combinedTraining);

    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    if (mediaUrl && mediaType === "image") {
      const fetched = await fetchMediaAsBase64(mediaUrl);

      if (fetched) {
        const analysis = await analyzeImageWithGemini({
          apiKey,
          model,
          imageBase64: fetched.data,
          mime: mimeHint || fetched.mime || "image/jpeg",
          caption: texto,
        });

        if (analysis.kind === "payment_proof") {
          return res.json({
            response: `¡Perfecto! 🙏 Recibí tu comprobante. Ya estamos verificando el pago y enseguida te confirmamos el envío 🚚✨`,
            is_payment_proof: true,
            context: {
              ...(context || {}),
              last_topic: "comprobante",
              updated_at: new Date().toISOString(),
            },
          });
        }

        texto = texto || analysis.transcript || "El cliente envió una imagen.";
      }
    }

    if (mediaUrl && mediaType === "audio") {
      const fetched = await fetchMediaAsBase64(mediaUrl);

      if (fetched) {
        texto =
          (await transcribeAudioWithGemini({
            apiKey,
            model,
            audioBase64: fetched.data,
            mime: mimeHint || fetched.mime || "audio/ogg",
          })) || texto;
      }
    }

    const oldOrder = context?.order_data || {};

    const detectedProduct = detectProduct(
      texto,
      parsed,
      context?.current_product || oldOrder?.product
    );

    const extracted = extractData(texto, parsed, oldOrder);

    const orderData = mergeOrderData(oldOrder, extracted, detectedProduct);

    const wantsToBuy = isBuyIntent(texto);
    const asksPrice = isPriceIntent(texto);

    const productInfo = getProductInfo(orderData.product, parsed);
    const coverage = hasCoverage(orderData.city, parsed);

    let step = nextStep(orderData);

    const newContextBase = {
      ...(context || {}),
      current_product: orderData.product || context?.current_product || null,
      order_data: orderData,
      step,
      updated_at: new Date().toISOString(),
    };

    if (!orderData.product) {
      const match = findMatchingTraining(allTraining, texto);
      if (match?.response) {
        return res.json({
          response: match.response,
          context: {
            ...newContextBase,
            matched_training: true,
            last_topic: match.intent,
          },
        });
      }
    }

    if (orderData.product && !orderData.city) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      const productPrice = productInfo?.price1
        ? `💰 Precio: ${formatGs(productInfo.price1)} Gs\n\n`
        : "";

      return res.json({
        response: `${productPrice}📍 ¿Para qué ciudad sería el envío? 😊`,
        context: {
          ...newContextBase,
          step: "collecting_city",
        },
      });
    }

    if (orderData.product && orderData.city && !orderData.quantity) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      const total1 = productInfo?.price1 ? formatGs(productInfo.price1) : "";
      const promo =
        productInfo?.price2
          ? `\n🔥 PROMO 2x → ${formatGs(productInfo.price2)} Gs`
          : "";

      const coverageText = coverage
        ? `✅ Perfecto 😊 ${orderData.city} tiene ENVÍO GRATIS contra-entrega 🚚`
        : `ℹ️ ${orderData.city} no está en nuestra lista de envío gratis contra-entrega, pero podemos coordinar envío por transportadora con previa transferencia bancaria.`;

      return res.json({
        response: `${coverageText}

🔥 ${orderData.product}
${total1 ? `• 1 unidad → ${total1} Gs` : ""}${promo}

¿Cuántas unidades te gustaría llevar? ✨`,
        context: {
          ...newContextBase,
          step: "collecting_quantity",
        },
      });
    }

    if (
      orderData.product &&
      orderData.city &&
      orderData.quantity &&
      (!orderData.customer_name || !orderData.address || !orderData.phone)
    ) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      return res.json({
        response: buildMissingDataReply(orderData),
        context: {
          ...newContextBase,
          step: nextStep(orderData),
        },
      });
    }

    if (
      orderData.product &&
      orderData.city &&
      orderData.quantity &&
      orderData.customer_name &&
      orderData.address &&
      orderData.phone
    ) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, true);

      return res.json({
        response: buildConfirmation(orderData, parsed),
        context: {
          ...newContextBase,
          step: "pedido_confirmado",
          order_data: orderData,
        },
      });
    }

    const trainingContext = buildTrainingContext(allTraining);

    const system = `
Sos el asistente de ventas de Mega Todo Store.

Usá como fuente de verdad el entrenamiento del vendedor.
Nunca inventes precios.
Nunca confirmes pedido si falta producto, ciudad, cantidad, nombre, dirección o teléfono.

ENTRENAMIENTO:
${trainingContext}

ESTADO:
Producto: ${orderData.product || "pendiente"}
Ciudad: ${orderData.city || "pendiente"}
Cantidad: ${orderData.quantity || "pendiente"}
Nombre: ${orderData.customer_name || "pendiente"}
Dirección: ${orderData.address || "pendiente"}
Teléfono: ${orderData.phone || "pendiente"}
Cobertura: ${orderData.city ? (coverage ? "con cobertura" : "sin cobertura") : "pendiente"}

Reglas:
- Si falta ciudad, preguntá ciudad.
- Si falta cantidad, preguntá cantidad.
- Si faltan datos, pedí solo los datos faltantes.
- Si está todo completo, confirmá pedido.
- No uses ciudades como producto.
- No uses frases de pago como producto.
`.trim();

    const contents = (history || [])
      .slice(-12)
      .filter((h: any) => clean(h?.content))
      .map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: clean(h.content) }],
      }));

    contents.push({
      role: "user",
      parts: [{ text: texto || "(mensaje sin texto)" }],
    });

    const aiResponse = await callGemini({
      apiKey,
      model,
      system,
      contents,
      temperature: iaConfig.temperature ?? 0.3,
      maxTokens: Math.max(iaConfig.max_tokens ?? 0, 2048),
    });

    return res.json({
      response:
        aiResponse ||
        `📋 Te invito a revisar nuestro catálogo:\n${CATALOG_URL}`,
      context: newContextBase,
    });
  } catch (error: any) {
    console.error("❌ chat-ia:", error);
    return res.status(500).json({
      error: error.message || "Error interno",
    });
  }
}
