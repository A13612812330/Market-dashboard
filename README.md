# Komo Market Dashboard

本地优先的 A 股与 ETF 行情、研究、自选和模拟交易工作台。

> 仅供个人研究与本地模拟，不构成投资建议。项目不接真实下单、不调用 Futu 交易接口。

## 功能简介

- **行情看盘**：A 股核心指数、ETF、板块资金、趋势图和海外指数摘要。
- **真实数据与历史 K 线**：Futu OpenD 优先；公开数据源和 SQLite 缓存作为降级来源。
- **条件筛选**：按涨跌幅、量比、换手率、成交额、历史指标及自选范围筛选股票和 ETF。
- **研究中心**：定时市场报告、风险雷达、单票研究、技术指标和研究记录。
- **行情自选**：自选分组、模糊搜索、行情卡片、K 线和当前页完整研究。
- **模拟操作**：多账户、可编辑策略、自动模拟、T+1、仓位限制、移动止盈、资金曲线和完整日志。
- **运行健康**：数据新鲜度、Futu 状态、SQLite/WAL 容量、维护记录和缓存预警。
- **可选通知与 AI**：本地飞书/钉钉通知；AI 用于报告整理和风险文字解读，不参与生成行情数字或直接交易。

## 快速开始

### 前置条件

- Node.js 22+
- Python 3.10+（建议，用于行情采集）
- Git 或 Codex

```powershell
git clone https://github.com/A13612812330/Market-dashboard.git
cd komo-market-dashboard
npm ci
python -m pip install -r requirements.txt
Copy-Item .env.example .env
npm start
```

打开 `http://127.0.0.1:5190`。

首次使用请在 `.env` 设置管理员账号和密码。`.env` 会在服务启动时自动读取，但已被 Git 忽略。

## 可选增强

| 能力 | 需要什么 | 未配置时 |
| --- | --- | --- |
| Futu 实时行情 | 本机启动且登录 Futu OpenD | 使用公开源或最近缓存 |
| 历史数据 | Python 依赖和公开数据源 | 仅显示已缓存的历史数据 |
| AI 研究整理 | OpenAI 兼容的 AI 配置或 Agnes 配置 | 研究规则继续可用，AI 区域显示未配置 |
| 飞书/钉钉通知 | 对应机器人或自建应用配置 | 不发送任何外部消息 |

完整的新电脑安装、数据迁移和排错说明见 [跨电脑部署](docs/跨电脑部署.md)。模块关系和边界见 [架构与边界](docs/架构与边界.md)。

## 常用命令

```powershell
npm start
npm run collect
npm run check
npm run check:frontend
python -m py_compile scripts\collect_market_data.py
```

## 不会上传的内容

`data/`、`.env`、输出文件、缓存、备份、账户、策略、模拟订单、消息配置和个人研究记录均只保留在本机。

## 使用边界

- 不自动或手动调用真实交易接口。
- 自动模拟只在 A 股交易时段且行情新鲜时运行。
- 数据不足时展示“暂无数据”或“最近缓存”，不使用模拟数字冒充正式行情。
- Futu、AI、飞书和钉钉均为可选配置，密钥不进入前端、数据库正文或 Git 仓库。
