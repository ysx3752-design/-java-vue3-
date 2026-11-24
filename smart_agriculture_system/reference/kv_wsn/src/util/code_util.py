"""
bytes to hex string
eg:
b'\x01#Eg\x89\xab\xcd\xef\x01#Eg\x89\xab\xcd\xef'
'01 23 45 67 89 AB CD EF 01 23 45 67 89 AB CD EF'
"""


def bytes_to_hex_str(bs):
    # hex_str = ''
    # for item in bs:
    #     hex_str += str(hex(item))[2:].zfill(2).upper() + " "
    # return hex_str
    return ''.join(['%02X' % b for b in bs])


'''
hex string to bytes
eg:
'01 23 45 67 89 AB CD EF 01 23 45 67 89 AB CD EF'
b'\x01#Eg\x89\xab\xcd\xef\x01#Eg\x89\xab\xcd\xef'
'''


def hex_str_to_bytes(string):
    string = string.replace(" ", "")
    return bytes.fromhex(string)
    # return a2b_hex(str)


'''
byte(int) to hex string 
'''


def byte_to_hex_str(b):
    return '%02X' % b
