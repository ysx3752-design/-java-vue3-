package com.smartagriculture.controller;

import com.smartagriculture.model.SensorData;
import com.smartagriculture.repository.SensorDataRepository;
import com.smartagriculture.service.SensorSimulator;
import com.smartagriculture.util.Maps;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/history")
public class HistoryController {

    private static final Logger log = LoggerFactory.getLogger(HistoryController.class);

    private final SensorDataRepository sensorDataRepository;

    public HistoryController(SensorDataRepository sensorDataRepository) {
        this.sensorDataRepository = sensorDataRepository;
    }

    @GetMapping("/data")
    public ResponseEntity<?> getHistoryData(
            @RequestParam(name = "start_date", required = false) String startDate,
            @RequestParam(name = "end_date", required = false) String endDate,
            @RequestParam(name = "metric", required = false) String metric) {
        try {
            LocalDateTime start = startDate != null ? parseDateTime(startDate) : LocalDateTime.now().minusDays(1);
            LocalDateTime end = endDate != null ? parseDateTime(endDate) : LocalDateTime.now();
            if (start == null) {
                start = LocalDateTime.now().minusDays(1);
            }
            if (end == null) {
                end = LocalDateTime.now();
            }
            List<Map<String, Object>> data = new ArrayList<>();
            for (SensorData record : sensorDataRepository.findBetween(start, end)) {
                // 硬件离线期间写入的全 0 记录不参与趋势展示，否则会画出假的深坑
                if (isPlaceholder(record)) {
                    continue;
                }
                Map<String, Object> row = record.toMap();
                SensorSimulator.applyRow(row, record.timestamp);
                data.add(row);
            }
            log.info("获取历史数据 {} 条: {} 至 {} (指标: {})", data.size(), start, end, metric);
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            log.error("获取历史数据失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @GetMapping({"", "/"})
    public ResponseEntity<?> getHistoryDataCompat(
            @RequestParam(name = "start_date", required = false) String startDate,
            @RequestParam(name = "end_date", required = false) String endDate,
            @RequestParam(name = "metric", required = false) String metric) {
        return getHistoryData(startDate, endDate, metric);
    }

    @GetMapping("/summary")
    public ResponseEntity<Map<String, Object>> getSummary() {
        try {
            SensorData latest = sensorDataRepository.findLatest();
            if (latest == null) {
                return ResponseEntity.status(404).body(Maps.of("error", "没有历史数据"));
            }
            return ResponseEntity.ok(Maps.of(
                    "id", latest.id,
                    "timestamp", latest.timestamp != null ? latest.timestamp.toString() : null,
                    "air_temperature", latest.air_temperature,
                    "air_humidity", latest.air_humidity,
                    "soil_temperature", latest.soil_temperature,
                    "soil_moisture", latest.soil_moisture,
                    "light_intensity", latest.light_intensity,
                    "co2_concentration", latest.co2_concentration
            ));
        } catch (Exception e) {
            log.error("获取历史数据摘要失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @GetMapping("/sensor-data")
    public ResponseEntity<Map<String, Object>> getHistorySensorData(
            @RequestParam(name = "start_time", required = false) String startTime,
            @RequestParam(name = "end_time", required = false) String endTime,
            @RequestParam(name = "page", defaultValue = "1") int page,
            @RequestParam(name = "page_size", defaultValue = "20") int pageSize) {
        try {
            LocalDateTime start = startTime != null ? parseDateTime(startTime) : LocalDateTime.now().minusDays(7);
            LocalDateTime end = endTime != null ? parseDateTime(endTime) : LocalDateTime.now();
            if (start == null) {
                start = LocalDateTime.now().minusDays(7);
            }
            if (end == null) {
                end = LocalDateTime.now();
            }
            long total = sensorDataRepository.countBetween(start, end);
            int offset = (page - 1) * pageSize;
            List<Map<String, Object>> items = new ArrayList<>();
            for (SensorData record : sensorDataRepository.findPage(start, end, pageSize, offset)) {
                Map<String, Object> row = record.toMap();
                SensorSimulator.applyRow(row, record.timestamp);
                items.add(row);
            }
            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("total", total);
            meta.put("page", page);
            meta.put("page_size", pageSize);
            meta.put("pages", pageSize > 0 ? (int) ((total + pageSize - 1) / pageSize) : 0);
            meta.put("start_time", start.toString());
            meta.put("end_time", end.toString());
            return ResponseEntity.ok(Maps.of("data", items, "meta", meta));
        } catch (Exception e) {
            log.error("获取历史传感器数据失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", "获取历史传感器数据失败"));
        }
    }

    /**
     * 硬件离线期间写入的占位记录（温湿度均为 0）。
     */
    static boolean isPlaceholder(SensorData record) {
        boolean tempEmpty = record.air_temperature == null || record.air_temperature == 0;
        boolean humidityEmpty = record.air_humidity == null || record.air_humidity == 0;
        return tempEmpty && humidityEmpty;
    }

    /**
     * 兼容前端 ISO 时间格式，统一转换为 UTC 本地时间。
     */
    static LocalDateTime parseDateTime(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String text = value.trim();
        try {
            if (text.length() == 10) {
                return LocalDate.parse(text).atStartOfDay();
            }
            if (text.endsWith("Z") || text.contains("+") || text.lastIndexOf('-') > 7) {
                try {
                    return OffsetDateTime.parse(text).withOffsetSameInstant(ZoneOffset.ofHours(8)).toLocalDateTime();
                } catch (DateTimeParseException ignored) {
                    // 继续尝试本地时间格式
                }
            }
            return LocalDateTime.parse(text);
        } catch (DateTimeParseException e) {
            log.warn("无效的时间格式: {}", value);
            return null;
        }
    }
}
