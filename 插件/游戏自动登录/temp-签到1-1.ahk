
Run, "C:\Program Files\slatshark\鲨鱼之王客户端.exe"
Sleep, 2000
WinWait, 请选择需要运行的BIN文件, , 10
WinActivate, 请选择需要运行的BIN文件
Sleep, 500
ControlSetText, Edit1, C:\Users\Administrator\Desktop\xyzw_web_helper-main\XYZW-wss\BIN文件\签到1-1.bin
Sleep, 300
Send, !o
Sleep, 200
Send, {Enter}
