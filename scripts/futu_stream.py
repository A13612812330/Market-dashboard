from __future__ import annotations

import json
import os
import signal
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SUBSCRIPTIONS = DATA_DIR / "futu-subscriptions.json"
LIVE_QUOTES = DATA_DIR / "futu-live.json"
HOST = os.getenv("FUTU_HOST", "127.0.0.1")
PORT = int(os.getenv("FUTU_PORT", "11111"))
RUNNING = True


def stop(*_args: Any) -> None:
    global RUNNING
    RUNNING = False


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)


def write_status(connected: bool, message: str, quotes: dict[str, dict[str, Any]] | None = None, codes: list[str] | None = None) -> None:
    payload = {
        "connected": connected,
        "message": message,
        "source": "Futu OpenD实时订阅",
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "codes": codes or [],
        "quotes": quotes or {},
    }
    temp = LIVE_QUOTES.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temp.replace(LIVE_QUOTES)


def read_codes() -> list[str]:
    try:
        data = json.loads(SUBSCRIPTIONS.read_text(encoding="utf-8"))
        return sorted({str(code).upper() for code in data.get("codes", []) if code})
    except Exception:
        return []


def normalize_code(value: Any) -> str:
    text = str(value or "").upper()
    if "." in text:
        prefix, digits = text.split(".", 1)
        return f"{prefix.lower()}.{digits}"
    return text.lower()


def number(row: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = row.get(key)
        try:
            if value is not None and value != "":
                return float(value)
        except (TypeError, ValueError):
            continue
    return None


def run() -> None:
    try:
        import futu  # type: ignore
    except Exception as exc:
        write_status(False, f"futu-api不可用: {exc}")
        return

    class Handler(futu.StockQuoteHandlerBase):
        def on_recv_rsp(self, rsp_str: Any):
            ret, data = super().on_recv_rsp(rsp_str)
            if ret != futu.RET_OK:
                return ret, data
            try:
                rows = data.to_dict("records")
            except Exception:
                rows = []
            current = {}
            try:
                previous = json.loads(LIVE_QUOTES.read_text(encoding="utf-8")).get("quotes", {})
            except Exception:
                previous = {}
            for row in rows:
                code = normalize_code(row.get("code"))
                if not code:
                    continue
                price = number(row, "last_price", "price")
                previous_close = number(row, "prev_close_price", "prev_close")
                change_pct = number(row, "change_rate", "change_pct")
                if change_pct is None and price is not None and previous_close:
                    change_pct = (price - previous_close) / previous_close * 100
                current[code] = {
                    "code": code,
                    "price": price,
                    "change_pct": change_pct,
                    "volume_ratio": number(row, "volume_ratio"),
                    "turnover_rate": number(row, "turnover_rate"),
                    "amount": number(row, "turnover", "amount"),
                    "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "source_name": "Futu OpenD实时订阅",
                }
            previous.update(current)
            write_status(True, "实时订阅中", previous, read_codes())
            return ret, data

    while RUNNING:
        ctx = None
        try:
            ctx = futu.OpenQuoteContext(host=HOST, port=PORT)
            ctx.set_handler(Handler())
            subscribed: set[str] = set()
            write_status(True, "已连接，等待行情推送", {}, [])
            while RUNNING:
                codes = set(read_codes())
                if codes != subscribed:
                    if subscribed:
                        try:
                            ctx.unsubscribe(list(subscribed), [futu.SubType.QUOTE])
                        except Exception:
                            pass
                    if codes:
                        ret, message = ctx.subscribe(list(codes), [futu.SubType.QUOTE], is_first_push=True)
                        if ret != futu.RET_OK:
                            write_status(False, f"订阅失败: {message}", {}, sorted(codes))
                        else:
                            write_status(True, "实时订阅中", {}, sorted(codes))
                    subscribed = codes
                time.sleep(0.5)
        except Exception as exc:
            write_status(False, f"OpenD连接失败: {exc}", {}, read_codes())
            time.sleep(5)
        finally:
            if ctx is not None:
                try:
                    ctx.close()
                except Exception:
                    pass


if __name__ == "__main__":
    run()
