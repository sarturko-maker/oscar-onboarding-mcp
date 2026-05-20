import { z } from "zod";

export const SCHEMA_VERSION = 4;

export const SizeBandSchema = z.enum([
  "1-50",
  "51-200",
  "201-1000",
  "1001-5000",
  "5000+",
]);

export const PracticeAreaSourceSchema = z.enum(["default", "user-added"]);

export const PracticeAreaSchemaV1 = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  body: z.string(),
  source: PracticeAreaSourceSchema,
});

export const PracticeAreaSchemaV2 = PracticeAreaSchemaV1.extend({
  area_profile: z.record(z.string(), z.string()).nullable().default(null),
});

// Sprint 20 (ADR-067): per-area overrides from Forge. M0 introduces the
// schema; renderer-side recipe builders consume description_override; later
// sprints consume the rest. All fields optional so absent reads as
// undefined and round-trips losslessly.
export const SkillScopeModeSchema = z.enum(["all", "allow", "deny"]);

export const AreaOverridesSchema = z.object({
  description_override: z.string().optional(),
  panel_sections: z.array(z.string()).optional(),
  enabled_skills: z
    .object({
      mode: SkillScopeModeSchema,
      slugs: z.array(z.string()),
    })
    .optional(),
  enabled_mcps: z
    .object({
      mode: SkillScopeModeSchema,
      ids: z.array(z.string()),
    })
    .optional(),
  playbooks: z
    .object({
      always_on: z.array(z.string()),
      on_demand: z.array(z.string()),
    })
    .optional(),
});

export const PracticeAreaSchemaV4 = PracticeAreaSchemaV2.extend({
  area_overrides: AreaOverridesSchema.optional(),
});

export const PracticeAreaSchema = PracticeAreaSchemaV4;

export const UserSchema = z.object({
  name: z.string().nullable(),
  role: z.string().min(1),
  role_label: z.string().min(1),
});

export const CorporateSchema = z.object({
  name: z.string().nullable(),
  industry: z.string().nullable(),
  size_band: SizeBandSchema.nullable(),
});

export const ProviderSchema = z.object({
  kind: z.enum(["minimax"]),
  model: z.string().min(1),
});

export const IndustrySchema = z.object({
  sector: z.string().nullable(),
  sub_sector: z.string().nullable(),
  business_model: z.string().nullable(),
});

export const GeographySchema = z.object({
  hq_jurisdiction: z.string().nullable(),
  operating_jurisdictions: z.array(z.string()),
  customer_jurisdictions: z.array(z.string()).nullable(),
  employee_jurisdictions: z.array(z.string()).nullable(),
});

export const FrameworkConfidenceSchema = z.enum([
  "user-confirmed",
  "tavily+user-confirmed",
  "llm-hypothesis-only",
]);

export const RegulatoryFrameworkSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  confidence: FrameworkConfidenceSchema,
});

export const RegulatoryCapturedViaSchema = z.enum([
  "hypothesis-confirm",
  "user-enumerated",
  "tavily-failed-llm-fallback",
  "needs-re-intake",
]);

export const RegulatoryBaselineSchema = z.object({
  frameworks: z.array(RegulatoryFrameworkSchema),
  captured_via: RegulatoryCapturedViaSchema,
});

export const RecurringMattersSchema = z.object({
  top_shapes: z.array(z.string()),
});

export const StakeholdersSchema = z.object({
  reports_to: z.string().nullable(),
  key_business_partners: z.array(z.string()),
  escalation_threshold_label: z.string().nullable(),
});

export const RiskAppetiteSchema = z
  .enum(["conservative", "balanced", "growth-oriented"])
  .nullable();

export const CompanyContextSchema = z.object({
  industry: IndustrySchema,
  geography: GeographySchema,
  regulatory_baseline: RegulatoryBaselineSchema,
  recurring_matters: RecurringMattersSchema,
  stakeholders: StakeholdersSchema,
  risk_appetite: RiskAppetiteSchema,
  open_notes: z.string().nullable(),
});

export const ProfileSchemaV1 = z.object({
  schema_version: z.literal(1),
  completed_at: z.string().min(1),
  user: UserSchema,
  corporate: CorporateSchema,
  practice_areas: z.array(PracticeAreaSchemaV1).min(1),
  provider: ProviderSchema,
});

export const ProfileSchemaV2 = z.object({
  schema_version: z.literal(2),
  completed_at: z.string().min(1),
  user: UserSchema,
  corporate: CorporateSchema,
  practice_areas: z.array(PracticeAreaSchemaV2).min(1),
  provider: ProviderSchema,
});

export const ProfileSchemaV3 = z.object({
  schema_version: z.literal(3),
  completed_at: z.string().min(1),
  user: UserSchema,
  corporate: CorporateSchema,
  company_context: CompanyContextSchema,
  practice_areas: z.array(PracticeAreaSchemaV2).min(1),
  provider: ProviderSchema,
});

// Sprint 20 (ADR-068): V4 adds per-area area_overrides via PracticeAreaSchemaV4.
export const ProfileSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  completed_at: z.string().min(1),
  user: UserSchema,
  corporate: CorporateSchema,
  company_context: CompanyContextSchema,
  practice_areas: z.array(PracticeAreaSchema).min(1),
  provider: ProviderSchema,
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileV1 = z.infer<typeof ProfileSchemaV1>;
export type ProfileV2 = z.infer<typeof ProfileSchemaV2>;
export type ProfileV3 = z.infer<typeof ProfileSchemaV3>;
export type PracticeArea = z.infer<typeof PracticeAreaSchema>;
export type CompanyContext = z.infer<typeof CompanyContextSchema>;
export type AreaOverrides = z.infer<typeof AreaOverridesSchema>;

export function stubCompanyContext(): CompanyContext {
  return {
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
  };
}

export function migrateV1ToV2(v1: ProfileV1): ProfileV2 {
  return {
    ...v1,
    schema_version: 2,
    practice_areas: v1.practice_areas.map((a) => ({
      ...a,
      area_profile: null,
    })),
  };
}

export function migrateV2ToV3(v2: ProfileV2): ProfileV3 {
  return {
    ...v2,
    schema_version: 3,
    company_context: stubCompanyContext(),
  };
}

// Sprint 20 (ADR-068): V3 → V4 bumps schema_version; absent area_overrides
// stays undefined and parses on round-trip.
export function migrateV3ToV4(v3: ProfileV3): Profile {
  return {
    ...v3,
    schema_version: SCHEMA_VERSION,
  };
}
