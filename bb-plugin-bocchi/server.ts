// bb-plugin-bocchi — Bocchi theme (pure theme plugin)
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("Bocchi theme loaded");
  bb.onDispose(() => {
    bb.log.info("Bocchi theme disposed");
  });
}
