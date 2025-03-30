import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

// Riiichtig viele Variablen hier, aber das ist okay, weil wir sie alle brauchen :)

let scene, camera, renderer;
let airplane; // GLTF Objekt
let width = window.innerWidth;
let height = window.innerHeight;

// Geschwindigkeiten
let baseSpeed = 0.1;
let boostSpeed = 0.2;
let currentSpeed = baseSpeed;

// Rotation
let targetRotationY = 0;

// Propeller Animation
let mixer;
const clock = new THREE.Clock();

// Wolken
let clouds = [];
const minSpawnDist = 300;
const maxSpawnDist = 400;
const cloudDensity = 35;
const initialCloudCount = 20;

// Letzter Spawnpunkt -> wenn das Flugzeug weiter als threshold weg ist, spawnen wir neue Wolken
let lastSpawnPosition = new THREE.Vector3(0, 0, 0);
const spawnDistanceThreshold = 100;

function setup() {
    const canvas = document.querySelector('canvas.webgl');

    // Scene erstellen
    scene = new THREE.Scene();

    // Kamera initialisieren
    initCamera();

    // Flugzeug + HDRI laden
    loadObjects();
    addHDRI();

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));

    // Tone Mapping
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.5;

    // Steuerung + Resizing
    setupControls();
    window.addEventListener('resize', onWindowResize);

    // Wolken spawnen
    spawnInitialClouds(new THREE.Vector3(0, 0, 0), initialCloudCount, minSpawnDist);
    spawnCloudsInRing(new THREE.Vector3(0, 0, 0), cloudDensity);
}

function animate() {
    requestAnimationFrame(animate);

    // Zeitdelta berechnen
    const deltaTime = clock.getDelta(); // Zeit in Sekunden seit dem letzten Frame

    // Mixer aktualisieren
    if (mixer) {
        mixer.update(deltaTime); // Aktuelle Position der Animation basierend auf dem Zeitdelta
    }

    // Flugzeug-Bewegung
    updateAirplane();

    // Kamera-Position
    updateCamera();

    // Wolken Spawning/Despawning + Custom Culling
    manageClouds();
    customCulling();

    // Renderer
    renderer.render(scene, camera);
}

// Flugzeug bewegen
function updateAirplane() {
    if (!airplane) return;

    // Flugzeug vorwärts bewegen
    const direction = new THREE.Vector3();
    airplane.getWorldDirection(direction);
    airplane.position.addScaledVector(direction, currentSpeed);

    // Rotation anpassen
    airplane.rotation.y = THREE.MathUtils.lerp(
        airplane.rotation.y,
        targetRotationY,
        0.1
    );
}

// Kamera an Flugzeug anpassen
function updateCamera() {
    if (!airplane || !camera) return;

    // Offset zur Flugzeugposition
    const offset = new THREE.Vector3(0, 7, -15);

    // Offset im Flugzeug-Koordinatensystem
    const desiredPosition = airplane.position.clone()
        .add(offset.applyQuaternion(airplane.quaternion));

    // Kamera sanft lerpen
    camera.position.lerp(desiredPosition, 0.03);

    // Blickpunkt = Flugzeugposition
    camera.lookAt(airplane.position);
}

// Custom Culling um Clipping zu vermeiden
function customCulling() {
    // Aktuelle Kameraposition ermitteln
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const radius = 200;

    // Wolken durchgehen
    for (let i = 0; i < clouds.length; i++) {
        const cloud = clouds[i];
        const dist = cloud.position.distanceTo(camPos);
        // Sichtbarkeit = true, wenn Wolke <= radius
        cloud.visible = (dist <= radius);
    }
}

// Wolken generieren
function createCloud() {
    const cloudMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1,
        transparent: true,
        opacity: 1,
    });

    const cloud = new THREE.Group();
    const sphereCount = 10;

    for (let i = 0; i < sphereCount; i++) {
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(5, 16, 16),
            cloudMaterial
        );

        // Zufallsverteilung
        sphere.position.set(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 10
        );

        // Standard-Culling ausschalten
        sphere.frustumCulled = false;

        cloud.add(sphere);
    }

    return cloud;
}

// Wolken bei Start spawnen
function spawnInitialClouds(centerPosition, count, radius) {
    for (let i = 0; i < count; i++) {
        const cloud = createCloud(); // Wolke erstellen

        const angle = Math.random() * Math.PI * 2; // Zufälliger Winkel im Kreis
        const distance = Math.random() * radius;
        const x = centerPosition.x + Math.cos(angle) * distance;
        const z = centerPosition.z + Math.sin(angle) * distance;
        const y = centerPosition.y + (Math.random() - 0.5) * 50; // Höhe wird zufällig festgelegt

        cloud.position.set(x, y, z);
        scene.add(cloud); // Szene hinzufügen
        clouds.push(cloud); // Wolken dem Array hinzufügen um sie zu managen
    }
}

// Wolken in einem Ring um centerPosition spawnen
function spawnCloudsInRing(centerPosition, count) {
    for (let i = 0; i < count; i++) {
        const cloud = createCloud();

        const angle = Math.random() * Math.PI * 2; // Zufälliger Winkel im Kreis -> Richtung (NOSW)
        const distance = THREE.MathUtils.lerp(
            minSpawnDist,
            maxSpawnDist,
            Math.random()
        );

        const x = centerPosition.x + Math.cos(angle) * distance;
        const z = centerPosition.z + Math.sin(angle) * distance;
        const y = centerPosition.y + (Math.random() - 0.5) * 50; // Höhe wird zufällig festgelegt

        cloud.position.set(x, y, z); // Position setzen
        scene.add(cloud); // Szene hinzufügen
        clouds.push(cloud); // Wolken dem Array hinzufügen um sie zu managen
    }
}

// Wolken spawnen und despawnen
function manageClouds() {
    if (!airplane) return;

    // Flugzeugposition
    const planePos = airplane.position; // Flugzeugposition ermitteln

    // Wolken entfernen, die zu weit weg sind
    for (let i = clouds.length - 1; i >= 0; i--) {
        const dist = clouds[i].position.distanceTo(planePos);
        if (dist > maxSpawnDist) {
            scene.remove(clouds[i]);
            clouds.splice(i, 1); // Wolke aus Array entfernen
        }
    }

    // Neue Wolken spawnen, wenn weit genug vom letzten Spawnpunkt entfernt
    const distanceToLastSpawn = planePos.distanceTo(lastSpawnPosition);
    if (distanceToLastSpawn > spawnDistanceThreshold) {
        spawnCloudsInRing(planePos, cloudDensity);
        lastSpawnPosition.copy(planePos);
    }
}

// Objekte laden
function loadObjects() {
    const gltfLoader = new GLTFLoader();
    gltfLoader.load(
        '/models/airplane.glb',
        (gltf) => {
            airplane = gltf.scene;
            airplane.position.set(0, 0, 0);
            airplane.scale.set(0.5, 0.5, 0.5);
            scene.add(airplane);

            // Animation Mixer
            mixer = new THREE.AnimationMixer(airplane);

            // Erste Animation abspielen
            if (gltf.animations.length > 0) {
                const action = mixer.clipAction(gltf.animations[0]);
                action.timeScale = 0.5;
                action.play();
            }
        }
    );
}

// HDRI hinzufügen
function addHDRI() {
    const rgbeLoader = new RGBELoader();
    rgbeLoader.load('/textures/environment.hdr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = texture;
        scene.environment = texture;
    });
}

// Kamera initialisieren
function initCamera() {
    camera = new THREE.PerspectiveCamera(
        75,
        width / height,
        0.1,
        200
    );
    camera.position.set(0, 7, -15);
    scene.add(camera);
}

// Resizing
function onWindowResize() {
    width = window.innerWidth;
    height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// Steuerung
function setupControls() {
    window.addEventListener('keydown', (event) => {
        if (!airplane) return;

        switch (event.key) {
            case 'ArrowLeft':
                targetRotationY += 0.05;
                break;
            case 'ArrowRight':
                targetRotationY -= 0.05;
                break;
            case 'ArrowUp':
                currentSpeed = boostSpeed;
                break;
        }
    });

    window.addEventListener('keyup', (event) => {
        if (event.key === 'ArrowUp') {
            currentSpeed = baseSpeed;
        }
    });
}

// Start
setup();
animate();
