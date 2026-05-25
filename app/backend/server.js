import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const distDir = path.join(rootDir, "dist");
const sourcePublicDir = path.join(rootDir, "app", "frontend");
const configPath = path.join(rootDir, "workbench.config.json");

let workbenchConfig = await loadWorkbenchConfig();
let dataRootDir;
let strategiesDir;
let metadataDir;
let registryPath;

applyPathConfig(workbenchConfig);

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function loadWorkbenchConfig() {
  try {
    return JSON.parse(await readFile(configPath, "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function resolveMaybeRelative(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(rootDir, value);
}

function applyPathConfig(config) {
  dataRootDir = resolveMaybeRelative(process.env.WORKBENCH_DATA_ROOT || config.paths?.dataRoot || rootDir);
  strategiesDir = resolveMaybeRelative(
    process.env.WORKBENCH_STRATEGIES_DIR || config.paths?.strategies || path.join(dataRootDir, "strategies")
  );
  metadataDir = resolveMaybeRelative(
    process.env.WORKBENCH_METADATA_DIR || config.paths?.metadata || path.join(dataRootDir, "metadata")
  );
  registryPath = path.join(metadataDir, "registry.db");
}

function publicConfig() {
  return {
    paths: {
      root: rootDir,
      dataRoot: dataRootDir,
      strategies: strategiesDir,
      metadata: metadataDir,
      registry: registryPath
    },
    lockedByEnv: {
      dataRoot: Boolean(process.env.WORKBENCH_DATA_ROOT),
      strategies: Boolean(process.env.WORKBENCH_STRATEGIES_DIR),
      metadata: Boolean(process.env.WORKBENCH_METADATA_DIR)
    }
  };
}

async function updateWorkbenchConfig(payload) {
  const nextConfig = {
    ...workbenchConfig,
    paths: {
      ...(workbenchConfig.paths || {}),
      strategies: String(payload.paths?.strategies || payload.strategies || "").trim(),
      metadata: String(payload.paths?.metadata || payload.metadata || "").trim()
    }
  };

  if (!nextConfig.paths.strategies) throw new Error("Strategies path is required.");
  if (!nextConfig.paths.metadata) throw new Error("Metadata path is required.");

  await writeFile(configPath, JSON.stringify(nextConfig, null, 2), "utf-8");
  workbenchConfig = nextConfig;
  applyPathConfig(workbenchConfig);
  await ensureBaseDirs();
  await writeRegistry();
  return publicConfig();
}

function displayPath(target) {
  const relative = path.relative(rootDir, target);
  const isOutsideRoot = relative.startsWith("..") || path.isAbsolute(relative);
  return (isOutsideRoot ? target : relative).replaceAll("\\", "/");
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function methodNotAllowed(res) {
  json(res, 405, { error: "Method not allowed" });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function assertSlug(slug, fieldName) {
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(slug)) {
    throw new Error(`${fieldName} must use 2-64 lowercase letters, numbers, underscores, or hyphens.`);
  }
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function ensureBaseDirs() {
  await mkdir(strategiesDir, { recursive: true });
  await mkdir(metadataDir, { recursive: true });
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf-8"));
}

async function listFamilyRecords() {
  await ensureBaseDirs();
  const entries = await readdir(strategiesDir, { withFileTypes: true });
  const families = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const familyPath = path.join(strategiesDir, entry.name);
    const familyJsonPath = path.join(familyPath, "family.json");
    if (!(await pathExists(familyJsonPath))) continue;
    const family = await readJsonFile(familyJsonPath);
    families.push({
      ...family,
      path: displayPath(familyPath),
      variants: await listVariantRecords(family.slug)
    });
  }
  return families.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function listVariantRecords(familySlug) {
  const variantsPath = path.join(strategiesDir, familySlug, "variants");
  if (!(await pathExists(variantsPath))) return [];
  const entries = await readdir(variantsPath, { withFileTypes: true });
  const variants = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const variantPath = path.join(variantsPath, entry.name);
    const strategyJsonPath = path.join(variantPath, "strategy.json");
    if (!(await pathExists(strategyJsonPath))) continue;
    const strategy = await readJsonFile(strategyJsonPath);
    variants.push({
      ...strategy,
      path: displayPath(variantPath)
    });
  }
  return variants.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function writeRegistry() {
  const families = await listFamilyRecords();
  const registry = {
    schemaVersion: 1,
    rebuiltAt: nowIso(),
    families: families.map(({ variants, ...family }) => family),
    variants: families.flatMap((family) => family.variants)
  };
  await writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
  return registry;
}

async function readRegistry() {
  await ensureBaseDirs();
  if (!(await pathExists(registryPath))) {
    return writeRegistry();
  }
  return readJsonFile(registryPath);
}

async function createFamily(payload) {
  await ensureBaseDirs();
  const slug = normalizeSlug(payload.slug);
  assertSlug(slug, "Family slug");
  if (!payload.name?.trim()) throw new Error("Family name is required.");

  const familyPath = path.join(strategiesDir, slug);
  if (await pathExists(familyPath)) throw new Error("Family slug already exists.");

  const timestamp = nowIso();
  const family = {
    id: makeId("fam"),
    slug,
    name: payload.name.trim(),
    description: String(payload.description || "").trim(),
    researchType: payload.researchType || "signal",
    signalType: payload.signalType || "cross_sectional",
    status: payload.status || "draft",
    tags: normalizeTags(payload.tags),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await mkdir(path.join(familyPath, "variants"), { recursive: true });
  await writeFile(path.join(familyPath, "family.json"), JSON.stringify(family, null, 2), "utf-8");
  await writeFile(
    path.join(familyPath, "README.md"),
    `# ${family.name}\n\n${family.description || "Describe the research logic here."}\n`,
    "utf-8"
  );
  await writeRegistry();
  return family;
}

async function createVariant(familySlug, payload) {
  await ensureBaseDirs();
  assertSlug(familySlug, "Family slug");
  const familyPath = path.join(strategiesDir, familySlug);
  const family = await readJsonFile(path.join(familyPath, "family.json"));
  const slug = normalizeSlug(payload.slug);
  assertSlug(slug, "Variant slug");
  if (!payload.name?.trim()) throw new Error("Variant name is required.");

  const variantPath = path.join(familyPath, "variants", slug);
  if (await pathExists(variantPath)) throw new Error("Variant slug already exists in this family.");

  const timestamp = nowIso();
  const strategy = {
    id: makeId("strat"),
    familyId: family.id,
    familySlug: family.slug,
    slug,
    name: payload.name.trim(),
    description: String(payload.description || "").trim(),
    assetClass: payload.assetClass || "",
    universe: String(payload.universe || "").trim(),
    frequency: payload.frequency || "",
    rebalanceFrequency: payload.rebalanceFrequency || "",
    holdingPeriod: String(payload.holdingPeriod || "").trim(),
    implementationType: String(payload.implementationType || "").trim(),
    implementationNotes: String(payload.implementationNotes || "").trim(),
    status: payload.status || "draft",
    tags: normalizeTags(payload.tags),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await mkdir(path.join(variantPath, "src"), { recursive: true });
  await writeFile(path.join(variantPath, "strategy.json"), JSON.stringify(strategy, null, 2), "utf-8");
  await writeFile(
    path.join(variantPath, "README.md"),
    `# ${strategy.name}\n\n${strategy.description || "Describe this concrete implementation here."}\n`,
    "utf-8"
  );
  await writeFile(path.join(variantPath, "src", ".gitkeep"), "", "utf-8");
  family.updatedAt = timestamp;
  await writeFile(path.join(familyPath, "family.json"), JSON.stringify(family, null, 2), "utf-8");
  await writeRegistry();
  return strategy;
}

async function updateFamily(familySlug, payload) {
  await ensureBaseDirs();
  assertSlug(familySlug, "Family slug");
  const familyPath = path.join(strategiesDir, familySlug);
  const familyJsonPath = path.join(familyPath, "family.json");
  const family = await readJsonFile(familyJsonPath);
  if (!payload.name?.trim()) throw new Error("Family name is required.");

  const updated = {
    ...family,
    name: payload.name.trim(),
    description: String(payload.description || "").trim(),
    researchType: payload.researchType || family.researchType || "signal",
    signalType: payload.signalType || family.signalType || "cross_sectional",
    status: payload.status || family.status || "draft",
    tags: normalizeTags(payload.tags),
    updatedAt: nowIso()
  };

  await writeFile(familyJsonPath, JSON.stringify(updated, null, 2), "utf-8");
  await writeRegistry();
  return updated;
}

async function updateVariant(familySlug, variantSlug, payload) {
  await ensureBaseDirs();
  assertSlug(familySlug, "Family slug");
  assertSlug(variantSlug, "Variant slug");
  const familyPath = path.join(strategiesDir, familySlug);
  const familyJsonPath = path.join(familyPath, "family.json");
  const variantJsonPath = path.join(familyPath, "variants", variantSlug, "strategy.json");
  const family = await readJsonFile(familyJsonPath);
  const variant = await readJsonFile(variantJsonPath);
  if (!payload.name?.trim()) throw new Error("Variant name is required.");

  const timestamp = nowIso();
  const updated = {
    ...variant,
    name: payload.name.trim(),
    description: String(payload.description || "").trim(),
    assetClass: payload.assetClass || "",
    universe: String(payload.universe || "").trim(),
    frequency: payload.frequency || "",
    rebalanceFrequency: payload.rebalanceFrequency || "",
    holdingPeriod: String(payload.holdingPeriod || "").trim(),
    implementationType: String(payload.implementationType || "").trim(),
    implementationNotes: String(payload.implementationNotes || "").trim(),
    status: payload.status || variant.status || "draft",
    tags: normalizeTags(payload.tags),
    updatedAt: timestamp
  };

  family.updatedAt = timestamp;
  await writeFile(variantJsonPath, JSON.stringify(updated, null, 2), "utf-8");
  await writeFile(familyJsonPath, JSON.stringify(family, null, 2), "utf-8");
  await writeRegistry();
  return updated;
}

async function handleApi(req, res, pathname) {
  try {
    if (pathname === "/api/registry" && req.method === "GET") {
      return json(res, 200, await readRegistry());
    }
    if (pathname === "/api/config" && req.method === "GET") {
      return json(res, 200, publicConfig());
    }
    if (pathname === "/api/config" && req.method === "PUT") {
      return json(res, 200, await updateWorkbenchConfig(await readBody(req)));
    }
    if (pathname === "/api/metadata/rebuild" && req.method === "POST") {
      return json(res, 200, await writeRegistry());
    }
    if (pathname === "/api/families" && req.method === "GET") {
      return json(res, 200, await listFamilyRecords());
    }
    if (pathname === "/api/families" && req.method === "POST") {
      return json(res, 201, await createFamily(await readBody(req)));
    }
    const familyMatch = pathname.match(/^\/api\/families\/([^/]+)$/);
    if (familyMatch && req.method === "PUT") {
      return json(res, 200, await updateFamily(decodeURIComponent(familyMatch[1]), await readBody(req)));
    }
    const variantMatch = pathname.match(/^\/api\/families\/([^/]+)\/variants$/);
    if (variantMatch && req.method === "GET") {
      return json(res, 200, await listVariantRecords(decodeURIComponent(variantMatch[1])));
    }
    if (variantMatch && req.method === "POST") {
      return json(res, 201, await createVariant(decodeURIComponent(variantMatch[1]), await readBody(req)));
    }
    const variantDetailMatch = pathname.match(/^\/api\/families\/([^/]+)\/variants\/([^/]+)$/);
    if (variantDetailMatch && req.method === "PUT") {
      return json(
        res,
        200,
        await updateVariant(
          decodeURIComponent(variantDetailMatch[1]),
          decodeURIComponent(variantDetailMatch[2]),
          await readBody(req)
        )
      );
    }
    return methodNotAllowed(res);
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
}

async function serveStatic(req, res, pathname) {
  const publicDir = (await pathExists(distDir)) ? distDir : sourcePublicDir;
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    return json(res, 403, { error: "Forbidden" });
  }
  try {
    await stat(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    res.writeHead(302, { Location: "/" });
    res.end();
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url.pathname);
  }
  return serveStatic(req, res, url.pathname);
});

await ensureBaseDirs();
await writeRegistry();

server.listen(port, host, () => {
  console.log(`Quant Research Workbench listening on http://${host}:${port}`);
  if (host === "0.0.0.0") {
    console.log(`Open it from this machine at http://localhost:${port}`);
    console.log(`Open it on your LAN at http://<server-lan-ip>:${port}`);
  }
});
