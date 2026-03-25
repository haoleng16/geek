import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } = typeorm;

/**
 * 候选人对话记录实体
 *
 * 用于追踪与每个候选人的对话状态和轮次
 */
@Entity()
export class CandidateConversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  encryptGeekId: string;       // 求职者ID

  @Column()
  encryptJobId: string;        // 职位ID

  @Column({ default: 0 })
  roundCount: number;          // 当前对话轮次

  @Column({ default: 'pending' })
  status: string;              // 'pending' | 'matched' | 'rejected' | 'handover'

  @Column({ nullable: true, type: 'datetime' })
  firstContactAt: Date;

  @Column({ nullable: true, type: 'datetime' })
  lastReplyAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}