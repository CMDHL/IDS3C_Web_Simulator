# ScaledCity Simulator

This is an unfinished simulator for Cornell IDS Lab's scaled smart city.
To use it, simply visit https://cmdhl.github.io/IDS3C_Web_Simulator/viewer/

## Build locally

```sh
cmake -S simulator -B simulator/build
cmake --build simulator/build
```

## Optional native run

```sh
./simulator/build/scaledcity_sim \
  --map simulator/assets/default_map \
  --cars path/to/Cars.yaml \
  --duration 20 \
  --dt 0.05
```

That CLI is optional. The browser viewer below is the main path right now.

## View the live browser simulator

From the project root:

```sh
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/simulator/viewer/
```

The viewer loads the default map from `simulator/assets/default_map`. It starts
with no cars. To run an experiment, upload both `Cars.yaml` and
`Experiment.yaml`; replacing `NewLines.csv` and/or `NewArcs.csv` is optional.
The browser runs the simulation live from those inputs.

Some code and documentation in this repository were developed with assistance from ChatGPT and were reviewed and modified before use.