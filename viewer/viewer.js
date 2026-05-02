const SAMPLE_PATHS = {
  lines: "../assets/default_map/NewLines.csv",
  arcs: "../assets/default_map/NewArcs.csv",
  background: "../assets/default_map/map.png",
};

const MAP_BACKGROUND = {
  scale: 0.0037001616339739926,
  dx: -3.0908133958033166,
  dy: -4.635945144466932,
};

const HARDWARE = {
  lotus: {
    default: {
      length: 0.2,
      width: 0.1,
      wheelbase: 0.12,
      steeringMinDeg: -20,
      steeringMaxDeg: 20,
      sk: 3.0,
      skSoft: 1.0,
      skYaw: 0.2,
      skSteer: 0.1,
      useSteerFeedback: false,
      minStanleySpeed: 0.2,
      mass: 0.364,
      cy: 1.6,
      kp: 0.1225,
      ki: 0.015,
      antiwindup: 0.0125,
    },
  },
  manta: {
    default: {
      length: 0.18,
      width: 0.1,
      wheelbase: 0.12,
      steeringMinDeg: -45,
      steeringMaxDeg: 45,
      sk: 6.0,
      skSoft: 0.1,
      skYaw: 0.1,
      skSteer: 0.1,
      useSteerFeedback: true,
      minStanleySpeed: 0,
      mass: 0.364,
      cy: 1.6,
      kp: 0.1225,
      ki: 0.015,
      antiwindup: 0.0125,
    },
  },
};

const SIM_DT = 1 / 100;
const CONTROL_DT = 1 / 50;
const MAINFRAME_DT = 1 / 50;
const DEFAULT_LINEUP_GAP = 0.04;
const DEFAULT_FRONT_MARGIN = 0.04;
const CAR_ORIGIN_REARWARD_OFFSET = 0.02;
const COLLISION_CELL_SIZE = 0.35;
const INTERSECTION_QUEUE_DISTANCE = 0.20;
const CONTROL_ZONE_CAR_LENGTH_ALLOWANCE = 0.1;
const DEFAULT_IDM = {
  s0: 0.1,
  a: 10.0,
  b: 15.0,
  delta: 4.0,
  th: 1.5,
};
const ROUTE_HIGHLIGHT_COLORS = [
  "rgba(229, 72, 77, 0.13)",
  "rgba(46, 134, 222, 0.13)",
  "rgba(34, 166, 99, 0.13)",
  "rgba(245, 166, 35, 0.13)",
  "rgba(146, 83, 191, 0.13)",
  "rgba(28, 160, 170, 0.13)",
];

const canvas = document.querySelector("#scene");
const ctx = canvas.getContext("2d");
const statusEl = document.querySelector("#status");
const timeReadout = document.querySelector("#timeReadout");
const vehicleReadout = document.querySelector("#vehicleReadout");
const playButton = document.querySelector("#playButton");
const resetButton = document.querySelector("#resetButton");
const timeSlider = document.querySelector("#timeSlider");
const speedSelect = document.querySelector("#speedSelect");
const linesInput = document.querySelector("#linesInput");
const arcsInput = document.querySelector("#arcsInput");
const carsInput = document.querySelector("#carsInput");
const experimentInput = document.querySelector("#experimentInput");
const errorDialog = document.querySelector("#errorDialog");
const errorMessage = document.querySelector("#errorMessage");
const errorCloseButton = document.querySelector("#errorCloseButton");

const state = {
  map: null,
  scenario: { vehicles: [] },
  runtime: null,
  playing: false,
  lastTickMs: 0,
  bounds: null,
  backgroundImage: null,
  backgroundReady: false,
  sourceTexts: {
    lines: "",
    arcs: "",
    cars: "",
    experiment: "",
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadBackgroundImage() {
  const image = new Image();
  image.onload = () => {
    state.backgroundReady = true;
    draw();
  };
  image.onerror = () => {
    state.backgroundReady = false;
  };
  image.src = SAMPLE_PATHS.background;
  state.backgroundImage = image;
}

function wrapAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function collisionStatusText(collision = state.runtime?.collision) {
  if (!collision?.hasCollision) return "";
  const pairs = collision.pairs.map(([a, b]) => `${vehicleLabelById(a)}-${vehicleLabelById(b)}`).join(", ");
  return `Collision detected between cars ${pairs}. Simulation stopped.`;
}

function setCollisionStatusIfNeeded() {
  const message = collisionStatusText();
  if (message) setStatus(message);
}

function showError(message) {
  setStatus(message);
  errorMessage.textContent = message;
  errorDialog.hidden = false;
  errorCloseButton.focus();
}

function hideError() {
  errorDialog.hidden = true;
}

function parseCsv(text) {
  const rows = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const row = [];
    let current = "";
    let quoted = false;
    for (const char of line) {
      if (char === "\"") quoted = !quoted;
      else if (char === "," && !quoted) {
        row.push(current.trim());
        current = "";
      } else current += char;
    }
    row.push(current.trim());
    rows.push(row);
  }
  return rows;
}

function stripComment(line) {
  const index = line.indexOf("#");
  return index >= 0 ? line.slice(0, index) : line;
}

function afterColon(line) {
  const index = line.indexOf(":");
  return index >= 0 ? line.slice(index + 1).trim() : "";
}

function splitList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseYamlNumber(node, key, fallback = 0) {
  const child = node?.child(key);
  if (!child || !child.value.trim()) return fallback;
  const value = parseFloat(child.value);
  if (!Number.isFinite(value)) {
    throw new Error(`${key} on line ${child.line} must be a number; got "${child.value}".`);
  }
  return value;
}

function parseOptionalYamlNumber(node, key) {
  const child = node?.child(key);
  if (!child || !child.value.trim()) return null;
  const value = parseFloat(child.value);
  if (!Number.isFinite(value)) {
    throw new Error(`${key} on line ${child.line} must be a number; got "${child.value}".`);
  }
  return value;
}

function countIndent(line) {
  let count = 0;
  for (const char of line) {
    if (char === " ") count += 1;
    else if (char === "\t") count += 4;
    else break;
  }
  return count;
}

class YamlNode {
  constructor(key = "", value = "", anchor = "", line = 0) {
    this.key = key;
    this.originalKey = key;
    this.value = value.trim();
    this.anchor = anchor;
    this.line = line;
    this.children = new Map();
    this.order = [];
  }

  add(child) {
    let key = child.key;
    if (this.children.has(key)) {
      let copyIndex = 1;
      let renamed = `${key}${copyIndex}`;
      while (this.children.has(renamed)) {
        copyIndex += 1;
        renamed = `${key}${copyIndex}`;
      }
      child.originalKey = key;
      child.key = renamed;
    }
    this.children.set(child.key, child);
    this.order.push(child);
  }

  has(key) {
    return this.children.has(key);
  }

  child(key) {
    return this.children.get(key) || null;
  }

  childValue(key, fallback = "") {
    const child = this.child(key);
    return child ? child.value.trim() : fallback;
  }
}

function parseSimpleYaml(text) {
  const root = new YamlNode("__root__");
  const stack = [{ indent: -1, node: root }];
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const lineNumber = lineIndex + 1;
    const uncommented = stripComment(rawLine);
    if (!uncommented.trim()) continue;
    const indent = countIndent(uncommented);
    const trimmed = uncommented.trim();
    const colon = trimmed.indexOf(":");
    if (colon < 0) {
      throw new Error(`YAML parse error on line ${lineNumber}: expected "key: value".`);
    }
    const key = trimmed.slice(0, colon).trim();
    if (!key) {
      throw new Error(`YAML parse error on line ${lineNumber}: missing key before ":".`);
    }
    let value = trimmed.slice(colon + 1).trim();
    let anchor = "";
    const anchorMatch = value.match(/^(.*?)\s*&([A-Za-z0-9_]+)\s*$/);
    if (anchorMatch) {
      value = anchorMatch[1].trim();
      anchor = anchorMatch[2];
    }
    const node = new YamlNode(key, value, anchor, lineNumber);
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    if (!stack.length) {
      throw new Error(`YAML parse error on line ${lineNumber}: invalid indentation.`);
    }
    stack[stack.length - 1].node.add(node);
    stack.push({ indent, node });
  }
  return root;
}

function nodeChildrenWithPrefix(node, prefix) {
  if (!node) return [];
  return node.order.filter((child) => child.key.startsWith(prefix));
}

function parseCarsYaml(text) {
  const root = parseSimpleYaml(text);
  const anchorPaths = new Map();
  const vehicles = [];
  const seenIds = new Map();

  for (const child of root.order) {
    if (child.anchor) {
      anchorPaths.set(child.anchor, {
        type: child.childValue("Type", "Loop"),
        route: splitList(child.childValue("Segments")),
      });
    }
  }

  for (const node of nodeChildrenWithPrefix(root, "Vehicle")) {
    const id = Number(node.value);
    if (!Number.isInteger(id)) {
      throw new Error(`${node.key} on line ${node.line} has an invalid vehicle id "${node.value}".`);
    }
    if (seenIds.has(id)) {
      throw new Error(`${node.key} on line ${node.line} reuses vehicle id ${id}; first used by ${seenIds.get(id)}.`);
    }
    seenIds.set(id, node.key);
    const vehicle = {
      id,
      key: node.key,
      version: node.childValue("Version", "manta"),
      mode: node.childValue("Mode", "CAV"),
      controller: "IDM",
      controllers: splitList(node.childValue("Controllers")),
      switchSegments: splitList(node.childValue("Switch")),
      speed: 0.35,
      idm: { ...DEFAULT_IDM },
      route: [],
      pathType: "Loop",
    };

    const pathValue = node.childValue("Path");
    const inlinePath = node.child("Path");
    if (pathValue.startsWith("*")) {
      const path = anchorPaths.get(pathValue.slice(1));
      if (path) {
        vehicle.pathType = path.type;
        vehicle.route = path.route;
      } else {
        throw new Error(`${node.key} references unknown path anchor "${pathValue}".`);
      }
    } else if (inlinePath) {
      vehicle.pathType = inlinePath.childValue("Type", "Loop");
      vehicle.route = splitList(inlinePath.childValue("Segments"));
    } else {
      throw new Error(`${node.key} is missing a Path definition.`);
    }

    if (!vehicle.controllers.length && node.has("Controller")) {
      vehicle.controllers = ["Controller"];
      vehicle.controller = node.childValue("Controller", "IDM");
    } else if (vehicle.controllers.length) {
      vehicle.controller = vehicle.controllers[0];
    }

    const speedNodes = vehicle.controllers.length ? vehicle.controllers : ["Controller"];
    for (const controllerName of speedNodes) {
      const controllerNode = node.child(controllerName);
      if (!controllerNode) continue;
      const speed = parseOptionalYamlNumber(controllerNode, "speed");
      if (speed !== null) {
        vehicle.speed = speed;
      }
      for (const key of Object.keys(DEFAULT_IDM)) {
        const value = parseOptionalYamlNumber(controllerNode, key);
        if (value !== null) vehicle.idm[key] = value;
      }
      break;
    }

    if (!vehicle.route.length && vehicle.pathType !== "HDV") {
      throw new Error(`${node.key} does not include any route segments.`);
    }
    if (vehicle.route.length) vehicles.push(vehicle);
  }

  return { vehicles };
}

function parseExperimentYaml(text) {
  const root = parseSimpleYaml(text);
  const experiment = root.order.find((child) => child.key.startsWith("Experiment")) || root;
  const queues = [];
  const yields = [];
  const stops = [];
  const controlZones = [];

  for (const child of experiment.order) {
    if (child.key.startsWith("Queue")) {
      const typeNode = child.child("type");
      const segmentsNode = child.child("segments");
      const deterministic = (typeNode?.value || "").startsWith("Det");
      queues.push({
        name: child.key,
        label: child.value,
        random: !deterministic,
        inflow: parseYamlNumber(typeNode, "inflow"),
        inflowMin: parseYamlNumber(typeNode, "inflowMin"),
        inflowMax: parseYamlNumber(typeNode, "inflowMax"),
        delay: parseYamlNumber(typeNode, "delay"),
        delayMin: parseYamlNumber(typeNode, "inflowDelayMin"),
        delayMax: parseYamlNumber(typeNode, "inflowDelayMax"),
        releaseDelta: parseYamlNumber(typeNode, "releaseDelta"),
        segments: splitList(segmentsNode?.value || ""),
        offset: parseYamlNumber(segmentsNode, "offset"),
        backup: splitList(segmentsNode?.childValue("backup", "")),
      });
    } else if (child.key.startsWith("Yield")) {
      const segmentsNode = child.child("segments");
      const yieldToNode = child.child("yieldTo");
      const yieldSegments = splitList(yieldToNode?.value || "");
      const offsets = splitList(yieldToNode?.childValue("offsets", "")).map(Number).filter(Number.isFinite);
      while (offsets.length < yieldSegments.length) offsets.push(0);
      yields.push({
        name: child.key,
        label: child.value,
        segments: splitList(segmentsNode?.value || ""),
        offset: parseYamlNumber(segmentsNode, "offset"),
        yieldTo: yieldSegments,
        offsets,
      });
    } else if (child.key.startsWith("Stop")) {
      const groups = [];
      for (const groupNode of nodeChildrenWithPrefix(child, "Group")) {
        groups.push({
          name: groupNode.key,
          label: groupNode.value,
          segments: splitList(groupNode.childValue("segments")),
          offset: 0,
        });
      }
      stops.push({
        name: child.key,
        label: child.value,
        groups,
        conflictSegments: splitList(child.childValue("conflictSegments")),
      });
    } else if (child.key.startsWith("ControlZone")) {
      const entries = [];
      const nodes = [];
      for (const zoneChild of child.order) {
        if (zoneChild.key.startsWith("ControlZone")) {
          entries.push({
            name: zoneChild.key,
            label: zoneChild.value,
            segments: splitList(zoneChild.childValue("segments")),
            initialOffset: Number(zoneChild.childValue("initialOffset", "0")) || 0,
            finalOffset: Number(zoneChild.childValue("finalOffset", "0")) || 0,
            safetyTimeGap: Number(zoneChild.childValue("safetyTimeGap", "0")) || 0,
          });
        } else if (zoneChild.key.startsWith("Node")) {
          nodes.push({
            name: zoneChild.key,
            label: zoneChild.value,
            segments: splitList(zoneChild.childValue("segments")),
            distances: splitList(zoneChild.childValue("distances")).map(Number).filter(Number.isFinite),
          });
        }
      }
      controlZones.push({
        name: child.key,
        label: child.value,
        scheduler: child.childValue("Scheduler", "SimpleFIFO"),
        entries,
        nodes,
      });
    }
  }

  return {
    baseline: experiment.childValue("Baseline", "false").slice(0, 4) === "true",
    simulation: experiment.childValue("Simulation", "false").slice(0, 4) === "true",
    queues,
    yields,
    stops,
    controlZones,
  };
}

class Segment {
  constructor(data) {
    Object.assign(this, data);
    this.xExpr = data.xExpr;
    this.yExpr = data.yExpr;
    this.xFn = compileExpr(this.xExpr);
    this.yFn = compileExpr(this.yExpr);
  }

  point(r) {
    return { x: this.xFn(r), y: this.yFn(r) };
  }

  tangent(r, h = 1e-3) {
    const a = this.point(r - h);
    const b = this.point(r + h);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const norm = Math.hypot(dx, dy) || 1;
    return { x: dx / norm, y: dy / norm };
  }

  project(point) {
    if (this.kind === "line") {
      const p0 = this.point(0);
      const p1 = this.point(1);
      const ux = p1.x - p0.x;
      const uy = p1.y - p0.y;
      return (point.x - p0.x) * ux + (point.y - p0.y) * uy;
    }

    const start = this.point(0);
    const vx0 = start.x - this.x;
    const vy0 = start.y - this.y;
    const vx = point.x - this.x;
    const vy = point.y - this.y;
    let relative = Math.atan2(vx0 * vy - vy0 * vx, vx0 * vx + vy0 * vy);
    if (!this.ccw && relative < 0) relative *= -1;
    if (relative < -Math.PI / 6) relative += 2 * Math.PI;
    return this.radius * relative;
  }
}

class RoadMap {
  constructor() {
    this.segments = new Map();
  }

  load(linesText, arcsText) {
    this.segments.clear();
    for (const row of parseCsv(linesText).slice(1)) {
      if (row.length < 5) continue;
      const [id, direction, lengthText, xText, yText] = row;
      const length = Number(lengthText);
      const x = Number(xText);
      const y = Number(yText);
      if (!id || !Number.isFinite(length)) continue;
      let xExpr = `${x}`;
      let yExpr = `${y}`;
      if (direction === "+Y") yExpr = `-r + ${y}`;
      else if (direction === "-Y") yExpr = `r + ${y}`;
      else if (direction === "+X") xExpr = `-r + ${x}`;
      else if (direction === "-X") xExpr = `r + ${x}`;
      this.segments.set(id, new Segment({
        id,
        kind: "line",
        direction,
        length,
        x,
        y,
        speedLimit: 0.5,
        xExpr,
        yExpr,
      }));
    }

    for (const row of parseCsv(arcsText).slice(1)) {
      if (row.length < 7) continue;
      const [id, xText, yText, radiusText, startText, endText, rotation] = row;
      const x = Number(xText);
      const y = Number(yText);
      const radius = Number(radiusText);
      const start = Number(startText);
      const end = Number(endText);
      const ccw = (rotation || "").trim() === "CCW";
      if (!id || !Number.isFinite(radius)) continue;
      const arg = ccw ? `((r)/${radius})+(${start})` : `(-(r)/${radius})+(${end})`;
      this.segments.set(id, new Segment({
        id,
        kind: "arc",
        x,
        y,
        radius,
        start,
        end,
        ccw,
        length: Math.abs(end - start) * radius,
        speedLimit: 0.25,
        xExpr: `${radius}*cos(${arg})+(${x})`,
        yExpr: `${radius}*sin(${arg})+(${y})`,
      }));
    }
  }

  get(id) {
    const segment = this.segments.get(id);
    if (!segment) throw new Error(`Missing map segment ${id}`);
    return segment;
  }

  all() {
    return [...this.segments.values()];
  }

  routeLength(route) {
    return route.reduce((sum, id) => sum + this.get(id).length, 0);
  }
}

function compileExpr(expr) {
  const jsExpr = expr.replace(/\bcos\b/g, "Math.cos").replace(/\bsin\b/g, "Math.sin");
  return new Function("r", `"use strict"; return (${jsExpr});`);
}

function hardwareFor(config) {
  const version = (config.version || "manta").toLowerCase();
  const family = HARDWARE[version] ? version : "manta";
  return { ...HARDWARE[family].default, version: family };
}

class CarPathController {
  constructor(hardware) {
    this.hardware = hardware;
    this.skAg = -hardware.mass / (2 * hardware.cy);
    this.calib = 0;
    this.r = 0;
    this.r2 = 0;
    this.lastT = 0;
    this.timePrev = 0;
    this.velOld = 0;
    this.prevSteer = 0;
    this.lastPosError = 0;
    this.velocityDesired = 0;
    this.positionDesired = { x: 0, y: 0 };
    this.pathLength = 1;
    this.pathSegment = null;
    this.nextPathSegment = null;
    this.cmdType = "IDM";
  }

  initialize(r0, calib, t) {
    this.r = r0;
    this.r2 = r0;
    this.calib = calib;
    this.lastT = t;
    this.timePrev = t;
    this.velOld = 0;
  }

  captureState() {
    return {
      r: this.r,
      r2: this.r2,
      lastT: this.lastT,
      timePrev: this.timePrev,
      velOld: this.velOld,
      prevSteer: this.prevSteer,
      lastPosError: this.lastPosError,
      velocityDesired: this.velocityDesired,
      positionDesired: { ...this.positionDesired },
      pathLength: this.pathLength,
      cmdType: this.cmdType,
      velocityProfile: [...(this.velocityProfile || [])],
      timeStamp: [...(this.timeStamp || [])],
    };
  }

  restoreState(snapshot) {
    this.r = snapshot.r;
    this.r2 = snapshot.r2;
    this.lastT = snapshot.lastT;
    this.timePrev = snapshot.timePrev;
    this.velOld = snapshot.velOld;
    this.prevSteer = snapshot.prevSteer;
    this.lastPosError = snapshot.lastPosError;
    this.velocityDesired = snapshot.velocityDesired;
    this.positionDesired = { ...snapshot.positionDesired };
    this.pathLength = snapshot.pathLength;
    this.cmdType = snapshot.cmdType;
    this.velocityProfile = [...(snapshot.velocityProfile || [])];
    this.timeStamp = [...(snapshot.timeStamp || [])];
  }

  receive(command, pose, t) {
    const oldSegment = this.pathSegment?.id || "";
    this.cmdType = command.type;
    this.pathLength = command.pathLength;
    this.pathSegment = command.segment;
    this.nextPathSegment = command.nextSegment;
    this.velocityProfile = command.velocityProfile;
    this.timeStamp = command.timeStamp;

    if (command.type === "IDM") {
      this.r = Math.max(command.pathLength, 0.01);
      this.pathLength = 100;
    } else if (oldSegment && oldSegment !== command.segment.id) {
      this.r2 -= this.pathLength;
      this.r = Math.max(0, this.r2);
    }

    this.pose = pose;
    if (this.timePrev === 0) this.timePrev = t;
  }

  evalPath(rPath) {
    if (rPath < 0) rPath = 0.01;
    let segment = this.pathSegment;
    let localR = rPath;
    if (rPath > this.pathLength && this.nextPathSegment) {
      localR = rPath - this.pathLength;
      segment = this.nextPathSegment;
    }
    const point = segment.point(localR);
    const tangent = segment.tangent(localR);
    return { point, tangent };
  }

  update(pose, t, dt) {
    if (!this.pathSegment) return { velocity: 0, steeringDeg: 0, desired: { x: pose.x, y: pose.y } };

    if (this.cmdType === "IDM") {
      this.velocityDesired = this.velocityProfile[0] || 0;
    } else {
      this.velocityDesired = interpolateProfile(this.timeStamp, this.velocityProfile, t);
    }

    if (this.cmdType === "TRAJ") {
      this.r += (this.velOld + this.velocityDesired) * dt * 0.5;
    }
    this.velOld = this.velocityDesired;

    const { point, tangent } = this.evalPath(this.r);
    this.positionDesired = point;
    const thetaD = Math.atan2(tangent.y, tangent.x);
    const dx = point.x - pose.x;
    const dy = point.y - pose.y;
    const yE = dx * -Math.sin(thetaD) + dy * Math.cos(thetaD);
    const thetaE = wrapAngle(thetaD - pose.theta);

    const dr = (this.velocityDesired + pose.v) * dt * 0.5;
    const next = this.evalPath(this.r + dr);
    const yawDotDesired = wrapAngle(Math.atan2(next.tangent.y, next.tangent.x) - thetaD) / Math.max(dt, 1e-4);

    let steeringDeg = this.stanley(thetaE, yE, yawDotDesired, pose);
    let velocity = this.velocityDesired;
    if (this.cmdType !== "IDM") velocity += this.velocityControl(dt, pose);
    if (this.velocityDesired <= 0.001) {
      velocity = 0;
      steeringDeg = 0;
    }

    this.lastT = t;
    return { velocity: Math.max(0, velocity), steeringDeg, desired: point };
  }

  stanley(thetaE, yE, yawDotDesired, pose) {
    const copyVel = Math.max(pose.v, this.hardware.minStanleySpeed);
    const steer = (thetaE - this.skAg * copyVel * yawDotDesired)
      + Math.atan2(this.hardware.sk * yE, this.hardware.skSoft + copyVel)
      - this.hardware.skYaw * (pose.yawRate - yawDotDesired);
    const steerWithFeedback = this.hardware.useSteerFeedback
      ? steer + this.hardware.skSteer * (steer - this.prevSteer * Math.PI / 180)
      : steer;
    const steeringDeg = clamp(
      steerWithFeedback * 180 / Math.PI + this.calib,
      this.hardware.steeringMinDeg,
      this.hardware.steeringMaxDeg,
    );
    this.prevSteer = steeringDeg;
    return steeringDeg;
  }

  velocityControl(dt, pose) {
    const dx = this.positionDesired.x - pose.x;
    const dy = this.positionDesired.y - pose.y;
    const thetaPositions = Math.atan2(dy, dx);
    let thetaDiff = thetaPositions - pose.theta;
    if (Math.abs(thetaDiff) > Math.PI) thetaDiff = 2 * Math.PI - Math.abs(thetaDiff);
    const direction = Math.abs(thetaDiff) > 0.5 * Math.PI ? 1 : -1;
    const posError = Math.hypot(dx, dy) * direction;
    const posErrorI = clamp((posError + this.lastPosError) * 0.5 * dt, -this.hardware.antiwindup, this.hardware.antiwindup);
    this.lastPosError = posError;
    return this.hardware.kp * posError + this.hardware.ki * posErrorI;
  }
}

function interpolateProfile(times = [], speeds = [], t) {
  if (!times.length) return speeds[0] || 0;
  if (t <= times[0]) return speeds[0] || 0;
  if (t >= times[times.length - 1]) return speeds[speeds.length - 1] || 0;
  for (let i = 0; i < times.length - 1; i += 1) {
    if (t >= times[i] && t <= times[i + 1]) {
      const ratio = (t - times[i]) / (times[i + 1] - times[i]);
      return speeds[i] + (speeds[i + 1] - speeds[i]) * ratio;
    }
  }
  return speeds[0] || 0;
}

class SimVehicle {
  constructor(config, map, initialDistance) {
    this.config = config;
    this.id = config.id;
    this.route = config.route;
    this.hardware = hardwareFor(config);
    this.controller = new CarPathController(this.hardware);
    this.targetSpeed = Number.isFinite(config.speed) ? config.speed : 0.35;
    this.routeDistance = initialDistance;
    this.segmentIndex = 0;
    this.r = 0;
    this.pose = { x: 0, y: 0, theta: 0, v: 0, yawRate: 0 };
    this.desired = { x: 0, y: 0 };
    this.syncRoutePosition(map);
    this.desired = { x: this.pose.x, y: this.pose.y };
    this.controller.initialize(this.r, 0, 0);
  }

  syncRoutePosition(map) {
    const total = map.routeLength(this.route);
    this.routeDistance = ((this.routeDistance % total) + total) % total;
    let remaining = this.routeDistance;
    for (let i = 0; i < this.route.length; i += 1) {
      const segment = map.get(this.route[i]);
      if (remaining <= segment.length || i === this.route.length - 1) {
        this.segmentIndex = i;
        this.r = remaining;
        const point = segment.point(this.r);
        const tangent = segment.tangent(this.r);
        this.pose.x = point.x;
        this.pose.y = point.y;
        this.pose.theta = Math.atan2(tangent.y, tangent.x);
        return;
      }
      remaining -= segment.length;
    }
  }

  currentSegment(map) {
    return map.get(this.route[this.segmentIndex]);
  }

  nextSegment(map) {
    return map.get(this.route[(this.segmentIndex + 1) % this.route.length]);
  }

  transitionIfNeeded(map) {
    let segment = this.currentSegment(map);
    while (this.r >= segment.length) {
      this.segmentIndex = (this.segmentIndex + 1) % this.route.length;
      this.r = 0.01;
      segment = this.currentSegment(map);
    }
    this.routeDistance = routeDistanceFromIndex(map, this.route, this.segmentIndex, this.r);
  }

  nextRouteSegmentId(offset = 1) {
    return this.route[(this.segmentIndex + offset) % this.route.length];
  }

  captureState() {
    return {
      id: this.id,
      routeDistance: this.routeDistance,
      segmentIndex: this.segmentIndex,
      r: this.r,
      pose: { ...this.pose },
      desired: { ...this.desired },
      control: this.control ? { ...this.control, desired: { ...this.control.desired } } : null,
      controller: this.controller.captureState(),
    };
  }

  restoreState(snapshot, map) {
    this.routeDistance = snapshot.routeDistance;
    this.segmentIndex = snapshot.segmentIndex;
    this.r = snapshot.r;
    this.pose = { ...snapshot.pose };
    this.desired = { ...snapshot.desired };
    this.control = snapshot.control ? { ...snapshot.control, desired: { ...snapshot.control.desired } } : null;
    this.controller.restoreState(snapshot.controller);
    if (map) {
      this.controller.pathSegment = this.currentSegment(map);
      this.controller.nextPathSegment = this.nextSegment(map);
    }
  }
}

class SimulationRuntime {
  constructor(map, scenario) {
    this.map = map;
    this.scenario = scenario;
    this.experiment = state.experiment || parseExperimentYaml("");
    this.time = 0;
    this.controlCarry = 0;
    this.mainframeCarry = 0;
    this.vehicles = createVehiclesWithLineup(map, scenario);
    this.intersections = buildIntersectionControls(this.experiment, map);
    this.experimentState = "WAITING";
    this.experimentCount = 0;
    this.collision = emptyCollision();
    this.history = [];
    this.historyCursor = null;
    this.updateMainframeCommands();
    this.updateControllers(CONTROL_DT);
    this.updateCollisionState();
    this.recordHistory();
  }

  reset() {
    this.time = 0;
    this.controlCarry = 0;
    this.mainframeCarry = 0;
    this.vehicles = createVehiclesWithLineup(this.map, this.scenario);
    this.intersections = buildIntersectionControls(this.experiment, this.map);
    this.experimentState = "WAITING";
    this.experimentCount = 0;
    this.collision = emptyCollision();
    this.history = [];
    this.historyCursor = null;
    this.updateMainframeCommands();
    this.updateControllers(CONTROL_DT);
    this.updateCollisionState();
    this.recordHistory();
  }

  step(dt) {
    if (this.collision.hasCollision) return false;

    let remaining = dt;
    while (remaining > 0) {
      const h = Math.min(SIM_DT, remaining);
      this.mainframeCarry += h;
      this.controlCarry += h;
      if (this.mainframeCarry >= MAINFRAME_DT) {
        this.mainframeCarry = 0;
        this.updateMainframeCommands();
      }
      if (this.controlCarry >= CONTROL_DT) {
        this.controlCarry = 0;
        this.updateControllers(CONTROL_DT);
      }
      this.integrate(h);
      this.time += h;
      this.updateCollisionState();
      if (this.collision.hasCollision) return false;
      remaining -= h;
    }
    this.recordHistory();
    return true;
  }

  updateMainframeCommands() {
    this.updateIntersections();
    for (const vehicle of this.vehicles) {
      vehicle.transitionIfNeeded(this.map);
      const current = vehicle.currentSegment(this.map);
      const next = vehicle.nextSegment(this.map);
      const speedCommand = this.idmSpeedCommand(vehicle);
      vehicle.controller.receive({
        type: "IDM",
        pathLength: Math.max(0.001, vehicle.r),
        segment: current,
        nextSegment: next,
        velocityProfile: [speedCommand, speedCommand],
        timeStamp: [this.time - 1, this.time + 1],
      }, vehicle.pose, this.time);
    }
  }

  idmSpeedCommand(vehicle) {
    const leader = findLeader(vehicle, this.vehicles, this.map);
    const { s0, th, a, b, delta } = vehicle.config.idm || DEFAULT_IDM;
    let vUpper = Math.min(vehicle.targetSpeed, vehicle.currentSegment(this.map).speedLimit);
    const v0 = vehicle.pose.v;
    const gate = this.intersectionGate(vehicle, leader);
    vUpper = Math.min(vUpper, this.controlZoneSpeedLimit(vehicle));
    const sn = Math.max(0.001, gate.distance - vehicle.hardware.length);
    const delV = v0 - gate.velocity;
    const sStar = s0 + Math.max(0, v0 * th + (v0 * delV) / (2 * Math.sqrt(a * b)));
    const accel = clamp(a * (1 - Math.pow(v0 / Math.max(vUpper, 0.001), delta) - Math.pow(sStar / sn, 2)), -10, 10);
    const command = v0 + accel * MAINFRAME_DT;
    return sn < s0 ? 0 : clamp(command + 0.05 * (command - v0), 0, vUpper);
  }

  startExperiment() {
    for (const control of this.intersections) {
      if (control.kind === "queue") control.start(this.time);
    }
  }

  stopExperiment() {
    this.experimentCount += 1;
    for (const control of this.intersections) {
      if (control.kind === "queue") control.reset();
    }
  }

  updateIntersections() {
    for (const control of this.intersections) {
      if (typeof control.update === "function") control.update(this);
    }
    this.updateExperimentLifecycle();
  }

  updateExperimentLifecycle() {
    const queues = this.intersections.filter((control) => control.kind === "queue");
    if (!queues.length) return;

    if (this.experimentState === "WAITING") {
      const ready = queues.every((queue) => queue.isReady());
      const allOperational = queues.every((queue) => queue.allOperational);
      if (ready && (this.experimentCount === 0 || allOperational)) {
        this.experimentState = "STARTING";
        this.startExperiment();
      }
      return;
    }

    if (this.experimentState === "STARTING") {
      this.experimentState = "RUNNING";
      return;
    }

    if (this.experimentState === "RUNNING" && queues.some((queue) => queue.isBack)) {
      this.experimentState = "WAITING";
      this.stopExperiment();
    }
  }

  intersectionGate(vehicle, leader) {
    let gate = leader;
    for (const control of this.intersectionsForVehicle(vehicle)) {
      const distance = control.distanceToGate(vehicle, this.map);
      if (distance <= 0) continue;
      const canGo = control.canGo(vehicle, this);
      if (!canGo) {
        const s0 = vehicle.config.idm?.s0 ?? DEFAULT_IDM.s0;
        const stopDistance = distance + 0.9 * s0;
        if (stopDistance <= gate.distance) gate = { distance: stopDistance, velocity: 0 };
      }
      if (distance < INTERSECTION_QUEUE_DISTANCE && typeof control.addToQueue === "function") {
        control.addToQueue(vehicle);
      }
    }

    for (const control of this.intersections) {
      if (typeof control.removeIfPast === "function") control.removeIfPast(vehicle, this);
    }
    return gate;
  }

  intersectionsForVehicle(vehicle) {
    return this.intersections.filter((control) => control.matchesVehicle(vehicle));
  }

  controlZoneSpeedLimit(vehicle) {
    let limit = Infinity;
    for (const control of this.intersectionsForVehicle(vehicle)) {
      if (typeof control.speedLimitFor === "function") limit = Math.min(limit, control.speedLimitFor(vehicle, this));
    }
    return Number.isFinite(limit) ? limit : vehicle.targetSpeed;
  }

  updateControllers(dt) {
    for (const vehicle of this.vehicles) {
      vehicle.control = vehicle.controller.update(vehicle.pose, this.time, dt);
      vehicle.desired = vehicle.control.desired;
    }
  }

  integrate(dt) {
    for (const vehicle of this.vehicles) {
      const control = vehicle.control || { velocity: 0, steeringDeg: 0 };
      const accelLimit = 1.2;
      const dv = clamp(control.velocity - vehicle.pose.v, -accelLimit * dt, accelLimit * dt);
      vehicle.pose.v = Math.max(0, vehicle.pose.v + dv);
      const steering = control.steeringDeg * Math.PI / 180;
      vehicle.pose.yawRate = vehicle.pose.v / vehicle.hardware.wheelbase * Math.tan(steering);
      vehicle.pose.theta = wrapAngle(vehicle.pose.theta + vehicle.pose.yawRate * dt);
      vehicle.pose.x += vehicle.pose.v * Math.cos(vehicle.pose.theta) * dt;
      vehicle.pose.y += vehicle.pose.v * Math.sin(vehicle.pose.theta) * dt;
      const current = vehicle.currentSegment(this.map);
      vehicle.r = current.project(vehicle.pose);
      vehicle.routeDistance = routeDistanceFromIndex(this.map, vehicle.route, vehicle.segmentIndex, vehicle.r);
      vehicle.transitionIfNeeded(this.map);
    }
  }

  updateCollisionState() {
    this.collision = detectVehicleCollisions(this.vehicles);
  }

  recordHistory() {
    this.historyCursor = null;
    this.history.push(this.captureState());
  }

  restoreHistoryPercent(percent) {
    if (!this.history.length) return;
    const index = Math.round(clamp(percent, 0, 1) * (this.history.length - 1));
    this.restoreState(this.history[index]);
    this.historyCursor = index;
    this.updateCollisionState();
  }

  commitHistoryCursor() {
    if (this.historyCursor === null) return;
    this.restoreState(this.history[this.historyCursor]);
    this.history = this.history.slice(0, this.historyCursor + 1);
    this.historyCursor = null;
  }

  captureState() {
    return {
      time: this.time,
      controlCarry: this.controlCarry,
      mainframeCarry: this.mainframeCarry,
      experimentState: this.experimentState,
      experimentCount: this.experimentCount,
      vehicles: this.vehicles.map((vehicle) => vehicle.captureState()),
      intersections: this.intersections.map((control) => control.captureState?.() || null),
      collision: {
        pairs: this.collision.pairs.map((pair) => [...pair]),
        vehicleIds: [...this.collision.vehicleIds],
      },
    };
  }

  restoreState(snapshot) {
    this.time = snapshot.time;
    this.controlCarry = snapshot.controlCarry;
    this.mainframeCarry = snapshot.mainframeCarry;
    this.experimentState = snapshot.experimentState;
    this.experimentCount = snapshot.experimentCount;
    for (const vehicleState of snapshot.vehicles) {
      const vehicle = this.vehicles.find((item) => item.id === vehicleState.id);
      if (vehicle) vehicle.restoreState(vehicleState, this.map);
    }
    snapshot.intersections.forEach((controlState, index) => {
      if (controlState && this.intersections[index]?.restoreState) {
        this.intersections[index].restoreState(controlState);
      }
    });
    this.collision = {
      hasCollision: snapshot.collision.pairs.length > 0,
      pairs: snapshot.collision.pairs.map((pair) => [...pair]),
      vehicleIds: new Set(snapshot.collision.vehicleIds),
    };
  }

}

class BaseIntersectionControl {
  constructor(kind, config) {
    this.kind = kind;
    this.config = config;
    this.queue = [];
  }

  matchesVehicle(vehicle) {
    return this.matchingGroup(vehicle) !== null;
  }

  matchingGroup(vehicle) {
    const groups = this.groups || [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      let found = true;
      for (let i = 0; i < group.segments.length; i += 1) {
        if (group.segments[i] !== vehicle.nextRouteSegmentId(i)) {
          found = false;
          break;
        }
      }
      if (found) return { group, groupIndex };
    }
    return null;
  }

  distanceToGate(vehicle, map) {
    const match = this.matchingGroup(vehicle);
    if (!match) return Infinity;
    return map.get(vehicle.route[vehicle.segmentIndex]).length - vehicle.r - (match.group.offset || 0);
  }

  addToQueue(vehicle) {
    if (this.queue.some((item) => item.id === vehicle.id)) return;
    this.queue.push({ id: vehicle.id, nextSegment: vehicle.nextRouteSegmentId() });
  }

  removeIfPast(vehicle, runtime) {
    if (!this.queue.some((item) => item.id === vehicle.id)) return;
    if (this.matchesVehicle(vehicle)) return;
    this.queue = this.queue.filter((item) => item.id !== vehicle.id);
  }

  captureState() {
    return {
      queue: this.queue.map((item) => ({ ...item })),
    };
  }

  restoreState(snapshot) {
    this.queue = snapshot.queue.map((item) => ({ ...item }));
  }
}

class QueueSignControl extends BaseIntersectionControl {
  constructor(config) {
    super("queue", config);
    this.groups = [{ segments: config.segments, offset: config.offset || 0 }];
    this.backupSegments = config.backup || [];
    this.reset();
  }

  reset() {
    if (this.config.random) {
      this.inflow = randomInt(this.config.inflowMin, this.config.inflowMax);
      this.delay = randomFloat(this.config.delayMin, this.config.delayMax);
    } else {
      this.inflow = this.config.inflow;
      this.delay = this.config.delay;
    }
    this.stop = true;
    this.passed = [];
    this.isBack = false;
    if (this.currentOccupants === undefined) this.currentOccupants = [];
    if (this.pastOccupants === undefined) this.pastOccupants = [];
    if (this.lastReleaseTime === undefined) this.lastReleaseTime = -Infinity;
    if (this.allOperational === undefined) this.allOperational = false;
  }

  start(time) {
    this.stop = false;
    this.startTime = time;
    this.passed = [];
    this.currentOccupants = [];
    this.pastOccupants = [];
    this.isBack = false;
  }

  update(runtime) {
    this.currentOccupants = vehiclesOnSegments(runtime.vehicles, [...this.groups[0].segments, ...this.backupSegments]);
    const enteredNow = this.currentOccupants.some((id) => !this.pastOccupants.includes(id));
    this.isBack = enteredNow;
    for (const id of this.pastOccupants) {
      if (!this.currentOccupants.includes(id)) {
        this.passed.push(id);
        this.lastReleaseTime = runtime.time;
      }
    }
    if (this.passed.length >= this.inflow) this.allOperational = true;
    this.pastOccupants = [...this.currentOccupants];
  }

  canGo(vehicle, runtime) {
    const current = vehicle.route[vehicle.segmentIndex];
    if (current !== this.groups[0].segments[0]) return true;
    if (this.stop) return false;
    if (runtime.time - this.startTime < this.delay) return false;
    if (runtime.time - this.lastReleaseTime < this.config.releaseDelta) return false;
    return true;
  }

  isReady() {
    return this.currentOccupants.length >= this.inflow;
  }

  captureState() {
    return {
      ...super.captureState(),
      inflow: this.inflow,
      delay: this.delay,
      stop: this.stop,
      passed: [...this.passed],
      currentOccupants: [...this.currentOccupants],
      pastOccupants: [...this.pastOccupants],
      lastReleaseTime: this.lastReleaseTime,
      startTime: this.startTime,
      isBack: this.isBack,
      allOperational: this.allOperational,
    };
  }

  restoreState(snapshot) {
    super.restoreState(snapshot);
    this.inflow = snapshot.inflow;
    this.delay = snapshot.delay;
    this.stop = snapshot.stop;
    this.passed = [...snapshot.passed];
    this.currentOccupants = [...snapshot.currentOccupants];
    this.pastOccupants = [...snapshot.pastOccupants];
    this.lastReleaseTime = snapshot.lastReleaseTime;
    this.startTime = snapshot.startTime;
    this.isBack = snapshot.isBack;
    this.allOperational = snapshot.allOperational;
  }
}

class YieldSignControl extends BaseIntersectionControl {
  constructor(config) {
    super("yield", config);
    this.groups = [{ segments: config.segments, offset: config.offset || 0 }];
  }

  canGo(vehicle, runtime) {
    for (let i = 0; i < this.config.yieldTo.length; i += 1) {
      const segmentId = this.config.yieldTo[i];
      const offset = this.config.offsets[i] || 0;
      for (const other of runtime.vehicles) {
        if (other.id !== vehicle.id && other.route[other.segmentIndex] === segmentId && other.r >= offset) return false;
      }
    }
    return true;
  }
}

class StopZoneControl extends BaseIntersectionControl {
  constructor(config) {
    super("stop", config);
    this.groups = config.groups.map((group) => ({ segments: group.segments, offset: 0 }));
    this.fifo = [];
    this.hasStopped = false;
  }

  update(runtime) {
    let frontFound = false;
    const zoneSegments = this.groups.flatMap((group) => group.segments);
    for (const vehicle of runtime.vehicles) {
      if (!zoneSegments.includes(vehicle.route[vehicle.segmentIndex])) continue;
      if (!this.fifo.includes(vehicle.id)) {
        this.fifo.push(vehicle.id);
        if (this.fifo.length === 1) frontFound = true;
      } else if (vehicle.id === this.fifo[0]) {
        frontFound = true;
      }
    }
    if (!frontFound && this.fifo.length > 0) {
      this.fifo.shift();
      this.hasStopped = false;
    }
  }

  canGo(vehicle, runtime) {
    if (!this.fifo.length || this.fifo[0] !== vehicle.id) return false;
    this.hasStopped = this.hasStopped || vehicle.pose.v < 0.02;
    let conflictCount = 0;
    for (const other of runtime.vehicles) {
      if (other.id !== vehicle.id && this.config.conflictSegments.includes(other.route[other.segmentIndex])) conflictCount += 1;
    }
    return this.hasStopped && conflictCount === 0;
  }

  captureState() {
    return {
      ...super.captureState(),
      fifo: [...this.fifo],
      hasStopped: this.hasStopped,
    };
  }

  restoreState(snapshot) {
    super.restoreState(snapshot);
    this.fifo = [...snapshot.fifo];
    this.hasStopped = snapshot.hasStopped;
  }
}

class ControlZoneControl extends BaseIntersectionControl {
  constructor(config, map) {
    super("control-zone", config);
    this.scheduler = config.scheduler || "SimpleFIFO";
    this.groups = config.entries.map((entry) => ({
      segments: entry.segments,
      offset: entry.initialOffset || 0,
      finalOffset: entry.finalOffset || 0,
      safetyTimeGap: entry.safetyTimeGap || 0,
      length: Math.max(0, entry.segments.reduce((sum, id) => sum + map.get(id).length, 0) - (entry.initialOffset || 0) - (entry.finalOffset || 0)),
    }));
    this.reservations = [];
  }

  distanceToGate(vehicle, map) {
    const match = this.matchingGroup(vehicle);
    if (!match) return Infinity;
    return map.get(vehicle.route[vehicle.segmentIndex]).length - vehicle.r - match.group.offset;
  }

  canGo(vehicle, runtime) {
    const match = this.matchingGroup(vehicle);
    if (!match) return true;
    let reservation = this.reservations.find((item) => item.id === vehicle.id);
    if (!reservation) {
      const previousExit = this.reservations.length ? this.reservations[this.reservations.length - 1].exitTime : runtime.time;
      const speed = Math.max(vehicle.pose.v, 0.05);
      const unconstrainedExit = runtime.time + match.group.length / speed;
      reservation = {
        id: vehicle.id,
        groupIndex: match.groupIndex,
        exitTime: Math.max(unconstrainedExit, previousExit + match.group.safetyTimeGap),
      };
      this.reservations.push(reservation);
    }
    return true;
  }

  speedLimitFor(vehicle, runtime) {
    const match = this.matchingGroup(vehicle);
    if (!match) return vehicle.targetSpeed;
    this.canGo(vehicle, runtime);
    const reservation = this.reservations.find((item) => item.id === vehicle.id);
    if (!reservation) return vehicle.targetSpeed;
    const position = this.distanceFromEntry(vehicle, match.group, runtime.map);
    const remainingDistance = Math.max(0, match.group.length - position);
    const remainingTime = Math.max(MAINFRAME_DT, reservation.exitTime - runtime.time);
    return clamp(remainingDistance / remainingTime, 0.02, vehicle.targetSpeed);
  }

  distanceFromEntry(vehicle, group, map) {
    let distance = -group.offset;
    for (const segmentId of group.segments) {
      if (segmentId === vehicle.route[vehicle.segmentIndex]) {
        return distance + vehicle.r;
      }
      distance += map.get(segmentId).length;
    }
    return 0;
  }

  removeIfPast(vehicle, runtime) {
    if (this.matchesVehicle(vehicle)) return;
    this.reservations = this.reservations.filter((item) => item.id !== vehicle.id);
  }

  captureState() {
    return {
      ...super.captureState(),
      reservations: this.reservations.map((item) => ({ ...item })),
    };
  }

  restoreState(snapshot) {
    super.restoreState(snapshot);
    this.reservations = snapshot.reservations.map((item) => ({ ...item }));
  }
}

function randomInt(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return 0;
  return Math.floor(randomFloat(min, max + 1));
}

function randomFloat(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return 0;
  return min + Math.random() * (max - min);
}

function vehiclesOnSegments(vehicles, segments) {
  return vehicles.filter((vehicle) => segments.includes(vehicle.route[vehicle.segmentIndex])).map((vehicle) => vehicle.id);
}

function buildIntersectionControls(experiment, map) {
  const controls = [];
  for (const queue of experiment?.queues || []) {
    if (queue.segments.length) controls.push(new QueueSignControl(queue));
  }
  for (const yieldSign of experiment?.yields || []) {
    if (yieldSign.segments.length) controls.push(new YieldSignControl(yieldSign));
  }
  for (const stop of experiment?.stops || []) {
    if (stop.groups.length) controls.push(new StopZoneControl(stop));
  }
  for (const zone of experiment?.controlZones || []) {
    if (zone.entries.length) controls.push(new ControlZoneControl(zone, map));
  }
  return controls;
}

function routeKey(route) {
  return route.join(",");
}

function describeRoute(route) {
  return route.join(" -> ");
}

function deterministicQueueInflow(queue) {
  return queue.random ? null : queue.inflow;
}

function validateScenarioInputs(map, scenario, experiment) {
  const autonomousVehicles = scenario.vehicles.filter((vehicle) => vehicle.mode !== "HDV" && vehicle.route.length);
  const routeGroups = new Map();

  for (const vehicle of autonomousVehicles) {
    for (const segmentId of vehicle.route) {
      map.get(segmentId);
    }
    const key = routeKey(vehicle.route);
    if (!routeGroups.has(key)) routeGroups.set(key, []);
    routeGroups.get(key).push(vehicle);
  }

  for (const vehicles of routeGroups.values()) {
    const route = vehicles[0].route;
    const startSegment = map.get(route[0]);
    const maxLength = Math.max(...vehicles.map((vehicle) => hardwareFor(vehicle).length));
    const spacing = maxLength + DEFAULT_LINEUP_GAP;
    const rearClearance = Math.max(0, maxLength - CAR_ORIGIN_REARWARD_OFFSET);
    const requiredLength = DEFAULT_FRONT_MARGIN + rearClearance + (vehicles.length - 1) * spacing;
    if (requiredLength > startSegment.length + 1e-9) {
      const ids = vehicles.map((vehicle) => `${vehicle.key || "Vehicle"}:${vehicle.id}`).join(", ");
      throw new Error(`Start segment ${route[0]} is too short for ${vehicles.length} cars on route ${describeRoute(route)}. Needs ${requiredLength.toFixed(2)} m with the current lineup spacing, but ${route[0]} is ${startSegment.length.toFixed(2)} m. Vehicles: ${ids}.`);
    }
  }

  for (const queue of experiment?.queues || []) {
    for (const segmentId of [...queue.segments, ...queue.backup]) {
      map.get(segmentId);
    }
    if (!queue.segments.length) {
      throw new Error(`${queue.name} has no queue segments.`);
    }

    const expected = deterministicQueueInflow(queue);
    if (expected === null) {
      const actual = autonomousVehicles.filter((vehicle) => vehicle.route[0] === queue.segments[0]).length;
      if (actual < queue.inflowMin || actual > queue.inflowMax) {
        throw new Error(`${queue.name} random inflow range ${queue.inflowMin}-${queue.inflowMax} does not include the ${actual} vehicles whose route starts on ${queue.segments[0]}.`);
      }
      continue;
    }

    const matchingVehicles = autonomousVehicles.filter((vehicle) => vehicle.route[0] === queue.segments[0]);
    if (matchingVehicles.length !== expected) {
      const ids = matchingVehicles.length
        ? matchingVehicles.map((vehicle) => `${vehicle.key || "Vehicle"}:${vehicle.id}`).join(", ")
        : "none";
      throw new Error(`${queue.name} inflow is ${expected}, but ${matchingVehicles.length} vehicles start on ${queue.segments[0]}. Matching vehicles: ${ids}.`);
    }
  }
}

function emptyCollision() {
  return { hasCollision: false, vehicleIds: new Set(), pairs: [] };
}

function routeDistanceFromIndex(map, route, index, r) {
  let distance = r;
  for (let i = 0; i < index; i += 1) distance += map.get(route[i]).length;
  return distance;
}

function sameRoute(a, b) {
  return a.route.length === b.route.length && a.route.every((segment, index) => segment === b.route[index]);
}

function findLeader(vehicle, vehicles, map) {
  const routeLength = map.routeLength(vehicle.route);
  let best = { distance: 999, velocity: vehicle.targetSpeed };
  for (const other of vehicles) {
    if (other === vehicle || !sameRoute(vehicle, other)) continue;
    let distance = other.routeDistance - vehicle.routeDistance;
    if (distance <= 0) distance += routeLength;
    if (distance < best.distance) best = { distance, velocity: other.pose.v };
  }
  return best;
}

function vehicleCollisionRect(vehicle) {
  const length = vehicle.hardware.length;
  const width = vehicle.hardware.width;
  const front = Math.min(CAR_ORIGIN_REARWARD_OFFSET, length);
  const rear = front - length;
  const halfWidth = width * 0.5;
  const forward = { x: Math.cos(vehicle.pose.theta), y: Math.sin(vehicle.pose.theta) };
  const side = { x: -forward.y, y: forward.x };
  const origin = vehicle.pose;
  const makeCorner = (longitudinal, lateral) => ({
    x: origin.x + forward.x * longitudinal + side.x * lateral,
    y: origin.y + forward.y * longitudinal + side.y * lateral,
  });
  const corners = [
    makeCorner(front, -halfWidth),
    makeCorner(front, halfWidth),
    makeCorner(rear, halfWidth),
    makeCorner(rear, -halfWidth),
  ];
  const aabb = corners.reduce((acc, corner) => ({
    minX: Math.min(acc.minX, corner.x),
    maxX: Math.max(acc.maxX, corner.x),
    minY: Math.min(acc.minY, corner.y),
    maxY: Math.max(acc.maxY, corner.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  return { vehicle, corners, axes: [forward, side], aabb };
}

function rectsOverlap(a, b) {
  for (const axis of [...a.axes, ...b.axes]) {
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const corner of a.corners) {
      const projection = corner.x * axis.x + corner.y * axis.y;
      minA = Math.min(minA, projection);
      maxA = Math.max(maxA, projection);
    }
    for (const corner of b.corners) {
      const projection = corner.x * axis.x + corner.y * axis.y;
      minB = Math.min(minB, projection);
      maxB = Math.max(maxB, projection);
    }
    if (maxA <= minB || maxB <= minA) return false;
  }
  return true;
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function detectVehicleCollisions(vehicles) {
  const rects = vehicles.map(vehicleCollisionRect);
  const grid = new Map();
  const tested = new Set();
  const pairs = [];
  const vehicleIds = new Set();

  for (const rect of rects) {
    const minCellX = Math.floor(rect.aabb.minX / COLLISION_CELL_SIZE);
    const maxCellX = Math.floor(rect.aabb.maxX / COLLISION_CELL_SIZE);
    const minCellY = Math.floor(rect.aabb.minY / COLLISION_CELL_SIZE);
    const maxCellY = Math.floor(rect.aabb.maxY / COLLISION_CELL_SIZE);

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const key = cellKey(cellX, cellY);
        const occupants = grid.get(key) || [];
        for (const other of occupants) {
          const low = Math.min(rect.vehicle.id, other.vehicle.id);
          const high = Math.max(rect.vehicle.id, other.vehicle.id);
          const pairKey = `${low}:${high}`;
          if (tested.has(pairKey)) continue;
          tested.add(pairKey);
          if (rectsOverlap(rect, other)) {
            pairs.push([low, high]);
            vehicleIds.add(low);
            vehicleIds.add(high);
          }
        }
        occupants.push(rect);
        grid.set(key, occupants);
      }
    }
  }

  return { hasCollision: pairs.length > 0, vehicleIds, pairs };
}

function createVehiclesWithLineup(map, scenario) {
  const groups = new Map();
  for (const config of scenario.vehicles.filter((vehicle) => vehicle.mode !== "HDV" && vehicle.route.length)) {
    const key = config.route.join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(config);
  }

  const vehicles = [];
  for (const configs of groups.values()) {
    const startSegment = map.get(configs[0].route[0]);
    const firstR = Math.max(0.01, startSegment.length - DEFAULT_FRONT_MARGIN);
    const spacing = Math.max(...configs.map((config) => hardwareFor(config).length)) + DEFAULT_LINEUP_GAP;
    configs.forEach((config, index) => {
      vehicles.push(new SimVehicle(config, map, firstR - index * spacing));
    });
  }
  return vehicles;
}

function segmentSamples() {
  const points = [];
  for (const segment of state.map?.all() || []) {
    const steps = Math.max(2, Math.ceil(segment.length / 0.04));
    for (let i = 0; i <= steps; i += 1) points.push(segment.point(segment.length * i / steps));
  }
  for (const vehicle of state.runtime?.vehicles || []) {
    points.push(vehicle.pose);
    points.push(vehicle.desired);
  }
  return points;
}

function computeBounds() {
  const points = segmentSamples();
  if (!points.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  const bounds = points.reduce((acc, point) => ({
    minX: Math.min(acc.minX, point.x),
    maxX: Math.max(acc.maxX, point.x),
    minY: Math.min(acc.minY, point.y),
    maxY: Math.max(acc.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const padX = Math.max(0.4, (bounds.maxX - bounds.minX) * 0.08);
  const padY = Math.max(0.4, (bounds.maxY - bounds.minY) * 0.08);
  return { minX: bounds.minX - padX, maxX: bounds.maxX + padX, minY: bounds.minY - padY, maxY: bounds.maxY + padY };
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * scale));
  canvas.height = Math.max(240, Math.floor(rect.height * scale));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function makeProjector() {
  const rect = canvas.getBoundingClientRect();
  const bounds = state.bounds || computeBounds();
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  const scale = Math.min(rect.width / worldWidth, rect.height / worldHeight);
  const offsetX = (rect.width - worldWidth * scale) / 2;
  const offsetY = (rect.height - worldHeight * scale) / 2;
  return {
    scale,
    bounds,
    imagePoint: (point) => ({
      x: offsetX + (point.x - bounds.minX) * scale,
      y: offsetY + (bounds.maxY - point.y) * scale,
    }),
    point: (point) => ({
      x: offsetX + (bounds.maxX - point.x) * scale,
      y: offsetY + (point.y - bounds.minY) * scale,
    }),
  };
}

function drawPolyline(points, project, color, width) {
  if (points.length < 2) return;
  ctx.beginPath();
  const first = project.point(points[0]);
  ctx.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    const p = project.point(point);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function drawMap(project) {
  for (const segment of state.map.all()) {
    const steps = Math.max(2, Math.ceil(segment.length / 0.04));
    const points = [];
    for (let i = 0; i <= steps; i += 1) points.push(segment.point(segment.length * i / steps));
    drawPolyline(points, project, "rgba(93, 107, 115, 0.28)", 2);
  }
}

function drawBackground(project) {
  const image = state.backgroundImage;
  if (!state.backgroundReady || !image?.naturalWidth || !image?.naturalHeight) return;

  const x0 = MAP_BACKGROUND.dx;
  const x1 = MAP_BACKGROUND.dx + MAP_BACKGROUND.scale * image.naturalWidth;
  const y0 = MAP_BACKGROUND.dy;
  const y1 = MAP_BACKGROUND.dy + MAP_BACKGROUND.scale * image.naturalHeight;
  const topLeft = project.imagePoint({ x: x0, y: y1 });
  const bottomRight = project.imagePoint({ x: x1, y: y0 });

  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.drawImage(image, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  ctx.restore();
}

function drawRouteHighlights(project) {
  const runtimeVehicles = state.runtime?.vehicles || [];
  const occupiedRoutes = new Map();
  for (const vehicle of runtimeVehicles) {
    if (!vehicle.route.length) continue;
    const key = vehicle.route.join(",");
    if (!occupiedRoutes.has(key)) occupiedRoutes.set(key, vehicle.route);
  }

  let index = 0;
  for (const route of occupiedRoutes.values()) {
    const color = ROUTE_HIGHLIGHT_COLORS[index % ROUTE_HIGHLIGHT_COLORS.length];
    for (const segmentId of route) {
      const segment = state.map.get(segmentId);
      const steps = Math.max(2, Math.ceil(segment.length / 0.04));
      const points = [];
      for (let i = 0; i <= steps; i += 1) points.push(segment.point(segment.length * i / steps));
      drawPolyline(points, project, color, 9);
    }
    index += 1;
  }
}

function vehicleLabel(vehicle) {
  return `${vehicle.hardware.version}${vehicle.id}`;
}

function vehicleLabelById(id) {
  const vehicle = state.runtime?.vehicles.find((item) => item.id === id);
  return vehicle ? vehicleLabel(vehicle) : String(id);
}

function drawVehicle(vehicle, index, project) {
  const origin = project.point(vehicle.pose);
  const scale = project.scale;
  const length = vehicle.hardware.length * scale;
  const width = vehicle.hardware.width * scale;
  const originOffset = Math.min(CAR_ORIGIN_REARWARD_OFFSET, vehicle.hardware.length) * scale;
  const theta = -vehicle.pose.theta + Math.PI;
  const collided = state.runtime?.collision.vehicleIds.has(vehicle.id);

  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate(theta);
  if (collided) {
    ctx.shadowColor = "rgba(255, 195, 0, 0.88)";
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = collided ? "#ffd43b" : vehicle.config.mode === "HDV" ? "#777f86" : "#c82127";
  ctx.strokeStyle = collided ? "#101820" : "#ffffff";
  ctx.lineWidth = collided ? 2.4 : 1.5;
  ctx.beginPath();
  ctx.rect(-length + originOffset, -width / 2, length, width);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#101820";
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2.5, 0.018 * scale), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const desired = project.point(vehicle.desired);
  ctx.strokeStyle = "rgba(16,24,32,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(desired.x, desired.y);
  ctx.stroke();

  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "#172026";
  ctx.fillText(vehicleLabel(vehicle), origin.x + 9, origin.y - 9);
}

function drawEmptyMessage() {
  const rect = canvas.getBoundingClientRect();
  ctx.fillStyle = "#53636b";
  ctx.font = "15px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Upload Cars.yaml and Experiment.yaml to run the simulation.", rect.width / 2, rect.height / 2);
  ctx.textAlign = "start";
}

function draw() {
  resizeCanvas();
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#eaf0ef";
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (!state.map?.all().length) {
    drawEmptyMessage();
    return;
  }

  const project = makeProjector();
  drawBackground(project);
  drawRouteHighlights(project);
  drawMap(project);
  (state.runtime?.vehicles || []).forEach((vehicle, index) => drawVehicle(vehicle, index, project));
  updateReadouts();
}

function updateReadouts() {
  const time = state.runtime?.time || 0;
  const count = state.runtime?.vehicles.length || 0;
  timeReadout.textContent = `${time.toFixed(2)} s`;
  vehicleReadout.textContent = `${count} vehicle${count === 1 ? "" : "s"}`;
  if (!state.runtime) timeSlider.value = "0";
  else if (state.playing) timeSlider.value = "1";
}

function tick(nowMs) {
  if (!state.playing) return;
  const elapsed = state.lastTickMs ? (nowMs - state.lastTickMs) / 1000 : 0;
  state.lastTickMs = nowMs;
  const advanced = state.runtime?.step(Math.min(0.08, elapsed * Number(speedSelect.value)));
  if (state.runtime?.collision.hasCollision) {
    state.playing = false;
    playButton.textContent = "Play";
    setCollisionStatusIfNeeded();
  }
  draw();
  if (advanced !== false && state.playing) requestAnimationFrame(tick);
}

async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.text();
}

async function loadSample() {
  try {
    const [linesText, arcsText] = await Promise.all([
      fetchText(SAMPLE_PATHS.lines),
      fetchText(SAMPLE_PATHS.arcs),
    ]);
    state.sourceTexts = { lines: linesText, arcs: arcsText, cars: "", experiment: "" };
    loadMapOnly(linesText, arcsText);
    setStatus("Map loaded. Upload Cars.yaml and Experiment.yaml to start.");
  } catch (error) {
    showError("Could not load the default map. Start a local web server from the project root, or upload both map CSV files.");
    console.warn(error);
    draw();
  }
}

function loadMapOnly(linesText, arcsText) {
  state.map = new RoadMap();
  state.map.load(linesText, arcsText);
  state.scenario = { vehicles: [] };
  state.experiment = null;
  state.runtime = null;
  state.bounds = computeBounds();
  state.playing = false;
  state.lastTickMs = 0;
  playButton.textContent = "Play";
  timeSlider.value = "0";
  draw();
}

function loadRuntime(linesText, arcsText, carsText, experimentText) {
  try {
    state.map = new RoadMap();
    state.map.load(linesText, arcsText);
    state.scenario = parseCarsYaml(carsText);
    if (!state.scenario.vehicles.length) {
      throw new Error("Cars.yaml does not include any autonomous vehicles with valid routes.");
    }
    state.experiment = parseExperimentYaml(experimentText || "");
    validateScenarioInputs(state.map, state.scenario, state.experiment);
    state.runtime = new SimulationRuntime(state.map, state.scenario);
    state.bounds = computeBounds();
    state.playing = false;
    state.lastTickMs = 0;
    playButton.textContent = "Play";
    timeSlider.value = "1";
    draw();
    return true;
  } catch (error) {
    state.runtime = null;
    draw();
    showError(`Could not load this experiment. ${error.message}`);
    console.error(error);
    return false;
  }
}

async function readUploadedFile(input) {
  const file = input.files?.[0];
  return file ? file.text() : null;
}

function missingRuntimeMessage(action) {
  if (!state.sourceTexts.lines || !state.sourceTexts.arcs) {
    return `Upload both map CSV files before using ${action}.`;
  }
  const missing = [];
  if (!state.sourceTexts.cars) missing.push("Cars.yaml");
  if (!state.sourceTexts.experiment) missing.push("Experiment.yaml");
  if (missing.length) return `Upload ${missing.join(" and ")} before using ${action}.`;
  return "Load a valid experiment before using the playback controls.";
}

async function refreshFromUploads() {
  const [linesText, arcsText, carsText, experimentText] = await Promise.all([
    readUploadedFile(linesInput),
    readUploadedFile(arcsInput),
    readUploadedFile(carsInput),
    readUploadedFile(experimentInput),
  ]);

  state.sourceTexts = {
    lines: linesText || state.sourceTexts.lines,
    arcs: arcsText || state.sourceTexts.arcs,
    cars: carsText || state.sourceTexts.cars,
    experiment: experimentText || state.sourceTexts.experiment,
  };

  if (!state.sourceTexts.lines || !state.sourceTexts.arcs) {
    setStatus("Upload both map CSV files to replace the default map.");
    return;
  }

  if (!state.sourceTexts.cars || !state.sourceTexts.experiment) {
    loadMapOnly(state.sourceTexts.lines, state.sourceTexts.arcs);
    if (state.sourceTexts.cars) setStatus("Cars.yaml loaded. Upload Experiment.yaml to start.");
    else if (state.sourceTexts.experiment) setStatus("Experiment.yaml loaded. Upload Cars.yaml to start.");
    else setStatus("Map loaded. Upload Cars.yaml and Experiment.yaml to start.");
    return;
  }

  if (loadRuntime(state.sourceTexts.lines, state.sourceTexts.arcs, state.sourceTexts.cars, state.sourceTexts.experiment)) {
    setStatus(collisionStatusText() || "Simulation ready.");
  }
}

playButton.addEventListener("click", () => {
  if (!state.runtime) {
    showError(missingRuntimeMessage("Play"));
    return;
  }
  state.playing = !state.playing;
  playButton.textContent = state.playing ? "Pause" : "Play";
  state.lastTickMs = 0;
  if (state.playing) {
    state.runtime.commitHistoryCursor();
    timeSlider.value = "1";
  }
  setCollisionStatusIfNeeded();
  if (state.playing) requestAnimationFrame(tick);
});

errorCloseButton.addEventListener("click", hideError);
errorDialog.addEventListener("click", (event) => {
  if (event.target === errorDialog) hideError();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !errorDialog.hidden) hideError();
});

resetButton.addEventListener("click", () => {
  if (!state.runtime) {
    showError(missingRuntimeMessage("Reset"));
    return;
  }
  state.playing = false;
  playButton.textContent = "Play";
  state.runtime.reset();
  timeSlider.value = "1";
  setStatus(collisionStatusText() || "Simulation reset.");
  draw();
});

timeSlider.addEventListener("input", () => {
  if (!state.runtime) return;
  state.playing = false;
  playButton.textContent = "Play";
  state.runtime.restoreHistoryPercent(Number(timeSlider.value));
  setStatus(collisionStatusText() || "Simulation paused.");
  draw();
});

for (const input of [linesInput, arcsInput, carsInput, experimentInput]) {
  input.addEventListener("change", refreshFromUploads);
}

window.addEventListener("resize", draw);
loadBackgroundImage();
loadSample();
