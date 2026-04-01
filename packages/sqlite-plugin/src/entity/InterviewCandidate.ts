import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } = typeorm;
import { InterviewJobPosition } from './InterviewJobPosition';

/**
 * 候选人状态枚举
 */
export enum InterviewCandidateStatus {
  NEW = 'new',                           // 新候选人
  WAITING_ROUND_1 = 'waiting_round_1',   // 等待第1轮回复
  WAITING_ROUND_2 = 'waiting_round_2',   // 等待第2轮回复
  WAITING_ROUND_N = 'waiting_round_n',   // 等待第N轮回复
  PASSED = 'passed',                     // 全部通过
  REJECTED = 'rejected',                 // 已拒绝
  RESUME_REQUESTED = 'resume_requested', // 已发送简历邀请
  RESUME_RECEIVED = 'resume_received',   // 已收到简历
  EMAILED = 'emailed',                   // 已发送邮件
  ERROR = 'error'                        // 处理出错
}

/**
 * 面试候选人实体
 *
 * 用于追踪候选人的面试流程和状态
 */
@Entity()
@Index(['encryptGeekId', 'encryptJobId'], { unique: true })
export class InterviewCandidate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  encryptGeekId: string;             // BOSS直聘候选人ID

  @Column({ nullable: true })
  geekName: string;                  // 候选人姓名

  @Column({ nullable: true })
  encryptJobId: string;              // BOSS直聘职位ID

  @Column({ nullable: true })
  jobName: string;                   // 岗位名称（冗余存储）

  @Column({ nullable: true })
  jobPositionId: number;             // 关联岗位配置ID

  @Column({ default: InterviewCandidateStatus.NEW })
  status: string;                    // 状态

  @Column({ default: 0 })
  currentRound: number;              // 当前轮次

  @Column({ nullable: true, type: 'decimal', precision: 5, scale: 2 })
  totalScore: number;                // 总得分

  @Column({ nullable: true, type: 'decimal', precision: 5, scale: 2 })
  keywordScore: number;              // 关键词得分

  @Column({ nullable: true, type: 'decimal', precision: 5, scale: 2 })
  llmScore: number;                  // LLM得分

  @Column({ nullable: true, type: 'text' })
  llmReason: string;                 // LLM评分理由

  @Column({ nullable: true, type: 'datetime' })
  firstContactAt: Date;              // 首次接触时间

  @Column({ nullable: true, type: 'datetime' })
  lastReplyAt: Date;                 // 最后回复时间

  @Column({ nullable: true, type: 'datetime' })
  lastQuestionAt: Date;              // 最后发送问题时间

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // 关联岗位配置
  @ManyToOne(() => InterviewJobPosition)
  @JoinColumn({ name: 'jobPositionId' })
  jobPosition: InterviewJobPosition;
}