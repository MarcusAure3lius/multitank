import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocketServer } from "ws";

import {
  ANIMATION_ACTIONS,
  ANIMATION_POSES,
  ASSET_BUNDLE_VERSION,
  AUTO_BARREL_ROT_SPEED,
  BASIC_CLASS_SPECIALIZATIONS,
  BOT_AI_INTENTS,
  COMBAT_EVENT_ACTIONS,
  CLASS_TREE,
  EVENT_TYPES,
  GAME_BUILD_VERSION,
  GAME_CONFIG,
  MATCH_PHASES,
  MAX_LEVEL,
  MESSAGE_TYPES,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  PROFILES_SCHEMA_VERSION,
  REPLICATION_KINDS,
  SHAPE_TYPES,
  SHAPE_XP,
  SHAPE_SCORE,
  SOUND_CUES,
  STAT_NAMES,
  STATUS_EFFECTS,
  VFX_CUES,
  XP_PER_LEVEL,
  clamp,
  createAllocatedStats,
  createAnimationEvent,
  createBulletSnapshot,
  createCombatEvent,
  createHealthEvent,
  createHitEvent,
  createInventoryEvent,
  createInventoryState,
  createNetworkId,
  createObjectiveSnapshot,
  createPlayerSnapshot,
  createRoundEvent,
  createScoreEvent,
  createShapeSnapshot,
  createSpawnEvent,
  createStatePayload,
  deserializePacket,
  getLobbyClassProfile,
  getMapLayout,
  getTankRadiusForClassId,
  getTeamConfig,
  getTeamSpawnZone,
  normalizeAngle,
  sanitizeAuthToken,
  sanitizeMessageId,
  sanitizePlayerName,
  sanitizeProfileId,
  sanitizeSessionId,
  sanitizeRoomId,
  serializePacket
} from "./shared/protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const sharedDir = path.join(__dirname, "shared");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const profilesPath = path.join(dataDir, "profiles.json");
const backendPath = path.join(dataDir, "backend.json");
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const environment = process.env.NODE_ENV ?? "development";
const configuredGameVersion = sanitizeLooseText(process.env.GAME_VERSION ?? "", "", 32) || null;
const gameVersion = GAME_BUILD_VERSION;
const assetVersion = ASSET_BUNDLE_VERSION;
const publicOrigin = normalizePublicOrigin(process.env.PUBLIC_ORIGIN);
const allowedOrigins = buildAllowedOrigins(process.env.ALLOWED_ORIGINS, publicOrigin);
const startedAt = Date.now();
const bootId = crypto.randomUUID();
const allowedInventoryItemIds = new Set(GAME_CONFIG.antiCheat.allowedInventoryItemIds);
const BACKEND_SCHEMA_VERSION = 1;
const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_CLOUD_SAVE_BYTES = 32 * 1024;
const MAX_TRANSACTION_HISTORY = 2048;
const MAX_SECURITY_EVENTS = 512;
const REQUEST_REPLAY_TTL_MS = 1000 * 60 * 10;
const MAX_RATE_LIMIT_TRACKED_KEYS = 4096;
const MAX_REPLAY_SCOPES = 4096;
const MAX_REPLAY_IDS_PER_SCOPE = 256;
const MAX_ROOMS_PER_INSTANCE = Math.max(1, Number(process.env.MAX_ROOMS_PER_INSTANCE ?? 64) || 64);
const MAX_CLIENTS_PER_INSTANCE = Math.max(4, Number(process.env.MAX_CLIENTS_PER_INSTANCE ?? 256) || 256);
const EMPTY_ROOM_REAP_GRACE_MS = Math.max(5_000, Number(process.env.EMPTY_ROOM_REAP_GRACE_MS ?? 15_000) || 15_000);
const IDLE_ROOM_TTL_MS = Math.max(60_000, Number(process.env.IDLE_ROOM_TTL_MS ?? 1000 * 60 * 15) || 1000 * 60 * 15);
const SECURITY_RATE_WINDOWS = Object.freeze({
  apiRead: Object.freeze({ limit: 180, windowMs: 60_000 }),
  apiWrite: Object.freeze({ limit: 90, windowMs: 60_000 }),
  auth: Object.freeze({ limit: 24, windowMs: 60_000 }),
  allocator: Object.freeze({ limit: 60, windowMs: 60_000 }),
  admin: Object.freeze({ limit: 18, windowMs: 60_000 }),
  upgrade: Object.freeze({ limit: 40, windowMs: 60_000 })
});
const currentSeasonId = process.env.SEASON_ID ?? `${new Date(startedAt).getUTCFullYear()}-q${Math.floor(new Date(startedAt).getUTCMonth() / 3) + 1}`;
const adminApiKey = process.env.ADMIN_API_KEY ?? (environment === "production" ? null : "multitank-dev-admin");
const allocatorApiKey = process.env.ALLOCATOR_API_KEY ?? adminApiKey;
const instanceId = sanitizeLooseText(
  process.env.INSTANCE_ID ?? process.env.RENDER_SERVICE_ID ?? process.env.HOSTNAME ?? bootId,
  bootId,
  96
);
const instanceGroup = sanitizeLooseText(process.env.INSTANCE_GROUP ?? environment, environment, 48);
const deployRegion = sanitizeLooseText(
  process.env.DEPLOY_REGION ?? process.env.RENDER_REGION ?? process.env.FLY_REGION ?? "local",
  "local",
  48
);
const initialMaintenanceMode = /^(1|true|yes|on)$/i.test(String(process.env.START_IN_MAINTENANCE ?? ""));
const initialDrainMode = /^(1|true|yes|on)$/i.test(String(process.env.START_IN_DRAIN_MODE ?? ""));
const initialMaintenanceReason = sanitizeLooseText(process.env.MAINTENANCE_REASON ?? "", "", 160) || null;

if (configuredGameVersion && configuredGameVersion !== GAME_BUILD_VERSION) {
  console.warn(
    `Ignoring stale GAME_VERSION=${configuredGameVersion}; using bundled version ${GAME_BUILD_VERSION} instead`
  );
}
const purchaseCatalog = new Map([
  ["cosmetic-desert-camo", Object.freeze({ sku: "cosmetic-desert-camo", name: "Desert Camo", price: 180, kind: "cosmetic", entitlementId: "cosmetic:desert-camo" })],
  ["cosmetic-signal-flare", Object.freeze({ sku: "cosmetic-signal-flare", name: "Signal Flare", price: 240, kind: "cosmetic", entitlementId: "cosmetic:signal-flare" })],
  ["loadout-slot-2", Object.freeze({ sku: "loadout-slot-2", name: "Loadout Slot II", price: 320, kind: "loadout_slot", entitlementId: "loadout:slot-2" })],
  ["founder-badge", Object.freeze({ sku: "founder-badge", name: "Founder Badge", price: 140, kind: "badge", entitlementId: "badge:founder" })]
]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"]
]);

const rooms = new Map();
const profiles = new Map();
const backendProfiles = new Map();
const accounts = new Map();
const authSessions = new Map();
const transactionLog = new Map();
const securityEvents = [];
const requestReplayCache = new Map();
const httpRateLimits = new Map();
const upgradeRateLimits = new Map();
const operationsState = {
  maintenanceMode: initialMaintenanceMode,
  draining: initialDrainMode,
  maintenanceReason: initialMaintenanceMode || initialDrainMode ? initialMaintenanceReason : null,
  updatedAt: new Date(startedAt).toISOString(),
  lastAllocationAt: null,
  lastAllocatedRoomId: null,
  shutdownRequestedAt: null,
  shutdownReason: null
};
const operationsCounters = {
  roomsCreated: 0,
  roomsCleanedUp: 0,
  allocationsServed: 0,
  cleanShutdowns: 0,
  fatalShutdowns: 0
};
let saveProfilesTimer = null;
let saveBackendTimer = null;
let profilesLoaded = false;
let backendLoaded = false;
let isShuttingDown = false;
let connectedSocketCount = 0;

function normalizePublicOrigin(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.origin;
  } catch (error) {
    console.warn(`Ignoring invalid PUBLIC_ORIGIN: ${value}`);
    return null;
  }
}

function buildAllowedOrigins(rawValue, fallbackOrigin) {
  const origins = new Set();

  if (fallbackOrigin) {
    origins.add(fallbackOrigin);
  }

  for (const entry of String(rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    try {
      origins.add(new URL(entry).origin);
    } catch (error) {
      console.warn(`Ignoring invalid ALLOWED_ORIGINS entry: ${entry}`);
    }
  }

  return origins;
}

const discoverableAssetExtensions = Object.freeze([".png", ".webp", ".jpg", ".jpeg", ".svg"]);

async function findPublicAssetVariant(relativePathWithoutExtension) {
  for (const extension of discoverableAssetExtensions) {
    const filePath = path.join(publicDir, `${relativePathWithoutExtension}${extension}`);

    try {
      await fs.access(filePath);
      return `/${relativePathWithoutExtension.replace(/\\/g, "/")}${extension}`;
    } catch (error) {
      // Optional asset slot is empty.
    }
  }

  return null;
}

async function buildTankSpriteManifest(partDirectory) {
  const manifest = {
    default: await findPublicAssetVariant(`assets/sprites/tanks/${partDirectory}/default`)
  };
  const teamIds = [...GAME_CONFIG.lobby.teams.map((team) => team.id), "neutral"];

  await Promise.all(
    GAME_CONFIG.lobby.classes.map(async (entry) => {
      const classId = entry.id;
      const classManifest = {
        default: await findPublicAssetVariant(`assets/sprites/tanks/${partDirectory}/${classId}-default`)
      };

      await Promise.all(
        teamIds.map(async (teamId) => {
          classManifest[teamId] = await findPublicAssetVariant(
            `assets/sprites/tanks/${partDirectory}/${classId}-${teamId}`
          );
        })
      );

      manifest[classId] = classManifest;
    })
  );

  return manifest;
}

async function buildPublicAssetManifest() {
  const [arenaFloor, arenaGrid, obstacleBlock, objectiveRing, tankHulls, tankTurrets] = await Promise.all([
    findPublicAssetVariant("assets/backgrounds/arena-floor"),
    findPublicAssetVariant("assets/backgrounds/arena-grid"),
    findPublicAssetVariant("assets/world/obstacle-block"),
    findPublicAssetVariant("assets/world/objective-ring"),
    buildTankSpriteManifest("hulls"),
    buildTankSpriteManifest("turrets")
  ]);

  return {
    version: ASSET_BUNDLE_VERSION,
    images: {
      world: {
        arenaFloor,
        arenaGrid,
        obstacleBlock,
        objectiveRing
      },
      tanks: {
        hulls: tankHulls,
        turrets: tankTurrets
      }
    }
  };
}

function isSupportedGameVersion(clientGameVersion) {
  if (!clientGameVersion) {
    return true;
  }

  return clientGameVersion === gameVersion;
}

function isSupportedAssetVersion(clientAssetVersion) {
  if (!clientAssetVersion) {
    return true;
  }

  return clientAssetVersion === assetVersion;
}

function serverRandomFloat() {
  return crypto.randomInt(0, 1_000_000) / 1_000_000;
}

function hashSeed(value) {
  let hash = 2166136261;

  for (const character of String(value ?? "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRng(seed) {
  let state = (seed >>> 0) || 1;

  return {
    seed: state,
    nextFloat() {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = state;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    }
  };
}

function getRandomFloat(room = null) {
  return room?.rng?.nextFloat ? room.rng.nextFloat() : serverRandomFloat();
}

function randomChoice(values, room = null) {
  return values[Math.floor(getRandomFloat(room) * values.length)];
}

const botNames = [
  "Sentinel",
  "Warden",
  "Nomad",
  "Vanguard",
  "Hammer",
  "Aegis"
];

const BOT_PROGRESSION_PLANS = Object.freeze([
  Object.freeze({
    upgradePath: ["twin", "triple_shot"],
    statOrder: ["reload", "bulletDamage", "bulletSpeed", "movementSpeed", "maxHealth", "healthRegen", "bodyDamage", "bulletPenetration"]
  }),
  Object.freeze({
    upgradePath: ["sniper", "assassin"],
    statOrder: ["bulletDamage", "bulletSpeed", "movementSpeed", "reload", "maxHealth", "healthRegen", "bodyDamage", "bulletPenetration"]
  }),
  Object.freeze({
    upgradePath: ["machine_gun", "fighter"],
    statOrder: ["reload", "movementSpeed", "bulletSpeed", "bulletDamage", "maxHealth", "healthRegen", "bodyDamage", "bulletPenetration"]
  }),
  Object.freeze({
    upgradePath: ["flank_guard", "auto_3"],
    statOrder: ["movementSpeed", "reload", "bulletPenetration", "bulletDamage", "maxHealth", "healthRegen", "bodyDamage", "bulletSpeed"]
  })
]);

function getCombatClassProfile(classId) {
  const defaultClassId = GAME_CONFIG.lobby.classes[0]?.id ?? "basic";
  const safeClassId =
    typeof classId === "string" && GAME_CONFIG.combat.classProfiles[classId]
      ? classId
      : defaultClassId;
  return {
    classId: safeClassId,
    ...getLobbyClassProfile(safeClassId)
  };
}

function getPlayerTankRadius(player) {
  return player?.isBot ? GAME_CONFIG.tank.radius : getTankRadiusForClassId(player?.classId);
}

function createPlayerCombatState(player, now = Date.now()) {
  const profile = getCombatClassProfile(player?.classId);
  const stunUntil = Number.isFinite(Number(player?.combat?.stunUntil)) ? Number(player.combat.stunUntil) : 0;
  const shieldUntil = Number.isFinite(Number(player?.combat?.shieldUntil)) ? Number(player.combat.shieldUntil) : 0;
  return {
    armorMultiplier: profile.armorMultiplier,
    damageMultiplier: profile.damageMultiplier,
    critChance: profile.critChance,
    critMultiplier: profile.critMultiplier,
    statusEffect: stunUntil > now ? STATUS_EFFECTS.STUN : STATUS_EFFECTS.NONE,
    shielded: shieldUntil > now,
    shieldRemainingMs: Math.max(0, shieldUntil - now),
    stunRemainingMs: Math.max(0, stunUntil - now),
    statusDurationMs: Math.max(0, stunUntil - now),
    stunned: stunUntil > now,
    shieldUntil,
    stunUntil,
    lastDamagedAt: Number.isFinite(Number(player?.combat?.lastDamagedAt)) ? Number(player.combat.lastDamagedAt) : null,
    recentAttackers: Array.isArray(player?.combat?.recentAttackers)
      ? player.combat.recentAttackers
          .map((entry) => ({
            attackerId: String(entry?.attackerId ?? ""),
            damage: Math.max(0, Number(entry?.damage ?? 0) || 0),
            time: Number(entry?.time ?? 0) || 0
          }))
          .filter((entry) => entry.attackerId)
      : []
  };
}

function getPlayerStatValue(player, statName) {
  const rawValue = player?.stats?.[statName];
  if (!Number.isFinite(Number(rawValue))) {
    return 0;
  }

  return Math.max(0, Math.min(7, Math.round(Number(rawValue))));
}

function getPlayerMaxHitPoints(player) {
  const bonusLevels = getPlayerStatValue(player, "maxHealth");
  const specializationBonus =
    player?.basicSpecializationChoice === BASIC_CLASS_SPECIALIZATIONS.EXTRA_HP
      ? GAME_CONFIG.basicSpecialization.extraHpBonus
      : 0;
  return Math.max(1, Math.round(GAME_CONFIG.tank.hitPoints * (1 + bonusLevels * 0.12)) + specializationBonus);
}

function hasActiveShield(player, now = Date.now()) {
  return Math.max(0, Number(player?.combat?.shieldUntil ?? 0) - now) > 0;
}

function maybeUnlockBasicSpecialization(player) {
  if (!player || player.isBot || player.isSpectator) {
    return;
  }

  if ((player.level ?? 1) < GAME_CONFIG.basicSpecialization.unlockLevel) {
    return;
  }

  if (player.tankClassId !== "basic" || player.basicSpecializationChoice) {
    return;
  }

  player.basicSpecializationPending = true;
}

function activateShieldBubble(player, now = Date.now()) {
  if (!player) {
    return;
  }

  const combat = player.combat ?? createPlayerCombatState(player, now);
  combat.shieldUntil = Math.max(Number(combat.shieldUntil ?? 0), now + GAME_CONFIG.basicSpecialization.shieldDurationMs);
  combat.shieldRemainingMs = Math.max(0, combat.shieldUntil - now);
  combat.shielded = combat.shieldRemainingMs > 0;
  player.combat = combat;
}

function applyPassiveRegeneration(player, deltaSeconds, now) {
  if (!player?.alive) {
    return;
  }

  const maxHp = getPlayerMaxHitPoints(player);
  if ((player.hp ?? 0) >= maxHp) {
    player.hp = maxHp;
    return;
  }

  const lastDamagedAt = Number(player.combat?.lastDamagedAt ?? 0) || 0;
  if (lastDamagedAt > 0 && now - lastDamagedAt < 2500) {
    return;
  }

  const regenLevel = getPlayerStatValue(player, "healthRegen");
  const regenPerSecond = 5 + regenLevel * 2.5;
  player.hp = Math.min(maxHp, player.hp + regenPerSecond * deltaSeconds);
}

function createBotAiState(playerId, now = Date.now()) {
  const thinkIntervalMs = Math.max(100, Math.round(1000 / GAME_CONFIG.ai.thinkRate));
  const strafeDirection = Math.abs(hashSeed(`strafe:${playerId}`)) % 2 === 0 ? -1 : 1;
  const strafeJitterWindow = Math.max(0, GAME_CONFIG.ai.strafeJitterMs);
  const strafeJitter =
    strafeJitterWindow > 0
      ? Math.abs(hashSeed(`strafe-swap:${playerId}`)) % (strafeJitterWindow + 1)
      : 0;
  const preferredRangeJitter = Math.max(0, GAME_CONFIG.ai.preferredRangeJitter);
  return {
    intent: BOT_AI_INTENTS.IDLE,
    targetId: null,
    goalX: null,
    goalY: null,
    waypointX: null,
    waypointY: null,
    pathIndex: 0,
    pathLength: 0,
    hasLineOfSight: false,
    stuck: false,
    route: [],
    routeVersion: 0,
    lastPlanAt: 0,
    lastLineOfSightAt: 0,
    lastProgressAt: now,
    lastProgressX: null,
    lastProgressY: null,
    targetLockUntil: 0,
    pursuitTargetId: null,
    lastSeenTargetX: null,
    lastSeenTargetY: null,
    lastSeenTargetAt: 0,
    pursuitUntil: 0,
    anchorX: null,
    anchorY: null,
    anchorTargetId: null,
    anchorUntil: 0,
    phaseOffsetMs: Math.abs(hashSeed(`bot:${playerId}`)) % thinkIntervalMs,
    strafeDirection,
    strafeSwapAt: now + GAME_CONFIG.ai.strafeIntervalMs + strafeJitter,
    retreatUntil: 0,
    evasiveUntil: 0,
    lastKnownHp: null,
    lastDamageAtSeen: 0,
    moveAxisX: 0,
    moveAxisY: 0,
    moveAxisXCommitUntil: 0,
    moveAxisYCommitUntil: 0,
    rangeBias:
      preferredRangeJitter > 0
        ? (Math.abs(hashSeed(`range:${playerId}`)) % (preferredRangeJitter * 2 + 1)) - preferredRangeJitter
        : 0
  };
}

function circleIntersectsRect(x, y, radius, rect) {
  const nearestX = clamp(x, rect.x, rect.x + rect.width);
  const nearestY = clamp(y, rect.y, rect.y + rect.height);
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

function circleIntersectsCircle(ax, ay, aRadius, bx, by, bRadius) {
  const dx = ax - bx;
  const dy = ay - by;
  const combinedRadius = aRadius + bRadius;
  return dx * dx + dy * dy < combinedRadius * combinedRadius;
}

function segmentIntersectsRect(startX, startY, endX, endY, rect, padding = 0) {
  const left = rect.x - padding;
  const right = rect.x + rect.width + padding;
  const top = rect.y - padding;
  const bottom = rect.y + rect.height + padding;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  let nearTime = 0;
  let farTime = 1;

  const checks = [
    [-deltaX, startX - left],
    [deltaX, right - startX],
    [-deltaY, startY - top],
    [deltaY, bottom - startY]
  ];

  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) {
        return false;
      }
      continue;
    }

    const ratio = q / p;

    if (p < 0) {
      nearTime = Math.max(nearTime, ratio);
    } else {
      farTime = Math.min(farTime, ratio);
    }

    if (nearTime > farTime) {
      return false;
    }
  }

  return true;
}

function getRoomMapLayout(room = null) {
  return getMapLayout(room?.lobby?.mapId);
}

function getRoomObjectiveConfig(room = null) {
  return room?.objective ?? getRoomMapLayout(room).objective;
}

function getRoomObjectiveZones(room = null) {
  if (Array.isArray(room?.objective?.zones) && room.objective.zones.length > 0) {
    return room.objective.zones;
  }

  const fallback = getRoomObjectiveConfig(room);
  if (!fallback) {
    return [];
  }

  return [
    {
      id: "objective-center",
      slot: "center",
      x: fallback.x,
      y: fallback.y,
      radius: fallback.radius ?? GAME_CONFIG.objective.radius,
      ownerTeamId: fallback.ownerTeamId ?? null,
      ownerTeamName: fallback.ownerTeamName ?? null,
      captureTargetTeamId: fallback.captureTargetTeamId ?? null,
      captureTargetTeamName: fallback.captureTargetTeamName ?? null,
      captureProgress: fallback.captureProgress ?? 0,
      contested: Boolean(fallback.contested),
      nextRewardAt: fallback.nextRewardAt ?? null
    }
  ];
}

function isObjectiveZoneHot(zone) {
  return Boolean(zone?.contested || zone?.captureTargetTeamId || (zone?.captureProgress ?? 0) > 0);
}

function isPlayerInsideObjectiveZone(player, zone) {
  if (!player || !zone) {
    return false;
  }

  const dx = player.x - zone.x;
  const dy = player.y - zone.y;
  return dx * dx + dy * dy <= zone.radius * zone.radius;
}

function getObjectiveZoneForPlayer(room, player) {
  return getRoomObjectiveZones(room).find((zone) => isPlayerInsideObjectiveZone(player, zone)) ?? null;
}

function scoreObjectiveZoneForTeam(zone, teamId, player = null) {
  if (!zone || !teamId) {
    return -Infinity;
  }

  let score = 0;

  if (zone.ownerTeamId !== teamId) {
    score += zone.ownerTeamId ? 900 : 720;
  }

  if (zone.contested) {
    score += 520;
  }

  if (zone.captureTargetTeamId && zone.captureTargetTeamId !== teamId) {
    score += 640;
  } else if (zone.captureTargetTeamId === teamId && zone.ownerTeamId !== teamId) {
    score += 260;
  }

  if (!zone.ownerTeamId) {
    score += 140;
  }

  if (player) {
    score -= Math.hypot(zone.x - player.x, zone.y - player.y) * 0.08;
  }

  return score;
}

function getObjectiveGoalZone(room, teamId, player = null) {
  return (
    getRoomObjectiveZones(room)
      .map((zone) => ({
        zone,
        score: scoreObjectiveZoneForTeam(zone, teamId, player)
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.zone ?? null
  );
}

function collidesWithObstacle(x, y, radius = GAME_CONFIG.tank.radius, mapLayout = getRoomMapLayout()) {
  return (mapLayout?.obstacles ?? []).some((obstacle) => circleIntersectsRect(x, y, radius, obstacle));
}

function collidesWithShape(room, x, y, radius = GAME_CONFIG.tank.radius, options = {}) {
  const { excludeShapeId = null } = options;
  for (const shape of room?.shapes?.values?.() ?? []) {
    if (!shape || shape.id === excludeShapeId || (shape.hp ?? 0) <= 0) {
      continue;
    }

    if (circleIntersectsCircle(x, y, radius, shape.x, shape.y, shape.radius)) {
      return true;
    }
  }

  return false;
}

function segmentHitsObstacle(startX, startY, endX, endY, radius = 0, mapLayout = getRoomMapLayout()) {
  return (mapLayout?.obstacles ?? []).some((obstacle) =>
    segmentIntersectsRect(startX, startY, endX, endY, obstacle, radius)
  );
}

function distanceSquaredToSegment(startX, startY, endX, endY, pointX, pointY) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (segmentLengthSquared === 0) {
    const dx = pointX - startX;
    const dy = pointY - startY;
    return dx * dx + dy * dy;
  }

  const projection = clamp(
    ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / segmentLengthSquared,
    0,
    1
  );
  const closestX = startX + deltaX * projection;
  const closestY = startY + deltaY * projection;
  const dx = pointX - closestX;
  const dy = pointY - closestY;
  return dx * dx + dy * dy;
}

function segmentHitsBlockingShape(room, startX, startY, endX, endY, radius = 0, options = {}) {
  const { excludeShapeId = null } = options;
  for (const shape of room?.shapes?.values?.() ?? []) {
    if (!shape || shape.id === excludeShapeId || (shape.hp ?? 0) <= 0) {
      continue;
    }

    const hitRadius = Math.max(0, radius) + Math.max(0, shape.radius ?? 0);
    if (distanceSquaredToSegment(startX, startY, endX, endY, shape.x, shape.y) < hitRadius * hitRadius) {
      return true;
    }
  }

  return false;
}

function segmentHitsBotBlocker(room, startX, startY, endX, endY, radius = 0, mapLayout = getRoomMapLayout(room), options = {}) {
  return (
    segmentHitsObstacle(startX, startY, endX, endY, radius, mapLayout) ||
    segmentHitsBlockingShape(room, startX, startY, endX, endY, radius, options)
  );
}

function isBotNavigableWorldPoint(room, x, y, radius = GAME_CONFIG.tank.radius, mapLayout = getRoomMapLayout(room)) {
  return isNavigableWorldPoint(x, y, radius, mapLayout) && !collidesWithShape(room, x, y, radius);
}

function canBotNavigateDirectly(room, start, goal, radius = GAME_CONFIG.tank.radius + 4, mapLayout = getRoomMapLayout(room)) {
  return (
    canNavigateDirectly(start, goal, radius, mapLayout) &&
    !segmentHitsBlockingShape(room, start.x, start.y, goal.x, goal.y, radius)
  );
}

function distanceSquaredBetweenPoints(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function isFiniteWorldPoint(x, y) {
  return Number.isFinite(Number(x)) && Number.isFinite(Number(y));
}

function isNavigableWorldPoint(x, y, radius = GAME_CONFIG.tank.radius, mapLayout = getRoomMapLayout()) {
  return (
    isFiniteWorldPoint(x, y) &&
    x >= GAME_CONFIG.world.padding &&
    x <= GAME_CONFIG.world.width - GAME_CONFIG.world.padding &&
    y >= GAME_CONFIG.world.padding &&
    y <= GAME_CONFIG.world.height - GAME_CONFIG.world.padding &&
    !collidesWithObstacle(x, y, radius, mapLayout)
  );
}

function canNavigateDirectly(start, goal, radius = GAME_CONFIG.tank.radius + 4, mapLayout = getRoomMapLayout()) {
  if (!start || !goal) {
    return false;
  }

  if (!isNavigableWorldPoint(start.x, start.y, GAME_CONFIG.tank.radius, mapLayout)) {
    return false;
  }

  if (!isNavigableWorldPoint(goal.x, goal.y, GAME_CONFIG.tank.radius, mapLayout)) {
    return false;
  }

  return !segmentHitsObstacle(start.x, start.y, goal.x, goal.y, radius, mapLayout);
}

function createNavigationNode(id, x, y, mapLayout = getRoomMapLayout()) {
  if (!isNavigableWorldPoint(x, y, GAME_CONFIG.tank.radius + 2, mapLayout)) {
    return null;
  }

  return {
    id,
    x,
    y
  };
}

function dedupeNavigationNodes(nodes) {
  const seen = new Map();

  for (const node of nodes) {
    if (!node) {
      continue;
    }

    const key = `${node.x.toFixed(1)}:${node.y.toFixed(1)}`;
    if (!seen.has(key)) {
      seen.set(key, node);
    }
  }

  return Array.from(seen.values());
}

function buildNavigationGraph(mapLayout = getRoomMapLayout()) {
  const obstacleClearance = GAME_CONFIG.tank.radius + GAME_CONFIG.ai.obstacleClearance;
  const edgeInset = GAME_CONFIG.world.padding + 70;
  const objective = mapLayout?.objective ?? GAME_CONFIG.objective;
  const objectiveInset = objective.radius + 70;
  const rawNodes = [
    createNavigationNode("edge-nw", edgeInset, edgeInset, mapLayout),
    createNavigationNode("edge-ne", GAME_CONFIG.world.width - edgeInset, edgeInset, mapLayout),
    createNavigationNode("edge-sw", edgeInset, GAME_CONFIG.world.height - edgeInset, mapLayout),
    createNavigationNode("edge-se", GAME_CONFIG.world.width - edgeInset, GAME_CONFIG.world.height - edgeInset, mapLayout),
    createNavigationNode("edge-n", GAME_CONFIG.world.width * 0.5, edgeInset, mapLayout),
    createNavigationNode("edge-s", GAME_CONFIG.world.width * 0.5, GAME_CONFIG.world.height - edgeInset, mapLayout),
    createNavigationNode("edge-w", edgeInset, GAME_CONFIG.world.height * 0.5, mapLayout),
    createNavigationNode("edge-e", GAME_CONFIG.world.width - edgeInset, GAME_CONFIG.world.height * 0.5, mapLayout),
    createNavigationNode("objective-n", objective.x, objective.y - objectiveInset, mapLayout),
    createNavigationNode("objective-s", objective.x, objective.y + objectiveInset, mapLayout),
    createNavigationNode("objective-w", objective.x - objectiveInset, objective.y, mapLayout),
    createNavigationNode("objective-e", objective.x + objectiveInset, objective.y, mapLayout)
  ];

  for (const obstacle of mapLayout?.obstacles ?? []) {
    rawNodes.push(
      createNavigationNode(`${obstacle.id}-nw`, obstacle.x - obstacleClearance, obstacle.y - obstacleClearance, mapLayout),
      createNavigationNode(
        `${obstacle.id}-ne`,
        obstacle.x + obstacle.width + obstacleClearance,
        obstacle.y - obstacleClearance,
        mapLayout
      ),
      createNavigationNode(
        `${obstacle.id}-sw`,
        obstacle.x - obstacleClearance,
        obstacle.y + obstacle.height + obstacleClearance,
        mapLayout
      ),
      createNavigationNode(
        `${obstacle.id}-se`,
        obstacle.x + obstacle.width + obstacleClearance,
        obstacle.y + obstacle.height + obstacleClearance,
        mapLayout
      )
    );
  }

  const nodes = dedupeNavigationNodes(rawNodes);
  const edges = new Map(nodes.map((node) => [node.id, []]));

  for (let index = 0; index < nodes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex += 1) {
      const left = nodes[index];
      const right = nodes[otherIndex];
      if (!canNavigateDirectly(left, right, GAME_CONFIG.tank.radius + 4, mapLayout)) {
        continue;
      }

      const cost = Math.hypot(right.x - left.x, right.y - left.y);
      edges.get(left.id).push({ id: right.id, cost });
      edges.get(right.id).push({ id: left.id, cost });
    }
  }

  return {
    nodes,
    nodesById: new Map(nodes.map((node) => [node.id, node])),
    edges
  };
}

const navigationGraphsByMap = new Map(
  GAME_CONFIG.lobby.maps.map((map) => [map.id, buildNavigationGraph(getMapLayout(map.id))])
);
const defaultNavigationGraph = navigationGraphsByMap.get(GAME_CONFIG.lobby.maps[0]?.id) ?? buildNavigationGraph();

function getNavigationGraphForRoom(room) {
  return navigationGraphsByMap.get(getRoomMapLayout(room).id) ?? defaultNavigationGraph;
}

function getDynamicNavigationEdges(graph, startNode, goalNode, mapLayout = getRoomMapLayout()) {
  const dynamicEdges = new Map([
    [startNode.id, []],
    [goalNode.id, []]
  ]);

  if (canNavigateDirectly(startNode, goalNode, GAME_CONFIG.tank.radius + 4, mapLayout)) {
    const cost = Math.hypot(goalNode.x - startNode.x, goalNode.y - startNode.y);
    dynamicEdges.get(startNode.id).push({ id: goalNode.id, cost });
    dynamicEdges.get(goalNode.id).push({ id: startNode.id, cost });
  }

  for (const node of graph.nodes) {
    if (canNavigateDirectly(startNode, node, GAME_CONFIG.tank.radius + 4, mapLayout)) {
      const cost = Math.hypot(node.x - startNode.x, node.y - startNode.y);
      dynamicEdges.get(startNode.id).push({ id: node.id, cost });
    }

    if (canNavigateDirectly(goalNode, node, GAME_CONFIG.tank.radius + 4, mapLayout)) {
      const cost = Math.hypot(node.x - goalNode.x, node.y - goalNode.y);
      const bucket = dynamicEdges.get(node.id) ?? [];
      bucket.push({ id: goalNode.id, cost });
      dynamicEdges.set(node.id, bucket);
      dynamicEdges.get(goalNode.id).push({ id: node.id, cost });
    }
  }

  return dynamicEdges;
}

function getNavigationNeighbors(graph, dynamicEdges, nodeId) {
  return [
    ...(graph.edges.get(nodeId) ?? []),
    ...(dynamicEdges.get(nodeId) ?? [])
  ];
}

function reconstructNavigationRoute(cameFrom, nodesById, currentId) {
  const route = [];
  let cursor = currentId;

  while (cameFrom.has(cursor)) {
    const node = nodesById.get(cursor);
    if (node && cursor !== "nav:start") {
      route.push({
        x: node.x,
        y: node.y
      });
    }
    cursor = cameFrom.get(cursor);
  }

  return route.reverse();
}

function findNavigationRoute(start, goal, graph = defaultNavigationGraph, mapLayout = getRoomMapLayout()) {
  if (!isFiniteWorldPoint(start?.x, start?.y) || !isFiniteWorldPoint(goal?.x, goal?.y)) {
    return [];
  }

  if (canNavigateDirectly(start, goal, GAME_CONFIG.tank.radius + 4, mapLayout)) {
    return [{ x: goal.x, y: goal.y }];
  }

  const startNode = {
    id: "nav:start",
    x: start.x,
    y: start.y
  };
  const goalNode = {
    id: "nav:goal",
    x: goal.x,
    y: goal.y
  };
  const dynamicEdges = getDynamicNavigationEdges(graph, startNode, goalNode, mapLayout);
  const startNeighbors = dynamicEdges.get(startNode.id) ?? [];
  const goalNeighbors = dynamicEdges.get(goalNode.id) ?? [];

  if (startNeighbors.length === 0) {
    return [];
  }

  if (goalNeighbors.length === 0) {
    const fallback = [...startNeighbors]
      .map((neighbor) => graph.nodesById.get(neighbor.id))
      .filter(Boolean)
      .sort((left, right) => distanceSquaredBetweenPoints(left, goalNode) - distanceSquaredBetweenPoints(right, goalNode))[0];
    return fallback ? [{ x: fallback.x, y: fallback.y }] : [];
  }

  const nodesById = new Map(graph.nodesById);
  nodesById.set(startNode.id, startNode);
  nodesById.set(goalNode.id, goalNode);

  const openSet = new Set([startNode.id]);
  const cameFrom = new Map();
  const gScore = new Map([[startNode.id, 0]]);
  const fScore = new Map([[startNode.id, Math.hypot(goalNode.x - startNode.x, goalNode.y - startNode.y)]]);

  while (openSet.size > 0) {
    const currentId = Array.from(openSet).sort((left, right) => {
      const leftScore = fScore.get(left) ?? Number.POSITIVE_INFINITY;
      const rightScore = fScore.get(right) ?? Number.POSITIVE_INFINITY;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return left.localeCompare(right);
    })[0];

    if (currentId === goalNode.id) {
      return reconstructNavigationRoute(cameFrom, nodesById, currentId).slice(0, GAME_CONFIG.ai.maxRouteNodes);
    }

    openSet.delete(currentId);
    const currentNode = nodesById.get(currentId);
    if (!currentNode) {
      continue;
    }

    for (const neighbor of getNavigationNeighbors(graph, dynamicEdges, currentId)) {
      const neighborNode = nodesById.get(neighbor.id);
      if (!neighborNode) {
        continue;
      }

      const tentativeScore = (gScore.get(currentId) ?? Number.POSITIVE_INFINITY) + neighbor.cost;
      if (tentativeScore >= (gScore.get(neighbor.id) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighbor.id, currentId);
      gScore.set(neighbor.id, tentativeScore);
      fScore.set(
        neighbor.id,
        tentativeScore + Math.hypot(goalNode.x - neighborNode.x, goalNode.y - neighborNode.y)
      );
      openSet.add(neighbor.id);
    }
  }

  const fallback = [...startNeighbors]
    .map((neighbor) => graph.nodesById.get(neighbor.id))
    .filter(Boolean)
    .sort((left, right) => distanceSquaredBetweenPoints(left, goalNode) - distanceSquaredBetweenPoints(right, goalNode))[0];
  return fallback ? [{ x: fallback.x, y: fallback.y }] : [];
}

function syncBotRouteState(ai) {
  const waypoint = Array.isArray(ai?.route) ? ai.route[ai.pathIndex] ?? null : null;
  ai.pathLength = Array.isArray(ai?.route) ? ai.route.length : 0;
  ai.waypointX = waypoint?.x ?? null;
  ai.waypointY = waypoint?.y ?? null;
}

function clearBotRoute(ai) {
  if (!ai) {
    return;
  }

  ai.route = [];
  ai.pathIndex = 0;
  syncBotRouteState(ai);
}

function resetBotAiState(player, now = Date.now()) {
  if (!player?.isBot) {
    return;
  }

  const previous = player.ai;
  const nextState = createBotAiState(player.id, now);
  if (previous?.phaseOffsetMs !== undefined) {
    nextState.phaseOffsetMs = previous.phaseOffsetMs;
  }

  nextState.lastProgressX = player.x;
  nextState.lastProgressY = player.y;
  player.ai = nextState;
  player.nextAiThinkAt = now + nextState.phaseOffsetMs;
}

function isBotAiStateInvalid(player) {
  const ai = player?.ai;
  if (!player?.isBot || !ai) {
    return false;
  }

  if (!Object.values(BOT_AI_INTENTS).includes(ai.intent)) {
    return true;
  }

  if (
    (ai.goalX !== null || ai.goalY !== null) &&
    !isFiniteWorldPoint(ai.goalX, ai.goalY)
  ) {
    return true;
  }

  if (
    (ai.waypointX !== null || ai.waypointY !== null) &&
    !isFiniteWorldPoint(ai.waypointX, ai.waypointY)
  ) {
    return true;
  }

  if (!Array.isArray(ai.route) || ai.route.length > GAME_CONFIG.ai.maxRouteNodes) {
    return true;
  }

  if (ai.route.some((waypoint) => !isFiniteWorldPoint(waypoint?.x, waypoint?.y))) {
    return true;
  }

  return false;
}

function ensureValidBotAiState(player, now) {
  if (isBotAiStateInvalid(player)) {
    resetBotAiState(player, now);
  } else if (player?.isBot && player.ai?.lastProgressX === null) {
    player.ai.lastProgressX = player.x;
    player.ai.lastProgressY = player.y;
    player.ai.lastProgressAt = now;
  }
}

function updateBotProgressState(player, now) {
  if (!player?.isBot || !player.ai) {
    return;
  }

  const ai = player.ai;
  const isTryingToMove = Boolean(player.input.forward || player.input.back || player.input.left || player.input.right);
  if (!isTryingToMove) {
    ai.lastProgressX = player.x;
    ai.lastProgressY = player.y;
    ai.lastProgressAt = now;
    ai.stuck = false;
    return;
  }

  const lastX = ai.lastProgressX ?? player.x;
  const lastY = ai.lastProgressY ?? player.y;
  const movedDistance = Math.hypot(player.x - lastX, player.y - lastY);

  if (movedDistance >= GAME_CONFIG.ai.stuckDistance) {
    ai.lastProgressX = player.x;
    ai.lastProgressY = player.y;
    ai.lastProgressAt = now;
    ai.stuck = false;
    return;
  }

  ai.stuck = now - ai.lastProgressAt >= GAME_CONFIG.ai.stuckTimeoutMs;
}

function normalizeVector(x, y) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= 0.0001) {
    return {
      x: 0,
      y: 0,
      magnitude: 0
    };
  }

  return {
    x: x / magnitude,
    y: y / magnitude,
    magnitude
  };
}

function resolveBotMovementAxis(player, axis, value, now, options = {}) {
  const ai = player?.ai;
  if (!ai) {
    return 0;
  }

  const axisKey = axis === "x" ? "moveAxisX" : "moveAxisY";
  const commitKey = axis === "x" ? "moveAxisXCommitUntil" : "moveAxisYCommitUntil";
  const previousSign = Number(ai[axisKey] ?? 0) || 0;
  const commitUntil = Number(ai[commitKey] ?? 0) || 0;
  const engageThreshold = Math.max(0.01, options.engageThreshold ?? 0.28);
  const releaseThreshold = Math.min(
    engageThreshold,
    Math.max(0.005, options.releaseThreshold ?? Math.max(0.1, engageThreshold * 0.6))
  );
  const flipThreshold = Math.max(engageThreshold, options.flipThreshold ?? BOT_AI_AXIS_FLIP_THRESHOLD);
  const commitMs = Math.max(0, Math.round(options.commitMs ?? BOT_AI_AXIS_COMMIT_MS));
  const absValue = Math.abs(value);
  const desiredSign = absValue >= engageThreshold ? (value > 0 ? 1 : -1) : 0;
  let nextSign = previousSign;

  if (previousSign === 0) {
    nextSign = desiredSign;
  } else if (desiredSign === 0) {
    nextSign = absValue <= releaseThreshold ? 0 : previousSign;
  } else if (desiredSign === previousSign) {
    nextSign = previousSign;
  } else if (now < commitUntil && absValue < flipThreshold) {
    nextSign = previousSign;
  } else {
    nextSign = desiredSign;
  }

  ai[axisKey] = nextSign;
  ai[commitKey] = nextSign === 0 ? 0 : (nextSign !== previousSign ? now + commitMs : commitUntil);
  return nextSign;
}

function getBotProjectileSpeed(player) {
  const classDef = CLASS_TREE[player?.tankClassId] ?? CLASS_TREE.basic;
  const bulletSpeedStat = Number(player?.stats?.bulletSpeed ?? 0) || 0;
  return (classDef.bulletSpeed ?? GAME_CONFIG.bullet.speed) * (1 + bulletSpeedStat * 0.08);
}

function getBotShootRange(player) {
  const projectileSpeed = getBotProjectileSpeed(player);
  const classMultiplier = BOT_AI_CLASS_SHOOT_RANGE_MULTIPLIERS[player?.tankClassId] ?? 1;
  const projectileFactor = clamp(projectileSpeed / Math.max(1, GAME_CONFIG.bullet.speed), 0.82, 1.8);
  return clamp(
    GAME_CONFIG.ai.shootRange * classMultiplier * (0.9 + (projectileFactor - 1) * 0.42),
    GAME_CONFIG.ai.preferredRange * 1.15,
    GAME_CONFIG.visibility.playerVisionRadius * 0.92
  );
}

function getBotAwarenessRange(player) {
  return clamp(
    getBotShootRange(player) * 1.85,
    GAME_CONFIG.visibility.playerVisionRadius * 0.78,
    GAME_CONFIG.visibility.playerVisionRadius * 1.2
  );
}

function getBotPreferredRange(player) {
  const bias = Number(player?.ai?.rangeBias ?? 0) || 0;
  const classMultiplier = BOT_AI_CLASS_RANGE_MULTIPLIERS[player?.tankClassId] ?? 1;
  const projectileFactor = clamp(getBotProjectileSpeed(player) / Math.max(1, GAME_CONFIG.bullet.speed), 0.84, 1.8);
  const projectileBias = (projectileFactor - 1) * 55;
  const shootRange = getBotShootRange(player);
  return clamp(
    GAME_CONFIG.ai.preferredRange * classMultiplier + projectileBias + bias,
    GAME_CONFIG.tank.radius * 6,
    shootRange * 0.9
  );
}

function getBotHealthRatio(player) {
  return clamp((Number(player?.hp ?? 0) || 0) / Math.max(1, getPlayerMaxHitPoints(player)), 0, 1);
}

function scheduleNextBotStrafeSwap(player, now) {
  const baseInterval = Math.max(180, GAME_CONFIG.ai.strafeIntervalMs);
  const cycleIndex = Math.max(0, Math.floor(now / baseInterval));
  const jitterWindow = Math.max(0, GAME_CONFIG.ai.strafeJitterMs);
  const jitter =
    jitterWindow > 0
      ? Math.abs(hashSeed(`strafe:${player.id}:${cycleIndex}`)) % (jitterWindow + 1)
      : 0;
  return now + baseInterval + jitter;
}

function clearBotTargetMemory(player) {
  const ai = player?.ai;
  if (!ai) {
    return;
  }

  ai.pursuitTargetId = null;
  ai.lastSeenTargetX = null;
  ai.lastSeenTargetY = null;
  ai.lastSeenTargetAt = 0;
  ai.pursuitUntil = 0;
}

function updateBotTargetMemory(player, target, now) {
  const ai = player?.ai;
  if (!ai || !target || !isFiniteWorldPoint(target.x, target.y)) {
    return;
  }

  ai.pursuitTargetId = target.id ?? ai.pursuitTargetId ?? null;
  ai.lastSeenTargetX = Number(target.x);
  ai.lastSeenTargetY = Number(target.y);
  ai.lastSeenTargetAt = now;
  ai.pursuitUntil = now + BOT_AI_PURSUIT_MEMORY_MS;
}

function getBotRememberedTarget(room, player, targetId = null, now = Date.now()) {
  const ai = player?.ai;
  const rememberedId = targetId ?? ai?.pursuitTargetId ?? null;
  if (!ai || !rememberedId) {
    return null;
  }

  if (ai.pursuitTargetId !== rememberedId || now > (Number(ai.pursuitUntil ?? 0) || 0)) {
    if (targetId === null || ai.pursuitTargetId === rememberedId) {
      clearBotTargetMemory(player);
    }
    return null;
  }

  const rememberedPlayer = room?.players?.get?.(rememberedId) ?? null;
  if (rememberedPlayer && !isEnemyBotTarget(player, rememberedPlayer, now)) {
    clearBotTargetMemory(player);
    return null;
  }

  if (!isFiniteWorldPoint(ai.lastSeenTargetX, ai.lastSeenTargetY)) {
    clearBotTargetMemory(player);
    return null;
  }

  return {
    id: rememberedId,
    x: ai.lastSeenTargetX,
    y: ai.lastSeenTargetY,
    remembered: true
  };
}

function updateBotTacticalState(player, now, options = {}) {
  if (!player?.isBot || !player.ai) {
    return;
  }

  const ai = player.ai;
  const soloBotDuel = Boolean(options.soloBotDuel);
  const hp = Number(player.hp ?? 0) || 0;
  const previousHp = Number.isFinite(Number(ai.lastKnownHp)) ? Number(ai.lastKnownHp) : hp;
  const hpLoss = Math.max(0, previousHp - hp);
  const lastDamagedAt = Number(player.combat?.lastDamagedAt ?? 0) || 0;
  const tookFreshDamage = hpLoss > 0 || (lastDamagedAt > 0 && lastDamagedAt > (Number(ai.lastDamageAtSeen ?? 0) || 0));
  const healthRatio = getBotHealthRatio(player);

  if (tookFreshDamage) {
    if (!soloBotDuel && (hpLoss >= 18 || healthRatio <= 0.58)) {
      ai.retreatUntil = Math.max(
        Number(ai.retreatUntil ?? 0) || 0,
        now + GAME_CONFIG.ai.damageRetreatMs + Math.min(500, hpLoss * 12)
      );
    }
    ai.evasiveUntil = Math.max(
      Number(ai.evasiveUntil ?? 0) || 0,
      now + (soloBotDuel ? 220 : Math.max(260, Math.round(GAME_CONFIG.ai.dodgeLookaheadMs * 1.1)))
    );
    ai.lastDamageAtSeen = Math.max(Number(ai.lastDamageAtSeen ?? 0) || 0, lastDamagedAt || now);
    ai.strafeDirection = (ai.strafeDirection ?? 1) * -1;
    ai.strafeSwapAt = now + Math.max(180, Math.round(GAME_CONFIG.ai.strafeIntervalMs * 0.45));
  } else if (!Number.isFinite(Number(ai.strafeSwapAt)) || now >= ai.strafeSwapAt) {
    ai.strafeDirection = (ai.strafeDirection ?? 1) * -1;
    ai.strafeSwapAt = scheduleNextBotStrafeSwap(player, now);
  }

  if (healthRatio <= GAME_CONFIG.ai.lowHealthRetreatRatio) {
    ai.retreatUntil = Math.max(
      Number(ai.retreatUntil ?? 0) || 0,
      now + (soloBotDuel ? Math.round(GAME_CONFIG.ai.damageRetreatMs * 0.3) : GAME_CONFIG.ai.damageRetreatMs)
    );
  } else if (
    healthRatio >= GAME_CONFIG.ai.reengageHealthRatio &&
    (Number(ai.retreatUntil ?? 0) || 0) < now &&
    (Number(ai.evasiveUntil ?? 0) || 0) < now
  ) {
    ai.retreatUntil = 0;
  }

  ai.lastKnownHp = hp;
}

function getSpawnAnchorCandidates(teamId, room = null) {
  const mapAnchors = getRoomMapLayout(room)?.teamSpawns?.[teamId];
  if (Array.isArray(mapAnchors) && mapAnchors.length > 0) {
    return mapAnchors.map((anchor) => ({
      x: Number(anchor?.x) || 0,
      y: Number(anchor?.y) || 0
    }));
  }

  const zone = getTeamSpawnZone(teamId);
  const xFractions = zone.spawnSide === "left" ? [0.3, 0.5, 0.7] : [0.7, 0.5, 0.3];
  const yFractions = [0.14, 0.32, 0.5, 0.68, 0.86];
  const anchors = [];

  for (const yFraction of yFractions) {
    for (const xFraction of xFractions) {
      anchors.push({
        x: zone.left + zone.width * xFraction,
        y: zone.top + zone.height * yFraction
      });
    }
  }

  return anchors;
}

function buildSpawnSlotCandidates(teamId, spawnKey = "", room = null) {
  const anchors = getSpawnAnchorCandidates(teamId, room);
  const slotOffsets = [
    { x: 0, y: 0 },
    { x: 0, y: -90 },
    { x: 0, y: 90 },
    { x: 90, y: 0 },
    { x: -90, y: 0 },
    { x: 70, y: -70 },
    { x: 70, y: 70 },
    { x: -70, y: -70 },
    { x: -70, y: 70 }
  ];
  const orderedCandidates = [];

  for (const anchor of anchors) {
    for (const offset of slotOffsets) {
      orderedCandidates.push({
        x: anchor.x + offset.x,
        y: anchor.y + offset.y
      });
    }
  }

  if (orderedCandidates.length <= 1) {
    return orderedCandidates;
  }

  const mapSeed = room?.lobby?.mapId ?? "frontier";
  const startIndex = hashSeed(`${mapSeed}:${teamId}:${spawnKey}`) % orderedCandidates.length;
  return orderedCandidates
    .slice(startIndex)
    .concat(orderedCandidates.slice(0, startIndex));
}

function hasSpawnProtection(player, now = Date.now()) {
  return Number(player?.spawnProtectedUntil ?? 0) > now;
}

function grantSpawnProtection(player, now = Date.now()) {
  if (!player) {
    return;
  }

  player.spawnProtectedUntil = now + GAME_CONFIG.spawn.protectionMs;
}

function clearSpawnProtectionOnAction(player, now = Date.now()) {
  if (
    !player ||
    !hasSpawnProtection(player, now) ||
    player.isSpectator ||
    !player.alive
  ) {
    return;
  }

  if (player.input.forward || player.input.back || player.input.left || player.input.right || player.input.shoot) {
    player.spawnProtectedUntil = now;
  }
}

function isSpawnPointSafe(room, x, y, options = {}) {
  const {
    teamId = null,
    classId = GAME_CONFIG.lobby.classes[0]?.id ?? "basic",
    isBot = false,
    enforceEnemyBuffer = true,
    minDistanceToPlayers = null
  } = options;
  const mapLayout = getRoomMapLayout(room);
  const tankRadius = isBot ? GAME_CONFIG.tank.radius : getTankRadiusForClassId(classId);
  if (collidesWithObstacle(x, y, tankRadius + 8, mapLayout)) {
    return false;
  }

  if (collidesWithShape(room, x, y, tankRadius + 12)) {
    return false;
  }

  for (const objectiveZone of getRoomObjectiveZones(room)) {
    const objectiveBuffer = objectiveZone.radius + tankRadius + 20;
    const objectiveDx = x - objectiveZone.x;
    const objectiveDy = y - objectiveZone.y;
    if (objectiveDx * objectiveDx + objectiveDy * objectiveDy < objectiveBuffer * objectiveBuffer) {
      return false;
    }
  }

  if (!room) {
    return true;
  }

  for (const player of room.players.values()) {
    if (!player.alive) {
      continue;
    }

    const dx = x - player.x;
    const dy = y - player.y;
    const configuredPlayerBuffer = Number.isFinite(Number(minDistanceToPlayers))
      ? Math.max(tankRadius * 3, Number(minDistanceToPlayers))
      : null;
    const minDistance = configuredPlayerBuffer ?? (
      enforceEnemyBuffer && teamId && player.teamId !== teamId
        ? GAME_CONFIG.spawn.safeEnemyDistance
        : tankRadius * 3
    );
    if (dx * dx + dy * dy < minDistance * minDistance) {
      return false;
    }
  }

  return true;
}

function createSpawnPoint(room = null, options = {}) {
  const teamId = isValidLobbyOptionId(options.teamId, GAME_CONFIG.lobby.teams)
    ? options.teamId
    : GAME_CONFIG.lobby.teams[0]?.id ?? "alpha";
  const classId = isValidLobbyOptionId(options.classId, GAME_CONFIG.lobby.classes)
    ? options.classId
    : GAME_CONFIG.lobby.classes[0]?.id ?? "basic";
  const isBot = options.isBot === true;
  const spawnKey = String(options.spawnKey ?? "");
  const enforceEnemyBuffer = options.enforceEnemyBuffer !== false;
  const minDistanceToPlayers = Number.isFinite(Number(options.minDistanceToPlayers))
    ? Number(options.minDistanceToPlayers)
    : null;
  const spawnZone = getTeamSpawnZone(teamId);
  const { padding } = GAME_CONFIG.world;
  const spawnSlotCandidates = buildSpawnSlotCandidates(teamId, spawnKey, room);

  for (const candidate of spawnSlotCandidates) {
    if (
      candidate.x < spawnZone.left ||
      candidate.x > spawnZone.right ||
      candidate.y < spawnZone.top ||
      candidate.y > spawnZone.bottom
    ) {
      continue;
    }

    if (isSpawnPointSafe(room, candidate.x, candidate.y, { teamId, classId, isBot, enforceEnemyBuffer, minDistanceToPlayers })) {
      return candidate;
    }
  }

  const fallbackRng = createSeededRng(hashSeed(`${room?.id ?? "room"}:${room?.lobby?.mapId ?? "frontier"}:${teamId}:${spawnKey}:spawn`));

  for (let attempt = 0; attempt < 96; attempt += 1) {
    const candidate = {
      x: spawnZone.left + fallbackRng.nextFloat() * spawnZone.width,
      y: spawnZone.top + fallbackRng.nextFloat() * spawnZone.height
    };

    if (isSpawnPointSafe(room, candidate.x, candidate.y, { teamId, classId, isBot, enforceEnemyBuffer, minDistanceToPlayers })) {
      return candidate;
    }
  }

  const fallbackPoints = [
    {
      x: spawnZone.left + Math.min(spawnZone.width - padding, spawnZone.width * 0.22),
      y: spawnZone.top + spawnZone.height * 0.2
    },
    {
      x: spawnZone.centerX,
      y: spawnZone.centerY
    },
    {
      x: spawnZone.right - Math.min(spawnZone.width - padding, spawnZone.width * 0.22),
      y: spawnZone.top + spawnZone.height * 0.8
    }
  ];

  return (
    fallbackPoints.find((candidate) =>
      isSpawnPointSafe(room, candidate.x, candidate.y, { teamId, classId, isBot, enforceEnemyBuffer, minDistanceToPlayers })
    ) ?? {
      x: spawnZone.centerX,
      y: spawnZone.centerY
    }
  );
}

function cloneSpawnPoint(point, teamId = null) {
  return {
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0,
    teamId
  };
}

function getPlayerHomeSpawn(player, teamId) {
  if (
    !player?.homeSpawn ||
    !Number.isFinite(Number(player.homeSpawn.x)) ||
    !Number.isFinite(Number(player.homeSpawn.y)) ||
    player.homeSpawn.teamId !== teamId
  ) {
    return null;
  }

  return cloneSpawnPoint(player.homeSpawn, teamId);
}

function assignPlayerHomeSpawn(room, player, options = {}) {
  const teamId = isValidLobbyOptionId(options.teamId ?? player?.teamId, GAME_CONFIG.lobby.teams)
    ? options.teamId ?? player.teamId
    : GAME_CONFIG.lobby.teams[0]?.id ?? "alpha";
  const existingHomeSpawn = !options.force ? getPlayerHomeSpawn(player, teamId) : null;

  if (existingHomeSpawn) {
    return existingHomeSpawn;
  }

  const spawn = createSpawnPoint(room, {
    teamId,
    classId: options.classId ?? player?.classId,
    isBot: options.isBot ?? player?.isBot,
    spawnKey: String(options.spawnKey ?? player?.id ?? ""),
    enforceEnemyBuffer: options.enforceEnemyBuffer
  });
  const homeSpawn = cloneSpawnPoint(spawn, teamId);

  if (player) {
    player.homeSpawn = homeSpawn;
  }

  return cloneSpawnPoint(homeSpawn, teamId);
}

function applyPlayerTeamIdentity(player) {
  if (!player) {
    return;
  }

  const teamConfig = getTeamConfig(player.teamId);
  if (!teamConfig) {
    return;
  }

  player.teamId = teamConfig.id;
  player.color = teamConfig.color ?? player.color ?? "#2563eb";
}

function getStableSpawnPoint(room, player, options = {}) {
  if (!player) {
    return createSpawnPoint(room, options);
  }

  const homeSpawn = assignPlayerHomeSpawn(room, player, options);
  return {
    x: homeSpawn.x,
    y: homeSpawn.y
  };
}

function createProfile(profileId, playerName) {
  return {
    profileId,
    lastKnownName: playerName,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    stats: {
      matchesPlayed: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      shotsFired: 0,
      shotsHit: 0
    }
  };
}

const BOT_AI_CLASS_RANGE_MULTIPLIERS = Object.freeze({
  basic: 1,
  twin: 0.95,
  sniper: 1.42,
  machine_gun: 0.8,
  flank_guard: 0.92,
  triple_shot: 0.96,
  twin_flank: 0.93,
  assassin: 1.58,
  overseer: 1.18,
  fighter: 0.88,
  destroyer: 0.82,
  auto_3: 1.08
});

const BOT_AI_CLASS_SHOOT_RANGE_MULTIPLIERS = Object.freeze({
  basic: 1,
  twin: 0.96,
  sniper: 1.34,
  machine_gun: 0.84,
  flank_guard: 0.94,
  triple_shot: 0.98,
  twin_flank: 0.95,
  assassin: 1.46,
  overseer: 1.2,
  fighter: 0.9,
  destroyer: 0.88,
  auto_3: 1.12
});

const BOT_AI_TARGET_LOCK_MS = 1350;
const BOT_AI_TARGET_SWITCH_SCORE = 185;
const BOT_AI_PURSUIT_MEMORY_MS = 1600;
const BOT_AI_AIM_SAMPLE_MS = 180;
const BOT_AI_MAX_LEAD_SECONDS = 0.65;
const BOT_AI_ANCHOR_HOLD_MS = 850;
const BOT_AI_AXIS_COMMIT_MS = 320;
const BOT_AI_AXIS_FLIP_THRESHOLD = 0.72;

function createProfilesDocument() {
  return {
    schemaVersion: PROFILES_SCHEMA_VERSION,
    gameVersion,
    assetVersion,
    updatedAt: new Date().toISOString(),
    profiles: Array.from(profiles.values())
  };
}

function normalizeLegacyProfilesDocument(parsed) {
  if (Array.isArray(parsed)) {
    return {
      schemaVersion: 1,
      profiles: parsed
    };
  }

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.profiles)) {
    return {
      schemaVersion: Number.isInteger(parsed.schemaVersion) ? parsed.schemaVersion : 1,
      profiles: parsed.profiles
    };
  }

  return {
    schemaVersion: PROFILES_SCHEMA_VERSION,
    profiles: []
  };
}

function migrateProfilesDocument(parsedDocument) {
  const document = normalizeLegacyProfilesDocument(parsedDocument);

  if (document.schemaVersion > PROFILES_SCHEMA_VERSION) {
    throw new Error(
      `profiles.json schema ${document.schemaVersion} is newer than supported schema ${PROFILES_SCHEMA_VERSION}`
    );
  }

  let workingProfiles = Array.isArray(document.profiles) ? document.profiles : [];
  let currentSchemaVersion = Math.max(1, Number(document.schemaVersion) || 1);
  let migrated = false;

  while (currentSchemaVersion < PROFILES_SCHEMA_VERSION) {
    if (currentSchemaVersion === 1) {
      workingProfiles = workingProfiles.map((entry) => ({
        profileId: sanitizeProfileId(entry?.profileId) ?? null,
        lastKnownName: sanitizePlayerName(entry?.lastKnownName),
        createdAt: entry?.createdAt ?? new Date().toISOString(),
        lastSeenAt: entry?.lastSeenAt ?? new Date().toISOString(),
        stats: sanitizeStats(entry?.stats)
      }));
      currentSchemaVersion = 2;
      migrated = true;
      continue;
    }

    throw new Error(`No migration rule exists from profiles schema ${currentSchemaVersion}`);
  }

  return {
    schemaVersion: currentSchemaVersion,
    profiles: workingProfiles,
    migrated
  };
}

const OBJECTIVE_ZONE_SLOTS = Object.freeze(["left", "center", "right"]);

function getObjectiveZoneSlot(index = 0) {
  return OBJECTIVE_ZONE_SLOTS[index] ?? `zone-${Math.max(1, index + 1)}`;
}

function createObjectiveZoneState(slot, x, y, radius = GAME_CONFIG.objective.radius) {
  const resolvedSlot = typeof slot === "string" && slot ? slot : getObjectiveZoneSlot(0);
  return {
    id: `objective-${resolvedSlot}`,
    slot: resolvedSlot,
    x,
    y,
    radius,
    ownerTeamId: null,
    ownerTeamName: null,
    captureTargetTeamId: null,
    captureTargetTeamName: null,
    captureProgress: 0,
    contested: false,
    nextRewardAt: null
  };
}

function getObjectiveZoneAnchors(mapId = GAME_CONFIG.lobby.maps[0]?.id) {
  const layout = getMapLayout(mapId);
  const anchor = layout?.objective ?? GAME_CONFIG.objective;
  const sideOffset = Math.max(anchor.radius * 4, Number(GAME_CONFIG.objective.sideOffset) || 1400);
  const centerJitterX = Math.max(120, Number(GAME_CONFIG.objective.centerJitterX) || 320);
  const sideJitterX = Math.max(160, Number(GAME_CONFIG.objective.sideJitterX) || 420);
  const jitterY = Math.max(180, Number(GAME_CONFIG.objective.jitterY) || 820);

  return [
    Object.freeze({
      slot: "left",
      x: anchor.x - sideOffset,
      y: anchor.y,
      radius: anchor.radius,
      jitterX: sideJitterX,
      jitterY
    }),
    Object.freeze({
      slot: "center",
      x: anchor.x,
      y: anchor.y,
      radius: anchor.radius,
      jitterX: centerJitterX,
      jitterY
    }),
    Object.freeze({
      slot: "right",
      x: anchor.x + sideOffset,
      y: anchor.y,
      radius: anchor.radius,
      jitterX: sideJitterX,
      jitterY
    })
  ];
}

function isObjectiveZonePositionValid(x, y, radius, mapLayout, existingZones = []) {
  if (!isNavigableWorldPoint(x, y, radius + 14, mapLayout)) {
    return false;
  }

  const minSpacing = Math.max(radius * 2 + 80, Number(GAME_CONFIG.objective.minZoneSpacing) || 0);
  return existingZones.every((zone) => {
    const dx = x - zone.x;
    const dy = y - zone.y;
    return dx * dx + dy * dy >= minSpacing * minSpacing;
  });
}

function createObjectiveZonePosition(room, anchor, mapLayout, existingZones = []) {
  const minX = GAME_CONFIG.world.padding + anchor.radius + 24;
  const maxX = GAME_CONFIG.world.width - GAME_CONFIG.world.padding - anchor.radius - 24;
  const minY = GAME_CONFIG.world.padding + anchor.radius + 24;
  const maxY = GAME_CONFIG.world.height - GAME_CONFIG.world.padding - anchor.radius - 24;
  const clampX = (value) => clamp(value, minX, maxX);
  const clampY = (value) => clamp(value, minY, maxY);

  for (let attempt = 0; attempt < 96; attempt += 1) {
    const candidate = {
      x: clampX(anchor.x + (getRandomFloat(room) - 0.5) * 2 * anchor.jitterX),
      y: clampY(anchor.y + (getRandomFloat(room) - 0.5) * 2 * anchor.jitterY)
    };

    if (isObjectiveZonePositionValid(candidate.x, candidate.y, anchor.radius, mapLayout, existingZones)) {
      return candidate;
    }
  }

  const fallbackXOffsets = [0, -0.45, 0.45, -0.8, 0.8];
  const fallbackYOffsets = [0, -0.35, 0.35, -0.7, 0.7];

  for (const yOffset of fallbackYOffsets) {
    for (const xOffset of fallbackXOffsets) {
      const candidate = {
        x: clampX(anchor.x + anchor.jitterX * xOffset),
        y: clampY(anchor.y + anchor.jitterY * yOffset)
      };

      if (isObjectiveZonePositionValid(candidate.x, candidate.y, anchor.radius, mapLayout, existingZones)) {
        return candidate;
      }
    }
  }

  return {
    x: clampX(anchor.x),
    y: clampY(anchor.y)
  };
}

function buildObjectiveZones(room, mapId = GAME_CONFIG.lobby.maps[0]?.id, options = {}) {
  const { randomize = true } = options;
  const mapLayout = getMapLayout(mapId);
  const anchors = getObjectiveZoneAnchors(mapId);
  const zones = [];

  for (const anchor of anchors) {
    const position = randomize
      ? createObjectiveZonePosition(room, anchor, mapLayout, zones)
      : { x: anchor.x, y: anchor.y };
    zones.push(createObjectiveZoneState(anchor.slot, position.x, position.y, anchor.radius));
  }

  return zones;
}

function syncObjectiveSummary(objective, mapId = GAME_CONFIG.lobby.maps[0]?.id) {
  const layout = getMapLayout(mapId);
  const zones = Array.isArray(objective?.zones) ? objective.zones : [];
  const activeZone =
    zones.find((zone) => zone.contested || zone.captureTargetTeamId || zone.captureProgress > 0) ??
    zones.find((zone) => zone.ownerTeamId) ??
    zones[Math.floor(zones.length / 2)] ??
    null;

  objective.x = zones.length > 0 ? zones.reduce((total, zone) => total + zone.x, 0) / zones.length : layout.objective.x;
  objective.y = zones.length > 0 ? zones.reduce((total, zone) => total + zone.y, 0) / zones.length : layout.objective.y;
  objective.radius = activeZone?.radius ?? layout.objective.radius;
  objective.ownerTeamId = activeZone?.ownerTeamId ?? null;
  objective.ownerTeamName = activeZone?.ownerTeamName ?? null;
  objective.captureTargetTeamId = activeZone?.captureTargetTeamId ?? null;
  objective.captureTargetTeamName = activeZone?.captureTargetTeamName ?? null;
  objective.captureProgress = activeZone?.captureProgress ?? 0;
  objective.contested = zones.some((zone) => zone.contested);
  objective.nextRewardAt = activeZone?.nextRewardAt ?? null;
}

function createObjectiveState(mapId = GAME_CONFIG.lobby.maps[0]?.id) {
  const objective = {
    x: 0,
    y: 0,
    radius: GAME_CONFIG.objective.radius,
    ownerTeamId: null,
    ownerTeamName: null,
    captureTargetTeamId: null,
    captureTargetTeamName: null,
    captureProgress: 0,
    contested: false,
    nextRewardAt: null,
    zones: buildObjectiveZones(null, mapId, { randomize: false })
  };
  syncObjectiveSummary(objective, mapId);
  return objective;
}

function consumeRateBucket(bucket, now, maxPerSecond) {
  if (now - bucket.startedAt >= 1000) {
    bucket.startedAt = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  return bucket.count <= maxPerSecond;
}

function getSocketForPlayer(room, playerId) {
  return Array.from(room.clients).find((socket) => socket.data?.playerId === playerId) ?? null;
}

function decayViolationPoints(player, now) {
  if (!player?.antiCheat?.lastViolationAt) {
    return;
  }

  if (now - player.antiCheat.lastViolationAt >= GAME_CONFIG.antiCheat.violationDecayMs) {
    player.antiCheat.violationPoints = Math.max(0, player.antiCheat.violationPoints - 1);
    player.antiCheat.lastViolationAt = now;
  }
}

function isAntiCheatEnabled() {
  return GAME_CONFIG.antiCheat?.enabled !== false;
}

function recordAntiCheatViolation(room, player, reason, message, now, weight = 1) {
  if (!isAntiCheatEnabled()) {
    return;
  }

  if (!player?.antiCheat) {
    return;
  }

  decayViolationPoints(player, now);
  player.antiCheat.violationPoints += weight;
  player.antiCheat.lastViolationAt = now;

  const socket = room ? getSocketForPlayer(room, player.id) : null;
  if (socket && player.antiCheat.violationPoints >= GAME_CONFIG.antiCheat.maxViolationPoints) {
    rejectIncompatibleSocket(
      socket,
      "anti_cheat_violation",
      message ?? `Server rejected suspicious ${reason}`,
      4011
    );
  }
}

function rememberSafePlayerState(player) {
  if (!player?.antiCheat) {
    return;
  }

  player.antiCheat.lastSafeState = {
    x: player.x,
    y: player.y,
    angle: player.angle,
    turretAngle: player.turretAngle
  };
}

function isRestorablePlayerState(room, player, state) {
  if (
    !state ||
    !Number.isFinite(Number(state.x)) ||
    !Number.isFinite(Number(state.y)) ||
    !Number.isFinite(Number(state.angle)) ||
    !Number.isFinite(Number(state.turretAngle))
  ) {
    return false;
  }

  const x = Number(state.x);
  const y = Number(state.y);
  if (
    x < GAME_CONFIG.world.padding ||
    x > GAME_CONFIG.world.width - GAME_CONFIG.world.padding ||
    y < GAME_CONFIG.world.padding ||
    y > GAME_CONFIG.world.height - GAME_CONFIG.world.padding
  ) {
    return false;
  }

  return !collidesWithObstacle(x, y, getPlayerTankRadius(player), getRoomMapLayout(room));
}

function restorePlayerState(player, state) {
  if (!player || !state) {
    return;
  }

  player.x = Number(state.x);
  player.y = Number(state.y);
  player.angle = Number(state.angle);
  player.turretAngle = Number(state.turretAngle);
}

function restoreLastSafePlayerState(room, player, fallbackState = null) {
  if (isRestorablePlayerState(room, player, fallbackState)) {
    restorePlayerState(player, fallbackState);
    return;
  }

  const safeState = player?.antiCheat?.lastSafeState;
  if (!isRestorablePlayerState(room, player, safeState)) {
    return;
  }

  restorePlayerState(player, safeState);
}

function normalizePlayerInventory(player) {
  const slots = Array.isArray(player?.inventory?.slots) ? player.inventory.slots : [];
  const normalizedSlots = slots
    .slice(0, GAME_CONFIG.antiCheat.maxInventorySlots)
    .map((slot) => ({
      slot: String(slot?.slot ?? "").trim().slice(0, 24),
      itemId: String(slot?.itemId ?? "").trim().slice(0, 48),
      amount: Math.max(0, Math.min(GAME_CONFIG.antiCheat.maxInventoryAmount, Number(slot?.amount ?? 0) || 0))
    }))
    .filter((slot) => slot.slot && slot.itemId && allowedInventoryItemIds.has(slot.itemId));

  if (!normalizedSlots.some((slot) => slot.slot === "weapon" && slot.itemId === "shell-cannon")) {
    normalizedSlots.unshift({
      slot: "weapon",
      itemId: "shell-cannon",
      amount: 1
    });
  }

  const previousState = JSON.stringify(player?.inventory ?? {});
  player.inventory = {
    revision: Math.max(1, Number(player?.inventory?.revision ?? 1) || 1),
    slots: normalizedSlots
  };

  return JSON.stringify(player.inventory) !== previousState;
}

function validatePlayerSimulationState(room, player, previousState, deltaSeconds, now) {
  if (!player.alive || player.isSpectator) {
    return;
  }

  const positionIsFinite = Number.isFinite(player.x) && Number.isFinite(player.y);
  const angleIsFinite = Number.isFinite(player.angle) && Number.isFinite(player.turretAngle);
  const outOfBounds =
    player.x < GAME_CONFIG.world.padding ||
    player.x > GAME_CONFIG.world.width - GAME_CONFIG.world.padding ||
    player.y < GAME_CONFIG.world.padding ||
    player.y > GAME_CONFIG.world.height - GAME_CONFIG.world.padding;
  const insideObstacle = collidesWithObstacle(player.x, player.y, getPlayerTankRadius(player), getRoomMapLayout(room));
  const movedDistance = Math.hypot(player.x - previousState.x, player.y - previousState.y);
  const maxAllowedDistance =
    Math.max(GAME_CONFIG.tank.speed, GAME_CONFIG.tank.reverseSpeed) * deltaSeconds +
    GAME_CONFIG.antiCheat.maxPositionCorrectionDistance / 16;
  const maxAllowedTurn = movedDistance > 0.01 ? Math.PI * 2 : GAME_CONFIG.tank.turnSpeed * deltaSeconds + 0.3;
  const turnDelta = Math.abs(normalizeAngle(player.angle - previousState.angle));

  if (player.isBot) {
    if (!positionIsFinite || !angleIsFinite || outOfBounds || insideObstacle) {
      restoreLastSafePlayerState(room, player, previousState);
      resetBotAiState(player, now);
      return;
    }

    rememberSafePlayerState(player);
    return;
  }

  if (!positionIsFinite || !angleIsFinite || outOfBounds || insideObstacle) {
    restoreLastSafePlayerState(room, player, previousState);
    if (player.isBot) {
      resetBotAiState(player, now);
    }
    recordAntiCheatViolation(room, player, "invalid_position", "Server rejected an impossible player state", now, 2);
    return;
  }

  if (movedDistance > maxAllowedDistance || turnDelta > maxAllowedTurn) {
    player.x = previousState.x;
    player.y = previousState.y;
    player.angle = previousState.angle;
    player.turretAngle = previousState.turretAngle;
    if (player.isBot) {
      resetBotAiState(player, now);
    }
    recordAntiCheatViolation(room, player, "impossible_movement", "Server rejected impossible movement", now, 1);
    return;
  }

  rememberSafePlayerState(player);
}

function createPlayerAnimationState(now, options = {}) {
  const {
    locomotion = ANIMATION_POSES.IDLE,
    overlayAction = ANIMATION_ACTIONS.NONE,
    eventAction = ANIMATION_ACTIONS.NONE,
    eventSeq = 0,
    eventStartedAt = null,
    moveBlend = 0,
    aimOffset = 0,
    upperBodySync = 0,
    reloadFraction = 0,
    trackPhase = 0,
    stunRemainingMs = 0,
    emoteId = null
  } = options;

  return {
    locomotion,
    overlayAction,
    eventAction,
    eventSeq,
    eventStartedAt: eventStartedAt ?? now,
    moveBlend,
    aimOffset,
    upperBodySync,
    reloadFraction,
    trackPhase,
    stunRemainingMs,
    emoteId
  };
}

function setPlayerAnimationEvent(player, action, now, extras = {}) {
  if (!player.animation) {
    player.animation = createPlayerAnimationState(now);
  }

  player.animation.eventAction = action;
  player.animation.eventSeq += 1;
  player.animation.eventStartedAt = now;
  if (Object.hasOwn(extras, "emoteId")) {
    player.animation.emoteId = extras.emoteId;
  }
}

function updatePlayerAnimationState(player, previousState, deltaSeconds, now) {
  if (!player.animation) {
    player.animation = createPlayerAnimationState(now, {
      locomotion: player.alive ? ANIMATION_POSES.IDLE : ANIMATION_POSES.DEAD
    });
  }

  const movedDistance = previousState
    ? Math.hypot(player.x - previousState.x, player.y - previousState.y)
    : 0;
  const locomotion = !player.alive
    ? ANIMATION_POSES.DEAD
    : movedDistance > 0.1
      ? player.input.back && !player.input.forward
        ? ANIMATION_POSES.REVERSE
        : ANIMATION_POSES.MOVE
      : ANIMATION_POSES.IDLE;
  const moveBlend = !player.alive
    ? 0
    : clamp(
        movedDistance / Math.max(0.001, Math.max(GAME_CONFIG.tank.speed, GAME_CONFIG.tank.reverseSpeed) * deltaSeconds),
        0,
        1
      );
  const aimOffset = normalizeAngle(player.turretAngle - player.angle);
  const upperBodySync = clamp(Math.abs(aimOffset) / Math.PI, 0, 1);
  const reloadRemainingMs = player.alive
    ? Math.max(0, player.lastShotAt + GAME_CONFIG.tank.shootCooldownMs - now)
    : 0;
  const reloadFraction = GAME_CONFIG.tank.shootCooldownMs > 0
    ? clamp(reloadRemainingMs / GAME_CONFIG.tank.shootCooldownMs, 0, 1)
    : 0;
  const eventAgeMs = player.animation.eventStartedAt ? Math.max(0, now - player.animation.eventStartedAt) : Infinity;

  let overlayAction = ANIMATION_ACTIONS.NONE;
  if (!player.alive) {
    overlayAction = ANIMATION_ACTIONS.DEATH;
  } else if (player.animation.stunRemainingMs > 0) {
    overlayAction = ANIMATION_ACTIONS.STUN;
  } else if (player.animation.eventAction === ANIMATION_ACTIONS.SPAWN && eventAgeMs <= 450) {
    overlayAction = ANIMATION_ACTIONS.SPAWN;
  } else if (player.animation.eventAction === ANIMATION_ACTIONS.HIT && eventAgeMs <= 200) {
    overlayAction = ANIMATION_ACTIONS.HIT;
  } else if (player.animation.eventAction === ANIMATION_ACTIONS.FIRE && eventAgeMs <= 120) {
    overlayAction = ANIMATION_ACTIONS.FIRE;
  } else if (reloadFraction > 0.01) {
    overlayAction = ANIMATION_ACTIONS.RELOAD;
  }

  player.animation.locomotion = locomotion;
  player.animation.overlayAction = overlayAction;
  player.animation.moveBlend = moveBlend;
  player.animation.aimOffset = aimOffset;
  player.animation.upperBodySync = upperBodySync;
  player.animation.reloadFraction = reloadFraction;
  player.animation.trackPhase = !player.alive
    ? player.animation.trackPhase ?? 0
    : ((player.animation.trackPhase ?? 0) + movedDistance * 0.03) % 1;
  player.animation.stunRemainingMs = getRemainingStunMs(player, now);
}

function createPlayerState(id, profileId, name, profileStats, options = {}) {
  const {
    isBot = false,
    isSpectator = false,
    queuedForSlot = false,
    autoReady = false,
    room = null,
    color = null,
    teamId = GAME_CONFIG.lobby.teams[0].id,
    classId = GAME_CONFIG.lobby.classes[0].id,
    sessionId = null,
    joinedRoomAt = Date.now()
  } = options;
  const normalizedTeamId = isValidLobbyOptionId(teamId, GAME_CONFIG.lobby.teams)
    ? teamId
    : GAME_CONFIG.lobby.teams[0].id;
  const teamConfig = getTeamConfig(normalizedTeamId);
  const spawn = createSpawnPoint(room, {
    teamId: normalizedTeamId,
    classId,
    isBot,
    spawnKey: id
  });
  const now = Date.now();
  const botAiState = isBot ? createBotAiState(id, now) : null;

  return {
    id,
    profileId,
    sessionId,
    name,
    color: typeof color === "string" && color ? color : (teamConfig?.color ?? "#2563eb"),
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    turretAngle: 0,
    hp: GAME_CONFIG.tank.hitPoints,
    credits: 0,
    score: 0,
    xp: 0,
    level: 1,
    statPoints: 0,
    tankClassId: 'basic',
    basicSpecializationPending: false,
    basicSpecializationChoice: null,
    pendingUpgrades: [],
    stats: createAllocatedStats(),
    assists: 0,
    deaths: 0,
    inventory: {
      revision: 1,
      slots: [{ slot: "weapon", itemId: "shell-cannon", amount: 1 }]
    },
    alive: !isSpectator,
    ready: isBot || autoReady,
    connected: true,
    isBot,
    isSpectator,
    homeSpawn: cloneSpawnPoint(spawn, normalizedTeamId),
    teamId: normalizedTeamId,
    classId: isValidLobbyOptionId(classId, GAME_CONFIG.lobby.classes)
      ? classId
      : GAME_CONFIG.lobby.classes[0].id,
    joinedRoomAt: Number.isFinite(Number(joinedRoomAt)) ? Number(joinedRoomAt) : now,
    queuedForSlot: queuedForSlot && !isSpectator ? false : queuedForSlot,
    slotReserved: false,
    afk: false,
    afkSinceAt: null,
    lastActiveAt: now,
    disconnectedAt: null,
    reconnectDeadlineAt: null,
    spawnProtectedUntil: now + GAME_CONFIG.spawn.protectionMs,
    respawnAt: 0,
    lastShotAt: 0,
    nextAiThinkAt: botAiState ? now + botAiState.phaseOffsetMs : 0,
    lastProcessedInputSeq: 0,
    lastProcessedInputTick: 0,
    lastReceivedInputSeq: 0,
    lastProcessedInputClientSentAt: 0,
    lastReceivedInputClientSentAt: 0,
    stateHistory: [],
    profileStats,
    pendingInputs: [],
    combat: createPlayerCombatState({ classId }, now),
    animation: createPlayerAnimationState(now, {
      locomotion: isSpectator ? ANIMATION_POSES.IDLE : ANIMATION_POSES.IDLE,
      overlayAction: ANIMATION_ACTIONS.NONE,
      eventAction: ANIMATION_ACTIONS.NONE,
      eventStartedAt: now
    }),
    ai: botAiState,
    antiCheat: {
      violationPoints: 0,
      lastViolationAt: 0,
      duplicateInputWindowStartedAt: now,
      duplicateInputCount: 0,
      lastSafeState: {
        x: spawn.x,
        y: spawn.y,
        angle: 0,
        turretAngle: 0
      }
    },
    input: {
      seq: 0,
      clientSentAt: 0,
      receivedAt: 0,
      forward: false,
      back: false,
      left: false,
      right: false,
      shoot: false,
      turretAngle: 0
    }
  };
}

function getBotAssignmentKey(teamId, slotIndex) {
  return `${teamId}:${slotIndex}`;
}

function getBotTeamLabel(teamId) {
  const rawLabel = getTeamConfig(teamId)?.name ?? teamId ?? "Team";
  const compactLabel = rawLabel.replace(/\s+team$/i, "").trim();
  return compactLabel || "Team";
}

function getBotClassIdForSlot(slotIndex) {
  const classes = GAME_CONFIG.lobby.classes;
  if (classes.length === 0) {
    return "basic";
  }

  const normalizedSlotIndex = Number.isFinite(Number(slotIndex)) ? Math.max(0, Math.floor(Number(slotIndex))) : 0;
  return classes[normalizedSlotIndex % classes.length].id;
}

function getBotIdentity(teamId, slotIndex) {
  const normalizedTeamId = isValidLobbyOptionId(teamId, GAME_CONFIG.lobby.teams)
    ? teamId
    : GAME_CONFIG.lobby.teams[0]?.id ?? "alpha";
  const normalizedSlotIndex = Number.isFinite(Number(slotIndex)) ? Math.max(0, Math.floor(Number(slotIndex))) : 0;
  return {
    key: getBotAssignmentKey(normalizedTeamId, normalizedSlotIndex),
    teamId: normalizedTeamId,
    slotIndex: normalizedSlotIndex,
    classId: getBotClassIdForSlot(normalizedSlotIndex),
    name: sanitizePlayerName(`${getBotTeamLabel(normalizedTeamId)} Bot ${normalizedSlotIndex + 1}`)
  };
}

function getBotProgressionPlan(bot) {
  const slotIndex = Number.isFinite(Number(bot?.botSlotIndex)) ? Math.max(0, Math.floor(Number(bot.botSlotIndex))) : 0;
  return BOT_PROGRESSION_PLANS[slotIndex % BOT_PROGRESSION_PLANS.length] ?? BOT_PROGRESSION_PLANS[0];
}

function applyBotStatUpgrade(player, statName) {
  if (!player?.isBot || !STAT_NAMES.includes(statName) || (player.statPoints ?? 0) <= 0) {
    return false;
  }

  player.stats = createAllocatedStats(player.stats);
  const currentValue = player.stats[statName] ?? 0;
  if (currentValue >= 7) {
    return false;
  }

  const previousMaxHp = getPlayerMaxHitPoints(player);
  player.stats[statName] = currentValue + 1;
  player.statPoints -= 1;

  if (statName === "maxHealth") {
    const nextMaxHp = getPlayerMaxHitPoints(player);
    player.hp = Math.min(nextMaxHp, Math.max(0, player.hp) + (nextMaxHp - previousMaxHp));
  }

  return true;
}

function maybeAutoProgressBot(player) {
  if (!player?.isBot) {
    return;
  }

  const plan = getBotProgressionPlan(player);
  if (Array.isArray(player.pendingUpgrades) && player.pendingUpgrades.length > 0) {
    const nextClassId =
      plan.upgradePath.find((classId) => player.pendingUpgrades.includes(classId)) ??
      player.pendingUpgrades[0];
    if (nextClassId && CLASS_TREE[nextClassId]) {
      player.tankClassId = nextClassId;
      player.pendingUpgrades = [];
    }
  }

  while ((player.statPoints ?? 0) > 0) {
    const nextStatName = plan.statOrder.find((statName) => getPlayerStatValue(player, statName) < 7);
    if (!nextStatName || !applyBotStatUpgrade(player, nextStatName)) {
      break;
    }
  }
}

function syncBotLoadout(bot, now) {
  if (!bot || !bot.isBot) {
    return;
  }

  const identity = getBotIdentity(bot.botTeamId ?? bot.teamId, bot.botSlotIndex ?? 0);
  const previousTeamId = bot.teamId;
  bot.botKey = identity.key;
  bot.botTeamId = identity.teamId;
  bot.botSlotIndex = identity.slotIndex;
  bot.name = identity.name;
  bot.teamId = identity.teamId;
  bot.classId = identity.classId;

  if (previousTeamId !== bot.teamId) {
    bot.homeSpawn = null;
  }

  applyPlayerTeamIdentity(bot);
  bot.hp = clamp(
    Number.isFinite(Number(bot.hp)) ? Number(bot.hp) : getPlayerMaxHitPoints(bot),
    0,
    getPlayerMaxHitPoints(bot)
  );
  syncPlayerCombatProfile(bot, now);
}

function createBotState(room, teamId, slotIndex, now = Date.now()) {
  const botNumber = room.nextBotId++;
  const profileId = `bot-${room.id}-${botNumber}`;
  const identity = getBotIdentity(teamId, slotIndex);
  const botTeamConfig = getTeamConfig(identity.teamId);
  const bot = createPlayerState(`bot-${room.id}-${botNumber}`, profileId, identity.name, sanitizeStats(), {
    isBot: true,
    room,
    color: botTeamConfig?.color ?? "#dc2626",
    teamId: identity.teamId,
    classId: identity.classId,
    joinedRoomAt: now
  });
  bot.botKey = identity.key;
  bot.botTeamId = identity.teamId;
  bot.botSlotIndex = identity.slotIndex;
  return bot;
}

function createRoom(roomId) {
  const createdAt = Date.now();
  const rngSeed = hashSeed(`${roomId}:${createdAt}:${gameVersion}`);
  const defaultMapId = GAME_CONFIG.lobby.maps[0]?.id;
  operationsCounters.roomsCreated += 1;
  const room = {
    id: roomId,
    createdAt,
    lastActivityAt: createdAt,
    lastAllocatedAt: null,
    allocationSource: null,
    players: new Map(),
    clients: new Set(),
    bullets: new Map(),
    shapes: new Map(),
    nextShapeId: 1,
    pendingShots: [],
    events: [],
    nextBulletId: 1,
    nextBotId: 1,
    nextEventId: 1,
    nextSnapshotSeq: 1,
    tickNumber: 0,
    lastSimulatedAt: createdAt,
    rngSeed,
    rng: createSeededRng(rngSeed),
    playerOrderVersion: 0,
    playerOrderCache: {
      version: -1,
      players: []
    },
    interestIndex: {
      tickNumber: -1,
      playerCells: new Map(),
      bulletCells: new Map(),
      shapeCells: new Map()
    },
    roundNumber: 0,
    objective: createObjectiveState(defaultMapId),
    lobby: {
      ownerPlayerId: null,
      mapId: defaultMapId
    },
    match: {
      phase: MATCH_PHASES.WAITING,
      phaseEndsAt: null,
      pausedRemainingMs: null,
      resumePhase: null,
      winnerId: null,
      winnerName: null,
      transitionTargetMapId: defaultMapId,
      transitionAutoStart: false,
      shutdownReason: null,
      message: "Waiting for players"
    },
    bodyHitCooldowns: new Map()
  };
  resetObjectiveState(room);
  return room;
}

function createRoomEventId(room, type) {
  const prefix = String(type ?? "event").slice(0, 12);
  const eventId = `${room.id}:${prefix}:${room.nextEventId++}`;
  return eventId;
}

// ---- XP / LEVEL SYSTEM ----
function checkLevelUp(player, room) {
  if (!player || player.level >= MAX_LEVEL) {
    maybeUnlockBasicSpecialization(player);
    return;
  }
  while (player.level < MAX_LEVEL) {
    const xpNeeded = XP_PER_LEVEL[player.level] ?? Infinity;
    if (player.xp < xpNeeded) {
      break;
    }
    player.level += 1;
    player.statPoints += 1;
    // Award upgrade options at levels 15 and 30
    const classDef = CLASS_TREE[player.tankClassId] ?? CLASS_TREE.basic;
    if (classDef.upgradesAt !== null && player.level >= classDef.upgradesAt && classDef.upgradesTo.length > 0) {
      player.pendingUpgrades = classDef.upgradesTo.slice();
    }
  }

  maybeUnlockBasicSpecialization(player);

  if (player.isBot) {
    maybeAutoProgressBot(player);
  }
}

function awardXpToPlayer(player, xpAmount, room) {
  if (!player || player.isSpectator) {
    return;
  }
  player.xp = (player.xp ?? 0) + xpAmount;
  checkLevelUp(player, room);
}

// ---- SHAPE SYSTEM ----
const SHAPE_HP = { triangle: 70, square: 45, pentagon: 100, alpha_pentagon: 3000 };
const SHAPE_RADIUS = { triangle: 22, square: 20, pentagon: 35, alpha_pentagon: 70 };
const SHAPE_TARGET_COUNTS = Object.freeze({
  square: 24,
  triangle: 12,
  pentagon: 6,
  alpha_pentagon: 1
});
const SHAPE_RESPAWN_MS = Object.freeze({
  square: 5000,
  triangle: 7000,
  pentagon: 12000,
  alpha_pentagon: 30000
});
const SHAPE_DRIFT_SPEED = Object.freeze({
  square: 9,
  triangle: 13,
  pentagon: 8,
  alpha_pentagon: 5
});
const SHAPE_BOUNCE = Object.freeze({
  playerResolveBias: 0.2,
  shapeNudgeScale: 1.8,
  shapeNudgeMin: 10,
  shapeNudgeMax: 40,
  impactImpulseBase: 54,
  impactImpulseScale: 14,
  maxImpulse: 180,
  impulseDecayPerSecond: 3.5
});

function getShapeXpReward(shapeType) {
  const baseXp = SHAPE_XP[shapeType] ?? 10;
  return shapeType === SHAPE_TYPES.PENTAGON || shapeType === SHAPE_TYPES.ALPHA_PENTAGON ? baseXp * 10 : baseXp;
}

function countShapesByType(room, type) {
  let count = 0;
  for (const shape of room?.shapes?.values?.() ?? []) {
    if (shape.type === type) {
      count += 1;
    }
  }
  return count;
}

function isShapePointSafe(room, x, y, radius) {
  const mapLayout = getRoomMapLayout(room);
  if (!isNavigableWorldPoint(x, y, radius + 8, mapLayout)) {
    return false;
  }

  for (const objectiveZone of getRoomObjectiveZones(room)) {
    const objectiveBuffer = objectiveZone.radius + radius + 24;
    const objectiveDx = x - objectiveZone.x;
    const objectiveDy = y - objectiveZone.y;
    if (objectiveDx * objectiveDx + objectiveDy * objectiveDy < objectiveBuffer * objectiveBuffer) {
      return false;
    }
  }

  const spawnZonePadding = radius + 140;
  for (const team of GAME_CONFIG.lobby.teams) {
    const zone = getTeamSpawnZone(team.id);
    if (
      x >= zone.left - spawnZonePadding &&
      x <= zone.right + spawnZonePadding &&
      y >= zone.top - spawnZonePadding &&
      y <= zone.bottom + spawnZonePadding
    ) {
      return false;
    }
  }

  return true;
}

function isBlockingShapeCollisionTarget(player) {
  return Boolean(player && player.connected && player.alive && !player.isSpectator);
}

function canShapeOccupyPoint(room, shape, x, y, options = {}) {
  const {
    ignoreShapeId = shape?.id ?? null,
    ignorePlayerId = null
  } = options;

  if (!isShapePointSafe(room, x, y, shape.radius)) {
    return false;
  }

  for (const player of room?.players?.values?.() ?? []) {
    if (!isBlockingShapeCollisionTarget(player) || player.id === ignorePlayerId) {
      continue;
    }

    if (circleIntersectsCircle(x, y, shape.radius, player.x, player.y, getPlayerTankRadius(player))) {
      return false;
    }
  }

  for (const otherShape of room?.shapes?.values?.() ?? []) {
    if (!otherShape || otherShape.id === ignoreShapeId || (otherShape.hp ?? 0) <= 0) {
      continue;
    }

    if (circleIntersectsCircle(x, y, shape.radius, otherShape.x, otherShape.y, otherShape.radius)) {
      return false;
    }
  }

  return true;
}

function moveShapeSafely(room, shape, targetX, targetY, options = {}) {
  const candidates = [
    { x: targetX, y: targetY },
    { x: targetX, y: shape.y },
    { x: shape.x, y: targetY }
  ];

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
      continue;
    }

    if (canShapeOccupyPoint(room, shape, candidate.x, candidate.y, options)) {
      shape.x = candidate.x;
      shape.y = candidate.y;
      return true;
    }
  }

  return false;
}

function getShapeSpawnHotspots(room, type) {
  const hotspots = getRoomMapLayout(room)?.shapeHotspots?.[type];
  return Array.isArray(hotspots) && hotspots.length > 0 ? hotspots : null;
}

function createShapeHotspotCandidate(room, type, radius) {
  const hotspots = getShapeSpawnHotspots(room, type);
  if (!hotspots) {
    return null;
  }

  const hotspot = hotspots[Math.floor(getRandomFloat(room) * hotspots.length)] ?? hotspots[0];
  const hotspotRadius = Math.max(radius, Number(hotspot?.radius) || radius);
  const travel = Math.sqrt(getRandomFloat(room)) * Math.max(0, hotspotRadius - radius);
  const angle = getRandomFloat(room) * Math.PI * 2;

  return {
    x: (Number(hotspot?.x) || 0) + Math.cos(angle) * travel,
    y: (Number(hotspot?.y) || 0) + Math.sin(angle) * travel
  };
}

function createShapeSpawnPoint(room, type, radius) {
  const centeredShape = type === SHAPE_TYPES.ALPHA_PENTAGON;
  const objective = getRoomObjectiveConfig(room);
  const shapeTemplate = {
    id: null,
    radius
  };
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const hotspotCandidate = createShapeHotspotCandidate(room, type, radius);
    const candidate = hotspotCandidate ?? (
      centeredShape
        ? {
            x: objective.x + (getRandomFloat(room) - 0.5) * GAME_CONFIG.world.width * 0.18,
            y: objective.y + (getRandomFloat(room) - 0.5) * GAME_CONFIG.world.height * 0.18
          }
        : {
            x: radius + 120 + getRandomFloat(room) * Math.max(1, GAME_CONFIG.world.width - (radius + 120) * 2),
            y: radius + 120 + getRandomFloat(room) * Math.max(1, GAME_CONFIG.world.height - (radius + 120) * 2)
          }
    );

    if (canShapeOccupyPoint(room, shapeTemplate, candidate.x, candidate.y)) {
      return candidate;
    }
  }

  return clampTankPosition(
    centeredShape ? objective.x : GAME_CONFIG.world.width * (0.3 + getRandomFloat(room) * 0.4),
    centeredShape ? objective.y : GAME_CONFIG.world.height * (0.2 + getRandomFloat(room) * 0.6)
  );
}

function createShape(room, type, x, y) {
  const id = `shape-${room.id}-${room.nextShapeId++}`;
  const maxHp = SHAPE_HP[type] ?? 10;
  const radius = SHAPE_RADIUS[type] ?? 20;
  const spawnPoint =
    Number.isFinite(Number(x)) && Number.isFinite(Number(y))
      ? { x: Number(x), y: Number(y) }
      : createShapeSpawnPoint(room, type, radius);
  return {
    id,
    type,
    x: spawnPoint.x,
    y: spawnPoint.y,
    hp: maxHp,
    maxHp,
    radius,
    angle: getRandomFloat(room) * Math.PI * 2,
    angleVel: (getRandomFloat(room) - 0.5) * 0.28,
    driftAngle: getRandomFloat(room) * Math.PI * 2,
    driftSpeed: (SHAPE_DRIFT_SPEED[type] ?? 12) * (0.85 + getRandomFloat(room) * 0.3),
    driftTurnVelocity: (getRandomFloat(room) - 0.5) * 0.18,
    impulseX: 0,
    impulseY: 0
  };
}

function spawnInitialShapes(room) {
  for (const [shapeType, targetCount] of Object.entries(SHAPE_TARGET_COUNTS)) {
    for (let index = 0; index < targetCount; index += 1) {
      const shape = createShape(room, shapeType);
      room.shapes.set(shape.id, shape);
    }
  }
}

function updateShapes(room, deltaSeconds, now) {
  const impulseDecay = clamp(1 - deltaSeconds * SHAPE_BOUNCE.impulseDecayPerSecond, 0, 1);
  for (const shape of room.shapes.values()) {
    shape.angle += shape.angleVel * deltaSeconds;
    shape.driftAngle = normalizeAngle((shape.driftAngle ?? 0) + (shape.driftTurnVelocity ?? 0) * deltaSeconds);
    shape.impulseX = Number.isFinite(shape.impulseX) ? shape.impulseX : 0;
    shape.impulseY = Number.isFinite(shape.impulseY) ? shape.impulseY : 0;
    const driftDistance = (shape.driftSpeed ?? 0) * deltaSeconds;
    const impulseDistanceX = shape.impulseX * deltaSeconds;
    const impulseDistanceY = shape.impulseY * deltaSeconds;

    if (driftDistance <= 0 && Math.abs(impulseDistanceX) < 0.01 && Math.abs(impulseDistanceY) < 0.01) {
      continue;
    }

    const nextX = shape.x + Math.cos(shape.driftAngle) * driftDistance + impulseDistanceX;
    const nextY = shape.y + Math.sin(shape.driftAngle) * driftDistance + impulseDistanceY;
    if (moveShapeSafely(room, shape, nextX, nextY)) {
      shape.impulseX *= impulseDecay;
      shape.impulseY *= impulseDecay;
      if (Math.abs(shape.impulseX) < 0.2) {
        shape.impulseX = 0;
      }
      if (Math.abs(shape.impulseY) < 0.2) {
        shape.impulseY = 0;
      }
      continue;
    }

    shape.impulseX *= 0.4;
    shape.impulseY *= 0.4;
    shape.driftAngle = normalizeAngle(shape.driftAngle + Math.PI * (0.6 + getRandomFloat(room) * 0.8));
    shape.driftTurnVelocity = (getRandomFloat(room) - 0.5) * 0.24;
  }
}

function scheduleShapeRespawn(roomId, shapeType) {
  const respawnDelayMs = SHAPE_RESPAWN_MS[shapeType] ?? 8000;
  setTimeout(() => {
    const liveRoom = rooms.get(roomId);
    if (!liveRoom) {
      return;
    }
    if (countShapesByType(liveRoom, shapeType) >= (SHAPE_TARGET_COUNTS[shapeType] ?? 0)) {
      return;
    }
    const shape = createShape(liveRoom, shapeType);
    liveRoom.shapes.set(shape.id, shape);
  }, respawnDelayMs);
}

function checkBulletShapeCollisions(room, bullet, now) {
  for (const shape of room.shapes.values()) {
    const dx = bullet.x - shape.x;
    const dy = bullet.y - shape.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const hitDist = (bullet.radius ?? GAME_CONFIG.bullet.radius) + shape.radius;
    if (dist > hitDist) {
      continue;
    }
    // Hit! Damage shape
    const dmg = bullet.damage ?? GAME_CONFIG.bullet.damage;
    shape.hp -= dmg;
    if (shape.hp <= 0) {
      // Award XP/score to shooter
      const shooter = room.players.get(bullet.ownerId);
      if (shooter) {
        awardXpToPlayer(shooter, getShapeXpReward(shape.type), room);
        shooter.score += SHAPE_SCORE[shape.type] ?? 1;
      }
      room.shapes.delete(shape.id);
      scheduleShapeRespawn(room.id, shape.type);
    }
    return true; // bullet consumed
  }
  return false;
}

function queueRoomEvent(room, event) {
  if (!event) {
    return;
  }

  markRoomActive(room, event.serverTime ?? Date.now());
  room.events.push(event);

  if (room.events.length > GAME_CONFIG.network.maxRecentEvents) {
    room.events.splice(0, room.events.length - GAME_CONFIG.network.maxRecentEvents);
  }
}

function queueRoundStateEvent(room, now) {
  queueRoomEvent(
    room,
    createRoundEvent({
      id: createRoomEventId(room, EVENT_TYPES.ROUND),
      serverTime: now,
      phase: room.match.phase,
      roundNumber: room.roundNumber,
      winnerId: room.match.winnerId,
      winnerName: room.match.winnerName,
      message: room.match.message
    })
  );
}

function queueSpawnStateEvent(room, player, now) {
  queueRoomEvent(
    room,
    createSpawnEvent({
      id: createRoomEventId(room, EVENT_TYPES.SPAWN),
      serverTime: now,
      playerId: player.id,
      x: player.x,
      y: player.y,
      hp: player.hp
    })
  );
}

function queueHealthStateEvent(room, player, delta, now) {
  queueRoomEvent(
    room,
    createHealthEvent({
      id: createRoomEventId(room, EVENT_TYPES.HEALTH),
      serverTime: now,
      playerId: player.id,
      hp: player.hp,
      delta
    })
  );
}

function queueScoreStateEvent(room, player, reason, now) {
  queueRoomEvent(
    room,
    createScoreEvent({
      id: createRoomEventId(room, EVENT_TYPES.SCORE),
      serverTime: now,
      playerId: player.id,
      score: player.score,
      credits: player.credits,
      reason
    })
  );
}

function queueInventoryStateEvent(room, player, now) {
  const inventoryChanged = normalizePlayerInventory(player);
  if (inventoryChanged && !player.isBot) {
    recordAntiCheatViolation(
      room,
      player,
      "inventory_tamper",
      "Server rejected an invalid inventory state",
      now,
      1
    );
  }

  queueRoomEvent(
    room,
    createInventoryEvent({
      id: createRoomEventId(room, EVENT_TYPES.INVENTORY),
      serverTime: now,
      playerId: player.id,
      inventory: createInventoryState(player)
    })
  );
}

function queueAnimationStateEvent(room, player, action, now, extras = {}) {
  setPlayerAnimationEvent(player, action, now, extras);
  updatePlayerAnimationState(player, null, 1 / GAME_CONFIG.serverTickRate, now);

  queueRoomEvent(
    room,
    createAnimationEvent({
      id: createRoomEventId(room, EVENT_TYPES.ANIMATION),
      serverTime: now,
      playerId: player.id,
      action,
      eventSeq: player.animation.eventSeq,
      emoteId: extras.emoteId ?? null,
      animation: player.animation
    })
  );
}

function queueCombatStateEvent(room, payload) {
  queueRoomEvent(
    room,
    createCombatEvent({
      id: createRoomEventId(room, EVENT_TYPES.COMBAT),
      serverTime: payload.serverTime ?? Date.now(),
      ...payload
    })
  );
}

function syncPlayerCombatProfile(player, now) {
  const profile = getCombatClassProfile(player.classId);
  const existing = player.combat ?? createPlayerCombatState(player, now);
  const shieldUntil = Number.isFinite(Number(existing.shieldUntil)) ? Number(existing.shieldUntil) : 0;
  existing.armorMultiplier = profile.armorMultiplier;
  existing.damageMultiplier = profile.damageMultiplier;
  existing.critChance = profile.critChance;
  existing.critMultiplier = profile.critMultiplier;
  existing.shieldRemainingMs = Math.max(0, shieldUntil > now ? shieldUntil - now : 0);
  existing.shielded = shieldUntil > now;
  existing.stunRemainingMs = Math.max(0, existing.stunUntil > now ? existing.stunUntil - now : 0);
  existing.statusDurationMs = Math.max(0, existing.stunUntil > now ? existing.stunUntil - now : 0);
  existing.statusEffect = existing.stunUntil > now ? STATUS_EFFECTS.STUN : STATUS_EFFECTS.NONE;
  existing.stunned = existing.stunUntil > now;
  player.combat = existing;
}

function pruneRecentAttackers(player, now) {
  if (!player?.combat?.recentAttackers) {
    return;
  }

  player.combat.recentAttackers = player.combat.recentAttackers.filter(
    (entry) =>
      entry &&
      entry.attackerId &&
      now - entry.time <= GAME_CONFIG.combat.assistWindowMs &&
      entry.damage > 0
  );
}

function recordDamageContribution(target, attackerId, damage, now) {
  if (!target || !attackerId || target.id === attackerId) {
    return;
  }

  const combat = target.combat ?? createPlayerCombatState(target, now);
  const recentAttackers = Array.isArray(combat.recentAttackers) ? combat.recentAttackers : [];
  const existing = recentAttackers.find((entry) => entry.attackerId === attackerId);

  if (existing) {
    existing.damage += damage;
    existing.time = now;
  } else {
    recentAttackers.push({
      attackerId,
      damage,
      time: now
    });
  }

  combat.recentAttackers = recentAttackers;
  target.combat = combat;
  pruneRecentAttackers(target, now);
}

function getAssistContributors(room, target, killerId, now) {
  pruneRecentAttackers(target, now);
  return (target?.combat?.recentAttackers ?? [])
    .filter((entry) => entry.attackerId && entry.attackerId !== killerId && room.players.has(entry.attackerId))
    .sort((left, right) => right.damage - left.damage || right.time - left.time);
}

function clearCombatContributors(player) {
  if (!player?.combat) {
    return;
  }

  player.combat.recentAttackers = [];
}

function getRemainingStunMs(player, now) {
  return Math.max(0, Number(player?.combat?.stunUntil ?? 0) - now);
}

function applyStatusEffect(room, attacker, target, resolution, now) {
  if (!target || resolution.statusEffect !== STATUS_EFFECTS.STUN || resolution.statusDurationMs <= 0 || !target.alive) {
    return;
  }

  const combat = target.combat ?? createPlayerCombatState(target, now);
  combat.stunUntil = Math.max(Number(combat.stunUntil ?? 0), now + resolution.statusDurationMs);
  combat.statusEffect = STATUS_EFFECTS.STUN;
  combat.stunRemainingMs = Math.max(0, combat.stunUntil - now);
  combat.statusDurationMs = Math.max(0, combat.stunUntil - now);
  combat.stunned = true;
  target.combat = combat;

  queueCombatStateEvent(room, {
    serverTime: now,
    action: COMBAT_EVENT_ACTIONS.STATUS,
    attackerId: attacker?.id ?? null,
    attackerName: attacker?.name ?? null,
    targetId: target.id,
    targetName: target.name,
    statusEffect: STATUS_EFFECTS.STUN,
    statusDurationMs: resolution.statusDurationMs,
    soundCue: SOUND_CUES.STUN,
    vfxCue: VFX_CUES.STUN_WAVE,
    message: `${target.name} is stunned`
  });
}

function resolveCombatHit(room, attacker, target, now, baseDamage = GAME_CONFIG.bullet.damage) {
  const attackerProfile = getCombatClassProfile(attacker?.classId);
  const defenderProfile = getCombatClassProfile(target?.classId);
  const bodyDamageMultiplier = 1 + getPlayerStatValue(attacker, "bodyDamage") * 0.05;
  const armorReduction = 1 - getPlayerStatValue(attacker, "bulletPenetration") * 0.04;
  const effectiveArmorMultiplier = clamp(defenderProfile.armorMultiplier * armorReduction, 0.1, 3);
  const rolledCritical = getRandomFloat(room) < attackerProfile.critChance;
  const scaledDamage = Math.round(baseDamage * attackerProfile.damageMultiplier * bodyDamageMultiplier);
  const critDamage = rolledCritical ? Math.round(scaledDamage * attackerProfile.critMultiplier) : scaledDamage;
  const mitigatedDamage = Math.max(
    GAME_CONFIG.combat.critFloorDamage,
    Math.round(critDamage * effectiveArmorMultiplier)
  );
  const armorBlocked = Math.max(0, critDamage - mitigatedDamage);
  const shouldApplyStatus =
    !attacker?.isBot &&
    attackerProfile.statusEffect !== STATUS_EFFECTS.NONE &&
    target.alive &&
    (rolledCritical || getRandomFloat(room) < attackerProfile.statusChance);

  return {
    damage: mitigatedDamage,
    isCritical: rolledCritical,
    armorBlocked,
    statusEffect: shouldApplyStatus ? attackerProfile.statusEffect : STATUS_EFFECTS.NONE,
    statusDurationMs: shouldApplyStatus ? attackerProfile.statusDurationMs : 0,
    soundCue: rolledCritical ? SOUND_CUES.CRIT : armorBlocked > 0 ? SOUND_CUES.ARMOR : SOUND_CUES.HIT,
    vfxCue: rolledCritical ? VFX_CUES.CRIT_BURST : armorBlocked > 0 ? VFX_CUES.ARMOR_SPARK : VFX_CUES.IMPACT
  };
}

function isFriendlyCombatPair(attacker, target) {
  if (!attacker || !target) {
    return false;
  }

  return Boolean(attacker.teamId && target.teamId && attacker.teamId === target.teamId);
}

function createPlayerHistorySample(player, time) {
  return {
    time,
    x: player.x,
    y: player.y,
    angle: player.angle,
    turretAngle: player.turretAngle,
    alive: player.alive,
    connected: player.connected
  };
}

function resetPlayerHistory(player) {
  player.stateHistory.length = 0;
}

function recordPlayerHistory(player, now) {
  const history = player.stateHistory;
  const latest = history[history.length - 1];
  const sample = createPlayerHistorySample(player, now);

  if (latest && latest.time === now) {
    history[history.length - 1] = sample;
  } else if (
    latest &&
    latest.x === sample.x &&
    latest.y === sample.y &&
    latest.angle === sample.angle &&
    latest.turretAngle === sample.turretAngle &&
    latest.alive === sample.alive &&
    latest.connected === sample.connected
  ) {
    latest.time = now;
  } else {
    history.push(sample);
  }

  const oldestAllowedTime = now - GAME_CONFIG.lagCompensation.historyMs;
  while (history.length > 1 && history[0].time < oldestAllowedTime) {
    history.shift();
  }
}

function recordRoomHistory(room, now) {
  for (const player of getPlayersInSimulationOrder(room)) {
    recordPlayerHistory(player, now);
  }
}

function sampleHistoricalPlayerState(player, targetTime, currentTime = null) {
  const baseHistory = player.stateHistory;
  let history = baseHistory;

  if (currentTime !== null) {
    const currentSample = createPlayerHistorySample(player, currentTime);
    const latest = baseHistory[baseHistory.length - 1];

    if (!latest || currentSample.time > latest.time) {
      history = [...baseHistory, currentSample];
    } else if (latest.time === currentSample.time) {
      history = [...baseHistory.slice(0, -1), currentSample];
    }
  }

  if (!history || history.length === 0) {
    return null;
  }

  const first = history[0];
  const last = history[history.length - 1];

  if (targetTime <= first.time) {
    if (first.time - targetTime > GAME_CONFIG.lagCompensation.maxHistoricalSampleGapMs) {
      return null;
    }

    return {
      ...first
    };
  }

  if (targetTime >= last.time) {
    if (targetTime - last.time > GAME_CONFIG.lagCompensation.maxHistoricalSampleGapMs) {
      return null;
    }

    return {
      ...last
    };
  }

  for (let index = 1; index < history.length; index += 1) {
    const newer = history[index];
    if (newer.time < targetTime) {
      continue;
    }

    const older = history[index - 1];
    const span = Math.max(1, newer.time - older.time);
    const alpha = (targetTime - older.time) / span;
    return {
      time: targetTime,
      x: older.x + (newer.x - older.x) * alpha,
      y: older.y + (newer.y - older.y) * alpha,
      angle: normalizeAngle(older.angle + normalizeAngle(newer.angle - older.angle) * alpha),
      turretAngle: normalizeAngle(
        older.turretAngle + normalizeAngle(newer.turretAngle - older.turretAngle) * alpha
      ),
      alive: alpha < 0.5 ? older.alive : newer.alive,
      connected: alpha < 0.5 ? older.connected : newer.connected
    };
  }

  return {
    ...last
  };
}

function createReplicationSnapshot(kind, entity, viewer = null) {
  if (kind === REPLICATION_KINDS.PLAYER) {
    const state = createPlayerSnapshot(createViewerPlayerState(entity, viewer));
    return {
      kind,
      id: entity.id,
      netId: createNetworkId(kind, entity.id),
      ownerId: entity.id,
      state
    };
  }

  if (kind === REPLICATION_KINDS.BULLET) {
    const state = createBulletSnapshot(entity);
    return {
      kind,
      id: entity.id,
      netId: createNetworkId(kind, entity.id),
      ownerId: entity.ownerId,
      state
    };
  }

  if (kind === REPLICATION_KINDS.SHAPE) {
    const state = createShapeSnapshot(entity);
    return {
      kind,
      id: entity.id,
      netId: createNetworkId(kind, entity.id),
      ownerId: null,
      state
    };
  }

  const objectiveId = `${entity.roomId ?? "room"}:objective`;
  return {
    kind: REPLICATION_KINDS.OBJECTIVE,
    id: objectiveId,
    netId: createNetworkId(REPLICATION_KINDS.OBJECTIVE, objectiveId),
    ownerId: entity.ownerId ?? null,
    state: createObjectiveSnapshot(entity)
  };
}

function canViewerSeePosition(room, viewer, x, y, radius = 0, maxDistance = GAME_CONFIG.visibility.playerVisionRadius) {
  if (!viewer || viewer.isSpectator) {
    return true;
  }

  const dx = viewer.x - x;
  const dy = viewer.y - y;
  if (dx * dx + dy * dy > maxDistance * maxDistance) {
    return false;
  }

  return !segmentHitsObstacle(viewer.x, viewer.y, x, y, radius, getRoomMapLayout(room));
}

function canViewerSeePlayer(room, viewer, candidate) {
  if (!candidate) {
    return false;
  }

  if (!viewer || viewer.isSpectator || viewer.id === candidate.id) {
    return true;
  }

  if (candidate.isBot) {
    return true;
  }

  if (candidate.teamId === viewer.teamId) {
    return true;
  }

  return canViewerSeePosition(room, viewer, candidate.x, candidate.y, getPlayerTankRadius(candidate));
}

function createViewerPlayerState(candidate, viewer) {
  return {
    id: candidate.id,
    profileId: viewer?.id === candidate.id ? candidate.profileId : null,
    name: candidate.name,
    color: candidate.color,
    x: candidate.x,
    y: candidate.y,
    angle: candidate.angle,
    turretAngle: candidate.turretAngle,
    hp: candidate.hp,
    maxHp: getPlayerMaxHitPoints(candidate),
    credits: candidate.credits,
    score: candidate.score,
    assists: candidate.assists,
    deaths: candidate.deaths,
    alive: candidate.alive,
    ready: candidate.ready,
    connected: candidate.connected,
    isBot: candidate.isBot,
    isSpectator: candidate.isSpectator,
    teamId: candidate.teamId,
    classId: candidate.classId,
    tankClassId: candidate.tankClassId ?? "basic",
    queuedForSlot: candidate.queuedForSlot,
    slotReserved: candidate.slotReserved,
    afk: candidate.afk,
    stats: createAllocatedStats(candidate.stats),
    animation: candidate.animation,
    combat: candidate.combat,
    ai: candidate.ai,
    seq: viewer?.id === candidate.id ? candidate.lastProcessedInputSeq : 0,
    respawnAt: viewer?.id === candidate.id ? candidate.respawnAt : null,
    disconnectedAt: viewer?.id === candidate.id ? candidate.disconnectedAt : null,
    reconnectDeadlineAt: viewer?.id === candidate.id ? candidate.reconnectDeadlineAt : null
  };
}

function getVisiblePlayersForViewer(room, viewer) {
  if (!viewer || viewer.isSpectator) {
    return getPlayersInSimulationOrder(room);
  }

  const interestIndex = getRoomInterestIndex(room);
  const nearbyIds = collectInterestCellIds(
    interestIndex.playerCells,
    viewer.x,
    viewer.y,
    GAME_CONFIG.visibility.playerVisionRadius
  );
  const candidates = new Map([[viewer.id, viewer]]);

  for (const teammate of getPlayersInSimulationOrder(room)) {
    if (teammate.teamId === viewer.teamId) {
      candidates.set(teammate.id, teammate);
    }
  }

  for (const candidate of getPlayersInSimulationOrder(room)) {
    if (candidate.isBot) {
      candidates.set(candidate.id, candidate);
    }
  }

  for (const playerId of nearbyIds) {
    const candidate = room.players.get(playerId);
    if (candidate) {
      candidates.set(candidate.id, candidate);
    }
  }

  return Array.from(candidates.values())
    .filter((candidate) => canViewerSeePlayer(room, viewer, candidate))
    .sort(comparePlayersInSimulationOrder);
}

function canViewerSeeBullet(room, viewer, bullet) {
  if (!viewer || viewer.isSpectator || bullet.ownerId === viewer.id) {
    return true;
  }

  const owner = room.players.get(bullet.ownerId);
  if (owner && owner.teamId === viewer.teamId) {
    return true;
  }

  return canViewerSeePosition(
    room,
    viewer,
    bullet.x,
    bullet.y,
    GAME_CONFIG.bullet.radius,
    GAME_CONFIG.visibility.bulletVisionRadius
  );
}

function getVisibleBulletsForViewer(room, viewer) {
  if (!viewer || viewer.isSpectator) {
    return Array.from(room.bullets.values()).sort(compareBulletsInInterestOrder);
  }

  const interestIndex = getRoomInterestIndex(room);
  const nearbyIds = collectInterestCellIds(
    interestIndex.bulletCells,
    viewer.x,
    viewer.y,
    Math.max(GAME_CONFIG.visibility.bulletVisionRadius, GAME_CONFIG.replication.bulletInterestRadius)
  );
  const candidates = new Map();

  for (const bulletId of nearbyIds) {
    const bullet = room.bullets.get(bulletId);
    if (bullet) {
      candidates.set(bullet.id, bullet);
    }
  }

  for (const bullet of room.bullets.values()) {
    const owner = room.players.get(bullet.ownerId);
    if (bullet.ownerId === viewer.id || owner?.teamId === viewer.teamId) {
      candidates.set(bullet.id, bullet);
    }
  }

  return Array.from(candidates.values())
    .filter((bullet) => canViewerSeeBullet(room, viewer, bullet))
    .sort(compareBulletsInInterestOrder);
}

function canViewerSeeShape(room, viewer, shape) {
  if (!shape) {
    return false;
  }

  if (!viewer || viewer.isSpectator) {
    return true;
  }

  const radius = Math.max(0, Number(shape.radius) || 0);
  return canViewerSeePosition(
    room,
    viewer,
    shape.x,
    shape.y,
    radius,
    GAME_CONFIG.visibility.playerVisionRadius + radius
  );
}

function getVisibleShapesForViewer(room, viewer) {
  if (!viewer || viewer.isSpectator) {
    return Array.from(room.shapes.values()).sort(compareShapesInInterestOrder);
  }

  const interestIndex = getRoomInterestIndex(room);
  const nearbyIds = collectInterestCellIds(
    interestIndex.shapeCells,
    viewer.x,
    viewer.y,
    GAME_CONFIG.visibility.playerVisionRadius + 96
  );
  const candidates = new Map();

  for (const shapeId of nearbyIds) {
    const shape = room.shapes.get(shapeId);
    if (shape) {
      candidates.set(shape.id, shape);
    }
  }

  return Array.from(candidates.values())
    .filter((shape) => canViewerSeeShape(room, viewer, shape))
    .sort(compareShapesInInterestOrder);
}

function canViewerSeeObjective(room, viewer) {
  return true;
}

function createViewerObjectiveState(room, viewer) {
  return createObjectiveSnapshot(room.objective);
}

function canViewerSeeEvent(room, viewer, event) {
  if (!event) {
    return false;
  }

  if (event.type === EVENT_TYPES.INVENTORY) {
    return viewer?.id === event.playerId;
  }

  if (!viewer || viewer.isSpectator) {
    return true;
  }

  if (event.type === EVENT_TYPES.ROUND || event.type === EVENT_TYPES.SCORE) {
    return true;
  }

  if (event.type === EVENT_TYPES.SPAWN || event.type === EVENT_TYPES.HEALTH) {
    const subject = room.players.get(event.playerId);
    return subject ? canViewerSeePlayer(room, viewer, subject) : viewer.id === event.playerId;
  }

  if (event.type === EVENT_TYPES.ANIMATION) {
    const subject = room.players.get(event.playerId);
    return subject ? canViewerSeePlayer(room, viewer, subject) : viewer.id === event.playerId;
  }

  if (event.type === EVENT_TYPES.HIT) {
    const attacker = room.players.get(event.attackerId);
    const target = room.players.get(event.targetId);
    return (
      viewer.id === event.attackerId ||
      viewer.id === event.targetId ||
      (attacker && canViewerSeePlayer(room, viewer, attacker)) ||
      (target && canViewerSeePlayer(room, viewer, target))
    );
  }

  if (event.type === EVENT_TYPES.COMBAT) {
    return (
      viewer.id === event.attackerId ||
      viewer.id === event.targetId ||
      (event.assistantIds ?? []).includes(viewer.id)
    );
  }

  return true;
}

function getVisibleEventsForViewer(room, viewer) {
  return room.events.filter((event) => canViewerSeeEvent(room, viewer, event));
}

function createInterestCellKey(cellX, cellY) {
  return `${cellX}:${cellY}`;
}

function getInterestCellCoord(value) {
  return Math.floor(value / GAME_CONFIG.replication.cellSize);
}

function addEntityToInterestCells(cellMap, entityId, x, y) {
  const cellX = getInterestCellCoord(x);
  const cellY = getInterestCellCoord(y);
  const key = createInterestCellKey(cellX, cellY);
  const bucket = cellMap.get(key);

  if (bucket) {
    bucket.push(entityId);
    return;
  }

  cellMap.set(key, [entityId]);
}

function rebuildRoomInterestIndex(room) {
  const index = {
    tickNumber: room.tickNumber,
    playerCells: new Map(),
    bulletCells: new Map(),
    shapeCells: new Map()
  };

  for (const player of getPlayersInSimulationOrder(room)) {
    if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) {
      continue;
    }

    addEntityToInterestCells(index.playerCells, player.id, player.x, player.y);
  }

  for (const bullet of room.bullets.values()) {
    if (!Number.isFinite(bullet.x) || !Number.isFinite(bullet.y)) {
      continue;
    }

    addEntityToInterestCells(index.bulletCells, bullet.id, bullet.x, bullet.y);
  }

  for (const shape of room.shapes.values()) {
    if (!Number.isFinite(shape.x) || !Number.isFinite(shape.y)) {
      continue;
    }

    addEntityToInterestCells(index.shapeCells, shape.id, shape.x, shape.y);
  }

  room.interestIndex = index;
  return index;
}

function getRoomInterestIndex(room) {
  if (!room.interestIndex || room.interestIndex.tickNumber !== room.tickNumber) {
    return rebuildRoomInterestIndex(room);
  }

  return room.interestIndex;
}

function collectInterestCellIds(cellMap, x, y, radius) {
  const ids = new Set();
  const minCellX = getInterestCellCoord(x - radius);
  const maxCellX = getInterestCellCoord(x + radius);
  const minCellY = getInterestCellCoord(y - radius);
  const maxCellY = getInterestCellCoord(y + radius);

  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const bucket = cellMap.get(createInterestCellKey(cellX, cellY));
      if (!bucket) {
        continue;
      }

      for (const id of bucket) {
        ids.add(id);
      }
    }
  }

  return ids;
}

function compareBulletsInInterestOrder(left, right) {
  return (
    String(left.ownerId ?? "").localeCompare(String(right.ownerId ?? "")) ||
    String(left.id ?? "").localeCompare(String(right.id ?? ""))
  );
}

function compareShapesInInterestOrder(left, right) {
  return (
    String(left.type ?? "").localeCompare(String(right.type ?? "")) ||
    String(left.id ?? "").localeCompare(String(right.id ?? ""))
  );
}

function distanceSquaredBetween(viewer, entity) {
  if (!viewer) {
    return 0;
  }

  const dx = viewer.x - entity.x;
  const dy = viewer.y - entity.y;
  return dx * dx + dy * dy;
}

function prioritizeEntities(candidates, limit, scoreEntity, compareEntities) {
  if (candidates.length <= limit) {
    return [...candidates].sort(compareEntities);
  }

  return candidates
    .map((entity) => ({
      entity,
      score: scoreEntity(entity)
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareEntities(left.entity, right.entity)
    )
    .slice(0, limit)
    .map((entry) => entry.entity)
    .sort(compareEntities);
}

function computePlayerInterestPriority(room, viewer, candidate, knownEntities) {
  if (!viewer || viewer.isSpectator) {
    return 1_000_000;
  }

  const knownBonus = knownEntities?.has(createNetworkId(REPLICATION_KINDS.PLAYER, candidate.id)) ? 25_000 : 0;
  const distanceBonus = Math.max(0, 160_000 - Math.round(distanceSquaredBetween(viewer, candidate) / 4));
  let priority = distanceBonus + knownBonus;

  if (candidate.id === viewer.id) {
    priority += 1_000_000;
  }

  if (candidate.isBot) {
    priority += 450_000;
  }

  if (candidate.teamId === viewer.teamId) {
    priority += 300_000;
  }

  const candidateZone = getObjectiveZoneForPlayer(room, candidate);
  if (candidateZone && (candidateZone.ownerTeamId !== candidate.teamId || isObjectiveZoneHot(candidateZone))) {
    priority += 180_000;
  }

  if (!candidate.connected) {
    priority -= 25_000;
  }

  if (candidate.isSpectator) {
    priority -= 50_000;
  }

  return priority;
}

function computeBulletInterestPriority(room, viewer, bullet, knownEntities) {
  if (!viewer || viewer.isSpectator) {
    return 500_000;
  }

  const owner = room.players.get(bullet.ownerId);
  const knownBonus = knownEntities?.has(createNetworkId(REPLICATION_KINDS.BULLET, bullet.id)) ? 10_000 : 0;
  const distanceBonus = Math.max(0, 120_000 - Math.round(distanceSquaredBetween(viewer, bullet) / 3));
  let priority = distanceBonus + knownBonus;

  if (bullet.ownerId === viewer.id) {
    priority += 400_000;
  } else if (owner && owner.teamId === viewer.teamId) {
    priority += 150_000;
  }

  return priority;
}

function isReplicationContainer(value) {
  return value !== null && typeof value === "object";
}

function cloneReplicationValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneReplicationValue(entry));
  }

  if (!isReplicationContainer(value)) {
    return value;
  }

  const clone = {};
  for (const [key, entryValue] of Object.entries(value)) {
    clone[key] = cloneReplicationValue(entryValue);
  }
  return clone;
}

function replicationValuesEqual(left, right) {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!replicationValuesEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (!isReplicationContainer(left) || !isReplicationContainer(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) {
      return false;
    }

    if (!replicationValuesEqual(left[key], right[key])) {
      return false;
    }
  }

  return true;
}

function diffReplicationState(previousState, nextState) {
  const diff = {};
  let hasChanges = false;
  const previous = previousState ?? {};
  const next = nextState ?? {};

  for (const [key, nextValue] of Object.entries(next)) {
    if (!replicationValuesEqual(previous[key], nextValue)) {
      diff[key] = cloneReplicationValue(nextValue);
      hasChanges = true;
    }
  }

  for (const key of Object.keys(previous)) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      diff[key] = undefined;
      hasChanges = true;
    }
  }

  return hasChanges ? diff : null;
}

function cloneReplicationState(state) {
  return cloneReplicationValue(state ?? {});
}

function isBulletRelevantToPlayer(player, bullet) {
  if (!player || player.id === bullet.ownerId) {
    return true;
  }

  const dx = player.x - bullet.x;
  const dy = player.y - bullet.y;
  const interestRadius = GAME_CONFIG.replication.bulletInterestRadius;
  return dx * dx + dy * dy <= interestRadius * interestRadius;
}

function buildViewerInterestSet(room, viewer, socket = null) {
  const knownEntities = socket?.data?.replication?.knownEntities;
  const candidatePlayers = getVisiblePlayersForViewer(room, viewer);
  const candidateBullets = getVisibleBulletsForViewer(room, viewer).filter((bullet) =>
    isBulletRelevantToPlayer(viewer, bullet)
  );
  const selectedShapes = getVisibleShapesForViewer(room, viewer);
  const playerLimit = !viewer || viewer.isSpectator
    ? candidatePlayers.length
    : GAME_CONFIG.replication.maxPlayerRecordsPerSnapshot;
  const bulletLimit = !viewer || viewer.isSpectator
    ? candidateBullets.length
    : GAME_CONFIG.replication.maxBulletRecordsPerSnapshot;
  const selectedPlayers = prioritizeEntities(
    candidatePlayers,
    playerLimit,
    (candidate) => computePlayerInterestPriority(room, viewer, candidate, knownEntities),
    comparePlayersInSimulationOrder
  );
  const selectedBullets = prioritizeEntities(
    candidateBullets,
    bulletLimit,
    (bullet) => computeBulletInterestPriority(room, viewer, bullet, knownEntities),
    compareBulletsInInterestOrder
  );
  const objectiveState = createViewerObjectiveState(room, viewer);
  const prioritizedRecords = [
    ...selectedPlayers.map((candidate) => ({
      priority: computePlayerInterestPriority(room, viewer, candidate, knownEntities),
      record: createReplicationSnapshot(REPLICATION_KINDS.PLAYER, candidate, viewer)
    })),
    ...selectedBullets.map((bullet) => ({
      priority: computeBulletInterestPriority(room, viewer, bullet, knownEntities),
      record: createReplicationSnapshot(REPLICATION_KINDS.BULLET, bullet)
    })),
    ...selectedShapes.map((shape) => ({
      priority: 200_000 + (SHAPE_XP[shape.type] ?? 0),
      record: createReplicationSnapshot(REPLICATION_KINDS.SHAPE, shape)
    })),
    {
      priority: canViewerSeeObjective(room, viewer) ? 750_000 : 250_000,
      record: createReplicationSnapshot(REPLICATION_KINDS.OBJECTIVE, {
        roomId: room.id,
        ...objectiveState
      })
    }
  ];
  const records = prioritizedRecords
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        String(left.record.kind).localeCompare(String(right.record.kind)) ||
        String(left.record.id).localeCompare(String(right.record.id))
    )
    .map((entry) => entry.record);

  return {
    players: selectedPlayers,
    bullets: selectedBullets,
    shapes: selectedShapes,
    objectiveState,
    records,
    stats: {
      cellSize: GAME_CONFIG.replication.cellSize,
      candidatePlayers: candidatePlayers.length,
      selectedPlayers: selectedPlayers.length,
      culledPlayers: Math.max(0, candidatePlayers.length - selectedPlayers.length),
      candidateBullets: candidateBullets.length,
      selectedBullets: selectedBullets.length,
      culledBullets: Math.max(0, candidateBullets.length - selectedBullets.length)
    }
  };
}

function buildReplicationPayloadForSocket(socket, room, player, snapshotSeq, now, interestSet = null) {
  const replicationState = socket.data.replication;
  const interest = interestSet ?? buildViewerInterestSet(room, player, socket);
  const relevantRecords = interest.records;
  const relevantIds = new Set(relevantRecords.map((record) => record.netId));
  const spawns = [];
  const updates = [];
  const despawns = [];
  const previousSnapshotSeq = replicationState.lastSnapshotSeq;
  const needsFullSync =
    replicationState.forceFullSync ||
    replicationState.lastFullSyncAt === 0 ||
    now - replicationState.lastFullSyncAt >= GAME_CONFIG.replication.fullSyncIntervalMs;

  if (needsFullSync) {
    replicationState.knownEntities.clear();
  }

  for (const record of relevantRecords) {
    const previous = replicationState.knownEntities.get(record.netId);

    if (!previous) {
      spawns.push(record);
      replicationState.knownEntities.set(record.netId, {
        kind: record.kind,
        id: record.id,
        ownerId: record.ownerId,
        state: cloneReplicationState(record.state)
      });
      continue;
    }

    const stateDelta = diffReplicationState(previous.state, record.state);
    if (stateDelta) {
      updates.push({
        kind: record.kind,
        id: record.id,
        ownerId: record.ownerId,
        state: stateDelta
      });
      replicationState.knownEntities.set(record.netId, {
        kind: record.kind,
        id: record.id,
        ownerId: record.ownerId,
        state: cloneReplicationState(record.state)
      });
    }
  }

  for (const [netId, previous] of replicationState.knownEntities.entries()) {
    if (relevantIds.has(netId)) {
      continue;
    }

    despawns.push({
      kind: previous.kind,
      id: previous.id
    });
    replicationState.knownEntities.delete(netId);
  }

  if (needsFullSync) {
    replicationState.forceFullSync = false;
    replicationState.lastFullSyncAt = now;
  }

  replicationState.lastSnapshotSeq = snapshotSeq;

  return {
    mode: needsFullSync ? "full" : "delta",
    baselineSnapshotSeq: needsFullSync ? 0 : previousSnapshotSeq,
    spawns,
    updates,
    despawns,
    interest: interest.stats
  };
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId));
  }

  return rooms.get(roomId);
}

function markRoomActive(room, now = Date.now()) {
  if (!room) {
    return;
  }

  room.lastActivityAt = Math.max(Number(room.lastActivityAt) || 0, Number(now) || Date.now());
}

function deleteRoom(roomId) {
  if (rooms.delete(roomId)) {
    operationsCounters.roomsCleanedUp += 1;
    return true;
  }

  return false;
}

function sanitizeStats(stats) {
  return {
    matchesPlayed: Number(stats?.matchesPlayed ?? 0),
    wins: Number(stats?.wins ?? 0),
    kills: Number(stats?.kills ?? 0),
    deaths: Number(stats?.deaths ?? 0),
    shotsFired: Number(stats?.shotsFired ?? 0),
    shotsHit: Number(stats?.shotsHit ?? 0)
  };
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sanitizeLooseText(value, fallback = "", maxLength = 128) {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);

  return normalized || fallback;
}

function safeEqualSecrets(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.from(String(right ?? ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function normalizeClientIp(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "unknown";
  }

  const candidate = raw.includes(",") ? raw.split(",")[0].trim() : raw;
  return candidate.replace(/^::ffff:/, "") || "unknown";
}

function getRequestIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return normalizeClientIp(forwarded);
  }

  return normalizeClientIp(request.socket?.remoteAddress);
}

function getIpFingerprint(ipAddress) {
  const ip = normalizeClientIp(ipAddress);
  if (ip === "unknown") {
    return "unknown";
  }

  if (ip.includes(".")) {
    const octets = ip.split(".");
    return octets.slice(0, 3).join(".");
  }

  if (ip.includes(":")) {
    return ip.split(":").slice(0, 4).join(":");
  }

  return ip;
}

function getUserAgentText(value) {
  return sanitizeLooseText(value ?? "", "", 256) || null;
}

function buildSecurityContext({ request = null, socket = null, ip = null, userAgent = null } = {}) {
  const resolvedIp = ip ?? (request ? getRequestIp(request) : socket?.data?.remoteAddress ?? "unknown");
  const resolvedUserAgent =
    userAgent ??
    (request ? getUserAgentText(request.headers["user-agent"]) : getUserAgentText(socket?.data?.userAgent));

  return {
    ip: normalizeClientIp(resolvedIp),
    ipFingerprint: hashText(getIpFingerprint(resolvedIp)),
    userAgent: resolvedUserAgent,
    userAgentHash: resolvedUserAgent ? hashText(resolvedUserAgent) : null
  };
}

function recordSecurityEvent(type, options = {}) {
  const context = buildSecurityContext(options);
  const entry = {
    id: `sec-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    type: sanitizeLooseText(type ?? "unknown", "unknown", 48),
    severity: sanitizeLooseText(options.severity ?? "warn", "warn", 16),
    createdAt: new Date().toISOString(),
    ip: context.ip,
    ipFingerprint: context.ipFingerprint,
    userAgent: context.userAgent,
    accountId: sanitizeLooseText(options.accountId ?? "", "", 96) || null,
    profileId: sanitizeLooseText(options.profileId ?? "", "", 96) || null,
    message: sanitizeLooseText(options.message ?? "", "", 240) || null,
    metadata: options.metadata && typeof options.metadata === "object" ? options.metadata : {}
  };

  securityEvents.push(entry);
  if (securityEvents.length > MAX_SECURITY_EVENTS) {
    securityEvents.splice(0, securityEvents.length - MAX_SECURITY_EVENTS);
  }
  scheduleBackendSave();
  return entry;
}

function pruneRateLimitCache(cache, now, windowMs) {
  for (const [key, entry] of cache.entries()) {
    if (!entry || now - (Number(entry.windowStartedAt) || 0) >= windowMs) {
      cache.delete(key);
    }
  }

  while (cache.size > MAX_RATE_LIMIT_TRACKED_KEYS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}

function consumeWindowRateLimit(cache, key, now, limit, windowMs) {
  if (cache.size >= MAX_RATE_LIMIT_TRACKED_KEYS) {
    pruneRateLimitCache(cache, now, windowMs);
  }

  const existing = cache.get(key);
  if (!existing || now - existing.windowStartedAt >= windowMs) {
    cache.set(key, {
      windowStartedAt: now,
      count: 1
    });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterMs: 0
    };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfterMs: allowed ? 0 : Math.max(0, existing.windowStartedAt + windowMs - now)
  };
}

function pruneReplayCache(now = Date.now()) {
  for (const [scopeKey, scopeBucket] of requestReplayCache.entries()) {
    pruneReplayScope(scopeBucket, now);
    if (scopeBucket.size === 0) {
      requestReplayCache.delete(scopeKey);
    }
  }

  while (requestReplayCache.size > MAX_REPLAY_SCOPES) {
    const oldestScopeKey = requestReplayCache.keys().next().value;
    if (oldestScopeKey === undefined) {
      break;
    }
    requestReplayCache.delete(oldestScopeKey);
  }
}

function getReplayScopeBucket(scopeKey, now = Date.now()) {
  if (requestReplayCache.size >= MAX_REPLAY_SCOPES) {
    pruneReplayCache(now);
  }

  if (!requestReplayCache.has(scopeKey)) {
    requestReplayCache.set(scopeKey, new Map());
  }

  return requestReplayCache.get(scopeKey);
}

function pruneReplayScope(scopeBucket, now = Date.now()) {
  for (const [requestId, expiresAt] of scopeBucket.entries()) {
    if (expiresAt <= now) {
      scopeBucket.delete(requestId);
    }
  }
}

function getRequestId(request, body = {}) {
  const headerId = request.headers["x-request-id"];
  const candidate =
    typeof headerId === "string" && headerId.trim()
      ? headerId.trim()
      : typeof body?.requestId === "string" && body.requestId.trim()
        ? body.requestId.trim()
        : null;

  if (!candidate) {
    return null;
  }

  const sanitized = candidate.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 96);
  return sanitized || null;
}

function requireFreshRequestId(request, body, scopeKey, options = {}) {
  const now = options.now ?? Date.now();
  const requestId = getRequestId(request, body);

  if (!requestId) {
    return {
      ok: false,
      statusCode: 400,
      code: "missing_request_id",
      message: "Mutating requests require a unique x-request-id"
    };
  }

  const scopeBucket = getReplayScopeBucket(scopeKey, now);
  pruneReplayScope(scopeBucket, now);
  while (scopeBucket.size >= MAX_REPLAY_IDS_PER_SCOPE) {
    const oldestRequestId = scopeBucket.keys().next().value;
    if (oldestRequestId === undefined) {
      break;
    }
    scopeBucket.delete(oldestRequestId);
  }

  if (scopeBucket.has(requestId)) {
    return {
      ok: false,
      statusCode: 409,
      code: "replay_detected",
      message: "Duplicate request id was rejected",
      requestId
    };
  }

  scopeBucket.set(requestId, now + REQUEST_REPLAY_TTL_MS);
  return {
    ok: true,
    requestId
  };
}

function sanitizeAccountUsername(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 24);

  return normalized.length >= 3 ? normalized : null;
}

function normalizeAccountUsername(value) {
  const sanitized = sanitizeAccountUsername(value);
  return sanitized ? sanitized.toLowerCase() : null;
}

function sanitizeAccountEmail(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 120);

  if (!normalized) {
    return null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function sanitizePassword(value) {
  const password = String(value ?? "");
  return password.length >= 8 && password.length <= 160 ? password : null;
}

function createPasswordDigest(password, salt = crypto.randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString("hex")
  };
}

function verifyPasswordDigest(password, salt, expectedHash) {
  const candidateHash = crypto.scryptSync(password, salt, 64);
  const knownHash = Buffer.from(String(expectedHash ?? ""), "hex");

  if (candidateHash.length !== knownHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidateHash, knownHash);
}

function createStatsRecord(stats = {}) {
  const normalized = sanitizeStats(stats);
  return {
    matchesPlayed: Math.max(0, normalized.matchesPlayed),
    wins: Math.max(0, normalized.wins),
    kills: Math.max(0, normalized.kills),
    deaths: Math.max(0, normalized.deaths),
    shotsFired: Math.max(0, normalized.shotsFired),
    shotsHit: Math.max(0, normalized.shotsHit)
  };
}

function getRankTier(mmr) {
  const rating = Math.max(0, Number(mmr) || 0);

  if (rating >= 1850) {
    return "master";
  }

  if (rating >= 1650) {
    return "diamond";
  }

  if (rating >= 1450) {
    return "platinum";
  }

  if (rating >= 1250) {
    return "gold";
  }

  if (rating >= 1100) {
    return "silver";
  }

  return "bronze";
}

function createDefaultRanking(ranking = {}) {
  const mmr = Math.max(0, Number(ranking?.mmr ?? 1000) || 1000);
  const wins = Math.max(0, Number(ranking?.wins ?? 0) || 0);
  const losses = Math.max(0, Number(ranking?.losses ?? 0) || 0);
  return {
    seasonId: sanitizeLooseText(ranking?.seasonId ?? currentSeasonId, currentSeasonId, 32),
    mmr,
    tier: sanitizeLooseText(ranking?.tier ?? getRankTier(mmr), getRankTier(mmr), 24),
    wins,
    losses,
    matchesPlayed: Math.max(0, Number(ranking?.matchesPlayed ?? wins + losses) || wins + losses),
    updatedAt: ranking?.updatedAt ?? new Date().toISOString()
  };
}

function createDefaultSeasonStats(seasonStats = {}) {
  const baseStats = createStatsRecord(seasonStats);
  return {
    seasonId: sanitizeLooseText(seasonStats?.seasonId ?? currentSeasonId, currentSeasonId, 32),
    matchesPlayed: Math.max(0, Number(seasonStats?.matchesPlayed ?? baseStats.matchesPlayed) || baseStats.matchesPlayed),
    wins: Math.max(0, Number(seasonStats?.wins ?? baseStats.wins) || baseStats.wins),
    losses: Math.max(
      0,
      Number(
        seasonStats?.losses ??
          Math.max(0, (seasonStats?.matchesPlayed ?? baseStats.matchesPlayed) - (seasonStats?.wins ?? baseStats.wins))
      ) || 0
    ),
    kills: baseStats.kills,
    deaths: baseStats.deaths,
    shotsFired: baseStats.shotsFired,
    shotsHit: baseStats.shotsHit,
    bestMmr: Math.max(0, Number(seasonStats?.bestMmr ?? 1000) || 1000),
    updatedAt: seasonStats?.updatedAt ?? new Date().toISOString()
  };
}

function sanitizePersistentInventory(inventory = {}) {
  const revision = Math.max(1, Number(inventory?.revision ?? 1) || 1);
  const items = Array.isArray(inventory?.items)
    ? inventory.items
        .map((item) => ({
          itemId: sanitizeLooseText(item?.itemId ?? "", "", 64),
          quantity: Math.max(0, Number(item?.quantity ?? 0) || 0),
          kind: sanitizeLooseText(item?.kind ?? "item", "item", 32),
          source: sanitizeLooseText(item?.source ?? "system", "system", 48),
          grantedAt: item?.grantedAt ?? new Date().toISOString()
        }))
        .filter((item) => item.itemId && item.quantity > 0)
    : [
        {
          itemId: "shell-cannon",
          quantity: 1,
          kind: "weapon",
          source: "starter",
          grantedAt: new Date().toISOString()
        }
      ];
  const loadouts = Array.isArray(inventory?.loadouts)
    ? inventory.loadouts
        .map((loadout, index) => ({
          id: sanitizeLooseText(loadout?.id ?? `loadout-${index + 1}`, `loadout-${index + 1}`, 32),
          name: sanitizeLooseText(loadout?.name ?? `Loadout ${index + 1}`, `Loadout ${index + 1}`, 48),
          slots: Array.isArray(loadout?.slots)
            ? loadout.slots
                .map((slot) => ({
                  slot: sanitizeLooseText(slot?.slot ?? "", "", 24),
                  itemId: sanitizeLooseText(slot?.itemId ?? "", "", 64)
                }))
                .filter((slot) => slot.slot && slot.itemId)
            : []
        }))
        .filter((loadout) => loadout.id)
    : [
        {
          id: "default",
          name: "Default",
          slots: [{ slot: "weapon", itemId: "shell-cannon" }]
        }
      ];

  const selectedLoadoutId =
    sanitizeLooseText(inventory?.selectedLoadoutId ?? loadouts[0]?.id ?? "default", loadouts[0]?.id ?? "default", 32);

  return {
    revision,
    items,
    loadouts,
    selectedLoadoutId
  };
}

function sanitizeEntitlements(entitlements = []) {
  return Array.from(
    new Set(
      (Array.isArray(entitlements) ? entitlements : [])
        .map((entry) => sanitizeLooseText(entry, "", 96))
        .filter(Boolean)
    )
  );
}

function sanitizeWallet(wallet = {}) {
  return {
    coins: Math.max(0, Number(wallet?.coins ?? 500) || 500)
  };
}

function sanitizeCloudSave(cloudSave = {}) {
  const rawData = cloudSave?.data && typeof cloudSave.data === "object" ? cloudSave.data : {};
  const serialized = JSON.stringify(rawData);
  return {
    revision: Math.max(0, Number(cloudSave?.revision ?? 0) || 0),
    updatedAt: cloudSave?.updatedAt ?? null,
    data: Buffer.byteLength(serialized, "utf8") <= MAX_CLOUD_SAVE_BYTES ? rawData : {}
  };
}

function createDefaultBackendProfile(profileId, options = {}) {
  return {
    profileId,
    accountId: sanitizeLooseText(options.accountId ?? "", "", 96) || null,
    displayName: sanitizePlayerName(options.displayName ?? "Commander"),
    createdAt: options.createdAt ?? new Date().toISOString(),
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    cumulativeStats: createStatsRecord(options.cumulativeStats),
    ranking: createDefaultRanking(options.ranking),
    seasonStats: createDefaultSeasonStats(options.seasonStats),
    inventory: sanitizePersistentInventory(options.inventory),
    entitlements: sanitizeEntitlements(options.entitlements),
    cloudSave: sanitizeCloudSave(options.cloudSave)
  };
}

function ensureCurrentSeason(profile) {
  if (!profile) {
    return null;
  }

  if (profile.seasonStats?.seasonId !== currentSeasonId) {
    profile.seasonStats = createDefaultSeasonStats({
      seasonId: currentSeasonId,
      bestMmr: profile.ranking?.mmr ?? 1000
    });
  }

  if (profile.ranking?.seasonId !== currentSeasonId) {
    profile.ranking = createDefaultRanking({
      mmr: profile.ranking?.mmr ?? 1000,
      seasonId: currentSeasonId
    });
  }

  return profile;
}

function syncBackendProfileToLegacy(profile) {
  if (!profile?.profileId) {
    return null;
  }

  const existing = profiles.get(profile.profileId);
  if (existing) {
    existing.lastKnownName = sanitizePlayerName(profile.displayName);
    existing.lastSeenAt = new Date().toISOString();
    existing.stats = createStatsRecord(profile.cumulativeStats);
    return existing;
  }

  const created = createProfile(profile.profileId, profile.displayName);
  created.stats = createStatsRecord(profile.cumulativeStats);
  profiles.set(profile.profileId, created);
  return created;
}

function ensureBackendProfile(profileId, options = {}) {
  const safeProfileId = sanitizeProfileId(profileId);
  if (!safeProfileId) {
    return null;
  }

  const legacyProfile = profiles.get(safeProfileId);
  const displayName = sanitizePlayerName(
    options.displayName ?? legacyProfile?.lastKnownName ?? options.playerName ?? "Commander"
  );
  const cumulativeStats = createStatsRecord(options.cumulativeStats ?? legacyProfile?.stats);
  const existing = backendProfiles.get(safeProfileId);

  if (existing) {
    existing.accountId =
      options.accountId !== undefined
        ? sanitizeLooseText(options.accountId ?? "", "", 96) || null
        : existing.accountId ?? null;
    existing.displayName = displayName;
    existing.updatedAt = new Date().toISOString();
    existing.cumulativeStats = cumulativeStats;
    existing.inventory = sanitizePersistentInventory(existing.inventory);
    existing.entitlements = sanitizeEntitlements(existing.entitlements);
    existing.cloudSave = sanitizeCloudSave(existing.cloudSave);
    existing.ranking = createDefaultRanking(existing.ranking);
    existing.seasonStats = createDefaultSeasonStats(existing.seasonStats);
    ensureCurrentSeason(existing);
    syncBackendProfileToLegacy(existing);
    return existing;
  }

  const created = createDefaultBackendProfile(safeProfileId, {
    ...options,
    displayName,
    cumulativeStats
  });
  ensureCurrentSeason(created);
  backendProfiles.set(safeProfileId, created);
  syncBackendProfileToLegacy(created);
  return created;
}

function createAccountRecord({ username, email, password, displayName, profileId = null }) {
  const accountId = crypto.randomUUID();
  const safeUsername = sanitizeAccountUsername(username);
  const safeEmail = sanitizeAccountEmail(email);
  const safePassword = sanitizePassword(password);
  const safeProfileId = sanitizeProfileId(profileId) ?? crypto.randomUUID().replace(/-/g, "");

  if (!safeUsername || !safePassword) {
    return null;
  }

  const digest = createPasswordDigest(safePassword);
  return {
    accountId,
    username: safeUsername,
    usernameNormalized: safeUsername.toLowerCase(),
    email: safeEmail,
    emailNormalized: safeEmail,
    passwordSalt: digest.salt,
    passwordHash: digest.hash,
    profileId: safeProfileId,
    displayName: sanitizePlayerName(displayName ?? safeUsername),
    wallet: sanitizeWallet(),
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    lastSeenAt: new Date().toISOString()
  };
}

function findAccountByUsername(username) {
  const normalized = normalizeAccountUsername(username);
  if (!normalized) {
    return null;
  }

  return Array.from(accounts.values()).find((account) => account.usernameNormalized === normalized) ?? null;
}

function findAccountByEmail(email) {
  const normalized = sanitizeAccountEmail(email);
  if (!normalized) {
    return null;
  }

  return Array.from(accounts.values()).find((account) => account.emailNormalized === normalized) ?? null;
}

function findAccountByLogin(login) {
  return findAccountByUsername(login) ?? findAccountByEmail(login);
}

function hashSessionToken(secret) {
  return hashText(secret);
}

function buildSessionBinding(context = {}) {
  const securityContext = buildSecurityContext(context);
  return {
    ipFingerprint: securityContext.ipFingerprint,
    userAgentHash: securityContext.userAgentHash,
    lastIpFingerprint: securityContext.ipFingerprint,
    establishedAt: new Date().toISOString()
  };
}

function validateSessionBinding(session, context = {}) {
  const binding = session?.binding ?? null;
  if (!binding) {
    return {
      ok: true,
      suspiciousIpShift: false
    };
  }

  const securityContext = buildSecurityContext(context);
  if (
    binding.userAgentHash &&
    securityContext.userAgentHash &&
    !safeEqualSecrets(binding.userAgentHash, securityContext.userAgentHash)
  ) {
    return {
      ok: false,
      reason: "user_agent_mismatch",
      securityContext
    };
  }

  const suspiciousIpShift =
    binding.lastIpFingerprint &&
    securityContext.ipFingerprint &&
    !safeEqualSecrets(binding.lastIpFingerprint, securityContext.ipFingerprint);

  session.binding.lastIpFingerprint = securityContext.ipFingerprint;
  return {
    ok: true,
    suspiciousIpShift,
    securityContext
  };
}

function purgeExpiredSessions(now = Date.now()) {
  let removed = 0;

  for (const [sessionId, session] of authSessions.entries()) {
    if ((Number(session?.expiresAt) || 0) <= now) {
      authSessions.delete(sessionId);
      removed += 1;
    }
  }

  return removed;
}

function createAuthSession(accountId, context = {}, now = Date.now()) {
  purgeExpiredSessions(now);
  const secret = crypto.randomBytes(32).toString("hex");
  const sessionId = crypto.randomUUID();
  const session = {
    sessionId,
    accountId,
    tokenHash: hashSessionToken(secret),
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: now + AUTH_SESSION_TTL_MS,
    binding: buildSessionBinding(context)
  };

  authSessions.set(sessionId, session);
  scheduleBackendSave();

  return {
    token: `${sessionId}.${secret}`,
    session
  };
}

function getAuthTokenFromRequest(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const headerToken = request.headers["x-session-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }

  return null;
}

function getSessionByToken(token, context = {}, now = Date.now()) {
  if (!token) {
    return null;
  }

  purgeExpiredSessions(now);
  const [sessionId, secret] = String(token).split(".", 2);

  if (sessionId && secret) {
    const session = authSessions.get(sessionId) ?? null;
    if (!session || !safeEqualSecrets(session.tokenHash, hashSessionToken(secret))) {
      return null;
    }

    const bindingVerdict = validateSessionBinding(session, context);
    if (!bindingVerdict.ok) {
      recordSecurityEvent("session_binding_mismatch", {
        ...context,
        accountId: session.accountId,
        severity: "warn",
        message: "Authenticated request was rejected because session binding changed",
        metadata: {
          reason: bindingVerdict.reason
        }
      });
      return null;
    }

    if (bindingVerdict.suspiciousIpShift) {
      recordSecurityEvent("session_ip_shift", {
        ...context,
        accountId: session.accountId,
        severity: "info",
        message: "Authenticated session continued from a new network fingerprint"
      });
    }

    return session;
  }

  const tokenHash = hashSessionToken(token);
  return Array.from(authSessions.values()).find((session) => safeEqualSecrets(session.tokenHash, tokenHash)) ?? null;
}

function destroySession(sessionId) {
  if (authSessions.delete(sessionId)) {
    scheduleBackendSave();
  }
}

function destroySessionsForAccount(accountId) {
  let removed = false;

  for (const [sessionId, session] of authSessions.entries()) {
    if (session.accountId === accountId) {
      authSessions.delete(sessionId);
      removed = true;
    }
  }

  if (removed) {
    scheduleBackendSave();
  }
}

function getAuthenticatedRequestContext(request) {
  const token = getAuthTokenFromRequest(request);
  const securityContext = buildSecurityContext({ request });
  const session = getSessionByToken(token, securityContext);

  if (!session) {
    return {
      token: null,
      session: null,
      account: null,
      profile: null,
      securityContext
    };
  }

  const account = accounts.get(session.accountId) ?? null;
  const profile = account ? ensureBackendProfile(account.profileId, { accountId: account.accountId, displayName: account.displayName }) : null;

  session.lastSeenAt = new Date().toISOString();
  if (account) {
    account.lastSeenAt = new Date().toISOString();
  }
  scheduleBackendSave();

  return {
    token,
    session,
    account,
    profile,
    securityContext
  };
}

function buildPersistenceSnapshot({ accountId = null, profileId = null } = {}) {
  return {
    accountId,
    profileId,
    account: accountId ? deepClone(accounts.get(accountId) ?? null) : null,
    profile: profileId ? deepClone(backendProfiles.get(profileId) ?? null) : null,
    legacyProfile: profileId ? deepClone(profiles.get(profileId) ?? null) : null
  };
}

function applyPersistenceSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  if (Object.hasOwn(snapshot, "accountId")) {
    if (snapshot.account) {
      accounts.set(snapshot.accountId, snapshot.account);
    } else if (snapshot.accountId) {
      accounts.delete(snapshot.accountId);
      destroySessionsForAccount(snapshot.accountId);
    }
  }

  if (Object.hasOwn(snapshot, "profileId")) {
    if (snapshot.profile) {
      backendProfiles.set(snapshot.profileId, snapshot.profile);
    } else if (snapshot.profileId) {
      backendProfiles.delete(snapshot.profileId);
    }

    if (snapshot.legacyProfile) {
      profiles.set(snapshot.profileId, snapshot.legacyProfile);
    } else if (snapshot.profileId) {
      profiles.delete(snapshot.profileId);
    }
  }

  scheduleProfileSave();
  scheduleBackendSave();
}

function recordBackendTransaction({
  type,
  accountId = null,
  profileId = null,
  actorType = "system",
  actorId = null,
  metadata = {},
  before = null,
  after = null,
  reversible = true
}) {
  const id = `tx-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  transactionLog.set(id, {
    id,
    type: sanitizeLooseText(type ?? "unknown", "unknown", 48),
    accountId: sanitizeLooseText(accountId ?? "", "", 96) || null,
    profileId: sanitizeLooseText(profileId ?? "", "", 96) || null,
    actorType: sanitizeLooseText(actorType ?? "system", "system", 24),
    actorId: sanitizeLooseText(actorId ?? "", "", 96) || null,
    createdAt: new Date().toISOString(),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    before,
    after,
    reversible: Boolean(reversible)
  });

  while (transactionLog.size > MAX_TRANSACTION_HISTORY) {
    const oldestKey = transactionLog.keys().next().value;
    transactionLog.delete(oldestKey);
  }

  scheduleBackendSave();
  return transactionLog.get(id);
}

function hasEntitlement(profile, entitlementId) {
  const safeEntitlementId = sanitizeLooseText(entitlementId, "", 96);
  if (!safeEntitlementId || !profile) {
    return false;
  }

  return profile.entitlements.includes(safeEntitlementId);
}

function grantEntitlement(profile, entitlementId) {
  if (!profile) {
    return false;
  }

  const safeEntitlementId = sanitizeLooseText(entitlementId, "", 96);
  if (!safeEntitlementId || hasEntitlement(profile, safeEntitlementId)) {
    return false;
  }

  profile.entitlements.push(safeEntitlementId);
  profile.entitlements = sanitizeEntitlements(profile.entitlements);
  profile.updatedAt = new Date().toISOString();
  return true;
}

function grantInventoryItem(profile, itemId, quantity = 1, kind = "item", source = "system") {
  if (!profile) {
    return false;
  }

  const safeItemId = sanitizeLooseText(itemId, "", 64);
  const safeQuantity = Math.max(0, Number(quantity) || 0);
  if (!safeItemId || safeQuantity <= 0) {
    return false;
  }

  const existing = profile.inventory.items.find((item) => item.itemId === safeItemId);
  if (existing) {
    existing.quantity += safeQuantity;
    existing.source = sanitizeLooseText(source, existing.source, 48);
  } else {
    profile.inventory.items.push({
      itemId: safeItemId,
      quantity: safeQuantity,
      kind: sanitizeLooseText(kind, "item", 32),
      source: sanitizeLooseText(source, "system", 48),
      grantedAt: new Date().toISOString()
    });
  }

  profile.inventory.revision += 1;
  profile.updatedAt = new Date().toISOString();
  return true;
}

function updateSeasonStatsFromDelta(profile, delta = {}) {
  if (!profile) {
    return;
  }

  ensureCurrentSeason(profile);
  const seasonStats = profile.seasonStats;
  seasonStats.matchesPlayed += Math.max(0, Number(delta.matchesPlayed ?? 0) || 0);
  seasonStats.wins += Math.max(0, Number(delta.wins ?? 0) || 0);
  seasonStats.losses += Math.max(0, Number(delta.losses ?? 0) || 0);
  seasonStats.kills += Math.max(0, Number(delta.kills ?? 0) || 0);
  seasonStats.deaths += Math.max(0, Number(delta.deaths ?? 0) || 0);
  seasonStats.shotsFired += Math.max(0, Number(delta.shotsFired ?? 0) || 0);
  seasonStats.shotsHit += Math.max(0, Number(delta.shotsHit ?? 0) || 0);
  seasonStats.bestMmr = Math.max(seasonStats.bestMmr, profile.ranking.mmr);
  seasonStats.updatedAt = new Date().toISOString();
}

function createBackendDocument() {
  return {
    schemaVersion: BACKEND_SCHEMA_VERSION,
    currentSeasonId,
    gameVersion,
    assetVersion,
    updatedAt: new Date().toISOString(),
    accounts: Array.from(accounts.values()),
    profiles: Array.from(backendProfiles.values()),
    sessions: Array.from(authSessions.values()),
    transactions: Array.from(transactionLog.values()),
    securityEvents
  };
}

function normalizeBackendDocument(parsed) {
  if (parsed && typeof parsed === "object") {
    return {
      schemaVersion: Math.max(1, Number(parsed.schemaVersion) || 1),
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      securityEvents: Array.isArray(parsed.securityEvents) ? parsed.securityEvents : []
    };
  }

  return {
    schemaVersion: BACKEND_SCHEMA_VERSION,
    accounts: [],
    profiles: [],
    sessions: [],
    transactions: [],
    securityEvents: []
  };
}

function migrateBackendDocument(parsedDocument) {
  const document = normalizeBackendDocument(parsedDocument);

  if (document.schemaVersion > BACKEND_SCHEMA_VERSION) {
    throw new Error(
      `backend.json schema ${document.schemaVersion} is newer than supported schema ${BACKEND_SCHEMA_VERSION}`
    );
  }

  if (document.schemaVersion === BACKEND_SCHEMA_VERSION) {
    return {
      schemaVersion: BACKEND_SCHEMA_VERSION,
      accounts: document.accounts,
      profiles: document.profiles,
      sessions: document.sessions,
      transactions: document.transactions,
      securityEvents: document.securityEvents,
      migrated: false
    };
  }

  throw new Error(`No migration rule exists from backend schema ${document.schemaVersion}`);
}

async function loadBackend() {
  try {
    const raw = await fs.readFile(backendPath, "utf8");
    const parsed = JSON.parse(raw);
    const migrated = migrateBackendDocument(parsed);

    for (const entry of migrated.accounts) {
      if (!entry?.accountId || !sanitizeAccountUsername(entry.username)) {
        continue;
      }

      accounts.set(entry.accountId, {
        accountId: entry.accountId,
        username: sanitizeAccountUsername(entry.username),
        usernameNormalized: normalizeAccountUsername(entry.username),
        email: sanitizeAccountEmail(entry.email),
        emailNormalized: sanitizeAccountEmail(entry.email),
        passwordSalt: sanitizeLooseText(entry.passwordSalt ?? "", "", 128),
        passwordHash: sanitizeLooseText(entry.passwordHash ?? "", "", 256),
        profileId: sanitizeProfileId(entry.profileId) ?? crypto.randomUUID().replace(/-/g, ""),
        displayName: sanitizePlayerName(entry.displayName ?? entry.username),
        wallet: sanitizeWallet(entry.wallet),
        createdAt: entry.createdAt ?? new Date().toISOString(),
        lastLoginAt: entry.lastLoginAt ?? null,
        lastSeenAt: entry.lastSeenAt ?? new Date().toISOString()
      });
    }

    for (const entry of migrated.profiles) {
      const safeProfileId = sanitizeProfileId(entry?.profileId);
      if (!safeProfileId) {
        continue;
      }

      backendProfiles.set(
        safeProfileId,
        createDefaultBackendProfile(safeProfileId, {
          accountId: entry.accountId,
          displayName: entry.displayName,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          cumulativeStats: entry.cumulativeStats,
          ranking: entry.ranking,
          seasonStats: entry.seasonStats,
          inventory: entry.inventory,
          entitlements: entry.entitlements,
          cloudSave: entry.cloudSave
        })
      );
      ensureCurrentSeason(backendProfiles.get(safeProfileId));
      syncBackendProfileToLegacy(backendProfiles.get(safeProfileId));
    }

    for (const entry of migrated.sessions) {
      if (!entry?.sessionId || !entry?.accountId || !entry?.tokenHash) {
        continue;
      }

      authSessions.set(entry.sessionId, {
        sessionId: entry.sessionId,
        accountId: entry.accountId,
        tokenHash: sanitizeLooseText(entry.tokenHash, "", 256),
        createdAt: entry.createdAt ?? new Date().toISOString(),
        lastSeenAt: entry.lastSeenAt ?? new Date().toISOString(),
        expiresAt: Math.max(Date.now(), Number(entry.expiresAt) || Date.now()),
        binding: entry.binding && typeof entry.binding === "object"
          ? {
              ipFingerprint: sanitizeLooseText(entry.binding.ipFingerprint ?? "", "", 128) || null,
              userAgentHash: sanitizeLooseText(entry.binding.userAgentHash ?? "", "", 128) || null,
              lastIpFingerprint:
                sanitizeLooseText(entry.binding.lastIpFingerprint ?? entry.binding.ipFingerprint ?? "", "", 128) || null,
              establishedAt: entry.binding.establishedAt ?? entry.createdAt ?? new Date().toISOString()
            }
          : null
      });
    }

    for (const entry of migrated.transactions) {
      if (!entry?.id) {
        continue;
      }

      transactionLog.set(entry.id, {
        id: entry.id,
        type: sanitizeLooseText(entry.type ?? "unknown", "unknown", 48),
        accountId: sanitizeLooseText(entry.accountId ?? "", "", 96) || null,
        profileId: sanitizeLooseText(entry.profileId ?? "", "", 96) || null,
        actorType: sanitizeLooseText(entry.actorType ?? "system", "system", 24),
        actorId: sanitizeLooseText(entry.actorId ?? "", "", 96) || null,
        createdAt: entry.createdAt ?? new Date().toISOString(),
        metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
        before: entry.before ?? null,
        after: entry.after ?? null,
        reversible: entry.reversible !== false
      });
    }

    securityEvents.length = 0;
    for (const entry of migrated.securityEvents.slice(-MAX_SECURITY_EVENTS)) {
      securityEvents.push({
        id: sanitizeLooseText(entry?.id ?? "", "", 96) || `sec-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`,
        type: sanitizeLooseText(entry?.type ?? "unknown", "unknown", 48),
        severity: sanitizeLooseText(entry?.severity ?? "warn", "warn", 16),
        createdAt: entry?.createdAt ?? new Date().toISOString(),
        ip: normalizeClientIp(entry?.ip),
        ipFingerprint: sanitizeLooseText(entry?.ipFingerprint ?? "", "", 128) || null,
        userAgent: getUserAgentText(entry?.userAgent),
        accountId: sanitizeLooseText(entry?.accountId ?? "", "", 96) || null,
        profileId: sanitizeLooseText(entry?.profileId ?? "", "", 96) || null,
        message: sanitizeLooseText(entry?.message ?? "", "", 240) || null,
        metadata: entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {}
      });
    }

    purgeExpiredSessions();

    if (migrated.migrated) {
      scheduleBackendSave();
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to load backend data", error);
    }
  }

  for (const legacyProfile of profiles.values()) {
    ensureBackendProfile(legacyProfile.profileId, {
      displayName: legacyProfile.lastKnownName,
      cumulativeStats: legacyProfile.stats
    });
  }

  backendLoaded = true;
}

function scheduleBackendSave() {
  if (saveBackendTimer) {
    return;
  }

  saveBackendTimer = setTimeout(async () => {
    saveBackendTimer = null;

    try {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        backendPath,
        `${JSON.stringify(createBackendDocument(), null, 2)}\n`,
        "utf8"
      );
    } catch (error) {
      console.error("Failed to persist backend data", error);
    }
  }, 150);
}

async function flushBackend() {
  if (saveBackendTimer) {
    clearTimeout(saveBackendTimer);
    saveBackendTimer = null;
  }

  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      backendPath,
      `${JSON.stringify(createBackendDocument(), null, 2)}\n`,
      "utf8"
    );
  } catch (error) {
    console.error("Failed to flush backend data", error);
  }
}

function getSafePurchaseCatalog() {
  return Array.from(purchaseCatalog.values()).map((entry) => ({
    sku: entry.sku,
    name: entry.name,
    price: entry.price,
    kind: entry.kind,
    entitlementId: entry.entitlementId
  }));
}

function getAccountSummary(account) {
  if (!account) {
    return null;
  }

  return {
    accountId: account.accountId,
    username: account.username,
    email: account.email,
    displayName: account.displayName,
    profileId: account.profileId,
    wallet: sanitizeWallet(account.wallet),
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
    lastSeenAt: account.lastSeenAt
  };
}

function getProfileProgressionSummary(profile) {
  if (!profile) {
    return null;
  }

  ensureCurrentSeason(profile);
  return {
    profileId: profile.profileId,
    accountId: profile.accountId,
    displayName: profile.displayName,
    cumulativeStats: createStatsRecord(profile.cumulativeStats),
    ranking: createDefaultRanking(profile.ranking),
    seasonStats: createDefaultSeasonStats(profile.seasonStats),
    inventory: sanitizePersistentInventory(profile.inventory),
    entitlements: sanitizeEntitlements(profile.entitlements),
    cloudSave: sanitizeCloudSave(profile.cloudSave),
    updatedAt: profile.updatedAt,
    createdAt: profile.createdAt
  };
}

function computeExpectedScore(playerMmr, opponentMmr) {
  return 1 / (1 + 10 ** ((opponentMmr - playerMmr) / 400));
}

function updatePersistentRankingsForMatch(room, winner, now) {
  const activeHumans = Array.from(room.players.values()).filter(
    (player) => !player.isBot && !player.isSpectator
  );

  if (activeHumans.length < 2) {
    return;
  }

  for (const player of activeHumans) {
    const backendProfile = ensureBackendProfile(player.profileId, {
      displayName: player.name,
      cumulativeStats: player.profileStats
    });
    ensureCurrentSeason(backendProfile);
  }

  for (const player of activeHumans) {
    const backendProfile = backendProfiles.get(player.profileId);
    if (!backendProfile) {
      continue;
    }

    const before = buildPersistenceSnapshot({
      accountId: backendProfile.accountId,
      profileId: backendProfile.profileId
    });

    const opponents = activeHumans.filter((candidate) => candidate.id !== player.id);
    if (opponents.length === 0) {
      continue;
    }

    const averageOpponentMmr =
      opponents.reduce(
        (total, opponent) => total + (backendProfiles.get(opponent.profileId)?.ranking?.mmr ?? 1000),
        0
      ) / opponents.length;
    const actualScore = winner ? Number(winner.id === player.id) : 0;
    const expectedScore = computeExpectedScore(backendProfile.ranking.mmr, averageOpponentMmr);
    const delta = Math.round(28 * (actualScore - expectedScore));

    backendProfile.ranking.mmr = Math.max(0, backendProfile.ranking.mmr + delta);
    backendProfile.ranking.tier = getRankTier(backendProfile.ranking.mmr);
    backendProfile.ranking.matchesPlayed += 1;
    if (actualScore >= 1) {
      backendProfile.ranking.wins += 1;
    } else {
      backendProfile.ranking.losses += 1;
    }
    backendProfile.ranking.updatedAt = new Date(now).toISOString();

    ensureCurrentSeason(backendProfile);
    backendProfile.seasonStats.losses = Math.max(
      0,
      backendProfile.seasonStats.matchesPlayed - backendProfile.seasonStats.wins
    );
    backendProfile.seasonStats.bestMmr = Math.max(
      backendProfile.seasonStats.bestMmr,
      backendProfile.ranking.mmr
    );
    backendProfile.seasonStats.updatedAt = new Date(now).toISOString();
    backendProfile.updatedAt = new Date(now).toISOString();

    recordBackendTransaction({
      type: "season_rank_update",
      accountId: backendProfile.accountId,
      profileId: backendProfile.profileId,
      actorType: "system",
      metadata: {
        roomId: room.id,
        winnerId: winner?.id ?? null,
        mmrDelta: delta,
        seasonId: currentSeasonId
      },
      before,
      after: buildPersistenceSnapshot({
        accountId: backendProfile.accountId,
        profileId: backendProfile.profileId
      })
    });
  }

  scheduleBackendSave();
}

function getTopRankedProfiles(limit = 10) {
  return Array.from(backendProfiles.values())
    .map((profile) => getProfileProgressionSummary(profile))
    .sort(
      (left, right) =>
        right.ranking.mmr - left.ranking.mmr ||
        right.seasonStats.wins - left.seasonStats.wins ||
        left.displayName.localeCompare(right.displayName)
    )
    .slice(0, limit)
    .map((profile) => ({
      profileId: profile.profileId,
      displayName: profile.displayName,
      mmr: profile.ranking.mmr,
      tier: profile.ranking.tier,
      wins: profile.seasonStats.wins,
      losses: profile.seasonStats.losses
    }));
}

function requireAdminRequest(request) {
  if (!adminApiKey) {
    return false;
  }

  const providedKey = request.headers["x-admin-key"];
  return typeof providedKey === "string" && safeEqualSecrets(providedKey, adminApiKey);
}

function requireAllocatorRequest(request) {
  if (!allocatorApiKey) {
    return false;
  }

  const providedKey = request.headers["x-allocator-key"] ?? request.headers["x-admin-key"];
  return typeof providedKey === "string" && safeEqualSecrets(providedKey, allocatorApiKey);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));

    const totalBytes = chunks.reduce((sum, entry) => sum + entry.length, 0);
    if (totalBytes > GAME_CONFIG.network.maxPacketBytes) {
      throw new Error("Request body exceeded maximum size");
    }
  }

  if (chunks.length === 0) {
    return {};
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

function isJsonRequest(request) {
  const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
  return !contentType || contentType.includes("application/json");
}

function recordInvalidJsonRequest(request, pathname, message) {
  recordSecurityEvent("invalid_json_body", {
    request,
    severity: "info",
    message,
    metadata: {
      pathname
    }
  });
}

function enforceHttpRateLimit(request, category = "apiRead", response = null) {
  const limits = SECURITY_RATE_WINDOWS[category] ?? SECURITY_RATE_WINDOWS.apiRead;
  const ip = getRequestIp(request);
  const now = Date.now();
  const verdict = consumeWindowRateLimit(httpRateLimits, `${category}:${ip}`, now, limits.limit, limits.windowMs);

  if (verdict.allowed) {
    return true;
  }

  recordSecurityEvent("http_rate_limit_exceeded", {
    request,
    severity: category === "admin" ? "warn" : "info",
    message: "HTTP rate limit exceeded",
    metadata: {
      category,
      retryAfterMs: verdict.retryAfterMs
    }
  });

  if (response) {
    response.setHeader("Retry-After", String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))));
    writeApiError(response, 429, "rate_limited", "Too many requests. Please slow down.", {
      retryAfterMs: verdict.retryAfterMs
    });
  }

  return false;
}

function buildReplayScopeKey(request, auth, options = {}) {
  if (options.admin) {
    return `admin:${getRequestIp(request)}`;
  }

  if (options.allocator) {
    return `allocator:${getRequestIp(request)}`;
  }

  if (auth?.session?.sessionId) {
    return `session:${auth.session.sessionId}`;
  }

  return `ip:${getRequestIp(request)}`;
}

function requireMutationProtection(request, response, body, auth, options = {}) {
  const now = Date.now();
  const replayVerdict = requireFreshRequestId(
    request,
    body,
    buildReplayScopeKey(request, auth, options),
    { now }
  );

  if (!replayVerdict.ok) {
    recordSecurityEvent("replay_attempt_blocked", {
      request,
      accountId: auth?.account?.accountId,
      profileId: auth?.profile?.profileId,
      severity: "warn",
      message: replayVerdict.message,
      metadata: {
        scope: buildReplayScopeKey(request, auth, options),
        requestId: replayVerdict.requestId ?? null
      }
    });
    writeApiError(response, replayVerdict.statusCode, replayVerdict.code, replayVerdict.message);
    return null;
  }

  return replayVerdict.requestId;
}

async function loadProfiles() {
  try {
    const raw = await fs.readFile(profilesPath, "utf8");
    const parsed = JSON.parse(raw);
    const migratedDocument = migrateProfilesDocument(parsed);

    for (const entry of migratedDocument.profiles) {
      if (!entry?.profileId) {
        continue;
      }

      profiles.set(entry.profileId, {
        profileId: entry.profileId,
        lastKnownName: sanitizePlayerName(entry.lastKnownName),
        createdAt: entry.createdAt ?? new Date().toISOString(),
        lastSeenAt: entry.lastSeenAt ?? new Date().toISOString(),
        stats: sanitizeStats(entry.stats)
      });
    }

    if (migratedDocument.migrated) {
      scheduleProfileSave();
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to load profiles", error);
    }
  }

  profilesLoaded = true;
}

function scheduleProfileSave() {
  if (saveProfilesTimer) {
    return;
  }

  saveProfilesTimer = setTimeout(async () => {
    saveProfilesTimer = null;

    try {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        profilesPath,
        `${JSON.stringify(createProfilesDocument(), null, 2)}\n`,
        "utf8"
      );
    } catch (error) {
      console.error("Failed to persist profiles", error);
    }
  }, 150);
}

async function flushProfiles() {
  if (saveProfilesTimer) {
    clearTimeout(saveProfilesTimer);
    saveProfilesTimer = null;
  }

  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      profilesPath,
      `${JSON.stringify(createProfilesDocument(), null, 2)}\n`,
      "utf8"
    );
  } catch (error) {
    console.error("Failed to flush profiles", error);
  }
}

function getOrCreateProfile(profileId, playerName) {
  const safeProfileId = sanitizeProfileId(profileId) ?? crypto.randomUUID();
  const safePlayerName = sanitizePlayerName(playerName);
  const existing = profiles.get(safeProfileId);

  if (existing) {
    existing.lastKnownName = safePlayerName;
    existing.lastSeenAt = new Date().toISOString();
    ensureBackendProfile(safeProfileId, {
      displayName: safePlayerName,
      cumulativeStats: existing.stats
    });
    scheduleProfileSave();
    scheduleBackendSave();
    return existing;
  }

  const created = createProfile(safeProfileId, safePlayerName);
  profiles.set(safeProfileId, created);
  ensureBackendProfile(safeProfileId, {
    displayName: safePlayerName,
    cumulativeStats: created.stats
  });
  scheduleProfileSave();
  scheduleBackendSave();
  return created;
}

function updateProfileStats(profileId, updater) {
  const profile = profiles.get(profileId);
  if (!profile) {
    return;
  }

  const beforeStats = createStatsRecord(profile.stats);
  updater(profile.stats);
  profile.stats = createStatsRecord(profile.stats);
  profile.lastSeenAt = new Date().toISOString();

  const backendProfile = ensureBackendProfile(profileId, {
    displayName: profile.lastKnownName,
    cumulativeStats: profile.stats
  });
  if (backendProfile) {
    const delta = {
      matchesPlayed: Math.max(0, profile.stats.matchesPlayed - beforeStats.matchesPlayed),
      wins: Math.max(0, profile.stats.wins - beforeStats.wins),
      kills: Math.max(0, profile.stats.kills - beforeStats.kills),
      deaths: Math.max(0, profile.stats.deaths - beforeStats.deaths),
      shotsFired: Math.max(0, profile.stats.shotsFired - beforeStats.shotsFired),
      shotsHit: Math.max(0, profile.stats.shotsHit - beforeStats.shotsHit)
    };
    updateSeasonStatsFromDelta(backendProfile, delta);
    backendProfile.updatedAt = new Date().toISOString();
  }

  scheduleProfileSave();
  scheduleBackendSave();
}

function getConnectedPlayers(room) {
  return Array.from(room.players.values()).filter((player) => player.connected);
}

function markRoomPlayerOrderDirty(room) {
  if (!room) {
    return;
  }

  room.playerOrderVersion = Number(room.playerOrderVersion ?? 0) + 1;
  room.playerOrderCache = {
    version: -1,
    players: []
  };
  room.interestIndex.tickNumber = -1;
}

function comparePlayersInSimulationOrder(left, right) {
  return left.joinedRoomAt - right.joinedRoomAt || left.id.localeCompare(right.id);
}

function getPlayersInSimulationOrder(room) {
  if (room.playerOrderCache?.version === room.playerOrderVersion) {
    return room.playerOrderCache.players;
  }

  const playersInOrder = Array.from(room.players.values()).sort(comparePlayersInSimulationOrder);
  room.playerOrderCache = {
    version: room.playerOrderVersion,
    players: playersInOrder
  };
  return playersInOrder;
}

function isValidLobbyOptionId(value, options) {
  return options.some((option) => option.id === value);
}

function getLobbyMap(mapId) {
  return GAME_CONFIG.lobby.maps.find((map) => map.id === mapId) ?? GAME_CONFIG.lobby.maps[0];
}

function getRecoverableDisconnectedPlayers(room, now) {
  return Array.from(room.players.values()).filter(
    (player) => !player.connected && player.reconnectDeadlineAt && player.reconnectDeadlineAt > now
  );
}

function isHumanPlayer(player) {
  return !player.isBot;
}

function isActiveParticipant(player) {
  return !player.isSpectator;
}

function getBalancedTeamId(room, excludePlayerId = null) {
  const counts = new Map(GAME_CONFIG.lobby.teams.map((team) => [team.id, 0]));

  for (const player of room?.players.values() ?? []) {
    if (player.id === excludePlayerId || player.isSpectator) {
      continue;
    }

    if (!counts.has(player.teamId)) {
      continue;
    }

    counts.set(player.teamId, counts.get(player.teamId) + 1);
  }

  return Array.from(counts.entries()).sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))[0][0];
}

function ensurePlayerLobbySelections(room, player) {
  if (!player) {
    return;
  }

  if (!isValidLobbyOptionId(player.teamId, GAME_CONFIG.lobby.teams)) {
    player.teamId = getBalancedTeamId(room, player.id);
  }

  if (!isValidLobbyOptionId(player.classId, GAME_CONFIG.lobby.classes)) {
    player.classId = GAME_CONFIG.lobby.classes[0].id;
  }

  if (player.homeSpawn?.teamId !== player.teamId) {
    player.homeSpawn = null;
  }

  applyPlayerTeamIdentity(player);
}

function getConnectedMatchPlayers(room) {
  return getConnectedPlayers(room).filter(isActiveParticipant);
}

function getRecoverableDisconnectedMatchPlayers(room, now) {
  return getRecoverableDisconnectedPlayers(room, now).filter(isActiveParticipant);
}

function getRestorableMatchPlayerCount(room, now) {
  return getConnectedMatchPlayers(room).length + getRecoverableDisconnectedMatchPlayers(room, now).length;
}

function getAliveActiveParticipants(room) {
  return getPlayersInSimulationOrder(room).filter(
    (player) => isActiveParticipant(player) && player.connected && player.alive
  );
}

function getBotPlayers(room) {
  return Array.from(room.players.values()).filter((player) => player.isBot);
}

function getConnectedHumanPlayers(room) {
  return getConnectedPlayers(room).filter(isHumanPlayer);
}

function getConnectedHumanMatchPlayers(room) {
  return getConnectedMatchPlayers(room).filter(isHumanPlayer);
}

function isRoomBotMatch(room) {
  return getBotPlayers(room).length > 0;
}

function isSoloBotDuelRoom(room) {
  return getConnectedHumanMatchPlayers(room).length === 1 && getBotPlayers(room).length === 1;
}

function isRoomContinuousMode(room) {
  return GAME_CONFIG.match.continuousMode || isSoloBotDuelRoom(room);
}

function isRoomSurvivalMode(room) {
  return GAME_CONFIG.match.survivalMode && !isRoomBotMatch(room);
}

function shouldAutoRestartRound(room) {
  return GAME_CONFIG.match.autoRestartRound && !isRoomContinuousMode(room);
}

function applyRoomSpawnProtection(room, player, now = Date.now()) {
  if (!player) {
    return;
  }

  if (isSoloBotDuelRoom(room)) {
    player.spawnProtectedUntil = now;
    return;
  }

  grantSpawnProtection(player, now);
}

function getRecoverableDisconnectedHumanPlayers(room, now) {
  return getRecoverableDisconnectedPlayers(room, now).filter(isHumanPlayer);
}

function getRecoverableDisconnectedHumanMatchPlayers(room, now) {
  return getRecoverableDisconnectedMatchPlayers(room, now).filter(isHumanPlayer);
}

function getRestorablePlayerCount(room, now) {
  return getRestorableMatchPlayerCount(room, now);
}

function getRestorableHumanPlayerCount(room, now) {
  return getConnectedHumanPlayers(room).length + getRecoverableDisconnectedHumanPlayers(room, now).length;
}

function getRestorableHumanMatchPlayerCount(room, now) {
  return getConnectedHumanMatchPlayers(room).length + getRecoverableDisconnectedHumanMatchPlayers(room, now).length;
}

function getConnectedSpectators(room) {
  return getConnectedPlayers(room).filter((player) => isHumanPlayer(player) && player.isSpectator);
}

function getLatestReconnectDeadline(room, now) {
  const deadlines = getRecoverableDisconnectedHumanMatchPlayers(room, now)
    .map((player) => player.reconnectDeadlineAt)
    .filter(Boolean);

  return deadlines.length > 0 ? Math.max(...deadlines) : null;
}

function syncRoomOwner(room) {
  const currentOwner = room.lobby?.ownerPlayerId ? room.players.get(room.lobby.ownerPlayerId) : null;
  if (currentOwner && isHumanPlayer(currentOwner)) {
    return currentOwner;
  }

  const nextOwner =
    Array.from(room.players.values())
      .filter(isHumanPlayer)
      .sort((left, right) => left.joinedRoomAt - right.joinedRoomAt || left.name.localeCompare(right.name))[0] ??
    null;

  room.lobby.ownerPlayerId = nextOwner?.id ?? null;
  return nextOwner;
}

function getLobbySnapshot(room) {
  const owner = syncRoomOwner(room);
  const lobbyMap = getLobbyMap(room.lobby?.mapId);
  const connectedHumanPlayers = getConnectedHumanMatchPlayers(room);

  return {
    roomCode: room.id,
    ownerPlayerId: owner?.id ?? null,
    ownerName: owner?.name ?? null,
    mapId: lobbyMap.id,
    mapName: lobbyMap.name,
    rematchVotes: isResultsPhase(room.match.phase) ? connectedHumanPlayers.filter((player) => player.ready).length : 0,
    activePlayers: connectedHumanPlayers.length,
    spectators: getConnectedSpectators(room).length
  };
}

function getRoomSummary(room, now = Date.now()) {
  const lobby = getLobbySnapshot(room);

  return {
    roomCode: room.id,
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt ?? room.createdAt,
    lastAllocatedAt: room.lastAllocatedAt ?? null,
    allocationSource: room.allocationSource ?? null,
    phase: room.match.phase,
    roundNumber: room.roundNumber,
    ownerName: lobby.ownerName,
    mapId: lobby.mapId,
    mapName: lobby.mapName,
    activePlayers: lobby.activePlayers,
    spectators: lobby.spectators,
    maxPlayers: GAME_CONFIG.session.maxHumanPlayersPerRoom,
    maxSpectators: GAME_CONFIG.session.maxSpectatorsPerRoom,
    rematchVotes: lobby.rematchVotes,
    openPlayerSlots: Math.max(
      0,
      GAME_CONFIG.session.maxHumanPlayersPerRoom - getRestorableHumanMatchPlayerCount(room, now)
    ),
    canJoinAsPlayer: hasOpenHumanPlayerSlot(room, now),
    canJoinAsSpectator: canJoinSpectatorRoom(room)
  };
}

function getInstanceInfo() {
  return {
    bootId,
    instanceId,
    group: instanceGroup,
    region: deployRegion
  };
}

function getCapacitySummary(now = Date.now()) {
  const roomCount = rooms.size;
  const connectedClientCount = connectedSocketCount;
  let connectedHumanPlayerCount = 0;
  let connectedPlayerCount = 0;
  let totalOpenPlayerSlots = 0;
  let joinableRoomCount = 0;

  for (const room of rooms.values()) {
    connectedHumanPlayerCount += getConnectedHumanPlayers(room).length;
    connectedPlayerCount += getConnectedPlayers(room).length;
    const openPlayerSlots = Math.max(
      0,
      GAME_CONFIG.session.maxHumanPlayersPerRoom - getRestorableHumanMatchPlayerCount(room, now)
    );
    totalOpenPlayerSlots += openPlayerSlots;

    if (
      (room.match.phase === MATCH_PHASES.WAITING || isResultsPhase(room.match.phase)) &&
      openPlayerSlots > 0
    ) {
      joinableRoomCount += 1;
    }
  }

  return {
    maxRooms: MAX_ROOMS_PER_INSTANCE,
    roomCount,
    remainingRoomCapacity: Math.max(0, MAX_ROOMS_PER_INSTANCE - roomCount),
    maxClients: MAX_CLIENTS_PER_INSTANCE,
    connectedClientCount,
    remainingClientCapacity: Math.max(0, MAX_CLIENTS_PER_INSTANCE - connectedClientCount),
    connectedPlayerCount,
    connectedHumanPlayerCount,
    totalOpenPlayerSlots,
    joinableRoomCount,
    isAtRoomCapacity: roomCount >= MAX_ROOMS_PER_INSTANCE,
    isAtClientCapacity: connectedClientCount >= MAX_CLIENTS_PER_INSTANCE,
    canAcceptConnections: !isShuttingDown && connectedClientCount < MAX_CLIENTS_PER_INSTANCE,
    canAcceptAllocations:
      !isShuttingDown &&
      !operationsState.maintenanceMode &&
      !operationsState.draining &&
      roomCount < MAX_ROOMS_PER_INSTANCE &&
      connectedClientCount < MAX_CLIENTS_PER_INSTANCE
  };
}

function getReadinessState(now = Date.now()) {
  const reasons = [];
  const capacity = getCapacitySummary(now);

  if (!profilesLoaded) {
    reasons.push("profiles_loading");
  }
  if (!backendLoaded) {
    reasons.push("backend_loading");
  }
  if (isShuttingDown) {
    reasons.push("shutting_down");
  }
  if (operationsState.maintenanceMode) {
    reasons.push("maintenance_mode");
  }
  if (operationsState.draining) {
    reasons.push("draining");
  }
  if (connectedSocketCount >= MAX_CLIENTS_PER_INSTANCE) {
    reasons.push("client_capacity_reached");
  }

  return {
    ready: reasons.length === 0,
    reasons,
    capacity
  };
}

function getOperationsState() {
  return {
    maintenanceMode: operationsState.maintenanceMode,
    draining: operationsState.draining,
    maintenanceReason: operationsState.maintenanceReason,
    updatedAt: operationsState.updatedAt,
    lastAllocationAt: operationsState.lastAllocationAt,
    lastAllocatedRoomId: operationsState.lastAllocatedRoomId,
    shutdownRequestedAt: operationsState.shutdownRequestedAt,
    shutdownReason: operationsState.shutdownReason,
    allocatorEnabled: Boolean(allocatorApiKey),
    limits: {
      maxRoomsPerInstance: MAX_ROOMS_PER_INSTANCE,
      maxClientsPerInstance: MAX_CLIENTS_PER_INSTANCE,
      emptyRoomReapGraceMs: EMPTY_ROOM_REAP_GRACE_MS,
      idleRoomTtlMs: IDLE_ROOM_TTL_MS
    },
    counters: {
      ...operationsCounters
    }
  };
}

function updateOperationalMode(options = {}) {
  const nextMaintenanceMode =
    options.maintenanceMode === undefined ? operationsState.maintenanceMode : Boolean(options.maintenanceMode);
  const nextDraining = options.draining === undefined ? operationsState.draining : Boolean(options.draining);
  const requestedReason =
    options.reason === undefined
      ? operationsState.maintenanceReason
      : sanitizeLooseText(options.reason ?? "", "", 160) || null;

  const nextReason = nextMaintenanceMode || nextDraining ? requestedReason : null;
  const changed =
    nextMaintenanceMode !== operationsState.maintenanceMode ||
    nextDraining !== operationsState.draining ||
    nextReason !== operationsState.maintenanceReason;

  operationsState.maintenanceMode = nextMaintenanceMode;
  operationsState.draining = nextDraining;
  operationsState.maintenanceReason = nextReason;
  operationsState.updatedAt = new Date().toISOString();

  return {
    changed,
    state: getOperationsState()
  };
}

function getRoomCreationAdmissionVerdict(now = Date.now()) {
  const capacity = getCapacitySummary(now);

  if (isShuttingDown) {
    return {
      ok: false,
      code: "server_shutting_down",
      message: "Server is shutting down. Please try again shortly.",
      statusCode: 503,
      closeCode: 4017
    };
  }

  if (operationsState.maintenanceMode) {
    return {
      ok: false,
      code: "maintenance_mode",
      message: "Server is in maintenance mode. New matches are temporarily disabled.",
      statusCode: 503,
      closeCode: 4014
    };
  }

  if (operationsState.draining) {
    return {
      ok: false,
      code: "server_draining",
      message: "Server is draining matches for an update. Please try again shortly.",
      statusCode: 503,
      closeCode: 4015
    };
  }

  if (capacity.isAtRoomCapacity) {
    return {
      ok: false,
      code: "room_capacity_reached",
      message: "Server has reached room capacity. Please try another region or instance.",
      statusCode: 503,
      closeCode: 4016
    };
  }

  if (capacity.isAtClientCapacity) {
    return {
      ok: false,
      code: "client_capacity_reached",
      message: "Server is currently at connection capacity. Please try again shortly.",
      statusCode: 503,
      closeCode: 4016
    };
  }

  return {
    ok: true,
    capacity
  };
}

function getFreshJoinAdmissionVerdict(now = Date.now()) {
  if (operationsState.maintenanceMode) {
    return {
      ok: false,
      code: "maintenance_mode",
      message: "Server is in maintenance mode. New joins are temporarily disabled.",
      closeCode: 4014
    };
  }

  if (operationsState.draining) {
    return {
      ok: false,
      code: "server_draining",
      message: "Server is draining matches for an update. New joins are temporarily disabled.",
      closeCode: 4015
    };
  }

  if (connectedSocketCount > MAX_CLIENTS_PER_INSTANCE) {
    return {
      ok: false,
      code: "server_full",
      message: "Server is currently at connection capacity. Please try again shortly.",
      closeCode: 4016
    };
  }

  return {
    ok: true,
    evaluatedAt: now
  };
}

function markRoomAllocated(room, now = Date.now(), source = "allocator") {
  if (!room) {
    return;
  }

  room.lastAllocatedAt = now;
  room.allocationSource = sanitizeLooseText(source, "allocator", 48);
  markRoomActive(room, now);
  operationsCounters.allocationsServed += 1;
  operationsState.lastAllocationAt = new Date(now).toISOString();
  operationsState.lastAllocatedRoomId = room.id;
}

function createAllocatedRoomId(prefix = "match") {
  const safePrefix = sanitizeRoomId(prefix).replace(/^-+|-+$/g, "") || "match";

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = sanitizeRoomId(`${safePrefix}-${crypto.randomBytes(3).toString("hex")}`);
    if (!rooms.has(candidate)) {
      return candidate;
    }
  }

  return sanitizeRoomId(`${safePrefix}-${Date.now().toString(36)}`);
}

function listAllocatableRooms(now = Date.now()) {
  return Array.from(rooms.values())
    .filter(
      (room) =>
        (room.match.phase === MATCH_PHASES.WAITING || isResultsPhase(room.match.phase)) &&
        hasOpenHumanPlayerSlot(room, now)
    )
    .sort(
      (left, right) =>
        getConnectedHumanPlayers(right).length - getConnectedHumanPlayers(left).length ||
        left.createdAt - right.createdAt
    );
}

function allocateRoomForRequest(body = {}, now = Date.now()) {
  const preferredRegion = sanitizeLooseText(body.region ?? body.preferredRegion ?? "", "", 48) || null;
  if (preferredRegion && preferredRegion !== deployRegion) {
    return {
      ok: false,
      statusCode: 409,
      code: "region_mismatch",
      message: `Instance region ${deployRegion} does not match requested region ${preferredRegion}`
    };
  }

  const strategy = sanitizeLooseText(body.strategy ?? body.mode ?? "fill", "fill", 16);
  const explicitRoomId =
    typeof body.roomId === "string" && body.roomId.trim() ? sanitizeRoomId(body.roomId) : null;
  const source = explicitRoomId ? "allocator_explicit" : strategy === "new" ? "allocator_new" : "allocator_fill";

  if (explicitRoomId) {
    const roomAlreadyExists = rooms.has(explicitRoomId);
    if (!roomAlreadyExists) {
      const verdict = getRoomCreationAdmissionVerdict(now);
      if (!verdict.ok) {
        return {
          ...verdict,
          statusCode: verdict.statusCode ?? 503
        };
      }
    }

    const room = getRoom(explicitRoomId);
    markRoomAllocated(room, now, source);
    return {
      ok: true,
      room,
      created: !roomAlreadyExists,
      reused: roomAlreadyExists,
      strategy: "explicit"
    };
  }

  if (strategy !== "new") {
    const existingRoom = listAllocatableRooms(now)[0] ?? null;
    if (existingRoom) {
      markRoomAllocated(existingRoom, now, source);
      return {
        ok: true,
        room: existingRoom,
        created: false,
        reused: true,
        strategy
      };
    }
  }

  const verdict = getRoomCreationAdmissionVerdict(now);
  if (!verdict.ok) {
    return {
      ...verdict,
      statusCode: verdict.statusCode ?? 503
    };
  }

  const room = getRoom(createAllocatedRoomId(body.prefix ?? "match"));
  markRoomAllocated(room, now, source);
  return {
    ok: true,
    room,
    created: true,
    reused: false,
    strategy: strategy === "new" ? "new" : "fill"
  };
}

function buildAllocationResponse(request, allocation, now = Date.now()) {
  const advertisedOrigin = getAdvertisedOrigin(request);
  return {
    roomId: allocation.room.id,
    created: Boolean(allocation.created),
    reused: Boolean(allocation.reused),
    strategy: allocation.strategy,
    allocatedAt: allocation.room.lastAllocatedAt ? new Date(allocation.room.lastAllocatedAt).toISOString() : null,
    instance: getInstanceInfo(),
    endpoints: {
      httpOrigin: advertisedOrigin,
      webSocketOrigin: advertisedOrigin.replace(/^http/, "ws")
    },
    room: getRoomSummary(allocation.room, now),
    capacity: getCapacitySummary(now)
  };
}

function reapIdleRooms(now = Date.now()) {
  for (const [roomId, room] of rooms.entries()) {
    const idleForMs = Math.max(0, now - (Number(room.lastActivityAt) || room.createdAt || now));
    const recoverablePlayers = getRecoverableDisconnectedPlayers(room, now).length;
    const recoverableHumans = getRecoverableDisconnectedHumanPlayers(room, now).length;
    const connectedHumans = getConnectedHumanPlayers(room).length;

    if (room.clients.size === 0 && recoverablePlayers === 0 && idleForMs >= EMPTY_ROOM_REAP_GRACE_MS) {
      deleteRoom(roomId);
      continue;
    }

    if (
      (room.match.phase === MATCH_PHASES.WAITING || isResultsPhase(room.match.phase)) &&
      connectedHumans === 0 &&
      recoverableHumans === 0 &&
      idleForMs >= IDLE_ROOM_TTL_MS
    ) {
      deleteRoom(roomId);
    }
  }
}

function isWarmupPhase(phase) {
  return phase === MATCH_PHASES.WARMUP;
}

function isCombatPhase(phase) {
  return phase === MATCH_PHASES.LIVE_ROUND || phase === MATCH_PHASES.OVERTIME;
}

function isMovementPhase(phase) {
  return phase === MATCH_PHASES.WAITING || isWarmupPhase(phase) || isCombatPhase(phase);
}

function canShootPhase(phase) {
  return isMovementPhase(phase);
}

function isResultsPhase(phase) {
  return phase === MATCH_PHASES.RESULTS;
}

function getCurrentWinner(room) {
  if (!room.match.winnerId) {
    return null;
  }

  return {
    id: room.match.winnerId,
    name: room.match.winnerName
  };
}

function getLeadingActivePlayer(room) {
  return (
    Array.from(room.players.values())
      .filter((player) => player.connected && isActiveParticipant(player))
      .sort((left, right) => right.score - left.score || left.deaths - right.deaths)[0] ?? null
  );
}

function hasHotObjective(room) {
  return getRoomObjectiveZones(room).some((zone) => isObjectiveZoneHot(zone));
}

function shouldEnterOvertime(room) {
  const rankedPlayers = Array.from(room.players.values())
    .filter((player) => player.connected && isActiveParticipant(player))
    .sort((left, right) => right.score - left.score || left.deaths - right.deaths);
  const leader = rankedPlayers[0] ?? null;
  const runnerUp = rankedPlayers[1] ?? null;
  const tiedLead = Boolean(leader && runnerUp && leader.score === runnerUp.score);
  return tiedLead || hasHotObjective(room);
}

function getNextMapId(currentMapId) {
  const currentIndex = GAME_CONFIG.lobby.maps.findIndex((map) => map.id === currentMapId);
  if (currentIndex < 0) {
    return GAME_CONFIG.lobby.maps[0].id;
  }

  return GAME_CONFIG.lobby.maps[(currentIndex + 1) % GAME_CONFIG.lobby.maps.length].id;
}

function getLeaderboard(room) {
  return Array.from(room.players.values())
    .sort((left, right) => {
      if (left.isSpectator !== right.isSpectator) {
        return Number(left.isSpectator) - Number(right.isSpectator);
      }

      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.deaths - right.deaths;
    })
    .map((player) => ({
      id: player.id,
      name: player.name,
      ready: player.ready,
      credits: player.credits,
      score: player.score,
      assists: player.assists,
      deaths: player.deaths,
      connected: player.connected,
      isBot: Boolean(player.isBot),
      isSpectator: Boolean(player.isSpectator),
      teamId: player.teamId,
      classId: player.classId,
      queuedForSlot: Boolean(player.queuedForSlot),
      slotReserved: Boolean(player.slotReserved),
      afk: Boolean(player.afk)
    }));
}

function getPublicProfileStats(player) {
  return {
    matchesPlayed: player.profileStats.matchesPlayed,
    wins: player.profileStats.wins,
    kills: player.profileStats.kills,
    deaths: player.profileStats.deaths,
    accuracy: player.profileStats.shotsFired
      ? Number(((player.profileStats.shotsHit / player.profileStats.shotsFired) * 100).toFixed(1))
      : 0
  };
}

function markPlayerActive(player, now) {
  player.lastActiveAt = now;
  player.afk = false;
  player.afkSinceAt = null;
}

function hasOpenHumanPlayerSlot(room, now) {
  return getRestorableHumanMatchPlayerCount(room, now) < GAME_CONFIG.session.maxHumanPlayersPerRoom;
}

function canJoinSpectatorRoom(room) {
  return getConnectedSpectators(room).length < GAME_CONFIG.session.maxSpectatorsPerRoom;
}

function promoteSpectatorToActivePlayer(room, player, now) {
  player.isSpectator = false;
  player.queuedForSlot = false;
  player.slotReserved = false;
  player.ready = false;
  player.connected = true;
  ensurePlayerLobbySelections(room, player);
  markPlayerActive(player, now);
  resetPlayerForRound(room, player);
  queueSpawnStateEvent(room, player, now);
  queueInventoryStateEvent(room, player, now);
  autoReadyPlayerForImmediateMatch(room, player, now);
}

function promoteQueuedSpectators(room, now) {
  if (room.match.phase !== MATCH_PHASES.WAITING && !isWarmupPhase(room.match.phase) && !isResultsPhase(room.match.phase)) {
    return;
  }

  const queuedSpectators = Array.from(room.players.values())
    .filter((player) => player.connected && player.isSpectator && player.queuedForSlot && isHumanPlayer(player))
    .sort((left, right) => left.lastActiveAt - right.lastActiveAt);

  while (queuedSpectators.length > 0 && hasOpenHumanPlayerSlot(room, now)) {
    const spectator = queuedSpectators.shift();
    promoteSpectatorToActivePlayer(room, spectator, now);
  }
}

function applyAfkState(room, now) {
  for (const player of room.players.values()) {
    if (player.isBot || player.isSpectator || !player.connected) {
      continue;
    }

    const inactiveMs = now - player.lastActiveAt;
    if (inactiveMs < GAME_CONFIG.session.afkTimeoutMs) {
      continue;
    }

    if (!player.afk) {
      player.afk = true;
      player.afkSinceAt = now;
    }

    player.pendingInputs.length = 0;
    player.input.forward = false;
    player.input.back = false;
    player.input.left = false;
    player.input.right = false;
    player.input.shoot = false;

    if (room.match.phase === MATCH_PHASES.WAITING || isWarmupPhase(room.match.phase)) {
      player.ready = false;
    }
  }
}

function getRequestProtocol(request) {
  const forwardedProto = request.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.length > 0) {
    return forwardedProto.split(",")[0].trim();
  }

  return request.socket.encrypted ? "https" : "http";
}

function getRequestHost(request) {
  const forwardedHost = request.headers["x-forwarded-host"];
  if (typeof forwardedHost === "string" && forwardedHost.length > 0) {
    return forwardedHost.split(",")[0].trim();
  }

  return request.headers.host ?? `localhost:${port}`;
}

function getRequestOrigin(request) {
  const protocol = getRequestProtocol(request);
  const hostHeader = getRequestHost(request);
  return `${protocol}://${hostHeader}`;
}

function getAdvertisedOrigin(request) {
  return publicOrigin ?? getRequestOrigin(request);
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return environment !== "production";
  }

  if (allowedOrigins.size === 0) {
    return environment !== "production";
  }

  return allowedOrigins.has(origin);
}

function isAllowedOriginForRequest(request) {
  const origin = request.headers.origin;

  if (!origin) {
    return true;
  }

  // In hosted environments like Render, the browser origin normally matches the
  // forwarded request host, so we can safely allow true same-origin upgrades
  // without requiring a separate manual env var for the default public URL.
  if (origin === getRequestOrigin(request)) {
    return true;
  }

  return isAllowedOrigin(origin) || environment === "production";
}

function resetOutgoingBudget(socket, now) {
  if (!socket.data?.outgoingBudget) {
    return;
  }

  if (now - socket.data.outgoingBudget.windowStartedAt >= 1000) {
    socket.data.outgoingBudget.windowStartedAt = now;
    socket.data.outgoingBudget.sentBytes = 0;
  }
}

function canSendBytes(socket, byteLength, options = {}) {
  const { critical = false, now = Date.now() } = options;
  const budget = socket.data?.outgoingBudget;

  if (!budget) {
    return true;
  }

  resetOutgoingBudget(socket, now);

  if (!critical && budget.sentBytes + byteLength > GAME_CONFIG.network.maxOutgoingBytesPerSecond) {
    return false;
  }

  budget.sentBytes += byteLength;
  return true;
}

function sendJson(socket, payload, options = {}) {
  if (socket.readyState !== socket.OPEN) {
    return false;
  }

  const serialized = serializePacket(payload);
  const byteLength = Buffer.byteLength(serialized, "utf8");

  if (!canSendBytes(socket, byteLength, options)) {
    return false;
  }

  socket.send(serialized);
  return true;
}

function rejectIncompatibleSocket(socket, code, message, closeCode) {
  sendJson(socket, {
    type: MESSAGE_TYPES.ERROR,
    code,
    message
  }, { critical: true });

  try {
    socket.close(closeCode, message);
  } catch (error) {
    console.error("Failed to close incompatible socket", error);
  }
}

function enforceSocketMessageRate(socket, payloadType, now) {
  if (!isAntiCheatEnabled()) {
    return true;
  }

  const messageBucket = socket.data?.messageBucket;
  const controlBucket = socket.data?.controlBucket;

  if (messageBucket && !consumeRateBucket(messageBucket, now, GAME_CONFIG.antiCheat.maxMessagesPerSecond)) {
    rejectIncompatibleSocket(socket, "message_rate_limit", "Too many packets sent to the server", 4012);
    return false;
  }

  if (
    controlBucket &&
    payloadType !== MESSAGE_TYPES.INPUT &&
    !consumeRateBucket(controlBucket, now, GAME_CONFIG.antiCheat.maxControlMessagesPerSecond)
  ) {
    rejectIncompatibleSocket(socket, "control_spam", "Too many control messages sent to the server", 4012);
    return false;
  }

  return true;
}

function recordInvalidPacket(socket, error, now) {
  if (!isAntiCheatEnabled()) {
    return;
  }

  const invalidPacketBucket = socket.data?.invalidPacketBucket;

  if (!invalidPacketBucket) {
    return;
  }

  if (!consumeRateBucket(invalidPacketBucket, now, GAME_CONFIG.antiCheat.maxViolationPoints)) {
    rejectIncompatibleSocket(
      socket,
      error.code ?? "invalid_packet",
      error.message ?? "Too many invalid packets",
      4007
    );
  }
}

function markSocketForFullSync(socket) {
  const replicationState = socket.data?.replication;
  if (!replicationState) {
    return;
  }

  replicationState.knownEntities.clear();
  replicationState.forceFullSync = true;
  replicationState.lastFullSyncAt = 0;
  replicationState.lastSnapshotSeq = 0;
}

function rememberReliableAck(socket, messageId, payload) {
  const tracked = socket.data?.processedReliableMessages;
  if (!tracked || !messageId) {
    return;
  }

  tracked.set(messageId, payload);

  while (tracked.size > GAME_CONFIG.network.maxReliableHistory) {
    const oldestKey = tracked.keys().next().value;
    tracked.delete(oldestKey);
  }
}

function acknowledgeReliableMessage(socket, payload, extras = {}) {
  const messageId = sanitizeMessageId(payload.messageId);
  if (!messageId) {
    return;
  }

  const ackPayload = {
    type: MESSAGE_TYPES.ACK,
    messageId,
    ackedType: payload.type,
    serverTime: Date.now(),
    ...extras
  };

  rememberReliableAck(socket, messageId, ackPayload);
  sendJson(socket, ackPayload, { critical: true });
}

function resendAckForDuplicate(socket, payload) {
  const messageId = sanitizeMessageId(payload.messageId);
  if (!messageId) {
    return false;
  }

  const previousAck = socket.data?.processedReliableMessages?.get(messageId);
  if (!previousAck) {
    return false;
  }

  sendJson(socket, previousAck, { critical: true });
  return true;
}

function sendStatePayload(socket, payload) {
  const serialized = serializePacket(payload);
  const byteLength = Buffer.byteLength(serialized, "utf8");

  if (byteLength <= GAME_CONFIG.network.maxStatePayloadBytes) {
    return sendJson(socket, payload);
  }

  const chunks = [];
  for (let offset = 0; offset < serialized.length; offset += GAME_CONFIG.network.stateChunkChars) {
    chunks.push(serialized.slice(offset, offset + GAME_CONFIG.network.stateChunkChars));
  }

  let sentAllChunks = true;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunkSent = sendJson(socket, {
      type: MESSAGE_TYPES.STATE_CHUNK,
      roomId: payload.roomId,
      snapshotSeq: payload.snapshotSeq,
      chunkIndex: index,
      chunkCount: chunks.length,
      chunk: chunks[index]
    });

    if (!chunkSent) {
      sentAllChunks = false;
      break;
    }
  }

  return sentAllChunks;
}

function writeJson(response, statusCode, payload) {
  applySecurityHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function writeText(response, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  applySecurityHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(payload);
}

function applySecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );

  if (publicOrigin?.startsWith("https://")) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function writeApiError(response, statusCode, code, message, extras = {}) {
  writeJson(response, statusCode, {
    error: code,
    message,
    ...extras
  });
}

function writeNoContent(response) {
  applySecurityHeaders(response);
  response.writeHead(204, {
    "Cache-Control": "no-store"
  });
  response.end();
}

function escapeMetricLabelValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function formatMetrics() {
  const now = Date.now();
  const readiness = getReadinessState(now);
  const capacity = readiness.capacity;
  const operations = getOperationsState();
  const lines = [
    "# HELP multitank_instance_info Static build and placement information for this game server instance",
    "# TYPE multitank_instance_info gauge",
    `multitank_instance_info{instance_id="${escapeMetricLabelValue(instanceId)}",boot_id="${escapeMetricLabelValue(bootId)}",region="${escapeMetricLabelValue(deployRegion)}",group="${escapeMetricLabelValue(instanceGroup)}",version="${escapeMetricLabelValue(gameVersion)}"} 1`,
    "# HELP multitank_uptime_seconds Process uptime in seconds",
    "# TYPE multitank_uptime_seconds gauge",
    `multitank_uptime_seconds ${Number(((now - startedAt) / 1000).toFixed(3))}`,
    "# HELP multitank_ready Whether the instance is ready for normal traffic",
    "# TYPE multitank_ready gauge",
    `multitank_ready ${readiness.ready ? 1 : 0}`,
    "# HELP multitank_maintenance_mode Whether maintenance mode is enabled",
    "# TYPE multitank_maintenance_mode gauge",
    `multitank_maintenance_mode ${operations.maintenanceMode ? 1 : 0}`,
    "# HELP multitank_draining Whether the instance is draining matches for an update",
    "# TYPE multitank_draining gauge",
    `multitank_draining ${operations.draining ? 1 : 0}`,
    "# HELP multitank_shutting_down Whether graceful shutdown has started",
    "# TYPE multitank_shutting_down gauge",
    `multitank_shutting_down ${isShuttingDown ? 1 : 0}`,
    "# HELP multitank_room_count Current room count on this instance",
    "# TYPE multitank_room_count gauge",
    `multitank_room_count ${capacity.roomCount}`,
    "# HELP multitank_connected_client_count Current open websocket connections",
    "# TYPE multitank_connected_client_count gauge",
    `multitank_connected_client_count ${capacity.connectedClientCount}`,
    "# HELP multitank_connected_human_player_count Connected human players across all rooms",
    "# TYPE multitank_connected_human_player_count gauge",
    `multitank_connected_human_player_count ${capacity.connectedHumanPlayerCount}`,
    "# HELP multitank_joinable_room_count Rooms that can still accept human players",
    "# TYPE multitank_joinable_room_count gauge",
    `multitank_joinable_room_count ${capacity.joinableRoomCount}`,
    "# HELP multitank_open_player_slots Total open human player slots across joinable rooms",
    "# TYPE multitank_open_player_slots gauge",
    `multitank_open_player_slots ${capacity.totalOpenPlayerSlots}`,
    "# HELP multitank_room_capacity_remaining Remaining room capacity on this instance",
    "# TYPE multitank_room_capacity_remaining gauge",
    `multitank_room_capacity_remaining ${capacity.remainingRoomCapacity}`,
    "# HELP multitank_client_capacity_remaining Remaining websocket client capacity on this instance",
    "# TYPE multitank_client_capacity_remaining gauge",
    `multitank_client_capacity_remaining ${capacity.remainingClientCapacity}`,
    "# HELP multitank_allocation_count Total allocator decisions served by this process",
    "# TYPE multitank_allocation_count counter",
    `multitank_allocation_count ${operations.counters.allocationsServed}`,
    "# HELP multitank_room_cleanup_count Total room cleanup deletions performed by this process",
    "# TYPE multitank_room_cleanup_count counter",
    `multitank_room_cleanup_count ${operations.counters.roomsCleanedUp}`,
    "# HELP multitank_security_event_count Recent in-memory security event count",
    "# TYPE multitank_security_event_count gauge",
    `multitank_security_event_count ${securityEvents.length}`
  ];

  return `${lines.join("\n")}\n`;
}

function serializeTransaction(transaction, options = {}) {
  const { includeSnapshots = false } = options;
  if (!transaction) {
    return null;
  }

  return {
    id: transaction.id,
    type: transaction.type,
    accountId: transaction.accountId,
    profileId: transaction.profileId,
    actorType: transaction.actorType,
    actorId: transaction.actorId,
    createdAt: transaction.createdAt,
    metadata: transaction.metadata,
    reversible: transaction.reversible,
    ...(includeSnapshots
      ? {
          before: transaction.before,
          after: transaction.after
        }
      : {})
  };
}

function restoreTransactionSnapshot(transaction, mode = "before") {
  const snapshot = mode === "after" ? transaction?.after : transaction?.before;
  if (!transaction || !snapshot) {
    return null;
  }

  const beforeRestore = buildPersistenceSnapshot({
    accountId: snapshot.accountId ?? transaction.accountId,
    profileId: snapshot.profileId ?? transaction.profileId
  });

  applyPersistenceSnapshot(snapshot);
  const afterRestore = buildPersistenceSnapshot({
    accountId: snapshot.accountId ?? transaction.accountId,
    profileId: snapshot.profileId ?? transaction.profileId
  });

  return recordBackendTransaction({
    type: mode === "after" ? "admin_restore" : "admin_rollback",
    accountId: snapshot.accountId ?? transaction.accountId,
    profileId: snapshot.profileId ?? transaction.profileId,
    actorType: "admin",
    metadata: {
      sourceTransactionId: transaction.id,
      mode
    },
    before: beforeRestore,
    after: afterRestore
  });
}

async function handleApiRequest(request, response, url) {
  if (request.method === "OPTIONS") {
    writeNoContent(response);
    return true;
  }

  const auth = getAuthenticatedRequestContext(request);
  const pathname = url.pathname;
  const isMutation = request.method === "POST" || request.method === "PATCH" || request.method === "PUT";
  const rateCategory = pathname.startsWith("/api/admin/")
    ? "admin"
    : pathname.startsWith("/api/allocator/")
      ? "allocator"
    : pathname.startsWith("/api/auth/")
      ? "auth"
      : isMutation
        ? "apiWrite"
        : "apiRead";

  if (!enforceHttpRateLimit(request, rateCategory, response)) {
    return true;
  }

  if (isMutation && !isJsonRequest(request)) {
    recordSecurityEvent("invalid_content_type", {
      request,
      accountId: auth.account?.accountId,
      severity: "info",
      message: "API request used an unsupported content type",
      metadata: {
        pathname
      }
    });
    writeApiError(response, 415, "unsupported_media_type", "API requests must use application/json");
    return true;
  }

  if (pathname === "/api/auth/register") {
    if (request.method !== "POST") {
      writeApiError(response, 405, "method_not_allowed", "Use POST for account registration");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Registration request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const requestId = requireMutationProtection(request, response, body, auth);
    if (!requestId) {
      return true;
    }

    const username = sanitizeAccountUsername(body.username);
    const email = body.email === undefined || body.email === null || body.email === ""
      ? null
      : sanitizeAccountEmail(body.email);
    const password = sanitizePassword(body.password);
    const displayName = sanitizePlayerName(body.displayName ?? body.username);

    if (!username || !password) {
      writeApiError(response, 400, "invalid_registration", "Username and password are required");
      return true;
    }

    if (body.email && !email) {
      writeApiError(response, 400, "invalid_registration", "Email address is not valid");
      return true;
    }

    if (findAccountByUsername(username) || (email && findAccountByEmail(email))) {
      recordSecurityEvent("registration_conflict", {
        request,
        severity: "info",
        message: "Account registration was rejected because the identity already exists",
        metadata: {
          username,
          email
        }
      });
      writeApiError(response, 409, "account_exists", "An account with that username or email already exists");
      return true;
    }

    const account = createAccountRecord({
      username,
      email,
      password,
      displayName
    });

    if (!account) {
      writeApiError(response, 400, "invalid_registration", "Registration payload was not valid");
      return true;
    }

    const before = buildPersistenceSnapshot({
      accountId: account.accountId,
      profileId: account.profileId
    });
    accounts.set(account.accountId, account);
    const profile = ensureBackendProfile(account.profileId, {
      accountId: account.accountId,
      displayName: account.displayName
    });
    const { token, session } = createAuthSession(account.accountId, { request });
    account.lastLoginAt = new Date().toISOString();
    grantEntitlement(profile, "weapon:shell-cannon");
    grantInventoryItem(profile, "shell-cannon", 1, "weapon", "account_register");
    scheduleProfileSave();
    scheduleBackendSave();

    const after = buildPersistenceSnapshot({
      accountId: account.accountId,
      profileId: account.profileId
    });
    recordBackendTransaction({
      type: "account_register",
      accountId: account.accountId,
      profileId: account.profileId,
      actorType: "account",
      actorId: account.accountId,
      metadata: {
        username: account.username,
        requestId
      },
      before,
      after
    });

    writeJson(response, 201, {
      account: getAccountSummary(account),
      profile: getProfileProgressionSummary(profile),
      token,
      session: {
        sessionId: session.sessionId,
        expiresAt: session.expiresAt
      },
      catalog: getSafePurchaseCatalog()
    });
    return true;
  }

  if (pathname === "/api/auth/login") {
    if (request.method !== "POST") {
      writeApiError(response, 405, "method_not_allowed", "Use POST for account login");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Login request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const requestId = requireMutationProtection(request, response, body, auth);
    if (!requestId) {
      return true;
    }

    const account = findAccountByLogin(body.login);
    const password = sanitizePassword(body.password);
    if (!account || !password || !verifyPasswordDigest(password, account.passwordSalt, account.passwordHash)) {
      recordSecurityEvent("login_failed", {
        request,
        severity: "warn",
        message: "Account login failed because the credentials were invalid",
        metadata: {
          login: sanitizeLooseText(body.login ?? "", "", 120)
        }
      });
      writeApiError(response, 401, "invalid_credentials", "Login failed");
      return true;
    }

    const before = buildPersistenceSnapshot({
      accountId: account.accountId,
      profileId: account.profileId
    });
    const { token, session } = createAuthSession(account.accountId, { request });
    account.lastLoginAt = new Date().toISOString();
    account.lastSeenAt = new Date().toISOString();
    const profile = ensureBackendProfile(account.profileId, {
      accountId: account.accountId,
      displayName: account.displayName
    });
    scheduleBackendSave();
    const after = buildPersistenceSnapshot({
      accountId: account.accountId,
      profileId: account.profileId
    });
    recordBackendTransaction({
      type: "account_login",
      accountId: account.accountId,
      profileId: account.profileId,
      actorType: "account",
      actorId: account.accountId,
      reversible: false,
      metadata: {
        requestId
      },
      before,
      after
    });

    writeJson(response, 200, {
      account: getAccountSummary(account),
      profile: getProfileProgressionSummary(profile),
      token,
      session: {
        sessionId: session.sessionId,
        expiresAt: session.expiresAt
      },
      catalog: getSafePurchaseCatalog()
    });
    return true;
  }

  if (pathname === "/api/auth/logout") {
    if (request.method !== "POST") {
      writeApiError(response, 405, "method_not_allowed", "Use POST for logout");
      return true;
    }

    if (!auth.session) {
      recordSecurityEvent("logout_without_session", {
        request,
        severity: "info",
        message: "Logout was attempted without an authenticated session"
      });
      writeApiError(response, 401, "unauthorized", "Authentication required");
      return true;
    }

    const requestId = requireMutationProtection(request, response, {}, auth);
    if (!requestId) {
      return true;
    }

    recordBackendTransaction({
      type: "account_logout",
      accountId: auth.account?.accountId,
      profileId: auth.profile?.profileId,
      actorType: "account",
      actorId: auth.account?.accountId,
      reversible: false,
      metadata: {
        requestId
      }
    });

    destroySession(auth.session.sessionId);
    writeNoContent(response);
    return true;
  }

  if (pathname === "/api/auth/me") {
    if (request.method !== "GET") {
      writeApiError(response, 405, "method_not_allowed", "Use GET to read session state");
      return true;
    }

    if (!auth.account || !auth.profile) {
      writeApiError(response, 401, "unauthorized", "Authentication required");
      return true;
    }

    writeJson(response, 200, {
      account: getAccountSummary(auth.account),
      profile: getProfileProgressionSummary(auth.profile),
      catalog: getSafePurchaseCatalog()
    });
    return true;
  }

  if (pathname === "/api/profile") {
    if (!auth.account || !auth.profile) {
      writeApiError(response, 401, "unauthorized", "Authentication required");
      return true;
    }

    if (request.method === "GET") {
      writeJson(response, 200, {
        account: getAccountSummary(auth.account),
        profile: getProfileProgressionSummary(auth.profile)
      });
      return true;
    }

    if (request.method !== "PATCH") {
      writeApiError(response, 405, "method_not_allowed", "Use GET or PATCH for profile");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Profile update request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const requestId = requireMutationProtection(request, response, body, auth);
    if (!requestId) {
      return true;
    }

    const before = buildPersistenceSnapshot({
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId
    });

    if (body.displayName) {
      auth.account.displayName = sanitizePlayerName(body.displayName);
      auth.profile.displayName = auth.account.displayName;
      const legacyProfile = profiles.get(auth.profile.profileId);
      if (legacyProfile) {
        legacyProfile.lastKnownName = auth.account.displayName;
      }
    }

    if (body.loadouts || body.selectedLoadoutId) {
      auth.profile.inventory = sanitizePersistentInventory({
        ...auth.profile.inventory,
        loadouts: body.loadouts ?? auth.profile.inventory.loadouts,
        selectedLoadoutId: body.selectedLoadoutId ?? auth.profile.inventory.selectedLoadoutId
      });
    }

    auth.profile.updatedAt = new Date().toISOString();
    scheduleProfileSave();
    scheduleBackendSave();

    const after = buildPersistenceSnapshot({
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId
    });
    recordBackendTransaction({
      type: "profile_update",
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId,
      actorType: "account",
      actorId: auth.account.accountId,
      metadata: {
        changedDisplayName: Boolean(body.displayName),
        changedLoadouts: Boolean(body.loadouts || body.selectedLoadoutId),
        requestId
      },
      before,
      after
    });

    writeJson(response, 200, {
      account: getAccountSummary(auth.account),
      profile: getProfileProgressionSummary(auth.profile)
    });
    return true;
  }

  if (pathname === "/api/inventory") {
    if (!auth.account || !auth.profile) {
      writeApiError(response, 401, "unauthorized", "Authentication required");
      return true;
    }

    if (request.method === "GET") {
      writeJson(response, 200, {
        wallet: sanitizeWallet(auth.account.wallet),
        inventory: sanitizePersistentInventory(auth.profile.inventory),
        entitlements: sanitizeEntitlements(auth.profile.entitlements),
        catalog: getSafePurchaseCatalog()
      });
      return true;
    }

    if (request.method !== "PUT" || pathname !== "/api/inventory") {
      writeApiError(response, 405, "method_not_allowed", "Use GET or PUT for inventory");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Inventory update request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const requestId = requireMutationProtection(request, response, body, auth);
    if (!requestId) {
      return true;
    }

    const before = buildPersistenceSnapshot({
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId
    });
    auth.profile.inventory = sanitizePersistentInventory({
      ...auth.profile.inventory,
      loadouts: body.loadouts ?? auth.profile.inventory.loadouts,
      selectedLoadoutId: body.selectedLoadoutId ?? auth.profile.inventory.selectedLoadoutId
    });
    auth.profile.updatedAt = new Date().toISOString();
    scheduleBackendSave();

    const after = buildPersistenceSnapshot({
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId
    });
    recordBackendTransaction({
      type: "inventory_update",
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId,
      actorType: "account",
      actorId: auth.account.accountId,
      metadata: {
        requestId
      },
      before,
      after
    });

    writeJson(response, 200, {
      wallet: sanitizeWallet(auth.account.wallet),
      inventory: sanitizePersistentInventory(auth.profile.inventory),
      entitlements: sanitizeEntitlements(auth.profile.entitlements)
    });
    return true;
  }

  if (pathname === "/api/rank") {
    if (!auth.account || !auth.profile) {
      writeApiError(response, 401, "unauthorized", "Authentication required");
      return true;
    }

    if (request.method !== "GET") {
      writeApiError(response, 405, "method_not_allowed", "Use GET for rank data");
      return true;
    }

    writeJson(response, 200, {
      seasonId: currentSeasonId,
      ranking: createDefaultRanking(auth.profile.ranking),
      leaderboard: getTopRankedProfiles(10)
    });
    return true;
  }

  if (pathname === "/api/season") {
    if (!auth.account || !auth.profile) {
      writeApiError(response, 401, "unauthorized", "Authentication required");
      return true;
    }

    if (request.method !== "GET") {
      writeApiError(response, 405, "method_not_allowed", "Use GET for season data");
      return true;
    }

    writeJson(response, 200, {
      seasonId: currentSeasonId,
      profile: {
        profileId: auth.profile.profileId,
        displayName: auth.profile.displayName,
        seasonStats: createDefaultSeasonStats(auth.profile.seasonStats),
        ranking: createDefaultRanking(auth.profile.ranking)
      },
      leaderboard: getTopRankedProfiles(10)
    });
    return true;
  }

  if (pathname === "/api/purchases") {
    if (!auth.account || !auth.profile) {
      writeApiError(response, 401, "unauthorized", "Authentication required");
      return true;
    }

    if (request.method !== "POST") {
      writeApiError(response, 405, "method_not_allowed", "Use POST to make purchases");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Purchase request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const requestId = requireMutationProtection(request, response, body, auth);
    if (!requestId) {
      return true;
    }

    const sku = sanitizeLooseText(body.sku, "", 64);
    const product = purchaseCatalog.get(sku);
    if (!product) {
      writeApiError(response, 404, "unknown_sku", "Requested item does not exist");
      return true;
    }

    if (product.entitlementId && hasEntitlement(auth.profile, product.entitlementId)) {
      writeApiError(response, 409, "already_owned", "Entitlement already owned");
      return true;
    }

    if (auth.account.wallet.coins < product.price) {
      writeApiError(response, 409, "insufficient_funds", "Not enough coins for that purchase");
      return true;
    }

    const before = buildPersistenceSnapshot({
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId
    });
    auth.account.wallet.coins -= product.price;
    if (product.entitlementId) {
      grantEntitlement(auth.profile, product.entitlementId);
    }
    if (product.kind === "cosmetic" || product.kind === "badge") {
      grantInventoryItem(auth.profile, product.sku, 1, product.kind, "purchase");
    }
    auth.profile.updatedAt = new Date().toISOString();
    auth.account.lastSeenAt = new Date().toISOString();
    scheduleBackendSave();

    const after = buildPersistenceSnapshot({
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId
    });
    const transaction = recordBackendTransaction({
      type: "purchase",
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId,
      actorType: "account",
      actorId: auth.account.accountId,
      metadata: {
        sku: product.sku,
        price: product.price,
        requestId
      },
      before,
      after
    });

    writeJson(response, 200, {
      transaction: serializeTransaction(transaction),
      wallet: sanitizeWallet(auth.account.wallet),
      inventory: sanitizePersistentInventory(auth.profile.inventory),
      entitlements: sanitizeEntitlements(auth.profile.entitlements)
    });
    return true;
  }

  if (pathname === "/api/entitlements/check") {
    if (!auth.account || !auth.profile) {
      writeApiError(response, 401, "unauthorized", "Authentication required");
      return true;
    }

    if (request.method !== "POST") {
      writeApiError(response, 405, "method_not_allowed", "Use POST to check entitlements");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Entitlement check request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const checks = Array.isArray(body.entitlements) ? body.entitlements : [];
    writeJson(response, 200, {
      entitlements: checks.map((entry) => ({
        id: sanitizeLooseText(entry, "", 96),
        owned: hasEntitlement(auth.profile, entry)
      }))
    });
    return true;
  }

  if (pathname === "/api/cloud-save") {
    if (!auth.account || !auth.profile) {
      writeApiError(response, 401, "unauthorized", "Authentication required");
      return true;
    }

    if (request.method === "GET") {
      writeJson(response, 200, {
        cloudSave: sanitizeCloudSave(auth.profile.cloudSave)
      });
      return true;
    }

    if (request.method !== "PUT") {
      writeApiError(response, 405, "method_not_allowed", "Use GET or PUT for cloud saves");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Cloud save request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const requestId = requireMutationProtection(request, response, body, auth);
    if (!requestId) {
      return true;
    }

    const serialized = JSON.stringify(body.data ?? {});
    if (Buffer.byteLength(serialized, "utf8") > MAX_CLOUD_SAVE_BYTES) {
      writeApiError(response, 413, "cloud_save_too_large", "Cloud save payload is too large");
      return true;
    }

    const before = buildPersistenceSnapshot({
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId
    });
    auth.profile.cloudSave = {
      revision: (auth.profile.cloudSave?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      data: body.data && typeof body.data === "object" ? body.data : {}
    };
    auth.profile.updatedAt = new Date().toISOString();
    scheduleBackendSave();

    const after = buildPersistenceSnapshot({
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId
    });
    recordBackendTransaction({
      type: "cloud_save_update",
      accountId: auth.account.accountId,
      profileId: auth.profile.profileId,
      actorType: "account",
      actorId: auth.account.accountId,
      metadata: {
        requestId
      },
      before,
      after
    });

    writeJson(response, 200, {
      cloudSave: sanitizeCloudSave(auth.profile.cloudSave)
    });
    return true;
  }

  if (pathname === "/api/transactions") {
    if (!auth.account || !auth.profile) {
      writeApiError(response, 401, "unauthorized", "Authentication required");
      return true;
    }

    if (request.method !== "GET") {
      writeApiError(response, 405, "method_not_allowed", "Use GET for transactions");
      return true;
    }

    writeJson(response, 200, {
      transactions: Array.from(transactionLog.values())
        .filter(
          (transaction) =>
            transaction.accountId === auth.account.accountId ||
            transaction.profileId === auth.profile.profileId
        )
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
        .slice(0, 50)
        .map((transaction) => serializeTransaction(transaction))
    });
    return true;
  }

  if (pathname === "/api/allocator/status") {
    if (!requireAllocatorRequest(request)) {
      recordSecurityEvent("allocator_auth_failed", {
        request,
        severity: "warn",
        message: "Allocator status was requested without a valid allocator key"
      });
      writeApiError(response, 403, "forbidden", "Allocator access required");
      return true;
    }

    if (request.method !== "GET") {
      writeApiError(response, 405, "method_not_allowed", "Use GET for allocator status");
      return true;
    }

    const now = Date.now();
    writeJson(response, 200, {
      allocator: {
        instance: getInstanceInfo(),
        readiness: getReadinessState(now),
        capacity: getCapacitySummary(now),
        operations: getOperationsState(),
        joinableRooms: listAllocatableRooms(now).slice(0, 20).map((room) => getRoomSummary(room, now))
      }
    });
    return true;
  }

  if (pathname === "/api/allocator/allocate") {
    if (!requireAllocatorRequest(request)) {
      recordSecurityEvent("allocator_auth_failed", {
        request,
        severity: "warn",
        message: "Allocator allocate was requested without a valid allocator key"
      });
      writeApiError(response, 403, "forbidden", "Allocator access required");
      return true;
    }

    if (request.method !== "POST") {
      writeApiError(response, 405, "method_not_allowed", "Use POST for room allocation");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Allocator request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const requestId = requireMutationProtection(request, response, body, auth, { allocator: true });
    if (!requestId) {
      return true;
    }

    const now = Date.now();
    const allocation = allocateRoomForRequest(body, now);
    if (!allocation.ok) {
      writeApiError(response, allocation.statusCode ?? 503, allocation.code, allocation.message, {
        requestId,
        capacity: getCapacitySummary(now)
      });
      return true;
    }

    writeJson(response, 200, {
      requestId,
      allocation: buildAllocationResponse(request, allocation, now)
    });
    return true;
  }

  if (pathname === "/api/admin/ops") {
    if (!requireAdminRequest(request)) {
      recordSecurityEvent("admin_auth_failed", {
        request,
        severity: "warn",
        message: "Admin operations summary was requested without a valid admin key"
      });
      writeApiError(response, 403, "forbidden", "Admin access required");
      return true;
    }

    if (request.method !== "GET") {
      writeApiError(response, 405, "method_not_allowed", "Use GET for admin operations summary");
      return true;
    }

    writeJson(response, 200, {
      operations: getOperationalSummary({
        includeRecentSecurity: true
      })
    });
    return true;
  }

  if (pathname === "/api/admin/maintenance") {
    if (!requireAdminRequest(request)) {
      recordSecurityEvent("admin_auth_failed", {
        request,
        severity: "warn",
        message: "Admin maintenance control was requested without a valid admin key"
      });
      writeApiError(response, 403, "forbidden", "Admin access required");
      return true;
    }

    if (request.method !== "POST") {
      writeApiError(response, 405, "method_not_allowed", "Use POST for maintenance control");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Admin maintenance request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const requestId = requireMutationProtection(request, response, body, auth, { admin: true });
    if (!requestId) {
      return true;
    }

    const modeUpdate = updateOperationalMode({
      maintenanceMode: body.enabled,
      draining: body.draining,
      reason: body.reason
    });

    if (modeUpdate.changed) {
      recordSecurityEvent("ops_mode_changed", {
        request,
        severity: "info",
        message: "Server maintenance/drain mode changed",
        metadata: {
          requestId,
          maintenanceMode: operationsState.maintenanceMode,
          draining: operationsState.draining,
          reason: operationsState.maintenanceReason
        }
      });
      broadcastRooms(Date.now(), { force: true });
    }

    writeJson(response, 200, {
      requestId,
      operations: getOperationalSummary({
        includeRecentSecurity: true
      })
    });
    return true;
  }

  if (pathname === "/api/admin/shutdown") {
    if (!requireAdminRequest(request)) {
      recordSecurityEvent("admin_auth_failed", {
        request,
        severity: "warn",
        message: "Admin shutdown was requested without a valid admin key"
      });
      writeApiError(response, 403, "forbidden", "Admin access required");
      return true;
    }

    if (request.method !== "POST") {
      writeApiError(response, 405, "method_not_allowed", "Use POST for graceful shutdown");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Admin shutdown request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const requestId = requireMutationProtection(request, response, body, auth, { admin: true });
    if (!requestId) {
      return true;
    }

    const reason = sanitizeLooseText(body.reason ?? "", "", 160) || "admin_request";
    updateOperationalMode({
      maintenanceMode: true,
      draining: true,
      reason
    });
    operationsState.shutdownRequestedAt = new Date().toISOString();
    operationsState.shutdownReason = reason;
    recordSecurityEvent("admin_shutdown_requested", {
      request,
      severity: "warn",
      message: "Admin requested graceful shutdown",
      metadata: {
        requestId,
        reason
      }
    });

    writeJson(response, 202, {
      status: "shutting_down",
      requestId,
      reason,
      graceMs: GAME_CONFIG.match.shutdownGraceMs
    });

    setTimeout(() => {
      shutdown(`admin:${reason}`);
    }, 25);
    return true;
  }

  if (pathname === "/api/admin/security") {
    if (!requireAdminRequest(request)) {
      recordSecurityEvent("admin_auth_failed", {
        request,
        severity: "warn",
        message: "Admin security log was requested without a valid admin key"
      });
      writeApiError(response, 403, "forbidden", "Admin access required");
      return true;
    }

    if (request.method !== "GET") {
      writeApiError(response, 405, "method_not_allowed", "Use GET for admin security logs");
      return true;
    }

    const limit = Math.min(MAX_SECURITY_EVENTS, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const typeFilter = sanitizeLooseText(url.searchParams.get("type") ?? "", "", 48);
    const filteredEvents = typeFilter
      ? securityEvents.filter((entry) => entry.type === typeFilter)
      : securityEvents;
    const countsByType = filteredEvents.reduce((summary, entry) => {
      summary[entry.type] = (summary[entry.type] ?? 0) + 1;
      return summary;
    }, {});

    writeJson(response, 200, {
      security: {
        eventCount: securityEvents.length,
        filteredCount: filteredEvents.length,
        filter: {
          type: typeFilter || null,
          limit
        },
        countsByType,
        events: filteredEvents.slice(-limit)
      }
    });
    return true;
  }

  if (pathname === "/api/admin/transactions") {
    if (!requireAdminRequest(request)) {
      recordSecurityEvent("admin_auth_failed", {
        request,
        severity: "warn",
        message: "Admin transaction list was requested without a valid admin key"
      });
      writeApiError(response, 403, "forbidden", "Admin access required");
      return true;
    }

    if (request.method !== "GET") {
      writeApiError(response, 405, "method_not_allowed", "Use GET for admin transactions");
      return true;
    }

    writeJson(response, 200, {
      transactions: Array.from(transactionLog.values())
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
        .slice(0, 200)
        .map((transaction) => serializeTransaction(transaction, { includeSnapshots: true }))
    });
    return true;
  }

  if (pathname === "/api/admin/rollback" || pathname === "/api/admin/restore") {
    if (!requireAdminRequest(request)) {
      recordSecurityEvent("admin_auth_failed", {
        request,
        severity: "warn",
        message: "Admin restore tool was requested without a valid admin key",
        metadata: {
          pathname
        }
      });
      writeApiError(response, 403, "forbidden", "Admin access required");
      return true;
    }

    if (request.method !== "POST") {
      writeApiError(response, 405, "method_not_allowed", "Use POST for restore tools");
      return true;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      recordInvalidJsonRequest(request, pathname, "Admin restore request body was not valid JSON");
      writeApiError(response, 400, "invalid_json", "Request body must be valid JSON");
      return true;
    }

    const requestId = requireMutationProtection(request, response, body, auth, { admin: true });
    if (!requestId) {
      return true;
    }

    const transactionId = sanitizeLooseText(body.transactionId, "", 96);
    const transaction = transactionLog.get(transactionId);
    if (!transaction) {
      writeApiError(response, 404, "transaction_not_found", "Transaction was not found");
      return true;
    }

    const mode = pathname === "/api/admin/rollback" ? "before" : sanitizeLooseText(body.mode ?? "after", "after", 16);
    if ((mode !== "before" && mode !== "after") || (mode === "before" && transaction.reversible === false)) {
      writeApiError(response, 400, "invalid_restore_mode", "Requested restore mode is not available");
      return true;
    }

    const restoreTransaction = restoreTransactionSnapshot(transaction, mode);
    if (!restoreTransaction) {
      writeApiError(response, 400, "restore_failed", "Transaction did not contain the requested snapshot");
      return true;
    }

    restoreTransaction.metadata = {
      ...(restoreTransaction.metadata ?? {}),
      requestId
    };

    writeJson(response, 200, {
      restored: serializeTransaction(restoreTransaction, { includeSnapshots: true })
    });
    return true;
  }

  return false;
}

function rejectUpgrade(socket, statusCode, message) {
  if (!socket.writable) {
    return;
  }

  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message}`
  );
  socket.destroy();
}

function shouldAllowWebSocketUpgrade(request) {
  if (isShuttingDown) {
    return { allowed: false, statusCode: 503, message: "Server shutting down" };
  }

  if (connectedSocketCount >= MAX_CLIENTS_PER_INSTANCE) {
    recordSecurityEvent("websocket_capacity_rejected", {
      request,
      severity: "info",
      message: "WebSocket upgrade was rejected because the instance is at client capacity"
    });
    return { allowed: false, statusCode: 503, message: "Server at connection capacity" };
  }

  const ip = getRequestIp(request);
  const now = Date.now();
  const upgradeLimit = consumeWindowRateLimit(
    upgradeRateLimits,
    ip,
    now,
    SECURITY_RATE_WINDOWS.upgrade.limit,
    SECURITY_RATE_WINDOWS.upgrade.windowMs
  );
  if (!upgradeLimit.allowed) {
    recordSecurityEvent("websocket_upgrade_rate_limited", {
      request,
      severity: "info",
      message: "WebSocket upgrade was rate limited",
      metadata: {
        retryAfterMs: upgradeLimit.retryAfterMs
      }
    });
    return { allowed: false, statusCode: 429, message: "Too many upgrade attempts" };
  }

  if (!isAllowedOriginForRequest(request)) {
    recordSecurityEvent("websocket_origin_rejected", {
      request,
      severity: "info",
      message: "WebSocket upgrade origin was rejected"
    });
    return { allowed: false, statusCode: 403, message: "Origin not allowed" };
  }

  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
  if (pathname !== "/") {
    recordSecurityEvent("websocket_path_rejected", {
      request,
      severity: "info",
      message: "WebSocket upgrade used an invalid path",
      metadata: {
        pathname
      }
    });
    return { allowed: false, statusCode: 404, message: "WebSocket endpoint not found" };
  }

  return { allowed: true };
}

function getOperationalSummary(options = {}) {
  const now = options.now ?? Date.now();
  const roomSummaries = Array.from(rooms.values()).map((room) => ({
    ...getRoomSummary(room, now),
    recoverableDisconnectedPlayers: getRecoverableDisconnectedPlayers(room, now).length,
    totalPlayers: room.players.size
  }));
  const readiness = getReadinessState(now);
  const securitySummary = {
    eventCount: securityEvents.length
  };
  if (options.includeRecentSecurity) {
    securitySummary.recent = securityEvents.slice(-10);
  }

  return {
    instance: getInstanceInfo(),
    environment,
    version: gameVersion,
    assetVersion,
    protocolVersion: PROTOCOL_VERSION,
    minSupportedProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
    profilesSchemaVersion: PROFILES_SCHEMA_VERSION,
    backendSchemaVersion: BACKEND_SCHEMA_VERSION,
    currentSeasonId,
    publicOrigin,
    allowedOrigins: Array.from(allowedOrigins.values()),
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Number(((now - startedAt) / 1000).toFixed(1)),
    simulation: {
      fixedTimestep: true,
      tickRate: GAME_CONFIG.serverTickRate,
      fixedTickMs: Number((1000 / GAME_CONFIG.serverTickRate).toFixed(4)),
      snapshotRate: GAME_CONFIG.snapshotRate,
      snapshotStrideTicks: Math.max(1, Math.round(GAME_CONFIG.serverTickRate / GAME_CONFIG.snapshotRate)),
      maxCatchUpTicks: GAME_CONFIG.simulation.maxCatchUpTicks
    },
    profilesLoaded,
    backendLoaded,
    shuttingDown: isShuttingDown,
    profileCount: profiles.size,
    backendProfileCount: backendProfiles.size,
    accountCount: accounts.size,
    activeSessionCount: authSessions.size,
    transactionCount: transactionLog.size,
    operations: getOperationsState(),
    readiness,
    capacity: readiness.capacity,
    security: securitySummary,
    roomCount: rooms.size,
    rooms: roomSummaries
  };
}

async function serveStatic(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  applySecurityHeaders(response);

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApiRequest(request, response, url);
    if (!handled) {
      writeApiError(response, 404, "not_found", "API endpoint not found");
    }
    return;
  }

  if (url.pathname === "/healthz") {
    writeJson(response, 200, {
      status: "ok",
      ...getOperationalSummary()
    });
    return;
  }

  if (url.pathname === "/readyz") {
    const readiness = getReadinessState();
    writeJson(response, readiness.ready ? 200 : 503, {
      status: readiness.ready ? "ready" : "not_ready",
      reasons: readiness.reasons,
      ...getOperationalSummary({
        now: Date.now()
      })
    });
    return;
  }

  if (url.pathname === "/metrics") {
    writeText(response, 200, formatMetrics(), "text/plain; version=0.0.4; charset=utf-8");
    return;
  }

  if (url.pathname === "/meta") {
    writeJson(response, 200, {
      name: "multitank",
      advertisedOrigin: getAdvertisedOrigin(request),
      backend: {
        seasonId: currentSeasonId,
        authEnabled: true,
        adminToolsEnabled: Boolean(adminApiKey),
        catalog: getSafePurchaseCatalog()
      },
      ...getOperationalSummary()
    });
    return;
  }

  if (url.pathname === "/rooms") {
    writeJson(response, 200, {
      rooms: Array.from(rooms.values())
        .map((room) => getRoomSummary(room, Date.now()))
        .sort((left, right) => left.roomCode.localeCompare(right.roomCode))
    });
    return;
  }

  if (url.pathname === "/assets/manifest.json") {
    writeJson(response, 200, await buildPublicAssetManifest());
    return;
  }

  const isShared = url.pathname.startsWith("/shared/");
  const baseDir = isShared ? sharedDir : publicDir;

  let relativePath = isShared ? url.pathname.replace("/shared/", "") : url.pathname.slice(1);
  if (!relativePath) {
    relativePath = "index.html";
  }

  const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(baseDir, safePath);

  if (!filePath.startsWith(baseDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const contentType = mimeTypes.get(path.extname(filePath)) ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0"
    });
    response.end(file);
  } catch (error) {
    response.writeHead(404);
    response.end("Not found");
  }
}

function resetObjectiveState(room, options = {}) {
  const { rerollPositions = true } = options;
  const mapId = room?.lobby?.mapId ?? GAME_CONFIG.lobby.maps[0]?.id;
  if (!room.objective || typeof room.objective !== "object") {
    room.objective = createObjectiveState(mapId);
  }

  const sourceZones =
    rerollPositions || !Array.isArray(room.objective.zones) || room.objective.zones.length === 0
      ? buildObjectiveZones(room, mapId, { randomize: true })
      : room.objective.zones;

  room.objective.zones = sourceZones.map((zone, index) =>
    createObjectiveZoneState(
      zone?.slot ?? getObjectiveZoneSlot(index),
      Number(zone?.x) || 0,
      Number(zone?.y) || 0,
      Number(zone?.radius) || GAME_CONFIG.objective.radius
    )
  );
  syncObjectiveSummary(room.objective, mapId);
}

function clearOwnedEntityLifecycle(room, ownerId) {
  for (const bullet of Array.from(room.bullets.values())) {
    if (bullet.ownerId === ownerId) {
      room.bullets.delete(bullet.id);
    }
  }

  room.pendingShots = room.pendingShots.filter((shot) => shot.playerId !== ownerId);
}

function rebuildRoomMapState(room) {
  if (!room) {
    return;
  }

  resetObjectiveState(room);
  room.shapes.clear();
  spawnInitialShapes(room);
}

function removePlayerFromRoom(room, playerId, options = {}) {
  const { preserveForReconnect = false, now = Date.now() } = options;
  const player = room.players.get(playerId);

  if (!player) {
    return null;
  }

  if (preserveForReconnect) {
    player.connected = false;
    player.ready = false;
    player.disconnectedAt = now;
    player.reconnectDeadlineAt = now + GAME_CONFIG.session.reconnectGraceMs;
    player.slotReserved = !player.isSpectator;
    player.pendingInputs.length = 0;
    player.input.forward = false;
    player.input.back = false;
    player.input.left = false;
    player.input.right = false;
    player.input.shoot = false;
    player.input.clientSentAt = 0;
    player.input.receivedAt = 0;

    return player;
  }

  clearOwnedEntityLifecycle(room, playerId);
  player.slotReserved = false;
  room.players.delete(playerId);
  markRoomPlayerOrderDirty(room);
  syncRoomOwner(room);
  return player;
}

function resetPlayerForRound(room, player) {
  if (player.isSpectator) {
    player.alive = false;
    player.ready = false;
    player.afk = false;
    player.afkSinceAt = null;
    player.pendingInputs = [];
    player.slotReserved = false;
    return;
  }

  const now = Date.now();
  const spawn = createSpawnPoint(room, {
    teamId: player.teamId,
    classId: player.classId,
    isBot: player.isBot,
    spawnKey: `${player.id}:round:${Math.floor(now)}`,
    enforceEnemyBuffer: true,
    minDistanceToPlayers: GAME_CONFIG.spawn.safeRespawnDistance
  });
  player.x = spawn.x;
  player.y = spawn.y;
  player.angle = 0;
  player.turretAngle = 0;
  player.hp = getPlayerMaxHitPoints(player);
  player.credits = 0;
  player.score = 0;
  player.assists = 0;
  player.deaths = 0;
  normalizePlayerInventory(player);
  player.alive = true;
  player.nextAiThinkAt = 0;
  player.respawnAt = 0;
  applyRoomSpawnProtection(room, player, now);
  player.lastShotAt = 0;
  player.lastProcessedInputTick = 0;
  player.lastProcessedInputClientSentAt = 0;
  player.lastReceivedInputClientSentAt = 0;
  player.pendingInputs = [];
  resetPlayerHistory(player);
  markPlayerActive(player, now);
  player.input = {
    seq: player.lastProcessedInputSeq,
    clientSentAt: 0,
    receivedAt: 0,
    forward: false,
    back: false,
    left: false,
    right: false,
    shoot: false,
    turretAngle: 0
  };
  player.animation = createPlayerAnimationState(now, {
    locomotion: ANIMATION_POSES.IDLE,
    overlayAction: ANIMATION_ACTIONS.SPAWN,
    eventAction: ANIMATION_ACTIONS.SPAWN,
    eventSeq: (player.animation?.eventSeq ?? 0) + 1,
    eventStartedAt: now,
    trackPhase: 0
  });
  player.combat = createPlayerCombatState(player, now);
  player.combat.shieldUntil = 0;
  player.combat.shieldRemainingMs = 0;
  player.combat.shielded = false;
  clearCombatContributors(player);
  rememberSafePlayerState(player);
  if (player.isBot) {
    resetBotAiState(player, now);
  }
}

function clearTransientRoomCombatState(room) {
  room.bullets.clear();
  room.pendingShots.length = 0;
}

function clearRoomCombatState(room) {
  clearTransientRoomCombatState(room);
  room.nextBulletId = 1;
  resetObjectiveState(room);
  for (const player of room.players.values()) {
    if (player.isSpectator) {
      player.alive = false;
      player.ready = false;
      player.afk = false;
      player.afkSinceAt = null;
      player.pendingInputs = [];
      player.slotReserved = false;
      continue;
    }

    const now = Date.now();
    const spawn = createSpawnPoint(room, {
      teamId: player.teamId,
      classId: player.classId,
      isBot: player.isBot,
      spawnKey: `${player.id}:reset:${Math.floor(now)}`,
      enforceEnemyBuffer: true,
      minDistanceToPlayers: GAME_CONFIG.spawn.safeRespawnDistance
    });
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = 0;
    player.turretAngle = 0;
    player.hp = getPlayerMaxHitPoints(player);
    player.credits = 0;
    player.assists = 0;
    normalizePlayerInventory(player);
    player.alive = true;
    player.nextAiThinkAt = 0;
    player.respawnAt = 0;
    applyRoomSpawnProtection(room, player, now);
    player.lastShotAt = 0;
    player.lastProcessedInputTick = 0;
    player.lastProcessedInputClientSentAt = 0;
    player.lastReceivedInputClientSentAt = 0;
    player.pendingInputs = [];
    resetPlayerHistory(player);
    markPlayerActive(player, now);
    player.input.forward = false;
    player.input.back = false;
    player.input.left = false;
    player.input.right = false;
    player.input.shoot = false;
    player.input.turretAngle = 0;
    player.input.clientSentAt = 0;
    player.input.receivedAt = 0;
    player.animation = createPlayerAnimationState(now, {
      locomotion: ANIMATION_POSES.IDLE,
      overlayAction: ANIMATION_ACTIONS.SPAWN,
      eventAction: ANIMATION_ACTIONS.SPAWN,
      eventSeq: (player.animation?.eventSeq ?? 0) + 1,
      eventStartedAt: now,
      trackPhase: 0
    });
    player.combat = createPlayerCombatState(player, now);
    player.combat.shieldUntil = 0;
    player.combat.shieldRemainingMs = 0;
    player.combat.shielded = false;
    clearCombatContributors(player);
    rememberSafePlayerState(player);
    if (player.isBot) {
      resetBotAiState(player, now);
    }
  }
}

function expireDisconnectedPlayers(room, now) {
  for (const player of Array.from(room.players.values())) {
    if (player.isBot) {
      continue;
    }

    if (player.connected) {
      continue;
    }

    if (!player.reconnectDeadlineAt || player.reconnectDeadlineAt > now) {
      continue;
    }

    removePlayerFromRoom(room, player.id, { now });
  }
}

function setRoomPhase(room, phase, now, winner = null, options = {}) {
  const {
    message = null,
    phaseEndsAt = undefined,
    resumePhase = null,
    transitionTargetMapId = null,
    transitionAutoStart = false,
    shutdownReason = null
  } = options;

  room.match.phase = phase;
  room.match.resumePhase = phase === MATCH_PHASES.PAUSE ? resumePhase ?? room.match.resumePhase : null;
  room.match.transitionTargetMapId =
    phase === MATCH_PHASES.MAP_TRANSITION
      ? getLobbyMap(transitionTargetMapId ?? room.lobby.mapId).id
      : room.lobby.mapId;
  room.match.transitionAutoStart = phase === MATCH_PHASES.MAP_TRANSITION ? Boolean(transitionAutoStart) : false;
  room.match.shutdownReason = phase === MATCH_PHASES.SHUTDOWN ? shutdownReason ?? null : null;
  room.match.pausedRemainingMs = phase === MATCH_PHASES.PAUSE ? room.match.pausedRemainingMs : null;
  room.match.winnerId = winner?.id ?? null;
  room.match.winnerName = winner?.name ?? null;

  let nextPhaseEndsAt = phaseEndsAt;
  let nextMessage = message;

  if (phase === MATCH_PHASES.WAITING) {
    nextPhaseEndsAt = null;
    nextMessage ??= "Waiting for players";
  }

  if (phase === MATCH_PHASES.WARMUP) {
    nextPhaseEndsAt ??= now + GAME_CONFIG.match.warmupMs;
    nextMessage ??= "Warmup";
    // Spawn shapes when game starts
    if (room.shapes.size === 0) {
      spawnInitialShapes(room);
    }
  }

  if (phase === MATCH_PHASES.PAUSE) {
    nextPhaseEndsAt ??= getLatestReconnectDeadline(room, now);
    nextMessage ??= "Match paused while a player reconnects";
  }

  if (phase === MATCH_PHASES.LIVE_ROUND) {
    if (isRoomContinuousMode(room)) {
      nextPhaseEndsAt = null;
      nextMessage ??=
        isRoomSurvivalMode(room)
          ? "No respawns | last tank standing"
          : "Continuous battle";
    } else {
      nextPhaseEndsAt ??= now + GAME_CONFIG.match.durationMs;
      nextMessage ??= "Live round";
    }
  }

  if (phase === MATCH_PHASES.OVERTIME) {
    nextPhaseEndsAt = null;
    nextMessage ??= "Overtime";
  }

  if (phase === MATCH_PHASES.ROUND_END) {
    nextPhaseEndsAt ??= now + GAME_CONFIG.match.roundEndMs;
    nextMessage ??= winner ? `${winner.name} won the round` : "Round over";
  }

  if (phase === MATCH_PHASES.RESULTS) {
    nextPhaseEndsAt ??= now + GAME_CONFIG.match.resultsMs;
    nextMessage ??= winner ? `${winner.name} leads the results` : "Results";
  }

  if (phase === MATCH_PHASES.MAP_TRANSITION) {
    const targetMap = getLobbyMap(room.match.transitionTargetMapId);
    nextPhaseEndsAt ??= now + GAME_CONFIG.match.mapTransitionMs;
    nextMessage ??=
      room.match.transitionAutoStart
        ? `Preparing rematch on ${targetMap.name}`
        : `Transitioning to ${targetMap.name}`;
  }

  if (phase === MATCH_PHASES.SHUTDOWN) {
    nextPhaseEndsAt ??= now + GAME_CONFIG.match.shutdownGraceMs;
    nextMessage ??= shutdownReason ? `Server shutting down (${shutdownReason})` : "Server shutting down";
  }

  room.match.phaseEndsAt = nextPhaseEndsAt ?? null;
  room.match.message = nextMessage ?? room.match.message;
  markRoomActive(room, now);
  queueRoundStateEvent(room, now);
}

function pauseMatchForReconnect(room, now) {
  if (!isWarmupPhase(room.match.phase) && !isCombatPhase(room.match.phase)) {
    return;
  }

  room.match.pausedRemainingMs =
    room.match.phase === MATCH_PHASES.LIVE_ROUND && !isRoomContinuousMode(room)
      ? Math.max(1000, (room.match.phaseEndsAt ?? now) - now)
      : isWarmupPhase(room.match.phase)
        ? Math.max(1000, (room.match.phaseEndsAt ?? now) - now)
        : null;
  setRoomPhase(room, MATCH_PHASES.PAUSE, now, getCurrentWinner(room), {
    resumePhase: room.match.phase,
    message: isWarmupPhase(room.match.phase)
      ? "Warmup paused while a player reconnects"
      : "Match paused while a player reconnects"
  });
}

function resumePausedMatch(room, now) {
  if (room.match.phase !== MATCH_PHASES.PAUSE) {
    return;
  }

  const resumePhase = room.match.resumePhase ?? MATCH_PHASES.LIVE_ROUND;
  room.match.phase = resumePhase;
  room.match.resumePhase = null;
  room.match.phaseEndsAt =
    resumePhase === MATCH_PHASES.LIVE_ROUND && !isRoomContinuousMode(room)
      ? now + Math.max(1000, room.match.pausedRemainingMs ?? GAME_CONFIG.match.durationMs)
      : isWarmupPhase(resumePhase)
        ? now + Math.max(1000, room.match.pausedRemainingMs ?? GAME_CONFIG.match.warmupMs)
      : null;
  room.match.pausedRemainingMs = null;
  room.match.message =
    resumePhase === MATCH_PHASES.OVERTIME
      ? "Overtime"
      : isWarmupPhase(resumePhase)
        ? "Warmup"
      : isRoomContinuousMode(room)
        ? "Continuous battle"
        : "Live round";
  queueRoundStateEvent(room, now);
}

function getReadyPlayers(room) {
  return getConnectedMatchPlayers(room).filter((player) => player.ready);
}

function maybeStartCountdown(room, now) {
  const connectedPlayers = getConnectedMatchPlayers(room);
  const readyPlayers = getReadyPlayers(room);

  // Auto-start with 1 human player (bots fill in)
  const effectiveMinPlayers = 1;
  if (
    room.match.phase === MATCH_PHASES.WAITING &&
    connectedPlayers.length >= effectiveMinPlayers &&
    readyPlayers.length === connectedPlayers.length
  ) {
    setRoomPhase(room, MATCH_PHASES.WARMUP, now);
  }
}

function shouldAutoReadyPlayer(room, player) {
  return Boolean(
    room &&
    player &&
    !player.isSpectator &&
    (
      room.match.phase === MATCH_PHASES.WAITING ||
      isWarmupPhase(room.match.phase) ||
      (room.match.phase === MATCH_PHASES.PAUSE && isWarmupPhase(room.match.resumePhase))
    )
  );
}

function autoReadyPlayerForImmediateMatch(room, player, now) {
  if (!shouldAutoReadyPlayer(room, player)) {
    return false;
  }

  player.ready = true;
  markPlayerActive(player, now);
  maybeStartCountdown(room, now);
  return true;
}

function maybeStartRematch(room, now) {
  const connectedHumanPlayers = getConnectedHumanMatchPlayers(room);

  if (
    room.match.phase !== MATCH_PHASES.RESULTS ||
    connectedHumanPlayers.length === 0 ||
    connectedHumanPlayers.some((player) => !player.ready)
  ) {
    return false;
  }

  setRoomPhase(room, MATCH_PHASES.MAP_TRANSITION, now, getCurrentWinner(room), {
    transitionTargetMapId: room.lobby.mapId,
    transitionAutoStart: true,
    message: `Rematch locked on ${getLobbyMap(room.lobby.mapId).name}`
  });
  return true;
}

function canAddBotsInPhase(phase) {
  return phase === MATCH_PHASES.WAITING || isWarmupPhase(phase) || phase === MATCH_PHASES.PAUSE || isCombatPhase(phase);
}

function syncRoomBots(room, now) {
  const humanPlayerCount = getRestorableHumanMatchPlayerCount(room, now);
  const bots = getBotPlayers(room);
  const botsPerTeam = Math.max(0, Math.floor(GAME_CONFIG.ai.botsPerTeam ?? 0));
  const desiredAssignments = GAME_CONFIG.lobby.teams.flatMap((team) =>
    Array.from({ length: botsPerTeam }, (_, slotIndex) => getBotIdentity(team.id, slotIndex))
  );
  const desiredAssignmentKeys = new Set(desiredAssignments.map((identity) => identity.key));
  const assignedBots = new Map();
  const extraBots = [];

  if (humanPlayerCount === 0) {
    for (const bot of bots) {
      removePlayerFromRoom(room, bot.id, { now });
    }
    return;
  }

  for (const bot of bots) {
    const assignmentKey = getBotAssignmentKey(bot.botTeamId ?? bot.teamId, bot.botSlotIndex ?? 0);
    if (!desiredAssignmentKeys.has(assignmentKey) || assignedBots.has(assignmentKey)) {
      extraBots.push(bot);
      continue;
    }

    assignedBots.set(assignmentKey, bot);
  }

  for (const bot of extraBots) {
    removePlayerFromRoom(room, bot.id, { now });
  }

  for (const bot of assignedBots.values()) {
    bot.ready = true;
    bot.connected = true;
    bot.disconnectedAt = null;
    bot.reconnectDeadlineAt = null;
    syncBotLoadout(bot, now);
  }

  if (!canAddBotsInPhase(room.match.phase)) {
    return;
  }

  for (const identity of desiredAssignments) {
    if (assignedBots.has(identity.key)) {
      continue;
    }

    const bot = createBotState(room, identity.teamId, identity.slotIndex, now);
    room.players.set(bot.id, bot);
    markRoomPlayerOrderDirty(room);
    if (room.match.phase !== MATCH_PHASES.WAITING && !isWarmupPhase(room.match.phase)) {
      queueSpawnStateEvent(room, bot, now);
      queueAnimationStateEvent(room, bot, ANIMATION_ACTIONS.SPAWN, now);
      queueHealthStateEvent(room, bot, getPlayerMaxHitPoints(bot), now);
      queueInventoryStateEvent(room, bot, now);
    }
  }
}

function startMatch(room, now) {
  const preserveExistingState = isRoomContinuousMode(room) || room.roundNumber === 0;
  room.roundNumber += 1;
  room.events.length = 0;

  if (!preserveExistingState) {
    room.bullets.clear();
    room.nextBulletId = 1;
    resetObjectiveState(room);
  }

  for (const player of room.players.values()) {
    if (player.isSpectator) {
      player.ready = false;
      continue;
    }

    if (!preserveExistingState) {
      resetPlayerForRound(room, player);
    }

    if (player.connected) {
      updateProfileStats(player.profileId, (stats) => {
        stats.matchesPlayed += 1;
      });
    }

    if (!preserveExistingState) {
      queueSpawnStateEvent(room, player, now);
      queueAnimationStateEvent(room, player, ANIMATION_ACTIONS.SPAWN, now);
      queueInventoryStateEvent(room, player, now);
    }
  }

  setRoomPhase(room, MATCH_PHASES.LIVE_ROUND, now);
}

function finishMatch(room, now, winner, options = {}) {
  const { message = null } = options;
  clearTransientRoomCombatState(room);
  setRoomPhase(room, MATCH_PHASES.ROUND_END, now, winner, {
    message
  });

  updatePersistentRankingsForMatch(room, winner, now);

  if (winner) {
    updateProfileStats(winner.profileId, (stats) => {
      stats.wins += 1;
    });
  }

  for (const player of room.players.values()) {
    player.ready = false;
  }
}

function finishMatchDueToDisconnect(room, now) {
  const winner =
    Array.from(room.players.values())
      .filter((player) => player.connected && isActiveParticipant(player))
      .sort((left, right) => right.score - left.score || left.deaths - right.deaths)[0] ??
    null;

  finishMatch(room, now, winner, {
    message: winner
      ? `${winner.name} wins because the other player did not reconnect`
      : "Round ended because players did not reconnect"
  });
}

function syncContinuousMatchState(room, now) {
  if (!isRoomContinuousMode(room)) {
    return;
  }

  if (!isRoomSurvivalMode(room)) {
    if (
      room.match.winnerId === null &&
      room.match.winnerName === null &&
      room.match.message === "Continuous battle"
    ) {
      return;
    }

    room.match.winnerId = null;
    room.match.winnerName = null;
    room.match.message = "Continuous battle";
    queueRoundStateEvent(room, now);
    return;
  }

  const aliveParticipants = getAliveActiveParticipants(room);
  const nextWinner = aliveParticipants.length === 1 ? aliveParticipants[0] : null;
  const nextWinnerId = nextWinner?.id ?? null;
  const nextWinnerName = nextWinner?.name ?? null;
  const nextMessage = isRoomSurvivalMode(room)
    ? aliveParticipants.length === 0
      ? "Everyone is down"
      : aliveParticipants.length === 1
        ? `${nextWinnerName} is last alive`
        : `No respawns | ${aliveParticipants.length} alive`
    : "Continuous battle";

  if (
    room.match.winnerId === nextWinnerId &&
    room.match.winnerName === nextWinnerName &&
    room.match.message === nextMessage
  ) {
    return;
  }

  room.match.winnerId = nextWinnerId;
  room.match.winnerName = nextWinnerName;
  room.match.message = nextMessage;
  queueRoundStateEvent(room, now);
}

function finalizeMapTransition(room, now) {
  room.lobby.mapId = getLobbyMap(room.match.transitionTargetMapId).id;
  const autoStart = room.match.transitionAutoStart;
  room.match.transitionAutoStart = false;
  room.match.transitionTargetMapId = room.lobby.mapId;
  rebuildRoomMapState(room);

  if (!autoStart) {
    resetToLobby(room, now);
    return;
  }

  clearRoomCombatState(room);
  syncRoomBots(room, now);
  const connectedPlayers = getConnectedMatchPlayers(room);
  const readyPlayers = getReadyPlayers(room);

  if (
    connectedPlayers.length >= 1 &&
    readyPlayers.length === connectedPlayers.length
  ) {
    setRoomPhase(room, MATCH_PHASES.WARMUP, now);
    return;
  }

  resetToLobby(room, now);
}

function resetToLobby(room, now) {
  clearRoomCombatState(room);
  rebuildRoomMapState(room);
  setRoomPhase(room, MATCH_PHASES.WAITING, now);
  syncRoomBots(room, now);
}

function removeSocketFromRoom(socket, options = {}) {
  const { preserveForReconnect = false } = options;
  const roomId = socket.data?.roomId;
  const playerId = socket.data?.playerId;

  if (!roomId || !playerId) {
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const player = room.players.get(playerId);
  if (player) {
    removePlayerFromRoom(room, playerId, { preserveForReconnect, now: Date.now() });
  }

  const now = Date.now();
  room.clients.delete(socket);
  syncRoomOwner(room);
  markRoomActive(room, now);

  const connectedPlayers = getConnectedPlayers(room);
  const recoverableDisconnectedPlayers = getRecoverableDisconnectedPlayers(room, now);

  if (connectedPlayers.length === 0 && recoverableDisconnectedPlayers.length === 0) {
    deleteRoom(roomId);
  }

  socket.data.roomId = null;
  socket.data.playerId = null;
  socket.data.accountId = null;
  socket.data.sessionId = null;
}

function joinRoom(socket, payload) {
  const roomId = sanitizeRoomId(payload.roomId);
  let playerName = sanitizePlayerName(payload.name);
  const requestedSpectator = Boolean(payload.spectate);
  const now = Date.now();
  const authToken = sanitizeAuthToken(payload.authToken);
  const requestedSessionId = sanitizeSessionId(payload.sessionId);
  const requestedProfileId = sanitizeProfileId(payload.profileId);
  let authenticatedSession = null;
  let authenticatedAccount = null;
  const joinWarnings = [];

  if (authToken) {
    authenticatedSession = getSessionByToken(
      authToken,
      {
        ip: socket.data?.remoteAddress,
        userAgent: socket.data?.userAgent
      },
      now
    );
    authenticatedAccount = authenticatedSession ? accounts.get(authenticatedSession.accountId) ?? null : null;

    if (!authenticatedAccount) {
      recordSecurityEvent("websocket_auth_failed", {
        socket,
        severity: "info",
        message: "Authenticated WebSocket join token was invalid or expired, so the session continued as a guest",
        metadata: {
          roomId,
          requestedProfileId
        }
      });
      joinWarnings.push({
        code: "invalid_auth_token",
        message: "Join token is invalid or expired. Continuing as a guest."
      });
      authenticatedSession = null;
      authenticatedAccount = null;
    } else {
      if (requestedProfileId && requestedProfileId !== authenticatedAccount.profileId) {
        recordSecurityEvent("authenticated_join_profile_override", {
          socket,
          accountId: authenticatedAccount.accountId,
          profileId: authenticatedAccount.profileId,
          severity: "info",
          message: "Authenticated join attempted to override the account-bound profile",
          metadata: {
            roomId,
            requestedProfileId,
            boundProfileId: authenticatedAccount.profileId
          }
        });
      }

      authenticatedSession.lastSeenAt = new Date(now).toISOString();
      authenticatedAccount.lastSeenAt = new Date(now).toISOString();
      playerName = sanitizePlayerName(payload.name ?? authenticatedAccount.displayName);
      scheduleBackendSave();
    }
  }

  if (!isSupportedGameVersion(payload.gameVersion)) {
    recordSecurityEvent("websocket_game_version_mismatch", {
      socket,
      severity: "info",
      message: "Client joined with a stale game build and was kept connected in compatibility mode",
      metadata: {
        clientVersion: sanitizeLooseText(payload.gameVersion ?? "", "", 32) || null,
        serverVersion: gameVersion,
        roomId
      }
    });
    joinWarnings.push({
      code: "game_version_mismatch",
      message: `Client version ${payload.gameVersion} does not match server version ${gameVersion}. Continuing in compatibility mode.`
    });
  }

  if (!isSupportedAssetVersion(payload.assetVersion)) {
    recordSecurityEvent("websocket_asset_version_mismatch", {
      socket,
      severity: "info",
      message: "Client joined with a stale asset bundle and was kept connected in compatibility mode",
      metadata: {
        clientVersion: sanitizeLooseText(payload.assetVersion ?? "", "", 32) || null,
        serverVersion: assetVersion,
        roomId
      }
    });
    joinWarnings.push({
      code: "asset_version_mismatch",
      message: `Client assets ${payload.assetVersion} do not match server assets ${assetVersion}. Continuing in compatibility mode.`
    });
  }

  const roomExists = rooms.has(roomId);
  if (!roomExists) {
    const roomCreationVerdict = getRoomCreationAdmissionVerdict(now);
    if (!roomCreationVerdict.ok) {
      rejectIncompatibleSocket(socket, roomCreationVerdict.code, roomCreationVerdict.message, roomCreationVerdict.closeCode);
      return;
    }
  }

  removeSocketFromRoom(socket);

  const room = getRoom(roomId);
  markRoomActive(room, now);
  const requestedMapId = getLobbyMap(payload.mapId).id;
  const requestedTeamId = isValidLobbyOptionId(payload.teamId, GAME_CONFIG.lobby.teams)
    ? payload.teamId
    : null;
  const requestedClassId = isValidLobbyOptionId(payload.classId, GAME_CONFIG.lobby.classes)
    ? payload.classId
    : null;
  if (!roomExists) {
    room.lobby.mapId = requestedMapId;
    room.match.transitionTargetMapId = requestedMapId;
    rebuildRoomMapState(room);
  }
  const resolvedProfileId = authenticatedAccount?.profileId ?? requestedProfileId;
  let existingPlayer = null;
  if (requestedSessionId) {
    existingPlayer =
      Array.from(room.players.values()).find((candidate) => candidate.sessionId === requestedSessionId) ??
      Array.from(room.players.values()).find(
        (candidate) => candidate.profileId === resolvedProfileId && candidate.connected === false
      ) ??
      null;
  } else if (resolvedProfileId) {
    existingPlayer = Array.from(room.players.values()).find((candidate) => candidate.profileId === resolvedProfileId) ?? null;
  }
  if (!existingPlayer) {
    const joinVerdict = getFreshJoinAdmissionVerdict(now);
    if (!joinVerdict.ok) {
      if (!roomExists && room.players.size === 0 && room.clients.size === 0) {
        deleteRoom(room.id);
      }
      rejectIncompatibleSocket(socket, joinVerdict.code, joinVerdict.message, joinVerdict.closeCode);
      return;
    }
  }

  const profile = getOrCreateProfile(resolvedProfileId, playerName);
  if (authenticatedAccount) {
    ensureBackendProfile(profile.profileId, {
      accountId: authenticatedAccount.accountId,
      displayName: authenticatedAccount.displayName
    });
  }

  let player;

  if (existingPlayer) {
    const previousSocket = Array.from(room.clients).find(
      (candidate) => candidate.data?.playerId === existingPlayer.id
    );

    if (previousSocket && previousSocket !== socket) {
      room.clients.delete(previousSocket);
      previousSocket.data.roomId = null;
      previousSocket.data.playerId = null;
      previousSocket.close(4001, "Reconnected from another session");
    }

    player = existingPlayer;
    player.sessionId = requestedSessionId ?? player.sessionId ?? null;
    player.connected = true;
    player.name = playerName;
    player.profileStats = profile.stats;
    player.disconnectedAt = null;
    player.reconnectDeadlineAt = null;
    player.slotReserved = false;
    if (requestedTeamId) {
      if (player.teamId !== requestedTeamId) {
        player.homeSpawn = null;
      }
      player.teamId = requestedTeamId;
    }
    if (requestedClassId) {
      player.classId = requestedClassId;
      syncPlayerCombatProfile(player, now);
    }
    if (player.isSpectator) {
      player.queuedForSlot = !requestedSpectator;
      if (
        player.queuedForSlot &&
        hasOpenHumanPlayerSlot(room, now) &&
        (room.match.phase === MATCH_PHASES.WAITING || isResultsPhase(room.match.phase))
      ) {
        promoteSpectatorToActivePlayer(room, player, now);
      }
    }
    ensurePlayerLobbySelections(room, player);
    markPlayerActive(player, now);
  } else {
    const joinAsSpectator =
      requestedSpectator ||
      !hasOpenHumanPlayerSlot(room, now);

    if (joinAsSpectator && !canJoinSpectatorRoom(room)) {
      if (!roomExists && room.players.size === 0 && room.clients.size === 0) {
        deleteRoom(room.id);
      }
      sendJson(socket, {
        type: MESSAGE_TYPES.ERROR,
        message: "Spectator limit reached for this room"
      }, { critical: true });
      return;
    }

    player = createPlayerState(socket.data.playerId, profile.profileId, playerName, profile.stats, {
      isSpectator: joinAsSpectator,
      queuedForSlot: joinAsSpectator && !requestedSpectator,
      autoReady: !joinAsSpectator && (room.match.phase === MATCH_PHASES.WAITING || isWarmupPhase(room.match.phase)),
      room,
      sessionId: requestedSessionId,
      teamId: requestedTeamId ?? getBalancedTeamId(room),
      classId: requestedClassId ?? GAME_CONFIG.lobby.classes[0].id,
      joinedRoomAt: now
    });
    markPlayerActive(player, now);
    room.players.set(player.id, player);
    markRoomPlayerOrderDirty(room);
  }

  socket.data.roomId = roomId;
  socket.data.playerId = player.id;
  socket.data.accountId = authenticatedAccount?.accountId ?? null;
  socket.data.profileId = profile.profileId;
  socket.data.sessionId = player.sessionId ?? requestedSessionId ?? null;
  socket.data.playerName = playerName;
  markSocketForFullSync(socket);
  room.clients.add(socket);
  syncRoomOwner(room);
  syncRoomBots(room, now);
  promoteQueuedSpectators(room, now);
  autoReadyPlayerForImmediateMatch(room, player, now);

  sendJson(socket, {
    type: MESSAGE_TYPES.JOINED,
    playerId: player.id,
    profileId: profile.profileId,
    roomId,
    isSpectator: player.isSpectator,
    queuedForSlot: player.queuedForSlot,
    slotReserved: player.slotReserved,
    gameVersion,
    assetVersion,
    config: GAME_CONFIG,
    profileStats: getPublicProfileStats(player)
  }, { critical: true });

  for (const warning of joinWarnings) {
    sendJson(socket, {
      type: MESSAGE_TYPES.ERROR,
      code: warning.code,
      message: warning.message
    }, { critical: true });
  }

  maybeStartCountdown(room, now);
  console.log(`Player ${playerName} joined room ${roomId}`);
}

function handleReady(socket, payload) {
  const room = rooms.get(socket.data?.roomId);
  const player = room?.players.get(socket.data?.playerId);

  if (!room || !player) {
    return;
  }

  if (player.isSpectator) {
    return;
  }

  const now = Date.now();
  if (room.match.phase !== MATCH_PHASES.WAITING && !isResultsPhase(room.match.phase)) {
    return;
  }

  player.ready = Boolean(payload.ready);
  markPlayerActive(player, now);
  markRoomActive(room, now);

  if (isResultsPhase(room.match.phase)) {
    maybeStartRematch(room, now);
    return;
  }

  syncRoomBots(room, now);
  maybeStartCountdown(room, now);
}

function canPlayerRespawn(room, player, now = Date.now()) {
  return Boolean(
    room &&
    player &&
    !player.isSpectator &&
    !player.alive &&
    Number.isFinite(Number(player.respawnAt)) &&
    now >= Number(player.respawnAt)
  );
}

function respawnPlayer(room, player, now = Date.now()) {
  if (!canPlayerRespawn(room, player, now)) {
    return false;
  }

  const spawn = createSpawnPoint(room, {
    teamId: player.teamId,
    classId: player.classId,
    isBot: player.isBot,
    spawnKey: `${player.id}:${Math.floor(now)}`,
    enforceEnemyBuffer: true,
    minDistanceToPlayers: GAME_CONFIG.spawn.safeRespawnDistance
  });
  player.x = spawn.x;
  player.y = spawn.y;
  player.angle = 0;
  player.turretAngle = 0;
  player.hp = getPlayerMaxHitPoints(player);
  normalizePlayerInventory(player);
  player.alive = true;
  player.respawnAt = 0;
  applyRoomSpawnProtection(room, player, now);
  player.credits += GAME_CONFIG.economy.respawnCredits;
  player.combat = createPlayerCombatState(player, now);
  player.combat.shieldUntil = 0;
  player.combat.shieldRemainingMs = 0;
  player.combat.shielded = false;
  clearCombatContributors(player);
  resetPlayerHistory(player);
  rememberSafePlayerState(player);
  if (player.isBot) {
    resetBotAiState(player, now);
  }
  queueAnimationStateEvent(room, player, ANIMATION_ACTIONS.SPAWN, now);
  queueSpawnStateEvent(room, player, now);
  queueHealthStateEvent(room, player, player.hp, now);
  queueInventoryStateEvent(room, player, now);
  return true;
}

function handleRespawn(socket) {
  const room = rooms.get(socket.data?.roomId);
  const player = room?.players.get(socket.data?.playerId);

  if (!room || !player || player.isBot) {
    return;
  }

  const now = Date.now();
  markPlayerActive(player, now);
  markRoomActive(room, now);
  respawnPlayer(room, player, now);
}

function handleLobby(socket, payload) {
  const room = rooms.get(socket.data?.roomId);
  const player = room?.players.get(socket.data?.playerId);

  if (!room || !player || player.isBot) {
    return;
  }

  const now = Date.now();
  markPlayerActive(player, now);
  markRoomActive(room, now);

  switch (payload.action) {
    case "map":
      if (room.lobby.ownerPlayerId !== player.id) {
        return;
      }

      if (room.match.phase !== MATCH_PHASES.WAITING && !isResultsPhase(room.match.phase)) {
        return;
      }

      room.lobby.mapId = getLobbyMap(payload.mapId).id;
      clearRoomCombatState(room);
      rebuildRoomMapState(room);
      syncRoomBots(room, now);
      return;
    case "team":
      if (!isValidLobbyOptionId(payload.teamId, GAME_CONFIG.lobby.teams)) {
        return;
      }

      if (player.teamId !== payload.teamId) {
        player.homeSpawn = null;
      }
      player.teamId = payload.teamId;
      ensurePlayerLobbySelections(room, player);
      syncRoomBots(room, now);
      return;
    case "class":
      if (!isValidLobbyOptionId(payload.classId, GAME_CONFIG.lobby.classes)) {
        return;
      }

      player.classId = payload.classId;
      syncPlayerCombatProfile(player, now);
      return;
    default:
      return;
  }
}

function handleResync(socket) {
  if (!socket.data?.roomId || !socket.data?.playerId) {
    return;
  }

  markRoomActive(rooms.get(socket.data.roomId), Date.now());
  markSocketForFullSync(socket);
}

function applyGrenadeExplosion(room, attacker, now = Date.now()) {
  if (!room || !attacker || !attacker.alive) {
    return;
  }

  const aimAngle = Number.isFinite(Number(attacker.input?.turretAngle))
    ? normalizeAngle(attacker.input.turretAngle)
    : normalizeAngle(attacker.turretAngle);
  const throwDistance = GAME_CONFIG.basicSpecialization.grenadeRange;
  const explosionRadius = GAME_CONFIG.basicSpecialization.grenadeRadius;
  const explosionCenter = clampTankPosition(
    attacker.x + Math.cos(aimAngle) * throwDistance,
    attacker.y + Math.sin(aimAngle) * throwDistance
  );

  for (const target of room.players.values()) {
    if (!target || !target.alive || target.isSpectator || target.id === attacker.id) {
      continue;
    }

    if (isFriendlyCombatPair(attacker, target) || hasSpawnProtection(target, now) || hasActiveShield(target, now)) {
      continue;
    }

    const hitDistance = explosionRadius + getPlayerTankRadius(target);
    const dx = target.x - explosionCenter.x;
    const dy = target.y - explosionCenter.y;
    if (dx * dx + dy * dy > hitDistance * hitDistance) {
      continue;
    }

    const grenadeBaseDamage =
      target.tankClassId === "basic"
        ? Math.max(
            GAME_CONFIG.basicSpecialization.grenadeDamage,
            Math.round(getPlayerMaxHitPoints(target) * GAME_CONFIG.basicSpecialization.grenadeBasicDamageRatio)
          )
        : GAME_CONFIG.basicSpecialization.grenadeDamage;
    const resolution = resolveCombatHit(room, attacker, target, now, grenadeBaseDamage);
    target.hp = Math.max(0, target.hp - resolution.damage);

    recordDamageContribution(target, attacker.id, resolution.damage, now);
    syncPlayerCombatProfile(target, now);
    target.combat.lastDamagedAt = now;

    queueHealthStateEvent(room, target, -resolution.damage, now);
    queueAnimationStateEvent(room, target, ANIMATION_ACTIONS.HIT, now);
    queueCombatStateEvent(room, {
      serverTime: now,
      action: COMBAT_EVENT_ACTIONS.DAMAGE,
      attackerId: attacker.id,
      attackerName: attacker.name,
      targetId: target.id,
      targetName: target.name,
      damage: resolution.damage,
      hpAfter: target.hp,
      isCritical: resolution.isCritical,
      armorBlocked: resolution.armorBlocked,
      statusEffect: resolution.statusEffect,
      statusDurationMs: resolution.statusDurationMs,
      soundCue: resolution.soundCue,
      vfxCue: resolution.vfxCue,
      message: `${attacker.name} grenaded ${target.name} for ${resolution.damage}`
    });

    if (resolution.statusEffect !== STATUS_EFFECTS.NONE && target.hp > 0) {
      applyStatusEffect(room, attacker, target, resolution, now);
    }

    if (target.hp !== 0) {
      continue;
    }

    const assistContributors = getAssistContributors(room, target, attacker.id, now);
    target.alive = false;
    target.deaths += 1;
    target.respawnAt = isRoomSurvivalMode(room) ? null : now + GAME_CONFIG.respawnDelayMs;
    target.credits += GAME_CONFIG.economy.deathCredits;
    target.combat.stunUntil = 0;
    target.combat.stunRemainingMs = 0;
    target.combat.statusEffect = STATUS_EFFECTS.NONE;
    target.combat.statusDurationMs = 0;
    target.combat.stunned = false;
    target.combat.shieldUntil = 0;
    target.combat.shieldRemainingMs = 0;
    target.combat.shielded = false;
    queueAnimationStateEvent(room, target, ANIMATION_ACTIONS.DEATH, now);
    queueScoreStateEvent(room, target, "death", now);
    queueInventoryStateEvent(room, target, now);
    updateProfileStats(target.profileId, (stats) => {
      stats.deaths += 1;
    });

    attacker.score += 1;
    attacker.credits += GAME_CONFIG.economy.killCredits;
    awardXpToPlayer(attacker, 250 + (target.level ?? 1) * 25, room);
    queueScoreStateEvent(room, attacker, "kill", now);
    queueInventoryStateEvent(room, attacker, now);
    updateProfileStats(attacker.profileId, (stats) => {
      stats.kills += 1;
    });

    queueCombatStateEvent(room, {
      serverTime: now,
      action: COMBAT_EVENT_ACTIONS.KILL,
      attackerId: attacker.id,
      attackerName: attacker.name,
      targetId: target.id,
      targetName: target.name,
      assistantIds: assistContributors.map((entry) => entry.attackerId),
      assistantNames: assistContributors
        .map((entry) => room.players.get(entry.attackerId)?.name ?? null)
        .filter(Boolean),
      damage: resolution.damage,
      hpAfter: target.hp,
      isCritical: resolution.isCritical,
      armorBlocked: resolution.armorBlocked,
      statusEffect: STATUS_EFFECTS.NONE,
      statusDurationMs: 0,
      soundCue: SOUND_CUES.KILL,
      vfxCue: VFX_CUES.KILL_BURST,
      message: `${attacker.name} blasted ${target.name}`
    });

    for (const contribution of assistContributors) {
      const assistant = room.players.get(contribution.attackerId);
      if (!assistant) {
        continue;
      }

      assistant.assists += 1;
      assistant.credits += GAME_CONFIG.combat.assistCredits;
      queueScoreStateEvent(room, assistant, "assist", now);
      queueInventoryStateEvent(room, assistant, now);
      queueCombatStateEvent(room, {
        serverTime: now,
        action: COMBAT_EVENT_ACTIONS.ASSIST,
        attackerId: assistant.id,
        attackerName: assistant.name,
        targetId: target.id,
        targetName: target.name,
        damage: contribution.damage,
        hpAfter: target.hp,
        isCritical: false,
        armorBlocked: 0,
        statusEffect: STATUS_EFFECTS.NONE,
        statusDurationMs: 0,
        soundCue: SOUND_CUES.ASSIST,
        vfxCue: VFX_CUES.ASSIST_RING,
        message: `${assistant.name} assisted against ${target.name}`
      });
    }
  }
}

function handleUpgrade(socket, payload) {
  const room = rooms.get(socket.data?.roomId);
  const player = room?.players.get(socket.data?.playerId);
  if (!room || !player) {
    return;
  }
  const requestedClassId = String(payload.classId ?? "");
  if (!CLASS_TREE[requestedClassId]) {
    return;
  }
  if (!Array.isArray(player.pendingUpgrades) || !player.pendingUpgrades.includes(requestedClassId)) {
    return;
  }
  player.tankClassId = requestedClassId;
  player.pendingUpgrades = [];
  if (requestedClassId !== "basic" && !player.basicSpecializationChoice) {
    player.basicSpecializationPending = false;
  }
}

function handleSpecialization(socket, payload) {
  const room = rooms.get(socket.data?.roomId);
  const player = room?.players.get(socket.data?.playerId);
  if (!room || !player || player.isBot || player.isSpectator) {
    return;
  }

  const now = Date.now();
  markPlayerActive(player, now);
  markRoomActive(room, now);

  if (
    !player.basicSpecializationPending ||
    player.basicSpecializationChoice ||
    player.tankClassId !== "basic" ||
    (player.level ?? 1) < GAME_CONFIG.basicSpecialization.unlockLevel
  ) {
    return;
  }

  const specializationId = String(payload.specializationId ?? "");
  if (
    (specializationId === BASIC_CLASS_SPECIALIZATIONS.SHIELD_BUBBLE ||
      specializationId === BASIC_CLASS_SPECIALIZATIONS.GRENADE) &&
    !player.alive
  ) {
    return;
  }

  const previousMaxHp = getPlayerMaxHitPoints(player);
  player.basicSpecializationPending = false;
  player.basicSpecializationChoice = specializationId;

  if (specializationId === BASIC_CLASS_SPECIALIZATIONS.EXTRA_HP) {
    const nextMaxHp = getPlayerMaxHitPoints(player);
    if (player.alive) {
      player.hp = Math.min(nextMaxHp, Math.max(0, player.hp) + (nextMaxHp - previousMaxHp));
      queueHealthStateEvent(room, player, player.hp, now);
    }
    return;
  }

  if (specializationId === BASIC_CLASS_SPECIALIZATIONS.SHIELD_BUBBLE) {
    activateShieldBubble(player, now);
    syncPlayerCombatProfile(player, now);
    queueCombatStateEvent(room, {
      serverTime: now,
      action: COMBAT_EVENT_ACTIONS.EFFECT,
      attackerId: player.id,
      attackerName: player.name,
      targetId: player.id,
      targetName: player.name,
      damage: 0,
      hpAfter: player.hp,
      isCritical: false,
      armorBlocked: 0,
      statusEffect: STATUS_EFFECTS.NONE,
      statusDurationMs: 0,
      soundCue: SOUND_CUES.ARMOR,
      vfxCue: VFX_CUES.ARMOR_SPARK,
      message: `${player.name} activated a shield bubble`
    });
    return;
  }

  if (specializationId === BASIC_CLASS_SPECIALIZATIONS.GRENADE) {
    applyGrenadeExplosion(room, player, now);
  }
}

function handleStatPoint(socket, payload) {
  const room = rooms.get(socket.data?.roomId);
  const player = room?.players.get(socket.data?.playerId);
  if (!room || !player) {
    return;
  }
  if ((player.statPoints ?? 0) <= 0) {
    return;
  }
  const statName = String(payload.statName ?? "");
  if (!STAT_NAMES.includes(statName)) {
    return;
  }
  const previousMaxHp = getPlayerMaxHitPoints(player);
  player.stats = createAllocatedStats(player.stats);
  const currentVal = player.stats[statName] ?? 0;
  if (currentVal >= 7) {
    return;
  }
  player.stats[statName] = currentVal + 1;
  player.statPoints -= 1;
  if (statName === "maxHealth") {
    const nextMaxHp = getPlayerMaxHitPoints(player);
    player.hp = Math.min(nextMaxHp, Math.max(0, player.hp) + (nextMaxHp - previousMaxHp));
    queueHealthStateEvent(room, player, player.hp, Date.now());
  }
}

function createInputFrame(payload, receivedAt) {
  const clientSentAt = Number(payload.clientSentAt);
  const seq = Number(payload.seq);
  const turretAngle = Number(payload.turretAngle);

  if (!Number.isInteger(seq)) {
    return null;
  }

  if (!Number.isFinite(clientSentAt)) {
    return null;
  }

  if (
    clientSentAt < receivedAt - GAME_CONFIG.input.maxClientInputAgeMs ||
    clientSentAt > receivedAt + GAME_CONFIG.input.maxClientInputLeadMs
  ) {
    return null;
  }

  return {
    seq,
    clientSentAt,
    receivedAt,
    forward: Boolean(payload.forward),
    back: Boolean(payload.back),
    left: Boolean(payload.left),
    right: Boolean(payload.right),
    shoot: Boolean(payload.shoot),
    turretAngle: Number.isFinite(turretAngle) ? normalizeAngle(turretAngle) : 0
  };
}

function capturePlayerInputState(player) {
  return {
    seq: player.input.seq,
    clientSentAt: player.input.clientSentAt,
    receivedAt: player.input.receivedAt,
    forward: player.input.forward,
    back: player.input.back,
    left: player.input.left,
    right: player.input.right,
    shoot: player.input.shoot,
    turretAngle: player.input.turretAngle
  };
}

function applyInputFrameToPlayer(player, nextInput, tickNumber) {
  player.input.seq = nextInput.seq;
  player.input.clientSentAt = nextInput.clientSentAt;
  player.input.receivedAt = nextInput.receivedAt;
  player.input.forward = nextInput.forward;
  player.input.back = nextInput.back;
  player.input.left = nextInput.left;
  player.input.right = nextInput.right;
  player.input.shoot = nextInput.shoot;
  player.input.turretAngle = nextInput.turretAngle;

  player.lastProcessedInputSeq = nextInput.seq;
  player.lastProcessedInputTick = Math.max(0, Number(tickNumber) || 0);
  player.lastProcessedInputClientSentAt = nextInput.clientSentAt;
}

function applyPendingInputs(player, tickNumber, tickStartedAt, tickEndedAt) {
  const safeTickStartedAt = Number.isFinite(tickStartedAt) ? tickStartedAt : tickEndedAt;
  const safeTickEndedAt = Number.isFinite(tickEndedAt) ? Math.max(safeTickStartedAt, tickEndedAt) : safeTickStartedAt;
  const inputSegments = [];
  let activeInput = capturePlayerInputState(player);
  let segmentStartedAt = safeTickStartedAt;

  while (player.pendingInputs.length > 0) {
    const nextInput = player.pendingInputs[0];

    if (nextInput.seq <= player.lastProcessedInputSeq) {
      player.pendingInputs.shift();
      continue;
    }

    if (Number.isFinite(nextInput.receivedAt) && nextInput.receivedAt > safeTickEndedAt) {
      break;
    }

    player.pendingInputs.shift();
    const segmentEndedAt = clamp(
      Number.isFinite(nextInput.receivedAt) ? nextInput.receivedAt : safeTickEndedAt,
      safeTickStartedAt,
      safeTickEndedAt
    );

    if (segmentEndedAt > segmentStartedAt) {
      inputSegments.push({
        input: activeInput,
        deltaSeconds: (segmentEndedAt - segmentStartedAt) / 1000,
        endsAt: segmentEndedAt
      });
    }

    applyInputFrameToPlayer(player, nextInput, tickNumber);
    activeInput = capturePlayerInputState(player);
    segmentStartedAt = segmentEndedAt;
  }

  const finalSegmentSeconds = Math.max(0, safeTickEndedAt - segmentStartedAt) / 1000;
  if (finalSegmentSeconds > 0 || inputSegments.length === 0) {
    inputSegments.push({
      input: activeInput,
      deltaSeconds: finalSegmentSeconds,
      endsAt: safeTickEndedAt
    });
  }

  return inputSegments;
}

function handleInput(socket, payload, now) {
  const roomId = socket.data?.roomId;
  const playerId = socket.data?.playerId;

  if (!roomId || !playerId) {
    return;
  }

  const room = rooms.get(roomId);
  const player = room?.players.get(playerId);
  if (!room || !player) {
    return;
  }

  if (player.isSpectator) {
    return;
  }

  markRoomActive(room, now);
  autoReadyPlayerForImmediateMatch(room, player, now);

  const bucket = socket.data.inputBucket;
  if (isAntiCheatEnabled() && !consumeRateBucket(bucket, now, GAME_CONFIG.antiCheat.maxInputsPerSecond)) {
    sendJson(socket, {
      type: MESSAGE_TYPES.ERROR,
      code: "input_rate_limit",
      message: "Input rate limit exceeded"
    }, { critical: true });
    recordAntiCheatViolation(room, player, "input_rate_limit", "Input rate limit exceeded", now, 1);
    return;
  }

  const nextInput = createInputFrame(payload, now);
  if (!nextInput) {
    recordAntiCheatViolation(room, player, "invalid_input", "Server rejected a malformed input frame", now, 1);
    return;
  }

  if (nextInput.seq - player.lastReceivedInputSeq > GAME_CONFIG.antiCheat.maxInputSequenceJump) {
    recordAntiCheatViolation(room, player, "input_sequence_jump", "Server rejected an impossible input sequence jump", now, 1);
    return;
  }

  if (nextInput.seq <= player.lastReceivedInputSeq) {
    const antiCheatState = player.antiCheat;
    if (now - antiCheatState.duplicateInputWindowStartedAt >= 1000) {
      antiCheatState.duplicateInputWindowStartedAt = now;
      antiCheatState.duplicateInputCount = 0;
    }

    antiCheatState.duplicateInputCount += 1;
    if (antiCheatState.duplicateInputCount > GAME_CONFIG.antiCheat.maxDuplicateInputsPerSecond) {
      recordAntiCheatViolation(room, player, "duplicate_input", "Server rejected repeated duplicate inputs", now, 1);
    }
    return;
  }

  player.lastReceivedInputSeq = nextInput.seq;
  player.lastReceivedInputClientSentAt = nextInput.clientSentAt;
  player.pendingInputs.push(nextInput);

  const changedTurret = Math.abs(normalizeAngle(nextInput.turretAngle - player.input.turretAngle)) > 0.08;
  if (
    nextInput.forward ||
    nextInput.back ||
    nextInput.left ||
    nextInput.right ||
    nextInput.shoot ||
    changedTurret
  ) {
    markPlayerActive(player, now);
  }

  if (player.pendingInputs.length > GAME_CONFIG.input.maxBufferedInputs) {
    player.pendingInputs.splice(0, player.pendingInputs.length - GAME_CONFIG.input.maxBufferedInputs);
  }
}

function canSimulatePlayer(room, player) {
  return isMovementPhase(room.match.phase) && !player.isSpectator;
}

function isEnemyBotTarget(player, candidate, now = Date.now()) {
  return (
    candidate &&
    candidate.id !== player.id &&
    candidate.connected &&
    candidate.alive &&
    !hasSpawnProtection(candidate, now) &&
    isActiveParticipant(candidate) &&
    candidate.teamId !== player.teamId
  );
}

function getBotThreatScore(player, candidateId, now) {
  const threat = (player.combat?.recentAttackers ?? []).find((entry) => entry.attackerId === candidateId);
  if (!threat) {
    return 0;
  }

  const ageRatio = clamp(
    1 - Math.max(0, now - Number(threat.time ?? 0)) / GAME_CONFIG.combat.assistWindowMs,
    0,
    1
  );
  return ageRatio * (180 + Math.min(260, threat.damage * 9));
}

function canBotSenseTarget(room, player, candidate, now) {
  if (!isEnemyBotTarget(player, candidate, now)) {
    return false;
  }

  if (getBotThreatScore(player, candidate.id, now) > 0) {
    return true;
  }

  const awarenessRange = getBotAwarenessRange(player);
  if (canViewerSeePosition(room, player, candidate.x, candidate.y, getPlayerTankRadius(candidate), awarenessRange)) {
    return true;
  }

  const objectiveZone = getObjectiveZoneForPlayer(room, candidate);
  if (objectiveZone && (objectiveZone.ownerTeamId !== player.teamId || isObjectiveZoneHot(objectiveZone))) {
    return Math.hypot(candidate.x - player.x, candidate.y - player.y) <= awarenessRange * 1.08;
  }

  return (
    candidate.id === player.ai?.pursuitTargetId &&
    now <= (Number(player.ai?.pursuitUntil ?? 0) || 0)
  );
}

function scoreBotTarget(room, player, candidate, now) {
  const shootRange = getBotShootRange(player);
  const preferredRange = getBotPreferredRange(player);
  const distance = Math.hypot(candidate.x - player.x, candidate.y - player.y);
  const hasLineOfSight = !segmentHitsBotBlocker(
    room,
    player.x,
    player.y,
    candidate.x,
    candidate.y,
    GAME_CONFIG.bullet.radius,
    getRoomMapLayout(room)
  );
  const missingHp = Math.max(0, getPlayerMaxHitPoints(candidate) - (Number(candidate.hp ?? 0) || 0));
  let score = Math.max(0, shootRange * 1.85 - distance);
  score += hasLineOfSight ? 320 : -40;
  score += missingHp * 4.5;
  if (distance >= preferredRange * 0.75 && distance <= shootRange * 0.95) {
    score += 120;
  }
  if ((Number(candidate.hp ?? 0) || 0) <= Math.max(35, getPlayerMaxHitPoints(candidate) * 0.28)) {
    score += 180;
  }
  score += getBotThreatScore(player, candidate.id, now);

  const objectiveZone = getObjectiveZoneForPlayer(room, candidate);
  if (objectiveZone && (objectiveZone.ownerTeamId !== candidate.teamId || isObjectiveZoneHot(objectiveZone))) {
    score += 220;
  }

  if (
    candidate.id === player.ai?.pursuitTargetId &&
    now <= (Number(player.ai?.pursuitUntil ?? 0) || 0)
  ) {
    score += 110;
  }

  if (candidate.id === player.ai?.targetId) {
    score += GAME_CONFIG.ai.targetSwitchScoreBias;
  }

  return score;
}

function selectBotTarget(room, player, now) {
  const scoredCandidates = getPlayersInSimulationOrder(room)
    .filter((candidate) => canBotSenseTarget(room, player, candidate, now))
    .map((candidate) => ({
      candidate,
      score: scoreBotTarget(room, player, candidate, now)
    }))
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      return scoreDelta || comparePlayersInSimulationOrder(left.candidate, right.candidate);
    });

  const best = scoredCandidates[0] ?? null;
  const current = scoredCandidates.find((entry) => entry.candidate.id === player.ai?.targetId) ?? null;
  let selected = best;

  if (current) {
    const lockActive = now <= (Number(player.ai?.targetLockUntil ?? 0) || 0);
    const switchThreshold = BOT_AI_TARGET_SWITCH_SCORE + (lockActive ? 80 : 0);
    if (!best || best.score - current.score < switchThreshold) {
      selected = current;
    }
  }

  if (!selected) {
    player.ai.targetLockUntil = 0;
    return null;
  }

  player.ai.targetLockUntil = now + BOT_AI_TARGET_LOCK_MS;
  return selected.candidate;
}

function hasLivingEnemyHuman(room, player, now) {
  return getPlayersInSimulationOrder(room).some(
    (candidate) =>
      candidate &&
      !candidate.isBot &&
      isEnemyBotTarget(player, candidate, now)
  );
}

function scoreBotShapeTarget(room, player, shape) {
  const distance = Math.hypot(shape.x - player.x, shape.y - player.y);
  const hasLineOfSight = !segmentHitsBotBlocker(
    room,
    player.x,
    player.y,
    shape.x,
    shape.y,
    shape.radius * 0.25,
    getRoomMapLayout(room),
    { excludeShapeId: shape.id }
  );
  let score = Math.max(0, 900 - distance);
  score += (SHAPE_XP[shape.type] ?? 10) * 4;
  score += hasLineOfSight ? 180 : 0;
  score += shape.type === SHAPE_TYPES.ALPHA_PENTAGON ? 850 : shape.type === SHAPE_TYPES.PENTAGON ? 180 : 0;
  if (shape.id === player.ai?.targetId) {
    score += GAME_CONFIG.ai.targetSwitchScoreBias;
  }
  return score;
}

function selectBotShapeTarget(room, player) {
  return Array.from(room.shapes.values())
    .sort((left, right) => scoreBotShapeTarget(room, player, right) - scoreBotShapeTarget(room, player, left))[0] ?? null;
}

function chooseBotGoalCandidate(room, player, target, candidates, options = {}) {
  const { preferCover = false, desiredSpacing = null } = options;
  const mapLayout = getRoomMapLayout(room);
  const tankRadius = getPlayerTankRadius(player);
  const targetShapeId = target && room.shapes.has(target.id) ? target.id : null;
  return candidates
    .filter((candidate) => candidate && isBotNavigableWorldPoint(room, candidate.x, candidate.y, tankRadius, mapLayout))
    .map((candidate) => {
      const hasLineToTarget =
        target &&
        !segmentHitsBotBlocker(
          room,
          candidate.x,
          candidate.y,
          target.x,
          target.y,
          GAME_CONFIG.bullet.radius,
          mapLayout,
          { excludeShapeId: targetShapeId }
        );
      const lineToTargetScore = target
        ? preferCover
          ? (hasLineToTarget ? -260 : 460)
          : (hasLineToTarget ? 400 : 40)
        : 0;
      const directTravelScore = canBotNavigateDirectly(room, player, candidate, tankRadius + 4, mapLayout) ? 180 : 0;
      const spacingPenalty =
        target && Number.isFinite(desiredSpacing)
          ? Math.abs(Math.hypot(candidate.x - target.x, candidate.y - target.y) - desiredSpacing) *
            (preferCover ? 0.95 : 1.2)
          : 0;
      return {
        candidate,
        score:
          lineToTargetScore +
          directTravelScore -
          spacingPenalty -
          Math.round(distanceSquaredBetweenPoints(candidate, player) / 150)
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.candidate ?? null;
}

function getBotCoverCandidates(room, player, target) {
  if (!target) {
    return [];
  }

  const mapLayout = getRoomMapLayout(room);
  const maxDistance = Math.max(GAME_CONFIG.ai.coverSearchDistance, GAME_CONFIG.ai.retreatDistance * 1.7);
  return getNavigationGraphForRoom(room).nodes
    .filter((node) => Math.hypot(node.x - player.x, node.y - player.y) <= maxDistance)
    .filter((node) => segmentHitsBotBlocker(room, node.x, node.y, target.x, target.y, GAME_CONFIG.bullet.radius, mapLayout))
    .map((node) => ({ x: node.x, y: node.y }));
}

function findBotRetreatGoal(room, player, target, preferredRange = getBotPreferredRange(player)) {
  if (!target) {
    return null;
  }

  const awayAngle = Math.atan2(player.y - target.y, player.x - target.x);
  const distances = [GAME_CONFIG.ai.retreatDistance, GAME_CONFIG.ai.retreatDistance * 0.75];
  const angleOffsets = [0, 0.45, -0.45, 0.9, -0.9];
  const candidates = [...getBotCoverCandidates(room, player, target)];

  for (const distance of distances) {
    for (const offset of angleOffsets) {
      const clamped = clampTankPosition(
        player.x + Math.cos(awayAngle + offset) * distance,
        player.y + Math.sin(awayAngle + offset) * distance
      );
      candidates.push(clamped);
    }
  }

  return chooseBotGoalCandidate(room, player, target, candidates, {
    preferCover: true,
    desiredSpacing: preferredRange * 1.15
  });
}

function findBotFlankGoal(room, player, target, preferredRange = getBotPreferredRange(player)) {
  if (!target) {
    return null;
  }

  const attackAngle = Math.atan2(target.y - player.y, target.x - player.x);
  const desiredSpacing = preferredRange * 0.92;
  const candidates = [];

  for (const side of [-1, 1]) {
    const flankAngle = attackAngle + side * Math.PI * 0.5;
    const clamped = clampTankPosition(
      target.x - Math.cos(attackAngle) * desiredSpacing + Math.cos(flankAngle) * GAME_CONFIG.ai.flankDistance,
      target.y - Math.sin(attackAngle) * desiredSpacing + Math.sin(flankAngle) * GAME_CONFIG.ai.flankDistance
    );
    candidates.push(clamped);
  }

  candidates.push(
    clampTankPosition(
      player.x + Math.cos(attackAngle) * GAME_CONFIG.ai.flankDistance,
      player.y + Math.sin(attackAngle) * GAME_CONFIG.ai.flankDistance
    )
  );

  return chooseBotGoalCandidate(room, player, target, candidates, {
    desiredSpacing
  });
}

function findBotStrafeGoal(room, player, target, preferredRange = getBotPreferredRange(player)) {
  if (!target) {
    return null;
  }

  const attackAngle = Math.atan2(target.y - player.y, target.x - player.x);
  const strafeDirection = player.ai?.strafeDirection ?? 1;
  const currentDistance = Math.hypot(target.x - player.x, target.y - player.y);
  const desiredDistance = clamp(
    currentDistance,
    preferredRange - GAME_CONFIG.ai.preferredRangeTolerance,
    preferredRange + GAME_CONFIG.ai.preferredRangeTolerance
  );
  const strafeAngle = attackAngle + strafeDirection * Math.PI * 0.5;
  const lateralOffsets = [GAME_CONFIG.ai.flankDistance * 0.4, GAME_CONFIG.ai.flankDistance * 0.7];
  const candidates = [{ x: player.x, y: player.y }];

  for (const offset of lateralOffsets) {
    candidates.push(
      clampTankPosition(
        target.x - Math.cos(attackAngle) * desiredDistance + Math.cos(strafeAngle) * offset,
        target.y - Math.sin(attackAngle) * desiredDistance + Math.sin(strafeAngle) * offset
      )
    );
    candidates.push(
      clampTankPosition(
        player.x + Math.cos(strafeAngle) * offset,
        player.y + Math.sin(strafeAngle) * offset
      )
    );
  }

  return chooseBotGoalCandidate(room, player, target, candidates, {
    desiredSpacing: preferredRange
  });
}

function clearBotCombatAnchor(player) {
  const ai = player?.ai;
  if (!ai) {
    return;
  }

  ai.anchorX = null;
  ai.anchorY = null;
  ai.anchorTargetId = null;
  ai.anchorUntil = 0;
}

function getBotCombatAnchor(room, player, target, now, options = {}) {
  const ai = player?.ai;
  if (!ai || !target) {
    return null;
  }

  if (
    ai.anchorTargetId === target.id &&
    now <= (Number(ai.anchorUntil ?? 0) || 0) &&
    isFiniteWorldPoint(ai.anchorX, ai.anchorY) &&
    isBotNavigableWorldPoint(room, ai.anchorX, ai.anchorY, getPlayerTankRadius(player), getRoomMapLayout(room))
  ) {
    return {
      x: ai.anchorX,
      y: ai.anchorY
    };
  }

  const preferredRange = options.preferredRange ?? getBotPreferredRange(player);
  const currentDistance = Math.hypot(target.x - player.x, target.y - player.y);
  const lowerRangeBound = preferredRange - GAME_CONFIG.ai.preferredRangeTolerance * 0.65;
  const upperRangeBound = preferredRange + GAME_CONFIG.ai.preferredRangeTolerance;
  let nextAnchor = null;

  if (
    options.hasLineOfSight &&
    !options.shouldRetreat &&
    !options.bulletThreat &&
    currentDistance >= lowerRangeBound &&
    currentDistance <= upperRangeBound
  ) {
    nextAnchor = { x: player.x, y: player.y };
  } else {
    nextAnchor =
      findBotStrafeGoal(room, player, target, preferredRange) ??
      findBotFlankGoal(room, player, target, preferredRange) ??
      { x: player.x, y: player.y };
  }

  ai.anchorX = nextAnchor.x;
  ai.anchorY = nextAnchor.y;
  ai.anchorTargetId = target.id ?? null;
  ai.anchorUntil = now + BOT_AI_ANCHOR_HOLD_MS;
  return nextAnchor;
}

function chooseBotIntentAndGoal(room, player, target, targetDistance, hasLineOfSight, options = {}) {
  const soloBotDuel = isSoloBotDuelRoom(room);
  const objectivePlayEnabled = !soloBotDuel;
  const objectiveGoalZone = objectivePlayEnabled ? getObjectiveGoalZone(room, player.teamId, player) : null;
  const advancedCombat = Boolean(options.advancedCombat);
  const preferredRange = options.preferredRange ?? getBotPreferredRange(player);
  const shootRange = options.shootRange ?? getBotShootRange(player);
  if (!target) {
    clearBotCombatAnchor(player);
  }
  const lowerRangeBound = preferredRange - GAME_CONFIG.ai.preferredRangeTolerance;
  const upperRangeBound = preferredRange + GAME_CONFIG.ai.preferredRangeTolerance;
  const shouldRetreat =
    target &&
    (
      Boolean(options.shouldRetreat) ||
      getBotHealthRatio(player) <= (advancedCombat ? GAME_CONFIG.ai.lowHealthRetreatRatio : GAME_CONFIG.ai.lowHealthRetreatRatio * 0.8)
    );
  const shouldCaptureObjective =
    Boolean(objectiveGoalZone) &&
    (!target || targetDistance > upperRangeBound * 1.35);

  if (target && shouldRetreat) {
    return {
      intent: BOT_AI_INTENTS.RETREAT,
      goal: findBotRetreatGoal(room, player, target, preferredRange) ?? player.homeSpawn ?? { x: player.x, y: player.y }
    };
  }

  if (target && !hasLineOfSight) {
    return {
      intent: BOT_AI_INTENTS.REPOSITION,
      goal:
        findBotFlankGoal(room, player, target, preferredRange) ??
        findBotRetreatGoal(room, player, target, preferredRange) ??
        { x: target.x, y: target.y }
    };
  }

  if (target && targetDistance < lowerRangeBound) {
    return {
      intent: BOT_AI_INTENTS.RETREAT,
      goal: findBotRetreatGoal(room, player, target, preferredRange) ?? { x: player.x, y: player.y }
    };
  }

  if (target && options.bulletThreat && targetDistance <= shootRange) {
    return {
      intent: BOT_AI_INTENTS.REPOSITION,
      goal:
        findBotStrafeGoal(room, player, target, preferredRange) ??
        findBotFlankGoal(room, player, target, preferredRange) ??
        { x: target.x, y: target.y }
    };
  }

  if (target && hasLineOfSight && targetDistance <= upperRangeBound) {
    return {
      intent: BOT_AI_INTENTS.ENGAGE,
      goal: advancedCombat
        ? (
            getBotCombatAnchor(room, player, target, options.now ?? Date.now(), {
              preferredRange,
              shootRange,
              hasLineOfSight,
              bulletThreat: options.bulletThreat,
              shouldRetreat
            }) ?? { x: player.x, y: player.y }
          )
        : { x: target.x, y: target.y }
    };
  }

  if (target && targetDistance > (soloBotDuel ? shootRange * 0.9 : upperRangeBound)) {
    return {
      intent: BOT_AI_INTENTS.ENGAGE,
      goal: { x: target.x, y: target.y }
    };
  }

  if (shouldCaptureObjective) {
    return {
      intent: BOT_AI_INTENTS.CAPTURE,
      goal: { x: objectiveGoalZone.x, y: objectiveGoalZone.y }
    };
  }

  if (target) {
    return {
      intent: BOT_AI_INTENTS.ENGAGE,
      goal: advancedCombat
        ? (
            getBotCombatAnchor(room, player, target, options.now ?? Date.now(), {
              preferredRange,
              shootRange,
              hasLineOfSight,
              bulletThreat: options.bulletThreat,
              shouldRetreat
            }) ??
            (soloBotDuel && hasLineOfSight ? { x: player.x, y: player.y } : { x: target.x, y: target.y })
          )
        : { x: target.x, y: target.y }
    };
  }

  return {
    intent: BOT_AI_INTENTS.IDLE,
    goal: objectivePlayEnabled
      ? objectiveGoalZone
        ? { x: objectiveGoalZone.x, y: objectiveGoalZone.y }
        : { x: room.objective.x, y: room.objective.y }
      : { x: player.x, y: player.y }
  };
}

function selectBotBulletThreat(room, player) {
  const lookaheadSeconds = GAME_CONFIG.ai.dodgeLookaheadMs / 1000;
  const dangerRadiusBase = getPlayerTankRadius(player) + GAME_CONFIG.ai.dodgeRadius;
  let bestThreat = null;

  for (const bullet of room.bullets.values()) {
    if (!bullet || bullet.ownerId === player.id) {
      continue;
    }

    const attacker = room.players.get(bullet.ownerId) ?? null;
    if (isFriendlyCombatPair(attacker, player)) {
      continue;
    }

    const directionX = Math.cos(bullet.angle);
    const directionY = Math.sin(bullet.angle);
    const bulletSpeed = bullet.speed ?? GAME_CONFIG.bullet.speed;
    const futureX = bullet.x + directionX * bulletSpeed * lookaheadSeconds;
    const futureY = bullet.y + directionY * bulletSpeed * lookaheadSeconds;
    const dangerRadius = dangerRadiusBase + (bullet.radius ?? GAME_CONFIG.bullet.radius);
    const distanceSquared = distanceSquaredToSegment(bullet.x, bullet.y, futureX, futureY, player.x, player.y);

    if (distanceSquared > dangerRadius * dangerRadius) {
      continue;
    }

    const relativeX = player.x - bullet.x;
    const relativeY = player.y - bullet.y;
    const alongPathDistance = relativeX * directionX + relativeY * directionY;
    if (alongPathDistance < -dangerRadius || alongPathDistance > bulletSpeed * lookaheadSeconds + dangerRadius) {
      continue;
    }

    const lateralDistance = Math.sqrt(distanceSquared);
    const urgency = clamp(1 - lateralDistance / dangerRadius, 0.12, 1);
    const cross = directionX * relativeY - directionY * relativeX;
    const sideSign = cross >= 0 ? 1 : -1;
    const lateralVector = normalizeVector(-directionY * sideSign, directionX * sideSign);
    const awayVector = normalizeVector(relativeX, relativeY);
    const dodgeVector = normalizeVector(
      lateralVector.x * 0.78 + awayVector.x * 0.35,
      lateralVector.y * 0.78 + awayVector.y * 0.35
    );
    const threat = {
      urgency,
      timeToImpactMs: clamp(
        (alongPathDistance / Math.max(1, bulletSpeed)) * 1000,
        0,
        GAME_CONFIG.ai.dodgeLookaheadMs
      ),
      vector: dodgeVector
    };

    if (
      !bestThreat ||
      threat.urgency > bestThreat.urgency ||
      (threat.urgency === bestThreat.urgency && threat.timeToImpactMs < bestThreat.timeToImpactMs)
    ) {
      bestThreat = threat;
    }
  }

  return bestThreat;
}

function estimateTargetVelocity(target, now) {
  if (!target?.stateHistory) {
    return { x: 0, y: 0, speed: 0 };
  }

  const currentSample = sampleHistoricalPlayerState(target, now, now) ?? createPlayerHistorySample(target, now);
  const previousSample = sampleHistoricalPlayerState(target, now - BOT_AI_AIM_SAMPLE_MS, now);
  if (!previousSample || currentSample.time <= previousSample.time) {
    return { x: 0, y: 0, speed: 0 };
  }

  const deltaSeconds = Math.max(0.001, (currentSample.time - previousSample.time) / 1000);
  const velocityX = (currentSample.x - previousSample.x) / deltaSeconds;
  const velocityY = (currentSample.y - previousSample.y) / deltaSeconds;
  return {
    x: velocityX,
    y: velocityY,
    speed: Math.hypot(velocityX, velocityY)
  };
}

function solveInterceptPoint(origin, projectileSpeed, targetPosition, targetVelocity, maxLeadSeconds = BOT_AI_MAX_LEAD_SECONDS) {
  if (!origin || !targetPosition || !Number.isFinite(projectileSpeed) || projectileSpeed <= 0) {
    return null;
  }

  const relativeX = targetPosition.x - origin.x;
  const relativeY = targetPosition.y - origin.y;
  const velocityX = targetVelocity?.x ?? 0;
  const velocityY = targetVelocity?.y ?? 0;
  const speedSquared = projectileSpeed * projectileSpeed;
  const velocitySquared = velocityX * velocityX + velocityY * velocityY;
  const a = velocitySquared - speedSquared;
  const b = 2 * (relativeX * velocityX + relativeY * velocityY);
  const c = relativeX * relativeX + relativeY * relativeY;
  let interceptTime = null;

  if (Math.abs(a) < 0.0001) {
    if (Math.abs(b) < 0.0001) {
      interceptTime = 0;
    } else {
      interceptTime = -c / b;
    }
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const timeA = (-b - root) / (2 * a);
      const timeB = (-b + root) / (2 * a);
      const positiveTimes = [timeA, timeB].filter((value) => value >= 0);
      if (positiveTimes.length > 0) {
        interceptTime = Math.min(...positiveTimes);
      }
    }
  }

  if (!Number.isFinite(interceptTime) || interceptTime === null) {
    return null;
  }

  interceptTime = clamp(interceptTime, 0, maxLeadSeconds);
  return {
    x: targetPosition.x + velocityX * interceptTime,
    y: targetPosition.y + velocityY * interceptTime,
    time: interceptTime
  };
}

function getBotAimPoint(player, target, now, options = {}) {
  if (!target) {
    return null;
  }

  if (target.remembered || !Array.isArray(target.stateHistory) || target.stateHistory.length < 2) {
    return { x: target.x, y: target.y };
  }

  const projectileSpeed = getBotProjectileSpeed(player);
  const targetVelocity = estimateTargetVelocity(target, now);
  if (targetVelocity.speed <= 18) {
    return { x: target.x, y: target.y };
  }

  const shootRange = options.shootRange ?? getBotShootRange(player);
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  const leadStrength = clamp(distance / Math.max(1, shootRange), 0.35, 1);
  const interceptPoint = solveInterceptPoint(
    { x: player.x, y: player.y },
    projectileSpeed,
    { x: target.x, y: target.y },
    targetVelocity,
    BOT_AI_MAX_LEAD_SECONDS
  );

  if (!interceptPoint) {
    return { x: target.x, y: target.y };
  }

  return clampTankPosition(
    target.x + (interceptPoint.x - target.x) * leadStrength,
    target.y + (interceptPoint.y - target.y) * leadStrength
  );
}

function getBotSeparationVector(room, player) {
  let totalX = 0;
  let totalY = 0;

  for (const other of getPlayersInSimulationOrder(room)) {
    if (
      !other ||
      other.id === player.id ||
      !other.alive ||
      !other.connected ||
      other.isSpectator
    ) {
      continue;
    }

    const deltaX = player.x - other.x;
    const deltaY = player.y - other.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 0 || distance > GAME_CONFIG.ai.personalSpaceDistance) {
      continue;
    }

    const push = normalizeVector(deltaX, deltaY);
    const weight = clamp(1 - distance / GAME_CONFIG.ai.personalSpaceDistance, 0.05, 1);
    const threatWeight = other.teamId === player.teamId ? 0.8 : 1.1;
    totalX += push.x * weight * threatWeight;
    totalY += push.y * weight * threatWeight;
  }

  return normalizeVector(totalX, totalY);
}

function buildBotSteeringVector(room, player, navigationTarget, enemyTarget, options = {}) {
  const preferredRange = options.preferredRange ?? getBotPreferredRange(player);
  const shootRange = options.shootRange ?? getBotShootRange(player);
  const rangeTolerance = GAME_CONFIG.ai.preferredRangeTolerance;
  const holdPosition = Boolean(options.holdPosition);
  const strafeWeight = options.soloBotDuel
    ? GAME_CONFIG.ai.strafeWeight * 0.55
    : options.advancedCombat
      ? GAME_CONFIG.ai.strafeWeight
      : GAME_CONFIG.ai.strafeWeight * 0.45;
  const baseVector = normalizeVector(
    (navigationTarget?.x ?? player.x) - player.x,
    (navigationTarget?.y ?? player.y) - player.y
  );
  let totalX = baseVector.x;
  let totalY = baseVector.y;

  if (enemyTarget) {
    const toTarget = normalizeVector(enemyTarget.x - player.x, enemyTarget.y - player.y);
    if (toTarget.magnitude > 0) {
      const distance = options.targetDistance ?? Math.hypot(enemyTarget.x - player.x, enemyTarget.y - player.y);
      const shouldRetreat = Boolean(options.shouldRetreat);
      const shouldStrafe =
        Boolean(options.hasLineOfSight) &&
        distance <= shootRange * 1.05 &&
        !shouldRetreat &&
        (!holdPosition || options.bulletThreat || (Number(player.ai?.evasiveUntil ?? 0) || 0) > options.now);

      if (shouldRetreat || distance < preferredRange - rangeTolerance) {
        const retreatWeight = shouldRetreat
          ? 1.25
          : clamp((preferredRange - distance) / Math.max(1, preferredRange), 0.18, 1);
        totalX -= toTarget.x * retreatWeight;
        totalY -= toTarget.y * retreatWeight;
      } else if (distance > preferredRange + rangeTolerance && (!options.hasLineOfSight || distance > shootRange * 0.92)) {
        const closeWeight = clamp((distance - preferredRange) / Math.max(1, preferredRange), 0.12, 1.1);
        totalX += toTarget.x * closeWeight;
        totalY += toTarget.y * closeWeight;
      } else if (options.hasLineOfSight) {
        totalX *= 0.45;
        totalY *= 0.45;
      }

      if (shouldStrafe) {
        const rangeOffset = Math.abs(distance - preferredRange);
        const effectiveStrafeWeight =
          rangeOffset <= rangeTolerance * 0.45
            ? strafeWeight * 0.72
            : strafeWeight;
        totalX += -toTarget.y * (player.ai?.strafeDirection ?? 1) * effectiveStrafeWeight;
        totalY += toTarget.x * (player.ai?.strafeDirection ?? 1) * effectiveStrafeWeight;
      }
    }
  }

  if (options.bulletThreat) {
    totalX += options.bulletThreat.vector.x * (GAME_CONFIG.ai.dodgeWeight * options.bulletThreat.urgency);
    totalY += options.bulletThreat.vector.y * (GAME_CONFIG.ai.dodgeWeight * options.bulletThreat.urgency);
  } else if (
    !options.soloBotDuel &&
    options.advancedCombat &&
    (Number(player.ai?.evasiveUntil ?? 0) || 0) > options.now &&
    enemyTarget
  ) {
    const toTarget = normalizeVector(enemyTarget.x - player.x, enemyTarget.y - player.y);
    totalX += -toTarget.y * (player.ai?.strafeDirection ?? 1) * (strafeWeight * 0.75);
    totalY += toTarget.x * (player.ai?.strafeDirection ?? 1) * (strafeWeight * 0.75);
  }

  const separationVector = getBotSeparationVector(room, player);
  totalX += separationVector.x * GAME_CONFIG.ai.personalSpaceWeight;
  totalY += separationVector.y * GAME_CONFIG.ai.personalSpaceWeight;

  const steering = normalizeVector(totalX, totalY);
  return steering.magnitude > 0 ? steering : baseVector;
}

function updateBotRoute(player, goal, now, options = {}) {
  const { forceReplan = false } = options;
  const ai = player.ai;
  const room = options.room ?? null;
  const mapLayout = getRoomMapLayout(room);
  const navigationGraph = room ? getNavigationGraphForRoom(room) : defaultNavigationGraph;

  if (!ai || !goal || !isFiniteWorldPoint(goal.x, goal.y)) {
    if (ai) {
      ai.goalX = null;
      ai.goalY = null;
      clearBotRoute(ai);
    }
    return null;
  }

  const goalChanged =
    ai.goalX === null ||
    ai.goalY === null ||
    Math.hypot(goal.x - ai.goalX, goal.y - ai.goalY) >= GAME_CONFIG.ai.repathGoalThreshold;
  const waypoint = ai.route[ai.pathIndex] ?? null;
  const waypointInvalid =
    waypoint && !isBotNavigableWorldPoint(room, waypoint.x, waypoint.y, getPlayerTankRadius(player) + 2, mapLayout);
  const routeExpired = now - ai.lastPlanAt >= GAME_CONFIG.ai.repathIntervalMs;

  if (forceReplan || goalChanged || waypointInvalid || routeExpired || ai.stuck) {
    ai.goalX = goal.x;
    ai.goalY = goal.y;
    ai.route = findNavigationRoute(player, goal, navigationGraph, mapLayout);
    ai.pathIndex = 0;
    ai.routeVersion += 1;
    ai.lastPlanAt = now;
    syncBotRouteState(ai);
  }

  while (ai.route[ai.pathIndex]) {
    const currentWaypoint = ai.route[ai.pathIndex];
    const distanceToWaypoint = Math.hypot(currentWaypoint.x - player.x, currentWaypoint.y - player.y);
    if (distanceToWaypoint > GAME_CONFIG.ai.waypointReachDistance) {
      break;
    }
    ai.pathIndex += 1;
    syncBotRouteState(ai);
  }

  syncBotRouteState(ai);
  return ai.route[ai.pathIndex] ?? goal;
}

function updateBotInputs(room, player, now) {
  if (!player.isBot) {
    return;
  }

  ensureValidBotAiState(player, now);

  if (!isCombatPhase(room.match.phase) || !player.alive) {
    player.ai.intent = BOT_AI_INTENTS.IDLE;
    player.ai.targetId = null;
    player.ai.goalX = null;
    player.ai.goalY = null;
    player.ai.hasLineOfSight = false;
    player.ai.stuck = false;
    player.ai.targetLockUntil = 0;
    clearBotTargetMemory(player);
    clearBotCombatAnchor(player);
    clearBotRoute(player.ai);
    player.ai.moveAxisX = 0;
    player.ai.moveAxisY = 0;
    player.ai.moveAxisXCommitUntil = 0;
    player.ai.moveAxisYCommitUntil = 0;
    player.input.forward = false;
    player.input.back = false;
    player.input.left = false;
    player.input.right = false;
    player.input.shoot = false;
    player.input.clientSentAt = now;
    player.input.receivedAt = now;
    return;
  }

  const soloBotDuel = isSoloBotDuelRoom(room);
  updateBotProgressState(player, now);
  updateBotTacticalState(player, now, { soloBotDuel });

  if (now < player.nextAiThinkAt) {
    return;
  }

  const thinkIntervalMs = Math.max(100, Math.round(1000 / GAME_CONFIG.ai.thinkRate));
  player.nextAiThinkAt = Math.max(player.nextAiThinkAt + thinkIntervalMs, now + Math.round(thinkIntervalMs * 0.75));

  const ai = player.ai;
  const mapLayout = getRoomMapLayout(room);
  const preferredRange = getBotPreferredRange(player);
  const shootRange = getBotShootRange(player);
  const liveEnemyTarget = selectBotTarget(room, player, now);
  const liveEnemyHasLineOfSight = liveEnemyTarget
    ? !segmentHitsBotBlocker(room, player.x, player.y, liveEnemyTarget.x, liveEnemyTarget.y, GAME_CONFIG.bullet.radius, mapLayout)
    : false;
  if (liveEnemyTarget && liveEnemyHasLineOfSight) {
    updateBotTargetMemory(player, liveEnemyTarget, now);
  }

  const rememberedEnemyTarget = liveEnemyTarget
    ? (liveEnemyHasLineOfSight ? null : getBotRememberedTarget(room, player, liveEnemyTarget.id, now))
    : getBotRememberedTarget(room, player, null, now);
  const enemyTarget = liveEnemyTarget
    ? (liveEnemyHasLineOfSight ? liveEnemyTarget : rememberedEnemyTarget)
    : rememberedEnemyTarget;
  const shapeTarget = enemyTarget ? null : selectBotShapeTarget(room, player);
  const activeTarget = enemyTarget ?? shapeTarget;
  const targetDistance = activeTarget ? Math.hypot(activeTarget.x - player.x, activeTarget.y - player.y) : Infinity;
  const hasLineOfSight = enemyTarget
    ? liveEnemyHasLineOfSight
    : shapeTarget
      ? !segmentHitsBotBlocker(
          room,
          player.x,
          player.y,
          shapeTarget.x,
          shapeTarget.y,
          GAME_CONFIG.bullet.radius,
          mapLayout,
          { excludeShapeId: shapeTarget.id }
        )
      : false;
  const healthRatio = getBotHealthRatio(player);
  const advancedCombat = Boolean(enemyTarget);
  const bulletThreat =
    advancedCombat &&
    !soloBotDuel &&
    enemyTarget &&
    (healthRatio <= 0.78 || hasLineOfSight || targetDistance <= shootRange)
      ? selectBotBulletThreat(room, player)
      : null;
  const shouldRetreat =
    Boolean(enemyTarget) &&
    (
      healthRatio <= (
        soloBotDuel
          ? GAME_CONFIG.ai.lowHealthRetreatRatio * 0.55
          : advancedCombat
            ? GAME_CONFIG.ai.lowHealthRetreatRatio
            : GAME_CONFIG.ai.lowHealthRetreatRatio * 0.8
      ) ||
      (advancedCombat && !soloBotDuel && (Number(ai.retreatUntil ?? 0) || 0) > now && healthRatio <= 0.76)
    );

  ai.targetId = activeTarget?.id ?? null;
  ai.hasLineOfSight = hasLineOfSight;
  if (hasLineOfSight) {
    ai.lastLineOfSightAt = now;
  }
  if (bulletThreat) {
    ai.evasiveUntil = Math.max(
      Number(ai.evasiveUntil ?? 0) || 0,
      now + Math.max(250, Math.round(GAME_CONFIG.ai.dodgeLookaheadMs * bulletThreat.urgency))
    );
  }

  const decision = enemyTarget
    ? chooseBotIntentAndGoal(room, player, enemyTarget, targetDistance, hasLineOfSight, {
        now,
        advancedCombat,
        preferredRange,
        shootRange,
        bulletThreat,
        shouldRetreat
      })
    : shapeTarget
      ? {
          intent: BOT_AI_INTENTS.ENGAGE,
          goal: { x: shapeTarget.x, y: shapeTarget.y }
        }
      : chooseBotIntentAndGoal(room, player, null, Infinity, false);
  const shouldForceRepath =
    ai.stuck ||
    (activeTarget && !hasLineOfSight && now - ai.lastLineOfSightAt >= GAME_CONFIG.ai.repathLossOfSightMs);
  const moveTarget = updateBotRoute(player, decision.goal, now, { forceReplan: shouldForceRepath, room });

  ai.intent = ai.stuck ? BOT_AI_INTENTS.RECOVER : decision.intent;
  if (ai.stuck && !moveTarget) {
    resetBotAiState(player, now);
  }

  const navigationTarget = moveTarget ?? decision.goal ?? { x: player.x, y: player.y };
  const moveDistance = Math.hypot(navigationTarget.x - player.x, navigationTarget.y - player.y);
  const holdPosition =
    Boolean(enemyTarget) &&
    decision.intent === BOT_AI_INTENTS.ENGAGE &&
    hasLineOfSight &&
    !bulletThreat &&
    !shouldRetreat &&
    (Number(ai.evasiveUntil ?? 0) || 0) <= now &&
    moveDistance <= GAME_CONFIG.ai.waypointReachDistance * 0.35 &&
    Math.abs(targetDistance - preferredRange) <= GAME_CONFIG.ai.preferredRangeTolerance * 0.45;
  const steering = buildBotSteeringVector(room, player, navigationTarget, enemyTarget, {
    now,
    soloBotDuel,
    advancedCombat,
    preferredRange,
    shootRange,
    hasLineOfSight,
    targetDistance,
    bulletThreat,
    shouldRetreat,
    holdPosition
  });
  const shouldMove = !holdPosition && (moveDistance > GAME_CONFIG.ai.waypointReachDistance * 0.35 || steering.magnitude > 0.18);
  const axisEngageThreshold = bulletThreat ? 0.12 : 0.28;
  const axisReleaseThreshold = bulletThreat ? 0.06 : 0.14;
  const axisCommitMs = bulletThreat ? Math.round(BOT_AI_AXIS_COMMIT_MS * 0.65) : BOT_AI_AXIS_COMMIT_MS;
  const moveAxisX = shouldMove
    ? resolveBotMovementAxis(player, "x", steering.x, now, {
        engageThreshold: axisEngageThreshold,
        releaseThreshold: axisReleaseThreshold,
        flipThreshold: bulletThreat ? 0.5 : BOT_AI_AXIS_FLIP_THRESHOLD,
        commitMs: axisCommitMs
      })
    : resolveBotMovementAxis(player, "x", 0, now, {
        engageThreshold: axisEngageThreshold,
        releaseThreshold: axisReleaseThreshold,
        commitMs: axisCommitMs
      });
  const moveAxisY = shouldMove
    ? resolveBotMovementAxis(player, "y", steering.y, now, {
        engageThreshold: axisEngageThreshold,
        releaseThreshold: axisReleaseThreshold,
        flipThreshold: bulletThreat ? 0.5 : BOT_AI_AXIS_FLIP_THRESHOLD,
        commitMs: axisCommitMs
      })
    : resolveBotMovementAxis(player, "y", 0, now, {
        engageThreshold: axisEngageThreshold,
        releaseThreshold: axisReleaseThreshold,
        commitMs: axisCommitMs
      });

  player.input.seq = player.lastProcessedInputSeq;
  player.input.clientSentAt = now;
  player.input.receivedAt = now;
  player.input.left = moveAxisX < 0;
  player.input.right = moveAxisX > 0;
  player.input.forward = moveAxisY < 0;
  player.input.back = moveAxisY > 0;

  const objectiveFocusZone = getObjectiveGoalZone(room, player.teamId, player) ?? getRoomObjectiveZones(room)[1] ?? null;
  const predictedAimTarget =
    activeTarget && hasLineOfSight
      ? getBotAimPoint(player, activeTarget, now, { shootRange })
      : activeTarget;
  const turretTarget = predictedAimTarget ?? objectiveFocusZone ?? { x: room.objective.x, y: room.objective.y };
  player.input.turretAngle = Math.atan2(turretTarget.y - player.y, turretTarget.x - player.x);
  const aimDelta = normalizeAngle(player.input.turretAngle - player.turretAngle);
  const classRangeMultiplier = BOT_AI_CLASS_RANGE_MULTIPLIERS[player.tankClassId] ?? 1;
  const shootAimTolerance = soloBotDuel
    ? Math.max(GAME_CONFIG.ai.aimToleranceRadians, 1.05)
    : clamp(
        GAME_CONFIG.ai.aimToleranceRadians *
          (classRangeMultiplier >= 1.2 ? 0.82 : classRangeMultiplier <= 0.88 ? 1.14 : 1),
        0.18,
        0.38
      );
  const closeRangeThreshold = preferredRange * 0.45;
  const effectiveAimTolerance =
    targetDistance <= closeRangeThreshold
      ? (soloBotDuel ? Math.PI : Math.max(shootAimTolerance, 1.35))
      : shootAimTolerance;
  const canShootAtRange = soloBotDuel || targetDistance <= shootRange;

  player.input.shoot =
    Boolean(activeTarget) &&
    !activeTarget.remembered &&
    canShootAtRange &&
    hasLineOfSight &&
    Math.abs(aimDelta) <= effectiveAimTolerance &&
    !ai.stuck;
}

function clampTankPosition(x, y) {
  return {
    x: clamp(x, GAME_CONFIG.world.padding, GAME_CONFIG.world.width - GAME_CONFIG.world.padding),
    y: clamp(y, GAME_CONFIG.world.padding, GAME_CONFIG.world.height - GAME_CONFIG.world.padding)
  };
}

function resolvePlayerShapeCollisions(room, player) {
  const tankRadius = getPlayerTankRadius(player);
  for (let pass = 0; pass < 3; pass += 1) {
    let collided = false;

    for (const shape of room.shapes.values()) {
      if (!shape || (shape.hp ?? 0) <= 0) {
        continue;
      }

      const dx = player.x - shape.x;
      const dy = player.y - shape.y;
      const minDistance = tankRadius + shape.radius;
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDistance * minDistance) {
        continue;
      }

      collided = true;
      const dist = Math.sqrt(distSq);
      const fallbackAngle = Number.isFinite(player.angle) ? player.angle : 0;
      const nx = dist > 0.001 ? dx / dist : Math.cos(fallbackAngle);
      const ny = dist > 0.001 ? dy / dist : Math.sin(fallbackAngle);
      const overlap = minDistance - Math.max(dist, 0.001);
      const playerPush = overlap + SHAPE_BOUNCE.playerResolveBias;
      const target = clampTankPosition(player.x + nx * playerPush, player.y + ny * playerPush);
      const mapLayout = getRoomMapLayout(room);

      if (
        !collidesWithObstacle(target.x, player.y, tankRadius, mapLayout) &&
        !collidesWithShape(room, target.x, player.y, tankRadius, { excludeShapeId: shape.id })
      ) {
        player.x = target.x;
      }

      if (
        !collidesWithObstacle(player.x, target.y, tankRadius, mapLayout) &&
        !collidesWithShape(room, player.x, target.y, tankRadius, { excludeShapeId: shape.id })
      ) {
        player.y = target.y;
      }

      const shapeNudge = clamp(
        overlap * SHAPE_BOUNCE.shapeNudgeScale,
        SHAPE_BOUNCE.shapeNudgeMin,
        SHAPE_BOUNCE.shapeNudgeMax
      );
      moveShapeSafely(room, shape, shape.x - nx * shapeNudge, shape.y - ny * shapeNudge, {
        ignorePlayerId: player.id
      });

      const impactImpulse = clamp(
        SHAPE_BOUNCE.impactImpulseBase + overlap * SHAPE_BOUNCE.impactImpulseScale,
        0,
        SHAPE_BOUNCE.maxImpulse
      );
      shape.impulseX = clamp((shape.impulseX ?? 0) - nx * impactImpulse, -SHAPE_BOUNCE.maxImpulse, SHAPE_BOUNCE.maxImpulse);
      shape.impulseY = clamp((shape.impulseY ?? 0) - ny * impactImpulse, -SHAPE_BOUNCE.maxImpulse, SHAPE_BOUNCE.maxImpulse);
      shape.driftAngle = normalizeAngle(Math.atan2(-ny, -nx));
      shape.driftTurnVelocity = (getRandomFloat(room) - 0.5) * 0.24;
    }

    if (!collided) {
      break;
    }
  }
}

function movePlayerWithCollision(room, player, distance) {
  const nextX = player.x + distance.x;
  const nextY = player.y + distance.y;
  const clampedX = clampTankPosition(nextX, player.y).x;
  const clampedY = clampTankPosition(player.x, nextY).y;

  const mapLayout = getRoomMapLayout(room);
  const tankRadius = getPlayerTankRadius(player);
  if (!collidesWithObstacle(clampedX, player.y, tankRadius, mapLayout)) {
    player.x = clampedX;
  }

  if (!collidesWithObstacle(player.x, clampedY, tankRadius, mapLayout)) {
    player.y = clampedY;
  }

  resolvePlayerShapeCollisions(room, player);
}

function updateObjective(room, deltaSeconds, now) {
  if (!isCombatPhase(room.match.phase)) {
    return;
  }

  if (isSoloBotDuelRoom(room)) {
    resetObjectiveState(room, { rerollPositions: false });
    return;
  }

  for (const zone of getRoomObjectiveZones(room)) {
    let occupyingTeamId = null;
    let contested = false;

    for (const player of room.players.values()) {
      if (!player.connected || !player.alive || player.isSpectator || !player.teamId) {
        continue;
      }

      if (!isPlayerInsideObjectiveZone(player, zone)) {
        continue;
      }

      if (occupyingTeamId === null) {
        occupyingTeamId = player.teamId;
        continue;
      }

      if (occupyingTeamId !== player.teamId) {
        contested = true;
        break;
      }
    }

    zone.contested = contested;

    if (zone.contested) {
      zone.nextRewardAt = null;
      continue;
    }

    if (occupyingTeamId) {
      const captureTeamId = occupyingTeamId;
      const captureTeam = getTeamConfig(captureTeamId);
      const captureTeamName = captureTeam?.name ?? captureTeamId;

      if (zone.ownerTeamId === captureTeamId) {
        zone.captureTargetTeamId = captureTeamId;
        zone.captureTargetTeamName = captureTeamName;
        zone.captureProgress = 1;
        if (GAME_CONFIG.objective.rewardIntervalMs > 0 && zone.nextRewardAt === null) {
          zone.nextRewardAt = now + GAME_CONFIG.objective.rewardIntervalMs;
        }
      } else {
        if (zone.captureTargetTeamId !== captureTeamId) {
          zone.captureTargetTeamId = captureTeamId;
          zone.captureTargetTeamName = captureTeamName;
          zone.captureProgress = 0;
        }

        zone.captureProgress = clamp(
          zone.captureProgress + deltaSeconds / GAME_CONFIG.objective.captureSeconds,
          0,
          1
        );

        if (zone.captureProgress >= 1) {
          zone.ownerTeamId = captureTeamId;
          zone.ownerTeamName = captureTeamName;
          zone.captureTargetTeamId = captureTeamId;
          zone.captureTargetTeamName = captureTeamName;
          zone.captureProgress = 1;
          zone.nextRewardAt =
            GAME_CONFIG.objective.rewardIntervalMs > 0
              ? now + GAME_CONFIG.objective.rewardIntervalMs
              : null;
        }
      }
    } else if (zone.ownerTeamId) {
      zone.captureTargetTeamId = zone.ownerTeamId;
      zone.captureTargetTeamName = zone.ownerTeamName;
      zone.captureProgress = 1;
      if (GAME_CONFIG.objective.rewardIntervalMs > 0 && zone.nextRewardAt === null) {
        zone.nextRewardAt = now + GAME_CONFIG.objective.rewardIntervalMs;
      }
    } else {
      zone.captureProgress = clamp(zone.captureProgress - deltaSeconds, 0, 1);
      if (zone.captureProgress <= 0) {
        zone.captureTargetTeamId = null;
        zone.captureTargetTeamName = null;
      }
    }

    if (
      zone.ownerTeamId &&
      !zone.contested &&
      zone.nextRewardAt !== null &&
      GAME_CONFIG.objective.rewardIntervalMs > 0 &&
      now >= zone.nextRewardAt
    ) {
      let rewardedCount = 0;

      for (const rewardRecipient of room.players.values()) {
        if (
          !rewardRecipient.connected ||
          !rewardRecipient.alive ||
          rewardRecipient.isSpectator ||
          rewardRecipient.teamId !== zone.ownerTeamId
        ) {
          continue;
        }

        rewardedCount += 1;
        if (GAME_CONFIG.objective.scoreReward > 0) {
          rewardRecipient.score += GAME_CONFIG.objective.scoreReward;
          queueScoreStateEvent(room, rewardRecipient, "objective", now);
        }

        if (GAME_CONFIG.objective.creditsReward > 0) {
          rewardRecipient.credits += GAME_CONFIG.objective.creditsReward;
          queueInventoryStateEvent(room, rewardRecipient, now);
        }
      }

      if (rewardedCount === 0) {
        zone.nextRewardAt = null;
        continue;
      }

      zone.nextRewardAt = now + GAME_CONFIG.objective.rewardIntervalMs;
    }
  }

  syncObjectiveSummary(room.objective, room.lobby.mapId);
}

function getLagCompensatedFireContext(player, now) {
  const rawLatencyMs = Math.max(0, now - player.input.clientSentAt);
  const compensatedMs = clamp(
    rawLatencyMs - GAME_CONFIG.lagCompensation.fairnessBiasMs,
    0,
    GAME_CONFIG.lagCompensation.maxProjectileCompensationMs
  );
  const fireTime = now - compensatedMs;

  return {
    rawLatencyMs,
    compensatedMs,
    fireTime,
    turretAngle: player.input.turretAngle
  };
}

function getPlayerCollisionStateAtTime(player, sampleTime, currentTime) {
  if (!player.connected || !player.alive) {
    return {
      ...createPlayerHistorySample(player, currentTime),
      time: sampleTime
    };
  }

  return (
    sampleHistoricalPlayerState(player, sampleTime, currentTime) ?? {
      ...createPlayerHistorySample(player, currentTime),
      time: sampleTime
    }
  );
}

function applyBulletHit(room, bullet, player, impactTime) {
  const attacker = room.players.get(bullet.ownerId) ?? null;
  if (isFriendlyCombatPair(attacker, player)) {
    return;
  }

  if (hasSpawnProtection(player, impactTime)) {
    room.bullets.delete(bullet.id);
    return;
  }
  if (hasActiveShield(player, impactTime)) {
    room.bullets.delete(bullet.id);
    return;
  }
  const resolution = resolveCombatHit(room, attacker, player, impactTime, bullet.damage ?? GAME_CONFIG.bullet.damage);
  player.hp = Math.max(0, player.hp - resolution.damage);
  room.bullets.delete(bullet.id);

  syncPlayerCombatProfile(player, impactTime);
  player.combat.lastDamagedAt = impactTime;
  if (attacker) {
    recordDamageContribution(player, attacker.id, resolution.damage, impactTime);
  }

  queueRoomEvent(
    room,
    createHitEvent({
      id: createRoomEventId(room, EVENT_TYPES.HIT),
      serverTime: impactTime,
      attackerId: bullet.ownerId,
      targetId: player.id,
      bulletId: bullet.id,
      damage: resolution.damage,
      hpAfter: player.hp,
      isCritical: resolution.isCritical,
      armorBlocked: resolution.armorBlocked,
      statusEffect: resolution.statusEffect,
      statusDurationMs: resolution.statusDurationMs
    })
  );
  queueHealthStateEvent(room, player, -resolution.damage, impactTime);
  queueAnimationStateEvent(room, player, ANIMATION_ACTIONS.HIT, impactTime);
  queueCombatStateEvent(room, {
    serverTime: impactTime,
    action: COMBAT_EVENT_ACTIONS.DAMAGE,
    attackerId: attacker?.id ?? bullet.ownerId,
    attackerName: attacker?.name ?? null,
    targetId: player.id,
    targetName: player.name,
    damage: resolution.damage,
    hpAfter: player.hp,
    isCritical: resolution.isCritical,
    armorBlocked: resolution.armorBlocked,
    statusEffect: resolution.statusEffect,
    statusDurationMs: resolution.statusDurationMs,
    soundCue: resolution.soundCue,
    vfxCue: resolution.vfxCue,
    message: attacker
      ? `${attacker.name} hit ${player.name} for ${resolution.damage}`
      : `${player.name} took ${resolution.damage} damage`
  });

  if (resolution.statusEffect !== STATUS_EFFECTS.NONE && player.hp > 0) {
    applyStatusEffect(room, attacker, player, resolution, impactTime);
  }

  if (attacker) {
    updateProfileStats(attacker.profileId, (stats) => {
      stats.shotsHit += 1;
    });
  }

  if (player.hp === 0) {
    const assistContributors = getAssistContributors(room, player, attacker?.id ?? "", impactTime);
    player.alive = false;
    player.deaths += 1;
    player.respawnAt = isRoomSurvivalMode(room) ? null : impactTime + GAME_CONFIG.respawnDelayMs;
    player.credits += GAME_CONFIG.economy.deathCredits;
    player.combat.stunUntil = 0;
    player.combat.stunRemainingMs = 0;
    player.combat.statusEffect = STATUS_EFFECTS.NONE;
    player.combat.statusDurationMs = 0;
    player.combat.stunned = false;
    player.combat.shieldUntil = 0;
    player.combat.shieldRemainingMs = 0;
    player.combat.shielded = false;
    queueAnimationStateEvent(room, player, ANIMATION_ACTIONS.DEATH, impactTime);
    queueScoreStateEvent(room, player, "death", impactTime);
    queueInventoryStateEvent(room, player, impactTime);
    updateProfileStats(player.profileId, (stats) => {
      stats.deaths += 1;
    });

    if (attacker) {
      attacker.score += 1;
      attacker.credits += GAME_CONFIG.economy.killCredits;
      // Award XP for kill
      const xpGain = 250 + (player.level ?? 1) * 25;
      awardXpToPlayer(attacker, xpGain, room);
      queueScoreStateEvent(room, attacker, "kill", impactTime);
      queueInventoryStateEvent(room, attacker, impactTime);
      updateProfileStats(attacker.profileId, (stats) => {
        stats.kills += 1;
      });
    }

    for (const contribution of assistContributors) {
      const assistant = room.players.get(contribution.attackerId);
      if (!assistant || !assistant.alive) {
        continue;
      }

      assistant.assists += 1;
      assistant.credits += GAME_CONFIG.combat.assistCredits;
      queueScoreStateEvent(room, assistant, "assist", impactTime);
      queueInventoryStateEvent(room, assistant, impactTime);
      queueCombatStateEvent(room, {
        serverTime: impactTime,
        action: COMBAT_EVENT_ACTIONS.ASSIST,
        attackerId: assistant.id,
        attackerName: assistant.name,
        targetId: player.id,
        targetName: player.name,
        damage: contribution.damage,
        hpAfter: 0,
        soundCue: SOUND_CUES.ASSIST,
        vfxCue: VFX_CUES.ASSIST_RING,
        message: `${assistant.name} assisted on ${player.name}`
      });
    }

    queueCombatStateEvent(room, {
      serverTime: impactTime,
      action: COMBAT_EVENT_ACTIONS.KILL,
      attackerId: attacker?.id ?? null,
      attackerName: attacker?.name ?? null,
      targetId: player.id,
      targetName: player.name,
      assistantIds: assistContributors.map((entry) => entry.attackerId),
      assistantNames: assistContributors
        .map((entry) => room.players.get(entry.attackerId)?.name ?? null)
        .filter(Boolean),
      damage: resolution.damage,
      hpAfter: player.hp,
      isCritical: resolution.isCritical,
      armorBlocked: resolution.armorBlocked,
      soundCue: SOUND_CUES.KILL,
      vfxCue: VFX_CUES.KILL_BURST,
      message: attacker
        ? `${attacker.name} destroyed ${player.name}`
        : `${player.name} was destroyed`
    });

    if (isSoloBotDuelRoom(room)) {
      clearOwnedEntityLifecycle(room, player.id);
    }

    clearCombatContributors(player);
  }
}

function simulateBulletToTime(room, bullet, targetTime, currentTime = targetTime) {
  const stepMs = GAME_CONFIG.lagCompensation.projectileCatchupStepMs;
  const attacker = room.players.get(bullet.ownerId) ?? null;

  while (bullet.lastSimulatedAt < targetTime) {
    const stepEndsAt = Math.min(targetTime, bullet.lastSimulatedAt + stepMs);
    const stepSeconds = (stepEndsAt - bullet.lastSimulatedAt) / 1000;
    const previousX = bullet.x;
    const previousY = bullet.y;

    const bSpeed = bullet.speed ?? GAME_CONFIG.bullet.speed;
    bullet.x += Math.cos(bullet.angle) * bSpeed * stepSeconds;
    bullet.y += Math.sin(bullet.angle) * bSpeed * stepSeconds;
    bullet.lastSimulatedAt = stepEndsAt;

    const bulletExpired =
      stepEndsAt - bullet.bornAt >= GAME_CONFIG.bullet.lifeMs ||
      bullet.x < 0 ||
      bullet.x > GAME_CONFIG.world.width ||
      bullet.y < 0 ||
      bullet.y > GAME_CONFIG.world.height;

    const bRadius = bullet.radius ?? GAME_CONFIG.bullet.radius;
    if (bulletExpired || segmentHitsObstacle(previousX, previousY, bullet.x, bullet.y, bRadius, getRoomMapLayout(room))) {
      room.bullets.delete(bullet.id);
      return false;
    }

    for (const player of getPlayersInSimulationOrder(room)) {
      if (player.id === bullet.ownerId || player.isSpectator) {
        continue;
      }

      if (isFriendlyCombatPair(attacker, player)) {
        continue;
      }

      const collisionState = getPlayerCollisionStateAtTime(player, stepEndsAt, currentTime);
      if (!collisionState.alive || !collisionState.connected) {
        continue;
      }

      const hitDistance = getPlayerTankRadius(player) + (bullet.radius ?? GAME_CONFIG.bullet.radius);
      const distanceSquared = distanceSquaredToSegment(
        previousX,
        previousY,
        bullet.x,
        bullet.y,
        collisionState.x,
        collisionState.y
      );

      if (distanceSquared > hitDistance * hitDistance) {
        continue;
      }

      applyBulletHit(room, bullet, player, stepEndsAt);
      return false;
    }

    // Check shape collisions
    if (checkBulletShapeCollisions(room, bullet, stepEndsAt)) {
      room.bullets.delete(bullet.id);
      return false;
    }
  }

  return true;
}

function resolvePendingShots(room, now) {
  if (!canShootPhase(room.match.phase)) {
    clearTransientRoomCombatState(room);
    return;
  }

  room.pendingShots.sort(
    (left, right) =>
      left.fireTime - right.fireTime ||
      left.clientSentAt - right.clientSentAt ||
      left.inputSeq - right.inputSeq ||
      left.playerId.localeCompare(right.playerId)
  );

  while (room.pendingShots.length > 0) {
    if (!canShootPhase(room.match.phase)) {
      clearTransientRoomCombatState(room);
      return;
    }

    const shot = room.pendingShots.shift();
    const player = room.players.get(shot.playerId);

    if (!player || player.isSpectator || !player.alive) {
      continue;
    }

    const shooterState = getPlayerCollisionStateAtTime(player, shot.fireTime, now);
    if (!shooterState.alive || !shooterState.connected) {
      continue;
    }

    const shotClassDef = CLASS_TREE[player.tankClassId] ?? CLASS_TREE.basic;
    const bulletDmgStat = player.stats?.bulletDamage ?? 0;
    const bulletSpdStat = player.stats?.bulletSpeed ?? 0;
    const baseBulletSpeed = (shotClassDef.bulletSpeed ?? GAME_CONFIG.bullet.speed) * (1 + bulletSpdStat * 0.08);
    const baseBulletDamage = (shotClassDef.bulletDamage ?? GAME_CONFIG.bullet.damage) * (1 + bulletDmgStat * 0.10);
    const baseBulletRadius = shotClassDef.bulletRadius ?? GAME_CONFIG.bullet.radius;
    const shotBarrels = shotClassDef.barrels ?? [{ x: 40, y: 0, w: 40, h: 14 }];
    const tankRadius = getPlayerTankRadius(player);

    for (const barrel of shotBarrels) {
      const barrelAngle = barrel.autoRotate
        ? (shot.fireTime / 1000) * AUTO_BARREL_ROT_SPEED
        : shot.turretAngle + (barrel.angle ?? 0);
      const rightX = -Math.sin(barrelAngle);
      const rightY = Math.cos(barrelAngle);
      const lateralOffset = barrel.y ?? 0;
      const bulletId = `${room.id}-${room.nextBulletId++}`;
      const bullet = {
        id: bulletId,
        ownerId: player.id,
        x: shooterState.x + Math.cos(barrelAngle) * (tankRadius + 8) + rightX * lateralOffset,
        y: shooterState.y + Math.sin(barrelAngle) * (tankRadius + 8) + rightY * lateralOffset,
        angle: barrelAngle,
        speed: baseBulletSpeed,
        damage: baseBulletDamage,
        radius: baseBulletRadius,
        bornAt: shot.fireTime,
        lastSimulatedAt: shot.fireTime,
        lagCompensatedMs: shot.compensatedMs,
        clientSentAt: shot.clientSentAt
      };

      room.bullets.set(bulletId, bullet);
      if (!simulateBulletToTime(room, bullet, now, now)) {
        if (!canShootPhase(room.match.phase)) {
          clearTransientRoomCombatState(room);
          return;
        }
        continue;
      }

      if (!canShootPhase(room.match.phase)) {
        clearTransientRoomCombatState(room);
        return;
      }
    }
  }
}

function updatePlayer(room, player, deltaSeconds, now) {
  if (!canSimulatePlayer(room, player) || !player.connected) {
    return;
  }

  const tickStartedAt = now - deltaSeconds * 1000;
  syncPlayerCombatProfile(player, now);
  applyPassiveRegeneration(player, deltaSeconds, now);
  updateBotInputs(room, player, now);
  const inputSegments = applyPendingInputs(player, room.tickNumber, tickStartedAt, now);
  clearSpawnProtectionOnAction(player, now);

  if (!player.alive) {
    if (player.isBot && canPlayerRespawn(room, player, now)) {
      respawnPlayer(room, player, now);
    }

    updatePlayerAnimationState(
      player,
      {
        x: player.x,
        y: player.y,
        angle: player.angle,
        turretAngle: player.turretAngle
      },
      deltaSeconds,
      now
    );
    return;
  }

  const previousState = {
    x: player.x,
    y: player.y,
    angle: player.angle,
    turretAngle: player.turretAngle
  };

  for (const inputSegment of inputSegments) {
    if (!inputSegment || inputSegment.deltaSeconds <= 0) {
      continue;
    }

    const activeInput = inputSegment.input;
    const stunned = getRemainingStunMs(player, inputSegment.endsAt ?? now) > 0;

    player.turretAngle = activeInput.turretAngle;

    const moveX = !stunned ? (activeInput.right ? 1 : 0) - (activeInput.left ? 1 : 0) : 0;
    const moveY = !stunned ? (activeInput.back ? 1 : 0) - (activeInput.forward ? 1 : 0) : 0;
    const moveMagnitude = Math.hypot(moveX, moveY);
    const normalizedMoveX = moveMagnitude > 0 ? moveX / moveMagnitude : 0;
    const normalizedMoveY = moveMagnitude > 0 ? moveY / moveMagnitude : 0;
    const moveSpeedStat = player.stats?.movementSpeed ?? 0;
    const moveSpeed = moveMagnitude > 0 ? GAME_CONFIG.tank.speed * (1 + moveSpeedStat * 0.07) : 0;

    if (moveMagnitude > 0) {
      player.angle = Math.atan2(normalizedMoveY, normalizedMoveX);
    }

    movePlayerWithCollision(room, player, {
      x: normalizedMoveX * moveSpeed * inputSegment.deltaSeconds,
      y: normalizedMoveY * moveSpeed * inputSegment.deltaSeconds
    });
  }

  const stunned = getRemainingStunMs(player, now) > 0;
  if (!stunned && canShootPhase(room.match.phase) && player.input.shoot) {
    const fireContext = getLagCompensatedFireContext(player, now);

    const classDef = CLASS_TREE[player.tankClassId] ?? CLASS_TREE.basic;
    const reloadStat = player.stats?.reload ?? 0;
    const classReloadMs = classDef.reloadMs ?? GAME_CONFIG.tank.shootCooldownMs;
    const effectiveReloadMs = Math.max(50, classReloadMs * (1 - reloadStat * 0.065));
    if (fireContext.fireTime - player.lastShotAt >= effectiveReloadMs) {
      player.lastShotAt = fireContext.fireTime;
      room.pendingShots.push({
        playerId: player.id,
        fireTime: fireContext.fireTime,
        turretAngle: fireContext.turretAngle,
        compensatedMs: fireContext.compensatedMs,
        clientSentAt: player.input.clientSentAt,
        inputSeq: player.input.seq
      });
      queueAnimationStateEvent(room, player, ANIMATION_ACTIONS.FIRE, now);

      updateProfileStats(player.profileId, (stats) => {
        stats.shotsFired += 1;
      });
    }
  }

  validatePlayerSimulationState(room, player, previousState, deltaSeconds, now);
  updatePlayerAnimationState(player, previousState, deltaSeconds, now);
}

function updateBullets(room, deltaSeconds, now) {
  if (!canShootPhase(room.match.phase)) {
    clearTransientRoomCombatState(room);
    return;
  }

  for (const bullet of room.bullets.values()) {
    if (!canShootPhase(room.match.phase)) {
      clearTransientRoomCombatState(room);
      return;
    }

    if (!Number.isFinite(bullet.lastSimulatedAt)) {
      bullet.lastSimulatedAt = now;
    }

    simulateBulletToTime(room, bullet, now, now);
  }
}

function updateRoomPhase(room, now) {
  const connectedPlayers = getConnectedMatchPlayers(room);
  const restorablePlayerCount = getRestorablePlayerCount(room, now);
  const latestReconnectDeadline = getLatestReconnectDeadline(room, now);

  if (room.match.phase === MATCH_PHASES.SHUTDOWN) {
    return;
  }

  // Effective minimum for pause/disconnect logic is 1 (auto-start with bots)
  const effectiveMinPlayers = 1;

  if (room.match.phase === MATCH_PHASES.PAUSE) {
    room.match.phaseEndsAt = latestReconnectDeadline;

    if (connectedPlayers.length >= effectiveMinPlayers) {
      resumePausedMatch(room, now);
      return;
    }

    if (
      restorablePlayerCount < effectiveMinPlayers ||
      (room.match.phaseEndsAt !== null && now >= room.match.phaseEndsAt)
    ) {
      const resumePhase = room.match.resumePhase ?? MATCH_PHASES.WAITING;
      if (isCombatPhase(resumePhase)) {
        finishMatchDueToDisconnect(room, now);
      } else {
        resetToLobby(room, now);
      }
    }

    return;
  }

  if (connectedPlayers.length < effectiveMinPlayers) {
    if (
      (isWarmupPhase(room.match.phase) || isCombatPhase(room.match.phase)) &&
      restorablePlayerCount >= effectiveMinPlayers
    ) {
      pauseMatchForReconnect(room, now);
      return;
    }

    if (room.match.phase !== MATCH_PHASES.WAITING) {
      if (isCombatPhase(room.match.phase)) {
        finishMatchDueToDisconnect(room, now);
      } else {
        resetToLobby(room, now);
      }
    }
    return;
  }

  if (room.match.phase === MATCH_PHASES.WAITING) {
    maybeStartCountdown(room, now);
    return;
  }

  if (room.match.phase === MATCH_PHASES.WARMUP) {
    const readyPlayers = getReadyPlayers(room);
    if (readyPlayers.length !== connectedPlayers.length) {
      setRoomPhase(room, MATCH_PHASES.WAITING, now);
      return;
    }

    if (now >= room.match.phaseEndsAt) {
      startMatch(room, now);
    }
    return;
  }

  if (room.match.phase === MATCH_PHASES.LIVE_ROUND) {
    if (isRoomContinuousMode(room)) {
      syncContinuousMatchState(room, now);
      return;
    }

    if (isRoomSurvivalMode(room)) {
      const winner =
        getPlayersInSimulationOrder(room).find(
          (player) => isActiveParticipant(player) && player.score >= GAME_CONFIG.match.scoreToWin
        ) ??
        null;

      if (winner) {
        finishMatch(room, now, winner);
        return;
      }
    }

    if (now >= room.match.phaseEndsAt) {
      if (shouldEnterOvertime(room)) {
        setRoomPhase(room, MATCH_PHASES.OVERTIME, now, getCurrentWinner(room));
        return;
      }

      finishMatch(room, now, getLeadingActivePlayer(room));
    }
    return;
  }

  if (room.match.phase === MATCH_PHASES.OVERTIME) {
    if (isRoomSurvivalMode(room)) {
      const winner =
        getPlayersInSimulationOrder(room).find(
          (player) => isActiveParticipant(player) && player.score >= GAME_CONFIG.match.scoreToWin
        ) ??
        null;

      if (winner) {
        finishMatch(room, now, winner, {
          message: `${winner.name} wins in overtime`
        });
        return;
      }
    }

    if (!shouldEnterOvertime(room)) {
      finishMatch(room, now, getLeadingActivePlayer(room), {
        message: `${getLeadingActivePlayer(room)?.name ?? "A player"} wins in overtime`
      });
    }
    return;
  }

  if (room.match.phase === MATCH_PHASES.ROUND_END && now >= room.match.phaseEndsAt) {
    if (shouldAutoRestartRound(room)) {
      startMatch(room, now);
      return;
    }

    setRoomPhase(room, MATCH_PHASES.RESULTS, now, getCurrentWinner(room));
    return;
  }

  if (room.match.phase === MATCH_PHASES.RESULTS) {
    maybeStartRematch(room, now);
    if (room.match.phase !== MATCH_PHASES.RESULTS) {
      return;
    }

    if (now >= room.match.phaseEndsAt) {
      setRoomPhase(room, MATCH_PHASES.MAP_TRANSITION, now, getCurrentWinner(room), {
        transitionTargetMapId: getNextMapId(room.lobby.mapId)
      });
    }
    return;
  }

  if (room.match.phase === MATCH_PHASES.MAP_TRANSITION && now >= room.match.phaseEndsAt) {
    finalizeMapTransition(room, now);
  }
}

function getRoomStatePayload(room, player, socket, now, snapshotSeq) {
  const interest = buildViewerInterestSet(room, player, socket);
  const replication = buildReplicationPayloadForSocket(socket, room, player, snapshotSeq, now, interest);
  const includeFullCollections = replication.mode === "full";
  const visiblePlayers = includeFullCollections
    ? interest.players.map((candidate) => createViewerPlayerState(candidate, player))
    : [];
  const visibleBullets = includeFullCollections ? interest.bullets : [];
  const visibleShapes = includeFullCollections ? interest.shapes : [];
  const visibleEvents = getVisibleEventsForViewer(room, player);
  const objectiveState = interest.objectiveState;

  return createStatePayload({
    roomId: room.id,
    snapshotSeq,
    simulationTick: room.tickNumber,
    snapshotTick: room.tickNumber,
    tickRate: GAME_CONFIG.serverTickRate,
    serverTime: now,
    match: {
      ...room.match,
      minPlayers: GAME_CONFIG.match.minPlayers,
      scoreToWin: GAME_CONFIG.match.scoreToWin,
      respawnsEnabled: !isRoomSurvivalMode(room)
    },
    lobby: getLobbySnapshot(room),
    roundNumber: room.roundNumber,
    objective: objectiveState,
    leaderboard: getLeaderboard(room),
    players: visiblePlayers,
    bullets: visibleBullets,
    shapes: visibleShapes,
    events: visibleEvents,
    inventory: player ? [createInventoryState(player)] : [],
    replication,
    you: player
      ? {
          playerId: player.id,
          profileId: player.profileId,
          lastProcessedInputSeq: player.lastProcessedInputSeq,
          lastProcessedInputTick: player.lastProcessedInputTick,
          lastProcessedInputClientSentAt: player.lastProcessedInputClientSentAt,
          pendingInputCount: player.pendingInputs.length,
          alive: player.alive,
          respawnAt: player.respawnAt,
          ready: player.ready,
          assists: player.assists,
          isSpectator: player.isSpectator,
          isRoomOwner: room.lobby.ownerPlayerId === player.id,
          teamId: player.teamId,
          classId: player.classId,
          tankClassId: player.tankClassId ?? 'basic',
          maxHp: getPlayerMaxHitPoints(player),
          xp: player.xp ?? 0,
          level: player.level ?? 1,
          statPoints: player.statPoints ?? 0,
          pendingUpgrades: player.pendingUpgrades ?? [],
          basicSpecializationPending: Boolean(player.basicSpecializationPending),
          basicSpecializationChoice: player.basicSpecializationChoice ?? null,
          stats: createAllocatedStats(player.stats),
          queuedForSlot: player.queuedForSlot,
          slotReserved: player.slotReserved,
          afk: player.afk,
          profileStats: getPublicProfileStats(player)
        }
      : null
  });
}

function applyBodyHit(room, attacker, target, damage, now) {
  if (isFriendlyCombatPair(attacker, target)) {
    return;
  }

  if (!target.alive || hasSpawnProtection(target, now) || hasActiveShield(target, now)) {
    return;
  }

  const resolution = resolveCombatHit(room, attacker, target, now, damage);
  target.hp = Math.max(0, target.hp - resolution.damage);

  recordDamageContribution(target, attacker.id, resolution.damage, now);
  syncPlayerCombatProfile(target, now);
  target.combat.lastDamagedAt = now;

  queueHealthStateEvent(room, target, -resolution.damage, now);
  queueAnimationStateEvent(room, target, ANIMATION_ACTIONS.HIT, now);
  queueCombatStateEvent(room, {
    serverTime: now,
    action: COMBAT_EVENT_ACTIONS.DAMAGE,
    attackerId: attacker.id,
    attackerName: attacker.name,
    targetId: target.id,
    targetName: target.name,
    damage: resolution.damage,
    hpAfter: target.hp,
    isCritical: resolution.isCritical,
    armorBlocked: resolution.armorBlocked,
    statusEffect: STATUS_EFFECTS.NONE,
    statusDurationMs: 0,
    soundCue: resolution.soundCue,
    vfxCue: resolution.vfxCue,
    message: `${attacker.name} rammed ${target.name} for ${resolution.damage}`
  });

  if (target.hp === 0) {
    const assistContributors = getAssistContributors(room, target, attacker.id, now);
    target.alive = false;
    target.deaths += 1;
    target.respawnAt = isRoomSurvivalMode(room) ? null : now + GAME_CONFIG.respawnDelayMs;
    target.credits += GAME_CONFIG.economy.deathCredits;
    target.combat.stunUntil = 0;
    target.combat.stunRemainingMs = 0;
    target.combat.statusEffect = STATUS_EFFECTS.NONE;
    target.combat.statusDurationMs = 0;
    target.combat.stunned = false;
    target.combat.shieldUntil = 0;
    target.combat.shieldRemainingMs = 0;
    target.combat.shielded = false;
    queueAnimationStateEvent(room, target, ANIMATION_ACTIONS.DEATH, now);
    queueScoreStateEvent(room, target, "death", now);
    queueInventoryStateEvent(room, target, now);
    updateProfileStats(target.profileId, (stats) => { stats.deaths += 1; });

    attacker.score += 1;
    attacker.credits += GAME_CONFIG.economy.killCredits;
    awardXpToPlayer(attacker, 250 + (target.level ?? 1) * 25, room);
    queueScoreStateEvent(room, attacker, "kill", now);
    queueInventoryStateEvent(room, attacker, now);
    updateProfileStats(attacker.profileId, (stats) => { stats.kills += 1; });

    queueCombatStateEvent(room, {
      serverTime: now,
      action: COMBAT_EVENT_ACTIONS.KILL,
      attackerId: attacker.id,
      attackerName: attacker.name,
      targetId: target.id,
      targetName: target.name,
      assistantIds: assistContributors.map((e) => e.attackerId),
      assistantNames: assistContributors.map((e) => room.players.get(e.attackerId)?.name ?? null).filter(Boolean),
      damage: resolution.damage,
      hpAfter: 0,
      isCritical: resolution.isCritical,
      armorBlocked: resolution.armorBlocked,
      soundCue: SOUND_CUES.KILL,
      vfxCue: VFX_CUES.KILL_BURST,
      message: `${attacker.name} rammed ${target.name}`
    });

    for (const contribution of assistContributors) {
      const assistant = room.players.get(contribution.attackerId);
      if (!assistant?.alive) {
        continue;
      }
      assistant.assists += 1;
      assistant.credits += GAME_CONFIG.combat.assistCredits;
      queueScoreStateEvent(room, assistant, "assist", now);
      queueInventoryStateEvent(room, assistant, now);
      queueCombatStateEvent(room, {
        serverTime: now,
        action: COMBAT_EVENT_ACTIONS.ASSIST,
        attackerId: assistant.id,
        attackerName: assistant.name,
        targetId: target.id,
        targetName: target.name,
        damage: contribution.damage,
        hpAfter: 0,
        soundCue: SOUND_CUES.ASSIST,
        vfxCue: VFX_CUES.ASSIST_RING,
        message: `${assistant.name} assisted on ${target.name}`
      });
    }

    if (isSoloBotDuelRoom(room)) {
      clearOwnedEntityLifecycle(room, target.id);
    }

    clearCombatContributors(target);
  }
}

function resolveTankBodyCollisions(room, now) {
  if (!isWarmupPhase(room.match.phase) && !isCombatPhase(room.match.phase)) {
    return;
  }

  const alivePlayers = Array.from(room.players.values()).filter(
    (p) => p.alive && !p.isSpectator
  );
  const baseDamage = 8;
  const cooldownMs = 300;

  for (let i = 0; i < alivePlayers.length; i++) {
    for (let j = i + 1; j < alivePlayers.length; j++) {
      const a = alivePlayers[i];
      const b = alivePlayers[j];

      if (a.teamId && b.teamId && a.teamId === b.teamId) {
        continue;
      }

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      const minDist = getPlayerTankRadius(a) + getPlayerTankRadius(b);

      if (distSq >= minDist * minDist) {
        continue;
      }

      const dist = Math.max(0.5, Math.sqrt(distSq));
      const overlap = minDist - dist;
      const nx = dx / dist;
      const ny = dy / dist;
      const push = overlap * 0.5 + 1;

      const { padding, width, height } = GAME_CONFIG.world;
      a.x = clamp(a.x - nx * push, padding, width - padding);
      a.y = clamp(a.y - ny * push, padding, height - padding);
      b.x = clamp(b.x + nx * push, padding, width - padding);
      b.y = clamp(b.y + ny * push, padding, height - padding);

      const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      const cooldown = room.bodyHitCooldowns.get(pairKey) ?? 0;
      if (now < cooldown) {
        continue;
      }
      room.bodyHitCooldowns.set(pairKey, now + cooldownMs);

      if (a.alive) {
        applyBodyHit(room, b, a, baseDamage, now);
      }
      if (b.alive) {
        applyBodyHit(room, a, b, baseDamage, now);
      }
    }
  }

  // Prune stale entries
  if (room.tickNumber % 300 === 0) {
    for (const [key, expiry] of room.bodyHitCooldowns.entries()) {
      if (now > expiry + 5000) {
        room.bodyHitCooldowns.delete(key);
      }
    }
  }
}

function simulateRooms(deltaSeconds, now) {
  reapIdleRooms(now);
  let shouldBroadcast = false;

  for (const [roomId, room] of rooms.entries()) {
    room.tickNumber += 1;
    room.lastSimulatedAt = now;
    expireDisconnectedPlayers(room, now);
    syncRoomOwner(room);
    syncRoomBots(room, now);
    promoteQueuedSpectators(room, now);
    applyAfkState(room, now);

    if (getRestorableHumanPlayerCount(room, now) === 0) {
      deleteRoom(roomId);
      continue;
    }

    updateRoomPhase(room, now);

    for (const player of getPlayersInSimulationOrder(room)) {
      updatePlayer(room, player, deltaSeconds, now);
    }

    resolveTankBodyCollisions(room, now);
    resolvePendingShots(room, now);
    updateBullets(room, deltaSeconds, now);
    updateShapes(room, deltaSeconds, now);
    updateObjective(room, deltaSeconds, now);
    updateRoomPhase(room, now);
    recordRoomHistory(room, now);

    if (room.clients.size > 0 && room.tickNumber > 0 && room.tickNumber % snapshotTickStride === 0) {
      shouldBroadcast = true;
    }
  }

  return shouldBroadcast;
}

function broadcastRooms(now, options = {}) {
  const { force = false } = options;

  for (const room of rooms.values()) {
    if (room.clients.size === 0) {
      continue;
    }

    if (!force && room.tickNumber <= 0) {
      continue;
    }

    if (!force && room.tickNumber % snapshotTickStride !== 0) {
      continue;
    }

    const snapshotSeq = room.nextSnapshotSeq++;

    for (const socket of room.clients) {
      const player = room.players.get(socket.data?.playerId);
      const payload = getRoomStatePayload(room, player, socket, now, snapshotSeq);
      const sent = sendStatePayload(socket, payload);

      if (!sent) {
        markSocketForFullSync(socket);
      }
    }

    room.events.length = 0;
  }
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (socket, request) => {
  const connectedAt = Date.now();
  connectedSocketCount += 1;
  socket.data = {
    playerId: crypto.randomUUID(),
    roomId: null,
    accountId: null,
    playerName: null,
    profileId: null,
    sessionId: null,
    origin: request.headers.origin ?? null,
    remoteAddress: getRequestIp(request),
    userAgent: getUserAgentText(request.headers["user-agent"]),
    lastHeardAt: connectedAt,
    lastHeartbeatPingAt: 0,
    missedHeartbeatCount: 0,
    processedReliableMessages: new Map(),
    outgoingBudget: {
      windowStartedAt: connectedAt,
      sentBytes: 0
    },
    replication: {
      knownEntities: new Map(),
      forceFullSync: true,
      lastFullSyncAt: 0,
      lastSnapshotSeq: 0
    },
    inputBucket: {
      startedAt: connectedAt,
      count: 0
    },
    messageBucket: {
      startedAt: connectedAt,
      count: 0
    },
    controlBucket: {
      startedAt: connectedAt,
      count: 0
    },
    invalidPacketBucket: {
      startedAt: connectedAt,
      count: 0
    }
  };

  socket.on("pong", () => {
    socket.data.lastHeardAt = Date.now();
    socket.data.missedHeartbeatCount = 0;
  });

  socket.on("message", (rawMessage) => {
    const receivedAt = Date.now();
    socket.data.lastHeardAt = receivedAt;
    socket.data.missedHeartbeatCount = 0;
    const parsed = deserializePacket(String(rawMessage));

    if (!parsed.ok) {
      if (parsed.error.code === "unsupported_version" || parsed.error.code === "invalid_version") {
        rejectIncompatibleSocket(socket, parsed.error.code, parsed.error.message, 4006);
        return;
      }

      recordInvalidPacket(socket, parsed.error, receivedAt);
      sendJson(socket, {
        type: MESSAGE_TYPES.ERROR,
        code: parsed.error.code,
        message: parsed.error.message
      }, { critical: true });
      return;
    }

    const payload = parsed.packet;
    if (!enforceSocketMessageRate(socket, payload.type, receivedAt)) {
      return;
    }

    switch (payload.type) {
      case MESSAGE_TYPES.JOIN:
        if (resendAckForDuplicate(socket, payload)) {
          return;
        }
        joinRoom(socket, payload);
        acknowledgeReliableMessage(socket, payload);
        break;
      case MESSAGE_TYPES.LOBBY:
        if (resendAckForDuplicate(socket, payload)) {
          return;
        }
        handleLobby(socket, payload);
        acknowledgeReliableMessage(socket, payload);
        break;
      case MESSAGE_TYPES.READY:
        if (resendAckForDuplicate(socket, payload)) {
          return;
        }
        handleReady(socket, payload);
        acknowledgeReliableMessage(socket, payload);
        break;
      case MESSAGE_TYPES.RESPAWN:
        if (resendAckForDuplicate(socket, payload)) {
          return;
        }
        handleRespawn(socket);
        acknowledgeReliableMessage(socket, payload);
        break;
      case MESSAGE_TYPES.RESYNC:
        if (resendAckForDuplicate(socket, payload)) {
          return;
        }
        handleResync(socket, payload);
        acknowledgeReliableMessage(socket, payload);
        break;
      case MESSAGE_TYPES.UPGRADE:
        if (resendAckForDuplicate(socket, payload)) {
          return;
        }
        handleUpgrade(socket, payload);
        acknowledgeReliableMessage(socket, payload);
        break;
      case MESSAGE_TYPES.SPECIALIZATION:
        if (resendAckForDuplicate(socket, payload)) {
          return;
        }
        handleSpecialization(socket, payload);
        acknowledgeReliableMessage(socket, payload);
        break;
      case MESSAGE_TYPES.STAT_POINT:
        if (resendAckForDuplicate(socket, payload)) {
          return;
        }
        handleStatPoint(socket, payload);
        acknowledgeReliableMessage(socket, payload);
        break;
      case MESSAGE_TYPES.INPUT:
        handleInput(socket, payload, receivedAt);
        break;
      case MESSAGE_TYPES.PING:
        sendJson(socket, {
          type: MESSAGE_TYPES.PONG,
          sentAt: Number(payload.sentAt) || receivedAt
        }, { critical: true });
        break;
      default:
        sendJson(socket, {
          type: MESSAGE_TYPES.ERROR,
          message: `Unsupported message type: ${payload.type}`
        }, { critical: true });
    }
  });

  socket.on("error", (error) => {
    console.error("WebSocket error", {
      roomId: socket.data?.roomId ?? null,
      playerId: socket.data?.playerId ?? null,
      profileId: socket.data?.profileId ?? null,
      remoteAddress: socket.data?.remoteAddress ?? null,
      message: error?.message ?? String(error)
    });
  });

  socket.on("close", (code, reasonBuffer) => {
    connectedSocketCount = Math.max(0, connectedSocketCount - 1);
    console.log("WebSocket closed", {
      roomId: socket.data?.roomId ?? null,
      playerId: socket.data?.playerId ?? null,
      profileId: socket.data?.profileId ?? null,
      remoteAddress: socket.data?.remoteAddress ?? null,
      code,
      reason: Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString("utf8") : String(reasonBuffer ?? ""),
      connectedForMs: Date.now() - connectedAt,
      silenceMs: Date.now() - Number(socket.data?.lastHeardAt ?? connectedAt)
    });
    removeSocketFromRoom(socket, { preserveForReconnect: true });
  });
});

server.on("upgrade", (request, socket, head) => {
  const verdict = shouldAllowWebSocketUpgrade(request);
  if (!verdict.allowed) {
    rejectUpgrade(socket, verdict.statusCode, verdict.message);
    return;
  }

  wss.handleUpgrade(request, socket, head, (websocket) => {
    wss.emit("connection", websocket, request);
  });
});

const fixedTickMs = 1000 / GAME_CONFIG.serverTickRate;
const fixedDeltaSeconds = fixedTickMs / 1000;
const maxSimulationFrameMs = fixedTickMs * GAME_CONFIG.simulation.maxCatchUpTicks;
const snapshotTickStride = Math.max(1, Math.round(GAME_CONFIG.serverTickRate / GAME_CONFIG.snapshotRate));
let lastRealtimeTickAt = Date.now();
let simulationAccumulatorMs = 0;
let lastSimulatedAt = lastRealtimeTickAt;
let simulatedNowMs = lastRealtimeTickAt;
const simulationInterval = setInterval(() => {
  const realtimeNow = Date.now();
  const elapsedMs = Math.max(0, realtimeNow - lastRealtimeTickAt);
  lastRealtimeTickAt = realtimeNow;
  simulationAccumulatorMs = Math.min(simulationAccumulatorMs + elapsedMs, maxSimulationFrameMs);

  let processedTicks = 0;
  while (simulationAccumulatorMs >= fixedTickMs && processedTicks < GAME_CONFIG.simulation.maxCatchUpTicks) {
    simulatedNowMs += fixedTickMs;
    lastSimulatedAt = Math.round(simulatedNowMs);
    const shouldBroadcast = simulateRooms(fixedDeltaSeconds, lastSimulatedAt);

    if (shouldBroadcast) {
      broadcastRooms(lastSimulatedAt);
    }
    simulationAccumulatorMs -= fixedTickMs;
    processedTicks += 1;
  }
}, fixedTickMs);

const heartbeatInterval = setInterval(() => {
  const now = Date.now();

  for (const socket of wss.clients) {
    if (socket.readyState !== socket.OPEN) {
      continue;
    }

    if (now - socket.data.lastHeardAt > GAME_CONFIG.network.heartbeatTimeoutMs) {
      socket.data.missedHeartbeatCount = Number(socket.data.missedHeartbeatCount ?? 0) + 1;
      if (socket.data.missedHeartbeatCount > GAME_CONFIG.network.maxMissedHeartbeats) {
        socket.terminate();
        continue;
      }

      socket.data.lastHeartbeatPingAt = now;
      socket.ping();
      continue;
    }

    socket.data.missedHeartbeatCount = 0;

    if (now - socket.data.lastHeartbeatPingAt >= GAME_CONFIG.network.heartbeatIntervalMs) {
      socket.data.lastHeartbeatPingAt = now;
      socket.ping();
    }
  }
}, GAME_CONFIG.network.heartbeatIntervalMs);

await loadProfiles();
await loadBackend();

async function shutdown(signal, options = {}) {
  const { exitCode = 0 } = options;
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  updateOperationalMode({
    maintenanceMode: true,
    draining: true,
    reason: signal
  });
  operationsState.shutdownRequestedAt = new Date().toISOString();
  operationsState.shutdownReason = signal;
  if (exitCode === 0) {
    operationsCounters.cleanShutdowns += 1;
  } else {
    operationsCounters.fatalShutdowns += 1;
  }
  console.log(`Received ${signal}, shutting down gracefully`);

  clearInterval(simulationInterval);
  clearInterval(heartbeatInterval);

  const shutdownAt = Date.now();
  for (const room of rooms.values()) {
    setRoomPhase(room, MATCH_PHASES.SHUTDOWN, shutdownAt, getCurrentWinner(room), {
      shutdownReason: signal
    });
  }
  broadcastRooms(shutdownAt, { force: true });
  await new Promise((resolve) => setTimeout(resolve, GAME_CONFIG.match.shutdownGraceMs));

  for (const socket of wss.clients) {
    try {
      socket.close(1001, "Server shutting down");
    } catch (error) {
      console.error("Failed to close socket", error);
    }
  }

  await flushProfiles();
  await flushBackend();

  await new Promise((resolve) => {
    server.close(() => resolve());
  });

  process.exit(exitCode);
}

function handleFatalProcessError(kind, error) {
  console.error(`Fatal ${kind}`, error);
  shutdown(kind, { exitCode: 1 });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

process.on("uncaughtException", (error) => {
  handleFatalProcessError("uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  handleFatalProcessError(
    "unhandledRejection",
    reason instanceof Error ? reason : new Error(sanitizeLooseText(reason, "Unknown rejection", 200))
  );
});

server.listen(port, host, () => {
  console.log(`Multitank server listening on http://${host}:${port}`);
});
