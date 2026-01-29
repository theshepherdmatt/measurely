/* ==========================================================
   Measurely 3D Room Engine (Reusable) — DEBUG BUILD
   ========================================================== */

export function initRoom3D({
  mountId,
  getRoomData,
  mode = "setup"
}) {


  console.log("[Room3D] initRoom3D() called with mode:", mode);

  const container = document.getElementById(mountId);
  if (!container) {
    console.error("[Room3D] ❌ mountId not found:", mountId);
    return;
  }

  const VISIBILITY = {
    roomShell: true,
    grid: true,
    furniture: {
      sofa: true,
      coffeeTable: true,
      rug: true
    }
  };

    const OVERLAYS = {
    FLOOR_REFLECTION: "floor_reflection",
    SBIR: "sbir",
    SIDE_REFLECTIONS: "side_reflections",
    REAR_ENERGY: "rear_energy",
    COFFEE_TABLE: "coffee_table",
    BANDWIDTH: "bandwidth",
    CLARITY: "clarity",
    BALANCE: "balance"

  };

  /* ------------------------------------------
     MODE STATE
  ------------------------------------------ */
  let currentMode = mode;
  let analysisStart = null;
  let analysisPulse = 0;
  let renderStage = "room"; 
  const activeOverlays = new Set();
  let focusedOverlay = null;
  let activeScore = 10;

  function overlayEnabled(id) {
    return activeOverlays.has(id);
  }

/* ------------------------------------------
   COLOUR STATES (Refined for Glow)
------------------------------------------ */
  const ROOM_COLOURS = {
    idle: {
      room: 0x6366f1,     // Measurely purple
      accent: 0x818cf8,   // Cyan accent
      furniture: 0x4338ca // Deeper purple for grounding
    },
    active: {
      room: 0x22d3ee,
      accent: 0xffffff,   // White glow for analysis
      furniture: 0x0e7490
    },
    success: {
      room: 0x22c55e,
      accent: 0x4ade80,
      furniture: 0x166534
    }
  };

  const WIREFRAME_STRENGTH = {
    room: 0.9,
    grid: 0.6,
    objects: 0.75,
    listener: 0.9
  };

  let colourState = "idle";


  const isDesktop = window.innerWidth >= 900;
  const baseScale = isDesktop ? 1.1 : 1;

  console.log("[Room3D] baseScale =", baseScale);


  const ANALYSIS_DURATION = 15000; // ms

  /* ------------------------------------------
     SCENE SETUP
  ------------------------------------------ */
  const scene = new THREE.Scene();
  const roomGroup = new THREE.Group();
  roomGroup.scale.set(baseScale, baseScale, baseScale);

  // 👇 ADD HERE
  //const ROOM_YAW = -Math.PI * 0.2;
  //roomGroup.rotation.y = ROOM_YAW;

  scene.add(roomGroup);

  /* ------------------------------------------
    LIGHTING (Required for Standard Materials)
  ------------------------------------------ */
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);

  const topLight = new THREE.PointLight(0xffffff, 2.0);
  topLight.position.set(0, 5, 0);
  scene.add(topLight);

  const camera = new THREE.PerspectiveCamera(
    70,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
  });

  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  console.log("[Room3D] Renderer + camera initialised");

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = true;
  
  camera.position.set(3.0, 1.35, 4.4);
  camera.lookAt(0.4, 1.1, -1.4);

  /* ------------------------------------------
     RESIZE HANDLING
  ------------------------------------------ */
  window.addEventListener("resize", () => {
    console.log("[Room3D] window resize");
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });


  /* ------------------------------------------
     REBUILD SCENE (GEOMETRY ONLY)
  ------------------------------------------ */
  function rebuild() {

    console.log("[Room3D] 🔧 rebuild() called | mode =", currentMode);

    console.log("[Room3D] 🔧 rebuild | stage =", renderStage);

    roomGroup.clear();

    colourState = "idle";

    const room = getRoomData();
    window.__MEASURELY_ROOM__ = room;
    if (!room) {
      console.warn("[Room3D] ⚠️ getRoomData() returned null");
      return;
    }

    if (
    room.length_m == null ||
    room.width_m == null ||
    room.height_m == null
    ) {
    console.error("[Room3D] ❌ Invalid room data", room);
    return;
    }

    console.log("[Room3D] Room data:", room);

    // ------------------------------------------
    // ROOM GEOMETRY (SINGLE SOURCE OF TRUTH)
    // ------------------------------------------
    const roomGeo = new THREE.BoxGeometry(
      room.width_m,
      room.height_m,
      room.length_m
    );


    const isLocked    = currentMode === "locked";
    const isAnalysing = currentMode === "analysing";
    const isFinal     = currentMode === "final";

    const isFocused = Boolean(focusedOverlay);
    const DIM_FACTOR = isFocused ? 0.12 : 1.0;
  
    /* ------------------------------------------
      COLOUR STATE RESOLUTION
    ------------------------------------------ */
    // COLOUR RESOLUTION
    const colors = ROOM_COLOURS[colourState] || ROOM_COLOURS.idle;

    const OP_WIRE = (isLocked ? 0.25 : (isFinal ? 0.85 : 0.5)) * DIM_FACTOR;
    const OP_OBJ  = (isLocked ? 0.15 : (isFinal ? 0.6 : 0.25)) * DIM_FACTOR;

    /* ------------------------------------------
       ROOM BOX
    ------------------------------------------ */
    if (VISIBILITY.roomShell) {
      const roomEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(roomGeo),
        new THREE.LineBasicMaterial({
          color: colors.room,
          transparent: true,
          opacity: focusedOverlay ? 0.18 : 1.0,          
          depthTest: false,   // critical
          depthWrite: false
        })
      );

      roomEdges.renderOrder = 1;
      roomGroup.add(roomEdges);

    }

    const floorGeo = new THREE.PlaneGeometry(room.width_m * 1.1, room.length_m * 1.1);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x020617,
      roughness: 0.2,
      metalness: 0.4,
      transparent: true,
      opacity: 0.4,        // critical
      depthWrite: false
    });

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -room.height_m / 2 - 0.01; // Tiny offset to prevent flickering
    roomGroup.add(floor);

    /* ------------------------------------------
       GRID
    ------------------------------------------ */
    if (VISIBILITY.grid) {
      const grid = new THREE.GridHelper(
        10,
        20,
        colors.room,   // primary lines
        0x334155       // softer slate for secondary lines
      );

      grid.position.y = -room.height_m / 2;
      grid.material.transparent = true;
      grid.material.opacity = 0.38;     // 👈 the key number
      grid.material.depthWrite = false;

      const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMats.forEach(m => {
        m.transparent = true;
        m.opacity = focusedOverlay ? 0.05 : 0.25;
        m.depthTest = false;
        m.depthWrite = false;
      });

      roomGroup.add(grid);
    }

    /* ------------------------------------------
    PLACEHOLDER SOURCE BOXES (ROOM STAGE)
    ------------------------------------------ */
    if (renderStage === "room") {

    console.log("[Room3D] Rendering placeholder sources");

    const srcMat = new THREE.MeshBasicMaterial({
        color: colors.room,
        wireframe: true,
        transparent: true,
        opacity: 0.35
    });

    ["L", "R"].forEach(side => {
        const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.30, 0.50, 0.25),
        srcMat
        );

        const spacing = room.width_m * 0.4; // visual only, not data-driven

        const x = (side === "L" ? -1 : 1) * spacing / 2;

        box.position.set(
        x,
        -room.height_m / 2 + room.height_m * 0.4, // neutral vertical reference
        -room.length_m / 2 + 0.15                // speaker wall
        );

        roomGroup.add(box);
    });

    }

    function getSpeakerProfile(type) {
      switch (type) {

        case "floorstander":
          return {
            w: 0.34,
            h: 1.05,
            d: 0.32,
            color: 0x7c5cff,
            tweeterPos: 0.9   // near top of cabinet
          };

        case "panel":
          return {
            w: 0.90,
            h: 0.80,
            d: 0.08,
            color: 0xa5b4fc,
            lift: 0.05,
            tweeterPos: 0.65 // acoustic centre, not literal tweeter
          };

        case "standmount":
        default:
          return {
            w: 0.30,
            h: 0.65,
            d: 0.28,
            color: colors.accent,
            tweeterPos: 0.85 // bookshelves on stands
          };
      }
    }

    /* ------------------------------------------
      SPEAKERS + BEAMS (STAGED)
    ------------------------------------------ */
    if (renderStage === "speakers" || renderStage === "furnishings") {

      const toeDeg =
        renderStage === "speakers" ? 0 : room.toe_in_deg;

      const toeRad = toeDeg * Math.PI / 180;
      const baseY = -room.height_m / 2;

      ["L", "R"].forEach(side => {

        const profile = getSpeakerProfile(room.speaker_type);

        const speaker = new THREE.Mesh(
          new THREE.BoxGeometry(profile.w, profile.h, profile.d),
          new THREE.MeshBasicMaterial({
            color: profile.color,
            wireframe: true,
            transparent: true,
            opacity: Math.max(OP_OBJ, WIREFRAME_STRENGTH.objects)
          })
        );

        const x =
          (side === "L" ? -1 : 1) *
          room.spk_spacing_m / 2;

        const z = -room.length_m / 2 + room.spk_front_m;

        let y;

        switch (room.speaker_type) {

          case "standmount":
          case "floorstander":
            y =
              baseY +
              room.tweeter_height_m -
              profile.h * profile.tweeterPos +
              profile.h / 2;
            break;

          case "panel":
            y = baseY + profile.h / 2 + profile.lift;
            break;

          default:
            y = baseY + profile.h / 2;
        
        }

        speaker.position.set(x, y, z);

        // ROTATION
        if (room.speaker_type === "panel") {
          speaker.rotation.set(
            -5 * Math.PI / 180,
            (side === "L" ? 1 : -1) * toeRad,
            0
          );
        } else {
          speaker.rotation.y =
            (side === "L" ? 1 : -1) * toeRad;
        }

        /* -------------------------
          TOE-IN BEAM (RESTORED)
        ------------------------- */
        const beam = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, room.length_m)
          ]),
          new THREE.LineDashedMaterial({
            color: profile.color,
            dashSize: 0.25,
            gapSize: 0.15,
            transparent: true,
            opacity: isLocked ? 0.15 : 0.45
          })
        );

        beam.computeLineDistances();
        speaker.add(beam);

        roomGroup.add(speaker);
      });
    }

    /* ------------------------------------------
       LISTENER
    ------------------------------------------ */
    console.log("[Room3D] Adding listener");

    const listenerZ =
    -room.length_m / 2 + room.listener_front_m;

    const listener = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 24, 24),
      new THREE.MeshBasicMaterial({
        color: colors.accent,
        wireframe: true,
        transparent: true,
        opacity: isLocked ? 0.25 : 0.6
      })
    );

    listener.position.set(
      0,
      -room.height_m / 2 + room.tweeter_height_m,
      listenerZ
    );
    roomGroup.add(listener);

  /* ------------------------------------------
    FURNITURE (Refined Modular Look)
  ------------------------------------------ */
  const furnMat = new THREE.MeshStandardMaterial({
    color: colors.furniture,
    emissive: colors.furniture,
    emissiveIntensity: 0.35,
    wireframe: true,
    transparent: true,
    opacity: OP_OBJ,

    depthTest: false,    // THIS fixes the flicker
    depthWrite: false
  });

  /* ------------------------------------------
    RUG (Restored)
  ------------------------------------------ */
  if (VISIBILITY.furniture.rug && room.opt_area_rug && !isFocused) {
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(
        room.width_m * 0.45,
        room.length_m * 0.35
      ),
      new THREE.MeshStandardMaterial({
        color: 0x64748b,
        wireframe: true,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        depthTest: false
      })

    );

    rug.rotation.x = -Math.PI / 2;
    rug.position.set(
      0,
      -room.height_m / 2 + 0.01,
      listenerZ - 1.15
    );

    roomGroup.add(rug);
  }

  // --- SOFA (Corrected Orientation) ---
  if (VISIBILITY.furniture.sofa && room.opt_sofa && !isFocused) {
    console.log("[Room3D] Adding modular sofa");
    const sofaGroup = new THREE.Group();

    // 1. The Base Seat
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.4, 0.9), furnMat);
    base.position.y = 0.2;
    sofaGroup.add(base);

    // 2. The Backrest (Now moved to the POSITIVE Z side to face the speakers)
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.5, 0.2), furnMat);
    back.position.set(0, 0.55, 0.35); // Flipped from -0.35
    sofaGroup.add(back);

    // 3. The Arms
    const armGeo = new THREE.BoxGeometry(0.2, 0.35, 0.9);
    const leftArm = new THREE.Mesh(armGeo, furnMat);
    leftArm.position.set(-0.95, 0.4, 0);
    const rightArm = new THREE.Mesh(armGeo, furnMat);
    rightArm.position.set(0.95, 0.4, 0);
    sofaGroup.add(leftArm, rightArm);

    // Position it at the listener's coordinates
    sofaGroup.position.set(0, -room.height_m / 2, listenerZ);
    
    roomGroup.add(sofaGroup);
  }

  // --- COFFEE TABLE ---
  if (VISIBILITY.furniture.coffeeTable && room.opt_coffee_table && !isFocused) {
    console.log("[Room3D] Adding coffee table frame");
    const tableGroup = new THREE.Group();

    // Table Top (Thinner for a glass/modern look)
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.6), furnMat);
    top.position.y = 0.4;
    tableGroup.add(top);

    // Four Legs
    const legGeo = new THREE.BoxGeometry(0.04, 0.4, 0.04);
    const legPositions = [
      [-0.45, 0.2, -0.25], [0.45, 0.2, -0.25],
      [-0.45, 0.2, 0.25],  [0.45, 0.2, 0.25]
    ];

    legPositions.forEach(pos => {
      const leg = new THREE.Mesh(legGeo, furnMat);
      leg.position.set(...pos);
      tableGroup.add(leg);
    });

    // Table Position
    tableGroup.position.set(0, -room.height_m / 2, room.length_m * 0.1);
    roomGroup.add(tableGroup);
  }

  renderAnalysisOverlays(room);

}

  /* ------------------------------------------
    ANIMATION LOOP
  ------------------------------------------ */
  function animate() {
    requestAnimationFrame(animate);

    let scale = baseScale;

    // ANALYSIS PULSE
    if (currentMode === "analysing") {
      const now = performance.now();
      const elapsed = analysisStart ? now - analysisStart : 0;

      analysisPulse += 0.01;
      scale = baseScale * (1 + Math.sin(analysisPulse) * 0.01);

      if (elapsed >= ANALYSIS_DURATION) {
        currentMode = "final";
        analysisStart = null;
        analysisPulse = 0;
        rebuild();
      }
    }

    // DASHED LINE ENERGY MOTION
    scene.traverse(obj => {
      if (obj.isLine && obj.material?.type === "LineDashedMaterial") {
        obj.material.dashOffset -= 0.01;
      }
    });

    roomGroup.scale.set(scale, scale, scale);
    controls.update();
    renderer.render(scene, camera);

  }


  function drawReflectionPath(start, bounce, end, color = 0x818cf8) {
    const points = [start, bounce, end];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      geometry,
      new THREE.LineDashedMaterial({
        color,
        dashSize: 0.25,
        gapSize: 0.15,
        transparent: true,
        opacity: 0.7
      })
    );

    line.computeLineDistances();
    roomGroup.add(line);
  }

  /* ------------------------------------------
    ANALYSIS OVERLAYS (FINAL MODE)
  ------------------------------------------ */
  function renderAnalysisOverlays(room) {

    const isFocused = (id) => focusedOverlay === id;

    // ---- FLOOR REFLECTION ----
    if (
      overlayEnabled(OVERLAYS.FLOOR_REFLECTION) &&
      room.floor_material === "hard"
    ) {
      const floorOverlay = new THREE.Mesh(
        new THREE.PlaneGeometry(
          room.width_m * 0.9,
          room.length_m * 0.6
        ),
        new THREE.MeshBasicMaterial({
          color: 0x6366f1,
          transparent: true,
          opacity: 0.08,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );

      floorOverlay.rotation.x = Math.PI / 2;
      floorOverlay.position.set(
        0,
        -room.height_m / 2 + 0.02,
        -room.length_m * 0.15
      );

      roomGroup.add(floorOverlay);
    }

    // ---- SBIR ----
    if (overlayEnabled(OVERLAYS.SBIR)) {
      const sbirDepth = Math.max(room.spk_front_m || 0.2, 0.2);
      const isProblem = room.spk_front_m < 0.5;

      const sbirZone = new THREE.Mesh(
        new THREE.BoxGeometry(
          room.width_m * 0.85,
          room.height_m * 0.6,
          sbirDepth
        ),
        new THREE.MeshStandardMaterial({
          color: isProblem ? 0xff3b3b : 0x22d3ee,
          emissive: isProblem ? 0xff0000 : 0x00f2ff,
          emissiveIntensity: isProblem ? 2.0 : 0.5,
          transparent: true,
          opacity: focusedOverlay === "sbir" ? 0.6 : 0.15,
          emissiveIntensity: focusedOverlay === "sbir" ? 1.2 : 0.6,
          depthWrite: false
        })
      );

      sbirZone.position.set(
        0,
        -room.height_m / 2 + room.height_m * 0.3,
        -room.length_m / 2 + sbirDepth / 2
      );

      roomGroup.add(sbirZone);

      if (isFocused(OVERLAYS.SBIR)) {

        const speakerY = -room.height_m / 2 + room.tweeter_height_m;
        const listenerZ = -room.length_m / 2 + room.listener_front_m;
        const wallZ = -room.length_m / 2;

        // LEFT speaker → front wall → listener
        drawReflectionPath(
          new THREE.Vector3(-room.spk_spacing_m / 2, speakerY, wallZ + room.spk_front_m),
          new THREE.Vector3(-room.spk_spacing_m / 2, speakerY, wallZ),
          new THREE.Vector3(0, speakerY, listenerZ),
          activeScore < 5 ? 0xff3b3b : 0x22d3ee
        );

        // RIGHT speaker → front wall → listener
        drawReflectionPath(
          new THREE.Vector3(room.spk_spacing_m / 2, speakerY, wallZ + room.spk_front_m),
          new THREE.Vector3(room.spk_spacing_m / 2, speakerY, wallZ),
          new THREE.Vector3(0, speakerY, listenerZ),
          activeScore < 5 ? 0xff3b3b : 0x22d3ee
        );
      }

    }

    // ---- SIDE WALL REFLECTIONS ----
    if (overlayEnabled(OVERLAYS.SIDE_REFLECTIONS)) {

      const sideGap = (room.width_m - room.spk_spacing_m) / 2;
      const isTooClose = sideGap < 0.6;

      const sideOffset = room.width_m / 2 - 0.05;
      const panelWidth = room.length_m * 0.45;
      const panelHeight = room.height_m * 0.6;

      const speakerY = -room.height_m / 2 + room.tweeter_height_m;
      const listenerPos = new THREE.Vector3(
        0,
        speakerY,
        -room.length_m / 2 + room.listener_front_m
      );

      const wallX = room.width_m / 2;

      for (const side of [-1, 1]) {

        // -----------------------------
        // VISUAL WALL PANEL
        // -----------------------------
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(panelWidth, panelHeight),
          new THREE.MeshStandardMaterial({
            color: isFocused(OVERLAYS.SIDE_REFLECTIONS)
              ? 0x22d3ee
              : (isTooClose ? 0xff3b3b : 0x6366f1),

            emissive: isFocused(OVERLAYS.SIDE_REFLECTIONS)
              ? 0x22d3ee
              : (isTooClose ? 0xff0000 : 0x000000),

            emissiveIntensity: isFocused(OVERLAYS.SIDE_REFLECTIONS)
              ? 1.8
              : (isTooClose ? 1.5 : 0.3),

            transparent: true,
            opacity: isFocused(OVERLAYS.SIDE_REFLECTIONS) ? 0.55 : 0.06,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );

        panel.rotation.y = Math.PI / 2;
        panel.position.set(
          side * sideOffset,
          -room.height_m / 2 + panelHeight / 2,
          -room.length_m * 0.05
        );

        roomGroup.add(panel);

        // -----------------------------
        // REFLECTION RAY (only when focused)
        // -----------------------------
        if (isFocused(OVERLAYS.SIDE_REFLECTIONS)) {

          const speakerPos = new THREE.Vector3(
            side * room.spk_spacing_m / 2,
            speakerY,
            -room.length_m / 2 + room.spk_front_m
          );

          // Mirror speaker across side wall
          const mirrorSpeaker = speakerPos.clone();
          mirrorSpeaker.x = side * wallX + (side * wallX - speakerPos.x);

          // Ray from listener to mirrored speaker
          const dir = new THREE.Vector3().subVectors(mirrorSpeaker, listenerPos);

          // Intersection with wall plane (x = ±wallX)
          const t = (side * wallX - listenerPos.x) / dir.x;
          const bouncePoint = listenerPos.clone().add(dir.multiplyScalar(t));

          // Draw reflection path
          drawReflectionPath(
            speakerPos,
            bouncePoint,
            listenerPos,
            activeScore < 5 ? 0xff3b3b : 0x22d3ee
          );

          // Glow dot at reflection point (optional but nice)
          const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0x22d3ee })
          );
          dot.position.copy(bouncePoint);
          roomGroup.add(dot);
        }
      }
    }

    // ---- REAR WALL ENERGY ----
    if (overlayEnabled(OVERLAYS.REAR_ENERGY)) {
      const rearDepth = Math.max(
        room.length_m - room.listener_front_m - 0.3,
        0.4
      );

      const rearZone = new THREE.Mesh(
        new THREE.BoxGeometry(
          room.width_m * 0.8,
          room.height_m * 0.7,
          rearDepth
        ),
        new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.05,
          depthWrite: false
        })
      );

      rearZone.position.set(
        0,
        -room.height_m / 2 + room.height_m * 0.35,
        room.length_m / 2 - rearDepth / 2
      );

      roomGroup.add(rearZone);
    }

    // ---- COFFEE TABLE ----
    if (overlayEnabled(OVERLAYS.COFFEE_TABLE)) {
      const tableReflection = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.15, 0.7),
        new THREE.MeshBasicMaterial({
          color: 0x22d3ee,
          transparent: true,
          opacity: 0.12,
          depthWrite: false
        })
      );

      tableReflection.position.set(
        0,
        -room.height_m / 2 + 0.35,
        room.length_m * 0.1
      );

      roomGroup.add(tableReflection);
    }

    // ---- BANDWIDTH (LOW FREQUENCY SUPPORT ZONE) ----
    if (overlayEnabled(OVERLAYS.BANDWIDTH)) {

      // FLOOR = primary LF boundary
      const floorZone = new THREE.Mesh(
        new THREE.PlaneGeometry(
          room.width_m * 0.95,
          room.length_m * 0.95
        ),
        new THREE.MeshBasicMaterial({
          color: 0x7c3aed, // Measurely purple
          transparent: true,
          opacity: focusedOverlay === OVERLAYS.BANDWIDTH ? 0.55 : 0.08,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );

      floorZone.rotation.x = -Math.PI / 2;
      floorZone.position.y = -room.height_m / 2 + 0.02;
      roomGroup.add(floorZone);

      // LOWER WALL MASS (bass loading zone)
      const wallHeight = room.height_m * 0.35;

      const bassWalls = new THREE.Mesh(
        new THREE.BoxGeometry(
          room.width_m * 0.92,
          wallHeight,
          room.length_m * 0.92
        ),
        new THREE.MeshBasicMaterial({
          color: 0x7c3aed,
          transparent: true,
          opacity: focusedOverlay === OVERLAYS.BANDWIDTH ? 0.35 : 0.06,
          depthWrite: false
        })
      );

      bassWalls.position.y =
        -room.height_m / 2 + wallHeight / 2;

      roomGroup.add(bassWalls);
    }

    // ---- BALANCE (LEFT / RIGHT SYMMETRY) ----
    if (overlayEnabled(OVERLAYS.BALANCE)) {

      const halfW = room.width_m / 2;
      const halfL = room.length_m / 2;

      // 1️⃣ Centre reference line (keep)
      const centreLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, -room.height_m / 2, -halfL),
          new THREE.Vector3(0, -room.height_m / 2,  halfL)
        ]),
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: focusedOverlay === OVERLAYS.BALANCE ? 0.9 : 0.15
        })
      );
      roomGroup.add(centreLine);

      // 2️⃣ Speaker symmetry planes
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: focusedOverlay === OVERLAYS.BALANCE ? 0.45 : 0.05,
        side: THREE.DoubleSide,
        depthWrite: false
      });

      [-1, 1].forEach(side => {
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(room.length_m * 0.9, room.height_m * 0.6),
          planeMat
        );

        plane.rotation.y = Math.PI / 2;
        plane.position.set(
          side * (room.spk_spacing_m / 2),
          -room.height_m / 2 + room.height_m * 0.3,
          0
        );

        roomGroup.add(plane);
      });

      // 3️⃣ Listener offset arrow
      const offset = room.listener_offset_m || 0;
      const isBad = Math.abs(offset) > 0.15;

      const arrowDir = new THREE.Vector3(
        Math.sign(offset || 1),
        0,
        0
      );

      const arrow = new THREE.ArrowHelper(
        arrowDir,
        new THREE.Vector3(0, -room.height_m / 2 + 0.05, -room.length_m * 0.15),
        Math.min(Math.abs(offset) * 2, 1.2),
        isBad ? 0xff3b3b : 0x22d3ee,
        0.25,
        0.15
      );

      arrow.line.material.transparent = true;
      arrow.line.material.opacity =
        focusedOverlay === OVERLAYS.BALANCE ? 0.95 : 0.15;


      roomGroup.add(arrow);
    }

    // ---- CLARITY (EARLY REFLECTION WINDOW) ----
    if (overlayEnabled(OVERLAYS.CLARITY)) {

      const speakerY = -room.height_m / 2 + room.tweeter_height_m;
      const listenerZ = -room.length_m / 2 + room.listener_front_m;

      const listenerPos = new THREE.Vector3(
        0,
        speakerY,
        listenerZ
      );

      // 1️⃣ Direct sound beams
      [-1, 1].forEach(side => {

        const speakerPos = new THREE.Vector3(
          side * room.spk_spacing_m / 2,
          speakerY,
          -room.length_m / 2 + room.spk_front_m
        );

        const beam = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([speakerPos, listenerPos]),
          new THREE.LineBasicMaterial({
            color: 0x22d3ee,
            transparent: true,
            opacity: focusedOverlay === OVERLAYS.CLARITY ? 0.95 : 0.15
          })
        );

        roomGroup.add(beam);
      });

      // 2️⃣ Clarity time window (listener bubble)
      const clarityRadius = 0.8; // visual proxy for ~20ms window

      const clarityBubble = new THREE.Mesh(
        new THREE.SphereGeometry(clarityRadius, 32, 32),
        new THREE.MeshBasicMaterial({
          color: 0x22d3ee,
          transparent: true,
          opacity: focusedOverlay === OVERLAYS.CLARITY ? 0.35 : 0.05,
          depthWrite: false
        })
      );

      clarityBubble.position.copy(listenerPos);
      roomGroup.add(clarityBubble);

      // 3️⃣ Early reflection example (side walls)
      const wallX = room.width_m / 2;

      [-1, 1].forEach(side => {

        const speakerPos = new THREE.Vector3(
          side * room.spk_spacing_m / 2,
          speakerY,
          -room.length_m / 2 + room.spk_front_m
        );

        const bounce = new THREE.Vector3(
          side * wallX,
          speakerY,
          0
        );

        const reflectionEnd = listenerPos.clone();

        const hitsBubble =
          bounce.distanceTo(listenerPos) < clarityRadius * 1.4;

        const reflection = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            speakerPos,
            bounce,
            reflectionEnd
          ]),
          new THREE.LineDashedMaterial({
            color: hitsBubble ? 0xff3b3b : 0x22d3ee,
            dashSize: 0.25,
            gapSize: 0.15,
            transparent: true,
            opacity: focusedOverlay === OVERLAYS.CLARITY ? 0.85 : 0.08

          })
        );

        reflection.computeLineDistances();
        roomGroup.add(reflection);
      });
    }

  }

  /* ------------------------------------------
     START
  ------------------------------------------ */
  console.log("[Room3D] 🚀 Starting engine");
  rebuild();
  animate();

  /* ------------------------------------------
     PUBLIC API
  ------------------------------------------ */
  return {
    update: rebuild,

    setMode(newMode) {
      console.log("[Room3D] 🔄 setMode()", newMode);

      currentMode = newMode;

      if (newMode === "analysing") {
        analysisStart = performance.now();
        analysisPulse = 0;
        console.log("[Room3D] ▶ analysisStart =", analysisStart);
      }

      if (newMode === "final") {
        // default dashboard overlays
        activeOverlays.clear();
        activeOverlays.add(OVERLAYS.FLOOR_REFLECTION);
        activeOverlays.add(OVERLAYS.SBIR);
        activeOverlays.add(OVERLAYS.SIDE_REFLECTIONS);
        activeOverlays.add(OVERLAYS.REAR_ENERGY);
        activeOverlays.add(OVERLAYS.COFFEE_TABLE);
        activeOverlays.add(OVERLAYS.CLARITY);

      }

      rebuild();
    },

    setStage(newStage) {
      console.log("[Room3D] 🎭 setStage()", newStage);
      renderStage = newStage;
      rebuild();
    },

    resetView() {
      console.log("[Room3D] 🔄 resetView()");

      focusedOverlay = null;
      activeOverlays.clear();

      rebuild();
    },

    // -------------------------------
    // ANALYSIS OVERLAY CONTROL
    // -------------------------------
    /* ------------------------------------------
      DIAGNOSTIC API (Updated)
    ------------------------------------------ */
    setOverlay(id, enabled = true, severity = 'info') {
      if (enabled) {
        activeOverlays.add(id);
      } else {
        activeOverlays.delete(id);
      }
      
      
      rebuild();
    },

    focusIssue(id, score = 10) {
      console.log("[Room3D] 🎯 focusIssue()", id, "score =", score);

      activeOverlays.clear();
      activeOverlays.add(id);

      focusedOverlay = id;
      activeScore = score;

      rebuild();
    }

  };

}