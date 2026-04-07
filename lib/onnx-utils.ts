import * as ort from 'onnxruntime-web';

export interface Detection {
  class: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Class names - we'll verify these
export const CLASS_NAMES = [
  'good_bead',
  'bad_bead', 
  'layer_failure'
];

export async function loadModel(modelPath: string): Promise<ort.InferenceSession> {
  try {
    const session = await ort.InferenceSession.create(modelPath);
    
    // Print model info
    console.log('Model loaded successfully!');
    console.log('Input names:', session.inputNames);
    console.log('Output names:', session.outputNames);
    
    // Try to get input shape if available
    try {
      const inputName = session.inputNames[0];
      console.log('Input name:', inputName);
      // Note: input shape info may not be available in all ONNX Runtime versions
      console.log('Run a test inference to determine input shape');
    } catch (e) {
      console.log('Could not get input metadata, will use default 640x640');
    }
    
    return session;
  } catch (error) {
    console.error('Error loading model:', error);
    throw error;
  }
}

export function preprocessImage(
  imageElement: HTMLImageElement,
  targetSize: number = 640
): { tensor: ort.Tensor; scale: number } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  canvas.width = targetSize;
  canvas.height = targetSize;
  
  // Draw image scaled to target size
  ctx.drawImage(imageElement, 0, 0, targetSize, targetSize);
  
  // Get image data
  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const { data } = imageData;
  
  // Convert to RGB and normalize to [0, 1]
  const float32Data = new Float32Array(3 * targetSize * targetSize);
  
  for (let i = 0; i < targetSize * targetSize; i++) {
    float32Data[i] = data[i * 4] / 255.0; // R
    float32Data[targetSize * targetSize + i] = data[i * 4 + 1] / 255.0; // G
    float32Data[2 * targetSize * targetSize + i] = data[i * 4 + 2] / 255.0; // B
  }
  
  const tensor = new ort.Tensor('float32', float32Data, [1, 3, targetSize, targetSize]);
  const scale = Math.max(imageElement.width, imageElement.height) / targetSize;
  
  return { tensor, scale };
}

export function postprocessDetections(
  output: ort.Tensor,
  scale: number,
  confidenceThreshold: number = 0.5,
  iouThreshold: number = 0.4
): Detection[] {
  const detections: Detection[] = [];
  const outputData = output.data as Float32Array;
  
  // YOLO output format: [batch, num_detections, 5 + num_classes]
  // [x, y, w, h, confidence, class_scores...]
  
  const numDetections = output.dims[1];
  const numClasses = CLASS_NAMES.length;
  
  for (let i = 0; i < numDetections; i++) {
    const offset = i * (5 + numClasses);
    
    const x = outputData[offset];
    const y = outputData[offset + 1];
    const w = outputData[offset + 2];
    const h = outputData[offset + 3];
    const confidence = outputData[offset + 4];
    
    if (confidence < confidenceThreshold) continue;
    
    // Find best class
    let maxClassScore = 0;
    let maxClassIndex = 0;
    
    for (let j = 0; j < numClasses; j++) {
      const classScore = outputData[offset + 5 + j];
      if (classScore > maxClassScore) {
        maxClassScore = classScore;
        maxClassIndex = j;
      }
    }
    
    const finalConfidence = confidence * maxClassScore;
    
    if (finalConfidence >= confidenceThreshold) {
      detections.push({
        class: CLASS_NAMES[maxClassIndex],
        confidence: finalConfidence,
        x: (x - w / 2) * scale,
        y: (y - h / 2) * scale,
        width: w * scale,
        height: h * scale,
      });
    }
  }
  
  // Apply NMS (Non-Maximum Suppression)
  return applyNMS(detections, iouThreshold);
}

function applyNMS(detections: Detection[], iouThreshold: number): Detection[] {
  const sorted = detections.sort((a, b) => b.confidence - a.confidence);
  const keep: Detection[] = [];
  
  while (sorted.length > 0) {
    const current = sorted.shift()!;
    keep.push(current);
    
    for (let i = sorted.length - 1; i >= 0; i--) {
      const iou = calculateIOU(current, sorted[i]);
      if (iou > iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }
  
  return keep;
}

function calculateIOU(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;
  
  return intersection / union;
}

export function drawDetections(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  detections: Detection[]
): void {
  const ctx = canvas.getContext('2d')!;
  
  canvas.width = image.width;
  canvas.height = image.height;
  
  // Draw image
  ctx.drawImage(image, 0, 0);
  
  // Draw detections
  detections.forEach(det => {
    // Box color based on class
    const colors: { [key: string]: string } = {
      'good_bead': '#22c55e',
      'bad_bead': '#ef4444',
      'layer_failure': '#f59e0b',
    };
    
    const color = colors[det.class] || '#3b82f6';
    
    // Draw bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(det.x, det.y, det.width, det.height);
    
    // Draw label background
    const label = `${det.class} ${(det.confidence * 100).toFixed(1)}%`;
    ctx.font = '14px Inter';
    const textWidth = ctx.measureText(label).width;
    
    ctx.fillStyle = color;
    ctx.fillRect(det.x, det.y - 25, textWidth + 10, 25);
    
    // Draw label text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, det.x + 5, det.y - 7);
  });
}