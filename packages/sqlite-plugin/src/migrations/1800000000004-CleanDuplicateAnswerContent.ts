import { MigrationInterface, QueryRunner } from "typeorm"

/**
 * 清理问答记录中重复的回答内容
 *
 * 解决两种类型的重复：
 * 1. 同一候选人同一轮次的重复记录（保留最新的那条，已有唯一约束处理）
 * 2. 回答文本内部的重复句子（清理句子级别的重复）
 */
export class CleanDuplicateAnswerContent1800000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('[Migration] CleanDuplicateAnswerContent started');

    // 1. 首先确保 candidateId + roundNumber 的唯一性（如果之前的迁移未执行）
    // 删除重复记录，保留 id 最大（最新）的记录
    await queryRunner.query(`
      DELETE FROM "interview_qa_record"
      WHERE "id" NOT IN (
        SELECT MAX("id")
        FROM "interview_qa_record"
        GROUP BY "candidateId", "roundNumber"
      );
    `);
    console.log('[Migration] Structural duplicates cleaned (candidateId + roundNumber)');

    // 2. 清理回答文本内部的重复句子
    // 获取所有有回答文本的记录
    const records = await queryRunner.query(`
      SELECT "id", "answerText" FROM "interview_qa_record" WHERE "answerText" IS NOT NULL AND "answerText" != '';
    `);

    console.log(`[Migration] Found ${records.length} records with answer text to process`);

    let cleanedCount = 0;
    for (const record of records) {
      const originalText = record.answerText;
      if (!originalText || originalText.trim().length === 0) continue;

      // 应用句子去重逻辑
      const cleanedText = this.deduplicateSentences(originalText);

      // 只有当文本确实被修改时才更新
      if (cleanedText !== originalText) {
        await queryRunner.query(`
          UPDATE "interview_qa_record" SET "answerText" = ? WHERE "id" = ?;
        `, [cleanedText, record.id]);
        cleanedCount++;
        console.log(`[Migration] Cleaned record ${record.id}: ${originalText.length} chars -> ${cleanedText.length} chars`);
      }
    }

    console.log(`[Migration] Sentence-level deduplication completed: ${cleanedCount} records cleaned`);

    // 3. 删除回答文本为空的无效记录（可选，根据业务需求）
    // 注意：这里不删除，因为可能有些记录只有问题没有回答，是正常状态

    console.log('[Migration] CleanDuplicateAnswerContent completed successfully');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚：无法恢复原始的重复句子，因为数据已被修改
    // 只记录日志，不执行实际操作
    console.log('[Migration] CleanDuplicateAnswerContent rollback: Cannot restore original duplicate sentences');
    console.log('[Migration] Note: Deduplicated text cannot be reversed');
  }

  /**
   * 对回答文本内部的重复句子进行去重
   * 将文本按句子分割，去除完全相同的重复句子
   */
  private deduplicateSentences(text: string): string {
    if (!text || !text.trim()) return text;

    // 按换行分割（每行可能包含一个或多个句子）
    const lines = text.split(/\n+/).filter(line => line.trim());

    // 对每行进行句子分割
    // 中文句子通常以 。！？；结尾，英文以 . ! ? ; 结尾
    const sentenceEndPattern = /([。！？；.!?;]+)/g;

    const allSentences: string[] = [];
    for (const line of lines) {
      // 分割句子，保留分隔符
      const parts = line.split(sentenceEndPattern);
      let currentSentence = '';
      for (let i = 0; i < parts.length; i++) {
        currentSentence += parts[i];
        // 如果当前部分是分隔符，或者到达末尾，则形成一个完整句子
        if (sentenceEndPattern.test(parts[i]) || i === parts.length - 1) {
          if (currentSentence.trim()) {
            allSentences.push(currentSentence.trim());
          }
          currentSentence = '';
        }
      }
    }

    // 去重：使用 Set 去除完全相同的句子
    const seen = new Set<string>();
    const uniqueSentences: string[] = [];

    for (const sentence of allSentences) {
      // 标准化比较：去除多余空格
      const normalized = sentence.replace(/\s+/g, ' ').trim();
      if (!seen.has(normalized) && normalized) {
        seen.add(normalized);
        uniqueSentences.push(sentence);
      }
    }

    // 如果没有重复，返回原始文本
    if (allSentences.length === uniqueSentences.length) {
      return text;
    }

    // 合并去重后的句子
    return uniqueSentences.join('\n');
  }
}