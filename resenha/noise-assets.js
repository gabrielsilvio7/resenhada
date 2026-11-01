// Descobre onde estão os arquivos do RNNoise dentro do pacote instalado
// (@sapphi-red/web-noise-suppressor) lendo o "exports" do package.json dele.
// O navegador pede /vendor/noise/manifest.json e carrega a partir daí.
const fs = require('fs');
const path = require('path');

function pick(e) {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    for (const k of ['import', 'browser', 'default']) {
      const r = pick(e[k]);
      if (r) return r;
    }
  }
  return null;
}

function noiseManifest(dir, base) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const ex = pkg.exports || {};
    const find = (key, ...guesses) =>
      [pick(ex[key]), ...guesses]
        .filter(Boolean)
        .map((p) => p.replace(/^\.\//, ''))
        .find((p) => fs.existsSync(path.join(dir, p)));
    const main = find('.', pkg.module, pkg.main, 'dist/index.js');
    const worklet = find('./rnnoiseWorklet.js', 'rnnoiseWorklet.js', 'dist/rnnoise/workletProcessor.js');
    const wasm = find('./rnnoise.wasm', 'rnnoise.wasm', 'dist/rnnoise.wasm');
    const simd = find('./rnnoise_simd.wasm', 'rnnoise_simd.wasm', 'dist/rnnoise_simd.wasm');
    if (!main || !worklet || !wasm) return { ok: false };
    const url = (p) => `${base}/${p}`;
    return { ok: true, version: pkg.version, main: url(main), worklet: url(worklet), wasm: url(wasm), simd: simd ? url(simd) : null };
  } catch {
    return { ok: false };
  }
}

module.exports = { noiseManifest };
