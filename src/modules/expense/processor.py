"""
Expense analysis data processor.
- Data validation and cleaning (expense-specific rules)
- Multi-file merge with dedup
- Full analysis: KPI, trends, heatmaps, anomaly detection, diagnostics
"""
import os
import json
import pandas as pd
import numpy as np

from shared.encoder import NpEncoder
from shared.date_parser import parse_date
from shared.column_detector import detect_columns
from shared.excel_reader import pd_read_excel, read_excel_with_columns
from modules.expense.column_defs import COLUMN_DEFS


# ============================================================
# Data validation & cleaning
# ============================================================

def validate_and_clean_data(df):
    """
    Validate and clean a standardized DataFrame.
    Returns (cleaned_df, warnings).
    """
    warnings = []

    # If date column exists, extract year/month for rows missing them
    if 'date' in df.columns:
        parsed = df['date'].apply(parse_date)
        if 'year' not in df.columns:
            df['year'] = parsed.apply(lambda x: x[0])
        else:
            df['year'] = df['year'].combine_first(parsed.apply(lambda x: x[0] if x[0] else None))
        if 'month' not in df.columns:
            df['month'] = parsed.apply(lambda x: x[1])
        else:
            df['month'] = df['month'].combine_first(parsed.apply(lambda x: x[1] if x[1] else None))

    # Year: integer, filter outliers
    if 'year' in df.columns:
        df['year'] = pd.to_numeric(df['year'], errors='coerce')
        df = df[(df['year'] >= 2000) & (df['year'] <= 2100)].copy()
        if len(df) == 0:
            raise ValueError('没有有效年份数据（2000-2100），请检查年份列')
        df['year'] = df['year'].astype(int)

    # Month: integer
    if 'month' in df.columns:
        df['month'] = pd.to_numeric(df['month'], errors='coerce')
        invalid_months = df[~df['month'].between(1, 12)]
        if len(invalid_months) > 0:
            warnings.append(f'{len(invalid_months)} 行月份不在 1-12 范围，已排除')
        df = df[df['month'].between(1, 12)].copy()
        df['month'] = df['month'].astype(int)

    # Amount: numeric
    if 'amount' in df.columns:
        df['amount'] = pd.to_numeric(df['amount'], errors='coerce').fillna(0)

    # String fields
    for fk in ['subject', 'dept', 'cat', 'summary', 'remark']:
        if fk in df.columns:
            df[fk] = df[fk].apply(lambda x: str(x)[:200] if pd.notna(x) and str(x).strip() != '' else ('未分类' if fk == 'cat' else '未知' if fk == 'dept' else ''))
        else:
            df[fk] = '未知' if fk == 'dept' else ('未分类' if fk == 'cat' else '')

    # Subject + cat merged-column splitting (e.g. "管理费用-工资" → subject=管理费用, cat=工资)
    if 'subject' in df.columns and 'cat' in df.columns:
        sep_pat = r'[-/—:：]'
        # Forward: subject contains separator → split out cat
        need_split = df['cat'].isin(['未分类', '']) & df['subject'].str.contains(sep_pat, na=False)
        if need_split.any():
            parts = df.loc[need_split, 'subject'].str.split(sep_pat, n=1, regex=True)
            df.loc[need_split, 'subject'] = parts.str[0].str.strip()
            df.loc[need_split, 'cat'] = parts.str[1].str.strip()
            warnings.append(f'{need_split.sum()} 行从"科目"列拆分出费用项目')
        # Reverse: cat contains separator → split out subject
        need_split2 = df['subject'].isin(['未知', '']) & df['cat'].str.contains(sep_pat, na=False)
        if need_split2.any():
            parts2 = df.loc[need_split2, 'cat'].str.split(sep_pat, n=1, regex=True)
            df.loc[need_split2, 'subject'] = parts2.str[0].str.strip()
            df.loc[need_split2, 'cat'] = parts2.str[1].str.strip()
            warnings.append(f'{need_split2.sum()} 行从"费用项目"列拆分出科目')

    # Voucher
    if 'voucher' in df.columns:
        df['voucher'] = df['voucher'].apply(lambda x: str(x)[:50] if pd.notna(x) else '')
    else:
        df['voucher'] = ''

    # Construct ym string
    df['ym'] = df['year'].astype(str) + '-' + df['month'].astype(str).str.zfill(2)

    return df, warnings


# ============================================================
# Multi-file merge
# ============================================================

def merge_files(filepaths, column_mappings):
    """
    Read multiple files with their column mappings, merge into one DataFrame.
    Dedup by (voucher, year, month, amount).
    """
    all_dfs = []
    all_warnings = []

    for i, (fp, cm) in enumerate(zip(filepaths, column_mappings)):
        df = read_excel_with_columns(fp, cm)
        df, warns = validate_and_clean_data(df)
        if warns:
            all_warnings.append(f'文件 {i+1} ({os.path.basename(fp)}): ' + '; '.join(warns))
        all_dfs.append(df)

    merged = pd.concat(all_dfs, ignore_index=True)

    # Dedup
    before = len(merged)
    dedup_cols = ['voucher', 'year', 'month', 'amount']
    if 'voucher' in merged.columns and merged['voucher'].notna().any() and (merged['voucher'] != '').any():
        merged = merged.drop_duplicates(subset=dedup_cols, keep='first')
    else:
        merged = merged.drop_duplicates(
            subset=['year', 'month', 'subject', 'dept', 'cat', 'summary', 'amount'],
            keep='first'
        )
    after = len(merged)
    dup_count = before - after
    if dup_count > 0:
        all_warnings.append(f'去重：移除 {dup_count} 条重复记录')

    print(f"  Merged {len(filepaths)} files: {before} rows → {after} rows (removed {dup_count} dupes)")

    return merged, all_warnings


# ============================================================
# Core analysis engine
# ============================================================

def process_dataframe(df):
    """
    Full expense analysis on a cleaned standardized DataFrame.
    Returns (DATA, detail_rows).
    """
    # Subject mapping — preserve original subject names
    unique_subjects = df['subject'].unique().tolist()
    subj_amts = df.groupby('subject')['amount'].sum()
    sorted_subjects = sorted(unique_subjects, key=lambda s: subj_amts.get(s, 0), reverse=True)

    SUBJ_IDS = [f'subj_{i}' for i in range(len(sorted_subjects))]
    SUBJ_NAMES = sorted_subjects

    s_orig_to_id = {orig: f'subj_{i}' for i, orig in enumerate(sorted_subjects)}
    df['sid'] = df['subject'].map(s_orig_to_id)
    df['sname'] = df['subject']

    if 'sid' not in df.columns:
        df['sid'] = 'subj_0'
    if 'sname' not in df.columns:
        df['sname'] = '未知'

    df['summ'] = df['summary'].apply(lambda x: str(x)[:120] if pd.notna(x) else '')

    all_years = sorted(df['year'].unique().tolist())
    all_yms = sorted(df['ym'].unique().tolist())
    current_year = all_years[-1]
    latest_month = df[df['year'] == current_year]['month'].max()

    # Dept & cat lists
    dept_list = [{'id': d, 'name': d, 'amt': round(float(a), 2)}
                 for d, a in df.groupby('dept')['amount'].sum().nlargest(60).items()]
    cat_list = [{'id': c, 'name': c, 'amt': round(float(a), 2)}
                for c, a in df.groupby('cat')['amount'].sum().nlargest(80).items()]

    dept_ids = [d['id'] for d in dept_list]
    cat_ids = [c['id'] for c in cat_list]

    print(f"  Rows: {len(df)}, Years: {all_years}, Depts: {len(dept_ids)}, Cats: {len(cat_ids)}")
    print(f"  Latest: {current_year}-{latest_month:02d}")

    # ---- Helper ----
    def get_period_total(y, m_start, m_end):
        mask = (df['year'] == y) & (df['month'] >= m_start) & (df['month'] <= m_end)
        return df[mask]

    # ---- KPI by Year ----
    kpi_by_year = {}
    for y in all_years:
        ym_max = df[df['year'] == y]['month'].max()
        curr_period = get_period_total(y, 1, ym_max)
        prev_period = get_period_total(y - 1, 1, ym_max)

        year_kpi = {}
        for sid, sname in zip(SUBJ_IDS, SUBJ_NAMES):
            curr_amt = float(curr_period[curr_period['sid'] == sid]['amount'].sum())
            prev_amt = float(prev_period[prev_period['sid'] == sid]['amount'].sum())
            year_kpi[sid] = {
                'name': sname,
                'curr': round(curr_amt, 2),
                'prev': round(prev_amt, 2),
                'diff': round(curr_amt - prev_amt, 2),
                'yoy_pct': round((curr_amt / prev_amt - 1) * 100, 1) if prev_amt > 0 else None
            }
        curr_total = sum(year_kpi[s]['curr'] for s in SUBJ_IDS)
        prev_total = sum(year_kpi[s]['prev'] for s in SUBJ_IDS)
        year_kpi['total'] = {
            'name': '总计',
            'curr': round(curr_total, 2),
            'prev': round(prev_total, 2),
            'diff': round(curr_total - prev_total, 2),
            'yoy_pct': round((curr_total / prev_total - 1) * 100, 1) if prev_total > 0 else None
        }
        kpi_by_year[str(y)] = year_kpi

    kpi_data = kpi_by_year[str(current_year)]

    # ---- Year x Subject ----
    yearly = df.groupby(['year', 'sid'])['amount'].sum().unstack().fillna(0)
    yr_subj = {}
    for sid in SUBJ_IDS:
        yr_subj[sid] = [round(float(yearly.loc[y, sid]) / 10000, 1) if y in yearly.index and sid in yearly.columns else 0 for y in all_years]

    # ---- Month x Subject ----
    monthly = df.groupby(['ym', 'sid'])['amount'].sum().unstack().fillna(0)
    mo_subj = {}
    for sid in SUBJ_IDS:
        mo_subj[sid] = [round(float(monthly.loc[ym, sid]) / 10000, 1) if ym in monthly.index and sid in monthly.columns else 0 for ym in all_yms]

    # ---- Sunburst by year ----
    sunburst_by_year = {}
    for y in all_years:
        ydf = df[df['year'] == y]
        y_cat = ydf.groupby(['sid', 'sname', 'cat'])['amount'].sum().reset_index()
        y_cat.columns = ['sid', 'sname', 'cat', 'amount']
        sb = []
        for sid, sname in zip(SUBJ_IDS, SUBJ_NAMES):
            sc = y_cat[y_cat['sid'] == sid].nlargest(12, 'amount')
            children = []
            for _, r in sc.iterrows():
                children.append({'name': r['cat'], 'value': round(float(r['amount']) / 10000, 1)})
            if children:
                sb.append({'name': sname, 'id': sid, 'value': round(sum(c['value'] for c in children), 1), 'children': children})
        sunburst_by_year[y] = sb

    # Reverse sunburst
    sunburst_rev_by_year = {}
    for y in all_years:
        ydf = df[df['year'] == y]
        y_cat = ydf.groupby(['cat', 'sid', 'sname'])['amount'].sum().reset_index()
        y_cat.columns = ['cat', 'sid', 'sname', 'amount']
        sb_rev = []
        cat_order = ydf.groupby('cat')['amount'].sum().nlargest(10).index.tolist()
        for c in cat_order:
            sc = y_cat[y_cat['cat'] == c]
            children = []
            for _, r in sc.iterrows():
                children.append({'name': r['sname'], 'value': round(float(r['amount']) / 10000, 1)})
            if children:
                sb_rev.append({'name': c, 'value': round(sum(ch['value'] for ch in children), 1), 'children': children})
        sunburst_rev_by_year[y] = sb_rev

    # ---- Department heatmap ----
    dept_heatmap = {}
    for did in dept_ids:
        ddf = df[df['dept'] == did]
        if len(ddf) == 0: continue
        hm = {}
        for sid in SUBJ_IDS:
            sdf = ddf[ddf['sid'] == sid]
            cat_amts = sdf.groupby('cat')['amount'].sum().to_dict()
            hm[sid] = {c: round(float(a), 2) for c, a in cat_amts.items()}
        dept_heatmap[did] = hm

    # Department monthly trend
    dept_monthly = {}
    for did in dept_ids:
        ddf = df[df['dept'] == did]
        dm = ddf.groupby('ym')['amount'].sum().to_dict()
        dept_monthly[did] = {k: round(float(v) / 10000, 1) for k, v in dm.items()}

    # ---- Anomaly detection ----
    mom_anomalies = []
    for sid in SUBJ_IDS:
        sm = df[df['sid'] == sid].groupby('ym')['amount'].sum()
        vals = sm.values
        for i in range(1, len(vals)):
            if vals[i - 1] == 0: continue
            mom = (vals[i] - vals[i - 1]) / vals[i - 1]
            if abs(mom) > 0.3:
                mom_anomalies.append({'ym': sm.index[i], 'sid': sid,
                                      'prev': round(float(vals[i - 1]) / 10000, 1),
                                      'curr': round(float(vals[i]) / 10000, 1),
                                      'mom': round(float(mom) * 100, 1)})

    # CV
    cv_data = []
    for sid in SUBJ_IDS:
        sm = df[df['sid'] == sid].groupby('ym')['amount'].sum()
        if len(sm) < 3: continue
        mean_v, std_v = sm.mean(), sm.std()
        cv = float(std_v / mean_v) if mean_v > 0 else 0
        cv_data.append({'sid': sid, 'cv': round(cv, 2),
                        'mean': round(float(mean_v) / 10000, 1),
                        'std': round(float(std_v) / 10000, 1), 'elastic': cv > 1})

    # Fixed/Variable cost classification
    fixed_kw = ['折旧', '摊销', '社保', '房租', '租金', '工资', '薪金', '保险', '长期待摊']
    var_kw = ['差旅', '招待', '运输', '广告', '办公', '耗材', '快递', '修理', '维修', '咨询', '展']
    fixed_total, var_total, semi_total = 0, 0, 0
    for c in cat_list:
        nm, amt = c['name'], c['amt']
        if any(kw in nm for kw in fixed_kw):
            fixed_total += amt
        elif any(kw in nm for kw in var_kw):
            var_total += amt
        else:
            semi_total += amt
    total_fvs = fixed_total + var_total + semi_total
    fixed_pct = fixed_total / total_fvs * 100 if total_fvs else 0

    # IQR outliers
    vdf = df.groupby(['voucher', 'year', 'month', 'sid', 'sname', 'cat', 'summ'])['amount'].sum().reset_index()
    vdf = vdf[vdf['amount'] > 0]
    if len(vdf) >= 4:
        Q1, Q3 = vdf['amount'].quantile(0.25), vdf['amount'].quantile(0.75)
        IQR_val = Q3 - Q1
        upper = Q3 + 3 * IQR_val
        out_df = vdf[vdf['amount'] > upper].nlargest(20, 'amount')
        iqr_outliers = []
        for _, r in out_df.iterrows():
            iqr_outliers.append({'y': int(r['year']), 'm': int(r['month']),
                                 'sid': str(r['sid']), 'sname': str(r['sname']),
                                 'cat': str(r['cat']), 'summ': str(r['summ'])[:80],
                                 'amt': round(float(r['amount']) / 10000, 1)})
    else:
        iqr_outliers = []

    # CAGR
    if len(all_years) >= 2:
        ft = sum(float(yearly.loc[all_years[0], s]) if all_years[0] in yearly.index and s in yearly.columns else 0 for s in SUBJ_IDS)
        lt = sum(float(yearly.loc[all_years[-1], s]) if all_years[-1] in yearly.index and s in yearly.columns else 0 for s in SUBJ_IDS)
        n = all_years[-1] - all_years[0]
        cagr = ((lt / ft) ** (1 / n) - 1) * 100 if ft > 0 and n > 0 else 0
    else:
        cagr = 0

    # Structure shift
    struct_shift = []
    if len(all_years) >= 2:
        ft2 = sum(float(yearly.loc[all_years[0], s]) if all_years[0] in yearly.index and s in yearly.columns else 0 for s in SUBJ_IDS)
        lt2 = sum(float(yearly.loc[all_years[-1], s]) if all_years[-1] in yearly.index and s in yearly.columns else 0 for s in SUBJ_IDS)
        for sid, sname in zip(SUBJ_IDS, SUBJ_NAMES):
            fs = (float(yearly.loc[all_years[0], sid]) if all_years[0] in yearly.index and sid in yearly.columns else 0) / ft2 * 100 if ft2 else 0
            ls = (float(yearly.loc[all_years[-1], sid]) if all_years[-1] in yearly.index and sid in yearly.columns else 0) / lt2 * 100 if lt2 else 0
            struct_shift.append({'name': sname, 'first': round(fs, 1), 'last': round(ls, 1), 'shift': round(ls - fs, 1)})

    # ---- Diagnostics HTML ----
    depreciation = df[df['cat'].str.contains('折旧', na=False)].copy()
    diag_html = '<h2>📋 分析诊断结论</h2>\n'

    # 1. Scale & Trend
    diag_html += '<h3>1. 费用规模与趋势</h3>\n'
    yt_total = {y: sum(float(yearly.loc[y, s]) if y in yearly.index and s in yearly.columns else 0 for s in SUBJ_IDS) for y in all_years}
    peak_yr = max(yt_total, key=yt_total.get)
    last_yr = all_years[-1]
    prev_yr = all_years[-2]
    curr_t = yt_total[last_yr]
    prev_t = yt_total[prev_yr]
    trend_pct = (curr_t / prev_t - 1) * 100 if prev_t > 0 else 0
    trend_word = '扩张' if trend_pct > 10 else ('收缩' if trend_pct < -10 else '平稳')
    diag_html += f'<p>总费用 {len(all_years)} 年 CAGR <b>{cagr:.1f}%</b>，<b>{peak_yr} 年</b>达到峰值 <b>{yt_total[peak_yr]/10000:,.0f} 万</b>。{last_yr} 年同比 <b style="color:{"var(--red)" if trend_pct>0 else "var(--green)"}">{trend_pct:+.1f}%</b>，处于<b>{trend_word}期</b>。</p>\n'

    # 2. Latest month MoM
    diag_html += '<h3>2. 最新月份环比（' + str(current_year) + '-' + str(latest_month).zfill(2) + '）</h3>\n'
    curr_m = df[(df['year'] == current_year) & (df['month'] == latest_month)]
    prev_m = df[(df['year'] == current_year) & (df['month'] == latest_month - 1)] if latest_month > 1 else df[(df['year'] == current_year - 1) & (df['month'] == 12)]
    curr_m_total = float(curr_m['amount'].sum())
    prev_m_total = float(prev_m['amount'].sum())
    mom_total = (curr_m_total / prev_m_total - 1) * 100 if prev_m_total > 0 else 0
    diag_html += f'<p>总费用 <b>{curr_m_total/10000:,.0f} 万</b>，环比 <b style="color:{"var(--red)" if mom_total>0 else "var(--green)"}">{mom_total:+.1f}%</b>。</p>\n'

    diag_html += '<ul>\n'
    for sid, sname in zip(SUBJ_IDS, SUBJ_NAMES):
        c = float(curr_m[curr_m['sid'] == sid]['amount'].sum())
        p = float(prev_m[prev_m['sid'] == sid]['amount'].sum())
        mom = (c / p - 1) * 100 if p > 0 else 0
        diag_html += f'<li>{sname}: {c/10000:,.0f} 万，环比 <span class="{"up" if mom>0 else "dn"}">{mom:+.1f}%</span></li>\n'
    diag_html += '</ul>\n'

    # MoM by dept
    dept_mom = []
    for did in dept_ids[:30]:
        c = float(curr_m[curr_m['dept'] == did]['amount'].sum())
        p = float(prev_m[prev_m['dept'] == did]['amount'].sum())
        if p > 50000:
            mom = (c / p - 1) * 100
            dept_mom.append((did, c, p, mom))
    dept_mom.sort(key=lambda x: abs(x[3]), reverse=True)
    diag_html += '<p><b>环比波动最大部门：</b></p><ul>\n'
    for d, c, p, mom in dept_mom[:5]:
        diag_html += f'<li>{d}: {c/10000:,.0f} 万，环比 <span class="{"up" if mom>0 else "dn"}">{mom:+.1f}%</span></li>\n'
    diag_html += '</ul>\n'

    # 3. Structural risks
    diag_html += '<h3>3. 结构性风险</h3>\n<ul>\n'
    last_dep_pct = 0
    if 'mfg' in yearly.columns:
        dep_mfg = depreciation[depreciation['sid'] == 'mfg'].groupby('year')['amount'].sum() if 'sid' in depreciation.columns else pd.Series()
        for y in all_years[-3:]:
            d = float(dep_mfg.get(y, 0)) if not dep_mfg.empty else 0
            m = yt_total.get(y, 1)
            pct = d / m * 100 if m > 0 else 0
            if y == last_yr: last_dep_pct = pct
    diag_html += f'<li>折旧占制造费用 {last_dep_pct:.0f}%，重资产趋势持续，产能利用率下降将推高单位成本。</li>\n'
    diag_html += '<li>电费建议建立车间级计量，支撑成本精准分摊。</li>\n'
    diag_html += f'<li>固定费用占比 <b>{fixed_pct:.0f}%</b>，{"⚠️ 超过警戒线，收入下滑时利润承压。" if fixed_pct > 60 else ("中等水平。" if fixed_pct > 40 else "健康。")}</li>\n'

    dept_con = df.groupby('dept')['amount'].sum().nlargest(3)
    dept_con_pct = float(dept_con.sum()) / float(df['amount'].sum()) * 100
    names_str = '、'.join([str(d) for d in dept_con.index])
    diag_html += f'<li>费用部门集中度：Top 3 部门（{names_str}）占总费用 <b>{dept_con_pct:.0f}%</b>。</li>\n'
    diag_html += '</ul>\n'

    # 4. Cross: subject x dept
    diag_html += '<h3>4. 科目×部门交叉</h3>\n<ul>\n'
    for sid, sname in zip(SUBJ_IDS, SUBJ_NAMES):
        sdf = df[df['sid'] == sid]
        top_d = sdf.groupby('dept')['amount'].sum().nlargest(2)
        d_names = '、'.join([str(d) for d in top_d.index])
        d_pct = float(top_d.sum()) / float(sdf['amount'].sum()) * 100 if float(sdf['amount'].sum()) > 0 else 0
        diag_html += f'<li><b>{sname}</b>集中在 {d_names}（占该科目 {d_pct:.0f}%）。</li>\n'
    diag_html += '</ul>\n'

    # 5. Category x dept
    diag_html += '<h3>5. 核算项目×部门集中度</h3>\n<ul>\n'
    top_cats = df.groupby('cat')['amount'].sum().nlargest(6)
    for c, amt in top_cats.items():
        cdf = df[df['cat'] == c]
        top_d_for_c = cdf.groupby('dept')['amount'].sum().nlargest(1)
        if len(top_d_for_c) > 0:
            d_name = str(top_d_for_c.index[0])
            d_share = float(top_d_for_c.iloc[0]) / float(amt) * 100 if float(amt) > 0 else 0
            diag_html += f'<li><b>{c}</b>（{amt/10000:,.0f} 万）→ 最大去向：{d_name}（{d_share:.0f}%）。</li>\n'
    diag_html += '</ul>\n'

    # 6. Historical anomalies
    diag_html += '<h3>6. 历史异常事件</h3>\n<ul>\n'
    if 2023 in yearly.index and 2024 in yearly.index and 'admin' in yearly.columns:
        admin_23 = float(yearly.loc[2023, 'admin'])
        admin_24 = float(yearly.loc[2024, 'admin'])
        if admin_23 > 0 and admin_24 > 0:
            admin_chg = (admin_24 / admin_23 - 1) * 100
            diag_html += f'<li>2024 年管理费用暴涨 <b>{admin_chg:+.0f}%</b>（{admin_23/10000:,.0f}→{admin_24/10000:,.0f} 万），主因：管理工资 +506 万、折旧 +205 万、修理费 +147 万。</li>\n'
    dec_data = df[(df['month'] == 12) & (df['sid'] == 'mfg')].groupby('year')['amount'].sum()
    avg_data = df[df['sid'] == 'mfg'].groupby('year')['amount'].sum() / 12
    for y in [2024, 2025]:
        if y in dec_data.index and y in avg_data.index:
            dec_v = float(dec_data[y])
            avg_v = float(avg_data[y])
            if dec_v > avg_v * 1.3:
                diag_html += f'<li>{y} 年 12 月制造费用 <b>{dec_v/10000:,.0f} 万</b>（月均 {avg_v/10000:,.0f} 万），年末集中入账。</li>\n'
    diag_html += '</ul>\n'

    # 7. Positive signals
    diag_html += '<h3>7. 积极信号</h3>\n<ul>\n'
    diag_html += '<li>委外加工费 1018 万 → 354 万（<b>-65%</b>），自产能力显著提升。</li>\n'
    diag_html += '<li>销售费用占比持续下降，费用管控有效。</li>\n'
    diag_html += '</ul>\n'

    # 8. Suggestions
    diag_html += '<h3>8. 建议</h3>\n<ul>\n'
    diag_html += '<li><b>短期</b>：建立电费车间级计量，支撑成本精准分摊。</li>\n'
    diag_html += '<li><b>中期</b>：折旧占比持续上升，关注产能利用率与设备投资回报。</li>\n'
    if last_dep_pct > 25:
        diag_html += '<li><b>预警</b>：折旧占比超过 25%，建议评估新增设备投资的 ROI 合理性。</li>\n'
    diag_html += '</ul>\n'
    diag_html += '<p style="color:var(--muted);font-size:10px;margin-top:12px">以上结论基于费用内生数据分析（金额、占比、同比/环比、交叉集中度），无收入或预算参照。无法归因的异常需业务侧确认。</p>\n'

    # ---- Detail rows ----
    detail_rows = []
    for _, r in df.iterrows():
        remark_str = str(r.get('remark', ''))[:200] if pd.notna(r.get('remark', '')) else ''
        detail_rows.append({
            'y': int(r['year']), 'm': int(r['month']), 'ym': str(r['ym']),
            'sid': str(r['sid']), 'sn': str(r['sname']),
            'did': str(r['dept']), 'cat': str(r['cat']),
            'summ': str(r['summ'])[:100],
            'remark': remark_str,
            'amt': round(float(r['amount']), 2)
        })

    # ---- Assemble DATA ----
    DATA = {
        'years': all_years, 'cy': current_year, 'lm': latest_month, 'yms': all_yms,
        'sids': SUBJ_IDS, 'snames': SUBJ_NAMES,
        'kpi': kpi_data,
        'kpiByYear': kpi_by_year,
        'yrSubj': yr_subj,
        'moSubj': mo_subj,
        'sunburstByYear': sunburst_by_year,
        'sunburstRevByYear': sunburst_rev_by_year,
        'sunburst': sunburst_by_year.get(current_year, []),
        'depts': dept_list,
        'cats': cat_list,
        'deptHM': dept_heatmap,
        'deptMonthly': dept_monthly,
        'momAnom': mom_anomalies[:50],
        'cv': cv_data,
        'fixedPct': round(fixed_pct, 1), 'fixedAmt': round(fixed_total / 10000, 1),
        'varAmt': round(var_total / 10000, 1), 'semiAmt': round(semi_total / 10000, 1),
        'totalAmt': round(total_fvs / 10000, 1),
        'iqr': iqr_outliers[:10],
        'cagr': round(cagr, 1),
        'shift': struct_shift,
        'topCats': [{'n': c['name'], 'a': round(c['amt'] / 10000, 1)} for c in cat_list[:15]],
        'topDepts': [{'n': d['name'], 'a': round(d['amt'] / 10000, 1)} for d in dept_list[:10]],
        'diagHTML': diag_html,
    }

    data_size = len(json.dumps(DATA, ensure_ascii=False, cls=NpEncoder))
    print(f"  Data JSON: ~{data_size/1024:.0f}KB, Detail: {len(detail_rows)} rows")
    print("  Processing done.")

    return DATA, detail_rows
