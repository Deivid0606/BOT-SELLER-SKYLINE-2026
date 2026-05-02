// api/chat-ia.ts - VERSIÓN DEFINITIVA FUNCIONAL
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const CATALOG_URL = "https://cat-logomegatodo-com.vercel.app/";
const clean = (t: any): string => String(t || "").trim();

// ✅ GEMINI CORREGIDO - Usa la API correcta
async function callGemini(apiKey: string, prompt: string, systemPrompt?: string): Promise<string> {
  try {
    // Usar gemini-1.5-flash que es estable
    const model = "gemini-1.5-flash";
    
    const body: any = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ]
    };
    
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }
    
    // 🔥 IMPORTANTE: usar v1, NO v1beta
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();
    
    if (!response.ok) {
      console.error("❌ Gemini error:", JSON.stringify(data));
      return "Lo siento, tuve un error técnico. Por favor intenta de nuevo.";
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return clean(text);
  } catch (error) {
    console.error("❌ callGemini exception:", error);
    return "Lo siento, hubo un problema. Intenta nuevamente.";
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { user_id, message, from_number } = req.body;
    const texto = clean(message);
    const fromNumber = clean(from_number);

    console.log(`🧠 CHAT-IA: "${texto}" | from: ${fromNumber} | user: ${user_id}`);

    if (!user_id) {
      return res.status(400).json({ error: "Falta user_id" });
    }

    // Obtener configuración de IA
    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key) {
      return res.json({
        response: "⚠️ La IA no está configurada. Por favor configura tu API key de Gemini en Configuración → IA.",
      });
    }

    // Obtener entrenamiento
    const { data: trainingRow } = await supabase
      .from("training_data")
      .select("response")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fullTraining = clean(trainingRow?.response);
    
    // Si no hay entrenamiento, usar respuesta por defecto
    let systemPrompt = "";
    if (fullTraining) {
      systemPrompt = `Eres el asistente de ventas de Mega Todo Store. Sigue EXACTAMENTE este entrenamiento:\n${fullTraining}\n\nRespondé en español paraguayo, con emojis, siendo amable y profesional.`;
    } else {
      systemPrompt = `Eres el asistente de ventas de Mega Todo Store. Tu catálogo está en: ${CATALOG_URL}. Respondé preguntas sobre precios, productos y pedidos. Sé amable y profesional.`;
    }

    // Generar respuesta
    const response = await callGemini(iaConfig.api_key, texto, systemPrompt);

    return res.json({
      response: response || `📋 Te invito a revisar nuestro catálogo:\n${CATALOG_URL}`,
      context: { last_topic: "general", updated_at: new Date().toISOString() },
    });
  } catch (error: any) {
    console.error("❌ chat-ia error:", error);
    return res.status(500).json({ error: error.message || "Error interno" });
  }
}
