import {
  ANIMATION_ACTIONS,
  ASSET_BUNDLE_VERSION,
  AUTO_BARREL_ROT_SPEED,
  CLASS_TREE,
  clamp,
  COMBAT_EVENT_ACTIONS,
  EVENT_TYPES,
  GAME_BUILD_VERSION,
  GAME_CONFIG,
  MATCH_PHASES,
  MAX_LEVEL,
  MESSAGE_TYPES,
  SHAPE_TYPES,
  SOUND_CUES,
  STAT_NAMES,
  STATUS_EFFECTS,
  VFX_CUES,
  XP_PER_LEVEL,
  deserializePacket,
  getMapLayout,
  getTeamConfig,
  getTeamSpawnZone,
  normalizeAngle,
  serializePacket
} from "/shared/protocol.js";

const canvas = document.getElementById("game");
const context = canvas.getContext("2d");
const devBadgeElement = document.getElementById("dev-badge");
const diagnosticBannerElement = document.getElementById("diagnostic-banner");
const playAreaElement = document.querySelector(".play-area");
const fallbackVisualLayerElement = document.getElementById("fallback-visual-layer");
const fallbackCenterMarkerElement = document.getElementById("fallback-center-marker");
const fallbackPlayerMarkerElement = document.getElementById("fallback-player-marker");
const fallbackRemoteMarkersElement = document.getElementById("fallback-remote-markers");
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
const deathOverlayElement = document.getElementById("death-overlay");
const respawnButton = document.getElementById("respawn-button");

const STORAGE_KEYS = {
  name: "multitank.name",
  room: "multitank.room",
  profileId: "multitank.profileId",
  spectate: "multitank.spectate",
  authToken: "multitank.authToken"
};

const SESSION_STORAGE_KEYS = {
  clientSessionId: "multitank.clientSessionId",
  compatibilityReloadAt: "multitank.compatibilityReloadAt"
};

const NETWORK_RENDER = Object.freeze({
  interpolationBackTimeMs: 96,
  minInterpolationBackTimeMs: 32,
  maxExtrapolationMs: 144,
  historyLimit: 32,
  playerTeleportDistance: 220,
  bulletTeleportDistance: 140,
  snapDistance: 120,
  remoteSmoothing: 0.52,
  clockSmoothing: 0.18
});

const NETWORK_RECOVERY = Object.freeze({
  staleStateWarningMs: Math.max(15000, Math.round(GAME_CONFIG.network.heartbeatTimeoutMs / 3)),
  staleStateStatusCooldownMs: 8000
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
const shapes = new Map();
const predictedProjectiles = new Map();
const combatEffects = [];
const killFeedEntries = [];
const shapeParticles = [];
const STAT_LABELS = Object.freeze({
  healthRegen: "Health Regen",
  maxHealth: "Max Health",
  bodyDamage: "Body Damage",
  bulletSpeed: "Bullet Speed",
  bulletPenetration: "Penetration",
  bulletDamage: "Bullet Damage",
  reload: "Reload",
  movementSpeed: "Move Speed"
});

function createEmptyAllocatedStats() {
  return Object.fromEntries(STAT_NAMES.map((statName) => [statName, 0]));
}

function normalizeAllocatedStats(stats, fallback = createEmptyAllocatedStats()) {
  const nextStats = { ...fallback };
  for (const statName of STAT_NAMES) {
    const rawValue = Number(stats?.[statName]);
    nextStats[statName] = Number.isFinite(rawValue) ? clamp(Math.round(rawValue), 0, 7) : (fallback[statName] ?? 0);
  }
  return nextStats;
}

// XP / upgrade state
let localXp = 0;
let displayXp = 0;
let localLevel = 1;
let localStatPoints = 0;
let localPendingUpgrades = [];
let localTankClassId = "basic";
let localStats = createEmptyAllocatedStats();
let upgradeMenuOpen = false;
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
let cameraHasAnchor = false;
let cameraAnchorX = GAME_CONFIG.world.width / 2;
let cameraAnchorY = GAME_CONFIG.world.height / 2;
let fallbackCameraX = 0;
let fallbackCameraY = 0;
let localVisualState = null;
let localRenderState = null;

let socket = null;
let localPlayerId = null;
let profileId = getOrCreateProfileId();
let clientSessionId = getOrCreateClientSessionId();
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
let latestLatencyMs = 0;
let lastServerMessageAt = 0;
let lastSocketCloseInfo = null;
let pointerPrimaryDown = false;
let lastPointerViewportPosition = {
  normalizedX: 0.5,
  normalizedY: 0.5
};
let lastPointerWorldPosition = {
  x: GAME_CONFIG.world.width / 2,
  y: GAME_CONFIG.world.height / 2
};
let lastRenderFrameAt = performance.now();
let cameraNeedsSnap = true;
let cameraShakeX = 0;
let cameraShakeY = 0;
let hasSeenLocalPlayerSnapshot = false;
let joinInProgress = false;
let nextInputSeq = 1;
let nextReliableMessageId = 1;
let roomBrowserRefreshInFlight = false;
let audioContext = null;
let renderFailure = null;
let renderLoopStopped = false;
let lastScoreboardRenderKey = "";
let lastResultsRenderKey = "";
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

function getOrCreateClientSessionId() {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEYS.clientSessionId);
    if (stored) {
      return stored;
    }

    const created = crypto.randomUUID().replace(/-/g, "");
    sessionStorage.setItem(SESSION_STORAGE_KEYS.clientSessionId, created);
    return created;
  } catch (error) {
    return crypto.randomUUID().replace(/-/g, "");
  }
}

function rotateClientSessionId() {
  clientSessionId = crypto.randomUUID().replace(/-/g, "");
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEYS.clientSessionId, clientSessionId);
  } catch (error) {
    // Session storage can be unavailable in hardened browser modes.
  }
  return clientSessionId;
}

function requestCompatibilityRefresh(reason) {
  try {
    const now = Date.now();
    const key = `${SESSION_STORAGE_KEYS.compatibilityReloadAt}.${reason}`;
    const lastReloadAt = Number(sessionStorage.getItem(key) ?? 0);
    if (now - lastReloadAt < 5000) {
      return false;
    }
    sessionStorage.setItem(key, String(now));
  } catch (error) {
    // Fall through and still try to refresh.
  }

  setStatus("Refreshing to recover the connection...");
  window.setTimeout(() => {
    window.location.reload();
  }, 150);
  return true;
}

function setStatus(text) {
  setElementText(statusElement, text);
  updateDiagnosticBanner();
}

function setElementText(element, text) {
  if (!element) {
    return;
  }

  const nextText = String(text ?? "");
  if (element.textContent !== nextText) {
    element.textContent = nextText;
  }
}

function buildLeaderboardRenderKey(leaderboard = latestLeaderboard) {
  return (leaderboard ?? []).map((player) =>
    [
      player.id,
      player.name,
      player.teamId,
      player.classId,
      player.score,
      player.assists ?? 0,
      player.deaths,
      player.credits,
      player.ready ? 1 : 0,
      player.afk ? 1 : 0,
      player.slotReserved ? 1 : 0,
      player.queuedForSlot ? 1 : 0,
      player.connected === false ? 0 : 1,
      player.isBot ? 1 : 0,
      player.isSpectator ? 1 : 0
    ].join(":")
  ).join("|");
}

function renderScoreboard(leaderboard = latestLeaderboard) {
  const resolvedLeaderboard = Array.isArray(leaderboard) ? leaderboard : [];
  const renderKey = buildLeaderboardRenderKey(resolvedLeaderboard);
  if (renderKey === lastScoreboardRenderKey) {
    return;
  }

  lastScoreboardRenderKey = renderKey;
  scoreboardElement.innerHTML = "";

  for (const player of resolvedLeaderboard) {
    const item = document.createElement("li");
    item.innerHTML = `<strong>${player.name}${player.isBot ? " [BOT]" : ""}${player.isSpectator ? " [SPEC]" : ""}</strong><span>${getTeamName(player.teamId)} / ${player.classId} | ${player.score} / ${player.assists ?? 0} / ${player.deaths} | ${player.credits}cr${player.ready ? " / ready" : ""}${player.afk ? " / afk" : ""}${player.slotReserved ? " / reserved" : ""}${player.queuedForSlot ? " / queued" : ""}${player.connected ? "" : " / dc"}</span>`;
    scoreboardElement.append(item);
  }
}

function buildResultsRenderKey() {
  return [
    latestMatch?.phase ?? "",
    latestMatch?.winnerName ?? "",
    latestLobby?.rematchVotes ?? 0,
    latestLobby?.activePlayers ?? 0,
    buildLeaderboardRenderKey(latestLeaderboard)
  ].join("|");
}

function renderResultsList() {
  const shouldShow = shouldShowResultsPhase(latestMatch?.phase);
  resultsCard.hidden = !shouldShow;

  if (!shouldShow) {
    if (lastResultsRenderKey) {
      lastResultsRenderKey = "";
      resultsListElement.replaceChildren();
    }
    return;
  }

  const renderKey = buildResultsRenderKey();
  if (renderKey === lastResultsRenderKey) {
    return;
  }

  lastResultsRenderKey = renderKey;
  resultsListElement.replaceChildren();

  const activePlayers = latestLobby?.activePlayers ?? 0;
  const rematchVotes = latestLobby?.rematchVotes ?? 0;
  const winnerName = latestMatch?.winnerName ?? "No winner";
  const voteTarget = Math.max(1, activePlayers);
  setElementText(
    resultsSummaryElement,
    latestMatch?.phase === MATCH_PHASES.ROUND_END
      ? `${winnerName} | locking round results`
      : `${winnerName} | rematch votes ${rematchVotes}/${voteTarget}`
  );

  for (const player of latestLeaderboard) {
    if (player.isSpectator) {
      continue;
    }

    const item = document.createElement("li");
    item.innerHTML = `<div class="results-title">${escapeHtml(player.name)}</div><div class="results-meta">${escapeHtml(getTeamName(player.teamId))} / ${escapeHtml(player.classId)} | ${player.score} score | ${player.assists ?? 0} assists | ${player.deaths} deaths | ${player.credits} credits${player.ready ? " | ready" : ""}</div>`;
    resultsListElement.append(item);
  }
}

function formatSocketCloseInfo(closeInfo) {
  if (!closeInfo) {
    return "n/a";
  }

  const code = Number.isFinite(Number(closeInfo.code)) ? Number(closeInfo.code) : 0;
  const cleanState = closeInfo.wasClean ? "clean" : "unclean";
  const reason = typeof closeInfo.reason === "string" && closeInfo.reason.trim()
    ? closeInfo.reason.trim().slice(0, 80)
    : "no reason";
  return `code ${code} | ${cleanState} | ${reason}`;
}

function rememberSocketClose(event) {
  lastSocketCloseInfo = {
    code: Number.isFinite(Number(event?.code)) ? Number(event.code) : 0,
    reason: typeof event?.reason === "string" ? event.reason : String(event?.reason ?? ""),
    wasClean: Boolean(event?.wasClean),
    at: Date.now()
  };
  console.warn("WebSocket closed in client", lastSocketCloseInfo);
  updateDiagnosticBanner();
  return lastSocketCloseInfo;
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

function resetCameraAnchor() {
  cameraHasAnchor = false;
  cameraAnchorX = GAME_CONFIG.world.width / 2;
  cameraAnchorY = GAME_CONFIG.world.height / 2;
  fallbackCameraX = camera.x;
  fallbackCameraY = camera.y;
  localVisualState = null;
  localRenderState = null;
}

function hasMovementInputActive() {
  return (
    keys.has("KeyW") ||
    keys.has("KeyA") ||
    keys.has("KeyS") ||
    keys.has("KeyD") ||
    keys.has("ArrowUp") ||
    keys.has("ArrowLeft") ||
    keys.has("ArrowDown") ||
    keys.has("ArrowRight")
  );
}

function ensureLocalVisualState(localPlayer = getLocalPlayer()) {
  if (!localPlayer || localPlayer.isSpectator) {
    localVisualState = null;
    return null;
  }

  if (!localVisualState) {
    localVisualState = {
      x: getPlayerVisualX(localPlayer),
      y: getPlayerVisualY(localPlayer),
      angle: getPlayerVisualAngle(localPlayer),
      turretAngle: getPlayerVisualTurretAngle(localPlayer)
    };
  }

  return localVisualState;
}

function ensureLocalRenderState(force = false) {
  const visualState = ensureLocalVisualState();

  if (!visualState) {
    localRenderState = null;
    return null;
  }

  if (!localRenderState || force) {
    localRenderState = {
      x: visualState.x,
      y: visualState.y,
      angle: visualState.angle,
      turretAngle: visualState.turretAngle
    };
    return localRenderState;
  }

  if (!localRenderState) {
    localRenderState = {
      x: visualState.x,
      y: visualState.y,
      angle: visualState.angle,
      turretAngle: visualState.turretAngle
    };
  }

  const dx = visualState.x - localRenderState.x;
  const dy = visualState.y - localRenderState.y;
  if (dx * dx + dy * dy > 220 * 220) {
    localRenderState.x = visualState.x;
    localRenderState.y = visualState.y;
    localRenderState.angle = visualState.angle;
    localRenderState.turretAngle = visualState.turretAngle;
  }

  return localRenderState;
}

function updateLocalRenderState(deltaSeconds) {
  const localPlayer = getLocalPlayer();
  const visualState = ensureLocalVisualState(localPlayer);
  const renderState = ensureLocalRenderState();

  if (!visualState || !renderState) {
    return null;
  }

  const followAmount = canSimulateLocalPlayer() && localPlayer.alive
    ? clamp(1 - Math.exp(-(hasMovementInputActive() ? 28 : 18) * deltaSeconds), 0.24, 0.62)
    : clamp(1 - Math.exp(-16 * deltaSeconds), 0.18, 0.4);

  if (crossedOwnSpawnBoundary(localPlayer.teamId, renderState.x, visualState.x)) {
    renderState.x = visualState.x;
    renderState.y = visualState.y;
    renderState.angle = visualState.angle;
    renderState.turretAngle = visualState.turretAngle;
    return renderState;
  }

  renderState.x = lerp(renderState.x, visualState.x, followAmount);
  renderState.y = lerp(renderState.y, visualState.y, followAmount);
  renderState.angle = lerpAngle(renderState.angle, visualState.angle, followAmount);
  renderState.turretAngle = lerpAngle(
    renderState.turretAngle,
    visualState.turretAngle,
    getTurretVisualSmoothing(deltaSeconds)
  );
  return renderState;
}

function hasPlayableSession() {
  const localPlayer = getLocalPlayer();
  return Boolean(currentRoomId && hasSeenLocalPlayerSnapshot && localPlayer && !localPlayer.isSpectator);
}

function updateSessionChrome() {
  document.body.classList.toggle("in-session", hasPlayableSession());
  document.body.classList.toggle("joining-session", false);
  syncJoinMatchButton();
  refreshDeathOverlay();
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
    ? localPlayer.name
    : (localPlayerId ? `awaiting state for ${localPlayerId}` : "none");
  const shouldShowCloseSummary = socket?.readyState !== WebSocket.OPEN && lastSocketCloseInfo;

  diagnosticBannerElement.hidden = false;
  diagnosticBannerElement.textContent =
    `Status: ${statusElement.textContent}\n` +
    `Room: ${currentRoomId ?? "-"} | Snapshot: ${snapshotState} | Players: ${players.size}\n` +
    `Local Player: ${playerSummary}\n` +
    `Playable: ${hasPlayableSession() ? "yes" : "no"} | Spectator: ${spectatorState ? "yes" : "no"} | Zoom: ${cameraZoom.toFixed(2)}` +
    (shouldShowCloseSummary ? `\nLast Close: ${formatSocketCloseInfo(lastSocketCloseInfo)}` : "") +
    (renderFailure ? `\nRender Error: ${renderFailure}` : "");
}

function positionFallbackMarker(element, worldX, worldY) {
  if (!element) {
    return;
  }

  const screenX = (worldX - fallbackCameraX) * cameraZoom;
  const screenY = (worldY - fallbackCameraY) * cameraZoom;
  element.style.left = `${screenX}px`;
  element.style.top = `${screenY}px`;
}

function setFallbackMarkerScale(element) {
  if (!element) {
    return;
  }

  element.style.setProperty("--world-scale", String(cameraZoom));
}

function syncFallbackRemoteMarkers() {
  if (!fallbackRemoteMarkersElement) {
    return;
  }

  const activeRemotePlayers = Array.from(players.values()).filter(
    (player) => player.id !== localPlayerId && !player.isSpectator && !player.isBot
  );
  const activeIds = new Set(activeRemotePlayers.map((player) => player.id));

  for (const node of Array.from(fallbackRemoteMarkersElement.children)) {
    if (!activeIds.has(node.dataset.playerId)) {
      node.remove();
    }
  }

  for (const player of activeRemotePlayers) {
    let marker = fallbackRemoteMarkersElement.querySelector(`[data-player-id="${player.id}"]`);
    if (!marker) {
      marker = document.createElement("div");
      marker.className = "fallback-remote-marker";
      marker.dataset.playerId = player.id;
      marker.innerHTML = `
        <div class="fallback-remote-ring"></div>
        <div class="fallback-remote-dot"></div>
        <div class="fallback-remote-label"></div>
      `;
      fallbackRemoteMarkersElement.append(marker);
    }

    const label = marker.querySelector(".fallback-remote-label");
    if (label) {
      label.textContent = player.name;
    }
    setFallbackMarkerScale(marker);
    positionFallbackMarker(marker, getPlayerVisualX(player), getPlayerVisualY(player));
  }
}

function updateFallbackVisuals() {
  if (!playAreaElement || !fallbackVisualLayerElement) {
    return;
  }

  fallbackCameraX = camera.x;
  fallbackCameraY = camera.y;

  const minorSize = Math.max(20, 40 * cameraZoom);
  const majorSize = Math.max(100, 200 * cameraZoom);
  playAreaElement.style.backgroundImage = [
    "linear-gradient(rgba(76, 118, 191, 0.36) 2px, transparent 2px)",
    "linear-gradient(90deg, rgba(76, 118, 191, 0.36) 2px, transparent 2px)",
    "linear-gradient(rgba(40, 78, 148, 0.62) 4px, transparent 4px)",
    "linear-gradient(90deg, rgba(40, 78, 148, 0.62) 4px, transparent 4px)"
  ].join(",");
  playAreaElement.style.backgroundSize = `${minorSize}px ${minorSize}px, ${minorSize}px ${minorSize}px, ${majorSize}px ${majorSize}px, ${majorSize}px ${majorSize}px`;
  playAreaElement.style.backgroundPosition =
    `${-fallbackCameraX * cameraZoom}px ${-fallbackCameraY * cameraZoom}px, ` +
    `${-fallbackCameraX * cameraZoom}px ${-fallbackCameraY * cameraZoom}px, ` +
    `${-fallbackCameraX * cameraZoom}px ${-fallbackCameraY * cameraZoom}px, ` +
    `${-fallbackCameraX * cameraZoom}px ${-fallbackCameraY * cameraZoom}px`;

  positionFallbackMarker(
    fallbackCenterMarkerElement,
    GAME_CONFIG.world.width / 2,
    GAME_CONFIG.world.height / 2
  );
  if (fallbackCenterMarkerElement) {
    fallbackCenterMarkerElement.hidden = true;
  }

  const localPlayer = getLocalPlayer();
  const localDisplayState = ensureLocalRenderState();
  if (fallbackPlayerMarkerElement) {
    fallbackPlayerMarkerElement.hidden = !(localPlayer && !localPlayer.isSpectator);
  }

  if (localPlayer && !localPlayer.isSpectator && localDisplayState) {
    setFallbackMarkerScale(fallbackPlayerMarkerElement);
    positionFallbackMarker(fallbackPlayerMarkerElement, localDisplayState.x, localDisplayState.y);
  }

  syncFallbackRemoteMarkers();
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
    if (option.summary) {
      element.title = option.summary;
    }
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

function getLobbyMapConfig(mapId) {
  return GAME_CONFIG.lobby.maps.find((map) => map.id === mapId) ?? GAME_CONFIG.lobby.maps[0];
}

function getPreferredQuickJoinRoomCode() {
  const candidate = String(initialRoomFromUrl ?? "")
    .trim()
    .toLowerCase();

  if (!candidate || candidate === "default") {
    return null;
  }

  return candidate;
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
  const preferredRoomCode = getPreferredQuickJoinRoomCode();
  if (preferredRoomCode) {
    return preferredRoomCode;
  }

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
  const delayMs = Math.min(
    GAME_CONFIG.session.maxReconnectRetryMs ?? GAME_CONFIG.session.reconnectRetryMs,
    GAME_CONFIG.session.reconnectRetryMs * 2 ** Math.min(reconnectAttempts - 1, 3)
  );
  const delaySeconds = Number((delayMs / 1000).toFixed(1));
  const closeSuffix = lastSocketCloseInfo ? ` | last close ${formatSocketCloseInfo(lastSocketCloseInfo)}` : "";
  setStatus(`Reconnecting (${reconnectAttempts}) in ${delaySeconds}s...${closeSuffix}`);
  matchStatusElement.textContent = "Trying to recover your match session";

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect({ isReconnect: true });
  }, delayMs);
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

function hasPendingReliableMessage(type) {
  for (const entry of pendingReliableMessages.values()) {
    if (entry.payload.type === type) {
      return true;
    }
  }

  return false;
}

function queueReliableMessage(payload) {
  if (payload.type === MESSAGE_TYPES.READY || payload.type === MESSAGE_TYPES.RESYNC) {
    clearPendingReliableMessages(MESSAGE_TYPES.READY);
    clearPendingReliableMessages(MESSAGE_TYPES.RESYNC);
  }

  if (payload.type === MESSAGE_TYPES.RESPAWN) {
    clearPendingReliableMessages(MESSAGE_TYPES.RESPAWN);
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

function getRemoteInterpolationBackTimeMs() {
  const halfRtt = latestLatencyMs > 0 ? latestLatencyMs * 0.5 : NETWORK_RENDER.interpolationBackTimeMs;
  return clamp(
    Math.round(halfRtt + 8),
    NETWORK_RENDER.minInterpolationBackTimeMs,
    NETWORK_RENDER.interpolationBackTimeMs
  );
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

function getTurretVisualSmoothing(deltaSeconds) {
  return clamp(1 - Math.exp(-20 * deltaSeconds), 0.2, 0.42);
}

function getRecoilKickSmoothing(deltaSeconds) {
  return clamp(1 - Math.exp(-28 * deltaSeconds), 0.24, 0.58);
}

function getRecoilRecoverySmoothing(deltaSeconds) {
  return clamp(1 - Math.exp(-8 * deltaSeconds), 0.08, 0.22);
}

function triggerShotRecoil(player, now, options = {}) {
  if (!player) {
    return;
  }

  player.muzzleFlashUntil = now + 90;
  player.recoilTarget = Math.max(player.recoilTarget ?? 0, options.strength ?? 0.74);

  if (options.predicted) {
    player.lastPredictedRecoilAt = now;
  }
}

function updateVisualRecoil(player, deltaSeconds) {
  if (!player) {
    return;
  }

  const currentRecoil = player.predictedRecoil ?? 0;
  const recoilTarget = player.recoilTarget ?? 0;
  player.predictedRecoil = lerp(currentRecoil, recoilTarget, getRecoilKickSmoothing(deltaSeconds));
  player.recoilTarget = lerp(recoilTarget, 0, getRecoilRecoverySmoothing(deltaSeconds));

  if (Math.abs(player.predictedRecoil) <= 0.001) {
    player.predictedRecoil = 0;
  }

  if (Math.abs(player.recoilTarget) <= 0.001) {
    player.recoilTarget = 0;
  }
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
      if (player.id === localPlayerId && now - (player.lastPredictedRecoilAt ?? -Infinity) <= 220) {
        player.muzzleFlashUntil = Math.max(player.muzzleFlashUntil ?? 0, now + 90);
        break;
      }

      triggerShotRecoil(player, now);
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
      if (event.targetId === localPlayerId) {
        triggerCameraShake(Math.min(10, (event.damage ?? 5) * 0.3));
      }
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

function getPointerViewportPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    normalizedX: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
    normalizedY: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
  };
}

function getPointerWorldPositionFromViewport(pointerViewportPosition = lastPointerViewportPosition) {
  const visibleViewport = getVisibleViewportSize();
  const normalizedX = clamp(pointerViewportPosition?.normalizedX ?? 0.5, 0, 1);
  const normalizedY = clamp(pointerViewportPosition?.normalizedY ?? 0.5, 0, 1);

  return {
    x: clamp(
      camera.x + normalizedX * visibleViewport.width,
      0,
      GAME_CONFIG.world.width
    ),
    y: clamp(
      camera.y + normalizedY * visibleViewport.height,
      0,
      GAME_CONFIG.world.height
    )
  };
}

function getPointerWorldPosition(event) {
  return getPointerWorldPositionFromViewport(getPointerViewportPosition(event));
}

function updateTrackedPointerPosition(event) {
  lastPointerViewportPosition = getPointerViewportPosition(event);
  lastPointerWorldPosition = getPointerWorldPositionFromViewport(lastPointerViewportPosition);
  return lastPointerWorldPosition;
}

function refreshPointerWorldPosition() {
  lastPointerWorldPosition = getPointerWorldPositionFromViewport(lastPointerViewportPosition);
  return lastPointerWorldPosition;
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
  refreshPointerWorldPosition();
}

function getVisibleViewportSize() {
  return {
    width: canvas.width / cameraZoom,
    height: canvas.height / cameraZoom
  };
}

function getActiveMapLayout() {
  return getMapLayout(latestLobby?.mapId ?? mapSelect?.value ?? GAME_CONFIG.lobby.maps[0]?.id);
}

function clampCameraPosition(x, y) {
  const viewport = getVisibleViewportSize();
  return {
    x: clamp(x, 0, Math.max(0, GAME_CONFIG.world.width - viewport.width)),
    y: clamp(y, 0, Math.max(0, GAME_CONFIG.world.height - viewport.height))
  };
}

function getCameraFocusTarget() {
  const renderState = ensureLocalRenderState();

  if (renderState) {
    if (!cameraHasAnchor) {
      cameraAnchorX = renderState.x;
      cameraAnchorY = renderState.y;
      cameraHasAnchor = true;
    }

    return {
      x: renderState.x,
      y: renderState.y
    };
  }

  if (cameraHasAnchor) {
    return {
      x: cameraAnchorX,
      y: cameraAnchorY
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

function updateCamera(deltaSeconds) {
  const focus = getCameraFocusTarget();
  const viewport = getVisibleViewportSize();
  const target = clampCameraPosition(focus.x - viewport.width / 2, focus.y - viewport.height / 2);

  if (cameraNeedsSnap) {
    camera.x = target.x;
    camera.y = target.y;
    cameraNeedsSnap = false;
    return;
  }

  const followAmount = clamp(1 - Math.exp(-14 * deltaSeconds), 0.12, 0.55);
  camera.x = lerp(camera.x, target.x, followAmount);
  camera.y = lerp(camera.y, target.y, followAmount);
  const clamped = clampCameraPosition(camera.x, camera.y);
  camera.x = clamped.x;
  camera.y = clamped.y;
}

function triggerCameraShake(intensity) {
  const angle = Math.random() * Math.PI * 2;
  cameraShakeX += Math.cos(angle) * intensity;
  cameraShakeY += Math.sin(angle) * intensity;
}

function updateCameraShake(deltaSeconds) {
  const decay = clamp(1 - Math.exp(-18 * deltaSeconds), 0.2, 0.9);
  cameraShakeX = lerp(cameraShakeX, 0, decay);
  cameraShakeY = lerp(cameraShakeY, 0, decay);
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

function crossedOwnSpawnBoundary(teamId, previousX, nextX) {
  if (!Number.isFinite(previousX) || !Number.isFinite(nextX)) {
    return false;
  }

  const zone = getTeamSpawnZone(teamId);
  if (!zone) {
    return false;
  }

  const boundary = zone.spawnSide === "left" ? zone.right : zone.left;
  const wasInside = zone.spawnSide === "left" ? previousX <= boundary : previousX >= boundary;
  const isInside = zone.spawnSide === "left" ? nextX <= boundary : nextX >= boundary;
  return wasInside !== isInside;
}

function isCombatPhase(phase) {
  return phase === MATCH_PHASES.LIVE_ROUND || phase === MATCH_PHASES.OVERTIME;
}

function isMovementPhase(phase) {
  return phase === MATCH_PHASES.WAITING || phase === MATCH_PHASES.WARMUP || isCombatPhase(phase);
}

function canShootPhase(phase) {
  return isMovementPhase(phase);
}

function isResultsPhase(phase) {
  return phase === MATCH_PHASES.RESULTS;
}

function shouldShowResultsPhase(phase) {
  return phase === MATCH_PHASES.ROUND_END || phase === MATCH_PHASES.RESULTS;
}

function canSimulateLocalPlayer() {
  const localPlayer = getLocalPlayer();
  return isMovementPhase(latestMatch?.phase) && localPlayer && !localPlayer.isSpectator;
}

function canPredictLocalShots() {
  const localPlayer = getLocalPlayer();
  return canShootPhase(latestMatch?.phase) && localPlayer && !localPlayer.isSpectator;
}

function getLocalTankClassDef() {
  return CLASS_TREE[localTankClassId] ?? CLASS_TREE.basic;
}

function getLocalStatValue(statName) {
  return localStats?.[statName] ?? 0;
}

function getEffectiveLocalMoveSpeed() {
  return GAME_CONFIG.tank.speed * (1 + getLocalStatValue("movementSpeed") * 0.07);
}

function getEffectiveLocalReloadMs() {
  const classDef = getLocalTankClassDef();
  const classReloadMs = classDef.reloadMs ?? GAME_CONFIG.tank.shootCooldownMs;
  return Math.max(50, classReloadMs * (1 - getLocalStatValue("reload") * 0.065));
}

function getEffectiveLocalBulletSpeed() {
  const classDef = getLocalTankClassDef();
  return (classDef.bulletSpeed ?? GAME_CONFIG.bullet.speed) * (1 + getLocalStatValue("bulletSpeed") * 0.08);
}

function getEffectiveLocalBulletRadius() {
  return getLocalTankClassDef().bulletRadius ?? GAME_CONFIG.bullet.radius;
}

function formatRespawnDelay(ms) {
  const seconds = Math.max(0, ms) / 1000;
  return seconds >= 10 ? `${Math.ceil(seconds)}s` : `${seconds.toFixed(1)}s`;
}

function refreshDeathOverlay(localPlayer = getLocalPlayer(), you = latestYou) {
  if (!deathOverlayElement || !respawnButton) {
    return;
  }

  const isSpectator = you?.isSpectator ?? localPlayer?.isSpectator ?? false;
  const alive = localPlayer?.alive ?? you?.alive ?? true;
  const respawnAt = localPlayer?.respawnAt ?? you?.respawnAt ?? null;
  const waitingForAck = hasPendingReliableMessage(MESSAGE_TYPES.RESPAWN);
  const hasRespawnTimer = Number.isFinite(respawnAt);
  const remainingMs = hasRespawnTimer ? Math.max(0, respawnAt - estimateServerTime()) : 0;
  const canRespawn = Boolean(currentRoomId) && hasRespawnTimer && remainingMs <= 0 && socket?.readyState === WebSocket.OPEN;
  const shouldShow = Boolean(currentRoomId && !isSpectator && (localPlayer || you) && !alive);

  deathOverlayElement.hidden = !shouldShow;
  if (!shouldShow) {
    return;
  }

  if (!hasRespawnTimer) {
    respawnButton.disabled = true;
    respawnButton.textContent = "Respawn";
    return;
  }

  respawnButton.disabled = !canRespawn || waitingForAck;
  respawnButton.textContent = waitingForAck && canRespawn
    ? "Respawning..."
    : canRespawn
      ? "Respawn"
      : `Respawn ${formatRespawnDelay(remainingMs)}`;
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
  refreshDeathOverlay(localPlayer, you);
}

function refreshLobbyUi(localPlayer = getLocalPlayer(), you = latestYou) {
  if (!currentRoomId && !latestLobby) {
    setElementText(roomLabelElement, roomInput.value || "-");
    setElementText(lobbyRoomCodeElement, `Room code: ${roomInput.value || "-"}`);
    setElementText(lobbySummaryElement, "Connect deploys you straight into the arena using these room and loadout defaults.");
    mapSelect.value = GAME_CONFIG.lobby.maps[0].id;
    teamSelect.value = GAME_CONFIG.lobby.teams[0].id;
    classSelect.value = GAME_CONFIG.lobby.classes[0].id;
    mapSelect.disabled = true;
    teamSelect.disabled = true;
    classSelect.disabled = true;
    renderResultsList();
    return;
  }

  const roomCode = latestLobby?.roomCode ?? currentRoomId ?? roomInput.value ?? "-";
  const activeMapConfig = getLobbyMapConfig(latestLobby?.mapId ?? GAME_CONFIG.lobby.maps[0].id);
  const mapName = latestLobby?.mapName ?? activeMapConfig.name;
  const mapSummary = activeMapConfig?.summary ?? "Arena";
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

  setElementText(lobbyRoomCodeElement, `Room code: ${roomCode}`);
  setElementText(
    lobbySummaryElement,
    `${ownerName} owns this room | ${mapName} | ${mapSummary} | ${activePlayers}/${GAME_CONFIG.session.maxHumanPlayersPerRoom} active | ${spectators} spectators` +
    stageHint +
    (isResultsPhase(phase) && activePlayers > 0
      ? ` | ${rematchVotes}/${activePlayers} rematch votes`
      : "")
  );
  setElementText(roomLabelElement, `${roomCode}${latestLobby ? ` | ${latestLobby.mapName}` : ""}`);

  mapSelect.value = latestLobby?.mapId ?? GAME_CONFIG.lobby.maps[0].id;
  teamSelect.value = playerTeamId;
  classSelect.value = playerClassId;

  mapSelect.disabled = !canEditMap;
  teamSelect.disabled = !canEditLoadout;
  classSelect.disabled = !canEditLoadout;

  renderResultsList();
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
    const mapConfig = getLobbyMapConfig(room.mapId);

    const meta = document.createElement("div");
    meta.className = "room-browser-meta";
    meta.innerHTML = `<div class="room-browser-title">${escapeHtml(room.roomCode)}</div><div>${escapeHtml(room.mapName)} | ${escapeHtml(room.phase)}</div><div>${escapeHtml(mapConfig?.summary ?? "Arena")}</div><div>${room.activePlayers}/${room.maxPlayers} active | ${room.spectators} spectators</div>`;

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
  return getActiveMapLayout().obstacles.some((obstacle) => circleIntersectsRect(x, y, radius, obstacle));
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
    shoot: pointerPrimaryDown || keys.has("Space")
  };
}

function simulateTankMovement(state, input, deltaSeconds) {
  const moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const moveY = (input.back ? 1 : 0) - (input.forward ? 1 : 0);
  const moveMagnitude = Math.hypot(moveX, moveY);
  const normalizedMoveX = moveMagnitude > 0 ? moveX / moveMagnitude : 0;
  const normalizedMoveY = moveMagnitude > 0 ? moveY / moveMagnitude : 0;
  const nextAngle = moveMagnitude > 0 ? Math.atan2(normalizedMoveY, normalizedMoveX) : state.angle;
  const moveSpeed = moveMagnitude > 0 ? getEffectiveLocalMoveSpeed() : 0;
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
  const origin = localRenderState ?? {
    x: getPlayerVisualX(localPlayer),
    y: getPlayerVisualY(localPlayer)
  };
  const classDef = getLocalTankClassDef();
  const shotBarrels = classDef.barrels ?? [{ x: 40, y: 0, w: 40, h: 14 }];
  const projectileRadius = getEffectiveLocalBulletRadius();
  const projectileSpeed = getEffectiveLocalBulletSpeed();

  shotBarrels.forEach((barrel, index) => {
    const barrelAngle = barrel.autoRotate
      ? estimateServerTime(now) / 1000 * AUTO_BARREL_ROT_SPEED
      : inputFrame.turretAngle + (barrel.angle ?? 0);
    const lateralOffset = barrel.y ?? 0;
    const bRightX = -Math.sin(barrelAngle);
    const bRightY = Math.cos(barrelAngle);
    const muzzleDistance = GAME_CONFIG.tank.radius + 8;
    const muzzleX =
      origin.x + Math.cos(barrelAngle) * muzzleDistance + bRightX * lateralOffset;
    const muzzleY =
      origin.y + Math.sin(barrelAngle) * muzzleDistance + bRightY * lateralOffset;

    predictedProjectiles.set(`predicted:${inputFrame.seq}:${index}`, {
      id: `predicted:${inputFrame.seq}:${index}`,
      ownerId: localPlayerId,
      x: muzzleX,
      y: muzzleY,
      angle: barrelAngle,
      radius: projectileRadius,
      renderX: muzzleX,
      renderY: muzzleY,
      previousRenderX: muzzleX,
      previousRenderY: muzzleY,
      renderAngle: barrelAngle,
      renderSpeed: projectileSpeed,
      bornAt: now,
      expiresAt: now + Math.min(450, GAME_CONFIG.bullet.lifeMs)
    });
  });

  triggerShotRecoil(localPlayer, now, { predicted: true });
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
  const visualState = ensureLocalVisualState(localPlayer);
  const renderState = ensureLocalRenderState();
  const target = refreshPointerWorldPosition();
  const seq = nextInputSeq++;
  const capturedInputState = getCapturedInputState();
  const aimOrigin = renderState ?? visualState;
  const turretAngle = aimOrigin
    ? Math.atan2(target.y - aimOrigin.y, target.x - aimOrigin.x)
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
    projectile.previousRenderX = projectile.renderX ?? projectile.x;
    projectile.previousRenderY = projectile.renderY ?? projectile.y;
    projectile.x += Math.cos(projectile.angle) * GAME_CONFIG.bullet.speed * deltaSeconds;
    projectile.y += Math.sin(projectile.angle) * GAME_CONFIG.bullet.speed * deltaSeconds;
    projectile.renderX = projectile.x;
    projectile.renderY = projectile.y;
    projectile.renderAngle = projectile.angle;
    projectile.renderSpeed = GAME_CONFIG.bullet.speed;

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

  const visualState = ensureLocalVisualState(localPlayer);
  if (visualState) {
    visualState.x = correctedState.x;
    visualState.y = correctedState.y;
    visualState.angle = correctedState.angle;
    visualState.turretAngle = correctedState.turretAngle;
  }

  if (!localRenderState || !hasMovementInputActive()) {
    localRenderState = {
      x: correctedState.x,
      y: correctedState.y,
      angle: correctedState.angle,
      turretAngle: correctedState.turretAngle
    };
  }
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
    const hasPendingOlderFullSnapshot = Array.from(stateChunks.keys()).some((pendingSeq) => pendingSeq < snapshotSeq);
    if (hasPendingOlderFullSnapshot) {
      return;
    }
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

  // Update shapes
  if (Array.isArray(payload.shapes)) {
    const shapeIds = new Set(payload.shapes.map((s) => s.id));
    for (const [id, shape] of shapes.entries()) {
      if (!shapeIds.has(id)) {
        spawnShapeDeathParticles(shape);
        shapes.delete(id);
      }
    }
    for (const shape of payload.shapes) {
      if (shape && shape.id) {
        const existing = shapes.get(shape.id);
        if (existing) shape.renderAngle = existing.renderAngle ?? existing.angle;
        shapes.set(shape.id, shape);
      }
    }
  }

  // Update local XP/level state from 'you' field
  if (payload.you) {
    const prevUpgrades = localPendingUpgrades;
    localXp = payload.you.xp ?? localXp;
    localLevel = payload.you.level ?? localLevel;
    localStatPoints = payload.you.statPoints ?? localStatPoints;
    localPendingUpgrades = payload.you.pendingUpgrades ?? localPendingUpgrades;
    localTankClassId = payload.you.tankClassId ?? localTankClassId;
    localStats = normalizeAllocatedStats(payload.you.stats, localStats);
    if (localPendingUpgrades.length > 0 && prevUpgrades.length === 0) {
      upgradeMenuOpen = true;
    }
  }

  consumeServerEvents(payload.events ?? []);

  const localPlayer = getLocalPlayer();
  if (localPlayer) {
    ensureLocalVisualState(localPlayer);
    if (!hasSeenLocalPlayerSnapshot) {
      cameraNeedsSnap = true;
      hasSeenLocalPlayerSnapshot = true;
      ensureLocalRenderState(true);
      updateSessionChrome();
      setStatus("Connected");
    }

    setElementText(
      playerLabelElement,
      `${localPlayer.name}${localPlayer.isSpectator ? " [SPEC]" : ""} (HP ${Math.round(localPlayer.hp ?? 0)}/${Math.round(localPlayer.maxHp ?? payload.you?.maxHp ?? GAME_CONFIG.tank.hitPoints)} | ${getTeamName(localPlayer.teamId)}/${localPlayer.tankClassId ?? localTankClassId} | ${localPlayer.score}/${localPlayer.assists ?? 0}/${localPlayer.deaths} | ${localPlayer.credits} cr)`
    );

    if (payload.you) {
      localPlayer.maxHp = payload.you.maxHp ?? localPlayer.maxHp;
      localPlayer.tankClassId = payload.you.tankClassId ?? localPlayer.tankClassId ?? localTankClassId;
      localPlayer.stats = normalizeAllocatedStats(payload.you.stats, localPlayer.stats ?? localStats);
      refreshSessionUi(localPlayer, payload.you);
      replayPendingInputs(
        localPlayer,
        payload.you.lastProcessedInputSeq ?? 0,
        payload.you.lastProcessedInputClientSentAt ?? 0
      );
      setElementText(
        profileLabelElement,
        `${payload.you.profileId.slice(0, 8)} | ${payload.you.profileStats.kills}K/${payload.you.profileStats.deaths}D`
      );
    }
  } else if (payload.you) {
    refreshSessionUi(null, payload.you);
    if (!payload.you.isSpectator && currentRoomId) {
      setStatus("Joined room. Waiting for local player state...");
    }
  }

  refreshLobbyUi(localPlayer, payload.you ?? latestYou);
  refreshDeathOverlay(localPlayer, payload.you ?? latestYou);

  setElementText(
    roundLabelElement,
    latestMatch ? `#${latestMatch.roundNumber || 0} | ${latestMatch.phase}` : "-"
  );
  setElementText(matchStatusElement, buildMatchStatusText());

  if (Array.isArray(payload.leaderboard)) {
    renderScoreboard(payload.leaderboard);
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
    chunks: new Array(chunkCount).fill(null)
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

  // Keep a dense array here; sparse holes are skipped by some()/every() and can
  // make a single received fragment look like a complete snapshot.
  if (!existing.chunks.every((chunk) => typeof chunk === "string")) {
    return;
  }

  stateChunks.delete(snapshotSeq);

  try {
    const rebuilt = deserializePacket(existing.chunks.join(""), {
      allowLargePacket: true
    });
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
    const ruleText = latestMatch.respawnsEnabled
      ? " | respawns on"
      : ` | first to ${latestMatch.scoreToWin}`;
    if (latestMatch.phaseEndsAt === null) {
      return `${latestMatch.message}${objectiveText}${spectatorSuffix}`;
    }
    return `${latestMatch.message} | ${secondsLeft}s left${ruleText}${objectiveText}${spectatorSuffix}`;
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
    shapes.clear();
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
    latestLatencyMs = 0;
    lastServerMessageAt = 0;
    lastRenderFrameAt = performance.now();
    localXp = 0;
    displayXp = 0;
    localLevel = 1;
    localStatPoints = 0;
    localPendingUpgrades = [];
    localTankClassId = "basic";
    localStats = createEmptyAllocatedStats();
    upgradeMenuOpen = false;
    camera.x = 0;
    camera.y = 0;
    cameraNeedsSnap = true;
    resetCameraAnchor();
    hasSeenLocalPlayerSnapshot = false;
    processedEventIds.clear();
    processedEventOrder.length = 0;
    lastScoreboardRenderKey = "";
    lastResultsRenderKey = "";
    renderScoreboard([]);
    renderKillFeed();
    localPlayerId = null;
    currentRoomId = null;
    updateSessionChrome();
    setReadyButton(false);
    latestLatencyMs = 0;
    latencyElement.textContent = "--";
    setElementText(matchStatusElement, "Waiting for server");
    refreshLobbyUi();
  }

  setStatus(isReconnect ? "Reconnecting to server..." : "Connecting to server...");
  setElementText(roomLabelElement, roomInput.value || "default");
  setElementText(playerLabelElement, nameInput.value || "Commander");

  const nextSocket = new WebSocket(buildSocketUrl());
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    cancelReconnect();
    lastServerMessageAt = Date.now();
    lastSocketCloseInfo = null;
    setStatus("Connected to server. Requesting match...");
    sendReliable({
      type: MESSAGE_TYPES.JOIN,
      name: nameInput.value,
      roomId: roomInput.value,
      profileId,
      authToken,
      sessionId: clientSessionId,
      spectate: spectateInput.checked,
      mapId: mapSelect.value,
      teamId: teamSelect.value,
      classId: classSelect.value,
      gameVersion: GAME_BUILD_VERSION,
      assetVersion: ASSET_BUNDLE_VERSION
    });
  });

  nextSocket.addEventListener("message", (event) => {
    lastServerMessageAt = Date.now();
    const parsed = deserializePacket(String(event.data));
    if (!parsed.ok) {
      setStatus(parsed.error.message);
      if (parsed.error.code === "unsupported_version" || parsed.error.code === "invalid_version") {
        joinInProgress = false;
        updateSessionChrome();
        requestCompatibilityRefresh("protocol");
      }
      return;
    }

    const payload = parsed.packet;

    if (payload.type === MESSAGE_TYPES.JOINED) {
      clearPendingReliableMessages(MESSAGE_TYPES.JOIN);
      if (payload.gameVersion && payload.gameVersion !== GAME_BUILD_VERSION) {
        if (requestCompatibilityRefresh("game-version")) {
          return;
        }
        setStatus(`Connected to a newer server build (${payload.gameVersion}). Refreshing...`);
      }
      if (payload.assetVersion && payload.assetVersion !== ASSET_BUNDLE_VERSION) {
        if (requestCompatibilityRefresh("asset-version")) {
          return;
        }
        setStatus(`Connected with newer assets available (${payload.assetVersion}). Refreshing...`);
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
      latestLatencyMs = Math.max(0, Date.now() - Number(payload.sentAt));
      latencyElement.textContent = `${latestLatencyMs} ms`;
      return;
    }

    if (payload.type === MESSAGE_TYPES.ERROR) {
      setStatus(payload.message);

      if (!currentRoomId) {
        joinInProgress = false;
        updateSessionChrome();
      }

      if (payload.code === "game_version_mismatch") {
        if (requestCompatibilityRefresh("game-version")) {
          return;
        }
        setStatus(`${payload.message} Refreshing...`);
      }

      if (payload.code === "invalid_auth_token") {
        authToken = null;
        localStorage.removeItem(STORAGE_KEYS.authToken);
        setStatus("Sign-in expired. Continuing as a guest.");
      }

      if (payload.code === "asset_version_mismatch") {
        if (requestCompatibilityRefresh("asset-version")) {
          return;
        }
        setStatus(`${payload.message} Refreshing...`);
      }

      if (payload.code === "unsupported_version") {
        requestCompatibilityRefresh("protocol");
      }
    }
  });

  nextSocket.addEventListener("close", (event) => {
    if (socket !== nextSocket) {
      return;
    }

    const closeInfo = rememberSocketClose(event);
    socket = null;
    joinInProgress = false;

    if (nextSocket.skipReconnect) {
      updateSessionChrome();
      return;
    }

    if (event.code === 4001) {
      rotateClientSessionId();
      setStatus(`This session was claimed elsewhere. Rejoining with a fresh local session... | ${formatSocketCloseInfo(closeInfo)}`);
      pendingInputs.length = 0;
      currentRoomId ||= roomInput.value || "default";
      scheduleReconnect();
      return;
    }

    if (event.code === 4009) {
      requestCompatibilityRefresh("game-version");
      return;
    }

    if (event.code === 4010) {
      requestCompatibilityRefresh("asset-version");
      return;
    }

    if (event.code === 4006) {
      requestCompatibilityRefresh("protocol");
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
    shapes.clear();
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
    lastServerMessageAt = 0;
    serverTimeOffset = 0;
    stateChunks.clear();
    processedEventIds.clear();
    processedEventOrder.length = 0;
    lastScoreboardRenderKey = "";
    lastResultsRenderKey = "";
    renderScoreboard([]);
    combatEffects.length = 0;
    killFeedEntries.length = 0;
    renderKillFeed();
    pendingInputs.length = 0;
    lastStallWarningAt = 0;
    localXp = 0;
    displayXp = 0;
    localLevel = 1;
    localStatPoints = 0;
    localPendingUpgrades = [];
    localTankClassId = "basic";
    localStats = createEmptyAllocatedStats();
    upgradeMenuOpen = false;
    camera.x = 0;
    camera.y = 0;
    cameraNeedsSnap = true;
    resetCameraAnchor();
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

function sendRespawn() {
  const localPlayer = getLocalPlayer();
  const isSpectator = localPlayer?.isSpectator ?? latestYou?.isSpectator ?? false;
  const alive = localPlayer?.alive ?? latestYou?.alive ?? true;
  const respawnAt = localPlayer?.respawnAt ?? latestYou?.respawnAt ?? null;

  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN ||
    !currentRoomId ||
    isSpectator ||
    alive ||
    !Number.isFinite(respawnAt) ||
    estimateServerTime() < respawnAt ||
    hasPendingReliableMessage(MESSAGE_TYPES.RESPAWN)
  ) {
    return;
  }

  sendReliable({
    type: MESSAGE_TYPES.RESPAWN
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
  const renderServerTime = estimateServerTime(frameAt) - getRemoteInterpolationBackTimeMs();

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
      const crossedSpawnBoundary = crossedOwnSpawnBoundary(player.teamId, previousDisplayX, sample.x);
      const shouldSnap =
        crossedSpawnBoundary ||
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
    updateVisualRecoil(player, deltaSeconds);
    const blendedMotion = Math.min(1, (distanceMoved / Math.max(0.001, deltaSeconds)) / GAME_CONFIG.tank.speed);
    updateVisualAnimationState(player, blendedMotion);
    player.displayHp = lerp(player.displayHp ?? player.hp, player.hp, clamp(1 - Math.exp(-10 * deltaSeconds), 0.1, 0.6));
  }

  const shapeAngleSmoothing = clamp(1 - Math.exp(-6 * deltaSeconds), 0.08, 0.4);
  for (const shape of shapes.values()) {
    shape.renderAngle = lerpAngle(shape.renderAngle ?? shape.angle ?? 0, shape.angle ?? 0, shapeAngleSmoothing);
  }

  for (const bullet of bullets.values()) {
    const sample = sampleNetworkHistory(bullet, "bullet", renderServerTime) ?? {
      x: bullet.x,
      y: bullet.y,
      angle: bullet.angle,
      speed: GAME_CONFIG.bullet.speed
    };
    const currentBulletX = bullet.renderX ?? bullet.x;
    const currentBulletY = bullet.renderY ?? bullet.y;
    const dx = sample.x - currentBulletX;
    const dy = sample.y - currentBulletY;
    const bulletFollowAmount = 0.82;
    const shouldSnap =
      (bullet.teleportFrames ?? 0) > 0 ||
      dx * dx + dy * dy > NETWORK_RENDER.snapDistance * NETWORK_RENDER.snapDistance;

    bullet.previousRenderX = currentBulletX;
    bullet.previousRenderY = currentBulletY;
    if (shouldSnap) {
      bullet.renderX = sample.x;
      bullet.renderY = sample.y;
      bullet.renderAngle = sample.angle;
    } else {
      bullet.renderX = lerp(currentBulletX, sample.x, bulletFollowAmount);
      bullet.renderY = lerp(currentBulletY, sample.y, bulletFollowAmount);
      bullet.renderAngle = lerpAngle(bullet.renderAngle ?? bullet.angle, sample.angle, bulletFollowAmount);
    }
    bullet.renderSpeed = sample.speed ?? GAME_CONFIG.bullet.speed;

    bullet.teleportFrames = Math.max(0, (bullet.teleportFrames ?? 0) - 1);
  }
  setElementText(matchStatusElement, buildMatchStatusText());
}

function drawBackground() {
  const theme = getActiveMapLayout().theme;
  context.fillStyle = theme?.background ?? "#dbe7ff";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function drawMapSquare() {
  const theme = getActiveMapLayout().theme;
  context.fillStyle = theme?.floor ?? "#f3f7ff";
  context.fillRect(0, 0, GAME_CONFIG.world.width, GAME_CONFIG.world.height);

  for (const team of GAME_CONFIG.lobby.teams) {
    const zone = getTeamSpawnZone(team.id);
    context.fillStyle = zone.zoneColor;
    context.fillRect(
      zone.spawnSide === "left" ? 0 : zone.left,
      0,
      zone.spawnSide === "left" ? zone.right : GAME_CONFIG.world.width - zone.left,
      GAME_CONFIG.world.height
    );
  }

  context.lineWidth = 18 / cameraZoom;
  context.strokeStyle = "#1f3f7a";
  context.strokeRect(0, 0, GAME_CONFIG.world.width, GAME_CONFIG.world.height);
}

function drawCenterProbe() {
  // Hidden while we isolate the local player's movement view.
}

function drawGrid() {
  const theme = getActiveMapLayout().theme;
  const minorColor = theme?.gridMinor ?? "rgba(76, 118, 191, 0.36)";
  const majorColor = theme?.gridMajor ?? "rgba(40, 78, 148, 0.72)";
  const cellSize = 40;
  const majorEvery = 5;
  const minorLineWidth = Math.max(1.8 / cameraZoom, 1.4);
  const majorLineWidth = Math.max(5 / cameraZoom, 3.4);

  context.save();

  for (let x = 0, index = 0; x <= GAME_CONFIG.world.width; x += cellSize, index += 1) {
    const isMajor = index % majorEvery === 0;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, GAME_CONFIG.world.height);
    context.lineWidth = isMajor ? majorLineWidth : minorLineWidth;
    context.strokeStyle = isMajor ? majorColor : minorColor;
    context.stroke();
  }

  for (let y = 0, index = 0; y <= GAME_CONFIG.world.height; y += cellSize, index += 1) {
    const isMajor = index % majorEvery === 0;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(GAME_CONFIG.world.width, y);
    context.lineWidth = isMajor ? majorLineWidth : minorLineWidth;
    context.strokeStyle = isMajor ? majorColor : minorColor;
    context.stroke();
  }

  context.restore();
}

function drawObstacles() {
  const mapLayout = getActiveMapLayout();
  if ((mapLayout.obstacles?.length ?? 0) === 0) {
    return;
  }

  context.save();
  for (const obstacle of mapLayout.obstacles) {
    context.fillStyle = "rgba(33, 51, 84, 0.94)";
    context.strokeStyle = "rgba(9, 15, 28, 0.95)";
    context.lineWidth = 5 / cameraZoom;
    context.beginPath();
    context.roundRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 18 / cameraZoom);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawObjective() {
  const mapLayout = getActiveMapLayout();
  const objective = latestObjective ?? {
    x: mapLayout.objective.x,
    y: mapLayout.objective.y,
    radius: mapLayout.objective.radius,
    ownerId: null,
    ownerName: null,
    captureTargetId: null,
    captureTargetName: null,
    captureProgress: 0,
    contested: false
  };
  const objectiveX = objective.x ?? mapLayout.objective.x;
  const objectiveY = objective.y ?? mapLayout.objective.y;
  const objectiveRadius = objective.radius ?? mapLayout.objective.radius;
  const owner = objective.ownerId ? players.get(objective.ownerId) : null;
  const captureTarget = objective.captureTargetId ? players.get(objective.captureTargetId) : null;
  const ownerColor = owner?.color ?? getTeamConfig(owner?.teamId)?.color ?? "#ffd166";
  const captureColor = captureTarget?.color ?? getTeamConfig(captureTarget?.teamId)?.color ?? "#a5f3fc";
  const progress = clamp(objective.captureProgress ?? 0, 0, 1);
  const ringWidth = Math.max(5 / cameraZoom, 2.5);

  context.save();
  context.globalAlpha = 0.92;
  context.fillStyle = objective.ownerId ? `${ownerColor}22` : "rgba(255, 209, 102, 0.12)";
  context.beginPath();
  context.arc(objectiveX, objectiveY, objectiveRadius, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.lineWidth = ringWidth;
  context.strokeStyle = objective.contested ? "rgba(255, 209, 102, 0.95)" : "rgba(255,255,255,0.85)";
  context.arc(objectiveX, objectiveY, objectiveRadius, 0, Math.PI * 2);
  context.stroke();

  if (progress > 0 && objective.captureTargetId) {
    context.beginPath();
    context.lineWidth = Math.max(8 / cameraZoom, 4);
    context.strokeStyle = captureColor;
    context.arc(objectiveX, objectiveY, objectiveRadius + 11 / cameraZoom, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    context.stroke();
  }

  context.fillStyle = objective.ownerId ? ownerColor : "rgba(255,255,255,0.14)";
  context.beginPath();
  context.arc(objectiveX, objectiveY, objectiveRadius * 0.3, 0, Math.PI * 2);
  context.fill();

  context.font = `${Math.max(13 / cameraZoom, 8)}px Segoe UI`;
  context.textAlign = "center";
  context.fillStyle = "#10243b";
  context.fillText(objective.ownerName ?? "OBJ", objectiveX, objectiveY + 4 / cameraZoom);

  context.font = `${Math.max(15 / cameraZoom, 9)}px Segoe UI`;
  context.fillStyle = objective.contested ? "#ffd166" : "#ffffff";
  context.fillText(
    objective.contested
      ? "Contested"
      : objective.captureTargetName
        ? objective.ownerId
          ? objective.ownerName ?? "Objective"
          : `Capturing: ${objective.captureTargetName}`
        : "Objective",
    objectiveX,
    objectiveY - objectiveRadius - 16 / cameraZoom
  );
  context.restore();
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

function getTankRenderPose(player) {
  if (player?.id === localPlayerId && localRenderState) {
    return {
      x: localRenderState.x,
      y: localRenderState.y,
      angle: localRenderState.angle,
      turretAngle: localRenderState.turretAngle
    };
  }

  return {
    x: getPlayerVisualX(player),
    y: getPlayerVisualY(player),
    angle: getPlayerVisualAngle(player),
    turretAngle: getPlayerVisualTurretAngle(player)
  };
}

function getTeamName(teamId) {
  return getTeamConfig(teamId)?.name ?? (typeof teamId === "string" && teamId ? teamId : "Team");
}

function drawTank(player) {
  if (!player || player.isSpectator || !player.alive) {
    return;
  }

  const pose = getTankRenderPose(player);
  const x = pose.x;
  const y = pose.y;
  const bodyAngle = pose.angle;
  const turretAngle = pose.turretAngle;
  const bodyRadius = GAME_CONFIG.tank.radius;
  const isLocalPlayer = player.id === localPlayerId;
  const bodyColor = player.color ?? getTeamConfig(player.teamId)?.color ?? "#ff4d00";
  const alpha = player.connected === false ? 0.42 : 1;

  // Look up class def for barrel rendering
  const effectiveClassId = isLocalPlayer ? localTankClassId : (player.tankClassId ?? player.classId ?? "basic");
  const classDef = CLASS_TREE[effectiveClassId] ?? CLASS_TREE.basic;
  const barrels = classDef.barrels ?? [{ x: 40, y: 0, w: 40, h: 14 }];

  // Draw barrels
  const autoAngle = estimateServerTime() / 1000 * AUTO_BARREL_ROT_SPEED;
  context.save();
  context.globalAlpha = alpha;
  context.translate(x, y);

  for (const barrel of barrels) {
    context.save();
    if (barrel.autoRotate) {
      context.rotate(autoAngle);
    } else {
      context.rotate(turretAngle + (barrel.angle ?? 0));
    }
    context.fillStyle = "#555566";
    context.strokeStyle = "#1a1a2e";
    context.lineWidth = 2;
    const bx = barrel.x > 0 ? 0 : barrel.x - barrel.w / 2;
    const bLen = barrel.w;
    const bH = barrel.h;
    context.fillRect(bx, barrel.y - bH / 2, bLen, bH);
    context.strokeRect(bx, barrel.y - bH / 2, bLen, bH);
    context.restore();
  }
  context.restore();

  // Draw body
  context.save();
  context.globalAlpha = alpha;
  context.translate(x, y);
  context.rotate(bodyAngle);
  context.fillStyle = bodyColor;
  context.beginPath();
  context.arc(0, 0, bodyRadius, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 3;
  context.strokeStyle = "#1a1a2e";
  context.stroke();
  context.restore();

  // Player name above tank
  context.save();
  context.globalAlpha = alpha;
  context.font = "bold 12px Segoe UI";
  context.textAlign = "center";
  context.fillStyle = isLocalPlayer ? "#ffd166" : "#ffffff";
  context.fillText(player.name ?? "", x, y - bodyRadius - 22);
  context.restore();

  // Health bar
  const hpRatio = clamp((Number(player.displayHp ?? player.hp) || 0) / Math.max(1, Number(player.maxHp) || GAME_CONFIG.tank.hitPoints), 0, 1);
  const healthBarWidth = 52;
  const healthBarHeight = 7;
  const healthBarY = y - bodyRadius - 16;
  const healthBarX = x - healthBarWidth / 2;

  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = "rgba(17, 17, 17, 0.88)";
  context.fillRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);
  context.fillStyle = hpRatio > 0.5 ? "#22c55e" : hpRatio > 0.25 ? "#fbbf24" : "#ef4444";
  context.fillRect(healthBarX + 1, healthBarY + 1, Math.max(0, (healthBarWidth - 2) * hpRatio), healthBarHeight - 2);
  context.restore();
}

function drawProjectile(projectile, options = {}) {
  if (!projectile) {
    return;
  }

  const {
    alpha = 1,
    headColor = "#111111"
  } = options;
  const x = projectile.renderX ?? projectile.x;
  const y = projectile.renderY ?? projectile.y;
  const radius = projectile.radius ?? GAME_CONFIG.bullet.radius;

  const prevX = projectile.previousRenderX ?? x;
  const prevY = projectile.previousRenderY ?? y;
  if (Math.hypot(x - prevX, y - prevY) > 1) {
    context.save();
    context.globalAlpha = alpha * 0.35;
    context.strokeStyle = headColor;
    context.lineWidth = radius * 1.4;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(prevX, prevY);
    context.lineTo(x, y);
    context.stroke();
    context.restore();
  }

  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = headColor;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawBullet(bullet) {
  drawProjectile(bullet);
}

function drawPredictedProjectile(projectile) {
  drawProjectile(projectile, {
    alpha: 0.52,
    headColor: "#111111"
  });
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

function drawShape(shape) {
  if (!shape) {
    return;
  }

  // Called inside the camera-transform context (world coordinates)
  const sx = shape.x;
  const sy = shape.y;
  const r = shape.radius ?? 20;

  let fillColor = "#ffb703";
  const sides = shape.type === SHAPE_TYPES.TRIANGLE ? 3 : shape.type === SHAPE_TYPES.SQUARE ? 4 : shape.type === SHAPE_TYPES.PENTAGON ? 5 : 5;
  if (shape.type === SHAPE_TYPES.TRIANGLE) {
    fillColor = "#00d4aa";
  } else if (shape.type === SHAPE_TYPES.SQUARE) {
    fillColor = "#ffb703";
  } else if (shape.type === SHAPE_TYPES.PENTAGON) {
    fillColor = "#4488ff";
  } else if (shape.type === SHAPE_TYPES.ALPHA_PENTAGON) {
    fillColor = "#aa44ff";
  }

  context.save();
  context.translate(sx, sy);
  context.rotate(shape.renderAngle ?? shape.angle ?? 0);
  context.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) {
      context.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    } else {
      context.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
  }
  context.closePath();
  context.fillStyle = fillColor;
  context.fill();
  context.lineWidth = 2.5;
  context.strokeStyle = "#1a1a2e";
  context.stroke();
  context.restore();

  // Health bar if damaged (in world space)
  const maxHp = shape.maxHp ?? shape.hp;
  const hpRatio = maxHp > 0 ? clamp(shape.hp / maxHp, 0, 1) : 1;
  if (hpRatio < 1) {
    const barW = r * 2;
    const barH = 5;
    const bx = sx - r;
    const by = sy - r - 12;
    context.save();
    context.fillStyle = "rgba(0,0,0,0.7)";
    context.fillRect(bx, by, barW, barH);
    context.fillStyle = "#22c55e";
    context.fillRect(bx, by, barW * hpRatio, barH);
    context.restore();
  }
}

function drawShapes() {
  for (const shape of shapes.values()) {
    drawShape(shape);
  }
}

const SHAPE_PARTICLE_COLORS = Object.freeze({
  square: "#fbbf24",
  triangle: "#2dd4bf",
  pentagon: "#60a5fa",
  alpha_pentagon: "#c084fc"
});

function spawnShapeDeathParticles(shape) {
  if (!shape) {
    return;
  }
  const color = SHAPE_PARTICLE_COLORS[shape.type] ?? "#fbbf24";
  const count = shape.type === "alpha_pentagon" ? 12 : shape.type === "pentagon" ? 7 : 5;
  const speed = shape.type === "alpha_pentagon" ? 90 : 55;
  const lifeMs = shape.type === "alpha_pentagon" ? 900 : 600;
  const now = performance.now();

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    shapeParticles.push({
      x: shape.x,
      y: shape.y,
      vx: Math.cos(angle) * speed * (0.6 + Math.random() * 0.8),
      vy: Math.sin(angle) * speed * (0.6 + Math.random() * 0.8),
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 6,
      size: shape.radius * (0.22 + Math.random() * 0.22),
      color,
      bornAt: now,
      lifeMs
    });
  }
}

function drawShapeParticles(now) {
  for (let i = shapeParticles.length - 1; i >= 0; i--) {
    const p = shapeParticles[i];
    const age = now - p.bornAt;
    if (age >= p.lifeMs) {
      shapeParticles.splice(i, 1);
      continue;
    }
    const life = age / p.lifeMs;
    const alpha = (1 - life) * (1 - life);
    const elapsed = age / 1000;
    const px = p.x + p.vx * elapsed;
    const py = p.y + p.vy * elapsed;
    const rotation = p.rotation + p.rotationSpeed * elapsed;

    context.save();
    context.globalAlpha = alpha;
    context.translate(px, py);
    context.rotate(rotation);
    context.fillStyle = p.color;
    context.strokeStyle = "rgba(0,0,0,0.3)";
    context.lineWidth = 1.2;
    const s = p.size * (1 - life * 0.3);
    context.beginPath();
    context.rect(-s / 2, -s / 2, s, s);
    context.fill();
    context.stroke();
    context.restore();
  }
}

function drawXpBar() {
  if (!currentRoomId) {
    return;
  }
  const barWidth = Math.min(600, canvas.width * 0.6);
  const barHeight = 20;
  const barX = (canvas.width - barWidth) / 2;
  const barY = canvas.height - barHeight - 10;

  const currentLevelXp = XP_PER_LEVEL[localLevel - 1] ?? 0;
  const nextLevelXp = XP_PER_LEVEL[localLevel] ?? XP_PER_LEVEL[XP_PER_LEVEL.length - 1];
  const xpIntoLevel = displayXp - currentLevelXp;
  const xpNeeded = Math.max(1, nextLevelXp - currentLevelXp);
  const xpRatio = localLevel >= MAX_LEVEL ? 1 : clamp(xpIntoLevel / xpNeeded, 0, 1);
  const classDef = getLocalTankClassDef();
  const upgradeHint =
    localPendingUpgrades.length > 0
      ? "Upgrade ready"
      : classDef.upgradesAt && localLevel < classDef.upgradesAt
        ? `Next class unlock: Lv ${classDef.upgradesAt}`
        : "Final class";

  context.save();
  // Background
  context.fillStyle = "rgba(0,0,0,0.65)";
  context.beginPath();
  context.roundRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4, 6);
  context.fill();
  // XP fill
  context.fillStyle = "#0080ff";
  context.beginPath();
  context.roundRect(barX, barY, barWidth * xpRatio, barHeight, 4);
  context.fill();
  // Text
  context.font = "bold 12px Segoe UI";
  context.fillStyle = "#ffffff";
  context.textAlign = "left";
  context.fillText(`Lv ${localLevel} ${classDef.name}`, barX + 6, barY + 14);
  context.textAlign = "right";
  if (localLevel < MAX_LEVEL) {
    context.fillText(`${xpIntoLevel} / ${xpNeeded} XP`, barX + barWidth - 6, barY + 14);
  } else {
    context.fillText("MAX LEVEL", barX + barWidth - 6, barY + 14);
  }
  context.textAlign = "center";
  context.fillStyle = localPendingUpgrades.length > 0 ? "#ffd166" : "#dbeafe";
  context.fillText(upgradeHint, barX + barWidth / 2, barY - 8);
  context.restore();
}

function drawMinimap() {
  if (!currentRoomId) {
    return;
  }

  const mapLayout = getActiveMapLayout();
  const panelWidth = 198;
  const panelHeight = 126;
  const panelX = canvas.width - panelWidth - 14;
  const panelY = canvas.height - panelHeight - 14;
  const mapX = panelX + 10;
  const mapY = panelY + 26;
  const mapWidth = panelWidth - 20;
  const mapHeight = panelHeight - 36;
  const viewport = getVisibleViewportSize();

  const projectX = (worldX) => mapX + (clamp(worldX, 0, GAME_CONFIG.world.width) / GAME_CONFIG.world.width) * mapWidth;
  const projectY = (worldY) => mapY + (clamp(worldY, 0, GAME_CONFIG.world.height) / GAME_CONFIG.world.height) * mapHeight;

  context.save();
  context.fillStyle = "rgba(0,0,0,0.56)";
  context.beginPath();
  context.roundRect(panelX, panelY, panelWidth, panelHeight, 10);
  context.fill();

  context.font = "bold 12px Segoe UI";
  context.textAlign = "left";
  context.fillStyle = "#00c8dc";
  context.fillText(latestLobby?.mapName ?? "Arena", panelX + 10, panelY + 16);

  context.fillStyle = "rgba(14, 22, 39, 0.96)";
  context.fillRect(mapX, mapY, mapWidth, mapHeight);

  for (const obstacle of mapLayout.obstacles ?? []) {
    const obstacleX = projectX(obstacle.x);
    const obstacleY = projectY(obstacle.y);
    const obstacleWidth = (obstacle.width / GAME_CONFIG.world.width) * mapWidth;
    const obstacleHeight = (obstacle.height / GAME_CONFIG.world.height) * mapHeight;
    context.fillStyle = "rgba(49, 62, 95, 0.95)";
    context.fillRect(obstacleX, obstacleY, obstacleWidth, obstacleHeight);
  }

  for (const team of GAME_CONFIG.lobby.teams) {
    const zone = getTeamSpawnZone(team.id);
    const zoneLeft = projectX(zone.left);
    const zoneRight = projectX(zone.right);
    context.fillStyle = zone.zoneColor;
    context.fillRect(zoneLeft, mapY, Math.max(1, zoneRight - zoneLeft), mapHeight);
  }

  for (const shape of shapes.values()) {
    const size = shape.type === SHAPE_TYPES.ALPHA_PENTAGON ? 4 : shape.type === SHAPE_TYPES.PENTAGON ? 3 : 1.75;
    const color =
      shape.type === SHAPE_TYPES.ALPHA_PENTAGON
        ? "#c084fc"
        : shape.type === SHAPE_TYPES.PENTAGON
          ? "#60a5fa"
          : shape.type === SHAPE_TYPES.TRIANGLE
            ? "#2dd4bf"
            : "#fbbf24";
    context.fillStyle = color;
    context.beginPath();
    context.arc(projectX(shape.x), projectY(shape.y), size, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = latestObjective?.ownerId ? "#ffffff" : "#ffd166";
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(projectX(latestObjective?.x ?? mapLayout.objective.x), projectY(latestObjective?.y ?? mapLayout.objective.y), 4, 0, Math.PI * 2);
  context.stroke();

  for (const player of players.values()) {
    if (!player?.alive || player.isSpectator) {
      continue;
    }

    const px = projectX(player.x);
    const py = projectY(player.y);
    const isLocalPlayer = player.id === localPlayerId;
    context.fillStyle = isLocalPlayer ? "#ffd166" : (player.color ?? getTeamConfig(player.teamId)?.color ?? "#ffffff");
    context.beginPath();
    context.arc(px, py, isLocalPlayer ? 3.8 : 2.6, 0, Math.PI * 2);
    context.fill();
    if (isLocalPlayer) {
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1.1;
      context.beginPath();
      context.arc(px, py, 5.6, 0, Math.PI * 2);
      context.stroke();
    }
  }

  const viewX = projectX(camera.x);
  const viewY = projectY(camera.y);
  const viewWidth = (viewport.width / GAME_CONFIG.world.width) * mapWidth;
  const viewHeight = (viewport.height / GAME_CONFIG.world.height) * mapHeight;
  context.strokeStyle = "rgba(255,255,255,0.75)";
  context.lineWidth = 1;
  context.strokeRect(viewX, viewY, viewWidth, viewHeight);

  context.strokeStyle = "rgba(255,255,255,0.12)";
  context.strokeRect(mapX, mapY, mapWidth, mapHeight);
  context.restore();
}

const statButtonRects = [];

function allocateLocalStatPoint(statName) {
  if (
    !STAT_NAMES.includes(statName) ||
    !currentRoomId ||
    !socket ||
    socket.readyState !== WebSocket.OPEN ||
    localStatPoints <= 0
  ) {
    return false;
  }

  const currentLevel = localStats?.[statName] ?? 0;
  if (currentLevel >= 7) {
    return false;
  }

  sendReliable({
    type: MESSAGE_TYPES.STAT_POINT,
    statName
  });

  localStatPoints = Math.max(0, localStatPoints - 1);
  localStats = {
    ...localStats,
    [statName]: currentLevel + 1
  };

  const localPlayer = getLocalPlayer();
  if (localPlayer) {
    localPlayer.stats = {
      ...(localPlayer.stats ?? createEmptyAllocatedStats()),
      [statName]: currentLevel + 1
    };
    if (statName === "maxHealth") {
      const previousMaxHp = Number(localPlayer.maxHp) || GAME_CONFIG.tank.hitPoints;
      const nextMaxHp = Math.round(GAME_CONFIG.tank.hitPoints * (1 + (currentLevel + 1) * 0.12));
      localPlayer.maxHp = nextMaxHp;
      localPlayer.hp = Math.min(nextMaxHp, (Number(localPlayer.hp) || previousMaxHp) + (nextMaxHp - previousMaxHp));
    }
  }

  return true;
}

function drawStatPanel() {
  if (!currentRoomId) {
    statButtonRects.length = 0;
    return;
  }

  statButtonRects.length = 0;

  const panelWidth = 252;
  const rowHeight = 32;
  const panelHeight = 54 + STAT_NAMES.length * rowHeight;
  const panelX = 14;
  const panelY = Math.max(14, canvas.height - panelHeight - 56);

  context.save();
  context.fillStyle = "rgba(0,0,0,0.56)";
  context.beginPath();
  context.roundRect(panelX, panelY, panelWidth, panelHeight, 10);
  context.fill();

  context.font = "bold 12px Segoe UI";
  context.textAlign = "left";
  context.fillStyle = "#00c8dc";
  context.fillText("STATS", panelX + 12, panelY + 18);

  context.textAlign = "right";
  context.fillStyle = localStatPoints > 0 ? "#ffd166" : "#dde6ff";
  context.fillText(`PTS ${localStatPoints}`, panelX + panelWidth - 12, panelY + 18);

  for (let index = 0; index < STAT_NAMES.length; index += 1) {
    const statName = STAT_NAMES[index];
    const currentValue = localStats?.[statName] ?? 0;
    const rowY = panelY + 28 + index * rowHeight;
    const labelY = rowY + 12;

    context.textAlign = "left";
    context.font = "11px Segoe UI";
    context.fillStyle = "#f7fbff";
    context.fillText(`${index + 1}. ${STAT_LABELS[statName] ?? statName}`, panelX + 12, labelY);

    const barsX = panelX + 12;
    const barsY = rowY + 16;
    for (let barIndex = 0; barIndex < 7; barIndex += 1) {
      context.fillStyle = barIndex < currentValue ? "#00c8dc" : "rgba(255,255,255,0.14)";
      context.fillRect(barsX + barIndex * 18, barsY, 14, 7);
    }

    if (localStatPoints > 0 && currentValue < 7) {
      const buttonX = panelX + panelWidth - 34;
      const buttonY = rowY + 4;
      const buttonW = 20;
      const buttonH = 20;
      context.fillStyle = "rgba(255,209,102,0.95)";
      context.beginPath();
      context.roundRect(buttonX, buttonY, buttonW, buttonH, 5);
      context.fill();
      context.fillStyle = "#111111";
      context.font = "bold 15px Segoe UI";
      context.textAlign = "center";
      context.fillText("+", buttonX + buttonW / 2, buttonY + 15);
      statButtonRects.push({
        x: buttonX,
        y: buttonY,
        w: buttonW,
        h: buttonH,
        statName
      });
    }
  }

  context.restore();
}

function drawCanvasLeaderboard() {
  if (!currentRoomId || !latestLeaderboard || latestLeaderboard.length === 0) {
    return;
  }

  const entries = latestLeaderboard.slice(0, 8);
  const lineH = 20;
  const padX = 14;
  const padY = 10;
  const panelW = 200;
  const panelH = padY * 2 + (entries.length + 1) * lineH;
  const panelX = canvas.width - panelW - 14;
  const panelY = 14;

  context.save();
  context.fillStyle = "rgba(0,0,0,0.55)";
  context.beginPath();
  context.roundRect(panelX, panelY, panelW, panelH, 8);
  context.fill();

  context.font = "bold 12px Segoe UI";
  context.fillStyle = "#00c8dc";
  context.textAlign = "left";
  context.fillText("SCOREBOARD", panelX + padX, panelY + padY + 12);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const y = panelY + padY + (i + 2) * lineH;
    const isLocal = entry.id === localPlayerId;
    context.font = isLocal ? "bold 11px Segoe UI" : "11px Segoe UI";
    context.fillStyle = isLocal ? "#ffd166" : (entry.connected === false ? "#666" : "#dde");
    const teamColor = getTeamConfig(entry.teamId)?.color ?? "#888";
    context.fillStyle = teamColor;
    context.fillRect(panelX + padX, y - 9, 4, 12);
    context.fillStyle = isLocal ? "#ffd166" : (entry.connected === false ? "#666" : "#dde");
    const nameText = (entry.isBot ? "[B] " : "") + (entry.name ?? "?");
    context.fillText(nameText.slice(0, 14), panelX + padX + 8, y);
    context.textAlign = "right";
    context.fillText(`${entry.score ?? 0}`, panelX + panelW - padX, y);
    context.textAlign = "left";
  }
  context.restore();
}

function drawCanvasKillFeed() {
  if (killFeedEntries.length === 0) {
    return;
  }

  const now = performance.now();
  const feedX = 14;
  let feedY = 14;
  const lineH = 22;

  context.save();
  const visible = killFeedEntries.filter((e) => e.expiresAt > now).slice(0, 5);
  for (const entry of visible) {
    const totalDuration = GAME_CONFIG.combat.assistWindowMs;
    const age = (entry.expiresAt - now) / totalDuration;
    const alpha = Math.min(1, age * 4);
    context.globalAlpha = alpha;
    context.fillStyle = "rgba(0,0,0,0.55)";
    const textW = context.measureText(entry.text ?? "").width;
    context.fillRect(feedX - 4, feedY - 14, textW + 16, lineH);
    context.font = "bold 12px Segoe UI";
    context.fillStyle = entry.color ?? "#ffd166";
    context.textAlign = "left";
    context.fillText(entry.text ?? "", feedX + 4, feedY);
    feedY += lineH;
  }
  context.restore();
}

function drawUpgradeMenu() {
  if (!upgradeMenuOpen || localPendingUpgrades.length === 0) {
    upgradeButtonRects.length = 0;
    return;
  }

  upgradeButtonRects.length = 0;

  const cw = canvas.width;
  const ch = canvas.height;
  const cardW = 440;
  const cardH = 80 + localPendingUpgrades.length * 72 + 20;
  const cardX = (cw - cardW) / 2;
  const cardY = (ch - cardH) / 2;

  context.save();
  context.fillStyle = "rgba(0,0,0,0.72)";
  context.fillRect(0, 0, cw, ch);

  context.fillStyle = "rgba(10, 15, 40, 0.96)";
  context.beginPath();
  context.roundRect(cardX, cardY, cardW, cardH, 16);
  context.fill();
  context.strokeStyle = "rgba(0,200,220,0.5)";
  context.lineWidth = 1.5;
  context.stroke();

  context.font = "bold 22px Segoe UI";
  context.fillStyle = "#00c8dc";
  context.textAlign = "center";
  context.fillText("LEVEL UP! Choose your upgrade:", cw / 2, cardY + 44);

  for (let i = 0; i < localPendingUpgrades.length; i++) {
    const classId = localPendingUpgrades[i];
    const classDef = CLASS_TREE[classId];
    if (!classDef) {
      continue;
    }
    const btnX = cardX + 20;
    const btnY = cardY + 68 + i * 72;
    const btnW = cardW - 40;
    const btnH = 58;

    context.fillStyle = "rgba(0,80,180,0.55)";
    context.beginPath();
    context.roundRect(btnX, btnY, btnW, btnH, 10);
    context.fill();
    context.strokeStyle = "rgba(0,200,220,0.4)";
    context.lineWidth = 1;
    context.stroke();

    context.font = "bold 16px Segoe UI";
    context.fillStyle = "#ffffff";
    context.textAlign = "left";
    context.fillText(classDef.name, btnX + 14, btnY + 24);

    context.font = "12px Segoe UI";
    context.fillStyle = "#aaccff";
    const desc = `Reload: ${classDef.reloadMs}ms | Dmg: ${classDef.bulletDamage} | Spd: ${classDef.bulletSpeed}`;
    context.fillText(desc, btnX + 14, btnY + 42);

    // Store button bounds for click handling
    upgradeButtonRects[i] = { x: btnX, y: btnY, w: btnW, h: btnH, classId };
  }
  context.restore();
}

const upgradeButtonRects = [];
function handleStatPointClick(canvasX, canvasY) {
  for (const btn of statButtonRects) {
    if (
      canvasX >= btn.x &&
      canvasX <= btn.x + btn.w &&
      canvasY >= btn.y &&
      canvasY <= btn.y + btn.h &&
      allocateLocalStatPoint(btn.statName)
    ) {
      return true;
    }
  }

  return false;
}

function handleUpgradeClick(canvasX, canvasY) {
  if (!upgradeMenuOpen) {
    return false;
  }
  for (const btn of upgradeButtonRects) {
    if (!btn) {
      continue;
    }
    if (canvasX >= btn.x && canvasX <= btn.x + btn.w && canvasY >= btn.y && canvasY <= btn.y + btn.h) {
      sendReliable({ type: MESSAGE_TYPES.UPGRADE, classId: btn.classId });
      localPendingUpgrades = [];
      localTankClassId = btn.classId;
      upgradeMenuOpen = false;
      return true;
    }
  }
  return false;
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
  try {
    const deltaSeconds = Math.min(0.05, Math.max(0.001, (frameAt - lastRenderFrameAt) / 1000));
    lastRenderFrameAt = frameAt;
    refreshDeathOverlay();

    updateRenderState(deltaSeconds, frameAt);
    updateLocalRenderState(deltaSeconds);
    updateCamera(deltaSeconds);
    updateCameraShake(deltaSeconds);
    updateFallbackVisuals();
    drawBackground();

    context.save();
    context.scale(cameraZoom, cameraZoom);
    context.translate(-camera.x + cameraShakeX, -camera.y + cameraShakeY);
    drawMapSquare();
    drawGrid();
    drawCenterProbe();
    drawObstacles();
    drawObjective();
    // Draw shapes before players
    drawShapes();

    for (const bullet of bullets.values()) {
      drawBullet(bullet);
    }

    for (const projectile of predictedProjectiles.values()) {
      drawPredictedProjectile(projectile);
    }

    for (const player of players.values()) {
      drawTank(player);
    }

    drawShapeParticles(frameAt);
    drawCombatEffects();
    context.restore();

    // Canvas HUD (drawn in screen space, not world space)
    drawCanvasLeaderboard();
    drawCanvasKillFeed();
    drawMinimap();
    displayXp = lerp(displayXp, localXp, clamp(1 - Math.exp(-8 * deltaSeconds), 0.1, 0.5));
    drawXpBar();
    drawStatPanel();
    drawUpgradeMenu();

    if (debugUiEnabled) {
      drawOverlay();
    }
    renderFailure = null;
  } catch (error) {
    renderFailure = error?.message ?? String(error);
    renderLoopStopped = true;
  }

  updateDiagnosticBanner();
  if (!renderLoopStopped) {
    requestAnimationFrame(render);
  }
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

respawnButton?.addEventListener("click", () => {
  unlockAudio();
  sendRespawn();
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

  if (!event.repeat) {
    const statIndex = Number.parseInt(event.key, 10) - 1;
    if (Number.isInteger(statIndex) && statIndex >= 0 && statIndex < STAT_NAMES.length) {
      if (allocateLocalStatPoint(STAT_NAMES[statIndex])) {
        event.preventDefault();
        return;
      }
    }
  }

  keys.add(event.code);
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

window.addEventListener("resize", resizeCanvas);

canvas.addEventListener("pointermove", (event) => {
  updateTrackedPointerPosition(event);
});

canvas.addEventListener("pointerdown", (event) => {
  unlockAudio();
  updateTrackedPointerPosition(event);
  if (event.button === 0) {
    pointerPrimaryDown = true;
  }
});
window.addEventListener("pointerup", (event) => {
  if (event.button === 0) {
    pointerPrimaryDown = false;
  }
});
window.addEventListener("pointercancel", () => {
  pointerPrimaryDown = false;
});
window.addEventListener("blur", () => {
  keys.clear();
  pointerPrimaryDown = false;
});
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
  refreshPointerWorldPosition();
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

  const visualState = ensureLocalVisualState(localPlayer);
  const inputFrame = createInputFrame();
  send(serializeInputFrame(inputFrame));

  if (!canSimulateLocalPlayer() || !localPlayer.alive) {
    return;
  }

  bufferPendingInput(inputFrame);
  if (
    inputFrame.shoot &&
    canPredictLocalShots() &&
    Date.now() - (localPlayer.lastPredictedShotAt ?? 0) >= getEffectiveLocalReloadMs()
  ) {
    localPlayer.lastPredictedShotAt = Date.now();
    spawnPredictedProjectile(localPlayer, inputFrame);
  }

  const predicted = simulateTankMovement(
    {
      x: visualState?.x ?? localPlayer.renderX ?? localPlayer.x,
      y: visualState?.y ?? localPlayer.renderY ?? localPlayer.y,
      angle: visualState?.angle ?? localPlayer.renderAngle ?? localPlayer.angle,
      turretAngle: visualState?.turretAngle ?? localPlayer.renderTurretAngle ?? localPlayer.turretAngle
    },
    inputFrame,
    CLIENT_TICK.fixedDeltaSeconds
  );

  if (visualState) {
    visualState.x = predicted.x;
    visualState.y = predicted.y;
    visualState.angle = predicted.angle;
    visualState.turretAngle = predicted.turretAngle;
  }

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
    now - lastStatePacketAt >= NETWORK_RECOVERY.staleStateWarningMs
  ) {
    if (now - lastStallWarningAt >= NETWORK_RECOVERY.staleStateStatusCooldownMs) {
      lastStallWarningAt = now;
      setStatus("Connection unstable, trying to recover state...");
      requestLifecycleResync("snapshot_stall");
    }
  }
}, 250);

setInterval(() => {
  refreshRoomBrowser();
}, 8000);

// ---- START MENU ----
// Support both new IDs (start-screen/game-screen) and legacy IDs (start-menu/play-area)
const startMenuEl = document.getElementById("start-screen") ?? document.getElementById("start-menu");
const gameScreenEl = document.getElementById("game-screen");
const playAreaEl = document.getElementById("play-area");
const playButton = document.getElementById("play-button");
const startBgCanvas = document.getElementById("bg-canvas") ?? document.getElementById("start-bg");

function showStartMenu() {
  if (startMenuEl) {
    startMenuEl.hidden = false;
    startMenuEl.classList.remove("hidden");
  }
  if (gameScreenEl) {
    gameScreenEl.hidden = true;
  }
  if (playAreaEl) {
    playAreaEl.classList.remove("active");
  }
}

function hideStartMenu() {
  if (startMenuEl) {
    startMenuEl.hidden = true;
    startMenuEl.classList.add("hidden");
  }
  if (gameScreenEl) {
    gameScreenEl.hidden = false;
  }
  if (playAreaEl) {
    playAreaEl.classList.add("active");
  }
}

function startMenuPlay() {
  const nameVal = nameInput?.value?.trim() || createCommanderName();
  if (nameInput) {
    nameInput.value = nameVal;
  }
  hideStartMenu();
  unlockAudio();
  void startQuickJoin();
}

if (playButton) {
  playButton.addEventListener("click", () => {
    startMenuPlay();
  });
}

// Enter key in name input starts the game
if (nameInput && startMenuEl) {
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      startMenuPlay();
    }
  });
}

// Show play area when session is active
const origUpdateSessionChrome = updateSessionChrome;

// Animated start screen background
(function initStartBg() {
  if (!startBgCanvas) {
    return;
  }
  const bgCtx = startBgCanvas.getContext("2d");
  const dots = [];
  let animId = null;

  function resize() {
    startBgCanvas.width = window.innerWidth;
    startBgCanvas.height = window.innerHeight;
  }

  function initDots() {
    dots.length = 0;
    for (let i = 0; i < 80; i++) {
      dots.push({
        x: Math.random() * startBgCanvas.width,
        y: Math.random() * startBgCanvas.height,
        r: Math.random() * 2 + 0.5,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        alpha: Math.random() * 0.5 + 0.15
      });
    }
  }

  function drawBg(t) {
    // Stop animation when start screen is hidden
    const isHidden = startMenuEl
      ? (startMenuEl.hidden || startMenuEl.classList.contains("hidden"))
      : true;
    if (isHidden) {
      animId = null;
      return;
    }
    bgCtx.clearRect(0, 0, startBgCanvas.width, startBgCanvas.height);
    for (const dot of dots) {
      dot.x += dot.vx;
      dot.y += dot.vy;
      if (dot.x < 0) { dot.x = startBgCanvas.width; }
      if (dot.x > startBgCanvas.width) { dot.x = 0; }
      if (dot.y < 0) { dot.y = startBgCanvas.height; }
      if (dot.y > startBgCanvas.height) { dot.y = 0; }
      bgCtx.beginPath();
      bgCtx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      bgCtx.fillStyle = `rgba(0,200,220,${dot.alpha})`;
      bgCtx.fill();
    }
    // Draw connecting lines between close dots
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dx = dots[i].x - dots[j].x;
        const dy = dots[i].y - dots[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 100) {
          bgCtx.beginPath();
          bgCtx.moveTo(dots[i].x, dots[i].y);
          bgCtx.lineTo(dots[j].x, dots[j].y);
          bgCtx.strokeStyle = `rgba(0,200,220,${0.06 * (1 - d / 100)})`;
          bgCtx.lineWidth = 0.5;
          bgCtx.stroke();
        }
      }
    }
    animId = requestAnimationFrame(drawBg);
  }

  function restartBgAnimation() {
    const isHidden = startMenuEl
      ? (startMenuEl.hidden || startMenuEl.classList.contains("hidden"))
      : true;
    if (!isHidden && !animId) {
      animId = requestAnimationFrame(drawBg);
    }
  }

  window.addEventListener("resize", () => {
    resize();
    initDots();
  });

  resize();
  initDots();
  animId = requestAnimationFrame(drawBg);

  // Restart animation when start screen becomes visible again (class-based)
  if (startMenuEl) {
    const observer = new MutationObserver(restartBgAnimation);
    observer.observe(startMenuEl, { attributes: true, attributeFilter: ["class", "hidden"] });
  }
})();

// Canvas click for upgrade menu
canvas.addEventListener("click", (event) => {
  const bounds = canvas.getBoundingClientRect();
  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;
  const cx = (event.clientX - bounds.left) * scaleX;
  const cy = (event.clientY - bounds.top) * scaleY;
  if (handleUpgradeClick(cx, cy)) {
    return;
  }
  handleStatPointClick(cx, cy);
});

// Show start menu or play area based on session state
function syncStartMenuVisibility() {
  if (currentRoomId && hasSeenLocalPlayerSnapshot) {
    hideStartMenu();
  } else if (!joinInProgress) {
    showStartMenu();
  }
}

// Patch updateSessionChrome to also sync the start menu
const _updateSessionChrome = updateSessionChrome;
// Override by calling syncStartMenuVisibility after any session change
setInterval(syncStartMenuVisibility, 500);

// Initial state: show start menu
showStartMenu();

resizeCanvas();
render();
refreshRoomBrowser();
