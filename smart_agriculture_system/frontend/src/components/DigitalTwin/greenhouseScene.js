/**
 * 温室数字孪生三维场景
 * 纯 Three.js 程序化建模，不依赖外部模型文件。
 * 对外接口：setEnvironment / setDevices / focus / resetView / setAutoRotate / pause / resume / dispose
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// ---------- 场景尺寸（单位：米） ----------
const HALF_W = 7          // 跨度一半
const WALL_H = 4          // 侧墙高度
const RISE = 3.2          // 拱顶矢高
const LEN = 24            // 长度
const HALF_LEN = LEN / 2

export const DEVICE_KEYS = [
  'external_fan',
  'internal_fan',
  'skylight',
  'spray',
  'water_curtain',
  'light'
]

const DEFAULT_VIEW = {
  position: new THREE.Vector3(21, 14.2, 24.5),
  target: new THREE.Vector3(0, 3, 0)
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

// 简易可复现随机数
function createRandom(seed = 20260811) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

/** 拱形壳体（玻璃屋面） */
function createArchShell(segments = 56) {
  const positions = []
  const uvs = []
  const indices = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI
    const x = Math.cos(t) * HALF_W
    const y = WALL_H + Math.sin(t) * RISE
    positions.push(x, y, -HALF_LEN, x, y, HALF_LEN)
    uvs.push(i / segments, 0, i / segments, 1)
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/** 拱形曲线 */
function createArchCurve(segments = 40) {
  const points = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI
    points.push(new THREE.Vector3(Math.cos(t) * HALF_W, WALL_H + Math.sin(t) * RISE, 0))
  }
  return new THREE.CatmullRomCurve3(points)
}

/** 端墙轮廓（含拱顶） */
function createGableShape() {
  const shape = new THREE.Shape()
  shape.moveTo(-HALF_W, 0)
  shape.lineTo(HALF_W, 0)
  shape.lineTo(HALF_W, WALL_H)
  const segments = 32
  for (let i = 1; i <= segments; i++) {
    const t = (i / segments) * Math.PI
    shape.lineTo(Math.cos(t) * HALF_W, WALL_H + Math.sin(t) * RISE)
  }
  shape.lineTo(-HALF_W, 0)
  return shape
}

/** 水帘纹理（竖条纹 + 水波） */
function createCurtainTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#d6ecf6'
  ctx.fillRect(0, 0, 64, 128)
  for (let x = 0; x < 64; x += 4) {
    ctx.fillStyle = `rgba(118,178,208,${0.22 + Math.random() * 0.3})`
    ctx.fillRect(x, 0, 2, 128)
  }
  for (let y = 0; y < 128; y += 8) {
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.fillRect(0, y, 64, 1)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export default class GreenhouseScene {
  constructor(container, options = {}) {
    this.container = container
    this.options = options

    this.scene = null
    this.camera = null
    this.renderer = null
    this.controls = null
    this.clock = new THREE.Clock()

    this.size = { w: container.clientWidth || 960, h: container.clientHeight || 560 }
    this.elapsed = 0
    this.running = false
    this.disposed = false
    this.rafId = 0

    this.onFrame = null
    this.onAutoRotateChange = null

    // 当前值 / 目标值（用于平滑过渡）
    this.cur = {
      temperature: 24,
      humidity: 60,
      light: 12000,
      co2: 600,
      soilMoisture: 45,
      soilTemperature: 20,
      devices: DEVICE_KEYS.reduce((acc, k) => ((acc[k] = 0), acc), {})
    }
    this.target = JSON.parse(JSON.stringify(this.cur))

    this.anchors = {}
    this.tween = null
    this._proj = new THREE.Vector3()
    this._color = new THREE.Color()
    this._colorCold = new THREE.Color(0x4a90e2)
    this._colorMid = new THREE.Color(0x63c98a)
    this._colorHot = new THREE.Color(0xf56c6c)
    this._rand = createRandom()

    this.groups = {}
    this.fans = []
    this.vents = []
    this.lamps = []
    this.particles = {}

    try {
      this.initRenderer()
      this.initScene()
      this.build()
      this.bindEvents()
      this.start()
    } catch (error) {
      console.error('[DigitalTwin] 三维场景初始化失败:', error)
      throw error
    }
  }

  // ---------------- 基础环境 ----------------
  initRenderer() {
    const { w, h } = this.size
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.container.appendChild(this.renderer.domElement)
  }

  initScene() {
    const { w, h } = this.size
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xe9f1f7, 62, 150)

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 400)
    this.camera.position.copy(DEFAULT_VIEW.position)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.copy(DEFAULT_VIEW.target)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.075
    this.controls.rotateSpeed = 0.75
    this.controls.zoomSpeed = 0.8
    this.controls.enablePan = true
    this.controls.minDistance = 9
    this.controls.maxDistance = 52
    this.controls.minPolarAngle = 0.25
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0.55
    this.controls.update()

    // 光照
    this.hemi = new THREE.HemisphereLight(0xf2fbff, 0xd9e4ea, 0.55)
    this.scene.add(this.hemi)

    this.ambient = new THREE.AmbientLight(0xffffff, 0.2)
    this.scene.add(this.ambient)

    this.sun = new THREE.DirectionalLight(0xfff6e6, 2.1)
    this.sun.position.set(20, 26, 14)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 90
    this.sun.shadow.camera.left = -26
    this.sun.shadow.camera.right = 26
    this.sun.shadow.camera.top = 26
    this.sun.shadow.camera.bottom = -26
    this.sun.shadow.bias = -0.0008
    this.sun.shadow.normalBias = 0.02
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    this.fill = new THREE.DirectionalLight(0xd8ecff, 0.35)
    this.fill.position.set(-18, 12, -16)
    this.scene.add(this.fill)

    this.indoorLight = new THREE.PointLight(0xffe9b8, 0, 26, 2)
    this.indoorLight.position.set(0, 5.2, 0)
    this.scene.add(this.indoorLight)

    this.initEnvironment()
  }

  /** 生成天空渐变环境贴图，避免玻璃在掠射角发黑 */
  initEnvironment() {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, 0, 64)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.38, '#eef7fd')
    grad.addColorStop(0.55, '#dceaf3')
    grad.addColorStop(1, '#c6d6e1')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 16, 64)

    const texture = new THREE.CanvasTexture(canvas)
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.SRGBColorSpace

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const envMap = pmrem.fromEquirectangular(texture).texture
    this.scene.environment = envMap
    this.envMap = envMap

    texture.dispose()
    pmrem.dispose()
  }

  // ---------------- 建模 ----------------
  build() {
    this.buildGround()
    this.buildGreenhouse()
    this.buildBeds()
    this.buildDevices()
    this.buildSensors()
    this.buildEffects()
    this.buildSurroundings()
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color: 0xdde8f0, roughness: 1, metalness: 0 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.32
    ground.receiveShadow = true
    this.scene.add(ground)

    const grid = new THREE.GridHelper(90, 90, 0xb9cddb, 0xd2e0ea)
    grid.position.y = -0.3
    grid.material.transparent = true
    grid.material.opacity = 0.7
    this.scene.add(grid)

    // 环形基座
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(15, 15, 0.12, 64),
      new THREE.MeshStandardMaterial({ color: 0xeaf1f6, roughness: 0.95 })
    )
    plinth.position.y = -0.25
    plinth.receiveShadow = true
    this.scene.add(plinth)
  }

  buildGreenhouse() {
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xdaf0fb,
      transparent: true,
      opacity: 0.24,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    this.glassMaterial = glass

    const steel = new THREE.MeshStandardMaterial({
      color: 0xa9b7c2,
      metalness: 0.72,
      roughness: 0.35
    })
    this.steelMaterial = steel

    const concrete = new THREE.MeshStandardMaterial({ color: 0xd3dbe1, roughness: 0.95 })

    // 基座
    const base = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 0.5, 0.3, LEN + 0.5), concrete)
    base.position.y = -0.15
    base.receiveShadow = true
    base.castShadow = true
    this.scene.add(base)

    // 室内地面
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(HALF_W * 2 - 0.3, 0.06, LEN - 0.3),
      new THREE.MeshStandardMaterial({ color: 0x8c7053, roughness: 1 })
    )
    floor.position.y = 0.03
    floor.receiveShadow = true
    this.scene.add(floor)
    this.floorMaterial = floor.material

    // 中央步道
    const path = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 0.05, LEN - 1),
      new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 1 })
    )
    path.position.y = 0.07
    path.receiveShadow = true
    this.scene.add(path)

    // 玻璃屋面
    const roof = new THREE.Mesh(createArchShell(56), glass)
    roof.renderOrder = 2
    this.scene.add(roof)
    this.roof = roof

    // 侧墙玻璃
    const wallGeo = new THREE.PlaneGeometry(LEN, WALL_H)
    const wallMat = glass.clone()
    wallMat.opacity = 0.18
    ;[-1, 1].forEach((sign) => {
      const wall = new THREE.Mesh(wallGeo, wallMat)
      wall.rotation.y = Math.PI / 2
      wall.position.set(sign * HALF_W, WALL_H / 2, 0)
      wall.renderOrder = 2
      this.scene.add(wall)
    })

    // 端墙玻璃
    const gableGeo = new THREE.ShapeGeometry(createGableShape(), 32)
    ;[-1, 1].forEach((sign) => {
      const gable = new THREE.Mesh(gableGeo, wallMat)
      gable.position.z = sign * HALF_LEN
      gable.renderOrder = 2
      this.scene.add(gable)
    })

    // 拱形骨架
    const archCurve = createArchCurve(40)
    const ribGeo = new THREE.TubeGeometry(archCurve, 64, 0.055, 6, false)
    const ribPositions = []
    for (let z = -HALF_LEN; z <= HALF_LEN + 0.001; z += 2) ribPositions.push(z)
    const ribs = new THREE.InstancedMesh(ribGeo, steel, ribPositions.length)
    const dummy = new THREE.Object3D()
    ribPositions.forEach((z, i) => {
      dummy.position.set(0, 0, z)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      ribs.setMatrixAt(i, dummy.matrix)
    })
    ribs.castShadow = true
    this.scene.add(ribs)

    // 纵向檩条
    const purlinAngles = [Math.PI * 0.17, Math.PI * 0.33, Math.PI * 0.5, Math.PI * 0.67, Math.PI * 0.83]
    purlinAngles.forEach((t) => {
      const x = Math.cos(t) * HALF_W
      const y = WALL_H + Math.sin(t) * RISE
      const purlin = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, LEN, 6), steel)
      purlin.rotation.x = Math.PI / 2
      purlin.position.set(x, y, 0)
      purlin.castShadow = true
      this.scene.add(purlin)
    })

    // 四角立柱 + 檐口横梁
    ;[-1, 1].forEach((sx) => {
      ;[-1, 1].forEach((sz) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, WALL_H, 0.16), steel)
        post.position.set(sx * HALF_W, WALL_H / 2, sz * HALF_LEN)
        post.castShadow = true
        this.scene.add(post)
      })
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, LEN), steel)
      beam.position.set(sx * HALF_W, WALL_H, 0)
      beam.castShadow = true
      this.scene.add(beam)
    })

    // 端墙横梁
    ;[-1, 1].forEach((sz) => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 0.1, 0.1), steel)
      beam.position.set(0, WALL_H, sz * HALF_LEN)
      this.scene.add(beam)
    })
  }

  buildBeds() {
    const rand = this._rand
    const bedXs = [-4.8, -1.6, 1.6, 4.8]
    const bedWidth = 1.9
    const bedLength = 20
    const rowsPerBed = 2
    const plantsPerRow = 26
    const plantCount = bedXs.length * rowsPerBed * plantsPerRow

    this.soilMaterial = new THREE.MeshStandardMaterial({ color: 0x6d5039, roughness: 1 })

    bedXs.forEach((x) => {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(bedWidth, 0.42, bedLength), this.soilMaterial)
      bed.position.set(x, 0.21, 0)
      bed.castShadow = true
      bed.receiveShadow = true
      this.scene.add(bed)

      // 灌溉支管
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, bedLength, 8),
        new THREE.MeshStandardMaterial({ color: 0x4c5b66, roughness: 0.6, metalness: 0.3 })
      )
      pipe.rotation.x = Math.PI / 2
      pipe.position.set(x, 0.46, 0)
      this.scene.add(pipe)
    })

    // 植物（实例化）
    const stemGeo = new THREE.CylinderGeometry(0.028, 0.038, 0.42, 5)
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f7d43, roughness: 0.9 })
    const leafGeo = new THREE.IcosahedronGeometry(0.3, 1)
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true })

    const stems = new THREE.InstancedMesh(stemGeo, stemMat, plantCount)
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, plantCount)
    leaves.castShadow = true
    stems.castShadow = true

    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    let index = 0
    bedXs.forEach((bx) => {
      for (let r = 0; r < rowsPerBed; r++) {
        const rx = bx + (r === 0 ? -0.45 : 0.45)
        for (let p = 0; p < plantsPerRow; p++) {
          const z = -bedLength / 2 + 0.6 + p * ((bedLength - 1.2) / (plantsPerRow - 1))
          const jitterX = (rand() - 0.5) * 0.18
          const jitterZ = (rand() - 0.5) * 0.18
          const scale = 0.85 + rand() * 0.45

          dummy.position.set(rx + jitterX, 0.42 + 0.21 * scale, z + jitterZ)
          dummy.rotation.set(0, rand() * Math.PI, 0)
          dummy.scale.set(scale, scale, scale)
          dummy.updateMatrix()
          stems.setMatrixAt(index, dummy.matrix)

          dummy.position.set(rx + jitterX, 0.42 + 0.62 * scale, z + jitterZ)
          dummy.rotation.set(rand() * 0.4, rand() * Math.PI, rand() * 0.3)
          dummy.scale.set(scale * (0.9 + rand() * 0.35), scale * (0.75 + rand() * 0.25), scale * (0.9 + rand() * 0.35))
          dummy.updateMatrix()
          leaves.setMatrixAt(index, dummy.matrix)

          color.setHSL(0.28 + rand() * 0.07, 0.42 + rand() * 0.18, 0.36 + rand() * 0.14)
          leaves.setColorAt(index, color)

          index += 1
        }
      }
    })
    this.scene.add(stems)
    this.scene.add(leaves)
  }

  /** 风扇 */
  createFan(radius = 0.62) {
    const group = new THREE.Group()
    const housingMat = new THREE.MeshStandardMaterial({ color: 0xc9d4dc, metalness: 0.35, roughness: 0.5 })
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(radius + 0.08, radius + 0.08, 0.14, 28, 1, true),
      housingMat
    )
    housing.rotation.x = Math.PI / 2
    housing.castShadow = true
    group.add(housing)

    // 背板（提升叶片辨识度）
    const backing = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.99, 26),
      new THREE.MeshStandardMaterial({ color: 0x71818d, roughness: 0.9, metalness: 0.1, side: THREE.DoubleSide })
    )
    backing.position.z = -0.07
    group.add(backing)

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.045, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0x8b98a4, metalness: 0.6, roughness: 0.4 })
    )
    group.add(ring)

    const rotor = new THREE.Group()
    const bladeGeo = new THREE.BoxGeometry(radius * 0.92, radius * 0.32, 0.035)
    bladeGeo.translate(radius * 0.5, 0, 0)
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xf4f8fb,
      metalness: 0.1,
      roughness: 0.45,
      emissive: new THREE.Color(0x9aa8b3),
      emissiveIntensity: 0.35
    })
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat)
      blade.rotation.z = (i * Math.PI) / 2
      blade.rotation.y = 0.32
      blade.castShadow = true
      rotor.add(blade)
    }
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0x5d6b77, metalness: 0.7, roughness: 0.35 })
    )
    hub.rotation.x = Math.PI / 2
    rotor.add(hub)
    group.add(rotor)
    group.userData.rotor = rotor

    // 防护网圈
    const guardMat = new THREE.MeshStandardMaterial({ color: 0xb5c2cc, metalness: 0.4, roughness: 0.45 })
    ;[0.45, 0.85].forEach((k) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * k, 0.012, 6, 26), guardMat)
      ring.position.z = 0.1
      group.add(ring)
    })

    return group
  }

  buildDevices() {
    const steel = this.steelMaterial

    // ---- 外通风（后墙两台）----
    this.groups.externalFan = new THREE.Group()
    const mountMat = new THREE.MeshStandardMaterial({ color: 0xd7dfe6, metalness: 0.3, roughness: 0.55 })
    ;[-3.2, 3.2].forEach((x) => {
      const fan = this.createFan(0.62)
      fan.position.set(x, 2.6, -HALF_LEN + 0.18)
      this.groups.externalFan.add(fan)
      this.fans.push({ rotor: fan.userData.rotor, key: 'external_fan' })

      // 安装框（细边框，避免大面积深色板）
      const barH = new THREE.BoxGeometry(1.7, 0.08, 0.08)
      const barV = new THREE.BoxGeometry(0.08, 1.7, 0.08)
      ;[0.85, -0.85].forEach((dy) => {
        const bar = new THREE.Mesh(barH, mountMat)
        bar.position.set(x, 2.6 + dy, -HALF_LEN + 0.12)
        this.groups.externalFan.add(bar)
      })
      ;[0.85, -0.85].forEach((dx) => {
        const bar = new THREE.Mesh(barV, mountMat)
        bar.position.set(x + dx, 2.6, -HALF_LEN + 0.12)
        this.groups.externalFan.add(bar)
      })
    })
    this.scene.add(this.groups.externalFan)

    // ---- 内通风（吊装两台）----
    this.groups.internalFan = new THREE.Group()
    ;[-2.4, 2.4].forEach((x, i) => {
      const fan = this.createFan(0.5)
      const z = i === 0 ? 3 : -3
      fan.position.set(x, 3.15, z)
      this.groups.internalFan.add(fan)
      this.fans.push({ rotor: fan.userData.rotor, key: 'internal_fan' })

      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 6), steel)
      rod.position.set(x, 4.1, z)
      this.groups.internalFan.add(rod)
    })
    this.scene.add(this.groups.internalFan)

    // ---- 天窗（屋脊两侧可开启通风窗）----
    this.groups.skylight = new THREE.Group()
    const ventMat = new THREE.MeshPhysicalMaterial({
      color: 0xdcefff,
      transparent: true,
      opacity: 0.72,
      roughness: 0.35,
      metalness: 0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
      emissive: new THREE.Color(0x9ecfe6),
      emissiveIntensity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    const ventFrameMat = new THREE.MeshStandardMaterial({ color: 0x7c8d9a, metalness: 0.6, roughness: 0.42 })
    ;[-5, 5].forEach((z) => {
      const hinge = new THREE.Group()
      hinge.position.set(0, WALL_H + RISE + 0.03, z)
      hinge.rotation.z = -0.075

      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 4.2), ventMat)
      panel.position.set(1.1, 0, 0)
      hinge.add(panel)

      // 窗框
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.1), ventFrameMat)
      edge.position.set(1.1, 0.03, 2.1)
      hinge.add(edge)
      const edge2 = edge.clone()
      edge2.position.z = -2.1
      hinge.add(edge2)
      const edge3 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 4.2), ventFrameMat)
      edge3.position.set(2.2, 0.03, 0)
      hinge.add(edge3)

      // 中挺横撑
      for (let mz = -0.7; mz <= 0.71; mz += 1.4) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.07, 0.06), ventFrameMat)
        mullion.position.set(1.1, 0.03, mz)
        hinge.add(mullion)
      }

      hinge.userData.closed = -0.075
      hinge.userData.open = 0.72
      this.groups.skylight.add(hinge)
      this.vents.push(hinge)
    })
    this.scene.add(this.groups.skylight)

    // ---- 喷灌系统 ----
    this.groups.spray = new THREE.Group()
    const mainPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, LEN - 1.5, 10),
      new THREE.MeshStandardMaterial({ color: 0xd2dce3, metalness: 0.35, roughness: 0.45 })
    )
    mainPipe.rotation.x = Math.PI / 2
    mainPipe.position.set(0, WALL_H + RISE - 0.55, 0)
    this.groups.spray.add(mainPipe)

    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x5f7180, metalness: 0.7, roughness: 0.35 })
    this.nozzlePositions = []
    for (let z = -9; z <= 9; z += 3) {
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 10), nozzleMat)
      nozzle.rotation.x = Math.PI
      nozzle.position.set(0, WALL_H + RISE - 0.72, z)
      this.groups.spray.add(nozzle)
      this.nozzlePositions.push(z)
    }
    this.scene.add(this.groups.spray)

    // ---- 水帘 ----
    this.groups.curtain = new THREE.Group()
    const curtainTexture = createCurtainTexture()
    this.curtainTexture = curtainTexture
    this.curtainMaterial = new THREE.MeshStandardMaterial({
      map: curtainTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      roughness: 0.7,
      metalness: 0.02,
      side: THREE.DoubleSide
    })
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 3.3, 1, 1), this.curtainMaterial)
    curtain.rotation.y = -Math.PI / 2
    curtain.position.set(HALF_W - 0.12, 1.9, 0)
    this.groups.curtain.add(curtain)
    this.curtainMesh = curtain

    // 边框（四根细梁，避免遮挡帘体）
    const frameBars = [
      [0.06, 0.08, 9.9, HALF_W - 0.08, 3.60, 0],
      [0.06, 0.08, 9.9, HALF_W - 0.08, 0.22, 0],
      [0.06, 3.5, 0.07, HALF_W - 0.08, 1.9, 4.93],
      [0.06, 3.5, 0.07, HALF_W - 0.08, 1.9, -4.93]
    ]
    frameBars.forEach(([sx, sy, sz, px, py, pz]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), steel)
      bar.position.set(px, py, pz)
      this.groups.curtain.add(bar)
    })
    this.scene.add(this.groups.curtain)

    // ---- 补光灯 ----
    this.groups.lamp = new THREE.Group()
    const lampZ = [-7.5, -2.5, 2.5, 7.5]
    this.lampBulbs = []
    lampZ.forEach((z) => {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), steel)
      rod.position.set(0, WALL_H + RISE - 1.1, z)
      this.groups.lamp.add(rod)

      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.44, 0.34, 18, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0xe8eef3,
          metalness: 0.5,
          roughness: 0.4,
          side: THREE.DoubleSide
        })
      )
      shade.position.set(0, WALL_H + RISE - 2.3, z)
      this.groups.lamp.add(shade)

      const bulbMat = new THREE.MeshStandardMaterial({
        color: 0xfff3d0,
        emissive: new THREE.Color(0xffd98a),
        emissiveIntensity: 0.15,
        roughness: 0.3
      })
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), bulbMat)
      bulb.position.set(0, WALL_H + RISE - 2.48, z)
      this.groups.lamp.add(bulb)
      this.lampBulbs.push(bulbMat)
    })
    this.scene.add(this.groups.lamp)
  }

  buildSensors() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8e9ba6, metalness: 0.5, roughness: 0.5 })
    const makeStation = (x, y, z, color) => {
      const group = new THREE.Group()
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, y, 6), poleMat)
      pole.position.set(x, y / 2, z)
      group.add(pole)

      const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.2), poleMat)
      box.position.set(x, y, z)
      box.castShadow = true
      group.add(box)

      const dotMat = new THREE.MeshStandardMaterial({
        color,
        emissive: new THREE.Color(color),
        emissiveIntensity: 1.1,
        roughness: 0.3
      })
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), dotMat)
      dot.position.set(x, y + 0.16, z)
      group.add(dot)
      this.scene.add(group)
      return group
    }

    makeStation(0, 2.15, 0, 0xff8a65)
    makeStation(-5.6, 1.75, 7, 0x7cc3f0)
    makeStation(2.6, 1.35, 5.4, 0x9ccc65)
    makeStation(0, WALL_H + RISE - 1.15, -7.6, 0xffd54f)

    // 标注锚点
    this.anchors['sensor-air'] = new THREE.Vector3(0, 2.62, 0)
    this.anchors['sensor-co2'] = new THREE.Vector3(-5.6, 2.24, 7)
    this.anchors['sensor-soil'] = new THREE.Vector3(2.6, 1.86, 5.4)
    this.anchors['sensor-light'] = new THREE.Vector3(0, WALL_H + RISE - 0.82, -7.6)

    this.anchors['device-external_fan'] = new THREE.Vector3(-3.2, 3.6, -HALF_LEN + 0.3)
    this.anchors['device-internal_fan'] = new THREE.Vector3(2.4, 3.95, -3)
    this.anchors['device-skylight'] = new THREE.Vector3(1.6, WALL_H + RISE + 0.5, 5)
    this.anchors['device-spray'] = new THREE.Vector3(0, WALL_H + RISE - 0.35, 9)
    this.anchors['device-water_curtain'] = new THREE.Vector3(HALF_W - 0.2, 3.9, 0)
    this.anchors['device-light'] = new THREE.Vector3(0, WALL_H + RISE - 2.7, 7.5)
  }

  buildEffects() {
    // 温度环（数字孪生视觉标识）
    this.climateRing = new THREE.Mesh(
      new THREE.TorusGeometry(14.2, 0.05, 8, 140),
      new THREE.MeshBasicMaterial({ color: 0x409eff, transparent: true, opacity: 0.85 })
    )
    this.climateRing.rotation.x = -Math.PI / 2
    this.climateRing.position.y = 0.02
    this.scene.add(this.climateRing)

    this.climateRingGlow = new THREE.Mesh(
      new THREE.RingGeometry(13.95, 14.55, 96),
      new THREE.MeshBasicMaterial({
        color: 0x409eff,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    this.climateRingGlow.rotation.x = -Math.PI / 2
    this.climateRingGlow.position.y = 0.015
    this.scene.add(this.climateRingGlow)

    // 扫描弧
    this.scanArc = new THREE.Mesh(
      new THREE.TorusGeometry(14.2, 0.09, 8, 48, Math.PI / 2.6),
      new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.9 })
    )
    this.scanArc.rotation.x = -Math.PI / 2
    this.scanArc.position.y = 0.05
    this.scene.add(this.scanArc)

    // 室内雾气（湿度可视化）
    const mistCount = 260
    const mistGeo = new THREE.BufferGeometry()
    const mistPos = new Float32Array(mistCount * 3)
    this.mistData = []
    for (let i = 0; i < mistCount; i++) {
      const x = (Math.random() - 0.5) * (HALF_W * 2 - 1)
      const y = 0.3 + Math.random() * (WALL_H + RISE - 1)
      const z = (Math.random() - 0.5) * (LEN - 1)
      mistPos.set([x, y, z], i * 3)
      this.mistData.push({ speed: 0.06 + Math.random() * 0.12, offset: Math.random() * Math.PI * 2 })
    }
    mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3))
    this.mistMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.16,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true
    })
    this.mist = new THREE.Points(mistGeo, this.mistMaterial)
    this.scene.add(this.mist)

    // 喷灌水滴
    const dropCount = 700
    const dropGeo = new THREE.BufferGeometry()
    const dropPos = new Float32Array(dropCount * 3)
    this.dropData = []
    for (let i = 0; i < dropCount; i++) {
      const nz = this.nozzlePositions[Math.floor(Math.random() * this.nozzlePositions.length)]
      const x = (Math.random() - 0.5) * 0.5
      const z = nz + (Math.random() - 0.5) * 0.5
      const y = WALL_H + RISE - 0.8 - Math.random() * 6
      dropPos.set([x, y, z], i * 3)
      this.dropData.push({
        vx: (Math.random() - 0.5) * 0.35,
        vz: (Math.random() - 0.5) * 0.35,
        vy: 1.6 + Math.random() * 1.6,
        nx: (Math.random() - 0.5) * 0.35,
        nz
      })
    }
    dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3))
    this.dropMaterial = new THREE.PointsMaterial({
      color: 0x69b9ee,
      size: 0.075,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    })
    this.drops = new THREE.Points(dropGeo, this.dropMaterial)
    this.drops.visible = false
    this.scene.add(this.drops)

    // 水帘滴水
    const dripCount = 140
    const dripGeo = new THREE.BufferGeometry()
    const dripPos = new Float32Array(dripCount * 3)
    this.dripData = []
    for (let i = 0; i < dripCount; i++) {
      const x = HALF_W - 0.2
      const y = Math.random() * 3.4 + 0.2
      const z = (Math.random() - 0.5) * 9.2
      dripPos.set([x, y, z], i * 3)
      this.dripData.push({ speed: 0.6 + Math.random() * 1.1 })
    }
    dripGeo.setAttribute('position', new THREE.BufferAttribute(dripPos, 3))
    this.dripMaterial = new THREE.PointsMaterial({
      color: 0x8fd0ea,
      size: 0.07,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    })
    this.drips = new THREE.Points(dripGeo, this.dripMaterial)
    this.drips.visible = false
    this.scene.add(this.drips)
  }

  buildSurroundings() {
    const rand = this._rand
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4d, roughness: 1 })
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x7fb069, roughness: 0.95, flatShading: true })

    const treePositions = [
      [-16, -14],
      [-19, 6],
      [18, -16],
      [20, 12]
    ]
    treePositions.forEach(([x, z]) => {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 8), trunkMat)
      trunk.position.set(x, 1.3, z)
      trunk.castShadow = true
      this.scene.add(trunk)

      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), leafMat)
      crown.position.set(x, 3.2, z)
      crown.scale.set(1, 0.85, 1)
      crown.castShadow = true
      this.scene.add(crown)
    })

    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + rand() * 0.3
      const radius = 19 + rand() * 6
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 + rand() * 0.4, 0), leafMat)
      bush.position.set(Math.cos(angle) * radius, 0.35, Math.sin(angle) * radius)
      bush.castShadow = true
      this.scene.add(bush)
    }
  }

  // ---------------- 交互 ----------------
  bindEvents() {
    this.handleResize = () => this.resize()
    window.addEventListener('resize', this.handleResize)

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(this.container)
    }

    this.controls.addEventListener('start', () => {
      this.autoRotateBeforeDrag = this.controls.autoRotate
      if (this.controls.autoRotate) {
        this.controls.autoRotate = false
        if (this.onAutoRotateChange) this.onAutoRotateChange(false)
      }
    })
  }

  resize() {
    if (this.disposed || !this.renderer) return
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    if (Math.abs(w - this.size.w) < 1 && Math.abs(h - this.size.h) < 1) return
    this.size = { w, h }
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  start() {
    if (this.running || this.disposed) return
    this.running = true
    this.clock.getDelta()
    this.loop()
  }

  pause() {
    this.running = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  resume() {
    if (this.disposed) return
    this.resize()
    this.start()
  }

  setAutoRotate(enabled) {
    if (!this.controls) return
    this.controls.autoRotate = !!enabled
  }

  resetView() {
    this.animateCamera(DEFAULT_VIEW.position, DEFAULT_VIEW.target)
  }

  focus(key) {
    const views = {
      external_fan: [new THREE.Vector3(-4.2, 4.2, -3.2), new THREE.Vector3(-0.4, 2.6, -11.6)],
      internal_fan: [new THREE.Vector3(-1.5, 5.6, 8.5), new THREE.Vector3(0.4, 3.2, -0.5)],
      skylight: [new THREE.Vector3(13, 12, 13), new THREE.Vector3(1.4, 7, 5)],
      spray: [new THREE.Vector3(-2.6, 4.2, 7), new THREE.Vector3(0, 6.2, 2.5)],
      water_curtain: [new THREE.Vector3(17, 4.6, 3.5), new THREE.Vector3(6.6, 1.9, 0)],
      light: [new THREE.Vector3(5, 3.6, 7), new THREE.Vector3(0, 4.9, 3)]
    }
    const view = views[key]
    if (!view) return
    this.controls.autoRotate = false
    if (this.onAutoRotateChange) this.onAutoRotateChange(false)
    this.animateCamera(view[0], view[1])
  }

  animateCamera(position, target) {
    this.tween = {
      t: 0,
      duration: 0.85,
      fromPos: this.camera.position.clone(),
      toPos: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone()
    }
  }

  project(anchor, out) {
    if (!this.camera) {
      out.visible = false
      return out
    }
    const v = this._proj.copy(anchor).project(this.camera)
    out.x = (v.x * 0.5 + 0.5) * this.size.w
    out.y = (-v.y * 0.5 + 0.5) * this.size.h
    out.visible = v.z < 1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2
    return out
  }

  // ---------------- 数据更新 ----------------
  setEnvironment(data = {}) {
    const num = (v, fallback) => {
      const n = parseFloat(v)
      return Number.isFinite(n) ? n : fallback
    }
    this.target.temperature = clamp(num(data.air_temperature, this.target.temperature), -10, 60)
    this.target.humidity = clamp(num(data.air_humidity, this.target.humidity), 0, 100)
    this.target.light = clamp(num(data.light_intensity, this.target.light), 0, 120000)
    this.target.co2 = clamp(num(data.co2_concentration, this.target.co2), 200, 5000)
    this.target.soilMoisture = clamp(num(data.soil_moisture, this.target.soilMoisture), 0, 100)
    this.target.soilTemperature = clamp(num(data.soil_temperature, this.target.soilTemperature), -10, 60)
  }

  setDevices(map = {}) {
    DEVICE_KEYS.forEach((key) => {
      const raw = map[key]
      const on = raw === true || raw === 1 || raw === '1' || raw === 'open' || raw === 'active' || raw === 'on'
      this.target.devices[key] = on ? 1 : 0
    })
  }

  // ---------------- 循环 ----------------
  loop = () => {
    if (!this.running || this.disposed) return
    this.rafId = requestAnimationFrame(this.loop)

    const dt = Math.min(this.clock.getDelta(), 0.06)
    this.elapsed += dt

    this.updateTween(dt)
    this.updateEnvironment(dt)
    this.updateDevices(dt)
    this.controls.update()

    this.renderer.render(this.scene, this.camera)

    if (this.onFrame) this.onFrame()
  }

  updateTween(dt) {
    if (!this.tween) return
    this.tween.t += dt / this.tween.duration
    const k = easeInOut(Math.min(this.tween.t, 1))
    this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, k)
    this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, k)
    if (this.tween.t >= 1) this.tween = null
  }

  updateEnvironment(dt) {
    const smooth = 1 - Math.exp(-dt * 2.4)
    const cur = this.cur
    const tgt = this.target

    cur.temperature = lerp(cur.temperature, tgt.temperature, smooth)
    cur.humidity = lerp(cur.humidity, tgt.humidity, smooth)
    cur.light = lerp(cur.light, tgt.light, smooth)
    cur.soilMoisture = lerp(cur.soilMoisture, tgt.soilMoisture, smooth)
    cur.soilTemperature = lerp(cur.soilTemperature, tgt.soilTemperature, smooth)

    // 温度 → 环形标识颜色
    const t = clamp((cur.temperature - 8) / (36 - 8), 0, 1)
    if (t < 0.5) {
      this._color.copy(this._colorCold).lerp(this._colorMid, t / 0.5)
    } else {
      this._color.copy(this._colorMid).lerp(this._colorHot, (t - 0.5) / 0.5)
    }
    this.climateRing.material.color.copy(this._color)
    this.climateRingGlow.material.color.copy(this._color)

    // 光照 → 日光强度
    const lux = clamp(cur.light, 0, 80000)
    const lightFactor = clamp(Math.log10(lux + 10) / Math.log10(80010), 0.15, 1)
    this.sun.intensity = 0.75 + lightFactor * 1.9
    this.hemi.intensity = 0.4 + lightFactor * 0.45
    this.glassMaterial.opacity = 0.16 + lightFactor * 0.12

    // 湿度 → 雾气
    const mistOpacity = clamp((cur.humidity - 35) / 65, 0, 1) * 0.32
    this.mistMaterial.opacity = mistOpacity
    if (mistOpacity > 0.01) {
      const positions = this.mist.geometry.attributes.position.array
      for (let i = 0; i < this.mistData.length; i++) {
        const d = this.mistData[i]
        const idx = i * 3 + 1
        positions[idx] += d.speed * dt
        if (positions[idx] > WALL_H + RISE - 0.6) positions[idx] = 0.3
        positions[i * 3] += Math.sin(this.elapsed * 0.6 + d.offset) * 0.0025
      }
      this.mist.geometry.attributes.position.needsUpdate = true
    }

    // 土壤湿度 → 土壤颜色与湿润度
    const wet = clamp(cur.soilMoisture / 100, 0, 1)
    this.soilMaterial.color.setRGB(
      lerp(0.55, 0.36, wet),
      lerp(0.42, 0.26, wet),
      lerp(0.31, 0.2, wet)
    )
    this.soilMaterial.roughness = lerp(1, 0.72, wet)

    // 扫描弧旋转
    this.scanArc.rotation.z += dt * 0.45
  }

  updateDevices(dt) {
    const smooth = 1 - Math.exp(-dt * 5)
    const cur = this.cur.devices
    const tgt = this.target.devices
    DEVICE_KEYS.forEach((key) => {
      cur[key] = lerp(cur[key], tgt[key], smooth)
    })

    // 风扇
    this.fans.forEach(({ rotor, key }) => {
      rotor.rotation.z += dt * 11 * cur[key]
    })

    // 天窗
    this.vents.forEach((vent) => {
      vent.rotation.z = lerp(vent.userData.closed, vent.userData.open, cur.skylight)
    })

    // 喷灌
    const spraying = cur.spray > 0.03
    this.drops.visible = spraying
    if (spraying) {
      const positions = this.drops.geometry.attributes.position.array
      for (let i = 0; i < this.dropData.length; i++) {
        const d = this.dropData[i]
        const idx = i * 3
        positions[idx] += d.vx * dt
        positions[idx + 1] -= d.vy * dt
        positions[idx + 2] += d.vz * dt
        if (positions[idx + 1] < 0.25) {
          positions[idx] = (Math.random() - 0.5) * 0.5
          positions[idx + 1] = WALL_H + RISE - 0.8
          positions[idx + 2] = d.nz + (Math.random() - 0.5) * 0.5
        }
      }
      this.drops.geometry.attributes.position.needsUpdate = true
      this.dropMaterial.opacity = 0.85 * cur.spray
    }

    // 水帘
    this.curtainTexture.offset.y -= dt * 0.55 * cur.water_curtain
    this.curtainMaterial.color.setRGB(
      lerp(0.97, 0.68, cur.water_curtain),
      lerp(0.99, 0.87, cur.water_curtain),
      lerp(1, 0.95, cur.water_curtain)
    )
    const dripping = cur.water_curtain > 0.1
    this.drips.visible = dripping
    if (dripping) {
      const positions = this.drips.geometry.attributes.position.array
      for (let i = 0; i < this.dripData.length; i++) {
        const d = this.dripData[i]
        const idx = i * 3 + 1
        positions[idx] -= d.speed * dt
        if (positions[idx] < 0.15) positions[idx] = 3.6
      }
      this.drips.geometry.attributes.position.needsUpdate = true
      this.dripMaterial.opacity = 0.8 * cur.water_curtain
    }

    // 补光灯
    this.lampBulbs.forEach((mat) => {
      mat.emissiveIntensity = 0.15 + cur.light * 1.6
    })
    this.indoorLight.intensity = cur.light * 2.4
  }

  // ---------------- 销毁 ----------------
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.pause()

    window.removeEventListener('resize', this.handleResize)
    if (this.resizeObserver) this.resizeObserver.disconnect()

    if (this.controls) this.controls.dispose()

    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
        materials.forEach((mat) => {
          Object.keys(mat).forEach((prop) => {
            const value = mat[prop]
            if (value && value.isTexture) value.dispose()
          })
          mat.dispose()
        })
      }
    })

    if (this.renderer) {
      this.renderer.dispose()
      const canvas = this.renderer.domElement
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }

    if (this.envMap) {
      this.envMap.dispose()
      this.envMap = null
    }

    this.scene = null
    this.camera = null
    this.renderer = null
    this.anchors = {}
  }
}
