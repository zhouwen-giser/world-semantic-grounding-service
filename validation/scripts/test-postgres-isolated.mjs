import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

// Only the container created here is removed. No host volumes or existing
// PostgreSQL instance are used by these destructive persistence tests.
const name = `wsgs-postgres-test-${randomBytes(6).toString("hex")}`;
const password = randomBytes(24).toString("hex");
const image = process.argv[2] ?? "postgres:17";
let containerId;
let interrupted = false;
let active;
function run(command, args, { capture = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, timeout: command === "docker" ? 30_000 : 600_000,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    active = child;
    let output = "";
    if (capture) {
      child.stdout.on("data", chunk => { output += chunk; });
      // Docker diagnostics cannot include the generated database password.
      child.stderr.on("data", chunk => { output += chunk; });
    }
    child.on("error", reject);
    child.on("close", code => {
      if (active === child) active = undefined;
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} failed (${code ?? "signal"})${capture ? `: ${output.replaceAll(password, "[redacted]").trim()}` : ""}`));
    });
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = true;
  active?.kill("SIGTERM");
});
try {
  const endpoint = process.env.DOCKER_HOST ?? await run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { capture: true });
  if (!/^(?:unix:|npipe:|tcp:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?$)/u.test(endpoint)) {
    throw new Error("Isolated tests require a local Docker endpoint");
  }
  containerId = await run("docker", ["run", "--detach", "--pull=never", "--name", name,
    "--label", "io.wsgs.purpose=isolated-integration-test", "--publish", "127.0.0.1::5432",
    "--mount", "type=tmpfs,destination=/var/lib/postgresql/data", "--env", "POSTGRES_USER=wsgs_test",
    "--env", "POSTGRES_DB=postgres",
    "--env", "POSTGRES_PASSWORD", image], { capture: true, env: { ...process.env, POSTGRES_PASSWORD: password } });
  let ready = false;
  for (let attempt = 0; attempt < 60 && !interrupted; attempt++) {
    try {
      await run("docker", ["exec", containerId, "pg_isready", "--host=127.0.0.1", "--username=wsgs_test", "--dbname=postgres"], { capture: true });
      ready = true; break;
    } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!ready) throw new Error("Isolated PostgreSQL did not become ready");
  const binding = await run("docker", ["port", containerId, "5432/tcp"], { capture: true });
  if (!/^127\.0\.0\.1:\d+$/u.test(binding)) throw new Error("PostgreSQL test port is not loopback-only");
  for (const database of ["wsgs_test", "wsgs_upgrade_test"]) {
    await run("docker", ["exec", containerId, "createdb", "--host=127.0.0.1", "--username=wsgs_test", database], { capture: true });
  }
  const env = { ...process.env,
    TEST_DATABASE_URL: `postgresql://wsgs_test:${password}@${binding}/wsgs_test`,
    TEST_UPGRADE_DATABASE_URL: `postgresql://wsgs_test:${password}@${binding}/wsgs_upgrade_test` };
  // These suites truncate the same schema; serialization is intentional.
  for (const file of ["packages/runtime/src/job-store.integration.test.ts",
    "services/grounding-api/src/production.integration.test.ts",
    "services/grounding-worker/src/postgres.integration.test.ts",
    "packages/runtime/src/migration-002.integration.test.ts"]) {
    if (interrupted) throw new Error("Isolated PostgreSQL tests interrupted");
    await run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", file], { env });
  }
} catch (error) {
  console.error(error.message.replaceAll(password, "[redacted]"));
  process.exitCode = 1;
} finally {
  if (containerId) {
    try { await run("docker", ["rm", "--force", "--volumes", containerId], { capture: true }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
