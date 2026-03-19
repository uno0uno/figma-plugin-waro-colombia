// Plugin code — runs in Figma sandbox
// Handles conversion of parsed HTML tree into Figma nodes

figma.showUI(__html__, { width: 300, height: 480, title: 'WARO URL to Figma' })

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'import-tree') {
    try {
      await importTree(msg.tree, msg.pageTitle, msg.url)
    } catch (err: any) {
      figma.ui.postMessage({ type: 'error', message: err.message || 'Error al crear frames.' })
    }
  }
}

// ─── Main import function ────────────────────────────────────────────────────

async function importTree(tree: NodeTree, pageTitle: string, url: string) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' })

  const page = figma.currentPage

  // Create root frame
  const rootFrame = figma.createFrame()
  rootFrame.name = pageTitle || url
  rootFrame.resize(1440, 900)
  rootFrame.x = getNextX()
  rootFrame.y = 0
  rootFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  rootFrame.clipsContent = true

  applyAutoLayout(rootFrame, tree.styles)

  // Build children
  let frameCount = 1
  for (const child of tree.children) {
    const node = await buildNode(child, rootFrame)
    if (node) frameCount++
  }

  page.appendChild(rootFrame)
  figma.viewport.scrollAndZoomIntoView([rootFrame])

  figma.ui.postMessage({ type: 'done', frameCount })
}

// ─── Recursive node builder ──────────────────────────────────────────────────

async function buildNode(tree: NodeTree, parent: FrameNode | GroupNode): Promise<SceneNode | null> {
  const tag = tree.tag

  // Skip invisible or structural-only tags
  if (['script', 'style', 'meta', 'link', 'head', 'noscript'].includes(tag)) return null

  // Text-only leaf node
  if (tree.text && tree.children.length === 0) {
    return createTextNode(tree, parent)
  }

  // Image
  if (tag === 'img') {
    return createImagePlaceholder(tree, parent)
  }

  // Frame for everything else
  return createFrameNode(tree, parent)
}

// ─── Frame node ──────────────────────────────────────────────────────────────

async function createFrameNode(tree: NodeTree, parentNode: FrameNode | GroupNode): Promise<FrameNode> {
  const frame = figma.createFrame()
  frame.name = getNodeName(tree)

  const { w, h } = getDimensions(tree)
  frame.resize(Math.max(w, 4), Math.max(h, 4))

  applyFills(frame, tree.styles)
  applyBorderRadius(frame, tree.styles)
  applyStrokes(frame, tree.styles)
  applyAutoLayout(frame, tree.styles)
  applyOpacity(frame, tree.styles)

  parentNode.appendChild(frame)

  for (const child of tree.children) {
    await buildNode(child, frame)
  }

  return frame
}

// ─── Text node ───────────────────────────────────────────────────────────────

function createTextNode(tree: NodeTree, parentNode: FrameNode | GroupNode): TextNode {
  const text = figma.createText()
  text.name = tree.text.slice(0, 40)
  text.characters = tree.text

  // Font size
  const fontSize = parsePx(tree.styles['font-size']) || 14
  text.fontSize = Math.max(fontSize, 1)

  // Font weight
  const weight = tree.styles['font-weight']
  if (weight === 'bold' || weight === '700' || weight === '800' || weight === '900') {
    text.fontName = { family: 'Inter', style: 'Bold' }
  } else if (weight === '500' || weight === '600') {
    text.fontName = { family: 'Inter', style: 'Medium' }
  } else {
    text.fontName = { family: 'Inter', style: 'Regular' }
  }

  // Color
  const color = parseColor(tree.styles['color'])
  if (color) {
    text.fills = [{ type: 'SOLID', color }]
  }

  // Text align
  const align = tree.styles['text-align']
  if (align === 'center') text.textAlignHorizontal = 'CENTER'
  else if (align === 'right') text.textAlignHorizontal = 'RIGHT'

  // Letter spacing
  const ls = parsePx(tree.styles['letter-spacing'])
  if (ls) text.letterSpacing = { value: ls, unit: 'PIXELS' }

  parentNode.appendChild(text)
  return text
}

// ─── Image placeholder ───────────────────────────────────────────────────────

function createImagePlaceholder(tree: NodeTree, parentNode: FrameNode | GroupNode): RectangleNode {
  const rect = figma.createRectangle()
  rect.name = `img${tree.id ? '#' + tree.id : ''}`

  const { w, h } = getDimensions(tree)
  rect.resize(Math.max(w, 40), Math.max(h, 40))
  rect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }]
  applyBorderRadius(rect, tree.styles)

  parentNode.appendChild(rect)
  return rect
}

// ─── Style helpers ───────────────────────────────────────────────────────────

function applyFills(node: FrameNode, styles: Record<string, string>) {
  const bg = styles['background-color'] || styles['background']
  if (!bg) {
    node.fills = []
    return
  }
  const color = parseColor(bg)
  if (color) {
    node.fills = [{ type: 'SOLID', color }]
  } else {
    node.fills = []
  }
}

function applyBorderRadius(node: FrameNode | RectangleNode, styles: Record<string, string>) {
  const r = parsePx(styles['border-radius'])
  if (r !== null) {
    node.cornerRadius = r
  }
}

function applyStrokes(node: FrameNode, styles: Record<string, string>) {
  const borderColor = parseColor(styles['border-color'] || styles['border'])
  if (borderColor) {
    node.strokes = [{ type: 'SOLID', color: borderColor }]
    const bw = parsePx(styles['border-width']) || 1
    node.strokeWeight = bw
  }
}

function applyAutoLayout(node: FrameNode, styles: Record<string, string>) {
  const display = styles['display']
  if (display === 'flex' || display === 'grid') {
    node.layoutMode = styles['flex-direction'] === 'column' ? 'VERTICAL' : 'HORIZONTAL'
    node.primaryAxisAlignItems = mapJustify(styles['justify-content'])
    node.counterAxisAlignItems = mapAlign(styles['align-items'])
    const gap = parsePx(styles['gap'])
    if (gap !== null) node.itemSpacing = gap
  }

  // Padding
  const pt = parsePx(styles['padding-top'] || styles['padding'])
  const pr = parsePx(styles['padding-right'] || styles['padding'])
  const pb = parsePx(styles['padding-bottom'] || styles['padding'])
  const pl = parsePx(styles['padding-left'] || styles['padding'])
  if (pt !== null) node.paddingTop = pt
  if (pr !== null) node.paddingRight = pr
  if (pb !== null) node.paddingBottom = pb
  if (pl !== null) node.paddingLeft = pl
}

function applyOpacity(node: FrameNode, styles: Record<string, string>) {
  const op = styles['opacity']
  if (op) node.opacity = parseFloat(op)
}

function mapJustify(val: string): 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' {
  if (val === 'center') return 'CENTER'
  if (val === 'flex-end' || val === 'end') return 'MAX'
  if (val === 'space-between') return 'SPACE_BETWEEN'
  return 'MIN'
}

function mapAlign(val: string): 'MIN' | 'CENTER' | 'MAX' | 'BASELINE' {
  if (val === 'center') return 'CENTER'
  if (val === 'flex-end' || val === 'end') return 'MAX'
  if (val === 'baseline') return 'BASELINE'
  return 'MIN'
}

// ─── Color parser ─────────────────────────────────────────────────────────────

function parseColor(val: string | undefined): RGB | null {
  if (!val) return null

  // hex
  const hex = val.match(/^#([0-9a-f]{3,6})$/i)
  if (hex) {
    const h = hex[1]
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16) / 255,
        g: parseInt(h[1] + h[1], 16) / 255,
        b: parseInt(h[2] + h[2], 16) / 255,
      }
    }
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    }
  }

  // rgb / rgba
  const rgb = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgb) {
    return {
      r: parseInt(rgb[1]) / 255,
      g: parseInt(rgb[2]) / 255,
      b: parseInt(rgb[3]) / 255,
    }
  }

  // named colors (basic set)
  const named: Record<string, RGB> = {
    white:   { r: 1, g: 1, b: 1 },
    black:   { r: 0, g: 0, b: 0 },
    red:     { r: 1, g: 0, b: 0 },
    green:   { r: 0, g: 0.5, b: 0 },
    blue:    { r: 0, g: 0, b: 1 },
    gray:    { r: 0.5, g: 0.5, b: 0.5 },
    transparent: { r: 0, g: 0, b: 0 },
  }
  return named[val.toLowerCase()] || null
}

// ─── Dimension helpers ────────────────────────────────────────────────────────

function getDimensions(tree: NodeTree): { w: number; h: number } {
  const w = parsePx(tree.styles['width']) ?? tree.rect.width ?? 100
  const h = parsePx(tree.styles['height']) ?? tree.rect.height ?? 40
  return { w, h }
}

function parsePx(val: string | undefined): number | null {
  if (!val) return null
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

// ─── Naming helpers ───────────────────────────────────────────────────────────

function getNodeName(tree: NodeTree): string {
  if (tree.id) return `${tree.tag}#${tree.id}`
  if (tree.classes.length) return `${tree.tag}.${tree.classes[0]}`
  return tree.tag
}

function getNextX(): number {
  let maxX = 0
  for (const node of figma.currentPage.children) {
    const x = node.x + ('width' in node ? (node as FrameNode).width : 0) + 40
    if (x > maxX) maxX = x
  }
  return maxX
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeTree {
  tag: string
  id: string
  classes: string[]
  text: string
  styles: Record<string, string>
  children: NodeTree[]
  rect: { width: number; height: number }
}
