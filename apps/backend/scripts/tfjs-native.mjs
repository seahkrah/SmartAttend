#!/usr/bin/env node
/**
 * Makes the native TensorFlow binding (@tensorflow/tfjs-node) usable.
 *
 *   node scripts/tfjs-native.mjs            build it if it does not load, then stage and verify
 *   node scripts/tfjs-native.mjs --stage    only put tensorflow.dll where the binding looks (postinstall)
 *
 * Why this exists. On Linux and macOS `npm install` downloads a prebuilt
 * binding and nothing here is needed. On Windows three things go wrong:
 *
 *   1. There is no prebuilt Windows binding for 4.22.0 (the download 404s),
 *      so node-pre-gyp falls back to compiling it.
 *   2. The compile uses the node-gyp bundled with npm, which may not know the
 *      installed Visual Studio (npm 10's node-gyp 11.2 does not recognise
 *      Visual Studio 2026). npm forces its own copy onto install scripts, so
 *      pointing it elsewhere from outside has no effect.
 *   3. After a successful compile, tensorflow.dll is copied into lib/napi-v<N>
 *      for the running Node's N-API version (v10 on Node 22) while the binding
 *      is built into lib/napi-v8, so loading it fails with "The specified
 *      module could not be found".
 *
 * This runs the package's own installer directly (so our choice of node-gyp
 * is honoured), inside the Visual Studio build environment, then stages the
 * DLL beside every binding and proves the result loads.
 *
 * Face matching is optional: a machine that cannot build the binding still
 * runs the API, which answers face checks with 503 and says why in its log
 * and at /api/health/ready. So a failure here is reported, not fatal, unless
 * --strict is given.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(BACKEND, 'package.json'))
const args = new Set(process.argv.slice(2))
const STAGE_ONLY = args.has('--stage')
const STRICT = args.has('--strict')
// A node-gyp that knows Visual Studio 2019, 2022 and 2026 and runs on Node 20/22.
const NODE_GYP_VERSION = '12.4.0'

const log = (m) => console.log(`[tfjs-native] ${m}`)

function tfjsDir() {
  try {
    return path.dirname(require.resolve('@tensorflow/tfjs-node/package.json'))
  } catch {
    return null
  }
}

/** Copies tensorflow.dll next to each compiled binding that lacks it. */
function stage(dir) {
  if (process.platform !== 'win32') return 0
  const dll = path.join(dir, 'deps', 'lib', 'tensorflow.dll')
  const libDir = path.join(dir, 'lib')
  if (!fs.existsSync(dll) || !fs.existsSync(libDir)) return 0
  let copied = 0
  for (const entry of fs.readdirSync(libDir)) {
    const target = path.join(libDir, entry)
    if (!/^napi-v\d+$/.test(entry) || !fs.existsSync(path.join(target, 'tfjs_binding.node'))) continue
    if (!fs.existsSync(path.join(target, 'tensorflow.dll'))) {
      fs.copyFileSync(dll, path.join(target, 'tensorflow.dll'))
      copied++
      log(`staged tensorflow.dll into lib/${entry}`)
    }
  }
  return copied
}

/** Loads the binding in a fresh process and runs one kernel on it. */
function loads() {
  const r = spawnSync(process.execPath, ['-e',
    "const tf=require('@tensorflow/tfjs-node');" +
    "if(tf.getBackend()!=='tensorflow')process.exit(2);" +
    "if(tf.tensor([1,2,3]).sum().dataSync()[0]!==6)process.exit(3)"],
  { cwd: BACKEND, encoding: 'utf8' })
  return { ok: r.status === 0, error: (r.stderr || '').split('\n').find((l) => /Error/.test(l)) ?? `exit ${r.status}` }
}

/** The Visual Studio x64 build environment script, via vswhere. */
function vcvars() {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!fs.existsSync(vswhere)) return null
  try {
    const found = execFileSync(vswhere, ['-latest', '-prerelease', '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-find', 'VC\\Auxiliary\\Build\\vcvars64.bat'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    return found && fs.existsSync(found) ? found : null
  } catch {
    return null
  }
}

/** A node-gyp we choose, installed once into a cache outside the project. */
function nodeGyp() {
  const home = path.join(os.tmpdir(), `jjelotech-node-gyp-${NODE_GYP_VERSION}`)
  const bin = path.join(home, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  if (!fs.existsSync(bin)) {
    log(`installing node-gyp ${NODE_GYP_VERSION} into ${home}`)
    fs.mkdirSync(home, { recursive: true })
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const r = spawnSync(npm, ['install', '--prefix', home, `node-gyp@${NODE_GYP_VERSION}`,
      '--no-audit', '--no-fund', '--loglevel=error'], { stdio: 'inherit', shell: process.platform === 'win32' })
    if (r.status !== 0 || !fs.existsSync(bin)) throw new Error('could not install node-gyp')
  }
  return bin
}

function build(dir) {
  const env = {
    ...process.env,
    npm_config_node_gyp: nodeGyp(),
    PATH: `${path.join(BACKEND, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH}`,
  }
  if (process.platform !== 'win32') {
    const r = spawnSync(process.execPath, ['scripts/install.js'], { cwd: dir, env, stdio: 'inherit' })
    return r.status === 0
  }
  const vc = vcvars()
  if (!vc) {
    log('no Visual Studio with the "Desktop development with C++" workload was found')
    return false
  }
  log(`building with the Visual Studio build tools in ${path.resolve(vc, '..', '..', '..', '..')}`)
  // Run inside the VS environment so node-gyp uses it as found, whatever its version.
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `call "${vc}" >NUL && node scripts\\install.js`],
    { cwd: dir, env, stdio: 'inherit', windowsVerbatimArguments: true })
  return r.status === 0
}

function main() {
  const dir = tfjsDir()
  if (!dir) {
    log('@tensorflow/tfjs-node is not installed; nothing to do')
    return 0
  }
  stage(dir)
  if (STAGE_ONLY) return 0

  let state = loads()
  if (state.ok) {
    log('the native TensorFlow binding loads')
    return 0
  }
  log(`the native binding does not load (${state.error}); building it`)
  if (build(dir)) stage(dir)
  state = loads()
  if (state.ok) {
    log('the native TensorFlow binding loads')
    return 0
  }

  const message = [
    'The native TensorFlow binding could not be built, so face matching will be unavailable',
    'on this machine (the rest of the application is unaffected; face checks answer 503).',
    process.platform === 'win32'
      ? 'Install Visual Studio (2019 or later) with the "Desktop development with C++" workload and Python 3, then run: npm run tfjs-native'
      : 'Install a C++ toolchain and Python 3, then run: npm run tfjs-native',
  ].join('\n  ')
  console.warn(`\n[tfjs-native] WARNING: ${message}\n`)
  return STRICT ? 1 : 0
}

process.exit(main())
