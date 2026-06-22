import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const CATALOG_URL = "https://cat-logomegatodo-com.vercel.app/";

const clean = (v: any) => String(v || "").trim();

const normalize = (v: any) =>
  clean(v)
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
};

type ParsedTraining = {
  products: ProductItem[];
  cities: { alias: string; canonical: string }[];
};

const emptyOrder = {
  product: "",
  quantity: 0,
  city: "",
  customer_name: "",
  phone: "",
  address: "",
};

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

function buildTrainingText(items: any[]) {
  return items
    .map((i) => {
      const examples = Array.isArray(i.examples) ? i.examples.join("\n") : "";
      return `${i.intent || ""}\n${examples}\n${i.response || ""}`;
    })
    .join("\n\n---\n\n");
}

function parseTraining(training: string): ParsedTraining {
  const products: ProductItem[] = [];
  const cities: { alias: string; canonical: string }[] = [];

  const catalog =
    training.match(/CATALOGO_PRODUCTOS([\s\S]*?)FIN_CATALOGO_PRODUCTOS/i)?.[1] ||
    "";

  const productBlocks = catalog
    .split(/(?=PRODUCTO:\s*)/i)
    .map((b) => b.trim())
    .filter((b) => /^PRODUCTO:\s*/i.test(b));

  for (const block of productBlocks) {
    const product = clean(block.match(/^PRODUCTO:\s*(.+)$/im)?.[1]);
    const canonical =
      clean(block.match(/^NOMBRE_CANONICO:\s*(.+)$/im)?.[1]) || product;

    const aliasRaw = clean(block.match(/^ALIAS:\s*(.+)$/im)?.[1]);
    const aliases = aliasRaw
      ? aliasRaw.split(",").map(clean).filter(Boolean)
      : [];

    const price1 = Number(clean(block.match(/^PRECIO_1:\s*(\d+)/im)?.[1]) || 0);
    const price2 = Number(clean(block.match(/^PRECIO_2:\s*(\d+)/im)?.[1]) || 0);
    const price3 = Number(clean(block.match(/^PRECIO_3:\s*(\d+)/im)?.[1]) || 0);

    if (product && canonical && price1 > 0) {
      products.push({
        product,
        canonical,
        aliases: Array.from(new Set([product, canonical, ...aliases])),
        price1,
        price2: price2 || undefined,
        price3: price3 || undefined,
      });
    }
  }

  const addCity = (alias: string, canonical?: string) => {
    const a = clean(alias);
    const c = clean(canonical || alias);
    if (!a || a.length < 2) return;
    cities.push({ alias: a, canonical: c });
  };

  const cityListSection =
    training.match(/LISTA COMPLETA POR CIUDAD([\s\S]*?)⚙️ INSTRUCCIÓN FINAL/i)
      ?.[1] || "";

  cityListSection
    .split(/📍\s*/g)
    .filter(Boolean)
    .forEach((block) => {
      const lines = block.split("\n").map(clean).filter(Boolean);
      const canonical = lines[0];
      const variantsLine = lines.find((l) => l.startsWith("✅"));

      if (canonical && variantsLine) {
        addCity(canonical, canonical);

        variantsLine
          .replace(/^✅\s*/, "")
          .split(",")
          .map(clean)
          .filter(Boolean)
          .forEach((v) => addCity(v, canonical));
      }
    });

  const coverageSection =
    training.match(/ZONAS CON COBERTURA([\s\S]*?)ZONAS SIN COBERTURA/i)?.[1] ||
    "";

  coverageSection
    .split("\n")
    .filter((l) => l.includes(","))
    .join(",")
    .replace(/📍/g, "")
    .split(",")
    .map(clean)
    .filter((c) => c.length > 2 && !c.includes("━━"))
    .forEach((c) => addCity(c, c));

  const cityMap = new Map<string, { alias: string; canonical: string }>();

  for (const c of cities) {
    const key = normalize(c.alias);
    if (key) cityMap.set(key, c);
  }

  return {
    products,
    cities: Array.from(cityMap.values()),
  };
}

function getProductInfo(productName: string, parsed: ParsedTraining) {
  const p = normalize(productName);
  if (!p) return null;

  return (
    parsed.products.find((item) => {
      const names = [item.product, item.canonical, ...item.aliases].map(normalize);
      return names.some((n) => n === p || n.includes(p) || p.includes(n));
    }) || null
  );
}

function detectProduct(text: string, parsed: ParsedTraining, prev?: string) {
  const msg = normalize(text);
  const prevOk = getProductInfo(prev || "", parsed);

  if (!msg) return prevOk?.canonical || "";

  let best: ProductItem | null = null;
  let bestScore = 0;

  for (const p of parsed.products) {
    for (const alias of p.aliases) {
      const a = normalize(alias);
      if (!a || a.length < 3) continue;

      let score = 0;
      if (msg === a) score += 100;
      if (msg.includes(a)) score += 80;
      if (a.includes(msg) && msg.length >= 4) score += 50;

      for (const w of a.split(" ").filter((x) => x.length >= 4)) {
        if (msg.includes(w)) score += 15;
      }

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }

  if (best && bestScore >= 15) return best.canonical;
  return prevOk?.canonical || "";
}

function detectCity(text: string, parsed: ParsedTraining, prev?: string) {
  const msg = normalize(text);
  if (!msg) return clean(prev || "");

  let best = "";
  let bestScore = 0;

  for (const c of parsed.cities) {
    const a = normalize(c.alias);
    if (!a || a.length < 2) continue;

    let score = 0;
    if (msg === a) score += 100;
    if (msg.includes(a)) score += 80;
    if (a.includes(msg) && msg.length >= 3) score += 50;

    if (score > bestScore) {
      bestScore = score;
      best = c.canonical;
    }
  }

  if (bestScore >= 50) return best;
  return clean(prev || "");
}

function hasCoverage(city: string, parsed: ParsedTraining) {
  const c = normalize(city);
  if (!c) return false;

  return parsed.cities.some((x) => {
    const a = normalize(x.alias);
    const cn = normalize(x.canonical);
    return c === a || c === cn || c.includes(a) || a.includes(c);
  });
}

function extractQuantity(text: string) {
  const m = normalize(text);

  const q1 = m.match(/\b(\d+)\s*(unidad|unidades|u|und|unds)\b/);
  if (q1) return Number(q1[1]);

  const q2 = m.match(/\b(quiero|llevo|dame|mandame|reservame)\s+(\d+)\b/);
  if (q2) return Number(q2[2]);

  const q3 = m.match(/\b(\d+)\s+(quiero|llevo|dame|mandame)\b/);
  if (q3) return Number(q3[1]);

  if (/^\d+$/.test(m)) return Number(m);

  if (/\buno\b|\buna\b/.test(m)) return 1;
  if (/\bdos\b/.test(m)) return 2;
  if (/\btres\b/.test(m)) return 3;
  if (/\bcuatro\b/.test(m)) return 4;
  if (/\bcinco\b/.test(m)) return 5;

  return 0;
}

function sanitizeQuantity(q: any) {
  const n = Number(q);
  if (!Number.isFinite(n)) return 0;
  if (n < 1) return 0;
  if (n > 100) return 100;
  return Math.floor(n);
}

function extractPhone(text: string) {
  const compact = clean(text).replace(/\s+/g, "");
  return compact.match(/(?:09\d{8}|\+595\d{9}|5959\d{8})/)?.[0] || "";
}

function extractName(text: string, detectedCity: string, phone: string) {
  const raw = clean(text);
  const norm = normalize(raw);

  if (!raw || detectedCity || phone) return "";
  if (/^\d+$/.test(norm)) return "";
  if (/^\d+\s*(unidad|unidades|u|und|unds)$/.test(norm)) return "";

  const forbidden = [
    "quiero",
    "quiero comprar",
    "me interesa",
    "precio",
    "cuanto cuesta",
    "nebulizador",
    "delivery",
    "envio",
    "ok",
    "dale",
    "si",
    "hola",
    "buenas",
    "gracias",
  ];

  if (forbidden.some((f) => norm === normalize(f))) return "";

  const explicit = raw.match(
    /(?:soy|me llamo|mi nombre es|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,80})/i
  )?.[1];

  if (explicit) return clean(explicit);

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

function extractAddress(text: string, detectedCity: string, phone: string, name: string) {
  const raw = clean(text);
  const norm = normalize(raw);

  if (!raw || detectedCity || phone || name) return "";
  if (/^\d+$/.test(norm)) return "";
  if (/^\d+\s*(unidad|unidades|u|und|unds)$/.test(norm)) return "";

  const explicit = raw.match(
    /(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i
  )?.[1];

  if (explicit) return clean(explicit);
  if (raw.includes("maps.app") || raw.includes("google.com/maps")) return raw;

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

function sanitizeOldOrder(old: any, parsed: ParsedTraining) {
  const productInfo = getProductInfo(old?.product || "", parsed);
  const nameNorm = normalize(old?.customer_name || "");

  return {
    product: productInfo?.canonical || "",
    quantity: sanitizeQuantity(old?.quantity),
    city: clean(old?.city || ""),
    customer_name:
      old?.customer_name && nameNorm !== "quiero" ? clean(old.customer_name) : "",
    phone: clean(old?.phone || ""),
    address: clean(old?.address || ""),
  };
}

function shouldResetConversation(text: string) {
  const m = normalize(text);

  return [
    "quiero",
    "me interesa",
    "quiero comprar",
    "comprar",
    "hola",
    "buenas",
    "info",
    "informacion",
  ].includes(m);
}

function mergeOrderData(old: any, ext: any, product: string) {
  return {
    product: product || old.product || "",
    quantity: sanitizeQuantity(ext.quantity || old.quantity || 0),
    city: ext.city || old.city || "",
    customer_name: ext.name || old.customer_name || "",
    phone: ext.phone || old.phone || "",
    address: ext.address || old.address || "",
  };
}

function calculateTotal(productName: string, quantity: number, parsed: ParsedTraining) {
  const p = getProductInfo(productName, parsed);
  const q = sanitizeQuantity(quantity);

  if (!p || !q) return 0;

  if (q === 2 && p.price2) return p.price2;
  if (q === 3 && p.price3) return p.price3;

  return p.price1 * q;
}

function formatGs(n: number) {
  return Number(n || 0).toLocaleString("es-PY");
}

function nextStep(o: any) {
  if (!o.product) return "selling";
  if (!o.city) return "collecting_city";
  if (!o.quantity) return "collecting_quantity";
  if (!o.customer_name) return "collecting_name";
  if (!o.address) return "collecting_address";
  if (!o.phone) return "collecting_phone";
  return "confirm_order";
}

function quantityReply(o: any, parsed: ParsedTraining) {
  const total = calculateTotal(o.product, o.quantity, parsed);

  return `🔥 Perfecto 😊

📦 ${o.product}
🔢 Cantidad: ${o.quantity}
💰 Total: ${formatGs(total)} Gs

🚚 Envío GRATIS contra-entrega

📎 Pasame tus datos:

✅ nombre y apellido
✅ dirección exacta o ubicación por Google Maps
✅ número de celular

📲 Podés enviarlo TODO JUNTO o de a uno, voy registrando 😊

y agendamos tu entrega ✨`;
}

function missingDataReply(o: any) {
  const missing = [];
  if (!o.customer_name) missing.push("nombre y apellido");
  if (!o.address) missing.push("dirección exacta o ubicación");
  if (!o.phone) missing.push("número de celular");

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

function confirmation(o: any, parsed: ParsedTraining) {
  const total = calculateTotal(o.product, o.quantity, parsed);
  const coverage = hasCoverage(o.city, parsed);

  if (coverage) {
    return `✅ PEDIDO CONFIRMADO

✅ Producto: ${o.product}
✅ Cliente: ${o.customer_name}
✅ Ubicación: ${o.city} — ${o.address}
✅ Contacto: ${o.phone}
✅ Cantidad: ${o.quantity} u.
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

✅ Producto: ${o.product}
✅ Cliente: ${o.customer_name}
✅ Ubicación: ${o.city}
✅ Contacto: ${o.phone}
✅ Cantidad: ${o.quantity} u.
💰 Total: ${formatGs(total)} Gs

🚚 Su encomienda será enviada por transportadora.

📎 Una vez depositado el costo del delivery, le estaremos enviando su comprobante de envío.

⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

💵 Pago anticipado por transferencia.`;
}

async function safeUpsertOrder(
  userId: string,
  from: string,
  order: any,
  parsed: ParsedTraining,
  confirm = false
) {
  if (!getProductInfo(order.product, parsed)) return null;

  const total = calculateTotal(order.product, order.quantity || 1, parsed);
  const step = nextStep(order);

  const status =
    confirm && step === "confirm_order"
      ? "confirmed"
      : step === "confirm_order"
      ? "confirm_pending"
      : step;

  const payload: any = {
    user_id: userId,
    from_number: from,
    phone: order.phone || from,
    product: order.product,
    producto: order.product,
    customer_name: order.customer_name || null,
    city: order.city || null,
    ciudad: order.city || null,
    address: order.address || null,
    quantity: sanitizeQuantity(order.quantity || 1),
    total_amount: total || null,
    status,
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
    await supabase.from("orders").update(payload).eq("id", existing.id);
    return existing.id;
  }

  const { data } = await supabase.from("orders").insert(payload).select("id").single();
  return data?.id || null;
}

async function fetchMediaAsBase64(url: string) {
  const r = await fetch(url);
  if (!r.ok) return null;

  const mime = r.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await r.arrayBuffer());

  return {
    data: buf.toString("base64"),
    mime: mime.split(";")[0].trim(),
  };
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

async function transcribeAudioWithGemini({
  apiKey,
  model,
  audioBase64,
  mime,
}: any) {
  return callGemini({
    apiKey,
    model,
    system: "Transcribí el audio al español. Devolvé solo texto plano.",
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

function inferProductFromHistory(history: any[], parsed: ParsedTraining) {
  const lastItems = (history || []).slice(-8).reverse();

  for (const item of lastItems) {
    const content = clean(item?.content);
    if (!content) continue;

    const p = detectProduct(content, parsed, "");
    if (p) return p;
  }

  return "";
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

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });
    if (!texto && !media_url) {
      return res.status(400).json({ error: "Faltan message o media" });
    }

    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key) {
      return res.json({ response: "⚠️ La IA no está configurada o desactivada." });
    }

    const allTraining = await getAllTrainingData(user_id);
    const trainingText = buildTrainingText(allTraining);
    const parsed = parseTraining(trainingText);

    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    if (media_url && media_type === "audio") {
      const fetched = await fetchMediaAsBase64(clean(media_url));
      if (fetched) {
        texto =
          (await transcribeAudioWithGemini({
            apiKey,
            model,
            audioBase64: fetched.data,
            mime: clean(mime_type) || fetched.mime || "audio/ogg",
          })) || texto;
      }
    }

    const resetConversation = shouldResetConversation(texto);

    const oldOrder = resetConversation
      ? { ...emptyOrder }
      : sanitizeOldOrder(context?.order_data || {}, parsed);

    const productFromMessage = detectProduct(texto, parsed, "");
    const productFromContext = resetConversation
      ? clean(context?.last_ad_product || context?.current_product || inferProductFromHistory(history, parsed))
      : clean(context?.current_product || oldOrder.product);

    const product = detectProduct(
      productFromMessage || productFromContext || texto,
      parsed,
      productFromContext || oldOrder.product
    );

    const productInfo = getProductInfo(product, parsed);

    if (resetConversation && productInfo) {
      const freshOrder = {
        ...emptyOrder,
        product: productInfo.canonical,
      };

      await safeUpsertOrder(user_id, fromNumber, freshOrder, parsed, false);

      return res.json({
        response: `💰 ${productInfo.canonical}: ${formatGs(productInfo.price1)} Gs

📍 ¿Para qué ciudad sería el envío? 😊`,
        context: {
          ...(context || {}),
          current_product: productInfo.canonical,
          last_ad_product: productInfo.canonical,
          order_data: freshOrder,
          step: "collecting_city",
          updated_at: new Date().toISOString(),
        },
      });
    }

    const detectedCity = detectCity(texto, parsed, oldOrder.city);
    const phone = extractPhone(texto);
    const qty = sanitizeQuantity(extractQuantity(texto));

    const name = extractName(
      texto,
      detectedCity !== oldOrder.city ? detectedCity : "",
      phone
    );

    const address = extractAddress(
      texto,
      detectedCity !== oldOrder.city ? detectedCity : "",
      phone,
      name
    );

    let orderData = mergeOrderData(
      oldOrder,
      {
        quantity: qty,
        city: detectedCity !== oldOrder.city ? detectedCity : "",
        phone,
        name,
        address,
      },
      product
    );

    orderData.quantity = sanitizeQuantity(orderData.quantity);

    const finalProductInfo = getProductInfo(orderData.product, parsed);

    if (!finalProductInfo) {
      orderData = { ...orderData, product: "" };
    }

    if (orderData.product && !orderData.city) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      return res.json({
        response: `💰 ${orderData.product}: ${formatGs(finalProductInfo?.price1 || 0)} Gs

📍 ¿Para qué ciudad sería el envío? 😊`,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          last_ad_product: orderData.product,
          order_data: orderData,
          step: "collecting_city",
          updated_at: new Date().toISOString(),
        },
      });
    }

    if (orderData.product && orderData.city && !orderData.quantity) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      const promo = finalProductInfo?.price2
        ? `\n🔥 PROMO 2x → ${formatGs(finalProductInfo.price2)} Gs`
        : "";

      return res.json({
        response: `✅ Perfecto 😊 ${orderData.city} tiene ENVÍO GRATIS contra-entrega 🚚

🔥 ${orderData.product}
• 1 unidad → ${formatGs(finalProductInfo?.price1 || 0)} Gs${promo}

¿Cuántas unidades te gustaría llevar? ✨`,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          last_ad_product: orderData.product,
          order_data: orderData,
          step: "collecting_quantity",
          updated_at: new Date().toISOString(),
        },
      });
    }

    if (
      orderData.product &&
      orderData.city &&
      orderData.quantity &&
      !orderData.customer_name &&
      !orderData.address
    ) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      return res.json({
        response: quantityReply(orderData, parsed),
        context: {
          ...(context || {}),
          current_product: orderData.product,
          last_ad_product: orderData.product,
          order_data: orderData,
          step: "collecting_name",
          updated_at: new Date().toISOString(),
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
        response: missingDataReply(orderData),
        context: {
          ...(context || {}),
          current_product: orderData.product,
          last_ad_product: orderData.product,
          order_data: orderData,
          step: nextStep(orderData),
          updated_at: new Date().toISOString(),
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
        response: confirmation(orderData, parsed),
        context: {
          ...(context || {}),
          current_product: orderData.product,
          last_ad_product: orderData.product,
          order_data: orderData,
          step: "pedido_confirmado",
          updated_at: new Date().toISOString(),
        },
      });
    }

    const system = `
Sos vendedor de Mega Todo Store.
Usá SOLO este entrenamiento como fuente de verdad.

REGLAS:
- Los productos válidos son SOLO los de CATALOGO_PRODUCTOS.
- Nunca uses ciudades como producto.
- Nunca uses "quiero" como nombre.
- Nunca confirmes pedidos.
- Nunca calcules cantidad ni total.
- Si falta producto, ofrecé productos del catálogo.
- Si falta ciudad, preguntá ciudad.
- Si falta cantidad, preguntá cantidad.
- Si faltan datos, pedí solo lo faltante.
- No inventes precios.

ENTRENAMIENTO:
${trainingText}
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
      context: {
        ...(context || {}),
        current_product: orderData.product || context?.current_product || null,
        last_ad_product:
          orderData.product || context?.last_ad_product || context?.current_product || null,
        order_data: orderData,
        step: nextStep(orderData),
        updated_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("❌ chat-ia:", error);
    return res.status(500).json({
      error: error.message || "Error interno",
    });
  }
}
