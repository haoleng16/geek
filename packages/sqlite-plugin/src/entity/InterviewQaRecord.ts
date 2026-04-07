import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } = typeorm;
import { InterviewCandidate } from './InterviewCandidate';

/**
 * 面试问答记录实体
 *
 * 用于记录每轮问答的内容和评分
 */
@Entity()
@Index(['candidateId', 'roundNumber'], { unique: true })
export class InterviewQaRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  candidateId: number;               // 关联候选人ID

  @Column()
  roundNumber: number;               // 轮次

  @Column({ type: 'text' })
  questionText: string;              // 发送的问题

  @Column({ nullable: true, type: 'text' })
  answerText: string;                // 候选人回复

  @Column({ nullable: true, type: 'datetime' })
  questionSentAt: Date;              // 问题发送时间

  @Column({ nullable: true, type: 'datetime' })
  answeredAt: Date;                  // 回复时间

  @Column({ nullable: true, type: 'decimal', precision: 5, scale: 2 })
  llmScore: number;                  // LLM得分

  @Column({ nullable: true, type: 'text' })
  llmReason: string;                 // LLM评分理由

  // 总得分（纯LLM评分后等于llmScore）
  @Column({ nullable: true, type: 'decimal', precision: 5, scale: 2 })
  totalScore: number;                // 总得分

  // 评分时间
  @Column({ nullable: true, type: 'datetime' })
  scoredAt: Date;                    // 评分完成时间

  @CreateDateColumn()
  createdAt: Date;

  // 关联候选人
  @ManyToOne(() => InterviewCandidate)
  @JoinColumn({ name: 'candidateId' })
  candidate: InterviewCandidate;
}