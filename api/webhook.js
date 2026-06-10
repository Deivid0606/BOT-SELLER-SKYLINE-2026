// api/chat-ia.ts
// Chat IA con Gemini - Soporta texto, imágenes y audio
// + Detección de comprobantes de pago
// + Contexto de conversación
// + Historial de mensajes

import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { NextApiRequest, NextApiResponse } from "next";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Configuración del modelo
const MODEL_NAME = "gemini-1.5-flash";

// Tipos
interface ChatContext {
  last_topic?: string;
  last_trigger?: string;
  current_product?: string;
  step?: string;
  order_data?: Record<string, any>;
}

interface ChatHistory {
  role: "user" | "assistant";
  content: string;
}

interface PaymentProofDetection {
  is_payment_proof: boolean;
  confidence: number;
  extracted_amount?: number;
  extracted_date?: string;
  bank_name?: string;
}

// Función para limpiar texto
const clean = (t: string | null | undefined): string => {
  return String(t || "").trim();
};

// Función para normalizar texto (minúsculas + sin acentos)
const normalize = (t: string): string => {
  return clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
};

// Función para detectar comprobante de pago en imagen
async function detectPaymentProof(
  imageBase64: string,
  mimeType: string
): Promise<PaymentProofDetection> {
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    
    const prompt = `Analiza esta imagen y determina si es un comprobante de transferencia bancaria o pago.
    
Responde SOLO con un JSON en este formato:
{
  "is_payment_proof": true/false,
  "confidence": 0-100,
  "extracted_amount": null o número,
  "extracted_date": null o fecha en formato YYYY-MM-DD,
  "bank_name": null o nombre del banco
}

Características de un comprobante:
- Tiene datos bancarios (titular, cuenta, banco)
- Tiene un monto
- Tiene fecha/hora
- Tiene número de operación o transacción
- Puede tener estado "aprobado", "completado", "éxito"

Si NO es un comprobante, responde con is_payment_proof: false`;

    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: mimeType,
      },
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response.text();
    
    // Extraer JSON de la respuesta
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        is_payment_proof: parsed.is_payment_proof || false,
        confidence: parsed.confidence || 0,
        extracted_amount: parsed.extracted_amount || null,
        extracted_date: parsed.extracted_date || null,
        bank_name: parsed.bank_name || null,
      };
    }
    
    return { is_payment_proof: false, confidence: 0 };
  } catch (error) {
    console.error("❌ Error detectando comprobante:", error);
    return { is_payment_proof: false, confidence: 0 };
  }
}

// Función para transcribir audio
async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    
    const prompt = `Transcribe el siguiente audio de WhatsApp. 
    - Si es en español, transcribe exactamente lo que dice.
    - Si es una mezcla de idiomas, transcribe en el idioma original.
    - Incluye puntuación básica.
    - Si no se entiende, responde "No se pudo transcribir el audio".`;

    const audioPart = {
      inlineData: {
        data: audioBase64,
        mimeType: mimeType,
      },
    };

    const result = await model.generateContent([prompt, audioPart]);
    return result.response.text().trim();
  } catch (error) {
    console.error("❌ Error transcribiendo audio:", error);
    return "No se pudo transcribir el audio.";
  }
}

// Función para construir el prompt del sistema
function buildSystemPrompt(context: ChatContext, hasImage: boolean = false, hasAudio: boolean = false): string {
  const basePrompt = `Eres un asistente virtual de atención al cliente para "Mega Todo Store", una tienda que vende productos por catálogo en WhatsApp.

INFORMACIÓN DE LA TIENDA:
- Nombre: Mega Todo Store
- Catálogo: https://cat-logomegatodo-com.vercel.app/
- Métodos de pago: Efectivo o transferencia bancaria al recibir el producto
- Envíos: GRATIS a toda Asunción y Gran Asunción
- Horario de atención: Lunes a Domingo de 8:00 a 20:00

REGLAS IMPORTANTES:
1. Sé amable, profesional y servicial. Usa emojis ocasionalmente.
2. Responde en español, en el mismo idioma que el cliente.
3. Si el cliente pregunta por productos, indica que revise el catálogo: https://cat-logomegatodo-com.vercel.app/
4. Para confirmar un pedido, necesitas: nombre, dirección, contacto, producto y cantidad.
5. NO inventes información que no tengas.
6. Si el cliente envía un comprobante de pago, confírmalo y actualiza el estado del pedido.
7. Si el cliente quiere reagendar la entrega, toma nota de la nueva fecha.
8. Si el cliente no está en su domicilio, ofrece enviar a otra dirección.

PROCESO DE COMPRA:
1. Cliente selecciona productos del catálogo
2. Cliente proporciona dirección de entrega
3. Confirmar pedido con todos los datos
4. Cliente recibe confirmación con total y método de pago
5. Delivery envía el producto y cobra`;

  if (context.current_product) {
    return basePrompt + `\n\nCONTEXTO ACTUAL: El cliente está interesado en: ${context.current_product}`;
  }
  
  if (context.step === "confirming_order") {
    return basePrompt + `\n\nCONTEXTO ACTUAL: Estás en el proceso de confirmar un pedido. Solicita los datos faltantes: nombre, dirección, contacto.`;
  }
  
  if (context.step === "rescheduling") {
    return basePrompt + `\n\nCONTEXTO ACTUAL: El cliente quiere reagendar su entrega. Pregunta nueva fecha y horario.`;
  }
  
  if (hasImage) {
    return basePrompt + `\n\nCONTEXTO ACTUAL: El cliente acaba de enviar una imagen. Si es un comprobante de pago, confírmalo. Si no, responde normalmente.`;
  }
  
  if (hasAudio) {
    return basePrompt + `\n\nCONTEXTO ACTUAL: El cliente envió un mensaje de voz. Ya fue transcrito, responde basándote en la transcripción.`;
  }
  
  return basePrompt;
}

// Función para generar respuesta con Gemini
async function generateResponse(
  message: string,
  history: ChatHistory[],
  context: ChatContext,
  imageBase64?: string,
  imageMimeType?: string,
  transcribedAudio?: string
): Promise<{ response: string; context: ChatContext; is_payment_proof?: boolean }> {
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    
    // Detectar comprobante si hay imagen
    let isPaymentProof = false;
    let paymentProofData: PaymentProofDetection | null = null;
    
    if (imageBase64) {
      paymentProofData = await detectPaymentProof(imageBase64, imageMimeType || "image/jpeg");
      isPaymentProof = paymentProofData.is_payment_proof;
      
      if (isPaymentProof && paymentProofData.confidence > 70) {
        console.log(`💳 Comprobante detectado con confianza ${paymentProofData.confidence}%`);
      }
    }
    
    // Usar transcripción si hay audio
    const finalMessage = transcribedAudio || message;
    
    // Construir el prompt del sistema
    const systemPrompt = buildSystemPrompt(context, !!imageBase64, !!transcribedAudio);
    
    // Construir el historial para Gemini
    const chatHistory = [];
    
    // Agregar prompt del sistema
    chatHistory.push({
      role: "user",
      parts: [{ text: systemPrompt }],
    });
    chatHistory.push({
      role: "model",
      parts: [{ text: "Entendido. Soy el asistente de Mega Todo Store. ¿En qué puedo ayudarte hoy?" }],
    });
    
    // Agregar historial de conversación (últimos 6 mensajes)
    const recentHistory = history.slice(-6);
    for (const msg of recentHistory) {
      chatHistory.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      });
    }
    
    // Preparar el contenido del mensaje actual
    const userContent: any[] = [];
    
    // Si hay imagen y es comprobante, agregar info
    if (isPaymentProof && paymentProofData) {
      userContent.push({
        text: `[COMPROBANTE DE PAGO DETECTADO]\nMonto: ${paymentProofData.extracted_amount || "No detectado"}\nBanco: ${paymentProofData.bank_name || "No detectado"}\nFecha: ${paymentProofData.extracted_date || "No detectada"}\n\nMensaje del cliente: ${finalMessage}`,
      });
    } else if (imageBase64) {
      // Agregar imagen para análisis
      userContent.push({
        inlineData: {
          data: imageBase64,
          mimeType: imageMimeType || "image/jpeg",
        },
      });
      userContent.push({ text: finalMessage || "El cliente envió esta imagen. ¿Qué contiene?" });
    } else {
      userContent.push({ text: finalMessage });
    }
    
    chatHistory.push({
      role: "user",
      parts: userContent,
    });
    
    // Generar respuesta
    const result = await model.generateContent({
      contents: chatHistory,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000,
        topP: 0.95,
      },
    });
    
    const response = result.response.text();
    
    // Actualizar contexto basado en la conversación
    const updatedContext = { ...context };
    const responseLower = normalize(response);
    const messageLower = normalize(finalMessage);
    
    // Detectar si se está confirmando un pedido
    if (responseLower.includes("pedido confirmado") || 
        (responseLower.includes("confirmado") && responseLower.includes("pedido"))) {
      updatedContext.step = "order_confirmed";
      updatedContext.last_topic = "order_confirmation";
    }
    
    // Detectar si se está pidiendo dirección
    if (responseLower.includes("dirección") || responseLower.includes("ubicación")) {
      updatedContext.step = "asking_address";
    }
    
    // Detectar si se está reagendando
    if (messageLower.includes("mañana") || messageLower.includes("otro día") || messageLower.includes("cambiar fecha")) {
      updatedContext.step = "rescheduling";
      updatedContext.last_topic = "reschedule";
    }
    
    // Guardar producto mencionado
    const productMatch = messageLower.match(/(?:producto|item|articulo)[:\s]*([^\n]+)/i);
    if (productMatch && !updatedContext.current_product) {
      updatedContext.current_product = clean(productMatch[1]);
    }
    
    return {
      response: response,
      context: updatedContext,
      is_payment_proof: isPaymentProof,
    };
  } catch (error) {
    console.error("❌ Error generando respuesta:", error);
    throw new Error("Error al generar respuesta con IA");
  }
}

// Función para obtener historial de Supabase
async function getChatHistory(userId: string, fromNumber: string): Promise<ChatHistory[]> {
  try {
    const { data, error } = await supabase
      .from("inbox_messages")
      .select("message, message_type, created_at")
      .eq("user_id", userId)
      .eq("sender_id", fromNumber)
      .order("created_at", { ascending: true })
      .limit(20);
    
    if (error) throw error;
    
    return (data || [])
      .map((msg) => ({
        role: (msg.message_type || "").startsWith("out_") ? "assistant" : "user",
        content: clean(msg.message),
      }))
      .filter((m) => m.content && m.content.length > 0);
  } catch (error) {
    console.error("❌ Error obteniendo historial:", error);
    return [];
  }
}

// Función para obtener contexto de Supabase
async function getChatContext(userId: string, fromNumber: string): Promise<ChatContext> {
  try {
    const { data, error } = await supabase
      .from("chat_context")
      .select("*")
      .eq("user_id", userId)
      .eq("from_number", fromNumber)
      .maybeSingle();
    
    if (error) throw error;
    
    return data || {};
  } catch (error) {
    console.error("❌ Error obteniendo contexto:", error);
    return {};
  }
}

// Función para guardar contexto
async function saveChatContext(userId: string, fromNumber: string, context: ChatContext): Promise<void> {
  try {
    const { error } = await supabase
      .from("chat_context")
      .upsert({
        user_id: userId,
        from_number: fromNumber,
        last_topic: context.last_topic || null,
        last_trigger: context.last_trigger || null,
        current_product: context.current_product || null,
        step: context.step || null,
        order_data: context.order_data || {},
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id,from_number",
      });
    
    if (error) throw error;
  } catch (error) {
    console.error("❌ Error guardando contexto:", error);
  }
}

// Handler principal
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Configurar CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  
  try {
    const {
      user_id,
      message,
      from_number,
      context: providedContext,
      history: providedHistory,
      media_url,
      media_type,
      mime_type,
    } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: "user_id es requerido" });
    }
    
    if (!message && !media_url) {
      return res.status(400).json({ error: "message o media_url es requerido" });
    }
    
    // Obtener contexto e historial si no fueron proporcionados
    let context = providedContext || await getChatContext(user_id, from_number || "unknown");
    let history = providedHistory || await getChatHistory(user_id, from_number || "unknown");
    
    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;
    let transcribedAudio: string | undefined;
    
    // Si hay media_url, descargar y convertir a base64
    if (media_url) {
      try {
        const response = await fetch(media_url);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        
        if (media_type === "image") {
          imageBase64 = base64;
          imageMimeType = mime_type || "image/jpeg";
          console.log(`🖼️ Imagen descargada: ${media_url.slice(0, 60)}...`);
        } else if (media_type === "audio") {
          // Transcribir audio
          const audioMimeType = mime_type || "audio/ogg";
          transcribedAudio = await transcribeAudio(base64, audioMimeType);
          console.log(`🎤 Audio transcrito: "${transcribedAudio}"`);
        }
      } catch (error) {
        console.error("❌ Error procesando media:", error);
      }
    }
    
    // Generar respuesta con IA
    const result = await generateResponse(
      message || "",
      history,
      context,
      imageBase64,
      imageMimeType,
      transcribedAudio
    );
    
    // Guardar contexto actualizado
    if (from_number) {
      await saveChatContext(user_id, from_number, result.context);
    }
    
    // Guardar mensaje del asistente en historial
    if (from_number && result.response) {
      try {
        await supabase.from("inbox_messages").insert({
          user_id: user_id,
          source: "whatsapp",
          platform: "whatsapp",
          sender_id: from_number,
          from_number: from_number,
          message: result.response,
          message_type: "out_text",
          is_read: true,
          is_processed: true,
        });
      } catch (error) {
        console.error("❌ Error guardando respuesta:", error);
      }
    }
    
    return res.status(200).json({
      response: result.response,
      context: result.context,
      is_payment_proof: result.is_payment_proof || false,
    });
  } catch (error) {
    console.error("❌ Error en chat-ia:", error);
    return res.status(500).json({ 
      error: "Error interno del servidor",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
