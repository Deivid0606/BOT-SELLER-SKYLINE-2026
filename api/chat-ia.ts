// api/chat-ia.ts - VERSIÓN CORREGIDA
// ✅ Respuesta corta para "hola"
// ✅ Cada usuario tiene su propio entrenamiento
// ✅ No se envía todo el entrenamiento en el saludo

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

// ═══════════════════════════════════════════════════════════
// EXTRACCIÓN DE PRODUCTOS DEL ENTRENAMIENTO
// ═══════════════════════════════════════════════════════════

function extractProductList(training: string): string {
  const lines = training.split("\n");
  let inProductSection = false;
  const products: string[] = [];
  let lastProduct = "";
  
  for (const line of lines) {
    const cleanLine = line.trim();
    
    if (cleanLine.includes("CATALOGO_PRODUCTOS") || cleanLine.includes("CATÁLOGO DE PRODUCTOS")) {
      inProductSection = true;
      continue;
    }
    
    if (cleanLine.includes("FIN_CATALOGO_PRODUCTOS") || cleanLine.includes("FIN_CATÁLOGO")) {
      break;
    }
    
    if (inProductSection && cleanLine) {
      if (cleanLine.startsWith("PRODUCTO:")) {
        lastProduct = cleanLine.replace(/^PRODUCTO:\s*/, "").trim();
      }
      
      if (lastProduct && (cleanLine.includes("PRECIO_1:") || cleanLine.includes("PRECIO_2:"))) {
        const priceMatch = cleanLine.match(/\d+/);
        if (priceMatch) {
          const price = parseInt(priceMatch[0]).toLocaleString('es-ES');
          products.push(`• ${lastProduct} — 💰 ${price} Gs`);
          lastProduct = "";
        }
      }
      
      if (lastProduct && cleanLine.includes("Gs") && !cleanLine.includes("PRECIO")) {
        const priceMatch = cleanLine.match(/[\d.,]+/);
        if (priceMatch) {
          products.push(`• ${lastProduct} — 💰 ${priceMatch[0]} Gs`);
          lastProduct = "";
        }
      }
    }
  }
  
  // Fallback: buscar productos en todo el texto
  if (products.length === 0) {
    for (const line of lines) {
      const cleanLine = line.trim();
      if (cleanLine.includes("⭐") || cleanLine.includes("PRODUCTO:")) {
        const product = cleanLine
          .replace(/^PRODUCTO:\s*/, "")
          .replace(/^⭐\s*/, "")
          .replace(/[💙🦶🎯💰🔥✨]/g, "")
          .trim();
        if (product && product.length > 2 && product.length < 50) {
          products.push(`• ${product}`);
        }
      }
    }
  }
  
  return products.slice(0, 8).join("\n") || "• Consultá nuestro catálogo completo";
}

// ═══════════════════════════════════════════════════════════
// OBTENER TODOS LOS ENTRENAMIENTOS DEL USUARIO
// ═══════════════════════════════════════════════════════════

async function getAllTrainingData(userId: string) {
  try {
    const { data, error } = await supabase
      .from("training_data")
      .select("id, intent, examples, response, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Error obteniendo training_data:", error);
      return [];
    }

    console.log(`📚 Entrenamientos cargados: ${data?.length || 0} para usuario ${userId}`);
    return data || [];
  } catch (err) {
    console.error("❌ getAllTrainingData error:", err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// BUSCAR COINCIDENCIA EN ENTRENAMIENTOS POR FRASE
// ═══════════════════════════════════════════════════════════

function findMatchingTraining(trainingItems: any[], message: string) {
  if (!trainingItems || trainingItems.length === 0) return null;
  
  const msg = normalize(message);
  
  for (const item of trainingItems) {
    if (!item.examples || !Array.isArray(item.examples)) continue;
    
    for (const example of item.examples) {
      const ex = normalize(example);
      if (!ex) continue;
      
      if (msg.includes(ex) || ex.includes(msg) || 
          msg.includes(ex.substring(0, 10)) ||
          ex.includes(msg.substring(0, 10))) {
        console.log(`🎯 Match de entrenamiento: "${item.intent}" → "${example}"`);
        return {
          intent: item.intent,
          response: item.response,
          matched_example: example,
          all_examples: item.examples
        };
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// CONSTRUIR CONTEXTO DE ENTRENAMIENTO PARA GEMINI
// ═══════════════════════════════════════════════════════════

function buildTrainingContext(trainingItems: any[], maxLength: number = 4000) {
  if (!trainingItems || trainingItems.length === 0) {
    return "";
  }

  let context = "\n\n## 📚 ENTRENAMIENTO DEL NEGOCIO:\n";
  
  for (const item of trainingItems) {
    const shortResponse = item.response.substring(0, 500) + "...";
    const examplesList = item.examples?.map((ex: string) => `  • "${ex}"`).join("\n") || "(sin frases de ejemplo)";
    
    context += `### ${item.intent}\n`;
    context += `**Respuesta (resumen):** ${shortResponse}\n`;
    context += `**Frases clave:**\n${examplesList}\n\n`;
    
    if (context.length > maxLength) {
      context += "... (entrenamiento completo disponible si es necesario)\n";
      break;
    }
  }

  return context;
}

// ═══════════════════════════════════════════════════════════
// EL RESTO DEL CÓDIGO (getPriceLines, extractProductNameFromLine, etc.)
// ═══════════════════════════════════════════════════════════

// [Mantén todas las funciones existentes: getPriceLines, extractProductNameFromLine, 
// detectProduct, isPriceIntent, isBuyIntent, extractData, mergeOrderData, 
// PRODUCT_PRICES, calculateCorrectTotal, getUnitPrice, fixQuantityAndTotal, 
// injectCorrectTotal, nextStep, safeUpsertOrder, fetchMediaAsBase64, 
// callGemini, analyzeImageWithGemini, transcribeAudioWithGemini]

// ═══════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════

export default async function handler(req: any, res: any) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

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

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber)
      return res.status(400).json({ error: "Falta from_number" });
    if (!texto && !mediaUrl)
      return res.status(400).json({ error: "Faltan message o media" });

    // ─── 1. OBTENER CONFIGURACIÓN IA ───
    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key)
      return res.json({
        response: "⚠️ La IA no está configurada o desactivada.",
      });

    // ─── 2. OBTENER TODOS LOS ENTRENAMIENTOS DEL USUARIO ───
    const allTraining = await getAllTrainingData(user_id);

    // ─── 3. BUSCAR COINCIDENCIA DIRECTA EN ENTRENAMIENTOS ───
    let trainingMatch = null;
    if (texto && allTraining.length > 0) {
      trainingMatch = findMatchingTraining(allTraining, texto);
      if (trainingMatch) {
        console.log(`🎯 Match directo: "${trainingMatch.intent}"`);
        
        // ✅ Si es un saludo simple, responder con mensaje corto
        const msg = normalize(texto);
        if (msg === "hola" || msg === "buen día" || msg === "buenas" || msg === "holi" || 
            msg === "buenas tardes" || msg === "buenas noches") {
          
          const productList = extractProductList(trainingMatch.response);
          
          const shortResponse = `👋 ¡Hola! Bienvenido a Mega Todo Store. 😊

📦 **Productos disponibles:**
${productList}

💬 Preguntame por cualquier producto y te doy más información.

📍 ¿Qué te gustaría saber? 😊`;
          
          return res.json({
            response: shortResponse,
            context: {
              ...(context || {}),
              last_topic: "saludo",
              matched_training: true,
              updated_at: new Date().toISOString(),
            },
            matched_training: true,
            intent: trainingMatch.intent,
          });
        }
        
        // ✅ Para otros mensajes, devolver versión resumida
        const shortResponse = trainingMatch.response.length > 500 
          ? trainingMatch.response.substring(0, 500) + "...\n\n📋 Para más información, preguntame por un producto específico."
          : trainingMatch.response;
        
        return res.json({
          response: shortResponse,
          context: {
            ...(context || {}),
            last_topic: trainingMatch.intent,
            matched_training: true,
            updated_at: new Date().toISOString(),
          },
          matched_training: true,
          intent: trainingMatch.intent,
        });
      }
    }

    // ─── 4. CONSTRUIR CONTEXTO DE ENTRENAMIENTO PARA GEMINI ───
    const trainingContext = buildTrainingContext(allTraining);
    
    const combinedTraining = allTraining
      .map(t => `${t.intent}\n${t.response}`)
      .join("\n---\n");

    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    let isPaymentProof = false;
    let imageNote = "";

    // ─── IMAGEN ───
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
          productList: combinedTraining,
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
        } else if (analysis.kind === "product") {
          imageNote = `[el cliente envió una FOTO. Descripción: ${analysis.transcript}]`;
          texto = texto
            ? `${texto}\n${imageNote}`
            : `Mandé una foto. ${analysis.transcript}`;
        } else {
          imageNote = `[el cliente envió una imagen: ${analysis.transcript}]`;
          texto = texto || `Te mandé una imagen. ${analysis.transcript}`;
        }
      } else {
        texto = texto || "Te mandé una imagen pero no pudiste descargarla.";
      }
    }

    // ─── AUDIO ───
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

    // ─── FLUJO DE VENTA NORMAL ───
    const oldOrder = context?.order_data || {};
    const product = detectProduct(
      texto,
      combinedTraining,
      context?.current_product || oldOrder?.product
    );

    const extracted = extractData(texto);
    const orderData = mergeOrderData(oldOrder, extracted, product);
    
    const wantsToBuy = isBuyIntent(texto);
    const asksPrice = isPriceIntent(texto);
    
    let step = nextStep(orderData);
    
    if (wantsToBuy && orderData.product && !orderData.city) {
      step = "collecting_city";
      console.log("📍 Forzando pregunta de ciudad");
    }
    
    if (orderData.product && !orderData.city && (wantsToBuy || texto.includes("quiero") || texto.includes("compro"))) {
      step = "collecting_city";
      console.log("📍 Forzando pregunta de ciudad (cliente dijo quiero)");
    }
    
    const cityDetectionPatterns = [
      { pattern: /asuncion\s+es/i, city: "Asunción" },
      { pattern: /san\s+lorenzo\s+es/i, city: "San Lorenzo" },
      { pattern: /luque\s+es/i, city: "Luque" },
      { pattern: /capiat[áa]\s+es/i, city: "Capiatá" },
      { pattern: /^ita$/i, city: "Itá" },
      { pattern: /^asuncion$/i, city: "Asunción" },
      { pattern: /^luque$/i, city: "Luque" },
    ];
    
    for (const { pattern, city: detectedCity } of cityDetectionPatterns) {
      if (pattern.test(texto.trim()) && !orderData.city) {
        orderData.city = detectedCity;
        step = nextStep(orderData);
        console.log(`📍 Ciudad detectada automáticamente: ${detectedCity}`);
        break;
      }
    }
    
    const hasOrderData =
      !!extracted.quantity ||
      !!extracted.city ||
      !!extracted.name ||
      !!extracted.phone ||
      !!extracted.address;

    const shouldCollect =
      !!orderData.product &&
      (wantsToBuy || hasOrderData || context?.step?.startsWith("collecting") || step === "collecting_city");

    const isConfirming = step === "confirm_order" && wantsToBuy;

    if (shouldCollect) {
      await safeUpsertOrder(user_id, fromNumber, orderData, isConfirming);
    }

    console.log("📊 Cantidad extraída:", orderData.quantity);
    console.log("📍 Paso actual:", step);
    console.log("📍 Ciudad:", orderData.city);
    console.log("📍 Producto:", orderData.product);

    // ─── CONSTRUIR SYSTEM CON TODOS LOS ENTRENAMIENTOS ───
    const system = `
Sos el asistente de ventas de Mega Todo Store. Respondé SIEMPRE siguiendo el entrenamiento al pie de la letra.

═══════════════════════════════════
ENTRENAMIENTOS DEL NEGOCIO (FUENTE DE VERDAD):
═══════════════════════════════════
${trainingContext || "No hay entrenamiento específico."}
═══════════════════════════════════

REGLAS IMPORTANTES:
1. Usá EXACTAMENTE las respuestas del entrenamiento cuando el cliente pregunte sobre esos temas.
2. NO inventes precios ni datos que no estén en el entrenamiento.
3. Si el cliente pregunta algo que NO está en el entrenamiento, usá tu conocimiento general.
4. Usá tono amable, profesional, con emojis, en español paraguayo.
5. Si es un comprobante de pago, confirmá recepción y que estás procesando el pedido.
6. Usá el catálogo: ${CATALOG_URL}

ESTADO ACTUAL DEL CLIENTE:
- Producto: ${orderData.product || "ninguno"}
- Cantidad: ${orderData.quantity || 1}
- Ciudad: ${orderData.city || "pendiente"}
- Nombre: ${orderData.customer_name || "pendiente"}
- Teléfono: ${orderData.phone || "pendiente"}
- Dirección: ${orderData.address || "pendiente"}
- Paso: ${step}
- Intención: ${wantsToBuy ? "QUIERE COMPRAR" : asksPrice ? "PREGUNTA PRECIO" : "CONSULTA"}

⚠️ MUY IMPORTANTE:
- Si el cliente quiere comprar y falta ciudad → preguntá "📍 ¿Para qué ciudad sería el envío?"
- Si todos los datos están completos → usá la plantilla de confirmación ✅
`.trim();

    const contents = (history || [])
      .slice(-12)
      .filter((h: any) => clean(h?.content))
      .map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: clean(h.content) }],
      }));

    contents.push({ role: "user", parts: [{ text: texto }] });

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

    // ─── CORRECCIÓN FORZADA DE CANTIDAD Y TOTAL ───
    response = fixQuantityAndTotal(response, orderData.quantity, orderData.product);
    response = injectCorrectTotal(response, orderData.product, orderData.quantity);
    console.log("📝 Respuesta después de corrección:", response.substring(0, 300));

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
    return res.status(500).json({ error: error.message || "Error interno" });
  }
}
