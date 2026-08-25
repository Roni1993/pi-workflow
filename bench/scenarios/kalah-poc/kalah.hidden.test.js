const { test } = require("node:test")
const assert = require("node:assert/strict")
const rules = require("../src/rules")
const { createBoard, createGame, applyMove, isValidMove, housesOf, storeOf, otherPlayer, PLAYER_ONE, PLAYER_TWO, DRAW, STONES_PER_HOUSE } = rules

test("fresh board: 6 stones per house, empty stores, P1 to move", () => {
  const g = createGame()
  assert.equal(g.board.length, 14)
  assert.equal(g.currentPlayer, PLAYER_ONE)
  for (const h of housesOf(PLAYER_ONE).concat(housesOf(PLAYER_TWO))) assert.equal(g.board[h], STONES_PER_HOUSE)
  assert.equal(g.board[storeOf(PLAYER_ONE)], 0)
  assert.equal(g.board[storeOf(PLAYER_TWO)], 0)
})

test("sowing 6 stones from house 1 lands in own store -> extra turn", () => {
  const g = createGame()
  const r = applyMove(g.board, PLAYER_ONE, 1)
  assert.equal(r.board[0], 0)
  assert.equal(r.board[1], 7)
  assert.equal(r.board[6], 1)
  assert.equal(r.extraTurn, true)
  assert.equal(r.currentPlayer, PLAYER_ONE)
})

test("normal move passes turn and never touches opponent store", () => {
  let g = createGame()
  g = { board: g.board, currentPlayer: g.currentPlayer }
  const r = applyMove(g.board, PLAYER_ONE, 1)
  // P1 got an extra turn; simulate a real pass-on move: from 1s P1 moves house 2 (7 stones)
  const r2 = applyMove(r.board, PLAYER_ONE, 2)
  assert.equal(r2.board[13], 0)
  assert.equal(r2.extraTurn, false)
  assert.equal(r2.currentPlayer, PLAYER_TWO)
})

test("sow crosses opponent store without depositing", () => {
  const board = createBoard()
  board[0] = 12 // P1 house 1 -> 12 stones, will cross P2 store (idx 13)
  const r = applyMove(board, PLAYER_ONE, 1)
  assert.equal(r.board[13], 0)
  const total = r.board.reduce((a, b) => a + b, 0)
  assert.equal(total, 78, "stone conservation: 72 - 6 + 12")
})

test("capture: landing in own empty house takes opposite stones", () => {
  const board = createBoard()
  board[2] = 1 // P1 house 3
  board[3] = 0
  board[4] = 0
  board[5] = 0
  board[9] = 3 // opposite of house 4 (idx 3)
  const r = applyMove(board, PLAYER_ONE, 3)
  assert.equal(r.capture, true)
  assert.equal(r.board[6], 4) // captured 3 + seeding stone
  assert.equal(r.board[9], 0)
  assert.equal(r.board[3], 0)
})

test("game ends when a side empties; remaining stones collected; winner correct", () => {
  // total 72: P1 store 33, P1 house1 = 1 stone, P2 store 38, P2 houses empty.
  // Standard Kalah: P1 (the side with stones left) collects own leftovers into own store.
  const board = new Array(14).fill(0)
  board[0] = 1
  board[6] = 33
  board[13] = 38
  const r = applyMove(board, PLAYER_ONE, 1)
  assert.equal(r.gameOver, true)
  assert.equal(r.winner, PLAYER_TWO)
  assert.equal(r.board[6], 34, "P1 collects own leftover stone")
  assert.equal(r.board[13], 38)
})

test("draw possible when stores equal at the end", () => {
  // P1 store 35, P1 house 6 = 1 stone, P2 store 36, P2 houses empty; move lands in own store
  const board = new Array(14).fill(0)
  board[5] = 1
  board[6] = 35
  board[13] = 36
  const r = applyMove(board, PLAYER_ONE, 6)
  assert.equal(r.gameOver, true)
  assert.equal(r.winner, DRAW)
  assert.equal(r.board[6], 36)
})

test("empty house is not a valid move", () => {
  const board = createBoard()
  board[0] = 0
  assert.equal(isValidMove(board, PLAYER_ONE, 1), false)
  assert.equal(isValidMove(board, PLAYER_TWO, 3), true)
  assert.equal(isValidMove(board, 9, 1), false)
})

test("otherPlayer round-trips", () => {
  assert.equal(otherPlayer(PLAYER_ONE), PLAYER_TWO)
  assert.equal(otherPlayer(PLAYER_TWO), PLAYER_ONE)
})
