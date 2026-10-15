"use strict";

const { runCompanion } = require("./dist/companion/src/cli.js");

runCompanion(process.stdin, process.stdout).then(
  () => {
    process.exit(0);
  },
  () => {
    process.stderr.write("voice companion stopped\n");
    process.exit(1);
  }
);
