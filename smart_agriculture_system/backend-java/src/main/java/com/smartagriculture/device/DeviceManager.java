package com.smartagriculture.device;

import com.smartagriculture.config.DeviceConfig;
import com.smartagriculture.util.Maps;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 设备管理器：负责设备连接、状态维护、控制与传感器数据缓存。
 */
@Component
public class DeviceManager {

    private static final Logger log = LoggerFactory.getLogger(DeviceManager.class);

    private final WsnClient wsnClient;

    private final Map<String, Map<String, Object>> deviceStatus = new LinkedHashMap<>();
    private final Object statusLock = new Object();
    private Map<String, Double> cachedSensorData;
    private long lastSensorUpdate = 0;
    private final long sensorCacheSeconds = 110;

    /** 异步连接线程：负责在后台尝试连接，避免 HTTP 请求线程被 TCP 超时拖住。 */
    private final ExecutorService connectExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "wsn-connect");
        thread.setDaemon(true);
        return thread;
    });
    /** 是否有连接尝试正在进行，用于去重，避免刷页面时并发堆积连接任务。 */
    private final AtomicBoolean connecting = new AtomicBoolean(false);

    public DeviceManager() {
        this(new WsnClient(DeviceConfig.CONTROLLER_IP, DeviceConfig.CONTROLLER_PORT));
    }

    DeviceManager(WsnClient wsnClient) {
        this.wsnClient = wsnClient;
        initDeviceStatus();
    }

    private void initDeviceStatus() {
        for (DeviceConfig.Device device : DeviceConfig.DEVICES.values()) {
            deviceStatus.put(device.type(), Maps.of(
                    "status", 0,
                    "name", device.name(),
                    "description", device.description(),
                    "type", device.type()
            ));
        }
    }

    public WsnClient getWsnClient() {
        return wsnClient;
    }

    public synchronized boolean connect() {
        boolean result = wsnClient.connect();
        if (!result) {
            log.error("设备管理器连接失败");
            return false;
        }
        updateAllDeviceStatus();
        initRelayCache();
        log.info("设备管理器初始化完成");
        return true;
    }

    public boolean isConnecting() {
        return connecting.get();
    }

    /**
     * 非阻塞地发起一次连接。已在连接中或已连接时直接返回，调用方拿到的始终是当前状态，
     * 不会因为 WSN 网关不可达而等待数十秒。
     */
    public void requestConnectAsync() {
        if (wsnClient.isConnected() || !connecting.compareAndSet(false, true)) {
            return;
        }
        connectExecutor.submit(() -> {
            try {
                connect();
            } catch (Exception e) {
                log.error("异步连接设备失败: {}", e.getMessage());
            } finally {
                connecting.set(false);
            }
        });
    }

    public void initRelayCache() {
        // 依据当前设备状态初始化继电器状态缓存，与原实现一致，不逐个查询硬件
        Map<Integer, int[]> relayStatus = new LinkedHashMap<>();
        for (DeviceConfig.Device device : DeviceConfig.DEVICES.values()) {
            relayStatus.computeIfAbsent(device.relayAddress(), key -> new int[4]);
        }
        for (DeviceConfig.Device device : DeviceConfig.DEVICES.values()) {
            int portIndex = device.relayPort() - 1;
            if (portIndex < 0 || portIndex >= 4) {
                continue;
            }
            Map<String, Object> info = getDeviceStatus(device.type());
            Object value = info != null ? info.get("status") : null;
            if (value instanceof Number number) {
                relayStatus.get(device.relayAddress())[portIndex] = number.intValue();
            }
        }
        for (Map.Entry<Integer, int[]> entry : relayStatus.entrySet()) {
            wsnClient.seedRelayStatusCache(entry.getKey(), entry.getValue());
        }
        log.info("初始化了 {} 个继电器的状态缓存", relayStatus.size());
    }

    public synchronized void updateAllDeviceStatus() {
        for (String deviceType : DeviceConfig.DEVICES.keySet()) {
            if (!wsnClient.isConnected()) {
                continue;
            }
            Integer status = queryDeviceStatus(deviceType);
            if (status == null) {
                continue;
            }
            synchronized (statusLock) {
                Map<String, Object> info = deviceStatus.get(deviceType);
                if (info != null) {
                    info.put("status", status);
                }
            }
        }
        wsnClient.ping();
    }

    public synchronized Integer queryDeviceStatus(String deviceType) {
        return wsnClient.queryDeviceStatus(deviceType);
    }

    public synchronized boolean controlDevice(String deviceType, String action) {
        DeviceConfig.Device device = DeviceConfig.DEVICES.get(deviceType);
        if (device == null) {
            log.error("未知的设备类型: {}", deviceType);
            return false;
        }
        if (!"open".equalsIgnoreCase(action) && !"close".equalsIgnoreCase(action)) {
            log.error("无效的设备操作: {}", action);
            return false;
        }
        if (!wsnClient.isConnected() && !wsnClient.connect()) {
            log.error("设备管理器未连接，无法控制设备");
            return false;
        }
        boolean result = wsnClient.sendCommand(deviceType, action);
        if (!result) {
            log.error("设备 {} 执行 {} 操作失败", deviceType, action);
            return false;
        }
        int status = "open".equalsIgnoreCase(action) ? 1 : 0;
        synchronized (statusLock) {
            Map<String, Object> info = deviceStatus.get(deviceType);
            if (info != null) {
                info.put("status", status);
            }
        }
        return true;
    }

    /**
     * 获取传感器数据，带 110 秒缓存。
     * 未连接时直接返回缓存/空数据，不触发 TCP 连接，保证接口快速返回。
     */
    public Map<String, Double> getSensorData() {
        if (!wsnClient.isConnected()) {
            if (cachedSensorData != null && !isPlaceholder(cachedSensorData)) {
                return new LinkedHashMap<>(cachedSensorData);
            }
            // 返回空 map：调用方据此回退到数据库最新值，而不是把全 0 当成真实读数
            return new LinkedHashMap<>();
        }
        synchronized (this) {
            long now = System.currentTimeMillis() / 1000;
            if (cachedSensorData != null && now - lastSensorUpdate < sensorCacheSeconds) {
                log.info("使用缓存的传感器数据");
                return new LinkedHashMap<>(cachedSensorData);
            }
            Map<String, Double> raw = wsnClient.getSensorData();
            Map<String, Double> processed = processSensorData(raw);
            cachedSensorData = new LinkedHashMap<>(processed);
            lastSensorUpdate = now;
            return processed;
        }
    }

    /** 温度与湿度同时为 0，说明是网关离线时的占位值，不是真实读数。 */
    private boolean isPlaceholder(Map<String, Double> data) {
        Double temperature = data.get("air_temperature");
        Double humidity = data.get("air_humidity");
        return temperature != null && humidity != null && temperature == 0.0 && humidity == 0.0;
    }

    private Map<String, Double> processSensorData(Map<String, Double> raw) {
        Map<String, Double> processed = new LinkedHashMap<>();
        processed.put("air_temperature", 0.0);
        processed.put("air_humidity", 0.0);
        processed.put("soil_temperature", 0.0);
        processed.put("soil_moisture", 0.0);
        processed.put("light_intensity", 0.0);
        processed.put("co2_concentration", 0.0);
        if (raw != null) {
            for (Map.Entry<String, Double> entry : raw.entrySet()) {
                if (entry.getKey().startsWith("_")) {
                    continue;
                }
                processed.put(entry.getKey(), entry.getValue());
            }
        }
        return processed;
    }

    public Map<String, Map<String, Object>> getDeviceStatus() {
        synchronized (statusLock) {
            Map<String, Map<String, Object>> copy = new LinkedHashMap<>();
            for (Map.Entry<String, Map<String, Object>> entry : deviceStatus.entrySet()) {
                copy.put(entry.getKey(), new LinkedHashMap<>(entry.getValue()));
            }
            return copy;
        }
    }

    public Map<String, Object> getDeviceStatus(String deviceType) {
        synchronized (statusLock) {
            Map<String, Object> info = deviceStatus.get(deviceType);
            return info != null ? new LinkedHashMap<>(info) : null;
        }
    }
}
