# reference — 参考与历史资产

本目录保存**不参与 Java 后端运行**的文件，仅用于硬件联调、接口回归和历史追溯。
主工程（`backend-java/` 与 `frontend/`）不依赖这里的任何文件。

## kv_wsn/

京胜世纪 KPC 虚拟仿真平台的 Python 示例驱动 SDK，包含：

- `link_base.py` — SocketLink 连接封装与设备类型枚举
- `make_command.py` — 命令组帧（继电器、数码管、传感器查询）
- `data_conversion.py` — 响应字节解析
- `custom_thread.py` — 可暂停/恢复的循环线程

Java 后端的 `WsnClient` 已用原生 Socket 重新实现同一套 9 字节帧协议
（命令 `A5 … 5A`，响应 `B5 … 5B`），本目录仅作为协议格式的参考实现保留，
便于排查帧结构问题。

## verify_api.py

基于 `urllib` 的接口回归脚本，覆盖登录、设备控制、传感器数据、历史查询、
告警管理等主要接口。Java 版沿用同一套用例验证重构前后行为一致。

使用前需先启动后端（监听 5000 端口）：

```bash
python reference/verify_api.py
```

## pyrightconfig.json

原 Python 工程的类型检查配置，随 Python 代码一并归档，不再使用。
