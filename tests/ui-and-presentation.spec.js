"use strict";
const {runNodeScenarios}=require("./helpers/suite-runner");
runNodeScenarios([
  "presentation-kernel.js",
  "ui-runtime-accessibility.js",
]);
