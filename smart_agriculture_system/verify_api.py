#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""智能农业管理系统 - 接口回归验证脚本"""
import json
import urllib.request
import urllib.error
import sys

BASE = "http://localhost:5000"
TOKEN = ""
results = []


def call(method, path, body=None, token=True, raw=False):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token and TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            payload = r.read()
            code = r.getcode()
            if raw:
                return code, payload
            try:
                return code, json.loads(payload.decode("utf-8"))
            except Exception:
                return code, payload.decode("utf-8", "ignore")[:200]
    except urllib.error.HTTPError as e:
        payload = e.read()
        code = e.code
        if raw:
            return code, payload
        try:
            return code, json.loads(payload.decode("utf-8"))
        except Exception:
            return code, payload.decode("utf-8", "ignore")[:200]
    except Exception as e:
        return 0, "EXC: %s" % e


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    mark = "PASS" if cond else "FAIL"
    print("[%s] %-42s %s" % (mark, name, detail))
    return cond


def known(name, detail=""):
    """已定位的真实缺陷：当前不通过，但根因已查明，单独统计以便团队跟踪"""
    results.append((name, False, detail))
    print("[KNOWN] %-40s %s" % (name, detail))


def section(title):
    print("\n" + "=" * 78)
    print("  " + title)
    print("=" * 78)


# ---------------- 1. 认证 ----------------
section("1. 认证模块 (Auth)")
code, r = call("POST", "/api/auth/login",
               {"username": "admin", "password": "admin123"}, token=False)
ok = code == 200 and isinstance(r, dict) and "access_token" in r
TOKEN = r.get("access_token", "") if isinstance(r, dict) else ""
check("登录返回 access_token 字符串", ok and isinstance(TOKEN, str) and len(TOKEN) > 50)
check("登录返回 user 对象", isinstance(r, dict) and "user" in r,
      "user keys=%s" % (list(r.get("user", {}).keys()) if isinstance(r, dict) else "N/A"))
check("字段为 snake_case", isinstance(r, dict) and "access_token" in r and "accessToken" not in r)

code, r = call("GET", "/api/auth/profile")
check("获取个人资料 (需 token)", code == 200 and isinstance(r, dict) and r.get("username") == "admin",
      "code=%s" % code)

code, r = call("POST", "/api/auth/refresh")
check("刷新令牌", code == 200 and isinstance(r, dict) and "access_token" in r, "code=%s" % code)

code, r = call("GET", "/api/auth/profile", token=False)
check("无 token 访问受保护接口 -> 401", code == 401, "code=%s" % code)

code, r = call("POST", "/api/auth/login",
               {"username": "admin", "password": "wrong_password"}, token=False)
check("错误密码登录 -> 4xx", 400 <= code < 500, "code=%s" % code)

code, r = call("POST", "/api/auth/logout")
check("退出登录", code == 200, "code=%s" % code)

# ---------------- 2. 设备与传感器 ----------------
section("2. 设备与传感器模块 (Device / Sensor)")
code, r = call("GET", "/api/device/devices")
dev_ok = code == 200 and isinstance(r, list)
check("设备列表", dev_ok, "code=%s count=%s" % (code, len(r) if isinstance(r, list) else "N/A"))
if dev_ok:
    d = r[0]
    print("      样例: %s" % json.dumps(d, ensure_ascii=False)[:220])

code, r = call("GET", "/api/device/status")
check("设备状态", code == 200, "code=%s" % code)

code, r = call("GET", "/api/device/connection-status")
conn_ok = code == 200 and isinstance(r, dict) and "connected" in r
check("连接状态", conn_ok, "code=%s connected=%s devices=%s/%s" % (
    code, r.get("connected") if isinstance(r, dict) else "N/A",
    r.get("connected_devices") if isinstance(r, dict) else "N/A",
    r.get("total_devices") if isinstance(r, dict) else "N/A"))

code, r = call("GET", "/api/device/realtime-sensor-data")
check("实时传感器数据", code == 200, "code=%s" % code)
if code == 200 and isinstance(r, dict):
    print("      实时: %s" % json.dumps(r, ensure_ascii=False)[:200])

code, r = call("GET", "/api/device/sensor-data")
check("最新传感器数据", code == 200, "code=%s" % code)

code, r = call("GET", "/api/device/public/sensor-data", token=False)
check("公开传感器接口(免鉴权)", code == 200, "code=%s" % code)

code, r = call("GET", "/api/sensor-data", token=False)
check("兼容根路径 /api/sensor-data", code == 200, "code=%s" % code)

# ---------------- 3. 历史数据 ----------------
section("3. 历史数据模块 (History)")
code, r = call("GET", "/api/history/data?page=1&limit=10")
# 前端 history.js 用 safelyProcessResponse 消费，裸数组与 {data,meta} 均可
hist_ok = code == 200 and (isinstance(r, list) or (isinstance(r, dict) and "data" in r))
n_rows = len(r) if isinstance(r, list) else len(r.get("data", []))
check("历史数据分页", hist_ok, "code=%s 返回%d条 结构=%s" % (
    code, n_rows, "array" if isinstance(r, list) else "{data,meta}"))
if isinstance(r, list) and r:
    print("      样例: %s" % json.dumps(r[0], ensure_ascii=False)[:220])
elif isinstance(r, dict) and r.get("data"):
    print("      meta: %s" % json.dumps(r.get("meta", {}), ensure_ascii=False)[:150])

code, r = call("GET", "/api/history/summary")
check("历史统计汇总", code == 200, "code=%s" % code)
if code == 200:
    print("      汇总: %s" % json.dumps(r, ensure_ascii=False)[:250])

code, r = call("GET", "/api/history/data?metric=temperature&limit=5")
check("指标筛选 metric=temperature", code == 200, "code=%s" % code)

code, r = call("GET", "/api/history/data?start=2026-11-01T00:00:00&end=2026-11-06T23:59:59&limit=5")
check("时间范围筛选", code == 200, "code=%s" % code)

code, r = call("GET", "/api/export/sensor-data", raw=True)
csv_ok = code == 200 and (b"temperature" in r or b"," in r)
check("CSV 导出", csv_ok, "code=%s bytes=%s" % (code, len(r) if isinstance(r, bytes) else "N/A"))
if csv_ok:
    head = r[:220].decode("utf-8", "ignore")
    print("      CSV头: %s" % head.replace("\r\n", " | ")[:200])

# ---------------- 4. 告警 ----------------
section("4. 告警管理模块 (Alerts)")
code, r = call("GET", "/api/alerts/recent")
check("告警最近记录", code == 200, "code=%s" % code)
if code == 200 and isinstance(r, list) and r:
    print("      样例: %s" % json.dumps(r[0], ensure_ascii=False)[:220])
    ALERT_ID = r[0].get("id")
else:
    ALERT_ID = None

code, r = call("GET", "/api/alerts/count")
check("未处理告警计数", code == 200, "code=%s -> %s" % (code, r))

code, r = call("GET", "/api/alerts/rules")
rules_ok = code == 200 and isinstance(r, list)
check("告警规则列表", rules_ok, "code=%s count=%s" % (code, len(r) if isinstance(r, list) else "N/A"))
if rules_ok and r:
    print("      规则样例: %s" % json.dumps(r[0], ensure_ascii=False)[:220])
    RULE_ID = r[0].get("id")
else:
    RULE_ID = None

if RULE_ID is not None:
    # 控制器使用 @PutMapping("/rules/{ruleId}/toggle")
    code, r = call("PUT", "/api/alerts/rules/%s/toggle" % RULE_ID)
    check("规则启停 toggle (PUT)", code in (200, 201), "code=%s -> %s" % (code, str(r)[:90]))
    code, r = call("PUT", "/api/alerts/rules/%s/toggle" % RULE_ID)
    check("规则启停 toggle 还原 (PUT)", code in (200, 201), "code=%s -> %s" % (code, str(r)[:90]))

# ---------------- 5. 自动控制 ----------------
section("5. 自动控制模块 (AutoControl)")
code, r = call("GET", "/api/auto-control/status")
check("自动控制状态", code == 200, "code=%s" % code)
if code == 200:
    print("      状态: %s" % json.dumps(r, ensure_ascii=False)[:250])

code, r = call("GET", "/api/auto-control/thresholds")
thr_ok = code == 200 and isinstance(r, dict)
check("阈值读取", thr_ok, "code=%s" % code)
if thr_ok:
    print("      阈值: %s" % json.dumps(r, ensure_ascii=False)[:300])

if thr_ok:
    code, r = call("POST", "/api/auto-control/thresholds",
                   {"temperature": {"min": 18.0, "max": 30.0}})
    check("阈值写入", code in (200, 201), "code=%s" % code)

    code, r = call("POST", "/api/auto-control/thresholds",
                   {"temperature": {"min": 40.0, "max": 10.0}})
    if code == 400:
        check("阈值 min>max 校验拒绝", True, "code=400 正确拒绝")
    else:
        known("阈值 min>max 校验拒绝",
              "返回%d 假成功；AutoControlController 仅校验 null 未校验大小关系" % code)

code, r = call("POST", "/api/auto-control/disable")
check("关闭自动控制", code in (200, 201), "code=%s" % code)

# ---------------- 6. 用户管理 ----------------
section("6. 用户管理模块 (Users)")
code, r = call("GET", "/api/users")
# 前端 views/users/index.vue 兼容裸数组与 {status,data} 两种结构
users_ok = code == 200 and (isinstance(r, list) or (isinstance(r, dict) and isinstance(r.get("data"), list)))
users_arr = r if isinstance(r, list) else (r.get("data") if isinstance(r, dict) else [])
check("用户列表", users_ok, "code=%s count=%s" % (code, len(users_arr)))
if users_arr:
    print("      用户: %s" % json.dumps(users_arr[0], ensure_ascii=False)[:250])

NEW = "verify_tmp_user"
# 清理历史残留的测试账号，保证脚本可重复执行
code, r = call("GET", "/api/users")
existing = r if isinstance(r, list) else (r.get("data", []) if isinstance(r, dict) else [])
for u in existing:
    if u.get("username") == NEW:
        call("DELETE", "/api/users/%s" % u.get("id"))
        print("      (已清理残留测试账号 id=%s)" % u.get("id"))

code, r = call("POST", "/api/users", {"username": NEW, "password": "Tmp@12345",
                                     "email": "verify_tmp@example.com", "role": "viewer"})
create_ok = code in (200, 201) and isinstance(r, dict)
check("创建用户", create_ok, "code=%s resp=%s" % (code, str(r)[:150]))
# 响应结构为 {status, message, data:{id,...}}，id 嵌套在 data 内
NEW_ID = None
if create_ok:
    NEW_ID = (r.get("data") or {}).get("id") if isinstance(r.get("data"), dict) else r.get("id")
print("      新建用户 id=%s" % NEW_ID)

code, r = call("POST", "/api/users", {"username": NEW, "password": "Tmp@12345",
                                      "email": "verify_tmp2@example.com", "role": "viewer"})
check("用户名唯一性校验", code == 400, "code=%s" % code)

code, r = call("POST", "/api/users", {"username": "verify_tmp_user2", "password": "Tmp@12345",
                                      "email": "verify_tmp@example.com", "role": "viewer"})
check("邮箱唯一性校验", code == 400, "code=%s" % code)

if NEW_ID is not None:
    code, r = call("PUT", "/api/users/%s" % NEW_ID, {"email": "verify_tmp_new@example.com"})
    check("修改用户", code in (200, 201), "code=%s" % code)

code, r = call("DELETE", "/api/users/1")
check("删除 admin 被保护", code in (400, 403),
      "code=%s msg=%s" % (code, r.get("message", "") if isinstance(r, dict) else ""))

if NEW_ID is not None:
    code, r = call("DELETE", "/api/users/%s" % NEW_ID)
    check("删除用户", code in (200, 201, 204), "code=%s" % code)

# ---------------- 7. 异常路径 ----------------
section("7. 异常路径与状态码")
code, r = call("GET", "/api/not-exist-endpoint")
check("不存在的路径 -> 404", code == 404, "code=%s" % code)

code, r = call("GET", "/api/users", token=False)
check("未授权访问 -> 401", code == 401, "code=%s" % code)

code, r = call("GET", "/api/users/999999")
if code == 404:
    check("不存在的用户ID -> 404", True, "code=404")
else:
    known("不存在的用户ID -> 404",
          "返回%d；UserController 未实现 GET /users/{id}，"
          "路径被 PUT/DELETE 映射捕获后抛方法不匹配" % code)

code, r = call("POST", "/api/alerts/rules/1/toggle")
if code == 405:
    check("HTTP 方法不匹配 -> 405", True, "code=405")
else:
    known("HTTP 方法不匹配 -> 405",
          "返回%d；GlobalExceptionHandler 仅映射 NoResourceFoundException->404，"
          "HttpRequestMethodNotSupportedException 落入通用 Exception->500" % code)

# ---------------- 汇总 ----------------
section("验证汇总")
total = len(results)
passed = sum(1 for _, ok, _ in results if ok)
knowns = [(n, d) for n, ok, d in results if not ok]
print("总用例: %d  |  通过: %d  |  未通过: %d" % (total, passed, total - passed))
if knowns:
    print("\n未通过用例 (均为已定位根因的真实缺陷):")
    for n, d in knowns:
        print("  [KNOWN] %-38s %s" % (n, d))
sys.exit(0 if not knowns else 1)
