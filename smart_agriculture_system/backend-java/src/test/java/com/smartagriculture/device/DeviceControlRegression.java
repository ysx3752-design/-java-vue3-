package com.smartagriculture.device;

import com.smartagriculture.controller.DeviceController;
import com.smartagriculture.model.OperationLog;
import com.smartagriculture.repository.DeviceStatusRepository;
import com.smartagriculture.repository.OperationLogRepository;
import com.smartagriculture.repository.SensorDataRepository;
import java.util.Map;

/** Standalone regression checks: uses in-memory doubles, never connects to WSN or MySQL. */
public class DeviceControlRegression {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    private static int status(DeviceManager manager) {
        return ((Number) manager.getDeviceStatus("light").get("status")).intValue();
    }
    private static class Client extends WsnClient {
        boolean connected = true, connectResult = false, sendResult = true, throwOnSend;
        int sends, connects;
        Runnable onSend = () -> {};
        Client() { super("127.0.0.1", 4000); }
        @Override public boolean isConnected() { return connected; }
        @Override public synchronized boolean connect() { connects++; connected = connectResult; return connected; }
        @Override public synchronized boolean sendCommand(String type, String action) {
            sends++; onSend.run();
            if (throwOnSend) throw new IllegalStateException("test transport failure");
            return sendResult;
        }
    }
    public static void main(String[] args) {
        Client client = new Client();
        DeviceManager manager = new DeviceManager(client);
        client.onSend = () -> check(status(manager) == 0, "state changed before send completed");
        check(manager.controlDevice("light", "open"), "successful open rejected");
        check(status(manager) == 1, "successful open not reflected");
        client.onSend = () -> check(status(manager) == 1, "close changed state before send completed");
        client.sendResult = false;
        check(!manager.controlDevice("light", "close"), "failed send reported success");
        check(status(manager) == 1, "failed close changed state");
        client.throwOnSend = true;
        try { manager.controlDevice("light", "close"); throw new AssertionError("exception swallowed"); }
        catch (IllegalStateException expected) { check(status(manager) == 1, "exception changed state"); }
        client.throwOnSend = false;
        client.sendResult = true;
        check(manager.controlDevice("light", "close"), "successful close rejected");
        check(status(manager) == 0, "successful close not reflected");
        int sends = client.sends;
        check(!manager.controlDevice("light", "invalid"), "invalid action accepted");
        check(!manager.controlDevice("unknown", "open"), "unknown device accepted");
        check(client.sends == sends, "invalid input reached transport");
        client.connected = false;
        check(!manager.controlDevice("light", "open"), "connection failure accepted");
        check(client.sends == sends && status(manager) == 0, "connection failure changed state or sent a command");
        client.connected = true;
        client.onSend = () -> {};
        class StatusRepo extends DeviceStatusRepository {
            int writes;
            StatusRepo() { super(null); }
            @Override public int upsert(String type, int status) { writes++; return 1; }
        }
        class Logs extends OperationLogRepository {
            OperationLog last;
            Logs() { super(null); }
            @Override public int insert(OperationLog log) { last = log; return 1; }
        }
        StatusRepo statuses = new StatusRepo();
        Logs logs = new Logs();
        DeviceController controller = new DeviceController(manager, new SensorDataRepository(null), logs, statuses);
        client.sendResult = false;
        check(controller.controlDevice(Map.of("device_type", "light", "action", "open")).getStatusCode().value() == 500,
                "failed send did not reach HTTP error response");
        check(statuses.writes == 0 && Boolean.FALSE.equals(logs.last.operation_result), "failure persisted target state or success log");
        client.sendResult = true;
        check(controller.controlDevice(Map.of("device_type", "light", "action", "open")).getStatusCode().value() == 200,
                "successful request failed");
        check(statuses.writes == 1 && Boolean.TRUE.equals(logs.last.operation_result), "success was not persisted and logged");
        System.out.println("Device control regression checks passed (no network/database access).");
    }
}
