package com.smartagriculture.repository;

import com.smartagriculture.model.SensorData;
import com.smartagriculture.util.DbUtil;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;

@Repository
public class SensorDataRepository {

    private static final RowMapper<SensorData> MAPPER = (rs, rowNum) -> {
        SensorData data = new SensorData();
        data.id = rs.getInt("id");
        data.timestamp = DbUtil.toLocalDateTime(rs.getTimestamp("timestamp"));
        data.air_temperature = DbUtil.nullableDouble(rs, "air_temperature");
        data.air_humidity = DbUtil.nullableDouble(rs, "air_humidity");
        data.soil_temperature = DbUtil.nullableDouble(rs, "soil_temperature");
        data.soil_moisture = DbUtil.nullableDouble(rs, "soil_moisture");
        data.light_intensity = DbUtil.nullableDouble(rs, "light_intensity");
        data.co2_concentration = DbUtil.nullableDouble(rs, "co2_concentration");
        return data;
    };

    private final JdbcTemplate jdbc;

    /**
     * 过滤“网关离线时写入的全 0 占位记录”：
     * 这类记录既不是真实读数，也会让面板显示 0℃/0%、历史曲线掉到谷底。
     */
    private static final String VALID_READING =
            " NOT (COALESCE(air_temperature, 0) = 0 AND COALESCE(air_humidity, 0) = 0) ";

    public SensorDataRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public SensorData findLatest() {
        List<SensorData> list = jdbc.query(
                "SELECT * FROM sensor_data WHERE " + VALID_READING + " ORDER BY timestamp DESC LIMIT 1", MAPPER);
        return list.isEmpty() ? null : list.get(0);
    }

    public int insert(SensorData data) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO sensor_data (timestamp, air_temperature, air_humidity, soil_temperature, "
                            + "soil_moisture, light_intensity, co2_concentration) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setTimestamp(1, DbUtil.toTimestamp(data.timestamp));
            ps.setObject(2, data.air_temperature);
            ps.setObject(3, data.air_humidity);
            ps.setObject(4, data.soil_temperature);
            ps.setObject(5, data.soil_moisture);
            ps.setObject(6, data.light_intensity);
            ps.setObject(7, data.co2_concentration);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key != null) {
            data.id = key.intValue();
        }
        return data.id != null ? data.id : 0;
    }

    public List<SensorData> findBetween(LocalDateTime start, LocalDateTime end) {
        return jdbc.query("SELECT * FROM sensor_data WHERE " + VALID_READING + " AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC",
                MAPPER, DbUtil.toTimestamp(start), DbUtil.toTimestamp(end));
    }

    public List<SensorData> findBetweenDesc(LocalDateTime start, LocalDateTime end) {
        return jdbc.query("SELECT * FROM sensor_data WHERE " + VALID_READING + " AND timestamp BETWEEN ? AND ? ORDER BY timestamp DESC",
                MAPPER, DbUtil.toTimestamp(start), DbUtil.toTimestamp(end));
    }

    public long countBetween(LocalDateTime start, LocalDateTime end) {
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM sensor_data WHERE " + VALID_READING + " AND timestamp BETWEEN ? AND ?",
                Long.class, DbUtil.toTimestamp(start), DbUtil.toTimestamp(end));
        return count != null ? count : 0;
    }

    public List<SensorData> findPage(LocalDateTime start, LocalDateTime end, int pageSize, int offset) {
        return jdbc.query(
                "SELECT * FROM sensor_data WHERE " + VALID_READING + " AND timestamp BETWEEN ? AND ? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                MAPPER, DbUtil.toTimestamp(start), DbUtil.toTimestamp(end), pageSize, offset);
    }
}
