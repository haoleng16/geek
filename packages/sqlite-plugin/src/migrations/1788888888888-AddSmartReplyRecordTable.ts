import { MigrationInterface, QueryRunner } from "typeorm"

export class AddSmartReplyRecordTable1788888888888 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "smart_reply_record" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "sessionId" varchar NOT NULL,
        "encryptGeekId" varchar NOT NULL,
        "geekName" varchar,
        "encryptJobId" varchar,
        "jobName" varchar,
        "degree" varchar,
        "workYears" integer,
        "replyCount" integer DEFAULT 0,
        "lastLlmReply" text,
        "conversationHistory" text,
        "firstReplyAt" datetime,
        "lastReplyAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `);

    // 创建索引：按候选人和日期查询（用于按天统计回复次数）
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_reply_record_geek_date"
      ON "smart_reply_record" ("encryptGeekId", date(createdAt));
    `);

    // 创建索引：按候选人查询最后回复时间（用于统计当天回复次数）
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_reply_record_geek_lastreply"
      ON "smart_reply_record" ("encryptGeekId", date(lastReplyAt));
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_reply_record_session"
      ON "smart_reply_record" ("sessionId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "smart_reply_record";`);
  }
}