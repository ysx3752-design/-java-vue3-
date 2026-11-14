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
  'external_shade',
  'internal_shade',
  'external_fan',
  'internal_fan',
  'skylight',
  'spray',
  'water_curtain',
  'light'
]

const DEFAULT_VIEW = {
  position: new THREE.Vector3(29, 27, 33),
  target: new THREE.Vector3(0, 0, 0)
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
    this._colorCold = new THREE.Color(0x638cac)
    this._colorMid = new THREE.Color(0x588e78)
    this._colorHot = new THREE.Color(0xc17a5d)
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.container.appendChild(this.renderer.domElement)
  }

  initScene() {
    const { w, h } = this.size
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xe7e9e8, 72, 150)

    this.camera = new THREE.PerspectiveCamera(36, w / h, 0.5, 400)
    this.camera.zoom = Math.min(1, (w / h) / 1.3)
    this.camera.updateProjectionMatrix()
    this.camera.position.copy(DEFAULT_VIEW.position)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.copy(DEFAULT_VIEW.target)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.075
    this.controls.rotateSpeed = 0.75
    this.controls.zoomSpeed = 0.8
    this.controls.enablePan = false
    this.controls.minDistance = 9
    this.controls.maxDistance = 52
    this.controls.minPolarAngle = 0.25
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04
    this.controls.autoRotate = false
    this.controls.autoRotateSpeed = 0.55
    this.controls.update()

    // 光照
    this.hemi = new THREE.HemisphereLight(0xf2fbff, 0xd9e4ea, 0.55)
    this.scene.add(this.hemi)

    this.ambient = new THREE.AmbientLight(0xffffff, 0.2)
    this.scene.add(this.ambient)

    this.sun = new THREE.DirectionalLight(0xffffff, 2.4)
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

    this.fill = new THREE.DirectionalLight(0xe6edf0, 0.65)
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
    this.buildShades()
    this.buildSensors()
    this.buildEffects()
    this.buildSurroundings()
  }

  buildGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180),
      new THREE.MeshStandardMaterial({ color: 0xe7e9e8, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.85
    ground.receiveShadow = true
    this.scene.add(ground)

    // 矩形设备试验台：石墨下座、浅灰台面、外露的结构分缝。
    this.addBox([18.8, 0.58, 29.8], [0, -0.55, 0], 0x344448)
    this.addBox([18.4, 0.18, 29.4], [0, -0.17, 0], 0xcbd1ce)
    const grid = new THREE.GridHelper(80, 40, 0xc2cac7, 0xd5dbd8)
    grid.position.y = -0.83
    grid.material.transparent = true
    grid.material.opacity = 0.38
    this.scene.add(grid)
    for (let z = -14; z <= 14; z += 1) {
      this.addBox([0.28, 0.012, 0.025], [8.65, -0.067, z], 0x697b7b)
    }
    for (let x = -8; x <= 8; x += 1) {
      this.addBox([0.025, 0.012, 0.28], [x, -0.067, 14.05], 0x697b7b)
    }
    this.floorLabel('GH—01', [-5.5, -0.06, 13.2], 3.8, 0.8)
    this.floorLabel('GREENHOUSE / SECTION MODEL', [2.8, -0.06, 13.2], 6.5, 0.55)
  }

  addBox(size, position, color, material = null) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material ||
      new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.18 }))
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)
    return mesh
  }

  floorLabel(text, position, width, height, color = '#536664') {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = '600 68px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.fillText(text, 512, 64, 1000)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true,
        polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(...position)
    this.scene.add(mesh)
  }

  buildGreenhouse() {
    const steel = new THREE.MeshStandardMaterial({ color: 0xbcc8be, metalness: 0.32, roughness: 0.63 })
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x536765, metalness: 0.45, roughness: 0.55 })
    this.steelMaterial = steel
    this.glassMaterial = new THREE.MeshStandardMaterial({ color: 0xb2cbc5, transparent: true,
      opacity: 0.2, roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false })
    this.addBox([14.5, 0.26, 24.5], [0, -0.05, 0], 0x9daaa5)
    const floor = this.addBox([13.8, 0.06, 23.8], [0, 0.11, 0], 0xc4ccc4)
    this.floorMaterial = floor.material
    this.addBox([1.3, 0.025, 23.2], [0, 0.155, 0], 0xe3e6dc)
    // 检修走道两侧的安全黄线。
    for (const x of [-0.72, 0.72]) this.addBox([0.045, 0.015, 23.2], [x, 0.175, 0], 0xc4a45d)

    // 门式结构代替密集拱架；近侧立面与屋面剖去，设备完整暴露。
    const joints = [new THREE.Vector3(-7, 4, 0), new THREE.Vector3(0, 7.2, 0), new THREE.Vector3(7, 4, 0)]
    const roofPath = new THREE.CurvePath()
    roofPath.add(new THREE.LineCurve3(joints[0], joints[1]))
    roofPath.add(new THREE.LineCurve3(joints[1], joints[2]))
    const ribGeo = new THREE.TubeGeometry(roofPath, 2, 0.095, 4, false)
    for (let z = -12; z <= 12; z += 4) {
      const rib = new THREE.Mesh(ribGeo, steel)
      rib.position.z = z
      rib.castShadow = true
      this.scene.add(rib)
      for (const x of [-7, 7]) {
        // 前侧中央两根柱降低为剖切短柱，形成可读的开放观察窗。
        const height = x > 0 && z > -8 && z < 8 ? 0.65 : 4
        this.addBox([0.18, height, 0.18], [x, height / 2 + 0.15, z], null, steel)
        this.addBox([0.5, 0.12, 0.5], [x, 0.2, z], null, darkSteel)
        if (height < 4) this.addBox([0.22, 0.04, 0.22], [x, height + 0.17, z], 0xd4ad57)
      }
    }
    for (const x of [-7, 7]) this.addBox([0.15, 0.18, 24], [x, 4.05, 0], null, steel)
    this.addBox([0.16, 0.16, 24], [0, 7.2, 0], null, darkSteel)
    // 仅保留远侧半屋面，分块玻璃与不透明的端部压条形成工业装配感。
    for (let z = -10; z <= 10; z += 4) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-7, 4.03, z - 1.9), new THREE.Vector3(0, 7.23, z - 1.9),
        new THREE.Vector3(-7, 4.03, z + 1.9), new THREE.Vector3(0, 7.23, z + 1.9)
      ])
      geometry.setIndex([0, 1, 2, 2, 1, 3])
      geometry.computeVertexNormals()
      const panel = new THREE.Mesh(geometry, this.glassMaterial)
      this.scene.add(panel)
    }
    // 远侧墙面采用低矮的装配护板，避免封闭透明盒体。
    this.addBox([0.12, 0.8, 24], [-7, 0.65, 0], null, darkSteel)
    for (let z = -10; z <= 10; z += 4) {
      this.addBox([0.08, 0.06, 3.8], [-7.1, 0.72, z], 0x879b94)
    }
    for (const z of [-12, 12]) this.addBox([14, 0.16, 0.16], [0, 4, z], null, steel)
  }

  buildBeds() {
    const rand = this._rand
    const bedXs = [-4.8, -1.6, 1.6, 4.8]
    const bedWidth = 1.9
    const bedLength = 20
    const rowsPerBed = 2
    const plantsPerRow = 14
    const plantCount = bedXs.length * rowsPerBed * plantsPerRow

    this.soilMaterial = new THREE.MeshStandardMaterial({ color: 0x6d5039, roughness: 1 })

    bedXs.forEach((x, bedIndex) => {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(bedWidth, 0.42, bedLength), this.soilMaterial)
      bed.position.set(x, 0.21, 0)
      bed.castShadow = true
      bed.receiveShadow = true
      this.scene.add(bed)

      const trayMat = new THREE.MeshStandardMaterial({ color: 0xb0bbb2, roughness: 0.65, metalness: 0.35 })
      for (const sign of [-1, 1]) {
        this.addBox([0.08, 0.48, bedLength + 0.12], [x + sign * (bedWidth / 2), 0.3, 0], null, trayMat)
        this.addBox([bedWidth, 0.48, 0.08], [x, 0.3, sign * bedLength / 2], null, trayMat)
      }
      this.floorLabel(`BED / 0${bedIndex + 1}`, [x, 0.16, 11.05], 2.1, 0.36)

      // 灌溉支管与苗床固定管卡
      const pipeMat = new THREE.MeshStandardMaterial({ color: 0x4c5b66, roughness: 0.6, metalness: 0.3 })
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, bedLength, 8),
        pipeMat
      )
      pipe.rotation.x = Math.PI / 2
      pipe.position.set(x, 0.45, 0)
      this.scene.add(pipe)

      // 沿苗床均匀设置固定管夹（每4米一处），避免管道在土壤上方浮空
      for (let pz = -8; pz <= 8; pz += 4) {
        this.addBox([0.08, 0.08, 0.08], [x, 0.42, pz], 0x8a9990)
      }
    })

    // 苗床灌溉总水管网：末端集水/配水横管与进水立管（形成水力闭环）
    const headerMat = new THREE.MeshStandardMaterial({ color: 0x42525c, roughness: 0.55, metalness: 0.35 })
    const manifold = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 4.8 * 2, 8),
      headerMat
    )
    manifold.rotation.z = Math.PI / 2
    manifold.position.set(0, 0.45, -bedLength / 2)
    this.scene.add(manifold)

    // 灌溉进水立管与地面进水球阀（引自地坪下管沟）
    const dripRiser = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 8), headerMat)
    dripRiser.position.set(-4.8, 0.28, -bedLength / 2)
    this.scene.add(dripRiser)
    const valveHandle = this.addBox([0.09, 0.04, 0.04], [-4.8, 0.38, -bedLength / 2 + 0.06], 0xc75a3c)

    // 植物（实例化）
    const stemGeo = new THREE.CylinderGeometry(0.028, 0.038, 0.42, 5)
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f7d43, roughness: 0.9 })
    const leafGeo = new THREE.IcosahedronGeometry(0.26, 0)
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

          color.setHSL(0.28 + rand() * 0.035, 0.25 + rand() * 0.12, 0.32 + rand() * 0.12)
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

    // ---- 外通风（后墙两台排风机，配置山墙结构立柱支承）----
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

      // 后山墙结构立柱支承：从地坪(0.15m)延伸至山墙横梁(4.0m)，将风机安装框固定在结构上
      ;[0.85, -0.85].forEach((dx) => {
        const stud = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4.0 - 0.15, 0.1), steel)
        stud.position.set(x + dx, (4.0 + 0.15) / 2, -HALF_LEN + 0.1)
        this.groups.externalFan.add(stud)
      })
    })
    this.scene.add(this.groups.externalFan)

    // ---- 内通风（环流风机吊装，精确对齐主拱架肋梁 z = ±4）----
    this.groups.internalFan = new THREE.Group()
    ;[-2.4, 2.4].forEach((x, i) => {
      const fan = this.createFan(0.5)
      const z = i === 0 ? 4 : -4
      fan.position.set(x, 3.15, z)
      this.groups.internalFan.add(fan)
      this.fans.push({ rotor: fan.userData.rotor, key: 'internal_fan' })

      // 吊杆延伸至门式钢架下弦/斜梁：在 x = ±2.4 处，拱架梁高度为 4 + 3.2*(1 - 2.4/7) = 6.10m
      const beamHeight = WALL_H + RISE * (1 - Math.abs(x) / HALF_W)
      const rodHeight = beamHeight - 3.15
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, rodHeight, 6), steel)
      rod.position.set(x, 3.15 + rodHeight / 2, z)
      this.groups.internalFan.add(rod)

      // 梁端固定抱箍/法兰夹
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), steel)
      clamp.position.set(x, beamHeight, z)
      this.groups.internalFan.add(clamp)
    })
    this.scene.add(this.groups.internalFan)

    // ---- 天窗（屋脊两侧可开启通风窗，配置传动轴与电动齿条推杆）----
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

    // 屋脊开窗驱动传动轴与电机
    const driveShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 15, 8),
      ventFrameMat
    )
    driveShaft.rotation.x = Math.PI / 2
    driveShaft.position.set(0.12, WALL_H + RISE - 0.1, 0)
    this.groups.skylight.add(driveShaft)
    const motorBox = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.35), ventFrameMat)
    motorBox.position.set(0.12, WALL_H + RISE - 0.1, 0)
    this.groups.skylight.add(motorBox)

    ;[-2, 6].forEach((z) => {
      const hinge = new THREE.Group()
      hinge.position.set(0, WALL_H + RISE + 0.03, z)
      hinge.rotation.z = -Math.atan2(3.2, 7)

      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 3.6), ventMat)
      panel.position.set(1.1, 0, 0)
      hinge.add(panel)

      // 窗框
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.1), ventFrameMat)
      edge.position.set(1.1, 0.03, 1.8)
      hinge.add(edge)
      const edge2 = edge.clone()
      edge2.position.z = -1.8
      hinge.add(edge2)
      const edge3 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.6), ventFrameMat)
      edge3.position.set(2.2, 0.03, 0)
      hinge.add(edge3)

      // 中挺横撑
      for (let mz = -0.6; mz <= 0.61; mz += 1.2) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.07, 0.06), ventFrameMat)
        mullion.position.set(1.1, 0.03, mz)
        hinge.add(mullion)
      }

      // 机械开窗传动托架（位于窗下弦，不穿透玻璃）
      const pushBracket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.16), ventFrameMat)
      pushBracket.position.set(2.15, -0.05, 0)
      hinge.add(pushBracket)

      hinge.userData.closed = -Math.atan2(3.2, 7)
      hinge.userData.open = 0.72
      this.groups.skylight.add(hinge)
      this.vents.push(hinge)
    })
    this.scene.add(this.groups.skylight)

    // ---- 喷灌系统（屋脊吊架固结、给水立管与控制电磁阀）----
    this.groups.spray = new THREE.Group()
    const mainPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, LEN - 1.5, 10),
      new THREE.MeshStandardMaterial({ color: 0xd2dce3, metalness: 0.35, roughness: 0.45 })
    )
    mainPipe.rotation.x = Math.PI / 2
    mainPipe.position.set(0, WALL_H + RISE - 0.55, 0)
    this.groups.spray.add(mainPipe)

    // 屋脊悬挂吊架：每隔4米将喷雾主管固定在屋脊梁(y = 7.2)上
    for (let z = -8; z <= 8; z += 4) {
      const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.55, 6), steel)
      hanger.position.set(0, WALL_H + RISE - 0.275, z)
      this.groups.spray.add(hanger)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 16), steel)
      ring.position.set(0, WALL_H + RISE - 0.55, z)
      this.groups.spray.add(ring)
    }

    // 后山墙给水引入立管（自地坪向上接入屋脊喷雾管网）
    const riserZ = -(LEN - 1.5) / 2
    const sprayRiser = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, WALL_H + RISE - 0.55 - 0.15, 10),
      new THREE.MeshStandardMaterial({ color: 0xd2dce3, metalness: 0.35, roughness: 0.45 })
    )
    sprayRiser.position.set(0, (WALL_H + RISE - 0.55 + 0.15) / 2, riserZ)
    this.groups.spray.add(sprayRiser)

    // 喷灌电磁阀
    const sprayValve = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x3d505e, metalness: 0.7, roughness: 0.3 }))
    sprayValve.position.set(0, 1.6, riserZ)
    this.groups.spray.add(sprayValve)

    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x5f7180, metalness: 0.7, roughness: 0.35 })
    this.nozzlePositions = []
    for (let z = -9; z <= 9; z += 3) {
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 10), nozzleMat)
      nozzle.rotation.x = Math.PI
      nozzle.position.set(0, WALL_H + RISE - 0.64, z)
      this.groups.spray.add(nozzle)
      this.nozzlePositions.push(z)
    }
    this.scene.add(this.groups.spray)

    // ---- 水帘（顶部配水总管、底部不锈钢集水槽、循环回水立管与框架支柱）----
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

    // 结构框架与上下水循环构件
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

    // 水帘上部配水喷淋管
    const topDistPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 9.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x485860, metalness: 0.4, roughness: 0.4 })
    )
    topDistPipe.rotation.x = Math.PI / 2
    topDistPipe.position.set(HALF_W - 0.12, 3.64, 0)
    this.groups.curtain.add(topDistPipe)

    // 水帘底部集水回水槽（承接下落水滴，形成水循环）
    const bottomGutter = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.14, 9.8),
      new THREE.MeshStandardMaterial({ color: 0x76858e, metalness: 0.6, roughness: 0.35 })
    )
    bottomGutter.position.set(HALF_W - 0.12, 0.18, 0)
    this.groups.curtain.add(bottomGutter)

    // 水帘循环供水立管（连接底槽与顶管）
    const circRiser = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 3.46, 8),
      steel
    )
    circRiser.position.set(HALF_W - 0.12, 1.91, -4.85)
    this.groups.curtain.add(circRiser)

    // 水帘安装背向结构柱（固定至檐口与地坪，消除悬空）
    ;[-4.85, 4.85].forEach((cz) => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.0 - 0.15, 0.14), steel)
      col.position.set(HALF_W - 0.07, (4.0 + 0.15) / 2, cz)
      this.groups.curtain.add(col)
    })
    this.scene.add(this.groups.curtain)

    // ---- 补光灯（布置于苗床作物正上方，避开走道与中轴喷灌主管）----
    this.groups.lamp = new THREE.Group()
    const lampPositions = [
      { x: -1.6, z: -5.0 },
      { x: -1.6, z: 3.0 },
      { x: 1.6, z: -3.0 },
      { x: 1.6, z: 5.0 }
    ]
    this.lampBulbs = []
    lampPositions.forEach(({ x, z }) => {
      // 屋面钢梁在该 X 处的标高
      const beamHeight = WALL_H + RISE * (1 - Math.abs(x) / HALF_W)
      const lampY = 4.8
      const rodHeight = beamHeight - lampY
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, rodHeight, 6), steel)
      rod.position.set(x, lampY + rodHeight / 2, z)
      this.groups.lamp.add(rod)

      // 桁架固定夹
      const hangerClamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), steel)
      hangerClamp.position.set(x, beamHeight, z)
      this.groups.lamp.add(hangerClamp)

      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 0.32, 18, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0xe8eef3,
          metalness: 0.5,
          roughness: 0.4,
          side: THREE.DoubleSide
        })
      )
      shade.position.set(x, lampY - 0.15, z)
      this.groups.lamp.add(shade)

      const bulbMat = new THREE.MeshStandardMaterial({
        color: 0xfff3d0,
        emissive: new THREE.Color(0xffd98a),
        emissiveIntensity: 0.15,
        roughness: 0.3
      })
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), bulbMat)
      bulb.position.set(x, lampY - 0.3, z)
      this.groups.lamp.add(bulb)
      this.lampBulbs.push(bulbMat)
    })
    this.scene.add(this.groups.lamp)
  }

  buildShades() {
    this.shades = []
    const railMat = new THREE.MeshStandardMaterial({ color: 0x778b80, roughness: 0.65, metalness: 0.35 })
    const makeShade = (key, y, color) => {
      const group = new THREE.Group()
      const fabric = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.42,
        side: THREE.DoubleSide, roughness: 0.95, depthWrite: false })
      const moving = new THREE.Group()
      moving.position.set(-6.6, y, -10.5)
      // 遮阳布展开覆盖温室全跨度（-6.6m 到 +6.6m，总宽 13.2m），半透明条带既保证遮阳又保留内部透视
      for (let x = 0; x <= 13.2; x += 0.4) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 21), fabric)
        strip.rotation.x = -Math.PI / 2
        strip.position.set(x, 0, 10.5)
        moving.add(strip)
      }
      const leading = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.08, 0.1), railMat)
      leading.position.set(6.6, 0, 21)
      moving.add(leading)
      group.add(moving)
      for (const x of [-6.8, -2.3, 2.3, 6.8]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.08, 21.6), railMat)
        rail.position.set(x, y - 0.06, 0)
        group.add(rail)
      }
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 13.6, 12), railMat)
      roller.rotation.z = Math.PI / 2
      roller.position.set(0, y, -10.6)
      group.add(roller)

      // 遮阳系统结构支承：全跨度均匀布置，精确落在门式钢架肋梁轴线（z = -8, 0, 8）上
      if (key === 'external_shade') {
        for (const x of [-6.8, 0, 6.8]) {
          for (const z of [-8, 0, 8]) {
            const roofHeight = WALL_H + RISE * (1 - Math.abs(x) / HALF_W)
            const support = new THREE.Mesh(new THREE.BoxGeometry(0.08, y - roofHeight, 0.08), railMat)
            support.position.set(x, (y + roofHeight) / 2, z)
            group.add(support)
          }
        }
      } else if (key === 'internal_shade') {
        for (const x of [-6.8, 0, 6.8]) {
          for (const z of [-8, 0, 8]) {
            const roofHeight = WALL_H + RISE * (1 - Math.abs(x) / HALF_W)
            const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, roofHeight - y, 6), railMat)
            hanger.position.set(x, (y + roofHeight) / 2, z)
            group.add(hanger)
          }
        }
      }
      this.scene.add(group)
      this.shades.push({ key, moving, fabric })
    }
    makeShade('external_shade', 8.05, 0x657c71)
    makeShade('internal_shade', 3.9, 0xc4b38a)
  }

  buildSensors() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8e9ba6, metalness: 0.5, roughness: 0.5 })
    const steel = this.steelMaterial

    // 1. 空气温湿度传感器：立于中央走道侧缘边柱(x = -0.9, z = 0)，配法兰基座与百叶防辐射罩
    const airGroup = new THREE.Group()
    const airFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.04, 12), poleMat)
    airFlange.position.set(-0.9, 0.17, 0)
    airGroup.add(airFlange)
    const airPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 8), poleMat)
    airPole.position.set(-0.9, 1.07, 0)
    airGroup.add(airPole)
    // 百叶防辐射罩
    for (let ly = 1.85; ly <= 2.1; ly += 0.05) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.02, 12), poleMat)
      plate.position.set(-0.9, ly, 0)
      airGroup.add(plate)
    }
    const airDotMat = new THREE.MeshStandardMaterial({ color: 0xff8a65, emissive: 0xff8a65, emissiveIntensity: 1.1 })
    const airDot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), airDotMat)
    airDot.position.set(-0.9, 2.22, 0)
    airGroup.add(airDot)
    this.scene.add(airGroup)

    // 2. CO2 传感器：立于远侧立柱旁(x = -6.8, z = 4.0)，壁挂支架连接，避免阻碍农事
    const co2Group = new THREE.Group()
    const co2Bracket = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.06), steel)
    co2Bracket.position.set(-6.75, 1.85, 4.0)
    co2Group.add(co2Bracket)
    const co2Box = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.18), poleMat)
    co2Box.position.set(-6.55, 1.85, 4.0)
    co2Group.add(co2Box)
    const co2DotMat = new THREE.MeshStandardMaterial({ color: 0x7cc3f0, emissive: 0x7cc3f0, emissiveIntensity: 1.1 })
    const co2Dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), co2DotMat)
    co2Dot.position.set(-6.55, 2.02, 4.0)
    co2Group.add(co2Dot)
    this.scene.add(co2Group)

    // 3. 土壤温湿度传感器：插设于苗床 3 内(x = 1.6, z = 5.4)，变送器固结于床体，不锈钢探针深入土壤基质
    const soilGroup = new THREE.Group()
    const soilBracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), steel)
    soilBracket.position.set(1.6, 0.65, 5.4)
    soilGroup.add(soilBracket)
    const soilBox = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.14), poleMat)
    soilBox.position.set(1.6, 0.95, 5.4)
    soilGroup.add(soilBox)
    // 双不锈钢插针深入土壤
    ;[-0.03, 0.03].forEach((dx) => {
      const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 6),
        new THREE.MeshStandardMaterial({ color: 0xccd6dd, metalness: 0.9, roughness: 0.2 }))
      probe.position.set(1.6 + dx, 0.32, 5.4)
      soilGroup.add(probe)
    })
    const soilDotMat = new THREE.MeshStandardMaterial({ color: 0x9ccc65, emissive: 0x9ccc65, emissiveIntensity: 1.1 })
    const soilDot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), soilDotMat)
    soilDot.position.set(1.6, 1.1, 5.4)
    soilGroup.add(soilDot)
    this.scene.add(soilGroup)

    // 4. 光照度传感器：固定于前山墙屋脊顶峰气象短桅杆上(x = 0, y = 7.35, z = 11.9)，面向全天空，与天窗及室内灯光彻底隔离
    const lightGroup = new THREE.Group()
    const lightMast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 8), poleMat)
    lightMast.position.set(0, 7.35, 11.9)
    lightGroup.add(lightMast)
    const lightBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.08, 12), poleMat)
    lightBase.position.set(0, 7.55, 11.9)
    lightGroup.add(lightBase)
    const lightDotMat = new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xffd54f, emissiveIntensity: 1.1 })
    const lightDiffuser = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), lightDotMat)
    lightDiffuser.position.set(0, 7.6, 11.9)
    lightGroup.add(lightDiffuser)
    this.scene.add(lightGroup)

    // 标注锚点（保持与重构后的物理坐标精确一致）
    this.anchors['sensor-air'] = new THREE.Vector3(-0.9, 2.3, 0)
    this.anchors['sensor-co2'] = new THREE.Vector3(-6.55, 2.1, 4.0)
    this.anchors['sensor-soil'] = new THREE.Vector3(1.6, 1.2, 5.4)
    this.anchors['sensor-light'] = new THREE.Vector3(0, 7.8, 11.9)

    this.anchors['device-external_shade'] = new THREE.Vector3(0, 8.2, -4.0)
    this.anchors['device-internal_shade'] = new THREE.Vector3(2.3, 4.0, 4.0)
    this.anchors['device-external_fan'] = new THREE.Vector3(-3.2, 3.6, -HALF_LEN + 0.3)
    this.anchors['device-internal_fan'] = new THREE.Vector3(2.4, 3.95, -4.0)
    this.anchors['device-skylight'] = new THREE.Vector3(1.6, WALL_H + RISE + 0.5, 6.0)
    this.anchors['device-spray'] = new THREE.Vector3(0, WALL_H + RISE - 0.35, 4.0)
    this.anchors['device-water_curtain'] = new THREE.Vector3(HALF_W - 0.2, 3.9, 0)
    this.anchors['device-light'] = new THREE.Vector3(1.6, 5.0, 5.0)
  }

  buildEffects() {
    // 底座两侧的温度指示条，避免光环与扫描效果干扰设备阅读。
    this.climateRing = this.addBox([0.07, 0.035, 25.5], [-8.3, -0.055, 0], 0x668d7b,
      new THREE.MeshBasicMaterial({ color: 0x668d7b }))
    this.climateRingGlow = this.addBox([0.07, 0.035, 25.5], [8.3, -0.055, 0], 0x668d7b,
      new THREE.MeshBasicMaterial({ color: 0x668d7b }))

    // 室内雾气（湿度可视化）
    const mistCount = 90
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
    const dropCount = 280
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
    // 工程底图的尺寸引线和端点；仅表达当前场景比例，不代表现场测绘。
    const points = []
    const line = (a, b) => points.push(new THREE.Vector3(...a), new THREE.Vector3(...b))
    line([-8.8, -0.04, -12], [-8.8, -0.04, 12])
    line([-7, -0.04, -13.5], [7, -0.04, -13.5])
    for (const z of [-12, 12]) line([-9.05, -0.04, z], [-8.5, -0.04, z])
    for (const x of [-7, 7]) line([x, -0.04, -13.8], [x, -0.04, -13.2])
    this.scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x6f817b })))
    this.floorLabel('14 m', [0, -0.03, -13.9], 2, 0.4)
    // 地面角部的安全边界，替代外围树木与灌木。
    for (const x of [-7.8, 7.8]) {
      for (const z of [-12.6, 12.6]) {
        this.addBox([0.8, 0.018, 0.08], [x, -0.05, z], 0xb99d5b)
        this.addBox([0.08, 0.018, 0.8], [x, -0.05, z], 0xb99d5b)
      }
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
      this.tween = null
      this.controls.target.copy(DEFAULT_VIEW.target)
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
    this.camera.zoom = Math.min(1, (w / h) / 1.3)
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
    // 选择设备只高亮，不再把轨道中心移到设备侧边。
    this.selectedDevice = key
    this.controls.target.copy(DEFAULT_VIEW.target)
    this.tween = null
    this.controls.autoRotate = false
    if (this.onAutoRotateChange) this.onAutoRotateChange(false)
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
    this.sun.intensity = 0.7 + lightFactor * 1.35
    this.hemi.intensity = 0.45 + lightFactor * 0.35
    this.glassMaterial.opacity = 0.13 + lightFactor * 0.08

    // 湿度 → 雾气
    const mistOpacity = clamp((cur.humidity - 35) / 65, 0, 1) * 0.1
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


  }

  updateDevices(dt) {
    const smooth = 1 - Math.exp(-dt * 5)
    const cur = this.cur.devices
    const tgt = this.target.devices
    DEVICE_KEYS.forEach((key) => {
      cur[key] = lerp(cur[key], tgt[key], smooth)
    })

    // 遮阳网展开/收起：驱动状态仅来自对应设备开关。
    this.shades.forEach(({ key, moving, fabric }) => {
      moving.scale.z = lerp(0.035, 1, cur[key])
      fabric.opacity = this.selectedDevice === key ? 0.58 : 0.42
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
