"""
Sales analysis data processor.
- Revenue KPIs, trends, customer/product analysis
- Cross-dimensional analysis (customer × product, region × product)
- Anomaly detection (MoM, concentration risk, customer churn)
- Diagnostic report generation
"""
import os
import json
import pandas as pd
import numpy as np

from shared.encoder import NpEncoder
from shared.date_parser import parse_date
from shared.excel_reader import pd_read_excel, read_excel_with_columns
from modules.sales.column_defs import SALES_COLUMN_DEFS


# ============================================================
# Data validation & cleaning
# ============================================================

def validate_and_clean_data(df):
    """Validate and clean standardized sales DataFrame."""
    warnings = []

    # Extract year/month from date if needed
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

    if 'year' in df.columns:
        df['year'] = pd.to_numeric(df['year'], errors='coerce')
        df = df[(df['year'] >= 2000) & (df['year'] <= 2100)].copy()
        if len(df) == 0:
            raise ValueError('没有有效年份数据（2000-2100），请检查年份列')
        df['year'] = df['year'].astype(int)

    if 'month' in df.columns:
        df['month'] = pd.to_numeric(df['month'], errors='coerce')
        invalid = df[~df['month'].between(1, 12)]
        if len(invalid) > 0:
            warnings.append(f'{len(invalid)} 行月份不在 1-12 范围，已排除')
        df = df[df['month'].between(1, 12)].copy()
        df['month'] = df['month'].astype(int)

    # Amount
    if 'amount' in df.columns:
        df['amount'] = pd.to_numeric(df['amount'], errors='coerce').fillna(0)

    # Cost
    if 'cost' in df.columns:
        df['cost'] = pd.to_numeric(df['cost'], errors='coerce').fillna(0)
    else:
        df['cost'] = 0

    # Quantity
    if 'quantity' in df.columns:
        df['quantity'] = pd.to_numeric(df['quantity'], errors='coerce').fillna(0)
    else:
        df['quantity'] = 0

    # Unit price
    if 'unit_price' in df.columns:
        df['unit_price'] = pd.to_numeric(df['unit_price'], errors='coerce').fillna(0)

    # String fields
    for fk in ['customer', 'product', 'category', 'region', 'channel', 'department', 'brand', 'salesperson', 'remark']:
        if fk in df.columns:
            df[fk] = df[fk].apply(lambda x: str(x)[:200] if pd.notna(x) and str(x).strip() != '' else ('未知' if fk != 'remark' else ''))
        else:
            df[fk] = '未知' if fk != 'remark' else ''

    # Order number
    if 'order_no' in df.columns:
        df['order_no'] = df['order_no'].apply(lambda x: str(x)[:50] if pd.notna(x) else '')
    else:
        df['order_no'] = ''

    # ym string
    df['ym'] = df['year'].astype(str) + '-' + df['month'].astype(str).str.zfill(2)

    # Gross profit
    df['gross_profit'] = df['amount'] - df['cost']

    return df, warnings


# ============================================================
# Multi-file merge
# ============================================================

def merge_files(filepaths, column_mappings):
    """Read and merge multiple sales files."""
    all_dfs = []
    all_warnings = []

    for i, (fp, cm) in enumerate(zip(filepaths, column_mappings)):
        df = read_excel_with_columns(fp, cm)
        # Ensure required fields exist
        for fk, fd in SALES_COLUMN_DEFS.items():
            if fd['required'] and fk not in df.columns:
                df[fk] = None
        df, warns = validate_and_clean_data(df)
        if warns:
            all_warnings.append(f'文件 {i+1} ({os.path.basename(fp)}): ' + '; '.join(warns))
        all_dfs.append(df)

    merged = pd.concat(all_dfs, ignore_index=True)

    before = len(merged)
    if 'order_no' in merged.columns and merged['order_no'].notna().any() and (merged['order_no'] != '').any():
        merged = merged.drop_duplicates(subset=['order_no', 'year', 'month', 'amount'], keep='first')
    else:
        merged = merged.drop_duplicates(
            subset=['year', 'month', 'customer', 'product', 'amount'],
            keep='first'
        )
    after = len(merged)
    if before > after:
        all_warnings.append(f'去重：移除 {before - after} 条重复记录')

    print(f"  Merged {len(filepaths)} files: {before} rows → {after} rows")
    return merged, all_warnings


# ============================================================
# Core analysis
# ============================================================

def process_dataframe(df):
    """Full sales analysis on cleaned DataFrame."""

    all_years = sorted(df['year'].unique().tolist())
    all_yms = sorted(df['ym'].unique().tolist())
    current_year = all_years[-1]
    latest_month = df[df['year'] == current_year]['month'].max()

    # ---- Dimension lists ----
    def top_list(col, n=30):
        items = df.groupby(col)['amount'].sum().nlargest(n)
        return [{'id': str(k), 'name': str(k), 'amt': round(float(v), 2)} for k, v in items.items()]

    customers = top_list('customer', 40)
    products = top_list('product', 30)
    categories = top_list('category', 15) if 'category' in df.columns else []
    regions = top_list('region', 15) if 'region' in df.columns else []

    customer_ids = [c['id'] for c in customers]
    product_ids = [p['id'] for p in products]
    customer_names = [c['name'] for c in customers]
    product_names = [p['name'] for p in products]
    all_customer_names = df['customer'].unique().tolist()  # ALL customers for sankey/KPI

    print(f"  Sales rows: {len(df)}, Years: {all_years}, Customers: {len(customers)}, Products: {len(products)}")

    # ---- Helper ----
    def get_period(y, m_start, m_end):
        mask = (df['year'] == y) & (df['month'] >= m_start) & (df['month'] <= m_end)
        return df[mask]

    # ---- KPI by Year ----
    kpi_by_year = {}
    for y in all_years:
        ym_max = df[df['year'] == y]['month'].max()
        curr = get_period(y, 1, ym_max)
        prev = get_period(y - 1, 1, ym_max)

        curr_rev = float(curr['amount'].sum())
        prev_rev = float(prev['amount'].sum())
        curr_cost = float(curr['cost'].sum()) if 'cost' in curr.columns else 0
        prev_cost = float(prev['cost'].sum()) if 'cost' in prev.columns else 0
        curr_gp = curr_rev - curr_cost
        prev_gp = prev_rev - prev_cost

        curr_customers = curr['customer'].nunique()
        prev_customers = prev['customer'].nunique()
        curr_orders = curr['order_no'].nunique() if 'order_no' in curr.columns else len(curr)
        prev_orders = prev['order_no'].nunique() if 'order_no' in prev.columns else len(prev)

        kpi_by_year[str(y)] = {
            'revenue': round(curr_rev, 2),
            'revenue_prev': round(prev_rev, 2),
            'revenue_yoy': round((curr_rev / prev_rev - 1) * 100, 1) if prev_rev > 0 else None,
            'gross_profit': round(curr_gp, 2),
            'gross_profit_prev': round(prev_gp, 2),
            'gp_margin': round(curr_gp / curr_rev * 100, 1) if curr_rev > 0 else 0,
            'gp_margin_prev': round(prev_gp / prev_rev * 100, 1) if prev_rev > 0 else 0,
            'customers': int(curr_customers),
            'customers_prev': int(prev_customers),
            'orders': int(curr_orders),
            'orders_prev': int(prev_orders),
            'avg_order': round(curr_rev / curr_orders, 2) if curr_orders > 0 else 0,
            'avg_order_prev': round(prev_rev / prev_orders, 2) if prev_orders > 0 else 0,
        }

    kpi_data = kpi_by_year[str(current_year)]

    # ---- Yearly Revenue Trend ----
    yearly = df.groupby('year')['amount'].sum()
    yr_revenue = [round(float(yearly.get(y, 0)) / 10000, 1) for y in all_years]

    # ---- Monthly Revenue Trend ----
    monthly = df.groupby('ym')['amount'].sum()
    mo_revenue = [round(float(monthly.get(ym, 0)) / 10000, 1) for ym in all_yms]

    # ---- Monthly Gross Profit Trend ----
    monthly_gp = df.groupby('ym')['gross_profit'].sum()
    mo_gross_profit = [round(float(monthly_gp.get(ym, 0)) / 10000, 1) for ym in all_yms]

    # ---- Customer Revenue ----
    cust_revenue = {}
    for cid in customer_ids:
        cust_revenue[cid] = [round(float(df[(df['year'] == y) & (df['customer'] == cid)]['amount'].sum()) / 10000, 1) for y in all_years]

    # ---- Product Revenue ----
    prod_revenue = {}
    for pid in product_ids:
        prod_revenue[pid] = [round(float(df[(df['year'] == y) & (df['product'] == pid)]['amount'].sum()) / 10000, 1) for y in all_years]

    # ---- Customer × Product Heatmap ----
    cust_prod_hm = {}
    cust_prod_hm_by_year = {}
    for cid in customer_ids:  # expanded for drilldown
        cdf = df[df['customer'] == cid]
        hm = {}
        for pid in product_ids:  # all products for full drilldown
            amt = float(cdf[cdf['product'] == pid]['amount'].sum())
            if amt > 0:
                hm[pid] = round(amt, 2)
        if hm:
            cust_prod_hm[cid] = hm
    # Per-year version for sunburst filtering
    for y in all_years:
        ydf = df[df['year'] == y]
        yhm = {}
        for cid in customer_ids:  # expanded for drilldown
            cdf = ydf[ydf['customer'] == cid]
            inner = {}
            for pid in product_ids:  # all products for full drilldown
                amt = float(cdf[cdf['product'] == pid]['amount'].sum())
                if amt > 0:
                    inner[pid] = round(amt, 2)
            if inner:
                yhm[cid] = inner
        cust_prod_hm_by_year[int(y)] = yhm

    # ---- Sunburst: Customer revenue share ----
    sunburst_by_year = {}
    for y in all_years:
        ydf = df[df['year'] == y]
        cust_amts = ydf.groupby('customer')['amount'].sum().nlargest(12)
        children = [{'name': str(c), 'value': round(float(a) / 10000, 1)} for c, a in cust_amts.items()]
        sb = [{'name': f'{y}年客户收入', 'children': children, 'value': round(sum(c['value'] for c in children), 1)}]
        sunburst_by_year[y] = sb

    # Product sunburst
    sunburst_prod_by_year = {}
    for y in all_years:
        ydf = df[df['year'] == y]
        prod_amts = ydf.groupby('product')['amount'].sum().nlargest(12)
        children = [{'name': str(p), 'value': round(float(a) / 10000, 1)} for p, a in prod_amts.items()]
        sb = [{'name': f'{y}年产品收入', 'children': children, 'value': round(sum(c['value'] for c in children), 1)}]
        sunburst_prod_by_year[y] = sb

    # ---- Monthly customer trend ----
    cust_monthly = {}
    for cid in customer_ids:  # expanded for drilldown
        cdf = df[df['customer'] == cid]
        cm = cdf.groupby('ym')['amount'].sum().to_dict()
        cust_monthly[cid] = {k: round(float(v) / 10000, 1) for k, v in cm.items()}

    # ---- Per-Customer Cost, GP, GP Margin, YoY ----
    cust_cost = {}
    cust_gp = {}
    cust_gp_margin = {}
    cust_yoy = {}
    total_rev_cy = float(df[df['year'] == current_year]['amount'].sum())
    prev_year = current_year - 1

    for cid in customer_ids:
        cy_df = df[(df['year'] == current_year) & (df['customer'] == cid)]
        py_df = df[(df['year'] == prev_year) & (df['customer'] == cid)]

        cy_rev = float(cy_df['amount'].sum())
        py_rev = float(py_df['amount'].sum())
        cy_cost = float(cy_df['cost'].sum())
        cy_gp = cy_rev - cy_cost

        cust_cost[cid] = round(cy_cost / 10000, 1)
        cust_gp[cid] = round(cy_gp / 10000, 1)
        cust_gp_margin[cid] = round(cy_gp / cy_rev * 100, 1) if cy_rev > 0 else 0
        cust_yoy[cid] = round((cy_rev / py_rev - 1) * 100, 1) if py_rev > 0 else None

    # ---- Product Monthly, GP Margin, YoY ----
    prod_monthly = {}
    prod_gp_margin = {}
    prod_yoy = {}
    for pid in product_ids:
        pdf = df[df['product'] == pid]
        pm = pdf.groupby('ym')['amount'].sum().to_dict()
        prod_monthly[pid] = [round(float(pm.get(ym, 0)) / 10000, 1) for ym in all_yms]
        cy_pdf = pdf[pdf['year'] == current_year]
        cy_rev_p = float(cy_pdf['amount'].sum())
        cy_cost_p = float(cy_pdf['cost'].sum())
        prod_gp_margin[pid] = round((cy_rev_p - cy_cost_p) / cy_rev_p * 100, 1) if cy_rev_p > 0 else 0
        py_rev_p = float(pdf[pdf['year'] == prev_year]['amount'].sum())
        prod_yoy[pid] = round((cy_rev_p / py_rev_p - 1) * 100, 1) if py_rev_p > 0 else None

    # ---- Category Revenue, Monthly, GP Margin ----
    cat_ids = [c['id'] for c in categories]
    cat_revenue = {}
    cat_monthly = {}
    cat_gp_margin = {}
    for cid in cat_ids[:10]:
        cdf = df[df['category'] == cid]
        cat_revenue[cid] = [round(float(cdf[cdf['year'] == y]['amount'].sum()) / 10000, 1) for y in all_years]
        cm = cdf.groupby('ym')['amount'].sum().to_dict()
        cat_monthly[cid] = [round(float(cm.get(ym, 0)) / 10000, 1) for ym in all_yms]
        # 毛利率按年计算，数组与 all_years 对齐（供品类 KPI 按选中年份联动）
        margins = []
        for y in all_years:
            y_cdf = cdf[cdf['year'] == y]
            y_rev_c = float(y_cdf['amount'].sum())
            y_cost_c = float(y_cdf['cost'].sum())
            margins.append(round((y_rev_c - y_cost_c) / y_rev_c * 100, 1) if y_rev_c > 0 else 0)
        cat_gp_margin[cid] = margins

    # ---- Salesperson ----
    salespersons = top_list('salesperson', 20) if 'salesperson' in df.columns else []
    sp_ids = [s['id'] for s in salespersons]
    sp_revenue = {}
    sp_customers = {}
    sp_gp_margin = {}
    for sid in sp_ids:
        sdf = df[df['salesperson'] == sid]
        sp_revenue[sid] = [round(float(sdf[sdf['year'] == y]['amount'].sum()) / 10000, 1) for y in all_years]
        # 客户数、毛利率按年计算，数组与 all_years 对齐（供年份筛选联动）
        sp_customers[sid] = [int(sdf[sdf['year'] == y]['customer'].nunique()) for y in all_years]
        margins = []
        for y in all_years:
            y_sdf = sdf[sdf['year'] == y]
            y_rev_s = float(y_sdf['amount'].sum())
            y_cost_s = float(y_sdf['cost'].sum())
            margins.append(round((y_rev_s - y_cost_s) / y_rev_s * 100, 1) if y_rev_s > 0 else 0)
        sp_gp_margin[sid] = margins

    # ---- Department ----
    departments = top_list('department', 10) if 'department' in df.columns else []
    dept_ids = [d['id'] for d in departments]
    dept_revenue = {}
    dept_monthly = {}
    dept_gp_margin = {}
    for did in dept_ids:
        ddf = df[df['department'] == did]
        dept_revenue[did] = [round(float(ddf[ddf['year'] == y]['amount'].sum()) / 10000, 1) for y in all_years]
        dm = ddf.groupby('ym')['amount'].sum().to_dict()
        dept_monthly[did] = [round(float(dm.get(ym, 0)) / 10000, 1) for ym in all_yms]
        # 毛利率按年计算，数组与 all_years 对齐（供 KPI 卡片按选中年份联动）
        margins = []
        for y in all_years:
            y_ddf = ddf[ddf['year'] == y]
            y_rev_d = float(y_ddf['amount'].sum())
            y_cost_d = float(y_ddf['cost'].sum())
            margins.append(round((y_rev_d - y_cost_d) / y_rev_d * 100, 1) if y_rev_d > 0 else 0)
        dept_gp_margin[did] = margins

    # ---- Department x Customer Revenue (for treemap filter) ----
    dept_cust_revenue = {}
    for did in dept_ids:
        dc_map = {}
        for cid in customer_ids:
            dc_df = df[(df['department'] == did) & (df['customer'] == cid)]
            yr_arr = [round(float(dc_df[dc_df['year'] == y]['amount'].sum()) / 10000, 1) for y in all_years]
            if any(v > 0 for v in yr_arr):
                dc_map[cid] = yr_arr
        if dc_map:
            dept_cust_revenue[did] = dc_map

    # ---- Brand ----
    brands = top_list('brand', 10) if 'brand' in df.columns else []
    brand_ids = [b['id'] for b in brands]
    brand_revenue = {}
    brand_monthly = {}
    brand_gp_margin = {}
    for bid in brand_ids:
        bdf = df[df['brand'] == bid]
        brand_revenue[bid] = [round(float(bdf[bdf['year'] == y]['amount'].sum()) / 10000, 1) for y in all_years]
        bm = bdf.groupby('ym')['amount'].sum().to_dict()
        brand_monthly[bid] = [round(float(bm.get(ym, 0)) / 10000, 1) for ym in all_yms]
        # 毛利率按年计算，数组与 all_years 对齐（供品牌 KPI 按选中年份联动）
        margins = []
        for y in all_years:
            y_bdf = bdf[bdf['year'] == y]
            y_rev_b = float(y_bdf['amount'].sum())
            y_cost_b = float(y_bdf['cost'].sum())
            margins.append(round((y_rev_b - y_cost_b) / y_rev_b * 100, 1) if y_rev_b > 0 else 0)
        brand_gp_margin[bid] = margins

    # ---- Region breakdown ----
    region_data = []
    if 'region' in df.columns:
        for r in regions[:15]:
            rd = df[df['region'] == r['name']]
            region_data.append({
                'name': r['name'],
                'amt': round(float(rd['amount'].sum()) / 10000, 1),
                'pct': round(float(rd['amount'].sum()) / float(df['amount'].sum()) * 100, 1) if float(df['amount'].sum()) > 0 else 0,
                'customers': int(rd['customer'].nunique()),
                'products': int(rd['product'].nunique()),
            })

    # ---- Channel breakdown ----
    channel_data = []
    if 'channel' in df.columns:
        for ch_name, ch_df in df.groupby('channel'):
            if len(ch_df) > 0:
                channel_data.append({
                    'name': str(ch_name),
                    'amt': round(float(ch_df['amount'].sum()) / 10000, 1),
                    'pct': round(float(ch_df['amount'].sum()) / float(df['amount'].sum()) * 100, 1) if float(df['amount'].sum()) > 0 else 0,
                })
        channel_data.sort(key=lambda x: x['amt'], reverse=True)

    # ---- Anomaly Detection ----
    # MoM revenue anomalies
    mom_anomalies = []
    mo_values = [float(monthly.get(ym, 0)) for ym in all_yms]
    for i in range(1, len(mo_values)):
        if mo_values[i - 1] == 0: continue
        mom = (mo_values[i] - mo_values[i - 1]) / mo_values[i - 1]
        if abs(mom) > 0.3:
            mom_anomalies.append({
                'ym': all_yms[i],
                'prev': round(mo_values[i - 1] / 10000, 1),
                'curr': round(mo_values[i] / 10000, 1),
                'mom': round(float(mom) * 100, 1),
            })

    # Sleeping customers: in recent 6 months but NOT recent 3 (matches sankey dormant)
    churn_risk = []
    if len(all_yms) >= 6:
        recent_3 = set(all_yms[-3:])
        recent_6 = set(all_yms[-6:])
        for c in all_customer_names:
            cdf = df[df['customer'] == c]
            c_yms = set(cdf['ym'].unique())
            if c_yms & recent_6 and not (c_yms & recent_3):
                last_ym = max(c_yms)
                last_amt = float(cdf[cdf['ym'] == last_ym]['amount'].sum())
                churn_risk.append({
                    'name': c,
                    'last_ym': last_ym,
                    'last_amt': round(last_amt / 10000, 1),
                })
        churn_risk.sort(key=lambda x: x['last_amt'], reverse=True)


    # ---- Customer Tier (A/B/C Pareto) ----
    cust_pareto = []
    tier_map = {}
    cumulative = 0.0
    tot_rev = float(df['amount'].sum())
    sorted_by_rev = sorted(customer_names, key=lambda c: float(df[df['customer']==c]['amount'].sum()), reverse=True)
    n_cust = len(sorted_by_rev)
    for i, c in enumerate(sorted_by_rev):
        rev_c = float(df[df['customer']==c]['amount'].sum())
        cumulative += rev_c
        cum_pct = round(cumulative / tot_rev * 100, 1) if tot_rev > 0 else 0
        pos_pct = (i + 1) / n_cust * 100 if n_cust > 0 else 0
        if pos_pct <= 20: tier = 'A'
        elif pos_pct <= 50: tier = 'B'
        else: tier = 'C'
        cust_pareto.append({'name': c, 'revenue': round(rev_c/10000, 1), 'cumPct': cum_pct, 'tier': tier})
        tier_map[c] = tier


    
    # ---- Customer Status & Recent Orders ----
    recent_3_set_s = set(all_yms[-3:]) if len(all_yms) >= 3 else set(all_yms)
    recent_6_set_s = set(all_yms[-6:]) if len(all_yms) >= 6 else set(all_yms)
    cust_status = {}
    cust_recent_orders = {}
    for c in all_customer_names:
        cdf = df[df['customer'] == c]
        c_recent3 = cdf[cdf['ym'].isin(recent_3_set_s)]
        recent3_count = int(len(c_recent3))
        cust_recent_orders[c] = recent3_count
        in_recent6 = len(cdf[cdf['ym'].isin(recent_6_set_s)]) > 0
        if recent3_count > 0:
            status = 'active'
        elif in_recent6:
            status = 'dormant'
        else:
            status = 'lost'
        cust_status[c] = {'tier': tier_map.get(c, 'C'), 'status': status, 'recentOrders': recent3_count}
# ---- Customer Migration Sankey Data ----
    prev_yr_mig = current_year - 1
    recent_6_set = set(all_yms[-6:]) if len(all_yms) >= 6 else set(all_yms)
    recent_3_set = set(all_yms[-3:]) if len(all_yms) >= 3 else set(all_yms)
    py_active = set()       # had transactions in prev year
    cy_active = set()       # had transactions in recent 3 months
    cy_dormant = set()      # had transactions in recent 6 months but NOT recent 3
    cy_lost = set()         # no transactions in recent 6 months
    cy_all = set()          # had transactions in current year (any month)
    for c in all_customer_names:
        cdf = df[df['customer'] == c]
        in_py = len(cdf[cdf['year'] == prev_yr_mig]) > 0
        in_cy = len(cdf[cdf['year'] == current_year]) > 0
        in_recent6 = len(cdf[cdf['ym'].isin(recent_6_set)]) > 0
        in_recent3 = len(cdf[cdf['ym'].isin(recent_3_set)]) > 0
        if in_py:
            py_active.add(c)
        if in_cy:
            cy_all.add(c)
        if in_recent3:
            cy_active.add(c)
        elif in_recent6:
            cy_dormant.add(c)
        elif in_py or len(cdf) > 0:
            cy_lost.add(c)

    new_custs = cy_all - py_active  # "新增客户" = current year but NOT prev year (matches KPI)

    sankey_nodes = [{'name': '上年活跃'}, {'name': '当年活跃'}, {'name': '当年沉睡'}, {'name': '当年流失'}]
    sankey_links = []
    # From 上年活跃
    py_to_active = len(py_active & cy_active)
    py_to_dormant = len(py_active & cy_dormant)
    py_to_lost = len(py_active & cy_lost)
    if py_to_active > 0:
        sankey_links.append({'source': '上年活跃', 'target': '当年活跃', 'value': py_to_active})
    if py_to_dormant > 0:
        sankey_links.append({'source': '上年活跃', 'target': '当年沉睡', 'value': py_to_dormant})
    if py_to_lost > 0:
        sankey_links.append({'source': '上年活跃', 'target': '当年流失', 'value': py_to_lost})
    # From 当年新增 (matches KPI "新增客户")
    new_to_active = len(new_custs & cy_active)
    new_to_dormant = len(new_custs & cy_dormant)
    new_to_lost = len(new_custs & cy_lost)
    if new_to_active + new_to_dormant + new_to_lost > 0:
        sankey_nodes.append({'name': '当年新增'})
    if new_to_active > 0:
        sankey_links.append({'source': '当年新增', 'target': '当年活跃', 'value': new_to_active})
    if new_to_dormant > 0:
        sankey_links.append({'source': '当年新增', 'target': '当年沉睡', 'value': new_to_dormant})
    if new_to_lost > 0:
        sankey_links.append({'source': '当年新增', 'target': '当年流失', 'value': new_to_lost})
    cust_migration = {'nodes': sankey_nodes, 'links': sankey_links}
    # KPI-aligned counts (same definition as sankey)
    sankey_kpi_new = len(new_custs)
    sankey_kpi_dormant = len(cy_dormant)
    sankey_kpi_lost = len(cy_lost)

    # Regenerate churnRisk from sankey sets (matches sankey dormant definition)
    churn_risk = []
    for c in cy_dormant:
        cdf = df[df['customer'] == c]
        rev = float(cdf['amount'].sum())
        last_ym = max(cdf['ym'].unique())
        churn_risk.append({'name': c, 'last_ym': last_ym, 'last_amt': round(rev / 10000, 1)})
    churn_risk.sort(key=lambda x: x['last_amt'], reverse=True)

    # Regenerate lostCustomers from sankey sets (matches sankey lost definition)
    lost_cust_details = []
    for c in cy_lost:
        cdf = df[df['customer'] == c]
        rev = float(cdf['amount'].sum())
        last_ym = max(cdf['ym'].unique()) if len(cdf) > 0 else ''
        lost_cust_details.append({'name': c, 'revenue': round(rev / 10000, 1), 'last_ym': last_ym})
    lost_cust_details.sort(key=lambda x: x['revenue'], reverse=True)
    lost_cust_count = len(lost_cust_details)
    # Customer concentration (top customer %)
    cust_concentration = []
    total_rev = float(df['amount'].sum())
    for c in customers[:10]:
        pct = c['amt'] / total_rev * 100 if total_rev > 0 else 0
        cust_concentration.append({'name': c['name'], 'amt': round(c['amt'] / 10000, 1), 'pct': round(pct, 1)})

    # CAGR
    if len(all_years) >= 2:
        ft = float(yearly.get(all_years[0], 0))
        lt = float(yearly.get(all_years[-1], 0))
        n = all_years[-1] - all_years[0]
        cagr = ((lt / ft) ** (1 / n) - 1) * 100 if ft > 0 and n > 0 else 0
    else:
        cagr = 0

    # IQR outliers
    if len(df) >= 4:
        Q1, Q3 = df['amount'].quantile(0.25), df['amount'].quantile(0.75)
        IQR_val = Q3 - Q1
        upper = Q3 + 3 * IQR_val
        out_df = df[df['amount'] > upper].nlargest(20, 'amount')
        iqr_outliers = []
        for _, r in out_df.iterrows():
            iqr_outliers.append({
                'y': int(r['year']), 'm': int(r['month']),
                'customer': str(r['customer']), 'product': str(r['product']),
                'amt': round(float(r['amount']) / 10000, 1),
            })
    else:
        iqr_outliers = []

    # ============================================================
    # Diagnostics HTML
    # ============================================================
    last_yr = all_years[-1]
    prev_yr = all_years[-2] if len(all_years) >= 2 else last_yr
    curr_rev = float(yearly.get(last_yr, 0))
    prev_rev_val = float(yearly.get(prev_yr, 0))
    trend_pct = (curr_rev / prev_rev_val - 1) * 100 if prev_rev_val > 0 else 0
    trend_word = '增长' if trend_pct > 10 else ('下滑' if trend_pct < -10 else '稳定')

    gp_margin = kpi_data['gp_margin']
    gp_margin_prev = kpi_data['gp_margin_prev']
    gp_trend = '提升' if gp_margin > gp_margin_prev + 1 else ('下降' if gp_margin < gp_margin_prev - 1 else '持平')

    curr_m = df[(df['year'] == current_year) & (df['month'] == latest_month)]
    prev_m = df[(df['year'] == current_year) & (df['month'] == latest_month - 1)] if latest_month > 1 else df[(df['year'] == current_year - 1) & (df['month'] == 12)]
    cm_rev = float(curr_m['amount'].sum())
    pm_rev = float(prev_m['amount'].sum())
    mom_total = (cm_rev / pm_rev - 1) * 100 if pm_rev > 0 else 0

    top3_cust = customers[:3]
    top3_pct = sum(c['amt'] for c in top3_cust) / total_rev * 100 if total_rev > 0 else 0
    conc_risk = '⚠️ 高度集中' if top3_pct > 50 else ('需关注' if top3_pct > 30 else '健康')

    new_cust_count = len(new_custs)  # from sankey: cy_all - py_active

    # New customer details (from sankey sets, matches KPI)
    new_cust_details = []
    for nc in new_custs:
        nc_rev = float(df[(df['year'] == current_year) & (df['customer'] == nc)]['amount'].sum())
        last_ym = max(df[(df['year'] == current_year) & (df['customer'] == nc)]['ym'].unique())
        new_cust_details.append({'name': nc, 'revenue': round(nc_rev / 10000, 1), 'last_ym': last_ym})
    new_cust_details.sort(key=lambda x: x['revenue'], reverse=True)

    # Lost customers: already computed from sankey cy_lost above

    diag_html = '<h2>📊 销售分析诊断结论</h2>\n'

    diag_html += '<h3>1. 收入规模与趋势</h3>\n'
    peak_yr = max(all_years, key=lambda y: float(yearly.get(y, 0)))
    diag_html += f'<p>{len(all_years)} 年收入 CAGR <b>{cagr:.1f}%</b>，<b>{peak_yr} 年</b>达到峰值 <b>{yearly.get(peak_yr, 0)/10000:,.0f} 万</b>。'
    diag_html += f'{last_yr} 年收入 <b>{curr_rev/10000:,.0f} 万</b>，同比 <b style="color:{"var(--red)" if trend_pct>0 else "var(--green)"}">{trend_pct:+.1f}%</b>，处于<b>{trend_word}期</b>。</p>\n'

    diag_html += '<h3>2. 毛利率分析</h3>\n'
    diag_html += f'<p>当期毛利率 <b>{gp_margin:.1f}%</b>（上年同期 {gp_margin_prev:.1f}%），同比{gp_trend}。'
    if gp_margin > 0:
        diag_html += f'毛利额 <b>{kpi_data["gross_profit"]/10000:,.0f} 万</b>。</p>\n'

    diag_html += '<h3>3. 最新月份概览（' + str(current_year) + '-' + str(latest_month).zfill(2) + '）</h3>\n'
    diag_html += f'<p>当月收入 <b>{cm_rev/10000:,.0f} 万</b>，环比 <b style="color:{"var(--red)" if mom_total>0 else "var(--green)"}">{mom_total:+.1f}%</b>。'
    diag_html += f'成交客户 <b>{curr_m["customer"].nunique()}</b> 个，'
    diag_html += f'订单 <b>{curr_m["order_no"].nunique() if "order_no" in curr_m.columns else len(curr_m)}</b> 笔。</p>\n'

    diag_html += '<h3>4. 客户分析</h3>\n<ul>\n'
    diag_html += f'<li>Top 3 客户（{"、".join(c["name"] for c in top3_cust)}）占收入 <b>{top3_pct:.1f}%</b>，客户集中度：<b>{conc_risk}</b>。</li>\n'
    diag_html += f'<li>{current_year} 年新增客户 <b>{new_cust_count}</b> 个（较上年新增），近 6 个月无交易流失客户 <b>{lost_cust_count}</b> 个，详见客户页签。</li>\n'
    if churn_risk:
        diag_html += f'<li>⚠️ 近 3 个月无交易的沉睡客户（预警）<b>{len(churn_risk)}</b> 个，详见客户页签。</li>\n'
    else:
        diag_html += '<li>无沉睡客户风险（近 3 个月均有交易）。</li>\n'
    diag_html += '</ul>\n'

    diag_html += '<h3>5. 产品结构</h3>\n<ul>\n'
    for p in products[:5]:
        p_pct = p['amt'] / total_rev * 100 if total_rev > 0 else 0
        diag_html += f'<li><b>{p["name"]}</b>：{p["amt"]/10000:,.0f} 万（{p_pct:.1f}%）。</li>\n'
    diag_html += '</ul>\n'

    if region_data:
        diag_html += '<h3>6. 区域分布</h3>\n<ul>\n'
        for r in region_data[:5]:
            diag_html += f'<li><b>{r["name"]}</b>：{r["amt"]:,.0f} 万（{r["pct"]:.1f}%），{r["customers"]} 客户。</li>\n'
        diag_html += '</ul>\n'

    diag_html += '<h3>7. 建议</h3>\n<ul>\n'
    if top3_pct > 50:
        diag_html += '<li><b>预警</b>：客户集中度过高，建议开拓新客户分散风险。</li>\n'
    if gp_margin < gp_margin_prev - 3:
        diag_html += '<li><b>关注</b>：毛利率持续下降，需分析是价格因素还是成本上升。</li>\n'
    if churn_risk:
        diag_html += f'<li><b>激活</b>：{len(churn_risk)} 个客户进入沉睡期（3 月无交易），建议制定回访计划；{lost_cust_count} 个客户已流失（6 月无交易），需评估挽回价值。</li>\n'
    if trend_pct < 0:
        diag_html += '<li><b>扭转</b>：收入同比下滑，建议加强销售力度或调整产品策略。</li>\n'
    if trend_pct > 20:
        diag_html += '<li><b>巩固</b>：收入高速增长，关注交付能力和客户服务质量。</li>\n'
    diag_html += '</ul>\n'
    diag_html += '<h3>8. 分析口径说明</h3>\n<ul style="font-size:12px;">\n'
    diag_html += '<li><b>新增客户</b>：较上年新增，即当年有交易记录、上一年度无交易记录的客户。</li>\n'
    diag_html += '<li><b>流失客户</b>：连续 6 个月无交易记录（实质性流失），区别于沉睡客户。</li>\n'
    diag_html += '<li><b>沉睡客户</b>：连续 3 个月无交易记录（早期预警），建议及时回访激活。</li>\n'
    diag_html += '<li><b>同比</b>：当年 1 月至最新月份累计，与上一年同期对比。</li>\n'
    diag_html += '<li><b>环比</b>：最新月份与上一月份对比。</li>\n'
    diag_html += '</ul>\n'
    diag_html += '<p style="color:var(--muted);font-size:10px;margin-top:12px">以上分析基于销售明细数据，仅供参考。具体经营决策请结合市场环境和内部管理综合判断。</p>\n'

    # ---- Detail rows ----
    detail_rows = []
    for _, r in df.iterrows():
        detail_rows.append({
            'y': int(r['year']), 'm': int(r['month']), 'ym': str(r['ym']),
            'customer': str(r['customer']), 'product': str(r['product']),
            'cat': str(r.get('category', '')),
            'region': str(r.get('region', '')),
            'channel': str(r.get('channel', '')),
            'dept': str(r.get('department', '')),
            'brand': str(r.get('brand', '')),
            'sp': str(r.get('salesperson', '')),
            'qty': float(r.get('quantity', 0)),
            'price': float(r.get('unit_price', 0)),
            'amt': round(float(r['amount']), 2),
            'cost': round(float(r.get('cost', 0)), 2),
            'gp': round(float(r.get('gross_profit', 0)), 2),
            'order': str(r.get('order_no', '')),
            'remark': str(r.get('remark', ''))[:100],
        })

    # ---- Assemble DATA ----
    DATA = {
        'report_type': 'sales',
        'years': all_years, 'cy': current_year, 'lm': latest_month, 'yms': all_yms,
        'kpi': kpi_data,
        'kpiByYear': kpi_by_year,
        'yrRevenue': yr_revenue,
        'moRevenue': mo_revenue,
        'moGrossProfit': mo_gross_profit,
        'customers': customers,
        'products': products,
        'categories': categories,
        'regions': regions,
        'custRevenue': cust_revenue,
        'prodRevenue': prod_revenue,
        'custProdHM': cust_prod_hm,
        'custProdHMByYear': cust_prod_hm_by_year,
        'custMonthly': cust_monthly,
        'custCost': cust_cost,
        'custGP': cust_gp,
        'custGPMargin': cust_gp_margin,
        'custYoY': cust_yoy,
        'prodMonthly': prod_monthly,
        'prodGPMargin': prod_gp_margin,
        'prodYoY': prod_yoy,
        'catRevenue': cat_revenue,
        'catMonthly': cat_monthly,
        'catGPMargin': cat_gp_margin,
        'salespersons': salespersons,
        'spRevenue': sp_revenue,
        'spCustomers': sp_customers,
        'spGPMargin': sp_gp_margin,
        'departments': departments,
        'deptRevenue': dept_revenue,
        'deptMonthly': dept_monthly,
        'deptGPMargin': dept_gp_margin,
        'deptCustRevenue': dept_cust_revenue,
        'brands': brands,
        'brandRevenue': brand_revenue,
        'brandMonthly': brand_monthly,
        'brandGPMargin': brand_gp_margin,
        'sunburstByYear': sunburst_by_year,
        'sunburstProdByYear': sunburst_prod_by_year,
        'sunburst': sunburst_by_year.get(current_year, []),
        'regionData': region_data,
        'channelData': channel_data,
        'momAnom': mom_anomalies[:30],
        'churnRisk': churn_risk,
        'newCustomers': new_cust_details,
        'lostCustomers': lost_cust_details,
        'custPareto': cust_pareto,
        'custMigration': cust_migration,
        'custStatus': cust_status,
        'custRecentOrders': cust_recent_orders,
        'custConcentration': cust_concentration,
        'cagr': round(cagr, 1),
        'iqr': iqr_outliers[:10],
        'topCustomers': [{'n': c['name'], 'a': round(c['amt'] / 10000, 1)} for c in customers[:10]],
        'topProducts': [{'n': p['name'], 'a': round(p['amt'] / 10000, 1)} for p in products[:10]],
        'diagHTML': diag_html,
    }

    data_size = len(json.dumps(DATA, ensure_ascii=False, cls=NpEncoder))
    print(f"  Sales Data JSON: ~{data_size/1024:.0f}KB, Detail: {len(detail_rows)} rows")
    print("  Sales processing done.")

    return DATA, detail_rows
