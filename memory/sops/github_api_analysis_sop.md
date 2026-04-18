# [SOP] ANALYSIS | GitHub REST API 通用源码分析

> 自动生成于 2026-04-18T13:30:00.000Z
> 来源: 基于 genericagent_analysis_sop 泛化
> 触发条件: 用户要求分析 GitHub 项目源码

## 执行步骤

1. 调用 GitHub REST API v3 获取仓库信息
   - `GET /repos/{owner}/{repo}` — 仓库元数据
   - `GET /repos/{owner}/{repo}/contents/{path}` — 目录内容

2. 递归获取关键源文件
   - 先获取根目录
   - 按类型过滤：优先 .py / .js / .ts / .go 文件
   - 跳过二进制文件和大型文件（> 200KB）

3. 分析架构模式
   - 识别入口文件（main.py / index.js / main.ts）
   - 提取模块依赖关系
   - 分类：框架/工具/业务逻辑

4. 提取可复用的设计模式
   - 工具函数库
   - 配置管理方式
   - API 封装风格

## PowerShell 示例

```powershell
$owner = "lsdefine"
$repo = "GenericAgent"
$baseUrl = "https://api.github.com/repos/$owner/$repo"

# 获取仓库信息
$repoInfo = Invoke-RestMethod $baseUrl -Headers @{Authorization="token $token"} -TimeoutSec 10

# 获取目录结构
$contents = Invoke-RestMethod "$baseUrl/contents" -TimeoutSec 15

# 获取特定文件(Base64)
$file = Invoke-RestMethod "$baseUrl/contents/agent_loop.py" -TimeoutSec 15
$content = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($file.content))
```

## 适用场景

- GitHub 开源项目快速评估
- 源码架构预审阅
- 提取可复用代码模式
- 技术选型参考
