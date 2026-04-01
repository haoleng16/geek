import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } = typeorm;
import { InterviewJobPosition } from './InterviewJobPosition';

/**
 * 面试评分规则实体
 *
 * 用于配置每轮问题的评分关键词
 */
@Entity()
export class InterviewScoreRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  jobPositionId: number;             // 关联岗位ID

  @Column()
  roundNumber: number;               // 关联轮次

  @Column({ type: 'text' })
  keywords: string;                  // 关键词（JSON数组格式）

  @Column({ default: 50 })
  keywordScore: number;              // 关键词满分权重

  @Column({ default: 50 })
  llmScore: number;                  // LLM满分权重

  @CreateDateColumn()
  createdAt: Date;

  // 关联岗位
  @ManyToOne(() => InterviewJobPosition)
  @JoinColumn({ name: 'jobPositionId' })
  jobPosition: InterviewJobPosition;
}