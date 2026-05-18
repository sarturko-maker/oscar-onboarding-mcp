import { promises as fs } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProfileStore } from "./store.js";
import {
  CorporateSchema,
  PracticeAreaSchema,
  ProviderSchema,
  SCHEMA_VERSION,
  UserSchema,
} from "./schema.js";

const QuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  priority: z.number().int().min(1).default(1),
});

type Question = z.infer<typeof QuestionSchema>;

export function buildServer(store: ProfileStore): McpServer {
  const server = new McpServer({
    name: "oscar-onboarding",
    version: "0.2.0",
  });

  server.registerTool(
    "finalize_profile",
    {
      description:
        "Finalize the user's Oscar GC profile and write it to disk. Call this once, at the end of the onboarding conversation, when you have captured the user's identity, their company context, the practice areas they care about (each with its per-area answers), and the provider they will use. The write is atomic; calling this tool again overwrites the prior profile.",
      inputSchema: {
        schema_version: z
          .literal(SCHEMA_VERSION)
          .describe("Profile schema version. Must be 2 for this server."),
        completed_at: z
          .string()
          .min(1)
          .describe("UTC timestamp of completion, ISO 8601."),
        user: UserSchema.describe(
          "User identity. name may be null if the user declined to share it. role is a short slug (e.g. general-counsel); role_label is the human-readable form for display.",
        ),
        corporate: CorporateSchema.describe(
          "Corporate context. Any field may be null if the user declined to share that piece.",
        ),
        practice_areas: z
          .array(PracticeAreaSchema)
          .min(1)
          .describe(
            "The practice areas the user works in. source is 'default' for seed entries, 'user-added' for areas the user contributed. area_profile is a per-area free-text answer map keyed by question id (from list_area_questions); null when the user skipped the area's mini-interview.",
          ),
        provider: ProviderSchema.describe(
          "LLM provider configuration. kind is the provider identifier; model is the specific model identifier.",
        ),
      },
    },
    async (input) => {
      const written = await store.write(input);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              schema_version: written.schema_version,
              practice_area_count: written.practice_areas.length,
              completed_at: written.completed_at,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_area_questions",
    {
      description:
        "List the per-practice-area onboarding questions for a given upstream plugin. The caller (the onboarding agent during phase P3.5) passes the plugin id from the practice area's bundled_skill_sources field; the server returns the question templates colocated with that plugin in the bundled skill library. Use this once per unique plugin id across the selected practice areas. Ask at most 2 questions per practice area in the conversation, biased toward priority 1.",
      inputSchema: {
        plugin_id: z
          .string()
          .min(1)
          .describe(
            "Upstream plugin id — one of the values found in PRACTICE_AREAS[i].bundled_skill_sources (e.g. 'commercial-legal', 'privacy-legal'). The plugin id must match a directory under the bundled in-house-legal skill library.",
          ),
      },
    },
    async ({ plugin_id }) => {
      const questions = await readQuestionsForPlugin(plugin_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              plugin_id,
              questions,
            }),
          },
        ],
      };
    },
  );

  return server;
}

async function readQuestionsForPlugin(pluginId: string): Promise<Question[]> {
  const root = process.env.OSCAR_RESOURCES_ROOT;
  if (!root) {
    return [];
  }
  const path = join(
    root,
    "skills",
    "in-house-legal",
    pluginId,
    "onboarding-questions.json",
  );
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const parsed = JSON.parse(raw);
  return z.array(QuestionSchema).parse(parsed);
}
