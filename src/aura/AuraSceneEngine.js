// Aura Mode 3D scene — vanilla three.js engine (no react-three-fiber).
// UI-only: renders the mock fleet (auraMockData.js) as a device-centric
// constellation. Each device is a node inside a transparent sphere; its
// workspaces branch outward from the device, terminals branch off each
// workspace (deterministic fan layout — no overlap), and the local device
// carries a labeled script ring. Node colors follow state; each workspace
// branch keeps a unique hue. The React shell (AuraMode.jsx) owns the HUD.

import * as THREE from "three";

import {
  AURA_BRANCH_HUES,
  AURA_DEVICE_KIND_COLORS,
  AURA_DEVICE_KIND_LABELS,
  AURA_STATE_COLORS,
  AURA_STATE_LABELS,
  auraWorkspaceState,
} from "./auraMockData.js";

const COLORS = {
  coreCyan: 0x4fd8ff,
  coreEmber: 0xff9a3c,
  containment: 0x274a66,
  star: 0x9fb4d8,
  doc: 0xffd27d,
  mcp: 0xb48cff,
  queued: 0xffd27d,
  spoke: 0x3a5a7d,
};

const TWO_PI = Math.PI * 2;

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

function makeLabelTexture(text, { color = "rgba(226, 236, 255, 0.92)", fontSize = 46 } = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `500 ${fontSize}px "SF Pro Text", "Segoe UI", system-ui, sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const padX = 26;
  canvas.width = Math.ceil(metrics.width + padX * 2);
  canvas.height = Math.ceil(fontSize * 1.9);
  const draw = canvas.getContext("2d");
  draw.font = font;
  draw.textAlign = "center";
  draw.textBaseline = "middle";
  draw.shadowColor = "rgba(2, 6, 14, 0.9)";
  draw.shadowBlur = 10;
  draw.fillStyle = color;
  draw.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}

function makeLabelSprite(text, { color, fontSize, height = 0.34, opacity = 1 } = {}) {
  const { texture, aspect } = makeLabelTexture(text, { color, fontSize });
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
    this.rafId = 0;
    this.elapsed = 0;
    this.introT = reducedMotion ? 1 : 0;

    this.pointer = new THREE.Vector2(-10, -10);
    this.pointerActive = false;
    this.dragging = false;
    this.raycaster = new THREE.Raycaster();
    this.hoverables = [];
    this.hovered = null;

    // Camera orbit state (hand-rolled so we skip the OrbitControls addon).
    this.orbit = {
      theta: 0.6,
      phi: 1.16,
      radius: 13.4,
      targetTheta: 0.6,
      targetPhi: 1.16,
      targetRadius: 13.4,
    };

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.007);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 260);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
    this.buildCore();
    this.buildDeviceTrees();
    this.buildEdges();
    this.buildOuterRing({
      items: this.data.docs,
      radius: 7.6,
      tilt: new THREE.Euler(0.4, 0, 0.08),
      color: COLORS.doc,
      kind: "doc",
      kindLabel: "Doc",
      makeNodeGeometry: () => new THREE.OctahedronGeometry(0.14),
      key: "docsRing",
      speed: 0.05,
    });
    this.buildOuterRing({
      items: this.data.mcps,
      radius: 8.4,
      tilt: new THREE.Euler(-0.48, 0, -0.2),
      color: COLORS.mcp,
      kind: "mcp",
      kindLabel: "MCP",
      makeNodeGeometry: () => new THREE.BoxGeometry(0.16, 0.16, 0.16),
      key: "mcpRing",
      speed: -0.038,
    });
    this.buildTodoParticles();

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.tick = this.tick.bind(this);

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.handlePointerMove);
    el.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handlePointerUp);
    el.addEventListener("pointerleave", this.handlePointerLeave);
    el.addEventListener("wheel", this.handleWheel, { passive: true });

    this.resize();
    this.rafId = requestAnimationFrame(this.tick);
  }

  buildLights() {
    this.scene.add(new THREE.AmbientLight(0x8fa8d0, 0.6));
    const coreLight = new THREE.PointLight(COLORS.coreCyan, 70, 60, 1.7);
    coreLight.position.set(0, 0.6, 0);
    this.scene.add(coreLight);
    const rim = new THREE.DirectionalLight(0xffb277, 0.7);
    rim.position.set(7, 9, -5);
    this.scene.add(rim);
  }

  buildStarfield() {
    const count = 1400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const r = 50 + Math.random() * 70;
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
        size: 0.6,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    this.scene.add(this.starfield);
  }

  /* The orchestrator heart: compact ring pair + halo at the origin. Devices
     arrange around it and connect back with faint spokes. */
  buildCore() {
    this.coreGroup = new THREE.Group();
    this.root.add(this.coreGroup);

    const ringA = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.013, 12, 220),
      new THREE.MeshBasicMaterial({
        color: COLORS.coreCyan,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ringA.rotation.x = Math.PI / 2 - 0.05;
    this.coreGroup.add(ringA);
    this.ringA = ringA;

    const ringB = new THREE.Mesh(
      new THREE.TorusGeometry(1.78, 0.009, 12, 220),
      new THREE.MeshBasicMaterial({
        color: COLORS.coreEmber,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ringB.rotation.x = Math.PI / 2 + 0.22;
    ringB.rotation.y = 0.14;
    this.coreGroup.add(ringB);
    this.ringB = ringB;

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 1),
      new THREE.MeshStandardMaterial({
        color: 0x0b1220,
        emissive: new THREE.Color(COLORS.coreCyan),
        emissiveIntensity: 0.9,
        metalness: 0.3,
        roughness: 0.35,
      }),
    );
    core.userData = {
      kind: "core",
      label: "Orchestrator",
      detail: "Fleet heart",
      baseScale: 1,
    };
    this.coreGroup.add(core);
    this.coreMesh = core;
    this.hoverables.push(core);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowSoft,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.set(3.6, 3.6, 1);
    this.coreGroup.add(halo);
    this.halo = halo;
  }

  /* Deterministic fan layout: device i sits on a ring around the core; its
     workspaces fan outward (away from the core) around the device, and each
     workspace's terminals fan further out around the workspace. Branch
     angles are index-derived so siblings never overlap. */
  buildDeviceTrees() {
    this.deviceNodes = [];
    this.workspaceNodes = [];
    this.terminalNodes = [];
    this.scriptNodes = [];

    const devices = this.data.devices || [];
    const deviceRadius = 4.7;
    let branchHueCursor = 0;

    devices.forEach((device, deviceIndex) => {
      const isLocal = device.kind === "local";
      const angle = (deviceIndex / Math.max(devices.length, 1)) * TWO_PI + 0.85;
      const position = new THREE.Vector3(
        Math.cos(angle) * deviceRadius,
        (deviceIndex % 2 === 0 ? 1 : -1) * 0.5,
        Math.sin(angle) * deviceRadius,
      );
      const outward = position.clone().setY(0).normalize();
      const side = new THREE.Vector3(-outward.z, 0, outward.x);

      const group = new THREE.Group();
      group.position.copy(position);
      this.root.add(group);

      const kindColor = new THREE.Color(AURA_DEVICE_KIND_COLORS[device.kind] || "#4fd8ff");
      const sphereRadius = isLocal ? 1.28 : 1.02;

      // Transparent containment sphere: soft inner shell + wireframe skin.
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(sphereRadius, 32, 24),
        new THREE.MeshBasicMaterial({
          color: kindColor,
          transparent: true,
          opacity: 0.05,
          side: THREE.BackSide,
          depthWrite: false,
        }),
      );
      group.add(shell);
      const skin = new THREE.Mesh(
        new THREE.IcosahedronGeometry(sphereRadius, 2),
        new THREE.MeshBasicMaterial({
          color: kindColor,
          wireframe: true,
          transparent: true,
          opacity: device.status === "standby" ? 0.06 : 0.11,
          depthWrite: false,
        }),
      );
      group.add(skin);

      // Device node inside the sphere.
      const nodeMesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(isLocal ? 0.24 : 0.19, 1),
        new THREE.MeshStandardMaterial({
          color: 0x0b1220,
          emissive: kindColor,
          emissiveIntensity: device.status === "standby" ? 0.35 : 0.95,
          metalness: 0.25,
          roughness: 0.35,
        }),
      );
      const workspaceCount = (device.workspaces || []).length;
      const terminalCount = (device.workspaces || []).reduce(
        (sum, ws) => sum + (ws.terminals || []).length,
        0,
      );
      nodeMesh.userData = {
        kind: "device",
        label: device.name,
        detail: `${AURA_DEVICE_KIND_LABELS[device.kind] || device.kind} · ${AURA_STATE_LABELS[device.status] || device.status} · ${workspaceCount} ws · ${terminalCount} term`,
        baseScale: 1,
      };
      group.add(nodeMesh);
      this.hoverables.push(nodeMesh);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowSoft,
          color: kindColor,
          transparent: true,
          opacity: device.status === "standby" ? 0.16 : 0.34,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glow.scale.set(1.7, 1.7, 1);
      group.add(glow);

      const label = makeLabelSprite(device.name, { fontSize: 46, height: 0.32 });
      label.position.set(0, sphereRadius + 0.42, 0);
      group.add(label);
      const kindTag = makeLabelSprite(
        (AURA_DEVICE_KIND_LABELS[device.kind] || device.kind).toUpperCase(),
        { fontSize: 30, height: 0.16, color: "rgba(160, 186, 224, 0.72)" },
      );
      kindTag.position.set(0, sphereRadius + 0.2, 0);
      group.add(kindTag);

      const deviceNode = {
        device,
        group,
        mesh: nodeMesh,
        skin,
        basePosition: position.clone(),
        bobPhase: deviceIndex * 2.1,
        isLocal,
        sphereRadius,
        workspaces: [],
      };
      this.deviceNodes.push(deviceNode);

      // Workspaces: fan outward from the device sphere.
      const workspaces = device.workspaces || [];
      const wsSpread = Math.min(1.9, 0.85 * Math.max(workspaces.length - 1, 1));
      workspaces.forEach((workspace, wsIndex) => {
        const hue = AURA_BRANCH_HUES[branchHueCursor % AURA_BRANCH_HUES.length];
        branchHueCursor += 1;
        const branchColor = new THREE.Color(hue);
        const state = auraWorkspaceState(workspace);
        const stateColor = new THREE.Color(AURA_STATE_COLORS[state] || AURA_STATE_COLORS.idle);

        const t = workspaces.length > 1 ? wsIndex / (workspaces.length - 1) - 0.5 : 0;
        const wsDir = outward.clone()
          .addScaledVector(side, t * wsSpread)
          .normalize();
        const wsOffset = wsDir.multiplyScalar(sphereRadius + 1.05);
        wsOffset.y += (wsIndex % 2 === 0 ? 0.34 : -0.3);
        const wsAnchor = position.clone().add(wsOffset);

        const wsGroup = new THREE.Group();
        wsGroup.position.copy(wsAnchor);
        this.root.add(wsGroup);

        // Unique branch hue on the wireframe shell; state color at the core.
        const wsWire = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.2, 1),
          new THREE.MeshBasicMaterial({
            color: branchColor,
            wireframe: true,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
          }),
        );
        wsGroup.add(wsWire);
        const wsCore = new THREE.Mesh(
          new THREE.SphereGeometry(0.115, 18, 18),
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
          detail: `${AURA_STATE_LABELS[state]} · ${(workspace.terminals || []).length} terminals · ${workspace.todos?.running || 0} running · ${workspace.todos?.queued || 0} queued`,
          baseScale: 1,
        };
        wsGroup.add(wsCore);
        this.hoverables.push(wsCore);

        const wsLabel = makeLabelSprite(workspace.name, { fontSize: 38, height: 0.23 });
        wsLabel.position.set(0, 0.42, 0);
        wsGroup.add(wsLabel);

        const workspaceNode = {
          workspace,
          state,
          group: wsGroup,
          core: wsCore,
          wire: wsWire,
          anchor: wsAnchor.clone(),
          branchColor,
          parent: deviceNode,
          bobPhase: wsIndex * 1.7 + deviceIndex,
          terminals: [],
        };
        deviceNode.workspaces.push(workspaceNode);
        this.workspaceNodes.push(workspaceNode);

        // Terminals: smaller fan continuing outward from the workspace.
        const terminals = workspace.terminals || [];
        const termSpread = Math.min(1.5, 0.7 * Math.max(terminals.length - 1, 1));
        terminals.forEach((terminal, termIndex) => {
          const tt = terminals.length > 1 ? termIndex / (terminals.length - 1) - 0.5 : 0;
          const termDir = wsAnchor.clone().sub(position).setY(0).normalize()
            .addScaledVector(side, tt * termSpread)
            .normalize();
          const termAnchor = wsAnchor.clone()
            .addScaledVector(termDir, 0.85)
            .add(new THREE.Vector3(0, (termIndex % 2 === 0 ? 0.22 : -0.2), 0));

          const termColor = new THREE.Color(
            AURA_STATE_COLORS[terminal.state] || AURA_STATE_COLORS.idle,
          );
          const termMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.07, 16, 16),
            new THREE.MeshStandardMaterial({
              color: 0x060a12,
              emissive: termColor,
              emissiveIntensity: terminal.state === "running" ? 1.5 : 0.8,
              metalness: 0.1,
              roughness: 0.4,
            }),
          );
          termMesh.position.copy(termAnchor);
          termMesh.userData = {
            kind: "terminal",
            label: `${workspace.name} / ${terminal.name}`,
            detail: AURA_STATE_LABELS[terminal.state] || terminal.state,
            baseScale: 1,
          };
          this.root.add(termMesh);
          this.hoverables.push(termMesh);

          const termLabel = makeLabelSprite(terminal.name, {
            fontSize: 28,
            height: 0.14,
            color: "rgba(196, 214, 242, 0.7)",
          });
          termLabel.position.copy(termAnchor).add(new THREE.Vector3(0, 0.19, 0));
          this.root.add(termLabel);

          const terminalNode = {
            terminal,
            state: terminal.state,
            mesh: termMesh,
            label: termLabel,
            anchor: termAnchor.clone(),
            parent: workspaceNode,
            wobblePhase: termIndex * 2.3 + wsIndex + deviceIndex,
            blinkPhase: termIndex * 1.3,
          };
          workspaceNode.terminals.push(terminalNode);
          this.terminalNodes.push(terminalNode);
        });
      });

      // Local device: labeled scripts orbit the containment sphere.
      const scripts = device.scripts || [];
      if (scripts.length) {
        const scriptRing = new THREE.Mesh(
          new THREE.TorusGeometry(sphereRadius + 0.55, 0.004, 8, 160),
          new THREE.MeshBasicMaterial({
            color: kindColor,
            transparent: true,
            opacity: 0.14,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        scriptRing.rotation.x = Math.PI / 2 - 0.35;
        group.add(scriptRing);

        scripts.forEach((script, scriptIndex) => {
          const scriptColor = new THREE.Color(
            AURA_STATE_COLORS[script.state] || AURA_STATE_COLORS.idle,
          );
          const holder = new THREE.Group();
          group.add(holder);
          const mesh = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.085),
            new THREE.MeshStandardMaterial({
              color: 0x0a0f1a,
              emissive: scriptColor,
              emissiveIntensity: script.state === "running" ? 1.5 : 0.85,
              metalness: 0.2,
              roughness: 0.4,
            }),
          );
          mesh.userData = {
            kind: "script",
            label: `${device.name} · ${script.name}`,
            detail: `Script · ${AURA_STATE_LABELS[script.state] || script.state}`,
            baseScale: 1,
          };
          holder.add(mesh);
          this.hoverables.push(mesh);

          const scriptLabel = makeLabelSprite(script.name, {
            fontSize: 28,
            height: 0.13,
            color: "rgba(214, 228, 250, 0.78)",
          });
          scriptLabel.position.set(0, 0.18, 0);
          holder.add(scriptLabel);

          this.scriptNodes.push({
            script,
            holder,
            mesh,
            parent: deviceNode,
            orbitRadius: sphereRadius + 0.55,
            orbitTilt: -0.35,
            phase: (scriptIndex / scripts.length) * TWO_PI,
            speed: 0.22,
            blinkPhase: scriptIndex * 1.9,
          });
        });
      }
    });
  }

  /* One shared vertex-colored line buffer: core→device spokes (faint), then
     device→workspace and workspace→terminal branches in each branch hue. */
  buildEdges() {
    this.edgeSegments = [];
    const spokeColor = new THREE.Color(COLORS.spoke);

    this.deviceNodes.forEach((deviceNode) => {
      this.edgeSegments.push({
        from: () => this.coreMesh.getWorldPosition(this.scratchA),
        to: () => deviceNode.group.getWorldPosition(this.scratchB),
        color: spokeColor,
      });
      deviceNode.workspaces.forEach((wsNode) => {
        this.edgeSegments.push({
          from: () => deviceNode.group.getWorldPosition(this.scratchA),
          to: () => wsNode.group.getWorldPosition(this.scratchB),
          color: wsNode.branchColor,
        });
        wsNode.terminals.forEach((termNode) => {
          this.edgeSegments.push({
            from: () => wsNode.group.getWorldPosition(this.scratchA),
            to: () => termNode.mesh.getWorldPosition(this.scratchB),
            color: wsNode.branchColor,
          });
        });
      });
    });

    this.scratchA = new THREE.Vector3();
    this.scratchB = new THREE.Vector3();

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
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.root.add(this.edgeLines);
  }

  buildOuterRing({ items, radius, tilt, color, kind, kindLabel, makeNodeGeometry, key, speed }) {
    const ringGroup = new THREE.Group();
    ringGroup.rotation.copy(tilt);
    this.root.add(ringGroup);

    const guide = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.0045, 8, 220),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    guide.rotation.x = Math.PI / 2;
    ringGroup.add(guide);

    const spinner = new THREE.Group();
    ringGroup.add(spinner);

    const nodes = items.map((item, index) => {
      const angle = (index / items.length) * TWO_PI;
      const holder = new THREE.Group();
      holder.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      spinner.add(holder);

      const mesh = new THREE.Mesh(
        makeNodeGeometry(),
        new THREE.MeshStandardMaterial({
          color: 0x0a0f1a,
          emissive: new THREE.Color(color),
          emissiveIntensity: 0.9,
          metalness: 0.25,
          roughness: 0.4,
        }),
      );
      mesh.userData = {
        kind,
        label: item.name,
        detail: kindLabel,
        baseScale: 1,
      };
      holder.add(mesh);
      this.hoverables.push(mesh);

      const label = makeLabelSprite(item.name, {
        fontSize: 38,
        height: 0.21,
        color: "rgba(214, 226, 248, 0.78)",
      });
      label.position.set(0, 0.34, 0);
      holder.add(label);

      return { holder, mesh, spinPhase: index * 1.1 };
    });

    this[key] = { group: ringGroup, spinner, nodes, speed };
  }

  /* Activity-monitor particles: running todos travel workspace→terminal;
     queued todos idle in a tight orbit around their workspace. */
  buildTodoParticles() {
    this.todoTravelers = [];
    this.todoQueued = [];

    this.workspaceNodes.forEach((wsNode, wsIndex) => {
      const todos = wsNode.workspace.todos || {};

      for (let i = 0; i < Math.min(todos.running || 0, 3); i += 1) {
        if (!wsNode.terminals.length) break;
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.glowSoft,
            color: new THREE.Color(COLORS.coreCyan),
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        sprite.scale.set(0.15, 0.15, 1);
        this.root.add(sprite);
        this.todoTravelers.push({
          sprite,
          node: wsNode,
          target: wsNode.terminals[(i + wsIndex) % wsNode.terminals.length],
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
        sprite.scale.set(0.09, 0.09, 1);
        this.root.add(sprite);
        this.todoQueued.push({
          sprite,
          node: wsNode,
          radius: 0.34 + i * 0.05,
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
        0.42,
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
      this.orbit.targetRadius + event.deltaY * 0.009,
      8.2,
      19.5,
    );
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
      orbit.targetTheta += dt * 0.04;
    }
    const ease = 1 - Math.pow(0.001, dt);
    orbit.theta += (orbit.targetTheta - orbit.theta) * ease;
    orbit.phi += (orbit.targetPhi - orbit.phi) * ease;
    orbit.radius += (orbit.targetRadius - orbit.radius) * ease;

    const introRadius = orbit.radius + (1 - easeOutCubic(this.introT)) * 4;
    this.camera.position.set(
      introRadius * Math.sin(orbit.phi) * Math.cos(orbit.theta),
      introRadius * Math.cos(orbit.phi),
      introRadius * Math.sin(orbit.phi) * Math.sin(orbit.theta),
    );
    this.camera.lookAt(0, 0, 0);
  }

  tick() {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const motion = this.reducedMotion ? 0 : dt;
    this.elapsed += motion;
    if (this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / 1.5);
    }

    const introScale = 0.82 + 0.18 * easeOutCubic(this.introT);
    this.root.scale.setScalar(introScale);

    // Core motion
    this.ringA.rotation.z += motion * 0.12;
    this.ringB.rotation.z -= motion * 0.08;
    this.coreMesh.rotation.y += motion * 0.25;
    this.starfield.rotation.y += motion * 0.004;
    const pulse = 1 + Math.sin(this.elapsed * 1.4) * 0.04;
    this.halo.scale.set(3.6 * pulse, 3.6 * pulse, 1);

    // Devices breathe gently; standby skins stay dim.
    this.deviceNodes.forEach((deviceNode) => {
      const bob = Math.sin(this.elapsed * 0.4 + deviceNode.bobPhase) * 0.06;
      deviceNode.group.position.set(
        deviceNode.basePosition.x,
        deviceNode.basePosition.y + bob,
        deviceNode.basePosition.z,
      );
      deviceNode.skin.rotation.y += motion * 0.05;
      deviceNode.mesh.rotation.y += motion * 0.3;
    });

    // Workspaces ride their anchors with a soft bob; state pulses.
    this.workspaceNodes.forEach((wsNode) => {
      const bob = Math.sin(this.elapsed * 0.55 + wsNode.bobPhase) * 0.05;
      wsNode.group.position.set(
        wsNode.anchor.x,
        wsNode.anchor.y + bob,
        wsNode.anchor.z,
      );
      wsNode.wire.rotation.y += motion * 0.35;
      const material = wsNode.core.material;
      if (wsNode.state === "running") {
        material.emissiveIntensity = 1.2 + Math.sin(this.elapsed * 3 + wsNode.bobPhase) * 0.4;
      } else if (wsNode.state === "attention") {
        material.emissiveIntensity = Math.sin(this.elapsed * 6 + wsNode.bobPhase) > 0 ? 1.8 : 0.4;
      }
    });

    // Terminals wobble around their fan anchors; blink by state.
    const wobble = new THREE.Vector3();
    this.terminalNodes.forEach((termNode) => {
      const angle = this.elapsed * 0.8 + termNode.wobblePhase;
      wobble.set(Math.cos(angle) * 0.05, Math.sin(angle * 1.3) * 0.05, Math.sin(angle) * 0.05);
      termNode.mesh.position.copy(termNode.anchor).add(wobble);
      termNode.label.position.copy(termNode.mesh.position).add(new THREE.Vector3(0, 0.19, 0));
      const material = termNode.mesh.material;
      if (termNode.state === "running") {
        material.emissiveIntensity = 1.3 + Math.sin(this.elapsed * 3.2 + termNode.blinkPhase) * 0.5;
      } else if (termNode.state === "attention") {
        material.emissiveIntensity = Math.sin(this.elapsed * 6 + termNode.blinkPhase) > 0 ? 1.7 : 0.35;
      }
    });

    // Scripts orbit the local device sphere; running scripts pulse.
    this.scriptNodes.forEach((scriptNode) => {
      const angle = scriptNode.phase + this.elapsed * scriptNode.speed;
      const x = Math.cos(angle) * scriptNode.orbitRadius;
      const z = Math.sin(angle) * scriptNode.orbitRadius;
      const y = Math.sin(angle) * Math.sin(scriptNode.orbitTilt) * scriptNode.orbitRadius * 0.4;
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

    // Outer rings
    [this.docsRing, this.mcpRing].forEach((ring) => {
      if (!ring) return;
      ring.spinner.rotation.y += motion * ring.speed;
      ring.nodes.forEach((node) => {
        node.mesh.rotation.x += motion * 0.5;
        node.mesh.rotation.y += motion * 0.7;
      });
    });

    // Todo particles
    const curveScratch = new THREE.Vector3();
    this.todoTravelers.forEach((traveler) => {
      traveler.t += motion * traveler.speed;
      if (traveler.t >= 1) {
        traveler.t = 0;
        const terms = traveler.node.terminals;
        traveler.target = terms[Math.floor(this.elapsed * 7) % terms.length];
      }
      const from = traveler.node.group.position;
      const to = traveler.target.mesh.position;
      curveScratch.lerpVectors(from, to, traveler.t);
      const arc = Math.sin(traveler.t * Math.PI) * 0.18;
      curveScratch.y += arc;
      traveler.sprite.position.copy(curveScratch);
      const fade = Math.sin(traveler.t * Math.PI);
      traveler.sprite.material.opacity = 0.25 + fade * 0.6;
    });

    this.todoQueued.forEach((dot) => {
      const angle = dot.phase + this.elapsed * dot.speed;
      dot.sprite.position.set(
        dot.node.group.position.x + Math.cos(angle) * dot.radius,
        dot.node.group.position.y + Math.sin(angle * 0.7) * 0.07,
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
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}

export default AuraSceneEngine;
