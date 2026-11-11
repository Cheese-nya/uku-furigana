import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { IDBFactory } from 'fake-indexeddb';
import { loadTypescript } from './loadTypescript.mjs';

const { extractNameRows, readNameDictionaryZip, isNameDictionary, isValidImportedNameDictionary, NameDictionaryImportError } =
  loadTypescript('../app/utils/nameDictionaryImport.ts');
const { NameReadingStore, NameReadingStoreError } = loadTypescript('../app/utils/nameReadingStore.ts');
const { buildImportedReadingData, normalizeNameKey } = loadTypescript('../app/utils/nameReadings.ts');

const row = (term, reading, type = '', score = 0, gloss = ['gloss']) =>
  [term, reading, type, '', score, gloss, 123456, ''];

async function zipWith(index, banks) {
  const zip = new JSZip();
  zip.file('index.json', JSON.stringify(index));
  for (const [name, rows] of Object.entries(banks)) zip.file(name, JSON.stringify(rows));
  return zip.generateAsync({ type: 'arraybuffer' });
}

test('JMnedict-style glossless rows expose kana candidates and never treat row[6] as a score', () => {
  const rows = [
    ['峰岸', '', 'surname', '', 0, ['こねぎし', 'みねぎし', 'みねぎしし', 'みねざき'], 256544, ''],
    ['峰岸', '', 'place', '', 0, ['みねぎし'], 256544, ''],
    ['国実百合', 'くにざねゆり', 'person', '', 0, ['Kunizane Yuri (1970.12.19-)'], 5294727, ''],
    ['日本', '', 'surname', '', 0, ['やまと'], 999999, ''],
  ];
  const result = extractNameRows(rows, true);
  assert.equal(result.scanned, 4);
  assert.deepEqual(result.names.map(value => [value.surface, value.reading]), [['国実百合', 'くにざねゆり']]);
  const minegishi = result.readings.find(value => value.surface === '峰岸');
  assert.deepEqual(minegishi.readings, ['こねぎし', 'みねぎし', 'みねぎしし', 'みねざき']);
  assert.equal(result.readings.some(value => value.surface === '国実百合'), false);
  assert.equal(result.readings.some(value => value.surface === '日本'), false);
});

test('ordinary Yomitan dictionaries read row[1] and split combined readings', () => {
  const rows = [
    row('峰岸', 'みねぎし', '', 4576, [{ type: 'structured-content', content: '名字' }]),
    row('美丘', 'みおか', '', 1, ['gloss']),
    row('人気', 'にんき', '', 100, ['gloss']),
    row('日本', 'にほん', '', 100, ['gloss']),
    row('美丘町', 'みおかちょう', '', 100, ['gloss']),
    row('ルキア', 'ルキア', '', 100, ['gloss']),
  ];
  const result = extractNameRows(rows, false);
  const readings = Object.fromEntries(result.readings.map(value => [value.surface, value.readings]));
  assert.deepEqual(readings['峰岸'], ['みねぎし']);
  assert.deepEqual(readings['美丘'], ['みおか']);
  assert.deepEqual(readings['美丘町'], ['みおかちょう']);
  assert.equal(readings['日本'], undefined);
  assert.equal(readings['ルキア'], undefined);
  assert.equal(readings['人気'], undefined);
});

test('a full Yomitan zip is parsed as a local reading dictionary', async () => {
  const data = await zipWith({ title: '明鏡日汉双解辞典', format: 3, revision: 'Meikyou_1.4.4' }, {
    'term_bank_1.json': [row('峰岸', 'みねぎし', '名', 0, [{ type: 'structured-content', content: '名字' }])],
    'term_bank_2.json': [row('美丘', 'みおか', '名', 0, ['gloss'])],
  });
  const progress = [];
  const result = await readNameDictionaryZip(data, value => progress.push(value));
  assert.equal(result.kind, 'reading');
  assert.equal(result.rows, 2);
  assert.equal(progress.at(-1), 1);
  assert.equal(result.library.title, '明鏡日汉双解辞典');
  assert.equal(result.library.names.length, 0);
  assert.deepEqual(result.library.readings.map(value => value.surface), ['峰岸', '美丘']);
  assert.equal(isValidImportedNameDictionary(result.library), true);
});

test('a JMnedict zip keeps its name classification across banks', async () => {
  const data = await zipWith({ title: 'JMnedict [2026-11-10]', format: 3, revision: '2026-11-10' }, {
    'term_bank_1.json': [
      ['美丘', '', 'fem', '', 0, ['みお'], 11586, ''],
      ['峰岸', '', 'surname', '', 0, ['みねぎし'], 256544, ''],
    ],
    'term_bank_2.json': [['峰岸', '', 'surname', '', 0, ['みねぎしし'], 256544, '']],
  });
  assert.equal(isNameDictionary({ title: 'JMnedict [2026-11-10]' }), true);
  const result = await readNameDictionaryZip(data);
  assert.equal(result.kind, 'name');
  assert.deepEqual(result.library.names.map(value => [value.surface, value.reading]), [['美丘', 'みお'], ['峰岸', 'みねぎし']]);
  const table = buildImportedReadingData([result.library]);
  assert.equal(table.nameTable.get(normalizeNameKey('美丘')).reading, 'みおか'); // authoritative built-in example
  assert.equal(table.nameTable.get(normalizeNameKey('峰岸')).reading, 'みねぎし'); // built-in authoritative example wins
  assert.equal(table.readingTable.get('峰岸'), undefined);
});

test('invalid zips and unusable dictionaries are reported without storing anything', async () => {
  await assert.rejects(readNameDictionaryZip(new ArrayBuffer(8)), error =>
    error instanceof NameDictionaryImportError && error.code === 'nameDictInvalidZip');
  const noRows = await zipWith({ title: 'Empty', format: 3 }, { 'term_bank_1.json': [['ルキア', 'ルキア', '', '', 0, ['gloss'], 1, '']] });
  await assert.rejects(readNameDictionaryZip(noRows), error =>
    error instanceof NameDictionaryImportError && error.code === 'nameDictNoReadings');
  const four = await zipWith({ title: 'Old', format: 4 }, { 'term_bank_1.json': [row('峰岸', 'みねぎし')] });
  await assert.rejects(readNameDictionaryZip(four), error =>
    error instanceof NameDictionaryImportError && error.code === 'nameDictUnsupportedFormat');
  const broken = new JSZip();
  broken.file('index.json', JSON.stringify({ title: 'Broken', format: 3 }));
  broken.file('term_bank_1.json', 'not json');
  const brokenBank = await broken.generateAsync({ type: 'arraybuffer' });
  await assert.rejects(readNameDictionaryZip(brokenBank), error =>
    error instanceof NameDictionaryImportError && error.code === 'nameDictInvalidZip');
});

test('the IndexedDB store saves, reloads and removes one record per dictionary id', async () => {
  const store = new NameReadingStore({ indexedDB: new IDBFactory() });
  const first = await store.save({ library: { id: 'JMnedict:1', title: 'JMnedict', revision: '1',
    names: [{ surface: '美丘', reading: 'みお', score: 0, alternatives: [] }], readings: [], updatedAt: 1 } });
  assert.equal(first.id, 'JMnedict:1');
  const data = await store.load();
  assert.equal(data.nameTable.get('美丘').reading, 'みおか'); // user's authoritative built-in reading wins
  await store.save({ library: { ...first, revision: '2', updatedAt: 2 } });
  assert.equal((await store.list()).length, 1);
  await store.remove(first.id);
  assert.equal((await store.list()).length, 0);
});

test('storage failures fall back to built-in readings and expose a stable error code', async () => {
  const store = new NameReadingStore({ indexedDB: { open() { throw new NameReadingStoreError('storageUnavailable'); } } });
  await assert.rejects(store.list(), error =>
    error instanceof NameReadingStoreError && error.code === 'storageUnavailable');
  const data = await store.load();
  assert.equal(data.nameTable.get('美丘').reading, 'みおか');
});
