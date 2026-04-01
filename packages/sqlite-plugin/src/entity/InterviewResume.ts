import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } = typeorm;
import { InterviewCandidate } from './InterviewCandidate';

/**
 * 面试简历实体
 *
 * 用于记录候选人简历的下载和邮件发送状态
 */
@Entity()
@Index(['candidateId'])
export class InterviewResume {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  candidateId: number;               // 关联候选人ID

  @Column({ type: 'text' })
  filePath: string;                  // 本地存储路径

  @Column({ nullable: true })
  fileName: string;                  // 原始文件名

  @Column({ nullable: true, type: 'integer' })
  fileSize: number;                  // 文件大小（字节）

  @Column({ nullable: true, type: 'datetime' })
  downloadedAt: Date;                // 下载时间

  @Column({ nullable: true, type: 'datetime' })
  emailedAt: Date;                   // 邮件发送时间

  @Column({ nullable: true })
  emailRecipient: string;            // 收件人邮箱

  @Column({ nullable: true, type: 'text' })
  downloadUrl: string;               // 简历下载URL

  @CreateDateColumn()
  createdAt: Date;

  // 关联候选人
  @ManyToOne(() => InterviewCandidate)
  @JoinColumn({ name: 'candidateId' })
  candidate: InterviewCandidate;
}