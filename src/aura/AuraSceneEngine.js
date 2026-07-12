// Aura Mode 3D scene — vanilla three.js engine (no react-three-fiber).
// UI-only: one containment sphere (fresnel hologram shader, GPU voice
// ripple) holds the fleet as a radial tree — account at the center, devices
// branching out, workspaces off each device, panels (terminal/web/pcb/video/
// docs, shape-coded) off each workspace, scripts orbiting the device.
// Node cores glow with state color; every label is a readable backed pill
// with a status/kind dot. The React shell (AuraMode.jsx) owns the DOM HUD.
//
// Lifecycle: the render loop pauses whenever the document is hidden, and
// dispose() tears down geometry/materials/textures and force-releases the
// WebGL context — Aura is conditionally mounted, so a closed Aura holds no
// GPU or CPU resources at all.

import * as THREE from "three";

import {
  AURA_DEVICE_KIND_COLORS,
  AURA_DEVICE_KIND_LABELS,
  AURA_PANEL_KIND_META,
  AURA_STATE_COLORS,
  AURA_STATE_LABELS,
  auraWorkspaceState,
} from "./auraMockData.js";

const COLORS = {
  account: 0xf4f7fa,
  sphere: 0x3b6a96,
  star: 0x9fb4d8,
  queued: 0xffd27d,
  traveler: 0x4fd8ff,
};

const TWO_PI = Math.PI * 2;
const SPHERE_RADIUS = 5.3;

const SPHERE_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uVoiceMix;
  uniform float uVoiceWarm;

  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vRipple;

  void main() {
    // Two overlapping wavefronts read as speech cadence; the orchestrator
    // voice is slower and deeper than the user's.
    float phase = (position.x * 1.7 + position.y * 2.3 + position.z * 1.1) / ${SPHERE_RADIUS.toFixed(1)};
    float ripple = sin(uTime * (6.4 + uVoiceWarm * 1.4) + phase * 3.1) * 0.6
      + sin(uTime * (11.8 - uVoiceWarm * 3.2) + phase * 5.7) * 0.4;
    float envelope = 0.62 + 0.38 * sin(uTime * (2.2 + uVoiceWarm * 0.9));
    float amp = uVoiceMix * envelope * (0.05 + 0.055 * uVoiceWarm);
    vec3 displaced = position * (1.0 + amp * ripple);
    vRipple = ripple * uVoiceMix;

    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vPosW = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SPHERE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uVoiceMix;
  uniform float uVoiceWarm;
  uniform float uAlphaScale;
  uniform vec3 uBaseColor;
  uniform vec3 uUserColor;
  uniform vec3 uWarmColor;

  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vRipple;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float facing = abs(dot(viewDir, normalize(vNormalW)));
    float fresnel = pow(1.0 - facing, 2.7);

    // Faint latitude scan bands drifting upward keep the shell "alive".
    float bands = 0.5 + 0.5 * sin(vPosW.y * 7.0 - uTime * 0.55);

    vec3 voiceColor = mix(uUserColor, uWarmColor, uVoiceWarm);
    vec3 color = mix(uBaseColor, voiceColor, uVoiceMix * 0.85);
    float alpha = fresnel * (0.34 + uVoiceMix * 0.34)
      + bands * 0.014
      + abs(vRipple) * 0.06;
    gl_FragColor = vec4(color * (0.75 + fresnel * 1.7), alpha * uAlphaScale);
  }
`;

function makeGlowTexture(inner, outer) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.35, outer);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function traceRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/* Readable label pill: dark rounded backing, optional status/kind dot,
   optional muted suffix ("· WEB"). Rendered at 2x for crispness. */
function makeLabelPillTexture(text, {
  color = "rgba(232, 240, 252, 0.95)",
  dotColor = "",
  fontSize = 30,
  suffix = "",
  suffixColor = "rgba(150, 172, 210, 0.85)",
} = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const mainFont = `600 ${fontSize}px "SF Pro Text", "Segoe UI", system-ui, sans-serif`;
  const suffixFont = `700 ${Math.round(fontSize * 0.72)}px "SF Pro Text", "Segoe UI", system-ui, sans-serif`;
  ctx.font = mainFont;
  const textWidth = ctx.measureText(text).width;
  ctx.font = suffixFont;
  const suffixWidth = suffix ? ctx.measureText(suffix).width + fontSize * 0.34 : 0;
  const dotSize = dotColor ? fontSize * 0.42 : 0;
  const dotGap = dotColor ? fontSize * 0.34 : 0;
  const padX = fontSize * 0.62;
  const padY = fontSize * 0.4;
  const contentWidth = dotSize + dotGap + textWidth + suffixWidth;
  canvas.width = Math.ceil(contentWidth + padX * 2);
  canvas.height = Math.ceil(fontSize + padY * 2);

  const draw = canvas.getContext("2d");
  const radius = canvas.height / 2;
  traceRoundedRect(draw, 1, 1, canvas.width - 2, canvas.height - 2, radius);
  draw.fillStyle = "rgba(5, 10, 19, 0.78)";
  draw.fill();
  draw.strokeStyle = "rgba(148, 180, 255, 0.22)";
  draw.lineWidth = 1.6;
  draw.stroke();

  let cursorX = padX;
  const midY = canvas.height / 2;
  if (dotColor) {
    draw.beginPath();
    draw.arc(cursorX + dotSize / 2, midY, dotSize / 2, 0, TWO_PI);
    draw.fillStyle = dotColor;
    draw.shadowColor = dotColor;
    draw.shadowBlur = fontSize * 0.3;
    draw.fill();
    draw.shadowBlur = 0;
    cursorX += dotSize + dotGap;
  }
  draw.font = mainFont;
  draw.textBaseline = "middle";
  draw.textAlign = "left";
  draw.fillStyle = color;
  draw.fillText(text, cursorX, midY + fontSize * 0.04);
  cursorX += textWidth;
  if (suffix) {
    draw.font = suffixFont;
    draw.fillStyle = suffixColor;
    draw.fillText(suffix, cursorX + fontSize * 0.34, midY + fontSize * 0.06);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}

function makeLabelSprite(text, { height = 0.3, opacity = 1, ...options } = {}) {
  const { texture, aspect } = makeLabelPillTexture(text, options);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(height * aspect, height, 1);
  return sprite;
}

function makePanelGeometry(kind) {
  switch (kind) {
    case "web":
      return new THREE.TorusGeometry(0.075, 0.026, 10, 32);
    case "pcb":
      return new THREE.BoxGeometry(0.17, 0.028, 0.17);
    case "video":
      return new THREE.ConeGeometry(0.08, 0.15, 16);
    case "docs":
      return new THREE.BoxGeometry(0.13, 0.17, 0.022);
    case "terminal":
    default:
      return new THREE.BoxGeometry(0.115, 0.115, 0.115);
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export class AuraSceneEngine {
  constructor({ container, data, onHoverNode, reducedMotion = false }) {
    this.container = container;
    this.data = data;
    this.onHoverNode = onHoverNode || null;
    this.reducedMotion = reducedMotion;

    this.disposed = false;
    this.paused = false;
    this.rafId = 0;
    this.elapsed = 0;
    this.introT = reducedMotion ? 1 : 0;

    this.pointer = new THREE.Vector2(-10, -10);
    this.pointerActive = false;
    this.dragging = false;
    this.raycaster = new THREE.Raycaster();
    this.hoverables = [];
    this.hovered = null;

    this.voiceMode = "idle";
    this.voiceMix = 0;
    this.voiceWarm = 0;

    // Camera orbit state (hand-rolled so we skip the OrbitControls addon).
    this.orbit = {
      theta: 0.6,
      phi: 1.22,
      radius: 11.2,
      targetTheta: 0.6,
      targetPhi: 1.22,
      targetRadius: 11.2,
    };

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.006);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 240);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();

    this.glowSoft = makeGlowTexture("rgba(255, 255, 255, 0.9)", "rgba(79, 216, 255, 0.35)");
    this.glowEmber = makeGlowTexture("rgba(255, 236, 210, 0.9)", "rgba(255, 154, 60, 0.3)");

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.buildLights();
    this.buildStarfield();
    this.buildContainmentSphere();
    this.buildDust();
    this.buildTree();
    this.buildEdges();
    this.buildTodoParticles();

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.tick = this.tick.bind(this);

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.handlePointerMove);
    el.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handlePointerUp);
    el.addEventListener("pointerleave", this.handlePointerLeave);
    el.addEventListener("wheel", this.handleWheel, { passive: true });
    document.addEventListener("visibilitychange", this.handleVisibilityChange);

    this.resize();
    this.rafId = requestAnimationFrame(this.tick);
  }

  buildLights() {
    this.scene.add(new THREE.AmbientLight(0x8fa8d0, 0.65));
    const coreLight = new THREE.PointLight(0x4fd8ff, 60, 50, 1.7);
    coreLight.position.set(0, 0.4, 0);
    this.scene.add(coreLight);
    const rim = new THREE.DirectionalLight(0xffb277, 0.6);
    rim.position.set(7, 9, -5);
    this.scene.add(rim);
  }

  buildStarfield() {
    const count = 900;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const r = 46 + Math.random() * 70;
      const theta = Math.random() * TWO_PI;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.starfield = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: COLORS.star,
        size: 0.55,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      }),
    );
    this.scene.add(this.starfield);
  }

  /* The containment sphere: a fresnel hologram shader (rim glow, drifting
     scan bands, GPU voice ripple) + a matching displaced wireframe + one
     equatorial ring. Voice reactivity is pure uniforms — zero CPU work. */
  buildContainmentSphere() {
    const makeUniforms = (alphaScale) => ({
      uTime: { value: 0 },
      uVoiceMix: { value: 0 },
      uVoiceWarm: { value: 0 },
      uAlphaScale: { value: alphaScale },
      uBaseColor: { value: new THREE.Color(COLORS.sphere) },
      uUserColor: { value: new THREE.Color(0x4fd8ff) },
      uWarmColor: { value: new THREE.Color(0xff9a3c) },
    });

    const shellMaterial = new THREE.ShaderMaterial({
      uniforms: makeUniforms(1),
      vertexShader: SPHERE_VERTEX_SHADER,
      fragmentShader: SPHERE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(SPHERE_RADIUS, 56, 40),
      shellMaterial,
    );
    this.root.add(shell);

    const skinMaterial = new THREE.ShaderMaterial({
      uniforms: makeUniforms(0.16),
      vertexShader: SPHERE_VERTEX_SHADER,
      fragmentShader: SPHERE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      wireframe: true,
      blending: THREE.AdditiveBlending,
    });
    this.sphereSkin = new THREE.Mesh(
      new THREE.IcosahedronGeometry(SPHERE_RADIUS, 3),
      skinMaterial,
    );
    this.root.add(this.sphereSkin);

    this.sphereMaterials = [shellMaterial, skinMaterial];

    this.equatorBaseColor = new THREE.Color(0x4fd8ff);
    this.sphereWarmColor = new THREE.Color(0xff9a3c);
    this.equator = new THREE.Mesh(
      new THREE.TorusGeometry(SPHERE_RADIUS, 0.012, 10, 240),
      new THREE.MeshBasicMaterial({
        color: 0x4fd8ff,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.equator.rotation.x = Math.PI / 2 - 0.04;
    this.root.add(this.equator);
  }

  /* Slow drifting dust inside the sphere — depth cue, nearly free. */
  buildDust() {
    const count = 240;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const r = Math.cbrt(Math.random()) * (SPHERE_RADIUS - 0.4);
      const theta = Math.random() * TWO_PI;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0x9fd4ff,
        size: 0.035,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.root.add(this.dust);
  }

  /* Radial tree, all inside the sphere:
     account (origin) → devices (r≈2.1) → workspaces (+1.35) → panels (+0.95).
     Fan angles are index-derived so siblings never overlap. */
  buildTree() {
    this.deviceNodes = [];
    this.workspaceNodes = [];
    this.panelNodes = [];
    this.scriptNodes = [];

    // Account core
    const account = this.data.account || { name: "Account" };
    const accountMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 24, 24),
      new THREE.MeshStandardMaterial({
        color: 0x101722,
        emissive: new THREE.Color(COLORS.account),
        emissiveIntensity: 1.1,
        metalness: 0.3,
        roughness: 0.3,
      }),
    );
    accountMesh.userData = {
      kind: "account",
      label: account.name || "Account",
      detail: `${(this.data.devices || []).length} devices`,
      baseScale: 1,
    };
    this.root.add(accountMesh);
    this.accountMesh = accountMesh;
    this.hoverables.push(accountMesh);

    const accountGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowSoft,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    accountGlow.scale.set(1.5, 1.5, 1);
    this.root.add(accountGlow);
    this.accountGlow = accountGlow;

    const accountLabel = makeLabelSprite(account.name || "Account", {
      dotColor: "#f4f7fa",
      fontSize: 34,
      height: 0.26,
    });
    accountLabel.position.set(0, 0.48, 0);
    this.root.add(accountLabel);

    const devices = this.data.devices || [];
    devices.forEach((device, deviceIndex) => {
      const isLocal = device.kind === "local";
      const angle = (deviceIndex / Math.max(devices.length, 1)) * TWO_PI + 0.8;
      const yTilt = (deviceIndex % 2 === 0 ? 1 : -1) * 0.16;
      const outward = new THREE.Vector3(
        Math.cos(angle) * Math.cos(yTilt),
        Math.sin(yTilt),
        Math.sin(angle) * Math.cos(yTilt),
      ).normalize();
      const side = new THREE.Vector3(-outward.z, 0, outward.x).normalize();
      const position = outward.clone().multiplyScalar(2.1);

      const group = new THREE.Group();
      group.position.copy(position);
      this.root.add(group);

      const kindColorHex = AURA_DEVICE_KIND_COLORS[device.kind] || "#4fd8ff";
      const kindColor = new THREE.Color(kindColorHex);
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(isLocal ? 0.21 : 0.17, 1),
        new THREE.MeshStandardMaterial({
          color: 0x0b1220,
          emissive: kindColor,
          emissiveIntensity: device.status === "standby" ? 0.35 : 0.95,
          metalness: 0.25,
          roughness: 0.35,
        }),
      );
      const workspaceCount = (device.workspaces || []).length;
      const panelCount = (device.workspaces || []).reduce(
        (sum, ws) => sum + (ws.panels || []).length,
        0,
      );
      mesh.userData = {
        kind: "device",
        label: device.name,
        detail: `${AURA_DEVICE_KIND_LABELS[device.kind] || device.kind} · ${AURA_STATE_LABELS[device.status] || device.status} · ${workspaceCount} ws · ${panelCount} panels`,
        baseScale: 1,
      };
      group.add(mesh);
      this.hoverables.push(mesh);

      const wire = new THREE.Mesh(
        new THREE.IcosahedronGeometry(isLocal ? 0.3 : 0.25, 1),
        new THREE.MeshBasicMaterial({
          color: kindColor,
          wireframe: true,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        }),
      );
      group.add(wire);

      const label = makeLabelSprite(device.name, {
        dotColor: kindColorHex,
        fontSize: 32,
        height: 0.28,
        suffix: `· ${(AURA_DEVICE_KIND_LABELS[device.kind] || device.kind).toUpperCase()}`,
      });
      label.position.set(0, 0.56, 0);
      group.add(label);

      const deviceNode = {
        device,
        group,
        mesh,
        wire,
        kindColor,
        basePosition: position.clone(),
        bobPhase: deviceIndex * 2.1,
        workspaces: [],
      };
      this.deviceNodes.push(deviceNode);

      // Workspaces fan outward from the device.
      const workspaces = device.workspaces || [];
      const wsSpread = Math.min(1.5, 0.75 * Math.max(workspaces.length - 1, 1));
      workspaces.forEach((workspace, wsIndex) => {
        const t = workspaces.length > 1 ? wsIndex / (workspaces.length - 1) - 0.5 : 0;
        const wsDir = outward.clone().addScaledVector(side, t * wsSpread).normalize();
        const wsAnchor = position.clone()
          .addScaledVector(wsDir, 1.35)
          .add(new THREE.Vector3(0, (wsIndex % 2 === 0 ? 0.24 : -0.22), 0));

        const state = auraWorkspaceState(workspace);
        const stateColorHex = AURA_STATE_COLORS[state] || AURA_STATE_COLORS.idle;
        const stateColor = new THREE.Color(stateColorHex);

        const wsGroup = new THREE.Group();
        wsGroup.position.copy(wsAnchor);
        this.root.add(wsGroup);

        const wsCore = new THREE.Mesh(
          new THREE.SphereGeometry(0.105, 18, 18),
          new THREE.MeshStandardMaterial({
            color: 0x060a12,
            emissive: stateColor,
            emissiveIntensity: state === "running" ? 1.4 : state === "attention" ? 1.6 : 0.7,
            metalness: 0.15,
            roughness: 0.4,
          }),
        );
        wsCore.userData = {
          kind: "workspace",
          label: workspace.name,
          detail: `${AURA_STATE_LABELS[state]} · ${(workspace.panels || []).length} panels · ${workspace.todos?.running || 0} running · ${workspace.todos?.queued || 0} queued`,
          baseScale: 1,
        };
        wsGroup.add(wsCore);
        this.hoverables.push(wsCore);

        const wsRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.17, 0.008, 8, 40),
          new THREE.MeshBasicMaterial({
            color: stateColor,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        wsRing.rotation.x = Math.PI / 2;
        wsGroup.add(wsRing);

        const wsLabel = makeLabelSprite(workspace.name, {
          dotColor: stateColorHex,
          fontSize: 30,
          height: 0.22,
        });
        wsLabel.position.set(0, 0.4, 0);
        wsGroup.add(wsLabel);

        const workspaceNode = {
          workspace,
          state,
          group: wsGroup,
          core: wsCore,
          ring: wsRing,
          anchor: wsAnchor.clone(),
          stateColor,
          parent: deviceNode,
          bobPhase: wsIndex * 1.7 + deviceIndex,
          panels: [],
        };
        deviceNode.workspaces.push(workspaceNode);
        this.workspaceNodes.push(workspaceNode);

        // Panels fan further outward from the workspace, shape-coded by kind.
        const panels = workspace.panels || [];
        const panelSpread = Math.min(1.3, 0.6 * Math.max(panels.length - 1, 1));
        panels.forEach((panel, panelIndex) => {
          const pt = panels.length > 1 ? panelIndex / (panels.length - 1) - 0.5 : 0;
          const panelDir = wsAnchor.clone().sub(position).normalize()
            .addScaledVector(side, pt * panelSpread)
            .normalize();
          const panelAnchor = wsAnchor.clone()
            .addScaledVector(panelDir, 0.95)
            .add(new THREE.Vector3(0, (panelIndex % 2 === 0 ? 0.16 : -0.15), 0));

          const kindMeta = AURA_PANEL_KIND_META[panel.kind] || AURA_PANEL_KIND_META.terminal;
          const kindColorPanel = new THREE.Color(kindMeta.color);
          const stateEmissive = new THREE.Color(
            AURA_STATE_COLORS[panel.state] || AURA_STATE_COLORS.idle,
          );

          const panelMesh = new THREE.Mesh(
            makePanelGeometry(panel.kind),
            new THREE.MeshStandardMaterial({
              color: 0x060a12,
              emissive: stateEmissive,
              emissiveIntensity: panel.state === "running" ? 1.4 : 0.75,
              metalness: 0.15,
              roughness: 0.4,
            }),
          );
          panelMesh.position.copy(panelAnchor);
          panelMesh.userData = {
            kind: "panel",
            label: `${workspace.name} / ${panel.name}`,
            detail: `${kindMeta.label} panel · ${AURA_STATE_LABELS[panel.state] || panel.state}`,
            baseScale: 1,
          };
          this.root.add(panelMesh);
          this.hoverables.push(panelMesh);

          // Kind trim: a thin wire outline in the panel-type color.
          const trim = new THREE.Mesh(
            makePanelGeometry(panel.kind),
            new THREE.MeshBasicMaterial({
              color: kindColorPanel,
              wireframe: true,
              transparent: true,
              opacity: 0.45,
              depthWrite: false,
            }),
          );
          trim.scale.setScalar(1.28);
          panelMesh.add(trim);

          const panelLabel = makeLabelSprite(panel.name, {
            dotColor: kindMeta.color,
            fontSize: 26,
            height: 0.15,
            opacity: 0.94,
            suffix: `· ${kindMeta.label.toUpperCase()}`,
          });
          panelLabel.position.copy(panelAnchor).add(new THREE.Vector3(0, 0.24, 0));
          this.root.add(panelLabel);

          const panelNode = {
            panel,
            state: panel.state,
            kindColor: kindColorPanel,
            mesh: panelMesh,
            label: panelLabel,
            anchor: panelAnchor.clone(),
            parent: workspaceNode,
            wobblePhase: panelIndex * 2.3 + wsIndex + deviceIndex,
            blinkPhase: panelIndex * 1.3,
          };
          workspaceNode.panels.push(panelNode);
          this.panelNodes.push(panelNode);
        });
      });

      // Scripts orbit the device (local device carries them today).
      const scripts = device.scripts || [];
      if (scripts.length) {
        const scriptRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.62, 0.0035, 8, 120),
          new THREE.MeshBasicMaterial({
            color: kindColor,
            transparent: true,
            opacity: 0.2,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        scriptRing.rotation.x = Math.PI / 2 - 0.4;
        group.add(scriptRing);

        scripts.forEach((script, scriptIndex) => {
          const scriptColorHex = AURA_STATE_COLORS[script.state] || AURA_STATE_COLORS.idle;
          const scriptColor = new THREE.Color(scriptColorHex);
          const holder = new THREE.Group();
          group.add(holder);
          const scriptMesh = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.062),
            new THREE.MeshStandardMaterial({
              color: 0x0a0f1a,
              emissive: scriptColor,
              emissiveIntensity: script.state === "running" ? 1.5 : 0.85,
              metalness: 0.2,
              roughness: 0.4,
            }),
          );
          scriptMesh.userData = {
            kind: "script",
            label: `${device.name} · ${script.name}`,
            detail: `Script · ${AURA_STATE_LABELS[script.state] || script.state}`,
            baseScale: 1,
          };
          holder.add(scriptMesh);
          this.hoverables.push(scriptMesh);

          const scriptLabel = makeLabelSprite(script.name, {
            dotColor: scriptColorHex,
            fontSize: 24,
            height: 0.12,
            opacity: 0.92,
          });
          scriptLabel.position.set(0, 0.17, 0);
          holder.add(scriptLabel);

          this.scriptNodes.push({
            script,
            holder,
            mesh: scriptMesh,
            parent: deviceNode,
            orbitRadius: 0.62,
            orbitTilt: -0.4,
            phase: (scriptIndex / scripts.length) * TWO_PI,
            speed: 0.28,
            blinkPhase: scriptIndex * 1.9,
          });
        });
      }
    });
  }

  /* One vertex-colored line buffer: account→device (device kind color),
     device→workspace (workspace state color), workspace→panel (panel kind
     color). Edge colors reinforce what each level means. */
  buildEdges() {
    this.scratchA = new THREE.Vector3();
    this.scratchB = new THREE.Vector3();
    this.edgeSegments = [];

    this.deviceNodes.forEach((deviceNode) => {
      this.edgeSegments.push({
        from: () => this.accountMesh.getWorldPosition(this.scratchA),
        to: () => deviceNode.group.getWorldPosition(this.scratchB),
        color: deviceNode.kindColor,
      });
      deviceNode.workspaces.forEach((wsNode) => {
        this.edgeSegments.push({
          from: () => deviceNode.group.getWorldPosition(this.scratchA),
          to: () => wsNode.group.getWorldPosition(this.scratchB),
          color: wsNode.stateColor,
        });
        wsNode.panels.forEach((panelNode) => {
          this.edgeSegments.push({
            from: () => wsNode.group.getWorldPosition(this.scratchA),
            to: () => panelNode.mesh.getWorldPosition(this.scratchB),
            color: panelNode.kindColor,
          });
        });
      });
    });

    const vertexCount = this.edgeSegments.length * 2;
    this.edgePositions = new Float32Array(vertexCount * 3);
    const edgeColors = new Float32Array(vertexCount * 3);
    this.edgeSegments.forEach((segment, index) => {
      const color = segment.color;
      for (let v = 0; v < 2; v += 1) {
        const offset = (index * 2 + v) * 3;
        edgeColors[offset] = color.r;
        edgeColors[offset + 1] = color.g;
        edgeColors[offset + 2] = color.b;
      }
    });

    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.BufferAttribute(this.edgePositions, 3));
    edgeGeometry.setAttribute("color", new THREE.BufferAttribute(edgeColors, 3));
    this.edgeLines = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.root.add(this.edgeLines);
  }

  /* Running todos travel workspace→terminal-panel; queued todos idle in a
     tight orbit around their workspace. */
  buildTodoParticles() {
    this.todoTravelers = [];
    this.todoQueued = [];

    this.workspaceNodes.forEach((wsNode, wsIndex) => {
      const todos = wsNode.workspace.todos || {};
      const terminalPanels = wsNode.panels.filter((panelNode) => panelNode.panel.kind === "terminal");

      for (let i = 0; i < Math.min(todos.running || 0, 3); i += 1) {
        if (!terminalPanels.length) break;
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.glowSoft,
            color: new THREE.Color(COLORS.traveler),
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        sprite.scale.set(0.13, 0.13, 1);
        this.root.add(sprite);
        this.todoTravelers.push({
          sprite,
          node: wsNode,
          targets: terminalPanels,
          target: terminalPanels[(i + wsIndex) % terminalPanels.length],
          t: (i * 0.37 + wsIndex * 0.21) % 1,
          speed: 0.24 + (i % 3) * 0.07,
        });
      }

      for (let i = 0; i < Math.min(todos.queued || 0, 4); i += 1) {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.glowEmber,
            color: new THREE.Color(COLORS.queued),
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        sprite.scale.set(0.08, 0.08, 1);
        this.root.add(sprite);
        this.todoQueued.push({
          sprite,
          node: wsNode,
          radius: 0.26 + i * 0.045,
          speed: 0.5 + i * 0.12,
          phase: i * 1.9 + wsIndex,
        });
      }
    });
  }

  handlePointerMove(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pointerActive = true;
    if (this.dragging) {
      this.orbit.targetTheta -= event.movementX * 0.0045;
      this.orbit.targetPhi = THREE.MathUtils.clamp(
        this.orbit.targetPhi - event.movementY * 0.0038,
        0.45,
        Math.PI - 0.7,
      );
    }
  }

  handlePointerDown(event) {
    if (event.button === 0) {
      this.dragging = true;
    }
  }

  handlePointerUp() {
    this.dragging = false;
  }

  handlePointerLeave() {
    this.pointerActive = false;
    this.dragging = false;
    this.setHovered(null);
  }

  handleWheel(event) {
    this.orbit.targetRadius = THREE.MathUtils.clamp(
      this.orbit.targetRadius + event.deltaY * 0.008,
      7.2,
      16.5,
    );
  }

  /* Aura renders nothing while the window/tab is hidden. */
  handleVisibilityChange() {
    if (this.disposed) return;
    if (document.hidden) {
      this.paused = true;
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      return;
    }
    if (this.paused) {
      this.paused = false;
      this.clock.getDelta();
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  /* Voice wiring seam: "idle" | "user" (user speaking) | "orchestrator"
     (voice orchestrator responding). The live pipeline can also call this
     at speech start/stop; intensity is synthesized in the sphere shader. */
  setVoiceActivity(mode) {
    this.voiceMode = mode === "user" || mode === "orchestrator" ? mode : "idle";
  }

  updateVoiceSurface(dt) {
    const targetMix = this.voiceMode === "idle" ? 0 : 1;
    const targetWarm = this.voiceMode === "orchestrator" ? 1 : 0;
    const ease = Math.min(1, dt * 3.2);
    this.voiceMix += (targetMix - this.voiceMix) * ease;
    this.voiceWarm += (targetWarm - this.voiceWarm) * ease;

    this.sphereMaterials.forEach((material) => {
      material.uniforms.uTime.value = this.elapsed;
      material.uniforms.uVoiceMix.value = this.voiceMix;
      material.uniforms.uVoiceWarm.value = this.voiceWarm;
    });

    this.equator.material.color.copy(this.equatorBaseColor)
      .lerp(this.sphereWarmColor, this.voiceMix * this.voiceWarm);
    this.equator.material.opacity = 0.2
      + this.voiceMix * (0.16 + 0.1 * Math.sin(this.elapsed * 5.4));
  }

  setHovered(mesh) {
    if (this.hovered === mesh) return;
    this.hovered = mesh;
    this.renderer.domElement.style.cursor = mesh ? "pointer" : "";
    if (this.onHoverNode) {
      this.onHoverNode(mesh ? { ...mesh.userData } : null);
    }
  }

  updateHover() {
    if (!this.pointerActive || this.dragging) {
      if (this.dragging) this.setHovered(null);
      return;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hoverables, false);
    this.setHovered(hits.length ? hits[0].object : null);
  }

  updateCamera(dt) {
    const orbit = this.orbit;
    if (!this.dragging && !this.reducedMotion) {
      orbit.targetTheta += dt * 0.038;
    }
    const ease = 1 - Math.pow(0.001, dt);
    orbit.theta += (orbit.targetTheta - orbit.theta) * ease;
    orbit.phi += (orbit.targetPhi - orbit.phi) * ease;
    orbit.radius += (orbit.targetRadius - orbit.radius) * ease;

    const introRadius = orbit.radius + (1 - easeOutCubic(this.introT)) * 3.6;
    this.camera.position.set(
      introRadius * Math.sin(orbit.phi) * Math.cos(orbit.theta),
      introRadius * Math.cos(orbit.phi),
      introRadius * Math.sin(orbit.phi) * Math.sin(orbit.theta),
    );
    this.camera.lookAt(0, 0, 0);
  }

  tick() {
    if (this.disposed || this.paused) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const motion = this.reducedMotion ? 0 : dt;
    this.elapsed += motion;
    if (this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / 1.5);
    }

    const introScale = 0.84 + 0.16 * easeOutCubic(this.introT);
    this.root.scale.setScalar(introScale);

    // Sphere + account motion (surface reaction is uniform-driven).
    this.sphereSkin.rotation.y += motion * 0.008;
    this.equator.rotation.z += motion * 0.05;
    this.dust.rotation.y += motion * 0.012;
    this.starfield.rotation.y += motion * 0.004;
    this.accountMesh.rotation.y += motion * 0.3;
    const pulse = 1 + Math.sin(this.elapsed * 1.5) * 0.08;
    this.accountGlow.scale.set(1.5 * pulse, 1.5 * pulse, 1);
    this.updateVoiceSurface(dt);

    // Devices breathe gently.
    this.deviceNodes.forEach((deviceNode) => {
      const bob = Math.sin(this.elapsed * 0.4 + deviceNode.bobPhase) * 0.05;
      deviceNode.group.position.set(
        deviceNode.basePosition.x,
        deviceNode.basePosition.y + bob,
        deviceNode.basePosition.z,
      );
      deviceNode.wire.rotation.y += motion * 0.25;
      deviceNode.mesh.rotation.y += motion * 0.3;
    });

    // Workspaces bob on their anchors; state pulses.
    this.workspaceNodes.forEach((wsNode) => {
      const bob = Math.sin(this.elapsed * 0.55 + wsNode.bobPhase) * 0.04;
      wsNode.group.position.set(wsNode.anchor.x, wsNode.anchor.y + bob, wsNode.anchor.z);
      wsNode.ring.rotation.z += motion * 0.5;
      const material = wsNode.core.material;
      if (wsNode.state === "running") {
        material.emissiveIntensity = 1.2 + Math.sin(this.elapsed * 3 + wsNode.bobPhase) * 0.4;
      } else if (wsNode.state === "attention") {
        material.emissiveIntensity = Math.sin(this.elapsed * 6 + wsNode.bobPhase) > 0 ? 1.8 : 0.4;
      }
    });

    // Panels wobble subtly; blink by state; spin slowly for shape read.
    const wobble = new THREE.Vector3();
    this.panelNodes.forEach((panelNode) => {
      const angle = this.elapsed * 0.7 + panelNode.wobblePhase;
      wobble.set(Math.cos(angle) * 0.035, Math.sin(angle * 1.3) * 0.035, Math.sin(angle) * 0.035);
      panelNode.mesh.position.copy(panelNode.anchor).add(wobble);
      panelNode.mesh.rotation.y += motion * 0.4;
      panelNode.label.position.copy(panelNode.mesh.position).add(new THREE.Vector3(0, 0.24, 0));
      const material = panelNode.mesh.material;
      if (panelNode.state === "running") {
        material.emissiveIntensity = 1.25 + Math.sin(this.elapsed * 3.2 + panelNode.blinkPhase) * 0.45;
      } else if (panelNode.state === "attention") {
        material.emissiveIntensity = Math.sin(this.elapsed * 6 + panelNode.blinkPhase) > 0 ? 1.7 : 0.35;
      }
    });

    // Scripts orbit the device; running pulses, failed blinks.
    this.scriptNodes.forEach((scriptNode) => {
      const angle = scriptNode.phase + this.elapsed * scriptNode.speed;
      const x = Math.cos(angle) * scriptNode.orbitRadius;
      const z = Math.sin(angle) * scriptNode.orbitRadius;
      const y = Math.sin(angle) * Math.sin(scriptNode.orbitTilt) * scriptNode.orbitRadius * 0.5;
      scriptNode.holder.position.set(x, y, z);
      scriptNode.mesh.rotation.y += motion * 0.8;
      const material = scriptNode.mesh.material;
      if (scriptNode.script.state === "running") {
        material.emissiveIntensity = 1.3 + Math.sin(this.elapsed * 3.4 + scriptNode.blinkPhase) * 0.5;
      } else if (scriptNode.script.state === "failed") {
        material.emissiveIntensity = Math.sin(this.elapsed * 5 + scriptNode.blinkPhase) > 0 ? 1.6 : 0.5;
      }
    });

    // Edge buffer follows every moving anchor.
    this.edgeSegments.forEach((segment, index) => {
      const from = segment.from();
      const offset = index * 6;
      this.edgePositions[offset] = from.x;
      this.edgePositions[offset + 1] = from.y;
      this.edgePositions[offset + 2] = from.z;
      const to = segment.to();
      this.edgePositions[offset + 3] = to.x;
      this.edgePositions[offset + 4] = to.y;
      this.edgePositions[offset + 5] = to.z;
    });
    this.edgeLines.geometry.attributes.position.needsUpdate = true;

    // Todo particles
    const curveScratch = new THREE.Vector3();
    this.todoTravelers.forEach((traveler) => {
      traveler.t += motion * traveler.speed;
      if (traveler.t >= 1) {
        traveler.t = 0;
        traveler.target = traveler.targets[Math.floor(this.elapsed * 7) % traveler.targets.length];
      }
      const from = traveler.node.group.position;
      const to = traveler.target.mesh.position;
      curveScratch.lerpVectors(from, to, traveler.t);
      curveScratch.y += Math.sin(traveler.t * Math.PI) * 0.14;
      traveler.sprite.position.copy(curveScratch);
      traveler.sprite.material.opacity = 0.25 + Math.sin(traveler.t * Math.PI) * 0.6;
    });

    this.todoQueued.forEach((dot) => {
      const angle = dot.phase + this.elapsed * dot.speed;
      dot.sprite.position.set(
        dot.node.group.position.x + Math.cos(angle) * dot.radius,
        dot.node.group.position.y + Math.sin(angle * 0.7) * 0.05,
        dot.node.group.position.z + Math.sin(angle) * dot.radius,
      );
    });

    // Hover scaling
    this.hoverables.forEach((mesh) => {
      const target = mesh === this.hovered ? 1.45 : 1;
      const current = mesh.scale.x;
      const next = current + (target - current) * Math.min(1, dt * 10);
      mesh.scale.setScalar(next);
    });

    this.updateHover();
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.tick);
  }

  resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);

    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.handlePointerMove);
    el.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointerup", this.handlePointerUp);
    el.removeEventListener("pointerleave", this.handlePointerLeave);
    el.removeEventListener("wheel", this.handleWheel);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);

    this.scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!material) return;
        if (material.map) material.map.dispose();
        material.dispose();
      });
    });
    this.glowSoft.dispose();
    this.glowEmber.dispose();
    this.renderer.dispose();
    // Release the WebGL context immediately instead of waiting for GC — the
    // desktop app juggles many xterm WebGL contexts, so a closed Aura must
    // not hold one.
    try {
      this.renderer.forceContextLoss();
    } catch {
      /* context may already be lost */
    }
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}

export default AuraSceneEngine;
