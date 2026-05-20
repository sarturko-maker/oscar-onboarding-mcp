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

// finalize_profile: v4 schema, with per-area area_profile + company_context populated
// + area_overrides on one area (Sprint 20 ADR-067 round-trip check)
const sampleProfile = {
  schema_version: 4,
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
  company_context: {
    industry: {
      sector: "Software",
      sub_sector: "B2B SaaS",
      business_model: "Subscription",
    },
    geography: {
      hq_jurisdiction: "United Kingdom",
      operating_jurisdictions: ["United Kingdom", "Germany"],
      customer_jurisdictions: null,
      employee_jurisdictions: null,
    },
    regulatory_baseline: {
      frameworks: [
        { id: "gdpr", label: "GDPR", confidence: "user-confirmed" },
        { id: "uk-gdpr", label: "UK GDPR", confidence: "tavily+user-confirmed" },
      ],
      captured_via: "hypothesis-confirm",
    },
    recurring_matters: {
      top_shapes: ["customer agreements", "vendor MSAs", "DPA renegotiations"],
    },
    stakeholders: {
      reports_to: "CFO",
      key_business_partners: ["CTO", "VP Sales"],
      escalation_threshold_label: "£500k commitments to CEO",
    },
    risk_appetite: "balanced",
    open_notes: "acquiring a competitor next quarter",
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
      area_overrides: {
        description_override: "Tom's purchasing-side commercial lab.",
        enabled_mcps: { mode: "allow", ids: ["redline", "google_drive"] },
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
  onDisk.schema_version !== 4 ||
  onDisk.user.role !== "general-counsel" ||
  onDisk.practice_areas.length !== 2 ||
  onDisk.practice_areas[0].area_profile?.["commercial-side"] !== "purchasing" ||
  onDisk.practice_areas[0].area_overrides?.description_override !==
    "Tom's purchasing-side commercial lab." ||
  onDisk.practice_areas[0].area_overrides?.enabled_mcps?.mode !== "allow" ||
  onDisk.practice_areas[1].area_profile !== null ||
  onDisk.practice_areas[1].area_overrides !== undefined ||
  onDisk.company_context?.regulatory_baseline?.captured_via !== "hypothesis-confirm" ||
  onDisk.company_context?.regulatory_baseline?.frameworks?.length !== 2 ||
  onDisk.company_context?.geography?.operating_jurisdictions?.length !== 2
) {
  console.error("FAIL: on-disk profile shape mismatched");
  console.error(JSON.stringify(onDisk, null, 2));
  process.exit(1);
}

// v2→v3 read-time migration: write a v2 file directly to disk and re-read via the store
import { writeFileSync } from "node:fs";
import { ProfileStore } from "./dist/store.js";

const v2OnlyPath = join(tmp, "profile-v2.json");
writeFileSync(
  v2OnlyPath,
  JSON.stringify({
    schema_version: 2,
    completed_at: "2026-05-18T12:00:00Z",
    user: { name: "Legacy", role: "counsel", role_label: "Counsel" },
    corporate: { name: null, industry: null, size_band: null },
    practice_areas: [
      {
        id: "commercial",
        name: "Commercial",
        body: "x",
        source: "default",
        area_profile: null,
      },
    ],
    provider: { kind: "minimax", model: "MiniMax-M2.5" },
  }),
  "utf8",
);

const legacyStore = new ProfileStore(v2OnlyPath);
const migrated = await legacyStore.read();
if (
  !migrated ||
  migrated.schema_version !== 4 ||
  migrated.company_context.regulatory_baseline.captured_via !== "needs-re-intake" ||
  migrated.company_context.industry.sector !== null ||
  migrated.practice_areas.length !== 1 ||
  migrated.practice_areas[0].area_overrides !== undefined
) {
  console.error("FAIL: v2→v4 read-time migration shape mismatched");
  console.error(JSON.stringify(migrated, null, 2));
  process.exit(1);
}

// v3→v4 read-time migration: write a v3 file (no area_overrides) and check that
// it reads as v4 cleanly (Sprint 20 ADR-068).
const v3OnlyPath = join(tmp, "profile-v3.json");
writeFileSync(
  v3OnlyPath,
  JSON.stringify({
    schema_version: 3,
    completed_at: "2026-05-19T12:00:00Z",
    user: { name: "V3 user", role: "counsel", role_label: "Counsel" },
    corporate: { name: null, industry: null, size_band: null },
    company_context: {
      industry: { sector: null, sub_sector: null, business_model: null },
      geography: {
        hq_jurisdiction: null,
        operating_jurisdictions: [],
        customer_jurisdictions: null,
        employee_jurisdictions: null,
      },
      regulatory_baseline: { frameworks: [], captured_via: "needs-re-intake" },
      recurring_matters: { top_shapes: [] },
      stakeholders: {
        reports_to: null,
        key_business_partners: [],
        escalation_threshold_label: null,
      },
      risk_appetite: null,
      open_notes: null,
    },
    practice_areas: [
      {
        id: "commercial",
        name: "Commercial",
        body: "x",
        source: "default",
        area_profile: null,
      },
    ],
    provider: { kind: "minimax", model: "MiniMax-M2.5" },
  }),
  "utf8",
);
const v3Store = new ProfileStore(v3OnlyPath);
const v3Migrated = await v3Store.read();
if (
  !v3Migrated ||
  v3Migrated.schema_version !== 4 ||
  v3Migrated.practice_areas[0].area_overrides !== undefined
) {
  console.error("FAIL: v3→v4 read-time migration shape mismatched");
  console.error(JSON.stringify(v3Migrated, null, 2));
  process.exit(1);
}

rmSync(tmp, { recursive: true, force: true });
console.log("OK");
