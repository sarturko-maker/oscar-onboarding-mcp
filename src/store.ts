import { promises as fs, constants as fsConstants } from "node:fs";
import { dirname } from "node:path";
import type { Profile } from "./schema.js";
import {
  ProfileSchema,
  ProfileSchemaV1,
  ProfileSchemaV2,
  ProfileSchemaV3,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
} from "./schema.js";

export class ProfileStore {
  constructor(private readonly path: string) {}

  async write(profile: unknown): Promise<Profile> {
    const validated = ProfileSchema.parse(profile);
    await this.writeAtomic(validated);
    return validated;
  }

  async read(): Promise<Profile | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
    const parsed = JSON.parse(raw);
    const v4 = ProfileSchema.safeParse(parsed);
    if (v4.success) {
      return v4.data;
    }
    const v3 = ProfileSchemaV3.safeParse(parsed);
    if (v3.success) {
      return migrateV3ToV4(v3.data);
    }
    const v2 = ProfileSchemaV2.safeParse(parsed);
    if (v2.success) {
      return migrateV3ToV4(migrateV2ToV3(v2.data));
    }
    const v1 = ProfileSchemaV1.parse(parsed);
    return migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(v1)));
  }

  private async writeAtomic(profile: Profile): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    const handle = await fs.open(
      tmp,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(profile, null, 2), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, this.path);
  }
}
