from threading import *


class LoopThread(Thread):
    def __init__(self):
        super().__init__()
        self.__flag = Event()  # 用于暂停线程的标识
        self.__flag.set()  # 设置为True
        self.__running = Event()  # 用于停止线程的标识
        self.__running.set()  # 将running设置为True

    def run(self):
        while self.__running.isSet():
            self.__flag.wait()
            self.loop()

    def pause(self):
        self.__flag.clear()  # 设置为False, 让线程阻塞

    def resume(self):
        self.__flag.set()  # 设置为True, 让线程停止阻塞

    def stop(self):
        self.__flag.set()  # 将线程从暂停状态恢复, 如何已经暂停的话
        self.__running.clear()  # 设置为False

    def loop(self):
        pass
