/**
 * NODE: ScreenShareNode — capture screen/window and send to LIA's vision API
 * LIA sees jashu's screen and can help, comment, or react to what she sees.
 * Grabs a frame every 5s while active and sends to /api/vision_chat.
 */
import { useEffect, useRef, useState } from "react";

const VISION_URL   = "/api/vision_chat";
const CAPTURE_MS   = 5000;  // how often to grab a frame
const JPEG_QUALITY = 0.72;

export default function ScreenShareNode({ onReaction, enabled }) {
  const videoRef    = useRef(null);
  const streamRef   = useRef(null);
  const canvasRef   = useRef(null);
  const timerRef    = useRef(null);
  const [status, setStatus] = useState("idle"); // idle|active|error

  async function startShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      // Create offscreen canvas for frame grabs
      canvasRef.current = document.createElement("canvas");

      stream.getVideoTracks()[0].addEventListener("ended", stopShare);
      setStatus("active");

      // Grab first frame after short delay, then on interval
      setTimeout(grabAndSend, 1500);
      timerRef.current = setInterval(grabAndSend, CAPTURE_MS);
    } catch (err) {
      if (err.name !== "NotAllowedError") console.error("Screen share error:", err);
      setStatus("error");
    }
  }

  function stopShare() {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("idle");
  }

  async function grabAndSend() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    canvas.width  = Math.min(video.videoWidth,  1280);
    canvas.height = Math.min(video.videoHeight, 720);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const form = new FormData();
      form.append("file", blob, "screen.jpg");
      form.append("message", "What do you see on my screen? React naturally as LIA.");
      try {
        const resp = await fetch(VISION_URL, { method: "POST", body: form });
        if (!resp.ok) return;
        const text = decodeURIComponent(resp.headers.get("X-LIA-Text") ?? "");
        if (text) onReaction?.(text);
      } catch (e) {
        console.error("Screen vision error:", e);
      }
    }, "image/jpeg", JPEG_QUALITY);
  }

  useEffect(() => {
    if (enabled) startShare();
    else stopShare();
    return () => stopShare();
  }, [enabled]);

  return (
    <video ref={videoRef} style={{ display: "none" }} playsInline muted />
  );
}
