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
      mass: 0.364,
      cy: 1.6,
      kp: 0.1225,
      ki: 0.015,
      antiwindup: 0.0125,
    },
  },
  manta: {
    default: {
      length: 0.2,
      width: 0.1,
      wheelbase: 0.12,
      steeringMinDeg: -45,
      steeringMaxDeg: 45,
      sk: 3.0,
      skSoft: 1.0,
      skYaw: 0.2,
      skSteer: 0.1,
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
const DEFAULT_LINEUP_GAP = 0.18;
const DEFAULT_FRONT_MARGIN = 0.04;
const CAR_ORIGIN_REARWARD_OFFSET = 0.02;
const COLLISION_CELL_SIZE = 0.35;
const ROUTE_HIGHLIGHT_COLORS = [
  "rgba(229, 72, 77, 0.48)",
  "rgba(46, 134, 222, 0.48)",
  "rgba(34, 166, 99, 0.48)",
  "rgba(245, 166, 35, 0.48)",
  "rgba(146, 83, 191, 0.48)",
  "rgba(28, 160, 170, 0.48)",
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
  const pairs = collision.pairs.map(([a, b]) => `${a}-${b}`).join(", ");
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

function parseCarsYaml(text) {
  const anchorRoutes = new Map();
  const vehicles = [];
  let currentAnchor = null;
  let currentVehicle = null;

  const finishVehicle = () => {
    if (!currentVehicle) return;
    if (currentVehicle.route.length) vehicles.push(currentVehicle);
    currentVehicle = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    const anchorMatch = line.match(/^[^:]+:\s*&([A-Za-z0-9_]+)/);
    if (anchorMatch) {
      finishVehicle();
      currentAnchor = anchorMatch[1];
      continue;
    }

    const vehicleMatch = line.match(/^Vehicle[^\s:]*\s*:\s*([0-9]+)/);
    if (vehicleMatch) {
      finishVehicle();
      currentAnchor = null;
      currentVehicle = {
        id: Number(vehicleMatch[1]),
        version: "manta",
        mode: "CAV",
        controller: "IDM",
        speed: 0.35,
        route: [],
      };
      continue;
    }

    if (line.startsWith("Segments")) {
      const route = splitList(afterColon(line));
      if (currentAnchor) anchorRoutes.set(currentAnchor, route);
      else if (currentVehicle) currentVehicle.route = route;
      continue;
    }

    if (!currentVehicle) continue;
    if (line.startsWith("Version")) currentVehicle.version = afterColon(line) || "manta";
    else if (line.startsWith("Mode")) currentVehicle.mode = afterColon(line) || "CAV";
    else if (line.startsWith("Path")) {
      const value = afterColon(line);
      if (value.startsWith("*")) currentVehicle.route = anchorRoutes.get(value.slice(1)) || [];
    } else if (line.startsWith("Controllers")) {
      currentVehicle.controller = splitList(afterColon(line))[0] || "IDM";
    } else if (line.match(/^speed\s*:/)) {
      currentVehicle.speed = Number(afterColon(line));
    }
  }

  finishVehicle();
  return { vehicles };
}

function parseExperimentYaml(text) {
  return { raw: text };
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
    const copyVel = Math.max(pose.v, 0.2);
    const steer = (thetaE - this.skAg * copyVel * yawDotDesired)
      + Math.atan2(this.hardware.sk * yE, this.hardware.skSoft + copyVel)
      - this.hardware.skYaw * (pose.yawRate - yawDotDesired);
    const steeringDeg = clamp(
      steer * 180 / Math.PI + this.calib,
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
}

class SimulationRuntime {
  constructor(map, scenario) {
    this.map = map;
    this.time = 0;
    this.controlCarry = 0;
    this.mainframeCarry = 0;
    this.vehicles = createVehiclesWithLineup(map, scenario);
    this.collision = emptyCollision();
    this.updateMainframeCommands();
    this.updateControllers(CONTROL_DT);
    this.updateCollisionState();
  }

  reset() {
    this.time = 0;
    this.controlCarry = 0;
    this.mainframeCarry = 0;
    this.vehicles = createVehiclesWithLineup(this.map, state.scenario);
    this.collision = emptyCollision();
    this.updateMainframeCommands();
    this.updateControllers(CONTROL_DT);
    this.updateCollisionState();
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
    return true;
  }

  updateMainframeCommands() {
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
    const s0 = 0.22;
    const th = 0.8;
    const a = 0.9;
    const b = 0.8;
    const delta = 4;
    const vUpper = Math.min(vehicle.targetSpeed, vehicle.currentSegment(this.map).speedLimit);
    const v0 = vehicle.pose.v;
    const sn = Math.max(0.001, leader.distance - vehicle.hardware.length);
    const delV = v0 - leader.velocity;
    const sStar = s0 + Math.max(0, v0 * th + (v0 * delV) / (2 * Math.sqrt(a * b)));
    const accel = clamp(a * (1 - Math.pow(v0 / Math.max(vUpper, 0.001), delta) - Math.pow(sStar / sn, 2)), -10, 10);
    const command = v0 + accel * MAINFRAME_DT;
    return sn < s0 ? 0 : clamp(command + 0.05 * (command - v0), 0, vUpper);
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
    const spacing = HARDWARE.lotus.default.length + DEFAULT_LINEUP_GAP;
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
    drawPolyline(points, project, "#5d6b73", 3);
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
      drawPolyline(points, project, color, 12);
    }
    index += 1;
  }
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
  ctx.fillText(String(vehicle.id), origin.x + 9, origin.y - 9);
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
  timeSlider.value = Math.min(Number(timeSlider.max), time).toFixed(1);
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
    state.runtime = new SimulationRuntime(state.map, state.scenario);
    state.bounds = computeBounds();
    state.playing = false;
    state.lastTickMs = 0;
    playButton.textContent = "Play";
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
  setStatus(collisionStatusText() || "Simulation reset.");
  draw();
});

timeSlider.addEventListener("input", () => {
  if (!state.runtime) return;
  const target = Number(timeSlider.value);
  state.runtime.reset();
  while (state.runtime.time < target) {
    const advanced = state.runtime.step(Math.min(0.1, target - state.runtime.time));
    if (advanced === false) break;
  }
  state.playing = false;
  playButton.textContent = "Play";
  setStatus(collisionStatusText() || "Simulation paused.");
  draw();
});

for (const input of [linesInput, arcsInput, carsInput, experimentInput]) {
  input.addEventListener("change", refreshFromUploads);
}

window.addEventListener("resize", draw);
loadBackgroundImage();
loadSample();
