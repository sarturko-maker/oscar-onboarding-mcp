import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "dist", "index.js");

const tmp = mkdtempSync(join(tmpdir(), "oscar-onboard-smoke-"));
const profilePath = join(tmp, "profile.json");
const bundleRoot = join(here, "..", "goose");

const transport = new StdioClientTransport({
  command: "node",
  args: [entry],
  env: {
    ...process.env,
    OSCAR_PROFILE_PATH: profilePath,
    OSCAR_RESOURCES_ROOT: bundleRoot,
  },
});

const client = new Client({ name: "smoke-client", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
const names = tools.tools.map((t) => t.name).sort();
console.log("tools:", names.join(", "));
if (names.join(",") !== "finalize_profile,list_area_questions") {
  console.error("FAIL: unexpected tool set");
  process.exit(1);
}

// finalize_profile: v2 schema, with per-area area_profile populated
const sampleProfile = {
  schema_version: 2,
  completed_at: new Date().toISOString(),
  user: {
    name: "Smoke Test",
    role: "general-counsel",
    role_label: "General Counsel",
  },
  corporate: {
    name: "Smoke Industries",
    industry: "Testing",
    size_band: "51-200",
  },
  practice_areas: [
    {
      id: "commercial",
      name: "Commercial",
      body: "Customers, vendors, suppliers, and contract memory live here.",
      source: "default",
      area_profile: {
        "commercial-side": "purchasing",
        "deal-breaker": "no indemnity caps under 12 months ARR",
      },
    },
    {
      id: "custom-procurement",
      name: "Procurement",
      body: "Custom user-added area.",
      source: "user-added",
      area_profile: null,
    },
  ],
  provider: { kind: "minimax", model: "MiniMax-M2.5" },
};

const written = await client.callTool({
  name: "finalize_profile",
  arguments: sampleProfile,
});
console.log("finalize_profile:", JSON.stringify(written.content));
const writeText = written.content?.[0]?.text ?? "";
const writeParsed = JSON.parse(writeText);
if (writeParsed.ok !== true || writeParsed.practice_area_count !== 2) {
  console.error("FAIL: finalize_profile response unexpected");
  process.exit(1);
}

// list_area_questions: commercial-legal lives under the bundle root
const listed = await client.callTool({
  name: "list_area_questions",
  arguments: { plugin_id: "commercial-legal" },
});
console.log("list_area_questions(commercial-legal):", JSON.stringify(listed.content));
const listText = listed.content?.[0]?.text ?? "";
const listParsed = JSON.parse(listText);
if (
  listParsed.plugin_id !== "commercial-legal" ||
  !Array.isArray(listParsed.questions) ||
  listParsed.questions.length !== 2
) {
  console.error("FAIL: list_area_questions did not return 2 commercial-legal questions");
  console.error(JSON.stringify(listParsed, null, 2));
  process.exit(1);
}

// list_area_questions: unknown plugin yields empty array (graceful)
const missing = await client.callTool({
  name: "list_area_questions",
  arguments: { plugin_id: "nonexistent-legal" },
});
const missingParsed = JSON.parse(missing.content?.[0]?.text ?? "");
if (
  missingParsed.plugin_id !== "nonexistent-legal" ||
  !Array.isArray(missingParsed.questions) ||
  missingParsed.questions.length !== 0
) {
  console.error("FAIL: list_area_questions did not return empty for unknown plugin");
  process.exit(1);
}

await client.close();

if (!existsSync(profilePath)) {
  console.error("FAIL: profile file not written");
  process.exit(1);
}

const onDisk = JSON.parse(readFileSync(profilePath, "utf8"));
if (
  onDisk.schema_version !== 2 ||
  onDisk.user.role !== "general-counsel" ||
  onDisk.practice_areas.length !== 2 ||
  onDisk.practice_areas[0].area_profile?.["commercial-side"] !== "purchasing" ||
  onDisk.practice_areas[1].area_profile !== null
) {
  console.error("FAIL: on-disk profile shape mismatched");
  console.error(JSON.stringify(onDisk, null, 2));
  process.exit(1);
}

rmSync(tmp, { recursive: true, force: true });
console.log("OK");
