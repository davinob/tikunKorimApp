// Bundles @hebcal/core into a single, IIFE-wrapped JS file that exposes
// `window.HebcalLib` for the WebView. Output:
//   ../../assets/html/js/hebcal.bundle.js
//
// Run:  npm install && npm run build  (from this directory)

import esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(
    __dirname, '../../assets/html/js/hebcal.bundle.js',
);

const entry = path.resolve(__dirname, 'entry.mjs');

await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'HebcalLib',
    target: ['es2018'],
    outfile: outFile,
    legalComments: 'none',
    logLevel: 'info',
});

const bytes = fs.statSync(outFile).size;
console.log(`Wrote ${path.relative(process.cwd(), outFile)} (${bytes} bytes)`);
