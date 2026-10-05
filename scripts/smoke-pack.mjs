// Smoke test of the PUBLISHED shape: what an npm consumer actually gets.
//
// Builds and `pnpm pack`s the three public packages, installs the tarballs into a
// blank app outside the workspace (strict pnpm layout: no hoisting, so a missing
// dependency fails here instead of on a user's machine), and builds and runs the
// renderer README's Quickstart in a real browser.
//
// The app's entry module IS the README's Quickstart block, extracted verbatim:
// the snippet users copy is the thing under test. That is what caught the
// top-level `await graph.ready` deadlock (blank page, no error) — it only shows in
// a production bundle, so this runs `vite build` + `vite preview`, never dev.
//
// Vite and Playwright come from the workspace (apps/demo); the consumer installs
// only the tarballs and their dependencies, from the pnpm store when possible.
// Not part of `pnpm test`: it needs a build, a browser, and possibly the network.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["tokens", "core", "renderer"];
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

// realpath: on macOS tmpdir() is under /var, a symlink to /private/var, and Vite
// rejects the html entry it then sees as escaping the root.
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "datagraph-smoke-")));
const tgzDir = join(tmp, "tgz");
const app = join(tmp, "app");
mkdirSync(join(app, "src"), { recursive: true });

let ok = false;
try {
  for (const p of packages) run("pnpm", ["--filter", `./packages/${p}`, "build"], root);
  for (const p of packages) run("pnpm", ["pack", "--pack-destination", tgzDir], join(root, "packages", p));

  const tgz = Object.fromEntries(
    readdirSync(tgzDir).map((f) => [
      f.replace(/^defsquare-/, "@defsquare/").replace(/-\d+\.\d+\.\d+.*\.tgz$/, ""),
      `file:${join(tgzDir, f)}`,
    ]),
  );

  // The renderer's tarball depends on core/tokens by VERSION (pnpm rewrote
  // `workspace:*`), and they are not on the registry: overrides point them at
  // the local tarballs, as a published release would resolve them.
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module", dependencies: tgz }, null, 2));
  writeFileSync(
    join(app, "pnpm-workspace.yaml"),
    `packages: []\noverrides:\n${Object.entries(tgz).map(([k, v]) => `  "${k}": "${v}"`).join("\n")}\n`,
  );

  const readme = readFileSync(join(root, "packages/renderer/README.md"), "utf8");
  const quickstart = readme.split("## Quickstart")[1]?.match(/```ts\n([\s\S]*?)```/)?.[1];
  if (!quickstart) throw new Error("no ```ts block under '## Quickstart' in packages/renderer/README.md");
  writeFileSync(join(app, "src/main.ts"), `${quickstart}\ngraph.ready.then(() => { document.title = "ready"; });\n`);
  writeFileSync(join(app, "index.html"), `<div id="app" style="width:800px;height:600px"></div><script type="module" src="/src/main.ts"></script>\n`);
  // skipLibCheck: elkjs's own .d.ts fails under strict lib checking — its bug,
  // and the setting nearly every consumer runs with.
  writeFileSync(
    join(app, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, lib: ["es2022", "dom"], skipLibCheck: true, noEmit: true },
      include: ["src"],
    }),
  );

  run("pnpm", ["install", "--prefer-offline"], app);
  run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", app], app);

  const demoRequire = createRequire(join(root, "apps/demo/package.json"));
  const vite = await import(pathToFileURL(join(dirname(demoRequire.resolve("vite/package.json")), "dist/node/index.js")).href);
  const { chromium } = demoRequire("@playwright/test");

  // es2022: the target the README tells Vite 6 users to set. Vite 6's default
  // target list makes its import scanner choke on the minified elkjs bundle.
  await vite.build({ root: app, configFile: false, logLevel: "warn", build: { target: "es2022" } });
  const server = await vite.preview({ root: app, configFile: false, logLevel: "warn", preview: { port: 0 } });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => document.title === "ready", null, { timeout: 20_000 }).catch(() => {
      throw new Error(`graph.ready never resolved in the production build${errors.length ? `: ${errors.join("; ")}` : " (no page error: a deadlock?)"}`);
    });
    if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
    if ((await page.locator("#app canvas").count()) !== 1) throw new Error("no canvas mounted in #app");
  } finally {
    await browser.close();
    await server.close();
  }
  ok = true;
  console.log("\nsmoke-pack: OK — the packed tarballs install, typecheck, build and render the README Quickstart.");
} finally {
  if (ok) rmSync(tmp, { recursive: true, force: true });
  else console.error(`\nsmoke-pack: FAILED — consumer app kept at ${app}`);
}
