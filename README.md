# MVC - Equicord Plugin

## What the plugin does

MVC joins one extra voice channel per server. That channel uses its own Discord session and audio path. The normal Discord voice connection stays where it is.

- Right-click a voice channel and choose **Join as secondary voice**.
- Each server can have one secondary channel. A server the main client is already in is refused. Stage channels are refused.
- A card above the account bar has mute, deafen, hang up, and volume. Unmute turns the microphone on. Mute turns it off.
- The account session is read from the running client, passed once to the companion, and kept in memory. It is not written to plugin settings, status events, or logs.

## Prerequisites

- **Discord** desktop, on the Stable branch.
- **Equicord** source, so you can build it yourself. Clone it from [Equicord](https://github.com/Equicord/Equicord).
- **Node.js 22.12.0 or newer**, from [nodejs.org](https://nodejs.org/). That install includes npm. `node -v` must print `v22.12.0` or a newer release.
- **pnpm**, used to build Equicord with `pnpm build`.

## Install

1. Copy `src/userplugins/mvc` to `Equicord/src/userplugins/mvc`, and leave `tsconfig.json` behind. That file is only for editing this repo. A second one inside Equicord hides Equicord's own import paths and the build fails. Leave the repo's `companion` folder where it is. Equicord does not need it.
2. From this repo's `companion` folder, run:

```bash
npm install
npm run build
```

Install `node_modules` on the same operating system and CPU that will run the companion. `npm run build` writes `companion/dist`, and `start.cjs` runs that output.

3. From the Equicord repository, run `pnpm build`. Fully quit Discord, then open it again. Equicord loads `dist/desktop`, so a source-only copy does not appear until this build is running.

4. In Equicord settings, enable **MVC**, set **companion entry** to the absolute path of this repo's `companion/start.cjs`.

## Warning

Discord does not support this extra session. Using it can get the account disabled. Only use it in a channel where everyone knows about it, and only on an account you can afford to lose.
