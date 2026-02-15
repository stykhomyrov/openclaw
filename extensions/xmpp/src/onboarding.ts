import type { ChannelOnboardingAdapter } from "openclaw/plugin-sdk";
import type { CoreConfig } from "./types.js";
import { listXmppAccountIds, resolveXmppAccount } from "./accounts.js";

export const xmppOnboardingAdapter: ChannelOnboardingAdapter = {
  channel: "xmpp",
  getStatus: async ({ cfg }) => {
    const coreCfg = cfg as CoreConfig;
    const configured = listXmppAccountIds(coreCfg).some(
      (accountId) => resolveXmppAccount({ cfg: coreCfg, accountId }).configured
    );
    return {
      channel: "xmpp",
      configured,
      statusLines: [`XMPP: ${configured ? "configured" : "needs JID + password"}`],
      selectionHint: configured ? "configured" : "needs JID + password",
      quickstartScore: configured ? 1 : 0,
    };
  },
  configure: async ({ cfg, prompter }) => {
    // Basic configuration prompts
    const jid = await prompter.text({
      message: "XMPP JID (user@domain)",
      placeholder: "bot@example.com",
    });

    const password = await prompter.text({
      message: "XMPP password",
    });

    // Return updated config (simplified for now)
    const updated = {
      ...cfg,
      channels: {
        ...(cfg as CoreConfig).channels,
        xmpp: {
          jid,
          password,
          enabled: true,
        },
      },
    };

    return { cfg: updated as CoreConfig, accountId: "default" };
  },
};
