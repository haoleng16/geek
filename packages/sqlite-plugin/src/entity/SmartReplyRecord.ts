import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } = typeorm;

/**
 * 智能回复记录实体
 *
 * 用于存储智能回复功能的候选人信息和回复记录
 */
@Entity()
@Index(['sessionId', 'encryptGeekId'], { unique: true })
export class SmartReplyRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  sessionId: string;              // 会话ID（启动任务时生成的UUID）

  @Column()
  encryptGeekId: string;          // 候选人ID

  @Column({ nullable: true })
  geekName: string;               // 候选人姓名

  @Column({ nullable: true })
  encryptJobId: string;           // 职位ID

  @Column({ nullable: true })
  jobName: string;                // 职位名称

  @Column({ nullable: true })
  degree: string;                 // 学历

  @Column({ nullable: true, type: 'integer' })
  workYears: number;              // 工作年限

  @Column({ default: 0 })
  replyCount: number;             // 智能体回复次数

  @Column({ nullable: true, type: 'text' })
  lastLlmReply: string;           // 最后一次大模型回复内容

  @Column({ nullable: true, type: 'text' })
  conversationHistory: string;    // 对话历史JSON

  @Column({ nullable: true })
  firstReplyAt: Date;             // 首次回复时间

  @Column({ nullable: true })
  lastReplyAt: Date;              // 最后回复时间

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}