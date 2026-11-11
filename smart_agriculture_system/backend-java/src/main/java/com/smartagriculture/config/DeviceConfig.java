package com.smartagriculture.config;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 硬件与设备配置，与原 Python 后端 hardware_config.py 保持一致。
 */
public final class DeviceConfig {

    public record Device(String type, String name, String description, int relayAddress, int relayPort) {
    }

    public static final String CONTROLLER_IP = AppEnv.get("WSN_HOST", "192.168.12.1");
    public static final int CONTROLLER_PORT = parseInt(AppEnv.get("WSN_PORT", "4000"), 4000);

    private static int parseInt(String value, int defaultValue) {
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    public static final Map<String, Device> DEVICES;

    static {
        Map<String, Device> devices = new LinkedHashMap<>();
        devices.put("external_shade", new Device("external_shade", "外遮阳", "控制温室外部遮阳系统", 0x2001, 1));
        devices.put("internal_shade", new Device("internal_shade", "内遮阳", "控制温室内部遮阳系统", 0x2001, 2));
        devices.put("skylight", new Device("skylight", "天窗", "控制温室顶部天窗", 0x2002, 1));
        devices.put("spray", new Device("spray", "喷灌", "控制温室喷灌系统", 0x2002, 2));
        devices.put("water_curtain", new Device("water_curtain", "水帘", "控制温室水帘系统", 0x2002, 3));
        devices.put("light", new Device("light", "灯光", "控制温室照明系统", 0x2002, 4));
        devices.put("external_fan", new Device("external_fan", "外通风", "控制温室外部通风系统", 0x2001, 3));
        devices.put("internal_fan", new Device("internal_fan", "内通风", "控制温室内部通风系统", 0x2001, 4));
        DEVICES = Collections.unmodifiableMap(devices);
    }

    private DeviceConfig() {
    }
}
