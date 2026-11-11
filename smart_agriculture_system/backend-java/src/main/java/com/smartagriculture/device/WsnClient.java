package com.smartagriculture.device;

import com.smartagriculture.config.DeviceConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * WSN 虚拟平台 TCP 客户端，协议实现与原 Python 版本保持一致。
 */
public class WsnClient {

    private static final Logger log = LoggerFactory.getLogger(WsnClient.class);

    private final String configuredHost;
    private final int port;
    /** 实际连通的地址：仿真平台重启后 IP 可能变化，连上即记录，下次优先使用。 */
    private volatile String activeHost;
    /** 连接重试次数：保持较小值，避免请求线程被长时间占用（重连交给后台任务）。 */
    private final int connectionRetries = 2;
    private final int retryDelayMs = 1000;
    /** 单次 TCP 连接超时（毫秒）。 */
    private static final int CONNECT_TIMEOUT_MS = 4_000;
    /** 自动发现本机网卡地址时的探测超时：本机端口通常立即拒绝，不需要等满 4 秒。 */
    private static final int DISCOVERY_TIMEOUT_MS = 1_200;

    private Socket socket;
    private volatile boolean connected = false;
    private volatile String lastConnectionTime;
    private volatile String lastCommunicationTime;

    /** 继电器状态缓存：继电器地址 -> 4 个通道状态 */
    private final Map<Integer, int[]> relayStatusCache = new HashMap<>();

    public WsnClient(String host, int port) {
        this.configuredHost = host;
        this.port = port;
    }

    public String getHost() {
        return activeHost != null ? activeHost : configuredHost;
    }

    public int getPort() {
        return port;
    }

    public boolean isConnected() {
        return connected;
    }

    public String getLastConnectionTime() {
        return lastConnectionTime;
    }

    public String getLastCommunicationTime() {
        return lastCommunicationTime;
    }

    public synchronized boolean connect() {
        List<String> candidates = candidateHosts();
        for (String candidate : candidates) {
            boolean preferred = candidate.equals(configuredHost);
            int attempts = preferred ? connectionRetries : 1;
            int timeout = preferred ? CONNECT_TIMEOUT_MS : DISCOVERY_TIMEOUT_MS;
            for (int attempt = 1; attempt <= attempts; attempt++) {
                try {
                    closeSocket();
                    Socket newSocket = new Socket();
                    newSocket.connect(new InetSocketAddress(candidate, port), timeout);
                    newSocket.setSoTimeout(10_000);
                    socket = newSocket;
                    connected = true;
                    lastConnectionTime = nowIso();
                    lastCommunicationTime = lastConnectionTime;
                    relayStatusCache.clear();
                    activeHost = candidate;
                    if (!preferred) {
                        log.warn("配置的网关 {}:{} 不可达，已自动切换到本机仿真平台 {}:{}（建议把 .env 的 WSN_HOST 改为该地址）",
                                configuredHost, port, candidate, port);
                    }
                    log.info("成功连接到WSN网络: {}:{}", candidate, port);
                    pingOnConnect();
                    return true;
                } catch (SocketTimeoutException e) {
                    log.warn("连接WSN网络超时 {}:{} (尝试 {}/{})", candidate, port, attempt, attempts);
                } catch (Exception e) {
                    log.warn("连接WSN网络失败 {}:{}: {} (尝试 {}/{})", candidate, port, e.getMessage(), attempt, attempts);
                }
                if (attempt < attempts) {
                    sleep(retryDelayMs);
                }
            }
        }
        connected = false;
        log.error("无法连接到WSN网络，已尝试地址: {}，请确认仿真平台已启动并查看其网关面板显示的 IP:Port", candidates);
        return false;
    }

    /**
     * 候选网关地址：已连通的地址 → .env 配置地址 → 本机回环与各网卡 IPv4。
     * 京胜世纪 KPC 仿真平台的 WSN 服务只绑定在它当前使用的网卡上，
     * 每次启动 IP 可能变化（如 10.42.67.35 → 10.41.225.116），因此这里做本机自动发现。
     */
    private List<String> candidateHosts() {
        Set<String> hosts = new LinkedHashSet<>();
        if (activeHost != null && !activeHost.isBlank()) {
            hosts.add(activeHost);
        }
        if (configuredHost != null && !configuredHost.isBlank()) {
            hosts.add(configuredHost);
        }
        hosts.add("127.0.0.1");
        hosts.addAll(localIpv4Addresses());
        return new ArrayList<>(hosts);
    }

    /** 枚举本机所有可用网卡的 IPv4 地址（跳过回环与 169.254 链路本地地址）。 */
    private List<String> localIpv4Addresses() {
        List<String> addresses = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface networkInterface = interfaces.nextElement();
                if (!networkInterface.isUp() || networkInterface.isLoopback()) {
                    continue;
                }
                Enumeration<InetAddress> inetAddresses = networkInterface.getInetAddresses();
                while (inetAddresses.hasMoreElements()) {
                    InetAddress address = inetAddresses.nextElement();
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()
                            && !address.isLinkLocalAddress()) {
                        addresses.add(address.getHostAddress());
                    }
                }
            }
        } catch (Exception e) {
            log.debug("枚举本机网卡地址失败: {}", e.getMessage());
        }
        return addresses;
    }

    private void pingOnConnect() {
        try {
            byte[] pingCommand = {(byte) 0xA5, 0x00, 0x00, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, 0x5A};
            socket.getOutputStream().write(pingCommand);
            socket.getOutputStream().flush();
            socket.setSoTimeout(2000);
            byte[] response = readOnce();
            if (response.length > 0) {
                lastCommunicationTime = nowIso();
                log.info("收到Ping响应: {}", hex(response));
            }
        } catch (SocketTimeoutException e) {
            log.warn("Ping响应超时，但继续连接");
        } catch (Exception e) {
            log.warn("Ping测试失败，但仍继续: {}", e.getMessage());
        }
    }

    public synchronized void disconnect() {
        closeSocket();
        connected = false;
        log.info("已断开WSN网络连接");
    }

    private void closeSocket() {
        if (socket != null) {
            try {
                socket.close();
            } catch (Exception ignored) {
                // 忽略关闭异常
            }
            socket = null;
        }
    }

    public synchronized int[] getCurrentRelayStatus(int relayId) {
        int[] cached = relayStatusCache.get(relayId);
        if (cached != null) {
            return cached.clone();
        }
        return new int[]{0, 0, 0, 0};
    }

    public synchronized void seedRelayStatusCache(int relayId, int[] status) {
        relayStatusCache.put(relayId, status.clone());
    }

    /**
     * 用广播查询读取两块继电器板的真实通道状态并刷新缓存。
     * 回帧格式：B5 20 [板地址] [通道1..4] FF 5B，一块板一帧。
     * 控制在执行前先同步，避免用陈旧缓存把同板其它通道误关。
     */
    public synchronized void syncRelayStatusFromHardware() {
        if (!connected || socket == null) {
            return;
        }
        try {
            byte[] command = {(byte) 0xA5, 0x00, 0x00, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, 0x5A};
            drainInputBuffer();
            socket.setSoTimeout(1500);
            socket.getOutputStream().write(command);
            socket.getOutputStream().flush();
            lastCommunicationTime = nowIso();

            byte[] data = new byte[0];
            byte[] buffer = new byte[1024];
            long start = System.currentTimeMillis();
            while (System.currentTimeMillis() - start < 1500) {
                try {
                    int read = socket.getInputStream().read(buffer);
                    if (read <= 0) {
                        break;
                    }
                    byte[] merged = new byte[data.length + read];
                    System.arraycopy(data, 0, merged, 0, data.length);
                    System.arraycopy(buffer, 0, merged, data.length, read);
                    data = merged;
                    if (data.length >= 9 * 6) {
                        break;
                    }
                } catch (SocketTimeoutException e) {
                    break;
                }
            }

            for (int i = 0; i <= data.length - 9; i += 9) {
                if ((data[i] & 0xFF) != 0xB5 || (data[i + 8] & 0xFF) != 0x5B) {
                    continue;
                }
                if ((data[i + 1] & 0xFF) != 0x20) {
                    continue;
                }
                int address = 0x2000 | (data[i + 2] & 0xFF);
                int[] status = new int[4];
                for (int channel = 0; channel < 4; channel++) {
                    status[channel] = data[i + 3 + channel] != 0 ? 1 : 0;
                }
                relayStatusCache.put(address, status);
            }
        } catch (Exception e) {
            log.debug("同步继电器状态失败，沿用当前缓存: {}", e.getMessage());
        }
    }

    public synchronized boolean sendCommand(String deviceType, String action) {
        if (!connected) {
            if (!connect()) {
                return false;
            }
        }
        try {
            DeviceConfig.Device device = DeviceConfig.DEVICES.get(deviceType.toLowerCase());
            if (device == null) {
                log.error("未知的设备类型: {}", deviceType);
                return false;
            }
            int deviceId = device.relayAddress();
            int portIndex = device.relayPort() - 1;
            if (portIndex < 0 || portIndex >= 4) {
                log.error("无效的端口索引: {}，有效范围为0-3", portIndex);
                return false;
            }
            int actionValue = "open".equalsIgnoreCase(action) ? 1 : 0;

            syncRelayStatusFromHardware();
            int[] relayStatus = getCurrentRelayStatus(deviceId);
            relayStatus[portIndex] = actionValue;
            relayStatusCache.put(deviceId, relayStatus.clone());

            byte[] command = makeRelayCommand(deviceId, relayStatus);
            if (command == null) {
                return false;
            }
            log.info("发送继电器控制命令: {}", hex(command));

            drainInputBuffer();
            socket.setSoTimeout(5000);
            socket.getOutputStream().write(command);
            socket.getOutputStream().flush();
            lastCommunicationTime = nowIso();

            try {
                byte[] response = readOnce();
                if (response.length > 0) {
                    lastCommunicationTime = nowIso();
                    debugPrintResponse(response, deviceType + "控制");
                }
                log.info("命令执行成功: {} {}", deviceType, action);
                return true;
            } catch (SocketTimeoutException e) {
                log.warn("设备 {} 控制命令响应超时，但命令可能已执行", deviceType);
                return true;
            }
        } catch (Exception e) {
            log.error("控制设备失败: {}", e.getMessage());
            connected = false;
            return false;
        }
    }

    public synchronized Integer queryDeviceStatus(String deviceType) {
        if (!connected) {
            if (!connect()) {
                return null;
            }
        }
        try {
            DeviceConfig.Device device = DeviceConfig.DEVICES.get(deviceType.toLowerCase());
            if (device == null) {
                log.error("未知的设备类型: {}", deviceType);
                return null;
            }
            int deviceId = device.relayAddress();
            int portIndex = device.relayPort() - 1;
            if (portIndex < 0 || portIndex >= 4) {
                log.error("无效的端口索引: {}，有效范围为0-3", portIndex);
                return null;
            }

            // 单板查询网关不响应，统一走广播同步后的缓存
            syncRelayStatusFromHardware();
            int value = getCurrentRelayStatus(deviceId)[portIndex];
            log.info("设备 {} 状态: {}", deviceType, value);
            return value;
        } catch (Exception e) {
            log.error("查询设备 {} 状态失败: {}", deviceType, e.getMessage());
            connected = false;
            return null;
        }
    }

    public synchronized Map<String, Double> getSensorData() {
        Map<String, Double> empty = new LinkedHashMap<>();
        if (!connected) {
            if (!connect()) {
                return empty;
            }
        }
        try {
            byte[] command = {(byte) 0xA5, 0x00, 0x00, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, 0x5A};
            socket.getOutputStream().write(command);
            socket.getOutputStream().flush();
            lastCommunicationTime = nowIso();
            socket.setSoTimeout(10_000);

            byte[] buffer = new byte[1024];
            byte[] all = new byte[0];
            long start = System.currentTimeMillis();
            while (System.currentTimeMillis() - start < 10_000) {
                try {
                    int read = socket.getInputStream().read(buffer);
                    if (read <= 0) {
                        break;
                    }
                    byte[] merged = new byte[all.length + read];
                    System.arraycopy(all, 0, merged, 0, all.length);
                    System.arraycopy(buffer, 0, merged, all.length, read);
                    all = merged;
                    lastCommunicationTime = nowIso();
                    if (all.length >= 9 * 6) {
                        break;
                    }
                } catch (SocketTimeoutException e) {
                    break;
                }
            }

            if (all.length == 0) {
                log.error("未接收到任何传感器数据");
                return empty;
            }
            log.info("已获取传感器数据: {} 字节", all.length);
            return parseSensorData(all);
        } catch (SocketTimeoutException e) {
            log.error("获取传感器数据超时，没有收到响应");
            return empty;
        } catch (Exception e) {
            log.error("获取传感器数据失败: {}", e.getMessage());
            connected = false;
            return empty;
        }
    }

    private Map<String, Double> parseSensorData(byte[] data) {
        Map<String, Double> result = new LinkedHashMap<>();
        result.put("air_temperature", 0.0);
        result.put("air_humidity", 0.0);
        result.put("soil_temperature", 0.0);
        result.put("soil_moisture", 0.0);
        result.put("light_intensity", 0.0);
        result.put("co2_concentration", 0.0);

        for (int i = 0; i <= data.length - 9; i += 9) {
            if ((data[i] & 0xFF) != 0xB5 || (data[i + 8] & 0xFF) != 0x5B) {
                continue;
            }
            int deviceType = data[i + 1] & 0xFF;
            byte[] payload = new byte[5];
            System.arraycopy(data, i + 3, payload, 0, 5);
            switch (deviceType) {
                case 0x31 -> {
                    result.put("air_temperature", round1(unsignedShort(payload, 0) / 100.0));
                    result.put("air_humidity", round1(unsignedShort(payload, 2) / 100.0));
                }
                case 0x32 -> {
                    result.put("soil_temperature", round1(unsignedShort(payload, 0) / 100.0));
                    result.put("soil_moisture", round1(unsignedShort(payload, 2) / 100.0));
                }
                case 0x33 -> result.put("co2_concentration", (double) unsignedShort(payload, 0));
                case 0x34 -> result.put("light_intensity", (double) unsignedShort(payload, 0));
                default -> {
                    // 未知传感器类型忽略
                }
            }
        }
        log.info("传感器数据解析完成: 温度={}°C, 湿度={}%, 光照={}lux, CO2={}ppm",
                result.get("air_temperature"), result.get("air_humidity"),
                result.get("light_intensity"), result.get("co2_concentration"));
        return result;
    }

    public synchronized boolean ping() {
        if (socket == null) {
            connected = false;
            return false;
        }
        try {
            byte[] pingCommand = {(byte) 0xA5, 0x00, 0x00, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, 0x5A};
            socket.getOutputStream().write(pingCommand);
            socket.getOutputStream().flush();
            lastCommunicationTime = nowIso();
            socket.setSoTimeout(2000);
            byte[] response = readOnce();
            lastCommunicationTime = nowIso();
            if (response.length > 0) {
                connected = true;
                return true;
            }
            connected = false;
            return false;
        } catch (SocketTimeoutException e) {
            log.warn("Ping测试超时");
            connected = false;
            return false;
        } catch (Exception e) {
            log.error("Ping测试失败: {}", e.getMessage());
            connected = false;
            return false;
        }
    }

    private byte[] makeRelayCommand(int deviceId, int[] status) {
        if (status.length != 4) {
            log.error("继电器状态列表长度错误: {}，应为4", status.length);
            return null;
        }
        byte[] command = new byte[9];
        command[0] = (byte) 0xA5;
        command[1] = 0x20;
        command[2] = (byte) (deviceId & 0xFF);
        for (int i = 0; i < 4; i++) {
            command[3 + i] = (byte) (status[i] != 0 ? 1 : 0);
        }
        command[7] = (byte) 0xFF;
        command[8] = 0x5A;
        return command;
    }

    private void drainInputBuffer() {
        try {
            socket.setSoTimeout(100);
            byte[] buffer = new byte[1024];
            while (true) {
                int read = socket.getInputStream().read(buffer);
                if (read <= 0) {
                    break;
                }
            }
        } catch (SocketTimeoutException ignored) {
            // 缓冲区已清空
        } catch (Exception e) {
            log.warn("清空接收缓冲区时出错: {}", e.getMessage());
        }
    }

    private byte[] readOnce() throws Exception {
        byte[] buffer = new byte[1024];
        InputStream inputStream = socket.getInputStream();
        int read = inputStream.read(buffer);
        if (read <= 0) {
            return new byte[0];
        }
        byte[] result = new byte[read];
        System.arraycopy(buffer, 0, result, 0, read);
        return result;
    }

    private void debugPrintResponse(byte[] response, String operation) {
        if (log.isDebugEnabled()) {
            log.debug("收到{}响应数据: {}", operation, hex(response));
        }
        if (response.length >= 10 && (response[0] & 0xFF) == 0xA5 && (response[9] & 0xFF) == 0x5A) {
            int address = ((response[2] & 0xFF) << 8) | (response[3] & 0xFF);
            log.debug("继电器地址: 0x{}, 状态: {}", String.format("%04X", address),
                    java.util.Arrays.toString(new byte[]{response[5], response[6], response[7], response[8]}));
        }
    }

    private static int unsignedShort(byte[] data, int offset) {
        return ((data[offset] & 0xFF) << 8) | (data[offset + 1] & 0xFF);
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private static String hex(byte[] data) {
        StringBuilder sb = new StringBuilder();
        for (byte b : data) {
            if (!sb.isEmpty()) {
                sb.append(' ');
            }
            sb.append(String.format("%02X", b));
        }
        return sb.toString();
    }

    private static String nowIso() {
        return LocalDateTime.now().truncatedTo(ChronoUnit.MICROS).toString();
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
