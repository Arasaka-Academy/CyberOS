# [INPUT]: 已启动的 headless Weston 与测试 DPMS 夹具。
# [OUTPUT]: 验证请求编号确认、无副作用 STATUS、租约看门狗。
# [POS]: 原生集成测试；不访问物理输出。
# [PROTOCOL]: Update this header on change, then check AGENTS.md
import json
import socket
import time


def connect():
    client = socket.socket(socket.AF_UNIX)
    client.settimeout(3)
    client.connect("/run/cyberos-tv/display.sock")
    return client


def command(value):
    with connect() as client:
        client.sendall((value + "\n").encode())
        return json.loads(client.makefile("rb").readline())


assert command("POLICY 100 600")["state"] == "active"
assert command("PLAYBACK 0")["supported"] is True
with connect() as playback, connect() as observer:
    reader = playback.makefile("rb")
    watched = observer.makefile("rb")
    observer.sendall(b"STATUS\n")
    assert "requestId" not in json.loads(watched.readline())
    time.sleep(0.35)
    broadcast = json.loads(reader.readline())
    assert broadcast["state"] == "screensaver" and "requestId" not in broadcast
    assert "requestId" not in json.loads(watched.readline())
    playback.sendall(b"PLAYBACK 1 18446744073709551615\n")
    reply = reader.readline()
    assert reply, "PLAYBACK must accept a nonzero u64 requestId"
    reply = json.loads(reply)
    assert reply["requestId"] == 18446744073709551615 and reply["state"] == "active"
    broadcast = json.loads(watched.readline())
    assert broadcast["state"] == "active" and "requestId" not in broadcast
    playback.sendall(b"PLAYBACK 0\n")
    assert "requestId" not in json.loads(reader.readline())
    playback.sendall(b"PLAYBACK 0 7\n")
    assert json.loads(reader.readline())["requestId"] == 7
for invalid in ("0", "-1", "+1", "18446744073709551616", "1 extra", "1.5"):
    with connect() as client:
        client.sendall(("PLAYBACK 1 " + invalid + "\n").encode())
        assert client.recv(128) == b"", "Invalid requestId must close the client"
# STATUS 不重置闲置；renderer 未就绪仍独立执行关屏计时。
time.sleep(0.35)
assert command("STATUS")["state"] == "screensaver"
# 请求屏保先于渲染就绪；原生视图仍等待 renderer=1。
assert command("RENDERER 1")["state"] == "screensaver"
time.sleep(0.4)
# 状态变化广播先于命令确认；两者应一致。
assert command("STATUS")["state"] == "off"
assert command("RENDERER 0")["state"] == "off"
assert command("PLAYBACK 1")["state"] == "active"
# headless 后端没有物理键盘，模块须创建键盘能力并交付 KEY。
assert command("KEY 28 1")["state"] == "active"
assert command("KEY 28 0")["state"] == "active"
assert command("PLAYBACK 0")["state"] == "active"
time.sleep(0.35)
assert command("POLICY 100 600")["state"] == "screensaver"
time.sleep(0.4)
assert command("STATUS")["state"] == "off"
# 丢失租约必须唤醒，而不是保持黑屏。
time.sleep(10.1)
status = command("STATUS")
assert status["state"] == "active" and status["supported"] is False
client = connect()
client.sendall(b"KEY 777 1\n")
assert client.recv(128) == b""
client.close()
print("Native socket/DPMS/lease tests passed")
