"""
stock_data.py — Real-time stock data + K-line fetcher for invest skill
Uses Sina Finance API (no API key required, works reliably)
"""

import sys
import json
import urllib.request
import urllib.error
from datetime import datetime

# ── Sina Finance API ────────────────────────────────────────────────────────

def sina_get(url):
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://finance.sina.com.cn/'
        })
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read().decode('gbk', errors='replace')
    except Exception as e:
        return f'ERROR:{e}'


def parse_hq_str(data, symbol):
    """Parse Sina hq_str format: name,open,prev_close,price,high,low,...,time"""
    try:
        # Format: var hq_str_sz002624="name,open,prev_close,price,high,low,...,time"
        tag = f'hq_str_{symbol}'
        if tag not in data:
            return {'success': False, 'error': f'tag {tag} not found'}
        
        content = data.split(f'{tag}="')[1].split('"')[0]
        parts = content.split(',')
        if len(parts) < 32:
            return {'success': False, 'error': 'data format unexpected'}
        
        name = parts[0]
        open_price = float(parts[1]) if parts[1] else 0
        prev_close = float(parts[2]) if parts[2] else 0
        price = float(parts[3]) if parts[3] else 0
        high = float(parts[4]) if parts[4] else 0
        low = float(parts[5]) if parts[5] else 0
        volume = int(parts[8]) if parts[8] else 0
        amount = float(parts[9]) if parts[9] else 0
        date = parts[30] if len(parts) > 30 else ''
        time = parts[31] if len(parts) > 31 else ''
        change = price - prev_close
        change_pct = (change / prev_close * 100) if prev_close else 0
        
        return {
            'success': True,
            'name': name,
            'price': price,
            'open': open_price,
            'prev_close': prev_close,
            'high': high,
            'low': low,
            'change': round(change, 2),
            'change_pct': round(change_pct, 2),
            'volume': volume,
            'amount': amount,
            'date': date,
            'time': time,
        }
    except Exception as e:
        return {'success': False, 'error': str(e)}


def get_realtime_quote(ticker):
    """
    Fetch real-time quote for A-stock ticker (6-digit).
    Market detection: starts with 6 = sh, else = sz
    """
    market = 'sh' if ticker.startswith('6') else 'sz'
    symbol = f"{market}{ticker}"
    url = f"https://hq.sinajs.cn/list={symbol}"
    data = sina_get(url)
    return parse_hq_str(data, symbol)


def get_realtime_quotes(tickers):
    """Fetch multiple tickers at once"""
    symbols = []
    for t in tickers:
        m = 'sh' if t.startswith('6') else 'sz'
        symbols.append(f"{m}{t}")
    url = f"https://hq.sinajs.cn/list={','.join(symbols)}"
    data = sina_get(url)
    results = []
    for sym in symbols:
        r = parse_hq_str(data, sym)
        r['ticker'] = sym[2:]
        results.append(r)
    return results


def get_kline(ticker, days=60, scale=240):
    """
    Fetch K-line history from Sina.
    scale: 5=5min, 15=15min, 30=30min, 60=60min, 240=daily, 600=weekly
    Returns: list of {day, open, high, low, close, volume, ma_price5, ma_volume5}
    """
    market = 'sh' if ticker.startswith('6') else 'sz'
    symbol = f"{market}{ticker}"
    url = (f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php"
           f"/CN_MarketData.getKLineData?symbol={symbol}&scale={scale}&ma=5&datalen={days}")
    
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://finance.sina.com.cn/'
        })
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read().decode('utf-8')
            return json.loads(data)
    except Exception as e:
        return []


def get_daily_kline(ticker, days=60):
    """Get daily K-line (most common for technical analysis)"""
    return get_kline(ticker, days=days, scale=240)


def get_news(ticker, count=10):
    """
    Fetch recent news from Eastmoney search API.
    Returns: list of {title, date}
    """
    import re, urllib.parse
    try:
        import json as _json
        payload = _json.dumps({
            'uid': '', 'keyword': ticker, 'type': ['cmsArticle'],
            'client': 'web', 'clientVersion': 'curr', 'clientType': 'web',
            'param': {'cmsArticle': {'searchScope': 'default', 'sort': 'default',
                'pageIndex': 1, 'pageSize': count, 'preTag': '', 'postTag': ''}}
        })
        encoded = urllib.parse.quote(payload, safe='')
        url = 'https://search-api-web.eastmoney.com/search/jsonp?cb=&param=' + encoded
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://www.eastmoney.com/'
        })
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read().decode('utf-8', errors='replace')
        # Extract JSON from JSONP wrapper
        m = re.search(r'\{.+\}', raw, re.DOTALL)
        if not m: return []
        data = _json.loads(m.group())
        articles = data.get('result', {}).get('cmsArticle', [])
        # Strip HTML tags from titles
        clean = lambda s: re.sub(r'<[^>]+>', '', s or '')
        return [{'title': clean(a.get('title', '')), 'date': a.get('date', '')[:10]}
                for a in articles if a.get('title')]
    except Exception as e:
        return []


# ── Quant factors bridge ────────────────────────────────────────────────────

def compute_quant_report(ticker, days=60):
    """
    Get real price data and compute quantitative factors.
    Returns: quant report dict + price list for further analysis
    """
    sys.path.insert(0, 'C:/Users/Administrator/.openclaw/workspace')
    
    # Get real K-line data
    klines = get_daily_kline(ticker, days=days)
    if len(klines) < 20:
        return {'success': False, 'error': f'Insufficient data: {len(klines)} days'}
    
    closes = [float(k['close']) for k in klines]
    highs = [float(k['high']) for k in klines]
    lows = [float(k['low']) for k in klines]
    volumes = [float(k['volume']) for k in klines]
    
    # Compute quant factors
    from modules.invest.quant_factors import QuantitativeFactors
    qf = QuantitativeFactors(closes)
    report = qf.full_report(rf=0.02)
    
    # Technical indicators
    c = closes
    rsi = _rsi(c, 14)
    macd_vals = _macd(c, 12, 26, 9)
    bb = _bollinger_bands(c, 20)
    
    return {
        'success': True,
        'ticker': ticker,
        'name': klines[-1].get('day', ''),
        'data_date': klines[-1]['day'],
        'closes': closes[-20:],
        'prices': closes,
        'count': len(closes),
        'quant': {
            'sharpe': round(report.sharpe, 2),
            'sortino': round(report.sortino, 2),
            'calmar': round(report.calmar, 2),
            'max_drawdown': round(report.max_drawdown, 4),
            'var_95': round(report.var.var, 4),
            'volatility_annual': round(report.volatility_annual, 4),
            'volatility_regime': report.volatility_regime,
            'rsi_14': round(rsi, 2),
            'macd': round(macd_vals['macd'], 4),
            'macd_signal': round(macd_vals['signal'], 4),
            'macd_hist': round(macd_vals['hist'], 4),
            'bb_upper': round(bb['upper'], 2),
            'bb_middle': round(bb['middle'], 2),
            'bb_lower': round(bb['lower'], 2),
            'bb_position': round(bb['position'], 4),
        },
    }


def _rsi(prices, period=14):
    if len(prices) < period + 1:
        return 50.0
    deltas = [prices[i] - prices[i-1] for i in range(1, len(prices))]
    gains = [d if d > 0 else 0 for d in deltas[-period:]]
    losses = [-d if d < 0 else 0 for d in deltas[-period:]]
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _macd(prices, fast=12, slow=26, signal=9):
    if len(prices) < slow + signal:
        return {'macd': 0, 'signal': 0, 'hist': 0}
    
    def ema(data, n):
        k = 2 / (n + 1)
        ema_val = data[0]
        result = [ema_val]
        for d in data[1:]:
            ema_val = d * k + ema_val * (1 - k)
            result.append(ema_val)
        return result
    
    ema_fast = ema(prices, fast)
    ema_slow = ema(prices, slow)
    macd_line = [ema_fast[i] - ema_slow[i] for i in range(len(ema_fast))]
    signal_line = ema(macd_line, signal)
    n = len(macd_line)
    m = len(signal_line)
    hist = macd_line[-1] - signal_line[-1] if n > 0 and m > 0 else 0
    return {
        'macd': macd_line[-1] if macd_line else 0,
        'signal': signal_line[-1] if signal_line else 0,
        'hist': hist,
    }


def _bollinger_bands(prices, period=20, std_dev=2):
    if len(prices) < period:
        return {'upper': 0, 'middle': 0, 'lower': 0, 'position': 0.5}
    recent = prices[-period:]
    middle = sum(recent) / period
    variance = sum((p - middle) ** 2 for p in recent) / period
    std = variance ** 0.5
    upper = middle + std_dev * std
    lower = middle - std_dev * std
    current = prices[-1]
    position = (current - lower) / (upper - lower) if upper != lower else 0.5
    return {
        'upper': round(upper, 2),
        'middle': round(middle, 2),
        'lower': round(lower, 2),
        'position': round(position, 4),
    }


# ── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Stock data CLI')
    parser.add_argument('command', choices=['quote', 'kline', 'news', 'quant', 'batch'])
    parser.add_argument('tickers', nargs='+')
    parser.add_argument('--days', type=int, default=60)
    args = parser.parse_args()

    if args.command == 'quote':
        for t in args.tickers:
            r = get_realtime_quote(t)
            print(json.dumps(r, ensure_ascii=False, default=str))
            print('---')

    elif args.command == 'kline':
        t = args.tickers[0]
        klines = get_daily_kline(t, days=args.days)
        print(f"Got {len(klines)} days of data for {t}")
        print('Last 5 days:')
        for k in klines[-5:]:
            print(f"  {k['day']} C:{k['close']} H:{k['high']} L:{k['low']} V:{k['volume']}")

    elif args.command == 'news':
        for t in args.tickers:
            news = get_news(t, count=5)
            print(f"=== {t} ({len(news)} news) ===")
            for n in news[:5]:
                print(f"  [{n['date']}] {n['title']}")

    elif args.command == 'quant':
        for t in args.tickers:
            r = compute_quant_report(t, days=args.days)
            if not r['success']:
                print(f"ERROR {t}: {r.get('error')}")
                continue
            q = r['quant']
            print(f"=== {t} 量化分析 ({r['data_date']}) ===")
            print(f"Sharpe: {q['sharpe']} | Sortino: {q['sortino']} | Calmar: {q['calmar']}")
            print(f"MaxDD: {q['max_drawdown']:.2%} | VaR: {q['var_95']:.2%} | Vol: {q['volatility_annual']:.2%}")
            print(f"RSI: {q['rsi_14']} | MACD: {q['macd']:.4f} (signal {q['macd_signal']:.4f})")
            print(f"BB: [{q['bb_lower']} - {q['bb_middle']} - {q['bb_upper']}] pos={q['bb_position']:.2%}")
            print(f"波动区间: {q['volatility_regime']}")
            print('---')

    elif args.command == 'batch':
        quotes = get_realtime_quotes(args.tickers)
        for q in quotes:
            print(json.dumps(q, ensure_ascii=False, default=str))
            print('---')
