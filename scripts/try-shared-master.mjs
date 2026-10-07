import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import "../public/js/package-codec.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogContext = vm.createContext({ window: {} });
new vm.Script(await readFile(path.join(root, "public/js/catalog-data.js"), "utf8")).runInContext(catalogContext);
const definitions = JSON.parse(JSON.stringify(catalogContext.window.PORTFOLIO_CATALOG.categories));
const categories = definitions.map((definition) => ({
  id: definition.id, name: definition.name,
  board: { version: 1, title: definition.boardTitle, lanes: definition.lanes, settings: {}, products: [] },
}));
const trialId = randomUUID();
for (const [index, [categoryId, name]] of [["pc-gaming-audio", "Demo Headset"], ["mice", "Demo Mouse"], ["keyboards", "Demo Keyboard"]].entries()) {
  const category = categories.find((item) => item.id === categoryId);
  category.board.products.push({
    id: `shared-demo-${trialId}-${index + 1}`, name, laneId: category.board.lanes[0].id, order: 0,
    price: 99 + index * 20, codename: `Demo ${index + 1}`, tier: "Core", statusType: "none", imageAssetId: "",
    generalAvailabilityDate: "2027-03-15", ffsDate: "2027-02-10", endManufacturingDate: "2029-12-31",
    globalAnnouncementDate: "2027-03-01", webReadinessDate: "2027-02-25", finalAssetsDate: "2027-02-20",
    roadmap: { family: name.replace("Demo ", ""), startMonth: "2027-03", launchMonth: "2027-03", endMonth: "2029-12", status: "in-development", confidence: "medium" },
    specs: [{ id: `demo-spec-${index}-1`, label: "Connectivity", value: "Wireless" }, { id: `demo-spec-${index}-2`, label: "Battery life", value: "40 hours" }],
    partSkus: [{ id: `demo-part-${index}-1`, code: `DEMO-${index + 1}-001`, variantId: `demo-color-${index}-1` }],
    variantGroups: [{ id: `demo-group-${index}`, type: "color", label: "Color SKU", items: [{ id: `demo-color-${index}-1`, code: "BK", colorName: "Black", colorHex: "#111111", colorKey: "black", imageAssetId: "" }] }],
  });
}
const manifest = { version: 4, activeCategoryId: categories[0].id, settings: { timeline: { startMonth: "2026-01", endMonth: "2030-12", snap: "month" } }, categories, imageAssets: [], packageInfo: globalThis.PortfolioPackage.createPackageInfo({ comments: "Shared master trial using example products. Edit a date, specification or SKU, then choose Save to master." }) };
const demoDirectory = await mkdtemp(path.join(tmpdir(), "ppc-shared-master-demo-"));
const packageFile = path.join(demoDirectory, "master_ppc.pkg");
const key = globalThis.PortfolioPackage.generateKey();
const zip = globalThis.PortfolioPackage.createZip([{ name: "portfolio.json", data: new TextEncoder().encode(JSON.stringify(manifest)) }]);
await writeFile(packageFile, await globalThis.PortfolioPackage.encrypt(zip, key));
const requestedPort = process.argv.find((value) => value.startsWith("--port="))?.slice(7) || "4187";
const child = spawn(process.execPath, ["scripts/serve.mjs", "--master-file", packageFile, "--local-edits", "--port", requestedPort], { cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, PPC_MASTER_DEMO_KEY: key } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { process.exitCode = code || 0; });
