import { createClient } from "@supabase/supabase-js";

/**
 * CHAT IA VENDEDOR AUTÓNOMO V65 - Mega Todo Store / One Store
 * 
 * V60 COMPLETA: integra correcciones de precio, cobertura, fechas, direcciones y carrito multiproducto.
 *
 * Mantiene el fix que evita repetir el copy cuando el cliente
 * pregunta "precio" después de ya haber visto el producto.
 * 
 * Soluciona:
 * - Cliente: "Hola. ¿Precio de las plantillas porfa?" → Muestra copy completo
 * - Cliente: "precio" → ✅ SOLO muestra precio + avanza (NO repite copy)
 * - Cliente: "precio porfa" → ✅ SOLO muestra precio + avanza (NO repite copy)
 * 
 * ✔️ Funciona con TODOS los productos del catálogo
 * ✔️ Detecta si el copy ya fue enviado en la conversación
 * ✔️ No se queda en bucle
 * ✔️ Venta fluida y natural
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
  fixedPackQuantity?: number;
  salesCopy?: string;
  images?: string[];
  palabra_clave?: string;
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
  observation?: string;
  preferred_delivery_date?: string;
  preferred_delivery_time?: string;
  payment_note?: string;
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

function encontrarProductoPorPalabraClave(mensaje: string, products: ProductItem[]): ProductItem | null {
  if (!products || products.length === 0) return null;

  const msg = normalize(mensaje);
  if (!msg) return null;

  let best: ProductItem | null = null;
  let bestScore = 0;

  for (const producto of products) {
    const candidates = [
      producto.palabra_clave || "",
      producto.product || "",
      producto.canonical || "",
      ...(producto.aliases || []),
    ]
      .flatMap((x) => splitKeywordAliases(x))
      .map(normalize)
      .filter((x) => x.length >= 3 && !isGenericProductWord(x));

    for (const c of Array.from(new Set(candidates))) {
      let score = 0;
      if (msg === c) score = 1000;
      else if (msg.includes(c)) score = 800 + c.length;
      else if (c.includes(msg) && msg.length >= 4) score = 500 + msg.length;

      if (score > bestScore) {
        bestScore = score;
        best = producto;
      }
    }
  }

  return bestScore >= 500 ? best : null;
}

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
    observation: "",
    preferred_delivery_date: "",
    preferred_delivery_time: "",
    payment_note: "",
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
  if (!m) return false;

  // Preguntas técnicas como "cuánto es el tiempo de cocción" no son precio.
  const technicalQuestion =
    /\b(tiempo|coccion|cocción|duracion|duración|minutos?|horas?|agua|cantidad de agua|temperatura|medida|capacidad|funciona|usar|uso|modo)\b/.test(m);

  const explicitPriceWord = /\b(precio|valor|costo|cuesta|cuestan|sale|vale)\b/.test(m);
  const explicitPricePhrase =
    /\b(cuanto cuesta|cuanto sale|cuanto vale|cual es el precio|que precio|precio porfa|precio por favor)\b/.test(m);

  if (technicalQuestion && !explicitPriceWord && !explicitPricePhrase) return false;

  return explicitPriceWord || explicitPricePhrase;
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
    .select("id, intent, examples, response, is_active, image_urls, products, entrenamiento_completo")
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

function normalizeProductImages(input: any): string[] {
  const rawImages: any[] = [];

  if (Array.isArray(input?.images)) rawImages.push(...input.images);
  if (Array.isArray(input?.image_urls)) rawImages.push(...input.image_urls);
  if (Array.isArray(input?.imagenes)) rawImages.push(...input.imagenes);
  if (Array.isArray(input?.media_urls)) rawImages.push(...input.media_urls);

  if (typeof input?.image === "string") rawImages.push(input.image);
  if (typeof input?.image_url === "string") rawImages.push(input.image_url);
  if (typeof input?.imagen === "string") rawImages.push(input.imagen);

  return Array.from(
    new Set(
      rawImages
        .map((u) => clean(u))
        .filter((u) => /^https?:\/\//i.test(u))
    )
  ).slice(0, 3);
}

function attachProductImages(products: ProductItem[], rawItems: any[]) {
  for (const item of rawItems) {
    const urls = normalizeProductImages({ image_urls: item?.image_urls });
    if (!urls.length) continue;

    const rowText = normalize(
      `${item?.intent || ""}\n${Array.isArray(item?.examples) ? item.examples.join("\n") : ""}\n${item?.response || ""}`
    );
    if (!rowText) continue;

    for (const product of products) {
      if (product.images?.length) continue;
      const names = [product.canonical, product.product, ...product.aliases]
        .map(normalize)
        .filter((n) => n.length >= 4);
      if (names.some((n) => rowText.includes(n))) {
        product.images = urls;
      }
    }
  }
}

function splitKeywordAliases(value: any): string[] {
  return clean(value)
    .split(/[,:;|\/\\]+/g)
    .map(clean)
    .filter(Boolean);
}

function isGenericProductLabel(value: any): boolean {
  const n = normalize(value);
  if (!n) return true;
  return (
    isGenericMarketingPhrase(n) ||
    /^(oferta(?: de)? hoy|precio de hoy|promo(?:cion)?|promocion|producto|articulo|item|stock limitado|quedan pocos|llevate \d+|\d+ por \d+)$/.test(n)
  );
}

function visualProductNameFromKeyword(keyword: string, copy: string, aliases: string[]) {
  // V65: el nombre del producto nunca puede salir de una línea comercial
  // como “Oferta HOY”. Primero intentamos recuperar un nombre descriptivo
  // real del copy y luego usamos aliases/palabra clave seguros.
  const fromCopy = extractProductNameFromCopy(copy);
  if (fromCopy && !isGenericProductLabel(fromCopy)) return toTitleCase(fromCopy);

  const aliasParts = aliases
    .flatMap((a) => splitKeywordAliases(a))
    .map(clean)
    .filter((a) => normalize(a).length >= 3 && !isGenericProductWord(a) && !isGenericProductLabel(a));

  const descriptiveAlias = aliasParts
    .slice()
    .sort((a, b) => normalize(b).length - normalize(a).length)
    .find((a) => normalize(a).split(/\s+/).length >= 2);
  if (descriptiveAlias) return toTitleCase(descriptiveAlias);

  const firstAlias = aliasParts.find(Boolean);
  if (firstAlias) return toTitleCase(firstAlias);

  const firstKeyword = splitKeywordAliases(keyword)
    .find((k) => normalize(k).length >= 3 && !isGenericProductLabel(k)) || keyword;
  return toTitleCase(firstKeyword);
}

function productsFromVisualCatalog(items: any[]): ProductItem[] {
  const result: ProductItem[] = [];
  const seen = new Set<string>();

  for (const item of items || []) {
    const list = Array.isArray(item?.products) ? item.products : [];

    for (const p of list) {
      const keyword = clean(p?.palabra_clave || p?.keyword || "");
      const copy = clean(p?.copy || p?.salesCopy || p?.mensaje || "");
      const productImages = normalizeProductImages(p);

      const aliasFrontend = Array.isArray(p?.alias)
        ? p.alias.map(clean).filter(Boolean)
        : typeof p?.alias === "string"
          ? p.alias.split(",").map(clean).filter(Boolean)
          : [];

      const aliasesBackend = Array.isArray(p?.aliases)
        ? p.aliases.map(clean).filter(Boolean)
        : typeof p?.aliases === "string"
          ? p.aliases.split(",").map(clean).filter(Boolean)
          : [];

      if (!keyword || !copy) continue;

      const keywordParts = splitKeywordAliases(keyword);
      const allAliases = Array.from(new Set([
        keyword,
        ...keywordParts,
        ...aliasFrontend,
        ...aliasesBackend,
      ].map(clean).filter(Boolean)));

      const canonical = visualProductNameFromKeyword(keyword, copy, allAliases);
      const key = normalize(`${canonical}|${keyword}|${productImages.join("|")}`);
      if (seen.has(key)) continue;
      seen.add(key);

      const { offers, fixedQuantity } = parseRawOffers(copy, canonical);
      const sortedOffers = offers.slice().sort((a, b) => a.quantity - b.quantity);
      const price1 = sortedOffers.find((o) => o.quantity === 1)?.total || sortedOffers[0]?.total || 1;
      const price2 = fixedQuantity ? undefined : sortedOffers.find((o) => o.quantity === 2)?.total;
      const price3 = fixedQuantity ? undefined : sortedOffers.find((o) => o.quantity === 3)?.total;
      const fixedPackQuantity = fixedQuantity
        ? (sortedOffers.find((o) => o.fixed_quantity)?.quantity || sortedOffers[0]?.quantity || undefined)
        : undefined;

      result.push({
        product: canonical,
        canonical,
        aliases: allAliases,
        price1,
        price2,
        price3,
        fixedPackQuantity,
        salesCopy: copy,
        images: productImages,
        palabra_clave: keyword,
      });
    }
  }

  return result;
}

function normalizeCopyForDedup(copy: string) {
  return normalize(copy).slice(0, 220);
}

function mergeProductsByPriority(primary: ProductItem[], secondary: ProductItem[]) {
  const merged: ProductItem[] = [];
  const seenKeys = new Set<string>();
  const seenCopies: string[] = [];

  const isDuplicateCopy = (copyNorm: string) => {
    if (!copyNorm) return false;
    return seenCopies.some(
      (c) => c && (c === copyNorm || c.includes(copyNorm) || copyNorm.includes(c))
    );
  };

  for (const product of [...primary, ...secondary]) {
    const names = [product.palabra_clave, product.canonical, product.product, ...(product.aliases || [])]
      .flatMap((x) => splitKeywordAliases(x || ""))
      .map(normalize)
      .filter(Boolean);

    const key = names.find((n) => n.length >= 3) || normalize(product.canonical || product.product);
    const copyNorm = normalizeCopyForDedup(product.salesCopy || "");

    if (key && seenKeys.has(key)) continue;
    if (copyNorm.length >= 40 && isDuplicateCopy(copyNorm)) continue;

    if (key) seenKeys.add(key);
    if (copyNorm.length >= 40) seenCopies.push(copyNorm);
    merged.push(product);
  }

  return merged;
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
  const explicitBlock =
    training.match(/(?:^|\n)\s*(?:DATOS_BANCARIOS|DATOS_TRANSFERENCIA|DATOS PARA TRANSFERENCIA|DATOS DE TRANSFERENCIA)\s*:?\s*\n([\s\S]*?)(?=\n\s*(?:FIN_DATOS_BANCARIOS|FIN_DATOS_TRANSFERENCIA|CATALOGO_PRODUCTOS|LISTA COMPLETA POR CIUDAD|ZONAS CON COBERTURA|ZONAS SIN COBERTURA|---)|$)/i)?.[1] || "";

  const raw = clean(explicitBlock || training);
  if (!raw) return null;

  const dangerousValue = (v: string) => {
    const n = normalize(v);
    return (
      !v ||
      v.length > 120 ||
      v.includes("→") ||
      /\b(ciudad del este|cde|cdad del este|zona|zonas|cobertura|asuncion|asunción|san lorenzo|luque|chaco)\b/.test(n)
    );
  };

  const lines = raw
    .split(/\r?\n/g)
    .map((line) => clean(line.replace(/^[^a-zA-ZÁÉÍÓÚáéíóúÑñ0-9#°Nn]+/, "")))
    .filter(Boolean);

  const getLine = (patterns: RegExp[], validator?: (v: string) => string) => {
    for (const line of lines) {
      for (const pattern of patterns) {
        const m = line.match(pattern);
        if (!m?.[1]) continue;
        const value = clean(m[1]);
        const finalValue = validator ? validator(value) : value;
        if (finalValue && !dangerousValue(finalValue)) return finalValue;
      }
    }
    return "";
  };

  const onlyDigitsValue = (v: string) => {
    const m = clean(v).match(/\d[\d.\-\s]{3,}/);
    return m ? clean(m[0]) : "";
  };

  const normalBankValue = (v: string) => {
    const value = clean(v).replace(/\s+/g, " ");
    return dangerousValue(value) ? "" : value;
  };

  const titular = getLine([/^Titular\s*[:\-]\s*(.+)$/i], normalBankValue);
  const ci = getLine([/^(?:CI|Cédula|Cedula)\s*[:\-]\s*(.+)$/i], onlyDigitsValue);
  const entidad = getLine([/^Entidad\s*[:\-]\s*(.+)$/i], normalBankValue);
  const banco = getLine([/^Banco\s*[:\-]\s*(.+)$/i], normalBankValue);
  let cuenta = getLine([
    /^(?:N[°ºo]?\s*de\s*cuenta|Nro\.?\s*de\s*cuenta|Numero\s*de\s*cuenta|Número\s*de\s*cuenta|Cuenta)\s*[:\-]\s*(.+)$/i,
  ], normalBankValue);
  const alias = getLine([/^Alias\s*[:\-]\s*(.+)$/i], normalBankValue);

  if (cuenta && banco && normalize(cuenta).startsWith(normalize(banco))) {
    const safeBank = banco.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cuenta = clean(cuenta.replace(new RegExp(`^${safeBank}\\s*:?\\s*`, "i"), ""));
  }

  const parsed: BankData = { titular, ci, entidad, banco, cuenta, alias, raw: explicitBlock ? clean(explicitBlock) : "" };
  const hasUsefulData = !!(parsed.titular || parsed.ci || parsed.entidad || parsed.banco || parsed.cuenta || parsed.alias);
  return hasUsefulData ? parsed : null;
}

function isGenericMarketingPhrase(normCanonical: string) {
  const words = normCanonical.split(" ").filter(Boolean);
  const genericWords = new Set([
    "oferta", "ofertas", "promo", "promos", "promocion", "promoción",
    "descuento", "descuentos", "gratis", "hoy", "ahora", "antes",
    "stock", "limitado", "limitada", "envio", "envío", "delivery",
    "pagas", "pagás", "recibir", "unidad", "unidades", "solo",
    "solamente", "precio", "precios", "valido", "válido", "valida", "válida",
  ]);
  return words.length > 0 && words.every((w) => genericWords.has(w));
}

function extractProductNameFromCopy(text: string): string {
  const raw = clean(text);
  if (!raw) return "";

  const accept = (value: any) => {
    const candidate = clean(value).replace(/^[^a-zA-ZÁÉÍÓÚáéíóúÑñ0-9]+/, "").replace(/[.,:;!?]+$/, "");
    if (!candidate || isGenericProductLabel(candidate)) return "";
    const words = candidate.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 10) return "";
    return toTitleCase(candidate);
  };

  // Ej.: “Con el Procesador de Alimentos Premium RAF PRO® preparás...”
  const introPatterns = [
    /\bcon\s+(?:el|la|los|las)\s+(.{3,100}?)(?=\s+(?:preparas|preparás|podes|podés|vas a|te permite|permite|ideal para|logras|lográs|conseguis|conseguís)\b)/i,
    /\b(?:este|esta|el|la)\s+(.{3,90}?)(?=\s+(?:sirve|ayuda|permite|es ideal|cuenta con|tiene)\b)/i,
    /^\s*([^\n]{3,90}?)(?:\s*[–—-]\s*|\n)/,
  ];
  for (const pattern of introPatterns) {
    const candidate = accept(raw.match(pattern)?.[1]);
    if (candidate) return candidate;
  }

  const simpleQtyName = raw.match(/^\s*\d+\s+([A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñÑ]{2,30})s?\s*:\s*(?:Gs\.?|₲)?\s*\d/im);
  const simpleCandidate = accept(simpleQtyName?.[1]);
  if (simpleCandidate) return simpleCandidate;

  const afterQty = raw.match(
    /\b\d+\s+((?:[A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñ®'’.]*\s*){1,5})\s*(?:por|a|solo|solamente)\s+(?:solo\s+)?(?:[Gg][Ss]\.?)?\s*\d/
  );
  const qtyCandidate = accept(afterQty?.[1]);
  if (qtyCandidate) return qtyCandidate;

  const lines = raw.split(/\n|[!?.]\s+/).map(clean).filter(Boolean);
  for (const line of lines) {
    if (/\b(oferta|promo|precio|antes|hoy|stock|quedan|llevate|llevá|gs)\b/i.test(normalize(line))) continue;
    const title = line.match(/(?:^|\b)([A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñ®'’.]+(?:\s+(?:de|del|para|con|y|en|Premium|Pro|PRO|RAF|[A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñ®'’.]+)){1,8})/);
    const candidate = accept(title?.[1]);
    if (candidate) return candidate;
  }

  return "";
}
function autoDetectProductsFromTraining(_training: string, _existing: ProductItem[]): ProductItem[] {
  return [];
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
    const packFijoRaw = Number(clean(block.match(/^PACK_FIJO:\s*(\d+)/im)?.[1]) || 0);
    const fixedPackQuantity = packFijoRaw > 1 ? packFijoRaw : undefined;
    
    const palabraClave = clean(block.match(/^PALABRA_CLAVE:\s*(.+)$/im)?.[1]);

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
        palabra_clave: palabraClave || undefined,
      });
    }
  }

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

  // V62: ciudades metropolitanas críticas como respaldo.
  // Evita que una variación en el formato del entrenamiento deje a Asunción
  // fuera de parsed.cities y active transportadora por error.
  const fallbackCoveredCities: Array<[string, string]> = [
    ["Asunción", "Asunción"],
    ["Asuncion", "Asunción"],
    ["Asu", "Asunción"],
    ["Fernando de la Mora", "Fernando de la Mora"],
    ["Fdo de la Mora", "Fernando de la Mora"],
    ["Fndo de la Mora", "Fernando de la Mora"],
    ["San Lorenzo", "San Lorenzo"],
    ["Luque", "Luque"],
    ["Lambaré", "Lambaré"],
    ["Lambare", "Lambaré"],
    ["Mariano Roque Alonso", "Mariano Roque Alonso"],
    ["MRA", "Mariano Roque Alonso"],
  ];

  for (const [alias, canonical] of fallbackCoveredCities) addCity(alias, canonical);

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


function detectProductsMentioned(text: string, parsed: ParsedTraining): ProductItem[] {
  const msg = normalize(text);
  if (!msg) return [];

  const found: ProductItem[] = [];
  const seen = new Set<string>();

  for (const product of parsed.products || []) {
    const candidates = [
      product.palabra_clave || "",
      product.product || "",
      product.canonical || "",
      ...(product.aliases || []),
    ]
      .flatMap((value) => splitKeywordAliases(value))
      .map(normalize)
      .filter((value) => value.length >= 4 && !isGenericProductWord(value));

    const matches = Array.from(new Set(candidates)).some((candidate) => {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(msg);
    });

    if (!matches) continue;

    const key = normalize(product.canonical || product.product);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    found.push(product);
  }

  return found;
}

function buildMultipleProductsClarification(products: ProductItem[], currentCity: string): string {
  const names = products.map((p) => p.canonical || p.product).filter(Boolean);
  if (names.length < 2) return "";

  const joined = names.length === 2
    ? `${names[0]} y ${names[1]}`
    : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;

  return `¡Perfecto! Podemos prepararte ${joined}. 😊\n\nPara registrar correctamente las cantidades, decime cuántas unidades querés de cada producto.\n\nEjemplo: “1 ${names[0]} y 1 ${names[1]}”.${currentCity ? `\n\n📍 Mantengo la ciudad de envío: ${currentCity}.` : ""}`;
}


type MultiCartItem = {
  product: string;
  quantity: number;
  unit_price: number;
  total: number;
};

function getMultiCartFromContext(context: any, parsed: ParsedTraining): MultiCartItem[] {
  const raw = Array.isArray(context?.multi_product_cart) ? context.multi_product_cart : [];
  const result: MultiCartItem[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const info = getProductInfo(item?.product || "", parsed);
    if (!info) continue;
    const key = normalize(info.canonical);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const quantity = sanitizeQuantity(item?.quantity || 0);
    const total = quantity > 0 ? calculateTotal(info.canonical, quantity, parsed, null) : 0;
    result.push({
      product: info.canonical,
      quantity,
      unit_price: info.price1 || 0,
      total,
    });
  }

  return result;
}

function createMultiCart(products: ProductItem[]): MultiCartItem[] {
  return products.map((p) => ({
    product: p.canonical,
    quantity: 0,
    unit_price: p.price1 || 0,
    total: 0,
  }));
}

function productOffersText(product: ProductItem): string {
  const offers: string[] = [];
  if (product.fixedPackQuantity && product.price1) {
    offers.push(`🔥 ${product.fixedPackQuantity} unidades: ${formatGs(product.price1)} Gs`);
  } else {
    if (product.price1) offers.push(`🔥 1 unidad: ${formatGs(product.price1)} Gs`);
    if (product.price2) offers.push(`🔥 2 unidades: ${formatGs(product.price2)} Gs`);
    if (product.price3) offers.push(`🔥 3 unidades: ${formatGs(product.price3)} Gs`);
  }
  return offers.join("\n");
}

function shortProductBenefit(product: ProductItem): string {
  const raw = clean(product.salesCopy || "");
  if (!raw) return "Disponible para agregar al mismo pedido.";

  const lines = raw
    .split(/\r?\n/g)
    .map((line) => clean(line.replace(/^[^a-zA-ZÁÉÍÓÚáéíóúÑñ0-9]+/, "")))
    .filter(Boolean)
    .filter((line) => {
      const n = normalize(line);
      if (/\b(gs|precio|oferta|antes|hoy|stock|envio|envío|delivery|whatsapp|escribi|escribí|pedi|pedí)\b/.test(n)) return false;
      if (/^\d+\s*(?:unidad|unidades|par|pares)?\b/.test(n)) return false;
      return line.length >= 18;
    });

  const preferred = lines.find((line) => /\b(ideal|ayuda|sirve|permite|pica|pela|afila|absorbe|reduce|limpia|protege|alivia|procesa|tritura)\b/i.test(normalize(line))) || lines[0];
  if (!preferred) return "Disponible para agregar al mismo pedido.";

  const sentence = preferred.replace(/[.!?]+$/, "");
  return sentence.length > 105 ? `${sentence.slice(0, 102).trim()}...` : `${sentence}.`;
}

function buildMultipleProductsInformation(products: ProductItem[], currentCity: string): string {
  const sections = products.map((p) => {
    return `📦 *${p.canonical}*\n${shortProductBenefit(p)}\n${productOffersText(p)}`;
  });

  const examples = products.map((p) => `1 ${p.canonical}`).join(" y ");
  return `¡Claro! Tenemos estos productos disponibles 😊\n\n${sections.join("\n\n")}\n\n🛒 Podés llevarlos en un solo pedido.\n¿Cuántos querés de cada uno?\nEjemplo: “${examples}”.${currentCity ? `\n\n📍 Envío a: ${currentCity}.` : ""}`;
}

function extractQuantityForNamedProduct(text: string, product: ProductItem): number {
  const n = normalize(text);
  if (!n) return 0;

  const aliases = [product.canonical, product.product, product.palabra_clave || "", ...(product.aliases || [])]
    .flatMap((v) => splitKeywordAliases(v))
    .map(normalize)
    .filter((v) => v.length >= 3 && !isGenericProductWord(v))
    .sort((a, b) => b.length - a.length);

  for (const alias of Array.from(new Set(aliases))) {
    const e = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = n.match(new RegExp(`\\b(\\d{1,3}|un|uno|una|dos|tres|cuatro|cinco)\\s+(?:unidad(?:es)?\\s+de\\s+)?${e}\\b`, "i"));
    const after = n.match(new RegExp(`\\b${e}\\s*[:x-]?\\s*(\\d{1,3}|un|uno|una|dos|tres|cuatro|cinco)\\b`, "i"));
    const token = before?.[1] || after?.[1];
    if (!token) continue;
    const words: Record<string, number> = { un:1, uno:1, una:1, dos:2, tres:3, cuatro:4, cinco:5 };
    return sanitizeQuantity(words[normalize(token)] || Number(token));
  }
  return 0;
}

function applyQuantitiesToMultiCart(text: string, cart: MultiCartItem[], parsed: ParsedTraining): MultiCartItem[] {
  const updated = cart.map((item) => ({ ...item }));
  for (const item of updated) {
    const info = getProductInfo(item.product, parsed);
    if (!info) continue;
    const quantity = extractQuantityForNamedProduct(text, info);
    if (quantity > 0) {
      item.quantity = quantity;
      item.total = calculateTotal(info.canonical, quantity, parsed, null);
      item.unit_price = info.price1 || 0;
    }
  }

  // Si queda un solo producto sin cantidad y el mensaje es únicamente una cantidad,
  // se asigna a ese producto pendiente.
  const pending = updated.filter((i) => i.quantity <= 0);
  const genericQty = extractQuantity(text);
  if (pending.length === 1 && genericQty > 0) {
    const info = getProductInfo(pending[0].product, parsed);
    if (info) {
      pending[0].quantity = genericQty;
      pending[0].total = calculateTotal(info.canonical, genericQty, parsed, null);
      pending[0].unit_price = info.price1 || 0;
    }
  }

  return updated;
}

function multiCartSummary(cart: MultiCartItem[]) {
  const lines = cart.map((item) => `📦 ${item.product}\n🔢 Cantidad: ${item.quantity}\n💰 Subtotal: ${formatGs(item.total)} Gs`);
  const total = cart.reduce((sum, item) => sum + Number(item.total || 0), 0);
  return `${lines.join("\n\n")}\n\n💵 Total del pedido: ${formatGs(total)} Gs`;
}

function multiCartMissingQuantities(cart: MultiCartItem[]) {
  return cart.filter((i) => i.quantity <= 0).map((i) => i.product);
}

async function saveMultiProductOrders(
  userId: string,
  fromNumber: string,
  cart: MultiCartItem[],
  common: OrderData,
  parsed: ParsedTraining,
  groupId: string
) {
  for (let index = 0; index < cart.length; index++) {
    const item = cart[index];
    const child: OrderData = {
      ...common,
      order_id: `${groupId}-${index + 1}`,
      product: item.product,
      quantity: item.quantity,
      locked_offer: null,
      observation: mergeUniqueText(common.observation, `Pedido multiproducto ${groupId}`),
    };
    await safeUpsertOrder(userId, fromNumber, child, parsed, true);
  }
}

function detectProductStrict(text: string, parsed: ParsedTraining): string {
  const msg = normalize(text);
  if (!msg) return "";

  let best: ProductItem | null = null;
  let bestScore = 0;

  for (const p of parsed.products) {
    for (const alias of p.aliases) {
      const a = normalize(alias);
      if (!a || a.length < 3) continue;

      const aliasWordCount = a.split(/\s+/).filter(Boolean).length;
      let score = 0;

      if (msg === a) {
        score = 1000;
      } else if (aliasWordCount >= 2 && msg.includes(a)) {
        score = 900;
      } else if (aliasWordCount >= 2 && a.includes(msg) && msg.length >= 4) {
        score = 850;
      }

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }

  return bestScore >= 850 && best ? best.canonical : "";
}

function isPlausibleOfferForProduct(offer: OfferItem | null | undefined, product: ProductItem | null | undefined): boolean {
  if (!offer || !product) return false;

  const copy = normalize(product.salesCopy || "");
  if (!copy) return true;

  if (offer.fixed_quantity) {
    const qtyStr = String(offer.quantity);
    const totalDigits = String(offer.total || "").replace(/\D/g, "");

    const qtyMentioned = new RegExp(`\\b${qtyStr}\\b`).test(copy);
    const totalMentioned = totalDigits.length >= 4 && copy.includes(totalDigits);

    if (!qtyMentioned && !totalMentioned) return false;
  }

  return true;
}

function isQuestionLikeMessage(text: string) {
  const raw = clean(text);
  const n = normalize(raw);
  if (!n) return false;

  return (
    /[?¿]/.test(raw) ||
    /\b(?:pero\s+)?(?:de\s+)?d(?:o|oi|ó)nde\s+son(?:\s+ustedes)?\b/.test(n) ||
    /\b(donde estan|donde queda|donde se encuentran|quienes son|como funciona|como se usa|como es|que incluye|que trae|cuanto tarda|cuando llega|tienen garantia|hay garantia|es original|hacen envios|envian|aceptan transferencia|como pago|formas de pago|puedo pagar|tienen local|tienen tienda|tienen sucursal)\b/.test(n) ||
    /^(que|como|cuando|donde|por que|porque|cual|cuales|quien|quienes|cuanto|cuantos|cuanta|cuantas)\b/.test(n) ||
    /\b(?:seria|sería)\s+(?:cuanto|cuánto|cuantos|cuántos)\b/.test(n) ||
    /\b(?:es|seria|sería)\s+por\s+(?:calce|calse|talle|talla|par)\b/.test(n)
  );
}


function isAmbiguousProductRejection(text: string, currentProduct: string): boolean {
  const n = normalize(text);
  if (!n || !currentProduct) return false;
  return /\b(no estoy interesad[oa]|ya no quiero|no me interesa|no quiero)\b/.test(n);
}

function buildDeterministicBusinessQuestionResponse(text: string, state: ConversationState) {
  const n = normalize(text);
  if (!n) return "";

  if (isAmbiguousProductRejection(text, state.order.product || "")) {
    return `Entiendo 😊 Solo para confirmar: ¿ya no querés continuar con ${state.order.product}?`;
  }

  if (isDeliveryCostQuestion(text)) {
    return buildDeliveryCostResponse(state);
  }

  if (isPaymentInformationQuestion(text)) {
    let continuation = "";
    if (!state.order.city) continuation = "📍 ¿Para qué ciudad sería el envío?";
    else if (!state.order.quantity && !state.order.locked_offer?.fixed_quantity) continuation = "¿Cuántas unidades querés llevar?";
    else if (!state.order.customer_name) continuation = "Para continuar, pasame tu nombre y apellido.";
    else if (!state.order.address) continuation = "Ahora pasame la dirección exacta o ubicación.";
    else if (!state.order.phone) continuation = "Por último, pasame tu número de celular.";

    return `💵 Podés pagar en efectivo o por transferencia al delivery cuando recibís tu pedido. 😊${continuation ? `\n\n${continuation}` : ""}`;
  }

  const asksOrigin =
    /\b(?:pero\s+)?(?:de\s+)?d(?:o|oi|ó)nde\s+son(?:\s+ustedes)?\b/.test(n) ||
    /\bde que ciudad son\b/.test(n) ||
    /\bubicacion de ustedes\b/.test(n);

  if (!asksOrigin) return "";

  let continuation = "";
  if (!state.order.city) {
    continuation = "📍 ¿Para qué ciudad sería el envío?";
  } else if (!state.order.quantity && !state.order.locked_offer?.fixed_quantity) {
    continuation = "¿Cuántas unidades querés llevar?";
  } else if (!state.order.customer_name) {
    continuation = "Para continuar, pasame tu nombre y apellido.";
  } else if (state.coverage !== false && !state.order.address) {
    continuation = "Ahora pasame la dirección exacta o ubicación para la entrega.";
  }

  return `Somos de Asunción y hacemos envíos a todo el país. 😊${continuation ? `\n\n${continuation}` : ""}`;
}

function exactKnownCity(text: string, parsed: ParsedTraining): string {
  const n = normalize(text);
  if (!n) return "";

  const hardExact: Record<string, string> = {
    asuncion: "Asunción",
    asu: "Asunción",
    "fernando de la mora": "Fernando de la Mora",
    "fdo de la mora": "Fernando de la Mora",
    "fndo de la mora": "Fernando de la Mora",
    "san lorenzo": "San Lorenzo",
    luque: "Luque",
    lambare: "Lambaré",
    "mariano roque alonso": "Mariano Roque Alonso",
    mra: "Mariano Roque Alonso",
  };
  if (hardExact[n]) return hardExact[n];

  const found = parsed.cities.find((c) => {
    const alias = normalize(c.alias);
    const canonical = normalize(c.canonical);
    return n === alias || n === canonical;
  });

  return found?.canonical || "";
}

function isClearlyNotCityMessage(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!n) return true;

  // Confirmaciones, negaciones y respuestas conversacionales nunca son ciudades.
  if (/^(si|sii|siii|sip|ok|dale|listo|correcto|exacto|no|nop|gracias|perfecto)$/i.test(n)) return true;

  // Preguntas escritas sin signos o con errores frecuentes.
  if (/\b(seria|sería|cuanto|cuánto|cuantos|cuántos|precio|costo|valor|sale|cuesta)\b/.test(n)) return true;

  // Cantidades, teléfonos, números de casa, talles y calces.
  if (extractQuantity(raw) > 0 || extractPhone(raw)) return true;
  if (/\b(nro|numero|número|talle|talla|calce|calse|medida|par|pares)\b/.test(n)) return true;
  if (/\d/.test(raw) && !/^\s*[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+\s*$/.test(raw)) return true;

  // Direcciones, ubicaciones y referencias no deben reemplazar una ciudad ya capturada.
  if (/\b(calle|avda|avenida|ruta|km|barrio|bsrrio|bario|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote|edificio|piso|departamento|dpto|referencia|ubicacion|ubicación|direccion|dirección)\b/.test(n)) return true;
  if (/maps\.app|google\.com\/maps/i.test(raw)) return true;

  // Frases normales del proceso comercial que no son localidades.
  if (/^(es|seria|sería|quiero|necesito|prefiero|puede|podria|podría|tengo|uso|calzo|mi talle)\b/.test(n)) return true;

  return false;
}

function isPlausibleBareCityCandidate(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || isClearlyNotCityMessage(raw) || isQuestionLikeMessage(raw)) return false;
  if (isTemporalDeliveryExpression(raw)) return false;
  if (detectProductsMentioned && false) return false; // referencia intencionalmente inactiva; el catálogo se valida en detectCity.

  const words = n.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  if (!/^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(raw)) return false;
  if (raw.length < 3 || raw.length > 60) return false;
  return true;
}


function canonicalizeStoredCity(value: string, parsed: ParsedTraining): string {
  const raw = clean(value);
  const n = normalize(raw);
  if (!raw || !n) return "";

  // Primero corrige valores contaminados guardados en contexto, por ejemplo:
  // "Asuncion Roberto Lpetti El" -> "Asunción".
  const hardKnownCities: Array<[RegExp, string]> = [
    [/\b(asuncion|asu)\b/i, "Asunción"],
    [/\b(fernando de la mora|fdo de la mora|fndo de la mora|fdo dela mora|fndo dela mora)\b/i, "Fernando de la Mora"],
    [/\bsan lorenzo\b/i, "San Lorenzo"],
    [/\bluque\b/i, "Luque"],
    [/\b(lambare)\b/i, "Lambaré"],
    [/\b(mariano roque alonso|mra)\b/i, "Mariano Roque Alonso"],
  ];

  for (const [pattern, canonical] of hardKnownCities) {
    if (pattern.test(n)) return canonical;
  }

  const ordered = [...(parsed.cities || [])].sort(
    (a, b) => Math.max(normalize(b.alias).length, normalize(b.canonical).length) - Math.max(normalize(a.alias).length, normalize(a.canonical).length)
  );

  for (const city of ordered) {
    for (const alias of Array.from(new Set([city.alias, city.canonical].map(normalize).filter(Boolean)))) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(n)) return city.canonical;
    }
  }

  return raw;
}

function detectCity(text: string, parsed: ParsedTraining, prev?: string) {
  const exactCity = exactKnownCity(text, parsed);
  if (exactCity) return exactCity;

  const explicitKnownCity = extractExplicitKnownCityFromSentence(text, parsed);
  if (explicitKnownCity) return explicitKnownCity;

  // V56: preguntas, cantidades, direcciones, talles y respuestas como “sí”
  // nunca pueden convertirse en una localidad inferida.
  if (isClearlyNotCityMessage(text)) return clean(prev || "");

  // V53: un mensaje que menciona un producto nunca puede convertirse en ciudad.
  // Ej.: "el plumero y el pela papa" no debe coincidir de forma difusa con
  // "Colonia Yguazú" ni con ninguna otra localidad del entrenamiento.
  if (detectProductsMentioned(text, parsed).length > 0) {
    return clean(prev || "");
  }

  const explicitCityStatement = extractCityStatement(text);
  if (isQuestionLikeMessage(text) && !explicitCityStatement) {
    return clean(prev || "");
  }

  const rawMsg = normalize(text);
  const statementCity = explicitCityStatement;
  const msg = normalize(statementCity || text);

  if (!msg && !rawMsg) return clean(prev || "");

  let best = "";
  let bestScore = 0;
  const msgWords = msg.split(/\s+/).filter(Boolean);
  const rawWords = rawMsg.split(/\s+/).filter(Boolean);

  for (const c of parsed.cities) {
    const a = normalize(c.alias);
    const cn = normalize(c.canonical);
    if (!a || a.length < 2) continue;

    let score = 0;

    if (msg === a || msg === cn) score += 120;
    else if (rawMsg === a || rawMsg === cn) score += 115;

    if (msg.includes(a)) score += 95;
    if (rawMsg.includes(a)) score += 90;
    if (cn && msg.includes(cn)) score += 95;
    if (cn && rawMsg.includes(cn)) score += 90;

    if (a.includes(msg) && msg.length >= 3) score += 70;
    if (cn && cn.includes(msg) && msg.length >= 3) score += 70;

    const aliasWords = a.split(/\s+/).filter((w) => w.length >= 3);
    const canonicalWords = cn.split(/\s+/).filter((w) => w.length >= 3);
    const wordsToCheck = Array.from(new Set([...aliasWords, ...canonicalWords]));

    if (wordsToCheck.length >= 2) {
      const matchedMsg = wordsToCheck.filter((w) =>
        msgWords.some((mw) => mw === w || mw.startsWith(w) || w.startsWith(mw))
      );

      const matchedRaw = wordsToCheck.filter((w) =>
        rawWords.some((mw) => mw === w || mw.startsWith(w) || w.startsWith(mw))
      );

      const matched = matchedMsg.length >= matchedRaw.length ? matchedMsg : matchedRaw;

      if (matched.length >= Math.ceil(wordsToCheck.length * 0.65)) {
        score += 65 + matched.length * 8;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = c.canonical;
    }
  }

  if (bestScore >= 50) return best;

  if (statementCity && isPlausibleBareCityCandidate(statementCity)) return toTitleCase(statementCity);

  return clean(prev || "");
}

function hasCoverage(city: string, parsed: ParsedTraining) {
  const c = normalize(city);
  if (!c) return false;

  const hardCovered = new Set([
    "asuncion",
    "fernando de la mora",
    "san lorenzo",
    "luque",
    "lambare",
    "mariano roque alonso",
  ]);
  if (hardCovered.has(c)) return true;

  // La cobertura debe depender de una coincidencia EXACTA con una ciudad o
  // alias configurado. Las coincidencias parciales generaban falsos positivos:
  // por ejemplo, una localidad no habilitada podía coincidir por una sola
  // palabra con otra zona del entrenamiento.
  return parsed.cities.some((x) => {
    const a = normalize(x.alias);
    const cn = normalize(x.canonical);
    return c === a || c === cn;
  });
}

function isTemporalDeliveryExpression(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /\b(hoy|manana|mañana|pasado manana|pasado mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|fin de semana|quincena|fin de mes|principio de mes|inicio de mes|proximo mes|próximo mes|mes que viene)\b/.test(n) ||
    /\b(?:para|el|este|proximo|próximo)\s+(?:el\s+)?(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/.test(n) ||
    /\b(?:a|para|hasta|desde)\s+(?:fin|fines|principio|inicio)\s+de\s+(?:mes|semana)\b/.test(n) ||
    /\b(?:a las|desde las|hasta las|despues de|después de|antes de)\s+\d{1,2}(?::\d{2})?\s*(?:hs|hrs|am|pm)?\b/.test(n) ||
    /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(n) ||
    /\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/.test(n)
  );
}

function extractCityStatement(text: string): string {
  const raw = clean(text);
  const norm = normalize(raw);

  if (!raw || raw.length < 3 || /^[\p{Emoji}\s]+$/u.test(raw)) return "";
  if (/^\p{Emoji}/u.test(raw)) return "";

  const onlyGreeting =
    /^(hola|holaa|ola|buenas|buenos dias|buenos días|buen dia|buen día|hi|hey|buenas noches|buenas tardes|saludos|ok|dale|si|sí|no|gracias|de nada|listo|perfecto)[\s!.]*$/i;

  if (onlyGreeting.test(norm)) return "";

  // Una fecha u horario de entrega nunca debe convertirse en ciudad.
  // Ej.: "quiero para fin de mes", "puede ser para el sábado".
  if (isTemporalDeliveryExpression(norm)) return "";

  // La validación contra productos se realiza también en detectCity, donde
  // está disponible el catálogo completo. Aquí bloqueamos coordinaciones
  // evidentes de artículos para que el patrón genérico "para ..." no las tome.
  if (/\b(y|con|ademas|además)\b/.test(norm) && /\b(quiero|llevo|producto|productos|unidad|unidades)\b/.test(norm)) return "";

  const patterns: RegExp[] = [
    /\bsoy\s+de\s+la\s+ciudad\s+de\s+(.+)$/i,
    /\bsoy\s+de\s+(.+)$/i,
    /\bsoi\s+de\s+(.+)$/i,
    /\bsoy\s+d\s+(.+)$/i,
    /\bvivo\s+en\s+(.+)$/i,
    /\bestoy\s+en\s+(.+)$/i,
    /\bya\s+estoy\s+en\s+(.+)$/i,
    /\bde\s+la\s+ciudad\s+de\s+(.+)$/i,
    /\bciudad\s+de\s+(.+)$/i,
    /\bmi\s+ciudad\s+(?:es|seria|sería)\s+(.+)$/i,
    /^(.+?)\s+(?:es|seria|sería)\s+mi\s+ciudad$/i,
    /\bpara\s+la\s+ciudad\s+de\s+(.+)$/i,
    /\b(?:quiero|necesito|seria|sería)\s+para\s+(.+)$/i,
    /\bpara\s+env[ií]o\s+a\s+(.+)$/i,
    /\bpara\s+enviar\s+a\s+(.+)$/i,
    /\benv[ií]o\s+a\s+(.+)$/i,
    /\bdelivery\s+a\s+(.+)$/i,
    /\bpara\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = norm.match(pattern);
    if (!match?.[1]) continue;

    let candidate = clean(match[1]);

    candidate = candidate
      .replace(/\b(quiero|qiero|kiero|me interesa|precio|cuanto|cuánto|consulta|comprar|compro|llevo|delivery|envio|envío|por favor|xfa|porfa|gracias|y quiero|y necesito|necesito|del producto|la crema|el producto)\b.*$/gi, "")
      .replace(/\b(mi nombre es|me llamo|soy)\b.*$/gi, "")
      .replace(/\b(09\d{6,}|5959\d{6,}|\+5959\d{6,})\b.*$/gi, "")
      .replace(/[.,!?;:]+$/g, "")
      .trim();

    const words = normalize(candidate).split(/\s+/).filter(Boolean);

    if (
      candidate.length >= 3 &&
      words.length <= 5 &&
      !/^\d+$/.test(candidate) &&
      !isTemporalDeliveryExpression(candidate) &&
      !looksLikeSentenceNotCity(candidate)
    ) {
      return candidate;
    }
  }

  return "";
}

function extractQuantity(text: string) {
  const m = normalize(text);
  if (!m) return 0;

  const wordMap: Record<string, number> = {
    un: 1,
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

  if (/^(?:09\d{6,}|5959\d{6,}|\+5959\d{6,})$/.test(clean(text))) return 0;

  const onlyNumber = m.match(/^(\d{1,3})\s*(?:unidad|unidades|u|und|unds|pieza|piezas)?$/);
  if (onlyNumber && !m.startsWith("09")) return sanitizeQuantity(Number(onlyNumber[1]));

  const q1 = m.match(/\b(\d{1,3})\s*(unidad|unidades|u|und|unds|piezas|pieza)\b/);
  if (q1 && !q1[1].startsWith("09")) return sanitizeQuantity(Number(q1[1]));

  const q2 = m.match(/\b(quiero|kiero|qiero|llevo|dame|mandame|mándame|reservame|resérvame|solo|solamente|serian|serían|seria|sería|quiero llevar|voy a llevar|me llevo)\s+(\d{1,3})\b/);
  if (q2) return sanitizeQuantity(Number(q2[2]));

  const q3 = m.match(/\b(\d{1,3})\s+(quiero|llevo|dame|mandame|mándame|seria|sería|serian|serían)\b/);
  if (q3 && !q3[1].startsWith("09")) return sanitizeQuantity(Number(q3[1]));

  for (const [word, num] of Object.entries(wordMap)) {
    const unitRegex = new RegExp(`\\b${word}\\s*(unidad|unidades|u\\b|und\\b|unds\\b|piezas|pieza|producto|productos|crema|cremas|item|items|ítem|ítems)\\b`);
    if (unitRegex.test(m)) return sanitizeQuantity(num);
  }

  for (const [word, num] of Object.entries(wordMap)) {
    const intentWordRegex = new RegExp(`\\b(quiero|kiero|qiero|llevo|dame|mandame|mándame|reservame|resérvame|solo|solamente|seria|sería|serian|serían|quiero llevar|voy a llevar|me llevo|pasame|pásame|envíame|enviame)\\s+${word}\\b`);
    if (intentWordRegex.test(m)) return sanitizeQuantity(num);
  }

  for (const [word, num] of Object.entries(wordMap)) {
    const casualRegex = new RegExp(`\\b(?:solo\\s+|solamente\\s+)?${word}\\s*(?:nomas|nomás|no mas|no más)?\\b`);
    if (casualRegex.test(m)) return sanitizeQuantity(num);
  }

  if (m.split(/\s+/).length <= 2) {
    for (const [word, num] of Object.entries(wordMap)) {
      if (new RegExp(`^${word}(?:\\s+(?:nomas|nomás|no mas|no más))?$`).test(m)) {
        return sanitizeQuantity(num);
      }
    }
  }

  return 0;
}


function senderPhoneFallback(fromNumber: string): string {
  const digits = clean(fromNumber).replace(/\D/g, "");
  if (!digits) return "";

  // WhatsApp suele entregar números paraguayos como 5959XXXXXXXX.
  // Para mostrar/guardar el formato local lo convertimos a 09XXXXXXXX.
  if (/^5959\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^9\d{8}$/.test(digits)) return `0${digits}`;
  if (/^09\d{8}$/.test(digits)) return digits;

  // Para números internacionales de otros países conservamos todos los dígitos.
  return digits;
}

function extractPhone(text: string) {
  const raw = clean(text);
  const tokens = raw.split(/\s+/).filter(Boolean);

  const fullPattern = /^(?:09\d{8}|\+5959\d{8}|5959\d{8})$/;

  for (const t of tokens) {
    const compactToken = t.replace(/[.\-]/g, "");
    if (fullPattern.test(compactToken)) return compactToken.replace(/^\+/, "");
  }

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

function looksLikePriceMention(text: string) {
  const raw = clean(text);
  if (!raw) return false;
  return /\d{1,3}(?:[.,]\d{3})+/.test(raw) || /\b\d{4,7}\b/.test(raw);
}

function parsePriceMentions(text: string): number[] {
  const raw = clean(text);
  const matches = raw.match(/\d{1,3}(?:[.,]\d{3})+|\b\d{4,7}\b/g) || [];
  return matches
    .map((m) => Number(m.replace(/[.,]/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 10000 && n <= 10000000);
}

function extractQuantityFromPriceMention(
  text: string,
  productInfo: ProductItem | null,
  templatePricing: TemplatePricing | null
): number {
  if (!productInfo) return 0;

  const mentioned = parsePriceMentions(text);
  if (!mentioned.length) return 0;

  const candidateOffers: { quantity: number; total: number }[] = [];

  if (productInfo.price1) candidateOffers.push({ quantity: 1, total: productInfo.price1 });
  if (productInfo.price2) candidateOffers.push({ quantity: 2, total: productInfo.price2 });
  if (productInfo.price3) candidateOffers.push({ quantity: 3, total: productInfo.price3 });
  if (productInfo.fixedPackQuantity && productInfo.price1) {
    candidateOffers.push({ quantity: productInfo.fixedPackQuantity, total: productInfo.price1 });
  }

  if (templatePricing && normalize(templatePricing.product) === normalize(productInfo.canonical)) {
    for (const o of templatePricing.offers || []) {
      candidateOffers.push({ quantity: o.quantity, total: o.total });
    }
  }

  for (const price of mentioned) {
    const match = candidateOffers.find((o) => o.total === price);
    if (match) return match.quantity;
  }

  return 0;
}

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}


function looksLikeAddressSupplement(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /\b(calle|avda|avenida|ruta|km|barrio|bario|bsrrio|barrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote|edificio|piso|departamento|porteria|portería|referencia)\b/.test(n) ||
    /^(?:b+a?r+r?i?o|bsrrio|bo)\s+[a-z]/.test(n) ||
    /\b(entre calles?|al lado de|frente a|cerca de|detras de|detrás de)\b/.test(n)
  );
}

function mergeAddressSupplement(currentAddress: string, supplement: string): string {
  const current = clean(currentAddress);
  const extra = clean(supplement);
  if (!current) return extra;
  if (!extra) return current;

  const currentNorm = normalize(current);
  const extraNorm = normalize(extra);

  if (currentNorm === extraNorm || currentNorm.includes(extraNorm)) return current;
  if (extraNorm.includes(currentNorm)) return extra;

  return `${current} — ${extra}`;
}

function isIdentityDocumentText(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw) return false;

  return (
    /\b(ci|cedula|cédula|documento|ruc)\b/.test(n) ||
    /^\s*\d{1,3}(?:[.\s]\d{3}){1,2}(?:[-\s]\d)?\s*$/.test(raw) ||
    /^\s*\d{5,9}-\d\s*$/.test(raw)
  );
}

function isDeliveryTimingMessage(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return false;

  return (
    isTemporalDeliveryExpression(raw) ||
    /\b(hoy|manana|mañana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(n) ||
    /\b(hasta|desde|antes|despues|después|a las|hora|horario)\b[\s\S]{0,30}\b\d{1,2}(?::\d{2})?\s*(?:hs|hrs|am|pm)?\b/.test(n)
  );
}

function isInvoiceOrTaxDataMessage(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return false;

  return (
    /\b(factura|factura legal|con factura|sin factura|facturar|facturacion|facturación|comprobante legal|credito fiscal|crédito fiscal)\b/.test(n) ||
    /\b(ruc|razon social|razón social|nombre de factura|datos para factura|datos de facturacion|datos de facturación)\b/.test(n) ||
    /\bfactura\s+(?:a|al)\s+nombre\s+de\b/.test(n) ||
    /\b(?:mi|el)\s+ruc\s+(?:es|seria|sería)?\s*[:#-]?\s*\d/.test(n)
  );
}

function isStandaloneTaxOrIdentityData(text: string): boolean {
  const raw = clean(text);
  if (!raw) return false;

  return (
    /^(?:ruc|ci|cedula|cédula|documento)\s*[:#-]?\s*\d[\d.\-\s]{4,}$/i.test(raw) ||
    /^(?:razon social|razón social)\s*[:#-]\s*.+$/i.test(raw) ||
    /^\d{5,9}-\d$/.test(raw.replace(/[.\s]/g, ""))
  );
}


function isPoliteClosingOrAcknowledgement(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /^(?:bueno\s+)?(?:muchas|muchisimas|muchísimas)?\s*gracias(?:\s+(?:igualmente|por todo|por la atencion|por la atención))?$/i.test(n) ||
    /^(?:ok|okay|dale|listo|perfecto|bueno|genial|excelente|joya|esta bien|está bien)\s*,?\s*gracias$/i.test(n) ||
    /^(?:gracias|muchas gracias|muchisimas gracias|muchísimas gracias|bueno gracias|gracias igualmente|de acuerdo gracias|todo bien gracias)$/i.test(n) ||
    /^(?:ok|okay|dale|listo|perfecto|bueno|genial|excelente|joya|👍|👌|🙏)$/i.test(n)
  );
}

function isPaymentInformationQuestion(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /\b(como|cómo|cual|cuál|que|qué)\b[\s\S]{0,35}\b(pago|pagar|transferencia|efectivo|contra entrega)\b/.test(n) ||
    /\b(tengo que|se puede|puedo|debo)\b[\s\S]{0,30}\b(pagar|hacer transferencia|transferir)\b/.test(n) ||
    /\b(formas?|metodos?|métodos?)\s+de\s+pago\b/.test(n)
  );
}

function isDeliveryCostQuestion(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /\b(delivery|envio|envío|entrega|flete|transportadora|encomienda)\b[\s\S]{0,40}\b(cuanto|cuánto|costo|cuesta|sale|paga|pagar|gratis)\b/.test(n) ||
    /\b(cuanto|cuánto|costo|cuesta|sale|paga|pagar)\b[\s\S]{0,40}\b(delivery|envio|envío|entrega|flete|transportadora|encomienda)\b/.test(n) ||
    /\b(el|la)?\s*(delivery|envio|envío)\s+es\s+gratis\b/.test(n)
  );
}

function buildDeliveryCostResponse(state: ConversationState): string {
  const city = clean(state.order.city);
  if (!city) {
    return "🚚 Para confirmarte el costo del envío, decime primero tu ciudad.";
  }

  if (state.coverage === true) {
    return `🚚 El delivery a ${city} es GRATIS 😊\nPagás solamente el producto cuando lo recibís.`;
  }

  return `🚚 Hasta ${city} enviamos por transportadora.\n\nEl costo de la encomienda lo define la transportadora según el destino y no está incluido en el precio del producto.\n\nPara este tipo de envío trabajamos con pago anticipado.`;
}

function extractExplicitKnownCityFromSentence(text: string, parsed: ParsedTraining): string {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return "";

  // Respaldo determinístico para Asunción y área metropolitana.
  // Se ejecuta antes de cualquier análisis difuso o de precio.
  const hardKnownCities: Array<[RegExp, string]> = [
    [/\b(asuncion|asu)\b/i, "Asunción"],
    [/\b(fernando de la mora|fdo de la mora|fndo de la mora|fdo dela mora|fndo dela mora)\b/i, "Fernando de la Mora"],
    [/\bsan lorenzo\b/i, "San Lorenzo"],
    [/\bluque\b/i, "Luque"],
    [/\b(lambare)\b/i, "Lambaré"],
    [/\b(mariano roque alonso|mra)\b/i, "Mariano Roque Alonso"],
  ];

  for (const [pattern, canonical] of hardKnownCities) {
    if (pattern.test(n)) return canonical;
  }

  // V66: detecta ciudad conocida en frases naturales, tanto antes como
  // después del indicador de ciudad.
  // Ejemplos: "soy de Areguá", "quiero para Areguá",
  // "Areguá es mi ciudad", "mi ciudad es Areguá".
  const hasCityContext =
    /\b(soy de|soi de|vivo en|estoy en|resido en|mi ciudad es|mi ciudad seria|mi ciudad sería|para|para la ciudad de|quiero para|necesito para|envio a|envío a|delivery a|mandar a|enviar a|entrega en|entrega a)\b/.test(n) ||
    /\b(es|seria|sería)\s+mi\s+ciudad\b/.test(n) ||
    /\bmi\s+ciudad\b/.test(n);

  if (!hasCityContext) return "";

  const ordered = [...(parsed.cities || [])].sort(
    (a, b) =>
      Math.max(normalize(b.alias).length, normalize(b.canonical).length) -
      Math.max(normalize(a.alias).length, normalize(a.canonical).length)
  );

  for (const city of ordered) {
    const aliases = Array.from(new Set([city.alias, city.canonical].map(normalize).filter(Boolean)));

    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const cityRegex = new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i");
      if (cityRegex.test(n)) return city.canonical;
    }
  }

  return "";
}

function splitCompositeMessage(text: string): string[] {
  return clean(text)
    .split(/(?:\r?\n|[.!?]+\s+|;\s*)/g)
    .map(clean)
    .filter(Boolean);
}

function extractCompositeAddress(text: string, detectedCity: string, phone: string, name: string): string {
  const pieces = splitCompositeMessage(text);
  const selected: string[] = [];

  for (const piece of pieces) {
    const n = normalize(piece);
    if (!n) continue;
    if (isPaymentInformationQuestion(piece)) continue;
    if (isInvoiceOrTaxDataMessage(piece) || isStandaloneTaxOrIdentityData(piece)) continue;
    if (isDeliveryTimingMessage(piece)) continue;
    if (isPoliteClosingOrAcknowledgement(piece)) continue;
    if (phone && piece.includes(phone)) continue;
    if (name && normalize(piece).includes(normalize(name))) continue;

    const locationCue =
      /\b(barrio|bario|bsrrio|calle|avenida|avda|ruta|km|casa|edificio|piso|departamento|dpto|manzana|mz|lote|puerto|compania|compañia|colonia|fraccion|fracción|asentamiento|zona|referencia|cerca|cuadra|ferreteria|ferretería|bodega|supermercado|iglesia|escuela|colegio|plaza|hospital|farmacia|frente|esquina|al lado|detras|detrás)\b/.test(n) ||
      /-?\d{2}\.\d{3,}\s*,\s*-?\d{2}\.\d{3,}/.test(piece);

    if (!locationCue) continue;

    let cleanedPiece = clean(piece)
      .replace(/^\s*(?:yo\s+)?(?:soy|vivo|estoy)\s+(?:de|en)\s+/i, "")
      .replace(/^\s*(?:mi\s+)?(?:direccion|dirección|ubicacion|ubicación|referencia)\s*(?:es|:|-)?\s*/i, "");

    if (detectedCity) {
      const cityPattern = detectedCity
        .split(/\s+/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+");
      cleanedPiece = cleanedPiece.replace(new RegExp(`^${cityPattern}\\s*[,;-]?\\s*`, "i"), "");
    }

    if (cleanedPiece && !selected.some((x) => normalize(x) === normalize(cleanedPiece))) {
      selected.push(cleanedPiece);
    }
  }

  return selected.join(" — ");
}

function isExplicitNameCorrection(text: string): boolean {
  const n = normalize(text);
  return /\b(mi nombre correcto es|corregir nombre|cambiar el nombre a|cambia el nombre a|el pedido es para|poner a nombre de)\b/.test(n);
}

/**
 * V64: una declaración de procedencia nunca puede ser un nombre de cliente.
 * Ejemplos bloqueados: "Soy de Areguá", "Vivo en Luque",
 * "Estoy en Asunción" y "Para San Lorenzo" cuando el texto es solo ciudad.
 */
function isLocationDeclarationInsteadOfName(text: string, parsed?: ParsedTraining): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!n) return false;

  if (/^(?:hola\s+)?(?:yo\s+)?(?:soy|soi|vivo|resido|estoy|somos)\s+(?:de|en)\b/.test(n)) {
    return true;
  }

  if (/^(?:mi\s+)?(?:ciudad|localidad|zona)\s+(?:(?:es|seria|sería)\b|de\s+)/.test(n)) {
    return true;
  }

  if (/^(?:la\s+)?ciudad\s+de\s+/.test(n)) return true;

  if (!parsed) return false;

  const city = canonicalizeStoredCity(raw, parsed);
  const cityNorm = normalize(city);
  const known = parsed.cities.some((item) => {
    const alias = normalize(item.alias);
    const canonical = normalize(item.canonical);
    return cityNorm === alias || cityNorm === canonical;
  });

  if (!known) return false;

  if (n === cityNorm) return true;
  if (/^(?:para|de|desde|hacia)\s+/.test(n) && n.includes(cityNorm)) return true;

  return false;
}

function isContaminatedCustomerName(value: string, parsed: ParsedTraining): boolean {
  const raw = clean(value);
  const n = normalize(raw);
  if (!n) return true;

  if (isLocationDeclarationInsteadOfName(raw, parsed)) return true;

  if (/^(?:soy|soi|vivo|resido|estoy|somos)\s+(?:de|en)\b/.test(n)) return true;
  if (/^(?:la\s+)?ciudad\s+de\s+/.test(n)) return true;
  if (/^(?:para|de|desde)\s+(?:la\s+)?(?:ciudad\s+de\s+)?/.test(n)) {
    const city = canonicalizeStoredCity(raw, parsed);
    if (normalize(city) !== n) return true;
  }

  return parsed.cities.some((city) => {
    const alias = normalize(city.alias);
    const canonical = normalize(city.canonical);
    return n === alias || n === canonical || n === `soy de ${alias}` || n === `soy de ${canonical}` || n === `vivo en ${alias}` || n === `vivo en ${canonical}` || n === `estoy en ${alias}` || n === `estoy en ${canonical}`;
  });
}

function extractName(text: string, detectedCity: string, phone: string, parsed?: ParsedTraining) {
  const raw = clean(text);
  if (!raw) return "";
  if (isPoliteClosingOrAcknowledgement(raw)) return "";
  if (isPaymentInformationQuestion(raw)) return "";
  if (isQuestionLikeMessage(raw)) return "";
  if (extractQuantity(raw) > 0) return "";
  if (looksLikeAddressSupplement(raw)) return "";
  if (isIdentityDocumentText(raw)) return "";
  if (isDeliveryTimingMessage(raw)) return "";
  if (isInvoiceOrTaxDataMessage(raw) || isStandaloneTaxOrIdentityData(raw)) return "";
  if (/^(?:la\s+)?ciudad\s+de\s+/i.test(normalize(raw))) return "";
  if (isLocationDeclarationInsteadOfName(raw, parsed)) return "";

  // Mensajes mixtos como "quiero uno para Asunción Roberto Lpetti el precio..."
  // no deben convertirse completos en nombre. Solo aceptamos correcciones
  // explícitas o dejamos el nombre pendiente para pedirlo de forma segura.
  if (
    parsed &&
    extractExplicitKnownCityFromSentence(raw, parsed) &&
    (looksLikePriceMention(raw) || extractQuantity(raw) > 0 || /\b(quiero|quisiera|llevo|para)\b/.test(normalize(raw)))
  ) {
    const explicitMixed = raw.match(/\b(?:mi nombre es|me llamo|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ]+(?:\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ]+){1,4})/i)?.[1];
    return explicitMixed ? toTitleCase(clean(explicitMixed)) : "";
  }

  const isMultiLine = raw.includes("\n");
  const lines = raw.split("\n").filter((l) => clean(l).length > 0);

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
    "bueno muchas gracias", "muchisimas gracias", "muchísimas gracias",
    "bueno gracias", "gracias igualmente", "ok gracias", "dale gracias",
    "listo gracias", "perfecto gracias", "esta bien gracias", "está bien gracias",
  ];

  const questionVerbs =
    /\b(traen|trae|mandan|llegan|llega|entrega|viene|vienen|cuesta|cobran|demora|tarda)\b/;

  const isValidNameLine = (line: string): boolean => {
    const cleaned = clean(line);
    const normLine = normalize(cleaned);
    const words = cleaned.split(/\s+/).filter(Boolean);

    if (isPoliteClosingOrAcknowledgement(cleaned)) return false;
    if (isPaymentInformationQuestion(cleaned)) return false;
    if (isLocationDeclarationInsteadOfName(cleaned, parsed)) return false;
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

  const explicit = raw.match(/(?:mi nombre correcto es|cambiar el nombre a|cambia el nombre a|el pedido es para|poner a nombre de|me llamo|mi nombre es|nombre)\s*[:,-]?\s*([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,80})/i)?.[1];
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

function stripPhoneFromAddress(value: string, phone?: string): string {
  let result = clean(value);
  if (!result) return "";

  // Retira teléfonos paraguayos aun cuando vienen separados por espacios,
  // puntos, guiones o acompañados por “mi celular”, “teléfono”, etc.
  result = result.replace(/\b(?:mi\s+)?(?:celular|telefono|teléfono|tel|cel)(?:\s+(?:no|nro|numero|número))?\s*[:.#-]?\s*(?:\+?595\s*)?0?9\d(?:[\s.-]*\d){7,8}\b/gi, " ");
  result = result.replace(/\b(?:\+?595\s*)?0?9\d(?:[\s.-]*\d){7,8}\b/g, " ");

  if (phone) {
    const digits = clean(phone).replace(/\D/g, "");
    if (digits.length >= 9) {
      const flexible = digits.split("").map((d) => `${d}[\\s.-]*`).join("");
      result = result.replace(new RegExp(flexible, "g"), " ");
    }
  }

  return result
    .replace(/\b(?:mi\s+)?(?:celular|telefono|teléfono|tel|cel)(?:\s+(?:no|nro|numero|número))?\s*[:.#-]?\s*$/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;.-]+$/g, "")
    .trim();
}

function extractAddress(text: string, detectedCity: string, phone: string, name: string) {
  const raw = clean(text);
  if (/^\d+\s*(unidad|unidades|u|und|unds)?$/i.test(raw)) return "";
  if (/^\d+$/.test(raw)) return "";
  if (isIdentityDocumentText(raw)) return "";
  if (isDeliveryTimingMessage(raw)) return "";
  if (isInvoiceOrTaxDataMessage(raw) || isStandaloneTaxOrIdentityData(raw)) return "";

  const lines = raw.split("\n").filter((l) => clean(l).length > 0);

  const explicit = raw.match(/(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i)?.[1];
  if (explicit) return stripPhoneFromAddress(explicit, phone);

  if (raw.includes("maps.app") || raw.includes("google.com/maps")) return raw;

  const compositeAddress = extractCompositeAddress(raw, detectedCity, phone, name);
  if (compositeAddress) return compositeAddress;

  for (const line of lines) {
    const cleaned = clean(line);
    const normLine = normalize(cleaned);

    if (/\b(calle|avda|avenida|ruta|km|barrio|bario|bsrrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote|edificio|piso|departamento|porteria|portería|referencia)\b/i.test(normLine) || looksLikeAddressSupplement(cleaned)) {
      if (name && normalize(cleaned).includes(normalize(name))) continue;
      if (phone && cleaned.includes(phone)) continue;
      return stripPhoneFromAddress(cleaned, phone);
    }
  }

  if (/\d/.test(raw) && raw.length >= 8 && !isQuestionLikeMessage(raw)) {
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

    remaining = stripPhoneFromAddress(remaining, phone);
    if (remaining.length >= 5) return remaining;
  }

  return "";
}

function mergeUniqueText(oldValue: any, newValue: any) {
  const oldText = clean(oldValue);
  const newText = clean(newValue);
  if (!oldText) return newText;
  if (!newText) return oldText;

  const pieces = oldText
    .split(/\s*\|\s*/g)
    .map(clean)
    .filter(Boolean);

  const exists = pieces.some((p) => normalize(p) === normalize(newText) || normalize(p).includes(normalize(newText)) || normalize(newText).includes(normalize(p)));
  if (!exists) pieces.push(newText);
  return pieces.join(" | ");
}

function hasOrderObservation(order: Partial<OrderData> | null | undefined) {
  return Boolean(
    clean(order?.observation) ||
    clean(order?.preferred_delivery_date) ||
    clean(order?.preferred_delivery_time) ||
    clean(order?.payment_note)
  );
}

function observationLines(order: Partial<OrderData> | null | undefined) {
  const values = [
    clean(order?.observation),
    clean(order?.payment_note),
    clean(order?.preferred_delivery_date),
    clean(order?.preferred_delivery_time),
  ].filter(Boolean);

  const unique: string[] = [];
  for (const value of values) {
    const parts = value.split(/\s*\|\s*/g).map(clean).filter(Boolean);
    for (const part of parts) {
      const normalizedPart = normalize(part);
      const alreadyIncluded = unique.some((existing) => {
        const normalizedExisting = normalize(existing);
        return (
          normalizedExisting === normalizedPart ||
          normalizedExisting.includes(normalizedPart) ||
          normalizedPart.includes(normalizedExisting)
        );
      });
      if (!alreadyIncluded) unique.push(part);
    }
  }

  return unique.length ? [`📝 Observación: ${unique.join(" | ")}`] : [];
}

function observationBlock(order: Partial<OrderData> | null | undefined) {
  const lines = observationLines(order);
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

function isDeliveryTimingQuestion(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return false;
  return (
    /[?¿]/.test(raw) && /\b(hoy|manana|mañana|cuando|cuándo|que hora|qué hora|horario|entrega|llega|llegaria|llegaría|demora|tarda|tiempo)\b/.test(n)
  ) || /^(?:seria|sería|puede ser|llega|entregan|entrega)\s+(?:hoy|manana|mañana)\b/.test(n);
}

function isConfirmedDeliveryPreference(text: string): boolean {
  const n = normalize(text);
  if (!n || isDeliveryTimingQuestion(text)) return false;
  return (
    /\b(me queda bien|prefiero|quiero recibir|necesito recibir|anota|anotá|dejame|déjame|agendame|agéndame|puede ser|que sea)\b[\s\S]{0,80}\b(hoy|manana|mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/.test(n) ||
    /\b(hoy|manana|mañana)\b[\s\S]{0,80}\b(me queda bien|me sirve|estare|estaré|puedo recibir|prefiero)\b/.test(n)
  );
}

function buildDeliveryTimingQuestionResponse(text: string, order: OrderData): string {
  const n = normalize(text);
  const requested = /\bmanana|mañana\b/.test(n) ? "mañana" : /\bhoy\b/.test(n) ? "hoy" : "la fecha consultada";
  const product = clean(order.product) ? ` de ${order.product}` : "";
  return `🚚 No podemos asegurar una hora exacta porque depende de la ruta del delivery. Tu pedido${product} se coordina según disponibilidad y el delivery te contacta antes de llegar.\n\n¿Querés que anote como preferencia de entrega para ${requested}?`;
}

function extractOrderObservation(text: string): Partial<OrderData> {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return {};

  const obs: Partial<OrderData> = {};

  // V65: una pregunta sobre fecha/hora no se guarda como instrucción.
  // Solo se registra cuando el cliente confirma una preferencia real.
  if (isDeliveryTimingQuestion(raw)) return {};

  // Las preguntas informativas de pago se responden, pero no son observaciones.
  const paymentInfoQuestion = isPaymentInformationQuestion(raw);

  // V59: toda solicitud o dato de facturación se conserva en una sola Observación.
  if (isInvoiceOrTaxDataMessage(raw) || isStandaloneTaxOrIdentityData(raw)) {
    obs.observation = mergeUniqueText(obs.observation, raw);
  }

  const dateWords = "hoy|manana|mañana|pasado|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|fin de semana|quincena|fin de mes|[0-3]?\\d(?:\\/|-)[0-1]?\\d|[0-3]?\\d\\s*(?:de)?\\s*(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)";
  const hourWords = "de manana|de mañana|de tarde|de noche|a la manana|a la mañana|a la tarde|a la noche|despues de|después de|antes de|hasta las|desde las|a las|mediodia|mediodía|tarde nomas|tarde nomás|manana nomas|mañana nomás|noche nomas|noche nomás|\\b\\d{1,2}(?::\\d{2})?\\s*(?:hs|hrs|pm|am)?\\b";

  if (!paymentInfoQuestion && /\b(no tengo plata|no tengo efectivo|no tengo dinero|sin plata|sin efectivo|ahora no tengo|cobro|cobrare|cobraré|cuando cobre|cuando cobro|cobrar|sueldo|salario|quincena|fin de mes|este mes|mes que viene|proximo mes|próximo mes|te pago|pago el|pagar el|voy a pagar|pago cuando|pagar cuando|recién cobro|recien cobro)\b/.test(n)) {
    obs.payment_note = raw;
    obs.observation = mergeUniqueText(obs.observation, raw);
  }

  const deliveryDateRegex = new RegExp(`\\b(recibir|recibo|recibirlo|entregar|entrega|traer|traigan|llevar|mandar|mandame|enviar|envio|envío|delivery|para)\\b[\\s\\S]{0,80}\\b(${dateWords})\\b`, "i");
  const dateOnlyIntentRegex = new RegExp(`\\b(quiero|necesito|puede ser|seria|sería|me sirve|agendar|reservar|dejar)\\b[\\s\\S]{0,80}\\b(${dateWords})\\b`, "i");
  if ((deliveryDateRegex.test(n) || dateOnlyIntentRegex.test(n)) && isConfirmedDeliveryPreference(raw)) {
    obs.preferred_delivery_date = raw;
    obs.observation = mergeUniqueText(obs.observation, raw);
  }

  const timeRegex = new RegExp(`\\b(${hourWords})\\b`, "i");
  if (timeRegex.test(n) && /\b(recibir|entregar|traer|llevar|mandar|enviar|delivery|estoy|puedo|solo|solamente|pasar|llegar|horario|hora|a las|despues|después|antes|hasta|desde|manana|mañana|tarde|noche)\b/.test(n)) {
    obs.preferred_delivery_time = raw;
    obs.observation = mergeUniqueText(obs.observation, raw);
  }

  const explicitCoordination = /\b(llamar antes|avisar antes|avisen antes|avisame antes|avísame antes|te aviso|yo aviso|les aviso|aviso luego|despues te aviso|después te aviso|avisar|coordinar|coordinamos|porteria|portería|guardia|dejar con|retira|retirar)\b/.test(n);
  const absenceCoordination = /\b(no estoy|no voy a estar|estoy solo|solo estoy)\b/.test(n) && /\b(casa|domicilio|direccion|dirección|entrega|delivery|recibir|horario|hora)\b/.test(n);
  if (explicitCoordination || absenceCoordination) {
    obs.observation = mergeUniqueText(obs.observation, raw);
  }

  return obs;
}

function mergeOrderObservation(oldOrder: Partial<OrderData>, patch: Partial<OrderData>) {
  return {
    observation: mergeUniqueText(oldOrder?.observation, patch?.observation),
    preferred_delivery_date: mergeUniqueText(oldOrder?.preferred_delivery_date, patch?.preferred_delivery_date),
    preferred_delivery_time: mergeUniqueText(oldOrder?.preferred_delivery_time, patch?.preferred_delivery_time),
    payment_note: mergeUniqueText(oldOrder?.payment_note, patch?.payment_note),
  };
}

function sanitizeOldOrder(old: any, parsed: ParsedTraining): OrderData {
  let productInfo = getProductInfo(old?.product || "", parsed);

  // V65: si una versión anterior guardó “Oferta HOY”, intentamos recuperar
  // el producto real desde locked_offer o dejamos el campo vacío para que el
  // producto actual/historial lo reponga; nunca confirmamos el genérico.
  if (isGenericProductLabel(old?.product)) {
    productInfo = getProductInfo(old?.locked_offer?.product || "", parsed);
  }
  const nameNorm = normalize(old?.customer_name || "");

  const forbiddenNames = [
    "quiero", "cuando", "dia", "llega", "llego", "pedido", "cancelar",
    "no", "raqueta", "nebulizador", "que", "estado", "seguimiento",
    "ya fue", "que dia llega mi pedido", "no raqueta",
  ];

  const isInvalidName =
    forbiddenNames.some((f) => nameNorm.includes(normalize(f))) ||
    nameNorm.split(" ").length > 5 ||
    isContaminatedCustomerName(clean(old?.customer_name || ""), parsed);

  const oldCity = clean(old?.city || "");
  const sanitizedCity = isQuestionLikeMessage(oldCity) || looksLikeSentenceNotCity(oldCity)
    ? ""
    : oldCity;

  return {
    order_id: clean(old?.order_id || ""),
    product: productInfo?.canonical || "",
    quantity: sanitizeQuantity(old?.quantity || 0),
    city: sanitizedCity,
    customer_name:
      old?.customer_name && nameNorm !== "quiero" && !isInvalidName
        ? clean(old.customer_name)
        : "",
    phone: clean(old?.phone || ""),
    address: clean(old?.address || ""),
    locked_offer: old?.locked_offer || null,
    payment_proof_received: !!old?.payment_proof_received,
    observation: clean(old?.observation || old?.observacion || ""),
    preferred_delivery_date: clean(old?.preferred_delivery_date || ""),
    preferred_delivery_time: clean(old?.preferred_delivery_time || ""),
    payment_note: clean(old?.payment_note || ""),
  } as OrderData;
}

function mergeOrderData(old: OrderData, ext: any, product: string): OrderData {
  return {
    order_id: ext.order_id || old.order_id || "",
    product: !isGenericProductLabel(product)
      ? product
      : (!isGenericProductLabel(old.product) ? old.product : ""),
    quantity: ext.quantity > 0 ? sanitizeQuantity(ext.quantity) : sanitizeQuantity(old.quantity || 0),
    city: ext.city || old.city || "",
    // V64: un nombre válido se protege, pero un valor contaminado por ciudad
    // se reemplaza automáticamente cuando llega el nombre real.
    customer_name:
      old.customer_name && !ext.explicit_name_correction && !ext.old_name_is_contaminated
        ? old.customer_name
        : (ext.name || (ext.old_name_is_contaminated ? "" : old.customer_name) || ""),
    phone: ext.phone || old.phone || "",
    address: ext.address
      ? mergeAddressSupplement(old.address || "", ext.address)
      : old.address || "",
    locked_offer: ext.locked_offer !== undefined ? ext.locked_offer : old.locked_offer || null,
    payment_proof_received: ext.payment_proof_received !== undefined ? !!ext.payment_proof_received : !!old.payment_proof_received,
    ...mergeOrderObservation(old, ext || {}),
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
    lockedOffer.total > 0 &&
    isPlausibleOfferForProduct(lockedOffer, p)
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
    raw.match(/(?:por|a solo|solo|promo|oferta)[^\d]*(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i) ||
    raw.match(/(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)/i);

  const total = priceMatch ? parseNumberGs(priceMatch[1]) : 0;

  if (product && quantity > 0 && total > 0) {
    return { product, quantity, total, label: `${quantity} por ${formatGs(total)} Gs`, source: "template" };
  }

  return null;
}

function looksLikeCustomerDataOrAddress(text: string) {
  const n = normalize(text);
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

  const structuredFixed =
    /producto\s*:/i.test(raw) &&
    /cantidad\s*:\s*\d+/i.test(raw) &&
    /precio\s*:\s*(?:gs\.?\s*)?\d/i.test(raw);

  return explicitFixed || structuredFixed;
}

function sanitizeCopyForOfferParsing(raw: string) {
  return clean(raw)
    .split(/\r?\n/g)
    .filter((line) => {
      const n = normalize(line);
      if (!n) return true;
      if (/\b(ultimos?|quedan|stock|disponibles?|restan?)\b/.test(n)) return false;
      if (/\b(talle|talles|calce|numero|numeros)\b/.test(n) && /\b\d{2}\s*(?:al|a|hasta|-)\s*\d{2}\b/.test(n)) return false;
      if (/\b\d{2}\s*(?:al|a|hasta|-)\s*\d{2}\b/.test(n) && !/(?:gs|guarani|guaranies)/.test(n)) return false;
      if (/\b(farmacia|antes|precio normal|precio regular|valor normal)\b/.test(n)) return false;
      if (/\b\d[\d.]*\s+(?:paraguayos|clientes|personas|compradores)\b/.test(n)) return false;
      return true;
    })
    .join("\n");
}

function parseRawOffers(raw: string, product: string): { offers: OfferItem[]; fixedQuantity: boolean } {
  const fixedQuantity = isFixedPackText(raw);
  const pricingRaw = sanitizeCopyForOfferParsing(raw);
  const offers: OfferItem[] = [];

  const addOffer = (quantity: number, total: number, fixed = false) => {
    const q = sanitizeQuantity(quantity);
    const t = Number(total || 0);

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

  const structuredQty = pricingRaw.match(/cantidad\s*:\s*(\d+)\s*(?:unidad|unidades|u|und|unds|piezas|pieza)?/i);
  const structuredPrice = pricingRaw.match(/precio\s*:\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i);

  if (structuredQty && structuredPrice) {
    addOffer(Number(structuredQty[1]), parseNumberGs(structuredPrice[1]), true);
  }

  const explicitPackPatterns = [
    /^[^0-9\n]{0,20}(\d+)\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ]{3,40}s?\s*[:=]\s*(?:gs\.?\s*)?(\d[\d. ]{3,})(?:\s*(?:gs|guaran[ií]es))?/gim,
    /\b(?:pack|combo)\s*(?:de)?\s*(\d+)[^\n\r]{0,100}?(?:=|por|a|solo|solamente|→|->)\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/gi,
    /\b(\d+)\s*(?:unidades|unidad|u|und|unds|piezas|pieza|productos)?[^\n\r]{0,100}?(?:por|a|solo|solamente|=|→|->)\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/gi,
    /(?:^|\n|\*)\s*(\d+)\s*(?:unidad|unidades|u|und|unds)?\s*(?:→|->|-|:|=|por|x|a)?\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/gi,
  ];

  for (const pattern of explicitPackPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(pricingRaw)) !== null) {
      const quantity = Number(match[1]);
      const total = parseNumberGs(match[2]);
      addOffer(quantity, total, fixedQuantity || quantity > 1 && isFixedPackText(raw));
    }
  }

  const singlePricePatterns = [
    /(?:^|\n)[^\n]{0,20}\bhoy\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i,
    /precio\s*promocional\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i,
    /oferta\s*(?:hoy)?\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i,
    /(?:precio|valor|sale|cuesta)\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i,
  ];

  if (!fixedQuantity) {
    for (const pattern of singlePricePatterns) {
      const m = pricingRaw.match(pattern);
      if (m) {
        addOffer(1, parseNumberGs(m[1]), false);
        break;
      }
    }
  }

  if (fixedQuantity && !offers.some((o) => o.fixed_quantity)) {
    const qMatch =
      pricingRaw.match(/\b(?:pack|combo)\s*(?:de)?\s*(\d+)\b/i) ||
      pricingRaw.match(/\b(\d+)\s*(?:unidades|unidad|u|und|unds|piezas|pieza)\b/i);

    const pMatch =
      pricingRaw.match(/(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i);

    if (qMatch && pMatch) {
      addOffer(Number(qMatch[1]), parseNumberGs(pMatch[1]), true);
    }
  }

  return { offers, fixedQuantity };
}

function detectTemplatePricingFromText(text: string, parsed: ParsedTraining, strict = false): TemplatePricing | null {
  const raw = clean(text);
  if (!isSafeTemplatePricingMessage(raw)) return null;

  const product = strict ? detectProductStrict(raw, parsed) : detectProduct(raw, parsed, "");
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

  const hasFixed = uniqueOffers.some((o) => o.fixed_quantity) || fixedQuantity;

  return {
    product,
    price1: hasFixed ? undefined : uniqueOffers.find((o) => o.quantity === 1)?.total,
    offers: uniqueOffers.map((o) => ({ ...o, fixed_quantity: hasFixed ? true : o.fixed_quantity })),
    raw,
    fixed_quantity: hasFixed,
  };
}

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

function detectStructuredTemplatePricingFallback(text: string, parsed: ParsedTraining, strict = false): TemplatePricing | null {
  const raw = clean(text);
  if (!isStructuredSalesTemplateMessage(raw)) return null;

  const productLine = clean(raw.match(/producto\s*:\s*(.+)$/im)?.[1]);
  const qtyLine = raw.match(/cantidad\s*:\s*(\d+)\s*(?:unidad|unidades|u|und|unds|piezas|pieza)?/i);
  const priceLine = raw.match(/precio\s*:\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i);

  const product = strict
    ? detectProductStrict(productLine || raw, parsed)
    : detectProduct(productLine || raw, parsed, "");
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

function detectTemplatePricingSmart(text: string, parsed: ParsedTraining, strict = false): TemplatePricing | null {
  return detectTemplatePricingFromText(text, parsed, strict) || detectStructuredTemplatePricingFallback(text, parsed, strict);
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
  const recentMessages = (history || []).slice(-30).reverse();

  for (const item of recentMessages) {
    const content = clean(item?.content || item?.message || item?.text || item?.body || "");
    if (!content) continue;
    if (isConfirmedOrderMessage(content)) continue;
    if (isCatalogCopyHistoryMessage(content, parsed)) continue;

    const looksLikeTemplate =
      isStructuredSalesTemplateMessage(content) ||
      isRealSalesTemplateMessage(content) ||
      isSafeTemplatePricingMessage(content);

    if (!looksLikeTemplate) continue;

    const pricing = detectTemplatePricingSmart(content, parsed, true);
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
  const recentMessages = (history || []).slice(-30).reverse();

  for (const item of recentMessages) {
    const content = clean(item?.content || item?.message || item?.text || item?.body || "");
    if (!content) continue;
    if (isConfirmedOrderMessage(content)) continue;
    if (isCatalogCopyHistoryMessage(content, parsed)) continue;
    if (!isRealSalesTemplateMessage(content) && !isSafeTemplatePricingMessage(content) && !isStructuredSalesTemplateMessage(content)) continue;

    const pricing = detectTemplatePricingSmart(content, parsed, true);
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
    if (isCatalogCopyHistoryMessage(content, parsed)) continue;
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

function wasProductCopyAlreadySent(history: any[], productInfo: ProductItem | null): boolean {
  const copy = clean(productInfo?.salesCopy || "");
  if (!copy) return false;

  return (history || []).some((item: any) => {
    const content = historyText(item);
    if (!content) return false;
    return content === copy || content.startsWith(copy) || content.includes(copy);
  });
}

// ✅ FIX V46: detecta de forma robusta si el copy de ESTE producto ya fue enviado.
// Tolera distintos nombres de rol y respuestas que agregan la pregunta de ciudad al final.
function wasCopyAlreadySentInThisConversation(history: any[], productInfo: ProductItem | null): boolean {
  const copy = clean(productInfo?.salesCopy || "");
  if (!copy) return false;

  const normalizedCopy = normalize(copy);
  const copyFingerprint = normalizedCopy
    .split(/\s+/)
    .slice(0, 18)
    .join(" ");

  return (history || [])
    .slice(-20)
    .some((item: any) => {
      const role = normalize(
        item?.role ||
        item?.sender_type ||
        item?.type ||
        item?.from_role ||
        item?.author ||
        ""
      );

      const isBotMessage =
        !role ||
        ["assistant", "model", "bot", "ai", "agent", "system bot"].includes(role);

      if (!isBotMessage) return false;

      const content = historyText(item);
      if (!content) return false;

      const normalizedContent = normalize(content);

      return (
        content === copy ||
        content.startsWith(copy) ||
        content.includes(copy) ||
        (
          copyFingerprint.length >= 40 &&
          normalizedContent.includes(copyFingerprint)
        )
      );
    });
}

function isCatalogCopyHistoryMessage(text: string, parsed: ParsedTraining) {
  const raw = clean(text);
  if (!raw) return false;

  return parsed.products.some((product) => {
    const copy = clean(product.salesCopy || "");
    if (!copy) return false;

    return raw === copy || raw.startsWith(copy + "\n") || raw.includes(copy);
  });
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
    if (isCatalogCopyHistoryMessage(content, parsed)) continue;
    if (!isRealSalesTemplateMessage(content) && !isSafeTemplatePricingMessage(content) && !isStructuredSalesTemplateMessage(content)) continue;

    const pricing = detectTemplatePricingSmart(content, parsed, true);
    if (pricing) return pricing;
  }

  return null;
}

function forceTemplatePricingProduct(templatePricing: TemplatePricing | null, product: ProductItem | string | null): TemplatePricing | null {
  if (!templatePricing || !product) return templatePricing;

  const productItem = typeof product === "string" ? null : product;
  const productName = typeof product === "string" ? product : product.canonical;
  if (!productName) return templatePricing;

  const sourceOffers = templatePricing.offers || [];
  const filteredOffers = productItem
    ? sourceOffers.filter((o) => isPlausibleOfferForProduct(o, productItem))
    : sourceOffers;

  if (productItem && !filteredOffers.length) return null;

  return {
    ...templatePricing,
    product: productName,
    offers: filteredOffers.map((o) => ({
      ...o,
      product: productName,
    })),
    fixed_quantity: filteredOffers.some((o) => o.fixed_quantity),
  };
}

function hasExplicitProductInterestPhrase(text: string) {
  const n = normalize(text);
  if (!n) return false;

  return /\b(me|mi)\s+intere(?:sa|za)|\bquiero(?:\s+comprar|\s+llevar)?|\bprecio|\bcuanto|\bconfirmar|\bagendar|\bcomprar|\bnecesito|\bconsulta|\binfo(?:rmacion)?\b/.test(n);
}

function isStrongNewPurchaseReply(text: string) {
  const n = normalize(text);
  return /^(quiero|lo quiero|quiero ese|quiero eso|quiero confirmar|confirmar|si quiero|sí quiero|comprar|compro|quiero comprar|quiero llevar|llevo|reservar|reservame|agendar|agendame|confirmo)$/.test(n);
}

function isShortAcknowledgement(text: string) {
  return isPoliteClosingOrAcknowledgement(text);
}

function buildDeterministicAcknowledgementResponse(text: string, state: ConversationState) {
  if (!isShortAcknowledgement(text)) return "";

  const n = normalize(text);
  const isThanks = /\b(gracias|muchas gracias|🙏)\b/.test(n) || clean(text) === "🙏";
  const friendlyLead = isThanks
    ? "¡Con mucho gusto! 😊"
    : "¡Perfecto! 😊";

  if (state.step === "pedido_confirmado") {
    return isThanks
      ? "¡Con mucho gusto! 😊 Gracias por tu compra. Tu pedido ya quedó agendado y estaremos coordinando la entrega. 🚚📦"
      : "¡Perfecto! 😊 Tu pedido ya quedó confirmado y agendado. 🚚📦";
  }

  let continuation = "";
  if (!state.order.product) {
    continuation = "¿Qué producto te interesa?";
  } else if (!state.order.city) {
    continuation = "📍 Para continuar, ¿para qué ciudad sería el envío?";
  } else if (!state.order.quantity && !state.order.locked_offer?.fixed_quantity) {
    continuation = "¿Cuántas unidades querés llevar?";
  } else if (!state.order.customer_name) {
    continuation = "Para completar el pedido, pasame tu nombre y apellido.";
  } else if (state.coverage !== false && !state.order.address) {
    continuation = "Ahora pasame la dirección exacta o ubicación para la entrega.";
  }

  return `${friendlyLead}${continuation ? `\n\n${continuation}` : ""}`;
}

function isConversationClosing(text: string) {
  const n = normalize(text);
  if (!n) return false;

  return /^(nada mas|nada más|nada|solo eso|solo eso gracias|eso es todo|eso seria|eso sería|eso nomas|eso nomás|no gracias|no nada mas|no nada más|ninguna consulta|ninguna duda|sin consulta|sin dudas|todo bien|ya esta|ya está|gracias nada mas|gracias nada más|gracias eso es todo|ok gracias|dale gracias|listo gracias|perfecto gracias)$/.test(n);
}

function isPostSaleQuestion(text: string) {
  const n = normalize(text);

  return (
    /\?/.test(text) ||
    /\b(factura|boleta|comprobante|recibo|ruc|razon social|razón social|cedula|cédula|ci|datos fiscales|datos bancarios|datos para transferir|datos para pagar|datos de transferencia|numero de cuenta|número de cuenta|cuenta bancaria|cual es el alias|cual es la cuenta|cuando|cuándo|llega|llego|llegaria|llegaría|entrega|delivery|envio|envío|demora|tarda|horario|hora|garantia|garantía|cambio|cambiar|direccion|dirección|telefono|teléfono|pagar|pago|efectivo|transferencia|delivery|seguimiento|estado|cancelar|anular)\b/.test(n)
  );
}

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

  const asksBankDataDirectly =
    /\b(datos bancarios|datos para transferir|datos para pagar|datos de transferencia|numero de cuenta|número de cuenta|cuenta bancaria|pasame los datos|dame los datos|cual es el alias|cual es la cuenta)\b/.test(n);

  if (asksBankDataDirectly) {
    return `💵 ¡Claro! Estos son los datos para transferir:\n\n${bankDataText(parsed)}\n\n📎 Cuando hagas la transferencia, pasame el comprobante así queda todo registrado 😊`;
  }

  const asksFreeDelivery =
    /\b(delivery|deli?very|drlivery|envio|envío)\b[\s\S]{0,25}\b(gratis|grati|gratuito|grayis)\b/.test(n) ||
    /\b(gratis|grati|gratuito|grayis)\b[\s\S]{0,25}\b(delivery|deli?very|drlivery|envio|envío)\b/.test(n);

  if (asksFreeDelivery) {
    if (hasCoverage(order.city || "", parsed)) {
      return `✅ Sí, el envío a ${order.city || "tu ciudad"} es GRATIS y pagás al recibir. 🚚😊`;
    }
    return `🚚 Hasta ${order.city || "tu zona"} enviamos por transportadora; el costo se coordina según la agencia y el destino.`;
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

  const hasCurrentBuyIntent = isGenericBuyReply(raw) || isBuyIntent(raw) || hasTemplateBuyIntent(raw);
  const pricingFromHistory = hasCurrentBuyIntent ? getTemplatePricingFromHistory(history, parsed) : null;
  const lastTemplateProduct = hasCurrentBuyIntent ? (getProductFromLastPromotion(history, parsed)?.canonical || "") : "";
  const effectivePricing = pricingInMessage || pricingFromHistory;

  const pastedTemplate =
    isPromotionLikeMessage(raw) ||
    !!pricingInMessage;

  const productInterest =
    !!productInMessage &&
    hasExplicitProductInterestPhrase(raw);

  const wantsLastTemplate =
    hasCurrentBuyIntent &&
    !!lastTemplateProduct;

  return {
    isNew: Boolean(pastedTemplate || productInterest || wantsLastTemplate),
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
    hasExplicitProductInterestPhrase(texto);

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

  const explicitQuantityReply = extractQuantity(texto) > 0;
  const activeIncompleteOrder =
    !!oldOrder.product &&
    context?.step !== "pedido_confirmado" &&
    ["collecting_city", "collecting_quantity", "collecting_name", "collecting_address", "collecting_phone"].includes(context?.step || "");

  if (explicitQuantityReply && activeIncompleteOrder && !productChanged) {
    return false;
  }

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

function looksLikeSentenceNotCity(text: string) {
  const n = normalize(text);
  return (
    isQuestionLikeMessage(text) ||
    isTemporalDeliveryExpression(n) ||
    /\b(me interesa|te interesa|interesa|quiero|necesito|cuanto|cuánto|cuesta|precio|tienen|tenes|tenés|hay|dame|mandame|reservame|consulta|informacion|información|hola|buenas|gracias|comprar|compro|de donde|donde son|donde estan|como funciona|que trae|garantia|original|datos|pasas|pasame|pásame|paso los|pagos|pago|pagar|cuenta|transferencia|alias|banco|comprobante|factura|numero de cuenta|número de cuenta)\b/.test(n)
  );
}

function hasPaymentProofText(text: string) {
  const n = normalize(text);
  return /\b(comprobante|transferi|transferí|transferencia hecha|ya pague|ya pagué|deposito|depósito|pague|pagué|adjunto|envio comprobante|envío comprobante|recibo)\b/.test(n);
}

function hasPaymentProof(context: any, text: string, mediaUrl?: string, mediaType?: string) {
  const url = clean(mediaUrl);
  const type = clean(mediaType);

  if (!url) return false;

  const typeLooksLikeProof = /image|document|pdf|application|octet-stream/i.test(type);
  const urlLooksLikeProof = /\.(jpg|jpeg|png|webp|pdf)(?:\?|$)/i.test(url);

  return Boolean(typeLooksLikeProof || urlLooksLikeProof);
}

function isSameOrderForPaymentProof(oldOrder: OrderData, newOrder: OrderData) {
  if (!oldOrder?.payment_proof_received) return false;

  const sameProduct = normalize(oldOrder.product) === normalize(newOrder.product);
  const sameCity = normalize(oldOrder.city) === normalize(newOrder.city);
  const sameQuantity = sanitizeQuantity(oldOrder.quantity) === sanitizeQuantity(newOrder.quantity);
  const sameOrderId = clean(oldOrder.order_id) && clean(oldOrder.order_id) === clean(newOrder.order_id);

  return Boolean(sameProduct && sameCity && sameQuantity && (sameOrderId || !clean(newOrder.order_id)));
}

function nextStep(order: OrderData, coverage: boolean | null) {
  if (!order.product) return "selling";
  if (!order.city) return "collecting_city";

  if (!order.quantity && order.locked_offer?.fixed_quantity) {
    order.quantity = order.locked_offer.quantity;
  }

  if (!order.quantity) return "collecting_quantity";

  if (coverage === false) {
    if (!order.customer_name) return "collecting_name";
    if (!order.payment_proof_received) return "waiting_payment_proof";
    return "confirm_order";
  }

  if (!order.customer_name) return "collecting_name";
  if (!order.address) return "collecting_address";
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

  if (productInfo.fixedPackQuantity && productInfo.price1) {
    return `Pack fijo: ${productInfo.fixedPackQuantity} unidades por ${formatGs(productInfo.price1)} Gs. No se vende por unidad.`;
  }

  if (templatePricing && normalize(templatePricing.product) === normalize(productInfo.canonical)) {
    const fixed = getFixedTemplateOffer(templatePricing, productInfo.canonical);
    if (fixed && isPlausibleOfferForProduct(fixed, productInfo)) {
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

  if (
    lockedOffer &&
    lockedOffer.source === "template" &&
    normalize(lockedOffer.product) === normalize(productInfo.canonical) &&
    lockedOffer.quantity > 0 &&
    lockedOffer.total > 0 &&
    isPlausibleOfferForProduct(lockedOffer, productInfo)
  ) {
    return lockedOffer.fixed_quantity
      ? `Pack fijo: ${lockedOffer.quantity} unidades por ${formatGs(lockedOffer.total)} Gs. No se vende por unidad.`
      : `${lockedOffer.quantity} unidad${lockedOffer.quantity > 1 ? "es" : ""}: ${formatGs(lockedOffer.total)} Gs`;
  }

  if (
    lockedOffer &&
    normalize(lockedOffer.product) === normalize(productInfo.canonical) &&
    lockedOffer.quantity > 0 &&
    lockedOffer.total > 0 &&
    isPlausibleOfferForProduct(lockedOffer, productInfo)
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
      return "Informar total, explicar envío por transportadora y pago anticipado. Mostrar datos de transferencia porque ya hay cantidad. Pedir SOLO lo faltante: nombre completo, teléfono y/o comprobante de transferencia. Si el cliente pidió fecha/horario/pagar después, aclarar que queda anotado como observación. IMPORTANTE: no confirmar el pedido hasta recibir comprobante.";
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

  if (!o.product || !o.city || !o.quantity || !o.customer_name) {
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

function hasAllRequiredOrderDataForDirectConfirmation(state: ConversationState) {
  const o = state.order;

  const hasBaseData = Boolean(
    clean(o.product) &&
    clean(o.city) &&
    sanitizeQuantity(o.quantity) > 0 &&
    clean(o.customer_name)
  );

  if (!hasBaseData) return false;

  if (!state.productInfo) return false;

  if (state.coverage !== false) {
    return Boolean(clean(o.address));
  }

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
  if (isGenericProductLabel(order.product)) return null;
  const canonicalProduct = getProductInfo(order.product, parsed)?.canonical || "";
  if (!canonicalProduct) return null;
  order.product = canonicalProduct;

  if (!order.phone) order.phone = senderPhoneFallback(from);

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
    observation: order.observation || null,
    observacion: order.observation || null,
    preferred_delivery_date: order.preferred_delivery_date || null,
    preferred_delivery_time: order.preferred_delivery_time || null,
    payment_note: order.payment_note || null,
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

function isGeminiQuotaErrorPayload(data: any) {
  const raw = JSON.stringify(data || {}).toLowerCase();
  return (
    raw.includes("resource_exhausted") ||
    raw.includes("quota") ||
    raw.includes("rate-limits") ||
    raw.includes("429")
  );
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

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    console.error("❌ Gemini:", JSON.stringify(data).slice(0, 800));
    if (r.status === 429 || isGeminiQuotaErrorPayload(data)) return "__GEMINI_QUOTA_EXCEEDED__";
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

async function transcribeAudioWithOpenAI({
  audioBase64,
  mime,
}: {
  audioBase64: string;
  mime: string;
}) {
  const apiKey = clean(process.env.OPENAI_API_KEY || "");
  if (!apiKey) return "";

  try {
    const ext = mime.includes("mpeg") ? "mp3" : mime.includes("mp4") ? "mp4" : mime.includes("wav") ? "wav" : mime.includes("webm") ? "webm" : "ogg";
    const buffer = Buffer.from(audioBase64, "base64");
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("language", "es");
    form.append("response_format", "json");
    form.append("file", new Blob([buffer], { type: mime || "audio/ogg" }), `audio.${ext}`);

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("❌ OpenAI Whisper:", JSON.stringify(data).slice(0, 800));
      return "";
    }

    return clean(data?.text || "");
  } catch (err) {
    console.error("❌ OpenAI Whisper exception:", err);
    return "";
  }
}

async function transcribeAudioSmart({
  apiKey,
  model,
  audioBase64,
  mime,
}: any) {
  const geminiText = await transcribeAudioWithGemini({ apiKey, model, audioBase64, mime });
  if (geminiText && geminiText !== "__GEMINI_QUOTA_EXCEEDED__") {
    return { text: geminiText, reason: "gemini" };
  }

  const openAiText = await transcribeAudioWithOpenAI({ audioBase64, mime });
  if (openAiText) return { text: openAiText, reason: "openai_whisper" };

  if (geminiText === "__GEMINI_QUOTA_EXCEEDED__") {
    return { text: "", reason: "gemini_quota" };
  }

  return { text: "", reason: "transcription_failed" };
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
💰 Total: ${formatGs(state.total)} Gs${observationBlock(o)}

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
💰 Total: ${formatGs(state.total)} Gs${observationBlock(o)}

🚚 Envío GRATIS · Pagás al recibir

🚚 Tu pedido queda agendado para la próxima ronda de envíos. Si pagás al recibir, el delivery lo confirma al llegar a tu zona.

⏰ Oferta válida hoy

¡Gracias por elegirnos!!! 💜✨

💵 Podés pagar en EFECTIVO o TRANSFERENCIA AL DELIVERY cuando recibas tu producto. ¡Como te quede más cómodo! 🚚

¡Gracias por tu compra! 🛍️✨


Podés pedir cualquier producto con el mismo proceso rápido y seguro. ¡Te esperamos! 💜`;
}

function deterministicAfterCityCoverageMessage(state: ConversationState) {
  const o = state.order;
  if (!o.product || !o.city) return "";

  // Los packs fijos usan un mensaje más completo en otra función.
  if (o.locked_offer?.fixed_quantity) return "";

  if (state.coverage === false) {
    if (!o.quantity) {
      return `😊 Gracias. Hasta ${o.city} podemos enviarte por transportadora.

🚚 Para este tipo de envío trabajamos con pago anticipado.

¿Cuántas unidades querés llevar?`;
    }

    return `😊 Gracias. Hasta ${o.city} podemos enviarte por transportadora.

🚚 Para este tipo de envío trabajamos con pago anticipado.

Para continuar, pasame tu nombre completo y número de celular.`;
  }

  if (!o.quantity) {
    return `✅ Tenemos cobertura en ${o.city} 😊

¿Cuántas unidades querés llevar?`;
  }

  return "";
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

📍 ${o.city} tiene envío GRATIS y pagás al recibir 🚚${observationBlock(o)}

Ahora solo necesito:
✅ nombre y apellido
✅ dirección exacta o ubicación
✅ número de celular (opcional; si no lo pasás usamos este WhatsApp) 📲`;
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
📍 Ciudad: ${o.city}${observationBlock(o)}

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
✅ número de celular (opcional; si no lo pasás usamos este WhatsApp) 📲`;
}

function deterministicWaitingPaymentProofMessage(state: ConversationState, parsed: ParsedTraining) {
  const o = state.order;
  if (state.coverage !== false) return "";
  if (state.step !== "waiting_payment_proof") return "";
  if (!o.product || !o.city || !o.quantity || !o.customer_name || !o.phone) return "";

  return `✅ Perfecto, ya tengo tus datos 😊

📦 Producto: ${o.product}
🔢 Cantidad: ${o.quantity}
💰 Total: ${formatGs(state.total)} Gs
📍 Ciudad: ${o.city}
👤 Cliente: ${o.customer_name}
📞 Celular: ${o.phone}${observationBlock(o)}

🚚 Para tu zona hacemos envío por transportadora con pago anticipado.

📎 Para CONFIRMAR tu pedido necesito que me envíes la foto/PDF del comprobante de transferencia.

${bankDataText(parsed)} 📲

Cuando me pases el comprobante, dejamos tu pedido confirmado 😊`;
}

function deterministicObservationAckMessage(state: ConversationState, parsed: ParsedTraining, observationPatch?: Partial<OrderData> | null) {
  if (!hasOrderObservation(observationPatch || {})) return "";

  const o = state.order;
  const obs = observationBlock(o);
  const intro = `Perfecto 😊 dejé anotada esa observación para tu pedido.${obs}`;

  if (state.coverage === false && state.step === "waiting_payment_proof") {
    const proofMsg = deterministicWaitingPaymentProofMessage(state, parsed);
    if (proofMsg) return proofMsg;
  }

  if (!o.product) {
    return `${intro}\n\nPara ayudarte bien, decime qué producto te interesa 😊`;
  }

  if (!o.city) {
    return `${intro}\n\n📍 ¿Para qué ciudad sería el envío? 😊`;
  }

  if (!o.quantity) {
    return `${intro}\n\n¿Cuántas unidades querés llevar? 😊`;
  }

  if (state.coverage === false && !o.payment_proof_received) {
    return `${intro}\n\n🚚 Para tu zona hacemos envío por transportadora con pago anticipado.\n\nPara avanzar, enviame por favor:\n✅ nombre completo\n✅ número de celular\n✅ comprobante de transferencia\n\n${bankDataText(parsed)} 📲`;
  }

  if (state.missing.length) {
    return `${intro}\n\n📦 Producto: ${o.product}\n🔢 Cantidad: ${o.quantity}\n💰 Total: ${formatGs(state.total)} Gs\n📍 Ciudad: ${o.city}\n\nPara agendarlo, me falta:\n✅ ${state.missing.join("\n✅ ")} 📲`;
  }

  return `${intro}\n\n✅ Tengo todos los datos del pedido. Nuestro equipo tendrá en cuenta esa observación para coordinar 😊`;
}

function buildSalesSystemPrompt(parsed: ParsedTraining, state: ConversationState, templatePricing?: TemplatePricing | null, copyAlreadySent = false) {
  const o = state.order;

  return `
Sos la IA vendedora de Mega Todo Store / One Store.
Tu trabajo es vender de forma natural, amable y segura por WhatsApp. Cuando hay copy de producto cargado, debés respetarlo completo la PRIMERA vez que se presenta.

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
- Observación del cliente: ${observationLines(o).length ? observationLines(o).join(" | ") : "sin observación"}

FUENTE DE PRODUCTO / CANTIDAD / PRECIO:
${catalogForPrompt(parsed, state, templatePricing)}

PRECIO/PROMO DEL PRODUCTO ACTUAL:
${productPriceText(state.productInfo, o.locked_offer, templatePricing) || "Sin producto actual."}

${
  state.productInfo?.salesCopy
    ? copyAlreadySent
      ? `COPY DE VENTA DE ESTE PRODUCTO (SOLO DE REFERENCIA — YA SE LO ENVIASTE COMPLETO en un mensaje anterior. NO LO REPITAS de nuevo. Respondé breve y avanzá directo hacia el siguiente dato faltante del ESTADO DEL PEDIDO, usando como mucho el nombre del producto y el precio si hace falta mencionarlo):
"""
${state.productInfo.salesCopy}
"""
`
      : `COPY DE VENTA ORIGINAL DE ESTE PRODUCTO (OBLIGATORIO: enviarlo COMPLETO, sin resumir, sin cortar y sin quitar párrafos, porque es la PRIMERA vez que se presenta este producto. El PRECIO final que menciones debe ser EXACTAMENTE el de "PRECIO/PROMO DEL PRODUCTO ACTUAL" de arriba, nunca inventes ni cambies un número):
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
- Si el COPY DE VENTA ya se envió antes (ver arriba), NO lo repitas: avanzá directo al siguiente paso del pedido con una respuesta breve y natural.
- Si es la primera vez que se presenta el producto (copy NO enviado todavía) y hay COPY DE VENTA ORIGINAL, NO lo resumas, NO lo acortes y NO le quites partes: enviá el copy completo aunque sea largo.
- No digas que sos IA.
- No menciones backend, sistema ni estado interno.
- No inventes productos, precios, bancos, cuentas, enlaces, ciudades ni tiempos.
- PROHIBIDO inventar ciudad. Si Ciudad = faltante, preguntá ciudad.
- Una consulta del cliente (por ejemplo: "¿de dónde son?", "¿cómo funciona?", "¿tiene garantía?") NO es una ciudad ni un dato del pedido.
- Si el cliente hace una consulta durante la compra: respondé primero la consulta usando SOLO el entrenamiento disponible y después retomá exactamente el siguiente dato faltante del ESTADO DEL PEDIDO.
- Si después de responder la consulta todavía falta ciudad, preguntá ciudad. No menciones transportadora, falta de cobertura ni pago anticipado hasta tener una ciudad real.
- Si Ciudad ya tiene valor en ESTADO DEL PEDIDO, PROHIBIDO volver a preguntar ciudad.
- PROHIBIDO usar ciudad vieja si no aparece en ESTADO DEL PEDIDO.
- Si falta producto, ofrecé catálogo/productos.
- Si falta ciudad, preguntá ciudad (variá la frase, no uses siempre la misma).
- Si falta cantidad, preguntá cantidad.
- Si la plantilla dice Producto + Cantidad + Precio, pack fijo, combo fijo, no se vende por unidad o únicamente por pack: NO preguntes cantidad, respetá cantidad y precio de la plantilla.
- Si hay promo variable de 2 unidades y el cliente no especificó cantidad, NO asumas 1 unidad ni 2 unidades: preguntá si quiere 1 unidad o la promo.
- Si el cliente pide fecha, horario, pagar cuando cobre, llamar antes o coordinar entrega, guardalo como observación y continuá cerrando la venta. No cortes la venta por eso.
- Si hay observación, mencionála de forma natural como “lo dejamos anotado en observación”.
- Si faltan datos, pedí SOLO lo faltante.
- Si no hay cobertura y todavía falta cantidad, NO muestres datos bancarios.
- Si no hay cobertura y ya hay cantidad, podés mostrar datos de transferencia.
- Si hay cobertura, indicar envío gratis contra-entrega cuando corresponda.
- Si el cliente pregunta precio, respondé precio y guiá al siguiente paso.
- Si el cliente pide explícitamente los datos bancarios/de transferencia (aunque haya cobertura), dáselos directamente, no repitas "podés pagar efectivo o transferencia al delivery" sin dar el dato pedido.
- PRIORIDAD DE PRECIOS:
  1) Si hay plantilla activa, usá SOLO producto, cantidad y precio de la plantilla.
  2) Mientras haya plantilla activa, PROHIBIDO usar CATALOGO_PRODUCTOS del entrenamiento para precio/cantidad/producto.
  3) No ofrezcas 1 unidad si la plantilla solo muestra pack de 2.
  4) No ofrezcas packs/promos del entrenamiento si no aparecen en la plantilla.
  5) No recalcules total multiplicando precio de plantilla por cantidad.
  6) Solo usá el catálogo del entrenamiento cuando NO exista plantilla activa.
- Nunca uses números de dirección, teléfono o calle como precio.
- Nunca inventes otro producto. Si llegó plantilla nueva, es venta nueva.
- Después de pedido confirmado, responder postventa si pregunta factura/entrega/pago/garantía.
- Si hay promo bloqueada desde plantilla, respetala y confirmala.
- Si no hay plantilla activa ni promo bloqueada, mostrar precios del catálogo.
- Nunca recalcules diferente al total calculado.
- Nunca preguntes "¿Está todo correcto?" si ya están todos los datos. Si el pedido está completo, el backend responde directamente con ✅ PEDIDO CONFIRMADO y no se llama a Gemini.
- En ciudad sin contra-entrega, NO confirmar hasta que payment_proof_received sea true.
`.trim();
}

function buildFullProductCopyResponse(state: ConversationState, _templatePricing?: TemplatePricing | null) {
  const copy = clean(state.productInfo?.salesCopy || "");
  if (!copy) return "";

  return `${copy}

📍 ¿Para qué ciudad sería el envío? 😊`;
}

// ✅ FIX V46: para consultas de precio posteriores al copy, responde solo precios
// y avanza al siguiente dato pendiente, sin repetir el anuncio completo.
function buildPriceOnlyResponse(
  state: ConversationState,
  templatePricing?: TemplatePricing | null
) {
  const productInfo = state.productInfo;
  if (!productInfo) return "";

  const priceText = productPriceText(
    productInfo,
    state.order.locked_offer,
    templatePricing
  );

  if (!priceText) return "";

  let continuation = "";

  if (!state.order.city) {
    continuation = "📍 ¿Para qué ciudad sería el envío? 😊";
  } else if (!state.order.quantity && !state.order.locked_offer?.fixed_quantity) {
    continuation = "¿Cuántas unidades querés llevar? 😊";
  } else if (!state.order.customer_name) {
    continuation = "Para continuar, pasame tu nombre y apellido. 😊";
  } else if (state.coverage !== false && !state.order.address) {
    continuation = "Ahora pasame la dirección exacta o ubicación para la entrega. 😊";
  } else if (!state.order.phone) {
    continuation = "Por último, pasame un número de celular para coordinar la entrega. 😊";
  }

  return `🔥 Precio de hoy:
${priceText}${continuation ? `

${continuation}` : ""}`;
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
    const copy = state.productInfo?.salesCopy;
    const priceLine = productPriceText(state.productInfo, o.locked_offer, templatePricing);
    return copy
      ? `${copy.trim()}\n\n📍 ¿Para qué ciudad sería el envío? 😊`
      : `¡Excelente elección! 🔥

${state.productInfo?.canonical || o.product}
${priceLine}

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
📍 Ciudad: ${o.city}${observationBlock(o)}

Para agendarlo, me falta:
✅ ${state.missing.join("\n✅ ")} 📲`;
  }

  return `✅ PEDIDO CONFIRMADO

📦 Producto: ${o.product}
🔢 Cantidad: ${o.quantity}
💰 Total: ${formatGs(state.total)} Gs
👤 Cliente: ${o.customer_name}
📍 Ciudad: ${o.city}
📞 Teléfono: ${o.phone}${o.address ? `\n🏠 Dirección: ${o.address}` : ""}${observationBlock(o)}

¡Gracias por tu compra! 💜`;
}

function postProcessResponse(resp: string) {
  return clean(resp)
    .replace(/\n{4,}/g, "\n\n");
}

function extractIncomingText(body: any) {
  const candidates = [
    body?.message,
    body?.text,
    body?.body,
    body?.caption,
    body?.transcription,
    body?.transcript,
    body?.audio_transcription,
    body?.audioTranscript,
    body?.speech_to_text,
    body?.speechText,
    body?.voice_text,
    body?.voiceText,
    body?.whisper_text,
    body?.whisperText,
    body?.data?.message,
    body?.data?.text,
    body?.data?.body,
    body?.data?.caption,
    body?.data?.transcription,
    body?.data?.transcript,
    body?.message?.text,
    body?.message?.body,
    body?.message?.caption,
    body?.message?.transcription,
    body?.message?.transcript,
    body?.audio?.text,
    body?.audio?.transcription,
    body?.audio?.transcript,
    body?.voice?.text,
    body?.voice?.transcription,
    body?.voice?.transcript,
    body?.data?.audio?.text,
    body?.data?.audio?.transcription,
    body?.data?.audio?.transcript,
    body?.data?.voice?.text,
    body?.data?.voice?.transcription,
    body?.data?.voice?.transcript,
  ];

  for (const c of candidates) {
    const value = clean(c);
    if (value) return value;
  }

  return "";
}

function firstHttpUrl(...values: any[]) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = firstHttpUrl(...value);
      if (found) return found;
      continue;
    }

    const v = clean(value);
    if (/^https?:\/\//i.test(v)) return v;
  }

  return "";
}

function extractMediaInfo(body: any) {
  const mediaUrl = firstHttpUrl(
    body?.media_url,
    body?.mediaUrl,
    body?.media,
    body?.url,
    body?.file_url,
    body?.fileUrl,
    body?.download_url,
    body?.downloadUrl,
    body?.audio_url,
    body?.audioUrl,
    body?.voice_url,
    body?.voiceUrl,
    body?.ptt_url,
    body?.pttUrl,
    body?.data?.media_url,
    body?.data?.mediaUrl,
    body?.data?.url,
    body?.data?.file_url,
    body?.data?.download_url,
    body?.message?.media_url,
    body?.message?.mediaUrl,
    body?.message?.url,
    body?.message?.file_url,
    body?.message?.download_url,
    body?.audio?.url,
    body?.audio?.media_url,
    body?.audio?.mediaUrl,
    body?.audio?.file_url,
    body?.audio?.download_url,
    body?.voice?.url,
    body?.voice?.media_url,
    body?.voice?.mediaUrl,
    body?.voice?.file_url,
    body?.voice?.download_url,
    body?.data?.audio?.url,
    body?.data?.audio?.media_url,
    body?.data?.audio?.mediaUrl,
    body?.data?.voice?.url,
    body?.data?.voice?.media_url,
    body?.data?.voice?.mediaUrl
  );

  const mediaType = clean(
    body?.media_type ||
      body?.mediaType ||
      body?.message_type ||
      body?.messageType ||
      body?.type ||
      body?.data?.media_type ||
      body?.data?.message_type ||
      body?.data?.type ||
      body?.message?.media_type ||
      body?.message?.type ||
      body?.audio?.type ||
      body?.voice?.type ||
      (body?.audio ? "audio" : "") ||
      (body?.voice ? "voice" : "")
  );

  const mimeType = clean(
    body?.mime_type ||
      body?.mimeType ||
      body?.mimetype ||
      body?.media_mime_type ||
      body?.data?.mime_type ||
      body?.data?.mimeType ||
      body?.message?.mime_type ||
      body?.message?.mimeType ||
      body?.audio?.mime_type ||
      body?.audio?.mimeType ||
      body?.voice?.mime_type ||
      body?.voice?.mimeType ||
      ""
  );

  return { media_url: mediaUrl, media_type: mediaType, mime_type: mimeType };
}

function isAudioLikeMedia({
  media_url,
  media_type,
  mime_type,
}: {
  media_url?: string;
  media_type?: string;
  mime_type?: string;
}) {
  const mt = normalize(media_type || "");
  const mime = clean(mime_type || "").toLowerCase();

  return Boolean(
    clean(media_url) &&
      (
        mt === "audio" ||
        mt === "voice" ||
        mt === "ptt" ||
        mt === "nota de voz" ||
        mt.includes("audio") ||
        mt.includes("voice") ||
        mt.includes("ptt") ||
        mime.startsWith("audio/")
      )
  );
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
    } = req.body;

    const mediaInfo = extractMediaInfo(req.body);
    const media_url = mediaInfo.media_url;
    const media_type = mediaInfo.media_type;
    const mime_type = mediaInfo.mime_type;

    let texto = extractIncomingText(req.body);
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

    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    const audioLike = isAudioLikeMedia({ media_url, media_type, mime_type });

    if (audioLike && !texto) {
      const fetched = await fetchMediaAsBase64(clean(media_url));
      let transcriptionReason = "no_media";

      if (fetched) {
        const transcribed = await transcribeAudioSmart({
          apiKey,
          model,
          audioBase64: fetched.data,
          mime: clean(mime_type) || fetched.mime || "audio/ogg",
        });

        texto = clean(transcribed.text);
        transcriptionReason = transcribed.reason;
      }

      if (!texto) {
        const noQuota = transcriptionReason === "gemini_quota";
        return res.json({
          response: noQuota
            ? "🎧 Recibí tu audio, pero el transcriptor está sin cuota en este momento. Escribime por texto, por favor, así sigo con tu pedido 😊"
            : "🎧 Recibí tu audio, pero no pude leerlo automáticamente. ¿Podés escribirme por texto, por favor? 😊",
          context: {
            ...(context || {}),
            audio_pending_text: true,
            audio_transcription_reason: transcriptionReason,
            updated_at: new Date().toISOString(),
          },
        });
      }

      console.log(`🎧 Audio transcripto (${transcriptionReason}): ${texto.slice(0, 160)}`);
    }

    const allTraining = await getAllTrainingData(user_id);
    const trainingText = buildTrainingText(allTraining);
    const parsed = parseTraining(trainingText);

    const visualProducts = productsFromVisualCatalog(allTraining);
    parsed.products = mergeProductsByPriority(visualProducts, parsed.products);

    attachProductImages(parsed.products, allTraining);

    const productsMentionedNow = detectProductsMentioned(texto, parsed);
    let activeMultiCart = getMultiCartFromContext(context, parsed);

    // V57: iniciar carrito multiproducto con respuesta breve.
    // Si el cliente ya indicó cantidades (ej. "1 peladora y 1 afilador"),
    // no repetimos información: calculamos el carrito y avanzamos.
    if (productsMentionedNow.length >= 2 && activeMultiCart.length === 0) {
      const existingOrder = sanitizeOldOrder(context?.order_data || {}, parsed);
      const multiOrderId = clean(context?.multi_order_id) || makeOrderId(fromNumber);
      activeMultiCart = applyQuantitiesToMultiCart(texto, createMultiCart(productsMentionedNow), parsed);
      const missingQty = multiCartMissingQuantities(activeMultiCart);
      const hasAnyNamedQuantity = activeMultiCart.some((item) => item.quantity > 0);

      if (missingQty.length === 0) {
        const nextStep = existingOrder.city ? "collecting_multiple_customer_data" : "collecting_multiple_city";
        return res.json({
          response: `${multiCartSummary(activeMultiCart)}\n\n${existingOrder.city ? "Ahora pasame tu nombre y apellido, dirección exacta. El celular es opcional; si no lo pasás usamos este WhatsApp. 📲" : "📍 ¿Para qué ciudad sería el envío? 😊"}`,
          context: {
            ...(context || {}),
            order_data: existingOrder,
            current_product: null,
            pending_multiple_products: productsMentionedNow.map((p) => p.canonical),
            multi_product_cart: activeMultiCart,
            multi_order_id: multiOrderId,
            step: nextStep,
            updated_at: new Date().toISOString(),
          },
          debug: {
            deterministic_multiple_products: true,
            products: productsMentionedNow.map((p) => p.canonical),
            quantities_received_in_first_message: true,
            preserved_city: existingOrder.city || null,
          },
        });
      }

      if (hasAnyNamedQuantity) {
        return res.json({
          response: `Perfecto 😊 Me falta la cantidad de:\n${missingQty.map((p) => `• ${p}`).join("\n")}\n\nEjemplo: “1 ${missingQty[0]}”.`,
          context: {
            ...(context || {}),
            order_data: existingOrder,
            current_product: null,
            pending_multiple_products: productsMentionedNow.map((p) => p.canonical),
            multi_product_cart: activeMultiCart,
            multi_order_id: multiOrderId,
            step: "collecting_multiple_product_quantities",
            updated_at: new Date().toISOString(),
          },
          debug: {
            deterministic_multiple_products: true,
            products: productsMentionedNow.map((p) => p.canonical),
            partial_quantities_received: true,
          },
        });
      }

      return res.json({
        response: buildMultipleProductsInformation(productsMentionedNow, existingOrder.city || ""),
        context: {
          ...(context || {}),
          order_data: existingOrder,
          current_product: null,
          pending_multiple_products: productsMentionedNow.map((p) => p.canonical),
          multi_product_cart: activeMultiCart,
          multi_order_id: multiOrderId,
          step: "collecting_multiple_product_quantities",
          updated_at: new Date().toISOString(),
        },
        debug: {
          deterministic_multiple_products: true,
          products: productsMentionedNow.map((p) => p.canonical),
          compact_promotions_presented: true,
          preserved_city: existingOrder.city || null,
        },
      });
    }

    if (activeMultiCart.length >= 2) {
      let commonOrder = sanitizeOldOrder(context?.order_data || {}, parsed);
      const multiOrderId = clean(context?.multi_order_id) || makeOrderId(fromNumber);
      activeMultiCart = applyQuantitiesToMultiCart(texto, activeMultiCart, parsed);
      const missingQty = multiCartMissingQuantities(activeMultiCart);

      if (context?.step === "collecting_multiple_product_quantities" || missingQty.length > 0) {
        if (missingQty.length > 0) {
          return res.json({
            response: `Perfecto 😊 Me falta la cantidad de:\n${missingQty.map((p) => `• ${p}`).join("\n")}\n\nPodés responder, por ejemplo: “1 ${missingQty[0]}”.`,
            context: {
              ...(context || {}),
              order_data: commonOrder,
              multi_product_cart: activeMultiCart,
              multi_order_id: multiOrderId,
              step: "collecting_multiple_product_quantities",
              updated_at: new Date().toISOString(),
            },
          });
        }

        const nextStep = commonOrder.city ? "collecting_multiple_customer_data" : "collecting_multiple_city";
        return res.json({
          response: `${multiCartSummary(activeMultiCart)}\n\n${commonOrder.city ? "Ahora pasame tu nombre y apellido, dirección exacta. El celular es opcional; si no lo pasás usamos este WhatsApp. 📲" : "📍 ¿Para qué ciudad sería el envío? 😊"}`,
          context: {
            ...(context || {}),
            order_data: commonOrder,
            multi_product_cart: activeMultiCart,
            multi_order_id: multiOrderId,
            step: nextStep,
            updated_at: new Date().toISOString(),
          },
        });
      }

      if (!commonOrder.city) {
        const detectedMultiCity = detectCity(texto, parsed, "");
        if (detectedMultiCity) commonOrder.city = detectedMultiCity;
        if (!commonOrder.city) {
          return res.json({
            response: "📍 ¿Para qué ciudad sería el envío? 😊",
            context: { ...(context || {}), order_data: commonOrder, multi_product_cart: activeMultiCart, multi_order_id: multiOrderId, step: "collecting_multiple_city", updated_at: new Date().toISOString() },
          });
        }
      }

      const phone = extractPhone(texto);
      const name = extractName(texto, commonOrder.city, phone, parsed);
      const address = extractAddress(texto, commonOrder.city, phone, name);
      if (name && !commonOrder.customer_name) commonOrder.customer_name = name;
      if (phone) commonOrder.phone = phone;
      if (!commonOrder.phone) commonOrder.phone = senderPhoneFallback(fromNumber);
      if (address) commonOrder.address = mergeAddressSupplement(commonOrder.address, address);

      const multiObservationPatch = extractOrderObservation(texto);
      Object.assign(commonOrder, mergeOrderObservation(commonOrder, multiObservationPatch));

      const missingData: string[] = [];
      if (!commonOrder.customer_name) missingData.push("nombre y apellido");
      if (!commonOrder.address) missingData.push("dirección exacta o ubicación");

      if (missingData.length > 0) {
        const coverage = hasCoverage(commonOrder.city, parsed);
        return res.json({
          response: `${coverage ? `✅ Tenemos cobertura en ${commonOrder.city}.` : `😊 Hasta ${commonOrder.city} podemos enviarte por transportadora.`}\n\n${multiCartSummary(activeMultiCart)}\n\nPara finalizar me falta:\n✅ ${missingData.join("\n✅ ")}`,
          context: { ...(context || {}), order_data: commonOrder, multi_product_cart: activeMultiCart, multi_order_id: multiOrderId, step: "collecting_multiple_customer_data", updated_at: new Date().toISOString() },
        });
      }

      await saveMultiProductOrders(user_id, fromNumber, activeMultiCart, commonOrder, parsed, multiOrderId);
      const coverage = hasCoverage(commonOrder.city, parsed);
      return res.json({
        response: `✅ PEDIDO CONFIRMADO\n\n${multiCartSummary(activeMultiCart)}\n\n👤 Cliente: ${commonOrder.customer_name}\n📍 Ciudad: ${commonOrder.city}\n🏠 Dirección: ${commonOrder.address}\n📞 Contacto: ${commonOrder.phone}${observationBlock(commonOrder)}\n\n${coverage ? "🚚 Envío contra entrega. Pagás al recibir." : "🚚 Envío por transportadora con pago anticipado."}\n\n¡Gracias por tu compra! 💜`,
        context: { ...(context || {}), order_data: commonOrder, multi_product_cart: activeMultiCart, multi_order_id: multiOrderId, step: "pedido_confirmado_multiple", updated_at: new Date().toISOString() },
        debug: { multi_product_order_confirmed: true, items: activeMultiCart.length, group_id: multiOrderId },
      });
    }

    const currentTemplatePricing = detectTemplatePricingSmart(texto, parsed);

    const newTemplateSignal = isNewTemplateOrProductIntent(texto, parsed, history);

    const recentExplicitProductInterest = getRecentExplicitProductInterestAfterConfirmed(history, parsed);
    const templateAfterExplicitProductInterest = recentExplicitProductInterest
      ? getTemplatePricingAfterHistoryIndex(history, parsed, recentExplicitProductInterest.index)
      : null;

    let templatePricing =
      currentTemplatePricing ||
      (templateAfterExplicitProductInterest
        ? forceTemplatePricingProduct(templateAfterExplicitProductInterest, recentExplicitProductInterest?.product || null)
        : getTemplatePricingFromHistory(history, parsed));

    let oldOrder = sanitizeOldOrder(context?.order_data || {}, parsed);

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

      const explicitNewPurchaseAfterConfirmed =
        hasCurrentTemplatePricing ||
        isNewPastedTemplatePurchase(texto, parsed) ||
        (!!productInClosedMessage && hasExplicitProductInterestPhrase(texto)) ||
        /\b(otro producto|nuevo pedido|hacer otro pedido|catalogo|catálogo|ver catalogo|ver catálogo|quiero comprar otra cosa)\b/.test(msgNormClosed) ||
        ((isStrongNewPurchaseReply(texto) || hasTemplateBuyIntent(texto)) && !!lastRealSalesTemplateProduct && !!lastRealSalesTemplatePricing);

      if (explicitNewPurchaseAfterConfirmed) {
        forceFreshOrderFromConfirmedTemplate = true;
        oldOrder = emptyOrder(makeOrderId(fromNumber));
      } else {
        // V52: después de confirmar, un dato adicional de ubicación (por ejemplo
        // "Barrio San Ramón") complementa la dirección. Nunca debe reemplazar
        // el nombre del cliente ni iniciar otro pedido.
        if (looksLikeAddressSupplement(texto)) {
          oldOrder.address = mergeAddressSupplement(oldOrder.address, texto);

          const updatedState = buildState(oldOrder, parsed);
          await safeUpsertOrder(user_id, fromNumber, oldOrder, parsed, true);

          return res.json({
            response: `✅ ¡Perfecto! Agregué este dato a tu dirección: ${clean(texto)}\n\n${finalConfirmationMessage(updatedState, parsed)}`,
            context: {
              ...(context || {}),
              order_data: oldOrder,
              order_id: oldOrder.order_id || null,
              step: "pedido_confirmado",
              updated_at: new Date().toISOString(),
            },
            debug: {
              post_confirmation_address_updated: true,
              preserved_customer_name: oldOrder.customer_name,
              updated_address: oldOrder.address,
            },
          });
        }

        if (isDeliveryTimingQuestion(texto)) {
          return res.json({
            response: buildDeliveryTimingQuestionResponse(texto, oldOrder),
            context: {
              ...(context || {}),
              order_data: oldOrder,
              order_id: oldOrder.order_id || null,
              step: "pedido_confirmado",
              updated_at: new Date().toISOString(),
            },
            debug: { post_confirmation_delivery_timing_question: true },
          });
        }

        const postConfirmationObservation = extractOrderObservation(texto);
        if (
          clean(postConfirmationObservation.observation) ||
          clean(postConfirmationObservation.preferred_delivery_date) ||
          clean(postConfirmationObservation.preferred_delivery_time) ||
          clean(postConfirmationObservation.payment_note)
        ) {
          Object.assign(
            oldOrder,
            mergeOrderObservation(oldOrder, postConfirmationObservation)
          );

          await safeUpsertOrder(user_id, fromNumber, oldOrder, parsed, true);

          return res.json({
            response: `📝 Perfecto, agregué esta observación a tu pedido: ${clean(texto)}\n\nEl delivery tendrá en cuenta la solicitud y te contactará para coordinar. 😊`,
            context: {
              ...(context || {}),
              order_data: oldOrder,
              order_id: oldOrder.order_id || null,
              step: "pedido_confirmado",
              updated_at: new Date().toISOString(),
            },
            debug: {
              post_confirmation_observation_updated: true,
              preserved_customer_name: oldOrder.customer_name,
              preserved_address: oldOrder.address,
            },
          });
        }

        if (isShortAcknowledgement(texto) || isConversationClosing(texto)) {
          return res.json({
            response: oldOrder.customer_name
              ? `¡Con mucho gusto, ${oldOrder.customer_name.split(/\s+/)[0]}! 😊 Tu pedido ya quedó confirmado y agendado. 🚚📦`
              : `¡Con mucho gusto! 😊 Tu pedido ya quedó confirmado y agendado. 🚚📦`,
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

    if ((newTemplateSignal.isNew || forceFreshOrderFromConfirmedTemplate) && context?.step === "pedido_confirmado") {
      freshOrder = true;
    }

    if (isShortAcknowledgement(texto) && context?.step !== "pedido_confirmado") {
      freshOrder = false;
    }

    // Una cantidad aislada (por ejemplo, "1" o "2 unidades") durante una
    // compra activa NO debe iniciar un pedido nuevo. De lo contrario se pierde
    // la ciudad ya confirmada y el bot vuelve a solicitarla.
    if (
      extractQuantity(texto) > 0 &&
      clean(oldOrder.product) &&
      context?.step !== "pedido_confirmado"
    ) {
      freshOrder = false;
    }

    // Una confirmación de ciudad pendiente también pertenece al pedido activo.
    if (
      clean(context?.pending_city_confirmation || "") &&
      isAffirmative(texto) &&
      context?.step !== "pedido_confirmado"
    ) {
      freshOrder = false;
    }

    if (freshOrder) {
      oldOrder = emptyOrder(makeOrderId(fromNumber));
    }

    const currentTemplateLockedOfferRaw = templatePricing?.product
      ? (getFixedTemplateOffer(templatePricing, templatePricing.product) || templatePricing.offers[0] || null)
      : null;

    const currentTemplateLockedOfferProductInfo = templatePricing?.product
      ? getProductInfo(templatePricing.product, parsed)
      : null;

    const currentTemplateLockedOffer =
      currentTemplateLockedOfferRaw && currentTemplateLockedOfferProductInfo
        ? (isPlausibleOfferForProduct(currentTemplateLockedOfferRaw, currentTemplateLockedOfferProductInfo)
            ? currentTemplateLockedOfferRaw
            : null)
        : currentTemplateLockedOfferRaw;

    let lockedOfferByContext = freshOrder
      ? (currentTemplateLockedOffer || getOfferFromLastPromotion(history, parsed))
      : getLockedOfferFromContext(context, oldOrder, history, parsed);

    let productToUse =
      currentTemplatePricing?.product ||
      ((isGenericBuyReply(texto) || isStrongNewPurchaseReply(texto) || hasTemplateBuyIntent(texto)) ? recentExplicitProductInterest?.product?.canonical || "" : "") ||
      productFromMessageInitial ||
      newTemplateSignal.product ||
      (!freshOrder ? oldOrder.product || "" : "") ||
      templatePricing?.product ||
      "";

    if (!productToUse && (isGenericBuyReply(texto) || promoResponse || isBuyIntent(texto))) {
      productToUse = templatePricing?.product || getProductFromLastPromotion(history, parsed)?.canonical || lockedProductInitial?.canonical || "";
    }

    if (!productToUse && !freshOrder) {
      productToUse = oldOrder.product || "";
    }

    let product = detectProduct(texto, parsed, productToUse);

    // V65: nunca permitir que títulos comerciales reemplacen el producto.
    // Se prioriza el producto canónico previamente válido o el detectado en el mensaje.
    const explicitCanonicalProduct = getProductInfo(detectProduct(texto, parsed, ""), parsed)?.canonical || "";
    const previousCanonicalProduct = getProductInfo(oldOrder.product || "", parsed)?.canonical || "";
    const candidateCanonicalProduct = getProductInfo(product || productToUse || "", parsed)?.canonical || "";
    product = explicitCanonicalProduct || previousCanonicalProduct || candidateCanonicalProduct || "";
    if (isGenericProductLabel(product)) product = "";

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

    if (explicitQty === 0 && productInfo) {
      const qtyFromPrice = extractQuantityFromPriceMention(texto, productInfo, templatePricing);
      if (qtyFromPrice > 0) explicitQty = qtyFromPrice;
    }

    if (
      explicitQty === 0 &&
      isAffirmative(texto) &&
      !isShortAcknowledgement(texto) &&
      context?.step === "collecting_quantity" &&
      productInfo &&
      !oldOrder.locked_offer &&
      !productInfo.price2 &&
      !productInfo.price3
    ) {
      explicitQty = 1;
    }

    let lockedOffer: OfferItem | null = null;

    if (productInfo) {
      const promoFromHistory = getOfferFromLastPromotion(history, parsed);
      const promoMatchesProduct = promoFromHistory && normalize(promoFromHistory.product) === normalize(productInfo.canonical);
      const fixedTemplateOfferRaw = getFixedTemplateOffer(templatePricing, productInfo.canonical);
      const fixedTemplateOffer = isPlausibleOfferForProduct(fixedTemplateOfferRaw, productInfo)
        ? fixedTemplateOfferRaw
        : null;
      const fixedCatalogOffer = getCatalogFixedPackOffer(productInfo);

      if (fixedTemplateOffer) {
        lockedOffer = fixedTemplateOffer;
        explicitQty = fixedTemplateOffer.quantity;
      } else if (fixedCatalogOffer) {
        lockedOffer = fixedCatalogOffer;
        explicitQty = fixedCatalogOffer.quantity;
      } else if (explicitQty > 0) {
        const templateOfferRaw = getTemplateOfferForQuantity(templatePricing, productInfo.canonical, explicitQty);
        const templateOffer = isPlausibleOfferForProduct(templateOfferRaw, productInfo) ? templateOfferRaw : null;
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
          promoFromHistory.quantity === explicitQty &&
          isPlausibleOfferForProduct(promoFromHistory, productInfo)
        ) {
          lockedOffer = promoFromHistory;
        } else {
          lockedOffer = null;
        }
      } else if ((isGenericBuyReply(texto) || promoResponse || isBuyIntent(texto)) && promoMatchesProduct && isPlausibleOfferForProduct(promoFromHistory, productInfo)) {
        lockedOffer = promoFromHistory;
      } else if (
        lockedOfferByContext &&
        normalize(lockedOfferByContext.product) === normalize(productInfo.canonical) &&
        isPlausibleOfferForProduct(lockedOfferByContext, productInfo)
      ) {
        lockedOffer = lockedOfferByContext;
      }
    }

    const cityStatement = extractCityStatement(texto);
    const prevStep = freshOrder ? "" : context?.step || "";
    const isCityStep = prevStep === "collecting_city";
    const isDataCollectionStep = ["collecting_name", "collecting_address", "collecting_phone", "collecting_quantity"].includes(prevStep);

    // V63: sanea ciudades contaminadas que hayan quedado guardadas por una versión anterior.
    // Ej.: "Asuncion Roberto Lpetti El" se convierte inmediatamente en "Asunción".
    const sanitizedOldCity = canonicalizeStoredCity(oldOrder.city || "", parsed);
    if (sanitizedOldCity && sanitizedOldCity !== oldOrder.city) {
      oldOrder.city = sanitizedOldCity;
    }

    const explicitKnownCityFromMessage = extractExplicitKnownCityFromSentence(texto, parsed);
    const detectedCityRaw = detectCity(texto, parsed, sanitizedOldCity || "");
    const exactCityFromMessage = exactKnownCity(texto, parsed);
    const explicitDifferentCity = Boolean(
      cityStatement &&
      normalize(cityStatement) !== normalize(oldOrder.city || "") &&
      isPlausibleBareCityCandidate(cityStatement)
    );
    const exactDifferentCity = Boolean(
      exactCityFromMessage &&
      normalize(exactCityFromMessage) !== normalize(oldOrder.city || "") &&
      isPlausibleBareCityCandidate(texto)
    );

    // V56: una vez confirmada la ciudad, se conserva en todos los pasos.
    // Solo cambia si el cliente declara expresamente otra ciudad o escribe
    // exactamente otra localidad conocida. Una pregunta, dirección, talle,
    // cantidad o respuesta corta jamás puede reemplazarla.
    const detectedCity = explicitKnownCityFromMessage
      ? explicitKnownCityFromMessage
      : oldOrder.city && !explicitDifferentCity && !exactDifferentCity
        ? canonicalizeStoredCity(oldOrder.city, parsed)
        : explicitDifferentCity
          ? canonicalizeStoredCity(cityStatement, parsed)
          : exactDifferentCity
            ? exactCityFromMessage
            : detectedCityRaw ||
            (cityStatement && isPlausibleBareCityCandidate(cityStatement)
              ? toTitleCase(cityStatement)
              : isCityStep && isPlausibleBareCityCandidate(texto)
                ? clean(texto)
                : "");

    const pendingCityConfirmation = clean(context?.pending_city_confirmation || "");
    let cityConfirmedNow = "";
    let cityConfirmationDeclined = false;

    if (pendingCityConfirmation && !oldOrder.city) {
      const msgNorm = normalize(texto);
      if (/^(si|sí|correcto|exacto|esa|ese|esa es|es esa|asi es|así es|dale|ok)$/.test(msgNorm)) {
        cityConfirmedNow = pendingCityConfirmation;
      } else if (/^(no|no es esa|otra|nop|no es)$/.test(msgNorm)) {
        cityConfirmationDeclined = true;
      }
    }

    if (cityConfirmationDeclined) {
      return res.json({
        response: `😊 Entendido, ¿cuál sería tu ciudad entonces?`,
        context: {
          ...(context || {}),
          pending_city_confirmation: null,
          updated_at: new Date().toISOString(),
        },
      });
    }

    const effectiveDetectedCity = cityConfirmedNow || detectedCity;
    const cityWasCapturedNow = Boolean(
      cityConfirmedNow ||
      (effectiveDetectedCity && normalize(effectiveDetectedCity) !== normalize(oldOrder.city || ""))
    );

    const cityCandidateRaw = cityStatement || texto;
    const isExactCityMatch =
      !!cityConfirmedNow || (!!detectedCity && !!exactKnownCity(cityCandidateRaw, parsed));

    // V51: cuando el cliente declara claramente su ciudad (por ejemplo,
    // "soy de Arroyo Pora"), la guardamos directamente. Si no figura en la
    // cobertura, el flujo determinístico ofrece transportadora sin hacer una
    // confirmación innecesaria de la localidad. Solo confirmamos ciudades
    // inferidas desde mensajes ambiguos o demasiado breves.
    const hasExplicitCityStatement = Boolean(cityStatement);

    const needsCityConfirmation =
      !oldOrder.city &&
      !cityConfirmedNow &&
      !!detectedCity &&
      detectedCity !== oldOrder.city &&
      !isExactCityMatch &&
      !hasExplicitCityStatement &&
      isPlausibleBareCityCandidate(texto) &&
      !isQuestionLikeMessage(texto);

    if (needsCityConfirmation) {
      return res.json({
        response: `📍 ¿Tu ciudad sería ${detectedCity}? 😊`,
        context: {
          ...(context || {}),
          pending_city_confirmation: detectedCity,
          updated_at: new Date().toISOString(),
        },
      });
    }

    const phone = extractPhone(texto);
    const qty = explicitQty;
    const name = extractName(texto, effectiveDetectedCity !== oldOrder.city ? effectiveDetectedCity : "", phone, parsed);
    const address = extractAddress(texto, effectiveDetectedCity !== oldOrder.city ? effectiveDetectedCity : "", phone, name);
    const observationPatch = extractOrderObservation(texto);

    if (isDeliveryTimingQuestion(texto) && oldOrder.product) {
      return res.json({
        response: buildDeliveryTimingQuestionResponse(texto, oldOrder),
        context: {
          ...(context || {}),
          order_data: oldOrder,
          order_id: oldOrder.order_id || null,
          step: nextStep(oldOrder, oldOrder.city ? hasCoverage(oldOrder.city, parsed) : null),
          updated_at: new Date().toISOString(),
        },
        debug: { delivery_timing_question_without_state_reset: true },
      });
    }

    let orderData = mergeOrderData(
      oldOrder,
      {
        order_id: oldOrder.order_id || makeOrderId(fromNumber),
        quantity: qty,
        city: effectiveDetectedCity && effectiveDetectedCity !== oldOrder.city ? effectiveDetectedCity : "",
        phone,
        name,
        old_name_is_contaminated: isContaminatedCustomerName(clean((context?.order_data || {}).customer_name || ""), parsed),
        address,
        locked_offer: lockedOffer,
        ...observationPatch,
      },
      product
    );

    if (!orderData.city && oldOrder.city && qty > 0) {
      orderData.city = oldOrder.city;
    }

    if (
      orderData.locked_offer &&
      orderData.locked_offer.fixed_quantity &&
      orderData.quantity === 0
    ) {
      orderData.quantity = orderData.locked_offer.quantity;
    }

    if (
      orderData.locked_offer &&
      !orderData.locked_offer.fixed_quantity &&
      orderData.quantity === 0 &&
      !hasExplicitQuantity(texto) &&
      context?.force_offer_quantity === true
    ) {
      orderData.quantity = orderData.locked_offer.quantity;
    }

    if (orderData.locked_offer && explicitQty > 0 && explicitQty !== orderData.locked_offer.quantity) {
      if (orderData.locked_offer.fixed_quantity) {
        orderData.quantity = orderData.locked_offer.quantity;
      } else {
        orderData.locked_offer = null;
        if (productInfo) {
          const templateOfferRaw2 = getTemplateOfferForQuantity(templatePricing, productInfo.canonical, explicitQty);
          const templateOffer2 = isPlausibleOfferForProduct(templateOfferRaw2, productInfo) ? templateOfferRaw2 : null;
          const templateActiveForProduct = hasTemplateForProduct(templatePricing, productInfo.canonical);
          const catalogOffer = templateActiveForProduct ? null : getCatalogOffer(productInfo, explicitQty);
          if (templateOffer2) orderData.locked_offer = templateOffer2;
          else if (catalogOffer) orderData.locked_offer = catalogOffer;
        }
        orderData.quantity = explicitQty;
      }
    }

    const proofReceived = hasPaymentProof(context, texto, media_url, media_type || mime_type);
    if (proofReceived) {
      orderData.payment_proof_received = true;
    } else if (isSameOrderForPaymentProof(oldOrder, orderData)) {
      orderData.payment_proof_received = true;
    } else {
      orderData.payment_proof_received = false;
    }

    if (orderData.locked_offer && orderData.locked_offer.total < 10000) {
      orderData.locked_offer = null;
    }

    if (orderData.product && !getProductInfo(orderData.product, parsed)) {
      orderData.product = "";
      orderData.locked_offer = null;
    }

    // V67: el celular es opcional. Si el cliente no escribe uno válido,
    // usamos el mismo número de WhatsApp desde el que está conversando.
    // Un número explícito del cliente siempre tiene prioridad.
    if (!orderData.phone) {
      orderData.phone = senderPhoneFallback(fromNumber);
    }

    const state = buildState(orderData, parsed);

    if (state.productInfo && !orderData.locked_offer && orderData.quantity) {
      const templateOfferRaw3 = getTemplateOfferForQuantity(templatePricing, state.productInfo.canonical, orderData.quantity);
      const templateOffer3 = isPlausibleOfferForProduct(templateOfferRaw3, state.productInfo) ? templateOfferRaw3 : null;
      const templateActiveForProduct = hasTemplateForProduct(templatePricing, state.productInfo.canonical);
      const catalogOffer = templateActiveForProduct ? null : getCatalogOffer(state.productInfo, orderData.quantity);

      if (templateOffer3) {
        orderData.locked_offer = templateOffer3;
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
    let directConfirm = hasAllRequiredOrderDataForDirectConfirmation(finalState);
    let confirm = shouldConfirmOrder(finalState) || directConfirm;

    if (finalState.coverage === false && !orderData.payment_proof_received) {
      directConfirm = false;
      confirm = false;
    }

    if (orderData.product) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, confirm);
    }

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

    if (!confirm && finalState.coverage === false && finalState.step === "waiting_payment_proof") {
      const waitProofResponse = deterministicWaitingPaymentProofMessage(finalState, parsed);
      if (waitProofResponse) {
        return res.json({
          response: waitProofResponse,
          context: {
            ...(context || {}),
            current_product: orderData.product || null,
            last_topic: orderData.product || context?.last_topic || null,
            last_ad_offer: orderData.locked_offer || null,
            order_data: orderData,
            order_id: orderData.order_id || null,
            payment_proof_received: false,
            step: "waiting_payment_proof",
            updated_at: new Date().toISOString(),
          },
          debug: true
            ? {
                deterministic_waiting_payment_proof: true,
                product: orderData.product,
                quantity: orderData.quantity,
                city: orderData.city,
                coverage: finalState.coverage,
                total: finalState.total,
                missing: finalState.missing,
                step: finalState.step,
                confirm,
                direct_confirm: directConfirm,
              }
            : undefined,
        });
      }
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

    if (
      !confirm &&
      orderData.city &&
      cityWasCapturedNow &&
      !orderData.locked_offer?.fixed_quantity
    ) {
      const cityCoverageResponse = deterministicAfterCityCoverageMessage(finalState);
      if (cityCoverageResponse) {
        return res.json({
          response: cityCoverageResponse,
          context: {
            ...(context || {}),
            pending_city_confirmation: null,
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
                deterministic_city_coverage_response: true,
                product: orderData.product,
                quantity: orderData.quantity,
                city: orderData.city,
                coverage: finalState.coverage,
                total: finalState.total,
                missing: finalState.missing,
                step: finalState.step,
              }
            : undefined,
        });
      }
    }

    if (!confirm && qty > 0 && orderData.city) {
      const deterministicQtyResponse = deterministicAfterQuantityMessage(finalState, parsed);
      if (deterministicQtyResponse) {
        return res.json({
          response: deterministicQtyResponse,
          context: {
            ...(context || {}),
            pending_city_confirmation: null,
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

    const deterministicObservationResponse = deterministicObservationAckMessage(finalState, parsed, observationPatch);
    if (!confirm && deterministicObservationResponse) {
      return res.json({
        response: deterministicObservationResponse,
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
              deterministic_observation_response: true,
              product: orderData.product,
              quantity: orderData.quantity,
              city: orderData.city,
              coverage: finalState.coverage,
              total: finalState.total,
              missing: finalState.missing,
              step: finalState.step,
              observation: orderData.observation || null,
              payment_note: orderData.payment_note || null,
              preferred_delivery_date: orderData.preferred_delivery_date || null,
              preferred_delivery_time: orderData.preferred_delivery_time || null,
            }
          : undefined,
      });
    }

    const currentMessageIsQuestionBeforeAI = isQuestionLikeMessage(texto);
    const currentMessageHasQuantityBeforeAI = extractQuantity(texto) > 0;
    const currentMessageIsAcknowledgementBeforeAI = isShortAcknowledgement(texto);
    const explicitProductInterestNow = hasExplicitProductInterestPhrase(texto);
    const productMentionNow = !!detectProduct(texto, parsed, "");

    // ✅ FIX V46: verificar si el copy ya se envió antes en esta conversación
    const copyAlreadySentInConversation = wasCopyAlreadySentInThisConversation(history, finalState.productInfo);

    // Una consulta corta de precio, después de haber mostrado el producto,
    // se resuelve de forma determinística antes de Gemini y antes de cualquier
    // lógica capaz de reconstruir el copy completo.
    if (
      isPriceQuery(texto) &&
      copyAlreadySentInConversation &&
      finalState.productInfo
    ) {
      const priceOnlyResponse = buildPriceOnlyResponse(finalState, templatePricing);

      if (priceOnlyResponse) {
        return res.json({
          response: priceOnlyResponse,
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
                deterministic_price_response: true,
                gemini_skipped: true,
                copy_already_sent: true,
                product: orderData.product,
                city: orderData.city,
                quantity: orderData.quantity,
                step: finalState.step,
              }
            : undefined,
        });
      }
    }

    const shouldPresentExactCatalogCopy = Boolean(
      clean(finalState.productInfo?.salesCopy || "") &&
      !orderData.city &&
      !copyAlreadySentInConversation && // ← NUEVA CONDICIÓN
      (!currentMessageIsQuestionBeforeAI || productMentionNow) &&
      !currentMessageHasQuantityBeforeAI &&
      !currentMessageIsAcknowledgementBeforeAI &&
      (
        freshOrder ||
        newTemplateSignal.isNew ||
        !!currentTemplatePricing ||
        (explicitProductInterestNow && !copyAlreadySentInConversation) ||
        productMentionNow ||
        (!!productMentionNow && !context?.current_product)
      )
    );

    if (shouldPresentExactCatalogCopy) {
      const exactCopyResponse = buildFullProductCopyResponse(finalState, templatePricing);
      const exactImages = finalState.productInfo?.images?.length
        ? finalState.productInfo.images.slice(0, 3)
        : undefined;

      return res.json({
        response: exactCopyResponse,
        media_urls: exactImages,
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
              exact_catalog_copy_backend: true,
              gemini_skipped: true,
              product: orderData.product,
              city: orderData.city,
              step: finalState.step,
              copy_already_sent: copyAlreadySentInConversation,
            }
          : undefined,
      });
    }

    const copyAlreadySent = wasProductCopyAlreadySent(history, finalState.productInfo);
    const system = buildSalesSystemPrompt(parsed, finalState, templatePricing, copyAlreadySent);

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

    if (!aiResponse || aiResponse === "__GEMINI_QUOTA_EXCEEDED__") {
      aiResponse = buildFallbackResponse(parsed, finalState, templatePricing);
    }

    const deterministicBusinessResponse = buildDeterministicBusinessQuestionResponse(texto, finalState);
    if (deterministicBusinessResponse) {
      aiResponse = deterministicBusinessResponse;
    }

    const deterministicAcknowledgementResponse = buildDeterministicAcknowledgementResponse(texto, finalState);
    if (deterministicAcknowledgementResponse) {
      aiResponse = deterministicAcknowledgementResponse;
    }

    if (
      explicitProductInterestNow &&
      !isPriceQuery(texto) &&
      !copyAlreadySentInConversation &&
      clean(finalState.productInfo?.salesCopy || "") &&
      !currentMessageIsQuestionBeforeAI
    ) {
      aiResponse = buildFullProductCopyResponse(finalState, null);
      templatePricing = null;
    }

    const currentMessageIsQuestion = isQuestionLikeMessage(texto);
    const currentMessageHasQuantity = extractQuantity(texto) > 0;

    let imagesToSend: string[] | undefined = undefined;
    
    const productoPorClave = encontrarProductoPorPalabraClave(texto, parsed.products);
    
    if (!orderData.city && (!currentMessageIsQuestion || productMentionNow) && !currentMessageHasQuantity) {
      if (productoPorClave && productoPorClave.images?.length) {
        imagesToSend = productoPorClave.images.slice(0, 3);
        console.log(`📸 Enviando ${imagesToSend.length} imagen(es) para "${productoPorClave.palabra_clave || productoPorClave.canonical}"`);
      } else if (finalState.productInfo?.images?.length) {
        imagesToSend = finalState.productInfo.images.slice(0, 3);
        console.log(`📸 Enviando ${imagesToSend.length} imagen(es) para "${finalState.productInfo.canonical}"`);
      }
    }

    return res.json({
      response: postProcessResponse(aiResponse),
      media_urls: imagesToSend,
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
            images_sent: imagesToSend?.length || 0,
            producto_por_clave: productoPorClave?.palabra_clave || null,
            copy_already_sent_in_conversation: copyAlreadySentInConversation,
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
