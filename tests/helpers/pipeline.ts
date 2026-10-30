import type { DocuForgeConfig, UserConfig } from "../../packages/cli/src/config/schema.js";
import { ConfigSchema } from "../../packages/cli/src/config/schema.js";
import type { ResolvedConfig } from "../../packages/cli/src/config/load.js";
import { discover } from "../../packages/cli/src/build/pipeline.js";
import { Diagnostics } from "../../packages/cli/src/util/diagnostics.js";

/** Run discovery over `sourceDir` with defaults plus overrides. */
export async function discoverDir(sourceDir: string, overrides: UserConfig = {}, outDir = `${sourceDir}/__out__`) {
  const parsed: DocuForgeConfig = ConfigSchema.parse(overrides);
  const config: ResolvedConfig = { ...parsed, sourceDir, outDir, siteAssets: { publicIcons: [] } };
  const diags = new Diagnostics();
  const result = await discover(config, diags);
  return { ...result, diags };
}
