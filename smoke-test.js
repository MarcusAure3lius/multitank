import fs from "node:fs";
import { once } from "node:events";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { WebSocket } from "ws";

import {
  ASSET_BUNDLE_VERSION,
  EVENT_TYPES,
  GAME_BUILD_VERSION,
  GAME_CONFIG,
  MATCH_PHASES,
  MESSAGE_TYPES,
  PROFILES_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  REPLICATION_KINDS,
  deserializePacket,
  getMapLayout,
  getTeamSpawnZone,
  serializePacket
} from "./shared/protocol.js";

const isExternalServer = /^(1|true|yes|on)$/i.test(String(process.env.SMOKE_EXTERNAL ?? ""));
const port = Number(process.env.SMOKE_PORT ?? 4312);
const baseHttpUrl = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${port}`;
const baseWsUrl = process.env.SMOKE_WS_URL ?? baseHttpUrl.replace(/^http/i, "ws");
const adminApiKey = process.env.SMOKE_ADMIN_API_KEY ?? "smoke-admin-key";
const allocatorApiKey = process.env.SMOKE_ALLOCATOR_API_KEY ?? "smoke-allocator-key";
const smokeRegion = process.env.SMOKE_DEPLOY_REGION ?? "smoke-east";
const smokeDebugEnabled = /^(1|true|yes|on)$/i.test(String(process.env.SMOKE_DEBUG ?? ""));
const smokeDataDir = isExternalServer
  ? (process.env.SMOKE_DATA_DIR ? path.resolve(process.env.SMOKE_DATA_DIR) : null)
  : fs.mkdtempSync(path.join(os.tmpdir(), "multitank-smoke-"));

function debugSmoke(...args) {
  if (smokeDebugEnabled) {
    console.log("[smoke]", ...args);
  }
}

function seedSmokeProfiles(dataDir) {
  if (!dataDir) {
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "profiles.json"),
    `${JSON.stringify({
      profiles: [
        {
          profileId: "legacy-profile",
          lastKnownName: "Legacy Commander",
          stats: {
            matchesPlayed: 1,
            wins: 1,
            kills: 2,
            deaths: 1,
            shotsFired: 5,
            shotsHit: 3
          }
        }
      ]
    }, null, 2)}\n`,
    "utf8"
  );
}

if (!isExternalServer) {
  seedSmokeProfiles(smokeDataDir);
}

const server = isExternalServer
  ? null
  : spawn(process.execPath, ["server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: smokeDataDir,
        ADMIN_API_KEY: adminApiKey,
        ALLOCATOR_API_KEY: allocatorApiKey,
        DEPLOY_REGION: smokeRegion
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

let serverOutput = "";
let requestCounter = 0;
if (server) {
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
}

async function stopServer() {
  if (server && server.exitCode === null && !server.killed) {
    server.kill("SIGTERM");
  }

  if (server && server.exitCode === null) {
    try {
      await once(server, "exit");
    } catch (error) {
      // Ignore shutdown races during test cleanup.
    }
  }

  if (!isExternalServer && smokeDataDir) {
    fs.rmSync(smokeDataDir, { recursive: true, force: true });
  }
}

function nextRequestId(prefix = "smoke") {
  requestCounter += 1;
  return `${prefix}-${Date.now()}-${requestCounter}`;
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server failed to start")), 5000);

    const attempt = () => {
      const request = http.get(baseHttpUrl, (response) => {
        response.resume();
        clearTimeout(timeout);
        resolve();
      });

      request.on("error", () => {
        setTimeout(attempt, 100);
      });
    };

    attempt();
  });
}

async function connectClient(name) {
  const socket = new WebSocket(baseWsUrl);
  socket.playerCache = new Map();
  await once(socket, "open");

  return socket;
}

function requestJson(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const method = String(options.method ?? "GET").toUpperCase();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    };
    if (
      (method === "POST" || method === "PUT" || method === "PATCH") &&
      headers["x-request-id"] === undefined &&
      headers["X-Request-Id"] === undefined
    ) {
      headers["x-request-id"] = nextRequestId(
        pathname.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "smoke"
      );
    }

    const request = http.request(`${baseHttpUrl}${pathname}`, {
      method,
      headers: {
        ...headers
      }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          const parsed = body ? JSON.parse(body) : null;
          if ((response.statusCode ?? 500) >= 400) {
            if (options.allowError) {
              resolve({
                statusCode: response.statusCode ?? 500,
                body: parsed
              });
              return;
            }
            reject(new Error(parsed?.message ?? `Request failed with ${response.statusCode}`));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });

    if (options.body !== undefined) {
      request.write(JSON.stringify(options.body));
    }

    request.end();
    request.on("error", reject);
  });
}

function joinRoom(socket, name, profileId, messageId, options = {}) {
  socket.send(
    serializePacket({
      type: MESSAGE_TYPES.JOIN,
      name,
      roomId: options.roomId ?? "smoke",
      profileId,
      authToken: options.authToken ?? null,
      sessionId: options.sessionId ?? `${profileId}-session`,
      spectate: Boolean(options.spectate),
      mapId: options.mapId ?? null,
      teamId: options.teamId ?? null,
      classId: options.classId ?? null,
      gameVersion: options.gameVersion ?? GAME_BUILD_VERSION,
      assetVersion: options.assetVersion ?? ASSET_BUNDLE_VERSION,
      messageId
    })
  );
}

function sendLobbyUpdate(socket, action, fields, messageId) {
  socket.send(
    serializePacket({
      type: MESSAGE_TYPES.LOBBY,
      action,
      ...fields,
      messageId
    })
  );
}

async function waitForMessage(socket, predicate, timeoutMs = 12000, label = "message") {
  return new Promise((resolve, reject) => {
    const stateChunks = new Map();

    const onMessage = (raw) => {
      const parsed = deserializePacket(String(raw));
      if (!parsed.ok) {
        return;
      }

      let payload = parsed.packet;

      if (payload.type === MESSAGE_TYPES.STATE_CHUNK) {
        const key = `${payload.roomId ?? ""}:${payload.snapshotSeq}`;
        const chunkState = stateChunks.get(key) ?? {
          chunkCount: payload.chunkCount,
          chunks: new Array(payload.chunkCount).fill(null)
        };
        chunkState.chunkCount = payload.chunkCount;
        if (chunkState.chunks.length !== payload.chunkCount) {
          chunkState.chunks = new Array(payload.chunkCount).fill(null);
        }
        chunkState.chunks[payload.chunkIndex] = payload.chunk;
        stateChunks.set(key, chunkState);

        if (chunkState.chunks.every((chunk) => typeof chunk === "string")) {
          stateChunks.delete(key);
          const fullParsed = deserializePacket(chunkState.chunks.join(""), {
            allowLargePacket: true
          });
          if (!fullParsed.ok) {
            return;
          }
          payload = fullParsed.packet;
        } else {
          return;
        }
      }

      applyStateToPlayerCache(socket, payload);

      if (predicate(payload)) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve(payload);
      }
    };
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Message timeout: ${label}`));
    }, timeoutMs);

    socket.on("message", onMessage);
  });
}

function setReady(socket, ready, messageId) {
  socket.send(
    serializePacket({
      type: MESSAGE_TYPES.READY,
      ready,
      messageId
    })
  );
}

function sendRespawn(socket, messageId) {
  socket.send(
    serializePacket({
      type: MESSAGE_TYPES.RESPAWN,
      messageId
    })
  );
}

function sendInput(socket, input) {
  socket.send(
    serializePacket({
      type: MESSAGE_TYPES.INPUT,
      ...input
    })
  );
}

function applyStateToPlayerCache(socket, payload) {
  if (!socket || payload?.type !== MESSAGE_TYPES.STATE) {
    return;
  }

  const cache = socket.playerCache instanceof Map ? socket.playerCache : new Map();
  socket.playerCache = cache;

  if (payload.replication?.mode === "full" && Array.isArray(payload.players) && payload.players.length > 0) {
    cache.clear();
  }

  for (const player of payload.players ?? []) {
    if (!player?.id) {
      continue;
    }

    cache.set(player.id, {
      ...(cache.get(player.id) ?? {}),
      ...player
    });
  }

  for (const record of payload.replication?.spawns ?? []) {
    if (record.kind !== REPLICATION_KINDS.PLAYER || !record.id || !record.state) {
      continue;
    }

    cache.set(record.id, {
      ...(cache.get(record.id) ?? {}),
      id: record.id,
      ...record.state
    });
  }

  for (const record of payload.replication?.updates ?? []) {
    if (record.kind !== REPLICATION_KINDS.PLAYER || !record.id || !record.state) {
      continue;
    }

    cache.set(record.id, {
      ...(cache.get(record.id) ?? {}),
      id: record.id,
      ...record.state
    });
  }

  for (const record of payload.replication?.despawns ?? []) {
    if (record.kind !== REPLICATION_KINDS.PLAYER || !record.id) {
      continue;
    }

    cache.delete(record.id);
  }

  payload._mergedPlayers = Array.from(cache.values());
}

function requestResync(socket, snapshotSeq, messageId, reason = "smoke_resync") {
  socket.send(
    serializePacket({
      type: MESSAGE_TYPES.RESYNC,
      snapshotSeq,
      reason,
      messageId
    })
  );
}

async function waitForState(socket, predicate, label = "state") {
  return waitForMessage(
    socket,
    (payload) => payload.type === MESSAGE_TYPES.STATE && predicate(payload),
    12000,
    label
  );
}

function hasReplicatedPlayerState(payload, playerId) {
  return Boolean(playerId && getPlayerState(payload, playerId));
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

function getPlayerState(payload, playerId) {
  if (Array.isArray(payload?._mergedPlayers)) {
    return payload._mergedPlayers.find((player) => player.id === playerId) ?? null;
  }

  return (
    payload.players?.find((player) => player.id === playerId) ??
    payload.replication?.spawns
      ?.filter((record) => record.kind === REPLICATION_KINDS.PLAYER)
      .map((record) => ({ id: record.id, ...record.state }))
      .find((player) => player.id === playerId) ??
    payload.replication?.updates
      ?.filter((record) => record.kind === REPLICATION_KINDS.PLAYER)
      .map((record) => ({ id: record.id, ...record.state }))
      .find((player) => player.id === playerId) ??
      null
  );
}

async function movePlayerOutOfSpawnZone(socket, playerId, teamId, inputSeqStart, label) {
  const zone = getTeamSpawnZone(teamId);
  const movesTowardCenter =
    zone.spawnSide === "left"
      ? { left: false, right: true }
      : { left: true, right: false };
  const crossedThreshold = zone.spawnSide === "left" ? zone.right + 120 : zone.left - 120;
  let resolved = false;

  const crossedStatePromise = waitForState(
    socket,
    (payload) => {
      const player = getPlayerState(payload, playerId);
      if (!player) {
        return false;
      }

      if ((payload.you?.lastProcessedInputSeq ?? 0) < inputSeqStart) {
        return false;
      }

      return zone.spawnSide === "left" ? player.x >= crossedThreshold : player.x <= crossedThreshold;
    },
    label
  );
  crossedStatePromise.then(() => {
    resolved = true;
  });

  let nextSeq = inputSeqStart;
  for (let attempt = 0; attempt < 170 && !resolved; attempt += 1) {
    sendInput(socket, {
      seq: nextSeq++,
      clientSentAt: Date.now(),
      forward: false,
      back: false,
      left: movesTowardCenter.left,
      right: movesTowardCenter.right,
      shoot: false,
      turretAngle: 0
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
  }

  const crossedState = await crossedStatePromise;
  sendInput(socket, {
    seq: nextSeq++,
    clientSentAt: Date.now(),
    forward: false,
    back: false,
    left: false,
    right: false,
    shoot: false,
    turretAngle: 0
  });

  return {
    crossedState,
    nextSeq
  };
}

function getReplicatedPlayers(payload) {
  if (Array.isArray(payload?._mergedPlayers)) {
    return payload._mergedPlayers;
  }

  const players = new Map((payload.players ?? []).map((player) => [player.id, player]));

  for (const record of payload.replication?.spawns ?? []) {
    if (record.kind !== REPLICATION_KINDS.PLAYER || !record.state) {
      continue;
    }

    players.set(record.id, {
      ...(players.get(record.id) ?? {}),
      id: record.id,
      ...record.state
    });
  }

  for (const record of payload.replication?.updates ?? []) {
    if (record.kind !== REPLICATION_KINDS.PLAYER || !record.state) {
      continue;
    }

    players.set(record.id, {
      ...(players.get(record.id) ?? {}),
      id: record.id,
      ...record.state
    });
  }

  return Array.from(players.values());
}

function getReplicatedShapes(payload) {
  const shapes = new Map((payload.shapes ?? []).map((shape) => [shape.id, shape]));

  for (const record of payload.replication?.spawns ?? []) {
    if (record.kind !== REPLICATION_KINDS.SHAPE || !record.state) {
      continue;
    }

    shapes.set(record.id, {
      ...(shapes.get(record.id) ?? {}),
      id: record.id,
      ...record.state
    });
  }

  for (const record of payload.replication?.updates ?? []) {
    if (record.kind !== REPLICATION_KINDS.SHAPE || !record.state) {
      continue;
    }

    shapes.set(record.id, {
      ...(shapes.get(record.id) ?? {}),
      id: record.id,
      ...record.state
    });
  }

  for (const record of payload.replication?.despawns ?? []) {
    if (record.kind !== REPLICATION_KINDS.SHAPE || !record.id) {
      continue;
    }

    shapes.delete(record.id);
  }

  return Array.from(shapes.values());
}

function getFullPlayerState(payload, playerId) {
  return (
    payload.players?.find((player) => player.id === playerId) ??
    payload.replication?.spawns
      ?.filter((record) => record.kind === REPLICATION_KINDS.PLAYER)
      .map((record) => ({ id: record.id, ...record.state }))
      .find((player) => player.id === playerId) ??
    null
  );
}

function getMapObstacles(mapId = null) {
  return getMapLayout(mapId)?.obstacles ?? GAME_CONFIG.world.obstacles;
}

function findClearShotAngle(player, mapId = null) {
  const candidateAngles = [
    0,
    Math.PI / 4,
    Math.PI / 2,
    (Math.PI * 3) / 4,
    Math.PI,
    (-Math.PI * 3) / 4,
    -Math.PI / 2,
    -Math.PI / 4
  ];
  const traceDistance = 220;
  const obstacles = getMapObstacles(mapId);

  for (const angle of candidateAngles) {
    const endX = player.x + Math.cos(angle) * traceDistance;
    const endY = player.y + Math.sin(angle) * traceDistance;

    if (
      endX < GAME_CONFIG.world.padding ||
      endX > GAME_CONFIG.world.width - GAME_CONFIG.world.padding ||
      endY < GAME_CONFIG.world.padding ||
      endY > GAME_CONFIG.world.height - GAME_CONFIG.world.padding
    ) {
      continue;
    }

    const blocked = obstacles.some((obstacle) =>
      segmentIntersectsRect(player.x, player.y, endX, endY, obstacle, GAME_CONFIG.bullet.radius)
    );

    if (!blocked) {
      return angle;
    }
  }

  return null;
}

function findClearMovementInput(player, mapId = null) {
  const traceDistance = 140;
  const obstacles = getMapObstacles(mapId);
  const candidates = [
    { forward: true, back: false, left: false, right: false, dx: 0, dy: -traceDistance },
    { forward: false, back: true, left: false, right: false, dx: 0, dy: traceDistance },
    { forward: false, back: false, left: true, right: false, dx: -traceDistance, dy: 0 },
    { forward: false, back: false, left: false, right: true, dx: traceDistance, dy: 0 }
  ];

  for (const candidate of candidates) {
    const endX = player.x + candidate.dx;
    const endY = player.y + candidate.dy;

    if (
      endX < GAME_CONFIG.world.padding ||
      endX > GAME_CONFIG.world.width - GAME_CONFIG.world.padding ||
      endY < GAME_CONFIG.world.padding ||
      endY > GAME_CONFIG.world.height - GAME_CONFIG.world.padding
    ) {
      continue;
    }

    const blocked = obstacles.some((obstacle) =>
      segmentIntersectsRect(player.x, player.y, endX, endY, obstacle, GAME_CONFIG.tank.radius)
    );

    if (!blocked) {
      return {
        forward: candidate.forward,
        back: candidate.back,
        left: candidate.left,
        right: candidate.right
      };
    }
  }

  return {
    forward: false,
    back: false,
    left: false,
    right: true
  };
}

function buildMovementInputTowardPoint(player, target, mapId = null) {
  if (!player || !target) {
    return findClearMovementInput(player, mapId);
  }

  const axisThreshold = 60;
  const traceDistance = 140;
  const obstacles = getMapObstacles(mapId);
  const candidates = [];
  const horizontal =
    target.x - player.x > axisThreshold
      ? { left: false, right: true }
      : player.x - target.x > axisThreshold
        ? { left: true, right: false }
        : null;
  const vertical =
    target.y - player.y > axisThreshold
      ? { forward: false, back: true }
      : player.y - target.y > axisThreshold
        ? { forward: true, back: false }
        : null;
  const idleInput = {
    forward: false,
    back: false,
    left: false,
    right: false
  };

  if (horizontal || vertical) {
    candidates.push({
      ...idleInput,
      ...(vertical ?? {}),
      ...(horizontal ?? {})
    });
  }
  if (horizontal) {
    candidates.push({
      ...idleInput,
      ...horizontal
    });
  }
  if (vertical) {
    candidates.push({
      ...idleInput,
      ...vertical
    });
  }

  for (const candidate of candidates) {
    const moveX = (candidate.right ? 1 : 0) - (candidate.left ? 1 : 0);
    const moveY = (candidate.back ? 1 : 0) - (candidate.forward ? 1 : 0);
    const magnitude = Math.hypot(moveX, moveY);
    if (magnitude <= 0) {
      continue;
    }

    const endX = player.x + (moveX / magnitude) * traceDistance;
    const endY = player.y + (moveY / magnitude) * traceDistance;
    if (
      endX < GAME_CONFIG.world.padding ||
      endX > GAME_CONFIG.world.width - GAME_CONFIG.world.padding ||
      endY < GAME_CONFIG.world.padding ||
      endY > GAME_CONFIG.world.height - GAME_CONFIG.world.padding
    ) {
      continue;
    }

    const blocked = obstacles.some((obstacle) =>
      segmentIntersectsRect(player.x, player.y, endX, endY, obstacle, GAME_CONFIG.tank.radius)
    );
    if (!blocked) {
      return candidate;
    }
  }

  return findClearMovementInput(player, mapId);
}

function payloadContainsOwnedBullet(payload, ownerId) {
  if ((payload.bullets ?? []).some((bullet) => bullet.ownerId === ownerId)) {
    return true;
  }

  return Boolean(
    payload.replication?.spawns?.some(
      (record) => record.kind === REPLICATION_KINDS.BULLET && record.ownerId === ownerId
    ) ||
      payload.replication?.updates?.some(
        (record) => record.kind === REPLICATION_KINDS.BULLET && record.ownerId === ownerId
      )
  );
}

function assertStateChunkAssemblyWaitsForAllFragments() {
  const serializedState = serializePacket({
    type: MESSAGE_TYPES.STATE,
    roomId: "chunk-smoke",
    snapshotSeq: 777,
    simulationTick: 777,
    snapshotTick: 777,
    serverTime: Date.now(),
    leaderboard: Array.from({ length: 80 }, (_, index) => ({
      id: `chunk-player-${index}`,
      name: `Chunk Player ${index}`,
      teamId: index % 2 === 0 ? "alpha" : "bravo",
      classId: "basic",
      score: index,
      assists: 0,
      deaths: 0,
      credits: 0,
      connected: true,
      ready: true,
      isBot: false,
      isSpectator: false,
      queuedForSlot: false,
      slotReserved: false,
      afk: false
    })),
    players: Array.from({ length: 80 }, (_, index) => ({
      id: `chunk-player-${index}`,
      name: `Chunk Player ${index}`,
      teamId: index % 2 === 0 ? "alpha" : "bravo",
      classId: "basic",
      x: 100 + index * 12,
      y: 200 + index * 6,
      angle: 0,
      turretAngle: 0,
      hp: GAME_CONFIG.tank.hitPoints,
      score: index,
      deaths: 0,
      assists: 0,
      credits: 0,
      alive: true,
      connected: true,
      ready: true
    })),
    replication: {
      mode: "full",
      baselineSnapshotSeq: 0
    }
  });

  const chunks = [];
  for (let offset = 0; offset < serializedState.length; offset += GAME_CONFIG.network.stateChunkChars) {
    chunks.push(serializedState.slice(offset, offset + GAME_CONFIG.network.stateChunkChars));
  }

  if (chunks.length < 3) {
    throw new Error("Expected chunk assembly coverage to use a multi-fragment state payload");
  }

  const stateChunks = new Map();

  const applyChunk = (chunkIndex) => {
    const existing = stateChunks.get(777) ?? {
      chunkCount: chunks.length,
      chunks: new Array(chunks.length).fill(null)
    };

    existing.chunks[chunkIndex] = chunks[chunkIndex];
    stateChunks.set(777, existing);

    if (!existing.chunks.every((chunk) => typeof chunk === "string")) {
      return null;
    }

    stateChunks.delete(777);
    const rebuilt = deserializePacket(existing.chunks.join(""), {
      allowLargePacket: true
    });

    if (!rebuilt.ok || rebuilt.packet.type !== MESSAGE_TYPES.STATE) {
      throw new Error("Expected fragmented state packets to rebuild into a valid state snapshot");
    }

    return rebuilt.packet;
  };

  if (applyChunk(0) !== null) {
    throw new Error("Expected fragmented state assembly to wait for every chunk before decoding");
  }

  for (let index = 1; index < chunks.length - 1; index += 1) {
    if (applyChunk(index) !== null) {
      throw new Error("Expected fragmented state assembly to stay pending until the final chunk arrives");
    }
  }

  const rebuiltState = applyChunk(chunks.length - 1);
  if (!rebuiltState || rebuiltState.snapshotSeq !== 777) {
    throw new Error("Expected the final state fragment to complete authoritative snapshot assembly");
  }
}

function assertProgressionPacketsRoundTrip() {
  const upgradePacket = deserializePacket(
    serializePacket({
      type: MESSAGE_TYPES.UPGRADE,
      classId: "sniper",
      messageId: "upgrade-smoke"
    })
  );
  if (!upgradePacket.ok || upgradePacket.packet.type !== MESSAGE_TYPES.UPGRADE || upgradePacket.packet.classId !== "sniper") {
    throw new Error("Expected upgrade packets to round-trip through shared protocol serialization");
  }

  const statPointPacket = deserializePacket(
    serializePacket({
      type: MESSAGE_TYPES.STAT_POINT,
      statName: "movementSpeed",
      messageId: "stat-smoke"
    })
  );
  if (
    !statPointPacket.ok ||
    statPointPacket.packet.type !== MESSAGE_TYPES.STAT_POINT ||
    statPointPacket.packet.statName !== "movementSpeed"
  ) {
    throw new Error("Expected stat-point packets to round-trip through shared protocol serialization");
  }

  const localClassId = GAME_CONFIG.lobby.classes[0]?.id ?? "assault";
  const progressionState = deserializePacket(
    serializePacket({
      type: MESSAGE_TYPES.STATE,
      roomId: "progression-smoke",
      snapshotSeq: 9,
      simulationTick: 9,
      snapshotTick: 9,
      serverTime: Date.now(),
      players: [{
        id: "player-1",
        profileId: "a".repeat(32),
        name: "Progression Smoke",
        teamId: GAME_CONFIG.lobby.teams[0]?.id ?? "alpha",
        classId: localClassId,
        tankClassId: "sniper",
        x: 420,
        y: 360,
        angle: 0.3,
        turretAngle: 0.4,
        hp: 132,
        maxHp: 140,
        score: 4,
        assists: 1,
        deaths: 0,
        credits: 12,
        alive: true,
        ready: true,
        connected: true,
        stats: {
          movementSpeed: 3,
          reload: 2
        }
      }],
      bullets: [{
        id: "bullet-1",
        ownerId: "player-1",
        x: 460,
        y: 360,
        angle: 0.4,
        speed: 950,
        damage: 44,
        radius: 12
      }],
      shapes: [{
        id: "shape-1",
        type: "triangle",
        x: 600,
        y: 420,
        hp: 20,
        maxHp: 25,
        radius: 22,
        angle: 0.8
      }],
      you: {
        playerId: "player-1",
        profileId: "a".repeat(32),
        alive: true,
        ready: true,
        isSpectator: false,
        teamId: GAME_CONFIG.lobby.teams[0]?.id ?? "alpha",
        classId: localClassId,
        tankClassId: "sniper",
        xp: 1600,
        level: 15,
        statPoints: 2,
        pendingUpgrades: ["assassin"],
        maxHp: 140,
        stats: {
          movementSpeed: 3,
          reload: 2
        },
        profileStats: {
          matchesPlayed: 1,
          wins: 0,
          kills: 2,
          deaths: 1,
          shotsFired: 5,
          shotsHit: 3
        }
      },
      replication: {
        mode: "full",
        baselineSnapshotSeq: 0
      }
    })
  );

  if (!progressionState.ok || progressionState.packet.type !== MESSAGE_TYPES.STATE) {
    throw new Error("Expected progression snapshots to round-trip through shared protocol serialization");
  }

  const state = progressionState.packet;
  if (
    state.players?.[0]?.tankClassId !== "sniper" ||
    state.players?.[0]?.maxHp !== 140 ||
    state.players?.[0]?.stats?.movementSpeed !== 3 ||
    state.bullets?.[0]?.radius !== 12 ||
    state.bullets?.[0]?.speed !== 950 ||
    state.shapes?.[0]?.type !== "triangle" ||
    state.you?.tankClassId !== "sniper" ||
    state.you?.level !== 15 ||
    state.you?.statPoints !== 2 ||
    state.you?.maxHp !== 140 ||
    state.you?.stats?.reload !== 2 ||
    state.you?.pendingUpgrades?.[0] !== "assassin"
  ) {
    throw new Error("Expected progression snapshots to preserve class, stat, bullet, and shape fields");
  }
}

function assertMapLayoutsExposeSpawnAndHotspotMetadata() {
  for (const map of GAME_CONFIG.lobby.maps) {
    const layout = getMapLayout(map.id);

    for (const team of GAME_CONFIG.lobby.teams) {
      const spawnAnchors = layout.teamSpawns?.[team.id];
      if (!Array.isArray(spawnAnchors) || spawnAnchors.length < 3) {
        throw new Error(`Expected ${map.id} to expose at least three spawn anchors for ${team.id}`);
      }
    }

    for (const shapeType of ["square", "triangle", "pentagon", "alpha_pentagon"]) {
      const hotspots = layout.shapeHotspots?.[shapeType];
      if (!Array.isArray(hotspots) || hotspots.length < 1) {
        throw new Error(`Expected ${map.id} to expose spawn hotspots for ${shapeType}`);
      }
    }
  }
}

try {
  assertStateChunkAssemblyWaitsForAllFragments();
  assertProgressionPacketsRoundTrip();
  assertMapLayoutsExposeSpawnAndHotspotMetadata();
  await waitForServer();
  const metaPayload = await requestJson("/meta");

  if (
    metaPayload.protocolVersion !== PROTOCOL_VERSION ||
    metaPayload.assetVersion !== ASSET_BUNDLE_VERSION ||
    metaPayload.profilesSchemaVersion !== PROFILES_SCHEMA_VERSION ||
    metaPayload.backendSchemaVersion !== 1 ||
    metaPayload.backendLoaded !== true ||
    metaPayload.profileCount < 1 ||
    metaPayload.simulation?.fixedTimestep !== true ||
    metaPayload.simulation?.tickRate !== GAME_CONFIG.serverTickRate ||
    metaPayload.simulation?.snapshotRate !== GAME_CONFIG.snapshotRate ||
    metaPayload.instance?.region !== smokeRegion ||
    metaPayload.capacity?.canAcceptAllocations !== true
  ) {
    throw new Error("Expected meta endpoint to expose compatibility, fixed-timestep sim data, and migrated profile data");
  }

  const allocatorStatusPayload = await requestJson("/api/allocator/status", {
    headers: {
      "x-allocator-key": allocatorApiKey
    }
  });
  if (
    allocatorStatusPayload.allocator?.instance?.region !== smokeRegion ||
    allocatorStatusPayload.allocator?.capacity?.canAcceptAllocations !== true
  ) {
    throw new Error("Expected allocator status to expose instance region and available allocation capacity");
  }

  const allocatedRoomPayload = await requestJson("/api/allocator/allocate", {
    method: "POST",
    headers: {
      "x-allocator-key": allocatorApiKey
    },
    body: {
      strategy: "new",
      prefix: "ops"
    }
  });
  const allocatedRoomId = allocatedRoomPayload.allocation?.roomId;
  if (
    !allocatedRoomId ||
    allocatedRoomPayload.allocation?.created !== true ||
    allocatedRoomPayload.allocation?.instance?.region !== smokeRegion
  ) {
    throw new Error("Expected allocator to create a new room allocation with instance metadata");
  }

  const allocatedRoomsPayload = await requestJson("/rooms");
  if (!allocatedRoomsPayload.rooms?.some((room) => room.roomCode === allocatedRoomId)) {
    throw new Error("Expected allocated rooms to appear in the room browser summary");
  }

  await requestJson("/api/admin/maintenance", {
    method: "POST",
    headers: {
      "x-admin-key": adminApiKey
    },
    body: {
      enabled: true,
      reason: "Smoke maintenance window"
    }
  });

  const maintenanceReadyPayload = await requestJson("/readyz", {
    allowError: true
  });
  if (
    maintenanceReadyPayload.statusCode !== 503 ||
    !maintenanceReadyPayload.body?.reasons?.includes("maintenance_mode")
  ) {
    throw new Error("Expected maintenance mode to make readiness fail with a maintenance reason");
  }

  const blockedAllocationPayload = await requestJson("/api/allocator/allocate", {
    method: "POST",
    headers: {
      "x-allocator-key": allocatorApiKey
    },
    body: {
      strategy: "new",
      prefix: "ops-blocked"
    },
    allowError: true
  });
  if (
    blockedAllocationPayload.statusCode !== 503 ||
    (blockedAllocationPayload.body?.error ?? blockedAllocationPayload.body?.code) !== "maintenance_mode"
  ) {
    throw new Error("Expected maintenance mode to block new room allocation");
  }

  await requestJson("/api/admin/maintenance", {
    method: "POST",
    headers: {
      "x-admin-key": adminApiKey
    },
    body: {
      enabled: false,
      draining: false
    }
  });

  const resumedReadyPayload = await requestJson("/readyz");
  if (resumedReadyPayload.status !== "ready") {
    throw new Error("Expected readiness to recover after maintenance mode is disabled");
  }

  if (smokeDataDir) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const migratedProfilesDocument = JSON.parse(
      fs.readFileSync(path.join(smokeDataDir, "profiles.json"), "utf8")
    );

    if (migratedProfilesDocument.schemaVersion !== PROFILES_SCHEMA_VERSION) {
      throw new Error("Expected legacy profiles.json to migrate to the current schema version");
    }
  }

  const registerPayload = await requestJson("/api/auth/register", {
    method: "POST",
    body: {
      username: "SmokeCaptain",
      email: "smoke@example.com",
      password: "smoke-password-123",
      displayName: "Smoke Captain"
    }
  });

  if (!registerPayload?.token || !registerPayload?.account?.accountId || !registerPayload?.profile?.profileId) {
    throw new Error("Expected account registration to return an authenticated account and profile");
  }

  const authHeaders = {
    Authorization: `Bearer ${registerPayload.token}`
  };

  const mePayload = await requestJson("/api/auth/me", {
    headers: authHeaders
  });
  if (mePayload.account?.username !== "SmokeCaptain" || mePayload.profile?.displayName !== "Smoke Captain") {
    throw new Error("Expected authenticated session lookup to return account and profile details");
  }

  const loginPayload = await requestJson("/api/auth/login", {
    method: "POST",
    body: {
      login: "SmokeCaptain",
      password: "smoke-password-123"
    }
  });
  if (!loginPayload?.token || loginPayload.account?.accountId !== registerPayload.account.accountId) {
    throw new Error("Expected login to issue a new token for the registered account");
  }

  const secureJoin = await connectClient("SecureJoin");
  const secureJoinAckPromise = waitForMessage(
    secureJoin,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-secure"
  );
  const secureJoinedPromise = waitForMessage(
    secureJoin,
    (payload) => payload.type === MESSAGE_TYPES.JOINED
  );
  joinRoom(secureJoin, "Smoke Captain", "forged-profile-id", "join-secure", {
    roomId: "secure-smoke",
    authToken: loginPayload.token
  });
  const [, secureJoined] = await Promise.all([secureJoinAckPromise, secureJoinedPromise]);
  if (secureJoined.profileId !== registerPayload.profile.profileId) {
    throw new Error(
      `Expected authenticated joins to claim the account-backed profile id (${registerPayload.profile.profileId}), got ${secureJoined.profileId}`
    );
  }
  secureJoin.close();

  const cloudSavePayload = await requestJson("/api/cloud-save", {
    method: "PUT",
    headers: authHeaders,
    body: {
      data: {
        settings: {
          audio: 0.4,
          hudScale: 1.1
        },
        loadout: "default"
      }
    }
  });
  if (cloudSavePayload.cloudSave?.revision !== 1) {
    throw new Error("Expected cloud saves to persist and version profile data");
  }

  const replayRequestId = "smoke-cloud-save-replay";
  const replayCloudSavePayload = await requestJson("/api/cloud-save", {
    method: "PUT",
    headers: {
      ...authHeaders,
      "x-request-id": replayRequestId
    },
    body: {
      data: {
        settings: {
          audio: 0.55,
          hudScale: 1.2
        },
        loadout: "replay-check"
      }
    }
  });
  if (replayCloudSavePayload.cloudSave?.revision !== 2) {
    throw new Error("Expected a fresh request id to allow a second cloud save mutation");
  }

  const replayBlockedPayload = await requestJson("/api/cloud-save", {
    method: "PUT",
    headers: {
      ...authHeaders,
      "x-request-id": replayRequestId
    },
    body: {
      data: {
        settings: {
          audio: 0.7,
          hudScale: 1.25
        },
        loadout: "replay-blocked"
      }
    },
    allowError: true
  });
  if (
    replayBlockedPayload.statusCode !== 409 ||
    (replayBlockedPayload.body?.error ?? replayBlockedPayload.body?.code) !== "replay_detected"
  ) {
    throw new Error("Expected duplicate mutation request ids to be rejected as replay attempts");
  }

  const rankPayload = await requestJson("/api/rank", {
    headers: authHeaders
  });
  const seasonPayload = await requestJson("/api/season", {
    headers: authHeaders
  });
  if (
    typeof rankPayload.ranking?.mmr !== "number" ||
    typeof seasonPayload.profile?.seasonStats?.matchesPlayed !== "number"
  ) {
    throw new Error("Expected ranking and season endpoints to expose persistent progression state");
  }

  const purchasePayload = await requestJson("/api/purchases", {
    method: "POST",
    headers: authHeaders,
    body: {
      sku: "cosmetic-desert-camo"
    }
  });
  if (!purchasePayload.transaction?.id || (purchasePayload.wallet?.coins ?? 0) >= 500) {
    throw new Error("Expected purchases to debit wallet balance and create a transaction");
  }

  const entitlementPayload = await requestJson("/api/entitlements/check", {
    method: "POST",
    headers: authHeaders,
    body: {
      entitlements: ["cosmetic:desert-camo"]
    }
  });
  if (!entitlementPayload.entitlements?.[0]?.owned) {
    throw new Error("Expected purchases to grant entitlements");
  }

  const transactionPayload = await requestJson("/api/transactions", {
    headers: authHeaders
  });
  if (!transactionPayload.transactions?.some((entry) => entry.id === purchasePayload.transaction.id)) {
    throw new Error("Expected transaction history to include the account purchase");
  }

  const securityPayload = await requestJson("/api/admin/security", {
    headers: {
      "x-admin-key": adminApiKey
    }
  });
  if (!securityPayload.security?.events?.some((event) => event.type === "replay_attempt_blocked")) {
    throw new Error("Expected admin security logs to include replay protection events");
  }

  await requestJson("/api/admin/rollback", {
    method: "POST",
    headers: {
      "x-admin-key": adminApiKey
    },
    body: {
      transactionId: purchasePayload.transaction.id
    }
  });

  const postRollbackEntitlementPayload = await requestJson("/api/entitlements/check", {
    method: "POST",
    headers: authHeaders,
    body: {
      entitlements: ["cosmetic:desert-camo"]
    }
  });
  if (postRollbackEntitlementPayload.entitlements?.[0]?.owned) {
    throw new Error("Expected admin rollback to revoke the purchased entitlement");
  }

  await requestJson("/api/admin/restore", {
    method: "POST",
    headers: {
      "x-admin-key": adminApiKey
    },
    body: {
      transactionId: purchasePayload.transaction.id,
      mode: "after"
    }
  });

  const postRestoreInventoryPayload = await requestJson("/api/inventory", {
    headers: authHeaders
  });
  if (
    !postRestoreInventoryPayload.entitlements?.includes("cosmetic:desert-camo") ||
    !postRestoreInventoryPayload.inventory?.items?.some((item) => item.itemId === "cosmetic-desert-camo")
  ) {
    throw new Error("Expected admin restore to reapply purchased inventory and entitlements");
  }

  const staleProtocolClient = await connectClient("OldProtocol");
  const staleProtocolErrorPromise = waitForMessage(
    staleProtocolClient,
    (payload) => payload.type === MESSAGE_TYPES.ERROR && payload.code === "unsupported_version"
  );
  const staleProtocolClosePromise = once(staleProtocolClient, "close");
  staleProtocolClient.send(
    JSON.stringify({
      v: PROTOCOL_VERSION + 1,
      type: MESSAGE_TYPES.JOIN,
      roomId: "smoke",
      name: "OldProtocol",
      profileId: "old-protocol-smoke"
    })
  );
  const [staleProtocolError, staleProtocolClose] = await Promise.all([
    staleProtocolErrorPromise,
    staleProtocolClosePromise
  ]);

  if (!String(staleProtocolError.message ?? "").includes("newer than supported") || staleProtocolClose[0] !== 4006) {
    throw new Error("Expected incompatible protocol versions to be rejected before join");
  }

  const staleClient = await connectClient("OldBuild");
  const staleErrorPromise = waitForMessage(
    staleClient,
    (payload) => payload.type === MESSAGE_TYPES.ERROR && payload.code === "game_version_mismatch"
  );
  const staleJoinedPromise = waitForMessage(staleClient, (payload) => payload.type === MESSAGE_TYPES.JOINED);
  joinRoom(staleClient, "OldBuild", "old-build-smoke", "join-old-build", {
    roomId: "compat-build",
    gameVersion: "0.0.0"
  });
  const [staleError, staleJoined] = await Promise.all([staleErrorPromise, staleJoinedPromise]);

  if (
    !String(staleError.message ?? "").includes("compatibility mode") ||
    staleJoined.roomId !== "compat-build" ||
    staleClient.readyState !== WebSocket.OPEN
  ) {
    throw new Error("Expected stale game builds to stay connected in compatibility mode");
  }
  staleClient.close();

  const staleAssetsClient = await connectClient("OldAssets");
  const staleAssetsErrorPromise = waitForMessage(
    staleAssetsClient,
    (payload) => payload.type === MESSAGE_TYPES.ERROR && payload.code === "asset_version_mismatch"
  );
  const staleAssetsJoinedPromise = waitForMessage(staleAssetsClient, (payload) => payload.type === MESSAGE_TYPES.JOINED);
  joinRoom(staleAssetsClient, "OldAssets", "old-assets-smoke", "join-old-assets", {
    roomId: "compat-assets",
    assetVersion: "0.0.0-assets"
  });
  const [staleAssetsError, staleAssetsJoined] = await Promise.all([
    staleAssetsErrorPromise,
    staleAssetsJoinedPromise
  ]);

  if (
    !String(staleAssetsError.message ?? "").includes("compatibility mode") ||
    staleAssetsJoined.roomId !== "compat-assets" ||
    staleAssetsClient.readyState !== WebSocket.OPEN
  ) {
    throw new Error("Expected stale asset bundles to stay connected in compatibility mode");
  }
  staleAssetsClient.close();

  const spamClient = await connectClient("Spam");
  for (let attempt = 0; attempt < GAME_CONFIG.antiCheat.maxControlMessagesPerSecond + 1; attempt += 1) {
    spamClient.send(
      serializePacket({
        type: MESSAGE_TYPES.PING,
        sentAt: Date.now()
      })
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (spamClient.readyState !== WebSocket.OPEN) {
    throw new Error("Expected control-message spam to stay connected with anti-cheat disabled");
  }
  spamClient.close();

  const invalidPacketClient = await connectClient("Invalid");
  for (let attempt = 0; attempt < GAME_CONFIG.antiCheat.maxViolationPoints + 1; attempt += 1) {
    invalidPacketClient.send("{bad-json");
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (invalidPacketClient.readyState !== WebSocket.OPEN) {
    throw new Error("Expected malformed packets to stop causing disconnects with anti-cheat disabled");
  }
  invalidPacketClient.close();

  const solo = await connectClient("Solo");
  const soloJoinedPromise = waitForMessage(solo, (payload) => payload.type === MESSAGE_TYPES.JOINED);
  const soloJoinAckPromise = waitForMessage(
    solo,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-solo"
  );
  joinRoom(solo, "Solo", "solo-smoke", "join-solo", {
    roomId: "solo-bot",
    teamId: "alpha",
    classId: "tank"
  });
  const [soloJoined] = await Promise.all([soloJoinedPromise, soloJoinAckPromise]);

  const soloWarmupState = await waitForState(
    solo,
    (payload) => {
      const localPlayer = getPlayerState(payload, soloJoined.playerId);
      const bots = getReplicatedPlayers(payload).filter((player) => player.isBot);
      return (
        payload.match?.phase === MATCH_PHASES.WARMUP &&
        Boolean(localPlayer) &&
        bots.length === 4
      );
    },
    "solo bot warmup state"
  );

  const soloPlayer = getPlayerState(soloWarmupState, soloJoined.playerId);
  const warmupBots = getReplicatedPlayers(soloWarmupState).filter((player) => player.isBot);
  const alphaBots = warmupBots.filter((player) => player.teamId === "alpha");
  const bravoBots = warmupBots.filter((player) => player.teamId === "bravo");

  if (!soloPlayer || warmupBots.length !== 4) {
    throw new Error("Expected a solo room to spawn four replicated AI bots");
  }

  if (alphaBots.length !== 2 || bravoBots.length !== 2) {
    throw new Error("Expected solo bot rooms to keep two AI bots on each team");
  }

  if (
    warmupBots.some((bot) => bot.hp !== (bot.maxHp ?? GAME_CONFIG.tank.hitPoints) || bot.alive !== true) ||
    soloWarmupState.match?.respawnsEnabled !== true
  ) {
    throw new Error("Expected solo bot rooms to stage full-health respawn-enabled AI squads");
  }

  const soloLiveState = await waitForState(
    solo,
    (payload) =>
      payload.match?.phase === MATCH_PHASES.IN_PROGRESS &&
      payload.match?.respawnsEnabled === true &&
      getReplicatedPlayers(payload).filter((player) => player.isBot).length === 4 &&
      getReplicatedPlayers(payload).some(
        (player) => player.isBot && player.hp === (player.maxHp ?? GAME_CONFIG.tank.hitPoints)
      ),
    "solo bot live state"
  );

  const soloLivePlayer = getPlayerState(soloLiveState, soloJoined.playerId);
  if (
    !soloLivePlayer ||
    Math.hypot(soloLivePlayer.x - soloPlayer.x, soloLivePlayer.y - soloPlayer.y) > 1
  ) {
    throw new Error("Expected solo bot rooms to enter live play without resetting the human player's spawn position");
  }

  if ((soloLiveState.leaderboard?.length ?? 0) < 5) {
    throw new Error("Expected a solo room with team bots to publish all combatants in the leaderboard");
  }

  let soloInputSeq = 1;
  const soloMoveInput = findClearMovementInput(soloLivePlayer);
  const soloMoveSeqStart = soloInputSeq;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    sendInput(solo, {
      seq: soloInputSeq++,
      clientSentAt: Date.now(),
      forward: soloMoveInput.forward,
      back: soloMoveInput.back,
      left: soloMoveInput.left,
      right: soloMoveInput.right,
      shoot: false,
      turretAngle: 0
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const soloMoveSeqEnd = soloInputSeq - 1;

  const soloMovedState = await waitForState(
    solo,
    (payload) => {
      const movedSoloPlayer = getPlayerState(payload, soloJoined.playerId);
      return (
        payload.you?.lastProcessedInputSeq >= soloMoveSeqEnd &&
        Boolean(movedSoloPlayer) &&
        Math.hypot(movedSoloPlayer.x - soloLivePlayer.x, movedSoloPlayer.y - soloLivePlayer.y) >= 6
      );
    },
    "solo bot movement state"
  );

  if (soloMovedState.you?.lastProcessedInputSeq < soloMoveSeqStart) {
    throw new Error("Expected solo bot rooms to keep processing human movement inputs after the team bots spawn");
  }

  const getCurrentSoloTarget = () => {
    const replicatedPlayers = Array.from(solo.playerCache.values());
    const localPlayer =
      replicatedPlayers.find((player) => player.id === soloJoined.playerId) ??
      getPlayerState(soloMovedState, soloJoined.playerId) ??
      soloLivePlayer;
    if (!localPlayer) {
      return { localPlayer: null, targetBot: null };
    }

    const targetBot =
      replicatedPlayers
        .filter(
          (player) =>
            player.isBot &&
            player.alive &&
            player.teamId &&
            localPlayer.teamId &&
            player.teamId !== localPlayer.teamId
        )
        .sort(
          (left, right) =>
            Math.hypot(left.x - localPlayer.x, left.y - localPlayer.y) -
            Math.hypot(right.x - localPlayer.x, right.y - localPlayer.y)
        )[0] ?? null;

    return { localPlayer, targetBot };
  };

  const soloBotRespawnPromise = waitForMessage(
    solo,
    (payload) =>
      payload.type === MESSAGE_TYPES.STATE &&
      payload.match?.phase === MATCH_PHASES.IN_PROGRESS &&
      payload.match?.respawnsEnabled === true &&
      getReplicatedPlayers(payload).some(
        (player) =>
          player.isBot &&
          player.deaths > 0 &&
          player.alive === true
      ),
    60000,
    "solo bot respawn state"
  );

  const soloMapId = soloLiveState.lobby?.mapId ?? GAME_CONFIG.lobby.maps[0]?.id ?? "frontier";
  const soloObjectiveTarget = getMapLayout(soloMapId)?.objective ?? {
    x: GAME_CONFIG.world.width / 2,
    y: GAME_CONFIG.world.height / 2
  };
  const soloShotDistance = GAME_CONFIG.bullet.speed * (GAME_CONFIG.bullet.lifeMs / 1000) * 0.9;
  const soloCombatDeadlineAt = Date.now() + 55_000;
  const hasSoloBotRespawned = () =>
    Array.from(solo.playerCache.values()).some(
      (player) => player.isBot && player.deaths > 0 && player.alive === true
    );

  for (let attempt = 0; Date.now() < soloCombatDeadlineAt; attempt += 1) {
    if (hasSoloBotRespawned()) {
      break;
    }

    const { localPlayer, targetBot } = getCurrentSoloTarget();
    if (smokeDebugEnabled && attempt % 20 === 0) {
      const visibleBots = Array.from(solo.playerCache.values())
        .filter((player) => player.isBot)
        .map((player) => ({
          id: player.id,
          teamId: player.teamId,
          alive: player.alive,
          hp: player.hp,
          deaths: player.deaths,
          x: Math.round(player.x ?? 0),
          y: Math.round(player.y ?? 0)
        }));
      debugSmoke("solo respawn probe", {
        attempt,
        localPlayer: localPlayer
          ? {
              x: Math.round(localPlayer.x ?? 0),
              y: Math.round(localPlayer.y ?? 0),
              hp: localPlayer.hp,
              alive: localPlayer.alive
            }
          : null,
        targetBot: targetBot
          ? {
              id: targetBot.id,
              x: Math.round(targetBot.x ?? 0),
              y: Math.round(targetBot.y ?? 0),
              hp: targetBot.hp,
              deaths: targetBot.deaths
            }
          : null,
        visibleBots
      });
    }

    if (!localPlayer) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      continue;
    }

    const navigationTarget = targetBot ?? soloObjectiveTarget;
    const turretAngle = Math.atan2(navigationTarget.y - localPlayer.y, navigationTarget.x - localPlayer.x);

    if (!targetBot) {
      const moveInput = buildMovementInputTowardPoint(localPlayer, soloObjectiveTarget, soloMapId);
      sendInput(solo, {
        seq: soloInputSeq++,
        clientSentAt: Date.now(),
        ...moveInput,
        shoot: false,
        turretAngle
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
      continue;
    }

    const targetDistance = Math.hypot(targetBot.x - localPlayer.x, targetBot.y - localPlayer.y);
    const shotBlocked = getMapObstacles(soloMapId).some((obstacle) =>
      segmentIntersectsRect(localPlayer.x, localPlayer.y, targetBot.x, targetBot.y, obstacle, GAME_CONFIG.bullet.radius)
    );

    if (targetDistance > soloShotDistance || shotBlocked) {
      const moveInput = buildMovementInputTowardPoint(localPlayer, targetBot, soloMapId);
      sendInput(solo, {
        seq: soloInputSeq++,
        clientSentAt: Date.now(),
        ...moveInput,
        shoot: false,
        turretAngle
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
      continue;
    }

    sendInput(solo, {
      seq: soloInputSeq++,
      clientSentAt: Date.now(),
      forward: false,
      back: false,
      left: false,
      right: false,
      shoot: true,
      turretAngle
    });
    await new Promise((resolve) => setTimeout(resolve, Math.max(GAME_CONFIG.tank.shootCooldownMs, 500) + 40));
    sendInput(solo, {
      seq: soloInputSeq++,
      clientSentAt: Date.now(),
      forward: false,
      back: false,
      left: false,
      right: false,
      shoot: false,
      turretAngle
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  const soloBotRespawnState = await soloBotRespawnPromise;

  if (!getPlayerState(soloBotRespawnState, soloJoined.playerId)) {
    throw new Error("Expected an authoritative local player state while validating bot respawn flow");
  }

  const soloRespawnAckPromise = waitForMessage(
    solo,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "solo-respawn-alive"
  );
  sendRespawn(solo, "solo-respawn-alive");
  await soloRespawnAckPromise;

  solo.close();
  await once(solo, "close");

  const freshSessionProfileId = "fresh-session-smoke";
  const freshSessionRoomId = "fresh-session-room";
  const freshSessionA = await connectClient("FreshSessionA");
  const freshSessionAJoinedPromise = waitForMessage(
    freshSessionA,
    (payload) => payload.type === MESSAGE_TYPES.JOINED
  );
  const freshSessionAAckPromise = waitForMessage(
    freshSessionA,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-fresh-session-a"
  );
  joinRoom(freshSessionA, "Fresh Session A", freshSessionProfileId, "join-fresh-session-a", {
    roomId: freshSessionRoomId,
    sessionId: "fresh-session-a",
    teamId: "alpha"
  });
  const [freshSessionAJoined] = await Promise.all([freshSessionAJoinedPromise, freshSessionAAckPromise]);
  const freshSessionPlayerId = freshSessionAJoined.playerId;
  sendInput(freshSessionA, {
    seq: 1,
    clientSentAt: Date.now(),
    forward: false,
    back: false,
    left: false,
    right: true,
    shoot: false,
    turretAngle: 0
  });
  sendInput(freshSessionA, {
    seq: 2,
    clientSentAt: Date.now(),
    forward: false,
    back: false,
    left: false,
    right: false,
    shoot: false,
    turretAngle: 0
  });
  await waitForState(
    freshSessionA,
    (payload) => payload.you?.lastProcessedInputSeq === 2,
    "fresh session initial input sequence"
  );
  freshSessionA.close();
  await once(freshSessionA, "close");

  const freshSessionB = await connectClient("FreshSessionB");
  const freshSessionBJoinedPromise = waitForMessage(
    freshSessionB,
    (payload) => payload.type === MESSAGE_TYPES.JOINED
  );
  const freshSessionBAckPromise = waitForMessage(
    freshSessionB,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-fresh-session-b"
  );
  joinRoom(freshSessionB, "Fresh Session B", freshSessionProfileId, "join-fresh-session-b", {
    roomId: freshSessionRoomId,
    sessionId: "fresh-session-b",
    teamId: "alpha"
  });
  const [freshSessionBJoined] = await Promise.all([freshSessionBJoinedPromise, freshSessionBAckPromise]);

  if (freshSessionBJoined.playerId !== freshSessionPlayerId) {
    throw new Error("Expected a disconnected player to be reclaimed when rejoining from a fresh tab session");
  }

  await waitForState(
    freshSessionB,
    (payload) => payload.you?.playerId === freshSessionPlayerId,
    "fresh session reclaimed player state"
  );

  sendInput(freshSessionB, {
    seq: 1,
    clientSentAt: Date.now(),
    forward: false,
    back: false,
    left: false,
    right: true,
    shoot: false,
    turretAngle: 0
  });

  const freshSessionResumeState = await waitForState(
    freshSessionB,
    (payload) => payload.you?.lastProcessedInputSeq === 1,
    "fresh session restarted input sequence"
  );

  if ((freshSessionResumeState.you?.lastProcessedInputSeq ?? 0) !== 1) {
    throw new Error("Expected a reclaimed fresh-session player to restart input sequencing from 1");
  }

  freshSessionB.close();
  await once(freshSessionB, "close");

  const modeSwitchProfileId = "mode-switch-smoke";
  const modeSwitchRoomId = "mode-switch-room";
  const modeSwitchSpectator = await connectClient("ModeSwitchSpectator");
  const modeSwitchSpectatorJoinedPromise = waitForMessage(
    modeSwitchSpectator,
    (payload) => payload.type === MESSAGE_TYPES.JOINED
  );
  const modeSwitchSpectatorAckPromise = waitForMessage(
    modeSwitchSpectator,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-mode-switch-spectator"
  );
  joinRoom(modeSwitchSpectator, "Mode Switch Spectator", modeSwitchProfileId, "join-mode-switch-spectator", {
    roomId: modeSwitchRoomId,
    sessionId: "mode-switch-a",
    spectate: true,
    teamId: "bravo"
  });
  const [modeSwitchSpectatorJoined] = await Promise.all([
    modeSwitchSpectatorJoinedPromise,
    modeSwitchSpectatorAckPromise
  ]);

  if (!modeSwitchSpectatorJoined.isSpectator) {
    throw new Error("Expected the initial mode-switch client to join as a spectator");
  }

  modeSwitchSpectator.close();
  await once(modeSwitchSpectator, "close");

  const modeSwitchPlayer = await connectClient("ModeSwitchPlayer");
  const modeSwitchPlayerJoinedPromise = waitForMessage(
    modeSwitchPlayer,
    (payload) => payload.type === MESSAGE_TYPES.JOINED
  );
  const modeSwitchPlayerAckPromise = waitForMessage(
    modeSwitchPlayer,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-mode-switch-player"
  );
  joinRoom(modeSwitchPlayer, "Mode Switch Player", modeSwitchProfileId, "join-mode-switch-player", {
    roomId: modeSwitchRoomId,
    sessionId: "mode-switch-b",
    spectate: false,
    teamId: "bravo"
  });
  const [modeSwitchPlayerJoined] = await Promise.all([modeSwitchPlayerJoinedPromise, modeSwitchPlayerAckPromise]);

  if (modeSwitchPlayerJoined.isSpectator) {
    throw new Error("Expected a reclaimed spectator to switch into active play mode when rejoining as a player");
  }

  const modeSwitchPlayableState = await waitForState(
    modeSwitchPlayer,
    (payload) =>
      payload.you?.isSpectator === false &&
      payload.you?.lastProcessedInputSeq === 0 &&
      getPlayerState(payload, modeSwitchPlayerJoined.playerId)?.alive === true,
    "mode switch active player state"
  );

  const modeSwitchPlayerState = getPlayerState(modeSwitchPlayableState, modeSwitchPlayerJoined.playerId);
  if (!modeSwitchPlayerState?.alive) {
    throw new Error("Expected a reclaimed spectator switched into player mode to spawn alive");
  }

  sendInput(modeSwitchPlayer, {
    seq: 1,
    clientSentAt: Date.now(),
    forward: false,
    back: false,
    left: true,
    right: false,
    shoot: false,
    turretAngle: 0
  });

  const modeSwitchMovedState = await waitForState(
    modeSwitchPlayer,
    (payload) => payload.you?.lastProcessedInputSeq === 1,
    "mode switch active input sequence"
  );

  if ((modeSwitchMovedState.you?.lastProcessedInputSeq ?? 0) !== 1) {
    throw new Error("Expected a reclaimed spectator switched into player mode to accept active input");
  }

  modeSwitchPlayer.close();
  await once(modeSwitchPlayer, "close");

  const alphaProfileId = "alpha-smoke";
  const bravoProfileId = "bravo-smoke";
  const alpha = await connectClient("Alpha");
  const bravo = await connectClient("Bravo");
  const alphaJoinedPromise = waitForMessage(alpha, (payload) => payload.type === MESSAGE_TYPES.JOINED);
  const bravoJoinedPromise = waitForMessage(bravo, (payload) => payload.type === MESSAGE_TYPES.JOINED);
  const alphaJoinAckPromise = waitForMessage(
    alpha,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-alpha"
  );
  const bravoJoinAckPromise = waitForMessage(
    bravo,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-bravo"
  );
  joinRoom(alpha, "Alpha", alphaProfileId, "join-alpha", {
    mapId: "switchyard",
    teamId: "bravo",
    classId: "tank"
  });
  joinRoom(bravo, "Bravo", bravoProfileId, "join-bravo", {
    teamId: "alpha",
    classId: "sniper"
  });
  const [alphaJoined, bravoJoined] = await Promise.all([
    alphaJoinedPromise,
    bravoJoinedPromise,
    alphaJoinAckPromise,
    bravoJoinAckPromise
  ]);
  const alphaPlayerId = alphaJoined.playerId;
  const bravoPlayerId = bravoJoined.playerId;
  let alphaInputSeq = 1;
  let bravoInputSeq = 1;

  const alphaClone = await connectClient("AlphaClone");
  const alphaCloneJoinedPromise = waitForMessage(alphaClone, (payload) => payload.type === MESSAGE_TYPES.JOINED);
  const alphaCloneAckPromise = waitForMessage(
    alphaClone,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-alpha-clone"
  );
  joinRoom(alphaClone, "Alpha Clone", alphaProfileId, "join-alpha-clone", {
    sessionId: "alpha-second-tab",
    spectate: true
  });
  const [alphaCloneJoined] = await Promise.all([alphaCloneJoinedPromise, alphaCloneAckPromise]);

  if (alphaCloneJoined.playerId === alphaPlayerId) {
    throw new Error("Expected a second session on the same profile to get its own player identity");
  }

  alphaClone.close();

  const lobbyState = await waitForState(
    alpha,
    (payload) =>
      payload.lobby?.mapId === "switchyard" &&
      payload.you?.teamId === "bravo" &&
      payload.you?.classId === "tank" &&
      payload.leaderboard?.some(
        (player) => player.name === "Bravo" && player.teamId === "alpha" && player.classId === "sniper"
      ),
    "lobby selections replicated"
  );

  if (lobbyState.lobby?.mapId !== "switchyard") {
    throw new Error("Expected authoritative lobby map selection to replicate");
  }

  if (lobbyState.you?.teamId !== "bravo" || lobbyState.you?.classId !== "tank") {
    throw new Error("Expected local team and class selection to round-trip through the server");
  }

  const stagingAlphaPlayer = getPlayerState(lobbyState, alphaPlayerId);
  if (!alphaPlayerId || !stagingAlphaPlayer) {
    throw new Error("Expected a replicated local player state immediately after joining the room");
  }

  const alphaSpawnExit = await movePlayerOutOfSpawnZone(
    alpha,
    alphaPlayerId,
    "alpha",
    alphaInputSeq,
    "alpha-side spawn exit"
  );
  alphaInputSeq = alphaSpawnExit.nextSeq;

  const bravoSpawnExit = await movePlayerOutOfSpawnZone(
    bravo,
    bravoPlayerId,
    "bravo",
    bravoInputSeq,
    "bravo-side spawn exit"
  );
  bravoInputSeq = bravoSpawnExit.nextSeq;

  const stagingReferencePlayer = getPlayerState(alphaSpawnExit.crossedState, alphaPlayerId) ?? stagingAlphaPlayer;
  const stagingMoveInput = findClearMovementInput(stagingReferencePlayer);
  const stagingMoveSeqStart = alphaInputSeq;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    sendInput(alpha, {
      seq: alphaInputSeq++,
      clientSentAt: Date.now(),
      forward: stagingMoveInput.forward,
      back: stagingMoveInput.back,
      left: stagingMoveInput.left,
      right: stagingMoveInput.right,
      shoot: false,
      turretAngle: 0
    });
  }
  const stagingMoveSeqEnd = alphaInputSeq - 1;

  const stagingBurstState = await waitForState(
    alpha,
    (payload) => {
      if (
        payload.match?.phase !== MATCH_PHASES.WAITING &&
        payload.match?.phase !== MATCH_PHASES.WARMUP &&
        payload.match?.phase !== MATCH_PHASES.IN_PROGRESS
      ) {
        return false;
      }

      return (payload.you?.lastProcessedInputSeq ?? 0) >= stagingMoveSeqStart;
    },
    "batched movement acknowledgement"
  );

  const stagingBurstProcessedSeq = stagingBurstState.you?.lastProcessedInputSeq ?? 0;
  const stagingPendingInputCount = stagingBurstState.you?.pendingInputCount ?? 0;
  const burstProcessedImmediately =
    stagingBurstProcessedSeq >= stagingMoveSeqEnd &&
    stagingPendingInputCount === 0;
  const burstStillBuffered =
    stagingBurstProcessedSeq >= stagingMoveSeqStart &&
    stagingBurstProcessedSeq < stagingMoveSeqEnd &&
    stagingPendingInputCount > 0;

  if (!burstProcessedImmediately && !burstStillBuffered) {
    throw new Error("Expected authoritative movement bursts to be either fully consumed in one tick or remain buffered for later ticks");
  }

  const stagingMoveState = await waitForState(
    alpha,
    (payload) => {
      if (
        payload.match?.phase !== MATCH_PHASES.WAITING &&
        payload.match?.phase !== MATCH_PHASES.WARMUP &&
        payload.match?.phase !== MATCH_PHASES.IN_PROGRESS
      ) {
        return false;
      }

      const player = getPlayerState(payload, alphaPlayerId);
      return (
        payload.you?.lastProcessedInputSeq >= stagingMoveSeqEnd &&
        (
          !player ||
          Math.hypot(player.x - stagingReferencePlayer.x, player.y - stagingReferencePlayer.y) >= 6 ||
          payload.you?.lastProcessedInputTick >= 1
        )
      );
    },
    "movement immediately after connect"
  );

  sendInput(alpha, {
    seq: alphaInputSeq++,
    clientSentAt: Date.now(),
    forward: false,
    back: false,
    left: false,
    right: false,
    shoot: false,
    turretAngle: 0
  });

  const movedAlphaPlayer = getPlayerState(stagingMoveState, alphaPlayerId);
  if (
    stagingMoveState.you?.lastProcessedInputSeq < stagingMoveSeqStart ||
    stagingMoveState.you?.lastProcessedInputTick < 1
  ) {
    throw new Error("Expected staging movement inputs to be processed immediately after connecting");
  }

  const roomBrowserPayload = await requestJson("/rooms");
  const smokeRoom = roomBrowserPayload.rooms?.find((room) => room.roomCode === "smoke");

  if (!smokeRoom || smokeRoom.mapId !== "switchyard" || smokeRoom.activePlayers < 2) {
    throw new Error("Expected /rooms to expose the synced room browser summary");
  }

  const switchyardLayout = getMapLayout("switchyard");
  const mappedObjectiveState = await waitForState(
    alpha,
    (payload) => {
      if (payload.lobby?.mapId !== "switchyard") {
        return false;
      }

      const zones = payload.objective?.zones;
      if (!Array.isArray(zones) || zones.length !== 3) {
        return false;
      }

      const leftZone = zones.find((zone) => zone.slot === "left");
      const centerZone = zones.find((zone) => zone.slot === "center");
      const rightZone = zones.find((zone) => zone.slot === "right");
      return Boolean(
        leftZone &&
          centerZone &&
          rightZone &&
          leftZone.x < centerZone.x &&
          rightZone.x > centerZone.x &&
          Math.abs(centerZone.x - switchyardLayout.objective.x) <= GAME_CONFIG.objective.centerJitterX + 40 &&
          Math.abs(centerZone.y - switchyardLayout.objective.y) <= GAME_CONFIG.objective.jitterY + 40
      );
    },
    "map-specific objective layout"
  );

  if (mappedObjectiveState.lobby?.mapId !== "switchyard") {
    throw new Error("Expected the selected map to remain authoritative while objective layout updated");
  }

  const [warmupStateA, warmupStateB] = await Promise.all([
    waitForState(
      alpha,
      (payload) =>
        payload.match?.phase === MATCH_PHASES.WARMUP ||
        payload.match?.phase === MATCH_PHASES.IN_PROGRESS,
      "alpha auto-start"
    ),
    waitForState(
      bravo,
      (payload) =>
        payload.match?.phase === MATCH_PHASES.WARMUP ||
        payload.match?.phase === MATCH_PHASES.IN_PROGRESS,
      "bravo auto-start"
    )
  ]);

  if (
    (
      warmupStateA.match?.phase !== MATCH_PHASES.WARMUP &&
      warmupStateA.match?.phase !== MATCH_PHASES.IN_PROGRESS
    ) ||
    (
      warmupStateB.match?.phase !== MATCH_PHASES.WARMUP &&
      warmupStateB.match?.phase !== MATCH_PHASES.IN_PROGRESS
    )
  ) {
    throw new Error("Expected both clients to auto-start into warmup or live play after connecting");
  }

  const [stateA, stateB] = await Promise.all([
    waitForState(
      alpha,
      (payload) =>
        payload.match?.phase === MATCH_PHASES.IN_PROGRESS &&
        hasReplicatedPlayerState(payload, payload.you?.playerId),
      "alpha active match snapshot"
    ),
    waitForState(
      bravo,
      (payload) =>
        payload.match?.phase === MATCH_PHASES.IN_PROGRESS &&
        hasReplicatedPlayerState(payload, payload.you?.playerId),
      "bravo active match snapshot"
    )
  ]);

  if (
    stateA.match?.phase !== MATCH_PHASES.IN_PROGRESS ||
    stateB.match?.phase !== MATCH_PHASES.IN_PROGRESS
  ) {
    throw new Error("Expected both clients to observe an active match with team bots");
  }

  if (
    stateA.match?.respawnsEnabled !== true ||
    stateB.match?.respawnsEnabled !== true ||
    (stateA.leaderboard?.length ?? 0) < 6 ||
    (stateB.leaderboard?.length ?? 0) < 6
  ) {
    throw new Error("Expected leaderboard replication for all active players and bots");
  }

  if (!Array.isArray(stateA.objective?.zones) || stateA.objective.zones.length !== 3) {
    throw new Error("Expected three objective zones to be present in snapshots");
  }

  const shapeScout = await connectClient("Shape Scout");
  const shapeScoutJoinedPromise = waitForMessage(
    shapeScout,
    (payload) => payload.type === MESSAGE_TYPES.JOINED
  );
  const shapeScoutJoinAckPromise = waitForMessage(
    shapeScout,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-shape-scout"
  );
  joinRoom(shapeScout, "Shape Scout", "shape-scout-smoke", "join-shape-scout", {
    roomId: "smoke",
    spectate: true
  });
  await Promise.all([shapeScoutJoinedPromise, shapeScoutJoinAckPromise]);

  const shapeEcologyState = await waitForState(
    shapeScout,
    (payload) =>
      payload.match?.phase === MATCH_PHASES.IN_PROGRESS &&
      getReplicatedShapes(payload).length >= 1,
    "neutral shape ecology snapshot"
  );
  shapeScout.close();

  if (getReplicatedShapes(shapeEcologyState).length < 1) {
    throw new Error("Expected active match snapshots to include neutral shape replication");
  }

  if (!Number.isInteger(stateA.snapshotSeq) || !Number.isInteger(stateB.snapshotSeq)) {
    throw new Error("Expected snapshot sequence numbers in state payloads");
  }

  if (
    !Number.isInteger(stateA.simulationTick) ||
    !Number.isInteger(stateA.snapshotTick) ||
    stateA.simulationTick < stateA.snapshotTick ||
    stateA.tickRate !== GAME_CONFIG.serverTickRate
  ) {
    throw new Error("Expected snapshots to expose authoritative tick metadata");
  }

  if (!Array.isArray(stateA.events) || !Array.isArray(stateA.inventory)) {
    throw new Error("Expected serialized events and inventory state in snapshots");
  }

  if (!stateA.replication || !Array.isArray(stateA.replication.spawns) || !Array.isArray(stateA.replication.updates)) {
    throw new Error("Expected replication payloads in state snapshots");
  }

  if (
    stateA.replication?.interest?.cellSize !== GAME_CONFIG.replication.cellSize ||
    stateA.replication?.interest?.selectedPlayers > stateA.replication?.interest?.candidatePlayers ||
    stateA.replication?.interest?.selectedBullets > stateA.replication?.interest?.candidateBullets
  ) {
    throw new Error("Expected snapshots to expose sanitized interest-management stats");
  }

  if (!stateA.leaderboard.every((player) => typeof player.credits === "number")) {
    throw new Error("Expected replicated credit totals in leaderboard state");
  }

  if (!stateA.leaderboard.every((player) => typeof player.assists === "number")) {
    throw new Error("Expected combat assist totals in replicated leaderboard state");
  }

  if ((stateA.inventory ?? []).some((entry) => entry.playerId !== stateA.you?.playerId)) {
    throw new Error("Expected inventory snapshots to remain private to the owning player");
  }

  if ((stateA.events ?? []).some((event) => event.type === EVENT_TYPES.INVENTORY && event.playerId !== stateA.you?.playerId)) {
    throw new Error("Expected private inventory events to be filtered from other players");
  }

  const fullStateA = getFullPlayerState(stateA, stateA.you?.playerId)
    ? stateA
    : await waitForState(
        alpha,
        (payload) =>
          payload.match?.phase === MATCH_PHASES.IN_PROGRESS &&
          Boolean(getFullPlayerState(payload, alphaPlayerId)),
        "alpha full local player snapshot"
      );
  const localAnimatedPlayer = getFullPlayerState(fullStateA, stateA.you?.playerId);
  if (
    !localAnimatedPlayer?.animation ||
    !localAnimatedPlayer?.combat ||
    typeof localAnimatedPlayer.animation.reloadFraction !== "number" ||
    typeof localAnimatedPlayer.animation.aimOffset !== "number" ||
    typeof localAnimatedPlayer.combat.armorMultiplier !== "number" ||
    typeof localAnimatedPlayer.combat.critChance !== "number"
  ) {
    throw new Error("Expected replicated player snapshots to include animation and combat state");
  }

  if (stateA.you?.playerId !== alphaPlayerId || stateB.you?.playerId !== bravoPlayerId) {
    throw new Error("Expected joined player identities to remain stable across authoritative snapshots");
  }

  const charlieProfileId = "charlie-smoke";
  const charlie = await connectClient("Charlie");
  const charlieJoinedPromise = waitForMessage(charlie, (payload) => payload.type === MESSAGE_TYPES.JOINED);
  const charlieJoinAckPromise = waitForMessage(
    charlie,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-charlie"
  );
  joinRoom(charlie, "Charlie", charlieProfileId, "join-charlie");
  const [charlieJoined] = await Promise.all([charlieJoinedPromise, charlieJoinAckPromise]);

  if (charlieJoined.isSpectator || charlieJoined.queuedForSlot) {
    throw new Error("Expected late joiners to enter active rooms as playable participants when slots are open");
  }

  const charlieState = await waitForState(
    charlie,
    (payload) =>
      payload.match?.phase === MATCH_PHASES.IN_PROGRESS &&
      !payload.you?.isSpectator &&
      payload.leaderboard?.some((entry) => entry.name === "Charlie"),
    "charlie active replication"
  );

  if (charlieState.you?.isSpectator || charlieState.you?.queuedForSlot) {
    throw new Error("Expected late joiner session state to stay active");
  }

  if (
    !charlieState.leaderboard?.some((entry) => entry.name === "Alpha") ||
    !charlieState.leaderboard?.some((entry) => entry.name === "Bravo")
  ) {
    throw new Error("Expected late joiners to receive the existing active players in the authoritative room state");
  }

  if ((charlieState.replication?.interest?.selectedPlayers ?? 0) < 1) {
    throw new Error("Expected interest management to include at least the local active player entity");
  }

  const alphaPlayer = getFullPlayerState(fullStateA, alphaPlayerId) ?? getPlayerState(stateA, alphaPlayerId);
  const lagCompShotAngle = alphaPlayer ? findClearShotAngle(alphaPlayer) : null;

  if (!alphaPlayerId || !alphaPlayer || lagCompShotAngle === null) {
    throw new Error("Expected a valid local player state for lag-compensation smoke coverage");
  }

  const lagShotSeq = alphaInputSeq++;
  sendInput(alpha, {
    seq: lagShotSeq,
    clientSentAt: Date.now() - 90,
    forward: false,
    back: false,
    left: false,
    right: false,
    shoot: true,
    turretAngle: lagCompShotAngle
  });

  const lagCompState = await waitForState(
    alpha,
    (payload) =>
      payload.you?.lastProcessedInputSeq >= lagShotSeq &&
      payload.you?.lastProcessedInputTick >= 1 &&
      (
        (payload.events ?? []).some(
          (event) =>
            event.type === EVENT_TYPES.ANIMATION && event.playerId === alphaPlayerId && event.action === "fire"
        ) ||
        payloadContainsOwnedBullet(payload, alphaPlayerId) ||
          (payload.events ?? []).some(
            (event) => event.type === EVENT_TYPES.HIT && event.attackerId === alphaPlayerId
          )
      ),
    "lag compensation processed shot"
  );

  if (lagCompState.you?.lastProcessedInputSeq < lagShotSeq || lagCompState.you?.lastProcessedInputTick < 1) {
    throw new Error("Expected the server to process the delayed shot input with tick metadata");
  }

  const alphaResyncAckPromise = waitForMessage(
    alpha,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "resync-alpha"
  );
  const alphaFullResyncPromise = waitForState(
    alpha,
    (payload) =>
      payload.snapshotSeq > lagCompState.snapshotSeq &&
      payload.replication?.mode === "full" &&
      payload.replication?.baselineSnapshotSeq === 0 &&
      hasReplicatedPlayerState(payload, alphaPlayerId),
    "alpha full resync"
  );
  requestResync(alpha, lagCompState.snapshotSeq, "resync-alpha");
  await Promise.all([alphaResyncAckPromise, alphaFullResyncPromise]);

  await new Promise((resolve) => setTimeout(resolve, 60));
  const settleSeq = alphaInputSeq++;
  sendInput(alpha, {
    seq: settleSeq,
    clientSentAt: Date.now(),
    forward: false,
    back: false,
    left: false,
    right: false,
    shoot: false,
    turretAngle: lagCompShotAngle
  });

  alpha.close();

  const reconnectWindowState = await waitForState(
    bravo,
    (payload) =>
      (payload.match?.phase === MATCH_PHASES.PAUSED || payload.match?.phase === MATCH_PHASES.IN_PROGRESS) &&
      (
        payload.leaderboard?.some((player) => player.connected === false && player.slotReserved === true) ||
        payload.players.some((player) => !player.connected && player.slotReserved) ||
        payload.replication?.spawns?.some(
          (record) =>
            record.kind === REPLICATION_KINDS.PLAYER &&
            record.state &&
            record.state.connected === false &&
            record.state.slotReserved === true
        ) ||
        payload.replication?.updates?.some(
          (record) =>
            record.kind === REPLICATION_KINDS.PLAYER &&
            record.state &&
            record.state.connected === false &&
            record.state.slotReserved === true
        )
      ),
    "reconnect window"
  );

  if (
    reconnectWindowState.match?.phase !== MATCH_PHASES.PAUSED &&
    reconnectWindowState.match?.phase !== MATCH_PHASES.IN_PROGRESS
  ) {
    throw new Error("Expected match to either pause or remain live while a reconnect slot is reserved");
  }

  const alphaReconnect = await connectClient("Alpha");
  const alphaReconnectJoinedPromise = waitForMessage(
    alphaReconnect,
    (payload) => payload.type === MESSAGE_TYPES.JOINED
  );
  const alphaReconnectAckPromise = waitForMessage(
    alphaReconnect,
    (payload) => payload.type === MESSAGE_TYPES.ACK && payload.messageId === "join-alpha-reconnect"
  );
  joinRoom(alphaReconnect, "Alpha", alphaProfileId, "join-alpha-reconnect");
  await Promise.all([alphaReconnectJoinedPromise, alphaReconnectAckPromise]);

  const [resumedStateA, resumedStateB] = await Promise.all([
    waitForState(alphaReconnect, (payload) => payload.match?.phase === MATCH_PHASES.IN_PROGRESS, "alpha resumed"),
    waitForState(bravo, (payload) => payload.match?.phase === MATCH_PHASES.IN_PROGRESS, "bravo resumed")
  ]);

  if (
    resumedStateA.match?.phase !== MATCH_PHASES.IN_PROGRESS ||
    resumedStateB.match?.phase !== MATCH_PHASES.IN_PROGRESS
  ) {
    throw new Error("Expected match to resume after reconnect");
  }

  alphaReconnect.close();
  bravo.close();
  charlie.close();
  await stopServer();
  console.log("Smoke test passed");
} catch (error) {
  await stopServer();
  console.error("Smoke test failed");
  console.error(serverOutput);
  console.error(error);
  process.exitCode = 1;
}
