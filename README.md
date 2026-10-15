# MVC

Experimental Equicord user plugin that joins one extra voice channel per server. Each extra channel uses its own Discord session and audio path. The normal Discord voice connection is not moved.

Discord does not support automating a user account this way. Using it can disable the account. Do not use it on an account you cannot afford to lose, and only test it in servers where everyone present knows about the extra session.

## What it does

- Adds **Join as secondary voice** to server voice channel menus.
- Keeps at most one secondary channel per server.
- Refuses a server that already has the main Discord voice connection.
- Stage channels are refused.
- Mute turns transmission on. Mute again turns it off. Deafen and local volume stay separate.

The account session is read from the running Discord client, passed once to the companion, and kept in memory. It is not written to plugin settings, status events, or logs.

## Setup

You need Discord, an Equicord checkout, and Node.js 22.12 or newer. Equicord compiles this folder into its desktop bundle. A Discord install, or an Equicord build made without this folder, has nothing to load.

### 1. Copy the plugin into Equicord

Copy `src/userplugins/mvc` to `Equicord/src/userplugins/mvc`.

Leave `equicord.d.ts` out of that copy. It is a local type stub for this repository. Equicord already declares those modules.

Equicord typechecks everything under `src`, so exclude the companion in Equicord's `tsconfig.json`:

```json
"exclude": ["src/userplugins/mvc/companion"]
```

### 2. Build the companion

From `src/userplugins/mvc/companion`:

```bash
npm install
npm run build
```

`npm run build` writes `companion/dist`. `start.cjs` runs that output. `node_modules` has to be installed on the same operating system and CPU you will run it on.

### 3. Build Equicord and restart Discord

From the Equicord repository:

```bash
pnpm build
```

Fully quit Discord, then open it again. Equicord loads `dist/desktop`, so a source-only copy does not appear until this build is running.

### 4. Enable it

In Equicord settings:

1. Enable **MVC**.
2. Set **companion entry** to the absolute path of `companion/start.cjs`.
3. Turn on the risk acknowledgement. A secondary connection stays off until that is accepted.

Quit Discord and open it again after changing the companion path. Right-click a voice channel and choose **Join as secondary voice**.

### When Equicord is already built with MVC

Install that Equicord build, install Node.js 22.12 or newer, then follow steps 2 and 4 with the companion folder. Skip the Equicord `pnpm build` only when the build you installed already contains this plugin.

## Live check

Automated tests simulate the session, DAVE join options, audio framing, and controls. They do not open a real Discord call. Before relying on the plugin:

1. Join a voice channel normally in server A.
2. Use the plugin to join a voice channel in server B.
3. Confirm the original call stays up and the secondary user can hear decoded speech.
4. Unmute and confirm transmission starts. Mute and confirm it stops. Deafen and the volume slider stay independent.
5. Disconnect and confirm the companion process exits.

The manager checklist records only what the current session has observed. A green playback mark means this client scheduled audio, not that another person confirmed hearing you. That window opens when a join would replace the secondary connection already open in that server.

## Layout

- `joinVoice` decides whether a channel can be joined.
- `voiceSession` keeps the open connection, its controls, and validation.
- `playback` and `speak` handle hearing and the microphone.
- `voiceBar` is the secondary voice card above the account bar. `manager` is the Discord modal.
- `companionLink` talks to the companion process.
- `companion` owns the extra gateway session, `@discordjs/voice` transport, and loopback audio.
- `discord.js` is not used as the user client. `@discordjs/voice` is used only for the secondary voice transport.
