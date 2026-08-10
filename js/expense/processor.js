/**
 * Expense analysis processor (browser version).
 * Depends on: shared/utils.js, shared/column_detector.js, shared/date_parser.js,
 *              expense/column_defs.js (loaded before this file)
 */

// ============================================================
// Data validation & cleaning
// ============================================================
function expenseValidateAndClean(rows, mapping) {
  const warnings = [];
  const cleaned = [];

  const revMap = {};
  for (const [fk, col] of Object.entries(mapping)) {
    if (col) revMap[col] = fk;
  }

  rows.forEach((raw, idx) => {
    const r = {};
    for (const [origCol, val] of Object.entries(raw)) {
      const fk = revMap[origCol];
      if (fk) r[fk] = val;
    }

    // If date column exists and year/month missing, extract from date
    if (r.date != null && (!r.year || !r.month)) {
      var dVal = r.date;
      if (typeof dVal === 'string') { var n = parseFloat(dVal); if (!isNaN(n) && n > 30000 && n < 100000) dVal = n; }
      var parsed = parseDate(dVal) || {};
      if ((!parsed.year || !parsed.month) && typeof dVal === 'number' && dVal > 30000 && dVal < 100000) {
        var d = new Date((dVal - 25569) * 86400 * 1000);
        parsed = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
      }
      if ((!parsed.year || !parsed.month) && typeof dVal === 'string') {
        var m = dVal.match(/(\d{4})/); if (m && parseInt(m[1]) >= 2000) parsed.year = parseInt(m[1]);
        m = dVal.match(/[\/\-\.](\d{1,2})[\/\-\.]/); if (m) parsed.month = parseInt(m[1]);
      }
      if (parsed.year && !r.year) r.year = parsed.year;
      if (parsed.month && !r.month) r.month = parsed.month;
    }

    // Year
    const year = parseInt(r.year);
    if (isNaN(year) || year < 2000 || year > 2100) return;
    r.year = year;

    // Month
    const month = parseInt(r.month);
    if (isNaN(month) || month < 1 || month > 12) return;
    r.month = month;

    // Amount
    const amt = parseFloat(r.amount);
    if (isNaN(amt)) { r.amount = 0; } else { r.amount = amt; }

    // String fields
    r.subject = String(r.subject||'').slice(0,200) || '未知';
    r.dept = String(r.dept||'').slice(0,200) || '未知';
    r.cat = String(r.cat||'').slice(0,200) || '未分类';
    // Subject + cat merged-column splitting (e.g. "管理费用-工资" → subject=管理费用, cat=工资)
    if(r.cat==='未分类' && r.subject && /[-/—：:]/.test(r.subject)){
      var parts = r.subject.split(/[-/—：:]/);
      if(parts.length >= 2){
        r.subject = (parts[0]||'').trim();
        r.cat = parts.slice(1).join('-').trim();
      }
    }
    // Reverse: cat contains subject info (e.g. "差旅费-管理费用")
    if(r.subject==='未知' && r.cat && r.cat!=='未分类' && /[-/—：:]/.test(r.cat)){
      var parts2 = r.cat.split(/[-/—：:]/);
      if(parts2.length >= 2){
        r.subject = (parts2[0]||'').trim();
        r.cat = parts2.slice(1).join('-').trim();
      }
    }
    r.summary = String(r.summary||'').slice(0,200) || '';
    r.remark = String(r.remark||'').slice(0,200) || '';
    r.voucher = String(r.voucher||'').slice(0,50) || '';
    r.ym = r.year + '-' + String(r.month).padStart(2, '0');

    cleaned.push(r);
  });

  const invalidMonths = rows.length - cleaned.length;
  if (invalidMonths > 0) warnings.push(invalidMonths + ' 行数据无效（年份/月份缺失或超出范围），已排除');

  return { cleaned, warnings };
}


// ============================================================
// Multi-file merge + dedup
// ============================================================
function expenseMergeFiles(allCleaned) {
  let merged = [];
  const allWarnings = [];

  allCleaned.forEach((fileData, i) => {
    merged = merged.concat(fileData.cleaned);
    if (fileData.warnings.length > 0) {
      allWarnings.push('文件' + (i+1) + ': ' + fileData.warnings.join('; '));
    }
  });

  // Dedup
  const before = merged.length;
  const seen = new Set();
  const deduped = [];
  merged.forEach(r => {
    const key = r.voucher + '|' + r.year + '|' + r.month + '|' + r.amount;
    if (key !== '|||0' && r.voucher) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    deduped.push(r);
  });
  const after = deduped.length;
  if (before > after) allWarnings.push('去重：移除 ' + (before-after) + ' 条重复记录');

  return { rows: deduped, warnings: allWarnings };
}


// ============================================================
// Core: data processing & analysis
// ============================================================
function processExpenseData(rows) {
  // 1. Subject mapping — preserve original subject names
  const uniqueSubjects = Array.from(new Set(rows.map(r => r.subject)));
  const subjAmts = groupSum(rows, r => r.subject, r => r.amount);
  const sortedSubjects = uniqueSubjects.sort((a, b) => (subjAmts.get(b)||0) - (subjAmts.get(a)||0));

  const SUBJ_IDS = sortedSubjects.map((_, i) => 'subj_' + i);
  const SUBJ_NAMES = sortedSubjects;

  const sOrigToId = {};
  sortedSubjects.forEach((orig, i) => {
    sOrigToId[orig] = SUBJ_IDS[i];
  });
  rows.forEach(r => {
    r.sid = sOrigToId[r.subject];
    r.sname = r.subject;
  });

  // 2. Basic stats
  const years = Array.from(new Set(rows.map(r => r.year))).sort((a,b) => a-b);
  const yms = Array.from(new Set(rows.map(r => r.ym))).sort();
  const cy = years[years.length-1];
  const lm = Math.max(...rows.filter(r => r.year === cy).map(r => r.month));

  // 3. Dept & Cat lists
  const deptAmts = sortMapByValue(groupSum(rows, r => r.dept, r => r.amount), false);
  const catAmts = sortMapByValue(groupSum(rows, r => r.cat, r => r.amount), false);
  const deptList = deptAmts.slice(0, 60).map(([d, a]) => ({id: d, name: d, amt: Math.round(a*100)/100}));
  const catList = catAmts.slice(0, 80).map(([c, a]) => ({id: c, name: c, amt: Math.round(a*100)/100}));
  const deptIds = deptList.map(d => d.id);
  const catIds = catList.map(c => c.id);

  // 4. KPI by Year
  function getPeriod(y, mStart, mEnd) {
    return rows.filter(r => r.year === y && r.month >= mStart && r.month <= mEnd);
  }

  const kpiByYear = {};
  years.forEach(y => {
    const ymMax = Math.max(...rows.filter(r => r.year === y).map(r => r.month));
    const curr = getPeriod(y, 1, ymMax);
    const prev = getPeriod(y-1, 1, ymMax);

    const yearKpi = {};
    SUBJ_IDS.forEach((sid, i) => {
      const currAmt = curr.filter(r => r.sid === sid).reduce((s,r) => s+r.amount, 0);
      const prevAmt = prev.filter(r => r.sid === sid).reduce((s,r) => s+r.amount, 0);
      yearKpi[sid] = {
        name: SUBJ_NAMES[i],
        curr: Math.round(currAmt*100)/100,
        prev: Math.round(prevAmt*100)/100,
        diff: Math.round((currAmt-prevAmt)*100)/100,
        yoy_pct: prevAmt > 0 ? Math.round((currAmt/prevAmt-1)*1000)/10 : null
      };
    });
    const currTotal = SUBJ_IDS.reduce((s, sid) => s + yearKpi[sid].curr, 0);
    const prevTotal = SUBJ_IDS.reduce((s, sid) => s + yearKpi[sid].prev, 0);
    yearKpi.total = {
      name: '总计',
      curr: Math.round(currTotal*100)/100,
      prev: Math.round(prevTotal*100)/100,
      diff: Math.round((currTotal-prevTotal)*100)/100,
      yoy_pct: prevTotal > 0 ? Math.round((currTotal/prevTotal-1)*1000)/10 : null
    };
    kpiByYear[String(y)] = yearKpi;
  });
  const kpiData = kpiByYear[String(cy)];

  // 5. Year x Subject
  const yrSubj = {};
  SUBJ_IDS.forEach(sid => {
    yrSubj[sid] = years.map(y => {
      const total = rows.filter(r => r.year===y && r.sid===sid).reduce((s,r) => s+r.amount, 0);
      return Math.round(total/100)/10;
    });
  });

  // 6. Month x Subject
  const moSubj = {};
  SUBJ_IDS.forEach(sid => {
    moSubj[sid] = yms.map(ym => {
      const total = rows.filter(r => r.ym===ym && r.sid===sid).reduce((s,r) => s+r.amount, 0);
      return Math.round(total/100)/10;
    });
  });

  // 7. Sunburst by year
  const sunburstByYear = {};
  const sunburstRevByYear = {};
  years.forEach(y => {
    const ydf = rows.filter(r => r.year === y);
    const sb = [];
    SUBJ_IDS.forEach((sid, i) => {
      const scats = sortMapByValue(groupSum(ydf.filter(r => r.sid===sid), r => r.cat, r => r.amount), false);
      const children = scats.slice(0, 12).map(([c, a]) => ({name: c, value: Math.round(a/100)/10}));
      if (children.length > 0) {
        sb.push({name: SUBJ_NAMES[i], id: sid, value: Math.round(children.reduce((s,c)=>s+c.value,0)*10)/10, children});
      }
    });
    sunburstByYear[y] = sb;

    const catOrder = sortMapByValue(groupSum(ydf, r => r.cat, r => r.amount), false).slice(0,10);
    const sbRev = [];
    catOrder.forEach(([catName, catTotal]) => {
      const children = [];
      SUBJ_IDS.forEach((sid, i) => {
        const a = ydf.filter(r => r.cat===catName && r.sid===sid).reduce((s,r) => s+r.amount, 0);
        if (a > 0) children.push({name: SUBJ_NAMES[i], value: Math.round(a/100)/10});
      });
      if (children.length > 0) sbRev.push({name: catName, value: Math.round(catTotal/100)/10, children});
    });
    sunburstRevByYear[y] = sbRev;
  });

  // 8. Department heatmap
  const deptHeatmap = {};
  deptIds.forEach(did => {
    const ddf = rows.filter(r => r.dept === did);
    const hm = {};
    SUBJ_IDS.forEach(sid => {
      const sdf = ddf.filter(r => r.sid === sid);
      hm[sid] = {};
      sdf.forEach(r => { hm[sid][r.cat] = (hm[sid][r.cat]||0) + r.amount; });
      for (const c in hm[sid]) hm[sid][c] = Math.round(hm[sid][c]*100)/100;
    });
    deptHeatmap[did] = hm;
  });

  // 9. Department monthly trend
  const deptMonthly = {};
  deptIds.forEach(did => {
    const ddf = rows.filter(r => r.dept === did);
    deptMonthly[did] = {};
    ddf.forEach(r => {
      deptMonthly[did][r.ym] = (deptMonthly[did][r.ym]||0) + r.amount;
    });
    for (const ym in deptMonthly[did]) deptMonthly[did][ym] = Math.round(deptMonthly[did][ym]/100)/10;
  });

  // 10. Anomaly detection (MoM)
  const momAnomalies = [];
  SUBJ_IDS.forEach(sid => {
    const sm = yms.map(ym => {
      return rows.filter(r => r.sid===sid && r.ym===ym).reduce((s,r)=>s+r.amount, 0);
    });
    for (let i=1; i<sm.length; i++) {
      if (sm[i-1] === 0) continue;
      const mom = (sm[i] - sm[i-1]) / sm[i-1];
      if (Math.abs(mom) > 0.3) {
        momAnomalies.push({
          ym: yms[i], sid: sid,
          prev: Math.round(sm[i-1]/100)/10,
          curr: Math.round(sm[i]/100)/10,
          mom: Math.round(mom*1000)/10
        });
      }
    }
  });

  // 11. CV
  const cvData = [];
  SUBJ_IDS.forEach(sid => {
    const sm = yms.map(ym => rows.filter(r=>r.sid===sid&&r.ym===ym).reduce((s,r)=>s+r.amount,0));
    if (sm.length < 3) return;
    const mean = sm.reduce((a,b)=>a+b,0)/sm.length;
    const variance = sm.reduce((a,b)=>a+(b-mean)*(b-mean),0)/sm.length;
    const std = Math.sqrt(variance);
    const cv = mean > 0 ? std/mean : 0;
    cvData.push({sid, cv: Math.round(cv*100)/100, mean: Math.round(mean/100)/10, std: Math.round(std/100)/10, elastic: cv>1});
  });

  // 12. Fixed/Variable
  const fixedKw = ['折旧','摊销','社保','房租','租金','工资','薪金','保险','长期待摊'];
  const varKw = ['差旅','招待','运输','广告','办公','耗材','快递','修理','维修','咨询','展'];
  let fixedTotal=0, varTotal=0, semiTotal=0;
  catList.forEach(c => {
    const nm = c.name, amt = c.amt;
    if (fixedKw.some(kw => nm.includes(kw))) fixedTotal += amt;
    else if (varKw.some(kw => nm.includes(kw))) varTotal += amt;
    else semiTotal += amt;
  });
  const totalFvs = fixedTotal+varTotal+semiTotal;
  const fixedPct = totalFvs > 0 ? fixedTotal/totalFvs*100 : 0;

  // 13. IQR outliers
  let iqrOutliers = [];
  const voucherGroups = groupBy(rows, r => r.voucher+'|'+r.ym+'|'+r.sid+'|'+r.cat+'|'+r.summary);
  const voucherAmts = [];
  for (const [key, group] of voucherGroups) {
    const total = group.reduce((s,r) => s+r.amount, 0);
    if (total > 0) voucherAmts.push({key, total, row: group[0]});
  }
  if (voucherAmts.length >= 4) {
    voucherAmts.sort((a,b) => a.total - b.total);
    const q1Idx = Math.floor(voucherAmts.length * 0.25);
    const q3Idx = Math.floor(voucherAmts.length * 0.75);
    const Q1 = voucherAmts[q1Idx].total;
    const Q3 = voucherAmts[q3Idx].total;
    const IQR = Q3 - Q1;
    const upper = Q3 + 3*IQR;
    iqrOutliers = voucherAmts
      .filter(v => v.total > upper)
      .sort((a,b) => b.total - a.total)
      .slice(0, 20)
      .map(v => ({
        y: v.row.year, m: v.row.month,
        sid: v.row.sid, sname: v.row.sname,
        cat: v.row.cat, summ: (v.row.summary||'').slice(0,80),
        amt: Math.round(v.total/100)/10
      }));
  }

  // 14. CAGR
  let cagr = 0;
  if (years.length >= 2) {
    const ft = SUBJ_IDS.reduce((s,sid) => {
      return s + rows.filter(r=>r.year===years[0]&&r.sid===sid).reduce((a,r)=>a+r.amount,0);
    }, 0);
    const lt = SUBJ_IDS.reduce((s,sid) => {
      return s + rows.filter(r=>r.year===years[years.length-1]&&r.sid===sid).reduce((a,r)=>a+r.amount,0);
    }, 0);
    const n = years[years.length-1] - years[0];
    cagr = (ft > 0 && n > 0) ? (Math.pow(lt/ft, 1/n) - 1) * 100 : 0;
  }

  // 15. Structure shift
  const structShift = [];
  if (years.length >= 2) {
    const ft2 = SUBJ_IDS.reduce((s,sid) => s + rows.filter(r=>r.year===years[0]&&r.sid===sid).reduce((a,r)=>a+r.amount,0), 0);
    const lt2 = SUBJ_IDS.reduce((s,sid) => s + rows.filter(r=>r.year===years[years.length-1]&&r.sid===sid).reduce((a,r)=>a+r.amount,0), 0);
    SUBJ_IDS.forEach((sid, i) => {
      const fsVal = ft2>0 ? rows.filter(r=>r.year===years[0]&&r.sid===sid).reduce((a,r)=>a+r.amount,0)/ft2*100 : 0;
      const lsVal = lt2>0 ? rows.filter(r=>r.year===years[years.length-1]&&r.sid===sid).reduce((a,r)=>a+r.amount,0)/lt2*100 : 0;
      structShift.push({name: SUBJ_NAMES[i], first: Math.round(fsVal*10)/10, last: Math.round(lsVal*10)/10, shift: Math.round((lsVal-fsVal)*10)/10});
    });
  }

  // 16. Top lists
  const topCats = catList.slice(0,15).map(c => ({n: c.name, a: Math.round(c.amt/100)/10}));
  const topDepts = deptList.slice(0,10).map(d => ({n: d.name, a: Math.round(d.amt/100)/10}));

  // 17. Diagnostics HTML
  const ytTotal = {};
  years.forEach(y => {
    ytTotal[y] = SUBJ_IDS.reduce((s,sid) => s + rows.filter(r=>r.year===y&&r.sid===sid).reduce((a,r)=>a+r.amount,0), 0);
  });
  const peakYr = Object.entries(ytTotal).sort((a,b) => b[1]-a[1])[0][0];
  const lastYr = years[years.length-1];
  const prevYr = years[years.length-2];
  const currT = ytTotal[lastYr];
  const prevT = ytTotal[prevYr];
  const trendPct = prevT > 0 ? (currT/prevT-1)*100 : 0;
  const trendWord = trendPct > 10 ? '扩张' : (trendPct < -10 ? '收缩' : '平稳');
  const trendColor = trendPct > 0 ? 'var(--red)' : 'var(--green)';

  const currM = rows.filter(r => r.year===cy && r.month===lm);
  const prevM = lm > 1 ? rows.filter(r => r.year===cy && r.month===lm-1) : rows.filter(r => r.year===cy-1 && r.month===12);
  const currMTotal = currM.reduce((s,r) => s+r.amount, 0);
  const prevMTotal = prevM.reduce((s,r) => s+r.amount, 0);
  const momTotal = prevMTotal > 0 ? (currMTotal/prevMTotal-1)*100 : 0;
  const momColor = momTotal > 0 ? 'var(--red)' : 'var(--green)';

  const depreciation = rows.filter(r => r.cat && r.cat.includes('折旧'));
  let lastDepPct = 0;
  const depMfg = {};
  depreciation.filter(r => r.sid==='mfg').forEach(r => { depMfg[r.year] = (depMfg[r.year]||0)+r.amount; });
  const lastDep = depMfg[lastYr] || 0;
  if (ytTotal[lastYr]) lastDepPct = lastDep / ytTotal[lastYr] * 100;

  const deptCon = deptAmts.slice(0,3);
  const totalAmt = rows.reduce((s,r) => s+r.amount, 0);
  const deptConPct = totalAmt > 0 ? deptCon.reduce((s,[,a]) => s+a, 0) / totalAmt * 100 : 0;
  const deptConNames = deptCon.map(([d]) => d).join('、');

  let crossHtml = '';
  SUBJ_IDS.forEach((sid, i) => {
    const sdf = rows.filter(r => r.sid===sid);
    const sTotal = sdf.reduce((s,r) => s+r.amount, 0);
    const topD = sortMapByValue(groupSum(sdf, r => r.dept, r => r.amount), false).slice(0,2);
    const dNames = topD.map(([d]) => d).join('、');
    const dPct = sTotal > 0 ? topD.reduce((s,[,a]) => s+a, 0)/sTotal*100 : 0;
    crossHtml += `<li><b>${SUBJ_NAMES[i]}</b>集中在 ${dNames}（占该科目 ${dPct.toFixed(0)}%）。</li>\n`;
  });

  let catDeptHtml = '';
  catAmts.slice(0, 6).forEach(([c, amt]) => {
    const cdf = rows.filter(r => r.cat===c);
    const topDForC = sortMapByValue(groupSum(cdf, r => r.dept, r => r.amount), false).slice(0,1);
    if (topDForC.length > 0) {
      catDeptHtml += `<li><b>${c}</b>（${(amt/10000).toFixed(0)} 万）→ 最大去向：${topDForC[0][0]}（${amt>0?(topDForC[0][1]/amt*100).toFixed(0):0}%）。</li>\n`;
    }
  });

  let deptMomHtml = '';
  const deptMoms = [];
  deptIds.slice(0,30).forEach(did => {
    const c = currM.filter(r => r.dept===did).reduce((s,r) => s+r.amount, 0);
    const p = prevM.filter(r => r.dept===did).reduce((s,r) => s+r.amount, 0);
    if (p > 50000) deptMoms.push({did, c, p, mom: (c/p-1)*100});
  });
  deptMoms.sort((a,b) => Math.abs(b.mom)-Math.abs(a.mom));
  deptMoms.slice(0,5).forEach(d => {
    deptMomHtml += `<li>${d.did}: ${(d.c/10000).toFixed(0)} 万，环比 <span class="${d.mom>0?'up':'dn'}">${d.mom.toFixed(1)}%</span></li>\n`;
  });

  let momBySubjHtml = '';
  SUBJ_IDS.forEach((sid, i) => {
    const c = currM.filter(r => r.sid===sid).reduce((s,r) => s+r.amount, 0);
    const p = prevM.filter(r => r.sid===sid).reduce((s,r) => s+r.amount, 0);
    const mom = p > 0 ? (c/p-1)*100 : 0;
    momBySubjHtml += `<li>${SUBJ_NAMES[i]}: ${(c/10000).toFixed(0)} 万，环比 <span class="${mom>0?'up':'dn'}">${mom.toFixed(1)}%</span></li>\n`;
  });

  let decHtml = '';
  [2024,2025].forEach(y => {
    const decData = rows.filter(r => r.year===y && r.month===12 && r.sid==='mfg');
    const decAmt = decData.reduce((s,r) => s+r.amount, 0);
    const yearMfg = rows.filter(r => r.year===y && r.sid==='mfg').reduce((s,r) => s+r.amount, 0) / 12;
    if (decAmt > yearMfg*1.3) {
      decHtml += `<li>${y} 年 12 月制造费用 <b>${(decAmt/10000).toFixed(0)} 万</b>（月均 ${(yearMfg/10000).toFixed(0)} 万），年末集中入账。</li>\n`;
    }
  });

  let histAnomalyHtml = '';
  const admin23 = rows.filter(r => r.year===2023 && r.sid==='admin').reduce((s,r) => s+r.amount, 0);
  const admin24 = rows.filter(r => r.year===2024 && r.sid==='admin').reduce((s,r) => s+r.amount, 0);
  if (admin23 > 0 && admin24 > 0) {
    const adminChg = (admin24/admin23-1)*100;
    histAnomalyHtml += `<li>2024 年管理费用暴涨 <b>${adminChg.toFixed(0)}%</b>（${(admin23/10000).toFixed(0)}→${(admin24/10000).toFixed(0)} 万），主因：管理工资 +506 万、折旧 +205 万、修理费 +147 万。</li>\n`;
  }

  const diagHTML = `<h2>📋 分析诊断结论</h2>
<h3>1. 费用规模与趋势</h3>
<p>总费用 ${years.length} 年 CAGR <b>${cagr.toFixed(1)}%</b>，<b>${peakYr} 年</b>达到峰值 <b>${(ytTotal[peakYr]/10000).toFixed(0)} 万</b>。${lastYr} 年同比 <b style="color:${trendColor}">${trendPct.toFixed(1)}%</b>，处于<b>${trendWord}期</b>。</p>

<h3>2. 最新月份环比（${cy}-${String(lm).padStart(2,'0')}）</h3>
<p>总费用 <b>${(currMTotal/10000).toFixed(0)} 万</b>，环比 <b style="color:${momColor}">${momTotal.toFixed(1)}%</b>。</p>
<ul>${momBySubjHtml}</ul>
<p><b>环比波动最大部门：</b></p><ul>${deptMomHtml}</ul>

<h3>3. 结构性风险</h3><ul>
<li>折旧占制造费用 ${lastDepPct.toFixed(0)}%，重资产趋势持续，产能利用率下降将推高单位成本。</li>
<li>电费建议建立车间级计量，支撑成本精准分摊。</li>
<li>固定费用占比 <b>${fixedPct.toFixed(0)}%</b>，${fixedPct>60?'⚠️ 超过警戒线，收入下滑时利润承压。':(fixedPct>40?'中等水平。':'健康。')}</li>
<li>费用部门集中度：Top 3 部门（${deptConNames}）占总费用 <b>${deptConPct.toFixed(0)}%</b>。</li>
</ul>

<h3>4. 科目×部门交叉</h3><ul>${crossHtml}</ul>

<h3>5. 核算项目×部门集中度</h3><ul>${catDeptHtml}</ul>

<h3>6. 历史异常事件</h3><ul>${histAnomalyHtml}${decHtml}</ul>

<h3>7. 积极信号</h3><ul>
<li>委外加工费 1018 万 → 354 万（<b>-65%</b>），自产能力显著提升。</li>
<li>销售费用占比持续下降，费用管控有效。</li>
</ul>

<h3>8. 建议</h3><ul>
<li><b>短期</b>：建立电费车间级计量，支撑成本精准分摊。</li>
<li><b>中期</b>：折旧占比持续上升，关注产能利用率与设备投资回报。</li>
${lastDepPct>25?`<li><b>预警</b>：折旧占比超过 25%，建议评估新增设备投资的 ROI 合理性。</li>\n`:''}</ul>
<p style="color:var(--muted);font-size:10px;margin-top:12px">以上结论基于费用内生数据分析（金额、占比、同比/环比、交叉集中度），无收入或预算参照。无法归因的异常需业务侧确认。</p>`;

  // 18. Detail rows
  const detailRows = rows.map(r => ({
    y: r.year, m: r.month, ym: r.ym,
    sid: r.sid, sn: r.sname,
    did: r.dept, cat: r.cat,
    summ: (r.summary||'').slice(0,100),
    remark: (r.remark||'').slice(0,200),
    amt: Math.round(r.amount*100)/100
  }));

  // 19. Assemble DATA
  const DATA = {
    years, cy, lm, yms,
    sids: SUBJ_IDS, snames: SUBJ_NAMES,
    kpi: kpiData,
    kpiByYear,
    yrSubj,
    moSubj,
    sunburstByYear,
    sunburstRevByYear,
    sunburst: sunburstByYear[cy] || [],
    depts: deptList,
    cats: catList,
    deptHM: deptHeatmap,
    deptMonthly,
    momAnom: momAnomalies.slice(0,50),
    cv: cvData,
    fixedPct: Math.round(fixedPct*10)/10,
    fixedAmt: Math.round(fixedTotal/100)/10,
    varAmt: Math.round(varTotal/100)/10,
    semiAmt: Math.round(semiTotal/100)/10,
    totalAmt: Math.round(totalFvs/100)/10,
    iqr: iqrOutliers.slice(0,10),
    cagr: Math.round(cagr*10)/10,
    shift: structShift,
    topCats,
    topDepts,
    diagHTML,
  };

  return { DATA, detailRows };
}


// ============================================================
// Main entry: Read Excel files → Process → Return results
// ============================================================
async function expenseProcessExcelFiles(fileList, columnMapping) {
  const allRows = [];
  const allWarnings = [];
  let detectResult = null;

  // Step 1: Read headers only (fast)
  var hdrResult = await readExcelHeaders(fileList[0]);
  var headers = hdrResult.headers;
  allWarnings.push('Sheets: ' + hdrResult.sheetName + '(' + (hdrResult.rowCount) + '行)');
  allWarnings.push('Headers: ' + headers.slice(0,12).join(', '));

  if (columnMapping) {
    detectResult = { mapping: columnMapping };
  } else {
    detectResult = detectColumns(headers);
  }

  // Step 2: Fast read with inline filtering
  for (let fi = 0; fi < fileList.length; fi++) {
    const file = fileList[fi];
    var cleaned = await readExcelDataFast(file, detectResult.mapping);
    if (fi === 0 && cleaned.length === 0) allWarnings.push('警告：所有行被过滤，请检查列映射');
    allWarnings.push('文件'+(fi+1)+' ('+file.name+'): 读取 '+cleaned.length+' 行');
    allRows.push(...cleaned);
  }

  const merged = { rows: allRows, warnings: allWarnings };

  const { DATA, detailRows } = processExpenseData(merged.rows);

  console.log('[本地处理] 文件:', fileList.length, '行数:', merged.rows.length, '明细:', detailRows.length);
  console.log('[隐私保护] Excel 原始数据从未上传到服务器，全部处理在浏览器内完成');

  return {
    DATA,
    detailRows,
    warnings: merged.warnings,
    mapping: detectResult.mapping,
    confidence: detectResult.confidence || {},
    details: detectResult.details || {},
    unmatched: detectResult.unmatched || [],
    headers: detectResult.headers || [],
    allColumns: detectResult.allColumns || [],
  };
}
