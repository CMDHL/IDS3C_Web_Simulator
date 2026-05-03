#!/usr/bin/env python3
"""Tiny IDS3C external controller WebSocket server.

Run this file, open the simulator, then connect to ws://127.0.0.1:8765 from the
External Controller panel. The controller reads simulator frames and commands
the default HDV named "manta" with world-frame vx/vy.
"""

import base64
import hashlib
import json
import socket
import struct


HOST = "127.0.0.1"
PORT = 8765
TARGET = "manta"
SPEED = 0.35
LIMIT = 0.75


def recv_exact(conn, count):
    data = b""
    while len(data) < count:
        chunk = conn.recv(count - len(data))
        if not chunk:
            raise ConnectionError("client disconnected")
        data += chunk
    return data


def read_http_headers(conn):
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(4096)
        if not chunk:
            raise ConnectionError("client disconnected during handshake")
        data += chunk
    return data.decode("utf-8", errors="replace")


def handshake(conn):
    headers = read_http_headers(conn)
    key = ""
    for line in headers.splitlines():
        if line.lower().startswith("sec-websocket-key:"):
            key = line.split(":", 1)[1].strip()
            break
    if not key:
        raise RuntimeError("missing Sec-WebSocket-Key")

    accept = base64.b64encode(
        hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
    ).decode()
    response = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n"
        "\r\n"
    )
    conn.sendall(response.encode())


def recv_ws_text(conn):
    b1, b2 = recv_exact(conn, 2)
    opcode = b1 & 0x0F
    masked = bool(b2 & 0x80)
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack("!H", recv_exact(conn, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", recv_exact(conn, 8))[0]
    mask = recv_exact(conn, 4) if masked else b""
    payload = recv_exact(conn, length) if length else b""
    if masked:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    if opcode == 8:
        raise ConnectionError("client closed")
    if opcode != 1:
        return None
    return payload.decode("utf-8")


def send_ws_text(conn, text):
    payload = text.encode("utf-8")
    header = bytearray([0x81])
    if len(payload) < 126:
        header.append(len(payload))
    elif len(payload) < 65536:
        header.append(126)
        header.extend(struct.pack("!H", len(payload)))
    else:
        header.append(127)
        header.extend(struct.pack("!Q", len(payload)))
    conn.sendall(bytes(header) + payload)


def command_for_frame(frame):
    car = next((item for item in frame.get("cars", []) if TARGET in item.get("aliases", [])), None)
    if not car:
        return {"type": "getFrame"}

    x = float(car.get("x", 0.0))
    direction = -1.0 if x > LIMIT else 1.0 if x < -LIMIT else command_for_frame.direction
    command_for_frame.direction = direction

    return {
        "type": "command",
        "commands": {
            TARGET: {
                "vx": SPEED * direction,
                "vy": 0.0,
            }
        },
    }


command_for_frame.direction = 1.0


def serve():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((HOST, PORT))
        server.listen(1)
        print(f"Listening on ws://{HOST}:{PORT}")
        while True:
            conn, addr = server.accept()
            with conn:
                print(f"Connected by {addr[0]}:{addr[1]}")
                try:
                    handshake(conn)
                    send_ws_text(conn, json.dumps({"type": "getFrame"}))
                    while True:
                        text = recv_ws_text(conn)
                        if not text:
                            continue
                        message = json.loads(text)
                        if message.get("type") == "frame":
                            command = command_for_frame(message)
                            send_ws_text(conn, json.dumps(command))
                            print(
                                f"t={message.get('time', 0):5.2f}s "
                                f"cmd vx={command.get('commands', {}).get(TARGET, {}).get('vx', 0): .2f}"
                            )
                except (ConnectionError, json.JSONDecodeError) as error:
                    print(f"Disconnected: {error}")


if __name__ == "__main__":
    serve()
