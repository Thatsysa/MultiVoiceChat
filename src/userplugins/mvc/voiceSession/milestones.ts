export const MILESTONE_ORDER = [
  "secondaryPresence",
  "encryptedReceive",
  "audiblePlayback",
  "microphoneTransmit",
  "independentControls",
  "teardown",
] as const;

export interface FeasibilityMilestones {
  audiblePlayback: boolean;
  encryptedReceive: boolean;
  independentControls: boolean;
  microphoneTransmit: boolean;
  secondaryPresence: boolean;
  teardown: boolean;
}

export function emptyMilestones(): FeasibilityMilestones {
  return {
    audiblePlayback: false,
    encryptedReceive: false,
    independentControls: false,
    microphoneTransmit: false,
    secondaryPresence: false,
    teardown: false,
  };
}

export function mergeMilestones(
  left: FeasibilityMilestones,
  right: FeasibilityMilestones
): FeasibilityMilestones {
  return {
    audiblePlayback: left.audiblePlayback || right.audiblePlayback,
    encryptedReceive: left.encryptedReceive || right.encryptedReceive,
    independentControls: left.independentControls || right.independentControls,
    microphoneTransmit: left.microphoneTransmit || right.microphoneTransmit,
    secondaryPresence: left.secondaryPresence || right.secondaryPresence,
    teardown: left.teardown || right.teardown,
  };
}
