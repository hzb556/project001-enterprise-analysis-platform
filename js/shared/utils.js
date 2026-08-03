/**
 * Shared utility functions for data processing.
 * All functions are global — loaded via <script> tags.
 */

function cleanStr(s) { return String(s||'').replace(/[\s\-_\/]+/g, '').toLowerCase(); }

function groupBy(arr, keyFn) {
  const map = new Map();
  arr.forEach(item => {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return map;
}

function groupSum(arr, keyFn, valFn) {
  const map = new Map();
  arr.forEach(item => {
    const k = keyFn(item);
    map.set(k, (map.get(k)||0) + valFn(item));
  });
  return map;
}

function sortMapByValue(map, asc) {
  const entries = [...map.entries()];
  entries.sort((a,b) => asc ? a[1]-b[1] : b[1]-a[1]);
  return entries;
}
