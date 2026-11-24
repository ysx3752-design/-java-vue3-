# 数码管数据
# data -> 设备源数据
# return -> 数码管内容（字符串）
def get_digital_tube_num(data: bytes):
    num = ''
    for i in range(4):
        num += str(data[i])
    return num


# 数码管指示灯状态
# data -> 设备源数据
# return -> 指示灯状态：开或关
def get_digital_tube_status(data: bytes):
    return "开" if data[4] == 0x01 else "关"


# 获取空气温度
# data -> 设备源数据
# return -> 空气温度值
def get_air_temperature(data: bytes):
    return data[1]


# 获取空气湿度
# data -> 设备源数据
# return -> 空气湿度值
def get_air_humidity(data: bytes):
    return data[3]


# 获取温湿度数据
# data -> 设备源数据
# return -> 空气温度值,空气湿度值
def get_temperature_humidity(data: bytes):
    return get_air_temperature(data), get_air_humidity(data)


# 获取bool类型传感器状态
# data -> 设备源数据
# index -> 设备有效数据位
# return -> 设备状态: True或False
def get_bool_sensor_status(data: bytes, index=0):
    return data[index] == 0x01


# 获取继电器4个通道状态
# data -> 设备源数据
# return -> 继电器4个通道的状态（元组）
def get_relay_status(data: bytes):
    status = []
    for index in range(4):
        status.append(data[index] == 0x01)
    return tuple(status)


# 获取红外对射光栅状态
# data -> 设备源数据
# return -> 红外对射光栅状态
#           01 代表进入  02代表退出  两者方向不同
#           FF 无状态
def get_infrared_beam_grating_status(data: bytes):
    return data[0]


# 获取智能插座状态
# data -> 设备源数据
# return -> 智能插座状态：True或False
def get_smart_socket_status(data: bytes):
    return data[0] == 0x01


# 获取门磁报警器状态
# data -> 设备源数据
# return -> 门磁报警器状态（元组）
#           0->报警状态
#           1->布防状态
def get_door_magnetic_alarm_status(data: bytes):
    return data[0] == 0x01, data[1] == 0x01


# 获取电动窗帘状态
# data -> 设备源数据
# return -> 电动窗帘状态
#           01->开 02->关 00->停
def get_electric_curtain_status(data: bytes):
    return data[0]


# 采集器源数据转数值
def _collector_data_to_number(data: bytes):
    number_int = int.from_bytes(data, byteorder='big', signed=False)
    return number_int


# 获取采集器空气温度
# data -> 设备源数据
# return -> 采集器空气温度值
def get_collector_air_temperature(data: bytes):
    return round(_collector_data_to_number(data[:2]) / 100.0, 2)


# 获取采集器空气湿度
# data -> 设备源数据
# return -> 采集器空气湿度值
def get_collector_air_humidity(data: bytes):
    return round(_collector_data_to_number(data[2:4]) / 100.0, 2)


# 获取采集器空气温湿度数据
# data -> 设备源数据
# return -> 采集器空气温度值,采集器空气湿度值 （元组）
def get_collector_air_th(data: bytes):
    return get_collector_air_temperature(data), get_collector_air_humidity(data)


# 获取采集器土壤温度
# data -> 设备源数据
# return -> 采集器土壤温度值
def get_collector_soil_temperature(data: bytes):
    return round(_collector_data_to_number(data[:2]) / 100.0, 2)


# 获取采集器土壤湿度
# data -> 设备源数据
# return -> 采集器土壤湿度值
def get_collector_soil_humidity(data: bytes):
    return round(_collector_data_to_number(data[2:4]) / 100.0, 2)


# 获取采集器土壤温湿度数据
# data -> 设备源数据
# return -> 采集器土壤温度值,采集器土壤湿度值 （元组）
def get_collector_soil_th(data: bytes):
    return get_collector_soil_temperature(data), get_collector_soil_humidity(data)


# 获取采集器光照度
# data -> 设备源数据
# return -> 采集器光照度值
def get_collector_light(data: bytes):
    return _collector_data_to_number(data[:2])


# 获取采集器CO2
# data -> 设备源数据
# return -> 采集器CO2值
def get_collector_co2(data: bytes):
    return _collector_data_to_number(data[:2])


# 获取激光测距数据
# data -> 设备源数据
# return -> 激光测距值
def get_laser_ranging(data: bytes):
    return int.from_bytes(data[:4], byteorder='big', signed=False)


# 获取转速传感器数据
# data -> 设备源数据
# return -> 转速值(圈/分钟)
def get_revolution(data: bytes):
    return int.from_bytes(data[:2], byteorder='big', signed=False)


# 获取大气压力传感器数据
# data -> 设备源数据
# return -> 大气压力值(Kpa)
def get_barometric_pressure(data: bytes):
    return int.from_bytes(data[:2], byteorder='big', signed=False) / 10


# 获取Pm2.5传感器数据
# data -> 设备源数据
# return -> PM2.5值(ug/m³)
def get_pm_2_5(data: bytes):
    return int.from_bytes(data[:2], byteorder='big', signed=False)


# 获取角度传感器数据
# data -> 设备源数据
# return -> 角度值(度)
def get_angle(data: bytes):
    return int.from_bytes(data[:4], byteorder='big', signed=False)


# 获取位移传感器数据
# data -> 设备源数据
# return -> 位移值
def get_displacement(data: bytes):
    return int.from_bytes(data[:4], byteorder='big', signed=False)


# 获取扭矩传感器数据
# data -> 设备源数据
# return -> 扭矩值(牛米)
def get_torque(data: bytes):
    if data[0] == 0xFF and data[1] == 0xFF:
        return int.from_bytes([~data[2], ~data[2]], byteorder='big', signed=False) * -1
    return int.from_bytes(data[:4], byteorder='big', signed=False)


# 获取拉力压力传感器数据
# data -> 设备源数据
# return -> 拉力压力值(克) 负值代表压力，正值代表拉力
def get_tension(data: bytes):
    if data[0] == 0xFF and data[1] == 0xFF:
        return int.from_bytes([~data[2], ~data[2]], byteorder='big', signed=False) * -1
    return int.from_bytes(data[:4], byteorder='big', signed=False)


# 获取超声波液位传感器数据
# data -> 设备源数据
# return -> 液位值
def get_ultrasonic_liquid_level(data: bytes):
    return int.from_bytes(data[:4], byteorder='big', signed=False)


# 获取热偶传感器数据
# data -> 设备源数据
# return -> 值(℃)
def get_thermocouple(data: bytes):
    return int.from_bytes(data[:4], byteorder='big', signed=False) / 100


# 获取光敏电阻传感器数据
# data -> 设备源数据
# return -> 光照强度(lux)
def get_photoresistance(data: bytes):
    return int.from_bytes(data, byteorder='big', signed=False)


# 获取光电旋转编码器旋转方向
# data -> 设备源数据
# return -> 旋转方向；True（正转）或False（反转）
def get_photoelectric_rotary_encoder_direction(data: bytes):
    return data[0] == 0x00


# 获取光电旋转编码器转速
# data -> 设备源数据
# return -> 转速值(转/分钟)
def get_photoelectric_rotary_encoder_speed(data: bytes):
    return int.from_bytes(data[:4], byteorder='big', signed=False)


