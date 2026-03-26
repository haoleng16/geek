import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } = typeorm;

/**
 * 招聘者模版实体
 *
 * 用于存储招聘者的回复模版，支持全局模版和职位级别模版
 * - encryptJobId 为 NULL 表示全局模版
 * - templateType 包括：initial(首次回复)、resume_received(收到简历)、reject(婉拒)、custom(自定义)
 */
@Entity()
export class RecruiterTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  encryptJobId: string | null;  // NULL表示全局模版

  @Column()
  templateType: string;  // initial/resume_received/reject/custom

  @Column()
  name: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}