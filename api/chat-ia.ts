// api/chat-ia.ts
// Chat IA con Gemini - Manejo de contexto de ventas
// + FIX: "quiero 1" con producto activo va directo a cantidad/resumen
// + FIX: Esperando ciudad → extrae ciudad y avanza a cantidad
// + IMPORTANTE: Estos bloques van ANTES de detectar producto o llamar a Gemini

import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const clean = (t: string) => String(t || "").trim();
const normalize = (t: string) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// ═══════════════════════════════════════════════════════════
// EXTRACCIÓN DE CIUDAD
// ═══════════════════════════════════════════════════════════

const CIUDADES_PARAGUAY = [
  "asuncion", "asunción", "san lorenzo", "fernando de la mora", "lambaré",
  "luque", "capiatá", "limpio", "Ñemby", "villa elisa", "san antonio",
  "mariano roque alonso", "itaugua", "ypane", "ypacarai", "aregua",
  "pirayu", "villeta", "ita", "guarambare", "san miguel", "tavai",
  "caacupe", "carapegua", "san josé de los arroyos", "paraguari",
  "encarnación", "cambyreta", "fram", "trinidad", "jesús", "capitán miranda",
  "ciudad del este", "presidente franco", "minga guazú", "hernandarias",
  "los laureles", "jd", "juan de salazar", "catuete", "saltos del guaira",
  "pedro juan caballero", "capitán bado", "concepción", "horqueta",
  "yby yaú", "belén", "san pedro", "antaequera", "lima", "choré",
  "villa del rosario", "caazapá", "abai", "san juan nepomuceno", "buena vista",
  "coronel oviedo", "caaguazú", "repatriación", "carayaó", "mbocayaty",
  "villarrica", "independencia", "mbuyapey", "itapé", "san salvador",
  "pilar", "ñeembucú", "alberdi", "humaitá", "san juan bautista", "ayolas",
  "santiago", "san ignacio", "santa rosa", "san cosme y damián", "santa maría",
  "filadelfia", "loma plata", "neuland", "boquerón", "mariscal estigarribia"
];

function extractCityFromText(text: string): string | null {
  const t = normalize(text);
  
  // Patrones comunes: "soy de [ciudad]", "vivo en [ciudad]", "de [ciudad]", "[ciudad]"
  const patterns = [
    /(?:soy de|vivo en|de|en|desde)\s+([a-záéíóúñ\s]+)/i,
    /^([a-záéíóúñ\s]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = t.match(pattern);
    if (match) {
      const candidate = normalize(match[1]);
      for (const ciudad of CIUDADES_PARAGUAY) {
        if (normalize(ciudad).includes(candidate) || candidate.includes(normalize(ciudad))) {
          return ciudad;
        }
      }
      // Si es una palabra corta y parece ciudad
      if (candidate.length > 2 && candidate.length < 30 && !candidate.includes(" ")) {
        for (const ciudad of CIUDADES_PARAGUAY) {
          if (normalize(ciudad).includes(candidate)) {
            return ciudad;
          }
        }
      }
    }
  }
  return null;
}

function getTipoCobertura(city: string): string {
  const ciudadesConCobertura = [
    "asuncion", "asunción", "fernando de la mora", "san lorenzo", 
    "lambaré", "luque", "capiatá", "limpio", "Ñemby", "villa elisa"
  ];
  const cityNorm = normalize(city);
  const tieneCobertura = ciudadesConCobertura.some(c => normalize(c) === cityNorm);
  return tieneCobertura ? "envio_propio" : "envio_compartido";
}

// ═══════════════════════════════════════════════════════════
// BUILDERS DE RESPUESTAS
// ═══════════════════════════════════════════════════════════

function buildCityQuestionResponse(product: string): string {
  return `✅ Producto: ${product}\n\n📍 ¿A qué ciudad querés recibir tu pedido?\n\n📝 Ejemplos:\n• Asunción\n• San Lorenzo\n• Fernando de la Mora\n• Lambaré`;
}

function buildQuantityAfterCityResponse(product: string, city: string, fullTraining: any): string {
  const cobertura = getTipoCobertura(city);
  let coberturaText = "";
  
  if (cobertura === "envio_propio") {
    coberturaText = "✅ ¡Genial! Tenemos delivery propio en tu zona. El costo es de 15.000 Gs.";
  } else {
    coberturaText = "📦 Para tu ciudad, coordinamos con servicio de encomienda. El costo de envío se confirma al momento.";
  }
  
  // Buscar precio del producto en fullTraining
  let precioText = "";
  if (fullTraining?.products) {
    const productNorm = normalize(product);
    const found = fullTraining.products.find((p: any) => 
      normalize(p.name).includes(productNorm) || productNorm.includes(normalize(p.name))
    );
    if (found && found.price) {
      precioText = `💰 Precio: ${found.price.toLocaleString()} Gs\n`;
    }
  }
  
  return `📍 Ciudad: ${city}\n${precioText}${coberturaText}\n\n🔢 ¿Cuántas unidades querés llevar?\n\n📝 Ejemplo: "Quiero 2" o "2 unidades"`;
}

function buildOrderSummary(order: any, totalAmount: number): string {
  const items = order.items || [{ name: order.product, qty: order.quantity || 1 }];
  const itemsList = items.map((i: any) => `• ${i.name} x${i.qty}`).join("\n");
  
  return `✅ *PEDIDO CONFIRMADO*\n\n📦 *Producto:*\n${itemsList}\n\n👤 *Cliente:* ${order.customer_name || "—"}\n📍 *Ubicación:* ${order.city || "—"} — ${order.address || "—"}\n📞 *Contacto:* ${order.phone || "—"}\n🔢 *Cantidad total:* ${items.reduce((s: number, i: any) => s + i.qty, 0)}\n💰 *Total:* ${totalAmount.toLocaleString()} Gs\n\n✅ ¿Todo correcto? Envíanos el comprobante de pago para confirmar tu pedido.`;
}

// ═══════════════════════════════════════════════════════════
// DETECCIÓN DE PRODUCTO ACTIVO
// ═══════════════════════════════════════════════════════════

function getCurrentActiveProduct(context: any): string | null {
  if (!context) return null;
  return context.current_product || context.last_user_product || null;
}

// ═══════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      user_id,
      message,
      from_number,
      context: oldContext = {},
      history = [],
      media_url,
      media_type,
      mime_type,
    } = req.body;

    const texto = clean(message || "");
    const previousStep = oldContext?.step || null;
    const currentActiveProduct = getCurrentActiveProduct(oldContext);
    const oldOrder = oldContext?.order_data || {};

    // ═══════════════════════════════════════════════════════════
    // A. "quiero 1" con producto activo → directo a cantidad
    // ═══════════════════════════════════════════════════════════
    const qFromBuy = texto.match(/^\s*(quiero|llevo|dame|mandame|compro)\s+(\d{1,3})\s*$/i);
    
    if (qFromBuy && currentActiveProduct) {
      const cantidad = Number(qFromBuy[2]);
      const order = {
        ...oldOrder,
        product: currentActiveProduct,
        quantity: cantidad,
      };

      // Si falta ciudad, preguntar ciudad
      if (!order.city) {
        console.log(`🛍️ "quiero ${cantidad}" con producto "${currentActiveProduct}" → falta ciudad`);
        return res.status(200).json({
          response: buildCityQuestionResponse(currentActiveProduct),
          context: {
            ...oldContext,
            step: "collecting_city",
            current_product: currentActiveProduct,
            last_user_product: currentActiveProduct,
            last_topic: currentActiveProduct,
            order_data: order,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }

      // Si tiene ciudad, mostrar resumen del pedido
      console.log(`🛍️ "quiero ${cantidad}" con producto "${currentActiveProduct}" → mostrar resumen`);
      
      // Buscar precio del producto
      let totalAmount = 0;
      // TODO: Obtener precio real del producto desde DB o training
      totalAmount = 50000 * cantidad; // Placeholder
      
      const response = buildOrderSummary({ ...order, city: order.city, quantity: cantidad }, totalAmount);
      
      return res.status(200).json({
        response,
        context: {
          ...oldContext,
          step: "awaiting_payment",
          current_product: currentActiveProduct,
          order_data: { ...order, quantity: cantidad, items: [{ name: currentActiveProduct, qty: cantidad }] },
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    // ═══════════════════════════════════════════════════════════
    // B. Esperando ciudad → extraer ciudad y avanzar
    // ═══════════════════════════════════════════════════════════
    if (previousStep === "collecting_city") {
      const city = extractCityFromText(texto);
      
      if (city && currentActiveProduct) {
        console.log(`📍 Ciudad detectada: "${city}" para producto "${currentActiveProduct}"`);
        
        const order = {
          ...oldOrder,
          product: currentActiveProduct,
          city,
          quantity: oldOrder?.quantity || 0,
        };
        
        // Obtener fullTraining para precios
        const { data: training } = await supabase
          .from("whatsapp_config")
          .select("full_training")
          .eq("user_id", user_id)
          .maybeSingle();
        
        const fullTraining = training?.full_training || null;
        
        return res.status(200).json({
          response: buildQuantityAfterCityResponse(currentActiveProduct, city, fullTraining),
          context: {
            ...oldContext,
            step: "collecting_quantity",
            current_product: currentActiveProduct,
            last_user_product: currentActiveProduct,
            last_topic: currentActiveProduct,
            tipo_cobertura: getTipoCobertura(city),
            order_data: order,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
      
      // Si no se detectó ciudad, seguir preguntando
      console.log(`📍 No se detectó ciudad en: "${texto}"`);
      return res.status(200).json({
        response: `📍 No entendí la ciudad. ¿Podés decirme en qué ciudad querés recibir tu pedido?\n\n📝 Ejemplos: Asunción, San Lorenzo, Fernando de la Mora, Lambaré`,
        context: {
          ...oldContext,
          step: "collecting_city",
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    // ═══════════════════════════════════════════════════════════
    // C. Detectar producto si no hay producto activo
    // ═══════════════════════════════════════════════════════════
    let detectedProduct = null;
    let newStep = previousStep;
    let newOrderData = oldOrder;

    if (!currentActiveProduct) {
      // Buscar en productos del training
      const { data: training } = await supabase
        .from("whatsapp_config")
        .select("full_training")
        .eq("user_id", user_id)
        .maybeSingle();
      
      const fullTraining = training?.full_training || null;
      
      if (fullTraining?.products) {
        const textoNorm = normalize(texto);
        for (const product of fullTraining.products) {
          const productNameNorm = normalize(product.name);
          // Buscar coincidencia exacta o por palabras clave
          if (textoNorm.includes(productNameNorm) || 
              product.keywords?.some((k: string) => textoNorm.includes(normalize(k)))) {
            detectedProduct = product.name;
            newStep = "product_selected";
            newOrderData = { ...oldOrder, product: detectedProduct };
            break;
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Si hay media (imagen/audio) o mensaje normal, llamar a Gemini
    // ═══════════════════════════════════════════════════════════
    let iaResponse = null;
    let iaContext = null;
    let isPaymentProof = false;

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      // Construir prompt con contexto
      let prompt = "";
      
      if (media_type === "image" && media_url) {
        // Imagen: posible comprobante
        prompt = `El usuario envió una imagen. Analizala y determiná si es un comprobante de pago (captura de transferencia, voucher, etc.).
        
Si es un comprobante, respondé: "✅ ¡Gracias! Tu comprobante ha sido recibido. En breve confirmaremos tu pedido."

Si NO es un comprobante, describí la imagen brevemente y preguntá si necesita ayuda con algo.

Contexto actual:
- Producto activo: ${currentActiveProduct || "ninguno"}
- Paso: ${previousStep || "inicial"}
- Historial reciente: ${JSON.stringify(history.slice(-4))}

Mensaje del usuario: ${texto || "[imagen]"}`;
      } else if (media_type === "audio" && media_url) {
        // Audio: transcrito por el webhook
        prompt = `El usuario envió un audio que fue transcrito como: "${texto}"

Respondé de manera natural y amable, como un vendedor de productos.

Contexto actual:
- Producto activo: ${currentActiveProduct || "ninguno"}
- Paso: ${previousStep || "inicial"}
- Datos de pedido: ${JSON.stringify(oldOrder)}

Mensaje del usuario: ${texto}`;
      } else {
        // Texto normal
        const stepContext = previousStep === "collecting_quantity" 
          ? "El usuario está definiendo la cantidad del producto. Preguntale cuántas unidades quiere."
          : previousStep === "collecting_city"
          ? "El usuario está dando su ciudad. Extraé la ciudad de su mensaje si es posible."
          : previousStep === "awaiting_payment"
          ? "El usuario está en etapa de pago. Si confirma, dale los datos bancarios."
          : "El usuario está consultando productos o haciendo una pregunta general.";
        
        prompt = `Sos un asistente de ventas de productos. Respondé de manera amable, breve y útil.

${stepContext}

Producto actual seleccionado: ${currentActiveProduct || "ninguno"}
Paso actual: ${previousStep || "inicial"}
Datos de pedido: ${JSON.stringify(oldOrder)}

Historial de conversación (últimos 4 mensajes):
${history.slice(-4).map((h: any) => `${h.role}: ${h.content}`).join("\n")}

Mensaje del usuario: ${texto}

Respondé en español, sin usar markdown complejo. Si el usuario pregunta por precios, dale los precios aproximados. Si pide catálogo, decile que revise el enlace.`;
      }
      
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      iaResponse = clean(responseText);
      
      // Detectar si es comprobante
      if (media_type === "image" && iaResponse.toLowerCase().includes("comprobante")) {
        isPaymentProof = true;
      }
      
      // Actualizar contexto según respuesta
      iaContext = {
        ...oldContext,
        updated_at: new Date().toISOString(),
      };
      
      if (detectedProduct) {
        iaContext.current_product = detectedProduct;
        iaContext.last_user_product = detectedProduct;
        iaContext.last_topic = detectedProduct;
        iaContext.step = newStep;
        iaContext.order_data = newOrderData;
      }
      
    } catch (err) {
      console.error("❌ Error en Gemini:", err);
      iaResponse = "Lo siento, tuve un problema técnico. ¿Podés repetirme tu mensaje?";
    }

    // Si no hay respuesta de Gemini, usar fallback
    if (!iaResponse) {
      iaResponse = "¡Hola! ¿En qué puedo ayudarte hoy? 😊";
    }

    return res.status(200).json({
      response: iaResponse,
      context: iaContext || {
        ...oldContext,
        updated_at: new Date().toISOString(),
      },
      is_payment_proof: isPaymentProof,
    });

  } catch (error: any) {
    console.error("❌ chat-ia error:", error);
    return res.status(500).json({
      error: error.message || "Error interno",
      response: "Lo siento, hubo un error procesando tu mensaje. Por favor intentá de nuevo.",
    });
  }
}
