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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

/**
 * 传感器数据的读取与导出接口。
 *
 * <p>{@code /api/sensor-data} 供前端轮询：优先返回实时快照，网关离线时回退数据库最新记录；
 * {@code /api/export/sensor-data} 按时间区间导出 CSV。
 *
 * <p>返回给前端前统一经过 {@link SensorSimulator} 处理（仅在出口叠加波动），
 * 本控制器不写库，落库由后台定时采样完成。
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
