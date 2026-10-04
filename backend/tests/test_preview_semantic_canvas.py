import pytest
from pathlib import Path
from app.api.preview import verify_workspace_preview


def test_single_green_cube_detected_as_minimal_stub(tmp_path):
    """
    Verifies that the canonical Three.js 'Hello World' single-cube template
    without lighting, controls, or UI is detected as a minimal_canvas_stub.
    """
    index_html = tmp_path / "index.html"
    index_html.write_text(
        """<!DOCTYPE html>
<html>
<head>
  <title>3D Warehouse App</title>
  <style>body { margin: 0; } canvas { display: block; width: 100vw; height: 100vh; }</style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>
<body>
  <canvas id="c"></canvas>
  <script>
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') });
    
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);
    
    camera.position.z = 5;
    function animate() {
      requestAnimationFrame(animate);
      cube.rotation.x += 0.01;
      cube.rotation.y += 0.01;
      renderer.render(scene, camera);
    }
    animate();
  </script>
</body>
</html>""",
        encoding="utf-8"
    )

    res = verify_workspace_preview(tmp_path)
    assert res["status"] == "minimal_canvas_stub"
    assert any("Canvas Semantic Incompleteness" in iss for iss in res.get("issues", []))
    assert "OrbitControls" in res["recommendation"] or "lighting" in res["recommendation"]


def test_complete_3d_warehouse_passes_verification(tmp_path):
    """
    Verifies that a 3D application with lighting, OrbitControls, multiple geometries,
    and a UI overlay passes preview verification as 'ready'.
    """
    index_html = tmp_path / "index.html"
    index_html.write_text(
        """<!DOCTYPE html>
<html>
<head>
  <title>3D Logistics Warehouse</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
</head>
<body class="bg-slate-900 text-white overflow-hidden">
  <!-- Interactive Dashboard Overlay -->
  <div class="absolute top-4 left-4 z-10 bg-slate-800/90 p-4 rounded-xl border border-slate-700 shadow-xl backdrop-blur">
    <h1 class="text-sm font-bold text-amber-400">Warehouse Digital Twin</h1>
    <div class="text-xs text-slate-300 mt-1">Capacity: 1,420 / 2,000 pallets</div>
    <button id="toggle-filter" class="mt-3 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded text-xs cursor-pointer">
      Filter High-Bay Bays
    </button>
  </div>

  <canvas id="warehouse-canvas" class="w-full h-full block"></canvas>

  <script>
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('warehouse-canvas'), antialias: true });
    
    // Controls
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    
    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(20, 40, 20);
    scene.add(sun);
    
    // Floor
    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    
    // Shelving Racks
    const rackGeo = new THREE.BoxGeometry(2, 10, 20);
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x475569 });
    const rack = new THREE.Mesh(rackGeo, rackMat);
    scene.add(rack);

    // Interactive Button Wiring
    document.getElementById('toggle-filter').addEventListener('click', () => {
      console.log('Filtered bays');
    });
    
    camera.position.set(30, 20, 30);
    controls.update();

    function renderLoop() {
      requestAnimationFrame(renderLoop);
      controls.update();
      renderer.render(scene, camera);
    }
    renderLoop();
  </script>
</body>
</html>""",
        encoding="utf-8"
    )

    res = verify_workspace_preview(tmp_path)
    assert res["status"] == "ready"
    assert not res.get("issues")


def test_standard_react_or_html_dashboard_passes(tmp_path):
    """
    Verifies that non-3D web applications continue to pass cleanly as 'ready'.
    """
    index_html = tmp_path / "index.html"
    index_html.write_text(
        """<!DOCTYPE html>
<html>
<head>
  <title>Analytics Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-white p-8">
  <div class="max-w-4xl mx-auto">
    <h1 class="text-xl font-bold">Logistics Command Center</h1>
    <button id="refresh-btn" class="mt-4 px-4 py-2 bg-indigo-600 rounded">Refresh Metrics</button>
  </div>
  <script>
    document.getElementById('refresh-btn').addEventListener('click', () => {
      alert('Refreshed');
    });
  </script>
</body>
</html>""",
        encoding="utf-8"
    )

    res = verify_workspace_preview(tmp_path)
    assert res["status"] == "ready"
    assert not res.get("issues")
