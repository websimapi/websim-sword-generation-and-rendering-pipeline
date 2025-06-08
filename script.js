import * as THREE from 'three';

// --- DOM Elements ---
const canvas = document.getElementById('scene-canvas');
const generateBtn = document.getElementById('generate-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const inventoryGrid = document.getElementById('inventory-grid');

// --- State ---
let swordInventory = [];
let currentSwordObject = null;
let isGenerating = false;

// --- Three.js Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });

function setupScene() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    camera.position.z = 5;
}

// --- Helper to convert image URL to data URL ---
async function imageUrlToDataUrl(url) {
    const image = new Image();
    image.crossOrigin = 'Anonymous';
    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
}

// --- Sword Generation Pipeline ---

const swordGenerationPrompt = `Solid White Background. Create a high-contrast fantasy sword image with these EXACT specifications:

- BACKGROUND: Perfect solid #FFFFFF white background (RGB 255,255,255) with absolutely NO gradients, NO texture, NO shading, and NO variations.
- POSITIONING: Sword perfectly centered, standing completely vertical with blade pointing straight up.
- COMPOSITION: Full sword visible in frame with small margin around all edges, no cropping.
- SWORD DETAILS: 
  * Ornate metal handle at bottom (25% of total length).
  * Shiny enchanted blade extending upward (75% of total length).
  * Blue magical runes or symbols embedded in blade.
  * High contrast between sword and background.
  * Clear, defined edges with no blur between sword and background.
- LIGHTING: Even lighting on sword with minimal shadows.
- STYLE: Clean, detailed render with crisp edges.
- ISOLATION: Absolutely NO elements besides the sword and solid white background.

The sword must appear as if it was photographed against a perfectly flat white screen with sharp delineation between sword and background. Solid White Background.`;

async function generateNewSword() {
    if (isGenerating) return;
    isGenerating = true;
    setLoading(true, "Forging a new blade...");

    try {
        // 1. Generate Image
        const imageResult = await websim.imageGen({ prompt: swordGenerationPrompt });
        const originalUrl = imageResult.url;
        setLoading(true, "Enchanting the sword...");

        // Convert image to data URL for vision model to prevent access issues.
        const imageDataUrl = await imageUrlToDataUrl(originalUrl);

        // 2. Generate Name
        const nameResult = await websim.chat.completions.create({
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: `Give this sword an epic fantasy name. Respond with JSON: {"name": "..."}` },
                    { type: "image_url", image_url: { url: imageDataUrl } }
                ]
            }],
            json: true,
        });
        const swordName = JSON.parse(nameResult.content).name;
        setLoading(true, "Removing background...");

        // 3. Process Image (remove background)
        const processedCanvas = await removeSwordBackground(originalUrl);
        setLoading(true, "Saving to armory...");

        // 4. Upload Processed Image
        const blob = await new Promise(resolve => processedCanvas.toBlob(resolve, 'image/png'));
        const uploadResult = await websim.uploadFile({ file: blob });
        const processedUrl = uploadResult.url;

        // 5. Store in Inventory
        const newSword = { name: swordName, originalUrl, processedUrl };
        swordInventory.push(newSword);
        
        updateInventoryUI();
        displaySword(newSword);

    } catch (error) {
        console.error("Sword generation failed:", error);
        alert("The forging process failed. Please try again.");
    } finally {
        isGenerating = false;
        setLoading(false);
    }
}

async function removeSwordBackground(imageUrl) {
    const image = new Image();
    image.crossOrigin = "Anonymous";
    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = imageUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // As per the docs, sample corners to determine background color
    const corner1 = [data[0], data[1], data[2]];
    const bgColor = { r: corner1[0], g: corner1[1], b: corner1[2] };
    const tolerance = 35; // A reasonable tolerance for near-white colors

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const distance = Math.sqrt(
            Math.pow(r - bgColor.r, 2) +
            Math.pow(g - bgColor.g, 2) +
            Math.pow(b - bgColor.b, 2)
        );

        if (distance < tolerance) {
            data[i + 3] = 0; // Make pixel transparent
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

// --- 3D Scene Integration ---

function displaySword(swordData) {
    if (currentSwordObject) {
        camera.remove(currentSwordObject);
        currentSwordObject.geometry.dispose();
        currentSwordObject.material.dispose();
    }
    
    updateSelectedInventoryItem(swordData.processedUrl);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(swordData.processedUrl, (texture) => {
        const aspectRatio = texture.image.width / texture.image.height;
        const swordHeight = 2.5;
        const geometry = new THREE.PlaneGeometry(swordHeight * aspectRatio, swordHeight);
        const material = new THREE.MeshStandardMaterial({
            map: texture,
            transparent: true,
            metalness: 0.7,
            roughness: 0.3,
        });

        const swordMesh = new THREE.Mesh(geometry, material);
        swordMesh.position.set(0.7, -0.6, -2.5);
        swordMesh.rotation.z = -Math.PI / 16;
        swordMesh.rotation.y = Math.PI / 16;
        
        camera.add(swordMesh);
        currentSwordObject = swordMesh;
    });
}


// --- UI Management ---

function setLoading(isLoading, text = "Loading...") {
    loadingText.textContent = text;
    if (isLoading) {
        loadingOverlay.classList.add('visible');
    } else {
        loadingOverlay.classList.remove('visible');
    }
}

function updateInventoryUI() {
    inventoryGrid.innerHTML = '';
    swordInventory.forEach(sword => {
        const item = document.createElement('div');
        item.className = 'inventory-item';
        item.style.backgroundImage = `url(${sword.processedUrl})`;
        item.dataset.url = sword.processedUrl;
        
        const nameLabel = document.createElement('div');
        nameLabel.className = 'item-name';
        nameLabel.textContent = sword.name;
        item.appendChild(nameLabel);

        item.addEventListener('click', () => displaySword(sword));
        inventoryGrid.appendChild(item);
    });
}

function updateSelectedInventoryItem(processedUrl) {
    const items = inventoryGrid.querySelectorAll('.inventory-item');
    items.forEach(item => {
        if(item.dataset.url === processedUrl) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}


// --- Animation & Events ---

function animate() {
    requestAnimationFrame(animate);
    if(currentSwordObject) {
        // Add subtle movement
        const time = Date.now() * 0.001;
        currentSwordObject.position.y = -0.6 + Math.sin(time * 2) * 0.03;
        currentSwordObject.rotation.z = -Math.PI / 16 + Math.cos(time * 1.5) * 0.05;
    }
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Initialization ---

function init() {
    setupScene();
    generateBtn.addEventListener('click', generateNewSword);
    window.addEventListener('resize', onWindowResize);
    animate();
    generateNewSword(); // Generate the first sword on load
}

init();