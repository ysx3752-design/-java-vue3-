# -*- coding: utf-8 -*-
"""WSN 虚拟硬件平台本地模拟器（替代京胜世纪 KPC 仿真软件，供无 KPC 环境联调/演示）。

实现与后端 WsnClient 逐字节兼容的 TCP 服务：
- 查询帧  A5 00 addr FF FF FF FF FF 5A   -> 回复 8 字节状态帧 A5 addr 00 s1 s2 s3 s4 5A
- 控制帧  A5 20 addr s1 s2 s3 s4 FF 5A   -> 更新继电器状态并回复状态帧
- 采集帧  A5 00 00 FF FF FF FF FF 5A     -> 回复 8 个 B5 传感器帧（4 类各两帧，满足 >=54 字节）
传感器帧格式：B5 type addr d0 d1 d2 d3 d4 5B，数值大端无符号短整型，温湿度放大 100 倍。

用法：python wsn_simulator.py [--host 0.0.0.0] [--port 4000]
后端接入：在 backend-java/.env 增加 WSN_HOST=127.0.0.1（WSN_PORT 默认 4000）后重启后端；
接真实 KPC/硬件时删除这两行或改回 192.168.12.1 即可。
"""
import argparse
import math
import signal
import socket
import sys
import threading
import time

# 继电器组：地址低字节 -> 4 通道状态（与 DeviceConfig 的 0x2001/0x2003 对应）
BANKS = {0x01: [0, 0, 0, 0], 0x03: [0, 0, 0, 0]}
LOCK = threading.Lock()

SENSOR_TYPES = (0x31, 0x32, 0x33, 0x34)


def log(msg):
    print("[sim %s] %s" % (time.strftime("%H:%M:%S"), msg), flush=True)


def hexs(data):
    return " ".join("%02X" % b for b in data)


def sensor_values(ts=None):
    """确定性昼夜物理模型：同一时间戳在模拟器与历史回填中结果一致。

    规律参照实际温室：气温 14 时前后见顶（正午可破 28℃ 触发水帘）、凌晨最低；
    湿度与光照反相；光照夜间为 0（触发补光规则）；土壤湿度按 06:30/18:30
    两次喷灌呈锯齿衰减；CO2 夜间累积、白天回落。
    """
    lt = time.localtime(ts) if ts else time.localtime()
    t = lt.tm_hour + lt.tm_min / 60.0 + lt.tm_sec / 3600.0
    daylight = max(0.0, math.sin(math.pi * (t - 6.5) / 12.0))  # 06:30-18:30 为正
    diurnal = math.sin(2 * math.pi * (t - 8.0) / 24.0)        # 14:00 见顶
    w1 = math.sin(2 * math.pi * t / 1.7)
    w2 = math.sin(2 * math.pi * t / 3.3)
    w3 = math.sin(2 * math.pi * t / 5.1)

    air_t = 20.5 + 6.0 * diurnal + 2.0 * daylight ** 3 + 0.35 * w1 + 0.25 * w2
    air_h = 76.0 - 20.0 * daylight - 4.0 * diurnal + 1.2 * w2 + 0.8 * w3
    soil_t = 19.0 + 3.0 * math.sin(2 * math.pi * (t - 11.0) / 24.0) + 0.15 * w1
    hours_since_irrigation = (t - 6.5) % 12.0
    soil_m = max(35.0, min(70.0, 66.0 - 2.0 * hours_since_irrigation + 0.8 * w3))
    light = 42000.0 * (daylight ** 1.3) * (0.82 + 0.18 * w3) if daylight > 0 else 0.0
    co2 = 980.0 - 380.0 * daylight + 90.0 * math.sin(2 * math.pi * (t - 1.0) / 24.0) + 25.0 * w2
    return {
        "air_temperature": air_t, "air_humidity": air_h,
        "soil_temperature": soil_t, "soil_moisture": soil_m,
        "light_intensity": light, "co2_concentration": co2,
    }


def u16(value):
    value = int(max(0, min(0xFFFF, round(value))))
    return bytes([(value >> 8) & 0xFF, value & 0xFF])


def sensor_burst():
    """4 类传感器帧各发两帧，共 72 字节，满足后端 >=9*6 字节的立即返回条件。"""
    v = sensor_values()
    payloads = {
        0x31: u16(v["air_temperature"] * 100) + u16(v["air_humidity"] * 100) + b"\x00",
        0x32: u16(v["soil_temperature"] * 100) + u16(v["soil_moisture"] * 100) + b"\x00",
        0x33: u16(v["co2_concentration"]) + b"\x00\x00\x00",
        0x34: u16(v["light_intensity"]) + b"\x00\x00\x00",
    }
    out = b""
    for _ in range(2):
        for stype in SENSOR_TYPES:
            out += b"\xB5" + bytes([stype, 0x01]) + payloads[stype] + b"\x5B"
    return out


def status_frame(addr):
    with LOCK:
        states = BANKS.get(addr, [0, 0, 0, 0])
    return bytes([0xA5, addr & 0xFF, 0x00] + [1 if s else 0 for s in states] + [0x5A])


def handle_client(conn, peer):
    log("客户端接入: %s:%d" % peer)
    buf = b""
    try:
        while True:
            chunk = conn.recv(1024)
            if not chunk:
                break
            buf += chunk
            while len(buf) >= 9:
                if buf[0] != 0xA5:
                    buf = buf[1:]
                    continue
                frame, buf = buf[:9], buf[9:]
                cmd, addr = frame[1], frame[2]
                log("收到帧: %s" % hexs(frame))
                if cmd == 0x00:
                    if addr == 0x00:
                        conn.sendall(sensor_burst())
                        log("上报传感器帧 x8")
                    else:
                        conn.sendall(status_frame(addr))
                        log("回复查询状态: addr=0x%02X %s" % (addr, hexs(status_frame(addr))))
                elif cmd == 0x20:
                    states = [1 if frame[3 + i] else 0 for i in range(4)]
                    with LOCK:
                        BANKS.setdefault(addr, [0, 0, 0, 0])[:] = states
                    log("控制生效: addr=0x%02X 通道=%s" % (addr, states))
                    conn.sendall(status_frame(addr))
                else:
                    log("忽略未知命令 0x%02X" % cmd)
    except (ConnectionResetError, BrokenPipeError, OSError) as e:
        log("客户端断开: %s (%s)" % (peer, e))
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="WSN 虚拟硬件平台本地模拟器")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=4000)
    args = parser.parse_args()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.host, args.port))
    srv.listen(5)
    srv.settimeout(0.5)
    log("模拟器监听 %s:%d（替代 KPC，支持随时 Ctrl+C 退出）" % (args.host, args.port))

    is_running = True

    def shutdown(signum=None, frame=None):
        nonlocal is_running
        if not is_running:
            return
        is_running = False
        log("收到中断信号，模拟器服务已安全停止。")
        try:
            srv.close()
        except Exception:
            pass
        sys.exit(0)

    try:
        signal.signal(signal.SIGINT, shutdown)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, shutdown)
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, shutdown)
    except Exception:
        pass

    try:
        while is_running:
            try:
                conn, peer = srv.accept()
            except socket.timeout:
                continue
            except (OSError, ValueError):
                break
            threading.Thread(target=handle_client, args=(conn, peer), daemon=True).start()
    except (KeyboardInterrupt, SystemExit):
        shutdown()
    finally:
        try:
            srv.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
