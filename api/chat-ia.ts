import { createClient } from "@supabase/supabase-js";

/**
 * CHAT IA VENDEDOR AUTÓNOMO V5 - Training Only + Full Flow
 * 
 * MODIFICACIONES:
 * 1. TODO se guía por el entrenamiento de CADA VENDEDOR
 * 2. Maneja cobertura, datos bancarios, confirmación de pedidos
 * 3. Flujo completo: producto -> ciudad -> cantidad -> datos -> confirmación
 * 4. Respuestas 100% basadas en entrenamiento
 * 5. Sin plantillas fijas, se adapta al formato del vendedor
 */

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const clean = (v: any) => String(v || "").trim();
const normalize = (v: any) => clean(v).toLowerCase().replace(/\s+/g, " ").trim();

// ============ TIPOS ============
type ProductInfo = {
  name: string;
  canonical: string;
  aliases: string[];
  price1: number;
  price2?: number;
  price3?: number;
  salesCopy: string;
  rawTraining: string;
};

type CityInfo = {
  name: string;
  aliases: string[];
  hasCoverage: boolean;
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

type TrainingData = {
  products: ProductInfo[];
  cities: CityInfo[];
  bankData: BankData | null;
  catalogUrl: string;
  raw: string;
  fullTraining: string;
};

type OrderData = {
  order_id?: string;
  product: string;
  quantity: number;
  city: string;
  customer_name: string;
  address: string;
  phone: string;
  payment_proof_received: boolean;
  total: number;
};

type ConversationState = {
  order: OrderData;
  step: string;
  productInfo: ProductInfo | null;
  coverage: boolean | null;
  missing: string[];
  total: number;
};

// ============ UTILIDADES ============
function makeOrderId(fromNumber: string) {
  const safeFrom = clean(fromNumber).replace(/\D/g, "").slice(-8) || "chat";
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${Date.now()}-${safeFrom}-${rand}`;
}

function formatGs(n: number) {
  return Number(n || 0).toLocaleString("es-PY");
}

function sanitizeQuantity(q: any) {
  const n = Number(q);
  if (!Number.isFinite(n)) return 0;
  if (n < 1) return 0;
  if (n > 100) return 100;
  return n;
}

function isBuyIntent(text: string) {
  const m = normalize(text);
  return /\b(si|sí|quiero|llevo|comprar|compro|confirmo|confirmar|ok|dale|listo|me interesa|lo quiero|quiero ese|ese quiero)\b/.test(m);
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

  const q2 = m.match(/\b(quiero|llevo|dame|solo|solamente|serian|serían)\s+(\d+)\b/);
  if (q2) return sanitizeQuantity(Number(q2[2]));

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

function extractName(text: string) {
  const raw = clean(text);
  if (!raw) return "";
  
  const explicit = raw.match(/(?:soy|me llamo|mi nombre es|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,80})/i)?.[1];
  if (explicit) return clean(explicit);
  
  const lines = raw.split("\n").filter(l => clean(l));
  for (const line of lines) {
    const cleaned = clean(line);
    if (!/\d/.test(cleaned) && cleaned.length >= 4 && cleaned.length <= 60) {
      return cleaned;
    }
  }
  
  return "";
}

function extractAddress(text: string) {
  const raw = clean(text);
  const explicit = raw.match(/(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i)?.[1];
  if (explicit) return clean(explicit);
  
  const lines = raw.split("\n").filter(l => clean(l));
  for (const line of lines) {
    const cleaned = clean(line);
    if (/\b(calle|avda|avenida|ruta|km|barrio|casa|frente|esquina|numero|nro|manzana|mz|lote)\b/i.test(cleaned)) {
      return cleaned;
    }
  }
  
  return "";
}

// ============ PARSEO DE ENTRENAMIENTO ============
function parseTrainingFromText(text: string): TrainingData {
  const products: ProductInfo[] = [];
  const cities: CityInfo[] = [];
  let bankData: BankData | null = null;
  let catalogUrl = "";

  // 1. PARSEAR CATÁLOGO DE PRODUCTOS
  const catalogMatch = text.match(/CATALOGO_PRODUCTOS([\s\S]*?)(?:FIN_CATALOGO_PRODUCTOS|$)/i);
  const catalogText = catalogMatch ? catalogMatch[1] : text;

  const productBlocks = catalogText.split(/(?=PRODUCTO:\s*)/i).filter(b => b.trim());
  
  for (const block of productBlocks) {
    const productMatch = block.match(/^PRODUCTO:\s*(.+)$/im);
    const canonicalMatch = block.match(/^NOMBRE_CANONICO:\s*(.+)$/im);
    const aliasMatch = block.match(/^ALIAS:\s*(.+)$/im);
    const price1Match = block.match(/^PRECIO_1:\s*(\d+)/im);
    const price2Match = block.match(/^PRECIO_2:\s*(\d+)/im);
    const price3Match = block.match(/^PRECIO_3:\s*(\d+)/im);
    const messageMatch = block.match(/^MENSAJE_VENTA:\s*([\s\S]*?)(?=^[A-Z_]+:|$)/im);

    if (productMatch && price1Match) {
      const product = clean(productMatch[1]);
      const canonical = clean(canonicalMatch?.[1] || product);
      const aliases = aliasMatch ? aliasMatch[1].split(",").map(clean).filter(Boolean) : [];
      const price1 = Number(clean(price1Match[1]) || 0);
      const price2 = price2Match ? Number(clean(price2Match[1])) : undefined;
      const price3 = price3Match ? Number(clean(price3Match[1])) : undefined;
      const salesCopy = messageMatch ? clean(messageMatch[1]) : block;

      if (price1 > 0) {
        products.push({
          name: product,
          canonical,
          aliases: Array.from(new Set([product, canonical, ...aliases])),
          price1,
          price2,
          price3,
          salesCopy: salesCopy || block,
          rawTraining: block
        });
      }
    }
  }

  // 2. PARSEAR CIUDADES CON COBERTURA
  const coverageSection = text.match(/ZONAS CON COBERTURA([\s\S]*?)(?:ZONAS SIN COBERTURA|$)/i);
  if (coverageSection) {
    const lines = coverageSection[1].split("\n").filter(l => l.trim());
    for (const line of lines) {
      const cleaned = clean(line);
      if (!cleaned || cleaned.includes("📍") || cleaned.includes("━━")) continue;
      
      // Detectar ciudad principal y sus variantes
      const cityMatch = cleaned.match(/^([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/);
      if (cityMatch) {
        const mainCity = cityMatch[1];
        const aliases: string[] = [mainCity];
        
        // Buscar variantes en la misma línea (ej: "✅ Asunción, Villa Morra, etc.")
        const variants = cleaned.match(/✅\s*([^,]+)/g);
        if (variants) {
          for (const v of variants) {
            const alias = clean(v.replace(/✅/, ""));
            if (alias && !aliases.includes(alias)) aliases.push(alias);
          }
        }
        
        cities.push({
          name: mainCity,
          aliases: aliases,
          hasCoverage: true
        });
      }
    }
  }

  // 3. PARSEAR DATOS BANCARIOS
  const bankMatch = text.match(/DATOS_(?:BANCARIOS|TRANSFERENCIA)([\s\S]*?)(?:FIN_DATOS_(?:BANCARIOS|TRANSFERENCIA)|$)/i);
  if (bankMatch) {
    const raw = clean(bankMatch[1]);
    const get = (...labels: string[]) => {
      for (const label of labels) {
        const re = new RegExp(`^\\s*${label}\\s*[:\\-]?\\s*(.+)$`, "im");
        const v = raw.match(re)?.[1];
        if (v) return clean(v);
      }
      return "";
    };

    bankData = {
      titular: get("Titular"),
      ci: get("CI", "Cédula", "Cedula"),
      entidad: get("Entidad"),
      banco: get("Banco"),
      cuenta: get("N° de cuenta", "Nro de cuenta", "Numero de cuenta", "Número de cuenta", "Cuenta"),
      alias: get("Alias"),
      raw
    };
  }

  // 4. PARSEAR URL DE CATÁLOGO
  const urlMatch = text.match(/(?:CATALOGO_URL|URL_CATALOGO)\s*:\s*(https?:\/\/[^\s]+)/i);
  if (urlMatch) catalogUrl = urlMatch[1];

  // 5. SI NO HAY PRODUCTOS, DETECTAR AUTOMÁTICAMENTE
  if (products.length === 0) {
    const lines = text.split("\n").filter(l => l.trim());
    for (const line of lines) {
      const hasPrice = /\b(\d{5,})\b/.test(line);
      const hasProductName = /^[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑ\s]{3,}/.test(line);
      if (hasProductName && hasPrice) {
        const name = line.match(/^([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑ\s]{3,})/)?.[1] || "Producto";
        const price = Number(line.match(/\b(\d{5,})\b/)?.[1] || 0);
        if (price > 0) {
          products.push({
            name: clean(name),
            canonical: clean(name),
            aliases: [clean(name)],
            price1: price,
            salesCopy: line,
            rawTraining: line
          });
        }
      }
    }
  }

  // Si aún no hay productos, usar todo el texto
  if (products.length === 0 && text.trim()) {
    products.push({
      name: "Productos del vendedor",
      canonical: "Productos del vendedor",
      aliases: ["productos", "catalogo", "catálogo"],
      price1: 0,
      salesCopy: text,
      rawTraining: text
    });
  }

  return {
    products,
    cities,
    bankData,
    catalogUrl,
    raw: text,
    fullTraining: text
  };
}

// ============ FUNCIONES DE NEGOCIO ============
function findProduct(text: string, training: TrainingData): ProductInfo | null {
  const userMessage = normalize(text);
  if (!userMessage || training.products.length === 0) return null;

  let bestProduct: ProductInfo | null = null;
  let bestScore = 0;

  for (const product of training.products) {
    let score = 0;
    const productText = normalize(product.name + " " + product.canonical + " " + product.aliases.join(" ") + " " + product.salesCopy);
    
    const words = userMessage.split(/\s+/);
    for (const word of words) {
      if (word.length < 3) continue;
      if (productText.includes(word)) score += 10;
      if (product.name.toLowerCase().includes(word)) score += 20;
      if (product.canonical.toLowerCase().includes(word)) score += 25;
      if (product.aliases.some(a => normalize(a).includes(word))) score += 15;
    }

    if (userMessage.includes(product.name.toLowerCase())) score += 30;
    if (userMessage.includes(product.canonical.toLowerCase())) score += 35;

    if (score > bestScore) {
      bestScore = score;
      bestProduct = product;
    }
  }

  if (bestProduct && bestScore > 10) return bestProduct;
  if (training.products.length === 1) return training.products[0];
  
  return null;
}

function findCity(text: string, training: TrainingData): string | null {
  const userMessage = normalize(text);
  if (!userMessage || training.cities.length === 0) return null;

  let bestCity: string | null = null;
  let bestScore = 0;

  for (const city of training.cities) {
    let score = 0;
    const cityText = normalize(city.name + " " + city.aliases.join(" "));
    
    if (userMessage === cityText) score += 100;
    if (userMessage.includes(city.name.toLowerCase())) score += 80;
    
    for (const alias of city.aliases) {
      const normAlias = normalize(alias);
      if (userMessage.includes(normAlias)) score += 60;
      if (normAlias.includes(userMessage) && userMessage.length > 3) score += 40;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCity = city.name;
    }
  }

  return bestCity && bestScore > 30 ? bestCity : null;
}

function hasCoverage(city: string, training: TrainingData): boolean {
  const cityNorm = normalize(city);
  for (const c of training.cities) {
    if (normalize(c.name) === cityNorm) return c.hasCoverage;
    for (const alias of c.aliases) {
      if (normalize(alias) === cityNorm) return c.hasCoverage;
    }
  }
  return false;
}

function getProductPrice(product: ProductInfo, quantity: number): number {
  const q = sanitizeQuantity(quantity);
  if (q === 2 && product.price2) return product.price2;
  if (q === 3 && product.price3) return product.price3;
  return product.price1 * q;
}

function getBankDataText(training: TrainingData): string {
  const b = training.bankData;
  if (!b) return "Datos de transferencia no configurados en el entrenamiento.";
  
  const lines = [
    b.titular ? `Titular: ${b.titular}` : "",
    b.ci ? `CI: ${b.ci}` : "",
    b.entidad ? `Entidad: ${b.entidad}` : "",
    b.banco ? `Banco: ${b.banco}` : "",
    b.cuenta ? `N° de cuenta: ${b.cuenta}` : "",
    b.alias ? `Alias: ${b.alias}` : "",
  ].filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : b.raw || "Datos de transferencia no configurados.";
}

function getMissingData(order: OrderData, coverage: boolean | null): string[] {
  const missing: string[] = [];
  if (!order.product) missing.push("producto");
  if (!order.city) missing.push("ciudad");
  if (!order.quantity) missing.push("cantidad");
  if (!order.customer_name) missing.push("nombre completo");
  if (coverage !== false && !order.address) missing.push("dirección exacta");
  if (!order.phone) missing.push("número de celular");
  if (coverage === false && !order.payment_proof_received) missing.push("comprobante de transferencia");
  return missing;
}

function getNextStep(order: OrderData, coverage: boolean | null): string {
  if (!order.product) return "collecting_product";
  if (!order.city) return "collecting_city";
  if (!order.quantity) return "collecting_quantity";
  if (!order.customer_name) return "collecting_name";
  if (coverage !== false && !order.address) return "collecting_address";
  if (!order.phone) return "collecting_phone";
  if (coverage === false && !order.payment_proof_received) return "waiting_payment";
  return "confirm_order";
}

// ============ PROMPTS ============
function buildSystemPrompt(training: TrainingData, state: ConversationState): string {
  const { order, productInfo, coverage, missing } = state;
  
  const productsList = training.products.map(p => 
    `- ${p.canonical}: ${formatGs(p.price1)} Gs${p.price2 ? ` | 2x ${formatGs(p.price2)} Gs` : ''}${p.price3 ? ` | 3x ${formatGs(p.price3)} Gs` : ''}`
  ).join("\n");

  const citiesList = training.cities.map(c => 
    `- ${c.name}${c.hasCoverage ? ' (con cobertura)' : ' (sin cobertura)'}`
  ).join("\n");

  let specificCopy = "";
  if (productInfo && productInfo.salesCopy) {
    specificCopy = `
COPY DE VENTA DE ESTE PRODUCTO:
${productInfo.salesCopy}
`;
  }

  return `
Eres un vendedor experto de WhatsApp para Mega Todo Store / One Store.

ENTRENAMIENTO DEL VENDEDOR:
${training.fullTraining}

${specificCopy}

PRODUCTOS DISPONIBLES:
${productsList}

CIUDADES CON COBERTURA:
${citiesList}

DATOS BANCARIOS:
${getBankDataText(training)}

${training.catalogUrl ? `CATÁLOGO COMPLETO: ${training.catalogUrl}` : ''}

ESTADO ACTUAL DEL PEDIDO:
- Producto: ${order.product || "faltante"}
- Cantidad: ${order.quantity || "faltante"} 
- Ciudad: ${order.city || "faltante"}
- Cobertura: ${coverage === null ? "aún no se sabe" : coverage ? "sí, tiene cobertura" : "no, sin cobertura"}
- Nombre: ${order.customer_name || "faltante"}
- Dirección: ${order.address || "faltante"}
- Teléfono: ${order.phone || "faltante"}
- Total: ${state.total ? formatGs(state.total) + " Gs" : "aún no calculado"}
- Faltante: ${missing.length ? missing.join(", ") : "nada"}

INSTRUCCIONES ESTRICTAS:
1. RESPONDE EXCLUSIVAMENTE BASÁNDOTE EN EL ENTRENAMIENTO DEL VENDEDOR
2. NO INVENTES información que no esté en el entrenamiento
3. USA EL COPY DEL PRODUCTO como base para vender
4. PREGUNTA SIEMPRE lo que falta (ver "Faltante")
5. SI EL CLIENTE PREGUNTA POR UN PRODUCTO, USA ESE PRODUCTO DEL ENTRENAMIENTO
6. SI EL CLIENTE DA UNA CIUDAD, VERIFICA SI TIENE COBERTURA
7. SI NO TIENE COBERTURA, OFRECE ENVÍO POR TRANSPORTADORA CON PAGO ANTICIPADO
8. SI TIENE COBERTURA, OFRECE ENVÍO GRATIS CONTRA-ENTREGA
9. DESPUÉS DE CONFIRMAR, USA EL FORMATO OFICIAL DE CONFIRMACIÓN
10. SÉ NATURAL, CÁLIDO Y PROFESIONAL - COMO UN VENDEDOR HUMANO
11. USA EMOJIS MODERADOS: 😊🔥🚚✅📦💰📍📲

RESPONDE COMO UN VENDEDOR HUMANO, USANDO EL ENTRENAMIENTO COMO BASE.`;
}

function buildConfirmationMessage(state: ConversationState, training: TrainingData): string {
  const o = state.order;
  
  if (state.coverage === false) {
    return `✅ PEDIDO CONFIRMADO

✅ Producto: ${o.product}
✅ Cliente: ${o.customer_name}
✅ Ubicación: ${o.city}${o.address ? ` — ${o.address}` : ''}
✅ Contacto: ${o.phone}
✅ Cantidad: ${o.quantity} u.
💰 Total: ${formatGs(state.total)} Gs

🚚 Su encomienda será enviada por transportadora.

📎 Ya recibimos tus datos y comprobante. Una vez procesado el envío, te estaremos enviando tu comprobante de despacho.

⏰ Oferta válida hoy

¡Gracias por elegirnos!!! 💜✨

💵 Pago anticipado por transferencia.

¡Gracias por tu compra! 🛍️✨
`;
  }

  return `✅ PEDIDO CONFIRMADO

✅ Producto: ${o.product}
✅ Cliente: ${o.customer_name}
✅ Ubicación: ${o.city}${o.address ? ` — ${o.address}` : ''}
✅ Contacto: ${o.phone}
✅ Cantidad: ${o.quantity} u.
💰 Total: ${formatGs(state.total)} Gs

🚚 Envío GRATIS · Pagás al recibir

🚚 Tu pedido queda agendado para la próxima ronda de envíos. El delivery te confirma al llegar a tu zona.

⏰ Oferta válida hoy

¡Gracias por elegirnos!!! 💜✨

💵 Podés pagar en EFECTIVO o TRANSFERENCIA AL DELIVERY cuando recibas tu producto.

¡Gracias por tu compra! 🛍️✨
`;
}

function buildFallbackResponse(training: TrainingData, state: ConversationState): string {
  const o = state.order;
  
  if (!o.product) {
    const products = training.products.slice(0, 3);
    let response = "¡Hola! 😊 Te cuento sobre nuestros productos:\n\n";
    for (const p of products) {
      response += `📦 ${p.canonical}: ${formatGs(p.price1)} Gs\n`;
      if (p.price2) response += `   🔥 Promo 2x: ${formatGs(p.price2)} Gs\n`;
      if (p.price3) response += `   🔥 Promo 3x: ${formatGs(p.price3)} Gs\n`;
    }
    response += `\n📍 ¿Qué te interesa? 😊`;
    return response;
  }

  if (!o.city) {
    return `✅ Excelente elección, ${o.product} 😊

💰 Precio: ${formatGs(state.total || getProductPrice(state.productInfo!, 1))} Gs

📍 ¿Para qué ciudad sería el envío? 🚚`;
  }

  if (!o.quantity) {
    const price1 = state.productInfo?.price1 || 0;
    const price2 = state.productInfo?.price2;
    const price3 = state.productInfo?.price3;
    
    let response = `📍 ${o.city} ${state.coverage ? 'tiene envío GRATIS contra-entrega 🚚' : 'no tiene contra-entrega, pero enviamos por transportadora'}\n\n`;
    response += `💰 Precios de ${o.product}:\n`;
    response += `• 1 unidad: ${formatGs(price1)} Gs\n`;
    if (price2) response += `• 2 unidades: ${formatGs(price2)} Gs (ahorrás ${formatGs(price1*2 - price2)} Gs)\n`;
    if (price3) response += `• 3 unidades: ${formatGs(price3)} Gs (ahorrás ${formatGs(price1*3 - price3)} Gs)\n`;
    response += `\n📦 ¿Cuántas unidades querés llevar? 😊`;
    return response;
  }

  if (!o.customer_name) {
    return `✅ Perfecto, ${o.quantity} unidad${o.quantity > 1 ? 'es' : ''} de ${o.product} por ${formatGs(state.total)} Gs 😊

📍 ${o.city} ${state.coverage ? 'tiene envío GRATIS y pagás al recibir 🚚' : 'se envía por transportadora con pago anticipado 💵'}

${!state.coverage ? `\n${getBankDataText(training)}\n` : ''}
Para agendar tu pedido, necesito:
✅ Nombre completo
✅ ${state.coverage !== false ? 'Dirección exacta o ubicación' : 'Número de celular'}
📲 ¿Me pasás tus datos?`;
  }

  if (state.coverage !== false && !o.address) {
    return `✅ Gracias, ${o.customer_name} 😊

📍 Para ${o.city}, necesito la dirección exacta o ubicación 🏠

¿Podés pasarme el punto de referencia? 📍`;
  }

  if (!o.phone) {
    return `✅ Perfecto, ${o.customer_name} 😊

📍 ${o.city}${o.address ? ` - ${o.address}` : ''}

📲 Necesito tu número de celular para coordinar el envío. ¿Cuál es tu número? 😊`;
  }

  if (state.coverage === false && !o.payment_proof_received) {
    return `✅ Datos completos, ${o.customer_name} 😊

📦 ${o.product}
🔢 ${o.quantity} unidad${o.quantity > 1 ? 'es' : ''}
💰 Total: ${formatGs(state.total)} Gs
📍 ${o.city} - sin cobertura

💵 Para confirmar el pedido, necesito el comprobante de transferencia:

${getBankDataText(training)}

📲 ¿Me enviás el comprobante?`;
  }

  return buildConfirmationMessage(state, training);
}

// ============ GEMINI ============
async function callGemini({
  apiKey,
  model,
  system,
  contents,
  temperature,
  maxTokens,
}: any): Promise<string> {
  try {
    const body: any = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature: temperature || 0.6,
        maxOutputTokens: maxTokens || 2048,
        topP: 0.95,
        topK: 40,
      },
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Gemini API Error:", JSON.stringify(data, null, 2));
      return "";
    }

    return clean(data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "");
  } catch (error) {
    console.error("❌ Gemini call error:", error);
    return "";
  }
}

// ============ SUPABASE ============
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

async function saveOrder(userId: string, from: string, order: OrderData, state: ConversationState) {
  const orderId = order.order_id || makeOrderId(from);
  
  const payload: any = {
    user_id: userId,
    order_id: orderId,
    from_number: from,
    phone: order.phone || from,
    product: order.product,
    customer_name: order.customer_name || null,
    city: order.city || null,
    address: order.address || null,
    quantity: order.quantity || 1,
    total_amount: state.total || null,
    status: state.step === "confirm_order" ? "confirmed" : state.step,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("orders")
    .upsert(payload, { onConflict: "user_id,order_id" })
    .select("id")
    .single();

  if (error) {
    console.error("❌ orders upsert:", error);
    return null;
  }

  return data?.id || null;
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
    } = req.body;

    const texto = clean(message);
    const fromNumber = clean(from_number);

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });
    if (!texto) return res.status(400).json({ error: "Falta message" });

    // 1. OBTENER CONFIGURACIÓN
    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key) {
      return res.json({ response: "⚠️ La IA no está configurada o desactivada." });
    }

    // 2. OBTENER ENTRENAMIENTO
    const allTraining = await getAllTrainingData(user_id);
    const trainingText = buildTrainingText(allTraining);
    const training = parseTrainingFromText(trainingText);

    // 3. OBTENER ESTADO ACTUAL
    const oldOrder: OrderData = {
      order_id: context?.order_id || makeOrderId(fromNumber),
      product: context?.product || "",
      quantity: context?.quantity || 0,
      city: context?.city || "",
      customer_name: context?.customer_name || "",
      address: context?.address || "",
      phone: context?.phone || "",
      payment_proof_received: context?.payment_proof_received || false,
      total: context?.total || 0,
    };

    // 4. DETECTAR PRODUCTO, CIUDAD, CANTIDAD, DATOS
    const productInfo = findProduct(texto, training);
    const detectedCity = findCity(texto, training);
    const detectedQuantity = extractQuantity(texto);
    const detectedPhone = extractPhone(texto);
    const detectedName = extractName(texto);
    const detectedAddress = extractAddress(texto);
    
    const hasBuyIntent = isBuyIntent(texto);

    // 5. ACTUALIZAR PEDIDO
    const order: OrderData = {
      order_id: oldOrder.order_id || makeOrderId(fromNumber),
      product: productInfo?.canonical || oldOrder.product || "",
      quantity: detectedQuantity || oldOrder.quantity || 0,
      city: detectedCity || oldOrder.city || "",
      customer_name: detectedName || oldOrder.customer_name || "",
      address: detectedAddress || oldOrder.address || "",
      phone: detectedPhone || oldOrder.phone || "",
      payment_proof_received: oldOrder.payment_proof_received || false,
      total: 0,
    };

    // Si el cliente dijo "quiero" y no hay producto, usar el primero
    if (hasBuyIntent && !order.product && training.products.length > 0) {
      order.product = training.products[0].canonical;
    }

    // Si hay producto y cantidad, calcular total
    const finalProductInfo = findProduct(order.product, training);
    if (finalProductInfo && order.quantity > 0) {
      order.total = getProductPrice(finalProductInfo, order.quantity);
    }

    // Determinar cobertura
    const coverage = order.city ? hasCoverage(order.city, training) : null;

    // Si ciudad no tiene cobertura y no hay comprobante, marcar
    if (coverage === false && !order.payment_proof_received) {
      // No confirmar automáticamente
    }

    // Si tiene comprobante, marcarlo
    if (context?.payment_proof_received) {
      order.payment_proof_received = true;
    }

    // 6. CONSTRUIR ESTADO
    const missing = getMissingData(order, coverage);
    const step = getNextStep(order, coverage);
    const state: ConversationState = {
      order,
      step,
      productInfo: finalProductInfo || null,
      coverage,
      missing,
      total: order.total || 0,
    };

    // 7. VERIFICAR SI ESTÁ COMPLETO PARA CONFIRMAR
    const isComplete = step === "confirm_order";
    
    // 8. SI ESTÁ COMPLETO, CONFIRMAR DIRECTAMENTE
    if (isComplete) {
      await saveOrder(user_id, fromNumber, order, state);
      
      return res.json({
        response: buildConfirmationMessage(state, training),
        context: {
          ...(context || {}),
          ...order,
          product: order.product,
          quantity: order.quantity,
          city: order.city,
          customer_name: order.customer_name,
          address: order.address,
          phone: order.phone,
          total: state.total,
          step: "pedido_confirmado",
          updated_at: new Date().toISOString(),
        },
        debug: {
          complete: true,
          step,
          coverage,
          missing,
          total: state.total,
        }
      });
    }

    // 9. SI NO ESTÁ COMPLETO, USAR IA PARA RESPONDER
    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    // Construir prompt
    const system = buildSystemPrompt(training, state);

    // Construir historial
    const contents = (history || [])
      .slice(-10)
      .filter((h: any) => clean(h?.content))
      .map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: clean(h.content) }],
      }));

    contents.push({
      role: "user",
      parts: [{ text: texto }],
    });

    // Llamar a Gemini
    let aiResponse = await callGemini({
      apiKey,
      model,
      system,
      contents,
      temperature: iaConfig.temperature ?? 0.6,
      maxTokens: Math.max(iaConfig.max_tokens ?? 0, 1024),
    });

    // Si no hay respuesta, usar fallback
    if (!aiResponse || aiResponse.length < 5) {
      console.log("⚠️ Usando fallback response");
      aiResponse = buildFallbackResponse(training, state);
    }

    // Guardar orden en progreso
    await saveOrder(user_id, fromNumber, order, state);

    return res.json({
      response: clean(aiResponse).replace(/\n{3,}/g, "\n\n").slice(0, 4000),
      context: {
        ...(context || {}),
        ...order,
        product: order.product,
        quantity: order.quantity,
        city: order.city,
        customer_name: order.customer_name,
        address: order.address,
        phone: order.phone,
        total: state.total,
        step: step,
        updated_at: new Date().toISOString(),
      },
      debug: {
        step,
        coverage,
        missing,
        total: state.total,
        product_found: !!finalProductInfo,
        ai_response_length: aiResponse?.length || 0,
      }
    });

  } catch (error: any) {
    console.error("❌ chat-ia-vendedor-v5:", error);
    return res.status(500).json({
      error: error.message || "Error interno",
    });
  }
}
