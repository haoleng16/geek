import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } = typeorm;

/**
 * 招聘者处理日志实体
 *
 * 记录每次自动回复、筛选、婉拒等操作的日志
 */
@Entity()
export class RecruiterProcessLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  encryptGeekId: string;

  @Column()
  encryptJobId: string;

  @Column()
  action: string;              // 'reply' | 'reject' | 'parse_resume' | 'skip'

  @Column({ nullable: true })
  roundNumber: number;

  @Column({ type: 'text', nullable: true })
  messageContent: string;

  @Column({ type: 'text', nullable: true })
  filterResult: string;        // JSON

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;
}