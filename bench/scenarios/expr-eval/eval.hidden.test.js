const { test } = require("node:test")
const assert = require("node:assert/strict")
const { tokenize, toRpn, evaluate } = require("../src/eval")

const throws = (fn, re) => {
  assert.throws(fn, (e) => e instanceof Error && (!re || re.test(e.message)))
}

test("deep paren nesting", () => {
  assert.equal(evaluate("((1+(2*(3+4))))"), 15)
})

test("left-associative chains", () => {
  assert.equal(evaluate("10-4-3"), 3)
  assert.equal(evaluate("100/10/5"), 2)
})

test("power is right-associative", () => {
  assert.equal(evaluate("2^2^3"), 256)
  assert.equal(evaluate("2^3^2"), 512)
})

test("unary minus binds looser than power", () => {
  assert.equal(evaluate("-2^2"), -4)
  assert.equal(evaluate("-3*2"), -6)
  assert.equal(evaluate("-(2+3)"), -5)
})

test("unary minus inside and after operators", () => {
  assert.equal(evaluate("5*-3"), -15)
  assert.equal(evaluate("2^-3"), 0.125)
  assert.equal(evaluate("-5+2"), -3)
})

test("decimals and whitespace", () => {
  assert.equal(evaluate("0.1+0.2") > 0.3 - 1e-9, true)
  assert.equal(evaluate(" 3 + 4 "), 7)
  assert.equal(evaluate(".5*4"), 2)
})

test("tokenization shape", () => {
  const toks = tokenize("12.5")
  assert.equal(toks[0].type, "number")
  assert.equal(toks[0].value, 12.5)
  const t2 = tokenize("1+2*3")
  assert.deepEqual(t2.map((t) => t.type), ["number", "op", "number", "op", "number"])
})

test("toRpn postfix order", () => {
  const seq = toRpn(tokenize("1+2*3")).map((t) => `${t.type}:${t.value}`)
  assert.deepEqual(seq, ["number:1", "number:2", "number:3", "op:*", "op:+"])
})

test("errors: division by zero", () => {
  throws(() => evaluate("1/0"), /division by zero/i)
  throws(() => evaluate("1/(2-2)"), /division by zero/i)
})

test("errors: unbalanced parens and invalid syntax", () => {
  throws(() => evaluate("((1+2)"))
  throws(() => evaluate("(")) 
  throws(() => evaluate("2++3"))
  throws(() => evaluate("3 +"))
  throws(() => evaluate("1.2.3"))
  throws(() => evaluate(""))
  throws(() => evaluate("abc"))
})
