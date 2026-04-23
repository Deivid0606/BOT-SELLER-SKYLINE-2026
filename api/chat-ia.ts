import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);

type ChatRole = "system" | "user" | "assistant";

type IncomingHistoryItem = {
  role?: ChatRole;
  content?: string;
};

type IncomingContext = {
  last_topic?: string | null;
  last_trigger?: string | null;
  updated_at?: string | null;
};

type TrainingRow = {
  intent?: string | null;
  examples?: unknown;
  response?: string | null;
};

type IAConfigRow = {
  is_active?: boolean | null;
  api_key?: string | null;
  system_instruction?: string | null;
  model?: string | null;
  temperature?: number | null;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function sanitizeHistory(
  history: unknown
): Array<{ role: "user" | "assistant"; content: string }> {
  const items = safeArray<IncomingHistoryItem>(history);

  return items
    .map((item) => {
      const role = item?.role;
      const content = normalizeText(item?.content);

      if (!content) return null;
      if (role !== "user" && role !== "assistant") return null;

      return { role, content };
    })
    .filter(Boolean) as Array<{ role: "user" | "assistant"; content: string }>;
}

function buildTrainingContext(rows: TrainingRow[] = []): string {
  if (!rows.length) {
    return "No hay entrenamiento adicional cargado.";
  }

  return rows
    .map((row, index) => {
      const intent = normalizeText(row.intent) || `Intent ${index + 1}`;
      const response = normalizeText(row.response) || "Sin respuesta definida";
      const examples = safeArray<string>(row.examples)
        .map((ex) => normalizeText(ex))
        .filter(Boolean);

      return [
        `Intent: ${intent}`,
        examples.length ? `Ejemplos: ${examples.join(" | ")}` : null,
        `Respuesta ideal: ${response}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function buildMessages(params: {
  systemInstruction: string;
  trainingContext: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  currentMessage: string;
  context: IncomingContext | null;
}): Array<{ role: ChatRole; content: string }> {
  const { systemInstruction, trainingContext, history, currentMessage, context } =
    params;

  const contextBlock = [
    context?.last_topic ? `Producto o tema actual: ${context.last_topic}` : null,
    context?.last_trigger
      ? `Último disparador activado: ${context.last_trigger}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `
${systemInstruction || "Eres un asistente de ventas para una tienda online."}

REGLAS OBLIGATORIAS:
- Responde siempre en español.
- Mantén continuidad total con el historial del chat.
- Si el cliente viene hablando de un producto, NO cambies de producto ni reinicies la conversación.
- Si el cliente dice "quiero", "quiero comprar", "sí", "como hago", "cómo hago", "precio", "me interesa", "dame más info", asume que sigue hablando del último producto activo.
- Si existe CONTEXTO ACTUAL DEL CHAT, úsalo como prioridad.
- Si hubo disparador, continúa vendiendo ESE producto.
- No saludes de nuevo si la conversación ya está iniciada.
- No respondas genérico tipo "¿en qué producto estás interesado?" si ya hay contexto.
- Responde corto, claro y con intención de cierre.
- Si el cliente quiere comprar, guía el pedido de forma concreta.
- Pedí solo el siguiente dato necesario para avanzar.
- No inventes precios, stock ni beneficios que no estén en historial, entrenamiento o contexto.

OBJETIVO:
Cerrar la venta o avanzar la conversación comercial sin perder el hilo.

ENTRENAMIENTO DISPONIBLE:
${trainingContext}

CONTEXTO ACTUAL DEL CHAT:
${contextBlock || "Sin contexto guardado."}
  `.trim();

  const messages: Array<{ role: ChatRole; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  for (const item of history) {
    messages.push({
      role: item.role,
      content: item.content,
    });
  }

  messages.push({
    role: "user",
    content: currentMessage,
  });

  return messages;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
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
      history: incomingHistory,
      context: incomingContext,
    } = req.body ?? {};

    const cleanUserId = normalizeText(user_id);
    const cleanMessage = normalizeText(message);
    const cleanFromNumber = normalizeText(from_number);

    if (!cleanUserId || !cleanMessage) {
      return res.status(400).json({
        error: "Faltan user_id o message",
      });
    }

    console.log(
      "📨 Chat IA:",
      JSON.stringify({
        user_id: cleanUserId,
        from_number: cleanFromNumber,
        message: cleanMessage.slice(0, 80),
      })
    );

    const { data: iaConfig, error: iaError } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", cleanUserId)
      .single();

    if (iaError || !iaConfig) {
      console.error("❌ Error cargando configuración IA:", iaError);
      return res.status(400).json({
        error: "No hay configuración de IA. Ve a Ajustes → IA y guarda tu API Key.",
      });
    }

    const config = iaConfig as IAConfigRow;

    if (!config.is_active) {
      return res.status(400).json({
        error: "La IA está desactivada. Actívala en Ajustes → IA.",
      });
    }

    if (!normalizeText(config.api_key)) {
      return res.status(400).json({
        error: "No hay API Key configurada.",
      });
    }

    const sanitizedHistory = sanitizeHistory(incomingHistory);
    const context: IncomingContext | null =
      incomingContext && typeof incomingContext === "object"
        ? incomingContext
        : null;

    const { data: trainingData, error: trainingError } = await supabase
      .from("training_data")
      .select("intent, examples, response")
      .eq("user_id", cleanUserId)
      .eq("is_active", true);

    if (trainingError) {
      console.error("⚠️ Error cargando training_data:", trainingError);
    }

    const trainingContext = buildTrainingContext((trainingData || []) as TrainingRow[]);

    const systemInstruction =
      normalizeText(config.system_instruction) ||
      "Eres un asistente de ventas para una tienda online. Responde como vendedor profesional, amable, persuasivo y manteniendo el contexto.";

    const model = normalizeText(config.model) || "openai/gpt-3.5-turbo";
    const temperature =
      typeof config.temperature === "number" ? config.temperature : 0.4;

    const messages = buildMessages({
      systemInstruction,
      trainingContext,
      history: sanitizedHistory,
      currentMessage: cleanMessage,
      context,
    });

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: 350,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("❌ Error OpenRouter:", data);
      return res.status(500).json({
        error: data?.error?.message || "Error con OpenRouter",
      });
    }

    const botResponse = normalizeText(data?.choices?.[0]?.message?.content);

    if (!botResponse) {
      return res.status(500).json({
        error: "La IA no devolvió contenido.",
      });
    }

    console.log("✅ Respuesta IA generada:", botResponse.slice(0, 120));

    return res.status(200).json({
      response: botResponse,
    });
  } catch (error: any) {
    console.error("❌ Error en chat-ia:", error);
    return res.status(500).json({
      error: "Error interno: " + (error?.message || "desconocido"),
    });
  }
}
