-- Prosody XMPP Server Configuration for OpenClaw Testing
-- Documentation: https://prosody.im/doc/configure

---------- Server-wide settings ----------

-- List of admins (can administer the server)
admins = { "admin@localhost", "admin@prosody" }

-- Enable use of libevent for better performance under high load
use_libevent = true

-- Prosody will look for modules in the "plugins" directory
plugin_paths = { "/usr/lib/prosody/modules" }

-- This is the list of modules Prosody will load on startup
modules_enabled = {
	-- Generally required
		"roster"; -- Allow users to have a roster (contact list)
		"saslauth"; -- Authentication for clients
		"tls"; -- Add support for secure TLS connections
		"dialback"; -- S2S dialback support
		"disco"; -- Service discovery
		"posix"; -- POSIX functionality (daemonize, etc)

	-- Not essential, but recommended
		"carbons"; -- Keep multiple clients in sync (XEP-0280)
		"pep"; -- Enables users to publish their avatar, mood, etc
		"private"; -- Private XML storage (for room bookmarks, etc)
		"blocklist"; -- Allow users to block communications
		"vcard4"; -- User profiles (stored in PEP)
		"vcard_legacy"; -- Conversion between old vCard format and PEP

	-- Nice to have
		"version"; -- Replies to server version requests
		"uptime"; -- Report how long server has been running
		"time"; -- Let others know the time here
		"ping"; -- Replies to XMPP pings with pongs
		"register"; -- Allow users to register on this server
		"mam"; -- Store messages to return them to users when they ask (XEP-0313)
		"csi_simple"; -- Simple Mobile optimizations

	-- Admin interfaces
		"admin_adhoc"; -- Allows administration via an XMPP client

	-- HTTP modules
		"bosh"; -- Enable BOSH clients (needs mod_http)
		"websocket"; -- XMPP over WebSockets (RFC 7395)
		"http_files"; -- Serve static files from a directory

	-- Other specific functionality
		"groups"; -- Shared roster support
		"announce"; -- Send announcement to all online users
		"welcome"; -- Welcome users who register accounts
		"watchregistrations"; -- Alert admins of registrations
		"motd"; -- Send a message to users when they log in
}

-- These modules are auto-loaded but should you want
-- to disable them then uncomment them here:
modules_disabled = {
	-- "offline"; -- Store offline messages
	-- "c2s"; -- Handle client connections
	-- "s2s"; -- Handle server-to-server connections
}

-- Disable account creation by default for security
allow_registration = true  -- Enable for testing purposes

-- Storage configuration
-- Default is internal storage
storage = "internal"

-- Logging configuration
log = {
	info = "/var/log/prosody/prosody.log"; -- Change 'info' to 'debug' for verbose logging
	error = "/var/log/prosody/prosody.err";
	"*syslog"; -- Also log to syslog
}

-- Certificates for TLS
-- For testing, we'll use self-signed certs
https_certificate = "/etc/prosody/certs/localhost.crt"
https_ssl = {
	certificate = "/etc/prosody/certs/localhost.crt";
	key = "/etc/prosody/certs/localhost.key";
}

-- Allow plaintext authentication (for testing only!)
c2s_require_encryption = false
s2s_require_encryption = false
allow_unencrypted_plain_auth = true

---------- Virtual hosts ----------

-- Define your virtual host(s) here
VirtualHost "localhost"
	enabled = true

	-- HTTP file upload (XEP-0363)
	modules_enabled = { "http_upload" }
	http_upload_file_size_limit = 10485760 -- 10 MB
	http_upload_expire_after = 60 * 60 * 24 * 7 -- 1 week

	-- Message archive management
	modules_enabled = { "mam" }
	mam_default_archiving_policy = "always"  -- Archive all messages by default

-- Second virtual host for Docker networking
VirtualHost "prosody"
	enabled = true

	-- HTTP file upload (XEP-0363)
	modules_enabled = { "http_upload" }
	http_upload_file_size_limit = 10485760 -- 10 MB
	http_upload_expire_after = 60 * 60 * 24 * 7 -- 1 week

	-- Message archive management
	modules_enabled = { "mam" }
	mam_default_archiving_policy = "always"  -- Archive all messages by default

---------- Components ----------

-- Multi-User Chat (MUC) - Group chat rooms
Component "conference.localhost" "muc"
	name = "OpenClaw MUC Service"
	restrict_room_creation = false  -- Allow anyone to create rooms
	max_history_messages = 50

	-- MUC modules
	modules_enabled = {
		"muc_mam"; -- Message archive for MUC rooms (XEP-0313)
	}

Component "conference.prosody" "muc"
	name = "OpenClaw MUC Service (Docker)"
	restrict_room_creation = false  -- Allow anyone to create rooms
	max_history_messages = 50

	-- MUC modules
	modules_enabled = {
		"muc_mam"; -- Message archive for MUC rooms (XEP-0313)
	}

-- Proxy65 for file transfers (XEP-0065)
Component "proxy.localhost" "proxy65"
	proxy65_address = "proxy.localhost"
	proxy65_acl = { "localhost", "prosody" }

---------- End of configuration ----------
