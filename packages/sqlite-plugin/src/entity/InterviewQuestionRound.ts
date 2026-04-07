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

  @CreateDateColumn()
  createdAt: Date;

  // 关联岗位
  @ManyToOne(() => InterviewJobPosition)
  @JoinColumn({ name: 'jobPositionId' })
  jobPosition: InterviewJobPosition;
}