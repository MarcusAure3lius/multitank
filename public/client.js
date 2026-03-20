import {
  ANIMATION_ACTIONS,
  ASSET_BUNDLE_VERSION,
  COMBAT_EVENT_ACTIONS,
  EVENT_TYPES,
  GAME_BUILD_VERSION,
  GAME_CONFIG,
  MATCH_PHASES,
  MESSAGE_TYPES,
  SOUND_CUES,
  STATUS_EFFECTS,
  VFX_CUES,
  deserializePacket,
  normalizeAngle,
  serializePacket
} from "/shared/protocol.js";

const canvas = document.getElementById("game");
const context = canvas.getContext("2d");
const devBadgeElement = document.getElementById("dev-badge");
const diagnosticBannerElement = document.getElementById("diagnostic-banner");
const statusElement = document.getElementById("status");
const latencyElement = document.getElementById("latency");
const matchStatusElement = document.getElementById("match-status");
const roomLabelElement = document.getElementById("room-label");
const playerLabelElement = document.getElementById("player-label");
const profileLabelElement = document.getElementById("profile-label");
const roundLabelElement = document.getElementById("round-label");
const scoreboardElement = document.getElementById("scoreboard");
const killFeedElement = document.getElementById("kill-feed");
const joinForm = document.getElementById("join-form");
const joinMatchButton = document.getElementById("join-match-button");
const readyButton = document.getElementById("ready-button");
const createRoomButton = document.getElementById("create-room-button");
const nameInput = document.getElementById("name-input");
const roomInput = document.getElementById("room-input");
const spectateInput = document.getElementById("spectate-input");
const lobbyRoomCodeElement = document.getElementById("lobby-room-code");
const lobbySummaryElement = document.getElementById("lobby-summary");
const mapSelect = document.getElementById("map-select");
const teamSelect = document.getElementById("team-select");
const classSelect = document.getElementById("class-select");
const roomBrowserElement = document.getElementById("room-browser");
const refreshRoomsButton = document.getElementById("refresh-rooms-button");
const resultsCard = document.getElementById("results-card");
const resultsSummaryElement = document.getElementById("results-summary");
const resultsListElement = document.getElementById("results-list");

const STORAGE_KEYS = {
  name: "multitank.name",
  room: "multitank.room",
  profileId: "multitank.profileId",
  spectate: "multitank.spectate",
  authToken: "multitank.authToken"
};

const NETWORK_RENDER = Object.freeze({
  interpolationBackTimeMs: 100,
  maxExtrapolationMs: 180,
  historyLimit: 24,
  playerTeleportDistance: 220,
  bulletTeleportDistance: 140,
  snapDistance: 120,
  remoteSmoothing: 0.38,
  clockSmoothing: 0.12
});

const CLIENT_TICK = Object.freeze({
  rate: GAME_CONFIG.serverTickRate,
  fixedDeltaSeconds: 1 / GAME_CONFIG.serverTickRate
});

const WORLD_RENDER = Object.freeze({
  gridSize: 64,
  cameraFollow: 0.14
});

const players = new Map();
const bullets = new Map();
const predictedProjectiles = new Map();
const combatEffects = [];
const killFeedEntries = [];
const keys = new Set();
const pendingInputs = [];
const pendingReliableMessages = new Map();
const stateChunks = new Map();
const processedEventIds = new Set();
const processedEventOrder = [];
const camera = {
  x: 0,
  y: 0
};
let cameraZoom = 1;

let socket = null;
let localPlayerId = null;
let profileId = getOrCreateProfileId();
let authToken = localStorage.getItem(STORAGE_KEYS.authToken) ?? null;
let currentRoomId = null;
let latestMatch = null;
let latestLobby = null;
let latestObjective = null;
let latestLeaderboard = [];
let latestYou = null;
let latestInterestStats = null;
let lastSnapshotAt = 0;
let lastStatePacketAt = 0;
let lastAppliedSnapshotSeq = 0;
let lastSimulationTick = 0;
let lastSnapshotTick = 0;
let clientSimulationTick = 0;
let reconnectTimer = null;
let reconnectAttempts = 0;
let serverTimeOffset = 0;
let lastResyncRequestAt = 0;
let lastStallWarningAt = 0;
let lastPointerWorldPosition = {
  x: GAME_CONFIG.world.width / 2,
  y: GAME_CONFIG.world.height / 2
};
let lastRenderFrameAt = performance.now();
let cameraNeedsSnap = true;
let hasSeenLocalPlayerSnapshot = false;
let joinInProgress = false;
let nextInputSeq = 1;
let nextReliableMessageId = 1;
let roomBrowserRefreshInFlight = false;
let audioContext = null;
const assetState = {
  manifest: null,
  images: new Map(),
  failedImages: new Set(),
  loadingImages: new Map()
};

const currentUrl = new URL(window.location.href);
const initialRoomFromUrl = currentUrl.searchParams.get("room");
const debugUiEnabled = currentUrl.searchParams.get("debug") === "1";
nameInput.value = localStorage.getItem(STORAGE_KEYS.name) ?? nameInput.value;
roomInput.value = initialRoomFromUrl ?? localStorage.getItem(STORAGE_KEYS.room) ?? roomInput.value;
spectateInput.checked = localStorage.getItem(STORAGE_KEYS.spectate) === "1";
profileLabelElement.textContent = profileId.slice(0, 8);

populateLobbySelects();
refreshLobbyUi();
updateSessionChrome();
updateLocalDevBadge();
void refreshDiscoveredAssets();

function getOrCreateProfileId() {
  const stored = localStorage.getItem(STORAGE_KEYS.profileId);
  if (stored) {
    return stored;
  }

  const created = crypto.randomUUID().replace(/-/g, "");
  localStorage.setItem(STORAGE_KEYS.profileId, created);
  return created;
}

function setStatus(text) {
  statusElement.textContent = text;
  updateDiagnosticBanner();
}

function updateLocalDevBadge() {
  if (!devBadgeElement) {
    return;
  }

  const hostname = window.location.hostname;
  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";

  devBadgeElement.hidden = !isLocalHost || !debugUiEnabled;
  if (isLocalHost && debugUiEnabled) {
    devBadgeElement.textContent = `LOCAL DEV ${window.location.port ? `:${window.location.port}` : ""}`;
  }
}

function collectManifestImagePaths(node, bucket = []) {
  if (typeof node === "string" && node) {
    bucket.push(node);
    return bucket;
  }

  if (!node || typeof node !== "object") {
    return bucket;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectManifestImagePaths(entry, bucket);
    }
    return bucket;
  }

  for (const value of Object.values(node)) {
    collectManifestImagePaths(value, bucket);
  }

  return bucket;
}

function loadDiscoveredImage(src) {
  if (!src || assetState.images.has(src) || assetState.failedImages.has(src)) {
    return null;
  }

  const existing = assetState.loadingImages.get(src);
  if (existing) {
    return existing;
  }

  const image = new Image();
  image.decoding = "async";

  const promise = new Promise((resolve) => {
    image.addEventListener("load", () => {
      assetState.images.set(src, image);
      assetState.loadingImages.delete(src);
      resolve(image);
    });

    image.addEventListener("error", () => {
      assetState.failedImages.add(src);
      assetState.loadingImages.delete(src);
      resolve(null);
    });
  });

  assetState.loadingImages.set(src, promise);
  image.src = src;
  return promise;
}

function preloadManifestImages(manifest) {
  const imagePaths = Array.from(new Set(collectManifestImagePaths(manifest?.images ?? {})));
  for (const src of imagePaths) {
    loadDiscoveredImage(src);
  }
}

async function refreshDiscoveredAssets() {
  try {
    const response = await fetch("/assets/manifest.json", {
      cache: "no-store"
    });

    if (!response.ok) {
      return;
    }

    const manifest = await response.json();
    assetState.manifest = manifest;
    preloadManifestImages(manifest);
  } catch (error) {
    // Asset discovery is optional. The canvas renderer has full procedural fallbacks.
  }
}

function getManifestImagePath(...segments) {
  let current = assetState.manifest?.images ?? null;

  for (const segment of segments) {
    current = current?.[segment];
  }

  return typeof current === "string" && current ? current : null;
}

function getLoadedImageByPath(src) {
  return src ? assetState.images.get(src) ?? null : null;
}

function getLoadedWorldImage(slot) {
  return getLoadedImageByPath(getManifestImagePath("world", slot));
}

function getResolvedTankImagePath(player, part) {
  const partKey = part === "turret" ? "turrets" : "hulls";
  const manifest = assetState.manifest?.images?.tanks?.[partKey];
  if (!manifest) {
    return null;
  }

  const classId = typeof player?.classId === "string" && manifest[player.classId] ? player.classId : null;
  const classManifest = classId ? manifest[classId] : null;
  const teamId = typeof player?.teamId === "string" ? player.teamId : "neutral";

  return (
    classManifest?.[teamId] ??
    classManifest?.default ??
    manifest.default ??
    null
  );
}

function getLoadedTankImage(player, part) {
  return getLoadedImageByPath(getResolvedTankImagePath(player, part));
}

function hasPlayableSession() {
  const localPlayer = getLocalPlayer();
  return Boolean(currentRoomId && hasSeenLocalPlayerSnapshot && localPlayer && !localPlayer.isSpectator);
}

function updateSessionChrome() {
  document.body.classList.toggle("in-session", hasPlayableSession());
  document.body.classList.toggle("joining-session", false);
  syncJoinMatchButton();
  updateDiagnosticBanner();
}

function updateDiagnosticBanner() {
  if (!diagnosticBannerElement) {
    return;
  }

  const localPlayer = getLocalPlayer();
  const snapshotState = hasSeenLocalPlayerSnapshot ? "yes" : "no";
  const spectatorState = latestYou?.isSpectator ?? localPlayer?.isSpectator ?? false;
  const playerSummary = localPlayer
    ? `${localPlayer.name} @ ${Math.round(getPlayerVisualX(localPlayer))}, ${Math.round(getPlayerVisualY(localPlayer))}`
    : (localPlayerId ? `awaiting state for ${localPlayerId}` : "none");

  diagnosticBannerElement.hidden = false;
  diagnosticBannerElement.textContent =
    `Status: ${statusElement.textContent}\n` +
    `Room: ${currentRoomId ?? "-"} | Snapshot: ${snapshotState} | Players: ${players.size}\n` +
    `Local Player: ${playerSummary}\n` +
    `Playable: ${hasPlayableSession() ? "yes" : "no"} | Spectator: ${spectatorState ? "yes" : "no"} | Zoom: ${cameraZoom.toFixed(2)}`;
}

function setReadyButton(isReady, options = {}) {
  const { disabled = false, label = null } = options;
  readyButton.disabled = disabled;
  readyButton.textContent = label ?? (isReady ? "Ready: On" : "Ready Up");
}

function populateSelectOptions(select, options) {
  select.replaceChildren();

  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.name;
    select.append(element);
  }
}

function populateLobbySelects() {
  populateSelectOptions(mapSelect, GAME_CONFIG.lobby.maps);
  populateSelectOptions(teamSelect, GAME_CONFIG.lobby.teams);
  populateSelectOptions(classSelect, GAME_CONFIG.lobby.classes);
}

function createRoomCode() {
  return crypto.randomUUID().slice(0, 8).toLowerCase();
}

function createCommanderName() {
  return `Cmdr-${profileId.slice(0, 4).toUpperCase()}`;
}

function syncJoinMatchButton() {
  if (!joinMatchButton) {
    return;
  }

  joinMatchButton.disabled = joinInProgress || Boolean(currentRoomId);
  joinMatchButton.textContent = joinInProgress ? "Joining..." : "Join Match";
}

function ensureQuickJoinDefaults() {
  if (!nameInput.value.trim()) {
    nameInput.value = createCommanderName();
  }

  spectateInput.checked = false;
  mapSelect.value = GAME_CONFIG.lobby.maps[0].id;
  teamSelect.value = GAME_CONFIG.lobby.teams[0].id;
  classSelect.value = GAME_CONFIG.lobby.classes[0].id;
}

function compareRoomsForQuickJoin(left, right) {
  return (
    (right.activePlayers ?? 0) - (left.activePlayers ?? 0) ||
    Number(Boolean(right.canJoinAsPlayer)) - Number(Boolean(left.canJoinAsPlayer)) ||
    String(right.lastActivityAt ?? "").localeCompare(String(left.lastActivityAt ?? "")) ||
    String(left.roomCode ?? "").localeCompare(String(right.roomCode ?? ""))
  );
}

async function resolveQuickJoinRoomCode() {
  const response = await fetch("/rooms", {
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Room lookup failed with ${response.status}`);
  }

  const payload = await response.json();
  const joinableRooms = (payload.rooms ?? [])
    .filter((room) => room?.canJoinAsPlayer)
    .sort(compareRoomsForQuickJoin);

  return joinableRooms[0]?.roomCode ?? createRoomCode();
}

async function startQuickJoin() {
  if (joinInProgress || currentRoomId) {
    return;
  }

  ensureQuickJoinDefaults();
  setStatus("Finding match...");
  matchStatusElement.textContent = "Finding an open arena";

  try {
    roomInput.value = await resolveQuickJoinRoomCode();
  } catch (error) {
    roomInput.value = createRoomCode();
  }

  setStatus("Joining match...");
  matchStatusElement.textContent = "Joining arena";
  connect();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function ensureAudioContext() {
  if (audioContext) {
    return audioContext;
  }

  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  try {
    audioContext = new AudioContextClass();
  } catch (error) {
    return null;
  }

  return audioContext;
}

function playSoundCue(cue) {
  if (!cue || cue === SOUND_CUES.NONE) {
    return;
  }

  const contextRef = ensureAudioContext();
  if (!contextRef) {
    return;
  }

  if (contextRef.state === "suspended") {
    contextRef.resume().catch(() => {});
  }

  const cueMap = {
    [SOUND_CUES.HIT]: { frequency: 220, duration: 0.06, gain: 0.018, type: "triangle" },
    [SOUND_CUES.CRIT]: { frequency: 420, duration: 0.08, gain: 0.028, type: "square" },
    [SOUND_CUES.KILL]: { frequency: 150, duration: 0.14, gain: 0.035, type: "sawtooth" },
    [SOUND_CUES.ASSIST]: { frequency: 310, duration: 0.1, gain: 0.024, type: "triangle" },
    [SOUND_CUES.STUN]: { frequency: 180, duration: 0.12, gain: 0.02, type: "square" },
    [SOUND_CUES.ARMOR]: { frequency: 260, duration: 0.05, gain: 0.016, type: "square" }
  };
  const settings = cueMap[cue];
  if (!settings) {
    return;
  }

  const oscillator = contextRef.createOscillator();
  const gainNode = contextRef.createGain();
  oscillator.type = settings.type;
  oscillator.frequency.setValueAtTime(settings.frequency, contextRef.currentTime);
  gainNode.gain.setValueAtTime(settings.gain, contextRef.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, contextRef.currentTime + settings.duration);
  oscillator.connect(gainNode);
  gainNode.connect(contextRef.destination);
  oscillator.start();
  oscillator.stop(contextRef.currentTime + settings.duration);
}

function renderKillFeed() {
  if (!killFeedElement) {
    return;
  }

  killFeedElement.innerHTML = "";
  for (const entry of killFeedEntries) {
    const item = document.createElement("li");
    item.className = "kill-feed-item";
    item.textContent = entry.text;
    killFeedElement.append(item);
  }
}

function pushKillFeedEntry(text) {
  if (!text) {
    return;
  }

  killFeedEntries.unshift({
    text,
    expiresAt: performance.now() + GAME_CONFIG.combat.assistWindowMs
  });

  while (killFeedEntries.length > 5) {
    killFeedEntries.pop();
  }

  renderKillFeed();
}

function pruneCombatEffects(now = performance.now()) {
  let killFeedChanged = false;
  for (let index = combatEffects.length - 1; index >= 0; index -= 1) {
    if (combatEffects[index].expiresAt <= now) {
      combatEffects.splice(index, 1);
    }
  }

  for (let index = killFeedEntries.length - 1; index >= 0; index -= 1) {
    if (killFeedEntries[index].expiresAt <= now) {
      killFeedEntries.splice(index, 1);
      killFeedChanged = true;
    }
  }

  if (killFeedChanged) {
    renderKillFeed();
  }
}

function pushCombatEffect(effect) {
  if (!effect) {
    return;
  }

  combatEffects.push(effect);
}

function unlockAudio() {
  const contextRef = ensureAudioContext();
  if (contextRef?.state === "suspended") {
    contextRef.resume().catch(() => {});
  }
}

function cancelReconnect() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
}

function scheduleReconnect() {
  if (reconnectTimer !== null || !currentRoomId) {
    return;
  }

  reconnectAttempts += 1;
  setStatus(`Reconnecting (${reconnectAttempts})...`);
  matchStatusElement.textContent = "Trying to recover your match session";

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect({ isReconnect: true });
  }, GAME_CONFIG.session.reconnectRetryMs);
}

function buildSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(serializePacket(payload));
  }
}

function createReliableMessageId(type) {
  return `${type}:${profileId.slice(0, 8)}:${nextReliableMessageId++}`;
}

function clearPendingReliableMessages(type = null) {
  for (const [messageId, entry] of pendingReliableMessages.entries()) {
    if (!type || entry.payload.type === type) {
      pendingReliableMessages.delete(messageId);
    }
  }
}

function queueReliableMessage(payload) {
  if (payload.type === MESSAGE_TYPES.READY || payload.type === MESSAGE_TYPES.RESYNC) {
    clearPendingReliableMessages(MESSAGE_TYPES.READY);
    clearPendingReliableMessages(MESSAGE_TYPES.RESYNC);
  }

  const messageId = payload.messageId ?? createReliableMessageId(payload.type);
  const packet = {
    ...payload,
    messageId
  };

  pendingReliableMessages.set(messageId, {
    payload: packet,
    lastSentAt: 0
  });

  return packet;
}

function sendReliable(payload) {
  const packet = queueReliableMessage(payload);
  const entry = pendingReliableMessages.get(packet.messageId);
  if (!entry) {
    return;
  }

  entry.lastSentAt = Date.now();
  send(packet);
}

function cleanupStaleStateChunks() {
  const oldestUsefulSnapshotSeq = Math.max(0, lastAppliedSnapshotSeq - 2);

  for (const [snapshotSeq] of stateChunks.entries()) {
    if (snapshotSeq <= oldestUsefulSnapshotSeq) {
      stateChunks.delete(snapshotSeq);
    }
  }
}

function requestLifecycleResync(reason) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !currentRoomId) {
    return;
  }

  const now = Date.now();
  if (now - lastResyncRequestAt < 250) {
    return;
  }

  lastResyncRequestAt = now;
  stateChunks.clear();
  sendReliable({
    type: MESSAGE_TYPES.RESYNC,
    snapshotSeq: lastAppliedSnapshotSeq,
    reason
  });
}

function lerp(current, target, amount) {
  return current + (target - current) * amount;
}

function lerpAngle(current, target, amount) {
  let delta = target - current;

  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }

  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }

  return current + delta * amount;
}

function estimateServerTime(frameAt = performance.now()) {
  return frameAt + serverTimeOffset;
}

function syncServerClock(serverTime, frameAt = performance.now()) {
  if (!Number.isFinite(serverTime)) {
    return;
  }

  const targetOffset = serverTime - frameAt;
  serverTimeOffset = lastAppliedSnapshotSeq === 0
    ? targetOffset
    : lerp(serverTimeOffset, targetOffset, NETWORK_RENDER.clockSmoothing);
}

function interpolateAngle(start, end, amount) {
  return lerpAngle(start, end, amount);
}

function lerpWrappedUnit(current, target, amount) {
  let delta = target - current;
  if (delta > 0.5) {
    delta -= 1;
  } else if (delta < -0.5) {
    delta += 1;
  }

  return (current + delta * amount + 1) % 1;
}

function rememberProcessedEvent(eventId) {
  if (!eventId || processedEventIds.has(eventId)) {
    return false;
  }

  processedEventIds.add(eventId);
  processedEventOrder.push(eventId);

  while (processedEventOrder.length > GAME_CONFIG.network.maxRecentEvents * 6) {
    const oldestId = processedEventOrder.shift();
    processedEventIds.delete(oldestId);
  }

  return true;
}

function applyReplicatedAnimationState(entity, animation, options = {}) {
  if (!entity || !animation) {
    return;
  }

  const previousAnimation = entity.animation ?? null;
  const shouldSnap =
    Boolean(options.initial) ||
    !previousAnimation ||
    animation.eventSeq !== previousAnimation.eventSeq ||
    animation.overlayAction !== previousAnimation.overlayAction;

  entity.animation = { ...animation };
  entity.animationCorrectionFrames = shouldSnap ? 3 : Math.max(0, entity.animationCorrectionFrames ?? 0);

  if (shouldSnap || entity.motionBlend === undefined) {
    entity.motionBlend = animation.moveBlend ?? 0;
    entity.trackPhase = animation.trackPhase ?? 0;
    entity.visualAimOffset = animation.aimOffset ?? 0;
    entity.visualUpperBodySync = animation.upperBodySync ?? 0;
    entity.visualReloadFraction = animation.reloadFraction ?? 0;
  }
}

function triggerAnimationEvent(event) {
  const player = players.get(event?.playerId);
  if (!player) {
    return;
  }

  const now = performance.now();
  applyReplicatedAnimationState(player, event.animation, { initial: false });

  switch (event.action) {
    case ANIMATION_ACTIONS.FIRE:
      player.muzzleFlashUntil = now + 90;
      player.predictedRecoil = Math.max(player.predictedRecoil ?? 0, 1);
      break;
    case ANIMATION_ACTIONS.HIT:
      player.hitFlashUntil = now + 180;
      player.hitFlashStrength = 1;
      break;
    case ANIMATION_ACTIONS.SPAWN:
      player.spawnPulseUntil = now + 520;
      player.spawnPulseStrength = 1;
      break;
    case ANIMATION_ACTIONS.DEATH:
      player.deathPulseUntil = now + 650;
      player.deathPulseStrength = 1;
      break;
    case ANIMATION_ACTIONS.EMOTE:
      if (event.emoteId) {
        player.emoteId = event.emoteId;
        player.emoteUntil = now + 1500;
      }
      break;
    default:
      break;
  }
}

function triggerCombatEvent(event) {
  const now = performance.now();
  const attacker = event?.attackerId ? players.get(event.attackerId) : null;
  const target = event?.targetId ? players.get(event.targetId) : null;
  const localInvolved =
    latestYou?.isSpectator ||
    event?.attackerId === localPlayerId ||
    event?.targetId === localPlayerId ||
    (event?.assistantIds ?? []).includes(localPlayerId);

  if (target) {
    target.lastCombatEventAt = now;
    if (event.action === COMBAT_EVENT_ACTIONS.DAMAGE) {
      target.hitFlashUntil = Math.max(target.hitFlashUntil ?? 0, now + 180);
      target.hitFlashStrength = 1;
    }

    if (event.statusEffect === STATUS_EFFECTS.STUN && (event.statusDurationMs ?? 0) > 0) {
      target.stunWaveUntil = now + Math.min(900, event.statusDurationMs);
    }
  }

  if (attacker && event.action === COMBAT_EVENT_ACTIONS.KILL) {
    attacker.killBurstUntil = now + 500;
  }

  if (event.vfxCue && event.vfxCue !== VFX_CUES.NONE) {
    const anchor = target ?? attacker;
    if (anchor) {
      const color =
        event.vfxCue === VFX_CUES.CRIT_BURST
          ? "#ffd166"
          : event.vfxCue === VFX_CUES.KILL_BURST
            ? "#ef476f"
            : event.vfxCue === VFX_CUES.ASSIST_RING
              ? "#70c1b3"
              : "#8ecae6";
      pushCombatEffect({
        x: getPlayerVisualX(anchor),
        y: getPlayerVisualY(anchor),
        text:
          event.action === COMBAT_EVENT_ACTIONS.DAMAGE
            ? `${event.isCritical ? "CRIT " : ""}${event.damage ?? 0}`
            : event.action === COMBAT_EVENT_ACTIONS.KILL
              ? "KILL"
              : event.action === COMBAT_EVENT_ACTIONS.ASSIST
                ? "ASSIST"
                : event.statusEffect === STATUS_EFFECTS.STUN
                  ? "STUN"
                  : "",
        color,
        expiresAt: now + 700,
        rise: 22 + (event.isCritical ? 10 : 0),
        ring: event.vfxCue
      });
    }
  }

  if (event.action === COMBAT_EVENT_ACTIONS.KILL) {
    const assistants = (event.assistantNames ?? []).length > 0 ? ` + ${event.assistantNames.join(", ")}` : "";
    pushKillFeedEntry(
      event.message || `${event.attackerName ?? "Unknown"} eliminated ${event.targetName ?? "Unknown"}${assistants}`
    );
  } else if (event.action === COMBAT_EVENT_ACTIONS.ASSIST && localInvolved) {
    pushKillFeedEntry(event.message || `${event.attackerName ?? "Unknown"} assisted`);
  }

  if (localInvolved) {
    playSoundCue(event.soundCue);
  }
}

function consumeServerEvents(events) {
  for (const event of events ?? []) {
    if (!rememberProcessedEvent(event?.id)) {
      continue;
    }

    if (event.type === EVENT_TYPES.ANIMATION) {
      triggerAnimationEvent(event);
      continue;
    }

    if (event.type === EVENT_TYPES.COMBAT) {
      triggerCombatEvent(event);
      continue;
    }

    if (event.type === EVENT_TYPES.SPAWN) {
      triggerAnimationEvent({
        playerId: event.playerId,
        action: ANIMATION_ACTIONS.SPAWN,
        animation: players.get(event.playerId)?.animation ?? null
      });
    }
  }
}

function getPointerWorldPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  const normalizedX = (event.clientX - bounds.left) / bounds.width;
  const normalizedY = (event.clientY - bounds.top) / bounds.height;
  const visibleWidth = canvas.width / cameraZoom;
  const visibleHeight = canvas.height / cameraZoom;

  return {
    x: clamp(
      camera.x + normalizedX * visibleWidth,
      0,
      GAME_CONFIG.world.width
    ),
    y: clamp(
      camera.y + normalizedY * visibleHeight,
      0,
      GAME_CONFIG.world.height
    )
  };
}

function getLocalPlayer() {
  return players.get(localPlayerId) ?? null;
}

function resizeCanvas() {
  const nextWidth = Math.max(640, Math.round(window.innerWidth));
  const nextHeight = Math.max(360, Math.round(window.innerHeight));

  if (canvas.width === nextWidth && canvas.height === nextHeight) {
    return;
  }

  canvas.width = nextWidth;
  canvas.height = nextHeight;
  cameraNeedsSnap = true;
}

function getVisibleViewportSize() {
  return {
    width: canvas.width / cameraZoom,
    height: canvas.height / cameraZoom
  };
}

function clampCameraPosition(x, y) {
  const viewport = getVisibleViewportSize();
  return {
    x: clamp(x, 0, Math.max(0, GAME_CONFIG.world.width - viewport.width)),
    y: clamp(y, 0, Math.max(0, GAME_CONFIG.world.height - viewport.height))
  };
}

function getCameraFocusTarget() {
  const localPlayer = getLocalPlayer();

  if (localPlayer && !localPlayer.isSpectator) {
    return {
      x: getPlayerVisualX(localPlayer),
      y: getPlayerVisualY(localPlayer)
    };
  }

  if (latestObjective) {
    return {
      x: latestObjective.x,
      y: latestObjective.y
    };
  }

  return {
    x: GAME_CONFIG.world.width / 2,
    y: GAME_CONFIG.world.height / 2
  };
}

function updateCamera() {
  const focus = getCameraFocusTarget();
  const viewport = getVisibleViewportSize();
  const target = clampCameraPosition(focus.x - viewport.width / 2, focus.y - viewport.height / 2);

  if (cameraNeedsSnap) {
    camera.x = target.x;
    camera.y = target.y;
    cameraNeedsSnap = false;
    return;
  }

  camera.x = lerp(camera.x, target.x, WORLD_RENDER.cameraFollow);
  camera.y = lerp(camera.y, target.y, WORLD_RENDER.cameraFollow);
  const clamped = clampCameraPosition(camera.x, camera.y);
  camera.x = clamped.x;
  camera.y = clamped.y;
}

function getPlayerVisualX(player) {
  return player?.displayX ?? player?.renderX ?? player?.x ?? 0;
}

function getPlayerVisualY(player) {
  return player?.displayY ?? player?.renderY ?? player?.y ?? 0;
}

function getPlayerVisualAngle(player) {
  return player?.displayAngle ?? player?.renderAngle ?? player?.angle ?? 0;
}

function getPlayerVisualTurretAngle(player) {
  return player?.displayTurretAngle ?? player?.renderTurretAngle ?? player?.turretAngle ?? 0;
}

function isCombatPhase(phase) {
  return phase === MATCH_PHASES.LIVE_ROUND || phase === MATCH_PHASES.OVERTIME;
}

function isMovementPhase(phase) {
  return phase === MATCH_PHASES.WAITING || phase === MATCH_PHASES.WARMUP || isCombatPhase(phase);
}

function isResultsPhase(phase) {
  return phase === MATCH_PHASES.RESULTS;
}

function shouldShowResultsPhase(phase) {
  return phase === MATCH_PHASES.ROUND_END || phase === MATCH_PHASES.RESULTS;
}

function canSimulateLocalPlayer() {
  const localPlayer = getLocalPlayer();
  return isMovementPhase(latestMatch?.phase) && localPlayer && !localPlayer.isSpectator && !localPlayer.afk;
}

function canPredictLocalShots() {
  const localPlayer = getLocalPlayer();
  return isCombatPhase(latestMatch?.phase) && localPlayer && !localPlayer.isSpectator && !localPlayer.afk;
}

function refreshSessionUi(localPlayer = getLocalPlayer(), you = null) {
  const isSpectator = you?.isSpectator ?? localPlayer?.isSpectator ?? false;
  const isReady = you?.ready ?? localPlayer?.ready ?? false;
  const isAfk = you?.afk ?? localPlayer?.afk ?? false;
  const queuedForSlot = you?.queuedForSlot ?? localPlayer?.queuedForSlot ?? false;
  const canReady =
    Boolean(localPlayer || you) &&
    !isSpectator &&
    (latestMatch?.phase === MATCH_PHASES.WAITING || isResultsPhase(latestMatch?.phase));

  if (isSpectator) {
    setReadyButton(false, {
      disabled: true,
      label: queuedForSlot ? "Queued For Slot" : "Spectating"
    });
    return;
  }

  if (isAfk && latestMatch?.phase === MATCH_PHASES.WAITING) {
    setReadyButton(false, {
      disabled: false,
      label: "AFK Reset Ready"
    });
    return;
  }

  if (isResultsPhase(latestMatch?.phase)) {
    setReadyButton(isReady, {
      disabled: !canReady,
      label: isReady ? "Rematch: Ready" : "Vote Rematch"
    });
    return;
  }

  setReadyButton(isReady, {
    disabled: !canReady
  });
}

function refreshLobbyUi(localPlayer = getLocalPlayer(), you = latestYou) {
  if (!currentRoomId && !latestLobby) {
    roomLabelElement.textContent = roomInput.value || "-";
    lobbyRoomCodeElement.textContent = `Room code: ${roomInput.value || "-"}`;
    lobbySummaryElement.textContent = "Connect deploys you straight into the arena using these room and loadout defaults.";
    mapSelect.value = GAME_CONFIG.lobby.maps[0].id;
    teamSelect.value = GAME_CONFIG.lobby.teams[0].id;
    classSelect.value = GAME_CONFIG.lobby.classes[0].id;
    mapSelect.disabled = true;
    teamSelect.disabled = true;
    classSelect.disabled = true;
    resultsCard.hidden = true;
    return;
  }

  const roomCode = latestLobby?.roomCode ?? currentRoomId ?? roomInput.value ?? "-";
  const mapName = latestLobby?.mapName ?? GAME_CONFIG.lobby.maps[0].name;
  const ownerName = latestLobby?.ownerName ?? "No owner yet";
  const activePlayers = latestLobby?.activePlayers ?? 0;
  const spectators = latestLobby?.spectators ?? 0;
  const rematchVotes = latestLobby?.rematchVotes ?? 0;
  const isSpectator = you?.isSpectator ?? localPlayer?.isSpectator ?? false;
  const isRoomOwner = you?.isRoomOwner ?? false;
  const playerTeamId = you?.teamId ?? localPlayer?.teamId ?? GAME_CONFIG.lobby.teams[0].id;
  const playerClassId = you?.classId ?? localPlayer?.classId ?? GAME_CONFIG.lobby.classes[0].id;
  const phase = latestMatch?.phase ?? MATCH_PHASES.WAITING;
  const canEditMap =
    Boolean(currentRoomId) &&
    isRoomOwner &&
    (phase === MATCH_PHASES.WAITING || isResultsPhase(phase));
  const canEditLoadout = Boolean(currentRoomId) && Boolean(you || localPlayer);
  const stageHint =
    phase === MATCH_PHASES.WAITING
      ? " | staging arena live"
      : phase === MATCH_PHASES.WARMUP
        ? " | warmup drive active"
        : "";

  lobbyRoomCodeElement.textContent = `Room code: ${roomCode}`;
  lobbySummaryElement.textContent =
    `${ownerName} owns this room | ${mapName} | ${activePlayers}/${GAME_CONFIG.session.maxHumanPlayersPerRoom} active | ${spectators} spectators` +
    stageHint +
    (isResultsPhase(phase) && activePlayers > 0
      ? ` | ${rematchVotes}/${activePlayers} rematch votes`
      : "");
  roomLabelElement.textContent = `${roomCode}${latestLobby ? ` | ${latestLobby.mapName}` : ""}`;

  mapSelect.value = latestLobby?.mapId ?? GAME_CONFIG.lobby.maps[0].id;
  teamSelect.value = playerTeamId;
  classSelect.value = playerClassId;

  mapSelect.disabled = !canEditMap;
  teamSelect.disabled = !canEditLoadout;
  classSelect.disabled = !canEditLoadout;

  resultsCard.hidden = !shouldShowResultsPhase(latestMatch?.phase);
  resultsListElement.replaceChildren();

  if (!shouldShowResultsPhase(latestMatch?.phase)) {
    return;
  }

  const winnerName = latestMatch?.winnerName ?? "No winner";
  const voteTarget = Math.max(1, activePlayers);
  resultsSummaryElement.textContent =
    latestMatch?.phase === MATCH_PHASES.ROUND_END
      ? `${winnerName} | locking round results`
      : `${winnerName} | rematch votes ${rematchVotes}/${voteTarget}`;

  for (const player of latestLeaderboard) {
    if (player.isSpectator) {
      continue;
    }

    const item = document.createElement("li");
    item.innerHTML = `<div class="results-title">${escapeHtml(player.name)}</div><div class="results-meta">${escapeHtml(player.teamId)} / ${escapeHtml(player.classId)} | ${player.score} score | ${player.assists ?? 0} assists | ${player.deaths} deaths | ${player.credits} credits${player.ready ? " | ready" : ""}</div>`;
    resultsListElement.append(item);
  }
}

function renderRoomBrowser(rooms) {
  roomBrowserElement.replaceChildren();

  if ((rooms?.length ?? 0) === 0) {
    const empty = document.createElement("li");
    empty.className = "room-browser-item";
    empty.textContent = "No public rooms yet. Create one and it will appear here.";
    roomBrowserElement.append(empty);
    return;
  }

  for (const room of rooms) {
    const item = document.createElement("li");
    item.className = "room-browser-item";

    const meta = document.createElement("div");
    meta.className = "room-browser-meta";
    meta.innerHTML = `<div class="room-browser-title">${escapeHtml(room.roomCode)}</div><div>${escapeHtml(room.mapName)} | ${escapeHtml(room.phase)}</div><div>${room.activePlayers}/${room.maxPlayers} active | ${room.spectators} spectators</div>`;

    const actions = document.createElement("div");
    actions.className = "room-browser-actions";

    const joinButton = document.createElement("button");
    joinButton.type = "button";
    joinButton.textContent = "Join";
    joinButton.disabled = !room.canJoinAsPlayer;
    joinButton.addEventListener("click", () => {
      roomInput.value = room.roomCode;
      spectateInput.checked = false;
      connect();
    });

    const watchButton = document.createElement("button");
    watchButton.type = "button";
    watchButton.className = "secondary";
    watchButton.textContent = "Watch";
    watchButton.disabled = !room.canJoinAsSpectator;
    watchButton.addEventListener("click", () => {
      roomInput.value = room.roomCode;
      spectateInput.checked = true;
      connect();
    });

    actions.append(joinButton, watchButton);
    item.append(meta, actions);
    roomBrowserElement.append(item);
  }
}

async function refreshRoomBrowser() {
  if (roomBrowserRefreshInFlight) {
    return;
  }

  roomBrowserRefreshInFlight = true;

  try {
    const response = await fetch("/rooms", {
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Room browser request failed with ${response.status}`);
    }

    const payload = await response.json();
    renderRoomBrowser(payload.rooms ?? []);
  } catch (error) {
    const item = document.createElement("li");
    item.className = "room-browser-item";
    item.textContent = "Room browser unavailable right now.";
    roomBrowserElement.replaceChildren(item);
  } finally {
    roomBrowserRefreshInFlight = false;
  }
}

function circleIntersectsRect(x, y, radius, rect) {
  const nearestX = Math.max(rect.x, Math.min(rect.x + rect.width, x));
  const nearestY = Math.max(rect.y, Math.min(rect.y + rect.height, y));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

function collidesWithObstacle(x, y, radius = GAME_CONFIG.tank.radius) {
  return GAME_CONFIG.world.obstacles.some((obstacle) => circleIntersectsRect(x, y, radius, obstacle));
}

function getTeleportDistanceForKind(kind) {
  return kind === "bullet" ? NETWORK_RENDER.bulletTeleportDistance : NETWORK_RENDER.playerTeleportDistance;
}

function ensureNetworkHistory(entity) {
  if (!Array.isArray(entity.networkHistory)) {
    entity.networkHistory = [];
  }

  return entity.networkHistory;
}

function recordNetworkSample(entity, kind, serverTime) {
  if (!Number.isFinite(serverTime) || entity.x === undefined || entity.y === undefined) {
    return;
  }

  const history = ensureNetworkHistory(entity);
  const sample = {
    serverTime,
    x: entity.x,
    y: entity.y,
    angle: entity.angle ?? entity.renderAngle ?? 0,
    turretAngle: entity.turretAngle ?? entity.renderTurretAngle ?? 0
  };
  const lastSample = history[history.length - 1];

  if (lastSample && sample.serverTime <= lastSample.serverTime) {
    return;
  }

  if (lastSample) {
    if (
      sample.x === lastSample.x &&
      sample.y === lastSample.y &&
      sample.angle === lastSample.angle &&
      sample.turretAngle === lastSample.turretAngle
    ) {
      lastSample.serverTime = sample.serverTime;
      return;
    }

    const dx = sample.x - lastSample.x;
    const dy = sample.y - lastSample.y;
    const teleportDistance = getTeleportDistanceForKind(kind);

    if (dx * dx + dy * dy > teleportDistance * teleportDistance) {
      history.length = 0;
      entity.renderX = sample.x;
      entity.renderY = sample.y;
      entity.renderAngle = sample.angle;
      entity.renderTurretAngle = sample.turretAngle;
      entity.displayX = sample.x;
      entity.displayY = sample.y;
      entity.displayAngle = sample.angle;
      entity.displayTurretAngle = sample.turretAngle;
      entity.teleportFrames = 2;
    }
  }

  history.push(sample);

  while (history.length > NETWORK_RENDER.historyLimit) {
    history.shift();
  }
}

function sampleNetworkHistory(entity, kind, renderServerTime) {
  const history = Array.isArray(entity.networkHistory) ? entity.networkHistory : [];
  if (history.length === 0) {
    return null;
  }

  if (history.length === 1 || renderServerTime <= history[0].serverTime) {
    return {
      ...history[0],
      speed: 0
    };
  }

  const latestSample = history[history.length - 1];
  if (renderServerTime >= latestSample.serverTime) {
    const previousSample = history[history.length - 2] ?? latestSample;
    const sampleDeltaMs = Math.max(1, latestSample.serverTime - previousSample.serverTime);
    const extrapolationMs = Math.min(
      NETWORK_RENDER.maxExtrapolationMs,
      Math.max(0, renderServerTime - latestSample.serverTime)
    );
    const velocityX = (latestSample.x - previousSample.x) / sampleDeltaMs;
    const velocityY = (latestSample.y - previousSample.y) / sampleDeltaMs;
    const speed = Math.hypot(velocityX, velocityY) * 1000;

    return {
      x: latestSample.x + velocityX * extrapolationMs,
      y: latestSample.y + velocityY * extrapolationMs,
      angle: latestSample.angle,
      turretAngle: latestSample.turretAngle,
      speed
    };
  }

  for (let index = 1; index < history.length; index += 1) {
    const newer = history[index];
    if (newer.serverTime < renderServerTime) {
      continue;
    }

    const older = history[index - 1];
    const spanMs = Math.max(1, newer.serverTime - older.serverTime);
    const alpha = (renderServerTime - older.serverTime) / spanMs;
    const velocityX = (newer.x - older.x) / spanMs;
    const velocityY = (newer.y - older.y) / spanMs;

    return {
      x: lerp(older.x, newer.x, alpha),
      y: lerp(older.y, newer.y, alpha),
      angle: interpolateAngle(older.angle, newer.angle, alpha),
      turretAngle: interpolateAngle(older.turretAngle, newer.turretAngle, alpha),
      speed: Math.hypot(velocityX, velocityY) * 1000
    };
  }

  return {
    ...latestSample,
    speed: 0
  };
}

function getCapturedInputState() {
  return {
    forward: keys.has("KeyW") || keys.has("ArrowUp"),
    back: keys.has("KeyS") || keys.has("ArrowDown"),
    left: keys.has("KeyA") || keys.has("ArrowLeft"),
    right: keys.has("KeyD") || keys.has("ArrowRight"),
    shoot: keys.has("Space")
  };
}

function simulateTankMovement(state, input, deltaSeconds) {
  const moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const moveY = (input.back ? 1 : 0) - (input.forward ? 1 : 0);
  const moveMagnitude = Math.hypot(moveX, moveY);
  const normalizedMoveX = moveMagnitude > 0 ? moveX / moveMagnitude : 0;
  const normalizedMoveY = moveMagnitude > 0 ? moveY / moveMagnitude : 0;
  const nextAngle = moveMagnitude > 0 ? Math.atan2(normalizedMoveY, normalizedMoveX) : state.angle;
  const moveSpeed = moveMagnitude > 0 ? GAME_CONFIG.tank.speed : 0;
  const nextX = Math.max(
    GAME_CONFIG.world.padding,
    Math.min(GAME_CONFIG.world.width - GAME_CONFIG.world.padding, state.x + normalizedMoveX * moveSpeed * deltaSeconds)
  );
  const nextY = Math.max(
    GAME_CONFIG.world.padding,
    Math.min(GAME_CONFIG.world.height - GAME_CONFIG.world.padding, state.y + normalizedMoveY * moveSpeed * deltaSeconds)
  );
  let resolvedX = state.x;
  let resolvedY = state.y;

  if (!collidesWithObstacle(nextX, state.y)) {
    resolvedX = nextX;
  }

  if (!collidesWithObstacle(resolvedX, nextY)) {
    resolvedY = nextY;
  }

  return {
    x: resolvedX,
    y: resolvedY,
    angle: nextAngle,
    turretAngle: input.turretAngle
  };
}

function spawnPredictedProjectile(localPlayer, inputFrame) {
  const now = performance.now();
  const barrelDistance = GAME_CONFIG.tank.radius + 10;
  const muzzleX = getPlayerVisualX(localPlayer) + Math.cos(inputFrame.turretAngle) * barrelDistance;
  const muzzleY = getPlayerVisualY(localPlayer) + Math.sin(inputFrame.turretAngle) * barrelDistance;

  predictedProjectiles.set(`predicted:${inputFrame.seq}`, {
    id: `predicted:${inputFrame.seq}`,
    ownerId: localPlayerId,
    x: muzzleX,
    y: muzzleY,
    angle: inputFrame.turretAngle,
    renderX: muzzleX,
    renderY: muzzleY,
    bornAt: now,
    expiresAt: now + Math.min(450, GAME_CONFIG.bullet.lifeMs)
  });

  localPlayer.muzzleFlashUntil = now + 90;
  localPlayer.predictedRecoil = 1;
}

function reconcilePredictedProjectile(authoritativeBullet) {
  if (!authoritativeBullet || authoritativeBullet.ownerId !== localPlayerId || predictedProjectiles.size === 0) {
    return;
  }

  let bestMatchId = null;
  let bestDistanceSquared = Infinity;

  for (const projectile of predictedProjectiles.values()) {
    const dx = projectile.x - authoritativeBullet.x;
    const dy = projectile.y - authoritativeBullet.y;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestMatchId = projectile.id;
    }
  }

  if (bestMatchId && bestDistanceSquared <= 140 * 140) {
    predictedProjectiles.delete(bestMatchId);
  }
}

function createInputFrame() {
  const localPlayer = getLocalPlayer();
  const target = lastPointerWorldPosition;
  const seq = nextInputSeq++;
  const capturedInputState = getCapturedInputState();
  const turretAngle = localPlayer
    ? Math.atan2(target.y - getPlayerVisualY(localPlayer), target.x - getPlayerVisualX(localPlayer))
    : 0;

  return {
    seq,
    clientSentAt: Date.now(),
    ...capturedInputState,
    turretAngle
  };
}

function serializeInputFrame(inputFrame) {
  return {
    type: MESSAGE_TYPES.INPUT,
    ...inputFrame
  };
}

function bufferPendingInput(inputFrame) {
  pendingInputs.push(inputFrame);

  const oldestAllowedClientSentAt = Date.now() - GAME_CONFIG.input.maxClientInputAgeMs;
  while (
    pendingInputs.length > GAME_CONFIG.input.maxBufferedInputs ||
    (pendingInputs[0] && pendingInputs[0].clientSentAt < oldestAllowedClientSentAt)
  ) {
    pendingInputs.shift();
  }
}

function updateEntityMap(store, entities, defaults = {}, options = {}) {
  const activeIds = new Set();
  const { kind = "player", serverTime = NaN } = options;

  for (const entity of entities) {
    activeIds.add(entity.id);
    const current = store.get(entity.id) ?? {
      ...defaults,
      renderX: entity.x,
      renderY: entity.y,
      renderAngle: entity.angle ?? 0,
      renderTurretAngle: entity.turretAngle ?? 0,
      displayX: entity.x,
      displayY: entity.y,
      displayAngle: entity.angle ?? 0,
      displayTurretAngle: entity.turretAngle ?? 0
    };

    current.id = entity.id;
    current.targetX = entity.x;
    current.targetY = entity.y;
    current.targetAngle = entity.angle ?? current.targetAngle ?? 0;
    current.targetTurretAngle = entity.turretAngle ?? current.targetTurretAngle ?? 0;

    if (entity.animation) {
      applyReplicatedAnimationState(current, entity.animation, { initial: !store.has(entity.id) });
    }

    Object.assign(current, entity);
    recordNetworkSample(current, kind, serverTime);
    store.set(entity.id, current);
  }

  for (const id of Array.from(store.keys())) {
    if (!activeIds.has(id)) {
      store.delete(id);
    }
  }
}

function upsertEntity(store, entity, defaults = {}, options = {}) {
  if (!entity?.id) {
    return;
  }

  const { kind = "player", serverTime = NaN } = options;
  const current = store.get(entity.id) ?? {
    ...defaults,
    renderX: entity.x ?? 0,
    renderY: entity.y ?? 0,
    renderAngle: entity.angle ?? 0,
    renderTurretAngle: entity.turretAngle ?? 0,
    displayX: entity.x ?? 0,
    displayY: entity.y ?? 0,
    displayAngle: entity.angle ?? 0,
    displayTurretAngle: entity.turretAngle ?? 0
  };

  if (entity.x !== undefined) {
    current.targetX = entity.x;
  }

  if (entity.y !== undefined) {
    current.targetY = entity.y;
  }

  if (entity.angle !== undefined) {
    current.targetAngle = entity.angle;
  }

  if (entity.turretAngle !== undefined) {
    current.targetTurretAngle = entity.turretAngle;
  }

  if (entity.animation) {
    applyReplicatedAnimationState(current, entity.animation, { initial: !store.has(entity.id) });
  }

  Object.assign(current, entity);
  recordNetworkSample(current, kind, serverTime);
  store.set(entity.id, current);
}

function captureCurrentVisualState(player) {
  return {
    x: getPlayerVisualX(player),
    y: getPlayerVisualY(player),
    angle: getPlayerVisualAngle(player),
    turretAngle: getPlayerVisualTurretAngle(player)
  };
}

function applyReplication(replication, serverTime, previousSnapshotSeq) {
  if (!replication) {
    return "fallback";
  }

  if (replication.mode === "delta" && replication.baselineSnapshotSeq !== previousSnapshotSeq) {
    return "resync";
  }

  const fullPlayerIds = replication.mode === "full" ? new Set() : null;
  const fullBulletIds = replication.mode === "full" ? new Set() : null;

  if (replication.mode === "full") {
    if (latestObjective) {
      latestObjective = {
        ...latestObjective
      };
    }
  }

  for (const record of replication.spawns ?? []) {
    if (record.kind === "player") {
      fullPlayerIds?.add(record.id);
      upsertEntity(players, record.state, { alive: true, ready: false }, { kind: "player", serverTime });
      continue;
    }

    if (record.kind === "bullet") {
      reconcilePredictedProjectile(record.state);
      fullBulletIds?.add(record.id);
      upsertEntity(bullets, record.state, {}, { kind: "bullet", serverTime });
      continue;
    }

    if (record.kind === "objective") {
      latestObjective = {
        ...(latestObjective ?? {}),
        ...record.state
      };
    }
  }

  for (const record of replication.updates ?? []) {
    if (record.kind === "player") {
      fullPlayerIds?.add(record.id);
      const previous = players.get(record.id) ?? {};
      upsertEntity(
        players,
        { ...previous, ...record.state, id: record.id },
        { alive: true, ready: false },
        { kind: "player", serverTime }
      );
      continue;
    }

    if (record.kind === "bullet") {
      fullBulletIds?.add(record.id);
      const previous = bullets.get(record.id) ?? {};
      reconcilePredictedProjectile({ ...previous, ...record.state, id: record.id });
      upsertEntity(bullets, { ...previous, ...record.state, id: record.id }, {}, { kind: "bullet", serverTime });
      continue;
    }

    if (record.kind === "objective") {
      latestObjective = {
        ...(latestObjective ?? {}),
        ...record.state
      };
    }
  }

  for (const record of replication.despawns ?? []) {
    if (record.kind === "player") {
      players.delete(record.id);
      continue;
    }

    if (record.kind === "bullet") {
      bullets.delete(record.id);
    }
  }

  if (replication.mode === "full") {
    for (const playerId of Array.from(players.keys())) {
      if (!fullPlayerIds.has(playerId)) {
        players.delete(playerId);
      }
    }

    for (const bulletId of Array.from(bullets.keys())) {
      if (!fullBulletIds.has(bulletId)) {
        bullets.delete(bulletId);
      }
    }
  }

  return "applied";
}

function dropAcknowledgedPendingInputs(lastProcessedInputSeq, lastProcessedInputClientSentAt = 0) {
  const oldestAllowedClientSentAt = Date.now() - GAME_CONFIG.input.maxClientInputAgeMs;

  while (
    pendingInputs.length > 0 &&
    (pendingInputs[0].seq <= lastProcessedInputSeq ||
      pendingInputs[0].clientSentAt <= lastProcessedInputClientSentAt ||
      pendingInputs[0].clientSentAt < oldestAllowedClientSentAt)
  ) {
    pendingInputs.shift();
  }
}

function computePredictedLocalState(localPlayer, lastProcessedInputSeq, lastProcessedInputClientSentAt) {
  dropAcknowledgedPendingInputs(lastProcessedInputSeq, lastProcessedInputClientSentAt);

  let predicted = {
    x: localPlayer.x,
    y: localPlayer.y,
    angle: localPlayer.angle,
    turretAngle: localPlayer.turretAngle
  };

  for (const input of pendingInputs) {
    predicted = simulateTankMovement(predicted, input, CLIENT_TICK.fixedDeltaSeconds);
  }

  return predicted;
}

function simulatePredictedProjectiles(deltaSeconds) {
  const now = performance.now();

  for (const projectile of Array.from(predictedProjectiles.values())) {
    projectile.x += Math.cos(projectile.angle) * GAME_CONFIG.bullet.speed * deltaSeconds;
    projectile.y += Math.sin(projectile.angle) * GAME_CONFIG.bullet.speed * deltaSeconds;
    projectile.renderX = projectile.x;
    projectile.renderY = projectile.y;

    if (
      now >= projectile.expiresAt ||
      projectile.x < 0 ||
      projectile.x > GAME_CONFIG.world.width ||
      projectile.y < 0 ||
      projectile.y > GAME_CONFIG.world.height ||
      collidesWithObstacle(projectile.x, projectile.y, GAME_CONFIG.bullet.radius)
    ) {
      predictedProjectiles.delete(projectile.id);
    }
  }
}

function applyPredictionCorrection(localPlayer, correctedState) {
  const previousVisual = captureCurrentVisualState(localPlayer);

  localPlayer.renderX = correctedState.x;
  localPlayer.renderY = correctedState.y;
  localPlayer.renderAngle = correctedState.angle;
  localPlayer.renderTurretAngle = correctedState.turretAngle;

  const correctionX = previousVisual.x - correctedState.x;
  const correctionY = previousVisual.y - correctedState.y;
  const correctionAngle = normalizeAngle(previousVisual.angle - correctedState.angle);
  const correctionTurretAngle = normalizeAngle(previousVisual.turretAngle - correctedState.turretAngle);
  const distanceError = Math.hypot(correctionX, correctionY);

  if (distanceError > 0.5 || Math.abs(correctionAngle) > 0.01 || Math.abs(correctionTurretAngle) > 0.01) {
    localPlayer.correctionOffsetX = correctionX;
    localPlayer.correctionOffsetY = correctionY;
    localPlayer.correctionOffsetAngle = correctionAngle;
    localPlayer.correctionOffsetTurretAngle = correctionTurretAngle;
  }

  localPlayer.displayX = correctedState.x + (localPlayer.correctionOffsetX ?? 0);
  localPlayer.displayY = correctedState.y + (localPlayer.correctionOffsetY ?? 0);
  localPlayer.displayAngle = correctedState.angle + (localPlayer.correctionOffsetAngle ?? 0);
  localPlayer.displayTurretAngle =
    correctedState.turretAngle + (localPlayer.correctionOffsetTurretAngle ?? 0);
}

function replayPendingInputs(localPlayer, lastProcessedInputSeq, lastProcessedInputClientSentAt) {
  const predicted = computePredictedLocalState(
    localPlayer,
    lastProcessedInputSeq,
    lastProcessedInputClientSentAt
  );

  applyPredictionCorrection(localPlayer, predicted);
}

function applySnapshot(payload) {
  const snapshotSeq = payload.snapshotSeq ?? 0;
  if (snapshotSeq <= lastAppliedSnapshotSeq) {
    return;
  }

  const previousSnapshotSeq = lastAppliedSnapshotSeq;
  const replicationStatus = applyReplication(payload.replication, payload.serverTime, previousSnapshotSeq);

  if (replicationStatus === "resync") {
    requestLifecycleResync("baseline_mismatch");
    return;
  }

  syncServerClock(payload.serverTime, performance.now());
  lastAppliedSnapshotSeq = snapshotSeq;
  lastSimulationTick = Number(payload.simulationTick) || lastSimulationTick;
  lastSnapshotTick = Number(payload.snapshotTick) || lastSnapshotTick;
  cleanupStaleStateChunks();
  lastSnapshotAt = performance.now();
  lastStatePacketAt = Date.now();
  if (socket?.readyState === WebSocket.OPEN) {
    setStatus("Connected");
  }
  latestMatch = payload.match ?? latestMatch;
  latestLobby = payload.lobby ?? latestLobby;
  latestObjective = payload.objective ?? latestObjective;
  latestLeaderboard = payload.leaderboard ?? latestLeaderboard;
  latestYou = payload.you ?? latestYou;
  latestInterestStats = payload.replication?.interest ?? latestInterestStats;

  if (replicationStatus !== "applied") {
    updateEntityMap(players, payload.players ?? [], { alive: true, ready: false }, {
      kind: "player",
      serverTime: payload.serverTime
    });
    updateEntityMap(bullets, payload.bullets ?? [], {}, {
      kind: "bullet",
      serverTime: payload.serverTime
    });

    for (const bullet of payload.bullets ?? []) {
      reconcilePredictedProjectile(bullet);
    }
  }

  consumeServerEvents(payload.events ?? []);

  const localPlayer = getLocalPlayer();
  if (localPlayer) {
    if (!hasSeenLocalPlayerSnapshot) {
      cameraNeedsSnap = true;
      hasSeenLocalPlayerSnapshot = true;
      updateSessionChrome();
      setStatus("Connected");
    }

    playerLabelElement.textContent =
      `${localPlayer.name}${localPlayer.isSpectator ? " [SPEC]" : ""} (${localPlayer.teamId}/${localPlayer.classId} | ${localPlayer.score}/${localPlayer.assists ?? 0}/${localPlayer.deaths} | ${localPlayer.credits} cr)`;

    if (payload.you) {
      refreshSessionUi(localPlayer, payload.you);
      replayPendingInputs(
        localPlayer,
        payload.you.lastProcessedInputSeq ?? 0,
        payload.you.lastProcessedInputClientSentAt ?? 0
      );
      profileLabelElement.textContent =
        `${payload.you.profileId.slice(0, 8)} | ${payload.you.profileStats.kills}K/${payload.you.profileStats.deaths}D`;
    }
  } else if (payload.you) {
    refreshSessionUi(null, payload.you);
    if (!payload.you.isSpectator && currentRoomId) {
      setStatus("Joined room. Waiting for local player state...");
    }
  }

  refreshLobbyUi(localPlayer, payload.you ?? latestYou);

  roundLabelElement.textContent = latestMatch
    ? `#${latestMatch.roundNumber || 0} | ${latestMatch.phase}`
    : "-";
  matchStatusElement.textContent = buildMatchStatusText();

  scoreboardElement.innerHTML = "";
  for (const player of payload.leaderboard ?? []) {
    const item = document.createElement("li");
    item.innerHTML = `<strong>${player.name}${player.isBot ? " [BOT]" : ""}${player.isSpectator ? " [SPEC]" : ""}</strong><span>${player.teamId} / ${player.classId} | ${player.score} / ${player.assists ?? 0} / ${player.deaths} | ${player.credits}cr${player.ready ? " / ready" : ""}${player.afk ? " / afk" : ""}${player.slotReserved ? " / reserved" : ""}${player.queuedForSlot ? " / queued" : ""}${player.connected ? "" : " / dc"}</span>`;
    scoreboardElement.append(item);
  }
}

function applyStateChunk(payload) {
  const snapshotSeq = Number(payload.snapshotSeq);

  if (!Number.isInteger(snapshotSeq) || snapshotSeq <= lastAppliedSnapshotSeq) {
    return;
  }

  const chunkIndex = Number(payload.chunkIndex);
  const chunkCount = Number(payload.chunkCount);
  if (
    !Number.isInteger(chunkIndex) ||
    !Number.isInteger(chunkCount) ||
    chunkIndex < 0 ||
    chunkCount <= 0 ||
    chunkIndex >= chunkCount
  ) {
    return;
  }

  const existing = stateChunks.get(snapshotSeq) ?? {
    chunkCount,
    receivedAt: Date.now(),
    chunks: new Array(chunkCount)
  };

  if (existing.chunkCount !== chunkCount) {
    stateChunks.delete(snapshotSeq);
    requestLifecycleResync("chunk_mismatch");
    return;
  }

  existing.receivedAt = Date.now();
  existing.chunks[chunkIndex] = String(payload.chunk ?? "");
  stateChunks.set(snapshotSeq, existing);
  cleanupStaleStateChunks();

  if (existing.chunks.some((chunk) => typeof chunk !== "string")) {
    return;
  }

  stateChunks.delete(snapshotSeq);

  try {
    const rebuilt = deserializePacket(existing.chunks.join(""));
    if (rebuilt.ok && rebuilt.packet.type === MESSAGE_TYPES.STATE) {
      applySnapshot(rebuilt.packet);
    } else {
      requestLifecycleResync("chunk_decode");
    }
  } catch (error) {
    console.warn("Failed to rebuild fragmented snapshot", error);
    requestLifecycleResync("chunk_decode");
  }
}

function buildMatchStatusText() {
  if (!latestMatch) {
    return "Waiting for players";
  }

  const localPlayer = getLocalPlayer();
  const spectatorSuffix =
    localPlayer?.isSpectator
      ? localPlayer.queuedForSlot
        ? " | spectating, queued for next slot"
        : " | spectating"
      : "";
  const timeLeftMs = latestMatch.phaseEndsAt ? Math.max(0, latestMatch.phaseEndsAt - Date.now()) : 0;
  const secondsLeft = Math.ceil(timeLeftMs / 1000);

  if (latestMatch.phase === MATCH_PHASES.WAITING) {
    return `${latestMatch.message} (${latestMatch.minPlayers} players needed) | staging arena live | map: ${latestLobby?.mapName ?? GAME_CONFIG.lobby.maps[0].name}${spectatorSuffix}`;
  }

  if (latestMatch.phase === MATCH_PHASES.WARMUP) {
    return `${latestMatch.message} in ${secondsLeft}s | formation run${spectatorSuffix}`;
  }

  if (latestMatch.phase === MATCH_PHASES.PAUSE) {
    return `${latestMatch.message} | reconnect window ${secondsLeft}s${spectatorSuffix}`;
  }

  if (latestMatch.phase === MATCH_PHASES.LIVE_ROUND) {
    const objectiveText = latestObjective?.ownerName
      ? ` | point: ${latestObjective.ownerName}`
      : latestObjective?.captureTargetName
        ? ` | capturing: ${latestObjective.captureTargetName}`
        : "";
    return `${latestMatch.message} | ${secondsLeft}s left | first to ${latestMatch.scoreToWin}${objectiveText}${spectatorSuffix}`;
  }

  if (latestMatch.phase === MATCH_PHASES.OVERTIME) {
    const objectiveText = latestObjective?.ownerName
      ? ` | point: ${latestObjective.ownerName}`
      : latestObjective?.captureTargetName
        ? ` | capturing: ${latestObjective.captureTargetName}`
        : "";
    return `${latestMatch.message} | sudden death${objectiveText}${spectatorSuffix}`;
  }

  if (latestMatch.phase === MATCH_PHASES.ROUND_END) {
    return `${latestMatch.message} | confirming round${spectatorSuffix}`;
  }

  if (latestMatch.phase === MATCH_PHASES.RESULTS) {
    const rematchText =
      latestLobby && latestLobby.activePlayers > 0
        ? ` | rematch ${latestLobby.rematchVotes}/${latestLobby.activePlayers}`
        : "";
    return (latestMatch.winnerName ? `${latestMatch.winnerName} won the round` : latestMatch.message) + rematchText + spectatorSuffix;
  }

  if (latestMatch.phase === MATCH_PHASES.MAP_TRANSITION) {
    return `${latestMatch.message}${spectatorSuffix}`;
  }

  if (latestMatch.phase === MATCH_PHASES.SHUTDOWN) {
    return `${latestMatch.message}${spectatorSuffix}`;
  }

  return `${latestMatch.message}${spectatorSuffix}`;
}

function connect(options = {}) {
  const { isReconnect = false } = options;

  joinInProgress = true;
  updateSessionChrome();
  cancelReconnect();
  pendingReliableMessages.clear();
  stateChunks.clear();
  processedEventIds.clear();
  processedEventOrder.length = 0;
  predictedProjectiles.clear();
  combatEffects.length = 0;
  killFeedEntries.length = 0;
  renderKillFeed();
  lastResyncRequestAt = 0;

  if (socket) {
    socket.skipReconnect = true;
    socket.close();
  }

  localStorage.setItem(STORAGE_KEYS.name, nameInput.value);
  localStorage.setItem(STORAGE_KEYS.room, roomInput.value);
  localStorage.setItem(STORAGE_KEYS.spectate, spectateInput.checked ? "1" : "0");
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomInput.value || "default");
  window.history.replaceState({}, "", url);

  if (!isReconnect) {
    players.clear();
    bullets.clear();
    predictedProjectiles.clear();
    pendingInputs.length = 0;
    nextInputSeq = 1;
    nextReliableMessageId = 1;
    latestMatch = null;
    latestLobby = null;
    latestObjective = null;
    latestLeaderboard = [];
    latestYou = null;
    latestInterestStats = null;
    lastAppliedSnapshotSeq = 0;
    lastSimulationTick = 0;
    lastSnapshotTick = 0;
    clientSimulationTick = 0;
    lastStatePacketAt = 0;
    serverTimeOffset = 0;
    lastStallWarningAt = 0;
    lastRenderFrameAt = performance.now();
    camera.x = 0;
    camera.y = 0;
    cameraNeedsSnap = true;
    hasSeenLocalPlayerSnapshot = false;
    processedEventIds.clear();
    processedEventOrder.length = 0;
    scoreboardElement.innerHTML = "";
    renderKillFeed();
    localPlayerId = null;
    currentRoomId = null;
    updateSessionChrome();
    setReadyButton(false);
    latencyElement.textContent = "--";
    matchStatusElement.textContent = "Waiting for server";
    refreshLobbyUi();
  }

  setStatus(isReconnect ? "Reconnecting to server..." : "Connecting to server...");
  roomLabelElement.textContent = roomInput.value || "default";
  playerLabelElement.textContent = nameInput.value || "Commander";

  const nextSocket = new WebSocket(buildSocketUrl());
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    cancelReconnect();
    setStatus("Connected to server. Requesting match...");
    sendReliable({
      type: MESSAGE_TYPES.JOIN,
      name: nameInput.value,
      roomId: roomInput.value,
      profileId,
      authToken,
      spectate: spectateInput.checked,
      mapId: mapSelect.value,
      teamId: teamSelect.value,
      classId: classSelect.value,
      gameVersion: GAME_BUILD_VERSION,
      assetVersion: ASSET_BUNDLE_VERSION
    });
  });

  nextSocket.addEventListener("message", (event) => {
    const parsed = deserializePacket(String(event.data));
    if (!parsed.ok) {
      setStatus(parsed.error.message);
      if (parsed.error.code === "unsupported_version" || parsed.error.code === "invalid_version") {
        joinInProgress = false;
        nextSocket.skipReconnect = true;
        currentRoomId = null;
        updateSessionChrome();
        nextSocket.close(4006, "Protocol mismatch");
      }
      return;
    }

    const payload = parsed.packet;

    if (payload.type === MESSAGE_TYPES.JOINED) {
      clearPendingReliableMessages(MESSAGE_TYPES.JOIN);
      if (payload.gameVersion && payload.gameVersion !== GAME_BUILD_VERSION) {
        setStatus(`Game version mismatch. Refresh required (${payload.gameVersion} available).`);
        joinInProgress = false;
        nextSocket.skipReconnect = true;
        currentRoomId = null;
        updateSessionChrome();
        nextSocket.close(4009, "Game version mismatch");
        return;
      }
      if (payload.assetVersion && payload.assetVersion !== ASSET_BUNDLE_VERSION) {
        setStatus(`Asset mismatch. Refresh required (${payload.assetVersion} available).`);
        joinInProgress = false;
        nextSocket.skipReconnect = true;
        currentRoomId = null;
        updateSessionChrome();
        nextSocket.close(4010, "Asset version mismatch");
        return;
      }
      localPlayerId = payload.playerId;
      profileId = payload.profileId;
      localStorage.setItem(STORAGE_KEYS.profileId, profileId);
      currentRoomId = payload.roomId;
      joinInProgress = false;
      lastStatePacketAt = Date.now();
      lastResyncRequestAt = 0;
      latestYou = {
        ...(latestYou ?? {}),
        profileId: payload.profileId,
        isSpectator: payload.isSpectator,
        queuedForSlot: payload.queuedForSlot,
        slotReserved: payload.slotReserved
      };
      roomLabelElement.textContent = currentRoomId;
      cameraNeedsSnap = true;
      updateSessionChrome();
      refreshLobbyUi(null, latestYou);
      if (payload.isSpectator) {
        setStatus(payload.queuedForSlot ? "Connected as spectator, queued for a player slot" : "Connected as spectator");
      } else {
        setStatus("Match joined. Waiting for first player snapshot...");
      }
      refreshRoomBrowser();
      return;
    }

    if (payload.type === MESSAGE_TYPES.ACK) {
      pendingReliableMessages.delete(String(payload.messageId));
      return;
    }

    if (payload.type === MESSAGE_TYPES.STATE) {
      applySnapshot(payload);
      return;
    }

    if (payload.type === MESSAGE_TYPES.STATE_CHUNK) {
      lastStatePacketAt = Date.now();
      applyStateChunk(payload);
      return;
    }

    if (payload.type === MESSAGE_TYPES.PONG) {
      latencyElement.textContent = `${Date.now() - Number(payload.sentAt)} ms`;
      return;
    }

    if (payload.type === MESSAGE_TYPES.ERROR) {
      setStatus(payload.message);

      if (!currentRoomId) {
        joinInProgress = false;
        updateSessionChrome();
      }

      if (payload.code === "game_version_mismatch") {
        joinInProgress = false;
        nextSocket.skipReconnect = true;
        currentRoomId = null;
        updateSessionChrome();
      }

      if (payload.code === "invalid_auth_token") {
        authToken = null;
        localStorage.removeItem(STORAGE_KEYS.authToken);
        joinInProgress = false;
        nextSocket.skipReconnect = true;
        currentRoomId = null;
        updateSessionChrome();
      }

      if (payload.code === "asset_version_mismatch" || payload.code === "unsupported_version") {
        joinInProgress = false;
        nextSocket.skipReconnect = true;
        currentRoomId = null;
        updateSessionChrome();
      }
    }
  });

  nextSocket.addEventListener("close", (event) => {
    if (socket !== nextSocket) {
      return;
    }

    socket = null;
    joinInProgress = false;

    if (nextSocket.skipReconnect) {
      updateSessionChrome();
      return;
    }

    if (event.code === 4001) {
      setStatus("This profile connected from another session");
      currentRoomId = null;
      updateSessionChrome();
      return;
    }

    if (event.code === 4009) {
      setStatus("Game updated on server. Refresh to continue.");
      currentRoomId = null;
      updateSessionChrome();
      return;
    }

    if (event.code === 4010) {
      setStatus("Assets updated on server. Refresh to continue.");
      currentRoomId = null;
      updateSessionChrome();
      return;
    }

    if (event.code === 4006) {
      setStatus("Protocol mismatch. Refresh to continue.");
      currentRoomId = null;
      updateSessionChrome();
      return;
    }

    if (currentRoomId) {
      pendingInputs.length = 0;
      scheduleReconnect();
      return;
    }

    setStatus("Disconnected");
    matchStatusElement.textContent = "Disconnected";
    players.clear();
    bullets.clear();
    predictedProjectiles.clear();
    latestObjective = null;
    latestLobby = null;
    latestLeaderboard = [];
    latestYou = null;
    latestInterestStats = null;
    lastAppliedSnapshotSeq = 0;
    lastSimulationTick = 0;
    lastSnapshotTick = 0;
    clientSimulationTick = 0;
    lastStatePacketAt = 0;
    serverTimeOffset = 0;
    stateChunks.clear();
    processedEventIds.clear();
    processedEventOrder.length = 0;
    scoreboardElement.innerHTML = "";
    combatEffects.length = 0;
    killFeedEntries.length = 0;
    renderKillFeed();
    pendingInputs.length = 0;
    lastStallWarningAt = 0;
    camera.x = 0;
    camera.y = 0;
    cameraNeedsSnap = true;
    hasSeenLocalPlayerSnapshot = false;
    updateSessionChrome();
    refreshLobbyUi();
    refreshRoomBrowser();
  });
}

function sendReady(ready) {
  sendReliable({
    type: MESSAGE_TYPES.READY,
    ready
  });
}

function sendLobbyUpdate(action, fields = {}) {
  sendReliable({
    type: MESSAGE_TYPES.LOBBY,
    action,
    ...fields
  });
}

function updateVisualAnimationState(player, fallbackMoveBlend = 0) {
  const animation = player.animation ?? null;

  if (!animation) {
    player.motionBlend = lerp(player.motionBlend ?? 0, fallbackMoveBlend, 0.18);
    return;
  }

  const shouldSnap = (player.animationCorrectionFrames ?? 0) > 0;
  if (shouldSnap) {
    player.motionBlend = Math.max(animation.moveBlend ?? 0, fallbackMoveBlend);
    player.trackPhase = animation.trackPhase ?? 0;
    player.visualAimOffset = animation.aimOffset ?? 0;
    player.visualUpperBodySync = animation.upperBodySync ?? 0;
    player.visualReloadFraction = animation.reloadFraction ?? 0;
    player.animationCorrectionFrames = Math.max(0, (player.animationCorrectionFrames ?? 1) - 1);
    return;
  }

  player.motionBlend = lerp(
    player.motionBlend ?? animation.moveBlend ?? 0,
    Math.max(animation.moveBlend ?? 0, fallbackMoveBlend),
    0.2
  );
  player.trackPhase = lerpWrappedUnit(player.trackPhase ?? animation.trackPhase ?? 0, animation.trackPhase ?? 0, 0.28);
  player.visualAimOffset = lerpAngle(
    player.visualAimOffset ?? animation.aimOffset ?? 0,
    animation.aimOffset ?? 0,
    0.24
  );
  player.visualUpperBodySync = lerp(
    player.visualUpperBodySync ?? animation.upperBodySync ?? 0,
    animation.upperBodySync ?? 0,
    0.24
  );
  player.visualReloadFraction = lerp(
    player.visualReloadFraction ?? animation.reloadFraction ?? 0,
    animation.reloadFraction ?? 0,
    0.24
  );
}

function updateRenderState(deltaSeconds, frameAt) {
  const smoothing = players.size > 1 ? 0.22 : 0.35;
  const renderServerTime = estimateServerTime(frameAt) - NETWORK_RENDER.interpolationBackTimeMs;

  for (const player of players.values()) {
    const previousDisplayX = getPlayerVisualX(player);
    const previousDisplayY = getPlayerVisualY(player);

    if (player.id === localPlayerId && canSimulateLocalPlayer()) {
      player.targetX = player.renderX ?? player.x;
      player.targetY = player.renderY ?? player.y;
      player.targetAngle = player.renderAngle ?? player.angle;
      player.targetTurretAngle = player.renderTurretAngle ?? player.turretAngle;

      player.renderX = lerp(player.renderX ?? player.x, player.targetX ?? player.x, smoothing);
      player.renderY = lerp(player.renderY ?? player.y, player.targetY ?? player.y, smoothing);
      player.renderAngle = lerpAngle(
        player.renderAngle ?? player.angle,
        player.targetAngle ?? player.angle,
        smoothing
      );
      player.renderTurretAngle = lerpAngle(
        player.renderTurretAngle ?? player.turretAngle,
        player.targetTurretAngle ?? player.turretAngle,
        smoothing
      );
      player.correctionOffsetX = lerp(player.correctionOffsetX ?? 0, 0, 0.22);
      player.correctionOffsetY = lerp(player.correctionOffsetY ?? 0, 0, 0.22);
      player.correctionOffsetAngle = lerpAngle(player.correctionOffsetAngle ?? 0, 0, 0.22);
      player.correctionOffsetTurretAngle = lerpAngle(
        player.correctionOffsetTurretAngle ?? 0,
        0,
        0.22
      );
      player.predictedRecoil = lerp(player.predictedRecoil ?? 0, 0, 0.28);
      player.displayX = player.renderX + (player.correctionOffsetX ?? 0);
      player.displayY = player.renderY + (player.correctionOffsetY ?? 0);
      player.displayAngle = player.renderAngle + (player.correctionOffsetAngle ?? 0);
      player.displayTurretAngle =
        player.renderTurretAngle + (player.correctionOffsetTurretAngle ?? 0);
    } else {
      const sample = sampleNetworkHistory(player, "player", renderServerTime) ?? {
        x: player.x,
        y: player.y,
        angle: player.angle,
        turretAngle: player.turretAngle,
        speed: 0
      };
      const dx = sample.x - previousDisplayX;
      const dy = sample.y - previousDisplayY;
      const shouldSnap =
        (player.teleportFrames ?? 0) > 0 ||
        dx * dx + dy * dy > NETWORK_RENDER.snapDistance * NETWORK_RENDER.snapDistance;

      if (shouldSnap) {
        player.renderX = sample.x;
        player.renderY = sample.y;
        player.renderAngle = sample.angle;
        player.renderTurretAngle = sample.turretAngle;
      } else {
        player.renderX = lerp(player.renderX ?? sample.x, sample.x, NETWORK_RENDER.remoteSmoothing);
        player.renderY = lerp(player.renderY ?? sample.y, sample.y, NETWORK_RENDER.remoteSmoothing);
        player.renderAngle = lerpAngle(
          player.renderAngle ?? sample.angle,
          sample.angle,
          NETWORK_RENDER.remoteSmoothing
        );
        player.renderTurretAngle = lerpAngle(
          player.renderTurretAngle ?? sample.turretAngle,
          sample.turretAngle,
          NETWORK_RENDER.remoteSmoothing
        );
      }

      player.teleportFrames = Math.max(0, (player.teleportFrames ?? 0) - 1);
      player.displayX = player.renderX;
      player.displayY = player.renderY;
      player.displayAngle = player.renderAngle;
      player.displayTurretAngle = player.renderTurretAngle;
    }

    const distanceMoved = Math.hypot(getPlayerVisualX(player) - previousDisplayX, getPlayerVisualY(player) - previousDisplayY);
    const blendedMotion = Math.min(1, (distanceMoved / Math.max(0.001, deltaSeconds)) / GAME_CONFIG.tank.speed);
    updateVisualAnimationState(player, blendedMotion);
  }

  for (const bullet of bullets.values()) {
    const sample = sampleNetworkHistory(bullet, "bullet", renderServerTime) ?? {
      x: bullet.x,
      y: bullet.y,
      angle: bullet.angle
    };
    const currentBulletX = bullet.renderX ?? bullet.x;
    const currentBulletY = bullet.renderY ?? bullet.y;
    const dx = sample.x - currentBulletX;
    const dy = sample.y - currentBulletY;
    const shouldSnap =
      (bullet.teleportFrames ?? 0) > 0 ||
      dx * dx + dy * dy > NETWORK_RENDER.snapDistance * NETWORK_RENDER.snapDistance;

    if (shouldSnap) {
      bullet.renderX = sample.x;
      bullet.renderY = sample.y;
      bullet.renderAngle = sample.angle;
    } else {
      bullet.renderX = lerp(currentBulletX, sample.x, 0.55);
      bullet.renderY = lerp(currentBulletY, sample.y, 0.55);
      bullet.renderAngle = lerpAngle(bullet.renderAngle ?? bullet.angle, sample.angle, 0.55);
    }

    bullet.teleportFrames = Math.max(0, (bullet.teleportFrames ?? 0) - 1);
  }
  matchStatusElement.textContent = buildMatchStatusText();
}

function drawBackground() {
  context.fillStyle = "#8c8c8c";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function drawMapSquare() {
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, GAME_CONFIG.world.width, GAME_CONFIG.world.height);
  context.lineWidth = 18 / cameraZoom;
  context.strokeStyle = "#111111";
  context.strokeRect(0, 0, GAME_CONFIG.world.width, GAME_CONFIG.world.height);
}

function drawCenterProbe() {
  const centerX = GAME_CONFIG.world.width / 2;
  const centerY = GAME_CONFIG.world.height / 2;

  context.save();
  context.strokeStyle = "#ff006e";
  context.lineWidth = 10 / cameraZoom;
  context.beginPath();
  context.arc(centerX, centerY, 72, 0, Math.PI * 2);
  context.stroke();

  context.beginPath();
  context.moveTo(centerX - 96, centerY);
  context.lineTo(centerX + 96, centerY);
  context.moveTo(centerX, centerY - 96);
  context.lineTo(centerX, centerY + 96);
  context.stroke();

  context.fillStyle = "#111111";
  context.font = `${Math.max(26 / cameraZoom, 12)}px Segoe UI`;
  context.textAlign = "center";
  context.fillText("MAP CENTER", centerX, centerY - 92);
  context.restore();
}

function drawGrid() {
  const cellSize = 48;
  const majorEvery = 4;
  const minorLineWidth = Math.max(1.5 / cameraZoom, 1.2);
  const majorLineWidth = Math.max(4.5 / cameraZoom, 3);

  context.save();

  for (let x = 0, index = 0; x <= GAME_CONFIG.world.width; x += cellSize, index += 1) {
    const isMajor = index % majorEvery === 0;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, GAME_CONFIG.world.height);
    context.lineWidth = isMajor ? majorLineWidth : minorLineWidth;
    context.strokeStyle = isMajor ? "rgba(17, 17, 17, 0.68)" : "rgba(17, 17, 17, 0.34)";
    context.stroke();
  }

  for (let y = 0, index = 0; y <= GAME_CONFIG.world.height; y += cellSize, index += 1) {
    const isMajor = index % majorEvery === 0;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(GAME_CONFIG.world.width, y);
    context.lineWidth = isMajor ? majorLineWidth : minorLineWidth;
    context.strokeStyle = isMajor ? "rgba(17, 17, 17, 0.68)" : "rgba(17, 17, 17, 0.34)";
    context.stroke();
  }

  context.restore();
}

function drawObstacles() {
  // Intentionally blank while we isolate spawn visibility.
}

function drawObjective() {
  // Intentionally blank while we isolate spawn visibility.
}

function drawRepeatedImage(image, options = {}) {
  const { opacity = 1 } = options;
  const tileWidth = Math.max(1, image.naturalWidth || image.width || 1);
  const tileHeight = Math.max(1, image.naturalHeight || image.height || 1);
  const phaseX = ((camera.x % tileWidth) + tileWidth) % tileWidth;
  const phaseY = ((camera.y % tileHeight) + tileHeight) % tileHeight;
  const startX = -Math.round(phaseX);
  const startY = -Math.round(phaseY);

  context.save();
  context.globalAlpha = opacity;

  for (let x = startX; x <= canvas.width; x += tileWidth) {
    for (let y = startY; y <= canvas.height; y += tileHeight) {
      context.drawImage(image, Math.round(x), Math.round(y), tileWidth, tileHeight);
    }
  }

  context.restore();
}

function drawWorldBounds() {
  const worldLeft = Math.round(-camera.x);
  const worldTop = Math.round(-camera.y);
  const worldRight = Math.round(GAME_CONFIG.world.width - camera.x);
  const worldBottom = Math.round(GAME_CONFIG.world.height - camera.y);

  context.fillStyle = "rgba(255, 255, 255, 0.35)";
  context.fillRect(worldLeft, worldTop, Math.max(1, worldRight - worldLeft), 2);
  context.fillRect(worldLeft, worldBottom - 2, Math.max(1, worldRight - worldLeft), 2);
  context.fillRect(worldLeft, worldTop, 2, Math.max(1, worldBottom - worldTop));
  context.fillRect(worldRight - 2, worldTop, 2, Math.max(1, worldBottom - worldTop));
}

function drawRotatedSprite(image, x, y, angle, width, height, options = {}) {
  const { alpha = 1, offsetX = 0, offsetY = 0 } = options;

  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.translate(offsetX, offsetY);
  context.globalAlpha = alpha;
  context.drawImage(image, -width / 2, -height / 2, width, height);
  context.restore();
}

function drawTank(player) {
  if (player.isSpectator) {
    return;
  }

  const x = getPlayerVisualX(player);
  const y = getPlayerVisualY(player);
  const isLocalPlayer = player.id === localPlayerId;

  context.save();
  context.beginPath();
  context.arc(x, y, GAME_CONFIG.tank.radius + (isLocalPlayer ? 18 : 8), 0, Math.PI * 2);
  context.fillStyle = player.alive
    ? (isLocalPlayer ? "#ff4d00" : "#5f6f86")
    : "rgba(255, 122, 0, 0.35)";
  context.fill();
  context.lineWidth = isLocalPlayer ? 8 : 5;
  context.strokeStyle = isLocalPlayer ? "#111111" : "#2f3742";
  context.stroke();
  context.restore();

  context.save();
  context.fillStyle = "#111111";
  context.font = isLocalPlayer ? "bold 16px Segoe UI" : "14px Segoe UI";
  context.textAlign = "center";
  context.fillText(isLocalPlayer ? "YOU" : player.name, x, y - (GAME_CONFIG.tank.radius + 18));
  context.restore();
}

function drawBullet(bullet) {
  context.save();
  context.translate(bullet.renderX, bullet.renderY);
  context.rotate(bullet.renderAngle ?? bullet.angle);
  context.fillStyle = "#ffd166";
  context.fillRect(-6, -3, 12, 6);
  context.restore();
}

function drawPredictedProjectile(projectile) {
  context.save();
  context.translate(projectile.renderX, projectile.renderY);
  context.rotate(projectile.angle);
  context.globalAlpha = 0.45;
  context.fillStyle = "#ffd166";
  context.fillRect(-6, -3, 12, 6);
  context.restore();
}

function drawCombatEffects() {
  const now = performance.now();
  pruneCombatEffects(now);

  for (const effect of combatEffects) {
    const life = Math.max(0, (effect.expiresAt - now) / 700);
    if (life <= 0) {
      continue;
    }

    const driftY = (1 - life) * (effect.rise ?? 18);
    context.save();
    context.globalAlpha = Math.max(0.12, life);
    context.fillStyle = effect.color ?? "#f8fafc";
    context.font = "bold 14px Segoe UI";
    context.textAlign = "center";
    if (effect.text) {
      context.fillText(effect.text, effect.x, effect.y - 26 - driftY);
    }

    if (effect.ring && effect.ring !== VFX_CUES.NONE) {
      context.beginPath();
      context.arc(effect.x, effect.y, 18 + (1 - life) * 18, 0, Math.PI * 2);
      context.lineWidth = 2.5;
      context.strokeStyle = effect.color ?? "#f8fafc";
      context.stroke();
    }
    context.restore();
  }
}

function drawOverlay() {
  context.fillStyle = "rgba(255,255,255,0.66)";
  context.font = "16px Segoe UI";
  context.textAlign = "left";
  const snapshotAge = lastSnapshotAt ? Math.round(performance.now() - lastSnapshotAt) : 0;
  const lastProcessedInputTick = latestYou?.lastProcessedInputTick ?? 0;
  const pendingInputCount = latestYou?.pendingInputCount ?? pendingInputs.length;
  context.fillText(`Room: ${currentRoomId ?? "-"}`, 20, 28);
  context.fillText(`Players: ${players.size}`, 20, 52);
  context.fillText(`Snapshot age: ${snapshotAge}ms`, 20, 76);
  if (latestMatch) {
    context.fillText(`Phase: ${latestMatch.phase}`, 20, 100);
  }
  if (latestObjective?.ownerName) {
    context.fillText(`Objective: ${latestObjective.ownerName}`, 20, 124);
  }
  context.fillText(`Ticks: server ${lastSimulationTick} | snapshot ${lastSnapshotTick} | client ${clientSimulationTick}`, 20, 148);
  context.fillText(
    `Buffers: input ${pendingInputs.length}/${pendingInputCount} | chunks ${stateChunks.size} | ack tick ${lastProcessedInputTick}`,
    20,
    172
  );
  if (latestInterestStats) {
    context.fillText(
      `Interest: p ${latestInterestStats.selectedPlayers}/${latestInterestStats.candidatePlayers} | b ${latestInterestStats.selectedBullets}/${latestInterestStats.candidateBullets} | cell ${latestInterestStats.cellSize}`,
      20,
      196
    );
  }
}

function render(frameAt = performance.now()) {
  const deltaSeconds = Math.min(0.05, Math.max(0.001, (frameAt - lastRenderFrameAt) / 1000));
  lastRenderFrameAt = frameAt;

  updateRenderState(deltaSeconds, frameAt);
  updateCamera();
  drawBackground();

  context.save();
  context.scale(cameraZoom, cameraZoom);
  context.translate(-camera.x, -camera.y);
  drawMapSquare();
  drawGrid();
  drawCenterProbe();
  drawObstacles();
  drawObjective();

  for (const bullet of bullets.values()) {
    drawBullet(bullet);
  }

  for (const projectile of predictedProjectiles.values()) {
    drawPredictedProjectile(projectile);
  }

  for (const player of players.values()) {
    drawTank(player);
  }

  drawCombatEffects();
  context.restore();
  if (debugUiEnabled) {
    drawOverlay();
  }
  updateDiagnosticBanner();
  requestAnimationFrame(render);
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  unlockAudio();
  void startQuickJoin();
});

roomInput.addEventListener("input", () => {
  if (!currentRoomId) {
    refreshLobbyUi();
  }
});

createRoomButton.addEventListener("click", () => {
  spectateInput.checked = false;
  roomInput.value = createRoomCode();
  connect();
});

readyButton.addEventListener("click", () => {
  const localPlayer = getLocalPlayer();
  if (localPlayer?.isSpectator ?? latestYou?.isSpectator) {
    return;
  }
  sendReady(!(localPlayer?.ready ?? latestYou?.ready ?? false));
});

refreshRoomsButton.addEventListener("click", () => {
  refreshRoomBrowser();
});

mapSelect.addEventListener("change", () => {
  sendLobbyUpdate("map", {
    mapId: mapSelect.value
  });
});

teamSelect.addEventListener("change", () => {
  sendLobbyUpdate("team", {
    teamId: teamSelect.value
  });
});

classSelect.addEventListener("change", () => {
  sendLobbyUpdate("class", {
    classId: classSelect.value
  });
});

window.addEventListener("keydown", (event) => {
  unlockAudio();
  if (
    ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
      event.code
    )
  ) {
    event.preventDefault();
  }

  if (event.code === "KeyR" && !event.repeat && isResultsPhase(latestMatch?.phase)) {
    const localPlayer = getLocalPlayer();
    if (localPlayer?.isSpectator ?? latestYou?.isSpectator) {
      return;
    }
    sendReady(!(localPlayer?.ready ?? latestYou?.ready ?? false));
    return;
  }

  keys.add(event.code);
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

window.addEventListener("resize", resizeCanvas);

canvas.addEventListener("mousemove", (event) => {
  lastPointerWorldPosition = getPointerWorldPosition(event);
});

canvas.addEventListener("pointerdown", unlockAudio);
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();

  const bounds = canvas.getBoundingClientRect();
  const normalizedX = (event.clientX - bounds.left) / bounds.width;
  const normalizedY = (event.clientY - bounds.top) / bounds.height;
  const previousViewport = getVisibleViewportSize();
  const anchorWorldX = camera.x + normalizedX * previousViewport.width;
  const anchorWorldY = camera.y + normalizedY * previousViewport.height;
  const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;

  cameraZoom = clamp(cameraZoom * zoomFactor, 0.05, 12);

  const nextViewport = getVisibleViewportSize();
  const clamped = clampCameraPosition(
    anchorWorldX - normalizedX * nextViewport.width,
    anchorWorldY - normalizedY * nextViewport.height
  );
  camera.x = clamped.x;
  camera.y = clamped.y;
  cameraNeedsSnap = false;
}, { passive: false });

setInterval(() => {
  clientSimulationTick += 1;
  simulatePredictedProjectiles(CLIENT_TICK.fixedDeltaSeconds);

  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  const localPlayer = getLocalPlayer();
  if (!localPlayer || localPlayer.isSpectator) {
    return;
  }

  const inputFrame = createInputFrame();
  send(serializeInputFrame(inputFrame));

  if (!canSimulateLocalPlayer() || !localPlayer.alive) {
    return;
  }

  bufferPendingInput(inputFrame);
  if (
    inputFrame.shoot &&
    canPredictLocalShots() &&
    Date.now() - (localPlayer.lastPredictedShotAt ?? 0) >= GAME_CONFIG.tank.shootCooldownMs
  ) {
    localPlayer.lastPredictedShotAt = Date.now();
    spawnPredictedProjectile(localPlayer, inputFrame);
  }

  const predicted = simulateTankMovement(
    {
      x: localPlayer.renderX ?? localPlayer.x,
      y: localPlayer.renderY ?? localPlayer.y,
      angle: localPlayer.renderAngle ?? localPlayer.angle,
      turretAngle: localPlayer.renderTurretAngle ?? localPlayer.turretAngle
    },
    inputFrame,
    CLIENT_TICK.fixedDeltaSeconds
  );

  localPlayer.renderX = predicted.x;
  localPlayer.renderY = predicted.y;
  localPlayer.renderAngle = predicted.angle;
  localPlayer.renderTurretAngle = predicted.turretAngle;
  localPlayer.displayX = predicted.x + (localPlayer.correctionOffsetX ?? 0);
  localPlayer.displayY = predicted.y + (localPlayer.correctionOffsetY ?? 0);
  localPlayer.displayAngle = predicted.angle + (localPlayer.correctionOffsetAngle ?? 0);
  localPlayer.displayTurretAngle =
    predicted.turretAngle + (localPlayer.correctionOffsetTurretAngle ?? 0);
}, 1000 / CLIENT_TICK.rate);

setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) {
    send({
      type: MESSAGE_TYPES.PING,
      sentAt: Date.now()
    });
  }
}, 2000);

setInterval(() => {
  const now = Date.now();

  for (const entry of pendingReliableMessages.values()) {
    if (now - entry.lastSentAt < GAME_CONFIG.network.reliableResendMs) {
      continue;
    }

    entry.lastSentAt = now;
    send(entry.payload);
  }

  for (const [snapshotSeq, entry] of stateChunks.entries()) {
    if (now - entry.receivedAt > GAME_CONFIG.network.heartbeatTimeoutMs) {
      stateChunks.delete(snapshotSeq);
    }
  }

  if (
    socket?.readyState === WebSocket.OPEN &&
    currentRoomId &&
    lastStatePacketAt > 0 &&
    now - lastStatePacketAt >= 2000
  ) {
    if (now - lastStallWarningAt >= 1500) {
      lastStallWarningAt = now;
      setStatus("Connection unstable, trying to recover state...");
      requestLifecycleResync("snapshot_stall");
    }

    if (now - lastStatePacketAt >= 5000) {
      setStatus("Connection stalled, reconnecting...");
      socket.close(4008, "State stream stalled");
    }
  }
}, 250);

setInterval(() => {
  refreshRoomBrowser();
}, 8000);

resizeCanvas();
render();
refreshRoomBrowser();
