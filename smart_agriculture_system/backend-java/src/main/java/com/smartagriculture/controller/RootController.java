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
                deviceManager.connect();
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
                deviceManager.connect();
            }
            Map<String, Double> sensorData = deviceManager.getSensorData();
            if (sensorData != null && !sensorData.isEmpty()) {
                // 落库由 BackgroundTasks 定时采样负责，这里只读不写
                LocalDateTime now = LocalDateTime.now();
                return ResponseEntity.ok(Maps.of(
                        "data", SensorSimulator.apply(sensorData, now),
                        "source", "realtime",
                        "timestamp", now.toString()
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
            LocalDateTime end = HistoryController.parseDateTime(endTime);
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
                csv.append(record.timestamp != null ? formatter.format(record.timestamp) : "").append(',');
                csv.append(formatDecimal(record.air_temperature)).append(',');
                csv.append(formatDecimal(record.air_humidity)).append(',');
                csv.append(formatDecimal(record.soil_temperature)).append(',');
                csv.append(formatDecimal(record.soil_moisture)).append(',');
                csv.append(record.light_intensity != null ? String.valueOf((int) record.light_intensity.doubleValue()) : "").append(',');
                csv.append(record.co2_concentration != null ? String.valueOf((int) record.co2_concentration.doubleValue()) : "").append("\r\n");
            }

            String filename = "sensor_data_" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".csv";
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(new MediaType("text", "csv", StandardCharsets.UTF_8));
            headers.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename);
            log.info("导出传感器数据 {} 条", records.size());
            return new ResponseEntity<>(csv.toString().getBytes(StandardCharsets.UTF_8), headers, org.springframework.http.HttpStatus.OK);
        } catch (Exception e) {
            log.error("导出传感器数据失败: {}", e.getMessage());
            return ResponseEntity.status(500)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(("{\"error\":\"" + e.getMessage() + "\"}").getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String formatDecimal(Double value) {
        return value != null ? String.format("%.1f", value) : "";
    }
}
