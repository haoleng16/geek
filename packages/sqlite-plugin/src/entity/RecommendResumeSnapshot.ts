import * as typeorm from "typeorm";
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } =
  typeorm;

/**
 * 推荐牛人简历截图记录实体
 *
 * 用于存储候选人简历截图文件信息和 VL 模型原始响应
 */
@Entity()
@Index(["encryptUserId"])
export class RecommendResumeSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  candidateId: number; // 关联候选人记录ID

  @Column()
  encryptUserId: string; // 候选人ID

  @Column({ type: "text" })
  snapshotPath: string; // 截图文件本地路径

  @Column({ nullable: true, type: "integer" })
  snapshotSize: number; // 截图文件大小（字节）

  @Column({ nullable: true, type: "text" })
  vlRawResponse: string; // VL模型原始返回内容

  @Column({ nullable: true, type: "text" })
  domText: string; // 从DOM抽取的简历全文文本

  @Column({ nullable: true, type: "text" })
  domSectionsJson: string; // 从DOM抽取的分段结构化内容

  @Column({ nullable: true, type: "integer" })
  vlRequestTokens: number; // 请求token数

  @Column({ nullable: true, type: "integer" })
  vlResponseTokens: number; // 响应token数

  @Column({ nullable: true, type: "integer" })
  vlDurationMs: number; // VL调用耗时（毫秒）

  @CreateDateColumn()
  createdAt: Date;
}
