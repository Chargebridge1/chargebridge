import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function assertToolchain(nodeVersion, pnpmVersion, manifest) {
  if (!/^v24\.\d+\.\d+$/.test(nodeVersion) ||
      pnpmVersion.trim() !== "10.26.1" ||
      manifest.engines?.node !== "24.x" ||
      manifest.packageManager !== "pnpm@10.26.1") {
    throw new Error("Staging DigitalOcean build requires Node 24.x and pnpm 10.26.1");
  }
}

export function buildCommands(component) {
  const filters = {
    web: "@workspace/ev-charger",
    api: "@workspace/api-server",
  };
  if (!Object.hasOwn(filters, component)) {
    throw new Error("Staging DigitalOcean build requires exactly web or api");
  }
  return [
    ["install", "--frozen-lockfile", "--prod=false"],
    ["--filter", filters[component], "run", "build"],
  ];
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.signal})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const version = spawnSync("pnpm", ["--version"], { cwd: root, encoding: "utf8" });
  if (version.error || version.status !== 0) {
    throw version.error ?? new Error("Cannot determine pnpm version");
  }
  assertToolchain(process.version, version.stdout, manifest);
  const commands = buildCommands(process.argv[2]);
  process.stdout.write(`Staging build: Node ${process.version}, pnpm ${version.stdout.trim()}, component ${process.argv[2]}\n`);
  for (const args of commands) run("pnpm", args);
}