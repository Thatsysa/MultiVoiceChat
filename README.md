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

1. Copy `src/userplugins/mvc` to `Equicord/src/userplugins/mvc`. From the Equicord folder, run `pnpm build`. Quit Discord, then open it again. The plugin shows up after that build.

2. Put the `companion` folder where you want. then run this inside the folder:

```bash
npm install
npm run build
```


3. In Equicord settings, enable **MVC**. Set **companion entry** to the full path of `start.cjs` in the companion folder you used. If you move that folder, change the path.

## Warning

Discord does not support this extra session. Using it can get the account disabled.
