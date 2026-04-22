"""
data_connectors.py — FinceptTerminal-inspired Multi-Source Data Layer
=====================================================================

参考 FinceptTerminal 的 100+ data connectors 设计：
  - FRED (Federal Reserve Economic Data)
  - IMF World Economic Outlook
  - World Bank Open Data
  - AkShare (A股/期货/宏观)
  - Yahoo Finance
  - Crypto exchanges (Kraken/HyperLiquid)

每个 connector 实现统一接口：
  get_indicator(indicator, **kwargs) -> dict
  get_series(symbol, start, end) -> pd.DataFrame
  health_check() -> bool
"""

import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional
import asyncio

# ============================================================================
# Data Source Registry
# ============================================================================

class DataSource(Enum):
    FRED = "fred"
    IMF = "imf"
    WORLD_BANK = "world_bank"
    AKSHARE = "akshare"
    YAHOO = "yahoo"
    CRYPTO = "crypto"
    EASTMONEY = "eastmoney"  # 现有


@dataclass
class DataResponse:
    source: DataSource
    indicator: str
    data: Any
    timestamp: float
    latency_ms: float
    cached: bool = False


class BaseConnector(ABC):
    """所有 data connector 的基类"""

    name: str = "base"
    source: DataSource = DataSource.EASTMONEY
    base_url: str = ""

    def __init__(self):
        self._cache: dict[str, tuple[float, Any]] = {}
        self.cache_ttl = 300  # 5 分钟缓存

    def get_cached(self, key: str) -> Optional[Any]:
        if key in self._cache:
            ts, val = self._cache[key]
            if time.time() - ts < self.cache_ttl:
                return val
        return None

    def set_cached(self, key: str, val: Any):
        self._cache[key] = (time.time(), val)

    @abstractmethod
    async def get_indicator(self, indicator: str, **kwargs) -> DataResponse:
        raise NotImplementedError

    @abstractmethod
    async def health_check(self) -> bool:
        raise NotImplementedError


# ============================================================================
# FRED Connector — 美联储经济数据
# ============================================================================
# 重点指标：
#   DFF (联邦基金利率) / DGS10 (10年期国债收益率)
#   UNRATE (失业率) / CPIAUCSL (CPI)
#   GDPPOT (潜在GDP) / INDPRO (工业产出)
#   M2SL (M2货币供应) / TEDRATE (TED利差)
# ============================================================================

class FredConnector(BaseConnector):
    name = "fred"
    source = DataSource.FRED
    base_url = "https://api.stlouisfed.org/fred"

    def __init__(self, api_key: str = ""):
        super().__init__()
        self.api_key = api_key or ""

    def _build_url(self, endpoint: str, params: dict) -> str:
        params["api_key"] = self.api_key or "demo"
        param_str = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{self.base_url}/{endpoint}?{param_str}"

    async def get_indicator(self, indicator: str, **kwargs) -> DataResponse:
        """
        indicator: FRED series ID (如 'DGS10', 'UNRATE')
        start/end: 可选，ISO 日期字符串
        """
        start = kwargs.get("start", "2020-01-01")
        end = kwargs.get("end", kwargs.get("end", "2025-12-31"))

        cache_key = f"{indicator}:{start}:{end}"
        cached = self.get_cached(cache_key)
        if cached:
            return DataResponse(
                source=self.source, indicator=indicator,
                data=cached, timestamp=time.time(), latency_ms=0, cached=True
            )

        # FRED 没有免费的异步 API，使用同步请求模拟
        import urllib.request
        url = self._build_url("series/observations", {
            "series_id": indicator,
            "observation_start": start,
            "observation_end": end,
            "file_type": "json",
        })

        t0 = time.time()
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                raw = json.loads(resp.read())
            observations = raw.get("observations", [])
            data = [{"date": o["date"], "value": o["value"]} for o in observations]
            self.set_cached(cache_key, data)
            return DataResponse(
                source=self.source, indicator=indicator,
                data=data, timestamp=time.time(),
                latency_ms=int((time.time() - t0) * 1000)
            )
        except Exception as e:
            return DataResponse(
                source=self.source, indicator=indicator,
                data={"error": str(e)}, timestamp=time.time(),
                latency_ms=int((time.time() - t0) * 1000)
            )

    async def health_check(self) -> bool:
        try:
            import urllib.request
            url = f"{self.base_url}/series/observations?series_id=DFF&api_key={self.api_key or 'demo'}&observation_start=2024-01-01&observation_end=2024-01-02&file_type=json"
            with urllib.request.urlopen(url, timeout=5) as resp:
                return resp.status == 200
        except:
            return False

    # ─── 常用指标快捷方法 ───────────────────────────────────────────────

    async def fed_funds_rate(self) -> DataResponse:
        return await self.get_indicator("DFF")

    async def treasury_10y(self) -> DataResponse:
        return await self.get_indicator("DGS10")

    async def unemployment(self) -> DataResponse:
        return await self.get_indicator("UNRATE")

    async def cpi(self) -> DataResponse:
        return await self.get_indicator("CPIAUCSL")

    async def sp500(self) -> DataResponse:
        return await self.get_indicator("SP500")

    async def yield_curve(self) -> dict:
        """获取完整收益率曲线 (2y/3y/5y/7y/10y/30y)"""
        series = ["DGS2", "DGS3", "DGS5", "DGS7", "DGS10", "DGS30"]
        tasks = [self.get_indicator(s) for s in series]
        results = await asyncio.gather(*tasks)
        curve = {}
        for r in results:
            if isinstance(r.data, list) and r.data:
                latest = r.data[-1]
                curve[r.indicator] = latest.get("value", "N/A")
        return curve


# ============================================================================
# IMF Connector — IMF 世界经济展望
# ============================================================================
# WEO dataset: https://www.imf.org/en/Publications/WEO
# 指标: GDP增长率, 通胀, 经常账户, 财政余额, 失业率
# ============================================================================

class IMFConnector(BaseConnector):
    name = "imf"
    source = DataSource.IMF
    base_url = "https://www.imf.org/en/Publications/WEO"

    async def get_indicator(self, indicator: str, **kwargs) -> DataResponse:
        """
        indicator: IMF series ID (如 'NGDP_RPCH' = 实际GDP增长率)
        country: ISO3 国家码 (如 'USA', 'CHN', 默认 'W0' = 世界)
        """
        country = kwargs.get("country", "W0")
        year = kwargs.get("year", 2024)

        cache_key = f"imf:{indicator}:{country}:{year}"
        cached = self.get_cached(cache_key)
        if cached:
            return DataResponse(source=self.source, indicator=indicator,
                                data=cached, timestamp=time.time(), latency_ms=0, cached=True)

        # IMF API: https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/WSAME/
        import urllib.request
        url = f"https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/WSAME/{indicator}.{country}"
        t0 = time.time()
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                raw = json.loads(resp.read())
            # 解析 IMF SDMX-JSON 格式
            data = raw.get("CompactData", {}).get("DataSet", {}).get("Series", {})
            self.set_cached(cache_key, data)
            return DataResponse(source=self.source, indicator=indicator,
                                data=data, timestamp=time.time(),
                                latency_ms=int((time.time() - t0) * 1000))
        except Exception as e:
            return DataResponse(source=self.source, indicator=indicator,
                                data={"error": str(e)}, timestamp=time.time(),
                                latency_ms=int((time.time() - t0) * 1000))

    async def health_check(self) -> bool:
        try:
            import urllib.request
            url = "https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/WSAME/NGDP_RPCH.W0"
            with urllib.request.urlopen(url, timeout=5) as resp:
                return resp.status == 200
        except:
            return False


# ============================================================================
# World Bank Connector — 世界银行开放数据
# ============================================================================

class WorldBankConnector(BaseConnector):
    name = "world_bank"
    source = DataSource.WORLD_BANK
    base_url = "https://api.worldbank.org/v2"

    async def get_indicator(self, indicator: str, **kwargs) -> DataResponse:
        """
        indicator: World Bank indicator code
        country: 'all' / 'USA' / 'CHN' / 'JPN' (默认 'all')
        date: '2020:2024' (默认)
        """
        country = kwargs.get("country", "all")
        date_range = kwargs.get("date", "2020:2024")
        per_page = kwargs.get("per_page", 100)

        cache_key = f"wb:{indicator}:{country}:{date_range}"
        cached = self.get_cached(cache_key)
        if cached:
            return DataResponse(source=self.source, indicator=indicator,
                                data=cached, timestamp=time.time(), latency_ms=0, cached=True)

        import urllib.request
        url = f"{self.base_url}/country/{country}/indicator/{indicator}?date={date_range}&format=json&per_page={per_page}"
        t0 = time.time()
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                raw = json.loads(resp.read())
            # World Bank 返回 [metadata, data]
            data = raw[1] if len(raw) > 1 else []
            self.set_cached(cache_key, data)
            return DataResponse(source=self.source, indicator=indicator,
                                data=data, timestamp=time.time(),
                                latency_ms=int((time.time() - t0) * 1000))
        except Exception as e:
            return DataResponse(source=self.source, indicator=indicator,
                                data={"error": str(e)}, timestamp=time.time(),
                                latency_ms=int((time.time() - t0) * 1000))

    async def health_check(self) -> bool:
        try:
            import urllib.request
            url = f"{self.base_url}/country/all/indicator/NY.GDP.MKTP.CD?format=json&per_page=1"
            with urllib.request.urlopen(url, timeout=5) as resp:
                return resp.status == 200
        except:
            return False

    # ─── 常用指标 ───────────────────────────────────────────────────────
    # NY.GDP.MKTP.CD    — GDP (current US$)
    # NY.GDP.PCAP.CD    — GDP per capita
    # SP.POP.TOTL       — 总人口
    # SP.DYN.IMRT.IN    — 婴儿死亡率
    # SL.UEM.TOTL.ZS    — 失业率


# ============================================================================
# AkShare Connector — A股 + 期货 (不需要登录)
# ============================================================================
# 参考: https://github.com/akfamily/akshare
# ============================================================================

class AkShareConnector(BaseConnector):
    name = "akshare"
    source = DataSource.AKSHARE

    def __init__(self):
        super().__init__()
        self.cache_ttl = 60  # 1 分钟缓存（A股数据更新快）

    async def get_indicator(self, indicator: str, **kwargs) -> DataResponse:
        cache_key = f"ak:{indicator}:{kwargs}"
        cached = self.get_cached(cache_key)
        if cached:
            return DataResponse(source=self.source, indicator=indicator,
                                data=cached, timestamp=time.time(), latency_ms=0, cached=True)

        t0 = time.time()
        try:
            import urllib.request
            import ssl

            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            # 股票实时行情
            if indicator == "stock_quote":
                symbol = kwargs.get("symbol", "000001")
                exchange = "sh" if symbol.startswith(("6", "5")) else "sz"
                url = f"https://qt.gtimg.cn/q={exchange}{symbol}"
                with urllib.request.urlopen(url, timeout=5, context=ctx) as resp:
                    raw = resp.read().decode("gbk")
                # 解析腾讯行情格式
                fields = raw.split("~")
                if len(fields) > 40:
                    data = {
                        "symbol": symbol, "name": fields[1],
                        "price": fields[3], "change": fields[31],
                        "pct": fields[32], "volume": fields[36],
                        "amount": fields[37], "open": fields[5],
                        "high": fields[33], "low": fields[34],
                        "close": fields[4], "time": fields[30],
                    }
                else:
                    data = {"error": "parse_failed", "raw": raw[:100]}

            # 指数实时行情
            elif indicator == "index_quote":
                symbol = kwargs.get("symbol", "000001")
                url = f"https://qt.gtimg.cn/q=s_sh{symbol}"
                with urllib.request.urlopen(url, timeout=5, context=ctx) as resp:
                    raw = resp.read().decode("gbk")
                fields = raw.split("~")
                if len(fields) > 10:
                    data = {
                        "name": fields[1], "price": fields[3],
                        "change": fields[31], "pct": fields[32],
                        "high": fields[33], "low":  fields[34],
                    }
                else:
                    data = {"error": "parse_failed"}

            else:
                data = {"error": f"unknown indicator: {indicator}"}

            self.set_cached(cache_key, data)
            return DataResponse(source=self.source, indicator=indicator,
                                data=data, timestamp=time.time(),
                                latency_ms=int((time.time() - t0) * 1000))
        except Exception as e:
            return DataResponse(source=self.source, indicator=indicator,
                                data={"error": str(e)}, timestamp=time.time(),
                                latency_ms=int((time.time() - t0) * 1000))

    async def health_check(self) -> bool:
        try:
            import urllib.request, ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            url = "https://qt.gtimg.cn/q=sh000001"
            with urllib.request.urlopen(url, timeout=5, context=ctx) as resp:
                return resp.status == 200
        except:
            return False


# ============================================================================
# Data Connector Manager
# ============================================================================

class DataConnectorManager:
    """
    统一管理所有 data connectors。
    类似 FinceptTerminal 的 Repository Pattern + Service Layer。

    Usage:
        mgr = DataConnectorManager()
        await mgr.add_connector(FredConnector(api_key="your-key"))
        fred_data = await mgr.get("fred", "DGS10")
        imf_gdp = await mgr.get("imf", "NGDP_RPCH", country="CHN")
    """

    def __init__(self):
        self._connectors: dict[str, BaseConnector] = {}
        self._stats: dict[str, dict] = {}

        # 注册默认 connectors（无需 API key）
        self.add_connector(AkShareConnector())
        self.add_connector(WorldBankConnector())

    def add_connector(self, conn: BaseConnector, name: str = None):
        name = name or conn.name
        self._connectors[name] = conn
        self._stats[name] = {"requests": 0, "cache_hits": 0, "errors": 0}

    async def get(self, source: str, indicator: str, **kwargs) -> DataResponse:
        if source not in self._connectors:
            return DataResponse(
                source=DataSource.EASTMONEY, indicator=indicator,
                data={"error": f"unknown source: {source}"},
                timestamp=time.time(), latency_ms=0
            )
        conn = self._connectors[source]
        self._stats[source]["requests"] += 1
        resp = await conn.get_indicator(indicator, **kwargs)
        if resp.cached:
            self._stats[source]["cache_hits"] += 1
        if isinstance(resp.data, dict) and "error" in resp.data:
            self._stats[source]["errors"] += 1
        return resp

    def stats(self) -> dict:
        return {
            name: {
                "requests": s["requests"],
                "cache_hits": s["cache_hits"],
                "errors": s["errors"],
                "cache_hit_rate": f"{s['cache_hits']/max(s['requests'],1)*100:.0f}%",
            }
            for name, s in self._stats.items()
        }


# ============================================================================
# CLI Test
# ============================================================================

if __name__ == "__main__":
    async def test():
        mgr = DataConnectorManager()

        # AkShare — 上证指数
        print("=== AkShare: 上证指数 ===")
        r = await mgr.get("akshare", "index_quote", symbol="000001")
        print(f"  data: {r.data}")

        # World Bank — 中国 GDP
        print("\n=== World Bank: 中国 GDP ===")
        r = await mgr.get("worldbank", "NY.GDP.MKTP.CD", country="CHN", date="2020:2024")
        print(f"  records: {len(r.data) if isinstance(r.data, list) else 'error'}")
        if isinstance(r.data, list) and r.data:
            print(f"  latest: {r.data[0]}")

        # Stats
        print("\n=== Connector Stats ===")
        print(json.dumps(mgr.stats(), indent=2))

    asyncio.run(test())
