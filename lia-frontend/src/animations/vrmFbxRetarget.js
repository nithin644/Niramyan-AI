import * as THREE from "three";

export const FBX_ANIMATION_STATES = ["idle", "listening", "speaking", "thinking", "happy", "sad"];

// Original browser-safe fallback clips. These stay here so we can switch back
// fast if a future mocap clip is not compatible with LIA's VRM.
export const DEFAULT_ANIMATION_PATHS = {
  idle: "/assets/animations/idle.fbx",
  listening: "/assets/animations/listening.fbx",
  speaking: "/assets/animations/speaking.fbx",
  thinking: "/assets/animations/thinking.fbx",
  happy: "/assets/animations/happy.fbx",
  sad: "/assets/animations/sad.fbx",
};

export const STAGED_MCO_ANIMATION_PATHS = {
  idle: "/assets/animations/mco/mco_idle_relaxed.fbx",
  listening: "/assets/animations/mco/mco_listening_relaxed.fbx",
  speaking: "/assets/animations/mco/mco_speaking_gesture.fbx",
  thinking: "/assets/animations/mco/mco_listening_relaxed.fbx",
  happy: "/assets/animations/mco/mco_happy_clap.fbx",
};

export const FBX_ANIMATION_PATHS = DEFAULT_ANIMATION_PATHS;

export const FBX_ANIMATION_URLS = FBX_ANIMATION_STATES.map(state => FBX_ANIMATION_PATHS[state]);

const MIXAMO_TO_VRM = {
  mixamorigHips: "hips",
  mixamorigSpine: "spine",
  mixamorigSpine1: "chest",
  mixamorigSpine2: "upperChest",
  mixamorigNeck: "neck",
  mixamorigHead: "head",
  mixamorigLeftShoulder: "leftShoulder",
  mixamorigLeftArm: "leftUpperArm",
  mixamorigLeftForeArm: "leftLowerArm",
  mixamorigLeftHand: "leftHand",
  mixamorigLeftHandThumb1: "leftThumbMetacarpal",
  mixamorigLeftHandThumb2: "leftThumbProximal",
  mixamorigLeftHandThumb3: "leftThumbDistal",
  mixamorigLeftHandIndex1: "leftIndexProximal",
  mixamorigLeftHandIndex2: "leftIndexIntermediate",
  mixamorigLeftHandIndex3: "leftIndexDistal",
  mixamorigLeftHandMiddle1: "leftMiddleProximal",
  mixamorigLeftHandMiddle2: "leftMiddleIntermediate",
  mixamorigLeftHandMiddle3: "leftMiddleDistal",
  mixamorigLeftHandRing1: "leftRingProximal",
  mixamorigLeftHandRing2: "leftRingIntermediate",
  mixamorigLeftHandRing3: "leftRingDistal",
  mixamorigLeftHandPinky1: "leftLittleProximal",
  mixamorigLeftHandPinky2: "leftLittleIntermediate",
  mixamorigLeftHandPinky3: "leftLittleDistal",
  mixamorigRightShoulder: "rightShoulder",
  mixamorigRightArm: "rightUpperArm",
  mixamorigRightForeArm: "rightLowerArm",
  mixamorigRightHand: "rightHand",
  mixamorigRightHandThumb1: "rightThumbMetacarpal",
  mixamorigRightHandThumb2: "rightThumbProximal",
  mixamorigRightHandThumb3: "rightThumbDistal",
  mixamorigRightHandIndex1: "rightIndexProximal",
  mixamorigRightHandIndex2: "rightIndexIntermediate",
  mixamorigRightHandIndex3: "rightIndexDistal",
  mixamorigRightHandMiddle1: "rightMiddleProximal",
  mixamorigRightHandMiddle2: "rightMiddleIntermediate",
  mixamorigRightHandMiddle3: "rightMiddleDistal",
  mixamorigRightHandRing1: "rightRingProximal",
  mixamorigRightHandRing2: "rightRingIntermediate",
  mixamorigRightHandRing3: "rightRingDistal",
  mixamorigRightHandPinky1: "rightLittleProximal",
  mixamorigRightHandPinky2: "rightLittleIntermediate",
  mixamorigRightHandPinky3: "rightLittleDistal",
  mixamorigLeftUpLeg: "leftUpperLeg",
  mixamorigLeftLeg: "leftLowerLeg",
  mixamorigLeftFoot: "leftFoot",
  mixamorigLeftToeBase: "leftToes",
  mixamorigRightUpLeg: "rightUpperLeg",
  mixamorigRightLeg: "rightLowerLeg",
  mixamorigRightFoot: "rightFoot",
  mixamorigRightToeBase: "rightToes",
};

const SOURCE_TO_VRM = MIXAMO_TO_VRM;
const TARGET_BONE_NAMES = [...new Set(Object.values(SOURCE_TO_VRM))];
const FORWARD_LOCK_BONES = new Set(["hips", "spine", "chest", "upperChest", "neck", "head"]);

export function nameVrmBonesForFbxTracks(vrm) {
  for (const vrmBoneName of TARGET_BONE_NAMES) {
    const node = getVrmBone(vrm, vrmBoneName);
    if (node) node.name = `vrm_${vrmBoneName}`;
  }
}

export function retargetFbxToVrmClip(fbxRoot, vrm, state) {
  fbxRoot.updateWorldMatrix(true, true);
  vrm.scene.updateWorldMatrix(true, true);

  const sourceClip = THREE.AnimationClip.findByName(fbxRoot.animations, "mixamo.com") ?? fbxRoot.animations?.[0];
  if (!sourceClip) throw new Error(`No animation clip found for ${state}`);

  const tracks = [];
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const workingQuaternion = new THREE.Quaternion();
  const workingEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const workingVector = new THREE.Vector3();
  const restLocalPosition = new THREE.Vector3();

  const motionHips = findSourceBone(fbxRoot, "mixamorigHips");
  const vrmHipsY = getVrmBone(vrm, "hips")?.getWorldPosition(workingVector).y ?? 1;
  const vrmRootY = vrm.scene.getWorldPosition(workingVector).y;
  const vrmHipsHeight = Math.abs(vrmHipsY - vrmRootY) || 1;
  const motionHipsHeight = Math.abs(motionHips?.position.y ?? 1) || 1;
  const hipsPositionScale = vrmHipsHeight / motionHipsHeight;

  for (const track of sourceClip.tracks) {
    const parsed = parseTrackName(track.name);
    if (!parsed) continue;

    const sourceBoneName = normalizeSourceBoneName(parsed.boneName);
    const vrmBoneName = SOURCE_TO_VRM[sourceBoneName];
    if (!vrmBoneName) continue;

    const vrmNode = getVrmBone(vrm, vrmBoneName);
    const mixamoRigNode = findSourceBone(fbxRoot, parsed.boneName, sourceBoneName);
    if (!vrmNode || !mixamoRigNode) continue;

    parentRestWorldRotation.identity();
    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    mixamoRigNode.parent?.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack && parsed.property === "quaternion") {
      const values = track.values.slice();
      const trimmed = trimTrackSamples(track.times, values, 4, 0);

      for (let i = 0; i < trimmed.values.length; i += 4) {
        workingQuaternion.fromArray(trimmed.values, i);
        workingQuaternion.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        lockForwardYaw(workingQuaternion, workingEuler, vrmBoneName, state);
        workingQuaternion.toArray(trimmed.values, i);
      }

      mirrorVrm0Quaternion(trimmed.values, vrm);
      tracks.push(new THREE.QuaternionKeyframeTrack(`${vrmNode.name}.quaternion`, trimmed.times, trimmed.values));
    }

    if (track instanceof THREE.VectorKeyframeTrack && parsed.property === "position" && vrmBoneName === "hips") {
      continue;
    }
  }

  if (!tracks.length) throw new Error(`No VRM tracks retargeted for ${state}`);
  return new THREE.AnimationClip(`vrm-${state}`, sourceClip.duration, tracks);
}

function lockForwardYaw(quaternion, euler, vrmBoneName, state) {
  if (!FORWARD_LOCK_BONES.has(vrmBoneName)) return;

  euler.setFromQuaternion(quaternion, "YXZ");
  euler.y = 0;

  if (state === "speaking" && (vrmBoneName === "head" || vrmBoneName === "neck")) {
    euler.z *= 0.35;
  }

  quaternion.setFromEuler(euler);
}

function getVrmBone(vrm, boneName) {
  return vrm.humanoid?.getNormalizedBoneNode?.(boneName) ?? null;
}

function parseTrackName(trackName) {
  const [rawBoneName, property] = trackName.split(".");
  if (!rawBoneName || !property) return null;
  return { boneName: rawBoneName, property };
}

function normalizeSourceBoneName(rawName) {
  const localName = rawName.includes(":") ? rawName.split(":").pop() : rawName;
  if (SOURCE_TO_VRM[localName]) return localName;
  if (localName.startsWith("mixamorig")) return localName;
  return `mixamorig${localName}`;
}

function isMixamoSourceBone(rawName) {
  const localName = rawName.includes(":") ? rawName.split(":").pop() : rawName;
  return localName.startsWith("mixamorig");
}

function trimTrackSamples(times, values, itemSize, startSeconds) {
  if (!startSeconds) return { times: times.slice(), values };

  const startIndex = Math.min(
    times.length - 1,
    Math.max(0, times.findIndex(time => time > startSeconds)),
  );
  if (startIndex <= 0) return { times: times.slice(), values };

  const trimmedTimes = times.slice(startIndex).map(time => time - times[startIndex]);
  const trimmedValues = values.slice(startIndex * itemSize);
  return { times: trimmedTimes, values: trimmedValues };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function findSourceBone(root, ...names) {
  for (const name of names) {
    const localName = name.includes(":") ? name.split(":").pop() : name;
    const normalized = normalizeSourceBoneName(name);
    const found = root.getObjectByName(name) ?? root.getObjectByName(localName) ?? root.getObjectByName(normalized);
    if (found) return found;
  }
  return null;
}

function mirrorVrm0Quaternion(values, vrm) {
  if (!isVrm0(vrm)) return;
  for (let i = 0; i < values.length; i += 4) {
    values[i] *= -1;
    values[i + 2] *= -1;
  }
}

function isVrm0(vrm) {
  return vrm.meta?.metaVersion === "0";
}
