import * as typeorm from 'typeorm';
const { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } = typeorm;

/**
 * 面试系统配置实体
 *
 * 用于存储 SMTP、风控等系统配置
 */
@Entity()
@Index(['configKey'], { unique: true })
export class InterviewSystemConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  configKey: string;                 // 配置键名

  @Column({ nullable: true, type: 'text' })
  configValue: string;               // 配置值（JSON格式存储）

  @Column({ default: false })
  isEncrypted: boolean;              // 是否加密存储

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// 预置配置键：
// smtp_host: SMTP服务器地址
// smtp_port: SMTP端口
// smtp_user: SMTP用户名
// smtp_password: SMTP密码（加密存储）
// email_recipient: 默认收件邮箱
// daily_limit: 每日处理上限
// scan_interval: 扫描间隔（秒）