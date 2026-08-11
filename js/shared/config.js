/**
 * AI_FACTORY 企业运营分析平台 — 配置
 */

// ---- 后端 API 地址 ----
const API_BASE = window.location.origin;

// ---- 应用配置 ----
const APP_CONFIG = {
    appName: '企业运营分析平台',
    appVersion: '8.1.0',

    // 文件大小限制
    maxFileSizeMB: 50,          // 商用版浏览器上限（测试完后改回此值）
    largeFileThresholdMB: 10,   // 【开发期】>10MB走服务端加速验证，商用前恢复50MB
    maxTotalSizeMB: 100,        // 多文件合计上限
    supportedFormats: ['.xlsx', '.xls'],

    // 大文件服务端处理（仅内部使用，商用版关闭）
    // true  = 内部版：>50MB 自动上传服务器处理
    // false = 商用版：>50MB 提示拆分，不上传服务器
    enableLargeFileServer: true,
};
