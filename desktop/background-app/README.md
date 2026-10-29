# One named macOS background item

This small application groups existing backend and SSH processes under one
user-visible app name. It does not replace the transport, move conversations,
or replay AI messages. Existing programs and data roots remain authoritative.

Build `main.swift` as the executable of a locally configured application bundle.
The bundle must supply `Contents/Resources/services.json`, an array of objects
with `name` and `args` (absolute executable followed by its arguments), and the
`CantusLogPath` Info.plist key pointing to an approved data volume. Keep these
machine-specific resources, SSH identities and runtime logs outside Git.

Use the application's bundle identifier in the single LaunchAgent's
`AssociatedBundleIdentifiers` key. Remove superseded launch entries only after
checking active work and preserving a rollback copy. The app's single-instance
lock prevents duplicate groups; failed children restart after 30 seconds, as in
the existing launchd setup. Existing runner receipts decide how interrupted
work is reported; a process restart does not authorize resending a message.

The app needs permission to access its configured data volumes. Do not disable
host-key verification, copy someone else's keys, or grant general shell access
to work around a failed restricted SSH connection. Verify the actual background
execution context, remote listeners and completed isolated AI turns before
claiming a migration succeeded.
