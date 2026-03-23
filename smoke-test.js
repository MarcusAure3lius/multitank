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
  serializePacket
} from "./shared/protocol.js";

const isExternalServer = /^(1|true|yes|on)$/i.test(String(process.env.SMOKE_EXTERNAL ?? ""));
const port = Number(process.env.SMOKE_PORT ?? 4312);
const baseHttpUrl = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${port}`;
const baseWsUrl = process.env.SMOKE_WS_URL ?? baseHttpUrl.replace(/^http/i, "ws");
const adminApiKey = process.env.SMOKE_ADMIN_API_KEY ?? "smoke-admin-key";
const allocatorApiKey = process.env.SMOKE_ALLOCATOR_API_KEY ?? "smoke-allocator-key";
const smokeRegion = process.env.SMOKE_DEPLOY_REGION ?? "smoke-east";
const smokeDataDir = isExternalServer
  ? (process.env.SMOKE_DATA_DIR ? path.resolve(process.env.SMOKE_DATA_DIR) : null)
  : fs.mkdtempSync(path.join(os.tmpdir(), "multitank-smoke-"));

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
    const onMessage = (raw) => {
      const parsed = deserializePacket(String(raw));
      if (!parsed.ok) {
        return;
      }

      const payload = parsed.packet;

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

function sendInput(socket, input) {
  socket.send(
    serializePacket({
      type: MESSAGE_TYPES.INPUT,
      ...input
    })
  );
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

function findClearShotAngle(player) {
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

    const blocked = GAME_CONFIG.world.obstacles.some((obstacle) =>
      segmentIntersectsRect(player.x, player.y, endX, endY, obstacle, GAME_CONFIG.bullet.radius)
    );

    if (!blocked) {
      return angle;
    }
  }

  return null;
}

function findClearMovementInput(player) {
  const traceDistance = 140;
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

    const blocked = GAME_CONFIG.world.obstacles.some((obstacle) =>
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

try {
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
    classId: "vanguard"
  });
  joinRoom(bravo, "Bravo", bravoProfileId, "join-bravo", {
    teamId: "alpha",
    classId: "scout"
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
      payload.you?.classId === "vanguard" &&
      payload.leaderboard?.some(
        (player) => player.name === "Bravo" && player.teamId === "alpha" && player.classId === "scout"
      ),
    "lobby selections replicated"
  );

  if (lobbyState.lobby?.mapId !== "switchyard") {
    throw new Error("Expected authoritative lobby map selection to replicate");
  }

  if (lobbyState.you?.teamId !== "bravo" || lobbyState.you?.classId !== "vanguard") {
    throw new Error("Expected local team and class selection to round-trip through the server");
  }

  const stagingAlphaPlayer = getPlayerState(lobbyState, alphaPlayerId);
  if (!alphaPlayerId || !stagingAlphaPlayer) {
    throw new Error("Expected a replicated local player state immediately after joining the room");
  }

  const stagingMoveInput = findClearMovementInput(stagingAlphaPlayer);
  const stagingMoveSeqStart = alphaInputSeq;
  for (let attempt = 0; attempt < 6; attempt += 1) {
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
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const stagingMoveSeqEnd = alphaInputSeq - 1;

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
          Math.hypot(player.x - stagingAlphaPlayer.x, player.y - stagingAlphaPlayer.y) >= 6 ||
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
    throw new Error("Expected both clients to observe an active match with two players");
  }

  if ((stateA.leaderboard?.length ?? 0) < 2 || (stateB.leaderboard?.length ?? 0) < 2) {
    throw new Error("Expected leaderboard replication for both active players");
  }

  if (!stateA.objective || typeof stateA.objective.captureProgress !== "number") {
    throw new Error("Expected objective state to be present in snapshots");
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
