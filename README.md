# ScaledCity Simulator

This is an unfinished simulator for Cornell IDS Lab's scaled smart city.
To use it, simply visit https://cmdhl.github.io/IDS3C_Web_Simulator/

## External controller API

The viewer can connect to a controller running on the user's own computer.
Open the viewer, run a local WebSocket server, then connect to
`ws://127.0.0.1:8765` from the External Controller panel. External controllers
can spawn the HDV they want to control, so the API can be tested without a
Cars.yaml file.

GitHub Pages only serves the HTML, CSS, and JavaScript files. The code runs in
your local browser, and the `ws://127.0.0.1:8765` connection is made by your
browser on your machine, not by GitHub's servers. GitHub's servers do not
directly access your local controller.

There is no native C++ runtime in the viewer. The simulator state, controllers,
and vehicle dynamics all run in `viewer.js`.

Viewer-to-controller frame messages look like:

```json
{
  "type": "frame",
  "time": 1.23,
  "cars": {
    "manta_101": {
      "label": "manta_101",
      "x": 0.1,
      "y": -0.2,
      "yaw": 1.57,
      "vx": 0.0,
      "vy": 0.3
    }
  }
}
```

When the simulator is reset, it sends a reset event. External controllers should
clear any internal route/progress/controller state. If Auto Send Frames is
enabled, the viewer then sends a fresh frame.

```json
{ "type": "reset" }
```

The controller can also request one current frame at any time:

```json
{ "type": "getFrame" }
```

`getFrame` always returns one frame immediately. Auto Send Frames controls
whether the simulator also pushes frames that were not requested with
`getFrame`. The transport panel's Step Time (s) control sets the simulator
advance step size. The same step time also sets the automatic external frame
cadence in simulator time, and Synchronize Frames makes the simulator wait for a
controller response after each sent frame before advancing again. With the
default step time of 0.1 s, the automatic external-control cadence is 10 Hz.

Controller-to-viewer command messages target HDVs by full car name. HDVs
declared in Cars.yaml use names like `manta_101`; default external HDVs can use
names like `manta` or `lotus`.

An external controller can spawn the HDV at a global pose. Only one HDV is
allowed at a time, so spawning replaces any existing HDV. The vehicle model is
inferred from `target`: `manta` and `manta_101` spawn a manta; `lotus` and
`lotus_101` spawn a lotus.

```json
{
  "type": "spawn",
  "target": "lotus_101",
  "x": 0.949,
  "y": -3.336,
  "yaw": 3.1416
}
```

```json
{
  "type": "command",
  "commands": {
    "manta_101": { "vx": 0.0, "vy": -0.2 }
  }
}
```

The browser converts `vx, vy` into the simulator's car-like speed and steering
commands, then clamps those commands to the selected HDV hardware limits.

The controller can also teleport an HDV to a global pose. `yaw` is in radians.
The simulator places the vehicle at the exact requested `(x, y, yaw)`, resets
its speed to zero, and associates it with the nearest map segment for future
simulation steps. A top-level teleport without `target` applies to the current
ego HDV.

```json
{
  "type": "teleport",
  "target": "manta_101",
  "x": 0.4,
  "y": -0.1,
  "yaw": 1.57
}
```

Teleport requests can also be batched:

```json
{
  "type": "command",
  "commands": {
    "manta_101": { "teleport": { "x": 0.4, "y": -0.1, "yaw": 1.57 } }
  }
}
```

Run the dependency-free Python starter controller with:

```sh
python3 examples/external_controllers/dummy_controller.py
```

Run the closed-loop route tracing controller with:

```sh
python3 examples/external_controllers/route_trace_controller.py
```

By default, it spawns the `manta` HDV at the start of a closed-loop route,
commands world-frame `vx, vy` toward a lookahead point on that route, and stops
after one lap. You can provide a different comma-separated segment list:

```sh
python3 examples/external_controllers/route_trace_controller.py --route S22,A27,S30,S49,A56,S58,A51,S51,S29,A14,S23
```

Useful options:

```sh
python3 examples/external_controllers/route_trace_controller.py --target manta --speed 0.32 --lookahead 0.18
python3 examples/external_controllers/route_trace_controller.py --target lotus_101
python3 examples/external_controllers/route_trace_controller.py --no-spawn
python3 examples/external_controllers/route_trace_controller.py --loop
```

## Development notes

Some code and documentation in this repository were developed with assistance from ChatGPT, and were reviewed and modified before use.
