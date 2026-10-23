---
description: Open Claude Arcade in your browser and play a mini-game while Claude works.
argument-hint: '[game-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run exactly this one command with the Bash tool:

```
node "${CLAUDE_PLUGIN_ROOT}/server/cli.js" open --data-dir "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS
```

Relay its output to the user verbatim, with no commentary.

If the command fails because `node` is missing (`command not found`, `not recognized`), tell the user: "Claude Arcade needs Node.js 20 or newer. Install it from https://nodejs.org — nothing else is required."
