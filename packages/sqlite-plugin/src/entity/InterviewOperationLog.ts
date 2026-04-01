import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } = typeorm;
import { InterviewCandidate } from './InterviewCandidate';

/**
 * 面试操作日志实体
 *
 * 用于记录面试流程中的操作和错误
 */
@Entity()
@Index(['candidateId'])
@Index(['action'])
@Index(['createdAt'])
export class InterviewOperationLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  candidateId: number;               // 关联候选人ID（可选）

  @Column()
  action: string;                    // 操作类型

  @Column({ nullable: true, type: 'text' })
  detail: string;                    // 详细信息（JSON格式）

  @Column({ nullable: true, type: 'text' })
  errorMessage: string;              // 错误信息（如果有）

  @CreateDateColumn()
  createdAt: Date;

  // 关联候选人
  @ManyToOne(() => InterviewCandidate)
  @JoinColumn({ name: 'candidateId' })
  candidate: InterviewCandidate;
}