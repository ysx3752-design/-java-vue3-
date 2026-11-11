package com.smartagriculture.controller;

import com.smartagriculture.model.ThresholdSetting;
import com.smartagriculture.repository.OperationLogRepository;
import com.smartagriculture.repository.ThresholdSettingRepository;
import com.smartagriculture.service.AutoControlService;
import com.smartagriculture.util.Maps;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/alerts")
public class AlertController {

    private static final Logger log = LoggerFactory.getLogger(AlertController.class);

    private static final List<String> VALID_TYPES = List.of(
            "temperature", "humidity", "soil_moisture", "soil_temperature", "light_intensity", "co2_level");
    private static final List<String> VALID_OPERATORS = List.of(">", "<", ">=", "<=", "==");

    private final OperationLogRepository operationLogRepository;
    private final ThresholdSettingRepository thresholdSettingRepository;
    private final AutoControlService autoControlService;

    public AlertController(OperationLogRepository operationLogRepository,
                           ThresholdSettingRepository thresholdSettingRepository,
                           AutoControlService autoControlService) {
        this.operationLogRepository = operationLogRepository;
        this.thresholdSettingRepository = thresholdSettingRepository;
        this.autoControlService = autoControlService;
    }

    @GetMapping("/recent")
    public ResponseEntity<?> recent(@RequestParam(name = "limit", defaultValue = "5") int limit) {
        try {
            List<Map<String, Object>> alerts = new ArrayList<>();
            operationLogRepository.findRecentAlerts(limit).forEach(operationLog -> {
                String type = operationLog.operation_type != null ? operationLog.operation_type : "";
                boolean unhandled = type.toLowerCase().contains("error")
                        || operationLog.operation_result == null
                        || !operationLog.operation_result;
                alerts.add(Maps.of(
                        "id", operationLog.id,
                        "time", operationLog.operation_time != null ? operationLog.operation_time.toString() : null,
                        "type", operationLog.operation_type,
                        "description", operationLog.description,
                        "status", unhandled ? "未处理" : "已处理"
                ));
            });
            return ResponseEntity.ok(alerts);
        } catch (Exception e) {
            log.error("获取最近警报失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @PutMapping("/handle/{alertId}")
    public ResponseEntity<Map<String, Object>> handle(@PathVariable Integer alertId) {
        try {
            if (operationLogRepository.findById(alertId) == null) {
                return ResponseEntity.status(404).body(Maps.of("error", "未找到警报记录"));
            }
            operationLogRepository.markHandled(alertId);
            return ResponseEntity.ok(Maps.of(
                    "id", alertId,
                    "status", "已处理",
                    "message", "警报已标记为已处理"
            ));
        } catch (Exception e) {
            log.error("标记警报为已处理失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @GetMapping("/count")
    public ResponseEntity<Map<String, Object>> count() {
        try {
            return ResponseEntity.ok(Maps.of("count", operationLogRepository.countUnhandledAlerts()));
        } catch (Exception e) {
            log.error("获取警报数量失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @GetMapping("/rules")
    public ResponseEntity<?> getRules() {
        try {
            List<Map<String, Object>> rules = new ArrayList<>();
            for (ThresholdSetting setting : thresholdSettingRepository.findAll()) {
                rules.add(setting.toMap());
            }
            return ResponseEntity.ok(rules);
        } catch (Exception e) {
            log.error("获取警报规则失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @GetMapping("/rules/{ruleId}")
    public ResponseEntity<Map<String, Object>> getRule(@PathVariable Integer ruleId) {
        try {
            ThresholdSetting setting = thresholdSettingRepository.findById(ruleId);
            if (setting == null) {
                return ResponseEntity.status(404).body(Maps.of("error", "未找到警报规则"));
            }
            return ResponseEntity.ok(setting.toMap());
        } catch (Exception e) {
            log.error("获取警报规则失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @PostMapping("/rules")
    public ResponseEntity<Map<String, Object>> createRule(@RequestBody(required = false) Map<String, Object> data,
                                                          HttpServletRequest request) {
        try {
            if (data == null || data.isEmpty()) {
                return ResponseEntity.badRequest().body(Maps.of("error", "未收到有效的请求数据"));
            }
            for (String field : List.of("name", "type", "operator", "threshold")) {
                if (!data.containsKey(field)) {
                    return ResponseEntity.badRequest().body(Maps.of("error", "缺少必填字段: " + field));
                }
            }
            Double threshold = parseDouble(data.get("threshold"));
            if (threshold == null) {
                return ResponseEntity.badRequest().body(Maps.of("error", "阈值必须为数值类型"));
            }
            String operator = String.valueOf(data.get("operator"));
            if (!VALID_OPERATORS.contains(operator)) {
                return ResponseEntity.badRequest().body(Maps.of("error",
                        "无效的操作符，支持的操作符: " + String.join(", ", VALID_OPERATORS)));
            }
            String type = String.valueOf(data.get("type"));
            if (!VALID_TYPES.contains(type)) {
                return ResponseEntity.badRequest().body(Maps.of("error",
                        "无效的监测类型，支持的类型: " + String.join(", ", VALID_TYPES)));
            }

            ThresholdSetting rule = new ThresholdSetting();
            rule.name = String.valueOf(data.get("name"));
            rule.type = type;
            rule.operator = operator;
            rule.threshold = threshold;
            rule.enabled = data.containsKey("enabled") ? asBoolean(data.get("enabled"), true) : Boolean.TRUE;
            rule.user_id = identity(request);
            rule.create_time = LocalDateTime.now();
            rule.update_time = LocalDateTime.now();
            thresholdSettingRepository.insert(rule);
            return ResponseEntity.status(201).body(rule.toMap());
        } catch (Exception e) {
            log.error("创建警报规则失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", "创建警报规则失败: " + e.getMessage()));
        }
    }

    @PutMapping("/rules/{ruleId}")
    public ResponseEntity<Map<String, Object>> updateRule(@PathVariable Integer ruleId,
                                                          @RequestBody(required = false) Map<String, Object> data) {
        try {
            if (data == null || data.isEmpty()) {
                return ResponseEntity.badRequest().body(Maps.of("error", "未收到有效的请求数据"));
            }
            ThresholdSetting rule = thresholdSettingRepository.findById(ruleId);
            if (rule == null) {
                return ResponseEntity.status(404).body(Maps.of("error", "未找到警报规则"));
            }

            if (data.containsKey("name")) {
                rule.name = String.valueOf(data.get("name"));
            }
            if (data.containsKey("type")) {
                String type = String.valueOf(data.get("type"));
                if (!VALID_TYPES.contains(type)) {
                    return ResponseEntity.badRequest().body(Maps.of("error",
                            "无效的监测类型，支持的类型: " + String.join(", ", VALID_TYPES)));
                }
                rule.type = type;
            }
            if (data.containsKey("operator")) {
                String operator = String.valueOf(data.get("operator"));
                if (!VALID_OPERATORS.contains(operator)) {
                    return ResponseEntity.badRequest().body(Maps.of("error",
                            "无效的操作符，支持的操作符: " + String.join(", ", VALID_OPERATORS)));
                }
                rule.operator = operator;
            }
            if (data.containsKey("threshold")) {
                Double threshold = parseDouble(data.get("threshold"));
                if (threshold == null) {
                    return ResponseEntity.badRequest().body(Maps.of("error", "阈值必须为数值类型"));
                }
                rule.threshold = threshold;
            }
            if (data.containsKey("enabled")) {
                rule.enabled = asBoolean(data.get("enabled"), false);
            }
            rule.update_time = LocalDateTime.now();
            thresholdSettingRepository.update(rule);
            return ResponseEntity.ok(rule.toMap());
        } catch (Exception e) {
            log.error("更新警报规则失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", "更新警报规则失败: " + e.getMessage()));
        }
    }

    @DeleteMapping("/rules/{ruleId}")
    public ResponseEntity<Map<String, Object>> deleteRule(@PathVariable Integer ruleId) {
        try {
            if (thresholdSettingRepository.findById(ruleId) == null) {
                return ResponseEntity.status(404).body(Maps.of("error", "未找到警报规则"));
            }
            thresholdSettingRepository.delete(ruleId);
            return ResponseEntity.ok(Maps.of("message", "删除成功"));
        } catch (Exception e) {
            log.error("删除警报规则失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @PutMapping("/rules/{ruleId}/toggle")
    public ResponseEntity<Map<String, Object>> toggleRule(@PathVariable Integer ruleId) {
        try {
            ThresholdSetting rule = thresholdSettingRepository.findById(ruleId);
            if (rule == null) {
                return ResponseEntity.status(404).body(Maps.of("error", "未找到警报规则"));
            }
            rule.enabled = rule.enabled == null || !rule.enabled;
            rule.update_time = LocalDateTime.now();
            thresholdSettingRepository.update(rule);
            log.info("已切换警报规则 {} 的状态为 {}", ruleId, rule.enabled ? "启用" : "禁用");
            return ResponseEntity.ok(Maps.of(
                    "id", rule.id,
                    "enabled", rule.enabled,
                    "message", "警报规则已" + (rule.enabled ? "启用" : "禁用")
            ));
        } catch (Exception e) {
            log.error("切换警报规则状态失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", "切换警报规则状态失败: " + e.getMessage()));
        }
    }

    @GetMapping("/auto-control/rules")
    public ResponseEntity<?> getAutoControlRules() {
        try {
            List<Map<String, Object>> rules = new ArrayList<>();
            autoControlService.getControlRules().forEach((sensorType, typeRules) -> typeRules.forEach(rule ->
                    rules.add(Maps.of(
                            "sensor_type", sensorType,
                            "operator", rule.get("threshold_operator"),
                            "threshold", rule.get("threshold_value"),
                            "device_type", rule.get("device_type"),
                            "action", rule.get("action")
                    ))));
            return ResponseEntity.ok(rules);
        } catch (Exception e) {
            log.error("获取自动控制规则失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    @GetMapping("/auto-control/logs")
    public ResponseEntity<?> getAutoControlLogs(@RequestParam(name = "limit", defaultValue = "10") int limit) {
        try {
            List<Map<String, Object>> result = new ArrayList<>();
            operationLogRepository.findAutoControl(limit).forEach(operationLog -> result.add(Maps.of(
                    "id", operationLog.id,
                    "time", operationLog.operation_time != null ? operationLog.operation_time.toString() : null,
                    "device_type", operationLog.device_type,
                    "description", operationLog.description,
                    "result", operationLog.operation_result
            )));
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("获取自动控制日志失败: {}", e.getMessage());
            return ResponseEntity.status(500).body(Maps.of("error", e.getMessage()));
        }
    }

    private static Double parseDouble(Object value) {
        if (value instanceof Number n) {
            return n.doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(value));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static boolean asBoolean(Object value, boolean defaultValue) {
        if (value instanceof Boolean b) {
            return b;
        }
        if (value instanceof Number n) {
            return n.intValue() != 0;
        }
        if (value instanceof String s) {
            return "true".equalsIgnoreCase(s) || "1".equals(s);
        }
        return defaultValue;
    }

    private static Integer identity(HttpServletRequest request) {
        Object identity = request.getAttribute("auth_identity");
        if (identity == null) {
            return null;
        }
        try {
            return Integer.parseInt(String.valueOf(identity));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
