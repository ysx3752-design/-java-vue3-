package com.smartagriculture.controller;

import com.smartagriculture.util.Maps;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;

/**
 * 全局异常处理：把未捕获异常统一转换为 {"status":"error","message":"..."} 响应结构。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNotFound(NoResourceFoundException e) {
        return ResponseEntity.status(404).body(Maps.of("error", "接口不存在"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleException(Exception e) {
        log.error("服务器内部错误: {}", e.getMessage(), e);
        return ResponseEntity.status(500).body(Maps.of(
                "error", e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName(),
                "type", e.getClass().getSimpleName()
        ));
    }
}
