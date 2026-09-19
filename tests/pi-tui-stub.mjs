// Minimal stub of @earendil-works/pi-tui for headless render tests outside pi.
// Bundled in via: --alias:@earendil-works/pi-tui=./tests/pi-tui-stub.mjs
export function visibleWidth(s) {
  return [...String(s).replace(/\x1b\[[0-9;]*m/g, "")].length
}

export function truncateToWidth(s, width) {
  if (width <= 0) return ""
  const re = /\x1b\[[0-9;]*m/g
  let col = 0
  let out = ""
  let last = 0
  let m
  while ((m = re.exec(s))) {
    const text = s.slice(last, m.index)
    if (text && col < width) {
      const take = [...text].slice(0, width - col).join("")
      out += take
      col += [...take].length
    }
    out += m[0]
    last = re.lastIndex
    if (col >= width) break
  }
  if (col < width) out += s.slice(last)
  return out
}

export function matchesKey(data, key) {
  if (key === "enter") return data === "\r" || data === "\n"
  if (key === "up") return data === "\x1b[A"
  if (key === "down") return data === "\x1b[B"
  if (key === "left") return data === "\x1b[D"
  if (key === "right") return data === "\x1b[C"
  if (key === "escape") return data === "\x1b"
  if (key === "tab") return data === "\t"
  return false
}

export class Text {
  constructor(text = "") {
    this.text = text
  }
  render() {
    return [this.text]
  }
  invalidate() {}
}

export class Input {
  constructor() {
    this.value = ""
    this.onSubmit = undefined
  }
  getText() {
    return this.value
  }
  setText(v) {
    this.value = v
  }
  handleInput(data) {
    if (data === "\r" || data === "\n") {
      this.onSubmit?.(this.value)
      return
    }
    if (data === "\x7f") {
      this.value = this.value.slice(0, -1)
      return
    }
    if (data.length === 1 && data >= " ") this.value += data
  }
  render() {
    return [this.value]
  }
  invalidate() {}
}

export class Editor extends Input {}
