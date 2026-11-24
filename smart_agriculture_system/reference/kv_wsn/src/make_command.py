from kv_wsn.src.link_base import DeviceType
from kv_wsn.src.util.code_util import *


# 生成数码管命令
# address -> 设备地址
# num -> 设备需要显示的内容；长度为4，每一位取值范围0～9
# status -> 数码管指示灯状态；True（打开）或False（关闭）
# return -> 命令
def make_led_command(address: int, num: str, status: bool):
    command = 'A5' + byte_to_hex_str(DeviceType.DigitalTube.value) + byte_to_hex_str(address)
    num_str = ''
    for i in range(4 - len(num)):
        num_str += '0'
    num_str += num
    for index in range(4):
        command += '0' + num_str[index]
    command += "01" if status else "00"
    command += '5A'
    print(command)
    return hex_str_to_bytes(command)


# 生成继电器命令
# address -> 设备地址
# status -> 继电器4个通道的状态，长度为4的list
#           通道状态：True（打开）或False（关闭）
#           0=通道1的状态
#           1=通道2的状态
#           2=通道3的状态
#           3=通道4的状态
# return -> 命令
def make_relay_command(address: int, status: list):
    if len(status) != 4:
        return
    command = 'A5' + byte_to_hex_str(DeviceType.Relay.value) + byte_to_hex_str(address)
    for index in range(len(status)):
        command += "01" if status[index] else "00"
    command += 'FF'
    command += '5A'
    print(command)
    return hex_str_to_bytes(command)


# 生成智能插座命令
# address -> 设备地址
# status -> 智能插座状态；True（打开）或False（关闭）
# return -> 命令
def make_smart_socket_command(address: int, status: bool):
    command = 'A5' + byte_to_hex_str(DeviceType.SmartSocket.value) + byte_to_hex_str(address)
    command += "01" if status else "00"
    for i in range(4):
        command += 'FF'
    command += '5A'
    print(command)
    return hex_str_to_bytes(command)


# 生成电动窗帘命令
# address -> 设备地址
# status ->电动窗帘状态；01->开 02->关 00->停
# return -> 命令
def make_electric_curtain_command(address: int, status: int):
    command = 'A5' + byte_to_hex_str(DeviceType.ElectricCurtain.value) + byte_to_hex_str(address)
    command += byte_to_hex_str(status)
    for i in range(4):
        command += 'FF'
    command += '5A'
    print(command)
    return hex_str_to_bytes(command)


# 生成门磁报警器命令
# address -> 设备地址
# arming_status -> 状态； 0->撤防状态 1->布防状态
# return -> 命令
def make_door_magnetic_alarm_command(address: int, arming_status: int):
    command = 'A5' + byte_to_hex_str(DeviceType.DoorMagneticAlarm.value) + byte_to_hex_str(address) \
              + '00'
    command += byte_to_hex_str(arming_status)
    for i in range(3):
        command += 'FF'
    command += '5A'
    print(command)
    return hex_str_to_bytes(command)
