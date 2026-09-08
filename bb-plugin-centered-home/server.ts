import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("centered-home loaded");
  bb.onDispose(() => bb.log.info("centered-home disposed"));
}
