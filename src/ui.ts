// UI Script — runs in the browser iframe inside Figma

const urlInput = document.getElementById('url-input') as HTMLInputElement
const selectorInput = document.getElementById('selector-input') as HTMLInputElement
const depthSelect = document.getElementById('depth-select') as HTMLSelectElement
const importBtn = document.getElementById('import-btn') as HTMLButtonElement
const progress = document.getElementById('progress') as HTMLDivElement
const progressFill = document.getElementById('progress-fill') as HTMLDivElement
const progressText = document.getElementById('progress-text') as HTMLDivElement
const errorBox = document.getElementById('error-box') as HTMLDivElement
const successBox = document.getElementById('success-box') as HTMLDivElement

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

importBtn.addEventListener('click', () => {
  const url = urlInput.value.trim()

  if (!url) {
    showError('Ingresa una URL válida.')
    return
  }

  const fullUrl = url.startsWith('http') ? url : `http://${url}`
  const selector = selectorInput.value.trim() || 'body'
  const depth = parseInt(depthSelect.value)

  reset()
  importBtn.disabled = true
  setProgress(10, 'Conectando con la URL...')

  // Delegate fetch to plugin sandbox (figma.fetch — no CORS restrictions)
  parent.postMessage({
    pluginMessage: {
      type: 'fetch-url',
      url: fullUrl,
      selector,
      depth,
    }
  }, '*')
})

// Listen for messages from plugin code
window.addEventListener('message', (event) => {
  const msg = event.data.pluginMessage
  if (!msg) return

  if (msg.type === 'html-received') {
    setProgress(40, 'Procesando HTML...')

    try {
      const { html, url, selector, depth } = msg

      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')

      const rootEl = doc.querySelector(selector) as HTMLElement
      if (!rootEl) {
        throw new Error(`No se encontró el selector "${selector}" en la página.`)
      }

      setProgress(65, 'Extrayendo estructura y estilos...')
      const tree = parseElement(rootEl, depth, 0)
      const pageTitle = doc.title || new URL(url).pathname

      setProgress(80, 'Enviando a Figma...')

      parent.postMessage({
        pluginMessage: {
          type: 'import-tree',
          tree,
          pageTitle,
          url,
        }
      }, '*')
    } catch (err: any) {
      importBtn.disabled = false
      progress.classList.remove('visible')
      showError(err.message || 'Error al procesar el HTML.')
    }
  }

  if (msg.type === 'progress') {
    setProgress(msg.pct, msg.text)
  }

  if (msg.type === 'done') {
    importBtn.disabled = false
    setProgress(100, 'Completado')
    showSuccess(`✓ Importado: ${msg.frameCount} elementos creados en Figma.`)
  }

  if (msg.type === 'error') {
    importBtn.disabled = false
    progress.classList.remove('visible')
    showError(msg.message)
  }
})

// ─── DOM Parser ───────────────────────────────────────────────────────────────

interface NodeTree {
  tag: string
  id: string
  classes: string[]
  text: string
  styles: Record<string, string>
  children: NodeTree[]
  rect: { width: number; height: number }
}

function parseElement(el: HTMLElement, maxDepth: number, currentDepth: number): NodeTree {
  const children: NodeTree[] = []

  if (currentDepth < maxDepth) {
    for (const child of Array.from(el.children)) {
      const htmlChild = child as HTMLElement
      if (htmlChild.style.display === 'none') continue
      children.push(parseElement(htmlChild, maxDepth, currentDepth + 1))
    }
  }

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: Array.from(el.classList),
    text: el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE
      ? (el.firstChild as Text).textContent?.trim() || ''
      : '',
    styles: extractStyles(el),
    children,
    rect: { width: el.offsetWidth || 0, height: el.offsetHeight || 0 },
  }
}

function extractStyles(el: HTMLElement): Record<string, string> {
  const props = [
    'color', 'background-color', 'background',
    'font-size', 'font-weight', 'font-family', 'line-height',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-radius', 'border', 'border-color', 'border-width',
    'display', 'flex-direction', 'align-items', 'justify-content', 'gap',
    'width', 'height', 'max-width', 'opacity', 'text-align', 'letter-spacing',
  ]
  const result: Record<string, string> = {}
  for (const prop of props) {
    const val = el.style.getPropertyValue(prop)
    if (val) result[prop] = val
  }
  return result
}
