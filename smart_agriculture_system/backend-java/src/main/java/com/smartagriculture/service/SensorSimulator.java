package com.smartagriculture.service;

import com.smartagriculture.config.AppEnv;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 读数波动模拟层。
 *
 * 虚拟仿真平台输出的温湿度是恒定值（如 25.0℃ / 50.0%），历史曲线会是一条直线。
 * 这里在「读取出口」按时间叠加一条昼夜曲线和小幅扰动，使曲线具备真实温室的自然起伏。
 *
 * 设计要点：
 * 1. 不修改数据库，存储值保持不变，仅在返回给前端时做映射；
 * 2. 偏差只由记录时间决定，同一时刻多次读取结果一致，曲线不会来回跳；
 * 3. 仿真平台读到的值视为「日均基准」，波动围绕它展开；
 * 4. 通过 SENSOR_SIMULATE=false 可关闭，恢复原始读数。
 */
public final class SensorSimulator {

    private static final boolean ENABLED = parseEnabled(AppEnv.get("SENSOR_SIMULATE", "true"));

    /** 温度日振幅（±℃） */
    private static final double TEMP_AMPLITUDE = 3.2;
    /** 湿度日振幅（±%），相位与温度相反 */
    private static final double HUMIDITY_AMPLITUDE = 8.0;
    /** 土壤温度振幅，热惯性大所以更小、且滞后约 2 小时 */
    private static final double SOIL_TEMP_AMPLITUDE = 1.5;
    /** 土壤湿度振幅 */
    private static final double SOIL_MOISTURE_AMPLITUDE = 2.5;

    private SensorSimulator() {
    }

    public static boolean enabled() {
        return ENABLED;
    }

    private static boolean parseEnabled(String raw) {
        if (raw == null) {
            return true;
        }
        String value = raw.trim().toLowerCase();
        return !("false".equals(value) || "0".equals(value) || "off".equals(value) || "no".equals(value));
    }

    /**
     * 归一化昼夜曲线：14:00 为 +1（最热），02:00 为 -1（最冷）。
     */
    private static double dayWave(LocalDateTime time) {
        double hour = time.getHour() + time.getMinute() / 60.0;
        return Math.cos((hour - 14.0) / 24.0 * Math.PI * 2);
    }

    /**
     * 日照强度 0~1：6:00 日出、12:00 最强、18:00 日落。
     */
    private static double daylight(LocalDateTime time) {
        double hour = time.getHour() + time.getMinute() / 60.0;
        if (hour < 6 || hour > 18) {
            return 0;
        }
        return Math.sin(Math.PI * (hour - 6) / 12.0);
    }

    /**
     * 由时间戳派生的确定性扰动（-1~1），让曲线不那么工整。
     */
    private static double jitter(LocalDateTime time, int seed) {
        long key = time.getDayOfYear() * 1440L + time.getHour() * 60L + time.getMinute();
        double value = Math.sin((key + seed * 37L) * 12.9898) * 43758.5453;
        return (value - Math.floor(value)) * 2 - 1;
    }

    /**
     * 对实时读数做波动处理。
     */
    public static Map<String, Double> apply(Map<String, Double> data, LocalDateTime time) {
        if (!ENABLED || data == null || data.isEmpty()) {
            return data;
        }
        Map<String, Double> result = new LinkedHashMap<>(data);
        double wave = dayWave(time);
        double light = daylight(time);

        Double temp = result.get("air_temperature");
        if (temp != null) {
            result.put("air_temperature", round1(temp + TEMP_AMPLITUDE * wave + 0.25 * jitter(time, 1)));
        }
        Double humidity = result.get("air_humidity");
        if (humidity != null) {
            result.put("air_humidity", clamp(round1(humidity - HUMIDITY_AMPLITUDE * wave + 0.9 * jitter(time, 2)), 15, 98));
        }
        Double soilTemp = result.get("soil_temperature");
        if (soilTemp != null) {
            result.put("soil_temperature",
                    round1(soilTemp + SOIL_TEMP_AMPLITUDE * dayWave(time.minusHours(2)) + 0.15 * jitter(time, 3)));
        }
        Double soilMoisture = result.get("soil_moisture");
        if (soilMoisture != null) {
            result.put("soil_moisture",
                    clamp(round1(soilMoisture - SOIL_MOISTURE_AMPLITUDE * wave + 0.4 * jitter(time, 4)), 5, 95));
        }
        Double lightIntensity = result.get("light_intensity");
        if (lightIntensity != null) {
            // 夜间保留少量补光，白天接近设定值
            result.put("light_intensity", (double) Math.round(lightIntensity * (0.12 + 0.88 * light)));
        }
        Double co2 = result.get("co2_concentration");
        if (co2 != null) {
            // 夜间植物呼吸 + 通风减弱，浓度略高
            result.put("co2_concentration", (double) Math.round(co2 * (1 + 0.18 * (1 - light))));
        }
        return result;
    }

    /**
     * 对历史记录行做波动处理（就地修改 Map，兼容前端的别名键）。
     */
    public static void applyRow(Map<String, Object> row, LocalDateTime time) {
        if (!ENABLED || row == null || time == null) {
            return;
        }
        Map<String, Double> values = new LinkedHashMap<>();
        for (String key : new String[]{"air_temperature", "air_humidity", "soil_temperature",
                "soil_moisture", "light_intensity", "co2_concentration"}) {
            Object raw = row.get(key);
            if (raw instanceof Number number) {
                values.put(key, number.doubleValue());
            }
        }
        if (values.isEmpty()) {
            return;
        }
        Map<String, Double> adjusted = apply(values, time);
        for (Map.Entry<String, Double> entry : adjusted.entrySet()) {
            row.put(entry.getKey(), entry.getValue());
        }
        // 同步前端使用的别名键
        row.put("temperature", adjusted.get("air_temperature"));
        row.put("humidity", adjusted.get("air_humidity"));
        row.put("co2_level", adjusted.get("co2_concentration"));
    }

    private static double round1(double value) {
        return Math.round(value * 10) / 10.0;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
