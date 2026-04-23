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
  last_topic?: string | null; // PRODUCTO ACTIVO
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
  max_tokens?: number | null;
};

type GeminiContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeForSearch(text: string): string {
  return normalizeText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeText(text: string): string[] {
  return Array.from(
    new Set(
      normalizeForSearch(text)
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3)
    )
  );
}

function sanitizeHistory(
  history: unknown
): Array<{ role: "user" | "assistant"; content: string }> {
  const items = safeArray<IncomingHistoryItem>(history);

  return items
    .slice(-4)
    .map((item) => {
      const role = item?.role;
      const content = normalizeText(item?.content).slice(0, 180);

      if (!content) return null;
      if (role !== "user" && role !== "assistant") return null;

      return { role, content };
    })
    .filter(Boolean) as Array<{ role: "user" | "assistant"; content: string }>;
}

function scoreTrainingRow(
  row: TrainingRow,
  currentMessage: string,
  context: IncomingContext | null
): number {
  const query = [
    normalizeText(currentMessage),
    normalizeText(context?.last_topic),
    normalizeText(context?.last_trigger),
  ]
    .filter(Boolean)
    .join(" ");

  const keywords = tokenizeText(query);
  if (!keywords.length) return 0;

  const intent = normalizeForSearch(row.intent || "");
  const response = normalizeForSearch(row.response || "");
  const examples = safeArray<string>(row.examples)
    .map((ex) => normalizeForSearch(ex))
    .filter(Boolean);

  let score = 0;

  for (const keyword of keywords) {
    if (intent.includes(keyword)) score += 5;
    if (response.includes(keyword)) score += 3;
    if (examples.some((ex) => ex.includes(keyword))) score += 4;
  }

  // refuerzo fuerte si el intent menciona precio y el mensaje menciona precio
  const current = normalizeForSearch(currentMessage);
  if (current.includes("precio") && intent.includes("precio")) score += 8;
  if (current.includes("cuanto cuesta") && response.includes("gs")) score += 8;

  return score;
}

function selectRelevantTrainingRows(
  rows: TrainingRow[],
  currentMessage: string,
  context: IncomingContext | null
): TrainingRow[] {
  if (!rows.length) return [];

  const ranked = rows
    .map((row, index) => ({
      row,
      index,
      score: scoreTrainingRow(row, currentMessage, context),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const relevant = ranked
    .filter((item) => item.score > 0)
    .slice(0, 4)
    .map((item) => item.row);

  if (relevant.length > 0) return relevant;

  return rows.slice(0, 2);
}

function buildTrainingContext(rows: TrainingRow[] = []): string {
  if (!rows.length) {
    return "Sin entrenamiento adicional.";
  }

  return rows
    .map((row, index) => {
      const intent = normalizeText(row.intent) || `Intent ${index + 1}`;
      const response = normalizeText(row.response) || "Sin respuesta definida";
      const examples = safeArray<string>(row.examples)
        .map((ex) => normalizeText(ex))
        .filter(Boolean)
        .slice(0, 2);

      return [
        `Intent: ${intent}`,
        examples.length ? `Ejemplos: ${examples.join(" | ")}` : null,
        `Respuesta ideal: ${response}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n")
    .slice(0, 1500);
}

function buildGeminiContents(params: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  currentMessage: string;
}): GeminiContent[] {
  const { history, currentMessage } = params;
  const contents: GeminiContent[] = [];

  for (const item of history) {
    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    });
  }

  contents.push({
    role: "user",
    parts: [{ text: normalizeText(currentMessage).slice(0, 250) }],
  });

  return contents;
}

function buildSystemInstruction(params: {
  systemInstruction: string;
  trainingContext: string;
  context: IncomingContext | null;
}): string {
  const { systemInstruction, trainingContext, context } = params;

  const contextBlock = [
    context?.last_topic
      ? `PRODUCTO ACTIVO DEL CHAT: ${normalizeText(context.last_topic).slice(0, 160)}`
      : null,
    context?.last_trigger
      ? `ÚLTIMO DISPARADOR: ${normalizeText(context.last_trigger).slice(0, 120)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `
${normalizeText(systemInstruction) || "Eres un asistente de ventas para una tienda online."}

REGLAS OBLIGATORIAS:
- Responde siempre en español.
- Mantén continuidad total con el chat.
- Si ya existe PRODUCTO ACTIVO, NO cambies de producto.
- Si el cliente dice "quiero", "si", "sí", "1", "2", "dale", "ok", seguí con el PRODUCTO ACTIVO.
- Nunca cambies a otro producto por tu cuenta.
- No inventes precios, stock ni promociones.
- Basate primero en el entrenamiento relevante.
- Responde claro, útil y orientado a cerrar venta.
- Si el cliente quiere comprar, guiá el pedido de forma concreta.
- Pedí solo el siguiente dato necesario.

ENTRENAMIENTO RELEVANTE:
${trainingContext || "Sin entrenamiento adicional."}

CONTEXTO:
${contextBlock || "Sin contexto guardado."}
  `.trim();
}

async function callGemini(params: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  contents: GeminiContent[];
  temperature: number;
  maxOutputTokens: number;
}): Promise<string> {
  const { apiKey, model, systemInstruction, contents, temperature, maxOutputTokens } =
    params;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens,
        },
      }),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("❌ Error Gemini:", data);
    throw new Error(data?.error?.message || "Error con Gemini API");
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => normalizeText(part?.text))
      .filter(Boolean)
      .join("\n") || "";

  return normalizeText(text);
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

    const { data: iaConfig, error: iaError } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", cleanUserId)
      .single();

    if (iaError || !iaConfig) {
      console.error("❌ Error cargando configuración IA:", iaError);
      return res.status(400).json({
        error: "No hay configuración de IA.",
      });
    }

    const config = iaConfig as IAConfigRow;

    if (!config.is_active) {
      return res.status(400).json({
        error: "La IA está desactivada.",
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

    const relevantRows = selectRelevantTrainingRows(
      (trainingData || []) as TrainingRow[],
      cleanMessage,
      context
    );

    const trainingContext = buildTrainingContext(relevantRows);

    const systemInstruction =
      normalizeText(config.system_instruction) ||
      "Eres un asistente de ventas para una tienda online.";

    const model = normalizeText(config.model) || "gemini-2.5-flash";
    const temperature =
      typeof config.temperature === "number" ? config.temperature : 0.4;
    const maxOutputTokens =
      typeof config.max_tokens === "number" ? config.max_tokens : 300;

    const contents = buildGeminiContents({
      history: sanitizedHistory,
      currentMessage: cleanMessage,
    });

    const finalSystemInstruction = buildSystemInstruction({
      systemInstruction,
      trainingContext,
      context,
    });

    const botResponse = await callGemini({
      apiKey: normalizeText(config.api_key),
      model,
      systemInstruction: finalSystemInstruction,
      contents,
      temperature,
      maxOutputTokens,
    });

    if (!botResponse) {
      return res.status(500).json({
        error: "La IA no devolvió contenido.",
      });
    }

    return res.status(200).json({
      response: botResponse,
    });
  } catch (error: any) {
    console.error("❌ Error en chat-ia Gemini:", error);
    return res.status(500).json({
      error: "Error interno: " + (error?.message || "desconocido"),
    });
  }
}
