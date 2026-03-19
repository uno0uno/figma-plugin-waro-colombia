// UI Script — runs in the browser iframe inside Figma

const progress   = document.getElementById('progress') as HTMLDivElement
const progressFill = document.getElementById('progress-fill') as HTMLDivElement
const progressText = document.getElementById('progress-text') as HTMLDivElement
const errorBox   = document.getElementById('error-box') as HTMLDivElement
const successBox = document.getElementById('success-box') as HTMLDivElement

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
    tab.classList.add('active')
    const panelId = `panel-${(tab as HTMLElement).dataset.tab}`
    document.getElementById(panelId)?.classList.add('active')
  })
})

function setProgress(pct: number, text: string) {
  progress.classList.add('visible')
  progressFill.style.width = `${pct}%`
  progressText.textContent = text
}
function showError(msg: string) {
  errorBox.textContent = msg
  errorBox.classList.add('visible')
  successBox.classList.remove('visible')
}
function showSuccess(msg: string) {
  successBox.textContent = msg
  successBox.classList.add('visible')
  errorBox.classList.remove('visible')
}
function reset() {
  errorBox.classList.remove('visible')
  successBox.classList.remove('visible')
  progress.classList.remove('visible')
  progressFill.style.width = '0%'
}

// ─── Import from .vue file ────────────────────────────────────────────────────

const fileInput    = document.getElementById('file-input') as HTMLInputElement
const fileDepth    = document.getElementById('file-depth') as HTMLSelectElement
const importFileBtn = document.getElementById('import-file-btn') as HTMLButtonElement

importFileBtn.addEventListener('click', async () => {
  const filePath = fileInput.value.trim()
  if (!filePath) { showError('Ingresa la ruta del archivo .vue'); return }

  reset()
  importFileBtn.disabled = true
  setProgress(15, 'Leyendo archivo .vue...')

  try {
    const res = await fetch('http://localhost:8889/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, depth: parseInt(fileDepth.value) }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `Error ${res.status}`)
    }

    setProgress(60, 'Procesando árbol de componentes...')
    const { tree, title } = await res.json()

    if (!tree) throw new Error('No se pudo parsear el archivo.')

    setProgress(80, 'Enviando a Figma...')
    parent.postMessage({ pluginMessage: { type: 'import-tree', tree, pageTitle: title, url: filePath } }, '*')

  } catch (err: any) {
    importFileBtn.disabled = false
    progress.classList.remove('visible')
    if (err.message?.includes('Failed to fetch')) {
      showError('No se puede conectar al snapshot server.\nCorre: npm run snapshot')
    } else {
      showError(err.message || 'Error desconocido.')
    }
  }
})

// ─── Import from URL ──────────────────────────────────────────────────────────

const urlInput     = document.getElementById('url-input') as HTMLInputElement
const selectorInput = document.getElementById('selector-input') as HTMLInputElement
const importUrlBtn = document.getElementById('import-url-btn') as HTMLButtonElement

importUrlBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim()
  if (!url) { showError('Ingresa una URL válida.'); return }

  const fullUrl = url.startsWith('http') ? url : `http://${url}`
  const selector = selectorInput.value.trim() || 'body'

  reset()
  importUrlBtn.disabled = true
  setProgress(10, 'Renderizando página...')

  const snapshotUrl = `http://localhost:8889/snapshot?url=${encodeURIComponent(fullUrl)}&selector=${encodeURIComponent(selector)}`

  try {
    const res = await fetch(snapshotUrl)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || `Error ${res.status}`)
    }

    setProgress(70, 'Procesando estructura...')
    const { tree, title } = await res.json()
    if (!tree) throw new Error('No se encontró contenido.')

    setProgress(85, 'Enviando a Figma...')
    parent.postMessage({ pluginMessage: { type: 'import-tree', tree, pageTitle: title || new URL(fullUrl).pathname, url: fullUrl } }, '*')

  } catch (err: any) {
    importUrlBtn.disabled = false
    progress.classList.remove('visible')
    showError(err.message || 'Error desconocido.')
  }
})

// ─── Messages from plugin code ────────────────────────────────────────────────

window.addEventListener('message', (event) => {
  const msg = event.data.pluginMessage
  if (!msg) return

  const allBtns = [importFileBtn, importUrlBtn]

  if (msg.type === 'done') {
    allBtns.forEach(b => b.disabled = false)
    setProgress(100, 'Completado')
    showSuccess(`✓ Importado: ${msg.frameCount} elementos creados en Figma.`)
  }
  if (msg.type === 'error') {
    allBtns.forEach(b => b.disabled = false)
    progress.classList.remove('visible')
    showError(msg.message)
  }
})
