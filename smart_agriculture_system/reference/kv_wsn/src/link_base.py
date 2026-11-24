import socket
from enum import Enum, unique

from kv_wsn.src.custom_thread import LoopThread
from kv_wsn.src.util import code_util

'''
设备类型枚举
'''


@unique
class DeviceType(Enum):
    # 数码管
    DigitalTube = 0x10
    # 继电器
    Relay = 0x20
    # 温湿度
    TemperatureHumidity = 0x30
    # 烟雾
    Smoke = 0x40
    # 红外
    Infrared = 0x50
    # 震动
    Shake = 0x60
    # 红外对射光栅
    InfraredBeamGrating = 0x70
    # 智能插座
    SmartSocket = 0x80
    # ZigBee信号转发器
    ZigBeeSignalRepeater = 0x90
    # 门磁报警器
    DoorMagneticAlarm = 0xA0
    # 电动窗帘
    ElectricCurtain = 0xB0
    # 采集器空气温湿度
    CollectorAirTemperatureHumidity = 0x31
    # 采集器土壤温湿度
    CollectorSoilTemperatureHumidity = 0x32
    # 采集器CO2浓度
    CollectorCO2 = 0x33
    # 采集器光照度
    CollectorLight = 0x34
    # 激光测距传感器
    LaserRanging = 0x41
    # 转速传感器
    Revolution = 0x42
    # 大气压力传感器
    BarometricPressure = 0x43
    # PM2.5
    Pm25 = 0x44
    # 角度传感器
    Angle = 0x45
    # 位移传感器
    Displacement = 0x46
    # 扭矩传感器
    Torque = 0x47
    # 拉力压力传感器
    Tension = 0x48
    # 超声波液位传感器
    UltrasonicLiquidLevel = 0x49
    # 热偶传感器
    Thermocouple = 0x4A
    # 火焰传感器
    Fire = 0x51
    # 液化石油气传感器
    LpGas = 0x52
    # 红外反射开关
    InfraredReflection = 0x54
    # 光敏电阻传感器
    PhotosensitiveResistor = 0x55
    # 电容式接近开关
    CapacitiveProximitySwitch = 0x61
    # 光电旋转编码器
    PhotoelectricRotaryEncoder = 0x62
    # 声音传感器
    Sound = 0x63
    # 电感式接近开关
    InductiveProximitySwitch = 0x64


class LinkBase:

    def __init__(self):
        self.rec_data = bytes()
        self.call_back = None
        self.data_call_back = None
        self.t = ParseRecData(self)
        # t = Thread(target=self._parse_rec_data())
        # t.start()
        # t.join()

    def start_parse(self):
        self.t.start()

    # 注册传感器数据回调
    # call_back -> 实现的方法，接收到传感器数据回调用此方法
    #            参数0 -> 设备type, 类型为int/byte
    #            参数1 -> 设备address，类型为int/byte
    #            参数2 -> 设备数据，类型为集合
    def register_call_back(self, call_back):
        self.call_back = call_back

    def register_data_call_back(self, data_call_back):
        self.data_call_back = data_call_back

    def receive(self, data):
        self.rec_data += data
        if self.data_call_back is not None:
            self.data_call_back(False, data)

    # 发送数据
    # data -> 数据
    def send(self, data: bytes):
        print(data)

    def close(self):
        self.t.stop()

    # Ping指令
    # 如有传感器设备，调用此方法后监听传感器方法会被异步调用
    def ping(self):
        b = b'\xA5\x00\x00\xFF\xFF\xFF\xFF\xFF\x5A'
        self.send(b)
        if self.data_call_back is not None:
            self.data_call_back(True, b)

    def _parse_rec_data(self):
        # print("开始解析")
        while True:
            if self.rec_data is not None and len(self.rec_data) >= 9:
                if self.rec_data[0] == 0xB5 and self.rec_data[8] == 0x5B:
                    # print("有数据")
                    command = self.rec_data[:9]
                    del self.rec_data[:9]
                    print(command)


"""
解析命令
"""


def _parse_command(command: bytes, base: LinkBase):
    if base.call_back is not None:
        base.call_back(command[1], command[2], command[3:8])


class ParseRecData(LoopThread):
    def __init__(self, base: LinkBase):
        super().__init__()
        self.base = base

    def loop(self):
        if self.base.rec_data is not None and len(self.base.rec_data) >= 9:
            if self.base.rec_data[0] == 181 and self.base.rec_data[8] == 91:
                # print(self.base.rec_data)
                # print("有数据")
                command = self.base.rec_data[:9]
                print(code_util.bytes_to_hex_str(command))
                self.base.rec_data = self.base.rec_data[9:]
                _parse_command(command, self.base)


class ReceiveData(LoopThread):
    def __init__(self, base: LinkBase, sk: socket):
        super().__init__()
        self.base = base
        self.sk = sk

    def loop(self):
        try:
            data = self.sk.recv(1024)
            print("读取到数据长度：" + str(len(data)))
            # for i in range(9):
            #     print(data[i])
            self.base.receive(data)
        except socket.timeout:
            pass
        except Exception as err:
            print(err)


class SocketLink(LinkBase):

    def __init__(self):
        super().__init__()
        self.ip = ''
        self.port = 0
        self.sk = None
        self.receive_thread = None

    # 连接网关
    # ip -> 网关的IP
    # port -> 网关的端口
    def connect(self, ip: str, port: int) -> bool:
        self.sk = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sk.settimeout(2)
        self.receive_thread = ReceiveData(self, self.sk)
        self.ip = ip
        self.port = port
        print("开始连接")
        try:
            self.sk.connect((self.ip, self.port))
            print("连接成功")
            self.receive_thread.start()
            super().start_parse()
            return True
        except socket.timeout:
            print("连接超时")
        except Exception as e:
            print(e)
        return False

    # 发送数据
    # data -> 数据
    def send(self, data: bytes):
        self.sk.send(data)

    # 断开连接
    def close(self):
        super().close()
        if self.sk is not None:
            self.receive_thread.stop()
            self.sk.close()
