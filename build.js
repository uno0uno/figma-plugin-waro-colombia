const esbuild = require('esbuild')
const fs = require('fs')
const path = require('path')

const watch = process.argv.includes('--watch')

// Build plugin code (runs in Figma sandbox)
const codeConfig = {
  entryPoints: ['src/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es6',
  logLevel: 'info',
}

// Build UI (runs in browser iframe)
const uiConfig = {
  entryPoints: ['src/ui.ts'],
  bundle: true,
  outfile: 'dist/ui-bundle.js',
  target: 'es6',
  logLevel: 'info',
}

async function buildUI() {
  await esbuild.build(uiConfig)
  // Inline the JS into the HTML template
  const js = fs.readFileSync('dist/ui-bundle.js', 'utf8')
  const html = fs.readFileSync('src/ui.html', 'utf8')
  const inlined = html.replace('</body>', `<script>${js}</script></body>`)
  fs.mkdirSync('dist', { recursive: true })
  fs.writeFileSync('dist/ui.html', inlined)
}

async function build() {
  fs.mkdirSync('dist', { recursive: true })
  await Promise.all([
    esbuild.build(codeConfig),
    buildUI(),
  ])
  console.log('Build complete')
}

if (watch) {
  esbuild.context(codeConfig).then(ctx => ctx.watch())
  console.log('Watching...')
} else {
  build().catch(() => process.exit(1))
}
