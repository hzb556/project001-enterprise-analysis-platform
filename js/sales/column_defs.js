/**
 * Sales analysis field definitions (browser version).
 */
const SALES_COLUMN_DEFS = {
  year:      { keywords: ['年','年度','year'], required: true, label: '年份', hint: '例：2024、2025' },
  month:     { keywords: ['月','月份','month','period'], required: true, label: '月份', hint: '例：1、12' },
  date:      { keywords: ['日期','date','时间','年月日','交易日期','开票日期'], required: false, label: '日期', hint: '含年月日的完整日期，有日期列时年份/月份可为空', relaxes: ['year','month'] },
  customer:  { keywords: ['客户','客户名称','购货单位','customer','买方','对方单位'], required: true, label: '客户', hint: '例：XX科技有限公司' },
  product:   { keywords: ['产品','产品名称','商品','商品名称','品名','product','物料','物料名称'], required: true, label: '产品', hint: '例：A型电子元件' },
  category:  { keywords: ['产品类别','产品分类','category','品类','大类'], required: false, label: '产品类别', hint: '例：电子元件' },
  region:    { keywords: ['区域','地区','销售区域','region','大区','省份','城市'], required: false, label: '区域', hint: '例：华东、华南' },
  channel:   { keywords: ['渠道','销售渠道','channel','经销','直销','电商'], required: false, label: '渠道', hint: '例：直销、经销商' },
  department: { keywords: ['部门','事业部','中心','department','dept'], required: false, label: '部门', hint: '例：营销中心、品牌中心' },
  brand:     { keywords: ['品牌','brand','商标'], required: false, label: '品牌', hint: '例：OEM、天沏、十八藏' },
  salesperson: { keywords: ['销售员','销售人员','业务员','salesperson','sales','经手人'], required: false, label: '销售人员', hint: '例：张三' },
  quantity:  { keywords: ['数量','销售数量','quantity','qty','件数'], required: false, label: '数量', hint: '数值列' },
  unit_price: { keywords: ['单价','unit_price','price','售价','销售单价'], required: false, label: '单价', hint: '单位价格' },
  amount:    { keywords: ['金额','销售金额','销售额','收入','amount','revenue','总价','价税合计','含税金额','不含税金额','未结算金额','已结算金额'], required: true, label: '金额', hint: '数值列，单位：元' },
  cost:      { keywords: ['成本','销售成本','cost','进货价','采购成本','单位成本'], required: false, label: '成本', hint: '用于计算毛利' },
  order_no:  { keywords: ['订单号','订单编号','order','销售单号','合同号','发票号'], required: false, label: '订单号', hint: '用于去重' },
  remark:    { keywords: ['备注','remark','附注','说明'], required: false, label: '备注', hint: '补充说明' },
};

// COLUMN_DEFS stays as expense defs loaded earlier; use SALES_COLUMN_DEFS explicitly
