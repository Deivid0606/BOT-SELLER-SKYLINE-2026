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

function limitText(value: unknown, max = 220): string {
  const text = normalizeText(value);
  return text.length > max ? text.slice(0, max) : text;
}

function sanitizeHistory(
  history: unknown
): Array<{ role: "user" | "assistant"; content: string }> {
  const items = safeArray<IncomingHistoryItem>(history);

  return items
    .map((item) => {
      const role = item?.role;
      const content = limitText(item?.content, 180);

      if (!content) return null;
      if (role !== "user" && role !== "assistant") return null;

      return { role, content };
    })
    .filter(Boolean) as Array<{ role: "user" | "assistant"; content: string }>;
}

function buildTrainingContext(rows: TrainingRow[] = []): string {
  if (!rows.length) return "";

  return rows
    .slice(0, 2)
    .map((row, index) => {
      const intent = limitText(row.intent, 60) || `Intent ${index + 1}`;
      const response = limitText(row.response, 160) || "";
      const examples = safeArray<string>(row.examples)
        .map((ex) => limitText(ex, 60))
        .filter(Boolean)
        .slice(0, 1);

      return [
        `Intent: ${intent}`,
        examples.length ? `Ejemplo: ${examples[0]}` : null,
        response ? `Respuesta: ${response}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function buildMessages(params: {
  trainingContext: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  currentMessage: string;
  context: IncomingContext | null;
}): Array<{ role: ChatRole; content: string }> {
  const { trainingContext, history, currentMessage, context } = params;

  const systemLines = [
    "Eres un asistente de ventas.",
    "Responde en español.",
    "Sé breve, claro y útil.",
    "Mantén el contexto.",
    "No cambies de producto si ya hay uno en conversación.",
    context?.last_topic ? `Tema actual: ${limitText(context.last_topic, 120)}` : "",
    context?.last_trigger ? `Disparador: ${limitText(context.last_trigger, 80)}` : "",
    trainingContext ? `Entrenamiento:\n${trainingContext}` : "",
  ].filter(Boolean);

  const messages: Array<{ role: ChatRole; content: string }> = [
    { role: "system", content: systemLines.join("\n") },
  ];

  for (const item of history.slice(-3)) {
    messages.push({
      role: item.role,
      content: limitText(item.content, 160),
    });
  }

  messages.push({
    role: "user",
    content: limitText(currentMessage, 220),
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

    const sanitizedHistory = sanitizeHistory(incomingHistory).slice(-3);

    const context: IncomingContext | null =
      incomingContext && typeof incomingContext === "object"
        ? incomingContext
        : null;

    const { data: trainingData, error: trainingError } = await supabase
      .from("training_data")
      .select("intent, examples, response")
      .eq("user_id", cleanUserId)
      .eq("is_active", true)
      .limit(2);

    if (trainingError) {
      console.error("⚠️ Error cargando training_data:", trainingError);
    }

    const trainingContext = buildTrainingContext(
      ((trainingData || []).slice(0, 2)) as TrainingRow[]
    );

    const model = normalizeText(config.model) || "openai/gpt-3.5-turbo";
    const temperature =
      typeof config.temperature === "number" ? config.temperature : 0.3;

    const messages = buildMessages({
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
        max_tokens: 120,
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
