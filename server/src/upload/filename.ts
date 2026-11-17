/**
 * 浏览器按 UTF-8 发送 multipart 文件名，而 busboy/multer 默认按 latin1 解码，
 * 中文名会变成「2026骞?̈å†Œ…」这类乱码。
 *
 * 这里做一次可逆性判断，只在「整串能无损还原成合法 UTF-8」且「还原后含中文」时采用：
 * - 纯 ASCII 文件名原样返回，不受影响；
 * - 已经是中文的文件名不再二次转换；
 * - 还原后出现替换符（U+FFFD）说明不是 latin1 乱码，保留原文。
 */
export function normalizeFileName(raw: string): string {
  if (!raw) return raw;
  if (!/[\u0080-\u00ff]/.test(raw)) return raw;
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;

  const restored = Buffer.from(raw, 'latin1').toString('utf8');

  if (restored === raw || restored.includes('\uFFFD')) return raw;
  if (!/[\u4e00-\u9fff]/.test(restored)) return raw;

  return restored;
}
