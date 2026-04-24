async function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  try {
    const { data, error } = await supabase
      .from("inbox_messages")            // ⬅️ tabla real, NO la vista
      .select("id")
      .eq("wa_message_id", messageId)
      .maybeSingle();
    if (error) {
      console.log("⚠️ No se pudo verificar duplicado:", error.message);
      return false;
    }
    return !!data;
  } catch (err) {
    console.error("❌ isDuplicateMessage error:", err);
    return false;
  }
}

async function saveReceivedMessage({
  userId,
  from,
  message,
  messageType,
  mediaUrl = null,
  waMessageId = null,
}) {
  try {
    const isOutgoing = messageType?.startsWith("out_");
    const payload = {
      user_id: userId,
      source: "whatsapp",                // columna NOT NULL real
      platform: "whatsapp",              // alias amigable
      sender_id: from,                   // columna NOT NULL real
      from_number: from,                 // alias amigable
      sender_name: from,                 // requerido si NOT NULL
      message,
      message_type: messageType || "text",
      media_url_text: mediaUrl,          // texto plano (la vista lo expone como media_url)
      is_read: !!isOutgoing,
      is_processed: !!isOutgoing,
      ...(waMessageId ? { wa_message_id: waMessageId } : {}),
    };

    const { error } = await supabase
      .from("inbox_messages")            // ⬅️ tabla real, NO la vista
      .insert(payload);

    if (error) {
      console.log("❌ Error guardando inbox_messages:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("❌ saveReceivedMessage error:", err);
    return false;
  }
}
