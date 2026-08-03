/**
 * Robust multi-format date parser (browser version).
 * Extracts {year, month} from Date objects, Excel serial numbers,
 * ISO dates, Chinese dates, and year-month formats.
 */

function parseDate(val) {
  if (val == null || val === '') return { year: null, month: null };

  // Date object
  if (val instanceof Date) {
    return { year: val.getFullYear(), month: val.getMonth() + 1 };
  }

  // Number (Excel serial)
  if (typeof val === 'number') {
    if (val > 3000 && val < 100000) {
      var base = new Date(1899, 11, 30);
      base.setDate(base.getDate() + Math.floor(val));
      return { year: base.getFullYear(), month: base.getMonth() + 1 };
    }
    if (val >= 2000 && val <= 2100) return { year: Math.floor(val), month: null };
    return { year: null, month: null };
  }

  var s = String(val).trim();
  if (!s) return { year: null, month: null };

  // Try various date formats
  var m;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { var y=parseInt(m[1]), mo=parseInt(m[2]); if(y>=2000&&y<=2100&&mo>=1&&mo<=12) return {year:y, month:mo}; }
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) { var y=parseInt(m[1]), mo=parseInt(m[2]); if(y>=2000&&y<=2100&&mo>=1&&mo<=12) return {year:y, month:mo}; }
  m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (m) { var y=parseInt(m[1]), mo=parseInt(m[2]); if(y>=2000&&y<=2100&&mo>=1&&mo<=12) return {year:y, month:mo}; }
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) { var y=parseInt(m[1]), mo=parseInt(m[2]); if(y>=2000&&y<=2100&&mo>=1&&mo<=12) return {year:y, month:mo}; }
  m = s.match(/^(\d{4})\/(\d{1,2})$/);
  if (m) { var y=parseInt(m[1]), mo=parseInt(m[2]); if(y>=2000&&y<=2100&&mo>=1&&mo<=12) return {year:y, month:mo}; }
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
  if (m) { var y=parseInt(m[1]), mo=parseInt(m[2]); if(y>=2000&&y<=2100&&mo>=1&&mo<=12) return {year:y, month:mo}; }
  m = s.match(/^(\d{4})年(\d{1,2})月$/);
  if (m) { var y=parseInt(m[1]), mo=parseInt(m[2]); if(y>=2000&&y<=2100&&mo>=1&&mo<=12) return {year:y, month:mo}; }

  return { year: null, month: null };
}
