export const PROTOCOL_VERSION = 2;
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;
export const GAME_BUILD_VERSION = "0.1.0";
export const ASSET_BUNDLE_VERSION = GAME_BUILD_VERSION;
export const PROFILES_SCHEMA_VERSION = 2;

export const MESSAGE_TYPES = Object.freeze({
  JOIN: "join",
  JOINED: "joined",
  LOBBY: "lobby",
  INPUT: "input",
  READY: "ready",
  RESPAWN: "respawn",
  RESYNC: "resync",
  STATE: "state",
  STATE_CHUNK: "state_chunk",
  ACK: "ack",
  PING: "ping",
  PONG: "pong",
  ERROR: "error"
});

export const MATCH_PHASES = Object.freeze({
  WAITING: "waiting",
  WARMUP: "warmup",
  COUNTDOWN: "warmup",
  LIVE_ROUND: "live_round",
  IN_PROGRESS: "live_round",
  OVERTIME: "overtime",
  PAUSE: "pause",
  PAUSED: "pause",
  ROUND_END: "round_end",
  RESULTS: "results",
  FINISHED: "results",
  MAP_TRANSITION: "map_transition",
  SHUTDOWN: "shutdown"
});

export const EVENT_TYPES = Object.freeze({
  SPAWN: "spawn",
  HIT: "hit",
  HEALTH: "health",
  SCORE: "score",
  ROUND: "round",
  INVENTORY: "inventory",
  ANIMATION: "animation",
  COMBAT: "combat"
});

export const ANIMATION_POSES = Object.freeze({
  IDLE: "idle",
  MOVE: "move",
  REVERSE: "reverse",
  DEAD: "dead"
});

export const ANIMATION_ACTIONS = Object.freeze({
  NONE: "none",
  RELOAD: "reload",
  FIRE: "fire",
  HIT: "hit",
  SPAWN: "spawn",
  DEATH: "death",
  STUN: "stun",
  EMOTE: "emote"
});

export const STATUS_EFFECTS = Object.freeze({
  NONE: "none",
  STUN: "stun"
});

export const COMBAT_EVENT_ACTIONS = Object.freeze({
  DAMAGE: "damage",
  KILL: "kill",
  ASSIST: "assist",
  STATUS: "status",
  EFFECT: "effect"
});

export const SOUND_CUES = Object.freeze({
  NONE: "none",
  HIT: "hit",
  CRIT: "crit",
  KILL: "kill",
  ASSIST: "assist",
  STUN: "stun",
  ARMOR: "armor"
});

export const VFX_CUES = Object.freeze({
  NONE: "none",
  IMPACT: "impact",
  CRIT_BURST: "crit_burst",
  ARMOR_SPARK: "armor_spark",
  KILL_BURST: "kill_burst",
  ASSIST_RING: "assist_ring",
  STUN_WAVE: "stun_wave"
});

export const REPLICATION_KINDS = Object.freeze({
  PLAYER: "player",
  BULLET: "bullet",
  OBJECTIVE: "objective"
});

export const BOT_AI_INTENTS = Object.freeze({
  IDLE: "idle",
  CAPTURE: "capture",
  ENGAGE: "engage",
  REPOSITION: "reposition",
  RETREAT: "retreat",
  RECOVER: "recover"
});

const INPUT_FLAGS = Object.freeze({
  FORWARD: 1,
  BACK: 2,
  LEFT: 4,
  RIGHT: 8,
  SHOOT: 16
});

export const GAME_CONFIG = Object.freeze({
  serverTickRate: 30,
  snapshotRate: 30,
  inputRate: 20,
  input: Object.freeze({
    maxBufferedInputs: 120,
    maxClientInputAgeMs: 2000,
    maxClientInputLeadMs: 250
  }),
  network: Object.freeze({
    reliableResendMs: 750,
    maxReliableHistory: 256,
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 180000,
    maxMissedHeartbeats: 6,
    maxOutgoingBytesPerSecond: 96000,
    maxStatePayloadBytes: 12000,
    stateChunkChars: 7000,
    maxPacketBytes: 65536,
    maxRecentEvents: 48
  }),
  replication: Object.freeze({
    fullSyncIntervalMs: 5000,
    cellSize: 400,
    bulletInterestRadius: 960,
    maxPlayerRecordsPerSnapshot: 16,
    maxBulletRecordsPerSnapshot: 32
  }),
  visibility: Object.freeze({
    playerVisionRadius: 1280,
    bulletVisionRadius: 1320,
    objectiveVisionRadius: 1500
  }),
  simulation: Object.freeze({
    maxCatchUpTicks: 5
  }),
  maxDeltaSeconds: 0.05,
  world: Object.freeze({
    width: 9600,
    height: 5400,
    padding: 80,
    teamZoneWidth: 1056,
    obstacles: Object.freeze([])
  }),
  objective: Object.freeze({
    x: 1600,
    y: 900,
    radius: 130,
    captureSeconds: 2.5,
    scoreReward: 1,
    creditsReward: 20,
    rewardIntervalMs: 2000
  }),
  spawn: Object.freeze({
    protectionMs: 12000,
    safeEnemyDistance: 1800,
    safeRespawnDistance: 1200
  }),
  tank: Object.freeze({
    radius: 22,
    speed: 220,
    reverseSpeed: 140,
    turnSpeed: 2.7,
    hitPoints: 100,
    shootCooldownMs: 350,
    maxInputJitterRadians: Math.PI
  }),
  bullet: Object.freeze({
    radius: 10,
    speed: 700,
    damage: 25,
    lifeMs: 1400
  }),
  combat: Object.freeze({
    assistWindowMs: 6000,
    assistCredits: 10,
    critFloorDamage: 1,
    classProfiles: Object.freeze({
      striker: Object.freeze({
        damageMultiplier: 1,
        armorMultiplier: 1,
        critChance: 0.1,
        critMultiplier: 1.35,
        statusEffect: STATUS_EFFECTS.NONE,
        statusChance: 0,
        statusDurationMs: 0
      }),
      scout: Object.freeze({
        damageMultiplier: 0.95,
        armorMultiplier: 1.12,
        critChance: 0.17,
        critMultiplier: 1.5,
        statusEffect: STATUS_EFFECTS.STUN,
        statusChance: 0.18,
        statusDurationMs: 550
      }),
      vanguard: Object.freeze({
        damageMultiplier: 1.05,
        armorMultiplier: 0.82,
        critChance: 0.06,
        critMultiplier: 1.28,
        statusEffect: STATUS_EFFECTS.STUN,
        statusChance: 0.08,
        statusDurationMs: 400
      })
    })
  }),
  match: Object.freeze({
    minPlayers: 2,
    continuousMode: false,
    survivalMode: true,
    warmupMs: 3000,
    countdownMs: 3000,
    durationMs: 90000,
    roundEndMs: 2000,
    autoRestartRound: true,
    resultsMs: 4000,
    mapTransitionMs: 2000,
    shutdownGraceMs: 1000,
    resetDelayMs: 6000,
    scoreToWin: 1
  }),
  lobby: Object.freeze({
    maps: Object.freeze([
      Object.freeze({ id: "frontier", name: "Frontier Depot", summary: "Balanced prototype arena" }),
      Object.freeze({ id: "switchyard", name: "Switchyard", summary: "Wider sight lines and objective pressure" }),
      Object.freeze({ id: "citadel", name: "Citadel", summary: "Tighter lanes for close fights" })
    ]),
    teams: Object.freeze([
      Object.freeze({
        id: "alpha",
        name: "Blue Team",
        color: "#2563eb",
        zoneColor: "rgba(37, 99, 235, 0.28)",
        spawnSide: "left"
      }),
      Object.freeze({
        id: "bravo",
        name: "Red Team",
        color: "#dc2626",
        zoneColor: "rgba(220, 38, 38, 0.28)",
        spawnSide: "right"
      })
    ]),
    classes: Object.freeze([
      Object.freeze({ id: "striker", name: "Striker", summary: "Balanced all-round tank" }),
      Object.freeze({ id: "scout", name: "Scout", summary: "Fast mover with lighter armor" }),
      Object.freeze({ id: "vanguard", name: "Vanguard", summary: "Heavy hull with slower pace" })
    ])
  }),
  antiCheat: Object.freeze({
    enabled: false,
    maxInputsPerSecond: 40,
    maxMessagesPerSecond: 120,
    maxControlMessagesPerSecond: 24,
    maxDuplicateInputsPerSecond: 12,
    maxInputSequenceJump: 240,
    maxViolationPoints: 6,
    violationDecayMs: 15000,
    maxPositionCorrectionDistance: 96,
    maxInventorySlots: 4,
    maxInventoryAmount: 4,
    allowedInventoryItemIds: Object.freeze(["shell-cannon"]),
    maxNameChangesPerMinute: 3
  }),
  lagCompensation: Object.freeze({
    historyMs: 1500,
    maxProjectileCompensationMs: 120,
    fairnessBiasMs: 35,
    projectileCatchupStepMs: 16,
    maxHistoricalSampleGapMs: 250
  }),
  economy: Object.freeze({
    killCredits: 25,
    deathCredits: 5,
    respawnCredits: 10
  }),
  ai: Object.freeze({
    fillToMinPlayers: false,
    botsPerTeam: 2,
    maxBotsPerRoom: 4,
    thinkRate: 10,
    preferredRange: 300,
    shootRange: 520,
    aimToleranceRadians: 0.3,
    obstacleClearance: 34,
    waypointReachDistance: 34,
    repathIntervalMs: 900,
    repathLossOfSightMs: 500,
    repathGoalThreshold: 48,
    stuckDistance: 18,
    stuckTimeoutMs: 850,
    flankDistance: 150,
    retreatDistance: 190,
    maxRouteNodes: 10,
    targetSwitchScoreBias: 120
  }),
  session: Object.freeze({
    maxHumanPlayersPerRoom: 4,
    maxSpectatorsPerRoom: 8,
    reconnectGraceMs: 90000,
    reconnectRetryMs: 5000,
    maxReconnectRetryMs: 20000,
    afkTimeoutMs: 60000
  }),
  respawnDelayMs: 2000,
  maxRoomIdLength: 24,
  maxPlayerNameLength: 16,
  maxProfileIdLength: 64
});

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getTeamConfig(teamId) {
  return GAME_CONFIG.lobby.teams.find((team) => team.id === teamId) ?? GAME_CONFIG.lobby.teams[0] ?? null;
}

export function getTeamSpawnZone(teamId) {
  const team = getTeamConfig(teamId);
  const { width, height, padding, teamZoneWidth } = GAME_CONFIG.world;
  const usableWidth = Math.max(0, width - padding * 2);
  const usableHeight = Math.max(0, height - padding * 2);
  const resolvedZoneWidth = clamp(
    Number.isFinite(Number(teamZoneWidth)) ? Number(teamZoneWidth) : usableWidth / 4,
    GAME_CONFIG.tank.radius * 6,
    Math.max(GAME_CONFIG.tank.radius * 6, usableWidth / 2)
  );
  const spawnSide = team?.spawnSide === "right" ? "right" : "left";
  const left = spawnSide === "left" ? padding : width - padding - resolvedZoneWidth;

  return {
    teamId: team?.id ?? GAME_CONFIG.lobby.teams[0]?.id ?? "alpha",
    name: team?.name ?? "Blue Team",
    color: team?.color ?? "#2563eb",
    zoneColor: team?.zoneColor ?? "rgba(37, 99, 235, 0.16)",
    spawnSide,
    left,
    right: left + resolvedZoneWidth,
    top: padding,
    bottom: height - padding,
    width: resolvedZoneWidth,
    height: usableHeight,
    centerX: left + resolvedZoneWidth / 2,
    centerY: padding + usableHeight / 2
  };
}

export function createNetworkId(kind, id) {
  const safeKind = sanitizeText(kind ?? "", "", 24);
  const safeId = sanitizeText(id ?? "", "", 96);
  return safeKind && safeId ? `${safeKind}:${safeId}` : null;
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function clampInteger(value, min, max, fallback = min) {
  return clamp(readInteger(value, fallback), min, max);
}

function readBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === 0 || value === "0" || value === "false") {
    return false;
  }

  return fallback;
}

function sanitizeText(value, fallback = "", maxLength = 128) {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);

  return normalized || fallback;
}

function sanitizeLobbyOptionId(value, options, fallback) {
  const candidate = sanitizeText(value ?? "", "", 24);
  return options.some((option) => option.id === candidate) ? candidate : fallback;
}

export function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  let nextAngle = readFiniteNumber(angle, 0) % twoPi;

  if (nextAngle > Math.PI) {
    nextAngle -= twoPi;
  }

  if (nextAngle < -Math.PI) {
    nextAngle += twoPi;
  }

  return nextAngle;
}

export function sanitizeRoomId(value) {
  const normalized = String(value ?? "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, GAME_CONFIG.maxRoomIdLength);

  return normalized || "default";
}

export function sanitizePlayerName(value) {
  const normalized = String(value ?? "Commander")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, GAME_CONFIG.maxPlayerNameLength);

  return normalized || "Commander";
}

export function sanitizeProfileId(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, GAME_CONFIG.maxProfileIdLength);

  return normalized || null;
}

export function sanitizeAuthToken(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 256);

  return normalized || null;
}

export function sanitizeSessionId(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 96);

  return normalized || null;
}

export function sanitizeMessageId(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, 96);

  return normalized || null;
}

function sanitizeProtocolVersion(value) {
  if (value === undefined || value === null) {
    return 1;
  }

  const version = Number(value);
  return Number.isInteger(version) ? version : null;
}

function buildParseError(message, code = "invalid_packet") {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}

export function encodeInputFlags(input) {
  let flags = 0;

  if (readBoolean(input.forward)) {
    flags |= INPUT_FLAGS.FORWARD;
  }

  if (readBoolean(input.back)) {
    flags |= INPUT_FLAGS.BACK;
  }

  if (readBoolean(input.left)) {
    flags |= INPUT_FLAGS.LEFT;
  }

  if (readBoolean(input.right)) {
    flags |= INPUT_FLAGS.RIGHT;
  }

  if (readBoolean(input.shoot)) {
    flags |= INPUT_FLAGS.SHOOT;
  }

  return flags;
}

export function decodeInputFlags(flags) {
  const value = clampInteger(flags, 0, 31, 0);
  return {
    forward: Boolean(value & INPUT_FLAGS.FORWARD),
    back: Boolean(value & INPUT_FLAGS.BACK),
    left: Boolean(value & INPUT_FLAGS.LEFT),
    right: Boolean(value & INPUT_FLAGS.RIGHT),
    shoot: Boolean(value & INPUT_FLAGS.SHOOT)
  };
}

function sanitizeProfileStats(stats) {
  return {
    matchesPlayed: Math.max(0, readInteger(stats?.matchesPlayed, 0)),
    wins: Math.max(0, readInteger(stats?.wins, 0)),
    kills: Math.max(0, readInteger(stats?.kills, 0)),
    deaths: Math.max(0, readInteger(stats?.deaths, 0)),
    shotsFired: Math.max(0, readInteger(stats?.shotsFired, 0)),
    shotsHit: Math.max(0, readInteger(stats?.shotsHit, 0)),
    accuracy: clamp(readFiniteNumber(stats?.accuracy, 0), 0, 100)
  };
}

export function createPublicProfileStats(stats) {
  const normalized = sanitizeProfileStats(stats);
  return {
    matchesPlayed: normalized.matchesPlayed,
    wins: normalized.wins,
    kills: normalized.kills,
    deaths: normalized.deaths,
    accuracy: roundTo(normalized.accuracy, 1)
  };
}

export function createAnimationState(animation) {
  const locomotion = Object.values(ANIMATION_POSES).includes(animation?.locomotion)
    ? animation.locomotion
    : ANIMATION_POSES.IDLE;
  const overlayAction = Object.values(ANIMATION_ACTIONS).includes(animation?.overlayAction)
    ? animation.overlayAction
    : ANIMATION_ACTIONS.NONE;
  const eventAction = Object.values(ANIMATION_ACTIONS).includes(animation?.eventAction)
    ? animation.eventAction
    : ANIMATION_ACTIONS.NONE;

  return {
    locomotion,
    overlayAction,
    eventAction,
    eventSeq: Math.max(0, readInteger(animation?.eventSeq, 0)),
    eventStartedAt: Number.isFinite(Number(animation?.eventStartedAt)) ? Number(animation.eventStartedAt) : null,
    moveBlend: clamp(roundTo(readFiniteNumber(animation?.moveBlend, 0), 3), 0, 1),
    aimOffset: roundTo(normalizeAngle(animation?.aimOffset), 4),
    upperBodySync: clamp(roundTo(readFiniteNumber(animation?.upperBodySync, 0), 3), 0, 1),
    reloadFraction: clamp(roundTo(readFiniteNumber(animation?.reloadFraction, 0), 3), 0, 1),
    trackPhase: clamp(roundTo(readFiniteNumber(animation?.trackPhase, 0), 3), 0, 1),
    stunRemainingMs: Math.max(0, readInteger(animation?.stunRemainingMs, 0)),
    emoteId: sanitizeText(animation?.emoteId ?? "", "", 32) || null
  };
}

export function createInventoryState(playerOrState) {
  const playerId = sanitizeText(playerOrState?.playerId ?? playerOrState?.id ?? "", "", 96);
  const slotsSource = Array.isArray(playerOrState?.slots)
    ? playerOrState.slots
    : Array.isArray(playerOrState?.inventory?.slots)
      ? playerOrState.inventory.slots
      : [];

  return {
    playerId,
    revision: Math.max(0, readInteger(playerOrState?.revision ?? playerOrState?.inventory?.revision, 0)),
    slots: slotsSource
      .slice(0, 16)
      .map((slot) => ({
        slot: sanitizeText(slot?.slot ?? "", "", 24),
        itemId: sanitizeText(slot?.itemId ?? "", "", 48),
        amount: Math.max(0, readInteger(slot?.amount, 0))
      }))
      .filter((slot) => slot.slot || slot.itemId)
  };
}

export function createRoundSnapshot(match, roundNumber = 0) {
  return {
    phase: Object.values(MATCH_PHASES).includes(match?.phase) ? match.phase : MATCH_PHASES.WAITING,
    phaseEndsAt: Number.isFinite(Number(match?.phaseEndsAt)) ? Number(match.phaseEndsAt) : null,
    winnerId: sanitizeText(match?.winnerId ?? "", "", 96) || null,
    winnerName: sanitizeText(match?.winnerName ?? "", "", GAME_CONFIG.maxPlayerNameLength) || null,
    roundNumber: Math.max(0, readInteger(roundNumber ?? match?.roundNumber, 0)),
    message: sanitizeText(match?.message ?? "Waiting for players", "Waiting for players", 96),
    minPlayers: Math.max(1, readInteger(match?.minPlayers ?? GAME_CONFIG.match.minPlayers, GAME_CONFIG.match.minPlayers)),
    scoreToWin: Math.max(1, readInteger(match?.scoreToWin ?? GAME_CONFIG.match.scoreToWin, GAME_CONFIG.match.scoreToWin)),
    respawnsEnabled: readBoolean(match?.respawnsEnabled, false)
  };
}

export function createObjectiveSnapshot(objective) {
  return {
    x: roundTo(readFiniteNumber(objective?.x, GAME_CONFIG.objective.x), 2),
    y: roundTo(readFiniteNumber(objective?.y, GAME_CONFIG.objective.y), 2),
    radius: roundTo(readFiniteNumber(objective?.radius, GAME_CONFIG.objective.radius), 2),
    ownerId: sanitizeText(objective?.ownerId ?? "", "", 96) || null,
    ownerName: sanitizeText(objective?.ownerName ?? "", "", GAME_CONFIG.maxPlayerNameLength) || null,
    captureTargetId: sanitizeText(objective?.captureTargetId ?? "", "", 96) || null,
    captureTargetName:
      sanitizeText(objective?.captureTargetName ?? "", "", GAME_CONFIG.maxPlayerNameLength) || null,
    captureProgress: clamp(roundTo(readFiniteNumber(objective?.captureProgress, 0), 3), 0, 1),
    contested: readBoolean(objective?.contested, false),
    nextRewardAt: Number.isFinite(Number(objective?.nextRewardAt)) ? Number(objective.nextRewardAt) : null
  };
}

export function createLobbySnapshot(lobby) {
  const defaultMap = GAME_CONFIG.lobby.maps[0];
  const mapId = sanitizeLobbyOptionId(lobby?.mapId, GAME_CONFIG.lobby.maps, defaultMap.id);
  const mapName = GAME_CONFIG.lobby.maps.find((entry) => entry.id === mapId)?.name ?? defaultMap.name;

  return {
    roomCode: sanitizeRoomId(lobby?.roomCode),
    ownerPlayerId: sanitizeText(lobby?.ownerPlayerId ?? "", "", 96) || null,
    ownerName: sanitizeText(lobby?.ownerName ?? "", "", GAME_CONFIG.maxPlayerNameLength) || null,
    mapId,
    mapName: sanitizeText(lobby?.mapName ?? mapName, mapName, 48),
    rematchVotes: Math.max(0, readInteger(lobby?.rematchVotes, 0)),
    activePlayers: Math.max(0, readInteger(lobby?.activePlayers, 0)),
    spectators: Math.max(0, readInteger(lobby?.spectators, 0))
  };
}

export function createLeaderboardEntry(player) {
  return {
    id: sanitizeText(player?.id ?? "", "", 96),
    name: sanitizePlayerName(player?.name),
    ready: readBoolean(player?.ready, false),
    credits: Math.max(0, readInteger(player?.credits, 0)),
    score: Math.max(0, readInteger(player?.score, 0)),
    assists: Math.max(0, readInteger(player?.assists, 0)),
    deaths: Math.max(0, readInteger(player?.deaths, 0)),
    connected: readBoolean(player?.connected, true),
    isBot: readBoolean(player?.isBot, false),
    isSpectator: readBoolean(player?.isSpectator, false),
    teamId: sanitizeLobbyOptionId(player?.teamId, GAME_CONFIG.lobby.teams, GAME_CONFIG.lobby.teams[0].id),
    classId: sanitizeLobbyOptionId(
      player?.classId,
      GAME_CONFIG.lobby.classes,
      GAME_CONFIG.lobby.classes[0].id
    ),
    queuedForSlot: readBoolean(player?.queuedForSlot, false),
    slotReserved: readBoolean(player?.slotReserved, false),
    afk: readBoolean(player?.afk, false)
  };
}

export function createPlayerCombatState(combat) {
  const statusEffect = Object.values(STATUS_EFFECTS).includes(combat?.statusEffect)
    ? combat.statusEffect
    : STATUS_EFFECTS.NONE;
  const stunRemainingMs = Math.max(0, readInteger(combat?.stunRemainingMs, 0));
  return {
    armorMultiplier: clamp(roundTo(readFiniteNumber(combat?.armorMultiplier, 1), 3), 0.1, 3),
    damageMultiplier: clamp(roundTo(readFiniteNumber(combat?.damageMultiplier, 1), 3), 0.1, 3),
    critChance: clamp(roundTo(readFiniteNumber(combat?.critChance, 0), 3), 0, 1),
    critMultiplier: clamp(roundTo(readFiniteNumber(combat?.critMultiplier, 1), 3), 1, 4),
    statusEffect: stunRemainingMs > 0 ? STATUS_EFFECTS.STUN : statusEffect,
    statusDurationMs: Math.max(0, readInteger(combat?.statusDurationMs, 0)),
    stunned: readBoolean(combat?.stunned ?? stunRemainingMs > 0, stunRemainingMs > 0),
    stunRemainingMs,
    lastDamagedAt: Number.isFinite(Number(combat?.lastDamagedAt)) ? Number(combat.lastDamagedAt) : null
  };
}

function createBotAiSnapshot(ai) {
  const intent = Object.values(BOT_AI_INTENTS).includes(ai?.intent) ? ai.intent : BOT_AI_INTENTS.IDLE;
  const goalX = ai?.goalX;
  const goalY = ai?.goalY;
  const waypointX = ai?.waypointX;
  const waypointY = ai?.waypointY;
  return {
    intent,
    targetId: sanitizeText(ai?.targetId ?? "", "", 96) || null,
    goalX: Number.isFinite(Number(goalX)) ? roundTo(readFiniteNumber(goalX, 0), 2) : null,
    goalY: Number.isFinite(Number(goalY)) ? roundTo(readFiniteNumber(goalY, 0), 2) : null,
    waypointX: Number.isFinite(Number(waypointX)) ? roundTo(readFiniteNumber(waypointX, 0), 2) : null,
    waypointY: Number.isFinite(Number(waypointY)) ? roundTo(readFiniteNumber(waypointY, 0), 2) : null,
    pathIndex: Math.max(0, readInteger(ai?.pathIndex, 0)),
    pathLength: Math.max(0, readInteger(ai?.pathLength, 0)),
    hasLineOfSight: readBoolean(ai?.hasLineOfSight, false),
    stuck: readBoolean(ai?.stuck, false)
  };
}

export function createPlayerSnapshot(player) {
  return {
    id: sanitizeText(player?.id ?? "", "", 96),
    profileId: sanitizeProfileId(player?.profileId),
    name: sanitizePlayerName(player?.name),
    color: sanitizeText(player?.color ?? "#ffffff", "#ffffff", 16),
    x: roundTo(readFiniteNumber(player?.x, 0), 2),
    y: roundTo(readFiniteNumber(player?.y, 0), 2),
    angle: roundTo(normalizeAngle(player?.angle), 4),
    turretAngle: roundTo(normalizeAngle(player?.turretAngle), 4),
    hp: clampInteger(player?.hp, 0, GAME_CONFIG.tank.hitPoints, GAME_CONFIG.tank.hitPoints),
    credits: Math.max(0, readInteger(player?.credits, 0)),
    score: Math.max(0, readInteger(player?.score, 0)),
    assists: Math.max(0, readInteger(player?.assists, 0)),
    deaths: Math.max(0, readInteger(player?.deaths, 0)),
    alive: readBoolean(player?.alive, true),
    ready: readBoolean(player?.ready, false),
    connected: readBoolean(player?.connected, true),
    isBot: readBoolean(player?.isBot, false),
    isSpectator: readBoolean(player?.isSpectator, false),
    teamId: sanitizeLobbyOptionId(player?.teamId, GAME_CONFIG.lobby.teams, GAME_CONFIG.lobby.teams[0].id),
    classId: sanitizeLobbyOptionId(
      player?.classId,
      GAME_CONFIG.lobby.classes,
      GAME_CONFIG.lobby.classes[0].id
    ),
    queuedForSlot: readBoolean(player?.queuedForSlot, false),
    slotReserved: readBoolean(player?.slotReserved, false),
    afk: readBoolean(player?.afk, false),
    animation: createAnimationState(player?.animation),
    combat: createPlayerCombatState(player?.combat),
    ai: readBoolean(player?.isBot, false) ? createBotAiSnapshot(player?.ai) : null,
    seq: Math.max(0, readInteger(player?.seq ?? player?.lastProcessedInputSeq, 0)),
    respawnAt: Number.isFinite(Number(player?.respawnAt)) ? Number(player.respawnAt) : null,
    disconnectedAt: Number.isFinite(Number(player?.disconnectedAt)) ? Number(player.disconnectedAt) : null,
    reconnectDeadlineAt:
      Number.isFinite(Number(player?.reconnectDeadlineAt)) ? Number(player.reconnectDeadlineAt) : null
  };
}

export function createBulletSnapshot(bullet) {
  return {
    id: sanitizeText(bullet?.id ?? "", "", 96),
    ownerId: sanitizeText(bullet?.ownerId ?? "", "", 96),
    x: roundTo(readFiniteNumber(bullet?.x, 0), 2),
    y: roundTo(readFiniteNumber(bullet?.y, 0), 2),
    angle: roundTo(normalizeAngle(bullet?.angle), 4)
  };
}

export function createSpawnEvent(event) {
  return {
    id: sanitizeText(event?.id ?? "", "", 96),
    type: EVENT_TYPES.SPAWN,
    serverTime: Number(event?.serverTime ?? Date.now()),
    playerId: sanitizeText(event?.playerId ?? "", "", 96),
    x: roundTo(readFiniteNumber(event?.x, 0), 2),
    y: roundTo(readFiniteNumber(event?.y, 0), 2),
    hp: clampInteger(event?.hp, 0, GAME_CONFIG.tank.hitPoints, GAME_CONFIG.tank.hitPoints)
  };
}

export function createHitEvent(event) {
  return {
    id: sanitizeText(event?.id ?? "", "", 96),
    type: EVENT_TYPES.HIT,
    serverTime: Number(event?.serverTime ?? Date.now()),
    attackerId: sanitizeText(event?.attackerId ?? "", "", 96),
    targetId: sanitizeText(event?.targetId ?? "", "", 96),
    bulletId: sanitizeText(event?.bulletId ?? "", "", 96),
    damage: Math.max(0, readInteger(event?.damage, 0)),
    hpAfter: clampInteger(event?.hpAfter, 0, GAME_CONFIG.tank.hitPoints, GAME_CONFIG.tank.hitPoints),
    isCritical: readBoolean(event?.isCritical, false),
    armorBlocked: Math.max(0, readInteger(event?.armorBlocked, 0)),
    statusEffect: Object.values(STATUS_EFFECTS).includes(event?.statusEffect)
      ? event.statusEffect
      : STATUS_EFFECTS.NONE,
    statusDurationMs: Math.max(0, readInteger(event?.statusDurationMs, 0))
  };
}

export function createHealthEvent(event) {
  return {
    id: sanitizeText(event?.id ?? "", "", 96),
    type: EVENT_TYPES.HEALTH,
    serverTime: Number(event?.serverTime ?? Date.now()),
    playerId: sanitizeText(event?.playerId ?? "", "", 96),
    hp: clampInteger(event?.hp, 0, GAME_CONFIG.tank.hitPoints, GAME_CONFIG.tank.hitPoints),
    delta: readInteger(event?.delta, 0)
  };
}

export function createScoreEvent(event) {
  return {
    id: sanitizeText(event?.id ?? "", "", 96),
    type: EVENT_TYPES.SCORE,
    serverTime: Number(event?.serverTime ?? Date.now()),
    playerId: sanitizeText(event?.playerId ?? "", "", 96),
    score: Math.max(0, readInteger(event?.score, 0)),
    credits: Math.max(0, readInteger(event?.credits, 0)),
    reason: sanitizeText(event?.reason ?? "", "", 48)
  };
}

export function createRoundEvent(event) {
  return {
    id: sanitizeText(event?.id ?? "", "", 96),
    type: EVENT_TYPES.ROUND,
    serverTime: Number(event?.serverTime ?? Date.now()),
    phase: Object.values(MATCH_PHASES).includes(event?.phase) ? event.phase : MATCH_PHASES.WAITING,
    roundNumber: Math.max(0, readInteger(event?.roundNumber, 0)),
    winnerId: sanitizeText(event?.winnerId ?? "", "", 96) || null,
    winnerName: sanitizeText(event?.winnerName ?? "", "", GAME_CONFIG.maxPlayerNameLength) || null,
    message: sanitizeText(event?.message ?? "", "", 96)
  };
}

export function createInventoryEvent(event) {
  return {
    id: sanitizeText(event?.id ?? "", "", 96),
    type: EVENT_TYPES.INVENTORY,
    serverTime: Number(event?.serverTime ?? Date.now()),
    playerId: sanitizeText(event?.playerId ?? "", "", 96),
    inventory: createInventoryState(event?.inventory ?? { playerId: event?.playerId, slots: [] })
  };
}

export function createAnimationEvent(event) {
  return {
    id: sanitizeText(event?.id ?? "", "", 96),
    type: EVENT_TYPES.ANIMATION,
    serverTime: Number(event?.serverTime ?? Date.now()),
    playerId: sanitizeText(event?.playerId ?? "", "", 96),
    action: Object.values(ANIMATION_ACTIONS).includes(event?.action) ? event.action : ANIMATION_ACTIONS.NONE,
    eventSeq: Math.max(0, readInteger(event?.eventSeq, 0)),
    animation: createAnimationState(event?.animation),
    emoteId: sanitizeText(event?.emoteId ?? "", "", 32) || null
  };
}

export function createCombatEvent(event) {
  return {
    id: sanitizeText(event?.id ?? "", "", 96),
    type: EVENT_TYPES.COMBAT,
    serverTime: Number(event?.serverTime ?? Date.now()),
    action: Object.values(COMBAT_EVENT_ACTIONS).includes(event?.action)
      ? event.action
      : COMBAT_EVENT_ACTIONS.EFFECT,
    attackerId: sanitizeText(event?.attackerId ?? "", "", 96) || null,
    attackerName: sanitizeText(event?.attackerName ?? "", "", GAME_CONFIG.maxPlayerNameLength) || null,
    targetId: sanitizeText(event?.targetId ?? "", "", 96) || null,
    targetName: sanitizeText(event?.targetName ?? "", "", GAME_CONFIG.maxPlayerNameLength) || null,
    assistantIds: Array.from(new Set((event?.assistantIds ?? []).map((value) => sanitizeText(value ?? "", "", 96))))
      .filter(Boolean)
      .slice(0, 4),
    assistantNames: Array.from(
      new Set((event?.assistantNames ?? []).map((value) => sanitizeText(value ?? "", "", GAME_CONFIG.maxPlayerNameLength)))
    )
      .filter(Boolean)
      .slice(0, 4),
    damage: Math.max(0, readInteger(event?.damage, 0)),
    hpAfter: clampInteger(event?.hpAfter, 0, GAME_CONFIG.tank.hitPoints, GAME_CONFIG.tank.hitPoints),
    isCritical: readBoolean(event?.isCritical, false),
    armorBlocked: Math.max(0, readInteger(event?.armorBlocked, 0)),
    statusEffect: Object.values(STATUS_EFFECTS).includes(event?.statusEffect)
      ? event.statusEffect
      : STATUS_EFFECTS.NONE,
    statusDurationMs: Math.max(0, readInteger(event?.statusDurationMs, 0)),
    soundCue: Object.values(SOUND_CUES).includes(event?.soundCue) ? event.soundCue : SOUND_CUES.NONE,
    vfxCue: Object.values(VFX_CUES).includes(event?.vfxCue) ? event.vfxCue : VFX_CUES.NONE,
    message: sanitizeText(event?.message ?? "", "", 160)
  };
}

export function createEventSnapshot(event) {
  switch (event?.type) {
    case EVENT_TYPES.SPAWN:
      return createSpawnEvent(event);
    case EVENT_TYPES.HIT:
      return createHitEvent(event);
    case EVENT_TYPES.HEALTH:
      return createHealthEvent(event);
    case EVENT_TYPES.SCORE:
      return createScoreEvent(event);
    case EVENT_TYPES.ROUND:
      return createRoundEvent(event);
    case EVENT_TYPES.INVENTORY:
      return createInventoryEvent(event);
    case EVENT_TYPES.ANIMATION:
      return createAnimationEvent(event);
    case EVENT_TYPES.COMBAT:
      return createCombatEvent(event);
    default:
      return null;
  }
}

export function createReplicationRecord(record) {
  const kind = Object.values(REPLICATION_KINDS).includes(record?.kind)
    ? record.kind
    : REPLICATION_KINDS.PLAYER;
  const netId = createNetworkId(kind, record?.id ?? record?.netId ?? "");
  const state = record?.state ?? {};

  return {
    kind,
    netId,
    id: sanitizeText(record?.id ?? state?.id ?? "", "", 96),
    ownerId: sanitizeText(record?.ownerId ?? state?.ownerId ?? "", "", 96) || null,
    state:
      kind === REPLICATION_KINDS.PLAYER
        ? createPlayerSnapshot(state)
        : kind === REPLICATION_KINDS.BULLET
          ? createBulletSnapshot(state)
          : createObjectiveSnapshot(state)
  };
}

export function createReplicationPayload(replication) {
  const mode = replication?.mode === "delta" ? "delta" : "full";
  return {
    mode,
    baselineSnapshotSeq: Math.max(0, readInteger(replication?.baselineSnapshotSeq, 0)),
    spawns: (replication?.spawns ?? []).map(createReplicationRecord).filter((record) => record.netId),
    updates: (replication?.updates ?? [])
      .map((record) => {
        const kind = Object.values(REPLICATION_KINDS).includes(record?.kind)
          ? record.kind
          : REPLICATION_KINDS.PLAYER;
        const netId = createNetworkId(kind, record?.id ?? record?.netId ?? "");
        return {
          kind,
          netId,
          id: sanitizeText(record?.id ?? "", "", 96),
          ownerId: sanitizeText(record?.ownerId ?? "", "", 96) || null,
          state: record?.state && typeof record.state === "object" ? record.state : {}
        };
      })
      .filter((record) => record.netId),
    despawns: (replication?.despawns ?? [])
      .map((record) => {
        const kind = Object.values(REPLICATION_KINDS).includes(record?.kind)
          ? record.kind
          : REPLICATION_KINDS.PLAYER;
        const id = sanitizeText(record?.id ?? "", "", 96);
        const netId = createNetworkId(kind, id || record?.netId);
        return {
          kind,
          netId,
          id
        };
      })
      .filter((record) => record.netId),
    interest: {
      cellSize: Math.max(1, readInteger(replication?.interest?.cellSize, GAME_CONFIG.replication.cellSize)),
      candidatePlayers: Math.max(0, readInteger(replication?.interest?.candidatePlayers, 0)),
      selectedPlayers: Math.max(0, readInteger(replication?.interest?.selectedPlayers, 0)),
      culledPlayers: Math.max(0, readInteger(replication?.interest?.culledPlayers, 0)),
      candidateBullets: Math.max(0, readInteger(replication?.interest?.candidateBullets, 0)),
      selectedBullets: Math.max(0, readInteger(replication?.interest?.selectedBullets, 0)),
      culledBullets: Math.max(0, readInteger(replication?.interest?.culledBullets, 0))
    }
  };
}

export function createStatePayload({
  roomId,
  snapshotSeq,
  simulationTick,
  snapshotTick,
  tickRate,
  serverTime,
  match,
  lobby,
  roundNumber,
  objective,
  leaderboard,
  players,
  bullets,
  events,
  inventory,
  replication,
  you
}) {
  return {
    v: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.STATE,
    roomId: sanitizeRoomId(roomId),
    snapshotSeq: Math.max(1, readInteger(snapshotSeq, 1)),
    simulationTick: Math.max(0, readInteger(simulationTick, 0)),
    snapshotTick: Math.max(0, readInteger(snapshotTick ?? simulationTick, 0)),
    tickRate: Math.max(1, readInteger(tickRate ?? GAME_CONFIG.serverTickRate, GAME_CONFIG.serverTickRate)),
    serverTime: Number(serverTime ?? Date.now()),
    match: createRoundSnapshot(match, roundNumber),
    lobby: createLobbySnapshot(lobby ?? { roomCode: roomId }),
    objective: createObjectiveSnapshot(objective),
    leaderboard: (leaderboard ?? []).map(createLeaderboardEntry),
    players: (players ?? []).map(createPlayerSnapshot),
    bullets: (bullets ?? []).map(createBulletSnapshot),
    events: (events ?? []).map(createEventSnapshot).filter(Boolean),
    inventory: (inventory ?? []).map(createInventoryState),
    replication: createReplicationPayload(replication),
    you: you
        ? {
          playerId: sanitizeText(you.playerId ?? "", "", 96),
          profileId: sanitizeProfileId(you.profileId),
          lastProcessedInputSeq: Math.max(0, readInteger(you.lastProcessedInputSeq, 0)),
          lastProcessedInputTick: Math.max(0, readInteger(you.lastProcessedInputTick, 0)),
          lastProcessedInputClientSentAt: Math.max(
            0,
            readInteger(you.lastProcessedInputClientSentAt, 0)
          ),
          pendingInputCount: Math.max(0, readInteger(you.pendingInputCount, 0)),
          alive: readBoolean(you.alive, true),
          respawnAt: Number.isFinite(Number(you.respawnAt)) ? Number(you.respawnAt) : null,
          ready: readBoolean(you.ready, false),
          assists: Math.max(0, readInteger(you.assists, 0)),
          isSpectator: readBoolean(you.isSpectator, false),
          isRoomOwner: readBoolean(you.isRoomOwner, false),
          teamId: sanitizeLobbyOptionId(you.teamId, GAME_CONFIG.lobby.teams, GAME_CONFIG.lobby.teams[0].id),
          classId: sanitizeLobbyOptionId(
            you.classId,
            GAME_CONFIG.lobby.classes,
            GAME_CONFIG.lobby.classes[0].id
          ),
          queuedForSlot: readBoolean(you.queuedForSlot, false),
          slotReserved: readBoolean(you.slotReserved, false),
          afk: readBoolean(you.afk, false),
          profileStats: createPublicProfileStats(you.profileStats)
        }
      : null
  };
}

function normalizeJoinPacket(packet, version) {
  return {
    v: version,
    type: MESSAGE_TYPES.JOIN,
    roomId: sanitizeRoomId(packet.roomId ?? packet.r),
    name: sanitizePlayerName(packet.name ?? packet.n),
    profileId: sanitizeProfileId(packet.profileId ?? packet.p),
    authToken: sanitizeAuthToken(packet.authToken ?? packet.at),
    sessionId: sanitizeSessionId(packet.sessionId ?? packet.sid),
    spectate: readBoolean(packet.spectate ?? packet.sp, false),
    mapId: sanitizeText(packet.mapId ?? packet.mid, "", 24) || null,
    teamId: sanitizeText(packet.teamId ?? packet.tid, "", 24) || null,
    classId: sanitizeText(packet.classId ?? packet.cid, "", 24) || null,
    gameVersion: sanitizeText(packet.gameVersion ?? packet.g, "", 32) || null,
    assetVersion: sanitizeText(packet.assetVersion ?? packet.av, "", 32) || null,
    messageId: sanitizeMessageId(packet.messageId ?? packet.m)
  };
}

function normalizeJoinedPacket(packet, version) {
  return {
    v: version,
    type: MESSAGE_TYPES.JOINED,
    playerId: sanitizeText(packet.playerId ?? "", "", 96),
    profileId: sanitizeProfileId(packet.profileId),
    roomId: sanitizeRoomId(packet.roomId),
    isSpectator: readBoolean(packet.isSpectator ?? packet.sp, false),
    queuedForSlot: readBoolean(packet.queuedForSlot ?? packet.qs, false),
    slotReserved: readBoolean(packet.slotReserved ?? packet.rs, false),
    gameVersion: sanitizeText(packet.gameVersion ?? packet.g, "", 32) || null,
    assetVersion: sanitizeText(packet.assetVersion ?? packet.av, "", 32) || null,
    config: packet.config ?? GAME_CONFIG,
    profileStats: createPublicProfileStats(packet.profileStats)
  };
}

function normalizeLobbyPacket(packet, version) {
  return {
    v: version,
    type: MESSAGE_TYPES.LOBBY,
    action: sanitizeText(packet.action ?? packet.a, "", 24),
    mapId: sanitizeText(packet.mapId ?? packet.mid, "", 24) || null,
    teamId: sanitizeText(packet.teamId ?? packet.tid, "", 24) || null,
    classId: sanitizeText(packet.classId ?? packet.cid, "", 24) || null,
    messageId: sanitizeMessageId(packet.messageId ?? packet.m)
  };
}

function normalizeReadyPacket(packet, version) {
  return {
    v: version,
    type: MESSAGE_TYPES.READY,
    ready: readBoolean(packet.ready ?? packet.r, false),
    messageId: sanitizeMessageId(packet.messageId ?? packet.m)
  };
}

function normalizeRespawnPacket(packet, version) {
  return {
    v: version,
    type: MESSAGE_TYPES.RESPAWN,
    messageId: sanitizeMessageId(packet.messageId ?? packet.m)
  };
}

function normalizeResyncPacket(packet, version) {
  return {
    v: version,
    type: MESSAGE_TYPES.RESYNC,
    snapshotSeq: Math.max(0, readInteger(packet.snapshotSeq ?? packet.ss, 0)),
    reason: sanitizeText(packet.reason ?? packet.rr, "", 48) || null,
    messageId: sanitizeMessageId(packet.messageId ?? packet.m)
  };
}

function normalizeInputPacket(packet, version) {
  const seq = readInteger(packet.seq ?? packet.s, -1);
  const clientSentAt = readFiniteNumber(packet.clientSentAt ?? packet.t, NaN);
  const flags =
    packet.flags !== undefined || packet.f !== undefined
      ? decodeInputFlags(packet.flags ?? packet.f)
      : {
          forward: readBoolean(packet.forward),
          back: readBoolean(packet.back),
          left: readBoolean(packet.left),
          right: readBoolean(packet.right),
          shoot: readBoolean(packet.shoot)
        };

  if (!Number.isInteger(seq) || seq < 0) {
    return null;
  }

  if (!Number.isFinite(clientSentAt)) {
    return null;
  }

  return {
    v: version,
    type: MESSAGE_TYPES.INPUT,
    seq,
    clientSentAt,
    turretAngle: roundTo(normalizeAngle(packet.turretAngle ?? packet.a), 4),
    ...flags
  };
}

function normalizeAckPacket(packet, version) {
  return {
    v: version,
    type: MESSAGE_TYPES.ACK,
    messageId: sanitizeMessageId(packet.messageId ?? packet.m),
    ackedType: sanitizeText(packet.ackedType ?? packet.at, "", 24) || null,
    serverTime: Number.isFinite(Number(packet.serverTime ?? packet.t))
      ? Number(packet.serverTime ?? packet.t)
      : null
  };
}

function normalizePingLikePacket(packet, version, type) {
  return {
    v: version,
    type,
    sentAt: Number.isFinite(Number(packet.sentAt ?? packet.t)) ? Number(packet.sentAt ?? packet.t) : Date.now()
  };
}

function normalizeErrorPacket(packet, version) {
  return {
    v: version,
    type: MESSAGE_TYPES.ERROR,
    code: sanitizeText(packet.code ?? "", "", 48) || null,
    message: sanitizeText(packet.message ?? "Unknown error", "Unknown error", 160)
  };
}

function normalizeStateChunkPacket(packet, version) {
  const snapshotSeq = readInteger(packet.snapshotSeq, -1);
  const chunkIndex = readInteger(packet.chunkIndex, -1);
  const chunkCount = readInteger(packet.chunkCount, -1);

  if (snapshotSeq < 1 || chunkIndex < 0 || chunkCount < 1 || chunkIndex >= chunkCount) {
    return null;
  }

  return {
    v: version,
    type: MESSAGE_TYPES.STATE_CHUNK,
    roomId: sanitizeRoomId(packet.roomId),
    snapshotSeq,
    chunkIndex,
    chunkCount,
    chunk: String(packet.chunk ?? "")
  };
}

function normalizeStatePacket(packet, version) {
  if (!Number.isInteger(Number(packet.snapshotSeq))) {
    return null;
  }

  return createStatePayload({
    roomId: packet.roomId,
    snapshotSeq: packet.snapshotSeq,
    simulationTick: packet.simulationTick,
    snapshotTick: packet.snapshotTick,
    tickRate: packet.tickRate,
    serverTime: packet.serverTime,
    match: packet.match,
    roundNumber: packet.match?.roundNumber ?? packet.roundNumber,
    objective: packet.objective,
    lobby: packet.lobby,
    leaderboard: packet.leaderboard,
    players: packet.players,
    bullets: packet.bullets,
    events: Array.isArray(packet.events) ? packet.events : [],
    inventory: Array.isArray(packet.inventory) ? packet.inventory : [],
    replication: packet.replication,
    you: packet.you
  });
}

function normalizePacketObject(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return buildParseError("Packet must be a JSON object");
  }

  const version = sanitizeProtocolVersion(packet.v);
  if (!Number.isInteger(version)) {
    return buildParseError("Packet version must be an integer", "invalid_version");
  }

  if (version < MIN_SUPPORTED_PROTOCOL_VERSION) {
    return buildParseError(
      `Protocol version ${version} is too old; minimum supported version is ${MIN_SUPPORTED_PROTOCOL_VERSION}`,
      "unsupported_version"
    );
  }

  if (version > PROTOCOL_VERSION) {
    return buildParseError(
      `Protocol version ${version} is newer than supported version ${PROTOCOL_VERSION}`,
      "unsupported_version"
    );
  }

  switch (packet.type) {
    case MESSAGE_TYPES.JOIN:
      return { ok: true, packet: normalizeJoinPacket(packet, version) };
    case MESSAGE_TYPES.JOINED:
      return { ok: true, packet: normalizeJoinedPacket(packet, version) };
    case MESSAGE_TYPES.LOBBY:
      return { ok: true, packet: normalizeLobbyPacket(packet, version) };
    case MESSAGE_TYPES.READY:
      return { ok: true, packet: normalizeReadyPacket(packet, version) };
    case MESSAGE_TYPES.RESPAWN:
      return { ok: true, packet: normalizeRespawnPacket(packet, version) };
    case MESSAGE_TYPES.RESYNC:
      return { ok: true, packet: normalizeResyncPacket(packet, version) };
    case MESSAGE_TYPES.INPUT: {
      const normalized = normalizeInputPacket(packet, version);
      return normalized ? { ok: true, packet: normalized } : buildParseError("Invalid input packet");
    }
    case MESSAGE_TYPES.ACK:
      return { ok: true, packet: normalizeAckPacket(packet, version) };
    case MESSAGE_TYPES.PING:
      return { ok: true, packet: normalizePingLikePacket(packet, version, MESSAGE_TYPES.PING) };
    case MESSAGE_TYPES.PONG:
      return { ok: true, packet: normalizePingLikePacket(packet, version, MESSAGE_TYPES.PONG) };
    case MESSAGE_TYPES.ERROR:
      return { ok: true, packet: normalizeErrorPacket(packet, version) };
    case MESSAGE_TYPES.STATE_CHUNK: {
      const normalized = normalizeStateChunkPacket(packet, version);
      return normalized ? { ok: true, packet: normalized } : buildParseError("Invalid state chunk packet");
    }
    case MESSAGE_TYPES.STATE: {
      const normalized = normalizeStatePacket(packet, version);
      return normalized ? { ok: true, packet: normalized } : buildParseError("Invalid state packet");
    }
    default:
      return buildParseError(`Unsupported packet type: ${String(packet.type ?? "unknown")}`, "unsupported_type");
  }
}

function encodePacketObject(packet) {
  const version = PROTOCOL_VERSION;

  switch (packet?.type) {
    case MESSAGE_TYPES.JOIN:
      return {
        v: version,
        type: MESSAGE_TYPES.JOIN,
        r: sanitizeRoomId(packet.roomId),
        n: sanitizePlayerName(packet.name),
        p: sanitizeProfileId(packet.profileId),
        at: sanitizeAuthToken(packet.authToken),
        sid: sanitizeSessionId(packet.sessionId),
        sp: readBoolean(packet.spectate, false),
        mid: sanitizeText(packet.mapId ?? "", "", 24) || null,
        tid: sanitizeText(packet.teamId ?? "", "", 24) || null,
        cid: sanitizeText(packet.classId ?? "", "", 24) || null,
        g: sanitizeText(packet.gameVersion ?? "", "", 32) || null,
        av: sanitizeText(packet.assetVersion ?? "", "", 32) || null,
        m: sanitizeMessageId(packet.messageId)
      };
    case MESSAGE_TYPES.READY:
      return {
        v: version,
        type: MESSAGE_TYPES.READY,
        r: readBoolean(packet.ready, false),
        m: sanitizeMessageId(packet.messageId)
      };
    case MESSAGE_TYPES.RESPAWN:
      return {
        v: version,
        type: MESSAGE_TYPES.RESPAWN,
        m: sanitizeMessageId(packet.messageId)
      };
    case MESSAGE_TYPES.LOBBY:
      return {
        v: version,
        type: MESSAGE_TYPES.LOBBY,
        a: sanitizeText(packet.action ?? "", "", 24),
        mid: sanitizeText(packet.mapId ?? "", "", 24) || null,
        tid: sanitizeText(packet.teamId ?? "", "", 24) || null,
        cid: sanitizeText(packet.classId ?? "", "", 24) || null,
        m: sanitizeMessageId(packet.messageId)
      };
    case MESSAGE_TYPES.RESYNC:
      return {
        v: version,
        type: MESSAGE_TYPES.RESYNC,
        ss: Math.max(0, readInteger(packet.snapshotSeq, 0)),
        rr: sanitizeText(packet.reason ?? "", "", 48) || null,
        m: sanitizeMessageId(packet.messageId)
      };
    case MESSAGE_TYPES.INPUT:
      return {
        v: version,
        type: MESSAGE_TYPES.INPUT,
        s: Math.max(0, readInteger(packet.seq, 0)),
        t: readFiniteNumber(packet.clientSentAt, Date.now()),
        f: encodeInputFlags(packet),
        a: roundTo(normalizeAngle(packet.turretAngle), 4)
      };
    case MESSAGE_TYPES.PING:
      return {
        v: version,
        type: MESSAGE_TYPES.PING,
        t: readFiniteNumber(packet.sentAt, Date.now())
      };
    case MESSAGE_TYPES.PONG:
      return {
        v: version,
        type: MESSAGE_TYPES.PONG,
        t: readFiniteNumber(packet.sentAt, Date.now())
      };
    case MESSAGE_TYPES.ACK:
      return {
        v: version,
        type: MESSAGE_TYPES.ACK,
        m: sanitizeMessageId(packet.messageId),
        at: sanitizeText(packet.ackedType ?? "", "", 24) || null,
        t: Number.isFinite(Number(packet.serverTime)) ? Number(packet.serverTime) : null
      };
    case MESSAGE_TYPES.ERROR:
      return {
        v: version,
        type: MESSAGE_TYPES.ERROR,
        code: sanitizeText(packet.code ?? "", "", 48) || null,
        message: sanitizeText(packet.message ?? "Unknown error", "Unknown error", 160)
      };
    case MESSAGE_TYPES.JOINED:
      return {
        v: version,
        type: MESSAGE_TYPES.JOINED,
        playerId: sanitizeText(packet.playerId ?? "", "", 96),
        profileId: sanitizeProfileId(packet.profileId),
        roomId: sanitizeRoomId(packet.roomId),
        sp: readBoolean(packet.isSpectator, false),
        qs: readBoolean(packet.queuedForSlot, false),
        rs: readBoolean(packet.slotReserved, false),
        g: sanitizeText(packet.gameVersion ?? "", "", 32) || null,
        av: sanitizeText(packet.assetVersion ?? "", "", 32) || null,
        config: packet.config ?? GAME_CONFIG,
        profileStats: createPublicProfileStats(packet.profileStats)
      };
    case MESSAGE_TYPES.STATE_CHUNK:
      return {
        v: version,
        type: MESSAGE_TYPES.STATE_CHUNK,
        roomId: sanitizeRoomId(packet.roomId),
        snapshotSeq: Math.max(1, readInteger(packet.snapshotSeq, 1)),
        chunkIndex: Math.max(0, readInteger(packet.chunkIndex, 0)),
        chunkCount: Math.max(1, readInteger(packet.chunkCount, 1)),
        chunk: String(packet.chunk ?? "")
      };
    case MESSAGE_TYPES.STATE:
      return createStatePayload(packet);
    default:
      throw new Error(`Cannot serialize unsupported packet type: ${String(packet?.type ?? "unknown")}`);
  }
}

export function serializePacket(packet) {
  return JSON.stringify(encodePacketObject(packet));
}

export function deserializePacket(rawPacket) {
  let serializedLength = 0;
  let packet = rawPacket;

  if (typeof rawPacket === "string") {
    serializedLength = rawPacket.length;

    if (serializedLength > GAME_CONFIG.network.maxPacketBytes) {
      return buildParseError("Packet exceeded maximum size", "packet_too_large");
    }

    try {
      packet = JSON.parse(rawPacket);
    } catch (error) {
      return buildParseError("Packet was not valid JSON");
    }
  } else if (rawPacket && typeof rawPacket === "object" && typeof rawPacket.toString === "function") {
    if (rawPacket instanceof Uint8Array) {
      const text = new TextDecoder().decode(rawPacket);
      return deserializePacket(text);
    }

    if (typeof Buffer !== "undefined" && typeof Buffer.isBuffer === "function" && Buffer.isBuffer(rawPacket)) {
      return deserializePacket(String(rawPacket));
    }
  }

  return normalizePacketObject(packet);
}
