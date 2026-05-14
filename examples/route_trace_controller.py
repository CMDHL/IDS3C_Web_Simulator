#!/usr/bin/env python3
"""Closed-loop external controller that traces a named map route.

Run this file, open the simulator, click Connect in the External Controller
panel, and the controller will spawn the target HDV at the start of ROUTE
before sending world-frame vx/vy commands toward a lookahead point on the route.
"""

import argparse
import base64
import csv
import hashlib
import json
import math
from pathlib import Path
import socket
import struct


HOST = "127.0.0.1"
PORT = 8765
TARGET = "manta"
SPEED = 0.32
LOOKAHEAD = 0.18
SAMPLE_STEP = 0.015
SEARCH_BACK = 0.25
SEARCH_AHEAD = 1.25
DEFAULT_ROUTE = [
    "S22",
    "A27",
    "S30",
    "S49",
    "A56",
    "S58",
    "A51",
    "S51",
    "S29",
    "A14",
    "S23",
]


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


def send_ws_json(conn, message):
    payload = json.dumps(message).encode("utf-8")
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


class Segment:
    def __init__(self, segment_id, kind, **kwargs):
        self.id = segment_id
        self.kind = kind
        self.__dict__.update(kwargs)

    def point(self, r):
        r = max(0.0, min(self.length, r))
        if self.kind == "line":
            x = self.x
            y = self.y
            if self.direction == "+Y":
                y = -r + self.y
            elif self.direction == "-Y":
                y = r + self.y
            elif self.direction == "+X":
                x = -r + self.x
            elif self.direction == "-X":
                x = r + self.x
            return x, y

        angle = r / self.radius + self.start if self.ccw else -r / self.radius + self.end
        return (
            self.radius * math.cos(angle) + self.x,
            self.radius * math.sin(angle) + self.y,
        )


class Route:
    def __init__(self, segments, loop=False):
        if not segments:
            raise ValueError("route needs at least one segment")
        self.segments = segments
        self.loop = loop
        self.samples = self._sample_route()
        self.length = self.samples[-1][0]
        self.last_s = None

    def _sample_route(self):
        samples = []
        total = 0.0
        for segment in self.segments:
            steps = max(2, math.ceil(segment.length / SAMPLE_STEP))
            for i in range(steps + 1):
                if samples and i == 0:
                    continue
                r = segment.length * i / steps
                x, y = segment.point(r)
                samples.append((total + r, x, y, segment.id))
            total += segment.length
        return samples

    def point_at(self, s):
        if self.loop:
            s %= self.length
        else:
            s = max(0.0, min(self.length, s))
        for index in range(1, len(self.samples)):
            s0, x0, y0, _ = self.samples[index - 1]
            s1, x1, y1, segment_id = self.samples[index]
            if s <= s1:
                ratio = 0.0 if s1 == s0 else (s - s0) / (s1 - s0)
                return x0 + (x1 - x0) * ratio, y0 + (y1 - y0) * ratio, segment_id
        _, x, y, segment_id = self.samples[-1]
        return x, y, segment_id

    def tangent_yaw_at(self, s):
        if not self.loop and s >= self.length:
            s = max(0.0, self.length - 0.03)
        x0, y0, _ = self.point_at(s)
        x1, y1, _ = self.point_at(s + 0.03)
        return math.atan2(y1 - y0, x1 - x0)

    def closest_s(self, x, y):
        candidates = self.samples
        if self.last_s is not None:
            nearby = []
            for sample in self.samples:
                if self.loop:
                    delta = (sample[0] - self.last_s + self.length / 2) % self.length - self.length / 2
                else:
                    delta = sample[0] - self.last_s
                if -SEARCH_BACK <= delta <= SEARCH_AHEAD:
                    nearby.append(sample)
            if nearby:
                candidates = nearby

        best = min(candidates, key=lambda sample: (x - sample[1]) ** 2 + (y - sample[2]) ** 2)
        self.last_s = best[0]
        return best


def load_map(map_dir):
    segments = {}
    with (map_dir / "NewLines.csv").open(newline="") as file:
        for row in csv.DictReader(file):
            segments[row["index"]] = Segment(
                row["index"],
                "line",
                direction=row["direction"],
                length=float(row["length"]),
                x=float(row["x"]),
                y=float(row["y"]),
            )

    with (map_dir / "NewArcs.csv").open(newline="") as file:
        for row in csv.DictReader(file):
            start = float(row["angleStart"])
            end = float(row["angleEnd"])
            radius = float(row["radius"])
            segments[row["index"]] = Segment(
                row["index"],
                "arc",
                length=abs(end - start) * radius,
                x=float(row["x"]),
                y=float(row["y"]),
                radius=radius,
                start=start,
                end=end,
                ccw=row["Rotation"].strip() == "CCW",
            )
    return segments


class RouteTracer:
    def __init__(self, route, target, speed, lookahead, model="", spawn=True, stop_tolerance=0.05):
        self.route = route
        self.target = target
        self.model = model
        self.speed = speed
        self.lookahead = lookahead
        self.stop_tolerance = stop_tolerance
        self.spawn = spawn
        self.spawned = False
        self.finished = False

    def reset(self):
        self.route.last_s = None
        self.spawned = False
        self.finished = False

    def spawn_command(self):
        x, y, _ = self.route.point_at(0.0)
        self.spawned = True
        self.route.last_s = 0.0
        command = {
            "type": "spawn",
            "target": self.target,
            "x": x,
            "y": y,
            "yaw": self.route.tangent_yaw_at(0.0),
        }
        if self.model:
            command["model"] = self.model
        return command

    def command_for_frame(self, frame):
        cars = frame.get("cars", {})
        car = cars.get(self.target)
        if not car:
            if self.spawn and not self.spawned:
                return self.spawn_command()
            return {"type": "getFrame"}

        x = float(car.get("x", 0.0))
        y = float(car.get("y", 0.0))
        s, px, py, segment_id = self.route.closest_s(x, y)
        error = math.hypot(x - px, y - py)
        if not self.route.loop and s >= self.route.length - self.stop_tolerance:
            self.finished = True
        if self.finished:
            print(
                f"t={frame.get('time', 0):5.2f}s segment={segment_id:>4} "
                f"s={s:6.2f} cross_track={error:5.3f}m stopped"
            )
            return {
                "type": "command",
                "commands": {
                    self.target: {
                        "vx": 0.0,
                        "vy": 0.0,
                    }
                },
            }

        tx, ty, _ = self.route.point_at(s + self.lookahead)
        dx = tx - x
        dy = ty - y
        distance = math.hypot(dx, dy)
        if distance < 1e-6:
            yaw = self.route.tangent_yaw_at(s)
            dx = math.cos(yaw)
            dy = math.sin(yaw)
            distance = 1.0

        print(
            f"t={frame.get('time', 0):5.2f}s segment={segment_id:>4} "
            f"s={s:6.2f} cross_track={error:5.3f}m"
        )
        return {
            "type": "command",
            "commands": {
                self.target: {
                    "vx": self.speed * dx / distance,
                    "vy": self.speed * dy / distance,
                }
            },
        }


def parse_route(value):
    return [item.strip() for item in value.split(",") if item.strip()]


def build_arg_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", default=PORT, type=int)
    parser.add_argument("--target", default=TARGET)
    parser.add_argument("--model", default="", help="HDV model to spawn, such as lotus or manta; inferred from target when omitted")
    parser.add_argument("--speed", default=SPEED, type=float)
    parser.add_argument("--lookahead", default=LOOKAHEAD, type=float)
    parser.add_argument("--route", default=",".join(DEFAULT_ROUTE), help="comma-separated segment names")
    parser.add_argument("--no-spawn", action="store_true", help="track an already-placed HDV instead of spawning one")
    parser.add_argument("--loop", action="store_true", help="wrap from the final segment back to the start")
    parser.add_argument("--stop-tolerance", default=0.05, type=float, help="meters before route end to command zero speed")
    return parser


def serve(args):
    map_dir = Path(__file__).resolve().parents[1] / "assets" / "default_map"
    all_segments = load_map(map_dir)
    route_names = parse_route(args.route)
    missing = [segment_id for segment_id in route_names if segment_id not in all_segments]
    if missing:
        raise ValueError(f"route contains unknown segment names: {', '.join(missing)}")

    route = Route([all_segments[segment_id] for segment_id in route_names], loop=args.loop)
    tracer = RouteTracer(
        route,
        args.target,
        args.speed,
        args.lookahead,
        model=args.model,
        spawn=not args.no_spawn,
        stop_tolerance=args.stop_tolerance,
    )
    print(f"Tracing {len(route_names)} segments ({route.length:.2f} m) for target {args.target}")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((args.host, args.port))
        server.listen(1)
        print(f"Listening on ws://{args.host}:{args.port}")
        while True:
            conn, addr = server.accept()
            with conn:
                print(f"Connected by {addr[0]}:{addr[1]}")
                try:
                    handshake(conn)
                    send_ws_json(conn, {"type": "getFrame"})
                    while True:
                        text = recv_ws_text(conn)
                        if not text:
                            continue
                        message = json.loads(text)
                        if message.get("type") == "reset":
                            tracer.reset()
                            send_ws_json(conn, {"type": "getFrame"})
                        elif message.get("type") == "frame":
                            send_ws_json(conn, tracer.command_for_frame(message))
                except (ConnectionError, json.JSONDecodeError) as error:
                    print(f"Disconnected: {error}")


if __name__ == "__main__":
    serve(build_arg_parser().parse_args())
