import assert from 'node:assert'
import { HELP_KB, flattenKbForPrompt } from '../src/shared/help-knowledge.js'

let passed = 0
const ok = (m) => { console.log('  ok -', m); passed++ }

// KB is well-formed
{
  assert.ok(Array.isArray(HELP_KB) && HELP_KB.length > 0, 'HELP_KB is a non-empty array')
  const ids = new Set()
  for (const section of HELP_KB) {
    assert.ok(section.id && typeof section.id === 'string', 'section has id')
    assert.ok(!ids.has(section.id), `section id is unique: ${section.id}`)
    ids.add(section.id)
    assert.ok(section.title && typeof section.title === 'string', 'section has title')
    assert.ok(Array.isArray(section.items) && section.items.length > 0, `section ${section.id} has items`)
    for (const item of section.items) {
      assert.ok(item.q && item.q.trim().length > 0, 'item has non-empty q')
      assert.ok(item.a && item.a.trim().length > 0, 'item has non-empty a')
    }
  }
  ok('HELP_KB is well-formed (unique ids, non-empty q/a)')
}

// flatten includes every title and question, and is deterministic
{
  const text = flattenKbForPrompt()
  for (const section of HELP_KB) {
    assert.ok(text.includes(section.title), `flatten includes title: ${section.title}`)
    for (const item of section.items) {
      assert.ok(text.includes(item.q), `flatten includes question: ${item.q.slice(0, 30)}…`)
    }
  }
  assert.equal(text, flattenKbForPrompt(), 'flatten is deterministic')
  ok('flattenKbForPrompt includes all titles + questions and is deterministic')
}

// covers the newer features explicitly
{
  const text = flattenKbForPrompt().toLowerCase()
  for (const needle of ['+ clip', 'transcript', 'gemini', 'social']) {
    assert.ok(text.includes(needle), `KB covers "${needle}"`)
  }
  ok('KB covers multi-clip, transcript, provider keys, and social presets')
}

console.log(`\n${passed} help-knowledge tests passed`)
