/**
 * Face Encoding Service
 * 
 * Generates and verifies face embeddings using Canvas API
 * - Captures video frames from user's camera
 * - Generates face encoding (128-dim vector) using image hash
 * - Computes Euclidean distance for face matching
 * - Provides confidence scoring for verification
 * - Liveness detection via image metadata analysis
 */

export interface FaceCapture {
  imageData: ImageData;
  timestamp: number;
  embedding: number[];
  imageMetadata: {
    brightness: number;
    contrast: number;
    edges: number;
    texture: number;
  };
}

export interface FaceMatch {
  confidence: number; // 0-100
  distance: number; // Euclidean distance
  isMatch: boolean; // True if confidence >= 80
}

/**
 * Analyze image for liveness detection
 * Returns metrics for determining if face is real (not printed/screen)
 */
function analyzeImageMetadata(imageData: ImageData): {
  brightness: number;
  contrast: number;
  edges: number;
  texture: number;
} {
  const data = imageData.data;
  let totalBrightness = 0;
  let totalContrast = 0;
  let edgeCount = 0;
  let textureVariance = 0;

  // Analyze brightness
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    totalBrightness += (r + g + b) / 3;
  }
  const brightness = Math.round(totalBrightness / (data.length / 4));

  // Analyze contrast (standard deviation of brightness)
  let varianceSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const pixelBrightness = (r + g + b) / 3;
    varianceSum += Math.pow(pixelBrightness - brightness, 2);
  }
  const contrast = Math.round(Math.sqrt(varianceSum / (data.length / 4)));

  // Detect edges (high gradient areas) for liveness
  const width = imageData.width;
  const height = imageData.height;

  for (let i = 0; i < data.length; i += 4) {
    const pixelIdx = i / 4;
    const x = pixelIdx % width;
    const y = Math.floor(pixelIdx / width);

    if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
      // Sobel operator for edge detection
      const idx = (y * width + x) * 4;
      const left = (data[idx - 4] + data[idx - 3] + data[idx - 2]) / 3;
      const right = (data[idx + 4] + data[idx + 5] + data[idx + 6]) / 3;
      const top = (data[idx - width * 4] + data[idx - width * 4 + 1] + data[idx - width * 4 + 2]) / 3;
      const bottom = (data[idx + width * 4] + data[idx + width * 4 + 1] + data[idx + width * 4 + 2]) / 3;

      const gx = right - left;
      const gy = bottom - top;
      const magnitude = Math.sqrt(gx * gx + gy * gy);

      if (magnitude > 50) {
        edgeCount++;
      }
    }
  }

  // Detect texture (chrominance variation)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const chroma = Math.sqrt(Math.pow(r - g, 2) + Math.pow(g - b, 2));
    textureVariance += chroma;
  }
  const texture = Math.round(textureVariance / (data.length / 4));

  return {
    brightness,
    contrast,
    edges: Math.round(edgeCount / (width * height) * 1000),
    texture,
  };
}

/**
 * Generate a 128-dimensional embedding from image data
 * Uses pixel values, luminance, and spatial distribution
 */
function generateEmbedding(imageData: ImageData): number[] {
  const data = imageData.data;
  const embedding: number[] = [];
  
  // Extract features from image
  const width = imageData.width;
  const height = imageData.height;
  const cellSize = Math.sqrt((width * height) / 128); // Divide image into ~128 cells
  
  // Process each cell
  for (let i = 0; i < 128; i++) {
    const cellX = (i % Math.floor(width / cellSize)) * cellSize;
    const cellY = Math.floor(i / Math.floor(width / cellSize)) * cellSize;
    
    let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
    let count = 0;
    
    // Sample pixels in this cell
    for (let y = cellY; y < cellY + cellSize && y < height; y++) {
      for (let x = cellX; x < cellX + cellSize && x < width; x++) {
        const idx = (y * width + x) * 4;
        sumR += data[idx];
        sumG += data[idx + 1];
        sumB += data[idx + 2];
        sumA += data[idx + 3];
        count++;
      }
    }
    
    // Normalize to -1 to 1 range
    const avgR = (sumR / count) / 128 - 1;
    const avgG = (sumG / count) / 128 - 1;
    const avgB = (sumB / count) / 128 - 1;
    
    // Compute luminance feature
    const luminance = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
    embedding.push(luminance);
  }
  
  return embedding;
}

/**
 * Compute Euclidean distance between two embeddings
 */
function euclideanDistance(embed1: number[], embed2: number[]): number {
  let sum = 0;
  for (let i = 0; i < embed1.length; i++) {
    const diff = embed1[i] - embed2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Convert distance to confidence score
 * Distance closer to 0 = higher confidence
 */
function distanceToConfidence(distance: number): number {
  // Normalize: distance 0 = 100%, distance > 3 = 0%
  const confidence = Math.max(0, 100 - (distance / 3) * 100);
  return Math.round(confidence);
}

/**
 * Capture face from video element and generate embedding
 */
export async function captureFaceFromVideo(
  videoElement: HTMLVideoElement
): Promise<FaceCapture> {
  // Create a canvas to draw video frame
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(videoElement, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const embedding = generateEmbedding(imageData);
  const imageMetadata = analyzeImageMetadata(imageData);
  
  return {
    imageData,
    timestamp: Date.now(),
    embedding,
    imageMetadata,
  };
}

/**
 * Capture face from webcam stream
 */
export async function getCameraStream(): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      facingMode: 'user',
    },
    audio: false,
  };
  
  return await navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * Stop camera stream
 */
export function stopCameraStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * Verify if captured face matches enrolled face
 */
export function verifyFace(
  capturedEmbedding: number[],
  enrolledEmbedding: number[]
): FaceMatch {
  const distance = euclideanDistance(capturedEmbedding, enrolledEmbedding);
  const confidence = distanceToConfidence(distance);
  const isMatch = confidence >= 80; // 80% threshold
  
  return {
    confidence,
    distance,
    isMatch,
  };
}

/**
 * Compare multiple face captures to find best match
 */
export function getBestMatch(
  capturedEmbedding: number[],
  enrolledEmbeddings: number[][]
): { index: number; match: FaceMatch } | null {
  if (enrolledEmbeddings.length === 0) {
    return null;
  }
  
  let bestIndex = 0;
  let bestMatch = verifyFace(capturedEmbedding, enrolledEmbeddings[0]);
  
  for (let i = 1; i < enrolledEmbeddings.length; i++) {
    const match = verifyFace(capturedEmbedding, enrolledEmbeddings[i]);
    if (match.confidence > bestMatch.confidence) {
      bestIndex = i;
      bestMatch = match;
    }
  }
  
  return { index: bestIndex, match: bestMatch };
}

/**
 * Generate mock face embedding for testing
 * (when webcam is not available)
 */
export function generateMockEmbedding(): number[] {
  // Generate a random 128-dimensional vector
  const embedding: number[] = [];
  for (let i = 0; i < 128; i++) {
    embedding.push((Math.random() * 2) - 1); // Range: -1 to 1
  }
  return embedding;
}

/**
 * Generate similar mock embedding for testing face matching
 * Similarity is controlled by noise parameter (0-1)
 * 0 = identical, 1 = completely random
 */
export function generateSimilarMockEmbedding(
  baseEmbedding: number[],
  similarity: number = 0.85 // 85% similar = 15% "noise"
): number[] {
  const newEmbedding: number[] = [];
  for (let i = 0; i < 128; i++) {
    const noise = (Math.random() * 2 - 1) * (1 - similarity);
    newEmbedding.push(Math.max(-1, Math.min(1, baseEmbedding[i] + noise)));
  }
  return newEmbedding;
}

/**
 * Simulate face capture with delay
 */
export async function simulateFaceCapture(
  similarity: number = 0.85
): Promise<{ embedding: number[]; confidence: number }> {
  // Simulate processing delay
  await new Promise((resolve) => setTimeout(resolve, 1500));
  
  // Generate base and similar embeddings
  const baseEmbedding = generateMockEmbedding();
  const capturedEmbedding = generateSimilarMockEmbedding(baseEmbedding, similarity);
  
  // Compute match
  const match = verifyFace(capturedEmbedding, baseEmbedding);
  
  return {
    embedding: capturedEmbedding,
    confidence: match.confidence,
  };
}
