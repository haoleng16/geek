# 牛人快跑 - GeekGeekRun (招聘端增强版)

> 本项目是基于 [GeekGeekRun 牛人快跑](https://github.com/geekgeekrun/geekgeekrun) 基础上修改的招聘端服务版本。

## 招聘端新增功能

### 1. 招聘端模版自动回复

专为招聘者设计的自动回复功能，帮助 HR 和招聘人员高效管理候选人沟通。

**核心功能：**
- 自动监控聊天列表中的新消息
- 根据筛选条件智能筛选候选人（学历、工作年限、关键词等）
- 支持配置多条快捷回复模版（首次回复、收到简历、婉拒回复等）
- 支持全局模版和职位专属模版
- 不匹配的候选人可自动发送婉拒消息
- 已回复联系人数据统计和记录

**模版类型：**
| 模版类型 | 说明 |
|---------|------|
| 首次回复 | 候选人首次发消息时的自动回复 |
| 收到简历 | 候选人发送简历后的确认回复 |
| 婉拒回复 | 不符合条件的候选人婉拒消息 |
| 自定义模版 | 最多支持10个自定义模版 |

### 2. 大模型智能回复

通过大语言模型（LLM）自动分析候选人消息并生成精准回复，让招聘沟通更智能。

**核心功能：**
- 根据公司简介、岗位说明智能生成回复内容
- 每个候选人每会话最多回复次数可配置（默认3次）
- 支持自动发送和弹窗确认两种模式
- 敏感词检测，自动过滤不合适内容
- API 连接测试功能，确保配置正确

**配置项：**
| 配置项 | 说明 |
|-------|------|
| 公司简介 | 用于 LLM 生成更精准的回复 |
| 岗位说明 | 职位职责和要求描述 |
| 系统提示词 | 自定义 LLM 提示词模板 |
| 最大回复次数 | 每个候选人的最大回复次数限制 |

**安全特性：**
- 消息过短自动跳过（默认5字符以下）
- 敏感词过滤（政治、脏话、违法违规词汇）
- API Key 连接测试按钮
- 风险提示和使用建议

### 3. 数据管理

- **已回复联系人列表**：记录所有已回复的候选人信息
- **智能回复数据**：记录 LLM 回复历史，支持按会话筛选

---

## 原有功能

本项目保留了 GeekGeekRun 牛人快跑的所有原有功能：

### 自动开聊
扩列神器！按照你所设置的求职偏好，自动开聊推荐职位列表中的匹配的BOSS。

### 已读不回自动复聊
BOSS不明原因已读不回？已读不回自动复聊，有事没事提醒一下已读不回的 Ta，助力沟通双向奔赴。

### BOSS 登录助手
帮你用十分简单的方式，登录到 BOSS 直聘。

### 大语言模型设置
支持配置多个大模型，让求职更智能。

---

## 系统要求

- **Windows**：Windows 10 1507 及以上（x86_64）
- **Linux**：Ubuntu 20.04 及以上（x86_64，需桌面环境）
- **macOS**：Sonoma 14.0 及以上（Apple Silicon、x86_64）

## 安装方式

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/haoleng16/geek.git
cd geek

# 安装依赖
pnpm install

# 开发模式运行
pnpm dev

# 构建生产版本
pnpm build
```

### 下载发行版

请前往 [Releases](https://github.com/haoleng16/geek/releases) 页面下载对应平台的安装包。

---

## 使用必读及免责声明

如下是使用必读及免责声明，请您务必逐条阅读：

- 本程序属于辅助工具，与《BOSS直聘用户协议》相关条款相违背。如果非正常用户行为被风控监测到，您可能面临账号被强制退出登录、限制使用、封禁等风险。使用本程序即意味着**您愿意接受以上风险**。
- 本程序需要存储您的登录凭据（Cookie），仅存储在本地，**不会泄露给第三方**。
- 建议您使用本程序时**注意节制**，建议当天开聊次数用尽后隔几天再使用。
- 本程序**不对您的求职/招聘过程与结果负责**。

---

## 技术栈

- **前端**：Vue 3 + Element Plus + Vite
- **后端**：Electron + Node.js
- **数据库**：SQLite (TypeORM)
- **自动化**：Puppeteer
- **AI**：OpenAI API 兼容的大模型接口

---

## 致谢

本项目基于以下开源项目开发：
- [GeekGeekRun 牛人快跑](https://github.com/geekgeekrun/geekgeekrun) - 原始项目

感谢原作者的辛勤付出！

---

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=haoleng16/geek&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=haoleng16/geek&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=haoleng16/geek&type=Date" />
</picture>

感谢支持！