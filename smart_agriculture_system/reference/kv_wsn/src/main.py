from kv_wsn.src import data_conversion
from kv_wsn.src.link_base import SocketLink, DeviceType
from tkinter import *
from tkinter import messagebox

SOCKET_CON = SocketLink()

BTN_PING = None

ROOT = Tk()

LbTempHumidity = Label(ROOT, text='数据')


def call_back(deviceType: int, addr: int, data: bytes):
    if deviceType == DeviceType.DigitalTube.value:
        print(data_conversion.get_digital_tube_num(data))
    elif deviceType == DeviceType.TemperatureHumidity.value:
        th = data_conversion.get_temperature_humidity(data)
        LbTempHumidity['text'] = th
        print(th)


def wm_closing():
    SOCKET_CON.close()
    ROOT.quit()


def link_socket(ip: str, port: str):
    print("!")
    if len(port) == 0:
        return
    try:
        port_int = int(port)
        global SOCKET_CON
        SOCKET_CON.connect(ip, port_int)
        SOCKET_CON.register_call_back(call_back)
        BTN_PING['state'] = 'normal'
    except ValueError:
        messagebox.showwarning("警告", "Port请输入数字")
    except Exception as e:
        messagebox.showwarning("警告", e)


if __name__ == '__main__':
    ROOT.title("WSN")
    # root.geometry("400x300")
    width = 400
    height = 300
    # 获取屏幕尺寸以计算布局参数，使窗口居屏幕中央
    screenwidth = ROOT.winfo_screenwidth()
    screenheight = ROOT.winfo_screenheight()
    align_str = '%dx%d+%d+%d' % (width, height, (screenwidth - width) / 2, (screenheight - height) / 2)
    ROOT.geometry(align_str)
    # 设置窗口是否可变长、宽，True：可变，False：不可变
    ROOT.resizable(width=False, height=False)
    label = Label(ROOT, text='Ip：')
    label.grid(row=0, column=0, sticky=E, padx=5, pady=5)
    ip_str = StringVar(value="192.168.31.77")
    editIp = Entry(ROOT, textvariable=ip_str)
    editIp.grid(row=0, column=1)

    label = Label(ROOT, text='Port：')
    label.grid(row=1, column=0, sticky=E, padx=5, pady=5)
    port_str = StringVar(value="4000")
    editPort = Entry(ROOT, textvariable=port_str)
    editPort.grid(row=1, column=1)

    btnCon = Button(ROOT, text="连接", width=6)
    btnCon.bind('<Button-1>', lambda event: link_socket(editIp.get(), editPort.get()))
    btnCon.grid(row=0, column=2)

    BTN_PING = Button(ROOT, text="Ping", width=6, command=lambda: SOCKET_CON.ping(), state="disabled")
    BTN_PING.grid(row=1, column=2)

    LbTempHumidity.grid(row=2, column=0)

    ROOT.protocol("WM_DELETE_WINDOW", wm_closing)
    ROOT.mainloop()
