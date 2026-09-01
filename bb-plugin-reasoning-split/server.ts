// bb-plugin-reasoning-split — server is minimal (required by bb manifest)
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("reasoning-split loaded");
  bb.onDispose(() => bb.log.info("reasoning-split disposed"));
}
