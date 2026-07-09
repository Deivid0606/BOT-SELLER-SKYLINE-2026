import { createClient } from "@supabase/supabase-js";

/**
 * CHAT IA VENDEDOR AUTÓNOMO V3 - Mega Todo Store / One Store
 *
 * Soluciona:
 * 1) La IA vende sola y redacta fluido.
 * 2) El backend solo detecta, valida, calcula, guarda y protege reglas.
 * 3) NO reutiliza ciudad/datos viejos cuando entra una nueva campaña/producto.
 * 4) Si el cliente responde "quiero" desde una promo, respeta la promo.
 * 5) Si el cliente responde "quiero uno", "una unidad", "solo 1", desbloquea la promo.
 * 6) Nunca inventa ciudad, nombre, dirección, teléfono, banco ni catálogo.
 * 7) No se salta ciudad ni cantidad.
 * 8) Confirmación final 100% fija desde backend, nunca generada por Gemini.
 * 9) Precio de plantilla congelado: nunca toma números de dirección/teléfono como precio.
 * 10) Después de pedido confirmado, cierra el flujo y no vuelve a vender el mismo pedido.
 * 11) Detecta packs fijos genéricos para cualquier vendedor sin hardcodear precios/productos.
 * 12) Si plantilla trae Producto + Cantidad + Precio, salta la pregunta de cantidad.
 * 13) Si llega plantilla/producto nuevo después de pedido_confirmado, inicia venta nueva.
 * 14) Postventa: después de confirmado responde preguntas normales sin reabrir pedido.
 * 15) FIX V4: extrae nombre correctamente en mensajes multilinea con ciudad + dirección.
 * 16) FIX V4: factura postventa responde factura de forma determinística, no delivery.
 * 17) FIX V5: después de pedido_confirmado, una plantilla/precio nuevo pegado por el cliente reinicia venta nueva antes de cierre postventa.
 * 18) FIX V12: detección de producto ignora palabras genéricas como unidades y reconoce singular/plural.
 * 18) FIX V11: si el cliente pidió explícitamente otro producto antes de una plantilla nueva, ese producto gana sobre contexto viejo.
 * 18) FIX V9: si el pedido ya tiene todos los datos obligatorios, confirma directo con bloque fijo backend; nunca pregunta “¿Confirmamos?”.
 * 18) FIX V8: después de postventa, si llega una nueva plantilla y el cliente responde "Quiero confirmar", inicia otra venta nueva.
 * 18) FIX V7: cuando el cliente responde QUIERO a una plantilla nueva, el producto de la plantilla gana sobre contexto/historial viejo.
 * 18) FIX V6: si hay plantilla activa, producto/cantidad/precio salen SOLO de la plantilla; el catálogo/entrenamiento no compite.
 *
 * IMPORTANTE:
 * - Si tu tabla orders NO tiene columna locked_offer, eliminá payload.locked_offer
 *   o agregá una columna jsonb:
 *   alter table orders add column if not exists locked_offer jsonb;
 *   alter table orders add column if not exists order_id text;
 *   alter table orders add column if not exists payment_proof_received boolean default false;
 *   create unique index if not exists orders_user_order_id_unique on orders(user_id, order_id);
 */

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

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
  // ✅ Se completa cuando el producto viene de un copy de venta libre (sin
  // catálogo formal) cuyo ÚNICO precio detectado es para un pack de N
  // unidades (ej. "2 por 99.000 Gs"), sin precio real de 1 unidad.
  // Marca que la cantidad es fija y no se debe preguntar "1 o 2 unidades".
  fixedPackQuantity?: number;
  // ✅ Copy de venta original (MENSAJE_VENTA del catálogo formal, o el texto
  // libre completo cuando el producto se detectó automáticamente). La IA lo
  // usa como base para redactar/mejorar la presentación, sin poder cambiar
  // el precio que ya viene calculado por el backend.
  salesCopy?: string;
};

type OfferItem = {
  product: string;
  quantity: number;
  total: number;
  label?: string;
  source?: "template" | "catalog" | "context";
  fixed_quantity?: boolean;
};

type TemplatePricing = {
  product: string;
  price1?: number;
  offers: OfferItem[];
  raw?: string;
  fixed_quantity?: boolean;
};

type BankData = {
  titular?: string;
  ci?: string;
  entidad?: string;
  banco?: string;
  cuenta?: string;
  alias?: string;
  raw?: string;
};

type ParsedTraining = {
  products: ProductItem[];
  cities: { alias: string; canonical: string }[];
  catalogUrl: string;
  bankData: BankData | null;
  raw: string;
};

type OrderData = {
  order_id?: string;
  product: string;
  quantity: number;
  city: string;
  customer_name: string;
  address: string;
  phone: string;
  locked_offer?: OfferItem | null;
  payment_proof_received?: boolean;
};

type ConversationState = {
  order: OrderData;
  step: string;
  productInfo: ProductItem | null;
  coverage: boolean | null;
  total: number;
  missing: string[];
  hardInstruction: string;
};

function makeOrderId(fromNumber: string) {
  const safeFrom = clean(fromNumber).replace(/\D/g, "").slice(-8) || "chat";
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${Date.now()}-${safeFrom}-${rand}`;
}

function emptyOrder(orderId?: string): OrderData {
  return {
    order_id: orderId || "",
    product: "",
    quantity: 0,
    city: "",
    customer_name: "",
    address: "",
    phone: "",
    locked_offer: null,
    payment_proof_received: false,
  };
}

function sanitizeQuantity(q: any) {
  const n = Number(q);
  if (!Number.isFinite(n)) return 0;
  if (n < 1) return 0;
  if (n > 100) return 100;
  return n;
}

function formatGs(n: number) {
  return Number(n || 0).toLocaleString("es-PY");
}

function parseNumberGs(raw: string) {
  return Number(clean(raw).replace(/[^\d]/g, "") || 0);
}

function isPriceQuery(text: string) {
  const m = normalize(text);
  return /\b(cuanto cuesta|precio|valor|costo|cuanto sale|cuanto vale|cuanto es|cuestan|sale)\b/.test(m);
}

function isBuyIntent(text: string) {
  const m = normalize(text);
  return /\b(si|sí|quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmo|confirmar|ok|dale|listo|me interesa|lo quiero|quiero ese|quiero eso|ese quiero)\b/.test(m);
}

function isGenericBuyReply(text: string) {
  const m = normalize(text);
  if (!m) return false;

  const exact = [
    "quiero", "si", "sí", "si quiero", "lo quiero", "quiero comprar",
    "quiero llevar", "me interesa", "comprar", "compro", "dale",
    "ok", "listo", "confirmo", "reservar", "reservame", "agendar",
    "agendame", "quiero ese", "quiero eso", "ese quiero", "ese",
  ];

  if (exact.includes(m)) return true;

  return /^(si\s+)?(quiero|lo quiero|me interesa|comprar|compro|dale|ok|listo|confirmo|ese quiero|quiero ese|quiero eso)$/.test(m);
}

function isAffirmative(text: string) {
  const m = normalize(text);
  return /^(si|sí|sii|siii|ok|dale|listo|correcto|asi es|así es|confirmo|exacto|eso|ese|quiero)$/.test(m);
}

function hasExplicitQuantity(text: string) {
  return extractQuantity(text) > 0;
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

function parseCatalogUrl(training: string) {
  const explicit =
    training.match(/CATALOGO_URL\s*:\s*(https?:\/\/\S+)/i)?.[1] ||
    training.match(/URL_CATALOGO\s*:\s*(https?:\/\/\S+)/i)?.[1] ||
    training.match(/(?:cat[aá]logo|catalogo).*?(https?:\/\/\S+)/i)?.[1] ||
    "";

  return clean(explicit).replace(/[)\].,;]+$/, "");
}

function parseBankData(training: string): BankData | null {
  const block =
    training.match(/DATOS_(?:BANCARIOS|TRANSFERENCIA)([\s\S]*?)(?:FIN_DATOS_(?:BANCARIOS|TRANSFERENCIA)|---|CATALOGO_PRODUCTOS|$)/i)?.[1] ||
    training.match(/(?:DATOS PARA TRANSFERENCIA|PAGO ANTICIPADO POR TRANSFERENCIA)([\s\S]*?)(?:---|CATALOGO_PRODUCTOS|FIN_|$)/i)?.[1] ||
    "";

  const raw = clean(block);
  if (!raw) return null;

  const get = (...labels: string[]) => {
    for (const label of labels) {
      const re = new RegExp(`^\\s*${label}\\s*[:\\-]?\\s*(.+)$`, "im");
      const v = raw.match(re)?.[1];
      if (v) return clean(v);
    }
    return "";
  };

  return {
    titular: get("Titular"),
    ci: get("CI", "Cédula", "Cedula"),
    entidad: get("Entidad"),
    banco: get("Banco"),
    cuenta: get("N° de cuenta", "Nro de cuenta", "Numero de cuenta", "Número de cuenta", "Cuenta"),
    alias: get("Alias"),
    raw,
  };
}

/**
 * ✅ Intenta extraer un nombre de producto directamente de un texto de venta libre,
 * sin depender de un catálogo formal. Prioriza frases tipo:
 * "2 Afiladores Profesionales por solo Gs. 99.000" → "Afiladores Profesionales"
 * "Procesador de Alimentos Premium RAF PRO® preparás..." → "Procesador de Alimentos Premium RAF PRO"
 */
function isGenericMarketingPhrase(normCanonical: string) {
  const words = normCanonical.split(" ").filter(Boolean);
  const genericWords = new Set([
    "oferta", "ofertas", "promo", "promos", "promocion", "promoción",
    "descuento", "descuentos", "gratis", "hoy", "ahora", "antes",
    "stock", "limitado", "limitada", "envio", "envío", "delivery",
    "pagas", "pagás", "recibir", "unidad", "unidades", "solo",
    "solamente", "precio", "precios", "valido", "válido", "valida", "válida",
  ]);
  // Si TODAS las palabras del nombre detectado son genéricas de marketing
  // (ej: "Oferta Hoy", "Stock Limitado"), no es un producto real.
  return words.length > 0 && words.every((w) => genericWords.has(w));
}

function extractProductNameFromCopy(text: string): string {
  const raw = clean(text);
  if (!raw) return "";

  // Prioridad 1: "<cantidad> <Nombre Producto> por (solo) Gs. <precio>"
  const afterQty = raw.match(
    /\b\d+\s+((?:[A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñ®'’.]*\s*){1,5})\s*(?:por|a|solo|solamente)\s+(?:solo\s+)?(?:[Gg][Ss]\.?)?\s*\d/
  );
  if (afterQty) {
    const candidate = clean(afterQty[1]).replace(/[.,]+$/, "");
    if (candidate.split(/\s+/).length <= 6) return candidate;
  }

  // Prioridad 2: "Con el <Nombre Producto>" (frases de copy tipo "Con el Procesador de Alimentos...")
  const conEl = raw.match(/\bcon\s+(?:el|la|los|las)\s+((?:[A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñ®'’.]*\s*){1,6})/);
  if (conEl) {
    const candidate = clean(conEl[1]).replace(/[.,]+$/, "");
    if (candidate.split(/\s+/).length <= 6) return candidate;
  }

  // Prioridad 3: primera secuencia de 2 a 6 palabras con mayúscula inicial que aparezca
  // cerca de un precio o de la palabra "oferta"/"promo", ignorando emojis y signos.
  const lines = raw.split(/\n|[!?.]\s+/).map(clean).filter(Boolean);
  for (const line of lines) {
    if (!/gs\.?\s*\d|precio|oferta|promo/i.test(line)) continue;
    const m = line.match(/((?:[A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñ®'’.]*\s*){2,6})/);
    if (m) {
      const candidate = clean(m[1]).replace(/[.,]+$/, "");
      const words = candidate.split(/\s+/);
      if (words.length >= 2 && words.length <= 6) return candidate;
    }
  }

  return "";
}

/**
 * ✅ Escanea todo el entrenamiento buscando bloques de texto que parezcan
 * plantillas/copys de venta (con precio, emojis de oferta, etc.) y que NO
 * hayan sido registrados en el bloque formal CATALOGO_PRODUCTOS. Si encuentra
 * un nombre de producto y al menos un precio válido, los da de alta como si
 * fueran productos del catálogo, con alias derivados del propio nombre.
 */
function autoDetectProductsFromTraining(training: string, existing: ProductItem[]): ProductItem[] {
  const blocks = training
    .split(/\n\n---\n\n|\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const found: ProductItem[] = [];
  const knownNames = new Set(
    existing.flatMap((p) => [p.product, p.canonical, ...p.aliases]).map(normalize)
  );

  for (const block of blocks) {
    if (block.length > 1500) continue; // evita procesar el entrenamiento entero como un solo bloque
    if (!isSafeTemplatePricingMessage(block)) continue;
    // No confundir bloques de reglas/ejemplos con productos reales.
    if (/^(regla|ejemplo|formato|instruccion|instrucción)/i.test(block)) continue;

    const name = extractProductNameFromCopy(block);
    if (!name) continue;

    const canonical = toTitleCase(name);
    const normCanonical = normalize(canonical);
    if (!normCanonical || knownNames.has(normCanonical)) continue;
    // ✅ Evitar falsos positivos: frases de marketing genéricas ("Oferta Hoy",
    // "Stock Limitado", "Envío Gratis") no son nombres de producto, aunque
    // aparezcan capitalizadas y cerca de un precio.
    if (isGenericMarketingPhrase(normCanonical)) continue;

    const { offers } = parseRawOffers(block, canonical);
    if (!offers.length) continue;

    const price1 = offers.find((o) => o.quantity === 1)?.total;
    const price2 = offers.find((o) => o.quantity === 2)?.total;
    const price3 = offers.find((o) => o.quantity === 3)?.total;
    const cheapestOffer = offers.slice().sort((a, b) => a.quantity - b.quantity)[0];

    const effectivePrice1 = price1 || cheapestOffer?.total;
    if (!effectivePrice1) continue;

    // Si NO hay precio real de 1 unidad y el único precio detectado es para
    // un pack de N>1, marcamos fixedPackQuantity para no ofrecer "1 unidad"
    // al mismo precio (eso confundía: mismo precio para 1 que para el pack).
    const fixedPackQuantity = !price1 && cheapestOffer && cheapestOffer.quantity > 1
      ? cheapestOffer.quantity
      : undefined;

    const words = normCanonical.split(" ").filter((w) => w.length >= 4 && !isGenericProductWord(w));
    const aliases = Array.from(
      new Set([canonical, ...words, ...words.map(singularizeProductWord)].filter(Boolean))
    );

    found.push({
      product: canonical,
      canonical,
      aliases,
      price1: effectivePrice1,
      price2: fixedPackQuantity ? undefined : price2,
      price3: fixedPackQuantity ? undefined : price3,
      fixedPackQuantity,
      salesCopy: block,
    });

    knownNames.add(normCanonical);
  }

  return found;
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
    const canonical = clean(block.match(/^NOMBRE_CANONICO:\s*(.+)$/im)?.[1]) || product;

    const aliasRaw = clean(block.match(/^ALIAS:\s*(.+)$/im)?.[1]);
    const aliases = aliasRaw ? aliasRaw.split(",").map(clean).filter(Boolean) : [];

    const price1 = Number(clean(block.match(/^PRECIO_1:\s*(\d+)/im)?.[1]) || 0);
    const price2 = Number(clean(block.match(/^PRECIO_2:\s*(\d+)/im)?.[1]) || 0);
    const price3 = Number(clean(block.match(/^PRECIO_3:\s*(\d+)/im)?.[1]) || 0);
    const salesCopy = clean(block.match(/^MENSAJE_VENTA:\s*([\s\S]*)$/im)?.[1]) || undefined;
    // ✅ PACK_FIJO: <cantidad> — para productos que SOLO se venden en pack
    // (ej: "2 afiladores por 99.000 Gs, no se vende por unidad"). Cuando
    // está presente, PRECIO_1 se interpreta como el TOTAL del pack, no
    // como precio de 1 unidad, y no se ofrece venta por unidad suelta.
    const packFijoRaw = Number(clean(block.match(/^PACK_FIJO:\s*(\d+)/im)?.[1]) || 0);
    const fixedPackQuantity = packFijoRaw > 1 ? packFijoRaw : undefined;

    if (product && canonical && price1 > 0) {
      products.push({
        product,
        canonical,
        aliases: Array.from(new Set([product, canonical, ...aliases])),
        price1,
        price2: fixedPackQuantity ? undefined : price2 || undefined,
        price3: fixedPackQuantity ? undefined : price3 || undefined,
        fixedPackQuantity,
        salesCopy,
      });
    }
  }

  // ✅ AUTO-DETECCIÓN DE PRODUCTOS SIN CATÁLOGO FORMAL:
  // Si en el entrenamiento pegás directamente un texto de venta (copy con emojis,
  // "X unidades por Gs. Y", etc.) sin el bloque PRODUCTO:/PRECIO_1:, el sistema
  // igual intenta reconocer el producto y su precio a partir del propio texto,
  // para no depender de que cada vendedor arme el bloque formal a mano.
  const autoProducts = autoDetectProductsFromTraining(training, products);
  products.push(...autoProducts);

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
    catalogUrl: parseCatalogUrl(training),
    bankData: parseBankData(training),
    raw: training,
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

function isGenericProductWord(word: string) {
  const w = normalize(word);
  return /^(unidad|unidades|u|und|unds|pack|combo|promo|promocion|promoción|oferta|ofertas|profesional|profesionales|producto|productos|precio|especial|gratis|delivery|envio|envío|pago|recibir|central|pais|país|solo|solamente|antes|ahora|black|friday|x\d+|\d+x\d+)$/.test(w);
}

function singularizeProductWord(word: string) {
  let w = normalize(word);
  if (w.length > 5 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("s")) w = w.slice(0, -1);
  return w;
}

function detectProduct(text: string, parsed: ParsedTraining, prev?: string) {
  const msg = normalize(text);
  const prevOk = getProductInfo(prev || "", parsed);

  if (!msg) return prevOk?.canonical || "";

  const msgWords = msg
    .split(/\s+/)
    .map(singularizeProductWord)
    .filter((w) => w.length >= 4 && !isGenericProductWord(w));

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

      // ✅ FIX V12:
      // No usar palabras genéricas como "unidades" para detectar producto.
      // Caso real: plantilla de Plumero contenía "2 Unidades", y el sistema podía
      // elegir erróneamente "Almohadillas Antivibración x4 unidades" solo por esa palabra.
      // También igualamos singular/plural: plumero/plumeros, extensible/extensibles.
      const aliasWords = a
        .split(/\s+/)
        .map(singularizeProductWord)
        .filter((w) => w.length >= 4 && !isGenericProductWord(w));

      const matched = Array.from(new Set(aliasWords)).filter((w) =>
        msgWords.some((mw) => mw === w || mw.startsWith(w) || w.startsWith(mw))
      );

      if (matched.length > 0) {
        score += matched.length * 30;
        if (aliasWords.length > 0 && matched.length >= Math.ceil(aliasWords.length * 0.5)) {
          score += 25;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }

  if (best && bestScore >= 30) return best.canonical;
  return prevOk?.canonical || "";
}

function detectCity(text: string, parsed: ParsedTraining, prev?: string) {
  const msg = normalize(text);
  if (!msg) return clean(prev || "");

  let best = "";
  let bestScore = 0;
  const msgWords = msg.split(/\s+/);

  for (const c of parsed.cities) {
    const a = normalize(c.alias);
    if (!a || a.length < 2) continue;

    let score = 0;
    if (msg === a) score += 100;
    else if (msg.includes(a)) score += 80;
    else if (a.includes(msg) && msg.length >= 3) score += 50;
    else {
      const aliasWords = a.split(/\s+/).filter((w) => w.length >= 3);
      if (aliasWords.length >= 2) {
        const matched = aliasWords.filter((w) =>
          msgWords.some((mw) => mw === w || mw.startsWith(w) || w.startsWith(mw))
        );
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

function hasCoverage(city: string, parsed: ParsedTraining) {
  const c = normalize(city);
  if (!c) return false;

  return parsed.cities.some((x) => {
    const a = normalize(x.alias);
    const cn = normalize(x.canonical);
    return c === a || c === cn || c.includes(a) || a.includes(c);
  });
}

function extractCityStatement(text: string): string {
  const raw = clean(text);
  const norm = normalize(raw);

  if (!raw || raw.length < 3 || /^[\p{Emoji}\s]+$/u.test(raw)) return "";
  if (/^\p{Emoji}/u.test(raw)) return "";

  const greetings =
    /^(hola|buenas|buenos|buen dia|buen dia|hi|hey|buenas noches|buenas tardes|saludos|ok|dale|si|no|gracias|de nada|listo|perfecto)[\s!.]*$/;
  if (greetings.test(norm)) return "";

  const match = norm.match(
    /^(?:soy de|vivo en|estoy en|ya estoy en|ya esty en|soy de la ciudad de|de la ciudad de|ciudad de|mi ciudad es|para la ciudad de)\s+(.+)$/
  );

  if (match) return clean(match[1]);
  return "";
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

  const q1 = m.match(/\b(\d+)\s*(unidad|unidades|u|und|unds|piezas|pieza)\b/);
  if (q1) return sanitizeQuantity(Number(q1[1]));

  for (const [word, num] of Object.entries(wordMap)) {
    const regex = new RegExp(`\\b${word}\\s*(unidad|unidades|u\\b|und\\b|unds\\b|piezas|pieza)`);
    if (regex.test(m)) return sanitizeQuantity(num);
  }

  const q2 = m.match(/\b(quiero|llevo|dame|mandame|reservame|solo|solamente|serian|serían|quiero llevar)\s+(\d+)\b/);
  if (q2) return sanitizeQuantity(Number(q2[2]));

  const q3 = m.match(/\b(\d+)\s+(quiero|llevo|dame|mandame|seria|sería)\b/);
  if (q3) return sanitizeQuantity(Number(q3[1]));

  for (const [word, num] of Object.entries(wordMap)) {
    const regex = new RegExp(`\\b(quiero|llevo|dame|mandame|reservame|solo|solamente|serian|serían)\\s+${word}\\b`);
    if (regex.test(m)) return sanitizeQuantity(num);
  }

  if (/^\d+$/.test(m) && m.length <= 5 && !m.startsWith("09")) {
    return sanitizeQuantity(Number(m));
  }

  for (const [word, num] of Object.entries(wordMap)) {
    if (new RegExp(`\\b${word}\\b`).test(m)) return sanitizeQuantity(num);
  }

  return 0;
}

function extractPhone(text: string) {
  const raw = clean(text);

  // ✅ FIX V21: antes se borraban TODOS los espacios del mensaje y se buscaba
  // el teléfono en el string entero. Eso hacía que un número de casa pegado
  // justo antes del teléfono (ej: "Caballero 099 0994130021") se fusionara
  // con él, dando un teléfono roto ("0990994130" en vez de "0994130021").
  // Ahora se busca palabra por palabra para no mezclar tokens numéricos
  // que estaban separados por un espacio en el mensaje original.
  const tokens = raw.split(/\s+/).filter(Boolean);

  const fullPattern = /^(?:09\d{8}|\+5959\d{8}|5959\d{8})$/;

  // 1) Un solo token que ya es un teléfono completo (el caso normal).
  for (const t of tokens) {
    const compactToken = t.replace(/[.\-]/g, "");
    if (fullPattern.test(compactToken)) return compactToken.replace(/^\+/, "");
  }

  // 2) Teléfono partido en varios tokens numéricos consecutivos
  //    (ej: "0994 130 021"), concatenando SOLO hasta completar un
  //    teléfono válido, sin seguir de largo hacia otros números sueltos.
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d+$/.test(tokens[i]) || !tokens[i].startsWith("09")) continue;
    let acc = tokens[i];
    for (let j = i + 1; j < tokens.length && acc.length < 10; j++) {
      if (!/^\d+$/.test(tokens[j])) break;
      if (acc.length + tokens[j].length > 11) break;
      acc += tokens[j];
    }
    if (/^09\d{8,9}$/.test(acc)) return acc;
  }

  return "";
}

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractName(text: string, detectedCity: string, phone: string, parsed?: ParsedTraining) {
  const raw = clean(text);
  if (!raw) return "";
  if (extractQuantity(raw) > 0) return "";

  const isMultiLine = raw.includes("\n");
  const lines = raw.split("\n").filter((l) => clean(l).length > 0);

  // ✅ FIX V4:
  // Antes se rechazaba TODO el mensaje si contenía una ciudad.
  // Ejemplo real:
  // "Alexis Ortega\nCapiata, barrio san juan\n0988765433"
  // Como contenía "Capiata", extractName devolvía vacío y el bot volvía a pedir nombre.
  // Ahora solo rechazamos como nombre cuando el mensaje completo es una ciudad simple,
  // no cuando viene un bloque multilinea con nombre + dirección + teléfono.
  if (parsed && !isMultiLine && !extractPhone(raw)) {
    const normRaw = normalize(raw);
    const isOnlyCity = parsed.cities.some((c) => {
      const a = normalize(c.alias);
      const cn = normalize(c.canonical);
      return a && (normRaw === a || normRaw === cn);
    });
    if (isOnlyCity) return "";
  }

  const forbidden = [
    "quiero", "comprar", "me interesa", "precio", "delivery",
    "envio", "ok", "dale", "si", "hola", "buenas", "gracias",
    "cuanto", "cuando", "dia", "llega", "llego", "pedido",
    "cancelar", "no", "nebulizador", "raqueta", "que",
    "estado", "seguimiento", "ya", "fue", "como", "donde",
    "unidad", "unidades", "und", "unds", "una unidad", "dos unidades",
    "una", "uno", "dos", "tres", "cuatro", "cinco",
    "traen", "trae", "traes", "mandan", "manda", "mandas",
    "cdo", "xq", "xfa", "xfavor", "porfavor", "porfa",
    "me", "te", "se", "lo", "la", "les", "nos",
    "para", "con", "por", "del", "mas",
  ];

  const questionVerbs =
    /\b(traen|trae|mandan|llegan|llega|entrega|viene|vienen|cuesta|cobran|demora|tarda)\b/;

  const isValidNameLine = (line: string): boolean => {
    const cleaned = clean(line);
    const normLine = normalize(cleaned);
    const words = cleaned.split(/\s+/).filter(Boolean);

    if (words.length < 2 || words.length > 5) return false;
    if (/\d/.test(cleaned)) return false;
    if (!/^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(cleaned)) return false;
    if (cleaned.length < 4 || cleaned.length > 60) return false;
    if (/\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|esquina|casi|san pedro|santa|bario)\b/i.test(normLine)) return false;
    if (questionVerbs.test(normLine)) return false;
    if (detectedCity && normalize(cleaned) === normalize(detectedCity)) return false;
    if (forbidden.some((f) => normLine === normalize(f) || normLine.startsWith(normalize(f) + " ") || normLine.endsWith(" " + normalize(f)))) return false;
    if (words[0].length === 1) return false;
    if (/^(y |ese |esta |este |eso |esa |aqui |ahi |ya |igual |listo |ok |dale )/i.test(normLine)) return false;
    if (/\b(este es|ese es|eso es|este soy|soy yo|ese soy)\b/.test(normLine)) return false;
    return true;
  };

  const explicit = raw.match(/(?:soy|me llamo|mi nombre es|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,80})/i)?.[1];
  if (explicit) return toTitleCase(clean(explicit));

  const beforeSoy = raw.match(/^([a-zA-ZÁÉÍÓÚáéíóúÑñ]+(?:\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ]+){1,4})\s+soy\b/i)?.[1];
  if (beforeSoy && isValidNameLine(beforeSoy)) return toTitleCase(clean(beforeSoy));

  if (isMultiLine) {
    for (const line of lines) {
      const cleaned = clean(line);
      if (/\d{7,}/.test(cleaned)) continue;
      if (/\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|esquina|casi|rca|colombia|republica|nro|manzana)\b/i.test(normalize(cleaned))) continue;
      if (isValidNameLine(cleaned)) return toTitleCase(cleaned);
    }
    return "";
  }

  if (isValidNameLine(raw)) return toTitleCase(raw);

  // ✅ FIX V20: cliente manda nombre + dirección + teléfono TODO en una sola línea,
  // sin saltos (ej: "Pamela Galeano Caballero 1050 0994130021").
  // Antes esto devolvía "" porque isValidNameLine rechaza cualquier línea con dígitos,
  // y la rama multilínea (que sí sabe separar) nunca se activaba porque no hay "\n".
  // Ahora: tomamos las primeras palabras alfabéticas (antes del primer token con dígitos)
  // y probamos si las primeras 2 forman un nombre válido (nombre y apellido).
  if (!isMultiLine) {
    const tokens = raw.split(/\s+/).filter(Boolean);
    const leadingWords: string[] = [];
    for (const t of tokens) {
      if (/\d/.test(t)) break;
      leadingWords.push(t);
    }
    if (leadingWords.length >= 2) {
      const candidate = leadingWords.slice(0, 2).join(" ");
      if (isValidNameLine(candidate)) return toTitleCase(candidate);
    }
  }

  return "";
}

function extractAddress(text: string, detectedCity: string, phone: string, name: string) {
  const raw = clean(text);
  if (/^\d+\s*(unidad|unidades|u|und|unds)?$/i.test(raw)) return "";
  if (/^\d+$/.test(raw)) return "";

  const lines = raw.split("\n").filter((l) => clean(l).length > 0);

  const explicit = raw.match(/(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i)?.[1];
  if (explicit) return clean(explicit);

  if (raw.includes("maps.app") || raw.includes("google.com/maps")) return raw;

  for (const line of lines) {
    const cleaned = clean(line);
    const normLine = normalize(cleaned);

    if (/\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote)\b/i.test(normLine)) {
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

    const wordsToRemove = ["soy", "me llamo", "mi nombre es", "nombre", "teléfono", "celular", "cel", "mi", "es"];
    for (const word of wordsToRemove) {
      remaining = remaining.replace(new RegExp(`\\b${word}\\b`, "gi"), "").trim();
    }

    if (remaining.length >= 5) return remaining;
  }

  return "";
}

function sanitizeOldOrder(old: any, parsed: ParsedTraining): OrderData {
  const productInfo = getProductInfo(old?.product || "", parsed);
  const nameNorm = normalize(old?.customer_name || "");

  const forbiddenNames = [
    "quiero", "cuando", "dia", "llega", "llego", "pedido", "cancelar",
    "no", "raqueta", "nebulizador", "que", "estado", "seguimiento",
    "ya fue", "que dia llega mi pedido", "no raqueta",
  ];

  const isInvalidName =
    forbiddenNames.some((f) => nameNorm.includes(normalize(f))) ||
    nameNorm.split(" ").length > 5;

  return {
    order_id: clean(old?.order_id || ""),
    product: productInfo?.canonical || "",
    quantity: sanitizeQuantity(old?.quantity || 0),
    city: clean(old?.city || ""),
    customer_name:
      old?.customer_name && nameNorm !== "quiero" && !isInvalidName
        ? clean(old.customer_name)
        : "",
    phone: clean(old?.phone || ""),
    address: clean(old?.address || ""),
    locked_offer: old?.locked_offer || null,
    payment_proof_received: !!old?.payment_proof_received,
  } as OrderData;
}

function mergeOrderData(old: OrderData, ext: any, product: string): OrderData {
  return {
    order_id: ext.order_id || old.order_id || "",
    product: product || old.product || "",
    quantity: ext.quantity > 0 ? sanitizeQuantity(ext.quantity) : sanitizeQuantity(old.quantity || 0),
    city: ext.city || old.city || "",
    customer_name: ext.name || old.customer_name || "",
    phone: ext.phone || old.phone || "",
    address: ext.address || old.address || "",
    locked_offer: ext.locked_offer !== undefined ? ext.locked_offer : old.locked_offer || null,
    payment_proof_received: ext.payment_proof_received !== undefined ? !!ext.payment_proof_received : !!old.payment_proof_received,
  };
}

function calculateTotal(productName: string, quantity: number, parsed: ParsedTraining, lockedOffer?: OfferItem | null) {
  const p = getProductInfo(productName, parsed);
  if (!p) return 0;

  const q = sanitizeQuantity(quantity);

  if (
    lockedOffer &&
    normalize(lockedOffer.product) === normalize(p.canonical) &&
    sanitizeQuantity(lockedOffer.quantity) === q &&
    lockedOffer.total > 0
  ) {
    return lockedOffer.total;
  }

  if (q === 2 && p.price2) return p.price2;
  if (q === 3 && p.price3) return p.price3;

  return p.price1 * q;
}

function getCatalogOffer(product: ProductItem, quantity: number): OfferItem | null {
  const q = sanitizeQuantity(quantity);
  if (q === 2 && product.price2) {
    return { product: product.canonical, quantity: 2, total: product.price2, source: "catalog" };
  }
  if (q === 3 && product.price3) {
    return { product: product.canonical, quantity: 3, total: product.price3, source: "catalog" };
  }
  return null;
}

/**
 * ✅ Devuelve la oferta de pack fijo detectada automáticamente desde un copy
 * de venta libre en el entrenamiento (sin catálogo formal), cuando el único
 * precio real es para N>1 unidades. Aplica sin importar la cantidad pedida,
 * igual que un pack fijo de plantilla.
 */
function getCatalogFixedPackOffer(product: ProductItem | null): OfferItem | null {
  if (!product?.fixedPackQuantity || !product.price1) return null;
  return {
    product: product.canonical,
    quantity: product.fixedPackQuantity,
    total: product.price1,
    label: `${product.fixedPackQuantity} unidades por ${formatGs(product.price1)} Gs`,
    source: "catalog",
    fixed_quantity: true,
  };
}

function detectOfferFromText(text: string, parsed: ParsedTraining): OfferItem | null {
  const raw = clean(text);
  const m = normalize(raw);
  if (!m) return null;

  const product = detectProduct(raw, parsed, "");
  if (!product) return null;

  const qtyByWord: Record<string, number> = {
    uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  };

  let quantity = 0;
  const qNum =
    m.match(/\b(\d+)\s*(?:x|por|unidades|unidad|u|und|unds|piezas|pieza)\b/) ||
    m.match(/\b(\d+)\s*(?:afiladores|productos|items|ítems)\b/);

  if (qNum) quantity = sanitizeQuantity(Number(qNum[1]));

  if (!quantity) {
    for (const [word, num] of Object.entries(qtyByWord)) {
      if (new RegExp(`\\b${word}\\b`).test(m)) {
        quantity = num;
        break;
      }
    }
  }

  const priceMatch =
    raw.match(/(?:por|a solo|solo|promo|oferta)[^\d]*(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)?/i) ||
    raw.match(/(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)/i);

  const total = priceMatch ? parseNumberGs(priceMatch[1]) : 0;

  if (product && quantity > 0 && total > 0) {
    return { product, quantity, total, label: `${quantity} por ${formatGs(total)} Gs`, source: "template" };
  }

  return null;
}


function looksLikeCustomerDataOrAddress(text: string) {
  const n = normalize(text);
  // ✅ FIX V19: "casa", "frente", "lado" y "bo" son palabras demasiado genéricas
  // que aparecen en textos de venta normales (ej. "pagás al recibir en tu casa"),
  // lo que hacía que isSafeTemplatePricingMessage descartara plantillas reales
  // por error y el bot terminara usando el precio de un producto viejo/cerrado.
  return /\b(calle|avda|avenida|ruta|km|barrio|esquina|casi|numero|nro|manzana|mz|lote|direccion|dirección|ubicacion|ubicación|telefono|teléfono|celular)\b/.test(n);
}

function isSafeTemplatePricingMessage(text: string) {
  const raw = clean(text);
  const n = normalize(raw);

  if (!raw) return false;
  if (looksLikeCustomerDataOrAddress(raw)) return false;

  return (
    /\b(oferta|ofertas|promo|promocion|promoción|precio promocional|precio|antes|solo hoy|stock limitado|ultimas unidades|últimas unidades|pack|combo|no se vende por unidad|unicamente|únicamente|solo pack)\b/.test(n) ||
    raw.includes("🔥") ||
    raw.includes("💰") ||
    raw.includes("→")
  );
}

function isFixedPackText(text: string) {
  const raw = clean(text);
  const n = normalize(raw);

  const explicitFixed =
    /\b(no se vende por unidad|no vendemos por unidad|solo pack|solo por pack|pack fijo|combo fijo|unicamente por el pack|únicamente por el pack|promocion valida unicamente|promoción válida únicamente|valida unicamente por el pack|válida únicamente por el pack)\b/.test(n);

  // Si la plantilla viene estructurada con Producto + Cantidad + Precio,
  // se interpreta como oferta/cantidad fija, no como promo seleccionable.
  const structuredFixed =
    /producto\s*:/i.test(raw) &&
    /cantidad\s*:\s*\d+/i.test(raw) &&
    /precio\s*:\s*(?:gs\.?\s*)?\d/i.test(raw);

  return explicitFixed || structuredFixed;
}

function parseRawOffers(raw: string, product: string): { offers: OfferItem[]; fixedQuantity: boolean } {
  const fixedQuantity = isFixedPackText(raw);
  const offers: OfferItem[] = [];

  const addOffer = (quantity: number, total: number, fixed = false) => {
    const q = sanitizeQuantity(quantity);
    const t = Number(total || 0);

    // Genérico: evita interpretar direcciones/teléfonos como precio.
    // Ningún precio válido de producto debe quedar como 1.542 Gs.
    if (!q || !t || t < 10000 || t > 10000000) return;

    offers.push({
      product,
      quantity: q,
      total: t,
      label: `${q} unidad${q > 1 ? "es" : ""} por ${formatGs(t)} Gs`,
      source: "template",
      fixed_quantity: fixed,
    });
  };

  // Formato recomendado multi-vendedor:
  // Producto: X
  // Cantidad: 2 unidades
  // Precio: Gs. 99.000
  const structuredQty = raw.match(/cantidad\s*:\s*(\d+)\s*(?:unidad|unidades|u|und|unds|piezas|pieza)?/i);
  const structuredPrice = raw.match(/precio\s*:\s*(?:gs\.?\s*)?(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)?/i);

  if (structuredQty && structuredPrice) {
    addOffer(Number(structuredQty[1]), parseNumberGs(structuredPrice[1]), true);
  }

  // Casos genéricos:
  // "2 Afiladores ... por solo Gs. 99.000"
  // "Pack de 2 afiladores = Gs. 99.000"
  // "Combo 3 unidades por 149.900"
  // "2 unidades → 129.900 Gs"
  const explicitPackPatterns = [
    /\b(?:pack|combo)\s*(?:de)?\s*(\d+)[^\n\r]{0,100}?(?:=|por|a|solo|solamente|→|->)\s*(?:gs\.?\s*)?(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)?/gi,
    /\b(\d+)\s*(?:unidades|unidad|u|und|unds|piezas|pieza|productos)?[^\n\r]{0,100}?(?:por|a|solo|solamente|=|→|->)\s*(?:gs\.?\s*)?(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)?/gi,
    /(?:^|\n|\*)\s*(\d+)\s*(?:unidad|unidades|u|und|unds)?\s*(?:→|->|-|:|=|por|x|a)?\s*(?:gs\.?\s*)?(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)?/gi,
  ];

  for (const pattern of explicitPackPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
      const quantity = Number(match[1]);
      const total = parseNumberGs(match[2]);
      addOffer(quantity, total, fixedQuantity || quantity > 1 && isFixedPackText(raw));
    }
  }

  // Precio simple:
  // "Precio Promocional: Gs. 149.900"
  // "Oferta HOY: 169.900 Gs"
  // Solo se toma como 1 unidad si NO dice pack fijo.
  const singlePricePatterns = [
    /precio\s*promocional\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)?/i,
    /oferta\s*(?:hoy)?\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)?/i,
    /(?:precio|valor|sale|cuesta)\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)?/i,
  ];

  if (!fixedQuantity) {
    for (const pattern of singlePricePatterns) {
      const m = raw.match(pattern);
      if (m) {
        addOffer(1, parseNumberGs(m[1]), false);
        break;
      }
    }
  }

  // Si hay texto de pack fijo y solo se detectó precio simple o el pack aparece textual,
  // intenta tomar cantidad desde "pack de X", "X unidades", etc. y el precio más claro del mensaje.
  if (fixedQuantity && !offers.some((o) => o.fixed_quantity)) {
    const qMatch =
      raw.match(/\b(?:pack|combo)\s*(?:de)?\s*(\d+)\b/i) ||
      raw.match(/\b(\d+)\s*(?:unidades|unidad|u|und|unds|piezas|pieza)\b/i);

    const pMatch =
      raw.match(/(?:gs\.?\s*)?(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)?/i);

    if (qMatch && pMatch) {
      addOffer(Number(qMatch[1]), parseNumberGs(pMatch[1]), true);
    }
  }

  return { offers, fixedQuantity };
}

function detectTemplatePricingFromText(text: string, parsed: ParsedTraining): TemplatePricing | null {
  const raw = clean(text);
  if (!isSafeTemplatePricingMessage(raw)) return null;

  const product = detectProduct(raw, parsed, "");
  if (!product) return null;

  const { offers, fixedQuantity } = parseRawOffers(raw, product);

  const unique = new Map<number, OfferItem>();
  for (const offer of offers) {
    const previous = unique.get(offer.quantity);
    if (!previous || offer.fixed_quantity || offer.source === "template") {
      unique.set(offer.quantity, offer);
    }
  }

  const uniqueOffers = Array.from(unique.values()).sort((a, b) => a.quantity - b.quantity);
  if (!uniqueOffers.length) return null;

  /**
   * ✅ CORRECCIÓN V3:
   * Si la plantilla trae UNA SOLA oferta y esa oferta ya dice cantidad + total
   * (ej: "2 Unidades de Plumeros Extensibles por solo Gs. 99.000"),
   * el sistema debe respetar esa promo como cantidad cerrada de la plantilla.
   *
   * Antes se trataba como promo opcional:
   *   "¿Querés 1 o la promo de 2?"
   * y si el cliente respondía "2", podía terminar calculando 99.000 x 2 = 198.000.
   *
   * Ahora:
   * - No pregunta 1 o 2.
   * - Bloquea cantidad 2.
   * - Bloquea total 99.000.
   * - Pide directamente ciudad/datos según corresponda.
   *
   * Importante: solo se marca fijo cuando la única oferta de plantilla es mayor a 1.
   * Una plantilla de "1 unidad → 149.900" sigue siendo venta normal de 1 unidad.
   */
  const singleTemplatePackPromo =
    uniqueOffers.length === 1 &&
    uniqueOffers[0].quantity > 1 &&
    uniqueOffers[0].source === "template";

  const hasFixed = uniqueOffers.some((o) => o.fixed_quantity) || fixedQuantity || singleTemplatePackPromo;

  return {
    product,
    // Si es pack fijo de 2/3/etc, NO guardamos price1 porque no existe venta por unidad en esta plantilla.
    price1: hasFixed ? undefined : uniqueOffers.find((o) => o.quantity === 1)?.total,
    offers: uniqueOffers.map((o) => ({ ...o, fixed_quantity: hasFixed ? true : o.fixed_quantity })),
    raw,
    fixed_quantity: hasFixed,
  };
}

/**
 * ✅ FIX V5:
 * Fallback para plantillas pegadas por el cliente después de un pedido confirmado.
 * A veces el texto llega sin emojis o con el botón/interactive concatenado:
 *
 * Producto: Afilador de Cuchillos
 * Cantidad: 2 unidades
 * Precio: Gs. 99.000
 * Quiero
 *
 * En esos casos igual debe detectarse como NUEVA plantilla y no como postventa/cierre.
 */
function isStructuredSalesTemplateMessage(text: string) {
  const raw = clean(text);
  if (!raw) return false;

  return (
    /producto\s*:/i.test(raw) &&
    /cantidad\s*:\s*\d+/i.test(raw) &&
    /precio\s*:\s*(?:gs\.?\s*)?\d/i.test(raw)
  );
}

function hasTemplateBuyIntent(text: string) {
  const n = normalize(text);
  return /\b(quiero|confirmar|quiero confirmar|me interesa|comprar|compro|reservar|reservame|agendar|agendame|lo quiero)\b/.test(n);
}

function detectStructuredTemplatePricingFallback(text: string, parsed: ParsedTraining): TemplatePricing | null {
  const raw = clean(text);
  if (!isStructuredSalesTemplateMessage(raw)) return null;

  const productLine = clean(raw.match(/producto\s*:\s*(.+)$/im)?.[1]);
  const qtyLine = raw.match(/cantidad\s*:\s*(\d+)\s*(?:unidad|unidades|u|und|unds|piezas|pieza)?/i);
  const priceLine = raw.match(/precio\s*:\s*(?:gs\.?\s*)?(\d[\d.\s]{3,})\s*(?:gs|guaran[ií]es)?/i);

  const product = detectProduct(productLine || raw, parsed, "");
  const quantity = qtyLine ? sanitizeQuantity(Number(qtyLine[1])) : 0;
  const total = priceLine ? parseNumberGs(priceLine[1]) : 0;

  if (!product || !quantity || !total || total < 10000 || total > 10000000) return null;

  const offer: OfferItem = {
    product,
    quantity,
    total,
    label: `${quantity} unidad${quantity > 1 ? "es" : ""} por ${formatGs(total)} Gs`,
    source: "template",
    fixed_quantity: true,
  };

  return {
    product,
    price1: quantity === 1 ? total : undefined,
    offers: [offer],
    raw,
    fixed_quantity: true,
  };
}

function detectTemplatePricingSmart(text: string, parsed: ParsedTraining): TemplatePricing | null {
  return detectTemplatePricingFromText(text, parsed) || detectStructuredTemplatePricingFallback(text, parsed);
}

function isNewPastedTemplatePurchase(text: string, parsed: ParsedTraining) {
  const raw = clean(text);
  if (!raw) return false;

  const pricing = detectTemplatePricingSmart(raw, parsed);
  if (pricing) return true;

  return (
    hasTemplateBuyIntent(raw) &&
    (isStructuredSalesTemplateMessage(raw) || isSafeTemplatePricingMessage(raw)) &&
    /(?:gs\.?|guaran[ií]es|\d[\d.\s]{3,})/i.test(raw)
  );
}

function getTemplatePricingFromHistory(history: any[], parsed: ParsedTraining): TemplatePricing | null {
  /**
   * ✅ FIX V8:
   * La última plantilla real del historial debe ganar sobre cualquier producto viejo guardado.
   * Además, algunas integraciones no guardan el texto en content; pueden usar message, text o body.
   * Por eso revisamos esos campos y no dependemos del role.
   */
  const recentMessages = (history || []).slice(-30).reverse();

  for (const item of recentMessages) {
    const content = clean(item?.content || item?.message || item?.text || item?.body || "");
    if (!content) continue;
    if (isConfirmedOrderMessage(content)) continue;

    const looksLikeTemplate =
      isStructuredSalesTemplateMessage(content) ||
      isRealSalesTemplateMessage(content) ||
      isSafeTemplatePricingMessage(content);

    if (!looksLikeTemplate) continue;

    const pricing = detectTemplatePricingSmart(content, parsed);
    if (pricing) return pricing;
  }

  return null;
}
function getTemplateOfferForQuantity(templatePricing: TemplatePricing | null, product: string, quantity: number): OfferItem | null {
  if (!templatePricing || !product || normalize(templatePricing.product) !== normalize(product)) return null;
  const q = sanitizeQuantity(quantity);
  return templatePricing.offers.find((o) => o.quantity === q) || null;
}

function getTemplatePrice1(templatePricing: TemplatePricing | null, product: string) {
  if (!templatePricing || !product || normalize(templatePricing.product) !== normalize(product)) return 0;
  return templatePricing.price1 || templatePricing.offers.find((o) => o.quantity === 1)?.total || 0;
}


function getFixedTemplateOffer(templatePricing: TemplatePricing | null, product: string): OfferItem | null {
  if (!templatePricing || !product || normalize(templatePricing.product) !== normalize(product)) return null;
  if (!templatePricing.fixed_quantity) return null;

  const fixed =
    templatePricing.offers.find((o) => o.fixed_quantity) ||
    templatePricing.offers.sort((a, b) => b.quantity - a.quantity)[0];

  return fixed || null;
}

function getProductFromLastPromotion(history: any[], parsed: ParsedTraining) {
  /**
   * ✅ FIX V7:
   * Primero intentar tomar el producto desde la plantilla/precio detectado.
   * Esto evita que un producto viejo del contexto/historial, por ejemplo
   * "Almohadillas Antivibración", gane cuando la plantilla nueva dice
   * "Producto: Afilador de Cuchillos".
   */
  const templatePricing = getTemplatePricingFromHistory(history, parsed);
  const templateProduct = getProductInfo(templatePricing?.product || "", parsed);
  if (templateProduct) return templateProduct;

  const recentMessages = (history || [])
    .slice(-20)
    .reverse()
    .filter((h: any) => clean(h?.content));

  for (const item of recentMessages) {
    const content = clean(item?.content);
    if (!isRealSalesTemplateMessage(content) && !isPromotionLikeMessage(content) && !isSafeTemplatePricingMessage(content)) continue;

    const contentNorm = normalize(content);
    if (!contentNorm) continue;

    const sortedProducts = [...parsed.products].sort(
      (a, b) => normalize(b.canonical).length - normalize(a.canonical).length
    );

    for (const product of sortedProducts) {
      const names = [product.canonical, product.product, ...product.aliases]
        .map(normalize)
        .filter((x) => x.length >= 4)
        .sort((a, b) => b.length - a.length);

      if (names.some((n) => contentNorm.includes(n))) return product;
    }
  }

  return null;
}
function getOfferFromLastPromotion(history: any[], parsed: ParsedTraining): OfferItem | null {
  const templatePricing = getTemplatePricingFromHistory(history, parsed);
  if (!templatePricing) return null;

  const fixed = getFixedTemplateOffer(templatePricing, templatePricing.product);
  if (fixed) return fixed;

  return templatePricing.offers
    .filter((o) => o.quantity > 1)
    .sort((a, b) => b.quantity - a.quantity)[0] || templatePricing.offers[0] || null;
}
function isPromotionLikeMessage(text: string) {
  const c = clean(text);
  const n = normalize(c);
  return (
    c.includes("🔥") ||
    c.includes("🚨") ||
    c.includes("👉") ||
    /\b(oferta|ofertas|promo|promocion|promoción|ultimas unidades|últimas unidades|garantia|garantía|solo hoy|escribi quiero|escribí quiero|unidades)\b/.test(n)
  );
}



function isConfirmedOrderMessage(text: string) {
  const n = normalize(text);
  return /\b(pedido confirmado|tu pedido ya quedo confirmado|tu pedido ya quedó confirmado|pedido ya quedo confirmado|pedido ya quedó confirmado|gracias por tu compra|queda agendado|quedo agendado|quedó agendado)\b/.test(n);
}

function isRealSalesTemplateMessage(text: string) {
  const c = clean(text);
  const n = normalize(c);
  if (!c) return false;
  if (isConfirmedOrderMessage(c)) return false;
  if (/\b(factura legal|ruc|razon social|razón social|cedula|cédula|proxima ronda de envios|próxima ronda de envíos|delivery te confirma)\b/.test(n)) return false;

  const hasSalesCue =
    c.includes("👉") ||
    c.includes("🔥") ||
    c.includes("💰") ||
    /\b(stock limitado|precio promocional|promocion especial|promoción especial|antes|ahora|escribi quiero|escribí quiero|te lo reservamos|envio gratis|envío gratis|pago al recibir)\b/.test(n);

  const hasPrice = /(?:gs\.?|guaran[ií]es|\d[\d.\s]{3,})/i.test(c);
  return hasSalesCue && hasPrice;
}

function getLastRealSalesTemplatePricing(history: any[], parsed: ParsedTraining): TemplatePricing | null {
  // ✅ FIX V8:
  // Buscar la última plantilla real sin depender del role del historial.
  // Esto permite: pedido confirmado -> factura/postventa -> nueva plantilla -> "Quiero confirmar".
  const recentMessages = (history || []).slice(-30).reverse();

  for (const item of recentMessages) {
    const content = clean(item?.content || item?.message || item?.text || item?.body || "");
    if (!content) continue;
    if (isConfirmedOrderMessage(content)) continue;
    if (!isRealSalesTemplateMessage(content) && !isSafeTemplatePricingMessage(content) && !isStructuredSalesTemplateMessage(content)) continue;

    const pricing = detectTemplatePricingSmart(content, parsed);
    if (pricing) return pricing;
  }

  return null;
}

function getLastRealSalesTemplateProduct(history: any[], parsed: ParsedTraining) {
  const pricing = getLastRealSalesTemplatePricing(history, parsed);
  if (pricing?.product) {
    const productInfo = getProductInfo(pricing.product, parsed);
    if (productInfo) return productInfo;
  }

  const recentMessages = (history || []).slice(-30).reverse();

  for (const item of recentMessages) {
    const content = clean(item?.content || item?.message || item?.text || item?.body || "");
    if (!content) continue;
    if (!isRealSalesTemplateMessage(content)) continue;

    const product = detectProduct(content, parsed, "");
    const productInfo = getProductInfo(product, parsed);
    if (productInfo) return productInfo;
  }

  return null;
}


function historyText(item: any) {
  return clean(item?.content || item?.message || item?.text || item?.body || "");
}

function extractExplicitProductInterest(text: string, parsed: ParsedTraining) {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw) return "";
  if (isConfirmedOrderMessage(raw)) return "";
  if (isGenericBuyReply(raw) || isStrongNewPurchaseReply(raw)) return "";

  const hasInterestWords =
    /\b(me interesa|quiero|precio|cuanto|cuánto|tenes|tenés|tienen|hay|consulta|info|informacion|información|comprar|compro|reservar|agendar)\b/.test(n);

  if (!hasInterestWords) return "";

  const product = detectProduct(raw, parsed, "");
  const productInfo = getProductInfo(product, parsed);
  return productInfo?.canonical || "";
}

function getRecentExplicitProductInterestAfterConfirmed(history: any[], parsed: ParsedTraining): { product: ProductItem; index: number } | null {
  const items = history || [];

  for (let i = items.length - 1; i >= 0; i--) {
    const content = historyText(items[i]);
    if (!content) continue;

    const product = extractExplicitProductInterest(content, parsed);
    const productInfo = getProductInfo(product, parsed);
    if (productInfo) return { product: productInfo, index: i };

    // No usar intereses viejos anteriores al último pedido confirmado.
    if (isConfirmedOrderMessage(content)) break;
  }

  return null;
}

function getTemplatePricingAfterHistoryIndex(history: any[], parsed: ParsedTraining, startIndex: number): TemplatePricing | null {
  const items = history || [];

  for (let i = items.length - 1; i > startIndex; i--) {
    const content = historyText(items[i]);
    if (!content) continue;
    if (isConfirmedOrderMessage(content)) continue;
    if (!isRealSalesTemplateMessage(content) && !isSafeTemplatePricingMessage(content) && !isStructuredSalesTemplateMessage(content)) continue;

    const pricing = detectTemplatePricingSmart(content, parsed);
    if (pricing) return pricing;
  }

  return null;
}

function forceTemplatePricingProduct(templatePricing: TemplatePricing | null, product: ProductItem | string | null): TemplatePricing | null {
  if (!templatePricing || !product) return templatePricing;

  const productName = typeof product === "string" ? product : product.canonical;
  if (!productName) return templatePricing;

  return {
    ...templatePricing,
    product: productName,
    offers: (templatePricing.offers || []).map((o) => ({
      ...o,
      product: productName,
    })),
  };
}

function isStrongNewPurchaseReply(text: string) {
  const n = normalize(text);
  // Después de un pedido confirmado, solo estas respuestas reabren venta desde la última plantilla real.
  // No incluye "ok", "listo" ni "gracias" porque normalmente cierran la conversación.
  return /^(quiero|lo quiero|quiero ese|quiero eso|quiero confirmar|confirmar|si quiero|sí quiero|comprar|compro|quiero comprar|quiero llevar|llevo|reservar|reservame|agendar|agendame|confirmo)$/.test(n);
}

function isShortAcknowledgement(text: string) {
  const n = normalize(text);
  return /^(ok|okay|dale|listo|gracias|muchas gracias|perfecto|bueno|👍|👌|🙏|genial|excelente|joya)$/.test(n);
}

/**
 * Detecta cuando el cliente ya cerró la conversación después de un pedido confirmado.
 * Esto evita que el bot insista con preguntas tipo:
 * “¿Querés consultar algo sobre entrega, pago o factura?”
 */
function isConversationClosing(text: string) {
  const n = normalize(text);
  if (!n) return false;

  return /^(nada mas|nada más|nada|solo eso|solo eso gracias|eso es todo|eso seria|eso sería|eso nomas|eso nomás|no gracias|no nada mas|no nada más|ninguna consulta|ninguna duda|sin consulta|sin dudas|todo bien|ya esta|ya está|gracias nada mas|gracias nada más|gracias eso es todo|ok gracias|dale gracias|listo gracias|perfecto gracias)$/.test(n);
}

function isPostSaleQuestion(text: string) {
  const n = normalize(text);

  return (
    /\?/.test(text) ||
    /\b(factura|boleta|comprobante|recibo|ruc|razon social|razón social|cedula|cédula|ci|datos fiscales|cuando|cuándo|llega|llego|llegaria|llegaría|entrega|delivery|envio|envío|demora|tarda|horario|hora|garantia|garantía|cambio|cambiar|direccion|dirección|telefono|teléfono|pagar|pago|efectivo|transferencia|delivery|seguimiento|estado|cancelar|anular)\b/.test(n)
  );
}

/**
 * ✅ FIX V4 postventa determinística:
 * Algunas consultas después de pedido_confirmado no deben quedar a criterio de Gemini,
 * porque podía responder con estado de entrega aunque el cliente pidiera factura.
 */
function deterministicPostSaleResponse(text: string, order: OrderData, parsed: ParsedTraining) {
  const n = normalize(text);

  const hasFiscalData =
    /\b(ruc|razon social|razón social|cedula|cédula|ci)\b/.test(n) && /\d{5,}/.test(text);

  if (hasFiscalData) {
    return `✅ Perfecto, recibimos tus datos para la factura legal 😊\n📎 Los dejamos anotados para emitirla con tu pedido.`;
  }

  if (/\b(factura|boleta|ruc|razon social|razón social|cedula|cédula)\b/.test(n)) {
    return `✅ Sí, contamos con FACTURA LEGAL 😊\n📎 Pasame tu RUC y Razón Social, o tu número de Cédula, y te la emitimos sin problema.`;
  }

  if (/\b(cuando|cuándo|llega|llego|llegaria|llegaría|entrega|delivery|envio|envío|demora|tarda|horario|hora|seguimiento|estado)\b/.test(n)) {
    const product = order.product ? ` de ${order.product}` : "";
    return `🚚 Tu pedido${product} ya quedó confirmado y agendado para la próxima ronda de envíos. El delivery te confirma cuando llegue a tu zona. 😊`;
  }

  if (/\b(pagar|pago|efectivo|transferencia|forma de pago|metodo de pago|método de pago)\b/.test(n)) {
    if (hasCoverage(order.city || "", parsed)) {
      return `💵 Podés pagar en EFECTIVO o por TRANSFERENCIA AL DELIVERY cuando recibas tu producto. Como te quede más cómodo 😊🚚`;
    }

    return `💵 Para tu zona el pago es anticipado por transferencia. Te paso los datos:\n\n${bankDataText(parsed)}`;
  }

  if (/\b(cambiar|cambio|direccion|dirección|ubicacion|ubicación|telefono|teléfono|celular|numero|número)\b/.test(n)) {
    return `✅ Sin problema 😊 Pasame el dato nuevo que querés actualizar: dirección exacta/ubicación o número de celular.`;
  }

  if (/\b(cancelar|anular|cancela|cancele|ya no quiero)\b/.test(n)) {
    return `Entiendo. Para cancelar el pedido, confirmame por favor escribiendo: CANCELAR PEDIDO.`;
  }

  if (/\b(garantia|garantía|cambio|devolucion|devolución|defecto|fallado|falla)\b/.test(n)) {
    return `✅ Contamos con atención postventa 😊 Si el producto llega con algún inconveniente, escribinos con foto/video del producto y revisamos el caso.`;
  }

  return "";
}

function buildPostSaleSystemPrompt(parsed: ParsedTraining, order: OrderData) {
  return `
Sos vendedor/postventa de Mega Todo Store / One Store por WhatsApp.
El pedido del cliente YA ESTÁ CONFIRMADO. No vuelvas a confirmar el pedido salvo que te lo pida.

DATOS DEL PEDIDO CONFIRMADO:
- Producto: ${order.product || "no disponible"}
- Cantidad: ${order.quantity || "no disponible"}
- Ciudad: ${order.city || "no disponible"}
- Dirección: ${order.address || "no disponible"}
- Cliente: ${order.customer_name || "no disponible"}
- Teléfono: ${order.phone || "no disponible"}

REGLAS:
- Respondé preguntas postventa de forma útil y amable.
- Si pregunta por factura, respondé según entrenamiento. Si no hay dato específico, decí que podés consultar/solicitar factura con los datos fiscales.
- Si pregunta cuándo llega, indicá que el pedido quedó agendado para la próxima ronda de envíos y que el delivery confirma al llegar a su zona. No inventes horarios exactos.
- Si pregunta por pago, recordá que puede pagar en efectivo o transferencia al delivery si tiene contra-entrega.
- Si quiere cambiar dirección o teléfono, pedile el dato nuevo.
- Si quiere cancelar, pedí confirmación clara.
- No crees un pedido nuevo.
- No repitas el bloque de ✅ PEDIDO CONFIRMADO.
- Sé breve, cálido y con emojis moderados.

ENTRENAMIENTO:
${parsed.raw}
`.trim();
}

function isNewTemplateOrProductIntent(text: string, parsed: ParsedTraining, history: any[]) {
  const raw = clean(text);
  const n = normalize(raw);

  const productInMessage = detectProduct(raw, parsed, "");
  const pricingInMessage = detectTemplatePricingSmart(raw, parsed);
  const pricingFromHistory = getTemplatePricingFromHistory(history, parsed);
  const lastTemplateProduct = getProductFromLastPromotion(history, parsed)?.canonical || "";
  const effectivePricing = pricingInMessage || pricingFromHistory;

  // Cliente/operador pega la plantilla completa + QUIERO.
  const pastedTemplate =
    isPromotionLikeMessage(raw) ||
    isSafeTemplatePricingMessage(raw) ||
    !!pricingInMessage;

  // Cliente pregunta por un producto nuevo.
  const productInterest =
    !!productInMessage &&
    /\b(me interesa|precio|cuanto|cuánto|quiero|confirmar|comprar|consulta|info|informacion|información)\b/.test(n);

  // Respuesta "QUIERO" justo después de una plantilla nueva enviada por el bot.
  const wantsLastTemplate =
    (isGenericBuyReply(raw) || isBuyIntent(raw)) &&
    !!lastTemplateProduct;

  return {
    isNew: Boolean(pastedTemplate || productInterest || wantsLastTemplate),
    // ✅ FIX V7: si hay plantilla con precio, el producto de la plantilla gana.
    product: effectivePricing?.product || productInMessage || lastTemplateProduct || "",
    pricing: effectivePricing,
  };
}
function isRespondingToPromotion(text: string, history: any[]) {
  if (!isBuyIntent(text) && !isGenericBuyReply(text)) return false;

  const lastBotMessages = (history || [])
    .slice(-4)
    .filter((h: any) => h.role === "assistant" || h.role === "model");

  return lastBotMessages.some((item) => isPromotionLikeMessage(clean(item?.content)));
}

/**
 * Regla anti-datos-viejos:
 * Si el cliente entra con interés/producto o responde QUIERO a una promo/campaña,
 * se inicia pedido limpio. Solo se conserva producto/promo, NO ciudad/nombre/dirección/teléfono viejos.
 */
function shouldStartFreshOrder({
  texto,
  context,
  oldOrder,
  productFromMessage,
  lockedProductByContext,
  promoResponse,
  parsed,
}: {
  texto: string;
  context: any;
  oldOrder: OrderData;
  productFromMessage: string;
  lockedProductByContext: ProductItem | null;
  promoResponse: boolean;
  parsed: ParsedTraining;
}) {
  const msg = normalize(texto);
  const explicitInterest =
    /\b(me interesa|precio|cuanto|cuanto sale|quiero informacion|info|informacion|quiero saber|consulta)\b/.test(msg);

  const productChanged =
    !!productFromMessage &&
    !!oldOrder.product &&
    normalize(productFromMessage) !== normalize(oldOrder.product);

  const campaignClick =
    explicitInterest &&
    !!productFromMessage;

  const genericWantsPromo =
    (isGenericBuyReply(texto) || isBuyIntent(texto)) &&
    promoResponse &&
    !!lockedProductByContext;

  const contextWasConfirmed = context?.step === "pedido_confirmado";

  const stale = isOrderStale(oldOrder, context?.updated_at || new Date().toISOString());

  return Boolean(productChanged || campaignClick || genericWantsPromo || contextWasConfirmed || stale);
}

function getLockedProductFromContext(
  context: any,
  oldOrder: OrderData,
  history: any[],
  parsed: ParsedTraining
): ProductItem | null {
  const candidates = [
    context?.current_product,
    context?.last_topic,
    context?.order_data?.product,
    context?.last_ad_product,
    context?.last_ad_offer?.product,
    oldOrder?.product,
    oldOrder?.locked_offer?.product,
    getProductFromLastPromotion(history, parsed)?.canonical,
  ]
    .map(clean)
    .filter(Boolean);

  for (const candidate of candidates) {
    const productInfo = getProductInfo(candidate, parsed);
    if (productInfo) return productInfo;
  }

  return null;
}

function getLockedOfferFromContext(context: any, oldOrder: OrderData, history: any[], parsed: ParsedTraining): OfferItem | null {
  const fromCtx = context?.last_ad_offer || context?.order_data?.locked_offer || oldOrder?.locked_offer;

  if (fromCtx?.product && fromCtx?.quantity && fromCtx?.total) {
    const p = getProductInfo(fromCtx.product, parsed);
    if (p) {
      return {
        product: p.canonical,
        quantity: sanitizeQuantity(fromCtx.quantity),
        total: Number(fromCtx.total),
        label: fromCtx.label || `${fromCtx.quantity} por ${formatGs(fromCtx.total)} Gs`,
        source: fromCtx.source || "context",
      };
    }
  }

  return getOfferFromLastPromotion(history, parsed);
}

/**
 * ✅ Una ciudad real es un nombre propio corto, nunca una oración con verbo.
 * Esto evita que frases como "me interesa el afilador" o "cuanto sale"
 * terminen guardadas como si fueran el nombre de una ciudad, aunque
 * detectProduct no haya reconocido el producto en ese mensaje puntual.
 */
function looksLikeSentenceNotCity(text: string) {
  const n = normalize(text);
  return /\b(me interesa|te interesa|interesa|quiero|necesito|cuanto|cuánto|cuesta|precio|tienen|tenes|tenés|hay|dame|mandame|reservame|consulta|informacion|información|hola|buenas|gracias|comprar|compro)\b/.test(n);
}

function hasPaymentProofText(text: string) {
  const n = normalize(text);
  return /\b(comprobante|transferi|transferí|transferencia hecha|ya pague|ya pagué|deposito|depósito|pague|pagué|adjunto|envio comprobante|envío comprobante|recibo)\b/.test(n);
}

function hasPaymentProof(context: any, text: string, mediaUrl?: string, mediaType?: string) {
  if (context?.order_data?.payment_proof_received === true) return true;
  if (context?.payment_proof_received === true) return true;
  if (hasPaymentProofText(text)) return true;
  if (mediaUrl && /image|document|pdf|application/i.test(clean(mediaType))) return true;
  return false;
}

function nextStep(order: OrderData, coverage: boolean | null) {
  if (!order.product) return "selling";
  if (!order.city) return "collecting_city";

  // Pack/cantidad fija: si la plantilla ya trae cantidad y precio,
  // no se pregunta cantidad. Se usa la cantidad bloqueada.
  if (!order.quantity && order.locked_offer?.fixed_quantity) {
    order.quantity = order.locked_offer.quantity;
  }

  if (!order.quantity) return "collecting_quantity";

  if (coverage === false) {
    if (!order.customer_name) return "collecting_name";
    if (!order.phone) return "collecting_phone";
    if (!order.payment_proof_received) return "waiting_payment_proof";
    return "confirm_order";
  }

  if (!order.customer_name) return "collecting_name";
  if (!order.address) return "collecting_address";
  if (!order.phone) return "collecting_phone";
  return "confirm_order";
}

function getMissing(order: OrderData, coverage: boolean | null) {
  const missing: string[] = [];
  if (!order.product) missing.push("producto");
  if (!order.city) missing.push("ciudad");
  if (!order.quantity && !order.locked_offer?.fixed_quantity) missing.push("cantidad");

  if (order.product && order.city && order.quantity) {
    if (!order.customer_name) missing.push("nombre y apellido");
    if (coverage !== false && !order.address) missing.push("dirección exacta o ubicación");
    if (!order.phone) missing.push("número de celular");
    if (coverage === false && !order.payment_proof_received) missing.push("comprobante de transferencia");
  }

  return missing;
}

function bankDataText(parsed: ParsedTraining) {
  const b = parsed.bankData;
  if (!b) return "Datos de transferencia no configurados en entrenamiento.";

  const lines = [
    b.titular ? `Titular: ${b.titular}` : "",
    b.ci ? `CI: ${b.ci}` : "",
    b.entidad ? `Entidad: ${b.entidad}` : "",
    b.banco ? `Banco: ${b.banco}` : "",
    b.cuenta ? `N° de cuenta: ${b.cuenta}` : "",
    b.alias ? `Alias: ${b.alias}` : "",
  ].filter(Boolean);

  if (lines.length > 0) return lines.join("\n");
  return b.raw || "Datos de transferencia no configurados en entrenamiento.";
}

function productPriceText(productInfo: ProductItem | null, lockedOffer?: OfferItem | null, templatePricing?: TemplatePricing | null) {
  if (!productInfo) return "";

  // ✅ Si el producto es pack fijo (detectado desde catálogo formal con
  // PACK_FIJO o desde copy libre sin precio real de 1 unidad), SIEMPRE
  // mostrar el texto de pack fijo, sin importar de dónde venga lockedOffer.
  // Esto evita mostrar "1 unidad: X Gs" junto a "2 unidades: X Gs" con el
  // mismo precio, que confunde al cliente.
  if (productInfo.fixedPackQuantity && productInfo.price1) {
    return `Pack fijo: ${productInfo.fixedPackQuantity} unidades por ${formatGs(productInfo.price1)} Gs. No se vende por unidad.`;
  }

  // ✅ FIX V6:
  // Si hay precio/pack de plantilla para este producto, NO se muestran precios del catálogo.
  // La plantilla es la única fuente de verdad para producto/cantidad/precio del pedido actual.
  if (templatePricing && normalize(templatePricing.product) === normalize(productInfo.canonical)) {
    const fixed = getFixedTemplateOffer(templatePricing, productInfo.canonical);
    if (fixed) {
      return `Pack fijo: ${fixed.quantity} unidades por ${formatGs(fixed.total)} Gs. No se vende por unidad.`;
    }

    const lines = templatePricing.offers
      .filter((o) => o.total >= 10000)
      .sort((a, b) => a.quantity - b.quantity)
      .map((o) =>
        o.quantity === 1
          ? `1 unidad: ${formatGs(o.total)} Gs`
          : `${o.quantity} unidades: ${formatGs(o.total)} Gs`
      );

    if (lines.length) return lines.join("\n");
  }

  // ✅ Si la oferta bloqueada viene de plantilla, tampoco mezclar con precio unitario del catálogo.
  if (
    lockedOffer &&
    lockedOffer.source === "template" &&
    normalize(lockedOffer.product) === normalize(productInfo.canonical) &&
    lockedOffer.quantity > 0 &&
    lockedOffer.total > 0
  ) {
    return lockedOffer.fixed_quantity
      ? `Pack fijo: ${lockedOffer.quantity} unidades por ${formatGs(lockedOffer.total)} Gs. No se vende por unidad.`
      : `${lockedOffer.quantity} unidad${lockedOffer.quantity > 1 ? "es" : ""}: ${formatGs(lockedOffer.total)} Gs`;
  }

  if (
    lockedOffer &&
    normalize(lockedOffer.product) === normalize(productInfo.canonical) &&
    lockedOffer.quantity > 0 &&
    lockedOffer.total > 0
  ) {
    return [
      `1 unidad: ${formatGs(productInfo.price1)} Gs`,
      `Promo ${lockedOffer.quantity} unidades: ${formatGs(lockedOffer.total)} Gs`,
    ].join("\n");
  }

  const lines = [`1 unidad: ${formatGs(productInfo.price1)} Gs`];
  if (productInfo.price2) lines.push(`2 unidades: ${formatGs(productInfo.price2)} Gs`);
  if (productInfo.price3) lines.push(`3 unidades: ${formatGs(productInfo.price3)} Gs`);
  return lines.join("\n");
}

function productsSummary(parsed: ParsedTraining) {
  if (!parsed.products.length) return "No hay productos cargados.";
  return parsed.products
    .map((p) => {
      const promos = [
        `1 unidad ${formatGs(p.price1)} Gs`,
        p.price2 ? `2 unidades ${formatGs(p.price2)} Gs` : "",
        p.price3 ? `3 unidades ${formatGs(p.price3)} Gs` : "",
      ].filter(Boolean).join(" | ");
      return `- ${p.canonical}: ${promos}`;
    })
    .join("\n");
}


/**
 * ✅ FIX V6 - Fuente de verdad para precios:
 * Cuando hay plantilla activa, el catálogo/entrenamiento NO compite.
 * El entrenamiento queda solo para cobertura, bancos, factura, tono y reglas generales.
 */
function hasTemplateForProduct(templatePricing: TemplatePricing | null | undefined, productName: string) {
  return Boolean(
    templatePricing &&
    productName &&
    normalize(templatePricing.product) === normalize(productName) &&
    Array.isArray(templatePricing.offers) &&
    templatePricing.offers.length > 0
  );
}

function hasActiveTemplatePricing(templatePricing: TemplatePricing | null | undefined, order?: OrderData | null) {
  return Boolean(order?.product && hasTemplateForProduct(templatePricing, order.product));
}

function templatePricingSummary(templatePricing: TemplatePricing | null | undefined) {
  if (!templatePricing?.offers?.length) return "No hay plantilla activa.";

  return templatePricing.offers
    .filter((o) => o.total >= 10000)
    .sort((a, b) => a.quantity - b.quantity)
    .map((o) => {
      const fixed = o.fixed_quantity ? " PACK FIJO" : "";
      return `- ${o.quantity} unidad${o.quantity > 1 ? "es" : ""}: ${formatGs(o.total)} Gs${fixed}`;
    })
    .join("\n");
}

function catalogForPrompt(parsed: ParsedTraining, state: ConversationState, templatePricing?: TemplatePricing | null) {
  if (hasActiveTemplatePricing(templatePricing, state.order)) {
    return `
MODO PLANTILLA ACTIVA:
- Hay una plantilla/promoción activa para este pedido.
- Producto, cantidad, promo y precio salen EXCLUSIVAMENTE de la plantilla.
- NO usar CATALOGO_PRODUCTOS ni precios del entrenamiento para este pedido.
- NO ofrecer unidades, packs ni promos que no aparezcan en la plantilla.
- NO ofrecer 1 unidad si la plantilla solo muestra pack de 2.
- NO recalcular total multiplicando precio de plantilla por cantidad.
- Si la plantilla trae una sola oferta, respetar esa oferta.
- Si la plantilla trae Producto + Cantidad + Precio, respetar exactamente esos datos.

DATOS DE LA PLANTILLA ACTIVA:
Producto: ${templatePricing?.product || state.order.product}
Ofertas detectadas:
${templatePricingSummary(templatePricing)}
`.trim();
  }

  return `
MODO CATÁLOGO / ENTRENAMIENTO:
- No hay plantilla activa.
- Usar la lista de precios del entrenamiento.
- Podés ofrecer productos y promos del catálogo.

CATÁLOGO:
${productsSummary(parsed)}

URL CATÁLOGO:
${parsed.catalogUrl || "No configurado."}
`.trim();
}

function buildHardInstruction(state: ConversationState) {
  const { order, coverage, missing } = state;

  if (!order.product) {
    return "Vender: presentar opciones del catálogo y preguntar qué producto le interesa. No pedir ciudad todavía si no hay producto.";
  }

  if (!order.city) {
    if (order.locked_offer?.fixed_quantity) {
      return `Confirmar que la promo es un pack fijo de ${order.locked_offer.quantity} unidades por ${formatGs(order.locked_offer.total)} Gs, aclarar que no se vende por unidad y preguntar SOLO ciudad de envío. No pedir nombre/dirección/teléfono todavía.`;
    }
    return "Confirmar producto/precio/promo y preguntar SOLO ciudad de envío. No inventar ciudad. No pedir nombre/dirección/teléfono todavía.";
  }

  if (!order.quantity) {
    if (order.locked_offer?.fixed_quantity) {
      return `La cantidad ya está definida por la plantilla: pack fijo de ${order.locked_offer.quantity} unidades por ${formatGs(order.locked_offer.total)} Gs. No preguntar 1 o 2. Avanzar con ciudad o datos faltantes.`;
    }

    const promoText =
      order.locked_offer && order.locked_offer.quantity > 1
        ? ` Preguntar explícitamente si quiere 1 unidad o la promo de ${order.locked_offer.quantity} unidades por ${formatGs(order.locked_offer.total)} Gs.`
        : " Preguntar explícitamente si quiere 1 unidad o más unidades según las promos disponibles.";

    if (coverage === false) {
      return "Informar con tacto que no tiene contra-entrega y que se envía por transportadora con pago anticipado, PERO pedir primero cantidad." + promoText + " No mostrar datos bancarios hasta tener cantidad.";
    }

    return "Confirmar cobertura/envío gratis si aplica y preguntar cantidad antes de pedir datos personales." + promoText + " No pedir nombre, dirección ni teléfono todavía.";
  }

  if (coverage === false && order.quantity > 0) {
    if (missing.length > 0) {
      return "Informar total, explicar envío por transportadora y pago anticipado. Mostrar datos de transferencia porque ya hay cantidad. Pedir SOLO lo faltante: nombre completo, teléfono y/o comprobante de transferencia. IMPORTANTE: no confirmar el pedido hasta recibir comprobante.";
    }
    return "Confirmar el pedido por transportadora porque ya se recibió comprobante y datos.";
  }

  if (missing.length > 0) {
    return `Pedir SOLO lo faltante: ${missing.join(", ")}. No repetir lo que ya está completo. Si la ciudad ya está cargada como "${order.city}", NO vuelvas a preguntar ciudad. Usá emojis y tono amable de vendedor.`;
  }

  return "Confirmar pedido completo. No preguntes si está todo correcto. El backend responde con el formato fijo de PEDIDO CONFIRMADO.";
}

function buildState(order: OrderData, parsed: ParsedTraining): ConversationState {
  const productInfo = getProductInfo(order.product, parsed);
  const coverage = order.city ? hasCoverage(order.city, parsed) : null;
  const total = order.product && order.quantity ? calculateTotal(order.product, order.quantity, parsed, order.locked_offer) : 0;
  const missing = getMissing(order, coverage);
  const step = nextStep(order, coverage);

  const state: ConversationState = {
    order,
    step,
    productInfo,
    coverage,
    total,
    missing,
    hardInstruction: "",
  };

  state.hardInstruction = buildHardInstruction(state);
  return state;
}

function shouldConfirmOrder(state: ConversationState) {
  const o = state.order;

  if (!o.product || !o.city || !o.quantity || !o.customer_name || !o.phone) {
    return false;
  }

  if (state.coverage !== false && !o.address) {
    return false;
  }

  if (state.coverage === false && !o.payment_proof_received) {
    return false;
  }

  return state.step === "confirm_order";
}

/**
 * ✅ FIX V9 CONFIRMACIÓN DIRECTA:
 * Esta función NO depende del texto que genere Gemini ni del paso conversacional.
 * Si el backend ya tiene todos los datos reales del pedido, debe confirmar SIEMPRE
 * con finalConfirmationMessage().
 *
 * Evita el bug:
 * "Ya tenemos todos tus datos... ¿Confirmamos tu pedido?"
 *
 * Regla:
 * - Contra-entrega/cobertura: producto + ciudad + cantidad + nombre + dirección + teléfono.
 * - Sin cobertura: producto + ciudad + cantidad + nombre + teléfono + comprobante.
 */
function hasAllRequiredOrderDataForDirectConfirmation(state: ConversationState) {
  const o = state.order;

  const hasBaseData = Boolean(
    clean(o.product) &&
    clean(o.city) &&
    sanitizeQuantity(o.quantity) > 0 &&
    clean(o.customer_name) &&
    clean(o.phone)
  );

  if (!hasBaseData) return false;

  // Seguridad: no confirmar si el producto no existe en catálogo/entrenamiento.
  // La plantilla puede fijar precio/cantidad, pero el producto debe poder mapearse.
  if (!state.productInfo) return false;

  // Si hay cobertura contra-entrega, la dirección es obligatoria.
  if (state.coverage !== false) {
    return Boolean(clean(o.address));
  }

  // Si no hay cobertura, no se confirma hasta recibir comprobante.
  return Boolean(o.payment_proof_received);
}

function isOrderStale(order: OrderData, lastActivity: string) {
  const hasProduct = !!order?.product;
  const hasCity = !!order?.city;
  const hasQuantity = order?.quantity > 0;
  const hasCustomerData = !!(order?.customer_name || order?.address || order?.phone);

  const now = new Date();
  const last = new Date(lastActivity);
  const diffMinutes = (now.getTime() - last.getTime()) / (1000 * 60);

  return hasProduct && hasCity && hasQuantity && !hasCustomerData && diffMinutes > 10;
}

async function safeUpsertOrder(
  userId: string,
  from: string,
  order: OrderData,
  parsed: ParsedTraining,
  confirm = false
) {
  if (!getProductInfo(order.product, parsed)) return null;

  const state = buildState(order, parsed);
  const status = confirm && state.step === "confirm_order" ? "confirmed" : state.step === "confirm_order" ? "confirm_pending" : state.step;

  const orderId = clean(order.order_id);
  const payload: any = {
    user_id: userId,
    order_id: orderId || null,
    from_number: from,
    phone: order.phone || from,
    product: order.product,
    producto: order.product,
    customer_name: order.customer_name || null,
    city: order.city || null,
    ciudad: order.city || null,
    address: order.address || null,
    quantity: order.quantity || 1,
    total_amount: state.total || null,
    status,
    fecha: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (order.locked_offer) payload.locked_offer = order.locked_offer;
  if (order.payment_proof_received) payload.payment_proof_received = true;

  if (orderId) {
    const { data: existingByOrderId } = await supabase
      .from("orders")
      .select("id")
      .eq("user_id", userId)
      .eq("order_id", orderId)
      .limit(1)
      .maybeSingle();

    if (existingByOrderId?.id) {
      await supabase.from("orders").update(payload).eq("id", existingByOrderId.id);
      return existingByOrderId.id;
    }
  }

  const IN_PROGRESS_STATUSES = [
    "draft",
    "selling",
    "collecting_city",
    "collecting_quantity",
    "collecting_name",
    "collecting_phone",
    "collecting_address",
    "waiting_payment_proof",
    "confirm_pending",
  ];

  const { data: inProgress } = await supabase
    .from("orders")
    .select("id, order_id")
    .eq("user_id", userId)
    .eq("from_number", from)
    .in("status", IN_PROGRESS_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inProgress?.id) {
    const updatePayload = {
      ...payload,
      order_id: orderId || inProgress.order_id || makeOrderId(from),
    };
    await supabase.from("orders").update(updatePayload).eq("id", inProgress.id);
    return inProgress.id;
  }

  const insertPayload = {
    ...payload,
    order_id: orderId || makeOrderId(from),
  };

  const { data, error } = await supabase
    .from("orders")
    .upsert(insertPayload, { onConflict: "user_id,order_id" })
    .select("id")
    .single();

  if (error) {
    console.error("❌ orders upsert:", error);
    return null;
  }

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


function finalConfirmationMessage(state: ConversationState, parsed: ParsedTraining) {
  const o = state.order;
  const addressPart = o.address ? ` — ${o.address}` : "";

  if (state.coverage === false) {
    return `✅ PEDIDO CONFIRMADO

✅ Producto: ${o.product}
✅ Cliente: ${o.customer_name}
✅ Ubicación: ${o.city}${addressPart}
✅ Contacto: ${o.phone}
✅ Cantidad: ${o.quantity} u.
💰 Total: ${formatGs(state.total)} Gs

🚚 Su encomienda será enviada por transportadora.

📎 Ya recibimos tus datos y comprobante. Una vez procesado el envío, te estaremos enviando tu comprobante de despacho.

⏰ Oferta válida hoy

¡Gracias por elegirnos!!! 💜✨

💵 Pago anticipado por transferencia.

¡Gracias por tu compra! 🛍️✨


Podés pedir cualquier producto con el mismo proceso rápido y seguro. ¡Te esperamos! 💜`;
  }

  return `✅ PEDIDO CONFIRMADO

✅ Producto: ${o.product}
✅ Cliente: ${o.customer_name}
✅ Ubicación: ${o.city}${addressPart}
✅ Contacto: ${o.phone}
✅ Cantidad: ${o.quantity} u.
💰 Total: ${formatGs(state.total)} Gs

🚚 Envío GRATIS · Pagás al recibir

🚚 Tu pedido queda agendado para la próxima ronda de envíos. Si pagás al recibir, el delivery lo confirma al llegar a tu zona.

⏰ Oferta válida hoy

¡Gracias por elegirnos!!! 💜✨

💵 Podés pagar en EFECTIVO o TRANSFERENCIA AL DELIVERY cuando recibas tu producto. ¡Como te quede más cómodo! 🚚

¡Gracias por tu compra! 🛍️✨


Podés pedir cualquier producto con el mismo proceso rápido y seguro. ¡Te esperamos! 💜`;
}


function deterministicAfterCityFixedOfferMessage(state: ConversationState, parsed: ParsedTraining) {
  const o = state.order;
  if (!o.product || !o.city || !o.locked_offer?.fixed_quantity) return "";

  const total = o.locked_offer.total;

  if (state.coverage === false) {
    return `✅ Perfecto 😊

📦 Promo confirmada:
${o.locked_offer.quantity} unidades de ${o.product}
💰 Total: ${formatGs(total)} Gs

📍 ${o.city} no cuenta con contra-entrega, pero hacemos envío por transportadora 🚚

💵 Para avanzar, realizá la transferencia y enviame el comprobante junto con:
✅ nombre completo
✅ número de celular

${bankDataText(parsed)} 📲`;
  }

  return `✅ Perfecto 😊

📦 Promo confirmada:
${o.locked_offer.quantity} unidades de ${o.product}
💰 Total: ${formatGs(total)} Gs

📍 ${o.city} tiene envío GRATIS y pagás al recibir 🚚

Ahora solo necesito:
✅ nombre y apellido
✅ dirección exacta o ubicación
✅ número de celular 📲`;
}

function deterministicAfterQuantityMessage(state: ConversationState, parsed: ParsedTraining) {
  const o = state.order;
  if (!o.product || !o.city || !o.quantity) return "";

  if (state.step !== "collecting_name" && state.step !== "collecting_address" && state.step !== "collecting_phone") {
    return "";
  }

  if (state.missing.includes("ciudad")) return "";

  const promoLine =
    o.locked_offer && o.locked_offer.quantity === o.quantity
      ? `🔥 Promo aplicada: ${o.quantity} unidades por ${formatGs(state.total)} Gs`
      : `💰 Total: ${formatGs(state.total)} Gs`;

  if (state.coverage === false) {
    return `🎉 ¡Perfecto! Queda seleccionado:

📦 ${o.product}
🔢 Cantidad: ${o.quantity}
${promoLine}
📍 Ciudad: ${o.city}

🚚 Para tu zona hacemos envío por transportadora con pago anticipado.

💵 Para avanzar, realizá la transferencia y enviame el comprobante junto con:
✅ nombre completo
✅ número de celular

${bankDataText(parsed)} 📲`;
  }

  return `🎉 ¡Excelente elección! Queda seleccionado:

📦 ${o.product}
🔢 Cantidad: ${o.quantity}
${promoLine}
📍 ${o.city} tiene envío GRATIS y pagás al recibir 🚚

Ahora solo necesito:
✅ nombre y apellido
✅ dirección exacta o ubicación
✅ número de celular 📲`;
}

function buildSalesSystemPrompt(parsed: ParsedTraining, state: ConversationState, templatePricing?: TemplatePricing | null) {
  const o = state.order;

  return `
Sos la IA vendedora de Mega Todo Store / One Store.
Tu trabajo es vender de forma natural, amable, segura y breve por WhatsApp.

REGLA PRINCIPAL:
El backend ya calculó y validó el estado. Vos NO inventás datos. Vos redactás una respuesta fluida siguiendo la INSTRUCCIÓN OBLIGATORIA.

INSTRUCCIÓN OBLIGATORIA:
${state.hardInstruction}

ESTADO DEL PEDIDO:
- Paso actual: ${state.step}
- Producto: ${o.product || "faltante"}
- Cantidad: ${o.quantity || "faltante"}
- Ciudad: ${o.city || "faltante"}
- Tiene cobertura contra-entrega: ${state.coverage === null ? "aún no se sabe" : state.coverage ? "sí" : "no"}
- Nombre: ${o.customer_name || "faltante"}
- Dirección: ${o.address || "faltante"}
- Teléfono: ${o.phone || "faltante"}
- Total calculado: ${state.total ? `${formatGs(state.total)} Gs` : "aún no corresponde"}
- Faltante: ${state.missing.length ? state.missing.join(", ") : "nada"}
- Promo bloqueada desde plantilla: ${o.locked_offer ? `${o.locked_offer.quantity} unidades por ${formatGs(o.locked_offer.total)} Gs` : "no"}

FUENTE DE PRODUCTO / CANTIDAD / PRECIO:
${catalogForPrompt(parsed, state, templatePricing)}

PRECIO/PROMO DEL PRODUCTO ACTUAL:
${productPriceText(state.productInfo, o.locked_offer, templatePricing) || "Sin producto actual."}

${
  state.productInfo?.salesCopy
    ? `COPY DE VENTA ORIGINAL DE ESTE PRODUCTO (usalo como base, podés mejorar redacción/tono/orden, pero el PRECIO final que menciones debe ser EXACTAMENTE el de "PRECIO/PROMO DEL PRODUCTO ACTUAL" de arriba, nunca inventes ni cambies un número):
"""
${state.productInfo.salesCopy}
"""
`
    : ""
}
DATOS DE TRANSFERENCIA:
${bankDataText(parsed)}

REGLAS DURAS:
- Respondé en español paraguayo/neutro, estilo WhatsApp.
- Sé vendedor amable, cálido y fluido. Usá emojis comerciales moderados: 😊🔥🚚✅📦💰📍📲.
- Máximo 6 a 10 líneas salvo confirmación final.
- No digas que sos IA.
- No menciones backend, sistema ni estado interno.
- No inventes productos, precios, bancos, cuentas, enlaces, ciudades ni tiempos.
- PROHIBIDO inventar ciudad. Si Ciudad = faltante, preguntá ciudad.
- Si Ciudad ya tiene valor en ESTADO DEL PEDIDO, PROHIBIDO volver a preguntar ciudad.
- PROHIBIDO usar ciudad vieja si no aparece en ESTADO DEL PEDIDO.
- Si falta producto, ofrecé catálogo/productos.
- Si falta ciudad, preguntá ciudad.
- Si falta cantidad, preguntá cantidad.
- Si la plantilla dice Producto + Cantidad + Precio, pack fijo, combo fijo, no se vende por unidad o únicamente por pack: NO preguntes cantidad, respetá cantidad y precio de la plantilla.
- Si hay promo variable de 2 unidades y el cliente no especificó cantidad, NO asumas 1 unidad ni 2 unidades: preguntá si quiere 1 unidad o la promo.
- Si faltan datos, pedí SOLO lo faltante.
- Si no hay cobertura y todavía falta cantidad, NO muestres datos bancarios.
- Si no hay cobertura y ya hay cantidad, podés mostrar datos de transferencia.
- Si hay cobertura, indicar envío gratis contra-entrega cuando corresponda.
- Si el cliente pregunta precio, respondé precio y guiá al siguiente paso.
- PRIORIDAD DE PRECIOS:
  1) Si hay plantilla activa, usá SOLO producto, cantidad y precio de la plantilla.
  2) Mientras haya plantilla activa, PROHIBIDO usar CATALOGO_PRODUCTOS del entrenamiento para precio/cantidad/producto.
  3) No ofrezcas 1 unidad si la plantilla solo muestra pack de 2.
  4) No ofrezcas packs/promos del entrenamiento si no aparecen en la plantilla.
  5) No recalcules total multiplicando precio de plantilla por cantidad.
  6) Solo usá el catálogo del entrenamiento cuando NO exista plantilla activa.
- Nunca uses números de dirección, teléfono o calle como precio.
- Si hay "COPY DE VENTA ORIGINAL" para el producto actual, usalo como base de tu respuesta (podés reordenar, resumir o mejorar la redacción), pero el precio que digas SIEMPRE debe coincidir exactamente con "PRECIO/PROMO DEL PRODUCTO ACTUAL". Nunca calcules ni escribas un precio distinto al ya provisto.
- Nunca inventes otro producto. Si llegó plantilla nueva, es venta nueva.
- Después de pedido confirmado, responder postventa si pregunta factura/entrega/pago/garantía.
- Si hay promo bloqueada desde plantilla, respetala y confirmala.
- Si no hay plantilla activa ni promo bloqueada, mostrar precios del catálogo.
- Nunca recalcules diferente al total calculado.
- Nunca preguntes “¿Está todo correcto?” si ya están todos los datos. Si el pedido está completo, el backend responde directamente con ✅ PEDIDO CONFIRMADO y no se llama a Gemini.
- En ciudad sin contra-entrega, NO confirmar hasta que payment_proof_received sea true.
`.trim();
}

function buildFallbackResponse(parsed: ParsedTraining, state: ConversationState, templatePricing?: TemplatePricing | null) {
  const o = state.order;

  if (!o.product) {
    return `😊 Dale, te ayudo.

Tenemos estas opciones disponibles:

${productsSummary(parsed)}

¿Cuál te interesa?`;
  }

  if (!o.city) {
    return `¡Excelente elección! 🔥

${state.productInfo?.canonical || o.product}
${productPriceText(state.productInfo, o.locked_offer, templatePricing)}

📍 ¿Para qué ciudad sería el envío? 😊`;
  }

  if (!o.quantity) {
    const templateActive = hasActiveTemplatePricing(templatePricing, o);

    const qtyQuestion = templateActive
      ? `¿Cuál de estas opciones de la plantilla querés confirmar?\n${templatePricingSummary(templatePricing)} 😊`
      : o.locked_offer && o.locked_offer.quantity > 1
        ? `¿Querés 1 unidad por ${formatGs(getTemplatePrice1(templatePricing || null, o.product) || state.productInfo?.price1 || 0)} Gs o la promo de ${o.locked_offer.quantity} unidades por ${formatGs(o.locked_offer.total)} Gs? 😊`
        : "¿Cuántas unidades querés llevar? 😊";

    if (state.coverage === false) {
      return `ℹ️ ${o.city} no entra en nuestra zona de contra-entrega, pero sí podemos enviarte por transportadora 🚚

Antes de pasarte el total y los datos de pago, decime: ${qtyQuestion}`;
    }

    return `✅ Perfecto, ${o.city} tiene envío gratis contra-entrega 🚚

${qtyQuestion}`;
  }

  if (state.missing.length) {
    const promoLine =
      o.locked_offer && o.locked_offer.quantity === o.quantity
        ? `🔥 Promo aplicada: ${o.quantity} unidades por ${formatGs(state.total)} Gs\n`
        : "";

    return `🎉 ¡Perfecto! Queda avanzado tu pedido 😊

📦 Producto: ${o.product}
${promoLine}🔢 Cantidad: ${o.quantity}
💰 Total: ${formatGs(state.total)} Gs
📍 Ciudad: ${o.city}

Para agendarlo, me falta:
✅ ${state.missing.join("\n✅ ")} 📲`;
  }

  return `✅ PEDIDO CONFIRMADO

📦 Producto: ${o.product}
🔢 Cantidad: ${o.quantity}
💰 Total: ${formatGs(state.total)} Gs
👤 Cliente: ${o.customer_name}
📍 Ciudad: ${o.city}
📞 Teléfono: ${o.phone}${o.address ? `\n🏠 Dirección: ${o.address}` : ""}

¡Gracias por tu compra! 💜`;
}

function postProcessResponse(resp: string) {
  return clean(resp)
    .replace(/\n{4,}/g, "\n\n")
    .slice(0, 4000);
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
    if (!texto && !media_url) return res.status(400).json({ error: "Faltan message o media" });

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
    const currentTemplatePricing = detectTemplatePricingSmart(texto, parsed);

    // ✅ FIX V11 mínimo:
    // Si después de un pedido confirmado el cliente dice explícitamente "Quiero plumero"
    // y luego responde "Quiero confirmar" a una plantilla nueva, ese producto explícito
    // debe ganar sobre cualquier last_ad_product/current_product viejo del contexto.
    const recentExplicitProductInterest = getRecentExplicitProductInterestAfterConfirmed(history, parsed);
    const templateAfterExplicitProductInterest = recentExplicitProductInterest
      ? getTemplatePricingAfterHistoryIndex(history, parsed, recentExplicitProductInterest.index)
      : null;

    let templatePricing =
      currentTemplatePricing ||
      (templateAfterExplicitProductInterest
        ? forceTemplatePricingProduct(templateAfterExplicitProductInterest, recentExplicitProductInterest?.product || null)
        : getTemplatePricingFromHistory(history, parsed));

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

    // ✅ Pedido cerrado / postventa:
    // Si llega plantilla/producto nuevo => venta nueva.
    // Si pregunta factura, llegada, pago, garantía, etc. => responder postventa sin reabrir pedido.
    // Si solo dice ok/gracias/nada más => respuesta corta.
    const newTemplateSignal = isNewTemplateOrProductIntent(texto, parsed, history);
    let forceFreshOrderFromConfirmedTemplate = false;

    if (context?.step === "pedido_confirmado") {
      const msgNormClosed = normalize(texto);
      const hasCurrentTemplatePricing = !!currentTemplatePricing;
      const productInClosedMessage = detectProduct(texto, parsed, "");
      const lastRealSalesTemplatePricing =
        templateAfterExplicitProductInterest && recentExplicitProductInterest
          ? forceTemplatePricingProduct(templateAfterExplicitProductInterest, recentExplicitProductInterest.product)
          : getLastRealSalesTemplatePricing(history, parsed);
      const lastRealSalesTemplateProduct = recentExplicitProductInterest?.product || (lastRealSalesTemplatePricing?.product ? getProductInfo(lastRealSalesTemplatePricing.product, parsed) : getLastRealSalesTemplateProduct(history, parsed));

      // ✅ IMPORTANTE:
      // Primero se detecta si el cliente está comprando una NUEVA plantilla real.
      // Ejemplo: después de un pedido confirmado, el bot manda otra plantilla y el cliente responde "QUIERO".
      // Eso debe iniciar venta nueva.
      // Pero "OK", "GRACIAS", "NADA MAS" NO deben reabrir venta aunque haya promos viejas en el historial.
      const explicitNewPurchaseAfterConfirmed =
        // Plantilla/precio pegado en el mensaje actual: SIEMPRE venta nueva.
        hasCurrentTemplatePricing ||
        isNewPastedTemplatePurchase(texto, parsed) ||
        // Producto nuevo explícito: “me interesa el afilador”, “precio del afilador”, etc.
        (!!productInClosedMessage && /\b(precio|cuanto|cuánto|me interesa|quiero|quiero comprar|comprar|confirmar|agendar|otro producto)\b/.test(msgNormClosed)) ||
        /\b(otro producto|nuevo pedido|hacer otro pedido|catalogo|catálogo|ver catalogo|ver catálogo|quiero comprar otra cosa)\b/.test(msgNormClosed) ||
        // “QUIERO” / “QUIERO CONFIRMAR” después de una plantilla REAL reciente enviada por el bot.
        ((isStrongNewPurchaseReply(texto) || hasTemplateBuyIntent(texto)) && !!lastRealSalesTemplateProduct && !!lastRealSalesTemplatePricing);

      if (explicitNewPurchaseAfterConfirmed) {
        forceFreshOrderFromConfirmedTemplate = true;
        oldOrder = emptyOrder(makeOrderId(fromNumber));
      } else {
        // ✅ Cierre real de conversación después de confirmar pedido.
        if (isShortAcknowledgement(texto) || isConversationClosing(texto)) {
          return res.json({
            response: `😊 ¡Perfecto, muchas gracias! Tu pedido ya quedó confirmado y agendado. 🚚📦`,
            context: {
              ...(context || {}),
              step: "pedido_confirmado",
              updated_at: new Date().toISOString(),
            },
          });
        }

        if (isPostSaleQuestion(texto)) {
          const deterministicPostSale = deterministicPostSaleResponse(texto, oldOrder, parsed);

          if (deterministicPostSale) {
            return res.json({
              response: deterministicPostSale,
              context: {
                ...(context || {}),
                step: "pedido_confirmado",
                updated_at: new Date().toISOString(),
              },
            });
          }

          const postSaleSystem = buildPostSaleSystemPrompt(parsed, oldOrder);

          const postSaleContents = (history || [])
            .slice(-8)
            .filter((h: any) => clean(h?.content))
            .map((h: any) => ({
              role: h.role === "assistant" ? "model" : "user",
              parts: [{ text: clean(h.content) }],
            }));

          postSaleContents.push({
            role: "user",
            parts: [{ text: texto }],
          });

          const postSaleResponse = await callGemini({
            apiKey,
            model,
            system: postSaleSystem,
            contents: postSaleContents,
            temperature: iaConfig.temperature ?? 0.45,
            maxTokens: Math.max(iaConfig.max_tokens ?? 0, 1024),
          });

          return res.json({
            response: postProcessResponse(postSaleResponse || `😊 Tu pedido ya quedó confirmado y agendado. El delivery te confirma al llegar a tu zona. 🚚📦`),
            context: {
              ...(context || {}),
              step: "pedido_confirmado",
              updated_at: new Date().toISOString(),
            },
          });
        }

        return res.json({
          response: `😊 ¡Perfecto! Tu pedido ya quedó confirmado y agendado. Gracias por elegirnos 💜🚚`,
          context: {
            ...(context || {}),
            step: "pedido_confirmado",
            updated_at: new Date().toISOString(),
          },
        });
      }
    }

    const productFromMessageInitial = detectProduct(texto, parsed, "") || newTemplateSignal.product || "";
    const lockedProductInitial = getLockedProductFromContext(context, oldOrder, history, parsed);
    const promoResponse = isRespondingToPromotion(texto, history);

    let freshOrder = shouldStartFreshOrder({
      texto,
      context,
      oldOrder,
      productFromMessage: productFromMessageInitial,
      lockedProductByContext: lockedProductInitial,
      promoResponse,
      parsed,
    });

    // Si el mensaje actual trae una plantilla/precio/producto nuevo, siempre iniciar nuevo pedido.
    if ((newTemplateSignal.isNew || forceFreshOrderFromConfirmedTemplate) && context?.step === "pedido_confirmado") {
      freshOrder = true;
    }

    if (freshOrder) {
      oldOrder = emptyOrder(makeOrderId(fromNumber));
    }

    const currentTemplateLockedOffer = templatePricing?.product
      ? (getFixedTemplateOffer(templatePricing, templatePricing.product) || templatePricing.offers[0] || null)
      : null;

    let lockedOfferByContext = freshOrder
      ? (currentTemplateLockedOffer || getOfferFromLastPromotion(history, parsed))
      : getLockedOfferFromContext(context, oldOrder, history, parsed);

    // ✅ FIX V7:
    // Para respuestas genéricas como "QUIERO", nunca dejar que un producto viejo del contexto
    // gane sobre la plantilla activa. La prioridad correcta es:
    // 1) plantilla actual pegada en el mensaje,
    // 2) última plantilla real del historial,
    // 3) producto explícito del mensaje,
    // 4) recién después contexto viejo / catálogo.
    let productToUse =
      currentTemplatePricing?.product ||
      ((isGenericBuyReply(texto) || isStrongNewPurchaseReply(texto) || hasTemplateBuyIntent(texto)) ? recentExplicitProductInterest?.product?.canonical || "" : "") ||
      templatePricing?.product ||
      newTemplateSignal.product ||
      productFromMessageInitial ||
      "";

    if (!productToUse && (isGenericBuyReply(texto) || promoResponse || isBuyIntent(texto))) {
      productToUse = templatePricing?.product || getProductFromLastPromotion(history, parsed)?.canonical || lockedProductInitial?.canonical || "";
    }

    if (!productToUse && !freshOrder) {
      productToUse = oldOrder.product || "";
    }

    let product = detectProduct(texto, parsed, productToUse);

    // ✅ FIX V7 extra:
    // Si hay plantilla activa y el mensaje es genérico (QUIERO/CONFIRMO), forzar producto de plantilla.
    // Esto evita respuestas como: plantilla de Afilador + producto viejo Almohadillas.
    if (
      (recentExplicitProductInterest?.product?.canonical || templatePricing?.product) &&
      (isGenericBuyReply(texto) || isStrongNewPurchaseReply(texto) || hasTemplateBuyIntent(texto)) &&
      !detectProduct(texto, parsed, "")
    ) {
      product = recentExplicitProductInterest?.product?.canonical || templatePricing?.product || product;
      if (templatePricing && recentExplicitProductInterest?.product?.canonical && normalize(templatePricing.product) !== normalize(recentExplicitProductInterest.product.canonical)) {
        templatePricing = forceTemplatePricingProduct(templatePricing, recentExplicitProductInterest.product);
      }
    }

    const productInfo = getProductInfo(product, parsed);

    if (product && !oldOrder.order_id) {
      oldOrder.order_id = makeOrderId(fromNumber);
    }

    let explicitQty = extractQuantity(texto);

    if (
      explicitQty === 0 &&
      isAffirmative(texto) &&
      context?.step === "collecting_quantity" &&
      productInfo &&
      !oldOrder.locked_offer &&
      !productInfo.price2 &&
      !productInfo.price3
    ) {
      explicitQty = 1;
    }

    /**
     * Promo locking/unlocking:
     * - "quiero" desde promo => bloquea promo y cantidad de la promo.
     * - "quiero uno"/"1 unidad" => desbloquea promo y usa cantidad explícita.
     * - "quiero dos" => usa promo catálogo si existe o promo plantilla si coincide.
     */
    let lockedOffer: OfferItem | null = null;

    if (productInfo) {
      const promoFromHistory = getOfferFromLastPromotion(history, parsed);
      const promoMatchesProduct = promoFromHistory && normalize(promoFromHistory.product) === normalize(productInfo.canonical);
      const fixedTemplateOffer = getFixedTemplateOffer(templatePricing, productInfo.canonical);
      // ✅ Pack fijo detectado desde copy libre de entrenamiento (sin plantilla activa en el chat).
      const fixedCatalogOffer = getCatalogFixedPackOffer(productInfo);

      if (fixedTemplateOffer) {
        lockedOffer = fixedTemplateOffer;
        explicitQty = fixedTemplateOffer.quantity;
      } else if (fixedCatalogOffer) {
        lockedOffer = fixedCatalogOffer;
        explicitQty = fixedCatalogOffer.quantity;
      } else if (explicitQty > 0) {
        const templateOffer = getTemplateOfferForQuantity(templatePricing, productInfo.canonical, explicitQty);
        const templatePrice1 = getTemplatePrice1(templatePricing, productInfo.canonical);
        const catalogOffer = getCatalogOffer(productInfo, explicitQty);

        const templateActiveForProduct = hasTemplateForProduct(templatePricing, productInfo.canonical);

        if (templateOffer) {
          lockedOffer = templateOffer;
        } else if (explicitQty === 1 && templatePrice1 > 0) {
          lockedOffer = {
            product: productInfo.canonical,
            quantity: 1,
            total: templatePrice1,
            label: `1 unidad por ${formatGs(templatePrice1)} Gs`,
            source: "template",
          };
        } else if (!templateActiveForProduct && catalogOffer) {
          lockedOffer = catalogOffer;
        } else if (
          promoMatchesProduct &&
          promoFromHistory.quantity === explicitQty
        ) {
          lockedOffer = promoFromHistory;
        } else {
          lockedOffer = null;
        }
      } else if ((isGenericBuyReply(texto) || promoResponse || isBuyIntent(texto)) && promoMatchesProduct) {
        lockedOffer = promoFromHistory;
      } else if (
        lockedOfferByContext &&
        normalize(lockedOfferByContext.product) === normalize(productInfo.canonical)
      ) {
        lockedOffer = lockedOfferByContext;
      }
    }

    const cityStatement = extractCityStatement(texto);
    const prevStep = freshOrder ? "" : context?.step || "";
    const isCityStep = prevStep === "collecting_city";
    const isDataCollectionStep = ["collecting_name", "collecting_address", "collecting_phone", "collecting_quantity"].includes(prevStep);

    const detectedCityRaw = detectCity(texto, parsed, "");

    const detectedCity =
      // Si estamos esperando cantidad/datos y ya había ciudad, conservarla SIEMPRE.
      // Esto evita que al responder "2 quiero" vuelva a pedir ciudad.
      (!freshOrder && oldOrder.city && ["collecting_quantity", "collecting_name", "collecting_address", "collecting_phone"].includes(prevStep))
        ? oldOrder.city
        : detectedCityRaw ||
          (cityStatement && !extractQuantity(texto) && !extractPhone(texto)
            ? cityStatement
            : !freshOrder && isDataCollectionStep && oldOrder.city
            ? oldOrder.city
            : isCityStep &&
              !extractQuantity(texto) &&
              !extractPhone(texto) &&
              !detectProduct(texto, parsed, "") &&
              !looksLikeSentenceNotCity(texto) &&
              normalize(texto).split(/\s+/).length <= 6
            ? clean(texto) || detectCity(texto, parsed, oldOrder.city)
            : !freshOrder
            ? detectCity(texto, parsed, oldOrder.city)
            : "");

    const phone = extractPhone(texto);
    const qty = explicitQty;
    const name = extractName(texto, detectedCity !== oldOrder.city ? detectedCity : "", phone, parsed);
    const address = extractAddress(texto, detectedCity !== oldOrder.city ? detectedCity : "", phone, name);

    let orderData = mergeOrderData(
      oldOrder,
      {
        order_id: oldOrder.order_id || makeOrderId(fromNumber),
        quantity: qty,
        city: detectedCity && detectedCity !== oldOrder.city ? detectedCity : "",
        phone,
        name,
        address,
        locked_offer: lockedOffer,
      },
      product
    );

    // Protección extra: si el cliente está respondiendo cantidad, no perder ciudad previa.
    if (!orderData.city && oldOrder.city && qty > 0) {
      orderData.city = oldOrder.city;
    }

    // Si la plantilla indica pack fijo / no se vende por unidad,
    // la cantidad queda bloqueada automáticamente desde la plantilla.
    if (
      orderData.locked_offer &&
      orderData.locked_offer.fixed_quantity &&
      orderData.quantity === 0
    ) {
      orderData.quantity = orderData.locked_offer.quantity;
    }

    // Para promos variables, no asumimos cantidad salvo que venga forzado por integración.
    if (
      orderData.locked_offer &&
      !orderData.locked_offer.fixed_quantity &&
      orderData.quantity === 0 &&
      !hasExplicitQuantity(texto) &&
      context?.force_offer_quantity === true
    ) {
      orderData.quantity = orderData.locked_offer.quantity;
    }

    // Si hay cantidad explícita distinta:
    // - pack fijo: NO se cambia, porque la plantilla dice que no se vende por unidad.
    // - promo variable: se puede cambiar.
    if (orderData.locked_offer && explicitQty > 0 && explicitQty !== orderData.locked_offer.quantity) {
      if (orderData.locked_offer.fixed_quantity) {
        orderData.quantity = orderData.locked_offer.quantity;
      } else {
        orderData.locked_offer = null;
        if (productInfo) {
          const templateOffer = getTemplateOfferForQuantity(templatePricing, productInfo.canonical, explicitQty);
          const templateActiveForProduct = hasTemplateForProduct(templatePricing, productInfo.canonical);
          const catalogOffer = templateActiveForProduct ? null : getCatalogOffer(productInfo, explicitQty);
          if (templateOffer) orderData.locked_offer = templateOffer;
          else if (catalogOffer) orderData.locked_offer = catalogOffer;
        }
        orderData.quantity = explicitQty;
      }
    }

    const proofReceived = hasPaymentProof(context, texto, media_url, media_type || mime_type);
    if (proofReceived) {
      orderData.payment_proof_received = true;
    } else if ((oldOrder as any).payment_proof_received) {
      orderData.payment_proof_received = true;
    }

    if (orderData.locked_offer && orderData.locked_offer.total < 10000) {
      orderData.locked_offer = null;
    }

    if (orderData.product && !getProductInfo(orderData.product, parsed)) {
      orderData.product = "";
      orderData.locked_offer = null;
    }

    const state = buildState(orderData, parsed);

    if (state.productInfo && !orderData.locked_offer && orderData.quantity) {
      const templateOffer = getTemplateOfferForQuantity(templatePricing, state.productInfo.canonical, orderData.quantity);
      const templateActiveForProduct = hasTemplateForProduct(templatePricing, state.productInfo.canonical);
      const catalogOffer = templateActiveForProduct ? null : getCatalogOffer(state.productInfo, orderData.quantity);

      if (templateOffer) {
        orderData.locked_offer = templateOffer;
      } else if (catalogOffer) {
        orderData.locked_offer = catalogOffer;
      } else {
        const templatePrice1 = getTemplatePrice1(templatePricing, state.productInfo.canonical);
        if (orderData.quantity === 1 && templatePrice1 > 0) {
          orderData.locked_offer = {
            product: state.productInfo.canonical,
            quantity: 1,
            total: templatePrice1,
            label: `1 unidad por ${formatGs(templatePrice1)} Gs`,
            source: "template",
          };
        }
      }
    }

    const finalState = buildState(orderData, parsed);
    // ✅ FIX V9:
    // Confirmar directo si el backend ya tiene todos los datos obligatorios.
    // No depender únicamente de finalState.step porque Gemini nunca debe pedir
    // una confirmación extra cuando los datos ya están completos.
    const directConfirm = hasAllRequiredOrderDataForDirectConfirmation(finalState);
    const confirm = shouldConfirmOrder(finalState) || directConfirm;

    if (orderData.product) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, confirm);
    }

    // ✅ REGLA CRÍTICA:
    // Si el pedido ya está completo, Gemini NO responde.
    // El backend devuelve siempre el formato fijo oficial de PEDIDO CONFIRMADO.
    if (confirm) {
      const fixedConfirmation = finalConfirmationMessage(finalState, parsed);

      return res.json({
        response: fixedConfirmation,
        context: {
          ...(context || {}),
          current_product: orderData.product || null,
          last_topic: orderData.product || context?.last_topic || null,
          last_ad_offer: orderData.locked_offer || null,
          order_data: orderData,
          order_id: orderData.order_id || null,
          payment_proof_received: orderData.payment_proof_received || false,
          step: "pedido_confirmado",
          updated_at: new Date().toISOString(),
        },
        debug: true
          ? {
              fixed_backend_confirmation: true,
              product: orderData.product,
              quantity: orderData.quantity,
              city: orderData.city,
              coverage: finalState.coverage,
              total: finalState.total,
              missing: finalState.missing,
              step: finalState.step,
              confirm,
              direct_confirm: directConfirm,
              locked_offer: orderData.locked_offer,
            }
          : undefined,
      });
    }

    if (!confirm && prevStep === "collecting_city" && orderData.city && orderData.locked_offer?.fixed_quantity) {
      const fixedCityResponse = deterministicAfterCityFixedOfferMessage(finalState, parsed);
      if (fixedCityResponse) {
        return res.json({
          response: fixedCityResponse,
          context: {
            ...(context || {}),
            current_product: orderData.product || null,
            last_topic: orderData.product || context?.last_topic || null,
            last_ad_offer: orderData.locked_offer || null,
            order_data: orderData,
            order_id: orderData.order_id || null,
            payment_proof_received: orderData.payment_proof_received || false,
            step: finalState.step,
            updated_at: new Date().toISOString(),
          },
          debug: true
            ? {
                deterministic_fixed_city_response: true,
                product: orderData.product,
                quantity: orderData.quantity,
                city: orderData.city,
                total: finalState.total,
                step: finalState.step,
                locked_offer: orderData.locked_offer,
              }
            : undefined,
        });
      }
    }

    if (!confirm && prevStep === "collecting_quantity" && qty > 0 && orderData.city) {
      const deterministicQtyResponse = deterministicAfterQuantityMessage(finalState, parsed);
      if (deterministicQtyResponse) {
        return res.json({
          response: deterministicQtyResponse,
          context: {
            ...(context || {}),
            current_product: orderData.product || null,
            last_topic: orderData.product || context?.last_topic || null,
            last_ad_offer: orderData.locked_offer || null,
            order_data: orderData,
            order_id: orderData.order_id || null,
            step: finalState.step,
            updated_at: new Date().toISOString(),
          },
          debug: true
            ? {
                deterministic_quantity_response: true,
                freshOrder,
                product: orderData.product,
                quantity: orderData.quantity,
                city: orderData.city,
                coverage: finalState.coverage,
                total: finalState.total,
                missing: finalState.missing,
                step: finalState.step,
                locked_offer: orderData.locked_offer,
              }
            : undefined,
        });
      }
    }

        const system = buildSalesSystemPrompt(parsed, finalState, templatePricing);

    const contents = (history || [])
      .slice(-12)
      .filter((h: any) => clean(h?.content))
      .map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: clean(h.content) }],
      }));

    const userPayload = `
Mensaje del cliente:
${texto || "(mensaje sin texto)"}

Respondé ahora como vendedor. Seguí la instrucción obligatoria. No inventes ciudad ni datos.
`.trim();

    contents.push({
      role: "user",
      parts: [{ text: userPayload }],
    });

    let aiResponse = await callGemini({
      apiKey,
      model,
      system,
      contents,
      temperature: iaConfig.temperature ?? 0.55,
      maxTokens: Math.max(iaConfig.max_tokens ?? 0, 2048),
    });

    if (!aiResponse) {
      aiResponse = buildFallbackResponse(parsed, finalState, templatePricing);
    }

    return res.json({
      response: postProcessResponse(aiResponse),
      context: {
        ...(context || {}),
        current_product: orderData.product || null,
        last_topic: orderData.product || context?.last_topic || null,
        last_ad_offer: orderData.locked_offer || null,
        order_data: orderData,
        order_id: orderData.order_id || null,
        payment_proof_received: (orderData as any).payment_proof_received || false,
        step: confirm ? "pedido_confirmado" : finalState.step,
        updated_at: new Date().toISOString(),
      },
      debug: true
        ? {
            freshOrder,
            parsed_products: parsed.products.length,
            parsed_cities: parsed.cities.length,
            product: orderData.product,
            quantity: orderData.quantity,
            city: orderData.city,
            coverage: finalState.coverage,
            total: finalState.total,
            missing: finalState.missing,
            step: finalState.step,
            confirm,
            direct_confirm: directConfirm,
            locked_offer: orderData.locked_offer,
            productFromMessageInitial,
            promoResponse,
          }
        : undefined,
    });
  } catch (error: any) {
    console.error("❌ chat-ia-vendedor-v3:", error);
    return res.status(500).json({
      error: error.message || "Error interno",
    });
  }
}
