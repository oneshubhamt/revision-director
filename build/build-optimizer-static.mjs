import {createHash} from "node:crypto";
import {access,copyFile,mkdir,readFile,rm,stat,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {build} from "esbuild";

const root=resolve(import.meta.dirname,"..");
const optimizerRoot=resolve(root,"tools/fsrs-optimizer");
const out=resolve(root,"Revision_Director_Optimizer_Static");
const wasmPackageRoot=resolve(
 optimizerRoot,
 "node_modules/@open-spaced-repetition/binding-wasm32-wasip1"
);
const wasmSource=resolve(wasmPackageRoot,"fsrs-binding.wasm32-wasip1.wasm");
const EXPECTED_WASM_VERSION="0.6.1";
const EXPECTED_WASM_BYTES=1_396_770;
const EXPECTED_WASM_SHA256="498d916b2d92180d8547f4d41ad204d63a488e6e0a1fe8c2ab330cf4ff5b8c05";

await access(resolve(root,"index.html"));
await access(wasmSource);
const wasmPackage=JSON.parse(await readFile(resolve(wasmPackageRoot,"package.json"),"utf8"));
if(wasmPackage.version!==EXPECTED_WASM_VERSION)
 throw Error("Unexpected FSRS optimizer WASM package version: "+wasmPackage.version);
const wasmSourceBytes=await readFile(wasmSource);
const wasmSourceSha256=createHash("sha256").update(wasmSourceBytes).digest("hex");
if(wasmSourceBytes.byteLength!==EXPECTED_WASM_BYTES||wasmSourceSha256!==EXPECTED_WASM_SHA256)
 throw Error("Pinned FSRS optimizer WASM binary identity does not match the official 0.6.1 release asset.");
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});

await build({
 entryPoints:[resolve(optimizerRoot,"browser-worker.mjs")],
 bundle:true,
 write:true,
 outdir:out,
 platform:"browser",
 format:"esm",
 target:"es2022",
 entryNames:"fsrs-optimizer.worker",
 assetNames:"[name]-[hash]",
 chunkNames:"[name]-[hash]",
 loader:{".wasm":"file"},
 conditions:["browser"],
 legalComments:"eof",
 minify:true,
 logLevel:"silent"
});
await copyFile(wasmSource,resolve(out,"fsrs-binding.wasm32-wasip1.wasm"));

let html=await readFile(resolve(root,"index.html"),"utf8");
html=html
 .replace(
  "script-src 'self' 'unsafe-inline' blob:",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:"
 )
 .replace("connect-src 'none'","connect-src 'self'")
 .replace("object-src 'none'","worker-src 'self'; object-src 'none'");
if(!html.includes("'wasm-unsafe-eval'")||!html.includes("connect-src 'self'")||!html.includes("worker-src 'self'"))
 throw Error("Could not prepare optimizer-enabled Content Security Policy");
if(html.includes('name="revision-director-browser-optimizer"'))
 throw Error("Base self-contained artifact unexpectedly advertises browser optimization");
html=html.replace(
 "</head>",
 '<meta name="revision-director-browser-optimizer" content="wasm32-wasip1-0.6.1">\n</head>'
);
await writeFile(resolve(out,"index.html"),html);
await copyFile(resolve(root,"THIRD_PARTY_NOTICES.md"),resolve(out,"THIRD_PARTY_NOTICES.md"));

const licenseDir=resolve(out,"licenses/optimizer");
await mkdir(licenseDir,{recursive:true});
const runtimePackages=[
 ["@open-spaced-repetition/binding-wasm32-wasip1","open-spaced-repetition-binding-wasm32-wasip1"],
 ["@emnapi/core","emnapi-core"],
 ["@emnapi/runtime","emnapi-runtime"],
 ["@emnapi/wasi-threads","emnapi-wasi-threads"],
 ["@napi-rs/wasm-runtime","napi-rs-wasm-runtime"],
 ["@tybys/wasm-util","tybys-wasm-util"],
 ["tslib","tslib"]
];
for(const [packageName,targetName] of runtimePackages){
 const packageRoot=resolve(optimizerRoot,"node_modules",...packageName.split("/"));
 let copied=false;
 for(const candidate of ["LICENSE","LICENSE.md","LICENSE.txt"]){
  try{
   await copyFile(resolve(packageRoot,candidate),resolve(licenseDir,targetName+"-"+candidate));
   copied=true;
   break;
  }catch{}
 }
 if(!copied)throw Error("Missing runtime licence text for "+packageName);
}

await writeFile(
 resolve(out,"README.txt"),
 "Revision Director optimizer-enabled static distribution\n\n"+
 "Serve this directory over localhost or HTTPS. The application remains local-first: the dedicated FSRS optimizer Worker and WASM asset are local files and no optimizer backend is used. The normal root index.html remains the lean self-contained file:// distribution and intentionally does not train weights in-app.\n"
);

const baseHtmlBytes=(await stat(resolve(root,"index.html"))).size;
const staticHtmlBytes=(await stat(resolve(out,"index.html"))).size;
const workerBytes=(await stat(resolve(out,"fsrs-optimizer.worker.js"))).size;
const wasmBytes=(await stat(resolve(out,"fsrs-binding.wasm32-wasip1.wasm"))).size;
const optimizerAssetBytes=workerBytes+wasmBytes;
const hypotheticalBase64WasmBytes=Math.ceil(wasmBytes/3)*4;
const footprint={
 baseHtmlBytes,staticHtmlBytes,workerBytes,wasmBytes,
 wasmVersion:EXPECTED_WASM_VERSION,wasmSha256:wasmSourceSha256,
 optimizerAssetBytes,hypotheticalBase64WasmBytes,
 optimizerAssetsVsBaseHtmlRatio:Number((optimizerAssetBytes/baseHtmlBytes).toFixed(4))
};
await writeFile(resolve(out,"optimizer-footprint.json"),JSON.stringify(footprint,null,2)+"\n");
console.log("Built optional optimizer-enabled static distribution:",out);
console.log("FSRS optimizer footprint:",JSON.stringify(footprint));
