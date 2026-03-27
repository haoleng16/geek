// 预设敏感词列表（政治/脏话）
const SENSITIVE_WORDS = [
  // 政治敏感词
  '习近平', '共产党', '反共', '六四', '天安门', '法轮功',
  // 脏话
  '傻逼', '操你', '妈的', '他妈', '草泥马', '王八蛋',
  // 违法违规
  '赌博', '六合彩', '代开发票', '办证', '刷单'
]

/**
 * 检查文本是否包含敏感词
 */
export function containsSensitiveWord(text: string): boolean {
  const lowerText = text.toLowerCase()
  return SENSITIVE_WORDS.some(word =>
    lowerText.includes(word.toLowerCase())
  )
}

/**
 * 检查消息是否过短
 */
export function isMessageTooShort(text: string, minLength = 5): boolean {
  return text.trim().length < minLength
}