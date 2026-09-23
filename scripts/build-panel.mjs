import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
fs.mkdirSync('public/vendor', { recursive: true });
execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-c', 'tailwind.config.cjs', '-i', 'styles/tailwind.css', '-o', 'public/panel.css', '--minify'], { stdio: 'inherit' });
fs.copyFileSync('node_modules/lucide/dist/umd/lucide.min.js', 'public/vendor/lucide.min.js');
for (const subset of ['arabic', 'latin']) for (const weight of [400, 700]) {
  const file = `vazirmatn-${subset}-${weight}-normal.woff2`;
  fs.copyFileSync(`node_modules/@fontsource/vazirmatn/files/${file}`, `public/vendor/${file}`);
}
console.log('Panel assets built locally (no runtime CDN).');

for (const [pkg, file] of [['lucide', 'lucide-LICENSE'], ['@fontsource/vazirmatn', 'vazirmatn-LICENSE']]) {
  const source = `node_modules/${pkg}/LICENSE`;
  if (fs.existsSync(source)) fs.copyFileSync(source, `public/vendor/${file}`);
}

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const html = fs.readFileSync('public/index.html', 'utf8')
  .replace(/data-panel-version="[^"]*"/, `data-panel-version="${version}"`)
  .replace(/(\/(?:panel|studio|services|bpb)\.(?:css|js))(?:\?v=[^"']*)?/g, `$1?v=${version}`);
fs.writeFileSync('public/index.html', html);

for (const file of ['public/portal/index.html']) {
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/data-portal-version="[^"]*"/, `data-portal-version="${version}"`).replace(/(\/portal\/app\.(?:css|js))(?:\?v=[^"']*)?/g, `$1?v=${version}`));
}
