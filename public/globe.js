// Dotted 3D globe (three.js r128 + topojson land) with a home pin and optional arcs out to other places.
// mountGlobe(el, options) — el must have a size. Colours come from options so each skin can theme it.
(function () {
  const LAND = "/vendor/land-110m.json";

  function vec(lat, lon, r) {
    const phi = ((90 - lat) * Math.PI) / 180, theta = ((lon + 180) * Math.PI) / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }

  async function landMask() {
    const topo = await fetch(LAND).then((r) => r.json());
    const land = topojson.feature(topo, topo.objects.land);
    const W = 1440, H = 720, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    const draw = (poly) => {
      ctx.beginPath();
      for (const ring of poly) ring.forEach(([lon, lat], i) => {
        const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.fill("evenodd");
    };
    for (const f of land.features) {
      const g = f.geometry;
      if (g.type === "Polygon") draw(g.coordinates);
      else if (g.type === "MultiPolygon") g.coordinates.forEach(draw);
    }
    const px = ctx.getImageData(0, 0, W, H).data;
    return (lat, lon) => {
      const x = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W)), y = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
      return px[(y * W + x) * 4 + 3] > 0;
    };
  }

  window.mountGlobe = async function (el, opt) {
    const o = Object.assign(
      { dot: "#2563eb", dotSize: 0.016, sea: "#ffffff", seaOpacity: 0.0, rim: "#93c5fd", pin: "#f97316", arc: "#0d9488",
        home: { lat: 52.52, lon: 13.4 }, arcs: [], step: 1.5, tilt: 0.55, zoom: 3.3 },
      opt || {},
    );
    const HOME = o.home;
    const W = el.clientWidth, H = el.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
    camera.position.z = o.zoom;
    const globe = new THREE.Group();
    scene.add(globe);

    if (o.seaOpacity > 0)
      globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.985, 64, 64), new THREE.MeshBasicMaterial({ color: o.sea, transparent: true, opacity: o.seaOpacity })));
    // rim glow: a slightly larger back-face sphere
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 64),
      new THREE.MeshBasicMaterial({ color: o.rim, transparent: true, opacity: 0.12, side: THREE.BackSide })));

    const isLand = await landMask();
    const pts = [];
    for (let lat = -78; lat <= 82; lat += o.step) {
      const n = Math.max(1, Math.floor((360 * Math.cos((lat * Math.PI) / 180)) / o.step));
      for (let i = 0; i < n; i++) {
        const lon = -180 + (360 / n) * i;
        if (isLand(lat, lon)) pts.push(vec(lat, lon, 1));
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    globe.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: o.dot, size: o.dotSize, transparent: true, opacity: 0.9 })));

    // home pin + pulse ring
    const home = vec(HOME.lat, HOME.lon, 1.0);
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 24), new THREE.MeshBasicMaterial({ color: o.pin }));
    pin.position.copy(home);
    globe.add(pin);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.055, 48), new THREE.MeshBasicMaterial({ color: o.pin, transparent: true, side: THREE.DoubleSide }));
    ring.position.copy(vec(HOME.lat, HOME.lon, 1.002));
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    globe.add(ring);

    // arcs (grow, hold, restart)
    const arcs = o.arcs.map((t) => {
      const a = home, b = vec(t.lat, t.lon, 1);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.normalize().multiplyScalar(1 + a.distanceTo(b) * 0.55);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(80));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: o.arc, transparent: true, opacity: 0.9 }));
      g.setDrawRange(0, 0);
      globe.add(line);
      const end = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 16), new THREE.MeshBasicMaterial({ color: o.arc }));
      end.position.copy(b);
      globe.add(end);
      return g;
    });

    // turn the home pin towards the camera
    const baseY = -Math.atan2(home.x, home.z);
    globe.rotation.x = ((HOME.lat * Math.PI) / 180) * o.tilt;
    let t0 = performance.now();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    (function frame(now) {
      const t = (now - t0) / 1000;
      globe.rotation.y = baseY + (reduce ? 0 : Math.sin(t * 0.18) * 0.45);
      const s = 1 + ((t * 0.8) % 1) * 1.6;
      ring.scale.set(s, s, s);
      ring.material.opacity = 1 - ((t * 0.8) % 1);
      const p = (t % 4) / 2.4;
      arcs.forEach((g) => g.setDrawRange(0, Math.floor(Math.min(1, p) * 81)));
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    })(t0);
    new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }).observe(el);
  };
})();
