<div align="center">

# Vibe Creator Engine

**一个探索浪漫创意、记录生活微小触动与情绪瞬间的多智能体自循环数字工坊**

![](https://img.shields.io/badge/Node.js-5FA04E?logo=node.js&logoColor=white)
![](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
![](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
![](https://img.shields.io/badge/license-MIT-blue)

</div>

---

## 引言

我们见过太多「效率至上」的工具。它们精确、快速、有用——但也冰冷。

这个项目想做一件不太一样的事：

> 用代码捕捉那些稍纵即逝的瞬间——下班路上突然亮起的路灯，深夜泡面升起的白雾，雨天窗玻璃上蜿蜒的水痕。
>
> 不是让 AI 替你「生成内容」，而是让它成为一个懂得驻足凝视的数字匠人，在像素与代码之间，为你留下一点温热的东西。

**Vibe Creator Engine** 是一场实验：当技术拥有了审美的自觉，它能否触碰人心？

---

## 核心运作机制

整个引擎由两个 AI 智能体组成，它们在一轮又一轮的自我博弈中，将一颗创意种子打磨为最终作品。

```
          你的创意种子
               │
               ▼
        ┌─────────────┐        ┌──────────────┐
        │   Creator    │───────▶│    Critic     │
        │   创造者      │        │   评估者      │
        │              │◀───────│              │
        │ 数字匠人      │ 反馈    │ 艺术总监      │
        │ 写代码与诗    │        │ 审美打分      │
        └─────────────┘        └──────────────┘
               ▲                      │
               │    score < 90        │
               └──────────────────────┘
                                     │ score ≥ 90
                                     ▼
                              output/ 作品展厅
```

### Creator — 创造者

一位兼具工程师素养与诗人气质的数字匠人。

- 将你的文字种子转化为一个完整的单页 HTML 作品
- 文案遵循「白描」原则——不说「我很想你」，只写「今天的晚霞是橘粉色的」
- 视觉追求「数字侘寂」——大量留白，低饱和度自然色系
- 时间元素必须动态获取——你看到的每一秒，都是真实的「此时此刻」

### Critic — 评估者

一位近乎苛刻的艺术总监。

- 默认起评分 70 分，只有真正打动人心的作品才能突破 90
- 一票否决：出现「在这个快节奏的时代」等 AI 味废话，直接扣 10 分
- 色彩审查：纯黑、纯白、高饱和度原色，各扣 15 分
- 动效审查：低于 0.8s 的生硬动画，扣 15 分
- 反馈必须具体——不是「不够好」，而是「背景色太亮，改用 stone-100」

### 自循环博弈

两个智能体之间的博弈，最多进行 3 轮：

1. Creator 根据种子创作
2. Critic 从视觉、文案、交互、可用性四个维度打分
3. 若未达标，Critic 的反馈自动回传，Creator 带着修改意见重新创作
4. 保底机制：若 3 轮均未通过，输出得分最高的那一版，绝不会交白卷

---

## 特性

**实时进度流** — 基于 SSE (Server-Sent Events) 的实时事件推送。生成过程中，前端能实时看到「沉思中...」「静观中...」「第 2/3 轮」等进度状态，体验丝滑的极客打字机观感。

**用户系统** — 注册/登录，密码可选。不同用户的创作作品完全隔离，互不可见。

**作品展厅** — 自动刷新的卡片式画廊，支持筛选「已通过」与「草稿」，点击即可预览、复制、下载。

**安全设计** — API Key 仅存于服务端，前端零泄露。服务端绑定本地回环地址，CORS 白名单、速率限制、路径穿越防护、iframe 沙箱隔离。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express 5 |
| 前端 | React 19 + Vite 8 + Tailwind CSS v4 |
| AI | 兼容 OpenAI Chat Completions 格式的任意 LLM |
| 通信 | SSE (Server-Sent Events) 实时流推 |
| 架构 | BFF (Backend for Frontend) |

---

## 快速开始

### 1. 克隆与安装

```bash
git clone <repo-url>
cd vibe-creator-engine

# 安装后端依赖
npm install

# 安装前端依赖
cd dashboard && npm install && cd ..
```

### 2. 配置 API Key

复制模板并填入你的密钥：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

> 兼容任何 OpenAI 格式的 API 接口，只需修改 `OPENAI_BASE_URL` 和 `OPENAI_MODEL` 即可切换模型提供商。

### 3. 启动

```bash
# 终端 1：启动后端 API
npm run server

# 终端 2：启动前端
npm run dashboard
```

打开 http://localhost:5173，输入一个创意种子，开始你的创作。

也可以直接通过命令行使用：

```bash
npm run engine
```

---

## 目录结构

```
vibe-creator-engine/
├── engine/                    # 后端引擎
│   ├── core.js                # AI 调用、自循环工作流
│   ├── server.js              # Express API 服务 (SSE + REST)
│   ├── auth.js                # 用户认证与会话管理
│   ├── index.js               # CLI 入口
│   └── prompts/
│       ├── creator.js         # Creator 系统提示词
│       └── critic.js          # Critic 系统提示词
├── dashboard/                 # 前端展厅
│   └── src/
│       ├── App.jsx            # 主应用组件
│       └── App.css            # 样式与动画
├── output/                    # 本地作品陈列室
│   └── <userId>/              # 按用户隔离
├── .env.example               # 环境变量模板
└── package.json
```

---

## License

[MIT](LICENSE)

---

<div align="center">

*愿你在这个工坊里，创造出能打动那个人的专属微光。*

</div>
