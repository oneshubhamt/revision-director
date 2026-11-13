'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_PATH = path.join(ROOT, 'dist', 'app.js');
const VENDOR_PATH = path.join(ROOT, 'vendor', 'ts-fsrs-6.0.0', 'index.umd.js');
const BOOT_MARKER = 'void boot();';

function memoryLocalStorage(seed = []) {
  const values = new Map(seed);
  return {
    values,
    api: {
      getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
      setItem(key, value) { values.set(String(key), String(value)); },
      removeItem(key) { values.delete(String(key)); },
      clear() { values.clear(); },
    },
  };
}

function defaultContext() {
  const storage = memoryLocalStorage();
  return {
    crypto: webcrypto,
    structuredClone,
    console,
    Date,
    Intl,
    URL,
    Blob,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    CompressionStream: globalThis.CompressionStream,
    DecompressionStream: globalThis.DecompressionStream,
    ReadableStream: globalThis.ReadableStream,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Map,
    Set,
    Math,
    Number,
    String,
    Object,
    Array,
    JSON,
    Error,
    Promise,
    Int32Array,
    Uint8Array,
    BigInt,
    navigator: {},
    localStorage: storage.api,
  };
}

function createVendorRuntime({ context: overrides = {}, requireFsrs = true } = {}) {
  const context = { ...defaultContext(), ...overrides };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(VENDOR_PATH, 'utf8'), context, { filename: 'ts-fsrs-6.0.0.umd.js' });
  if (requireFsrs && (!context.FSRS || typeof context.FSRS.DefaultScheduler !== 'function')) {
    throw new Error('Modern ts-fsrs runtime did not load');
  }
  return context;
}

function createAppRuntime({
  globalName = '__RD_TEST_API__',
  expose = [],
  context: overrides = {},
  hook,
  requireFsrs = false,
} = {}) {
  let source = fs.readFileSync(APP_PATH, 'utf8');
  if (!source.includes(BOOT_MARKER)) throw new Error('Boot marker missing');
  const exposure = hook ?? `window.${globalName} = { ${expose.join(', ')} };`;
  source = source.replace(BOOT_MARKER, exposure);

  const context = { ...defaultContext(), ...overrides };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(VENDOR_PATH, 'utf8'), context, { filename: 'ts-fsrs-6.0.0.umd.js' });
  const fsrs = context.FSRS;
  if (requireFsrs && (!fsrs || typeof fsrs.DefaultScheduler !== 'function')) {
    throw new Error('Modern ts-fsrs runtime did not load');
  }
  vm.runInContext(source, context, { filename: 'app.js' });
  const api = context[globalName];
  if (!api) throw new Error(`${globalName} was not exposed`);
  return { api, context, fsrs };
}

module.exports = {
  ROOT,
  createAppRuntime,
  createVendorRuntime,
  memoryLocalStorage,
};
