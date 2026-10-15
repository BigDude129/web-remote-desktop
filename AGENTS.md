# Contributor instructions

Read `rules/rules.md` before changing code. Keep design, protocol, validation and change records synchronized with behavior. Existing Korean planning documents contain requirements and unverified proposals; do not treat proposals as shipped functionality.

Use Node.js 24 LTS for server/web work and .NET 10 SDK for the Windows agent. `npm run check` is the server/web gate. Build and run the agent self-test on Windows before declaring native changes verified. See README.md for commands.

Never commit runtime databases, credentials, screenshots or personal connection details. Default collaboration is a branch and PR; direct main commits are allowed when the user explicitly requests them. Do not force push.
