import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

interface ZoomEffectOptions {
  startZoom?: number; // Starting zoom level (e.g., 1.2 = 20% zoomed in)
  endZoom?: number; // Ending zoom level (e.g., 1.0 = normal)
  duration?: number; // Duration of zoom transition in seconds
  centerX?: number; // X coordinate for zoom center (0-1, where 0.5 is center)
  centerY?: number; // Y coordinate for zoom center (0-1, where 0.5 is center)
  startTime?: number; // When to start the zoom effect (seconds from start)
}

interface ZoomEffectResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  originalDuration?: number;
  processedDuration?: number;
}

export const applyZoomEffect = async (
  videoPath: string,
  options: ZoomEffectOptions = {}
): Promise<ZoomEffectResult> => {
  const {
    startZoom = 1.2,
    endZoom = 1.0,
    duration = 2.0,
    centerX = 0.5,
    centerY = 0.5,
    startTime = 0
  } = options;

  try {
    // Validate input file exists
    if (!fs.existsSync(videoPath)) {
      return {
        success: false,
        error: `Video file not found: ${videoPath}`
      };
    }

    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate output filename
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const timestamp = Date.now();
    const outputFilename = `${videoName}-zoomed-${timestamp}.mp4`;
    const outputPath = path.join(outputDir, outputFilename);

    // Get video duration and dimensions
    const videoInfo = await getVideoInfo(videoPath);
    if (!videoInfo.success) {
      return {
        success: false,
        error: `Failed to get video info: ${videoInfo.error}`
      };
    }

    const { width, height, duration: videoDuration } = videoInfo;

    // Validate video dimensions
    if (!width || !height) {
      return {
        success: false,
        error: 'Could not determine video dimensions'
      };
    }

    // Calculate zoom parameters
    const zoomEffect = buildZoomFilter(
      startZoom,
      endZoom,
      duration,
      centerX,
      centerY,
      startTime,
      width,
      height
    );

    // Apply zoom effect
    const result = await executeZoomEffect(videoPath, outputPath, zoomEffect);

    if (!result.success) {
      return result;
    }

    return {
      success: true,
      outputPath,
      originalDuration: videoDuration,
      processedDuration: videoDuration
    };

  } catch (error) {
    return {
      success: false,
      error: `Zoom effect error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
};

// Build the zoompan filter string
function buildZoomFilter(
  startZoom: number,
  endZoom: number,
  duration: number,
  centerX: number,
  centerY: number,
  startTime: number,
  width: number,
  height: number
): string {
  // Calculate the zoom difference
  const zoomDiff = startZoom - endZoom;
  
  // Calculate center coordinates in pixels
  const centerXPx = centerX * width;
  const centerYPx = centerY * height;
  
  // Build the zoompan filter
  // The zoom parameter uses time-based interpolation
  // zoom='startZoom - (zoomDiff * on/total_frames)'
  const zoomFormula = `${startZoom}-${zoomDiff}*on/${Math.floor(duration * 30)}`; // Assuming 30fps
  
  // x and y keep the zoom centered
  const xFormula = `${centerXPx}-(iw-ow)/2`;
  const yFormula = `${centerYPx}-(ih-oh)/2`;
  
  return `zoompan=zoom='${zoomFormula}':x='${xFormula}':y='${yFormula}':d=${Math.floor(duration * 30)}:s=${width}x${height}`;
}

// Execute the zoom effect using FFmpeg
async function executeZoomEffect(
  inputPath: string,
  outputPath: string,
  zoomFilter: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-vf', zoomFilter,
      '-c:v', 'libx264',
      '-c:a', 'copy', // Copy audio without re-encoding
      '-y', outputPath
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ 
          success: false, 
          error: `FFmpeg zoom effect failed: ${stderr}` 
        });
      }
    });

    ffmpeg.on('error', (error) => {
      resolve({ 
        success: false, 
        error: `FFmpeg execution error: ${error.message}` 
      });
    });
  });
}

// Get video information (dimensions and duration)
async function getVideoInfo(videoPath: string): Promise<{
  success: boolean;
  width?: number;
  height?: number;
  duration?: number;
  error?: string;
}> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath
    ]);

    let output = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        try {
          const data = JSON.parse(output);
          const videoStream = data.streams.find((stream: any) => stream.codec_type === 'video');
          
          if (videoStream) {
            resolve({
              success: true,
              width: videoStream.width,
              height: videoStream.height,
              duration: parseFloat(data.format.duration)
            });
          } else {
            resolve({
              success: false,
              error: 'No video stream found'
            });
          }
        } catch (e) {
          resolve({
            success: false,
            error: 'Failed to parse video info'
          });
        }
      } else {
        resolve({
          success: false,
          error: 'Failed to get video info'
        });
      }
    });

    ffprobe.on('error', (error) => {
      resolve({
        success: false,
        error: `FFprobe error: ${error.message}`
      });
    });
  });
}

// Utility function to apply zoom effect at specific time ranges
export const applyZoomAtTime = async (
  videoPath: string,
  startTime: number,
  endTime: number,
  options: Omit<ZoomEffectOptions, 'startTime' | 'duration'> = {}
): Promise<ZoomEffectResult> => {
  const duration = endTime - startTime;
  
  return applyZoomEffect(videoPath, {
    ...options,
    startTime,
    duration
  });
};

// Utility function to apply multiple zoom effects
export const applyMultipleZoomEffects = async (
  videoPath: string,
  zoomEffects: Array<{
    startTime: number;
    endTime: number;
    startZoom: number;
    endZoom: number;
    centerX?: number;
    centerY?: number;
  }>
): Promise<ZoomEffectResult> => {
  // This would require a more complex implementation using filter_complex
  // For now, we'll implement a simple version that applies one zoom effect
  if (zoomEffects.length === 0) {
    return { success: true, outputPath: videoPath };
  }

  const firstEffect = zoomEffects[0];
  return applyZoomAtTime(videoPath, firstEffect.startTime, firstEffect.endTime, {
    startZoom: firstEffect.startZoom,
    endZoom: firstEffect.endZoom,
    centerX: firstEffect.centerX,
    centerY: firstEffect.centerY
  });
};
