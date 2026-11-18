/**
 * NODE: VRMAvatarNode — VRM avatar with full situational animations.
 * Idle, thinking, speaking, and per-emotion body language.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { chooseLiaPose, getLiaPose } from "../animations/liaPoseAnimations.js";
import {
  FBX_ANIMATION_STATES,
  FBX_ANIMATION_URLS,
  nameVrmBonesForFbxTracks,
  retargetFbxToVrmClip,
} from "../animations/vrmFbxRetarget.js";

const VRM_PATH = "/models/lia.vrm";
const ENABLE_FBX_BODY = true;
const AVATAR_Y = -0.90;
const AVATAR_SCALE = 1.18;

const EMOTION_EXPR = {
  happy: "happy", sad: "sad", angry: "angry", surprised: "surprised",
  loving: "happy", worried: "sad", flustered: "surprised", jealous: "angry", neutral: "neutral",
  serious: "angry",
};

const SOUL_TO_EMOTION = {
  happy:     { emotion: "happy",     weight: 0.80 },
  sad:       { emotion: "sad",       weight: 0.95 },
  angry:     { emotion: "angry",     weight: 0.95 },
  fear:      { emotion: "worried",   weight: 0.85 },
  disgust:   { emotion: "angry",     weight: 0.65 },
  surprised: { emotion: "surprised", weight: 0.85 },
  relaxed:   { emotion: "neutral",   weight: 0.55 },
  love:      { emotion: "loving",    weight: 0.80 },
  arousal:   { emotion: "flustered", weight: 0.70 },
  devotion:  { emotion: "loving",    weight: 0.75 },
};

const SOUL_EXPR_BLEND = {
  happy:     { happy: 0.45 },
  sad:       { sad: 0.55 },
  angry:     { angry: 0.55 },
  fear:      { sad: 0.30, surprised: 0.18 },
  disgust:   { angry: 0.32 },
  surprised: { surprised: 0.45 },
  relaxed:   { relaxed: 0.35 },
  love:      { happy: 0.42, relaxed: 0.16 },
  arousal:   { surprised: 0.28, happy: 0.16 },
  devotion:  { happy: 0.28, relaxed: 0.24 },
};

// Per-emotion animation config
const EMO_CONFIG = {
  neutral:   { breathSpeed: 0.45, breathAmp: 1.0, swayAmp: 1.0, spineX:  0.000, headTilt:  0.00 },
  serious:   { breathSpeed: 0.38, breathAmp: 0.82, swayAmp: 0.42, spineX: -0.018, headTilt: -0.025 },
  happy:     { breathSpeed: 0.65, breathAmp: 1.3, swayAmp: 1.4, spineX: -0.030, headTilt:  0.05 },
  sad:       { breathSpeed: 0.28, breathAmp: 0.7, swayAmp: 0.4, spineX:  0.045, headTilt: -0.04 },
  angry:     { breathSpeed: 0.70, breathAmp: 1.2, swayAmp: 0.5, spineX: -0.040, headTilt:  0.00 },
  surprised: { breathSpeed: 0.55, breathAmp: 1.4, swayAmp: 0.6, spineX: -0.020, headTilt:  0.06 },
  loving:    { breathSpeed: 0.35, breathAmp: 1.0, swayAmp: 0.8, spineX:  0.010, headTilt:  0.12 },
  worried:   { breathSpeed: 0.40, breathAmp: 0.8, swayAmp: 0.5, spineX:  0.030, headTilt: -0.05 },
  flustered: { breathSpeed: 0.75, breathAmp: 1.1, swayAmp: 1.2, spineX: -0.010, headTilt:  0.08 },
  jealous:   { breathSpeed: 0.50, breathAmp: 1.0, swayAmp: 0.7, spineX:  0.015, headTilt: -0.06 },
};

// Per-emotion arm targets (left/right upper arm RZ, speaking arm raise)
const ARM_CONFIG = {
  neutral:   { armRz: 1.32, armRx: 0.22, lArmY:  0.03, rArmY: -0.03 },
  serious:   { armRz: 1.36, armRx: 0.27, lArmY:  0.01, rArmY: -0.01 },
  happy:     { armRz: 1.10, armRx: 0.18, lArmY:  0.06, rArmY: -0.06 },  // lifted
  sad:       { armRz: 1.45, armRx: 0.30, lArmY:  0.02, rArmY: -0.02 },  // drooping
  angry:     { armRz: 1.25, armRx: 0.28, lArmY:  0.05, rArmY: -0.05 },  // slightly tense
  surprised: { armRz: 1.15, armRx: 0.20, lArmY:  0.08, rArmY: -0.08 },  // startled lift
  loving:    { armRz: 1.20, armRx: 0.20, lArmY:  0.04, rArmY: -0.04 },  // soft
  worried:   { armRz: 1.38, armRx: 0.26, lArmY:  0.02, rArmY: -0.02 },
  flustered: { armRz: 1.22, armRx: 0.24, lArmY:  0.06, rArmY: -0.06 },
  jealous:   { armRz: 1.35, armRx: 0.32, lArmY:  0.00, rArmY:  0.00 },  // arms slightly crossed
};

function bone(vrm, name) {
  return vrm.humanoid?.getNormalizedBoneNode?.(name);
}

function randBlink() { return 2.5 + Math.random() * 3; }
function randHappyDelay() { return 10; }

function poseRot(pose, name, fallback) {
  const r = pose?.bones?.[name];
  return {
    x: r?.x ?? fallback.x ?? 0,
    y: r?.y ?? fallback.y ?? 0,
    z: r?.z ?? fallback.z ?? 0,
  };
}

function lerpRot(node, target, alpha) {
  if (!node) return;
  node.rotation.x += (target.x - node.rotation.x) * alpha;
  node.rotation.y += (target.y - node.rotation.y) * alpha;
  node.rotation.z += (target.z - node.rotation.z) * alpha;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function soulLevel(soul, key) {
  return clamp01(Number(soul?.[key] ?? 0));
}

function mixConfig(base, target, amount) {
  const out = { ...base };
  Object.keys(target).forEach(key => {
    out[key] = out[key] + (target[key] - out[key]) * amount;
  });
  return out;
}

function soulBodyTargets(soul, creatorRoastMode) {
  let cfg = { ...EMO_CONFIG.neutral };
  let arms = { ...ARM_CONFIG.neutral };

  if (creatorRoastMode) {
    cfg = mixConfig(cfg, EMO_CONFIG.serious, 0.85);
    arms = mixConfig(arms, ARM_CONFIG.serious, 0.85);
    return { cfg, arms };
  }

  Object.entries(SOUL_TO_EMOTION).forEach(([soulKey, map]) => {
    const level = soulLevel(soul, soulKey);
    if (level < 0.08) return;
    const amount = Math.min(0.40, level * map.weight * 0.28);
    cfg = mixConfig(cfg, EMO_CONFIG[map.emotion] ?? EMO_CONFIG.neutral, amount);
    arms = mixConfig(arms, ARM_CONFIG[map.emotion] ?? ARM_CONFIG.neutral, amount);
  });

  return { cfg, arms };
}

function expressionValuesForSoul(soul, activeEmotion, creatorRoastMode, speaking) {
  const values = { happy: 0, angry: 0, sad: 0, relaxed: 0, surprised: 0 };
  if (!speaking) return values;
  const soulScale = creatorRoastMode ? 0.15 : 1;

  Object.entries(SOUL_EXPR_BLEND).forEach(([soulKey, exprs]) => {
    const level = soulLevel(soul, soulKey) * soulScale;
    const threshold = soulKey === "love" || soulKey === "devotion" || soulKey === "happy"
      ? 0.96
      : 0.55;
    if (level < threshold) return;
    const expressiveLevel = (level - threshold) / (1 - threshold);
    Object.entries(exprs).forEach(([expr, weight]) => {
      values[expr] = Math.max(values[expr] ?? 0, expressiveLevel * weight);
    });
  });

  const activeTarget = EMOTION_EXPR[activeEmotion] ?? "neutral";
  if (activeTarget !== "neutral") {
    const activeStrength = activeEmotion === "serious" ? 0.48 : 0.75;
    values[activeTarget] = Math.max(values[activeTarget] ?? 0, activeStrength);
  }
  if (creatorRoastMode && activeEmotion === "serious") {
    values.angry = Math.max(values.angry, 0.48);
  }
  return values;
}

function resolveEmotion(emotion, creatorRoastMode) {
  return creatorRoastMode && emotion === "neutral" ? "serious" : emotion;
}

function resolveFbxAnimationState({ speaking, thinking, listening }) {
  if (speaking) return "speaking";
  if (thinking) return "thinking";
  if (listening) return "listening";
  return "idle";
}

function fadeToFbxAction({ actions, currentActionRef, currentStateRef, state, fadeSeconds = 0.32 }) {
  if (currentStateRef.current === state) return true;
  const nextAction = actions[state];
  if (!nextAction) return false;

  const previousAction = currentActionRef.current;
  currentActionRef.current = nextAction;
  currentStateRef.current = state;

  nextAction.enabled = true;
  nextAction.reset();
  nextAction.setEffectiveTimeScale(1);
  nextAction.setEffectiveWeight(1);
  nextAction.fadeIn(fadeSeconds);
  nextAction.play();

  if (previousAction && previousAction !== nextAction) previousAction.fadeOut(fadeSeconds);
  return true;
}

const FORWARD_FACING_FBX_BONES = ["hips", "spine", "chest", "upperChest", "neck", "head"];

function keepFbxAvatarFacingForward(vrm) {
  vrm.scene.rotation.y = 0;

  for (const boneName of FORWARD_FACING_FBX_BONES) {
    const node = bone(vrm, boneName);
    if (!node) continue;
    node.rotation.y = 0;
  }
}

export default function VRMAvatarNode({
  emotion = "neutral",
  audioLevel = 0,
  speaking = false,
  thinking = false,
  listening = false,
  blendshapes,
  facePosRef: externalFacePosRef,
  vrmPath = VRM_PATH,
  creatorRoastMode = false,
  soulEmotions = null,
}) {
  const gltf = useLoader(GLTFLoader, vrmPath, loader => {
    loader.register(parser => new VRMLoaderPlugin(parser));
  });
  const fbxAssets = useLoader(FBXLoader, FBX_ANIMATION_URLS);

  const vrm = gltf?.userData?.vrm ?? null;

  // Live refs (avoid re-render triggers in useFrame)
  const speakingRef  = useRef(speaking);
  const thinkingRef  = useRef(thinking);
  const listeningRef = useRef(listening);
  const audioRef     = useRef(audioLevel);
  const bsRef        = useRef(blendshapes);
  const emotionRef   = useRef(emotion);
  const creatorRef   = useRef(creatorRoastMode);
  const soulRef      = useRef(soulEmotions);

  // Animation phase counters
  const breathPh    = useRef(0);
  const swayPh      = useRef(0);
  const speakPh     = useRef(0);
  const thinkPh     = useRef(0);
  const surprisePh  = useRef(0);   // for startle on surprised

  // Smooth values
  const smoothAudio  = useRef(0);
  const smoothFaceX  = useRef(0);
  const smoothFaceY  = useRef(0);
  const armT         = useRef(0);   // 0→1 initial arm settle
  const blinkT       = useRef(0);
  const blinkAt      = useRef(randBlink());

  // Current anim target refs (lerped toward)
  const curBreathSpeed = useRef(0.45);
  const curBreathAmp   = useRef(1.0);
  const curSwayAmp     = useRef(1.0);
  const curSpineX      = useRef(0);
  const curHeadTilt    = useRef(0);
  const curArmRz       = useRef(1.32);
  const curArmRx       = useRef(0.22);
  const curLArmY       = useRef(0.03);
  const curRArmY       = useRef(-0.03);

  // Surprised startle (one-shot on emotion change)
  const prevEmo      = useRef(emotion);

  const mixerRef = useRef(null);
  const fbxActionsRef = useRef({});
  const currentFbxActionRef = useRef(null);
  const currentFbxStateRef = useRef("");
  const fbxReadyRef = useRef(false);
  const autoHappyClockRef = useRef(0);
  const autoHappyUntilRef = useRef(0);
  const nextAutoHappyAtRef = useRef(randHappyDelay());

  useEffect(() => { speakingRef.current  = speaking;   }, [speaking]);
  useEffect(() => { thinkingRef.current  = thinking;   }, [thinking]);
  useEffect(() => { listeningRef.current = listening;  }, [listening]);
  useEffect(() => { audioRef.current     = audioLevel; }, [audioLevel]);
  useEffect(() => { bsRef.current        = blendshapes;}, [blendshapes]);
  useEffect(() => { emotionRef.current   = emotion;    }, [emotion]);
  useEffect(() => { creatorRef.current   = creatorRoastMode; }, [creatorRoastMode]);
  useEffect(() => { soulRef.current      = soulEmotions; }, [soulEmotions]);

  useEffect(() => {
    if (!vrm) return;
    try { VRMUtils.removeUnnecessaryVertices(vrm.scene); } catch {}
    try { VRMUtils.combineSkeletons(vrm.scene); }          catch {}
    try { VRMUtils.combineMorphs(vrm); }                   catch {}
    vrm.scene.rotation.y = 0;
    vrm.scene.position.set(0, AVATAR_Y, 0);
    vrm.scene.scale.setScalar(AVATAR_SCALE);
    armT.current = 0;
  }, [vrm]);

  useEffect(() => {
    if (!vrm || !fbxAssets?.length) return;

    const mixer = new THREE.AnimationMixer(vrm.scene);
    const actions = {};

    try {
      nameVrmBonesForFbxTracks(vrm);
      FBX_ANIMATION_STATES.forEach((state, index) => {
        const fbx = fbxAssets[index];
        const clip = retargetFbxToVrmClip(fbx, vrm, state);
        const action = mixer.clipAction(clip, vrm.scene);
        action.clampWhenFinished = false;
        action.loop = THREE.LoopRepeat;
        actions[state] = action;
      });

      mixerRef.current = mixer;
      fbxActionsRef.current = actions;
      currentFbxActionRef.current = null;
      currentFbxStateRef.current = "";
      fbxReadyRef.current = true;
      autoHappyClockRef.current = 0;
      autoHappyUntilRef.current = 0;
      nextAutoHappyAtRef.current = randHappyDelay();
    } catch (error) {
      console.error("LIA FBX animation setup failed", error);
      mixer.stopAllAction();
      mixerRef.current = null;
      fbxActionsRef.current = {};
      currentFbxActionRef.current = null;
      currentFbxStateRef.current = "";
      fbxReadyRef.current = false;
    }

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(vrm.scene);
      if (mixerRef.current === mixer) {
        mixerRef.current = null;
        fbxActionsRef.current = {};
        currentFbxActionRef.current = null;
        currentFbxStateRef.current = "";
        fbxReadyRef.current = false;
      }
    };
  }, [vrm, fbxAssets]);

  useEffect(() => {
    if (!vrm?.expressionManager) return;
    const exp = vrm.expressionManager;
    Object.values(EMOTION_EXPR).forEach(n => { try { exp.setValue(n, 0); } catch {} });
    const effectiveEmotion = resolveEmotion(emotion, creatorRoastMode);

    // Startle on surprised
    if (effectiveEmotion === "surprised" && prevEmo.current !== "surprised") {
      surprisePh.current = 1.0;
    }
    prevEmo.current = effectiveEmotion;
  }, [vrm, emotion, creatorRoastMode]);

  useFrame((_, delta) => {
    if (!vrm) return;

    vrm.scene.position.set(0, AVATAR_Y, 0);
    vrm.scene.scale.setScalar(AVATAR_SCALE);
    vrm.scene.rotation.y = 0;

    const exp  = vrm.expressionManager;
    const emo  = resolveEmotion(emotionRef.current, creatorRef.current);
    const soul = soulRef.current;
    const isSpeaking = speakingRef.current;
    const isThinking = thinkingRef.current;
    const isListening = listeningRef.current;
    const rawAudio = audioRef.current ?? 0;
    let fbxState = resolveFbxAnimationState({
      speaking: isSpeaking,
      thinking: isThinking,
      listening: isListening,
    });

    autoHappyClockRef.current += delta;
    const canAutoHappy = !isSpeaking
      && !isThinking
      && !isListening
      && fbxReadyRef.current
      && Boolean(fbxActionsRef.current.happy)
      && (emo === "neutral" || emo === "serious");

    if (!canAutoHappy) {
      autoHappyUntilRef.current = 0;
      nextAutoHappyAtRef.current = autoHappyClockRef.current + randHappyDelay();
    } else if (autoHappyClockRef.current >= nextAutoHappyAtRef.current) {
      const happyDuration = fbxActionsRef.current.happy?.getClip?.().duration ?? 3.5;
      autoHappyUntilRef.current = autoHappyClockRef.current + Math.min(4.5, Math.max(2.5, happyDuration));
      nextAutoHappyAtRef.current = autoHappyUntilRef.current + randHappyDelay();
    }

    const autoHappyActive = canAutoHappy && autoHappyClockRef.current < autoHappyUntilRef.current;
    if (autoHappyActive) {
      fbxState = "happy";
    }

    const useFbxBody = Boolean(
      ENABLE_FBX_BODY
      && fbxReadyRef.current
      && fbxActionsRef.current[fbxState]
    );

    if (useFbxBody) {
      fadeToFbxAction({
        actions: fbxActionsRef.current,
        currentActionRef: currentFbxActionRef,
        currentStateRef: currentFbxStateRef,
        state: fbxState,
      });
    } else if (currentFbxActionRef.current) {
      currentFbxActionRef.current.fadeOut(0.25);
      currentFbxActionRef.current = null;
      currentFbxStateRef.current = "";
    }

    mixerRef.current?.update(delta);
    if (useFbxBody) keepFbxAvatarFacingForward(vrm);
    vrm.update(delta);

    const baseCfg  = EMO_CONFIG[emo] ?? EMO_CONFIG.neutral;
    const baseArms = ARM_CONFIG[emo] ?? ARM_CONFIG.neutral;
    const soulTargets = soulBodyTargets(soul, creatorRef.current);
    const soulMix = useFbxBody ? 0 : (emo === "neutral" || emo === "serious" ? 0.70 : 0.30);
    const mixedCfg = mixConfig(baseCfg, soulTargets.cfg, soulMix);
    const mixedArms = mixConfig(baseArms, soulTargets.arms, soulMix);
    const poseName = chooseLiaPose({ emotion: emo, speaking: isSpeaking, thinking: isThinking, audioLevel: rawAudio });
    const pose = getLiaPose(poseName);
    const body = pose.body ?? {};
    const cfg = {
      ...mixedCfg,
      breathSpeed: body.breathSpeed ?? mixedCfg.breathSpeed,
      breathAmp: body.breathAmp ?? mixedCfg.breathAmp,
      swayAmp: body.swayAmp ?? mixedCfg.swayAmp,
      spineX: mixedCfg.spineX + (body.spineX ?? 0),
      headTilt: mixedCfg.headTilt + (body.headTilt ?? 0),
    };
    const arms = { ...mixedArms, ...(pose.arms ?? {}) };

    // ── Lerp animation config toward emotion targets ──────────────────────────
    const lerpSpeed = Math.min(1, delta * 1.5);
    curBreathSpeed.current += (cfg.breathSpeed - curBreathSpeed.current) * lerpSpeed;
    curBreathAmp.current   += (cfg.breathAmp   - curBreathAmp.current)   * lerpSpeed;
    curSwayAmp.current     += (cfg.swayAmp     - curSwayAmp.current)     * lerpSpeed;
    curSpineX.current      += (cfg.spineX      - curSpineX.current)      * lerpSpeed;
    curHeadTilt.current    += (cfg.headTilt    - curHeadTilt.current)    * lerpSpeed;
    curArmRz.current       += (arms.armRz      - curArmRz.current)       * lerpSpeed;
    curArmRx.current       += (arms.armRx      - curArmRx.current)       * lerpSpeed;
    curLArmY.current       += (arms.lArmY      - curLArmY.current)       * lerpSpeed;
    curRArmY.current       += (arms.rArmY      - curRArmY.current)       * lerpSpeed;

    // ── Smooth audio ──────────────────────────────────────────────────────────
    smoothAudio.current += (rawAudio - smoothAudio.current) * Math.min(1, delta * 12);
    const audio = smoothAudio.current;

    // ── Phase counters ────────────────────────────────────────────────────────
    breathPh.current += delta * curBreathSpeed.current;
    swayPh.current   += delta * 0.20;
    thinkPh.current  += delta * 0.90;
    if (isSpeaking) speakPh.current += delta * 2.5;

    // Decay startle
    if (surprisePh.current > 0) surprisePh.current = Math.max(0, surprisePh.current - delta * 2.5);

    const breath  = Math.sin(breathPh.current) * curBreathAmp.current;
    const breath2 = Math.sin(breathPh.current * 1.6) * curBreathAmp.current;
    const sway    = Math.sin(swayPh.current) * curSwayAmp.current;
    const sway2   = Math.sin(swayPh.current * 0.55) * curSwayAmp.current;
    const speakB  = Math.sin(speakPh.current);
    const thinkB  = Math.sin(thinkPh.current);

    // Speaking nod amplitude
    const speechDrive = isSpeaking ? Math.min(1, Math.max(audio * 3.2, 0.28)) : 0;
    const speakNod = speakB * 0.024 * speechDrive;
    const speakTurn = Math.sin(speakPh.current * 0.72) * 0.026 * speechDrive;
    const speakFlow = Math.sin(speakPh.current * 1.18) * 0.018 * speechDrive;

    // Thinking head tilt (slow sine to left)
    const thinkHeadY = isThinking ? thinkB * 0.04 + 0.08 : 0;

    // Startle head jerk back (surprised)
    const startleX = surprisePh.current * 0.09;

    // Flustered micro-jitter
    const flustered = emo === "flustered"
      ? Math.sin(breathPh.current * 4.2) * 0.012 + Math.sin(breathPh.current * 7.1) * 0.008
      : 0;

    // Happy bounce (vertical)
    const happyBounce = emo === "happy"
      ? Math.abs(Math.sin(breathPh.current * 1.4)) * 0.015
      : 0;

    // ── Face look-at ─────────────────────────────────────────────────────────
    if (!useFbxBody) {
      const fp = externalFacePosRef?.current ?? null;
      const faceTargetX = fp ? fp.x * 0.28 : 0;
      const faceTargetY = fp ? fp.y * 0.18 : 0;
      smoothFaceX.current += (faceTargetX - smoothFaceX.current) * Math.min(1, delta * 3);
      smoothFaceY.current += (faceTargetY - smoothFaceY.current) * Math.min(1, delta * 3);

    // ── Spine ─────────────────────────────────────────────────────────────────
    const spFwdLean = isSpeaking ? -0.022 - speechDrive * 0.010 : 0;  // lean toward jashu when speaking
    const sp = bone(vrm, "spine");
    if (sp) {
      sp.rotation.x = curSpineX.current + breath * 0.018 + spFwdLean;
      sp.rotation.z = sway * 0.010 + speakFlow * 0.45;
    }
    const ch = bone(vrm, "chest");
    if (ch) {
      ch.rotation.x = breath * 0.014 + spFwdLean * 0.6;
      ch.rotation.y = speakTurn * 0.35;
      ch.rotation.z = sway * 0.007 + speakFlow * 0.35;
    }
    const hi = bone(vrm, "hips");
    if (hi) {
      hi.rotation.z = sway * 0.018;
      hi.rotation.x = breath * 0.007 + happyBounce;
      hi.rotation.y = flustered * 0.5;
    }

    // ── Head ─────────────────────────────────────────────────────────────────
    const hd = bone(vrm, "head");
    if (hd) {
      hd.rotation.y = sway * 0.045 + sway2 * 0.015 - smoothFaceX.current + thinkHeadY + flustered + speakTurn;
      hd.rotation.x = breath2 * 0.014 + speakNod + smoothFaceY.current - startleX + curHeadTilt.current;
      hd.rotation.z = sway2 * 0.015 + curHeadTilt.current * 0.3 + speakFlow * 0.4;
    }
    const nk = bone(vrm, "neck");
    if (nk) {
      nk.rotation.y = sway * 0.022 - smoothFaceX.current * 0.4 + thinkHeadY * 0.5 + speakTurn * 0.45;
      nk.rotation.x = breath2 * 0.008 + smoothFaceY.current * 0.3 - startleX * 0.5;
    }

    // ── Arms ─────────────────────────────────────────────────────────────────
    armT.current = Math.min(1, armT.current + delta * 0.7);
    const ease = 1 - Math.pow(1 - armT.current, 3);

    const breathArm = breath * 0.008;
    const swayArm   = sway  * 0.012;

    const wave = pose.motion === "smallWave" ? Math.sin(speakPh.current * 3.4) * 0.08 : 0;
    const paw = pose.motion === "tinyPaw" ? Math.sin(speakPh.current * 4.2) * 0.035 : 0;
    const offer = pose.motion === "softReach" ? Math.sin(speakPh.current * 1.8) * 0.025 : 0;
    const talkGesture = Math.sin(speakPh.current * 1.55) * 0.035 * speechDrive;
    const poseAlpha = 0.055 * ease;

    const lUA = bone(vrm, "leftUpperArm");
    lerpRot(lUA, poseRot(pose, "leftUpperArm", {
      x: curArmRx.current + breathArm,
      y: curLArmY.current,
      z: -curArmRz.current + swayArm,
    }), poseAlpha);

    const rUA = bone(vrm, "rightUpperArm");
    const rUATarget = poseRot(pose, "rightUpperArm", {
      x: curArmRx.current - breathArm,
      y: curRArmY.current,
      z: curArmRz.current - swayArm,
    });
    rUATarget.z += wave + talkGesture;
    rUATarget.x += offer;
    lerpRot(rUA, rUATarget, poseAlpha);

    const lLA = bone(vrm, "leftLowerArm");
    const lLATarget = poseRot(pose, "leftLowerArm", { x: 0.16, y: 0, z: -0.04 });
    lLATarget.x += paw;
    lerpRot(lLA, lLATarget, poseAlpha);

    const rLA = bone(vrm, "rightLowerArm");
    const rLATarget = poseRot(pose, "rightLowerArm", { x: 0.16, y: 0, z: 0.04 });
    rLATarget.x += paw + wave * 0.25;
    rLATarget.z += wave * 0.35 + talkGesture * 0.5;
    rLATarget.y += offer * 0.8;
    lerpRot(rLA, rLATarget, poseAlpha);

    const lH = bone(vrm, "leftHand");
    const lHTarget = poseRot(pose, "leftHand", { x: 0, y: 0.07, z: -0.10 });
    lHTarget.z += paw * 0.8;
    lerpRot(lH, lHTarget, poseAlpha);

    const rH = bone(vrm, "rightHand");
    const rHTarget = poseRot(pose, "rightHand", { x: 0, y: -0.07, z: 0.10 });
    rHTarget.z += wave * 0.8 - paw * 0.8;
    rHTarget.x += offer * 0.8;
    lerpRot(rH, rHTarget, poseAlpha);
    }


    // ── Lip sync ──────────────────────────────────────────────────────────────
    if (exp) {
      if (isSpeaking) {
        const bs = bsRef.current;
        if (bs) {
          try { exp.setValue("aa", bs.aa ?? 0); } catch {}
          try { exp.setValue("ih", bs.ih ?? 0); } catch {}
          try { exp.setValue("ou", bs.ou ?? 0); } catch {}
          try { exp.setValue("ee", bs.ee ?? 0); } catch {}
          try { exp.setValue("oh", bs.oh ?? 0); } catch {}
          try { exp.setValue("blink", bs.blink ?? 0); } catch {}
          try { exp.setValue("blinkLeft", bs.blinkLeft ?? 0); } catch {}
          try { exp.setValue("blinkRight", bs.blinkRight ?? 0); } catch {}
        } else {
          const m  = Math.min(1, audio * 5.0);
          const aa = m * 0.70 * (0.85 + 0.15 * Math.sin(speakPh.current * 2.8));
          const oh = m * 0.18;
          try { exp.setValue("aa", aa); } catch {}
          try { exp.setValue("oh", oh); } catch {}
          try { exp.setValue("ou", 0);  } catch {}
        }
      } else {
        ["aa", "oh", "ou", "ee", "ih", "blinkLeft", "blinkRight"].forEach(n => {
          try { exp.setValue(n, 0); } catch {}
        });
      }

      // ── Blink ─────────────────────────────────────────────────────────────
      blinkT.current += delta;
      if (blinkT.current >= blinkAt.current) {
        try { exp.setValue("blink", 1); } catch {}
        setTimeout(() => { try { exp?.setValue("blink", 0); } catch {} }, 120);
        blinkT.current = 0;
        blinkAt.current = randBlink();
      }

      const faceValues = expressionValuesForSoul(soul, emo, creatorRef.current, isSpeaking);
      Object.entries(faceValues).forEach(([name, value]) => {
        try { exp.setValue(name, value); } catch {}
      });

      // Safeguard: Ensure eyes remain beautifully open and mouth stays petite & cute
      try {
        const faceObj = vrm.scene?.getObjectByName("Face");
        if (faceObj?.morphTargetInfluences && faceObj?.morphTargetDictionary) {
          const allJoy = faceObj.morphTargetDictionary["Fcl_ALL_Joy"];
          const eyeJoy = faceObj.morphTargetDictionary["Fcl_EYE_Joy"];
          const mthJoy = faceObj.morphTargetDictionary["Fcl_MTH_Joy"];
          const mthLarge = faceObj.morphTargetDictionary["Fcl_MTH_Large"];
          const mthSmall = faceObj.morphTargetDictionary["Fcl_MTH_Small"];

          if (allJoy !== undefined) faceObj.morphTargetInfluences[allJoy] = 0;
          if (eyeJoy !== undefined) faceObj.morphTargetInfluences[eyeJoy] = 0;
          if (mthJoy !== undefined) faceObj.morphTargetInfluences[mthJoy] = 0;
          if (mthLarge !== undefined) faceObj.morphTargetInfluences[mthLarge] = 0;
          if (mthSmall !== undefined) {
            faceObj.morphTargetInfluences[mthSmall] = Math.max(faceObj.morphTargetInfluences[mthSmall] || 0, 0.70);
          }
        }
      } catch {}
    }
  });

  if (!vrm) return null;
  return <primitive object={vrm.scene} />;
}
