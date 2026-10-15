import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
  companionEntry: {
    default: "",
    description:
      "Absolute path to companion/start.cjs after the companion has been built.",
    type: OptionType.STRING,
  },
});
