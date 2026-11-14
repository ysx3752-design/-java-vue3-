package com.smartagriculture.controller;

import com.smartagriculture.config.DeviceConfig;
import com.smartagriculture.device.DeviceManager;
import com.smartagriculture.model.OperationLog;
import com.smartagriculture.model.SensorData;
import com.smartagriculture.repository.DeviceStatusRepository;
import com.smartagriculture.repository.OperationLogRepository;
import com.smartagriculture.repository.SensorDataRepository;
import com.smartagriculture.service.SensorSimulator;
import com.smartagriculture.util.Maps;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/device")
public class DeviceController {

    private static final Logger log = LoggerFactory.getLogger(DeviceController.class);

    private final DeviceManager deviceManager;
    private final SensorDataRepository sensorDataRepository;
    private final OperationLogRepository operationLogRepository;
    private final DeviceStatusRepository deviceStatusRepository;

    public DeviceController(DeviceManager deviceManager,
                            SensorDataRepository sensorDataRepository,
                            OperationLogRepository operationLogRepository,
                            DeviceStatusRepository deviceStatusRepository) {
        this.deviceManager = deviceManager;
        this.sensorDataRepository = sensorDataRepository;
        this.operationLogRepository = operationLogRepository;
        this.deviceStatusRepository = deviceStatusRepository;
    }

    @GetMapping("/devices")
    public ResponseEntity<?> getDevices() {
        try {
            List<Map<String, Object>> devices = new ArrayList<>();
            for (DeviceConfig.Device device : DeviceConfig.DEVICES.values()) {
                devices.add(Maps.of(
                        "type", device.type(),
                        "name", device.name(),
                        "description", device.description()
                ));
            }
            return ResponseEntity.ok(devices);
        } catch (Exception e) {
            log.error("获取设备列表失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", "获取设备列表失败"));
        }
    }

    @PostMapping("/control")
    public ResponseEntity<Map<String, Object>> controlDevice(@RequestBody(required = false) Map<String, Object> data) {
        try {
            log.info("收到控制请求: {}", data);
            if (data == null) {
                return ResponseEntity.badRequest().body(Maps.of("error", "无效的请求数据格式"));
            }
            String deviceType = asString(data.get("device_type"));
            String action = asString(data.get("action"));
            if (deviceType == null || action == null || deviceType.isEmpty() || action.isEmpty()) {
                return ResponseEntity.badRequest().body(Maps.of("error", "设备类型和操作不能为空"));
            }
            if (!"open".equals(action) && !"close".equals(action)) {
                return ResponseEntity.badRequest().body(Maps.of("error",
                        "无效的操作类型: " + action + "，必须是 open 或 close"));
            }
            DeviceConfig.Device device = DeviceConfig.DEVICES.get(deviceType);
            if (device == null) {
                return ResponseEntity.badRequest().body(Maps.of("error", "未知的设备类型: " + deviceType));
            }
            String deviceName = device.name();

            if (!deviceManager.getWsnClient().isConnected()) {
                log.info("设备未连接，尝试连接...");
                if (!deviceManager.connect()) {
                    log.error("无法连接到设备控制器");
                    return ResponseEntity.status(500).body(Maps.of(
                            "error", "无法连接到设备控制器",
                            "message", "请检查虚拟平台是否正常运行"
                    ));
                }
            }

            log.info("执行设备控制: {}({}) {}", deviceName, deviceType, action);
            boolean success = deviceManager.controlDevice(deviceType, action);

            int status = "open".equals(action) ? 1 : 0;
            try {
                if (success) {
                    deviceStatusRepository.upsert(deviceType, status);
                }
                OperationLog operationLog = new OperationLog();
                operationLog.user_id = 0;
                operationLog.operation_type = action;
                operationLog.device_type = deviceType;
                operationLog.operation_time = LocalDateTime.now();
                operationLog.operation_result = success;
                operationLog.description = "执行了" + deviceName + "(" + deviceType + ")的" + action + "操作";
                operationLogRepository.insert(operationLog);
            } catch (Exception e) {
                log.error("记录设备操作日志失败: {}", e.getMessage());
            }

            if (success) {
                Map<String, Object> updatedStatus = deviceManager.getDeviceStatus(deviceType);
                return ResponseEntity.ok(Maps.of(
                        "message", "设备 " + deviceType + " " + action + " 操作成功",
                        "status", updatedStatus,
                        "success", true
                ));
            }
            return ResponseEntity.status(500).body(Maps.of(
                    "error", "设备控制失败",
                    "message", "设备 " + deviceType + " " + action + " 操作失败",
                    "success", false
            ));
        } catch (Exception e) {
            log.error("设备控制错误: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of(
                    "error", "设备控制出错: " + e.getMessage(),
                    "message", "请检查设备连接状态",
                    "success", false
            ));
        }
    }

    @GetMapping("/status")
    public ResponseEntity<?> getDeviceStatus(@RequestParam(name = "device_type", required = false) String deviceType) {
        try {
            Map<String, Map<String, Object>> statuses = deviceManager.getDeviceStatus();
            if (deviceType != null && !deviceType.isEmpty()) {
                Map<String, Object> status = statuses.get(deviceType);
                if (status == null) {
                    return ResponseEntity.status(404).body(Maps.of("error", "未知设备类型: " + deviceType));
                }
                return ResponseEntity.ok(status);
            }
            List<Map<String, Object>> result = new ArrayList<>();
            for (Map.Entry<String, Map<String, Object>> entry : statuses.entrySet()) {
                Map<String, Object> value = entry.getValue();
                result.add(Maps.of(
                        "type", entry.getKey(),
                        "name", value.getOrDefault("name", entry.getKey()),
                        "description", value.getOrDefault("description", ""),
                        "status", value.getOrDefault("status", 0)
                ));
            }
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("获取设备状态失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", "获取设备状态失败: " + e.getMessage()));
        }
    }

    @GetMapping("/sensor-data")
    public ResponseEntity<Map<String, Object>> getSensorData() {
        try {
            SensorData latest = sensorDataRepository.findLatest();
            if (latest == null) {
                return ResponseEntity.status(404).body(Maps.of("error", "没有可用的传感器数据"));
            }
            return ResponseEntity.ok(latest.toMap());
        } catch (Exception e) {
            log.error("获取传感器数据失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", "获取传感器数据失败"));
        }
    }

    @GetMapping("/realtime-sensor-data")
    public ResponseEntity<Map<String, Object>> getRealtimeSensorData() {
        return getPublicSensorData();
    }

    @GetMapping("/public/sensor-data")
    public ResponseEntity<Map<String, Object>> getPublicSensorData() {
        try {
            Map<String, Double> realtimeData = null;
            String connectionError = null;
            try {
                if (!deviceManager.getWsnClient().isConnected()) {
                    // 同上：后台尝试连接，本次请求直接走数据库缓存，不阻塞
                    deviceManager.requestConnectAsync();
                }
                if (deviceManager.getWsnClient().isConnected()) {
                    realtimeData = deviceManager.getSensorData();
                    if (realtimeData != null && !realtimeData.isEmpty()) {
                        // 落库统一交给 BackgroundTasks 的定时采样（默认 2 分钟一条），
                        // 这里只读不写，否则每个页面轮询都会插一条重复记录，历史表几秒一行
                        log.debug("成功获取实时传感器数据");
                    }
                }
            } catch (Exception e) {
                connectionError = e.getMessage();
                log.warn("获取实时传感器数据失败: {}，将尝试返回数据库中的最新数据", e.getMessage());
            }

            if (realtimeData == null || realtimeData.isEmpty()) {
                try {
                    SensorData latest = sensorDataRepository.findLatest();
                    if (latest != null) {
                        log.info("从数据库获取最新传感器数据");
                        Map<String, Object> latestMap = latest.toMap();
                        SensorSimulator.applyRow(latestMap, latest.timestamp);
                        Map<String, Object> result = Maps.of(
                                "data", latestMap,
                                "source", "database",
                                "timestamp", latest.timestamp != null ? latest.timestamp.toString() : null
                        );
                        if (connectionError != null) {
                            result.put("connection_error", connectionError);
                        }
                        return ResponseEntity.ok(result);
                    }
                    log.warn("数据库中没有传感器数据，返回默认值");
                    Map<String, Double> defaultData = new LinkedHashMap<>();
                    defaultData.put("air_temperature", 0.0);
                    defaultData.put("air_humidity", 0.0);
                    defaultData.put("soil_temperature", 0.0);
                    defaultData.put("soil_moisture", 0.0);
                    defaultData.put("light_intensity", 0.0);
                    defaultData.put("co2_concentration", 0.0);
                    return ResponseEntity.ok(Maps.of(
                            "data", defaultData,
                            "source", "default",
                            "connection_error", connectionError != null ? connectionError : "无可用数据"
                    ));
                } catch (Exception dbError) {
                    log.error("从数据库获取传感器数据失败: {}", dbError.getMessage());
                    return ResponseEntity.status(500).body(Maps.of(
                            "error", "获取传感器数据失败: " + dbError.getMessage(),
                            "connection_error", connectionError
                    ));
                }
            }

            LocalDateTime now = LocalDateTime.now();
            Map<String, Double> displayData = SensorSimulator.apply(realtimeData, now);
            return ResponseEntity.ok(Maps.of(
                    "data", displayData,
                    "source", "realtime",
                    "timestamp", now.toString()
            ));
        } catch (Exception e) {
            log.error("处理传感器数据请求失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", "处理传感器数据请求失败: " + e.getMessage()));
        }
    }

    @PostMapping("/connect")
    public ResponseEntity<Map<String, Object>> connectDevice() {
        try {
            if (deviceManager.connect()) {
                return ResponseEntity.ok(Maps.of(
                        "status", "connected",
                        "message", "设备连接成功",
                        "connected", true
                ));
            }
            return ResponseEntity.status(500).body(Maps.of(
                    "status", "disconnected",
                    "message", "设备连接失败",
                    "connected", false
            ));
        } catch (Exception e) {
            log.error("连接设备失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of(
                    "status", "error",
                    "message", "连接设备时出错: " + e.getMessage(),
                    "connected", false
            ));
        }
    }

    @PostMapping("/disconnect")
    public ResponseEntity<Map<String, Object>> disconnectDevice() {
        try {
            boolean isConnected = deviceManager.getWsnClient().isConnected();
            return ResponseEntity.ok(Maps.of(
                    "status", isConnected ? "connected" : "disconnected",
                    "message", "设备保持连接状态，后端自动管理连接"
            ));
        } catch (Exception e) {
            log.error("检查设备连接状态出错: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", "检查设备连接状态出错: " + e.getMessage()));
        }
    }

    @GetMapping("/connection-status")
    public ResponseEntity<Map<String, Object>> getConnectionStatus() {
        try {
            if (!deviceManager.getWsnClient().isConnected()) {
                // 非阻塞：只登记一次后台连接，立即按当前（未连接）状态返回，
                // 避免网关不可达时页面轮询被 10 秒级 TCP 超时拖死
                deviceManager.requestConnectAsync();
            }
            boolean isConnected = deviceManager.getWsnClient().isConnected();
            int totalDevices = deviceManager.getDeviceStatus().size();
            int connectedDevices = isConnected ? (int) deviceManager.getDeviceStatus().values().stream()
                    .filter(device -> device.get("status") != null).count() : 0;
            return ResponseEntity.ok(Maps.of(
                    "status", isConnected ? "connected" : "disconnected",
                    "message", isConnected ? "已连接" : "未连接",
                    "connected", isConnected,
                    "connecting", deviceManager.isConnecting(),
                    "last_connection", deviceManager.getWsnClient().getLastConnectionTime(),
                    "last_communication", deviceManager.getWsnClient().getLastCommunicationTime(),
                    "total_devices", totalDevices,
                    "connected_devices", connectedDevices
            ));
        } catch (Exception e) {
            log.error("获取连接状态失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of(
                    "status", "error",
                    "message", "获取连接状态时出错: " + e.getMessage(),
                    "connected", false,
                    "total_devices", DeviceConfig.DEVICES.size(),
                    "connected_devices", 0
            ));
        }
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
