package com.smartagriculture.device;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 自动控制管理器：按温湿度、光照、CO2 阈值自动开关设备，每 30 秒执行一次。
 */
@Component
public class AutoControlManager {

    private static final Logger log = LoggerFactory.getLogger(AutoControlManager.class);

    private final DeviceManager deviceManager;
    private final com.smartagriculture.repository.OperationLogRepository logs;

    /** 写日志时用的中文名，避免出现 soil_moisture=15.0 这种英文键。 */
    private static final Map<String, String> SENSOR_LABELS = Map.of(
            "temperature", "空气温度", "humidity", "空气湿度",
            "soil_temperature", "土壤温度", "soil_moisture", "土壤湿度",
            "light", "光照强度", "co2", "CO₂浓度");

    private static final Map<String, String> DEVICE_LABELS = Map.of(
            "water_curtain", "水帘", "internal_fan", "内通风", "external_fan", "外通风",
            "light", "灯光", "spray", "喷灌", "skylight", "天窗",
            "external_shade", "外遮阳", "internal_shade", "内遮阳");

    private final Map<String, double[]> thresholds = new LinkedHashMap<>();
    private final Map<String, String> deviceMapping = new LinkedHashMap<>();

    private volatile boolean running = false;
    private Thread controlThread;

    public AutoControlManager(DeviceManager deviceManager, com.smartagriculture.repository.OperationLogRepository logs) {
        this.deviceManager = deviceManager;
        this.logs = logs;

        thresholds.put("temperature", new double[]{15, 30});
        thresholds.put("humidity", new double[]{40, 80});
        thresholds.put("soil_temperature", new double[]{12, 28});
        thresholds.put("soil_moisture", new double[]{20, 60});
        thresholds.put("light", new double[]{5000, 20000});
        thresholds.put("co2", new double[]{400, 1000});

        deviceMapping.put("temperature", "water_curtain");
        deviceMapping.put("humidity", "internal_fan");
        // 土壤没有独立的地暖/灌溉控制器，分别借补光灯（增温）与喷灌执行
        deviceMapping.put("soil_temperature", "light");
        deviceMapping.put("soil_moisture", "spray");
        deviceMapping.put("light", "light");
        deviceMapping.put("co2", "external_fan");
    }

    public synchronized void start() {
        if (running) {
            log.info("自动控制已经开启");
            return;
        }
        running = true;
        controlThread = new Thread(this::controlLoop, "auto-control");
        controlThread.setDaemon(true);
        controlThread.start();
        log.info("自动控制已启动");
    }

    public synchronized void stop() {
        if (!running) {
            log.info("自动控制已经关闭");
            return;
        }
        running = false;
        if (controlThread != null) {
            controlThread.interrupt();
            controlThread = null;
        }
        log.info("自动控制已停止");
    }

    public boolean isEnabled() {
        return running;
    }

    public synchronized Map<String, Map<String, Double>> getThresholds() {
        Map<String, Map<String, Double>> result = new LinkedHashMap<>();
        for (Map.Entry<String, double[]> entry : thresholds.entrySet()) {
            Map<String, Double> range = new LinkedHashMap<>();
            range.put("min", entry.getValue()[0]);
            range.put("max", entry.getValue()[1]);
            result.put(entry.getKey(), range);
        }
        return result;
    }

    public synchronized boolean updateThresholds(Map<String, double[]> newThresholds) {
        if (newThresholds == null || newThresholds.isEmpty()) {
            return false;
        }
        for (Map.Entry<String, double[]> entry : newThresholds.entrySet()) {
            if (!thresholds.containsKey(entry.getKey()) || entry.getValue() == null || entry.getValue().length != 2) {
                return false;
            }
            double min = entry.getValue()[0];
            double max = entry.getValue()[1];
            if (!Double.isFinite(min) || !Double.isFinite(max) || min >= max) {
                log.warn("阈值设置无效: {} 最小值 {} 大于等于最大值 {}", entry.getKey(), min, max);
                return false;
            }
        }
        for (Map.Entry<String, double[]> entry : newThresholds.entrySet()) {
            thresholds.put(entry.getKey(), entry.getValue().clone());
        }
        log.info("阈值设置已更新: {}", thresholds.keySet());
        return true;
    }

    private void controlLoop() {
        while (running) {
            try {
                if (!deviceManager.getWsnClient().isConnected()) {
                    log.info("自动控制：设备未连接，尝试重新连接");
                    deviceManager.connect();
                }
                DeviceManager.SensorSnapshot snapshot = deviceManager.getSensorSnapshot();
                Map<String, Double> sensorData = snapshot.data();
                if (!sensorData.isEmpty()) {
                    checkThresholds(com.smartagriculture.service.SensorSimulator.apply(sensorData, snapshot.timestamp()));
                }
            } catch (Exception e) {
                log.error("自动控制执行失败: {}", e.getMessage());
            }
            try {
                Thread.sleep(30_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }

    public synchronized Map<String, java.util.List<Map<String, Object>>> getControlRules() {
        Map<String, java.util.List<Map<String, Object>>> result = new LinkedHashMap<>();
        thresholds.forEach((sensor, range) -> {
            // 这三类属于「低值要开设备」：光照不足补光、土温偏低补光增温、土壤偏干灌溉
            boolean lowOpens = "light".equals(sensor) || "soil_temperature".equals(sensor)
                    || "soil_moisture".equals(sensor);
            String lowAction = lowOpens ? "open" : "close";
            String highAction = lowOpens ? "close" : "open";
            result.put(sensor, java.util.List.of(
                    Map.of("threshold_operator", "<", "threshold_value", range[0], "device_type", deviceMapping.get(sensor), "action", lowAction),
                    Map.of("threshold_operator", ">", "threshold_value", range[1], "device_type", deviceMapping.get(sensor), "action", highAction)));
        });
        return result;
    }

    private synchronized void checkThresholds(Map<String, Double> sensorData) {
        if (!running) return;
        Map<String, String> keys = Map.of(
                "temperature", "air_temperature", "humidity", "air_humidity",
                "soil_temperature", "soil_temperature", "soil_moisture", "soil_moisture",
                "light", "light_intensity", "co2", "co2_concentration");
        getControlRules().forEach((sensor, rules) -> {
            Double value = sensorData.get(keys.get(sensor));
            if (value == null || !Double.isFinite(value)) return;
            for (Map<String, Object> rule : rules) {
                double threshold = ((Number) rule.get("threshold_value")).doubleValue();
                boolean matched = "<".equals(rule.get("threshold_operator")) ? value < threshold : value > threshold;
                if (!matched) continue;
                String type = (String) rule.get("device_type"), action = (String) rule.get("action");
                Map<String, Object> status = deviceManager.getDeviceStatus(type);
                int target = "open".equals(action) ? 1 : 0;
                if (status != null && Integer.valueOf(target).equals(status.get("status"))) continue;
                boolean success = false;
                try { success = deviceManager.controlDevice(type, action); }
                catch (Exception e) { log.error("自动控制失败: {}", e.getMessage()); }
                com.smartagriculture.model.OperationLog entry = new com.smartagriculture.model.OperationLog();
                entry.operation_type = "自动控制";
                entry.device_type = type;
                entry.operation_time = java.time.LocalDateTime.now();
                entry.operation_result = success;
                entry.description = SENSOR_LABELS.getOrDefault(sensor, sensor) + " " + value + "，"
                        + ("open".equals(action) ? "开启" : "关闭")
                        + DEVICE_LABELS.getOrDefault(type, type);
                try { logs.insert(entry); }
                catch (Exception e) { log.error("记录自动控制日志失败: {}", e.getMessage()); }
            }
        });
    }
}
