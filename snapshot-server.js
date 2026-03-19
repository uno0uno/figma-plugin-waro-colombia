/**
 * WARO Snapshot Server
 * Lee archivos .vue directamente y convierte su template a un árbol para Figma.
 * Puerto: 8889
 */

const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const { parse } = require('@vue/compiler-sfc')
const { compile, NodeTypes } = require('@vue/compiler-dom')
const resolveConfig = require('tailwindcss/resolveConfig')

const app = express()
const PORT = 8889

app.use(cors())
app.use(express.json())

// ─── Tailwind resolver ────────────────────────────────────────────────────────

let twConfig = null
let cssVars = {}

function loadProjectConfig(projectPath) {
  try {
    const configPath = path.join(projectPath, 'tailwind.config.js')
    delete require.cache[require.resolve(configPath)]
    const userConfig = require(configPath)
    twConfig = resolveConfig(userConfig)
    console.log(`[config] Tailwind config cargado desde ${configPath}`)
  } catch (e) {
    console.warn(`[config] No se pudo cargar tailwind.config.js: ${e.message}`)
    twConfig = resolveConfig({})
  }

  try {
    const tokensPath = path.join(projectPath, 'assets/css/design-tokens.css')
    const css = fs.readFileSync(tokensPath, 'utf8')
    // Parse CSS variables from :root
    const matches = css.matchAll(/--([a-zA-Z0-9-]+):\s*([^;/]+)/g)
    for (const [, name, value] of matches) {
      const hex = value.trim().match(/\/\*\s*(#[0-9a-fA-F]{3,6})\s*\*\//)
      if (hex) cssVars[name] = hex[1]
    }
    console.log(`[config] ${Object.keys(cssVars).length} CSS vars cargadas`)
  } catch (e) {
    console.warn(`[config] No se pudo cargar design-tokens.css: ${e.message}`)
  }
}

function resolveColor(val) {
  if (!val || !twConfig) return null
  const colors = twConfig.theme?.colors || {}

  // Direct tailwind color: e.g. bg-crocus-500, text-ebony-900
  const match = val.match(/^(bg|text|border|ring)-([a-z]+)-(\d+)$/)
  if (match) {
    const [, , palette, shade] = match
    return colors[palette]?.[shade] || null
  }

  // CSS var reference: resolve via cssVars
  const varMatch = val.match(/var\(--([a-zA-Z0-9-]+)\)/)
  if (varMatch) {
    const varName = varMatch[1]
    return cssVars[varName] || null
  }

  return null
}

function classToCss(cls) {
  if (!twConfig) return {}
  const theme = twConfig.theme || {}
  const result = {}

  // Background colors
  if (cls.startsWith('bg-')) {
    const key = cls.slice(3)
    const parts = key.split('-')
    if (parts.length === 2) {
      const color = theme.colors?.[parts[0]]?.[parts[1]]
      if (color && !color.includes('var(')) result['background-color'] = color
    } else {
      const color = theme.colors?.[key]
      if (typeof color === 'string' && !color.includes('var(')) result['background-color'] = color
    }
  }

  // Text colors
  if (cls.startsWith('text-')) {
    const key = cls.slice(5)
    const parts = key.split('-')
    if (parts.length === 2) {
      const color = theme.colors?.[parts[0]]?.[parts[1]]
      if (color && !color.includes('var(')) result['color'] = color
    }
    // font sizes
    const size = theme.fontSize?.[key]
    if (size) result['font-size'] = Array.isArray(size) ? size[0] : size
  }

  // Padding
  const paddingMap = { 'p': ['padding'], 'px': ['padding-left','padding-right'], 'py': ['padding-top','padding-bottom'], 'pt': ['padding-top'], 'pb': ['padding-bottom'], 'pl': ['padding-left'], 'pr': ['padding-right'] }
  for (const [prefix, props] of Object.entries(paddingMap)) {
    if (cls.startsWith(prefix + '-')) {
      const key = cls.slice(prefix.length + 1)
      const val = theme.spacing?.[key]
      if (val) props.forEach(p => result[p] = val)
    }
  }

  // Gap
  if (cls.startsWith('gap-')) {
    const val = theme.spacing?.[cls.slice(4)]
    if (val) result['gap'] = val
  }

  // Border radius
  if (cls.startsWith('rounded')) {
    const key = cls === 'rounded' ? 'DEFAULT' : cls.slice(8) || 'DEFAULT'
    const val = theme.borderRadius?.[key]
    if (val) result['border-radius'] = val
  }

  // Font weight
  const weightMap = { 'font-thin': '100', 'font-light': '300', 'font-normal': '400', 'font-medium': '500', 'font-semibold': '600', 'font-bold': '700', 'font-extrabold': '800' }
  if (weightMap[cls]) result['font-weight'] = weightMap[cls]

  // Display / flex
  if (cls === 'flex') result['display'] = 'flex'
  if (cls === 'block') result['display'] = 'block'
  if (cls === 'hidden') result['display'] = 'none'
  if (cls === 'grid') result['display'] = 'grid'
  if (cls === 'flex-col') result['flex-direction'] = 'column'
  if (cls === 'flex-row') result['flex-direction'] = 'row'
  if (cls === 'items-center') result['align-items'] = 'center'
  if (cls === 'items-start') result['align-items'] = 'flex-start'
  if (cls === 'items-end') result['align-items'] = 'flex-end'
  if (cls === 'justify-center') result['justify-content'] = 'center'
  if (cls === 'justify-between') result['justify-content'] = 'space-between'
  if (cls === 'justify-end') result['justify-content'] = 'flex-end'
  if (cls === 'justify-start') result['justify-content'] = 'flex-start'

  // Width / Height
  if (cls.startsWith('w-')) {
    const key = cls.slice(2)
    const val = key === 'full' ? '100%' : key === 'screen' ? '100vw' : theme.spacing?.[key]
    if (val) result['width'] = val
  }
  if (cls.startsWith('h-')) {
    const key = cls.slice(2)
    const val = key === 'full' ? '100%' : key === 'screen' ? '100vh' : theme.spacing?.[key]
    if (val) result['height'] = val
  }

  // Text align
  if (cls === 'text-center') result['text-align'] = 'center'
  if (cls === 'text-right') result['text-align'] = 'right'
  if (cls === 'text-left') result['text-align'] = 'left'

  // Opacity
  if (cls.startsWith('opacity-')) {
    const val = parseInt(cls.slice(8))
    if (!isNaN(val)) result['opacity'] = String(val / 100)
  }

  return result
}

function resolveClasses(classList) {
  const styles = {}
  for (const cls of classList) {
    Object.assign(styles, classToCss(cls))
  }
  return styles
}

// ─── Vue Template Parser ──────────────────────────────────────────────────────

function parseVueFile(filePath, maxDepth = 5) {
  const source = fs.readFileSync(filePath, 'utf8')
  const { descriptor } = parse(source)

  if (!descriptor.template) {
    throw new Error('El archivo .vue no tiene bloque <template>')
  }

  const ast = descriptor.template.ast
  return parseAstNode(ast, maxDepth, 0)
}

function parseAstNode(node, maxDepth, depth) {
  if (!node || depth > maxDepth) return null

  // Root document node — recurse into children
  if (node.type === NodeTypes.ROOT) {
    const children = (node.children || [])
      .map(c => parseAstNode(c, maxDepth, depth))
      .filter(Boolean)
    return children.length === 1 ? children[0] : {
      tag: 'div', id: '', classes: [], text: '', styles: {}, children,
      rect: { width: 1440, height: 0 }
    }
  }

  // Text node
  if (node.type === NodeTypes.TEXT) {
    const text = node.content?.trim()
    if (!text) return null
    return { tag: 'span', id: '', classes: [], text, styles: { 'font-size': '14px' }, children: [], rect: { width: 0, height: 0 } }
  }

  // Interpolation {{ var }}
  if (node.type === NodeTypes.INTERPOLATION) {
    return { tag: 'span', id: '', classes: [], text: `{{ ${node.content?.content || '...'} }}`, styles: { 'font-size': '14px' }, children: [], rect: { width: 0, height: 0 } }
  }

  // Element node
  if (node.type === NodeTypes.ELEMENT) {
    const tag = node.tag

    // Skip non-visual tags
    if (['script', 'style', 'head', 'meta', 'link', 'template'].includes(tag)) return null

    // Get static classes
    const classAttr = node.props?.find(p => p.name === 'class')
    const classList = classAttr?.value?.content?.split(/\s+/).filter(Boolean) || []

    // Get dynamic :class (extract static strings)
    const dynClass = node.props?.find(p => p.name === 'bind' && p.arg?.content === 'class')
    // just record dynamic classes exist but can't fully resolve at compile time

    const id = node.props?.find(p => p.name === 'id')?.value?.content || ''
    const styles = resolveClasses(classList)

    // Get direct text
    let text = ''
    if (node.children?.length === 1 && node.children[0].type === NodeTypes.TEXT) {
      text = node.children[0].content?.trim() || ''
    }

    const children = depth < maxDepth
      ? (node.children || []).map(c => parseAstNode(c, maxDepth, depth + 1)).filter(Boolean)
      : []

    return {
      tag,
      id,
      classes: classList,
      text,
      styles,
      children,
      rect: { width: 0, height: 0 }
    }
  }

  return null
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.post('/parse', (req, res) => {
  const { filePath, depth = 5 } = req.body

  if (!filePath) return res.status(400).json({ error: 'Falta filePath' })
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: `Archivo no encontrado: ${filePath}` })

  console.log(`[parse] ${filePath}`)

  try {
    // Auto-detect project root (walk up to find tailwind.config.js)
    let projectPath = path.dirname(filePath)
    for (let i = 0; i < 5; i++) {
      if (fs.existsSync(path.join(projectPath, 'tailwind.config.js'))) break
      projectPath = path.dirname(projectPath)
    }
    loadProjectConfig(projectPath)

    const tree = parseVueFile(filePath, parseInt(depth))
    const title = path.basename(filePath, '.vue')

    res.json({ tree, title })
    console.log(`[parse] OK — ${title}`)
  } catch (err) {
    console.error(`[parse] Error:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/health', (_, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`\n🚀 WARO Snapshot Server en http://localhost:${PORT}`)
  console.log(`   POST /parse  { filePath: "/ruta/al/archivo.vue" }\n`)
})
