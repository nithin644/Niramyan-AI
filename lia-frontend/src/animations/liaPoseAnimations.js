const R = Math.PI / 180;

export const LIA_POSE_REFERENCES = [
  { file: "4.16.03 PM", pose: "sadShy", trigger: "sad" },
  { file: "4.16.04 PM", pose: "surprisedSoft", trigger: "surprised" },
  { file: "4.16.04 PM (1)", pose: "angryTense", trigger: "angry, jealous" },
  { file: "4.16.05 PM", pose: "happySoft", trigger: "happy" },
  { file: "4.16.05 PM (1)", pose: "playfulSoft", trigger: "flustered" },
  { file: "4.16.05 PM (2)", pose: "lovingSoft", trigger: "loving" },
  { file: "4.16.06 PM", pose: "smallWave", trigger: "happy speaking" },
  { file: "4.16.06 PM (1)", pose: "worriedSoft", trigger: "worried" },
  { file: "4.16.06 PM (2)", pose: "happySoft", trigger: "happy idle" },
  { file: "4.16.07 PM (1)", pose: "softReach", trigger: "loving speaking" },
  { file: "4.16.07 PM", pose: "thinkingSoft", trigger: "thinking" },
  { file: "4.16.07 PM (2)", pose: "lovingSoft", trigger: "loving" },
];

const REST_HANDS = {
  leftLowerArm: { x: 0.16, y: 0, z: -0.04 },
  rightLowerArm: { x: 0.16, y: 0, z: 0.04 },
  leftHand: { x: 0, y: 0.07, z: -0.10 },
  rightHand: { x: 0, y: -0.07, z: 0.10 },
};

export const LIA_POSES = {
  idleSoft: {
    body: { spineX: 0, headTilt: 0, swayAmp: 1.0, breathAmp: 1.0 },
    arms: { armRz: 1.34, armRx: 0.22, lArmY: 0.03, rArmY: -0.03 },
    bones: REST_HANDS,
  },
  seriousIdle: {
    body: { spineX: -0.016, headTilt: -0.025, swayAmp: 0.42, breathAmp: 0.82 },
    arms: { armRz: 1.36, armRx: 0.27, lArmY: 0.01, rArmY: -0.01 },
    bones: REST_HANDS,
  },
  thinkingSoft: {
    body: { spineX: 0.012, headTilt: -0.04, swayAmp: 0.45, breathAmp: 0.82 },
    arms: { armRz: 1.34, armRx: 0.22, lArmY: 0.03, rArmY: -0.03 },
    bones: REST_HANDS,
  },
  happySoft: {
    body: { spineX: -0.018, headTilt: 0.05, swayAmp: 1.25, breathAmp: 1.18 },
    arms: { armRz: 1.24, armRx: 0.20, lArmY: 0.04, rArmY: -0.04 },
    bones: REST_HANDS,
  },
  lovingSoft: {
    body: { spineX: -0.006, headTilt: 0.10, swayAmp: 0.75, breathAmp: 0.95 },
    arms: { armRz: 1.28, armRx: 0.20, lArmY: 0.04, rArmY: -0.04 },
    bones: REST_HANDS,
  },
  sadShy: {
    body: { spineX: 0.040, headTilt: -0.07, swayAmp: 0.35, breathAmp: 0.65 },
    arms: { armRz: 1.42, armRx: 0.26, lArmY: 0.02, rArmY: -0.02 },
    bones: REST_HANDS,
  },
  angryTense: {
    body: { spineX: -0.020, headTilt: -0.035, swayAmp: 0.45, breathAmp: 0.9 },
    arms: { armRz: 1.34, armRx: 0.28, lArmY: 0.02, rArmY: -0.02 },
    bones: REST_HANDS,
  },
  surprisedSoft: {
    body: { spineX: -0.012, headTilt: 0.05, swayAmp: 0.55, breathAmp: 1.2 },
    arms: { armRz: 1.22, armRx: 0.20, lArmY: 0.06, rArmY: -0.06 },
    bones: REST_HANDS,
  },
  worriedSoft: {
    body: { spineX: 0.028, headTilt: -0.055, swayAmp: 0.45, breathAmp: 0.78 },
    arms: { armRz: 1.40, armRx: 0.25, lArmY: 0.02, rArmY: -0.02 },
    bones: REST_HANDS,
  },
  playfulSoft: {
    body: { spineX: -0.010, headTilt: 0.08, swayAmp: 1.05, breathAmp: 1.05 },
    arms: { armRz: 1.24, armRx: 0.20, lArmY: 0.04, rArmY: -0.04 },
    bones: REST_HANDS,
    motion: "tinyPaw",
  },
  smallWave: {
    body: { spineX: -0.018, headTilt: 0.05, swayAmp: 1.15, breathAmp: 1.1 },
    arms: { armRz: 1.24, armRx: 0.20, lArmY: 0.04, rArmY: -0.07 },
    bones: {
      ...REST_HANDS,
      rightUpperArm: { x: 0.03, y: -0.08, z: 1.10 },
      rightLowerArm: { x: 0.34, y: 0.02, z: 0.10 },
      rightHand: { x: 0, y: -0.06, z: 0.06 },
    },
    motion: "smallWave",
  },
  softReach: {
    body: { spineX: -0.030, headTilt: 0.06, swayAmp: 0.75, breathAmp: 1.0 },
    arms: { armRz: 1.26, armRx: 0.20, lArmY: 0.04, rArmY: -0.06 },
    bones: {
      ...REST_HANDS,
      rightUpperArm: { x: -0.10, y: -0.04, z: 1.05 },
      rightLowerArm: { x: 0.22, y: 0, z: 0.06 },
      rightHand: { x: 0, y: -0.04, z: 0.04 },
    },
    motion: "softReach",
  },
};

const EMOTION_POSE = {
  neutral: "idleSoft",
  serious: "seriousIdle",
  happy: "happySoft",
  sad: "sadShy",
  angry: "angryTense",
  surprised: "surprisedSoft",
  loving: "lovingSoft",
  worried: "worriedSoft",
  flustered: "playfulSoft",
  jealous: "angryTense",
};

export function chooseLiaPose({ emotion = "neutral", speaking = false, thinking = false, audioLevel = 0 }) {
  if (thinking) return "thinkingSoft";
  if (speaking && emotion === "loving") return "softReach";
  if (speaking && emotion === "happy" && audioLevel > 0.10) return "smallWave";
  return EMOTION_POSE[emotion] ?? "idleSoft";
}

export function getLiaPose(name) {
  return LIA_POSES[name] ?? LIA_POSES.idleSoft;
}
