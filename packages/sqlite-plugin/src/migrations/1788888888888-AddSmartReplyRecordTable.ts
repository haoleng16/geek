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
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_smart_reply_record_unique"
      ON "smart_reply_record" ("sessionId", "encryptGeekId");
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