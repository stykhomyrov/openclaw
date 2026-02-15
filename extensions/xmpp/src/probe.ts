import type { CoreConfig, XmppProbe } from "./types.js";
import { resolveXmppAccount } from "./accounts.js";
import { connectXmppClient } from "./client.js";

export async function probeXmpp(
  cfg: CoreConfig,
  opts?: { accountId?: string; timeoutMs?: number }
): Promise<XmppProbe> {
  const account = resolveXmppAccount({ cfg, accountId: opts?.accountId });
  const base: XmppProbe = {
    ok: false,
    jid: account.jid,
    host: account.host || account.jid.split("@")[1] || "",
    port: account.port,
    tls: account.tls,
  };

  if (!account.configured) {
    return { ...base, error: "missing JID or password" };
  }

  const started = Date.now();
  try {
    const client = await connectXmppClient({
      jid: account.jid,
      password: account.password,
      resource: "probe",
      host: account.host,
      port: account.port,
      tls: account.tls,
      connectTimeoutMs: opts?.timeoutMs ?? 8000,
    });

    const elapsed = Date.now() - started;

    // TODO: Query server features via disco#info
    const features: string[] = [];

    await client.stop();

    return {
      ...base,
      ok: true,
      latencyMs: elapsed,
      features,
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
