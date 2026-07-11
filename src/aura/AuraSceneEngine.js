// Aura Mode 3D scene — vanilla three.js engine (no react-three-fiber).
// UI-only: renders the mock orchestration graph (workspaces → terminals with
// live-state colors, todo particles in flight, docs + MCP orbital rings)
// around a central aura core. The React shell (AuraMode.jsx) owns the DOM HUD.

import * as THREE from "three";

import { AURA_STATE_COLORS, AURA_STATE_LABELS } from "./auraMockData.js";

const COLORS = {
  coreCyan: 0x4fd8ff,
  coreEmber: 0xff9a3c,
  containment: 0x274a66,
  edge: 0x4fd8ff,
  star: 0x9fb4d8,
  doc: 0xffd27d,
  mcp: 0xb48cff,
  queued: 0xffd27d,
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
      phi: 1.18,
      radius: 10.4,
      targetTheta: 0.6,
      targetPhi: 1.18,
      targetRadius: 10.4,
    };

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.012);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 240);

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
    this.buildWorkspaceGraph();
    this.buildOuterRing({
      items: this.data.docs,
      radius: 5.05,
      tilt: new THREE.Euler(0.42, 0, 0.08),
      color: COLORS.doc,
      kind: "doc",
      kindLabel: "Doc",
      makeNodeGeometry: () => new THREE.OctahedronGeometry(0.13),
      key: "docsRing",
      speed: 0.055,
    });
    this.buildOuterRing({
      items: this.data.mcps,
      radius: 5.75,
      tilt: new THREE.Euler(-0.5, 0, -0.22),
      color: COLORS.mcp,
      kind: "mcp",
      kindLabel: "MCP",
      makeNodeGeometry: () => new THREE.BoxGeometry(0.15, 0.15, 0.15),
      key: "mcpRing",
      speed: -0.042,
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
    this.scene.add(new THREE.AmbientLight(0x8fa8d0, 0.55));
    const coreLight = new THREE.PointLight(COLORS.coreCyan, 60, 40, 1.8);
    coreLight.position.set(0, 0.4, 0);
    this.scene.add(coreLight);
    const rim = new THREE.DirectionalLight(0xffb277, 0.8);
    rim.position.set(6, 8, -4);
    this.scene.add(rim);
  }

  buildStarfield() {
    const count = 1400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const r = 42 + Math.random() * 60;
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
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    this.scene.add(this.starfield);
  }

  buildCore() {
    this.coreGroup = new THREE.Group();
    this.root.add(this.coreGroup);

    const ringA = new THREE.Mesh(
      new THREE.TorusGeometry(3.55, 0.016, 12, 260),
      new THREE.MeshBasicMaterial({
        color: COLORS.coreCyan,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ringA.rotation.x = Math.PI / 2 - 0.06;
    this.coreGroup.add(ringA);
    this.ringA = ringA;

    const ringB = new THREE.Mesh(
      new THREE.TorusGeometry(3.82, 0.011, 12, 260),
      new THREE.MeshBasicMaterial({
        color: COLORS.coreEmber,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ringB.rotation.x = Math.PI / 2 + 0.2;
    ringB.rotation.y = 0.14;
    this.coreGroup.add(ringB);
    this.ringB = ringB;

    // Dashed outer accent ring: a circle of points, counter-rotating.
    const dashCount = 170;
    const dashPositions = new Float32Array(dashCount * 3);
    for (let i = 0; i < dashCount; i += 1) {
      const angle = (i / dashCount) * TWO_PI;
      dashPositions[i * 3] = Math.cos(angle) * 4.12;
      dashPositions[i * 3 + 1] = 0;
      dashPositions[i * 3 + 2] = Math.sin(angle) * 4.12;
    }
    const dashGeometry = new THREE.BufferGeometry();
    dashGeometry.setAttribute("position", new THREE.BufferAttribute(dashPositions, 3));
    this.ringDots = new THREE.Points(
      dashGeometry,
      new THREE.PointsMaterial({
        color: 0xbfe8ff,
        size: 0.045,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.ringDots.rotation.x = -0.08;
    this.coreGroup.add(this.ringDots);

    this.containment = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3.34, 2),
      new THREE.MeshBasicMaterial({
        color: COLORS.containment,
        wireframe: true,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      }),
    );
    this.coreGroup.add(this.containment);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowSoft,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.set(7.4, 7.4, 1);
    this.coreGroup.add(halo);
    this.halo = halo;
  }

  buildWorkspaceGraph() {
    this.graphGroup = new THREE.Group();
    this.coreGroup.add(this.graphGroup);

    this.workspaceNodes = [];
    this.terminalNodes = [];

    const workspaces = this.data.workspaces;
    workspaces.forEach((workspace, index) => {
      const angle = (index / workspaces.length) * TWO_PI + 0.7;
      const radius = 1.9;
      const baseY = ((index % 2 === 0 ? 1 : -1) * (0.34 + 0.14 * (index % 3)));

      const group = new THREE.Group();
      this.graphGroup.add(group);

      const color = new THREE.Color(workspace.accent);
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.28, 1),
        new THREE.MeshStandardMaterial({
          color: 0x0b1220,
          emissive: color,
          emissiveIntensity: 0.7,
          metalness: 0.2,
          roughness: 0.35,
        }),
      );
      mesh.userData = {
        kind: "workspace",
        label: workspace.name,
        detail: `${workspace.terminals.length} terminals · ${workspace.todos.queued} queued · ${workspace.todos.running} running`,
        baseScale: 1,
      };
      group.add(mesh);
      this.hoverables.push(mesh);

      const wire = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.4, 1),
        new THREE.MeshBasicMaterial({
          color,
          wireframe: true,
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
        }),
      );
      group.add(wire);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowSoft,
          color,
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glow.scale.set(1.5, 1.5, 1);
      group.add(glow);

      const label = makeLabelSprite(workspace.name, { fontSize: 44, height: 0.3 });
      label.position.set(0, 0.62, 0);
      group.add(label);

      const node = {
        workspace,
        group,
        mesh,
        wire,
        angle,
        radius,
        baseY,
        bobPhase: index * 1.7,
        terminals: [],
      };
      this.workspaceNodes.push(node);

      workspace.terminals.forEach((terminal, termIndex) => {
        const stateColor = new THREE.Color(AURA_STATE_COLORS[terminal.state] || AURA_STATE_COLORS.idle);
        const termMesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.082, 18, 18),
          new THREE.MeshStandardMaterial({
            color: 0x060a12,
            emissive: stateColor,
            emissiveIntensity: terminal.state === "running" ? 1.5 : 0.8,
            metalness: 0.1,
            roughness: 0.4,
          }),
        );
        termMesh.userData = {
          kind: "terminal",
          label: `${workspace.name} / ${terminal.name}`,
          detail: AURA_STATE_LABELS[terminal.state] || terminal.state,
          baseScale: 1,
        };
        this.graphGroup.add(termMesh);
        this.hoverables.push(termMesh);

        const orbit = {
          mesh: termMesh,
          parent: node,
          state: terminal.state,
          radius: 0.66 + termIndex * 0.13,
          speed: (0.34 + (termIndex % 3) * 0.11) * (termIndex % 2 === 0 ? 1 : -1),
          phase: termIndex * 2.4 + index,
          tilt: new THREE.Quaternion().setFromEuler(
            new THREE.Euler((termIndex * 0.9 + index) % 1.2 - 0.6, 0, ((termIndex + index) * 0.7) % 1.4 - 0.7),
          ),
          blinkPhase: termIndex * 1.3,
        };
        node.terminals.push(orbit);
        this.terminalNodes.push(orbit);
      });
    });

    // One shared line buffer: core→workspace spokes + workspace→terminal edges.
    const segmentCount = this.workspaceNodes.length + this.terminalNodes.length;
    this.edgePositions = new Float32Array(segmentCount * 2 * 3);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.BufferAttribute(this.edgePositions, 3));
    this.edgeLines = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: COLORS.edge,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.graphGroup.add(this.edgeLines);
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
        opacity: 0.14,
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

  buildTodoParticles() {
    this.todoTravelers = [];
    this.todoQueued = [];

    this.workspaceNodes.forEach((node, wsIndex) => {
      const { todos } = node.workspace;

      for (let i = 0; i < Math.min(todos.running, 3); i += 1) {
        if (!node.terminals.length) break;
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
        sprite.scale.set(0.16, 0.16, 1);
        this.graphGroup.add(sprite);
        this.todoTravelers.push({
          sprite,
          node,
          target: node.terminals[(i + wsIndex) % node.terminals.length],
          t: (i * 0.37 + wsIndex * 0.21) % 1,
          speed: 0.24 + (i % 3) * 0.07,
        });
      }

      for (let i = 0; i < Math.min(todos.queued, 4); i += 1) {
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
        sprite.scale.set(0.1, 0.1, 1);
        this.graphGroup.add(sprite);
        this.todoQueued.push({
          sprite,
          node,
          radius: 0.42 + i * 0.045,
          speed: 0.5 + i * 0.12,
          phase: i * 1.9 + wsIndex,
        });
      }
    });
  }

  workspacePosition(node, target) {
    const bob = Math.sin(this.elapsed * 0.5 + node.bobPhase) * 0.09;
    target.set(
      Math.cos(node.angle) * node.radius,
      node.baseY + bob,
      Math.sin(node.angle) * node.radius,
    );
    return target;
  }

  terminalPosition(orbit, target) {
    const angle = orbit.phase + this.elapsed * orbit.speed;
    target.set(Math.cos(angle) * orbit.radius, 0, Math.sin(angle) * orbit.radius);
    target.applyQuaternion(orbit.tilt);
    target.add(orbit.parent.group.position);
    return target;
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
      this.orbit.targetRadius + event.deltaY * 0.008,
      6.6,
      15.5,
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
      orbit.targetTheta += dt * 0.045;
    }
    const ease = 1 - Math.pow(0.001, dt);
    orbit.theta += (orbit.targetTheta - orbit.theta) * ease;
    orbit.phi += (orbit.targetPhi - orbit.phi) * ease;
    orbit.radius += (orbit.targetRadius - orbit.radius) * ease;

    const introRadius = orbit.radius + (1 - easeOutCubic(this.introT)) * 3.4;
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
    this.ringA.rotation.z += motion * 0.11;
    this.ringB.rotation.z -= motion * 0.07;
    this.ringDots.rotation.y -= motion * 0.16;
    this.containment.rotation.y += motion * 0.02;
    this.starfield.rotation.y += motion * 0.004;
    const pulse = 1 + Math.sin(this.elapsed * 1.4) * 0.035;
    this.halo.scale.set(7.4 * pulse, 7.4 * pulse, 1);

    // Workspaces + terminals
    const scratch = new THREE.Vector3();
    this.workspaceNodes.forEach((node) => {
      this.workspacePosition(node, scratch);
      node.group.position.copy(scratch);
      node.wire.rotation.y += motion * 0.4;
      node.mesh.rotation.y += motion * 0.2;
    });

    this.terminalNodes.forEach((orbit) => {
      this.terminalPosition(orbit, scratch);
      orbit.mesh.position.copy(scratch);
      const material = orbit.mesh.material;
      if (orbit.state === "running") {
        material.emissiveIntensity = 1.3 + Math.sin(this.elapsed * 3.2 + orbit.blinkPhase) * 0.5;
      } else if (orbit.state === "attention") {
        material.emissiveIntensity = Math.sin(this.elapsed * 6 + orbit.blinkPhase) > 0 ? 1.7 : 0.35;
      }
    });

    // Edge buffer: spokes then orbit edges
    let offset = 0;
    this.workspaceNodes.forEach((node) => {
      this.edgePositions[offset] = 0;
      this.edgePositions[offset + 1] = 0;
      this.edgePositions[offset + 2] = 0;
      this.edgePositions[offset + 3] = node.group.position.x;
      this.edgePositions[offset + 4] = node.group.position.y;
      this.edgePositions[offset + 5] = node.group.position.z;
      offset += 6;
    });
    this.terminalNodes.forEach((orbit) => {
      const from = orbit.parent.group.position;
      const to = orbit.mesh.position;
      this.edgePositions[offset] = from.x;
      this.edgePositions[offset + 1] = from.y;
      this.edgePositions[offset + 2] = from.z;
      this.edgePositions[offset + 3] = to.x;
      this.edgePositions[offset + 4] = to.y;
      this.edgePositions[offset + 5] = to.z;
      offset += 6;
    });
    this.edgeLines.geometry.attributes.position.needsUpdate = true;

    // Outer rings
    [this.docsRing, this.mcpRing].forEach((ring) => {
      if (!ring) return;
      ring.spinner.rotation.y += motion * ring.speed;
      ring.nodes.forEach((node) => {
        node.mesh.rotation.x += motion * 0.5;
        node.mesh.rotation.y += motion * 0.7;
        // Billboard-ish: labels are sprites so they self-face; nothing to do.
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
      // Arc the path outward a little for a comet feel.
      const arc = Math.sin(traveler.t * Math.PI) * 0.22;
      curveScratch.y += arc;
      traveler.sprite.position.copy(curveScratch);
      const fade = Math.sin(traveler.t * Math.PI);
      traveler.sprite.material.opacity = 0.25 + fade * 0.6;
    });

    this.todoQueued.forEach((dot) => {
      const angle = dot.phase + this.elapsed * dot.speed;
      dot.sprite.position.set(
        dot.node.group.position.x + Math.cos(angle) * dot.radius,
        dot.node.group.position.y + Math.sin(angle * 0.7) * 0.08,
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
