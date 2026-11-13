"use strict";
const {runNodeScenarios}=require("./helpers/suite-runner");
runNodeScenarios([
  "production-contracts-storage.js",
  "active-retrieval-persistence.js",
  "phase-time-runtime.js",
  "ownership-storage-health.js",
  "reliability-closure.js",
]);
