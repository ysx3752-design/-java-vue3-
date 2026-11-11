package com.smartagriculture.repository;

import com.smartagriculture.model.OperationLog;
import com.smartagriculture.util.DbUtil;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;

@Repository
public class OperationLogRepository {

    private static final RowMapper<OperationLog> MAPPER = (rs, rowNum) -> {
        OperationLog log = new OperationLog();
        log.id = rs.getInt("id");
        log.user_id = DbUtil.nullableInt(rs, "user_id");
        log.operation_type = rs.getString("operation_type");
        log.device_type = rs.getString("device_type");
        log.operation_time = DbUtil.toLocalDateTime(rs.getTimestamp("operation_time"));
        log.operation_result = DbUtil.nullableBoolean(rs, "operation_result");
        log.description = rs.getString("description");
        return log;
    };

    private final JdbcTemplate jdbc;

    public OperationLogRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 真正的警报记录：operation_logs 里同时存了手动开关设备和自动控制的流水，
     * 这些属于操作记录而非警报，展示警报时必须排除，否则点一次开关就多一条"警报"。
     */
    private static final String ALERT_FILTER =
            "(operation_type LIKE '%警报%' OR operation_type LIKE '%告警%' OR operation_type LIKE '%alert%')";

    public List<OperationLog> findRecent(int limit) {
        return jdbc.query("SELECT * FROM operation_logs ORDER BY operation_time DESC LIMIT ?", MAPPER, limit);
    }

    /** 最近的真实警报（排除设备开关、自动控制等操作流水）。 */
    public List<OperationLog> findRecentAlerts(int limit) {
        return jdbc.query("SELECT * FROM operation_logs WHERE " + ALERT_FILTER
                + " ORDER BY operation_time DESC LIMIT ?", MAPPER, limit);
    }

    public List<OperationLog> findAutoControl(int limit) {
        return jdbc.query("SELECT * FROM operation_logs WHERE operation_type = ? ORDER BY operation_time DESC LIMIT ?",
                MAPPER, "自动控制", limit);
    }

    public long countUnhandled() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM operation_logs WHERE operation_result = 0", Long.class);
        return count != null ? count : 0;
    }

    /** 未处理的警报数量（只统计真实警报，不含设备开关流水）。 */
    public long countUnhandledAlerts() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM operation_logs WHERE " + ALERT_FILTER
                + " AND operation_result = 0", Long.class);
        return count != null ? count : 0;
    }

    public OperationLog findById(Integer id) {
        List<OperationLog> list = jdbc.query("SELECT * FROM operation_logs WHERE id = ? LIMIT 1", MAPPER, id);
        return list.isEmpty() ? null : list.get(0);
    }

    public void markHandled(Integer id) {
        jdbc.update("UPDATE operation_logs SET operation_result = 1 WHERE id = ?", id);
    }

    public int insert(OperationLog log) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO operation_logs (user_id, operation_type, device_type, operation_time, "
                            + "operation_result, description) VALUES (?, ?, ?, ?, ?, ?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setObject(1, log.user_id);
            ps.setString(2, log.operation_type);
            ps.setObject(3, log.device_type);
            ps.setTimestamp(4, DbUtil.toTimestamp(log.operation_time));
            ps.setObject(5, log.operation_result);
            ps.setString(6, log.description);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key != null) {
            log.id = key.intValue();
        }
        return log.id != null ? log.id : 0;
    }
}
