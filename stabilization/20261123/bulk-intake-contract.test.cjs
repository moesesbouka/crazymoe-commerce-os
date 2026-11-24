const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('browser intake accepts 60+ sources without changing the listing limit', () => {
  for (const file of [
    'cloud-studio/web/studio.js',
    'stabilization/20261115/live-vercel/src/studio.js',
  ]) {
    const source = read(file);
    assert.match(source, /MAX_INTAKE_PHOTOS = 100/);
    assert.match(source, /LISTING_PHOTO_LIMIT = 10/);
    assert.match(source, /for \(const \[index,file\] of photos\.entries\(\)\)/);
    assert.doesNotMatch(source, /photos\.length > 10/);
  }
});

test('the live intake gateway accepts the same bounded source batch', () => {
  for (const file of [
    'cloud-studio/api/index.ts',
    'stabilization/20261115/live-supabase/edge-functions/studio-api/index.ts',
  ]) {
    const source = read(file);
    assert.match(source, /MAX_INTAKE_PHOTOS = 100/);
    assert.match(source, /MAX_INTAKE_MANIFEST_BYTES = 128 \* 1024/);
    assert.match(source, /selected_count:Math\.min\(checked\.length,10\)/);
  }
});

test('database preserves all sources and selects only the first ten', () => {
  const migration = read('cloud-studio/migrations/restore_bulk_intake.sql');
  assert.match(migration, /source_count not between 1 and 100/);
  assert.match(migration, /for file in select \* from jsonb_array_elements\(p_files\)/);
  assert.match(migration, /insert into studio_core\.photo_assets/);
  assert.match(migration, /if file_index < 10 then/);
  assert.match(migration, /'files',p_files/);
});
