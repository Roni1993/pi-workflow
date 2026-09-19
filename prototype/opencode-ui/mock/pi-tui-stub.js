// Minimal stub of @earendil-works/pi-tui for building/running the mock and the
// width-safety test outside pi. Committed so the mock is reproducible.
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
  if (key === "escape") return data === "\x1b"
  if (key === "tab") return data === "\t"
  return false
}
