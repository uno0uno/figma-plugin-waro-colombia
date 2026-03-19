/**
 * WARO Snapshot Server
 * Renderiza páginas SPA con Puppeteer y las sirve al plugin de Figma.
 *
 * Uso: node snapshot-server.js
 * Puerto: 8889
 *
 * El plugin llama a: http://localhost:8889/snapshot?url=http://localhost:8888/organizadores
 */

const express = require('express')
const cors = require('cors')
const puppeteer = require('puppeteer-core')
const { execSync } = require('child_process')

const app = express()
const PORT = 8889

app.use(cors())

// Detectar Chrome instalado en macOS
function getChromePath() {
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ]
  for (const p of paths) {
    try {
      execSync(`test -f "${p}"`)
      return p
    } catch {}
  }
  throw new Error('No se encontró Chrome. Instala Google Chrome.')
}

let browser = null

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      executablePath: getChromePath(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
  }
  return browser
}

app.get('/snapshot', async (req, res) => {
  const { url } = req.query

  if (!url) {
    return res.status(400).json({ error: 'Falta el parámetro ?url=' })
  }

  console.log(`[snapshot] Renderizando: ${url}`)

  try {
    const b = await getBrowser()
    const page = await b.newPage()

    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    // Esperar que Vue monte el contenido
    await page.waitForSelector('#__nuxt', { timeout: 10000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 1000))

    const html = await page.content()
    await page.close()

    console.log(`[snapshot] OK — ${html.length} chars`)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)

  } catch (err) {
    console.error(`[snapshot] Error:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/health', (_, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`\n🚀 WARO Snapshot Server corriendo en http://localhost:${PORT}`)
  console.log(`   Uso: http://localhost:${PORT}/snapshot?url=http://localhost:8888/organizadores\n`)
})

process.on('exit', () => browser?.close())
