# XMPP Channel Plugin for OpenClaw

This plugin enables XMPP (Jabber) support in OpenClaw, including Multi-User Chat (MUC) for group conversations.

## Features

- ✅ Direct messages (1-on-1 chat)
- ✅ Multi-User Chat (MUC / XEP-0045)
- ✅ Presence notifications
- ✅ Message receipts (XEP-0184)
- ✅ Typing indicators (XEP-0085)
- ✅ Message corrections (XEP-0308)
- ✅ Multi-account support
- ✅ Pairing/allowlist security
- ✅ Mention gating for MUC

## Quick Start with Docker

### 1. Start Prosody XMPP Server

```bash
cd /path/to/openclaw
docker-compose -f docker-compose.xmpp.yml up -d
```

### 2. Create Test Accounts

```bash
# Create agent accounts
docker exec openclaw-prosody prosodyctl adduser agent1@localhost
docker exec openclaw-prosody prosodyctl adduser agent2@localhost

# Create a test user
docker exec openclaw-prosody prosodyctl adduser testuser@localhost
```

### 3. Configure OpenClaw

Add to your `openclaw.config.json5`:

```json5
{
  channels: {
    xmpp: {
      jid: "agent1@localhost",
      password: "your-password-here",
      host: "localhost",
      port: 5222,
      tls: false, // Disabled for local testing
      dmPolicy: "open",
      allowFrom: ["*"],
      groupPolicy: "allowlist",
      autoJoinRooms: ["testroom@conference.localhost"],
      rooms: {
        "testroom@conference.localhost": {
          requireMention: false,
          enabled: true,
        },
      },
    },
  },
}
```

Or use environment variables:

```bash
export XMPP_JID="agent1@localhost"
export XMPP_PASSWORD="your-password-here"
export XMPP_HOST="localhost"
export XMPP_PORT="5222"
export XMPP_TLS="false"
export XMPP_ROOMS="testroom@conference.localhost"
```

### 4. Start OpenClaw

```bash
pnpm install
pnpm openclaw gateway
```

### 5. Test the Connection

Connect with any XMPP client (Gajim, Conversations, etc.) using:
- JID: `testuser@localhost`
- Password: (your password)
- Server: `localhost:5222`

Send a message to `agent1@localhost` or join `testroom@conference.localhost`.

## Configuration

### Account Options

```json5
{
  jid: "user@domain.com", // Jabber ID
  password: "secret", // Or use passwordFile
  resource: "openclaw", // XMPP resource
  host: "xmpp.domain.com", // Optional server override
  port: 5222, // Default: 5222
  tls: true, // Use TLS (default: true)

  // Security policies
  dmPolicy: "pairing", // "pairing" | "allowlist" | "open" | "disabled"
  allowFrom: ["user1@example.com", "user2@example.com"],

  groupPolicy: "allowlist", // "allowlist" | "open" | "disabled"
  autoJoinRooms: ["room@conference.example.com"],

  // MUC room configuration
  rooms: {
    "room@conference.example.com": {
      requireMention: true,
      enabled: true,
      tools: {
        allow: ["web_search", "read_file"],
      },
    },
    "*": {
      // Wildcard for all rooms
      requireMention: true,
    },
  },
}
```

### Multi-Account Support

```json5
{
  channels: {
    xmpp: {
      accounts: {
        agent1: {
          jid: "agent1@example.com",
          password: "password1",
        },
        agent2: {
          jid: "agent2@example.com",
          password: "password2",
        },
      },
    },
  },
}
```

## Testing Agent-to-Agent Communication

Configure two accounts and have them message each other:

```json5
{
  channels: {
    xmpp: {
      accounts: {
        alice: {
          jid: "alice@localhost",
          password: "alice-password",
          dmPolicy: "open",
          allowFrom: ["*"],
        },
        bob: {
          jid: "bob@localhost",
          password: "bob-password",
          dmPolicy: "open",
          allowFrom: ["*"],
        },
      },
    },
  },
}
```

## MUC (Group Chat) Setup

### Create a Room

Using Prosody:
```bash
# Rooms are auto-created when first joined
# Configure auto-join in OpenClaw config:
autoJoinRooms: ["myroom@conference.localhost"]
```

### Room Configuration Options

```json5
{
  rooms: {
    "projectroom@conference.example.com": {
      requireMention: true, // Only reply when @mentioned
      enabled: true,
      allowFrom: ["alice@example.com"], // Room-specific allowlist
      tools: {
        allow: ["web_search"],
        deny: ["bash"],
      },
      toolsBySender: {
        "admin@example.com": {
          allow: ["*"], // Admin can use all tools
        },
      },
      systemPrompt: "You are a helpful project assistant.",
    },
  },
}
```

## Troubleshooting

### Connection Issues

Check logs:
```bash
docker logs openclaw-prosody
```

Test connection manually:
```bash
# Using xmpp-console or similar
xmpp-console user@localhost password localhost
```

### MUC Not Working

1. Verify MUC component is enabled in Prosody:
   ```lua
   Component "conference.localhost" "muc"
   ```

2. Check room JID format:
   - Correct: `room@conference.localhost`
   - Wrong: `room@localhost`

3. Verify auto-join in config:
   ```json5
   autoJoinRooms: ["room@conference.localhost"]
   ```

## Development

### File Structure

```
extensions/xmpp/
├── index.ts - Plugin registration
├── src/
│   ├── types.ts - TypeScript types
│   ├── runtime.ts - Runtime singleton
│   ├── config-schema.ts - Zod schemas
│   ├── normalize.ts - JID normalization
│   ├── accounts.ts - Account resolution
│   ├── protocol.ts - XMPP utilities
│   ├── client.ts - XMPP client wrapper
│   ├── muc.ts - MUC support
│   ├── presence.ts - Presence tracking
│   ├── monitor.ts - Connection monitoring
│   ├── send.ts - Outbound messaging
│   ├── policy.ts - Access control
│   ├── inbound.ts - Message processing
│   ├── channel.ts - ChannelPlugin impl
│   ├── onboarding.ts - CLI wizard
│   └── probe.ts - Health checks
└── package.json
```

### Running Tests

```bash
pnpm test extensions/xmpp
```

## References

- [XMPP Standards](https://xmpp.org/rfcs/)
- [XEP-0045: Multi-User Chat](https://xmpp.org/extensions/xep-0045.html)
- [XEP-0085: Chat State Notifications](https://xmpp.org/extensions/xep-0085.html)
- [XEP-0184: Message Delivery Receipts](https://xmpp.org/extensions/xep-0184.html)
- [XEP-0308: Last Message Correction](https://xmpp.org/extensions/xep-0308.html)
- [Prosody Documentation](https://prosody.im/doc/)
