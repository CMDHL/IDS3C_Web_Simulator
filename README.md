# ScaledCity Simulator

This is an unfinished simulator for Cornell IDS Lab's scaled smart city.
To use it, simply visit https://cmdhl.github.io/IDS3C_Web_Simulator/viewer/

## External controller API

The viewer can connect to a controller running on the user's own computer.
Open the viewer, run a local WebSocket server, then connect to
`ws://127.0.0.1:8765` from the External Controller panel. If no HDV has been
placed yet, connecting creates a default `manta` HDV on the map so the API can
be tested without a Cars.yaml file.

GitHub Pages only serves the HTML, CSS, and JavaScript files. The code runs in
your local browser, and the `ws://127.0.0.1:8765` connection is made by your
browser on your machine, not by GitHub's servers. GitHub's servers do not
directly access your local controller.

Viewer-to-controller frame messages look like:

```json
{
  "type": "frame",
  "time": 1.23,
  "cars": [
    {
      "label": "manta",
      "aliases": ["manta", "-1", "manta_-1"],
      "x": 0.1,
      "y": -0.2,
      "vx": 0.0,
      "vy": 0.3
    }
  ]
}
```

The controller can also request one current frame at any time:

```json
{ "type": "getFrame" }
```

Controller-to-viewer command messages target HDVs by label or alias. HDVs
declared in Cars.yaml use labels like `manta_101`; the default test HDV uses
`manta`.

```json
{
  "type": "command",
  "commands": {
    "manta": { "vx": 0.3, "vy": 0.0 },
    "manta_101": { "vx": 0.0, "vy": -0.2 }
  }
}
```

The browser converts `vx, vy` into the simulator's car-like speed and steering
commands, then clamps those commands to the selected HDV hardware limits.

Run the dependency-free Python starter controller with:

```sh
python3 examples/external_controller.py
```

## Development notes

Some code and documentation in this repository were developed with assistance from ChatGPT, and were reviewed and modified before use.
