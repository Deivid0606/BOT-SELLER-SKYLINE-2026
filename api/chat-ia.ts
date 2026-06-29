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

function sanitizeQuantity(q: any) {
  const n = Number(q);
  if (!Number.isFinite(n)) return 0;
  if (n < 1) return 0;
  if (n > 100) return 100;
  return n;
}

function isOrderStale(order: any, lastActivity: string) {
  const hasProduct = !!order?.product;
  const hasCity = !!order?.city;
  const hasQuantity = order?.quantity > 0;
  const hasCustomerData = !!(order?.customer_name || order?.address || order?.phone);

  const now = new Date();
  const last = new Date(lastActivity);
  const diffMinutes = (now.getTime() - last.getTime()) / (1000 * 60);

  return hasProduct && hasCity && hasQuantity && !hasCustomerData && diffMinutes > 10;
}

function isPriceQuery(text: string) {
  const m = normalize(text);
  return /\b(cuanto cuesta|precio|valor|costo|cuanto sale|cuanto vale)\b/.test(m);
}

function isNewConversation(context: any, history: any[]) {
  if (!history || history.length < 3) return true;

  const lastMessageTime = context?.updated_at;
  if (lastMessageTime) {
    const now = new Date();
    const last = new Date(lastMessageTime);
    const diffMinutes = (now.getTime() - last.getTime()) / (1000 * 60);
    if (diffMinutes > 30) return true;
  }

  return false;
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
    training.match(/CATALOGO_PRODUCTOS([\s\S]*?)FIN_CATALOGO_PRODUCTOS/i)?.[1] || "";

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

  const citySection =
    training.match(/LISTA COMPLETA POR CIUDAD([\s\S]*?)⚙️ INSTRUCCIÓN FINAL/i)?.[1] ||
    training.match(/ZONAS CON COBERTURA([\s\S]*?)ZONAS SIN COBERTURA/i)?.[1] ||
    "";

  const cityBlocks = citySection.split(/📍\s*/g).filter(Boolean);

  for (const block of cityBlocks) {
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
  }

  const simpleCoverage =
    training.match(/ZONAS CON COBERTURA([\s\S]*?)ZONAS SIN COBERTURA/i)?.[1] || "";

  simpleCoverage
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

      for (const w of a.split(" ").filter((x) => x.length >= 5)) {
        // palabra completa solamente, no substring parcial
        if (new RegExp(`\\b${w}\\b`).test(msg)) score += 15;
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

  // Tokenize message words para coincidencia parcial de alias multi-palabra
  const msgWords = msg.split(/\s+/);

  for (const c of parsed.cities) {
    const a = normalize(c.alias);
    if (!a || a.length < 2) continue;

    let score = 0;
    if (msg === a) score += 100;
    else if (msg.includes(a)) score += 80;
    else if (a.includes(msg) && msg.length >= 3) score += 50;
    else {
      // Coincidencia fuzzy: cuántas palabras del alias aparecen en el mensaje
      const aliasWords = a.split(/\s+/).filter((w) => w.length >= 3);
      if (aliasWords.length >= 2) {
        const matched = aliasWords.filter((w) => {
          // acepta singular/plural: "arroyo" coincide con "arroyos" y viceversa
          return msgWords.some(
            (mw) =>
              mw === w ||
              mw.startsWith(w) ||
              w.startsWith(mw)
          );
        });
        if (matched.length >= Math.ceil(aliasWords.length * 0.7)) {
          score += 60 + matched.length * 5;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = c.canonical;
    }
  }

  if (bestScore >= 50) return best;
  return clean(prev || "");
}

// Extrae el texto de ciudad cuando el cliente usa frases EXPLÍCITAS como "soy de X", "vivo en X"
// Solo activa con prefijos claros. Mensajes cortos sin prefijo NO se tratan como ciudad aquí.
function extractCityStatement(text: string): string {
  const raw = clean(text);
  const norm = normalize(raw);

  // Ignorar emojis, saludos, mensajes demasiado cortos o sin letras
  if (!raw || raw.length < 3 || /^[\p{Emoji}\s]+$/u.test(raw)) return "";
  if (/^\p{Emoji}/u.test(raw)) return "";

  const GREETINGS = /^(hola|buenas|buenos|buen dia|buen dia|hi|hey|buenas noches|buenas tardes|saludos|ok|dale|si|no|gracias|de nada|listo|perfecto)[\s!.]*$/;
  if (GREETINGS.test(norm)) return "";

  // Solo activar si tiene prefijo explícito de declaración de ciudad
  const match = norm.match(
    /^(?:soy de|vivo en|estoy en|ya estoy en|ya esty en|soy de la ciudad de|de la ciudad de|ciudad de|mi ciudad es|para la ciudad de)\s+(.+)$/
  );
  if (match) {
    return clean(match[1]);
  }

  return "";
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

function isBuyIntent(text: string) {
  const m = normalize(text);
  return /\b(si|quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmo|confirmar|ok|dale|listo)\b/.test(
    m
  );
}

function extractQuantity(text: string) {
  const m = normalize(text);

  const wordMap: Record<string, number> = {
    uno: 1, una: 1,
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

  // 1. Numero + unidad: "2 unidades", "1 unidad"
  const q1 = m.match(/\b(\d+)\s*(unidad|unidades|u|und|unds)\b/);
  if (q1) return sanitizeQuantity(Number(q1[1]));

  // 2. Palabra + unidad: "una unidad", "dos unidades", "solo una unidad"
  for (const [word, num] of Object.entries(wordMap)) {
    const regex = new RegExp(`\\b${word}\\s*(unidad|unidades|u\\b|und\\b)`);
    if (regex.test(m)) return sanitizeQuantity(num);
  }

  // 3. Verbo/solo + numero: "quiero 2", "solo 1"
  const q2 = m.match(/\b(quiero|llevo|dame|mandame|reservame|solo|solamente)\s+(\d+)\b/);
  if (q2) return sanitizeQuantity(Number(q2[2]));

  // 4. Numero + verbo: "2 quiero"
  const q3 = m.match(/\b(\d+)\s+(quiero|llevo|dame|mandame)\b/);
  if (q3) return sanitizeQuantity(Number(q3[1]));

  // 5. Verbo/solo + palabra: "quiero uno", "solo una", "dame dos"
  for (const [word, num] of Object.entries(wordMap)) {
    const regex = new RegExp(`\\b(quiero|llevo|dame|mandame|reservame|solo|solamente)\\s+${word}\\b`);
    if (regex.test(m)) return sanitizeQuantity(num);
  }

  // 6. Mensaje es solo un numero (pero NO si parece teléfono: 8+ dígitos o empieza con 09)
  if (/^\d+$/.test(m) && m.length <= 5 && !m.startsWith("09")) return sanitizeQuantity(Number(m));

  // 7. Palabra sola (menor prioridad)
  for (const [word, num] of Object.entries(wordMap)) {
    if (new RegExp(`\\b${word}\\b`).test(m)) return sanitizeQuantity(num);
  }

  return 0;
}

function extractPhone(text: string) {
  const compact = clean(text).replace(/\s+/g, "");
  const match = compact.match(/(?:09\d{8}|\+5959\d{8}|5959\d{8}|09\d{8,9})/);
  return match?.[0] || "";
}

// ✅ FIX 3: extractName con blacklist extendida y límite de palabras
function extractName(text: string, detectedCity: string, phone: string, parsed?: ParsedTraining) {
  const raw = clean(text);

  if (!raw) return "";

  // Si el texto es una cantidad, no puede ser nombre
  if (extractQuantity(raw) > 0) return "";

  // Si el texto parece ser una ciudad conocida, no puede ser nombre
  if (parsed) {
    const normRaw = normalize(raw);
    const isCity = parsed.cities.some((c) => {
      const a = normalize(c.alias);
      return a && (normRaw === a || normRaw.includes(a) || a.includes(normRaw));
    });
    if (isCity) return "";
  }

  const isMultiLine = raw.includes("\n");
  const lines = raw.split("\n").filter((l) => clean(l).length > 0);

  // Frases y palabras prohibidas como nombre
  const forbidden = [
    "quiero", "comprar", "me interesa", "precio", "delivery",
    "envio", "ok", "dale", "si", "hola", "buenas", "gracias",
    "cuanto", "cuando", "dia", "llega", "llego", "pedido",
    "cancelar", "no", "nebulizador", "raqueta", "que",
    "estado", "seguimiento", "ya", "fue", "como", "donde",
    "unidad", "unidades", "und", "unds", "una unidad", "dos unidades",
    "una", "uno", "dos", "tres", "cuatro", "cinco",
  ];

  // Verificación de línea como nombre válido
  const isValidNameLine = (line: string): boolean => {
    const cleaned = clean(line);
    const normLine = normalize(cleaned);
    const words = cleaned.split(/\s+/).filter(Boolean);

    if (words.length < 2 || words.length > 4) return false;
    if (/\d/.test(cleaned)) return false;
    if (!/^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(cleaned)) return false;
    if (cleaned.length < 4 || cleaned.length > 50) return false;
    if (/\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|esquina|casi)\b/i.test(normLine)) return false;

    // No debe ser igual a la ciudad detectada
    if (detectedCity && normalize(cleaned) === normalize(detectedCity)) return false;

    // No debe contener palabras prohibidas
    if (forbidden.some((f) => normLine === normalize(f) || normLine.startsWith(normalize(f) + " ") || normLine.endsWith(" " + normalize(f)))) return false;

    return true;
  };

  // 1. Intento explícito: "soy / me llamo / mi nombre es"
  const explicit = raw.match(
    /(?:soy|me llamo|mi nombre es|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,80})/i
  )?.[1];
  if (explicit) return clean(explicit);

  // 2. Si es multilínea, buscar línea por línea (excluye líneas con teléfono o dirección)
  if (isMultiLine) {
    for (const line of lines) {
      const cleaned = clean(line);
      // Saltar líneas con teléfono
      if (/\d{7,}/.test(cleaned)) continue;
      // Saltar líneas con palabras de dirección
      if (/\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|esquina|casi|rca|colombia|republica|nro|manzana)\b/i.test(normalize(cleaned))) continue;

      if (isValidNameLine(cleaned)) return cleaned;
    }
    return "";
  }

  // 3. Mensaje de una sola línea
  if (isValidNameLine(raw)) return raw;

  return "";
}

function extractAddress(text: string, detectedCity: string, phone: string, name: string) {
  const raw = clean(text);
  const norm = normalize(raw);

  if (/^\d+\s*(unidad|unidades|u|und|unds)?$/i.test(raw)) return "";
  if (/^\d+$/.test(raw)) return "";

  const lines = raw.split("\n").filter((l) => clean(l).length > 0);

  const explicit = raw.match(
    /(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i
  )?.[1];
  if (explicit) return clean(explicit);

  if (raw.includes("maps.app") || raw.includes("google.com/maps")) return raw;

  for (const line of lines) {
    const cleaned = clean(line);
    const normLine = normalize(cleaned);

    if (
      /\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote)\b/i.test(
        normLine
      )
    ) {
      if (name && normalize(cleaned).includes(normalize(name))) continue;
      if (phone && cleaned.includes(phone)) continue;
      return cleaned;
    }
  }

  if (/\d/.test(raw) && raw.length >= 8) {
    let remaining = raw;
    if (name) {
      const namePattern = name
        .split(/\s+/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s*");
      remaining = remaining.replace(new RegExp(namePattern, "i"), "").trim();
    }
    if (phone) {
      const phonePattern = phone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      remaining = remaining.replace(new RegExp(phonePattern, "g"), "").trim();
    }
    const wordsToRemove = [
      "soy", "me llamo", "mi nombre es", "nombre", "teléfono", "celular", "cel", "mi", "es",
    ];
    for (const word of wordsToRemove) {
      remaining = remaining.replace(new RegExp(`\\b${word}\\b`, "gi"), "").trim();
    }
    if (remaining.length >= 5) {
      return remaining;
    }
  }

  return "";
}

function sanitizeOldOrder(old: any, parsed: ParsedTraining) {
  const productInfo = getProductInfo(old?.product || "", parsed);
  const nameNorm = normalize(old?.customer_name || "");

  // ✅ FIX 3 también en sanitize: limpiar nombres inválidos guardados previamente
  const forbiddenNames = [
    "quiero", "cuando", "dia", "llega", "llego", "pedido", "cancelar",
    "no", "raqueta", "nebulizador", "que", "estado", "seguimiento",
    "ya fue", "que dia llega mi pedido", "no raqueta",
  ];
  const isInvalidName = forbiddenNames.some((f) =>
    nameNorm.includes(normalize(f))
  ) || nameNorm.split(" ").length > 4;

  return {
    product: productInfo?.canonical || "",
    quantity: sanitizeQuantity(old?.quantity || 0),
    city: clean(old?.city || ""),
    customer_name:
      old?.customer_name && nameNorm !== "quiero" && !isInvalidName
        ? clean(old.customer_name)
        : "",
    phone: clean(old?.phone || ""),
    address: clean(old?.address || ""),
  };
}

function mergeOrderData(old: any, ext: any, product: string) {
  return {
    product: product || old.product || "",
    quantity: ext.quantity > 0 ? sanitizeQuantity(ext.quantity) : sanitizeQuantity(old.quantity || 0),
    city: ext.city || old.city || "",
    customer_name: ext.name || old.customer_name || "",
    phone: ext.phone || old.phone || "",
    address: ext.address || old.address || "",
  };
}

function calculateTotal(productName: string, quantity: number, parsed: ParsedTraining) {
  const p = getProductInfo(productName, parsed);
  if (!p) return 0;

  const q = sanitizeQuantity(quantity);

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

💵 Pago anticipado por transferencia.

📲 DATOS PARA TRANSFERENCIA:

Titular: DAVID AGUSTIN ALCARAZ AGUILAR
Banco Familiar
Cuenta: 81-4981442
Alias: 0994130022`;
}

// ✅ FIX 1: safeUpsertOrder busca también pedidos ya confirmados para no duplicar
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
    quantity: order.quantity || 1,
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
      "confirmed",        // ✅ FIX 1: evita crear pedido nuevo si ya fue confirmado
      "pedido_confirmado",// ✅ FIX 1: ídem
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

function inferProductFromLastBotMessage(history: any[], parsed: ParsedTraining) {
  const lastBotMessages = (history || [])
    .slice(-6)
    .reverse()
    .filter((h: any) => h.role === "assistant" || h.role === "model");

  for (const item of lastBotMessages) {
    const content = clean(item?.content);
    if (!content) continue;

    const product = detectProduct(content, parsed, "");
    if (product) return product;
  }

  return "";
}

function isRespondingToPromotion(text: string, history: any[]) {
  const isBuy = isBuyIntent(text);
  if (!isBuy) return false;

  const lastBotMessages = (history || [])
    .slice(-3)
    .filter((h: any) => h.role === "assistant" || h.role === "model");

  for (const item of lastBotMessages) {
    const content = clean(item?.content);
    if (!content) continue;

    if (
      content.includes("Oferta") ||
      content.includes("promoción") ||
      content.includes("🔥") ||
      content.includes("HOY") ||
      content.includes("antes") ||
      content.includes("llevate")
    ) {
      return true;
    }
  }

  return false;
}

function getProductFromLastPromotion(history: any[], parsed: ParsedTraining) {
  const lastBotMessages = (history || [])
    .slice(-6)
    .reverse()
    .filter((h: any) => h.role === "assistant" || h.role === "model");

  for (const item of lastBotMessages) {
    const content = clean(item?.content);
    if (!content) continue;

    const contentNorm = normalize(content);

    const sortedProducts = [...parsed.products].sort(
      (a, b) => normalize(b.canonical).length - normalize(a.canonical).length
    );

    for (const product of sortedProducts) {
      const canonicalNorm = normalize(product.canonical);
      if (canonicalNorm.length >= 4 && contentNorm.includes(canonicalNorm)) {
        return product;
      }
    }

    for (const product of sortedProducts) {
      const sortedAliases = [...product.aliases].sort(
        (a, b) => normalize(b).length - normalize(a).length
      );
      for (const alias of sortedAliases) {
        const aliasNorm = normalize(alias);
        if (aliasNorm.length >= 5 && contentNorm.includes(aliasNorm)) {
          return product;
        }
      }
    }
  }

  return null;
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

    let oldOrder = sanitizeOldOrder(context?.order_data || {}, parsed);

    // ✅ FIX 2: Bloqueo post-pedido — si ya fue confirmado, responder sin procesar
    if (context?.step === "pedido_confirmado") {
      const msgNorm = normalize(texto);
      const isFollowUp =
        /cuand|llega|llego|dia|estado|seguimiento|cancelar|ya fue|cuando|entrega|envio|despacho/.test(
          msgNorm
        );
      const isGratitude =
        /\b(gracias|muchas gracias|grax|grac|bueno gracias|buenas gracias|dale gracias|ok|dale|perfecto|listo|genial|excelente|buenisimo|buenísimo|de nada|chevere|chévere|okey)\b/.test(
          msgNorm
        ) || /^(👍|🙏|😊|✅)/.test(msgNorm);
      const hasNewProduct = !!detectProduct(texto, parsed, "");
      // Si el cliente responde a una nueva promoción (bot mandó oferta), no bloquear
      const isPromoResponse = isRespondingToPromotion(texto, history);

      if (!isPromoResponse && isGratitude) {
        return res.json({
          response: `¡De nada! 😊 Fue un placer atenderte. Tu pedido de *${context.order_data?.product || "tu producto"}* ya está agendado, el delivery te va a contactar cuando llegue a tu zona. ¡Que lo disfrutes! 💜`,
          context: {
            ...context,
            updated_at: new Date().toISOString(),
          },
        });
      }

      if (!isPromoResponse && (isFollowUp || !hasNewProduct)) {
        return res.json({
          response: `🚚 Tu pedido de *${context.order_data?.product || "tu producto"}* está agendado para la próxima ronda de envíos. El delivery te confirma al llegar a tu zona. 😊`,
          context: {
            ...context,
            updated_at: new Date().toISOString(),
          },
        });
      }
      // Si el cliente menciona un producto nuevo o responde a promoción, reiniciar para nuevo pedido
      oldOrder = { product: "", quantity: 0, city: "", customer_name: "", phone: "", address: "" };
    }

    if (isPriceQuery(texto)) {
      const productMentioned = detectProduct(texto, parsed, "");

      if (productMentioned) {
        const productInfo = getProductInfo(productMentioned, parsed);
        if (productInfo) {
          const resetOrder = {
            product: productInfo.canonical,
            quantity: 0,
            city: "",
            customer_name: "",
            phone: "",
            address: "",
          };

          return res.json({
            response: `💰 ${productInfo.canonical}: ${formatGs(productInfo.price1)} Gs

📍 ¿Para qué ciudad sería el envío? 😊`,
            context: {
              ...(context || {}),
              current_product: productInfo.canonical,
              order_data: resetOrder,
              step: "collecting_city",
              updated_at: new Date().toISOString(),
            },
          });
        }
      }

      const defaultProduct =
        parsed.products.find((p) => normalize(p.canonical).includes("nebulizador")) ||
        parsed.products[0];

      if (defaultProduct) {
        const resetOrder = {
          product: defaultProduct.canonical,
          quantity: 0,
          city: "",
          customer_name: "",
          phone: "",
          address: "",
        };

        return res.json({
          response: `💰 ${defaultProduct.canonical}: ${formatGs(defaultProduct.price1)} Gs

📍 ¿Para qué ciudad sería el envío? 😊`,
          context: {
            ...(context || {}),
            current_product: defaultProduct.canonical,
            order_data: resetOrder,
            step: "collecting_city",
            updated_at: new Date().toISOString(),
          },
        });
      }
    }

    if (isOrderStale(oldOrder, context?.updated_at || new Date().toISOString())) {
      oldOrder = {
        product: "",
        quantity: 0,
        city: "",
        customer_name: "",
        phone: "",
        address: "",
      };

      return res.json({
        response: `🔄 Veo que tenías un pedido incompleto. Comencemos de nuevo.

📋 ¿Qué producto te interesa? Tenemos el Nebulizador Portátil en oferta por 129.900 Gs.

Escribí el nombre o mirá el catálogo: ${CATALOG_URL}`,
        context: {
          ...(context || {}),
          order_data: oldOrder,
          current_product: null,
          step: "selling",
          updated_at: new Date().toISOString(),
        },
      });
    }

    const buyIntent = isBuyIntent(texto);
    const hasProductInMessage = parsed.products.some(
      (p) =>
        normalize(texto).includes(normalize(p.canonical)) ||
        p.aliases.some((a) => normalize(texto).includes(normalize(a)))
    );

    if (buyIntent && !hasProductInMessage) {
      const isPromoResponse = isRespondingToPromotion(texto, history);

      if (isPromoResponse) {
        const promoProduct = getProductFromLastPromotion(history, parsed);

        if (promoProduct) {
          const resetOrder = {
            product: promoProduct.canonical,
            quantity: 0,
            city: "",
            customer_name: "",
            phone: "",
            address: "",
          };

          return res.json({
            response: `🔥 ¡Excelente decisión! 😊

Tenemos el **${promoProduct.canonical}** en oferta:

💰 Precio especial: ${formatGs(promoProduct.price1)} Gs (promoción por tiempo limitado)

📍 ¿Para qué ciudad sería el envío? 😊`,
            context: {
              ...(context || {}),
              current_product: promoProduct.canonical,
              order_data: resetOrder,
              step: "collecting_city",
              updated_at: new Date().toISOString(),
            },
          });
        }
      }

      const hasExistingOrder = oldOrder.product && oldOrder.city;

      if (hasExistingOrder) {
        if (isNewConversation(context, history)) {
          const resetOrder = {
            product: "",
            quantity: 0,
            city: "",
            customer_name: "",
            phone: "",
            address: "",
          };

          const productFromContext = clean(
            context?.last_ad_product || inferProductFromLastBotMessage(history, parsed)
          );

          if (productFromContext) {
            const productInfo = getProductInfo(productFromContext, parsed);
            if (productInfo) {
              resetOrder.product = productInfo.canonical;

              return res.json({
                response: `🔥 ¡Excelente decisión! 😊

Tenemos el **${productInfo.canonical}** en oferta:

💰 Precio especial: ${formatGs(productInfo.price1)} Gs (promoción por tiempo limitado)

📍 ¿Para qué ciudad sería el envío? 😊`,
                context: {
                  ...(context || {}),
                  current_product: productInfo.canonical,
                  order_data: resetOrder,
                  step: "collecting_city",
                  updated_at: new Date().toISOString(),
                },
              });
            }
          }
        }

        return res.json({
          response: `✅ Ya estabas viendo el **${oldOrder.product}**.

¿Querés ese mismo producto o querés ver otro?

📋 Catálogo completo: ${CATALOG_URL}

Escribí el nombre del producto que te interesa. 😊`,
          context: {
            ...(context || {}),
            current_product: oldOrder.product,
            order_data: oldOrder,
            step: "clarifying_intent",
            updated_at: new Date().toISOString(),
          },
        });
      }

      const resetOrder = {
        product: "",
        quantity: 0,
        city: "",
        customer_name: "",
        phone: "",
        address: "",
      };

      const productFromContext = clean(
        context?.last_ad_product || inferProductFromLastBotMessage(history, parsed)
      );

      if (productFromContext) {
        const productInfo = getProductInfo(productFromContext, parsed);
        if (productInfo) {
          resetOrder.product = productInfo.canonical;

          return res.json({
            response: `🔥 ¡Excelente decisión! 😊

Tenemos el **${productInfo.canonical}** en oferta:

💰 Precio especial: ${formatGs(productInfo.price1)} Gs (promoción por tiempo limitado)

📍 ¿Para qué ciudad sería el envío? 😊`,
            context: {
              ...(context || {}),
              current_product: productInfo.canonical,
              order_data: resetOrder,
              step: "collecting_city",
              updated_at: new Date().toISOString(),
            },
          });
        }
      }

      const defaultProduct =
        parsed.products.find((p) => normalize(p.canonical).includes("nebulizador")) ||
        parsed.products[0];

      if (defaultProduct) {
        resetOrder.product = defaultProduct.canonical;

        return res.json({
          response: `🔥 ¡Excelente decisión! 😊

Tenemos el **${defaultProduct.canonical}** en oferta:

💰 Precio especial: ${formatGs(defaultProduct.price1)} Gs (promoción por tiempo limitado)

📍 ¿Para qué ciudad sería el envío? 😊`,
          context: {
            ...(context || {}),
            current_product: defaultProduct.canonical,
            order_data: resetOrder,
            step: "collecting_city",
            updated_at: new Date().toISOString(),
          },
        });
      }

      return res.json({
        response: `📋 Te invito a revisar nuestro catálogo completo:
${CATALOG_URL}

Escribí el nombre del producto que te interesa. 😊`,
        context: {
          ...(context || {}),
          current_product: null,
          order_data: resetOrder,
          step: "selling",
          updated_at: new Date().toISOString(),
        },
      });
    }

    const productFromMessage = detectProduct(texto, parsed, "");
    const productToUse = productFromMessage || context?.current_product || oldOrder.product;

    const product = detectProduct(texto, parsed, productToUse);

    // Si el cliente está declarando una ciudad ("soy de X"), intentar detectarla primero.
    // Si no la reconoce pero el mensaje ES una declaración explícita de ciudad, usarla como ciudad cruda
    // para que no caiga al fallback del oldOrder.city anterior.
    const cityStatement = extractCityStatement(texto);
    const detectedCityRaw = detectCity(texto, parsed, ""); // sin fallback al anterior
    const prevStep = context?.step || "";
    const isCityStep = prevStep === "collecting_city";
    const detectedCity =
      detectedCityRaw ||
      // Con prefijo explícito ("soy de X") siempre lo tratamos como ciudad
      (cityStatement && !extractQuantity(texto) && !extractPhone(texto) ? cityStatement :
       // Sin prefijo, solo si el step es collecting_city y el mensaje es corto y parece ciudad
       (isCityStep && !extractQuantity(texto) && !extractPhone(texto) && !detectProduct(texto, parsed, "") && normalize(texto).split(/\s+/).length <= 5
         ? (clean(texto) || detectCity(texto, parsed, oldOrder.city))
         : detectCity(texto, parsed, oldOrder.city)));
    const phone = extractPhone(texto);
    const qty = extractQuantity(texto);
    const name = extractName(texto, detectedCity !== oldOrder.city ? detectedCity : "", phone, parsed);
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

    const productInfo = getProductInfo(orderData.product, parsed);

    if (!productInfo) {
      orderData = { ...orderData, product: "" };
    }

    if (!orderData.product) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      return res.json({
        response: `📋 ¿Qué producto te gustaría llevar?

Tenemos el **Nebulizador Portátil** en oferta por 129.900 Gs.

📦 Escribí el nombre del producto o revisá el catálogo:
${CATALOG_URL}`,
        context: {
          ...(context || {}),
          current_product: null,
          order_data: orderData,
          step: "selling",
          updated_at: new Date().toISOString(),
        },
      });
    }

    if (orderData.product && !orderData.city) {
      // Si el step anterior era collecting_city, el mensaje actual probablemente ES la ciudad
      // aunque no esté registrada en training. Usarla como ciudad sin cobertura.
      const prevStep = context?.step || "";
      const looksLikeCity =
        prevStep === "collecting_city" &&
        !extractQuantity(texto) &&
        !extractPhone(texto) &&
        !detectProduct(texto, parsed, "") &&
        normalize(texto).length >= 2 &&
        normalize(texto).split(/\s+/).length <= 6;

      if (looksLikeCity) {
        const rawCity = clean(texto);
        orderData = { ...orderData, city: rawCity };

        await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

        const promo = productInfo?.price2
          ? `\n🔥 PROMO 2x → ${formatGs(productInfo.price2)} Gs`
          : "";

        return res.json({
          response: `ℹ️ ${rawCity} no entra en nuestra zona de contra-entrega 😊

Pero sí hacemos envíos seguros por transportadora:
🚚 TSI / NASA / Occidental / MG Express / Multienvíos

📦 En tu zona trabajamos con pago anticipado por transferencia.

🔥 ${orderData.product}:
• 1 unidad → ${formatGs(productInfo?.price1 || 0)} Gs${promo}

📲 DATOS PARA TRANSFERENCIA:

Titular: David Agustin Alcaraz Aguilar
CI: 5347454
Entidad: ueno bank
N° de cuenta: 18107326
Alias: 5347454

📎 Enviame:
✅ comprobante
✅ nombre completo
✅ teléfono

y confirmamos tu pedido 🚚✨`,
          context: {
            ...(context || {}),
            current_product: orderData.product,
            order_data: orderData,
            step: "collecting_quantity",
            updated_at: new Date().toISOString(),
          },
        });
      }

      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      return res.json({
        response: `💰 ${orderData.product}: ${formatGs(productInfo?.price1 || 0)} Gs

📍 ¿Para qué ciudad sería el envío? 😊`,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          order_data: orderData,
          step: "collecting_city",
          updated_at: new Date().toISOString(),
        },
      });
    }

    if (orderData.product && orderData.city && !orderData.quantity) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      const coverage = hasCoverage(orderData.city, parsed);
      const promo = productInfo?.price2
        ? `\n🔥 PROMO 2x → ${formatGs(productInfo.price2)} Gs`
        : "";

      if (!coverage) {
        return res.json({
          response: `ℹ️ ${orderData.city} no entra en nuestra zona de contra-entrega 😊

Pero sí hacemos envíos seguros por transportadora:
🚚 TSI / NASA / Occidental / MG Express / Multienvíos

📦 En tu zona trabajamos con pago anticipado por transferencia.

🔥 ${orderData.product}:
• 1 unidad → ${formatGs(productInfo?.price1 || 0)} Gs${promo}

📲 DATOS PARA TRANSFERENCIA:

Titular: David Agustin Alcaraz Aguilar
CI: 5347454
Entidad: ueno bank
N° de cuenta: 18107326
Alias: 5347454

📎 Enviame:
✅ comprobante
✅ nombre completo
✅ teléfono

y confirmamos tu pedido 🚚✨`,
          context: {
            ...(context || {}),
            current_product: orderData.product,
            order_data: orderData,
            step: "collecting_quantity",
            updated_at: new Date().toISOString(),
          },
        });
      }

      return res.json({
        response: `✅ Perfecto 😊 ${orderData.city} tiene ENVÍO GRATIS contra-entrega 🚚

🔥 ${orderData.product}
• 1 unidad → ${formatGs(productInfo?.price1 || 0)} Gs${promo}

¿Cuántas unidades te gustaría llevar? ✨`,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          order_data: orderData,
          step: "collecting_quantity",
          updated_at: new Date().toISOString(),
        },
      });
    }

    if (
      orderData.product &&
      orderData.city &&
      orderData.quantity > 0 &&
      (!orderData.customer_name || !orderData.address || !orderData.phone)
    ) {
      orderData.quantity = sanitizeQuantity(orderData.quantity);

      const total = calculateTotal(orderData.product, orderData.quantity, parsed);

      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      const missing = [];
      if (!orderData.customer_name) missing.push("nombre y apellido");
      if (!orderData.address) missing.push("dirección exacta");
      if (!orderData.phone) missing.push("número de celular");

      if (missing.length === 3) {
        const rawText = clean(message);
        const lines = rawText.split("\n").filter((l) => clean(l).length > 0);

        if (!orderData.phone) {
          for (const line of lines) {
            const phoneMatch = line.match(/(09\d{8}|09\d{8,9})/);
            if (phoneMatch) {
              orderData.phone = phoneMatch[0];
              break;
            }
          }
        }

        if (!orderData.customer_name) {
          for (const line of lines) {
            const cleaned = clean(line);
            const normCleaned = normalize(cleaned);
            const lineWords = cleaned.split(/\s+/).filter(Boolean);

            if (lineWords.length < 2 || lineWords.length > 4) continue;
            if (/\d/.test(cleaned)) continue;
            if (!/^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(cleaned)) continue;
            if (cleaned.length < 4 || cleaned.length > 50) continue;
            if (/\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|esquina|casi|rca|colombia|republica|nro)\b/i.test(normCleaned)) continue;
            if (orderData.city && normalize(cleaned) === normalize(orderData.city)) continue;

            const forbidden = [
              "quiero", "comprar", "precio", "delivery", "envio",
              "ok", "dale", "si", "hola", "gracias",
              "cuanto", "cuando", "dia", "llega", "llego",
              "pedido", "cancelar", "no", "que", "estado",
              "seguimiento", "ya", "fue",
              "unidad", "unidades", "und", "unds",
              "una", "uno", "dos", "tres", "cuatro", "cinco",
            ];
            if (extractQuantity(cleaned) > 0) continue;
            if (!forbidden.some((f) => normCleaned === normalize(f) || normCleaned.startsWith(normalize(f) + " ") || normCleaned.endsWith(" " + normalize(f)))) {
              orderData.customer_name = cleaned;
              break;
            }
          }
        }

        if (!orderData.address) {
          for (const line of lines) {
            const cleaned = clean(line);
            if (
              /\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote)\b/i.test(
                normalize(cleaned)
              )
            ) {
              if (orderData.customer_name && normalize(cleaned).includes(normalize(orderData.customer_name)))
                continue;
              if (orderData.phone && cleaned.includes(orderData.phone)) continue;
              orderData.address = cleaned;
              break;
            }
          }
        }

        const missingAfterRetry = [];
        if (!orderData.customer_name) missingAfterRetry.push("nombre y apellido");
        if (!orderData.address) missingAfterRetry.push("dirección exacta");
        if (!orderData.phone) missingAfterRetry.push("número de celular");

        if (missingAfterRetry.length === 0) {
          if (
            orderData.product &&
            orderData.city &&
            orderData.quantity > 0 &&
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
                order_data: orderData,
                step: "pedido_confirmado",
                updated_at: new Date().toISOString(),
              },
            });
          }
        }

        const missingFinal = [];
        if (!orderData.customer_name) missingFinal.push("nombre y apellido");
        if (!orderData.address) missingFinal.push("dirección exacta");
        if (!orderData.phone) missingFinal.push("número de celular");

        return res.json({
          response: `🔥 Perfecto 😊

📦 ${orderData.product}
🔢 Cantidad: ${orderData.quantity}
💰 Total: ${formatGs(total)} Gs

🚚 Envío GRATIS contra-entrega

📎 Me falta: ${missingFinal.join(", ")}

📲 Podés enviarlo TODO JUNTO o de a uno, voy registrando 😊

y agendamos tu entrega ✨`,
          context: {
            ...(context || {}),
            current_product: orderData.product,
            order_data: orderData,
            step: nextStep(orderData),
            updated_at: new Date().toISOString(),
          },
        });
      }

      return res.json({
        response: `🔥 Perfecto 😊

📦 ${orderData.product}
🔢 Cantidad: ${orderData.quantity}
💰 Total: ${formatGs(total)} Gs

🚚 Envío GRATIS contra-entrega

📎 Me falta: ${missing.join(", ")}

📲 Podés enviarlo TODO JUNTO o de a uno, voy registrando 😊

y agendamos tu entrega ✨`,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          order_data: orderData,
          step: nextStep(orderData),
          updated_at: new Date().toISOString(),
        },
      });
    }

    if (
      orderData.product &&
      orderData.city &&
      orderData.quantity > 0 &&
      orderData.customer_name &&
      orderData.address &&
      orderData.phone
    ) {
      if (!getProductInfo(orderData.product, parsed)) {
        return res.json({
          response:
            "🙏 Para confirmar necesito saber qué producto querés. ¿Te referís al Nebulizador Portátil?",
          context: {
            ...(context || {}),
            order_data: { ...orderData, product: "" },
            current_product: null,
            step: "selling",
            updated_at: new Date().toISOString(),
          },
        });
      }

      orderData.quantity = sanitizeQuantity(orderData.quantity);

      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, true);

      return res.json({
        response: confirmation(orderData, parsed),
        context: {
          ...(context || {}),
          current_product: orderData.product,
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
- Nunca confirmes si falta producto, ciudad, cantidad, nombre, dirección o teléfono.
- Si falta producto, ofrecé productos del catálogo.
- Si falta ciudad, preguntá ciudad.
- Si falta cantidad, preguntá cantidad.
- Si faltan datos, pedí solo lo faltante.
- No inventes precios.
- NO GENERES CANTIDADES NI TOTALES. El backend los calcula automáticamente.
- Si el cliente pregunta por el estado de su pedido ya confirmado, responder SOLO: "Tu pedido está agendado para la próxima ronda de envíos. El delivery te confirma al llegar."

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
      response: aiResponse || `📋 Te invito a revisar nuestro catálogo:\n${CATALOG_URL}`,
      context: {
        ...(context || {}),
        current_product: orderData.product || null,
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
