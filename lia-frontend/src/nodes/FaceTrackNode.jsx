/**
 * NODE: FaceTrackNode — webcam face expression detection via MediaPipe
 * Detects jashu's facial emotion in real-time and feeds it to LIA.
 * Uses MediaPipe FaceLandmarker (WASM, runs entirely in browser, no server).
 */
import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";

// ARKit blendshape → emotion mapping
function blendshapesToEmotion(categories) {
  const bs = {};
  categories.forEach(c => { bs[c.categoryName] = c.score; });

  const browDown   = ((bs.browDownLeft  ?? 0) + (bs.browDownRight  ?? 0)) / 2;
  const smile      = ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2;
  const frown      = ((bs.mouthFrownLeft ?? 0) + (bs.mouthFrownRight ?? 0)) / 2;
  const eyeWide    = ((bs.eyeWideLeft   ?? 0) + (bs.eyeWideRight   ?? 0)) / 2;
  const jawOpen    =   bs.jawOpen ?? 0;
  const browInner  =   bs.browInnerUp ?? 0;

  if (browDown > 0.38 && smile < 0.18)          return "angry";
  if (smile > 0.38)                              return "happy";
  if (eyeWide > 0.40 && jawOpen > 0.28)         return "surprised";
  if (frown > 0.28 || (browInner > 0.3 && smile < 0.15)) return "sad";
  return "neutral";
}

// Nose tip landmark index in MediaPipe FaceLandmarker (478 points)
const NOSE_TIP = 4;

export default function FaceTrackNode({ onEmotion, onFaceActive, onFacePos, enabled }) {
  const videoRef     = useRef(null);
  const landmarkerRef = useRef(null);
  const rafRef       = useRef(null);
  const streamRef    = useRef(null);
  const lastEmoRef   = useRef("neutral");
  const [status, setStatus] = useState("idle"); // idle|loading|active|error

  // Load MediaPipe FaceLandmarker
  async function initLandmarker() {
    setStatus("loading");
    try {
      const filesetResolver = await FilesetResolver.forVisionTasks(WASM_URL);
      landmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        outputFaceBlendshapes: true,
        runningMode: "VIDEO",
        numFaces: 1,
      });
      setStatus("active");
      return true;
    } catch (e) {
      console.error("FaceLandmarker init failed:", e);
      setStatus("error");
      return false;
    }
  }

  // Per-frame detection loop
  function runDetection() {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runDetection);
      return;
    }

    const nowMs = performance.now();
    const result = landmarker.detectForVideo(video, nowMs);

    if (result?.faceBlendshapes?.length > 0) {
      const emo = blendshapesToEmotion(result.faceBlendshapes[0].categories);
      if (emo !== lastEmoRef.current) {
        lastEmoRef.current = emo;
        onEmotion?.(emo);
      }
    }

    // Emit face position from nose tip landmark (0,0 = center)
    if (result?.faceLandmarks?.length > 0 && onFacePos) {
      const nose = result.faceLandmarks[0][NOSE_TIP];
      if (nose) {
        onFacePos(nose.x - 0.5, 0.5 - nose.y);
      }
    }

    rafRef.current = requestAnimationFrame(runDetection);
  }

  async function startCamera() {
    const ok = await initLandmarker();
    if (!ok) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: "user" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.onloadeddata = () => {
          video.play();
          rafRef.current = requestAnimationFrame(runDetection);
          onFaceActive?.(true);
        };
      }
    } catch (err) {
      console.error("Camera access denied:", err);
      setStatus("error");
    }
  }

  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    onFaceActive?.(false);
    lastEmoRef.current = "neutral";
    setStatus("idle");
  }

  useEffect(() => {
    if (enabled) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [enabled]);

  return (
    // Hidden video element — detection only, not shown to user
    <video
      ref={videoRef}
      style={{ display: "none" }}
      playsInline
      muted
    />
  );
}
