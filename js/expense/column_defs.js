/**
 * Expense analysis field definitions (browser version).
 * Each field has keywords for auto-matching, required flag, and optional
 * 'relaxes' targets (fields that become optional when this field is matched).
 */
const EXPENSE_COLUMN_DEFS = {
  year:      { keywords: ['年','年度','会计年度','year'], required: true, label: '年份', hint: '例：2024、2025' },
  month:     { keywords: ['月','月份','会计期间','期间','month','period'], required: true, label: '月份', hint: '例：1、12' },
  date:      { keywords: ['日期','记账日期','date','时间','年月日','发生日期','交易日期'], required: false, label: '日期', hint: '含年月日的完整日期列，自动拆分——有此列时年份/月份可留空', relaxes: ['year','month'] },
  subject:   { keywords: ['科目','费用科目','会计科目','科目名称','费用类别','subject'], required: true, label: '科目', hint: '例：管理费用、制造费用', relaxes: ['cat'] },
  dept:      { keywords: ['部门','责任部门','成本中心','dept','department'], required: true, label: '部门', hint: '例：财务部、生产车间' },
  cat:       { keywords: ['核算项目','费用项目','项目名称','项目','category'], required: true, label: '核算项目', hint: '例：办公费、差旅费', relaxes: ['subject'] },
  summary:   { keywords: ['摘要','事由','description','备注说明','说明'], required: true, label: '摘要', hint: '交易/凭证的文字描述' },
  amount:    { keywords: ['金额','借方','借方金额','发生额','debit','amount','费用金额','原币金额'], required: true, label: '金额', hint: '数值列，单位：元' },
  voucher:   { keywords: ['凭证','凭证号','单据号','voucher','编号'], required: false, label: '凭证号', hint: '用于去重' },
  remark:    { keywords: ['备注','remark','附注'], required: false, label: '备注', hint: '补充说明' },
};
// Backward compat alias for detectColumns() in column_detector.js
const COLUMN_DEFS = EXPENSE_COLUMN_DEFS;
