import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const command = process.argv[2] ?? "up";
const imageTag = process.env.RENDER_LOCAL_IMAGE_TAG ?? "multitank-render-local";
const containerName = process.env.RENDER_LOCAL_CONTAINER_NAME ?? "multitank-render-local";
const hostPort = Math.max(1, Number(process.env.RENDER_LOCAL_PORT ?? 10000) || 10000);
const containerPort = Math.max(1, Number(process.env.RENDER_LOCAL_CONTAINER_PORT ?? 10000) || 10000);
const adminApiKey = process.env.RENDER_LOCAL_ADMIN_API_KEY ?? "render-local-admin-key";
const allocatorApiKey = process.env.RENDER_LOCAL_ALLOCATOR_API_KEY ?? "render-local-allocator-key";
const deployRegion = process.env.RENDER_LOCAL_DEPLOY_REGION ?? "render-local";
const instanceGroup = process.env.RENDER_LOCAL_INSTANCE_GROUP ?? "preview";
const dataDir =
  process.env.RENDER_LOCAL_DATA_DIR
    ? path.resolve(process.env.RENDER_LOCAL_DATA_DIR)
    : path.join(repoRoot, ".render-local-data");
const gameVersion = process.env.RENDER_LOCAL_GAME_VERSION ?? packageJson.version ?? "0.1.0";

function createLegacyProfileSeed() {
  return {
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
  };
}

function toDockerVolumePath(hostPath) {
  return path.resolve(hostPath).replace(/\\/g, "/");
}

function seedDataDirectory(targetDir, options = {}) {
  const { overwrite = false } = options;
  fs.mkdirSync(targetDir, { recursive: true });
  const profilesPath = path.join(targetDir, "profiles.json");
  if (!overwrite && fs.existsSync(profilesPath)) {
    return;
  }

  fs.writeFileSync(profilesPath, `${JSON.stringify(createLegacyProfileSeed(), null, 2)}\n`, "utf8");
}

function runCommand(commandName, args, options = {}) {
  const {
    cwd = repoRoot,
    env = process.env,
    stdio = "inherit",
    allowFailure = false
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd,
      env,
      stdio
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) {
        resolve({
          code,
          stdout,
          stderr
        });
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `${commandName} ${args.join(" ")} failed with exit code ${code}`
        )
      );
    });
  });
}

async function buildImage() {
  console.log(`Building Docker image ${imageTag}...`);
  await runCommand("docker", ["build", "-t", imageTag, "."], {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

async function ensureDockerAvailable() {
  try {
    await runCommand("docker", ["--version"], {
      cwd: repoRoot,
      stdio: "ignore"
    });
  } catch (error) {
    throw new Error("Docker is required for render:local commands. Start Docker Desktop or install Docker first.");
  }
}

async function removeContainer() {
  await runCommand("docker", ["rm", "-f", containerName], {
    allowFailure: true,
    stdio: "ignore"
  });
}

async function startContainer(targetDataDir) {
  seedDataDirectory(targetDataDir);
  await removeContainer();

  const args = [
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-p",
    `${hostPort}:${containerPort}`,
    "-v",
    `${toDockerVolumePath(targetDataDir)}:/var/data`,
    "-e",
    "NODE_ENV=production",
    "-e",
    "HOST=0.0.0.0",
    "-e",
    `PORT=${containerPort}`,
    "-e",
    "DATA_DIR=/var/data",
    "-e",
    `GAME_VERSION=${gameVersion}`,
    "-e",
    `DEPLOY_REGION=${deployRegion}`,
    "-e",
    `INSTANCE_GROUP=${instanceGroup}`,
    "-e",
    `ADMIN_API_KEY=${adminApiKey}`,
    "-e",
    `ALLOCATOR_API_KEY=${allocatorApiKey}`,
    imageTag
  ];

  const result = await runCommand("docker", args, {
    cwd: repoRoot,
    stdio: "pipe"
  });

  const containerId = result.stdout.trim();
  if (!containerId) {
    throw new Error("Docker did not return a container id");
  }
}

async function waitForServerReady(baseUrl, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // Keep retrying while the container comes up.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${baseUrl}/readyz`);
}

async function runSmokeAgainstContainer(baseUrl, targetDataDir) {
  const wsUrl = baseUrl.replace(/^http/i, "ws");

  await runCommand(process.execPath, ["smoke-test.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SMOKE_EXTERNAL: "1",
      SMOKE_BASE_URL: baseUrl,
      SMOKE_WS_URL: wsUrl,
      SMOKE_ADMIN_API_KEY: adminApiKey,
      SMOKE_ALLOCATOR_API_KEY: allocatorApiKey,
      SMOKE_DEPLOY_REGION: deployRegion,
      ...(targetDataDir ? { SMOKE_DATA_DIR: targetDataDir } : {})
    },
    stdio: "inherit"
  });
}

async function up() {
  await ensureDockerAvailable();
  await buildImage();
  await startContainer(dataDir);
  const baseUrl = `http://127.0.0.1:${hostPort}`;
  await waitForServerReady(baseUrl);

  console.log("");
  console.log(`Render-like local preview is running in Docker.`);
  console.log(`HTTP: ${baseUrl}`);
  console.log(`WebSocket: ${baseUrl.replace(/^http/i, "ws")}`);
  console.log(`Data dir: ${dataDir}`);
  console.log(`Admin key: ${adminApiKey}`);
  console.log(`Allocator key: ${allocatorApiKey}`);
  console.log(`Stop it with: npm run render:local:down`);
  console.log(`Tail logs with: npm run render:local:logs`);
}

async function down() {
  await ensureDockerAvailable();
  await removeContainer();
  console.log(`Stopped ${containerName} if it was running.`);
}

async function logs() {
  await ensureDockerAvailable();
  await runCommand("docker", ["logs", "-f", containerName], {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

async function smoke() {
  await ensureDockerAvailable();
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "multitank-render-local-"));
  const baseUrl = `http://127.0.0.1:${hostPort}`;
  seedDataDirectory(tempDataDir, { overwrite: true });

  try {
    await buildImage();
    await startContainer(tempDataDir);
    await waitForServerReady(baseUrl);
    await runSmokeAgainstContainer(baseUrl, tempDataDir);
  } finally {
    await removeContainer();
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

async function main() {
  switch (command) {
    case "up":
      await up();
      break;
    case "down":
      await down();
      break;
    case "logs":
      await logs();
      break;
    case "smoke":
      await smoke();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
