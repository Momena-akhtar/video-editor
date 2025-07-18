import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

interface AudioExtractOptions {
  outputFormat?: 'mp3' | 'wav' | 'aac' | 'ogg';
  quality?: 'low' | 'medium' | 'high';
  bitrate?: string;
  startTime?: string; // HH:MM:SS format
  duration?: string;  // HH:MM:SS format
}

interface AudioExtractResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: string;
  fileSize?: number;
}

export const audioExtract = async (
  videoPath: string, 
  options: AudioExtractOptions = {}
): Promise<AudioExtractResult> => {
  const {
    outputFormat = 'mp3',
    quality = 'medium',
    bitrate,
    startTime,
    duration
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
    const outputDir = path.join(process.cwd(), 'audio-extracts');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate output filename
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const timestamp = Date.now();
    const outputFilename = `${videoName}-audio-${timestamp}.${outputFormat}`;
    const outputPath = path.join(outputDir, outputFilename);

    // Build FFmpeg command
    const ffmpegArgs = [
      '-i', videoPath,
      '-vn', // No video
      '-acodec', getAudioCodec(outputFormat),
      '-ar', getSampleRate(quality),
      '-ac', '2', // Stereo
    ];

    // Add bitrate if specified
    if (bitrate) {
      ffmpegArgs.push('-b:a', bitrate);
    } else {
      // Default bitrates based on quality
      ffmpegArgs.push('-b:a', getDefaultBitrate(outputFormat, quality));
    }

    // Add time trimming if specified
    if (startTime) {
      ffmpegArgs.push('-ss', startTime);
    }
    if (duration) {
      ffmpegArgs.push('-t', duration);
    }

    // Add output file
    ffmpegArgs.push('-y', outputPath); // -y to overwrite existing files

    console.log('FFmpeg command:', 'ffmpeg', ffmpegArgs.join(' '));

    // Execute FFmpeg
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      
      let stderr = '';
      let stdout = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          // Success - get file info
          const fileSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
          
          resolve({
            success: true,
            outputPath,
            fileSize,
            duration: extractDuration(stderr)
          });
        } else {
          resolve({
            success: false,
            error: `FFmpeg failed with code ${code}: ${stderr}`
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

  } catch (error) {
    return {
      success: false,
      error: `Audio extraction error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
};

// Helper functions
function getAudioCodec(format: string): string {
  const codecs = {
    mp3: 'libmp3lame',
    wav: 'pcm_s16le',
    aac: 'aac',
    ogg: 'libvorbis'
  };
  return codecs[format as keyof typeof codecs] || 'libmp3lame';
}

function getSampleRate(quality: string): string {
  const rates = {
    low: '22050',
    medium: '44100',
    high: '48000'
  };
  return rates[quality as keyof typeof rates] || '44100';
}

function getDefaultBitrate(format: string, quality: string): string {
  const bitrates: Record<string, Record<string, string>> = {
    mp3: { low: '64k', medium: '128k', high: '320k' },
    wav: { low: '128k', medium: '256k', high: '512k' },
    aac: { low: '64k', medium: '128k', high: '256k' },
    ogg: { low: '64k', medium: '128k', high: '256k' }
  };
  
  const formatBitrates = bitrates[format];
  if (!formatBitrates) return '128k';
  
  return formatBitrates[quality as keyof typeof formatBitrates] || '128k';
}

function extractDuration(stderr: string): string {
  // Extract duration from FFmpeg stderr output
  const durationMatch = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (durationMatch) {
    const [, hours, minutes, seconds, centiseconds] = durationMatch;
    return `${hours}:${minutes}:${seconds}`;
  }
  return 'Unknown';
}

// Additional utility functions
export const getAudioInfo = async (audioPath: string): Promise<any> => {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      audioPath
    ]);

    let output = '';
    let error = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      error += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(output));
        } catch (e) {
          resolve({ error: 'Failed to parse audio info' });
        }
      } else {
        resolve({ error: `FFprobe failed: ${error}` });
      }
    });
  });
};

export const cleanupAudioFile = (audioPath: string): boolean => {
  try {
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error cleaning up audio file:', error);
    return false;
  }
};