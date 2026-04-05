import {
  ANIMATION_ACTIONS,
  ASSET_BUNDLE_VERSION,
  AUTO_BARREL_ROT_SPEED,
  BASIC_CLASS_SPECIALIZATIONS,
  CLASS_TREE,
  clamp,
  COMBAT_EVENT_ACTIONS,
  EVENT_TYPES,
  GAME_BUILD_VERSION,
  GAME_CONFIG,
  MATCH_PHASES,
  MAX_LEVEL,
  MESSAGE_TYPES,
  REPLICATION_KINDS,
  SHAPE_TYPES,
  SOUND_CUES,
  STAT_NAMES,
  STATUS_EFFECTS,
  VFX_CUES,
  XP_PER_LEVEL,
  deserializePacket,
  getLobbyClassProfile,
  getLockedCameraZoom,
  getMapLayout,
  getTankRadiusForClassId,
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
const scoreboardPanelElement = document.getElementById("scoreboard-panel");
const scoreboardElement = document.getElementById("scoreboard");
const killFeedElement = document.getElementById("kill-feed");
const joinForm = document.getElementById("join-form");
const joinMatchButton = document.getElementById("join-match-button");
const readyButton = document.getElementById("ready-button");
const createRoomButton = document.getElementById("create-room-button");
const nameInput = document.getElementById("name-input");
const startHomeTabButton = document.getElementById("start-home-tab");
const startSpectateTabButton = document.getElementById("start-spectate-tab");
const startDebugTabButton = document.getElementById("start-debug-tab");
const startSettingsTabButton = document.getElementById("start-settings-tab");
const startHomePanel = document.getElementById("start-home-panel");
const startSpectatePanel = document.getElementById("start-spectate-panel");
const startDebugPanel = document.getElementById("start-debug-panel");
const startSettingsPanel = document.getElementById("start-settings-panel");
const fullscreenButton = document.getElementById("fullscreen-button");
const fullscreenStatusElement = document.getElementById("fullscreen-status");
const spectateButton = document.getElementById("spectate-button");
const debugPlayButton = document.getElementById("debug-play-button");
const roomInput = document.getElementById("room-input");
const spectateInput = document.getElementById("spectate-input");
const lobbyRoomCodeElement = document.getElementById("lobby-room-code");
const lobbySummaryElement = document.getElementById("lobby-summary");
const mapSelect = document.getElementById("map-select");
const teamSelect = document.getElementById("team-select");
const classSelect = document.getElementById("class-select");
const classTabsPanelElement = document.getElementById("class-tabs-panel");
const classTabsElement = document.getElementById("class-tabs");
const roomBrowserElement = document.getElementById("room-browser");
const refreshRoomsButton = document.getElementById("refresh-rooms-button");
const resultsCard = document.getElementById("results-card");
const resultsSummaryElement = document.getElementById("results-summary");
const resultsListElement = document.getElementById("results-list");
const deathOverlayElement = document.getElementById("death-overlay");
const respawnButton = document.getElementById("respawn-button");
const legacyFallbackVisualsBlockedByHiddenAncestor = Boolean(
  playAreaElement?.closest("[hidden]") || fallbackVisualLayerElement?.closest("[hidden]")
);

const STORAGE_KEYS = {
  name: "multitank.name",
  room: "multitank.room",
  profileId: "multitank.profileId",
  spectate: "multitank.spectate",
  debugMode: "multitank.debugMode",
  perfMode: "multitank.perfMode",
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

const LOCAL_PROJECTILE_HANDOFF = Object.freeze({
  maxMatchDistance: 220,
  settleRate: 18
});

const NETWORK_RECOVERY = Object.freeze({
  staleStateWarningMs: Math.max(15000, Math.round(GAME_CONFIG.network.heartbeatTimeoutMs / 3)),
  staleStateStatusCooldownMs: 8000
});

const LOCAL_PREDICTION = Object.freeze({
  stallSoftLimitMs: 120,
  stallHardLimitMs: 280,
  maxReplayWindowMs: 160,
  maxSmoothGap: 72,
  snapGap: 140,
  maxCorrectionOffset: 96
});

const CLIENT_TICK = Object.freeze({
  rate: GAME_CONFIG.serverTickRate,
  fixedDeltaSeconds: 1 / GAME_CONFIG.serverTickRate
});

const LOCAL_INPUT_RESPONSE = Object.freeze({
  maxSendRate: Math.max(CLIENT_TICK.rate, Math.min(40, GAME_CONFIG.antiCheat?.maxInputsPerSecond ?? 40)),
  maxPredictionStepSeconds: 1 / 30,
  immediateStateChangeMinIntervalMs: 12
});

const LOCAL_AIM_RESPONSE = Object.freeze({
  inputGraceMs: Math.max(120, Math.ceil(1000 / CLIENT_TICK.rate) * 2)
});

const LOCAL_CAMERA = Object.freeze({
  activeFollowRate: 36,
  activeFollowMin: 0.36,
  activeFollowMax: 0.88,
  snapDistance: 220
});

const DEBUG_MONITOR = Object.freeze({
  eventTtlMs: 10_000,
  mergeWindowMs: 1_200,
  latencySampleSize: 20,
  latencySampleWindowMs: 16_000,
  packetWindowSize: 24,
  pingTimeoutMs: 6_000,
  correctionWindowMs: 4_000,
  frequentCorrectionThreshold: 8,
  correctionIssueDistance: Math.max(10, Math.round(GAME_CONFIG.tank.radius * 0.5)),
  highPingMs: 160,
  highJitterMs: 24,
  highPacketLossPercent: 10,
  snapshotDelayWarningMs: 220,
  replayInputWarningCount: 24,
  inputSeqJumpWarning: 12,
  frameSpikeMs: 34,
  tickRateLowRatio: 0.85,
  predictedShotTimeoutMs: 650,
  bulletVolleyWindowMs: 80,
  fireRateSlack: 0.45,
  aiReportCacheMs: 250,
  snapshotAnalysisIntervalMs: 200,
  staleReliableActionMs: 2_500,
  movementSampleWindowMs: 750,
  entitySpeedSlack: 2.2,
  teleportDistance: 240,
  bulletTrackTtlMs: GAME_CONFIG.bullet.lifeMs + 2_000
});

const DEBUG_AI_REPORT_HOTKEY = "F8";
const DEBUG_SUBSYSTEM_TAGS = Object.freeze({
  ability: "ABLT",
  combat: "CMBT",
  input: "INPT",
  network: "NET",
  prediction: "PRED",
  render: "RNDR",
  replication: "REPL",
  server: "SRV",
  session: "SESS",
  snapshot: "SNAP",
  state: "STATE",
  unknown: "GEN"
});
const DEBUG_SUBSYSTEM_INSPECT_TARGETS = Object.freeze({
  ability: Object.freeze([
    "public/client.js: reliable request + local UI gating",
    "server.js: handleSpecialization / handleUpgrade / handleStatPoint",
    "shared/protocol.js: specialization / upgrade payloads"
  ]),
  combat: Object.freeze([
    "public/client.js: predicted shot tracking + combat HUD",
    "server.js: projectile spawn / combat validation",
    "shared/protocol.js: projectile snapshot fields"
  ]),
  input: Object.freeze([
    "public/client.js: dispatchLocalInput + input timeline",
    "server.js: handleInput + createInputFrame",
    "shared/protocol.js: input packet normalize/encode"
  ]),
  network: Object.freeze([
    "public/client.js: ping/pong tracking + socket state",
    "server.js: websocket send cadence + heartbeat",
    "deploy/runtime: region, proxy, and packet path"
  ]),
  prediction: Object.freeze([
    "public/client.js: noteReconciliation + local prediction",
    "public/client.js: applySnapshot + replay buffer",
    "server.js: input processing order + state correction"
  ]),
  render: Object.freeze([
    "public/client.js: render loop timing",
    "public/client.js: updateRenderState + camera smoothing",
    "browser runtime: tab visibility / GPU throttling"
  ]),
  replication: Object.freeze([
    "public/client.js: snapshot chunk rebuild + resync",
    "server.js: buildReplicationPayloadForSocket",
    "shared/protocol.js: state/replication payload encode"
  ]),
  server: Object.freeze([
    "server.js: main loop timing and room tick workload",
    "server.js: buildDebugSnapshot + state payload",
    "deploy/runtime: CPU contention or slow host"
  ]),
  session: Object.freeze([
    "public/client.js: reconnect path + reliable join state",
    "server.js: joinRoom + reconnect/session expiry",
    "auth/session storage: client token/session id state"
  ]),
  snapshot: Object.freeze([
    "public/client.js: applySnapshot + noteSnapshotDebugState",
    "server.js: getRoomStatePayload + viewer state builders",
    "shared/protocol.js: createStatePayload + decode path"
  ]),
  state: Object.freeze([
    "server.js: entity simulation + clamps/corrections",
    "shared/protocol.js: state sanitization",
    "public/client.js: local state application"
  ]),
  unknown: Object.freeze([
    "public/client.js: debug issue producer",
    "server.js: matching issue code producer",
    "shared/protocol.js: packet encode/decode path"
  ])
});
const DEBUG_ISSUE_INSIGHTS = Object.freeze({
  ability_denied: {
    subsystem: "ability",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 92,
    aiSummary: "The server rejected an ability/stat request because game state did not match the request.",
    likelyCause: "Client gating is out of sync with server rules or the request was fired at the wrong time.",
    fixHint: "Mirror the server allow/deny conditions in the client UI and log the exact request state before send."
  },
  ability_state_mismatch: {
    subsystem: "ability",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 58,
    aiSummary: "An upgrade request stayed pending and did not round-trip back into state.",
    likelyCause: "The request was dropped, denied, or state replication did not deliver the result.",
    fixHint: "Check the reliable send path, then compare server upgrade handling with replicated player state."
  },
  ability_triggered_no_effect: {
    subsystem: "ability",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 60,
    aiSummary: "An ability request was sent but no authoritative state change arrived.",
    likelyCause: "The request was denied server-side or the result never reached the client.",
    fixHint: "Trace the reliable message id through send, server handler, and next replicated snapshot."
  },
  bullet_missing_owner: {
    subsystem: "snapshot",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 93,
    aiSummary: "Projectile snapshots are missing a valid owner link.",
    likelyCause: "Projectile replication is emitting incomplete state or the owner entity is missing from the same snapshot.",
    fixHint: "Audit projectile creation/serialization and ensure owner ids survive replication and decode."
  },
  cooldown_desync: {
    subsystem: "combat",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 56,
    aiSummary: "The client predicted a shot/cooldown state that the server did not confirm.",
    likelyCause: "Local fire prediction timing differs from authoritative reload or shot acceptance rules.",
    fixHint: "Compare local reload prediction with server fire gating and authoritative projectile spawn timing."
  },
  dead_player_still_acting: {
    subsystem: "state",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 95,
    aiSummary: "Replicated state shows actions that should be impossible for a dead entity.",
    likelyCause: "Death state, projectile cleanup, or movement disable logic is inconsistent.",
    fixHint: "Inspect death transitions, action gating, and cleanup ordering on the server first."
  },
  desync_detected: {
    subsystem: "prediction",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 55,
    aiSummary: "Client prediction drifted materially away from server authority.",
    likelyCause: "Snapshot timing, input replay, or movement simulation differs between client and server.",
    fixHint: "Check for stale snapshots, large pending input queues, and divergent movement constants."
  },
  desync_detected_live: {
    subsystem: "prediction",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 57,
    aiSummary: "Live local render state is visibly offset from authoritative player state.",
    likelyCause: "Prediction smoothing is masking a deeper snapshot or input mismatch.",
    fixHint: "Compare local predicted position, replay queue length, and incoming snapshot cadence."
  },
  duplicate_input_sequence: {
    subsystem: "input",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 82,
    aiSummary: "The server is receiving repeated input sequence ids and ignoring them.",
    likelyCause: "Client sequence generation or resend behavior is duplicating input frames.",
    fixHint: "Log input seq generation on the client and verify retries do not resend gameplay input packets."
  },
  fire_rate_too_high: {
    subsystem: "combat",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 63,
    aiSummary: "Projectile cadence exceeds the expected reload timing.",
    likelyCause: "Reload timing differs between simulation and replication or duplicate projectile spawn is occurring.",
    fixHint: "Compare class reload constants, fire gating, and projectile dedupe by owner/time window."
  },
  fire_rejected: {
    subsystem: "combat",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 61,
    aiSummary: "A predicted shot never became an authoritative projectile.",
    likelyCause: "The shot was denied, dropped, or predicted too early on the client.",
    fixHint: "Trace the shot from local input seq to server fire validation to projectile replication."
  },
  frame_time_spike: {
    subsystem: "render",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 50,
    aiSummary: "The local render loop experienced a large frame-time stall.",
    likelyCause: "CPU/GPU stall, hidden-tab throttling, or too much per-frame work in the client.",
    fixHint: "Profile the render loop, particle counts, and DOM/canvas work around the spike."
  },
  frequent_reconciliation: {
    subsystem: "prediction",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 59,
    aiSummary: "Server corrections are happening repeatedly instead of occasionally.",
    likelyCause: "Prediction is systematically diverging from authoritative movement rather than hitting one-off corrections.",
    fixHint: "Compare movement math/constants and inspect snapshot delay, pending inputs, and input ordering."
  },
  health_out_of_range: {
    subsystem: "state",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 94,
    aiSummary: "Replicated health values violate valid entity bounds.",
    likelyCause: "Damage/heal application or state serialization is bypassing clamps.",
    fixHint: "Audit server health mutation paths and clamp before replication."
  },
  high_jitter: {
    subsystem: "network",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 54,
    aiSummary: "Packet arrival timing is unstable even if average latency is acceptable.",
    likelyCause: "Network burstiness, proxy buffering, or uneven server send cadence.",
    fixHint: "Compare jitter against server loop lag and snapshot cadence before changing prediction code."
  },
  high_ping: {
    subsystem: "network",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 52,
    aiSummary: "Round-trip latency is high enough to delay authoritative responses.",
    likelyCause: "Slow network path, distant host, or server response delay.",
    fixHint: "Compare ping with server loop lag. If lag is low, investigate transport/hosting path first."
  },
  input_buffer_trimmed: {
    subsystem: "input",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 88,
    aiSummary: "The server discarded older buffered inputs because the queue overflowed.",
    likelyCause: "Client is sending faster than the server can consume or state acknowledgements are falling behind.",
    fixHint: "Inspect input send rate, ack flow, and long server ticks that delay input consumption."
  },
  input_rate_limit: {
    subsystem: "input",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 97,
    aiSummary: "The server is rejecting inputs because the client exceeded allowed input throughput.",
    likelyCause: "Input dispatch is firing too often or duplicate input sends are occurring.",
    fixHint: "Start in the client send path and verify rate limiting, dedupe, and immediate-dispatch triggers."
  },
  input_sequence_jump: {
    subsystem: "input",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 90,
    aiSummary: "Input sequence numbers skipped farther than the server will accept.",
    likelyCause: "Client sequence generation or reconnect/reset logic is discontinuous.",
    fixHint: "Inspect sequence initialization, reconnect resets, and any path that reuses stale input ids."
  },
  invalid_entity_state: {
    subsystem: "state",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 98,
    aiSummary: "The server corrected an impossible entity state before accepting it.",
    likelyCause: "Movement, collision, or state mutation produced NaN/out-of-bounds data.",
    fixHint: "Inspect the server simulation path that writes player position/angle before replication."
  },
  invalid_input_value: {
    subsystem: "input",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 84,
    aiSummary: "A request contained an invalid enum/id that the server rejected.",
    likelyCause: "Client UI sent a stale or malformed ability/stat identifier.",
    fixHint: "Verify client payload construction against shared protocol enums before the send path."
  },
  large_correction_after_replay: {
    subsystem: "prediction",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 66,
    aiSummary: "Replaying pending inputs still ends in a large correction.",
    likelyCause: "Replay logic or input ordering is diverging from authoritative simulation.",
    fixHint: "Compare replay order, fixed delta, and movement constants against the server."
  },
  large_reconciliation_correction: {
    subsystem: "prediction",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 64,
    aiSummary: "The client needed a large snap-like correction to catch up to the server.",
    likelyCause: "Prediction drift exceeded the smoothing budget.",
    fixHint: "Check snapshot cadence and any constants that differ between client and server movement."
  },
  missing_input_sequence: {
    subsystem: "input",
    kind: "root",
    confidence: "medium",
    rootCauseWeight: 79,
    aiSummary: "Input sequence values are arriving with gaps.",
    likelyCause: "Input packets are being dropped or the client skipped sequence ids locally.",
    fixHint: "Log seq generation and compare with websocket send order before investigating simulation."
  },
  movement_corrected: {
    subsystem: "state",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 96,
    aiSummary: "The server rejected movement as impossible and restored the previous safe state.",
    likelyCause: "Client movement math, collision assumptions, or speed limits do not match the server.",
    fixHint: "Compare server movement limits with client prediction constants and collision handling."
  },
  movement_corrected_by_server: {
    subsystem: "prediction",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 62,
    aiSummary: "Authoritative movement is repeatedly pulling the client back into line.",
    likelyCause: "Prediction drift or stale snapshots are accumulating.",
    fixHint: "Treat this as a symptom and prioritize stronger prediction/snapshot/input issues above it."
  },
  movement_speed_too_high: {
    subsystem: "snapshot",
    kind: "root",
    confidence: "medium",
    rootCauseWeight: 80,
    aiSummary: "Replicated movement exceeds what the simulation should allow.",
    likelyCause: "Entity state is teleporting, being double-applied, or crossing a stale state boundary.",
    fixHint: "Inspect movement replication and transitions around spawn, death, and round changes."
  },
  packet_loss_high: {
    subsystem: "network",
    kind: "root",
    confidence: "medium",
    rootCauseWeight: 86,
    aiSummary: "A meaningful share of recent ping samples were lost or timed out.",
    likelyCause: "Transport loss or long stalls are preventing packets from round-tripping.",
    fixHint: "Prioritize network/proxy health before changing prediction code."
  },
  player_disconnected: {
    subsystem: "session",
    kind: "symptom",
    confidence: "high",
    rootCauseWeight: 48,
    aiSummary: "A player connection was lost during the session.",
    likelyCause: "Network drop, page unload, or reconnect path failure.",
    fixHint: "Correlate with close codes, heartbeat timeouts, and session reclaim logs."
  },
  server_loop_lag: {
    subsystem: "server",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 94,
    aiSummary: "The server loop is starting ticks late, so everything downstream arrives late too.",
    likelyCause: "Main-thread work or host contention is delaying room updates.",
    fixHint: "Start with server tick workload and host CPU pressure before tuning client prediction."
  },
  server_tick_slow: {
    subsystem: "server",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 95,
    aiSummary: "A server tick is taking longer than the tick budget to finish.",
    likelyCause: "Simulation, replication, or room bookkeeping is too expensive for the current host.",
    fixHint: "Profile the server tick path and inspect expensive room/player iteration."
  },
  session_expired: {
    subsystem: "session",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 74,
    aiSummary: "Reconnect grace expired before the session was resumed.",
    likelyCause: "Reconnect flow took too long or session identifiers were not reused correctly.",
    fixHint: "Inspect reconnect timing, client session id reuse, and grace-window assumptions."
  },
  snapshot_data_invalid: {
    subsystem: "snapshot",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 99,
    aiSummary: "Snapshot encode/decode produced invalid numeric state.",
    likelyCause: "Server payload construction or client decode is emitting non-finite entity values.",
    fixHint: "Inspect the authoritative state builder and shared packet sanitize/decode path first."
  },
  snapshot_delay_high: {
    subsystem: "snapshot",
    kind: "root",
    confidence: "medium",
    rootCauseWeight: 88,
    aiSummary: "Authoritative snapshots are arriving too late for smooth prediction.",
    likelyCause: "Server send cadence, network stalls, or oversized replication is delaying state.",
    fixHint: "Compare snapshot age with server loop lag and packet loss before changing smoothing."
  },
  snapshot_missing_entities: {
    subsystem: "snapshot",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 97,
    aiSummary: "A full snapshot is missing entities that should be present.",
    likelyCause: "Interest selection, replication mode, or snapshot assembly dropped required entities.",
    fixHint: "Audit full snapshot assembly and viewer-interest filtering on the server."
  },
  snapshot_out_of_order: {
    subsystem: "replication",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 68,
    aiSummary: "Snapshot chunks are arriving stale or out of order.",
    likelyCause: "Transport reordering, resend behavior, or chunk assembly is inconsistent.",
    fixHint: "Inspect chunk sequencing, discard rules, and proxy buffering."
  },
  snapshot_resync_requested: {
    subsystem: "replication",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 63,
    aiSummary: "The client had to request a lifecycle resync because replication became unreliable.",
    likelyCause: "Chunk assembly or baseline tracking drifted out of sync.",
    fixHint: "Inspect the last chunk sequence, baseline invalidation, and resync trigger reason."
  },
  teleport_detected: {
    subsystem: "snapshot",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 67,
    aiSummary: "An entity jumped farther than normal movement should allow between snapshots.",
    likelyCause: "Replication skipped intermediate states or state was reset across a transition.",
    fixHint: "Check round/spawn transitions, stale baselines, and movement replication gaps."
  },
  tick_rate_lower_than_expected: {
    subsystem: "server",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 72,
    aiSummary: "Observed server tick cadence is below the configured target rate.",
    likelyCause: "Server loop lag or slow ticks are reducing effective simulation rate.",
    fixHint: "Treat this as a server performance symptom and pair it with loop/work metrics."
  },
  too_many_inputs_replayed: {
    subsystem: "prediction",
    kind: "symptom",
    confidence: "medium",
    rootCauseWeight: 70,
    aiSummary: "The client is replaying too many unacknowledged inputs to stay smooth.",
    likelyCause: "Snapshots/acks are delayed or input send rate is outrunning server acknowledgement.",
    fixHint: "Check pending input growth against snapshot delay and server tick health."
  },
  upgrade_denied: {
    subsystem: "ability",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 83,
    aiSummary: "The server rejected an upgrade request.",
    likelyCause: "Client upgrade UI sent an invalid or no-longer-allowed class choice.",
    fixHint: "Validate pending upgrade state on the client against server eligibility before send."
  },
  value_clamped: {
    subsystem: "state",
    kind: "root",
    confidence: "high",
    rootCauseWeight: 76,
    aiSummary: "The server normalized an out-of-range gameplay value instead of accepting it as-is.",
    likelyCause: "Client or upstream logic is producing values outside valid gameplay bounds.",
    fixHint: "Find the first writer of the clamped value and align client-side limits with the server."
  }
});

const WORLD_RENDER = Object.freeze({
  gridSize: 64,
  cameraFollow: 0.14
});

const SPECTATOR_CAMERA = Object.freeze({
  defaultZoom: 0.5,
  maxZoom: 2.4,
  zoomKeyFactor: 1.14,
  wheelZoomStrength: 0.0016,
  minMoveSpeed: 650,
  maxMoveSpeed: 3400,
  fastMoveMultiplier: 1.85
});

const players = new Map();
const bullets = new Map();
const shapes = new Map();
const predictedProjectiles = new Map();
const combatEffects = [];
const killFeedEntries = [];
const shapeParticles = [];
const shapeSpriteCache = new Map();
const NEUTRAL_OBJECTIVE_COLORS = Object.freeze({
  fill: "rgba(0, 0, 0, 0.12)",
  ring: "rgba(0, 0, 0, 0.88)",
  core: "rgba(0, 0, 0, 0.72)",
  label: "#111827",
  coreLabel: "#f8fafc",
  minimapFill: "rgba(0, 0, 0, 0.16)",
  minimapStroke: "#111111"
});
let minimapBackgroundCache = {
  key: "",
  canvas: null
};
const fallbackRemoteMarkerCache = new Map();
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
let localPendingUpgrades = [];
let localBasicSpecializationPending = false;
let localBasicSpecializationChoice = null;
let localTankClassId = "basic";
let localStats = createEmptyAllocatedStats();
let upgradeMenuOpen = false;
let basicSpecializationMenuOpen = false;
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
let serverWallTimeOffset = 0;
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
let lastInputDispatchAt = 0;
let lastLocalInputChangedAt = 0;
let lastAimInputChangedAt = 0;
let lastDispatchedInputState = null;
let nextReliableMessageId = 1;
let roomBrowserRefreshInFlight = false;
let audioContext = null;
let renderFailure = null;
let renderLoopStopped = false;
let lastScoreboardRenderKey = "";
let lastResultsRenderKey = "";
let lastDiagnosticBannerText = "";
let lastRoomBrowserRenderKey = "";
let lastTimedUiRefreshAt = 0;
let latestDebugInfo = null;
let latestAiDebugReport = null;
let lastSnapshotDebugAnalysisAt = 0;
const assetState = {
  manifest: null,
  images: new Map(),
  failedImages: new Set(),
  loadingImages: new Map()
};
const debugMonitor = {
  events: new Map(),
  pendingPings: new Map(),
  packetWindow: [],
  latencySamples: [],
  correctionEvents: [],
  lastServerTickSample: null,
  serverTickRateSamples: [],
  estimatedServerTickRate: GAME_CONFIG.serverTickRate,
  lastKnownPlayers: new Map(),
  knownBullets: new Map(),
  lastVolleyByOwner: new Map(),
  pendingPredictedShots: new Map()
};
const basicSpecializationButtonRects = [];
const BASIC_SPECIALIZATION_MENU_OPTIONS = Object.freeze([
  Object.freeze({
    specializationId: BASIC_CLASS_SPECIALIZATIONS.EXTRA_HP,
    title: "+25 HP",
    accent: "#5dd39e",
    description: `Permanent +${GAME_CONFIG.basicSpecialization.extraHpBonus} max HP`
  }),
  Object.freeze({
    specializationId: BASIC_CLASS_SPECIALIZATIONS.SHIELD_BUBBLE,
    title: "Shield",
    accent: "#67b7ff",
    description: `Block all damage for ${Math.round(GAME_CONFIG.basicSpecialization.shieldDurationMs / 1000)}s`
  }),
  Object.freeze({
    specializationId: BASIC_CLASS_SPECIALIZATIONS.GRENADE,
    title: "Grenade",
    accent: "#ff9f43",
    description: `Blast nearby Basics for ${Math.round(GAME_CONFIG.basicSpecialization.grenadeBasicDamageRatio * 100)}% HP`
  })
]);

const currentUrl = new URL(window.location.href);
const initialRoomFromUrl = currentUrl.searchParams.get("room");
const urlDebugMode = currentUrl.searchParams.get("debug");
const urlPerfMode = currentUrl.searchParams.get("perf");
const SNAPSHOT_DEBUG_SAMPLE_INTERVAL = 10;
const CLIENT_PERF_PROFILE_LOG_INTERVAL_MS = 5_000;
let debugUiEnabled =
  urlDebugMode === "1"
    ? true
    : urlDebugMode === "0"
      ? false
      : localStorage.getItem(STORAGE_KEYS.debugMode) === "1";
let performanceProfilingEnabled =
  urlPerfMode === "1"
    ? true
    : urlPerfMode === "0"
      ? false
      : localStorage.getItem(STORAGE_KEYS.perfMode) === "1";
if (urlDebugMode === "1" || urlDebugMode === "0") {
  localStorage.setItem(STORAGE_KEYS.debugMode, debugUiEnabled ? "1" : "0");
}
if (urlPerfMode === "1" || urlPerfMode === "0") {
  localStorage.setItem(STORAGE_KEYS.perfMode, performanceProfilingEnabled ? "1" : "0");
}

const clientPerfProfileStats = new Map();
let clientPerfProfileLastFlushAt = performance.now();

function maybeFlushClientPerfProfile(now = performance.now()) {
  if (
    !performanceProfilingEnabled ||
    clientPerfProfileStats.size === 0 ||
    now - clientPerfProfileLastFlushAt < CLIENT_PERF_PROFILE_LOG_INTERVAL_MS
  ) {
    return;
  }

  const summary = Array.from(clientPerfProfileStats.entries())
    .sort((left, right) => right[1].totalMs - left[1].totalMs)
    .map(([name, stats]) => {
      const averageMs = stats.count > 0 ? stats.totalMs / stats.count : 0;
      return `${name} avg=${averageMs.toFixed(2)}ms max=${stats.maxMs.toFixed(2)}ms count=${stats.count}`;
    })
    .join(" | ");

  console.log(`[perf][client] ${summary}`);
  clientPerfProfileStats.clear();
  clientPerfProfileLastFlushAt = now;
}

function recordClientPerfProfile(name, durationMs) {
  if (!performanceProfilingEnabled || !Number.isFinite(durationMs)) {
    return;
  }

  const existing = clientPerfProfileStats.get(name) ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0
  };
  existing.count += 1;
  existing.totalMs += durationMs;
  existing.maxMs = Math.max(existing.maxMs, durationMs);
  clientPerfProfileStats.set(name, existing);
  maybeFlushClientPerfProfile();
}

function startClientPerfProfile(name) {
  if (!performanceProfilingEnabled) {
    return null;
  }

  return {
    name,
    startedAt: performance.now()
  };
}

function endClientPerfProfile(mark) {
  if (!mark) {
    return;
  }

  recordClientPerfProfile(mark.name, performance.now() - mark.startedAt);
}

function shouldCollectDebugDiagnostics() {
  return debugUiEnabled;
}

nameInput.value = localStorage.getItem(STORAGE_KEYS.name) ?? nameInput.value;
roomInput.value = initialRoomFromUrl ?? localStorage.getItem(STORAGE_KEYS.room) ?? roomInput.value;
spectateInput.checked = localStorage.getItem(STORAGE_KEYS.spectate) === "1";
profileLabelElement.textContent = profileId.slice(0, 8);

populateLobbySelects();
populateClassTabs();
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

function syncSessionUrl(options = {}) {
  const url = new URL(window.location.href);
  const roomValue = options.room ?? roomInput?.value ?? currentRoomId ?? "default";
  url.searchParams.set("room", roomValue || "default");

  if (debugUiEnabled) {
    url.searchParams.set("debug", "1");
  } else {
    url.searchParams.delete("debug");
  }

  window.history.replaceState({}, "", url);
}

function setDebugUiEnabled(enabled, options = {}) {
  const { persist = true, updateUrl = true } = options;
  debugUiEnabled = Boolean(enabled);
  latestAiDebugReport = null;
  lastSnapshotDebugAnalysisAt = 0;

  if (persist) {
    localStorage.setItem(STORAGE_KEYS.debugMode, debugUiEnabled ? "1" : "0");
  }

  if (updateUrl) {
    syncSessionUrl();
  }

  updateLocalDevBadge();
  syncDiagnosticBannerPresentation();
  updateDiagnosticBanner();
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

function syncDiagnosticBannerPresentation() {
  if (!diagnosticBannerElement) {
    return false;
  }

  const useDebugCompactLayout = debugUiEnabled && hasPlayableSession();
  diagnosticBannerElement.classList.toggle("diagnostic-banner--debug", useDebugCompactLayout);
  return useDebugCompactLayout;
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

function downloadTextFile(filename, text) {
  if (typeof document === "undefined") {
    return false;
  }

  const blob = new Blob([String(text ?? "")], { type: "application/json;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 250);
  return true;
}

async function copyAiDebugReportToClipboard() {
  const report = latestAiDebugReport ?? buildAiDebugReport(Date.now());
  const reportText = JSON.stringify(report, null, 2);

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(reportText);
      setStatus(`Copied AI debug report to clipboard (${DEBUG_AI_REPORT_HOTKEY}).`);
      return true;
    }
  } catch (error) {
    // Fall through to download/console fallback.
  }

  window.__MULTITANK_DEBUG_REPORT__ = report;
  window.__MULTITANK_COPY_DEBUG_REPORT__ = () => copyAiDebugReportToClipboard();
  console.info("Multitank AI debug report", report);

  if (downloadTextFile(`multitank-debug-report-${Date.now()}.json`, reportText)) {
    setStatus(`Clipboard unavailable. Downloaded AI debug report instead (${DEBUG_AI_REPORT_HOTKEY}).`);
    return true;
  }

  setStatus("Clipboard unavailable. Read window.__MULTITANK_DEBUG_REPORT__ in the console.");
  return false;
}

window.__MULTITANK_COPY_DEBUG_REPORT__ = () => copyAiDebugReportToClipboard();

function getDebugSeverityWeight(severity) {
  switch (severity) {
    case "error":
      return 3;
    case "warn":
      return 2;
    default:
      return 1;
  }
}

function trimDebugMessage(message, maxLength = 140) {
  const normalized = String(message ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "Unknown debug issue";
  }

  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...` : normalized;
}

function pushPacketWindowSample(value) {
  debugMonitor.packetWindow.push(value ? 1 : 0);
  while (debugMonitor.packetWindow.length > DEBUG_MONITOR.packetWindowSize) {
    debugMonitor.packetWindow.shift();
  }
}

function prunePendingPingSamples(now = Date.now()) {
  for (const [sentAt] of debugMonitor.pendingPings.entries()) {
    if (now - sentAt < DEBUG_MONITOR.pingTimeoutMs) {
      continue;
    }

    debugMonitor.pendingPings.delete(sentAt);
    pushPacketWindowSample(0);
  }
}

function notePingSent(sentAt = Date.now()) {
  prunePendingPingSamples(sentAt);
  debugMonitor.pendingPings.set(sentAt, sentAt);
}

function notePong(sentAt, now = Date.now()) {
  prunePendingPingSamples(now);
  const normalizedSentAt = Number(sentAt);
  if (!Number.isFinite(normalizedSentAt) || !debugMonitor.pendingPings.delete(normalizedSentAt)) {
    return null;
  }
  pushPacketWindowSample(1);

  const rtt = Math.max(0, now - normalizedSentAt);
  debugMonitor.latencySamples.push({
    at: now,
    rtt
  });

  debugMonitor.latencySamples = debugMonitor.latencySamples.filter(
    (sample) => now - Number(sample?.at ?? 0) <= DEBUG_MONITOR.latencySampleWindowMs
  );
  while (debugMonitor.latencySamples.length > DEBUG_MONITOR.latencySampleSize) {
    debugMonitor.latencySamples.shift();
  }

  return rtt;
}

function getMedianLatencyValue(values) {
  const sorted = (values ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) * 0.5;
  }

  return sorted[middle];
}

function getLatencyJitterMs() {
  const now = Date.now();
  debugMonitor.latencySamples = debugMonitor.latencySamples.filter(
    (sample) => now - Number(sample?.at ?? 0) <= DEBUG_MONITOR.latencySampleWindowMs
  );
  const recentSamples = debugMonitor.latencySamples.slice(-8).map((sample) => Number(sample?.rtt ?? 0));
  if (recentSamples.length < 4) {
    return 0;
  }

  const medianRtt = getMedianLatencyValue(recentSamples);
  const deviations = recentSamples.map((rtt) => Math.abs(rtt - medianRtt));
  return getMedianLatencyValue(deviations);
}

function getPacketLossPercent(now = Date.now()) {
  prunePendingPingSamples(now);
  if (debugMonitor.packetWindow.length === 0) {
    return 0;
  }

  const lostCount = debugMonitor.packetWindow.filter((value) => value === 0).length;
  return (lostCount / debugMonitor.packetWindow.length) * 100;
}

function pruneDebugEvents(now = Date.now()) {
  for (const [key, event] of debugMonitor.events.entries()) {
    if (now - Number(event.lastAt ?? 0) > Number(event.ttlMs ?? DEBUG_MONITOR.eventTtlMs)) {
      debugMonitor.events.delete(key);
    }
  }
}

function recordDebugEvent(code, message, options = {}) {
  if (!shouldCollectDebugDiagnostics()) {
    return;
  }

  const now = Number(options.now ?? Date.now()) || Date.now();
  const key = String(options.key ?? code).trim() || String(code ?? "debug_event");
  const severity =
    options.severity === "error" || options.severity === "info" || options.severity === "warn"
      ? options.severity
      : "warn";
  const ttlMs = clamp(
    Math.round(Number(options.ttlMs ?? DEBUG_MONITOR.eventTtlMs) || DEBUG_MONITOR.eventTtlMs),
    1000,
    60_000
  );
  const existing = debugMonitor.events.get(key);
  const nextCount =
    existing && now - Number(existing.lastAt ?? 0) <= DEBUG_MONITOR.mergeWindowMs
      ? Math.max(1, Number(existing.count ?? 1)) + 1
      : Math.max(1, Number(existing?.count ?? 0) || 0, Number(options.count ?? 1) || 1);

  debugMonitor.events.set(key, {
    key,
    code: String(code ?? "debug_event").trim() || "debug_event",
    message: trimDebugMessage(message),
    severity,
    source: String(options.source ?? "client"),
    scope: typeof options.scope === "string" && options.scope ? options.scope : null,
    count: nextCount,
    firstAt: existing?.firstAt ?? now,
    lastAt: now,
    ttlMs
  });
  pruneDebugEvents(now);
}

function syncServerDebugSnapshot(debugPayload, now = Date.now()) {
  latestDebugInfo = debugPayload ?? latestDebugInfo;
  if (!shouldCollectDebugDiagnostics() || !debugPayload || !Array.isArray(debugPayload.signals)) {
    return;
  }

  for (const signal of debugPayload.signals) {
    const key = `server:${signal.scope ?? "room"}:${signal.code ?? "unknown"}`;
    debugMonitor.events.set(key, {
      key,
      code: String(signal.code ?? "unknown"),
      message: trimDebugMessage(signal.message),
      severity:
        signal.severity === "error" || signal.severity === "info" || signal.severity === "warn"
          ? signal.severity
          : "warn",
      source: "server",
      scope: typeof signal.scope === "string" && signal.scope ? signal.scope : null,
      count: Math.max(1, Number(signal.count ?? 1) || 1),
      firstAt: Number(signal.firstAt ?? now) || now,
      lastAt: Number(signal.lastAt ?? now) || now,
      ttlMs: clamp(Math.round(Number(signal.ttlMs ?? DEBUG_MONITOR.eventTtlMs) || DEBUG_MONITOR.eventTtlMs), 1000, 60_000)
    });
  }

  pruneDebugEvents(now);
}

function noteServerTickSample(
  simulationTick,
  frameAt = performance.now(),
  expectedTickRate = GAME_CONFIG.serverTickRate
) {
  if (!shouldCollectDebugDiagnostics()) {
    return;
  }

  const tickNumber = Number(simulationTick);
  if (!Number.isFinite(tickNumber) || tickNumber <= 0) {
    return;
  }

  const normalizedExpectedTickRate = Number(expectedTickRate);
  if (Number.isFinite(normalizedExpectedTickRate) && normalizedExpectedTickRate > 0) {
    debugMonitor.estimatedServerTickRate = normalizedExpectedTickRate;
  }

  const previous = debugMonitor.lastServerTickSample;
  if (previous && tickNumber > previous.tick && frameAt > previous.at) {
    const estimatedRate = (tickNumber - previous.tick) / ((frameAt - previous.at) / 1000);
    if (
      Number.isFinite(estimatedRate) &&
      estimatedRate > 0 &&
      (!Number.isFinite(normalizedExpectedTickRate) || Math.abs(estimatedRate - normalizedExpectedTickRate) <= normalizedExpectedTickRate * 0.35)
    ) {
      debugMonitor.serverTickRateSamples.push(estimatedRate);
      while (debugMonitor.serverTickRateSamples.length > 12) {
        debugMonitor.serverTickRateSamples.shift();
      }

      const total = debugMonitor.serverTickRateSamples.reduce((sum, sample) => sum + sample, 0);
      debugMonitor.estimatedServerTickRate =
        debugMonitor.serverTickRateSamples.length > 0
          ? total / debugMonitor.serverTickRateSamples.length
          : normalizedExpectedTickRate > 0
            ? normalizedExpectedTickRate
            : GAME_CONFIG.serverTickRate;
    }
  }

  debugMonitor.lastServerTickSample = {
    tick: tickNumber,
    at: frameAt
  };
}

function getLocalPredictionDelta() {
  const localPlayer = getLocalPlayer();
  const visualState = ensureLocalVisualState(localPlayer);
  if (!localPlayer || !visualState) {
    return 0;
  }

  return Math.hypot((visualState.x ?? localPlayer.x) - localPlayer.x, (visualState.y ?? localPlayer.y) - localPlayer.y);
}

function getExpectedPredictionSlackDistance(now = Date.now()) {
  const oneWayLatencyMs = Math.max(
    Math.max(0, Number(latestLatencyMs) || 0) * 0.5,
    getRemoteInterpolationBackTimeMs()
  );
  const jitterAllowanceMs = Math.min(LOCAL_PREDICTION.stallSoftLimitMs, getLatencyJitterMs()) * 0.7;
  const snapshotAllowanceMs = Math.max(
    0,
    Math.min(
      LOCAL_PREDICTION.stallSoftLimitMs,
      getStatePacketAgeMs(now) - Math.round(1000 / GAME_CONFIG.snapshotRate)
    )
  ) * 0.35;
  const effectiveDelayMs = Math.max(
    getLocalInputDispatchMinIntervalMs(),
    oneWayLatencyMs + jitterAllowanceMs + snapshotAllowanceMs
  );

  return getEffectiveLocalMoveSpeed() * (effectiveDelayMs / 1000);
}

function getActionablePredictionErrorDistance(now = Date.now()) {
  return Math.max(
    DEBUG_MONITOR.correctionIssueDistance,
    Math.round(getExpectedPredictionSlackDistance(now) + Math.max(8, getLocalBodyRadius() * 0.4))
  );
}

function getActionableHighJitterThresholdMs() {
  return Math.max(
    DEBUG_MONITOR.highJitterMs + 4,
    Math.round(Math.max(0, Number(latestLatencyMs) || 0) * 0.28)
  );
}

function noteReconciliation(distanceError, options = {}) {
  if (!shouldCollectDebugDiagnostics()) {
    return;
  }

  const now = Date.now();
  const actionableDistance = getActionablePredictionErrorDistance(now);
  const severeDistance = Math.max(LOCAL_PREDICTION.snapGap, actionableDistance * 2);
  const largeCorrectionDistance = Math.max(LOCAL_PREDICTION.maxSmoothGap, actionableDistance * 1.6);
  if (distanceError < actionableDistance) {
    return;
  }

  debugMonitor.correctionEvents.push({
    at: now,
    distanceError
  });
  debugMonitor.correctionEvents = debugMonitor.correctionEvents.filter(
    (event) => now - event.at <= DEBUG_MONITOR.correctionWindowMs
  );

  recordDebugEvent("desync_detected", `Client/server state diverged by ${Math.round(distanceError)} units`, {
    severity: distanceError >= severeDistance ? "error" : "warn",
    ttlMs: 8_000,
    key: "desync_detected"
  });
  recordDebugEvent("movement_corrected_by_server", `Server reconciliation corrected ${Math.round(distanceError)} units`, {
    severity: distanceError >= severeDistance ? "error" : "warn",
    ttlMs: 8_000,
    key: "movement_corrected_by_server"
  });

  if (distanceError >= largeCorrectionDistance) {
    recordDebugEvent(
      "large_reconciliation_correction",
      `Large reconciliation correction detected (${Math.round(distanceError)} units)`,
      {
        severity: distanceError >= severeDistance ? "error" : "warn",
        ttlMs: 8_000,
        key: "large_reconciliation_correction"
      }
    );
  }

  if (
    Math.max(0, Number(options.pendingReplayCount ?? pendingInputs.length) || 0) >= DEBUG_MONITOR.replayInputWarningCount &&
    distanceError >= actionableDistance
  ) {
    recordDebugEvent(
      "large_correction_after_replay",
      `Large correction happened while replaying ${Math.max(0, Number(options.pendingReplayCount ?? pendingInputs.length) || 0)} inputs`,
      {
        severity: "warn",
        ttlMs: 8_000,
        key: "large_correction_after_replay"
      }
    );
  }

  if (debugMonitor.correctionEvents.length >= DEBUG_MONITOR.frequentCorrectionThreshold) {
    recordDebugEvent(
      "frequent_reconciliation",
      `Frequent reconciliation detected (${debugMonitor.correctionEvents.length} corrections in ${Math.round(DEBUG_MONITOR.correctionWindowMs / 1000)}s)`,
      {
        severity: "warn",
        ttlMs: 8_000,
        key: "frequent_reconciliation"
      }
    );
  }
}

function getClassReloadMs(classId) {
  return CLASS_TREE[classId]?.reloadMs ?? GAME_CONFIG.tank.shootCooldownMs;
}

function noteBulletVolley(ownerState, now = Date.now()) {
  if (!shouldCollectDebugDiagnostics()) {
    return;
  }

  const ownerId = ownerState?.id;
  if (!ownerId) {
    return;
  }

  const previousVolley = debugMonitor.lastVolleyByOwner.get(ownerId);
  const reloadMs = getClassReloadMs(ownerState.tankClassId ?? ownerState.classId);
  if (!previousVolley || now - previousVolley.at > DEBUG_MONITOR.bulletVolleyWindowMs) {
    if (previousVolley && now - previousVolley.at < reloadMs * DEBUG_MONITOR.fireRateSlack) {
      recordDebugEvent(
        "fire_rate_too_high",
        `${ownerState.name ?? ownerId} fired again after ${Math.round(now - previousVolley.at)}ms`,
        {
          severity: "warn",
          ttlMs: 8_000,
          key: `fire_rate_too_high:${ownerId}`
        }
      );
    }

    debugMonitor.lastVolleyByOwner.set(ownerId, { at: now });
  }
}

function pruneSnapshotDebugState(now = Date.now()) {
  for (const [playerId, state] of debugMonitor.lastKnownPlayers.entries()) {
    if (now - Number(state.at ?? 0) > 30_000) {
      debugMonitor.lastKnownPlayers.delete(playerId);
    }
  }

  for (const [bulletId, state] of debugMonitor.knownBullets.entries()) {
    if (now - Number(state.seenAt ?? 0) > DEBUG_MONITOR.bulletTrackTtlMs) {
      debugMonitor.knownBullets.delete(bulletId);
    }
  }

  for (const [ownerId, state] of debugMonitor.lastVolleyByOwner.entries()) {
    if (now - Number(state.at ?? 0) > 10_000) {
      debugMonitor.lastVolleyByOwner.delete(ownerId);
    }
  }
}

function noteSnapshotDebugState(payload, now = Date.now()) {
  if (!shouldCollectDebugDiagnostics()) {
    return;
  }

  if (now - lastSnapshotDebugAnalysisAt < DEBUG_MONITOR.snapshotAnalysisIntervalMs) {
    return;
  }
  lastSnapshotDebugAnalysisAt = now;

  const playersInSnapshot = Array.isArray(payload?.players) ? payload.players : [];
  const bulletsInSnapshot = Array.isArray(payload?.bullets) ? payload.bullets : [];
  const playersById = new Map();
  const snapshotPhase = payload?.match?.phase ?? latestMatch?.phase ?? "";
  const snapshotRoundNumber = Number(payload?.match?.roundNumber ?? latestMatch?.roundNumber ?? 0) || 0;
  const snapshotRoundKey = `${snapshotPhase}:${snapshotRoundNumber}`;

  for (const player of playersInSnapshot) {
    if (player?.id) {
      playersById.set(player.id, player);
    }
  }

  if (
    payload?.replication?.mode === "full" &&
    payload?.you?.playerId &&
    !payload.you.isSpectator &&
    !playersById.has(payload.you.playerId)
  ) {
    recordDebugEvent("snapshot_missing_entities", "Full snapshot is missing the local player entity", {
      severity: "error",
      ttlMs: 10_000,
      key: "snapshot_missing_local_player"
    });
  }

  for (const player of playersInSnapshot) {
    if (!player?.id) {
      continue;
    }

    if (
      !Number.isFinite(player.x) ||
      !Number.isFinite(player.y) ||
      !Number.isFinite(player.angle) ||
      !Number.isFinite(player.turretAngle)
    ) {
      recordDebugEvent("snapshot_data_invalid", `Snapshot contains invalid numeric state for ${player.name ?? player.id}`, {
        severity: "error",
        ttlMs: 10_000,
        key: `snapshot_data_invalid:${player.id}`
      });
    }

    if (Number(player.hp) < 0 || Number(player.hp) > Math.max(1, Number(player.maxHp ?? GAME_CONFIG.tank.hitPoints))) {
      recordDebugEvent("health_out_of_range", `${player.name ?? player.id} has health outside valid bounds`, {
        severity: "error",
        ttlMs: 10_000,
        key: `health_out_of_range:${player.id}`
      });
    }

    const previousState = debugMonitor.lastKnownPlayers.get(player.id);
    if (previousState) {
      const elapsedMs = now - Number(previousState.at ?? now);
      const sameRound = previousState.roundKey === snapshotRoundKey;
      const sameTeam = previousState.teamId === player.teamId;
      const canCompareMovement =
        elapsedMs > 0 &&
        elapsedMs <= DEBUG_MONITOR.movementSampleWindowMs &&
        sameRound &&
        sameTeam;
      const movedDistance = Math.hypot(player.x - previousState.x, player.y - previousState.y);
      const crossedSpawnBoundary = canCompareMovement && crossedOwnSpawnBoundary(player.teamId, previousState.x, player.x);
      const recentlyDead = previousState.lastSeenDeadAt != null && (now - previousState.lastSeenDeadAt < 2_000);
      if (canCompareMovement && previousState.alive && player.alive && !recentlyDead) {
        const speed = movedDistance / (elapsedMs / 1000);
        if (!crossedSpawnBoundary && speed > GAME_CONFIG.tank.speed * DEBUG_MONITOR.entitySpeedSlack) {
          recordDebugEvent(
            "movement_speed_too_high",
            `${player.name ?? player.id} moved at ${Math.round(speed)} units/s`,
            {
              severity: "warn",
              ttlMs: 8_000,
              key: `movement_speed_too_high:${player.id}`
            }
          );
        }

        if (!crossedSpawnBoundary && movedDistance > DEBUG_MONITOR.teleportDistance) {
          recordDebugEvent("teleport_detected", `${player.name ?? player.id} jumped ${Math.round(movedDistance)} units`, {
            severity: "warn",
            ttlMs: 8_000,
            key: `teleport_detected:${player.id}`
          });
        }
      }

      if (canCompareMovement && !crossedSpawnBoundary && !player.alive && movedDistance > 8) {
        recordDebugEvent("dead_player_still_acting", `${player.name ?? player.id} moved after death`, {
          severity: "error",
          ttlMs: 10_000,
          key: `dead_player_still_moving:${player.id}`
        });
      }
    }

    const prevLastSeenDeadAt = previousState?.lastSeenDeadAt ?? null;
    debugMonitor.lastKnownPlayers.set(player.id, {
      id: player.id,
      name: player.name,
      x: Number(player.x) || 0,
      y: Number(player.y) || 0,
      alive: Boolean(player.alive),
      teamId: player.teamId,
      classId: player.classId,
      tankClassId: player.tankClassId ?? player.classId,
      roundKey: snapshotRoundKey,
      at: now,
      lastSeenDeadAt: !player.alive ? now : prevLastSeenDeadAt
    });
  }

  for (const bullet of bulletsInSnapshot) {
    if (!bullet?.id) {
      continue;
    }

    if (!bullet.ownerId) {
      recordDebugEvent("bullet_missing_owner", `Projectile ${bullet.id} has no owner`, {
        severity: "error",
        ttlMs: 10_000,
        key: `bullet_missing_owner:${bullet.id}`
      });
    }

    if (
      !Number.isFinite(bullet.x) ||
      !Number.isFinite(bullet.y) ||
      !Number.isFinite(bullet.angle) ||
      !Number.isFinite(bullet.speed)
    ) {
      recordDebugEvent("snapshot_data_invalid", `Projectile ${bullet.id} has invalid snapshot data`, {
        severity: "error",
        ttlMs: 10_000,
        key: `invalid_projectile:${bullet.id}`
      });
    }

    const ownerState = playersById.get(bullet.ownerId) ?? debugMonitor.lastKnownPlayers.get(bullet.ownerId) ?? null;
    if (ownerState && ownerState.alive === false) {
      recordDebugEvent("dead_player_still_acting", `${ownerState.name ?? bullet.ownerId} still owns an active projectile while dead`, {
        severity: "error",
        ttlMs: 10_000,
        key: `dead_player_projectile:${bullet.ownerId}`
      });
    }

    const knownBullet = debugMonitor.knownBullets.get(bullet.id);
    if (!knownBullet) {
      noteBulletVolley(ownerState, now);
      debugMonitor.knownBullets.set(bullet.id, {
        ownerId: bullet.ownerId,
        seenAt: now
      });
    } else {
      knownBullet.seenAt = now;
    }
  }

  pruneSnapshotDebugState(now);
}

function buildPredictedProjectileId(inputSeq, barrelIndex = 0) {
  const resolvedSeq = Math.max(0, Number(inputSeq) || 0);
  const resolvedBarrelIndex = Math.max(0, Number(barrelIndex) || 0);
  return `predicted:${resolvedSeq}:${resolvedBarrelIndex}`;
}

function notePredictedShotPending(projectileId, inputFrame, now = Date.now(), barrelIndex = 0) {
  if (!projectileId) {
    return;
  }

  debugMonitor.pendingPredictedShots.set(projectileId, {
    seq: Number(inputFrame?.seq ?? 0) || 0,
    clientSentAt: Number(inputFrame?.clientSentAt ?? 0) || 0,
    barrelIndex: Math.max(0, Number(barrelIndex) || 0),
    createdAt: now
  });
}

function notePredictedShotMatched(projectileId) {
  if (!projectileId) {
    return;
  }

  debugMonitor.pendingPredictedShots.delete(projectileId);
}

function notePredictedShotConfirmedBySeq(inputSeq) {
  const resolvedSeq = Math.max(0, Number(inputSeq) || 0);
  if (resolvedSeq <= 0) {
    return;
  }

  for (const [projectileId, pendingShot] of debugMonitor.pendingPredictedShots.entries()) {
    if ((Number(pendingShot?.seq ?? 0) || 0) === resolvedSeq) {
      debugMonitor.pendingPredictedShots.delete(projectileId);
    }
  }
}

function getPredictedShotTimeoutMs(now = Date.now()) {
  const snapshotGapMs = lastSnapshotAt ? Math.max(0, performance.now() - lastSnapshotAt) : 0;
  const networkSlackMs = Math.max(0, Number(latestLatencyMs) || 0) + Math.max(0, getLatencyJitterMs());
  const serverLagSlackMs = Math.max(0, Number(latestDebugInfo?.serverLoopLagMs ?? 0) || 0);
  // Raise the server-lag slack cap from 300 ms to 1 500 ms and the overall ceiling
  // from 2 000 ms to 4 000 ms so that legitimate shots aren't falsely flagged as
  // fire_rejected / cooldown_desync when the server loop is running behind.
  return clamp(
    Math.round(DEBUG_MONITOR.predictedShotTimeoutMs + networkSlackMs + Math.min(400, snapshotGapMs) + Math.min(1_500, serverLagSlackMs)),
    DEBUG_MONITOR.predictedShotTimeoutMs,
    4_000
  );
}

function prunePredictedShotExpectations(now = Date.now()) {
  const timeoutMs = getPredictedShotTimeoutMs(now);
  for (const [projectileId, pendingShot] of debugMonitor.pendingPredictedShots.entries()) {
    if (now - Number(pendingShot.createdAt ?? 0) < timeoutMs) {
      continue;
    }

    recordDebugEvent(
      "fire_rejected",
      `Predicted shot ${pendingShot.seq > 0 ? `seq ${pendingShot.seq}` : projectileId} never received an authoritative projectile`,
      {
        severity: "warn",
        ttlMs: 8_000,
        key: `fire_rejected:${pendingShot.seq || projectileId}`
      }
    );
    recordDebugEvent(
      "cooldown_desync",
      `Local fire prediction drifted from the server for shot ${pendingShot.seq > 0 ? pendingShot.seq : projectileId}`,
      {
        severity: "warn",
        ttlMs: 8_000,
        key: `cooldown_desync:${pendingShot.seq || projectileId}`
      }
    );
    debugMonitor.pendingPredictedShots.delete(projectileId);
  }
}

function buildDynamicDebugIssue(code, message, severity, now = Date.now(), options = {}) {
  return {
    key: String(options.key ?? code),
    code,
    message: trimDebugMessage(message),
    severity,
    source: options.source ?? "dynamic",
    scope: typeof options.scope === "string" && options.scope ? options.scope : null,
    count: Math.max(1, Number(options.count ?? 1) || 1),
    firstAt: now,
    lastAt: now,
    ttlMs: Math.max(1000, Number(options.ttlMs ?? DEBUG_MONITOR.eventTtlMs) || DEBUG_MONITOR.eventTtlMs)
  };
}

function getDynamicDebugIssues(now = Date.now()) {
  prunePendingPingSamples(now);
  prunePredictedShotExpectations(now);

  const issues = [];
  const jitterMs = getLatencyJitterMs();
  const actionableJitterThresholdMs = getActionableHighJitterThresholdMs();
  const packetLossPercent = getPacketLossPercent(now);
  const snapshotDelayMs = lastSnapshotAt ? Math.round(performance.now() - lastSnapshotAt) : 0;
  const estimatedTickRate = Number(debugMonitor.estimatedServerTickRate) || GAME_CONFIG.serverTickRate;
  const serverLoopLagMs = Math.max(0, Number(latestDebugInfo?.serverLoopLagMs ?? 0) || 0);
  const serverTickWorkMs = Math.max(0, Number(latestDebugInfo?.tickDurationMs ?? 0) || 0);
  const localPredictionDelta = getLocalPredictionDelta();
  const tickBudgetMs = 1000 / GAME_CONFIG.serverTickRate;
  const livePredictionIssueDistance = Math.max(
    LOCAL_PREDICTION.maxSmoothGap,
    getActionablePredictionErrorDistance(now) * 2
  );
  const severeLivePredictionDistance = Math.max(LOCAL_PREDICTION.snapGap, livePredictionIssueDistance * 1.35);

  if (latestLatencyMs >= DEBUG_MONITOR.highPingMs) {
    issues.push(buildDynamicDebugIssue("high_ping", `Ping is high at ${Math.round(latestLatencyMs)}ms`, "warn", now));
  }

  if (debugMonitor.latencySamples.length >= 6 && jitterMs >= actionableJitterThresholdMs) {
    issues.push(buildDynamicDebugIssue("high_jitter", `Jitter is high at ${Math.round(jitterMs)}ms`, "warn", now));
  }

  if (packetLossPercent >= DEBUG_MONITOR.highPacketLossPercent) {
    issues.push(
      buildDynamicDebugIssue(
        "packet_loss_high",
        `Packet loss is ${packetLossPercent.toFixed(0)}% over the recent ping window`,
        packetLossPercent >= 25 ? "error" : "warn",
        now
      )
    );
  }

  if (snapshotDelayMs >= DEBUG_MONITOR.snapshotDelayWarningMs) {
    issues.push(
      buildDynamicDebugIssue(
        "snapshot_delay_high",
        `Snapshot delay is ${snapshotDelayMs}ms`,
        snapshotDelayMs >= LOCAL_PREDICTION.stallHardLimitMs ? "error" : "warn",
        now
      )
    );
  }

  if (pendingInputs.length >= DEBUG_MONITOR.replayInputWarningCount) {
    issues.push(
      buildDynamicDebugIssue(
        "too_many_inputs_replayed",
        `Prediction is replaying ${pendingInputs.length} pending inputs`,
        pendingInputs.length >= DEBUG_MONITOR.replayInputWarningCount * 2 ? "error" : "warn",
        now
      )
    );
  }

  if (estimatedTickRate < GAME_CONFIG.serverTickRate * DEBUG_MONITOR.tickRateLowRatio) {
    issues.push(
      buildDynamicDebugIssue(
        "tick_rate_lower_than_expected",
        `Estimated server tick rate dropped to ${estimatedTickRate.toFixed(1)}/s`,
        "warn",
        now
      )
    );
  }

  if (serverLoopLagMs >= tickBudgetMs) {
    issues.push(
      buildDynamicDebugIssue(
        "server_loop_lag",
        `Server loop lag is ${Math.round(serverLoopLagMs)}ms`,
        serverLoopLagMs >= tickBudgetMs * 2 ? "error" : "warn",
        now,
        {
          source: "server"
        }
      )
    );
  }

  if (serverTickWorkMs >= tickBudgetMs) {
    issues.push(
      buildDynamicDebugIssue(
        "server_tick_slow",
        `Server tick work took ${Math.round(serverTickWorkMs)}ms`,
        serverTickWorkMs >= tickBudgetMs * 2 ? "error" : "warn",
        now,
        {
          source: "server"
        }
      )
    );
  }

  if (localPredictionDelta >= livePredictionIssueDistance) {
    issues.push(
      buildDynamicDebugIssue(
        "desync_detected_live",
        `Live client/server position delta is ${Math.round(localPredictionDelta)} units`,
        localPredictionDelta >= severeLivePredictionDistance ? "error" : "warn",
        now
      )
    );
  }

  for (const entry of pendingReliableMessages.values()) {
    const ageMs = now - Number(entry?.lastSentAt ?? now);
    if (ageMs < DEBUG_MONITOR.staleReliableActionMs) {
      continue;
    }

    if (entry?.payload?.type === MESSAGE_TYPES.SPECIALIZATION) {
      issues.push(
        buildDynamicDebugIssue(
          "ability_triggered_no_effect",
          `Ability request has been pending for ${Math.round(ageMs)}ms`,
          "warn",
          now
        )
      );
      continue;
    }

    if (entry?.payload?.type === MESSAGE_TYPES.UPGRADE) {
      issues.push(
        buildDynamicDebugIssue(
          "ability_state_mismatch",
          `Upgrade request has not been reflected for ${Math.round(ageMs)}ms`,
          "warn",
          now
        )
      );
    }
  }

  return issues;
}

function getActiveDebugIssues(now = Date.now()) {
  pruneDebugEvents(now);
  const merged = new Map();
  const allIssues = [...debugMonitor.events.values(), ...getDynamicDebugIssues(now)];

  for (const issue of allIssues) {
    const key = String(issue.key ?? issue.code ?? issue.message);
    const existing = merged.get(key);
    if (
      !existing ||
      getDebugSeverityWeight(issue.severity) > getDebugSeverityWeight(existing.severity) ||
      Number(issue.lastAt ?? 0) > Number(existing.lastAt ?? 0)
    ) {
      merged.set(key, issue);
    }
  }

  return Array.from(merged.values()).sort(
    (left, right) =>
      getDebugSeverityWeight(right.severity) - getDebugSeverityWeight(left.severity) ||
      Number(right.lastAt ?? 0) - Number(left.lastAt ?? 0) ||
      String(left.message ?? "").localeCompare(String(right.message ?? ""))
  );
}

function isActionableDebugIssue(issue) {
  return issue?.severity === "warn" || issue?.severity === "error";
}

function buildDebugIssuesSummary(now = Date.now()) {
  if (!shouldCollectDebugDiagnostics()) {
    return "none";
  }

  const issues = buildAiDebugReport(now).issues;
  if (issues.length === 0) {
    return "none";
  }

  return issues
    .slice(0, 3)
    .map((issue) => trimDebugMessage(issue.aiSummary ?? issue.message, 64))
    .join(" | ");
}

function resetDebugMonitorState(options = {}) {
  const { keepEvents = false } = options;
  if (!keepEvents) {
    debugMonitor.events.clear();
  }
  debugMonitor.pendingPings.clear();
  debugMonitor.packetWindow.length = 0;
  debugMonitor.latencySamples.length = 0;
  debugMonitor.correctionEvents.length = 0;
  debugMonitor.lastServerTickSample = null;
  debugMonitor.serverTickRateSamples.length = 0;
  debugMonitor.estimatedServerTickRate = GAME_CONFIG.serverTickRate;
  debugMonitor.lastKnownPlayers.clear();
  debugMonitor.knownBullets.clear();
  debugMonitor.lastVolleyByOwner.clear();
  debugMonitor.pendingPredictedShots.clear();
  latestDebugInfo = null;
  latestAiDebugReport = null;
  lastSnapshotDebugAnalysisAt = 0;
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

function buildScoreboardStatusText(player) {
  const states = [];
  if (player.ready) {
    states.push("ready");
  }
  if (player.afk) {
    states.push("afk");
  }
  if (player.slotReserved) {
    states.push("reserved");
  }
  if (player.queuedForSlot) {
    states.push("queued");
  }
  if (player.connected === false) {
    states.push("dc");
  }
  return states.join(" / ");
}

function createScoreboardEntry(player) {
  const item = document.createElement("li");
  item.className = "scoreboard-entry";
  if (player.id === localPlayerId) {
    item.classList.add("is-local");
  }
  if (player.connected === false) {
    item.classList.add("is-offline");
  }

  const teamAccent = document.createElement("span");
  teamAccent.className = "scoreboard-entry-team";
  teamAccent.style.setProperty("--team-color", getTeamConfig(player.teamId)?.color ?? "#7f8aa5");

  const body = document.createElement("div");
  body.className = "scoreboard-entry-body";

  const name = document.createElement("div");
  name.className = "scoreboard-entry-name";
  name.textContent =
    `${player.name ?? "?"}` +
    `${player.isBot ? " [BOT]" : ""}` +
    `${player.isSpectator ? " [SPEC]" : ""}`;

  const meta = document.createElement("div");
  meta.className = "scoreboard-entry-meta";
  meta.textContent = `${getTeamName(player.teamId)} / ${getLobbyClassName(player.classId)}`;

  const stats = document.createElement("div");
  stats.className = "scoreboard-entry-stats";
  const statusText = buildScoreboardStatusText(player);
  stats.textContent =
    `A ${player.assists ?? 0} / D ${player.deaths ?? 0} | ${player.credits ?? 0}cr` +
    `${statusText ? ` | ${statusText}` : ""}`;

  body.append(name, meta, stats);

  const score = document.createElement("div");
  score.className = "scoreboard-entry-score";
  score.textContent = `${player.score ?? 0}`;

  item.append(teamAccent, body, score);
  return item;
}

function renderScoreboard(leaderboard = latestLeaderboard) {
  if (!scoreboardElement) {
    return;
  }

  const resolvedLeaderboard = Array.isArray(leaderboard) ? leaderboard : [];
  const shouldShow = Boolean(currentRoomId && resolvedLeaderboard.length > 0);
  if (scoreboardPanelElement) {
    scoreboardPanelElement.hidden = !shouldShow;
  }
  if (!shouldShow) {
    if (lastScoreboardRenderKey) {
      lastScoreboardRenderKey = "";
      scoreboardElement.replaceChildren();
    }
    return;
  }

  const renderKey = buildLeaderboardRenderKey(resolvedLeaderboard);
  if (renderKey === lastScoreboardRenderKey) {
    return;
  }

  lastScoreboardRenderKey = renderKey;
  const fragment = document.createDocumentFragment();
  for (const player of resolvedLeaderboard) {
    fragment.append(createScoreboardEntry(player));
  }
  scoreboardElement.replaceChildren(fragment);
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
    item.innerHTML = `<div class="results-title">${escapeHtml(player.name)}</div><div class="results-meta">${escapeHtml(getTeamName(player.teamId))} / ${escapeHtml(getLobbyClassName(player.classId))} | ${player.score} score | ${player.assists ?? 0} assists | ${player.deaths} deaths | ${player.credits} credits${player.ready ? " | ready" : ""}</div>`;
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
  recordDebugEvent(
    "player_disconnected",
    `Socket closed (${formatSocketCloseInfo(lastSocketCloseInfo)})`,
    {
      severity: lastSocketCloseInfo.wasClean ? "warn" : "error",
      ttlMs: 15_000,
      key: "local_socket_close"
    }
  );
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

function isSpectatorSession(localPlayer = getLocalPlayer(), you = latestYou) {
  return Boolean(you?.isSpectator ?? localPlayer?.isSpectator ?? false);
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

function markLocalInputChanged(now = Date.now()) {
  lastLocalInputChangedAt = now;
}

function markLocalAimChanged(now = Date.now()) {
  lastAimInputChangedAt = now;
  markLocalInputChanged(now);
}

function hasRecentAimInputActive(now = Date.now()) {
  return pointerPrimaryDown || now - lastAimInputChangedAt <= LOCAL_AIM_RESPONSE.inputGraceMs;
}

function captureLiveInputState(now = Date.now()) {
  const localPlayer = getLocalPlayer();
  const visualState = ensureLocalVisualState(localPlayer);
  const renderState = ensureLocalRenderState();
  const target = refreshPointerWorldPosition();
  const capturedInputState = getCapturedInputState();
  const aimOrigin = visualState ?? renderState;
  const turretAngle = aimOrigin
    ? Math.atan2(target.y - aimOrigin.y, target.x - aimOrigin.x)
    : 0;

  return {
    localSentAt: now,
    ...capturedInputState,
    turretAngle
  };
}

function areInputStatesEquivalent(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    Boolean(left.forward) === Boolean(right.forward) &&
    Boolean(left.back) === Boolean(right.back) &&
    Boolean(left.left) === Boolean(right.left) &&
    Boolean(left.right) === Boolean(right.right) &&
    Boolean(left.shoot) === Boolean(right.shoot) &&
    Math.abs(normalizeAngle((left.turretAngle ?? 0) - (right.turretAngle ?? 0))) <= 0.0005
  );
}

function applyLocalPredictedState(localPlayer, predicted) {
  if (!localPlayer || !predicted) {
    return;
  }

  const visualState = ensureLocalVisualState(localPlayer);
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
}

function ensureLocalVisualState(localPlayer = getLocalPlayer()) {
  if (!localPlayer || localPlayer.isSpectator) {
    localVisualState = null;
    return null;
  }

  if (!localVisualState) {
    const displayedLocalPose = localPlayer?.id === localPlayerId ? localRenderState : null;
    localVisualState = {
      x: displayedLocalPose?.x ?? getPlayerVisualX(localPlayer),
      y: displayedLocalPose?.y ?? getPlayerVisualY(localPlayer),
      angle: displayedLocalPose?.angle ?? getPlayerVisualAngle(localPlayer),
      turretAngle: displayedLocalPose?.turretAngle ?? getPlayerVisualTurretAngle(localPlayer)
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

  if (canSimulateLocalPlayer() && localPlayer.alive) {
    renderState.x = visualState.x;
    renderState.y = visualState.y;
    renderState.angle = visualState.angle;
    renderState.turretAngle = lerpAngle(
      renderState.turretAngle,
      visualState.turretAngle,
      getTurretVisualSmoothing(deltaSeconds)
    );
    return renderState;
  }

  const gapDistance = Math.hypot(visualState.x - renderState.x, visualState.y - renderState.y);

  // This path is only reached when the player is dead or not simulatable,
  // so always use the passive follow rate (dead/spectator camera catch-up).
  const followAmount = clamp(1 - Math.exp(-16 * deltaSeconds), 0.18, 0.4);
  const boostedFollowAmount =
    gapDistance >= LOCAL_PREDICTION.maxSmoothGap
      ? Math.max(followAmount, 0.78)
      : followAmount;

  if (gapDistance >= LOCAL_PREDICTION.snapGap) {
    renderState.x = visualState.x;
    renderState.y = visualState.y;
    renderState.angle = visualState.angle;
    renderState.turretAngle = visualState.turretAngle;
    return renderState;
  }

  if (crossedOwnSpawnBoundary(localPlayer.teamId, renderState.x, visualState.x)) {
    renderState.x = visualState.x;
    renderState.y = visualState.y;
    renderState.angle = visualState.angle;
    renderState.turretAngle = visualState.turretAngle;
    return renderState;
  }

  renderState.x = lerp(renderState.x, visualState.x, boostedFollowAmount);
  renderState.y = lerp(renderState.y, visualState.y, boostedFollowAmount);
  renderState.angle = lerpAngle(renderState.angle, visualState.angle, boostedFollowAmount);
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

function syncClassTabsVisibility() {
  if (!classTabsPanelElement) {
    return;
  }

  classTabsPanelElement.hidden = !hasPlayableSession();
}

function updateSessionChrome() {
  document.body.classList.toggle("in-session", hasPlayableSession());
  document.body.classList.toggle("joining-session", false);
  syncClassTabsVisibility();
  syncJoinMatchButton();
  refreshDeathOverlay();
  syncDiagnosticBannerPresentation();
  updateDiagnosticBanner();
}

function updateDiagnosticBanner() {
  if (!diagnosticBannerElement) {
    return;
  }

  const now = Date.now();
  const useDebugCompactLayout = syncDiagnosticBannerPresentation();
  const localPlayer = getLocalPlayer();
  const snapshotState = hasSeenLocalPlayerSnapshot ? "yes" : "no";
  const spectatorState = latestYou?.isSpectator ?? localPlayer?.isSpectator ?? false;
  const playerSummary = localPlayer
    ? localPlayer.name
    : (localPlayerId ? `awaiting state for ${localPlayerId}` : "none");
  const shouldShowCloseSummary = socket?.readyState !== WebSocket.OPEN && lastSocketCloseInfo;
  const issuesSummary = buildDebugIssuesSummary(now);

  const nextText = useDebugCompactLayout
    ? `Status: ${statusElement.textContent}\n` +
      `Room: ${currentRoomId ?? "-"} | Snapshot: ${snapshotState} | Players: ${players.size}\n` +
      `Player: ${playerSummary} | Spec: ${spectatorState ? "yes" : "no"} | Zoom: ${cameraZoom.toFixed(2)}` +
      (spectatorState ? "\nFree Cam: WASD/Arrows | Wheel or +/- | 0 recenters" : "") +
      (shouldShowCloseSummary ? `\nLast Close: ${formatSocketCloseInfo(lastSocketCloseInfo)}` : "") +
      (renderFailure ? `\nRender Error: ${renderFailure}` : "")
    : `Status: ${statusElement.textContent}\n` +
      `Room: ${currentRoomId ?? "-"} | Snapshot: ${snapshotState} | Players: ${players.size}\n` +
      `Local Player: ${playerSummary}\n` +
      `Playable: ${hasPlayableSession() ? "yes" : "no"} | Spectator: ${spectatorState ? "yes" : "no"} | Zoom: ${cameraZoom.toFixed(2)}` +
      (debugUiEnabled || issuesSummary !== "none" ? `\nIssues: ${issuesSummary}` : "") +
      (spectatorState ? "\nFree Cam: WASD/Arrows move | Mouse Wheel or +/- zoom | 0 recenters" : "") +
      (shouldShowCloseSummary ? `\nLast Close: ${formatSocketCloseInfo(lastSocketCloseInfo)}` : "") +
      (renderFailure ? `\nRender Error: ${renderFailure}` : "");

  if (diagnosticBannerElement.hidden) {
    diagnosticBannerElement.hidden = false;
  }

  if (lastDiagnosticBannerText !== nextText) {
    lastDiagnosticBannerText = nextText;
    setElementText(diagnosticBannerElement, nextText);
  }
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

  const activeIds = new Set();

  for (const player of players.values()) {
    if (player.id === localPlayerId || player.isSpectator || player.isBot) {
      continue;
    }

    activeIds.add(player.id);
    let marker = fallbackRemoteMarkerCache.get(player.id);
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
      fallbackRemoteMarkerCache.set(player.id, marker);
    }

    const label = marker.querySelector(".fallback-remote-label");
    if (label) {
      label.textContent = player.name;
    }
    setFallbackMarkerScale(marker);
    positionFallbackMarker(marker, getPlayerVisualX(player), getPlayerVisualY(player));
  }

  for (const [playerId, marker] of fallbackRemoteMarkerCache.entries()) {
    if (activeIds.has(playerId)) {
      continue;
    }

    marker.remove();
    fallbackRemoteMarkerCache.delete(playerId);
  }
}

function updateFallbackVisuals() {
  if (
    legacyFallbackVisualsBlockedByHiddenAncestor ||
    !playAreaElement ||
    !fallbackVisualLayerElement ||
    !playAreaElement.classList.contains("active")
  ) {
    return;
  }

  fallbackCameraX = camera.x;
  fallbackCameraY = camera.y;

  const theme = getActiveMapLayout().theme;
  const gridColor = theme?.gridMinor ?? "rgba(122, 128, 136, 0.34)";
  const minorSize = Math.max(20, 40 * cameraZoom);
  playAreaElement.style.backgroundImage = [
    `linear-gradient(${gridColor} 2px, transparent 2px)`,
    `linear-gradient(90deg, ${gridColor} 2px, transparent 2px)`
  ].join(",");
  playAreaElement.style.backgroundSize = `${minorSize}px ${minorSize}px, ${minorSize}px ${minorSize}px`;
  playAreaElement.style.backgroundPosition =
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

function getLobbyClassConfig(classId) {
  return GAME_CONFIG.lobby.classes.find((entry) => entry.id === classId) ?? GAME_CONFIG.lobby.classes[0];
}

function getLobbyClassName(classId) {
  return getLobbyClassConfig(classId)?.name ?? (typeof classId === "string" && classId ? classId : "Basic");
}

function refreshClassTabs() {
  if (!classTabsElement) {
    return;
  }

  const activeClassId = getLobbyClassConfig(classSelect.value)?.id ?? GAME_CONFIG.lobby.classes[0]?.id ?? "basic";
  if (classSelect.value !== activeClassId) {
    classSelect.value = activeClassId;
  }

  const disabled = Boolean(classSelect.disabled);
  classTabsPanelElement?.classList.toggle("is-disabled", disabled);

  for (const button of classTabsElement.querySelectorAll(".class-tab")) {
    const isActive = button.dataset.classId === activeClassId;
    button.classList.toggle("is-active", isActive);
    button.disabled = disabled;
    button.setAttribute("aria-selected", String(isActive));
  }
}

function setSelectedLobbyClass(classId, options = {}) {
  const { notifyServer = false } = options;
  const nextClassId = getLobbyClassConfig(classId)?.id ?? GAME_CONFIG.lobby.classes[0]?.id ?? "basic";
  const changed = classSelect.value !== nextClassId;
  classSelect.value = nextClassId;
  refreshClassTabs();
  syncLockedCameraZoom();

  if (changed && notifyServer && currentRoomId && socket?.readyState === WebSocket.OPEN) {
    sendLobbyUpdate("class", {
      classId: nextClassId
    });
  }
}

function populateClassTabs() {
  if (!classTabsElement) {
    return;
  }

  classTabsElement.replaceChildren();

  for (const classConfig of GAME_CONFIG.lobby.classes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "class-tab";
    button.dataset.classId = classConfig.id;
    button.textContent = classConfig.name;
    button.title = classConfig.summary ?? classConfig.name;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => {
      if (button.disabled) {
        return;
      }

      setSelectedLobbyClass(classConfig.id, {
        notifyServer: Boolean(currentRoomId)
      });
    });
    classTabsElement.append(button);
  }

  refreshClassTabs();
}

function getCanvasOverlayRect(element) {
  if (!element || element.hidden || !canvas?.getBoundingClientRect) {
    return null;
  }

  const elementRect = element.getBoundingClientRect?.();
  const canvasRect = canvas.getBoundingClientRect();
  if (!elementRect || !canvasRect) {
    return null;
  }

  const scaleX = canvas.width / Math.max(1, canvasRect.width);
  const scaleY = canvas.height / Math.max(1, canvasRect.height);
  const left = clamp((elementRect.left - canvasRect.left) * scaleX, 0, canvas.width);
  const top = clamp((elementRect.top - canvasRect.top) * scaleY, 0, canvas.height);
  const right = clamp((elementRect.right - canvasRect.left) * scaleX, 0, canvas.width);
  const bottom = clamp((elementRect.bottom - canvasRect.top) * scaleY, 0, canvas.height);

  if (right - left < 2 || bottom - top < 2) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function getTopLeftHudInset() {
  const classTabsBottom = Math.max(0, Math.ceil(getCanvasOverlayRect(classTabsPanelElement)?.bottom ?? 0));
  const devBadgeBottom = Math.max(0, Math.ceil(getCanvasOverlayRect(devBadgeElement)?.bottom ?? 0));
  return Math.max(14, classTabsBottom + 10, devBadgeBottom + 10);
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

function ensureQuickJoinDefaults(options = {}) {
  const { spectate = false } = options;

  if (!nameInput.value.trim()) {
    nameInput.value = createCommanderName();
  }

  spectateInput.checked = spectate;
  mapSelect.value = GAME_CONFIG.lobby.maps[0].id;
  teamSelect.value = GAME_CONFIG.lobby.teams[0].id;
  classSelect.value = getLobbyClassConfig(classSelect.value)?.id ?? GAME_CONFIG.lobby.classes[0].id;
  refreshClassTabs();
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

function getQuickJoinPhaseRank(room, options = {}) {
  const { spectate = false } = options;

  switch (room?.phase) {
    case MATCH_PHASES.LIVE_ROUND:
    case MATCH_PHASES.OVERTIME:
      return spectate ? 5 : 1;
    case MATCH_PHASES.WARMUP:
      return spectate ? 4 : 1;
    case MATCH_PHASES.WAITING:
      return 3;
    case MATCH_PHASES.ROUND_END:
    case MATCH_PHASES.RESULTS:
      return 2;
    default:
      return 0;
  }
}

function compareRoomsForQuickJoin(left, right, options = {}) {
  const { spectate = false } = options;
  const joinProperty = spectate ? "canJoinAsSpectator" : "canJoinAsPlayer";

  return (
    getQuickJoinPhaseRank(right, options) - getQuickJoinPhaseRank(left, options) ||
    (right.activePlayers ?? 0) - (left.activePlayers ?? 0) ||
    (right.spectators ?? 0) - (left.spectators ?? 0) ||
    Number(Boolean(right[joinProperty])) - Number(Boolean(left[joinProperty])) ||
    String(right.lastActivityAt ?? "").localeCompare(String(left.lastActivityAt ?? "")) ||
    String(left.roomCode ?? "").localeCompare(String(right.roomCode ?? ""))
  );
}

async function resolveQuickJoinRoomCode(options = {}) {
  const { spectate = false } = options;
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
    .filter((room) => spectate ? room?.canJoinAsSpectator : room?.canJoinAsPlayer)
    .sort((left, right) => compareRoomsForQuickJoin(left, right, { spectate }));

  return joinableRooms[0]?.roomCode ?? createRoomCode();
}

async function startQuickJoin(options = {}) {
  const { spectate = false } = options;

  if (joinInProgress || currentRoomId) {
    return;
  }

  ensureQuickJoinDefaults({ spectate });
  setStatus(spectate ? "Finding a live arena to spectate..." : "Finding match...");
  matchStatusElement.textContent = spectate ? "Finding an arena to spectate" : "Finding an open arena";

  try {
    roomInput.value = await resolveQuickJoinRoomCode({ spectate });
  } catch (error) {
    roomInput.value = createRoomCode();
  }

  setStatus(spectate ? "Joining as spectator..." : "Joining match...");
  matchStatusElement.textContent = spectate ? "Joining arena as spectator" : "Joining arena";
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
  recordDebugEvent("snapshot_resync_requested", `Lifecycle resync requested (${reason})`, {
    severity: "warn",
    ttlMs: 8_000,
    key: `snapshot_resync_requested:${reason}`
  });
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
  const snapshotIntervalMs = 1000 / Math.max(1, GAME_CONFIG.snapshotRate);
  const halfRtt = latestLatencyMs > 0 ? latestLatencyMs * 0.5 : NETWORK_RENDER.interpolationBackTimeMs;
  const jitterBufferMs = Math.min(40, getLatencyJitterMs() * 0.75);
  const cadenceFloorMs = snapshotIntervalMs * 1.35;
  const maxBackTimeMs = Math.max(NETWORK_RENDER.interpolationBackTimeMs, Math.round(snapshotIntervalMs * 3));
  return clamp(
    Math.round(Math.max(halfRtt + 8, cadenceFloorMs + jitterBufferMs)),
    Math.max(NETWORK_RENDER.minInterpolationBackTimeMs, Math.round(snapshotIntervalMs)),
    maxBackTimeMs
  );
}

function syncServerClock(serverTime, frameAt = performance.now()) {
  if (!Number.isFinite(serverTime)) {
    return;
  }

  const targetOffset = serverTime - frameAt;
  const targetWallOffset = serverTime - Date.now();
  serverTimeOffset = lastAppliedSnapshotSeq === 0
    ? targetOffset
    : lerp(serverTimeOffset, targetOffset, NETWORK_RENDER.clockSmoothing);
  serverWallTimeOffset = lastAppliedSnapshotSeq === 0
    ? targetWallOffset
    : lerp(serverWallTimeOffset, targetWallOffset, NETWORK_RENDER.clockSmoothing);
}

function estimateClientWallTimeForServerTime(serverTime, now = Date.now()) {
  if (!Number.isFinite(serverTime)) {
    return Math.max(0, now - getRemoteInterpolationBackTimeMs());
  }

  const estimatedClientTime = serverTime - serverWallTimeOffset;
  if (!Number.isFinite(estimatedClientTime)) {
    return Math.max(0, now - getRemoteInterpolationBackTimeMs());
  }

  return clamp(estimatedClientTime, 0, now);
}

function getInputTimelineSentAt(input, fallback = Date.now()) {
  const localSentAt = Number(input?.localSentAt);
  if (Number.isFinite(localSentAt)) {
    return localSentAt;
  }

  const clientSentAt = Number(input?.clientSentAt);
  if (Number.isFinite(clientSentAt)) {
    return clientSentAt;
  }

  return fallback;
}

function getEstimatedServerInputTimestamp(fallback = Date.now()) {
  if (lastAppliedSnapshotSeq <= 0) {
    return Math.round(fallback);
  }

  const estimatedServerNow = estimateServerTime();
  return Number.isFinite(estimatedServerNow) ? Math.round(estimatedServerNow) : Math.round(fallback);
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

function getStatePacketAgeMs(now = Date.now()) {
  if (lastStatePacketAt <= 0) {
    return 0;
  }

  return Math.max(0, now - lastStatePacketAt);
}

function getPredictionScaleForGapMs(gapMs) {
  if (gapMs <= LOCAL_PREDICTION.stallSoftLimitMs) {
    return 1;
  }

  if (gapMs >= LOCAL_PREDICTION.stallHardLimitMs) {
    return 0;
  }

  return clamp(
    1 - (gapMs - LOCAL_PREDICTION.stallSoftLimitMs) /
      (LOCAL_PREDICTION.stallHardLimitMs - LOCAL_PREDICTION.stallSoftLimitMs),
    0,
    1
  );
}

function getRemoteExtrapolationBudgetMs(now = Date.now()) {
  return Math.round(NETWORK_RENDER.maxExtrapolationMs * getPredictionScaleForGapMs(getStatePacketAgeMs(now)));
}

function clampCorrectionOffset(x, y, maxDistance = LOCAL_PREDICTION.maxCorrectionOffset) {
  const distance = Math.hypot(x, y);
  if (!Number.isFinite(distance) || distance <= maxDistance || distance <= 0) {
    return {
      x,
      y
    };
  }

  const scale = maxDistance / distance;
  return {
    x: x * scale,
    y: y * scale
  };
}

function simulatePredictedMovementForDuration(state, input, durationMs, predictionScale = 1) {
  if (!state || !input) {
    return state;
  }

  const simulatedDurationSeconds = Math.max(0, durationMs) * predictionScale / 1000;
  if (simulatedDurationSeconds <= 0.0005) {
    return state;
  }

  return simulateTankMovement(state, input, simulatedDurationSeconds);
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
      if (player.id === localPlayerId) {
        notePredictedShotConfirmedBySeq(event.inputSeq);
      }
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

function getPlayerBodyRadius(player) {
  return player?.isBot ? GAME_CONFIG.tank.radius : getTankRadiusForClassId(player?.classId);
}

function getLocalLobbyClassId(localPlayer = getLocalPlayer()) {
  return (
    localPlayer?.classId ??
    latestYou?.classId ??
    getLobbyClassConfig(classSelect?.value)?.id ??
    GAME_CONFIG.lobby.classes[0]?.id ??
    "basic"
  );
}

function getDisplayedLobbyClassId(player = null) {
  if (player?.id === localPlayerId) {
    return getLocalLobbyClassId(player);
  }

  const classId = player?.classId;
  return typeof classId === "string" && classId ? classId : GAME_CONFIG.lobby.classes[0]?.id ?? "basic";
}

function getLobbyClassMultiplier(classId, fieldName, fallback = 1) {
  const value = Number(getLobbyClassProfile(classId)?.[fieldName]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getLocalLobbyClassProfile(localPlayer = getLocalPlayer()) {
  return getLobbyClassProfile(getLocalLobbyClassId(localPlayer));
}

function getLocalBodyRadius(localPlayer = getLocalPlayer()) {
  return getTankRadiusForClassId(getLocalLobbyClassId(localPlayer));
}

function getSpectatorCameraZoomBounds() {
  const fitWorldZoom = Math.max(
    canvas.width / GAME_CONFIG.world.width,
    canvas.height / GAME_CONFIG.world.height
  );

  return {
    min: Math.max(fitWorldZoom, 0.18),
    max: Math.max(SPECTATOR_CAMERA.maxZoom, fitWorldZoom)
  };
}

function clampSpectatorZoom(zoom) {
  const bounds = getSpectatorCameraZoomBounds();
  return clamp(zoom, bounds.min, bounds.max);
}

function getSpectatorCameraDefaultZoom() {
  return clampSpectatorZoom(SPECTATOR_CAMERA.defaultZoom);
}

function getSpectatorCameraDefaultFocus() {
  const liveCandidates = Array.from(players.values())
    .filter((player) => player && !player.isSpectator && player.connected !== false)
    .sort(
      (left, right) =>
        Number(Boolean(right.alive)) - Number(Boolean(left.alive)) ||
        (right.lastCombatEventAt ?? 0) - (left.lastCombatEventAt ?? 0) ||
        (right.score ?? 0) - (left.score ?? 0)
    );

  const focusedPlayer = liveCandidates[0] ?? null;
  if (focusedPlayer) {
    return {
      x: getPlayerVisualX(focusedPlayer),
      y: getPlayerVisualY(focusedPlayer)
    };
  }

  if (latestObjective) {
    return getObjectiveReferencePoint(latestObjective);
  }

  return {
    x: GAME_CONFIG.world.width / 2,
    y: GAME_CONFIG.world.height / 2
  };
}

function centerSpectatorCamera(options = {}) {
  const { zoom = getSpectatorCameraDefaultZoom() } = options;

  cameraZoom = clampSpectatorZoom(zoom);
  const focus = getSpectatorCameraDefaultFocus();
  const viewport = getVisibleViewportSize();
  const clamped = clampCameraPosition(focus.x - viewport.width / 2, focus.y - viewport.height / 2);
  camera.x = clamped.x;
  camera.y = clamped.y;
  cameraNeedsSnap = false;
  refreshPointerWorldPosition();
}

function applySpectatorCameraZoom(nextZoom, options = {}) {
  const viewportBefore = getVisibleViewportSize();
  const anchorWorldPosition = options.anchorWorldPosition ?? {
    x: camera.x + viewportBefore.width / 2,
    y: camera.y + viewportBefore.height / 2
  };
  const normalizedX = viewportBefore.width > 0
    ? clamp((anchorWorldPosition.x - camera.x) / viewportBefore.width, 0, 1)
    : 0.5;
  const normalizedY = viewportBefore.height > 0
    ? clamp((anchorWorldPosition.y - camera.y) / viewportBefore.height, 0, 1)
    : 0.5;
  const clampedZoom = clampSpectatorZoom(nextZoom);

  if (Math.abs(clampedZoom - cameraZoom) <= 0.0001) {
    return false;
  }

  cameraZoom = clampedZoom;
  const viewportAfter = getVisibleViewportSize();
  const nextCameraX = anchorWorldPosition.x - normalizedX * viewportAfter.width;
  const nextCameraY = anchorWorldPosition.y - normalizedY * viewportAfter.height;
  const clampedCamera = clampCameraPosition(nextCameraX, nextCameraY);
  camera.x = clampedCamera.x;
  camera.y = clampedCamera.y;
  cameraNeedsSnap = false;
  refreshPointerWorldPosition();
  return true;
}

function syncLockedCameraZoom() {
  if (isSpectatorSession()) {
    const nextZoom = clampSpectatorZoom(cameraZoom || getSpectatorCameraDefaultZoom());
    if (Math.abs(nextZoom - cameraZoom) > 0.0001) {
      cameraZoom = nextZoom;
      refreshPointerWorldPosition();
    }
    return;
  }

  const nextZoom = getLockedCameraZoom(canvas.width, canvas.height, getLocalLobbyClassId());
  if (!Number.isFinite(nextZoom) || nextZoom <= 0) {
    return;
  }

  if (Math.abs(nextZoom - cameraZoom) <= 0.0001) {
    return;
  }

  cameraZoom = nextZoom;
  refreshPointerWorldPosition();
}

function resizeCanvas() {
  const nextWidth = Math.max(640, Math.round(window.innerWidth));
  const nextHeight = Math.max(360, Math.round(window.innerHeight));

  if (canvas.width === nextWidth && canvas.height === nextHeight) {
    return;
  }

  const previousViewport = getVisibleViewportSize();
  const preserveSpectatorCenter = isSpectatorSession();
  const spectatorCenter = preserveSpectatorCenter
    ? {
        x: camera.x + previousViewport.width / 2,
        y: camera.y + previousViewport.height / 2
      }
    : null;

  canvas.width = nextWidth;
  canvas.height = nextHeight;
  syncLockedCameraZoom();

  if (preserveSpectatorCenter && spectatorCenter) {
    const viewport = getVisibleViewportSize();
    const clamped = clampCameraPosition(
      spectatorCenter.x - viewport.width / 2,
      spectatorCenter.y - viewport.height / 2
    );
    camera.x = clamped.x;
    camera.y = clamped.y;
    cameraNeedsSnap = false;
  } else {
    cameraNeedsSnap = true;
  }

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

function getObjectiveZones(objective = latestObjective) {
  if (Array.isArray(objective?.zones) && objective.zones.length > 0) {
    return objective.zones;
  }

  if (objective && Number.isFinite(Number(objective.x)) && Number.isFinite(Number(objective.y))) {
    return [
      {
        id: "objective-center",
        slot: "center",
        x: objective.x,
        y: objective.y,
        radius: objective.radius ?? GAME_CONFIG.objective.radius,
        ownerTeamId: objective.ownerTeamId ?? null,
        ownerTeamName: objective.ownerTeamName ?? objective.ownerName ?? null,
        captureTargetTeamId: objective.captureTargetTeamId ?? null,
        captureTargetTeamName: objective.captureTargetTeamName ?? objective.captureTargetName ?? null,
        captureProgress: objective.captureProgress ?? 0,
        contested: Boolean(objective.contested)
      }
    ];
  }

  return [];
}

function getObjectivePrimaryZone(objective = latestObjective) {
  const zones = getObjectiveZones(objective);
  return (
    zones.find((zone) => zone.contested || zone.captureTargetTeamId || (zone.captureProgress ?? 0) > 0) ??
    zones.find((zone) => zone.ownerTeamId) ??
    zones[Math.floor(zones.length / 2)] ??
    null
  );
}

function getObjectiveReferencePoint(objective = latestObjective) {
  const zones = getObjectiveZones(objective);
  if (zones.length > 0) {
    return {
      x: zones.reduce((total, zone) => total + zone.x, 0) / zones.length,
      y: zones.reduce((total, zone) => total + zone.y, 0) / zones.length
    };
  }

  const mapLayout = getActiveMapLayout();
  return {
    x: mapLayout.objective.x,
    y: mapLayout.objective.y
  };
}

function colorWithAlpha(color, alpha) {
  if (typeof color !== "string") {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  const hexMatch = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!hexMatch) {
    return color;
  }

  const hex = hexMatch[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getObjectiveTeamColor(teamId, fallback = "#ffd166") {
  return getTeamConfig(teamId)?.color ?? fallback;
}

function getObjectiveStatusText(objective = latestObjective) {
  const zones = getObjectiveZones(objective);
  if (zones.length === 0) {
    return "";
  }

  const blueCount = zones.filter((zone) => zone.ownerTeamId === "alpha").length;
  const redCount = zones.filter((zone) => zone.ownerTeamId === "bravo").length;
  const neutralCount = Math.max(0, zones.length - blueCount - redCount);
  const activeZone = getObjectivePrimaryZone(objective);
  const captureText =
    activeZone?.contested
      ? " | zone contested"
      : activeZone?.captureTargetTeamName &&
          (activeZone.ownerTeamId !== activeZone.captureTargetTeamId || (activeZone.captureProgress ?? 0) < 1)
        ? ` | capturing: ${activeZone.captureTargetTeamName}`
        : "";

  return ` | zones: ${blueCount} blue / ${redCount} red / ${neutralCount} neutral${captureText}`;
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
    return getObjectiveReferencePoint(latestObjective);
  }

  return {
    x: GAME_CONFIG.world.width / 2,
    y: GAME_CONFIG.world.height / 2
  };
}

function updateSpectatorCamera(deltaSeconds) {
  if (cameraNeedsSnap) {
    centerSpectatorCamera({
      zoom: cameraZoom || getSpectatorCameraDefaultZoom()
    });
    return;
  }

  const moveX = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const moveY = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  const moveMagnitude = Math.hypot(moveX, moveY);

  if (moveMagnitude <= 0) {
    const clamped = clampCameraPosition(camera.x, camera.y);
    camera.x = clamped.x;
    camera.y = clamped.y;
    return;
  }

  const speedMultiplier =
    keys.has("ShiftLeft") || keys.has("ShiftRight")
      ? SPECTATOR_CAMERA.fastMoveMultiplier
      : 1;
  const moveSpeed = clamp(
    SPECTATOR_CAMERA.minMoveSpeed / Math.sqrt(Math.max(cameraZoom, 0.18)),
    SPECTATOR_CAMERA.minMoveSpeed,
    SPECTATOR_CAMERA.maxMoveSpeed
  ) * speedMultiplier;
  const normalizedMoveX = moveX / moveMagnitude;
  const normalizedMoveY = moveY / moveMagnitude;
  const clamped = clampCameraPosition(
    camera.x + normalizedMoveX * moveSpeed * deltaSeconds,
    camera.y + normalizedMoveY * moveSpeed * deltaSeconds
  );
  camera.x = clamped.x;
  camera.y = clamped.y;
  refreshPointerWorldPosition();
}

function updateCamera(deltaSeconds) {
  if (isSpectatorSession()) {
    updateSpectatorCamera(deltaSeconds);
    return;
  }

  const focus = getCameraFocusTarget();
  const viewport = getVisibleViewportSize();
  const target = clampCameraPosition(focus.x - viewport.width / 2, focus.y - viewport.height / 2);

  if (cameraNeedsSnap) {
    camera.x = target.x;
    camera.y = target.y;
    cameraNeedsSnap = false;
    return;
  }

  const localPlayer = getLocalPlayer();
  const responsiveLocalCamera = Boolean(
    localPlayer &&
    !localPlayer.isSpectator &&
    canSimulateLocalPlayer() &&
    localPlayer.alive
  );
  const localMovementActive = responsiveLocalCamera && hasMovementInputActive();
  const targetDistance = Math.hypot(target.x - camera.x, target.y - camera.y);
  if (localMovementActive) {
    if (targetDistance <= 0.5 || targetDistance >= LOCAL_CAMERA.snapDistance) {
      camera.x = target.x;
      camera.y = target.y;
    } else {
      const activeFollowAmount = clamp(
        1 - Math.exp(-LOCAL_CAMERA.activeFollowRate * deltaSeconds),
        LOCAL_CAMERA.activeFollowMin,
        LOCAL_CAMERA.activeFollowMax
      );
      camera.x = lerp(camera.x, target.x, activeFollowAmount);
      camera.y = lerp(camera.y, target.y, activeFollowAmount);
      const clamped = clampCameraPosition(camera.x, camera.y);
      camera.x = clamped.x;
      camera.y = clamped.y;
    }
    return;
  }

  const followAmount = responsiveLocalCamera
    ? clamp(1 - Math.exp(-24 * deltaSeconds), 0.26, 0.92)
    : clamp(1 - Math.exp(-14 * deltaSeconds), 0.12, 0.55);
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
  const classSpeedMultiplier = getLobbyClassMultiplier(getLocalLobbyClassId(), "movementSpeedMultiplier", 1);
  return GAME_CONFIG.tank.speed * classSpeedMultiplier * (1 + getLocalStatValue("movementSpeed") * 0.07);
}

function getEffectiveLocalReloadMs() {
  const classDef = getLocalTankClassDef();
  const classReloadMs = classDef.reloadMs ?? GAME_CONFIG.tank.shootCooldownMs;
  const classReloadTimeMultiplier = getLobbyClassMultiplier(getLocalLobbyClassId(), "reloadTimeMultiplier", 1);
  return Math.max(50, classReloadMs * classReloadTimeMultiplier * (1 - getLocalStatValue("reload") * 0.065));
}

function getEffectiveLocalBulletSpeed() {
  const classDef = getLocalTankClassDef();
  return (classDef.bulletSpeed ?? GAME_CONFIG.bullet.speed) * (1 + getLocalStatValue("bulletSpeed") * 0.08);
}

function getEffectiveLocalBulletRadius() {
  return getLocalTankClassDef().bulletRadius ?? GAME_CONFIG.bullet.radius;
}

function getRenderedBarrelLength(barrel, barrelLengthMultiplier = 1) {
  return Math.max(0, (barrel?.w ?? 0) * barrelLengthMultiplier);
}

function getBarrelMuzzleDistance(bodyRadius, barrel, barrelLengthMultiplier = 1) {
  const extraForwardLength =
    (barrel?.x ?? 0) > 0
      ? Math.max(0, getRenderedBarrelLength(barrel, barrelLengthMultiplier) - (barrel?.w ?? 0))
      : 0;
  return bodyRadius + 8 + extraForwardLength;
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
    classSelect.value = getLobbyClassConfig(classSelect.value)?.id ?? GAME_CONFIG.lobby.classes[0].id;
    mapSelect.disabled = true;
    teamSelect.disabled = true;
    classSelect.disabled = false;
    refreshClassTabs();
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
  refreshClassTabs();

  renderResultsList();
}

function renderRoomBrowser(rooms) {
  const renderKey = (rooms ?? [])
    .map((room) =>
      [
        room.roomCode,
        room.mapName,
        room.phase,
        room.activePlayers,
        room.maxPlayers,
        room.spectators,
        room.canJoinAsPlayer,
        room.canJoinAsSpectator
      ].join("|")
    )
    .join("\n");

  if (renderKey === lastRoomBrowserRenderKey) {
    return;
  }

  lastRoomBrowserRenderKey = renderKey;
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
  if (document.hidden || hasPlayableSession()) {
    return;
  }

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
    lastRoomBrowserRenderKey = "";
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

function circleIntersectsCircle(ax, ay, aRadius, bx, by, bRadius) {
  const dx = ax - bx;
  const dy = ay - by;
  const combinedRadius = aRadius + bRadius;
  return dx * dx + dy * dy < combinedRadius * combinedRadius;
}

function collidesWithObstacle(x, y, radius = GAME_CONFIG.tank.radius) {
  return getActiveMapLayout().obstacles.some((obstacle) => circleIntersectsRect(x, y, radius, obstacle));
}

function getShapeCollisionPosition(shape) {
  return {
    x: Number.isFinite(Number(shape?.x)) ? Number(shape.x) : (shape?.targetX ?? shape?.renderX ?? 0),
    y: Number.isFinite(Number(shape?.y)) ? Number(shape.y) : (shape?.targetY ?? shape?.renderY ?? 0)
  };
}

function getPlayerCollisionPosition(player) {
  const displayX = Number(player?.displayX ?? player?.renderX ?? player?.targetX);
  const displayY = Number(player?.displayY ?? player?.renderY ?? player?.targetY);
  return {
    x: Number.isFinite(displayX) ? displayX : (Number.isFinite(Number(player?.x)) ? Number(player.x) : 0),
    y: Number.isFinite(displayY) ? displayY : (Number.isFinite(Number(player?.y)) ? Number(player.y) : 0)
  };
}

function shouldPredictCollisionAgainstPlayer(player, localPlayer = getLocalPlayer()) {
  if (!player || player.id === localPlayerId || !player.alive || player.isSpectator) {
    return false;
  }

  if (
    localPlayer?.teamId &&
    player.teamId &&
    localPlayer.teamId === player.teamId
  ) {
    return false;
  }

  return true;
}

function collidesWithBlockingPlayer(x, y, radius = GAME_CONFIG.tank.radius, options = {}) {
  const { excludeId = null, localPlayer = getLocalPlayer() } = options;
  for (const player of players.values()) {
    if (!player || player.id === excludeId || !shouldPredictCollisionAgainstPlayer(player, localPlayer)) {
      continue;
    }

    const collisionPosition = getPlayerCollisionPosition(player);
    const playerRadius = getPlayerBodyRadius(player);
    const maxDistance = radius + playerRadius;
    if (Math.abs(x - collisionPosition.x) >= maxDistance || Math.abs(y - collisionPosition.y) >= maxDistance) {
      continue;
    }

    if (circleIntersectsCircle(x, y, radius, collisionPosition.x, collisionPosition.y, playerRadius)) {
      return true;
    }
  }

  return false;
}

function collidesWithBlockingShape(x, y, radius = GAME_CONFIG.tank.radius, options = {}) {
  const { excludeId = null } = options;
  for (const shape of shapes.values()) {
    if (!shape || shape.id === excludeId || (shape.hp ?? 0) <= 0) {
      continue;
    }

    const collisionPosition = getShapeCollisionPosition(shape);
    const shapeX = collisionPosition.x;
    const shapeY = collisionPosition.y;
    const shapeRadius = shape.radius ?? 20;
    if (circleIntersectsCircle(x, y, radius, shapeX, shapeY, shapeRadius)) {
      return true;
    }
  }

  return false;
}

function resolvePredictedShapeCollisions(x, y, radius = GAME_CONFIG.tank.radius, fallbackAngle = 0) {
  let resolvedX = x;
  let resolvedY = y;

  for (let pass = 0; pass < 3; pass += 1) {
    let collided = false;

    for (const shape of shapes.values()) {
      if (!shape || (shape.hp ?? 0) <= 0) {
        continue;
      }

      const collisionPosition = getShapeCollisionPosition(shape);
      const shapeX = collisionPosition.x;
      const shapeY = collisionPosition.y;
      const shapeRadius = shape.radius ?? 20;
      const dx = resolvedX - shapeX;
      const dy = resolvedY - shapeY;
      const minDistance = radius + shapeRadius;
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDistance * minDistance) {
        continue;
      }

      collided = true;
      const dist = Math.sqrt(distSq);
      const nx = dist > 0.001 ? dx / dist : Math.cos(fallbackAngle);
      const ny = dist > 0.001 ? dy / dist : Math.sin(fallbackAngle);
      const pushDistance = minDistance - Math.max(dist, 0.001) + 0.2;
      const targetX = clamp(
        resolvedX + nx * pushDistance,
        GAME_CONFIG.world.padding,
        GAME_CONFIG.world.width - GAME_CONFIG.world.padding
      );
      const targetY = clamp(
        resolvedY + ny * pushDistance,
        GAME_CONFIG.world.padding,
        GAME_CONFIG.world.height - GAME_CONFIG.world.padding
      );

      if (
        !collidesWithObstacle(targetX, resolvedY, radius) &&
        !collidesWithBlockingShape(targetX, resolvedY, radius, { excludeId: shape.id })
      ) {
        resolvedX = targetX;
      }

      if (
        !collidesWithObstacle(resolvedX, targetY, radius) &&
        !collidesWithBlockingShape(resolvedX, targetY, radius, { excludeId: shape.id })
      ) {
        resolvedY = targetY;
      }
    }

    if (!collided) {
      break;
    }
  }

  return {
    x: resolvedX,
    y: resolvedY
  };
}

function resolvePredictedPlayerCollisions(
  x,
  y,
  radius = GAME_CONFIG.tank.radius,
  fallbackAngle = 0,
  localPlayer = getLocalPlayer()
) {
  let resolvedX = x;
  let resolvedY = y;

  for (let pass = 0; pass < 3; pass += 1) {
    let collided = false;

    for (const player of players.values()) {
      if (!shouldPredictCollisionAgainstPlayer(player, localPlayer)) {
        continue;
      }

      const collisionPosition = getPlayerCollisionPosition(player);
      const playerRadius = getPlayerBodyRadius(player);
      const dx = resolvedX - collisionPosition.x;
      const dy = resolvedY - collisionPosition.y;
      const minDistance = radius + playerRadius;
      if (Math.abs(dx) >= minDistance || Math.abs(dy) >= minDistance) {
        continue;
      }
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDistance * minDistance) {
        continue;
      }

      collided = true;
      const dist = Math.sqrt(distSq);
      const nx = dist > 0.001 ? dx / dist : Math.cos(fallbackAngle);
      const ny = dist > 0.001 ? dy / dist : Math.sin(fallbackAngle);
      const overlap = minDistance - Math.max(dist, 0.001);
      const pushDistance = overlap * 0.5 + 1;
      const targetX = clamp(
        resolvedX + nx * pushDistance,
        GAME_CONFIG.world.padding,
        GAME_CONFIG.world.width - GAME_CONFIG.world.padding
      );
      const targetY = clamp(
        resolvedY + ny * pushDistance,
        GAME_CONFIG.world.padding,
        GAME_CONFIG.world.height - GAME_CONFIG.world.padding
      );

      if (
        !collidesWithObstacle(targetX, resolvedY, radius) &&
        !collidesWithBlockingShape(targetX, resolvedY, radius) &&
        !collidesWithBlockingPlayer(targetX, resolvedY, radius, {
          excludeId: player.id,
          localPlayer
        })
      ) {
        resolvedX = targetX;
      }

      if (
        !collidesWithObstacle(resolvedX, targetY, radius) &&
        !collidesWithBlockingShape(resolvedX, targetY, radius) &&
        !collidesWithBlockingPlayer(resolvedX, targetY, radius, {
          excludeId: player.id,
          localPlayer
        })
      ) {
        resolvedY = targetY;
      }
    }

    if (!collided) {
      break;
    }
  }

  return {
    x: resolvedX,
    y: resolvedY
  };
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
    const extrapolationBudgetMs = getRemoteExtrapolationBudgetMs();
    const extrapolationMs = Math.min(
      extrapolationBudgetMs,
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
  const localPlayer = getLocalPlayer();
  const moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const moveY = (input.back ? 1 : 0) - (input.forward ? 1 : 0);
  const moveMagnitude = Math.hypot(moveX, moveY);
  const normalizedMoveX = moveMagnitude > 0 ? moveX / moveMagnitude : 0;
  const normalizedMoveY = moveMagnitude > 0 ? moveY / moveMagnitude : 0;
  const nextAngle = moveMagnitude > 0 ? Math.atan2(normalizedMoveY, normalizedMoveX) : state.angle;
  const moveSpeed = moveMagnitude > 0 ? getEffectiveLocalMoveSpeed() : 0;
  const collisionRadius = getLocalBodyRadius(localPlayer);
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

  if (!collidesWithObstacle(nextX, state.y, collisionRadius)) {
    resolvedX = nextX;
  }

  if (!collidesWithObstacle(resolvedX, nextY, collisionRadius)) {
    resolvedY = nextY;
  }

  const shapeResolved = resolvePredictedShapeCollisions(resolvedX, resolvedY, collisionRadius, nextAngle);
  resolvedX = shapeResolved.x;
  resolvedY = shapeResolved.y;
  const playerResolved = resolvePredictedPlayerCollisions(
    resolvedX,
    resolvedY,
    collisionRadius,
    nextAngle,
    localPlayer
  );
  resolvedX = playerResolved.x;
  resolvedY = playerResolved.y;

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
  const barrelLengthMultiplier = getLobbyClassMultiplier(getLocalLobbyClassId(localPlayer), "barrelLengthMultiplier", 1);
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
    const muzzleDistance = getBarrelMuzzleDistance(getLocalBodyRadius(localPlayer), barrel, barrelLengthMultiplier);
    const muzzleX =
      origin.x + Math.cos(barrelAngle) * muzzleDistance + bRightX * lateralOffset;
    const muzzleY =
      origin.y + Math.sin(barrelAngle) * muzzleDistance + bRightY * lateralOffset;
    const predictedId = buildPredictedProjectileId(inputFrame.seq, index);

    predictedProjectiles.set(predictedId, {
      id: predictedId,
      ownerId: localPlayerId,
      x: muzzleX,
      y: muzzleY,
      angle: barrelAngle,
      speed: projectileSpeed,
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
    notePredictedShotPending(predictedId, inputFrame, Date.now(), index);
  });

  triggerShotRecoil(localPlayer, now, { predicted: true });
}

function getAuthoritativeProjectileMatchKey(authoritativeBullet) {
  const inputSeq = Number(authoritativeBullet?.inputSeq ?? 0);
  if (!Number.isInteger(inputSeq) || inputSeq <= 0) {
    return null;
  }

  return buildPredictedProjectileId(inputSeq, authoritativeBullet?.barrelIndex ?? 0);
}

function takePredictedProjectileMatch(authoritativeBullet) {
  if (!authoritativeBullet || authoritativeBullet.ownerId !== localPlayerId) {
    return null;
  }

  const exactMatchId = getAuthoritativeProjectileMatchKey(authoritativeBullet);
  if (exactMatchId) {
    const exactMatch = predictedProjectiles.get(exactMatchId) ?? null;
    notePredictedShotMatched(exactMatchId);
    if (exactMatch) {
      predictedProjectiles.delete(exactMatchId);
    }
    return exactMatch;
  }

  if (predictedProjectiles.size === 0) {
    return null;
  }

  let bestMatchId = null;
  let bestMatch = null;
  let bestDistanceSquared = Infinity;

  for (const projectile of predictedProjectiles.values()) {
    const projectileX = projectile.renderX ?? projectile.x;
    const projectileY = projectile.renderY ?? projectile.y;
    const dx = projectileX - authoritativeBullet.x;
    const dy = projectileY - authoritativeBullet.y;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestMatchId = projectile.id;
      bestMatch = projectile;
    }
  }

  const maxMatchDistance =
    LOCAL_PROJECTILE_HANDOFF.maxMatchDistance * LOCAL_PROJECTILE_HANDOFF.maxMatchDistance;
  if (bestMatchId && bestDistanceSquared <= maxMatchDistance) {
    predictedProjectiles.delete(bestMatchId);
    notePredictedShotMatched(bestMatchId);
    return bestMatch;
  }

  return null;
}

function bridgeAuthoritativeBulletToPrediction(current, authoritativeBullet, predictedProjectile) {
  if (!current || !authoritativeBullet || !predictedProjectile) {
    return;
  }

  const predictedX = predictedProjectile.renderX ?? predictedProjectile.x ?? authoritativeBullet.x ?? 0;
  const predictedY = predictedProjectile.renderY ?? predictedProjectile.y ?? authoritativeBullet.y ?? 0;
  const predictedAngle = predictedProjectile.renderAngle ?? predictedProjectile.angle ?? authoritativeBullet.angle ?? 0;

  current.renderX = predictedX;
  current.renderY = predictedY;
  current.previousRenderX = predictedProjectile.previousRenderX ?? predictedX;
  current.previousRenderY = predictedProjectile.previousRenderY ?? predictedY;
  current.renderAngle = predictedAngle;
  current.renderSpeed =
    predictedProjectile.renderSpeed ??
    predictedProjectile.speed ??
    authoritativeBullet.speed ??
    GAME_CONFIG.bullet.speed;
  current.displayX = predictedX;
  current.displayY = predictedY;
  current.displayAngle = predictedAngle;
  current.handoffOffsetX = predictedX - (authoritativeBullet.x ?? predictedX);
  current.handoffOffsetY = predictedY - (authoritativeBullet.y ?? predictedY);
}

function createInputFrame(liveInputState = captureLiveInputState()) {
  const seq = nextInputSeq++;
  const localSentAt = getInputTimelineSentAt(liveInputState);

  return {
    seq,
    ...liveInputState,
    localSentAt,
    clientSentAt: getEstimatedServerInputTimestamp(localSentAt)
  };
}

function serializeInputFrame(inputFrame) {
  return {
    type: MESSAGE_TYPES.INPUT,
    seq: inputFrame.seq,
    clientSentAt: inputFrame.clientSentAt,
    forward: Boolean(inputFrame.forward),
    back: Boolean(inputFrame.back),
    left: Boolean(inputFrame.left),
    right: Boolean(inputFrame.right),
    shoot: Boolean(inputFrame.shoot),
    turretAngle: inputFrame.turretAngle
  };
}

function getLocalInputDispatchMinIntervalMs() {
  return Math.ceil(1000 / LOCAL_INPUT_RESPONSE.maxSendRate);
}

function dispatchLocalInput(options = {}) {
  const { force = false, preferImmediate = false } = options;
  const now = Date.now();
  const liveInputState = captureLiveInputState(now);
  const stateChanged = !areInputStatesEquivalent(lastDispatchedInputState, liveInputState);
  const minIntervalMs =
    preferImmediate && stateChanged
      ? LOCAL_INPUT_RESPONSE.immediateStateChangeMinIntervalMs
      : getLocalInputDispatchMinIntervalMs();

  if (now - lastInputDispatchAt < minIntervalMs) {
    return null;
  }

  if (socket?.readyState !== WebSocket.OPEN) {
    return null;
  }

  const localPlayer = getLocalPlayer();
  if (!localPlayer || localPlayer.isSpectator) {
    return null;
  }

  if (!force && !stateChanged) {
    return null;
  }

  const inputFrame = createInputFrame(liveInputState);
  send(serializeInputFrame(inputFrame));
  lastInputDispatchAt = getInputTimelineSentAt(inputFrame);
  lastDispatchedInputState = inputFrame;

  if (!canSimulateLocalPlayer() || !localPlayer.alive) {
    return inputFrame;
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

  return inputFrame;
}

function updateResponsiveLocalPrediction(deltaSeconds) {
  const localPlayer = getLocalPlayer();
  if (!localPlayer || localPlayer.isSpectator || !canSimulateLocalPlayer() || !localPlayer.alive) {
    return;
  }

  const visualState = ensureLocalVisualState(localPlayer);
  if (!visualState) {
    return;
  }

  const liveInput = captureLiveInputState();
  const predictionScale = getPredictionScaleForGapMs(getStatePacketAgeMs());
  const predicted = simulateTankMovement(
    {
      x: visualState.x,
      y: visualState.y,
      angle: visualState.angle,
      turretAngle: visualState.turretAngle
    },
    liveInput,
    Math.min(deltaSeconds, LOCAL_INPUT_RESPONSE.maxPredictionStepSeconds) * predictionScale
  );

  applyLocalPredictedState(localPlayer, predicted);
}

function bufferPendingInput(inputFrame) {
  pendingInputs.push(inputFrame);

  const oldestAllowedClientSentAt = Date.now() - GAME_CONFIG.input.maxClientInputAgeMs;
  while (
    pendingInputs.length > GAME_CONFIG.input.maxBufferedInputs ||
    (pendingInputs[0] && getInputTimelineSentAt(pendingInputs[0]) < oldestAllowedClientSentAt)
  ) {
    pendingInputs.shift();
  }
}

function updateEntityMap(store, entities, defaults = {}, options = {}) {
  const activeIds = new Set();
  const { kind = "player", serverTime = NaN } = options;

  for (const entity of entities) {
    activeIds.add(entity.id);
    const isNewEntity = !store.has(entity.id);
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
    if (isNewEntity && kind === REPLICATION_KINDS.BULLET) {
      const predictedProjectile = takePredictedProjectileMatch(entity);
      bridgeAuthoritativeBulletToPrediction(current, entity, predictedProjectile);
    }
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
  const isNewEntity = !store.has(entity.id);
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
  if (isNewEntity && kind === REPLICATION_KINDS.BULLET) {
    const predictedProjectile = takePredictedProjectileMatch(entity);
    bridgeAuthoritativeBulletToPrediction(current, entity, predictedProjectile);
  }
  recordNetworkSample(current, kind, serverTime);
  store.set(entity.id, current);
}

function captureCurrentVisualState(player) {
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

function applyReplication(replication, serverTime, previousSnapshotSeq) {
  if (!replication) {
    return "fallback";
  }

  if (replication.mode === "delta" && replication.baselineSnapshotSeq !== previousSnapshotSeq) {
    return "resync";
  }

  const fullPlayerIds = replication.mode === "full" ? new Set() : null;
  const fullBulletIds = replication.mode === "full" ? new Set() : null;
  const fullShapeIds = replication.mode === "full" ? new Set() : null;

  if (replication.mode === "full") {
    if (latestObjective) {
      latestObjective = {
        ...latestObjective
      };
    }
  }

  for (const record of replication.spawns ?? []) {
    if (record.kind === REPLICATION_KINDS.PLAYER) {
      fullPlayerIds?.add(record.id);
      upsertEntity(players, record.state, { alive: true, ready: false }, { kind: REPLICATION_KINDS.PLAYER, serverTime });
      continue;
    }

    if (record.kind === REPLICATION_KINDS.BULLET) {
      fullBulletIds?.add(record.id);
      upsertEntity(bullets, record.state, {}, { kind: REPLICATION_KINDS.BULLET, serverTime });
      continue;
    }

    if (record.kind === REPLICATION_KINDS.SHAPE) {
      fullShapeIds?.add(record.id);
      upsertEntity(shapes, record.state, {}, { kind: REPLICATION_KINDS.SHAPE, serverTime });
      continue;
    }

    if (record.kind === REPLICATION_KINDS.OBJECTIVE) {
      latestObjective = {
        ...(latestObjective ?? {}),
        ...record.state
      };
    }
  }

  for (const record of replication.updates ?? []) {
    if (record.kind === REPLICATION_KINDS.PLAYER) {
      fullPlayerIds?.add(record.id);
      const previous = players.get(record.id) ?? {};
      upsertEntity(
        players,
        { ...previous, ...record.state, id: record.id },
        { alive: true, ready: false },
        { kind: REPLICATION_KINDS.PLAYER, serverTime }
      );
      continue;
    }

    if (record.kind === REPLICATION_KINDS.BULLET) {
      fullBulletIds?.add(record.id);
      const previous = bullets.get(record.id) ?? {};
      upsertEntity(
        bullets,
        { ...previous, ...record.state, id: record.id },
        {},
        { kind: REPLICATION_KINDS.BULLET, serverTime }
      );
      continue;
    }

    if (record.kind === REPLICATION_KINDS.SHAPE) {
      fullShapeIds?.add(record.id);
      const previous = shapes.get(record.id) ?? {};
      upsertEntity(shapes, { ...previous, ...record.state, id: record.id }, {}, { kind: REPLICATION_KINDS.SHAPE, serverTime });
      continue;
    }

    if (record.kind === REPLICATION_KINDS.OBJECTIVE) {
      latestObjective = {
        ...(latestObjective ?? {}),
        ...record.state
      };
    }
  }

  for (const record of replication.despawns ?? []) {
    if (record.kind === REPLICATION_KINDS.PLAYER) {
      players.delete(record.id);
      continue;
    }

    if (record.kind === REPLICATION_KINDS.BULLET) {
      bullets.delete(record.id);
      continue;
    }

    if (record.kind === REPLICATION_KINDS.SHAPE) {
      const shape = shapes.get(record.id);
      if (shape) {
        maybeSpawnShapeDeathParticles(shape);
        shapes.delete(record.id);
      }
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

    for (const shapeId of Array.from(shapes.keys())) {
      if (!fullShapeIds.has(shapeId)) {
        const shape = shapes.get(shapeId);
        if (shape) {
          maybeSpawnShapeDeathParticles(shape);
          shapes.delete(shapeId);
        }
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
      getInputTimelineSentAt(pendingInputs[0]) < oldestAllowedClientSentAt)
  ) {
    pendingInputs.shift();
  }
}

function computePredictedLocalState(
  localPlayer,
  lastProcessedInputSeq,
  lastProcessedInputClientSentAt,
  authoritativeClientTime = Date.now()
) {
  dropAcknowledgedPendingInputs(lastProcessedInputSeq, lastProcessedInputClientSentAt);

  let predicted = {
    x: localPlayer.x,
    y: localPlayer.y,
    angle: localPlayer.angle,
    turretAngle: localPlayer.turretAngle
  };

  const now = Date.now();
  const replayGapMs = getStatePacketAgeMs(now);
  const predictionScale = getPredictionScaleForGapMs(replayGapMs);
  const replayCutoffMs =
    replayGapMs >= LOCAL_PREDICTION.stallSoftLimitMs
      ? now - LOCAL_PREDICTION.maxReplayWindowMs
      : -Infinity;
  const replayStartMs = Math.min(
    now,
    Math.max(lastProcessedInputClientSentAt, authoritativeClientTime, replayCutoffMs)
  );
  let activeInput = null;
  let segmentStartMs = replayStartMs;

  for (const input of pendingInputs) {
    const inputSentAt = getInputTimelineSentAt(input);
    if (inputSentAt < replayCutoffMs) {
      continue;
    }

    if (inputSentAt <= replayStartMs) {
      activeInput = input;
      continue;
    }

    predicted = simulatePredictedMovementForDuration(
      predicted,
      activeInput,
      inputSentAt - segmentStartMs,
      predictionScale
    );
    activeInput = input;
    segmentStartMs = inputSentAt;
  }

  const liveInput = captureLiveInputState(now);
  const liveInputChangeAt = clamp(lastLocalInputChangedAt || 0, replayStartMs, now);
  if (liveInput && !areInputStatesEquivalent(activeInput, liveInput) && liveInputChangeAt > segmentStartMs) {
    predicted = simulatePredictedMovementForDuration(
      predicted,
      activeInput,
      liveInputChangeAt - segmentStartMs,
      predictionScale
    );
    activeInput = liveInput;
    segmentStartMs = liveInputChangeAt;
  } else if (!activeInput && liveInput) {
    activeInput = liveInput;
    segmentStartMs = liveInputChangeAt > replayStartMs ? liveInputChangeAt : replayStartMs;
  }

  // Replay by elapsed time instead of packet count so redundant or batched input
  // packets do not make the local tank jump ahead and then get tugged backward.
  predicted = simulatePredictedMovementForDuration(
    predicted,
    activeInput,
    now - segmentStartMs,
    predictionScale
  );

  return predicted;
}

function simulatePredictedProjectiles(deltaSeconds) {
  const now = performance.now();

  for (const [projectileId, projectile] of predictedProjectiles.entries()) {
    const projectileSpeed = projectile.speed ?? GAME_CONFIG.bullet.speed;
    const projectileRadius = projectile.radius ?? GAME_CONFIG.bullet.radius;
    projectile.previousRenderX = projectile.renderX ?? projectile.x;
    projectile.previousRenderY = projectile.renderY ?? projectile.y;
    projectile.x += Math.cos(projectile.angle) * projectileSpeed * deltaSeconds;
    projectile.y += Math.sin(projectile.angle) * projectileSpeed * deltaSeconds;
    projectile.renderX = projectile.x;
    projectile.renderY = projectile.y;
    projectile.renderAngle = projectile.angle;
    projectile.renderSpeed = projectileSpeed;

    if (
      now >= projectile.expiresAt ||
      projectile.x < 0 ||
      projectile.x > GAME_CONFIG.world.width ||
      projectile.y < 0 ||
      projectile.y > GAME_CONFIG.world.height ||
      collidesWithObstacle(projectile.x, projectile.y, projectileRadius) ||
      collidesWithBlockingShape(projectile.x, projectile.y, projectileRadius)
    ) {
      predictedProjectiles.delete(projectileId);
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
  const stalledStream = getStatePacketAgeMs() >= LOCAL_PREDICTION.stallHardLimitMs;
  noteReconciliation(distanceError, {
    stalledStream,
    pendingReplayCount: pendingInputs.length
  });

  if (distanceError >= LOCAL_PREDICTION.snapGap || stalledStream) {
    localPlayer.correctionOffsetX = 0;
    localPlayer.correctionOffsetY = 0;
    localPlayer.correctionOffsetAngle = 0;
    localPlayer.correctionOffsetTurretAngle = 0;
    localPlayer.displayX = correctedState.x;
    localPlayer.displayY = correctedState.y;
    localPlayer.displayAngle = correctedState.angle;
    localPlayer.displayTurretAngle = correctedState.turretAngle;

    const visualState = ensureLocalVisualState(localPlayer);
    if (visualState) {
      visualState.x = correctedState.x;
      visualState.y = correctedState.y;
      visualState.angle = correctedState.angle;
      visualState.turretAngle = correctedState.turretAngle;
    }

    localRenderState = {
      x: correctedState.x,
      y: correctedState.y,
      angle: correctedState.angle,
      turretAngle: correctedState.turretAngle
    };
    return;
  }

  if (distanceError > 0.5 || Math.abs(correctionAngle) > 0.01 || Math.abs(correctionTurretAngle) > 0.01) {
    const clampedCorrection = clampCorrectionOffset(correctionX, correctionY);
    localPlayer.correctionOffsetX = clampedCorrection.x;
    localPlayer.correctionOffsetY = clampedCorrection.y;
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

  const hasResponsiveLocalControl = hasMovementInputActive() || hasRecentAimInputActive();
  if (!localRenderState || !hasResponsiveLocalControl) {
    localRenderState = {
      x: correctedState.x,
      y: correctedState.y,
      angle: correctedState.angle,
      turretAngle: correctedState.turretAngle
    };
  }
}

function replayPendingInputs(
  localPlayer,
  lastProcessedInputSeq,
  lastProcessedInputClientSentAt,
  authoritativeClientTime
) {
  const predicted = computePredictedLocalState(
    localPlayer,
    lastProcessedInputSeq,
    lastProcessedInputClientSentAt,
    authoritativeClientTime
  );

  applyPredictionCorrection(localPlayer, predicted);
}

function applySnapshot(payload) {
  const perfMark = startClientPerfProfile("applySnapshot");
  try {
    const snapshotSeq = payload.snapshotSeq ?? 0;
    if (snapshotSeq <= lastAppliedSnapshotSeq) {
      recordDebugEvent(
        "snapshot_out_of_order",
        `Received out-of-order snapshot ${snapshotSeq} after ${lastAppliedSnapshotSeq}`,
        {
          severity: "warn",
          ttlMs: 8_000,
          key: "snapshot_out_of_order"
        }
      );
      return;
    }

    const previousSnapshotSeq = lastAppliedSnapshotSeq;
    const previousProcessedInputSeq = latestYou?.lastProcessedInputSeq ?? 0;
    const previousProcessedInputClientSentAt = latestYou?.lastProcessedInputClientSentAt ?? 0;
    const previousMatchPhase = latestMatch?.phase ?? null;
    const previousRoundNumber = Number(latestMatch?.roundNumber ?? 0) || 0;
    const nextMatchPhase = payload.match?.phase ?? previousMatchPhase;
    const nextRoundNumber = Number(payload.match?.roundNumber ?? previousRoundNumber) || previousRoundNumber;
    const replicationPerfMark = startClientPerfProfile("applyReplication");
    let replicationStatus;
    try {
      replicationStatus = applyReplication(payload.replication, payload.serverTime, previousSnapshotSeq);
    } finally {
      endClientPerfProfile(replicationPerfMark);
    }

    if (replicationStatus === "resync") {
      const hasPendingOlderFullSnapshot = Array.from(stateChunks.keys()).some((pendingSeq) => pendingSeq < snapshotSeq);
      if (hasPendingOlderFullSnapshot) {
        return;
      }
      recordDebugEvent("snapshot_missing_entities", "Snapshot replication baseline mismatched and requested a resync", {
        severity: "error",
        ttlMs: 10_000,
        key: "snapshot_baseline_mismatch"
      });
      requestLifecycleResync("baseline_mismatch");
      return;
    }

    const frameNow = performance.now();
    const wallNow = Date.now();
    syncServerClock(payload.serverTime, frameNow);
    syncServerDebugSnapshot(payload.debug, wallNow);
    noteServerTickSample(payload.simulationTick, frameNow, payload.tickRate);
    if (
      (previousMatchPhase && nextMatchPhase && nextMatchPhase !== previousMatchPhase) ||
      (previousRoundNumber > 0 && nextRoundNumber > 0 && nextRoundNumber !== previousRoundNumber)
    ) {
      debugMonitor.lastKnownPlayers.clear();
      debugMonitor.knownBullets.clear();
      debugMonitor.lastVolleyByOwner.clear();
    }
    if (
      debugUiEnabled &&
      (
        payload.replication?.mode === "full" ||
        snapshotSeq % SNAPSHOT_DEBUG_SAMPLE_INTERVAL === 0
      )
    ) {
      noteSnapshotDebugState(payload, wallNow);
    }
    lastAppliedSnapshotSeq = snapshotSeq;
    lastSimulationTick = Number(payload.simulationTick) || lastSimulationTick;
    lastSnapshotTick = Number(payload.snapshotTick) || lastSnapshotTick;
    cleanupStaleStateChunks();
    lastSnapshotAt = frameNow;
    lastStatePacketAt = wallNow;
    if (socket?.readyState === WebSocket.OPEN) {
      setStatus("Connected");
    }
    latestMatch = payload.match ?? latestMatch;
    latestLobby = payload.lobby ?? latestLobby;
    latestObjective = payload.objective ?? latestObjective;
    latestLeaderboard = payload.leaderboard ?? latestLeaderboard;
    latestYou = payload.you ?? latestYou;
    latestInterestStats = payload.replication?.interest ?? latestInterestStats;

    if (payload.you && previousProcessedInputSeq > 0) {
      const processedSeqJump = Math.max(0, Number(payload.you.lastProcessedInputSeq ?? 0) - previousProcessedInputSeq);
      const processedInputWindowMs = Math.max(
        0,
        Number(payload.you.lastProcessedInputClientSentAt ?? 0) - Number(previousProcessedInputClientSentAt ?? 0)
      );
      const expectedSeqJump =
        processedInputWindowMs > 0
          ? Math.max(1, Math.ceil(processedInputWindowMs / getLocalInputDispatchMinIntervalMs()))
          : 1;
      const jumpAllowance = Math.max(4, Math.ceil((Number(latestLatencyMs) || 0) / 40));
      if (
        processedSeqJump >= DEBUG_MONITOR.inputSeqJumpWarning &&
        processedSeqJump > expectedSeqJump + jumpAllowance
      ) {
        recordDebugEvent(
          "last_processed_input_seq_jump",
          `LastProcessedInputSeq jumped by ${processedSeqJump}`,
          {
            severity: processedSeqJump >= DEBUG_MONITOR.inputSeqJumpWarning * 2 ? "error" : "warn",
            ttlMs: 8_000,
            key: "last_processed_input_seq_jump"
          }
        );
      }
    }

    if (replicationStatus !== "applied") {
      updateEntityMap(players, payload.players ?? [], { alive: true, ready: false }, {
        kind: "player",
        serverTime: payload.serverTime
      });
      updateEntityMap(bullets, payload.bullets ?? [], {}, {
        kind: "bullet",
        serverTime: payload.serverTime
      });
    }

    // Fallback for baseline or resync cases where shape replication was not applied.
    if (replicationStatus !== "applied" && payload.replication?.mode === "full" && Array.isArray(payload.shapes)) {
      const shapeIds = new Set(payload.shapes.map((s) => s.id));
      for (const [id, shape] of shapes.entries()) {
        if (!shapeIds.has(id)) {
          maybeSpawnShapeDeathParticles(shape);
          shapes.delete(id);
        }
      }
      updateEntityMap(shapes, payload.shapes, {}, {
        kind: REPLICATION_KINDS.SHAPE,
        serverTime: payload.serverTime
      });
    }

    // Update local XP/level state from 'you' field
    if (payload.you) {
      const prevUpgrades = localPendingUpgrades;
      const prevBasicSpecializationPending = localBasicSpecializationPending;
      localXp = payload.you.xp ?? localXp;
      localLevel = payload.you.level ?? localLevel;
      localPendingUpgrades = payload.you.pendingUpgrades ?? localPendingUpgrades;
      localBasicSpecializationPending = Boolean(payload.you.basicSpecializationPending);
      localBasicSpecializationChoice = payload.you.basicSpecializationChoice ?? null;
      localTankClassId = payload.you.tankClassId ?? localTankClassId;
      localStats = normalizeAllocatedStats(payload.you.stats, localStats);
      if (localPendingUpgrades.length > 0 && prevUpgrades.length === 0) {
        upgradeMenuOpen = true;
      }
      if (localBasicSpecializationPending && !prevBasicSpecializationPending && !localBasicSpecializationChoice) {
        basicSpecializationMenuOpen = true;
      }
      if (!localBasicSpecializationPending || localBasicSpecializationChoice) {
        basicSpecializationMenuOpen = false;
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
          estimateClientWallTimeForServerTime(payload.you.lastProcessedInputClientSentAt ?? 0),
          estimateClientWallTimeForServerTime(payload.serverTime)
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
  } finally {
    endClientPerfProfile(perfMark);
  }
}

function applyStateChunk(payload) {
  const snapshotSeq = Number(payload.snapshotSeq);

  if (!Number.isInteger(snapshotSeq) || snapshotSeq <= lastAppliedSnapshotSeq) {
    recordDebugEvent("snapshot_out_of_order", `Ignored stale snapshot chunk for ${snapshotSeq}`, {
      severity: "warn",
      ttlMs: 8_000,
      key: "snapshot_chunk_out_of_order"
    });
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
    recordDebugEvent("snapshot_data_invalid", "Snapshot chunk metadata was invalid or corrupt", {
      severity: "error",
      ttlMs: 10_000,
      key: "snapshot_chunk_invalid"
    });
    return;
  }

  const existing = stateChunks.get(snapshotSeq) ?? {
    chunkCount,
    receivedAt: Date.now(),
    chunks: new Array(chunkCount).fill(null)
  };

  if (existing.chunkCount !== chunkCount) {
    stateChunks.delete(snapshotSeq);
    recordDebugEvent("snapshot_data_invalid", "Snapshot chunk count changed mid-stream", {
      severity: "error",
      ttlMs: 10_000,
      key: "snapshot_chunk_mismatch"
    });
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
      recordDebugEvent("snapshot_data_invalid", "Rebuilt snapshot chunk payload was invalid", {
        severity: "error",
        ttlMs: 10_000,
        key: "snapshot_chunk_decode"
      });
      requestLifecycleResync("chunk_decode");
    }
  } catch (error) {
    console.warn("Failed to rebuild fragmented snapshot", error);
    recordDebugEvent("snapshot_data_invalid", "Snapshot chunk data failed to decode", {
      severity: "error",
      ttlMs: 10_000,
      key: "snapshot_chunk_decode_exception"
    });
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
    const objectiveText = getObjectiveStatusText(latestObjective);
    const ruleText = latestMatch.respawnsEnabled
      ? " | respawns on"
      : ` | first to ${latestMatch.scoreToWin}`;
    if (latestMatch.phaseEndsAt === null) {
      return `${latestMatch.message}${objectiveText}${spectatorSuffix}`;
    }
    return `${latestMatch.message} | ${secondsLeft}s left${ruleText}${objectiveText}${spectatorSuffix}`;
  }

  if (latestMatch.phase === MATCH_PHASES.OVERTIME) {
    const objectiveText = getObjectiveStatusText(latestObjective);
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

function refreshTimedUi(frameAt = performance.now(), force = false) {
  if (!force && frameAt - lastTimedUiRefreshAt < 96) {
    return;
  }

  lastTimedUiRefreshAt = frameAt;
  refreshDeathOverlay();
  setElementText(matchStatusElement, buildMatchStatusText());
  updateDiagnosticBanner();
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
  shapeParticles.length = 0;
  killFeedEntries.length = 0;
  renderKillFeed();
  lastResyncRequestAt = 0;
  cameraShakeX = 0;
  cameraShakeY = 0;
  resetDebugMonitorState({ keepEvents: isReconnect });

  if (socket) {
    socket.skipReconnect = true;
    socket.close();
  }

  localStorage.setItem(STORAGE_KEYS.name, nameInput.value);
  localStorage.setItem(STORAGE_KEYS.room, roomInput.value);
  localStorage.setItem(STORAGE_KEYS.spectate, spectateInput.checked ? "1" : "0");
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomInput.value || "default");
  if (debugUiEnabled) {
    url.searchParams.set("debug", "1");
  } else {
    url.searchParams.delete("debug");
  }
  window.history.replaceState({}, "", url);

  if (!isReconnect) {
    players.clear();
    bullets.clear();
    shapes.clear();
    predictedProjectiles.clear();
    pendingInputs.length = 0;
    nextInputSeq = 1;
    lastInputDispatchAt = 0;
    lastLocalInputChangedAt = 0;
    lastAimInputChangedAt = 0;
    lastDispatchedInputState = null;
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
    serverWallTimeOffset = 0;
    lastStallWarningAt = 0;
    latestLatencyMs = 0;
    lastServerMessageAt = 0;
    lastRenderFrameAt = performance.now();
    lastTimedUiRefreshAt = 0;
    resetDebugMonitorState();
    localXp = 0;
    displayXp = 0;
    localLevel = 1;
    localPendingUpgrades = [];
    localBasicSpecializationPending = false;
    localBasicSpecializationChoice = null;
    localTankClassId = "basic";
    localStats = createEmptyAllocatedStats();
    upgradeMenuOpen = false;
    basicSpecializationMenuOpen = false;
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
    shapeParticles.length = 0;
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
      debugHud: debugUiEnabled,
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
      recordDebugEvent(
        "snapshot_data_invalid",
        `Received invalid packet data (${parsed.error.code ?? "parse_error"})`,
        {
          severity: "error",
          ttlMs: 10_000,
          key: "invalid_packet_from_server"
        }
      );
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
      if (payload.isSpectator) {
        resetCameraAnchor();
        cameraZoom = clampSpectatorZoom(isReconnect ? cameraZoom : getSpectatorCameraDefaultZoom());
      }
      updateSessionChrome();
      refreshLobbyUi(null, latestYou);
      if (payload.isSpectator) {
        setStatus(
          payload.queuedForSlot
            ? "Connected as spectator, queued for a player slot. Free cam is live: move with WASD or Arrows and zoom with the mouse wheel."
            : "Connected as spectator. Free cam is live: move with WASD or Arrows and zoom with the mouse wheel."
        );
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
      const rtt = notePong(Number(payload.sentAt), Date.now());
      if (Number.isFinite(rtt)) {
        latestLatencyMs = rtt;
        latencyElement.textContent = `${latestLatencyMs} ms`;
      }
      return;
    }

    if (payload.type === MESSAGE_TYPES.ERROR) {
      recordDebugEvent(
        payload.code ?? "server_error",
        payload.message,
        {
          severity: payload.code === "input_rate_limit" || payload.code === "anti_cheat_violation" ? "error" : "warn",
          ttlMs: 10_000,
          key: `server_error:${payload.code ?? payload.message}`
        }
      );
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
      lastInputDispatchAt = 0;
      lastLocalInputChangedAt = 0;
      lastAimInputChangedAt = 0;
      lastDispatchedInputState = null;
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
      lastInputDispatchAt = 0;
      lastLocalInputChangedAt = 0;
      lastAimInputChangedAt = 0;
      lastDispatchedInputState = null;
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
    serverWallTimeOffset = 0;
    lastTimedUiRefreshAt = 0;
    resetDebugMonitorState();
    stateChunks.clear();
    processedEventIds.clear();
    processedEventOrder.length = 0;
    lastScoreboardRenderKey = "";
    lastResultsRenderKey = "";
    renderScoreboard([]);
    combatEffects.length = 0;
    shapeParticles.length = 0;
    killFeedEntries.length = 0;
    renderKillFeed();
    pendingInputs.length = 0;
    lastInputDispatchAt = 0;
    lastLocalInputChangedAt = 0;
    lastAimInputChangedAt = 0;
    lastDispatchedInputState = null;
    lastStallWarningAt = 0;
    localXp = 0;
    displayXp = 0;
    localLevel = 1;
    localPendingUpgrades = [];
    localBasicSpecializationPending = false;
    localBasicSpecializationChoice = null;
    localTankClassId = "basic";
    localStats = createEmptyAllocatedStats();
    upgradeMenuOpen = false;
    basicSpecializationMenuOpen = false;
    camera.x = 0;
    camera.y = 0;
    cameraNeedsSnap = true;
    cameraShakeX = 0;
    cameraShakeY = 0;
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
  // Decay correction offsets faster so reconciliation rubber-banding resolves in ~150ms
  // instead of ~500ms, giving cleaner feel after server corrections.
  const correctionDecay = clamp(1 - Math.exp(-18 * deltaSeconds), 0.12, 0.42);
  // Frame-rate-independent remote player smoothing: k=42 is equivalent to the old 0.52
  // constant at 60fps but remains consistent at 30fps, 120fps, 144fps, etc.
  const remoteFollowAmount = clamp(1 - Math.exp(-42 * deltaSeconds), 0.12, 0.72);
  const renderServerTime = estimateServerTime(frameAt) - getRemoteInterpolationBackTimeMs();

  for (const player of players.values()) {
    const previousDisplayX = getPlayerVisualX(player);
    const previousDisplayY = getPlayerVisualY(player);

    if (player.id === localPlayerId && canSimulateLocalPlayer()) {
      // Local player position/angle is driven by updateResponsiveLocalPrediction and
      // replayPendingInputs — no lerp needed here. Just decay the server-correction
      // offsets so reconciliation artifacts blend out, then apply them to displayX/Y.
      player.correctionOffsetX = lerp(player.correctionOffsetX ?? 0, 0, correctionDecay);
      player.correctionOffsetY = lerp(player.correctionOffsetY ?? 0, 0, correctionDecay);
      player.correctionOffsetAngle = lerpAngle(player.correctionOffsetAngle ?? 0, 0, correctionDecay);
      player.correctionOffsetTurretAngle = lerpAngle(
        player.correctionOffsetTurretAngle ?? 0,
        0,
        correctionDecay
      );
      player.displayX = (player.renderX ?? player.x) + (player.correctionOffsetX ?? 0);
      player.displayY = (player.renderY ?? player.y) + (player.correctionOffsetY ?? 0);
      player.displayAngle = (player.renderAngle ?? player.angle) + (player.correctionOffsetAngle ?? 0);
      player.displayTurretAngle =
        (player.renderTurretAngle ?? player.turretAngle) + (player.correctionOffsetTurretAngle ?? 0);
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
        player.renderX = lerp(player.renderX ?? sample.x, sample.x, remoteFollowAmount);
        player.renderY = lerp(player.renderY ?? sample.y, sample.y, remoteFollowAmount);
        player.renderAngle = lerpAngle(
          player.renderAngle ?? sample.angle,
          sample.angle,
          remoteFollowAmount
        );
        player.renderTurretAngle = lerpAngle(
          player.renderTurretAngle ?? sample.turretAngle,
          sample.turretAngle,
          remoteFollowAmount
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

  const shapeFollowAmount = clamp(1 - Math.exp(-9 * deltaSeconds), 0.12, 0.38);
  const shapeAngleSmoothing = clamp(1 - Math.exp(-6 * deltaSeconds), 0.08, 0.4);
  for (const shape of shapes.values()) {
    const sample = sampleNetworkHistory(shape, REPLICATION_KINDS.SHAPE, renderServerTime) ?? {
      x: shape.x,
      y: shape.y,
      angle: shape.angle ?? 0,
      speed: 0
    };
    const currentShapeX = shape.renderX ?? shape.x;
    const currentShapeY = shape.renderY ?? shape.y;
    const dx = sample.x - currentShapeX;
    const dy = sample.y - currentShapeY;
    const shouldSnap =
      (shape.teleportFrames ?? 0) > 0 ||
      dx * dx + dy * dy > NETWORK_RENDER.snapDistance * NETWORK_RENDER.snapDistance;

    if (shouldSnap) {
      shape.renderX = sample.x;
      shape.renderY = sample.y;
    } else {
      shape.renderX = lerp(currentShapeX, sample.x, shapeFollowAmount);
      shape.renderY = lerp(currentShapeY, sample.y, shapeFollowAmount);
    }

    shape.renderAngle = lerpAngle(shape.renderAngle ?? sample.angle, sample.angle, shapeAngleSmoothing);
    shape.displayX = shape.renderX;
    shape.displayY = shape.renderY;
    shape.teleportFrames = Math.max(0, (shape.teleportFrames ?? 0) - 1);
  }

  for (const bullet of bullets.values()) {
    const sample = sampleNetworkHistory(bullet, "bullet", renderServerTime) ?? {
      x: bullet.x,
      y: bullet.y,
      angle: bullet.angle,
      speed: bullet.speed ?? GAME_CONFIG.bullet.speed
    };
    const currentBulletX = bullet.renderX ?? bullet.x;
    const currentBulletY = bullet.renderY ?? bullet.y;
    const handoffOffsetX = bullet.handoffOffsetX ?? 0;
    const handoffOffsetY = bullet.handoffOffsetY ?? 0;
    const targetBulletX = sample.x + handoffOffsetX;
    const targetBulletY = sample.y + handoffOffsetY;
    const dx = targetBulletX - currentBulletX;
    const dy = targetBulletY - currentBulletY;
    // Frame-rate-independent bullet tracking: k=70 gives fast convergence
    // (~50ms) that is consistent across 30/60/120/144fps.
    const bulletFollowAmount = clamp(1 - Math.exp(-70 * deltaSeconds), 0.25, 0.88);
    const shouldSnap =
      (bullet.teleportFrames ?? 0) > 0 ||
      dx * dx + dy * dy > NETWORK_RENDER.snapDistance * NETWORK_RENDER.snapDistance;

    bullet.previousRenderX = currentBulletX;
    bullet.previousRenderY = currentBulletY;
    if (shouldSnap) {
      bullet.renderX = targetBulletX;
      bullet.renderY = targetBulletY;
      bullet.renderAngle = sample.angle;
    } else {
      bullet.renderX = lerp(currentBulletX, targetBulletX, bulletFollowAmount);
      bullet.renderY = lerp(currentBulletY, targetBulletY, bulletFollowAmount);
      bullet.renderAngle = lerpAngle(bullet.renderAngle ?? bullet.angle, sample.angle, bulletFollowAmount);
    }
    bullet.renderSpeed = sample.speed ?? bullet.speed ?? GAME_CONFIG.bullet.speed;

    if (handoffOffsetX !== 0 || handoffOffsetY !== 0) {
      const handoffDecay = clamp(
        1 - Math.exp(-LOCAL_PROJECTILE_HANDOFF.settleRate * deltaSeconds),
        0.16,
        0.5
      );
      bullet.handoffOffsetX = lerp(handoffOffsetX, 0, handoffDecay);
      bullet.handoffOffsetY = lerp(handoffOffsetY, 0, handoffDecay);
      if (Math.hypot(bullet.handoffOffsetX, bullet.handoffOffsetY) < 0.5) {
        bullet.handoffOffsetX = 0;
        bullet.handoffOffsetY = 0;
      }
    }

    bullet.teleportFrames = Math.max(0, (bullet.teleportFrames ?? 0) - 1);
  }
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
}

function drawCenterProbe() {
  // Hidden while we isolate the local player's movement view.
}

function drawGrid(viewport = getVisibleViewportSize()) {
  const theme = getActiveMapLayout().theme;
  const gridColor = theme?.gridMinor ?? "rgba(122, 128, 136, 0.34)";
  const cellSize = 40;
  const lineWidth = Math.max(1.8 / cameraZoom, 1.4);
  const startX = Math.max(0, Math.floor(camera.x / cellSize) * cellSize - cellSize);
  const endX = Math.min(GAME_CONFIG.world.width, camera.x + viewport.width + cellSize);
  const startY = Math.max(0, Math.floor(camera.y / cellSize) * cellSize - cellSize);
  const endY = Math.min(GAME_CONFIG.world.height, camera.y + viewport.height + cellSize);

  context.save();
  context.lineWidth = lineWidth;
  context.strokeStyle = gridColor;
  context.beginPath();

  for (let x = startX; x <= endX; x += cellSize) {
    context.moveTo(x, startY);
    context.lineTo(x, endY);
  }

  for (let y = startY; y <= endY; y += cellSize) {
    context.moveTo(startX, y);
    context.lineTo(endX, y);
  }

  context.stroke();
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
  const zones = getObjectiveZones(latestObjective);
  if (zones.length === 0) {
    return;
  }

  const ringWidth = Math.max(5 / cameraZoom, 2.5);

  context.save();
  context.globalAlpha = 0.92;

  for (const zone of zones) {
    const ownerColor = getObjectiveTeamColor(zone.ownerTeamId, "#ffd166");
    const captureColor = getObjectiveTeamColor(zone.captureTargetTeamId, "#a5f3fc");
    const progress = clamp(zone.captureProgress ?? 0, 0, 1);
    const isCapturing =
      Boolean(zone.captureTargetTeamId) &&
      (zone.ownerTeamId !== zone.captureTargetTeamId || progress < 1);

    context.fillStyle = zone.ownerTeamId ? colorWithAlpha(ownerColor, 0.18) : NEUTRAL_OBJECTIVE_COLORS.fill;
    context.beginPath();
    context.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.lineWidth = ringWidth;
    context.strokeStyle = zone.contested
      ? "rgba(255, 209, 102, 0.95)"
      : zone.ownerTeamId
        ? colorWithAlpha(ownerColor, 0.92)
        : NEUTRAL_OBJECTIVE_COLORS.ring;
    context.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
    context.stroke();

    if (progress > 0 && isCapturing) {
      context.beginPath();
      context.lineWidth = Math.max(8 / cameraZoom, 4);
      context.strokeStyle = captureColor;
      context.arc(zone.x, zone.y, zone.radius + 11 / cameraZoom, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      context.stroke();
    }

    context.fillStyle = zone.ownerTeamId ? ownerColor : NEUTRAL_OBJECTIVE_COLORS.core;
    context.beginPath();
    context.arc(zone.x, zone.y, zone.radius * 0.3, 0, Math.PI * 2);
    context.fill();

    context.font = `${Math.max(13 / cameraZoom, 8)}px Segoe UI`;
    context.textAlign = "center";
    context.fillStyle = zone.ownerTeamId ? "#10243b" : NEUTRAL_OBJECTIVE_COLORS.coreLabel;
    context.fillText((zone.slot?.[0] ?? "O").toUpperCase(), zone.x, zone.y + 4 / cameraZoom);

    context.font = `${Math.max(15 / cameraZoom, 9)}px Segoe UI`;
    context.fillStyle = zone.contested ? "#ffd166" : zone.ownerTeamId ? "#ffffff" : NEUTRAL_OBJECTIVE_COLORS.label;
    context.fillText(
      zone.contested
        ? "Contested"
        : zone.ownerTeamName
          ? zone.ownerTeamName
          : zone.captureTargetTeamName
            ? `Capturing ${zone.captureTargetTeamName}`
            : "Neutral",
      zone.x,
      zone.y - zone.radius - 16 / cameraZoom
    );

    if (isCapturing) {
      const remainingSeconds = Math.max(0, Math.ceil((1 - progress) * GAME_CONFIG.objective.captureSeconds));
      context.font = `${Math.max(11 / cameraZoom, 7)}px Segoe UI`;
      context.fillStyle = captureColor;
      context.fillText(`${remainingSeconds}s`, zone.x, zone.y + zone.radius + 18 / cameraZoom);
    }
  }
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

function getLobbyClassRenderProfile(lobbyClassId, bodyRadius) {
  const bodyStyle = getLobbyClassProfile(lobbyClassId)?.bodyStyle === "rectangle" ? "rectangle" : "round";
  const barrelLengthMultiplier = getLobbyClassMultiplier(lobbyClassId, "barrelLengthMultiplier", 1);
  const turretScale = getLobbyClassMultiplier(lobbyClassId, "turretScale", 1);

  if (bodyStyle === "rectangle") {
    const bodyWidth = bodyRadius * 3.2;
    const bodyHeight = bodyRadius * 2.05;
    return {
      bodyStyle,
      barrelLengthMultiplier,
      barrelHeightMultiplier: 1.12,
      turretScale,
      bodyWidth,
      bodyHeight,
      bodyCornerRadius: bodyRadius * 0.34,
      verticalExtent: bodyHeight * 0.5,
      shieldRadius: Math.hypot(bodyWidth * 0.5, bodyHeight * 0.5) + 10,
      turretWidth: bodyRadius * 1.72 * turretScale,
      turretHeight: bodyRadius * 0.92 * turretScale,
      turretOffsetX: bodyRadius * 0.22
    };
  }

  return {
    bodyStyle,
    barrelLengthMultiplier,
    barrelHeightMultiplier: 1,
    turretScale,
    verticalExtent: bodyRadius,
    shieldRadius: bodyRadius + 14,
    turretWidth: bodyRadius * 0.92 * turretScale,
    turretHeight: bodyRadius * 0.62 * turretScale,
    turretOffsetX: 0
  };
}

function drawTankTurretBase(x, y, turretAngle, renderProfile, alpha) {
  if (!renderProfile || (renderProfile.bodyStyle !== "rectangle" && renderProfile.turretScale <= 1.02)) {
    return;
  }

  context.save();
  context.globalAlpha = alpha;
  context.translate(x, y);
  context.rotate(turretAngle);
  context.translate(renderProfile.turretOffsetX ?? 0, 0);
  context.fillStyle = "#d9e2ec";
  context.strokeStyle = "#1a1a2e";
  context.lineWidth = 2;

  if (renderProfile.bodyStyle === "rectangle") {
    const turretWidth = renderProfile.turretWidth;
    const turretHeight = renderProfile.turretHeight;
    context.beginPath();
    context.roundRect(
      -turretWidth * 0.48,
      -turretHeight * 0.5,
      turretWidth,
      turretHeight,
      turretHeight * 0.34
    );
    context.fill();
    context.stroke();
  } else {
    const turretRadius = Math.max(8, renderProfile.turretWidth * 0.5);
    context.beginPath();
    context.arc(0, 0, turretRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  context.restore();
}

function drawTank(player, pose = getTankRenderPose(player), frameNow = performance.now()) {
  if (!player || player.isSpectator || !player.alive) {
    return;
  }

  const x = pose.x;
  const y = pose.y;
  const bodyAngle = pose.angle;
  const turretAngle = pose.turretAngle;
  const bodyRadius = getPlayerBodyRadius(player);
  const isLocalPlayer = player.id === localPlayerId;
  const lobbyClassId = getDisplayedLobbyClassId(player);
  const renderProfile = getLobbyClassRenderProfile(lobbyClassId, bodyRadius);
  const visualVerticalExtent = renderProfile.verticalExtent ?? bodyRadius;
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
    const bLen = getRenderedBarrelLength(barrel, renderProfile.barrelLengthMultiplier ?? 1);
    const bH = (barrel.h ?? 0) * (renderProfile.barrelHeightMultiplier ?? 1);
    const bx = barrel.x > 0 ? 0 : barrel.x - bLen / 2;
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
  if (renderProfile.bodyStyle === "rectangle") {
    context.beginPath();
    context.roundRect(
      -renderProfile.bodyWidth / 2,
      -renderProfile.bodyHeight / 2,
      renderProfile.bodyWidth,
      renderProfile.bodyHeight,
      renderProfile.bodyCornerRadius
    );
    context.fill();
  } else {
    context.beginPath();
    context.arc(0, 0, bodyRadius, 0, Math.PI * 2);
    context.fill();
  }
  context.lineWidth = 3;
  context.strokeStyle = "#1a1a2e";
  context.stroke();
  context.restore();

  drawTankTurretBase(x, y, turretAngle, renderProfile, alpha);

  const shieldRemainingMs = player.combat?.shieldRemainingMs ?? 0;
  if (shieldRemainingMs > 0) {
    const shieldPulse = 1 + Math.sin(frameNow / 140) * 0.04;
    const shieldRadius = (renderProfile.shieldRadius ?? (bodyRadius + 14)) * shieldPulse;
    context.save();
    context.globalAlpha = Math.min(alpha, 0.9);
    context.translate(x, y);
    context.fillStyle = "rgba(103, 183, 255, 0.12)";
    context.beginPath();
    context.arc(0, 0, shieldRadius, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = "rgba(142, 217, 255, 0.95)";
    context.beginPath();
    context.arc(0, 0, shieldRadius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  if (!isLocalPlayer) {
    // Remote player names stay above their tanks; the local player's name is drawn near the XP bar.
    context.save();
    context.globalAlpha = alpha;
    context.font = "bold 12px Segoe UI";
    context.textAlign = "center";
    context.fillStyle = "#ffffff";
    context.fillText(player.name ?? "", x, y - visualVerticalExtent - 22);
    context.restore();
  }

  // Health bar
  const hpRatio = clamp((Number(player.displayHp ?? player.hp) || 0) / Math.max(1, Number(player.maxHp) || GAME_CONFIG.tank.hitPoints), 0, 1);
  const healthBarWidth = 52;
  const healthBarHeight = 7;
  const healthBarY = isLocalPlayer ? y + visualVerticalExtent + 10 : y - visualVerticalExtent - 16;
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
  const trailDx = x - prevX;
  const trailDy = y - prevY;
  if (trailDx * trailDx + trailDy * trailDy > 1) {
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

function drawCombatEffects(now = performance.now(), viewport = null) {
  pruneCombatEffects(now);

  for (const effect of combatEffects) {
    const life = Math.max(0, (effect.expiresAt - now) / 700);
    if (life <= 0) {
      continue;
    }

    if (viewport && !isWorldCircleVisible(effect.x, effect.y, 36, 40, viewport)) {
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

const SHAPE_VISUALS = Object.freeze({
  triangle: Object.freeze({ sides: 3, fillColor: "#00d4aa" }),
  square: Object.freeze({ sides: 4, fillColor: "#ffb703" }),
  pentagon: Object.freeze({ sides: 5, fillColor: "#4488ff" }),
  alpha_pentagon: Object.freeze({ sides: 5, fillColor: "#aa44ff" })
});

function getShapeVisualDefinition(shapeType) {
  return SHAPE_VISUALS[shapeType] ?? SHAPE_VISUALS.square;
}

function traceRegularPolygon(renderContext, sides, radius) {
  renderContext.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) {
      renderContext.moveTo(x, y);
    } else {
      renderContext.lineTo(x, y);
    }
  }
  renderContext.closePath();
}

function getOrCreateShapeSprite(shapeType, radius) {
  const safeRadius = Math.max(1, Math.round(radius));
  const cacheKey = `${shapeType}:${safeRadius}`;
  const cached = shapeSpriteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const spriteSize = Math.ceil(safeRadius * 2 + 12);
  const resolution = 2;
  const spriteCanvas = document.createElement("canvas");
  spriteCanvas.width = spriteSize * resolution;
  spriteCanvas.height = spriteSize * resolution;
  const spriteContext = spriteCanvas.getContext("2d");
  if (!spriteContext) {
    return null;
  }

  const { sides, fillColor } = getShapeVisualDefinition(shapeType);
  spriteContext.scale(resolution, resolution);
  spriteContext.translate(spriteSize / 2, spriteSize / 2);
  traceRegularPolygon(spriteContext, sides, safeRadius);
  spriteContext.fillStyle = fillColor;
  spriteContext.fill();
  spriteContext.lineWidth = 2.5;
  spriteContext.strokeStyle = "#1a1a2e";
  spriteContext.stroke();

  const sprite = {
    canvas: spriteCanvas,
    size: spriteSize
  };
  shapeSpriteCache.set(cacheKey, sprite);
  return sprite;
}

function isWorldCircleVisible(x, y, radius, padding = 0, viewport = getVisibleViewportSize()) {
  const left = camera.x - padding;
  const top = camera.y - padding;
  const right = camera.x + viewport.width + padding;
  const bottom = camera.y + viewport.height + padding;
  return x + radius >= left && x - radius <= right && y + radius >= top && y - radius <= bottom;
}

function drawShape(shape) {
  if (!shape) {
    return;
  }

  // Called inside the camera-transform context (world coordinates)
  const sx = shape.renderX ?? shape.x;
  const sy = shape.renderY ?? shape.y;
  const r = shape.radius ?? 20;
  const { sides, fillColor } = getShapeVisualDefinition(shape.type);
  const sprite = getOrCreateShapeSprite(shape.type, r);

  context.save();
  context.translate(sx, sy);
  context.rotate(shape.renderAngle ?? shape.angle ?? 0);
  if (sprite) {
    context.drawImage(sprite.canvas, -sprite.size / 2, -sprite.size / 2, sprite.size, sprite.size);
  } else {
    traceRegularPolygon(context, sides, r);
    context.fillStyle = fillColor;
    context.fill();
    context.lineWidth = 2.5;
    context.strokeStyle = "#1a1a2e";
    context.stroke();
  }
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
  const viewport = getVisibleViewportSize();
  for (const shape of shapes.values()) {
    const sx = shape.renderX ?? shape.x;
    const sy = shape.renderY ?? shape.y;
    const r = shape.radius ?? 20;
    if (!isWorldCircleVisible(sx, sy, r, 64, viewport)) {
      continue;
    }
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

function maybeSpawnShapeDeathParticles(shape) {
  if (!shape) {
    return;
  }

  const x = shape.renderX ?? shape.x;
  const y = shape.renderY ?? shape.y;
  const radius = shape.radius ?? 20;
  if (!isWorldCircleVisible(x, y, radius, 96)) {
    return;
  }

  spawnShapeDeathParticles(shape);
}

function drawShapeParticles(now, viewport = null) {
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
    const renderedSize = p.size * (1 - life * 0.3);
    if (viewport && !isWorldCircleVisible(px, py, renderedSize * 0.75, 40, viewport)) {
      continue;
    }

    context.save();
    context.globalAlpha = alpha;
    context.translate(px, py);
    context.rotate(rotation);
    context.fillStyle = p.color;
    context.strokeStyle = "rgba(0,0,0,0.3)";
    context.lineWidth = 1.2;
    context.beginPath();
    context.rect(-renderedSize / 2, -renderedSize / 2, renderedSize, renderedSize);
    context.fill();
    context.stroke();
    context.restore();
  }
}

function drawXpBar() {
  if (!currentRoomId) {
    return;
  }
  const baseBarWidth = Math.min(600, canvas.width * 0.6);
  const barWidth = baseBarWidth / 3;
  const barHeight = 20;
  const barX = (canvas.width - barWidth) / 2;
  const barY = canvas.height - barHeight - 10;

  const currentLevelXp = XP_PER_LEVEL[localLevel - 1] ?? 0;
  const nextLevelXp = XP_PER_LEVEL[localLevel] ?? XP_PER_LEVEL[XP_PER_LEVEL.length - 1];
  const xpIntoLevel = displayXp - currentLevelXp;
  const xpNeeded = Math.max(1, nextLevelXp - currentLevelXp);
  const xpRatio = localLevel >= MAX_LEVEL ? 1 : clamp(xpIntoLevel / xpNeeded, 0, 1);
  const classDef = getLocalTankClassDef();
  const localPlayerName = getLocalPlayer()?.name ?? nameInput?.value?.trim() ?? "Player";

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
  // HUD labels
  context.textAlign = "center";
  context.font = "bold 13px Segoe UI";
  context.lineWidth = 3;
  context.strokeStyle = "rgba(255,255,255,0.85)";
  context.strokeText(localPlayerName, barX + barWidth / 2, barY - 24);
  context.fillStyle = "#000000";
  context.fillText(localPlayerName, barX + barWidth / 2, barY - 24);

  // Bar text
  context.font = "bold 10px Segoe UI";
  context.fillStyle = "#ffffff";
  context.textAlign = "left";
  context.fillText(`Lv ${localLevel}`, barX + 6, barY + 13);
  context.textAlign = "center";
  context.fillText(classDef.name, barX + barWidth / 2, barY + 13);
  context.textAlign = "right";
  if (localLevel < MAX_LEVEL) {
    context.fillText(`${Math.round(xpRatio * 100)}%`, barX + barWidth - 6, barY + 13);
  } else {
    context.fillText("MAX", barX + barWidth - 6, barY + 13);
  }
  context.restore();
}

function getOrCreateMinimapBackground(mapLayout, panelSize) {
  const cacheKey = `${mapLayout?.id ?? "default"}:${panelSize}`;
  if (minimapBackgroundCache.key === cacheKey && minimapBackgroundCache.canvas) {
    return minimapBackgroundCache.canvas;
  }

  const cacheCanvas = document.createElement("canvas");
  cacheCanvas.width = panelSize;
  cacheCanvas.height = panelSize;
  const cacheContext = cacheCanvas.getContext("2d");
  if (!cacheContext) {
    return null;
  }

  const mapInset = 8;
  const mapRadius = 20;
  const mapX = mapInset;
  const mapY = mapInset;
  const mapSize = panelSize - mapInset * 2;
  const projectX = (worldX) => (clamp(worldX, 0, GAME_CONFIG.world.width) / GAME_CONFIG.world.width) * mapSize + mapX;
  const projectY = (worldY) => (clamp(worldY, 0, GAME_CONFIG.world.height) / GAME_CONFIG.world.height) * mapSize + mapY;

  cacheContext.save();
  cacheContext.beginPath();
  cacheContext.roundRect(mapX, mapY, mapSize, mapSize, mapRadius);
  cacheContext.clip();

  for (const team of GAME_CONFIG.lobby.teams) {
    const zone = getTeamSpawnZone(team.id);
    const zoneLeft = projectX(zone.left);
    const zoneRight = projectX(zone.right);
    cacheContext.fillStyle = zone.zoneColor.replace(/0\.\d+\)/, "0.28)");
    cacheContext.fillRect(zoneLeft, mapY, Math.max(1, zoneRight - zoneLeft), mapSize);
  }

  for (const obstacle of mapLayout?.obstacles ?? []) {
    const obstacleX = projectX(obstacle.x);
    const obstacleY = projectY(obstacle.y);
    const obstacleWidth = (obstacle.width / GAME_CONFIG.world.width) * mapSize;
    const obstacleHeight = (obstacle.height / GAME_CONFIG.world.height) * mapSize;
    cacheContext.fillStyle = "rgba(49, 62, 95, 0.55)";
    cacheContext.fillRect(obstacleX, obstacleY, obstacleWidth, obstacleHeight);
  }
  cacheContext.restore();

  cacheContext.strokeStyle = "rgba(255,255,255,0.24)";
  cacheContext.lineWidth = 1.5;
  cacheContext.beginPath();
  cacheContext.roundRect(mapX, mapY, mapSize, mapSize, mapRadius);
  cacheContext.stroke();

  minimapBackgroundCache = {
    key: cacheKey,
    canvas: cacheCanvas
  };
  return cacheCanvas;
}

function drawMinimap() {
  if (!currentRoomId) {
    return;
  }

  const mapLayout = getActiveMapLayout();
  const panelSize = Math.round(clamp(Math.min(canvas.width, canvas.height) * 0.2, 140, 190));
  const panelX = canvas.width - panelSize - 14;
  const panelY = canvas.height - panelSize - 14;
  const mapInset = 8;
  const mapRadius = 20;
  const mapX = panelX + mapInset;
  const mapY = panelY + mapInset;
  const mapSize = panelSize - mapInset * 2;
  const viewport = getVisibleViewportSize();
  const backgroundCanvas = getOrCreateMinimapBackground(mapLayout, panelSize);

  const projectX = (worldX) => mapX + (clamp(worldX, 0, GAME_CONFIG.world.width) / GAME_CONFIG.world.width) * mapSize;
  const projectY = (worldY) => mapY + (clamp(worldY, 0, GAME_CONFIG.world.height) / GAME_CONFIG.world.height) * mapSize;

  context.save();
  if (backgroundCanvas) {
    context.drawImage(backgroundCanvas, panelX, panelY);
  }

  context.beginPath();
  context.roundRect(mapX, mapY, mapSize, mapSize, mapRadius);
  context.clip();

  for (const zone of getObjectiveZones(latestObjective)) {
    const teamColor = getObjectiveTeamColor(zone.ownerTeamId, "#ffd166");
    context.fillStyle = zone.ownerTeamId ? colorWithAlpha(teamColor, 0.24) : NEUTRAL_OBJECTIVE_COLORS.minimapFill;
    context.strokeStyle = zone.ownerTeamId ? teamColor : NEUTRAL_OBJECTIVE_COLORS.minimapStroke;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(projectX(zone.x), projectY(zone.y), 4.5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

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
  const viewWidth = (viewport.width / GAME_CONFIG.world.width) * mapSize;
  const viewHeight = (viewport.height / GAME_CONFIG.world.height) * mapSize;
  context.strokeStyle = "rgba(255,255,255,0.75)";
  context.lineWidth = 1;
  context.strokeRect(viewX, viewY, viewWidth, viewHeight);

  context.restore();
  context.save();
  context.strokeStyle = "rgba(255,255,255,0.28)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(mapX, mapY, mapSize, mapSize, mapRadius);
  context.stroke();
  context.restore();
}

function drawCanvasKillFeed() {
  if (killFeedEntries.length === 0) {
    return;
  }

  const now = performance.now();
  const feedX = 14;
  let feedY = getTopLeftHudInset();
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
  if (
    basicSpecializationMenuOpen &&
    localBasicSpecializationPending &&
    !localBasicSpecializationChoice
  ) {
    upgradeButtonRects.length = 0;
    return;
  }

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

function drawBasicSpecializationMenu() {
  if (
    !basicSpecializationMenuOpen ||
    !localBasicSpecializationPending ||
    localBasicSpecializationChoice ||
    localTankClassId !== "basic"
  ) {
    basicSpecializationButtonRects.length = 0;
    return;
  }

  basicSpecializationButtonRects.length = 0;

  const cw = canvas.width;
  const ch = canvas.height;
  const stackedLayout = cw < 920;
  const cardW = stackedLayout ? Math.min(420, cw - 32) : Math.min(940, cw - 48);
  const tabGap = stackedLayout ? 12 : 16;
  const tabCount = BASIC_SPECIALIZATION_MENU_OPTIONS.length;
  const tabW = stackedLayout ? cardW - 48 : (cardW - 48 - tabGap * (tabCount - 1)) / tabCount;
  const tabH = stackedLayout ? 84 : 104;
  const cardH = stackedLayout ? 100 + tabCount * tabH + (tabCount - 1) * tabGap + 28 : 236;
  const cardX = (cw - cardW) / 2;
  const cardY = (ch - cardH) / 2;
  const innerX = cardX + 24;
  const tabY = cardY + 90;

  context.save();
  context.fillStyle = "rgba(4, 8, 18, 0.18)";
  context.fillRect(0, 0, cw, ch);

  context.fillStyle = "rgba(10, 18, 38, 0.72)";
  context.beginPath();
  context.roundRect(cardX, cardY, cardW, cardH, 18);
  context.fill();
  context.strokeStyle = "rgba(170, 210, 255, 0.3)";
  context.lineWidth = 1.25;
  context.stroke();

  context.textAlign = "center";
  context.font = "bold 24px Segoe UI";
  context.fillStyle = "#f8fbff";
  context.fillText("Basic Lv 5 Choice", cw / 2, cardY + 40);
  context.font = "14px Segoe UI";
  context.fillStyle = "rgba(220, 236, 255, 0.92)";
  context.fillText("Pick one reward", cw / 2, cardY + 64);

  for (let index = 0; index < BASIC_SPECIALIZATION_MENU_OPTIONS.length; index += 1) {
    const option = BASIC_SPECIALIZATION_MENU_OPTIONS[index];
    const tabX = innerX + (stackedLayout ? 0 : index * (tabW + tabGap));
    const currentTabY = tabY + (stackedLayout ? index * (tabH + tabGap) : 0);

    context.fillStyle = `${option.accent}22`;
    context.beginPath();
    context.roundRect(tabX, currentTabY, tabW, tabH, 14);
    context.fill();
    context.strokeStyle = `${option.accent}aa`;
    context.lineWidth = 1.5;
    context.stroke();

    context.textAlign = "left";
    context.font = "bold 18px Segoe UI";
    context.fillStyle = "#ffffff";
    context.fillText(option.title, tabX + 18, currentTabY + 28);
    context.font = "13px Segoe UI";
    context.fillStyle = "rgba(232, 241, 255, 0.92)";
    context.fillText(option.description, tabX + 18, currentTabY + 52, tabW - 36);
    context.font = "bold 12px Segoe UI";
    context.fillStyle = option.accent;
    context.fillText("Click to choose", tabX + 18, currentTabY + tabH - 14);

    basicSpecializationButtonRects[index] = {
      x: tabX,
      y: currentTabY,
      w: tabW,
      h: tabH,
      specializationId: option.specializationId
    };
  }

  context.restore();
}

const upgradeButtonRects = [];
function handleBasicSpecializationClick(canvasX, canvasY) {
  if (!basicSpecializationMenuOpen) {
    return false;
  }

  for (const btn of basicSpecializationButtonRects) {
    if (!btn) {
      continue;
    }

    if (canvasX >= btn.x && canvasX <= btn.x + btn.w && canvasY >= btn.y && canvasY <= btn.y + btn.h) {
      sendReliable({ type: MESSAGE_TYPES.SPECIALIZATION, specializationId: btn.specializationId });
      localBasicSpecializationPending = false;
      localBasicSpecializationChoice = btn.specializationId;
      basicSpecializationMenuOpen = false;
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

function formatDebugAgeMs(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return "-";
  }

  if (normalized < 1000) {
    return `${Math.round(normalized)}ms`;
  }

  if (normalized < 10_000) {
    return `${(normalized / 1000).toFixed(1)}s`;
  }

  return `${Math.round(normalized / 100) / 10}s`;
}

function getSocketReadyStateLabel(target = socket) {
  switch (target?.readyState) {
    case WebSocket.CONNECTING:
      return "connecting";
    case WebSocket.OPEN:
      return "open";
    case WebSocket.CLOSING:
      return "closing";
    case WebSocket.CLOSED:
      return "closed";
    default:
      return "idle";
  }
}

function getReliableMessageDebugLabel(type) {
  switch (type) {
    case MESSAGE_TYPES.SPECIALIZATION:
      return "ability";
    case MESSAGE_TYPES.UPGRADE:
      return "upgrade";
    case MESSAGE_TYPES.RESPAWN:
      return "respawn";
    case MESSAGE_TYPES.RESYNC:
      return "resync";
    case MESSAGE_TYPES.READY:
      return "ready";
    default:
      return String(type ?? "unknown");
  }
}

function buildPendingReliableDebugSummary(now = Date.now()) {
  const pending = Array.from(pendingReliableMessages.values())
    .map((entry) => {
      const lastSentAt = Number(entry?.lastSentAt);
      return {
        type: getReliableMessageDebugLabel(entry?.payload?.type),
        ageMs: lastSentAt > 0 ? Math.max(0, now - lastSentAt) : 0
      };
    })
    .sort((left, right) => right.ageMs - left.ageMs);

  if (pending.length === 0) {
    return "none";
  }

  const summary = pending
    .slice(0, 3)
    .map((entry) => `${entry.type} ${formatDebugAgeMs(entry.ageMs)}`);

  if (pending.length > 3) {
    summary.push(`+${pending.length - 3} more`);
  }

  return summary.join(" | ");
}

function buildStateChunkDebugSummary(now = Date.now()) {
  if (stateChunks.size === 0) {
    return "idle";
  }

  const pendingSnapshots = Array.from(stateChunks.entries()).sort((left, right) => right[0] - left[0]);
  const [snapshotSeq, entry] = pendingSnapshots[0];
  const chunks = Array.isArray(entry?.chunks) ? entry.chunks : [];
  const receivedCount = chunks.reduce((count, chunk) => count + Number(typeof chunk === "string"), 0);
  const ageMs = Math.max(0, now - Number(entry?.receivedAt ?? now));
  return `${snapshotSeq} ${receivedCount}/${entry?.chunkCount ?? chunks.length} ${formatDebugAgeMs(ageMs)}${pendingSnapshots.length > 1 ? ` +${pendingSnapshots.length - 1}` : ""}`;
}

function inferDebugIssueSubsystem(issue) {
  const code = String(issue?.code ?? "").toLowerCase();
  const message = String(issue?.message ?? "").toLowerCase();

  if (DEBUG_ISSUE_INSIGHTS[code]?.subsystem) {
    return DEBUG_ISSUE_INSIGHTS[code].subsystem;
  }

  if (code.includes("snapshot") || code.includes("chunk") || message.includes("snapshot")) {
    return code.includes("resync") || code.includes("chunk") ? "replication" : "snapshot";
  }
  if (code.includes("input")) {
    return "input";
  }
  if (code.includes("upgrade") || code.includes("ability") || code.includes("stat")) {
    return "ability";
  }
  if (code.includes("ping") || code.includes("jitter") || code.includes("packet") || code.includes("pong")) {
    return "network";
  }
  if (code.includes("fire") || code.includes("cooldown") || code.includes("projectile") || code.includes("bullet")) {
    return "combat";
  }
  if (code.includes("frame") || code.includes("render")) {
    return "render";
  }
  if (code.includes("disconnect") || code.includes("session")) {
    return "session";
  }
  if (code.includes("server") || code.includes("tick")) {
    return "server";
  }
  if (
    code.includes("desync") ||
    code.includes("reconciliation") ||
    code.includes("correction") ||
    code.includes("replay")
  ) {
    return "prediction";
  }
  if (
    code.includes("health") ||
    code.includes("entity") ||
    code.includes("teleport") ||
    code.includes("movement")
  ) {
    return "state";
  }

  return "unknown";
}

function getDebugIssueKindWeight(kind) {
  switch (kind) {
    case "root":
      return 44;
    case "symptom":
      return 18;
    default:
      return 8;
  }
}

function getDebugIssueConfidenceWeight(confidence) {
  switch (confidence) {
    case "high":
      return 14;
    case "medium":
      return 8;
    default:
      return 4;
  }
}

function buildDebugMetricsSnapshot(now = Date.now(), options = {}) {
  const localPlayer = options.localPlayer ?? getLocalPlayer();
  const visualState = options.visualState ?? ensureLocalVisualState(localPlayer);
  const snapshotAgeMs = lastSnapshotAt ? Math.round(performance.now() - lastSnapshotAt) : 0;
  const statePacketAgeMs = getStatePacketAgeMs(now);
  const serverMessageAgeMs = lastServerMessageAt > 0 ? Math.max(0, now - lastServerMessageAt) : 0;
  const lastInputAgeMs = lastInputDispatchAt > 0 ? Math.max(0, now - lastInputDispatchAt) : 0;
  const lastInputChangeAgeMs = lastLocalInputChangedAt > 0 ? Math.max(0, now - lastLocalInputChangedAt) : 0;
  const lastAimChangeAgeMs = lastAimInputChangedAt > 0 ? Math.max(0, now - lastAimInputChangedAt) : 0;
  const lastResyncAgeMs = lastResyncRequestAt > 0 ? Math.max(0, now - lastResyncRequestAt) : 0;
  const estimatedTickRate = Number(debugMonitor.estimatedServerTickRate) || GAME_CONFIG.serverTickRate;
  const localPredictionDelta = localPlayer && visualState
    ? Math.hypot((visualState.x ?? localPlayer.x) - (localPlayer.x ?? 0), (visualState.y ?? localPlayer.y) - (localPlayer.y ?? 0))
    : 0;

  return {
    now,
    roomId: currentRoomId ?? null,
    playerId: localPlayerId ?? null,
    socketState: getSocketReadyStateLabel(socket),
    latestLatencyMs: Math.max(0, Number(latestLatencyMs) || 0),
    jitterMs: getLatencyJitterMs(),
    packetLossPercent: getPacketLossPercent(now),
    snapshotAgeMs,
    statePacketAgeMs,
    serverMessageAgeMs,
    lastInputAgeMs,
    lastInputChangeAgeMs,
    lastAimChangeAgeMs,
    lastResyncAgeMs,
    localPredictionDelta,
    expectedPredictionSlackDistance: Number(getExpectedPredictionSlackDistance(now).toFixed(1)),
    actionablePredictionErrorDistance: getActionablePredictionErrorDistance(now),
    estimatedTickRate,
    expectedTickRate: GAME_CONFIG.serverTickRate,
    tickBudgetMs: 1000 / GAME_CONFIG.serverTickRate,
    serverLoopLagMs: Math.max(0, Number(latestDebugInfo?.serverLoopLagMs ?? 0) || 0),
    serverTickWorkMs: Math.max(0, Number(latestDebugInfo?.tickDurationMs ?? 0) || 0),
    lastProcessedInputSeq: latestYou?.lastProcessedInputSeq ?? 0,
    lastProcessedInputTick: latestYou?.lastProcessedInputTick ?? 0,
    pendingInputs: pendingInputs.length,
    pendingInputCount: latestYou?.pendingInputCount ?? pendingInputs.length,
    pendingPredictedShots: debugMonitor.pendingPredictedShots.size,
    pendingReliableSummary: buildPendingReliableDebugSummary(now),
    stateChunkSummary: buildStateChunkDebugSummary(now),
    reconnectSummary: reconnectTimer !== null ? `wait(${reconnectAttempts})` : String(reconnectAttempts),
    renderFailure,
    renderLoopStopped,
    documentHidden: document.hidden,
    roomPhase: latestMatch?.phase ?? null,
    roundNumber: latestMatch?.roundNumber ?? null,
    playersVisible: players.size,
    bulletsVisible: bullets.size,
    shapesVisible: shapes.size,
    serverSignalCount: Array.isArray(latestDebugInfo?.signals) ? latestDebugInfo.signals.length : 0
  };
}

function getDebugIssueInsight(issue) {
  const code = String(issue?.code ?? "").trim();
  const fallbackSubsystem = inferDebugIssueSubsystem(issue);
  const insight = DEBUG_ISSUE_INSIGHTS[code] ?? null;

  return {
    subsystem: insight?.subsystem ?? fallbackSubsystem,
    kind: insight?.kind ?? (issue?.source === "server" ? "root" : "symptom"),
    confidence: insight?.confidence ?? (issue?.source === "server" ? "high" : "medium"),
    rootCauseWeight: Math.max(0, Number(insight?.rootCauseWeight ?? (issue?.source === "server" ? 72 : 48)) || 0),
    aiSummary:
      insight?.aiSummary ??
      `Active ${fallbackSubsystem} issue: ${trimDebugMessage(issue?.message ?? issue?.code ?? "unknown issue", 96)}`,
    likelyCause:
      insight?.likelyCause ??
      `The ${fallbackSubsystem} path raised ${code || "an unknown issue"} and needs a closer state comparison.`,
    fixHint:
      insight?.fixHint ??
      `Trace the first producer of ${code || "this issue"} and compare client/server state around the failing condition.`,
    inspectTargets: Array.from(
      new Set([...(insight?.inspect ?? []), ...(DEBUG_SUBSYSTEM_INSPECT_TARGETS[insight?.subsystem ?? fallbackSubsystem] ?? DEBUG_SUBSYSTEM_INSPECT_TARGETS.unknown)])
    ).slice(0, 3)
  };
}

function buildDebugIssueEvidence(issue, metrics) {
  const parts = [trimDebugMessage(issue?.message ?? "Unknown debug issue", 120)];

  switch (issue?.subsystem) {
    case "network":
      parts.push(`ping ${Math.round(metrics.latestLatencyMs)}ms`);
      parts.push(`jitter ${Math.round(metrics.jitterMs)}ms`);
      parts.push(`loss ${metrics.packetLossPercent.toFixed(0)}%`);
      parts.push(`socket ${metrics.socketState}`);
      break;
    case "snapshot":
    case "replication":
      parts.push(`snapshot ${metrics.snapshotAgeMs}ms`);
      parts.push(`state ${formatDebugAgeMs(metrics.statePacketAgeMs)}`);
      parts.push(`chunks ${metrics.stateChunkSummary}`);
      parts.push(`resync ${formatDebugAgeMs(metrics.lastResyncAgeMs)}`);
      break;
    case "prediction":
      parts.push(`delta ${metrics.localPredictionDelta.toFixed(1)}`);
      parts.push(`budget ${metrics.actionablePredictionErrorDistance}`);
      parts.push(`pending ${metrics.pendingInputs}/${metrics.pendingInputCount}`);
      parts.push(`snapshot ${metrics.snapshotAgeMs}ms`);
      break;
    case "server":
      parts.push(`loop ${Math.round(metrics.serverLoopLagMs)}ms`);
      parts.push(`work ${Math.round(metrics.serverTickWorkMs)}ms`);
      parts.push(`tick ${metrics.estimatedTickRate.toFixed(1)}/${metrics.expectedTickRate}`);
      break;
    case "input":
      parts.push(`ack ${metrics.lastProcessedInputSeq}`);
      parts.push(`tick ${metrics.lastProcessedInputTick}`);
      parts.push(`pending ${metrics.pendingInputs}/${metrics.pendingInputCount}`);
      parts.push(`input ${formatDebugAgeMs(metrics.lastInputAgeMs)}`);
      break;
    case "ability":
      parts.push(`reliable ${metrics.pendingReliableSummary}`);
      parts.push(`phase ${metrics.roomPhase ?? "-"}`);
      break;
    case "combat":
      parts.push(`shotQ ${metrics.pendingPredictedShots}`);
      parts.push(`ping ${Math.round(metrics.latestLatencyMs)}ms`);
      parts.push(`reliable ${metrics.pendingReliableSummary}`);
      break;
    case "render":
      parts.push(`hidden ${metrics.documentHidden ? "yes" : "no"}`);
      parts.push(`loop ${metrics.renderLoopStopped ? "stopped" : "ok"}`);
      if (metrics.renderFailure) {
        parts.push(`failure ${trimDebugMessage(metrics.renderFailure, 64)}`);
      }
      break;
    case "session":
      parts.push(`socket ${metrics.socketState}`);
      parts.push(`reconn ${metrics.reconnectSummary}`);
      break;
    case "state":
      parts.push(`phase ${metrics.roomPhase ?? "-"}`);
      parts.push(`players ${metrics.playersVisible}`);
      break;
    default:
      parts.push(`socket ${metrics.socketState}`);
      break;
  }

  if (issue?.scope) {
    parts.push(`scope ${issue.scope}`);
  }
  if (Number(issue?.count ?? 1) > 1) {
    parts.push(`count x${issue.count}`);
  }
  parts.push(`age ${formatDebugAgeMs(Math.max(0, metrics.now - Number(issue?.lastAt ?? metrics.now)))}`);

  return trimDebugMessage(
    Array.from(new Set(parts.filter(Boolean))).join(" | "),
    220
  );
}

function buildDiagnosedDebugIssue(issue, metrics, now = Date.now()) {
  const insight = getDebugIssueInsight(issue);
  const subsystemTag = DEBUG_SUBSYSTEM_TAGS[insight.subsystem] ?? DEBUG_SUBSYSTEM_TAGS.unknown;
  const ageMs = Math.max(0, now - Number(issue?.lastAt ?? now));
  const diagnosed = {
    ...issue,
    subsystem: insight.subsystem,
    subsystemTag,
    kind: insight.kind,
    confidence: insight.confidence,
    rootCauseWeight: insight.rootCauseWeight,
    aiSummary: insight.aiSummary,
    likelyCause: insight.likelyCause,
    fixHint: insight.fixHint,
    inspectTargets: insight.inspectTargets,
    evidence: "",
    ageMs,
    aiPriority: 0
  };

  diagnosed.evidence = buildDebugIssueEvidence(diagnosed, metrics);
  diagnosed.aiPriority =
    getDebugSeverityWeight(diagnosed.severity) * 100 +
    diagnosed.rootCauseWeight +
    getDebugIssueKindWeight(diagnosed.kind) +
    getDebugIssueConfidenceWeight(diagnosed.confidence) +
    (diagnosed.source === "server" ? 18 : diagnosed.source === "dynamic" ? 10 : 6) +
    Math.min(24, Math.max(0, Number(diagnosed.count ?? 1) - 1) * 4);

  return diagnosed;
}

function sortDebugIssuesForAi(left, right) {
  return (
    Number(right?.aiPriority ?? 0) - Number(left?.aiPriority ?? 0) ||
    getDebugSeverityWeight(right?.severity) - getDebugSeverityWeight(left?.severity) ||
    Number(right?.lastAt ?? 0) - Number(left?.lastAt ?? 0) ||
    String(left?.code ?? "").localeCompare(String(right?.code ?? ""))
  );
}

function buildDebugSubsystemSummary(issues) {
  const grouped = new Map();

  for (const issue of issues) {
    const subsystem = issue?.subsystem ?? "unknown";
    const existing = grouped.get(subsystem) ?? {
      subsystem,
      subsystemTag: issue?.subsystemTag ?? DEBUG_SUBSYSTEM_TAGS.unknown,
      count: 0,
      highestSeverity: issue?.severity ?? "info",
      topIssue: issue,
      aiPriority: 0
    };

    existing.count += 1;
    existing.aiPriority += Number(issue?.aiPriority ?? 0);
    if (
      getDebugSeverityWeight(issue?.severity) > getDebugSeverityWeight(existing.highestSeverity) ||
      (existing.topIssue && Number(issue?.aiPriority ?? 0) > Number(existing.topIssue?.aiPriority ?? 0))
    ) {
      existing.highestSeverity = issue?.severity ?? existing.highestSeverity;
      existing.topIssue = issue;
    }

    grouped.set(subsystem, existing);
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.aiPriority - left.aiPriority || left.subsystem.localeCompare(right.subsystem))
    .map((entry) => ({
      subsystem: entry.subsystem,
      subsystemTag: entry.subsystemTag,
      count: entry.count,
      highestSeverity: entry.highestSeverity,
      topCode: entry.topIssue?.code ?? "unknown",
      topSummary: entry.topIssue?.aiSummary ?? entry.topIssue?.message ?? "Unknown issue"
    }));
}

function buildAiDebugReport(now = Date.now(), options = {}) {
  if (
    !options.force &&
    latestAiDebugReport &&
    now - Number(latestAiDebugReport.generatedAtMs ?? 0) < DEBUG_MONITOR.aiReportCacheMs
  ) {
    return latestAiDebugReport;
  }

  const metrics = buildDebugMetricsSnapshot(now, options);
  const issues = getActiveDebugIssues(now)
    .filter(isActionableDebugIssue)
    .map((issue) => buildDiagnosedDebugIssue(issue, metrics, now))
    .sort(sortDebugIssuesForAi);
  const primary = issues[0] ?? null;
  const relatedCodes =
    primary
      ? issues
          .filter((issue) => issue.code !== primary.code && issue.subsystem === primary.subsystem)
          .slice(0, 3)
          .map((issue) => issue.code)
      : [];

  const report = {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    generatedAtMs: now,
    roomId: metrics.roomId,
    playerId: metrics.playerId,
    aiFocusPrompt:
      primary
        ? `Start with ${primary.subsystem} -> ${primary.code}. Inspect ${primary.inspectTargets.join(", ")}.`
        : "No active issues. Capture a report while reproducing the bug if behavior still looks wrong.",
    primaryDiagnosis: primary
      ? {
          code: primary.code,
          severity: primary.severity,
          source: primary.source,
          scope: primary.scope ?? null,
          subsystem: primary.subsystem,
          subsystemTag: primary.subsystemTag,
          kind: primary.kind,
          confidence: primary.confidence,
          message: primary.message,
          aiSummary: primary.aiSummary,
          likelyCause: primary.likelyCause,
          fixHint: primary.fixHint,
          inspectTargets: primary.inspectTargets,
          evidence: primary.evidence,
          count: primary.count,
          ageMs: primary.ageMs,
          relatedCodes
        }
      : null,
    subsystemSummary: buildDebugSubsystemSummary(issues),
    metrics,
    issues: issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      source: issue.source,
      scope: issue.scope ?? null,
      count: issue.count,
      ageMs: issue.ageMs,
      subsystem: issue.subsystem,
      subsystemTag: issue.subsystemTag,
      kind: issue.kind,
      confidence: issue.confidence,
      message: issue.message,
      aiSummary: issue.aiSummary,
      likelyCause: issue.likelyCause,
      fixHint: issue.fixHint,
      inspectTargets: issue.inspectTargets,
      evidence: issue.evidence,
      aiPriority: issue.aiPriority
    }))
  };

  latestAiDebugReport = report;
  window.__MULTITANK_DEBUG_REPORT__ = report;
  return report;
}

function wrapMonospaceDebugText(text, maxChars = 68) {
  const normalized = trimDebugMessage(text, 400);
  if (!normalized) {
    return [""];
  }

  const words = normalized.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const nextLine = current ? `${current} ${word}` : word;
    if (nextLine.length <= maxChars) {
      current = nextLine;
      continue;
    }

    if (current) {
      lines.push(current);
    }

    if (word.length <= maxChars) {
      current = word;
      continue;
    }

    let remainder = word;
    while (remainder.length > maxChars) {
      lines.push(`${remainder.slice(0, Math.max(1, maxChars - 1))}-`);
      remainder = remainder.slice(Math.max(1, maxChars - 1));
    }
    current = remainder;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function buildAiDiagnosisPanelLines(report, maxChars = 68) {
  const primary = report?.primaryDiagnosis ?? null;
  if (!primary) {
    return [
      "AI Focus: clear",
      `Report: press ${DEBUG_AI_REPORT_HOTKEY} to copy a structured JSON report when the bug reproduces.`
    ];
  }

  const focusMeta = `AI Focus: ${primary.code} [${primary.subsystemTag} | ${primary.kind} | ${primary.confidence}]`;
  const relatedText = Array.isArray(primary.relatedCodes) && primary.relatedCodes.length > 0
    ? primary.relatedCodes.join(" | ")
    : "none";

  return [
    ...wrapMonospaceDebugText(focusMeta, maxChars),
    ...wrapMonospaceDebugText(`Why: ${primary.aiSummary}`, maxChars),
    ...wrapMonospaceDebugText(`Cause: ${primary.likelyCause}`, maxChars),
    ...wrapMonospaceDebugText(`Fix: ${primary.fixHint}`, maxChars),
    ...wrapMonospaceDebugText(`Inspect: ${primary.inspectTargets.join(" ; ")}`, maxChars),
    ...wrapMonospaceDebugText(`Evidence: ${primary.evidence}`, maxChars),
    ...wrapMonospaceDebugText(`Related: ${relatedText}`, maxChars),
    ...wrapMonospaceDebugText(`Report: ${DEBUG_AI_REPORT_HOTKEY} copies JSON for AI triage.`, maxChars)
  ];
}

function buildDebugIssueCodeSummary(issues) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return "clear";
  }

  const summary = issues
    .slice(0, 2)
    .map((issue) => {
      const sourcePrefix =
        typeof issue?.source === "string" && issue.source
          ? `${issue.source}:`
          : "";
      return trimDebugMessage(`${sourcePrefix}${issue?.code ?? "unknown"}`, 24);
    });

  if (issues.length > 2) {
    summary.push(`+${issues.length - 2}`);
  }

  return summary.join(" | ");
}

function buildDebugIssueLabel(issue) {
  const metaParts = [issue?.severity === "error" ? "ERR" : issue?.severity === "warn" ? "WARN" : "INFO"];
  if (Number(issue?.count ?? 1) > 1) {
    metaParts.push(`x${issue.count}`);
  }
  if (issue?.subsystemTag) {
    metaParts.push(issue.subsystemTag);
  }
  const sourcePrefix =
    typeof issue?.source === "string" && issue.source
      ? `${issue.source}:`
      : "";
  const codeLabel = trimDebugMessage(`${sourcePrefix}${issue?.code ?? "unknown"}`, 24);
  const messageLabel = trimDebugMessage(issue?.aiSummary ?? issue?.message, 42);
  return `[${metaParts.join(" ")}] ${codeLabel} | ${messageLabel}`;
}

function getDebugIssuePanelLayout(issueCount, canvasWidth, canvasHeight, issuePanelY) {
  const fontSize = issueCount > 48 ? 11 : issueCount > 28 ? 12 : 14;
  const lineHeight = fontSize + 4;
  const columnGap = 16;
  const availableHeight = Math.max(lineHeight * 3, canvasHeight - issuePanelY - 24);
  const rowsPerColumn = Math.max(1, Math.floor((availableHeight - lineHeight) / lineHeight));
  const columnCount = Math.max(1, Math.ceil(Math.max(issueCount, 1) / rowsPerColumn));
  const maxColumnWidth = Math.min(380, Math.max(220, Math.round(canvasWidth * 0.24)));
  const availableWidth = Math.max(220, canvasWidth - 40);
  const rawColumnWidth = Math.floor((availableWidth - columnGap * Math.max(0, columnCount - 1)) / columnCount);
  const columnWidth = Math.max(160, Math.min(maxColumnWidth, rawColumnWidth));
  const visibleRowCount = issueCount === 0 ? 1 : Math.min(rowsPerColumn, issueCount);

  return {
    columnCount,
    columnGap,
    columnWidth,
    fontSize,
    lineHeight,
    rowsPerColumn,
    panelWidth: columnWidth * columnCount + columnGap * Math.max(0, columnCount - 1),
    panelHeight: 18 + (visibleRowCount + 1) * lineHeight,
    textMaxWidth: Math.max(120, columnWidth - 8)
  };
}

function shouldUseExpandedDebugIssueBoard(issues) {
  return Array.isArray(issues) && issues.length > 0;
}

function getExpandedDebugIssueDetailLevels(issueCount) {
  if (issueCount <= 8) {
    return ["full", "compact", "minimal"];
  }

  if (issueCount <= 20) {
    return ["compact", "minimal"];
  }

  return ["minimal"];
}

function buildExpandedDebugIssueHeader(issue) {
  const metaParts = [issue?.severity === "error" ? "ERR" : issue?.severity === "warn" ? "WARN" : "INFO"];
  if (issue?.subsystemTag) {
    metaParts.push(issue.subsystemTag);
  }
  if (Number(issue?.count ?? 1) > 1) {
    metaParts.push(`x${issue.count}`);
  }
  const ageMs = Math.max(0, Number(issue?.ageMs ?? 0) || 0);
  if (ageMs > 0) {
    metaParts.push(formatDebugAgeMs(ageMs));
  }
  const sourcePrefix =
    typeof issue?.source === "string" && issue.source
      ? `${issue.source}:`
      : "";
  return `[${metaParts.join(" ")}] ${sourcePrefix}${issue?.code ?? "unknown"}`;
}

function buildExpandedDebugIssueBlocks(issues, maxChars, detailLevel) {
  return issues.map((issue) => {
    const lines = [
      ...wrapMonospaceDebugText(buildExpandedDebugIssueHeader(issue), maxChars),
      ...wrapMonospaceDebugText(`Why: ${issue?.aiSummary ?? issue?.message ?? "Unknown debug issue"}`, maxChars)
    ];

    if (detailLevel !== "minimal") {
      lines.push(
        ...wrapMonospaceDebugText(
          `Fix: ${issue?.fixHint ?? issue?.likelyCause ?? "Inspect the issue producer and compare client/server state."}`,
          maxChars
        )
      );
    }

    if (detailLevel === "full" && Array.isArray(issue?.inspectTargets) && issue.inspectTargets.length > 0) {
      lines.push(...wrapMonospaceDebugText(`Inspect: ${issue.inspectTargets.join(" ; ")}`, maxChars));
    }

    return {
      issue,
      lines
    };
  });
}

function tryBuildExpandedDebugIssueBoardLayout(issues, panelWidth, panelHeight, fontSize, detailLevel) {
  const columnGap = 18;
  const cardGap = 12;
  const columnPadding = 12;
  const lineHeight = fontSize <= 10 ? fontSize + 3 : fontSize + 4;
  const maxColumns = Math.max(1, Math.min(issues.length, Math.floor((panelWidth + columnGap) / 220)));

  for (let columnCount = 1; columnCount <= maxColumns; columnCount += 1) {
    const columnWidth = Math.floor((panelWidth - columnGap * Math.max(0, columnCount - 1)) / columnCount);
    if (columnWidth < 200) {
      continue;
    }

    const maxChars = Math.max(24, Math.floor((columnWidth - columnPadding * 2) / Math.max(6.4, fontSize * 0.61)));
    const blocks = buildExpandedDebugIssueBlocks(issues, maxChars, detailLevel);
    const columns = Array.from({ length: columnCount }, () => ({
      blocks: [],
      height: 0
    }));
    let columnIndex = 0;
    let fits = true;

    for (const block of blocks) {
      const blockHeight =
        block.lines.length * lineHeight +
        (columns[columnIndex].blocks.length > 0 ? cardGap : 0);

      while (columnIndex < columnCount && columns[columnIndex].height + blockHeight > panelHeight) {
        columnIndex += 1;
      }

      if (columnIndex >= columnCount) {
        fits = false;
        break;
      }

      columns[columnIndex].blocks.push(block);
      columns[columnIndex].height += blockHeight;
    }

    if (fits) {
      return {
        columnCount,
        columnGap,
        columnPadding,
        columnWidth,
        cardGap,
        detailLevel,
        fontSize,
        lineHeight,
        columns
      };
    }
  }

  return null;
}

function buildExpandedDebugIssueBoardLayout(issues, panelWidth, panelHeight) {
  const detailLevels = getExpandedDebugIssueDetailLevels(issues.length);
  const fontSizes =
    issues.length > 28
      ? [11, 10, 9]
      : issues.length > 14
        ? [12, 11, 10, 9]
        : [13, 12, 11, 10];

  for (const detailLevel of detailLevels) {
    for (const fontSize of fontSizes) {
      const layout = tryBuildExpandedDebugIssueBoardLayout(
        issues,
        panelWidth,
        panelHeight,
        fontSize,
        detailLevel
      );
      if (layout) {
        return layout;
      }
    }
  }

  return tryBuildExpandedDebugIssueBoardLayout(issues, panelWidth, panelHeight, 9, "minimal");
}

function buildExpandedDebugIssueBoardHeaderLines(aiReport, options = {}) {
  const issues = Array.isArray(options.issues) ? options.issues : [];
  const primary = aiReport?.primaryDiagnosis ?? null;
  const issueCountText = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
  const headerLines = [
    `Debug Issue Board | ${issueCountText} | room ${currentRoomId ?? "-"} | phase ${latestMatch?.phase ?? "-"} | ping ${Math.round(latestLatencyMs)}ms | jitter ${Math.round(options.jitterMs ?? 0)}ms | snapshot ${Math.round(options.snapshotAge ?? 0)}ms`
  ];

  if (options.objectiveStatusText) {
    headerLines.push(`Objectives${String(options.objectiveStatusText).replace(" | ", ": ")}`);
  }

  if (primary) {
    headerLines.push(
      `Focus: ${primary.code} [${primary.subsystemTag} | ${primary.confidence}] | ${primary.aiSummary}`
    );
    headerLines.push(`Fix: ${primary.fixHint}`);
  } else {
    headerLines.push("Focus: clear");
  }

  headerLines.push(`Report: ${DEBUG_AI_REPORT_HOTKEY} copies JSON for AI triage. Game view is dimmed so every active issue can stay visible.`);
  return headerLines;
}

function rectsOverlap(a, b) {
  return Boolean(
    a &&
    b &&
    a.x < b.right &&
    a.x + a.width > b.left &&
    a.y < b.bottom &&
    a.y + a.height > b.top
  );
}

function normalizeBoardRect(rect) {
  if (!rect) {
    return null;
  }

  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width < 320 || height < 220) {
    return null;
  }

  return { x, y, width, height };
}

function avoidBoardOverlay(rect, overlayRect, options = {}) {
  if (!rect || !overlayRect || !rectsOverlap(rect, overlayRect)) {
    return rect;
  }

  const gap = Math.max(0, Math.round(options.gap ?? 14));
  const minWidth = Math.max(320, Math.round(options.minWidth ?? 320));
  const minHeight = Math.max(220, Math.round(options.minHeight ?? 220));
  const variants = [];

  const widthBeforeOverlay = Math.floor(overlayRect.left - gap - rect.x);
  if (widthBeforeOverlay >= minWidth) {
    variants.push({
      x: rect.x,
      y: rect.y,
      width: widthBeforeOverlay,
      height: rect.height
    });
  }

  const heightBeforeOverlay = Math.floor(overlayRect.top - gap - rect.y);
  if (heightBeforeOverlay >= minHeight) {
    variants.push({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: heightBeforeOverlay
    });
  }

  if (variants.length === 0) {
    return rect;
  }

  variants.sort((a, b) => b.width * b.height - a.width * a.height);
  return variants[0];
}

function getExpandedDebugIssueBoardRect() {
  const outerMargin = 12;
  const overlayGap = 16;
  const minWidth = 320;
  const minHeight = 220;
  const defaultRect = {
    x: outerMargin,
    y: outerMargin,
    width: Math.max(minWidth, canvas.width - outerMargin * 2),
    height: Math.max(minHeight, canvas.height - outerMargin * 2)
  };
  const classTabsRect = getCanvasOverlayRect(classTabsPanelElement);
  const scoreboardRect = getCanvasOverlayRect(scoreboardPanelElement);
  const diagnosticRect =
    diagnosticBannerElement?.classList?.contains("diagnostic-banner--debug")
      ? getCanvasOverlayRect(diagnosticBannerElement)
      : null;
  const devBadgeRect = getCanvasOverlayRect(devBadgeElement);
  const topInset = Math.max(
    outerMargin,
    Math.ceil(classTabsRect?.bottom ?? 0) + overlayGap,
    Math.ceil(scoreboardRect?.bottom ?? 0) + overlayGap,
    Math.ceil(devBadgeRect?.bottom ?? 0) + overlayGap
  );
  const candidates = [];

  const centerRect = normalizeBoardRect({
    x: Math.max(outerMargin, Math.ceil(classTabsRect?.right ?? 0) + overlayGap),
    y: outerMargin,
    width:
      Math.min(canvas.width - outerMargin, Math.floor(scoreboardRect?.left ?? canvas.width) - overlayGap) -
      Math.max(outerMargin, Math.ceil(classTabsRect?.right ?? 0) + overlayGap),
    height: canvas.height - outerMargin * 2
  });
  if (centerRect) {
    candidates.push({
      rect: avoidBoardOverlay(centerRect, diagnosticRect, {
        gap: overlayGap,
        minWidth,
        minHeight
      }),
      priority:
        classTabsRect &&
        scoreboardRect &&
        centerRect.width >= 520
          ? 2
          : 1
    });
  }

  const belowTopRect = normalizeBoardRect({
    x: outerMargin,
    y: topInset,
    width: canvas.width - outerMargin * 2,
    height: canvas.height - topInset - outerMargin
  });
  if (belowTopRect) {
    candidates.push({
      rect: avoidBoardOverlay(belowTopRect, diagnosticRect, {
        gap: overlayGap,
        minWidth,
        minHeight
      }),
      priority: 1
    });
  }

  const fallbackRect = avoidBoardOverlay(defaultRect, diagnosticRect, {
    gap: overlayGap,
    minWidth,
    minHeight
  });
  candidates.push({ rect: fallbackRect, priority: 0 });

  candidates.sort((left, right) => {
    const priorityDelta = right.priority - left.priority;
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const areaDelta = right.rect.width * right.rect.height - left.rect.width * left.rect.height;
    if (areaDelta !== 0) {
      return areaDelta;
    }

    return left.rect.y - right.rect.y;
  });

  return candidates[0]?.rect ?? defaultRect;
}

function drawExpandedDebugIssueBoard(aiReport, issues, options = {}) {
  const boardRect = getExpandedDebugIssueBoardRect();
  const boardX = boardRect.x;
  const boardY = boardRect.y;
  const boardWidth = boardRect.width;
  const boardHeight = boardRect.height;
  const headerPaddingX = 16;
  const headerFontSize = boardWidth < 1100 ? 11 : 12;
  const headerLineHeight = headerFontSize + 5;
  const headerCharBudget = Math.max(36, Math.floor((boardWidth - headerPaddingX * 2) / 7.2));
  const headerLines = buildExpandedDebugIssueBoardHeaderLines(aiReport, options)
    .flatMap((line) => wrapMonospaceDebugText(line, headerCharBudget));
  const headerHeight = 18 + headerLines.length * headerLineHeight;
  const issueAreaY = boardY + headerHeight + 10;
  const issueAreaHeight = Math.max(120, boardHeight - headerHeight - 22);
  const issueAreaWidth = boardWidth - 24;
  const layout = buildExpandedDebugIssueBoardLayout(issues, issueAreaWidth, issueAreaHeight);

  context.save();
  context.textAlign = "left";
  context.fillStyle = "rgba(4, 8, 16, 0.92)";
  context.fillRect(boardX, boardY, boardWidth, boardHeight);
  context.strokeStyle = "rgba(102, 206, 255, 0.24)";
  context.lineWidth = 1;
  context.strokeRect(boardX, boardY, boardWidth, boardHeight);

  const primarySeverity = aiReport?.primaryDiagnosis?.severity ?? "info";
  context.fillStyle =
    primarySeverity === "error"
      ? "rgba(48, 18, 18, 0.9)"
      : primarySeverity === "warn"
        ? "rgba(46, 34, 12, 0.88)"
        : "rgba(10, 26, 34, 0.88)";
  context.fillRect(boardX + 8, boardY + 8, boardWidth - 16, headerHeight);
  context.font = `${headerFontSize}px Consolas, monospace`;
  headerLines.forEach((line, index) => {
    context.fillStyle =
      index === 0
        ? "rgba(255, 236, 176, 0.98)"
        : "rgba(234, 241, 247, 0.94)";
    context.fillText(line, boardX + headerPaddingX, boardY + 26 + index * headerLineHeight, boardWidth - headerPaddingX * 2);
  });

  if (!layout) {
    context.fillStyle = "rgba(255, 214, 120, 0.96)";
    context.font = "11px Consolas, monospace";
    context.fillText(
      "Unable to fit the expanded issue board layout. Press F8 to copy the full JSON report.",
      boardX + 16,
      issueAreaY + 20,
      boardWidth - 32
    );
    context.restore();
    return;
  }

  context.font = `${layout.fontSize}px Consolas, monospace`;
  layout.columns.forEach((column, columnIndex) => {
    const columnX = boardX + 12 + columnIndex * (layout.columnWidth + layout.columnGap);
    let currentY = issueAreaY + 10;

    column.blocks.forEach((block) => {
      const blockHeight = block.lines.length * layout.lineHeight + 10;
      context.fillStyle =
        block.issue?.severity === "error"
          ? "rgba(54, 20, 20, 0.9)"
          : block.issue?.severity === "warn"
            ? "rgba(48, 36, 14, 0.9)"
            : "rgba(12, 30, 40, 0.88)";
      context.fillRect(columnX, currentY - 2, layout.columnWidth, blockHeight);

      block.lines.forEach((line, lineIndex) => {
        context.fillStyle =
          lineIndex === 0
            ? block.issue?.severity === "error"
              ? "rgba(255, 184, 184, 0.98)"
              : block.issue?.severity === "warn"
                ? "rgba(255, 225, 146, 0.98)"
                : "rgba(176, 235, 255, 0.98)"
            : "rgba(235, 240, 245, 0.94)";
        context.fillText(
          line,
          columnX + layout.columnPadding,
          currentY + lineIndex * layout.lineHeight + layout.fontSize,
          layout.columnWidth - layout.columnPadding * 2
        );
      });

      currentY += blockHeight + layout.cardGap;
    });
  });

  context.restore();
}

function drawOverlay() {
  const now = Date.now();
  const localPlayer = getLocalPlayer();
  const visualState = ensureLocalVisualState(localPlayer);
  const aiReport = buildAiDebugReport(now, { localPlayer, visualState });
  const snapshotAge = lastSnapshotAt ? Math.round(performance.now() - lastSnapshotAt) : 0;
  const lastProcessedInputSeq = latestYou?.lastProcessedInputSeq ?? 0;
  const lastProcessedInputTick = latestYou?.lastProcessedInputTick ?? 0;
  const pendingInputCount = latestYou?.pendingInputCount ?? pendingInputs.length;
  const jitterMs = getLatencyJitterMs();
  const packetLossPercent = getPacketLossPercent(now);
  const estimatedTickRate = Number(debugMonitor.estimatedServerTickRate) || GAME_CONFIG.serverTickRate;
  const clientPositionText = localPlayer && visualState
    ? `${Math.round(visualState.x)},${Math.round(visualState.y)}`
    : "-";
  const serverPositionText = localPlayer
    ? `${Math.round(localPlayer.x ?? 0)},${Math.round(localPlayer.y ?? 0)}`
    : "-";
  const positionDelta = localPlayer && visualState
    ? Math.hypot((visualState.x ?? localPlayer.x) - (localPlayer.x ?? 0), (visualState.y ?? localPlayer.y) - (localPlayer.y ?? 0))
    : 0;
  const issues = aiReport.issues;
  const socketState = getSocketReadyStateLabel(socket);
  const statePacketAge = getStatePacketAgeMs(now);
  const serverMessageAge = lastServerMessageAt > 0 ? Math.max(0, now - lastServerMessageAt) : 0;
  const lastInputAge = lastInputDispatchAt > 0 ? Math.max(0, now - lastInputDispatchAt) : 0;
  const lastInputChangeAge = lastLocalInputChangedAt > 0 ? Math.max(0, now - lastLocalInputChangedAt) : 0;
  const lastAimChangeAge = lastAimInputChangedAt > 0 ? Math.max(0, now - lastAimInputChangedAt) : 0;
  const lastResyncAge = lastResyncRequestAt > 0 ? Math.max(0, now - lastResyncRequestAt) : 0;
  const objectiveStatusText = getObjectiveStatusText(latestObjective);

  if (shouldUseExpandedDebugIssueBoard(issues)) {
    drawExpandedDebugIssueBoard(aiReport, issues, {
      issues,
      jitterMs,
      snapshotAge,
      objectiveStatusText
    });
    return;
  }

  const hudTop = getTopLeftHudInset();
  const leftX = 20;
  const leftY = hudTop + 4;
  const lineHeight = 18;
  const leftLines = [
    "Debug HUD",
    `Player ID: ${localPlayerId ? localPlayerId.slice(0, 8) : "-"}`,
    `Room: ${currentRoomId ?? "-"} | Players: ${players.size} | Phase: ${latestMatch?.phase ?? "-"}`,
    `Net: ping ${Math.round(latestLatencyMs)}ms | jitter ${Math.round(jitterMs)}ms | loss ${packetLossPercent.toFixed(0)}% | snapshot ${snapshotAge}ms`,
    `Pos: client ${clientPositionText} | server ${serverPositionText} | delta ${positionDelta.toFixed(1)}`,
    `Seq: ack ${lastProcessedInputSeq} | tick ${lastProcessedInputTick} | pending ${pendingInputs.length}/${pendingInputCount}`,
    `Ticks: server ${lastSimulationTick} | snapshot ${lastSnapshotTick} | client ${clientSimulationTick} | est ${estimatedTickRate.toFixed(1)}/s`,
    `Server: loop ${Math.round(Number(latestDebugInfo?.serverLoopLagMs ?? 0) || 0)}ms | work ${Math.round(Number(latestDebugInfo?.tickDurationMs ?? 0) || 0)}ms`,
    `Socket: ${socketState} | msg ${formatDebugAgeMs(serverMessageAge)} | state ${formatDebugAgeMs(statePacketAge)} | pingQ ${debugMonitor.pendingPings.size} | reconn ${reconnectTimer !== null ? `wait(${reconnectAttempts})` : reconnectAttempts}`,
    `Session: play ${hasPlayableSession() ? "yes" : "no"} | join ${joinInProgress ? "yes" : "no"} | self ${hasSeenLocalPlayerSnapshot ? "yes" : "no"} | alive ${localPlayer?.alive ? "yes" : "no"} | spec ${isSpectatorSession(localPlayer) ? "yes" : "no"} | zoom ${cameraZoom.toFixed(2)}`,
    `Snapshot: applied ${lastAppliedSnapshotSeq} | chunks ${buildStateChunkDebugSummary(now)} | resync ${formatDebugAgeMs(lastResyncAge)}`,
    `Input: move ${hasMovementInputActive() ? "yes" : "no"} | aim ${hasRecentAimInputActive(now) ? "yes" : "no"} | send ${formatDebugAgeMs(lastInputAge)} | input ${formatDebugAgeMs(lastInputChangeAge)} | aimAge ${formatDebugAgeMs(lastAimChangeAge)}`,
    `Reliable: ${buildPendingReliableDebugSummary(now)}`,
    `Scene: bullets ${bullets.size} | shapes ${shapes.size} | predicted ${predictedProjectiles.size} | shotQ ${debugMonitor.pendingPredictedShots.size} | fx ${combatEffects.length} | kill ${killFeedEntries.length}`,
    `Render: hidden ${document.hidden ? "yes" : "no"} | anchor ${cameraHasAnchor ? "yes" : "no"} | snap ${cameraNeedsSnap ? "yes" : "no"} | loop ${renderLoopStopped ? "stopped" : "ok"} | failure ${renderFailure ? "yes" : "no"}`,
    `Codes: ${buildDebugIssueCodeSummary(issues)}`
  ];
  if (objectiveStatusText) {
    leftLines.push(`Objectives${objectiveStatusText.replace(" | ", ": ")}`);
  }

  if (latestInterestStats) {
    leftLines.push(
      `Interest: p ${latestInterestStats.selectedPlayers}/${latestInterestStats.candidatePlayers} | b ${latestInterestStats.selectedBullets}/${latestInterestStats.candidateBullets} | cell ${latestInterestStats.cellSize}`
    );
  }

  const leftPanelWidth = Math.min(660, Math.max(340, canvas.width * 0.46));
  const leftPanelHeight = 16 + leftLines.length * lineHeight;
  context.textAlign = "left";
  context.fillStyle = "rgba(9, 16, 30, 0.78)";
  context.fillRect(leftX - 12, leftY - 18, leftPanelWidth, leftPanelHeight);
  context.fillStyle = "rgba(103, 231, 255, 0.92)";
  context.font = "14px Consolas, monospace";
  leftLines.forEach((line, index) => {
    context.fillText(line, leftX, leftY + index * lineHeight);
  });

  const diagnosisPanelX = leftX;
  const diagnosisPanelY = leftY + leftLines.length * lineHeight + 26;
  const diagnosisPanelWidth = leftPanelWidth;
  const diagnosisFontSize = 13;
  const diagnosisLineHeight = 17;
  const diagnosisCharBudget = Math.max(36, Math.floor((diagnosisPanelWidth - 20) / 7));
  const diagnosisLines = buildAiDiagnosisPanelLines(aiReport, diagnosisCharBudget);
  const diagnosisPanelHeight = 18 + diagnosisLines.length * diagnosisLineHeight;
  const diagnosisSeverity = aiReport.primaryDiagnosis?.severity ?? "info";
  context.fillStyle =
    diagnosisSeverity === "error"
      ? "rgba(42, 22, 10, 0.86)"
      : diagnosisSeverity === "warn"
        ? "rgba(34, 28, 10, 0.82)"
        : "rgba(10, 26, 34, 0.8)";
  context.fillRect(diagnosisPanelX - 12, diagnosisPanelY - 18, diagnosisPanelWidth, diagnosisPanelHeight);
  context.font = `${diagnosisFontSize}px Consolas, monospace`;
  diagnosisLines.forEach((line, index) => {
    context.fillStyle =
      index === 0
        ? diagnosisSeverity === "error"
          ? "rgba(255, 218, 164, 0.98)"
          : diagnosisSeverity === "warn"
            ? "rgba(255, 228, 166, 0.96)"
            : "rgba(165, 242, 255, 0.96)"
        : "rgba(235, 239, 244, 0.92)";
    context.fillText(line, diagnosisPanelX, diagnosisPanelY + index * diagnosisLineHeight, diagnosisPanelWidth - 16);
  });

  const issuePanelY = hudTop + 4;
  const issueLayout = getDebugIssuePanelLayout(issues.length, canvas.width, canvas.height, issuePanelY);
  const issuePanelWidth = issueLayout.panelWidth;
  const issuePanelX = Math.max(20, canvas.width - issuePanelWidth - 20);
  const issueHeader = issues.length === 0 ? "Debug Issues: clear" : `Debug Issues: ${issues.length}`;
  const issuePanelHeight = issueLayout.panelHeight;
  context.fillStyle = issues.length === 0 ? "rgba(8, 30, 20, 0.78)" : "rgba(38, 14, 14, 0.82)";
  context.fillRect(issuePanelX - 12, issuePanelY - 18, issuePanelWidth, issuePanelHeight);
  context.fillStyle = issues.length === 0 ? "rgba(131, 255, 194, 0.96)" : "rgba(255, 186, 186, 0.96)";
  context.font = `${issueLayout.fontSize}px Consolas, monospace`;
  context.fillText(issueHeader, issuePanelX, issuePanelY, issuePanelWidth);

  if (issues.length === 0) {
    context.fillStyle = "rgba(195, 255, 219, 0.88)";
    context.fillText(
      "No active breakage signals detected.",
      issuePanelX,
      issuePanelY + issueLayout.lineHeight,
      issueLayout.textMaxWidth
    );
    return;
  }

  issues.forEach((issue, index) => {
    const column = Math.floor(index / issueLayout.rowsPerColumn);
    const row = index % issueLayout.rowsPerColumn;
    const issueX = issuePanelX + column * (issueLayout.columnWidth + issueLayout.columnGap);
    const issueY = issuePanelY + (row + 1) * issueLayout.lineHeight;
    context.fillStyle =
      issue.severity === "error"
        ? "rgba(255, 132, 132, 0.96)"
        : issue.severity === "warn"
          ? "rgba(255, 214, 120, 0.96)"
          : "rgba(176, 235, 255, 0.96)";
    context.fillText(
      buildDebugIssueLabel(issue),
      issueX,
      issueY,
      issueLayout.textMaxWidth
    );
  });
}

function render(frameAt = performance.now()) {
  try {
    const deltaSeconds = Math.min(0.05, Math.max(0.001, (frameAt - lastRenderFrameAt) / 1000));
    if (deltaSeconds * 1000 >= DEBUG_MONITOR.frameSpikeMs) {
      recordDebugEvent("frame_time_spike", `Frame time spiked to ${Math.round(deltaSeconds * 1000)}ms`, {
        severity: deltaSeconds * 1000 >= DEBUG_MONITOR.frameSpikeMs * 2 ? "error" : "warn",
        ttlMs: 4_000,
        key: "frame_time_spike"
      });
    }
    lastRenderFrameAt = frameAt;
    syncLockedCameraZoom();
    const shouldRenderGameScreen = !document.hidden && (!gameScreenEl || !gameScreenEl.hidden);

    if (shouldRenderGameScreen) {
      refreshTimedUi(frameAt);

      updateResponsiveLocalPrediction(deltaSeconds);
      updateRenderState(deltaSeconds, frameAt);
      updateLocalRenderState(deltaSeconds);
      updateCamera(deltaSeconds);
      updateCameraShake(deltaSeconds);
      updateFallbackVisuals();
      drawBackground();
      const worldViewport = getVisibleViewportSize();

      context.save();
      context.scale(cameraZoom, cameraZoom);
      context.translate(-camera.x + cameraShakeX, -camera.y + cameraShakeY);
      drawMapSquare();
      drawGrid(worldViewport);
      drawCenterProbe();
      drawObstacles();
      drawObjective();
      // Draw shapes before players
      drawShapes();

      for (const bullet of bullets.values()) {
        const bulletX = bullet.renderX ?? bullet.x;
        const bulletY = bullet.renderY ?? bullet.y;
        const bulletRadius = bullet.radius ?? GAME_CONFIG.bullet.radius;
        if (!isWorldCircleVisible(bulletX, bulletY, bulletRadius, 96, worldViewport)) {
          continue;
        }
        drawBullet(bullet);
      }

      for (const projectile of predictedProjectiles.values()) {
        const projectileX = projectile.renderX ?? projectile.x;
        const projectileY = projectile.renderY ?? projectile.y;
        const projectileRadius = projectile.radius ?? GAME_CONFIG.bullet.radius;
        if (!isWorldCircleVisible(projectileX, projectileY, projectileRadius, 96, worldViewport)) {
          continue;
        }
        drawPredictedProjectile(projectile);
      }

      for (const player of players.values()) {
        const pose = getTankRenderPose(player);
        if (!isWorldCircleVisible(pose.x, pose.y, getPlayerBodyRadius(player) + 56, 112, worldViewport)) {
          continue;
        }
        drawTank(player, pose, frameAt);
      }

      drawShapeParticles(frameAt, worldViewport);
      drawCombatEffects(frameAt, worldViewport);
      context.restore();

      // Canvas HUD (drawn in screen space, not world space)
      drawCanvasKillFeed();
      drawMinimap();
      displayXp = lerp(displayXp, localXp, clamp(1 - Math.exp(-8 * deltaSeconds), 0.1, 0.5));
      drawXpBar();
      drawBasicSpecializationMenu();
      drawUpgradeMenu();

      if (debugUiEnabled) {
        drawOverlay();
      }
    }
    renderFailure = null;
  } catch (error) {
    renderFailure = error?.message ?? String(error);
    renderLoopStopped = true;
  }

  refreshTimedUi(frameAt, Boolean(renderFailure));
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
  refreshClassTabs();
  if (currentRoomId && socket?.readyState === WebSocket.OPEN) {
    sendLobbyUpdate("class", {
      classId: classSelect.value
    });
  }
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

  if (debugUiEnabled && event.code === DEBUG_AI_REPORT_HOTKEY && !event.repeat) {
    event.preventDefault();
    void copyAiDebugReportToClipboard();
    return;
  }

  if (event.code === "KeyR" && !event.repeat && isResultsPhase(latestMatch?.phase)) {
    const localPlayer = getLocalPlayer();
    if (localPlayer?.isSpectator ?? latestYou?.isSpectator) {
      return;
    }
    sendReady(!(localPlayer?.ready ?? latestYou?.ready ?? false));
    return;
  }

  if (isSpectatorSession() && !event.repeat) {
    if (["Equal", "NumpadAdd"].includes(event.code)) {
      event.preventDefault();
      applySpectatorCameraZoom(cameraZoom * SPECTATOR_CAMERA.zoomKeyFactor);
      return;
    }

    if (["Minus", "NumpadSubtract"].includes(event.code)) {
      event.preventDefault();
      applySpectatorCameraZoom(cameraZoom / SPECTATOR_CAMERA.zoomKeyFactor);
      return;
    }

    if (["Digit0", "Numpad0"].includes(event.code)) {
      event.preventDefault();
      centerSpectatorCamera();
      return;
    }
  }

  const hadKey = keys.has(event.code);
  keys.add(event.code);
  if (!hadKey) {
    markLocalInputChanged();
    dispatchLocalInput({ preferImmediate: true });
  }
});

window.addEventListener("keyup", (event) => {
  if (keys.delete(event.code)) {
    markLocalInputChanged();
    dispatchLocalInput({ preferImmediate: true });
  }
});

window.addEventListener("resize", resizeCanvas);

canvas.addEventListener("pointermove", (event) => {
  updateTrackedPointerPosition(event);
  markLocalAimChanged();
  dispatchLocalInput();
});

canvas.addEventListener("pointerdown", (event) => {
  unlockAudio();
  updateTrackedPointerPosition(event);
  markLocalAimChanged();
  if (event.button === 0) {
    const wasPrimaryDown = pointerPrimaryDown;
    pointerPrimaryDown = true;
    if (!wasPrimaryDown) {
      dispatchLocalInput({ preferImmediate: true });
    }
  }
});
window.addEventListener("pointerup", (event) => {
  if (event.button === 0) {
    const wasPrimaryDown = pointerPrimaryDown;
    pointerPrimaryDown = false;
    if (wasPrimaryDown) {
      markLocalInputChanged();
      dispatchLocalInput({ preferImmediate: true });
    }
  }
});
window.addEventListener("pointercancel", () => {
  const wasPrimaryDown = pointerPrimaryDown;
  pointerPrimaryDown = false;
  if (wasPrimaryDown) {
    markLocalInputChanged();
    dispatchLocalInput({ preferImmediate: true });
  }
});
window.addEventListener("blur", () => {
  const hadMovementInput = keys.size > 0 || pointerPrimaryDown;
  keys.clear();
  pointerPrimaryDown = false;
  if (hadMovementInput) {
    markLocalInputChanged();
    dispatchLocalInput({ preferImmediate: true });
  }
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();

  if (!isSpectatorSession()) {
    return;
  }

  const anchorWorldPosition = updateTrackedPointerPosition(event);
  const zoomFactor = Math.exp(-event.deltaY * SPECTATOR_CAMERA.wheelZoomStrength);
  applySpectatorCameraZoom(cameraZoom * zoomFactor, {
    anchorWorldPosition
  });
}, { passive: false });

setInterval(() => {
  clientSimulationTick += 1;
  simulatePredictedProjectiles(CLIENT_TICK.fixedDeltaSeconds);

  dispatchLocalInput({ force: true });
}, 1000 / CLIENT_TICK.rate);

setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) {
    const sentAt = Date.now();
    notePingSent(sentAt);
    send({
      type: MESSAGE_TYPES.PING,
      sentAt
    });
  }
}, 2000);

setInterval(() => {
  const now = Date.now();
  prunePendingPingSamples(now);
  prunePredictedShotExpectations(now);

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
const START_MENU_VIEWS = Object.freeze({
  home: "home",
  spectate: "spectate",
  debug: "debug",
  settings: "settings"
});
let activeStartMenuView = debugUiEnabled
  ? START_MENU_VIEWS.debug
  : spectateInput.checked
    ? START_MENU_VIEWS.spectate
    : START_MENU_VIEWS.home;

function getPreferredStartMenuView() {
  if (debugUiEnabled) {
    return START_MENU_VIEWS.debug;
  }

  return spectateInput.checked ? START_MENU_VIEWS.spectate : START_MENU_VIEWS.home;
}

function isStartMenuHidden() {
  return startMenuEl ? (startMenuEl.hidden || startMenuEl.classList.contains("hidden")) : true;
}

function setStartMenuView(view) {
  activeStartMenuView =
    view === START_MENU_VIEWS.settings
      ? START_MENU_VIEWS.settings
      : view === START_MENU_VIEWS.debug
        ? START_MENU_VIEWS.debug
      : view === START_MENU_VIEWS.spectate
        ? START_MENU_VIEWS.spectate
        : START_MENU_VIEWS.home;
  const showHome = activeStartMenuView === START_MENU_VIEWS.home;
  const showSpectate = activeStartMenuView === START_MENU_VIEWS.spectate;
  const showDebug = activeStartMenuView === START_MENU_VIEWS.debug;
  const showSettings = activeStartMenuView === START_MENU_VIEWS.settings;

  startHomeTabButton?.classList.toggle("is-active", showHome);
  startHomeTabButton?.setAttribute("aria-selected", String(showHome));
  startSpectateTabButton?.classList.toggle("is-active", showSpectate);
  startSpectateTabButton?.setAttribute("aria-selected", String(showSpectate));
  startDebugTabButton?.classList.toggle("is-active", showDebug);
  startDebugTabButton?.setAttribute("aria-selected", String(showDebug));
  startSettingsTabButton?.classList.toggle("is-active", showSettings);
  startSettingsTabButton?.setAttribute("aria-selected", String(showSettings));

  if (startHomePanel) {
    startHomePanel.hidden = !showHome;
  }
  if (startSpectatePanel) {
    startSpectatePanel.hidden = !showSpectate;
  }
  if (startDebugPanel) {
    startDebugPanel.hidden = !showDebug;
  }
  if (startSettingsPanel) {
    startSettingsPanel.hidden = !showSettings;
  }

  if (showSettings) {
    updateFullscreenControls();
  }
}

function updateFullscreenControls() {
  const isFullscreen = Boolean(document.fullscreenElement);

  fullscreenButton?.classList.toggle("is-active", isFullscreen);
  fullscreenButton?.setAttribute("aria-pressed", String(isFullscreen));

  if (fullscreenStatusElement) {
    fullscreenStatusElement.textContent = isFullscreen
      ? "Fullscreen is active. Press Esc whenever you want to leave it."
      : "Click Full Screen to enter fullscreen, then press Esc whenever you want to leave it.";
  }
}

async function enterFullscreenFromSettings() {
  if (document.fullscreenElement) {
    updateFullscreenControls();
    return;
  }

  if (!document.documentElement?.requestFullscreen) {
    if (fullscreenStatusElement) {
      fullscreenStatusElement.textContent = "Fullscreen is not available in this browser.";
    }
    return;
  }

  try {
    await document.documentElement.requestFullscreen();
  } catch (error) {
    console.warn("Failed to enter fullscreen", error);
    if (fullscreenStatusElement) {
      fullscreenStatusElement.textContent = "Fullscreen was blocked. Try clicking Full Screen again.";
    }
  }
}

function showStartMenu() {
  const wasHidden = isStartMenuHidden();
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
  if (wasHidden) {
    setStartMenuView(getPreferredStartMenuView());
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

function startMenuPlay(options = {}) {
  const { spectate = false, debug = false } = options;
  const nameVal = nameInput?.value?.trim() || createCommanderName();
  if (nameInput) {
    nameInput.value = nameVal;
  }
  spectateInput.checked = spectate;
  setDebugUiEnabled(debug, {
    persist: true,
    updateUrl: false
  });
  hideStartMenu();
  unlockAudio();
  void startQuickJoin({ spectate });
}

if (playButton) {
  playButton.addEventListener("click", () => {
    startMenuPlay({ spectate: false, debug: false });
  });
}

spectateButton?.addEventListener("click", () => {
  startMenuPlay({ spectate: true, debug: false });
});

debugPlayButton?.addEventListener("click", () => {
  startMenuPlay({ spectate: false, debug: true });
});

startHomeTabButton?.addEventListener("click", () => {
  setStartMenuView(START_MENU_VIEWS.home);
});

startSpectateTabButton?.addEventListener("click", () => {
  setStartMenuView(START_MENU_VIEWS.spectate);
});

startDebugTabButton?.addEventListener("click", () => {
  setStartMenuView(START_MENU_VIEWS.debug);
});

startSettingsTabButton?.addEventListener("click", () => {
  setStartMenuView(START_MENU_VIEWS.settings);
});

fullscreenButton?.addEventListener("click", () => {
  void enterFullscreenFromSettings();
});

document.addEventListener("fullscreenchange", updateFullscreenControls);

// Enter key in name input starts the game
if (nameInput && startMenuEl) {
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (activeStartMenuView === START_MENU_VIEWS.settings) {
        return;
      }
      startMenuPlay({
        spectate: activeStartMenuView === START_MENU_VIEWS.spectate,
        debug: activeStartMenuView === START_MENU_VIEWS.debug
      });
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
    const isHidden = document.hidden || (startMenuEl
      ? (startMenuEl.hidden || startMenuEl.classList.contains("hidden"))
      : true);
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
    const isHidden = document.hidden || (startMenuEl
      ? (startMenuEl.hidden || startMenuEl.classList.contains("hidden"))
      : true);
    if (!isHidden && !animId) {
      animId = requestAnimationFrame(drawBg);
    }
  }

  window.addEventListener("resize", () => {
    resize();
    initDots();
  });
  document.addEventListener("visibilitychange", restartBgAnimation);

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
  if (handleBasicSpecializationClick(cx, cy)) {
    return;
  }
  if (handleUpgradeClick(cx, cy)) {
    return;
  }
});

// Show start menu or play area based on session state
function syncStartMenuVisibility() {
  if (currentRoomId && hasSeenLocalPlayerSnapshot) {
    hideStartMenu();
  } else if (!joinInProgress) {
    showStartMenu();
  }
}

// Sync the start menu whenever session chrome changes without polling.
updateSessionChrome = function updateSessionChromeWithStartMenu() {
  origUpdateSessionChrome();
  syncStartMenuVisibility();
};

// Initial state: show start menu
updateFullscreenControls();
setStartMenuView(activeStartMenuView);
showStartMenu();
syncClassTabsVisibility();

resizeCanvas();
render();
refreshRoomBrowser();
