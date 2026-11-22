package com.smartagriculture.controller;

import com.smartagriculture.device.DeviceManager;
import com.smartagriculture.model.SensorData;
import com.smartagriculture.repository.SensorDataRepository;
import com.smartagriculture.service.SensorSimulator;
import com.smartagriculture.util.Maps;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 兼容旧版根路径接口（/sensor-data、/device/status 等）。
 */
@RestController
public class RootController {

    private static final Logger log = LoggerFactory.getLogger(RootController.class);

    private final DeviceManager deviceManager;
    private final SensorDataRepository sensorDataRepository;

    public RootController(DeviceManager deviceManager, SensorDataRepository sensorDataRepository) {
        this.deviceManager = deviceManager;
        this.sensorDataRepository = sensorDataRepository;
    }

    @GetMapping("/sensor-data")
    public ResponseEntity<Map<String, Object>> sensorData() {
        try {
            SensorData latest = sensorDataRepository.findLatest();
            if (latest != null) {
                Map<String, Object> row = latest.toMap();
                SensorSimulator.applyRow(row, latest.timestamp);
                return ResponseEntity.ok(row);
            }
            if (!deviceManager.getWsnClient().isConnected()) {
                deviceManager.requestConnectAsync();
            }
            Map<String, Double> sensorData = deviceManager.getSensorData();
            if (sensorData == null || sensorData.isEmpty()) {
                return ResponseEntity.status(404).body(Maps.of("error", "没有可用的传感器数据"));
            }
            LocalDateTime now = LocalDateTime.now();
            SensorData record = SensorData.of(sensorData, now);
            sensorDataRepository.insert(record);
            Map<String, Object> row = record.toMap();
            SensorSimulator.applyRow(row, now);
            return ResponseEntity.ok(row);
        } catch (Exception e) {
            log.error("获取传感器数据失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @GetMapping("/device/status")
    public ResponseEntity<?> deviceStatus() {
        try {
            List<Map<String, Object>> result = new ArrayList<>();
            deviceManager.getDeviceStatus().forEach((type, value) -> result.add(Maps.of(
                    "type", type,
                    "name", value.getOrDefault("name", type),
                    "description", value.getOrDefault("description", ""),
                    "status", value.getOrDefault("status", 0)
            )));
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("获取设备状态失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @PostMapping("/device/connect")
    public ResponseEntity<Map<String, Object>> connect() {
        return ResponseEntity.ok(Maps.of("message", "设备连接成功", "status", "connected"));
    }

    @GetMapping("/api/sensor-data")
    public ResponseEntity<?> apiSensorData() {
        try {
            if (!deviceManager.getWsnClient().isConnected()) {
                deviceManager.requestConnectAsync();
            }
            DeviceManager.SensorSnapshot snapshot = deviceManager.getSensorSnapshot();
            Map<String, Double> sensorData = snapshot.data();
            if (sensorData != null && !sensorData.isEmpty()) {
                // 落库由 BackgroundTasks 定时采样负责，这里只读不写
                LocalDateTime sampledAt = snapshot.timestamp();
                return ResponseEntity.ok(Maps.of(
                        "data", SensorSimulator.apply(sensorData, sampledAt),
                        "source", snapshot.source(),
                        "timestamp", sampledAt.toString()
                ));
            }
            SensorData latest = sensorDataRepository.findLatest();
            if (latest != null) {
                Map<String, Object> row = latest.toMap();
                SensorSimulator.applyRow(row, latest.timestamp);
                return ResponseEntity.ok(Maps.of("data", row, "source", "database"));
            }
            return ResponseEntity.status(500).body(Maps.of("error", "无法获取传感器数据"));
        } catch (Exception e) {
            log.error("获取传感器数据失败: {}", e.getMessage());
            try {
                SensorData latest = sensorDataRepository.findLatest();
                if (latest != null) {
                    Map<String, Object> row = latest.toMap();
                    SensorSimulator.applyRow(row, latest.timestamp);
                    return ResponseEntity.ok(Maps.of("data", row, "source", "database"));
                }
            } catch (Exception ignored) {
                // 数据库同样不可用
            }
            return ResponseEntity.status(500).body(Maps.of("error", "获取传感器数据失败: " + e.getMessage()));
        }
    }

    @GetMapping("/api/export/sensor-data")
    public ResponseEntity<byte[]> exportSensorData(
            @RequestParam(name = "start_time", required = false) String startTime,
            @RequestParam(name = "end_time", required = false) String endTime,
            @RequestParam(name = "metric", required = false) String metric) {
        try {
            LocalDateTime start = HistoryController.parseDateTime(startTime);
            LocalDateTime end = HistoryController.parseEndDateTime(endTime);
            if (start == null) {
                start = LocalDateTime.now().minusDays(7);
            }
            if (end == null) {
                end = LocalDateTime.now();
            }

            List<SensorData> records = sensorDataRepository.findBetweenDesc(start, end);
            StringBuilder csv = new StringBuilder();
            csv.append("时间戳,空气温度(°C),空气湿度(%),土壤温度(°C),土壤湿度(%),光照强度(lux),CO2浓度(ppm)\r\n");
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
            for (SensorData record : records) {
                Map<String, Object> display = record.toMap();
                SensorSimulator.applyRow(display, record.timestamp);
                csv.append(record.timestamp != null ? formatter.format(record.timestamp) : "").append(',');
                csv.append(formatDecimal(display.get("air_temperature"))).append(',');
                csv.append(formatDecimal(display.get("air_humidity"))).append(',');
                csv.append(formatDecimal(display.get("soil_temperature"))).append(',');
                csv.append(formatDecimal(display.get("soil_moisture"))).append(',');
                csv.append(display.get("light_intensity") instanceof Number n ? String.valueOf(n.intValue()) : "").append(',');
                csv.append(display.get("co2_concentration") instanceof Number n ? String.valueOf(n.intValue()) : "").append("\r\n");
            }

            String filename = "sensor_data_" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".csv";
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(new MediaType("text", "csv", StandardCharsets.UTF_8));
            headers.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename);
            log.info("导出传感器数据 {} 条", records.size());
            // 前置 UTF-8 BOM（EF BB BF），保证 Excel 双击打开时中文不乱码
            byte[] content = csv.toString().getBytes(StandardCharsets.UTF_8);
            byte[] body = new byte[content.length + 3];
            body[0] = (byte) 0xEF;
            body[1] = (byte) 0xBB;
            body[2] = (byte) 0xBF;
            System.arraycopy(content, 0, body, 3, content.length);
            return new ResponseEntity<>(body, headers, org.springframework.http.HttpStatus.OK);
        } catch (Exception e) {
            log.error("导出传感器数据失败: {}", e.getMessage());
            return ResponseEntity.status(500)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(("{\"error\":\"" + e.getMessage() + "\"}").getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String formatDecimal(Object value) {
        return value instanceof Number number ? String.format(java.util.Locale.ROOT, "%.1f", number.doubleValue()) : "";
    }
}
