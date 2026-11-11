package com.smartagriculture.service;

import com.smartagriculture.config.AppEnv;
import com.smartagriculture.device.DeviceManager;
import com.smartagriculture.model.SensorData;
import com.smartagriculture.repository.SensorDataRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Map;

/**
 * 后台任务：硬件连接、连接监控与传感器数据定时采集。
 */
@Component
public class BackgroundTasks {

    private static final Logger log = LoggerFactory.getLogger(BackgroundTasks.class);

    private final DeviceManager deviceManager;
    private final SensorDataRepository sensorDataRepository;
    private final MonitorService monitorService;

    public BackgroundTasks(DeviceManager deviceManager,
                           SensorDataRepository sensorDataRepository,
                           MonitorService monitorService) {
        this.deviceManager = deviceManager;
        this.sensorDataRepository = sensorDataRepository;
        this.monitorService = monitorService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        Thread hardwareThread = new Thread(this::initHardware, "hardware-init");
        hardwareThread.setDaemon(true);
        hardwareThread.start();

        Thread monitorThread = new Thread(this::monitorLoop, "sensor-monitor");
        monitorThread.setDaemon(true);
        monitorThread.start();
    }

    private void initHardware() {
        boolean connected = deviceManager.connect();
        if (connected) {
            log.info("硬件设备连接成功");
            startWatchdog();
            return;
        }
        log.error("硬件设备连接失败，启动重试任务");
        Thread retryThread = new Thread(this::retryConnect, "hardware-retry");
        retryThread.setDaemon(true);
        retryThread.start();
    }

    private void retryConnect() {
        for (int attempt = 1; attempt <= 10; attempt++) {
            sleep(30_000);
            log.info("尝试重新连接设备 ({}/10)", attempt);
            if (deviceManager.connect()) {
                log.info("设备重连成功");
                startWatchdog();
                return;
            }
        }
        log.error("设备重连失败，请检查设备电源和网络连接");
    }

    private void startWatchdog() {
        Thread watchdog = new Thread(this::watchdogLoop, "connection-watchdog");
        watchdog.setDaemon(true);
        watchdog.start();
    }

    private void watchdogLoop() {
        while (true) {
            sleep(600_000);
            try {
                if (!deviceManager.getWsnClient().isConnected()) {
                    log.warn("检测到设备连接断开，尝试重新连接");
                    deviceManager.connect();
                }
            } catch (Exception e) {
                log.error("连接监控任务异常: {}", e.getMessage());
            }
        }
    }

    private void monitorLoop() {
        while (true) {
            sleep(sampleIntervalMs());
            try {
                Map<String, Double> sensorData = deviceManager.getSensorData();
                if (sensorData == null || sensorData.isEmpty()) {
                    log.warn("未获取到传感器数据，跳过本次采集");
                    continue;
                }
                SensorData record = SensorData.of(sensorData, LocalDateTime.now());
                sensorDataRepository.insert(record);
                log.info("已保存传感器数据: 温度={}°C, 湿度={}%",
                        record.air_temperature, record.air_humidity);
                // 阈值判断用与页面展示一致的波动后数值，避免"显示已超限却不报警"
                monitorService.checkThresholds(SensorSimulator.apply(sensorData, record.timestamp));
            } catch (Exception e) {
                log.error("传感器数据采集任务失败: {}", e.getMessage());
            }
        }
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * 定时采样间隔，可通过 SENSOR_SAMPLE_SECONDS 调整，默认 120 秒。
     * 该值决定历史数据表的记录密度。
     */
    private static long sampleIntervalMs() {
        String raw = AppEnv.get("SENSOR_SAMPLE_SECONDS", "120");
        try {
            long seconds = Long.parseLong(raw.trim());
            if (seconds >= 10) {
                return seconds * 1000L;
            }
            log.warn("SENSOR_SAMPLE_SECONDS={} 过小，已回退到 120 秒", raw);
        } catch (NumberFormatException e) {
            log.warn("SENSOR_SAMPLE_SECONDS={} 不是有效数字，已回退到 120 秒", raw);
        }
        return 120_000L;
    }
}
