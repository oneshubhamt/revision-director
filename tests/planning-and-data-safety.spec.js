"use strict";
const {runNodeScenarios}=require("./helpers/suite-runner");
runNodeScenarios([
  "adaptive-planning.js",
  "planning-persistence-validation.js",
  "backup-codec.js",
  "backup-controller.js",
  "data-safety-controller.js",
]);
