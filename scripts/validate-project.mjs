import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const errors = [];
const warnings = [];

const toPosix = (value) => value.split(path.sep).join("/");
const projectPath = (relativePath) => path.resolve(projectRoot, relativePath);

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function isFile(relativePath) {
  try {
    return (await stat(projectPath(relativePath))).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(relativePath) {
  try {
    return (await stat(projectPath(relativePath))).isDirectory();
  } catch {
    return false;
  }
}

function syntaxCheck(relativePath) {
  const result = spawnSync(process.execPath, ["--check", projectPath(relativePath)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "syntax check failed").trim();
    fail(`${relativePath} does not parse:\n${detail}`);
  }
}

function localReference(reference) {
  if (!reference || /^(?:[a-z]+:)?\/\//i.test(reference) || reference.startsWith("data:")) return null;
  const clean = reference.split(/[?#]/, 1)[0].replace(/^\.\//, "");
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function parseCopySteps(workflowSource) {
  const staged = new Set();
  const unsafe = [];

  for (const rawLine of workflowSource.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("cp ")) continue;
    const tokens = line.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) || [];
    const destination = tokens.at(-1)?.replace(/\\/g, "/");
    if (!destination?.startsWith("_site")) continue;

    const sources = tokens.slice(1, -1).filter((token) => !token.startsWith("-"));
    for (const source of sources) {
      const normalized = source.replace(/^\.\//, "").replace(/[\\/]+$/, "").replace(/\\/g, "/");
      staged.add(normalized);
      if (normalized === "." || normalized === "" || normalized === "project-data" || normalized.startsWith("project-data/private")) {
        unsafe.push(normalized || ".");
      }
    }
  }

  return { staged, unsafe };
}

function isStaged(relativePath, staged) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const source of staged) {
    if (source === normalized || normalized.startsWith(`${source}/`)) return true;
  }
  return false;
}

function collectAssetReferences(value, references) {
  if (typeof value === "string") {
    const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").split(/[?#]/, 1)[0];
    if (normalized.startsWith("assets/")) references.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetReferences(item, references);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectAssetReferences(item, references);
  }
}

async function walkFiles(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(entryPath, base));
    else if (entry.isFile()) files.push(toPosix(path.relative(projectRoot, entryPath)));
  }
  return files;
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    fail("catalog-data.js did not define window.PORTFOLIO_CATALOG as an object.");
    return { productCount: 0, assetReferences: new Set() };
  }
  if (!Array.isArray(catalog.categories) || catalog.categories.length === 0) {
    fail("The catalog must contain at least one category.");
    return { productCount: 0, assetReferences: new Set() };
  }

  const categoryIds = new Set();
  const productIds = new Set();
  let productCount = 0;

  for (const [categoryIndex, category] of catalog.categories.entries()) {
    const location = `categories[${categoryIndex}]`;
    if (!category || typeof category !== "object") {
      fail(`${location} must be an object.`);
      continue;
    }
    if (typeof category.id !== "string" || !category.id.trim()) fail(`${location}.id must be a non-empty string.`);
    else if (categoryIds.has(category.id)) fail(`Duplicate category id: ${category.id}`);
    else categoryIds.add(category.id);
    if (typeof category.name !== "string" || !category.name.trim()) fail(`${location}.name must be a non-empty string.`);

    const laneIds = new Set();
    if (!Array.isArray(category.lanes) || category.lanes.length === 0) {
      fail(`${location}.lanes must contain at least one lane.`);
    } else {
      for (const [laneIndex, lane] of category.lanes.entries()) {
        const laneLocation = `${location}.lanes[${laneIndex}]`;
        if (!lane || typeof lane !== "object") {
          fail(`${laneLocation} must be an object.`);
          continue;
        }
        if (typeof lane.id !== "string" || !lane.id.trim()) fail(`${laneLocation}.id must be a non-empty string.`);
        else if (laneIds.has(lane.id)) fail(`Duplicate lane id "${lane.id}" in category "${category.id}".`);
        else laneIds.add(lane.id);
        if (typeof lane.label !== "string" || !lane.label.trim()) fail(`${laneLocation}.label must be a non-empty string.`);
      }
    }

    const specSetIds = new Set();
    if (!Array.isArray(category.specSets) || category.specSets.length === 0) {
      fail(`${location}.specSets must contain at least one specification set.`);
    } else {
      for (const [setIndex, specSet] of category.specSets.entries()) {
        const setLocation = `${location}.specSets[${setIndex}]`;
        if (!specSet || typeof specSet !== "object") {
          fail(`${setLocation} must be an object.`);
          continue;
        }
        if (typeof specSet.id !== "string" || !specSet.id.trim()) fail(`${setLocation}.id must be a non-empty string.`);
        else if (specSetIds.has(specSet.id)) fail(`Duplicate spec-set id "${specSet.id}" in category "${category.id}".`);
        else specSetIds.add(specSet.id);
        if (!Array.isArray(specSet.specs)) fail(`${setLocation}.specs must be an array.`);
        else {
          for (const [specIndex, spec] of specSet.specs.entries()) {
            if (!Array.isArray(spec) || spec.length < 2 || typeof spec[0] !== "string") {
              fail(`${setLocation}.specs[${specIndex}] must be a [label, value] pair.`);
            }
          }
        }
      }
    }
    if (typeof category.defaultSpecSetId !== "string" || !specSetIds.has(category.defaultSpecSetId)) {
      fail(`${location}.defaultSpecSetId must reference a spec set in the same category.`);
    }

    if (!Array.isArray(category.products)) {
      fail(`${location}.products must be an array.`);
      continue;
    }
    productCount += category.products.length;
    for (const [productIndex, product] of category.products.entries()) {
      const productLocation = `${location}.products[${productIndex}]`;
      if (!product || typeof product !== "object") {
        fail(`${productLocation} must be an object.`);
        continue;
      }
      if (typeof product.id !== "string" || !product.id.trim()) fail(`${productLocation}.id must be a non-empty string.`);
      else if (productIds.has(product.id)) fail(`Duplicate product id: ${product.id}`);
      else productIds.add(product.id);
      if (product.laneId && !laneIds.has(product.laneId)) fail(`${productLocation}.laneId references an unknown lane.`);
      if (product.specSetId && !specSetIds.has(product.specSetId)) fail(`${productLocation}.specSetId references an unknown spec set.`);
    }
  }

  if (productCount === 0) {
    warn("The catalog contains 0 products. This is allowed, but the default workspace will open with empty category lanes.");
  }

  const assetReferences = new Set();
  collectAssetReferences(catalog, assetReferences);
  return { productCount, assetReferences };
}

for (const sourceFile of ["app.js", "ascm-import.js", "catalog-data.js", "pptx-pagination.js", "scripts/serve.mjs"]) {
  if (!await isFile(sourceFile)) fail(`Missing required JavaScript file: ${sourceFile}`);
  else syntaxCheck(sourceFile);
}

const htmlSource = await readFile(projectPath("index.html"), "utf8");
const scriptReferences = [...htmlSource.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
  .map((match) => localReference(match[1]))
  .filter(Boolean);
const stylesheetReferences = [...htmlSource.matchAll(/<link\b[^>]*\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)]
  .map((match) => localReference(match[1]))
  .filter(Boolean);

for (const reference of [...scriptReferences, ...stylesheetReferences]) {
  if (!await isFile(reference)) fail(`index.html references a missing local runtime file: ${reference}`);
}

const ids = [...htmlSource.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length > 0) fail(`Duplicate HTML id values: ${duplicateIds.join(", ")}`);

const workflowSource = await readFile(projectPath(".github/workflows/deploy.yml"), "utf8");
const { staged, unsafe } = parseCopySteps(workflowSource);
const requiredDeploymentEntries = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "catalog-data.js",
  "assets",
  "vendor",
  ...scriptReferences,
  ...stylesheetReferences,
]);
for (const entry of requiredDeploymentEntries) {
  if (!isStaged(entry, staged)) fail(`The Pages workflow does not stage required runtime path: ${entry}`);
}
if (unsafe.length > 0) fail(`The Pages workflow uses a copy source that could publish private project data: ${unsafe.join(", ")}`);
if (/project-data[\\/]private/.test(workflowSource) && !/test\s+!\s+-e\s+_site[\\/]project-data[\\/]private/.test(workflowSource)) {
  fail("The Pages workflow mentions project-data/private without an explicit exclusion check.");
}

const catalogSource = await readFile(projectPath("catalog-data.js"), "utf8");
const sandbox = { window: Object.create(null) };
vm.createContext(sandbox);
try {
  new vm.Script(catalogSource, { filename: "catalog-data.js" }).runInContext(sandbox, { timeout: 1_000 });
} catch (error) {
  fail(`catalog-data.js could not be evaluated in an isolated context: ${error.message}`);
}

const { productCount, assetReferences } = validateCatalog(sandbox.window.PORTFOLIO_CATALOG);
if (await isDirectory("assets")) {
  const assetFiles = await walkFiles(projectPath("assets"));
  const unreferencedAssets = assetFiles.filter((asset) => !assetReferences.has(asset));
  if (unreferencedAssets.length > 0) {
    const sample = unreferencedAssets.slice(0, 8).join(", ");
    const suffix = unreferencedAssets.length > 8 ? `, and ${unreferencedAssets.length - 8} more` : "";
    warn(`${unreferencedAssets.length} asset file(s) are not referenced by catalog-data.js: ${sample}${suffix}.`);
  }
} else {
  fail("Missing required assets directory.");
}

for (const message of warnings) console.warn(`WARNING: ${message}`);
if (errors.length > 0) {
  for (const message of errors) console.error(`ERROR: ${message}`);
  console.error(`Validation failed with ${errors.length} error(s) and ${warnings.length} warning(s).`);
  process.exitCode = 1;
} else {
  const categoryCount = sandbox.window.PORTFOLIO_CATALOG?.categories?.length || 0;
  console.log(`Validation passed: ${categoryCount} categories, ${productCount} catalog products, ${scriptReferences.length} script references, ${warnings.length} warning(s).`);
}
