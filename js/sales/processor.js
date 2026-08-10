/**
 * Sales analysis processor (browser version).
 * Depends on: shared/utils.js, shared/column_detector.js, shared/date_parser.js,
 *              sales/column_defs.js (loaded before this file)
 */

function salesValidateAndClean(rows, mapping) {
  const warnings = [];
  const cleaned = [];
  const revMap = {};
  for (const [fk, col] of Object.entries(mapping)) {
    if (col) revMap[col] = fk;
  }

  rows.forEach((raw) => {
    const r = {};
    for (const [origCol, val] of Object.entries(raw)) {
      const fk = revMap[origCol];
      if (fk) r[fk] = val;
    }

    if (r.date != null && (!r.year || !r.month)) {
      // Convert string serial numbers to actual numbers
      var dVal = r.date;
      if (typeof dVal === 'string') { var n = parseFloat(dVal); if (!isNaN(n) && n > 30000 && n < 100000) dVal = n; }
      var parsed = parseDate(dVal) || {};
      // Fallback: brute-force extract year/month
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

    const year = parseInt(r.year);
    if (isNaN(year) || year < 2000 || year > 2100) return;
    r.year = year;

    const month = parseInt(r.month);
    if (isNaN(month) || month < 1 || month > 12) return;
    r.month = month;

    r.amount = parseFloat(r.amount) || 0;
    r.cost = parseFloat(r.cost) || 0;
    r.quantity = parseFloat(r.quantity) || 0;
    r.unit_price = parseFloat(r.unit_price) || 0;
    r.gross_profit = r.amount - r.cost;

    r.customer = String(r.customer||'').slice(0,200) || '未知';
    r.product = String(r.product||'').slice(0,200) || '未知';
    r.category = String(r.category||'').slice(0,200) || '未分类';
    r.region = String(r.region||'').slice(0,200) || '未知';
    r.channel = String(r.channel||'').slice(0,200) || '未知';
    r.department = String(r.department||'').slice(0,200) || '未知';
    r.brand = String(r.brand||'').slice(0,200) || '未知';
    r.salesperson = String(r.salesperson||'').slice(0,200) || '';
    r.order_no = String(r.order_no||'').slice(0,50) || '';
    r.remark = String(r.remark||'').slice(0,200) || '';
    r.ym = r.year + '-' + String(r.month).padStart(2, '0');

    cleaned.push(r);
  });

  const invalid = rows.length - cleaned.length;
  if (invalid > 0) warnings.push(invalid + ' 行数据无效');

  return { cleaned, warnings };
}


function salesMergeFiles(allCleaned) {
  let merged = [];
  const allWarnings = [];
  allCleaned.forEach((fd, i) => {
    merged = merged.concat(fd.cleaned);
    if (fd.warnings.length) allWarnings.push('文件'+(i+1)+': '+fd.warnings.join('; '));
  });

  const before = merged.length;
  const seen = new Set();
  const deduped = [];
  merged.forEach(r => {
    const key = r.order_no + '|' + r.ym + '|' + r.customer + '|' + r.amount;
    if (r.order_no && !seen.has(key)) { seen.add(key); deduped.push(r); }
    else if (!r.order_no) deduped.push(r);
  });
  const after = deduped.length;
  if (before > after) allWarnings.push('去重：移除 ' + (before-after) + ' 条重复');

  return { rows: deduped, warnings: allWarnings };
}


function processSalesData(rows) {
  const years = Array.from(new Set(rows.map(r => r.year))).sort((a,b) => a-b);
  const yms = Array.from(new Set(rows.map(r => r.ym))).sort();
  const cy = years[years.length-1];
  const lm = Math.max(...rows.filter(r => r.year===cy).map(r => r.month));

  function customersFor(col) {
    return Array.from(new Set(rows.map(r => r[col])));
  }
  function topList(col, n=30) {
    const amts = groupSum(rows, r => r[col], r => r.amount);
    return sortMapByValue(amts, false).slice(0,n).map(([k,v]) => ({id:k, name:k, amt:Math.round(v*100)/100}));
  }

  const customers = topList('customer', 40);
  const products = topList('product', 30);
  const regions = topList('region', 15);
  const departments = topList('department', 10);
  const brands = topList('brand', 10);
  const categories = topList('category', 15);
  const salespersons = topList('salesperson', 20);
  const channels = sortMapByValue(groupSum(rows, r => r.channel, r => r.amount), false)
    .slice(0,10).map(([k,v]) => ({name:k, amt:Math.round(v/100)/10, pct:0}));

  const deptIds = departments.map(d => d.id);
  const brandIds = brands.map(b => b.id);
  const catIds = categories.map(c => c.id);
  const spIds = salespersons.map(s => s.id);

  function getPeriod(y, mS, mE) { return rows.filter(r => r.year===y && r.month>=mS && r.month<=mE); }

  // KPI by Year
  const kpiByYear = {};
  years.forEach(y => {
    const ymMax = Math.max(...rows.filter(r => r.year===y).map(r => r.month));
    const curr = getPeriod(y, 1, ymMax);
    const prev = getPeriod(y-1, 1, ymMax);
    const cr = curr.reduce((s,r) => s+r.amount, 0);
    const pr = prev.reduce((s,r) => s+r.amount, 0);
    const cc = curr.reduce((s,r) => s+r.cost, 0);
    const pc = prev.reduce((s,r) => s+r.cost, 0);
    const cgp = cr - cc;
    const pgp = pr - pc;
    const co = new Set(curr.map(r => r.order_no).filter(Boolean)).size || curr.length;
    const po = new Set(prev.map(r => r.order_no).filter(Boolean)).size || prev.length;
    const ccu = new Set(curr.map(r => r.customer)).size;
    const pcu = new Set(prev.map(r => r.customer)).size;

    kpiByYear[String(y)] = {
      revenue: Math.round(cr*100)/100,
      revenue_prev: Math.round(pr*100)/100,
      revenue_yoy: pr>0 ? Math.round((cr/pr-1)*1000)/10 : null,
      gross_profit: Math.round(cgp*100)/100,
      gross_profit_prev: Math.round(pgp*100)/100,
      gp_margin: cr>0 ? Math.round(cgp/cr*1000)/10 : 0,
      gp_margin_prev: pr>0 ? Math.round(pgp/pr*1000)/10 : 0,
      customers: ccu,
      customers_prev: pcu,
      orders: co,
      orders_prev: po,
      avg_order: co>0 ? Math.round(cr/co*100)/100 : 0,
      avg_order_prev: po>0 ? Math.round(pr/po*100)/100 : 0,
    };
  });

  const kpi = kpiByYear[String(cy)];

  // Yearly/Monthly revenue
  const yrRevenue = years.map(y => {
    const t = rows.filter(r => r.year===y).reduce((s,r) => s+r.amount,0);
    return Math.round(t/100)/10;
  });
  const moRevenue = yms.map(ym => {
    const t = rows.filter(r => r.ym===ym).reduce((s,r) => s+r.amount,0);
    return Math.round(t/100)/10;
  });

  // Monthly gross profit
  const moGrossProfit = yms.map(ym => {
    const t = rows.filter(r => r.ym===ym).reduce((s,r) => s+r.gross_profit,0);
    return Math.round(t/100)/10;
  });

  // Customer revenue by year
  const custRevenue = {};
  customers.slice(0,15).forEach(c => {
    custRevenue[c.id] = years.map(y => {
      const t = rows.filter(r => r.year===y && r.customer===c.id).reduce((s,r) => s+r.amount,0);
      return Math.round(t/100)/10;
    });
  });

  // Product revenue by year
  const prodRevenue = {};
  products.slice(0,10).forEach(p => {
    prodRevenue[p.id] = years.map(y => {
      const t = rows.filter(r => r.year===y && r.product===p.id).reduce((s,r) => s+r.amount,0);
      return Math.round(t/100)/10;
    });
  });

  // Department revenue by year
  const deptRevenue = {};
  deptIds.forEach(did => {
    deptRevenue[did] = years.map(y => {
      const t = rows.filter(r => r.year===y && r.department===did).reduce((s,r) => s+r.amount,0);
      return Math.round(t/100)/10;
    });
  });

  // Department monthly
  const deptMonthly = {};
  deptIds.forEach(did => {
    const dm = {};
    rows.filter(r => r.department===did).forEach(r => {
      dm[r.ym] = (dm[r.ym]||0) + r.amount;
    });
    deptMonthly[did] = yms.map(ym => Math.round((dm[ym]||0)/100)/10);
  });

  // Department GP margin
  const deptGPMargin = {};
  deptIds.forEach(did => {
    const ddf = rows.filter(r => r.year===cy && r.department===did);
    const rev = ddf.reduce((s,r) => s+r.amount,0);
    const cost = ddf.reduce((s,r) => s+r.cost,0);
    deptGPMargin[did] = rev>0 ? Math.round((rev-cost)/rev*1000)/10 : 0;
  });

  // Department × Customer revenue (for treemap filter)
  const deptCustRevenue = {};
  deptIds.forEach(did => {
    const dcMap = {};
    customers.slice(0,15).forEach(c => {
      const yrArr = years.map(y => {
        const t = rows.filter(r => r.year===y && r.department===did && r.customer===c.id).reduce((s,r) => s+r.amount,0);
        return Math.round(t/100)/10;
      });
      if (yrArr.some(v => v>0)) dcMap[c.id] = yrArr;
    });
    if (Object.keys(dcMap).length>0) deptCustRevenue[did] = dcMap;
  });

  // Brand revenue by year
  const brandRevenue = {};
  brandIds.forEach(bid => {
    brandRevenue[bid] = years.map(y => {
      const t = rows.filter(r => r.year===y && r.brand===bid).reduce((s,r) => s+r.amount,0);
      return Math.round(t/100)/10;
    });
  });

  // Brand monthly
  const brandMonthly = {};
  brandIds.forEach(bid => {
    const bm = {};
    rows.filter(r => r.brand===bid).forEach(r => {
      bm[r.ym] = (bm[r.ym]||0) + r.amount;
    });
    brandMonthly[bid] = yms.map(ym => Math.round((bm[ym]||0)/100)/10);
  });

  // Brand GP margin
  const brandGPMargin = {};
  brandIds.forEach(bid => {
    const bdf = rows.filter(r => r.year===cy && r.brand===bid);
    const rev = bdf.reduce((s,r) => s+r.amount,0);
    const cost = bdf.reduce((s,r) => s+r.cost,0);
    brandGPMargin[bid] = rev>0 ? Math.round((rev-cost)/rev*1000)/10 : 0;
  });

  // Sunburst: customers
  const sunburstByYear = {};
  years.forEach(y => {
    const ydf = rows.filter(r => r.year===y);
    const camts = sortMapByValue(groupSum(ydf, r => r.customer, r => r.amount), false).slice(0,12);
    const children = camts.map(([c,a]) => ({name:c, value:Math.round(a/100)/10}));
    sunburstByYear[y] = [{name: y+'年客户收入', children, value: Math.round(children.reduce((s,c)=>s+c.value,0)*10)/10}];
  });

  // Sunburst: products
  const sunburstProdByYear = {};
  years.forEach(y => {
    const ydf = rows.filter(r => r.year===y);
    const pamts = sortMapByValue(groupSum(ydf, r => r.product, r => r.amount), false).slice(0,12);
    const children = pamts.map(([p,a]) => ({name:p, value:Math.round(a/100)/10}));
    sunburstProdByYear[y] = [{name: y+'年产品收入', children, value: Math.round(children.reduce((s,c)=>s+c.value,0)*10)/10}];
  });

  // Customer × Product heatmap by year (for sunburst filtering)
  const custProdHMByYear = {};
  years.forEach(y => {
    const ydf = rows.filter(r => r.year===y);
    const yhm = {};
    customers.slice(0,15).forEach(c => {
      const cdf = ydf.filter(r => r.customer===c.id);
      const inner = {};
      products.slice(0,10).forEach(p => {
        const amt = cdf.filter(r => r.product===p.id).reduce((s,r) => s+r.amount,0);
        if (amt>0) inner[p.id] = Math.round(amt*100)/100;
      });
      if (Object.keys(inner).length>0) yhm[c.id] = inner;
    });
    if (Object.keys(yhm).length>0) custProdHMByYear[y] = yhm;
  });

  // Customer monthly
  const custMonthly = {};
  customers.slice(0,10).forEach(c => {
    const cm = {};
    rows.filter(r => r.customer===c.id).forEach(r => {
      cm[r.ym] = (cm[r.ym]||0) + r.amount;
    });
    for (const ym in cm) cm[ym] = Math.round(cm[ym]/100)/10;
    custMonthly[c.id] = cm;
  });

  // Region data
  const regionData = regions.map(r => {
    const rd = rows.filter(r2 => r2.region===r.name);
    const total = rd.reduce((s,r2) => s+r2.amount, 0);
    const allTotal = rows.reduce((s,r2) => s+r2.amount, 0);
    return {
      name: r.name, amt: Math.round(total/100)/10,
      pct: allTotal>0 ? Math.round(total/allTotal*1000)/10 : 0,
      customers: new Set(rd.map(r2 => r2.customer)).size,
      products: new Set(rd.map(r2 => r2.product)).size,
    };
  });

  // Channel data
  const channelData = channels.map(ch => {
    const total = rows.filter(r => r.channel===ch.name).reduce((s,r) => s+r.amount, 0);
    const allTotal = rows.reduce((s,r) => s+r.amount, 0);
    return { ...ch, pct: allTotal>0 ? Math.round(total/allTotal*1000)/10 : 0 };
  });
  channelData.sort((a,b) => b.amt - a.amt);

  // MoM anomalies
  const momAnomalies = [];
  const moVals = yms.map(ym => rows.filter(r => r.ym===ym).reduce((s,r) => s+r.amount, 0));
  for (let i=1; i<moVals.length; i++) {
    if (moVals[i-1]===0) continue;
    const mom = (moVals[i]-moVals[i-1])/moVals[i-1];
    if (Math.abs(mom)>0.3) momAnomalies.push({ym:yms[i], prev:Math.round(moVals[i-1]/100)/10, curr:Math.round(moVals[i]/100)/10, mom:Math.round(mom*1000)/10});
  }

  // Churn risk
  const churnRisk = [];
  if (yms.length >= 3) {
    const recent3 = new Set(yms.slice(-3));
    const earlier = new Set(yms.slice(0, -3));
    customers.forEach(c => {
      const cyms = new Set(rows.filter(r => r.customer===c.id).map(r => r.ym));
      if ([...cyms].some(ym => earlier.has(ym)) && ![...cyms].some(ym => recent3.has(ym))) {
        const lastYm = [...cyms].sort().pop();
        const lastAmt = rows.filter(r => r.customer===c.id && r.ym===lastYm).reduce((s,r) => s+r.amount, 0);
        churnRisk.push({name:c.name, last_ym:lastYm, last_amt:Math.round(lastAmt/100)/10});
      }
    });
    churnRisk.sort((a,b) => b.last_amt - a.last_amt);
  }

  // Customer concentration
  const totalRev = rows.reduce((s,r) => s+r.amount, 0);
  const custConcentration = customers.slice(0,10).map(c => ({
    name: c.name, amt: Math.round(c.amt/100)/10, pct: totalRev>0 ? Math.round(c.amt/totalRev*1000)/10 : 0
  }));

  // CAGR
  let cagr = 0;
  if (years.length>=2) {
    const ft = rows.filter(r=>r.year===years[0]).reduce((s,r)=>s+r.amount,0);
    const lt = rows.filter(r=>r.year===years[years.length-1]).reduce((s,r)=>s+r.amount,0);
    const n = years[years.length-1]-years[0];
    cagr = ft>0 && n>0 ? (Math.pow(lt/ft,1/n)-1)*100 : 0;
  }

  // IQR outliers
  let iqrOutliers = [];
  const uniqueTrans = [];
  const seen2 = new Set();
  rows.forEach(r => {
    const k = r.customer+'|'+r.product+'|'+r.ym+'|'+r.amount;
    if (!seen2.has(k)) { seen2.add(k); uniqueTrans.push(r); }
  });
  if (uniqueTrans.length>=4) {
    const amts = uniqueTrans.map(r => r.amount).sort((a,b) => a-b);
    const Q1=amts[Math.floor(amts.length*0.25)], Q3=amts[Math.floor(amts.length*0.75)];
    const IQR=Q3-Q1, upper=Q3+3*IQR;
    iqrOutliers = uniqueTrans.filter(r => r.amount>upper).sort((a,b)=>b.amount-a.amount).slice(0,10)
      .map(r => ({y:r.year, m:r.month, customer:r.customer, product:r.product, amt:Math.round(r.amount/100)/10}));
  }

  // Per-customer GP margin, YoY
  const custGPMargin = {}, custYoY = {};
  customers.slice(0,15).forEach(c => {
    const cdf = rows.filter(r => r.year===cy && r.customer===c.id);
    const rev = cdf.reduce((s,r) => s+r.amount,0);
    const cost = cdf.reduce((s,r) => s+r.cost,0);
    custGPMargin[c.id] = rev>0 ? Math.round((rev-cost)/rev*1000)/10 : 0;
    const pyRev = rows.filter(r => r.year===cy-1 && r.customer===c.id).reduce((s,r) => s+r.amount,0);
    custYoY[c.id] = pyRev>0 ? Math.round((rev/pyRev-1)*1000)/10 : null;
  });

  // Per-product GP margin, YoY
  const prodGPMargin = {}, prodYoY = {};
  products.slice(0,10).forEach(p => {
    const pdf = rows.filter(r => r.year===cy && r.product===p.id);
    const rev = pdf.reduce((s,r) => s+r.amount,0);
    const cost = pdf.reduce((s,r) => s+r.cost,0);
    prodGPMargin[p.id] = rev>0 ? Math.round((rev-cost)/rev*1000)/10 : 0;
    const pyRev = rows.filter(r => r.year===cy-1 && r.product===p.id).reduce((s,r) => s+r.amount,0);
    prodYoY[p.id] = pyRev>0 ? Math.round((rev/pyRev-1)*1000)/10 : null;
  });

  // Customer Pareto (A/B/C tiers)
  const custPareto = [];
  const tierMap = {};
  let cumulative = 0;
  const sortedByRev = customers.slice().sort((a,b) => b.amt - a.amt);
  const nCust = sortedByRev.length;
  sortedByRev.forEach((c, i) => {
    cumulative += c.amt;
    const cumPct = Math.round(cumulative/totalRev*100*10)/10;
    const posPct = (i+1)/nCust*100;
    const tier = posPct<=20 ? 'A' : posPct<=50 ? 'B' : 'C';
    custPareto.push({name:c.name, revenue:Math.round(c.amt/100)/10, cumPct, tier});
    tierMap[c.name] = tier;
  });

  // Customer status & recent orders
  const recent3Set = new Set(yms.slice(-3));
  const recent6Set = new Set(yms.slice(-6));
  const custStatus = {};
  customers.forEach(c => {
    const cdf = rows.filter(r => r.customer===c.id);
    const recent3Count = cdf.filter(r => recent3Set.has(r.ym)).length;
    const inRecent6 = cdf.filter(r => recent6Set.has(r.ym)).length > 0;
    const status = recent3Count>0 ? 'active' : inRecent6 ? 'dormant' : 'lost';
    custStatus[c.name] = {tier: tierMap[c.name]||'C', status, recentOrders: recent3Count};
  });

  // Customer migration sankey (ALL customers, matches KPI)
  const prevYr = cy-1;
  const allCustNames = Array.from(new Set(rows.map(r => r.customer)));
  const pyActive = new Set(rows.filter(r => r.year===prevYr).map(r => r.customer));
  const cyAll = new Set(rows.filter(r => r.year===cy).map(r => r.customer));
  const cyActiveSet = new Set();
  const cyDormantSet = new Set();
  const cyLostSet = new Set();
  allCustNames.forEach(c => {
    const cdf = rows.filter(r => r.customer===c);
    const cyms = new Set(cdf.map(r => r.ym));
    const inRecent3 = [...cyms].some(ym => recent3Set.has(ym));
    const inRecent6 = [...cyms].some(ym => recent6Set.has(ym));
    if (inRecent3) cyActiveSet.add(c);
    else if (inRecent6) cyDormantSet.add(c);
    else if (pyActive.has(c) || cdf.length>0) cyLostSet.add(c);
  });
  const newCusts = new Set([...cyAll].filter(c => !pyActive.has(c)));  // matches KPI "新增客户"
  const sankeyNodes = [{name:'上年活跃'},{name:'当年活跃'},{name:'当年沉睡'},{name:'当年流失'}];
  const sankeyLinks = [];
  const pyToActive = [...pyActive].filter(c => cyActiveSet.has(c)).length;
  const pyToDormant = [...pyActive].filter(c => cyDormantSet.has(c)).length;
  const pyToLost = [...pyActive].filter(c => cyLostSet.has(c)).length;
  const newToActive = [...newCusts].filter(c => cyActiveSet.has(c)).length;
  const newToDormant = [...newCusts].filter(c => cyDormantSet.has(c)).length;
  const newToLost = [...newCusts].filter(c => cyLostSet.has(c)).length;
  if (pyToActive>0) sankeyLinks.push({source:'上年活跃',target:'当年活跃',value:pyToActive});
  if (pyToDormant>0) sankeyLinks.push({source:'上年活跃',target:'当年沉睡',value:pyToDormant});
  if (pyToLost>0) sankeyLinks.push({source:'上年活跃',target:'当年流失',value:pyToLost});
  if (newToActive+newToDormant+newToLost>0) { sankeyNodes.push({name:'当年新增'}); }
  if (newToActive>0) sankeyLinks.push({source:'当年新增',target:'当年活跃',value:newToActive});
  if (newToDormant>0) sankeyLinks.push({source:'当年新增',target:'当年沉睡',value:newToDormant});
  if (newToLost>0) sankeyLinks.push({source:'当年新增',target:'当年流失',value:newToLost});
  const custMigration = {nodes:sankeyNodes, links:sankeyLinks};

  // New / lost customers
  const cyCustSet = new Set(rows.filter(r => r.year===cy).map(r => r.customer));
  const pyCustSet = new Set(rows.filter(r => r.year===prevYr).map(r => r.customer));
  const newCustNames = [...cyCustSet].filter(c => !pyCustSet.has(c));
  const newCustomers = newCustNames.map(nc => {
    const rev = rows.filter(r => r.year===cy && r.customer===nc).reduce((s,r) => s+r.amount,0);
    return {name:nc, revenue:Math.round(rev/100)/10};
  }).sort((a,b) => b.revenue-a.revenue);
  const lostCustNames = [];
  customers.forEach(c => {
    const cyms = new Set(rows.filter(r => r.customer===c.id).map(r => r.ym));
    if ([...cyms].some(ym => !recent6Set.has(ym)) && !([...cyms].some(ym => recent6Set.has(ym)))) {
      lostCustNames.push(c);
    }
  });
  const lostCustomers = lostCustNames.map(lc => {
    const ldf = rows.filter(r => r.customer===lc.id);
    const rev = ldf.reduce((s,r) => s+r.amount,0);
    const lastYm = Array.from(new Set(ldf.map(r => r.ym))).sort().pop();
    return {name:lc.name, revenue:Math.round(rev/100)/10, last_ym:lastYm};
  }).sort((a,b) => b.revenue-a.revenue);

  // Product monthly
  const prodMonthly = {};
  products.slice(0,10).forEach(p => {
    const pm = {};
    rows.filter(r => r.product===p.id).forEach(r => {
      pm[r.ym] = (pm[r.ym]||0) + r.amount;
    });
    prodMonthly[p.id] = yms.map(ym => Math.round((pm[ym]||0)/100)/10);
  });

  // Category data
  const catRevenue = {};
  const catMonthly = {};
  const catGPMargin = {};
  catIds.forEach(cid => {
    catRevenue[cid] = years.map(y => {
      const t = rows.filter(r => r.year===y && r.category===cid).reduce((s,r) => s+r.amount,0);
      return Math.round(t/100)/10;
    });
    const cm = {};
    rows.filter(r => r.category===cid).forEach(r => {
      cm[r.ym] = (cm[r.ym]||0) + r.amount;
    });
    catMonthly[cid] = yms.map(ym => Math.round((cm[ym]||0)/100)/10);
    const cdf = rows.filter(r => r.year===cy && r.category===cid);
    const rev = cdf.reduce((s,r) => s+r.amount,0);
    const cost = cdf.reduce((s,r) => s+r.cost,0);
    catGPMargin[cid] = rev>0 ? Math.round((rev-cost)/rev*1000)/10 : 0;
  });

  // Salesperson data
  const spRevenue = {};
  const spCustomers = {};
  const spGPMargin = {};
  spIds.forEach(sid => {
    spRevenue[sid] = years.map(y => {
      const t = rows.filter(r => r.year===y && r.salesperson===sid).reduce((s,r) => s+r.amount,0);
      return Math.round(t/100)/10;
    });
    spCustomers[sid] = new Set(rows.filter(r => r.year===cy && r.salesperson===sid).map(r => r.customer)).size;
    const sdf = rows.filter(r => r.year===cy && r.salesperson===sid);
    const rev = sdf.reduce((s,r) => s+r.amount,0);
    const cost = sdf.reduce((s,r) => s+r.cost,0);
    spGPMargin[sid] = rev>0 ? Math.round((rev-cost)/rev*1000)/10 : 0;
  });

  // Diagnostics HTML
  const lastYr = years[years.length-1];
  const currT = rows.filter(r=>r.year===lastYr).reduce((s,r)=>s+r.amount,0);
  const prevT = rows.filter(r=>r.year===prevYr).reduce((s,r)=>s+r.amount,0);
  const trendPct = prevT>0 ? (currT/prevT-1)*100 : 0;
  const trendWord = trendPct>10?'增长':(trendPct<-10?'下滑':'稳定');
  const trendColor = trendPct>0?'var(--red)':'var(--green)';

  const currM = rows.filter(r=>r.year===cy&&r.month===lm);
  const prevM = lm>1?rows.filter(r=>r.year===cy&&r.month===lm-1):rows.filter(r=>r.year===cy-1&&r.month===12);
  const cmRev = currM.reduce((s,r)=>s+r.amount,0);
  const pmRev = prevM.reduce((s,r)=>s+r.amount,0);
  const momTotal = pmRev>0?(cmRev/pmRev-1)*100:0;
  const cmCust = new Set(currM.map(r=>r.customer)).size;

  const top3 = customers.slice(0,3);
  const top3Pct = totalRev>0?top3.reduce((s,c)=>s+c.amt,0)/totalRev*100:0;
  const concRisk = top3Pct>50?'⚠️ 高度集中':(top3Pct>30?'需关注':'健康');

  const cyCust = new Set(rows.filter(r=>r.year===cy).map(r=>r.customer));
  const newCust = [...cyCust].filter(c => !pyCustSet.has(c)).length;
  const lostCust = [...pyCustSet].filter(c => !cyCustSet.has(c)).length;

  const gpMargin = kpi.gp_margin;
  const gpMarginPrev = kpi.gp_margin_prev;
  const gpTrend = gpMargin>gpMarginPrev+1?'提升':(gpMargin<gpMarginPrev-1?'下降':'持平');

  const peakYr = years.reduce((best,y) => {
    const t = rows.filter(r=>r.year===y).reduce((s,r)=>s+r.amount,0);
    return t>(rows.filter(r=>r.year===best).reduce((s,r)=>s+r.amount,0))?y:best;
  }, years[0]);
  const peakAmt = rows.filter(r=>r.year===peakYr).reduce((s,r)=>s+r.amount,0);

  const diagHTML = `<h2>📊 销售分析诊断结论</h2>
<h3>1. 收入规模与趋势</h3>
<p>${years.length} 年收入 CAGR <b>${cagr.toFixed(1)}%</b>，<b>${peakYr} 年</b>达到峰值 <b>${(peakAmt/10000).toFixed(0)} 万</b>。${lastYr} 年收入 <b>${(currT/10000).toFixed(0)} 万</b>，同比 <b style="color:${trendColor}">${trendPct.toFixed(1)}%</b>，处于<b>${trendWord}期</b>。</p>

<h3>2. 毛利率分析</h3>
<p>当期毛利率 <b>${gpMargin.toFixed(1)}%</b>（上年同期 ${gpMarginPrev.toFixed(1)}%），同比${gpTrend}。毛利额 <b>${(kpi.gross_profit/10000).toFixed(0)} 万</b>。</p>

<h3>3. 最新月份（${cy}-${String(lm).padStart(2,'0')}）</h3>
<p>当月收入 <b>${(cmRev/10000).toFixed(0)} 万</b>，环比 <b style="color:${momTotal>0?'var(--red)':'var(--green)'}">${momTotal.toFixed(1)}%</b>。成交客户 <b>${cmCust}</b> 个，客单价 <b>${cmCust>0?(cmRev/cmCust/10000).toFixed(1):'-'} 万</b>。</p>

<h3>4. 客户分析</h3><ul>
<li>Top 3 客户（${top3.map(c=>c.name).join('、')}）占收入 <b>${top3Pct.toFixed(1)}%</b>，集中度：<b>${concRisk}</b>。</li>
<li>${cy} 年新增客户 <b>${newCust}</b> 个，流失 <b>${lostCust}</b> 个。</li>
${churnRisk.length>0?`<li>⚠️ 近 3 月无交易客户：${churnRisk.slice(0,5).map(c=>c.name).join('、')}</li>`:''}
</ul>

<h3>5. 产品结构</h3><ul>
${products.slice(0,5).map(p => `<li><b>${p.name}</b>：${(p.amt/10000).toFixed(0)} 万（${totalRev>0?(p.amt/totalRev*100).toFixed(1):0}%）。</li>`).join('\n')}
</ul>

${regionData.length>0?`<h3>6. 区域分布</h3><ul>${regionData.slice(0,5).map(r => `<li><b>${r.name}</b>：${r.amt.toFixed(0)} 万（${r.pct}%），${r.customers} 客户。</li>`).join('\n')}</ul>`:''}

<h3>7. 建议</h3><ul>
${top3Pct>50?'<li><b>预警</b>：客户集中度过高，建议开拓新客户分散风险。</li>':''}
${gpMargin<gpMarginPrev-3?'<li><b>关注</b>：毛利率持续下降，需分析原因。</li>':''}
${churnRisk.length>0?`<li><b>激活</b>：${churnRisk.length} 个沉睡客户，建议制定回访计划。</li>`:''}
${trendPct<0?'<li><b>扭转</b>：收入同比下滑，建议加强销售或调整产品策略。</li>':''}
${trendPct>20?'<li><b>巩固</b>：收入高速增长，关注交付能力。</li>':''}
</ul>
<p style="color:var(--muted);font-size:10px;margin-top:12px">以上分析基于销售明细数据，仅供参考。</p>`;

  // Detail rows
  const detailRows = rows.map(r => ({
    y: r.year, m: r.month, ym: r.ym,
    customer: r.customer, product: r.product,
    cat: r.category||'', region: r.region||'', channel: r.channel||'',
    dept: r.department||'', brand: r.brand||'', sp: r.salesperson||'',
    qty: r.quantity||0, price: r.unit_price||0,
    amt: Math.round(r.amount*100)/100,
    cost: Math.round((r.cost||0)*100)/100,
    gp: Math.round((r.gross_profit||0)*100)/100,
    order: r.order_no||'',
    remark: (r.remark||'').slice(0,100),
  }));

  const DATA = {
    report_type: 'sales',
    years, cy, lm, yms,
    kpi, kpiByYear,
    yrRevenue, moRevenue, moGrossProfit,
    customers, products, categories,
    departments, brands,
    regions, salespersons,
    custRevenue, prodRevenue,
    custGPMargin, custYoY,
    prodGPMargin, prodYoY,
    deptRevenue, deptMonthly, deptGPMargin, deptCustRevenue,
    brandRevenue, brandMonthly, brandGPMargin,
    catRevenue, catMonthly, catGPMargin,
    spRevenue, spCustomers, spGPMargin,
    custMonthly, prodMonthly,
    sunburstByYear, sunburstProdByYear, custProdHMByYear,
    sunburst: sunburstByYear[cy]||[],
    regionData, channelData,
    momAnom: momAnomalies.slice(0,30),
    churnRisk: churnRisk.slice(0,10),
    newCustomers, lostCustomers,
    custPareto, custMigration, custStatus,
    custConcentration,
    cagr: Math.round(cagr*10)/10,
    iqr: iqrOutliers.slice(0,10),
    topCustomers: customers.slice(0,10).map(c=>({n:c.name, a:Math.round(c.amt/100)/10})),
    topProducts: products.slice(0,10).map(p=>({n:p.name, a:Math.round(p.amt/100)/10})),
    diagHTML,
  };

  return { DATA, detailRows };
}


async function salesProcessExcelFiles(fileList, columnMapping) {
  const allRows = [];
  const allWarnings = [];
  let detectResult = null;

  // Step 1: Read headers only (fast — no data conversion)
  var hdrResult = await readExcelHeaders(fileList[0]);
  var headers = hdrResult.headers;
  allWarnings.push('Sheets: ' + hdrResult.sheetName + '(' + (hdrResult.rowCount) + '行)');
  allWarnings.push('Headers: ' + headers.slice(0,15).join(', '));

  detectResult = columnMapping
    ? { mapping: columnMapping }
    : detectColumnsGeneric(headers, SALES_COLUMN_DEFS);

  // Step 2: Fast read with inline filtering (only converts needed columns)
  for (let fi = 0; fi < fileList.length; fi++) {
    const file = fileList[fi];
    var cleaned = await readExcelDataFast(file, detectResult.mapping);
    if (fi === 0 && cleaned.length === 0) {
      allWarnings.push('警告：所有行被过滤，请检查列映射是否正确');
    }
    allWarnings.push('文件'+(fi+1)+' ('+file.name+'): 读取 '+cleaned.length+' 行');
    allRows.push(...cleaned);
  }

  if (allRows.length > 200000) {
    allWarnings.push('数据量过大('+allRows.length+'行)，仅处理前20万行');
    allRows = allRows.slice(0, 200000);
  }
  const { DATA, detailRows } = processSalesData(allRows);
  console.log('[销售分析] 文件:', fileList.length, '行数:', allRows.length);

  return {
    DATA, detailRows,
    warnings: allWarnings,
    mapping: detectResult.mapping,
    confidence: detectResult.confidence || {},
    details: detectResult.details || {},
    unmatched: detectResult.unmatched || [],
  };
}
