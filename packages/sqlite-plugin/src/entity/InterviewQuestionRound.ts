import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } = typeorm;
import { InterviewJobPosition } from './InterviewJobPosition';

/**
 * 面试问题轮次实体
 *
 * 用于配置每轮面试的问题内容
 */
@Entity()
export class InterviewQuestionRound {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  jobPositionId: number;             // 关联岗位ID

  @Column()
  roundNumber: number;               // 轮次序号（1,2,3...）

  @Column({ type: 'text' })
  questionText: string;              // 问题内容

  // 新增：关键词配置（JSON数组，带权重）
  @Column({ nullable: true, type: 'text' })
  keywords: string;                  // 格式: [{"keyword": "redis", "weight": 10}, ...]

  // 新增：LLM评分提示词（用户自定义）
  @Column({ nullable: true, type: 'text' })
  llmPrompt: string;                 // 自定义评分提示词，支持 {question} 和 {answer} 占位符

  // 新增：否定词配置（JSON数组）
  // 当这些词出现在关键词前面近距离内时，视为否定该关键词，评分不通过
  @Column({ nullable: true, type: 'text' })
  negationWords: string;             // 格式: ["没有", "没", "无", "不曾", "未曾"]

  @CreateDateColumn()
  createdAt: Date;

  // 关联岗位
  @ManyToOne(() => InterviewJobPosition)
  @JoinColumn({ name: 'jobPositionId' })
  jobPosition: InterviewJobPosition;
}