import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeCsvCell, escapeHtml } from './exportUtils';

test('escapeCsvCell neutralizes spreadsheet formulas and escapes quotes cleanly', () => {
  assert.equal(escapeCsvCell('Hello "World"'), '"Hello ""World"""');
  assert.equal(escapeCsvCell('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
  assert.equal(escapeCsvCell('+1-800'), '"\'+1-800"');
  assert.equal(escapeCsvCell('-500'), '"\'-500"');
  assert.equal(escapeCsvCell('@evil'), '"\'@evil"');
  assert.equal(escapeCsvCell(null), '""');
});

test('escapeHtml escapes HTML markup characters cleanly', () => {
  assert.equal(escapeHtml('<script>"alert(\'1\') & </script>'), '&lt;script&gt;&quot;alert(&#39;1&#39;) &amp; &lt;/script&gt;');
});

