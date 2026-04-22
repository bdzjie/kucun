# FinceptTerminal 架构深度分析

*分析日期: 2026-04-22*
*参考: docs/ARCHITECTURE.md (v4.0.2) + GitHub API*

---

## 1. 项目概览

| 指标 | 值 |
|------|-----|
| 名称 | FinceptTerminal v4 |
| 语言 | C++20 + Qt6 + Python 3.11+ |
| 许可证 | AGPL-3.0 |
| 定位 | Bloomberg Terminal 开源替代 |
| 主题 | bloomberg-terminal, quantitative-finance, AI-agents, machine-learning |
| UI | Qt6 Widgets + Qt Charts (原生桌面) |
| Python 嵌入 | PyBind11 (C++/Python 互操作) |

---

## 2. 四层技术栈

```
┌─────────────────────────────────────────────┐
│ Layer 4: User Interface (Qt6 Widgets)        │
│   Qt6 Widgets + Qt Charts (原生 retain-mode) │
│   Bloomburg-style terminal UI                │
├─────────────────────────────────────────────┤
│ Layer 3: Application (40+ Screens + Services)│
│   auth / dashboard / markets / news          │
│   trading / screener / report_builder       │
│   MCP Integration (40+ tools)               │
├─────────────────────────────────────────────┤
│ Layer 2: Infrastructure                      │
│   HTTP / SQLite / WebSocket / Python Bridge  │
│   100+ Python scripts                        │
├─────────────────────────────────────────────┤
│ Layer 1: Platform                           │
│   Qt6 Platform Abstraction                   │
│   Windows (MSVC) / macOS (Clang) / Linux(GC) │
└─────────────────────────────────────────────┘
```

---

## 3. 源码结构 (fincept-qt/src/)

```
fincept-qt/src/
├── app/                          # 应用入口
│   ├── main.cpp                  # Entry point, QApplication setup
│   ├── MainWindow.*              # Main window, layout, screen hosting
│   └── ScreenRouter.*             # Qt StackedWidget-based navigation
│
├── core/                         # 共享基础设施（无业务逻辑）
│   ├── config/AppConfig.*         # App-wide constants (URLs, versions)
│   ├── events/EventBus.*          # Pub/sub for decoupled communication
│   ├── logging/Logger.*            # Structured logging (LOG_INFO, LOG_ERROR)
│   ├── result/Result.*            # Result<T> error handling type
│   └── session/SessionManager.*   # Session management
│
├── ui/                           # 可复用 Qt Widgets
│   ├── theme/Theme.*             # Color tokens, font constants
│   ├── widgets/                  # 基础组件
│   │   ├── Card.*                # Panel container
│   │   ├── SearchBar.*           # Search input
│   │   ├── StatusBadge.*         # Status indicator
│   │   ├── DataTable.*           # Reusable data table
│   │   ├── ChartFactory.*        # Qt Charts factory
│   │   └── navigation/           # Navigation widgets
│   │       ├── NavigationBar.*   # Left sidebar navigation
│   │       ├── FKeyBar.*         # Function key shortcuts bar
│   │       └── StatusBar.*       # Bottom status bar
│   ├── network/                  # 网络层
│   │   ├── http/HttpClient.*     # QNetworkAccessManager wrapper
│   │   └── websocket/WebSocketClient.*  # Qt WebSocket wrapper
│   └── storage/                  # 存储层
│       ├── sqlite/               # SQLite (main + cache)
│       ├── migrations/           # Versioned schema migrations
│       └── auth/                 # Encrypted credential storage
│
├── python/                       # Python 嵌入层
│   └── PythonRunner.*            # Execute Python scripts, capture stdout
│
├── trading/                      # 交易引擎
│   ├── BrokerInterface.*        # Abstract broker interface
│   ├── BrokerRegistry.*          # Broker registration
│   ├── ExchangeService.*         # Exchange connectivity
│   ├── OrderMatcher.*            # Order matching engine
│   ├── PaperTrading.*            # Paper trading engine
│   ├── UnifiedTrading.*          # Unified trading facade
│   └── brokers/                  # 20+ broker implementations
│       ├── ZerodhaBroker.*       # Zerodha (India)
│       ├── FyersBroker.*         # Fyers (India)
│       ├── AlpacaBroker.*        # Alpaca (US)
│       ├── IBKRBroker.*          # Interactive Brokers (US)
│       └── ...
│
├── services/                    # 业务服务层（无 UI）
│   ├── markets/MarketDataService.*   # 实时行情
│   ├── news/NewsService.*            # 新闻聚合
│   └── screener/ScreenerService.*    # 股票筛选
│
└── screens/                     # 40+ 终端屏幕（UI + Service）
    ├── auth/                    # Login / Register / ForgotPassword
    ├── dashboard/               # Dashboard + 13 widgets
    ├── markets/                # Market data
    ├── news/                   # News aggregation + clustering
    ├── watchlist/              # Watchlist management
    ├── crypto_trading/         # Crypto trading (7 components)
    └── report_builder/         # Report generation (4 components)
```

---

## 4. Screen/Service 分离模式（最重要设计）

每个 Screen 只做 3 件事：
1. **接收用户交互** → 发送信号
2. **渲染 UI** → Qt Widget 更新
3. **连接 Service** → 通过 Qt signals/slots

每个 Service 只做 3 件事：
1. **获取数据** → HTTP / WebSocket / SQLite
2. **缓存数据** → CacheDatabase
3. **发送通知** → Qt signals

```
User Interaction
       │
       ▼
Screen (*Screen.cpp) ───signal/slot───► Service (*Service.cpp)
  │                                          │
  │  UI rendering only                       │ HTTP calls
  │  no direct HTTP                          │ caching
  │  no business logic                        │ business logic
  ▼                                          ▼
Qt Widget Update                    Data Update ──signal──► Screen
```

**对 OpenClaw AIAgent 的借鉴：**
- AIAgent（Screen）只负责对话和决策
- 工具/数据获取（Service）下沉到独立模块
- 通过 AppContext 共享状态

---

## 5. Python 嵌入层 (PythonRunner)

```cpp
class PythonRunner {
    void runScript(const QString& path);    // 执行 .py 文件
    void runFunction(const QString& module, const QString& func); // 调用函数
    QVariant evalExpression(const QString& expr);  // 求值表达式
    void injectData(const QVariantMap& data);      // 注入 C++ 数据到 Python
};
```

**使用场景：**
- 量化分析（NumPy / Pandas / SciPy）
- 机器学习（sklearn / PyTorch）
- 金融计算（QuantLib / scipy.stats）

---

## 6. 37 个 AI Agents（3 Frameworks）

### Trader Framework
价值: Buffett / Graham / Munger / Lynch / Fisher
成长: Wood / Ackman / Burry
特殊: Taleb (尾部风险) / Pabrai / Jhunjhunwala

### Economic Framework
央行: Fed / ECB / BOJ / PBOC
宏观: GDP growth / Inflation / Interest rates

### Geopolitics Framework
区域: 中国 / 美国 / 欧洲 / 新兴市场
关系: 国家间经济关系映射

---

## 7. 100+ Data Connectors

| 类别 | 数量 | 代表数据源 |
|------|------|-----------|
| 官方统计 | 5+ | FRED, IMF WEO, World Bank, BFS, BEA |
| 加密货币 | 3+ | Kraken, HyperLiquid, Binance |
| 经纪商 | 16+ | Zerodha, Alpaca, IBKR, Saxo |
| 替代数据 | 3+ | Adanos, 卫星, 海关 |
| 股票数据 | 5+ | Polygon, Yahoo Finance |

---

## 8. 与 OpenClaw 投资顾问团对比

| 维度 | FinceptTerminal | invest skill | 差距 |
|------|----------------|--------------|------|
| Agents | 37 (3 frameworks) | 13 personas | **24 个** |
| 数据源 | 100+ | 仅 Eastmoney | **100+** |
| 量化分析 | QuantLib 18 modules | 无 | **18 modules** |
| 实时交易 | 20+ 券商 | 无 | **20+** |
| 宏观因子 | FRED/IMF/WorldBank | 无 | **宏观层缺失** |
| Python 嵌入 | PyBind11 | 无 | **量化层缺失** |
| 多 LLM | 7 providers | 仅 MiniMax | **6 个** |

---

## 9. 今日已实现增强（2026-04-22）

### modules/invest/data_connectors.py (17.8KB)
- DataConnectorManager: 统一接口 + 缓存 + 请求统计
- FredConnector: 联邦基金利率/国债收益率/失业率/CPI
- IMFConnector: IMF WEO GDP 增长预测
- WorldBankConnector: World Bank GDP/人口/发展指标
- AkShareConnector: A 股实时行情

### modules/invest/macro_expert.py (13.6KB)
- PolicyStance: Taylor Rule 货币政策立场判断
- YieldCurveShape: Normal/Flat/Inverted/Hiroshima
- Recession probability: 曲线形状 + 领先指标
- 并行多源数据获取

### modules/invest/quant_factors.py (13.2KB)
- VaR / CVaR (Expected Shortfall)
- Sharpe / Sortino / Calmar 比率
- Max Drawdown
- RSI / MACD / Bollinger Bands / ATR
- Volatility regime: low/medium/high/extreme

---

## 10. 待实现增强

1. **FRED API Key** — 免费注册获取完整宏观数据
2. **Economic Expert 调用** — 每次股票分析前自动附宏观背景
3. **地缘政治 Agent** — 制裁/关税/供应链风险
4. **多 LLM 扩展** — DeepSeek/Groq/Gemini 接入
5. **ATR 技术指标** — 当前缺失
6. **Node Editor 可视化** — Fincept 的自动化流水线

---

*分析完成。内容基于 docs/ARCHITECTURE.md blob + GitHub Tree 重建。*
