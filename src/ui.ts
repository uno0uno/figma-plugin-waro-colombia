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

importBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim()

  if (!url) {
    showError('Ingresa una URL válida.')
    return
  }

  // Add http:// if missing
  const fullUrl = url.startsWith('http') ? url : `http://${url}`

  reset()
  importBtn.disabled = true
  setProgress(10, 'Conectando con la URL...')

  try {
    // Fetch the HTML
    const res = await fetch(fullUrl)

    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status}: ${res.statusText}`)
    }

    setProgress(30, 'Procesando HTML...')
    const html = await res.text()

    setProgress(50, 'Extrayendo estilos y estructura...')

    // Parse the DOM
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    const selector = selectorInput.value.trim() || 'body'
    const rootEl = doc.querySelector(selector)

    if (!rootEl) {
      throw new Error(`No se encontró el selector "${selector}" en la página.`)
    }

    const depth = parseInt(depthSelect.value)

    setProgress(70, 'Construyendo estructura de capas...')

    const tree = parseElement(rootEl as HTMLElement, depth, 0)

    setProgress(90, 'Enviando a Figma...')

    parent.postMessage({
      pluginMessage: {
        type: 'import-url',
        url: fullUrl,
        tree,
        pageTitle: doc.title || new URL(fullUrl).pathname,
      }
    }, '*')

  } catch (err: any) {
    importBtn.disabled = false
    progress.classList.remove('visible')

    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      showError(`No se pudo conectar con la URL. Asegúrate de que la app esté corriendo y que la URL sea accesible.`)
    } else {
      showError(err.message || 'Error desconocido.')
    }
  }
})

// Listen for messages from the plugin code
window.addEventListener('message', (event) => {
  const msg = event.data.pluginMessage
  if (!msg) return

  if (msg.type === 'done') {
    importBtn.disabled = false
    setProgress(100, 'Completado')
    showSuccess(`✓ Importado correctamente: ${msg.frameCount} frames creados en Figma.`)
  }

  if (msg.type === 'error') {
    importBtn.disabled = false
    progress.classList.remove('visible')
    showError(msg.message)
  }
})

// --- DOM Parser ---

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
  const styles = extractStyles(el)
  const children: NodeTree[] = []

  if (currentDepth < maxDepth) {
    for (const child of Array.from(el.children)) {
      const htmlChild = child as HTMLElement
      const display = getComputedOrInlineStyle(htmlChild, 'display')
      if (display === 'none') continue
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
    styles,
    children,
    rect: {
      width: el.offsetWidth || 0,
      height: el.offsetHeight || 0,
    }
  }
}

function extractStyles(el: HTMLElement): Record<string, string> {
  const relevant = [
    'color', 'background-color', 'background',
    'font-size', 'font-weight', 'font-family', 'line-height',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'border-radius', 'border', 'border-color', 'border-width',
    'display', 'flex-direction', 'align-items', 'justify-content', 'gap',
    'width', 'height', 'max-width', 'min-height',
    'opacity', 'text-align', 'letter-spacing', 'text-decoration',
  ]

  const result: Record<string, string> = {}

  // Inline styles take priority
  for (const prop of relevant) {
    const inline = el.style.getPropertyValue(prop)
    if (inline) result[prop] = inline
  }

  return result
}

function getComputedOrInlineStyle(el: HTMLElement, prop: string): string {
  return el.style.getPropertyValue(prop) || ''
}
