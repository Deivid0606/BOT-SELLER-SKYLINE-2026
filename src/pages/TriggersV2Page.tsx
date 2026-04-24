// dentro de TriggersV2Page.tsx, cuando envías el disparador:
async function sendTrigger(trigger: any, phone: string) {
  const res = await fetch("/api/send-whatsapp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone,
      message: trigger.message ?? "",
      media_url: trigger.media_url ?? null,   // <-- CLAVE
      media_type: trigger.media_type ?? null, // image | video | gif | audio | document
      caption: trigger.message ?? "",
    }),
  });
  if (!res.ok) {
    toast.error("Error enviando disparador");
    return false;
  }
  return true;
}
