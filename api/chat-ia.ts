import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const CATALOG_URL = "https://cat-logomegatodo-com.vercel.app/";

// ============ UTILIDADES DE LIMPIEZA ============
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

// ============ TIPOS ============
type ProductItem = {
  product: string;
  canonical: string;
  aliases: string[];
  price1: number;
  price2?: number;
  price3?: number;
  requires_calce?: boolean;
  calces_disponibles?: number[];
  mensaje_venta?: string;
};

type BankData = {
  titular: string;
  ci?: string;
  entidad: string;
  cuenta: string;
  alias?: string;
  tipo?: string;
};

type CityCorrection = {
  wrong: string;
  correct: string;
};

type ParsedTraining = {
  products: ProductItem[];
  cities: { alias: string; canonical: string }[];
  bankData: BankData[];
  coverageZones: string[];
  noCoverageZones: string[];
  rules: string[];
  examples: string[];
  cityCorrections: CityCorrection[];
};

// ============ PARSEO DEL ENTRENAMIENTO (VERSIÓN CORREGIDA) ============
function parseTraining(training: string): ParsedTraining {
  const products: ProductItem[] = [];
  const cities: { alias: string; canonical: string }[] = [];
  const bankData: BankData[] = [];
  const coverageZones: string[] = [];
  const noCoverageZones: string[] = [];
  const rules: string[] = [];
  const examples: string[] = [];
  const cityCorrections: CityCorrection[] = [];

  // --- PARSEAR PRODUCTOS ---
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

    const requires_calce = /REQUIERE_CALCE:\s*true/i.test(block);
    const calcesRaw = clean(block.match(/^CALCES_DISPONIBLES:\s*(.+)$/im)?.[1]);
    const calces_disponibles = calcesRaw
      ? calcesRaw.split(",").map(Number).filter((n) => n > 0)
      : [];

    const mensaje_venta = clean(block.match(/^MENSAJE_VENTA:\s*([\s\S]*?)(?=PRODUCTO:|FIN_CATALOGO|$)/im)?.[1]);

    if (product && canonical && price1 > 0) {
      products.push({
        product,
        canonical,
        aliases: Array.from(new Set([product, canonical, ...aliases])),
        price1,
        price2: price2 || undefined,
        price3: price3 || undefined,
        requires_calce: requires_calce || false,
        calces_disponibles: calces_disponibles.length > 0 ? calces_disponibles : undefined,
        mensaje_venta: mensaje_venta || undefined,
      });
    }
  }

  // --- PARSEAR CIUDADES ---
  const addCity = (alias: string, canonical?: string) => {
    const a = clean(alias);
    const c = clean(canonical || alias);
    if (!a || a.length < 2) return;
    cities.push({ alias: a, canonical: c });
  };

  // --- PARSEAR TABLA DE ERRORES COMUNES ---
  const correctionsSection =
    training.match(/📋 TABLA DE ERRORES COMUNES Y CORRECCIONES([\s\S]*?)(?=📍 LISTA COMPLETA|ZONAS CON COBERTURA|━━━━)/i)?.[1] ||
    training.match(/TABLA DE ERRORES COMUNES([\s\S]*?)(?=📍 LISTA COMPLETA|ZONAS CON COBERTURA|━━━━)/i)?.[1] ||
    "";

  correctionsSection
    .split("\n")
    .map(clean)
    .filter((l) => l.includes("→") || l.includes("➜"))
    .forEach((line) => {
      const parts = line.split(/→|➜/).map(clean);
      if (parts.length >= 2) {
        const wrong = parts[0].replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, "").trim();
        const correct = parts[1].replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, "").trim();
        if (wrong && correct) {
          cityCorrections.push({ wrong: normalize(wrong), correct });
        }
      }
    });

  // ============================================================
  // --- PARSEAR ZONAS CON COBERTURA (VERSIÓN MEJORADA) ---
  // ============================================================
  let coverageText = "";

  // Buscar línea por línea en todo el texto
  const lines = training.split("\n");
  let foundCoverage = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Detectar cualquier variante de "ZONAS CON COBERTURA"
    if (/ZONAS CON COBERTURA/i.test(line) || /🟢.*ZONAS CON COBERTURA/i.test(line) || /📍.*ZONAS CON COBERTURA/i.test(line)) {
      // Recoger líneas siguientes hasta encontrar otra sección
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        // Detener si encuentra otra sección
        if (/ZONAS SIN COBERTURA/i.test(nextLine) || /🟡.*ZONAS SIN COBERTURA/i.test(nextLine)) {
          break;
        }
        // Limpiar la línea y agregar si tiene contenido útil
        const cleanLine = nextLine.replace(/[📍✅🟢]/g, "").trim();
        if (cleanLine && !cleanLine.includes("━━") && !cleanLine.includes("ZONAS") && !cleanLine.includes("(") && !cleanLine.includes(")")) {
          coverageText += " " + cleanLine;
        }
      }
      foundCoverage = true;
      break;
    }
  }

  // Si no encontró con el método anterior, usar regex como fallback
  if (!foundCoverage) {
    const coverageMatch = training.match(/ZONAS CON COBERTURA[^━]*━+[^━]*([\s\S]*?)(?:ZONAS SIN COBERTURA|━━━━)/i);
    if (coverageMatch) {
      coverageText = coverageMatch[1];
    }
  }

  // Si aún no hay texto, buscar en todo el texto por ciudades conocidas
  if (!coverageText || coverageText.length < 10) {
    // Buscar en la sección de cobertura del entrenamiento original
    const altMatch = training.match(/📍\s*Altos,\s*Aregua,\s*Asunción/i);
    if (altMatch) {
      // Encontrar la línea completa que contiene las ciudades
      for (const line of lines) {
        if (line.includes("Altos") && line.includes("Aregua") && line.includes("Asunción")) {
          coverageText = line.replace(/[📍]/g, "").trim();
          break;
        }
      }
    }
  }

  // Extraer todas las ciudades del texto de cobertura
  if (coverageText && coverageText.length > 5) {
    // Palabras que no son ciudades
    const ignoreWords = ["es", "san", "nte", "del", "la", "de", "y", "por", "para", "con", "sin", "sobre", "el", "los", "las", "un", "una", "unos", "unas", "al", "lo", "villa", "jardin", "fdo", "moran"];
    
    // Dividir por comas y limpiar
    const citiesRaw = coverageText
      .replace(/[📍✅🟢]/g, "")
      .split(/[,，\n]/)
      .map(clean)
      .filter(c => c.length > 2 && !ignoreWords.includes(c.toLowerCase()));

    // Procesar cada ciudad
    for (let city of citiesRaw) {
      // Si tiene "villa jardin" o similar, extraer solo el nombre principal
      if (city.toLowerCase().includes("villa") || city.toLowerCase().includes("jardin")) {
        const parts = city.split(" ");
        city = parts[0];
      }
      // Si tiene "Fdo de la mora", convertir a "Fernando de la Mora"
      if (city.toLowerCase().includes("fdo") || city.toLowerCase().includes("fernando")) {
        city = "Fernando de la Mora";
      }
      // Normalizar: convertir a título
      const normalized = city.split(" ").map(w => 
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      ).join(" ");
      
      if (normalized.length > 2 && !ignoreWords.includes(normalized.toLowerCase()) && !ignoreWords.includes(normalized.split(" ")[0]?.toLowerCase() || "")) {
        // Verificar que no sea una palabra genérica
        const firstWord = normalized.split(" ")[0]?.toLowerCase() || "";
        if (!["la", "las", "los", "las", "del", "al", "el", "un", "una"].includes(firstWord)) {
          coverageZones.push(normalized);
          addCity(normalized, normalized);
        }
      }
    }
  }

  // --- PARSEAR ZONAS SIN COBERTURA ---
  const noCoverageSection =
    training.match(/ZONAS SIN COBERTURA([\s\S]*?)(?=DATOS PARA TRANSFERENCIA|📲 DATOS|━━━━|$)/i)?.[1] ||
    training.match(/🟡 ZONAS SIN COBERTURA([\s\S]*?)(?=DATOS PARA TRANSFERENCIA|📲 DATOS|━━━━|$)/i)?.[1] ||
    "";

  if (noCoverageSection) {
    const noCoverageCities = noCoverageSection
      .split(/[,，\n]/)
      .map(clean)
      .filter((c) => c.length > 2 && !c.includes("(") && !c.includes(")") && !c.includes("ZONAS") && !c.includes("🟡"));
    
    for (const city of noCoverageCities) {
      if (city.length > 2) {
        noCoverageZones.push(city);
        addCity(city, city);
      }
    }
  }

  // --- PARSEAR LISTA COMPLETA POR CIUDAD (para alias) ---
  const cityListSection =
    training.match(/📍 LISTA COMPLETA POR CIUDAD([\s\S]*?)(?=ZONAS CON COBERTURA|ZONAS SIN|━━━━|$)/i)?.[1] ||
    training.match(/LISTA COMPLETA POR CIUDAD([\s\S]*?)(?=ZONAS CON COBERTURA|ZONAS SIN|━━━━|$)/i)?.[1] ||
    "";

  if (cityListSection) {
    const cityBlocks = cityListSection.split(/📍\s*/g).filter(Boolean);
    for (const block of cityBlocks) {
      const lines2 = block.split("\n").map(clean).filter(Boolean);
      const canonical = lines2[0]?.replace(/[📍✅]/g, "").trim();
      const variantsLine = lines2.find((l) => l.startsWith("✅"));

      if (canonical && variantsLine) {
        addCity(canonical, canonical);
        variantsLine
          .replace(/^✅\s*/, "")
          .split(/[,，]/)
          .map(clean)
          .filter(Boolean)
          .forEach((v) => addCity(v, canonical));
      }
    }
  }

  // --- PARSEAR DATOS BANCARIOS ---
  const bankSection =
    training.match(/📲 DATOS PARA TRANSFERENCIA([\s\S]*?)(?=━━━━|$)/i)?.[1] ||
    training.match(/DATOS PARA TRANSFERENCIA([\s\S]*?)(?=━━━━|$)/i)?.[1] ||
    training.match(/💵 Pago anticipado por transferencia([\s\S]*?)(?=━━━━|$)/i)?.[1] ||
    "";

  const bankLines = bankSection.split("\n").map(clean).filter(Boolean);

  let currentBank: Partial<BankData> = {};
  for (const line of bankLines) {
    if (/titular|Titular/i.test(line) && !line.includes("📲")) {
      if (currentBank.titular) {
        bankData.push(currentBank as BankData);
        currentBank = {};
      }
      currentBank.titular = line.replace(/titular\s*[:;]\s*/i, "").replace(/Titular\s*[:;]\s*/i, "").trim();
    } else if (/ci\s*[:;]/i.test(line) || /CI\s*[:;]/i.test(line)) {
      currentBank.ci = line.replace(/ci\s*[:;]\s*/i, "").replace(/CI\s*[:;]\s*/i, "").trim();
    } else if (/entidad\s*[:;]/i.test(line) || /Entidad\s*[:;]/i.test(line)) {
      currentBank.entidad = line.replace(/entidad\s*[:;]\s*/i, "").replace(/Entidad\s*[:;]\s*/i, "").trim();
    } else if (/cuenta\s*[:;]/i.test(line) || /Cuenta\s*[:;]/i.test(line) || /N° de cuenta/i.test(line)) {
      currentBank.cuenta = line.replace(/cuenta\s*[:;]\s*/i, "").replace(/Cuenta\s*[:;]\s*/i, "").replace(/N° de cuenta\s*[:;]\s*/i, "").trim();
    } else if (/alias\s*[:;]/i.test(line) || /Alias\s*[:;]/i.test(line)) {
      currentBank.alias = line.replace(/alias\s*[:;]\s*/i, "").replace(/Alias\s*[:;]\s*/i, "").trim();
    }
  }
  if (currentBank.titular) {
    bankData.push(currentBank as BankData);
  }

  // --- PARSEAR REGLAS ---
  const rulesSection =
    training.match(/📌 REGLAS A RECORDAR([\s\S]*?)(?=━━━━|$)/i)?.[1] ||
    training.match(/REGLAS_PARA_EL_PARSER_DEL_BOT([\s\S]*?)(?=ENTRENAMIENTO_COMPLETO|━━━━)/i)?.[1] ||
    "";

  rulesSection
    .split("\n")
    .map(clean)
    .filter((l) => l.length > 5 && (l.startsWith("-") || l.startsWith("❌") || l.startsWith("✅")))
    .forEach((r) => rules.push(r));

  // --- PARSEAR EJEMPLOS ---
  const examplesSection =
    training.match(/✅ EJEMPLO DE FLUJO CORRECTO([\s\S]*?)(?=━━━━|$)/i)?.[1] ||
    training.match(/📝 EJEMPLOS PRÁCTICOS([\s\S]*?)(?=━━━━|$)/i)?.[1] ||
    training.match(/✅ EJEMPLOS CORRECTOS([\s\S]*?)(?=━━━━|$)/i)?.[1] ||
    "";

  examplesSection
    .split("\n")
    .map(clean)
    .filter((l) => l.length > 10 && (l.startsWith("Cliente:") || l.startsWith("Asistente:") || l.includes("→")))
    .forEach((e) => examples.push(e));

  // --- UNIFICAR CIUDADES ---
  const cityMap = new Map<string, { alias: string; canonical: string }>();
  for (const c of cities) {
    const key = normalize(c.alias);
    if (key) cityMap.set(key, c);
  }

  // Si no hay zonas de cobertura, usar todas las ciudades como cobertura
  if (coverageZones.length === 0 && cityMap.size > 0) {
    for (const [key, value] of cityMap) {
      coverageZones.push(value.canonical);
    }
  }

  console.log("📊 PARSER RESULTADO:");
  console.log(`   Productos: ${products.length}`);
  console.log(`   Ciudades: ${cityMap.size}`);
  console.log(`   Zonas con cobertura: ${coverageZones.length}`);
  console.log(`   Zonas sin cobertura: ${noCoverageZones.length}`);
  console.log(`   Correcciones: ${cityCorrections.length}`);
  console.log(`   Reglas: ${rules.length}`);
  console.log(`   Ejemplos: ${examples.length}`);
  console.log(`   Bancos: ${bankData.length}`);

  return {
    products,
    cities: Array.from(cityMap.values()),
    bankData,
    coverageZones: Array.from(new Set(coverageZones)),
    noCoverageZones: Array.from(new Set(noCoverageZones)),
    rules,
    examples,
    cityCorrections,
  };
}

// ============ FUNCIONES DE CORRECCIÓN DE CIUDADES ============
function correctCity(text: string, parsed: ParsedTraining): string {
  const normalized = normalize(text);
  
  // Buscar en la tabla de correcciones
  for (const correction of parsed.cityCorrections) {
    if (normalized === correction.wrong || normalized.includes(correction.wrong)) {
      return correction.correct;
    }
  }
  
  // Buscar coincidencia parcial en ciudades
  for (const city of parsed.cities) {
    const cityNorm = normalize(city.alias);
    if (cityNorm && (normalized === cityNorm || normalized.includes(cityNorm) || cityNorm.includes(normalized))) {
      return city.canonical;
    }
  }
  
  return text;
}

// ============ FUNCIONES DE DETECCIÓN ============
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

  // Primero corregir la ciudad si está en la tabla de errores
  const corrected = correctCity(msg, parsed);
  if (corrected !== msg) return corrected;

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
        const matched = aliasWords.filter((w) => {
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

function hasCoverage(city: string, parsed: ParsedTraining) {
  const c = normalize(city);
  if (!c) return false;

  // Verificar en zona de cobertura
  for (const zone of parsed.coverageZones) {
    const z = normalize(zone);
    if (c === z || c.includes(z) || z.includes(c)) {
      return true;
    }
  }

  // Verificar en ciudades (alias)
  for (const cityAlias of parsed.cities) {
    const alias = normalize(cityAlias.alias);
    if (c === alias || c.includes(alias) || alias.includes(c)) {
      return true;
    }
  }

  return false;
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

  const q1 = m.match(/\b(\d+)\s*(unidad|unidades|u|und|unds)\b/);
  if (q1) return sanitizeQuantity(Number(q1[1]));

  for (const [word, num] of Object.entries(wordMap)) {
    const regex = new RegExp(`\\b${word}\\s*(unidad|unidades|u\\b|und\\b)`);
    if (regex.test(m)) return sanitizeQuantity(num);
  }

  const q2 = m.match(/\b(quiero|llevo|dame|mandame|reservame|solo|solamente)\s+(\d+)\b/);
  if (q2) return sanitizeQuantity(Number(q2[2]));

  const q3 = m.match(/\b(\d+)\s+(quiero|llevo|dame|mandame)\b/);
  if (q3) return sanitizeQuantity(Number(q3[1]));

  for (const [word, num] of Object.entries(wordMap)) {
    const regex = new RegExp(`\\b(quiero|llevo|dame|mandame|reservame|solo|solamente)\\s+${word}\\b`);
    if (regex.test(m)) return sanitizeQuantity(num);
  }

  if (/^\d+$/.test(m) && m.length <= 5 && !m.startsWith("09")) return sanitizeQuantity(Number(m));

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

function extractName(text: string, detectedCity: string, phone: string, parsed?: ParsedTraining) {
  const raw = clean(text);
  if (!raw) return "";

  if (extractQuantity(raw) > 0) return "";

  if (parsed) {
    const normRaw = normalize(raw);
    const isCity = parsed.cities.some((c) => {
      const a = normalize(c.alias);
      return a && (normRaw === a || normRaw.includes(a) || a.includes(normRaw));
    });
    if (isCity) return "";
  }

  const lines = raw.split("\n").filter((l) => clean(l).length > 0);

  const forbidden = [
    "quiero", "comprar", "me interesa", "precio", "delivery",
    "envio", "ok", "dale", "si", "hola", "buenas", "gracias",
    "cuanto", "cuando", "dia", "llega", "llego", "pedido",
    "cancelar", "no", "que", "estado", "seguimiento",
    "ya", "fue", "como", "donde",
    "unidad", "unidades", "und", "unds",
    "una", "uno", "dos", "tres", "cuatro", "cinco",
  ];

  const isValidNameLine = (line: string): boolean => {
    const cleaned = clean(line);
    const normLine = normalize(cleaned);
    const words = cleaned.split(/\s+/).filter(Boolean);

    if (words.length < 2 || words.length > 5) return false;
    if (/\d/.test(cleaned)) return false;
    if (!/^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(cleaned)) return false;
    if (cleaned.length < 4 || cleaned.length > 60) return false;

    if (detectedCity && normalize(cleaned) === normalize(detectedCity)) return false;
    if (forbidden.some((f) => normLine === normalize(f))) return false;

    return true;
  };

  const explicit = raw.match(
    /(?:soy|me llamo|mi nombre es|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,80})/i
  )?.[1];
  if (explicit) return toTitleCase(clean(explicit));

  for (const line of lines) {
    const cleaned = clean(line);
    if (isValidNameLine(cleaned)) return toTitleCase(cleaned);
  }

  if (isValidNameLine(raw)) return toTitleCase(raw);

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

function extractCalce(text: string, parsed: ParsedTraining) {
  const m = normalize(text);
  const numbers = m.match(/\b(35|36|37|38|39|40|41|42|43|44|45|46)\b/);
  if (numbers) return Number(numbers[0]);
  return null;
}

// ============ FUNCIONES DE UTILIDAD ============
function sanitizeQuantity(q: any) {
  const n = Number(q);
  if (!Number.isFinite(n)) return 0;
  if (n < 1) return 0;
  if (n > 100) return 100;
  return n;
}

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatGs(n: number) {
  return Number(n || 0).toLocaleString("es-PY");
}

function calculateTotal(productName: string, quantity: number, parsed: ParsedTraining) {
  const p = getProductInfo(productName, parsed);
  if (!p) return 0;

  const q = sanitizeQuantity(quantity);

  if (q === 2 && p.price2) return p.price2;
  if (q === 3 && p.price3) return p.price3;

  return p.price1 * q;
}

// ============ FUNCIONES DE ORDEN ============
function nextStep(o: any, parsed: ParsedTraining) {
  if (!o.product) return "selling";
  if (!o.city) return "collecting_city";
  
  const productInfo = getProductInfo(o.product, parsed);
  if (productInfo?.requires_calce && !o.calce) return "collecting_calce";
  
  if (!o.quantity) return "collecting_quantity";
  if (!o.customer_name) return "collecting_name";
  if (!o.address) return "collecting_address";
  if (!o.phone) return "collecting_phone";
  return "confirm_order";
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

function sanitizeOldOrder(old: any, parsed: ParsedTraining) {
  const productInfo = getProductInfo(old?.product || "", parsed);
  const nameNorm = normalize(old?.customer_name || "");

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
    calce: old?.calce || null,
  };
}

function mergeOrderData(old: any, ext: any, product: string, parsed: ParsedTraining) {
  const productInfo = getProductInfo(product, parsed);
  const calce = ext.calce || old.calce || null;
  
  return {
    product: product || old.product || "",
    quantity: ext.quantity > 0 ? sanitizeQuantity(ext.quantity) : sanitizeQuantity(old.quantity || 0),
    city: ext.city || old.city || "",
    customer_name: ext.name || old.customer_name || "",
    phone: ext.phone || old.phone || "",
    address: ext.address || old.address || "",
    calce: productInfo?.requires_calce ? calce : null,
  };
}

function isBuyIntent(text: string) {
  const m = normalize(text);
  return /\b(si|quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmo|confirmar|ok|dale|listo)\b/.test(
    m
  );
}

function isPriceQuery(text: string) {
  const m = normalize(text);
  return /\b(cuanto cuesta|precio|valor|costo|cuanto sale|cuanto vale)\b/.test(m);
}

function isGenericBuyReply(text: string) {
  const m = normalize(text);
  if (!m) return false;

  const exact = [
    "quiero",
    "si",
    "si quiero",
    "lo quiero",
    "quiero comprar",
    "quiero llevar",
    "me interesa",
    "comprar",
    "compro",
    "dale",
    "ok",
    "listo",
    "confirmo",
    "reservar",
    "reservame",
    "agendar",
    "agendame",
  ];

  if (exact.includes(m)) return true;

  return /^(si\s+)?(quiero|lo quiero|me interesa|comprar|compro|dale|ok|listo|confirmo)(\s+(1|2|3|una|uno|dos|tres|unidad|unidades))?$/.test(m);
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

function getLockedProductFromContext(
  context: any,
  oldOrder: any,
  history: any[],
  parsed: ParsedTraining
): ProductItem | null {
  const candidates = [
    context?.current_product,
    context?.last_topic,
    context?.order_data?.product,
    context?.last_ad_product,
    oldOrder?.product,
  ]
    .map(clean)
    .filter(Boolean);

  for (const candidate of candidates) {
    const productInfo = getProductInfo(candidate, parsed);
    if (productInfo) return productInfo;
  }

  return null;
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

// ============ RESPUESTAS ============
function productOfferReply(productInfo: ProductItem) {
  const promo2 = productInfo.price2
    ? `\n🔥 Promo 2 unidades → ${formatGs(productInfo.price2)} Gs`
    : "";
  const promo3 = productInfo.price3
    ? `\n🔥 Promo 3 unidades → ${formatGs(productInfo.price3)} Gs`
    : "";

  const calceMsg = productInfo.requires_calce
    ? `\n\n📏 Calces disponibles: ${productInfo.calces_disponibles?.join(", ") || "35 a 46"}`
    : "";

  const mensaje = productInfo.mensaje_venta
    ? `\n\n${productInfo.mensaje_venta}`
    : "";

  return `🔥 ¡Excelente decisión! 😊

Tenemos el **${productInfo.canonical}** en oferta:

💰 1 unidad → ${formatGs(productInfo.price1)} Gs${promo2}${promo3}${calceMsg}${mensaje}

📍 ¿Para qué ciudad sería el envío? 😊`;
}

function confirmation(o: any, parsed: ParsedTraining) {
  const total = calculateTotal(o.product, o.quantity, parsed);
  const coverage = hasCoverage(o.city, parsed);

  const calceMsg = o.calce ? `✅ Calce: ${o.calce}\n` : "";

  if (coverage) {
    return `✅ PEDIDO CONFIRMADO

✅ Producto: ${o.product}
${calceMsg}✅ Cliente: ${o.customer_name}
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

  const bankInfo = parsed.bankData.length > 0 
    ? parsed.bankData.map(b => 
        `Titular: ${b.titular}${b.ci ? `\nCI: ${b.ci}` : ''}\nEntidad: ${b.entidad}\nCuenta: ${b.cuenta}${b.alias ? `\nAlias: ${b.alias}` : ''}`
      ).join('\n\n')
    : 'Titular: [TU NOMBRE]\nEntidad: [TU BANCO]\nCuenta: [TU CUENTA]\nAlias: [TU ALIAS]';

  return `✅ PEDIDO CONFIRMADO

✅ Producto: ${o.product}
${calceMsg}✅ Cliente: ${o.customer_name}
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

${bankInfo}`;
}

// ============ FUNCIONES DE BASE DE DATOS ============
async function safeUpsertOrder(
  userId: string,
  from: string,
  order: any,
  parsed: ParsedTraining,
  confirm = false
) {
  if (!getProductInfo(order.product, parsed)) return null;

  const total = calculateTotal(order.product, order.quantity || 1, parsed);
  const step = nextStep(order, parsed);

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
    calce: order.calce || null,
    status,
    fecha: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const IN_PROGRESS_STATUSES = [
    "draft",
    "selling",
    "collecting_city",
    "collecting_calce",
    "collecting_quantity",
    "collecting_name",
    "collecting_phone",
    "collecting_address",
    "confirm_pending",
  ];

  const { data: inProgress } = await supabase
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .eq("from_number", from)
    .in("status", IN_PROGRESS_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inProgress?.id) {
    await supabase.from("orders").update(payload).eq("id", inProgress.id);
    return inProgress.id;
  }

  if (confirm) {
    const { data: lastConfirmed } = await supabase
      .from("orders")
      .select("id, product")
      .eq("user_id", userId)
      .eq("from_number", from)
      .in("status", ["confirmed", "confirmado", "pedido_confirmado", "confirm_pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastConfirmed?.id && lastConfirmed.product === order.product) {
      await supabase.from("orders").update(payload).eq("id", lastConfirmed.id);
      return lastConfirmed.id;
    }
  }

  const { data } = await supabase.from("orders").insert(payload).select("id").single();
  return data?.id || null;
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

// ============ FUNCIONES DE GEMINI ============
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

// ============ HANDLER PRINCIPAL ============
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

    // Procesar audio si viene
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

    // BLOQUEO POST-PEDIDO CONFIRMADO
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
        const wantsCorrection = /\b(no|no quiero|no era|me equivoque|en realidad|quiero es|lo que quiero|lo que piero|piero|qiero)\b/.test(msgNorm);
        const isGreeting = /^(hola|buenas|hi|hey|buen dia|buenos dias|buenas tardes|buenas noches|saludos)[\s!.]*$/.test(msgNorm);
        const isNewPurchaseQuestion = /\b(compro|comprar|precio|cuanto|cuestan|cuanto sale|cuantos|quiero|interesa|promo|descuento|oferta)\b/.test(msgNorm);

        if (!wantsCorrection && !isGreeting && !isNewPurchaseQuestion) {
          return res.json({
            response: `🚚 Tu pedido de *${context.order_data?.product || "tu producto"}* está agendado para la próxima ronda de envíos. El delivery te confirma al llegar a tu zona. 😊`,
            context: {
              ...context,
              updated_at: new Date().toISOString(),
            },
          });
        }
      }
      oldOrder = { product: "", quantity: 0, city: "", customer_name: "", phone: "", address: "", calce: null };
    }

    // CONSULTA DE PRECIO
    if (isPriceQuery(texto)) {
      const productMentioned = detectProduct(texto, parsed, "");
      const lockedProductForPrice = getLockedProductFromContext(context, oldOrder, history, parsed);
      const productInfo =
        getProductInfo(productMentioned, parsed) ||
        (!productMentioned ? lockedProductForPrice : null);

      if (productInfo) {
        const resetOrder = {
          product: productInfo.canonical,
          quantity: 0,
          city: oldOrder.city || "",
          customer_name: "",
          phone: "",
          address: "",
          calce: null,
        };

        const calceMsg = productInfo.requires_calce
          ? `\n\n📏 Calces disponibles: ${productInfo.calces_disponibles?.join(", ") || "35 a 46"}`
          : "";

        return res.json({
          response: `💰 ${productInfo.canonical}: ${formatGs(productInfo.price1)} Gs${productInfo.price2 ? `\n🔥 Promo 2 unidades → ${formatGs(productInfo.price2)} Gs` : ""}${calceMsg}

📍 ¿Para qué ciudad sería el envío? 😊`,
          context: {
            ...(context || {}),
            current_product: productInfo.canonical,
            last_topic: productInfo.canonical,
            order_data: resetOrder,
            step: productInfo.requires_calce ? "collecting_calce" : "collecting_city",
            updated_at: new Date().toISOString(),
          },
        });
      }

      if (parsed.products.length > 0) {
        const priceLines = parsed.products.map((p) => {
          const promo = p.price2 ? ` | 🔥 2x → ${formatGs(p.price2)} Gs` : "";
          const calce = p.requires_calce ? ` (calce ${p.calces_disponibles?.join(", ") || "35-46"})` : "";
          return `⭐ *${p.canonical}*${calce}: ${formatGs(p.price1)} Gs${promo}`;
        });

        return res.json({
          response: `💰 *Nuestros precios:*\n\n${priceLines.join("\n")}\n\n¿Cuál te interesa? 😊`,
          context: {
            ...(context || {}),
            current_product: null,
            order_data: { product: "", quantity: 0, city: "", customer_name: "", phone: "", address: "", calce: null },
            step: "selling",
            updated_at: new Date().toISOString(),
          },
        });
      }
    }

    // PEDIDO STALE
    if (isOrderStale(oldOrder, context?.updated_at || new Date().toISOString())) {
      oldOrder = {
        product: "",
        quantity: 0,
        city: "",
        customer_name: "",
        phone: "",
        address: "",
        calce: null,
      };

      const productNames = parsed.products.map(p => p.canonical).join(", ");
      return res.json({
        response: `🔄 Veo que tenías un pedido incompleto. Comencemos de nuevo.

📋 ¿Qué producto te interesa? Tenemos: ${productNames}

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

    // DETECCIÓN DE INTENCIÓN DE COMPRA
    const buyIntent = isBuyIntent(texto);
    const hasProductInMessage = parsed.products.some(
      (p) =>
        normalize(texto).includes(normalize(p.canonical)) ||
        p.aliases.some((a) => normalize(texto).includes(normalize(a)))
    );

    // RESPUESTA A "QUIERO" GENÉRICO - USAR PRODUCTO BLOQUEADO
    if ((buyIntent || isGenericBuyReply(texto)) && !hasProductInMessage) {
      const lockedProduct = getLockedProductFromContext(context, oldOrder, history, parsed);

      if (lockedProduct) {
        const resetOrder = {
          product: lockedProduct.canonical,
          quantity: oldOrder.quantity > 0 ? oldOrder.quantity : 0,
          city: oldOrder.city || "",
          customer_name: "",
          phone: "",
          address: "",
          calce: oldOrder.calce || null,
        };

        const productInfo = getProductInfo(lockedProduct.canonical, parsed);
        const step = productInfo?.requires_calce && !resetOrder.calce ? "collecting_calce" : 
                     resetOrder.city ? "collecting_quantity" : "collecting_city";

        return res.json({
          response: productOfferReply(lockedProduct),
          context: {
            ...(context || {}),
            current_product: lockedProduct.canonical,
            last_topic: lockedProduct.canonical,
            order_data: resetOrder,
            step,
            updated_at: new Date().toISOString(),
          },
        });
      }

      // Si no hay producto bloqueado, mostrar catálogo
      const productLines = parsed.products.map(p => {
        const promo = p.price2 ? ` | 🔥 2x → ${formatGs(p.price2)} Gs` : "";
        return `⭐ *${p.canonical}*: ${formatGs(p.price1)} Gs${promo}`;
      });

      return res.json({
        response: `😊 Perfecto. ¿Cuál producto querés llevar?

📋 Nuestros productos:
${productLines.join("\n")}

Podés escribir el nombre del producto o mirar el catálogo:
${CATALOG_URL}`,
        context: {
          ...(context || {}),
          current_product: null,
          last_topic: null,
          order_data: { product: "", quantity: 0, city: "", customer_name: "", phone: "", address: "", calce: null },
          step: "selling",
          updated_at: new Date().toISOString(),
        },
      });
    }

    // DETECTAR PRODUCTO Y CIUDAD
    const productFromMessage = detectProduct(texto, parsed, "");
    const lockedProduct = getLockedProductFromContext(context, oldOrder, history, parsed);
    const productToUse = productFromMessage || lockedProduct?.canonical || oldOrder.product || "";
    const product = detectProduct(texto, parsed, productToUse);

    const detectedCity = detectCity(texto, parsed, oldOrder.city);
    const phone = extractPhone(texto);
    const qty = extractQuantity(texto);
    const name = extractName(texto, detectedCity, phone, parsed);
    const address = extractAddress(texto, detectedCity, phone, name);
    const calce = extractCalce(texto, parsed);

    let orderData = mergeOrderData(
      oldOrder,
      {
        quantity: qty,
        city: detectedCity || "",
        phone,
        name,
        address,
        calce,
      },
      product,
      parsed
    );

    orderData.quantity = sanitizeQuantity(orderData.quantity);

    const productInfo = getProductInfo(orderData.product, parsed);

    if (!productInfo) {
      orderData = { ...orderData, product: "" };
    }

    // SI NO HAY PRODUCTO - MOSTRAR CATÁLOGO
    if (!orderData.product) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      const productLines = parsed.products.map(p => {
        const promo = p.price2 ? ` | 🔥 2x → ${formatGs(p.price2)} Gs` : "";
        const calce = p.requires_calce ? ` (calce ${p.calces_disponibles?.join(", ") || "35-46"})` : "";
        return `⭐ *${p.canonical}*${calce}\n   💰 1 unidad → ${formatGs(p.price1)} Gs${promo}`;
      });

      return res.json({
        response: `🔥 *Estos son nuestros productos* 😊\n\n${productLines.join("\n\n")}\n\n¿Cuál te interesa? ✨`,
        context: {
          ...(context || {}),
          current_product: null,
          order_data: orderData,
          step: "selling",
          updated_at: new Date().toISOString(),
        },
      });
    }

    // SI HAY PRODUCTO PERO NO CIUDAD
    if (orderData.product && !orderData.city) {
      const prevStep = context?.step || "";
      const IS_GREETING = /^(hola|buenas|buenos|hi|hey|buen dia|buenos dias|buenas tardes|buenas noches|saludos|ok|dale|si|no|gracias|listo|perfecto|okey)[\s!.]*$/i;
      const looksLikeCity =
        prevStep === "collecting_city" &&
        !IS_GREETING.test(normalize(texto)) &&
        !extractQuantity(texto) &&
        !extractPhone(texto) &&
        !detectProduct(texto, parsed, "") &&
        normalize(texto).length >= 2 &&
        normalize(texto).split(/\s+/).length <= 6;

      if (looksLikeCity) {
        const rawCity = clean(texto);
        // Corregir la ciudad antes de guardarla
        const correctedCity = correctCity(rawCity, parsed);
        orderData = { ...orderData, city: correctedCity };

        await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

        const coverage = hasCoverage(correctedCity, parsed);
        const productInfoLocal = getProductInfo(orderData.product, parsed);
        const promo = productInfoLocal?.price2
          ? `\n🔥 PROMO 2x → ${formatGs(productInfoLocal.price2)} Gs`
          : "";

        if (coverage) {
          return res.json({
            response: `✅ Perfecto 😊 ${correctedCity} tiene ENVÍO GRATIS contra-entrega 🚚

🔥 ${orderData.product}:
• 1 unidad → ${formatGs(productInfoLocal?.price1 || 0)} Gs${promo}

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

        const bankInfo = parsed.bankData.length > 0 
          ? parsed.bankData.map(b => 
              `Titular: ${b.titular}${b.ci ? `\nCI: ${b.ci}` : ''}\nEntidad: ${b.entidad}\nCuenta: ${b.cuenta}${b.alias ? `\nAlias: ${b.alias}` : ''}`
            ).join('\n\n')
          : 'Titular: [TU NOMBRE]\nEntidad: [TU BANCO]\nCuenta: [TU CUENTA]\nAlias: [TU ALIAS]';

        return res.json({
          response: `ℹ️ ${correctedCity} no entra en nuestra zona de contra-entrega 😊

Pero sí hacemos envíos seguros por transportadora:
🚚 TSI / NASA / Occidental / MG Express / Multienvíos

📦 En tu zona trabajamos con pago anticipado por transferencia.

🔥 ${orderData.product}:
• 1 unidad → ${formatGs(productInfoLocal?.price1 || 0)} Gs${promo}

📲 DATOS PARA TRANSFERENCIA:

${bankInfo}

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

      const calceMsg = productInfo?.requires_calce
        ? `\n\n📏 Calces disponibles: ${productInfo.calces_disponibles?.join(", ") || "35 a 46"}`
        : "";

      return res.json({
        response: `💰 ${orderData.product}: ${formatGs(productInfo?.price1 || 0)} Gs${calceMsg}

📍 ¿Para qué ciudad sería el envío? 😊`,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          order_data: orderData,
          step: productInfo?.requires_calce ? "collecting_calce" : "collecting_city",
          updated_at: new Date().toISOString(),
        },
      });
    }

    // SI HAY PRODUCTO Y CIUDAD PERO FALTA CALCE (si requiere)
    if (orderData.product && orderData.city && productInfo?.requires_calce && !orderData.calce) {
      await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);

      return res.json({
        response: `📏 Para el *${productInfo.canonical}*, necesito saber tu calce/talle.${productInfo.calces_disponibles ? `\n\nCalces disponibles: ${productInfo.calces_disponibles.join(", ")}` : ""}\n\n¿Qué número usás? 😊`,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          order_data: orderData,
          step: "collecting_calce",
          updated_at: new Date().toISOString(),
        },
      });
    }

    // SI HAY PRODUCTO Y CIUDAD PERO NO CANTIDAD
    if (orderData.product && orderData.city && !orderData.quantity) {
      const msgNormQty = normalize(texto);
      const isGratitudeHere = /\b(gracias|grax|grac|ok|dale|perfecto|listo|genial|excelente|de nada|chevere|okey|bueno|joya)\b/.test(msgNormQty);
      if (isGratitudeHere && !extractQuantity(texto)) {
        return res.json({
          response: `¡De nada! 😊 Cuando quieras continuar con tu pedido del *${orderData.product}*, avisame. 💜`,
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

      const coverage = hasCoverage(orderData.city, parsed);
      const promo = productInfo?.price2
        ? `\n🔥 PROMO 2x → ${formatGs(productInfo.price2)} Gs`
        : "";
      const calceMsg2 = productInfo?.requires_calce
        ? `\n📏 Calce: ${orderData.calce}`
        : "";

      if (!coverage) {
        const bankInfo = parsed.bankData.length > 0 
          ? parsed.bankData.map(b => 
              `Titular: ${b.titular}${b.ci ? `\nCI: ${b.ci}` : ''}\nEntidad: ${b.entidad}\nCuenta: ${b.cuenta}${b.alias ? `\nAlias: ${b.alias}` : ''}`
            ).join('\n\n')
          : 'Titular: [TU NOMBRE]\nEntidad: [TU BANCO]\nCuenta: [TU CUENTA]\nAlias: [TU ALIAS]';

        const sinCoberturaBlock = `ℹ️ ${orderData.city} no entra en nuestra zona de contra-entrega 😊

Pero sí hacemos envíos seguros por transportadora:
🚚 TSI / NASA / Occidental / MG Express / Multienvíos

📦 En tu zona trabajamos con pago anticipado por transferencia.

🔥 ${orderData.product}:
• 1 unidad → ${formatGs(productInfo?.price1 || 0)} Gs${promo}${calceMsg2}

📲 DATOS PARA TRANSFERENCIA:

${bankInfo}

📎 Enviame:
✅ comprobante
✅ nombre completo
✅ teléfono

y confirmamos tu pedido 🚚✨`;

        const sinCoberturaCtx = {
          ...(context || {}),
          current_product: orderData.product,
          order_data: orderData,
          step: "collecting_quantity",
          updated_at: new Date().toISOString(),
        };

        if (prevStep === "collecting_quantity") {
          const msgNormCov = normalize(texto);
          const isDeliveryQuestion = /\b(cuando|llega|llego|entrega|envio|despacho|dias|demora|tarda)\b/.test(msgNormCov);
          const isNewPurchaseQ = /\b(descuento|oferta|promo|precio|cuanto|compro|comprar)\b/.test(msgNormCov);
          const isGreetingOnly = /^(hola|buenas|hi|hey|que tal|hola que tal|buenos dias|buenas tardes|buenas noches)[\s!.]*$/i.test(msgNormCov);

          if (isDeliveryQuestion) {
            return res.json({
              response: `🚚 Una vez que recibamos tu comprobante de transferencia y tus datos, coordinamos el envío con la transportadora.\n\nEl tiempo estimado suele ser de 2 a 5 días hábiles según tu zona. 😊\n\n📎 Enviame:\n✅ comprobante\n✅ nombre completo\n✅ teléfono`,
              context: sinCoberturaCtx,
            });
          }
          if (isNewPurchaseQ) {
            return res.json({
              response: sinCoberturaBlock,
              context: sinCoberturaCtx,
            });
          }
          if (!isGreetingOnly) {
            return res.json({
              response: `📎 Para confirmar tu pedido de *${orderData.product}*, enviame:\n✅ comprobante de transferencia\n✅ nombre completo\n✅ teléfono 😊`,
              context: sinCoberturaCtx,
            });
          }
          return res.json({ response: sinCoberturaBlock, context: sinCoberturaCtx });
        }

        return res.json({
          response: sinCoberturaBlock,
          context: sinCoberturaCtx,
        });
      }

      return res.json({
        response: `✅ Perfecto 😊 ${orderData.city} tiene ENVÍO GRATIS contra-entrega 🚚

🔥 ${orderData.product}
• 1 unidad → ${formatGs(productInfo?.price1 || 0)} Gs${promo}${calceMsg2}

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

    // SI FALTAN DATOS DEL CLIENTE (nombre, dirección, teléfono)
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

      const calceMsg3 = orderData.calce ? `\n📏 Calce: ${orderData.calce}` : "";

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
💰 Total: ${formatGs(total)} Gs${calceMsg3}

🚚 Envío GRATIS contra-entrega

📎 Me falta: ${missingFinal.join(", ")}

📲 Podés enviarlo TODO JUNTO o de a uno, voy registrando 😊

y agendamos tu entrega ✨`,
          context: {
            ...(context || {}),
            current_product: orderData.product,
            order_data: orderData,
            step: nextStep(orderData, parsed),
            updated_at: new Date().toISOString(),
          },
        });
      }

      return res.json({
        response: `🔥 Perfecto 😊

📦 ${orderData.product}
🔢 Cantidad: ${orderData.quantity}
💰 Total: ${formatGs(total)} Gs${calceMsg3}

🚚 Envío GRATIS contra-entrega

📎 Me falta: ${missing.join(", ")}

📲 Podés enviarlo TODO JUNTO o de a uno, voy registrando 😊

y agendamos tu entrega ✨`,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          order_data: orderData,
          step: nextStep(orderData, parsed),
          updated_at: new Date().toISOString(),
        },
      });
    }

    // SI TODOS LOS DATOS ESTÁN COMPLETOS -> CONFIRMAR PEDIDO
    if (
      orderData.product &&
      orderData.city &&
      orderData.quantity > 0 &&
      orderData.customer_name &&
      orderData.address &&
      orderData.phone &&
      (!productInfo?.requires_calce || orderData.calce)
    ) {
      if (!getProductInfo(orderData.product, parsed)) {
        return res.json({
          response:
            "🙏 Para confirmar necesito saber qué producto querés. ¿Podés decirme el nombre?",
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

    // FALLBACK - USAR GEMINI
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
        step: nextStep(orderData, parsed),
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
