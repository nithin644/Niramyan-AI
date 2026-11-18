/**
 * NODE: VisionNode — send an image to LIA and get her tsundere reaction back.
 * Returns { text, audioBlob } — caller handles playback.
 */

export async function sendImage(imageFile, message = "") {
  const form = new FormData();
  form.append("file", imageFile);
  if (message) form.append("message", message);

  try {
    const resp = await fetch("/api/vision_chat", { method: "POST", body: form });
    const text = decodeURIComponent(resp.headers.get("X-LIA-Text") ?? "");
    const audioBlob = await resp.blob();
    return { text, audioBlob: audioBlob.size > 200 ? audioBlob : null };
  } catch {
    return { text: "Hmph... something went wrong ra, bakkoda.", audioBlob: null };
  }
}
