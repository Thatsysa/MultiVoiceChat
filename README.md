# MVC

## What the plugin does

MVC joins one extra voice channel per server. That channel uses its own Discord session and audio path. The normal Discord voice connection stays where it is.

- Right-click a voice channel and choose **Join as secondary voice**.
- Each server can have one secondary channel. A server the main client is already in is refused. Stage channels are refused.
- A card above the account bar has mute, deafen, hang up, and volume. Unmute turns the microphone on. Mute turns it off.
- The account session is read from the running client, passed once to the companion, and kept in memory. It is not written to plugin settings, status events, or logs.

Discord does not support automating a user account this way. Using it can disable the account. Only test it in servers where everyone present knows about the extra session, and only on an account you can afford to lose.

## Prerequisites

- **Discord** desktop, on the Stable branch.
- **Equicord.** A checkout you can build, or a build that already contains this plugin.
- **Node.js 22.12.0 or newer**, from [nodejs.org](https://nodejs.org/). That install includes npm. `node -v` must print `v22.12.0` or a newer release.
- **pnpm**, only when you are building Equicord yourself. The command is `pnpm build`.

## Install

1. Copy `src/userplugins/mvc` to `Equicord/src/userplugins/mvc`.
2. In Equicord's `tsconfig.json`, exclude the companion:

```json
"exclude": ["src/userplugins/mvc/companion"]
```

3. From `src/userplugins/mvc/companion`, run:

```bash
npm install
npm run build
```

Install `node_modules` on the same operating system and CPU that will run the companion. `npm run build` writes `companion/dist`, and `start.cjs` runs that output.

4. From the Equicord repository, run `pnpm build`. Fully quit Discord, then open it again. Equicord loads `dist/desktop`, so a source-only copy does not appear until this build is running.

5. In Equicord settings, enable **MVC**, set **companion entry** to the absolute path of `companion/start.cjs`, and turn on the risk acknowledgement. A secondary connection stays off until that is accepted. Quit Discord and open it again, then join from the voice channel menu.

If Equicord is already built with this plugin, skip the copy and `pnpm build`. Install Node.js, build the companion, then enable the settings.
