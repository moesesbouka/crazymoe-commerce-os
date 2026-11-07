import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaManifest, validateRequest} from './copy-manifest.mjs';
const sha = 'a'.repeat(64);
const fixture = () => ({format: 1, tables: {
  photo_assets: {count: 1, rows: [{bucket: 'studio-originals', object_path: 'originals/' + sha, sha256: sha, bytes: 12}]},
  reference_assets: {count: 0, rows: []}, photo_choices: {count: 0, rows: []}, export_sets: {count: 0, rows: []}
}});
test('exact snapshot references only', () => assert.deepEqual(mediaManifest(fixture()), [{path: 'originals/' + sha, sha256: sha, bytes: 12}]));
test('no alternate bucket', () => {const d = fixture(); d.tables.photo_assets.rows[0].bucket = 'public'; assert.throws(() => mediaManifest(d));});
test('missing table rejected', () => {const d = fixture(); delete d.tables.export_sets; assert.throws(() => mediaManifest(d));});
test('conflicting references rejected', () => {const d = fixture(); d.tables.reference_assets = {count: 1, rows: [{...d.tables.photo_assets.rows[0], bytes: 13}]}; assert.throws(() => mediaManifest(d));});
test('count mismatch rejected', () => {const d = fixture(); d.tables.photo_assets.count = 2; assert.throws(() => mediaManifest(d));});
test('path traversal rejected', () => {const d = fixture(); d.tables.photo_assets.rows[0].object_path = '../originals/' + sha; assert.throws(() => mediaManifest(d));});
test('snapshot request cannot point to other object types', () => {assert.throws(() => validateRequest({path: 'originals/' + sha, sha256: sha})); assert.throws(() => validateRequest({path: 'recovery/../secret', sha256: sha}));});
test('valid recovery receipt request', () => {const r = {path: 'recovery/2026-11-06/00000000-0000-0000-0000-000000000001.json.gz', sha256: sha}; assert.deepEqual(validateRequest(r), r);});
