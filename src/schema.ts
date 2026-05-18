import { z } from "zod";

export const SCHEMA_VERSION = 2;

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

export const PracticeAreaSchema = PracticeAreaSchemaV1.extend({
  area_profile: z.record(z.string(), z.string()).nullable().default(null),
});

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

export const ProfileSchemaV1 = z.object({
  schema_version: z.literal(1),
  completed_at: z.string().min(1),
  user: UserSchema,
  corporate: CorporateSchema,
  practice_areas: z.array(PracticeAreaSchemaV1).min(1),
  provider: ProviderSchema,
});

export const ProfileSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  completed_at: z.string().min(1),
  user: UserSchema,
  corporate: CorporateSchema,
  practice_areas: z.array(PracticeAreaSchema).min(1),
  provider: ProviderSchema,
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileV1 = z.infer<typeof ProfileSchemaV1>;
export type PracticeArea = z.infer<typeof PracticeAreaSchema>;

export function migrateV1ToV2(v1: ProfileV1): Profile {
  return {
    ...v1,
    schema_version: SCHEMA_VERSION,
    practice_areas: v1.practice_areas.map((a) => ({ ...a, area_profile: null })),
  };
}
