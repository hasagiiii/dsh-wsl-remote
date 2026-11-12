// In this repository and in the installed plugin, server/agent.mjs imports './mux.js'.
// Deployed to a remote host, lib/mux.js itself is copied next to agent.mjs under
// this name (lib/remote.js AGENT_FILES), so this re-export is only for the package layout.
export * from '../lib/mux.js';
