"use strict";
const path=require("node:path");
const {spawnSync}=require("node:child_process");

function runNodeScenarios(files){
  for(const file of files){
    const target=path.join(__dirname,"scenarios",file);
    console.log("==> "+path.relative(path.resolve(__dirname,".."),target));
    const result=spawnSync(process.execPath,[target],{stdio:"inherit"});
    if(result.error) throw result.error;
    if(result.status!==0) process.exit(result.status ?? 1);
  }
}
module.exports={runNodeScenarios};
