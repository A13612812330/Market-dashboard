#!/usr/bin/env python3
"""Collect best-effort market data for Komo Market Dashboard.

This collector is intentionally cache-friendly: every module reports its own
source and failure status, so the Node server can save successful modules and
keep cached snapshots for failed modules.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import logging
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Any, Callable


SCOPES = {"all", "ashare", "etf", "sector", "global", "history", "stock-history", "sector-members", "news", "securities", "security-quote", "security-quotes"}
STOCK_HISTORY_TARGET_BARS = max(120, min(int(os.environ.get("KOMO_STOCK_HISTORY_BARS", "320")), 800))
STOCK_HISTORY_LOOKBACK_DAYS = max(220, min(int(os.environ.get("KOMO_STOCK_HISTORY_LOOKBACK_DAYS", "460")), 1460))


def now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        if isinstance(value, float) and math.isnan(value):
            return None
        text = str(value).replace(",", "").replace("%", "").strip()
        if text in {"", "-", "nan", "None", "NoneType"}:
            return None
        return float(text)
    except Exception:
        return None


def safe_int(value: Any) -> int:
    number = safe_float(value)
    return int(number) if number is not None else 0


def first(row: dict[str, Any], names: list[str], default: Any = None) -> Any:
    for name in names:
        if name in row and row[name] not in (None, ""):
            return row[name]
    return default


def df_rows(df: Any, limit: int | None = None) -> list[dict[str, Any]]:
    if df is None:
        return []
    if limit:
        df = df.head(limit)
    return df.where(df.notnull(), None).to_dict("records")


def call_source(fn: Callable[[], Any]) -> Any:
    # Some AkShare functions print progress text; keep stdout as clean JSON.
    with contextlib.redirect_stdout(io.StringIO()):
        return fn()


def module_status(status: dict[str, Any], key: str, ok: bool, source: str, rows: int = 0, message: str = "") -> None:
    status[key] = {
        "ok": ok,
        "sourceName": source,
        "rows": rows,
        "message": message or ("可用" if ok else "不可用"),
    }


def field_completeness(rows: list[dict[str, Any]], fields: list[str]) -> float:
    if not rows or not fields:
        return 0
    sample = rows[: min(len(rows), 1500)]
    total = len(sample) * len(fields)
    present = 0
    for row in sample:
        for field in fields:
            value = first(row, [field])
            if safe_float(value) is not None:
                present += 1
    return present / total if total else 0


def import_akshare(status: dict[str, Any]) -> Any | None:
    try:
        import akshare as ak  # type: ignore

        status["akshare"] = {"ok": True, "sourceName": "AkShare", "rows": 0, "message": "可用"}
        return ak
    except Exception as exc:
        status["akshare"] = {"ok": False, "sourceName": "AkShare", "rows": 0, "message": f"未安装或不可用: {exc}"}
        return None


def collect_futu_context(status: dict[str, Any]) -> Any | None:
    if os.environ.get("FUTU_ENABLED", "1") == "0":
        return None
    try:
        logging.disable(logging.CRITICAL)
        import futu  # type: ignore
        host = os.environ.get("FUTU_HOST", "127.0.0.1")
        port = int(os.environ.get("FUTU_PORT", "11111"))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ctx = futu.OpenQuoteContext(host=host, port=port)
        status["futu"] = {"ok": True, "sourceName": "Futu OpenD", "rows": 0, "message": f"已连接 {host}:{port}"}
        return ctx
    except Exception as exc:
        status["futu"] = {"ok": False, "sourceName": "Futu OpenD", "rows": 0, "message": str(exc)}
        return None


def futu_frame_rows(data: Any) -> list[dict[str, Any]]:
    return df_rows(data) if data is not None else []


def futu_change(row: dict[str, Any]) -> float | None:
    direct = safe_float(first(row, ["change_rate", "涨跌幅"]))
    if direct is not None:
        return direct
    last = safe_float(first(row, ["last_price"]))
    previous = safe_float(first(row, ["prev_close_price"]))
    return (last - previous) / previous * 100 if last is not None and previous else None


def collect_futu_intraday_trends(ctx: Any, futu: Any, index_specs: list[tuple[str, str, str]], status: dict[str, Any]) -> list[dict[str, Any]]:
    """Read today's 1-minute index K-lines so the chart can start at the real open."""
    today = datetime.now().strftime("%Y-%m-%d")
    trends: list[dict[str, Any]] = []
    for futu_code, name, code in index_specs:
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                ret, message = ctx.subscribe([futu_code], [futu.SubType.K_1M])
            if ret != futu.RET_OK:
                continue
            ret, data = ctx.get_cur_kline(futu_code, 1000, futu.KLType.K_1M, futu.AuType.NONE)
            if ret != futu.RET_OK:
                continue
            points = []
            for row in futu_frame_rows(data):
                time_key = str(row.get("time_key") or row.get("time") or "")
                if not time_key.startswith(today):
                    continue
                close = safe_float(row.get("close"))
                if close is None:
                    continue
                last_close = safe_float(row.get("last_close"))
                change_pct = (close - last_close) / last_close * 100 if last_close else None
                points.append({
                    "time": time_key[5:16],
                    "value": close,
                    "open": safe_float(row.get("open")),
                    "high": safe_float(row.get("high")),
                    "low": safe_float(row.get("low")),
                    "close": close,
                    "volume": safe_float(row.get("volume")),
                    "amount": safe_float(row.get("turnover")),
                    "change_pct": change_pct,
                    "market_time": time_key,
                    "fetched_at": now_iso(),
                })
            if points:
                trends.append({"name": name, "code": code, "region": "A股", "source_name": "Futu OpenD 1分钟K线", "points": points})
        except Exception as exc:
            status[f"intraday_{code}"] = {"ok": False, "sourceName": "Futu OpenD 1分钟K线", "rows": 0, "message": str(exc)}
    if trends:
        status["intraday"] = {"ok": True, "sourceName": "Futu OpenD 1分钟K线", "rows": sum(len(item["points"]) for item in trends), "message": "今日分时K线已补齐"}
    return trends


def futu_market_code(code: str) -> str:
    return normalize_stock_code(code)


def collect_futu_ashare(status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"markets": [], "stocks": [], "trends": [], "sources": {}}
    try:
        import futu  # type: ignore
    except Exception:
        return result
    ctx = collect_futu_context(status)
    if ctx is None:
        return result
    try:
        index_specs = [
            ("SH.000001", "上证指数", "000001.SH"),
            ("SZ.399001", "深证成指", "399001.SZ"),
            ("SZ.399006", "创业板指", "399006.SZ"),
            ("SH.000300", "沪深300", "000300.SH"),
            ("SH.000688", "科创50", "000688.SH"),
        ]
        ret, data = ctx.get_market_snapshot([item[0] for item in index_specs])
        if ret == futu.RET_OK:
            by_code = {str(row.get("code")): row for row in futu_frame_rows(data)}
            indexes = []
            for futu_code, name, code in index_specs:
                row = by_code.get(futu_code)
                if not row:
                    continue
                change = futu_change(row) or 0
                indexes.append({
                    "name": name,
                    "code": code,
                    "value": safe_float(first(row, ["last_price"])) or 0,
                    "change_pct": change,
                    "change_point": (safe_float(first(row, ["last_price"])) or 0) - (safe_float(first(row, ["prev_close_price"])) or 0),
                    "trend": trend_label(change),
                    "updated_at": first(row, ["update_time"]) or now_iso(),
                    "windows": window_guess(change),
                    "source_name": "Futu OpenD",
                })
            if indexes:
                result["markets"] = [{"region": "A股", "mood": "real", "indexes": indexes}]

        result["trends"] = collect_futu_intraday_trends(ctx, futu, index_specs, status)

        stock_codes_by_market: dict[str, list[str]] = {"SH": [], "SZ": []}
        names: dict[str, str] = {}
        for market in [futu.Market.SH, futu.Market.SZ]:
            ret, basic = ctx.get_stock_basicinfo(market, futu.SecurityType.STOCK)
            if ret != futu.RET_OK:
                continue
            for row in futu_frame_rows(basic):
                code = str(row.get("code") or "")
                if code and not bool(row.get("delisting")):
                    market_key = "SH" if code.upper().startswith("SH.") else "SZ"
                    stock_codes_by_market[market_key].append(code)
                    names[code] = str(row.get("name") or code)
        # Keep the high-frequency snapshot bounded, but do not let SH codes crowd out SZ.
        stock_codes = stock_codes_by_market["SH"][:600] + stock_codes_by_market["SZ"][:600]
        stocks = []
        for start in range(0, len(stock_codes), 400):
            ret, snapshot = ctx.get_market_snapshot(stock_codes[start : start + 400])
            if ret != futu.RET_OK:
                continue
            for row in futu_frame_rows(snapshot):
                code = futu_market_code(str(row.get("code") or ""))
                if not code:
                    continue
                price = safe_float(row.get("last_price")) or 0
                if price <= 0:
                    continue
                change = futu_change(row) or 0
                stocks.append({
                    "code": code,
                    "name": str(row.get("name") or names.get(str(row.get("code")), code)),
                    "sector": "暂无",
                    "volume_ratio": safe_float(row.get("volume_ratio")),
                    "turnover_rate": safe_float(row.get("turnover_rate")),
                    "change_pct": change,
                    "amount": safe_float(row.get("turnover")) or 0,
                    "float_market_cap": safe_float(row.get("circular_market_val")) or 0,
                    "market_cap": safe_float(row.get("total_market_val")) or 0,
                    "price": price,
                    "amplitude": safe_float(row.get("amplitude")),
                    "update_time": str(row.get("update_time") or datetime.now().strftime("%H:%M")),
                    "source_name": "Futu OpenD",
                    "data_quality": field_completeness([row], ["volume_ratio", "turnover_rate", "circular_market_val", "total_market_val", "amplitude"]),
                })
        result["stocks"] = stocks
        result["sources"] = {"markets": "Futu OpenD", "stocks": "Futu OpenD", "trends": "Futu OpenD 1分钟K线"}
        module_status(status, "ashare_futu", bool(indexes or stocks), "Futu OpenD", len(indexes) + len(stocks), "Futu A股行情刷新完成")
    except Exception as exc:
        status["ashare_futu"] = {"ok": False, "sourceName": "Futu OpenD", "rows": 0, "message": str(exc)}
    finally:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ctx.close()
    return result


def collect_futu_etf(status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"etfs": [], "sources": {}}
    try:
        import futu  # type: ignore
    except Exception:
        return result
    ctx = collect_futu_context(status)
    if ctx is None:
        return result
    try:
        codes: list[str] = []
        names: dict[str, str] = {}
        for market in [futu.Market.SH, futu.Market.SZ]:
            ret, basic = ctx.get_stock_basicinfo(market, futu.SecurityType.ETF)
            if ret != futu.RET_OK:
                continue
            for row in futu_frame_rows(basic):
                code = str(row.get("code") or "")
                if code and not bool(row.get("delisting")):
                    codes.append(code)
                    names[code] = str(row.get("name") or code)
        etfs = []
        # 不截断前 300 个代码，避免 588xxx 等后段 ETF 永远无法进入行情池。
        for start in range(0, len(codes), 400):
            ret, snapshot = ctx.get_market_snapshot(codes[start : start + 400])
            if ret != futu.RET_OK:
                continue
            for row in futu_frame_rows(snapshot):
                code = futu_market_code(str(row.get("code") or ""))
                if not code:
                    continue
                price = safe_float(row.get("last_price")) or 0
                if price <= 0:
                    continue
                change = futu_change(row) or 0
                name = str(row.get("name") or names.get(str(row.get("code")), code))
                etfs.append({
                    "code": code,
                    "name": name,
                    "category": etf_category(name),
                    "price": price,
                    "change_pct": change,
                    "amount": safe_float(row.get("turnover")) or 0,
                    "net_inflow": None,
                    "volume_ratio": safe_float(row.get("volume_ratio")),
                    "turnover_rate": safe_float(row.get("turnover_rate")),
                    "float_market_cap": safe_float(row.get("circular_market_val")) or 0,
                    "market_cap": safe_float(row.get("total_market_val")) or 0,
                    "tracking": name.replace("ETF", ""),
                    "update_time": str(row.get("update_time") or datetime.now().strftime("%H:%M")),
                    "source_name": "Futu OpenD",
                })
        result["etfs"] = etfs
        result["sources"] = {"etfs": "Futu OpenD"}
        module_status(status, "etf_futu", bool(etfs), "Futu OpenD", len(etfs), "Futu ETF行情刷新完成")
    except Exception as exc:
        status["etf_futu"] = {"ok": False, "sourceName": "Futu OpenD", "rows": 0, "message": str(exc)}
    finally:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ctx.close()
    return result


def collect_futu_security_master(status: dict[str, Any]) -> list[dict[str, Any]]:
    """Read the full A-share and ETF directory without creating full-market quote snapshots."""
    try:
        import futu  # type: ignore
    except Exception as exc:
        module_status(status, "securities_futu", False, "Futu OpenD证券目录", 0, str(exc))
        return []
    ctx = collect_futu_context(status)
    if ctx is None:
        return []
    rows: list[dict[str, Any]] = []
    try:
        for market in [futu.Market.SH, futu.Market.SZ]:
            for security_type, label in [(futu.SecurityType.STOCK, "stock"), (futu.SecurityType.ETF, "etf")]:
                ret, basic = ctx.get_stock_basicinfo(market, security_type)
                if ret != futu.RET_OK:
                    continue
                for row in futu_frame_rows(basic):
                    raw_code = str(row.get("code") or "")
                    name = str(row.get("name") or "").strip()
                    code = futu_market_code(raw_code)
                    if not code or not name or bool(row.get("delisting")):
                        continue
                    rows.append({
                        "code": code,
                        "name": name,
                        "market": "ETF" if label == "etf" else "A股",
                        "security_type": label,
                        "source": "Futu OpenD证券目录",
                        "updated_at": now_iso(),
                    })
        unique = {item["code"]: item for item in rows}
        rows = list(unique.values())
        module_status(status, "securities_futu", bool(rows), "Futu OpenD证券目录", len(rows), "沪深股票和ETF目录刷新完成" if rows else "未获取到证券目录")
    except Exception as exc:
        module_status(status, "securities_futu", False, "Futu OpenD证券目录", 0, str(exc))
    finally:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ctx.close()
    return rows


def collect_futu_security_quote(status: dict[str, Any], code: str, security_type: str = "stock") -> dict[str, Any] | None:
    """Fetch one searched security on demand; this never expands the full realtime snapshot."""
    try:
        import futu  # type: ignore
    except Exception as exc:
        module_status(status, "security_quote", False, "Futu OpenD按需行情", 0, str(exc))
        return None
    normalized = normalize_stock_code(code)
    digits = re.sub(r"\D", "", normalized)
    if len(digits) != 6:
        module_status(status, "security_quote", False, "Futu OpenD按需行情", 0, "证券代码格式无效")
        return None
    prefix = "SH" if normalized.lower().startswith("sh") or digits.startswith(("5", "6", "9")) else "SZ"
    futu_code = f"{prefix}.{digits}"
    ctx = collect_futu_context(status)
    if ctx is None:
        return None
    try:
        ret, data = ctx.get_market_snapshot([futu_code])
        if ret != futu.RET_OK:
            module_status(status, "security_quote", False, "Futu OpenD按需行情", 0, str(data))
            return None
        row = futu_frame_rows(data)[0] if futu_frame_rows(data) else None
        if not row:
            module_status(status, "security_quote", False, "Futu OpenD按需行情", 0, "未返回行情")
            return None
        price = safe_float(row.get("last_price"))
        if price is None or price <= 0:
            module_status(status, "security_quote", False, "Futu OpenD按需行情", 0, "当前无有效价格")
            return None
        quote = {
            "code": futu_market_code(str(row.get("code") or futu_code)),
            "name": str(row.get("name") or digits),
            "market": "ETF" if security_type == "etf" else "A股",
            "price": price,
            "change_pct": futu_change(row),
            "amount": safe_float(row.get("turnover")),
            "volume_ratio": safe_float(row.get("volume_ratio")),
            "turnover_rate": safe_float(row.get("turnover_rate")),
            "float_market_cap": safe_float(row.get("circular_market_val")),
            "market_cap": safe_float(row.get("total_market_val")),
            "amplitude": safe_float(row.get("amplitude")),
            "update_time": str(row.get("update_time") or datetime.now().strftime("%H:%M")),
            "source_name": "Futu OpenD按需行情",
        }
        module_status(status, "security_quote", True, "Futu OpenD按需行情", 1, "单票实时行情已获取")
        return quote
    except Exception as exc:
        module_status(status, "security_quote", False, "Futu OpenD按需行情", 0, str(exc))
        return None
    finally:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ctx.close()


def collect_futu_security_quotes(status: dict[str, Any], codes: list[str]) -> list[dict[str, Any]]:
    """Fetch a bounded candidate batch for paper trading after coarse filtering."""
    try:
        import futu  # type: ignore
    except Exception as exc:
        module_status(status, "security_quotes", False, "Futu OpenD候选行情", 0, str(exc))
        return []
    normalized: list[str] = []
    for raw_code in codes:
        code = normalize_stock_code(raw_code)
        digits = re.sub(r"\D", "", code)
        if len(digits) != 6:
            continue
        prefix = "SH" if code.lower().startswith("sh") or digits.startswith(("5", "6", "9")) else "SZ"
        futu_code = f"{prefix}.{digits}"
        if futu_code not in normalized:
            normalized.append(futu_code)
    normalized = normalized[:100]
    if not normalized:
        module_status(status, "security_quotes", False, "Futu OpenD候选行情", 0, "没有有效候选代码")
        return []
    ctx = collect_futu_context(status)
    if ctx is None:
        return []
    try:
        ret, data = ctx.get_market_snapshot(normalized)
        if ret != futu.RET_OK:
            module_status(status, "security_quotes", False, "Futu OpenD候选行情", 0, str(data))
            return []
        quotes: list[dict[str, Any]] = []
        for row in futu_frame_rows(data):
            price = safe_float(row.get("last_price"))
            if price is None or price <= 0:
                continue
            quotes.append({
                "code": futu_market_code(str(row.get("code") or "")),
                "name": str(row.get("name") or ""),
                "price": price,
                "change_pct": futu_change(row),
                "amount": safe_float(row.get("turnover")),
                "volume_ratio": safe_float(row.get("volume_ratio")),
                "turnover_rate": safe_float(row.get("turnover_rate")),
                "float_market_cap": safe_float(row.get("circular_market_val")),
                "market_cap": safe_float(row.get("total_market_val")),
                "amplitude": safe_float(row.get("amplitude")),
                "update_time": str(row.get("update_time") or datetime.now().strftime("%H:%M")),
                "source_name": "Futu OpenD候选行情",
            })
        module_status(status, "security_quotes", bool(quotes), "Futu OpenD候选行情", len(quotes), "候选实时行情已获取" if quotes else "候选未返回有效行情")
        return quotes
    except Exception as exc:
        module_status(status, "security_quotes", False, "Futu OpenD候选行情", 0, str(exc))
        return []
    finally:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ctx.close()


def collect_ashare(status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"markets": [], "stocks": [], "trends": [], "sources": {}}
    futu_result = collect_futu_ashare(status)
    if futu_result["markets"] and futu_result["stocks"]:
        return futu_result
    ak = import_akshare(status)
    if ak is None:
        module_status(status, "ashare", False, "AkShare", 0, "AkShare 不可用")
        return result

    index_rows = []
    index_source = ""
    for source_name, fn_name in [("新浪指数", "stock_zh_index_spot_sina"), ("东财指数", "stock_zh_index_spot_em")]:
        try:
            df = call_source(lambda fn_name=fn_name: getattr(ak, fn_name)())
            rows = df_rows(df)
            if rows:
                index_rows = rows
                index_source = source_name
                break
        except Exception as exc:
            status[f"ashare_index_{source_name}"] = {"ok": False, "sourceName": source_name, "rows": 0, "message": str(exc)}

    wanted = {
        "上证指数": "000001.SH",
        "深证成指": "399001.SZ",
        "创业板指": "399006.SZ",
        "沪深300": "000300.SH",
        "科创50": "000688.SH",
    }
    indexes = []
    for row in index_rows:
        name = str(first(row, ["名称", "指数名称"], ""))
        if name not in wanted:
            continue
        change = safe_float(first(row, ["涨跌幅", "涨跌幅%"])) or 0
        code = str(first(row, ["代码", "指数代码"], wanted[name]))
        indexes.append(
            {
                "name": name,
                "code": normalize_index_code(name, code),
                "value": safe_float(first(row, ["最新价", "最新点位", "今收"])) or 0,
                "change_pct": change,
                "change_point": safe_float(first(row, ["涨跌额", "涨跌"])) or 0,
                "trend": trend_label(change),
                "updated_at": now_iso(),
                "windows": window_guess(change),
                "source_name": index_source,
            }
        )

    if indexes:
        result["markets"].append({"region": "A股", "mood": "real", "indexes": indexes})

    stock_rows = []
    stock_source = ""
    stock_quality = 0.0
    stock_candidates: list[tuple[str, list[dict[str, Any]], float]] = []
    for source_name, fn in [
        ("东财A股", lambda: df_rows(call_source(ak.stock_zh_a_spot_em), 1200)),
        ("东财A股直连", lambda: collect_eastmoney_stocks(limit=1200)),
        ("新浪A股+腾讯增强", lambda: enrich_stocks_with_tencent(df_rows(call_source(ak.stock_zh_a_spot), 1200))),
        ("新浪A股", lambda: df_rows(call_source(ak.stock_zh_a_spot), 1200)),
    ]:
        try:
            rows = fn()
            if rows:
                quality = field_completeness(rows, ["量比", "换手率", "流通市值", "总市值", "振幅"])
                stock_candidates.append((source_name, rows, quality))
                status[f"ashare_stocks_{source_name}"] = {
                    "ok": True,
                    "sourceName": source_name,
                    "rows": len(rows),
                    "message": f"字段完整度 {quality:.0%}",
                }
        except Exception as exc:
            status[f"ashare_stocks_{source_name}"] = {"ok": False, "sourceName": source_name, "rows": 0, "message": str(exc)}

    if stock_candidates:
        stock_source, stock_rows, stock_quality = sorted(stock_candidates, key=lambda item: (item[2], len(item[1])), reverse=True)[0]

    stocks = []
    for row in stock_rows:
        code = normalize_stock_code(str(first(row, ["代码"], "")))
        name = str(first(row, ["名称"], ""))
        if not code or not name:
            continue
        stocks.append(
            {
                "code": code,
                "name": name,
                "sector": str(first(row, ["板块", "所属行业"], "暂无")),
                "volume_ratio": safe_float(first(row, ["量比"])),
                "turnover_rate": safe_float(first(row, ["换手率"])),
                "change_pct": safe_float(first(row, ["涨跌幅"])) or 0,
                "amount": safe_float(first(row, ["成交额"])) or 0,
                "float_market_cap": safe_float(first(row, ["流通市值"])) or 0,
                "market_cap": safe_float(first(row, ["总市值"])) or 0,
                "price": safe_float(first(row, ["最新价"])) or 0,
                "amplitude": safe_float(first(row, ["振幅"])),
                "update_time": datetime.now().strftime("%H:%M"),
                "source_name": stock_source,
                "data_quality": round(stock_quality, 4),
            }
        )

    result["stocks"] = stocks
    result["sources"] = {"markets": index_source, "stocks": stock_source}
    module_status(
        status,
        "ashare",
        bool(indexes or stocks),
        " / ".join([item for item in [index_source, stock_source] if item]) or "AkShare",
        len(indexes) + len(stocks),
        f"A股指数和股票池刷新完成，股票字段完整度 {stock_quality:.0%}" if indexes or stocks else "未获取到 A 股数据",
    )
    return result


def collect_etf(status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"etfs": [], "sources": {}}
    futu_result = collect_futu_etf(status)
    if futu_result["etfs"]:
        return futu_result
    ak = import_akshare(status)
    if ak is None:
        module_status(status, "etf", False, "东财ETF", 0, "AkShare 不可用")
        return result

    try:
        df = call_source(ak.fund_etf_spot_em)
        etfs = []
        for row in df_rows(df, 2000):
            name = str(first(row, ["名称"], ""))
            code = normalize_etf_code(str(first(row, ["代码"], "")))
            if not code or not name:
                continue
            etfs.append(
                {
                    "code": code,
                    "name": name,
                    "category": etf_category(name),
                    "price": safe_float(first(row, ["最新价"])) or 0,
                    "change_pct": safe_float(first(row, ["涨跌幅"])) or 0,
                    "amount": safe_float(first(row, ["成交额"])) or 0,
                    "net_inflow": safe_float(first(row, ["主力净流入", "主力净流入-净额", "净流入"])) or 0,
                    "volume_ratio": safe_float(first(row, ["量比"])),
                    "turnover_rate": safe_float(first(row, ["换手率"])),
                    "float_market_cap": safe_float(first(row, ["流通市值"])) or 0,
                    "market_cap": safe_float(first(row, ["总市值"])) or 0,
                    "tracking": name.replace("ETF", ""),
                    "update_time": datetime.now().strftime("%H:%M"),
                    "source_name": "东财ETF",
                }
            )
        result["etfs"] = etfs
        result["sources"] = {"etfs": "东财ETF"}
        module_status(status, "etf", bool(etfs), "东财ETF", len(etfs), "ETF 行情刷新完成" if etfs else "未获取到 ETF 数据")
    except Exception as exc:
        module_status(status, "etf", False, "东财ETF", 0, str(exc))
    return result


def collect_eastmoney_stocks(limit: int = 1200) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page_size = 100
    pages = max(1, math.ceil(limit / page_size))
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://quote.eastmoney.com/center/gridlist.html",
        "Accept": "application/json,text/plain,*/*",
    }
    fields = "f2,f3,f4,f5,f6,f7,f8,f10,f12,f14,f20,f21,f100,f124"
    fs = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048"
    for page in range(1, pages + 1):
        params = {
            "pn": page,
            "pz": page_size,
            "po": 1,
            "np": 1,
            "ut": "bd1d9ddb04089700cf9c27f6f7426281",
            "fltt": 2,
            "invt": 2,
            "fid": "f3",
            "fs": fs,
            "fields": fields,
        }
        url = "https://push2.eastmoney.com/api/qt/clist/get?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8", errors="ignore"))
        diff = payload.get("data", {}).get("diff") or []
        if not diff:
            break
        for item in diff:
            code = str(item.get("f12") or "")
            rows.append(
                {
                    "代码": normalize_stock_code(code),
                    "名称": item.get("f14"),
                    "最新价": item.get("f2"),
                    "涨跌幅": item.get("f3"),
                    "涨跌额": item.get("f4"),
                    "成交量": item.get("f5"),
                    "成交额": item.get("f6"),
                    "振幅": item.get("f7"),
                    "换手率": item.get("f8"),
                    "量比": item.get("f10"),
                    "总市值": item.get("f20"),
                    "流通市值": item.get("f21"),
                    "板块": item.get("f100") or "暂无",
                    "更新时间": item.get("f124"),
                }
            )
            if len(rows) >= limit:
                return rows
        time.sleep(0.2)
    return rows


def enrich_stocks_with_tencent(rows: list[dict[str, Any]], batch_size: int = 80) -> list[dict[str, Any]]:
    if not rows:
        return rows
    by_code: dict[str, dict[str, Any]] = {}
    query_codes = []
    for row in rows:
        code = normalize_stock_code(str(first(row, ["代码"], "")))
        if not code or code.startswith("bj"):
            continue
        by_code[code] = row
        query_codes.append(code)

    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://finance.qq.com/"}
    for start in range(0, len(query_codes), batch_size):
        batch = query_codes[start : start + batch_size]
        if not batch:
            continue
        url = "https://qt.gtimg.cn/q=" + ",".join(batch)
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=10) as response:
                text = response.read().decode("gbk", errors="ignore")
        except Exception:
            continue
        for part in text.strip().split(";"):
            if '="' not in part:
                continue
            var_name, raw = part.split('="', 1)
            query_code = var_name.replace("v_", "").strip()
            data = raw.rstrip('"').split("~")
            if len(data) < 50:
                continue
            row = by_code.get(query_code)
            if not row:
                continue
            row["代码"] = query_code
            row["名称"] = data[1] or first(row, ["名称"], "")
            row["最新价"] = data[3]
            row["涨跌额"] = data[31]
            row["涨跌幅"] = data[32]
            row["成交量"] = data[36]
            row["成交额"] = safe_float(data[37]) * 10000 if safe_float(data[37]) is not None else first(row, ["成交额"])
            row["换手率"] = data[38]
            row["振幅"] = data[43]
            row["总市值"] = safe_float(data[44]) * 100000000 if safe_float(data[44]) is not None else first(row, ["总市值"])
            row["流通市值"] = safe_float(data[45]) * 100000000 if safe_float(data[45]) is not None else first(row, ["流通市值"])
            row["量比"] = data[49]
            row["更新时间"] = data[30]
        time.sleep(0.15)
    return rows


def collect_sector(status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"sectorFlows": [], "sources": {}}
    ak = import_akshare(status)
    if ak is None:
        module_status(status, "sector", False, "AkShare板块", 0, "AkShare 不可用")
        return result

    rows = []
    source = ""
    for source_name, fn in [
        ("同花顺板块", lambda: ak.stock_board_industry_summary_ths()),
        ("东财板块资金流", lambda: ak.stock_sector_fund_flow_rank(indicator="今日")),
    ]:
        try:
            df = call_source(fn)
            got = df_rows(df, 60)
            if got:
                rows = got
                source = source_name
                break
        except Exception as exc:
            status[f"sector_{source_name}"] = {"ok": False, "sourceName": source_name, "rows": 0, "message": str(exc)}

    flows = [normalize_sector_row(row, source, "industry") for row in rows]
    flows = [row for row in flows if row]

    # Concept boards are collected separately. Failure must not block the industry board.
    concept_rows: list[dict[str, Any]] = []
    concept_errors: list[str] = []
    for source_name, fn in [
        ("东财概念板块", lambda: ak.stock_board_concept_name_em()),
        ("同花顺概念板块", lambda: ak.stock_board_concept_name_ths()),
    ]:
        if concept_rows:
            break
        try:
            concept_rows = df_rows(call_source(fn), 120)
            if concept_rows:
                flows.extend([row for row in [normalize_sector_row(row, source_name, "concept") for row in concept_rows] if row])
                status["sector_concept"] = {"ok": True, "sourceName": source_name, "rows": len(concept_rows), "message": "概念板块刷新完成"}
        except Exception as exc:
            concept_errors.append(f"{source_name}: {exc}")
    if not concept_rows:
        status["sector_concept"] = {"ok": False, "sourceName": "东财/同花顺概念板块", "rows": 0, "message": "；".join(concept_errors) or "概念板块不可用"}

    # Theme data is a separate namespace. The THS summary is a public theme/event
    # catalogue; fields unavailable from the source remain null and are not inferred.
    try:
        theme_rows = df_rows(call_source(lambda: ak.stock_board_concept_summary_ths()), 120)
        theme_rows = [
            {"概念名称": row.get("概念名称"), "驱动事件": row.get("驱动事件"), "龙头股": row.get("龙头股")}
            for row in theme_rows
            if row.get("概念名称")
        ]
        flows.extend([row for row in [normalize_sector_row(row, "同花顺主题事件", "theme") for row in theme_rows] if row])
        status["sector_theme"] = {"ok": bool(theme_rows), "sourceName": "同花顺主题事件", "rows": len(theme_rows), "message": "主题目录刷新完成" if theme_rows else "暂无主题目录"}
    except Exception as exc:
        status["sector_theme"] = {"ok": False, "sourceName": "同花顺主题事件", "rows": 0, "message": str(exc)}

    result["sectorFlows"] = flows
    result["sources"] = {"sectorFlows": source}
    module_status(status, "sector", bool(flows), source or "AkShare板块", len(flows), "板块资金刷新完成" if flows else "未获取到板块资金数据")
    return result


def normalize_sector_row(row: dict[str, Any], source: str, sector_type: str) -> dict[str, Any] | None:
        name = str(first(row, ["板块", "名称", "行业", "概念名称", "name"], ""))
        if not name:
            return None
        leader = str(first(row, ["领涨股", "龙头股", "驱动事件"], ""))
        return {
            "name": name,
            "type": sector_type,
            "change_pct": safe_float(first(row, ["涨跌幅", "今日涨跌幅"])),
            "net_inflow": safe_float(first(row, ["净流入", "今日主力净流入-净额", "主力净流入-净额"])),
            "amount": safe_float(first(row, ["成交额", "总成交额", "成交金额"])),
            "up_count": safe_int(first(row, ["上涨家数"])),
            "down_count": safe_int(first(row, ["下跌家数"])),
            "leaders": [leader] if leader else [],
            "signal": "资金流" if sector_type == "industry" else ("主题事件" if sector_type == "theme" else "概念板块"),
            "updated_at": now_iso(),
            "source_name": source,
        }


def collect_history(status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"history": [], "sources": {}}
    ak = import_akshare(status)
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    futu_rows = collect_history_futu(status)
    rows.extend(futu_rows)
    if not rows:
        rows.extend(collect_history_baostock(status))
    if not futu_rows:
        rows.extend(collect_history_eastmoney(status))
    if ak is not None and os.environ.get("KOMO_ENABLE_AK_HISTORY") == "1":
        rows.extend(collect_index_history_ak(ak, errors))
        rows.extend(collect_etf_history_ak(ak, errors))
        rows.extend(collect_sector_history_ak(ak, errors))
    elif ak is not None:
        status["history_akshare"] = {"ok": False, "sourceName": "AkShare历史", "rows": 0, "message": "AkShare历史补充默认关闭，优先使用东方财富K线"}
    if os.environ.get("KOMO_ENABLE_YFINANCE_HISTORY") == "1":
        rows.extend(collect_global_history_yfinance(status))
    else:
        status["history_yfinance"] = {"ok": False, "sourceName": "yfinance", "rows": 0, "message": "海外历史默认跳过，避免免费源阻塞；可后续单独启用"}
    result["history"] = rows
    source_label = history_source_label(rows)
    result["sources"] = {"history": source_label if rows else "历史数据"}
    failure_messages = [
        status.get("history_eastmoney", {}).get("message", ""),
        status.get("history_baostock", {}).get("message", ""),
        *errors[:3],
    ]
    module_status(status, "history", bool(rows), result["sources"]["history"], len(rows), "历史行情刷新完成" if rows else "; ".join([msg for msg in failure_messages if msg]) or "未获取到历史行情")
    return result


def collect_history_futu(status: dict[str, Any]) -> list[dict[str, Any]]:
    ctx = collect_futu_context(status)
    if ctx is None:
        return []
    specs = [
        ("index", "SH.000001", "000001.SH", "上证指数"),
        ("index", "SZ.399001", "399001.SZ", "深证成指"),
        ("index", "SZ.399006", "399006.SZ", "创业板指"),
        ("index", "SH.000300", "000300.SH", "沪深300"),
        ("index", "SH.000688", "000688.SH", "科创50"),
        ("etf", "SH.510300", "510300", "沪深300ETF"),
        ("etf", "SH.510500", "510500", "中证500ETF"),
        ("etf", "SZ.159915", "159915", "创业板ETF"),
        ("etf", "SH.588000", "588000", "科创50ETF"),
        ("etf", "SZ.513100", "513100", "纳指ETF"),
    ]
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    start = os.environ.get("FUTU_HISTORY_START", "2024-01-01")
    end = datetime.now().strftime("%Y-%m-%d")
    try:
        import futu  # type: ignore
        ret, quota_data = ctx.get_history_kl_quota(get_detail=True)
        if isinstance(quota_data, (tuple, list)):
            quota = quota_data[0] if quota_data else 0
        else:
            quota = quota_data
        if ret != futu.RET_OK or int(quota or 0) < len(specs):
            status["history_futu"] = {"ok": False, "sourceName": "Futu OpenD历史", "rows": 0, "message": f"历史K线额度不足或查询失败，剩余 {quota}"}
            return []
        for item_type, futu_code, code, name in specs:
            try:
                ret, data, _page_key = ctx.request_history_kline(
                    futu_code,
                    start=start,
                    end=end,
                    ktype=futu.KLType.K_DAY,
                    autype=futu.AuType.QFQ,
                    max_count=1000,
                )
                if ret != futu.RET_OK:
                    errors.append(f"{code}:返回失败")
                    continue
                for row in futu_frame_rows(data):
                    close = safe_float(row.get("close"))
                    date = str(row.get("time_key") or "")[:10]
                    if close is None or not date:
                        continue
                    rows.append({
                        "type": item_type,
                        "code": code,
                        "name": name,
                        "date": date,
                        "open": safe_float(row.get("open")),
                        "close": close,
                        "high": safe_float(row.get("high")),
                        "low": safe_float(row.get("low")),
                        "volume": safe_float(row.get("volume")),
                        "amount": safe_float(row.get("turnover")),
                        "change_pct": safe_float(row.get("change_rate")),
                        "source": "Futu OpenD历史",
                        "fetched_at": now_iso(),
                    })
            except Exception as exc:
                errors.append(f"{code}:{exc}")
        status["history_futu"] = {"ok": bool(rows), "sourceName": "Futu OpenD历史", "rows": len(rows), "message": "Futu历史K线刷新完成" if rows else "; ".join(errors[:3])}
        return rows
    except Exception as exc:
        status["history_futu"] = {"ok": False, "sourceName": "Futu OpenD历史", "rows": 0, "message": str(exc)}
        return []
    finally:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ctx.close()


def collect_stock_history(status: dict[str, Any], query_code: str) -> dict[str, Any]:
    """按需补单只股票或ETF约一年日K，只服务持仓和策略候选。"""
    code = normalize_stock_code(str(query_code or ""))
    digits = re.sub(r"\D", "", code)
    if len(digits) != 6:
        module_status(status, "stock_history", False, "股票历史", 0, "代码格式无法识别")
        return {"history": [], "sources": {"history": "股票历史"}}
    # 5xx/9xx are Shanghai-listed ETFs/funds; treating them as Shenzhen makes
    # Tencent's K-line endpoint return an empty or unrelated series.
    prefix = "SH" if code.startswith("sh") or digits.startswith(("5", "6", "9")) else "SZ" if code.startswith("sz") or digits.startswith(("0", "3")) else "BJ"
    internal_code = f"{digits}.{prefix}"
    futu_code = f"{prefix}.{digits}"
    # MA60 and回测需要足够已完成交易日；仍然只为持仓和粗筛候选按需拉取。
    start = (datetime.now() - timedelta(days=STOCK_HISTORY_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    end = datetime.now().strftime("%Y-%m-%d")

    ctx = collect_futu_context(status)
    if ctx is not None:
        try:
            import futu  # type: ignore
            ret, quota_data = ctx.get_history_kl_quota(get_detail=True)
            quota = quota_data[0] if isinstance(quota_data, (tuple, list)) and quota_data else quota_data
            if ret == futu.RET_OK and int(quota or 0) > 0:
                ret, data, _page_key = ctx.request_history_kline(futu_code, start=start, end=end, ktype=futu.KLType.K_DAY, autype=futu.AuType.QFQ, max_count=STOCK_HISTORY_TARGET_BARS)
                if ret == futu.RET_OK:
                    rows = []
                    for row in futu_frame_rows(data):
                        close = safe_float(row.get("close"))
                        date = str(row.get("time_key") or "")[:10]
                        if close is None or not date:
                            continue
                        rows.append({"type": "stock", "code": code, "name": str(row.get("name") or code), "date": date, "open": safe_float(row.get("open")), "close": close, "high": safe_float(row.get("high")), "low": safe_float(row.get("low")), "volume": safe_float(row.get("volume")), "amount": safe_float(row.get("turnover")), "change_pct": safe_float(row.get("change_rate")), "source": "Futu OpenD历史", "fetched_at": now_iso()})
                    if rows:
                        module_status(status, "stock_history", True, "Futu OpenD历史", len(rows), "个股或ETF历史K线已获取")
                        return {"history": rows, "sources": {"history": "Futu OpenD历史"}}
        except Exception as exc:
            status["stock_history_futu"] = {"ok": False, "sourceName": "Futu OpenD历史", "rows": 0, "message": str(exc)}
        finally:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                ctx.close()

    try:
        rows = collect_mootdx_daily_history(code, prefix, digits)
        if rows:
            module_status(status, "stock_history", True, "通达信日K", len(rows), "个股或ETF历史K线已补齐")
            return {"history": rows, "sources": {"history": "通达信日K"}}
        status["stock_history_mootdx"] = {"ok": False, "sourceName": "通达信日K", "rows": 0, "message": "暂无历史K线"}
    except Exception as exc:
        status["stock_history_mootdx"] = {"ok": False, "sourceName": "通达信日K", "rows": 0, "message": str(exc)}

    try:
        rows = collect_tencent_daily_history(code, prefix, digits)
        if rows:
            module_status(status, "stock_history", True, "腾讯前复权日K", len(rows), "个股或ETF历史K线已补齐")
            return {"history": rows, "sources": {"history": "腾讯前复权日K"}}
        status["stock_history_tencent"] = {"ok": False, "sourceName": "腾讯前复权日K", "rows": 0, "message": "暂无历史K线"}
    except Exception as exc:
        status["stock_history_tencent"] = {"ok": False, "sourceName": "腾讯前复权日K", "rows": 0, "message": str(exc)}

    try:
        import baostock as bs  # type: ignore
        with contextlib.redirect_stdout(io.StringIO()):
            login = bs.login()
        if getattr(login, "error_code", "1") == "0":
            rows = []
            with contextlib.redirect_stdout(io.StringIO()):
                rs = bs.query_history_k_data_plus(f"{prefix.lower()}.{digits}", "date,code,open,high,low,close,volume,amount,pctChg", start_date=start, end_date=end, frequency="d", adjustflag="3")
            while rs.next():
                row = dict(zip(rs.fields, rs.get_row_data()))
                close = safe_float(row.get("close"))
                if close is not None:
                    rows.append({"type": "stock", "code": code, "name": code, "date": row.get("date"), "open": safe_float(row.get("open")), "close": close, "high": safe_float(row.get("high")), "low": safe_float(row.get("low")), "volume": safe_float(row.get("volume")), "amount": safe_float(row.get("amount")), "change_pct": safe_float(row.get("pctChg")), "source": "Baostock历史", "fetched_at": now_iso()})
            bs.logout()
            if rows:
                module_status(status, "stock_history", True, "Baostock历史", len(rows), "个股历史K线已获取")
                return {"history": rows, "sources": {"history": "Baostock历史"}}
    except Exception as exc:
        status["stock_history_baostock"] = {"ok": False, "sourceName": "Baostock历史", "rows": 0, "message": str(exc)}

    # ETF and newer A-share instruments are not consistently returned by
    # Baostock. Eastmoney provides an unauthenticated daily-K fallback here.
    # Keep it bounded so on-demand paper candidates do not grow the cache into
    # a second full-market history store.
    try:
        secid = f"1.{digits}" if prefix == "SH" else f"0.{digits}"
        rows = fetch_eastmoney_kline("stock", secid, code, code)[-STOCK_HISTORY_TARGET_BARS:]
        if rows:
            for row in rows:
                row["type"] = "stock"
                row["code"] = code
                row["source"] = "东方财富按需历史"
                row["fetched_at"] = now_iso()
            module_status(status, "stock_history", True, "东方财富按需历史", len(rows), "个股或ETF历史K线已补齐")
            return {"history": rows, "sources": {"history": "东方财富按需历史"}}
        module_status(status, "stock_history", False, "东方财富按需历史", 0, "暂无历史K线")
    except Exception as exc:
        status["stock_history_eastmoney"] = {"ok": False, "sourceName": "东方财富按需历史", "rows": 0, "message": str(exc)}
    return {"history": [], "sources": {"history": "暂无个股历史"}}


def collect_mootdx_daily_history(code: str, prefix: str, digits: str) -> list[dict[str, Any]]:
    """通达信日K作为公开源主备，连接失败后由腾讯等来源继续兜底。"""
    if prefix == "BJ":
        return []
    from mootdx.quotes import Quotes  # type: ignore
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        client = Quotes.factory(market="std")
        frame = client.bars(symbol=digits, frequency=9, start=0, offset=STOCK_HISTORY_TARGET_BARS)
    rows: list[dict[str, Any]] = []
    previous_close: float | None = None
    for row in df_rows(frame):
        close = safe_float(row.get("close"))
        date = str(row.get("datetime") or "")[:10]
        if not date or close is None:
            continue
        change_pct = (close / previous_close - 1) * 100 if previous_close else None
        rows.append({
            "type": "stock", "code": code, "name": code, "date": date,
            "open": safe_float(row.get("open")), "close": close, "high": safe_float(row.get("high")), "low": safe_float(row.get("low")),
            "volume": safe_float(row.get("volume") or row.get("vol")), "amount": safe_float(row.get("amount")), "change_pct": change_pct,
            "source": "通达信日K", "fetched_at": now_iso(),
        })
        previous_close = close
    return rows[-STOCK_HISTORY_TARGET_BARS:]


def collect_tencent_daily_history(code: str, prefix: str, digits: str) -> list[dict[str, Any]]:
    """Read a bounded daily adjusted series from Tencent as a low-friction fallback."""
    symbol = f"{prefix.lower()}{digits}"
    query = urllib.parse.urlencode({"param": f"{symbol},day,,,{STOCK_HISTORY_TARGET_BARS},qfq"})
    request = urllib.request.Request(
        f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?{query}",
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8", errors="ignore"))
    series = (payload.get("data") or {}).get(symbol, {}).get("qfqday") or []
    rows: list[dict[str, Any]] = []
    previous_close: float | None = None
    for item in series[-STOCK_HISTORY_TARGET_BARS:]:
        if not isinstance(item, list) or len(item) < 6:
            continue
        date = str(item[0] or "")[:10]
        close = safe_float(item[1])
        open_price = safe_float(item[2])
        high = safe_float(item[3])
        low = safe_float(item[4])
        volume = safe_float(item[5])
        if not date or close is None:
            continue
        change_pct = (close / previous_close - 1) * 100 if previous_close else None
        rows.append({
            "type": "stock", "code": code, "name": code, "date": date,
            "open": open_price, "close": close, "high": high, "low": low,
            "volume": volume, "amount": None, "change_pct": change_pct,
            "source": "腾讯前复权日K", "fetched_at": now_iso(),
        })
        previous_close = close
    return rows


def collect_history_eastmoney(status: dict[str, Any]) -> list[dict[str, Any]]:
    specs = [
        ("index", "1.000001", "000001.SH", "上证指数"),
        ("index", "0.399001", "399001.SZ", "深证成指"),
        ("index", "0.399006", "399006.SZ", "创业板指"),
        ("index", "1.000300", "000300.SH", "沪深300"),
        ("index", "1.000688", "000688.SH", "科创50"),
        ("etf", "1.510300", "510300", "沪深300ETF"),
        ("etf", "1.510500", "510500", "中证500ETF"),
        ("etf", "0.159915", "159915", "创业板ETF"),
        ("etf", "1.588000", "588000", "科创50ETF"),
        ("etf", "1.513100", "513100", "纳指ETF"),
    ]
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    for item_type, secid, code, name in specs:
        try:
            rows.extend(fetch_eastmoney_kline(item_type, secid, code, name))
        except Exception as exc:
            errors.append(f"{code}:{exc}")
    status["history_eastmoney"] = {"ok": bool(rows), "sourceName": "东方财富K线", "rows": len(rows), "message": "东方财富历史K线可用" if rows else "; ".join(errors[:3])}
    return rows


def fetch_eastmoney_kline(item_type: str, secid: str, code: str, name: str) -> list[dict[str, Any]]:
    params = {
        "secid": secid,
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "klt": "101",
        "fqt": "1",
        "beg": "20240101",
        "end": "20500101",
    }
    urls = [
        "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + urllib.parse.urlencode(params),
        "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + urllib.parse.urlencode({**params, "ut": "fa5fd1943c7b386f172d6893dbfba10b"}),
        "http://push2his.eastmoney.com/api/qt/stock/kline/get?" + urllib.parse.urlencode(params),
    ]
    payload = None
    last_error: Exception | None = None
    for url in urls:
        for attempt in range(2):
            try:
                request = urllib.request.Request(url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://quote.eastmoney.com/",
                    "Accept": "application/json,text/plain,*/*",
                    "Connection": "close",
                })
                with urllib.request.urlopen(request, timeout=18) as response:
                    payload = json.loads(response.read().decode("utf-8", errors="ignore"))
                break
            except Exception as exc:
                last_error = exc
                time.sleep(0.8 + attempt * 1.2)
        if payload is not None:
            break
    if payload is None:
        raise last_error or RuntimeError("东方财富K线无响应")
    klines = (payload.get("data") or {}).get("klines") or []
    rows = []
    for line in klines[-320:]:
        parts = str(line).split(",")
        if len(parts) < 11:
            continue
        rows.append({
            "type": item_type,
            "code": code,
            "name": name,
            "date": parts[0],
            "open": safe_float(parts[1]),
            "close": safe_float(parts[2]),
            "high": safe_float(parts[3]),
            "low": safe_float(parts[4]),
            "volume": safe_float(parts[5]),
            "amount": safe_float(parts[6]),
            "change_pct": safe_float(parts[8]),
            "source": "东方财富K线",
            "fetched_at": now_iso(),
        })
    return rows


def collect_history_baostock(status: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        import baostock as bs  # type: ignore
    except Exception as exc:
        status["history_baostock"] = {"ok": False, "sourceName": "Baostock历史", "rows": 0, "message": f"未安装或不可用: {exc}"}
        return []

    specs = [
        ("sh.000001", "000001.SH", "上证指数"),
        ("sz.399001", "399001.SZ", "深证成指"),
        ("sz.399006", "399006.SZ", "创业板指"),
        ("sh.000300", "000300.SH", "沪深300"),
        ("sh.000688", "000688.SH", "科创50"),
    ]
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    with contextlib.redirect_stdout(io.StringIO()):
        lg = bs.login()
    if getattr(lg, "error_code", "1") != "0":
        status["history_baostock"] = {"ok": False, "sourceName": "Baostock历史", "rows": 0, "message": getattr(lg, "error_msg", "登录失败")}
        return []
    try:
        start_date = os.environ.get("KOMO_HISTORY_START", "2024-01-01")
        end_date = datetime.now().strftime("%Y-%m-%d")
        fields = "date,code,open,high,low,close,volume,amount,pctChg"
        for bs_code, code, name in specs:
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    rs = bs.query_history_k_data_plus(bs_code, fields, start_date=start_date, end_date=end_date, frequency="d", adjustflag="3")
                if getattr(rs, "error_code", "1") != "0":
                    errors.append(f"{code}:{getattr(rs, 'error_msg', '')}")
                    continue
                while rs.next():
                    row = dict(zip(rs.fields, rs.get_row_data()))
                    close = safe_float(row.get("close"))
                    if close is None:
                        continue
                    rows.append({
                        "type": "index",
                        "code": code,
                        "name": name,
                        "date": row.get("date"),
                        "open": safe_float(row.get("open")),
                        "close": close,
                        "high": safe_float(row.get("high")),
                        "low": safe_float(row.get("low")),
                        "volume": safe_float(row.get("volume")),
                        "amount": safe_float(row.get("amount")),
                        "change_pct": safe_float(row.get("pctChg")),
                        "source": "Baostock历史",
                        "fetched_at": now_iso(),
                    })
            except Exception as exc:
                errors.append(f"{code}:{exc}")
    finally:
        with contextlib.redirect_stdout(io.StringIO()):
            bs.logout()
    status["history_baostock"] = {"ok": bool(rows), "sourceName": "Baostock历史", "rows": len(rows), "message": "Baostock历史K线兜底可用" if rows else "; ".join(errors[:3])}
    return rows


def history_source_label(rows: list[dict[str, Any]]) -> str:
    sources: list[str] = []
    for row in rows:
        source = str(row.get("source") or "").strip()
        if source and source not in sources:
            sources.append(source)
    return "、".join(sources[:3]) or "历史行情"


def collect_index_history_ak(ak: Any, errors: list[str]) -> list[dict[str, Any]]:
    specs = [
        ("index_zh_a_hist", "000001", "上证指数", "000001.SH"),
        ("index_zh_a_hist", "399001", "深证成指", "399001.SZ"),
        ("index_zh_a_hist", "399006", "创业板指", "399006.SZ"),
        ("index_zh_a_hist", "000300", "沪深300", "000300.SH"),
        ("index_zh_a_hist", "000688", "科创50", "000688.SH"),
    ]
    rows: list[dict[str, Any]] = []
    for fn_name, symbol, name, code in specs:
        try:
            fn = getattr(ak, fn_name)
            df = call_source(lambda fn=fn, symbol=symbol: fn(symbol=symbol, period="daily"))
            rows.extend(history_rows_from_df(df_rows(df, 260), "index", code, name, "AkShare指数历史"))
        except Exception as exc:
            errors.append(f"{name}:{exc}")
    return rows


def collect_etf_history_ak(ak: Any, errors: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    specs = [("510300", "沪深300ETF"), ("510500", "中证500ETF"), ("159915", "创业板ETF"), ("588000", "科创50ETF"), ("513100", "纳指ETF")]
    for code, name in specs:
        for fn_name in ["fund_etf_hist_em", "fund_etf_hist_sina"]:
            try:
                fn = getattr(ak, fn_name)
                df = call_source(lambda fn=fn, code=code: fn(symbol=code, period="daily"))
                got = history_rows_from_df(df_rows(df, 260), "etf", code, name, f"AkShare ETF历史/{fn_name}")
                if got:
                    rows.extend(got)
                    break
            except Exception as exc:
                errors.append(f"ETF{code}:{exc}")
    return rows


def collect_sector_history_ak(ak: Any, errors: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    sectors = ["半导体", "医疗服务", "军工", "证券", "银行", "通信设备", "消费电子", "有色金属"]
    for sector in sectors:
        try:
            df = call_source(lambda sector=sector: ak.stock_board_industry_hist_em(symbol=sector, period="日k"))
            rows.extend(history_rows_from_df(df_rows(df, 260), "sector", sector, sector, "AkShare板块历史"))
        except Exception as exc:
            errors.append(f"板块{sector}:{exc}")
    return rows


def collect_global_history_yfinance(status: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        import yfinance as yf  # type: ignore
    except Exception as exc:
        status["history_yfinance"] = {"ok": False, "sourceName": "yfinance", "rows": 0, "message": str(exc)}
        return []
    specs = [("^IXIC", "纳斯达克", "IXIC"), ("^GSPC", "标普500", "SPX"), ("^DJI", "道琼斯", "DJI"), ("^HSI", "恒生指数", "HSI"), ("^N225", "日经225", "N225"), ("^KS11", "KOSPI", "KOSPI")]
    rows: list[dict[str, Any]] = []
    for symbol, name, code in specs:
      try:
        hist = yf.Ticker(symbol).history(period="1y", interval="1d", timeout=8)
        if hist.empty:
            continue
        for idx, item in hist.tail(260).iterrows():
            close = safe_float(item.get("Close"))
            if close is None:
                continue
            rows.append({
                "type": "index",
                "code": code,
                "name": name,
                "date": idx.to_pydatetime().strftime("%Y-%m-%d"),
                "open": safe_float(item.get("Open")),
                "high": safe_float(item.get("High")),
                "low": safe_float(item.get("Low")),
                "close": close,
                "volume": safe_float(item.get("Volume")),
                "amount": None,
                "change_pct": None,
                "source": "yfinance历史",
                "fetched_at": now_iso(),
            })
      except Exception as exc:
        status[f"history_yfinance_{code}"] = {"ok": False, "sourceName": "yfinance", "rows": 0, "message": str(exc)}
    status["history_yfinance"] = {"ok": bool(rows), "sourceName": "yfinance", "rows": len(rows), "message": "海外历史刷新完成" if rows else "海外历史无数据"}
    return rows


def history_rows_from_df(items: list[dict[str, Any]], item_type: str, code: str, name: str, source: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    previous_close: float | None = None
    for row in items:
        date = str(first(row, ["日期", "date", "时间", "交易日期"], ""))[:10]
        close = safe_float(first(row, ["收盘", "收盘价", "close", "最新价"]))
        if not date or close is None:
            continue
        change_pct = safe_float(first(row, ["涨跌幅", "涨跌幅%", "change_pct"]))
        if change_pct is None and previous_close:
            change_pct = (close - previous_close) / previous_close * 100
        rows.append({
            "type": item_type,
            "code": code,
            "name": name,
            "date": date,
            "open": safe_float(first(row, ["开盘", "开盘价", "open"])),
            "high": safe_float(first(row, ["最高", "最高价", "high"])),
            "low": safe_float(first(row, ["最低", "最低价", "low"])),
            "close": close,
            "volume": safe_float(first(row, ["成交量", "volume"])),
            "amount": safe_float(first(row, ["成交额", "amount"])),
            "change_pct": change_pct,
            "source": source,
            "fetched_at": now_iso(),
        })
        previous_close = close
    return rows


def collect_sector_members(status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"sectorMembers": [], "sources": {}}
    if os.environ.get("KOMO_ENABLE_AK_SECTOR_MEMBERS", "1") != "1":
        module_status(status, "sector_members", False, "本地股票池弱映射", 0, "板块成分接口默认关闭，页面优先用本地股票池行业字段弱映射")
        result["sources"] = {"sectorMembers": "本地股票池弱映射"}
        return result
    futu_rows = collect_futu_sector_members(status)
    if futu_rows:
        result["sectorMembers"] = futu_rows
        result["sources"] = {"sectorMembers": "Futu OpenD板块成分"}
        module_status(status, "sector_members", True, "Futu OpenD板块成分", len(futu_rows), "Futu板块成分刷新完成")
        return result
    ak = import_akshare(status)
    if ak is None:
        module_status(status, "sector_members", False, "AkShare板块成分", 0, "AkShare 不可用")
        return result
    sectors = ["医疗服务", "半导体", "军工", "证券", "银行", "通信设备", "消费电子", "有色金属", "软件开发", "电池"]
    rows: list[dict[str, Any]] = []
    for sector in sectors:
        try:
            df = call_source(lambda sector=sector: ak.stock_board_industry_cons_em(symbol=sector))
            for index, row in enumerate(df_rows(df, 80), start=1):
                code = normalize_stock_code(str(first(row, ["代码"], "")))
                name = str(first(row, ["名称"], ""))
                if not code or not name:
                    continue
                rows.append({
                    "sector": sector,
                    "code": code,
                    "name": name,
                    "rank_no": index,
                    "change_pct": safe_float(first(row, ["涨跌幅"])),
                    "amount": safe_float(first(row, ["成交额"])),
                    "source": "东财行业成分股",
                    "updated_at": now_iso(),
                })
        except Exception as exc:
            status[f"sector_members_{sector}"] = {"ok": False, "sourceName": "东财行业成分股", "rows": 0, "message": str(exc)}
    if not rows:
        # 成分接口被限流时，用已采集的行业字段补出可追溯的弱映射，不伪装成官方成分权重。
        try:
            fallback_stocks = collect_ashare(status).get("stocks", [])
            for sector in sectors:
                matched = [item for item in fallback_stocks if sector in str(item.get("sector", "")) or str(item.get("sector", "")) in sector]
                for index, item in enumerate(matched[:80], start=1):
                    rows.append({
                        "sector": sector,
                        "code": item.get("code", ""),
                        "name": item.get("name", ""),
                        "rank_no": index,
                        "change_pct": item.get("change_pct"),
                        "amount": item.get("amount"),
                        "source": "新浪A股行业字段弱映射",
                        "updated_at": now_iso(),
                    })
            if rows:
                module_status(status, "sector_members", True, "新浪A股行业字段弱映射", len(rows), "成分接口不可用，已补充弱映射；不代表板块权重")
        except Exception as exc:
            status["sector_members_fallback"] = {"ok": False, "sourceName": "新浪A股行业字段弱映射", "rows": 0, "message": str(exc)}
    result["sectorMembers"] = rows
    source = "新浪A股行业字段弱映射" if rows and any(item.get("source") == "新浪A股行业字段弱映射" for item in rows) else "东财行业成分股"
    result["sources"] = {"sectorMembers": source}
    if rows and status.get("sector_members", {}).get("sourceName") != "新浪A股行业字段弱映射":
        module_status(status, "sector_members", True, source, len(rows), "板块成分刷新完成")
    return result


def collect_futu_sector_members(status: dict[str, Any]) -> list[dict[str, Any]]:
    ctx = collect_futu_context(status)
    if ctx is None:
        return []
    try:
        import futu  # type: ignore
        ret, plates = ctx.get_plate_list(futu.Market.SH, futu.Plate.INDUSTRY)
        if ret != futu.RET_OK:
            return []
        targets = ["半导体", "银行", "证券", "军工", "通信设备", "消费电子", "有色金属", "软件开发", "电池", "医疗服务"]
        plate_rows = futu_frame_rows(plates)
        by_name = {str(row.get("plate_name")): str(row.get("code")) for row in plate_rows}
        rows: list[dict[str, Any]] = []
        for sector in targets:
            plate_code = by_name.get(sector)
            if not plate_code:
                continue
            ret, members = ctx.get_plate_stock(plate_code)
            if ret != futu.RET_OK:
                continue
            for rank, member in enumerate(futu_frame_rows(members)[:80], start=1):
                code = normalize_stock_code(str(member.get("code") or ""))
                name = str(member.get("stock_name") or "")
                if code and name:
                    rows.append({"sector": sector, "code": code, "name": name, "rank_no": rank, "change_pct": None, "amount": None, "source": "Futu OpenD板块成分", "updated_at": now_iso()})
        return rows
    except Exception as exc:
        status["sector_members_futu"] = {"ok": False, "sourceName": "Futu OpenD板块成分", "rows": 0, "message": str(exc)}
        return []
    finally:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ctx.close()


def collect_news(status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"newsItems": [], "sources": {}}
    if os.environ.get("KOMO_ENABLE_AK_NEWS") != "1":
        module_status(status, "news", False, "手动资讯素材", 0, "公开新闻自动拉取默认关闭；请在资讯素材池粘贴链接或正文")
        result["sources"] = {"news": "手动资讯素材"}
        return result
    ak = import_akshare(status)
    rows: list[dict[str, Any]] = []
    if ak is not None:
        for source_name, fn_name in [("财联社电报", "stock_info_global_cls"), ("新浪财经新闻", "stock_news_em")]:
            try:
                fn = getattr(ak, fn_name)
                df = call_source(fn)
                for row in df_rows(df, 30):
                    title = str(first(row, ["标题", "title", "新闻标题"], ""))
                    if not title:
                        continue
                    rows.append({
                        "title": title,
                        "url": str(first(row, ["链接", "url", "新闻链接"], "")),
                        "source": source_name,
                        "category": "公开新闻",
                        "summary": str(first(row, ["摘要", "内容", "summary"], ""))[:500],
                        "content": "",
                        "published_at": str(first(row, ["发布时间", "time", "日期"], "")),
                    })
                if rows:
                    break
            except Exception as exc:
                status[f"news_{source_name}"] = {"ok": False, "sourceName": source_name, "rows": 0, "message": str(exc)}
    result["newsItems"] = rows
    result["sources"] = {"news": rows[0]["source"] if rows else "公开新闻"}
    module_status(status, "news", bool(rows), result["sources"]["news"], len(rows), "公开新闻刷新完成" if rows else "未获取到公开新闻")
    return result


def collect_global(status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"markets": [], "trends": [], "sources": {}}
    ak = import_akshare(status)
    if ak is not None:
        em_result = collect_global_with_eastmoney(ak, status)
        if em_result["markets"]:
            tencent_result = collect_global_with_tencent(status)
            if tencent_result["markets"]:
                em_result["markets"] = merge_market_groups(em_result["markets"], tencent_result["markets"])
                em_result["sources"] = {"markets": "东财全球指数 / 腾讯行情", "trends": em_result["sources"].get("trends", "全球指数")}
                count = sum(len(market["indexes"]) for market in em_result["markets"])
                module_status(status, "global", count > 0, em_result["sources"]["markets"], count, "海外指数刷新完成，腾讯行情已补充可用指数")
            return em_result

    try:
        import yfinance as yf  # type: ignore

        status["yfinance"] = {"ok": True, "sourceName": "yfinance", "rows": 0, "message": "可用"}
    except Exception as exc:
        status["yfinance"] = {"ok": False, "sourceName": "yfinance", "rows": 0, "message": f"未安装或不可用: {exc}"}
        module_status(status, "global", False, "yfinance", 0, f"yfinance 不可用: {exc}")
        return result

    groups = {
        "美股": [("^IXIC", "纳斯达克", "IXIC"), ("^GSPC", "标普500", "SPX"), ("^DJI", "道琼斯", "DJI")],
        "日本": [("^N225", "日经225", "N225"), ("1306.T", "东证指数", "TOPIX")],
        "韩国": [("^KS11", "KOSPI", "KOSPI"), ("^KQ11", "KOSDAQ", "KOSDAQ")],
        "港股": [("^HSI", "恒生指数", "HSI"), ("^HSTECH", "恒生科技", "HSTECH")],
    }

    row_count = 0
    for region, symbols in groups.items():
        indexes = []
        for symbol, name, code in symbols:
            try:
                ticker = yf.Ticker(symbol)
                hist = ticker.history(period="5d", interval="1d", timeout=8)
                if hist.empty:
                    continue
                close = hist["Close"].dropna()
                latest = float(close.iloc[-1])
                previous = float(close.iloc[-2]) if len(close) > 1 else latest
                change_pct = ((latest - previous) / previous) * 100 if previous else 0
                indexes.append(
                    {
                        "name": name,
                        "code": code,
                        "value": latest,
                        "change_pct": change_pct,
                        "change_point": latest - previous,
                        "trend": trend_label(change_pct),
                        "updated_at": now_iso(),
                        "windows": window_guess(change_pct),
                        "source_name": "yfinance",
                    }
                )
                row_count += 1

                intraday = ticker.history(period="1d", interval="30m", timeout=8)
                if not intraday.empty:
                    result["trends"].append(
                        {
                            "name": name,
                            "code": code,
                            "points": [
                                {"time": str(idx.to_pydatetime().strftime("%H:%M")), "value": float(value)}
                                for idx, value in intraday["Close"].dropna().tail(12).items()
                            ],
                        }
                    )
            except Exception as exc:
                status[f"yfinance_{code}"] = {"ok": False, "sourceName": "yfinance", "rows": 0, "message": str(exc)}
        if indexes:
            result["markets"].append({"region": region, "mood": "real", "indexes": indexes})

    yfinance_count = row_count
    hk_count = 0
    if ak is not None:
        hk_result = collect_hk_indexes_with_sina(ak, status)
        if hk_result["markets"]:
            result["markets"] = merge_market_groups(result["markets"], hk_result["markets"])
            hk_count = sum(len(market["indexes"]) for market in hk_result["markets"])
            row_count += hk_count

    tencent_result = collect_global_with_tencent(status)
    if tencent_result["markets"]:
        result["markets"] = merge_market_groups(result["markets"], tencent_result["markets"])
        tencent_count = sum(len(market["indexes"]) for market in tencent_result["markets"])
        row_count += tencent_count

    source_parts = []
    if yfinance_count:
        source_parts.append("yfinance")
    if hk_count:
        source_parts.append("新浪港股指数")
    if tencent_result["markets"]:
        source_parts.append("腾讯行情")
    source_name = " / ".join(source_parts) if source_parts else "yfinance"
    result["sources"] = {"markets": source_name, "trends": "yfinance"}
    result["sources"]["markets"] = source_name
    module_status(status, "global", row_count > 0, source_name, row_count, "海外指数刷新完成" if row_count else "海外指数无新数据，继续使用缓存")
    return result


def collect_global_with_tencent(status: dict[str, Any]) -> dict[str, Any]:
    """补充可公开访问的美股和港股指数，减少 yfinance 限流造成的空白。"""
    result: dict[str, Any] = {"markets": [], "trends": [], "sources": {}}
    symbols = {
        "usIXIC": ("美股", "纳斯达克", "IXIC", "USD"),
        "usINX": ("美股", "标普500", "SPX", "USD"),
        "usDJI": ("美股", "道琼斯", "DJI", "USD"),
        "hkHSI": ("港股", "恒生指数", "HSI", "HKD"),
        "hkHSTECH": ("港股", "恒生科技", "HSTECH", "HKD"),
    }
    try:
        query = ",".join(symbols)
        request = urllib.request.Request(
            f"https://qt.gtimg.cn/q={query}",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        raw = urllib.request.urlopen(request, timeout=8).read().decode("gb18030", errors="ignore")
        grouped: dict[str, list[dict[str, Any]]] = {}
        for symbol, (region, name, code, currency) in symbols.items():
            match = re.search(rf'v_{re.escape(symbol)}="([^"]*)"', raw)
            if not match:
                continue
            fields = match.group(1).split("~")
            value = safe_float(fields[3] if len(fields) > 3 else None)
            previous = safe_float(fields[4] if len(fields) > 4 else None)
            if value is None or previous in (None, 0):
                continue
            change_point = value - previous
            change_pct = change_point / previous * 100
            item = {
                "name": name,
                "code": code,
                "value": value,
                "change_pct": change_pct,
                "change_point": change_point,
                "trend": trend_label(change_pct),
                "updated_at": str(fields[30] if len(fields) > 30 and fields[30] else now_iso()),
                "windows": window_guess(change_pct),
                "source_name": "腾讯行情",
                "currency": currency,
            }
            grouped.setdefault(region, []).append(item)
        for region, indexes in grouped.items():
            result["markets"].append({"region": region, "mood": "real", "indexes": indexes})
        count = sum(len(group["indexes"]) for group in result["markets"])
        status["global_tencent"] = {"ok": count > 0, "sourceName": "腾讯行情", "rows": count, "message": "美股/港股指数补充完成" if count else "未获取到腾讯指数"}
        result["sources"] = {"markets": "腾讯行情"}
    except Exception as exc:
        status["global_tencent"] = {"ok": False, "sourceName": "腾讯行情", "rows": 0, "message": str(exc)}
    return result


def collect_global_with_eastmoney(ak: Any, status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"markets": [], "trends": [], "sources": {}}
    rows: list[dict[str, Any]] = []
    last_error = ""
    for attempt in range(2):
        try:
            rows = df_rows(call_source(ak.index_global_spot_em))
            if rows:
                break
        except Exception as exc:
            last_error = str(exc)
            time.sleep(1 + attempt)

    if not rows:
        status["global_eastmoney"] = {"ok": False, "sourceName": "东财全球指数", "rows": 0, "message": last_error or "无数据"}
        return result

    specs = [
        ("港股", ["恒生指数"], "恒生指数", "HSI"),
        ("港股", ["恒生科技"], "恒生科技", "HSTECH"),
        ("美股", ["纳斯达克"], "纳斯达克", "IXIC"),
        ("美股", ["标普500", "标普 500", "S&P 500"], "标普500", "SPX"),
        ("美股", ["道琼斯"], "道琼斯", "DJI"),
        ("日本", ["日经225"], "日经225", "N225"),
        ("日本", ["东证指数", "TOPIX"], "东证指数", "TOPIX"),
        ("韩国", ["韩国KOSPI", "KOSPI"], "KOSPI", "KOSPI"),
        ("韩国", ["KOSDAQ"], "KOSDAQ", "KOSDAQ"),
    ]

    grouped: dict[str, list[dict[str, Any]]] = {}
    for region, aliases, display_name, code in specs:
        row = find_global_row(rows, aliases)
        if not row:
            continue
        change = safe_float(first(row, ["涨跌幅"])) or 0
        item = {
            "name": display_name,
            "code": code,
            "value": safe_float(first(row, ["最新价"])) or 0,
            "change_pct": change,
            "change_point": safe_float(first(row, ["涨跌额"])) or 0,
            "trend": trend_label(change),
            "updated_at": str(first(row, ["最新行情时间"], now_iso())),
            "windows": window_guess(change),
            "source_name": "东财全球指数",
        }
        grouped.setdefault(region, []).append(item)

    for region, indexes in grouped.items():
        result["markets"].append({"region": region, "mood": "real", "indexes": indexes})

    count = sum(len(market["indexes"]) for market in result["markets"])
    result["sources"] = {"markets": "东财全球指数"}
    module_status(status, "global", count > 0, "东财全球指数", count, "海外指数刷新完成" if count else "东财全球指数未匹配到目标指数")
    return result


def find_global_row(rows: list[dict[str, Any]], aliases: list[str]) -> dict[str, Any] | None:
    for row in rows:
        name = str(first(row, ["名称"], ""))
        code = str(first(row, ["代码"], ""))
        for alias in aliases:
            if alias in name or alias == code:
                return row
    return None


def collect_hk_indexes_with_sina(ak: Any, status: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"markets": []}
    try:
        rows = df_rows(call_source(ak.stock_hk_index_spot_sina))
    except Exception as exc:
        status["global_hk_sina"] = {"ok": False, "sourceName": "新浪港股指数", "rows": 0, "message": str(exc)}
        return result

    specs = [("HSI", "恒生指数", "HSI"), ("HSTECH", "恒生科技指数", "HSTECH")]
    indexes = []
    for raw_code, display_name, code in specs:
        row = next((item for item in rows if str(first(item, ["代码"], "")) == raw_code), None)
        if not row:
            continue
        change = safe_float(first(row, ["涨跌幅"])) or 0
        indexes.append(
            {
                "name": display_name.replace("指数", ""),
                "code": code,
                "value": safe_float(first(row, ["最新价"])) or 0,
                "change_pct": change,
                "change_point": safe_float(first(row, ["涨跌额"])) or 0,
                "trend": trend_label(change),
                "updated_at": now_iso(),
                "windows": window_guess(change),
                "source_name": "新浪港股指数",
            }
        )
    if indexes:
        result["markets"].append({"region": "港股", "mood": "real", "indexes": indexes})
    status["global_hk_sina"] = {"ok": bool(indexes), "sourceName": "新浪港股指数", "rows": len(indexes), "message": "港股指数刷新完成" if indexes else "未匹配到港股指数"}
    return result


def merge_market_groups(current: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_region = {market["region"]: market for market in current}
    for market in incoming:
        by_region[market["region"]] = market
    return list(by_region.values())


def check_baostock(status: dict[str, Any]) -> None:
    try:
        import baostock as bs  # type: ignore

        with contextlib.redirect_stdout(io.StringIO()):
            lg = bs.login()
            bs.logout()
        status["baostock"] = {"ok": lg.error_code == "0", "sourceName": "Baostock", "rows": 0, "message": lg.error_msg or "可用"}
    except Exception as exc:
        status["baostock"] = {"ok": False, "sourceName": "Baostock", "rows": 0, "message": f"未安装或不可用: {exc}"}


def normalize_index_code(name: str, code: str) -> str:
    fixed = {
        "上证指数": "000001.SH",
        "深证成指": "399001.SZ",
        "创业板指": "399006.SZ",
        "沪深300": "000300.SH",
        "科创50": "000688.SH",
    }
    return fixed.get(name, code)


def normalize_stock_code(code: str) -> str:
    code = code.strip().lower()
    if "." in code:
        raw, market = code.split(".", 1)
        if market.startswith(("sh", "ss")):
            return f"sh{raw}"
        if market.startswith("sz"):
            return f"sz{raw}"
        if market.startswith("bj"):
            return f"bj{raw}"
    if code.startswith(("sh", "sz", "bj")):
        return code
    if code.startswith(("6", "9")):
        return f"sh{code}"
    if code.startswith(("0", "2", "3")):
        return f"sz{code}"
    if code.startswith(("4", "8")):
        return f"bj{code}"
    return code


def normalize_etf_code(code: str) -> str:
    code = code.strip().lower()
    if code.startswith(("sh", "sz", "bj")):
        return code[2:]
    if "." in code:
        return code.split(".", 1)[0]
    return code


def trend_label(change_pct: float) -> str:
    if change_pct >= 1:
        return "强势"
    if change_pct >= 0.2:
        return "偏强"
    if change_pct <= -1:
        return "风险"
    if change_pct <= -0.2:
        return "偏弱"
    return "震荡"


def window_guess(change_pct: float) -> dict[str, float]:
    return {
        "today": change_pct,
        "five": change_pct,
        "day": change_pct,
        "month": change_pct,
        "quarter": change_pct,
        "year": change_pct,
        "all": change_pct,
    }


def etf_category(name: str) -> str:
    if any(key in name for key in ["纳指", "恒生", "日经", "标普", "德国", "法国", "香港", "沙特"]):
        return "跨境"
    if any(key in name for key in ["半导体", "芯片", "光伏", "证券", "医药", "消费", "新能源", "人工智能", "机器人", "军工", "有色", "银行"]):
        return "行业"
    return "宽基"


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", choices=sorted(SCOPES), default="all")
    parser.add_argument("--code", default="", help="stock-history 或 security-quote 的单只证券代码")
    parser.add_argument("--codes", default="", help="security-quotes 的候选证券代码，使用逗号分隔")
    parser.add_argument("--security-type", choices=["stock", "etf"], default="stock", help="security-quote 的证券类型")
    args = parser.parse_args()

    status: dict[str, Any] = {"fetched_at": now_iso(), "scope": args.scope}
    payload: dict[str, Any] = {
        "fetchedAt": status["fetched_at"],
        "scope": args.scope,
        "status": status,
        "markets": [],
        "stocks": [],
        "etfs": [],
        "sectorFlows": [],
        "trends": [],
        "history": [],
        "sectorMembers": [],
        "newsItems": [],
        "securities": [],
        "quote": None,
        "quotes": [],
        "sources": {},
    }

    if args.scope in {"all", "ashare"}:
        data = collect_ashare(status)
        payload["markets"].extend(data["markets"])
        payload["stocks"].extend(data["stocks"])
        payload["trends"].extend(data.get("trends", []))
        payload["sources"].update(data["sources"])

    if args.scope in {"all", "etf"}:
        data = collect_etf(status)
        payload["etfs"].extend(data["etfs"])
        payload["sources"].update(data["sources"])

    if args.scope in {"all", "sector"}:
        data = collect_sector(status)
        payload["sectorFlows"].extend(data["sectorFlows"])
        payload["sources"].update(data["sources"])

    if args.scope in {"all", "global"}:
        data = collect_global(status)
        payload["markets"].extend(data["markets"])
        payload["trends"].extend(data["trends"])
        payload["sources"].update(data["sources"])

    if args.scope in {"all", "history"}:
        data = collect_history(status)
        payload["history"].extend(data["history"])
        payload["sources"].update(data["sources"])

    if args.scope == "stock-history":
        data = collect_stock_history(status, args.code)
        payload["history"].extend(data["history"])
        payload["sources"].update(data["sources"])

    if args.scope in {"all", "sector-members"}:
        data = collect_sector_members(status)
        payload["sectorMembers"].extend(data["sectorMembers"])
        payload["sources"].update(data["sources"])

    if args.scope in {"all", "news"}:
        data = collect_news(status)
        payload["newsItems"].extend(data["newsItems"])
        payload["sources"].update(data["sources"])

    if args.scope == "securities":
        payload["securities"].extend(collect_futu_security_master(status))
        payload["sources"]["securities"] = "Futu OpenD证券目录"

    if args.scope == "security-quote":
        payload["quote"] = collect_futu_security_quote(status, args.code, args.security_type)
        payload["sources"]["quote"] = "Futu OpenD按需行情"

    if args.scope == "security-quotes":
        codes = [item.strip() for item in str(args.codes or "").split(",") if item.strip()]
        payload["quotes"] = collect_futu_security_quotes(status, codes)
        payload["sources"]["quotes"] = "Futu OpenD候选行情"

    check_baostock(status)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"fetchedAt": now_iso(), "status": {"collector": {"ok": False, "sourceName": "collector", "rows": 0, "message": str(exc)}}}, ensure_ascii=False))
        sys.exit(0)
