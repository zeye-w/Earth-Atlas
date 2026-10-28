import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale, translate } from '../src/i18n/core.ts';
import { ENGLISH } from '../src/locales/en.ts';
import { relativeTime } from '../src/timeline.ts';
import { localSearch, searchPlaces } from '../src/placeSearch.ts';

test('explicit URL language takes priority; Chinese remains the default', () => {
  assert.equal(resolveLocale('?lang=en', 'zh'), 'en');
  assert.equal(resolveLocale('?lang=zh', 'en'), 'zh');
  assert.equal(resolveLocale('', 'en'), 'en');
  assert.equal(resolveLocale('?lang=unknown', null), 'zh');
  assert.equal(resolveLocale('', 'unknown'), 'zh');
});
test('UI text, geographic names and interpolated values translate without changing IDs', () => {
  assert.equal(translate('搜索地点', 'en'), 'Search places');
  assert.equal(translate('北京', 'en'), 'Beijing');
  assert.equal(translate('搜索地点', 'zh'), '搜索地点');
  assert.equal(translate('beijing', 'en'), 'beijing');
  const key = '地点：{0}·{1}°,{2}°';
  assert.equal(translate(key, 'en', '北京', '39.90', '116.40'), 'Location: Beijing · 39.90°, 116.40°');
  assert.equal(translate(key, 'zh', '北京', '39.90', '116.40'), '地点：北京·39.90°,116.40°');
  assert.match(translate('公元前 500 年', 'en'), /500 BCE/);
  assert.equal(translate(null, 'en'), '');
});
test('English catalog contains no Chinese UI copy and preserves interpolation placeholders', () => {
  for (const [source, english] of Object.entries(ENGLISH)) {
    assert.ok(!/\p{Script=Han}/u.test(english), source);
    const slots = text => [...text.matchAll(/\{\d+\}/g)].map(m => m[0]).sort();
    assert.deepEqual(slots(english), slots(source), source);
    assert.ok(english.length > 0, source);
  }
});
test('relative times use English singular/plural and preserve existing Chinese output', () => {
  assert.equal(relativeTime(0, 60_000, 'en'), '1 minute ago');
  assert.equal(relativeTime(3 * 3_600_000, 0, 'en'), 'in 3 hours');
  assert.equal(relativeTime(0, 30 * 3_600_000, 'en'), '1 day 6 hours ago');
  assert.equal(relativeTime(0, 0, 'en'), 'Now');
  assert.equal(relativeTime(0, 60_000), '1 分钟前');
});
test('English local search returns English names and retains bilingual matching and stable IDs', () => {
  const beijing = localSearch('北京', 'en').find(p => p.id === 'beijing');
  assert.equal(beijing.name, 'Beijing');
  assert.equal(localSearch('中国', 'en').find(p => p.id === 'country:CN').name, 'China');
  assert.equal(localSearch('Beijing', 'zh').find(p => p.id === 'beijing').name, '北京');
});
test('remote geocoder receives selected language', async () => {
  const original = globalThis.fetch;
  let language;
  globalThis.fetch = async url => { language = new URL(url).searchParams.get('language'); return new Response('{"results":[]}'); };
  try {
    await searchPlaces('Cambridge', new AbortController().signal, 'en');
    assert.equal(language, 'en');
  } finally { globalThis.fetch = original; }
});
