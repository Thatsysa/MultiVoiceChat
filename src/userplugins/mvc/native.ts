// biome-ignore lint/performance/noBarrelFile: Equicord only registers natives from this file
export {
  connect,
  disconnect,
  playbackAck,
  probe,
  pullAudio,
  pullEvents,
  pushAudio,
  shutdown,
  update,
} from "./companionLink/native";
